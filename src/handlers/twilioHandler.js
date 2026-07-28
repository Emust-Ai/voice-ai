import WebSocket from 'ws';
import { OPENAI_CONFIG, VOICE_AGENT_INSTRUCTIONS, createTranscriptionConfig } from '../config/openai.js';
import { TOOLS } from '../config/tools.js';
import { executeN8nTool } from '../services/n8nService.js';
import ChatwootLogger from '../services/chatwootLogger.js';
import { billVoiceUsage } from '../services/billingService.js';
import { lookupCaller, saveCallerInfo, saveCallerContext, generateCallerContextPrompt } from '../services/userContextService.js';
import { generateConversationSummaryForContext } from '../services/conversationSummarizer.js';
import { setSession, getSession, removeSession } from '../utils/callState.js';
import { CallMemory } from '../services/callMemory.js';
import { executeN8nToolsParallel } from '../services/n8nService.js';
import { buildQrRequestKey, sendQrCodeSms } from '../services/qrCodeService.js';
import {
  ConversationLanguage,
  createLanguageResponseEvent,
  extractStationMention,
  isAffirmativeResponse,
  isLikelyTranscriptHallucination,
  needsLocationSms,
  needsQrFallback,
  requestsHumanAgent
} from '../services/conversationQuality.js';
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
  let azureResponseActive = false;
  let queuedResponseInstruction = null;
  let isConversationClosed = false; // Prevent multiple close calls
  let echoCooldownUntil = 0; // Timestamp until which speech_started events are ignored (echo suppression)
  let waitingForPlaybackDrain = false; // Wait for Twilio mark before accepting interruption
  let latestMediaTimestamp = 0;
  let responseStartMediaTimestamp = null;
  let currentAssistantItemId = null;
  let currentResponseId = null;
  let pendingPlaybackMark = null;
  let openAiConnectionStarted = false;
  let callerContext = null; // Persistent user context from previous calls
  let activeProfilePhoneNumber = null; // Context anchor (can switch to end-client number for CPO calls)
  let latestUserTurn = 0;
  let stationRevision = 0;
  let currentStationMention = null;
  let escalationState = 'none';
  const qrCodeDeliveries = new Map();
  const conversationLanguage = new ConversationLanguage('fr');
  let callMemory = null; // Short-term session memory (Task 2)
  let toolCallBuffer = []; // Buffer for parallel tool call batching (Task 6)
  const processedToolCallIds = new Set();
  const processedUserItemIds = new Set();
  const loggedAssistantItemIds = new Set();
  const interruptedAssistantItemIds = new Set();
  const pendingAssistantTranscripts = new Map();

  const parseMs = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const ECHO_COOLDOWN_MS = parseMs(process.env.ECHO_COOLDOWN_MS, 300);

  const createVoiceResponseEvent = (extraInstruction = '') =>
    createLanguageResponseEvent(conversationLanguage.current, extraInstruction);

  const requestVoiceResponse = (extraInstruction = '') => {
    if (openAiWs?.readyState !== WebSocket.OPEN) return false;
    if (azureResponseActive) {
      queuedResponseInstruction = extraInstruction || queuedResponseInstruction || '';
      return false;
    }
    azureResponseActive = true;
    openAiWs.send(JSON.stringify(createVoiceResponseEvent(extraInstruction)));
    return true;
  };

  const drainQueuedResponse = () => {
    if (queuedResponseInstruction === null || azureResponseActive) return;
    const instruction = queuedResponseInstruction;
    queuedResponseInstruction = null;
    requestVoiceResponse(instruction);
  };

  const commitAssistantTranscript = (text, itemId = null) => {
    if (!text) return;
    const normalizedText = text.trim();
    if (!normalizedText) return;
    if (itemId && loggedAssistantItemIds.has(itemId)) return;
    if (itemId && interruptedAssistantItemIds.has(itemId)) return;

    if (itemId) loggedAssistantItemIds.add(itemId);
    if (/\b(?:collègue|agent humain|conseiller humain|human agent)\b|(?:موظف|وكيل|إنسان|انسان)/iu.test(normalizedText) && escalationState !== 'executed') {
      escalationState = 'offered';
    }
    logger.info(`Assistant: ${normalizedText}`);
    if (chatwootLogger) chatwootLogger.logAssistant(normalizedText);
    if (callMemory) callMemory.addAssistantMessage(normalizedText);
  };

  const logAssistantTranscript = (text, itemId = null) => {
    if (itemId && interruptedAssistantItemIds.has(itemId)) return;
    if (itemId && (itemId === currentAssistantItemId || isResponseActive || waitingForPlaybackDrain)) {
      pendingAssistantTranscripts.set(itemId, text);
      return;
    }
    commitAssistantTranscript(text, itemId);
  };

  // Connect to OpenAI Realtime API
  const connectToOpenAI = () => {
    if (openAiConnectionStarted) return;
    openAiConnectionStarted = true;
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

    const transcriptionConfig = createTranscriptionConfig({ tenant: callerContext?.tenant });
    const hasExplicitTranscriptionDeployment = Boolean(
      process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT
      || process.env.AZURE_OPENAI_TRANSCRIPTION_MODEL
    );
    const logTranscriptionDeployment = hasExplicitTranscriptionDeployment ? logger.info.bind(logger) : logger.warn.bind(logger);
    logTranscriptionDeployment(
      `Using Azure transcription deployment: ${transcriptionConfig.model}${hasExplicitTranscriptionDeployment ? '' : ' (default; configure AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT if your Azure deployment has another name)'}`
    );

    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: dynamicInstructions,
        voice: OPENAI_CONFIG.voice,
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: transcriptionConfig,
        turn_detection: {
          ...OPENAI_CONFIG.turn_detection,
          create_response: false,
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

  const registerLocationReplySession = () => {
    if (!callerNumber) return;
    setSession(callerNumber, {
      openAiWs,
      callSid,
      streamSid,
      onLocationInjected: ({ station, address, coordinates }) => {
        latestUserTurn++;
        const locationKey = station || address || coordinates;
        if (locationKey && String(locationKey).toLowerCase() !== currentStationMention?.toLowerCase()) {
          currentStationMention = String(locationKey);
          stationRevision++;
          if (callMemory?.updateStation) callMemory.updateStation(String(locationKey));
        }
        requestVoiceResponse('La localisation provient du SMS du client. Répondez sans changer de langue.');
      }
    });
  };

  const sendLocationSms = async () => {
    const twilioClient = getTwilioClient();
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
    if (!twilioClient || !callerNumber || !twilioPhone) {
      return { success: false, error: 'SMS delivery is not configured for this call.' };
    }

    try {
      const message = await twilioClient.messages.create({
        body: 'ev24 - Répondez avec votre adresse ou votre position GPS pour trouver la borne la plus proche.',
        from: twilioPhone,
        to: callerNumber
      });
      registerLocationReplySession();
      logger.info(`Location SMS sent to ${callerNumber}`);
      return { success: true, message: 'Location SMS sent.', messageSid: message.sid };
    } catch (error) {
      logger.error(`Failed to send location SMS: ${error.message}`);
      return { success: false, error: `Location SMS failed: ${error.message}` };
    }
  };

  // Handle tool calls from OpenAI and execute n8n webhooks
  const handleToolCall = async (toolCall, { continueResponse = true } = {}) => {
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
        if (continueResponse) requestVoiceResponse();
        return;
      }
      
      // Handle request_location_tool locally — send SMS via Twilio, don't go through n8n
      if (name === 'request_location_tool') {
        if (callMemory) {
          callMemory.addToolCall(name, args, null);
        }
        const smsResult = await sendLocationSms();
        const toolResponse = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call_id,
            output: JSON.stringify(smsResult)
          }
        };
        openAiWs.send(JSON.stringify(toolResponse));
        if (continueResponse) requestVoiceResponse();
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
      if (continueResponse) requestVoiceResponse();
      
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
      if (continueResponse) requestVoiceResponse();
    }
  };

  // Flush buffered tool calls with parallel execution (Task 6)
  const flushToolCallBuffer = async () => {
    const buffer = toolCallBuffer;
    toolCallBuffer = [];

    if (buffer.length === 0) return;

    logger.info(`Flushing ${buffer.length} tool call(s) in parallel`);

    // Separate local tools from n8n tools
    const localTools = buffer.filter(tc => tc.name === 'save_caller_info' || tc.name === 'request_location_tool');
    const n8nTools = buffer.filter(tc => tc.name !== 'save_caller_info' && tc.name !== 'request_location_tool');

    // Process local tools immediately
    for (const tc of localTools) {
      if (tc.userTurn !== latestUserTurn || tc.stationRevision !== stationRevision) {
        openAiWs.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: tc.call_id,
            output: JSON.stringify({
              success: false,
              error: 'This tool call is stale because the caller provided newer information.'
            })
          }
        }));
      } else {
        await handleToolCall(tc, { continueResponse: false });
      }
    }

    if (n8nTools.length === 0) {
      if (openAiWs?.readyState === WebSocket.OPEN) {
        requestVoiceResponse();
      }
      return;
    }

    // Execute n8n tools in parallel
    const validN8nTools = [];
    for (const tc of n8nTools) {
      try {
        const parsedTool = {
          toolCall: tc,
          name: tc.name,
          args: JSON.parse(tc.arguments),
          callId: tc.call_id
        };
        let blockedReason = null;
        if (tc.userTurn !== latestUserTurn || tc.stationRevision !== stationRevision) {
          blockedReason = 'This tool call is stale because the caller provided newer information. Re-evaluate the latest request.';
        } else if (tc.name === 'priority' && escalationState !== 'consented') {
          blockedReason = 'Human escalation requires explicit caller consent. Ask once and wait for a clear yes before retrying.';
        }

        if (blockedReason) {
          openAiWs.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: tc.call_id,
              output: JSON.stringify({ success: false, error: blockedReason })
            }
          }));
        } else {
          validN8nTools.push(parsedTool);
        }
      } catch {
        await handleToolCall(tc, { continueResponse: false });
      }
    }

    if (validN8nTools.length === 0) {
      if (openAiWs?.readyState === WebSocket.OPEN) {
        requestVoiceResponse();
      }
      return;
    }

    const results = await executeN8nToolsParallel(
      validN8nTools.map(({ name, args, callId }) => ({ name, args, callId })),
      { callSid, streamSid, callerNumber }
    );

    // Feed results to memory and send back to OpenAI
    for (const { toolCall: tc, args } of validN8nTools) {
      let result = results[tc.call_id] || { success: false, error: 'No result' };

      if (tc.userTurn !== latestUserTurn || tc.stationRevision !== stationRevision) {
        result = {
          success: false,
          stale: true,
          error: 'Ignored stale tool result because the caller provided newer information.'
        };
      }

      if (tc.name === 'generate_qr_code' && result.success !== false) {
        const deliveryKey = buildQrRequestKey(args);
        const deliveryState = qrCodeDeliveries.get(deliveryKey);
        if (deliveryState) {
          result = {
            success: true,
            alreadySent: true,
            message: deliveryState === 'sent'
              ? 'The QR-code SMS for this station and connector was already sent during this call.'
              : 'The QR-code SMS for this station and connector is already being sent.'
          };
        } else {
          qrCodeDeliveries.set(deliveryKey, 'sending');
          result = await sendQrCodeSms({
            result,
            twilioClient: getTwilioClient(),
            from: process.env.TWILIO_PHONE_NUMBER,
            to: callerNumber
          });
          if (result.success) {
            qrCodeDeliveries.set(deliveryKey, 'sent');
          } else {
            qrCodeDeliveries.delete(deliveryKey);
          }
        }
      }

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
        escalationState = 'executed';
        logger.info(`Human callback requested for caller ${callerNumber}. Reason: ${args.reason || 'Not specified'}`);
        if (chatwootLogger) {
          chatwootLogger.markHumanEscalation();
        }
      }
    }

    // Trigger OpenAI to continue after all results
    if (openAiWs?.readyState === WebSocket.OPEN) {
      requestVoiceResponse();
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
        // Start the greeting before flushing startup audio. Any caller speech then
        // naturally interrupts it instead of creating two simultaneous responses.
        sendInitialGreeting();
        processAudioQueue();
        break;

      case 'response.created':
        azureResponseActive = true;
        currentResponseId = message.response?.id || currentResponseId;
        break;

      case 'response.output_item.added':
        if (message.item?.type === 'message') {
          currentAssistantItemId = message.item.id || currentAssistantItemId;
        }
        break;

      case 'response.audio.delta':
      case 'response.output_audio.delta':
        if (!isResponseActive) {
          responseStartMediaTimestamp = latestMediaTimestamp;
        }
        isResponseActive = true;
        waitingForPlaybackDrain = true;
        currentAssistantItemId = message.item_id || currentAssistantItemId;
        currentResponseId = message.response_id || currentResponseId;
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
        // Send a mark event to ensure Twilio plays all buffered audio before we consider response complete
        if (streamSid && connection.socket.readyState === WebSocket.OPEN) {
          pendingPlaybackMark = `response-complete:${currentResponseId || currentAssistantItemId || Date.now()}`;
          connection.socket.send(JSON.stringify({
            event: 'mark',
            streamSid: streamSid,
            mark: { name: pendingPlaybackMark }
          }));
        } else {
          if (currentAssistantItemId && pendingAssistantTranscripts.has(currentAssistantItemId)) {
            commitAssistantTranscript(pendingAssistantTranscripts.get(currentAssistantItemId), currentAssistantItemId);
            pendingAssistantTranscripts.delete(currentAssistantItemId);
          }
          waitingForPlaybackDrain = false;
          isResponseActive = false;
          echoCooldownUntil = Date.now() + ECHO_COOLDOWN_MS;
        }
        break;

      case 'input_audio_buffer.speech_started':
        {
        const now = Date.now();
        // Cancel silence timer — user is speaking (Task 7)
        // Echo suppression: ignore speech detection shortly after AI finishes speaking
        if (now < echoCooldownUntil && !isResponseActive && !waitingForPlaybackDrain) {
          logger.info('Ignoring speech_started during echo cooldown');
          break;
        }

        logger.info('User started speaking - interrupting AI');
        if (currentAssistantItemId) {
          interruptedAssistantItemIds.add(currentAssistantItemId);
          pendingAssistantTranscripts.delete(currentAssistantItemId);
        }
        if (
          currentAssistantItemId &&
          responseStartMediaTimestamp !== null &&
          openAiWs?.readyState === WebSocket.OPEN
        ) {
          const audioEndMs = Math.max(0, latestMediaTimestamp - responseStartMediaTimestamp);
          openAiWs.send(JSON.stringify({
            type: 'conversation.item.truncate',
            item_id: currentAssistantItemId,
            content_index: 0,
            audio_end_ms: audioEndMs
          }));
          logger.info(`Truncated interrupted assistant audio at ${audioEndMs}ms`);
        }
        // Clear Twilio's audio buffer immediately when user speaks
        if (streamSid && connection.socket.readyState === WebSocket.OPEN) {
          connection.socket.send(JSON.stringify({
            event: 'clear',
            streamSid: streamSid
          }));
        }
        // Cancel OpenAI's ongoing response
        if (azureResponseActive && isResponseActive && openAiWs?.readyState === WebSocket.OPEN) {
          openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
        }
        isResponseActive = false;
        waitingForPlaybackDrain = false;
        pendingPlaybackMark = null;
        currentAssistantItemId = null;
        currentResponseId = null;
        responseStartMediaTimestamp = null;
        echoCooldownUntil = now + ECHO_COOLDOWN_MS;
        break;
        }

      case 'conversation.item.input_audio_transcription.completed':
        if (message.transcript) {
          if (message.item_id && processedUserItemIds.has(message.item_id)) break;
          if (message.item_id) processedUserItemIds.add(message.item_id);

          if (isLikelyTranscriptHallucination(message.transcript)) {
            logger.warn({ itemId: message.item_id, transcript: message.transcript }, 'Rejected likely transcription hallucination');
            if (message.item_id && openAiWs?.readyState === WebSocket.OPEN) {
              openAiWs.send(JSON.stringify({
                type: 'conversation.item.delete',
                item_id: message.item_id
              }));
            }
            break;
          }

          latestUserTurn++;
          conversationLanguage.observe(message.transcript);

          if (requestsHumanAgent(message.transcript)) {
            escalationState = 'consented';
          } else if (escalationState === 'offered') {
            escalationState = isAffirmativeResponse(message.transcript) ? 'consented' : 'none';
          } else if (escalationState === 'consented') {
            escalationState = 'none';
          }

          const stationMention = extractStationMention(message.transcript);
          if (stationMention && stationMention.toLowerCase() !== currentStationMention?.toLowerCase()) {
            currentStationMention = stationMention;
            stationRevision++;
            if (callMemory?.updateStation) callMemory.updateStation(stationMention);
            logger.info(`Station context changed to "${stationMention}" (revision ${stationRevision})`);
          }

          logger.info(`User: ${message.transcript}`);
          if (chatwootLogger) {
            chatwootLogger.logUser(message.transcript);
          }
          // Feed to short-term memory (Task 2)
          if (callMemory) {
            callMemory.addUserMessage(message.transcript);
          }
          if (needsLocationSms(message.transcript)) {
            sendLocationSms().then(result => {
              requestVoiceResponse(result.success
                ? 'Dites uniquement : « Je viens de vous envoyer un SMS. Répondez-y avec votre adresse ou votre position. »'
                : 'Dites uniquement : « Je n’ai pas pu envoyer le SMS. Pouvez-vous me donner une ville ou une adresse approximative ? »');
            });
            break;
          }

          if (needsQrFallback(message.transcript)) {
            requestVoiceResponse('Le client n’a ni application ni RFID. N’inventez aucune option invité ou paiement sans contact. Demandez uniquement le numéro du connecteur s’il manque; dès que la station et le connecteur sont connus, appelez generate_qr_code pour envoyer le lien par SMS.');
            break;
          }

          requestVoiceResponse();
        }
        break;

      case 'conversation.item.input_audio_transcription.failed':
        logger.warn({
          itemId: message.item_id,
          code: message.error?.code,
          error: message.error?.message
        }, 'Caller transcription failed');
        if (message.item_id && openAiWs?.readyState === WebSocket.OPEN) {
          openAiWs.send(JSON.stringify({
            type: 'conversation.item.delete',
            item_id: message.item_id
          }));
        }
        requestVoiceResponse('Dites uniquement : « Je vous entends mal, pouvez-vous répéter ? »');
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
        logAssistantTranscript(message.transcript, message.item_id);
        break;

      case 'response.done':
        azureResponseActive = false;
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
                  logAssistantTranscript(content.text, output.id);
                } else if (content.type === 'audio' && content.transcript) {
                  logAssistantTranscript(content.transcript, output.id);
                }
              });
            }
            // Function calls are handled via response.function_call_arguments.done
            // (with batching in Task 6) — skip here to avoid duplicate execution
          });
        }
        if (toolCallBuffer.length > 0) {
          queuedResponseInstruction = null;
          flushToolCallBuffer().catch(error => {
            logger.error(`Failed to flush tool calls: ${error.message}`);
          });
        } else {
          drainQueuedResponse();
        }
        break;

      case 'response.function_call_arguments.done':
        // Handle function call when arguments are complete
        if (message.name && message.call_id) {
          if (processedToolCallIds.has(message.call_id)) {
            logger.info(`Skipping duplicate tool call ${message.call_id}`);
            break;
          }
          processedToolCallIds.add(message.call_id);
          // Buffer for parallel execution (Task 6)
          toolCallBuffer.push({
            name: message.name,
            arguments: message.arguments,
            call_id: message.call_id,
            userTurn: latestUserTurn,
            stationRevision
          });
        }
        break;

      case 'error':
        if (/cancellation failed: no active response/i.test(message.error?.message || '')) {
          azureResponseActive = false;
          break;
        }
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
    const greetingInstruction = callerContext?.name
      ? `Saluez brièvement ${callerContext.name} en français, présentez-vous comme Eva du service client ev24, puis demandez comment aider aujourd'hui. Ne mentionnez aucun ancien problème.`
      : 'Saluez brièvement en français, présentez-vous comme Eva du service client ev24, puis demandez comment aider. Ne demandez ni nom ni numéro client.';
    requestVoiceResponse(greetingInstruction);
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
          // Caller metadata must be available before session instructions are built.
          connectToOpenAI();
          break;

        case 'media':
          latestMediaTimestamp = Number.parseInt(message.media.timestamp, 10) || latestMediaTimestamp;
          // Forward audio to OpenAI
          if (isOpenAiReady) {
            sendAudioToOpenAI(message.media.payload);
          } else {
            // Queue audio if OpenAI isn't ready yet
            audioQueue.push(message.media.payload);
          }
          break;

        case 'mark':
          if (pendingPlaybackMark && message.mark?.name === pendingPlaybackMark) {
            const playedItemId = currentAssistantItemId;
            if (playedItemId && pendingAssistantTranscripts.has(playedItemId)) {
              commitAssistantTranscript(pendingAssistantTranscripts.get(playedItemId), playedItemId);
              pendingAssistantTranscripts.delete(playedItemId);
            }
            waitingForPlaybackDrain = false;
            isResponseActive = false;
            echoCooldownUntil = Date.now() + ECHO_COOLDOWN_MS;
            pendingPlaybackMark = null;
            currentAssistantItemId = null;
            currentResponseId = null;
            responseStartMediaTimestamp = null;
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
    toolCallBuffer = [];
    
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

  const locationText = station
    ? `Caller replied via SMS with location ${coordinates}. A station lookup found "${station}" at ${address}${distance ? `, ${distance} km away` : ''}. Tell the caller about this result.`
    : `Caller replied via SMS with this location: "${coordinates || address}". No nearest-station lookup has been completed yet. Use the available station lookup tools or ask for clarification; do not invent a station or distance.`;

  session.openAiWs.send(JSON.stringify({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{
        type: 'input_text',
        text: `[CALLER SMS LOCATION DATA: ${locationText}]`
      }]
    }
  }));
  if (session.onLocationInjected) {
    session.onLocationInjected({ station, address, distance, coordinates });
  }
  removeSession(phone);
  return { success: true };
}
