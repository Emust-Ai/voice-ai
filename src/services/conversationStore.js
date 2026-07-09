import { query } from '../config/database.js';

export async function createConversation({ externalId, channel, callerNumber, callerName, tenant }) {
  const result = await query(
    `INSERT INTO conversations (external_id, channel, caller_number, caller_name, tenant)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [externalId, channel, callerNumber || null, callerName || null, tenant || null]
  );
  return result.rows[0];
}

export async function getConversation(id) {
  const result = await query('SELECT * FROM conversations WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function getConversationByExternalId(externalId) {
  const result = await query('SELECT * FROM conversations WHERE external_id = $1', [externalId]);
  return result.rows[0] || null;
}

export async function listConversations({ status, limit = 50, offset = 0 } = {}) {
  let sql = 'SELECT * FROM conversations';
  const params = [];
  if (status) {
    params.push(status);
    sql += ` WHERE status = $${params.length}`;
  }
  sql += ' ORDER BY started_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
  params.push(limit, offset);
  const result = await query(sql, params);
  return result.rows;
}

export async function updateConversation(id, updates) {
  const fields = [];
  const params = [];
  let idx = 1;
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      fields.push(`${key} = $${idx++}`);
      params.push(value);
    }
  }
  if (fields.length === 0) return null;
  fields.push(`updated_at = NOW()`);
  params.push(id);
  const result = await query(
    `UPDATE conversations SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  return result.rows[0] || null;
}

export async function addMessage({ conversationId, role, content, contentType, metadata }) {
  const result = await query(
    `INSERT INTO messages (conversation_id, role, content, content_type, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [conversationId, role, content, contentType || 'text', metadata ? JSON.stringify(metadata) : '{}']
  );
  return result.rows[0];
}

export async function getMessages(conversationId, { limit = 200, offset = 0 } = {}) {
  const result = await query(
    'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3',
    [conversationId, limit, offset]
  );
  return result.rows;
}

export async function createScorecard(conversationId, data) {
  const result = await query(
    `INSERT INTO scorecards (conversation_id, ai_performance_score, sentiment_arc, resolution_status, flags, escalation_needed, exchange_count, duration_seconds, tools_used, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      conversationId,
      data.aiPerformanceScore || null,
      JSON.stringify(data.sentimentArc || []),
      data.resolutionStatus || null,
      JSON.stringify(data.flags || []),
      data.escalationNeeded || false,
      data.exchangeCount || 0,
      data.durationSeconds || 0,
      JSON.stringify(data.toolsUsed || []),
      data.summary || null
    ]
  );
  return result.rows[0];
}

export async function getScorecards({ limit = 50, offset = 0 } = {}) {
  const result = await query(
    `SELECT s.*, c.caller_number, c.caller_name, c.tenant, c.channel
     FROM scorecards s
     JOIN conversations c ON c.id = s.conversation_id
     ORDER BY s.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
}

export async function getScorecardStats() {
  const result = await query(`
    SELECT
      COUNT(*) as total_conversations,
      COUNT(*) FILTER (WHERE resolution_status = 'resolved') as resolved_count,
      COUNT(*) FILTER (WHERE escalation_needed = true) as escalation_count,
      ROUND(AVG(ai_performance_score), 2) as avg_score,
      ROUND(AVG(exchange_count), 0) as avg_exchanges,
      ROUND(AVG(duration_seconds), 0) as avg_duration_seconds,
      COUNT(*) FILTER (WHERE flags::text != '[]') as flagged_count
    FROM scorecards
  `);
  return result.rows[0];
}

export async function logSupervisorEvent({ conversationId, supervisorId, eventType, payload }) {
  const result = await query(
    `INSERT INTO supervisor_events (conversation_id, supervisor_id, event_type, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [conversationId, supervisorId || null, eventType, payload ? JSON.stringify(payload) : '{}']
  );
  return result.rows[0];
}

export async function getSupervisorEvents(conversationId) {
  const result = await query(
    `SELECT se.*, u.name as supervisor_name
     FROM supervisor_events se
     LEFT JOIN users u ON u.id = se.supervisor_id
     WHERE se.conversation_id = $1
     ORDER BY se.created_at ASC`,
    [conversationId]
  );
  return result.rows;
}
