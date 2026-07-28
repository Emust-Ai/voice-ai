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
    name: 'tenant_find',
    description: 'Identify the tenant/network from a station name, location, or area. This must be called FIRST before any other tool when a user mentions a location or station.',
    parameters: {
      type: 'object',
      properties: {
        location_or_station: {
          type: 'string',
          description: 'The station name, location, or area mentioned by the user (e.g., "Carrefour", "Paris 15", "Station ABC")'
        }
      },
      required: ['location_or_station']
    }
  },
  {
    type: 'function',
    name: 'station_verification',
    description: 'Verify the status of a charging station. Returns whether the station is operative or inoperative. Can search by station name, station ID, or area/location name.',
    parameters: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'The tenant name obtained from tenant_find tool'
        },
        station_name_or_location: {
          type: 'string',
          description: 'The name, ID, or area/location of the charging station to verify (e.g., "Station Paris 15", "Carrefour Montreuil", "Zone Commerciale Bercy")'
        }
      },
      required: ['tenant', 'station_name_or_location']
    }
  },
  {
    type: 'function',
    name: 'user_management',
    description: 'Look up a user by name or verify their identity using the last 4 digits of their credit card.',
    parameters: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'The tenant name obtained from tenant_find tool'
        },
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
      required: ['tenant']
    }
  },
  {
    type: 'function',
    name: 'verify_rfid',
    description: 'Verify if an RFID card is active and valid for charging.',
    parameters: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'The tenant name obtained from tenant_find tool'
        },
        rfid_number: {
          type: 'string',
          description: 'The RFID card number printed on the card (can contain letters and numbers, e.g., ABC123 or 12AB34CD)'
        }
      },
      required: ['tenant', 'rfid_number']
    }
  },
  {
    type: 'function',
    name: 'get_rfid',
    description: 'Get RFID and billing status for a user by their user ID.',
    parameters: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'The tenant name obtained from tenant_find tool'
        },
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
      required: ['tenant', 'user_id', 'station_name', 'connector_id']
    }
  },
  {
    type: 'function',
    name: 'remote_control',
    description: 'Remotely start or stop a charging session on a specific connector.',
    parameters: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'The tenant name obtained from tenant_find tool'
        },
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
      required: ['tenant', 'station_id', 'connector_id', 'action', 'rfid_number','user_id']
    }
  },

  {
    type: 'function',
    name: 'stop_charging',
    description: 'Stop an active charging session on a specific connector.',
    parameters: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'The tenant name obtained from tenant_find tool'
        },
        station_id: {
          type: 'string',
          description: 'The charging station ID'
        },
        connector_id: {
          type: 'string',
          description: 'The connector number to stop charging on'
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
      required: ['tenant', 'station_id', 'connector_id', 'user_id']
    }
  },
  {
    type: 'function',
    name: 'check_cdrs',
    description: 'Check charging session history (CDRs - Charge Detail Records) for a user.',
    parameters: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'The tenant name obtained from tenant_find tool'
        },
        user_id: {
          type: 'string',
          description: 'The user ID to look up charging history for'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records to return (default: 5)'
        }
      },
      required: ['tenant', 'user_id']
    }
  },
  {
    type: 'function',
    name: 'check_invoice',
    description: 'Retrieve invoice information for a user.',
    parameters: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'The tenant name obtained from tenant_find tool'
        },
        user_id: {
          type: 'string',
          description: 'The user ID to look up invoices for'
        }
      },
      required: ['tenant', 'user_id']
    }
  },
  {
    type: 'function',
    name: 'invoice_sending_agent',
    description: 'Send invoice or CDR download link to the user via email or SMS.',
    parameters: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'The tenant name obtained from tenant_find tool'
        },
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
      required: ['tenant', 'user_id', 'type']
    }
  },
  {
    type: 'function',
    name: 'charge_station_tariff',
    description: 'Get the tariff/pricing information for a charging station.',
    parameters: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'The tenant name obtained from tenant_find tool'
        },
        station_id: {
          type: 'string',
          description: 'The charging station ID'
        }
      },
      required: ['tenant', 'station_id']
    }
  },
  {
    type: 'function',
    name: 'priority',
    description: 'Request a callback from a human agent. Call this only after the caller explicitly asks for a human or clearly accepts Eva\'s immediately preceding callback offer. A station name, address, complaint, silence, or failed workflow is not consent. After success, state the Monday-Friday 9h00-17h00 callback hours and close briefly.',
    parameters: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'The tenant name obtained from tenant_find tool (if available)'
        },
        reason: {
          type: 'string',
          description: 'The reason for requesting human callback'
        },
        call_sid: {
          type: 'string',
          description: 'The Twilio call SID for reference'
        },
        caller_number: {
          type: 'string',
          description: 'The phone number of the caller - this is where the human agent will call back'
        },
        user_id: {
          type: 'string',
          description: 'The user ID if known'
        }
      },
      required: ['reason']
    }
  },
  {
    type: 'function',
    name: 'location',
    description: 'Find the closest charging station to a given location. Provide the latitude and longitude of the place the user mentions. The agent should estimate the coordinates based on the location name (city, address, landmark, etc.).',
    parameters: {
      type: 'object',
      properties: {
        lat: {
          type: 'number',
          description: 'Latitude of the location (e.g., 48.8566 for Paris)'
        },
        lng: {
          type: 'number',
          description: 'Longitude of the location (e.g., 2.3522 for Paris)'
        }
      },
      required: ['lat', 'lng']
    }
  },
  {
    type: 'function',
    name: 'save_caller_info',
    description: 'Save caller reference info for future calls. You can save caller_name, caller_phone, or both. Never collect caller_name during the greeting or first turn; ask naturally mid-conversation after useful help has started. For CPO relayed calls (e.g., BornEco), save the END CLIENT phone number when provided so context and Chatwoot are anchored on the client number, not the CPO line.',
    parameters: {
      type: 'object',
      properties: {
        caller_name: {
          type: 'string',
          description: 'The full name of the caller as they stated it (e.g., "Jean Dupont", "Marie", "Ahmed Ben Ali")'
        },
        caller_phone: {
          type: 'string',
          description: 'End-client phone number reference (E.164 preferred, e.g., +33612345678). Use this for CPO relayed calls to anchor the profile on the real client number.'
        }
      }
    }
  },
  {
    type: 'function',
    name: 'request_location_tool',
    description: 'Send an SMS asking the caller for their address or GPS position. Use this immediately whenever the caller says they do not know where they are, cannot identify the station, cannot see a landmark, or says they are lost. Do not ask for another station name first. After calling it, tell the caller to reply to the SMS with their location.',
    parameters: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: 'Brief note telling caller SMS is being sent'
        }
      },
      required: []
    }
  },
  {
    type: 'function',
    name: 'generate_qr_code',
    description: 'Request a charging QR-code URL from n8n; the voice server then sends that returned URL to the caller by SMS. Use only when the caller cannot use the mobile app and has no working RFID card. The tenant, exact charging station name, and connector ID must already be known and confirmed.',
    parameters: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          enum: ['borneco', '7hub', 'autoplug', 'ght', 'nexity', 'mycompany'],
          description: 'The lowercase tenant key obtained from tenant_find or caller context; it must match one of the n8n workflow branches'
        },
        charging_station_name: {
          type: 'string',
          description: 'The exact charging station name required by the CPO API'
        },
        connector_id: {
          type: 'string',
          description: 'The exact connector number selected by the caller'
        }
      },
      required: ['tenant', 'charging_station_name', 'connector_id']
    }
  }
];

// Map tool names to their n8n webhook endpoints
export const TOOL_ENDPOINTS = {
  tenant_find: '/tenant-find',
  station_verification: '/station-verification',
  user_management: '/user-management',
  verify_rfid: '/verify-rfid',
  get_rfid: '/get-rfid',
  remote_control: '/remote-control',
  stop_charging: '/stop-charging',
  check_cdrs: '/check-cdrs',
  check_invoice: '/check-invoice',
  invoice_sending_agent: '/invoice-sending',
  charge_station_tariff: '/station-tariff',
  priority: '/priority-escalation',
  location: '/location',
  request_location_tool: '/request-location',
  generate_qr_code: '/qr-code'
};
