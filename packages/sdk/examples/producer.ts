import { ProveriaClient, sha256Hex } from '../src/index.js';

const client = new ProveriaClient({
  apiKey: process.env.PROVERIA_API_KEY!,
  tenant: process.env.PROVERIA_TENANT!,
  apiUrl: process.env.PROVERIA_API_URL,
});

const sha256 = sha256Hex('replace with file bytes or a Buffer');

const created = await client.attestations.createHash({
  project: 'evaluation-evidence',
  label: `sdk-example-${Date.now()}`,
  sha256,
  fileName: 'example.txt',
  byteSize: Buffer.byteLength('replace with file bytes or a Buffer'),
});

console.log(JSON.stringify(created, null, 2));
