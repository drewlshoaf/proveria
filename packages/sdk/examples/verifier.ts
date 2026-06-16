import { ProveriaClient, passageProofHashes, sha256Hex } from '../src/index.js';

const client = new ProveriaClient({
  apiKey: process.env.PROVERIA_API_KEY!,
  tenant: process.env.PROVERIA_TENANT!,
  apiUrl: process.env.PROVERIA_API_URL,
});

const attestationId = process.env.PROVERIA_ATTESTATION_ID!;
const fileHash = sha256Hex('replace with file bytes or a Buffer');

const wholeFileResult = await client.attestations.verifyHash({
  attestationId,
  sha256: fileHash,
  lookupKind: 'whole_file',
});

console.log(JSON.stringify(wholeFileResult, null, 2));

const passage = await passageProofHashes(
  'Paste one continuous source passage here for content proof verification.',
);

if (passage.hashes[0]) {
  const contentResult = await client.attestations.verifyHash({
    attestationId,
    sha256: passage.hashes[0],
    lookupKind: 'content',
  });
  console.log(JSON.stringify(contentResult, null, 2));
}
