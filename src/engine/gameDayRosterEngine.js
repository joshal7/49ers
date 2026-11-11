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
 * Parses recent wire items (tweets/blurbs near kickoff) to detect official inactive lists,
 * individual inactive scratches, active confirmations, and rare emergency/GTD active tags.
 * Evaluates status per-clause so mixed tweets ("Bosa is active today, while Evans is inactive")
 * never cross-contaminate active and inactive players.
 */
export function extractWireGameDaySignals(newsItems = [], candidatePlayers = [], kickoffMs = 0) {
  const inactiveKeys = new Set();
  const activeKeys = new Set();
  const gtdActiveKeys = new Set();
  let hasOfficialListSignal = false;

  const minPubMs = Number.isFinite(kickoffMs) && kickoffMs > 0 ? kickoffMs - 3.5 * 3600_000 : 0;
  const maxPubMs = Number.isFinite(kickoffMs) && kickoffMs > 0 ? kickoffMs + 4.5 * 3600_000 : Infinity;

  const playerMatchers = (candidatePlayers || [])
    .map(p => {
      const name = p?.name || p?.fullName || '';
      const key = normalizeLookupName(name);
      if (!key || name.length < 4) return null;
      const stripped = name.replace(/\b(Jr\.?|Sr\.?|II|III|IV|V)\b\.?/gi, '').trim();
      const collapsed = collapseInitialDots(stripped);
      const variants = [...new Set([stripped, collapsed].filter(s => s.length >= 4))].map(s =>
        s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      );
      return variants.length > 0 ? { key, regex: getCachedPlayerRegex(`(?:${variants.join('|')})`) } : null;
    })
    .filter(Boolean);

  for (const item of newsItems || []) {
    const pubMs = Date.parse(item?.publishedAt || '');
    if (Number.isFinite(pubMs) && (pubMs < minPubMs || pubMs > maxPubMs)) continue;

    const text = `${item?.title || ''} ${item?.fullText || ''} ${item?.summary || ''}`.trim();
    if (!text) continue;

    if (/\binactives\b\s*[:\-]|game[\s-]?day inactives|today'?s inactives/i.test(text)) {
      hasOfficialListSignal = true;
    }

    const clauses = text
      .split(/[.;!\n]+|\b(?:while|whereas|but|however|meanwhile)\b/i)
      .map(c => c.trim())
      .filter(Boolean);

    for (const clause of clauses) {
      const isInactiveListClause = /\b(?:today'?s |game[\s-]?day |49ers |official )?inactives\s*:/i.test(clause);
      const isInactiveProse =
        isInactiveListClause ||
        /\b(is inactive|are inactive|officially inactive|among .*inactives|ruled out for today|will not play today|healthy scratch)\b/i.test(
          clause
        );
      const isEmergencyGtdProse =
        /\b(available only in an emergency|emergency (?:third )?qb|active.*game-time decision|game-time decision.*active|snap count limit)\b/i.test(
          clause
        );
      const isActiveProse =
        /\b(officially active|is active today|are active today|active for today|will play today|cleared to play)\b/i.test(
          clause
        );

      if (!isInactiveProse && !isEmergencyGtdProse && !isActiveProse) continue;

      for (const pm of playerMatchers) {
        if (!pm.regex.test(clause)) continue;
        if (isInactiveProse && !isActiveProse) {
          inactiveKeys.add(pm.key);
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
    hasOfficialListSignal
  };
}

/**
 * Builds the Game-Day Inactives + Collapsible Active Roster model (Offense, Defense, Special Teams)
 * for either the 49ers or the Opposing Team.
 *
 * Robust to posting delays right around T-90m:
 *  - Shows immediately at T-90m with `isOfficialListPosted: false` ("Official Inactives Pending") + pre-declared Out players
 *  - Flips to `isOfficialListPosted: true` the moment official inactives post on ESPN/wire or kickoff starts
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
      active: false,
      isInactive: true
    })))
  ];

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

  // Reconcile ESPN live event competitor entries (`sports.core.api.espn.com/.../competitors/{id}/roster`)
  const compByKey = new Map();
  let compExplicitInactiveCount = 0;
  for (const entry of effectiveCompEntries) {
    const nm = entry?.displayName || entry?.fullName || entry?.name || '';
    const k = normalizeLookupName(nm);
    if (!k) continue;
    const isExplicitlyInactive =
      entry.active === false ||
      entry.isInactive === true ||
      (effectiveWindow.hasKickoffStarted && entry.didNotPlay === true && entry.starter !== true);
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
    const injuryType = injRow?.injuryType || player.injuryType || compRow?.reason || '';
    const combinedNote = `${injRow?.beatComment || injRow?.beatNote || ''} ${player.beatNote || ''}`;

    const isPreDeclaredOut =
      statusLower === 'out' ||
      statusLower === 'inactive' ||
      /\bruled out\b|\bwill not play\b/i.test(combinedNote);

    const isWireInactive = wireSignals.inactiveKeys.has(k);
    const isCompInactive = Boolean(compRow?.isExplicitlyInactive);
    const isWireActive = wireSignals.activeKeys.has(k);

    const isEmergencyGtd =
      wireSignals.gtdActiveKeys.has(k) ||
      /\b(available only in an emergency|active as emergency|emergency backup|remains a game-time decision|game-time decision.*active|active.*game-time decision)\b/i.test(
        combinedNote
      );

    if ((isCompInactive || isWireInactive || isPreDeclaredOut) && !isWireActive) {
      inactives.push({
        ...player,
        isActive: false,
        injuryType: injuryType || (isPreDeclaredOut ? 'Injury' : 'Healthy Scratch'),
        reason: injuryType || (isPreDeclaredOut ? 'Injury' : 'Healthy Scratch'),
        reasonLabel: injuryType ? `${injuryType} (Out)` : 'Healthy Scratch',
        isInjuryScratch: Boolean(injuryType || isPreDeclaredOut)
      });
    } else {
      if (!isOfficialListPosted && (statusLower === 'questionable' || statusLower === 'doubtful')) {
        pendingQuestionables.push({
          ...player,
          injuryType,
          gameStatus: rawStatus
        });
      }
      actives.push({
        ...player,
        isActive: true,
        injuryType,
        isEmergencyGtd,
        isExplicitActiveGtd: isEmergencyGtd
      });
    }
  }

  // Sort inactives: starters/injured scratches first, then by jersey/name
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
    statusBadgeLabel,
    statusLabel: statusBadgeLabel,
    inactives,
    activeCount: actives.length,
    totalActives: actives.length,
    activeByUnit,
    activesByUnit: activeByUnit,
    pendingQuestionables,
    inactiveKeySet,
    gtdKeySet
  };
}

/**
 * Resolves Questionable / Doubtful statuses to deterministic In (Active) or Out (Inactive)
 * once game-day inactives are declared (T-90m) through the conclusion of the game.
 */
export function resolveGameDayInjuryRows(rows = [], gameDayModel = null) {
  if (!Array.isArray(rows) || !gameDayModel?.isActive) {
    return rows;
  }

  const inactiveSet =
    gameDayModel.inactiveKeySet instanceof Set
      ? gameDayModel.inactiveKeySet
      : new Set((gameDayModel.inactives || []).map(p => normalizeLookupName(p?.name || '')));
  const gtdSet =
    gameDayModel.gtdKeySet instanceof Set
      ? gameDayModel.gtdKeySet
      : new Set(
          Object.values(gameDayModel.activeByUnit || {})
            .flat()
            .filter(p => p?.isEmergencyGtd)
            .map(p => normalizeLookupName(p?.name || ''))
        );

  // If official 90-min list is still delayed by a couple minutes before kickoff, only lock Out players
  const lockAllQuestionables = Boolean(gameDayModel.isOfficialListPosted || gameDayModel.hasKickoffStarted);

  return rows.map(row => {
    const k = normalizeLookupName(row?.name || '');
    const isInactive = inactiveSet.has(k);
    const origStatus = row?.preGameStatus || row?.gameStatus || '';
    const statusLower = String(origStatus).toLowerCase();

    if (isInactive || statusLower === 'out' || statusLower === 'inactive') {
      return {
        ...row,
        preGameStatus: origStatus,
        gameStatus: 'Inactive',
        playProbabilityPct: 0,
        tier: 'OUT',
        playTier: 'OUT',
        badgeLabel: '0% • Out (Inactive)',
        playBadgeLabel: '0% • Out (Inactive)'
      };
    }

    if (!lockAllQuestionables) {
      return row;
    }

    // Active on game day! Check rare explicit GTD / emergency active exception
    const isRareActiveGtd =
      gtdSet.has(k) ||
      /\b(available only in an emergency|active as emergency|emergency backup|remains a game-time decision|game-time decision.*active|active.*game-time decision)\b/i.test(
        String(row?.beatComment || row?.beatNote || row?.longComment || row?.shortComment || '')
      );

    if (isRareActiveGtd) {
      return {
        ...row,
        preGameStatus: origStatus,
        gameStatus: 'Active (GTD)',
        playProbabilityPct: 65,
        tier: 'QUESTIONABLE',
        playTier: 'QUESTIONABLE',
        badgeLabel: 'Active • GTD',
        playBadgeLabel: 'Active • GTD'
      };
    }

    return {
      ...row,
      preGameStatus: origStatus,
      gameStatus: 'Active',
      playProbabilityPct: 99,
      tier: 'ACTIVE',
      playTier: 'ACTIVE',
      badgeLabel: '99% • In (Active)',
      playBadgeLabel: '99% • In (Active)'
    };
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

  const preHydrated = is49ers
    ? appData?.health?.gameDayRoster
    : um?.opponentHealth?.gameDayRoster;

  if (preHydrated?.isActive) {
    return {
      ...preHydrated,
      windowInfo: preHydrated.windowInfo || preHydrated.windowState || win
    };
  }

  if (is49ers) {
    const active53 = (appData?.roster?.players || []).filter(
      p => !p.rosterBucket || p.rosterBucket === 'active'
    );
    return buildTeamGameDayRosterModel({
      teamAbbr: 'SF',
      teamName: 'San Francisco 49ers',
      activeRosterPlayers: active53,
      injuryReport: appData?.health?.practiceReport || [],
      newsItems: appData?.news?.rawStream || [],
      liveFeedData: appData?.liveGameDay?.sf || null,
      windowState: win
    });
  }

  const oppHealth = um?.opponentHealth || {};
  const oppPool =
    Array.isArray(oppHealth.activeRoster) && oppHealth.activeRoster.length > 0
      ? oppHealth.activeRoster
      : [...(oppHealth.keyStartersHealthy || []), ...(oppHealth.injuryReport || [])];

  return buildTeamGameDayRosterModel({
    teamAbbr: um?.oppAbbr || 'OPP',
    teamName: um?.oppName || um?.oppAbbr || 'Opponent',
    activeRosterPlayers: oppPool,
    injuryReport: oppHealth.injuryReport || [],
    newsItems: appData?.news?.rawStream || [],
    liveFeedData: appData?.liveGameDay?.opp || null,
    windowState: win
  });
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
  upcomingWeek = null
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

    const sanitizedCombinedForAcuteCheck = combined.replace(
      /\b(?:sustained|suffered)\s+back\s+in\s+week\s*\d+\b/gi,
      'prior injury'
    );
    const hasPostOrInGameInjury =
      /\b(sustained|suffered|injured (?:in|during)|left (?:sunday|monday|thursday|saturday|the)[a-z ']* (?:game|win|loss|contest)|exited (?:sunday|monday|thursday|saturday|the)|questionable to return|doubtful to return|did not return|will not return|didn'?t leave unscathed|after the game|following the (?:game|win|loss)|underwent an mri|scheduled for an mri|broken|fracture|torn|placed on injured reserve|ruled out for week)\b/i.test(
        sanitizedCombinedForAcuteCheck
      );
    const wasClearedPreGame =
      /\b(does not (?:have|carry) (?:an?y? )?(?:official )?(?:injury )?designation|doesn'?t (?:have|carry) (?:an?y? )?(?:official )?(?:injury )?designation|has no (?:official )?(?:injury )?designation|no official injury designation|off the injury report|designation now a thing of the past|return(?:ing)? to action|he'?ll return to action|set to get back on the field|all set to suit up|now set to go|appears to have done him well|gave him some extra recovery time|cleared (?:the league'?s )?concussion protocol)\b/i.test(
        combined
      );
    if (!hasPostOrInGameInjury && wasClearedPreGame) {
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

  const isMultiWeekAbsence =
    /\b(out (?:multiple|several|[2-9]|two|three|four) weeks|miss (?:multiple|several|[2-9]|two|three|four) weeks|expected to miss (?:at least )?(?:[2-9]|two|three|four|several|multiple) weeks|high-ankle sprain.*miss)\b/i.test(
      combined
    );

  let effectiveStatus = 'Questionable';
  if (explicitUpcomingWeekOut) {
    effectiveStatus = 'Out';
  } else if (isMultiWeekAbsence) {
    effectiveStatus = 'Doubtful';
  } else if (statusLower === 'doubtful') {
    effectiveStatus = 'Questionable';
  } else if (
    statusLower === 'out' ||
    statusLower === 'inactive' ||
    statusLower === 'questionable' ||
    statusLower === 'day-to-day' ||
    Boolean(injClean)
  ) {
    effectiveStatus = 'Questionable';
  }

  const missedPriorGame =
    statusLower === 'out' ||
    statusLower === 'inactive' ||
    /\b(is inactive|was inactive|officially inactive|ruled out|will not play|won't play|missing a (?:second|third|fourth) straight|will miss his (?:second|third|fourth) straight)\b/i.test(
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
    // Strip prior-game availability rulings so computePlayerPlayProbability models Week N+1 rather than clamping to 0%
    beatNoteForModel = beatNoteForModel
      .replace(
        /\b(is inactive|was inactive|officially inactive|ruled out|will not play|won't play|is out for|will miss (?:his |a )?[a-z0-9 -]*(?:game|contest|matchup|tilt|clash)|missing (?:a |his )?[a-z0-9 -]*(?:game|contest|matchup|tilt|clash)|miss(?:ing)? (?:sunday|monday|thursday|saturday)'?s?|inactive (?:sunday|monday|thursday|saturday)|inactive for (?:sunday|monday|thursday|saturday))\b/gi,
        'sidelined previously'
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

    const earlyRoll = resolveEarlyWeekRolloverInput({
      rawStatus: r?.gameStatus || '',
      injuryType: r?.injuryType || '',
      shortComment: r?.shortComment || '',
      longComment: r?.beatNote || r?.beatComment || r?.longComment || '',
      upcomingWeek
    });
    if (earlyRoll.skip) continue;

    // Drop players who were completely cleared with no active injury status from the completed week
    const hasOngoingDesignation =
      statusLower === 'out' ||
      statusLower === 'inactive' ||
      statusLower === 'doubtful' ||
      statusLower === 'questionable' ||
      statusLower === 'day-to-day' ||
      Boolean(r?.isIrReturnQuestionable) ||
      Boolean(r?.sustainedInLastGame);

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
      : statusLower === 'inactive'
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
      sustainedInLastGame: Boolean(r?.sustainedInLastGame),
      rosterBucket: r.isIrReturnQuestionable ? 'ir' : 'active',
      isIrReturnQuestionable: Boolean(r.isIrReturnQuestionable),
      injuryType: r.injuryType || '',
      wed,
      thu,
      fri,
      beatNote: clearPracticeDays ? earlyRoll.beatNoteForModel : r.beatNote || r.beatComment || ''
    });

    nextRows.push({
      ...r,
      wed,
      thu,
      fri,
      gameStatus: cleanStatus,
      playProbabilityPct: prob.probabilityPct,
      tier: prob.tier,
      badgeLabel: prob.badgeLabel,
      playBadgeLabel: prob.badgeLabel,
      factors: prob.factors
    });
  }

  return nextRows.sort((a, b) => a.playProbabilityPct - b.playProbabilityPct || (b.snapPct || 0) - (a.snapPct || 0));
}
