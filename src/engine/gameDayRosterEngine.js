/**
 * Game-Day Inactives (T-90m -> Final), Active Roster Unit Grouping,
 * Game-Time Questionable -> In/Out Resolver & Post-Game Next-Week Rollover Engine
 */

import {
  collapseInitialDots,
  computePlayerPlayProbability,
  getPracticeReportLeadDays,
  scopeBeatTextToPlayer
} from './injuryProbabilityModel.js';
import { getActiveTeamConfig, resolveTeamConfig } from '../config/teamRegistry.js';

export { getPracticeReportLeadDays };

export const GAME_DAY_INACTIVES_LEAD_MS = 90 * 60_000; // 90 minutes before kickoff
const MAX_LIVE_GAME_DURATION_MS = 5.25 * 3600_000;
const MAX_EXTENDED_LIVE_GAME_DURATION_MS = 10 * 3600_000; // Covers multi-hour weather delays + OT when ESPN confirms live/delayed

const LIVE_STATUS_DETAIL_RE =
  /\b(?:1st|2nd|3rd|4th|q[1-4]|halftime|\bot\b|overtime|end of (?:1st|2nd|3rd|4th)|in progress)\b/i;
const DELAYED_STATUS_DETAIL_RE = /\b(?:delayed|weather\s+delay|lightning\s+delay|suspended)\b/i;
const POSTPONED_STATUS_DETAIL_RE = /\b(?:postponed|canceled|cancelled)\b/i;
const FINAL_STATUS_DETAIL_RE = /\bfinal\b/i;
const OVERTIME_STATUS_DETAIL_RE = /\b(?:ot|overtime)\b/i;

const OFFENSE_POS_ORDER = {
  QB: 1,
  RB: 2,
  FB: 3,
  WR: 4,
  TE: 5,
  LT: 6,
  LG: 7,
  C: 8,
  RG: 9,
  RT: 10,
  OT: 11,
  T: 11,
  OG: 12,
  G: 12,
  OL: 13
};

const DEFENSE_POS_ORDER = {
  DE: 1,
  EDGE: 1,
  DT: 2,
  NT: 3,
  DL: 4,
  LB: 5,
  MLB: 5,
  ILB: 5,
  OLB: 6,
  CB: 7,
  NB: 8,
  DB: 9,
  FS: 10,
  SS: 10,
  S: 10
};

const ST_POS_ORDER = {
  K: 1,
  PK: 1,
  P: 2,
  LS: 3
};

export function normalizeLookupName(name = '') {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function classifyRosterUnit(position = '', rawUnit = '') {
  const pos = String(position || '').trim().toUpperCase();
  const u = String(rawUnit || '').trim().toLowerCase();
  if (pos in ST_POS_ORDER || u.includes('special')) return 'Special Teams';
  if (pos in DEFENSE_POS_ORDER || u.includes('def')) return 'Defense';
  if (pos in OFFENSE_POS_ORDER || u.includes('off')) return 'Offense';
  return 'Offense';
}

function positionOrderRank(unit, position) {
  const pos = String(position || '').trim().toUpperCase();
  if (unit === 'Offense') return OFFENSE_POS_ORDER[pos] ?? 50;
  if (unit === 'Defense') return DEFENSE_POS_ORDER[pos] ?? 50;
  return ST_POS_ORDER[pos] ?? 50;
}

/**
 * Evaluates whether a 49ers game is currently in the `[kickoff - 90m, Final)` game-day roster window.
 * Immediately returns `isActive: false` once `game.completed === true`.
 */
export function evaluateGameDayWindow(scheduleOrGame = [], upcomingMatchupOrNow = null, maybeNowMs = Date.now()) {
  let schedule = [];
  let upcomingMatchup = upcomingMatchupOrNow;
  let nowMs = maybeNowMs;

  if (Array.isArray(scheduleOrGame)) {
    schedule = scheduleOrGame;
    if (typeof upcomingMatchupOrNow === 'number') {
      nowMs = upcomingMatchupOrNow;
      upcomingMatchup = null;
    }
  } else if (scheduleOrGame && typeof scheduleOrGame === 'object') {
    schedule = [scheduleOrGame];
    if (typeof upcomingMatchupOrNow === 'number') {
      nowMs = upcomingMatchupOrNow;
      upcomingMatchup = scheduleOrGame;
    }
  }

  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  const umWeek = Number(upcomingMatchup?.week || 0) || null;
  const umGameId = upcomingMatchup?.gameId || upcomingMatchup?.id ? String(upcomingMatchup.gameId || upcomingMatchup.id) : null;
  const umDateIso = upcomingMatchup?.dateIso || upcomingMatchup?.kickoffIso || '';
  const umStatusDetail = String(upcomingMatchup?.statusDetail || '').trim();
  const umLiveState = String(upcomingMatchup?.liveState || '').toLowerCase();

  const candidates = schedule.map(rawG => {
    if (!rawG || typeof rawG !== 'object') return rawG;
    const gWeek = Number(rawG.week || 0) || null;
    const gId = rawG.id || rawG.gameId ? String(rawG.id || rawG.gameId) : null;
    const matchesUm =
      Boolean(upcomingMatchup) &&
      ((umGameId && gId && umGameId === gId) || (umWeek && gWeek && umWeek === gWeek));
    if (!matchesUm) return rawG;

    const gStatusState = String(rawG.statusState || '').toLowerCase();
    const gStatusDetail = String(rawG.statusDetail || '').trim();
    const mergedCompleted = Boolean(
      rawG.completed ||
        gStatusState === 'post' ||
        FINAL_STATUS_DETAIL_RE.test(gStatusDetail) ||
        upcomingMatchup.completed ||
        umLiveState === 'post' ||
        FINAL_STATUS_DETAIL_RE.test(umStatusDetail)
    );
    const mergedStatusState = mergedCompleted
      ? 'post'
      : gStatusState === 'in' || rawG.isLive || umLiveState === 'in' || upcomingMatchup.isGameInProgress
        ? 'in'
        : gStatusState || umLiveState || '';
    const mergedStatusDetail =
      (LIVE_STATUS_DETAIL_RE.test(umStatusDetail) ||
        DELAYED_STATUS_DETAIL_RE.test(umStatusDetail) ||
        POSTPONED_STATUS_DETAIL_RE.test(umStatusDetail) ||
        FINAL_STATUS_DETAIL_RE.test(umStatusDetail)) &&
      !(
        LIVE_STATUS_DETAIL_RE.test(gStatusDetail) ||
        DELAYED_STATUS_DETAIL_RE.test(gStatusDetail) ||
        POSTPONED_STATUS_DETAIL_RE.test(gStatusDetail) ||
        FINAL_STATUS_DETAIL_RE.test(gStatusDetail)
      )
        ? umStatusDetail
        : gStatusDetail || umStatusDetail;

    return {
      ...rawG,
      dateIso: rawG.dateIso || rawG.kickoffIso || umDateIso,
      completed: mergedCompleted,
      statusState: mergedStatusState,
      isLive: Boolean(rawG.isLive || upcomingMatchup.isGameInProgress || mergedStatusState === 'in'),
      statusDetail: mergedStatusDetail
    };
  });

  if (umDateIso && !candidates.some(g => (umGameId && String(g?.id || g?.gameId || '') === umGameId) || (umWeek && Number(g?.week) === umWeek))) {
    candidates.push({
      id: umGameId || `wk_${upcomingMatchup.week}`,
      week: upcomingMatchup.week,
      dateIso: umDateIso,
      completed: Boolean(
        upcomingMatchup.completed || umLiveState === 'post' || FINAL_STATUS_DETAIL_RE.test(umStatusDetail)
      ),
      statusState: umLiveState || (upcomingMatchup.isGameInProgress ? 'in' : ''),
      isLive: Boolean(upcomingMatchup.isGameInProgress || umLiveState === 'in'),
      statusDetail: umStatusDetail,
      opponent: {
        abbr: upcomingMatchup.oppAbbr || upcomingMatchup.opponent?.abbr,
        name: upcomingMatchup.oppName || upcomingMatchup.opponent?.name
      }
    });
  }

  for (const g of candidates) {
    if (!g || g.isByeWeek || g.opponent?.isTbd) continue;
    const statusState = String(g.statusState || '').toLowerCase();
    const statusDetail = String(g.statusDetail || '').trim();
    const isCompleted = Boolean(g.completed || statusState === 'post' || FINAL_STATUS_DETAIL_RE.test(statusDetail));
    if (isCompleted) continue;
    if (POSTPONED_STATUS_DETAIL_RE.test(statusDetail)) continue;

    const kickoffMs = Date.parse(g.dateIso || g.kickoffIso || '');
    if (!Number.isFinite(kickoffMs)) continue;

    const isDelayed = DELAYED_STATUS_DETAIL_RE.test(statusDetail);
    const isExplicitLive = Boolean(
      statusState === 'in' || g.isLive || LIVE_STATUS_DETAIL_RE.test(statusDetail)
    );
    const isOvertime = OVERTIME_STATUS_DETAIL_RE.test(statusDetail);

    const windowStartMs = kickoffMs - GAME_DAY_INACTIVES_LEAD_MS;
    const safetyEndMs =
      kickoffMs + (isExplicitLive || isDelayed ? MAX_EXTENDED_LIVE_GAME_DURATION_MS : MAX_LIVE_GAME_DURATION_MS);

    if ((ts >= windowStartMs && ts <= safetyEndMs) || (isExplicitLive && ts <= kickoffMs + MAX_EXTENDED_LIVE_GAME_DURATION_MS)) {
      const minutesUntilKickoff = Math.round((kickoffMs - ts) / 60_000);
      // If ESPN explicitly reports live play, kickoff has started (even if clock is 1-2m early).
      // If ESPN explicitly reports a pre-kickoff weather delay (not live yet), hold in pregame phase!
      const hasKickoffStarted = isExplicitLive ? true : isDelayed ? false : ts >= kickoffMs;
      return {
        isActive: true,
        phase: hasKickoffStarted ? 'in_game' : 'pregame',
        gameId: (g.id || g.gameId) ? String(g.id || g.gameId) : null,
        week: Number(g.week || upcomingMatchup?.week || 0) || null,
        kickoffIso: g.dateIso || g.kickoffIso,
        kickoffMs,
        safetyEndMs,
        minutesUntilKickoff,
        minutesToKickoff: minutesUntilKickoff,
        hasKickoffStarted,
        isExplicitLive,
        isDelayed,
        isOvertime,
        statusDetail,
        oppAbbr: g.opponent?.abbr || g.oppAbbr || upcomingMatchup?.oppAbbr || null,
        oppName: g.opponent?.name || g.oppName || upcomingMatchup?.oppName || null
      };
    }
  }

  return {
    isActive: false,
    phase: 'inactive',
    gameId: null,
    week: null,
    kickoffIso: null,
    kickoffMs: null,
    safetyEndMs: null,
    minutesUntilKickoff: null,
    minutesToKickoff: null,
    hasKickoffStarted: false,
    isExplicitLive: false,
    isDelayed: false,
    isOvertime: false,
    statusDetail: '',
    oppAbbr: null,
    oppName: null
  };
}

const PT_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function extractPacificParts(epochMs) {
  const parts = PT_PARTS_FORMATTER.formatToParts(new Date(epochMs));
  let year = 1970;
  let month = 1;
  let day = 1;
  let weekday = 'Sun';
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === 'year') year = Number(p.value);
    else if (p.type === 'month') month = Number(p.value);
    else if (p.type === 'day') day = Number(p.value);
    else if (p.type === 'weekday') weekday = p.value;
    else if (p.type === 'hour') hour = Number(p.value) % 24;
    else if (p.type === 'minute') minute = Number(p.value);
  }
  return {
    weekday,
    dayIndex: Math.floor(Date.UTC(year, month - 1, day) / 86_400_000),
    minutesOfDay: hour * 60 + minute
  };
}

const PLAYER_MATCH_REGEX_CACHE = new Map();

function getCachedPlayerRegex(cleanEscapedName) {
  let rx = PLAYER_MATCH_REGEX_CACHE.get(cleanEscapedName);
  if (!rx) {
    if (PLAYER_MATCH_REGEX_CACHE.size >= 512) {
      PLAYER_MATCH_REGEX_CACHE.clear();
    }
    rx = new RegExp(`\\b${cleanEscapedName}\\b`, 'i');
    PLAYER_MATCH_REGEX_CACHE.set(cleanEscapedName, rx);
  }
  return rx;
}

/**
 * Determines whether the upcoming game's weekly practice report window has started yet.
 * NFL teams release their first weekly practice report on Wednesday afternoon (~12:30-1:30 PM PT)
 * for Sunday games (Monday for Thursday/Wednesday games, Tuesday for Friday/Saturday games, Thursday for Monday games).
 * Before that window, W / T / F columns must remain blank (`'-'`).
 */
export function isBeforeWeeklyPracticeWindow(upcomingGameDateIso = '', nowMs = Date.now()) {
  const kickoffMs = Date.parse(upcomingGameDateIso || '');
  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (!Number.isFinite(kickoffMs)) return false;
  if (ts >= kickoffMs) return false;

  // DST-accurate Pacific calendar day & time-of-day check:
  // First weekly practice report drops ~12:15 PM PT on Practice Day 1 (`getPracticeReportLeadDays`).
  const koPt = extractPacificParts(kickoffMs);
  const nowPt = extractPacificParts(ts);
  const leadDays = getPracticeReportLeadDays(koPt.weekday);
  const firstReportOpenMinutesPt = 12 * 60 + 15; // 12:15 PM PT
  const daysUntilGamePt = koPt.dayIndex - nowPt.dayIndex;

  if (daysUntilGamePt > leadDays) return true;
  if (daysUntilGamePt === leadDays) return nowPt.minutesOfDay < firstReportOpenMinutesPt;
  return false;
}

/**
 * Verified 32-club official NFL CMS RSS endpoints (`200 OK` + `Access-Control-Allow-Origin: *`).
 */
export const NFL_TEAM_OFFICIAL_RSS_URLS = {
  ARI: 'https://www.azcardinals.com/rss/news',
  ATL: 'https://www.atlantafalcons.com/rss/news',
  BAL: 'https://www.baltimoreravens.com/rss/news',
  BUF: 'https://www.buffalobills.com/rss/news',
  CAR: 'https://www.panthers.com/rss/news',
  CHI: 'https://www.chicagobears.com/rss/news',
  CIN: 'https://www.bengals.com/rss/news',
  CLE: 'https://www.clevelandbrowns.com/rss/news',
  DAL: 'https://www.dallascowboys.com/rss/news',
  DEN: 'https://www.denverbroncos.com/rss/news',
  DET: 'https://www.detroitlions.com/rss/news',
  GB: 'https://www.packers.com/rss/news',
  HOU: 'https://www.houstontexans.com/rss/news',
  IND: 'https://www.colts.com/rss/news',
  JAX: 'https://www.jaguars.com/rss/news',
  JAC: 'https://www.jaguars.com/rss/news',
  KC: 'https://www.chiefs.com/rss/news',
  LAC: 'https://www.chargers.com/rss/news',
  LAR: 'https://www.therams.com/rss/news',
  LA: 'https://www.therams.com/rss/news',
  LV: 'https://www.raiders.com/rss/news',
  MIA: 'https://www.miamidolphins.com/rss/news',
  MIN: 'https://www.vikings.com/rss/news',
  NE: 'https://www.patriots.com/rss/news',
  NO: 'https://www.neworleanssaints.com/rss/news',
  NYG: 'https://www.giants.com/rss/news',
  NYJ: 'https://www.newyorkjets.com/rss/news',
  PHI: 'https://www.philadelphiaeagles.com/rss/news',
  PIT: 'https://www.steelers.com/rss/news',
  SEA: 'https://www.seahawks.com/rss/news',
  SF: 'https://www.49ers.com/rss/news',
  TB: 'https://www.buccaneers.com/rss/news',
  TEN: 'https://www.tennesseetitans.com/rss/news',
  WAS: 'https://www.commanders.com/rss/news',
  WSH: 'https://www.commanders.com/rss/news'
};

export const ESPN_NFL_TEAM_IDS = {
  ARI: 22, ATL: 1, BAL: 33, BUF: 2, CAR: 29, CHI: 3, CIN: 4, CLE: 5,
  DAL: 6, DEN: 7, DET: 8, GB: 9, HOU: 34, IND: 11, JAX: 30, JAC: 30,
  KC: 12, LAC: 24, LAR: 14, LA: 14, LV: 13, MIA: 15, MIN: 16, NE: 17,
  NO: 18, NYG: 19, NYJ: 20, PHI: 21, PIT: 23, SEA: 26, SF: 25, TB: 27,
  TEN: 10, WAS: 28, WSH: 28
};

export function normalizeCanonicalTeamAbbr(abbr = '') {
  const up = String(abbr || '').trim().toUpperCase();
  if (up === 'WSH') return 'WAS';
  if (up === 'LA') return 'LAR';
  if (up === 'JAC') return 'JAX';
  return up;
}

function decodeHtmlEntitiesBasic(str = '') {
  return String(str || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' ';
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&mdash;|&ndash;/gi, '-');
}

const AMBIGUOUS_COMMON_SURNAMES = new Set([
  'baker', 'ball', 'banks', 'bates', 'bell', 'best', 'black', 'brooks', 'brown', 'burns', 'bush',
  'chase', 'cook', 'cross', 'fields', 'ford', 'grant', 'gray', 'green', 'hall', 'hardy', 'hayes',
  'henry', 'hill', 'hooks', 'house', 'hunt', 'jones', 'kelly', 'king', 'lewis', 'long', 'love',
  'lowe', 'mason', 'miles', 'moore', 'moss', 'nash', 'neal', 'pace', 'page', 'parks', 'payne',
  'perry', 'pierce', 'price', 'quick', 'ray', 'reed', 'rice', 'rivers', 'ross', 'rush', 'scott',
  'sharp', 'short', 'sims', 'small', 'smart', 'smith', 'snow', 'sparks', 'speed', 'steel', 'stone',
  'strong', 'sweet', 'swift', 'taylor', 'thomas', 'walker', 'ward', 'watts', 'webb', 'wells',
  'west', 'white', 'wills', 'wilson', 'winters', 'wise', 'wolf', 'wood', 'woods', 'wright', 'young'
]);

