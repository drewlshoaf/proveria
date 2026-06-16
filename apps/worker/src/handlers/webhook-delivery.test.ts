import { eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  createClient,
  webhookDeliveries,
  type ClientHandle,
} from '@proveria/db';

import { sendWebhookDelivery } from './webhook-delivery.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria_test';

let handle: ClientHandle;

const truncateAll = async (): Promise<void> => {
  await handle.sql.unsafe(`
    TRUNCATE TABLE
      public.webhook_deliveries,
      public.webhook_endpoints,
      public.tenant_memberships,
      public.tenants,
      public.users
    RESTART IDENTITY CASCADE
  `);
};

const seedDelivery = async (): Promise<{
  deliveryId: string;
  endpointUrl: string;
}> => {
  const suffix = Math.random().toString(16).slice(2, 8);
  const [tenant] = await handle.sql<{ id: string }[]>`
    INSERT INTO public.tenants (name, slug, plan, is_personal)
    VALUES ('T', ${'t-' + suffix}, 'free', true) RETURNING id`;
  const [user] = await handle.sql<{ id: string }[]>`
    INSERT INTO public.users (email, password_hash)
    VALUES (${suffix + '@example.com'}, 'hash') RETURNING id`;
  const endpointUrl = `https://example.com/${suffix}`;
  const [endpoint] = await handle.sql<{ id: string }[]>`
    INSERT INTO public.webhook_endpoints
      (tenant_id, url, events, signing_secret, created_by_user_id)
    VALUES
      (${tenant!.id}, ${endpointUrl}, ${JSON.stringify(['receipt.issued'])}::jsonb,
       'whsec_test', ${user!.id})
    RETURNING id`;
  const payload = {
    id: 'evt_test',
    type: 'receipt.issued',
    tenantId: tenant!.id,
    createdAt: new Date().toISOString(),
    data: { ok: true },
  };
  const [delivery] = await handle.sql<{ id: string }[]>`
    INSERT INTO public.webhook_deliveries
      (tenant_id, endpoint_id, event_type, payload, signature)
    VALUES
      (${tenant!.id}, ${endpoint!.id}, 'receipt.issued',
       ${JSON.stringify(payload)}::jsonb, 't=2026-05-25T00:00:00.000Z,v1=abc')
    RETURNING id`;
  return { deliveryId: delivery!.id, endpointUrl };
};

beforeAll(async () => {
  handle = createClient({ url: DATABASE_URL, max: 3 });
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await truncateAll();
});

describe('sendWebhookDelivery', () => {
  it('posts signed JSON and marks a 2xx response delivered', async () => {
    const seeded = await seedDelivery();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 204 });
    };

    const result = await sendWebhookDelivery(
      { db: handle.db, fetch: fakeFetch },
      seeded.deliveryId,
      { attemptNumber: 1, maxAttempts: 5 },
    );

    expect(result).toEqual({ ok: true, status: 'delivered', responseStatus: 204 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(seeded.endpointUrl);
    expect((calls[0]?.init.headers as Record<string, string>)['proveria-webhook-signature']).toMatch(
      /^t=.+,v1=/,
    );

    const [delivery] = await handle.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, seeded.deliveryId));
    expect(delivery?.status).toBe('delivered');
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.responseStatus).toBe(204);
  });

  it('marks non-2xx responses retrying before the final attempt', async () => {
    const seeded = await seedDelivery();
    const result = await sendWebhookDelivery(
      {
        db: handle.db,
        fetch: async () => new Response('nope', { status: 500 }),
      },
      seeded.deliveryId,
      { attemptNumber: 1, maxAttempts: 5 },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe('retrying');
    const [delivery] = await handle.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, seeded.deliveryId));
    expect(delivery?.status).toBe('retrying');
    expect(delivery?.responseStatus).toBe(500);
  });

  it('marks network errors failed on the final attempt', async () => {
    const seeded = await seedDelivery();
    const result = await sendWebhookDelivery(
      {
        db: handle.db,
        fetch: async () => {
          throw new Error('connection refused');
        },
      },
      seeded.deliveryId,
      { attemptNumber: 5, maxAttempts: 5 },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    const [delivery] = await handle.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, seeded.deliveryId));
    expect(delivery?.status).toBe('failed');
    expect(delivery?.responseBody).toBe('connection refused');
  });
});
