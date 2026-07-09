import dotenv from 'dotenv';
dotenv.config();

export const JWT_SECRET = process.env.JWT_SECRET || 'ev24-supervisor-secret-change-in-production';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
export const ROLES = {
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  AGENT: 'agent'
};

export const ROLE_HIERARCHY = {
  [ROLES.ADMIN]: 3,
  [ROLES.SUPERVISOR]: 2,
  [ROLES.AGENT]: 1
};

export function roleAtLeast(requiredRole) {
  return (req) => {
    const userRole = req.user?.role;
    if (!userRole) return false;
    return (ROLE_HIERARCHY[userRole] || 0) >= (ROLE_HIERARCHY[requiredRole] || 0);
  };
}
