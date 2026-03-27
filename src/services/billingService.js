import crypto from 'crypto';
import axios from 'axios';

const LAGO_API_URL = process.env.LAGO_API_URL;
const LAGO_API_KEY = process.env.LAGO_API_KEY;

/**
 * Send usage events to Lago for billing after a voice call response completes.
 * Sends two events: one for audio tokens, one for text tokens.
 *
 * @param {string} customerId - User's external customer ID in Lago (MongoDB _id)
 * @param {string} subscriptionId - User's Lago subscription ID (e.g. "sub_69baa592..._1774260090416")
 * @param {object} usage - Token usage from OpenAI response.done event
 * @param {number} usage.audioInputTokens - Audio input tokens consumed
 * @param {number} usage.audioOutputTokens - Audio output tokens consumed
 * @param {number} usage.textInputTokens - Text input tokens consumed
 * @param {number} usage.textOutputTokens - Text output tokens consumed
 * @param {object} logger - Logger instance
 */
export async function billVoiceUsage(customerId, subscriptionId, usage, logger) {
  if (!LAGO_API_URL || !LAGO_API_KEY) {
    logger.warn('Lago billing not configured (LAGO_API_URL or LAGO_API_KEY missing). Skipping billing.');
    return;
  }

  if (!customerId || !subscriptionId) {
    logger.warn('Missing customerId or subscriptionId for billing. Skipping.');
    return;
  }

  const headers = {
    'Authorization': `Bearer ${LAGO_API_KEY}`,
    'Content-Type': 'application/json',
  };

  // Send audio tokens event
  const totalAudioTokens = (usage.audioInputTokens || 0) + (usage.audioOutputTokens || 0);
  if (totalAudioTokens > 0) {
    try {
      await axios.post(`${LAGO_API_URL}/api/v1/events`, {
        event: {
          transaction_id: crypto.randomUUID(),
          code: 'audio_tokens',
          external_customer_id: customerId,
          external_subscription_id: subscriptionId,
          properties: { tokens: totalAudioTokens },
        },
      }, { headers });
      logger.info(`Lago billed ${totalAudioTokens} audio tokens for customer ${customerId}`);
    } catch (error) {
      logger.error({ err: error, status: error.response?.status, data: error.response?.data },
        `Failed to bill audio tokens to Lago for customer ${customerId}`);
    }
  }

  // Send text tokens event
  const totalTextTokens = (usage.textInputTokens || 0) + (usage.textOutputTokens || 0);
  if (totalTextTokens > 0) {
    try {
      await axios.post(`${LAGO_API_URL}/api/v1/events`, {
        event: {
          transaction_id: crypto.randomUUID(),
          code: 'text_tokens',
          external_customer_id: customerId,
          external_subscription_id: subscriptionId,
          properties: { tokens: totalTextTokens },
        },
      }, { headers });
      logger.info(`Lago billed ${totalTextTokens} text tokens for customer ${customerId}`);
    } catch (error) {
      logger.error({ err: error, status: error.response?.status, data: error.response?.data },
        `Failed to bill text tokens to Lago for customer ${customerId}`);
    }
  }
}
