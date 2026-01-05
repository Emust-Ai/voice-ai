// n8n Webhook Service
// Handles calling n8n workflows and returning results

import { N8N_BASE_URL, TOOL_ENDPOINTS } from '../config/tools.js';

/**
 * Execute an n8n tool by calling its webhook endpoint
 * @param {string} toolName - The name of the tool to execute
 * @param {object} args - The arguments to pass to the tool
 * @param {object} context - Additional context (callSid, streamSid, etc.)
 * @returns {Promise<object>} - The result from n8n
 */
export async function executeN8nTool(toolName, args, context = {}) {
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

    const result = await response.json();
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
