# Voice Agent Improvements - TTS Quality & Context Management

## Changes Made

### 1. **Improved TTS Quality for Twilio Calls**

#### Changed Voice from 'alloy' to 'nova'
- **Reason**: 'nova' voice is optimized for natural, friendly conversation and performs better over phone lines
- **Impact**: Clearer speech, better pronunciation, more natural intonation over telephone compression
- **File**: [src/config/openai.js](src/config/openai.js)

#### Optimized VAD (Voice Activity Detection) Settings
- **threshold**: 0.45 (from 0.5) - More sensitive to capture speech over phone compression
- **prefix_padding_ms**: 300ms (from 500ms) - Faster response start time
- **silence_duration_ms**: 600ms (from 700ms) - Quicker turn-taking
- **Result**: Faster, more responsive conversation flow

#### Reduced max_response_output_tokens
- **Changed**: 500 tokens (from 4096)
- **Reason**: Shorter responses are better for phone conversations
- **Benefit**: Faster TTS generation, less user wait time, more concise answers

### 2. **Fixed Context Persistence Issue**

#### Added Critical Rule #2 - Clear Context When User Changes Location
The agent now explicitly:
- Forgets previous station names when user mentions a new one
- Always uses the MOST RECENT location mentioned
- Asks for clarification if confused: "Pour clarifier, vous êtes à quelle station maintenant?"

**Example scenario fixed:**
```
User: "I'm at arvea"
Agent: [Searches for arvea]
User: "Actually, I'm at Carrefour"
Agent: [NOW FORGETS arvea and searches ONLY for Carrefour] ✅
```

#### Made Tool Announcements Briefer (Rule #1)
- Changed from: "Un instant, je vérifie cela pour vous"
- To: "Un instant" or "Je vérifie"
- **Benefit**: Faster, more natural phone conversation

#### Added Rule #10 - Be Concise
- Explicitly instructs agent to keep responses SHORT and CLEAR
- Better for phone conversation experience

---

## Additional Recommendations

### 3. **Further TTS Quality Improvements**

#### Option A: Try Different Voices
Test these voices to find the best one for your use case:
- `nova` (current) - Friendly and upbeat ✅ Recommended for customer service
- `shimmer` - Clear and professional (try if nova isn't clear enough)
- `echo` - Warm and conversational

To change: Edit `voice: 'nova'` in [src/config/openai.js](src/config/openai.js#L8)

#### Option B: Consider Using ElevenLabs for Premium TTS
If Azure OpenAI TTS quality is still not sufficient:

1. **ElevenLabs Integration** (Best quality but adds cost and latency)
   - Ultra-clear voices optimized for telephony
   - Better multilingual support
   - More natural prosody

2. **Implementation approach:**
   ```javascript
   // After getting text from OpenAI, synthesize with ElevenLabs
   const elevenLabsAudio = await synthesizeWithElevenLabs(text);
   // Send to Twilio
   ```

#### Option C: Azure Neural Voices (Alternative)
Instead of Realtime API audio, use Azure Text-to-Speech directly:
- Voices like `fr-FR-DeniseNeural` or `fr-FR-HenriNeural`
- Higher quality than realtime synthesis
- Requires architectural change (text-only from OpenAI + separate TTS)

### 4. **Improve Whisper Transcription for Better Context**

Current transcription prompt is good, but you can enhance it:

```javascript
input_audio_transcription: {
  model: 'whisper-1',
  language: 'fr',
  prompt: `Ceci est un service client de recharge pour véhicules électriques.

STATIONS ET LIEUX COURANTS (toujours écrire exactement comme indiqué):
- Carrefour (supermarché)
- arvea (station)
- relais (station)
- Paris 15, Paris 16, etc.
- borne de recharge, station de recharge

SI L'UTILISATEUR CHANGE DE STATION, toujours transcrire la NOUVELLE station mentionnée.

Vocabulaire technique: RFID, badge, carte, connecteur, prise, câble, wattzhub, ev24.`
}
```

### 5. **Session Context Management**

To prevent context bleeding between topics, consider implementing conversation state tracking:

**File to create: `src/utils/conversationState.js`**
```javascript
export class ConversationState {
  constructor() {
    this.currentStation = null;
    this.currentTenant = null;
    this.userId = null;
  }

  updateStation(newStation) {
    if (newStation !== this.currentStation) {
      console.log(`🔄 Context switch: ${this.currentStation} → ${newStation}`);
      this.currentStation = newStation;
      this.currentTenant = null; // Clear tenant when station changes
    }
  }

  clear() {
    this.currentStation = null;
    this.currentTenant = null;
  }
}
```

Then in [twilioHandler.js](src/handlers/twilioHandler.js), track state:
```javascript
let conversationState = new ConversationState();

// Update state when tenant_find is called
if (toolName === 'tenant_find') {
  conversationState.updateStation(args.location_or_station);
}
```

---

## Testing Checklist

After deploying these changes, test:

- [ ] **Voice Clarity**: Call the system and verify voice is clearer
- [ ] **Response Speed**: Confirm responses start faster (300ms padding vs 500ms)
- [ ] **Context Reset**: 
  - Say "I'm at arvea"
  - Then say "Actually I'm at Carrefour"  
  - Verify it searches for Carrefour, NOT arvea
- [ ] **Conciseness**: Verify responses are shorter and more direct
- [ ] **Interruption**: Verify you can interrupt the AI mid-sentence

---

## Monitoring Recommendations

Add logging to track context issues:

**In [twilioHandler.js](src/handlers/twilioHandler.js)**:
```javascript
case 'conversation.item.input_audio_transcription.completed':
  if (message.transcript) {
    logger.info(`User: ${message.transcript}`);
    
    // Log potential station name changes
    const stationKeywords = ['arvea', 'carrefour', 'station', 'borne'];
    if (stationKeywords.some(kw => message.transcript.toLowerCase().includes(kw))) {
      logger.warn(`⚠️ STATION MENTIONED: "${message.transcript}"`);
    }
    
    if (chatwootLogger) {
      chatwootLogger.logUser(message.transcript);
    }
  }
  break;
```

---

## Expected Improvements

| Issue | Before | After |
|-------|--------|-------|
| **TTS Clarity** | Muffled over phone | Clearer with 'nova' voice |
| **Response Time** | 500ms+ delay | ~300ms faster start |
| **Context Bleeding** | Keeps searching "arvea" | Searches new station immediately |
| **Response Length** | Too verbose | Concise, phone-appropriate |

---

## Quick Rollback

If issues arise, revert to previous settings:
```javascript
// src/config/openai.js
voice: 'alloy',  // from 'nova'
max_response_output_tokens: 4096,  // from 500
threshold: 0.5,  // from 0.45
```

---

## Cost Impact

✅ **Reduced costs**: Shorter responses (500 tokens vs 4096) = ~87% less TTS cost per response

---

## Next Steps

1. Deploy changes
2. Test on Twilio phone calls
3. Monitor Chatwoot logs for context issues
4. If TTS still unclear, try `shimmer` voice
5. Consider ElevenLabs if Azure quality insufficient
