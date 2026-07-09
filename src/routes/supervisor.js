import { authenticate, requireRole } from '../middleware/auth.js';
import { eventBus } from '../services/eventBus.js';
import { getConversationByExternalId, updateConversation, addMessage, logSupervisorEvent } from '../services/conversationStore.js';
import { ROLES } from '../config/auth.js';

// In-memory map: externalId → { openAiWs, connection (Twilio WS), callMemory, streamSid }
// Populated by twilioHandler.js / webHandler.js via eventBus
export const activeSessions = new Map();

export function registerSession(externalId, sessionData) {
  activeSessions.set(externalId, sessionData);
}

export function unregisterSession(externalId) {
  activeSessions.delete(externalId);
}

export function getSession(externalId) {
  return activeSessions.get(externalId);
}

export default async function supervisorRoutes(fastify) {
  // All supervisor routes require supervisor role or higher
  const supervisorOnly = [authenticate, requireRole(ROLES.ADMIN, ROLES.SUPERVISOR)];

  // POST /api/supervisor/barge-in — stop AI, inject supervisor message, pause AI
  fastify.post('/api/supervisor/barge-in', { preHandler: supervisorOnly }, async (request, reply) => {
    const { externalId, message } = request.body;
    if (!externalId || !message) {
      return reply.status(400).send({ error: 'externalId and message required' });
    }

    const session = getSession(externalId);
    if (!session) {
      return reply.status(404).send({ error: 'No active session for this conversation' });
    }

    const { openAiWs, connection, callMemory, streamSid } = session;

    // Cancel ongoing AI response
    if (openAiWs?.readyState === 1) {
      openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
    }

    // Clear Twilio audio buffer
    if (connection?.socket?.readyState === 1 && streamSid) {
      connection.socket.send(JSON.stringify({ event: 'clear', streamSid }));
    }

    // Pause AI
    if (callMemory) callMemory.aiPaused = true;

    // Inject supervisor message as user role
    const supervisorMsg = `[SUPERVISOR: ${request.user.name}]: ${message}`;
    if (openAiWs?.readyState === 1) {
      openAiWs.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: supervisorMsg }]
        }
      }));
    }

    // Store in DB
    try {
      const conv = await getConversationByExternalId(externalId);
      if (conv) {
        await addMessage({
          conversationId: conv.id,
          role: 'supervisor',
          content: message,
          contentType: 'text',
          metadata: { supervisorName: request.user.name, supervisorId: request.user.id }
        });
        await logSupervisorEvent({
          conversationId: conv.id,
          supervisorId: request.user.id,
          eventType: 'barge_in',
          payload: { message }
        });
        await updateConversation(conv.id, { status: 'paused', supervisor_id: request.user.id });
      }
    } catch (err) {
      fastify.log.error(`Failed to log barge-in to DB: ${err.message}`);
    }

    // Broadcast via eventBus
    eventBus.emitStatusChange(externalId, 'paused');
    eventBus.emitTranscript(externalId, {
      role: 'supervisor',
      content: message,
      supervisorName: request.user.name
    });

    reply.send({ success: true, status: 'paused', aiEnabled: false });
  });

  // POST /api/supervisor/toggle-ai — enable/disable AI
  fastify.post('/api/supervisor/toggle-ai', { preHandler: supervisorOnly }, async (request, reply) => {
    const { externalId, enabled } = request.body;
    if (externalId === undefined) {
      return reply.status(400).send({ error: 'externalId and enabled required' });
    }

    const session = getSession(externalId);
    if (!session) {
      return reply.status(404).send({ error: 'No active session' });
    }

    const { openAiWs, callMemory } = session;

    if (callMemory) callMemory.aiPaused = !enabled;

    if (openAiWs?.readyState === 1) {
      if (!enabled) {
        openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
      }
      openAiWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 200,
            create_response: enabled
          }
        }
      }));
    }

    // Store in DB
    try {
      const conv = await getConversationByExternalId(externalId);
      if (conv) {
        await updateConversation(conv.id, {
          ai_enabled: enabled,
          status: enabled ? 'active' : 'paused'
        });
        await logSupervisorEvent({
          conversationId: conv.id,
          supervisorId: request.user.id,
          eventType: 'toggle_ai',
          payload: { enabled }
        });
      }
    } catch (err) {
      fastify.log.error(`Failed to log toggle-ai: ${err.message}`);
    }

    eventBus.emitStatusChange(externalId, enabled ? 'active' : 'paused');
    eventBus.emitConversationUpdate(externalId, { aiEnabled: enabled });

    reply.send({ success: true, aiEnabled: enabled, status: enabled ? 'active' : 'paused' });
  });

  // POST /api/supervisor/inject — send a message as supervisor (AI stays paused)
  fastify.post('/api/supervisor/inject', { preHandler: supervisorOnly }, async (request, reply) => {
    const { externalId, message } = request.body;
    if (!externalId || !message) {
      return reply.status(400).send({ error: 'externalId and message required' });
    }

    const session = getSession(externalId);
    if (!session) {
      return reply.status(404).send({ error: 'No active session' });
    }

    const { openAiWs } = session;
    const supervisorMsg = `[SUPERVISOR: ${request.user.name}]: ${message}`;

    if (openAiWs?.readyState === 1) {
      openAiWs.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: supervisorMsg }]
        }
      }));
    }

    // Store in DB
    try {
      const conv = await getConversationByExternalId(externalId);
      if (conv) {
        await addMessage({
          conversationId: conv.id,
          role: 'supervisor',
          content: message,
          metadata: { supervisorName: request.user.name, supervisorId: request.user.id }
        });
        await logSupervisorEvent({
          conversationId: conv.id,
          supervisorId: request.user.id,
          eventType: 'inject_message',
          payload: { message }
        });
      }
    } catch (err) {
      fastify.log.error(`Failed to log inject: ${err.message}`);
    }

    eventBus.emitTranscript(externalId, {
      role: 'supervisor',
      content: message,
      supervisorName: request.user.name
    });

    reply.send({ success: true });
  });

  // POST /api/supervisor/takeover — full human takeover, disable AI entirely
  fastify.post('/api/supervisor/takeover', { preHandler: supervisorOnly }, async (request, reply) => {
    const { externalId } = request.body;
    if (!externalId) {
      return reply.status(400).send({ error: 'externalId required' });
    }

    const session = getSession(externalId);
    if (!session) {
      return reply.status(404).send({ error: 'No active session' });
    }

    const { openAiWs, connection, callMemory, streamSid } = session;

    if (openAiWs?.readyState === 1) {
      openAiWs.send(JSON.stringify({ type: 'response.cancel' }));
    }
    if (connection?.socket?.readyState === 1 && streamSid) {
      connection.socket.send(JSON.stringify({ event: 'clear', streamSid }));
    }
    if (callMemory) callMemory.aiPaused = true;
    if (callMemory) callMemory.takeover = true;

    try {
      const conv = await getConversationByExternalId(externalId);
      if (conv) {
        await updateConversation(conv.id, { ai_enabled: false, status: 'paused' });
        await logSupervisorEvent({
          conversationId: conv.id,
          supervisorId: request.user.id,
          eventType: 'takeover',
          payload: { supervisorName: request.user.name }
        });
      }
    } catch (err) {
      fastify.log.error(`Failed to log takeover: ${err.message}`);
    }

    eventBus.emitStatusChange(externalId, 'takeover');
    eventBus.emitConversationUpdate(externalId, { aiEnabled: false, takeover: true });

    reply.send({ success: true, takeover: true, aiEnabled: false });
  });

  // GET /api/supervisor/active-sessions — list active conversations
  fastify.get('/api/supervisor/active-sessions', { preHandler: [authenticate] }, async (request, reply) => {
    const sessions = [];
    for (const [externalId, data] of activeSessions.entries()) {
      sessions.push({
        externalId,
        aiPaused: data.callMemory?.aiPaused || false,
        takeover: data.callMemory?.takeover || false,
        isActive: data.openAiWs?.readyState === 1
      });
    }
    reply.send(sessions);
  });
}
