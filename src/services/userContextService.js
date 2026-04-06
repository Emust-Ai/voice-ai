import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'user_contexts.json');

/**
 * Known callers configuration.
 * Maps phone numbers to pre-configured caller data.
 * These callers skip the name question and have an auto-assigned tenant.
 */
const KNOWN_CALLERS = {
  '+33644643789': {
    name: null,
    tenant: 'borneco',
  },
};

/**
 * User Context Service
 * Manages persistent caller context stored in a JSON file.
 * Maps phone numbers to user profiles (name, last problem, call history).
 */

// Ensure data directory and file exist
function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2), 'utf-8');
  }
}

// Read the entire context store
function readContextStore() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Write back the entire context store
function writeContextStore(store) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * Look up a caller by phone number.
 * Returns the user context object or null if not found.
 * 
 * Shape of a user context:
 * {
 *   name: string,
 *   phoneNumber: string,
 *   lastProblem: string,          // brief summary of the last issue discussed
 *   lastResolution: string,       // how it was resolved (if at all)
 *   conversationSummaries: [],    // array of past conversation summaries (last 5)
 *   lastCallDate: string,         // ISO date of the last call
 *   callCount: number
 * }
 */
export function lookupCaller(phoneNumber) {
  if (!phoneNumber) return null;
  const normalized = normalizePhone(phoneNumber);

  // Check if this is a known/pre-configured caller
  const knownCaller = KNOWN_CALLERS[normalized];
  if (knownCaller) {
    const store = readContextStore();
    const existing = store[normalized] || {
      name: knownCaller.name,
      phoneNumber: normalized,
      lastProblem: null,
      lastResolution: null,
      conversationSummaries: [],
      lastCallDate: null,
      callCount: 0
    };
    // Always ensure known caller fields are set
    if (knownCaller.name) existing.name = existing.name || knownCaller.name;
    existing.tenant = knownCaller.tenant;
    return existing;
  }

  const store = readContextStore();
  return store[normalized] || null;
}

/**
 * Save or update a caller's context.
 * Merges provided fields into existing data.
 */
export function saveCallerContext(phoneNumber, contextData) {
  if (!phoneNumber) return;
  const normalized = normalizePhone(phoneNumber);
  const store = readContextStore();

  const existing = store[normalized] || {
    name: null,
    phoneNumber: normalized,
    lastProblem: null,
    lastResolution: null,
    conversationSummaries: [],
    lastCallDate: null,
    callCount: 0
  };

  // Merge new data
  if (contextData.name) existing.name = contextData.name;
  if (contextData.lastProblem) existing.lastProblem = contextData.lastProblem;
  if (contextData.lastResolution) existing.lastResolution = contextData.lastResolution;
  
  existing.lastCallDate = new Date().toISOString();
  existing.callCount = (existing.callCount || 0) + 1;

  // Keep only last 5 conversation summaries
  if (contextData.conversationSummary) {
    existing.conversationSummaries = existing.conversationSummaries || [];
    existing.conversationSummaries.push({
      date: new Date().toISOString(),
      summary: contextData.conversationSummary
    });
    if (existing.conversationSummaries.length > 5) {
      existing.conversationSummaries = existing.conversationSummaries.slice(-5);
    }
  }

  store[normalized] = existing;
  writeContextStore(store);
  return existing;
}

/**
 * Save only the caller's name (used by the AI tool when it first learns the name).
 */
export function saveCallerName(phoneNumber, name) {
  if (!phoneNumber || !name) return null;
  const normalized = normalizePhone(phoneNumber);
  const store = readContextStore();

  const existing = store[normalized] || {
    name: null,
    phoneNumber: normalized,
    lastProblem: null,
    lastResolution: null,
    conversationSummaries: [],
    lastCallDate: new Date().toISOString(),
    callCount: 0
  };

  existing.name = name;
  store[normalized] = existing;
  writeContextStore(store);
  return existing;
}

/**
 * Generate the dynamic system prompt addition based on caller context.
 * Returns a string to prepend/append to the main system prompt.
 */
