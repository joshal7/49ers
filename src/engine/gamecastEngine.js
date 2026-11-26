/**
 * Deterministic Gamecast Engine (Box Score, Single-Game Team Stats, Play-by-Play & Field Geometry)
 *
 * Pure, synchronous browser-side parser (<5ms) over ESPN's `summary?event=<gameId>` and
 * ultra-lightweight `sports.core.api.espn.com/.../situation` feeds.
 * Supports live games, overtime, preseason/regular/postseason historical games,
 * multi-team NFL Hub configurations, and offline schedule fallbacks.
 */

import { getActiveTeamConfig, resolveTeamConfig } from '../config/teamRegistry.js';
import { resolveCompleteScheduleModel } from './seasonStateMachine.js';
import { normalizeCanonicalTeamAbbr } from './gameDayRosterEngine.js';
import {
  buildEspnTeamLogoUrl,
  isAllowedInlineVideoStreamUrl,
  sanitizeExternalUrl
} from './linkIntegrity.js';

export const GAMECAST_BOX_CATEGORY_ORDER = [
  { key: 'passing', label: 'Passing', unit: 'offense', defaultLabels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'QBR', 'RTG'] },
  { key: 'rushing', label: 'Rushing', unit: 'offense', defaultLabels: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'] },
  { key: 'receiving', label: 'Receiving', unit: 'offense', defaultLabels: ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'] },
  { key: 'fumbles', label: 'Fumbles', unit: 'offense', defaultLabels: ['FUM', 'LOST', 'REC'] },
  { key: 'defensive', label: 'Defense', unit: 'defense', defaultLabels: ['TOT', 'SOLO', 'SACKS', 'TFL', 'PD', 'QB HTS', 'TD'] },
  { key: 'interceptions', label: 'Interceptions', unit: 'defense', defaultLabels: ['INT', 'YDS', 'TD'] },
  { key: 'kicking', label: 'Kicking', unit: 'special_teams', defaultLabels: ['FG', 'PCT', 'LONG', 'XP', 'PTS'] },
  { key: 'punting', label: 'Punting', unit: 'special_teams', defaultLabels: ['NO', 'YDS', 'AVG', 'TB', 'In 20', 'LONG'] },
  { key: 'kickReturns', label: 'Kick Returns', unit: 'special_teams', defaultLabels: ['NO', 'YDS', 'AVG', 'LONG', 'TD'] },
  { key: 'puntReturns', label: 'Punt Returns', unit: 'special_teams', defaultLabels: ['NO', 'YDS', 'AVG', 'LONG', 'TD'] }
];

const COMPACT_BOX_COL_MAP = {
  'C/ATT': 'C/A',
  SACKS: 'SCK',
  LONG: 'LNG',
  TGTS: 'TGT',
  'QB HTS': 'QBH',
  'In 20': 'I20'
};

const TEAM_COLOR_FALLBACKS = {
  SF: '#AA0000',
  ARI: '#97233F',
  ATL: '#A71930',
  BAL: '#241773',
  BUF: '#00338D',
  CAR: '#0085CA',
  CHI: '#0B162A',
  CIN: '#FB4F14',
  CLE: '#311D00',
  DAL: '#041E42',
  DEN: '#FB4F14',
  DET: '#0076B6',
  GB: '#203731',
  HOU: '#03202F',
  IND: '#002C5F',
  JAX: '#006778',
  KC: '#E31837',
  LV: '#1A1A1A',
  LAC: '#0080C6',
  LAR: '#003594',
  MIA: '#008E97',
  MIN: '#4F2683',
  NE: '#002244',
  NO: '#101820',
  NYG: '#0B2265',
  NYJ: '#125740',
  PHI: '#004C54',
  PIT: '#101820',
  SEA: '#002244',
  TB: '#A71930',
  TEN: '#0C2340',
  WSH: '#5A1414'
};

export function sanitizeTeamHexColor(rawHex, abbr = '') {
  const clean = String(rawHex || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    // Avoid near-white endzone backgrounds that hide white text
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma < 210) return `#${clean.toUpperCase()}`;
  }
  const key = normalizeCanonicalTeamAbbr(abbr);
  return TEAM_COLOR_FALLBACKS[key] || '#1E293B';
}

export function isNumericEspnGameId(id) {
  return /^\d{6,12}$/.test(String(id || '').trim());
}

/**
 * Returns playable games (chronological PRE -> REG -> POST) that have numeric ESPN IDs,
 * plus the smartest default gameId (Live > Latest Completed > Next Upcoming).
 */
