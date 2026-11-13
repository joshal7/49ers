/**
 * Year-Round Dashboard & League-Cycle Engine for 49ers Faithful
 * All views (Matchup, Health, Schedule, Stats, Trade, Playoffs, Draft, Draft Recap)
 * are permanently live year-round without Archive exile or calendar-phase content gates.
 */

import {
  buildMockDraftBigBoardUrl,
  normalizePlayerKey,
  sanitizeExternalUrl,
  slugifyPlayerName
} from './linkIntegrity.js';

export const ALL_DASHBOARD_BLOCKS = [
  {
    id: 'news_briefs',
    title: 'News',
    shortTitle: 'News',
    phase: 'YEAR_ROUND',
    defaultOnHome: true,
    navTab: 'news',
    defaultPriority: 10,
    badgeLabel: 'Live Wire'
  },
  {
    id: 'upcoming_matchup',
    title: 'Upcoming Matchup',
    shortTitle: 'Matchup',
    phase: 'YEAR_ROUND',
    defaultOnHome: true,
    navTab: 'season',
    defaultPriority: 20,
    badgeLabel: 'Matchup'
  },
  {
    id: 'team_health',
    title: 'Team Health',
    shortTitle: 'Team Health',
    phase: 'YEAR_ROUND',
    defaultOnHome: true,
    navTab: 'season',
    defaultPriority: 30,
    badgeLabel: 'Availability'
  },
  {
    id: 'schedule_overview',
    title: 'Schedule',
    shortTitle: 'Schedule',
    phase: 'YEAR_ROUND',
    defaultOnHome: false,
    navTab: 'season',
    defaultPriority: 40,
    badgeLabel: 'Season'
  },
  {
    id: 'trade_deadline',
    title: 'Trade Window',
    shortTitle: 'Trade Window',
    phase: 'YEAR_ROUND',
    defaultOnHome: false,
    navTab: 'season',
    defaultPriority: 50,
    badgeLabel: 'Trades'
  },
  {
    id: 'playoff_picture',
    title: 'Playoff Odds',
    shortTitle: 'Playoff Odds',
    phase: 'YEAR_ROUND',
    defaultOnHome: false,
    navTab: 'season',
    defaultPriority: 52,
    badgeLabel: 'Monte Carlo'
  },
  {
    id: 'draft_prep',
    title: 'Draft',
    shortTitle: 'Draft',
    phase: 'YEAR_ROUND',
    defaultOnHome: false,
    navTab: 'season',
    defaultPriority: 54,
    badgeLabel: 'Prospects'
  },
  {
    id: 'draft_live_udfa',
    title: 'Draft Recap',
    shortTitle: 'Draft Recap',
    phase: 'YEAR_ROUND',
    defaultOnHome: false,
    navTab: 'season',
    defaultPriority: 56,
    badgeLabel: 'Rookie Class'
  },
  {
    id: 'team_stats',
    title: 'Team Stats',
    shortTitle: 'Team Stats',
    phase: 'YEAR_ROUND',
    defaultOnHome: true,
    navTab: 'season',
    defaultPriority: 60,
    badgeLabel: 'NFL Ranks'
  },
  {
    id: 'roster_depth',
    title: 'Roster',
    shortTitle: 'Roster',
    phase: 'YEAR_ROUND',
    defaultOnHome: false,
    navTab: 'roster',
    defaultPriority: 70,
    badgeLabel: '53-Man & PS'
  },
  {
    id: 'salary_cap',
    title: 'Salary Cap',
    shortTitle: 'Salary Cap',
    phase: 'YEAR_ROUND',
    defaultOnHome: true,
    navTab: 'roster',
    defaultPriority: 80,
    badgeLabel: '5-Yr OTC'
  },
  {
    id: 'autopodcast_ai',
    title: 'Auto Podcast',
    shortTitle: 'Auto Podcast',
    phase: 'YEAR_ROUND',
    defaultOnHome: true,
    navTab: 'audio',
    defaultPriority: 90,
    badgeLabel: 'Audio & AI'
  }
];

export const DEFAULT_HOME_BLOCK_IDS = ALL_DASHBOARD_BLOCKS
  .filter(b => b.defaultOnHome)
  .sort((a, b) => a.defaultPriority - b.defaultPriority)
  .map(b => b.id);

/**
 * Default NFL League Year calendar anchors for 2026-2027 season cycle
 * (Can be overridden dynamically by meta.json or for unit testing arbitrary dates)
 */
export const DEFAULT_NFL_CALENDAR_2026 = {
  seasonYear: 2026,
  kickoffStart: '2026-09-04T00:00:00-07:00',
  tradeWindowStart: '2026-10-01T00:00:00-07:00',
  // First Tuesday after Week 9 (Week 9 Sunday is Nov 8, 2026 -> Tuesday Nov 10, 2026 at 1:00 PM PT / 4:00 PM ET)
  tradeDeadline: '2026-11-10T13:00:00-08:00',
  // 5 weeks before end of regular season (Weeks 14, 15, 17, 18 -> starts Tuesday Dec 8, 2026)
  playoffPushStart: '2026-12-08T00:00:00-08:00',
  regularSeasonEnd: '2027-01-11T06:00:00-08:00',
  superBowlEnd: '2027-02-15T00:00:00-08:00',
  draftDay1Start: '2027-04-22T17:00:00-07:00',
  draftEnd: '2027-04-24T21:00:00-07:00',
  postUdfaEnd: '2027-05-16T23:59:59-07:00',
  // Prior 2026 draft window (for historical/spring date evaluation)
  prevDraftStart: '2026-04-23T17:00:00-07:00',
  prevPostUdfaEnd: '2026-05-17T23:59:59-07:00'
};

