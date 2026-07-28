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

export function buildChatwootTranscriptMessage(message) {
  return {
    content: `[VOICE ${message.role.toUpperCase()}]: ${message.text}`,
    message_type: 'outgoing',
    private: true
  };
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
    this.humanEscalationRequested = false; // Track if human agent was requested
    this.callerName = null; // Will be set when caller's name is learned
    this.referencePhoneNumber = null;
    this.tenant = null;
    this.knownCallerProfile = null;
    this.conversationLabels = new Set();
  }

  // Set the caller's real name (used for Chatwoot contact instead of phone number)
  setCallerName(name) {
    this.callerName = name;
  }

  setReferencePhoneNumber(phoneNumber) {
    if (!phoneNumber) return;
    this.referencePhoneNumber = String(phoneNumber);
  }

  setTenant(tenant) {
    this.tenant = tenant;
    if (tenant) {
      this.addConversationLabel(`tenant-${String(tenant).toLowerCase()}`);
    }
  }

  setKnownCallerProfile(profile) {
    this.knownCallerProfile = profile;
    if (profile) {
      this.addConversationLabel(`caller-${String(profile).toLowerCase()}`);
    }
  }

  addConversationLabel(label) {
    if (!label || typeof label !== 'string') return;
    const sanitized = label.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (!sanitized) return;
    this.conversationLabels.add(sanitized);
  }

  // Mark that human escalation was requested
  markHumanEscalation() {
    this.humanEscalationRequested = true;
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
    this.partialTranscriptBuffer = '';
    this.saveToFile();
    console.log(`[ASSISTANT]: ${text}`);
  }

  // Log partial AI transcript as it's being generated (streaming)
  logPartialAssistant(delta) {
    this.partialTranscriptBuffer = (this.partialTranscriptBuffer || '') + delta;
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
      chatwootConversationId: this.chatwootConversationId,
      referencePhoneNumber: this.referencePhoneNumber,
      tenant: this.tenant,
      knownCallerProfile: this.knownCallerProfile,
      labels: Array.from(this.conversationLabels)
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

      // Use end-client reference phone when available, otherwise fallback to incoming line
      const fallbackPhone = this.sessionId.replace('twilio-', '');
      const phoneNumber = this.referencePhoneNumber || fallbackPhone;
      const contactIdentifier = `twilio-${phoneNumber}`;

      // Step 1: Create or get a contact
      console.log('📍 Step 1: Creating/Getting contact...');
      const contactDisplayName = this.callerName || phoneNumber;
      let contactId;
      try {
        const contactPayload = {
          inbox_id: parseInt(this.chatwootInboxId),
          name: contactDisplayName,
          identifier: contactIdentifier,
          phone_number: phoneNumber
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
            `${this.chatwootUrl}/api/v1/accounts/${this.chatwootAccountId}/contacts/search?q=${encodeURIComponent(contactIdentifier)}`,
            {
              headers: {
                'api_access_token': this.chatwootApiToken
              }
            }
          );
          if (searchResponse.data.payload && searchResponse.data.payload.length > 0) {
            contactId = searchResponse.data.payload[0].id;
            console.log(`✅ Found existing contact with ID: ${contactId}`);
            
            // Update contact to ensure phone number and name are up to date
            try {
              await axios.put(
                `${this.chatwootUrl}/api/v1/accounts/${this.chatwootAccountId}/contacts/${contactId}`,
                {
                  name: contactDisplayName,
                  phone_number: phoneNumber
                },
                {
                  headers: {
                    'api_access_token': this.chatwootApiToken,
                    'Content-Type': 'application/json'
                  }
                }
              );
              console.log(`✅ Updated contact phone number: ${phoneNumber}`);
            } catch (updateError) {
              console.log(`⚠️ Could not update contact phone: ${updateError.message}`);
            }
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
        source_id: String(contactIdentifier),
        inbox_id: parseInt(this.chatwootInboxId),
        contact_id: String(contactId),
        status: this.humanEscalationRequested ? 'open' : 'resolved',
        priority: this.humanEscalationRequested ? 'urgent' : null,
        additional_attributes: {
          source: 'voice_transcript_archive',
          call_sid: this.callSid || null,
          tenant: this.tenant || null,
          known_caller_profile: this.knownCallerProfile || null,
          reference_phone_number: this.referencePhoneNumber || null
        }
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
          buildChatwootTranscriptMessage(msg),
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

  // Generate AI summary of the conversation
  async generateAISummary() {
    if (this.messages.length === 0) {
      return 'Aucun message dans la conversation.';
    }

    try {
      // Build conversation text for summarization
      const conversationText = this.messages
        .map(msg => `${msg.role === 'user' ? 'Client' : 'Assistant'}: ${msg.text}`)
        .join('\n');

      const metadataContext = [
        this.tenant ? `Tenant identifié: ${this.tenant}` : null,
        this.knownCallerProfile ? `Profil appelant: ${this.knownCallerProfile}` : null,
        this.callerName ? `Nom appelant: ${this.callerName}` : null,
        this.referencePhoneNumber ? `Numéro client de référence: ${this.referencePhoneNumber}` : null
      ].filter(Boolean).join('\n');

      // Use Azure OpenAI Chat Completion to generate summary
      const azureApiKey = process.env.AZURE_OPENAI_API_KEY;
      const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
      const chatDeployment = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o-mini';
      const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-10-01-preview';
      
      if (!azureApiKey || !endpoint) {
        console.log('Azure OpenAI Chat not configured, using basic summary');
        return this.generateBasicSummary();
      }

      console.log(`Generating AI summary using deployment: ${chatDeployment}`);
      
      const response = await axios.post(
        `${endpoint}/openai/deployments/${chatDeployment}/chat/completions?api-version=${apiVersion}`,
        {
          messages: [
            {
              role: 'system',
              content: `Tu es un assistant qui crée des résumés DÉTAILLÉS et COMPLETS de conversations téléphoniques pour une équipe de support client EV24 (bornes de recharge électrique). Un agent humain ou un autre assistant IA lira ce résumé pour comprendre exactement ce qui s'est passé — il n'aura PAS accès à la conversation originale. Sois donc exhaustif.

Génère un résumé structuré et actionnable en français avec les sections suivantes :

📞 **Informations de l'appel :**
- Nom du client (si mentionné)
- Numéro de téléphone ou identifiant (si disponible)
- Durée approximative / nombre d'échanges
- Tenant/CPO identifié (si disponible dans le contexte)
- Étiquettes importantes (ex: caller-cpo, tenant-borneco)

🎯 **Motif de l'appel :** (2-3 phrases)
Décris précisément pourquoi le client a appelé. Quel était son besoin initial ?

📋 **Détails du problème / de la demande :** (3-5 phrases)
- Quelle station / borne / connecteur était concerné(e) ? (nom, ID, emplacement)
- Quel réseau / tenant a été identifié ?
- Quel symptôme ou erreur le client a décrit ?
- Le client utilise l'app mobile ou une carte RFID ?
- Numéro de badge RFID, ID utilisateur, ou autres identifiants mentionnés

🔧 **Actions effectuées par l'assistant :** (3-5 phrases)
- Quels outils ont été utilisés ? (tenant_find, station_verification, user_management, remote_control, etc.)
- Quels résultats ont été obtenus ? (station opérative/inopérative, utilisateur trouvé/non trouvé, charge démarrée/échouée)
- L'identité du client a-t-elle été vérifiée ? Comment ?

✅ **Résultat final :** (1-2 phrases)
- Le problème a-t-il été résolu ? Partiellement ? Pas du tout ?
- Si résolu : quelle était la solution ?
- Si non résolu : quel est le blocage ?

⚠️ **Actions requises / Suivi :** (si applicable)
- Un rappel humain a-t-il été demandé ?
- Y a-t-il une action en attente ? (mise à jour de paiement, nouveau badge à activer, etc.)
- Le client doit-il faire quelque chose de son côté ?

💬 **Remarques / Contexte supplémentaire :**
- Le client semblait-il frustré, pressé, confus ?
- A-t-il mentionné des problèmes récurrents ou anciens ?
- Tout autre détail utile pour un futur suivi

Sois complet mais reste sous 1400 caractères maximum (contrainte technique Chatwoot).`
            },
            {
              role: 'user',
              content: `${metadataContext ? `${metadataContext}\n\n` : ''}${conversationText}`
            }
          ],
          max_tokens: 600,
          temperature: 0.3
        },
        {
          headers: {
            'api-key': azureApiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      const summary = response.data.choices[0]?.message?.content || this.generateBasicSummary();
      console.log(`✅ AI Summary generated: ${summary}`);
      return summary;

    } catch (error) {
      console.error('Error generating AI summary:', error.response?.data || error.message);
      console.log('Falling back to detailed basic summary');
      return this.generateBasicSummary();
    }
  }

  // Generate a basic summary without AI
  generateBasicSummary() {
    const userMessages = this.messages.filter(m => m.role === 'user');
    const assistantMessages = this.messages.filter(m => m.role === 'assistant');
    const allText = this.messages.map(m => m.text.toLowerCase()).join(' ');
    
    // Detect what the user needed (check multiple categories)
    const needs = [];
    if (allText.includes('humain') || allText.includes('agent') || allText.includes('parler')) {
      needs.push('Demande de parler à un agent humain');
    }
    if (allText.includes('panne') || allText.includes('marche pas') || allText.includes('problème') || allText.includes('erreur') || allText.includes('bloqué')) {
      needs.push('Signalement d\'un problème technique');
    }
    if (allText.includes('démarrer') || allText.includes('recharger') || allText.includes('commencer')) {
      needs.push('Démarrer une session de recharge');
    }
    if (allText.includes('arrêter') || allText.includes('stop') || allText.includes('terminer')) {
      needs.push('Arrêter une session de recharge');
    }
    if (allText.includes('station') || allText.includes('borne')) {
      needs.push('Question sur une borne de recharge');
    }
    if (allText.includes('rfid') || allText.includes('badge') || allText.includes('carte')) {
      needs.push('Question sur carte RFID/badge');
    }
    if (allText.includes('paiement') || allText.includes('facture') || allText.includes('consommation')) {
      needs.push('Question sur paiement/facturation/consommation');
    }
    if (allText.includes('compte') || allText.includes('inscription') || allText.includes('application') || allText.includes('app')) {
      needs.push('Question sur son compte/application');
    }
    if (allText.includes('tarif') || allText.includes('prix') || allText.includes('coût')) {
      needs.push('Question sur les tarifs');
    }
    if (needs.length === 0) {
      needs.push('Demande d\'assistance générale');
    }
    
    // Detect what was done
    const actions = [];
    if (allText.includes('recontacter') || allText.includes('rappel') || allText.includes('collègue')) {
      actions.push('Demande de rappel/transfert enregistrée');
    }
    if (allText.includes('vérifié') || allText.includes('vérification') || allText.includes('je vérifie')) {
      actions.push('Vérification effectuée dans le système');
    }
    if (allText.includes('résolu') || allText.includes('réglé') || allText.includes('c\'est fait') || allText.includes('démarré')) {
      actions.push('Problème résolu / action exécutée');
    }
    if (allText.includes('télécharger') || allText.includes('application') || allText.includes('wattzhub')) {
      actions.push('Guidage vers l\'application Wattzhub CPO');
    }
    if (actions.length === 0) {
      actions.push('Informations fournies');
    }
    
    // Build detailed summary
    const humanRequested = allText.includes('humain') || allText.includes('rappel') || allText.includes('recontacter');
    const duration = Math.round((new Date() - this.startTime) / 1000);
    
    let summary = `📞 Appel de ${duration} secondes — ${this.messages.length} messages échangés\n`;
    if (this.tenant) {
      summary += `🏢 Tenant: ${this.tenant}\n`;
    }
    if (this.knownCallerProfile) {
      summary += `🏷️ Profil appelant: ${this.knownCallerProfile}\n`;
    }
    if (this.referencePhoneNumber) {
      summary += `📱 Numéro client: ${this.referencePhoneNumber}\n`;
    }
    summary += `🎯 Motif(s): ${needs.join(', ')}\n`;
    
    // Include first few user messages as context
    if (userMessages.length > 0) {
      summary += `📋 Le client a dit: "${userMessages[0]?.text?.substring(0, 150) || 'N/A'}"`;
      if (userMessages.length > 1) {
        summary += ` — puis: "${userMessages[1]?.text?.substring(0, 100) || ''}"`;
      }
      summary += '\n';
    }
    
    summary += `🔧 Actions: ${actions.join(', ')}\n`;
    
    // Include last assistant response as resolution context
    if (assistantMessages.length > 0) {
      const lastResponse = assistantMessages[assistantMessages.length - 1]?.text?.substring(0, 150) || '';
      summary += `✅ Dernière réponse: "${lastResponse}"\n`;
    }
    
    if (humanRequested) {
      summary += `⚠️ Rappel humain demandé — à traiter en priorité`;
    }
    
    return summary;
  }

  // Toggle conversation priority to urgent (for human escalation)
  async applyConversationLabels() {
    if (!this.chatwootConversationId) {
      return { success: false, reason: 'no_conversation_id' };
    }

    if (!this.chatwootUrl || !this.chatwootAccountId || !this.chatwootApiToken) {
      return { success: false, reason: 'not_configured' };
    }

    const labels = Array.from(this.conversationLabels);
    if (labels.length === 0) {
      return { success: true, reason: 'no_labels' };
    }

    try {
      const labelsUrl = `${this.chatwootUrl}/api/v1/accounts/${this.chatwootAccountId}/conversations/${this.chatwootConversationId}/labels`;
      await axios.post(
        labelsUrl,
        { labels },
        {
          headers: {
            'api_access_token': this.chatwootApiToken,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`✅ Chatwoot labels applied: ${labels.join(', ')}`);
      return { success: true };
    } catch (error) {
      console.error('Error applying Chatwoot labels:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  // Toggle conversation priority to urgent (for human escalation)
  async togglePriorityUrgent() {
    if (!this.chatwootConversationId) {
      console.log('No Chatwoot conversation ID, cannot toggle priority');
      return { success: false, reason: 'no_conversation_id' };
    }

    if (!this.chatwootUrl || !this.chatwootAccountId || !this.chatwootApiToken) {
      console.log('Chatwoot not configured, cannot toggle priority');
      return { success: false, reason: 'not_configured' };
    }

    try {
      const priorityUrl = `${this.chatwootUrl}/api/v1/accounts/${this.chatwootAccountId}/conversations/${this.chatwootConversationId}/toggle_priority`;
      console.log(`🚨 Toggling conversation priority to urgent...`);

      await axios.post(
        priorityUrl,
        {
          priority: 'urgent'
        },
        {
          headers: {
            'api_access_token': this.chatwootApiToken,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`✅ Conversation priority set to URGENT`);
      return { success: true };

    } catch (error) {
      console.error('Error toggling priority:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  // Update Chatwoot conversation custom attribute with summary
  async updateChatwootSummary(summary) {
    if (!this.chatwootConversationId) {
      console.log('No Chatwoot conversation ID, cannot update summary');
      return { success: false, reason: 'no_conversation_id' };
    }

    if (!this.chatwootUrl || !this.chatwootAccountId || !this.chatwootApiToken) {
      console.log('Chatwoot not configured, cannot update summary');
      return { success: false, reason: 'not_configured' };
    }

    try {
      const updateUrl = `${this.chatwootUrl}/api/v1/accounts/${this.chatwootAccountId}/conversations/${this.chatwootConversationId}/custom_attributes`;
      console.log(`📝 Updating Chatwoot conversation summary...`);

      await axios.post(
        updateUrl,
        {
          custom_attributes: {
            summary: summary.length > 1490 ? summary.substring(0, 1487) + '...' : summary
          }
        },
        {
          headers: {
            'api_access_token': this.chatwootApiToken,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`✅ Chatwoot summary updated successfully`);
      return { success: true };

    } catch (error) {
      console.error('Error updating Chatwoot summary:', error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }

  // Close and send to Chatwoot
  async close() {
    console.log(`Closing conversation log: ${this.sessionId}`);
    console.log(`Total messages: ${this.messages.length}`);
    
    // Send to Chatwoot
    const result = await this.sendToChatwoot();
    
    // If human escalation was requested, toggle priority to urgent
    if (result.success && this.chatwootConversationId && this.humanEscalationRequested) {
      console.log('🚨 Human escalation was requested - setting priority to URGENT');
      await this.togglePriorityUrgent();
    }

    // Apply labels (tenant/caller profile/custom tags)
    if (result.success && this.chatwootConversationId) {
      await this.applyConversationLabels();
    }
    
    // Generate AI summary and update Chatwoot custom attribute
    if (result.success && this.chatwootConversationId) {
      const summary = await this.generateAISummary();
      await this.updateChatwootSummary(summary);
    }
    
    // Save final state
    this.saveToFile();
    
    return result;
  }
}

export default ChatwootLogger;
