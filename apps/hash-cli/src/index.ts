#!/usr/bin/env node
// Proveria Hash CLI — local hash utility for consumers and testers.
// Whole-file SHA-256 + shingle hashes for allowed workflows + result-package
// verification. Strictly local — no network calls. See docs/v1 §21.

import { hashFile } from './file.js';
import {
  writeFileHashPlain,
  writeJson,
  writeShinglePlain,
  writeVerifyPlain,
} from './output.js';
import { isShinglePreset, shingleFile } from './shingle.js';
import { verifyPackageFile } from './verify.js';

const VERSION = '0.0.0';

const USAGE = [
  `proveria-hash ${VERSION}`,
  '',
  'Usage:',
  '  proveria-hash --version                 Print version and exit.',
  '  proveria-hash file <path> [--json]      Whole-file SHA-256.',
  '  proveria-hash shingle <path>            Shingle hashes for a UTF-8 text file.',
  '          [--preset standard|broad|sensitive] [--json]',
  '  proveria-hash verify <package.json>     Re-verify a lookup result package.',
  '          [--public-key <base64url>] [--json]',
  '',
  'Output:',
  '  Default is shasum-shaped (one line per hash) for file/shingle;',
  '  "OK <package_id>" / "FAIL <package_id>" for verify.',
  '  --json emits a structured record on stdout.',
  '',
  'Strictly local — the CLI makes no network calls.',
  '',
].join('\n');

const die = (msg: string, code = 2): never => {
  process.stderr.write(`proveria-hash: ${msg}\n`);
  process.exit(code);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(USAGE);
    return;
  }
  if (args[0] === '--version' || args[0] === '-v') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const sub = args[0];
  const rest = args.slice(1);
  const wantJson = rest.includes('--json');
  // Build the positional list, skipping flag VALUES too — `--preset standard`
  // should yield zero positionals, not one.
  const FLAGS_WITH_VALUE = new Set(['--preset', '--public-key']);
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]!;
    if (a.startsWith('--')) {
      if (FLAGS_WITH_VALUE.has(a)) i += 1; // skip the value
      continue;
    }
    positional.push(a);
  }

  if (sub === 'file') {
    if (positional.length !== 1) {
      die('file: expected exactly one <path> argument');
    }
    const record = await hashFile(positional[0]!);
    if (wantJson) writeJson(record);
    else writeFileHashPlain(record);
    return;
  }

  if (sub === 'verify') {
    if (positional.length !== 1) {
      die('verify: expected exactly one <package.json> argument');
    }
    const keyIdx = rest.indexOf('--public-key');
    let proveriaPublicKey: string | undefined;
    if (keyIdx !== -1) {
      const v = rest[keyIdx + 1];
      if (v === undefined) die('verify: --public-key requires a value');
      else proveriaPublicKey = v;
    }
    const record = await verifyPackageFile(
      positional[0]!,
      proveriaPublicKey ? { proveriaPublicKey } : {},
    );
    if (wantJson) writeJson(record);
    else writeVerifyPlain(record);
    const allOk =
      record.proof_ok &&
      (!record.signature_required || record.signature_verified === true);
    process.exit(allOk ? 0 : 1);
  }

  if (sub === 'shingle') {
    if (positional.length !== 1) {
      die('shingle: expected exactly one <path> argument');
    }
    const presetIdx = rest.indexOf('--preset');
    let preset: 'standard' | 'broad' | 'sensitive' = 'standard';
    if (presetIdx !== -1) {
      const v = rest[presetIdx + 1];
      if (v === undefined || !isShinglePreset(v)) {
        die('shingle: --preset must be standard, broad, or sensitive');
      } else {
        preset = v;
      }
    }
    const record = await shingleFile(positional[0]!, { preset });
    if (wantJson) writeJson(record);
    else writeShinglePlain(record);
    return;
  }

  die(`unknown command: ${sub}`);
};

main().catch((err: Error) => {
  die(err.message ?? String(err), 1);
});