function formatUtcYmd(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveLastThursdayOfAprilUtcMs(year) {
  const apr30 = Date.UTC(year, 3, 30, 12, 0, 0);
  const dow = new Date(apr30).getUTCDay(); // 0=Sun..4=Thu..6=Sat
  const daysBackToThu = (dow - 4 + 7) % 7;
  return apr30 - daysBackToThu * 86_400_000;
}

/**
 * Deterministically builds an NFL League Year calendar for any season year (2026–2035+).
 * Preserves the exact curated `DEFAULT_NFL_CALENDAR_2026` anchors for 2026 while supporting
 * automatic multi-year rollovers without manual code changes.
 */
export function buildNflCalendarForSeasonYear(seasonYear = 2026) {
  const yr = Number(seasonYear) || 2026;
  if (yr === 2026) {
    return { ...DEFAULT_NFL_CALENDAR_2026 };
  }

  // Labor Day = First Monday of September -> Kickoff Thursday (+3d), Week 1 Sunday (+6d)
  const sep1 = Date.UTC(yr, 8, 1, 12, 0, 0);
  const sep1Dow = new Date(sep1).getUTCDay();
  const daysToMon = (1 - sep1Dow + 7) % 7;
  const laborDayMs = sep1 + daysToMon * 86_400_000;
  const kickoffThuMs = laborDayMs + 3 * 86_400_000;
  const week1SunMs = laborDayMs + 6 * 86_400_000;

  // First Tuesday after Week 9 Sunday (1:00 PM PT / 4:00 PM ET)
  const tradeDeadlineTueMs = week1SunMs + (8 * 7 + 2) * 86_400_000;
  // Tuesday entering Week 14 (5 weeks remaining: Weeks 14..18)
  const playoffPushTueMs = week1SunMs + (12 * 7 + 2) * 86_400_000;
  // Monday after Week 18 Sunday
  const regEndMonMs = week1SunMs + (17 * 7 + 1) * 86_400_000;
  // Monday after Super Bowl Sunday (5 weeks after Week 18 finale)
  const superBowlEndMonMs = week1SunMs + (22 * 7 + 1) * 86_400_000;

  const nextDraftThuMs = resolveLastThursdayOfAprilUtcMs(yr + 1);
  const prevDraftThuMs = resolveLastThursdayOfAprilUtcMs(yr);

  return {
    seasonYear: yr,
    kickoffStart: `${formatUtcYmd(kickoffThuMs)}T00:00:00-07:00`,
    tradeWindowStart: `${yr}-10-01T00:00:00-07:00`,
    tradeDeadline: `${formatUtcYmd(tradeDeadlineTueMs)}T13:00:00-08:00`,
    playoffPushStart: `${formatUtcYmd(playoffPushTueMs)}T00:00:00-08:00`,
    regularSeasonEnd: `${formatUtcYmd(regEndMonMs)}T06:00:00-08:00`,
    superBowlEnd: `${formatUtcYmd(superBowlEndMonMs)}T00:00:00-08:00`,
    draftDay1Start: `${formatUtcYmd(nextDraftThuMs)}T17:00:00-07:00`,
    draftEnd: `${formatUtcYmd(nextDraftThuMs + 2 * 86_400_000)}T21:00:00-07:00`,
    postUdfaEnd: `${formatUtcYmd(nextDraftThuMs + 24 * 86_400_000)}T23:59:59-07:00`,
    prevDraftStart: `${formatUtcYmd(prevDraftThuMs)}T17:00:00-07:00`,
    prevPostUdfaEnd: `${formatUtcYmd(prevDraftThuMs + 24 * 86_400_000)}T23:59:59-07:00`
  };
}

/**
 * Evaluates factual NFL CBA trade deadline status for informational display inside the Trade tab
 * (never hides, dims, or archives any view).
 */
export function evaluateTradeDeadlineStatus(options = {}) {
  const nowDate = options.now ? new Date(options.now) : new Date();
  const nowMs = nowDate.getTime();
  if (Number.isNaN(nowMs)) {
    throw new Error(`Invalid date passed to evaluateTradeDeadlineStatus: ${options.now}`);
  }

  let baseCal = DEFAULT_NFL_CALENDAR_2026;
  const endOf2026CycleMs = new Date(DEFAULT_NFL_CALENDAR_2026.postUdfaEnd).getTime();
  if (!options.calendar && nowMs > endOf2026CycleMs) {
    const inferredSeasonYr =
      nowDate.getUTCMonth() >= 5 ? nowDate.getUTCFullYear() : nowDate.getUTCFullYear() - 1;
    baseCal = buildNflCalendarForSeasonYear(inferredSeasonYr);
  } else if (options.seasonYear && Number(options.seasonYear) !== 2026 && !options.calendar) {
    baseCal = buildNflCalendarForSeasonYear(Number(options.seasonYear));
  }
  const cal = { ...baseCal, ...(options.calendar || {}) };

  const tKickoff = new Date(cal.kickoffStart).getTime();
  const tTradeDeadline = new Date(cal.tradeDeadline).getTime();
  const tSbEnd = new Date(cal.superBowlEnd).getTime();

  const isPreDeadline = nowMs < tTradeDeadline;
  const isPostDeadlinePause = nowMs >= tTradeDeadline && nowMs < tSbEnd;
  const countdownText =
    nowMs >= tKickoff && nowMs < tTradeDeadline
      ? formatRemainingTime(nowMs, tTradeDeadline, 'Deadline')
      : null;

  return {
    seasonYear: cal.seasonYear,
    tradeDeadlineIso: cal.tradeDeadline,
    isPreDeadline,
    isPostDeadlinePause,
    countdownText
  };
}

/**
 * Evaluates year-round Home dashboard state without calendar-phase content gates or Archive exile.
 * Keeps a tighter default Home card count (`DEFAULT_HOME_BLOCK_IDS`) while all 8 seasonal sub-tabs
 * remain permanently live under Game & Season.
 * @param {object} options
 * @param {string|Date} [options.now] - Current timestamp (validated for callers)
 * @param {object} [options.calendar] - Optional NFL calendar overrides
 */
export function evaluateSeasonState(options = {}) {
  const nowDate = options.now ? new Date(options.now) : new Date();
  const nowMs = nowDate.getTime();
  if (Number.isNaN(nowMs)) {
    throw new Error(`Invalid date passed to evaluateSeasonState: ${options.now}`);
  }

  const tradeDeadlineStatus = evaluateTradeDeadlineStatus(options);

  const activeBlocks = ALL_DASHBOARD_BLOCKS
    .filter(b => b.defaultOnHome)
    .sort((a, b) => a.defaultPriority - b.defaultPriority);

  const optionalBlocks = ALL_DASHBOARD_BLOCKS
    .filter(b => !b.defaultOnHome)
    .sort((a, b) => a.defaultPriority - b.defaultPriority);

  return {
    evaluatedAt: nowDate.toISOString(),
    activePhases: ['YEAR_ROUND'],
    tradeDeadlineStatus,
    activeBlocks,
    optionalBlocks,
    archivedBlocks: []
  };
}

/**
 * Reconciles user's saved drag-and-drop block order with the currently visible blocks.
 */
export function resolveOrderedDashboardBlocks(activeBlocks, savedOrderIds = []) {
  if (!Array.isArray(savedOrderIds) || savedOrderIds.length === 0) {
    return [...activeBlocks];
  }

  const activeMap = new Map(activeBlocks.map(b => [b.id, b]));
  const knownOrdered = [];
  const seen = new Set();

  for (const id of savedOrderIds) {
    if (activeMap.has(id) && !seen.has(id)) {
      knownOrdered.push(activeMap.get(id));
      seen.add(id);
    }
  }

  const newlyIncluded = activeBlocks.filter(b => !seen.has(b.id));
  if (newlyIncluded.length === 0) {
    return knownOrdered;
  }

  const merged = [...knownOrdered];
  for (const newBlock of newlyIncluded) {
    const nextHigherIdx = merged.findIndex(b => b.defaultPriority > newBlock.defaultPriority);
    const insertIdx = nextHigherIdx >= 0 ? nextHigherIdx : merged.length;
    merged.splice(insertIdx, 0, newBlock);
  }
  return merged;
}

/**
 * Resolves the Home Dashboard visible & optional module lists given user customization preferences.
 */
export function resolveHomeDashboardState({
  savedOrderIds = [],
  hiddenBlockIds = [],
  pinnedBlockIds = []
} = {}) {
  const hiddenSet = new Set(Array.isArray(hiddenBlockIds) ? hiddenBlockIds : []);
  const pinnedSet = new Set(Array.isArray(pinnedBlockIds) ? pinnedBlockIds : []);

  let visibleBlocks = ALL_DASHBOARD_BLOCKS
    .filter(b => (b.defaultOnHome || pinnedSet.has(b.id)) && !hiddenSet.has(b.id))
    .sort((a, b) => a.defaultPriority - b.defaultPriority);

  if (visibleBlocks.length === 0) {
    visibleBlocks = [ALL_DASHBOARD_BLOCKS[0]];
  }

  const orderedBlocks = resolveOrderedDashboardBlocks(visibleBlocks, savedOrderIds);
  const visibleIdSet = new Set(orderedBlocks.map(b => b.id));
  const optionalBlocks = ALL_DASHBOARD_BLOCKS
    .filter(b => !visibleIdSet.has(b.id))
    .sort((a, b) => a.defaultPriority - b.defaultPriority);

  return {
    orderedBlocks,
    optionalBlocks
  };
}

export function formatRemainingTime(nowMs, targetMs, label) {
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return null;
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) {
    return `${label}: ${days}d ${hours}h`;
  }
  return `${label}: ${hours}h ${mins}m`;
}

/**
 * Partitions completed trade acquisitions into recent (`<= maxAgeDays`, default 30 days)
 * vs older trades (`> maxAgeDays`) that belong in the Archive section.
 */
