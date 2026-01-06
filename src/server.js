import Fastify from 'fastify';
import fastifyWs from '@fastify/websocket';
import fastifyFormBody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleTwilioWebSocket } from './handlers/twilioHandler.js';
import { handleWebBrowserWebSocket } from './handlers/webHandler.js';
import { generateTwiML } from './utils/twiml.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({ 
  logger: true,
  trustProxy: true
});

// Register plugins
await fastify.register(fastifyFormBody);
await fastify.register(fastifyWs);

// Serve static files (web client)
await fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/'
});

// Health check endpoint
fastify.get('/api/health', async (request, reply) => {
  return { 
    status: 'ok', 
    service: 'GPT Realtime Voice Agent',
    timestamp: new Date().toISOString()
  };
});

// Health check for Azure
fastify.get('/health', async (request, reply) => {
  return { status: 'healthy' };
});

// Twilio webhook - returns TwiML to connect call to WebSocket
fastify.all('/incoming-call', async (request, reply) => {
  const host = request.headers.host;
  const protocol = request.headers['x-forwarded-proto'] || 'https';
  const wsUrl = `wss://${host}/media-stream`;
  
  fastify.log.info(`Incoming call - WebSocket URL: ${wsUrl}`);
  
  const twiml = generateTwiML(wsUrl);
  
  reply.type('text/xml');
  return twiml;
});

// WebSocket endpoint for Twilio Media Streams
fastify.register(async function (fastify) {
  fastify.get('/media-stream', { websocket: true }, (connection, req) => {
    fastify.log.info('Twilio WebSocket connection established');
    handleTwilioWebSocket(connection, fastify.log);
  });
});

// WebSocket endpoint for Web Browser clients
fastify.register(async function (fastify) {
  fastify.get('/web-stream', { websocket: true }, (connection, req) => {
    fastify.log.info('Web Browser WebSocket connection established');
    handleWebBrowserWebSocket(connection, fastify.log);
  });
});

// Start server
const start = async () => {
  try {
    const port = process.env.PORT || 8080;
    const host = process.env.HOST || '0.0.0.0';
    
    await fastify.listen({ port, host });
    
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║           GPT Realtime Voice Agent Started                   ║
╠══════════════════════════════════════════════════════════════╣
║  Server running on: http://${host}:${port}                      ║
║                                                              ║
║  📞 Twilio:                                                  ║
║     WebSocket: wss://your-domain/media-stream                ║
║     Webhook: https://your-domain/incoming-call               ║
║                                                              ║
║  🌐 Web Browser Testing:                                     ║
║     Open: http://localhost:${port}                              ║
║     WebSocket: wss://your-domain/web-stream                  ║
╚══════════════════════════════════════════════════════════════╝
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
