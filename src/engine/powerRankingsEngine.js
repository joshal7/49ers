/**
 * Power Rankings Freshness, Week-Consistency & Consensus Engine (`49ers.joshal.com`)
 *
 * Guarantees two strict invariants across build-time data refreshes and live client renders:
 *  1. Zero fabricated ranks — consensus and range are computed strictly from verified
 *     upstream outlet ranks (Inpredictable, nfelo, RBSDM, ESPN FPI, ESPN Panel, CBS Sports).
 *  2. Strict week consistency & 24-hour post-game cutoff — rankings from different weeks
 *     are never mixed into the same consensus. Once `cutoffHours` (default 24h) have elapsed
 *     after the 49ers' most recent completed game, all older-week rankings that do not
 *     include that game are disregarded unconditionally.
 */

import { getActiveTeamConfig, resolveTeamConfig } from '../config/teamRegistry.js';

export const POST_GAME_FRESHNESS_CUTOFF_HOURS = 24;
export const DEFAULT_GAME_DURATION_HOURS = 3.5;

function toFiniteNumberOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Formats an integer rank movement (`previousRank - currentRank`) into a signed string.
 * Positive means moved UP (better rank, e.g. #2 -> #1 => '+1').
 * @param {number|string|null|undefined} delta
 * @returns {string}
 */
export function formatRankDelta(delta) {
  if (delta == null || delta === '' || delta === '--') return '0';
  if (typeof delta === 'string') {
    const trimmed = delta.trim();
    if (/^[+-]\d+$/.test(trimmed)) return trimmed;
    if (trimmed === '0') return '0';
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return '0';
    delta = parsed;
  }
  const n = Math.round(Number(delta));
  if (!Number.isFinite(n) || n === 0) return '0';
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * Parses a team W-L or W-L-T record string (e.g. "8-1", "8-1-0") into counts.
 * @param {string|null|undefined} recordStr
 * @returns {{ wins: number, losses: number, ties: number, games: number, normalized: string } | null}
 */
export function parseRecordGamesCount(recordStr) {
  if (!recordStr || typeof recordStr !== 'string') return null;
  const m = recordStr.trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})(?:\s*-\s*(\d{1,2}))?$/);
  if (!m) return null;
  const wins = Number(m[1]);
  const losses = Number(m[2]);
  const ties = m[3] != null ? Number(m[3]) : 0;
  if (!Number.isFinite(wins) || !Number.isFinite(losses) || !Number.isFinite(ties)) return null;
  const games = wins + losses + ties;
  const normalized = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  return { wins, losses, ties, games, normalized };
}

/**
 * Determines whether a schedule item represents a completed 49ers game.
 * @param {object} g
 * @param {number} nowMs
 * @returns {boolean}
 */
