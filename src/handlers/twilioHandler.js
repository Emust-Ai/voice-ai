import WebSocket from 'ws';
import { OPENAI_CONFIG, VOICE_AGENT_INSTRUCTIONS } from '../config/openai.js';
import { TOOLS } from '../config/tools.js';
import { executeN8nTool } from '../services/n8nService.js';
import ChatwootLogger from '../services/chatwootLogger.js';
import { billVoiceUsage } from '../services/billingService.js';
import { lookupCaller, saveCallerInfo, saveCallerContext, generateCallerContextPrompt } from '../services/userContextService.js';
import { generateConversationSummaryForContext } from '../services/conversationSummarizer.js';

// Build OpenAI Realtime WebSocket URL
const getOpenAIRealtimeUrl = () => {
  const model = process.env.OPENAI_REALTIME_MODEL || OPENAI_CONFIG.model;
  return `wss://api.openai.com/v1/realtime?model=${model}`;
};

export function handleTwilioWebSocket(connection, logger) {
  let openAiWs = null;
  let streamSid = null;
  let callSid = null;
  let callerNumber = null;
  let isOpenAiReady = false;
  let audioQueue = [];
  let chatwootLogger = null;
  let isResponseActive = false; // Track if OpenAI is currently generating a response
  let isConversationClosed = false; // Prevent multiple close calls
  let echoCooldownUntil = 0; // Timestamp until which speech_started events are ignored (echo suppression)
  let lastAudioSentAt = 0; // Track when AI audio is being sent (for echo suppression)
  let responseStartedAt = 0; // Track when the current AI utterance started
  let waitingForPlaybackDrain = false; // Wait for Twilio mark before accepting interruption
  let callerContext = null; // Persistent user context from previous calls
  let activeProfilePhoneNumber = null; // Context anchor (can switch to end-client number for CPO calls)

  const parseMs = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const ECHO_COOLDOWN_MS = parseMs(process.env.ECHO_COOLDOWN_MS, 1800);
  const MIN_BARGE_IN_MS = parseMs(process.env.MIN_BARGE_IN_MS, 1200);
  const ACTIVE_AUDIO_GUARD_MS = parseMs(process.env.ACTIVE_AUDIO_GUARD_MS, 650);

  const createVoiceResponseEvent = () => ({
    type: 'response.create'
  });

  // Connect to OpenAI Realtime API
  const connectToOpenAI = () => {
    const realtimeUrl = getOpenAIRealtimeUrl();
    logger.info(`Connecting to OpenAI: ${realtimeUrl}`);
    
    openAiWs = new WebSocket(realtimeUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });

    openAiWs.on('open', () => {
      logger.info('Connected to OpenAI Realtime API');
      initializeSession();
    });

    openAiWs.on('message', (data) => {
      handleOpenAiMessage(JSON.parse(data.toString()));
    });

    openAiWs.on('error', (error) => {
      logger.error({ err: error, message: error.message }, 'OpenAI WebSocket error');
    });

    openAiWs.on('close', (code, reason) => {
      logger.info(`OpenAI WebSocket closed: ${code} - ${reason.toString()}`);
      isOpenAiReady = false;
    });

    openAiWs.on('unexpected-response', (request, response) => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => {
        logger.error({ 
          statusCode: response.statusCode, 
          statusMessage: response.statusMessage,
          body: body 
        }, 'OpenAI connection rejected');
      });
    });
  };

  // Initialize OpenAI session with configuration
  const initializeSession = () => {
    // Build dynamic instructions with caller context
    const callerContextPrompt = generateCallerContextPrompt(callerContext);
    const dynamicInstructions = VOICE_AGENT_INSTRUCTIONS + '\n\n' + callerContextPrompt;
    
    if (callerContext?.name) {
      logger.info(`Returning caller detected: ${callerContext.name} (${callerNumber}), call #${callerContext.callCount + 1}`);
    } else {
      logger.info(`New caller detected: ${callerNumber}`);
    }

    const sessionConfig = {
      type: 'session.update',
      session: {
        type: 'realtime',
        audio: {
          input: {
            format: { type: 'audio/pcmu' },
            transcription: {
              model: 'gpt-4o-mini-transcribe',
              language: 'fr',
              prompt: 'Service client ev24 (bornes de recharge). Noms importants: BornEco, Borneco, Wattzhub, relais, Carrefour. Mots: borne, station, connecteur, RFID, recharge, facture. Priorité: bien transcrire le prénom/nom du client.'
            },
            turn_detection: {
              ...OPENAI_CONFIG.turn_detection,
              create_response: true,
              interrupt_response: false
            }
          },
          output: {
            format: { type: 'audio/pcmu' },
            voice: OPENAI_CONFIG.voice
          }
        },
        instructions: dynamicInstructions,
        output_modalities: ['audio'],
        max_output_tokens: OPENAI_CONFIG.max_response_output_tokens || 'inf',
        tools: TOOLS,
        tool_choice: 'auto'
      }
    };

    openAiWs.send(JSON.stringify(sessionConfig));
    logger.info('Session configuration sent to OpenAI with tools and transcription enabled');
    // Wait for session.updated event before marking ready (avoid race condition)
  };

  // Handle tool calls from OpenAI and execute n8n webhooks
  const handleToolCall = async (toolCall) => {
    const { name, arguments: argsString, call_id } = toolCall;
    
    logger.info(`Tool call received: ${name} with call_id: ${call_id}`);
    
    try {
      const args = JSON.parse(argsString);
      logger.info(`Tool arguments: ${JSON.stringify(args)}`);

      // Handle save_caller_info locally (not via n8n)
      if (name === 'save_caller_info') {
        const savedContext = saveCallerInfo(activeProfilePhoneNumber || callerNumber, {
          caller_name: args.caller_name,
          caller_phone: args.caller_phone
        });
        callerContext = savedContext;
        if (savedContext?.phoneNumber) {
          activeProfilePhoneNumber = savedContext.phoneNumber;
        }
        logger.info(`Saved caller info for profile ${activeProfilePhoneNumber || callerNumber}: name=${args.caller_name || 'N/A'}, phone=${args.caller_phone || 'N/A'}`);
        
        // Update Chatwoot logger so the contact uses the real name
        if (chatwootLogger) {
          if (args.caller_name) {
            chatwootLogger.setCallerName(args.caller_name);
          }
          if (activeProfilePhoneNumber) {
            chatwootLogger.setReferencePhoneNumber(activeProfilePhoneNumber);
          }
        }
        
        const toolResponse = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call_id,
            output: JSON.stringify({
              success: true,
              message: 'Caller info saved successfully.',
              profile_phone: activeProfilePhoneNumber || callerNumber,
              caller_name: args.caller_name || null,
              caller_phone: args.caller_phone || null
            })
          }
        };
        openAiWs.send(JSON.stringify(toolResponse));
        openAiWs.send(JSON.stringify(createVoiceResponseEvent()));
        return;
      }
      
      // Execute the n8n tool
      const result = await executeN8nTool(name, args, { callSid, streamSid, callerNumber });
      
      logger.info(`Tool ${name} result: ${JSON.stringify(result)}`);
      
      // Send the result back to OpenAI
      const toolResponse = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify(result)
        }
      };
      
      openAiWs.send(JSON.stringify(toolResponse));
      
      // Trigger OpenAI to continue the response
      openAiWs.send(JSON.stringify(createVoiceResponseEvent()));
      
      // If priority (human escalation) tool was called successfully, log it
      if (name === 'priority' && result.success !== false) {
        logger.info(`Human callback requested for caller ${callerNumber}. Reason: ${args.reason || 'Not specified'}`);
        
        // Mark in chatwoot that human escalation was requested
        if (chatwootLogger) {
          chatwootLogger.markHumanEscalation();
        }
      }
      
    } catch (error) {
      logger.error(`Error handling tool call ${name}:`, error);
      
      // Send error result back to OpenAI
      const errorResponse = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify({ 
            success: false, 
            error: `Tool execution failed: ${error.message}` 
          })
        }
      };
      
      openAiWs.send(JSON.stringify(errorResponse));
      openAiWs.send(JSON.stringify(createVoiceResponseEvent()));
    }
  };

  // Handle messages from OpenAI
  const handleOpenAiMessage = (message) => {
    // Log all message types for debugging
    if (message.type !== 'response.audio.delta' && message.type !== 'input_audio_buffer.speech_started') {
      logger.info(`OpenAI message: ${message.type}`);
    }
    
    switch (message.type) {
      case 'session.created':
        logger.info('OpenAI session created');
        // Don't wait - session config will be sent immediately
        break;

      case 'session.updated':
        logger.info('OpenAI session updated');
        isOpenAiReady = true;
        processAudioQueue(); // Process any audio that arrived before session was ready
        // Send initial greeting immediately - no delay
        sendInitialGreeting();
        break;

      case 'response.audio.delta':
      case 'response.output_audio.delta':
        if (!isResponseActive) {
          responseStartedAt = Date.now();
        }
        isResponseActive = true;
        waitingForPlaybackDrain = true;
        lastAudioSentAt = Date.now();
        // Send audio immediately to Twilio - Twilio handles its own jitter buffer
        if (message.delta && streamSid && connection.socket.readyState === WebSocket.OPEN) {
          connection.socket.send(JSON.stringify({
            event: 'media',
            streamSid: streamSid,
            media: { payload: message.delta }
          }));
        }
        break;

      case 'response.audio.done':
      case 'response.output_audio.done':
        logger.info('OpenAI audio response complete');
        // Send a mark event to ensure Twilio plays all buffered audio before we consider response complete
        if (streamSid && connection.socket.readyState === WebSocket.OPEN) {
          connection.socket.send(JSON.stringify({
            event: 'mark',
            streamSid: streamSid,
            mark: { name: 'response-complete' }
          }));
        } else {
          waitingForPlaybackDrain = false;
          isResponseActive = false;
          echoCooldownUntil = Date.now() + ECHO_COOLDOWN_MS;
        }
        break;

      case 'input_audio_buffer.speech_started':
        {
        const now = Date.now();
        // Echo suppression: ignore speech detection shortly after AI finishes speaking
        if (now < echoCooldownUntil) {
          logger.info('Ignoring speech_started during echo cooldown');
          break;
        }

        if (waitingForPlaybackDrain) {
          logger.info('Ignoring speech_started while Twilio is still draining AI audio');
          break;
        }

        // Guard against false barge-in caused by handset echo.
        if (isResponseActive) {
          const sinceResponseStart = now - responseStartedAt;
          const sinceLastAiAudio = now - lastAudioSentAt;

          if (sinceResponseStart < MIN_BARGE_IN_MS || sinceLastAiAudio < ACTIVE_AUDIO_GUARD_MS) {
            logger.info({ sinceResponseStart, sinceLastAiAudio }, 'Ignoring likely echo barge-in during active AI audio');
            break;
          }
        }

        if (!isResponseActive) {
          logger.info('speech_started detected while no active AI response');
          break;
        }

        logger.info('User started speaking - interrupting AI');
        // Clear Twilio's audio buffer to stop AI audio playback
        if (streamSid && connection.socket.readyState === WebSocket.OPEN) {
          connection.socket.send(JSON.stringify({
            event: 'clear',
            streamSid: streamSid
          }));
        }
        // Cancel OpenAI's ongoing response so it stops generating
        if (isResponseActive && openAiWs?.readyState === WebSocket.OPEN) {
          openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
          logger.info('Cancelled OpenAI response due to user interruption');
        }
        isResponseActive = false;
        waitingForPlaybackDrain = false;
        echoCooldownUntil = now + ECHO_COOLDOWN_MS;
        break;
        }

      case 'conversation.item.input_audio_transcription.completed':
        if (message.transcript) {
          logger.info(`User: ${message.transcript}`);
          if (chatwootLogger) {
            chatwootLogger.logUser(message.transcript);
          }
        }
        break;

      case 'response.output_audio_transcript.done':
        if (message.transcript) {
          logger.info(`Assistant: ${message.transcript}`);
          if (chatwootLogger) {
            chatwootLogger.logAssistant(message.transcript);
          }
        }
        break;

      case 'response.done':
        console.log('DEBUG: response.done event received');
        console.log('DEBUG: message.response?.output:', JSON.stringify(message.response?.output, null, 2));

        // Bill token usage to Lago
        if (message.response?.usage) {
          const usage = message.response.usage;
          billVoiceUsage(
            process.env.LAGO_CUSTOMER_ID,
            process.env.LAGO_SUBSCRIPTION_ID,
            {
              audioInputTokens: usage.input_token_details?.audio_tokens || 0,
              audioOutputTokens: usage.output_token_details?.audio_tokens || 0,
              textInputTokens: usage.input_token_details?.text_tokens || 0,
              textOutputTokens: usage.output_token_details?.text_tokens || 0,
            },
            logger
          );
        }

        if (message.response?.output) {
          message.response.output.forEach(output => {
            console.log('DEBUG: output.type:', output.type);
            if (output.type === 'message' && output.content) {
              output.content.forEach(content => {
                console.log('DEBUG: content.type:', content.type);
                // Handle both text and audio (with transcript) content
                if (content.type === 'text') {
                  logger.info(`Assistant: ${content.text}`);
                  if (chatwootLogger) {
                    chatwootLogger.logAssistant(content.text);
                  }
                } else if (content.type === 'audio' && content.transcript) {
                  logger.info(`Assistant: ${content.transcript}`);
                  if (chatwootLogger) {
                    chatwootLogger.logAssistant(content.transcript);
                  }
                }
              });
            }
            // Handle function calls in response output
            if (output.type === 'function_call') {
              handleToolCall(output);
            }
          });
        }
        break;

      case 'response.function_call_arguments.done':
        // Handle function call when arguments are complete
        if (message.name && message.call_id) {
          handleToolCall({
            name: message.name,
            arguments: message.arguments,
            call_id: message.call_id
          });
        }
        break;

      case 'error':
        logger.error({ 
          error: message.error,
          type: message.error?.type,
          code: message.error?.code,
          message: message.error?.message,
          param: message.error?.param,
          event_id: message.error?.event_id
        }, 'OpenAI error occurred');
        break;

      default:
        logger.debug(`OpenAI message type: ${message.type}`);
    }
  };

  // Send initial greeting to start conversation
  const sendInitialGreeting = () => {
    openAiWs.send(JSON.stringify(createVoiceResponseEvent()));
    logger.info('Initial greeting triggered');
  };

  // Process queued audio data
  const processAudioQueue = () => {
    while (audioQueue.length > 0 && isOpenAiReady) {
      const audioData = audioQueue.shift();
      sendAudioToOpenAI(audioData);
    }
  };

  // Send audio data to OpenAI
  const sendAudioToOpenAI = (audioData) => {
    if (openAiWs?.readyState === WebSocket.OPEN) {
      const audioEvent = {
        type: 'input_audio_buffer.append',
        audio: audioData
      };
      openAiWs.send(JSON.stringify(audioEvent));
    }
  };

  // Handle messages from Twilio
  connection.socket.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.event) {
        case 'connected':
          logger.info('Twilio media stream connected');
          connectToOpenAI();
          break;

        case 'start':
          streamSid = message.start.streamSid;
          callSid = message.start.callSid;
          
          // Log the entire start message to debug
          logger.info('Start message received:', JSON.stringify(message.start, null, 2));
          
          callerNumber = message.start.customParameters?.callerNumber || callSid;
          activeProfilePhoneNumber = callerNumber;
          logger.info(`Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}, Caller: ${callerNumber}`);
          logger.info(`CustomParameters:`, message.start.customParameters);
          
          // Look up caller context from persistent store
          callerContext = lookupCaller(callerNumber);
          if (callerContext) {
            logger.info(`Found existing context for ${callerNumber}: name=${callerContext.name}, calls=${callerContext.callCount}`);
            if (callerContext.phoneNumber) {
              activeProfilePhoneNumber = callerContext.phoneNumber;
            }
          } else {
            logger.info(`No existing context for ${callerNumber} — new caller`);
          }
          
          chatwootLogger = new ChatwootLogger(`twilio-${callerNumber}`, callSid);
          if (callerContext?.tenant) {
            chatwootLogger.setTenant(callerContext.tenant);
          }
          if (callerContext?.isKnownCaller || callerContext?.callerType === 'cpo') {
            chatwootLogger.setKnownCallerProfile(callerContext.callerType || 'known');
          }
          if (callerContext?.label) {
            chatwootLogger.addConversationLabel(callerContext.label);
          }
          if (activeProfilePhoneNumber) {
            chatwootLogger.setReferencePhoneNumber(activeProfilePhoneNumber);
          }
          // If we already know the caller's name, set it on the logger for Chatwoot
          if (callerContext?.name) {
            chatwootLogger.setCallerName(callerContext.name);
          }
          logger.info(`Conversation logging started for ${callerNumber}`);
          break;

        case 'media':
          // Forward audio to OpenAI
          if (isOpenAiReady) {
            sendAudioToOpenAI(message.media.payload);
          } else {
            // Queue audio if OpenAI isn't ready yet
            audioQueue.push(message.media.payload);
          }
          break;

        case 'mark':
          if (message.mark?.name === 'response-complete') {
            waitingForPlaybackDrain = false;
            isResponseActive = false;
            echoCooldownUntil = Date.now() + ECHO_COOLDOWN_MS;
            logger.info('Twilio playback mark received; response considered fully played');
          }
          break;

        case 'stop':
          logger.info('Twilio stream stopped');
          break;

        default:
          logger.debug(`Twilio event: ${message.event}`);
      }
    } catch (error) {
      logger.error('Error processing Twilio message:', error);
    }
  });

  // Handle Twilio WebSocket close
  connection.socket.on('close', async () => {
    logger.info('Twilio WebSocket closed');
    
    // Save conversation context for future calls
    if ((activeProfilePhoneNumber || callerNumber) && chatwootLogger) {
      try {
        const summary = await generateConversationSummaryForContext(chatwootLogger.messages);
        const contextPhone = activeProfilePhoneNumber || callerNumber;
        saveCallerContext(contextPhone, {
          lastProblem: summary.lastProblem || null,
          lastResolution: summary.lastResolution || null,
          conversationSummary: summary.conversationSummary || null
        });
        logger.info(`Saved conversation context for ${contextPhone}`);
      } catch (err) {
        logger.error(`Failed to save conversation context: ${err.message}`);
      }
    }
    
    if (chatwootLogger && !isConversationClosed) {
      isConversationClosed = true;
      await chatwootLogger.close();
    }
    if (openAiWs?.readyState === WebSocket.OPEN) {
      openAiWs.close();
    }
  });

  // Handle Twilio WebSocket errors
  connection.socket.on('error', (error) => {
    logger.error('Twilio WebSocket error:', error);
  });
}
