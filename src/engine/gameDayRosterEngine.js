/**
 * Game-Day Inactives (T-90m -> Final), Active Roster Unit Grouping,
 * Game-Time Questionable -> In/Out Resolver & Post-Game Next-Week Rollover Engine
 */

import {
  collapseInitialDots,
  computePlayerPlayProbability
} from './injuryProbabilityModel.js';

export const GAME_DAY_INACTIVES_LEAD_MS = 90 * 60_000; // 90 minutes before kickoff
const MAX_LIVE_GAME_DURATION_MS = 5.25 * 3600_000;

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
  const candidates = [...schedule];

  const umDateIso = upcomingMatchup?.dateIso || upcomingMatchup?.kickoffIso || '';
  if (umDateIso && !candidates.some(g => Number(g?.week) === Number(upcomingMatchup.week))) {
    candidates.push({
      id: upcomingMatchup.gameId || upcomingMatchup.id || `wk_${upcomingMatchup.week}`,
      week: upcomingMatchup.week,
      dateIso: umDateIso,
      completed: Boolean(upcomingMatchup.completed),
      opponent: {
        abbr: upcomingMatchup.oppAbbr || upcomingMatchup.opponent?.abbr,
        name: upcomingMatchup.oppName || upcomingMatchup.opponent?.name
      }
    });
  }

  for (const g of candidates) {
    if (!g || g.completed || g.isByeWeek || g.opponent?.isTbd) continue;
    const kickoffMs = Date.parse(g.dateIso || g.kickoffIso || '');
    if (!Number.isFinite(kickoffMs)) continue;

    const windowStartMs = kickoffMs - GAME_DAY_INACTIVES_LEAD_MS;
    const safetyEndMs = kickoffMs + MAX_LIVE_GAME_DURATION_MS;
    if (ts >= windowStartMs && ts <= safetyEndMs) {
      const minutesUntilKickoff = Math.round((kickoffMs - ts) / 60_000);
      const hasKickoffStarted = ts >= kickoffMs;
      return {
        isActive: true,
        phase: hasKickoffStarted ? 'in_game' : 'pregame',
        gameId: (g.id || g.gameId) ? String(g.id || g.gameId) : null,
        week: Number(g.week || upcomingMatchup?.week || 0) || null,
        kickoffIso: g.dateIso || g.kickoffIso,
        kickoffMs,
        minutesUntilKickoff,
        minutesToKickoff: minutesUntilKickoff,
        hasKickoffStarted,
        statusDetail: g.statusDetail || '',
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
    minutesUntilKickoff: null,
    minutesToKickoff: null,
    hasKickoffStarted: false,
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
 * for Sunday/Saturday/Monday games (or Monday afternoon for Thursday games).
 * Before that window, W / T / F columns must remain blank (`'-'`).
 */
export function isBeforeWeeklyPracticeWindow(upcomingGameDateIso = '', nowMs = Date.now()) {
  const kickoffMs = Date.parse(upcomingGameDateIso || '');
  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (!Number.isFinite(kickoffMs)) return false;
  if (ts >= kickoffMs) return false;

  // DST-accurate Pacific calendar day & time-of-day check:
  // First weekly practice report drops ~12:15 PM PT on Wednesday for Sunday games
  // (Monday for Thursday games, Tuesday for Saturday games, Thursday for Monday games).
  const koPt = extractPacificParts(kickoffMs);
  const nowPt = extractPacificParts(ts);
  const leadDays = koPt.weekday === 'Thu' ? 3 : 4;
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

function buildCandidateMatchers(candidatePlayers = []) {
  const seenKeys = new Set();
  const matchers = [];
  for (const p of candidatePlayers || []) {
    const name = String(p?.name || p?.fullName || p?.displayName || '').trim();
    const key = normalizeLookupName(name);
    if (!key || name.length < 4 || seenKeys.has(key)) continue;
    seenKeys.add(key);
    const stripped = name.replace(/\b(Jr\.?|Sr\.?|II|III|IV|V)\b\.?/gi, '').trim();
    const collapsed = collapseInitialDots(stripped);
    const dottedInitials = stripped.replace(/\b([A-Z])([A-Z])\b/g, '$1.$2.');
    const variants = [...new Set([name, stripped, collapsed, dottedInitials].filter(s => s && s.length >= 4))].map(
      s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    );
    if (variants.length > 0) {
      matchers.push({
        key,
        name,
        position: p?.position || 'ATH',
        jersey: p?.jersey ?? null,
        regex: getCachedPlayerRegex(`(?:${variants.join('|')})`)
      });
    }
  }
  return matchers;
}

/**
 * Finds the current game's official "Inactives" article from a club's `/rss/news` XML feed,
 * rejecting prior-week inactive articles by checking both `Week N` tags and publish window `[kickoff - 10h, kickoff + 5h]`.
 */
export function discoverOfficialClubInactivesRssItem(rssXml = '', { kickoffMs = 0, week = null } = {}) {
  if (!rssXml || typeof rssXml !== 'string') return null;
  const blocks = rssXml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const minPub = Number.isFinite(kickoffMs) && kickoffMs > 0 ? kickoffMs - 10 * 3_600_000 : 0;
  const maxPub = Number.isFinite(kickoffMs) && kickoffMs > 0 ? kickoffMs + 5 * 3_600_000 : Infinity;

  for (const block of blocks) {
    const title = decodeHtmlEntitiesBasic((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const link = decodeHtmlEntitiesBasic((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '')
      .replace(/<[^>]+>/g, '')
      .trim();
    const description = decodeHtmlEntitiesBasic((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '')
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
      publishedAt: Number.isFinite(pubMs) ? new Date(pubMs).toISOString() : new Date().toISOString(),
      pubMs: Number.isFinite(pubMs) ? pubMs : null
    };
  }
  return null;
}

/**
 * Deterministically parses an official NFL club's unstructured "Inactives" article HTML or text
 * (e.g. `49ers.com/news/deebo-samuel-returns-williams-active-vs-cowboys-inactives-week-10-sfvsdal`)
 * for ANY NFL team (49ers or Opponent):
 *  - Truncates cleanly before `"Related Content"` / `"More News"` footer links so prior-week headlines
 *    ("Bosa, Sigle Active vs. Raiders") never contaminate the current week's roster!
 *  - Extracts both the declared inactive players list AND explicitly confirmed active Questionable players.
 */
export function parseOfficialClubInactivesArticle(
  htmlOrText = '',
  candidatePlayers = [],
  { week = null } = {}
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

  // Locate explicit "Here are the ... inactive players" / "... Inactives:" list block
  const listHeaderRe =
    /(?:here are|below are|check out|full list of)[^.\n]{0,95}?\binactives?(?:\s+players?|\s+list)?[^:\n]{0,65}?:|\b(?:today'?s|game[\s-]?day|week\s*\d+|official|[a-z0-9 .'-]{2,28})\s+inactives?(?:\s+list|\s+for\s+[^\n:]{2,45})?\s*:|\bdeclared the following players?\s+inactive\b[^:\n]*:?|\bfollowing players?\s+(?:are|will be)\s+inactive\b[^:\n]*:?/i;
  const listMatch = listHeaderRe.exec(cleaned);

  const prosePart = listMatch ? cleaned.slice(0, listMatch.index) : cleaned;
  const listPart = listMatch ? cleaned.slice(listMatch.index + listMatch[0].length, listMatch.index + listMatch[0].length + 1400) : '';

  if (listPart) {
    // Stop list block if prose paragraphs resume after the bullet/position list
    const listLines = listPart.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const collectedListLines = [];
    for (const ln of listLines) {
      if (
        collectedListLines.length >= 3 &&
        ln.length > 140 &&
        !/\b(QB|RB|FB|WR|TE|OL|OT|OG|C|T|G|DL|DE|DT|NT|EDGE|LB|ILB|OLB|CB|DB|S|FS|SS|K|PK|P|LS)\b/.test(ln)
      ) {
        break;
      }
      collectedListLines.push(ln);
    }
    const listBlockText = collectedListLines.join('\n') || listPart.slice(0, 650);

    for (const pm of matchers) {
      if (pm.regex.test(listBlockText)) {
        inactiveMap.set(pm.key, {
          name: pm.name,
          position: pm.position,
          jersey: pm.jersey,
          reason: ''
        });
        const emRe = new RegExp(`${pm.regex.source}[^\\n.;]{0,55}\\bemergency\\s+(?:third|3rd)\\s+(?:quarterback|qb)\\b`, 'i');
        if (emRe.test(listBlockText)) {
          emergencyQbKeys.add(pm.key);
        }
      }
    }
  }

  // Also scan prose clauses for explicit active confirmations & individual ruled-out notes (excluding IR remainders)
  const clauses = prosePart
    .split(/[.;!\n]+|\b(?:while|whereas|but|however|meanwhile)\b/i)
    .map(c => c.trim())
    .filter(Boolean);

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

  const blockRe =
    /images\/teamlogo\/football\/([A-Z]{2,3})\.svg[\s\S]{0,450}?<ul\s+class="list[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi;
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
      const nameRaw = decodeHtmlEntitiesBasic((inner.match(/<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || '')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (!nameRaw || nameRaw.length < 3) continue;
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
 * Reconciles Sleeper's CORS-enabled NFL player status feed (`api.sleeper.app/v1/players/nfl`)
 * strictly against the team's known active 53-man roster during the pre-kickoff 90-minute window.
 * Catches 100% of healthy scratches (Coach's Decision) even when a team does not publish an RSS article!
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
  for (const r of injuryReportRows || []) {
    const st = String(r?.gameStatus || r?.status || '');
    if (/injured reserve|\bir\b|suspended|pup/i.test(st)) continue;
    const k = normalizeLookupName(r?.name || '');
    if (k) injByKey.set(k, r);
  }

  const inactives = [];
  const activeCandidateKeys = new Set();
  const seenKeys = new Set();

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
      inactives.push({
        name: rosterMatch.name || fullName,
        position: rosterMatch.position || sp.position || 'ATH',
        jersey: rosterMatch.jersey ?? (sp.number != null ? Number(sp.number) : null),
        reason: sp.injury_body_part || sp.injury_notes || ''
      });
    } else if (!injSt) {
      activeCandidateKeys.add(k);
    }
  }

  const officialPosted = inactives.length >= 3;
  return {
    inactives,
    activeKeys: officialPosted ? activeCandidateKeys : new Set(),
    officialPosted
  };
}

const BODY_PART_IN_GAME_RE =
  /\b(right\s+shoulder|left\s+shoulder|shoulder|right\s+ankle|left\s+ankle|high[\s-]ankle|ankle|right\s+knee|left\s+knee|knee|hamstring|concussion|head|neck|stinger|elbow|wrist|hand|thumb|finger|rib|ribs|chest|pectoral|back|lower\s+back|hip|groin|quad|quadriceps|calf|shin|foot|toe|turf\s+toe|achilles|illness|cramps|eye|jaw)\b/i;

function formatBodyPartTitle(raw = '') {
  const clean = String(raw || '').trim();
  if (!clean) return '';
  return clean
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Evaluates live post-kickoff beat tweets & wire blurbs (`[Kickoff, Final)`) to track real-time
 * in-game injuries and return probabilities for ANY active 49ers or Opponent player:
 *  - Evaluates chronologically so the newest status always wins:
 *    e.g., Q2 injury (`50% • QTR (In-Game)`) -> either ruled out (`0% • Out (In-Game)`) OR returns to game (`99% • In (Active)`)!
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

  const kickoffMs = Number(windowState.kickoffMs);
  if (!Number.isFinite(kickoffMs) || kickoffMs <= 0) {
    return { byKey, list: [] };
  }

  const minInGameMs = kickoffMs - 2 * 60_000;
  const maxInGameMs = kickoffMs + MAX_LIVE_GAME_DURATION_MS;
  const matchers = buildCandidateMatchers(candidatePlayers);
  if (matchers.length === 0) return { byKey, list: [] };

  const relevantItems = [];
  for (const item of newsItems || []) {
    const pubMs = Date.parse(item?.publishedAt || '');
    if (!Number.isFinite(pubMs) || pubMs < minInGameMs || pubMs > maxInGameMs) continue;
    const text = `${item?.title || ''} ${item?.fullText || ''} ${item?.headline || ''} ${item?.summary || ''}`.trim();
    if (!text) continue;
    relevantItems.push({ item, pubMs, text });
  }

  // Sort oldest -> newest so sequential transitions (QTR -> Returned OR QTR -> Ruled Out) resolve to the freshest truth!
  relevantItems.sort((a, b) => a.pubMs - b.pubMs);

  for (const { item, pubMs, text } of relevantItems) {
    // Skip pre-game inactive list recaps posted right around kickoff
    if (/\b(?:today'?s|official|week\s*\d+|game[\s-]?day)\s+inactives\b/i.test(text)) continue;

    const clauses = text
      .split(/[.;!\n]+|\b(?:while|whereas|but|however|meanwhile)\b/i)
      .map(c => c.trim())
      .filter(Boolean);

    for (const clause of clauses) {
      const isReturned =
        /\b(returned to (?:the|sunday'?s|monday'?s|thursday'?s|saturday'?s|today'?s)?\s*(?:game|action|contest|matchup|field)|has returned|is back in the (?:game|huddle|lineup)|back on the field|cleared to return|helmet back on and in)\b/i.test(
          clause
        ) && !/\b(?:not|never|won'?t|will not|unlikely to|questionable to|doubtful to)\s+return\b/i.test(clause);

      const isRuledOutInGame =
        /\b(ruled out(?:\s+for\s+the\s+(?:rest|remainder))?|out for the (?:rest|remainder) of|will not return|won'?t return|done for the (?:day|night|game))\b/i.test(
          clause
        );

      const isDoubtfulInGame =
        !isRuledOutInGame &&
        /\b(doubtful to return|carted (?:off|to the locker room)|in an air cast|unlikely to return)\b/i.test(clause);

      const isQuestionableInGame =
        !isRuledOutInGame &&
        !isDoubtfulInGame &&
        !isReturned &&
        /\b(questionable to return|evaluated for (?:a|an)\b|being evaluated|blue medical tent|medical tent|headed to the locker room|went to the locker room|walked to the locker room|limped off|helped off|shaken up on the play|exited (?:sunday'?s|monday'?s|thursday'?s|saturday'?s|today'?s|the)\s+(?:game|contest|matchup))\b/i.test(
          clause
        );

      if (!isReturned && !isRuledOutInGame && !isDoubtfulInGame && !isQuestionableInGame) continue;

      const bodyMatch = clause.match(BODY_PART_IN_GAME_RE) || text.match(BODY_PART_IN_GAME_RE);
      const extractedBodyPart = bodyMatch ? formatBodyPartTitle(bodyMatch[1]) : '';

      for (const pm of matchers) {
        if (pregameInactiveKeys.has(pm.key)) continue;
        if (!pm.regex.test(clause)) continue;

        const prev = byKey.get(pm.key) || null;
        // Only recognize a "returned to the game" signal if the player had an in-game injury or explicit return report
        if (isReturned && !prev && !extractedBodyPart && !/\breturn(?:ed)?\s+to\s+(?:the\s+|sunday'?s\s+|monday'?s\s+|thursday'?s\s+|saturday'?s\s+)?game\b/i.test(clause)) {
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
 * individual inactive scratches, active confirmations, and rare emergency/GTD active tags.
 * Evaluates status per-clause so mixed tweets ("Bosa is active today, while Evans is inactive")
 * never cross-contaminate active and inactive players.
 */
export function extractWireGameDaySignals(newsItems = [], candidatePlayers = [], kickoffMs = 0) {
  const inactiveKeys = new Set();
  const activeKeys = new Set();
  const gtdActiveKeys = new Set();
  const emergencyQbKeys = new Set();
  let hasOfficialListSignal = false;

  const minPubMs = Number.isFinite(kickoffMs) && kickoffMs > 0 ? kickoffMs - 4.5 * 3600_000 : 0;
  const maxPubMs = Number.isFinite(kickoffMs) && kickoffMs > 0 ? kickoffMs + 4.5 * 3600_000 : Infinity;
  // Do NOT mistake post-kickoff in-game injuries ("ruled out for remainder of Sunday's game") for pregame inactives!
  const pregameCutoffMs = Number.isFinite(kickoffMs) && kickoffMs > 0 ? kickoffMs + 20 * 60_000 : Infinity;

  const playerMatchers = buildCandidateMatchers(candidatePlayers);

  for (const item of newsItems || []) {
    const pubMs = Date.parse(item?.publishedAt || '');
    if (Number.isFinite(pubMs) && (pubMs < minPubMs || pubMs > maxPubMs)) continue;

    const text = `${item?.title || ''} ${item?.fullText || ''} ${item?.headline || ''} ${item?.summary || ''}`.trim();
    if (!text) continue;

    // Ignore mid-game injury exit blurbs after kickoff so they don't mutate the pregame Declared Inactives card
    if (
      Number.isFinite(pubMs) &&
      pubMs > pregameCutoffMs &&
      /\b(to return|remainder of|rest of the|medical tent|locker room|exited|left the game)\b/i.test(text)
    ) {
      continue;
    }

    if (/\binactives?\b\s*[:\-]|game[\s-]?day inactives|today'?s inactives|inactive players for week/i.test(text)) {
      hasOfficialListSignal = true;
    }

    const clauses = text
      .split(/[.;!\n]+|\b(?:while|whereas|but|however|meanwhile)\b/i)
      .map(c => c.trim())
      .filter(Boolean);

    for (const clause of clauses) {
      if (/\b(?:to return|remainder of|rest of the game)\b/i.test(clause)) continue;

      const isInactiveListClause = /\b(?:today'?s |game[\s-]?day |49ers |official |week \d+ )?inactives?(?:\s+players?|\s+list)?\s*:/i.test(clause);
      const isEmergencyQbClause = /\bemergency\s+(?:third|3rd)\s+(?:quarterback|qb)\b/i.test(clause);
      const isInactiveProse =
        isInactiveListClause ||
        /\b(is inactive|are inactive|officially inactive|among .*inactives|ruled out for (?:today|sunday|monday|thursday|saturday)|will not play (?:today|in sunday|in monday|in thursday|in saturday)|won'?t play in (?:sunday|monday|thursday|saturday)'?s game|healthy scratch)\b/i.test(
          clause
        );
      const isEmergencyGtdProse =
        !isInactiveProse &&
        /\b(available only in an emergency|active as (?:an? )?emergency|active.*game-time decision on snaps|snap[\s-]count limit)\b/i.test(
          clause
        );
      const isActiveProse =
        !isInactiveProse &&
        /\b(officially active|is active (?:today|for|against|vs)|are active (?:today|for|against|vs)|active for (?:today|sunday|monday|thursday|saturday)|will play today|cleared to play)\b/i.test(
          clause
        );

      if (!isInactiveProse && !isEmergencyGtdProse && !isActiveProse) continue;

      for (const pm of playerMatchers) {
        if (!pm.regex.test(clause)) continue;
        if (isInactiveProse && !isActiveProse) {
          inactiveKeys.add(pm.key);
          if (isEmergencyQbClause) emergencyQbKeys.add(pm.key);
        } else if (isEmergencyGtdProse) {
          activeKeys.add(pm.key);
          gtdActiveKeys.add(pm.key);
        } else if (isActiveProse && !isInactiveProse) {
          activeKeys.add(pm.key);
        }
      }
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
  const wireSignals = extractWireGameDaySignals(effectiveNews, allCandidates, effectiveWindow.kickoffMs);

  const isOfficialListPosted =
    Boolean(liveFeedData?.officialPosted) ||
    compExplicitInactiveCount >= 3 ||
    wireSignals.hasOfficialListSignal ||
    Boolean(effectiveWindow.hasKickoffStarted);

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
    const isCompInactive = Boolean(compRow?.isExplicitlyInactive);
    const isWireActive = (wireSignals.activeKeys.has(k) || feedActiveKeySet.has(k)) && !isCompInactive;

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
    ? 'Live Game-Day Roster'
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
    : [...(appData?.liveGameDay?.oppWireItems || []), ...(appData?.news?.rawStream || [])];

  let model = null;
  if (
    preHydrated?.isActive &&
    (!liveFeedOverride?.officialPosted || preHydrated.officialPosted) &&
    Number(preHydrated.week || win.week) === Number(win.week)
  ) {
    model = {
      ...preHydrated,
      hasKickoffStarted: Boolean(win.hasKickoffStarted),
      minutesUntilKickoff: win.minutesUntilKickoff,
      windowState: win,
      windowInfo: win
    };
  } else if (is49ers) {
    model = buildTeamGameDayRosterModel({
      teamAbbr: 'SF',
      teamName: 'San Francisco 49ers',
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
  rawStatus = '',
  injuryType = '',
  shortComment = '',
  longComment = '',
  upcomingWeek = null,
  lastCompletedWeek = null,
  playedInCompletedGame = null,
  hasPostKickoffInjurySignal = false
} = {}) {
  const injClean = String(injuryType || '').trim();
  const injLower = injClean.toLowerCase();
  const statusClean = String(rawStatus || '').trim();
  const statusLower = statusClean.toLowerCase();
  const shortTrim = String(shortComment || '').trim();
  const combined = `${shortTrim} ${String(longComment || '').trim()}`.trim();

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
    /\b(sustained|suffered|injured (?:in|during|his|her)|aggravated|re-aggravated|concussion protocol|evaluated for a concussion|left (?:sunday|monday|thursday|saturday|the)[a-z ']* (?:game|win|loss|contest)|exited (?:sunday|monday|thursday|saturday|the)|questionable to return|doubtful to return|did not return|will not return|didn'?t leave unscathed|after the game|following the (?:game|win|loss)|underwent an mri|scheduled for an mri|x-rays?|ct scan|surgery|high-ankle|sprained|strained|week-to-week|out (?:multiple|several) weeks|broken|fracture|torn|placed on injured reserve|ruled out for week)\b/i.test(
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

  // Drop players who were already cleared ahead of the completed game with zero newly sustained in-game or post-game injury
  if (
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
    if (wasExplicitlyClearedInHeadline) {
      return {
        skip: true,
        effectiveStatus: 'Active',
        beatNoteForModel: ''
      };
    }

    const wasClearedPreGame =
      /\b(does not (?:have|carry) (?:an?y? )?(?:official )?(?:injury )?designation|doesn'?t (?:have|carry) (?:an?y? )?(?:official )?(?:injury )?designation|has no (?:official )?(?:injury )?designation|no official injury designation|off the injury report|designation now a thing of the past|return(?:ing)? to action|he'?ll return to action|set to get back on the field|all set to suit up|now set to go|appears to have done him well|gave him some extra recovery time|cleared (?:the league'?s )?concussion protocol)\b/i.test(
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

  const isMultiWeekAbsence =
    isSevereInGameMechanism ||
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

  const missedPriorGame =
    playedInCompletedGame === false ||
    statusLower === 'out' ||
    statusLower === 'inactive' ||
    /\b(is inactive|was inactive|officially inactive|ruled out for (?:sunday|monday|thursday|saturday|today)|will not play|won't play|missing a (?:second|third|fourth) straight|will miss his (?:second|third|fourth) straight)\b/i.test(
      combined
    );

  let priorWeekPracticed = null;
  if (missedPriorGame) {
    if (/\b(trio of limited practices|limited practices during the week|limited all week|practiced on a limited basis)\b/i.test(combined)) {
      priorWeekPracticed = true;
    } else if (
      /\b(hasn't been able to practice|has not been able to practice|trio of '?dnps?'?|did not practice all week|not practicing in any capacity)\b/i.test(
        combined
      )
    ) {
      priorWeekPracticed = false;
    }
  }

  let beatNoteForModel = combined;
  if (effectiveStatus !== 'Out') {
    // Strip prior-game availability & in-game remainder rulings so computePlayerPlayProbability models Week N+1 severity rather than clamping to 0%
    beatNoteForModel = beatNoteForModel
      .replace(
        /\b(ruled out for the (?:rest|remainder) of [^.;,]*|out for the (?:rest|remainder) of (?:the |sunday'?s |monday'?s |thursday'?s |saturday'?s )?(?:game|contest|matchup)|will not return[^.;,]*|won'?t return[^.;,]*|done for the (?:day|night|game)|is inactive|was inactive|officially inactive|ruled out|will not play|won't play|is out for|will miss (?:his |a )?[a-z0-9 -]*(?:game|contest|matchup|tilt|clash)|missing (?:a |his )?[a-z0-9 -]*(?:game|contest|matchup|tilt|clash)|miss(?:ing)? (?:sunday|monday|thursday|saturday)'?s?|inactive (?:sunday|monday|thursday|saturday)|inactive for (?:sunday|monday|thursday|saturday))\b/gi,
        'exited previous game'
      )
      .replace(/^inactive\.?$/i, '');
  }

  return {
    skip: false,
    effectiveStatus,
    beatNoteForModel,
    missedPriorGame,
    priorWeekPracticed
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
      missedPriorGame: clearPracticeDays ? earlyRoll.missedPriorGame : false,
      priorWeekPracticed: clearPracticeDays ? resolvedPriorPracticed : null,
      sustainedInLastGame: sustainedInGame,
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
