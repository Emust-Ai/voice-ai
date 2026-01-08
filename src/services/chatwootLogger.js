import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs/conversations');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

class ChatwootLogger {
  constructor(sessionId, callSid = null) {
    this.sessionId = sessionId;
    this.callSid = callSid;
    this.messages = [];
    this.startTime = new Date();
    this.logFilePath = path.join(logsDir, `${sessionId}_${Date.now()}.json`);
    
    // Chatwoot configuration from environment variables
    this.chatwootUrl = process.env.CHATWOOT_URL; // e.g., https://app.chatwoot.com
    this.chatwootAccountId = process.env.CHATWOOT_ACCOUNT_ID;
    this.chatwootInboxId = process.env.CHATWOOT_INBOX_ID;
    this.chatwootApiToken = process.env.CHATWOOT_API_TOKEN;
    
    this.chatwootConversationId = null;
  }

  // Log user message
  logUser(text) {
    const message = {
      role: 'user',
      text,
      timestamp: new Date().toISOString()
    };
    this.messages.push(message);
    this.saveToFile();
    console.log(`[USER]: ${text}`);
  }

  // Log AI/assistant message
  logAssistant(text) {
    const message = {
      role: 'assistant',
      text,
      timestamp: new Date().toISOString()
    };
    this.messages.push(message);
    this.saveToFile();
    console.log(`[ASSISTANT]: ${text}`);
  }

