import WebSocket from 'ws';
import { OPENAI_CONFIG, VOICE_AGENT_INSTRUCTIONS } from '../config/openai.js';
import { TOOLS } from '../config/tools.js';
import { executeN8nTool } from '../services/n8nService.js';

// Build Azure OpenAI Realtime WebSocket URL
const getAzureRealtimeUrl = () => {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT.replace('https://', '');
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-10-01-preview';
  return `wss://${endpoint}/openai/realtime?api-version=${apiVersion}&deployment=${deployment}`;
};

export function handleTwilioWebSocket(connection, logger) {
  let openAiWs = null;
  let streamSid = null;
  let callSid = null;
  let isOpenAiReady = false;
  let audioQueue = [];

  // Connect to Azure OpenAI Realtime API
  const connectToOpenAI = () => {
    const azureUrl = getAzureRealtimeUrl();
    logger.info(`Connecting to Azure OpenAI: ${azureUrl}`);
    
    openAiWs = new WebSocket(azureUrl, {
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
        }, 'Azure OpenAI connection rejected');
      });
    });
  };

  // Initialize OpenAI session with configuration
  const initializeSession = () => {
    const sessionConfig = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad' },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: OPENAI_CONFIG.voice,
        instructions: VOICE_AGENT_INSTRUCTIONS,
        modalities: ['text', 'audio'],
        temperature: OPENAI_CONFIG.temperature,
        tools: TOOLS,
        tool_choice: 'auto',
      }
    };

    openAiWs.send(JSON.stringify(sessionConfig));
    logger.info('Session configuration sent to OpenAI with tools');
  };

  // Handle tool calls from OpenAI and execute n8n webhooks
  const handleToolCall = async (toolCall) => {
    const { name, arguments: argsString, call_id } = toolCall;
    
    logger.info(`Tool call received: ${name} with call_id: ${call_id}`);
    
    try {
      const args = JSON.parse(argsString);
      logger.info(`Tool arguments: ${JSON.stringify(args)}`);
      
      // Execute the n8n tool
      const result = await executeN8nTool(name, args, { callSid, streamSid });
      
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
      openAiWs.send(JSON.stringify({ type: 'response.create' }));
      
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
      openAiWs.send(JSON.stringify({ type: 'response.create' }));
    }
  };

  // Handle messages from OpenAI
  const handleOpenAiMessage = (message) => {
    switch (message.type) {
      case 'session.created':
        logger.info('OpenAI session created');
        isOpenAiReady = true;
        // Process any queued audio
        processAudioQueue();
        break;

      case 'session.updated':
        logger.info('OpenAI session updated');
        isOpenAiReady = true;
        // Send initial greeting
        sendInitialGreeting();
        break;

      case 'response.audio.delta':
        if (message.delta && streamSid) {
          // Send audio back to Twilio
          const audioMessage = {
            event: 'media',
            streamSid: streamSid,
            media: {
              payload: message.delta
            }
          };
          connection.socket.send(JSON.stringify(audioMessage));
        }
        break;

      case 'response.audio.done':
        logger.info('OpenAI audio response complete');
        break;

      case 'input_audio_buffer.speech_started':
        logger.info('User started speaking');
        // Clear Twilio's audio queue when user interrupts
        if (streamSid) {
          connection.socket.send(JSON.stringify({
            event: 'clear',
            streamSid: streamSid
          }));
        }
        // Cancel any ongoing OpenAI response when user interrupts
        if (openAiWs?.readyState === WebSocket.OPEN) {
          openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
        }
        break;

      case 'input_audio_buffer.speech_stopped':
        logger.info('User stopped speaking');
        break;

      case 'response.done':
        if (message.response?.output) {
          message.response.output.forEach(output => {
            if (output.type === 'message' && output.content) {
              output.content.forEach(content => {
                if (content.type === 'text') {
                  logger.info(`Assistant: ${content.text}`);
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
        logger.error('OpenAI error:', message.error);
        break;

      default:
        logger.debug(`OpenAI message type: ${message.type}`);
    }
  };

  // Send initial greeting to start conversation
  const sendInitialGreeting = () => {
    const greetingEvent = {
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        instructions: 'Dis exactement en français: "Bonjour ! Je suis l\'assistant wattzhub. Comment puis-je vous aider aujourd\'hui ?"'
      }
    };
    openAiWs.send(JSON.stringify(greetingEvent));
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
          logger.info(`Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}`);
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
  connection.socket.on('close', () => {
    logger.info('Twilio WebSocket closed');
    if (openAiWs?.readyState === WebSocket.OPEN) {
      openAiWs.close();
    }
  });

  // Handle Twilio WebSocket errors
  connection.socket.on('error', (error) => {
    logger.error('Twilio WebSocket error:', error);
  });
}
