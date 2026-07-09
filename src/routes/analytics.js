import { authenticate } from '../middleware/auth.js';
import { getScorecards, getScorecardStats } from '../services/conversationStore.js';

export default async function analyticsRoutes(fastify) {
  // GET /api/analytics/scorecards
  fastify.get('/api/analytics/scorecards', { preHandler: [authenticate] }, async (request, reply) => {
    const { limit, offset } = request.query;
    const scorecards = await getScorecards({
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0
    });
    reply.send(scorecards);
  });

  // GET /api/analytics/stats
  fastify.get('/api/analytics/stats', { preHandler: [authenticate] }, async (request, reply) => {
    const stats = await getScorecardStats();
    reply.send(stats || { total_conversations: 0 });
  });
}
