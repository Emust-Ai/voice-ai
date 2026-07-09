import { EventEmitter } from 'events';

class ConversationEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  emitConversationEvent(conversationId, eventType, data) {
    const event = {
      conversationId,
      eventType,
      data,
      timestamp: new Date().toISOString()
    };
    this.emit(`conversation:${conversationId}`, event);
    this.emit('conversation:*', event);
  }

  emitTranscript(conversationId, message) {
    this.emitConversationEvent(conversationId, 'transcript', message);
  }

  emitScore(conversationId, score) {
    this.emitConversationEvent(conversationId, 'score', score);
  }

  emitFlag(conversationId, flag) {
    this.emitConversationEvent(conversationId, 'flag', flag);
  }

  emitStatusChange(conversationId, status) {
    this.emitConversationEvent(conversationId, 'status_change', { status });
  }

  emitConversationUpdate(conversationId, update) {
    this.emitConversationEvent(conversationId, 'conversation_update', update);
  }

  emitAudio(conversationId, audioData) {
    this.emit(`conversation:${conversationId}`, {
      conversationId,
      eventType: 'audio',
      data: { audio: audioData },
      timestamp: new Date().toISOString()
    });
    this.emit('conversation:*', {
      conversationId,
      eventType: 'audio',
      data: { audio: audioData },
      timestamp: new Date().toISOString()
    });
  }
}

export const eventBus = new ConversationEventBus();
