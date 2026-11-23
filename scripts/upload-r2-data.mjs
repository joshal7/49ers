#!/usr/bin/env node
/**
 * Zero-Dependency Pure-Node Cloudflare R2 Uploader (AWS SigV4)
 *
 * Uploads `data/league/*.json` and `data/teams/{slug}/**` directly to Cloudflare R2
 * (`nfl-data-public`) so automated canary / 32-team data refreshes NEVER bloat Git history.
 *
 * Required env vars (GitHub Actions Secrets):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME (default: nfl-data-public)
 *
 * Usage:
 *   node scripts/upload-r2-data.mjs --teams=lions,bills
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CANARY_TEAM_SLUGS, getTeamBySlug } from '../src/config/teamRegistry.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function putObjectR2({ accountId, accessKeyId, secretAccessKey, bucket, key, body, contentType }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const canonicalUri = `/${bucket}/${encodedKey}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, 'auto');
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      Host: host,
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authHeader
    },
    body,
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`R2 PUT ${key} failed (${res.status}): ${errText.slice(0, 200)}`);
  }
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else if (e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

async function main() {
  const accountId = process.env.R2_ACCOUNT_ID || '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
  const bucket = process.env.R2_BUCKET_NAME || 'nfl-data-public';

  if (!accountId || !accessKeyId || !secretAccessKey) {
    console.log('[r2-upload] R2 credentials not set; skipping R2 upload cleanly.');
    return;
  }

  const args = process.argv.slice(2);
  const teamsArg = args.find(a => a.startsWith('--teams='));
  const slugs = teamsArg
    ? teamsArg.replace('--teams=', '').split(',').map(s => getTeamBySlug(s).slug)
    : [...CANARY_TEAM_SLUGS];

  const files = [
    ...walkFiles(path.join(ROOT, 'data', 'league')),
    ...slugs.flatMap(slug => walkFiles(path.join(ROOT, 'data', 'teams', slug)))
  ];

  let uploaded = 0;
  for (const absPath of files) {
    const relKey = path.relative(ROOT, absPath).replace(/\\/g, '/');
    const body = fs.readFileSync(absPath);
    await putObjectR2({
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      key: relKey,
      body,
      contentType: 'application/json; charset=utf-8'
    });
    uploaded += 1;
  }
  console.log(`[r2-upload] Uploaded ${uploaded} JSON files to r2://${bucket}/ (${slugs.join(', ')})`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
