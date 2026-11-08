/**
 * Seasonal & Temporal State Machine for 49ers Faithful
 * Governs which Year-Round, In-Season, and Temporal modules appear on the main dashboard
 * vs. move to the Off-Cycle / Archive Vault.
 */

export const ALL_DASHBOARD_BLOCKS = [
  {
    id: 'news_briefs',
    title: 'News',
    shortTitle: 'News',
    phase: 'YEAR_ROUND',
    navTab: 'news',
    defaultPriority: 10,
    badgeLabel: 'Live Wire'
  },
  {
    id: 'upcoming_matchup',
    title: 'Upcoming Matchup',
    shortTitle: 'Matchup',
    phase: 'IN_SEASON',
    navTab: 'season',
    defaultPriority: 20,
    badgeLabel: 'In-Season'
  },
  {
    id: 'team_health',
    title: 'Team Health & Play Probability',
    shortTitle: 'Team Health',
    phase: 'IN_SEASON',
    navTab: 'season',
    defaultPriority: 30,
    badgeLabel: 'In-Season'
  },
  {
    id: 'schedule_overview',
    title: 'Schedule',
    shortTitle: 'Schedule',
    phase: 'YEAR_ROUND',
    navTab: 'season',
    defaultPriority: 40,
    badgeLabel: 'Season'
  },
  {
    id: 'trade_deadline',
    title: 'Trade Window',
    shortTitle: 'Trade Window',
    phase: 'TRADE_WINDOW',
    navTab: 'season',
    defaultPriority: 50,
    badgeLabel: 'Oct 1 – Deadline'
  },
  {
    id: 'playoff_picture',
    title: 'Playoff Probabilities',
    shortTitle: 'Playoff Odds',
    phase: 'PLAYOFF_PUSH',
    navTab: 'season',
    defaultPriority: 52,
    badgeLabel: 'Final 5 Weeks'
  },
  {
    id: 'draft_prep',
    title: 'Draft',
    shortTitle: 'Draft',
    phase: 'DRAFT_PREP',
    navTab: 'season',
    defaultPriority: 54,
    badgeLabel: 'Pre-Draft'
  },
  {
    id: 'draft_live_udfa',
    title: 'Draft Recap',
    shortTitle: 'Draft Recap',
    phase: 'DRAFT_LIVE_UDFA',
    navTab: 'season',
    defaultPriority: 56,
    badgeLabel: 'Draft & UDFAs'
  },
  {
    id: 'team_stats',
    title: 'Team Stats',
    shortTitle: 'Team Stats',
    phase: 'IN_SEASON',
    navTab: 'season',
    defaultPriority: 60,
    badgeLabel: 'In-Season'
  },
  {
    id: 'roster_depth',
    title: 'Roster',
    shortTitle: 'Roster',
    phase: 'YEAR_ROUND',
    navTab: 'roster',
    defaultPriority: 70,
    badgeLabel: 'Year-Round'
  },
  {
    id: 'salary_cap',
    title: 'Salary Cap',
    shortTitle: 'Salary Cap',
    phase: 'YEAR_ROUND',
    navTab: 'roster',
    defaultPriority: 80,
    badgeLabel: 'Year-Round'
  },
  {
    id: 'autopodcast_ai',
    title: 'Auto Podcast',
    shortTitle: 'Auto Podcast',
    phase: 'YEAR_ROUND',
    navTab: 'audio',
    defaultPriority: 90,
    badgeLabel: 'Audio & AI'
  }
];

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
  // 5 weeks before end of regular season (Weeks 14, 15, 16, 17, 18 -> starts Tuesday Dec 8, 2026)
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

/**
 * Evaluate active phases and dashboard blocks for any timestamp and 49ers team status.
 * @param {object} options
 * @param {string|Date} [options.now] - Current timestamp
 * @param {object} [options.calendar] - NFL calendar anchor timestamps
 * @param {object} [options.teamStatus] - { eliminatedAt?: string|null, mathematicallyEliminated?: boolean, currentWeek?: number }
 */
