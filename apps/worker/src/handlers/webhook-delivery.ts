import { eq } from 'drizzle-orm';
import {
  webhookDeliveries,
  webhookEndpoints,
  type DrizzleClient,
} from '@proveria/db';

export interface SendWebhookDeliveryDeps {
  db: DrizzleClient;
  fetch?: typeof fetch;
}

export interface SendWebhookDeliveryOptions {
  attemptNumber: number;
  maxAttempts: number;
}

export interface SendWebhookDeliveryResult {
  ok: boolean;
  status: 'delivered' | 'retrying' | 'failed' | 'skipped';
  responseStatus?: number;
  error?: string;
}

const responsePreview = async (response: Response): Promise<string | null> => {
  try {
    const text = await response.text();
    return text.slice(0, 4000) || null;
  } catch {
    return null;
  }
};

export const sendWebhookDelivery = async (
  deps: SendWebhookDeliveryDeps,
  deliveryId: string,
  options: SendWebhookDeliveryOptions,
): Promise<SendWebhookDeliveryResult> => {
  const httpFetch = deps.fetch ?? fetch;
  const [row] = await deps.db
    .select({ delivery: webhookDeliveries, endpoint: webhookEndpoints })
    .from(webhookDeliveries)
    .innerJoin(
      webhookEndpoints,
      eq(webhookEndpoints.id, webhookDeliveries.endpointId),
    )
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);

  if (!row) return { ok: false, status: 'skipped', error: 'delivery_not_found' };
  if (row.delivery.status === 'delivered') {
    return { ok: true, status: 'delivered' };
  }
  if (row.endpoint.disabledAt) {
    await deps.db
      .update(webhookDeliveries)
      .set({
        status: 'failed',
        attempts: options.attemptNumber,
        lastAttemptAt: new Date(),
        responseBody: 'endpoint_disabled',
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return { ok: false, status: 'failed', error: 'endpoint_disabled' };
  }

  const body = JSON.stringify(row.delivery.payload);
  const timestamp = /^t=([^,]+)/.exec(row.delivery.signature)?.[1] ?? '';
  const headers = {
    'content-type': 'application/json',
    'user-agent': 'Proveria-Webhooks/1.0',
    'proveria-webhook-id': row.delivery.id,
    'proveria-webhook-event': row.delivery.eventType,
    'proveria-webhook-timestamp': timestamp,
    'proveria-webhook-signature': row.delivery.signature,
  };

  try {
    const response = await httpFetch(row.endpoint.url, {
      method: 'POST',
      headers,
      body,
    });
    const preview = await responsePreview(response);
    if (response.status >= 200 && response.status < 300) {
      await deps.db
        .update(webhookDeliveries)
        .set({
          status: 'delivered',
          attempts: options.attemptNumber,
          lastAttemptAt: new Date(),
          nextAttemptAt: null,
          responseStatus: response.status,
          responseBody: preview,
        })
        .where(eq(webhookDeliveries.id, deliveryId));
      return { ok: true, status: 'delivered', responseStatus: response.status };
    }

    const willRetry = options.attemptNumber < options.maxAttempts;
    await deps.db
      .update(webhookDeliveries)
      .set({
        status: willRetry ? 'retrying' : 'failed',
        attempts: options.attemptNumber,
        lastAttemptAt: new Date(),
        responseStatus: response.status,
        responseBody: preview,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return {
      ok: false,
      status: willRetry ? 'retrying' : 'failed',
      responseStatus: response.status,
      error: `webhook_http_${response.status}`,
    };
  } catch (err) {
    const willRetry = options.attemptNumber < options.maxAttempts;
    await deps.db
      .update(webhookDeliveries)
      .set({
        status: willRetry ? 'retrying' : 'failed',
        attempts: options.attemptNumber,
        lastAttemptAt: new Date(),
        responseBody: (err as Error).message,
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return {
      ok: false,
      status: willRetry ? 'retrying' : 'failed',
      error: (err as Error).message,
    };
  }
};
