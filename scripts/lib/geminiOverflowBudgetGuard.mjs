/**
 * Paid Tier 1 Gemini Free-Tier Overflow Budget Guard & Gmail SMTP Alerter
 *
 * Defense-in-depth financial protection ensuring Paid Tier 1 (`GEMINI_OVERFLOW_API_KEY` /
 * `GEMINI_X_SEARCH_API_KEY`, linked to Cloud Prepay `01035B-01A68B-2B4398` with auto-reload OFF)
 * can NEVER accidentally spend tens of dollars per month:
 *
 * 1. Strict Free-Tier-First Separation: Only invoked when ALL eligible Free Tier models are exhausted.
 * 2. Strict Model Allowlist: Allows ONLY cost-efficient Flash / Hydrogen / Flash-Lite text models
 *    (explicitly blocks Pro / Carbon / Argon / Neon / Veo / Imagen).
 * 3. Hard Mathematical & Runtime Caps:
 *    - Monthly spend ceiling: `$0.50/mo` default (hard-clamped `<= $2.00` unless explicit override)
 *    - Daily burst fuse: max `25` overflow calls/day
 *    - Monthly grounded search queries cap: `4,000` (1,000 below Google's 5,000 free search cap)
 *    - Gentle RPM pacing (`<= 10 RPM`) even on Paid Tier 1
 *    - `HTTP 402` auto-pause & balance-zero detection
 * 4. Deduplicated Gmail SMTP Alerts (`joshalbox@gmail.com` -> `joshal7@gmail.com`) via built-in `node:tls`:
 *    - First overflow event of the month
 *    - 67% (2/3) of monthly spend cap or monthly search query cap
 *    - Projected monthly cap overrun (Day >= 4 linear projection > cap)
 *    - `[URGENT]` Cap exceeded / Auto-Paused with exact GitHub/Cloudflare/AI Studio kill-switch steps
 *    - Prepaid balance reload warnings crossing below `$1.00`, `$0.50`, `$0.25`, and `$0.00`
 * 5. Race-Condition-Free Concurrency:
 *    - Serialized promise mutex (`withOverflowBudgetLock`) + atomic temp-file write & rename.
 */

import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';

export const DEFAULT_OVERFLOW_BUDGET_CONFIG = Object.freeze({
  monthlySpendCapUsd: 0.5,
  maxAllowedMonthlyCapUsd: 2.0,
  dailyCallsCap: 25,
  monthlySearchQueriesCap: 4000,
  overflowRpmSafeLimit: 10,
  prepaidSeedUsd: 5.0,
  prepaidLowThresholdsUsd: Object.freeze([1.0, 0.5, 0.25, 0.0]),
  alertFromEmail: 'joshalbox@gmail.com',
  alertToEmail: 'joshal7@gmail.com',
  gcpProjectName: 'NFL X search - 0 dollar paid',
  gcpProjectId: 'gen-lang-client-0395091873',
  cloudPrepayAccountId: '01035B-01A68B-2B4398'
});

const DISALLOWED_EXPENSIVE_OVERFLOW_MODEL_RE =
  /\b(pro|carbon|argon|neon|imagen|veo|lyria|genie|deep-research|robotics|computer-use|ultra)\b/i;
const ALLOWED_OVERFLOW_MODEL_RE =
  /^gemini-(?:\d+(?:\.\d+)?)-(?:hydrogen|flash|flash-lite|distill)/i;

/**
 * Conservative upper-bound USD per 1M tokens so spend tracking slightly overestimates rather
 * than underestimates actual Cloud Prepay drawdown.
 */
