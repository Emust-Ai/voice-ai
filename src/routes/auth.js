import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';
import { JWT_SECRET, JWT_EXPIRES_IN, ROLES } from '../config/auth.js';
import { authenticate } from '../middleware/auth.js';

export default async function authRoutes(fastify) {
  // POST /api/auth/register — create a new user (admin only)
  fastify.post('/api/auth/register', {
    preHandler: [authenticate, (req, reply, done) => {
      if (req.user.role !== ROLES.ADMIN) {
        reply.status(403).send({ error: 'Admin only' });
        return;
      }
      done();
    }]
  }, async (request, reply) => {
    const { email, password, name, role } = request.body;
    if (!email || !password || !name) {
      return reply.status(400).send({ error: 'email, password, and name required' });
    }
    const validRole = role || ROLES.AGENT;
    if (!Object.values(ROLES).includes(validRole)) {
      return reply.status(400).send({ error: `Invalid role. Must be one of: ${Object.values(ROLES).join(', ')}` });
    }
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return reply.status(409).send({ error: 'User with this email already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, created_at',
      [email, passwordHash, name, validRole]
    );
    reply.status(201).send(result.rows[0]);
  });

  // POST /api/auth/login
  fastify.post('/api/auth/login', async (request, reply) => {
    const { email, password } = request.body;
    if (!email || !password) {
      return reply.status(400).send({ error: 'email and password required' });
    }
    const result = await query('SELECT id, email, password_hash, name, role, is_active FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }
    const user = result.rows[0];
    if (!user.is_active) {
      return reply.status(403).send({ error: 'Account is disabled' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  });

  // POST /api/auth/refresh — refresh token
  fastify.post('/api/auth/refresh', { preHandler: [authenticate] }, async (request, reply) => {
    const token = jwt.sign(
      { id: request.user.id, email: request.user.email, name: request.user.name, role: request.user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    reply.send({ token });
  });

  // GET /api/auth/me — current user info
  fastify.get('/api/auth/me', { preHandler: [authenticate] }, async (request, reply) => {
    reply.send({ user: request.user });
  });

  // GET /api/auth/users — list users (admin/supervisor)
  fastify.get('/api/auth/users', {
    preHandler: [authenticate, (req, reply, done) => {
      if (!['admin', 'supervisor'].includes(req.user.role)) {
        reply.status(403).send({ error: 'Insufficient permissions' });
        return;
      }
      done();
    }]
  }, async (request, reply) => {
    const result = await query('SELECT id, email, name, role, is_active, created_at FROM users ORDER BY created_at DESC');
    reply.send(result.rows);
  });

  // PUT /api/auth/users/:id — update user (admin only)
  fastify.put('/api/auth/users/:id', {
    preHandler: [authenticate, (req, reply, done) => {
      if (req.user.role !== 'admin') {
        reply.status(403).send({ error: 'Admin only' });
        return;
      }
      done();
    }]
  }, async (request, reply) => {
    const { id } = request.params;
    const { name, role, is_active } = request.body;
    const fields = [];
    const params = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name = $${idx++}`); params.push(name); }
    if (role !== undefined) { fields.push(`role = $${idx++}`); params.push(role); }
    if (is_active !== undefined) { fields.push(`is_active = $${idx++}`); params.push(is_active); }
    if (fields.length === 0) return reply.status(400).send({ error: 'No fields to update' });
    params.push(id);
    const result = await query(
      `UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING id, email, name, role, is_active, created_at`,
      params
    );
    if (result.rows.length === 0) return reply.status(404).send({ error: 'User not found' });
    reply.send(result.rows[0]);
  });
}
