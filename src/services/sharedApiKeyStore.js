/**
 * Cross-Team Shared Gemini API Key Store (All 32 NFL Team Apps + nfl.joshal.com Hub)
 *
 * Security & Privacy Architecture:
 *   1. ZERO HTTP Cookie Leakage: Never writes the user's Gemini API key into a `Domain=.joshal.com`
 *      cookie, ensuring third-party-mapped subdomains (e.g. `www.joshal.com` on SmugMug) and CDN/server
 *      HTTP logs receive ZERO bytes of the API key.
 *   2. Instant Same-Origin Sync (`localStorage['joshal_nfl_shared_gemini_key_v1']`):
 *      - Provides 0ms synchronous sharing across all 32 teams inside `nfl.joshal.com/?team=<slug>`
 *        (including the unified iOS/Chrome `nfl.joshal.com` Home Screen PWA) and `localhost` dev.
 *      - Automatically backfills from any legacy same-origin per-team prefs (`sf49ers_hq_prefs_v2`,
 *        `joshal_*_hq_prefs_v1`) so existing keys seamlessly flow to all teams.
 *   3. Transient Client-Side `#nfl_ks=` Hash Handoff (Safari / iOS Safari / Portal <-> Subdomain Bridge):
 *      - WebKit/Safari partitions cross-origin iframe `localStorage` by `(topOrigin, clientOrigin)`,
 *        isolating `(49ers.joshal.com, nfl.joshal.com)` from `(bears.joshal.com, nfl.joshal.com)`.
 *      - Clicking any allowlisted cross-team link (`nfl.joshal.com` portal tiles in normal browser mode,
 *        or Settings `Switch Team` / `NFL Portal`) attaches a transient `#nfl_ks=...` URL fragment at
 *        click time (never stored in static DOM `href`s, never sent over HTTP per RFC 3986, never logged).
 *      - Destination page consumes it synchronously before first paint, merges via Last-Write-Wins, and
 *        immediately strips `#nfl_ks=...` via `history.replaceState`.
 *   4. Hardened Same-Site Iframe Vault (`https://nfl.joshal.com/key-sync`):
 *      - Automatic background sync across all 32 `<team>.joshal.com` tabs in Chrome, Firefox, and Edge
 *        (which partition by eTLD+1 `joshal.com`).
 *      - Strictly allowlisted by BOTH HTTP `Content-Security-Policy: frame-ancestors` AND JS `event.origin`
 *        checks to the exact 32 NFL team subdomains + `nfl.joshal.com`.
 *      - Auto-recovers from timed-out/offline frames and listens for explicit vault `ready` handshakes.
 *   5. Optional Zero-Knowledge E2EE Cloud Sync (`/api/key-vault`, opt-in via 8+ char Sync Passcode):
 *      - Bridges Apple's OS-level `WKWebsiteDataStore` isolation between separate iPhone Home Screen PWAs
 *        (e.g. standalone `49ers.joshal.com` PWA <-> standalone `bears.joshal.com` PWA <-> Mac Safari).
 *      - Uses client-side PBKDF2-SHA256 (210,000 iterations, domain-separated salts) + AES-256-GCM:
 *        neither the passphrase nor the plaintext API key ever leaves the browser.
 *   6. Conflict-Safe Last-Write-Wins + Clear Tombstones:
 *      - Monotonic timestamps ensure updating a key in one team app updates all others.
 *      - Explicit clears write a `{ c: 1, t }` tombstone so other team apps cleanly clear instead of
 *        resurrecting old cached keys.
 */

export const SHARED_GEMINI_KEY_STORAGE_KEY = 'joshal_nfl_shared_gemini_key_v1';
export const SHARED_GEMINI_KEY_CHANNEL = 'joshal_nfl_key_sync_v1';
export const SHARED_KEY_HASH_PARAM = 'nfl_ks';
export const DEFAULT_KEY_VAULT_URL = 'https://nfl.joshal.com/key-sync';
export const DEFAULT_E2EE_VAULT_ENDPOINT = '/api/key-vault';
export const DEFAULT_VAULT_TIMEOUT_MS = 4500;
export const E2EE_VAULT_MIN_PASSCODE_LENGTH = 8;
export const E2EE_VAULT_PBKDF2_ITERATIONS = 210_000;
const E2EE_CLOUD_PULL_THROTTLE_MS = 60_000;

export const ALLOWED_NFL_TEAM_SLUGS = Object.freeze([
  '49ers',
  'bears',
  'bengals',
  'bills',
  'broncos',
  'browns',
  'buccaneers',
  'cardinals',
  'chargers',
  'chiefs',
  'colts',
  'commanders',
  'cowboys',
  'dolphins',
  'eagles',
  'falcons',
  'giants',
  'jaguars',
  'jets',
  'lions',
  'packers',
  'panthers',
  'patriots',
  'raiders',
  'rams',
  'ravens',
  'saints',
  'seahawks',
  'steelers',
  'texans',
  'titans',
  'vikings',
  'nfl'
]);

const ALLOWED_NFL_TEAM_SLUG_SET = new Set(ALLOWED_NFL_TEAM_SLUGS);

/**
 * Returns true ONLY for the 32 official `<team>.joshal.com` hosts and `nfl.joshal.com`.
 * Explicitly excludes `www.joshal.com`, `workouts.joshal.com`, `localhost`, `*.pages.dev`, and lookalike domains.
 */
export function isAllowedNflTeamHostname(hostname = '') {
  const clean = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  const m = clean.match(/^([a-z0-9-]+)\.joshal\.com$/);
  if (!m) return false;
  return ALLOWED_NFL_TEAM_SLUG_SET.has(m[1]);
}

export function getAllowedNflTeamOrigins() {
  return ALLOWED_NFL_TEAM_SLUGS.map(slug => `https://${slug}.joshal.com`);
}

export function getKeySyncAllowedOrigins(extraOrigins = []) {
  return Array.from(new Set([...getAllowedNflTeamOrigins(), 'https://nfl.joshal.com', ...extraOrigins])).sort();
}

export function buildKeySyncCspHeader(extraOrigins = []) {
  const allowed = getKeySyncAllowedOrigins(extraOrigins);
  return `default-src 'none'; script-src 'unsafe-inline'; frame-ancestors 'self' ${allowed.join(' ')}`;
}

export function normalizeSharedGeminiKeyRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const t = Number(raw.t);
  if (!Number.isFinite(t) || t <= 0) return null;
  const cleared = raw.c === 1 || raw.c === true;
  const k = cleared ? '' : String(raw.k || '').trim();
  const m = cleared ? '' : String(raw.m || '').trim();
  if (!cleared && !k) return null;
  return {
    v: 1,
    k,
    m,
    t: Math.floor(t),
    c: cleared ? 1 : 0
  };
}

export function pickNewestSharedRecord(recA, recB) {
  const a = normalizeSharedGeminiKeyRecord(recA);
  const b = normalizeSharedGeminiKeyRecord(recB);
  if (!a) return b;
  if (!b) return a;
  return b.t > a.t ? b : a;
}

// ============================================================================
// Base64URL + Transient `#nfl_ks=` Client-Side Hash Handoff
// ============================================================================

function bytesToBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === 'function'
      ? btoa(bin)
      : Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(str) {
  const clean = String(str || '').trim();
  if (!clean || !/^[A-Za-z0-9_-]+$/.test(clean)) return null;
  const padLen = (4 - (clean.length % 4)) % 4;
  const b64 = clean.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  try {
    if (typeof atob === 'function') {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  } catch {
    return null;
  }
}

export function encodeSharedKeyHashToken(record) {
  const norm = normalizeSharedGeminiKeyRecord(record);
  if (!norm) return '';
  try {
    const json = JSON.stringify(norm);
    const bytes = new TextEncoder().encode(json);
    return bytesToBase64Url(bytes);
  } catch {
    return '';
  }
}

export function decodeSharedKeyHashToken(token) {
  const clean = String(token || '').trim();
  if (!clean || clean.length > 1024) return null;
  const bytes = base64UrlToBytes(clean);
  if (!bytes || bytes.length === 0 || bytes.length > 768) return null;
  try {
    const json = new TextDecoder().decode(bytes);
    return normalizeSharedGeminiKeyRecord(JSON.parse(json));
  } catch {
    return null;
  }
}

/**
 * Extracts `nfl_ks=<token>` from a URL hash string (e.g. `#nfl_ks=...` or `#section&nfl_ks=...`)
 * and returns `{ record, cleanedHash }`. Never mutates anything.
 */
export function extractSharedKeyRecordFromHash(hashStr = '') {
  const raw = String(hashStr || '');
  if (!raw || raw === '#') {
    return { record: null, cleanedHash: raw, hadParam: false };
  }
  const body = raw.startsWith('#') ? raw.slice(1) : raw;
  const parts = body.split('&');
  let record = null;
  let hadParam = false;
  const kept = [];
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith(`${SHARED_KEY_HASH_PARAM}=`)) {
      hadParam = true;
      const val = part.slice(SHARED_KEY_HASH_PARAM.length + 1);
      if (!record) {
        record = decodeSharedKeyHashToken(val);
      }
    } else {
      kept.push(part);
    }
  }
  const cleanedHash = kept.length > 0 ? `#${kept.join('&')}` : '';
  return { record, cleanedHash, hadParam };
}

