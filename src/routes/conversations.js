import { authenticate } from '../middleware/auth.js';
import {
  listConversations, getConversation, getConversationByExternalId, getMessages,
  createConversation, updateConversation
} from '../services/conversationStore.js';

export default async function conversationRoutes(fastify) {
  fastify.get('/api/conversations', { preHandler: [authenticate] }, async (request, reply) => {
    const { status, limit, offset } = request.query;
    const conversations = await listConversations({
      status: status || undefined,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0
    });
    reply.send(conversations);
  });

  fastify.get('/api/conversations/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const isNumeric = /^\d+$/.test(id);
    const conversation = isNumeric ? await getConversation(parseInt(id)) : await getConversationByExternalId(id);
    if (!conversation) return reply.status(404).send({ error: 'Conversation not found' });
    reply.send(conversation);
  });

  fastify.get('/api/conversations/:id/messages', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { limit, offset } = request.query;
    const isNumeric = /^\d+$/.test(id);
    const conv = isNumeric ? await getConversation(parseInt(id)) : await getConversationByExternalId(id);
    if (!conv) return reply.status(404).send({ error: 'Conversation not found' });
    const messages = await getMessages(conv.id, {
      limit: parseInt(limit) || 200,
      offset: parseInt(offset) || 0
    });
    reply.send(messages);
  });

  fastify.patch('/api/conversations/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params;
    const { status, supervisor_id, caller_name, tenant, metadata } = request.body;
    const isNumeric = /^\d+$/.test(id);
    const conv = isNumeric ? await getConversation(parseInt(id)) : await getConversationByExternalId(id);
    if (!conv) return reply.status(404).send({ error: 'Conversation not found' });
    const updates = {};
    if (status) updates.status = status;
    if (supervisor_id) updates.supervisor_id = supervisor_id;
    if (caller_name) updates.caller_name = caller_name;
    if (tenant) updates.tenant = tenant;
    if (metadata) updates.metadata = JSON.stringify(metadata);
    const result = await updateConversation(conv.id, updates);
    if (!result) return reply.status(404).send({ error: 'Conversation not found' });
    reply.send(result);
  });
}
