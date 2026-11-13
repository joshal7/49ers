/**
 * Outbound Link Policy, Paywall Sanitizer, Dynamic Year URL Builders &
 * Anti-Homonym Player Identity Resolver.
 *
 * Shared across Node ingestion scripts (`scripts/`) and browser views/services (`src/`)
 * to guarantee that all outgoing links:
 *   1) Are never behind a paywall or subscription gate.
 *   2) Resolve to the exact intended player, franchise, or season page (zero homonyms or 404s).
 *   3) Dynamically advance with `seasonYear` / `draftYear` and roster transactions.
 */

const PAYWALLED_HOST_RULES = [
  // Hard-paywalled or subscription-gated sports/news domains & subpaths
  { host: /(^|\.)nytimes\.com$/i, path: /^\/athletic(\/|$)/i },
  { host: /(^|\.)theathletic\.com$/i },
  { host: /(^|\.)sfchronicle\.com$/i },
  { host: /(^|\.)houstonchronicle\.com$/i },
  { host: /(^|\.)mercurynews\.com$/i },
  { host: /(^|\.)eastbaytimes\.com$/i },
  { host: /(^|\.)ocregister\.com$/i },
  { host: /(^|\.)dailynews\.com$/i },
  { host: /(^|\.)wsj\.com$/i },
  { host: /(^|\.)washingtonpost\.com$/i },
  { host: /(^|\.)bostonglobe\.com$/i },
  { host: /(^|\.)latimes\.com$/i },
  { host: /(^|\.)startribune\.com$/i },
  { host: /(^|\.)inquirer\.com$/i },
  { host: /(^|\.)dallasnews\.com$/i },
  { host: /(^|\.)seattletimes\.com$/i },
  { host: /(^|\.)baltimoresun\.com$/i },
  { host: /(^|\.)chicagotribune\.com$/i },
  { host: /(^|\.)ft\.com$/i },
  { host: /(^|\.)bloomberg\.com$/i },
  { host: /(^|\.)businessinsider\.com$/i },
  { host: /(^|\.)footballoutsiders\.com$/i },
  // PFF premium / locked player & team grading pages
  { host: /^premium\.pff\.com$/i },
  { host: /(^|\.)pff\.com$/i, path: /^\/(nfl\/(players|teams|grades|scores)|subscribe|edge|elite)(\/|$)/i },
  // ESPN+ / Insider paywalled paths
  { host: /(^|\.)espn\.com$/i, path: /^\/(nfl\/insider|espnplus|insider)(\/|$)/i },
  // NFL Mock Draft Database paid Mock+ tier
  { host: /(^|\.)nflmockdraftdatabase\.com$/i, path: /^\/mock-plus(\/|$)/i },
  // Cloudflare challenge-gated / clickbait aggregator domain (HTTP 403)
  { host: /(^|\.)heavy\.com$/i }
];

const PAYWALLED_OUTLET_NAME_REGEX =
  /\b(the athletic|ny times|new york times|san francisco chronicle|sf chronicle|houston chronicle|mercury news|san jose mercury|east bay times|wall street journal|washington post|boston globe|los angeles times|la times|star tribune|philadelphia inquirer|dallas morning news|seattle times|baltimore sun|chicago tribune|financial times|bloomberg|business insider|espn\+|espn insider|pff\+|pff elite)\b/i;

const KNOWN_BROKEN_PATH_RULES = [
  { host: /(^|\.)nfl\.com$/i, path: /^\/news\/series\/power-rankings\/?$/i },
  { host: /(^|\.)nflmockdraftdatabase\.com$/i, path: /^\/team-needs-\d{4}\//i },
  { host: /(^|\.)espn\.com$/i, path: /^\/nfl\/draft\d{4}\/?$/i },
  { host: /(^|\.)espn\.com$/i, path: /^\/nfl\/story\/_\/page\/nflpowerrankings\/?$/i },
  { host: /(^|\.)espn\.com$/i, path: /^\/video\/clip\/?$/i },
  // ESPN Scouts Inc. internal draft-ranking IDs (id="rank-45828xx") are NOT valid CFB athlete IDs and return HTTP 404
  { host: /(^|\.)espn\.com$/i, path: /^\/college-football\/player\/_\/id\/4582[6789]\d{2}(\/|$)/i },
  { host: /(^|\.)rotowire\.com$/i, path: /^\/football\/(news\.php|headlines)(\/|$)/i }
];

const OPAQUE_URL_SHORTENER_HOST_REGEX =
  /^(?:www\.)?(?:dlvr\.it|bit\.ly|tinyurl\.com|t\.co|ow\.ly|buff\.ly|ift\.tt|trib\.al|goo\.gl)$/i;

const TRACKING_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref_src',
  'ref_url',
  '_osource'
]);