export function partitionCompletedTradesByWindow(moves = [], referenceTime = undefined, maxAgeDays = 30) {
  const refDate =
    referenceTime instanceof Date
      ? referenceTime
      : referenceTime !== undefined && referenceTime !== null
        ? new Date(referenceTime)
        : new Date();
  const refMs = Number.isFinite(refDate.getTime()) ? refDate.getTime() : Date.now();
  const cutoffMs = maxAgeDays * 86_400_000;

  const recentTrades = [];
  const archivedTrades = [];

  for (const m of Array.isArray(moves) ? moves : []) {
    if (!m) continue;
    const rawIso = m.tradeDateIso || m.acquiredDateIso || m.dateIso || null;
    const normalizedIso =
      typeof rawIso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawIso.trim())
        ? `${rawIso.trim()}T12:00:00Z`
        : rawIso;
    let tradeMs = normalizedIso ? Date.parse(normalizedIso) : NaN;
    if (!Number.isFinite(tradeMs) && typeof m.compensation === 'string') {
      const dateMatch = m.compensation.match(
        /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s*\d{4})/i
      );
      if (dateMatch) {
        tradeMs = Date.parse(`${dateMatch[1]} 12:00:00 UTC`);
      }
    }

    if (Number.isFinite(tradeMs)) {
      const ageMs = refMs - tradeMs;
      if (ageMs <= cutoffMs) {
        recentTrades.push({ ...m, ageDays: Math.max(0, Math.floor(ageMs / 86_400_000)) });
      } else {
        archivedTrades.push({ ...m, ageDays: Math.floor(ageMs / 86_400_000) });
      }
    } else {
      recentTrades.push(m);
    }
  }

  return { recentTrades, archivedTrades, maxAgeDays };
}

const POSTSEASON_ROUND_META = {
  WC_BYE: {
    week: 19,
    weekLabel: 'WC BYE',
    roundBadgeLabel: 'First-Round Bye',
    roundTitle: 'NFC Wild Card Weekend — First-Round Bye',
    defaultOpponentName: 'First-Round Playoff Bye (#1 NFC Seed)'
  },
  QUALIFIED_TBD: {
    week: 19,
    weekLabel: 'POST',
    roundBadgeLabel: 'Playoff Berth Clinched',
    roundTitle: 'NFC Wild Card or Divisional Round',
    defaultOpponentName: 'NFC Playoff Opponent (TBD)'
  },
  WC: {
    week: 19,
    weekLabel: 'WC',
    roundBadgeLabel: 'Wild Card Round',
    roundTitle: 'NFC Wild Card Round',
    defaultOpponentName: 'NFC Wild Card Opponent (TBD)'
  },
  DIV: {
    week: 20,
    weekLabel: 'DIV',
    roundBadgeLabel: 'Divisional Round',
    roundTitle: 'NFC Divisional Round',
    defaultOpponentName: 'NFC Divisional Opponent (TBD)'
  },
  CON: {
    week: 21,
    weekLabel: 'NFC CHAMP',
    roundBadgeLabel: 'NFC Championship',
    roundTitle: 'NFC Championship Game',
    defaultOpponentName: 'NFC Championship Opponent (TBD)'
  },
  SB: {
    week: 22,
    weekLabel: 'SUPER BOWL',
    roundBadgeLabel: 'Super Bowl',
    roundTitle: 'Super Bowl',
    defaultOpponentName: 'AFC Champion (TBD)'
  }
};

function inferPostseasonRoundCode(rawGame = {}) {
  const explicit = String(rawGame.postseasonRound || '').trim().toUpperCase();
  if (explicit in POSTSEASON_ROUND_META) return explicit;
  if (rawGame.isByeWeek) return 'WC_BYE';

  const label = String(rawGame.weekLabel || rawGame.roundTitle || rawGame.statusDetail || '').toUpperCase();
  if (label.includes('BYE')) return 'WC_BYE';
  if (label.includes('SUPER BOWL') || label === 'SB') return 'SB';
  if (label.includes('CHAMP') || label.includes('CONF') || label === 'CON') return 'CON';
  if (label.includes('DIV')) return 'DIV';
  if (label.includes('WILD') || label === 'WC') return 'WC';

  const wk = Number(rawGame.week || 0);
  if (wk === 22) return 'SB';
  if (wk === 21) return 'CON';
  if (wk === 20) return 'DIV';
  return 'WC';
}

/**
 * Normalizes a single schedule entry across Preseason ('PRE'), Regular Season ('REG'),
 * and Postseason ('POST') so UI views and engines have consistent week labels, round metadata,
 * and non-colliding numeric `week` values (`< 0` for Preseason, `1..18` for Regular Season, `19..22` for Postseason).
 */
export function normalizeScheduleGameItem(rawGame = {}, seasonYear = 2026) {
  if (!rawGame || typeof rawGame !== 'object') return null;

  const rawSt = String(rawGame.seasonType || '').trim().toUpperCase();
  const rawWk = Number(rawGame.week ?? 0);
  const rawLabel = String(rawGame.weekLabel || '').trim();

  let seasonType = 'REG';
  if (rawSt === 'PRE' || rawSt === 'PRESEASON' || rawSt === '1' || rawWk < 0 || Number(rawGame.preseasonWeek) > 0 || /^PRE\b/i.test(rawLabel)) {
    seasonType = 'PRE';
  } else if (
    rawSt === 'POST' ||
    rawSt === 'POSTSEASON' ||
    rawSt === '3' ||
    rawWk >= 19 ||
    Boolean(rawGame.postseasonRound) ||
    Boolean(rawGame.isByeWeek) ||
    /^(?:WC|DIV|CON|NFC CHAMP|SUPER BOWL|POST)\b/i.test(rawLabel)
  ) {
    seasonType = 'POST';
  }

  if (seasonType === 'PRE') {
    const labelMatch = rawLabel.match(/(\d+)/);
    const preWk =
      Number(rawGame.preseasonWeek) > 0
        ? Number(rawGame.preseasonWeek)
        : labelMatch
          ? Number(labelMatch[1])
          : rawWk < 0
            ? Math.max(1, 4 + rawWk)
            : Math.max(1, rawWk);
    const normWeek = rawWk < 0 ? rawWk : -(4 - Math.min(3, preWk));
    return {
      ...rawGame,
      seasonType: 'PRE',
      preseasonWeek: preWk,
      week: normWeek,
      weekLabel: rawLabel || `PRE ${preWk}`,
      roundBadgeLabel: rawGame.roundBadgeLabel || 'Preseason',
      completed: Boolean(rawGame.completed)
    };
  }

  if (seasonType === 'POST') {
    const roundCode = inferPostseasonRoundCode(rawGame);
    const meta = POSTSEASON_ROUND_META[roundCode] || POSTSEASON_ROUND_META.WC;
    const isBye = roundCode === 'WC_BYE' || Boolean(rawGame.isByeWeek);
    const oppRaw = rawGame.opponent || {};
    const oppAbbrRaw = String(oppRaw.abbr || '').trim().toUpperCase();
    const isTbdOpp =
      !isBye &&
      (Boolean(oppRaw.isTbd) ||
        !oppAbbrRaw ||
        oppAbbrRaw === 'TBD' ||
        oppAbbrRaw === 'OPP' ||
        oppAbbrRaw === 'NFL' ||
        /^tbd\b/i.test(String(oppRaw.name || '').trim()));

    const opponent = isBye
      ? {
          abbr: 'BYE',
          name: oppRaw.name || meta.defaultOpponentName,
          logoUrl: '',
          record: oppRaw.record || '#1 NFC Seed',
          isTbd: false
        }
      : {
          ...oppRaw,
          abbr: isTbdOpp ? 'TBD' : oppAbbrRaw,
          name:
            oppRaw.name && !/^tbd$/i.test(String(oppRaw.name).trim())
              ? oppRaw.name
              : meta.defaultOpponentName,
          record: oppRaw.record && oppRaw.record !== '—' ? oppRaw.record : isTbdOpp ? 'Matchup TBD' : '—',
          isTbd: isTbdOpp
        };

    return {
      ...rawGame,
      seasonType: 'POST',
      postseasonRound: roundCode,
      isByeWeek: isBye,
      week: rawWk >= 19 ? rawWk : meta.week,
      weekLabel: rawLabel || meta.weekLabel,
      roundBadgeLabel: rawGame.roundBadgeLabel || meta.roundBadgeLabel,
      roundTitle: rawGame.roundTitle || meta.roundTitle,
      completed: Boolean(rawGame.completed),
      opponent,
      venue: rawGame.venue || {
        name: "Levi's Stadium",
        city: 'Santa Clara',
        state: 'CA',
        country: 'USA',
        isInternational: false,
        surface: 'Natural Grass'
      },
      seasonYear
    };
  }

  return {
    ...rawGame,
    seasonType: 'REG',
    week: rawWk,
    weekLabel: rawLabel || `WK ${rawWk}`,
    completed: Boolean(rawGame.completed)
  };
}