/**
 * Safely appends `#nfl_ks=<token>` to a cross-origin NFL destination URL.
 * STRICT SECURITY GUARD:
 *   - Only allows the exact 33 official `https://<team>.joshal.com` / `https://nfl.joshal.com` hosts
 *     (never `www.joshal.com`, `workouts.joshal.com`, or third-party domains).
 *   - Skips same-origin destinations (which already share `localStorage` natively).
 *   - Optional `allowLocalOrigins` is strictly for automated cross-origin E2E tests.
 */
export function appendSharedKeyHandoffToUrl(
  rawUrl = '',
  record = null,
  { currentOrigin = '', allowLocalOrigins = [] } = {}
) {
  const cleanUrl = String(rawUrl || '').trim();
  if (!cleanUrl) return cleanUrl;
  const norm = normalizeSharedGeminiKeyRecord(record);
  if (!norm) return cleanUrl;

  let parsed = null;
  try {
    parsed = new URL(cleanUrl, currentOrigin || undefined);
  } catch {
    return cleanUrl;
  }

  if (currentOrigin && parsed.origin === currentOrigin) {
    return cleanUrl;
  }

  const localAllowSet = Array.isArray(allowLocalOrigins) && allowLocalOrigins.length > 0
    ? new Set(allowLocalOrigins)
    : null;
  const isAllowedProd = parsed.protocol === 'https:' && isAllowedNflTeamHostname(parsed.hostname);
  const isAllowedTest = Boolean(localAllowSet && localAllowSet.has(parsed.origin));
  if (!isAllowedProd && !isAllowedTest) {
    return cleanUrl;
  }

  const token = encodeSharedKeyHashToken(norm);
  if (!token) return cleanUrl;

  const { cleanedHash } = extractSharedKeyRecordFromHash(parsed.hash || '');
  const prefix = cleanedHash ? `${cleanedHash}&` : '#';
  parsed.hash = `${prefix}${SHARED_KEY_HASH_PARAM}=${token}`;
  return parsed.toString();
}

/**
 * Synchronously consumes an incoming `#nfl_ks=...` handoff fragment from `window.location.hash`,
 * merges it via Last-Write-Wins into same-origin shared `localStorage`, and immediately strips
 * the fragment via `history.replaceState` so it never lingers in the address bar or history.
 */
export function consumeSharedKeyHandoffFromLocation({
  locationObj = null,
  historyObj = null,
  storage = null
} = {}) {
  try {
    const loc = locationObj || (typeof window !== 'undefined' ? window.location : null);
    const hist = historyObj || (typeof window !== 'undefined' ? window.history : null);
    if (!loc || !loc.hash) {
      return { consumed: false, record: null };
    }
    const { record, cleanedHash, hadParam } = extractSharedKeyRecordFromHash(loc.hash);
    if (!hadParam) {
      return { consumed: false, record: null };
    }

    // Immediately strip `nfl_ks` from URL before any other logic runs
    if (hist && typeof hist.replaceState === 'function') {
      const cleanUrl = `${loc.pathname || '/'}${loc.search || ''}${cleanedHash}`;
      try {
        hist.replaceState(hist.state, '', cleanUrl);
      } catch {}
    }

    if (!record) {
      return { consumed: false, record: null };
    }
    const merged = writeSameOriginSharedGeminiKey(record, storage);
    return { consumed: true, record: merged || record };
  } catch {
    return { consumed: false, record: null };
  }
}

// ============================================================================
// Pure Deterministic Last-Write-Wins Reconciler
// ============================================================================

/**
 * Pure deterministic Last-Write-Wins reconciler between a team app's local prefs and the shared store.
 *
 * Returns:
 *   {
 *     action: 'noop' | 'push_local' | 'apply_shared' | 'apply_clear',
 *     changed: boolean,
 *     shouldPushToShared: boolean,
 *     apiKey: string,
 *     verifiedModel: string,
 *     updatedAt: number,
 *     recordToPush: object | null
 *   }
 */
export function reconcileGeminiKeyState(localState = {}, sharedRecord = null, nowMs = Date.now()) {
  const localKey = String(localState?.apiKey ?? localState?.geminiApiKey ?? '').trim();
  const localModel = String(localState?.verifiedModel ?? localState?.verifiedGeminiModel ?? '').trim();
  const rawLocalTs = Number(localState?.updatedAt ?? localState?.geminiApiKeyUpdatedAt ?? 0);
  const localTs = Number.isFinite(rawLocalTs) && rawLocalTs > 0 ? Math.floor(rawLocalTs) : 0;
  const safeNow = Number.isFinite(Number(nowMs)) && Number(nowMs) > 0 ? Math.floor(Number(nowMs)) : Date.now();

  const shared = normalizeSharedGeminiKeyRecord(sharedRecord);

  // Case 1: Neither local nor shared has a key
  if (!shared && !localKey) {
    return {
      action: 'noop',
      changed: false,
      shouldPushToShared: false,
      apiKey: '',
      verifiedModel: '',
      updatedAt: localTs,
      recordToPush: null
    };
  }

  // Case 2: Local has an existing key, shared vault is empty -> backfill shared vault automatically
  if (!shared && localKey) {
    const pushTs = localTs > 0 ? localTs : safeNow;
    return {
      action: 'push_local',
      changed: localTs !== pushTs,
      shouldPushToShared: true,
      apiKey: localKey,
      verifiedModel: localModel,
      updatedAt: pushTs,
      recordToPush: { v: 1, k: localKey, m: localModel, t: pushTs, c: 0 }
    };
  }

  // Case 3: Shared record is an explicit Clear Tombstone (`c === 1`)
  if (shared.c === 1) {
    if (localKey && localTs > shared.t) {
      return {
        action: 'push_local',
        changed: false,
        shouldPushToShared: true,
        apiKey: localKey,
        verifiedModel: localModel,
        updatedAt: localTs,
        recordToPush: { v: 1, k: localKey, m: localModel, t: localTs, c: 0 }
      };
    }
    return {
      action: 'apply_clear',
      changed: Boolean(localKey || localModel || localTs !== shared.t),
      shouldPushToShared: false,
      apiKey: '',
      verifiedModel: '',
      updatedAt: shared.t,
      recordToPush: null
    };
  }

  // Case 4: Shared record has an active key (`c === 0`, `shared.k` non-empty)
  if (!localKey && localTs > shared.t) {
    // Respect a newer local clear timestamp so an older in-flight shared record never resurrects a deleted key
    return {
      action: 'noop',
      changed: false,
      shouldPushToShared: false,
      apiKey: '',
      verifiedModel: '',
      updatedAt: localTs,
      recordToPush: null
    };
  }
  if (localKey && localTs > shared.t) {
    return {
      action: 'push_local',
      changed: false,
      shouldPushToShared: true,
      apiKey: localKey,
      verifiedModel: localModel,
      updatedAt: localTs,
      recordToPush: { v: 1, k: localKey, m: localModel, t: localTs, c: 0 }
    };
  }

  const nextModel = shared.m || (localKey === shared.k ? localModel : '');
  const needsApply = !localKey || shared.t > localTs || localKey !== shared.k || nextModel !== localModel;
  if (needsApply) {
    return {
      action: 'apply_shared',
      changed: localKey !== shared.k || localModel !== nextModel || localTs !== shared.t,
      shouldPushToShared: false,
      apiKey: shared.k,
      verifiedModel: nextModel,
      updatedAt: shared.t,
      recordToPush: null
    };
  }

  return {
    action: 'noop',
    changed: false,
    shouldPushToShared: false,
    apiKey: localKey,
    verifiedModel: localModel,
    updatedAt: localTs,
    recordToPush: null
  };
}