export function evaluateSeasonState(options = {}) {
  const nowDate = options.now ? new Date(options.now) : new Date();
  const nowMs = nowDate.getTime();
  if (Number.isNaN(nowMs)) {
    throw new Error(`Invalid date passed to evaluateSeasonState: ${options.now}`);
  }

  const cal = { ...DEFAULT_NFL_CALENDAR_2026, ...(options.calendar || {}) };
  const status = options.teamStatus || {};

  const tKickoff = new Date(cal.kickoffStart).getTime();
  const tTradeStart = new Date(cal.tradeWindowStart).getTime();
  const tTradeDeadline = new Date(cal.tradeDeadline).getTime();
  const tPlayoffPushStart = new Date(cal.playoffPushStart).getTime();
  const tRegEnd = new Date(cal.regularSeasonEnd).getTime();
  const tSbEnd = new Date(cal.superBowlEnd).getTime();
  const tDraftStart = new Date(cal.draftDay1Start).getTime();
  const tPostUdfaEnd = new Date(cal.postUdfaEnd).getTime();
  const tPrevDraftStart = new Date(cal.prevDraftStart).getTime();
  const tPrevPostUdfaEnd = new Date(cal.prevPostUdfaEnd).getTime();

  const eliminatedMs = status.eliminatedAt ? new Date(status.eliminatedAt).getTime() : null;
  const isEliminatedNow = Boolean(
    (eliminatedMs && nowMs >= eliminatedMs) || status.mathematicallyEliminated
  );

  const activePhases = new Set(['YEAR_ROUND']);

  // 1. IN_SEASON: From kickoff until 49ers season ends (either eliminated after regular season/playoffs or Super Bowl ends)
  const seasonEndBoundary = eliminatedMs && eliminatedMs >= tRegEnd ? eliminatedMs : tSbEnd;
  const isInSeason = nowMs >= tKickoff && nowMs < seasonEndBoundary && !(isEliminatedNow && nowMs >= tRegEnd);
  if (isInSeason) {
    activePhases.add('IN_SEASON');
  }

  // 2. TRADE_WINDOW: Oct 1 through NFL Trade Deadline
  if (nowMs >= tTradeStart && nowMs <= tTradeDeadline) {
    activePhases.add('TRADE_WINDOW');
  }

  // 3. PLAYOFF_PUSH: 5 weeks before end of regular season until last game of regular season (or postseason if alive)
  const weekNum = Number(status.currentWeek || 0);
  const inFinal5WeeksByDate = nowMs >= tPlayoffPushStart && nowMs <= tRegEnd;
  const inFinal5WeeksByWeek = weekNum >= 14 && weekNum <= 18 && isInSeason;
  if ((inFinal5WeeksByDate || inFinal5WeeksByWeek) && !status.mathematicallyEliminated) {
    activePhases.add('PLAYOFF_PUSH');
  }

  // 4. DRAFT_PREP: From the moment 49ers are eliminated from post-season (or post-Super Bowl) until Draft starts
  const draftPrepStart = eliminatedMs ? Math.max(eliminatedMs, tRegEnd) : tSbEnd;
  const inPre2026Draft = nowMs < tPrevDraftStart;
  if ((nowMs >= draftPrepStart && nowMs < tDraftStart) || inPre2026Draft) {
    activePhases.add('DRAFT_PREP');
  }

  // 5. DRAFT_LIVE_UDFA: 1st Day of Draft until after UDFA period
  const inCurrentDraftUdfa = nowMs >= tDraftStart && nowMs <= tPostUdfaEnd;
  const inPrevDraftUdfa = nowMs >= tPrevDraftStart && nowMs <= tPrevPostUdfaEnd;
  if (inCurrentDraftUdfa || inPrevDraftUdfa) {
    activePhases.add('DRAFT_LIVE_UDFA');
  }

  const activePhaseList = Array.from(activePhases);

  const activeBlocks = ALL_DASHBOARD_BLOCKS
    .filter(b => activePhases.has(b.phase))
    .sort((a, b) => a.defaultPriority - b.defaultPriority);

  const archivedBlocks = ALL_DASHBOARD_BLOCKS
    .filter(b => !activePhases.has(b.phase))
    .sort((a, b) => a.defaultPriority - b.defaultPriority);

  // Build primary seasonal headline banner
  let headlinePhase = {
    code: 'OFFSEASON',
    label: 'Offseason & Roster Building',
    detail: '90-man roster evaluation, OTAs/Training Camp & cap management',
    countdownText: null
  };

  if (activePhases.has('DRAFT_LIVE_UDFA')) {
    headlinePhase = {
      code: 'DRAFT_LIVE_UDFA',
      label: 'NFL Draft & Priority UDFA Window',
      detail: 'Pick-by-pick value grades, athletic spider charts & college tape reels',
      countdownText: formatRemainingTime(nowMs, nowMs <= tPrevPostUdfaEnd ? tPrevPostUdfaEnd : tPostUdfaEnd, 'UDFA Window Closes')
    };
  } else if (activePhases.has('DRAFT_PREP')) {
    headlinePhase = {
      code: 'DRAFT_PREP',
      label: 'NFL Draft & Combine Preview',
      detail: 'Consensus mocks, Shanahan/Lynch archetype fit scores & Combine results',
      countdownText: formatRemainingTime(nowMs, inPre2026Draft ? tPrevDraftStart : tDraftStart, 'Round 1 Kickoff')
    };
  } else if (activePhases.has('TRADE_WINDOW')) {
    headlinePhase = {
      code: 'TRADE_WINDOW',
      label: 'Active NFL Trade Window',
      detail: 'Week ' + (weekNum || 9) + ' matchup + Trade Deadline targets, cap math & beat reports',
      countdownText: formatRemainingTime(nowMs, tTradeDeadline, 'Trade Deadline')
    };
  } else if (activePhases.has('PLAYOFF_PUSH')) {
    headlinePhase = {
      code: 'PLAYOFF_PUSH',
      label: 'NFC Playoff & Seeding Stretch',
      detail: '10,000-run Monte Carlo tiebreakers, #1 seed path & weekly rooting leverage',
      countdownText: formatRemainingTime(nowMs, tRegEnd, 'Regular Season Finale')
    };
  } else if (activePhases.has('IN_SEASON')) {
    headlinePhase = {
      code: 'IN_SEASON',
      label: nowMs >= tRegEnd ? 'NFL Postseason' : `In-Season • Week ${weekNum || ''}`.trim(),
      detail: 'Matchup trench mismatches, coaching H2H tendencies & player availability',
      countdownText: null
    };
  }

  return {
    evaluatedAt: nowDate.toISOString(),
    activePhases: activePhaseList,
    headlinePhase,
    activeBlocks,
    archivedBlocks
  };
}

/**
 * Reconciles user's saved drag-and-drop block order with the currently active blocks.
 * Newly activated seasonal blocks that aren't in the user's saved order yet are inserted
 * near the top according to their defaultPriority so temporal events aren't buried!
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

  // Newly activated seasonal/temporal blocks not yet seen by user
  const newlyActivated = activeBlocks.filter(b => !seen.has(b.id));
  if (newlyActivated.length === 0) {
    return knownOrdered;
  }

  const merged = [...knownOrdered];
  for (const newBlock of newlyActivated) {
    // Insert newly activated blocks according to their natural defaultPriority neighbor
    const nextHigherIdx = merged.findIndex(b => b.defaultPriority > newBlock.defaultPriority);
    const insertIdx = nextHigherIdx >= 0 ? nextHigherIdx : merged.length;
    merged.splice(insertIdx, 0, newBlock);
  }
  return merged;
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
    let tradeMs = rawIso ? Date.parse(rawIso) : NaN;
    if (!Number.isFinite(tradeMs) && typeof m.compensation === 'string') {
      const dateMatch = m.compensation.match(
        /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s*\d{4})/i
      );
      if (dateMatch) {
        tradeMs = Date.parse(dateMatch[1]);
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
