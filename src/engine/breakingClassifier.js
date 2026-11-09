/**
 * Breaking News, Live In-Game Priority, 48h Post-Game Injury Follow-Up,
 * Wire Deduplication & Single-Attribution Text Cleaner
 */

import {
  corroborateAndAnnotateWireStream,
  resolveReporterFromNameOrHandle
} from './beatAttributionEngine.js';

export const SHORT_TWEET_FULL_TEXT_LIMIT = 320;

const IN_GAME_INJURY_RETURN_REGEX =
  /\b(questionable to return|probable to return|doubtful to return|ruled out for the rest|out for the rest of the game|will not return|did not return|cleared to return|back in the game|returning to the game|returned to the game|headed to the locker room|going to the locker room|went to the locker room|blue medical tent|medical tent|evaluated for a concussion|concussion evaluation|carted off|limped off|limping off|helped off the field|helped off|walked off with trainers|with athletic trainers|examined by trainers|examined on the sideline|left the game|exited the game|left sunday'?s game|exited sunday'?s game|in-game injury|injury update)\b/i;

const POST_GAME_INJURY_FOLLOWUP_REGEX =
  /\b(suffered a|sustained a|exited (?:sunday|monday|thursday|saturday|the game)|left (?:sunday|monday|thursday|saturday|the game)|did not return|underwent an mri|scheduled for an mri|\bmri\b|\bx-rays?\b|ct scan|tests showed|initial tests|believed to have avoided|feared to have|day-to-day|week-to-week|high-ankle|sprain|strain|concussion protocol|torn acl|torn achilles|torn pectoral|meniscus|fracture|out multiple weeks|out several weeks|shanahan (?:said|noted|confirmed|announced)[\s\S]{0,65}\b(?:injury|ankle|knee|foot|back|shoulder|hamstring|calf|quad|groin|rib|wrist|hand|concussion|mri|day-to-day|week-to-week))\b/i;

