import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Generates a structured conversation summary specifically for user context storage.
 * This is separate from the Chatwoot summary — it's designed to extract:
 *   - The user's main problem/need
 *   - How it was resolved (if at all)
 *   - A brief overall summary for context on future calls
 * 
 * Uses Azure OpenAI Chat Completion (gpt-4o-mini) for intelligent extraction.
 */
export async function generateConversationSummaryForContext(messages) {
  if (!messages || messages.length === 0) {
    return {
      lastProblem: null,
      lastResolution: null,
      conversationSummary: null
    };
  }

  // Build conversation text
  const conversationText = messages
    .map(msg => `${msg.role === 'user' ? 'Client' : 'Assistant'}: ${msg.text}`)
    .join('\n');

  try {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const chatModel = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

    if (!openaiApiKey) {
      console.log('OpenAI Chat not configured, using basic context extraction');
      return extractBasicContext(messages);
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: chatModel,
        messages: [
          {
            role: 'system',
            content: `You are a context extraction assistant for ev24, an electric vehicle charging support service. Your job is to produce a DETAILED and RICH summary from a phone support conversation so that a future AI agent can pick up exactly where this conversation left off — even weeks later.

Be thorough. The next AI agent reading this summary will have NO access to the original conversation. Everything important must be captured here.

Return a JSON object with exactly these 3 fields:

- "lastProblem": A DETAILED description (2-4 sentences) of the caller's main issue or request. Include:
  • What they wanted (e.g., start a charge, check an invoice, stop a session, report a broken station)
  • Which station/location/connector was involved (name, ID, area — whatever was mentioned)
  • Which tenant/network was identified (e.g., Borneco, Horizon, etc.)
  • Any error or symptom they described (e.g., "connector won't lock", "app says payment failed", "station shows inoperative")
  • Their user ID or account info if it came up
  Write in the same language the caller used.

- "lastResolution": A DETAILED description (2-4 sentences) of the outcome. Include:
  • What actions were taken (e.g., "remote start sent on connector 2", "RFID verified and charge initiated", "user redirected to download the app", "escalated to human agent")
  • Whether the problem was fully resolved, partially resolved, or unresolved
  • Any pending action (e.g., "human callback requested", "user needs to update payment method", "user will try again after reinstalling app")
  • If the caller was transferred/escalated, note why
  Write in the same language the caller used. If nothing was resolved, explain what blocked resolution.

- "conversationSummary": A comprehensive 3-5 sentence narrative summary of the entire call. Include the caller's identity (name if known), their problem, what steps were taken, the outcome, and any important details a future agent should know (e.g., "caller was frustrated", "caller mentioned they had the same issue last week", "caller uses RFID badge not the app", "caller's account is under the name Dupont but they said their wife registered it"). Write in the same language the caller used.

Return ONLY valid JSON, no markdown fences, no extra text.`
          },
          {
            role: 'user',
            content: conversationText
          }
        ],
        max_tokens: 800,
        temperature: 0.2,
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const content = response.data.choices[0]?.message?.content;
    if (content) {
      try {
        const parsed = JSON.parse(content);
        console.log('✅ Context summary extracted:', JSON.stringify(parsed));
        return {
          lastProblem: parsed.lastProblem || null,
          lastResolution: parsed.lastResolution || null,
          conversationSummary: parsed.conversationSummary || null
        };
      } catch {
        console.error('Failed to parse AI context summary JSON:', content);
        return extractBasicContext(messages);
      }
    }

    return extractBasicContext(messages);

  } catch (error) {
    console.error('Error generating context summary:', error.response?.data || error.message);
    return extractBasicContext(messages);
  }
}

/**
 * Basic fallback context extraction without AI.
 * Looks at the first user message as the "problem" and the last assistant message as the "resolution".
 */
function extractBasicContext(messages) {
  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');

  // Gather more context from multiple messages
  const userTexts = userMessages.map(m => m.text).filter(Boolean);
  const assistantTexts = assistantMessages.map(m => m.text).filter(Boolean);

  const problemParts = userTexts.slice(0, 5).join(' | ');
  const resolutionParts = assistantTexts.slice(-3).join(' | ');

  return {
    lastProblem: problemParts ? problemParts.substring(0, 500) : null,
    lastResolution: resolutionParts ? resolutionParts.substring(0, 500) : null,
    conversationSummary: problemParts
      ? `Le client a appelé et a dit: "${userTexts[0]?.substring(0, 150) || ''}". ${userTexts.length > 1 ? `Au total ${userTexts.length} messages échangés.` : ''} Dernière réponse de l'assistant: "${assistantTexts[assistantTexts.length - 1]?.substring(0, 150) || 'N/A'}"`
      : null
  };
}
