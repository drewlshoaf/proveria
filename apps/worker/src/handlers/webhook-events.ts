import { createHmac, randomUUID } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';
import {
  webhookDeliveries,
  webhookEndpoints,
  type DrizzleClient,
} from '@proveria/db';

export interface CreateWebhookDeliveriesInput {
  tenantId: string;
  eventType: string;
  data: Record<string, unknown>;
  occurredAt?: Date;
}

export interface CreatedWebhookDelivery {
  id: string;
  endpointId: string;
}

const signWebhookPayload = (
  secret: string,
  timestamp: string,
  body: string,
): string => {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
};

export const createWebhookDeliveries = async (
  db: DrizzleClient,
  input: CreateWebhookDeliveriesInput,
): Promise<CreatedWebhookDelivery[]> => {
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.tenantId, input.tenantId),
        isNull(webhookEndpoints.disabledAt),
      ),
    );
  const interested = endpoints.filter((endpoint) =>
    endpoint.events.includes(input.eventType),
  );
  if (interested.length === 0) return [];

  const occurredAt = input.occurredAt ?? new Date();
  const rows = interested.map((endpoint) => {
    const payload = {
      id: `evt_${randomUUID().replace(/-/g, '')}`,
      type: input.eventType,
      tenantId: input.tenantId,
      createdAt: occurredAt.toISOString(),
      data: input.data,
    };
    const body = JSON.stringify(payload);
    return {
      tenantId: input.tenantId,
      endpointId: endpoint.id,
      eventType: input.eventType,
      payload,
      signature: signWebhookPayload(
        endpoint.signingSecret,
        occurredAt.toISOString(),
        body,
      ),
      status: 'pending',
      nextAttemptAt: occurredAt,
    };
  });

  return await db
    .insert(webhookDeliveries)
    .values(rows)
    .returning({ id: webhookDeliveries.id, endpointId: webhookDeliveries.endpointId });
};
