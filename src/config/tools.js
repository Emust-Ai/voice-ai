// n8n Tool Definitions for OpenAI Realtime API
// Each tool corresponds to an n8n webhook workflow

import dotenv from 'dotenv';
dotenv.config();

export const N8N_BASE_URL = process.env.N8N_WEBHOOK_URL || 'https://your-n8n-instance.com/webhook';

console.log('N8N_BASE_URL configured as:', N8N_BASE_URL);

// Tool definitions following OpenAI function calling schema
export const TOOLS = [
  {
    type: 'function',
    name: 'station_verification',
    description: 'Verify the status of a charging station. Returns whether the station is operative or inoperative. Can search by station name, station ID, or area/location name.',
    parameters: {
      type: 'object',
      properties: {
        station_name: {
          type: 'string',
          description: 'The name, ID, or area/location of the charging station to verify (e.g., "Station Paris 15", "Carrefour Montreuil", "Zone Commerciale Bercy")'
        }
      },
      required: ['station_name']
    }
  },
  {
    type: 'function',
    name: 'user_management',
    description: 'Look up a user by name or verify their identity using the last 4 digits of their credit card.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The full name of the user to search for'
        },
        user_id: {
          type: 'string',
          description: 'The user ID (if already known from a previous lookup)'
        },
        last_4_digits: {
          type: 'string',
          description: 'The last 4 digits of the credit card for verification'
        }
      },
      required: []
    }
  },
  {
    type: 'function',
    name: 'verify_rfid',
    description: 'Verify if an RFID card is active and valid for charging.',
    parameters: {
      type: 'object',
      properties: {
        rfid_number: {
          type: 'string',
          description: 'The RFID card number printed on the card (can contain letters and numbers, e.g., ABC123 or 12AB34CD)'
        }
      },
      required: ['rfid_number']
    }
  },
  {
    type: 'function',
    name: 'get_rfid',
    description: 'Get RFID and billing status for a user by their user ID.',
    parameters: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID to look up'
        },
        station_name: {
          type: 'string',
          description: 'The name or ID of the charging station (optional)'
        },
        connector_id: {
          type: 'string',
          description: 'The connector number (optional)'
        }
      },
      required: ['user_id', 'station_name', 'connector_id']
    }
  },
  {
    type: 'function',
    name: 'remote_control',
    description: 'Remotely start or stop a charging session on a specific connector.',
    parameters: {
      type: 'object',
      properties: {
        station_id: {
          type: 'string',
          description: 'The charging station ID'
        },
        connector_id: {
          type: 'string',
          description: 'The connector number to control'
        },
        action: {
          type: 'string',
          enum: ['start', 'stop'],
          description: 'The action to perform: start or stop charging'
        },
        user_id: {
          type: 'string',
          description: 'The user ID for the charging session'
        },
        rfid_number: {
          type: 'string',
          description: 'The RFID card number if applicable'
        }
      },
      required: ['station_id', 'connector_id', 'action', 'rfid_number']
    }
  },

  {
    type: 'function',
    name: 'check_cdrs',
    description: 'Check charging session history (CDRs - Charge Detail Records) for a user.',
    parameters: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID to look up charging history for'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records to return (default: 5)'
        }
      },
      required: ['user_id']
    }
  },
  {
    type: 'function',
    name: 'check_invoice',
    description: 'Retrieve invoice information for a user.',
    parameters: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID to look up invoices for'
        }
      },
      required: ['user_id']
    }
  },
  {
    type: 'function',
    name: 'invoice_sending_agent',
    description: 'Send invoice or CDR download link to the user via email or SMS.',
    parameters: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'The user ID'
        },
        type: {
          type: 'string',
          enum: ['invoice', 'cdr'],
          description: 'Type of document to send'
        }
      },
      required: ['user_id', 'type']
    }
  },
  {
    type: 'function',
    name: 'charge_station_tariff',
    description: 'Get the tariff/pricing information for a charging station.',
    parameters: {
      type: 'object',
      properties: {
        station_id: {
          type: 'string',
          description: 'The charging station ID'
        }
      },
      required: ['station_id']
    }
  },
  {
    type: 'function',
    name: 'priority',
    description: 'Escalate the call to a human agent. Use when user requests human support or when workflows fail.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'The reason for escalation'
        },
        call_sid: {
          type: 'string',
          description: 'The Twilio call SID for reference'
        },
        user_id: {
          type: 'string',
          description: 'The user ID if known'
        }
      },
      required: ['reason']
    }
  }
];

// Map tool names to their n8n webhook endpoints
export const TOOL_ENDPOINTS = {
  station_verification: '/station-verification',
  user_management: '/user-management',
  verify_rfid: '/verify-rfid',
  get_rfid: '/get-rfid',
  remote_control: '/remote-control',
  check_cdrs: '/check-cdrs',
  check_invoice: '/check-invoice',
  invoice_sending_agent: '/invoice-sending',
  charge_station_tariff: '/station-tariff',
  priority: '/priority-escalation'
};
