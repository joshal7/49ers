/**
 * Native Web Share & Deep-Link Codec Service for `49ers.joshal.com`
 *
 * Enables 1-tap sharing of any Autopodcast or AI Scouting/Cap Analysis via the device's
 * native share sheet (`navigator.share` -> iMessage/Text, WhatsApp, Email, AirDrop, Slack, etc.)
 * with automatic clipboard fallback on desktop browsers.
 *
 * Custom episodes & reports are compressed with `CompressionStream('deflate-raw')` into
 * URL-safe `#shared-pod=` / `#shared-analysis=` fragments so a colleague clicking the link
 * on `https://49ers.joshal.com` immediately loads and plays the exact podcast—even without
 * a shared backend database.
 */

import { sanitizeExternalUrl } from '../engine/linkIntegrity.js';

export const CANONICAL_SITE_ORIGIN = 'https://49ers.joshal.com';

function bytesToBase64Url(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(b64url) {
  const padded = String(b64url || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(String(b64url || '').length / 4) * 4, '=');

  if (typeof atob === 'function') {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

async function streamToUint8Array(readable) {
  const reader = readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function encodeSharedPayload(payloadObj) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(payloadObj));

  if (typeof CompressionStream === 'function') {
    try {
      const cs = new CompressionStream('deflate-raw');
      const writer = cs.writable.getWriter();
      writer.write(jsonBytes);
      writer.close();
      const compressed = await streamToUint8Array(cs.readable);
      return `z.${bytesToBase64Url(compressed)}`;
    } catch {
      // Fall through to uncompressed UTF-8 base64url
    }
  }

  return `u.${bytesToBase64Url(jsonBytes)}`;
}

export async function decodeSharedPayload(token = '') {
  const clean = String(token || '').trim();
  if (!clean) return null;

  try {
    if (clean.startsWith('z.') && typeof DecompressionStream === 'function') {
      const compressed = base64UrlToBytes(clean.slice(2));
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(compressed);
      writer.close();
      const decompressed = await streamToUint8Array(ds.readable);
      const jsonText = new TextDecoder().decode(decompressed);
      return JSON.parse(jsonText);
    }

    const rawPart = clean.startsWith('u.') ? clean.slice(2) : clean;
    const rawBytes = base64UrlToBytes(rawPart);
    const jsonText = new TextDecoder().decode(rawBytes);
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

export function resolveShareBaseUrl(locationObj = typeof window !== 'undefined' ? window.location : null) {
  if (!locationObj || !locationObj.origin || locationObj.origin === 'null') {
    return `${CANONICAL_SITE_ORIGIN}/`;
  }
  const host = String(locationObj.hostname || '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') {
    const cleanPath = String(locationObj.pathname || '/').replace(/index\.html$/i, '');
    return `${locationObj.origin}${cleanPath.endsWith('/') ? cleanPath : `${cleanPath}/`}`;
  }
  return `${CANONICAL_SITE_ORIGIN}/`;
}

/**
 * Builds a shareable `49ers.joshal.com` deep link for any built-in or custom Autopodcast.
 */
export async function buildShareablePodcastUrl(episode, locationObj) {
  if (!episode?.id) return `${CANONICAL_SITE_ORIGIN}/`;
  const base = resolveShareBaseUrl(locationObj);
  const idParam = encodeURIComponent(String(episode.id));

  // Pre-built static `.m4a` episodes live in `data/podcasts/index.json` on `49ers.joshal.com`
  const isBuiltInStatic =
    typeof episode.audioUrl === 'string' && episode.audioUrl.startsWith('./data/podcasts/');
  if (isBuiltInStatic) {
    return `${base}?pod=${idParam}`;
  }

  // Custom episodes: pack compact metadata + timed transcript into `#shared-pod=`
  const publicHttpsAudio =
    typeof episode.audioUrl === 'string' && /^https:\/\//i.test(episode.audioUrl)
      ? episode.audioUrl
      : null;

  const compactPayload = {
    v: 1,
    id: String(episode.id).slice(0, 80),
    t: String(episode.title || '49ers Faithful Podcast').slice(0, 160),
    tp: String(episode.topic || episode.title || '').slice(0, 220),
    f: String(episode.format || 'Two-Host Analytical Banter').slice(0, 60),
    pl: String(episode.presetLabel || 'Custom Pod').slice(0, 48),
    m: String(episode.modelUsed || 'gemini-3.8-flash').slice(0, 48),
    by: String(episode.createdBy || '49ers Faithful').slice(0, 40),
    at: String(episode.createdAt || new Date().toISOString()).slice(0, 40),
    d: Math.max(10, Math.round(Number(episode.durationSec || 180))),
    au: publicHttpsAudio,
    src: (episode.sourceLinks || []).slice(0, 5).map(s => ({
      l: String(s?.label || 'Source').slice(0, 48),
      u: sanitizeExternalUrl(s?.url, null)
    })),
    tr: (episode.transcript || []).slice(0, 60).map(seg => [
      seg.speaker === 'Elena' ? 'E' : 'M',
      Math.max(0, Math.round(Number(seg.startSec || 0))),
      Math.max(1, Math.round(Number(seg.endSec || 5))),
      String(seg.text || '').slice(0, 900)
    ])
  };

  const token = await encodeSharedPayload(compactPayload);
  return `${base}?pod=${idParam}#shared-pod=${token}`;
}

/**
 * Builds a shareable `49ers.joshal.com` deep link for any AI Scouting & Cap Analysis report.
 */
export async function buildShareableAnalysisUrl(report, locationObj) {
  if (!report?.id) return `${CANONICAL_SITE_ORIGIN}/`;
  const base = resolveShareBaseUrl(locationObj);
  const idParam = encodeURIComponent(String(report.id));

  const isBuiltInStatic = String(report.id).startsWith('sa-');
  if (isBuiltInStatic) {
    return `${base}?analysis=${idParam}`;
  }

  const compactPayload = {
    v: 1,
    id: String(report.id).slice(0, 80),
    t: String(report.title || '49ers Scouting & Cap Analysis').slice(0, 180),
    c: String(report.category || 'Deep Scouting & Cap Dive').slice(0, 60),
    m: String(report.modelUsed || 'gemini-3.8-flash').slice(0, 48),
    by: String(report.createdBy || '49ers Faithful').slice(0, 40),
    at: String(report.createdAt || new Date().toISOString()).slice(0, 40),
    src: (report.sourcesCited || []).slice(0, 6).map(s =>
      typeof s === 'string'
        ? { l: s.slice(0, 48), u: null }
        : { l: String(s?.label || 'Source').slice(0, 48), u: sanitizeExternalUrl(s?.url, null) }
    ),
    md: String(report.markdown || '').slice(0, 16000)
  };

  const token = await encodeSharedPayload(compactPayload);
  return `${base}?analysis=${idParam}#shared-analysis=${token}`;
}

/**
 * Hydrates an incoming `?pod=...` / `#shared-pod=...` or `?analysis=...` / `#shared-analysis=...`
 * URL when a colleague clicks a shared link.
 */
export async function extractIncomingSharedRoute(
  locationObj = typeof window !== 'undefined' ? window.location : null
) {
  if (!locationObj) return null;
  const searchParams = new URLSearchParams(String(locationObj.search || ''));
  const rawHash = String(locationObj.hash || '').replace(/^#/, '');
  const hashParams = new URLSearchParams(rawHash);

  const podId = searchParams.get('pod');
  const sharedPodToken = hashParams.get('shared-pod');
  if (podId || sharedPodToken) {
    let hydratedEpisode = null;
    if (sharedPodToken) {
      const decoded = await decodeSharedPayload(sharedPodToken);
      if (decoded && Array.isArray(decoded.tr) && decoded.tr.length > 0) {
        hydratedEpisode = {
          id: String(decoded.id || podId || `shared_ep_${Date.now()}`),
          title: String(decoded.t || 'Shared 49ers Podcast'),
          topic: String(decoded.tp || decoded.t || 'Shared 49ers Podcast'),
          format: String(decoded.f || 'Two-Host Analytical Banter'),
          presetLabel: String(decoded.pl || 'Shared Pod'),
          modelUsed: String(decoded.m || 'gemini-3.8-flash'),
          thinkingLevel: 'HIGH',
          qualityPriority: 'accuracy_over_latency',
          createdBy: String(decoded.by || '49ers Faithful'),
          createdAt: String(decoded.at || new Date().toISOString()),
          audioUrl: sanitizeExternalUrl(decoded.au, null),
          durationSec: Math.max(10, Number(decoded.d || 180)),
          isSharedImport: true,
          sourceLinks: Array.isArray(decoded.src)
            ? decoded.src
                .map(s => ({
                  label: String(s?.l || 'Source'),
                  url: sanitizeExternalUrl(s?.u, null)
                }))
                .filter(s => s.label)
            : [],
          transcript: decoded.tr.map((row, idx) => {
            const speaker = row?.[0] === 'E' ? 'Elena' : 'Marcus';
            return {
              idx,
              speaker,
              speakerRole:
                speaker === 'Elena'
                  ? 'Cap & Quantitative Insider'
                  : "X's & O's Film Analyst",
              startSec: Math.max(0, Number(row?.[1] || 0)),
              endSec: Math.max(1, Number(row?.[2] || 5)),
              text: String(row?.[3] || '')
            };
          })
        };
      }
    }
    return {
      type: 'podcast',
      id: hydratedEpisode?.id || podId,
      episode: hydratedEpisode
    };
  }

  const analysisId = searchParams.get('analysis');
  const sharedAnalysisToken = hashParams.get('shared-analysis');
  if (analysisId || sharedAnalysisToken) {
    let hydratedAnalysis = null;
    if (sharedAnalysisToken) {
      const decoded = await decodeSharedPayload(sharedAnalysisToken);
      if (decoded && decoded.md) {
        hydratedAnalysis = {
          id: String(decoded.id || analysisId || `shared_analysis_${Date.now()}`),
          title: String(decoded.t || 'Shared 49ers Scouting Report'),
          category: String(decoded.c || 'Shared Deep Dive'),
          modelUsed: String(decoded.m || 'gemini-3.8-flash'),
          thinkingLevel: 'HIGH',
          qualityPriority: 'accuracy_over_latency',
          createdBy: String(decoded.by || '49ers Faithful'),
          createdAt: String(decoded.at || new Date().toISOString()),
          isSharedImport: true,
          sourcesCited: Array.isArray(decoded.src)
            ? decoded.src.map(s => ({
                label: String(s?.l || 'Source'),
                url: sanitizeExternalUrl(s?.u, null)
              }))
            : [],
          markdown: String(decoded.md || '')
        };
      }
    }
    return {
      type: 'analysis',
      id: hydratedAnalysis?.id || analysisId,
      analysis: hydratedAnalysis
    };
  }

  return null;
}

async function copyTextToClipboard(text, navObj) {
  if (navObj?.clipboard && typeof navObj.clipboard.writeText === 'function') {
    await navObj.clipboard.writeText(text);
    return true;
  }
  if (typeof document !== 'undefined') {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return Boolean(ok);
  }
  return false;
}

/**
 * Triggers the native mobile/desktop OS share sheet (`navigator.share` -> Text/iMessage,
 * WhatsApp, Email, AirDrop, etc.) and falls back cleanly to clipboard copy when unavailable.
 */
export async function shareItemNatively({
  title,
  text,
  url,
  navigatorObj = typeof navigator !== 'undefined' ? navigator : null
}) {
  const shareData = {
    title: String(title || '49ers Faithful Briefing'),
    text: String(text || ''),
    url: String(url || CANONICAL_SITE_ORIGIN)
  };

  if (navigatorObj && typeof navigatorObj.share === 'function') {
    let allowed = true;
    if (typeof navigatorObj.canShare === 'function') {
      try {
        allowed = navigatorObj.canShare(shareData) !== false;
      } catch {
        allowed = true;
      }
    }
    if (allowed) {
      try {
        await navigatorObj.share(shareData);
        return { method: 'native', url: shareData.url };
      } catch (err) {
        if (err?.name === 'AbortError') {
          return { method: 'cancelled', url: shareData.url };
        }
        // Other errors (e.g. desktop NotAllowedError): fall through to clipboard
      }
    }
  }

  await copyTextToClipboard(shareData.url, navigatorObj);
  return { method: 'clipboard', url: shareData.url };
}