/**
 * Resolves the complete 49ers season schedule including:
 *  1. Preseason games (`seasonType: 'PRE'`, `PRE 1..3`)
 *  2. Regular Season games (`seasonType: 'REG'`, `WK 1..18`)
 *  3. Postseason games (`seasonType: 'POST'`) that the 49ers qualify for as they arise:
 *     - Handles uncertainty when playoff berth is unclinched (`0% < makePlayoffsPct < 100%`)
 *       without injecting premature postseason rows, while exposing a `postseasonStatus` tracker.
 *     - Handles clinched playoff berth when entry round (1st-Round Bye vs. Wild Card) & opponent are unknown.
 *     - Handles clinched Wild Card Round berth when opponent (and/or home vs. away venue) is unknown (`TBD`).
 *     - Handles clinched #1 NFC Seed First-Round Bye (`WC BYE` + automatic `DIV` qualification at Levi's Stadium).
 *     - Handles round-by-round postseason advancement (`WC` win -> `DIV` -> `NFC CHAMP` -> `SUPER BOWL`).
 *     - Places all completed games (Preseason, Regular Season, 1st-Round Bye once passed, and Postseason)
 *       into `previousGames` so past games are hidden inside the collapsible Previous Games bar.
 */
export function resolveCompleteScheduleModel(appData = {}, mcSimResult = null) {
  const seasonYear = Number(appData?.meta?.seasonYear) || 2026;
  const rawSched = Array.isArray(appData?.scheduleMatchup?.schedule) ? appData.scheduleMatchup.schedule : [];
  const rawPreExtra = Array.isArray(appData?.scheduleMatchup?.preseasonSchedule)
    ? appData.scheduleMatchup.preseasonSchedule
    : [];
  const rawPostExtra = Array.isArray(appData?.scheduleMatchup?.postseasonSchedule)
    ? appData.scheduleMatchup.postseasonSchedule
    : [];

  const combinedRaw = [
    ...rawPreExtra.map(g => ({ ...g, seasonType: 'PRE' })),
    ...rawSched,
    ...rawPostExtra.map(g => ({ ...g, seasonType: 'POST' }))
  ];

  const seenIds = new Set();
  const normalized = [];
  for (const item of combinedRaw) {
    const norm = normalizeScheduleGameItem(item, seasonYear);
    if (!norm) continue;
    const dedupKey = norm.id ? `id:${norm.id}` : `${norm.seasonType}:${norm.week}:${norm.postseasonRound || ''}`;
    if (seenIds.has(dedupKey)) continue;
    seenIds.add(dedupKey);
    normalized.push(norm);
  }

  const preGames = normalized
    .filter(g => g.seasonType === 'PRE')
    .sort((a, b) => (a.preseasonWeek || 0) - (b.preseasonWeek || 0) || (Date.parse(a.dateIso || '') || 0) - (Date.parse(b.dateIso || '') || 0));

  const regGames = normalized
    .filter(g => g.seasonType === 'REG')
    .sort((a, b) => (a.week || 0) - (b.week || 0));

  let postGames = normalized
    .filter(g => g.seasonType === 'POST')
    .sort((a, b) => (a.week || 0) - (b.week || 0));

  const allRegCompleted = regGames.length >= 15 && regGames.every(g => Boolean(g.completed));
  const sfOdds = mcSimResult?.sfOdds || appData?.seasonal?.playoffPicture?.baselineSimulation?.sfOdds || null;
  const teamStatus = appData?.meta?.teamStatus || {};
  const nowMs = appData?.meta?.nowMs ? new Date(appData.meta.nowMs).getTime() : Date.now();

  const hasExplicitOdds = Boolean(
    sfOdds &&
      (sfOdds.makePlayoffsPct !== undefined ||
        sfOdds.winDivisionPct !== undefined ||
        sfOdds.seed1ByePct !== undefined)
  );
  const makePlayoffsPct = hasExplicitOdds ? Number(sfOdds.makePlayoffsPct ?? 0) : null;
  const winDivisionPct = hasExplicitOdds ? Number(sfOdds.winDivisionPct ?? 0) : null;
  const seed1ByePct = hasExplicitOdds ? Number(sfOdds.seed1ByePct ?? 0) : null;

  const clinchCode = String(
    teamStatus.clinchTag || teamStatus.playoffClinchCode || appData?.meta?.clinchTag || ''
  )
    .trim()
    .toLowerCase();

  const lostPostGame = postGames.find(g => g.completed && g.result === 'L' && !g.isByeWeek) || null;
  const isEliminatedRegularSeason = Boolean(
    !postGames.length &&
      (teamStatus.mathematicallyEliminated ||
        teamStatus.eliminatedAt ||
        clinchCode === 'e' ||
        (makePlayoffsPct !== null && makePlayoffsPct <= 0))
  );

  const hasClinchedSeed1Bye = Boolean(
    !isEliminatedRegularSeason &&
      (teamStatus.clinchedSeed1Bye ||
        teamStatus.clinchedBye ||
        clinchCode === 'z' ||
        (seed1ByePct !== null && seed1ByePct >= 99.95) ||
        postGames.some(g => g.postseasonRound === 'WC_BYE' || g.isByeWeek))
  );

  const hasClinchedDivision = Boolean(
    !isEliminatedRegularSeason &&
      (hasClinchedSeed1Bye ||
        teamStatus.clinchedDivision ||
        clinchCode === 'y' ||
        (winDivisionPct !== null && winDivisionPct >= 99.95))
  );

  const hasClinchedPlayoffs = Boolean(
    !isEliminatedRegularSeason &&
      (hasClinchedDivision ||
        teamStatus.clinchedPlayoffs ||
        ['x', 'y', 'z', '*'].includes(clinchCode) ||
        (makePlayoffsPct !== null && makePlayoffsPct >= 99.95) ||
        postGames.length > 0)
  );

  if (isEliminatedRegularSeason) {
    postGames = postGames.filter(g => g.completed);
  } else if (hasClinchedPlayoffs) {
    const sfLogoUrl =
      appData?.scheduleMatchup?.upcomingMatchup?.sfLogoUrl ||
      regGames[0]?.sfLogoUrl ||
      'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png';

    // 1. Handle #1 NFC Seed First-Round Bye + automatic Divisional Round qualification at Levi's Stadium
    if (hasClinchedSeed1Bye) {
      // Remove any unplayed WC / QUALIFIED_TBD game since #1 seed receives a Wild Card bye
      postGames = postGames.filter(
        g => (g.postseasonRound !== 'WC' && g.postseasonRound !== 'QUALIFIED_TBD') || g.completed
      );

      const wcRoundDone = Boolean(
        teamStatus.wildCardRoundCompleted ||
          postGames.some(
            g =>
              g.week >= 20 &&
              (g.completed ||
                g.statusState === 'in' ||
                (g.opponent && !g.opponent.isTbd && g.opponent.abbr && g.opponent.abbr !== 'TBD'))
          ) ||
          (allRegCompleted && Number.isFinite(nowMs) && nowMs >= Date.parse(`${seasonYear + 1}-01-19T08:00:00Z`))
      );

      const existingBye = postGames.find(g => g.postseasonRound === 'WC_BYE' || g.isByeWeek);
      if (existingBye) {
        if (wcRoundDone) {
          existingBye.completed = true;
          existingBye.result = existingBye.result || 'BYE';
        }
      } else {
        postGames.unshift(
          normalizeScheduleGameItem(
            {
              id: `post_${seasonYear}_wc_bye`,
              seasonType: 'POST',
              postseasonRound: 'WC_BYE',
              postseasonState: 'first_round_bye',
              isByeWeek: true,
              week: 19,
              weekLabel: 'WC BYE',
              roundBadgeLabel: 'First-Round Bye',
              dateIso: `${seasonYear + 1}-01-17T21:00:00Z`,
              statusDetail: '1st-Round Bye (#1 NFC Seed)',
              completed: wcRoundDone,
              result: wcRoundDone ? 'BYE' : null,
              homeAway: 'home',
              sfLogoUrl,
              opponent: {
                abbr: 'BYE',
                name: 'First-Round Playoff Bye (#1 NFC Seed)',
                record: 'Homefield Clinched',
                isTbd: false
              },
              venue: {
                name: "Levi's Stadium",
                city: 'Santa Clara',
                state: 'CA',
                country: 'USA',
                isInternational: false,
                surface: 'Natural Grass'
              },
              qualificationNote:
                'Clinched #1 NFC Seed — 49ers earn a Wild Card Weekend bye and homefield advantage through the NFC playoffs.'
            },
            seasonYear
          )
        );
      }

      const existingDiv = postGames.find(g => g.postseasonRound === 'DIV' || g.week === 20);
      if (!existingDiv) {
        postGames.push(
          normalizeScheduleGameItem(
            {
              id: `post_${seasonYear}_div`,
              seasonType: 'POST',
              postseasonRound: 'DIV',
              postseasonState: 'bye_awaiting_divisional_opponent',
              week: 20,
              weekLabel: 'DIV',
              roundBadgeLabel: 'Divisional Round',
              dateIso: `${seasonYear + 1}-01-24T21:30:00Z`,
              statusDetail: 'NFC Divisional • Homefield Clinched',
              completed: false,
              result: null,
              homeAway: 'home',
              sfLogoUrl,
              opponent: {
                abbr: 'TBD',
                name: 'Lowest Remaining NFC Seed (TBD)',
                record: 'Awaiting Wild Card',
                isTbd: true
              },
              venue: {
                name: "Levi's Stadium",
                city: 'Santa Clara',
                state: 'CA',
                country: 'USA',
                isInternational: false,
                surface: 'Natural Grass'
              },
              qualificationNote:
                'Automatic Divisional Round berth via #1 NFC Seed Bye — 49ers host the lowest remaining seed from Wild Card Weekend.'
            },
            seasonYear
          )
        );
      } else if (existingDiv.opponent?.isTbd) {
        existingDiv.homeAway = 'home';
        existingDiv.postseasonState = existingDiv.postseasonState || 'bye_awaiting_divisional_opponent';
        if (/^(?:opponent tbd|nfc divisional opponent \(tbd\))$/i.test(existingDiv.opponent.name || '')) {
          existingDiv.opponent.name = 'Lowest Remaining NFC Seed (TBD)';
        }
      }
    } else if (postGames.length === 0) {
      // 2. Clinched Playoff Berth, but #1 Seed Bye is not clinched
      const byeStillPossible =
        seed1ByePct !== null &&
        seed1ByePct > 0.05 &&
        !allRegCompleted &&
        !teamStatus.wildCardRoundLocked;

      if (byeStillPossible) {
        postGames.push(
          normalizeScheduleGameItem(
            {
              id: `post_${seasonYear}_clinched_tbd`,
              seasonType: 'POST',
              postseasonRound: 'QUALIFIED_TBD',
              postseasonState: 'clinched_round_tbd',
              week: 19,
              weekLabel: 'POST',
              roundBadgeLabel: 'Playoff Berth Clinched',
              dateIso: `${seasonYear + 1}-01-17T21:30:00Z`,
              statusDetail: `Clinched Berth • #1 Bye ${seed1ByePct.toFixed(1)}%`,
              completed: false,
              result: null,
              homeAway: hasClinchedDivision ? 'home' : 'tbd',
              sfLogoUrl,
              opponent: {
                abbr: 'TBD',
                name: 'NFC Playoff Opponent (TBD)',
                record: 'Seed & Round TBD',
                isTbd: true
              },
              venue: hasClinchedDivision
                ? {
                    name: "Levi's Stadium",
                    city: 'Santa Clara',
                    state: 'CA',
                    country: 'USA',
                    isInternational: false,
                    surface: 'Natural Grass'
                  }
                : {
                    name: "Levi's Stadium or Road Host (TBD)",
                    city: 'Seed Dependent',
                    state: '',
                    country: 'USA',
                    isInternational: false,
                    surface: 'TBD'
                  },
              qualificationNote: `Playoff berth clinched — ${seed1ByePct.toFixed(1)}% #1 Seed First-Round Bye (Divisional Round entry) vs. ${(100 - seed1ByePct).toFixed(1)}% Wild Card Weekend.`
            },
            seasonYear
          )
        );
      } else {
        const isRoadWildCard = Boolean(
          !hasClinchedDivision &&
            ((winDivisionPct !== null && winDivisionPct <= 0.05) ||
              teamStatus.clinchedWildCardOnly ||
              Number(teamStatus.playoffSeed || appData?.meta?.playoffSeed || 0) >= 5)
        );
        const homeAway = hasClinchedDivision ? 'home' : isRoadWildCard ? 'away' : 'tbd';
        postGames.push(
          normalizeScheduleGameItem(
            {
              id: `post_${seasonYear}_wc`,
              seasonType: 'POST',
              postseasonRound: 'WC',
              postseasonState: 'clinched_opponent_tbd',
              week: 19,
              weekLabel: 'WC',
              roundBadgeLabel: 'Wild Card Round',
              dateIso: `${seasonYear + 1}-01-17T21:30:00Z`,
              statusDetail: hasClinchedDivision
                ? 'NFC Wild Card • Home Game Clinched'
                : isRoadWildCard
                  ? 'NFC Wild Card • Road Berth Clinched'
                  : 'NFC Wild Card • Berth Clinched',
              completed: false,
              result: null,
              homeAway,
              sfLogoUrl,
              opponent: {
                abbr: 'TBD',
                name: hasClinchedDivision
                  ? 'NFC Wild Card Opponent (TBD)'
                  : isRoadWildCard
                    ? 'NFC Division Winner (TBD)'
                    : 'NFC Wild Card Opponent (TBD)',
                record: 'Matchup TBD',
                isTbd: true
              },
              venue: hasClinchedDivision
                ? {
                    name: "Levi's Stadium",
                    city: 'Santa Clara',
                    state: 'CA',
                    country: 'USA',
                    isInternational: false,
                    surface: 'Natural Grass'
                  }
                : isRoadWildCard
                  ? {
                      name: 'NFC Division Winner Stadium (TBD)',
                      city: 'Road Playoff Venue',
                      state: '',
                      country: 'USA',
                      isInternational: false,
                      surface: 'TBD'
                    }
                  : {
                      name: "Levi's Stadium or Road Host (TBD)",
                      city: 'Seed Dependent',
                      state: '',
                      country: 'USA',
                      isInternational: false,
                      surface: 'TBD'
                    },
              qualificationNote: hasClinchedDivision
                ? 'NFC West Champions — 49ers host an NFC Wild Card matchup at Levi’s Stadium (opponent TBD).'
                : isRoadWildCard
                  ? 'NFC Wild Card berth clinched — 49ers travel to face an NFC division champion on Wild Card Weekend.'
                  : 'Playoff berth clinched — final seeding determines home vs. road Wild Card matchup.'
            },
            seasonYear
          )
        );
      }
    }

    // 3. Round-by-round postseason progression as games complete (WC win -> DIV -> CON -> SB)
    const wcGame = postGames.find(g => g.postseasonRound === 'WC' && !g.isByeWeek);
    if (wcGame?.completed && wcGame.result === 'W' && !postGames.some(g => g.postseasonRound === 'DIV' || g.week === 20)) {
      const seedNum = Number(teamStatus.playoffSeed || appData?.meta?.playoffSeed || 0);
      const isSeed2Host = seedNum === 2;
      postGames.push(
        normalizeScheduleGameItem(
          {
            id: `post_${seasonYear}_div`,
            seasonType: 'POST',
            postseasonRound: 'DIV',
            postseasonState: 'advanced_opponent_tbd',
            week: 20,
            weekLabel: 'DIV',
            roundBadgeLabel: 'Divisional Round',
            dateIso: `${seasonYear + 1}-01-24T21:30:00Z`,
            statusDetail: 'NFC Divisional • Qualified',
            completed: false,
            result: null,
            homeAway: isSeed2Host ? 'home' : 'tbd',
            sfLogoUrl,
            opponent: {
              abbr: 'TBD',
              name: 'NFC Divisional Opponent (TBD)',
              record: 'Awaiting Wild Card Results',
              isTbd: true
            },
            venue: isSeed2Host
              ? {
                  name: "Levi's Stadium",
                  city: 'Santa Clara',
                  state: 'CA',
                  country: 'USA',
                  isInternational: false,
                  surface: 'Natural Grass'
                }
              : {
                  name: "Levi's Stadium or Host Venue (TBD)",
                  city: 'Seed Dependent',
                  state: '',
                  country: 'USA',
                  isInternational: false,
                  surface: 'TBD'
                },
            qualificationNote: 'Advanced from NFC Wild Card Round — Divisional Round matchup & kickoff finalized once Wild Card Weekend concludes.'
          },
          seasonYear
        )
      );
    }

    const divGame = postGames.find(g => g.postseasonRound === 'DIV' || g.week === 20);
    if (divGame?.completed && divGame.result === 'W' && !postGames.some(g => g.postseasonRound === 'CON' || g.week === 21)) {
      postGames.push(
        normalizeScheduleGameItem(
          {
            id: `post_${seasonYear}_con`,
            seasonType: 'POST',
            postseasonRound: 'CON',
            postseasonState: 'advanced_opponent_tbd',
            week: 21,
            weekLabel: 'NFC CHAMP',
            roundBadgeLabel: 'NFC Championship',
            dateIso: `${seasonYear + 1}-01-31T23:30:00Z`,
            statusDetail: 'NFC Championship • Qualified',
            completed: false,
            result: null,
            homeAway: hasClinchedSeed1Bye ? 'home' : 'tbd',
            sfLogoUrl,
            opponent: {
              abbr: 'TBD',
              name: 'NFC Championship Opponent (TBD)',
              record: 'Awaiting Divisional Results',
              isTbd: true
            },
            venue: hasClinchedSeed1Bye
              ? {
                  name: "Levi's Stadium",
                  city: 'Santa Clara',
                  state: 'CA',
                  country: 'USA',
                  isInternational: false,
                  surface: 'Natural Grass'
                }
              : {
                  name: "Levi's Stadium or Host Venue (TBD)",
                  city: 'Seed Dependent',
                  state: '',
                  country: 'USA',
                  isInternational: false,
                  surface: 'TBD'
                },
            qualificationNote: 'Advanced to the NFC Championship Game — winner represents the NFC in the Super Bowl.'
          },
          seasonYear
        )
      );
    }

    const conGame = postGames.find(g => g.postseasonRound === 'CON' || g.week === 21);
    if (conGame?.completed && conGame.result === 'W' && !postGames.some(g => g.postseasonRound === 'SB' || g.week === 22)) {
      postGames.push(
        normalizeScheduleGameItem(
          {
            id: `post_${seasonYear}_sb`,
            seasonType: 'POST',
            postseasonRound: 'SB',
            postseasonState: 'advanced_opponent_tbd',
            week: 22,
            weekLabel: 'SUPER BOWL',
            roundBadgeLabel: 'Super Bowl',
            dateIso: `${seasonYear + 1}-02-14T23:30:00Z`,
            statusDetail: 'Super Bowl • NFC Champions',
            completed: false,
            result: null,
            homeAway: 'neutral',
            sfLogoUrl,
            opponent: {
              abbr: 'TBD',
              name: 'AFC Champion (TBD)',
              record: 'Awaiting AFC Championship',
              isTbd: true
            },
            venue: {
              name: seasonYear === 2026 ? 'SoFi Stadium' : 'Super Bowl Host Stadium',
              city: seasonYear === 2026 ? 'Inglewood' : 'Neutral Site',
              state: seasonYear === 2026 ? 'CA' : '',
              country: 'USA',
              isInternational: false,
              surface: 'Neutral Turf'
            },
            qualificationNote: 'NFC Champions — 49ers advance to the Super Bowl.'
          },
          seasonYear
        )
      );
    }

    // If the 49ers lost any completed postseason game, drop any unplayed subsequent rounds
    const lossRound = postGames.find(g => g.completed && g.result === 'L' && !g.isByeWeek);
    if (lossRound) {
      postGames = postGames.filter(g => g.completed || g.week <= lossRound.week);
    }
  }

  postGames.sort((a, b) => (a.week || 0) - (b.week || 0));

  const allGames = [...preGames, ...regGames, ...postGames];
  const previousGames = allGames.filter(g => Boolean(g.completed));
  const upcomingGames = allGames.filter(g => !g.completed);

  let postseasonStatus = {
    state: 'NONE',
    hasClinchedPlayoffs,
    hasClinchedDivision,
    hasClinchedSeed1Bye,
    isEliminated: Boolean(isEliminatedRegularSeason || lostPostGame),
    makePlayoffsPct,
    winDivisionPct,
    seed1ByePct,
    headline: '',
    summary: ''
  };

  if (isEliminatedRegularSeason) {
    postseasonStatus = {
      ...postseasonStatus,
      state: 'ELIMINATED',
      headline: 'Eliminated from Postseason Contention',
      summary: `The 49ers did not qualify for the ${seasonYear} NFL Postseason.`
    };
  } else if (lostPostGame) {
    postseasonStatus = {
      ...postseasonStatus,
      state: 'POSTSEASON_ELIMINATED',
      headline: `Postseason Concluded (${lostPostGame.roundBadgeLabel || lostPostGame.weekLabel})`,
      summary: `The 49ers' ${seasonYear} postseason run concluded in the ${lostPostGame.roundTitle || lostPostGame.roundBadgeLabel}.`
    };
  } else if (hasClinchedSeed1Bye) {
    postseasonStatus = {
      ...postseasonStatus,
      state: 'CLINCHED_FIRST_ROUND_BYE',
      headline: 'Clinched #1 NFC Seed & First-Round Playoff Bye',
      summary: "49ers skip Wild Card Weekend and hold homefield advantage at Levi's Stadium through the NFC playoffs."
    };
  } else if (hasClinchedPlayoffs) {
    const byePossible = seed1ByePct !== null && seed1ByePct > 0.05 && !allRegCompleted;
    postseasonStatus = {
      ...postseasonStatus,
      state: byePossible
        ? 'CLINCHED_ROUND_TBD'
        : hasClinchedDivision
          ? 'CLINCHED_DIVISION'
          : 'CLINCHED_WILD_CARD_ROUND',
      headline: hasClinchedDivision
        ? 'NFC West Champions • Playoff Berth Clinched'
        : 'NFL Playoff Berth Clinched',
      summary: byePossible
        ? `Clinched postseason berth — ${seed1ByePct.toFixed(1)}% #1 Seed First-Round Bye vs. ${(100 - seed1ByePct).toFixed(1)}% Wild Card Weekend.`
        : hasClinchedDivision
          ? "Clinched NFC West title — guaranteed a home playoff matchup at Levi's Stadium."
          : 'Clinched NFC playoff berth — opponent and kickoff window finalize as regular-season standings lock.'
    };
  } else if (hasExplicitOdds && makePlayoffsPct > 0) {
    postseasonStatus = {
      ...postseasonStatus,
      state: 'UNCLINCHED_IN_HUNT',
      headline: `Postseason Qualification Horizon • ${makePlayoffsPct.toFixed(1)}% Playoff Odds`,
      summary: `Playoff berth not yet clinched (${winDivisionPct !== null ? `${winDivisionPct.toFixed(1)}% NFC West • ` : ''}${seed1ByePct !== null ? `${seed1ByePct.toFixed(1)}% #1 Seed Bye` : ''}). Postseason games will appear here automatically once the 49ers qualify.`
    };
  }

  return {
    seasonYear,
    allGames,
    preseasonGames: preGames,
    regularSeasonGames: regGames,
    postseasonGames: postGames,
    previousGames,
    upcomingGames,
    postseasonStatus
  };
}

