import WebSocket from 'ws';
import { OPENAI_CONFIG, VOICE_AGENT_INSTRUCTIONS } from '../config/openai.js';
import { TOOLS } from '../config/tools.js';
import { executeN8nTool } from '../services/n8nService.js';
import ChatwootLogger from '../services/chatwootLogger.js';

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
  let callerNumber = null;
  let isOpenAiReady = false;
  let audioQueue = [];
  let chatwootLogger = null;
  let isResponseActive = false; // Track if OpenAI is currently generating a response
  let isConversationClosed = false; // Prevent multiple close calls

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
        turn_detection: OPENAI_CONFIG.turn_detection,
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: OPENAI_CONFIG.voice,
        instructions: VOICE_AGENT_INSTRUCTIONS,
        modalities: ['text', 'audio'],
        temperature: OPENAI_CONFIG.temperature,
        max_response_output_tokens: OPENAI_CONFIG.max_response_output_tokens || 150,
        tools: TOOLS,
        tool_choice: 'auto',
        input_audio_transcription: {
          model: 'whisper-1',
          language: 'fr',
          prompt: 'Appel service client ev24, bornes de recharge véhicules électriques, Wattzhub CPO. Vocabulaire: borne, station, connecteur, prise, câble, RFID, badge, carte, recharger, démarrer, arrêter, kWh, facture, consommation, historique, paiement, tarif, application, compte. Lieux: Carrefour, relais, Leclerc, Auchan, Intermarché, parking, autoroute, Paris, Lyon, Marseille, Bordeaux, Toulouse. Réseaux: Borneco, Bornéco, ev24, Wattzhub, Horizon. Stations: Domaine de la Corniche, Station Relais. Phrases: ça ne marche pas, en panne, problème, souci, aide, je voudrais, pouvez-vous, ma borne, le connecteur est bloqué.'
        }
      }
    };

    openAiWs.send(JSON.stringify(sessionConfig));
    logger.info('Session configuration sent to OpenAI with tools and transcription enabled');
    
    // Immediately mark as ready and send greeting without waiting for session.updated
    isOpenAiReady = true;
    processAudioQueue();
  };

  // Handle tool calls from OpenAI and execute n8n webhooks
  const handleToolCall = async (toolCall) => {
    const { name, arguments: argsString, call_id } = toolCall;
    
    logger.info(`Tool call received: ${name} with call_id: ${call_id}`);
    
    try {
      const args = JSON.parse(argsString);
      logger.info(`Tool arguments: ${JSON.stringify(args)}`);
      
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
      openAiWs.send(JSON.stringify({ type: 'response.create' }));
      
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
      openAiWs.send(JSON.stringify({ type: 'response.create' }));
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
        // Send initial greeting immediately - no delay
        sendInitialGreeting();
        break;

      case 'response.audio.delta':
        isResponseActive = true; // Mark that a response is being generated
        // Send audio immediately to Twilio - no buffering for lowest latency
        if (message.delta && streamSid && connection.socket.readyState === WebSocket.OPEN) {
          connection.socket.send(JSON.stringify({
            event: 'media',
            streamSid: streamSid,
            media: { payload: message.delta }
          }));
        }
        break;

      case 'response.audio.done':
        logger.info('OpenAI audio response complete');
        // Send a mark event to ensure Twilio plays all buffered audio before we consider response complete
        if (streamSid && connection.socket.readyState === WebSocket.OPEN) {
          connection.socket.send(JSON.stringify({
            event: 'mark',
            streamSid: streamSid,
            mark: { name: 'response-complete' }
          }));
        }
        isResponseActive = false; // Mark that response is complete
        break;

      case 'input_audio_buffer.speech_started':
        logger.info('User started speaking');
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
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (message.transcript) {
          logger.info(`User: ${message.transcript}`);
          if (chatwootLogger) {
            chatwootLogger.logUser(message.transcript);
          }
        }
        break;

      case 'response.done':
        console.log('DEBUG: response.done event received');
        console.log('DEBUG: message.response?.output:', JSON.stringify(message.response?.output, null, 2));
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
    const greetingEvent = {
      type: 'response.create'
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
          
          // Log the entire start message to debug
          logger.info('Start message received:', JSON.stringify(message.start, null, 2));
          
          callerNumber = message.start.customParameters?.callerNumber || callSid;
          logger.info(`Stream started - StreamSid: ${streamSid}, CallSid: ${callSid}, Caller: ${callerNumber}`);
          logger.info(`CustomParameters:`, message.start.customParameters);
          
          chatwootLogger = new ChatwootLogger(`twilio-${callerNumber}`, callSid);
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
