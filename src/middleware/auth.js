import jwt from 'jsonwebtoken';
import { JWT_SECRET, ROLES, ROLE_HIERARCHY } from '../config/auth.js';

export function authenticate(request, reply, done) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    request.user = decoded;
    done();
  } catch (err) {
    reply.status(401).send({ error: 'Invalid or expired token' });
    return;
  }
}

export function requireRole(...allowedRoles) {
  return (request, reply, done) => {
    if (!request.user) {
      reply.status(401).send({ error: 'Not authenticated' });
      return;
    }
    const userRole = request.user.role;
    if (!allowedRoles.includes(userRole)) {
      reply.status(403).send({
        error: 'Insufficient permissions',
        required: allowedRoles,
        yourRole: userRole
      });
      return;
    }
    done();
  };
}

export function requireAdmin(request, reply, done) {
  return requireRole(ROLES.ADMIN)(request, reply, done);
}
