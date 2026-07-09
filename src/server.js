import Fastify from 'fastify';
import fastifyWs from '@fastify/websocket';
import fastifyFormBody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';
import { handleTwilioWebSocket, injectLocation } from './handlers/twilioHandler.js';
import { handleWebBrowserWebSocket } from './handlers/webHandler.js';
import { generateTwiML } from './utils/twiml.js';
import { N8N_BASE_URL } from './config/tools.js';
import { findNearestStation, parseLocation } from './services/openChargeMapService.js';
import { runMigrations } from './config/database.js';
import { registerSupervisorHandlers } from './handlers/supervisorHandler.js';
import authRoutes from './routes/auth.js';
import conversationRoutes from './routes/conversations.js';
import supervisorRoutes from './routes/supervisor.js';
import analyticsRoutes from './routes/analytics.js';
import axios from 'axios';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({ 
  logger: true,
  trustProxy: true
});

// Register plugins
await fastify.register(fastifyCors, {
  origin: true,
  credentials: true
});
await fastify.register(fastifyFormBody);
await fastify.register(fastifyWs);

// Serve static files (web client + supervisor frontend build)
await fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/'
});

// Health check endpoint
fastify.get('/api/health', async (request, reply) => {
  return { 
    status: 'ok', 
    service: 'GPT Realtime Voice Agent + Supervisor',
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
  
  const callerNumber = request.body.From;
  const twilioNumber = request.body.To;
  const callSid = request.body.CallSid;
  
  console.log(`📞 Call from: ${callerNumber}`);
  fastify.log.info({ from: callerNumber, to: twilioNumber, callSid }, 'Incoming call');
  fastify.log.info(`Incoming call - WebSocket URL: ${wsUrl}`);
  
  const twiml = generateTwiML(wsUrl, callerNumber);
  reply.type('text/xml');
  return twiml;
});

// Stream ended endpoint
fastify.all('/stream-ended', async (request, reply) => {
  fastify.log.info('Stream ended callback received');
  reply.type('text/xml');
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
});

// SMS reply webhook
fastify.all('/sms-reply', async (request, reply) => {
  const { From, Body } = request.body;
  const callerNumber = From;
  fastify.log.info(`SMS reply from ${callerNumber}: "${Body}"`);

  const parsed = parseLocation(Body);
  let coordinates = null;
  let station = null;
  let address = null;
  let distance = null;

  if (parsed?.type === 'coordinates') {
    coordinates = `${parsed.lat}, ${parsed.lng}`;
    const result = await findNearestStation(parsed.lat, parsed.lng);
    if (result.success && result.nearest) {
      station = result.nearest.name;
      address = result.nearest.address;
      distance = result.nearest.distance;
      fastify.log.info(`Found nearest station: ${station} at ${address} (${distance}km)`);
    }
  } else {
    coordinates = Body;
    station = 'the location';
    address = Body;
    distance = 'unknown';
  }

  const injectResult = injectLocation(callerNumber, { station, address, distance, coordinates });
  if (!injectResult.success) {
    fastify.log.warn(`No active session for ${callerNumber} — SMS location not injected`);
  }

  reply.type('text/xml');
  return '<Response></Response>';
});

// Callback from n8n
fastify.post('/n8n-location-callback', async (request, reply) => {
  const result = injectLocation(request.body.callerNumber, request.body);
  return result;
});

// Forward call endpoint
fastify.all('/forward-call', async (request, reply) => {
  const forwardNumber = process.env.FORWARD_TO_NUMBER || '+21625522862';
  const twilioNumber = process.env.TWILIO_PHONE_NUMBER || request.body?.To || request.body?.Called;
  fastify.log.info(`Forward call endpoint hit - dialing ${forwardNumber}`);
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${twilioNumber}" timeout="60">${forwardNumber}</Dial>
</Response>`;
  reply.type('text/xml');
  return twiml;
});

// Register API routes
await fastify.register(authRoutes);
await fastify.register(conversationRoutes);
await fastify.register(supervisorRoutes);
await fastify.register(analyticsRoutes);

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
    // Run DB migrations
    try {
      await runMigrations();
    } catch (dbErr) {
      console.error('Database migration failed:', dbErr.message);
      console.warn('Supervisor features will be unavailable until DB is configured');
    }

    const port = process.env.PORT || 3000;
    const host = process.env.HOST || '0.0.0.0';
    
    await fastify.listen({ port, host });

    // Set up Socket.IO after Fastify is listening
    // Note: polling-only to avoid conflict with @fastify/websocket
    const io = new SocketIOServer(fastify.server, {
      cors: {
        origin: true,
        credentials: true
      },
      path: '/socket.io',
      transports: ['polling']
    });
    registerSupervisorHandlers(io);
    
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║     GPT Realtime Voice Agent + Supervisor Started            ║
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
║                                                              ║
║  🖥  Supervisor Dashboard:                                    ║
║     URL: http://localhost:${port}/supervisor/                   ║
║     Socket.IO: http://localhost:${port}/socket.io               ║
╚══════════════════════════════════════════════════════════════╝
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
