import WebSocket from 'ws';
import { OPENAI_CONFIG, VOICE_AGENT_INSTRUCTIONS } from '../config/openai.js';
import { TOOLS } from '../config/tools.js';
import { executeN8nTool } from '../services/n8nService.js';
import ChatwootLogger from '../services/chatwootLogger.js';
import { billVoiceUsage } from '../services/billingService.js';
import { lookupCaller, saveCallerInfo, saveCallerContext, generateCallerContextPrompt } from '../services/userContextService.js';
import { generateConversationSummaryForContext } from '../services/conversationSummarizer.js';
import { setSession, getSession, removeSession } from '../utils/callState.js';
import { classifyIntent } from '../services/intentClassifier.js';
import { CallMemory } from '../services/callMemory.js';
import { executeN8nToolsParallel } from '../services/n8nService.js';
import twilio from 'twilio';

// Lazily initialize Twilio client
let twilioClientInstance = null;
const getTwilioClient = () => {
  if (!twilioClientInstance) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (accountSid && authToken) {
      twilioClientInstance = twilio(accountSid, authToken);
    }
  }
  return twilioClientInstance;
};

// Build Azure OpenAI Realtime WebSocket URL
const getAzureOpenAIRealtimeUrl = () => {
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || OPENAI_CONFIG.model;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-10-01-preview';
  return `${endpoint}/openai/realtime?api-version=${apiVersion}&deployment=${deployment}`;
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
  let firstUserMessageClassified = false; // Track if we've classified the first user message
  let callMemory = null; // Short-term session memory (Task 2)
  let toolCallBuffer = []; // Buffer for parallel tool call batching (Task 6)
  let toolCallTimer = null; // Debounce timer for tool call batching
  const TOOL_BATCH_WINDOW_MS = 300; // Window to collect concurrent tool calls
  let silenceTimer = null; // Timer for silence-based proactive help (Task 7)
  let lastUserMessages = []; // Last 3 user transcripts for repetition detection (Task 7)
  let lastSilenceInjection = 0; // Prevent repeated silence injections
  const SILENCE_TIMEOUT_MS = 8000; // 8s of silence triggers help offer
  const SILENCE_INJECTION_COOLDOWN = 30000; // Don't inject again within 30s

  const parseMs = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const ECHO_COOLDOWN_MS = parseMs(process.env.ECHO_COOLDOWN_MS, 1800);

  const createVoiceResponseEvent = () => ({
    type: 'response.create'
  });

  // Connect to OpenAI Realtime API
  const connectToOpenAI = () => {
    const realtimeUrl = getAzureOpenAIRealtimeUrl();
    logger.info(`Connecting to Azure OpenAI: ${realtimeUrl}`);
    
    openAiWs = new WebSocket(realtimeUrl, {
      headers: {
        'api-key': process.env.AZURE_OPENAI_API_KEY
      }
    });

    openAiWs.on('open', () => {
      logger.info('Connected to Azure OpenAI Realtime API');
      initializeSession();
    });

    openAiWs.on('message', (data) => {
      handleOpenAiMessage(JSON.parse(data.toString()));
    });

    openAiWs.on('error', (error) => {
      logger.error({ err: error, message: error.message }, 'Azure OpenAI WebSocket error');
    });

    openAiWs.on('close', (code, reason) => {
      logger.info(`Azure OpenAI WebSocket closed: ${code} - ${reason.toString()}`);
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
        }, 'Azure OpenAI connection rejected');
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
        modalities: ['text', 'audio'],
        instructions: dynamicInstructions,
        voice: OPENAI_CONFIG.voice,
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: {
          model: 'whisper-1',
          language: 'fr',
          prompt: 'Service client ev24 (bornes de recharge). Noms importants: BornEco, Borneco, Wattzhub, relais, Carrefour. Mots: borne, station, connecteur, RFID, recharge, facture. Priorité: bien transcrire le prénom/nom du client.'
        },
        turn_detection: {
          ...OPENAI_CONFIG.turn_detection,
          create_response: true,
          interrupt_response: true
        },
        max_response_output_tokens: OPENAI_CONFIG.max_response_output_tokens || 'inf',
        tools: TOOLS,
        tool_choice: 'auto'
      }
    };

    openAiWs.send(JSON.stringify(sessionConfig));
    logger.info('Session configuration sent to Azure OpenAI with tools and transcription enabled');
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
      
      // Handle request_location_tool locally — send SMS via Twilio, don't go through n8n
      if (name === 'request_location_tool') {
        if (callerNumber) {
          setSession(callerNumber, { openAiWs, callSid, streamSid });
        }
        if (callMemory) {
          callMemory.addToolCall(name, args, null);
        }
        // Send SMS asking for location via Twilio
        try {
          const twilioClient = getTwilioClient();
          if (twilioClient && callerNumber) {
            const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
            await twilioClient.messages.create({
              body: 'ev24 — Pour trouver la borne la plus proche, répondez avec votre adresse ou votre position (ex: "45.123, 3.456" ou "10 rue de Paris"). Merci !',
              from: twilioPhone,
              to: callerNumber
            });
            logger.info(`Location SMS sent to ${callerNumber}`);
          }
        } catch (smsError) {
          logger.error(`Failed to send location SMS: ${smsError.message}`);
        }
        const toolResponse = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call_id,
            output: JSON.stringify({ success: true, message: 'SMS sent to caller asking for their location.' })
          }
        };
        openAiWs.send(JSON.stringify(toolResponse));
        openAiWs.send(JSON.stringify(createVoiceResponseEvent()));
        return;
      }

      // Feed tool call to short-term memory (Task 2)
      if (callMemory) {
        callMemory.addToolCall(name, args, null);
      }

      // Execute the n8n tool
      const result = await executeN8nTool(name, args, { callSid, streamSid, callerNumber });
      
      // Feed tool result to memory
      if (callMemory) {
        callMemory.addToolCall(name, args, result);
      }
      
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

  // Flush buffered tool calls with parallel execution (Task 6)
  const flushToolCallBuffer = async () => {
    toolCallTimer = null;
    const buffer = toolCallBuffer;
    toolCallBuffer = [];

    if (buffer.length === 0) return;

    logger.info(`Flushing ${buffer.length} tool call(s) in parallel`);

    // Separate local tools from n8n tools
    const localTools = buffer.filter(tc => tc.name === 'save_caller_info' || tc.name === 'request_location_tool');
    const n8nTools = buffer.filter(tc => tc.name !== 'save_caller_info' && tc.name !== 'request_location_tool');

    // Process local tools immediately
    for (const tc of localTools) {
      await handleToolCall(tc);
    }

    if (n8nTools.length === 0) return;

    // Execute n8n tools in parallel
    const results = await executeN8nToolsParallel(
      n8nTools.map(tc => ({
        name: tc.name,
        args: JSON.parse(tc.arguments),
        callId: tc.call_id
      })),
      { callSid, streamSid, callerNumber }
    );

    // Feed results to memory and send back to OpenAI
    for (const tc of n8nTools) {
      let args;
      try { args = JSON.parse(tc.arguments); } catch { args = {}; }
      const result = results[tc.call_id] || { success: false, error: 'No result' };

      if (callMemory) {
        callMemory.addToolCall(tc.name, args, result);
      }

      logger.info(`Tool ${tc.name} result: ${JSON.stringify(result)}`);

      const toolResponse = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: tc.call_id,
          output: JSON.stringify(result)
        }
      };
      if (openAiWs?.readyState === WebSocket.OPEN) {
        openAiWs.send(JSON.stringify(toolResponse));
      }

      if (tc.name === 'priority' && result.success !== false) {
        logger.info(`Human callback requested for caller ${callerNumber}. Reason: ${args.reason || 'Not specified'}`);
        if (chatwootLogger) {
          chatwootLogger.markHumanEscalation();
        }
      }
    }

    // Trigger OpenAI to continue after all results
    if (openAiWs?.readyState === WebSocket.OPEN) {
      openAiWs.send(JSON.stringify(createVoiceResponseEvent()));
    }
  };

  // Start silence timer for proactive help (Task 7)
  const startSilenceTimer = () => {
    cancelSilenceTimer();
    // Don't start timer if response is active (AI still generating)
    if (isResponseActive) return;
    const now = Date.now();
    if (now - lastSilenceInjection < SILENCE_INJECTION_COOLDOWN) return;
    silenceTimer = setTimeout(() => {
      const currentResponseActive = isResponseActive;
      const now2 = Date.now();
      if (!currentResponseActive && now2 - lastSilenceInjection >= SILENCE_INJECTION_COOLDOWN) {
        logger.info('Silence timeout — user hasn\'t spoken, injecting proactive help');
        lastSilenceInjection = now2;
        if (openAiWs?.readyState === WebSocket.OPEN) {
          openAiWs.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'system',
              content: [{
                type: 'input_text',
                text: '[SYSTEM: Caller has been silent for several seconds. If you asked a question and are waiting for a response, offer to help: "Pas de souci, prenez votre temps." Or if you\'ve been troubleshooting, ask if they want a human agent: "Souhaitez-vous que je vous mette en contact avec un collègue ?"]'
              }]
            }
          }));
          openAiWs.send(JSON.stringify({ type: 'response.create' }));
        }
      }
    }, SILENCE_TIMEOUT_MS);
  };

  const cancelSilenceTimer = () => {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
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
        logger.info('Azure OpenAI session created');
        // Don't wait - session config will be sent immediately
        break;

      case 'session.updated':
        logger.info('Azure OpenAI session updated');
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
        logger.info('Azure OpenAI audio response complete');
        // Start silence timer for hesitation detection (Task 7)
        startSilenceTimer();
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
        // Cancel silence timer — user is speaking (Task 7)
        cancelSilenceTimer();
        // Echo suppression: ignore speech detection shortly after AI finishes speaking
        if (now < echoCooldownUntil) {
          logger.info('Ignoring speech_started during echo cooldown');
          break;
        }

        logger.info('User started speaking - interrupting AI');
        // Clear Twilio's audio buffer immediately when user speaks
        if (streamSid && connection.socket.readyState === WebSocket.OPEN) {
          connection.socket.send(JSON.stringify({
            event: 'clear',
            streamSid: streamSid
          }));
        }
        // Cancel OpenAI's ongoing response
        if (openAiWs?.readyState === WebSocket.OPEN) {
          openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
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
          // Feed to short-term memory (Task 2)
          if (callMemory) {
            callMemory.addUserMessage(message.transcript);
          }
          // Hesitation and repetition detection (Task 7)
          const transcript = message.transcript.trim().toLowerCase();
          lastUserMessages.push(transcript);
          if (lastUserMessages.length > 3) lastUserMessages.shift();
          // Check for hesitation fillers
          const hesitationPatterns = [
            /euh|euuuh|heu|hm|mmm/i,
            /je sais pas|j'sais pas|je ne sais pas/i,
            /j'comprends pas|je comprends pas|comprends rien/i,
            /c'est compliqué|trop compliqué/i,
            /j'ai du mal|j'y arrive pas/i,
            /pouvez-vous répéter|vous pouvez répéter/i,
            /excusez-moi|désolé.*comprends/i,
          ];
          const hasHesitation = hesitationPatterns.some(p => p.test(transcript));
          // Check for repetition (same intent said twice)
          let isRepeating = false;
          if (lastUserMessages.length >= 2) {
            const last = lastUserMessages[lastUserMessages.length - 1];
            const prev = lastUserMessages[lastUserMessages.length - 2];
            if (last && prev && last !== prev) {
              const lastWords = new Set(last.split(/\s+/).filter(w => w.length > 3));
              const prevWords = new Set(prev.split(/\s+/).filter(w => w.length > 3));
              if (lastWords.size > 0 && prevWords.size > 0) {
                let overlap = 0;
                for (const w of lastWords) if (prevWords.has(w)) overlap++;
                const ratio = overlap / Math.min(lastWords.size, prevWords.size);
                if (ratio > 0.6 && lastWords.size > 1) isRepeating = true;
              }
            }
          }
          if (hasHesitation || isRepeating) {
            const reason = hasHesitation ? 'hesitation' : 'repetition';
            logger.info(`Detected user ${reason}: "${transcript.substring(0, 60)}"`);
            if (openAiWs?.readyState === WebSocket.OPEN) {
              openAiWs.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'message',
                  role: 'system',
                  content: [{
                    type: 'input_text',
                    text: `[SYSTEM: Caller showed ${reason} ("${transcript.substring(0, 80)}"). Offer simplified help or human escalation if appropriate.]`
                  }]
                }
              }));
            }
          }
          // Intent classification on first user message (Task 3)
          if (!firstUserMessageClassified) {
            firstUserMessageClassified = true;
            classifyIntent(message.transcript).then(result => {
              logger.info(`Intent classified: ${result.intent} (confidence: ${result.confidence})`);
              if (callMemory && result.intent !== 'other') {
                callMemory.setIntent(result.intent);
                if (result.slots.tenant) callMemory.setInfo('tenant', result.slots.tenant);
                if (result.slots.station) callMemory.setInfo('station', result.slots.station);
                if (result.slots.problem) callMemory.setInfo('problem', result.slots.problem);
              }
              if (result.confidence >= 0.5 && result.intent !== 'greeting' && result.intent !== 'other') {
                // Inject intent info + memory snapshot as system message for the AI
                const intentMsg = `[INTENT: ${result.intent}]`;
                const slots = result.slots;
                const slotParts = [];
                if (slots.tenant) slotParts.push(`tenant="${slots.tenant}"`);
                if (slots.station) slotParts.push(`station="${slots.station}"`);
                if (slots.problem) slotParts.push(`problem="${slots.problem}"`);
                if (slots.method) slotParts.push(`method="${slots.method}"`);
                const slotStr = slotParts.length > 0 ? ` Slots: ${slotParts.join(', ')}.` : '';
                const memorySnapshot = callMemory ? callMemory.getStateSnapshot() : null;
                const memoryStr = memorySnapshot ? ` ${memorySnapshot}` : '';
                const fullMsg = intentMsg + slotStr + memoryStr;
                logger.info(`Injecting intent + memory: ${fullMsg}`);
                if (openAiWs?.readyState === WebSocket.OPEN) {
                  openAiWs.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                      type: 'message',
                      role: 'system',
                      content: [{ type: 'input_text', text: fullMsg }]
                    }
                  }));
                }
              }
              // Trigger periodic summary (Task 2)
              if (callMemory && callMemory.shouldSummarize()) {
                callMemory.markSummarized();
                const summarySnapshot = callMemory.getStateSnapshot();
                if (summarySnapshot && openAiWs?.readyState === WebSocket.OPEN) {
                  openAiWs.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                      type: 'message',
                      role: 'system',
                      content: [{ type: 'input_text', text: summarySnapshot }]
                    }
                  }));
                  logger.info(`Injected periodic memory summary`);
                }
              }
            }).catch(err => {
              logger.error(`Intent classification failed: ${err.message}`);
            });
          }
        }
        break;

      case 'response.output_audio_transcript.delta':
        if (message.delta) {
          logger.info(`Assistant (partial): ${message.delta}`);
          // Forward partial transcript to Chatwoot for real-time streaming visibility (Task 1)
          if (chatwootLogger && chatwootLogger.logPartialAssistant) {
            chatwootLogger.logPartialAssistant(message.delta);
          }
        }
        break;

      case 'response.output_audio_transcript.done':
        if (message.transcript) {
          logger.info(`Assistant: ${message.transcript}`);
          if (chatwootLogger) {
            chatwootLogger.logAssistant(message.transcript);
          }
          if (callMemory) {
            callMemory.addAssistantMessage(message.transcript);
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
            // Function calls are handled via response.function_call_arguments.done
            // (with batching in Task 6) — skip here to avoid duplicate execution
          });
        }
        break;

      case 'response.function_call_arguments.done':
        // Handle function call when arguments are complete
        if (message.name && message.call_id) {
          // Buffer for parallel execution (Task 6)
          toolCallBuffer.push({
            name: message.name,
            arguments: message.arguments,
            call_id: message.call_id
          });
          // Clear existing timer and set new one
          if (toolCallTimer) clearTimeout(toolCallTimer);
          toolCallTimer = setTimeout(() => flushToolCallBuffer(), TOOL_BATCH_WINDOW_MS);
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
        }, 'Azure OpenAI error occurred');
        break;

      default:
        logger.debug(`Azure OpenAI message type: ${message.type}`);
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
          // Initialize short-term session memory (Task 2)
          callMemory = new CallMemory(callSid);
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
    if (callerNumber) removeSession(callerNumber);
    if (openAiWs?.readyState === WebSocket.OPEN) {
      openAiWs.close();
    }
  });

  // Handle Twilio WebSocket errors
  connection.socket.on('error', (error) => {
    logger.error('Twilio WebSocket error:', error);
  });
}

export function injectLocation(phone, { station, address, distance, coordinates }) {
  const session = getSession(phone);
  if (!session || session.openAiWs?.readyState !== WebSocket.OPEN) return { success: false };

  session.openAiWs.send(JSON.stringify({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{
        type: 'input_text',
        text:
          `[SYSTEM: Caller replied via SMS. Location: ${coordinates}. ` +
          `Nearest EV charging station: "${station}" at ${address} (${distance}km away). ` +
          `Tell the caller about this station.]`
      }]
    }
  }));
  session.openAiWs.send(JSON.stringify({ type: 'response.create' }));
  removeSession(phone);
  return { success: true };
}
