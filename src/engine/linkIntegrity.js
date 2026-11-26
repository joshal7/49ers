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

import { ALL_NFL_TEAMS, getActiveTeamConfig, resolveTeamConfig } from '../config/teamRegistry.js';

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
  /^https?:\/\/(?:(?:www\.|m\.)?espn\.com\/(?:fantasy\/|espn\/betting\/)|[^/]+\/(?:mlb|nba|nhl|wnba|mls|golf|tennis|soccer)\/)/i;

const OFF_TOPIC_LEAGUE_FILLER_HEADLINE_REGEX =
  /\b(survivor pool|survivor power rankings|fantasy football d\/st|fantasy spin|fantasy sleepers|fantasy tips|lineup help|waiver wire|trick plays in super bowl history|longest field goals in nfl history|redefine all-time sack list|jay-z['’]?s road to the super bowl|nfl practice squad updates|nfl week \d+ uniforms?|week \d+ uniforms?)\b/i;

const NON_NFL_OTHER_SPORT_HEADLINE_REGEX =
  /\b(warriors|lakers|celtics|nba\b|sf giants|san francisco giants|dodgers|mlb\b|sharks|nhl\b|stanley cup|world series|premier league|champions league|pga tour|ufc\b|wwe\b)\b/i;

const COMMERCIAL_FOOD_RETAIL_BRAND_MENTION_PATTERN =
  '(?:@(?:mountainmikes|papajohns|dominos|littlecaesars|pizzahut|roundtablepizza|jackbox|mcdonalds|wendys|tacobell|dunkindonuts|dunkin|chickfila|wingstop|raisingcanes|chipotletweets|jerseymikes|subway|bojangles|whataburger|culvers|krispykreme|popeyes|sonicdrivein|starbucks|7eleven|wawa|sheetz|doordash|ubereats|instacart|budlight|coorslight|michelobultra|pepsi|cocacola|fanatics|nflshop)\\b|\\b(?:mountain\\s*mike[\'’]?s|papa\\s+john[\'’]?s|domino[\'’]?s|little\\s+caesars|pizza\\s+hut|round\\s+table\\s+pizza|jack\\s+in\\s+the\\s+box|mcdonald[\'’]?s|taco\\s+bell|dunkin[\'’]?|chick-fil-a|wingstop|raising\\s+cane[\'’]?s|jersey\\s+mike[\'’]?s|krispy\\s+kreme|whataburger|bojangles|culver[\'’]?s|doordash|uber\\s+eats|instacart|nfl\\s+shop|fanatics)\\b)';

const PROMO_AD_HARD_TEXT_PATTERNS = [
  // Percentage-off retail/food/merch offers (e.g., "49% off @MountainMikes", "25% off gear")
  /\b\d{1,2}%\s+off\b(?!\s+(?:the\s+(?:snap|ball|line|edge|field|injury|bench|playbook|roster|field\s+goal)|his\s+(?:normal|usual|career|pace)))/i,
  // Dollar-off / Save % / BOGO / Half-off / Free shipping (guards against "$10M off the cap")
  /\b(?:save\s+(?:up\s+to\s+)?(?:\d{1,2}%|\$\d{1,3}(?:\.\d{2})?(?!\s*[mk]\b|\s*(?:million|thousand|cap|salary|dead\s+cap|payroll|space)))|\$\d{1,3}(?:\.\d{2})?\s+off\b(?!\s*(?:the\s+)?(?:cap|salary|payroll|books|dead\s+cap))|\b(?:buy\s+one\s+get\s+one|bogo|half[\s-]off|free\s+shipping)\b)/i,
  // Promo/coupon/discount codes, app redemption, and commercial disclaimer boilerplate
  /\b(?:promo\s+code|coupon\s+code|discount\s+code|offer\s+code|(?:use|enter|with)\s+(?:app\s+)?(?:promo\s+)?code\s+[A-Z0-9]{3,}|redeem\s+(?:in\s+the\s+[\w'’\s]{0,20}app|your\s+(?:free|offer|reward|discount|deal))|(?:valid|available)\s+at\s+participating\s+(?:stores|locations|restaurants)|while\s+supplies\s+last|no\s+purchase\s+necessary|official\s+rules\s+apply|terms\s+(?:&|and)\s+conditions\s+apply)\b/i,
  // Explicit paid sponsorship / advertisement disclosures & hashtags
  /(?:^|[\s([{"'])#(?:ad|sponsored|paidpartnership|partner|promo|sweepstakes|giveaway)\b/i,
  /\b(?:paid\s+partnership\s+with|sponsored\s+(?:post|content|message|tweet|offer|promotion)|this\s+is\s+an?\s+(?:paid\s+)?advertisement)\b/i,
  // Sportsbook / DFS sign-up & deposit bonus ads (preserves normal betting-line/odds journalism)
  /\b(?:bet\s+\$\d+[\s,]+get\s+\$\d+|bonus\s+bets?|deposit\s+(?:match|bonus)|no\s+sweat\s+first\s+bet|first\s+bet\s+(?:safety\s+net|offer)|risk[\s-]free\s+bet|claim\s+your\s+(?:welcome\s+|sign[\s-]?up\s+)?bonus|gambling\s+problem\??\s+call\s+1[\s-]?800|must\s+be\s+21\+|21\+\s+(?:only|and\s+present\s+in)|new\s+(?:users|customers)\s+only)\b/i,
  // Victory / game-day food & beverage sponsor giveaways/deals (all 32 NFL clubs)
  /\b(?:free\s+(?:large\s+|medium\s+|small\s+|regular\s+|\d+-?(?:pc|piece|ct|count)\s+)?(?:pizza|slice|fries|french\s+fries|tacos?|burger|cheeseburger|whopper|big\s+mac|jumbo\s+jack|mcnuggets?|nuggets|chicken\s+sandwich|wings|coffee|iced\s+coffee|donut|doughnut|slurpee|drinks?|soda|sub|sandwich|burrito|queso|chips|pretzel|ice\s+cream|frosty|shake|biscuit|meal|entree|appetizer)|victory\s+(?:tastes\s+better|monday\s+(?:means|deal|offer|special|pizza|coffee|fries|tacos?))|\$\d(?:\.\d{2})?\s+(?:coffee|pizza|taco|burger|fries|wings|donut|sub|sandwich)|(?:win|victory|touchdown|sack|interception|shutout)\s*(?:=|means)\s*(?:free|\d{1,2}%\s+off|\$\d))/i,
  // Commercial CTA directly pairing order/grab/celebrate-with + fast-food/pizza/retail partner
  new RegExp(
    `\\b(?:order|grab|enjoy|claim|get|score|redeem|treat\\s+yourself|fuel\\s+up(?:\\s+for\\s+gameday)?\\s+with|celebrate\\s+(?:the\\s+)?(?:win|victory|gameday|game\\s+day)\\s+with)\\b[\\s\\S]{0,65}${COMMERCIAL_FOOD_RETAIL_BRAND_MENTION_PATTERN}`,
    'i'
  ),
  // Commercial sweepstakes & prize giveaways (excludes charity drives like turkey/toy/coat giveaways)
  /\b(?:sweepstakes|enter\s+(?:now\s+)?(?:to|for\s+(?:a|your)\s+chance\s+to)\s+win|chance\s+to\s+win\s+(?:a\s+|two\s+|free\s+|vip\s+)?(?:tickets?|trip|jersey|signed|autographed|gift\s+card|suite|passes?|prizes?|merch)|app\s+giveaway|(?:jersey|ticket|merch(?:andise)?|autographed|signed|gift\s+card|cash|prize|gear)\s+giveaway|win\s+(?:two\s+|free\s+|vip\s+)?(?:tickets?\s+to|a\s+signed\s+|an?\s+autographed\s+|sideline\s+passes?|a\s+vip\s+trip))\b/i,
  // Box-office ticket sales & Team Store / Pro Shop / merch sales CTAs
  /\b(?:tickets?\b[\s\S]{0,60}\b(?:set\s+to\s+go\s+on\s+sale|go(?:ing)?\s+on\s+sale|on\s+sale\s+(?:now|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|available\s+now)|single[\s-]game\s+tickets?\s+(?:on\s+sale|available)|(?:get|buy|grab|secure|claim)\s+your\s+(?:tickets?|seats?|gear|merch|jerseys?|hoodie|hat|apparel)\s+(?:now|today|here|at)|shop\s+(?:now|today|the\s+(?:new|latest|official)?\s*[\w'’\s]{0,24}(?:collection|line|gear|merch|jerseys?|apparel|drop))|available\s+now\s+at\s+(?:the\s+)?(?:team\s+store|pro\s+shop|nfl\s+shop|fanatics|shop\.)|(?:visit|check\s+out)\s+the\s+(?:team\s+store|pro\s+shop|nfl\s+shop)|new\s+merch\s+drop|limited[\s-]edition\s+(?:merch|collection|drop|jersey|hat|tee)\s+(?:available|out\s+now|shop)|season\s+ticket\s+(?:waitlist|memberships?\s+available|deposits?)|suite\s+rentals?\s+available)\b/i,
  // Corporate advertorial spotlights & app-download promos
  /\b(?:small\s+business\s+(?:all-pros?|spotlight|of\s+the\s+(?:week|game|month)|winner)|foodie\s+passport|credit\s+card\s+(?:offer|bonus|points|rewards)|open\s+an?\s+(?:account|card)\s+(?:today|now)|download\s+the\s+(?:official\s+)?[\w'’\s]{0,20}app\s+(?:today|now)\s+(?:to|for))\b/i
];

const PROMO_AD_LEAD_ONLY_PATTERNS = [
  // Official sponsor tagline when it is the headline/tweet itself (not a football video summary trailer)
  /\b(?:official\s+(?:pizza|beer|airline|wireless|bank|vehicle|truck|coffee|burger|taco|wings|sportsbook|casino|hotel|grocery|retailer|tire|insurance|partner|sponsor)\s+of\s+the\b|proud\s+(?:partner|sponsor)\s+of\s+the\b)/i,
  // Short social shoutout pairing a food/pizza/delivery brand handle with a food/drink emoji
  new RegExp(`${COMMERCIAL_FOOD_RETAIL_BRAND_MENTION_PATTERN}[\\s\\S]{0,40}[🍕🍔🌮🍟☕🍩🍗🍺🍻🥤]|(?:[🍕🍔🌮🍟☕🍩🍗🍺🍻🥤][\\s\\S]{0,40}${COMMERCIAL_FOOD_RETAIL_BRAND_MENTION_PATTERN})`, 'i')
];

const PROMO_AD_URL_PATTERN =
  /(?:^https?:\/\/(?:www\.)?(?:shop\.[a-z0-9-]+\.com|nflshop\.com|fanatics\.com|ticketmaster\.com|seatgeek\.com|stubhub\.com|vividseats\.com|mountainmikespizza\.com|papajohns\.com|dominos\.com|littlecaesars\.com|draftkings\.com\/promo|fanduel\.com\/promo)(?:\/|$|\?)|\/(?:sweepstakes|app-giveaway|foodie-passport|small-business-(?:all-pros?|spotlight)|promotions\/|single-game-tickets|tickets-on-sale)(?:\/|$|\?))/i;

/**
 * Detects unmistakable commercial advertisements, partner food/drink victory promos
 * (e.g., "49% off @MountainMikes 🍕"), promo codes, commercial giveaways/sweepstakes,
 * ticket/merch store sales CTAs, and sportsbook deposit-bonus ads across all 32 NFL clubs,
 * while preserving genuine football journalism, odds/spreads coverage, and sponsored video shows.
 */
export function isPromotionalAdvertisement(input = {}) {
  if (!input || typeof input !== 'object') return false;
  const title = stripAggregatorBoilerplate(String(input.title || '').trim());
  const fullText = stripAggregatorBoilerplate(String(input.fullText || '').trim());
  const summary = stripAggregatorBoilerplate(String(input.summary || '').trim());
  const urls = [
    input.url,
    input.externalUrl,
    ...(Array.isArray(input.expandedUrls) ? input.expandedUrls : [])
  ]
    .map(u => String(u || '').trim())
    .filter(Boolean);

  for (const u of urls) {
    if (PROMO_AD_URL_PATTERN.test(u)) return true;
  }

  const lead = `${title} ${fullText}`.trim();
  const combined = `${lead} ${summary}`.trim();
  if (!combined) return false;

  for (const rx of PROMO_AD_HARD_TEXT_PATTERNS) {
    if (rx.test(combined)) return true;
  }

  if (lead) {
    for (const rx of PROMO_AD_LEAD_ONLY_PATTERNS) {
      if (rx.test(lead)) return true;
    }
  }

  return false;
}

/**
 * Departed former 49ers coaches who now lead or have led other NFL staffs.
 * Must NEVER be treated as current 49ers relevance triggers on national wire feeds.
 */
export const KNOWN_FORMER_49ERS_COACHES = [
  'Robert Saleh',
  'DeMeco Ryans',
  'Mike McDaniel',
  'Klint Kubiak',
  'Steve Wilks',
  'Nick Sorensen',
  'Brandon Staley',
  'Bobby Slowik',
  'Brian Griese',
  'Anthony Lynn',
  'Mike LaFleur',
  'Jeff Ulbrich',
  'Gus Bradley',
  'Brian Schneider'
];

const EXPLICIT_SF_ENTITY_REGEX =
  /(?:\b(?:49er|49ers|niners|san francisco|santa clara|levi['’]?s(?:\s+stadium)?|kyle shanahan|shanahan|john lynch|raheem morris|klay kubiak|kris kocurek|chris foerster|paraag marathe|jed york)\b|(?:^|[\s([{"',|/-])#(?:49ers|fttb)\b)/i;

const OTHER_NFL_TEAM_LEAD_REGEX =
  /\b(rams|seahawks|cardinals|cowboys|eagles|giants|commanders|bears|lions|packers|vikings|falcons|panthers|saints|buccaneers|bucs|bills|dolphins|patriots|jets|ravens|bengals|browns|steelers|texans|colts|jaguars|jags|titans|broncos|chiefs|raiders|chargers)\b/i;

const OTHER_NFL_TEAM_OR_CITY_PATTERN =
  '(?:rams|seahawks|cardinals|cowboys|eagles|giants|commanders|bears|lions|packers|vikings|falcons|panthers|saints|buccaneers|bucs|bills|dolphins|patriots|pats|jets|ravens|bengals|browns|steelers|texans|colts|jaguars|jags|titans|broncos|chiefs|raiders|chargers|arizona|atlanta|baltimore|buffalo|carolina|chicago|cincinnati|cleveland|dallas|denver|detroit|green\\s+bay|houston|indianapolis|jacksonville|kansas\\s+city|las\\s+vegas|los\\s+angeles|miami|minnesota|new\\s+england|new\\s+orleans|new\\s+york|philadelphia|pittsburgh|seattle|tampa\\s+bay|tennessee|washington)';

const NON_49ERS_STAFF_ROLE_PATTERN =
  '(?:head\\s+coach|interim\\s+(?:head\\s+)?coach|coach|hc|offensive\\s+coordinator|oc|defensive\\s+coordinator|dc|special\\s+teams\\s+coordinator|stc|general\\s+manager|gm|assistant(?:\\s+coach)?|coordinator|quarterbacks?\\s+coach|linebackers?\\s+coach|defensive\\s+line\\s+coach|offensive\\s+line\\s+coach|pass\\s+game\\s+coordinator|run\\s+game\\s+coordinator)';

const OTHER_TEAM_STAFF_ATTRIBUTION_REGEX = new RegExp(
  `\\b${OTHER_NFL_TEAM_OR_CITY_PATTERN}(?:['’]s?)?\\s+${NON_49ERS_STAFF_ROLE_PATTERN}\\s+([A-Za-z][A-Za-z'.-]+(?:\\s+[A-Za-z][A-Za-z'.-]+)?)\\b`,
  'gi'
);

const PERSON_OTHER_TEAM_APPOSITIVE_REGEX = new RegExp(
  `\\b([A-Za-z][A-Za-z'.-]+(?:\\s+[A-Za-z][A-Za-z'.-]+)?),\\s+(?:the\\s+)?${OTHER_NFL_TEAM_OR_CITY_PATTERN}(?:['’]s?)?\\s+${NON_49ERS_STAFF_ROLE_PATTERN}\\b`,
  'gi'
);

const FORMER_SF_PREFIX_REGEX =
  /\b(?:former|ex[-\s])\s*(?:san\s+francisco\s+)?(?:49ers|niners)(?:\s+(?:hc|oc|dc|gm|head\s+coach|assistant|coach|coordinator|qb|rb|fb|wr|te|ol|dl|lb|cb|db|de|dt|s|k|p|ls|exec|executive|scout))?\b/gi;

const CONFLICTING_LEADERSHIP_NAMES_REGEX =
  /\b(?:mike\s+shanahan|klint\s+kubiak|gary\s+kubiak|marshawn\s+lynch|paxton\s+lynch)\b/gi;

const HISTORICAL_SF_BIO_SENTENCE_REGEX =
  /\b(originally signed (?:on )?with (?:the )?(?:49ers|san francisco|niners)|(?:was )?(?:selected|drafted|taken) [\s\S]{0,55}by (?:the )?(?:49ers|san francisco|niners)|began (?:his|their) (?:nfl )?career with (?:the )?(?:49ers|san francisco|niners)|spent (?:time|his rookie|the \d{4} season|\d+ seasons?) with (?:the )?(?:49ers|san francisco|niners)|played (?:for|with) (?:the )?(?:49ers|san francisco|niners) (?:from|in) 20(?:0\d|1\d|2[0-4])|stint with (?:the )?(?:49ers|san francisco|niners)|entered the nfl [\s\S]{0,45}(?:49ers|san francisco|niners)|signed on with (?:the )?(?:49ers|san francisco|niners) as an undrafted|undrafted free agent [\s\S]{0,50}(?:49ers|san francisco|niners))\b/i;

/**
 * Canonical single-source-of-truth set of common English words and common NFL surnames
 * that MUST NOT trigger bare standalone-surname player matching (require full name or
 * position/injury context like `LS Weeks` or `West (knee)`).
 */
export const AMBIGUOUS_PLAYER_SURNAMES = new Set([
  // Common English words, time units, directions, colors, football/body nouns & verbs
  'weeks',
  'week',
  'days',
  'day',
  'months',
  'years',
  'height',
  'weight',
  'stout',
  'farmer',
  'wallow',
  'cooks',
  'cook',
  'west',
  'east',
  'north',
  'south',
  'long',
  'short',
  'high',
  'lowe',
  'strong',
  'swift',
  'smart',
  'hardy',
  'wild',
  'wise',
  'free',
  'rich',
  'good',
  'best',
  'gross',
  'cross',
  'field',
  'fields',
  'love',
  'price',
  'miles',
  'stone',
  'wood',
  'park',
  'hill',
  'hall',
  'king',
  'bell',
  'ford',
  'grant',
  'reed',
  'ward',
  'camp',
  'team',
  'play',
  'plays',
  'pass',
  'rush',
  'kick',
  'punt',
  'snap',
  'line',
  'back',
  'hurt',
  'hurts',
  'burns',
  'chase',
  'hunt',
  'picks',
  'banks',
  'bridges',
  'white',
  'black',
  'green',
  'brown',
  'gray',
  'grey',
  'blue',
  'gold',
  'young',
  'forrest',
  // Common NFL & English surnames (and first-name collisions)
  'allen',
  'anderson',
  'baker',
  'barnes',
  'beal',
  'bennett',
  'brooks',
  'bryant',
  'butler',
  'campbell',
  'carr',
  'carter',
  'clark',
  'colby',
  'cole',
  'collins',
  'cooper',
  'cruz',
  'davis',
  'dugger',
  'edwards',
  'evans',
  'farrell',
  'fehoko',
  'foster',
  'graham',
  'griffin',
  'grimes',
  'harris',
  'hayes',
  'henderson',
  'hobbs',
  'hodge',
  'howard',
  'hughes',
  'jackson',
  'james',
  'jenkins',
  'johnson',
  'jones',
  'kamara',
  'kareem',
  'kelly',
  'kirk',
  'lewis',
  'martin',
  'mason',
  'mccormick',
  'miller',
  'mitchell',
  'moore',
  'morris',
  'murphy',
  'myers',
  'neal',
  'parker',
  'patterson',
  'perry',
  'phillips',
  'powell',
  'rivera',
  'roberts',
  'robinson',
  'rogers',
  'ross',
  'rourke',
  'russell',
  'samuel',
  'sanders',
  'scott',
  'simmons',
  'smith',
  'stewart',
  'stroman',
  'taylor',
  'thomas',
  'thompson',
  'turner',
  'valdez',
  'walker',
  'washington',
  'watkins',
  'watson',
  'williams',
  'willis',
  'wilson',
  'wright'
]);

const POS_GROUP_COMPAT_MAP = {
  qb: 'QB',
  rb: 'RB',
  fb: 'RB',
  wr: 'WR',
  te: 'TE',
  lt: 'OL',
  lg: 'OL',
  c: 'OL',
  rg: 'OL',
  rt: 'OL',
  ot: 'OL',
  og: 'OL',
  ol: 'OL',
  t: 'OL',
  g: 'OL',
  dt: 'DL',
  de: 'DL',
  dl: 'DL',
  nt: 'DL',
  edge: 'DL',
  lb: 'LB',
  ilb: 'LB',
  olb: 'LB',
  mlb: 'LB',
  cb: 'DB',
  nb: 'DB',
  db: 'DB',
  s: 'DB',
  fs: 'DB',
  ss: 'DB',
  saf: 'DB',
  k: 'ST',
  pk: 'ST',
  p: 'ST',
  ls: 'ST'
};

export function isCompatiblePositionToken(posToken = '', playerPosition = '') {
  const g1 = POS_GROUP_COMPAT_MAP[String(posToken || '').toLowerCase().replace(/s$/, '')];
  const g2 = POS_GROUP_COMPAT_MAP[String(playerPosition || '').toLowerCase()];
  if (!g1 || !g2) return true;
  if (g1 === g2) return true;
  if (
    (g1 === 'LB' && String(playerPosition || '').toUpperCase() === 'DE') ||
    (g1 === 'DL' && String(playerPosition || '').toUpperCase() === 'OLB')
  ) {
    return true;
  }
  return false;
}

const NON_FIRST_NAME_PREFIXES = new Set([
  'qb', 'qbs', 'rb', 'rbs', 'fb', 'fbs', 'wr', 'wrs', 'te', 'tes',
  'lt', 'lg', 'c', 'rg', 'rt', 'ot', 'ots', 'og', 'ogs', 'ol',
  'dt', 'dts', 'de', 'des', 'dl', 'dls', 'nt', 'nts', 'edge',
  'lb', 'lbs', 'ilb', 'olb', 'mlb', 'cb', 'cbs', 'nb', 'db', 'dbs', 's', 'fs', 'ss', 'saf', 'safs',
  'k', 'pk', 'p', 'ls',
  'coach', 'per', 'for', 'from', 'with', 'without', 'that', 'while', 'whereas', 'although', 'though',
  'and', 'or', 'but', 'neither', 'either', 'nor', 'both', 'get', 'got', 'have', 'had', 'has', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'to', 'of', 'in', 'on', 'at', 'by', 'as', 'if', 'so', 'the', 'a', 'an',
  'his', 'her', 'their', 'our', 'my', 'your', 'its', 'this', 'these', 'those', 'who', 'what', 'which', 'why',
  'how', 'when', 'where', 'here', 'there', 'also', 'still', 'just', 'only', 'even', 'back', 'now', 'then',
  'expecting', 'expect', 'expects', 'expected', 'said', 'says', 'told', 'thinks', 'believes', 'hopes',
  'veteran', 'veterans', 'rookie', 'rookies', 'starter', 'starters', 'backup', 'fellow', 'pro', 'bowl',
  'wideout', 'wideouts', 'receiver', 'receivers', 'corner', 'corners', 'cornerback', 'cornerbacks',
  'tackle', 'tackles', 'guard', 'guards', 'center', 'linebacker', 'linebackers', 'safety', 'safeties',
  'defender', 'defenders', 'lineman', 'linemen', 'rusher', 'backs', 'end', 'ends', 'kicker', 'punter',
  'missing', 'limited', 'full', 'not', 'no', 'after', 'before', 'since', 'until', 'against', 'versus', 'vs',
  'over', 'under', 'around', 'behind', 'between', 'through', 'into', 'onto', 'off', 'out', 'up', 'down',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'today', 'yesterday', 'tomorrow', 'practice', 'status', 'update', 'report', 'notes', 'news',
  'niners', 'francisco', 'san', '49ers', 'nfl', 'nfc', 'afc', 'watch', 'see', 'look', 'like', 'than',
  'including', 'featuring', 'minus', 'plus', 'keep', 'keeps', 'keeping', 'made', 'make', 'makes',
  'signed', 'waived', 'traded', 'acquired', 'activated', 'designated', 'placed', 'released', 'named',
  'called', 'asked', 'gives', 'gave', 'takes', 'took', 'puts', 'put', 'sets', 'set', 'leads', 'led',
  'hits', 'hit', 'finds', 'found', 'gets', 'sees', 'saw', 'wants', 'needs', 'uses', 'used'
]);

const QUANTIFIER_BEFORE_WORD_REGEX =
  /(?:\b\d+(?:\s*[-–to]+\s*\d+)?|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|several|multiple|couple|few|many|next|last|past|recent|coming|early|late|final|first|second|third|fourth|fifth|more|extra)\s+(?:to\s+(?:two|three|four|five|six|seven|eight|nine|ten)\s+)?)$/i;

/**
 * Verifies that at least one bare standalone occurrence of `surname` in `rawText` is NOT
 * preceded by a conflicting capitalized first name (e.g., "Joey Bosa" for Nick Bosa,
 * "Kurt Warner" for Fred Warner) or a numeric/English quantifier (e.g., "4-6 Weeks", "two weeks").
 */
export function hasSafeStandaloneSurnameMatch(rawText = '', surname = '', playerFullName = '') {
  const text = String(rawText || '').replace(/[’‘]/g, "'");
  const cleanSurname = String(surname || '').trim();
  if (!text || cleanSurname.length < 4) return false;
  const escaped = cleanSurname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const targetFirst = String(playerFullName || '')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/\./g, '')
    .toLowerCase() || '';

  const re = new RegExp(`\\b${escaped}\\b`, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 42), m.index);
    const beforeTrim = before.trimEnd();
    if (QUANTIFIER_BEFORE_WORD_REGEX.test(beforeTrim)) {
      continue;
    }
    const prevCap = beforeTrim.match(/(?:^|[\s([{"'/,-])((?:[A-Z]\.){1,3}|[A-Z][a-z'-]{1,18})$/);
    if (prevCap) {
      const prevTok = prevCap[1].replace(/\./g, '').toLowerCase();
      if (
        prevTok &&
        !NON_FIRST_NAME_PREFIXES.has(prevTok) &&
        prevTok !== targetFirst &&
        !(targetFirst.length >= 2 && prevTok.length === 1 && targetFirst.startsWith(prevTok))
      ) {
        continue;
      }
    }
    return true;
  }
  return false;
}

/**
 * Normalizes tweet / Bluesky prose while strictly preserving author carriage returns
 * (`\r\n` / `\r` -> `\n`, max 2 consecutive newlines for paragraph breaks) and collapsing
 * only horizontal whitespace so multi-paragraph social posts render faithfully.
 */
export function normalizeMultilineSocialText(raw = '') {
  const s = String(raw ?? '');
  if (!s) return '';
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v\u00A0]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extracts all unique valid HTTPS image URLs (up to 4) from a Bluesky `post` view,
 * covering `app.bsky.embed.images#view`, `app.bsky.embed.recordWithMedia#view`,
 * and (only when the outer post attaches no own images/video) quoted-post image embeds.
 */
export function extractBlueskyEmbedImages(post = null) {
  if (!post || typeof post !== 'object') return [];
  const out = [];
  const seen = new Set();
  const pushImgList = list => {
    if (!Array.isArray(list)) return;
    for (const img of list) {
      if (out.length >= 4) break;
      const cand = String(img?.fullsize || img?.thumb || '').trim();
      if (!cand || !/^https:\/\//i.test(cand) || seen.has(cand)) continue;
      seen.add(cand);
      out.push(cand);
    }
  };

  pushImgList(post?.embed?.images);
  pushImgList(post?.embed?.media?.images);

  const hasOwnVideo =
    post?.embed?.$type === 'app.bsky.embed.video#view' ||
    post?.embed?.media?.$type === 'app.bsky.embed.video#view' ||
    Boolean(post?.embed?.video);

  if (out.length === 0 && !hasOwnVideo) {
    const quotedEmbeds = [
      ...(Array.isArray(post?.embed?.record?.embeds) ? post.embed.record.embeds : []),
      ...(Array.isArray(post?.embed?.record?.record?.embeds) ? post.embed.record.record.embeds : [])
    ];
    for (const qe of quotedEmbeds) {
      if (out.length >= 4) break;
      pushImgList(qe?.images);
      pushImgList(qe?.media?.images);
    }
  }
  return out;
}

/**
 * Strips WordPress / RSS syndication footers (`The post ... appeared first on NFLTradeRumors.co.`)
 * so aggregator domain names never trigger false trade/roster classifications or relevance hits.
 */
export function stripAggregatorBoilerplate(text = '', { preserveNewlines = false } = {}) {
  const stripped = String(text || '')
    .replace(/\s*The post [\s\S]*? appeared first on [^\n.]+(?:\.[a-z]{2,4})?\.?/gi, '')
    .replace(/\s*appeared first on (?:NFLTradeRumors\.co|Pro Football Rumors|ProFootballRumors\.com)[^.\n]*\.?/gi, '');
  return preserveNewlines ? normalizeMultilineSocialText(stripped) : stripped.replace(/\s+/g, ' ').trim();
}

/**
 * Removes historical career-bio sentences that reference the 49ers solely in a player's distant past
 * (e.g., "Shelton, 31, originally signed on with the 49ers as an undrafted free agent out of Washington
 * back in 2018.") so non-49ers players on other NFL teams do not leak into the 49ers news stream.
 */
export function stripHistoricalSfBioSentences(text = '') {
  const clean = stripAggregatorBoilerplate(text);
  if (!clean) return '';
  const masked = clean
    .replace(/\b([A-Z])\.([A-Z])\./g, '$1\u0000$2\u0000')
    .replace(/\b([A-Z])\.(?=\s+[A-Z])/g, '$1\u0000')
    .replace(/\b(vs|no|st|jr|sr|mr|dr|mt)\./gi, '$1\u0000');
  const kept = masked
    .split(/(?<=[.!?])\s+/)
    .map(s => s.replace(/\u0000/g, '.').trim())
    .filter(s => s && !HISTORICAL_SF_BIO_SENTENCE_REGEX.test(s));
  return kept.join(' ').trim();
}

/**
 * Strips non-49ers entity attributions before checking for explicit 49ers team/leadership signals:
 * - "former 49ers ..." / "ex-49ers ..." references
 * - Conflicting non-49ers family/surname homonyms ("Mike Shanahan", "Klint Kubiak", "Marshawn Lynch")
 * - Other-team staff attributions ("Titans head coach Robert Saleh", "Bears head coach Klay Kubiak",
 *   "Raheem Morris, the Falcons' head coach") so even future coaching departures never leak other-team stories.
 */
export function stripNon49ersEntityContexts(text = '') {
  const raw = String(text || '');
  if (!raw) return '';
  const isLikelyPersonNamePart = candidate => {
    const words = String(candidate || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return false;
    const firstWord = words[0];
    if (!/^[A-Z]/.test(firstWord)) return false;
    const lowerFirst = firstWord.replace(/\./g, '').toLowerCase();
    if (NON_FIRST_NAME_PREFIXES.has(lowerFirst)) return false;
    if (/\b(?:49er|49ers|niners|san\s+francisco)\b/i.test(candidate)) return false;
    return true;
  };
  return raw
    .replace(FORMER_SF_PREFIX_REGEX, ' ')
    .replace(CONFLICTING_LEADERSHIP_NAMES_REGEX, ' ')
    .replace(OTHER_TEAM_STAFF_ATTRIBUTION_REGEX, (fullMatch, namePart) =>
      isLikelyPersonNamePart(namePart) ? ' ' : fullMatch
    )
    .replace(PERSON_OTHER_TEAM_APPOSITIVE_REGEX, (fullMatch, namePart) =>
      isLikelyPersonNamePart(namePart) ? ' ' : fullMatch
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export const TEAM_CANONICAL_HASHTAGS = Object.freeze({
  SF: ['49ers', 'fttb'],
  SEA: ['seahawks', 'gohawks'],
  LAR: ['rams', 'ramshouse'],
  ARI: ['azcardinals', 'birdgang'],
  DET: ['onepride', 'detroitlions'],
  MIN: ['skol', 'vikings'],
  GB: ['gopackgo', 'packers'],
  CHI: ['dabears', 'beardown'],
  PHI: ['flyeaglesfly', 'eagles'],
  DAL: ['dallascowboys', 'cowboysnation'],
  NYG: ['nygiants', 'togetherblue'],
  WAS: ['raisehail', 'httc', 'commanders'],
  TB: ['gobucs', 'wearethekrewe'],
  NO: ['whodat', 'saints'],
  ATL: ['riseup', 'dirtybirds'],
  CAR: ['keeppounding', 'panthers'],
  BUF: ['billsmafia', 'gobills'],
  MIA: ['finsup', 'phinsup'],
  NE: ['nepats', 'foreverne', 'patriots'],
  NYJ: ['takeflight', 'jetup'],
  BAL: ['ravensflock', 'ravens'],
  CIN: ['whodey', 'rulethejungle'],
  CLE: ['dawgpound', 'browns'],
  PIT: ['herewego', 'steelers'],
  HOU: ['htownmade', 'wearetexans'],
  IND: ['fortheshoe', 'colts'],
  JAX: ['duuuval', 'jaguars'],
  TEN: ['titanup', 'titans'],
  DEN: ['broncoscountry', 'broncos'],
  KC: ['chiefskingdom', 'chiefs'],
  LV: ['raidernation', 'raiders'],
  LAC: ['boltup', 'chargers']
});

export const LEAGUE_WIDE_FILM_ANALYTICS_HANDLES = new Set([
  'throwthedamball',
  'ghatz_28',
  'benbbaldwin',
  'fball_insights',
  'sethwalder',
  'pff',
  'pff_moo',
  'collinsworthpff',
  'nextgenstats',
  'sumersports',
  'tejfbanalytics',
  'statsbylopez',
  'baldynfl',
  'brandonthornnfl',
  'fb_filmanalysis',
  'qbklass',
  'danorlovsky7',
  'kurt13warner',
  'nate_tice',
  'benjaminsolak',
  'minakimes',
  'brettkollmann',
  'theqbschool'
]);

const LEAGUE_WIDE_ANALYTICS_CHART_METRIC_RE =
  /\b(epa(?:\/play| per play)?|cpoe|dvoa|separation(?:\s+prevented)?|on[- ]ball\s+grade|coverage\s+efficiency|passer\s+rating(?:\s+allowed)?|yards\s*(?:\/|per)\s*(?:target|att|attempt|route|play)|yprr|adot|ryoe|pbwr|prwr|rswr|pressure\s+rate|pass[- ]rush\s+win\s+rate|pass[- ]block\s+win\s+rate|run[- ]block\s+win\s+rate|pff\s+grade|offensive\s+grade|defensive\s+grade|coverage\s+grade|rushing\s+grade|blocking\s+grade|success\s+rate|blitz\s+rate|man\s+vs\.?\s+zone|motion\s+rate|play[- ]action|explosive\s+play|dropbacks?|all\s+routes|min\.?\s+\d+\s+(?:snaps|targets|dropbacks|routes)|snap\s+share|percentile)\b/i;

const ANALYTICS_CHART_IMAGE_HOST_RE =
  /^https:\/\/(?:pbs\.twimg\.com\/media\/|cdn\.bsky\.app\/img\/)/i;

const TEAM_WIRE_REGEX_CACHE = new Map();

function escapeLinkRegex(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getTeamWireMatchers(team = null) {
  const active = team || getActiveTeamConfig();
  if (!active || active.abbr === 'SF') {
    return {
      isSf: true,
      explicitEntityRe: EXPLICIT_SF_ENTITY_REGEX,
      otherTeamsRe: OTHER_NFL_TEAM_LEAD_REGEX,
      teamShortRe: /\b(49ers|niners|san francisco)\b/i
    };
  }
  const cacheKey = active.abbr;
  if (TEAM_WIRE_REGEX_CACHE.has(cacheKey)) return TEAM_WIRE_REGEX_CACHE.get(cacheKey);
  const includeCity = !active.keywordRules?.excludeGenericCity;
  const nickList = Array.isArray(active.keywordRules?.requiredNicknames) && active.keywordRules.requiredNicknames.length > 0
    ? active.keywordRules.requiredNicknames
    : [active.nickname];
  const tokens = new Set([
    active.fullName,
    ...nickList,
    ...(includeCity ? [active.city] : []),
    active.clubDomain,
    active.coachesSeed?.hc,
    active.coachesSeed?.gm,
    active.stadium
  ].filter(Boolean).map(t => escapeLinkRegex(String(t).trim())));
  const hashtags = (TEAM_CANONICAL_HASHTAGS[active.abbr] || [])
    .map(h => escapeLinkRegex(String(h).replace(/^#/, '').trim()))
    .filter(Boolean);
  const hashtagPart = hashtags.length > 0 ? `|(?:^|[\\s([{"',|/-])#(?:${hashtags.join('|')})\\b` : '';
  const explicitEntityRe = new RegExp(`(?:\\b(?:${[...tokens].join('|')})\\b${hashtagPart})`, 'i');
  const shortParts = [active.fullName, ...nickList, ...(includeCity ? [active.city] : [])].filter(Boolean);
  const teamShortRe = new RegExp(
    `\\b(${shortParts.map(t => escapeLinkRegex(t)).join('|')})\\b`,
    'i'
  );
  const otherTokens = [];
  for (const t of ALL_NFL_TEAMS) {
    if (t.abbr === active.abbr) continue;
    otherTokens.push(escapeLinkRegex(t.nickname));
    if (t.abbr === 'SF') otherTokens.push('niners');
  }
  const otherTeamsRe = new RegExp(`\\b(${otherTokens.join('|')})\\b`, 'i');
  const activeNickCityPat = [active.fullName, active.nickname, active.city].filter(Boolean).map(t => escapeLinkRegex(t)).join('|');
  const formerTeamPrefixRe = new RegExp(
    `\\b(?:former|ex[-\\s])\\s*(?:${activeNickCityPat})(?:\\s+(?:hc|oc|dc|gm|head\\s+coach|assistant|coach|coordinator|qb|rb|fb|wr|te|ol|dl|lb|cb|db|de|dt|s|k|p|ls|exec|executive|scout))?\\b`,
    'gi'
  );
  const historicalBioRe = new RegExp(
    `\\b(originally signed (?:on )?with (?:the )?(?:${activeNickCityPat})|(?:was )?(?:selected|drafted|taken) [\\s\\S]{0,55}by (?:the )?(?:${activeNickCityPat})|began (?:his|their) (?:nfl )?career with (?:the )?(?:${activeNickCityPat})|spent (?:time|his rookie|the \\d{4} season|\\d+ seasons?) with (?:the )?(?:${activeNickCityPat})|stint with (?:the )?(?:${activeNickCityPat}))\\b`,
    'i'
  );
  const built = { isSf: false, explicitEntityRe, otherTeamsRe, teamShortRe, formerTeamPrefixRe, historicalBioRe };
  TEAM_WIRE_REGEX_CACHE.set(cacheKey, built);
  return built;
}

/**
 * Returns true if `text` contains a verified, non-former, non-other-team-attributed
 * active franchise or current leadership reference (SF or any active multi-team club).
 */
export function hasExplicit49ersEntity(text = '') {
  const matchers = getTeamWireMatchers();
  if (matchers.isSf) {
    const cleaned = stripNon49ersEntityContexts(stripAggregatorBoilerplate(text));
    if (!cleaned) return false;
    return EXPLICIT_SF_ENTITY_REGEX.test(cleaned);
  }
  const cleaned = stripAggregatorBoilerplate(text).replace(matchers.formerTeamPrefixRe, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return false;
  return matchers.explicitEntityRe.test(cleaned);
}

/**
 * Determines whether a national/league-wide wire item is genuinely relevant to the active team.
 * Prevents other-team stories from leaking in via boilerplate historical career-bio mentions,
 * departed coaches, or body-only other-team framing.
 */
export function is49ersRelevantWireItem({
  title = '',
  fullText = '',
  summary = '',
  externalTitle = '',
  externalDescription = '',
  isNationalFeed = true,
  leadRosterMatchCount = 0,
  bodyRosterMatchCount = 0
} = {}) {
  if (!isNationalFeed) return true;
  const matchers = getTeamWireMatchers();
  const leadText = stripAggregatorBoilerplate(`${title || ''} ${fullText || ''}`).trim();
  const leadClean = matchers.isSf
    ? stripNon49ersEntityContexts(leadText)
    : leadText.replace(matchers.formerTeamPrefixRe, ' ').replace(/\s+/g, ' ').trim();
  if (matchers.explicitEntityRe.test(leadClean)) {
    return true;
  }
  if (Number(leadRosterMatchCount) > 0) {
    return true;
  }
  if (matchers.otherTeamsRe.test(leadText)) {
    return false;
  }
  const rawBody = `${externalTitle || ''} ${summary || ''} ${externalDescription || ''}`;
  const cleanBody = matchers.isSf
    ? stripHistoricalSfBioSentences(rawBody)
    : rawBody
        .split(/(?<=[.!?])\s+/)
        .filter(s => s && !matchers.historicalBioRe.test(s))
        .join(' ')
        .trim();
  const bodyClean = matchers.isSf
    ? stripNon49ersEntityContexts(cleanBody)
    : cleanBody.replace(matchers.formerTeamPrefixRe, ' ').replace(/\s+/g, ' ').trim();
  if (matchers.explicitEntityRe.test(bodyClean)) {
    return true;
  }
  if (matchers.otherTeamsRe.test(cleanBody)) {
    return false;
  }
  return Number(bodyRosterMatchCount) > 0;
}

/**
 * Formats ambiguous aggregator publisher names as explicit web domains (`NFLTradeRumors.co`,
 * `ProFootballRumors.com`) and recovers true video/channel creator names (`item.channel` /
 * `item.outletName` / `item.reporterName`) whenever `authorName` fell back to generic `"<Team> Beat"`.
 */
export function formatWireSourceDisplayName(authorName = '', item = null) {
  const active = getActiveTeamConfig();
  const defaultBeat = `${active?.nickname || '49ers'} Beat`;
  const isGenericBeat = v => {
    const s = String(v || '').trim().toLowerCase();
    return !s || s === defaultBeat.toLowerCase() || s === '49ers beat' || s === 'nfl beat';
  };
  const candidates = [authorName, item?.author, item?.reporterName, item?.channel, item?.outletName];
  const nonGeneric = candidates.map(v => String(v || '').trim()).find(v => !isGenericBeat(v));
  const raw = nonGeneric || String(authorName || item?.author || item?.reporterName || item?.channel || item?.outletName || defaultBeat).trim();
  const lower = raw.toLowerCase();
  if (lower === 'nfl trade rumors' || lower === 'nfltraderumors') return 'NFLTradeRumors.co';
  if (lower === 'pro football rumors' || lower === 'profootballrumors') return 'ProFootballRumors.com';
  return raw || defaultBeat;
}

const COMMERCIAL_FANTASY_BETTING_URL_RE =
  /\/(?:news\/(?:bet-|fantasy-|free-pff-mock-draft-simulator)|fantasy\/|betting\/|sportsbook\/|odds\/|picks-and-predictions\/)/i;

const COMMERCIAL_FANTASY_BETTING_TEXT_RE =
  /\b(same[- ]game\s+parlay|best\s+bets?|prop\s+bets?|player\s+props?|against\s+the\s+spread|ats\s+picks?|moneyline\s+picks?|betting\s+odds|betting\s+picks?|parlay\s+picks?|fantasy\s+football|fantasy\s+worksheet|fantasy\s+rankings?|fantasy\s+sleepers?|fantasy\s+spin|fantasy\s+tips|fantasy\s+start|start\/sit|start-worthy|waiver\s+wire|lineup\s+help|survivor\s+pool|mock\s+draft\s+simulator|unlock\s+the\s+full\s+pff|draftsgiving|promo\s+code|sign[- ]?up\s+bonus)\b/i;

/**
 * Unconditionally identifies commercial betting/parlay, fantasy football, and SaaS tool-promo
 * filler even when an active team's name appears in the headline (e.g. PFF same-game parlays
 * or fantasy worksheets). Single source of truth across pipeline & client filters.
 */
export function isCommercialFantasyOrBettingFiller(title = '', summary = '', url = '') {
  const u = String(url || '').trim();
  if (u && COMMERCIAL_FANTASY_BETTING_URL_RE.test(u)) return true;
  const combined = `${String(title || '').trim()} ${String(summary || '').trim()}`.trim();
  if (!combined) return false;
  return COMMERCIAL_FANTASY_BETTING_TEXT_RE.test(combined);
}

const SUBSTACK_PAYWALL_MARKER_RE =
  /\b(this\s+post\s+is\s+for\s+paid\s+subscribers|for\s+paid\s+subscribers\s+only|subscribe\s+to\s+(?:continue\s+reading|read\s+the\s+full)|upgrade\s+to\s+paid|become\s+a\s+paid\s+subscriber|paid\s+subscribers\s+get\s+access)\b/i;

/**
 * Per-entry paywall gate for mixed free/paid Substack and newsletter RSS feeds
 * (e.g. Unexpected Points, Coach Dan Casey). Rejects paid-subscriber stubs so users
 * never click into a paywall, while admitting genuinely free full-length analytical posts.
 */
export function isPaywalledSubstackOrNewsletterEntry(rssItemXml = '', contentEncoded = '', { minFreeChars = 1800 } = {}) {
  const rawXml = String(rssItemXml || '');
  const rawContent = String(contentEncoded || '');
  if (SUBSTACK_PAYWALL_MARKER_RE.test(rawXml) || SUBSTACK_PAYWALL_MARKER_RE.test(rawContent)) {
    return true;
  }
  const stripped = rawContent
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (rawContent && stripped.length < minFreeChars) {
    // Short Substack RSS excerpts without full body are almost always paywalled previews or stub pod notes
    if (/substack\.com|unexpectedpoints\.com|matchquarters\.com/i.test(rawXml) && /\b(subscribe|read more|paid|pod|episode)\b/i.test(stripped)) {
      return true;
    }
    if (stripped.length < 700) return true;
  }
  return false;
}

/**
 * Identifies generic league-wide filler (fantasy D/ST, survivor pools, betting lines roundups,
 * uniform/arrival slideshows, non-team transactions) that should not pollute the team news stream.
 */
export function isOffTopicLeagueFiller({
  url = '',
  title = '',
  summary = '',
  hasRosterMatch = false,
  isDedicatedTeamBeat = false
} = {}) {
  const matchers = getTeamWireMatchers();
  const u = String(url || '').trim();
  const t = stripAggregatorBoilerplate(String(title || '').trim());
  const s = matchers.isSf ? stripHistoricalSfBioSentences(String(summary || '').trim()) : String(summary || '').trim();
  if (u && OFF_TOPIC_LEAGUE_FILLER_URL_REGEX.test(u)) return true;
  if (isPromotionalAdvertisement({ url: u, title: t, summary: s })) return true;
  if (isCommercialFantasyOrBettingFiller(t, s, u)) return true;
  if (OFF_TOPIC_LEAGUE_FILLER_HEADLINE_REGEX.test(t)) return true;
  if (/\b(fantasy|lineup help|sleepers|waiver wire|d\/st)\b/i.test(t) && !matchers.teamShortRe.test(t)) {
    return true;
  }
  const combinedClean = matchers.isSf ? stripNon49ersEntityContexts(`${t} ${s}`) : `${t} ${s}`;
  if (isDedicatedTeamBeat) {
    // Dedicated team beat writers frequently tweet game-day crowd/warmup/locker-room color without repeating "#49ers"
    if (NON_NFL_OTHER_SPORT_HEADLINE_REGEX.test(t) && !matchers.explicitEntityRe.test(combinedClean) && !hasRosterMatch) {
      return true;
    }
    return false;
  }
  if (!hasRosterMatch && !matchers.explicitEntityRe.test(combinedClean)) {
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
  /(^|\.)(x\.com|twitter\.com|bsky\.app|espn\.com|rotowire\.com|49ers\.com|nfl\.com|azcardinals\.com|atlantafalcons\.com|baltimoreravens\.com|buffalobills\.com|panthers\.com|chicagobears\.com|bengals\.com|clevelandbrowns\.com|dallascowboys\.com|denverbroncos\.com|detroitlions\.com|packers\.com|houstontexans\.com|colts\.com|jaguars\.com|chiefs\.com|chargers\.com|therams\.com|raiders\.com|miamidolphins\.com|vikings\.com|patriots\.com|neworleanssaints\.com|giants\.com|newyorkjets\.com|philadelphiaeagles\.com|steelers\.com|seahawks\.com|buccaneers\.com|tennesseetitans\.com|commanders\.com|youtube\.com|youtu\.be|nbcsportsbayarea\.com|sfstandard\.com|ninersnation\.com|49erswebzone\.com|profootballrumors\.com|nfltraderumors\.co|cbssports\.com|overthecap\.com|pro-football-reference\.com|tankathon\.com|drafttek\.com|walterfootball\.com|bleacherreport\.com|si\.com|yahoo\.com|thegamehaus\.com|wideleft\.football|nflmockdraftdatabase\.com|matchquarters\.com|unexpectedpoints\.com|coachdancasey\.substack\.com|pff\.com)$/i;

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
 * Sanitizes a URL explicitly linked inside a beat reporter's tweet text (e.g., an inline
 * NYTimes/The Athletic gift or beat article link, Spotify/Apple Podcasts episode, or ESPN story).
 * Enforces HTTPS, strips marketing tracking params (while preserving `unlocked_article_code`),
 * and blocks malformed, broken-path, or opaque-shortener URLs without blocking publisher URLs
 * that the journalist already posted in their tweet.
 */
export function sanitizeTweetInlineLinkUrl(rawUrl, fallbackUrl = null) {
  if (typeof rawUrl !== 'string') return fallbackUrl;
  const trimmed = rawUrl.trim();
  if (!trimmed) return fallbackUrl;
  if (/(^|\/)(undefined|null|NaN)(\/|$|\?)/i.test(trimmed)) return fallbackUrl;

  const httpsUrl = trimmed.startsWith('http://') ? `https://${trimmed.slice(7)}` : trimmed;
  const collapsedSlashes = httpsUrl.replace(/^(https:\/\/[^/?#]+)\/\/+/i, '$1/');
  const upgraded = stripTrackingParams(collapsedSlashes);

  let parsed;
  try {
    parsed = new URL(upgraded);
  } catch {
    return fallbackUrl;
  }
  if (parsed.protocol !== 'https:') return fallbackUrl;
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname || '/';
  if (!host || !host.includes('.') || /^(?:localhost|127\.|0\.0\.0\.0)/.test(host)) return fallbackUrl;
  if (OPAQUE_URL_SHORTENER_HOST_REGEX.test(host)) return fallbackUrl;
  for (const broken of KNOWN_BROKEN_PATH_RULES) {
    if (broken.host.test(host) && broken.path.test(pathname)) {
      return fallbackUrl;
    }
  }
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

export function buildOtcPlayerUrl({
  otcSlug = null,
  otcId = null,
  espnId = null,
  playerName = '',
  fallbackToTeam = true,
  teamSlug = null
} = {}) {
  if (isValidOtcPlayerId(otcId, espnId)) {
    const slug = (otcSlug && String(otcSlug).trim()) || slugifyPlayerName(playerName);
    if (slug) {
      return `https://overthecap.com/player/${slug}/${String(otcId).trim()}/`;
    }
  }
  if (!fallbackToTeam) return null;
  const resolvedSlug = String(teamSlug || getActiveTeamConfig()?.otcSlug || 'san-francisco-49ers').trim();
  return `https://overthecap.com/salary-cap/${resolvedSlug}`;
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

export function buildMockDraftTeamUrl(draftYear = 2027, teamSlug = null) {
  const yr = Number(draftYear) || new Date().getFullYear() + 1;
  const slug = String(teamSlug || getActiveTeamConfig()?.otcSlug || 'san-francisco-49ers').trim();
  return `https://www.nflmockdraftdatabase.com/teams/${yr}/${slug}`;
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
        fallbackToTeam: true,
        teamSlug: resolveTeamConfig(teamAbbr || getActiveTeamConfig())?.otcSlug
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

/**
 * Identifies genuine league-wide NFL on-field analytics/grading charts (e.g. `@throwthedamball`
 * "CB Separation prevented on all routes and on ball grade" scatter plot covering all 32 teams)
 * so they can be included in `Film & Trench` across all 32 team sites without polluting `All`/`Tweets`
 * or leaking single-other-team stories, fantasy filler, or promotional ads.
 */
export function isLeagueWideFilmAnalyticsTweet(item = {}, teamInput = null) {
  if (!item || typeof item !== 'object') return false;
  const text = stripAggregatorBoilerplate(
    `${item.title || ''} ${item.fullText || ''} ${item.summary || ''}`.trim()
  );
  if (!text || text.length < 10) return false;
  if (isPromotionalAdvertisement(item)) return false;
  if (OFF_TOPIC_LEAGUE_FILLER_HEADLINE_REGEX.test(text) || NON_NFL_OTHER_SPORT_HEADLINE_REGEX.test(text)) {
    return false;
  }
  if (isCommercialFantasyOrBettingFiller(text, '', item.url || '')) {
    return false;
  }

  const handleClean = String(item.authorHandle || '').replace(/^@/, '').trim().toLowerCase();
  const isVerifiedAnalyticsCreator =
    LEAGUE_WIDE_FILM_ANALYTICS_HANDLES.has(handleClean) ||
    Boolean(item.isVerifiedAnalyticsCreator);
  if (!isVerifiedAnalyticsCreator) return false;

  const imgUrl = String(item.imageUrl || '').trim();
  const hasChartMedia = ANALYTICS_CHART_IMAGE_HOST_RE.test(imgUrl) || Boolean(item.videoStreamUrl);
  if (!hasChartMedia) return false;

  const metricHits = text.match(new RegExp(LEAGUE_WIDE_ANALYTICS_CHART_METRIC_RE.source, 'gi')) || [];
  if (metricHits.length === 0) return false;

  // Reject single-other-team-only posts (if another NFL team is named in the text without mentioning the active team,
  // unless multiple teams are tagged like "#FTTB #GoPackGo #Skol" where the active team would already match directly).
  const matchers = getTeamWireMatchers(teamInput);
  if (matchers.otherTeamsRe.test(text) && !matchers.explicitEntityRe.test(text)) {
    return false;
  }

  return true;
}

export const ALLOWED_INLINE_VIDEO_STREAM_HOST_RE =
  /^(?:video\.twimg\.com|espnmedia-cdn\.akamaized\.net|media\.video-cdn\.espn\.com|media\.tenor\.com|c\.tenor\.com|video\.bsky\.app)$/i;

export function isAllowedInlineVideoStreamUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:') return false;
    if (ALLOWED_INLINE_VIDEO_STREAM_HOST_RE.test(parsed.hostname)) return true;
    // Allow official ATProto Bluesky direct video/mp4 blobs (`com.atproto.sync.getBlob`)
    if (/^bsky\.social$/i.test(parsed.hostname) && parsed.pathname === '/xrpc/com.atproto.sync.getBlob') {
      return Boolean(parsed.searchParams.get('did') && parsed.searchParams.get('cid'));
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Extracts normalized video, animated GIF, poster, and high-res photo metadata from an X
 * `tweet-result` syndication object. Preserves `isAnimatedGif: true` for X GIF clips
 * (`mediaDetails[].type === 'animated_gif'` or `video.twimg.com/tweet_video/*.mp4`) so they
 * play & loop inline directly in the app instead of getting dropped for having `durationMs === 0`.
 */
export function extractXSyndicationMedia(syn) {
  if (!syn || typeof syn !== 'object') {
    return {
      mp4Url: '',
      isAnimatedGif: false,
      durationMs: 0,
      posterUrl: '',
      imageUrl: '',
      imageUrls: [],
      isPhoto: false
    };
  }
  const mp4Url = selectBestXSyndicationMp4(syn);
  const mediaDetails = Array.isArray(syn.mediaDetails) ? syn.mediaDetails : [];
  const gifMedia = mediaDetails.find(m => m?.type === 'animated_gif');
  const vidMedia = mediaDetails.find(m => m?.type === 'video' || m?.type === 'animated_gif');
  const isAnimatedGif = Boolean(
    mp4Url &&
      (Boolean(gifMedia) ||
        String(syn?.video?.contentType || '').toLowerCase() === 'gif' ||
        /\/tweet_video\//i.test(mp4Url))
  );
  const durationMs = Number(
    syn.video?.durationMs || vidMedia?.video_info?.duration_millis || mediaDetails[0]?.video_info?.duration_millis || 0
  );
  const posterUrl = String(
    vidMedia?.media_url_https || syn.video?.poster || mediaDetails[0]?.media_url_https || ''
  ).trim();

  const photoUrls = [];
  const seenPhotos = new Set();
  const pushPhoto = raw => {
    const clean = String(raw || '').trim();
    if (!clean || !clean.startsWith('https://') || seenPhotos.has(clean) || photoUrls.length >= 4) return;
    seenPhotos.add(clean);
    photoUrls.push(clean);
  };
  if (Array.isArray(syn.photos)) {
    for (const p of syn.photos) pushPhoto(p?.url);
  }
  for (const m of mediaDetails) {
    if (m?.type === 'photo') pushPhoto(m?.media_url_https);
  }

  const photoUrl = photoUrls[0] || '';
  const imageUrl = (mp4Url ? posterUrl || photoUrl : photoUrl || posterUrl) || '';
  const distinctPhotoUrls = mp4Url ? photoUrls.filter(u => u !== posterUrl) : photoUrls;
  return {
    mp4Url,
    isAnimatedGif,
    durationMs: Number.isFinite(durationMs) ? durationMs : 0,
    posterUrl: posterUrl.startsWith('https://') ? posterUrl : '',
    imageUrl: imageUrl.startsWith('https://') ? imageUrl : '',
    imageUrls: distinctPhotoUrls,
    isPhoto: Boolean(!mp4Url && photoUrl.startsWith('https://'))
  };
}

/**
 * Selects the crispest mobile-friendly HD MP4 variant from an X `tweet-result` syndication object.
 * Handles both `mediaDetails[].video_info.variants` (which carries explicit `bitrate`) and
 * `video.variants` (which often omits `bitrate` and lists `src` URLs in ascending `WxH` order).
 */
export function selectBestXSyndicationMp4(syn) {
  if (!syn || typeof syn !== 'object') return '';
  const candidatesByUrl = new Map();
  let seq = 0;

  const addCandidate = (rawUrl, rawBitrate) => {
    if (typeof rawUrl !== 'string' || !rawUrl.startsWith('https://')) return;
    const cleanUrl = rawUrl.trim();
    const bitrate = Number(rawBitrate) > 0 ? Number(rawBitrate) : 0;
    const dimMatch = cleanUrl.match(/\/(\d{2,4})x(\d{2,4})\//);
    const pMatch = !dimMatch ? cleanUrl.match(/\/(\d{3,4})p(?:\.mp4|\/|\b)/i) : null;
    let width = 0;
    let height = 0;
    if (dimMatch) {
      width = Number(dimMatch[1]) || 0;
      height = Number(dimMatch[2]) || 0;
    } else if (pMatch) {
      const p = Number(pMatch[1]) || 0;
      height = p;
      width = Math.round((p * 16) / 9);
    }
    const pixels = width * height;
    const minDim = width > 0 && height > 0 ? Math.min(width, height) : 0;
    const score = bitrate > 0 ? bitrate : pixels > 0 ? pixels * 3 : seq + 1;
    const existing = candidatesByUrl.get(cleanUrl);
    if (!existing || score > existing.score || (bitrate > 0 && existing.bitrate === 0)) {
      candidatesByUrl.set(cleanUrl, {
        url: cleanUrl,
        bitrate,
        minDim,
        pixels,
        score,
        order: existing ? existing.order : seq++
      });
    }
  };

  if (Array.isArray(syn.mediaDetails)) {
    for (const md of syn.mediaDetails) {
      const variants = md?.video_info?.variants;
      if (!Array.isArray(variants)) continue;
      for (const v of variants) {
        if (v?.content_type === 'video/mp4') {
          addCandidate(v.url, v.bitrate);
        }
      }
    }
  }

  if (Array.isArray(syn.video?.variants)) {
    for (const v of syn.video.variants) {
      if (v?.type === 'video/mp4') {
        addCandidate(v.src || v.url, v.bitrate);
      }
    }
  }

  const all = [...candidatesByUrl.values()];
  if (all.length === 0) return '';

  all.sort((a, b) => b.score - a.score || b.pixels - a.pixels || b.order - a.order);

  const mobileHdSweetSpot = all.find(
    c => c.score <= 5_000_000 && (c.minDim >= 720 || c.score >= 1_500_000)
  );
  return (mobileHdSweetSpot || all[0]).url;
}

const NFL_CLUB_OR_LEAGUE_VIDEO_HOST_REGEX =
  /(^|\.)(nfl\.com|49ers\.com|azcardinals\.com|atlantafalcons\.com|baltimoreravens\.com|buffalobills\.com|panthers\.com|chicagobears\.com|bengals\.com|clevelandbrowns\.com|dallascowboys\.com|denverbroncos\.com|detroitlions\.com|packers\.com|houstontexans\.com|colts\.com|jaguars\.com|chiefs\.com|chargers\.com|therams\.com|raiders\.com|miamidolphins\.com|vikings\.com|patriots\.com|neworleanssaints\.com|giants\.com|newyorkjets\.com|philadelphiaeagles\.com|steelers\.com|seahawks\.com|buccaneers\.com|tennesseetitans\.com|commanders\.com)$/i;

/**
 * Returns true when `rawUrl` points to an official NFL club or NFL.com web video page
 * (e.g. `https://www.49ers.com/video/...` or `https://www.nfl.com/videos/...`).
 * These pages use NFL's `rnMediaPlayer` (TheoPlayer + Anvato HLS + Google IMA pre-roll),
 * which deadlocks on an infinite loading spinner inside iOS standalone PWA's in-app
 * `SFSafariViewController` but plays cleanly in full Safari.
 * Explicitly excludes YouTube, X, Bluesky, ESPN, and club `/news/` text articles.
 */
export function isExternalClubOrLeagueVideoUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!/^https:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (!NFL_CLUB_OR_LEAGUE_VIDEO_HOST_REGEX.test(host)) return false;
    return /^\/videos?(?:\/|$)/i.test(parsed.pathname || '');
  } catch {
    return false;
  }
}

/**
 * Detects an iOS / iPadOS 17+ installed Home Screen PWA running in standalone mode,
 * where `target="_blank"` external links open in a sandboxed `SFSafariViewController`
 * and `x-safari-https://` cleanly hands off to the full Safari app.
 */
export function isIosStandalonePwa(env = null) {
  const win = env && 'window' in env ? env.window : typeof window !== 'undefined' ? window : null;
  const nav =
    env && 'navigator' in env
      ? env.navigator
      : win?.navigator || (typeof navigator !== 'undefined' ? navigator : null);
  if (!nav) return false;

  const isStandalone = Boolean(
    nav.standalone === true || win?.matchMedia?.('(display-mode: standalone)')?.matches === true
  );
  if (!isStandalone) return false;

  const ua = String(nav.userAgent || '');
  const isIosUa = /iPhone|iPad|iPod/i.test(ua);
  const isIpadDesktopUa =
    /Macintosh/i.test(ua) && (Number(nav.maxTouchPoints) > 1 || nav.standalone === true);
  if (!isIosUa && !isIpadDesktopUa) return false;

  const osMatch = ua.match(/OS\s+(\d+)[._]/i);
  if (osMatch) {
    const major = Number(osMatch[1]);
    if (Number.isFinite(major) && major < 17) return false;
  }
  return true;
}

/**
 * Returns `x-safari-https://...` ONLY when running inside an iOS 17+ standalone PWA
 * and opening an NFL club/league web video page (`49ers.com/video/...`, `nfl.com/videos/...`, etc.).
 * Returns `null` on all other platforms, browsers, or URLs so standard `<a href>` navigation applies.
 */
export function resolveIosStandaloneExternalVideoBreakoutUrl(rawUrl, env = null) {
  if (!isIosStandalonePwa(env)) return null;
  const safeUrl = sanitizeExternalUrl(rawUrl, null);
  if (!safeUrl || !isExternalClubOrLeagueVideoUrl(safeUrl)) return null;
  return `x-safari-${safeUrl}`;
}

const HTML_NAMED_ENTITIES = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  sbquo: '‚',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  lsaquo: '‹',
  rsaquo: '›',
  prime: '′',
  Prime: '″',
  ndash: '–',
  mdash: '—',
  minus: '−',
  hellip: '…',
  bull: '•',
  middot: '·',
  sdot: '⋅',
  times: '×',
  divide: '÷',
  plusmn: '±',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  cent: '¢',
  pound: '£',
  euro: '€',
  yen: '¥',
  sect: '§',
  para: '¶',
  dagger: '†',
  Dagger: '‡',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  lArr: '⇐',
  rArr: '⇒',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  sup1: '¹',
  sup2: '²',
  sup3: '³',
  ordf: 'ª',
  ordm: 'º',
  shy: '',
  zwnj: '',
  zwj: '',
  aacute: 'á',
  Aacute: 'Á',
  agrave: 'à',
  Agrave: 'À',
  acirc: 'â',
  Acirc: 'Â',
  atilde: 'ã',
  Atilde: 'Ã',
  auml: 'ä',
  Auml: 'Ä',
  aring: 'å',
  Aring: 'Å',
  ccedil: 'ç',
  Ccedil: 'Ç',
  eacute: 'é',
  Eacute: 'É',
  egrave: 'è',
  Egrave: 'È',
  ecirc: 'ê',
  Ecirc: 'Ê',
  euml: 'ë',
  Euml: 'Ë',
  iacute: 'í',
  Iacute: 'Í',
  igrave: 'ì',
  Igrave: 'Ì',
  icirc: 'î',
  Icirc: 'Î',
  iuml: 'ï',
  Iuml: 'Ï',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  oacute: 'ó',
  Oacute: 'Ó',
  ograve: 'ò',
  Ograve: 'Ò',
  ocirc: 'ô',
  Ocirc: 'Ô',
  otilde: 'õ',
  Otilde: 'Õ',
  ouml: 'ö',
  Ouml: 'Ö',
  uacute: 'ú',
  Uacute: 'Ú',
  ugrave: 'ù',
  Ugrave: 'Ù',
  ucirc: 'û',
  Ucirc: 'Û',
  uuml: 'ü',
  Uuml: 'Ü',
  yacute: 'ý',
  Yacute: 'Ý',
  yuml: 'ÿ',
  Yuml: 'Ÿ'
});

const HTML5_WIN1252_C1_MAP = Object.freeze({
  128: '€',
  130: '‚',
  131: 'ƒ',
  132: '„',
  133: '…',
  134: '†',
  135: '‡',
  136: 'ˆ',
  137: '‰',
  138: 'Š',
  139: '‹',
  140: 'Œ',
  142: 'Ž',
  145: '‘',
  146: '’',
  147: '“',
  148: '”',
  149: '•',
  150: '–',
  151: '—',
  152: '˜',
  153: '™',
  154: 'š',
  155: '›',
  156: 'œ',
  158: 'ž',
  159: 'Ÿ'
});

const HTML_ENTITY_TOKEN_RE = /&(?:#[xX]([0-9a-fA-F]{1,6})|#(\d{1,7})|([a-zA-Z][a-zA-Z0-9]{1,12}));/g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const IE_CONDITIONAL_COMMENT_RE = /<!--?\[(?:if\b[^\]]*|endif)\](?:--)?>/gi;
const REAL_HTML_TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s+[^<>]*)?\/?>/g;
const KNOWN_ESCAPED_HTML_TAG_RE =
  /<\/?(?:a|abbr|article|aside|b|blockquote|br|caption|code|dd|del|details|div|dl|dt|em|figcaption|figure|font|footer|h[1-6]|header|hr|i|iframe|img|ins|li|main|mark|nav|ol|p|picture|pre|q|s|section|small|source|span|strong|sub|summary|sup|table|tbody|td|tfoot|th|thead|time|tr|u|ul|video)(?:\s+[^<>]*)?\/?>/gi;

function decodeHtmlCodePoint(cp, fallback) {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return fallback;
  if (cp === 0xa0) return ' ';
  if (cp === 0xad) return '';
  if (cp >= 128 && cp <= 159) return HTML5_WIN1252_C1_MAP[cp] ?? fallback;
  if (cp >= 0xd800 && cp <= 0xdfff) return fallback;
  if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) return fallback;
  try {
    return String.fromCodePoint(cp);
  } catch {
    return fallback;
  }
}

/**
 * Decodes HTML/XML named and numeric entities (including X/Twitter syndication `&gt;`/`&lt;`/`&amp;`,
 * RSS numeric entities `&#8217;`/`&#8212;`/`&#160;`/`&#x27;`, Windows-1252 C1 codes, and double-encoded
 * entities like `&amp;gt;`) in a bounded multi-pass sweep while leaving plain text (`A & B`, `AT&T`) intact.
 */
export function decodeHtmlEntities(str = '', { maxPasses = 2 } = {}) {
  let out = String(str ?? '');
  if (!out || !out.includes('&')) return out;
  const passes = Math.max(1, Math.min(3, Number(maxPasses) || 2));
  for (let i = 0; i < passes; i += 1) {
    const next = out.replace(HTML_ENTITY_TOKEN_RE, (full, hex, dec, named) => {
      if (hex !== undefined) return decodeHtmlCodePoint(parseInt(hex, 16), full);
      if (dec !== undefined) return decodeHtmlCodePoint(parseInt(dec, 10), full);
      if (named !== undefined) {
        if (Object.prototype.hasOwnProperty.call(HTML_NAMED_ENTITIES, named)) {
          return HTML_NAMED_ENTITIES[named];
        }
        const lower = named.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(HTML_NAMED_ENTITIES, lower)) {
          return HTML_NAMED_ENTITIES[lower];
        }
      }
      return full;
    });
    if (next === out) break;
    out = next;
    if (!out.includes('&')) break;
  }
  return out;
}

/**
 * Strips CDATA wrappers, script/style blocks, HTML comments (including NFL CMS IE9 `<picture>`
 * conditional comments `<!--[if IE 9]><video ...><![endif]-->`), and HTML tags (both raw and RSS-escaped)
 * while decoding all HTML/XML entities without corrupting literal comparisons (`3 < 5 && 7 > 4`, `>>>`).
 */
export function stripHtmlAndDecodeEntities(str = '', { preserveNewlines = false } = {}) {
  const raw = String(str ?? '');
  if (!raw) return '';
  let out = raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(HTML_COMMENT_RE, ' ')
    .replace(IE_CONDITIONAL_COMMENT_RE, ' ')
    .replace(/<br\s*\/?>/gi, preserveNewlines ? '\n' : ' ')
    .replace(REAL_HTML_TAG_RE, ' ');
  if (out.includes('&')) {
    out = decodeHtmlEntities(out, { maxPasses: 2 });
    if (out.includes('<')) {
      out = out
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(HTML_COMMENT_RE, ' ')
        .replace(IE_CONDITIONAL_COMMENT_RE, ' ')
        .replace(KNOWN_ESCAPED_HTML_TAG_RE, ' ');
    }
  }
  return preserveNewlines ? normalizeMultilineSocialText(out) : out.replace(/\s+/g, ' ').trim();
}

/**
 * Sanitizes a player display name against leaked HTML comments (e.g. `<!--[if IE 9]> ...`),
 * residual markup tags, or encoded entities while preserving legitimate apostrophes, hyphens, and suffixes.
 */
export function sanitizePlayerDisplayName(raw = '') {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (!s.includes('<') && !s.includes('>') && !s.includes('&')) return s;
  return stripHtmlAndDecodeEntities(s)
    .replace(/^[^A-Za-z0-9]+/, '')
    .trim();
}
