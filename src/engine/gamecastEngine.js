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
  const isPass =
    /\bpass\b|interception|sack/.test(typeText) ||
    /\bpass\s+(?:short|deep|incomplete|complete|to\b)|sacked\b|intercepted\b/.test(text);
  const isRun =
    !isPass &&
    (/\brush\b|scramble|kneel/.test(typeText) ||
      /\b(up the middle|left guard|right guard|left tackle|right tackle|left end|right end|scrambles|rush|rushed)\b/.test(
        text
      ));
  const isSack = /\bsack/.test(typeText) || /\bsacked\b/.test(text);
  const isTurnover =
    /\b(interception|fumble\s+recovery\s*\(opponent\)|fumble\s+return)/.test(typeText) ||
    /\b(intercepted|fumbles.*recovered\s+by)\b/.test(text);
  const isPenalty = /\bpenalty\b/.test(typeText) || /^penalty\b/.test(text);
  const isKickOrPunt = /\b(kickoff|punt|field\s+goal|extra\s+point|two-point)\b/.test(typeText);
  return { isPass, isRun, isSack, isTurnover, isPenalty, isKickOrPunt };
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

function buildCompactWinProbSeries(rawWinProb = [], teamIsHome = true, maxPoints = 44) {
  if (!Array.isArray(rawWinProb) || rawWinProb.length === 0) {
    return { teamPct: null, oppPct: null, series: [], deltaByPlayId: {} };
  }
  const normalized = [];
  const deltaByPlayId = {};
  let prevTeamPct = null;

  for (const pt of rawWinProb) {
    const homeWin = Number(pt?.homeWinPercentage);
    if (!Number.isFinite(homeWin)) continue;
    const teamRaw = teamIsHome ? homeWin : 1 - homeWin;
    const teamPctExact = Math.max(0, Math.min(100, teamRaw * 100));
    normalized.push(teamPctExact);
    const playId = pt?.playId != null ? String(pt.playId) : '';
    if (playId && prevTeamPct != null) {
      const diff = teamPctExact - prevTeamPct;
      if (Math.abs(diff) >= 0.4) {
        deltaByPlayId[playId] = `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`;
      }
    }
    prevTeamPct = teamPctExact;
  }

  if (normalized.length === 0) {
    return { teamPct: null, oppPct: null, series: [], deltaByPlayId: {} };
  }

  const latestTeamPct = Math.round(normalized[normalized.length - 1]);
  const series = [];
  if (normalized.length <= maxPoints) {
    for (const v of normalized) series.push(Math.round(v * 10) / 10);
  } else {
    const step = (normalized.length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i += 1) {
      const idx = i === maxPoints - 1 ? normalized.length - 1 : Math.round(i * step);
      series.push(Math.round(normalized[idx] * 10) / 10);
    }
  }

  return {
    teamPct: latestTeamPct,
    oppPct: Math.max(0, 100 - latestTeamPct),
    series,
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
      timeoutsRemaining: null,
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
  const quarterHeaders = [];
  for (let i = 1; i <= periodCount; i += 1) {
    quarterHeaders.push(i <= 4 ? String(i) : i === 5 ? 'OT' : `${i - 4}OT`);
  }
  while (away.linescores.length < periodCount) away.linescores.push(isFinal ? '0' : '—');
  while (home.linescores.length < periodCount) home.linescores.push(isFinal ? '0' : '—');

  // Win Probability + per-play WP delta
  const winProb = buildCompactWinProbSeries(summaryJson.winprobability || [], teamIsHome);
  if (isFinal && activeSide.score != null && oppSide.score != null && winProb.teamPct == null) {
    winProb.teamPct = activeSide.score > oppSide.score ? 100 : activeSide.score < oppSide.score ? 0 : 50;
    winProb.oppPct = 100 - winProb.teamPct;
  }

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
        const per = pl?.period?.number || startPeriod;
        const qLbl = parseQuarterLabel(per);
        quartersSet.add(qLbl);
        const clock = String(pl?.clock?.displayValue || '').trim();
        const downDist = String(pl?.start?.shortDownDistanceText || pl?.start?.downDistanceText || '').trim();
        const spot = String(pl?.start?.possessionText || '').trim();
        const downDistanceSpot =
          downDist && spot
            ? `${downDist} • ${spot}`
            : downDist || spot || String(pl?.type?.text || '').trim();
        const yds = Number(pl?.statYardage);
        const yards = Number.isFinite(yds) ? yds : 0;
        const isScoring = Boolean(pl?.scoringPlay);
        const kind = classifyPlayKind(pl);
        const downNum = Number(pl?.start?.down || 0);
        const isKeyPlay =
          isScoring ||
          kind.isTurnover ||
          kind.isSack ||
          downNum === 4 ||
          Math.abs(yards) >= 15;

        const startPos =
          pl?.start?.yardsToEndzone != null
            ? yardsToEndzoneToFieldX(pl.start.yardsToEndzone, dTeamSide)
            : parseSpotTextToFieldX(spot, away.abbr, home.abbr);
        const endPos =
          pl?.end?.yardsToEndzone != null
            ? yardsToEndzoneToFieldX(pl.end.yardsToEndzone, dTeamSide)
            : parseSpotTextToFieldX(pl?.end?.possessionText || '', away.abbr, home.abbr);

        const clip = matchVideoClipToPlay(text, isScoring, kind.isTurnover, videos, usedClipIds);

        return {
          id: pid,
          period: Number(per) || 1,
          quarterLabel: qLbl,
          clock,
          down: downNum || null,
          distance: Number(pl?.start?.distance || 0) || null,
          downDistanceSpot,
          text,
          yards,
          isScoring,
          isKeyPlay,
          isPass: kind.isPass,
          isRun: kind.isRun,
          isSack: kind.isSack,
          isTurnover: kind.isTurnover,
          isPenalty: kind.isPenalty,
          awayScoreAfter: pl?.awayScore != null ? Number(pl.awayScore) : null,
          homeScoreAfter: pl?.homeScore != null ? Number(pl.homeScore) : null,
          wpDelta: winProb.deltaByPlayId[pid] || '',
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

  // Live situation & animated field geometry
  const rawSit = summaryJson.situation || comp.situation || null;
  const latestDrive = parsedDrivesChrono.length > 0 ? parsedDrivesChrono[parsedDrivesChrono.length - 1] : null;
  const latestPlay = latestDrive && latestDrive.plays.length > 0 ? latestDrive.plays[latestDrive.plays.length - 1] : null;

  let possessionTeamId = String(rawSit?.possession || '').trim();
  let possessionSide = latestDrive?.teamSide || 'away';
  if (possessionTeamId) {
    if (possessionTeamId === away.espnId) possessionSide = 'away';
    else if (possessionTeamId === home.espnId) possessionSide = 'home';
  }
  const possessionAbbr = possessionSide === 'away' ? away.abbr : home.abbr;
  if (isLive) {
    away.hasPossession = possessionSide === 'away';
    home.hasPossession = possessionSide === 'home';
    if (rawSit?.awayTimeouts != null) away.timeoutsRemaining = Math.max(0, Math.min(3, Number(rawSit.awayTimeouts)));
    if (rawSit?.homeTimeouts != null) home.timeoutsRemaining = Math.max(0, Math.min(3, Number(rawSit.homeTimeouts)));
  }

  let ballPos = null;
  if (rawSit?.yardLine != null) {
    const yte = rawSit?.yardsToEndzone != null ? Number(rawSit.yardsToEndzone) : null;
    if (yte != null && Number.isFinite(yte)) {
      ballPos = yardsToEndzoneToFieldX(yte, possessionSide);
    } else if (rawSit?.possessionText) {
      ballPos = parseSpotTextToFieldX(rawSit.possessionText, away.abbr, home.abbr);
    }
  }
  if (ballPos == null && latestPlay?.endPos != null) {
    ballPos = latestPlay.endPos;
  }
  if (ballPos == null) ballPos = 50;

  const prevPos = latestPlay?.startPos != null ? latestPlay.startPos : ballPos;
  const distanceYds = Number(rawSit?.distance ?? latestPlay?.distance ?? 10);
  const firstDownPos =
    possessionSide === 'away'
      ? Math.min(100, ballPos + (Number.isFinite(distanceYds) ? distanceYds : 10))
      : Math.max(0, ballPos - (Number.isFinite(distanceYds) ? distanceYds : 10));

  const isRedZone =
    Boolean(rawSit?.isRedZone) ||
    (possessionSide === 'away' ? ballPos >= 80 && ballPos < 100 : ballPos <= 20 && ballPos > 0);
  const isTouchdownLastPlay = Boolean(latestPlay?.isScoring && /touchdown/i.test(latestPlay?.text || ''));
  const downDistanceText =
    String(rawSit?.downDistanceText || rawSit?.shortDownDistanceText || '').trim() ||
    (isTouchdownLastPlay
      ? `TOUCHDOWN ${possessionAbbr}!`
      : latestPlay?.downDistanceSpot || '');

  const situation = {
    possessionSide,
    possessionAbbr,
    downDistanceText,
    shortDownDistanceText: String(rawSit?.shortDownDistanceText || downDistanceText).trim(),
    possessionText: String(rawSit?.possessionText || '').trim(),
    isRedZone,
    isTouchdownLastPlay,
    ballPos0to100: Math.max(0, Math.min(100, ballPos)),
    prevPos0to100: Math.max(0, Math.min(100, prevPos)),
    driveStartPos0to100:
      latestDrive?.driveStartPos != null
        ? Math.max(0, Math.min(100, latestDrive.driveStartPos))
        : Math.max(0, Math.min(100, prevPos)),
    firstDownPos0to100: Math.max(0, Math.min(100, firstDownPos)),
    lastPlayId: String(rawSit?.lastPlay?.id || latestPlay?.id || ''),
    lastPlayText: String(rawSit?.lastPlay?.text || latestPlay?.text || '').trim(),
    lastPlayIsPass: Boolean(latestPlay?.isPass),
    lastPlayIsRun: Boolean(latestPlay?.isRun),
    lastPlayYards: latestPlay?.yards ?? 0,
    currentDriveSummary: latestDrive?.summary || ''
  };

  // Quarter filter ordering
  const quarterOrder = ['Q1', 'Q2', 'Q3', 'Q4', 'OT', '2OT'];
  const quartersAvailable = quarterOrder.filter(q => quartersSet.has(q));

  // Box Score (both teams)
  const teamBoxGroups = parseTeamBoxScoreGroups(summaryJson, activeSide.abbr);
  const oppBoxGroups = parseTeamBoxScoreGroups(summaryJson, oppSide.abbr);

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
  const down = Number(situationJson.down ?? -1);
  const distance = Number(situationJson.distance ?? -1);
  const yardLine = Number(situationJson.yardLine ?? -1);
  const possession = String(situationJson.possession?.$ref || situationJson.possession || '');
  const homeTo = Number(situationJson.homeTimeouts ?? -1);
  const awayTo = Number(situationJson.awayTimeouts ?? -1);
  const isRedZone = Boolean(situationJson.isRedZone);
  const downDistanceText = String(situationJson.downDistanceText || situationJson.shortDownDistanceText || '').trim();

  const fingerprint = [lastPlayId, down, distance, yardLine, possession, homeTo, awayTo, isRedZone ? 1 : 0, downDistanceText].join('|');
  return {
    fingerprint,
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
    timeoutsRemaining: null,
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
    timeoutsRemaining: null,
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
      series: [],
      deltaByPlayId: {}
    },
    situation: {
      possessionSide: teamIsHome ? 'home' : 'away',
      possessionAbbr: activeAbbr,
      downDistanceText: gameMeta.isLive ? gameMeta.statusDetail || 'In Progress' : '',
      shortDownDistanceText: '',
      possessionText: '',
      isRedZone: false,
      isTouchdownLastPlay: false,
      ballPos0to100: 50,
      prevPos0to100: 50,
      driveStartPos0to100: 50,
      firstDownPos0to100: 60,
      lastPlayId: '',
      lastPlayText: '',
      lastPlayIsPass: false,
      lastPlayIsRun: false,
      lastPlayYards: 0,
      currentDriveSummary: ''
    },
    boxScore: { team: [], opponent: [] },
    teamStatsGroups,
    drivesChrono: [],
    quartersAvailable: [],
    totalPlays: 0,
    highlightClipCount: 0
  };
}