// ============================================================================
// Same-Origin Shared LocalStorage + Legacy Team Prefs Backfill
// ============================================================================

/**
 * Scans same-origin per-team prefs (`sf49ers_hq_prefs_v2`, `joshal_*_hq_prefs_v1`) for an existing
 * Gemini API key when `joshal_nfl_shared_gemini_key_v1` has not been written yet (e.g. legacy
 * `nfl.joshal.com/?team=49ers` users switching straight to `nfl.joshal.com/?team=bears`).
 */
export function scanSameOriginLegacyTeamPrefsForKey(storage = null, nowMs = Date.now()) {
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store || typeof store.length !== 'number' || typeof store.key !== 'function') return null;
    const safeNow = Number.isFinite(Number(nowMs)) && Number(nowMs) > 0 ? Math.floor(Number(nowMs)) : Date.now();
    let best = null;
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (!k || (k !== 'sf49ers_hq_prefs_v2' && !/^joshal_[a-z0-9-]+_hq_prefs_v1$/.test(k))) {
        continue;
      }
      let parsed = null;
      try {
        parsed = JSON.parse(store.getItem(k) || 'null');
      } catch {
        continue;
      }
      const apiKey = typeof parsed?.geminiApiKey === 'string' ? parsed.geminiApiKey.trim() : '';
      if (!apiKey) continue;
      const verifiedModel = typeof parsed?.verifiedGeminiModel === 'string' ? parsed.verifiedGeminiModel.trim() : '';
      const rawTs = Number(parsed?.geminiApiKeyUpdatedAt || 0);
      const t = Number.isFinite(rawTs) && rawTs > 0 ? Math.floor(rawTs) : Math.max(1, safeNow - 1000);
      const candidate = normalizeSharedGeminiKeyRecord({ v: 1, k: apiKey, m: verifiedModel, t, c: 0 });
      best = pickNewestSharedRecord(best, candidate);
    }
    return best;
  } catch {
    return null;
  }
}

let legacyPrefsScanCheckedStore = null;

export function readSameOriginSharedGeminiKey(storage = null) {
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return null;
    const raw = store.getItem(SHARED_GEMINI_KEY_STORAGE_KEY);
    if (raw) {
      const parsed = normalizeSharedGeminiKeyRecord(JSON.parse(raw));
      if (parsed) return parsed;
    }
    // Avoid re-scanning & JSON.parsing every team prefs blob on every focus/visibility check when no key exists
    if (!storage && legacyPrefsScanCheckedStore === store) {
      return null;
    }
    if (!storage) {
      legacyPrefsScanCheckedStore = store;
    }
    const backfilled = scanSameOriginLegacyTeamPrefsForKey(store);
    if (backfilled) {
      try {
        store.setItem(SHARED_GEMINI_KEY_STORAGE_KEY, JSON.stringify(backfilled));
      } catch {}
      return backfilled;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSameOriginSharedGeminiKey(record, storage = null) {
  try {
    const normalized = normalizeSharedGeminiKeyRecord(record);
    if (!normalized) return null;
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return normalized;
    const raw = store.getItem(SHARED_GEMINI_KEY_STORAGE_KEY);
    const current = raw ? normalizeSharedGeminiKeyRecord(JSON.parse(raw)) : null;
    if (current && current.t > normalized.t) {
      return current;
    }
    store.setItem(SHARED_GEMINI_KEY_STORAGE_KEY, JSON.stringify(normalized));
    if (!storage) legacyPrefsScanCheckedStore = null;
    return normalized;
  } catch {
    return null;
  }
}

export function nextMonotonicSharedKeyTimestamp(existingTs = 0, nowMs = Date.now()) {
  const sameOrigin = readSameOriginSharedGeminiKey();
  const floorTs = Math.max(
    Number.isFinite(Number(existingTs)) ? Math.floor(Number(existingTs)) : 0,
    sameOrigin?.t || 0
  );
  const safeNow = Number.isFinite(Number(nowMs)) && Number(nowMs) > 0 ? Math.floor(Number(nowMs)) : Date.now();
  return Math.max(safeNow, floorTs + 1);
}

/**
 * Synchronous reconciliation against same-origin shared `localStorage` (plus any incoming `#nfl_ks=` hash handoff).
 * Called during `loadUserPrefs()` for 0ms instant sharing across `?team=` routes, portal jumps, & local dev.
 */
export function reconcilePrefsWithSameOriginSharedKey(prefs, { storage = null, nowMs = Date.now() } = {}) {
  if (!prefs || typeof prefs !== 'object') {
    return { action: 'noop', changed: false, prevKey: '', nextKey: '' };
  }
  // Consume any transient `#nfl_ks=...` client-side handoff synchronously before reconciling
  consumeSharedKeyHandoffFromLocation({ storage });

  const prevKey = String(prefs.geminiApiKey || '').trim();
  const shared = readSameOriginSharedGeminiKey(storage);
  const outcome = reconcileGeminiKeyState(prefs, shared, nowMs);

  if (outcome.shouldPushToShared && outcome.recordToPush) {
    writeSameOriginSharedGeminiKey(outcome.recordToPush, storage);
  }
  if (outcome.changed) {
    prefs.geminiApiKey = outcome.apiKey;
    prefs.verifiedGeminiModel = outcome.verifiedModel;
    prefs.geminiApiKeyUpdatedAt = outcome.updatedAt;
  }
  return {
    ...outcome,
    prevKey,
    nextKey: String(prefs.geminiApiKey || '').trim()
  };
}

// ============================================================================
// Hardened Cross-Subdomain Iframe Vault Client (`https://nfl.joshal.com/key-sync`)
// ============================================================================

/**
 * Determines whether the remote `https://nfl.joshal.com/key-sync` iframe vault should be mounted.
 * Active on all 32 official `<team>.joshal.com` hosts (excluding `nfl.joshal.com` itself),
 * or when an explicit `vaultUrlOverride` is injected (e.g. cross-origin Chrome E2E verification).
 */
export function shouldUseCrossSubdomainVault({ hostname = '', origin = '', vaultUrlOverride = '' } = {}) {
  const effectiveVaultUrl = String(vaultUrlOverride || DEFAULT_KEY_VAULT_URL).trim();
  let vaultOrigin = '';
  try {
    vaultOrigin = new URL(effectiveVaultUrl).origin;
  } catch {
    return false;
  }
  if (vaultUrlOverride) {
    return Boolean(origin && origin !== vaultOrigin);
  }
  if (!isAllowedNflTeamHostname(hostname)) return false;
  if (origin && origin === vaultOrigin) return false;
  return true;
}

/**
 * Creates a resilient postMessage client connected to the hidden same-site key-sync iframe.
 * Never throws; auto-resets dead/timed-out iframes and degrades silently to `null` if offline or blocked.
 */
export function createCrossSubdomainVaultClient({
  vaultUrl = DEFAULT_KEY_VAULT_URL,
  timeoutMs = DEFAULT_VAULT_TIMEOUT_MS
} = {}) {
  let vaultOrigin = '';
  try {
    vaultOrigin = new URL(vaultUrl).origin;
  } catch {
    return null;
  }

  let iframe = null;
  let readyPromise = null;
  let readyResolve = null;
  let destroyed = false;
  let reqSeq = 0;
  const pending = new Map();

  function teardownIframe() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', onMessage);
    }
    if (iframe && iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
    iframe = null;
    readyPromise = null;
    readyResolve = null;
  }

  function onMessage(event) {
    if (destroyed || !iframe) return;
    if (event.origin !== vaultOrigin) return;
    if (iframe.contentWindow && event.source !== iframe.contentWindow) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.channel !== SHARED_GEMINI_KEY_CHANNEL) return;
    if (msg.type === 'ready') {
      if (readyResolve) {
        const fn = readyResolve;
        readyResolve = null;
        fn(true);
      }
      return;
    }
    if (!msg.id) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    entry.resolve(msg);
  }

  function ensureReady() {
    if (destroyed || typeof window === 'undefined' || typeof document === 'undefined') {
      return Promise.resolve(false);
    }
    if (readyPromise) return readyPromise;

    readyPromise = new Promise(resolve => {
      const mount = () => {
        if (destroyed) {
          resolve(false);
          return;
        }
        window.addEventListener('message', onMessage);

        iframe = document.createElement('iframe');
        iframe.setAttribute('data-nfl-key-sync-vault', '1');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.tabIndex = -1;
        // Avoid `display:none` so WebKit/mobile browsers never throttle or skip iframe script init
        iframe.style.cssText =
          'opacity:0;visibility:hidden;width:1px;height:1px;border:0;position:fixed;top:-10px;left:-10px;pointer-events:none;';

        let settled = false;
        let postLoadGraceTimer = null;
        const finish = ok => {
          if (settled) return;
          settled = true;
          readyResolve = null;
          clearTimeout(loadTimer);
          clearTimeout(postLoadGraceTimer);
          if (!ok) {
            teardownIframe();
          }
          resolve(ok);
        };
        readyResolve = finish;

        const loadTimer = setTimeout(() => finish(false), Math.max(800, timeoutMs));
        iframe.addEventListener(
          'load',
          () => {
            // Wait briefly for the vault's `{ type: 'ready' }` handshake so 404/502 error pages fail fast (~350ms)
            // instead of hanging every subsequent request for 4.5s.
            postLoadGraceTimer = setTimeout(() => finish(true), 350);
          },
          { once: true }
        );
        iframe.addEventListener('error', () => finish(false), { once: true });
        iframe.src = vaultUrl;

        const container = document.body || document.documentElement;
        if (!container) {
          finish(false);
          return;
        }
        container.appendChild(iframe);
      };

      if (document.body || document.documentElement) {
        mount();
      } else {
        document.addEventListener('DOMContentLoaded', mount, { once: true });
      }
    });

    return readyPromise;
  }

  async function request(type, payload = {}) {
    const ok = await ensureReady();
    if (!ok || destroyed || !iframe?.contentWindow) return null;
    const id = `ks_${Date.now()}_${++reqSeq}`;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        pending.delete(id);
        // Self-heal: if a loaded iframe failed to answer (e.g. offline/5xx error page), tear it down so next call retries cleanly
        if (pending.size === 0) {
          teardownIframe();
        }
        resolve(null);
      }, Math.max(800, timeoutMs));

      pending.set(id, { resolve, timer });
      try {
        iframe.contentWindow.postMessage(
          {
            channel: SHARED_GEMINI_KEY_CHANNEL,
            id,
            type,
            ...payload
          },
          vaultOrigin
        );
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        teardownIframe();
        resolve(null);
      }
    });
  }

  return {
    vaultUrl,
    vaultOrigin,
    async getRecord() {
      const res = await request('get');
      return res?.ok ? normalizeSharedGeminiKeyRecord(res.record) : null;
    },
    async setRecord(record) {
      const normalized = normalizeSharedGeminiKeyRecord(record);
      if (!normalized) return null;
      const res = await request('set', { record: normalized });
      return res?.ok ? normalizeSharedGeminiKeyRecord(res.record) : null;
    },
    async clearRecord(updatedAtMs) {
      const t = Math.max(1, Math.floor(Number(updatedAtMs) || Date.now()));
      const res = await request('clear', { t });
      return res?.ok ? normalizeSharedGeminiKeyRecord(res.record) : null;
    },
    destroy() {
      destroyed = true;
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.resolve(null);
      }
      pending.clear();
      teardownIframe();
    }
  };
}