const NON_FIRST_NAME_LEAD_WORDS = new Set([
  'qb', 'rb', 'fb', 'wr', 'te', 'ol', 'ot', 'og', 'dl', 'de', 'dt', 'nt', 'edge', 'lb', 'ilb', 'olb',
  'cb', 'db', 'fs', 'ss', 'pk', 'ls', 't', 'g', 'c', 's', 'k', 'p',
  'coach', '49ers', 'niners', 'sf', 'san', 'francisco', 'vikings', 'minnesota', 'min', 'cowboys', 'seahawks',
  'rams', 'cardinals', 'eagles', 'lions', 'packers', 'bears', 'chiefs', 'bills', 'ravens', 'bengals',
  'update', 'injury', 'status', 'report', 'breaking', 'news', 'source', 'sources', 'watch',
  'on', 'for', 'with', 'without', 'says', 'said', 'per', 'from', 'the', 'and', 'while', 'but',
  'still', 'now', 'after', 'before', 'both', 'also', 'expect', 'expected', 'ruled', 'active', 'inactive',
  'star', 'starter', 'veteran', 'rookie', 'pro', 'bowl', 'all-pro', 'safety', 'tackle', 'guard', 'center',
  'quarterback', 'receiver', 'linebacker', 'cornerback', 'defensive', 'offensive', 'running', 'tight'
]);

const NFL_TEAM_NICKNAME_MAP = {
  ARI: ['cardinals', 'arizona'],
  ATL: ['falcons', 'atlanta'],
  BAL: ['ravens', 'baltimore'],
  BUF: ['bills', 'buffalo'],
  CAR: ['panthers', 'carolina'],
  CHI: ['bears', 'chicago'],
  CIN: ['bengals', 'cincinnati'],
  CLE: ['browns', 'cleveland'],
  DAL: ['cowboys', 'dallas'],
  DEN: ['broncos', 'denver'],
  DET: ['lions', 'detroit'],
  GB: ['packers', 'green bay'],
  HOU: ['texans', 'houston'],
  IND: ['colts', 'indianapolis'],
  JAX: ['jaguars', 'jags', 'jacksonville'],
  KC: ['chiefs', 'kansas city'],
  LAC: ['chargers', 'la chargers', 'los angeles chargers'],
  LAR: ['rams', 'la rams', 'los angeles rams'],
  LV: ['raiders', 'las vegas'],
  MIA: ['dolphins', 'miami'],
  MIN: ['vikings', 'minnesota'],
  NE: ['patriots', 'pats', 'new england'],
  NO: ['saints', 'new orleans'],
  NYG: ['giants', 'ny giants', 'new york giants'],
  NYJ: ['jets', 'ny jets', 'new york jets'],
  PHI: ['eagles', 'philadelphia'],
  PIT: ['steelers', 'pittsburgh'],
  SEA: ['seahawks', 'seattle'],
  SF: ['49ers', 'niners', 'san francisco'],
  TB: ['buccaneers', 'bucs', 'tampa bay'],
  TEN: ['titans', 'tennessee'],
  WAS: ['commanders', 'washington']
};

const FULL_POS_TO_ABBR = {
  quarterback: 'QB',
  'running back': 'RB',
  fullback: 'FB',
  'wide receiver': 'WR',
  'tight end': 'TE',
  'offensive lineman': 'OL',
  'offensive tackle': 'OT',
  tackle: 'OT',
  'offensive guard': 'OG',
  guard: 'OG',
  center: 'C',
  'defensive lineman': 'DL',
  'defensive end': 'DE',
  'defensive tackle': 'DT',
  'nose tackle': 'NT',
  'edge rusher': 'EDGE',
  edge: 'EDGE',
  linebacker: 'LB',
  'inside linebacker': 'ILB',
  'outside linebacker': 'OLB',
  cornerback: 'CB',
  'defensive back': 'DB',
  safety: 'S',
  'free safety': 'FS',
  'strong safety': 'SS',
  kicker: 'K',
  punter: 'P',
  'long snapper': 'LS'
};

function maskAbbreviationsForClauseSplit(text = '') {
  return String(text || '')
    .replace(/\b(vs|jr|sr|st|dr|mr|no)\./gi, '$1\u0001')
    .replace(/\b([A-Z])\.([A-Z])\./g, '$1\u0001$2\u0001');
}

function splitTextIntoGameDayClauses(text = '') {
  const masked = maskAbbreviationsForClauseSplit(text);
  return masked
    .split(/[.;!\n]+|\b(?:while|whereas|but|however|meanwhile)\b/i)
    .map(c => c.replace(/\u0001/g, '.').trim())
    .filter(Boolean);
}

function buildCandidateMatchers(candidatePlayers = []) {
  const seenKeys = new Set();
  const surnameCounts = new Map();
  const rawEntries = [];

  for (const p of candidatePlayers || []) {
    const name = String(p?.name || p?.fullName || p?.displayName || '').trim();
    const key = normalizeLookupName(name);
    if (!key || name.length < 4 || seenKeys.has(key)) continue;
    seenKeys.add(key);
    const stripped = name.replace(/\b(Jr\.?|Sr\.?|II|III|IV|V)\b\.?/gi, '').trim();
    const parts = stripped.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || '';
    const lastName = parts.length >= 2 ? parts[parts.length - 1] : '';
    const lastLower = lastName.toLowerCase();
    if (lastLower) {
      surnameCounts.set(lastLower, (surnameCounts.get(lastLower) || 0) + 1);
    }
    rawEntries.push({ p, name, key, stripped, firstName, lastName, lastLower });
  }

  const matchers = [];
  for (const { p, name, key, stripped, firstName, lastName, lastLower } of rawEntries) {
    const collapsed = collapseInitialDots(stripped);
    const dottedInitials = stripped.replace(/\b([A-Z])([A-Z])\b/g, '$1.$2.');
    const variants = [...new Set([name, stripped, collapsed, dottedInitials].filter(s => s && s.length >= 4))].map(
      s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    );
    if (variants.length > 0) {
      const canUseUniqueSurname =
        Boolean(lastName) &&
        lastName.length >= 5 &&
        (surnameCounts.get(lastLower) || 0) === 1 &&
        !AMBIGUOUS_COMMON_SURNAMES.has(lastLower);
      const surnameEsc = canUseUniqueSurname
        ? lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        : '';
      const nicknameRegex =
        key === 'christianmccaffrey'
          ? /\bCMC\b/
          : null;
      matchers.push({
        key,
        name,
        firstNameLower: firstName.toLowerCase(),
        position: p?.position || 'ATH',
        jersey: p?.jersey ?? null,
        regex: getCachedPlayerRegex(`(?:${variants.join('|')})`),
        surnameRegex: surnameEsc ? getCachedPlayerRegex(surnameEsc) : null,
        nicknameRegex
      });
    }
  }
  return matchers;
}

