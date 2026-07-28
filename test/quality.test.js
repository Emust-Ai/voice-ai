import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPENAI_CONFIG,
  VOICE_AGENT_INSTRUCTIONS,
  createTranscriptionConfig
} from '../src/config/openai.js';
import { CallMemory } from '../src/services/callMemory.js';
import { generateCallerContextPrompt } from '../src/services/userContextService.js';
import { parseLocation } from '../src/services/openChargeMapService.js';
import { buildQrRequestKey, extractQrCodeUrl, sendQrCodeSms } from '../src/services/qrCodeService.js';
import { executeN8nTool } from '../src/services/n8nService.js';
import { TOOLS, TOOL_ENDPOINTS } from '../src/config/tools.js';
import {
  ConversationLanguage,
  createLanguageResponseEvent,
  extractStationMention,
  isAffirmativeResponse,
  isLikelyTranscriptHallucination,
  needsLocationSms,
  needsQrFallback,
  requestsHumanAgent
} from '../src/services/conversationQuality.js';
import { buildChatwootTranscriptMessage } from '../src/services/chatwootLogger.js';

test('transcription uses French without keyword prompt steering', () => {
  const previousDeployment = process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT;
  process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT = 'ev24-transcribe';
  const config = createTranscriptionConfig();

  assert.equal(config.language, 'fr');
  assert.equal(config.model, 'ev24-transcribe');
  assert.equal(config.prompt, undefined);

  if (previousDeployment === undefined) {
    delete process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT;
  } else {
    process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT = previousDeployment;
  }
});

test('transcription defaults to the high-accuracy deployment name', () => {
  const previousDeployment = process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT;
  const previousModel = process.env.AZURE_OPENAI_TRANSCRIPTION_MODEL;
  delete process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT;
  delete process.env.AZURE_OPENAI_TRANSCRIPTION_MODEL;

  assert.equal(createTranscriptionConfig().model, 'gpt-4o-transcribe');

  if (previousDeployment !== undefined) {
    process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT = previousDeployment;
  }
  if (previousModel !== undefined) {
    process.env.AZURE_OPENAI_TRANSCRIPTION_MODEL = previousModel;
  }
});

test('realtime Whisper also stays in French without prompt steering', () => {
  const previousDeployment = process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT;
  process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT = 'ev24-gpt-realtime-whisper';

  assert.deepEqual(createTranscriptionConfig(), {
    model: 'ev24-gpt-realtime-whisper',
    language: 'fr'
  });

  if (previousDeployment === undefined) {
    delete process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT;
  } else {
    process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT = previousDeployment;
  }
});

test('phone VAD retains word beginnings and responds promptly', () => {
  assert.equal(OPENAI_CONFIG.turn_detection.threshold, 0.5);
  assert.equal(OPENAI_CONFIG.turn_detection.prefix_padding_ms, 500);
  assert.equal(OPENAI_CONFIG.turn_detection.silence_duration_ms, 650);
  assert.ok(OPENAI_CONFIG.max_response_output_tokens <= 250);
});

test('pure Arabic speech is detected as Arabic', () => {
  const memory = new CallMemory('test-call');

  memory.addUserMessage('مرحبا أحتاج مساعدة في محطة الشحن');

  assert.equal(memory.language, 'ar');
});

test('agent identity and new-caller greeting are consistent', () => {
  const callerPrompt = generateCallerContextPrompt(null);

  assert.match(VOICE_AGENT_INSTRUCTIONS, /Vous êtes Eva/);
  assert.match(VOICE_AGENT_INSTRUCTIONS, /N'exigez ni nom ni numéro client au début/);
  assert.match(callerPrompt, /Nom inconnu/);
  assert.match(callerPrompt, /aidez d’abord/);
});

test('text locations remain unverified until a station lookup', () => {
  assert.deepEqual(parseLocation('10 rue de Paris'), {
    text: '10 rue de Paris',
    type: 'text'
  });
  assert.deepEqual(parseLocation('48.8566, 2.3522'), {
    lat: 48.8566,
    lng: 2.3522,
    type: 'coordinates'
  });
});

test('QR workflow URL is extracted from wrapped n8n results', () => {
  assert.equal(
    extractQrCodeUrl({ success: true, data: [{ fullUrl: 'https://example.com/charge/abc' }] }),
    'https://example.com/charge/abc'
  );
  assert.equal(extractQrCodeUrl({ success: true, data: { message: 'started' } }), null);
});

test('generated QR link is sent to the caller by SMS', async () => {
  let sentPayload;
  const twilioClient = {
    messages: {
      create: async payload => {
        sentPayload = payload;
        return { sid: 'SM_TEST' };
      }
    }
  };

  const result = await sendQrCodeSms({
    result: { data: { fullUrl: 'https://example.com/charge/abc' } },
    twilioClient,
    from: '+33111111111',
    to: '+33222222222'
  });

  assert.equal(result.success, true);
  assert.equal(result.messageSid, 'SM_TEST');
  assert.equal(sentPayload.to, '+33222222222');
  assert.match(sentPayload.body, /https:\/\/example\.com\/charge\/abc/);
});

test('QR tool requires the values consumed by n8n', () => {
  const qrTool = TOOLS.find(tool => tool.name === 'generate_qr_code');

  assert.ok(qrTool);
  assert.equal(TOOL_ENDPOINTS.generate_qr_code, '/qr-code');
  assert.deepEqual(qrTool.parameters.required, [
    'tenant',
    'charging_station_name',
    'connector_id'
  ]);
});

test('QR tenant is normalized for the case-sensitive n8n switch', async () => {
  const originalFetch = global.fetch;
  let requestBody;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ fullUrl: 'https://example.com/charge/normalized' })
    };
  };

  try {
    const result = await executeN8nTool('generate_qr_code', {
      tenant: '  BorneCo  ',
      charging_station_name: 'opalion1',
      connector_id: '1'
    });

    assert.equal(result.success, true);
    assert.equal(requestBody.tenant, 'borneco');
    assert.equal(requestBody.charging_station_name, 'opalion1');
    assert.equal(requestBody.connector_id, '1');
  } finally {
    global.fetch = originalFetch;
  }
});

