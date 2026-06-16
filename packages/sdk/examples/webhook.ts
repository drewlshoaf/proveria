import { createServer } from 'node:http';

import { verifyWebhookSignatureDetailed } from '../src/index.js';

const signingSecret = process.env.PROVERIA_WEBHOOK_SECRET;
const port = Number(process.env.PORT ?? 4242);

if (!signingSecret) {
  throw new Error('Set PROVERIA_WEBHOOK_SECRET before starting the receiver.');
}

const server = createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end('method not allowed');
    return;
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  req.on('end', () => {
    const rawBody = Buffer.concat(chunks);
    const signatureHeader = singleHeader(req.headers['proveria-webhook-signature']);
    const verification = verifyWebhookSignatureDetailed({
      signingSecret,
      signatureHeader: signatureHeader ?? '',
      body: rawBody,
    });

    if (!verification.valid) {
      res.writeHead(400).end(`invalid webhook signature: ${verification.reason}`);
      return;
    }

    const event = JSON.parse(rawBody.toString('utf8')) as {
      id: string;
      type: string;
      data: unknown;
    };

    switch (event.type) {
      case 'attestation.confirmed':
        console.log('attestation confirmed', event.id, event.data);
        break;
      case 'attestation.failed':
        console.log('attestation failed', event.id, event.data);
        break;
      case 'receipt.issued':
        console.log('receipt issued', event.id, event.data);
        break;
      default:
        console.log('unhandled webhook event', event.type, event.id);
    }

    res.writeHead(204).end();
  });
});

server.listen(port, () => {
  console.log(`Proveria webhook receiver listening on http://127.0.0.1:${port}`);
});

const singleHeader = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;
