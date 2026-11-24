/**
 * Cross-Team Native Player Dossier Loader & 32-Team Registry (`*.joshal.com`)
 *
 * Enables clicking any opposing NFL player during matchups on `49ers.joshal.com`
 * (or any team app) to pop up their full native 5-tab Player Dossier Sheet
 * (`Overview`, `Health`, `Stats`, `Spider Chart`, `Contract`) hydrated directly
 * from their franchise's `<team>.joshal.com` JSON data without ever leaving
 * `49ers.joshal.com`.
 *
 * Resilience & Performance Guarantees:
 * - Zero page navigation: renders natively inside `#bottomSheetContainer` scoped
 *   with the opposing franchise's exact dark/light WCAG theme tokens.
 * - Instant UX: opens immediately with matchup seed data, then hydrates full
 *   `<team>.joshal.com` roster/health/news/contract/spider data in parallel.
 * - 5-minute in-memory TTL cache + in-flight request deduplication so clicking
 *   multiple players on the same opponent triggers only 1 network fetch.
 * - Strict JSON + schema validation (rejects HTML SPA 200 fallbacks) with
 *   automatic `/data/teams/{slug}` -> `/data` discovery and graceful matchup
 *   fallback if a remote subdomain is temporarily unreachable or offline.
 */

import { ALL_NFL_TEAMS, getActiveTeamConfig } from '../config/teamRegistry.js';
const REMOTE_TEAM_CACHE_TTL_MS = 5 * 60 * 1000;
const REMOTE_TEAM_FAIL_COOLDOWN_MS = 20 * 1000;
const DEFAULT_REMOTE_FETCH_TIMEOUT_MS = 7500;

