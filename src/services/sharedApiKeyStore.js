/**
 * Cross-Team Shared Gemini API Key Store (All 32 NFL Team Apps + 49ers.joshal.com)
 *
 * Security & Privacy Architecture:
 *   1. ZERO HTTP Cookie Leakage: Never writes the user's Gemini API key into a `Domain=.joshal.com`
 *      cookie, ensuring third-party-mapped subdomains (e.g. `www.joshal.com` on SmugMug) and CDN/server
 *      HTTP logs receive ZERO bytes of the API key.
 *   2. Hermetically Sealed Same-Site Vault (`https://nfl.joshal.com/key-sync.html`):
 *      - All 32 `<team>.joshal.com` apps share the same eTLD+1 (`joshal.com`),
 *        so Chrome, Safari (iOS & macOS), Firefox, and Edge treat `nfl.joshal.com` as same-site/first-party
 *        with a single unified storage partition across every NFL team app.
 *      - Strictly allowlisted by BOTH HTTP `Content-Security-Policy: frame-ancestors` AND JS `event.origin`
 *        checks to the exact 32 NFL team subdomains + `nfl.joshal.com`.
 *      - `default-src 'none'; script-src 'unsafe-inline'` prevents the vault page from ever making network calls.
 *   3. Instant Same-Origin Sync (`localStorage['joshal_nfl_shared_gemini_key_v1']`):
 *      - Provides 0ms synchronous sharing across `?team=` query switches on `localhost` / `*.pages.dev`
 *        and fires cross-tab `storage` events without making external network requests during local dev/QA.
 *   4. Conflict-Safe Last-Write-Wins + Clear Tombstones:
 *      - Monotonic timestamps ensure updating a key in one team app updates all others.
 *      - Explicit clears write a `{ c: 1, t }` tombstone so other team apps cleanly clear instead of
 *        resurrecting old cached keys.
 *      - Existing users who already saved a key on `49ers.joshal.com` (or any team app) automatically
 *        backfill the shared vault on next visit with zero user action.
 */

export const SHARED_GEMINI_KEY_STORAGE_KEY = 'joshal_nfl_shared_gemini_key_v1';
export const SHARED_GEMINI_KEY_CHANNEL = 'joshal_nfl_key_sync_v1';
export const DEFAULT_KEY_VAULT_URL = 'https://nfl.joshal.com/key-sync';
export const DEFAULT_VAULT_TIMEOUT_MS = 2500;

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

