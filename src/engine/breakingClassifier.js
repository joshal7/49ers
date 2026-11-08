/**
 * Breaking News, In-Game Injury Return Alert & Low-Latency Tweet Classifier
 * Detects live in-game injury/return updates and breaking roster/transaction news
 * so critical updates rise immediately to #1 in both News & Film and Player Mentions.
 */

export const SHORT_TWEET_FULL_TEXT_LIMIT = 320;

const IN_GAME_INJURY_RETURN_REGEX =
  /\b(questionable to return|probable to return|doubtful to return|ruled out for the rest|out for the rest of the game|will not return|cleared to return|back in the game|returning to the game|returned to the game|headed to the locker room|going to the locker room|went to the locker room|blue medical tent|medical tent|evaluated for a concussion|concussion evaluation|carted off|limped off|helped off the field|in-game injury|injury update)\b/i;

const BREAKING_ROSTER_OR_STATUS_REGEX =
  /(\bbreaking\b|just in:|per source|per sources|\btrade:|traded to|acquiring|re-acquiring|has been traded|seeking reinstatement|reinstated|activated from ir|activated off ir|placed on injured reserve|placed on ir|game status report|officially active|officially inactive|ruled out|unlikely to play|expected to play|good to go|signed to the active roster|elevated from the practice squad|waived|released)/i;

/**
 * Classifies a tweet or news item for breaking / in-game injury priority.
 */
export function classifyBreakingItem(item = {}, nowMs = Date.now()) {
  const combined = `${item.title || item.headline || ''} ${item.fullText || ''} ${item.summary || ''}`.trim();
  const pubMs = item.publishedAt ? new Date(item.publishedAt).getTime() : NaN;
  const ageHours = Number.isFinite(pubMs) ? Math.max(0, (nowMs - pubMs) / 3_600_000) : 999;

  const matchesInGame = IN_GAME_INJURY_RETURN_REGEX.test(combined);
  const matchesBreaking = BREAKING_ROSTER_OR_STATUS_REGEX.test(combined);

  if (matchesInGame && ageHours <= 18) {
    return {
      isBreaking: true,
      isInGameInjury: ageHours <= 8,
      breakingPriority: ageHours <= 8 ? 2 : 1,
      breakingBadge: ageHours <= 8 ? 'LIVE INJURY UPDATE' : 'INJURY ALERT',
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

  // Respect explicit upstream flag if still fresh (<24h)
  if (item.isBreaking && ageHours <= 24) {
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
 * Sorts a list of tweets/articles so fresh breaking news & in-game injury return updates
 * rise straight to the top, followed by newest-first chronological ordering.
 */
export function sortNewsWithBreakingPriority(items = [], nowMs = Date.now(), { activeWindowHours = 18 } = {}) {
  return [...items]
    .map(it => {
      const cls = classifyBreakingItem(it, nowMs);
      return {
        ...it,
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