let singletonVaultClient = null;
let singletonVaultUrlKey = '';

function getOrCreateVaultClient({ vaultUrlOverride = '', timeoutMs = DEFAULT_VAULT_TIMEOUT_MS } = {}) {
  if (typeof window === 'undefined' || !window.location) return null;
  const explicitOverride =
    String(vaultUrlOverride || window.__NFL_KEY_VAULT_URL__ || '').trim();
  const useVault = shouldUseCrossSubdomainVault({
    hostname: window.location.hostname,
    origin: window.location.origin,
    vaultUrlOverride: explicitOverride
  });
  if (!useVault) return null;
  const targetUrl = explicitOverride || DEFAULT_KEY_VAULT_URL;
  if (singletonVaultClient && singletonVaultUrlKey === targetUrl) {
    return singletonVaultClient;
  }
  if (singletonVaultClient) {
    singletonVaultClient.destroy();
  }
  singletonVaultClient = createCrossSubdomainVaultClient({ vaultUrl: targetUrl, timeoutMs });
  singletonVaultUrlKey = targetUrl;
  return singletonVaultClient;
}

export function resetSharedVaultClientForTests() {
  if (singletonVaultClient) {
    singletonVaultClient.destroy();
    singletonVaultClient = null;
    singletonVaultUrlKey = '';
  }
  e2eeDerivedCache.clear();
  cachedPasskeyKeysMem = null;
  lastCloudVaultPullMs = 0;
  lastCloudVaultPullPasscodeHash = '';
  lastPasskeyCloudPullMs = 0;
}

// ============================================================================
// 1-Tap Face ID / Passkey PRF Sync (`rpId: 'joshal.com'`) + Zero-Knowledge E2EE Cloud Vault
// Bridges Apple's OS-level `WKWebsiteDataStore` isolation between separate iPhone Home Screen PWAs
// (e.g. `49ers.joshal.com` PWA <-> `bears.joshal.com` PWA <-> `nfl.joshal.com` PWA <-> Mac Safari)
// with ZERO passcodes to invent or type!
// ============================================================================

export const PASSKEY_SYNC_RP_NAME = 'NFL Team Hub (joshal.com)';
export const PASSKEY_SYNC_USER_NAME = 'Gemini API Key Sync';
const PASSKEY_SYNC_USER_ID = new Uint8Array([
  106, 111, 115, 104, 97, 108, 45, 110, 102, 108, 45, 115, 121, 110, 99, 49
]); // 'joshal-nfl-sync1' (deterministic so iCloud Keychain cleanly deduplicates per user)
const PASSKEY_IDB_NAME = 'joshal_nfl_passkey_vault_v1';
const PASSKEY_IDB_STORE = 'keys';
const PASSKEY_IDB_RECORD_KEY = 'active_prf_key_v1';

const e2eeDerivedCache = new Map();
let cachedPasskeyKeysMem = null;
let lastCloudVaultPullMs = 0;
let lastCloudVaultPullPasscodeHash = '';
let lastPasskeyCloudPullMs = 0;
let cachedPrfEvalSaltPromise = null;

function getSubtleCrypto() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
      return globalThis.crypto;
    }
  } catch {}
  return null;
}

function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function resolvePasskeyRpId(hostname = '') {
  const clean = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (isAllowedNflTeamHostname(clean)) {
    return 'joshal.com';
  }
  return clean || 'localhost';
}

export function isPasskeyPrfPotentiallySupported() {
  try {
    if (typeof window === 'undefined') return false;
    if (typeof window.PublicKeyCredential !== 'function') return false;
    if (!window.navigator?.credentials?.create || !window.navigator?.credentials?.get) return false;
    if (!getSubtleCrypto()?.subtle) return false;
    const host = String(window.location?.hostname || '').toLowerCase();
    const isSecure =
      window.isSecureContext === true ||
      host === 'localhost' ||
      host === '127.0.0.1';
    return isSecure;
  } catch {
    return false;
  }
}

// Precomputed SHA-256('joshal-nfl-passkey-prf-eval-v1') so WebAuthn creds.create/get execute
// 100% synchronously inside the iOS Safari tap gesture (zero dropped user activation on first tap).
const PASSKEY_PRF_EVAL_SALT_BYTES = new Uint8Array([
  232, 30, 231, 182, 234, 46, 58, 174, 21, 254, 147, 210, 101, 141, 71, 155,
  87, 80, 230, 183, 159, 235, 25, 207, 112, 198, 37, 231, 125, 1, 200, 192
]);

export async function getPasskeyPrfEvalSalt() {
  return PASSKEY_PRF_EVAL_SALT_BYTES;
}

/**
 * Derives independent `vaultId` (64-char hex) and non-extractable `aesKey` (AES-256-GCM)
 * from the 32-byte WebAuthn PRF secret via HKDF-SHA256 (<1ms, zero passwords!).
 */