export function readSameOriginSharedGeminiKey(storage = null) {
  try {
    const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!store) return null;
    const raw = store.getItem(SHARED_GEMINI_KEY_STORAGE_KEY);
    if (!raw) return null;
    return normalizeSharedGeminiKeyRecord(JSON.parse(raw));
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
    const current = readSameOriginSharedGeminiKey(store);
    if (current && current.t > normalized.t) {
      return current;
    }
    store.setItem(SHARED_GEMINI_KEY_STORAGE_KEY, JSON.stringify(normalized));
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
 * Synchronous reconciliation against same-origin shared `localStorage`.
 * Called during `loadUserPrefs()` for 0ms instant sharing across `?team=` routes & local dev.
 */
export function reconcilePrefsWithSameOriginSharedKey(prefs, { storage = null, nowMs = Date.now() } = {}) {
  if (!prefs || typeof prefs !== 'object') {
    return { action: 'noop', changed: false, prevKey: '', nextKey: '' };
  }
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

/**
 * Determines whether the remote `https://nfl.joshal.com/key-sync.html` iframe vault should be mounted.
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
 * Never throws; degrades silently to `null` if offline, blocked, or timed out.
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
  let destroyed = false;
  let reqSeq = 0;
  const pending = new Map();

  function onMessage(event) {
    if (destroyed || !iframe) return;
    if (event.origin !== vaultOrigin) return;
    if (iframe.contentWindow && event.source !== iframe.contentWindow) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.channel !== SHARED_GEMINI_KEY_CHANNEL || !msg.id) return;
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
        iframe.style.cssText =
          'display:none;width:0;height:0;border:0;position:absolute;left:-9999px;pointer-events:none;';

        let settled = false;
        const finish = ok => {
          if (settled) return;
          settled = true;
          clearTimeout(loadTimer);
          if (!ok) {
            // Reset failed/offline iframe so subsequent attempts after network recovery can succeed cleanly
            if (typeof window !== 'undefined') {
              window.removeEventListener('message', onMessage);
            }
            if (iframe && iframe.parentNode) {
              iframe.parentNode.removeChild(iframe);
            }
            iframe = null;
            readyPromise = null;
          }
          resolve(ok);
        };

        const loadTimer = setTimeout(() => finish(false), Math.max(800, timeoutMs));
        iframe.addEventListener('load', () => finish(true), { once: true });
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
      if (typeof window !== 'undefined') {
        window.removeEventListener('message', onMessage);
      }
      if (iframe && iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
      iframe = null;
      readyPromise = null;
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
}

/**
 * Publishes an explicitly saved Gemini API key across same-origin storage AND the cross-subdomain vault.
 */
export async function publishSharedGeminiApiKey(
  { apiKey = '', verifiedModel = '', updatedAt = 0 } = {},
  { vaultUrlOverride = '', timeoutMs = DEFAULT_VAULT_TIMEOUT_MS } = {}
) {
  const cleanKey = String(apiKey || '').trim();
  const cleanModel = String(verifiedModel || '').trim();
  if (!cleanKey) {
    return publishClearedSharedGeminiApiKey({ updatedAt }, { vaultUrlOverride, timeoutMs });
  }
  const t = nextMonotonicSharedKeyTimestamp(updatedAt);
  const record = { v: 1, k: cleanKey, m: cleanModel, t, c: 0 };
  writeSameOriginSharedGeminiKey(record);

  const client = getOrCreateVaultClient({ vaultUrlOverride, timeoutMs });
  if (client) {
    try {
      await client.setRecord(record);
    } catch {
      // Offline / blocked vault must never break local save
    }
  }
  return { apiKey: cleanKey, verifiedModel: cleanModel, updatedAt: t };
}

/**
 * Publishes an explicit Clear Tombstone so all 32 team apps clear the key instead of resurrecting stale copies.
 */
export async function publishClearedSharedGeminiApiKey(
  { updatedAt = 0 } = {},
  { vaultUrlOverride = '', timeoutMs = DEFAULT_VAULT_TIMEOUT_MS } = {}
) {
  const t = nextMonotonicSharedKeyTimestamp(updatedAt);
  const tombstone = { v: 1, k: '', m: '', t, c: 1 };
  writeSameOriginSharedGeminiKey(tombstone);

  const client = getOrCreateVaultClient({ vaultUrlOverride, timeoutMs });
  if (client) {
    try {
      await client.clearRecord(t);
    } catch {
      // Offline / blocked vault must never break local clear
    }
  }
  return { apiKey: '', verifiedModel: '', updatedAt: t };
}

/**
 * Reconciles a team's `prefs` object against BOTH same-origin shared storage AND the remote
 * `https://nfl.joshal.com/key-sync.html` vault (when running on any of the 32 `<team>.joshal.com` hosts).
 */
export async function syncPrefsWithSharedGeminiKeyVault(
  prefs,
  { vaultUrlOverride = '', timeoutMs = DEFAULT_VAULT_TIMEOUT_MS, nowMs = Date.now() } = {}
) {
  if (!prefs || typeof prefs !== 'object') {
    return { action: 'noop', changed: false, prevKey: '', nextKey: '', vaultChecked: false };
  }
  const prevKey = String(prefs.geminiApiKey || '').trim();
  const sameOriginRec = readSameOriginSharedGeminiKey();

  let vaultRec = null;
  let vaultChecked = false;
  const client = getOrCreateVaultClient({ vaultUrlOverride, timeoutMs });
  if (client) {
    vaultChecked = true;
    try {
      vaultRec = await client.getRecord();
    } catch {
      vaultRec = null;
    }
  }

  const newestShared = pickNewestSharedRecord(sameOriginRec, vaultRec);
  const outcome = reconcileGeminiKeyState(prefs, newestShared, nowMs);

  // If local prefs (or same-origin shared) is newer than the remote vault, push it up to the vault!
  if (outcome.shouldPushToShared && outcome.recordToPush) {
    writeSameOriginSharedGeminiKey(outcome.recordToPush);
    if (client) {
      try {
        await client.setRecord(outcome.recordToPush);
      } catch {}
    }
  } else if (newestShared) {
    // Keep same-origin mirror and remote vault in lockstep
    if (!sameOriginRec || newestShared.t > sameOriginRec.t) {
      writeSameOriginSharedGeminiKey(newestShared);
    }
    if (client && (!vaultRec || newestShared.t > vaultRec.t)) {
      try {
        if (newestShared.c === 1) {
          await client.clearRecord(newestShared.t);
        } else {
          await client.setRecord(newestShared);
        }
      } catch {}
    }
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
    vaultChecked
  };
}
