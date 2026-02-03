// n8n Webhook Service
// Handles calling n8n workflows and returning results

import { N8N_BASE_URL, TOOL_ENDPOINTS } from '../config/tools.js';
import { APP_GUIDE_SECTIONS } from '../config/appGuide.js';

/**
 * Handle local tools that don't require n8n
 * @param {string} toolName - The name of the tool
 * @param {object} args - The arguments passed to the tool
 * @returns {object|null} - Result if handled locally, null otherwise
 */
function handleLocalTool(toolName, args) {
  if (toolName === 'get_app_help') {
    const topic = (args.topic || 'general').toLowerCase();
    
    // Map topic keywords to section keys
    const topicMap = {
      'login': 'login',
      'connexion': 'login',
      'connect': 'login',
      'create_account': 'account',
      'account': 'account',
      'compte': 'account',
      'inscription': 'account',
      'signup': 'account',
      'sign_up': 'account',
      'register': 'account',
      'password': 'password',
      'mot_de_passe': 'password',
      'otp': 'otp',
      'start_session': 'start_charging',
      'start': 'start_charging',
      'charging': 'start_charging',
      'recharge': 'start_charging',
      'demarrer': 'start_charging',
      'session': 'start_charging',
      'wallet': 'wallet',
      'portefeuille': 'wallet',
      'credit': 'wallet',
      'payment': 'payment',
      'paiement': 'payment',
      'card': 'payment',
      'carte': 'payment',
      'badges': 'badges',
      'badge': 'badges',
      'rfid': 'badges',
      'tag': 'badges',
      'troubleshooting': 'troubleshooting',
      'problem': 'troubleshooting',
      'probleme': 'troubleshooting',
      'error': 'troubleshooting',
      'erreur': 'troubleshooting',
      'bug': 'troubleshooting',
      'crash': 'troubleshooting',
      'qr': 'qr_code',
      'qr_code': 'qr_code',
      'scan': 'qr_code',
      'navigation': 'navigation',
      'menu': 'navigation',
      'stations': 'find_stations',
      'find': 'find_stations',
      'map': 'find_stations',
      'carte': 'find_stations',
      'stop': 'stop_charging',
      'arreter': 'stop_charging',
      'vehicles': 'vehicles',
      'car': 'vehicles',
      'voiture': 'vehicles',
      'faq': 'faq',
      'general': 'general',
      'download': 'download',
      'install': 'download',
      'telecharger': 'download'
    };
    
    // Find the best matching section
    let sectionKey = 'general';
    for (const [keyword, key] of Object.entries(topicMap)) {
      if (topic.includes(keyword)) {
        sectionKey = key;
        break;
      }
    }
    
    const section = APP_GUIDE_SECTIONS[sectionKey] || APP_GUIDE_SECTIONS.general;
    
    return {
      success: true,
      data: {
        topic: sectionKey,
        info: section
      }
    };
  }
  return null;
}

/**
 * Execute an n8n tool by calling its webhook endpoint
 * @param {string} toolName - The name of the tool to execute
 * @param {object} args - The arguments to pass to the tool
 * @param {object} context - Additional context (callSid, streamSid, etc.)
 * @returns {Promise<object>} - The result from n8n
 */
export async function executeN8nTool(toolName, args, context = {}) {
  // Check if this is a local tool first
  const localResult = handleLocalTool(toolName, args);
  if (localResult) {
    return localResult;
  }

  const endpoint = TOOL_ENDPOINTS[toolName];
  
  if (!endpoint) {
    return {
      success: false,
      error: `Unknown tool: ${toolName}`
    };
  }

  const webhookUrl = `${N8N_BASE_URL}${endpoint}`;
  
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add authentication if needed
        ...(process.env.N8N_API_KEY && {
          'Authorization': `Bearer ${process.env.N8N_API_KEY}`
        })
      },
      body: JSON.stringify({
        ...args,
        _context: {
          callSid: context.callSid,
          streamSid: context.streamSid,
          callerNumber: context.callerNumber,
          timestamp: new Date().toISOString()
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`n8n webhook error for ${toolName}:`, errorText);
      return {
        success: false,
        error: `Tool execution failed: ${response.status} ${response.statusText}`
      };
    }

    let result = await response.json();
    
    // Handle array responses from n8n (e.g., [{ "output": "value" }])
    if (Array.isArray(result) && result.length > 0) {
      result = result[0];
    }
    
    return {
      success: true,
      data: result
    };

  } catch (error) {
    console.error(`Error calling n8n tool ${toolName}:`, error);
    return {
      success: false,
      error: `Failed to execute tool: ${error.message}`
    };
  }
}

/**
 * Execute multiple tools in parallel
 * @param {Array<{name: string, args: object}>} tools - Array of tools to execute
 * @param {object} context - Additional context
 * @returns {Promise<object>} - Map of tool names to results
 */
export async function executeN8nToolsParallel(tools, context = {}) {
  const results = await Promise.all(
    tools.map(async ({ name, args, callId }) => {
      const result = await executeN8nTool(name, args, context);
      return { callId, name, result };
    })
  );

  return results.reduce((acc, { callId, name, result }) => {
    acc[callId] = { name, ...result };
    return acc;
  }, {});
}