export function resolveGamecastGamesList(appData, mcSimResult = null) {
  const schedModel = resolveCompleteScheduleModel(appData, mcSimResult);
  const allGames = [...(schedModel.previousGames || []), ...(schedModel.upcomingGames || [])];
  const seen = new Set();
  const playable = [];

  for (const g of allGames) {
    if (!g || g.isByeWeek || g.opponent?.isTbd) continue;
    const id = String(g.id || '').trim();
    if (!isNumericEspnGameId(id) || seen.has(id)) continue;
    seen.add(id);
    const st = String(g.statusState || (g.completed ? 'post' : 'pre')).toLowerCase();
    const isLive =
      !g.completed &&
      (st === 'in' ||
        Boolean(g.isLive) ||
        /\b(q1|q2|q3|q4|1st|2nd|3rd|4th|halftime|in progress|ot|overtime)\b/i.test(String(g.statusDetail || '')));
    const seasonType = g.seasonType || 'REG';
    const weekTag =
      seasonType === 'REG'
        ? `WK ${g.week}`
        : g.weekLabel || (seasonType === 'PRE' ? `PRE ${g.preseasonWeek || Math.abs(g.week || 1)}` : 'POST');
    const loc = g.homeAway === 'away' ? '@' : 'vs';
    const oppAbbr = normalizeCanonicalTeamAbbr(g.opponent?.abbr || 'OPP') || 'OPP';
    const scorePart = g.completed && g.sfScore != null && g.oppScore != null
      ? ` (${g.result || ''} ${g.sfScore}-${g.oppScore})`.replace(/\(\s+/, '(')
      : isLive && g.sfScore != null && g.oppScore != null
        ? ` (LIVE ${g.sfScore}-${g.oppScore})`
        : isLive
          ? ' (LIVE)'
          : '';
    playable.push({
      id,
      week: g.week,
      seasonType,
      weekTag,
      oppAbbr,
      oppName: g.opponent?.name || oppAbbr,
      oppLogoUrl: g.oppLogoUrl || g.opponent?.logoUrl || buildEspnTeamLogoUrl(oppAbbr),
      sfLogoUrl: g.sfLogoUrl || null,
      homeAway: g.homeAway || 'home',
      dateIso: g.dateIso || null,
      completed: Boolean(g.completed),
      isLive,
      statusState: isLive ? 'in' : g.completed ? 'post' : 'pre',
      statusDetail: g.statusDetail || (g.completed ? 'Final' : 'Scheduled'),
      sfScore: g.sfScore != null ? Number(g.sfScore) : null,
      oppScore: g.oppScore != null ? Number(g.oppScore) : null,
      result: g.result || null,
      venue: g.venue?.name || '',
      gameUrl: sanitizeExternalUrl(g.gameUrl, `https://www.espn.com/nfl/game/_/gameId/${id}`),
      pickerLabel: `${weekTag} • ${loc} ${oppAbbr}${scorePart}`,
      raw: g
    });
  }

  // Pick smart default: Live game > most recently completed game > next upcoming game
  const liveGame = playable.find(g => g.isLive) || null;
  const completedGames = playable.filter(g => g.completed);
  const latestCompleted = completedGames.length > 0 ? completedGames[completedGames.length - 1] : null;
  const nextUpcoming = playable.find(g => !g.completed) || null;
  const defaultGame = liveGame || latestCompleted || nextUpcoming || null;

  return {
    games: playable,
    liveGame,
    latestCompleted,
    defaultGame,
    defaultGameId: defaultGame?.id || null
  };
}

function parseQuarterLabel(period) {
  const n = Number(period || 0);
  if (!Number.isFinite(n) || n <= 0) return 'Q1';
  if (n <= 4) return `Q${n}`;
  return n === 5 ? 'OT' : `${n - 4}OT`;
}

function parseTeamStatNumber(str) {
  const s = String(str ?? '').trim();
  if (!s) return 0;
  // Time of possession MM:SS -> decimal minutes
  const mmss = s.match(/^(\d{1,2}):(\d{2})$/);
  if (mmss) return Number(mmss[1]) + Number(mmss[2]) / 60;
  // Made/Att or Made-Att ratio -> percentage (or count for penalties/sacks handled separately)
  const frac = s.match(/^(\d+)\s*[-/]\s*(\d+)$/);
  if (frac) {
    const a = Number(frac[1]);
    const b = Number(frac[2]);
    return b > 0 ? (a / b) * 100 : a;
  }
  const num = Number(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(num) ? num : 0;
}

function parseFirstNumInPair(str) {
  const m = String(str ?? '').match(/^(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

function parseSecondNumInPair(str) {
  const m = String(str ?? '').match(/[-/]\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

/**
 * Converts ESPN's `yardsToEndzone` (distance from offense's goal to opponent's goal, 100->0)
 * onto a consistent 0..100 horizontal field axis:
 *   0   = Away Team Endzone (left)
 *   100 = Home Team Endzone (right)
 * Away drives left -> right (toward 100); Home drives right -> left (toward 0).
 */
export function yardsToEndzoneToFieldX(yardsToEndzone, possessionSide = 'away') {
  const yte = Number(yardsToEndzone);
  if (!Number.isFinite(yte)) return 50;
  const clamped = Math.max(0, Math.min(100, yte));
  return possessionSide === 'away' ? 100 - clamped : clamped;
}

/**
 * Parses a possession text like `"MIN 38"` or `"50"` into 0..100 field coordinate
 * (0 = Away EZ, 100 = Home EZ).
 */
export function parseSpotTextToFieldX(spotText, awayAbbr, homeAbbr) {
  const raw = String(spotText || '').trim().toUpperCase();
  if (!raw) return null;
  if (raw === '50' || raw === 'MIDFIELD') return 50;
  const m = raw.match(/^([A-Z]{2,4})\s+(\d{1,2})$/);
  if (!m) return null;
  const sideAbbr = normalizeCanonicalTeamAbbr(m[1]);
  const yd = Math.max(0, Math.min(50, Number(m[2])));
  if (!Number.isFinite(yd)) return null;
  if (sideAbbr === normalizeCanonicalTeamAbbr(awayAbbr)) return yd;
  if (sideAbbr === normalizeCanonicalTeamAbbr(homeAbbr)) return 100 - yd;
  return null;
}

/**
 * Normalizes ESPN spot strings like "LA 18" -> "LAR 18" or "WSH 25" -> "WAS 25"
 * while preserving "50". Returns '' for invalid/empty strings.
 */
export function normalizeSpotTextCanonical(spotText, awayAbbr = '', homeAbbr = '') {
  const raw = String(spotText || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw === '50' || raw === 'MIDFIELD') return '50';
  const m = raw.match(/^([A-Z]{2,4})\s+(\d{1,2})$/);
  if (!m) return '';
  const canon = normalizeCanonicalTeamAbbr(m[1]);
  const yd = Math.max(0, Math.min(50, Number(m[2])));
  if (!Number.isFinite(yd)) return '';
  if (yd === 50) return '50';
  const aCanon = normalizeCanonicalTeamAbbr(awayAbbr);
  const hCanon = normalizeCanonicalTeamAbbr(homeAbbr);
  if (aCanon && hCanon && canon !== aCanon && canon !== hCanon) return '';
  return `${canon} ${yd}`;
}

/**
 * Validates and cleans ESPN down-and-distance strings so corrupt outputs like
 * "& Goal", "0th & Goal", "& 0", or "0 & 10" (common during TV timeouts / kickoff setups)
 * NEVER reach the UI.
 */
export function sanitizeDownDistanceText(raw = '') {
  const clean = String(raw || '').trim();
  if (!clean) return '';
  const downPart = clean.split(/\s+(?:at|•|on)\s+/i)[0].trim();
  const m = downPart.match(/^(1st|2nd|3rd|4th)\s*&\s*(Goal|Inches|[1-9]\d?)$/i);
  if (!m) return '';
  const ord = m[1].toLowerCase();
  const dist = /^goal$/i.test(m[2]) ? 'Goal' : /^inches$/i.test(m[2]) ? 'Inches' : String(Number(m[2]));
  return `${ord} & ${dist}`;
}

export function formatDownAndDistance(down, distance, yardsToEndzone = null) {
  const d = Number(down);
  if (!Number.isInteger(d) || d < 1 || d > 4) return '';
  const ord = d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : '4th';
  const dist = Number(distance);
  const yte = yardsToEndzone != null && Number.isFinite(Number(yardsToEndzone)) ? Number(yardsToEndzone) : null;
  if (yte != null && yte > 0 && yte <= 10 && (!Number.isFinite(dist) || dist <= 0 || dist >= yte)) {
    return `${ord} & Goal`;
  }
  if (Number.isFinite(dist) && dist > 0 && dist <= 99) {
    return `${ord} & ${Math.round(dist)}`;
  }
  return '';
}

function parsePlayTextDestinationSpot(
  text = '',
  awayAbbr = '',
  homeAbbr = '',
  { isKickoff = false, isPunt = false, receivingSide = null } = {}
) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // Explicit or implicit touchback spot
  const tbMatch = raw.match(/\btouchback(?:\s+to\s+(?:the\s+)?([A-Z]{2,4})\s+(\d{1,2}))?/i);
  if (tbMatch) {
    if (tbMatch[1] && tbMatch[2]) {
      const explicitTb = parseSpotTextToFieldX(`${tbMatch[1]} ${tbMatch[2]}`, awayAbbr, homeAbbr);
      if (explicitTb != null) return explicitTb;
    }
    if (isKickoff && receivingSide) return receivingSide === 'away' ? 30 : 70;
    if (isPunt && receivingSide) return receivingSide === 'away' ? 20 : 80;
  }

  // Scan all destination phrases and take the final valid field spot mentioned
  const spotRe =
    /\b(?:to|at|pushed\s+ob\s+at|ran\s+ob\s+at|out\s+of\s+bounds\s+at|downed\s+at|fair\s+catch\b[^.]*?\bat|recovered\s+by\s+[A-Z]{2,4}-[^\s,]+\s+at)\s+(?:the\s+)?([A-Z]{2,4}\s+\d{1,2}|50)\b/gi;
  let lastValid = null;
  let m;
  while ((m = spotRe.exec(raw)) !== null) {
    const parsed = parseSpotTextToFieldX(m[1], awayAbbr, homeAbbr);
    if (parsed != null) lastValid = parsed;
  }
  return lastValid;
}

function resolveKickoffReceivingSide(text = '', driveSide = 'away', endTeamId = '', away = {}, home = {}) {
  const raw = String(text || '');
  // Onside / muffed kickoff explicit recovery wins
  const recMatch = raw.match(/\bRECOVERED\s+by\s+([A-Z]{2,4})-/i);
  if (recMatch) {
    const recAbbr = normalizeCanonicalTeamAbbr(recMatch[1]);
    if (recAbbr === away.abbr) return 'away';
    if (recAbbr === home.abbr) return 'home';
  }
  if (endTeamId) {
    if (endTeamId === away.espnId) return 'away';
    if (endTeamId === home.espnId) return 'home';
  }
  const fromMatch = raw.match(/\bfrom\s+([A-Z]{2,4})\s+\d{1,2}\b/i);
  if (fromMatch) {
    const kickAbbr = normalizeCanonicalTeamAbbr(fromMatch[1]);
    if (kickAbbr === away.abbr) return 'home';
    if (kickAbbr === home.abbr) return 'away';
  }
  return driveSide;
}

function normalizeDriveResultBadge(rawResult = '', isLiveDrive = false) {
  if (isLiveDrive) return { code: 'LIVE', tone: 'live' };
  const s = String(rawResult || '').trim().toUpperCase();
  if (!s) return { code: 'END', tone: 'neutral' };
  if (/TOUCHDOWN|\bTD\b/.test(s)) return { code: 'TD', tone: 'positive' };
  if (/FIELD\s*GOAL|\bFG\b/.test(s) && !/MISS|BLOCK/.test(s)) return { code: 'FG', tone: 'positive' };
  if (/MISS|BLOCK/.test(s)) return { code: 'MISS FG', tone: 'warning' };
  if (/INTERCEPTION|\bINT\b/.test(s)) return { code: 'INT', tone: 'danger' };
  if (/FUMBLE|\bFUM\b/.test(s)) return { code: 'FUM', tone: 'danger' };
  if (/DOWNS/.test(s)) return { code: 'DOWNS', tone: 'warning' };
  if (/SAFETY/.test(s)) return { code: 'SAF', tone: 'warning' };
  if (/PUNT/.test(s)) return { code: 'PUNT', tone: 'neutral' };
  if (/HALF/.test(s)) return { code: 'HALF', tone: 'neutral' };
  if (/END\s+OF\s+GAME|GAME/.test(s)) return { code: 'FINAL', tone: 'neutral' };
  return { code: s.slice(0, 8), tone: 'neutral' };
}

function classifyPlayKind(play = {}) {
  const typeText = String(play?.type?.text || '').toLowerCase();
  const text = String(play?.text || '').toLowerCase();
  const isSack = /\bsack/.test(typeText) || /\bsacked\b/.test(text);
  const isInterception = /\binterception\b/.test(typeText) || /\bintercepted\b/.test(text);
  const isIncomplete =
    !isInterception &&
    !isSack &&
    (/\bincomplete\b/.test(typeText) || /\bpass\s+incomplete\b|\bincomplete\s+(?:short|deep|to)\b/.test(text));
  const isPass =
    /\bpass\b|interception|sack/.test(typeText) ||
    /\bpass\s+(?:short|deep|incomplete|complete|to\b)|sacked\b|intercepted\b/.test(text);
  const isRun =
    !isPass &&
    (/\brush\b|scramble|kneel/.test(typeText) ||
      /\b(up the middle|left guard|right guard|left tackle|right tackle|left end|right end|scrambles|rush|rushed|kneels)\b/.test(
        text
      ));
  const isFumble = /\bfumble/.test(typeText) || /\bfumbles?\b/.test(text);
  const isTurnover =
    isInterception ||
    /\b(fumble\s+recovery\s*\(opponent\)|fumble\s+return)/.test(typeText) ||
    /\bfumbles.*recovered\s+by\b/.test(text);
  const isPenalty = /\bpenalty\b/.test(typeText) || /^penalty\b/.test(text);
  const isFieldGoal = /\bfield\s+goal\b/.test(typeText) || /\bfield\s+goal\b/.test(text);
  const isFieldGoalGood =
    isFieldGoal &&
    (/is\s+good\b/i.test(text) || Boolean(play?.scoringPlay)) &&
    !/\b(?:no\s+good|missed|wide\s+(?:left|right)|short|blocked)\b/i.test(`${typeText} ${text}`);
  const isFieldGoalMissed = isFieldGoal && !isFieldGoalGood;
  const isExtraPoint = /\bextra\s+point\b/.test(typeText) || /\bextra\s+point\b/.test(text);
  const isTwoPoint = /\btwo-point\b/.test(typeText) || /\btwo-point\b/.test(text);
  const isPunt = /\bpunt\b/.test(typeText) || /\bpunts\s+\d+\s+yard/.test(text);
  const isKickoff = /\bkickoff\b/.test(typeText) || /\bkicks\s+\d+\s+yard/.test(text);
  const isTimeout = /\btimeout\b/.test(typeText) || /^timeout\s+#?\d/i.test(text);
  const isAdminStoppage =
    isTimeout ||
    /\b(?:two-minute\s+warning|official\s+timeout|injury\s+timeout|end\s+(?:of\s+)?(?:period|quarter|half|game))\b/i.test(
      `${typeText} ${text}`
    );
  const isKickOrPunt = isFieldGoal || isExtraPoint || isTwoPoint || isPunt || isKickoff;
  const isTouchdown = Boolean(play?.scoringPlay) && /\btouchdown\b/.test(`${typeText} ${text}`);
  const rawTextExact = String(play?.text || '');
  const isSafety =
    !isTouchdown &&
    !isFieldGoal &&
    ((Boolean(play?.scoringPlay) && /\bsafety\b/i.test(`${typeText} ${rawTextExact}`)) ||
      /\bsafety\b/i.test(typeText) ||
      /\b(?:for\s+a|results\s+in\s+a|tackled\s+in\s+(?:the\s+)?end\s+zone\s+for\s+a)\s+safety\b|\bSAFETY\b/.test(
        rawTextExact
      ));
  return {
    isPass,
    isRun,
    isSack,
    isIncomplete,
    isInterception,
    isFumble,
    isTurnover,
    isPenalty,
    isFieldGoal,
    isFieldGoalGood,
    isFieldGoalMissed,
    isExtraPoint,
    isTwoPoint,
    isPunt,
    isKickoff,
    isTimeout,
    isAdminStoppage,
    isKickOrPunt,
    isTouchdown,
    isSafety
  };
}

/**
 * Generates an ESPN-style prominent play headline (e.g. "10-yd Pass", "1-yd Run",
 * "Sack (-7 yds)", "Incomplete Pass", "19-yd Pass TD") + semantic tone.
 */
export function buildPlayHeadline(play = {}, kind = null, yardsInput = null) {
  const k = kind || classifyPlayKind(play);
  const text = String(play?.text || '').trim();
  const typeText = String(play?.type?.text || '').trim();
  const rawYds = yardsInput != null ? Number(yardsInput) : Number(play?.statYardage);
  const yards = Number.isFinite(rawYds) ? rawYds : 0;

  if (k.isTimeout) {
    return { headline: 'Timeout', tone: 'neu' };
  }
  if (/two-minute warning/i.test(`${typeText} ${text}`)) {
    return { headline: 'Two-Minute Warning', tone: 'neu' };
  }
  if (/end (?:of )?(?:period|quarter|half|game)/i.test(`${typeText} ${text}`)) {
    return { headline: typeText || 'End of Quarter', tone: 'neu' };
  }
  if (k.isSack) {
    const sackYds = yards !== 0 ? yards : -Math.abs(Number((text.match(/for\s+-?(\d+)\s+yard/i) || [])[1] || 0));
    return {
      headline: sackYds ? `Sack (${sackYds > 0 ? `-${sackYds}` : sackYds} yds)` : 'Sack',
      tone: 'neg'
    };
  }
  if (k.isInterception) {
    return { headline: k.isTouchdown ? 'Pick-Six TD' : 'Interception', tone: k.isTouchdown ? 'td' : 'neg' };
  }
  if (k.isIncomplete) {
    return { headline: 'Incomplete Pass', tone: 'neu' };
  }
  if (k.isSafety) {
    return { headline: 'Safety', tone: 'td' };
  }
  if (k.isFieldGoal) {
    const fgDist = Number((text.match(/(\d{2})\s+yard\s+field\s+goal/i) || [])[1] || 0) || Math.abs(yards);
    const isGood = /is\s+good\b/i.test(text) || Boolean(play?.scoringPlay);
    const isBlocked = /\bblocked\b/i.test(`${typeText} ${text}`);
    if (isGood) return { headline: fgDist ? `${fgDist}-yd Field Goal` : 'Field Goal Good', tone: 'td' };
    if (isBlocked) return { headline: fgDist ? `Blocked ${fgDist}-yd FG` : 'Blocked FG', tone: 'neg' };
    return { headline: fgDist ? `Missed ${fgDist}-yd FG` : 'Missed Field Goal', tone: 'neg' };
  }
  if (k.isExtraPoint) {
    const isGood = /is\s+good\b/i.test(text) || Boolean(play?.scoringPlay);
    return { headline: isGood ? 'Extra Point Good' : 'Extra Point Missed', tone: isGood ? 'pos' : 'neg' };
  }
  if (k.isTwoPoint) {
    const good = Boolean(play?.scoringPlay) || /succeeds|is good|good\b/i.test(text);
    return { headline: good ? '2-Pt Conversion Good' : '2-Pt Conversion Failed', tone: good ? 'td' : 'neg' };
  }
  if (k.isPunt) {
    const puntYds = Number((text.match(/punts\s+(\d{1,3})\s+yard/i) || [])[1] || 0);
    return { headline: puntYds ? `${puntYds}-yd Punt` : 'Punt', tone: 'neu' };
  }
  if (k.isKickoff) {
    if (/touchback/i.test(text)) return { headline: 'Kickoff (Touchback)', tone: 'neu' };
    return { headline: 'Kickoff', tone: 'neu' };
  }
  if (k.isPenalty) {
    const penYds = Number((text.match(/,\s*(\d{1,2})\s+yard/i) || [])[1] || 0) || Math.abs(yards);
    const declined = /\bdeclined\b/i.test(text);
    if (declined) return { headline: 'Penalty (Declined)', tone: 'neu' };
    return { headline: penYds ? `Penalty (${penYds} yds)` : 'Penalty', tone: 'neg' };
  }
  if (k.isPass) {
    const lbl = `${yards}-yd Pass${k.isTouchdown ? ' TD' : ''}`;
    const tone = k.isTouchdown ? 'td' : k.isTurnover ? 'neg' : yards >= 15 ? 'pos' : yards < 0 ? 'neg' : 'neu';
    return { headline: lbl, tone };
  }
  if (k.isRun) {
    const isKneel = /\bkneel/i.test(`${typeText} ${text}`);
    if (isKneel) return { headline: 'QB Kneel', tone: 'neu' };
    const lbl = `${yards}-yd Run${k.isTouchdown ? ' TD' : ''}`;
    const tone = k.isTouchdown ? 'td' : k.isTurnover ? 'neg' : yards >= 10 ? 'pos' : yards < 0 ? 'neg' : 'neu';
    return { headline: lbl, tone };
  }
  if (k.isFumble) {
    return { headline: k.isTurnover ? 'Fumble Lost' : 'Fumble', tone: 'neg' };
  }
  if (k.isTouchdown) {
    return { headline: yards ? `${yards}-yd Touchdown` : 'Touchdown', tone: 'td' };
  }
  if (typeText) {
    return {
      headline: yards !== 0 ? `${yards}-yd ${typeText}` : typeText,
      tone: yards >= 15 ? 'pos' : yards < 0 ? 'neg' : 'neu'
    };
  }
  return { headline: yards !== 0 ? `${yards}-yd Play` : 'Play', tone: 'neu' };
}

function parseClockSecondsRemaining(clockStr = '', period = 1) {
  const m = String(clockStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  const quarterDurSec = Number(period) >= 5 ? 600 : 900;
  if (!m) return null;
  const secs = Number(m[1]) * 60 + Number(m[2]);
  return Math.max(0, Math.min(quarterDurSec, secs));
}

function computeGameClockProgress01(period = 1, clockStr = '', totalPeriods = 4) {
  const p = Math.max(1, Math.min(totalPeriods, Number(period) || 1));
  const quarterDurSec = p >= 5 ? 600 : 900;
  const rem = parseClockSecondsRemaining(clockStr, p);
  const fracInQuarter = rem != null ? (quarterDurSec - rem) / quarterDurSec : 0.5;
  return Math.max(0, Math.min(1, (p - 1 + fracInQuarter) / totalPeriods));
}

function extractVideoClipEntry(vid) {
  if (!vid || typeof vid !== 'object') return null;
  const mp4Raw =
    vid?.links?.source?.HD?.href ||
    vid?.links?.source?.full?.href ||
    vid?.links?.source?.href ||
    '';
  const mp4Https = mp4Raw.startsWith('http://') ? `https://${mp4Raw.slice(7)}` : mp4Raw;
  const safeMp4 = mp4Https && isAllowedInlineVideoStreamUrl(mp4Https) ? mp4Https : null;
  const safeWeb = sanitizeExternalUrl(vid?.links?.web?.href || '', safeMp4 || null);
  if (!safeMp4 && !safeWeb) return null;
  const poster = sanitizeExternalUrl(vid?.thumbnail || vid?.images?.[0]?.url || '', null);
  return {
    id: String(vid.id || ''),
    headline: String(vid.headline || vid.title || 'Highlight Clip').trim(),
    description: String(vid.description || '').trim(),
    mp4Url: safeMp4,
    webUrl: safeWeb,
    posterUrl: poster
  };
}

function matchVideoClipToPlay(playText, isScoring, isTurnover, clips = [], usedIds = new Set()) {
  if (!clips.length || (!isScoring && !isTurnover)) return null;
  const lowerPlay = String(playText || '').toLowerCase();
  if (!lowerPlay) return null;

  // Extract capitalized surnames (e.g., "G.Kittle", "G. Kittle", "J. Jefferson")
  const surnameMatches = [...String(playText || '').matchAll(/\b[A-Z]\.\s*([A-Z][a-zA-Z'-]{2,})\b/g)].map(m =>
    m[1].toLowerCase()
  );
  const ydsMatch = lowerPlay.match(/\bfor\s+(\d{1,3})\s+yard/);
  const playYds = ydsMatch ? ydsMatch[1] : '';

  let bestClip = null;
  let bestScore = 0;

  for (const clip of clips) {
    if (!clip || (clip.id && usedIds.has(clip.id))) continue;
    const hay = `${clip.headline} ${clip.description}`.toLowerCase();
    let score = 0;
    for (const sn of surnameMatches) {
      if (sn.length >= 4 && hay.includes(sn)) score += 4;
    }
    if (playYds && new RegExp(`\\b${playYds}[\\s-]*(?:yd|yard)`).test(hay)) score += 3;
    if (isScoring && /\b(td|touchdown|scores|field goal|fg)\b/.test(hay)) score += 2;
    if (isTurnover && /\b(int|intercept|pick|fumble|strips|recovers)\b/.test(hay)) score += 2;
    if (score >= 5 && score > bestScore) {
      bestScore = score;
      bestClip = clip;
    }
  }
  if (bestClip && bestClip.id) usedIds.add(bestClip.id);
  return bestClip;
}

function buildCompactWinProbSeries(
  rawWinProb = [],
  teamIsHome = true,
  { playTimingById = null, totalPeriods = 4, isFinal = false, currentPeriod = 1, maxPoints = 72 } = {}
) {
  const empty = {
    teamPct: null,
    oppPct: null,
    teamPctExact: null,
    oppPctExact: null,
    leadingSide: 'tied',
    totalPeriods: Math.max(4, Number(totalPeriods) || 4),
    series: [],
    points: [],
    deltaByPlayId: {}
  };
  if (!Array.isArray(rawWinProb) || rawWinProb.length === 0) return empty;

  const periodsCount = Math.max(4, Number(totalPeriods) || 4);
  const normalized = [];
  const deltaByPlayId = {};
  let prevTeamPct = null;
  let matchedTimingCount = 0;

  for (let i = 0; i < rawWinProb.length; i += 1) {
    const pt = rawWinProb[i];
    const homeWin = Number(pt?.homeWinPercentage);
    if (!Number.isFinite(homeWin)) continue;
    const teamRaw = teamIsHome ? homeWin : 1 - homeWin;
    const teamPctExact = Math.max(0, Math.min(100, teamRaw * 100));
    const playId = pt?.playId != null ? String(pt.playId) : '';
    const timing = playId && playTimingById instanceof Map ? playTimingById.get(playId) : null;
    if (timing) matchedTimingCount += 1;

    normalized.push({
      teamPct: Math.round(teamPctExact * 10) / 10,
      playId,
      x01Raw: timing ? timing.x01 : null,
      period: timing ? timing.period : null
    });

    if (playId && prevTeamPct != null) {
      const diff = teamPctExact - prevTeamPct;
      if (Math.abs(diff) >= 0.4) {
        deltaByPlayId[playId] = `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`;
      }
    }
    prevTeamPct = teamPctExact;
  }

  if (normalized.length === 0) return empty;

  // Assign monotonic X coordinates in [0, 1] across the 4-quarter (or 5-period OT) timeline
  const fallbackSpan = isFinal
    ? 1
    : Math.max(0.08, Math.min(1, ((Number(currentPeriod) || 1) - 0.15) / periodsCount));
  const useRealTiming = matchedTimingCount >= Math.max(2, Math.floor(normalized.length * 0.35));

  let maxSeenX = 0;
  const timedPoints = normalized.map((item, idx) => {
    let x01;
    if (useRealTiming && item.x01Raw != null) {
      x01 = Math.max(maxSeenX, item.x01Raw);
    } else if (useRealTiming) {
      // Interpolate linearly between neighbors when a single playId is unmatched
      const frac = normalized.length > 1 ? idx / (normalized.length - 1) : 0;
      x01 = Math.max(maxSeenX, frac * fallbackSpan);
    } else {
      const frac = normalized.length > 1 ? idx / (normalized.length - 1) : 0;
      x01 = frac * fallbackSpan;
    }
    maxSeenX = Math.min(1, x01);
    return {
      x01: Math.round(maxSeenX * 1000) / 1000,
      teamPct: item.teamPct,
      period: item.period
    };
  });

  if (isFinal && timedPoints.length > 0) {
    timedPoints[timedPoints.length - 1].x01 = 1;
  }
  if (timedPoints.length > 0 && timedPoints[0].x01 > 0.03) {
    timedPoints.unshift({ x01: 0, teamPct: timedPoints[0].teamPct, period: 1 });
  }

  let sampledPoints = timedPoints;
  if (timedPoints.length > maxPoints) {
    sampledPoints = [];
    const step = (timedPoints.length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i += 1) {
      const idx = i === maxPoints - 1 ? timedPoints.length - 1 : Math.round(i * step);
      sampledPoints.push(timedPoints[idx]);
    }
  }

  const latestExact = Math.round(normalized[normalized.length - 1].teamPct * 10) / 10;
  const oppExact = Math.round(Math.max(0, 100 - latestExact) * 10) / 10;
  const latestTeamPct = Math.round(latestExact);
  const leadingSide = latestExact > 50.05 ? 'team' : latestExact < 49.95 ? 'opp' : 'tied';

  return {
    teamPct: latestTeamPct,
    oppPct: Math.max(0, 100 - latestTeamPct),
    teamPctExact: latestExact,
    oppPctExact: oppExact,
    leadingSide,
    totalPeriods: periodsCount,
    series: sampledPoints.map(p => p.teamPct),
    points: sampledPoints,
    deltaByPlayId
  };
}

function parseTeamStatsComparisonGroups(summaryJson, awayAbbr, homeAbbr) {
  const teamsArr = Array.isArray(summaryJson?.boxscore?.teams) ? summaryJson.boxscore.teams : [];
  if (teamsArr.length < 2) return [];

  const getMap = abbr => {
    const entry = teamsArr.find(
      t => normalizeCanonicalTeamAbbr(t?.team?.abbreviation || '') === normalizeCanonicalTeamAbbr(abbr)
    );
    const map = {};
    for (const s of entry?.statistics || []) {
      if (s?.name) map[s.name] = String(s.displayValue ?? '').trim();
    }
    return map;
  };

  const awayMap = getMap(awayAbbr);
  const homeMap = getMap(homeAbbr);
  if (Object.keys(awayMap).length === 0 && Object.keys(homeMap).length === 0) return [];

  const mkRow = (label, key, { lowerBetter = false, pairMode = 'ratio', subFn = null, jargonKey = null, hideIfBothZero = false } = {}) => {
    const aDisp = awayMap[key];
    const hDisp = homeMap[key];
    if ((aDisp == null || aDisp === '') && (hDisp == null || hDisp === '')) return null;
    const aStr = aDisp || '0';
    const hStr = hDisp || '0';
    let aNum = 0;
    let hNum = 0;
    if (pairMode === 'first') {
      aNum = parseFirstNumInPair(aStr);
      hNum = parseFirstNumInPair(hStr);
    } else if (pairMode === 'second') {
      aNum = parseSecondNumInPair(aStr);
      hNum = parseSecondNumInPair(hStr);
    } else {
      aNum = parseTeamStatNumber(aStr);
      hNum = parseTeamStatNumber(hStr);
    }
    if (hideIfBothZero && aNum === 0 && hNum === 0) return null;

    const total = Math.abs(aNum) + Math.abs(hNum);
    let awayPct = 50;
    let homePct = 50;
    if (total > 0) {
      awayPct = Math.max(8, Math.min(92, Math.round((Math.abs(aNum) / total) * 100)));
      homePct = 100 - awayPct;
    }
    const awayLeads = lowerBetter ? aNum < hNum : aNum > hNum;
    const homeLeads = lowerBetter ? hNum < aNum : hNum > aNum;
    const sub = typeof subFn === 'function' ? subFn(awayMap, homeMap) : '';

    return {
      key,
      label,
      jargonKey,
      awayDisplay: aStr,
      homeDisplay: hStr,
      awayNum: aNum,
      homeNum: hNum,
      awayPct,
      homePct,
      awayLeads,
      homeLeads,
      lowerBetter,
      sub
    };
  };

  const firstDownSub = (aM, hM) => {
    const aParts = [
      aM.firstDownsPassing != null ? `Pass ${aM.firstDownsPassing}` : '',
      aM.firstDownsRushing != null ? `Rush ${aM.firstDownsRushing}` : '',
      aM.firstDownsPenalty != null ? `Pen ${aM.firstDownsPenalty}` : ''
    ].filter(Boolean);
    const hParts = [
      hM.firstDownsPassing != null ? `Pass ${hM.firstDownsPassing}` : '',
      hM.firstDownsRushing != null ? `Rush ${hM.firstDownsRushing}` : '',
      hM.firstDownsPenalty != null ? `Pen ${hM.firstDownsPenalty}` : ''
    ].filter(Boolean);
    if (!aParts.length && !hParts.length) return '';
    return `${aParts.join('/')}  •  ${hParts.join('/')}`;
  };

  const turnoverSub = (aM, hM) => {
    const aInt = Number(aM.interceptions || 0);
    const aFum = Number(aM.fumblesLost || 0);
    const hInt = Number(hM.interceptions || 0);
    const hFum = Number(hM.fumblesLost || 0);
    if (aInt + aFum + hInt + hFum === 0) return '';
    return `INT ${aInt} / Fum ${aFum}  •  INT ${hInt} / Fum ${hFum}`;
  };

  const rawGroups = [
    {
      id: 'output',
      title: 'Output & Pace',
      rows: [
        mkRow('Total Yards', 'totalYards'),
        mkRow('Yards / Play', 'yardsPerPlay'),
        mkRow('Total Plays', 'totalOffensivePlays'),
        mkRow('Total Drives', 'totalDrives'),
        mkRow('1st Downs', 'firstDowns', { subFn: firstDownSub })
      ]
    },
    {
      id: 'air_ground',
      title: 'Air vs. Ground',
      rows: [
        mkRow('Passing Yards', 'netPassingYards'),
        mkRow('Comp / Att', 'completionAttempts', { pairMode: 'ratio' }),
        mkRow('Yards / Pass', 'yardsPerPass'),
        mkRow('Sacks – Yds Lost', 'sacksYardsLost', { lowerBetter: true, pairMode: 'first' }),
        mkRow('Rushing Yards', 'rushingYards'),
        mkRow('Rushing Attempts', 'rushingAttempts'),
        mkRow('Yards / Rush', 'yardsPerRushAttempt')
      ]
    },
    {
      id: 'situational',
      title: 'Situational Efficiency',
      rows: [
        mkRow('3rd Down Eff', 'thirdDownEff', { pairMode: 'ratio' }),
        mkRow('4th Down Eff', 'fourthDownEff', { pairMode: 'ratio' }),
        mkRow('Red Zone (TD–Att)', 'redZoneAttempts', { pairMode: 'ratio', jargonKey: 'red_zone' })
      ]
    },
    {
      id: 'discipline',
      title: 'Ball Security & Discipline',
      rows: [
        mkRow('Turnovers', 'turnovers', { lowerBetter: true, subFn: turnoverSub }),
        mkRow('Penalties – Yds', 'totalPenaltiesYards', { lowerBetter: true, pairMode: 'second' }),
        mkRow('Possession Time', 'possessionTime'),
        mkRow('Def / ST TDs', 'defensiveTouchdowns', { hideIfBothZero: true })
      ]
    }
  ];

  return rawGroups
    .map(g => ({ ...g, rows: g.rows.filter(Boolean) }))
    .filter(g => g.rows.length > 0);
}

function parseTeamBoxScoreGroups(summaryJson, targetAbbr) {
  const playersArr = Array.isArray(summaryJson?.boxscore?.players) ? summaryJson.boxscore.players : [];
  const teamBox = playersArr.find(
    p => normalizeCanonicalTeamAbbr(p?.team?.abbreviation || '') === normalizeCanonicalTeamAbbr(targetAbbr)
  );
  if (!teamBox || !Array.isArray(teamBox.statistics)) return [];

  const byName = new Map();
  for (const grp of teamBox.statistics) {
    if (grp?.name) byName.set(grp.name, grp);
  }

  const out = [];
  for (const spec of GAMECAST_BOX_CATEGORY_ORDER) {
    const grp = byName.get(spec.key);
    if (!grp || !Array.isArray(grp.athletes) || grp.athletes.length === 0) continue;
    const rawLabels = Array.isArray(grp.labels) && grp.labels.length > 0 ? grp.labels : spec.defaultLabels;
    const compactLabels = rawLabels.map(l => COMPACT_BOX_COL_MAP[l] || l);

    const athletes = grp.athletes
      .map(entry => {
        const ath = entry?.athlete || {};
        const name = String(ath.displayName || ath.shortName || '').trim();
        if (!name) return null;
        return {
          id: ath.id != null ? String(ath.id) : '',
          name,
          shortName: String(ath.shortName || name).trim(),
          jersey: ath.jersey != null ? String(ath.jersey) : '',
          position: String(ath.position?.abbreviation || '').trim(),
          headshotUrl: sanitizeExternalUrl(ath.headshot?.href || '', null),
          espnUrl: sanitizeExternalUrl(ath.links?.[0]?.href || '', null),
          stats: Array.isArray(entry.stats) ? entry.stats.map(s => String(s ?? '—')) : []
        };
      })
      .filter(Boolean);

    if (athletes.length === 0) continue;

    const totals = Array.isArray(grp.totals) && grp.totals.length > 0 ? grp.totals.map(t => String(t ?? '')) : null;
    out.push({
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      labels: compactLabels,
      athletes,
      totals
    });
  }

  return out;
}

function buildEspnPlayerHeadshotUrl(athleteId, rawUrl = null) {
  const cleanRaw = sanitizeExternalUrl(rawUrl || '', null);
  if (cleanRaw) return cleanRaw;
  const id = String(athleteId || '').trim();
  if (/^\d{4,10}$/.test(id)) {
    return `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`;
  }
  return null;
}

function inferTimeoutsRemainingFromDrives(drivesChrono = [], currentPeriod = 1, away = {}, home = {}) {
  const per = Math.max(1, Number(currentPeriod) || 1);
  const isOt = per >= 5;
  const halfPeriods = isOt ? [per] : per <= 2 ? [1, 2] : [3, 4];
  const startingTimeouts = isOt ? 2 : 3;
  let awayUsed = 0;
  let homeUsed = 0;

  const awayTokens = [away.abbr, away.shortName, away.name].filter(Boolean).map(s => String(s).toLowerCase());
  const homeTokens = [home.abbr, home.shortName, home.name].filter(Boolean).map(s => String(s).toLowerCase());

  for (const drv of drivesChrono || []) {
    for (const pl of drv?.plays || []) {
      if (!halfPeriods.includes(Number(pl.period || 1))) continue;
      const txt = String(pl.text || '');
      if (!/\btimeout\b/i.test(txt) || /official|tv|injury|two-minute|booth/i.test(txt)) continue;
      // ESPN format: "Timeout #1 by CIN at 04:12." or "Timeout #2 by SF at 01:08."
      const m = txt.match(/by\s+([A-Za-z0-9 .'-]{2,24}?)(?:\s+at\b|\.|,|$)/i);
      const who = String(m?.[1] || '').trim().toLowerCase();
      if (who) {
        const whoAbbr = normalizeCanonicalTeamAbbr(who).toLowerCase();
        if (awayTokens.some(t => t === who || t === whoAbbr || who.includes(t))) {
          awayUsed += 1;
        } else if (homeTokens.some(t => t === who || t === whoAbbr || who.includes(t))) {
          homeUsed += 1;
        }
      }
    }
  }

  return {
    away: Math.max(0, Math.min(3, startingTimeouts - awayUsed)),
    home: Math.max(0, Math.min(3, startingTimeouts - homeUsed))
  };
}

/**
 * Extracts ESPN-style mirrored Game Leaders (Passing Yards, Rushing Yards,
 * Receiving Yards, Sacks, Tackles) for both Away and Home sides.
 */
function extractGameLeaders(summaryJson, awayBoxGroups = [], homeBoxGroups = [], away = {}, home = {}) {
  const headshotById = new Map();
  const rawLeaders = Array.isArray(summaryJson?.leaders) ? summaryJson.leaders : [];
  for (const teamBlock of rawLeaders) {
    for (const cat of teamBlock?.leaders || []) {
      for (const item of cat?.leaders || []) {
        const ath = item?.athlete;
        const id = ath?.id != null ? String(ath.id) : '';
        const hs = sanitizeExternalUrl(ath?.headshot?.href || '', null);
        if (id && hs) headshotById.set(id, hs);
      }
    }
  }

  const findStatIdx = (labels = [], candidates = []) => {
    const upper = labels.map(l => String(l || '').trim().toUpperCase());
    for (const c of candidates) {
      const idx = upper.indexOf(c.toUpperCase());
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const pickBestAthlete = (groups, catKey, primaryCols, subBuilder, { allowZero = false } = {}) => {
    const grp = (groups || []).find(g => g.key === catKey);
    if (!grp || !Array.isArray(grp.athletes) || grp.athletes.length === 0) return null;
    const pIdx = findStatIdx(grp.labels, primaryCols);
    if (pIdx < 0) return null;

    let best = null;
    let bestVal = -Infinity;
    for (const ath of grp.athletes) {
      const rawStr = String(ath.stats?.[pIdx] ?? '').trim();
      const num = parseFloat(rawStr);
      if (!Number.isFinite(num)) continue;
      if (!allowZero && num <= 0) continue;
      if (num > bestVal) {
        bestVal = num;
        best = { ath, rawStr, num };
      }
    }
    if (!best) return null;

    const { ath, rawStr, num } = best;
    const subStat = typeof subBuilder === 'function' ? subBuilder(ath, grp.labels) : '';
    const displayVal = Number.isInteger(num) ? String(num) : rawStr;
    return {
      id: ath.id || '',
      name: ath.name || ath.shortName || '',
      shortName: ath.shortName || ath.name || '',
      position: ath.position || '',
      headshotUrl: buildEspnPlayerHeadshotUrl(ath.id, ath.headshotUrl || headshotById.get(ath.id)),
      espnUrl: ath.espnUrl || null,
      primaryStat: displayVal,
      primaryNum: num,
      subStat
    };
  };

  const fmtSub = (ath, labels, colCandidates, suffix = '') => {
    const idx = findStatIdx(labels, colCandidates);
    if (idx < 0) return '';
    const v = String(ath.stats?.[idx] ?? '').trim();
    if (!v || v === '—' || v === '0') return '';
    return suffix ? `${v} ${suffix}` : v;
  };

  const specs = [
    {
      key: 'passing',
      label: 'Passing Yards',
      catKey: 'passing',
      primaryCols: ['YDS'],
      allowZero: true,
      subBuilder: (ath, labels) => {
        const ca = fmtSub(ath, labels, ['C/A', 'C/ATT']);
        const td = fmtSub(ath, labels, ['TD']);
        return td ? `${ca} · ${td} TD` : ca;
      }
    },
    {
      key: 'rushing',
      label: 'Rushing Yards',
      catKey: 'rushing',
      primaryCols: ['YDS'],
      allowZero: true,
      subBuilder: (ath, labels) => {
        const car = fmtSub(ath, labels, ['CAR'], 'CAR');
        const td = fmtSub(ath, labels, ['TD']);
        return td ? `${car} · ${td} TD` : car;
      }
    },
    {
      key: 'receiving',
      label: 'Receiving Yards',
      catKey: 'receiving',
      primaryCols: ['YDS'],
      allowZero: false,
      subBuilder: (ath, labels) => {
        const rec = fmtSub(ath, labels, ['REC'], 'REC');
        const td = fmtSub(ath, labels, ['TD']);
        return td ? `${rec} · ${td} TD` : rec;
      }
    },
    {
      key: 'sacks',
      label: 'Sacks',
      catKey: 'defensive',
      primaryCols: ['SCK', 'SACKS'],
      allowZero: false,
      subBuilder: (ath, labels) => {
        const tfl = fmtSub(ath, labels, ['TFL'], 'TFL');
        const qbh = fmtSub(ath, labels, ['QBH', 'QB HTS'], 'QBH');
        return tfl || qbh || '';
      }
    },
    {
      key: 'tackles',
      label: 'Tackles',
      catKey: 'defensive',
      primaryCols: ['TOT'],
      allowZero: false,
      subBuilder: (ath, labels) => fmtSub(ath, labels, ['SOLO'], 'SOLO')
    }
  ];

  const rows = [];
  for (const spec of specs) {
    const awayLeader = pickBestAthlete(awayBoxGroups, spec.catKey, spec.primaryCols, spec.subBuilder, {
      allowZero: spec.allowZero
    });
    const homeLeader = pickBestAthlete(homeBoxGroups, spec.catKey, spec.primaryCols, spec.subBuilder, {
      allowZero: spec.allowZero
    });
    if (!awayLeader && !homeLeader) continue;
    rows.push({
      key: spec.key,
      label: spec.label,
      away: awayLeader,
      home: homeLeader,
      awayAbbr: away.abbr || '',
      homeAbbr: home.abbr || ''
    });
  }
  return rows;
}

/**
 * Primary deterministic parser: transforms raw ESPN `summary?event=<gameId>` JSON
 * into a unified Gamecast model powering Scorebug, Animated Field, Box Score,
 * Team Stats, and Play-by-Play.
 */
export function parseEspnSummaryToGamecast(summaryJson, { gameMeta = {}, activeTeam = null } = {}) {
  if (!summaryJson || typeof summaryJson !== 'object') return null;

  const teamCfg = activeTeam ? resolveTeamConfig(activeTeam) : getActiveTeamConfig();
  const activeAbbr = normalizeCanonicalTeamAbbr(teamCfg.abbr || 'SF');

  const comp = summaryJson.header?.competitions?.[0] || {};
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const awayRaw = competitors.find(c => c?.homeAway === 'away') || competitors[1] || competitors[0] || {};
  const homeRaw = competitors.find(c => c?.homeAway === 'home') || competitors[0] || {};

  const statusType = comp.status?.type || {};
  const rawState = String(statusType.state || (gameMeta.completed ? 'post' : 'pre')).toLowerCase();
  const isLive = rawState === 'in';
  const isFinal = rawState === 'post' || Boolean(statusType.completed);
  const isPre = !isLive && !isFinal;

  const buildTeamObj = (raw, fallbackIsActive) => {
    const abbr = normalizeCanonicalTeamAbbr(
      raw?.team?.abbreviation ||
        (fallbackIsActive ? activeAbbr : gameMeta.oppAbbr || gameMeta.opponent?.abbr || 'OPP')
    );
    const isActive = abbr === activeAbbr;
    const rawLines = Array.isArray(raw?.linescores)
      ? raw.linescores.map(l => {
          const val = l?.displayValue ?? l?.value;
          return val != null && val !== '' ? String(val) : '0';
        })
      : [];
    const logoRaw = raw?.team?.logos?.[0]?.href || raw?.team?.logo || '';
    const recordObj = Array.isArray(raw?.record) ? raw.record.find(r => r?.type === 'total') || raw.record[0] : null;
    return {
      espnId: String(raw?.id || raw?.team?.id || ''),
      abbr,
      name: String(raw?.team?.displayName || raw?.team?.name || (isActive ? teamCfg.name : gameMeta.oppName || abbr)),
      shortName: String(raw?.team?.name || raw?.team?.shortDisplayName || (isActive ? teamCfg.nickname : abbr)),
      logoUrl: sanitizeExternalUrl(logoRaw, buildEspnTeamLogoUrl(abbr)),
      color: sanitizeTeamHexColor(raw?.team?.color, abbr),
      score: raw?.score != null && raw.score !== '' ? Number(raw.score) : null,
      record: String(recordObj?.summary || recordObj?.displayValue || '').trim(),
      linescores: rawLines,
      isActive,
      winner: Boolean(raw?.winner),
      timeoutsRemaining: raw?.timeoutsRemaining != null ? Math.max(0, Math.min(3, Number(raw.timeoutsRemaining))) : null,
      hasPossession: false
    };
  };

  const away = buildTeamObj(awayRaw, gameMeta.homeAway === 'away');
  const home = buildTeamObj(homeRaw, gameMeta.homeAway !== 'away');
  const teamIsHome = home.isActive || (!away.isActive && gameMeta.homeAway !== 'away');
  const activeSide = teamIsHome ? home : away;
  const oppSide = teamIsHome ? away : home;

  const gameId = String(gameMeta.id || comp.id || summaryJson.header?.id || '').trim();
  const periodCount = Math.max(4, away.linescores.length, home.linescores.length);
  const currentPeriod = Number(comp.status?.period || 0) || 1;
  const quarterHeaders = [];
  for (let i = 1; i <= periodCount; i += 1) {
    quarterHeaders.push(i <= 4 ? String(i) : i === 5 ? 'OT' : `${i - 4}OT`);
  }
  while (away.linescores.length < periodCount) away.linescores.push(isFinal ? '0' : '—');
  while (home.linescores.length < periodCount) home.linescores.push(isFinal ? '0' : '—');

  // Highlight video clips for inline Play-by-Play matching
  const videos = (Array.isArray(summaryJson.videos) ? summaryJson.videos : [])
    .map(extractVideoClipEntry)
    .filter(Boolean);
  const usedClipIds = new Set();

  // Drives & Play-by-Play
  const rawPrevDrives = Array.isArray(summaryJson.drives?.previous) ? summaryJson.drives.previous : [];
  const rawCurrDrive = summaryJson.drives?.current && typeof summaryJson.drives.current === 'object'
    ? summaryJson.drives.current
    : null;

  const allRawDrives = [];
  for (const d of rawPrevDrives) {
    if (d && typeof d === 'object') allRawDrives.push({ drive: d, isLiveDrive: false });
  }
  if (rawCurrDrive && Array.isArray(rawCurrDrive.plays) && rawCurrDrive.plays.length > 0) {
    const currId = String(rawCurrDrive.id || '');
    const alreadyInPrev = currId && rawPrevDrives.some(p => String(p?.id || '') === currId);
    if (!alreadyInPrev) {
      allRawDrives.push({ drive: rawCurrDrive, isLiveDrive: isLive });
    } else if (isLive && allRawDrives.length > 0) {
      allRawDrives[allRawDrives.length - 1].isLiveDrive = true;
    }
  }

  const quartersSet = new Set();
  const playTimingById = new Map();
  let lastPlayRawTimeouts = { away: null, home: null };

  const parsedDrivesChrono = allRawDrives.map(({ drive, isLiveDrive }, dIdx) => {
    const dTeamAbbr = normalizeCanonicalTeamAbbr(drive?.team?.abbreviation || '');
    const dTeamSide = dTeamAbbr === away.abbr ? 'away' : 'home';
    const dIsActive = dTeamAbbr === activeAbbr;
    const dLogo = sanitizeExternalUrl(drive?.team?.logos?.[0]?.href || '', buildEspnTeamLogoUrl(dTeamAbbr));
    const startPeriod = drive?.start?.period?.number || drive?.plays?.[0]?.period?.number || 1;
    const quarter = parseQuarterLabel(startPeriod);
    quartersSet.add(quarter);

    const rawPlays = Array.isArray(drive.plays) ? drive.plays : [];
    const plays = rawPlays
      .map((pl, pIdx) => {
        const text = String(pl?.text || '').trim();
        if (!text) return null;
        const pid = String(pl?.id || `${drive.id || dIdx}_${pIdx}`);
        const per = Number(pl?.period?.number || startPeriod) || 1;
        const qLbl = parseQuarterLabel(per);
        quartersSet.add(qLbl);
        const clock = String(pl?.clock?.displayValue || '').trim();
        playTimingById.set(pid, {
          period: per,
          x01: computeGameClockProgress01(per, clock, periodCount)
        });
        if (pl?.end?.awayTimeouts != null) lastPlayRawTimeouts.away = Number(pl.end.awayTimeouts);
        if (pl?.end?.homeTimeouts != null) lastPlayRawTimeouts.home = Number(pl.end.homeTimeouts);

        const kind = classifyPlayKind(pl);
        const downDistRaw = String(pl?.start?.shortDownDistanceText || pl?.start?.downDistanceText || '').trim();
        const downDist = kind.isAdminStoppage ? '' : sanitizeDownDistanceText(downDistRaw);
        const spotRaw = String(pl?.start?.possessionText || '').trim();
        const spot = kind.isAdminStoppage ? '' : normalizeSpotTextCanonical(spotRaw, away.abbr, home.abbr) || spotRaw;
        const downDistanceSpot =
          downDist && spot
            ? `${downDist} • ${spot}`
            : downDist || spot || (kind.isAdminStoppage ? qLbl : String(pl?.type?.text || '').trim());
        const yds = Number(pl?.statYardage);
        const yards = Number.isFinite(yds) ? yds : 0;
        const isScoring = Boolean(pl?.scoringPlay);
        const { headline, tone: headlineTone } = buildPlayHeadline(pl, kind, yards);
        const downNum = Number(pl?.start?.down || 0);
        const isKeyPlay =
          isScoring ||
          kind.isTurnover ||
          kind.isSack ||
          downNum === 4 ||
          Math.abs(yards) >= 15;

        const fgDistance = kind.isFieldGoal
          ? Number((text.match(/(\d{2})\s+yard\s+field\s+goal/i) || [])[1] || 0) || null
          : null;

        const endDownNum = Number(pl?.end?.down || 0) || null;
        const endDistanceNum = Number(pl?.end?.distance || 0) || null;
        const endYardsToEndzone =
          pl?.end?.yardsToEndzone != null && Number.isFinite(Number(pl.end.yardsToEndzone))
            ? Number(pl.end.yardsToEndzone)
            : null;
        const endShortDownDist =
          sanitizeDownDistanceText(pl?.end?.shortDownDistanceText || '') ||
          sanitizeDownDistanceText(pl?.end?.downDistanceText || '') ||
          formatDownAndDistance(endDownNum, endDistanceNum, endYardsToEndzone);
        const endSpot = normalizeSpotTextCanonical(pl?.end?.possessionText || '', away.abbr, home.abbr);
        const endTeamId = String(pl?.end?.team?.id || '').trim();
        let endSideForYte = dTeamSide;
        if (endTeamId) {
          if (endTeamId === away.espnId) endSideForYte = 'away';
          else if (endTeamId === home.espnId) endSideForYte = 'home';
        } else if (kind.isKickoff) {
          endSideForYte = resolveKickoffReceivingSide(text, dTeamSide, endTeamId, away, home);
        } else if (kind.isPunt || kind.isTurnover || kind.isFieldGoalMissed) {
          endSideForYte = dTeamSide === 'away' ? 'home' : 'away';
        }

        let startPos = null;
        let endPos = null;
        if (!kind.isAdminStoppage) {
          const parsedStartSpot = parseSpotTextToFieldX(spot, away.abbr, home.abbr);
          const rawStartYte = pl?.start?.yardsToEndzone != null ? Number(pl.start.yardsToEndzone) : null;
          if (parsedStartSpot != null) {
            startPos = parsedStartSpot;
          } else if (
            rawStartYte != null &&
            Number.isFinite(rawStartYte) &&
            (rawStartYte > 0 || kind.isTouchdown || kind.isSafety)
          ) {
            startPos = yardsToEndzoneToFieldX(rawStartYte, dTeamSide);
          }

          const parsedEndSpot = parseSpotTextToFieldX(pl?.end?.possessionText || '', away.abbr, home.abbr);
          const parsedTextDest =
            parsedEndSpot == null
              ? parsePlayTextDestinationSpot(text, away.abbr, home.abbr, {
                  isKickoff: kind.isKickoff,
                  isPunt: kind.isPunt,
                  receivingSide: endSideForYte
                })
              : null;
          if (parsedEndSpot != null) {
            endPos = parsedEndSpot;
          } else if (parsedTextDest != null && (kind.isKickoff || kind.isPunt || kind.isTurnover)) {
            endPos = parsedTextDest;
          } else if (
            endYardsToEndzone != null &&
            (endYardsToEndzone > 0 || kind.isTouchdown || kind.isSafety || kind.isFieldGoal)
          ) {
            endPos = yardsToEndzoneToFieldX(endYardsToEndzone, endSideForYte);
          } else if (parsedTextDest != null) {
            endPos = parsedTextDest;
          }
        }

        const clip = matchVideoClipToPlay(text, isScoring, kind.isTurnover, videos, usedClipIds);

        return {
          id: pid,
          period: per,
          quarterLabel: qLbl,
          clock,
          down: downNum || null,
          distance: Number(pl?.start?.distance || 0) || null,
          downOnly: downDist,
          spotOnly: spot,
          downDistanceSpot,
          endDown: endDownNum,
          endDistance: endDistanceNum,
          endShortDownDist,
          endSpot,
          endYardsToEndzone,
          endTeamId,
          headline,
          headlineTone,
          text,
          yards,
          isScoring,
          isKeyPlay,
          isPass: kind.isPass,
          isRun: kind.isRun,
          isSack: kind.isSack,
          isIncomplete: kind.isIncomplete,
          isTurnover: kind.isTurnover,
          isPenalty: kind.isPenalty,
          isFieldGoal: kind.isFieldGoal,
          isFieldGoalGood: kind.isFieldGoalGood,
          isFieldGoalMissed: kind.isFieldGoalMissed,
          isExtraPoint: kind.isExtraPoint,
          isTwoPoint: kind.isTwoPoint,
          isPunt: kind.isPunt,
          isKickoff: kind.isKickoff,
          isTouchdown: kind.isTouchdown,
          isSafety: kind.isSafety,
          isAdminStoppage: kind.isAdminStoppage,
          fgDistance,
          awayScoreAfter: pl?.awayScore != null ? Number(pl.awayScore) : null,
          homeScoreAfter: pl?.homeScore != null ? Number(pl.homeScore) : null,
          wpDelta: '',
          startPos,
          endPos,
          clip
        };
      })
      .filter(Boolean);

    const lastPlayInDrive = plays.length > 0 ? plays[plays.length - 1] : null;
    const scoreAfter =
      lastPlayInDrive && lastPlayInDrive.awayScoreAfter != null && lastPlayInDrive.homeScoreAfter != null
        ? `${away.abbr} ${lastPlayInDrive.awayScoreAfter}–${lastPlayInDrive.homeScoreAfter} ${home.abbr}`
        : '';

    const resultBadge = normalizeDriveResultBadge(drive.displayResult || drive.result, isLiveDrive);
    const playCount = Number(drive.offensivePlays ?? plays.length) || plays.length;
    const driveYards = Number(drive.yards ?? 0);
    const elapsed = String(drive.timeElapsed?.displayValue || '').trim();
    const summaryText =
      String(drive.description || '').trim() ||
      [
        `${playCount} ${playCount === 1 ? 'play' : 'plays'}`,
        `${driveYards} yds`,
        elapsed
      ]
        .filter(Boolean)
        .join(', ');

    const driveStartPos =
      drive?.start?.yardLine != null && drive?.start?.text
        ? parseSpotTextToFieldX(drive.start.text, away.abbr, home.abbr)
        : plays[0]?.startPos ?? null;

    return {
      id: String(drive.id || `drv_${dIdx}`),
      index: dIdx,
      teamAbbr: dTeamAbbr || activeAbbr,
      teamName: String(drive?.team?.shortDisplayName || drive?.team?.displayName || dTeamAbbr),
      teamSide: dTeamSide,
      teamLogoUrl: dLogo,
      isActiveTeam: dIsActive,
      quarter,
      resultCode: resultBadge.code,
      resultTone: resultBadge.tone,
      isLiveDrive,
      isScoringDrive: Boolean(drive.isScore) || plays.some(p => p.isScoring),
      summary: summaryText,
      scoreAfter,
      driveStartPos,
      plays
    };
  });

  // Win Probability + quarter-aligned series + per-play WP delta
  const winProb = buildCompactWinProbSeries(summaryJson.winprobability || [], teamIsHome, {
    playTimingById,
    totalPeriods: periodCount,
    isFinal,
    currentPeriod
  });
  if (isFinal && activeSide.score != null && oppSide.score != null && winProb.teamPct == null) {
    winProb.teamPct = activeSide.score > oppSide.score ? 100 : activeSide.score < oppSide.score ? 0 : 50;
    winProb.oppPct = 100 - winProb.teamPct;
    winProb.teamPctExact = winProb.teamPct;
    winProb.oppPctExact = winProb.oppPct;
    winProb.leadingSide = winProb.teamPct > 50 ? 'team' : winProb.teamPct < 50 ? 'opp' : 'tied';
  }
  for (const drv of parsedDrivesChrono) {
    for (const pl of drv.plays) {
      if (winProb.deltaByPlayId[pl.id]) pl.wpDelta = winProb.deltaByPlayId[pl.id];
    }
  }

  // Live situation & animated field geometry
  const rawSit = summaryJson.situation || comp.situation || null;
  const allPlayEntries = [];
  for (const drv of parsedDrivesChrono) {
    for (const pl of drv.plays || []) {
      allPlayEntries.push({ play: pl, drive: drv });
    }
  }
  const latestDrive = parsedDrivesChrono.length > 0 ? parsedDrivesChrono[parsedDrivesChrono.length - 1] : null;
  const latestEntry = allPlayEntries.length > 0 ? allPlayEntries[allPlayEntries.length - 1] : null;
  const latestPlay = latestEntry?.play || null;
  const latestPlayDrive = latestEntry?.drive || latestDrive;

  // Walk backwards past trailing administrative stoppages (Official Timeout, TV Timeout, End Period,
  // Two-Minute Warning) so scoring plays (e.g. Field Goal -> Official Timeout) and immediate post-play
  // down/distance NEVER revert to "& Goal / LAR 35" before the kickoff or next snap occurs!
  let effectiveEntry = latestEntry;
  if (latestPlay?.isAdminStoppage) {
    for (let i = allPlayEntries.length - 1; i >= 0; i -= 1) {
      if (!allPlayEntries[i]?.play?.isAdminStoppage) {
        effectiveEntry = allPlayEntries[i];
        break;
      }
    }
  }
  const effectivePlay = effectiveEntry?.play || latestPlay;
  const effectiveDrive = effectiveEntry?.drive || latestPlayDrive;
  const hasTrailingAdminStoppage = Boolean(
    latestPlay?.isAdminStoppage && effectivePlay && effectivePlay.id !== latestPlay.id
  );

  const formatFieldXToSpot = x => {
    const rounded = Math.round(Math.max(0, Math.min(100, Number(x) || 50)));
    if (rounded === 50) return '50';
    if (rounded < 50) return `${away.abbr} ${rounded}`;
    return `${home.abbr} ${100 - rounded}`;
  };

  const rawLastPlayKind = rawSit?.lastPlay ? classifyPlayKind(rawSit.lastPlay) : {};
  const isFieldGoalLastPlay = Boolean(effectivePlay ? effectivePlay.isFieldGoal : rawLastPlayKind.isFieldGoal);
  const isFieldGoalGoodLastPlay = Boolean(
    effectivePlay ? effectivePlay.isFieldGoalGood : rawLastPlayKind.isFieldGoalGood
  );
  const isFieldGoalMissedLastPlay = Boolean(
    effectivePlay ? effectivePlay.isFieldGoalMissed : rawLastPlayKind.isFieldGoalMissed
  );
  const isTouchdownLastPlay = Boolean(
    effectivePlay
      ? effectivePlay.isTouchdown || (effectivePlay.isScoring && /touchdown/i.test(effectivePlay.text || ''))
      : rawLastPlayKind.isTouchdown
  );
  const isSafetyLastPlay = Boolean(effectivePlay ? effectivePlay.isSafety : rawLastPlayKind.isSafety);
  const isExtraPointLastPlay = Boolean(effectivePlay ? effectivePlay.isExtraPoint : rawLastPlayKind.isExtraPoint);
  const isExtraPointGoodLastPlay = Boolean(
    effectivePlay
      ? effectivePlay.isExtraPoint && (effectivePlay.isScoring || /is\s+good\b/i.test(effectivePlay.text || ''))
      : rawLastPlayKind.isExtraPoint && Boolean(rawSit?.lastPlay?.scoringPlay)
  );
  const isTwoPointLastPlay = Boolean(effectivePlay ? effectivePlay.isTwoPoint : rawLastPlayKind.isTwoPoint);
  const isTwoPointGoodLastPlay = Boolean(
    effectivePlay
      ? effectivePlay.isTwoPoint && (effectivePlay.isScoring || /succeeds|is\s+good\b/i.test(effectivePlay.text || ''))
      : rawLastPlayKind.isTwoPoint && Boolean(rawSit?.lastPlay?.scoringPlay)
  );
  const isAdminStoppageLastPlay = Boolean(
    latestPlay ? latestPlay.isAdminStoppage : rawLastPlayKind.isAdminStoppage
  );

  // Keep scoring banner active after TD, Field Goal Good, Safety, Extra Point, or 2-Pt attempt
  // (including across any subsequent Official Timeout / TV Timeout) until the Kickoff or next live snap arrives!
  let scoringPlayType = null;
  if (isTouchdownLastPlay) scoringPlayType = 'touchdown';
  else if (isFieldGoalGoodLastPlay) scoringPlayType = 'field_goal';
  else if (isSafetyLastPlay) scoringPlayType = 'safety';
  else if (isExtraPointGoodLastPlay || isExtraPointLastPlay) scoringPlayType = 'extra_point';
  else if (isTwoPointGoodLastPlay || isTwoPointLastPlay) scoringPlayType = 'two_point';

  // Initial possession resolution from rawSit / effectiveDrive
  let possessionTeamId = String(rawSit?.possession || '').trim();
  let possessionSide = effectiveDrive?.teamSide || latestDrive?.teamSide || 'away';
  if (possessionTeamId) {
    if (possessionTeamId === away.espnId) possessionSide = 'away';
    else if (possessionTeamId === home.espnId) possessionSide = 'home';
  }

  // Determine exact scoring team (crediting defense on safeties & defensive return TDs)
  let scoringTeamSide = effectiveDrive?.teamSide || possessionSide;
  if (scoringPlayType) {
    const effIdx = effectiveEntry ? allPlayEntries.indexOf(effectiveEntry) : -1;
    const prevPlayBeforeEff = effIdx >= 1 ? allPlayEntries[effIdx - 1]?.play || null : null;
    if (
      effectivePlay &&
      prevPlayBeforeEff &&
      effectivePlay.awayScoreAfter != null &&
      prevPlayBeforeEff.awayScoreAfter != null &&
      effectivePlay.homeScoreAfter != null &&
      prevPlayBeforeEff.homeScoreAfter != null
    ) {
      if (effectivePlay.awayScoreAfter > prevPlayBeforeEff.awayScoreAfter) scoringTeamSide = 'away';
      else if (effectivePlay.homeScoreAfter > prevPlayBeforeEff.homeScoreAfter) scoringTeamSide = 'home';
    } else if (isSafetyLastPlay || (isTouchdownLastPlay && effectivePlay?.isTurnover)) {
      scoringTeamSide = (effectiveDrive?.teamSide || possessionSide) === 'away' ? 'home' : 'away';
    }
  }
  const scoringTeamObj = scoringTeamSide === 'away' ? away : home;

  // Validate rawSit freshness vs. latestPlay / effectivePlay so lagged ESPN `situation` objects
  // NEVER show a 1-to-2-play-old down & spot (e.g. showing "4th & 4 at GB 29" after a punt to LA 18,
  // or showing "1st & 10 at GB 32" after a 5-yard pass to GB 27).
  const rawSitLastPlayId = String(rawSit?.lastPlay?.id || '').trim();
  const rawSitShortDown = sanitizeDownDistanceText(rawSit?.shortDownDistanceText || '');
  const rawSitFullDown = sanitizeDownDistanceText(rawSit?.downDistanceText || '');
  const rawSitDownClean =
    rawSitShortDown ||
    rawSitFullDown ||
    formatDownAndDistance(rawSit?.down, rawSit?.distance, rawSit?.yardsToEndzone);
  const rawSitSpotClean = normalizeSpotTextCanonical(rawSit?.possessionText || '', away.abbr, home.abbr);
  const rawSitBallPos = (() => {
    if (rawSitSpotClean) {
      const p = parseSpotTextToFieldX(rawSitSpotClean, away.abbr, home.abbr);
      if (p != null) return p;
    }
    if (rawSit?.yardLine != null && rawSit?.yardsToEndzone != null) {
      const yte = Number(rawSit.yardsToEndzone);
      if (Number.isFinite(yte) && (yte > 0 || isTouchdownLastPlay || isSafetyLastPlay)) {
        return yardsToEndzoneToFieldX(yte, possessionSide);
      }
    }
    return null;
  })();

  let rawSitIsStale = false;
  if (rawSit && effectivePlay && !effectivePlay.isAdminStoppage && !scoringPlayType) {
    if (rawSitLastPlayId && effectivePlay.id && rawSitLastPlayId !== effectivePlay.id && rawSitLastPlayId !== latestPlay?.id) {
      rawSitIsStale = true;
    }
    const effStartDownClean = sanitizeDownDistanceText(effectivePlay.downOnly || '');
    const effStartSpotClean = normalizeSpotTextCanonical(effectivePlay.spotOnly || '', away.abbr, home.abbr);
    if (effectivePlay.isPunt || effectivePlay.isKickoff || effectivePlay.isTurnover || effectivePlay.isFieldGoalMissed) {
      if (
        (rawSitDownClean && effStartDownClean && rawSitDownClean === effStartDownClean && rawSitSpotClean === effStartSpotClean) ||
        (effectivePlay.isPunt && /^4th\b/i.test(rawSitDownClean))
      ) {
        rawSitIsStale = true;
      }
    } else if (
      rawSitDownClean &&
      effStartDownClean &&
      rawSitDownClean === effStartDownClean &&
      rawSitSpotClean &&
      effStartSpotClean &&
      rawSitSpotClean === effStartSpotClean &&
      (effectivePlay.yards !== 0 || effectivePlay.isIncomplete) &&
      !/\bno\s+play\b/i.test(effectivePlay.text || '')
    ) {
      rawSitIsStale = true;
    }
  }
  const canTrustRawSit = Boolean(rawSit && !rawSitIsStale && !scoringPlayType);

  // Resolve immediate post-play possession, ballPos, down, distance, and spot
  let ballPos = null;
  let resolvedDownNum = null;
  let resolvedDistanceYds = null;
  let resolvedDownOnly = '';
  let resolvedSpotOnly = '';

  if (scoringPlayType) {
    // Scoring state (TD / Field Goal / Safety / Extra Point / 2-Pt): keep clean scoring banner & kick geometry
    possessionSide = isFieldGoalLastPlay ? effectiveDrive?.teamSide || scoringTeamSide : scoringTeamSide;
    if (canTrustRawSit && rawSitBallPos != null) {
      ballPos = rawSitBallPos;
    } else if (rawSitBallPos != null && !isFieldGoalLastPlay && !hasTrailingAdminStoppage) {
      ballPos = rawSitBallPos;
    } else if (effectivePlay?.endPos != null) {
      ballPos = effectivePlay.endPos;
    } else if (effectivePlay?.startPos != null) {
      ballPos = effectivePlay.startPos;
    }
    if (rawSit?.distance != null && Number.isFinite(Number(rawSit.distance)) && Number(rawSit.distance) > 0) {
      resolvedDistanceYds = Number(rawSit.distance);
    }
  } else if (
    effectivePlay &&
    (effectivePlay.isKickoff || effectivePlay.isPunt || effectivePlay.isTurnover || effectivePlay.isFieldGoalMissed)
  ) {
    // Possession-change / special-teams plays: update possession, 1st & 10, and landing spot IMMEDIATELY!
    const effDriveSide = effectiveDrive?.teamSide || possessionSide;
    let postSide = effDriveSide;
    if (effectivePlay.isKickoff) {
      postSide = resolveKickoffReceivingSide(effectivePlay.text, effDriveSide, effectivePlay.endTeamId, away, home);
    } else if (effectivePlay.endTeamId && effectivePlay.endTeamId === away.espnId) {
      postSide = 'away';
    } else if (effectivePlay.endTeamId && effectivePlay.endTeamId === home.espnId) {
      postSide = 'home';
    } else if (effectivePlay.isPunt) {
      const recMatch = String(effectivePlay.text || '').match(/\bRECOVERED\s+by\s+([A-Z]{2,4})-/i);
      const recAbbr = recMatch ? normalizeCanonicalTeamAbbr(recMatch[1]) : '';
      const kickingAbbr = effDriveSide === 'away' ? away.abbr : home.abbr;
      postSide = recAbbr && recAbbr === kickingAbbr ? effDriveSide : effDriveSide === 'away' ? 'home' : 'away';
    } else {
      postSide = effDriveSide === 'away' ? 'home' : 'away';
    }

    possessionSide = postSide;
    if (effectivePlay.endPos != null) {
      ballPos = effectivePlay.endPos;
    } else if (canTrustRawSit && rawSitBallPos != null) {
      ballPos = rawSitBallPos;
    } else {
      const parsedFromText = parsePlayTextDestinationSpot(effectivePlay.text, away.abbr, home.abbr, {
        isKickoff: effectivePlay.isKickoff,
        isPunt: effectivePlay.isPunt,
        receivingSide: postSide
      });
      if (parsedFromText != null) ballPos = parsedFromText;
      else if (effectivePlay.isFieldGoalMissed && effectivePlay.startPos != null) {
        // NFL rule: missed FG spot is spot of kick (~7 yds behind LOS) or 20-yd line, whichever is farther from EZ
        const opp20 = postSide === 'away' ? 20 : 80;
        ballPos = postSide === 'away' ? Math.max(opp20, effectivePlay.startPos) : Math.min(opp20, effectivePlay.startPos);
      }
    }
    if (ballPos == null) ballPos = 50;

    const postYte = possessionSide === 'away' ? Math.round(100 - ballPos) : Math.round(ballPos);
    resolvedDownNum = 1;
    resolvedDistanceYds = Math.min(10, Math.max(1, postYte));
    resolvedDownOnly =
      (canTrustRawSit && /^1st\b/i.test(rawSitDownClean) ? rawSitDownClean : '') ||
      (effectivePlay.endShortDownDist && /^1st\b/i.test(effectivePlay.endShortDownDist)
        ? effectivePlay.endShortDownDist
        : '') ||
      formatDownAndDistance(1, resolvedDistanceYds, postYte);
    resolvedSpotOnly =
      effectivePlay.endSpot ||
      (canTrustRawSit && rawSitSpotClean ? rawSitSpotClean : '') ||
      formatFieldXToSpot(ballPos);
  } else if (effectivePlay && !effectivePlay.isAdminStoppage) {
    // Normal scrimmage play (Pass, Run, Sack, Incomplete, Penalty): compute immediate post-play down & ball spot!
    const playSide = effectiveDrive?.teamSide || possessionSide;
    const playDir = playSide === 'away' ? 1 : -1;
    const effStartPos = effectivePlay.startPos != null ? effectivePlay.startPos : null;
    const effEndPos =
      effectivePlay.endPos != null
        ? effectivePlay.endPos
        : effectivePlay.isIncomplete && effStartPos != null
          ? effStartPos
          : effStartPos != null
            ? Math.max(0, Math.min(100, effStartPos + playDir * Number(effectivePlay.yards || 0)))
            : null;

    const endMatchesStart =
      effectivePlay.endShortDownDist &&
      effectivePlay.downOnly &&
      effectivePlay.endShortDownDist === sanitizeDownDistanceText(effectivePlay.downOnly) &&
      (!effectivePlay.endSpot || effectivePlay.endSpot === effectivePlay.spotOnly) &&
      (effectivePlay.yards !== 0 || effectivePlay.isIncomplete) &&
      !/\bno\s+play\b/i.test(effectivePlay.text || '');

    if (canTrustRawSit && rawSitDownClean && rawSitBallPos != null) {
      ballPos = rawSitBallPos;
      resolvedDownOnly = rawSitDownClean;
      resolvedSpotOnly = rawSitSpotClean || formatFieldXToSpot(ballPos);
      if (rawSit?.distance != null && Number.isFinite(Number(rawSit.distance)) && Number(rawSit.distance) > 0) {
        resolvedDistanceYds = Number(rawSit.distance);
      }
    } else if (effectivePlay.endShortDownDist && !endMatchesStart && effEndPos != null) {
      ballPos = effEndPos;
      if (effectivePlay.endTeamId) {
        if (effectivePlay.endTeamId === away.espnId) possessionSide = 'away';
        else if (effectivePlay.endTeamId === home.espnId) possessionSide = 'home';
      } else {
        possessionSide = playSide;
      }
      resolvedDownOnly = effectivePlay.endShortDownDist;
      resolvedDownNum = effectivePlay.endDown || null;
      resolvedDistanceYds = effectivePlay.endDistance || null;
      resolvedSpotOnly = effectivePlay.endSpot || formatFieldXToSpot(ballPos);
    } else {
      // Deterministic NFL rules post-play state calculation (zero 1-2 play lag!)
      ballPos = effEndPos != null ? effEndPos : rawSitBallPos != null ? rawSitBallPos : 50;
      possessionSide = playSide;
      const startDown = Number(effectivePlay.down || 0);
      const startDist = Number(effectivePlay.distance || 0);
      const gained =
        effEndPos != null && effStartPos != null
          ? Math.round((effEndPos - effStartPos) * playDir)
          : Number(effectivePlay.yards || 0);
      const endYte = playDir === 1 ? Math.round(100 - ballPos) : Math.round(ballPos);
      const playText = String(effectivePlay.text || '');

      if (startDown >= 1 && startDown <= 4 && startDist > 0) {
        const isNoPlayPenalty = effectivePlay.isPenalty && /\bno\s+play\b/i.test(playText);
        const isAutoFirstDown = /\b(?:automatic\s+first\s+down|first\s+down)\b/i.test(playText);
        const isLossOfDown = effectivePlay.isPenalty && /\bloss\s+of\s+down\b/i.test(playText);

        if (isAutoFirstDown || (!isNoPlayPenalty && !effectivePlay.isIncomplete && gained >= startDist)) {
          resolvedDownNum = 1;
          resolvedDistanceYds = Math.min(10, Math.max(1, endYte));
          resolvedDownOnly = formatDownAndDistance(1, resolvedDistanceYds, endYte);
        } else if (isNoPlayPenalty) {
          resolvedDownNum = isLossOfDown ? startDown + 1 : startDown;
          resolvedDistanceYds = Math.max(1, startDist - gained);
          if (resolvedDownNum > 4) {
            possessionSide = playSide === 'away' ? 'home' : 'away';
            const oppYte = possessionSide === 'away' ? Math.round(100 - ballPos) : Math.round(ballPos);
            resolvedDownNum = 1;
            resolvedDistanceYds = Math.min(10, Math.max(1, oppYte));
            resolvedDownOnly = formatDownAndDistance(1, resolvedDistanceYds, oppYte);
          } else {
            resolvedDownOnly = formatDownAndDistance(resolvedDownNum, resolvedDistanceYds, endYte);
          }
        } else {
          const nextD = startDown + 1;
          const nextDist = effectivePlay.isIncomplete ? startDist : Math.max(1, startDist - gained);
          if (nextD > 4) {
            // Turnover on downs!
            possessionSide = playSide === 'away' ? 'home' : 'away';
            const oppYte = possessionSide === 'away' ? Math.round(100 - ballPos) : Math.round(ballPos);
            resolvedDownNum = 1;
            resolvedDistanceYds = Math.min(10, Math.max(1, oppYte));
            resolvedDownOnly = formatDownAndDistance(1, resolvedDistanceYds, oppYte);
          } else {
            resolvedDownNum = nextD;
            resolvedDistanceYds = nextDist;
            resolvedDownOnly = formatDownAndDistance(nextD, nextDist, endYte);
          }
        }
      } else if (rawSitDownClean) {
        resolvedDownOnly = rawSitDownClean;
      }
      resolvedSpotOnly = effectivePlay.endSpot || formatFieldXToSpot(ballPos);
    }
  } else {
    // Opening kickoff / no scrimmage plays yet
    if (rawSitBallPos != null) ballPos = rawSitBallPos;
    if (rawSitDownClean) resolvedDownOnly = rawSitDownClean;
    if (rawSitSpotClean) resolvedSpotOnly = rawSitSpotClean;
  }

  // Fallback ballPos chain if still null
  if (ballPos == null && latestDrive && Array.isArray(latestDrive.plays)) {
    for (let i = latestDrive.plays.length - 1; i >= 0; i -= 1) {
      if (latestDrive.plays[i]?.endPos != null) {
        ballPos = latestDrive.plays[i].endPos;
        break;
      }
      if (latestDrive.plays[i]?.startPos != null) {
        ballPos = latestDrive.plays[i].startPos;
        break;
      }
    }
  }
  if (ballPos == null) ballPos = 50;

  // Field Goal kick spot (ball sits at the scrimmage kick spot, e.g. GB 20 for a 38-yd FG, NOT the goal line!)
  let fgKickSpotPos0to100 = null;
  if (isFieldGoalLastPlay) {
    const fgSide = effectiveDrive?.teamSide || possessionSide;
    if (effectivePlay?.startPos != null && effectivePlay.startPos > 0 && effectivePlay.startPos < 100) {
      fgKickSpotPos0to100 = effectivePlay.startPos;
    } else if (effectivePlay?.spotOnly) {
      fgKickSpotPos0to100 = parseSpotTextToFieldX(effectivePlay.spotOnly, away.abbr, home.abbr);
    }
    if (fgKickSpotPos0to100 == null && rawSit?.possessionText && !hasTrailingAdminStoppage) {
      fgKickSpotPos0to100 = parseSpotTextToFieldX(rawSit.possessionText, away.abbr, home.abbr);
    }
    if (fgKickSpotPos0to100 == null && effectivePlay?.fgDistance) {
      const losYd = Math.max(1, Math.min(60, Number(effectivePlay.fgDistance) - 17));
      fgKickSpotPos0to100 = fgSide === 'away' ? 100 - losYd : losYd;
    }
    if (fgKickSpotPos0to100 != null) {
      ballPos = fgKickSpotPos0to100;
    }
  }

  // Apply final resolved possession & live timeouts onto away/home scorebug objects
  const possessionAbbr = possessionSide === 'away' ? away.abbr : home.abbr;
  if (isLive) {
    away.hasPossession = possessionSide === 'away';
    home.hasPossession = possessionSide === 'home';
    const inferredTo = inferTimeoutsRemainingFromDrives(parsedDrivesChrono, currentPeriod, away, home);
    if (rawSit?.awayTimeouts != null) {
      away.timeoutsRemaining = Math.max(0, Math.min(3, Number(rawSit.awayTimeouts)));
    } else if (lastPlayRawTimeouts.away != null) {
      away.timeoutsRemaining = Math.max(0, Math.min(3, lastPlayRawTimeouts.away));
    } else if (away.timeoutsRemaining == null) {
      away.timeoutsRemaining = inferredTo.away;
    }
    if (rawSit?.homeTimeouts != null) {
      home.timeoutsRemaining = Math.max(0, Math.min(3, Number(rawSit.homeTimeouts)));
    } else if (lastPlayRawTimeouts.home != null) {
      home.timeoutsRemaining = Math.max(0, Math.min(3, lastPlayRawTimeouts.home));
    } else if (home.timeoutsRemaining == null) {
      home.timeoutsRemaining = inferredTo.home;
    }
  }

  // Compute directionally valid `prevPos` so arrows NEVER point backwards on timeouts or corrupted yardLine data
  let prevPos = ballPos;
  if (isFieldGoalLastPlay || (isAdminStoppageLastPlay && !hasTrailingAdminStoppage)) {
    prevPos = ballPos;
  } else if (effectivePlay && !hasTrailingAdminStoppage) {
    const playSide = effectiveDrive?.teamSide || possessionSide;
    const playDir = playSide === 'away' ? 1 : -1;
    const rawPrev = effectivePlay.startPos != null ? effectivePlay.startPos : ballPos;
    const yds = Number(effectivePlay.yards || 0);
    if (!effectivePlay.isTurnover && !effectivePlay.isPunt && !effectivePlay.isKickoff) {
      if (yds === 0 || effectivePlay.isIncomplete) {
        prevPos = ballPos;
      } else {
        const expectedPrev = Math.max(0, Math.min(100, ballPos - playDir * yds));
        const rawDeltaInDir = (ballPos - rawPrev) * playDir;
        const wrongSign = (yds > 0 && rawDeltaInDir <= 0) || (yds < 0 && rawDeltaInDir >= 0);
        const wildlyOff = Math.abs(rawDeltaInDir - yds) > 12;
        prevPos = wrongSign || wildlyOff ? expectedPrev : rawPrev;
      }
    } else {
      prevPos = rawPrev;
    }
  }

  const distanceYds =
    resolvedDistanceYds != null && Number.isFinite(resolvedDistanceYds) && resolvedDistanceYds > 0
      ? resolvedDistanceYds
      : canTrustRawSit && rawSit?.distance != null && Number(rawSit.distance) > 0
        ? Number(rawSit.distance)
        : 10;
  const firstDownPos =
    possessionSide === 'away'
      ? Math.min(100, ballPos + distanceYds)
      : Math.max(0, ballPos - distanceYds);

  // Red Zone must reflect the RESOLVED possessing team & ball position (never a punt to the opponent's 18!)
  const isRedZone =
    !scoringPlayType &&
    !isFieldGoalLastPlay &&
    (possessionSide === 'away' ? ballPos >= 80 && ballPos < 100 : ballPos <= 20 && ballPos > 0);

  const spotOnlyText = resolvedSpotOnly || formatFieldXToSpot(ballPos);
  const scoringShortLabel =
    scoringPlayType === 'touchdown'
      ? `TOUCHDOWN ${scoringTeamObj.abbr || possessionAbbr}!`
      : scoringPlayType === 'field_goal'
        ? `FIELD GOAL ${scoringTeamObj.abbr || possessionAbbr}`
        : scoringPlayType === 'safety'
          ? `SAFETY ${scoringTeamObj.abbr || possessionAbbr}`
          : scoringPlayType === 'extra_point'
            ? `EXTRA POINT ${scoringTeamObj.abbr || possessionAbbr}`
            : scoringPlayType === 'two_point'
              ? `2-PT CONVERSION ${scoringTeamObj.abbr || possessionAbbr}`
              : '';
  const downOnlyText =
    scoringPlayType
      ? scoringShortLabel
      : resolvedDownOnly || sanitizeDownDistanceText(rawSit?.shortDownDistanceText || '') || '1st & 10';
  const downDistanceText =
    scoringPlayType
      ? scoringShortLabel
      : downOnlyText && spotOnlyText
        ? `${downOnlyText} at ${spotOnlyText}`
        : downOnlyText || spotOnlyText || '';

  const lastPlayText = String(latestPlay?.text || rawSit?.lastPlay?.text || '').trim();
  const lastPlayHeadlineObj = latestPlay
    ? { headline: latestPlay.headline, tone: latestPlay.headlineTone }
    : rawSit?.lastPlay
      ? buildPlayHeadline(rawSit.lastPlay)
      : { headline: '', tone: 'neu' };

  const possessingTeamObj = possessionSide === 'away' ? away : home;
  const activeFieldDrive = isFieldGoalLastPlay && effectiveDrive ? effectiveDrive : latestDrive;

  const situation = {
    possessionSide,
    possessionAbbr,
    downDistanceText,
    shortDownDistanceText: downOnlyText,
    downOnlyText,
    spotOnlyText,
    possessionText: spotOnlyText,
    isRedZone,
    isTouchdownLastPlay,
    isFieldGoalLastPlay,
    isFieldGoalGoodLastPlay,
    isFieldGoalMissedLastPlay,
    isSafetyLastPlay,
    scoringPlayType,
    scoringTeamSide,
    scoringTeamAbbr: scoringTeamObj.abbr || possessionAbbr,
    scoringTeamLogo: scoringTeamObj.logoUrl || buildEspnTeamLogoUrl(scoringTeamObj.abbr || possessionAbbr),
    fgKickSpotPos0to100: fgKickSpotPos0to100 != null ? Math.max(0, Math.min(100, fgKickSpotPos0to100)) : null,
    ballPos0to100: Math.max(0, Math.min(100, ballPos)),
    prevPos0to100: Math.max(0, Math.min(100, prevPos)),
    driveStartPos0to100:
      activeFieldDrive?.driveStartPos != null
        ? Math.max(0, Math.min(100, activeFieldDrive.driveStartPos))
        : Math.max(0, Math.min(100, prevPos)),
    firstDownPos0to100: Math.max(0, Math.min(100, firstDownPos)),
    lastPlayId: String(latestPlay?.id || rawSit?.lastPlay?.id || ''),
    lastPlayText,
    lastPlayHeadline: lastPlayHeadlineObj.headline,
    lastPlayHeadlineTone: lastPlayHeadlineObj.tone,
    lastPlayIsPass: Boolean(effectivePlay?.isPass && !hasTrailingAdminStoppage),
    lastPlayIsRun: Boolean(effectivePlay?.isRun && !hasTrailingAdminStoppage),
    lastPlayIsSack: Boolean(effectivePlay?.isSack && !hasTrailingAdminStoppage),
    lastPlayIsIncomplete: Boolean(effectivePlay?.isIncomplete && !hasTrailingAdminStoppage),
    lastPlayIsTurnover: Boolean(effectivePlay?.isTurnover && !hasTrailingAdminStoppage),
    lastPlayIsStoppage: isAdminStoppageLastPlay,
    lastPlayYards: effectivePlay?.yards ?? 0,
    currentDriveSummary: activeFieldDrive?.summary || '',
    currentDriveTeamAbbr: activeFieldDrive?.teamAbbr || possessingTeamObj.abbr || possessionAbbr,
    currentDriveTeamLogo: activeFieldDrive?.teamLogoUrl || possessingTeamObj.logoUrl || buildEspnTeamLogoUrl(possessionAbbr),
    currentDriveTeamName: activeFieldDrive?.teamName || possessingTeamObj.shortName || possessionAbbr
  };

  // Quarter filter ordering
  const quarterOrder = ['Q1', 'Q2', 'Q3', 'Q4', 'OT', '2OT'];
  const quartersAvailable = quarterOrder.filter(q => quartersSet.has(q));

  // Box Score (both teams)
  const teamBoxGroups = parseTeamBoxScoreGroups(summaryJson, activeSide.abbr);
  const oppBoxGroups = parseTeamBoxScoreGroups(summaryJson, oppSide.abbr);
  const awayBoxGroups = teamIsHome ? oppBoxGroups : teamBoxGroups;
  const homeBoxGroups = teamIsHome ? teamBoxGroups : oppBoxGroups;

  // Game Leaders (Top Players for Passing, Rushing, Receiving, Sacks, Tackles)
  const gameLeaders = extractGameLeaders(summaryJson, awayBoxGroups, homeBoxGroups, away, home);

  // Single-Game Team Stats
  const teamStatsGroups = parseTeamStatsComparisonGroups(summaryJson, away.abbr, home.abbr);

  const venueName = String(summaryJson.gameInfo?.venue?.fullName || gameMeta.venue || '').trim();
  const broadcast = String(comp.broadcasts?.[0]?.media?.shortName || '').trim();

  return {
    gameId,
    isFallback: false,
    state: isLive ? 'in' : isFinal ? 'post' : 'pre',
    isLive,
    isFinal,
    isPre,
    statusDetail: String(statusType.shortDetail || statusType.description || gameMeta.statusDetail || '').trim(),
    clock: String(comp.status?.displayClock || '').trim(),
    period: Number(comp.status?.period || 0) || 0,
    venue: venueName,
    broadcast,
    gameUrl: sanitizeExternalUrl(gameMeta.gameUrl, `https://www.espn.com/nfl/game/_/gameId/${gameId}`),
    fetchedAtIso: new Date().toISOString(),
    away,
    home,
    teamIsHome,
    activeSide,
    oppSide,
    quarterHeaders,
    winProb,
    situation,
    boxScore: {
      team: teamBoxGroups,
      opponent: oppBoxGroups
    },
    gameLeaders,
    teamStatsGroups,
    drivesChrono: parsedDrivesChrono,
    quartersAvailable,
    totalPlays: parsedDrivesChrono.reduce((acc, d) => acc + d.plays.length, 0),
    highlightClipCount: videos.length
  };
}

/**
 * Extracts a compact, deterministic change-detection fingerprint from ESPN's ultra-lightweight
 * `sports.core.api.espn.com/.../situation` (~2 KB JSON) so 2-second Play-by-Play polling
 * detects finished plays instantly and only fetches the full `summary` on actual changes.
 */
export function extractFastSituationFingerprint(situationJson) {
  if (!situationJson || typeof situationJson !== 'object') return null;
  const lastPlayRef = String(situationJson.lastPlay?.$ref || situationJson.lastPlay?.id || '');
  const lastPlayIdMatch = lastPlayRef.match(/\/plays\/(\d+)/) || lastPlayRef.match(/^(\d+)$/);
  const lastPlayId = lastPlayIdMatch ? lastPlayIdMatch[1] : lastPlayRef;
  const state = String(situationJson.state || '').trim().toLowerCase();
  const clock = String(situationJson.clock || '').trim();
  const period = Number(situationJson.period ?? 0);
  const totalPlays = Number(situationJson.totalPlays ?? -1);
  const down = Number(situationJson.down ?? -1);
  const distance = Number(situationJson.distance ?? -1);
  const yardLine = Number(situationJson.yardLine ?? -1);
  const possession = String(situationJson.possession?.$ref || situationJson.possession || '');
  const homeTo = Number(situationJson.homeTimeouts ?? -1);
  const awayTo = Number(situationJson.awayTimeouts ?? -1);
  const isRedZone = Boolean(situationJson.isRedZone);
  const downDistanceText = String(situationJson.downDistanceText || situationJson.shortDownDistanceText || '').trim();

  const fingerprint = [
    state,
    period,
    clock,
    totalPlays,
    lastPlayId,
    down,
    distance,
    yardLine,
    possession,
    homeTo,
    awayTo,
    isRedZone ? 1 : 0,
    downDistanceText
  ].join('|');
  return {
    fingerprint,
    state,
    clock,
    period,
    totalPlays: totalPlays >= 0 ? totalPlays : null,
    lastPlayId,
    down,
    distance,
    yardLine,
    homeTimeouts: homeTo >= 0 ? homeTo : null,
    awayTimeouts: awayTo >= 0 ? awayTo : null,
    isRedZone,
    downDistanceText
  };
}

/**
 * Deterministic offline / instant-boot fallback built strictly from local `schedule-matchup.json`
 * (plus `lastCompletedGameRecap` when available for the selected game).
 * Guarantees zero blank screens or console/network failures when offline or pre-kickoff.
 */
export function buildFallbackGamecastFromSchedule(gameMeta, appData = {}) {
  if (!gameMeta) return null;
  const teamCfg = getActiveTeamConfig();
  const activeAbbr = normalizeCanonicalTeamAbbr(teamCfg.abbr || 'SF');
  const oppAbbr = normalizeCanonicalTeamAbbr(gameMeta.oppAbbr || gameMeta.opponent?.abbr || 'OPP');
  const oppName = gameMeta.oppName || gameMeta.opponent?.name || oppAbbr;
  const oppShort = oppName.split(/\s+/).pop() || oppAbbr;
  const teamIsHome = gameMeta.homeAway !== 'away';
  const recap =
    appData?.scheduleMatchup?.lastCompletedGameRecap &&
    String(appData.scheduleMatchup.lastCompletedGameRecap.gameId || '') === String(gameMeta.id || '')
      ? appData.scheduleMatchup.lastCompletedGameRecap
      : null;

  const activeObj = {
    espnId: String(teamCfg.espnId || ''),
    abbr: activeAbbr,
    name: teamCfg.name || activeAbbr,
    shortName: teamCfg.nickname || activeAbbr,
    logoUrl: gameMeta.sfLogoUrl || buildEspnTeamLogoUrl(activeAbbr),
    color: sanitizeTeamHexColor(teamCfg.primaryHex, activeAbbr),
    score: gameMeta.sfScore != null ? Number(gameMeta.sfScore) : null,
    record: String(appData?.meta?.teamRecord || '').split(' ')[0] || '',
    linescores: Array.isArray(recap?.sfLinescores) && recap.sfLinescores.length >= 4
      ? recap.sfLinescores.map(String)
      : gameMeta.completed
        ? ['—', '—', '—', '—']
        : ['—', '—', '—', '—'],
    isActive: true,
    winner: gameMeta.result === 'W',
    timeoutsRemaining: gameMeta.isLive ? 3 : null,
    hasPossession: false
  };

  const oppObj = {
    espnId: '',
    abbr: oppAbbr,
    name: oppName,
    shortName: oppShort,
    logoUrl: gameMeta.oppLogoUrl || buildEspnTeamLogoUrl(oppAbbr),
    color: sanitizeTeamHexColor('', oppAbbr),
    score: gameMeta.oppScore != null ? Number(gameMeta.oppScore) : null,
    record: String(gameMeta.raw?.opponent?.record || '').trim(),
    linescores: Array.isArray(recap?.oppLinescores) && recap.oppLinescores.length >= 4
      ? recap.oppLinescores.map(String)
      : ['—', '—', '—', '—'],
    isActive: false,
    winner: gameMeta.result === 'L',
    timeoutsRemaining: gameMeta.isLive ? 3 : null,
    hasPossession: false
  };

  const away = teamIsHome ? oppObj : activeObj;
  const home = teamIsHome ? activeObj : oppObj;

  // Populate fallback team stats & leaders if `lastCompletedGameRecap` matches this game
  const teamStatsGroups = [];
  if (recap?.sfTeamStats && recap?.oppTeamStats) {
    const sfTs = recap.sfTeamStats;
    const opTs = recap.oppTeamStats;
    const aTs = teamIsHome ? opTs : sfTs;
    const hTs = teamIsHome ? sfTs : opTs;
    const mkFb = (label, aVal, hVal, { lowerBetter = false, aNum = null, hNum = null } = {}) => {
      const aN = aNum != null ? aNum : parseTeamStatNumber(aVal);
      const hN = hNum != null ? hNum : parseTeamStatNumber(hVal);
      const tot = Math.abs(aN) + Math.abs(hN);
      const aPct = tot > 0 ? Math.max(8, Math.min(92, Math.round((Math.abs(aN) / tot) * 100))) : 50;
      return {
        key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        label,
        awayDisplay: String(aVal ?? '—'),
        homeDisplay: String(hVal ?? '—'),
        awayNum: aN,
        homeNum: hN,
        awayPct: aPct,
        homePct: 100 - aPct,
        awayLeads: lowerBetter ? aN < hN : aN > hN,
        homeLeads: lowerBetter ? hN < aN : hN > aN,
        lowerBetter,
        sub: ''
      };
    };
    teamStatsGroups.push({
      id: 'output',
      title: 'Output & Efficiency',
      rows: [
        mkFb('Total Yards', aTs.totalYards, hTs.totalYards),
        mkFb('Passing Yards', aTs.netPassingYards, hTs.netPassingYards),
        mkFb('Rushing Yards', aTs.rushingYards, hTs.rushingYards),
        mkFb('1st Downs', aTs.firstDowns, hTs.firstDowns),
        mkFb('3rd Down Eff', aTs.thirdDownEff || '—', hTs.thirdDownEff || '—'),
        mkFb('Turnovers', aTs.turnovers, hTs.turnovers, { lowerBetter: true }),
        mkFb('Possession Time', aTs.possessionTime || '—', hTs.possessionTime || '—')
      ]
    });
  }

  return {
    gameId: String(gameMeta.id || ''),
    isFallback: true,
    state: gameMeta.isLive ? 'in' : gameMeta.completed ? 'post' : 'pre',
    isLive: Boolean(gameMeta.isLive),
    isFinal: Boolean(gameMeta.completed),
    isPre: !gameMeta.isLive && !gameMeta.completed,
    statusDetail: gameMeta.statusDetail || (gameMeta.completed ? 'Final' : 'Scheduled'),
    clock: '',
    period: 0,
    venue: gameMeta.venue || '',
    broadcast: '',
    gameUrl: gameMeta.gameUrl || `https://www.espn.com/nfl/game/_/gameId/${gameMeta.id}`,
    fetchedAtIso: null,
    away,
    home,
    teamIsHome,
    activeSide: activeObj,
    oppSide: oppObj,
    quarterHeaders: ['1', '2', '3', '4'],
    winProb: {
      teamPct: gameMeta.completed && gameMeta.result ? (gameMeta.result === 'W' ? 100 : gameMeta.result === 'L' ? 0 : 50) : null,
      oppPct: gameMeta.completed && gameMeta.result ? (gameMeta.result === 'W' ? 0 : gameMeta.result === 'L' ? 100 : 50) : null,
      teamPctExact: gameMeta.completed && gameMeta.result ? (gameMeta.result === 'W' ? 100 : gameMeta.result === 'L' ? 0 : 50) : null,
      oppPctExact: gameMeta.completed && gameMeta.result ? (gameMeta.result === 'W' ? 0 : gameMeta.result === 'L' ? 100 : 50) : null,
      leadingSide: gameMeta.completed && gameMeta.result ? (gameMeta.result === 'W' ? 'team' : gameMeta.result === 'L' ? 'opp' : 'tied') : 'tied',
      totalPeriods: 4,
      series: [],
      points: [],
      deltaByPlayId: {}
    },
    situation: {
      possessionSide: teamIsHome ? 'home' : 'away',
      possessionAbbr: activeAbbr,
      downDistanceText: gameMeta.isLive ? gameMeta.statusDetail || 'In Progress' : '',
      shortDownDistanceText: '',
      downOnlyText: '',
      spotOnlyText: '',
      possessionText: '',
      isRedZone: false,
      isTouchdownLastPlay: false,
      ballPos0to100: 50,
      prevPos0to100: 50,
      driveStartPos0to100: 50,
      firstDownPos0to100: 60,
      lastPlayId: '',
      lastPlayText: '',
      lastPlayHeadline: '',
      lastPlayHeadlineTone: 'neu',
      lastPlayIsPass: false,
      lastPlayIsRun: false,
      lastPlayIsSack: false,
      lastPlayIsIncomplete: false,
      lastPlayIsTurnover: false,
      lastPlayYards: 0,
      currentDriveSummary: '',
      currentDriveTeamAbbr: activeAbbr,
      currentDriveTeamLogo: activeObj.logoUrl,
      currentDriveTeamName: activeObj.shortName
    },
    boxScore: { team: [], opponent: [] },
    gameLeaders: [],
    teamStatsGroups,
    drivesChrono: [],
    quartersAvailable: [],
    totalPlays: 0,
    highlightClipCount: 0
  };
}