const PRACTICE_WARMUP_INJURY_SCOOP_REGEX =
  /\b(not practicing|not seen at practice|working on a side field|rehab field|blue non-contact|non-contact jersey|walking boot|suffered a setback|aggravated his|underwent an mri|scheduled for an mri|high-ankle sprain|torn acl|torn achilles|torn pectoral|meniscus|21-day practice window|designated to return from|didn't activate|did not activate|game-time decision|full workload)\b/i;

const PRE_GAME_AVAILABILITY_NOISE_REGEX =
  /\b(inactives?\b|is inactive|are inactive|as inactive|officially inactive|declared inactive|officially active|active vs\.?|active against|expected to be active|will be active|won['’]?t play|will not play|not playing today|not playing tonight|ruled out|rule[sd]? out (?:one|two|three|four|five|\d+)|unlikely to play|likely to play|expected to play|could play|hopes to play|plans to play|set to play|good to go|cleared to play|cleared for week \d+|expected to take on a full workload|full workload|game-time decision|remains on injured reserve|didn['’]?t activate|did not activate|not activated from|doesn['’]?t have a (?:game |injury )?designation|does not carry an? (?:official )?(?:injury |game )?designation|no (?:injury |game )?designation|listed as (?:questionable|doubtful|out)|deemed (?:questionable|doubtful|out))\b/i;

const LEAD_PERMANENT_OR_POSTGAME_EXCLUSION_REGEX =
  /\b(arrested|taken into custody|charged with|indicted|suspended|commissioner['’]?s exempt|under (?:nfl |league |police |federal )?investigation|lawsuit|\btrade:|traded (?:to|for)|acquiring|re-acquiring|has been traded|agreed to terms|contract extension|signed a \d+-year|signs a \d+-year|restructured his contract|reinstat(?:e|ed|ement)|left squad|hires? [a-z .'-]+ as agent|eyes return to (?:the )?nfl|bonus (?:repayment|forfeiture)|placed on injured reserve|placed [a-z .'()-]+ on (?:injured reserve|ir)\b|put [a-z .'()-]+ on ir\b|lose [a-z .'()-]+ to (?:ir|season-ending)|49ers roster move:|signed [a-z .'()-]+ to (?:the )?(?:active roster|practice squad)|out for (?:the )?(?:rest of (?:the )?)?(?:\d{4} )?season|miss the (?:remainder|rest) of the (?:\d{4} )?season|season-ending|done for the season|season likely over|fractured|broken (?:ankle|leg|arm|foot|collarbone|wrist|hand)|torn (?:acl|achilles|pectoral|meniscus|patellar)|carted off|questionable to return|doubtful to return|ruled out for the rest|will not return|did not return|left (?:sunday|monday|thursday|saturday|the )['’]?s? game|exited (?:sunday|monday|thursday|saturday|the )['’]?s? game|suffered (?:a|an|injuries)\b|sustained (?:a|an)\b|\d+-\d+ (?:win|loss|victory)|beat(?:s)? (?:the )?[a-z]+|reaches career milestone|amid [a-z]+ game|notebook:|reacts? to (?:bounce-back )?win|react following)\b/i;

const PRE_GAME_PLAY_AVAILABILITY_REGEX =
  /\b(inactives?\b|officially inactive|declared inactive|is inactive|are inactive|as inactive|officially active|active vs\.?|active against|expected to be active|will be active|won['’]?t play|will not play|not playing today|not playing tonight|unlikely to play|likely to play|expected to play|could play|hopes to play|planning to play|plans to play|set to play|good to go|cleared to play|cleared for week \d+|prepared to return (?:sunday|monday|thursday|saturday|today|tonight)|to return in week \d+|welcoming back [a-z0-9 -]+ for [a-z0-9 .'-]+ game|ruled out|rule[sd]? out (?:one|two|three|four|five|\d+)|will miss (?:sunday|monday|thursday|saturday|today|tonight|week \d+)|won['’]?t be available (?:sunday|monday|thursday|saturday|today|tonight|in week \d+)|expect [a-z .'-]+ to be available (?:sunday|monday|thursday|saturday|today|tonight)|listed as (?:questionable|doubtful|out)|deemed (?:questionable|doubtful|out)|questionable (?:designation|game status|for (?:sunday|monday|thursday|saturday|today|tonight|week \d+))|doubtful for (?:sunday|monday|thursday|saturday|today|tonight|week \d+)|game-time decision|expected to take on a full workload|full workload (?:sunday|monday|thursday|saturday|today|tonight|against|vs)|doesn['’]?t have a (?:game |injury )?designation|does not carry an? (?:official )?(?:injury |game )?designation|carries no (?:game |injury )?designation|no (?:injury |game )?designation for|questionable (?:designation|game status)[\s\S]{0,25}removed|off the injury report|didn['’]?t activate|did not activate|not activated from|remains on injured reserve|(?:final )?(?:injury|availability|status) updates?\b[\s\S]{0,45}\b(?:before|ahead of|on\b)|final updates? ahead of (?:week \d+|sunday|monday|thursday|saturday)|makes?\s+(?:an?\s+)?(?:[a-z0-9 .'-]{0,40}\s+)?announcement\s+(?:on\s+[a-z0-9 .'-]{2,45}\s+)?(?:before|ahead of)\s+[a-z0-9 .'-]{2,25}\s+game|suffers? [a-z ]*injury ahead of [a-z0-9 .'-]+ game|limited (?:at|in) (?:wednesday|thursday|friday|today)['’]?s? practice|limited at practice today|practiced on a limited basis|didn['’]?t (?:participate in(?: [a-z]+['’]?s?)? practice|practice (?:wednesday|thursday|friday|today))|will not practice today|not going today but hopefully a chance tomorrow|returns? to full practice ahead of|eyes return[\s\S]{0,60}\b(?:could play|questionable|hamstring|ankle|knee|injury|sunday|week \d+))\b/i;

const CLUSTER_PLAY_AVAILABILITY_HEADLINE_REGEX =
  /\b(cleared for week \d+|cleared to play|inactives?\b|who plays|likely to play|unlikely to play|won['’]?t play|will not play|ruled out|expected to play|game-time decision|play likelihood|play probability|practice & availability|availability report|injury designations|availability outlook|active vs\.?|inactive vs\.?)\b/i;

const CLUSTER_NON_AVAILABILITY_EXCLUSION_REGEX =
  /\b(salary cap|cba rollover|front office ledger|trade window|pass-rush geometry|cpoe|out for (?:the )?season|season-ending)\b/i;

function extractFirstLeadSentence(text = '') {
  const s = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  const m = s.match(/^[\s\S]{10,230}?[.!?](?=\s+[A-Z"“]|$)/);
  return m ? m[0] : s.slice(0, 230);
}

function extractTeamNickname(teamName = '') {
  const clean = String(teamName || '').trim();
  if (!clean) return '';
  const parts = clean.split(/\s+/);
  return parts[parts.length - 1] || '';
}

function escapeRegexToken(s = '') {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns true if `item` (article, tweet, video, or sourceLink) is primarily about
 * single-game pre-kickoff player availability / who is likely to play / won't play /
 * game-day active or inactive status / weekly practice participation, rather than a
 * permanent roster move, post-game injury diagnosis, trade, or game recap.
 */
export function isPreGamePlayAvailabilityItem(item = {}) {
  if (!item || typeof item !== 'object') return false;
  const isTw = item.type === 'tweet' || item.type === 'social';
  const rawLead = isTw
    ? extractFirstLeadSentence(item.fullText || item.title || item.headline || '')
    : String(item.title || item.headline || '').trim();
  if (!rawLead) return false;

  if (LEAD_PERMANENT_OR_POSTGAME_EXCLUSION_REGEX.test(rawLead)) {
    return false;
  }

  const summaryLead =
    item.type === 'video' ? '' : extractFirstLeadSentence(item.summary || item.externalTitle || '');
  const combinedCheck = `${rawLead} ${item.title || item.headline || ''} ${summaryLead}`.trim();
  return PRE_GAME_PLAY_AVAILABILITY_REGEX.test(combinedCheck);
}

const SPECULATIVE_OR_RETROSPECTIVE_EXCLUSION_REGEX =
  /\b(mock trade|trade proposal|trade idea|trade pitch|hypothetical|what if|flashback|on this day|\d+\s+years ago|way-too-early|mailbag|merch|promo code)\b/i;

const NON_TRANSACTION_RELEASE_REGEX =
  /\breleased\s+(?:a\s+|an\s+|their\s+|the\s+|its\s+|his\s+|her\s+|new\s+|official\s+|week\s+\d+\s+)?(?:statement|video|hype video|trailer|podcast|episode|schedule|depth chart|uniform|uniforms|jersey|renderings|report|rankings|grades|mock|list|photos|highlights|mic'd up)\b/i;

const BREAKING_ROSTER_OR_STATUS_REGEX =
  /(\bbreaking\b|just in:|per source|per sources|\btrade:|traded to|acquiring|re-acquiring|has been traded|seeking reinstatement|reinstated|activated from ir|activated off ir|activated from injured reserve|placed on injured reserve|placed on ir|game status report|officially active|officially inactive|ruled out|unlikely to play|expected to play|good to go|signed to the active roster|signed to the practice squad|elevated from the practice squad|standard elevation|\bwaived\b|has been released|have released|officially released|released from (?:ir|injured reserve|the practice squad)|\breleased\s+(?:veteran\s+|rookie\s+)?(?:qb|rb|fb|wr|te|ol|ot|og|c|dl|de|dt|nt|edge|lb|ilb|olb|cb|db|s|k|p|ls)\b)/i;

const MAJOR_NON_INJURY_BREAKING_REGEX =
  /\b(arrested|taken into custody|charged with|indicted|arraigned|felony|misdemeanor|\bdui\b|\bdwi\b|suspended (?:by the nfl|without pay|\d+\s+games?)|commissioner'?s exempt|under (?:nfl |league |police |federal )?investigation|lawsuit|sued\b|\btrade:|traded (?:to|for)|acquiring|re-acquiring|has been traded|finalizing a trade|agreed to a trade|agreed to terms|contract extension|signed a \d+-year|signs a \d+-year|restructured his contract|fired|relieved of (?:his|their) duties|parted ways with|stepping down|announced his retirement)\b/i;

const CREDIBLE_TRADE_RUMOR_REGEX =
  /\b(trade talks|trade discussions|in talks to acquire|discussing a trade|fielding calls|making calls|calling teams|exploring a trade|shopping\b|expected to pursue|trade interest in|trade target|trade rumor|trade market for|gauging the (?:trade )?market|in the mix for)\b/i;

const SALIENT_INTERVIEW_OR_FEATURE_REGEX =
  /\b(1-on-1|one-on-one|sit-down|exclusive interview|locker room|opened up about|spoke candidly|reflects on|mic'?d up|joined knbr|players'? tribune|explained (?:why|how)|shared a (?:hilarious|story|moment)|candid interview)\b/i;

function decayPriority(base, ageHours, halfLifeHours = 10) {
  if (!Number.isFinite(ageHours) || ageHours <= 0) return Number(base.toFixed(3));
  return Number((base * Math.pow(0.5, ageHours / halfLifeHours)).toFixed(3));
}

/**
 * Resolves live in-game vs. 48-hour post-game & completed-games context from schedule & matchup telemetry.
 */
export function resolveGameNewsContext(appData = null, nowMs = Date.now()) {
  if (!appData || typeof appData !== 'object') {
    return {
      inGame: false,
      postGame48h: false,
      activeKickoffMs: null,
      activeWeek: null,
      activeOppAbbr: '',
      activeOppNickname: '',
      completedKickoffMs: null,
      completedEndMs: null,
      latestCompletedWeek: null,
      latestCompletedKickoffMs: null,
      latestCompletedEndMs: null,
      latestCompletedOppAbbr: '',
      latestCompletedOppNickname: '',
      completedWeeks: [],
      upcomingWeek: null,
      upcomingOppAbbr: '',
      upcomingOppNickname: ''
    };
  }

  const ts = Number.isFinite(nowMs) ? nowMs : Date.now();
  const schedule = appData?.scheduleMatchup?.schedule || [];
  const upcoming = appData?.scheduleMatchup?.upcomingMatchup || {};

  const completedWeeks = [];
  let latestCompleted = null;
  let latestKoMs = -Infinity;
  for (const g of schedule) {
    if (!g || !g.completed) continue;
    const wkNum = Number(g.week);
    if (Number.isFinite(wkNum) && wkNum > 0 && !completedWeeks.includes(wkNum)) {
      completedWeeks.push(wkNum);
    }
    const koMs = Date.parse(g.dateIso || '');
    if (Number.isFinite(koMs) && koMs > latestKoMs && koMs <= ts + 6 * 3600_000) {
      latestKoMs = koMs;
      latestCompleted = g;
    } else if (!latestCompleted && !Number.isFinite(koMs)) {
      latestCompleted = g;
    }
  }
  completedWeeks.sort((a, b) => a - b);

  const nextSchedGame = schedule.find(g => g && !g.completed) || null;
  const upcomingWeek =
    Number(upcoming.week) ||
    Number(nextSchedGame?.week) ||
    Number(appData?.meta?.currentWeek) ||
    null;
  const upcomingOppAbbr = String(upcoming.oppAbbr || nextSchedGame?.opponent?.abbr || '').toUpperCase();
  const upcomingOppNickname = extractTeamNickname(upcoming.oppName || nextSchedGame?.opponent?.name || '');

  const latestCompletedWeek = latestCompleted ? Number(latestCompleted.week) || null : null;
  const latestCompletedKickoffMs = Number.isFinite(latestKoMs) ? latestKoMs : null;
  const latestCompletedEndMs =
    latestCompletedKickoffMs !== null ? Math.min(ts, latestCompletedKickoffMs + 3.25 * 3600_000) : null;
  const latestCompletedOppAbbr = String(latestCompleted?.opponent?.abbr || '').toUpperCase();
  const latestCompletedOppNickname = extractTeamNickname(latestCompleted?.opponent?.name || '');

  const sharedCompletedMeta = {
    latestCompletedWeek,
    latestCompletedKickoffMs,
    latestCompletedEndMs,
    latestCompletedOppAbbr,
    latestCompletedOppNickname,
    completedWeeks,
    upcomingWeek,
    upcomingOppAbbr,
    upcomingOppNickname
  };

  // 1. Check if a 49ers game is currently in progress (from kickoff until completion)
  for (const g of schedule) {
    if (!g || g.completed) continue;
    const koMs = Date.parse(g.dateIso || '');
    const statusLower = String(g.statusDetail || '').toLowerCase();
    const statusIndicatesLive = /\b(q1|q2|q3|q4|1st|2nd|3rd|4th|halftime|in progress|ot|overtime)\b/.test(statusLower);
    if (
      statusIndicatesLive ||
      (Number.isFinite(koMs) && ts >= koMs && ts <= koMs + 4.75 * 3600_000)
    ) {
      return {
        inGame: true,
        postGame48h: false,
        activeKickoffMs: Number.isFinite(koMs) ? koMs : ts - 30 * 60_000,
        activeWeek: Number(g.week) || upcomingWeek,
        activeOppAbbr: String(g.opponent?.abbr || upcomingOppAbbr).toUpperCase(),
        activeOppNickname: extractTeamNickname(g.opponent?.name || '') || upcomingOppNickname,
        completedKickoffMs: null,
        completedEndMs: null,
        ...sharedCompletedMeta
      };
    }
  }

  if (upcoming.liveState === 'in' || upcoming.isGameInProgress) {
    const upKoMs = Date.parse(upcoming.dateIso || upcoming.kickoffIso || '');
    return {
      inGame: true,
      postGame48h: false,
      activeKickoffMs: Number.isFinite(upKoMs) ? upKoMs : ts - 30 * 60_000,
      activeWeek: upcomingWeek,
      activeOppAbbr: upcomingOppAbbr,
      activeOppNickname: upcomingOppNickname,
      completedKickoffMs: null,
      completedEndMs: null,
      ...sharedCompletedMeta
    };
  }

  // 2. Check if a 49ers game completed within the last 48 hours
  if (latestCompleted && Number.isFinite(latestKoMs)) {
    const estEndMs = latestKoMs + 3.25 * 3600_000;
    const sinceEndMs = ts - estEndMs;
    if (ts >= latestKoMs + 2 * 3600_000 && sinceEndMs <= 48 * 3600_000) {
      return {
        inGame: false,
        postGame48h: true,
        activeKickoffMs: null,
        activeWeek: null,
        activeOppAbbr: '',
        activeOppNickname: '',
        completedKickoffMs: latestKoMs,
        completedEndMs: Math.min(ts, estEndMs),
        ...sharedCompletedMeta
      };
    }
  }

  return {
    inGame: false,
    postGame48h: false,
    activeKickoffMs: null,
    activeWeek: null,
    activeOppAbbr: '',
    activeOppNickname: '',
    completedKickoffMs: null,
    completedEndMs: null,
    ...sharedCompletedMeta
  };
}

/**
 * Classifies a tweet or news item for breaking / live in-game / 48h post-game injury priority.
 */
export function classifyBreakingItem(item = {}, nowMs = Date.now(), gameContext = null) {
  const ctx =
    gameContext && typeof gameContext === 'object' && gameContext.appData
      ? resolveGameNewsContext(gameContext.appData, nowMs)
      : gameContext;
  const combined = `${item.title || item.headline || ''} ${item.fullText || ''} ${item.summary || ''}`.trim();
  const pubMs = item.publishedAt ? new Date(item.publishedAt).getTime() : NaN;
  const ageHours = Number.isFinite(pubMs) ? Math.max(0, (nowMs - pubMs) / 3_600_000) : 999;

  const isSpeculative = SPECULATIVE_OR_RETROSPECTIVE_EXCLUSION_REGEX.test(combined);
  const matchesInGame = !isSpeculative && IN_GAME_INJURY_RETURN_REGEX.test(combined);
  const matchesPostGameInjury = !isSpeculative && POST_GAME_INJURY_FOLLOWUP_REGEX.test(combined);
  const matchesPracticeInjuryScoop = !isSpeculative && PRACTICE_WARMUP_INJURY_SCOOP_REGEX.test(combined);
  const matchesPreGameAvailabilityNoise =
    PRE_GAME_AVAILABILITY_NOISE_REGEX.test(combined) || isPreGamePlayAvailabilityItem(item);
  const matchesMajorNonInjury =
    !isSpeculative && !NON_TRANSACTION_RELEASE_REGEX.test(combined) && MAJOR_NON_INJURY_BREAKING_REGEX.test(combined);
  const matchesCredibleTradeRumor = !isSpeculative && CREDIBLE_TRADE_RUMOR_REGEX.test(combined);
  const matchesSalientInterview = !isSpeculative && SALIENT_INTERVIEW_OR_FEATURE_REGEX.test(combined);
  const matchesBreaking =
    !isSpeculative &&
    !NON_TRANSACTION_RELEASE_REGEX.test(combined) &&
    BREAKING_ROSTER_OR_STATUS_REGEX.test(combined);

  const repEntry = resolveReporterFromNameOrHandle(
    item.reporterId || item.author || item.reporterName || item.authorHandle
  );
  const effectiveTrustTier = Number(item.trustTier) || repEntry?.trustTier || 2;

  // 1. LIVE IN-GAME MODE: Prioritize in-game tweets & especially in-game injuries; sink pre-game inactives/availability to bottom
  if (ctx?.inGame && Number.isFinite(ctx.activeKickoffMs)) {
    const koMs = ctx.activeKickoffMs;
    const isDuringGame = Number.isFinite(pubMs) && pubMs >= koMs - 5 * 60_000;

    if (matchesMajorNonInjury && ageHours <= 6) {
      return {
        isBreaking: true,
        isInGameInjury: false,
        breakingPriority: decayPriority(2.9, ageHours, 8),
        breakingBadge: 'BREAKING',
        ageHours
      };
    }

    if (matchesPreGameAvailabilityNoise && !matchesInGame) {
      return {
        isBreaking: false,
        isInGameInjury: false,
        isStalePreGameAvailability: true,
        breakingPriority: -5.0,
        breakingBadge: null,
        ageHours
      };
    }

    if (!isDuringGame) {
      return {
        isBreaking: false,
        isInGameInjury: false,
        breakingPriority: 0,
        breakingBadge: null,
        ageHours
      };
    }

    if (matchesInGame || matchesPostGameInjury) {
      return {
        isBreaking: true,
        isInGameInjury: true,
        breakingPriority: 3.0,
        breakingBadge: 'LIVE INJURY UPDATE',
        ageHours
      };
    }

    if (matchesCredibleTradeRumor && effectiveTrustTier <= 2) {
      return {
        isBreaking: true,
        isInGameInjury: false,
        breakingPriority: 2.15,
        breakingBadge: 'TRADE INTEL',
        ageHours
      };
    }

    if ((item.type === 'tweet' || item.type === 'social') && !isSpeculative) {
      return {
        isBreaking: true,
        isInGameInjury: false,
        breakingPriority: 2.1,
        breakingBadge: 'LIVE IN-GAME',
        ageHours
      };
    }
  }

  // Demote any pre-game availability item from a completed game regardless of post-game hour window
  const completedKoRef = ctx?.completedKickoffMs ?? ctx?.latestCompletedKickoffMs ?? null;
  if (!ctx?.inGame && Number.isFinite(completedKoRef) && Number.isFinite(pubMs) && pubMs < completedKoRef + 20 * 60_000) {
    if (matchesPreGameAvailabilityNoise && !LEAD_PERMANENT_OR_POSTGAME_EXCLUSION_REGEX.test(extractFirstLeadSentence(item.fullText || item.title || item.headline || ''))) {
      return {
        isBreaking: false,
        isInGameInjury: false,
        isStalePreGameAvailability: true,
        breakingPriority: -10.0,
        breakingBadge: null,
        ageHours
      };
    }
  }

  // 2. 48-HOUR POST-GAME MODE: Prioritize meaningful updates on in-game injuries with smooth recency decay
  //    so major breaking news (arrests, trades, extensions), credible trade rumors, and salient interviews are NEVER crowded out
  if (ctx?.postGame48h && Number.isFinite(ctx.completedKickoffMs)) {
    const koMs = ctx.completedKickoffMs;
    const isPreFinishedGame = Number.isFinite(pubMs) && pubMs < koMs;

    if (matchesMajorNonInjury && ageHours <= 36) {
      return {
        isBreaking: true,
        isInGameInjury: false,
        breakingPriority: decayPriority(2.9, ageHours, 12),
        breakingBadge: 'BREAKING',
        ageHours
      };
    }

    if (!isPreFinishedGame && ageHours <= 48 && (matchesInGame || matchesPostGameInjury)) {
      if (matchesInGame && ageHours <= 4) {
        return {
          isBreaking: true,
          isInGameInjury: true,
          isPostGameInjuryUpdate: true,
          breakingPriority: 3.0,
          breakingBadge: 'LIVE INJURY UPDATE',
          ageHours
        };
      }
      const hasNewDiagnosticDetail = /\b(mri|x-ray|ct scan|day-to-day|week-to-week|high-ankle|sprain|strain|placed on ir|shanahan)\b/i.test(
        combined
      );
      const basePrio = hasNewDiagnosticDetail ? 2.55 : 2.25;
      return {
        isBreaking: true,
        isInGameInjury: ageHours <= 6,
        isPostGameInjuryUpdate: true,
        breakingPriority: decayPriority(basePrio, ageHours, 10),
        breakingBadge: 'INJURY UPDATE',
        ageHours
      };
    }

    if (matchesCredibleTradeRumor && ageHours <= 24 && effectiveTrustTier <= 2) {
      return {
        isBreaking: true,
        isInGameInjury: false,
        breakingPriority: decayPriority(2.35, ageHours, 10),
        breakingBadge: 'TRADE INTEL',
        ageHours
      };
    }

    if (matchesSalientInterview && ageHours <= 18) {
      return {
        isBreaking: false,
        isInGameInjury: false,
        breakingPriority: decayPriority(0.95, ageHours, 9),
        breakingBadge: null,
        ageHours
      };
    }
  }

  // 3. STANDARD / ALL-WEEK BREAKING & SALIENT CLASSIFICATION
  if (matchesMajorNonInjury && ageHours <= 24) {
    return {
      isBreaking: true,
      isInGameInjury: false,
      breakingPriority: decayPriority(2.85, ageHours, 12),
      breakingBadge: 'BREAKING',
      ageHours
    };
  }

  if (matchesInGame && ageHours <= 18) {
    return {
      isBreaking: true,
      isInGameInjury: ageHours <= 8,
      breakingPriority: ageHours <= 8 ? decayPriority(2.7, ageHours, 8) : decayPriority(1.6, ageHours, 10),
      breakingBadge: ageHours <= 8 ? 'LIVE INJURY UPDATE' : 'INJURY UPDATE',
      ageHours
    };
  }

  if (matchesCredibleTradeRumor && ageHours <= 24 && effectiveTrustTier <= 2) {
    return {
      isBreaking: true,
      isInGameInjury: false,
      breakingPriority: decayPriority(2.25, ageHours, 10),
      breakingBadge: 'TRADE INTEL',
      ageHours
    };
  }

  if (matchesPracticeInjuryScoop && ageHours <= 14) {
    return {
      isBreaking: true,
      isInGameInjury: false,
      breakingPriority: decayPriority(item.isFirstMoverInjuryScoop && ageHours <= 6 ? 2.15 : 1.85, ageHours, 8),
      breakingBadge: item.isFirstMoverInjuryScoop && ageHours <= 6 ? 'INJURY SCOOP' : 'INJURY UPDATE',
      ageHours
    };
  }

  if (matchesBreaking && ageHours <= 24) {
    return {
      isBreaking: true,
      isInGameInjury: false,
      breakingPriority: decayPriority(1.75, ageHours, 10),
      breakingBadge: 'BREAKING',
      ageHours
    };
  }

  if (matchesSalientInterview && ageHours <= 18) {
    return {
      isBreaking: false,
      isInGameInjury: false,
      breakingPriority: decayPriority(0.85, ageHours, 9),
      breakingBadge: null,
      ageHours
    };
  }

  if (item.isBreaking && !isSpeculative && ageHours <= 24 && !ctx?.inGame) {
    return {
      isBreaking: true,
      isInGameInjury: Boolean(item.isInGameInjury),
      breakingPriority: item.isInGameInjury ? decayPriority(2.2, ageHours, 8) : decayPriority(1.3, ageHours, 10),
      breakingBadge: item.breakingBadge || (item.isInGameInjury ? 'LIVE INJURY UPDATE' : 'BREAKING'),
      ageHours
    };
  }

  return {
    isBreaking: false,
    isInGameInjury: false,
    breakingPriority: 0,
    breakingBadge: null,
    ageHours
  };
}

function resolveEffectivePublishTimestampMs(item = {}, nowMs = Date.now()) {
  let effMs = item?.publishedAt ? Date.parse(item.publishedAt) : NaN;
  if (item?.type === 'video' && item?.summary) {
    const dayMatch = String(item.summary).match(/\b(\d+)\s*d(?:ays?)?\s+ago\b/i);
    const hrMatch = String(item.summary).match(/\b(\d+)\s*h(?:ours?|rs?)?\s+ago\b/i);
    if (dayMatch) {
      const est = nowMs - Number(dayMatch[1]) * 86_400_000;
      effMs = Number.isFinite(effMs) ? Math.min(effMs, est) : est;
    } else if (hrMatch) {
      const est = nowMs - Number(hrMatch[1]) * 3_600_000;
      effMs = Number.isFinite(effMs) ? Math.min(effMs, est) : est;
    }
  }
  return effMs;
}

function extractReferencedWeekNumbers(text = '') {
  const weeks = [];
  for (const m of String(text || '').matchAll(/\b(?:week|wk)\s*(\d{1,2})\b/gi)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 22 && !weeks.includes(n)) {
      weeks.push(n);
    }
  }
  return weeks;
}

/**
 * Returns true when `item` is a pre-game player availability / likely-to-play / active-inactive /
 * practice-status item for a game that has ALREADY completed (and should therefore be hidden).
 */
export function isStaleCompletedGameAvailabilityItem(item = {}, appData = null, nowMs = Date.now()) {
  if (!item || !appData || typeof appData !== 'object') return false;
  const ctx = resolveGameNewsContext(appData, nowMs);
  if (!ctx.completedWeeks || ctx.completedWeeks.length === 0) return false;
  if (!isPreGamePlayAvailabilityItem(item)) return false;

  const completedSet = new Set(ctx.completedWeeks);
  const upcomingWk = ctx.upcomingWeek && !completedSet.has(ctx.upcomingWeek) ? ctx.upcomingWeek : null;
  const upcomingNick = ctx.upcomingOppNickname || '';
  const latestCompKoMs = ctx.latestCompletedKickoffMs;
  const latestCompEndMs = ctx.latestCompletedEndMs;
  const latestCompNick = ctx.latestCompletedOppNickname || '';

  const leadText =
    item.type === 'tweet' || item.type === 'social'
      ? extractFirstLeadSentence(item.fullText || item.title || item.headline || '')
      : String(item.title || item.headline || '');
  const checkText = `${leadText} ${item.title || item.headline || ''}`.trim();
  const refWeeks = extractReferencedWeekNumbers(checkText);
  const mentionsCompletedWeek = refWeeks.some(w => completedSet.has(w));
  const mentionsUpcomingWeek = upcomingWk !== null && refWeeks.includes(upcomingWk);
  const mentionsUpcomingOpp =
    Boolean(upcomingNick) &&
    new RegExp(`\\b${escapeRegexToken(upcomingNick)}\\b`, 'i').test(checkText);
  const mentionsCompletedOppPreGame =
    Boolean(latestCompNick) &&
    ctx.latestCompletedOppAbbr !== ctx.upcomingOppAbbr &&
    new RegExp(
      `\\b(?:before|ahead of|vs\\.?|versus|against)\\s+(?:the\\s+)?(?:[a-z]+\\s+)?${escapeRegexToken(latestCompNick)}\\b`,
      'i'
    ).test(checkText);

  const effPubMs = resolveEffectivePublishTimestampMs(item, nowMs);

  // 1. Explicit completed week reference (e.g. "Mike Evans won't play Week 9", "Inactives Week 9") without targeting the upcoming week
  if (mentionsCompletedWeek && !mentionsUpcomingWeek) {
    return true;
  }

  // 2. Explicit pre-game framing for the just-completed opponent (e.g. "Before Raiders Game", "Active vs. Raiders")
  if (mentionsCompletedOppPreGame && !mentionsUpcomingWeek && !mentionsUpcomingOpp) {
    return true;
  }

  // 3. Published prior to kickoff of a completed game
  if (Number.isFinite(latestCompKoMs) && Number.isFinite(effPubMs) && effPubMs < latestCompKoMs + 20 * 60_000) {
    // Allow rare future-only lookahead items that never mention Sunday/today/practice or the completed game
    const exclusivelyFutureWeek =
      mentionsUpcomingWeek &&
      !mentionsCompletedWeek &&
      !mentionsCompletedOppPreGame &&
      !/\b(sunday|monday|thursday|saturday|today|tonight|this week|inactives?|practice)\b/i.test(leadText);
    if (!exclusivelyFutureWeek) {
      return true;
    }
  }

  // 4. Post-game guard: items published AFTER the completed game ended about the upcoming week/opponent stay visible
  if (Number.isFinite(latestCompEndMs) && Number.isFinite(effPubMs) && effPubMs >= latestCompEndMs) {
    return false;
  }

  return false;
}

/**
 * Filters out pre-game player availability / likely-to-play / inactive news items
 * pertaining to any game that has already completed.
 */
export function filterOutCompletedGameAvailabilityItems(items = [], appData = null, nowMs = Date.now()) {
  if (!Array.isArray(items) || items.length === 0 || !appData) return items;
  const ctx = resolveGameNewsContext(appData, nowMs);
  if (!ctx.completedWeeks || ctx.completedWeeks.length === 0) return items;

  return items
    .filter(it => !isStaleCompletedGameAvailabilityItem(it, appData, nowMs))
    .map(it => {
      if (Array.isArray(it?.confirmingReports) && it.confirmingReports.length > 0) {
        return {
          ...it,
          confirmingReports: it.confirmingReports.filter(
            cr => !isStaleCompletedGameAvailabilityItem(cr, appData, nowMs)
          )
        };
      }
      return it;
    });
}

/**
 * Returns true if an AI-synthesized brief (`clusteredBriefs`) or AI analysis (`allAnalyses`)
 * is about pre-game player availability / who is likely to play for a game that has completed.
 */
export function isCompletedGameAvailabilityCluster(cluster = {}, appData = null, nowMs = Date.now()) {
  if (!cluster || typeof cluster !== 'object' || !appData) return false;
  const ctx = resolveGameNewsContext(appData, nowMs);
  if (!ctx.completedWeeks || ctx.completedWeeks.length === 0) return false;

  const headline = String(cluster.headline || cluster.title || '').trim();
  const catLabel = String(cluster.categoryLabel || cluster.category || '').trim();
  const headerCombined = `${headline} ${catLabel}`.trim();

  if (!headerCombined || CLUSTER_NON_AVAILABILITY_EXCLUSION_REGEX.test(headerCombined)) {
    return false;
  }
  if (!CLUSTER_PLAY_AVAILABILITY_HEADLINE_REGEX.test(headerCombined)) {
    return false;
  }

  const completedSet = new Set(ctx.completedWeeks);
  const upcomingWk = ctx.upcomingWeek && !completedSet.has(ctx.upcomingWeek) ? ctx.upcomingWeek : null;
  const idAndHeader = `${cluster.id || ''} ${headerCombined}`;
  const refWeeks = extractReferencedWeekNumbers(idAndHeader);
  for (const idMatch of String(cluster.id || '').matchAll(/(?:_|^)(?:wk|week)(\d{1,2})\b/gi)) {
    const wn = Number(idMatch[1]);
    if (Number.isFinite(wn) && !refWeeks.includes(wn)) refWeeks.push(wn);
  }

  const mentionsCompletedWeek = refWeeks.some(w => completedSet.has(w));
  const mentionsUpcomingWeek = upcomingWk !== null && refWeeks.includes(upcomingWk);

  if (mentionsCompletedWeek && !mentionsUpcomingWeek) {
    return true;
  }

  const upcomingNick = ctx.upcomingOppNickname || '';
  const latestCompNick = ctx.latestCompletedOppNickname || '';
  const mentionsUpcomingOpp =
    Boolean(upcomingNick) &&
    new RegExp(`\\b${escapeRegexToken(upcomingNick)}\\b`, 'i').test(headline);
  const mentionsCompletedOpp =
    Boolean(latestCompNick) &&
    ctx.latestCompletedOppAbbr !== ctx.upcomingOppAbbr &&
    new RegExp(`\\b${escapeRegexToken(latestCompNick)}\\b`, 'i').test(headline);

  if (mentionsCompletedOpp && !mentionsUpcomingWeek && !mentionsUpcomingOpp) {
    return true;
  }

  const pubIso = cluster.publishedAt || cluster.createdAt || '';
  const pubMs = pubIso ? Date.parse(pubIso) : NaN;
  if (
    !mentionsUpcomingWeek &&
    !mentionsUpcomingOpp &&
    Number.isFinite(ctx.latestCompletedKickoffMs) &&
    Number.isFinite(pubMs) &&
    pubMs < ctx.latestCompletedKickoffMs + 20 * 60_000
  ) {
    return true;
  }

  return false;
}

/**
 * Returns true during an active in-progress game (`inGame`) if an AI-synthesized brief or
 * analysis is focused on pre-game availability / play likelihood for the game already underway,
 * allowing views to sink it to the bottom of the list once kickoff starts.
 */
export function isActiveInGameAvailabilityCluster(cluster = {}, appData = null, nowMs = Date.now()) {
  if (!cluster || typeof cluster !== 'object' || !appData) return false;
  const ctx = resolveGameNewsContext(appData, nowMs);
  if (!ctx.inGame) return false;

  const headline = String(cluster.headline || cluster.title || '').trim();
  const catLabel = String(cluster.categoryLabel || cluster.category || '').trim();
  const headerCombined = `${headline} ${catLabel}`.trim();
  if (!headerCombined || CLUSTER_NON_AVAILABILITY_EXCLUSION_REGEX.test(headerCombined)) {
    return false;
  }
  if (!CLUSTER_PLAY_AVAILABILITY_HEADLINE_REGEX.test(headerCombined)) {
    return false;
  }

  const idAndHeader = `${cluster.id || ''} ${headerCombined}`;
  const refWeeks = extractReferencedWeekNumbers(idAndHeader);
  for (const idMatch of String(cluster.id || '').matchAll(/(?:_|^)(?:wk|week)(\d{1,2})\b/gi)) {
    const wn = Number(idMatch[1]);
    if (Number.isFinite(wn) && !refWeeks.includes(wn)) refWeeks.push(wn);
  }
  if (ctx.activeWeek && refWeeks.length > 0) {
    return refWeeks.includes(ctx.activeWeek);
  }
  return true;
}

/**
 * Hides AI synthesis briefs about pre-game player availability for completed games,
 * scrubs completed-game pre-game availability sourceLinks & inactives hero images from
 * remaining briefs, and demotes pre-game availability briefs to the bottom during live games.
 */
export function filterAndCleanSynthesisClusters(clusters = [], appData = null, nowMs = Date.now()) {
  if (!Array.isArray(clusters) || clusters.length === 0 || !appData) return clusters;
  const ctx = resolveGameNewsContext(appData, nowMs);

  let cleaned = clusters
    .filter(c => !isCompletedGameAvailabilityCluster(c, appData, nowMs))
    .map(c => {
      let nextLinks = Array.isArray(c.sourceLinks) ? c.sourceLinks : null;
      if (nextLinks && ctx.completedWeeks?.length > 0) {
        const filteredLinks = nextLinks.filter(
          sl =>
            !isStaleCompletedGameAvailabilityItem(
              {
                type: sl?.type || 'article',
                title: sl?.title || '',
                fullText: sl?.title || '',
                url: sl?.url || '',
                publishedAt: sl?.publishedAt || null
              },
              appData,
              nowMs
            )
        );
        if (filteredLinks.length > 0) {
          nextLinks = filteredLinks;
        }
      }

      let heroPatch = null;
      if (
        ctx.completedWeeks?.length > 0 &&
        (c.heroImageAlt || c.heroImageLink) &&
        isStaleCompletedGameAvailabilityItem(
          {
            type: 'article',
            title: c.heroImageAlt || '',
            url: c.heroImageLink || '',
            publishedAt: c.publishedAt || null
          },
          appData,
          nowMs
        )
      ) {
        heroPatch = c.videoClip?.videoId
          ? {
              heroImageUrl: `https://i.ytimg.com/vi/${c.videoClip.videoId}/hqdefault.jpg`,
              heroImageAlt: c.videoClip.title || c.headline,
              heroImageSource: c.videoClip.channel || 'YouTube HD Frame',
              heroImageLink: `https://www.youtube.com/watch?v=${c.videoClip.videoId}`,
              heroImageIsEditorial: false
            }
          : {
              heroImageUrl: '',
              heroImageAlt: '',
              heroImageSource: '',
              heroImageLink: '',
              heroImageIsEditorial: false
            };
      }

      if (nextLinks === c.sourceLinks && !heroPatch) return c;
      return {
        ...c,
        ...(nextLinks ? { sourceLinks: nextLinks, synthesizedFromCount: nextLinks.length } : {}),
        ...(heroPatch || {})
      };
    });

  if (ctx.inGame && cleaned.length > 1) {
    const normal = [];
    const demoted = [];
    for (const c of cleaned) {
      if (isActiveInGameAvailabilityCluster(c, appData, nowMs)) {
        demoted.push(c);
      } else {
        normal.push(c);
      }
    }
    cleaned = [...normal, ...demoted];
  }

  return cleaned;
}

/**
 * Sorts tweets/articles with live in-game & 48h post-game injury awareness.
 */
export function sortNewsWithBreakingPriority(
  items = [],
  nowMs = Date.now(),
  { activeWindowHours = 18, gameContext = null, appData = null } = {}
) {
  const ctx = gameContext || (appData ? resolveGameNewsContext(appData, nowMs) : null);
  const effectiveWindowHours = ctx?.postGame48h ? Math.max(48, activeWindowHours) : activeWindowHours;
  const corroborated = corroborateAndAnnotateWireStream(items, nowMs);

  return corroborated
    .map(it => {
      const cls = classifyBreakingItem(it, nowMs, ctx);
      const repEntry = resolveReporterFromNameOrHandle(it.reporterId || it.author || it.reporterName || it.authorHandle);
      const trustTier = Number(it.trustTier) || repEntry?.trustTier || 2;
      const withinWindow = cls.breakingPriority < 0 || cls.ageHours <= effectiveWindowHours;
      return {
        ...it,
        trustTier,
        isBreaking: withinWindow ? cls.isBreaking : false,
        isInGameInjury: withinWindow ? cls.isInGameInjury : false,
        isPostGameInjuryUpdate: Boolean(cls.isPostGameInjuryUpdate),
        isStalePreGameAvailability: Boolean(cls.isStalePreGameAvailability),
        breakingPriority: withinWindow ? cls.breakingPriority : 0,
        breakingBadge: withinWindow ? cls.breakingBadge : null
      };
    })
    .sort((a, b) => {
      const aPrio = a.breakingPriority || 0;
      const bPrio = b.breakingPriority || 0;
      const prioDiff = bPrio - aPrio;
      const aMs = new Date(a.publishedAt || 0).getTime() || 0;
      const bMs = new Date(b.publishedAt || 0).getTime() || 0;

      const samePositiveBand = aPrio > 0 && bPrio > 0 && Math.abs(prioDiff) < 0.12 && Math.abs(bMs - aMs) <= 20 * 60_000;
      if (!samePositiveBand && prioDiff !== 0) return prioDiff;

      const windowMs = aPrio > 0 && bPrio > 0 ? 20 * 60_000 : 8 * 60_000;
      if (Math.abs(bMs - aMs) <= windowMs) {
        if (a.isFirstMoverInjuryScoop && !b.isFirstMoverInjuryScoop && (a.corroborationCount || 1) === 1) {
          return -1;
        }
        if (b.isFirstMoverInjuryScoop && !a.isFirstMoverInjuryScoop && (b.corroborationCount || 1) === 1) {
          return 1;
        }
        const tierDiff = (a.trustTier || 2) - (b.trustTier || 2);
        if (tierDiff !== 0) return tierDiff;
        const sigDiff = (Number(b.signalScore) || 0) - (Number(a.signalScore) || 0);
        if (Math.abs(sigDiff) >= 8) return sigDiff;
      }
      if (prioDiff !== 0) return prioDiff;
      return bMs - aMs;
    });
}

function isPureInjuryCard(item) {
  if (!item) return false;
  const text = `${item.fullText || ''} ${item.title || ''} ${item.headline || ''} ${item.summary || ''}`;
  if (MAJOR_NON_INJURY_BREAKING_REGEX.test(text) || CREDIBLE_TRADE_RUMOR_REGEX.test(text)) {
    return false;
  }
  return Boolean(
    item.isInGameInjury ||
      item.isPostGameInjuryUpdate ||
      item.category === 'injury' ||
      /^(?:LIVE )?INJURY\b/i.test(String(item.breakingBadge || '')) ||
      resolveInjuryMilestoneBucket(text)
  );
}

/**
 * Ensures injury prioritization never completely crowds out other salient news (credible trade rumors,
 * off-field/owner/player news, film breakdowns, or standout player interviews) outside live game action.
 * Preserves 100% of items while surfacing a fresh, salient non-injury item after `maxConsecutiveInjuries`.
 */
export function balanceFeedTopSalience(
  items = [],
  { nowMs = Date.now(), gameContext = null, appData = null, maxConsecutiveInjuries = 2 } = {}
) {
  if (!Array.isArray(items) || items.length <= maxConsecutiveInjuries) return items;
  const ctx = gameContext || (appData ? resolveGameNewsContext(appData, nowMs) : null);
  if (ctx?.inGame) return items;

  const remaining = [...items];
  const result = [];
  let consecutiveInj = 0;

  while (remaining.length > 0) {
    if (consecutiveInj >= maxConsecutiveInjuries && result.length < 10) {
      const nonInjIdx = remaining.findIndex((cand, idx) => {
        if (idx > 14 || isPureInjuryCard(cand) || cand?.isClickbait) return false;
        const pubMs = Date.parse(cand?.publishedAt || '');
        const ageHours = Number.isFinite(pubMs) ? Math.max(0, (nowMs - pubMs) / 3_600_000) : 999;
        if (ageHours > 36) return false;
        const text = `${cand.fullText || ''} ${cand.title || ''} ${cand.headline || ''} ${cand.summary || ''}`;
        return (
          (cand.breakingPriority || 0) > 0 ||
          Number(cand.signalScore || 0) >= 48 ||
          SALIENT_INTERVIEW_OR_FEATURE_REGEX.test(text) ||
          CREDIBLE_TRADE_RUMOR_REGEX.test(text) ||
          MAJOR_NON_INJURY_BREAKING_REGEX.test(text)
        );
      });

      if (nonInjIdx >= 0) {
        const [picked] = remaining.splice(nonInjIdx, 1);
        result.push(picked);
        consecutiveInj = 0;
        continue;
      }
    }

    const next = remaining.shift();
    result.push(next);
    if (isPureInjuryCard(next)) {
      consecutiveInj += 1;
    } else {
      consecutiveInj = 0;
    }
  }

  return result;
}

function resolveInjuryMilestoneBucket(text = '') {
  const t = String(text || '').toLowerCase();
  if (/\b(placed on injured reserve|placed on ir|season-ending|activated from ir|activated off ir|21-day)\b/.test(t)) {
    return 'ir_roster_move';
  }
  if (/\b(mri|x-ray|x-rays|ct scan|tests showed|initial tests|imaging)\b/.test(t)) {
    return 'diagnostic_imaging';
  }
  if (/\b(day-to-day|week-to-week|out multiple weeks|out several weeks|miss \d+|expected to miss)\b/.test(t)) {
    return 'recovery_timeline';
  }
  if (
    /\b(questionable to return|doubtful to return|ruled out for the rest|will not return|did not return|exited|left .*game|(?:headed|going|went|walked|taken) to the locker room|medical tent|carted off|suffered a|sustained a)\b/.test(
      t
    )
  ) {
    return 'in_game_injury_status';
  }
  if (PRE_GAME_AVAILABILITY_NOISE_REGEX.test(t)) {
    return 'pre_game_availability';
  }
  return null;
}

/**
 * Groups repetitive injury reports on the same player & same milestone under the richest/latest card
 * (`lead.confirmingReports`) while letting genuinely new milestones (e.g. MRI results vs initial exit)
 * remain distinct top-level cards.
 */
export function deduplicateAndGroupWireItems(items = []) {
  if (!Array.isArray(items) || items.length <= 1) return items;

  const grouped = [];
  const leadByClusterKey = new Map();

  for (const item of items) {
    if (item?.type === 'video') {
      grouped.push(item);
      continue;
    }

    const text = `${item?.fullText || ''} ${item?.title || ''} ${item?.summary || ''}`.trim();
    const milestone = resolveInjuryMilestoneBucket(text);
    const primaryPlayer = item?.mentionedPlayers?.[0];
    const playerKey = primaryPlayer?.id
      ? String(primaryPlayer.id)
      : primaryPlayer?.name
        ? primaryPlayer.name.toLowerCase().replace(/[^a-z0-9]/g, '')
        : '';

    if (!milestone || !playerKey) {
      grouped.push(item);
      continue;
    }

    const clusterKey = `${playerKey}::${milestone}`;
    const existing = leadByClusterKey.get(clusterKey);
    const itemMs = Date.parse(item?.publishedAt || '') || 0;

    if (!existing) {
      const cloned = { ...item, confirmingReports: [] };
      leadByClusterKey.set(clusterKey, cloned);
      grouped.push(cloned);
      continue;
    }

    const existingMs = Date.parse(existing.publishedAt || '') || 0;
    // Only collapse reports within 36 hours of each other
    if (Math.abs(existingMs - itemMs) > 36 * 3600_000) {
      grouped.push(item);
      continue;
    }

    // Prefer keeping the richer / newer lead card on top and tucking the duplicate into confirmingReports
    const existingBodyLen = String(existing.fullText || existing.title || '').length;
    const candidateBodyLen = String(item.fullText || item.title || '').length;
    const candidateIsBetterLead =
      candidateBodyLen > existingBodyLen + 35 ||
      (itemMs > existingMs + 20 * 60_000 && candidateBodyLen >= existingBodyLen * 0.75);

    if (candidateIsBetterLead) {
      const demotedPrev = { ...existing };
      delete demotedPrev.confirmingReports;
      const priorConfirming = existing.confirmingReports || [];
      Object.assign(existing, {
        ...item,
        confirmingReports: [demotedPrev, ...priorConfirming]
      });
    } else {
      existing.confirmingReports.push(item);
    }
  }

  return grouped;
}

const AUTHOR_BOILERPLATE_REGEX_CACHE = new Map();

function getCachedAuthorBoilerplateRegexes(cleanAuthor) {
  let pair = AUTHOR_BOILERPLATE_REGEX_CACHE.get(cleanAuthor);
  if (!pair) {
    if (AUTHOR_BOILERPLATE_REGEX_CACHE.size >= 256) {
      AUTHOR_BOILERPLATE_REGEX_CACHE.clear();
    }
    const escapedFull = cleanAuthor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pair = {
      midClauseRegex: new RegExp(
        `,\\s*(?:per\\s+)?${escapedFull}(?:\\s+of\\s+[A-Za-z0-9 .&'-]{2,32})?\\s+(?:reports|reported|notes|writes)(?=\\.|,|;|$)`,
        'gi'
      ),
      leadClauseRegex: new RegExp(
        `^(?:per\\s+${escapedFull}(?:\\s+of\\s+[A-Za-z0-9 .&'-]{2,28})?,\\s*|${escapedFull}\\s+reports:\\s*)`,
        'i'
      )
    };
    AUTHOR_BOILERPLATE_REGEX_CACHE.set(cleanAuthor, pair);
  }
  return pair;
}

/**
 * Strips redundant inline wire attribution like ", Mike Garafolo of NFL Network reports."
 * when `authorName` ("Mike Garafolo") is already rendered once in the card header.
 */
export function stripRedundantAuthorBoilerplate(rawText = '', authorName = '') {
  let cleaned = String(rawText || '').trim();
  const cleanAuthor = String(authorName || '')
    .split('•')[0]
    .trim();
  if (!cleaned || !cleanAuthor || cleanAuthor.length < 4) return cleaned;

  const { midClauseRegex, leadClauseRegex } = getCachedAuthorBoilerplateRegexes(cleanAuthor);
  midClauseRegex.lastIndex = 0;
  cleaned = cleaned.replace(midClauseRegex, '');
  cleaned = cleaned.replace(leadClauseRegex, '');
  if (cleaned.length > 1) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Returns true if `externalUrl` is just a bare social profile URL (e.g. https://x.com/MikeGarafolo)
 * or identical to `itemUrl`, preventing redundant "Linked Story: ... on X" self-link pills.
 */
function canonicalComparableUrl(raw = '') {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$|s$)/i.test(k)) u.searchParams.delete(k);
    }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    const qs = u.searchParams.toString();
    return `${host}${path}${qs ? `?${qs}` : ''}`;
  } catch {
    return s.toLowerCase().replace(/^https?:\/\/(?:www\.)?/, '').replace(/\/+$/, '');
  }
}

export function isRedundantProfileSelfLink(externalUrl = '', itemUrl = '') {
  const ext = String(externalUrl || '').trim();
  if (!ext) return true;
  if (itemUrl && canonicalComparableUrl(ext) === canonicalComparableUrl(itemUrl)) return true;
  if (/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/?(?:\?.*)?$/i.test(ext)) {
    return true;
  }
  if (/^https?:\/\/bsky\.app\/profile\/[^/]+\/?$/i.test(ext)) {
    return true;
  }
  return false;
}

/**
 * Formats a tweet's body so short tweets (<= 320 chars) preserve 100% of their full text
 * without mid-sentence truncation, while very long posts trim cleanly at a word boundary.
 */
export function formatTweetBodyForDisplay(rawText = '', limit = SHORT_TWEET_FULL_TEXT_LIMIT) {
  const cleaned = String(rawText || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) {
    return { text: '', isFullTweet: true, originalLength: 0 };
  }
  if (cleaned.length <= limit) {
    return { text: cleaned, isFullTweet: true, originalLength: cleaned.length };
  }
  const sliced = cleaned.slice(0, limit - 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const neat = (lastSpace > limit * 0.7 ? sliced.slice(0, lastSpace) : sliced).trim();
  return { text: `${neat}…`, isFullTweet: false, originalLength: cleaned.length };
}

/**
 * Determines whether a 49ers game is currently live or inside the immediate game-day
 * injury/inactives/post-game window (95m before kickoff through 4.5h after kickoff),
 * triggering ultra-low (<20s) tweet & game-day inactives polling latency.
 */
export function is49ersGameLiveWindow(appData = {}, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const schedule = appData?.scheduleMatchup?.schedule || [];
  const upcoming = appData?.scheduleMatchup?.upcomingMatchup || {};

  if (upcoming.liveState === 'in' || upcoming.isGameInProgress) {
    return true;
  }

  for (const g of schedule) {
    const statusLower = String(g.statusDetail || '').toLowerCase();
    if (/\b(q1|q2|q3|q4|1st|2nd|3rd|4th|halftime|in progress|ot|overtime)\b/.test(statusLower) && !g.completed) {
      return true;
    }
    const koMs = g.dateIso ? new Date(g.dateIso).getTime() : NaN;
    if (Number.isFinite(koMs)) {
      // 95 minutes pre-kickoff (covers 90-min official inactives + slight delays) through 4.5 hours post-kickoff
      if (nowMs >= koMs - 95 * 60_000 && nowMs <= koMs + 4.5 * 3600_000) {
        return true;
      }
    }
  }

  const upKoMs = (upcoming.dateIso || upcoming.kickoffIso) ? new Date(upcoming.dateIso || upcoming.kickoffIso).getTime() : NaN;
  if (Number.isFinite(upKoMs) && nowMs >= upKoMs - 95 * 60_000 && nowMs <= upKoMs + 4.5 * 3600_000) {
    return true;
  }

  return false;
}
