import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const INTENTS = [
  'cannot_start_charging',
  'stop_charging',
  'billing_invoice',
  'find_station',
  'app_help',
  'rfid_help',
  'account_issue',
  'human_escalation',
  'greeting',
  'other'
];

export async function classifyIntent(transcript) {
  if (!transcript || transcript.trim().length < 3) {
    return { intent: 'other', slots: {}, confidence: 0 };
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return basicClassify(transcript);
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an intent classifier for an EV charging support hotline (ev24). Classify the user's first utterance into exactly one intent and extract relevant slots.

Intents:
- cannot_start_charging: User can't start a charge, charger not working, plug issue
- stop_charging: User wants to stop an active charge session
- billing_invoice: User asks about bills, invoices, payment, prices
- find_station: User wants to find a nearby charging station
- app_help: User needs help with the mobile app
- rfid_help: User has issues with RFID card
- account_issue: User has account/login/ID problems
- human_escalation: User explicitly asks for a human agent
- greeting: User is just greeting, not yet stating a problem
- other: None of the above

Return JSON: { "intent": "intent_name", "confidence": 0.0-1.0, "slots": { "tenant": null or string, "station": null or string, "problem": null or string, "method": null or "app"/"rfid"/null } }

Slots should be extracted ONLY if explicitly mentioned. Use null for unknown.
Confidence < 0.5 → default to "other".

Examples:
User: "j'arrive pas à démarrer la charge à la borne Carrefour"
→ {"intent":"cannot_start_charging","confidence":0.95,"slots":{"tenant":null,"station":"Carrefour","problem":"cant_start","method":null}}

User: "combien j'ai payé le mois dernier"
→ {"intent":"billing_invoice","confidence":0.9,"slots":{"tenant":null,"station":null,"problem":"invoice_query","method":null}}

User: "arrêtez la charge s'il vous plaît"
→ {"intent":"stop_charging","confidence":0.95,"slots":{"tenant":null,"station":null,"problem":"stop","method":null}}

User: "où est la borne la plus proche"
→ {"intent":"find_station","confidence":0.95,"slots":{"tenant":null,"station":null,"problem":"nearest","method":null}}

User: "bonjour"
→ {"intent":"greeting","confidence":0.9,"slots":{}}

Return ONLY valid JSON, no markdown fences.`
          },
          {
            role: 'user',
            content: transcript
          }
        ],
        max_tokens: 150,
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
    if (content) {
      const parsed = JSON.parse(content);
      if (parsed.intent && INTENTS.includes(parsed.intent)) {
        return {
          intent: parsed.intent,
          slots: parsed.slots || {},
          confidence: parsed.confidence || 0
        };
      }
    }
  } catch (error) {
    console.error('Intent classification error:', error.message);
  }

  return basicClassify(transcript);
}

function basicClassify(transcript) {
  const lower = transcript.toLowerCase();
  let intent = 'other';
  let confidence = 0.3;

  if (/bonjour|salut|allô|hello/i.test(lower)) {
    intent = 'greeting';
    confidence = 0.6;
  } else if (/démarr|charge pas|marche pas|ne charge|pas de courant|panne/i.test(lower)) {
    intent = 'cannot_start_charging';
    confidence = 0.7;
  } else if (/arrêt|stop|fini|termine|couper/i.test(lower)) {
    intent = 'stop_charging';
    confidence = 0.6;
  } else if (/factur|prix|coût|payé|invoice|combien|tarif/i.test(lower)) {
    intent = 'billing_invoice';
    confidence = 0.7;
  } else if (/où|proche|près|trouver|localis|station la plus/i.test(lower)) {
    intent = 'find_station';
    confidence = 0.7;
  } else if (/appli|application|télécharg|installe|bug|plante/i.test(lower)) {
    intent = 'app_help';
    confidence = 0.6;
  } else if (/rfid|carte|badge|tag/i.test(lower)) {
    intent = 'rfid_help';
    confidence = 0.6;
  } else if (/compte|identifiant|mdp|mot de passe|login|connect/i.test(lower)) {
    intent = 'account_issue';
    confidence = 0.6;
  } else if (/humain|collègue|opérateur|conseiller|parler à quelqu|transférer/i.test(lower)) {
    intent = 'human_escalation';
    confidence = 0.8;
  }

  return { intent, slots: {}, confidence };
}
