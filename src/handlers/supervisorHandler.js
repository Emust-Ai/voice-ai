import { eventBus } from '../services/eventBus.js';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/auth.js';
import { getSession } from '../routes/supervisor.js';

export function registerSupervisorHandlers(io) {
  const supervisorNs = io.of('/supervisor');

  supervisorNs.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  supervisorNs.on('connection', (socket) => {
    const { role, name } = socket.user;
    console.log(`Supervisor connected: ${name} (${role})`);

    socket.join('all');

    socket.on('join-conversation', (externalId) => {
      if (!externalId) return;
      socket.join(`conv:${externalId}`);
      console.log(`${name} joined conversation room: conv:${externalId}`);
    });

    socket.on('leave-conversation', (externalId) => {
      if (!externalId) return;
      socket.leave(`conv:${externalId}`);
    });

    socket.on('supervisor_audio', (data) => {
      const { externalId, audio } = data;
      if (!externalId || !audio) return;
      const session = getSession(externalId);
      if (!session) return;
      const { openAiWs, connection, callMemory } = session;
      // During takeover or pause, forward supervisor audio directly to the client
      const isTakenOver = callMemory?.takeover;
      const isPaused = callMemory?.aiPaused;
      if ((isTakenOver || isPaused) && connection?.socket?.readyState === 1) {
        connection.socket.send(JSON.stringify({ type: 'audio', audio }));
      } else if (openAiWs?.readyState === 1) {
        openAiWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }));
      } else if (connection?.socket?.readyState === 1) {
        connection.socket.send(JSON.stringify({ type: 'audio', audio }));
      }
    });

    socket.on('disconnect', () => {
      console.log(`Supervisor disconnected: ${name}`);
    });
  });

  eventBus.on('conversation:*', (event) => {
    const { conversationId, eventType, data, timestamp } = event;

    if (eventType === 'audio') {
      supervisorNs.to(`conv:${conversationId}`).emit('audio', {
        conversationId,
        audio: data.audio,
        timestamp
      });
      return;
    }

    supervisorNs.to(`conv:${conversationId}`).emit(eventType, {
      conversationId,
      ...data,
      timestamp
    });

    if (eventType === 'transcript') {
      supervisorNs.to('all').emit('conversation:update', {
        conversationId,
        eventType: 'transcript',
        summary: {
          role: data.role,
          preview: (data.content || '').substring(0, 60),
          supervisorName: data.supervisorName
        },
        timestamp
      });
    } else {
      supervisorNs.to('all').emit('conversation:update', {
        conversationId,
        eventType,
        ...data,
        timestamp
      });
    }
  });
}