export function resolveOverflowModelPricingPerMillion(modelId = '') {
  const id = String(modelId || '').replace(/^models\//i, '').trim().toLowerCase();
  if (/\b(?:flash-lite|lite)\b/.test(id)) {
    return { inputPerM: 0.12, outputPerM: 0.48 };
  }
  return { inputPerM: 0.35, outputPerM: 1.5 };
}

export function isModelAllowedForOverflow(modelId = '') {
  const id = String(modelId || '').replace(/^models\//i, '').trim().toLowerCase();
  if (!id || DISALLOWED_EXPENSIVE_OVERFLOW_MODEL_RE.test(id)) return false;
  return ALLOWED_OVERFLOW_MODEL_RE.test(id);
}

export function estimateOverflowCallCostUsd(modelId = '', { inputTokens = 0, outputTokens = 0, searchQueries = 0, priorSearchQueriesThisMonth = 0 } = {}) {
  const { inputPerM, outputPerM } = resolveOverflowModelPricingPerMillion(modelId);
  const tokenCost =
    (Math.max(0, Number(inputTokens) || 0) / 1_000_000) * inputPerM +
    (Math.max(0, Number(outputTokens) || 0) / 1_000_000) * outputPerM;
  // First 5,000 grounded search queries/month are free on Gemini 3+ Paid Tier 1; overage is $14/1,000.
  const freeRemaining = Math.max(0, 5000 - Math.max(0, Number(priorSearchQueriesThisMonth) || 0));
  const billableSearch = Math.max(0, Math.max(0, Number(searchQueries) || 0) - freeRemaining);
  const searchCost = (billableSearch / 1000) * 14.0;
  return Number((tokenCost + searchCost).toFixed(6));
}

export function getPacificCalendarParts(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(nowMs));
  const get = t => parts.find(p => p.type === t)?.value || '';
  const year = Number(get('year')) || 2026;
  const month = Number(get('month')) || 1;
  const day = Number(get('day')) || 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    year,
    month,
    day,
    daysInMonth,
    monthKeyPt: `${year}-${String(month).padStart(2, '0')}`,
    dateKeyPt: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  };
}

export function resolveOverflowBudgetConfig(overrides = {}, env = process.env) {
  const rawCap = Number(overrides.monthlySpendCapUsd ?? env?.GEMINI_OVERFLOW_MONTHLY_CAP_USD);
  const maxAllowed = Number(overrides.maxAllowedMonthlyCapUsd ?? DEFAULT_OVERFLOW_BUDGET_CONFIG.maxAllowedMonthlyCapUsd);
  const allowOverride = String(env?.GEMINI_OVERFLOW_MAX_CAP_OVERRIDE || '') === '1';
  const monthlySpendCapUsd =
    Number.isFinite(rawCap) && rawCap > 0
      ? allowOverride
        ? rawCap
        : Math.min(rawCap, maxAllowed)
      : DEFAULT_OVERFLOW_BUDGET_CONFIG.monthlySpendCapUsd;

  const rawDaily = Number(overrides.dailyCallsCap ?? env?.GEMINI_OVERFLOW_DAILY_CALLS_CAP);
  const dailyCallsCap =
    Number.isFinite(rawDaily) && rawDaily >= 1 ? Math.min(Math.floor(rawDaily), 100) : DEFAULT_OVERFLOW_BUDGET_CONFIG.dailyCallsCap;

  const rawSearchCap = Number(overrides.monthlySearchQueriesCap ?? env?.GEMINI_OVERFLOW_SEARCH_CAP);
  const monthlySearchQueriesCap =
    Number.isFinite(rawSearchCap) && rawSearchCap >= 0
      ? Math.min(Math.floor(rawSearchCap), 4500)
      : DEFAULT_OVERFLOW_BUDGET_CONFIG.monthlySearchQueriesCap;

  const rawSeed = Number(overrides.prepaidSeedUsd ?? env?.GEMINI_OVERFLOW_PREPAID_SEED_USD);
  const prepaidSeedUsd =
    Number.isFinite(rawSeed) && rawSeed > 0 ? rawSeed : DEFAULT_OVERFLOW_BUDGET_CONFIG.prepaidSeedUsd;

  return {
    ...DEFAULT_OVERFLOW_BUDGET_CONFIG,
    ...overrides,
    monthlySpendCapUsd,
    dailyCallsCap,
    monthlySearchQueriesCap,
    prepaidSeedUsd,
    alertFromEmail: String(overrides.alertFromEmail || env?.ALERT_SMTP_USER || DEFAULT_OVERFLOW_BUDGET_CONFIG.alertFromEmail).trim(),
    alertToEmail: String(overrides.alertToEmail || env?.ALERT_EMAIL_TO || DEFAULT_OVERFLOW_BUDGET_CONFIG.alertToEmail).trim()
  };
}