test('QR delivery key distinguishes corrected station or connector details', () => {
  const original = buildQrRequestKey({
    tenant: 'BorneCo',
    charging_station_name: 'Opalion1',
    connector_id: '1'
  });
  const sameNormalized = buildQrRequestKey({
    tenant: ' borneco ',
    charging_station_name: ' opalion1 ',
    connector_id: 1
  });
  const correctedConnector = buildQrRequestKey({
    tenant: 'borneco',
    charging_station_name: 'opalion1',
    connector_id: '2'
  });

  assert.equal(original, sameNormalized);
  assert.notEqual(original, correctedConnector);
});

test('subtitle and video-outro hallucinations are rejected', () => {
  const hallucinations = [
    'Les liens sont dans la description.',
    'Sous-titres réalisés par la communauté d’Amara.org',
    'Merci d’avoir regardé cette vidéo !',
    'Réalisé par Neo035',
    'Noms importants.'
    ,'โปรดติดตามตอนต่อไป',
    "Keep doing what you're doing."
  ];

  for (const transcript of hallucinations) {
    assert.equal(isLikelyTranscriptHallucination(transcript), true, transcript);
  }
  assert.equal(isLikelyTranscriptHallucination('La station Opalion 1 ne fonctionne pas.'), false);
});

test('unknown location immediately selects the SMS location fallback', () => {
  assert.equal(needsLocationSms('Je ne sais pas où je suis.'), true);
  assert.equal(needsLocationSms('Je ne vois rien autour de moi.'), true);
  assert.equal(needsLocationSms("J'ai aucune idée."), true);
  assert.equal(needsLocationSms('La station s’appelle Opalion 1.'), false);
});

test('missing app and RFID selects the QR fallback', () => {
  assert.equal(needsQrFallback("Je n'ai pas l'application mobile ou un RFID."), true);
  assert.equal(needsQrFallback("J'ai pas l'application mobile ou un RFID."), true);
  assert.equal(needsQrFallback("Je n'ai pas l'application mais j'ai une carte RFID."), false);
});

test('French remains locked through short and ambiguous turns', () => {
  const language = new ConversationLanguage('fr');

  assert.equal(language.observe('Non.'), 'fr');
  assert.equal(language.observe('Opalion 1'), 'fr');
  assert.equal(language.observe('Please check this charging station for me.'), 'fr');
  assert.equal(language.observe('The charger still does not work with my card.'), 'en');
});

test('response creation always carries the server language instruction', () => {
  const event = createLanguageResponseEvent('fr', 'Annoncez le résultat de l’outil.');

  assert.equal(event.type, 'response.create');
  assert.match(event.response.instructions, /uniquement en français/);
  assert.match(event.response.instructions, /Annoncez le résultat/);
});

test('station corrections and escalation consent are recognized', () => {
  assert.equal(extractStationMention('Il y a une autre station appelée Opalion 1.'), 'Opalion 1');
  assert.equal(requestsHumanAgent('Je veux parler à un agent humain.'), true);
  assert.equal(isAffirmativeResponse('Oui.'), true);
  assert.equal(isAffirmativeResponse('Il y a une autre station appelée Opalion 1.'), false);
});

test('station changes clear station-dependent call memory', () => {
  const memory = new CallMemory('station-change');
  memory.setInfo('station', 'Recharge Station 1');
  memory.setInfo('station_id', 'old-id');
  memory.setInfo('station_status', 'operative');
  memory.setInfo('connector_id', '1');

  memory.updateStation('Opalion 1');

  assert.equal(memory.getInfo('station'), 'Opalion 1');
  assert.equal(memory.getInfo('station_id'), undefined);
  assert.equal(memory.getInfo('station_status'), undefined);
  assert.equal(memory.getInfo('connector_id'), undefined);
});

test('Chatwoot transcript archive messages are private', () => {
  const payload = buildChatwootTranscriptMessage({ role: 'user', text: 'Bonjour' });

  assert.equal(payload.private, true);
  assert.equal(payload.message_type, 'outgoing');
  assert.match(payload.content, /^\[VOICE USER\]/);
});
