# S3 / MinIO parity checklist

Proveria runs against MinIO in local dev and against real AWS S3 in
pilot / prod. The two are API-compatible for the operations we use, but
there are behavioral edges we've hit (or anticipate) that this doc
captures so the move to S3 doesn't surprise anyone.

This is M15/C57 deliverable scope — a checklist, not an exhaustive
operator guide. Update as new edges surface.

## What we use today

All object storage interactions go through `apps/api/src/objects/client.ts`
and `apps/worker/src/index.ts` via the AWS SDK v3 (`@aws-sdk/client-s3`).
Operations in use:

- `PutObjectCommand` — upload manifest, leaves.jsonl, validation-result.json,
  receipt.json, signed-receipt.pdf, lookup result packages, lookup PDFs.
- `GetObjectCommand` — fetch manifest, fetch receipt JSON / PDF on read,
  fetch lookup PDFs.

We do NOT use multipart, presigned URLs, lifecycle policies, replication,
or object locking. V1 reads/writes whole objects sized in the KB-to-MB
range.

## Known compatibility surface

### Bucket creation
- **MinIO:** must `mc mb` the bucket explicitly before the api/worker
  can write to it. The dev docker-compose script does this.
- **S3:** `aws s3 mb` or Terraform `aws_s3_bucket`. Pilot environments
  should provision the bucket out-of-band.

### Path-style addressing
- Dev / MinIO uses path-style (`http://localhost:9000/proveria-artifacts/...`)
  via `forcePathStyle: true` in the S3Client config (gated by
  `S3_FORCE_PATH_STYLE` env var).
- Real S3 supports both path-style and virtual-hosted-style. Pilot
  defaults to virtual-hosted (`S3_FORCE_PATH_STYLE=false`).

### Region
- MinIO ignores the region; we set `us-east-1` as a placeholder.
- S3 enforces it. Make sure `S3_REGION` matches the actual bucket
  region or operations return `PermanentRedirect`.

### Eventual consistency (mostly historical)
- S3 has been strongly consistent since 2020 for read-after-write,
  including overwrites. No special handling needed.
- MinIO is also strongly consistent.

### Error responses
- Both return AWS-shaped error envelopes (`<Error><Code>NoSuchKey…`).
  Our handlers check error codes via the SDK's typed exceptions
  (`NoSuchKey`, `AccessDenied`); same code path works on both.

### Performance
- MinIO local is ~3× faster than S3 cross-AZ on small objects (sub-100KB).
  Watch for latency regressions in the M15 walkthroughs when pointing at
  real S3 — particularly the receipt-generation worker, which fetches the
  manifest from S3 right after PUTting it.

### Encryption
- MinIO can be configured for SSE; we don't use it.
- S3 should be configured with `BucketEncryption` set to `aws:kms` or
  `AES256` in the pilot environment. Our writes don't pass
  `ServerSideEncryption` headers, so default-encryption settings on
  the bucket apply.

### Storage class
- We always write to the default storage class. No need to set
  `StorageClass` explicitly. Lifecycle policies can downgrade aged
  objects (`STANDARD_IA`, `GLACIER`) without affecting our reads, but
  cold-restore latency will affect verification UX. Recommend keeping
  the immutable evidence prefixes (`tenants/{...}/manifest/`,
  `receipt/`) in STANDARD.

### Versioning + object lock
- Not required by V1 (the producer-signed manifest IS the evidence).
- For pilot, recommend enabling S3 versioning at the bucket level as
  a defense-in-depth against accidental deletion. We never overwrite
  immutable artifacts so versioning adds no UX noise.
- Object Lock (`COMPLIANCE` mode) would be appropriate for legally-held
  evidence but is post-V1.

### Costs to watch
- We list zero objects per request in normal operation, but the M15
  admin endpoints could grow to scan failed-job artifact prefixes.
  Keep an eye on `ListObjectsV2` cost if a scanning endpoint is added.
- We DO NOT use CloudFront in front of the artifacts bucket in V1.
  All reads come through the api process (`getJsonText` etc.) which
  is fine at pilot volume.

## What to verify before pilot

- [ ] Bucket `S3_ARTIFACTS_BUCKET` exists in `S3_REGION`, encrypted.
- [ ] IAM role grants `s3:GetObject`, `s3:PutObject` (no `s3:DeleteObject`
      — we never delete in V1).
- [ ] `S3_FORCE_PATH_STYLE=false` for real S3.
- [ ] Versioning enabled (recommended).
- [ ] Lifecycle policies do NOT downgrade `tenants/*` prefixes in V1.
- [ ] The api + worker can both reach the bucket from their respective
      ECS tasks (subnet + VPC endpoints, no public NAT egress required
      if a VPC endpoint exists for S3).
- [ ] `/readyz` returns `ok` once IAM + region + endpoint are right
      — `probeMinio` is region-agnostic so it works against S3 too.
