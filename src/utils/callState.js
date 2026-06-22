const sessions = new Map();

export function setSession(phone, data) {
  sessions.set(phone, data);
}

export function getSession(phone) {
  return sessions.get(phone);
}

export function removeSession(phone) {
  sessions.delete(phone);
}
