import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../services/api'
import { getSocket } from '../services/socket'
import { motion } from 'framer-motion'
import { MessageSquare, Phone, AlertTriangle, PauseCircle, UserCheck } from 'lucide-react'
import Card from '../components/ui/Card'
import { SectionLabel, StatusBadge, ScoreBadge } from '../components/ui/Badge'
import { fadeInUp, stagger } from '../lib/animations'

function ConversationCard({ conv, status, score, flags, onClick }) {
  return (
    <motion.div variants={fadeInUp}>
      <Card className="p-4 cursor-pointer group" onClick={onClick}>
        <div className="flex items-start justify-between mb-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl gradient-bg shrink-0 shadow-accent">
              {conv.channel === 'voice'
                ? <Phone className="w-4 h-4 text-white" />
                : <MessageSquare className="w-4 h-4 text-white" />
              }
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground truncate leading-tight">
                {conv.caller_name || conv.caller_number || conv.external_id?.substring(0, 12)}
              </div>
              {conv.caller_name && conv.caller_number && (
                <div className="text-xs text-muted-foreground truncate">{conv.caller_number}</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {flags?.length > 0 && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
            <ScoreBadge score={score} />
            <StatusBadge status={status} />
          </div>
        </div>

        {conv.lastTranscript && (
          <div className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-2.5 bg-muted/50 rounded-lg px-3 py-2">
            "{conv.lastTranscript}"
          </div>
        )}

        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground capitalize">
            {conv.tenant || 'Unknown tenant'}
          </span>
          {conv.supervisor_name && (
            <span className="inline-flex items-center gap-1 text-accent font-medium">
              <UserCheck className="w-3 h-3" />
              {conv.supervisor_name}
            </span>
          )}
        </div>
      </Card>
    </motion.div>
  )
}

export default function Dashboard() {
  const { user, token } = useAuth()
  const navigate = useNavigate()
  const [conversations, setConversations] = useState({})
  const [filter, setFilter] = useState('active')
  const socketRef = useRef(null)

  const fetchConversations = useCallback(async () => {
    try {
      const res = await api.get('/api/conversations', { params: { limit: 100 } })
      setConversations(prev => {
        const next = { ...prev }
        for (const c of res.data) {
          const key = c.external_id || c.id
          next[key] = {
            external_id: key,
            caller_number: c.caller_number || key.substring(0, 12),
            caller_name: c.caller_name || '',
            channel: c.channel || 'voice',
            tenant: c.tenant || '',
            status: c.status || 'active',
            started_at: c.started_at,
            score: null,
            flags: [],
            lastTranscript: '',
            ...prev[key],
          }
        }
        return next
      })
    } catch (_) {}
  }, [])

  useEffect(() => {
    fetchConversations()
    const interval = setInterval(fetchConversations, 10000)
    return () => clearInterval(interval)
  }, [fetchConversations])

  useEffect(() => {
    if (!token) return
    const socket = getSocket(token)
    socketRef.current = socket

    socket.on('connect', () => {
      socket.emit('join-conversation', 'all')
    })

    const makeConv = (conversationId, overrides = {}) => ({
      external_id: conversationId,
      caller_number: conversationId.substring(0, 12),
      channel: 'voice',
      status: 'active',
      score: null,
      flags: [],
      lastTranscript: '',
      ...overrides,
    })

    socket.on('transcript', (data) => {
      const { conversationId, content } = data
      setConversations(prev => ({
        ...prev,
        [conversationId]: makeConv(conversationId, {
          ...prev[conversationId],
          lastTranscript: content?.substring(0, 100) || '',
          status: 'active',
        }),
      }))
    })

    socket.on('status_change', (data) => {
      const { conversationId, status } = data
      setConversations(prev => ({
        ...prev,
        [conversationId]: makeConv(conversationId, { ...prev[conversationId], status }),
      }))
    })

    socket.on('score', (data) => {
      const { conversationId, overall } = data
      setConversations(prev => ({
        ...prev,
        [conversationId]: makeConv(conversationId, { ...prev[conversationId], score: overall }),
      }))
    })

    socket.on('flag', (data) => {
      const { conversationId } = data
      setConversations(prev => ({
        ...prev,
        [conversationId]: makeConv(conversationId, {
          ...prev[conversationId],
          flags: [...(prev[conversationId]?.flags || []), data],
        }),
      }))
    })

    socket.on('conversation:update', (data) => {
      const { conversationId, eventType, timestamp, ...rest } = data
      const fields = ['caller_number', 'caller_name', 'channel', 'tenant', 'status', 'started_at']
      const updates = {}
      for (const f of fields) {
        if (rest[f] !== undefined) updates[f] = rest[f]
      }
      setConversations(prev => ({
        ...prev,
        [conversationId]: makeConv(conversationId, { ...prev[conversationId], ...updates }),
      }))
    })

    return () => {
      socket.off('transcript')
      socket.off('status_change')
      socket.off('score')
      socket.off('flag')
      socket.off('conversation:update')
    }
  }, [token])

  const filteredConversations = Object.values(conversations)
    .filter(c => filter === 'all' || c.status === filter)
    .sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0))

  const filters = ['active', 'paused', 'ended', 'all']

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <header className="px-6 py-4 border-b border-border bg-card flex items-center justify-between shrink-0">
        <div>
          <h1 className="font-display text-2xl text-foreground">Live Feed</h1>
          <p className="text-muted-foreground text-xs mt-0.5">
            {Object.keys(conversations).length} conversation{Object.keys(conversations).length !== 1 ? 's' : ''} monitored
          </p>
        </div>
        <div className="flex gap-1.5 bg-muted rounded-xl p-1">
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 capitalize ${
                filter === f
                  ? 'bg-card text-accent shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <motion.div
          className="max-w-6xl mx-auto"
          initial="hidden"
          animate="visible"
          variants={stagger}
        >
          {filteredConversations.length === 0 ? (
            <motion.div
              className="text-center py-24"
              variants={fadeInUp}
            >
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-muted mb-4">
                <MessageSquare className="w-7 h-7 text-muted-foreground/50" />
              </div>
              <h2 className="font-display text-xl text-foreground mb-1">
                No {filter !== 'all' ? filter : ''} conversations
              </h2>
              <p className="text-muted-foreground text-sm">
                {filter === 'active'
                  ? 'Waiting for incoming calls...'
                  : filter === 'all'
                    ? 'No conversations yet'
                    : `No ${filter} conversations at the moment`}
              </p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredConversations.map(conv => (
                <ConversationCard
                  key={conv.external_id || conv.id}
                  conv={conv}
                  status={conv.status}
                  score={conv.score}
                  flags={conv.flags}
                  onClick={() => navigate(`/supervisor/conversation/${conv.external_id || conv.id}`)}
                />
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}