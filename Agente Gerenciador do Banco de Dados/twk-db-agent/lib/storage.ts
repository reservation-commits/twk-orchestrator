/**
 * TWK Storage — pluggable object storage for restaurant media.
 *
 * Default adapter: Google Cloud Storage via the JSON REST API, authenticated with a
 * self-signed service-account JWT. Uses only Node's built-in `crypto` + axios (already a
 * dependency) so it needs NO extra npm package — install-proof on this machine.
 *
 * To enable publishing, set in .env.local:
 *   GCS_BUCKET=<the bucket behind media.theworldkeys.com>
 *   GCS_SERVICE_ACCOUNT_KEY=<full service-account JSON, single line>   (or GOOGLE_APPLICATION_CREDENTIALS=<path to json>)
 *   MEDIA_PUBLIC_BASE_URL=https://media.theworldkeys.com               (optional; default below)
 *
 * Until those exist, isStorageConfigured() returns false and the UI/route stays in
 * "capture + curate + approve" mode without publishing.
 */
import crypto from 'crypto';
import fs from 'fs';
import axios from 'axios';

const PUBLIC_BASE = (process.env.MEDIA_PUBLIC_BASE_URL || 'https://media.theworldkeys.com').replace(/\/+$/, '');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

interface ServiceAccount { client_email: string; private_key: string; }

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GCS_SERVICE_ACCOUNT_KEY;
  if (raw && raw.trim().startsWith('{')) {
    try { const j = JSON.parse(raw); if (j.client_email && j.private_key) return j; } catch { /* fallthrough */ }
  }
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path && fs.existsSync(path)) {
    try { const j = JSON.parse(fs.readFileSync(path, 'utf8')); if (j.client_email && j.private_key) return j; } catch { /* fallthrough */ }
  }
  // Split form: GCS_CLIENT_EMAIL + GCS_PRIVATE_KEY
  if (process.env.GCS_CLIENT_EMAIL && process.env.GCS_PRIVATE_KEY) {
    return { client_email: process.env.GCS_CLIENT_EMAIL, private_key: process.env.GCS_PRIVATE_KEY.replace(/\\n/g, '\n') };
  }
  return null;
}

export interface StorageStatus {
  configured: boolean;
  bucket: string | null;
  publicBase: string;
  hasCredentials: boolean;
  reason?: string;
}

export function storageStatus(): StorageStatus {
  const bucket = process.env.GCS_BUCKET || null;
  const sa = loadServiceAccount();
  const configured = !!bucket && !!sa;
  return {
    configured,
    bucket,
    publicBase: PUBLIC_BASE,
    hasCredentials: !!sa,
    reason: configured ? undefined
      : !bucket && !sa ? 'Defina GCS_BUCKET e GCS_SERVICE_ACCOUNT_KEY no .env.local'
      : !bucket ? 'Falta GCS_BUCKET'
      : 'Falta GCS_SERVICE_ACCOUNT_KEY (ou GOOGLE_APPLICATION_CREDENTIALS)',
  };
}

export function isStorageConfigured(): boolean {
  return storageStatus().configured;
}

// ── Access token (cached until ~1 min before expiry) ─────────────────────────
let tokenCache: { token: string; exp: number } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.token;

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const signature = base64url(crypto.sign('RSA-SHA256', Buffer.from(signingInput), sa.private_key));
  const assertion = `${signingInput}.${signature}`;

  const { data } = await axios.post(TOKEN_URL, new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });

  tokenCache = { token: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return tokenCache.token;
}

export interface UploadResult { url: string; objectPath: string; bytes: number; }

/**
 * Upload a buffer to gs://{GCS_BUCKET}/{objectPath} and return its public URL.
 * Throws a clear error if storage isn't configured.
 */
export async function uploadObject(
  buffer: Buffer,
  objectPath: string,
  contentType: string
): Promise<UploadResult> {
  const bucket = process.env.GCS_BUCKET;
  const sa = loadServiceAccount();
  if (!bucket || !sa) throw new Error(`Storage não configurado: ${storageStatus().reason}`);

  const clean = objectPath.replace(/^\/+/, '');
  const token = await getAccessToken(sa);
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(clean)}`;

  await axios.post(uploadUrl, buffer, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType, 'Content-Length': buffer.length },
    maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 60000,
  });

  return { url: `${PUBLIC_BASE}/${clean}`, objectPath: clean, bytes: buffer.length };
}

// Map a content-type to a file extension used in the object path.
export function extForContentType(ct: string): string {
  const c = ct.split(';')[0].trim().toLowerCase();
  if (c === 'image/jpeg' || c === 'image/jpg') return 'jpg';
  if (c === 'image/png') return 'png';
  if (c === 'image/webp') return 'webp';
  if (c === 'image/avif') return 'avif';
  return 'jpg';
}
