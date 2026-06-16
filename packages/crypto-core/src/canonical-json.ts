// RFC 8785 (JSON Canonicalization Scheme) — minimal implementation.
//
// Used by Protocol V1 §2 wherever a JSON value crosses a trust boundary
// (manifests, result packages, signed audit payloads). The output is the
// UTF-8 byte stream of a canonical JSON serialization with:
//
//   - object keys sorted by UTF-16 code-unit order (RFC 8785 §3.2.3). This is
//     JavaScript's native string comparison; it differs from code-point order
//     only for non-BMP characters, where RFC 8785 mandates the code-unit form.
//   - no insignificant whitespace
//   - ECMAScript ToString for numbers (deferred to JSON.stringify)
//   - minimal string escapes (deferred to JSON.stringify)
//
// Numbers: every value canonicalized here crosses a trust boundary, so we
// enforce Protocol V1 §2 rule 1 directly — only safe integers are allowed.
// Non-integer numbers and integers outside [-(2^53-1), 2^53-1] are rejected
// rather than risk a non-RFC-8785 float serialization. NaN, ±Infinity, and
// undefined (which RFC 8785 cannot serialize at all) are likewise rejected.

const TEXT_ENCODER = new TextEncoder();

/** Returns the canonical UTF-8 byte serialization of `value`. */
export const canonicalize = (value: unknown): Uint8Array => {
  return TEXT_ENCODER.encode(canonicalizeToString(value));
};

/** Returns the canonical string (UTF-8 codepoints) without encoding. */
export const canonicalizeToString = (value: unknown): string => {
  if (value === null) return 'null';
  if (value === undefined) {
    throw new Error('canonical JSON cannot serialize `undefined`');
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(
        `canonical JSON forbids non-finite numbers (got ${String(value)})`,
      );
    }
    // Protocol V1 §2 rule 1: integers and strings only in cryptographic
    // payloads, and integers must be within the safe range. Reject anything
    // else here rather than emit a number whose serialization is not
    // guaranteed RFC 8785-canonical.
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        `canonical JSON forbids non-integer or non-safe-integer numbers ` +
          `(got ${String(value)}); use a string for large or fractional values`,
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    // JSON.stringify already produces RFC 8785-compatible string escapes:
    // only \" \\ and U+0000..U+001F are escaped; higher Unicode preserved.
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalizeToString).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // RFC 8785 §3.2.3: sort keys by UTF-16 code units. JavaScript's default
    // string comparison is exactly that — do not substitute code-point order.
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      parts.push(JSON.stringify(k) + ':' + canonicalizeToString(obj[k]));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new Error(`canonical JSON forbids value of type ${typeof value}`);
};