export const ESPN_TEAM_SLUG_MAP = {
  WAS: 'wsh',
  WSH: 'wsh',
  LAR: 'lar',
  LA: 'lar',
  LV: 'lv',
  OAK: 'lv',
  SF: 'sf',
  SFO: 'sf',
  GB: 'gb',
  NO: 'no',
  NE: 'ne',
  TB: 'tb',
  KC: 'kc',
  JAX: 'jax',
  JAC: 'jax'
};

export const PFR_FRANCHISE_CODE_MAP = {
  SF: 'sfo',
  SFO: 'sfo',
  ARI: 'crd',
  ATL: 'atl',
  BAL: 'rav',
  BUF: 'buf',
  CAR: 'car',
  CHI: 'chi',
  CIN: 'cin',
  CLE: 'cle',
  DAL: 'dal',
  DEN: 'den',
  DET: 'det',
  GB: 'gnb',
  HOU: 'htx',
  IND: 'clt',
  JAX: 'jax',
  JAC: 'jax',
  KC: 'kan',
  LV: 'rai',
  OAK: 'rai',
  LAC: 'sdg',
  LAR: 'ram',
  LA: 'ram',
  MIA: 'mia',
  MIN: 'min',
  NE: 'nwe',
  NO: 'nor',
  NYG: 'nyg',
  NYJ: 'nyj',
  PHI: 'phi',
  PIT: 'pit',
  SEA: 'sea',
  TB: 'tam',
  TEN: 'oti',
  WAS: 'was',
  WSH: 'was'
};