export function normalizeOverflowBudgetState(raw = null, nowMs = Date.now(), config = DEFAULT_OVERFLOW_BUDGET_CONFIG) {
  const cal = getPacificCalendarParts(nowMs);
  const sameMonth = String(raw?.monthKeyPt || '') === cal.monthKeyPt;
  const sameDay = String(raw?.dateKeyPt || '') === cal.dateKeyPt;
  const seedUsd = Number(config?.prepaidSeedUsd ?? DEFAULT_OVERFLOW_BUDGET_CONFIG.prepaidSeedUsd);
  const prevBalance = Number(raw?.prepaidBalanceUsd);
  const prepaidBalanceUsd = Number.isFinite(prevBalance) ? Math.max(0, Number(prevBalance.toFixed(6))) : seedUsd;

  const prevRecent = Array.isArray(raw?.recentOverflowTimestamps) ? raw.recentOverflowTimestamps : [];
  const recentOverflowTimestamps = prevRecent.filter(ts => Number.isFinite(Number(ts)) && Number(ts) >= nowMs - 65_000);

  return {
    version: 1,
    monthKeyPt: cal.monthKeyPt,
    dateKeyPt: cal.dateKeyPt,
    monthlySpendUsd: sameMonth ? Math.max(0, Number(raw?.monthlySpendUsd) || 0) : 0,
    monthlyCalls: sameMonth ? Math.max(0, Number(raw?.monthlyCalls) || 0) : 0,
    monthlyInputTokens: sameMonth ? Math.max(0, Number(raw?.monthlyInputTokens) || 0) : 0,
    monthlyOutputTokens: sameMonth ? Math.max(0, Number(raw?.monthlyOutputTokens) || 0) : 0,
    monthlySearchQueries: sameMonth ? Math.max(0, Number(raw?.monthlySearchQueries) || 0) : 0,
    dailyCalls: sameDay ? Math.max(0, Number(raw?.dailyCalls) || 0) : 0,
    autoPaused: sameMonth ? Boolean(raw?.autoPaused) : prepaidBalanceUsd <= 0,
    autoPauseReason: sameMonth ? String(raw?.autoPauseReason || '') : prepaidBalanceUsd <= 0 ? 'prepaid_balance_depleted' : '',
    prepaidSeedUsd: Number.isFinite(Number(raw?.prepaidSeedUsd)) ? Number(raw.prepaidSeedUsd) : seedUsd,
    prepaidBalanceUsd,
    cumulativeSpendUsd: Math.max(0, Number(raw?.cumulativeSpendUsd) || 0),
    monthlyAlertsSent: sameMonth && raw?.monthlyAlertsSent && typeof raw.monthlyAlertsSent === 'object' ? { ...raw.monthlyAlertsSent } : {},
    prepaidAlertsSent: raw?.prepaidAlertsSent && typeof raw.prepaidAlertsSent === 'object' ? { ...raw.prepaidAlertsSent } : {},
    recentOverflowTimestamps,
    updatedAt: raw?.updatedAt || new Date(nowMs).toISOString()
  };
}

/**
 * Hard pre-flight gate before ANY Paid Tier 1 overflow request is allowed to execute.
 */
