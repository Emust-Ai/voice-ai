import WebSocket from 'ws';
import { OPENAI_CONFIG, VOICE_AGENT_INSTRUCTIONS } from '../config/openai.js';
import { TOOLS } from '../config/tools.js';
import { executeN8nTool } from '../services/n8nService.js';
import ChatwootLogger from '../services/chatwootLogger.js';
import { billVoiceUsage } from '../services/billingService.js';

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
  let chatwootLogger = new ChatwootLogger(sessionId);
  let isResponseActive = false; // Track if OpenAI is currently generating a response

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
    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: VOICE_AGENT_INSTRUCTIONS,
        voice: OPENAI_CONFIG.voice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1',
          language: 'fr',
          prompt: 'Service client ev24. Vocabulaire: borne, station, connecteur, RFID, Wattzhub, BornEco, recharge, facture. Priorité: bien transcrire le prénom/nom du client.'
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
    logger.info('Session configuration sent to Azure OpenAI (Web Client - PCM16 format with transcription)');
  };

  // Send message to web client
  const sendToClient = (message) => {
    if (connection.socket.readyState === WebSocket.OPEN) {
      connection.socket.send(JSON.stringify(message));
    }
  };

  const createVoiceResponseEvent = () => ({
    type: 'response.create'
  });

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
      openAiWs.send(JSON.stringify(createVoiceResponseEvent()));
      
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
      openAiWs.send(JSON.stringify(createVoiceResponseEvent()));
    }
  };

  // Handle messages from OpenAI
  const handleOpenAiMessage = (message) => {
    switch (message.type) {
      case 'session.created':
        logger.info('Azure OpenAI session created (Web Client)');
        isOpenAiReady = true;
        processAudioQueue();
        break;

      case 'session.updated':
        logger.info('Azure OpenAI session updated (Web Client)');
        isOpenAiReady = true;
        sendToClient({ type: 'status', status: 'ready' });
        sendInitialGreeting();
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
        if (isResponseActive && openAiWs?.readyState === WebSocket.OPEN) {
          openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
          isResponseActive = false;
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
        if (message.transcript) {
          logger.info(`Assistant (Web): ${message.transcript}`);
          if (chatwootLogger) {
            chatwootLogger.logAssistant(message.transcript);
          }
          sendToClient({ type: 'transcript', role: 'assistant', text: message.transcript });
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
                  logger.info(`Assistant (Web): ${content.text}`);
                  if (chatwootLogger) {
                    chatwootLogger.logAssistant(content.text);
                  }
                  sendToClient({ type: 'transcript', role: 'assistant', text: content.text });
                } else if (content.type === 'audio' && content.transcript) {
                  logger.info(`Assistant (Web): ${content.transcript}`);
                  if (chatwootLogger) {
                    chatwootLogger.logAssistant(content.transcript);
                  }
                  sendToClient({ type: 'transcript', role: 'assistant', text: content.transcript });
                }
              });
            }
            // Note: function_call is handled by response.function_call_arguments.done
          });
        }
        sendToClient({ type: 'response_done' });
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (message.transcript) {
          logger.info(`User (Web): ${message.transcript}`);
          if (chatwootLogger) {
            chatwootLogger.logUser(message.transcript);
          }
          sendToClient({ type: 'transcript', role: 'user', text: message.transcript });
        }
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
        logger.error('Azure OpenAI error:', message.error);
        sendToClient({ type: 'error', message: message.error?.message || 'Unknown error' });
        break;

      default:
        logger.debug(`Azure OpenAI message type (Web): ${message.type}`);
    }
  };

  // Send initial greeting
  const sendInitialGreeting = () => {
    openAiWs.send(JSON.stringify(createVoiceResponseEvent()));
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