function hexToRgb(hex = '#000000') {
  const clean = String(hex || '').replace(/^#/, '').trim();
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return { r: 0, g: 0, b: 0 };
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const EXTRA_ABBR_ALIASES = {
  sfo: 'SF',
  niners: 'SF',
  la: 'LAR',
  stl: 'LAR',
  arz: 'ARI',
  vikes: 'MIN',
  gnb: 'GB',
  wsh: 'WAS',
  tam: 'TB',
  bucs: 'TB',
  nor: 'NO',
  nwe: 'NE',
  pats: 'NE',
  blt: 'BAL',
  clv: 'CLE',
  hst: 'HOU',
  jac: 'JAX',
  jags: 'JAX',
  kan: 'KC',
  sd: 'LAC',
  oak: 'LV'
};

export const ALL_NFL_TEAM_ENTRIES = Object.freeze(
  ALL_NFL_TEAMS.map(team => {
    const dark = team.themes.dark;
    const light = team.themes.light;
    return Object.freeze({
      abbr: team.abbr,
      slug: team.slug,
      domain: team.domain,
      origin: `https://${team.domain}`,
      espnId: team.espnId,
      espnAbbr: team.espnAbbr,
      otcSlug: team.otcSlug,
      city: team.city,
      nickname: team.nickname,
      fullName: team.fullName,
      brandName: team.brandName,
      clubDomain: team.clubDomain,
      clubInjuryUrl: team.clubInjuryUrl,
      otcCapUrl: `https://overthecap.com/salary-cap/${team.otcSlug}`,
      themes: Object.freeze({
        dark: Object.freeze({
          primary: dark.primary,
          primaryBright: dark.primaryBright,
          primarySoft: dark.primarySoft,
          secondary: dark.secondary,
          secondaryBright: dark.secondaryBright,
          secondarySoft: dark.secondarySoft,
          secondaryBorder: dark.secondaryBorder,
          heroGlowPrimary: hexToRgba(dark.primaryBright, 0.3),
          heroGlowSecondary: hexToRgba(dark.secondary, 0.2),
          pillShadow: hexToRgba(dark.primary, 0.34)
        }),
        light: Object.freeze({
          primary: light.primary,
          primaryBright: light.primaryBright,
          primarySoft: light.primarySoft,
          secondary: light.secondary,
          secondaryBright: light.secondaryBright,
          secondarySoft: light.secondarySoft,
          secondaryBorder: light.secondaryBorder,
          heroGlowPrimary: hexToRgba(light.primary, 0.18),
          heroGlowSecondary: hexToRgba(light.secondary, 0.16),
          pillShadow: hexToRgba(light.primary, 0.26)
        })
      })
    });
  })
);

export const NFL_TEAMS_BY_ABBR = Object.freeze(
  Object.fromEntries(ALL_NFL_TEAM_ENTRIES.map(t => [t.abbr, t]))
);

const LOOKUP_INDEX = new Map();
for (const t of ALL_NFL_TEAM_ENTRIES) {
  LOOKUP_INDEX.set(t.abbr.toLowerCase(), t);
  LOOKUP_INDEX.set(t.slug.toLowerCase(), t);
  LOOKUP_INDEX.set(t.espnAbbr.toLowerCase(), t);
  LOOKUP_INDEX.set(t.nickname.toLowerCase(), t);
  LOOKUP_INDEX.set(t.fullName.toLowerCase(), t);
  LOOKUP_INDEX.set(t.domain.toLowerCase(), t);
}
for (const [alias, abbr] of Object.entries(EXTRA_ABBR_ALIASES)) {
  if (NFL_TEAMS_BY_ABBR[abbr]) {
    LOOKUP_INDEX.set(alias, NFL_TEAMS_BY_ABBR[abbr]);
  }
}

export function resolveNflTeamMeta(teamInput = null) {
  if (!teamInput) return null;
  if (typeof teamInput === 'object') {
    if (teamInput.abbr && NFL_TEAMS_BY_ABBR[String(teamInput.abbr).toUpperCase()]) {
      return NFL_TEAMS_BY_ABBR[String(teamInput.abbr).toUpperCase()];
    }
    return resolveNflTeamMeta(teamInput.slug || teamInput.fullName || teamInput.nickname || '');
  }
  const clean = String(teamInput || '').trim().toLowerCase();
  if (!clean || clean === 'tbd' || clean === 'bye' || clean === 'opp' || clean === 'nfl') return null;
  const direct = LOOKUP_INDEX.get(clean);
  if (direct) return direct;
  // Support partial/full strings like "Minnesota Vikings (MIN)" or "vikings.joshal.com"
  const hostMatch = clean.match(/^https?:\/\/([a-z0-9-]+)\.joshal\.com/);
  if (hostMatch && LOOKUP_INDEX.has(hostMatch[1])) {
    return LOOKUP_INDEX.get(hostMatch[1]);
  }
  const tailWord = clean.replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).pop();
  if (tailWord && LOOKUP_INDEX.has(tailWord)) {
    return LOOKUP_INDEX.get(tailWord);
  }
  return null;
}

export function buildTeamSiteOrigin(teamInput) {
  const team = resolveNflTeamMeta(teamInput);
  return team ? team.origin : null;
}

export function buildTeamDataBaseUrls(teamInput, { baseUrlOverride = null, browserOrigin = null } = {}) {
  const team = resolveNflTeamMeta(teamInput);
  if (!team) return [];
  const effectiveOverride =
    baseUrlOverride ??
    (typeof globalThis !== 'undefined' ? globalThis.__REMOTE_TEAM_DATA_BASE_OVERRIDE__ : null);

  if (typeof effectiveOverride === 'function') {
    const res = effectiveOverride(team);
    if (Array.isArray(res)) return res.map(u => String(u || '').replace(/\/+$/, '')).filter(Boolean);
    return res ? [String(res).replace(/\/+$/, '')] : [];
  }
  if (typeof effectiveOverride === 'string' && effectiveOverride.trim()) {
    const tmpl = effectiveOverride.trim().replace(/\/+$/, '');
    if (tmpl.includes('{slug}') || tmpl.includes('{abbr}')) {
      return [tmpl.replace(/\{slug\}/g, team.slug).replace(/\{abbr\}/g, team.abbr.toLowerCase())];
    }
    return [`${tmpl}/${team.slug}`];
  }

  const urls = [];
  const resolvedBrowserOrigin =
    typeof browserOrigin === 'string' && /^https?:\/\//i.test(browserOrigin.trim())
      ? browserOrigin.trim().replace(/\/+$/, '')
      : typeof window !== 'undefined' &&
          window.location?.origin &&
          /^https?:$/i.test(window.location?.protocol || '')
        ? window.location.origin.replace(/\/+$/, '')
        : '';

  if (resolvedBrowserOrigin) {
    const sameOriginPath =
      team.abbr === 'SF'
        ? `${resolvedBrowserOrigin}/data`
        : `${resolvedBrowserOrigin}/data/teams/${team.slug}`;
    urls.push(sameOriginPath);
  }

  if (team.abbr === 'SF') {
    urls.push('https://49ers.joshal.com/data');
  } else {
    urls.push(`https://${team.slug}.joshal.com/data/teams/${team.slug}`);
    urls.push(`https://${team.slug}.joshal.com/data`);
  }

  return Array.from(new Set(urls));
}

export function getRemoteTeamSheetThemeVars(teamInput, themeMode = 'dark') {
  const team = resolveNflTeamMeta(teamInput);
  if (!team) return null;
  const mode = themeMode === 'light' ? 'light' : 'dark';
  const palette = team.themes[mode];
  return {
    '--scarlet': palette.primary,
    '--scarlet-bright': palette.primaryBright,
    '--scarlet-soft': palette.primarySoft,
    '--gold': palette.secondary,
    '--gold-bright': palette.secondaryBright,
    '--gold-soft': palette.secondarySoft,
    '--gold-border': palette.secondaryBorder,
    '--dossier-hero-glow-primary': palette.heroGlowPrimary,
    '--dossier-hero-glow-secondary': palette.heroGlowSecondary,
    '--pill-active-shadow': palette.pillShadow
  };
}

export function extractEspnPlayerIdFromRecord(rec = null) {
  if (!rec || typeof rec !== 'object') return '';
  for (const cand of [rec.id, rec.playerId, rec.espnId]) {
    const s = String(cand ?? '').trim();
    if (/^\d{4,10}$/.test(s)) return s;
  }
  const urlMatch = String(rec.espnUrl || rec.url || '').match(/\/id\/(\d{4,10})(?:\/|$|\?)/);
  if (urlMatch) return urlMatch[1];
  const hsMatch = String(rec.headshotUrl || '').match(/\/full\/(\d{4,10})\.png/i);
  if (hsMatch) return hsMatch[1];
  return '';
}

export function normalizePlayerNameKey(raw = '') {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/\b([A-Za-z])\.\s*([A-Za-z])\.(?=\s|$)/g, '$1$2')
    .replace(/,?\s+\b(?:Jr\.?|Sr\.?|II|III|IV|V)\b\.?$/i, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function normalizePosGroup(pos = '') {
  const p = String(pos || '').trim().toUpperCase();
  if (!p) return '';
  if (['OT', 'OG', 'G', 'T', 'C', 'OL'].includes(p)) return 'OL';
  if (['DE', 'EDGE', 'DT', 'NT', 'DL'].includes(p)) return 'DL';
  if (['LB', 'ILB', 'OLB', 'MLB'].includes(p)) return 'LB';
  if (['CB', 'S', 'FS', 'SS', 'DB', 'SAF'].includes(p)) return 'DB';
  if (['RB', 'FB', 'HB'].includes(p)) return 'RB';
  return p;
}

export function findPlayerInTeamRoster(players = [], { playerId = '', espnId = '', name = '', position = '' } = {}) {
  if (!Array.isArray(players) || players.length === 0) return null;
  const cleanId = String(espnId || playerId || '').trim();
  if (cleanId && /^\d{4,10}$/.test(cleanId)) {
    const byId = players.find(
      p => String(p?.id || '') === cleanId || extractEspnPlayerIdFromRecord(p) === cleanId
    );
    if (byId) return byId;
  }
  const normName = normalizePlayerNameKey(name);
  if (!normName) return null;
  const matches = players.filter(p => normalizePlayerNameKey(p?.name) === normName);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const posGrp = normalizePosGroup(position);
    if (posGrp) {
      const byPos = matches.find(p => normalizePosGroup(p?.position) === posGrp);
      if (byPos) return byPos;
    }
    return matches[0];
  }
  return null;
}

function defaultPlayBadgeForBucket(bucket = 'active', status = 'Active') {
  const b = String(bucket || 'active').toLowerCase();
  if (b === 'ir') return { pct: 0, label: '0% • IR' };
  if (b === 'suspended') return { pct: 0, label: '0% • Suspended' };
  if (b === 'practice_squad') return { pct: 0, label: 'Practice Squad' };
  if (/\bout\b/i.test(String(status || ''))) return { pct: 1, label: '1% • Out' };
  if (/doubtful/i.test(String(status || ''))) return { pct: 15, label: '15% • Doubtful' };
  if (/questionable/i.test(String(status || ''))) return { pct: 65, label: '65% • Questionable' };
  return { pct: 99, label: '99% • Cleared' };
}

/**
 * Reconciles a remote team's `roster.json` players against its `health.json`
 * (`practiceReport` + `irAndReserveTracker`) so `playProbabilityPct`,
 * `playBadgeLabel`, practice participation (`wed`/`thu`/`fri`), and IR return
 * fields are always populated cleanly even on lean static snapshots.
 */
export function reconcileRemoteTeamRosterWithHealth(rosterPlayers = [], healthJson = null) {
  if (!Array.isArray(rosterPlayers)) return [];
  const prList = Array.isArray(healthJson?.practiceReport) ? healthJson.practiceReport : [];
  const irList = Array.isArray(healthJson?.irAndReserveTracker) ? healthJson.irAndReserveTracker : [];

  const prById = new Map();
  const prByName = new Map();
  for (const row of prList) {
    const rid = extractEspnPlayerIdFromRecord(row);
    if (rid) prById.set(rid, row);
    const nk = normalizePlayerNameKey(row?.name);
    if (nk && !prByName.has(nk)) prByName.set(nk, row);
  }

  const irById = new Map();
  const irByName = new Map();
  for (const row of irList) {
    const rid = extractEspnPlayerIdFromRecord(row);
    if (rid) irById.set(rid, row);
    const nk = normalizePlayerNameKey(row?.name);
    if (nk && !irByName.has(nk)) irByName.set(nk, row);
  }

  return rosterPlayers.map(raw => {
    if (!raw || typeof raw !== 'object') return raw;
    const pid = extractEspnPlayerIdFromRecord(raw);
    const nk = normalizePlayerNameKey(raw.name);
    const pr = (pid && prById.get(pid)) || (nk && prByName.get(nk)) || null;
    const ir = (pid && irById.get(pid)) || (nk && irByName.get(nk)) || null;
    const curHealth = raw.health && typeof raw.health === 'object' ? raw.health : {};

    const bucket = raw.rosterBucket || (ir ? 'ir' : 'active');
    const status = pr?.gameStatus || pr?.status || ir?.status || curHealth.status || (bucket === 'ir' ? 'Injured Reserve' : 'Active');
    const fallbackBadge = defaultPlayBadgeForBucket(bucket, status);

    const pct =
      curHealth.playProbabilityPct != null
        ? Number(curHealth.playProbabilityPct)
        : pr?.playProbabilityPct != null
          ? Number(pr.playProbabilityPct)
          : ir?.playProbabilityPct != null
            ? Number(ir.playProbabilityPct)
            : fallbackBadge.pct;

    const badgeLabel =
      curHealth.playBadgeLabel ||
      pr?.playBadgeLabel ||
      ir?.playBadgeLabel ||
      fallbackBadge.label;

    return {
      ...raw,
      rosterBucket: bucket,
      health: {
        ...curHealth,
        status,
        injuryType: pr?.injuryType || ir?.injuryType || curHealth.injuryType || 'Healthy',
        wed: pr?.wed ?? ir?.wed ?? curHealth.wed ?? '-',
        thu: pr?.thu ?? ir?.thu ?? curHealth.thu ?? '-',
        fri: pr?.fri ?? ir?.fri ?? curHealth.fri ?? '-',
        playProbabilityPct: Number.isFinite(pct) ? pct : fallbackBadge.pct,
        playBadgeLabel: badgeLabel,
        factors:
          Array.isArray(pr?.factors) && pr.factors.length
            ? pr.factors
            : Array.isArray(curHealth.factors) && curHealth.factors.length
              ? curHealth.factors
              : ['Cleared without restrictive game-day designation'],
        archetypeNote: pr?.archetypeNote || curHealth.archetypeNote || '',
        irBeatNote: ir?.beatNote || ir?.irBeatNote || curHealth.irBeatNote || '',
        isSeasonEnding: Boolean(ir?.isSeasonEnding ?? curHealth.isSeasonEnding),
        isPracticeWindowOpen: Boolean(ir?.isPracticeWindowOpen ?? curHealth.isPracticeWindowOpen),
        earliestEligibleWeek: ir?.earliestEligibleWeek ?? curHealth.earliestEligibleWeek ?? null,
        projectedReturnWeek: ir?.projectedReturnWeek ?? curHealth.projectedReturnWeek ?? null
      }
    };
  });
}

function buildShortPlayerName(fullName = '') {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return fullName;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

function inferUnitFromPosition(pos = '') {
  const p = String(pos || '').trim().toUpperCase();
  if (['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'G', 'T', 'C', 'OL'].includes(p)) return 'Offense';
  if (['K', 'P', 'LS', 'PK'].includes(p)) return 'Special Teams';
  if (p) return 'Defense';
  return 'Offense';
}

/**
 * Builds an instant, well-formed fallback Player Dossier from the local
 * 49ers matchup snapshot (`opponentHealth` + `gameDayRoster`) so clicking an
 * opposing player opens the native modal in 0ms while remote `<team>.joshal.com`
 * data loads—and remains useful even if offline or the remote site is syncing.
 */
export function buildOpponentSeedPlayer({
  teamMeta,
  playerId = '',
  playerName = '',
  matchupData = null,
  extraSeed = null
} = {}) {
  const team = resolveNflTeamMeta(teamMeta);
  const oh = matchupData?.opponentHealth || {};
  const gdr = oh.gameDayRoster || {};
  const pools = [
    ...(Array.isArray(oh.injuryReport) ? oh.injuryReport.map(r => ({ src: 'injury', rec: r })) : []),
    ...(Array.isArray(oh.irReserve) ? oh.irReserve.map(r => ({ src: 'ir', rec: r })) : []),
    ...(Array.isArray(oh.keyStartersHealthy) ? oh.keyStartersHealthy.map(r => ({ src: 'starter', rec: r })) : []),
    ...(Array.isArray(oh.activeRoster) ? oh.activeRoster.map(r => ({ src: 'active', rec: r })) : []),
    ...(Array.isArray(gdr.inactives) ? gdr.inactives.map(r => ({ src: 'gd_inactive', rec: r })) : []),
    ...(Array.isArray(gdr.actives) ? gdr.actives.map(r => ({ src: 'gd_active', rec: r })) : [])
  ];

  const cleanId = String(playerId || extractEspnPlayerIdFromRecord(extraSeed) || '').trim();
  const normName = normalizePlayerNameKey(playerName || extraSeed?.name || '');

  const matched = {};
  for (const { src, rec } of pools) {
    if (!rec || typeof rec !== 'object') continue;
    const rid = extractEspnPlayerIdFromRecord(rec);
    const rName = normalizePlayerNameKey(rec.name);
    const idHit = Boolean(cleanId && /^\d{4,10}$/.test(cleanId) && rid && rid === cleanId);
    const nameHit = Boolean(normName && rName && rName === normName);
    if (idHit || nameHit) {
      if (!matched[src]) matched[src] = rec;
    }
  }

  const inj = matched.injury || null;
  const ir = matched.ir || null;
  const starter = matched.starter || null;
  const active = matched.active || null;
  const gdInact = matched.gd_inactive || null;
  const gdAct = matched.gd_active || null;
  const primary = inj || ir || starter || gdInact || gdAct || active || extraSeed || {};

  const resolvedName = String(
    primary.name || active?.name || playerName || extraSeed?.name || 'NFL Player'
  ).trim();
  const resolvedId =
    cleanId ||
    extractEspnPlayerIdFromRecord(active) ||
    extractEspnPlayerIdFromRecord(inj) ||
    extractEspnPlayerIdFromRecord(starter) ||
    extractEspnPlayerIdFromRecord(ir) ||
    extractEspnPlayerIdFromRecord(gdInact) ||
    extractEspnPlayerIdFromRecord(gdAct) ||
    `opp_${team?.abbr || 'nfl'}_${normalizePlayerNameKey(resolvedName).replace(/\s+/g, '_')}`;

  const position = String(
    primary.position || active?.position || extraSeed?.position || 'NFL'
  ).trim();
  const unit = primary.unit || active?.unit || inferUnitFromPosition(position);
  const jersey =
    primary.jersey ?? active?.jersey ?? starter?.jersey ?? ir?.jersey ?? extraSeed?.jersey ?? null;
  const rosterBucket = ir && !inj ? 'ir' : active?.rosterBucket || 'active';

  const espnUrl =
    primary.espnUrl ||
    active?.espnUrl ||
    starter?.espnUrl ||
    ir?.espnUrl ||
    extraSeed?.espnUrl ||
    (/^\d{4,10}$/.test(resolvedId) ? `https://www.espn.com/nfl/player/_/id/${resolvedId}` : '');
  const headshotUrl =
    primary.headshotUrl ||
    active?.headshotUrl ||
    starter?.headshotUrl ||
    ir?.headshotUrl ||
    extraSeed?.headshotUrl ||
    (/^\d{4,10}$/.test(resolvedId)
      ? `https://a.espncdn.com/i/headshots/nfl/players/full/${resolvedId}.png`
      : '');
  const pfrUrl = `https://www.pro-football-reference.com/search/search.fcgi?search=${encodeURIComponent(resolvedName)}`;
  const otcUrl = team ? team.otcCapUrl : '';

  const fallbackBadge = defaultPlayBadgeForBucket(rosterBucket, primary.gameStatus || primary.status);
  let playProbabilityPct =
    inj?.playProbabilityPct ??
    ir?.playProbabilityPct ??
    starter?.playProbabilityPct ??
    extraSeed?.playProbabilityPct ??
    fallbackBadge.pct;
  let playBadgeLabel =
    inj?.playBadgeLabel ||
    ir?.playBadgeLabel ||
    starter?.playBadgeLabel ||
    extraSeed?.playBadgeLabel ||
    fallbackBadge.label;
  let healthStatus =
    inj?.gameStatus ||
    ir?.status ||
    starter?.gameStatus ||
    extraSeed?.gameStatus ||
    (rosterBucket === 'ir' ? 'Injured Reserve' : 'Active');

  if (gdInact) {
    playProbabilityPct = 0;
    playBadgeLabel = '0% • Out (Inactive)';
    healthStatus = 'Inactive';
  } else if (gdAct && !inj?.isInGameInjury) {
    playProbabilityPct = 100;
    playBadgeLabel = '100% • In (Active)';
    healthStatus = 'Active (Game-Day)';
  }

  const snapPct = Number(
    inj?.snapPct ?? starter?.snapPct ?? active?.snapPct ?? ir?.snapPct ?? extraSeed?.snapPct ?? 0
  );
  const statLine2026 = String(
    inj?.statLine2026 || starter?.statLine2026 || active?.statLine2026 || ir?.statLine2026 || ''
  ).trim();
  const depthSlot = String(
    inj?.depthSlot || starter?.depthSlot || active?.depthSlot || ir?.depthSlot || ''
  ).trim();

  const factors = Array.isArray(inj?.factors) && inj.factors.length
    ? inj.factors
    : gdInact
      ? [`Declared game-day inactive (${gdInact.injuryType || gdInact.reason || 'Coach decision'})`]
      : gdAct
        ? ['Confirmed on official game-day active roster']
        : rosterBucket === 'ir'
          ? [ir?.byeWeekNote || 'Currently on Injured Reserve']
          : ['Cleared without restrictive game-day designation'];

  const recentNews = [];
  if (inj?.inGameLatestItem && typeof inj.inGameLatestItem === 'object') {
    recentNews.push(inj.inGameLatestItem);
  }

  return {
    id: String(resolvedId),
    name: resolvedName,
    shortName: buildShortPlayerName(resolvedName),
    position,
    unit,
    rosterBucket,
    jersey,
    age: null,
    displayHeight: '—',
    displayWeight: '—',
    college: team ? team.fullName : 'NFL',
    draftInfo: depthSlot ? `${team?.abbr || 'NFL'} ${depthSlot}` : `${team?.nickname || 'NFL'} Roster`,
    headshotUrl,
    espnUrl,
    otcUrl,
    pfrUrl,
    capHit2026: 0,
    contractsByYear: {},
    snapSummary: {
      offenseSnaps: 0,
      offenseSnapPct: unit === 'Offense' ? snapPct : 0,
      defenseSnaps: 0,
      defenseSnapPct: unit === 'Defense' ? snapPct : 0,
      stSnaps: 0,
      stSnapPct: unit === 'Special Teams' ? snapPct : 0
    },
    primarySnapPct: Number.isFinite(snapPct) ? snapPct : 0,
    statLine2026,
    depthSlot,
    careerSeasons: [],
    statProfile2026: null,
    spiderProfile: null,
    publicEfficiencyNote: statLine2026 ? `2026 Production: ${statLine2026}` : '',
    health: {
      status: healthStatus,
      injuryType: inj?.injuryType || ir?.injuryType || gdInact?.injuryType || 'Healthy',
      wed: inj?.wed ?? ir?.wed ?? '-',
      thu: inj?.thu ?? ir?.thu ?? '-',
      fri: inj?.fri ?? ir?.fri ?? '-',
      playProbabilityPct: Number.isFinite(Number(playProbabilityPct)) ? Number(playProbabilityPct) : fallbackBadge.pct,
      playBadgeLabel,
      factors,
      archetypeNote:
        inj?.archetypeNote || starter?.archetypeNote || 'Standard NFL positional availability prior.',
      shortComment: inj?.shortComment || starter?.shortComment || '',
      longComment: inj?.longComment || '',
      irBeatNote: ir?.beatNote || ir?.irBeatNote || '',
      isSeasonEnding: Boolean(ir?.isSeasonEnding),
      isPracticeWindowOpen: Boolean(ir?.isPracticeWindowOpen),
      earliestEligibleWeek: ir?.earliestEligibleWeek ?? null,
      projectedReturnWeek: ir?.projectedReturnWeek ?? null,
      isInGameInjury: Boolean(inj?.isInGameInjury),
      isInGameReturned: Boolean(inj?.isInGameReturned)
    },
    recentNews,
    _isMatchupSeedFallback: true
  };
}

export function extractTopTeamBeatHandles(reportersJson = null, maxHandles = 6) {
  const list = Array.isArray(reportersJson?.reporters) ? reportersJson.reporters : [];
  const handles = [];
  const seen = new Set();
  const sorted = [...list].sort((a, b) => Number(a?.tier || 3) - Number(b?.tier || 3));
  for (const r of sorted) {
    const raw = String(r?.xHandle || r?.twitterHandle || r?.handle || '')
      .replace(/^@/, '')
      .trim();
    if (!raw || !/^[A-Za-z0-9_]{2,25}$/.test(raw)) continue;
    const low = raw.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    handles.push(raw);
    if (handles.length >= maxHandles) break;
  }
  return handles;
}

function buildReportersMapFromJson(reportersJson = null) {
  const map = new Map();
  const list = Array.isArray(reportersJson?.reporters) ? reportersJson.reporters : [];
  for (const r of list) {
    if (r?.id) map.set(r.id, r);
  }
  return map;
}

function isPlayerMentionedInItem(item, playerName) {
  if (!item || !playerName) return false;
  const normTarget = normalizePlayerNameKey(playerName);
  if (!normTarget || normTarget.length < 5) return false;
  const hay = normalizePlayerNameKey(
    [item.title, item.headline, item.fullText, item.summary].filter(Boolean).join(' ')
  );
  return hay.includes(normTarget);
}

/**
 * Merges a remote `<team>.joshal.com` player object with local matchup live
 * overlay telemetry and builds the team-scoped `appData` / `rawStream` /
 * `teamContext` passed into `renderPlayerDossierSheetHtml`.
 */
export function mergeRemoteAndLocalOpponentPlayer({
  remotePlayer = null,
  remoteBundle = null,
  seedPlayer = null,
  teamMeta = null,
  activeTeamAbbr = null,
  localNewsRawStream = []
} = {}) {
  const team = resolveNflTeamMeta(teamMeta || remoteBundle?.team);
  const currentActiveAbbr = String(activeTeamAbbr || getActiveTeamConfig()?.abbr || 'SF').toUpperCase();
  const remoteAppData = remoteBundle?.appData || null;
  const remoteRawStream = Array.isArray(remoteAppData?.news?.rawStream)
    ? remoteAppData.news.rawStream
    : [];

  let mergedPlayer = null;
  if (remotePlayer) {
    const rh = remotePlayer.health || {};
    const sh = seedPlayer?.health || {};
    const localHasLiveGameDay =
      Boolean(sh.isInGameInjury || sh.isInGameReturned) ||
      /in \(active\)|out \(inactive\)/i.test(String(sh.playBadgeLabel || ''));
    const localHasPracticeSignal =
      (sh.wed && sh.wed !== '-') || (sh.thu && sh.thu !== '-') || (sh.fri && sh.fri !== '-');
    const remoteHasPracticeSignal =
      (rh.wed && rh.wed !== '-') || (rh.thu && rh.thu !== '-') || (rh.fri && rh.fri !== '-');

    const effectiveHealth = {
      ...rh,
      wed: remoteHasPracticeSignal ? rh.wed : sh.wed || rh.wed || '-',
      thu: remoteHasPracticeSignal ? rh.thu : sh.thu || rh.thu || '-',
      fri: remoteHasPracticeSignal ? rh.fri : sh.fri || rh.fri || '-',
      injuryType:
        localHasLiveGameDay || (rh.injuryType === 'Healthy' && sh.injuryType && sh.injuryType !== 'Healthy')
          ? sh.injuryType || rh.injuryType
          : rh.injuryType || sh.injuryType || 'Healthy',
      status: localHasLiveGameDay ? sh.status || rh.status : rh.status || sh.status || 'Active',
      playProbabilityPct:
        localHasLiveGameDay && sh.playProbabilityPct != null
          ? sh.playProbabilityPct
          : rh.playProbabilityPct != null
            ? rh.playProbabilityPct
            : sh.playProbabilityPct ?? 99,
      playBadgeLabel:
        localHasLiveGameDay && sh.playBadgeLabel
          ? sh.playBadgeLabel
          : rh.playBadgeLabel || sh.playBadgeLabel || '99% • Cleared',
      factors:
        localHasLiveGameDay && Array.isArray(sh.factors) && sh.factors.length
          ? sh.factors
          : Array.isArray(rh.factors) && rh.factors.length
            ? rh.factors
            : Array.isArray(sh.factors) && sh.factors.length
              ? sh.factors
              : ['Cleared without restrictive game-day designation'],
      archetypeNote: rh.archetypeNote || sh.archetypeNote || '',
      shortComment: rh.shortComment || sh.shortComment || '',
      longComment: rh.longComment || sh.longComment || '',
      irBeatNote: rh.irBeatNote || sh.irBeatNote || ''
    };

    const primarySnapPct =
      Number(remotePlayer.primarySnapPct || 0) > 0
        ? Number(remotePlayer.primarySnapPct)
        : Number(seedPlayer?.primarySnapPct || 0);
    const statLine2026 = String(remotePlayer.statLine2026 || seedPlayer?.statLine2026 || '').trim();

    mergedPlayer = {
      ...remotePlayer,
      jersey: remotePlayer.jersey ?? seedPlayer?.jersey ?? null,
      headshotUrl: remotePlayer.headshotUrl || seedPlayer?.headshotUrl || '',
      espnUrl: remotePlayer.espnUrl || seedPlayer?.espnUrl || '',
      otcUrl: remotePlayer.otcUrl || (team ? team.otcCapUrl : ''),
      primarySnapPct,
      statLine2026,
      publicEfficiencyNote:
        remotePlayer.publicEfficiencyNote ||
        (statLine2026 && !remotePlayer.statProfile2026?.hasActiveStats
          ? `2026 Production: ${statLine2026}`
          : ''),
      health: effectiveHealth,
      recentNews: [
        ...(Array.isArray(remotePlayer.recentNews) ? remotePlayer.recentNews : []),
        ...(Array.isArray(seedPlayer?.recentNews) ? seedPlayer.recentNews : [])
      ],
      _isMatchupSeedFallback: false
    };
  } else {
    mergedPlayer = seedPlayer;
  }

  // Merge remote team news stream with any matchup-wire items mentioning this opposing player
  const seenKeys = new Set();
  const combinedStream = [];
  const pushUnique = item => {
    if (!item || typeof item !== 'object') return;
    const key = String(item.url || item.id || item.title || item.headline || '')
      .trim()
      .toLowerCase();
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);
    combinedStream.push(item);
  };
  for (const item of remoteRawStream) pushUnique(item);
  if (mergedPlayer?.name && Array.isArray(localNewsRawStream)) {
    for (const item of localNewsRawStream) {
      if (isPlayerMentionedInItem(item, mergedPlayer.name)) {
        pushUnique(item);
      }
    }
  }

  const teamBeatHandles = extractTopTeamBeatHandles(remoteBundle?.reportersJson, 6);
  const teamContext = team
    ? {
        isRemoteTeam: team.abbr !== currentActiveAbbr,
        abbr: team.abbr,
        slug: team.slug,
        domain: team.domain,
        origin: team.origin,
        city: team.city,
        nickname: team.nickname,
        fullName: team.fullName,
        brandName: remoteAppData?.meta?.brandName || team.brandName,
        clubDomain: team.clubDomain,
        injuryReportUrl: remoteAppData?.health?.sourceUrl || team.clubInjuryUrl,
        otcCapUrl: team.otcCapUrl,
        beatHandles: teamBeatHandles
      }
    : null;

  const effectiveAppData = remoteAppData
    ? {
        ...remoteAppData,
        news: {
          ...(remoteAppData.news || {}),
          rawStream: combinedStream
        }
      }
    : {
        meta: {
          teamAbbr: team?.abbr || 'NFL',
          teamSlug: team?.slug || '',
          brandName: team?.brandName || 'NFL',
          seasonYear: 2026,
          currentWeek: 1
        },
        roster: {
          players: mergedPlayer ? [mergedPlayer] : []
        },
        health: {
          week: 1,
          byeWeek: 8,
          sourceUrl: team?.clubInjuryUrl || 'https://www.espn.com/nfl/injuries',
          practiceReport: []
        },
        news: {
          rawStream: combinedStream
        }
      };

  return {
    player: mergedPlayer,
    appData: effectiveAppData,
    rawStream: combinedStream,
    reportersById: remoteBundle?.reportersById || new Map(),
    teamContext
  };
}

// ============================================================================
// In-Memory Remote Team Bundle Cache & Parallel Cross-Origin Fetcher
// ============================================================================

const teamBundleCache = new Map();
const teamBundleInFlight = new Map();

export function clearRemoteTeamCache() {
  teamBundleCache.clear();
  teamBundleInFlight.clear();
}

export function getCachedRemoteTeamBundle(teamInput, nowMs = Date.now()) {
  const team = resolveNflTeamMeta(teamInput);
  if (!team) return null;
  const cached = teamBundleCache.get(team.abbr);
  if (!cached) return null;
  const ttl = cached.ok ? REMOTE_TEAM_CACHE_TTL_MS : REMOTE_TEAM_FAIL_COOLDOWN_MS;
  if (nowMs - cached.cachedAtMs > ttl) return null;
  return cached;
}

async function fetchJsonStrict(url, { fetchImpl, timeoutMs }) {
  const fn = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fn) throw new Error('fetch unavailable');
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fn(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      ...(ctrl ? { signal: ctrl.signal } : {})
    });
    if (!res || !res.ok) {
      throw new Error(`HTTP ${res?.status || 0}`);
    }
    const ctype = String(res.headers?.get?.('content-type') || '').toLowerCase();
    // Guard against SPA HTML 200 fallbacks (e.g. Cloudflare Pages serving index.html for missing paths)
    if (ctype && ctype.includes('text/html')) {
      throw new Error('Unexpected HTML response');
    }
    const text = await res.text();
    const trimmed = String(text || '').trim();
    if (!trimmed || trimmed.startsWith('<')) {
      throw new Error('Non-JSON payload');
    }
    return JSON.parse(trimmed);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function tryLoadBundleFromBaseUrl(baseUrl, { fetchImpl, timeoutMs }) {
  const [rosterRes, healthRes, newsRes, metaRes, reportersRes] = await Promise.allSettled([
    fetchJsonStrict(`${baseUrl}/roster.json`, { fetchImpl, timeoutMs }),
    fetchJsonStrict(`${baseUrl}/health.json`, { fetchImpl, timeoutMs }),
    fetchJsonStrict(`${baseUrl}/news.json`, { fetchImpl, timeoutMs }),
    fetchJsonStrict(`${baseUrl}/meta.json`, { fetchImpl, timeoutMs }),
    fetchJsonStrict(`${baseUrl}/reporters.json`, { fetchImpl, timeoutMs })
  ]);

  if (
    rosterRes.status !== 'fulfilled' ||
    !rosterRes.value ||
    !Array.isArray(rosterRes.value.players) ||
    rosterRes.value.players.length === 0
  ) {
    const reason =
      rosterRes.status === 'rejected'
        ? rosterRes.reason?.message || 'roster fetch failed'
        : 'invalid roster payload';
    return { ok: false, error: reason };
  }

  const healthJson = healthRes.status === 'fulfilled' && healthRes.value ? healthRes.value : null;
  const newsJson = newsRes.status === 'fulfilled' && newsRes.value ? newsRes.value : { rawStream: [] };
  const metaJson = metaRes.status === 'fulfilled' && metaRes.value ? metaRes.value : {};
  const reportersJson = reportersRes.status === 'fulfilled' && reportersRes.value ? reportersRes.value : null;

  const reconciledPlayers = reconcileRemoteTeamRosterWithHealth(rosterRes.value.players, healthJson);

  return {
    ok: true,
    dataBaseUrl: baseUrl,
    reportersJson,
    reportersById: buildReportersMapFromJson(reportersJson),
    appData: {
      meta: metaJson,
      roster: {
        ...rosterRes.value,
        players: reconciledPlayers
      },
      health: healthJson || { practiceReport: [], irAndReserveTracker: [] },
      news: newsJson,
      reporters: reportersJson || { reporters: [] }
    }
  };
}

/**
 * Fetches & caches a remote franchise's JSON data bundle from `<team>.joshal.com`.
 * Never throws; always returns a structured result with `{ ok, status, team, appData, ... }`.
 */
const teamBundleSeqByAbbr = new Map();

export async function fetchRemoteTeamBundle(
  teamInput,
  {
    forceRefresh = false,
    timeoutMs = DEFAULT_REMOTE_FETCH_TIMEOUT_MS,
    fetchImpl = null,
    baseUrlOverride = null
  } = {}
) {
  const team = resolveNflTeamMeta(teamInput);
  if (!team) {
    return { ok: false, status: 'invalid_team', team: null, error: 'Unknown NFL team' };
  }

  const nowMs = Date.now();
  if (!forceRefresh) {
    const cached = getCachedRemoteTeamBundle(team, nowMs);
    if (cached) return cached;
  }

  if (!forceRefresh && teamBundleInFlight.has(team.abbr)) {
    return teamBundleInFlight.get(team.abbr);
  }

  const reqSeq = (teamBundleSeqByAbbr.get(team.abbr) || 0) + 1;
  teamBundleSeqByAbbr.set(team.abbr, reqSeq);

  const promise = (async () => {
    const baseUrls = buildTeamDataBaseUrls(team, { baseUrlOverride });
    let lastError = 'Unavailable';

    for (const baseUrl of baseUrls) {
      const attempt = await tryLoadBundleFromBaseUrl(baseUrl, { fetchImpl, timeoutMs });
      if (attempt.ok) {
        const result = {
          ok: true,
          status: 'ready',
          team,
          origin: team.origin,
          dataBaseUrl: attempt.dataBaseUrl,
          fetchedAt: new Date().toISOString(),
          cachedAtMs: Date.now(),
          appData: attempt.appData,
          reportersJson: attempt.reportersJson,
          reportersById: attempt.reportersById,
          error: null
        };
        if (teamBundleSeqByAbbr.get(team.abbr) === reqSeq) {
          teamBundleCache.set(team.abbr, result);
        }
        return result;
      }
      lastError = attempt.error || lastError;
    }

    const failResult = {
      ok: false,
      status: 'unavailable',
      team,
      origin: team.origin,
      dataBaseUrl: baseUrls[0] || '',
      fetchedAt: new Date().toISOString(),
      cachedAtMs: Date.now(),
      appData: null,
      reportersJson: null,
      reportersById: new Map(),
      error: lastError
    };
    const existing = teamBundleCache.get(team.abbr);
    if (teamBundleSeqByAbbr.get(team.abbr) === reqSeq && !existing?.ok) {
      teamBundleCache.set(team.abbr, failResult);
    }
    return failResult;
  })();

  teamBundleInFlight.set(team.abbr, promise);
  try {
    return await promise;
  } finally {
    if (teamBundleInFlight.get(team.abbr) === promise) {
      teamBundleInFlight.delete(team.abbr);
    }
  }
}