export function normalizePlayerKey(name = '') {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(jr\.?|sr\.?|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

const NICKNAME_ALIASES = {
  rob: 'robert',
  robert: 'rob',
  ogbo: 'ogbonnia',
  ogbonnia: 'ogbo',
  will: 'william',
  william: 'will',
  mike: 'michael',
  michael: 'mike',
  dan: 'daniel',
  daniel: 'dan',
  matt: 'matthew',
  matthew: 'matt',
  josh: 'joshua',
  joshua: 'josh',
  chris: 'christopher',
  christopher: 'chris',
  nate: 'nathan',
  nathan: 'nate',
  sammy: 'samuel',
  samuel: 'sammy',
  cam: 'cameron',
  cameron: 'cam',
  dre: 'javondre',
  javondre: 'dre'
};

export function getPlayerLookupKeys(name = '') {
  const base = normalizePlayerKey(name);
  if (!base) return [];
  const keys = new Set([base]);
  const tokens = String(name || '')
    .toLowerCase()
    .replace(/\b(jr\.?|sr\.?|ii|iii|iv|v)\b/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length >= 2) {
    const firstClean = tokens[0].replace(/[^a-z0-9]/g, '');
    const alias = NICKNAME_ALIASES[firstClean];
    if (alias) {
      const rest = tokens
        .slice(1)
        .join('')
        .replace(/[^a-z0-9]/g, '');
      keys.add(`${alias}${rest}`);
    }
  }
  return [...keys];
}

export function slugifyPlayerName(name = '') {
  return String(name || '')
    .toLowerCase()
    .replace(/['’`.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toEspnTeamSlug(teamAbbr = 'SF') {
  const clean = String(teamAbbr || 'SF').trim().toUpperCase();
  return ESPN_TEAM_SLUG_MAP[clean] || clean.toLowerCase();
}

export function toPfrFranchiseCode(teamAbbr = 'SF') {
  const clean = String(teamAbbr || 'SF').trim().toUpperCase();
  return PFR_FRANCHISE_CODE_MAP[clean] || clean.toLowerCase();
}

/**
 * Checks whether a candidate URL is malformed, broken, or behind a paywall.
 */
export function isPaywalledOrBlockedUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return true;
  const trimmed = rawUrl.trim();
  if (!trimmed) return true;
  if (/(^|\/)(undefined|null|NaN)(\/|$|\?)/i.test(trimmed)) return true;

  let parsed;
  try {
    parsed = new URL(trimmed.startsWith('http://') ? `https://${trimmed.slice(7)}` : trimmed);
  } catch {
    return true;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return true;
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname || '/';

  for (const rule of PAYWALLED_HOST_RULES) {
    if (rule.host.test(host) && (!rule.path || rule.path.test(pathname))) {
      return true;
    }
  }

  for (const broken of KNOWN_BROKEN_PATH_RULES) {
    if (broken.host.test(host) && broken.path.test(pathname)) {
      return true;
    }
  }

  if (OPAQUE_URL_SHORTENER_HOST_REGEX.test(host)) {
    return true;
  }

  return false;
}

export function isOpaqueShortenerUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  try {
    const clean = rawUrl.trim();
    const parsed = new URL(clean.startsWith('http://') ? `https://${clean.slice(7)}` : clean);
    return OPAQUE_URL_SHORTENER_HOST_REGEX.test(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function stripTrackingParams(rawUrl = '') {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim().replace(/\/_osource=[^/?#]+/gi, '/');
  if (!trimmed || !trimmed.includes('?')) return trimmed;
  try {
    const parsed = new URL(trimmed.startsWith('http://') ? `https://${trimmed.slice(7)}` : trimmed);
    let mutated = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
        mutated = true;
      }
    }
    return mutated ? parsed.toString() : trimmed;
  } catch {
    return trimmed;
  }
}

const OFF_TOPIC_LEAGUE_FILLER_URL_REGEX =
  /^https?:\/\/(?:www\.|m\.)?espn\.com\/(?:fantasy\/|espn\/betting\/)/i;

const OFF_TOPIC_LEAGUE_FILLER_HEADLINE_REGEX =
  /\b(survivor pool|survivor power rankings|fantasy football d\/st|fantasy spin|fantasy sleepers|fantasy tips|lineup help|waiver wire|week \d+\s+uniforms|best arrivals|nfl week \d+\s+trolls|trick plays in super bowl history|longest field goals in nfl history|redefine all-time sack list|jay-z['’]?s road to the super bowl|nfl practice squad updates)\b/i;

const SF_RELEVANCE_TERM_REGEX =
  /\b(49er|49ers|niners|san francisco|santa clara|levi['’]?s|shanahan|lynch|morris|saleh|foerster|kocurek|purdy|bosa|mccaffrey|kittle|warner|trent williams|mykel williams|aiyuk|buckner|odighizuwa|lenoir|pearsall|jennings|deebo|mike evans|greenlaw|mustapha|ji['’]?ayir|renardo green|upton stout|gracen halton|jordan watkins|mckivitz|brendel|puni|juszczyk|pineiro|demarcus robinson|christian kirk|brandin cooks|nate hobbs|stribling|dugger|mac jones|keion white|romello height)\b/i;

/**
 * Identifies generic league-wide filler (fantasy D/ST, survivor pools, betting lines roundups,
 * uniform/arrival slideshows, non-49ers transactions) that should not pollute the 49ers news stream.
 */
export function isOffTopicLeagueFiller({
  url = '',
  title = '',
  summary = '',
  hasRosterMatch = false
} = {}) {
  const u = String(url || '').trim();
  const t = String(title || '').trim();
  const s = String(summary || '').trim();
  if (u && OFF_TOPIC_LEAGUE_FILLER_URL_REGEX.test(u)) return true;
  if (OFF_TOPIC_LEAGUE_FILLER_HEADLINE_REGEX.test(t)) return true;
  if (/\b(fantasy|lineup help|sleepers|waiver wire|d\/st)\b/i.test(t) && !/\b(49ers|niners|san francisco)\b/i.test(t)) {
    return true;
  }
  const combined = `${t} ${s}`;
  if (!hasRosterMatch && !SF_RELEVANCE_TERM_REGEX.test(combined)) {
    return true;
  }
  return false;
}

/**
 * Detects stale preseason, training-camp, 53-man cutdown, or far-past week headlines
 * that RSS search aggregators occasionally resurface with fresh timestamps.
 */
export function isStaleSeasonHeadline(headline = '', currentWeek = null) {
  const h = String(headline || '').trim();
  if (!h) return false;
  if (
    /\b(training camp|cut-down to 53|53-man roster tracker|53-man roster projection|preseason finale|preseason week|ahead of the 202\d season|heading into the 202\d season|placed? .* on pup list)\b/i.test(
      h
    )
  ) {
    return true;
  }
  const wkNum = Number(currentWeek);
  if (Number.isFinite(wkNum) && wkNum >= 4) {
    const m = h.match(/\bweek\s*(\d{1,2})\b/i);
    if (m) {
      const mentionedWk = Number(m[1]);
      if (Number.isFinite(mentionedWk) && mentionedWk <= wkNum - 3) {
        if (/\b(ahead of week|clash vs|preview|inactives|highlights, replay|betting odds|picks, predictions|power rankings)\b/i.test(h)) {
          return true;
        }
      }
    }
  }
  return false;
}

const DIRECT_FREE_PUBLIC_HOST_REGEX =
  /(^|\.)(x\.com|twitter\.com|bsky\.app|espn\.com|rotowire\.com|49ers\.com|nfl\.com|youtube\.com|youtu\.be|nbcsportsbayarea\.com|sfstandard\.com|ninersnation\.com|49erswebzone\.com|profootballrumors\.com|nfltraderumors\.co|cbssports\.com|overthecap\.com|pro-football-reference\.com|tankathon\.com|drafttek\.com|walterfootball\.com|bleacherreport\.com|si\.com|yahoo\.com|thegamehaus\.com|wideleft\.football|nflmockdraftdatabase\.com)$/i;

/**
 * Detects whether an RSS or syndication publisher is paywalled (even when wrapped in a redirect URL).
 * Direct public social/wire posts (e.g. X, Bluesky, ESPN Player Wire, RotoWire, YouTube) from beat writers
 * at paywalled papers remain allowed because the linked post itself is free to read.
 */
export function isPaywalledPublisher(outletName = '', sourceDomainUrl = '') {
  if (sourceDomainUrl) {
    if (isPaywalledOrBlockedUrl(sourceDomainUrl)) return true;
    try {
      const normalized = sourceDomainUrl.trim().startsWith('http://')
        ? `https://${sourceDomainUrl.trim().slice(7)}`
        : sourceDomainUrl.trim();
      const host = new URL(normalized).hostname.toLowerCase();
      if (DIRECT_FREE_PUBLIC_HOST_REGEX.test(host)) {
        return false;
      }
    } catch {
      // Fall through to outlet-name check if URL parsing fails
    }
  }
  if (outletName && PAYWALLED_OUTLET_NAME_REGEX.test(String(outletName))) return true;
  return false;
}

/**
 * Normalizes an external URL (`http://` -> `https://`), strips marketing tracking params,
 * and returns `fallbackUrl` if empty, malformed, shortener-opaque, or paywalled.
 */
export function sanitizeExternalUrl(rawUrl, fallbackUrl = null) {
  if (typeof rawUrl !== 'string') return fallbackUrl;
  const trimmed = rawUrl.trim();
  if (!trimmed) return fallbackUrl;
  const httpsUrl = trimmed.startsWith('http://') ? `https://${trimmed.slice(7)}` : trimmed;
  const collapsedSlashes = httpsUrl.replace(/^(https:\/\/[^/?#]+)\/\/+/i, '$1/');
  const upgraded = stripTrackingParams(collapsedSlashes);
  if (isPaywalledOrBlockedUrl(upgraded)) return fallbackUrl;
  return upgraded;
}

/**
 * Balanced-parenthesis URL body pattern for CommonMark / Markdown inline links `[Label](URL)`.
 * Safely captures URLs containing balanced parentheses—such as ESPN W3C Scroll-To-Text fragments
 * (`#:~:text=Greenlaw%20(knee)%20was%20limited...`), X boolean searches (`x.com/search?q=(from:...)`),
 * and Wikipedia disambiguators (`_(American_football)`)—without prematurely terminating at the
 * inner `)` or consuming outer prose parentheses wrapping `([Label](URL))`.
 */
export const MARKDOWN_BALANCED_URL_BODY = '(?:[^\\s()]|\\((?:[^\\s()]|\\([^\\s()]*\\))*\\))+';
export const MARKDOWN_HTTPS_INLINE_LINK_SOURCE = `\\[([^\\]]{1,80})\\]\\((https:\\/\\/${MARKDOWN_BALANCED_URL_BODY})\\)`;
export const MARKDOWN_ANY_INLINE_LINK_SOURCE = `\\[([^\\]]{1,80})\\]\\((${MARKDOWN_BALANCED_URL_BODY})\\)`;

/**
 * RFC-3986 percent-encodes literal `(` (`%28`) and `)` (`%29`) inside a URL before serializing it
 * into a Markdown link destination `[Label](URL)`, eliminating delimiter collisions while remaining
 * 100% semantically identical across HTTP paths, query strings, and `#:~:text=` fragments.
 */
export function encodeMarkdownLinkUrl(rawUrl = '') {
  if (typeof rawUrl !== 'string' || !rawUrl) return '';
  return rawUrl.trim().replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * Decodes `%28` / `%29` back to literal parentheses for canonical URL map lookups against raw stream URLs.
 */
export function decodeMarkdownLinkUrlParens(rawUrl = '') {
  if (typeof rawUrl !== 'string' || !rawUrl) return '';
  return rawUrl.trim().replace(/%28/gi, '(').replace(/%29/gi, ')');
}

/**
 * Repairs any string where a legacy non-balanced Markdown link regex split an inline link at an
 * inner `)` and left a trailing percent-encoded URL fragment tail (`%20was%20limited...practice)`),
 * and normalizes all inline `[Label](https://...)` destinations with `encodeMarkdownLinkUrl`.
 */
export function normalizeMarkdownInlineLinksInText(rawText = '') {
  if (typeof rawText !== 'string' || !rawText) return '';
  // 1. Re-join any split `[Label](https://...%20(word)` + optional space + `%20...tail)` artifact
  const healedSplit = rawText.replace(
    /\[([^\]]{1,80})\]\((https:\/\/[^\s)]+\([^)\s]+)\)\s*(%[0-9A-Fa-f]{2}[^\s()]*)\)/g,
    (_, label, headUrl, tailFragment) => `[${label}](${encodeMarkdownLinkUrl(`${headUrl})${tailFragment}`)})`
  );
  // 2. Encode any literal parentheses inside balanced `[Label](https://...)` destinations
  const httpsLinkRe = new RegExp(MARKDOWN_HTTPS_INLINE_LINK_SOURCE, 'g');
  return healedSplit.replace(
    httpsLinkRe,
    (_, label, targetUrl) => `[${label}](${encodeMarkdownLinkUrl(targetUrl)})`
  );
}

/**
 * Strips Markdown inline links `[Label](Target)` (including targets with balanced parentheses),
 * optionally preserving the visible link label text.
 */
export function stripMarkdownInlineLinks(rawText = '', { keepLabel = false } = {}) {
  if (typeof rawText !== 'string' || !rawText) return '';
  const anyLinkRe = new RegExp(`\\[([^\\]]*)\\]\\((${MARKDOWN_BALANCED_URL_BODY})\\)`, 'g');
  return rawText.replace(anyLinkRe, keepLabel ? '$1' : ' ');
}

/**
 * Validates a Pro-Football-Reference player ID (`PurdBr00`, `ThomJa06`, `JiAyBr00`).
 */
export function isValidPfrPlayerId(pfrId) {
  return typeof pfrId === 'string' && /^[A-Za-z.'-]{4,8}\d{2}$/.test(pfrId.trim());
}

export function buildEspnPlayerUrl(espnId, playerName = '') {
  const cleanId = String(espnId ?? '').trim();
  if (!/^\d+$/.test(cleanId)) return null;
  const slug = slugifyPlayerName(playerName);
  return slug
    ? `https://www.espn.com/nfl/player/_/id/${cleanId}/${slug}`
    : `https://www.espn.com/nfl/player/_/id/${cleanId}`;
}

/**
 * Builds an HTTP-200 ESPN Player News URL with a W3C Scroll-To-Text fragment (`#:~:text=...`)
 * so clicking an ESPN/RotoWire Injury Wire item scrolls directly to that exact verbatim update on ESPN.
 */
export function buildEspnPlayerNewsAnchorUrl(espnId, playerName = '', leadSentence = '') {
  const baseUrl = buildEspnPlayerUrl(espnId, playerName);
  if (!baseUrl) return null;
  let words = String(leadSentence || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 7)
    .join(' ')
    .replace(/[.,;:!?]+$/, '');
  // If slicing to 7 words cut inside an opening parenthetical `(e.g. ...` before its closing `)`,
  // trim the unclosed clause so the text fragment never contains unbalanced parentheses.
  if (words.includes('(') || words.includes(')')) {
    words = words.replace(/\s*\([^)]*$/, '').trim();
    const openCount = (words.match(/\(/g) || []).length;
    const closeCount = (words.match(/\)/g) || []).length;
    if (openCount !== closeCount) {
      words = words.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
    }
  }
  if (!words || words.length < 10) return baseUrl;
  return `${baseUrl}#:~:text=${encodeURIComponent(words)}`;
}

export function buildPfrPlayerUrl(pfrId) {
  if (!isValidPfrPlayerId(pfrId)) return null;
  const clean = pfrId.trim();
  const bucketLetter = clean.replace(/[^A-Za-z]/g, '')[0]?.toUpperCase();
  if (!bucketLetter) return null;
  return `https://www.pro-football-reference.com/players/${bucketLetter}/${clean}.htm`;
}

export const OTC_TEAM_CAP_URL = 'https://overthecap.com/salary-cap/san-francisco-49ers';

export function isValidOtcPlayerId(otcId, espnId = null) {
  const clean = String(otcId ?? '').trim();
  if (!/^\d+$/.test(clean)) return false;
  if (espnId != null && String(espnId).trim() !== '' && clean === String(espnId).trim()) {
    return false;
  }
  const num = Number(clean);
  return num > 0 && num < 500_000;
}

export function buildOtcPlayerUrl({ otcSlug = null, otcId = null, espnId = null, playerName = '', fallbackToTeam = true } = {}) {
  if (isValidOtcPlayerId(otcId, espnId)) {
    const slug = (otcSlug && String(otcSlug).trim()) || slugifyPlayerName(playerName);
    if (slug) {
      return `https://overthecap.com/player/${slug}/${String(otcId).trim()}/`;
    }
  }
  return fallbackToTeam ? OTC_TEAM_CAP_URL : null;
}

export function isIndividualOtcPlayerUrl(url) {
  return typeof url === 'string' && /^https:\/\/overthecap\.com\/player\/[a-z0-9-]+\/\d+\/?$/i.test(url.trim());
}

export function buildPfrTeamSeasonUrl(teamAbbr = 'SF', seasonYear = 2026) {
  const yr = Number(seasonYear) || new Date().getFullYear();
  return `https://www.pro-football-reference.com/teams/${toPfrFranchiseCode(teamAbbr)}/${yr}.htm`;
}

export function buildPfrTeamDraftUrl(teamAbbr = 'SF', draftYear = 2026) {
  const yr = Number(draftYear) || new Date().getFullYear();
  return `https://www.pro-football-reference.com/teams/${toPfrFranchiseCode(teamAbbr)}/${yr}_draft.htm`;
}

export function buildPfrHeadToHeadUrl(team1Abbr = 'SF', team2Abbr = 'LV') {
  return `https://www.pro-football-reference.com/boxscores/game_query.cgi?tm1=${toPfrFranchiseCode(team1Abbr)}&tm2=${toPfrFranchiseCode(team2Abbr)}&yr=all`;
}

export function buildOtcPositionUrl(positionSlug = 'wide-receiver', seasonYear = null) {
  const cleanSlug = String(positionSlug || 'wide-receiver').replace(/^\/+|\/+$/g, '');
  const yr = Number(seasonYear);
  return Number.isFinite(yr) && yr >= 2015
    ? `https://overthecap.com/position/${cleanSlug}/${yr}`
    : `https://overthecap.com/position/${cleanSlug}`;
}

export function buildMockDraftTeamUrl(draftYear = 2027, teamSlug = 'san-francisco-49ers') {
  const yr = Number(draftYear) || new Date().getFullYear() + 1;
  return `https://www.nflmockdraftdatabase.com/teams/${yr}/${teamSlug}`;
}

export function buildMockDraftBigBoardUrl(draftYear = 2027) {
  const yr = Number(draftYear) || new Date().getFullYear() + 1;
  return `https://www.nflmockdraftdatabase.com/big-boards/${yr}/consensus-big-board-${yr}`;
}

export function buildMockDraftProspectUrl(draftYear, prospectSlug, prospectClassYear = draftYear) {
  const yr = Number(draftYear) || new Date().getFullYear() + 1;
  if (prospectSlug && Number(prospectClassYear) === yr) {
    return `https://www.nflmockdraftdatabase.com/players/${yr}/${prospectSlug}`;
  }
  return buildMockDraftBigBoardUrl(yr);
}

export function buildEspnTeamInjuriesUrl(teamAbbr = 'SF') {
  return `https://www.espn.com/nfl/team/injuries/_/name/${toEspnTeamSlug(teamAbbr)}`;
}

export function buildEspnTeamLogoUrl(teamAbbr = 'SF', espnTeamObj = null) {
  const direct = espnTeamObj?.logo || espnTeamObj?.logos?.[0]?.href;
  if (direct && /^https?:\/\//i.test(direct)) {
    return direct.startsWith('http://') ? `https://${direct.slice(7)}` : direct;
  }
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${toEspnTeamSlug(teamAbbr)}.png`;
}

const POSITION_BUCKET_MAP = {
  QB: 'QB',
  RB: 'RB',
  FB: 'RB',
  HB: 'RB',
  WR: 'WR',
  TE: 'TE',
  OL: 'OL',
  OT: 'OL',
  T: 'OL',
  LT: 'OL',
  RT: 'OL',
  G: 'OL',
  LG: 'OL',
  RG: 'OL',
  C: 'OL',
  IOL: 'OL',
  DL: 'DL',
  DT: 'DL',
  NT: 'DL',
  DE: 'EDGE_DL',
  EDGE: 'EDGE_DL',
  ED: 'EDGE_DL',
  OLB: 'LB_EDGE',
  LB: 'LB',
  ILB: 'LB',
  MLB: 'LB',
  CB: 'DB',
  DB: 'DB',
  S: 'DB',
  SAF: 'DB',
  FS: 'DB',
  SS: 'DB',
  K: 'K',
  PK: 'K',
  P: 'P',
  LS: 'LS'
};

function arePositionsCompatible(posA = '', posB = '') {
  const a = POSITION_BUCKET_MAP[String(posA || '').toUpperCase()] || '';
  const b = POSITION_BUCKET_MAP[String(posB || '').toUpperCase()] || '';
  if (!a || !b) return true;
  if (a === b) return true;
  const trench = new Set(['DL', 'EDGE_DL', 'LB_EDGE']);
  const lb = new Set(['LB', 'LB_EDGE', 'EDGE_DL']);
  if (trench.has(a) && trench.has(b)) return true;
  if (lb.has(a) && lb.has(b)) return true;
  return false;
}

/**
 * Checks whether an `nflverse` player row is plausible for an active roster player in `seasonYear`
 * (guards against upstream `espn_id` collisions with retired 1970s/1980s/1990s players like `ThomJa01`).
 */
export function isPlausibleActiveNflRow(row, { seasonYear = 2026, position = '' } = {}) {
  if (!row) return false;
  const yr = Number(seasonYear) || 2026;
  const lastSeason = row.last_season ? Number(row.last_season) : null;
  if (Number.isFinite(lastSeason) && lastSeason > 0 && lastSeason < yr - 5) {
    return false;
  }
  const birthYear = row.birth_date ? Number(String(row.birth_date).slice(0, 4)) : null;
  if (Number.isFinite(birthYear) && birthYear > 1900 && yr - birthYear > 47) {
    return false;
  }
  if (position && row.position && !arePositionsCompatible(position, row.position)) {
    // Allow minor position switches (e.g. college QB -> TE or RB -> WR) ONLY if last_season is current & team matches
    const recentAndActive = Number.isFinite(lastSeason) && lastSeason >= yr - 1;
    if (!recentAndActive) return false;
  }
  return true;
}

/**
 * Builds a deterministic, homonym-safe player identity & link resolver over `nflverse` players + OverTheCap records.
 */
export function createPlayerIdentityResolver({ nflPlayers = [], otcPlayers = [], seasonYear = 2026 } = {}) {
  const nflByEspnId = new Map();
  const nflCandidatesByName = new Map();

  for (const row of nflPlayers) {
    if (row.espn_id) {
      const eid = String(row.espn_id).trim();
      const existing = nflByEspnId.get(eid);
      if (!existing || (!isPlausibleActiveNflRow(existing, { seasonYear }) && isPlausibleActiveNflRow(row, { seasonYear }))) {
        nflByEspnId.set(eid, row);
      }
    }
    for (const key of [
      ...getPlayerLookupKeys(row.display_name || ''),
      ...getPlayerLookupKeys(row.short_name || ''),
      ...getPlayerLookupKeys(`${row.first_name || ''} ${row.last_name || ''}`)
    ]) {
      if (!nflCandidatesByName.has(key)) nflCandidatesByName.set(key, []);
      const arr = nflCandidatesByName.get(key);
      if (!arr.includes(row)) arr.push(row);
    }
  }

  const otcById = new Map();
  const otcCandidatesByName = new Map();
  for (const op of otcPlayers) {
    if (op.otcId) otcById.set(String(op.otcId).trim(), op);
    for (const key of getPlayerLookupKeys(op.name || '')) {
      if (!otcCandidatesByName.has(key)) otcCandidatesByName.set(key, []);
      const arr = otcCandidatesByName.get(key);
      if (!arr.includes(op)) arr.push(op);
    }
  }

  function scoreCandidate(row, { fullName = '', position = '', college = '', teamAbbr = 'SF', espnId = '' }) {
    if (!isPlausibleActiveNflRow(row, { seasonYear, position })) return -1000;
    let score = 0;
    const targetTeam = String(teamAbbr || 'SF').toUpperCase();
    const rowTeam = String(row.latest_team || '').toUpperCase();
    if (
      rowTeam === targetTeam ||
      (targetTeam === 'SF' && rowTeam === 'SFO') ||
      (targetTeam === 'LV' && rowTeam === 'OAK') ||
      (targetTeam === 'LAR' && rowTeam === 'LA')
    ) {
      score += 65;
    }

    const lastSeason = row.last_season ? Number(row.last_season) : 0;
    if (lastSeason >= seasonYear) score += 45;
    else if (lastSeason === seasonYear - 1) score += 30;
    else if (lastSeason >= seasonYear - 3) score += 12;

    if (position && row.position) {
      if (String(row.position).toUpperCase() === String(position).toUpperCase()) score += 35;
      else if (arePositionsCompatible(position, row.position)) score += 20;
      else score -= 35;
    }

    if (college && row.college_name) {
      const cA = String(college).toLowerCase();
      const cB = String(row.college_name).toLowerCase();
      if (cB.includes(cA) || cA.includes(cB)) score += 30;
    }

    if (espnId && String(row.espn_id || '').trim() === String(espnId).trim()) {
      score += 90;
    }

    if (String(row.display_name || '').toLowerCase().trim() === String(fullName || '').toLowerCase().trim()) {
      score += 15;
    }

    return score;
  }

  function resolvePlayer({
    espnId = '',
    fullName = '',
    position = '',
    college = '',
    teamAbbr = 'SF'
  } = {}) {
    const cleanEspnId = String(espnId || '').trim();
    const lookupKeys = getPlayerLookupKeys(fullName);

    const candidateSet = new Set();
    const directEspnRow = cleanEspnId ? nflByEspnId.get(cleanEspnId) : null;
    if (directEspnRow && isPlausibleActiveNflRow(directEspnRow, { seasonYear, position })) {
      candidateSet.add(directEspnRow);
    }
    for (const k of lookupKeys) {
      for (const cand of nflCandidatesByName.get(k) || []) {
        candidateSet.add(cand);
      }
    }

    let bestNfl = null;
    let bestScore = -Infinity;
    for (const cand of candidateSet) {
      const s = scoreCandidate(cand, { fullName, position, college, teamAbbr, espnId: cleanEspnId });
      if (s > bestScore) {
        bestScore = s;
        bestNfl = cand;
      }
    }
    if (bestScore < 0) bestNfl = null;

    // Resolve OverTheCap record & genuine OTC ID
    const nflOtcId = isValidOtcPlayerId(bestNfl?.otc_id, cleanEspnId) ? String(bestNfl.otc_id).trim() : null;
    let otcRecord = (nflOtcId && otcById.get(nflOtcId)) || null;
    if (!otcRecord) {
      for (const k of lookupKeys) {
        const list = otcCandidatesByName.get(k) || [];
        if (list.length === 1) {
          otcRecord = list[0];
          break;
        }
        if (list.length > 1) {
          otcRecord = list.find(op => arePositionsCompatible(position, op.position)) || list[0];
          break;
        }
      }
    }

    const resolvedOtcId =
      (otcRecord?.otcId && isValidOtcPlayerId(otcRecord.otcId, cleanEspnId) ? String(otcRecord.otcId).trim() : null) ||
      nflOtcId ||
      null;
    const resolvedOtcSlug = otcRecord?.slug || null;
    const pfrId = isValidPfrPlayerId(bestNfl?.pfr_id) ? bestNfl.pfr_id.trim() : null;
    const gsisId = bestNfl?.gsis_id ? String(bestNfl.gsis_id).trim() : null;

    return {
      nflMeta: bestNfl,
      otcRecord,
      gsisId,
      pfrId,
      otcId: resolvedOtcId,
      otcSlug: resolvedOtcSlug,
      espnUrl: buildEspnPlayerUrl(cleanEspnId, fullName),
      pfrUrl: buildPfrPlayerUrl(pfrId),
      otcUrl: buildOtcPlayerUrl({
        otcSlug: resolvedOtcSlug,
        otcId: resolvedOtcId,
        espnId: cleanEspnId,
        playerName: fullName,
        fallbackToTeam: teamAbbr === 'SF' || teamAbbr === 'SFO'
      })
    };
  }

  return {
    resolvePlayer,
    nflByEspnId,
    nflCandidatesByName,
    otcById,
    otcCandidatesByName
  };
}
