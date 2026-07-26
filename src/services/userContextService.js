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
    callerType: 'cpo',
    label: 'cpo-borneco',
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
  const store = readContextStore();

  // Check if this is a known/pre-configured caller
  const knownCaller = KNOWN_CALLERS[normalized];
  if (knownCaller) {
    const existing = store[normalized] || createEmptyContext(normalized, knownCaller.name);
    // Always ensure known caller fields are set
    if (knownCaller.name) existing.name = existing.name || knownCaller.name;
    existing.tenant = knownCaller.tenant;
    existing.callerType = knownCaller.callerType || 'known';
    existing.label = knownCaller.label || null;
    existing.isKnownCaller = true;
    return existing;
  }

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

  const existing = store[normalized] || createEmptyContext(normalized);

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
 * Save caller info. Supports:
 * - caller_name: caller/client full name
 * - caller_phone: end client phone number reference (for CPO relayed calls)
 *
 * If caller_phone is provided, the profile anchor switches to that number
 * and future context is saved/looked up under that number.
 */
export function saveCallerInfo(sessionPhoneNumber, info = {}) {
  if (!sessionPhoneNumber) return null;

  const baseNumber = normalizePhone(sessionPhoneNumber);
  const providedReferenceNumber = normalizePhone(info.caller_phone || info.reference_phone_number || '');
  const anchorNumber = providedReferenceNumber || baseNumber;
  const callerName = (info.caller_name || info.name || '').trim() || null;

  const knownCaller = KNOWN_CALLERS[baseNumber] || null;
  const store = readContextStore();

  const existing = store[anchorNumber] || createEmptyContext(anchorNumber);

  if (callerName) {
    existing.name = callerName;
  }

  // Keep track of the original incoming line for auditing/cross-reference.
  existing.sourcePhoneNumbers = Array.isArray(existing.sourcePhoneNumbers) ? existing.sourcePhoneNumbers : [];
  if (baseNumber && !existing.sourcePhoneNumbers.includes(baseNumber)) {
    existing.sourcePhoneNumbers.push(baseNumber);
  }

  if (providedReferenceNumber) {
    existing.referencePhoneNumber = providedReferenceNumber;
  }

  // Preserve known caller metadata from the incoming line (e.g., CPO BornEco profile)
  if (knownCaller) {
    existing.tenant = knownCaller.tenant;
    if (anchorNumber === baseNumber) {
      existing.callerType = knownCaller.callerType || existing.callerType;
      existing.label = knownCaller.label || existing.label;
      existing.isKnownCaller = true;
    } else {
      existing.relayedBy = baseNumber;
    }
  }

  store[anchorNumber] = existing;
  writeContextStore(store);
  return existing;
}

/**
 * Backward-compatible wrapper.
 */
export function saveCallerName(phoneNumber, name) {
  if (!name) return null;
  return saveCallerInfo(phoneNumber, { caller_name: name });
}

function createEmptyContext(normalizedPhone, defaultName = null) {
  return {
    name: defaultName,
    phoneNumber: normalizedPhone,
    referencePhoneNumber: null,
    sourcePhoneNumbers: [],
    lastProblem: null,
    lastResolution: null,
    conversationSummaries: [],
    lastCallDate: null,
    callCount: 0
  };
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
    if (callerContext.callerType === 'cpo') {
      lines.push(`- This is a known CPO caller profile. Mention the tenant naturally when greeting (e.g., "support ev24 pour BornEco").`);
      lines.push(`- EARLY IN THE CALL, ask for the END CLIENT phone number first and call \`save_caller_info\` with \`caller_phone\` immediately.`);
      lines.push(`- If they also share the client name, call \`save_caller_info\` again with \`caller_phone\` + \`caller_name\` to update the same profile.`);
      lines.push(`- After saving client number, run \`user_management\` with tenant = "${callerContext.tenant}" when account verification is needed.`);
    }
    lines.push('');
    lines.push(`### Caller Context`);
    lines.push(`This is a known caller but we do not have their personal name on file.`);
    lines.push(`- Example greeting: "Bonjour ! Ici Eva, du service client ev24${callerContext.callerType === 'cpo' ? ' pour BornEco' : ''}. Puis-je avoir le numéro du client concerné ?"`);
    lines.push(`- As soon as they provide the client number, call the \`save_caller_info\` tool with \`caller_phone\` so future calls are anchored on the end client.`);
    lines.push(`- If they give the client name too, call \`save_caller_info\` again with both \`caller_phone\` and \`caller_name\`.`);
    lines.push(`- Proceed directly to helping them with their request.`);
    return lines.join('\n');
  }

  if (!callerContext || !callerContext.name) {
    // New / unknown caller
    return `
### Caller Context
This is a NEW caller whose phone number is not yet in our system.
- Greet them with: "Bonjour ! Ici Eva, du service client ev24. Comment puis-je vous aider aujourd'hui ?"
- If they describe a problem, help immediately. Never delay support just to collect their name.
- Ask for their first name later, when it is naturally useful for account lookup or follow-up.
- When they give their name, call the \`save_caller_info\` tool once and continue from the current step.
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
  lines.push(`- Greet them BY NAME warmly: "Bonjour ${callerContext.name} ! Ici Eva, du service client ev24. Ravie de vous retrouver !"`);
  
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
  if (callerContext.callerType === 'cpo' && callerContext.tenant) {
    lines.push(`- This is a CPO known-caller profile: ask for end-client number first and save it via \`save_caller_info(caller_phone)\`, then proceed.`);
  }

  return lines.join('\n');
}

// Normalize phone number to a consistent format
function normalizePhone(phone) {
  if (!phone) return '';
  let normalized = String(phone).trim();
  normalized = normalized.replace(/[\s\-().]/g, '');

  if (normalized.startsWith('00')) {
    normalized = `+${normalized.slice(2)}`;
  }

  if (!normalized.startsWith('+') && /^\d{8,15}$/.test(normalized)) {
    normalized = `+${normalized}`;
  }

  return normalized;
}