export function canUseOverflowGemini(rawState, { modelId = '', nowMs = Date.now(), config = DEFAULT_OVERFLOW_BUDGET_CONFIG, useSearch = false } = {}) {
  const state = normalizeOverflowBudgetState(rawState, nowMs, config);
  if (modelId && !isModelAllowedForOverflow(modelId)) {
    return { allowed: false, reason: `model_not_allowlisted:${modelId}`, waitMs: 0, state };
  }
  if (state.autoPaused) {
    return { allowed: false, reason: state.autoPauseReason || 'auto_paused', waitMs: 0, state };
  }
  if (state.prepaidBalanceUsd <= 0) {
    return { allowed: false, reason: 'prepaid_balance_depleted', waitMs: 0, state };
  }
  if (state.monthlySpendUsd >= config.monthlySpendCapUsd) {
    return { allowed: false, reason: 'monthly_spend_cap_reached', waitMs: 0, state };
  }
  if (state.dailyCalls >= config.dailyCallsCap) {
    return { allowed: false, reason: 'daily_overflow_calls_cap_reached', waitMs: 0, state };
  }
  if (useSearch && state.monthlySearchQueries >= config.monthlySearchQueriesCap) {
    return { allowed: false, reason: 'monthly_search_queries_cap_reached', waitMs: 0, state };
  }

  // Gentle RPM pacing even on Paid Tier 1
  const windowRecent = state.recentOverflowTimestamps.filter(ts => ts >= nowMs - 60_000).sort((a, b) => a - b);
  const safeRpm = Math.max(1, Number(config.overflowRpmSafeLimit) || 10);
  if (windowRecent.length >= safeRpm) {
    const oldestBlocking = windowRecent[windowRecent.length - safeRpm];
    const waitMs = Math.max(500, oldestBlocking + 60_500 - nowMs);
    return { allowed: true, reason: 'rpm_stagger', waitMs, state };
  }
  return { allowed: true, reason: 'ok', waitMs: 0, state };
}

/**
 * Records a completed (or 402/failed) Paid Tier 1 overflow call and returns any newly crossed
 * email alert descriptors (deduplicated per month / balance milestone).
 */
export function recordOverflowGeminiCall(
  rawState,
  {
    modelId = 'gemini-3.5-flash-lite',
    status = 200,
    inputTokens = 0,
    outputTokens = 0,
    searchQueries = 0,
    teamAbbr = 'NFL',
    reason = 'free_tier_exhausted',
    nowMs = Date.now(),
    config = DEFAULT_OVERFLOW_BUDGET_CONFIG
  } = {}
) {
  const state = normalizeOverflowBudgetState(rawState, nowMs, config);
  const priorBalance = state.prepaidBalanceUsd;
  const priorSearch = state.monthlySearchQueries;

  state.recentOverflowTimestamps.push(nowMs);
  state.recentOverflowTimestamps = state.recentOverflowTimestamps.filter(ts => ts >= nowMs - 65_000);
  state.updatedAt = new Date(nowMs).toISOString();

  if (status === 402) {
    state.prepaidBalanceUsd = 0;
    state.autoPaused = true;
    state.autoPauseReason = 'http_402_prepaid_depleted';
  } else {
    const callCost = estimateOverflowCallCostUsd(modelId, {
      inputTokens,
      outputTokens,
      searchQueries,
      priorSearchQueriesThisMonth: priorSearch
    });
    state.monthlyCalls += 1;
    state.dailyCalls += 1;
    state.monthlyInputTokens += Math.max(0, Number(inputTokens) || 0);
    state.monthlyOutputTokens += Math.max(0, Number(outputTokens) || 0);
    state.monthlySearchQueries += Math.max(0, Number(searchQueries) || 0);
    state.monthlySpendUsd = Number((state.monthlySpendUsd + callCost).toFixed(6));
    state.cumulativeSpendUsd = Number((state.cumulativeSpendUsd + callCost).toFixed(6));
    state.prepaidBalanceUsd = Math.max(0, Number((state.prepaidBalanceUsd - callCost).toFixed(6)));

    if (state.monthlySpendUsd >= config.monthlySpendCapUsd) {
      state.autoPaused = true;
      state.autoPauseReason = 'monthly_spend_cap_reached';
    } else if (state.monthlySearchQueries >= config.monthlySearchQueriesCap) {
      state.autoPaused = true;
      state.autoPauseReason = 'monthly_search_queries_cap_reached';
    } else if (state.prepaidBalanceUsd <= 0) {
      state.autoPaused = true;
      state.autoPauseReason = 'prepaid_balance_depleted';
    }
  }

  const alerts = evaluateOverflowAlerts(state, { priorBalance, teamAbbr, reason, modelId, nowMs, config });
  return { state, alerts };
}

