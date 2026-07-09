import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../services/api'
import { getSocket } from '../services/socket'
import { motion } from 'framer-motion'
import { ArrowLeft, Phone, MessageSquare, AlertTriangle, PauseCircle, Play, UserCheck, Send, Mic, Bot, ChevronDown, ChevronUp, Headphones, MicOff, Ban } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { StatusBadge, ScoreBadge } from '../components/ui/Badge'
import { fadeInUp, stagger } from '../lib/animations'

function TranscriptMessage({ msg }) {
  const isSupervisor = msg.role === 'supervisor'
  const isAssistant = msg.role === 'assistant'
  const isUser = msg.role === 'user'

  return (
    <div className={`flex ${isSupervisor ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
        isSupervisor
          ? 'bg-accent/10 border border-accent/20 text-foreground rounded-br-md'
          : isAssistant
            ? 'bg-blue-50 border border-blue-100 text-foreground rounded-bl-md'
            : 'bg-muted border border-border text-foreground rounded-bl-md'
      }`}>
        <div className="flex items-center gap-1.5 mb-1.5">
          {isSupervisor && <UserCheck className="w-3 h-3 text-accent" />}
          {isAssistant && <Bot className="w-3 h-3 text-blue-500" />}
          {isUser && <Phone className="w-3 h-3 text-muted-foreground" />}
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {isSupervisor
              ? msg.metadata?.supervisorName || 'Supervisor'
              : isAssistant
                ? 'AI Assistant'
                : 'Caller'}
          </span>
        </div>
        <div className="text-[13px] leading-relaxed">{msg.content || msg.text}</div>
      </div>
    </div>
  )
}

