/**
 * Generate TwiML response for incoming calls
 * This instructs Twilio to connect the call to our WebSocket server
 * Uses bidirectional streaming for lowest latency
 */
export function generateTwiML(websocketUrl, callerNumber) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${websocketUrl}">
      <Parameter name="callerNumber" value="${callerNumber}" />
    </Stream>
  </Connect>
</Response>`;
}

/**
 * Generate TwiML for call transfer
 */
export function generateTransferTwiML(phoneNumber) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please hold while I transfer your call.</Say>
  <Dial>${phoneNumber}</Dial>
</Response>`;
}

/**
 * Generate TwiML for voicemail
 */
export function generateVoicemailTwiML(recordingUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please leave a message after the beep.</Say>
  <Record 
    action="${recordingUrl}"
    maxLength="120"
    transcribe="true"
  />
</Response>`;
}