/**
 * Pure alert evaluator producing deduplicated Gmail SMTP notifications across all requested triggers:
 *  - First overflow activation of the month
 *  - 67% (2/3) of monthly cap reached
 *  - Projected monthly cap overrun (Day >= 4)
 *  - `[URGENT]` Cap exceeded / Auto-Paused with kill-switch steps
 *  - Prepaid balance crossing below `$1.00`, `$0.50`, `$0.25`, and `$0.00`
 */
export function evaluateOverflowAlerts(
  state,
  { priorBalance = null, teamAbbr = 'NFL', reason = '', modelId = '', nowMs = Date.now(), config = DEFAULT_OVERFLOW_BUDGET_CONFIG } = {}
) {
  const cal = getPacificCalendarParts(nowMs);
  const alerts = [];
  const capUsd = Math.max(0.01, Number(config.monthlySpendCapUsd) || 0.5);
  const searchCap = Math.max(1, Number(config.monthlySearchQueriesCap) || 4000);
  const pctSpend = state.monthlySpendUsd / capUsd;
  const pctSearch = state.monthlySearchQueries / searchCap;

  const killSteps = [
    'HOW TO IMMEDIATELY STOP ALL PAID OVERFLOW CALLS:',
    '1) GitHub Actions: Repo -> Settings -> Secrets and variables -> Actions -> delete `GEMINI_OVERFLOW_API_KEY` (and `GEMINI_X_SEARCH_API_KEY` if set).',
    '2) Cloudflare Pages/Worker: Workers & Pages -> nfl-teams -> Settings -> Variables and Secrets -> remove `GEMINI_OVERFLOW_API_KEY`.',
    `3) Google AI Studio: Switch to project "${config.gcpProjectName}" (${config.gcpProjectId}) -> API Keys -> revoke/delete the key.`,
    `Note: Cloud Prepay (${config.cloudPrepayAccountId}) has auto-reload OFF, so it can NEVER charge your card beyond remaining prepaid balance.`
  ].join('\n');

  const statsBlock = [
    `Month (PT): ${cal.monthKeyPt} (Day ${cal.day}/${cal.daysInMonth})`,
    `Last Trigger: ${teamAbbr} | Model: ${modelId || 'n/a'} | Cause: ${reason || 'free_tier_overflow'}`,
    `Monthly Overflow Spend: $${state.monthlySpendUsd.toFixed(4)} / $${capUsd.toFixed(2)} cap (${Math.round(pctSpend * 100)}%)`,
    `Monthly Overflow Calls: ${state.monthlyCalls} (Today: ${state.dailyCalls}/${config.dailyCallsCap})`,
    `Monthly Grounded Search Queries: ${state.monthlySearchQueries} / ${searchCap} cap (Google free limit: 5,000)`,
    `Estimated Remaining Cloud Prepay Balance: $${state.prepaidBalanceUsd.toFixed(4)} (seeded at $${state.prepaidSeedUsd.toFixed(2)})`
  ].join('\n');

  // 1. [URGENT] Cap exceeded / Auto-Paused
  if (
    (state.autoPaused || state.monthlySpendUsd >= capUsd || state.monthlySearchQueries >= searchCap) &&
    !state.monthlyAlertsSent.urgent_cap_exceeded
  ) {
    state.monthlyAlertsSent.urgent_cap_exceeded = new Date(nowMs).toISOString();
    alerts.push({
      key: 'urgent_cap_exceeded',
      severity: 'urgent',
      subject: `[URGENT] NFL Gemini Overflow Cap Reached — Auto-Paused ($${state.monthlySpendUsd.toFixed(3)} / $${capUsd.toFixed(2)})`,
      body: `Paid Tier 1 Gemini overflow has hit its safety limit (${state.autoPauseReason || 'cap_reached'}) and has been AUTOMATICALLY PAUSED for the rest of ${cal.monthKeyPt}.\n\n${statsBlock}\n\n${killSteps}`
    });
  }

  // 2. 67% (2/3) Monthly Cap Warning
  if ((pctSpend >= 2 / 3 || pctSearch >= 2 / 3) && !state.monthlyAlertsSent.two_thirds_cap) {
    state.monthlyAlertsSent.two_thirds_cap = new Date(nowMs).toISOString();
    alerts.push({
      key: 'two_thirds_cap',
      severity: 'warning',
      subject: `[NFL Gemini Alert] 67% of Monthly Overflow Cap Reached ($${state.monthlySpendUsd.toFixed(3)} / $${capUsd.toFixed(2)})`,
      body: `Your Paid Tier 1 Gemini Free-Tier overflow has crossed 2/3 (67%) of its monthly cap.\n\n${statsBlock}\n\n${killSteps}`
    });
  }

  // 3. Projected Monthly Overrun Warning (Day >= 4)
  if (cal.day >= 4 && !state.monthlyAlertsSent.projected_overrun) {
    const projectedUsd = (state.monthlySpendUsd / cal.day) * cal.daysInMonth;
    const projectedSearch = (state.monthlySearchQueries / cal.day) * cal.daysInMonth;
    if (projectedUsd > capUsd || projectedSearch > searchCap) {
      state.monthlyAlertsSent.projected_overrun = new Date(nowMs).toISOString();
      alerts.push({
        key: 'projected_overrun',
        severity: 'warning',
        subject: `[NFL Gemini Alert] Projected to Exceed Monthly Cap ($${projectedUsd.toFixed(2)} est. vs $${capUsd.toFixed(2)} cap)`,
        body: `At your current pace through Day ${cal.day}, Paid Tier 1 overflow is projected to reach ~$${projectedUsd.toFixed(2)} (${Math.round(projectedSearch)} search queries) this month, exceeding your $${capUsd.toFixed(2)} cap.\n\nOverflow will auto-pause if the cap is reached.\n\n${statsBlock}\n\n${killSteps}`
      });
    }
  }

  // 4. First Overflow Triggered This Month (informational heads-up)
  if (state.monthlyCalls === 1 && !state.monthlyAlertsSent.first_overflow_month) {
    state.monthlyAlertsSent.first_overflow_month = new Date(nowMs).toISOString();
    alerts.push({
      key: 'first_overflow_month',
      severity: 'info',
      subject: `[NFL Gemini Notice] Free Tier Overflowed to Paid Tier 1 (${teamAbbr} • $${state.monthlySpendUsd.toFixed(4)})`,
      body: `Heads up: Your Free Tier Gemini quota was exhausted on ${teamAbbr}, so 1 overflow call routed to your Paid Tier 1 key (${modelId}).\n\n${statsBlock}`
    });
  }

  // 5. Cumulative Prepaid Balance Reload Thresholds ($1.00, $0.50, $0.25, $0.00)
  const thresholds = Array.isArray(config.prepaidLowThresholdsUsd)
    ? config.prepaidLowThresholdsUsd
    : DEFAULT_OVERFLOW_BUDGET_CONFIG.prepaidLowThresholdsUsd;
  for (const th of thresholds) {
    const key = `prepaid_below_${th.toFixed(2)}`;
    if (state.prepaidAlertsSent[key]) continue;
    const crossed = th === 0 ? state.prepaidBalanceUsd <= 0.0001 : state.prepaidBalanceUsd < th;
    if (!crossed) continue;
    // If balance was already seeded below threshold with 0 spend, skip false alarm unless actual drawdown/402 occurred
    if (priorBalance !== null && priorBalance < th && state.prepaidBalanceUsd === priorBalance && th > 0) continue;
    state.prepaidAlertsSent[key] = new Date(nowMs).toISOString();
    const isZero = th === 0;
    alerts.push({
      key,
      severity: isZero ? 'urgent' : 'warning',
      subject: isZero
        ? `[URGENT] NFL Gemini Cloud Prepay Balance Hit $0.00 — Reload Required`
        : `[NFL Gemini Reload Reminder] Cloud Prepay Balance Below $${th.toFixed(2)} ($${state.prepaidBalanceUsd.toFixed(2)} left)`,
      body: `${isZero ? 'Your Cloud Prepay balance has reached $0.00 and Paid Tier 1 overflow is now stopped (auto-reload is OFF, so your card was NOT charged).' : `Your estimated Cloud Prepay balance (${config.cloudPrepayAccountId}) just dropped below $${th.toFixed(2)} (currently ~$${state.prepaidBalanceUsd.toFixed(2)} remaining from your $${state.prepaidSeedUsd.toFixed(2)} seed).`}\n\nTo reload manually if desired:\nGoogle Cloud Console -> Billing -> Account ${config.cloudPrepayAccountId} -> Make a payment ($5 minimum).\n\n${statsBlock}`
    });
  }

  return alerts;
}