export function generateCallerContextPrompt(callerContext) {
  // Known caller with auto-tenant but no name — skip the name question
  if (callerContext?.tenant && !callerContext.name) {
    const lines = [];
    lines.push(`### AUTO-TENANT CONFIGURATION`);
    lines.push(`This caller has a pre-assigned tenant: **${callerContext.tenant}**`);
    lines.push(`- **DO NOT use the \`tenant_find\` tool for this caller.** Always use tenant = "${callerContext.tenant}" directly in ALL tool calls.`);
    lines.push(`- When the caller mentions a station or location, skip tenant identification and go straight to \`station_verification\` (or other tools) with tenant = "${callerContext.tenant}".`);
    lines.push('');
    lines.push(`### Caller Context`);
    lines.push(`This is a known caller but we do not have their personal name on file.`);
    lines.push(`- **DO NOT ask for their name.** Skip the name question entirely.`);
    lines.push(`- Greet them warmly without asking for a name: "Bonjour ! Ici Marc, du service client ev24. Comment est-ce que je peux vous aider aujourd'hui ?"`);
    lines.push(`- If the caller spontaneously gives their name during the conversation, you may call the \`save_caller_info\` tool to remember it for next time, but NEVER ask for it proactively.`);
    lines.push(`- Proceed directly to helping them with their request.`);
    return lines.join('\n');
  }

  if (!callerContext || !callerContext.name) {
    // New / unknown caller
    return `
### Caller Context
This is a NEW caller whose phone number is not yet in our system.
- **YOUR VERY FIRST QUESTION must be to ask for their name.** Use the greeting: "Bonjour ! Ici Marc, du service client ev24. À qui ai-je le plaisir de parler ?"
- As soon as the caller gives their name, IMMEDIATELY call the \`save_caller_info\` tool with their name BEFORE continuing the conversation.
- After saving their name, acknowledge warmly and then ask how you can help: "Enchanté [name] ! Comment est-ce que je peux vous aider aujourd'hui ?"
- Do NOT proceed to any workflow (station lookup, user management, etc.) until you have their name.
- If the caller skips the name and goes straight to their issue, gently circle back: "Bien sûr, je vais m'en occuper. Juste avant, puis-je avoir votre prénom ?"
- This also includes when you ask their name during the user_management workflow — once they tell you their name, ALSO call \`save_caller_info\` to remember them.
`;
  }

  // Returning caller — build personalized context
  const lines = [];

  // Auto-tenant: if the caller has a pre-assigned tenant, inject special instructions
  if (callerContext.tenant) {
    lines.push(`### AUTO-TENANT CONFIGURATION`);
    lines.push(`This caller has a pre-assigned tenant: **${callerContext.tenant}**`);
    lines.push(`- **DO NOT use the \`tenant_find\` tool for this caller.** Always use tenant = "${callerContext.tenant}" directly in ALL tool calls.`);
    lines.push(`- When the caller mentions a station or location, skip tenant identification and go straight to \`station_verification\` (or other tools) with tenant = "${callerContext.tenant}".`);
    lines.push('');
  }

  lines.push(`### Caller Context — RETURNING CALLER`);
  lines.push(`This caller has contacted us before. Use the information below to provide a warm, personalized experience. Reference their history naturally — don't just list facts, weave them into the conversation like a real agent who remembers them.`);
  lines.push('');
  lines.push(`**Caller profile:**`);
  lines.push(`- **Name:** ${callerContext.name}`);
  lines.push(`- **Total previous calls:** ${callerContext.callCount || 1}`);
  
  if (callerContext.lastCallDate) {
    const d = new Date(callerContext.lastCallDate);
    const now = new Date();
    const daysSince = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    const dateStr = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    let timeAgo = '';
    if (daysSince === 0) timeAgo = "aujourd'hui";
    else if (daysSince === 1) timeAgo = 'hier';
    else if (daysSince < 7) timeAgo = `il y a ${daysSince} jours`;
    else if (daysSince < 30) timeAgo = `il y a ${Math.floor(daysSince / 7)} semaine(s)`;
    else timeAgo = `il y a ${Math.floor(daysSince / 30)} mois`;
    lines.push(`- **Last call:** ${dateStr} (${timeAgo})`);
  }

  if (callerContext.lastProblem) {
    lines.push('');
    lines.push(`**Last issue discussed (DETAILED):**`);
    lines.push(callerContext.lastProblem);
  }

  if (callerContext.lastResolution) {
    lines.push('');
    lines.push(`**How it was resolved:**`);
    lines.push(callerContext.lastResolution);
  }

  if (callerContext.conversationSummaries && callerContext.conversationSummaries.length > 0) {
    const recent = callerContext.conversationSummaries.slice(-3);
    lines.push('');
    lines.push(`**Full conversation history (last ${recent.length} calls):**`);
    recent.forEach((s, i) => {
      const sd = new Date(s.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      lines.push(`  [Call ${i + 1} — ${sd}]:`);
      lines.push(`  ${s.summary}`);
      lines.push('');
    });
  }

  lines.push('');
  lines.push(`**IMPORTANT — Personalized greeting instructions:**`);
  lines.push(`Since this is a returning caller, you MUST personalize your initial greeting. Do NOT use the standard generic greeting.`);
  lines.push(`- Greet them BY NAME warmly: "Bonjour ${callerContext.name} ! Ici Marc, du service client ev24. Ravi de vous retrouver !"`);
  
  if (callerContext.lastProblem) {
    lines.push(`- Then naturally reference their last interaction. Pick ONE of these approaches depending on context:`);
    lines.push(`  • If the issue was resolved: "La dernière fois, on avait réglé [brief reference to problem]. J'espère que tout fonctionne bien depuis ! Comment est-ce que je peux vous aider aujourd'hui ?"`);
    lines.push(`  • If the issue was NOT resolved: "La dernière fois, vous aviez eu [brief reference to problem] et on n'avait pas pu tout régler. Est-ce que c'est à ce sujet que vous appelez, ou c'est pour autre chose ?"`);
    lines.push(`  • If it's been a while: "Ça fait un petit moment qu'on ne s'est pas parlé ! La dernière fois c'était pour [brief reference]. Comment ça va depuis ? Qu'est-ce que je peux faire pour vous aujourd'hui ?"`);
  } else {
    lines.push(`- Then ask how you can help today: "Comment est-ce que je peux vous aider aujourd'hui ?"`);
  }

  lines.push('');
  lines.push(`**Behavioral rules for returning callers:**`);
  lines.push(`- You already know this caller — do NOT ask for their name again (unless they mention a different person for account lookup).`);
  lines.push(`- If their issue seems related to a previous one, connect the dots: "C'est peut-être lié à ce qu'on avait vu la dernière fois..."`);
  lines.push(`- If the caller gives you an updated name or corrects their name, call the \`save_caller_info\` tool to update it.`);
  lines.push(`- Use their name occasionally during the conversation (not every sentence) to keep it personal.`);

  return lines.join('\n');
}

// Normalize phone number to a consistent format
function normalizePhone(phone) {
  if (!phone) return '';
  // Remove spaces, dashes, parentheses
  return phone.replace(/[\s\-()]/g, '');
}