export async function derivePasskeyVaultKeysFromPrf(prfSecretBytes) {
  const webCrypto = getSubtleCrypto();
  if (!webCrypto?.subtle || !prfSecretBytes) return null;
  const rawBytes =
    prfSecretBytes instanceof Uint8Array
      ? prfSecretBytes
      : prfSecretBytes instanceof ArrayBuffer
        ? new Uint8Array(prfSecretBytes)
        : ArrayBuffer.isView(prfSecretBytes)
          ? new Uint8Array(prfSecretBytes.buffer, prfSecretBytes.byteOffset, prfSecretBytes.byteLength)
          : null;
  if (!rawBytes || rawBytes.byteLength < 16) return null;

  const enc = new TextEncoder();
  const hkdfSalt = enc.encode('joshal-nfl-passkey-vault-v1');
  const ikm = await webCrypto.subtle.importKey('raw', rawBytes, { name: 'HKDF' }, false, [
    'deriveBits',
    'deriveKey'
  ]);

  const [idBits, aesKey] = await Promise.all([
    webCrypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: hkdfSalt, info: enc.encode('vault-id') },
      ikm,
      256
    ),
    webCrypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: hkdfSalt, info: enc.encode('aes-gcm-key') },
      ikm,
      { name: 'AES-GCM', length: 256 },
      false, // Non-extractable CryptoKey — safe to persist in IndexedDB!
      ['encrypt', 'decrypt']
    )
  ]);

  return {
    vaultId: bytesToHex(new Uint8Array(idBits)),
    aesKey
  };
}

function openPasskeyKeyIdb() {
  return new Promise(resolve => {
    let settled = false;
    const finish = val => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), 2500);
    try {
      if (typeof indexedDB === 'undefined') {
        finish(null);
        return;
      }
      const req = indexedDB.open(PASSKEY_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(PASSKEY_IDB_STORE)) {
            db.createObjectStore(PASSKEY_IDB_STORE);
          }
        } catch {}
      };
      req.onsuccess = () => finish(req.result);
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
}

export async function saveCachedPasskeyVaultKeys(keys) {
  if (!keys?.vaultId || !keys?.aesKey) return false;
  cachedPasskeyKeysMem = { vaultId: keys.vaultId, aesKey: keys.aesKey };
  const db = await openPasskeyKeyIdb();
  if (!db) return true;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(PASSKEY_IDB_STORE, 'readwrite');
      tx.objectStore(PASSKEY_IDB_STORE).put(
        { vaultId: keys.vaultId, aesKey: keys.aesKey, savedAt: Date.now() },
        PASSKEY_IDB_RECORD_KEY
      );
      tx.oncomplete = () => {
        try { db.close(); } catch {}
        resolve(true);
      };
      tx.onerror = () => {
        try { db.close(); } catch {}
        resolve(false);
      };
    } catch {
      try { db.close(); } catch {}
      resolve(false);
    }
  });
}

export async function loadCachedPasskeyVaultKeys() {
  if (cachedPasskeyKeysMem?.vaultId && cachedPasskeyKeysMem?.aesKey) {
    return cachedPasskeyKeysMem;
  }
  const db = await openPasskeyKeyIdb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(PASSKEY_IDB_STORE, 'readonly');
      const req = tx.objectStore(PASSKEY_IDB_STORE).get(PASSKEY_IDB_RECORD_KEY);
      req.onsuccess = () => {
        const val = req.result;
        try { db.close(); } catch {}
        if (val?.vaultId && val?.aesKey) {
          cachedPasskeyKeysMem = { vaultId: val.vaultId, aesKey: val.aesKey };
          resolve(cachedPasskeyKeysMem);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => {
        try { db.close(); } catch {}
        resolve(null);
      };
    } catch {
      try { db.close(); } catch {}
      resolve(null);
    }
  });
}

export async function clearCachedPasskeyVaultKeys() {
  cachedPasskeyKeysMem = null;
  const db = await openPasskeyKeyIdb();
  if (!db) return;
  await new Promise(resolve => {
    try {
      const tx = db.transaction(PASSKEY_IDB_STORE, 'readwrite');
      tx.objectStore(PASSKEY_IDB_STORE).delete(PASSKEY_IDB_RECORD_KEY);
      tx.oncomplete = () => {
        try { db.close(); } catch {}
        resolve();
      };
      tx.onerror = () => {
        try { db.close(); } catch {}
        resolve();
      };
    } catch {
      try { db.close(); } catch {}
      resolve();
    }
  });
}

async function encryptRecordWithDerivedKeys(record, derived) {
  const norm = normalizeSharedGeminiKeyRecord(record);
  const webCrypto = getSubtleCrypto();
  if (!norm || !derived?.vaultId || !derived?.aesKey || !webCrypto?.subtle) return null;
  const iv = new Uint8Array(12);
  webCrypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(norm));
  const ctBuf = await webCrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derived.aesKey,
    plaintext
  );
  return {
    id: derived.vaultId,
    v: 1,
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(new Uint8Array(ctBuf)),
    t: norm.t
  };
}

async function decryptPayloadWithAesKey(payload, aesKey) {
  if (!payload || typeof payload !== 'object' || !aesKey) return null;
  const iv = base64UrlToBytes(payload.iv);
  const ct = base64UrlToBytes(payload.ct);
  const webCrypto = getSubtleCrypto();
  if (!iv || iv.length !== 12 || !ct || ct.length < 16 || !webCrypto?.subtle) return null;
  try {
    const ptBuf = await webCrypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
    const json = new TextDecoder().decode(new Uint8Array(ptBuf));
    return normalizeSharedGeminiKeyRecord(JSON.parse(json));
  } catch {
    return null;
  }
}

function isCloudVaultHostEligible(hostname = '', endpointOverride = '') {
  if (endpointOverride) return true;
  const h = String(hostname || '').trim().toLowerCase();
  if (isAllowedNflTeamHostname(h)) return true;
  if (/^(?:[a-z0-9-]+\.)?nfl-(?:teams|joshal)\.pages\.dev$/.test(h)) return true;
  return false;
}

async function fetchCloudVaultWithDerivedKeys(
  derived,
  { endpointOverride = '', fetchImpl = null, timeoutMs = 5000 } = {}
) {
  const host = typeof window !== 'undefined' ? window.location?.hostname || '' : '';
  if (!derived?.vaultId || !derived?.aesKey || !isCloudVaultHostEligible(host, endpointOverride)) {
    return { checked: false, record: null };
  }
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) return { checked: false, record: null };

  try {
    const endpoint = resolveCloudVaultEndpoint(endpointOverride);
    const sep = endpoint.includes('?') ? '&' : '?';
    const url = `${endpoint}${sep}id=${encodeURIComponent(derived.vaultId)}`;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), Math.max(1500, timeoutMs)) : null;
    try {
      const res = await f(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        ...(ctrl ? { signal: ctrl.signal } : {})
      });
      if (!res || !res.ok) return { checked: true, record: null };
      const data = await res.json();
      if (!data?.ok || !data.found || !data.payload) {
        return { checked: true, record: null };
      }
      const record = await decryptPayloadWithAesKey(data.payload, derived.aesKey);
      return { checked: true, record };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return { checked: false, record: null };
  }
}

async function pushCloudVaultWithDerivedKeys(
  record,
  derived,
  { endpointOverride = '', fetchImpl = null, timeoutMs = 5000 } = {}
) {
  const host = typeof window !== 'undefined' ? window.location?.hostname || '' : '';
  if (!derived?.vaultId || !derived?.aesKey || !isCloudVaultHostEligible(host, endpointOverride)) {
    return { synced: false };
  }
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) return { synced: false };

  try {
    const encrypted = await encryptRecordWithDerivedKeys(record, derived);
    if (!encrypted) return { synced: false };
    const endpoint = resolveCloudVaultEndpoint(endpointOverride);
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), Math.max(1500, timeoutMs)) : null;
    try {
      const res = await f(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(encrypted),
        ...(ctrl ? { signal: ctrl.signal } : {})
      });
      return { synced: Boolean(res && res.ok) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return { synced: false };
  }
}

/**
 * Registers a `joshal.com`-scoped iCloud Keychain / platform Passkey with PRF extension
 * and immediately encrypts & uploads the user's Gemini API key into `/api/key-vault`.
 * MUST be invoked directly inside a user tap/click handler so iOS Face ID activation succeeds!
 */