/**
 * Zero-dependency TLS Gmail SMTP (`smtp.gmail.com:465`) client using Google App Password (`AUTH LOGIN`).
 * Never logs credentials. Fails gracefully (non-fatal) if SMTP credentials are not configured.
 */
export async function sendGmailSmtpAlert({
  from = process.env.ALERT_SMTP_USER || DEFAULT_OVERFLOW_BUDGET_CONFIG.alertFromEmail,
  pass = process.env.ALERT_SMTP_PASS || '',
  to = process.env.ALERT_EMAIL_TO || DEFAULT_OVERFLOW_BUDGET_CONFIG.alertToEmail,
  subject = '',
  body = '',
  timeoutMs = 10_000,
  transportImpl = null
} = {}) {
  const cleanUser = String(from || '').trim();
  const cleanPass = String(pass || '').replace(/\s+/g, '').trim();
  const cleanTo = String(to || '').trim();
  if (!cleanUser || !cleanPass || !cleanTo || !subject) {
    return { sent: false, skipped: true, reason: !cleanPass ? 'missing_smtp_pass' : 'missing_fields' };
  }
  if (typeof transportImpl === 'function') {
    return transportImpl({ from: cleanUser, to: cleanTo, subject, body });
  }

  const safeSubject = String(subject).replace(/[\r\n]+/g, ' ').trim();
  const dotStuffedBody = String(body || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  const rawMessage = [
    `From: NFL Gemini Guard <${cleanUser}>`,
    `To: <${cleanTo}>`,
    `Subject: ${safeSubject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    dotStuffedBody,
    '.'
  ].join('\r\n');

  return new Promise(resolve => {
    let settled = false;
    const done = result => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      resolve(result);
    };

    const socket = tls.connect({ host: 'smtp.gmail.com', port: 465, servername: 'smtp.gmail.com' });
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => done({ sent: false, reason: 'smtp_timeout' }));
    socket.on('error', err => done({ sent: false, reason: err?.message || 'smtp_error' }));

    let buffer = '';
    const steps = [
      { expect: 220, send: 'EHLO nfl-joshal.local' },
      { expect: 250, send: 'AUTH LOGIN' },
      { expect: 334, send: Buffer.from(cleanUser, 'utf8').toString('base64') },
      { expect: 334, send: Buffer.from(cleanPass, 'utf8').toString('base64') },
      { expect: 235, send: `MAIL FROM:<${cleanUser}>` },
      { expect: 250, send: `RCPT TO:<${cleanTo}>` },
      { expect: 250, send: 'DATA' },
      { expect: 354, send: rawMessage },
      { expect: 250, send: 'QUIT' }
    ];
    let stepIdx = 0;

    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line || /^\d{3}-/.test(line)) continue; // multi-line SMTP continuation
        const code = Number(line.slice(0, 3));
        const cur = steps[stepIdx];
        if (!cur) return done({ sent: true });
        if (code !== cur.expect) {
          return done({ sent: false, reason: `smtp_unexpected_${code}_at_step_${stepIdx}` });
        }
        socket.write(`${cur.send}\r\n`);
        stepIdx += 1;
        if (stepIdx >= steps.length) {
          return done({ sent: true });
        }
      }
    });
  });
}

// In-process serialized mutex preventing concurrent async file-write / alert races
let budgetMutexChain = Promise.resolve();

export function withOverflowBudgetLock(fn) {
  const next = budgetMutexChain.then(() => fn(), () => fn());
  budgetMutexChain = next.catch(() => {});
  return next;
}

export function loadOverflowBudgetStateFromFile(filePath, { nowMs = Date.now(), config = DEFAULT_OVERFLOW_BUDGET_CONFIG } = {}) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return normalizeOverflowBudgetState(parsed, nowMs, config);
    }
  } catch {}
  return normalizeOverflowBudgetState(null, nowMs, config);
}

export function persistOverflowBudgetStateAtomically(filePath, state) {
  if (!filePath || !state) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, filePath);
}

/**
 * Convenience controller used by the Node 32-team pipeline (`aiSynthesisEngine.mjs` / `fetch-live-data.mjs`).
 * Serializes all budget checks, recording, atomic disk persistence, and deduplicated Gmail SMTP alerts.
 */
export function createNodeOverflowBudgetController({
  filePath,
  config = resolveOverflowBudgetConfig(),
  smtpPass = process.env.ALERT_SMTP_PASS || '',
  transportImpl = null
} = {}) {
  let state = loadOverflowBudgetStateFromFile(filePath, { config });

  return {
    config,
    getState() {
      return normalizeOverflowBudgetState(state, Date.now(), config);
    },
    async checkAllowed({ modelId = '', useSearch = false } = {}) {
      return withOverflowBudgetLock(async () => {
        state = normalizeOverflowBudgetState(state, Date.now(), config);
        return canUseOverflowGemini(state, { modelId, useSearch, nowMs: Date.now(), config });
      });
    },
    async recordAndNotify({
      modelId,
      status = 200,
      inputTokens = 0,
      outputTokens = 0,
      searchQueries = 0,
      teamAbbr = 'NFL',
      reason = 'free_tier_exhausted'
    } = {}) {
      return withOverflowBudgetLock(async () => {
        const res = recordOverflowGeminiCall(state, {
          modelId,
          status,
          inputTokens,
          outputTokens,
          searchQueries,
          teamAbbr,
          reason,
          nowMs: Date.now(),
          config
        });
        state = res.state;
        try {
          persistOverflowBudgetStateAtomically(filePath, state);
        } catch {}
        const deliveryResults = [];
        for (const alert of res.alerts) {
          const sent = await sendGmailSmtpAlert({
            from: config.alertFromEmail,
            pass: smtpPass,
            to: config.alertToEmail,
            subject: alert.subject,
            body: alert.body,
            transportImpl
          }).catch(err => ({ sent: false, reason: err?.message || 'smtp_exception' }));
          deliveryResults.push({ key: alert.key, ...sent });
          console.log(
            `[gemini-overflow-alert] ${alert.key} (${alert.severity}) -> ${sent.sent ? `emailed ${config.alertToEmail}` : `logged only (${sent.reason || 'unconfigured'})`}`
          );
        }
        return { state, alerts: res.alerts, deliveryResults };
      });
    }
  };
}
