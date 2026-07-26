export function extractQrCodeUrl(result) {
  const queue = [result];
  const visited = new Set();

  while (queue.length > 0) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);

    for (const key of ['fullUrl', 'qrCodeUrl', 'qr_code_url']) {
      if (typeof value[key] === 'string' && /^https?:\/\//i.test(value[key])) {
        return value[key];
      }
    }

    if (Array.isArray(value)) {
      queue.push(...value);
    } else {
      queue.push(...Object.values(value));
    }
  }

  return null;
}

export function buildQrRequestKey({ tenant, charging_station_name, connector_id }) {
  return [tenant, charging_station_name, connector_id]
    .map(value => String(value || '').trim().toLowerCase())
    .join('|');
}

export async function sendQrCodeSms({ result, twilioClient, from, to }) {
  // n8n generates the QR code; this service only extracts its returned URL
  // and delivers that URL to the active caller through Twilio.
  const qrCodeUrl = extractQrCodeUrl(result);
  if (!qrCodeUrl) {
    return {
      success: false,
      error: 'The QR-code workflow did not return a fullUrl.'
    };
  }

  if (!twilioClient || !from || !to) {
    return {
      success: false,
      error: 'The QR code was generated, but SMS delivery is not configured.'
    };
  }

  try {
    const message = await twilioClient.messages.create({
      body: `ev24 - Voici votre lien QR pour demarrer la recharge : ${qrCodeUrl}`,
      from,
      to
    });

    return {
      success: true,
      message: 'QR code generated and sent to the caller by SMS.',
      qrCodeUrl,
      messageSid: message.sid
    };
  } catch (error) {
    return {
      success: false,
      error: `The QR code was generated, but the SMS could not be sent: ${error.message}`,
      qrCodeUrl
    };
  }
}