export async function enablePasskeyKeySync({
  record = null,
  hostname = '',
  endpointOverride = '',
  vaultUrlOverride = '',
  credentialsApi = null,
  fetchImpl = null
} = {}) {
  const creds = credentialsApi || (typeof navigator !== 'undefined' ? navigator.credentials : null);
  const webCrypto = getSubtleCrypto();
  if (!creds?.create || !webCrypto?.subtle) {
    return {
      ok: false,
      status: 'unsupported',
      message: 'Face ID / Passkey sync is not supported in this browser.'
    };
  }
  const activeHost = hostname || (typeof window !== 'undefined' ? window.location?.hostname || '' : '');
  const rpId = resolvePasskeyRpId(activeHost);
  const prfSalt = PASSKEY_PRF_EVAL_SALT_BYTES;
  const challenge = new Uint8Array(32);
  webCrypto.getRandomValues(challenge);

  let credential = null;
  try {
    credential = await creds.create({
      publicKey: {
        challenge,
        rp: { id: rpId, name: PASSKEY_SYNC_RP_NAME },
        user: {
          id: PASSKEY_SYNC_USER_ID,
          name: PASSKEY_SYNC_USER_NAME,
          displayName: PASSKEY_SYNC_USER_NAME
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 }
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          requireResidentKey: true,
          userVerification: 'required'
        },
        timeout: 60_000,
        attestation: 'none',
        extensions: {
          prf: {
            eval: {
              first: prfSalt
            }
          }
        }
      }
    });
  } catch (err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
      return { ok: false, status: 'cancelled', message: '' };
    }
    return {
      ok: false,
      status: 'error',
      message: err?.message || 'Unable to enable Face ID sync on this device.'
    };
  }

  const ext = typeof credential?.getClientExtensionResults === 'function'
    ? credential.getClientExtensionResults()
    : {};
  const prf = ext?.prf || {};
  const prfFirst = prf?.results?.first || null;

  if (!prfFirst) {
    if (prf?.enabled === true) {
      // Safari 18.0-18.3 returns `enabled: true` on create() and yields `results.first` on get()
      return {
        ok: false,
        status: 'needs_verification_tap',
        message: 'Passkey created! Tap "Finish Face ID Sync" once to upload your encrypted key.'
      };
    }
    return {
      ok: false,
      status: 'prf_unsupported',
      message:
        'This device does not support Passkey encryption yet (requires iOS 18+ or Chrome). Save your key in Apple Passwords when prompted, or use nfl.joshal.com.'
    };
  }

  const derived = await derivePasskeyVaultKeysFromPrf(prfFirst);
  if (!derived) {
    return { ok: false, status: 'error', message: 'Failed to derive Passkey encryption keys.' };
  }
  await saveCachedPasskeyVaultKeys(derived);

  // Merge LWW against any existing cloud vault record before uploading
  const existingCloud = await fetchCloudVaultWithDerivedKeys(derived, { endpointOverride, fetchImpl });
  const normLocal = normalizeSharedGeminiKeyRecord(record) || readSameOriginSharedGeminiKey();
  const winner = pickNewestSharedRecord(normLocal, existingCloud.record);
  if (winner) {
    writeSameOriginSharedGeminiKey(winner);
    const pushed = await pushCloudVaultWithDerivedKeys(winner, derived, { endpointOverride, fetchImpl });
    const client = getOrCreateVaultClient({ vaultUrlOverride });
    if (client) {
      try {
        if (winner.c === 1) await client.clearRecord(winner.t);
        else await client.setRecord(winner);
      } catch {}
    }
    return {
      ok: true,
      status: pushed.synced ? 'synced' : 'local_only',
      record: winner,
      vaultId: derived.vaultId,
      cloudSynced: pushed.synced
    };
  }

  return { ok: true, status: 'enabled_empty', record: null, vaultId: derived.vaultId, cloudSynced: false };
}

/**
 * Unlocks the `joshal.com`-scoped iCloud Keychain / platform Passkey via 1-tap Face ID,
 * derives `(vaultId, aesKey)` via HKDF-SHA256, caches the non-extractable key in IndexedDB,
 * and pulls (or pushes) the user's Gemini API key from `/api/key-vault`.
 * MUST be invoked directly inside a user tap/click handler!
 */
export async function unlockAndSyncWithPasskey({
  localRecord = null,
  hostname = '',
  endpointOverride = '',
  vaultUrlOverride = '',
  credentialsApi = null,
  fetchImpl = null
} = {}) {
  const creds = credentialsApi || (typeof navigator !== 'undefined' ? navigator.credentials : null);
  const webCrypto = getSubtleCrypto();
  if (!creds?.get || !webCrypto?.subtle) {
    return {
      ok: false,
      status: 'unsupported',
      message: 'Face ID / Passkey sync is not supported in this browser.'
    };
  }
  const activeHost = hostname || (typeof window !== 'undefined' ? window.location?.hostname || '' : '');
  const rpId = resolvePasskeyRpId(activeHost);
  const prfSalt = PASSKEY_PRF_EVAL_SALT_BYTES;
  const challenge = new Uint8Array(32);
  webCrypto.getRandomValues(challenge);

  let assertion = null;
  try {
    assertion = await creds.get({
      publicKey: {
        challenge,
        rpId,
        allowCredentials: [],
        userVerification: 'required',
        timeout: 60_000,
        extensions: {
          prf: {
            eval: {
              first: prfSalt
            }
          }
        }
      }
    });
  } catch (err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
      return { ok: false, status: 'cancelled', message: '' };
    }
    return {
      ok: false,
      status: 'error',
      message: err?.message || 'Unable to verify Face ID Passkey on this device.'
    };
  }

  const ext = typeof assertion?.getClientExtensionResults === 'function'
    ? assertion.getClientExtensionResults()
    : {};
  const prfFirst = ext?.prf?.results?.first || null;
  if (!prfFirst) {
    return {
      ok: false,
      status: 'prf_unsupported',
      message:
        'This Passkey did not return an encryption secret (requires iOS 18+ iCloud Keychain or Chrome).'
    };
  }

  const derived = await derivePasskeyVaultKeysFromPrf(prfFirst);
  if (!derived) {
    return { ok: false, status: 'error', message: 'Failed to derive Passkey encryption keys.' };
  }
  await saveCachedPasskeyVaultKeys(derived);

  const cloudRes = await fetchCloudVaultWithDerivedKeys(derived, { endpointOverride, fetchImpl });
  const normLocal = normalizeSharedGeminiKeyRecord(localRecord) || readSameOriginSharedGeminiKey();
  const winner = pickNewestSharedRecord(normLocal, cloudRes.record);

  if (!winner || winner.c === 1) {
    return {
      ok: false,
      status: 'empty_vault',
      vaultId: derived.vaultId,
      message:
        'No synced API key found yet. Paste your Gemini key on one team app and tap "Enable Face ID Sync" first.'
    };
  }

  writeSameOriginSharedGeminiKey(winner);
  const client = getOrCreateVaultClient({ vaultUrlOverride });
  if (client) {
    try {
      await client.setRecord(winner);
    } catch {}
  }

  const shouldPushWinner = !cloudRes.record || winner.t > cloudRes.record.t;
  let pushed = false;
  if (shouldPushWinner) {
    const pushRes = await pushCloudVaultWithDerivedKeys(winner, derived, { endpointOverride, fetchImpl });
    pushed = Boolean(pushRes.synced);
  }

  return {
    ok: true,
    status: shouldPushWinner ? 'pushed' : 'pulled',
    record: winner,
    vaultId: derived.vaultId,
    cloudSynced: pushed || Boolean(cloudRes.record)
  };
}

export function isEligibleE2eeSyncPasscode(passcode = '') {
  return String(passcode || '').trim().length >= E2EE_VAULT_MIN_PASSCODE_LENGTH;
}

export function shouldUseEncryptedCloudVault({
  passcode = '',
  hostname = '',
  endpointOverride = ''
} = {}) {
  if (!isEligibleE2eeSyncPasscode(passcode)) return false;
  return isCloudVaultHostEligible(hostname, endpointOverride);
}