function resolveLastThursdayOfFebruaryUtcMs(year) {
  // Day 0 of March = last day of February (handles 28-day and 29-day leap years)
  const febEndMs = Date.UTC(year, 2, 0, 12, 0, 0);
  const dow = new Date(febEndMs).getUTCDay(); // 0=Sun..4=Thu..6=Sat
  const daysBackToThu = (dow - 4 + 7) % 7;
  return febEndMs - daysBackToThu * 86_400_000;
}

/**
 * Evaluates NFL Scouting Combine Leaderboard rows strictly by target `draftYear` data availability
 * (no artificial calendar blank-window trigger). Prior-year Combine rows never mix into the upcoming
 * prospect class, and new Combine drill testing appears immediately once recorded.
 */
export function evaluateCombineLeaderboardWindow({
  seasonYear = 2026,
  draftYear = null,
  combineLeaderboard = []
} = {}) {
  const seasonYr = Number(seasonYear) || 2026;
  const targetCombineYear = Number(draftYear) || seasonYr + 1;
  const combineStartIso = `${formatUtcYmd(resolveLastThursdayOfFebruaryUtcMs(targetCombineYear))}T06:00:00-08:00`;
  const combineStartDate = new Date(Date.parse(combineStartIso));
  const combineStartDisplay = combineStartDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Los_Angeles'
  });

  const validRows = (Array.isArray(combineLeaderboard) ? combineLeaderboard : []).filter(row => {
    if (!row || !row.name) return false;
    if (row.season != null && Number.isFinite(Number(row.season))) {
      return Number(row.season) === targetCombineYear;
    }
    return true;
  });

  const isBlankWindow = validRows.length === 0;

  return {
    isBlankWindow,
    reason: isBlankWindow ? 'awaiting_combine_data' : 'combine_data_available',
    targetCombineYear,
    combineStartIso,
    combineStartDisplay,
    rows: validRows
  };
}

