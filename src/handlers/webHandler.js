import WebSocket from 'ws';
import { OPENAI_CONFIG, VOICE_AGENT_INSTRUCTIONS, createTranscriptionConfig } from '../config/openai.js';
import { TOOLS } from '../config/tools.js';
import { executeN8nTool } from '../services/n8nService.js';
import ChatwootLogger from '../services/chatwootLogger.js';
import { billVoiceUsage } from '../services/billingService.js';
import {
  ConversationLanguage,
  createLanguageResponseEvent,
  isLikelyTranscriptHallucination,
  needsQrFallback
} from '../services/conversationQuality.js';

// Build Azure OpenAI Realtime WebSocket URL
const getAzureOpenAIRealtimeUrl = () => {
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || OPENAI_CONFIG.model;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-10-01-preview';
  return `${endpoint}/openai/realtime?api-version=${apiVersion}&deployment=${deployment}`;
};

export function handleWebBrowserWebSocket(connection, logger) {
  let openAiWs = null;
  let sessionId = `web-${Date.now()}`;
  let isOpenAiReady = false;
  let audioQueue = [];
  let processedToolCalls = new Set(); // Track processed tool calls to prevent duplicates
  let processedUserItems = new Set();
  let loggedAssistantItems = new Set();
  let chatwootLogger = new ChatwootLogger(sessionId);
  let isResponseActive = false; // Track if OpenAI is currently generating a response
  let azureResponseActive = false;
  let queuedResponseInstruction = null;
  const conversationLanguage = new ConversationLanguage('fr');
  const webInstructions = `${VOICE_AGENT_INSTRUCTIONS}\n\n## WEB CHANNEL OVERRIDE\nThe QR-code-by-SMS path is unavailable in browser sessions because there is no caller phone number. Never promise or attempt a QR SMS in this channel; offer app/RFID guidance or human assistance instead.`;

  logger.info(`Web browser client connected - Session: ${sessionId}`);

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
      logger.info('Connected to Azure OpenAI Realtime API (Web Client)');
      initializeSession();
    });

    openAiWs.on('message', (data) => {
      handleOpenAiMessage(JSON.parse(data.toString()));
    });

    openAiWs.on('error', (error) => {
      logger.error({ err: error, message: error.message }, 'Azure OpenAI WebSocket error');
      sendToClient({ type: 'error', message: 'Azure OpenAI connection error' });
    });

    openAiWs.on('close', (code, reason) => {
      logger.info(`Azure OpenAI WebSocket closed: ${code} - ${reason.toString()}`);
      isOpenAiReady = false;
      sendToClient({ type: 'status', status: 'disconnected' });
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
        sendToClient({ type: 'error', message: 'Azure OpenAI connection rejected' });
      });
    });
  };

  // Initialize OpenAI session with PCM16 audio format (for web browsers)
  const initializeSession = () => {
    const transcriptionConfig = createTranscriptionConfig();
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
        instructions: webInstructions,
        voice: OPENAI_CONFIG.voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: transcriptionConfig,
        turn_detection: {
          ...OPENAI_CONFIG.turn_detection,
          create_response: false,
          interrupt_response: true
        },
        max_response_output_tokens: OPENAI_CONFIG.max_response_output_tokens || 'inf',
        tools: TOOLS.filter(tool => tool.name !== 'generate_qr_code'),
        tool_choice: 'auto'
      }
    };

    openAiWs.send(JSON.stringify(sessionConfig));
    logger.info('Session configuration sent to Azure OpenAI (Web Client - PCM16 format with transcription)');
  };

  // Send message to web client
  const sendToClient = (message) => {
    if (connection.socket.readyState === WebSocket.OPEN) {
      connection.socket.send(JSON.stringify(message));
    }
  };

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

  const logAssistantTranscript = (text, itemId = null) => {
    if (!text) return false;
    const normalizedText = text.trim();
    if (!normalizedText) return false;
    if (itemId && loggedAssistantItems.has(itemId)) return false;

    if (itemId) loggedAssistantItems.add(itemId);
    logger.info(`Assistant (Web): ${normalizedText}`);
    if (chatwootLogger) chatwootLogger.logAssistant(normalizedText);
    sendToClient({ type: 'transcript', role: 'assistant', text: normalizedText });
    return true;
  };

  // Handle tool calls from OpenAI
  const handleToolCall = async (toolCall) => {
    const { name, arguments: argsString, call_id } = toolCall;
    
    // Prevent duplicate tool calls
    if (processedToolCalls.has(call_id)) {
      logger.info(`Skipping duplicate tool call: ${name} with call_id: ${call_id}`);
      return;
    }
    processedToolCalls.add(call_id);
    
    logger.info(`Tool call received: ${name} with call_id: ${call_id}`);
    sendToClient({ type: 'tool_call', name, status: 'executing' });
    
    try {
      const args = JSON.parse(argsString);
      logger.info(`Tool arguments: ${JSON.stringify(args)}`);
      
      const result = await executeN8nTool(name, args, { sessionId });
      
      logger.info(`Tool ${name} result: ${JSON.stringify(result)}`);
      sendToClient({ type: 'tool_call', name, status: 'completed', result });
      
      const toolResponse = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify(result)
        }
      };
      
      openAiWs.send(JSON.stringify(toolResponse));
      requestVoiceResponse();
      
    } catch (error) {
      logger.error(`Error handling tool call ${name}:`, error);
      sendToClient({ type: 'tool_call', name, status: 'error', error: error.message });
      
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
      requestVoiceResponse();
    }
  };

  // Handle messages from OpenAI
  const handleOpenAiMessage = (message) => {
    switch (message.type) {
      case 'session.created':
        logger.info('Azure OpenAI session created (Web Client)');
        break;

      case 'session.updated':
        logger.info('Azure OpenAI session updated (Web Client)');
        isOpenAiReady = true;
        processAudioQueue();
        sendToClient({ type: 'status', status: 'ready' });
        sendInitialGreeting();
        break;

      case 'response.created':
        azureResponseActive = true;
        break;

      case 'response.audio.delta':
      case 'response.output_audio.delta':
        isResponseActive = true; // Mark that a response is being generated
        if (message.delta) {
          // Send audio back to web client
          sendToClient({
            type: 'audio',
            audio: message.delta
          });
        }
        break;

      case 'response.audio.done':
      case 'response.output_audio.done':
        logger.info('Azure OpenAI audio response complete');
        sendToClient({ type: 'audio_done' });
        isResponseActive = false; // Mark that response is complete
        break;

      case 'input_audio_buffer.speech_started':
        logger.info('User started speaking (Web Client)');
        sendToClient({ type: 'speech_started' });
        // Cancel any ongoing response when user interrupts (only if there's an active response)
        if (azureResponseActive && isResponseActive && openAiWs?.readyState === WebSocket.OPEN) {
          openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
          logger.info('Cancelled active OpenAI response due to user interruption');
        }
        break;

      case 'input_audio_buffer.speech_stopped':
        logger.info('User stopped speaking (Web Client)');
        sendToClient({ type: 'speech_stopped' });
        break;

      case 'response.text.delta':
      case 'response.output_text.delta':
        if (message.delta) {
          sendToClient({ type: 'text_delta', text: message.delta });
        }
        break;

      case 'response.output_audio_transcript.delta':
        if (message.delta) {
          sendToClient({ type: 'text_delta', text: message.delta });
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
            // Note: function_call is handled by response.function_call_arguments.done
          });
        }
        sendToClient({ type: 'response_done' });
        drainQueuedResponse();
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (message.transcript) {
          if (message.item_id && processedUserItems.has(message.item_id)) break;
          if (message.item_id) processedUserItems.add(message.item_id);
          if (isLikelyTranscriptHallucination(message.transcript)) {
            logger.warn({ itemId: message.item_id, transcript: message.transcript }, 'Rejected likely web transcription hallucination');
            if (message.item_id && openAiWs?.readyState === WebSocket.OPEN) {
              openAiWs.send(JSON.stringify({
                type: 'conversation.item.delete',
                item_id: message.item_id
              }));
            }
            break;
          }
          conversationLanguage.observe(message.transcript);
          logger.info(`User (Web): ${message.transcript}`);
          if (chatwootLogger) {
            chatwootLogger.logUser(message.transcript);
          }
          sendToClient({ type: 'transcript', role: 'user', text: message.transcript });
          if (needsQrFallback(message.transcript)) {
            requestVoiceResponse('Le client n’a ni application ni RFID. Dans le navigateur, dites clairement que l’envoi du QR par SMS nécessite un appel téléphonique et ne proposez aucune option inventée.');
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
        }, 'Web caller transcription failed');
        sendToClient({ type: 'transcription_failed' });
        if (message.item_id && openAiWs?.readyState === WebSocket.OPEN) {
          openAiWs.send(JSON.stringify({
            type: 'conversation.item.delete',
            item_id: message.item_id
          }));
        }
        requestVoiceResponse('Dites uniquement : « Je vous entends mal, pouvez-vous répéter ? »');
        break;

      case 'response.function_call_arguments.done':
        if (message.name && message.call_id) {
          handleToolCall({
            name: message.name,
            arguments: message.arguments,
            call_id: message.call_id
          });
        }
        break;

      case 'error':
        if (/cancellation failed: no active response/i.test(message.error?.message || '')) {
          azureResponseActive = false;
          break;
        }
        logger.error('Azure OpenAI error:', message.error);
        sendToClient({ type: 'error', message: message.error?.message || 'Unknown error' });
        break;

      default:
        logger.debug(`Azure OpenAI message type (Web): ${message.type}`);
    }
  };

  // Send initial greeting
  const sendInitialGreeting = () => {
    requestVoiceResponse(
      'Saluez brièvement en français, présentez-vous comme Eva du service client ev24, puis demandez comment aider. Ne demandez ni nom ni numéro client.'
    );
    logger.info('Initial greeting triggered (Web Client)');
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

  // Start connection to OpenAI immediately
  connectToOpenAI();

  // Handle messages from Web Client
  connection.socket.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'audio':
          // Forward audio to OpenAI
          if (isOpenAiReady) {
            sendAudioToOpenAI(message.audio);
          } else {
            audioQueue.push(message.audio);
          }
          break;

        case 'ping':
          sendToClient({ type: 'pong' });
          break;

        case 'end_session':
          logger.info('Web client requested session end');
          if (openAiWs?.readyState === WebSocket.OPEN) {
            openAiWs.close();
          }
          break;

        default:
          logger.debug(`Web client event: ${message.type}`);
      }
    } catch (error) {
      logger.error('Error processing web client message:', error);
    }
  });

  // Handle WebSocket close
  connection.socket.on('close', async () => {
    logger.info('Web client WebSocket closed');
    if (chatwootLogger) {
      await chatwootLogger.close();
    }
    if (openAiWs?.readyState === WebSocket.OPEN) {
      openAiWs.close();
    }
  });

  // Handle WebSocket errors
  connection.socket.on('error', (error) => {
    logger.error('Web client WebSocket error:', error);
  });
}
