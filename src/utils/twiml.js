/**
 * Generate TwiML response for incoming calls
 * This instructs Twilio to connect the call to our WebSocket server
 * Uses bidirectional streaming for lowest latency
 * The action URL tells Twilio what to do when the stream ends
 */
export function generateTwiML(websocketUrl, callerNumber) {
  // Extract host from websocket URL to build action URL
  const host = websocketUrl.replace('wss://', '').replace('/media-stream', '');
  const actionUrl = `https://${host}/stream-ended`;
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect action="${actionUrl}">
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