function isCompletedGameEntry(g, nowMs) {
  if (!g || g.isBye || g.oppAbbr === 'BYE') return false;
  const res = String(g.result || '').trim().toUpperCase();
  if (res === 'W' || res === 'L' || res === 'T') return true;
  const status = String(g.status || '').trim().toLowerCase();
  if (status === 'final' || status === 'completed' || status === 'post') return true;
  const scoreStr = String(g.scoreDisplay || '').trim();
  if (/^[WLT]\s+\d+\s*[-–]\s*\d+/i.test(scoreStr)) return true;
  if (Number.isFinite(g.sfScore) && Number.isFinite(g.oppScore) && g.kickoffIso) {
    const kickMs = Date.parse(g.kickoffIso);
    if (Number.isFinite(kickMs) && kickMs + DEFAULT_GAME_DURATION_HOURS * 3600_000 <= nowMs) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the 49ers' most recently completed regular/postseason game and whether the
 * post-game freshness cutoff (default 24 hours after game end) has passed.
 *
 * @param {Array<object>} schedule
 * @param {number} [nowMs=Date.now()]
 * @param {number} [cutoffHours=24]
 */
export function resolveLatestCompletedSfGame(
  schedule = [],
  nowMs = Date.now(),
  cutoffHours = POST_GAME_FRESHNESS_CUTOFF_HOURS
) {
  const safeCutoffHours = Number.isFinite(cutoffHours) && cutoffHours >= 0
    ? cutoffHours
    : POST_GAME_FRESHNESS_CUTOFF_HOURS;

  const list = Array.isArray(schedule) ? schedule : [];
  const regCompleted = [];
  const postCompleted = [];

  for (const g of list) {
    const st = String(g?.seasonType || 'REG').toUpperCase();
    if (st === 'PRE') continue;
    if (!isCompletedGameEntry(g, nowMs)) continue;
    if (st === 'POST') postCompleted.push(g);
    else regCompleted.push(g);
  }

  const allCompleted = [...regCompleted, ...postCompleted];
  const sortKey = g => {
    const kickMs = Date.parse(g.completedAtIso || g.kickoffIso || g.dateIso || '');
    if (Number.isFinite(kickMs)) return kickMs;
    const stOffset = String(g.seasonType || 'REG').toUpperCase() === 'POST' ? 100 : 0;
    return stOffset + (Number(g.week) || 0);
  };
  allCompleted.sort((a, b) => sortKey(a) - sortKey(b));

  const latestGame = allCompleted.length > 0 ? allCompleted[allCompleted.length - 1] : null;
  let regWins = 0;
  let regLosses = 0;
  let regTies = 0;
  for (const g of regCompleted) {
    const r = String(g.result || '').trim().toUpperCase();
    if (r === 'W') regWins += 1;
    else if (r === 'L') regLosses += 1;
    else if (r === 'T') regTies += 1;
  }

  let gameEndMs = null;
  let kickoffMs = null;
  if (latestGame) {
    const compMs = Date.parse(latestGame.completedAtIso || '');
    const kMs = Date.parse(latestGame.kickoffIso || latestGame.dateIso || '');
    kickoffMs = Number.isFinite(kMs) ? kMs : null;
    if (Number.isFinite(compMs)) {
      gameEndMs = compMs;
    } else if (kickoffMs != null) {
      gameEndMs = kickoffMs + DEFAULT_GAME_DURATION_HOURS * 3600_000;
    }
  }

  const hoursSinceGameEnd = gameEndMs != null ? (nowMs - gameEndMs) / 3600_000 : null;
  const pastFreshnessCutoff =
    latestGame != null && hoursSinceGameEnd != null ? hoursSinceGameEnd >= safeCutoffHours : false;

  const sfRecord = regCompleted.length > 0
    ? (regTies > 0 ? `${regWins}-${regLosses}-${regTies}` : `${regWins}-${regLosses}`)
    : null;

  const regCompletedWeeks = allCompleted
    .filter(g => String(g?.seasonType || 'REG').toUpperCase() !== 'POST')
    .map(g => Number(g.week) || null)
    .filter(w => w != null);
  const allCompletedWeeks = allCompleted
    .map(g => Number(g.week) || null)
    .filter(w => w != null);

  return {
    latestGame,
    latestGameWeek: latestGame ? Number(latestGame.week) || null : null,
    latestGameSeasonType: latestGame ? String(latestGame.seasonType || 'REG').toUpperCase() : null,
    sfCompletedGames: allCompleted.length,
    sfCompletedRegGames: regCompleted.length,
    sfCompletedPostGames: postCompleted.length,
    regCompletedWeeks,
    allCompletedWeeks,
    sfRecord,
    kickoffMs,
    gameEndMs,
    hoursSinceGameEnd,
    pastFreshnessCutoff,
    cutoffHours: safeCutoffHours
  };
}

/**
 * Resolves the canonical `throughWeek` for a prior-week source whose `gamesIncluded`
 * is strictly behind `expectedGames`.
 *
 * Uses the team's actual completed schedule so that:
 *  - Calendar-week inflation (e.g., ESPN FPI reporting `currentSeason.week = 11` while a
 *    team's FPI record is still 7-2 / 9 games before Week 11) is clamped to the true prior
 *    week (`nextPlayedWeek - 1 = 10`) instead of falsely claiming Week 11.
 *  - Record-only models without explicit week labels (e.g., `nfelo`) map cleanly into the
 *    exact same prior-week cohort (`10`) instead of being orphaned into a separate `gm:9` bucket.
 *  - Teams coming off a Bye week (e.g., Week 10 Bye where Inpredictable's Past Schedule ends
 *    at Wk 9 while the team's 9-game record IS its Week 10 body of work) unify cleanly with
 *    all other Week 10 models (`nextPlayedWeek - 1 = 10`) while genuinely older Week 8/9
 *    ratings stay isolated in their older week bucket.
 */
function resolveScheduleConsistentThroughWeek(gamesIncluded, rawThroughWeek, gameContext) {
  const expectedWeek = gameContext?.latestGameWeek ?? null;
  const expectedGames =
    gameContext?.latestGameSeasonType === 'POST'
      ? gameContext?.sfCompletedGames ?? 0
      : gameContext?.sfCompletedRegGames ?? 0;
  const completedWeeks =
    gameContext?.latestGameSeasonType === 'POST'
      ? gameContext?.allCompletedWeeks
      : gameContext?.regCompletedWeeks;

  if (
    Array.isArray(completedWeeks) &&
    gamesIncluded != null &&
    gamesIncluded >= 1 &&
    gamesIncluded < completedWeeks.length
  ) {
    const lastPlayedWk = completedWeeks[gamesIncluded - 1];
    const nextPlayedWk = completedWeeks[gamesIncluded];
    if (
      Number.isFinite(lastPlayedWk) &&
      Number.isFinite(nextPlayedWk) &&
      nextPlayedWk > lastPlayedWk
    ) {
      const maxConsistentWk = nextPlayedWk - 1;
      if (rawThroughWeek == null) return maxConsistentWk;
      if (rawThroughWeek >= nextPlayedWk) return maxConsistentWk;
      if (rawThroughWeek >= lastPlayedWk && rawThroughWeek < nextPlayedWk) return maxConsistentWk;
      return rawThroughWeek;
    }
  }

  if (rawThroughWeek != null && expectedWeek != null && rawThroughWeek >= expectedWeek) {
    return Math.max(0, expectedWeek - 1);
  }
  if (rawThroughWeek == null && expectedWeek != null && gamesIncluded != null && gamesIncluded === expectedGames - 1) {
    return Math.max(0, expectedWeek - 1);
  }
  return rawThroughWeek;
}

/**
 * Formats a UTC timestamp into `YYYY-MM-DD` in America/Los_Angeles (Pacific Time)
 * for date-only source comparisons (e.g., Inpredictable "As of November 16, 2026").
 */
function toPacificYmd(ms) {
  if (!Number.isFinite(ms)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(ms));
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    return y && m && d ? `${y}-${m}-${d}` : null;
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * Evaluates whether a single verified power ranking source reflects the 49ers' most recent
 * completed game.
 *
 * Priority order:
 *  1. Source's own reported 49ers games played (`gamesIncluded` or parsed `reportedRecord`)
 *     compared against `sfCompletedRegGames` (or total games in postseason).
 *  2. Explicit `throughWeek` reported by the source (e.g. "Week 11 Power Rankings" => throughWeek 10).
 *  3. Source publication/asOf timestamp compared to the game's end timestamp.
 *
 * @param {object} source
 * @param {object} gameContext Output of `resolveLatestCompletedSfGame`
 */
export function evaluatePowerRankingSourceFreshness(source, gameContext) {
  const rankNum = toFiniteNumberOrNull(source?.rank);
  if (!source || rankNum == null) {
    return { includesLatestGame: false, reason: 'invalid_source', resolvedGamesIncluded: null, resolvedThroughWeek: null };
  }

  const parsedRec = parseRecordGamesCount(source.reportedRecord);
  const rawGames = toFiniteNumberOrNull(source.gamesIncluded);
  const resolvedGamesIncluded = rawGames != null ? rawGames : parsedRec?.games ?? null;

  const rawThroughWeek = toFiniteNumberOrNull(source.throughWeek);
  const rawForWeek = toFiniteNumberOrNull(source.forWeek);
  const resolvedThroughWeek =
    rawThroughWeek != null
      ? rawThroughWeek
      : rawForWeek != null && rawForWeek >= 1
        ? rawForWeek - 1
        : null;

  // Preseason / Offseason (0 completed games): all verified season rankings are eligible.
  if (!gameContext || !gameContext.latestGame || gameContext.sfCompletedGames === 0) {
    return {
      includesLatestGame: true,
      reason: 'preseason_or_offseason',
      resolvedGamesIncluded,
      resolvedThroughWeek
    };
  }

  const expectedGames =
    gameContext.latestGameSeasonType === 'POST'
      ? gameContext.sfCompletedGames
      : gameContext.sfCompletedRegGames;
  const expectedWeek = gameContext.latestGameWeek;

  // Check 1: Explicit team W-L-T games count reported by the source itself
  if (resolvedGamesIncluded != null && expectedGames > 0) {
    if (resolvedGamesIncluded < expectedGames) {
      const consistentPriorWeek = resolveScheduleConsistentThroughWeek(
        resolvedGamesIncluded,
        resolvedThroughWeek,
        gameContext
      );
      return {
        includesLatestGame: false,
        reason: 'record_behind',
        resolvedGamesIncluded,
        resolvedThroughWeek: consistentPriorWeek
      };
    }
    // Also guard against a source explicitly labeled for an earlier week than expectedWeek
    // (e.g., CBS Sports "Week 11 Power Rankings" => throughWeek 10 whose live standings widget
    // already bumped the record column to Week 11 before Week 12 rankings publish; note that
    // during a Bye week, expectedWeek is the team's last played week so resolvedThroughWeek >= expectedWeek passes!).
    if (
      resolvedThroughWeek != null &&
      expectedWeek != null &&
      resolvedThroughWeek < expectedWeek &&
      resolvedGamesIncluded >= expectedGames
    ) {
      return {
        includesLatestGame: false,
        reason: 'week_behind',
        resolvedGamesIncluded,
        resolvedThroughWeek
      };
    }
    return {
      includesLatestGame: true,
      reason: 'record_verified',
      resolvedGamesIncluded,
      resolvedThroughWeek: resolvedThroughWeek ?? expectedWeek
    };
  }

  // Check 2: Explicit `throughWeek` / `forWeek` when no record was parsed
  if (resolvedThroughWeek != null && expectedWeek != null) {
    const ok = resolvedThroughWeek >= expectedWeek;
    return {
      includesLatestGame: ok,
      reason: ok ? 'week_verified' : 'week_behind',
      resolvedGamesIncluded,
      resolvedThroughWeek
    };
  }

  // Check 3: Publication / as-of timestamp fallback
  if (source.asOfIso && gameContext.gameEndMs != null) {
    const isoStr = String(source.asOfIso).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) {
      const gameYmd = toPacificYmd(gameContext.gameEndMs);
      const ok = gameYmd != null ? isoStr >= gameYmd : false;
      return {
        includesLatestGame: ok,
        reason: ok ? 'date_verified' : 'date_behind',
        resolvedGamesIncluded,
        resolvedThroughWeek
      };
    }
    const asOfMs = Date.parse(isoStr);
    if (Number.isFinite(asOfMs)) {
      const ok = asOfMs >= gameContext.gameEndMs;
      return {
        includesLatestGame: ok,
        reason: ok ? 'timestamp_verified' : 'timestamp_behind',
        resolvedGamesIncluded,
        resolvedThroughWeek
      };
    }
  }

  // If a source carries no week, no record, and no timestamp after games have been played,
  // treat it conservatively as unverified-stale so it never contaminates a post-game cohort.
  return {
    includesLatestGame: false,
    reason: 'missing_freshness_metadata',
    resolvedGamesIncluded,
    resolvedThroughWeek
  };
}

/**
 * Selects the single most recent consistent prior-week cohort from stale sources
 * (used ONLY during the <24h pre-cutoff window when fewer than 2 sources have updated
 * with the latest game yet, so weeks are NEVER mixed).
 */
function selectHighestConsistentPriorCohort(evaluatedStale, gameContext = null) {
  if (!evaluatedStale.length) return [];
  const latestWk = gameContext?.latestGameWeek ?? null;
  const resolveCohortWeek = entry => {
    const wk = entry.freshness.resolvedThroughWeek;
    if (wk == null) return null;
    // A source in `evaluatedStale` does NOT include `latestWk`, so its cohort week
    // can never be >= `latestWk` (guards against calendar-week labels like ESPN FPI).
    if (latestWk != null && wk >= latestWk) return Math.max(0, latestWk - 1);
    return wk;
  };
  const bucketKey = entry => {
    const wk = resolveCohortWeek(entry);
    const gm = entry.freshness.resolvedGamesIncluded;
    if (wk != null) return `wk:${wk}`;
    if (gm != null) return `gm:${gm}`;
    return 'unknown';
  };
  const scoreEntry = entry => {
    const wk = resolveCohortWeek(entry) ?? -1;
    const gm = entry.freshness.resolvedGamesIncluded ?? -1;
    return wk * 100 + gm;
  };

  let bestKey = null;
  let bestScore = -Infinity;
  const buckets = new Map();
  for (const e of evaluatedStale) {
    const k = bucketKey(e);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(e);
    const sc = scoreEntry(e);
    if (sc > bestScore) {
      bestScore = sc;
      bestKey = k;
    }
  }
  return bestKey ? buckets.get(bestKey) || [] : evaluatedStale;
}

/**
 * Builds a concise, truthful synthesized takeaway grounded strictly in the active
 * week-consistent sources (no fabricated stats or stale players).
 */
function buildGroundedPowerTakeaway(
  activeSources,
  stats,
  { sfRecord, consistentThroughWeek, currentWeek, oppShortName, cohortStatus, excludedCount, teamAbbr = null }
) {
  if (!activeSources.length) {
    if (cohortStatus === 'awaiting_post_game_updates' && consistentThroughWeek != null) {
      return `All tracked power models and national polls are updating following Week ${consistentThroughWeek}. Prior-week rankings are hidden until post-game updates publish.`;
    }
    return 'Tracking verified national polls and quantitative power models as new weekly ratings publish.';
  }

  const best = activeSources[0];
  const worst = activeSources[activeSources.length - 1];
  const recordClause = sfRecord ? `${sfRecord} ` : '';
  const wkClause =
    consistentThroughWeek != null
      ? consistentThroughWeek === 0
        ? ' entering Week 1'
        : ` through Week ${consistentThroughWeek}`
      : '';
  const avgStr = stats.averageRank != null ? ` (avg #${stats.averageRank.toFixed(1)})` : '';
  const countLabel = `${activeSources.length} verified ${activeSources.length === 1 ? 'model' : 'models & polls'}`;
  const verb = activeSources.length === 1 ? 'places' : 'place';

  const activeTeam = resolveTeamConfig(teamAbbr || getActiveTeamConfig());
  const teamNick = activeTeam.nickname || '49ers';
  let sentence1 = `${countLabel} ${verb} the ${recordClause}${teamNick} at #${stats.consensusRank} consensus${avgStr}${wkClause}`;
  if (stats.rangeMin !== stats.rangeMax) {
    sentence1 += `, ranging from #${stats.rangeMin} (${best.shortName || best.outlet}) to #${stats.rangeMax} (${worst.shortName || worst.outlet}).`;
  } else {
    sentence1 += ` (unanimous #${stats.rangeMin}).`;
  }

  const extras = [];
  if (cohortStatus === 'pre_cutoff_prior_week' && consistentThroughWeek != null) {
    const cohortLabel = consistentThroughWeek === 0 ? 'preseason' : `Week ${consistentThroughWeek}`;
    extras.push(`Showing the consistent ${cohortLabel} cohort while post-game updates publish.`);
  } else if (excludedCount > 0) {
    extras.push(`${excludedCount} outlet${excludedCount === 1 ? '' : 's'} still on an older week ${excludedCount === 1 ? 'is' : 'are'} excluded for week consistency.`);
  } else if (oppShortName && currentWeek && consistentThroughWeek != null && currentWeek > consistentThroughWeek) {
    extras.push(`All listed models include the ${teamNick}' latest result entering Week ${currentWeek} vs. ${oppShortName}.`);
  }

  return extras.length ? `${sentence1} ${extras.join(' ')}` : sentence1;
}

/**
 * Resolves a week-consistent, freshness-enforced Power Rankings snapshot from raw parsed
 * sources + the team's schedule.
 *
 * Works identically at build time (Node.js) and in the browser (client render), ensuring
 * that if 24 hours pass after a team's game finishes even between data builds, stale
 * prior-week sources are automatically disregarded.
 *
 * @param {object|null|undefined} rawPowerRankings
 * @param {Array<object>} [schedule=[]]
 * @param {object} [options={}]
 */
export function resolveConsistentPowerRankings(rawPowerRankings, schedule = [], options = {}) {
  const {
    nowMs = Date.now(),
    cutoffHours = POST_GAME_FRESHNESS_CUTOFF_HOURS,
    currentWeek = null,
    sfRecord = null,
    oppShortName = null,
    teamAbbr = null
  } = options || {};

  const raw = rawPowerRankings && typeof rawPowerRankings === 'object' ? rawPowerRankings : {};
  const candidateList = Array.isArray(raw.allSources) && raw.allSources.length > 0
    ? raw.allSources
    : Array.isArray(raw.sources)
      ? raw.sources
      : [];

  // Filter out invalid ranks or explicitly unverified synthetic entries
  const validCandidates = candidateList
    .filter(s => s && s.verified !== false && Number.isFinite(Number(s.rank)) && Number(s.rank) >= 1 && Number(s.rank) <= 32)
    .map(s => ({
      ...s,
      rank: Math.round(Number(s.rank)),
      delta: formatRankDelta(s.delta)
    }));

  const gameContext = resolveLatestCompletedSfGame(schedule, nowMs, cutoffHours);
  const resolvedSfRecord = sfRecord || gameContext.sfRecord || null;

  const evaluated = validCandidates.map(source => ({
    source,
    freshness: evaluatePowerRankingSourceFreshness(source, gameContext)
  }));

  const freshEvaluated = evaluated.filter(e => e.freshness.includesLatestGame === true);
  const staleEvaluated = evaluated.filter(e => e.freshness.includesLatestGame !== true);

  let selectedEvaluated = [];
  let excludedEvaluated = [];
  let cohortStatus = 'latest_game_verified';
  let consistentThroughWeek = gameContext.latestGameWeek;

  if (!gameContext.latestGame || gameContext.sfCompletedGames === 0) {
    selectedEvaluated = freshEvaluated;
    excludedEvaluated = [];
    cohortStatus = 'preseason_or_offseason';
    consistentThroughWeek = selectedEvaluated[0]?.freshness?.resolvedThroughWeek ?? null;
  } else if (gameContext.pastFreshnessCutoff) {
    // STRICT >= 24h RULE: Disregard ALL older-week rankings unconditionally!
    selectedEvaluated = freshEvaluated;
    excludedEvaluated = staleEvaluated;
    cohortStatus = freshEvaluated.length > 0 ? 'latest_game_verified' : 'awaiting_post_game_updates';
    consistentThroughWeek = gameContext.latestGameWeek;
  } else {
    // < 24h post-game grace window: NEVER mix weeks!
    if (freshEvaluated.length >= 2) {
      selectedEvaluated = freshEvaluated;
      excludedEvaluated = staleEvaluated;
      cohortStatus = staleEvaluated.length > 0 ? 'latest_game_partial' : 'latest_game_verified';
      consistentThroughWeek = gameContext.latestGameWeek;
    } else if (freshEvaluated.length > 0 && staleEvaluated.length === 0) {
      selectedEvaluated = freshEvaluated;
      excludedEvaluated = [];
      cohortStatus = 'latest_game_verified';
      consistentThroughWeek = gameContext.latestGameWeek;
    } else if (staleEvaluated.length > 0) {
      selectedEvaluated = selectHighestConsistentPriorCohort(staleEvaluated, gameContext);
      excludedEvaluated = [];
      cohortStatus = 'pre_cutoff_prior_week';
      const rawPriorWk =
        selectedEvaluated[0]?.freshness?.resolvedThroughWeek ??
        (gameContext.latestGameWeek != null ? Math.max(0, gameContext.latestGameWeek - 1) : null);
      consistentThroughWeek =
        rawPriorWk != null && gameContext.latestGameWeek != null
          ? Math.min(rawPriorWk, Math.max(0, gameContext.latestGameWeek - 1))
          : rawPriorWk;
    } else {
      selectedEvaluated = [];
      excludedEvaluated = [];
      cohortStatus = 'awaiting_post_game_updates';
      consistentThroughWeek = gameContext.latestGameWeek;
    }
  }

  // Sort active sources cleanly by rank asc, then outlet name asc
  const activeSources = selectedEvaluated
    .map(e => ({
      ...e.source,
      throughWeek: e.freshness.resolvedThroughWeek ?? e.source.throughWeek ?? null,
      gamesIncluded: e.freshness.resolvedGamesIncluded ?? e.source.gamesIncluded ?? null,
      includesLatestGame: e.freshness.includesLatestGame,
      freshnessReason: e.freshness.reason
    }))
    .sort((a, b) => a.rank - b.rank || String(a.outlet || '').localeCompare(String(b.outlet || '')));

  // Disregarded stale sources: metadata only (never active in consensus)
  const excludedStaleSources = excludedEvaluated.map(e => ({
    id: e.source.id || null,
    outlet: e.source.outlet,
    shortName: e.source.shortName || e.source.outlet,
    url: e.source.url,
    throughWeek: e.freshness.resolvedThroughWeek ?? e.source.throughWeek ?? null,
    reportedRecord: e.source.reportedRecord || null,
    asOfLabel: e.source.asOfLabel || null,
    freshnessReason: e.freshness.reason
  }));

  // Compute exact consensus & range strictly from activeSources
  let consensusRank = null;
  let averageRank = null;
  let medianRank = null;
  let previousRank = null;
  let rangeMin = null;
  let rangeMax = null;
  let rangeShort = null;
  let rangeDisplay = '';

  if (activeSources.length > 0) {
    const ranks = activeSources.map(s => s.rank).sort((a, b) => a - b);
    averageRank = ranks.reduce((sum, r) => sum + r, 0) / ranks.length;
    consensusRank = Math.max(1, Math.min(32, Math.round(averageRank)));
    const mid = Math.floor(ranks.length / 2);
    medianRank = ranks.length % 2 === 1 ? ranks[mid] : (ranks[mid - 1] + ranks[mid]) / 2;
    rangeMin = ranks[0];
    rangeMax = ranks[ranks.length - 1];
    rangeShort = rangeMin === rangeMax ? `#${rangeMin}` : `#${rangeMin}–#${rangeMax}`;
    rangeDisplay = `${rangeShort} across ${activeSources.length} verified ${activeSources.length === 1 ? 'model' : 'models & polls'}`;

    const prevRanks = activeSources
      .map(s => {
        const pr = toFiniteNumberOrNull(s.previousRank);
        if (pr != null) return pr;
        const d = toFiniteNumberOrNull(s.delta);
        if (d != null) return Math.max(1, Math.min(32, s.rank + d));
        return null;
      })
      .filter(v => v != null);
    if (prevRanks.length > 0) {
      previousRank = Math.max(1, Math.min(32, Math.round(prevRanks.reduce((a, b) => a + b, 0) / prevRanks.length)));
    }
  }

  // Consistent eyebrow weekLabel
  let weekLabel = raw.weekLabel || '';
  if (cohortStatus === 'awaiting_post_game_updates' && gameContext.latestGameWeek != null) {
    weekLabel = `Updating After Week ${gameContext.latestGameWeek}`;
  } else if (cohortStatus === 'pre_cutoff_prior_week' && consistentThroughWeek != null) {
    weekLabel =
      consistentThroughWeek === 0
        ? `Preseason • Updating After Week ${gameContext.latestGameWeek}`
        : `Through Week ${consistentThroughWeek} • Updating After Week ${gameContext.latestGameWeek}`;
  } else if (consistentThroughWeek != null) {
    if (currentWeek && Number(currentWeek) > consistentThroughWeek) {
      weekLabel = `Through Week ${consistentThroughWeek} • Entering Week ${currentWeek}`;
    } else {
      weekLabel = `Through Week ${consistentThroughWeek}`;
    }
  } else if (currentWeek) {
    weekLabel = `Entering Week ${currentWeek}`;
  }

  const synthesizedTakeaway = buildGroundedPowerTakeaway(
    activeSources,
    { consensusRank, averageRank, rangeMin, rangeMax },
    {
      sfRecord: resolvedSfRecord,
      consistentThroughWeek,
      currentWeek,
      oppShortName,
      cohortStatus,
      excludedCount: excludedStaleSources.length,
      teamAbbr
    }
  );

  return {
    weekLabel,
    consistentThroughWeek,
    latestCompletedWeek: gameContext.latestGameWeek,
    sfCompletedGames: gameContext.sfCompletedGames,
    pastFreshnessCutoff: gameContext.pastFreshnessCutoff,
    cutoffHours: gameContext.cutoffHours,
    cohortStatus,
    consensusRank,
    averageRank: averageRank != null ? Number(averageRank.toFixed(1)) : null,
    medianRank,
    previousRank,
    rangeMin,
    rangeMax,
    rangeShort,
    rangeDisplay,
    synthesizedTakeaway,
    sources: activeSources,
    allSources: validCandidates,
    excludedStaleSources,
    disregardedStaleCount: excludedStaleSources.length,
    fetchedAtIso: raw.fetchedAtIso || null
  };
}
