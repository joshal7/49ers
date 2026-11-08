/**
 * Breaking News, In-Game Injury Return Alert & Low-Latency Tweet Classifier
 * Detects live in-game injury/return updates and breaking roster/transaction news
 * so critical updates rise immediately to #1 in both News & Film and Player Mentions.
 */

import {
  corroborateAndAnnotateWireStream,
  resolveReporterFromNameOrHandle
} from './beatAttributionEngine.js';

export const SHORT_TWEET_FULL_TEXT_LIMIT = 320;

const IN_GAME_INJURY_RETURN_REGEX =
  /\b(questionable to return|probable to return|doubtful to return|ruled out for the rest|out for the rest of the game|will not return|cleared to return|back in the game|returning to the game|returned to the game|headed to the locker room|going to the locker room|went to the locker room|blue medical tent|medical tent|evaluated for a concussion|concussion evaluation|carted off|limped off|limping off|helped off the field|helped off|walked off with trainers|with athletic trainers|examined by trainers|examined on the sideline|left practice early|in-game injury|injury update)\b/i;

const PRACTICE_WARMUP_INJURY_SCOOP_REGEX =
  /\b(not practicing|not seen at practice|working on a side field|rehab field|blue non-contact|non-contact jersey|walking boot|suffered a setback|aggravated his|underwent an mri|scheduled for an mri|high-ankle sprain|torn acl|torn achilles|torn pectoral|meniscus|21-day practice window|designated to return from|didn't activate|did not activate|game-time decision|full workload)\b/i;

const SPECULATIVE_OR_RETROSPECTIVE_EXCLUSION_REGEX =
  /\b(mock trade|trade proposal|trade idea|trade pitch|hypothetical|what if|flashback|on this day|\d+\s+years ago|way-too-early|mailbag|merch|promo code)\b/i;

const NON_TRANSACTION_RELEASE_REGEX =
  /\breleased\s+(?:a\s+|an\s+|their\s+|the\s+|its\s+|his\s+|her\s+|new\s+|official\s+|week\s+\d+\s+)?(?:statement|video|hype video|trailer|podcast|episode|schedule|depth chart|uniform|uniforms|jersey|renderings|report|rankings|grades|mock|list|photos|highlights|mic'd up)\b/i;

const BREAKING_ROSTER_OR_STATUS_REGEX =
  /(\bbreaking\b|just in:|per source|per sources|\btrade:|traded to|acquiring|re-acquiring|has been traded|seeking reinstatement|reinstated|activated from ir|activated off ir|activated from injured reserve|placed on injured reserve|placed on ir|game status report|officially active|officially inactive|ruled out|unlikely to play|expected to play|good to go|signed to the active roster|signed to the practice squad|elevated from the practice squad|standard elevation|\bwaived\b|has been released|have released|officially released|released from (?:ir|injured reserve|the practice squad)|\breleased\s+(?:veteran\s+|rookie\s+)?(?:qb|rb|fb|wr|te|ol|ot|og|c|dl|de|dt|nt|edge|lb|ilb|olb|cb|db|s|k|p|ls)\b)/i;

/**
 * Classifies a tweet or news item for breaking / in-game injury / first-mover scoop priority.
 */
export function classifyBreakingItem(item = {}, nowMs = Date.now()) {
  const combined = `${item.title || item.headline || ''} ${item.fullText || ''} ${item.summary || ''}`.trim();
  const pubMs = item.publishedAt ? new Date(item.publishedAt).getTime() : NaN;
  const ageHours = Number.isFinite(pubMs) ? Math.max(0, (nowMs - pubMs) / 3_600_000) : 999;

  const isSpeculative = SPECULATIVE_OR_RETROSPECTIVE_EXCLUSION_REGEX.test(combined);
  const matchesInGame = !isSpeculative && IN_GAME_INJURY_RETURN_REGEX.test(combined);
  const matchesPracticeInjuryScoop = !isSpeculative && PRACTICE_WARMUP_INJURY_SCOOP_REGEX.test(combined);
  const matchesBreaking =
    !isSpeculative &&
    !NON_TRANSACTION_RELEASE_REGEX.test(combined) &&
    BREAKING_ROSTER_OR_STATUS_REGEX.test(combined);

  if (matchesInGame && ageHours <= 18) {
    return {
      isBreaking: true,
      isInGameInjury: ageHours <= 8,
      breakingPriority: ageHours <= 8 ? 2 : 1,
      breakingBadge: ageHours <= 8 ? 'LIVE INJURY UPDATE' : 'INJURY ALERT',
      ageHours
    };
  }

  if (matchesPracticeInjuryScoop && ageHours <= 14) {
    return {
      isBreaking: true,
      isInGameInjury: false,
      breakingPriority: item.isFirstMoverInjuryScoop && ageHours <= 6 ? 1.85 : ageHours <= 8 ? 1.6 : 1,
      breakingBadge: item.isFirstMoverInjuryScoop && ageHours <= 6 ? 'INJURY SCOOP' : 'INJURY ALERT',
      ageHours
    };
  }

  if (matchesBreaking && ageHours <= 24) {
    return {
      isBreaking: true,
      isInGameInjury: false,
      breakingPriority: ageHours <= 12 ? 1.5 : 1,
      breakingBadge: 'BREAKING',
      ageHours
    };
  }

  // Respect explicit upstream flag if still fresh (<24h) and non-speculative
  if (item.isBreaking && !isSpeculative && ageHours <= 24) {
    return {
      isBreaking: true,
      isInGameInjury: Boolean(item.isInGameInjury),
      breakingPriority: item.isInGameInjury ? 2 : 1,
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

/**
 * Sorts a list of tweets/articles so:
 * 1. Fresh in-game & sideline injury updates rise immediately to #1 — INCLUDING First-Mover
 *    injury scoops from ANY viable tracked beat/sideline writer.
 * 2. When multiple reporters cover the same story within a tight window, Tier-1 Trusted Reporters
 *    (Maiocco, Wagoner, Barrows, Schefter, Rapoport, Pelissero, Garafolo, Lombardi, Shanahan/49ers)
 *    and corroborated multi-reporter updates rank highest while preserving first-mover attribution.
 * 3. Remaining items sort newest-first with trust-tier & signalScore tie-breaking.
 */
export function sortNewsWithBreakingPriority(items = [], nowMs = Date.now(), { activeWindowHours = 18 } = {}) {
  const corroborated = corroborateAndAnnotateWireStream(items, nowMs);

  return corroborated
    .map(it => {
      const cls = classifyBreakingItem(it, nowMs);
      const repEntry = resolveReporterFromNameOrHandle(it.reporterId || it.author || it.reporterName || it.authorHandle);
      const trustTier = Number(it.trustTier) || repEntry?.trustTier || 2;
      return {
        ...it,
        trustTier,
        isBreaking: cls.isBreaking,
        isInGameInjury: cls.isInGameInjury,
        breakingPriority: cls.ageHours <= activeWindowHours ? cls.breakingPriority : 0,
        breakingBadge: cls.ageHours <= activeWindowHours ? cls.breakingBadge : null
      };
    })
    .sort((a, b) => {
      const prioDiff = (b.breakingPriority || 0) - (a.breakingPriority || 0);
      if (prioDiff !== 0) return prioDiff;
      const aMs = new Date(a.publishedAt || 0).getTime() || 0;
      const bMs = new Date(b.publishedAt || 0).getTime() || 0;

      // Within a 20-minute window on corroborated/breaking news, prefer Tier-1 Trusted Reporters
      // UNLESS the earlier item is an uncorroborated First-Mover acute injury scoop.
      const windowMs = (a.breakingPriority || 0) > 0 ? 20 * 60_000 : 8 * 60_000;
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
      return bMs - aMs;
    });
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
 * injury/pre-game/post-game window (60m before kickoff through 4.5h after kickoff),
 * triggering ultra-low (<20s) tweet & injury polling latency.
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
      // 60 minutes pre-kickoff (inactives + warmups) through 4.5 hours post-kickoff
      if (nowMs >= koMs - 60 * 60_000 && nowMs <= koMs + 4.5 * 3600_000) {
        return true;
      }
    }
  }

  const upKoMs = upcoming.kickoffIso ? new Date(upcoming.kickoffIso).getTime() : NaN;
  if (Number.isFinite(upKoMs) && nowMs >= upKoMs - 60 * 60_000 && nowMs <= upKoMs + 4.5 * 3600_000) {
    return true;
  }

  return false;
}