/**
 * Derives independent `vaultId` (64-char hex lookup ID) and `aesKey` (AES-256-GCM CryptoKey)
 * strictly inside the browser via domain-separated PBKDF2-SHA256.
 * Neither the passcode nor `aesKey` ever leaves the client device.
 */
export async function deriveEncryptedVaultKeys(passcode = '') {
  const clean = String(passcode || '').trim();
  if (!isEligibleE2eeSyncPasscode(clean)) return null;
  if (e2eeDerivedCache.has(clean)) {
    return e2eeDerivedCache.get(clean);
  }
  const webCrypto = getSubtleCrypto();
  if (!webCrypto?.subtle) return null;

  const derivePromise = (async () => {
    const enc = new TextEncoder();
    const baseKey = await webCrypto.subtle.importKey(
      'raw',
      enc.encode(clean),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    const [idBits, aesKey] = await Promise.all([
      webCrypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: enc.encode('joshal-nfl-e2ee-key-vault-id-v1'),
          iterations: E2EE_VAULT_PBKDF2_ITERATIONS,
          hash: 'SHA-256'
        },
        baseKey,
        256
      ),
      webCrypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: enc.encode('joshal-nfl-e2ee-key-vault-aes-v1'),
          iterations: E2EE_VAULT_PBKDF2_ITERATIONS,
          hash: 'SHA-256'
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
    ]);

    return {
      vaultId: bytesToHex(new Uint8Array(idBits)),
      aesKey
    };
  })().catch(err => {
    e2eeDerivedCache.delete(clean);
    throw err;
  });

  // Deduplicate concurrent PBKDF2 runs and keep a small bounded RAM cache (max 4 entries)
  if (e2eeDerivedCache.size >= 4) {
    const firstKey = e2eeDerivedCache.keys().next().value;
    e2eeDerivedCache.delete(firstKey);
  }
  e2eeDerivedCache.set(clean, derivePromise);
  return derivePromise;
}

export async function encryptSharedKeyRecordForVault(record, passcode = '') {
  const norm = normalizeSharedGeminiKeyRecord(record);
  if (!norm) return null;
  const derived = await deriveEncryptedVaultKeys(passcode);
  const webCrypto = getSubtleCrypto();
  if (!derived || !webCrypto?.subtle) return null;

  const iv = new Uint8Array(12);
  webCrypto.getRandomValues(iv);
  const plaintext = new TextEncoder().encode(JSON.stringify(norm));
  const ctBuf = await webCrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derived.aesKey,
    plaintext
  );
  return {
    id: derived.vaultId,
    v: 1,
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(new Uint8Array(ctBuf)),
    t: norm.t
  };
}

export async function decryptSharedKeyPayloadFromVault(payload, passcode = '') {
  if (!payload || typeof payload !== 'object') return null;
  const iv = base64UrlToBytes(payload.iv);
  const ct = base64UrlToBytes(payload.ct);
  if (!iv || iv.length !== 12 || !ct || ct.length < 16) return null;
  const derived = await deriveEncryptedVaultKeys(passcode);
  const webCrypto = getSubtleCrypto();
  if (!derived || !webCrypto?.subtle) return null;
  try {
    const ptBuf = await webCrypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      derived.aesKey,
      ct
    );
    const json = new TextDecoder().decode(new Uint8Array(ptBuf));
    return normalizeSharedGeminiKeyRecord(JSON.parse(json));
  } catch {
    return null;
  }
}

