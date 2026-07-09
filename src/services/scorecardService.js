import { getConversationByExternalId, getMessages, createScorecard, updateConversation } from './conversationStore.js';
import { activeSessions } from '../routes/supervisor.js';

export async function generateScorecard(externalId) {
  try {
    const conv = await getConversationByExternalId(externalId);
    if (!conv) return null;

    const messages = await getMessages(conv.id);

    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    const supervisorEvents = messages.filter(m => m.role === 'supervisor');

    const exchangeCount = Math.min(userMessages.length, assistantMessages.length);

    const durationSeconds = conv.started_at
      ? Math.floor((Date.now() - new Date(conv.started_at).getTime()) / 1000)
      : 0;

    // Determine resolution status
    let resolutionStatus = 'unresolved';
    const allText = messages.map(m => m.content).join(' ').toLowerCase();
    if (/merci|résolu|solution|ça marche|parfait|d'accord merci/i.test(allText)) {
      resolutionStatus = 'resolved';
    } else if (supervisorEvents.length > 0 || /escalade|collègue|transférer|humain|priorité|callback/i.test(allText)) {
      resolutionStatus = 'escalated';
    } else if (/au revoir|bonne journée|raccroche|terminé/i.test(allText)) {
      resolutionStatus = 'abandoned';
    }

    const session = activeSessions.get(externalId);
    let flags = [];
    let avgScore = null;

    // Check for flags from callMemory
    if (session?.callMemory?.flags) {
      flags = session.callMemory.flags;
    }

    // Tools used
    const toolsUsed = session?.callMemory?.toolsCalled?.map(t => t.name) || [];

    const scorecard = await createScorecard(conv.id, {
      aiPerformanceScore: avgScore,
      sentimentArc: [],
      resolutionStatus,
      flags,
      escalationNeeded: supervisorEvents.length > 0,
      exchangeCount,
      durationSeconds,
      toolsUsed,
      summary: generateSummary(messages)
    });

    await updateConversation(conv.id, { status: 'ended', ended_at: new Date().toISOString() });

    return scorecard;

  } catch (err) {
    console.error('Scorecard generation error:', err.message);
    return null;
  }
}

function generateSummary(messages) {
  const userMsgs = messages.filter(m => m.role === 'user').map(m => m.content).join(' | ');
  const assistantMsgs = messages.filter(m => m.role === 'assistant').map(m => m.content).join(' | ');
  return `User: ${userMsgs.substring(0, 300)} | Assistant: ${assistantMsgs.substring(0, 300)}`;
}