/**
 * Evaluates the 49ers First-Pick Mock Draft Database freshness window:
 * - Trailing 30 days initially (offseason, regular season, and playoffs through Super Bowl Sunday).
 * - Trailing 7 days after the Super Bowl (`nowMs >= superBowlEnd`) when pre-draft buzz heats up.
 */
export function evaluateMockDraftFreshnessWindow(appData = {}, options = {}) {
  if (typeof options.isPostSuperBowl === 'boolean') {
    return {
      isPostSuperBowl: options.isPostSuperBowl,
      freshnessDays: options.isPostSuperBowl ? 7 : 30,
      superBowlEndIso: null,
      reason: options.isPostSuperBowl ? 'explicit_post_super_bowl' : 'explicit_initial_30d'
    };
  }

  const nowDate =
    options.now instanceof Date
      ? options.now
      : options.now !== undefined && options.now !== null
        ? new Date(options.now)
        : appData?.meta?.now
          ? new Date(appData.meta.now)
          : new Date();
  const nowMs = Number.isFinite(nowDate.getTime()) ? nowDate.getTime() : Date.now();
  const dp = appData?.seasonal?.draftPrep2027 || {};
  const seasonYrFromMeta = Number(options.seasonYear || appData?.meta?.seasonYear) || 2026;
  const explicitDraftYr = Number(options.draftYear || dp.draftYear) || 0;
  const draftYr = explicitDraftYr || seasonYrFromMeta + 1;
  const mockSeasonYr = draftYr - 1;

  const baseCal = buildNflCalendarForSeasonYear(mockSeasonYr);
  const metaCal = appData?.meta?.calendar || {};
  const optCal = options.calendar || {};
  const cal = {
    ...baseCal,
    ...(!metaCal.seasonYear || Number(metaCal.seasonYear) === mockSeasonYr ? metaCal : {}),
    ...(!optCal.seasonYear || Number(optCal.seasonYear) === mockSeasonYr ? optCal : {})
  };

  const sbEndMs = Date.parse(cal.superBowlEnd);
  const postDraftResetMs = Date.parse(cal.postUdfaEnd);
  const upperBoundMs = explicitDraftYr
    ? Date.parse(`${draftYr}-08-01T00:00:00Z`)
    : postDraftResetMs;
  const isPostSuperBowl =
    Number.isFinite(sbEndMs) &&
    nowMs >= sbEndMs &&
    (!Number.isFinite(upperBoundMs) || nowMs <= upperBoundMs);

  return {
    isPostSuperBowl,
    freshnessDays: isPostSuperBowl ? 7 : 30,
    superBowlEndIso: cal.superBowlEnd || null,
    reason: isPostSuperBowl ? 'post_super_bowl_7d' : 'initial_trailing_30d'
  };
}