function doesClauseMentionPlayer(pm, clause = '', { allowUniqueSurname = false } = {}) {
  if (!pm || !clause) return false;
  if (pm.regex.test(clause)) return true;
  if (allowUniqueSurname && pm.nicknameRegex && pm.nicknameRegex.test(clause)) return true;
  if (!allowUniqueSurname || !pm.surnameRegex) return false;

  const m = pm.surnameRegex.exec(clause);
  if (!m) return false;
  // Guard against brother/homonym collisions (e.g. "Joey Bosa" must NOT match "Nick Bosa")
  const before = clause.slice(0, m.index).trimEnd();
  const prevWordMatch = before.match(/(?:^|[\s,(/:;'-])([A-Z][A-Za-z'.-]{1,16})$/);
  if (prevWordMatch) {
    const prevWord = prevWordMatch[1];
    const prevLower = prevWord.toLowerCase().replace(/\.$/, '');
    if (prevLower !== pm.firstNameLower && !NON_FIRST_NAME_LEAD_WORDS.has(prevLower)) {
      return false;
    }
  }
  return true;
}

function getTeamHeaderHints(teamAbbr = null, teamName = null) {
  const canon = normalizeCanonicalTeamAbbr(teamAbbr || '');
  const hints = [];
  if (canon && NFL_TEAM_NICKNAME_MAP[canon]) {
    hints.push(...NFL_TEAM_NICKNAME_MAP[canon]);
  }
  if (teamName) {
    const clean = String(teamName).trim().toLowerCase();
    if (clean) {
      hints.push(clean);
      const lastTok = clean.split(/\s+/).pop();
      if (lastTok && lastTok.length >= 4) hints.push(lastTok);
    }
  }
  return [...new Set(hints.filter(Boolean))];
}

function detectTeamAbbrInHeading(headingText = '') {
  const lower = String(headingText || '').toLowerCase();
  if (!lower) return null;
  for (const [abbr, aliases] of Object.entries(NFL_TEAM_NICKNAME_MAP)) {
    for (const alias of aliases) {
      if (new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) {
        return abbr;
      }
    }
  }
  return null;
}

/**
 * Finds the current game's official "Inactives" article from a club's `/rss/news` XML feed,
 * rejecting prior-week inactive articles by checking both `Week N` tags and publish window `[kickoff - 12h, kickoff + 6h]`.
 */
export function discoverOfficialClubInactivesRssItem(rssXml = '', { kickoffMs = 0, week = null } = {}) {
  if (!rssXml || typeof rssXml !== 'string') return null;
  const blocks = rssXml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const minPub = Number.isFinite(kickoffMs) && kickoffMs > 0 ? kickoffMs - 12 * 3_600_000 : 0;
  const maxPub = Number.isFinite(kickoffMs) && kickoffMs > 0 ? kickoffMs + 6 * 3_600_000 : Infinity;

  for (const block of blocks) {
    const title = decodeHtmlEntitiesBasic((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const link = decodeHtmlEntitiesBasic((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '')
      .replace(/<[^>]+>/g, '')
      .trim();
    const rawDescription = decodeHtmlEntitiesBasic((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '');
    const rawContentEncoded = decodeHtmlEntitiesBasic(
      (block.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i) || [])[1] || ''
    );
    const description = rawDescription
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const pubRaw = decodeHtmlEntitiesBasic((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '').trim();

    const combined = `${title} ${link} ${description}`;
    if (!/\binactives?\b/i.test(combined)) continue;
    if (!/^https?:\/\//i.test(link)) continue;

    // Guard against matching a prior week's inactives article
    if (Number.isFinite(Number(week)) && Number(week) > 0) {
      const wkMatches = [...`${title} ${link}`.matchAll(/\bweek[\s-]*(\d{1,2})\b/gi)].map(m => Number(m[1]));
      if (wkMatches.length > 0 && !wkMatches.includes(Number(week))) {
        continue;
      }
    }

    const pubMs = pubRaw ? Date.parse(pubRaw) : NaN;
    if (Number.isFinite(pubMs) && kickoffMs > 0 && (pubMs < minPub || pubMs > maxPub)) {
      continue;
    }

    return {
      title,
      url: link.startsWith('http://') ? `https://${link.slice(7)}` : link,
      description,
      inlineHtml: rawContentEncoded || rawDescription || '',
      publishedAt: Number.isFinite(pubMs) ? new Date(pubMs).toISOString() : new Date().toISOString(),
      pubMs: Number.isFinite(pubMs) ? pubMs : null
    };
  }
  return null;
}

/**
 * Deterministically parses an official NFL club's unstructured "Inactives" article HTML or text
 * (e.g. `49ers.com/news/...` or `vikings.com/news/...`) for ANY NFL team (49ers or Opponent):
 *  - Truncates cleanly before `"Related Content"` / `"More News"` footer links so prior-week headlines
 *    never contaminate the current week's roster!
 *  - Supports colon-less headings (`<h3>Vikings Inactives</h3>`), dual-team articles (scoping strictly to
 *    `teamAbbr`/`teamName` and stopping at the opposing team's header), `(3rd QB)` notation, and standalone
 *    structured `POS First Last` list items (catching newly elevated PS players & server-side Worker parsing).
 */
export function parseOfficialClubInactivesArticle(
  htmlOrText = '',
  candidatePlayers = [],
  { week = null, teamAbbr = null, teamName = null } = {}
) {
  if (!htmlOrText || typeof htmlOrText !== 'string') {
    return { inactives: [], activeKeys: new Set(), emergencyQbKeys: new Set(), officialPosted: false };
  }

  let cleaned = String(htmlOrText)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:nav|header|footer|aside)\b[\s\S]*?<\/(?:nav|header|footer|aside)>/gi, ' ')
    .replace(/<\/(?:p|li|div|h1|h2|h3|h4|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  cleaned = decodeHtmlEntitiesBasic(cleaned);

  // Strip navigation chrome before the article headline/date if full HTML page
  const copiedMarker = cleaned.indexOf('Copied!');
  if (copiedMarker > 0 && copiedMarker < cleaned.length - 80) {
    const preWindow = cleaned.slice(Math.max(0, copiedMarker - 260), copiedMarker);
    cleaned = `${preWindow}\n${cleaned.slice(copiedMarker + 7)}`;
  }

  // CRITICAL: Cut off before footer "Related Content" / "More News" cards referencing prior weeks!
  const footerCutRe = /\b(?:Related Content|Related Stories|Related Links|More News|Recommended For You|Up Next|Latest Videos)\b/i;
  const footerMatch = footerCutRe.exec(cleaned);
  if (footerMatch && footerMatch.index > 120) {
    cleaned = cleaned.slice(0, footerMatch.index);
  }

  if (Number.isFinite(Number(week)) && Number(week) > 0) {
    const leadHeader = cleaned.slice(0, 320);
    const headerWks = [...leadHeader.matchAll(/\bweek[\s-]*(\d{1,2})\b/gi)].map(m => Number(m[1]));
    if (headerWks.length > 0 && !headerWks.includes(Number(week))) {
      return { inactives: [], activeKeys: new Set(), emergencyQbKeys: new Set(), officialPosted: false };
    }
  }

  const matchers = buildCandidateMatchers(candidatePlayers);
  const inactiveMap = new Map();
  const activeKeys = new Set();
  const emergencyQbKeys = new Set();
  const targetCanon = teamAbbr ? normalizeCanonicalTeamAbbr(teamAbbr) : null;
  const targetHints = getTeamHeaderHints(targetCanon, teamName);

  // Locate explicit "Here are the ... inactive players" / "... Inactives:" OR colon-less "Vikings Inactives\n" headings
  const listHeaderGlobalRe =
    /(?:^|\n)[ \t]*(?:(?:here are|below are|check out|full list of)[^.\n]{0,95}?\binactives?(?:\s+players?|\s+list)?[^:\n]{0,65}:?|(?:today'?s|game[\s-]?day|week\s*\d+|official|[a-z0-9 .'-]{2,34})\s+inactives?(?:\s+players?|\s+list|\s+for\s+[^\n:]{2,45})?\s*:?|inactives?\s*:?|\bdeclared the following players?\s+inactive\b[^:\n]*:?|\bfollowing players?\s+(?:are|will be)\s+inactive\b[^:\n]*:?)[ \t]*(?=\n|:|$)/gim;

  const headerMatches = [];
  let hm;
  while ((hm = listHeaderGlobalRe.exec(cleaned)) !== null) {
    const rawHeader = hm[0].trim();
    // Skip headline-like long sentences (>95 chars) that don't end with ":" and aren't "Here are ... inactives"
    if (rawHeader.length > 95 && !rawHeader.endsWith(':') && !/\b(?:here are|below are|declared the following|following players)\b/i.test(rawHeader)) {
      continue;
    }
    // Skip top page title if followed immediately by date/prose rather than list, ONLY when another dedicated header exists later
    headerMatches.push({
      text: rawHeader,
      index: hm.index,
      endIndex: hm.index + hm[0].length,
      detectedTeam: detectTeamAbbrInHeading(rawHeader)
    });
  }

  // Pick the best matching list header (preferring target team's heading on dual-team articles!)
  let chosenHeader = null;
  if (headerMatches.length > 0) {
    if (targetCanon && targetHints.length > 0) {
      // Look for explicit team-matching heading where the heading itself isn't a generic title mentioning both teams ("49ers vs. Vikings Inactives")
      const strictTeamMatch = headerMatches.find(
        h =>
          h.detectedTeam === targetCanon &&
          !/\b(?:vs\.?|at|against)\b/i.test(h.text)
      );
      if (strictTeamMatch) {
        chosenHeader = strictTeamMatch;
      } else {
        // Fallback to any non-opposing header
        chosenHeader =
          headerMatches.find(h => !h.detectedTeam || h.detectedTeam === targetCanon) ||
          headerMatches[0];
      }
    } else {
      chosenHeader = headerMatches[0];
    }
  }

  // Fallback to inline mid-paragraph "Here are the ... inactives:" matcher if line-anchored didn't hit
  if (!chosenHeader) {
    const inlineListHeaderRe =
      /(?:here are|below are|check out|full list of)[^.\n]{0,95}?\binactives?(?:\s+players?|\s+list)?[^:\n]{0,65}?:|\b(?:today'?s|game[\s-]?day|week\s*\d+|official|[a-z0-9 .'-]{2,28})\s+inactives?(?:\s+list|\s+for\s+[^\n:]{2,45})?\s*:|\bdeclared the following players?\s+inactive\b[^:\n]*:?|\bfollowing players?\s+(?:are|will be)\s+inactive\b[^:\n]*:?/i;
    const inlineMatch = inlineListHeaderRe.exec(cleaned);
    if (inlineMatch) {
      chosenHeader = {
        text: inlineMatch[0],
        index: inlineMatch.index,
        endIndex: inlineMatch.index + inlineMatch[0].length,
        detectedTeam: detectTeamAbbrInHeading(inlineMatch[0])
      };
    }
  }

  // Determine end boundary of chosen list block (stop at any subsequent team's inactives heading!)
  let listBlockEnd = chosenHeader ? chosenHeader.endIndex + 1600 : 0;
  if (chosenHeader) {
    for (const h of headerMatches) {
      if (h.index > chosenHeader.endIndex) {
        if (targetCanon && h.detectedTeam && h.detectedTeam !== targetCanon) {
          listBlockEnd = Math.min(listBlockEnd, h.index);
          break;
        }
        if (!targetCanon && h.detectedTeam && chosenHeader.detectedTeam && h.detectedTeam !== chosenHeader.detectedTeam) {
          listBlockEnd = Math.min(listBlockEnd, h.index);
          break;
        }
      }
    }
  }

  const prosePart = chosenHeader ? cleaned.slice(0, chosenHeader.index) : cleaned;
  const listPart = chosenHeader ? cleaned.slice(chosenHeader.endIndex, listBlockEnd) : '';

  const POS_LINE_RE =
    /^(?:[-•*]\s*)?(?:#?\d{1,2}\s+)?(QB|RB|FB|WR|TE|OL|OT|OG|C|T|G|DL|DE|DT|NT|EDGE|LB|ILB|OLB|CB|DB|S|FS|SS|K|PK|P|LS|Quarterback|Running Back|Fullback|Wide Receiver|Tight End|Offensive Lineman|Offensive Tackle|Tackle|Offensive Guard|Guard|Center|Defensive Lineman|Defensive End|Defensive Tackle|Nose Tackle|Edge Rusher|Edge|Linebacker|Inside Linebacker|Outside Linebacker|Cornerback|Defensive Back|Safety|Free Safety|Strong Safety|Kicker|Punter|Long Snapper)\s+([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,2}(?:\s+(?:Jr\.?|Sr\.?|II|III|IV|V))?)\b(.*)$/;

  const NON_PLAYER_PROSE_WORDS_RE = /\b(?:will|was|were|have|has|had|are|been|being|against|versus|sunday|monday|thursday|saturday|quarterback|inactives?|active|game|week|season|roster|injury|report)\b/i;

  if (listPart) {
    // Stop list block if prose paragraphs resume after the bullet/position list or opposing team section starts
    const listLines = listPart.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const collectedListLines = [];
    for (const ln of listLines) {
      // Stop if another team's Inactives header appears inline
      if (
        collectedListLines.length >= 2 &&
        /\binactives?\b/i.test(ln) &&
        ln.length <= 65 &&
        detectTeamAbbrInHeading(ln) &&
        (!targetCanon || detectTeamAbbrInHeading(ln) !== targetCanon)
      ) {
        break;
      }
      if (
        collectedListLines.length >= 3 &&
        ln.length > 140 &&
        !/\b(QB|RB|FB|WR|TE|OL|OT|OG|C|T|G|DL|DE|DT|NT|EDGE|LB|ILB|OLB|CB|DB|S|FS|SS|K|PK|P|LS)\b/.test(ln)
      ) {
        break;
      }
      collectedListLines.push(ln);
    }
    const listBlockText = collectedListLines.join('\n') || listPart.slice(0, 750);

    for (const pm of matchers) {
      if (pm.regex.test(listBlockText)) {
        inactiveMap.set(pm.key, {
          name: pm.name,
          position: pm.position,
          jersey: pm.jersey,
          reason: ''
        });
        const emRe = new RegExp(
          `${pm.regex.source}[^\\n.;]{0,65}(?:\\bemergency\\s+(?:third|3rd)?\\s*(?:quarterback|qb)\\b|\\(\\s*(?:emergency\\s+)?(?:3rd|third)\\s+qb\\s*\\))`,
          'i'
        );
        if (emRe.test(listBlockText)) {
          emergencyQbKeys.add(pm.key);
        }
      }
    }

    // Also parse structured `POS First Last` lines directly (captures Saturday PS elevations & supports Worker calls without candidate list)
    for (const ln of collectedListLines) {
      if (ln.length > 110) continue;
      const m = ln.match(POS_LINE_RE);
      if (!m) continue;
      const rawPos = m[1].trim();
      const rawName = m[2].trim();
      const tail = m[3] || '';
      if (NON_PLAYER_PROSE_WORDS_RE.test(rawName)) continue;
      const key = normalizeLookupName(rawName);
      if (!key) continue;
      const normPos = FULL_POS_TO_ABBR[rawPos.toLowerCase()] || rawPos.toUpperCase();
      if (!inactiveMap.has(key)) {
        inactiveMap.set(key, {
          name: rawName,
          position: normPos,
          jersey: null,
          reason: ''
        });
      }
      if (/\bemergency\s+(?:third|3rd)?\s*(?:quarterback|qb)\b|\(\s*(?:emergency\s+)?(?:3rd|third)\s+qb\s*\)/i.test(tail)) {
        emergencyQbKeys.add(key);
      }
    }
  }

  // Also scan prose clauses for explicit active confirmations & individual ruled-out notes (excluding IR remainders)
  const clauses = splitTextIntoGameDayClauses(prosePart);

  for (const idxStr of Object.keys(clauses)) {
    const idxNum = Number(idxStr);
    const clause = clauses[idxNum];
    const nextClause = clauses[idxNum + 1] || '';
    const nextNextClause = clauses[idxNum + 2] || '';
    if (/\bremain(?:s)?\s+on\s+injured\s+reserve\b/i.test(`${clause}. ${nextClause}`)) {
      continue;
    }

    const isActiveConfirm =
      /\b(are active|is active|also active|active vs\.?|active against|will be active|officially active|welcome back|set to make his [a-z0-9 ]*debut|returns?\s*,?\s+[a-z .'-]+active)\b/i.test(
        clause
      ) && !/\binactive\b/i.test(clause.replace(/\binactives\s+week\b/gi, ''));

    const isExplicitOut =
      /\b(ruled out|is inactive|are inactive|officially inactive|downgraded[^.;]*to out|will not play)\b/i.test(clause) &&
      !/\bentered week\s*\d+\s+with\b/i.test(clause);

    // Handle multi-sentence pattern: "The 49ers will have several key players available on Sunday, including T Trent Williams, LB Dre Greenlaw ... All five entered the matchup listed as questionable, [but] are active"
    const nextConfirmsAllActive =
      /\bavailable on (?:sunday|monday|thursday|saturday|gameday)\b/i.test(clause) &&
      /\b(?:are|is)\s+active\b/i.test(`${nextClause} ${nextNextClause}`);

    for (const pm of matchers) {
      if (!pm.regex.test(clause)) continue;
      if (inactiveMap.has(pm.key)) continue;
      if (isActiveConfirm || nextConfirmsAllActive) {
        activeKeys.add(pm.key);
      } else if (isExplicitOut && !activeKeys.has(pm.key)) {
        inactiveMap.set(pm.key, {
          name: pm.name,
          position: pm.position,
          jersey: pm.jersey,
          reason: ''
        });
      }
    }
  }

  // Ensure list-confirmed inactives always take precedence over ambiguous headline/prose mentions
  for (const k of inactiveMap.keys()) {
    activeKeys.delete(k);
  }

  const inactives = [...inactiveMap.values()];
  return {
    inactives,
    activeKeys,
    emergencyQbKeys,
    officialPosted: inactives.length >= 3
  };
}

/**
 * Parses RotoWire's structured league-wide NFL Inactives HTML (`rotowire.com/football/inactives.php`)
 * into per-team `{ [teamAbbr]: [{ name, position, reason }] }` arrays for both 49ers and Opponent.
 */
export function parseRotoWireInactivesHtml(html = '', targetTeams = null) {
  const byTeam = {};
  if (!html || typeof html !== 'string') return byTeam;
  const filterSet = Array.isArray(targetTeams) && targetTeams.length > 0
    ? new Set(targetTeams.map(t => normalizeCanonicalTeamAbbr(t)))
    : null;

  // Bounded lookahead prevents crossing into the next team's logo block while tolerating wider markup up to 1200 chars
  const blockRe =
    /images\/teamlogo\/football\/([A-Z]{2,3})\.svg(?:(?!images\/teamlogo\/football\/)[\s\S]){0,1200}?<ul\s+class="list[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi;
  let match;
  while ((match = blockRe.exec(html)) !== null) {
    const abbr = normalizeCanonicalTeamAbbr(match[1]);
    if (filterSet && !filterSet.has(abbr)) continue;
    const ulBody = match[2] || '';
    const liMatches = [...ulBody.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
    const players = [];
    for (const li of liMatches) {
      const inner = li[1] || '';
      const posRaw = decodeHtmlEntitiesBasic((inner.match(/<span[^>]*>([\s\S]*?)<\/span>/i) || [])[1] || '')
        .replace(/<[^>]+>/g, '')
        .trim();
      const linkNameRaw = decodeHtmlEntitiesBasic((inner.match(/<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || '')
        .replace(/<[^>]+>/g, '')
        .trim();
      const plainFallback = !linkNameRaw
        ? decodeHtmlEntitiesBasic(inner.replace(/<span[^>]*>[\s\S]*?<\/span>/gi, '').replace(/<[^>]+>/g, ' '))
            .replace(/\s+/g, ' ')
            .trim()
        : '';
      const nameRaw = linkNameRaw || plainFallback;
      if (!nameRaw || nameRaw.length < 3 || /^none$/i.test(nameRaw)) continue;
      players.push({
        name: nameRaw,
        position: posRaw || 'ATH',
        reason: ''
      });
    }
    if (players.length > 0) {
      byTeam[abbr] = players;
    }
  }
  return byTeam;
}

/**
 * Parses ESPN's Core Event Competitor Roster JSON
 * (`sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/{gameId}/competitions/{gameId}/competitors/{teamId}/roster`)
 * Strictly guards against pre-T-90m empty/all-active/all-inactive states (requires >=40 total entries & 3..12 inactives).
 */
export function parseEspnCoreEventRosterInactives(rosterJson = null, candidatePlayers = []) {
  const empty = { inactives: [], activeKeys: new Set(), officialPosted: false };
  const entries = Array.isArray(rosterJson?.entries)
    ? rosterJson.entries
    : Array.isArray(rosterJson?.roster)
      ? rosterJson.roster
      : [];
  if (entries.length < 40) return empty;

  const candByKey = new Map();
  for (const p of candidatePlayers || []) {
    const k = normalizeLookupName(p?.name || p?.fullName || p?.displayName || '');
    if (k) candByKey.set(k, p);
  }

  const inactives = [];
  const activeKeys = new Set();

  for (const entry of entries) {
    const athlete = entry?.athlete && typeof entry.athlete === 'object' ? entry.athlete : entry;
    const name = String(entry?.displayName || entry?.fullName || athlete?.displayName || athlete?.fullName || '').trim();
    const k = normalizeLookupName(name);
    if (!k) continue;
    const statusText = String(entry?.status?.name || athlete?.status?.name || '').toLowerCase();
    if (/injured reserve|reserve|pup|nfi|suspended|practice/i.test(statusText)) continue;

    if (entry.active === false) {
      const matchCand = candByKey.get(k);
      inactives.push({
        name: matchCand?.name || name,
        position: matchCand?.position || entry?.position?.abbreviation || athlete?.position?.abbreviation || 'ATH',
        jersey: matchCand?.jersey ?? (entry?.jersey != null ? Number(entry.jersey) : null),
        reason: ''
      });
    } else if (entry.active === true) {
      activeKeys.add(k);
    }
  }

  // NFL game-day inactives are 4–8 (up to 12 with elevations/emergency QB); reject 0..2 or >12 bogus states
  const officialPosted = inactives.length >= 3 && inactives.length <= 12;
  return {
    inactives: officialPosted ? inactives : [],
    activeKeys: officialPosted ? activeKeys : new Set(),
    officialPosted
  };
}

/**
 * Reconciles Sleeper's CORS-enabled NFL player status feed (`api.sleeper.app/v1/players/nfl`)
 * strictly against the team's known active 53-man roster during the pre-kickoff 90-minute window.
 * Catches healthy scratches (Coach's Decision) while guarding against Friday-Out false positives
 * before official T-90m inactives have actually dropped!
 */
export function extractSleeperGameDaySignals(
  sleeperPlayersObj = null,
  teamAbbr = 'SF',
  activeRosterPlayers = [],
  injuryReportRows = []
) {
  if (!sleeperPlayersObj || typeof sleeperPlayersObj !== 'object') {
    return { inactives: [], activeKeys: new Set(), officialPosted: false };
  }
  const canonTeam = normalizeCanonicalTeamAbbr(teamAbbr);
  const sleeperTeamVariants = new Set([canonTeam]);
  if (canonTeam === 'WAS') sleeperTeamVariants.add('WSH');
  if (canonTeam === 'LAR') sleeperTeamVariants.add('LA');
  if (canonTeam === 'JAX') sleeperTeamVariants.add('JAC');

  const active53ByKey = new Map();
  for (const p of activeRosterPlayers || []) {
    if (p?.rosterBucket && p.rosterBucket !== 'active') continue;
    const k = normalizeLookupName(p?.name || p?.fullName || '');
    if (k) active53ByKey.set(k, p);
  }
  const injByKey = new Map();
  const preDeclaredOutKeys = new Set();
  const preDeclaredQuestionableKeys = new Set();
  for (const r of injuryReportRows || []) {
    const st = String(r?.preGameStatus || r?.gameStatus || r?.status || '').trim();
    if (/injured reserve|\bir\b|suspended|pup/i.test(st)) continue;
    const k = normalizeLookupName(r?.name || '');
    if (!k) continue;
    injByKey.set(k, r);
    const stLower = st.toLowerCase();
    if (stLower === 'out' || stLower === 'inactive') preDeclaredOutKeys.add(k);
    else if (stLower === 'questionable' || stLower === 'doubtful') preDeclaredQuestionableKeys.add(k);
  }

  const inactives = [];
  const activeCandidateKeys = new Set();
  const seenKeys = new Set();
  let newGameDayScratchCount = 0;
  let stillQuestionableInSleeperCount = 0;

  for (const sp of Object.values(sleeperPlayersObj)) {
    if (!sp || !sleeperTeamVariants.has(normalizeCanonicalTeamAbbr(sp.team || ''))) continue;
    if (sp.status !== 'Active') continue;
    const fullName = String(sp.full_name || `${sp.first_name || ''} ${sp.last_name || ''}`).trim();
    const k = normalizeLookupName(fullName);
    if (!k || seenKeys.has(k)) continue;
    // Strictly require match against active 53-man roster or active-roster injury report (excludes Practice Squad)
    const rosterMatch = active53ByKey.get(k) || injByKey.get(k);
    if (!rosterMatch) continue;
    seenKeys.add(k);

    const injSt = String(sp.injury_status || '').trim().toLowerCase();
    if (injSt === 'out' || injSt === 'na' || injSt === 'inactive') {
      if (!preDeclaredOutKeys.has(k)) newGameDayScratchCount += 1;
      inactives.push({
        name: rosterMatch.name || fullName,
        position: rosterMatch.position || sp.position || 'ATH',
        jersey: rosterMatch.jersey ?? (sp.number != null ? Number(sp.number) : null),
        reason: sp.injury_body_part || sp.injury_notes || ''
      });
    } else if (injSt === 'questionable' || injSt === 'doubtful') {
      if (preDeclaredQuestionableKeys.has(k)) stillQuestionableInSleeperCount += 1;
    } else if (!injSt) {
      activeCandidateKeys.add(k);
    }
  }

  // Prevent Friday-Out false positives: if a team already ruled 3+ players Out on Friday, Sleeper still
  // reflects those Friday Outs at T-90m BEFORE game-day inactives post. Require at least 1 new game-day
  // scratch (or no Friday Outs on the ledger) and do not finalize while Questionables remain unresolved without >=2 new scratches.
  const allOnlyPreDeclaredOuts = preDeclaredOutKeys.size > 0 && newGameDayScratchCount === 0;
  const officialPosted =
    inactives.length >= 3 &&
    !allOnlyPreDeclaredOuts &&
    !(stillQuestionableInSleeperCount > 0 && newGameDayScratchCount < 2);

  return {
    inactives,
    activeKeys: officialPosted ? activeCandidateKeys : new Set(),
    officialPosted
  };
}

const BODY_PART_IN_GAME_RE =
  /\b(right\s+lower[\s-]leg|left\s+lower[\s-]leg|lower[\s-]leg|upper[\s-]leg|right\s+leg|left\s+leg|\bleg\b|fibula|tibia|right\s+shoulder|left\s+shoulder|shoulder|right\s+ankle|left\s+ankle|high[\s-]ankle|ankle|right\s+knee|left\s+knee|knee|acl|mcl|pcl|meniscus|hamstring|concussion|head|neck|stinger|elbow|wrist|hand|thumb|finger|rib|ribs|chest|pectoral|collarbone|clavicle|back|lower\s+back|hip|groin|quad|quadriceps|calf|shin|foot|toe|turf\s+toe|achilles|illness|cramps|eye|jaw|abdomen|oblique)\b/i;

function formatBodyPartTitle(raw = '') {
  const clean = String(raw || '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  if (/^(acl|mcl|pcl)$/i.test(clean)) return clean.toUpperCase();
  return clean
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

const IN_GAME_REPLACEMENT_OR_CONSOLATION_VERB_RE =
  /\b(?:(?:is|was|now)\s+in\s+(?:at\s+[a-z0-9/-]+\s+)?for|step(?:s|ped|ping)?\s+in\s+(?:at\s+[a-z0-9/-]+\s+)?for|fill(?:s|ed|ing)?\s+in\s+(?:at\s+[a-z0-9/-]+\s+)?for|cam(?:e|es)\s+in\s+(?:at\s+[a-z0-9/-]+\s+)?for|enter(?:s|ed|ing)?\s+(?:at\s+[a-z0-9/-]+\s+)?for|replac(?:e|es|ed|ing)\b|warming\s+up\s+for|took\s+over\s+(?:at\s+[a-z0-9/-]+\s+)?for|walked\s+over\s+to\s+(?:hug|console|check\s+on|encourage|embrace)|came\s+over\s+to\s+(?:hug|console|check\s+on|encourage|embrace)|gave\s+[\w\s'-]{0,20}\bhugs?\s+to|hugged|hugging|hugs\b|consoled|consoling|embraced|embracing|praying\s+for|prayers?\s+for)\b/i;

function findPlayerMentionOffsetInClause(pm, clause = '') {
  if (!pm || !clause) return -1;
  const fullM = pm.regex.exec(clause);
  if (fullM) return fullM.index;
  if (pm.nicknameRegex) {
    const nickM = pm.nicknameRegex.exec(clause);
    if (nickM) return nickM.index;
  }
  if (pm.surnameRegex) {
    const surM = pm.surnameRegex.exec(clause);
    if (surM) return surM.index;
  }
  return -1;
}

/**
 * Evaluates live post-kickoff beat tweets & wire blurbs (`[Kickoff, Final)`) to track real-time
 * in-game injuries and return probabilities for ANY active 49ers or Opponent player:
 *  - Evaluates chronologically so sequential transitions (QTR -> Returned OR QTR -> Ruled Out) resolve cleanly
 *  - Carries active injured-player subject across multi-sentence pronoun follow-ups ("Colton McKivitz is down on the field. Air cast going on his lower leg and the cart is out.")
 *  - Excludes healthy replacement/consolation teammates ("Vederian Lowe in at RT for McKivitz", "Trent Williams came over to hug McKivitz")
 *  - Protects against lagging blurb regressions (e.g. a delayed QTR blurb cannot revert `0% • Out (In-Game)`!)
 */
export function extractLiveInGameInjurySignals(
  newsItems = [],
  candidatePlayers = [],
  windowState = null,
  pregameInactiveKeys = new Set()
) {
  const byKey = new Map();
  if (!windowState?.isActive || !windowState?.hasKickoffStarted) {
    return { byKey, list: [] };
  }
  const inactiveSet =
    pregameInactiveKeys instanceof Set
      ? pregameInactiveKeys
      : new Set(Array.isArray(pregameInactiveKeys) ? pregameInactiveKeys : []);

  const kickoffMs = Number(windowState.kickoffMs);
  if (!Number.isFinite(kickoffMs) || kickoffMs <= 0) {
    return { byKey, list: [] };
  }

  const minInGameMs = kickoffMs - 2 * 60_000;
  const maxInGameMs = Number.isFinite(windowState.safetyEndMs)
    ? windowState.safetyEndMs
    : kickoffMs + (windowState.isExplicitLive || windowState.isDelayed ? MAX_EXTENDED_LIVE_GAME_DURATION_MS : MAX_LIVE_GAME_DURATION_MS);
  const matchers = buildCandidateMatchers(candidatePlayers);
  if (matchers.length === 0) return { byKey, list: [] };

  const relevantItems = [];
  for (const item of newsItems || []) {
    const pubMs = Date.parse(item?.publishedAt || '');
    if (!Number.isFinite(pubMs) || pubMs < minInGameMs || pubMs > maxInGameMs) continue;
    const leadPart = String(item?.fullText || item?.title || item?.headline || '').trim();
    const sumPart = String(item?.summary || '').trim();
    const text =
      sumPart && (!leadPart || !leadPart.toLowerCase().includes(sumPart.toLowerCase().slice(0, 32)))
        ? leadPart
          ? `${leadPart}. ${sumPart}`
          : sumPart
        : leadPart;
    if (!text) continue;
    relevantItems.push({ item, pubMs, text });
  }

  // Sort oldest -> newest so sequential transitions (QTR -> Returned OR QTR -> Ruled Out) resolve to the freshest truth!
  relevantItems.sort((a, b) => a.pubMs - b.pubMs);

  const RE_INJURY_RE =
    /\b(?:re-?injur|aggravat|again|second\s+time|back\s+to\s+the\s+(?:blue\s+)?(?:medical\s+)?tent|headed\s+back\s+to\s+the\s+locker\s+room|exited\s+again)\b/i;

  for (const { item, pubMs, text } of relevantItems) {
    // Skip pre-game inactive list recaps posted right around kickoff
    if (/\b(?:today'?s|official|week\s*\d+|game[\s-]?day)\s+inactives\b/i.test(text)) continue;

    const clauses = splitTextIntoGameDayClauses(text);
    let activeSubjectMatchers = [];

    for (const clause of clauses) {
      const mentionedInClause = matchers.filter(
        pm => !inactiveSet.has(pm.key) && doesClauseMentionPlayer(pm, clause, { allowUniqueSurname: true })
      );

      // Guard healthy replacement/consolation subjects ("Vederian Lowe in at RT for Colton McKivitz", "Trent Williams came over to hug McKivitz/him")
      const repConsolMatch = IN_GAME_REPLACEMENT_OR_CONSOLATION_VERB_RE.exec(clause);
      let targetMatchersForClause = mentionedInClause;
      let isConsolationOnlyReferencingPrior = false;
      if (repConsolMatch && mentionedInClause.length > 0) {
        const verbIdx = repConsolMatch.index;
        const afterVerb = mentionedInClause.filter(pm => {
          const idx = findPlayerMentionOffsetInClause(pm, clause);
          return idx >= verbIdx;
        });
        if (afterVerb.length > 0) {
          targetMatchersForClause = afterVerb;
        } else if (
          activeSubjectMatchers.length > 0 &&
          /\b(?:him|his)\b/i.test(clause.slice(verbIdx))
        ) {
          targetMatchersForClause = activeSubjectMatchers;
          isConsolationOnlyReferencingPrior = true;
        } else {
          targetMatchersForClause = [];
        }
      }

      if (targetMatchersForClause.length > 0) {
        if (!isConsolationOnlyReferencingPrior) {
          activeSubjectMatchers = targetMatchersForClause;
        }
      } else if (mentionedInClause.length > 0 && !repConsolMatch) {
        activeSubjectMatchers = [];
      }

      const hasMinorKnockOnly =
        /\b(?:shook it off and stayed in|stayed in the game|no injury|wind knocked out(?: of him)?|knocked the wind out|(?:missed|out for|sat out|exited for)\s+(?:a|one|two|1|2|a couple(?: of)?|a few)\s+(?:play|plays|snap|snaps)|for a play or two|for a couple(?: of)? (?:plays|snaps)|catching his breath|just a breather|back in on the next (?:play|snap|series|drive)|cramps?|cramping)\b/i.test(
          clause
        ) &&
        !/\b(?:ruled out|downgraded to out|doubtful to return|carted|cart\s+(?:is\s+)?(?:coming\s+)?out|(?:onto|on|into)\s+(?:a|the)\s+(?:medical\s+)?cart|air\s*cast|splint\b|immobiliz|locker room|tunnel|concussion|torn|fracture|broken|won'?t return|will not return|rolled\s+up\s+on)\b/i.test(
          clause
        );
      if (hasMinorKnockOnly) continue;

      const isReturned =
        /\b(returned to (?:the|tonight'?s|sunday'?s|monday'?s|thursday'?s|saturday'?s|today'?s)?\s*(?:game|action|contest|matchup|field)|has returned|is back in the (?:game|huddle|lineup)|back on the field|cleared to return|cleared concussion protocol|helmet back on and in|exited (?:the )?(?:blue )?medical tent and (?:is )?back)\b/i.test(
          clause
        ) && !/\b(?:not|never|won'?t|will not|unlikely to|questionable to|doubtful to)\s+return\b/i.test(clause);

      const isRuledOutInGame =
        /\b(ruled out(?:\s+for\s+(?:the\s+(?:rest|remainder)|tonight|today|the\s+game))?|downgraded\s+to\s+out|out for the (?:rest|remainder|game|night|day|season|year)|out for (?:tonight|today)|season-ending|will not return|won'?t return|did not return|done for the (?:day|night|game|season|year)|(?:officially\s+)?out\s+with\s+(?:a|an)\s+[a-z -]{2,24}\s+injur\w*)\b/i.test(
          clause
        ) && !/\b(?:not|hasn'?t been|haven'?t been|isn'?t)\s+ruled\s+out\b/i.test(clause);

      const isDoubtfulInGame =
        !isRuledOutInGame &&
        /\b(doubtful to return|carted (?:off|to|away|from|back|into|down)|(?:onto|on|into)\s+(?:a|the)\s+(?:medical\s+)?cart|loaded\s+onto\s+(?:a|the)\s+(?:medical\s+)?cart|cart\s+(?:is\s+)?(?:coming|comes|came|rolling|rolled|heading|headed)?\s*out|(?:bringing|brought|bring|calling|called|motion(?:ed|ing)?|wav(?:ed|ing)?)\s+(?:out\s+the\s+|for\s+the\s+)cart|medical\s+cart|in an air\s*cast|air\s*cast|splint\b|immobiliz\w*|on crutches|walking boot|gruesome\s+(?:[a-z-]+\s+)?injur\w*|deformed|unlikely to return)\b/i.test(
          clause
        );

      const isQuestionableInGame =
        !isRuledOutInGame &&
        !isDoubtfulInGame &&
        !isReturned &&
        /\b(questionable to return|evaluated for (?:a|an)\b|being evaluated|being checked (?:in|out in) the (?:blue )?(?:medical )?tent|blue medical tent|medical tent|(?:headed|going|went|walked|taken|limped|helped|escorted)\s+(?:off\s+)?(?:to\s+the\s+locker\s+room|(?:into|to|down)\s+the\s+tunnel)|limped off|limping off|helped off|walked off with trainers|examined by trainers|(?:trainers|medical\s+staff)\s+(?:are\s+)?(?:out|rushing|attending|tending|checking|looking\s+at|examining|surrounding|working\s+on)|being\s+tended\s+to|tended\s+to\s+by\s+trainers|receiving\s+medical\s+attention|shaken up on the play|non-contact|(?:down|staying\s+down|remained\s+down|still\s+down)\s+on\s+(?:the\s+)?(?:field|turf|grass)|(?:went|is|was)\s+down\s+(?:hard|clutching|grabbing|holding|after\s+getting\s+rolled|in\s+(?:a\s+lot\s+of\s+|visible\s+)?pain)|rolled\s+up\s+on|concussion (?:protocol|evaluation)|(?:exited|left) (?:tonight'?s|sunday'?s|monday'?s|thursday'?s|saturday'?s|today'?s|the)\s+(?:game|contest|matchup)|(?:exited|left)\s+(?:with|w\/)\s*(?:a|an|his)\s+[a-z -]{2,24}\s+(?:injur\w*|issue|pain|spasm|sprain|strain))\b/i.test(
          clause
        );

      if (!isReturned && !isRuledOutInGame && !isDoubtfulInGame && !isQuestionableInGame) continue;

      const effectivePlayers =
        targetMatchersForClause.length > 0
          ? targetMatchersForClause
          : mentionedInClause.length === 0 && activeSubjectMatchers.length > 0
            ? activeSubjectMatchers
            : [];
      if (effectivePlayers.length === 0) continue;

      const bodyMatch = clause.match(BODY_PART_IN_GAME_RE) || text.match(BODY_PART_IN_GAME_RE);
      const extractedBodyPart = bodyMatch ? formatBodyPartTitle(bodyMatch[1]) : '';

      for (const pm of effectivePlayers) {
        if (inactiveSet.has(pm.key)) continue;

        const prev = byKey.get(pm.key) || null;
        // Only recognize a "returned to the game" signal if the player had an in-game injury or explicit return report
        if (
          isReturned &&
          !prev &&
          !extractedBodyPart &&
          !/\breturn(?:ed)?\s+to\s+(?:the\s+|tonight'?s\s+|sunday'?s\s+|monday'?s\s+|thursday'?s\s+|saturday'?s\s+)?(?:game|action)\b/i.test(clause)
        ) {
          continue;
        }

        const injuryType = extractedBodyPart || prev?.injuryType || 'In-Game Injury';
        const isConcussionEval = /concussion|head/i.test(injuryType);

        let state = 'questionable';
        let probabilityPct = isConcussionEval ? 35 : 50;
        let status = 'Questionable to Return';
        let badgeLabel = `${probabilityPct}% • QTR (In-Game)`;

        if (isRuledOutInGame) {
          state = 'out';
          probabilityPct = 0;
          status = 'Out (In-Game)';
          badgeLabel = '0% • Out (In-Game)';
        } else if (isDoubtfulInGame) {
          state = 'doubtful';
          probabilityPct = 20;
          status = 'Doubtful to Return';
          badgeLabel = '20% • Doubtful (In-Game)';
        } else if (isReturned) {
          state = 'returned';
          probabilityPct = 99;
          status = 'Active';
          badgeLabel = '99% • In (Active)';
        }

        // Monotonic state-transition guards against lagging wire/RotoWire blurbs:
        // 1. Once ruled OUT, a delayed QTR/Doubtful blurb cannot downgrade OUT back to QTR (though we may enrich body part).
        if (prev?.state === 'out' && (state === 'questionable' || state === 'doubtful')) {
          if (prev.injuryType === 'In-Game Injury' && extractedBodyPart) {
            byKey.set(pm.key, { ...prev, injuryType: extractedBodyPart });
          }
          continue;
        }
        // 2. Once explicitly RETURNED to action, ignore lagging QTR blurbs within 12m unless explicit re-injury language appears.
        if (
          prev?.state === 'returned' &&
          state === 'questionable' &&
          pubMs - prev.pubMs <= 12 * 60_000 &&
          !RE_INJURY_RE.test(clause)
        ) {
          continue;
        }
        // 3. Once DOUBTFUL/carted, ignore lagging generic QTR blurbs within 20m unless explicitly "upgraded to questionable".
        if (
          prev?.state === 'doubtful' &&
          state === 'questionable' &&
          pubMs - prev.pubMs <= 20 * 60_000 &&
          !/\bupgraded\s+to\s+questionable\b/i.test(clause)
        ) {
          if (prev.injuryType === 'In-Game Injury' && extractedBodyPart) {
            byKey.set(pm.key, { ...prev, injuryType: extractedBodyPart });
          }
          continue;
        }

        const cleanHeadline = String(item?.fullText || item?.title || item?.headline || clause).trim();
        byKey.set(pm.key, {
          key: pm.key,
          name: pm.name,
          position: pm.position,
          jersey: pm.jersey,
          state,
          probabilityPct,
          status,
          badgeLabel,
          injuryType,
          publishedAt: new Date(pubMs).toISOString(),
          pubMs,
          latestSummary: cleanHeadline,
          latestItem: item
        });
      }
    }
  }

  const list = [...byKey.values()].sort(
    (a, b) => a.probabilityPct - b.probabilityPct || b.pubMs - a.pubMs
  );
  return { byKey, list };
}

/**
 * Parses recent wire items (tweets/blurbs near kickoff) to detect official inactive lists,
 * individual inactive scratches, active confirmations, late warmup scratches, and rare emergency/GTD active tags.
 * Evaluates chronologically & per-clause (with multi-line bulleted list support and abbreviation masking)
 * so mixed tweets never cross-contaminate and T-20m warmup scratches override earlier active notes.
 */
export function extractWireGameDaySignals(newsItems = [], candidatePlayers = [], kickoffMs = 0, options = {}) {
  const inactiveKeys = new Set();
  const activeKeys = new Set();
  const gtdActiveKeys = new Set();
  const emergencyQbKeys = new Set();
  const lateOverrideInactiveKeys = new Set();
  let hasOfficialListSignal = false;

  const targetCanon = options?.teamAbbr ? normalizeCanonicalTeamAbbr(options.teamAbbr) : null;
  const isDelayed = Boolean(options?.isDelayed);
  const minPubMs = Number.isFinite(kickoffMs) && kickoffMs > 0 ? kickoffMs - 4.5 * 3600_000 : 0;
  const maxPubMs = Number.isFinite(options?.safetyEndMs)
    ? options.safetyEndMs
    : Number.isFinite(kickoffMs) && kickoffMs > 0
      ? kickoffMs + (isDelayed ? MAX_EXTENDED_LIVE_GAME_DURATION_MS : 4.5 * 3600_000)
      : Infinity;
  // Widen pregame scratch discovery to ko+35m (or full delay window) for late-posting inactive lists,
  // while still filtering out post-kickoff in-game injury exits.
  const pregameCutoffMs = isDelayed
    ? maxPubMs
    : Number.isFinite(kickoffMs) && kickoffMs > 0
      ? kickoffMs + 35 * 60_000
      : Infinity;
  const liveExitGuardMs = Number.isFinite(kickoffMs) && kickoffMs > 0 ? kickoffMs - 2 * 60_000 : Infinity;

  const playerMatchers = buildCandidateMatchers(candidatePlayers);
  const chronological = [];
  for (const item of newsItems || []) {
    const pubMs = Date.parse(item?.publishedAt || '');
    if (Number.isFinite(pubMs) && (pubMs < minPubMs || pubMs > maxPubMs)) continue;
    const text = `${item?.title || ''} ${item?.fullText || ''} ${item?.headline || ''} ${item?.summary || ''}`.trim();
    if (!text) continue;
    chronological.push({ item, pubMs: Number.isFinite(pubMs) ? pubMs : 0, text });
  }
  chronological.sort((a, b) => a.pubMs - b.pubMs);

  const latestStatusByKey = new Map(); // key -> { status: 'inactive' | 'active' | 'gtd', pubMs }

  for (const { item, pubMs, text } of chronological) {
    // Ignore mid-game injury exit blurbs after kickoff so they don't mutate the pregame Declared Inactives card
    if (
      pubMs > liveExitGuardMs &&
      /\b(to return|remainder of|rest of the|medical tent|locker room|exited (?:tonight'?s|sunday'?s|monday'?s|thursday'?s|saturday'?s|today'?s|the)\s+game|left the game)\b/i.test(
        text
      )
    ) {
      continue;
    }
    if (pubMs > pregameCutoffMs && !/\binactives?\b/i.test(text)) {
      continue;
    }

    const listHeaderHit =
      /(?:today'?s|game[\s-]?day|week\s*\d+|official|[a-z0-9 .'-]{2,28})?\s*\binactives?(?:\s+(?:players?|list))?(?:\s+(?:vs\.?|against|at|for)\s+[^\n:]{2,35})?\s*[:\-]/i.exec(
        text
      );
    const hasGenericListMarker =
      Boolean(listHeaderHit) || /game[\s-]?day inactives|today'?s inactives|inactive players for week/i.test(text);

    // Handle multi-line bulleted inactives tweets (e.g. "49ers inactives vs. Vikings:\nQB Kurtis Rourke (3rd QB)\nWR Mike Evans...")
    const multilineSource = String(item?.fullText || item?.title || item?.headline || text);
    const mlMatch =
      /(?:^|\n)([^\n]{0,85}?\binactives?(?:\s+(?:players?|list))?(?:\s+(?:vs\.?|against|at|for)\s+[^\n:]{2,35})?\s*[:\-])[ \t]*\n([\s\S]+)/i.exec(
        multilineSource
      );
    if (mlMatch) {
      const headerLine = mlMatch[1] || '';
      const beforeVs = headerLine.split(/\b(?:vs\.?|against|at)\b/i)[0] || headerLine;
      const headerTeam = detectTeamAbbrInHeading(beforeVs);
      const teamMatches = !targetCanon || !headerTeam || headerTeam === targetCanon;
      if (teamMatches) {
        hasOfficialListSignal = true;
        const bodyLines = (mlMatch[2] || '').split(/\n+/).map(l => l.trim()).filter(Boolean);
        let matchedInBlock = 0;
        for (const ln of bodyLines) {
          if (/^(?:active\b|questionable\s+players|key\s+actives|note:|also\s+active)/i.test(ln)) break;
          const lineHeaderTeam = /\binactives?\b/i.test(ln) ? detectTeamAbbrInHeading(ln.split(/\b(?:vs\.?|against|at)\b/i)[0]) : null;
          if (lineHeaderTeam && targetCanon && lineHeaderTeam !== targetCanon) break;
          const isEmergLine =
            /\bemergency\s+(?:third|3rd)?\s*(?:quarterback|qb)\b|\(\s*(?:emergency\s+)?(?:3rd|third)\s+qb\s*\)/i.test(ln);
          for (const pm of playerMatchers) {
            if (pm.regex.test(ln)) {
              matchedInBlock += 1;
              latestStatusByKey.set(pm.key, { status: 'inactive', pubMs });
              if (isEmergLine) emergencyQbKeys.add(pm.key);
            }
          }
        }
        if (matchedInBlock >= 2) {
          // Still check prose lines BEFORE the list header (e.g. "Kittle is active. 49ers inactives:\n...")
          const preList = multilineSource.slice(0, mlMatch.index).trim();
          if (!preList) continue;
        }
      }
    }

    if (hasGenericListMarker) {
      const preVs = listHeaderHit ? listHeaderHit[0].split(/\b(?:vs\.?|against|at)\b/i)[0] : text.slice(0, 70);
      const detected = detectTeamAbbrInHeading(preVs);
      if (!targetCanon || !detected || detected === targetCanon) {
        hasOfficialListSignal = true;
      }
    }

    const clauses = splitTextIntoGameDayClauses(text);

    for (const clause of clauses) {
      if (/\b(?:to return|remainder of|rest of the game)\b/i.test(clause)) continue;

      const isInactiveListClause =
        /\b(?:today'?s |game[\s-]?day |49ers |official |week \d+ |[a-z]+ )?inactives?(?:\s+players?|\s+list)?(?:\s+(?:vs\.?|against|at|for)\s+[^:\n]{2,35})?\s*:/i.test(
          clause
        );
      if (isInactiveListClause && targetCanon) {
        const beforeColon = clause.split(':')[0] || '';
        const listOwner = detectTeamAbbrInHeading(beforeColon.split(/\b(?:vs\.?|against|at)\b/i)[0]);
        if (listOwner && listOwner !== targetCanon) continue;
      }

      const isEmergencyQbClause =
        /\bemergency\s+(?:third|3rd)?\s*(?:quarterback|qb)\b|\(\s*(?:emergency\s+)?(?:3rd|third)\s+qb\s*\)/i.test(clause);
      const isWarmupScratchClause =
        /\b(?:warmups?|pre-?game\s+warmups?|pregame\s+injury|downgraded[^.;]{0,45}to\s+out|late\s+scratch)\b/i.test(clause);

      const isInactiveProse =
        isInactiveListClause ||
        /\b(is inactive|are inactive|officially inactive|among .*inactives|ruled out(?:\s+for\s+(?:today|tonight|sunday|monday|thursday|saturday|week\s*\d+|the\s+game))?|downgraded[^.;]{0,45}to\s+out|will not play(?:\s+(?:today|tonight|sunday|monday|thursday|saturday|in\s+sunday|in\s+monday|in\s+thursday|in\s+saturday))?|won'?t play(?:\s+(?:today|tonight|sunday|monday|thursday|saturday|in\s+(?:sunday|monday|thursday|saturday)'?s\s+game))?|healthy scratch|scratched\s+(?:for|from|in\s+warmups)|inactive\s+(?:today|tonight|for|vs\.?|against))\b/i.test(
          clause
        ) ||
        /:\s*(?:inactive|ruled out|out\s+(?:for|vs\.?|against|today|tonight|sunday|monday|thursday|saturday)|won'?t play|will not play|not active)\b/i.test(
          clause
        );
      const isEmergencyGtdProse =
        !isInactiveProse &&
        /\b(available only in an emergency|active as (?:an? )?emergency|active.*game-time decision on snaps|snap[\s-]count limit)\b/i.test(
          clause
        );
      const isActiveProse =
        !isInactiveProse &&
        (/\b(officially active|is active(?:\s+(?:today|tonight|for|against|vs\.?))?|are active(?:\s+(?:today|tonight|for|against|vs\.?))?|active (?:today|tonight|for|vs\.?|against)\s+(?:today|tonight|sunday|monday|thursday|saturday|[a-z]{3,})|will play (?:today|tonight|sunday|monday|thursday|saturday)|suiting up|cleared to play|good to go (?:today|tonight|for (?:today|tonight|sunday|monday|thursday|saturday)))\b/i.test(
          clause
        ) ||
          /:\s*(?:active|will play|playing|good to go|cleared to play|in the lineup)\b/i.test(clause));

      if (!isInactiveProse && !isEmergencyGtdProse && !isActiveProse) continue;

      for (const pm of playerMatchers) {
        if (!doesClauseMentionPlayer(pm, clause, { allowUniqueSurname: isWarmupScratchClause })) continue;
        const prev = latestStatusByKey.get(pm.key);
        if (isInactiveProse && !isActiveProse) {
          if (prev?.status === 'active' || isWarmupScratchClause) {
            lateOverrideInactiveKeys.add(pm.key);
          }
          latestStatusByKey.set(pm.key, { status: 'inactive', pubMs });
          if (isEmergencyQbClause) emergencyQbKeys.add(pm.key);
        } else if (isEmergencyGtdProse) {
          latestStatusByKey.set(pm.key, { status: 'gtd', pubMs });
          gtdActiveKeys.add(pm.key);
        } else if (isActiveProse && !isInactiveProse) {
          // Do not let an older/same-timestamp active mention overwrite a late warmup scratch
          if (!lateOverrideInactiveKeys.has(pm.key) || pubMs > (prev?.pubMs || 0) + 5 * 60_000) {
            latestStatusByKey.set(pm.key, { status: 'active', pubMs });
            lateOverrideInactiveKeys.delete(pm.key);
          }
        }
      }
    }
  }

  for (const [k, rec] of latestStatusByKey.entries()) {
    if (rec.status === 'inactive') {
      inactiveKeys.add(k);
    } else if (rec.status === 'active' || rec.status === 'gtd') {
      activeKeys.add(k);
    }
  }

  if (inactiveKeys.size >= 4) {
    hasOfficialListSignal = true;
  }

  return {
    inactiveKeys,
    activeKeys,
    gtdActiveKeys,
    emergencyQbKeys,
    lateOverrideInactiveKeys,
    hasOfficialListSignal
  };
}

function isNonMedicalScratchReason(raw = '') {
  const clean = String(raw || '').trim();
  if (!clean) return true;
  return /^(?:healthy scratch.*|coach'?s decision|not injury related.*|nir\b.*|inactive|rest|personal)$/i.test(clean);
}

/**
 * Builds the Game-Day Inactives + Collapsible Active Roster model (Offense, Defense, Special Teams)
 * for either the 49ers or the Opposing Team.
 *
 * Robust to posting delays right around T-90m:
 *  - Shows immediately at T-90m with `isOfficialListPosted: false` ("Official Inactives Pending") + pre-declared Out players
 *  - Flips to `isOfficialListPosted: true` the moment official inactives post on team RSS/RotoWire/Sleeper/wire or kickoff starts
 */
export function buildTeamGameDayRosterModel({
  teamAbbr = 'SF',
  teamName = 'San Francisco 49ers',
  activeRosterPlayers = null,
  rosterPlayers = null,
  injuryReport = null,
  injuryReportRows = null,
  competitorEntries = [],
  newsItems = null,
  rawNewsItems = null,
  liveFeedData = null,
  windowState = null,
  windowInfo = null
} = {}) {
  const effectiveWindow = windowState || windowInfo;
  if (!effectiveWindow?.isActive) {
    return { isActive: false };
  }

  const effectiveRoster = activeRosterPlayers || rosterPlayers || [];
  const effectiveInjuryReport = injuryReport || injuryReportRows || [];
  const effectiveNews = newsItems || rawNewsItems || [];
  const effectiveCompEntries = [
    ...(competitorEntries || []),
    ...((liveFeedData?.inactives || []).map(item => ({
      ...item,
      name: item.name,
      position: item.position || 'ATH',
      jersey: item.jersey ?? null,
      reason: item.reason || item.injuryType || '',
      active: false,
      isInactive: true
    })))
  ];

  const feedActiveKeySet = new Set(
    (liveFeedData?.activeNames || []).map(nm => normalizeLookupName(nm)).filter(Boolean)
  );
  const feedEmergencyQbSet = new Set(
    (liveFeedData?.emergencyQbNames || []).map(nm => normalizeLookupName(nm)).filter(Boolean)
  );

  const injByKey = new Map();
  for (const row of effectiveInjuryReport) {
    const k = normalizeLookupName(row?.name || '');
    if (k) injByKey.set(k, row);
  }

  // Merge activeRosterPlayers + any injuryReport players not yet in activeRosterPlayers
  const mergedRosterMap = new Map();
  for (const p of effectiveRoster) {
    if (p?.rosterBucket && p.rosterBucket !== 'active') continue;
    const k = normalizeLookupName(p?.name || '');
    if (!k) continue;
    const pid = p.id || p.playerId || null;
    mergedRosterMap.set(k, {
      id: pid,
      playerId: pid,
      name: p.name,
      position: p.position || 'ATH',
      unit: classifyRosterUnit(p.position, p.unit),
      jersey: p.jersey ?? null,
      headshotUrl: p.headshotUrl || '',
      espnUrl: p.espnUrl || '',
      snapPct: p.primarySnapPct ?? p.snapPct ?? null,
      isStarter: Boolean(p.isStarter || (p.primarySnapPct ?? p.snapPct ?? 0) >= 55),
      injuryType: p.health?.injuryType || p.injuryType || '',
      gameStatus: p.health?.gameStatus || p.health?.status || p.gameStatus || '',
      beatNote: p.health?.shortComment || p.beatComment || p.beatNote || ''
    });
  }

  for (const inj of effectiveInjuryReport) {
    const k = normalizeLookupName(inj?.name || '');
    if (!k || mergedRosterMap.has(k)) continue;
    if (/injured reserve|\bir\b|suspended|pup/i.test(String(inj.gameStatus || inj.status || ''))) continue;
    if (inj.isInGameInjury || inj.isInGameReturned) continue;
    const pid = inj.id || inj.playerId || null;
    mergedRosterMap.set(k, {
      id: pid,
      playerId: pid,
      name: inj.name,
      position: inj.position || 'ATH',
      unit: classifyRosterUnit(inj.position, inj.unit),
      jersey: inj.jersey ?? null,
      headshotUrl: inj.headshotUrl || '',
      espnUrl: inj.espnUrl || '',
      snapPct: inj.snapPct ?? null,
      isStarter: Boolean(inj.isStarter || (inj.snapPct ?? 0) >= 55),
      injuryType: inj.injuryType || '',
      gameStatus: inj.gameStatus || '',
      beatNote: inj.beatComment || inj.beatNote || ''
    });
  }

  // Reconcile structured inactive entries (Official RSS article, RotoWire, Sleeper, or liveFeedData)
  const compByKey = new Map();
  let compExplicitInactiveCount = 0;
  for (const entry of effectiveCompEntries) {
    const nm = entry?.displayName || entry?.fullName || entry?.name || '';
    const k = normalizeLookupName(nm);
    if (!k) continue;
    const isExplicitlyInactive = entry.active === false || entry.isInactive === true;
    if (isExplicitlyInactive) compExplicitInactiveCount += 1;
    compByKey.set(k, {
      ...entry,
      isExplicitlyInactive
    });

    if (!mergedRosterMap.has(k) && nm) {
      const pid = entry.playerId ? String(entry.playerId) : null;
      mergedRosterMap.set(k, {
        id: pid,
        playerId: pid,
        name: nm,
        position: entry.position || 'ATH',
        unit: classifyRosterUnit(entry.position, ''),
        jersey: entry.jersey != null && entry.jersey !== '' ? Number(entry.jersey) : null,
        headshotUrl: entry.headshotUrl || '',
        espnUrl: entry.espnUrl || '',
        snapPct: null,
        isStarter: Boolean(entry.starter),
        injuryType: entry.reason || '',
        gameStatus: '',
        beatNote: ''
      });
    }
  }

  const allCandidates = Array.from(mergedRosterMap.values());
  const wireSignals = extractWireGameDaySignals(effectiveNews, allCandidates, effectiveWindow.kickoffMs, {
    teamAbbr,
    teamName,
    isDelayed: Boolean(effectiveWindow.isDelayed),
    safetyEndMs: effectiveWindow.safetyEndMs
  });

  // Only assert `isOfficialListPosted = true` when we actually have a verified official scratch list
  // (never fabricate a 52-player active game-day dress list just because the kickoff clock started while offline!).
  const isOfficialListPosted =
    Boolean(liveFeedData?.officialPosted) ||
    compExplicitInactiveCount >= 3 ||
    wireSignals.hasOfficialListSignal ||
    wireSignals.inactiveKeys.size >= 3;

  const inactives = [];
  const actives = [];
  const pendingQuestionables = [];

  for (const [k, player] of mergedRosterMap.entries()) {
    const injRow = injByKey.get(k) || null;
    const compRow = compByKey.get(k) || null;
    const rawStatus = String(injRow?.preGameStatus || injRow?.gameStatus || player.gameStatus || '').trim();
    const statusLower = rawStatus.toLowerCase();
    const rawMedicalCandidates = [injRow?.injuryType, player.injuryType, compRow?.reason]
      .map(s => String(s || '').trim())
      .filter(s => s && !isNonMedicalScratchReason(s));
    const medicalInjuryType = rawMedicalCandidates[0] || '';
    const combinedNote = `${injRow?.beatComment || injRow?.beatNote || ''} ${player.beatNote || ''}`;

    const isPreDeclaredOut =
      !injRow?.isInGameInjury &&
      (statusLower === 'out' ||
        statusLower === 'inactive' ||
        /\bruled out\b|\bwill not play\b/i.test(combinedNote));

    const isWireInactive = wireSignals.inactiveKeys.has(k);
    const isLateWarmupScratch = Boolean(wireSignals.lateOverrideInactiveKeys?.has(k));
    const isCompInactive = Boolean(compRow?.isExplicitlyInactive);
    const isWireActive =
      !isLateWarmupScratch &&
      (wireSignals.activeKeys.has(k) || feedActiveKeySet.has(k)) &&
      !isCompInactive;

    const isEmergencyQb =
      wireSignals.emergencyQbKeys.has(k) ||
      feedEmergencyQbSet.has(k) ||
      /\bemergency\s+(?:third|3rd)\s+(?:quarterback|qb)\b/i.test(combinedNote);

    const isEmergencyGtd =
      wireSignals.gtdActiveKeys.has(k) ||
      /\b(available only in an emergency|active as (?:an? )?emergency|emergency backup|game-time decision on snaps|snap[\s-]count limit)\b/i.test(
        combinedNote
      );

    if ((isCompInactive || isWireInactive || isPreDeclaredOut) && !isWireActive) {
      const isHealthyScratch = !medicalInjuryType && !isPreDeclaredOut;
      const scratchLabel = isHealthyScratch
        ? isEmergencyQb
          ? 'Healthy Scratch (Emergency 3rd QB)'
          : "Healthy Scratch (Coach's Decision)"
        : medicalInjuryType || 'Injury (Out)';

      inactives.push({
        ...player,
        isActive: false,
        injuryType: scratchLabel,
        reason: scratchLabel,
        reasonLabel: medicalInjuryType ? `${medicalInjuryType} (Out)` : scratchLabel,
        isHealthyScratch,
        isEmergencyQb,
        isInjuryScratch: !isHealthyScratch
      });
    } else {
      if (!isOfficialListPosted && !isWireActive && (statusLower === 'questionable' || statusLower === 'doubtful')) {
        pendingQuestionables.push({
          ...player,
          injuryType: medicalInjuryType,
          gameStatus: rawStatus
        });
      }
      actives.push({
        ...player,
        isActive: true,
        injuryType: medicalInjuryType,
        isConfirmedActiveWire: isWireActive,
        isEmergencyGtd,
        isExplicitActiveGtd: isEmergencyGtd
      });
    }
  }

  // Sort inactives: starters/injured scratches first, then healthy scratches by jersey/name
  inactives.sort((a, b) => {
    if (a.isInjuryScratch !== b.isInjuryScratch) return a.isInjuryScratch ? -1 : 1;
    if ((b.snapPct || 0) !== (a.snapPct || 0)) return (b.snapPct || 0) - (a.snapPct || 0);
    return (a.jersey ?? 99) - (b.jersey ?? 99) || a.name.localeCompare(b.name);
  });

  const sortUnitPlayers = unitName =>
    actives
      .filter(p => p.unit === unitName)
      .sort((a, b) => {
        const rDiff = positionOrderRank(unitName, a.position) - positionOrderRank(unitName, b.position);
        if (rDiff !== 0) return rDiff;
        if (a.isStarter !== b.isStarter) return a.isStarter ? -1 : 1;
        if ((b.snapPct || 0) !== (a.snapPct || 0)) return (b.snapPct || 0) - (a.snapPct || 0);
        return (a.jersey ?? 99) - (b.jersey ?? 99) || a.name.localeCompare(b.name);
      });

  const activeByUnit = {
    Offense: sortUnitPlayers('Offense'),
    Defense: sortUnitPlayers('Defense'),
    'Special Teams': sortUnitPlayers('Special Teams')
  };

  const inactiveKeySet = new Set(inactives.map(p => normalizeLookupName(p.name)));
  const explicitActiveKeySet = new Set([
    ...wireSignals.activeKeys,
    ...feedActiveKeySet
  ]);
  for (const ik of inactiveKeySet) explicitActiveKeySet.delete(ik);

  const gtdKeySet = new Set(actives.filter(p => p.isEmergencyGtd).map(p => normalizeLookupName(p.name)));
  const statusBadgeLabel = effectiveWindow.hasKickoffStarted
    ? effectiveWindow.isOvertime
      ? 'Overtime • Live Roster'
      : 'Live Game-Day Roster'
    : effectiveWindow.isDelayed
      ? isOfficialListPosted
        ? 'Delayed Kickoff • Inactives Declared'
        : 'Delayed Kickoff • Inactives Pending'
      : isOfficialListPosted
        ? 'Official Inactives Declared'
        : 'Official Inactives Pending';

  return {
    isActive: true,
    teamAbbr,
    teamName,
    week: effectiveWindow.week,
    windowState: effectiveWindow,
    windowInfo: effectiveWindow,
    hasKickoffStarted: Boolean(effectiveWindow.hasKickoffStarted),
    minutesUntilKickoff: effectiveWindow.minutesUntilKickoff,
    isOfficialListPosted,
    officialPosted: isOfficialListPosted,
    sourceUrl: liveFeedData?.sourceUrl || null,
    sourceLabel: liveFeedData?.sourceLabel || null,
    statusBadgeLabel,
    statusLabel: statusBadgeLabel,
    inactives,
    activeCount: actives.length,
    totalActives: actives.length,
    activeByUnit,
    activesByUnit: activeByUnit,
    pendingQuestionables,
    inactiveKeySet,
    explicitActiveKeySet,
    gtdKeySet
  };
}

/**
 * Resolves Questionable / Doubtful statuses to deterministic In (Active) or Out (Inactive)
 * once game-day inactives are declared (T-90m) through the conclusion of the game, AND
 * dynamically layers live post-kickoff in-game injuries (`50% • QTR (In-Game)`, `0% • Out (In-Game)`,
 * or `99% • In (Active)` upon return) plus surprise starter scratches.
 */
export function resolveGameDayInjuryRows(rows = [], gameDayModel = null, options = {}) {
  if (!Array.isArray(rows) || !gameDayModel?.isActive) {
    return rows;
  }

  const inGameSignals = options?.inGameSignals || gameDayModel.inGameSignals || null;
  const activeRosterPlayers = options?.activeRosterPlayers || [];

  const inactiveSet =
    gameDayModel.inactiveKeySet instanceof Set
      ? gameDayModel.inactiveKeySet
      : new Set((gameDayModel.inactives || []).map(p => normalizeLookupName(p?.name || '')));
  const explicitActiveSet =
    gameDayModel.explicitActiveKeySet instanceof Set
      ? gameDayModel.explicitActiveKeySet
      : new Set();
  const gtdSet =
    gameDayModel.gtdKeySet instanceof Set
      ? gameDayModel.gtdKeySet
      : new Set(
          Object.values(gameDayModel.activeByUnit || {})
            .flat()
            .filter(p => p?.isEmergencyGtd)
            .map(p => normalizeLookupName(p?.name || ''))
        );

  const lockAllQuestionables = Boolean(gameDayModel.isOfficialListPosted || gameDayModel.hasKickoffStarted);
  const seenKeys = new Set();
  const resolved = [];

  for (const row of rows) {
    const k = normalizeLookupName(row?.name || '');
    if (k) seenKeys.add(k);
    const isInactive = inactiveSet.has(k);
    const origStatus = row?.preGameStatus || row?.gameStatus || '';
    const statusLower = String(origStatus).toLowerCase();
    const isUnactivatedIrRow =
      !explicitActiveSet.has(k) &&
      (row?.rosterBucket === 'ir' ||
        Boolean(row?.isIrReturnWindow) ||
        Boolean(row?.isIrReturnQuestionable) ||
        /\b(?:injured\s+reserve|21-day\s+window|ir\s+return\s+window)\b/i.test(statusLower));

    if (isUnactivatedIrRow && !row?.isInGameInjury && !row?.isInGameReturned) {
      resolved.push({
        ...row,
        preGameStatus: origStatus,
        gameStatus: 'Injured Reserve',
        playProbabilityPct: 0,
        tier: 'OUT',
        playTier: 'OUT',
        badgeLabel: '0% • IR',
        playBadgeLabel: '0% • IR'
      });
      continue;
    }

    if ((isInactive || statusLower === 'out' || statusLower === 'inactive') && !row?.isInGameInjury && !row?.isInGameReturned) {
      resolved.push({
        ...row,
        preGameStatus: origStatus,
        gameStatus: 'Inactive',
        playProbabilityPct: 0,
        tier: 'OUT',
        playTier: 'OUT',
        badgeLabel: '0% • Out (Inactive)',
        playBadgeLabel: '0% • Out (Inactive)'
      });
      continue;
    }

    // Live post-kickoff in-game injury override (QTR -> 50%, Doubtful -> 20%, Out -> 0%, Returned -> 99%)
    const liveInGame = k && inGameSignals?.byKey ? inGameSignals.byKey.get(k) : null;
    if (liveInGame) {
      const tier =
        liveInGame.state === 'out'
          ? 'OUT'
          : liveInGame.state === 'doubtful'
            ? 'DOUBTFUL'
            : liveInGame.state === 'returned'
              ? 'ACTIVE'
              : 'QUESTIONABLE';
      resolved.push({
        ...row,
        preGameStatus: origStatus || 'Active',
        injuryType: liveInGame.injuryType || row.injuryType || 'In-Game Injury',
        gameStatus: liveInGame.status,
        playProbabilityPct: liveInGame.probabilityPct,
        tier,
        playTier: tier,
        badgeLabel: liveInGame.badgeLabel,
        playBadgeLabel: liveInGame.badgeLabel,
        sustainedInLastGame: true,
        isInGameInjury: liveInGame.state !== 'returned',
        isInGameReturned: liveInGame.state === 'returned',
        beatComment: liveInGame.latestSummary || row.beatComment || '',
        shortComment: liveInGame.latestSummary || row.shortComment || '',
        longComment: liveInGame.latestSummary || row.longComment || '',
        inGameLatestItem: liveInGame.latestItem || null
      });
      continue;
    }

    if (!lockAllQuestionables && !explicitActiveSet.has(k)) {
      resolved.push(row);
      continue;
    }

    // Active on game day! Check ONLY genuine active emergency/snap-limit GTD (never stale Friday "remains a game-time decision")
    const isRareActiveGtd =
      gtdSet.has(k) ||
      /\b(available only in an emergency|active as (?:an? )?emergency|emergency backup|game-time decision on snaps|snap[\s-]count limit)\b/i.test(
        String(row?.beatComment || row?.beatNote || row?.longComment || row?.shortComment || '')
      );

    if (isRareActiveGtd) {
      resolved.push({
        ...row,
        preGameStatus: origStatus,
        gameStatus: 'Active (GTD)',
        playProbabilityPct: 65,
        tier: 'QUESTIONABLE',
        playTier: 'QUESTIONABLE',
        badgeLabel: 'Active • GTD',
        playBadgeLabel: 'Active • GTD'
      });
      continue;
    }

    resolved.push({
      ...row,
      preGameStatus: origStatus,
      gameStatus: 'Active',
      playProbabilityPct: 99,
      tier: 'ACTIVE',
      playTier: 'ACTIVE',
      badgeLabel: '99% • In (Active)',
      playBadgeLabel: '99% • In (Active)'
    });
  }

  // Inject surprise starter scratches (or unlisted late medical scratches) while keeping depth Coach's Decision healthy scratches in Declared Inactives only
  for (const inact of gameDayModel.inactives || []) {
    const k = normalizeLookupName(inact?.name || '');
    if (!k || seenKeys.has(k)) continue;
    if (!inact.isStarter && inact.isHealthyScratch) continue;
    seenKeys.add(k);
    resolved.push({
      playerId: inact.playerId || inact.id || '',
      name: inact.name,
      position: inact.position || 'ATH',
      unit: inact.unit || classifyRosterUnit(inact.position || '', ''),
      jersey: inact.jersey ?? null,
      headshotUrl: inact.headshotUrl || '',
      espnUrl: inact.espnUrl || '',
      snapPct: inact.snapPct ?? null,
      isStarter: Boolean(inact.isStarter),
      wed: '-',
      thu: '-',
      fri: '-',
      preGameStatus: 'Inactive',
      injuryType: inact.injuryType || "Healthy Scratch (Coach's Decision)",
      gameStatus: 'Inactive',
      playProbabilityPct: 0,
      tier: 'OUT',
      playTier: 'OUT',
      badgeLabel: '0% • Out (Inactive)',
      playBadgeLabel: '0% • Out (Inactive)',
      beatComment: inact.isHealthyScratch
        ? `${inact.name} is a game-day healthy scratch (Coach's Decision).`
        : `${inact.name} (${inact.injuryType}) is officially inactive.`
    });
  }

  // Inject newly injured mid-game active players (e.g. Purdy hurt in Q2) who were NOT on the pregame Injury Report
  if (inGameSignals?.byKey && inGameSignals.byKey.size > 0) {
    const activePool = [
      ...activeRosterPlayers,
      ...Object.values(gameDayModel.activeByUnit || {}).flat()
    ];
    const metaByKey = new Map();
    for (const p of activePool) {
      const pk = normalizeLookupName(p?.name || '');
      if (pk && !metaByKey.has(pk)) metaByKey.set(pk, p);
    }

    for (const [k, sig] of inGameSignals.byKey.entries()) {
      if (seenKeys.has(k) || inactiveSet.has(k)) continue;
      seenKeys.add(k);
      const meta = metaByKey.get(k) || {};
      const tier =
        sig.state === 'out'
          ? 'OUT'
          : sig.state === 'doubtful'
            ? 'DOUBTFUL'
            : sig.state === 'returned'
              ? 'ACTIVE'
              : 'QUESTIONABLE';
      resolved.push({
        playerId: meta.playerId || meta.id || '',
        name: meta.name || sig.name,
        position: meta.position || sig.position || 'ATH',
        unit: meta.unit || classifyRosterUnit(meta.position || sig.position || '', ''),
        jersey: meta.jersey ?? sig.jersey ?? null,
        headshotUrl: meta.headshotUrl || '',
        espnUrl: meta.espnUrl || '',
        snapPct: meta.primarySnapPct ?? meta.snapPct ?? null,
        isStarter: Boolean(meta.isStarter || (meta.primarySnapPct ?? meta.snapPct ?? 0) >= 55),
        wed: '-',
        thu: '-',
        fri: '-',
        preGameStatus: 'Active',
        injuryType: sig.injuryType || 'In-Game Injury',
        gameStatus: sig.status,
        playProbabilityPct: sig.probabilityPct,
        tier,
        playTier: tier,
        badgeLabel: sig.badgeLabel,
        playBadgeLabel: sig.badgeLabel,
        sustainedInLastGame: true,
        isInGameInjury: sig.state !== 'returned',
        isInGameReturned: sig.state === 'returned',
        beatComment: sig.latestSummary || '',
        shortComment: sig.latestSummary || '',
        longComment: sig.latestSummary || '',
        inGameLatestItem: sig.latestItem || null,
        factors: [`Live In-Game Update: ${sig.status}`]
      });
    }
  }

  // Sort deterministically from lowest -> highest Play Likelihood (0% Out -> 50% QTR -> 65% GTD -> 99% Active)
  return resolved.sort((a, b) => {
    const pDiff = (a.playProbabilityPct ?? 99) - (b.playProbabilityPct ?? 99);
    if (pDiff !== 0) return pDiff;
    if (Boolean(a.isInGameInjury) !== Boolean(b.isInGameInjury)) return a.isInGameInjury ? -1 : 1;
    if (Boolean(a.isStarter) !== Boolean(b.isStarter)) return a.isStarter ? -1 : 1;
    return (b.snapPct || 0) - (a.snapPct || 0);
  });
}

/**
 * Shared synchronous game-day model resolver for UI views (`Home` and `Game & Season`).
 * Evaluates `[T-90m, Final)` live against `nowMs` so the block activates immediately at T-90m
 * (even offline before network hydration) and retires the instant the game completes.
 */
export function resolveTeamGameDayModel(appData, { is49ers = false, windowState = null, nowMs = Date.now() } = {}) {
  const um = appData?.scheduleMatchup?.upcomingMatchup || {};
  const sched = appData?.scheduleMatchup?.schedule || [];
  const win = windowState || evaluateGameDayWindow(sched, um, nowMs);
  if (!win?.isActive) return null;

  const liveFeedOverride = is49ers ? appData?.liveGameDay?.sf || null : appData?.liveGameDay?.opp || null;
  const preHydrated = is49ers
    ? appData?.health?.gameDayRoster
    : um?.opponentHealth?.gameDayRoster;

  const sfActive53 = is49ers
    ? (appData?.roster?.players || []).filter(p => !p.rosterBucket || p.rosterBucket === 'active')
    : [];
  const oppHealth = um?.opponentHealth || {};
  const oppPool = !is49ers
    ? Array.isArray(oppHealth.activeRoster) && oppHealth.activeRoster.length > 0
      ? oppHealth.activeRoster
      : [...(oppHealth.keyStartersHealthy || []), ...(oppHealth.injuryReport || [])]
    : [];

  const combinedNews = is49ers
    ? appData?.news?.rawStream || []
    : [
        ...(appData?.liveGameDay?.oppWireItems || []),
        ...(appData?._oppNewsWire || []),
        ...(appData?.news?.rawStream || [])
      ];

  let model = null;
  if (
    preHydrated?.isActive &&
    (!liveFeedOverride?.officialPosted || preHydrated.officialPosted) &&
    Number(preHydrated.week || win.week) === Number(win.week)
  ) {
    const syncedStatusBadgeLabel = win.hasKickoffStarted
      ? win.isOvertime
        ? 'Overtime • Live Roster'
        : 'Live Game-Day Roster'
      : win.isDelayed
        ? preHydrated.isOfficialListPosted
          ? 'Delayed Kickoff • Inactives Declared'
          : 'Delayed Kickoff • Inactives Pending'
        : preHydrated.isOfficialListPosted
          ? 'Official Inactives Declared'
          : 'Official Inactives Pending';
    model = {
      ...preHydrated,
      hasKickoffStarted: Boolean(win.hasKickoffStarted),
      minutesUntilKickoff: win.minutesUntilKickoff,
      statusBadgeLabel: syncedStatusBadgeLabel,
      statusLabel: syncedStatusBadgeLabel,
      windowState: win,
      windowInfo: win
    };
  } else if (is49ers) {
    const activeTeam = resolveTeamConfig(appData?.meta?.teamAbbr || getActiveTeamConfig());
    model = buildTeamGameDayRosterModel({
      teamAbbr: activeTeam.abbr,
      teamName: activeTeam.fullName,
      activeRosterPlayers: sfActive53,
      injuryReport: appData?.health?._preGamePracticeReport || appData?.health?.practiceReport || [],
      newsItems: combinedNews,
      liveFeedData: liveFeedOverride,
      windowState: win
    });
  } else {
    model = buildTeamGameDayRosterModel({
      teamAbbr: um?.oppAbbr || 'OPP',
      teamName: um?.oppName || um?.oppAbbr || 'Opponent',
      activeRosterPlayers: oppPool,
      injuryReport: oppHealth._preGameInjuryReport || oppHealth.injuryReport || [],
      newsItems: combinedNews,
      liveFeedData: liveFeedOverride,
      windowState: win
    });
  }

  if (model?.isActive && win.hasKickoffStarted) {
    const candidatePool = is49ers ? sfActive53 : oppPool;
    model.inGameSignals = extractLiveInGameInjurySignals(
      combinedNews,
      candidatePool,
      win,
      model.inactiveKeySet
    );
  }

  return model;
}

/**
 * Normalizes a player's injury status and beat note during the early-week rollover window
 * (post-game through Wednesday morning before the upcoming week's first practice report).
 *  - Filters out non-injury healthy scratches (`Coach's Decision`, `NIR - Rest`, `Personal`)
 *  - Converts prior-game `Out` / `Inactive` tags into upcoming-week `Questionable` (or `Doubtful`
 *    for multi-week injuries, or `Out` only if explicitly ruled out for `upcomingWeek`)
 *  - Scrubs prior-game "inactive" / "ruled out for Sunday" phrases from `beatNoteForModel` so
 *    `computePlayerPlayProbability` computes genuine upcoming-week play likelihood instead of `0% • Out`
 */
export function resolveEarlyWeekRolloverInput({
  playerName = '',
  rawStatus = '',
  injuryType = '',
  shortComment = '',
  longComment = '',
  upcomingWeek = null,
  lastCompletedWeek = null,
  blurbDateIso = null,
  lastCompletedGameKickoffMs = null,
  playedInCompletedGame = null,
  hasPostKickoffInjurySignal = false,
  postKickoffInjuryNote = ''
} = {}) {
  const injClean = String(injuryType || '').trim();
  const injLower = injClean.toLowerCase();
  const statusClean = String(rawStatus || '').trim();
  const statusLower = statusClean.toLowerCase();
  const shortTrim = String(shortComment || '').trim();
  const rawCombined = `${shortTrim} ${String(longComment || '').trim()}`.trim();

  // Scope multi-player ESPN/RotoWire blurbs to the target player so teammate clauses
  // (e.g., "Van Ginkel sustained his injury in the fourth quarter. Blake Cashman (concussion) is inactive...")
  // never bleed another teammate's `is inactive` / `surgery` tag onto this player!
  const inferredTargetName =
    String(playerName || '').trim() ||
    (shortTrim.match(/^([A-Z][A-Za-z'. -]{1,26})\s+\([a-zA-Z /,-]{3,24}\)/)?.[1] || '').trim();
  const combined = inferredTargetName
    ? scopeBeatTextToPlayer(rawCombined, inferredTargetName) || rawCombined
    : rawCombined;

  const isNonInjuryScratch =
    /not injury related|nir\s*-?\s*rest|\brest\b|coach'?s decision|personal/i.test(injLower) ||
    (!injClean && /^inactive\.?$/i.test(shortTrim));
  if (isNonInjuryScratch) {
    return {
      skip: true,
      effectiveStatus: 'Active',
      beatNoteForModel: ''
    };
  }

  const blurbMs = blurbDateIso ? Date.parse(String(blurbDateIso)) : NaN;
  const isFreshPostGameBlurb =
    Number.isFinite(blurbMs) &&
    Number.isFinite(lastCompletedGameKickoffMs) &&
    lastCompletedGameKickoffMs > 0 &&
    blurbMs >= lastCompletedGameKickoffMs + 2.5 * 3_600_000;

  const hasMissedPriorGameProse =
    /\b(is inactive|was inactive|remained inactive|officially inactive|ruled out for (?:sunday|monday|thursday|saturday|today)|will not play|won't play|missing (?:a |his )?(?:second|third|fourth|fifth) (?:straight|consecutive)|will miss (?:his )?(?:second|third|fourth|fifth) (?:straight|consecutive)|missed (?:the (?:[a-z0-9'.-]+ )?)?(?:last|past) (?:two|three|four|five|six|\d+) (?:games|contests|matchups)|has missed (?:the )?(?:last|past )?(?:two|three|four|five|six|\d+) (?:consecutive |straight )?(?:games|contests|matchups)|missed (?:sunday|monday|thursday|saturday|last week|week \d+)|sat out (?:sunday|monday|thursday|saturday|last week|week \d+)|staying behind|stayed behind|didn'?t travel|did not travel|hasn'?t played since|has not played since|for the first time since week \d+)\b/i.test(
      combined
    );

  const hasUpcomingWeekUncertaintyProse =
    /\b(hoping to (?:have|get)|hopes? to (?:have|get)|hopeful (?:to|he can)|just not sure yet|has a chance (?:at|to|of) return|chance (?:at|to|of) returning|chance to return|could return|might return|may return|if [a-z'. -]{1,28} (?:is able|can|manages) to practice|practice participation will determine|worth monitoring|up in the air|questionable at best|day-to-day|make progress ahead of|back at practice this week|return to practice)\b/i.test(
      combined
    );

  // Strip historical week injury origins (e.g. "injured his back in Week 9" when rolling into Week 11)
  // so prior-week background context never triggers a false post-game acute injury flag!
  const completedWkNum =
    Number.isFinite(Number(lastCompletedWeek)) && Number(lastCompletedWeek) >= 1
      ? Number(lastCompletedWeek)
      : upcomingWeek && Number(upcomingWeek) > 1
        ? Number(upcomingWeek) - 1
        : null;
  const sanitizedCombinedForAcuteCheck = combined
    .replace(/\b(?:sustained|suffered|picked up|injured[\s\S]{0,24}?)\s+(?:back\s+)?in\s+week\s*(\d{1,2})\b/gi, (m, wkStr) => {
      const refWk = Number(wkStr);
      if (completedWkNum && Number.isFinite(refWk) && refWk < completedWkNum) {
        return 'prior week injury';
      }
      return m;
    })
    .replace(/\bin\s+the\s+(?:first|second)\s+half\s+of[\s\S]{0,45}\bweek\s*(\d{1,2})\b/gi, (m, wkStr) => {
      const refWk = Number(wkStr);
      if (completedWkNum && Number.isFinite(refWk) && refWk < completedWkNum) {
        return 'in prior week';
      }
      return m;
    });

  const hasAcuteCompletedGameInjuryInProse =
    /\b(sustained|suffered|injured (?:in|during|his|her)|aggravat(?:ed|ion)|re-aggravat(?:ed|ion)|concussion protocol|evaluated for a concussion|left (?:sunday|monday|thursday|saturday|the)[a-z ']* (?:game|win|loss|contest)|(?:left|exited)\s+(?:[\w' -]{0,32}\s+)?with\s+(?:a|an|the(?:\s+same)?)\s+[a-z -]{3,28}|exited (?:sunday|monday|thursday|saturday|the)|questionable to return|doubtful to return|ruled out for the (?:rest|remainder)|did(?:n['’]?t|\s+not)\s+return|will not return|won['’]?t return|didn'?t leave unscathed|after the game|following the (?:game|win|loss)|underwent an mri|scheduled for an mri|x-rays?|ct scan|surgery|high-ankle|sprained|strained|week-to-week|out (?:multiple|several) weeks|broken|fracture|torn|placed on injured reserve|ruled out for week)\b/i.test(
      sanitizedCombinedForAcuteCheck
    );

  // Authoritative Completed-Game Participation Check:
  // If the player suited up and played in the just-completed game (`playedInCompletedGame === true`)
  // and has ZERO post-kickoff injury report/tweet or new post-game acute diagnosis, clear stale pre-game Questionable tags!
  // Note: Only causally impossible mid-week practice markers ("did not practice Wednesday/Thursday/Friday")
  // can override `hasAcuteCompletedGameInjuryInProse` during early-week rollover — forward-looking phrases
  // ("questionable for Sunday's game") NEVER wipe a genuine Sunday injury reported in ESPN's Monday blurb!
  if (
    playedInCompletedGame === true &&
    !hasPostKickoffInjurySignal &&
    statusLower !== 'out' &&
    statusLower !== 'injured reserve' &&
    statusLower !== 'ir'
  ) {
    const strictPriorMidweekPracticeMarker =
      /\b(did not practice (?:wednesday|thursday|friday)|did not participate in (?:wednesday|thursday|friday)|observer for (?:wednesday|thursday|friday)'?s? (?:session|practice)|limited in (?:wednesday|thursday|friday)'?s? practice|(?:during|in) (?:wednesday|thursday|friday)'?s? practice|(?:is|was|officially) active for (?:sunday|monday|thursday|saturday|today|week\s*\d+)|cleared (?:by medical staff )?to play in (?:sunday|monday|thursday|saturday)'?s? (?:game|contest|matchup|tilt))\b/i.test(
        combined
      );
    if (!hasAcuteCompletedGameInjuryInProse || strictPriorMidweekPracticeMarker) {
      return {
        skip: true,
        effectiveStatus: 'Active',
        beatNoteForModel: ''
      };
    }
  }

  // Drop players who were already cleared ahead of the completed game with zero newly sustained in-game or post-game injury.
  // NEVER drop players who missed the completed game (`playedInCompletedGame === false` or missed-game prose) or whose
  // fresh post-game / Questionable blurb expresses upcoming-week practice/return uncertainty (e.g. "has a chance at returning to action in Week 11").
  const canCheckPriorPreGameClearance =
    playedInCompletedGame !== false &&
    !hasMissedPriorGameProse &&
    !(statusLower === 'questionable' && (hasUpcomingWeekUncertaintyProse || isFreshPostGameBlurb));

  if (
    canCheckPriorPreGameClearance &&
    (statusLower === 'active' ||
      statusLower === 'healthy' ||
      statusLower === '' ||
      statusLower === 'questionable') &&
    !/^inactive\b/i.test(shortTrim)
  ) {
    const wasExplicitlyClearedInHeadline =
      /\b(does not (?:have|carry) (?:an?y? )?(?:official )?(?:injury )?designation|doesn'?t (?:have|carry) (?:an?y? )?(?:official )?(?:injury )?designation|has no (?:official )?(?:injury )?designation|no official injury designation|off the injury report)\b/i.test(
        shortTrim
      );
    if (wasExplicitlyClearedInHeadline && !hasPostKickoffInjurySignal) {
      return {
        skip: true,
        effectiveStatus: 'Active',
        beatNoteForModel: ''
      };
    }

    const referencesUpcomingWeekReturn = Boolean(
      upcomingWeek &&
        new RegExp(
          `\\b(?:returning to action|return to action|get back on the field|cleared to play)[^.;]{0,36}\\bweek\\s*${Number(upcomingWeek)}\\b`,
          'i'
        ).test(combined)
    );
    const wasClearedPreGame =
      !referencesUpcomingWeekReturn &&
      !hasUpcomingWeekUncertaintyProse &&
      /\b(does not (?:have|carry) (?:an?y? )?(?:official )?(?:injury )?designation|doesn'?t (?:have|carry) (?:an?y? )?(?:official )?(?:injury )?designation|has no (?:official )?(?:injury )?designation|no official injury designation|off the injury report|designation now a thing of the past|(?:he'?ll|will|is|set to|slated to)\s+return to action|set to get back on the field|all set to suit up|now set to go|appears to have done him well|gave him some extra recovery time|cleared (?:the league'?s )?concussion protocol)\b/i.test(
        combined
      );
    if (!hasAcuteCompletedGameInjuryInProse && !hasPostKickoffInjurySignal && wasClearedPreGame) {
      return {
        skip: true,
        effectiveStatus: 'Active',
        beatNoteForModel: ''
      };
    }
  }

  const negatedUpcomingWeekOut =
    upcomingWeek &&
    new RegExp(
      `\\b(?:not|n't|hasn't been|has not been|haven't been|have not been|never)\\s+(?:been\\s+)?(?:ruled\\s+)?out\\s+for\\s+week\\s*${Number(upcomingWeek)}\\b`,
      'i'
    ).test(combined);

  const isSeasonEndingAcute =
    /\b(miss the rest of the [a-z0-9 ]*(?:season|campaign)|out for the (?:rest of the )?(?:season|year)|season-ending)\b/i.test(
      combined
    );

  const explicitUpcomingWeekOut =
    isSeasonEndingAcute ||
    (!negatedUpcomingWeekOut &&
      Boolean(
        upcomingWeek &&
          new RegExp(
            `\\b(ruled out for week\\s*${Number(upcomingWeek)}|is out for week\\s*${Number(upcomingWeek)}|will miss week\\s*${Number(upcomingWeek)}|already ruled out for week\\s*${Number(upcomingWeek)})\\b`,
            'i'
          ).test(combined)
      ));

  const isSevereInGameMechanism =
    /\b(broken|fracture[d]?|torn|dislocated|carted (?:off|to the locker room)|in an air cast)\b/i.test(
      sanitizedCombinedForAcuteCheck
    );

  const requiresSurgeryOrIrCandidate =
    /\b(requires?\s+surgery|undergo(?:ing)?\s+surgery|scheduled\s+for\s+surgery|candidate\s+for\s+(?:injured\s+reserve|ir\b)|likely\s+headed\s+to\s+(?:injured\s+reserve|ir\b)|expected\s+to\s+land\s+on\s+(?:injured\s+reserve|ir\b))\b/i.test(
      combined
    ) && !/\b(?:doesn['’]?t|does\s+not|will\s+not|won['’]?t|avoided)\s+(?:require\s+|need\s+)?surgery\b/i.test(combined);

  const isMultiWeekAbsence =
    isSevereInGameMechanism ||
    requiresSurgeryOrIrCandidate ||
    /\b(out (?:multiple|several|[2-9]|two|three|four) weeks|miss (?:multiple|several|[2-9]|two|three|four) weeks|expected to miss (?:at least )?(?:[2-9]|two|three|four|several|multiple) weeks|high-ankle sprain.*miss)\b/i.test(
      combined
    );

  let effectiveStatus = 'Questionable';
  if (explicitUpcomingWeekOut) {
    effectiveStatus = 'Out';
  } else if (isMultiWeekAbsence) {
    effectiveStatus = 'Doubtful';
  } else if (statusLower.startsWith('doubtful')) {
    effectiveStatus = 'Questionable';
  } else if (
    statusLower.startsWith('out') ||
    statusLower === 'inactive' ||
    statusLower.startsWith('questionable') ||
    statusLower === 'day-to-day' ||
    Boolean(injClean)
  ) {
    effectiveStatus = 'Questionable';
  }

  const playedAndHurtInGameProse =
    /\b(questionable to return|doubtful to return|ruled out for the (?:rest|remainder)|out for the (?:rest|remainder) of (?:the |sunday'?s |monday'?s |thursday'?s |saturday'?s )?(?:game|contest|matchup)|sustained his injury during|injured his [a-z -]+ in the (?:first|second|third|fourth|1st|2nd|3rd|4th) (?:quarter|half))\b/i.test(
      sanitizedCombinedForAcuteCheck
    );

  const missedPriorGame =
    playedInCompletedGame === true || playedAndHurtInGameProse
      ? false
      : playedInCompletedGame === false ||
        statusLower === 'out' ||
        statusLower === 'inactive' ||
        hasMissedPriorGameProse;

  const missedPriorGameKnown =
    playedInCompletedGame === true ||
    playedInCompletedGame === false ||
    playedAndHurtInGameProse ||
    statusLower === 'out' ||
    statusLower === 'inactive' ||
    hasMissedPriorGameProse;

  const sustainedInLastGame =
    !missedPriorGame && (Boolean(hasPostKickoffInjurySignal) || playedAndHurtInGameProse || hasAcuteCompletedGameInjuryInProse);

  const exitedWithoutReturn =
    !missedPriorGame &&
    /\b(ruled out for the (?:rest|remainder)|out for the (?:rest|remainder) of|did(?:n['’]?t|\s+not)\s+return|will not return|won['’]?t return|(?:left|exited)\s+(?:[\w' -]{0,32}\s+)?with\s+(?:a|an|the(?:\s+same)?)\s+[a-z -]{3,28})\b/i.test(
      `${sanitizedCombinedForAcuteCheck} ${postKickoffInjuryNote || ''}`
    );

  let priorWeekPracticed = null;
  if (missedPriorGame) {
    if (/\b(trio of limited practices|limited practices during the week|limited all week|practiced on a limited basis)\b/i.test(combined)) {
      priorWeekPracticed = true;
    } else if (
      /\b(hasn't been able to practice|has not been able to practice|trio of '?dnps?'?|logging '?dnps?'? last week|did not practice all week|not practicing in any capacity|hasn't practiced|has not practiced|without practicing)\b/i.test(
        combined
      )
    ) {
      priorWeekPracticed = false;
    }
  }

  const hasStalePregameClearance =
    /\b(is active for (?:sunday|monday|thursday|saturday)|given the green light to play|cleared by medical staff to play)\b/i.test(
      combined
    );
  let beatNoteForModel =
    hasPostKickoffInjurySignal && postKickoffInjuryNote && (hasStalePregameClearance || !combined)
      ? String(postKickoffInjuryNote).trim()
      : combined;
  if (effectiveStatus !== 'Out') {
    // Strip prior-game availability & in-game remainder rulings so computePlayerPlayProbability models Week N+1 severity rather than clamping to 0%
    beatNoteForModel = beatNoteForModel
      .replace(
        /\b(ruled out for the (?:rest|remainder) of [^.;,]*|out for the (?:rest|remainder) of (?:the |sunday'?s |monday'?s |thursday'?s |saturday'?s )?(?:game|contest|matchup)|will not return[^.;,]*|won'?t return[^.;,]*|done for the (?:day|night|game)|is inactive|was inactive|officially inactive|ruled out|will not play|won't play|is out for|will miss (?:his |a )?[a-z0-9 -]*(?:game|contest|matchup|tilt|clash)|missing (?:a |his )?[a-z0-9 -]*(?:game|contest|matchup|tilt|clash)|miss(?:ing)? (?:sunday|monday|thursday|saturday)'?s?|inactive (?:sunday|monday|thursday|saturday)|inactive for (?:sunday|monday|thursday|saturday))\b/gi,
        missedPriorGame ? 'sidelined previously' : 'exited previous game'
      )
      .replace(/^inactive\.?$/i, '');
  }

  return {
    skip: false,
    effectiveStatus,
    beatNoteForModel,
    missedPriorGame,
    missedPriorGameKnown,
    priorWeekPracticed,
    sustainedInLastGame,
    exitedWithoutReturn
  };
}

/**
 * Rolls a completed week's practice/injury report forward to the upcoming week (`Week X+1`):
 *  - Sets `wed / thu / fri` to blank (`'-'`) before Wednesday practice
 *  - Drops cleared (`Full Go` / `Active` with no injury designation), `Coach's Decision`, and `NIR - Rest` rows
 *  - Keeps ongoing + newly sustained in-game injuries and recalculates play likelihood for the upcoming week
 */
export function rolloverPracticeReportForUpcomingWeek(
  rows = [],
  { clearPracticeDays = true, upcomingWeek = null } = {}
) {
  if (!Array.isArray(rows)) return [];
  const nextRows = [];

  for (const r of rows) {
    const statusLower = String(r?.gameStatus || '').toLowerCase();
    if (r?.wed === 'Vet Rest') continue;

    const sustainedInGame = Boolean(r?.sustainedInLastGame || r?.isInGameInjury || r?.isInGameReturned);
    const earlyRoll = resolveEarlyWeekRolloverInput({
      playerName: r?.name || '',
      rawStatus: r?.gameStatus || '',
      injuryType: r?.injuryType || '',
      shortComment: r?.shortComment || '',
      longComment: r?.beatNote || r?.beatComment || r?.longComment || '',
      upcomingWeek,
      hasPostKickoffInjurySignal: sustainedInGame
    });
    if (earlyRoll.skip) continue;

    // Drop players who were completely cleared with no active injury status from the completed week
    const hasOngoingDesignation =
      statusLower.startsWith('out') ||
      statusLower === 'inactive' ||
      statusLower.startsWith('doubtful') ||
      statusLower.startsWith('questionable') ||
      statusLower === 'day-to-day' ||
      Boolean(r?.isIrReturnQuestionable) ||
      sustainedInGame;

    if (!hasOngoingDesignation) continue;

    const priorCodes = [r?.wed, r?.thu, r?.fri].filter(Boolean);
    const rowHadPriorPractice = priorCodes.some(c => c === 'LP' || c === 'FP');
    const rowWasAllDnp = priorCodes.length === 3 && priorCodes.every(c => c === 'DNP');
    const resolvedPriorPracticed = rowHadPriorPractice
      ? true
      : rowWasAllDnp && earlyRoll.priorWeekPracticed === null
        ? false
        : earlyRoll.priorWeekPracticed;

    const wed = clearPracticeDays ? '-' : r.wed || '-';
    const thu = clearPracticeDays ? '-' : r.thu || '-';
    const fri = clearPracticeDays ? '-' : r.fri || '-';
    const cleanStatus = clearPracticeDays
      ? earlyRoll.effectiveStatus
      : statusLower === 'inactive' || statusLower.includes('in-game') || statusLower.includes('to return')
        ? 'Questionable'
        : r.gameStatus || 'Questionable';

    const prob = computePlayerPlayProbability({
      name: r.name,
      position: r.position,
      experienceYears: r.experienceYears ?? null,
      snapPct: r.snapPct ?? null,
      gameStatus: cleanStatus,
      priorWeekStatus: r.gameStatus || '',
      missedPriorGame: clearPracticeDays
        ? earlyRoll.missedPriorGameKnown
          ? earlyRoll.missedPriorGame
          : undefined
        : false,
      priorWeekPracticed: clearPracticeDays ? resolvedPriorPracticed : null,
      sustainedInLastGame: earlyRoll.missedPriorGame ? false : sustainedInGame || Boolean(earlyRoll.sustainedInLastGame),
      exitedPriorGameWithoutReturn: earlyRoll.missedPriorGame
        ? false
        : Boolean(earlyRoll.exitedWithoutReturn || r?.exitedPriorGameWithoutReturn),
      rosterBucket: r.isIrReturnQuestionable ? 'ir' : 'active',
      isIrReturnQuestionable: Boolean(r.isIrReturnQuestionable),
      injuryType: r.injuryType || '',
      wed,
      thu,
      fri,
      beatNote: clearPracticeDays ? earlyRoll.beatNoteForModel : r.beatNote || r.beatComment || ''
    });

    const {
      isInGameInjury: _dropInGame,
      isInGameReturned: _dropReturned,
      inGameLatestItem: _dropLatestItem,
      preGameStatus: _dropPreGame,
      ...cleanRest
    } = r;

    nextRows.push({
      ...cleanRest,
      sustainedInLastGame: sustainedInGame,
      wed,
      thu,
      fri,
      gameStatus: cleanStatus,
      playProbabilityPct: prob.probabilityPct,
      tier: prob.tier,
      playTier: prob.tier,
      badgeLabel: prob.badgeLabel,
      playBadgeLabel: prob.badgeLabel,
      factors: prob.factors
    });
  }

  return nextRows.sort((a, b) => a.playProbabilityPct - b.playProbabilityPct || (b.snapPct || 0) - (a.snapPct || 0));
}

function stripBasicHtml(html = '') {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts a structured, high-signal Completed Game Box Score & Recap Dossier directly from
 * ESPN's `site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=<id>` payload.
 * Ensures post-game AI & deterministic Top News Briefs always have macro team yardage,
 * scrimmage leaders (combining rushing + receiving), QB passing precision/sacks, defensive
 * takeaways vs. yards/4th-downs/4Q points allowed, penalties, and in-game injury exits.
 */
export function extractCompletedGameRecapSummary(summaryJson, gameMeta = {}) {
  if (!summaryJson || typeof summaryJson !== 'object') return null;

  const activeTeam = resolveTeamConfig(gameMeta?.teamAbbr || getActiveTeamConfig());
  const targetAbbr = activeTeam.abbr;
  const comp = summaryJson.header?.competitions?.[0] || {};
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const sfComp = competitors.find(
    c => normalizeCanonicalTeamAbbr(c?.team?.abbreviation || '') === targetAbbr
  );
  const oppComp = competitors.find(
    c => normalizeCanonicalTeamAbbr(c?.team?.abbreviation || '') !== targetAbbr
  );

  const gameId = String(gameMeta?.id || comp?.id || summaryJson.header?.id || '').trim();
  const week = Number(gameMeta?.week || summaryJson.header?.week || 0) || null;
  const dateIso = gameMeta?.dateIso || comp?.date || null;
  const homeAway = sfComp?.homeAway || gameMeta?.homeAway || 'away';
  const sfScore =
    sfComp?.score != null
      ? Number(sfComp.score)
      : gameMeta?.sfScore != null
        ? Number(gameMeta.sfScore)
        : null;
  const oppScore =
    oppComp?.score != null
      ? Number(oppComp.score)
      : gameMeta?.oppScore != null
        ? Number(gameMeta.oppScore)
        : null;
  const result =
    gameMeta?.result ||
    (sfScore != null && oppScore != null
      ? sfScore > oppScore
        ? 'W'
        : sfScore < oppScore
          ? 'L'
          : 'T'
      : '');
  const oppAbbr = normalizeCanonicalTeamAbbr(
    oppComp?.team?.abbreviation || gameMeta?.opponent?.abbr || ''
  );
  const oppName =
    oppComp?.team?.displayName ||
    gameMeta?.opponent?.name ||
    oppComp?.team?.name ||
    oppAbbr ||
    'Opponent';

  const sfLinescores = (sfComp?.linescores || []).map(l => Number(l?.displayValue ?? l?.value ?? 0));
  const oppLinescores = (oppComp?.linescores || []).map(l => Number(l?.displayValue ?? l?.value ?? 0));
  const sfFourthQuarterPts = sfLinescores.length >= 4 ? sfLinescores[3] : null;
  const oppFourthQuarterPts = oppLinescores.length >= 4 ? oppLinescores[3] : null;

  const parseTeamBoxStats = teamAbbrTarget => {
    const teamEntry = (summaryJson.boxscore?.teams || []).find(t => {
      const ab = normalizeCanonicalTeamAbbr(t?.team?.abbreviation || '');
      return teamAbbrTarget === targetAbbr ? ab === targetAbbr : ab !== targetAbbr;
    });
    if (!teamEntry || !Array.isArray(teamEntry.statistics)) return null;
    const map = {};
    for (const s of teamEntry.statistics) {
      if (s?.name) map[s.name] = String(s.displayValue ?? '');
    }
    const sacksParts = String(map.sacksYardsLost || '').split('-');
    const penParts = String(map.totalPenaltiesYards || '').split('-');
    return {
      totalYards: Number(map.totalYards) || 0,
      yardsPerPlay: map.yardsPerPlay || '',
      netPassingYards: Number(map.netPassingYards) || 0,
      completionAttempts: map.completionAttempts || '',
      rushingYards: Number(map.rushingYards) || 0,
      rushingAttempts: Number(map.rushingAttempts) || 0,
      yardsPerRush: map.yardsPerRushAttempt || '',
      firstDowns: Number(map.firstDowns) || 0,
      thirdDownEff: map.thirdDownEff || '',
      fourthDownEff: map.fourthDownEff || '',
      redZoneAttempts: map.redZoneAttempts || '',
      sacksYardsLost: map.sacksYardsLost || '0-0',
      sacksTakenCount: Number(sacksParts[0]) || 0,
      penaltiesYards: map.totalPenaltiesYards || '0-0',
      penaltyCount: Number(penParts[0]) || 0,
      penaltyYards: Number(penParts[1]) || 0,
      turnovers: Number(map.turnovers) || 0,
      interceptions: Number(map.interceptions) || 0,
      fumblesLost: Number(map.fumblesLost) || 0,
      possessionTime: map.possessionTime || ''
    };
  };

  const sfTeamStats = parseTeamBoxStats(targetAbbr);
  const oppTeamStats = parseTeamBoxStats('OPP');

  const getPlayerGroup = (isSf, groupName) => {
    const teamBox = (summaryJson.boxscore?.players || []).find(p => {
      const ab = normalizeCanonicalTeamAbbr(p?.team?.abbreviation || '');
      return isSf ? ab === targetAbbr : ab !== targetAbbr;
    });
    return (teamBox?.statistics || []).find(g => g?.name === groupName) || null;
  };

  // 1. SF Passing Leaders
  const sfPassGrp = getPlayerGroup(true, 'passing');
  const sfPassing = (sfPassGrp?.athletes || []).slice(0, 2).map(a => {
    const st = a?.stats || [];
    const sacksRaw = String(st[5] || '0-0');
    return {
      id: String(a?.athlete?.id || ''),
      name: a?.athlete?.displayName || '',
      compAtt: st[0] || '',
      yards: Number(st[1]) || 0,
      avg: st[2] || '',
      tds: Number(st[3]) || 0,
      ints: Number(st[4]) || 0,
      sacksRaw,
      sacksTaken: Number(sacksRaw.split('-')[0]) || 0,
      qbr: st[6] || '',
      rating: st[7] || ''
    };
  });

  // 2. SF Scrimmage Leaders (merging Rushing + Receiving so dual-threat games like CMC 62 rush + 161 rec = 223 yds, 3 TDs shine)
  const scrimMap = new Map();
  const ensureScrim = ath => {
    const key = String(ath?.id || ath?.displayName || '').trim();
    if (!key) return null;
    if (!scrimMap.has(key)) {
      scrimMap.set(key, {
        id: String(ath?.id || ''),
        name: ath?.displayName || '',
        rushCarries: 0,
        rushYards: 0,
        rushTds: 0,
        rushLong: 0,
        receptions: 0,
        recYards: 0,
        recTds: 0,
        recLong: 0,
        targets: 0
      });
    }
    return scrimMap.get(key);
  };

  for (const a of getPlayerGroup(true, 'rushing')?.athletes || []) {
    const rec = ensureScrim(a?.athlete);
    if (!rec) continue;
    const st = a?.stats || [];
    rec.rushCarries = Number(st[0]) || 0;
    rec.rushYards = Number(st[1]) || 0;
    rec.rushTds = Number(st[3]) || 0;
    rec.rushLong = Number(st[4]) || 0;
  }
  for (const a of getPlayerGroup(true, 'receiving')?.athletes || []) {
    const rec = ensureScrim(a?.athlete);
    if (!rec) continue;
    const st = a?.stats || [];
    rec.receptions = Number(st[0]) || 0;
    rec.recYards = Number(st[1]) || 0;
    rec.recTds = Number(st[3]) || 0;
    rec.recLong = Number(st[4]) || 0;
    rec.targets = Number(st[5]) || 0;
  }

  const sfPasserIds = new Set(sfPassing.map(p => p.id).filter(Boolean));
  const sfScrimmageLeaders = [...scrimMap.values()]
    .filter(p => !sfPasserIds.has(p.id) && (p.rushYards + p.recYards >= 20 || p.rushTds + p.recTds > 0))
    .map(p => ({
      ...p,
      scrimmageYards: p.rushYards + p.recYards,
      totalTds: p.rushTds + p.recTds
    }))
    .sort((a, b) => b.totalTds * 45 + b.scrimmageYards - (a.totalTds * 45 + a.scrimmageYards))
    .slice(0, 7);

  // 3. SF Defense & Takeaway Highlights
  const sfDefAthletes = (getPlayerGroup(true, 'defensive')?.athletes || []).map(a => {
    const st = a?.stats || [];
    return {
      id: String(a?.athlete?.id || ''),
      name: a?.athlete?.displayName || '',
      tackles: Number(st[0]) || 0,
      solo: Number(st[1]) || 0,
      sacks: Number(st[2]) || 0,
      tfl: Number(st[3]) || 0,
      passDefended: Number(st[4]) || 0,
      qbHits: Number(st[5]) || 0,
      tds: Number(st[6]) || 0
    };
  });
  const sfInterceptions = (getPlayerGroup(true, 'interceptions')?.athletes || [])
    .map(a => {
      const st = a?.stats || [];
      return {
        name: a?.athlete?.displayName || '',
        ints: Number(st[0]) || 0,
        yards: Number(st[1]) || 0,
        tds: Number(st[2]) || 0
      };
    })
    .filter(x => x.ints > 0);
  const sfDefensiveFumbleRecoveries = (getPlayerGroup(true, 'fumbles')?.athletes || [])
    .map(a => {
      const st = a?.stats || [];
      return {
        name: a?.athlete?.displayName || '',
        fumbles: Number(st[0]) || 0,
        lost: Number(st[1]) || 0,
        recovered: Number(st[2]) || 0
      };
    })
    .filter(x => x.recovered > 0 && x.fumbles === 0);

  // 4. Opponent Key Stats (to verify rush TDs, pass TDs, top WR/QB)
  const oppPassTop = (getPlayerGroup(false, 'passing')?.athletes || [])[0];
  const oppRushAthletes = getPlayerGroup(false, 'rushing')?.athletes || [];
  const oppRushTdsAllowed = oppRushAthletes.reduce((sum, a) => sum + (Number(a?.stats?.[3]) || 0), 0);
  const oppPassAthletes = getPlayerGroup(false, 'passing')?.athletes || [];
  const oppPassTdsAllowed = oppPassAthletes.reduce((sum, a) => sum + (Number(a?.stats?.[3]) || 0), 0);
  const oppTopReceivers = (getPlayerGroup(false, 'receiving')?.athletes || []).slice(0, 2).map(a => {
    const st = a?.stats || [];
    return {
      name: a?.athlete?.displayName || '',
      receptions: Number(st[0]) || 0,
      yards: Number(st[1]) || 0,
      tds: Number(st[3]) || 0
    };
  });

  // 5. Key Team Touchdown / Scoring Plays (for exact distances)
  const activeRecapTeam = resolveTeamConfig(gameMeta?.teamAbbr || getActiveTeamConfig());
  const sfScoringPlays = (summaryJson.scoringPlays || [])
    .filter(sp => normalizeCanonicalTeamAbbr(sp?.team?.abbreviation || '') === activeRecapTeam.abbr)
    .map(sp => ({
      quarter: Number(sp?.period?.number) || null,
      clock: sp?.clock?.displayValue || '',
      text: String(sp?.text || '').trim(),
      awayScore: sp?.awayScore ?? null,
      homeScore: sp?.homeScore ?? null
    }));

  // 6. Official AP/ESPN Recap Story, Milestones & In-Game Injury Notes
  const recapHeadline = String(summaryJson.article?.headline || '').trim();
  const rawStoryClean = stripBasicHtml(summaryJson.article?.story || '');
  const recapUrl =
    summaryJson.article?.links?.web?.href ||
    (gameId ? `https://www.espn.com/nfl/recap/_/gameId/${encodeURIComponent(gameId)}` : gameMeta?.gameUrl || '');

  const activeRecapNickEsc = String(activeRecapTeam?.nickname || '49ers').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let inGameInjuryNotes = '';
  const injIdx = rawStoryClean.search(new RegExp(`\\bInjuries\\s+${activeRecapNickEsc}\\s*:`, 'i'));
  if (injIdx >= 0) {
    const tail = rawStoryClean.slice(injIdx, injIdx + 520);
    const upNextIdx = tail.search(/\bUp next\b/i);
    inGameInjuryNotes = (upNextIdx > 0 ? tail.slice(0, upNextIdx) : tail).trim();
  }

  let upNextNotes = '';
  const upIdx = rawStoryClean.search(new RegExp(`\\bUp next\\s+${activeRecapNickEsc}\\s*:`, 'i'));
  if (upIdx >= 0) {
    upNextNotes = rawStoryClean.slice(upIdx, upIdx + 240).replace(/\s*-{3,}[\s\S]*$/, '').trim();
  }

  const storySentences = rawStoryClean.match(/[^.!?]+[.!?]+(?:\s+|$)/g) || [];
  const leadExcerpt = storySentences.slice(0, 4).join(' ').trim();
  const milestoneSentences = storySentences
    .slice(4)
    .filter(s =>
      /\b(franchise history|ever allowed|career[- ](?:high|best)|returned after missing|deadline|debut|traded)\b/i.test(
        s
      )
    )
    .slice(0, 4)
    .join(' ')
    .trim();

  return {
    gameId,
    week,
    dateIso,
    homeAway,
    teamAbbr: activeRecapTeam?.abbr || targetAbbr || 'SF',
    teamFullName: activeRecapTeam?.fullName || 'San Francisco 49ers',
    teamNickname: activeRecapTeam?.nickname || '49ers',
    sfScore,
    oppScore,
    result,
    oppAbbr,
    oppName,
    recapUrl,
    recapHeadline,
    recapLeadExcerpt: [leadExcerpt, milestoneSentences].filter(Boolean).join(' ').slice(0, 1200),
    inGameInjuryNotes,
    upNextNotes,
    sfLinescores,
    oppLinescores,
    sfFourthQuarterPts,
    oppFourthQuarterPts,
    sfTeamStats,
    oppTeamStats: oppTeamStats
      ? {
          ...oppTeamStats,
          rushingTds: oppRushTdsAllowed,
          passingTds: oppPassTdsAllowed
        }
      : null,
    sfPassing,
    sfScrimmageLeaders,
    sfDefense: {
      sacksRecorded: oppTeamStats?.sacksTakenCount ?? sfDefAthletes.reduce((s, d) => s + d.sacks, 0),
      takeawaysForced: oppTeamStats?.turnovers ?? sfInterceptions.length + sfDefensiveFumbleRecoveries.length,
      interceptions: sfInterceptions,
      fumbleRecoveries: sfDefensiveFumbleRecoveries,
      passBreakupLeaders: sfDefAthletes.filter(d => d.passDefended >= 2).slice(0, 3),
      tackleLeaders: sfDefAthletes.slice(0, 4)
    },
    oppLeaders: {
      passer: oppPassTop
        ? {
            name: oppPassTop.athlete?.displayName || '',
            compAtt: oppPassTop.stats?.[0] || '',
            yards: Number(oppPassTop.stats?.[1]) || 0,
            tds: Number(oppPassTop.stats?.[3]) || 0,
            ints: Number(oppPassTop.stats?.[4]) || 0
          }
        : null,
      receivers: oppTopReceivers
    },
    sfScoringPlays
  };
}

/**
 * Formats `lastCompletedGameRecap` into a concise, LLM-ready ground-truth block so Gemini
 * sees the complete macro team & player picture alongside beat tweets/articles.
 */
export function formatCompletedGameRecapForPrompt(recap, teamInput = null) {
  if (!recap || typeof recap !== 'object') return '';
  const team = resolveTeamConfig(teamInput || recap.teamAbbr || getActiveTeamConfig());
  const teamFull = team?.fullName || 'San Francisco 49ers';
  const teamAbbr = team?.abbr || 'SF';
  const teamNick = team?.nickname || '49ers';
  const teamNickUp = teamNick.toUpperCase();
  const lines = [];
  const loc = recap.homeAway === 'away' ? 'at' : 'vs.';
  lines.push(
    `FINAL SCORE: Week ${recap.week || ''} — ${teamFull} ${recap.sfScore}, ${recap.oppName} ${recap.oppScore} (${recap.result || 'Final'}, ${loc} ${recap.oppName})`
  );
  if (recap.sfLinescores?.length && recap.oppLinescores?.length) {
    lines.push(
      `QUARTER SCORING: ${teamAbbr} [${recap.sfLinescores.join('-')}] vs. ${recap.oppAbbr || 'OPP'} [${recap.oppLinescores.join('-')}]${
        recap.oppFourthQuarterPts != null ? ` (${recap.oppAbbr || 'OPP'} scored ${recap.oppFourthQuarterPts} pts in 4Q)` : ''
      }`
    );
  }
  if (recap.sfTeamStats) {
    const s = recap.sfTeamStats;
    lines.push(
      `${teamNickUp} TEAM OFFENSE & DISCIPLINE: ${s.totalYards} total yards (${s.yardsPerPlay} yds/play) | ${s.netPassingYards} net pass yds (${s.completionAttempts}) | ${s.rushingYards} rush yds on ${s.rushingAttempts} carries (${s.yardsPerRush} YPC) | 3rd Down ${s.thirdDownEff} | Sacks Allowed: ${s.sacksTakenCount} (${s.sacksYardsLost}) | Turnovers Committed: ${s.turnovers} | Penalties: ${s.penaltyCount} for ${s.penaltyYards} yds | TOP: ${s.possessionTime}`
    );
  }
  if (recap.oppTeamStats) {
    const o = recap.oppTeamStats;
    lines.push(
      `${teamNickUp} DEFENSE (ALLOWED TO ${recap.oppAbbr || 'OPP'}): ${o.totalYards} total yds (${o.yardsPerPlay} yds/play) | Pass Defense Yielded: ${o.netPassingYards} net pass yds (${o.completionAttempts}) & ${o.passingTds ?? '?'} pass TDs | Run Defense Allowed: ${o.rushingYards} rush yds on ${o.rushingAttempts} carries (${o.yardsPerRush} YPC) & ${o.rushingTds ?? 0} rush TDs | 3rd Down ${o.thirdDownEff} | 4th Down Conversions Allowed: ${o.fourthDownEff} | ${teamNick} Sacks Recorded: ${recap.sfDefense?.sacksRecorded ?? o.sacksTakenCount} | Takeaways Forced: ${o.turnovers} (${o.interceptions} INT, ${o.fumblesLost} FR)`
    );
  }
  if (recap.sfPassing?.length) {
    const p = recap.sfPassing[0];
    lines.push(
      `${teamNickUp} PASSING: ${p.name} — ${p.compAtt}, ${p.yards} pass yds, ${p.tds} TD, ${p.ints} INT, ${p.rating} passer rating (${p.qbr} QBR), sacked ${p.sacksTaken} times`
    );
  }
  if (recap.sfScrimmageLeaders?.length) {
    const scrimTxt = recap.sfScrimmageLeaders
      .map(p => {
        const parts = [];
        if (p.rushCarries > 0) {
          parts.push(
            `${p.rushCarries} car, ${p.rushYards} rush yds${p.rushTds ? `, ${p.rushTds} rush TD` : ''}${p.rushLong >= 20 ? ` (long ${p.rushLong})` : ''}`
          );
        }
        if (p.receptions > 0 || p.targets > 0) {
          parts.push(
            `${p.receptions} rec, ${p.recYards} rec yds${p.recTds ? `, ${p.recTds} rec TD` : ''}${p.recLong >= 20 ? ` (long ${p.recLong})` : ''} on ${p.targets} tgts`
          );
        }
        return `${p.name}: ${p.scrimmageYards} scrimmage yds, ${p.totalTds} total TD (${parts.join('; ')})`;
      })
      .join(' | ');
    lines.push(`${teamNickUp} SCRIMMAGE & RECEIVING LEADERS: ${scrimTxt}`);
  }
  if (recap.sfDefense) {
    const d = recap.sfDefense;
    const defBits = [];
    if (d.interceptions?.length) {
      defBits.push(`INTs: ${d.interceptions.map(i => `${i.name} (${i.ints})`).join(', ')}`);
    }
    if (d.fumbleRecoveries?.length) {
      defBits.push(`Fumble Recoveries: ${d.fumbleRecoveries.map(f => `${f.name} (${f.recovered})`).join(', ')}`);
    }
    if (d.passBreakupLeaders?.length) {
      defBits.push(`Pass Breakups: ${d.passBreakupLeaders.map(b => `${b.name} (${b.passDefended} PD, ${b.tackles} tkl)`).join(', ')}`);
    }
    if (d.tackleLeaders?.length) {
      defBits.push(
        `Top Tacklers: ${d.tackleLeaders.map(t => `${t.name} (${t.tackles} tkl${t.sacks ? `, ${t.sacks} sk` : ''}${t.qbHits ? `, ${t.qbHits} QBH` : ''})`).join(', ')}`
      );
    }
    if (defBits.length) lines.push(`${teamNickUp} DEFENSIVE STANDOUTS: ${defBits.join(' | ')}`);
  }
  if (recap.sfScoringPlays?.length) {
    lines.push(
      `${teamNickUp} SCORING PLAYS: ${recap.sfScoringPlays.map(sp => `Q${sp.quarter} ${sp.text}`).join(' | ')}`
    );
  }
  if (recap.inGameInjuryNotes) {
    lines.push(`IN-GAME INJURY LOG: ${recap.inGameInjuryNotes}`);
  }
  if (recap.recapLeadExcerpt) {
    lines.push(`AP/ESPN GAME RECAP CONTEXT: ${recap.recapLeadExcerpt}`);
  }
  return lines.join('\n');
}
