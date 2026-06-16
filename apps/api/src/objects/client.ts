// S3 client wrapper. Configured for MinIO locally via S3_ENDPOINT +
// S3_FORCE_PATH_STYLE; talks to real S3 in pilot/prod by changing the env.
// See docs/v1 §6.3 and §7.2.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const endpoint = process.env.S3_ENDPOINT || undefined;
const region = process.env.S3_REGION ?? 'us-east-1';
const accessKeyId = process.env.S3_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY;
const forcePathStyle =
  (
    process.env.S3_FORCE_PATH_STYLE ?? (endpoint ? 'true' : 'false')
  ).toLowerCase() === 'true';
const credentials =
  accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;

export const ARTIFACTS_BUCKET =
  process.env.S3_ARTIFACTS_BUCKET ?? 'proveria-artifacts';

export const s3 = new S3Client({
  endpoint,
  region,
  forcePathStyle,
  credentials,
});

/** Object-key layout from docs/v1 §7.3. */
export const manifestKey = (
  tenantId: string,
  projectId: string,
  attestationId: string,
  attemptId: string,
): string =>
  `tenants/${tenantId}/projects/${projectId}/attestations/${attestationId}/attempts/${attemptId}/manifest.json`;

/** Where a lookup's result.json lives, keyed by package_id. */
export const lookupResultKey = (
  tenantId: string,
  projectId: string,
  attestationId: string,
  packageId: string,
): string =>
  `tenants/${tenantId}/projects/${projectId}/attestations/${attestationId}/lookups/${packageId}/result.json`;

export const putJson = async (
  key: string,
  body: Buffer | string,
): Promise<void> => {
  await putObject(key, body, 'application/json');
};

export const putObject = async (
  key: string,
  body: Buffer | string,
  contentType: string,
): Promise<void> => {
  await s3.send(
    new PutObjectCommand({
      Bucket: ARTIFACTS_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
};

export const getJsonText = async (key: string): Promise<string> => {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: ARTIFACTS_BUCKET, Key: key }),
  );
  if (!res.Body) throw new Error(`empty body for ${key}`);
  return await res.Body.transformToString('utf-8');
};

/**
 * Fetch raw bytes for a cached binary object (e.g. a rendered PDF). Returns
 * null if the object doesn't exist — caller can interpret as "not yet
 * cached" and either render now or return 202 to the client.
 */
export const getObjectBytes = async (key: string): Promise<Buffer | null> => {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: ARTIFACTS_BUCKET, Key: key }),
    );
    if (!res.Body) return null;
    const arr = await res.Body.transformToByteArray();
    return Buffer.from(arr);
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'NoSuchKey' || name === 'NotFound') return null;
    throw err;
  }
};

export const deleteObject = async (key: string): Promise<void> => {
  await s3.send(
    new DeleteObjectCommand({ Bucket: ARTIFACTS_BUCKET, Key: key }),
  );
};