function formatMockAgeLabel(ageMs, pubMs) {
  const safeAgeMs = Math.max(0, ageMs);
  const hours = safeAgeMs / 3_600_000;
  const days = Math.floor(safeAgeMs / 86_400_000);
  const shortDate = new Date(pubMs).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles'
  });
  if (hours < 20) return { ageLabel: 'Today', shortDate };
  if (days <= 1) return { ageLabel: '1d ago', shortDate };
  if (days < 14) return { ageLabel: `${days}d ago`, shortDate };
  return { ageLabel: `${Math.round(days / 7)}w ago`, shortDate };
}

/**
 * Resolves the 49ers First-Pick Mock Draft Database view:
 * - Filters to trailing 30-day freshness initially, tightening to trailing 7-day freshness
 *   after the Super Bowl when pre-draft buzz heats up.
 * - Deduplicates to at most 1 projection per independent mock draft site (most recent inside window).
 * - Ranks projected players by number of sites projecting them to SF's first pick (`siteCount` DESC),
 *   with clickable site names/links and prospect scouting drill-down metadata.
 */
export function resolveFirstPickMockDatabase(mockEntries = [], options = {}) {
  const nowDate =
    options.now instanceof Date
      ? options.now
      : options.now !== undefined && options.now !== null
        ? new Date(options.now)
        : new Date();
  const refMs = Number.isFinite(nowDate.getTime()) ? nowDate.getTime() : Date.now();

  const win = evaluateMockDraftFreshnessWindow(options.appData || {}, options);
  const freshnessDays = win.freshnessDays;
  const maxAgeMs = freshnessDays * 86_400_000;

  const dp = options.appData?.seasonal?.draftPrep2027 || {};
  const draftYear = Number(options.draftYear || dp.draftYear) || (Number(options.appData?.meta?.seasonYear) || 2026) + 1;
  const firstPickInv = (options.pickInventory || dp.pickInventory || [])[0] || {
    round: 1,
    projectedOverall: 31
  };
  const projectedFirstPickOverall = Number(options.projectedPick || firstPickInv.projectedOverall) || 31;
  const projectedFirstPickRound = Number(firstPickInv.round) || 1;

  const boardList = Array.isArray(options.consensusBigBoard)
    ? options.consensusBigBoard
    : Array.isArray(dp.consensusBigBoard)
      ? dp.consensusBigBoard
      : [];
  const boardByKey = new Map();
  for (const b of boardList) {
    const k = normalizePlayerKey(b?.name || '');
    if (k && !boardByKey.has(k)) boardByKey.set(k, b);
  }

  let staleExcludedCount = 0;
  const newestBySite = new Map();

  for (const raw of Array.isArray(mockEntries) ? mockEntries : []) {
    if (!raw || !(raw.playerName || raw.name) || !raw.siteName) continue;
    const safeUrl = sanitizeExternalUrl(raw.url || raw.sourceUrl || '', null);
    if (!safeUrl) continue;

    const rawDate = String(raw.publishedAt || raw.dateIso || '').trim();
    const normalizedIso = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? `${rawDate}T12:00:00Z` : rawDate;
    const pubMs = normalizedIso ? Date.parse(normalizedIso) : NaN;
    if (!Number.isFinite(pubMs)) continue;

    const ageMs = refMs - pubMs;
    if (ageMs < -2 * 86_400_000) continue;
    if (ageMs > maxAgeMs) {
      staleExcludedCount += 1;
      continue;
    }

    const siteKey = String(raw.siteId || raw.siteName)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    if (!siteKey) continue;

    const prev = newestBySite.get(siteKey);
    if (!prev || pubMs > prev.pubMs) {
      newestBySite.set(siteKey, {
        raw,
        safeUrl,
        pubMs,
        ageMs
      });
    }
  }

  const totalFreshSites = newestBySite.size;
  const groupsByPlayer = new Map();

  for (const [siteKey, item] of newestBySite.entries()) {
    const { raw, safeUrl, pubMs, ageMs } = item;
    const pName = String(raw.playerName || raw.name).trim();
    const pKey = normalizePlayerKey(pName);
    if (!pKey) continue;

    const boardHit = boardByKey.get(pKey) || null;
    const { ageLabel, shortDate } = formatMockAgeLabel(ageMs, pubMs);
    const pickNum = Number(raw.projectedPick) || projectedFirstPickOverall;

    if (!groupsByPlayer.has(pKey)) {
      const slug = slugifyPlayerName(pName);
      const sttmSlug = slug === 'ryan-coleman-williams' ? 'ryan-williams-alabama' : slug;
      const nflScoutingUrl = sanitizeExternalUrl(raw.nflScoutingUrl || boardHit?.nflScoutingUrl || '', null);
      const scoutingReportUrl =
        nflScoutingUrl ||
        sanitizeExternalUrl(raw.scoutingReportUrl || boardHit?.scoutingReportUrl || boardHit?.profileUrl || '', null) ||
        (draftYear === 2027
          ? `https://sticktothemodel.com/player/${sttmSlug}`
          : `https://www.nfl.com/draft/tracker/${draftYear}/prospects`);
      groupsByPlayer.set(pKey, {
        playerKey: pKey,
        draftYear,
        playerName: boardHit?.name || pName,
        pos: raw.pos || boardHit?.pos || 'ATH',
        posRank: boardHit?.posRank || '',
        school: raw.school || boardHit?.school || '',
        heightWeight: raw.heightWeight || boardHit?.heightWeight || '',
        headshotUrl: raw.headshotUrl || boardHit?.headshotUrl || '',
        collegeLogoUrl: raw.collegeLogoUrl || boardHit?.collegeLogoUrl || '',
        collegeStats: raw.collegeStats || boardHit?.collegeStats || '',
        bigBoardRank: boardHit?.boards?.consensus?.rank ?? boardHit?.consensusRank ?? raw.bigBoardRank ?? null,
        buzzRank: boardHit?.boards?.buzz?.rank ?? null,
        pffRank: boardHit?.boards?.pff?.rank ?? null,
        activeLensRank:
          options.activeLens && boardHit?.boards?.[options.activeLens]?.rank
            ? boardHit.boards[options.activeLens].rank
            : boardHit?.boards?.consensus?.rank ?? boardHit?.consensusRank ?? raw.bigBoardRank ?? null,
        shanahanLynchFitScore: raw.shanahanLynchFitScore ?? boardHit?.shanahanLynchFitScore ?? null,
        archetypeTraits: raw.archetypeTraits || boardHit?.archetypeNote || '',
        nflScoutingUrl,
        scoutingReportUrl,
        nflDraftTrackerUrl: `https://www.nfl.com/draft/tracker/${draftYear}/prospects`,
        profileUrl: scoutingReportUrl,
        mockDbUrl: buildMockDraftBigBoardUrl(draftYear),
        latestPublishedMs: pubMs,
        sites: []
      });
    }

    const grp = groupsByPlayer.get(pKey);
    if (pubMs > grp.latestPublishedMs) grp.latestPublishedMs = pubMs;
    if (!grp.archetypeTraits && raw.note) grp.archetypeTraits = raw.note;

    grp.sites.push({
      siteId: siteKey,
      siteName: String(raw.siteName).trim(),
      analyst: raw.analyst ? String(raw.analyst).trim() : '',
      url: safeUrl,
      publishedAt: new Date(pubMs).toISOString(),
      pubMs,
      ageDays: Math.max(0, Math.floor(ageMs / 86_400_000)),
      ageLabel,
      shortDate,
      projectedPick: pickNum,
      round: Number(raw.round) || projectedFirstPickRound,
      note: raw.note ? String(raw.note).trim() : ''
    });
  }

  const players = [...groupsByPlayer.values()]
    .map((grp, _i) => {
      grp.sites.sort((a, b) => b.pubMs - a.pubMs);
      const siteCount = grp.sites.length;
      const sharePct = totalFreshSites > 0 ? Math.round((siteCount / totalFreshSites) * 100) : 0;
      const picks = grp.sites.map(s => s.projectedPick).filter(Number.isFinite);
      const minPick = picks.length ? Math.min(...picks) : projectedFirstPickOverall;
      const maxPick = picks.length ? Math.max(...picks) : projectedFirstPickOverall;
      const pickRangeLabel = minPick === maxPick ? `#${minPick}` : `#${minPick}–#${maxPick}`;
      return {
        ...grp,
        siteCount,
        sharePct,
        pickRangeLabel,
        freshestSite: grp.sites[0] || null
      };
    })
    .sort((a, b) => {
      if (b.siteCount !== a.siteCount) return b.siteCount - a.siteCount;
      if (b.latestPublishedMs !== a.latestPublishedMs) return b.latestPublishedMs - a.latestPublishedMs;
      return (a.bigBoardRank ?? 999) - (b.bigBoardRank ?? 999);
    })
    .map((grp, idx) => ({
      ...grp,
      rank: idx + 1
    }));

  return {
    draftYear,
    isPostSuperBowl: win.isPostSuperBowl,
    windowReason: win.reason,
    freshnessDays,
    freshnessLabel: win.isPostSuperBowl
      ? 'Trailing 7-Day Freshness (Post-Super Bowl)'
      : 'Trailing 30-Day Freshness',
    shortWindowBadge: win.isPostSuperBowl ? '7D Window' : '30D Window',
    totalFreshSites,
    staleExcludedCount,
    projectedFirstPickRound,
    projectedFirstPickOverall,
    players
  };
}

export {
  BIG_BOARD_LENSES,
  BIG_BOARD_LENS_ORDER,
  BIG_BOARD_SORT_FIELDS,
  BIG_BOARD_QUICK_POS_PILLS,
  BIG_BOARD_OFFENSE_POSITIONS,
  BIG_BOARD_DEFENSE_POSITIONS,
  BIG_BOARD_INDIVIDUAL_POSITIONS,
  BIG_BOARD_RANGE_OPTIONS,
  BIG_BOARD_AGREEMENT_OPTIONS,
  normalizeBigBoardDataset,
  queryBigBoardProspects,
  filterConsensusBigBoard,
  parseBigBoardUrlParams,
  buildBigBoardUrlSearch
} from './draftBigBoardEngine.js';
