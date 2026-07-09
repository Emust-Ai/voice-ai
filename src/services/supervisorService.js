import axios from 'axios';
import dotenv from 'dotenv';
import { eventBus } from './eventBus.js';

dotenv.config();

export async function scoreExchange(externalId, userMessage, assistantMessage, context = {}) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a real-time AI supervisor for an EV charging support hotline (ev24). Score the assistant's response.

Evaluate these dimensions (0-100 each):
- accuracy: Is the information correct? No hallucinations.
- policy_compliance: Follows ev24 protocols (cable check first, app/RFID guidance before remote_control)
- empathy: Appropriate tone for the caller's emotional state
- conciseness: Brief, 2-sentence max per turn
- overall: Combined score

Return JSON:
{
  "overall": 0-100,
  "dimensions": { "accuracy": 0-100, "policy_compliance": 0-100, "empathy": 0-100, "conciseness": 0-100 },
  "flags": [{ "type": "hallucination"|"policy_violation"|"frustration_detected"|"incorrect_pricing"|"too_verbose", "severity": "low"|"medium"|"high", "message": "..." }],
  "sentiment": "positive"|"neutral"|"negative"|"frustrated",
  "suggestion": "Suggested correction or action for supervisor"
}`
          },
          {
            role: 'user',
            content: `User message: "${userMessage}"\n\nAssistant response: "${assistantMessage}"\n\nTenant: ${context.tenant || 'unknown'}\nIntent: ${context.intent || 'unknown'}\nExchanges so far: ${context.exchangeCount || 0}`
          }
        ],
        max_tokens: 300,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const content = response.data.choices[0]?.message?.content;
    if (!content) return null;

    const result = JSON.parse(content);

    // Emit score and flags via eventBus
    if (result.overall !== undefined) {
      eventBus.emitScore(externalId, {
        overall: result.overall,
        dimensions: result.dimensions || {},
        sentiment: result.sentiment || 'neutral'
      });
    }

    if (result.flags && result.flags.length > 0) {
      for (const flag of result.flags) {
        eventBus.emitFlag(externalId, flag);
      }
    }

    return result;

  } catch (error) {
    console.error('Supervisor scoring error:', error.message);
    return null;
  }
}