function ScorecardPanel({ scorecard }) {
  if (!scorecard) return null
  const dims = scorecard.dimensions || {}
  const flags = scorecard.flags || []

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">Scorecard</h3>
      <div className="text-center mb-4">
        <span className="text-4xl font-bold gradient-text">{Math.round(scorecard.overall)}</span>
        <span className="text-sm text-muted-foreground ml-1">/ 100</span>
      </div>
      <div className="space-y-2.5">
        {Object.entries(dims).map(([key, val]) => (
          <div key={key}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
              <span className="font-semibold text-foreground">{Math.round(val)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  val >= 80 ? 'bg-green-500' : val >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${val}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      {flags.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <h4 className="text-xs font-semibold text-red-600 mb-2">Flags ({flags.length})</h4>
          {flags.map((f, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground mb-1.5">
              <AlertTriangle className="w-3 h-3 text-red-500 mt-0.5 shrink-0" />
              <span>{f.message || f.type}</span>
            </div>
          ))}
        </div>
      )}
      {scorecard.suggestion && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <strong>Suggestion:</strong> {scorecard.suggestion}
          </p>
        </div>
      )}
    </Card>
  )
}

export default function ConversationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { token, user } = useAuth()
  const [conversation, setConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [scorecard, setScorecard] = useState(null)
  const [injectText, setInjectText] = useState('')
  const [bargeText, setBargeText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [showScorecard, setShowScorecard] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const transcriptEndRef = useRef(null)
  const audioCtxRef = useRef(null)
  const micStreamRef = useRef(null)
  const micWorkletRef = useRef(null)
  const isListeningRef = useRef(false)
  isListeningRef.current = isListening

  const scrollToBottom = useCallback(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([
      api.get(`/api/conversations/${id}`),
      api.get(`/api/conversations/${id}/messages`, { params: { limit: 500 } }),
      api.get('/api/analytics/scorecards', { params: { limit: 500 } }),
    ])
      .then(([convRes, msgRes, scRes]) => {
        setConversation(convRes.data)
        setMessages(msgRes.data)
        const match = scRes.data.find(s => s.conversation_id === convRes.data.id)
        if (match) {
          setScorecard({
            overall: match.ai_performance_score,
            dimensions: typeof match.dimensions === 'string' ? JSON.parse(match.dimensions) : match.dimensions || {},
            flags: typeof match.flags === 'string' ? JSON.parse(match.flags) : match.flags || [],
            suggestion: match.suggestion,
            sentiment: match.sentiment,
          })
        }
      })
      .catch(() => navigate('/supervisor'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])

  useEffect(() => {
    if (!token || !id) return
    const socket = getSocket(token)
    socket.emit('join-conversation', id)

    socket.on('transcript', (data) => {
      if (data.conversationId !== id) return
      setMessages(prev => [...prev, {
        role: data.role,
        content: data.content,
        text: data.content,
        metadata: { supervisorName: data.supervisorName },
        created_at: new Date().toISOString(),
      }])
    })

    socket.on('status_change', (data) => {
      if (data.conversationId !== id) return
      setConversation(prev => prev ? { ...prev, status: data.status } : prev)
    })

    socket.on('conversation:update', (data) => {
      if (data.conversationId !== id) return
      setConversation(prev => prev ? { ...prev, ...data } : prev)
    })

    return () => {
      socket.emit('leave-conversation', id)
      socket.off('transcript')
      socket.off('status_change')
      socket.off('conversation:update')
    }
  }, [token, id])

  const playAudio = useCallback((base64Audio) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext({ sampleRate: 24000 })
      }
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') ctx.resume()
      const binary = atob(base64Audio)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const pcm16 = new Int16Array(bytes.buffer)
      const float32 = new Float32Array(pcm16.length)
      for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768
      const buffer = ctx.createBuffer(1, float32.length, 24000)
      buffer.getChannelData(0).set(float32)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.start()
    } catch (err) {
      console.error('Audio playback error:', err)
    }
  }, [])

  const stopMic = useCallback(() => {
    if (micWorkletRef.current) {
      micWorkletRef.current.processor.disconnect()
      micWorkletRef.current.source.disconnect()
      micWorkletRef.current = null
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
    }
    setIsSpeaking(false)
  }, [])

  const startMic = useCallback(async () => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext({ sampleRate: 24000 })
      }
      const ctx = audioCtxRef.current
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      micStreamRef.current = stream
      const source = ctx.createMediaStreamSource(stream)
      const processor = ctx.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0)
        const pcm16 = new Int16Array(input.length)
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]))
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
        }
        const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)))
        const socket = getSocket(token)
        if (socket?.connected) socket.emit('supervisor_audio', { externalId: id, audio: base64 })
      }
      source.connect(processor)
      processor.connect(ctx.destination)
      micWorkletRef.current = { source, processor }
      setIsSpeaking(true)
    } catch (err) {
      console.error('Mic error:', err)
    }
  }, [id, token])

  const handleListenToggle = () => {
    if (!isListening && audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume()
    }
    setIsListening(prev => !prev)
  }

  const handleSpeakToggle = () => {
    if (isSpeaking) {
      stopMic()
    } else {
      startMic()
    }
  }

  useEffect(() => {
    if (!token || !id) return
    const socket = getSocket(token)
    socket.on('audio', (data) => {
      if (data.conversationId !== id || !isListeningRef.current) return
      playAudio(data.audio)
    })
    return () => {
      socket.off('audio')
    }
  }, [token, id, playAudio])

  useEffect(() => {
    return () => {
      stopMic()
      if (audioCtxRef.current) {
        audioCtxRef.current.close()
        audioCtxRef.current = null
      }
    }
  }, [stopMic])

  const handleBargeIn = async () => {
    if (!bargeText.trim()) return
    setSending(true)
    try {
      await api.post('/api/supervisor/barge-in', { externalId: id, message: bargeText })
      setBargeText('')
    } catch (_) {
    } finally {
      setSending(false)
    }
  }

  const handleInject = async () => {
    if (!injectText.trim()) return
    setSending(true)
    try {
      await api.post('/api/supervisor/inject', { externalId: id, message: injectText })
      setInjectText('')
    } catch (_) {
    } finally {
      setSending(false)
    }
  }

  const handleToggleAI = async (enabled) => {
    try {
      await api.post('/api/supervisor/toggle-ai', { externalId: id, enabled })
      setConversation(prev => prev ? { ...prev, status: enabled ? 'active' : 'paused' } : prev)
    } catch (_) {}
  }

  const handleTakeover = async () => {
    try {
      await api.post('/api/supervisor/takeover', { externalId: id })
      setConversation(prev => prev ? { ...prev, status: 'takeover', ai_enabled: false } : prev)
    } catch (_) {}
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    )
  }

  if (!conversation) return null

  const conv = conversation
  const isPaused = conv.status === 'paused'
  const isTakeover = conv.status === 'takeover'
  const isEnded = conv.status === 'ended'

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <header className="px-6 py-3 border-b border-border bg-card flex items-center gap-4 shrink-0">
        <button onClick={() => navigate('/supervisor')} className="p-2 -ml-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-all">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl gradient-bg shrink-0 shadow-accent">
            {conv.channel === 'voice' ? <Phone className="w-4 h-4 text-white" /> : <MessageSquare className="w-4 h-4 text-white" />}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground truncate">
              {conv.caller_name || conv.caller_number || id?.substring(0, 12)}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <StatusBadge status={conv.status} />
              {conv.tenant && <span className="text-xs text-muted-foreground">{conv.tenant}</span>}
            </div>
          </div>
        </div>
        <div className="flex-1" />
        {conv.supervisor_name && (
          <span className="inline-flex items-center gap-1.5 text-xs text-accent font-medium bg-accent/5 rounded-lg px-3 py-1.5">
            <UserCheck className="w-3.5 h-3.5" />
            {conv.supervisor_name}
          </span>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Transcript */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-border">
          <div className="flex-1 overflow-y-auto p-4">
            <motion.div
              className="max-w-3xl mx-auto"
              initial="hidden"
              animate="visible"
              variants={stagger}
            >
              {messages.length === 0 ? (
                <div className="text-center py-20">
                  <MessageSquare className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">No messages yet</p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <motion.div key={msg.id || i} variants={fadeInUp}>
                    <TranscriptMessage msg={msg} />
                  </motion.div>
                ))
              )}
              <div ref={transcriptEndRef} />
            </motion.div>
          </div>

          {/* Inject bar */}
          {!isEnded && (
            <div className="p-4 border-t border-border bg-card">
              <div className="flex gap-2 max-w-3xl mx-auto">
                <input
                  type="text"
                  value={injectText}
                  onChange={e => setInjectText(e.target.value)}
                  placeholder="Send a message as supervisor..."
                  className="flex-1 h-11 rounded-xl border border-border bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 transition-all"
                  onKeyDown={e => { if (e.key === 'Enter') handleInject() }}
                />
                <Button onClick={handleInject} disabled={sending || !injectText.trim()} size="md">
                  <Send className="w-4 h-4" />
                  Send
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Controls panel */}
        <div className="w-72 bg-card flex flex-col overflow-y-auto shrink-0">
          <div className="p-4 space-y-3 border-b border-border">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Controls</h3>

            <Button
              onClick={() => handleToggleAI(isPaused || isTakeover)}
              disabled={isEnded}
              variant={isPaused || isTakeover ? 'primary' : 'secondary'}
              className="w-full"
            >
              {isPaused || isTakeover ? <Play className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />}
              {isPaused || isTakeover ? 'Resume AI' : 'Pause AI'}
            </Button>

            <Button
              onClick={handleTakeover}
              disabled={isEnded}
              variant="secondary"
              className="w-full text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
            >
              <Mic className="w-4 h-4" />
              Takeover
            </Button>

            <Button
              onClick={handleListenToggle}
              disabled={isEnded}
              variant={isListening ? 'primary' : 'secondary'}
              className={`w-full ${isListening ? 'animate-pulse' : ''}`}
            >
              <Headphones className="w-4 h-4" />
              {isListening ? 'Listening Live' : 'Listen Live'}
            </Button>

            <Button
              onClick={handleSpeakToggle}
              disabled={isEnded}
              variant={isSpeaking ? 'primary' : 'secondary'}
              className={`w-full ${isSpeaking ? 'animate-pulse' : ''}`}
            >
              {isSpeaking ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              {isSpeaking ? 'Stop Speaking' : 'Speak to Caller'}
            </Button>
          </div>

          {/* Barge-in */}
          {!isEnded && (
            <div className="p-4 space-y-3 border-b border-border">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Barge-In</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Cancel the AI response and inject your message into the conversation.
              </p>
              <textarea
                value={bargeText}
                onChange={e => setBargeText(e.target.value)}
                placeholder="Type message to inject..."
                className="w-full h-20 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 resize-none transition-all"
              />
              <Button
                onClick={handleBargeIn}
                disabled={sending || !bargeText.trim()}
                variant="secondary"
                className="w-full text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
              >
                Barge In
              </Button>
            </div>
          )}

          {/* Scorecard toggle */}
          <div className="p-4">
            <button
              onClick={() => setShowScorecard(!showScorecard)}
              className="w-full flex items-center justify-between text-sm font-semibold text-foreground mb-2"
            >
              Scorecard
              <div className="flex items-center gap-2">
                {scorecard ? <ScoreBadge score={scorecard.overall} /> : <span className="text-xs text-muted-foreground">N/A</span>}
                {showScorecard ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </div>
            </button>
            {showScorecard && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
              >
                <ScorecardPanel scorecard={scorecard} />
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}