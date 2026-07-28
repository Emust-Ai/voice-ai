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

test('transcription uses automatic bilingual detection with relevant context', () => {
  const previousDeployment = process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT;
  process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT = 'ev24-transcribe';
  const config = createTranscriptionConfig({ tenant: 'borneco' });

  assert.equal(config.language, undefined);
  assert.equal(config.model, 'ev24-transcribe');
  assert.match(config.prompt, /French or Arabic/);
  assert.match(config.prompt, /borneco/);
  assert.match(config.prompt, /station names/);

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

test('realtime Whisper avoids unsupported prompt steering', () => {
  const previousDeployment = process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT;
  process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT = 'ev24-gpt-realtime-whisper';

  assert.deepEqual(createTranscriptionConfig(), {
    model: 'ev24-gpt-realtime-whisper'
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
  assert.ok(OPENAI_CONFIG.max_response_output_tokens <= 300);
});

test('pure Arabic speech is detected as Arabic', () => {
  const memory = new CallMemory('test-call');

  memory.addUserMessage('مرحبا أحتاج مساعدة في محطة الشحن');

  assert.equal(memory.language, 'ar');
});

test('agent identity and new-caller greeting are consistent', () => {
  const callerPrompt = generateCallerContextPrompt(null);

  assert.match(VOICE_AGENT_INSTRUCTIONS, /Vous êtes Eva/);
  assert.match(callerPrompt, /Ici Eva/);
  assert.match(callerPrompt, /help immediately/);
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