  // Save to local JSON file
  saveToFile() {
    const data = {
      sessionId: this.sessionId,
      callSid: this.callSid,
      startTime: this.startTime.toISOString(),
      lastUpdate: new Date().toISOString(),
      messageCount: this.messages.length,
      messages: this.messages,
      chatwootConversationId: this.chatwootConversationId
    };

    try {
      fs.writeFileSync(this.logFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving conversation log:', error);
    }
  }

  // Create Chatwoot conversation and send all messages
  async sendToChatwoot() {
    console.log('=== Starting Chatwoot Integration ===');
    console.log(`Chatwoot URL: ${this.chatwootUrl}`);
    console.log(`Account ID: ${this.chatwootAccountId}`);
    console.log(`Inbox ID: ${this.chatwootInboxId}`);
    console.log(`API Token: ${this.chatwootApiToken ? '***' + this.chatwootApiToken.slice(-4) : 'NOT SET'}`);
    
    if (!this.chatwootUrl || !this.chatwootAccountId || !this.chatwootApiToken) {
      console.log('❌ Chatwoot not configured properly, skipping...');
      return { success: false, reason: 'not_configured' };
    }

    if (this.messages.length === 0) {
      console.log('❌ No messages to send to Chatwoot');
      return { success: false, reason: 'no_messages' };
    }

    try {
      // First, verify the inbox exists
      console.log('🔍 Verifying inbox exists...');
      const inboxVerifyUrl = `${this.chatwootUrl}/api/v1/accounts/${this.chatwootAccountId}/inboxes/${this.chatwootInboxId}`;
      console.log(`Testing access to: ${inboxVerifyUrl}`);
      
      try {
        const inboxResponse = await axios.get(inboxVerifyUrl, {
          headers: {
            'api_access_token': this.chatwootApiToken,
            'Content-Type': 'application/json'
          }
        });
        console.log(`✅ Inbox verified: ${inboxResponse.data.name} (Type: ${inboxResponse.data.channel_type})`);
      } catch (verifyError) {
        console.error('❌ Inbox verification failed!');
        console.error(`Status: ${verifyError.response?.status}`);
        console.error(`Error: ${JSON.stringify(verifyError.response?.data, null, 2)}`);
        console.error('');
        console.error('💡 This means:');
        console.error('   - Account ID or Inbox ID is incorrect');
        console.error('   - API token does not have access to this account/inbox');
        console.error('   - Check your Chatwoot Settings → Inboxes to get the correct inbox ID');
        return { 
          success: false, 
          reason: 'inbox_not_found',
          error: verifyError.response?.data 
        };
      }

      console.log(`📤 Sending conversation to Chatwoot (${this.messages.length} messages)...`);

      // Step 1: Create or get a contact
      console.log('📍 Step 1: Creating/Getting contact...');
      let contactId;
      try {
        const contactPayload = {
          inbox_id: parseInt(this.chatwootInboxId),
          name: `Session ${this.sessionId.substring(0, 20)}`,
          identifier: this.sessionId
        };
        console.log(`📦 Contact Payload:`, JSON.stringify(contactPayload, null, 2));
        
        const contactResponse = await axios.post(
          `${this.chatwootUrl}/api/v1/accounts/${this.chatwootAccountId}/contacts`,
          contactPayload,
          {
            headers: {
              'api_access_token': this.chatwootApiToken,
              'Content-Type': 'application/json'
            }
          }
        );
        contactId = contactResponse.data.payload.contact.id;
        console.log(`✅ Step 1 Complete: Contact created/retrieved with ID: ${contactId}`);
      } catch (contactError) {
        // If contact already exists, search for it
        if (contactError.response?.status === 422) {
          console.log('Contact already exists, searching...');
          const searchResponse = await axios.get(
            `${this.chatwootUrl}/api/v1/accounts/${this.chatwootAccountId}/contacts/search?q=${encodeURIComponent(this.sessionId)}`,
            {
              headers: {
                'api_access_token': this.chatwootApiToken
              }
            }
          );
          if (searchResponse.data.payload && searchResponse.data.payload.length > 0) {
            contactId = searchResponse.data.payload[0].id;
            console.log(`✅ Found existing contact with ID: ${contactId}`);
          } else {
            throw new Error('Could not create or find contact');
          }
        } else {
          throw contactError;
        }
      }

      // Step 2: Create a conversation in Chatwoot
      const conversationUrl = `${this.chatwootUrl}/api/v1/accounts/${this.chatwootAccountId}/conversations`;
      console.log(`📍 Step 2: Creating conversation at: ${conversationUrl}`);
      
      const conversationPayload = {
        source_id: String(this.sessionId),
        inbox_id: parseInt(this.chatwootInboxId),
        contact_id: String(contactId),
        status: 'open',
        additional_attributes: {}
      };
      console.log(`📦 Payload:`, JSON.stringify(conversationPayload, null, 2));

      const conversationResponse = await axios.post(
        conversationUrl,
        conversationPayload,
        {
          headers: {
            'api_access_token': this.chatwootApiToken,
            'Content-Type': 'application/json'
          }
        }
      );

      this.chatwootConversationId = conversationResponse.data.id;
      console.log(`✅ Step 2 Complete: Chatwoot conversation created with ID: ${this.chatwootConversationId}`);

      // Step 3: Send all messages to the conversation
      console.log(`📍 Step 3: Sending ${this.messages.length} messages...`);
      for (let i = 0; i < this.messages.length; i++) {
        const msg = this.messages[i];
        const messageUrl = `${this.chatwootUrl}/api/v1/accounts/${this.chatwootAccountId}/conversations/${this.chatwootConversationId}/messages`;
        console.log(`  📨 Message ${i + 1}/${this.messages.length} [${msg.role}]: ${msg.text.substring(0, 50)}...`);
        
        await axios.post(
          messageUrl,
          {
            content: `[${msg.role.toUpperCase()}]: ${msg.text}`,
            message_type: msg.role === 'user' ? 'incoming' : 'outgoing',
            private: false
          },
          {
            headers: {
              'api_access_token': this.chatwootApiToken,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log(`  ✅ Message ${i + 1} sent successfully`);
      }

      // Save the conversation ID to file
      this.saveToFile();

      console.log(`✅ Step 3 Complete: All messages sent to Chatwoot`);
      console.log(`🎉 Successfully sent ${this.messages.length} messages to Chatwoot conversation ${this.chatwootConversationId}`);
      return { 
        success: true, 
        conversationId: this.chatwootConversationId,
        messageCount: this.messages.length 
      };

    } catch (error) {
      console.error('❌ Error sending to Chatwoot:');
      console.error('Status:', error.response?.status);
      console.error('Status Text:', error.response?.statusText);
      console.error('Response Data:', JSON.stringify(error.response?.data, null, 2));
      console.error('Request URL:', error.config?.url);
      console.error('Request Method:', error.config?.method);
      console.error('Request Headers:', error.config?.headers);
      console.error('Full Error:', error.message);
      
      return { 
        success: false, 
        error: error.response?.data || error.message,
        status: error.response?.status,
        url: error.config?.url
      };
    }
  }

  // Get conversation summary
  getSummary() {
    return {
      sessionId: this.sessionId,
      callSid: this.callSid,
      startTime: this.startTime.toISOString(),
      duration: Math.round((new Date() - this.startTime) / 1000),
      messageCount: this.messages.length,
      chatwootConversationId: this.chatwootConversationId
    };
  }

  // Close and send to Chatwoot
  async close() {
    console.log(`Closing conversation log: ${this.sessionId}`);
    console.log(`Total messages: ${this.messages.length}`);
    
    // Send to Chatwoot
    const result = await this.sendToChatwoot();
    
    // Save final state
    this.saveToFile();
    
    return result;
  }
}

export default ChatwootLogger;