function resolveCloudVaultEndpoint(endpointOverride = '') {
  if (endpointOverride) return endpointOverride;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${DEFAULT_E2EE_VAULT_ENDPOINT}`;
  }
  return DEFAULT_E2EE_VAULT_ENDPOINT;
}

export async function fetchEncryptedCloudVaultRecord(
  passcode = '',
  { endpointOverride = '', fetchImpl = null, timeoutMs = 5000 } = {}
) {
  const host = typeof window !== 'undefined' ? window.location?.hostname || '' : '';
  if (!shouldUseEncryptedCloudVault({ passcode, hostname: host, endpointOverride })) {
    return { checked: false, record: null };
  }
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) return { checked: false, record: null };

  try {
    const derived = await deriveEncryptedVaultKeys(passcode);
    if (!derived) return { checked: false, record: null };
    const endpoint = resolveCloudVaultEndpoint(endpointOverride);
    const sep = endpoint.includes('?') ? '&' : '?';
    const url = `${endpoint}${sep}id=${encodeURIComponent(derived.vaultId)}`;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), Math.max(1500, timeoutMs)) : null;
    try {
      const res = await f(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        ...(ctrl ? { signal: ctrl.signal } : {})
      });
      if (!res || !res.ok) return { checked: true, record: null };
      const data = await res.json();
      if (!data?.ok || !data.found || !data.payload) {
        return { checked: true, record: null };
      }
      const record = await decryptSharedKeyPayloadFromVault(data.payload, passcode);
      return { checked: true, record };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return { checked: false, record: null };
  }
}

export async function pushEncryptedCloudVaultRecord(
  record,
  passcode = '',
  { endpointOverride = '', fetchImpl = null, timeoutMs = 5000 } = {}
) {
  const host = typeof window !== 'undefined' ? window.location?.hostname || '' : '';
  if (!shouldUseEncryptedCloudVault({ passcode, hostname: host, endpointOverride })) {
    return { synced: false };
  }
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) return { synced: false };

  try {
    const encrypted = await encryptSharedKeyRecordForVault(record, passcode);
    if (!encrypted) return { synced: false };
    const endpoint = resolveCloudVaultEndpoint(endpointOverride);
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), Math.max(1500, timeoutMs)) : null;
    try {
      const res = await f(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(encrypted),
        ...(ctrl ? { signal: ctrl.signal } : {})
      });
      return { synced: Boolean(res && res.ok) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return { synced: false };
  }
}

// ============================================================================
// High-Level Public Publish & Reconcile APIs
// ============================================================================

/**
 * Publishes an explicitly saved Gemini API key across same-origin storage, the cross-subdomain
 * iframe vault, AND (when an 8+ char Sync Passcode is configured) the zero-knowledge E2EE cloud vault.
 */
export async function publishSharedGeminiApiKey(
  { apiKey = '', verifiedModel = '', updatedAt = 0, syncPasscode = '' } = {},
  { vaultUrlOverride = '', cloudEndpointOverride = '', timeoutMs = DEFAULT_VAULT_TIMEOUT_MS, fetchImpl = null } = {}
) {
  const cleanKey = String(apiKey || '').trim();
  const cleanModel = String(verifiedModel || '').trim();
  if (!cleanKey) {
    return publishClearedSharedGeminiApiKey(
      { updatedAt, syncPasscode },
      { vaultUrlOverride, cloudEndpointOverride, timeoutMs, fetchImpl }
    );
  }
  const t = nextMonotonicSharedKeyTimestamp(updatedAt);
  const record = { v: 1, k: cleanKey, m: cleanModel, t, c: 0 };
  writeSameOriginSharedGeminiKey(record);

  let vaultSynced = false;
  let cloudSynced = false;
  const tasks = [];

  const client = getOrCreateVaultClient({ vaultUrlOverride, timeoutMs });
  if (client) {
    tasks.push(
      client
        .setRecord(record)
        .then(res => {
          vaultSynced = Boolean(res);
        })
        .catch(() => {})
    );
  }

  if (isEligibleE2eeSyncPasscode(syncPasscode)) {
    tasks.push(
      pushEncryptedCloudVaultRecord(record, syncPasscode, {
        endpointOverride: cloudEndpointOverride,
        fetchImpl
      })
        .then(res => {
          if (res?.synced) cloudSynced = true;
        })
        .catch(() => {})
    );
  }

  // If this app already unlocked Face ID / Passkey Sync, silently push updates with 0 extra Face ID prompts
  tasks.push(
    loadCachedPasskeyVaultKeys()
      .then(cachedKeys => {
        if (!cachedKeys) return null;
        return pushCloudVaultWithDerivedKeys(record, cachedKeys, {
          endpointOverride: cloudEndpointOverride,
          fetchImpl
        });
      })
      .then(res => {
        if (res?.synced) cloudSynced = true;
      })
      .catch(() => {})
  );

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
  return { apiKey: cleanKey, verifiedModel: cleanModel, updatedAt: t, vaultSynced, cloudSynced };
}

/**
 * Publishes an explicit Clear Tombstone so all 32 team apps clear the key instead of resurrecting stale copies.
 */
export async function publishClearedSharedGeminiApiKey(
  { updatedAt = 0, syncPasscode = '' } = {},
  { vaultUrlOverride = '', cloudEndpointOverride = '', timeoutMs = DEFAULT_VAULT_TIMEOUT_MS, fetchImpl = null } = {}
) {
  const t = nextMonotonicSharedKeyTimestamp(updatedAt);
  const tombstone = { v: 1, k: '', m: '', t, c: 1 };
  writeSameOriginSharedGeminiKey(tombstone);

  let vaultSynced = false;
  let cloudSynced = false;
  const tasks = [];

  const client = getOrCreateVaultClient({ vaultUrlOverride, timeoutMs });
  if (client) {
    tasks.push(
      client
        .clearRecord(t)
        .then(res => {
          vaultSynced = Boolean(res);
        })
        .catch(() => {})
    );
  }

  if (isEligibleE2eeSyncPasscode(syncPasscode)) {
    tasks.push(
      pushEncryptedCloudVaultRecord(tombstone, syncPasscode, {
        endpointOverride: cloudEndpointOverride,
        fetchImpl
      })
        .then(res => {
          if (res?.synced) cloudSynced = true;
        })
        .catch(() => {})
    );
  }

  // Propagate clear tombstone via cached Passkey key so other synced standalone apps clear too
  tasks.push(
    loadCachedPasskeyVaultKeys()
      .then(cachedKeys => {
        if (!cachedKeys) return null;
        return pushCloudVaultWithDerivedKeys(tombstone, cachedKeys, {
          endpointOverride: cloudEndpointOverride,
          fetchImpl
        });
      })
      .then(res => {
        if (res?.synced) cloudSynced = true;
      })
      .catch(() => {})
  );

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
  return { apiKey: '', verifiedModel: '', updatedAt: t, vaultSynced, cloudSynced };
}

/**
 * Reconciles a team's `prefs` object against same-origin shared storage, the remote
 * `https://nfl.joshal.com/key-sync` iframe vault, cached Passkey PRF cloud vault, AND
 * (if configured) passcode-derived E2EE cloud vault.
 */
export async function syncPrefsWithSharedGeminiKeyVault(
  prefs,
  {
    vaultUrlOverride = '',
    cloudEndpointOverride = '',
    syncPasscode = '',
    forceCloudSync = false,
    timeoutMs = DEFAULT_VAULT_TIMEOUT_MS,
    nowMs = Date.now(),
    fetchImpl = null
  } = {}
) {
  if (!prefs || typeof prefs !== 'object') {
    return { action: 'noop', changed: false, prevKey: '', nextKey: '', vaultChecked: false, cloudChecked: false };
  }
  consumeSharedKeyHandoffFromLocation();

  const prevKey = String(prefs.geminiApiKey || '').trim();
  const sameOriginRec = readSameOriginSharedGeminiKey();
  const effectivePasscode = String(syncPasscode || prefs.groupPasscode || '').trim();
  const cachedPasskeyKeys = await loadCachedPasskeyVaultKeys();

  let vaultRec = null;
  let vaultChecked = false;
  let cloudRec = null;
  let cloudChecked = false;
  let passkeyCloudRec = null;
  let passkeyCloudChecked = false;

  const client = getOrCreateVaultClient({ vaultUrlOverride, timeoutMs });
  const shouldPullCloud =
    isEligibleE2eeSyncPasscode(effectivePasscode) &&
    (forceCloudSync ||
      !prevKey ||
      effectivePasscode !== lastCloudVaultPullPasscodeHash ||
      nowMs - lastCloudVaultPullMs >= E2EE_CLOUD_PULL_THROTTLE_MS);
  const shouldPullPasskeyCloud =
    Boolean(cachedPasskeyKeys) &&
    (forceCloudSync || !prevKey || nowMs - lastPasskeyCloudPullMs >= E2EE_CLOUD_PULL_THROTTLE_MS);

  await Promise.all([
    client
      ? (async () => {
          vaultChecked = true;
          try {
            vaultRec = await client.getRecord();
          } catch {
            vaultRec = null;
          }
        })()
      : Promise.resolve(),
    shouldPullCloud
      ? (async () => {
          const res = await fetchEncryptedCloudVaultRecord(effectivePasscode, {
            endpointOverride: cloudEndpointOverride,
            fetchImpl
          });
          cloudChecked = Boolean(res.checked);
          cloudRec = res.record;
          if (cloudChecked) {
            lastCloudVaultPullMs = nowMs;
            lastCloudVaultPullPasscodeHash = effectivePasscode;
          }
        })()
      : Promise.resolve(),
    shouldPullPasskeyCloud
      ? (async () => {
          const res = await fetchCloudVaultWithDerivedKeys(cachedPasskeyKeys, {
            endpointOverride: cloudEndpointOverride,
            fetchImpl
          });
          passkeyCloudChecked = Boolean(res.checked);
          passkeyCloudRec = res.record;
          if (passkeyCloudChecked) {
            lastPasskeyCloudPullMs = nowMs;
          }
        })()
      : Promise.resolve()
  ]);

  // Re-read same-origin storage AFTER async iframe/cloud awaits so a user clear/save during the
  // network round-trip is never overwritten by a stale pre-await snapshot!
  const latestSameOriginRec = readSameOriginSharedGeminiKey() || sameOriginRec;
  const newestShared = pickNewestSharedRecord(
    pickNewestSharedRecord(latestSameOriginRec, vaultRec),
    pickNewestSharedRecord(cloudRec, passkeyCloudRec)
  );
  const outcome = reconcileGeminiKeyState(prefs, newestShared, Math.max(nowMs, Date.now()));

  const pushTargets = [];
  if (outcome.shouldPushToShared && outcome.recordToPush) {
    writeSameOriginSharedGeminiKey(outcome.recordToPush);
    if (client) {
      pushTargets.push(client.setRecord(outcome.recordToPush).catch(() => {}));
    }
    if (isEligibleE2eeSyncPasscode(effectivePasscode)) {
      pushTargets.push(
        pushEncryptedCloudVaultRecord(outcome.recordToPush, effectivePasscode, {
          endpointOverride: cloudEndpointOverride,
          fetchImpl
        }).catch(() => {})
      );
    }
    if (cachedPasskeyKeys) {
      pushTargets.push(
        pushCloudVaultWithDerivedKeys(outcome.recordToPush, cachedPasskeyKeys, {
          endpointOverride: cloudEndpointOverride,
          fetchImpl
        }).catch(() => {})
      );
    }
  } else if (newestShared) {
    // Keep same-origin mirror, iframe vault, and E2EE cloud vaults in lockstep
    if (!sameOriginRec || newestShared.t > sameOriginRec.t) {
      writeSameOriginSharedGeminiKey(newestShared);
    }
    if (client && (!vaultRec || newestShared.t > vaultRec.t)) {
      pushTargets.push(
        (newestShared.c === 1
          ? client.clearRecord(newestShared.t)
          : client.setRecord(newestShared)
        ).catch(() => {})
      );
    }
    if (cloudChecked && (!cloudRec || newestShared.t > cloudRec.t)) {
      pushTargets.push(
        pushEncryptedCloudVaultRecord(newestShared, effectivePasscode, {
          endpointOverride: cloudEndpointOverride,
          fetchImpl
        }).catch(() => {})
      );
    }
    if (passkeyCloudChecked && cachedPasskeyKeys && (!passkeyCloudRec || newestShared.t > passkeyCloudRec.t)) {
      pushTargets.push(
        pushCloudVaultWithDerivedKeys(newestShared, cachedPasskeyKeys, {
          endpointOverride: cloudEndpointOverride,
          fetchImpl
        }).catch(() => {})
      );
    }
  }

  if (pushTargets.length > 0) {
    await Promise.all(pushTargets);
  }

  if (outcome.changed) {
    prefs.geminiApiKey = outcome.apiKey;
    prefs.verifiedGeminiModel = outcome.verifiedModel;
    prefs.geminiApiKeyUpdatedAt = outcome.updatedAt;
  }

  return {
    ...outcome,
    prevKey,
    nextKey: String(prefs.geminiApiKey || '').trim(),
    vaultChecked,
    cloudChecked: cloudChecked || passkeyCloudChecked
  };
}
