/**
 * 49ers Beat Attribution, Reporter Trust-Tiering, First-Mover Injury Scoop & X Live Search Engine
 *
 * Deterministic, zero-dependency engine shared across browser live polling (`src/services/dataService.js`),
 * breaking/salience ranking (`src/engine/breakingClassifier.js`, `src/engine/antiFluffFilter.js`),
 * UI views, and server-side ingestion (`scripts/fetch-live-49ers-data.mjs`).
 *
 * Core Philosophy:
 * 1. Prioritize Tier-1 Trusted 49ers Beat Reporters & NFL Insiders for general coverage and corroborated stories.
 * 2. Consider ALL viable beat/sideline writers — elevating the FIRST viable writer to report an acute
 *    injury, warmup, practice, or in-game status update immediately to #1 ("First-Mover Injury Scoop"),
 *    then surfacing multi-reporter corroboration as Tier-1 confirmations arrive.
 * 3. Resolve X (`x.com`) handles & prose citations from real-time wire feeds (ESPN Player Wire, RotoWire,
 *    Official Transactions, Bluesky mirrors) so users always get X-first attribution and 1-tap X verification.
 */

export const TRUST_TIER_LABELS = {
  1: 'Tier 1 • Primary Trusted',
  2: 'Tier 2 • Verified Beat & Film',
  3: 'Tier 3 • Viable Column & Sideline'
};

export const BEAT_REPORTER_DIRECTORY = [
  // Tier 1: Official Podium + Primary Credentialed 49ers Beat + Top National Transaction Insiders
  { id: 'kyle_shanahan', name: 'Kyle Shanahan', handle: '@49ers', outletId: '49ers_official', outletName: '49ers Official', trustTier: 1, credibilityScore: 99 },
  { id: 'john_lynch', name: 'John Lynch', handle: '@JohnLynch49ers', outletId: '49ers_official', outletName: '49ers Official', trustTier: 1, credibilityScore: 97 },
  { id: '49ers_news', name: 'San Francisco 49ers Official', handle: '@49ers', outletId: '49ers_official', outletName: '49ers.com Official', trustTier: 1, credibilityScore: 98 },
  { id: 'brianna_jeannel', name: 'Briana Jeannel', handle: '@BrianaJeannel', outletId: '49ers_official', outletName: '49ers.com', trustTier: 1, credibilityScore: 95, aliases: ['brianna jeannel', 'brooke evans'] },
  { id: 'matt_maiocco', name: 'Matt Maiocco', handle: '@MaioccoNBCS', outletId: 'nbcsba', outletName: 'NBC Sports Bay Area', trustTier: 1, credibilityScore: 98 },
  { id: 'nick_wagoner', name: 'Nick Wagoner', handle: '@nwagoner', outletId: 'espn', outletName: 'ESPN 49ers Beat', trustTier: 1, credibilityScore: 98 },
  { id: 'matt_barrows', name: 'Matt Barrows', handle: '@mattbarrows', outletId: 'athletic', outletName: 'The Athletic', trustTier: 1, credibilityScore: 98 },
  { id: 'david_lombardi', name: 'David Lombardi', handle: '@LombardiHimself', outletId: 'sf_standard', outletName: 'The SF Standard', trustTier: 1, credibilityScore: 95 },
  { id: 'jennifer_lee_chan', name: 'Jennifer Lee Chan', handle: '@jenniferleechan', outletId: 'nbcsba', outletName: 'NBC Sports Bay Area', trustTier: 1, credibilityScore: 95 },
  { id: 'eric_branch', name: 'Eric Branch', handle: '@Eric_Branch', outletId: 'sf_chronicle', outletName: 'SF Chronicle', trustTier: 1, credibilityScore: 95 },
  { id: 'cam_inman', name: 'Cam Inman', handle: '@CamInman', outletId: 'bay_area_news', outletName: 'Bay Area News Group', trustTier: 1, credibilityScore: 95 },
  { id: 'adam_schefter', name: 'Adam Schefter', handle: '@AdamSchefter', outletId: 'espn', outletName: 'ESPN NFL Insider', trustTier: 1, credibilityScore: 99 },
  { id: 'ian_rapoport', name: 'Ian Rapoport', handle: '@RapSheet', outletId: 'nfl_network', outletName: 'NFL Network', trustTier: 1, credibilityScore: 98 },
  { id: 'tom_pelissero', name: 'Tom Pelissero', handle: '@TomPelissero', outletId: 'nfl_network', outletName: 'NFL Network', trustTier: 1, credibilityScore: 97 },
  { id: 'mike_garafolo', name: 'Mike Garafolo', handle: '@MikeGarafolo', outletId: 'nfl_network', outletName: 'NFL Network', trustTier: 1, credibilityScore: 96 },

  // Tier 2: Verified Beat Reporters, National Reporters, Cap & All-22 Film Analysts
  { id: 'sam_warren', name: 'Sam Warren', handle: '@SamWarren_SF', outletId: 'athletic', outletName: 'The Athletic', trustTier: 2, credibilityScore: 93 },
  { id: 'noah_furtado', name: 'Noah Furtado', handle: '@noah_furtado', outletId: 'sf_chronicle', outletName: 'SF Chronicle', trustTier: 2, credibilityScore: 91 },
  { id: 'chris_biderman', name: 'Chris Biderman', handle: '@ChrisBiderman', outletId: 'bay_area_news', outletName: 'Sacramento Bee', trustTier: 2, credibilityScore: 90 },
  { id: 'dianna_russini', name: 'Dianna Russini', handle: '@DMRussini', outletId: 'athletic', outletName: 'The Athletic', trustTier: 2, credibilityScore: 94 },
  { id: 'albert_breer', name: 'Albert Breer', handle: '@AlbertBreer', outletId: 'nfl_network', outletName: 'MMQB / SI', trustTier: 2, credibilityScore: 92 },
  { id: 'field_yates', name: 'Field Yates', handle: '@FieldYates', outletId: 'espn', outletName: 'ESPN NFL', trustTier: 2, credibilityScore: 92 },
  { id: 'jeremy_fowler', name: 'Jeremy Fowler', handle: '@JFowlerESPN', outletId: 'espn', outletName: 'ESPN NFL', trustTier: 2, credibilityScore: 91 },
  { id: 'jordan_schultz', name: 'Jordan Schultz', handle: '@Schultz_Report', outletId: 'nfl_network', outletName: 'NFL Insider', trustTier: 2, credibilityScore: 88 },
  { id: 'aaron_wilson', name: 'Aaron Wilson', handle: '@AaronWilson_NFL', outletId: 'nfl_network', outletName: 'KPRC 2 NFL', trustTier: 2, credibilityScore: 90 },
  { id: 'vic_tafur', name: 'Vic Tafur', handle: '@VicTafur', outletId: 'athletic', outletName: 'The Athletic', trustTier: 2, credibilityScore: 89 },
  { id: 'tim_kawakami', name: 'Tim Kawakami', handle: '@timkawakami', outletId: 'sf_standard', outletName: 'The SF Standard', trustTier: 2, credibilityScore: 89 },
  { id: 'tim_ryan', name: 'Tim Ryan', handle: '@TimRyan49ers', outletId: 'knbr_radio', outletName: 'KNBR / 49ers Radio', trustTier: 2, credibilityScore: 93 },
  { id: 'greg_papa', name: 'Greg Papa', handle: '@GregPapa', outletId: 'knbr_radio', outletName: 'KNBR / 49ers Radio', trustTier: 2, credibilityScore: 88 },
  { id: 'guy_haberman', name: 'Guy Haberman', handle: '@GuyHaberman', outletId: 'youtube_film', outletName: 'Haberman & Middlekauff', trustTier: 2, credibilityScore: 91 },
  { id: 'john_chapman', name: 'John Chapman', handle: '@JL_Chapman', outletId: 'youtube_film', outletName: '49ers Rush', trustTier: 2, credibilityScore: 90 },
  { id: 'eric_crocker', name: 'Eric Crocker', handle: '@eric_crocker', outletId: 'youtube_film', outletName: 'Locked On 49ers', trustTier: 2, credibilityScore: 91 },
  { id: 'jonnydel', name: "Jonnydel's Football Academy", handle: '@jonnydelsfa', outletId: 'youtube_film', outletName: "Jonnydel's FA", trustTier: 2, credibilityScore: 93 },
  { id: 'jeff_deeney', name: 'Jeff Deeney', handle: '@PFF_Jeff', outletId: 'youtube_film', outletName: '49ers Analytics', trustTier: 2, credibilityScore: 89 },
  { id: 'brad_graham', name: 'Brad Graham', handle: '@TheSFNiners', outletId: 'youtube_film', outletName: 'TheSFNiners', trustTier: 2, credibilityScore: 88 },
  { id: 'al_sacco', name: 'Al Sacco', handle: '@AlSacco49', outletId: '49ers_webzone', outletName: '49ers Webzone', trustTier: 2, credibilityScore: 85 },
  { id: 'kyle_posey', name: 'Kyle Posey', handle: '@KP_Show', outletId: 'niners_nation', outletName: 'Niners Nation', trustTier: 2, credibilityScore: 89 },
  { id: 'rohan_chakravarthi', name: 'Rohan Chakravarthi', handle: '@RohanChakrav', outletId: 'niners_nation', outletName: 'Niners Nation', trustTier: 2, credibilityScore: 84 },
  { id: 'akash_anavarathan', name: 'Akash Anavarathan', handle: '@akashanav', outletId: 'youtube_film', outletName: '49ers Analytics', trustTier: 2, credibilityScore: 87 },
  { id: 'steph_sanchez', name: 'Steph Sanchez', handle: '@Steph49K', outletId: 'youtube_film', outletName: '49ers Know It All', trustTier: 2, credibilityScore: 84 },
  { id: 'jason_aponte', name: 'Jason Aponte', handle: '@JasonAponte2103', outletId: 'youtube_film', outletName: 'Sprint Right Option', trustTier: 2, credibilityScore: 84 },
  { id: 'vish_kumaran', name: 'Vish Kumaran', handle: '@VishKumaran', outletId: 'niners_nation', outletName: 'Niners Nation', trustTier: 2, credibilityScore: 84 },
  { id: 'mina_kimes', name: 'Mina Kimes', handle: '@minakimes', outletId: 'espn', outletName: 'ESPN NFL', trustTier: 2, credibilityScore: 93 },
  { id: 'ben_solak', name: 'Ben Solak', handle: '@BenjaminSolak', outletId: 'espn', outletName: 'ESPN NFL', trustTier: 2, credibilityScore: 91 },
  { id: 'brett_kollmann', name: 'Brett Kollmann', handle: '@BrettKollmann', outletId: 'youtube_film', outletName: 'The Film Room', trustTier: 2, credibilityScore: 89 },
  { id: 'dane_brugler', name: 'Dane Brugler', handle: '@dpbrugler', outletId: 'athletic', outletName: 'The Athletic Draft', trustTier: 2, credibilityScore: 94 },
  { id: 'daniel_jeremiah', name: 'Daniel Jeremiah', handle: '@MoveTheSticks', outletId: 'nfl_network', outletName: 'NFL Network', trustTier: 2, credibilityScore: 93 },

  // Tier 3: Viable Columnists, Camp & Sideline Observers (lower weight on opinion, full First-Mover elevation on acute injury observations)
  { id: 'dieter_kurtenbach', name: 'Dieter Kurtenbach', handle: '@dkurtenbach', outletId: 'bay_area_news', outletName: 'Bay Area News Group', trustTier: 3, credibilityScore: 80 },
  { id: 'larry_krueger', name: 'Larry Krueger', handle: '@sportslarryknbr', outletId: 'youtube_film', outletName: 'The Krueg Show', trustTier: 3, credibilityScore: 78 },
  { id: 'grant_cohn', name: 'Grant Cohn', handle: '@grantcohn', outletId: 'youtube_film', outletName: '49ers On SI', trustTier: 3, credibilityScore: 76 }
];

const BY_ID = new Map();
const BY_LOWER_NAME = new Map();
const BY_LOWER_HANDLE = new Map();
const UNIQUE_SURNAME_MAP = new Map();

const AMBIGUOUS_SURNAMES = new Set([
  'williams',
  'wilson',
  'warren',
  'ryan',
  'sanchez',
  'graham',
  'chan',
  'branch',
  'cohn'
]);

(function indexDirectory() {
  const surnameCounts = new Map();
  for (const entry of BEAT_REPORTER_DIRECTORY) {
    const cleanHandle = String(entry.handle || '').replace(/^@/, '');
    const enriched = {
      ...entry,
      xUrl: cleanHandle ? `https://x.com/${cleanHandle}` : null,
      trustTierLabel: TRUST_TIER_LABELS[entry.trustTier] || TRUST_TIER_LABELS[2]
    };
    BY_ID.set(enriched.id, enriched);
    BY_LOWER_NAME.set(enriched.name.toLowerCase(), enriched);
    if (cleanHandle) {
      BY_LOWER_HANDLE.set(cleanHandle.toLowerCase(), enriched);
    }
    for (const al of enriched.aliases || []) {
      BY_LOWER_NAME.set(String(al).toLowerCase(), enriched);
    }
    const parts = enriched.name.trim().split(/\s+/);
    const surname = (parts[parts.length - 1] || '').toLowerCase().replace(/[^a-z]/g, '');
    if (surname.length >= 5) {
      surnameCounts.set(surname, (surnameCounts.get(surname) || 0) + 1);
    }
  }
  for (const entry of BY_ID.values()) {
    const parts = entry.name.trim().split(/\s+/);
    const surname = (parts[parts.length - 1] || '').toLowerCase().replace(/[^a-z]/g, '');
    if (surname.length >= 5 && surnameCounts.get(surname) === 1 && !AMBIGUOUS_SURNAMES.has(surname)) {
      UNIQUE_SURNAME_MAP.set(surname, entry);
    }
  }
})();

export function getReporterDirectoryEntry(reporterId = '') {
  return BY_ID.get(String(reporterId || '').trim()) || null;
}

export function getReporterTrustTier(reporterId = '') {
  const entry = getReporterDirectoryEntry(reporterId);
  return entry ? entry.trustTier : 2;
}

export function resolveReporterFromNameOrHandle(candidate = '') {
  const raw = String(candidate || '').trim();
  if (!raw) return null;
  if (BY_ID.has(raw)) return BY_ID.get(raw);

  const handleClean = raw.replace(/^@/, '').toLowerCase();
  if (BY_LOWER_HANDLE.has(handleClean)) {
    return BY_LOWER_HANDLE.get(handleClean);
  }

  const lower = raw.toLowerCase().replace(/\s+/g, ' ');
  if (BY_LOWER_NAME.has(lower)) {
    return BY_LOWER_NAME.get(lower);
  }

  for (const [fullLower, entry] of BY_LOWER_NAME.entries()) {
    if (fullLower.length >= 7 && lower.includes(fullLower)) {
      return entry;
    }
  }

  const tokenClean = lower.replace(/[^a-z]/g, '');
  if (UNIQUE_SURNAME_MAP.has(tokenClean)) {
    return UNIQUE_SURNAME_MAP.get(tokenClean);
  }

  return null;
}

const SOCIAL_PREFIX_PATTERNS = [
  // Emoji / alert / bracket prefixes on mirror or aggregator accounts:
  // e.g. "‼️ Schefter: ...", "🚨 Ian Rapoport: ...", "[Pelissero] ...", "BREAKING (Garafolo): ..."
  /^[^\w@[\n]{0,10}\[?\(?(?:breaking\s*[-:•]?\s*)?@?([A-Za-z][A-Za-z.' -]{2,28})\)?\]?\s*:\s+([\s\S]+)$/i,
  // Leading "Per @MaioccoNBCS, ..." or "Via Matt Barrows: ..."
  /^(?:per|via)\s+@?([A-Za-z0-9_.' -]{3,28})[,:]\s+([\s\S]+)$/i
];

const PROSE_CITATION_PATTERNS = [
  // "... , Nick Wagoner of ESPN.com reports" / "... , Matt Maiocco of NBC Sports Bay Area reports"
  /,\s+([A-Z][a-z'.-]+(?:\s+[A-Z][a-z'.-]+){1,2})\s+of\s+([A-Za-z0-9'.&\s-]+?)\s+(?:reports|reported|notes|noted|writes|tweets|tweeted|posted|relayed|confirmed|confirms)\b/i,
  // "... per Matt Maiocco of NBC Sports Bay Area" / "... according to Sam Warren of The Athletic"
  /\b(?:per|according to|via)\s+([A-Z][a-z'.-]+(?:\s+[A-Z][a-z'.-]+){1,2})\s+of\s+([A-Za-z0-9'.&\s-]+?)(?:[.,;]|$)/i,
  // "Nick Wagoner of ESPN.com reports that ..."
  /^([A-Z][a-z'.-]+(?:\s+[A-Z][a-z'.-]+){1,2})\s+of\s+([A-Za-z0-9'.&\s-]+?)\s+(?:reports|reported|notes|writes|confirmed)\b/i,
  // "... , per Nick Wagoner." / "... , per @MaioccoNBCS"
  /\b(?:per|via|according to)\s+@?([A-Z][a-zA-Z0-9_'.-]+(?:\s+[A-Z][a-z'.-]+){0,2})(?:[.,;)]|$)/
];

const NON_REPORTER_PREFIX_WORDS = new Set([
  'injury update',
  'breaking',
  'breaking news',
  'update',
  'roster move',
  'roster update',
  'transaction',
  'final',
  'halftime',
  'inactives',
  '49ers',
  'san francisco',
  'kyle shanahan',
  'john lynch',
  'note',
  'watch',
  'video'
]);

/**
 * Extracts canonical beat reporter / insider attribution from social mirror posts,
 * RotoWire/ESPN Player Wire blurbs, and press-box prose citations.
 */
export function extractBeatAttributionFromText(rawText = '', fallback = {}) {
  const original = String(rawText || '').replace(/\s+/g, ' ').trim();
  const fallbackEntry =
    resolveReporterFromNameOrHandle(fallback.reporterId || fallback.reporterName || fallback.authorHandle) || null;

  const buildResult = (entry, cleanedBody, customName = null, customOutlet = null, viaWire = false) => {
    if (entry) {
      return {
        cleanedText: cleanedBody || original,
        reporterId: entry.id,
        reporterName: entry.name,
        author: entry.name,
        authorHandle: entry.handle,
        xUrl: entry.xUrl,
        authorProfileUrl: entry.xUrl || fallback.authorProfileUrl || null,
        outletId: entry.outletId || fallback.outletId || 'espn',
        outletName: customOutlet || entry.outletName || fallback.outletName || '49ers Beat',
        trustTier: entry.trustTier,
        credibilityScore: entry.credibilityScore,
        viaWire
      };
    }
    const finalName = customName || fallback.reporterName || fallback.author || '49ers Beat Wire';
    const cleanFallbackHandle = String(fallback.authorHandle || '').replace(/^@/, '');
    const fallbackXUrl = cleanFallbackHandle ? `https://x.com/${cleanFallbackHandle}` : null;
    return {
      cleanedText: cleanedBody || original,
      reporterId: fallback.reporterId || 'nick_wagoner',
      reporterName: finalName,
      author: finalName,
      authorHandle: fallback.authorHandle || '',
      xUrl: fallbackXUrl,
      authorProfileUrl: fallbackXUrl || fallback.authorProfileUrl || null,
      outletId: fallback.outletId || 'espn',
      outletName: customOutlet || fallback.outletName || '49ers Beat Wire',
      trustTier: fallbackEntry?.trustTier || 2,
      credibilityScore: fallbackEntry?.credibilityScore || 86,
      viaWire
    };
  };

  if (!original) {
    return buildResult(fallbackEntry, '');
  }

  // 1. Check leading social mirror prefixes ("‼️ Schefter: ...", "Mike Garafolo: ...", "[Maiocco] ...")
  for (const rx of SOCIAL_PREFIX_PATTERNS) {
    const m = original.match(rx);
    if (m) {
      const candidateLabel = m[1].trim();
      if (!NON_REPORTER_PREFIX_WORDS.has(candidateLabel.toLowerCase())) {
        const matched = resolveReporterFromNameOrHandle(candidateLabel);
        if (matched) {
          return buildResult(matched, m[2].trim(), null, null, true);
        }
      }
    }
  }

  // 2. Check RotoWire / ESPN Player Wire prose citations ("..., Nick Wagoner of ESPN.com reports")
  for (const rx of PROSE_CITATION_PATTERNS) {
    const m = original.match(rx);
    if (m) {
      const candidatePerson = String(m[1] || '').trim();
      const candidateOutlet = m[2] ? String(m[2]).replace(/^the\s+/i, '').trim() : null;
      if (!candidatePerson || NON_REPORTER_PREFIX_WORDS.has(candidatePerson.toLowerCase())) continue;
      const matched = resolveReporterFromNameOrHandle(candidatePerson);
      if (matched) {
        return buildResult(matched, original, null, null, true);
      }
      // Valid 2-word capitalized reporter name from wire (e.g. "Brooke Evans", "Paul Gutierrez")
      if (/^[A-Z][a-z'.-]+\s+[A-Z][a-z'.-]+$/.test(candidatePerson) && !/\b(Head Coach|General Manager|San Francisco|Las Vegas)\b/i.test(candidatePerson)) {
        return buildResult(null, original, candidatePerson, candidateOutlet, true);
      }
    }
  }

  // 3. Check podium attribution ("coach Kyle Shanahan said ...") if fallback has no specific human author
  if (/\b(?:head\s+)?coach\s+Kyle\s+Shanahan\s+(?:said|noted|announced|confirmed|told\s+reporters)\b/i.test(original)) {
    if (!fallbackEntry) {
      return buildResult(BY_ID.get('kyle_shanahan'), original, null, null, true);
    }
  }

  return buildResult(fallbackEntry, original);
}

const ACUTE_INJURY_OBSERVATION_REGEX =
  /\b(questionable to return|probable to return|doubtful to return|ruled out|will not return|out for the rest|cleared to return|back in the game|returning to the game|returned to the game|medical tent|blue tent|locker room|carted off|limped off|limping|helped off|athletic trainer|with trainers|examined on the sideline|helmet off|concussion evaluation|concussion protocol|not practicing|not seen at practice|missed practice|side field|rehab field|working on a side|in warmups|pregame warmups|during warmups|non-contact jersey|blue non-contact|walking boot|setback|aggravated|re-aggravated|tweaked|mri|x-ray|high-ankle|meniscus|acl|mcl|achilles|pectoral|activated from injured reserve|activated off ir|activated from ir|21-day practice window|designated to return|placed on injured reserve|placed on ir|didn't activate|did not activate|game-time decision|officially active|officially inactive|full workload|no limitations)\b/i;

const SPECULATIVE_EXCLUSION_REGEX =
  /\b(mock trade|trade proposal|trade idea|trade pitch|hypothetical|what if|flashback|on this day|\d+\s+years ago|way-too-early|mailbag)\b/i;

/**
 * Returns true if the text describes a concrete, actionable player injury, practice, warmup,
 * or game-availability observation (eligible for First-Mover Injury Scoop elevation).
 */
export function isAcuteInjuryOrAvailabilityScoop(text = '') {
  const clean = String(text || '').trim();
  if (!clean || SPECULATIVE_EXCLUSION_REGEX.test(clean)) return false;
  return ACUTE_INJURY_OBSERVATION_REGEX.test(clean);
}

function classifyWireEventTopic(text = '') {
  const s = String(text || '');
  if (/\b(activated from|placed on ir|placed on injured reserve|21-day|practice squad|waived|signed|traded|acquiring|released)\b/i.test(s)) {
    return 'roster_ir_tx';
  }
  if (isAcuteInjuryOrAvailabilityScoop(s)) {
    return 'acute_injury';
  }
  if (/\b(restructure|cap space|extension|contract|bonus)\b/i.test(s)) {
    return 'contract_cap';
  }
  return null;
}

const NON_PLAYER_PROPER_NOUNS = new Set([
  'san francisco',
  'bay area',
  'santa clara',
  'head coach',
  'general manager',
  'kyle shanahan',
  'john lynch',
  'robert saleh',
  'gus bradley',
  'raheem morris',
  'super bowl',
  'injured reserve',
  'practice squad',
  'active roster',
  'los angeles',
  'new york',
  'green bay',
  'kansas city',
  'las vegas',
  'new orleans',
  'new england',
  'tampa bay',
  'nfl network',
  'nbc sports',
  'associated press',
  'levi stadium'
]);

function extractFallbackPlayerKeys(text = '') {
  const keys = [];
  const rx = /\b([A-Z][a-z'.-]{1,14}\s+(?:Mc[A-Z][a-z]+|De[A-Z][a-z]+|[A-Z][a-z'.-]{2,16}))\b/g;
  let m;
  while ((m = rx.exec(String(text || ''))) !== null) {
    const candidate = m[1].trim().toLowerCase();
    if (NON_PLAYER_PROPER_NOUNS.has(candidate)) continue;
    if (BY_LOWER_NAME.has(candidate)) continue;
    keys.push(candidate);
    if (keys.length >= 2) break;
  }
  return keys;
}

/**
 * Annotates a stream of wire items with:
 * - `trustTier` (1 = Primary Trusted, 2 = Verified Beat/Film, 3 = Viable Column/Sideline)
 * - `isFirstMoverInjuryScoop` (true when ANY viable writer is the FIRST to report a fresh player injury/status update)
 * - `corroborationCount` & `corroboratedBy` (multi-reporter confirmation across X/ESPN Wire/RotoWire/Bluesky)
 * - `firstReportedBy` (preserves credit for the beat writer who broke the injury first)
 */
export function corroborateAndAnnotateWireStream(items = [], nowMs = Date.now(), { clusterWindowHours = 12 } = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const annotated = items.map(it => {
    const dirEntry = resolveReporterFromNameOrHandle(it.reporterId || it.author || it.reporterName || it.authorHandle);
    const trustTier = Number(it.trustTier) || dirEntry?.trustTier || 2;
    const credibilityScore = Number(it.credibilityScore) || dirEntry?.credibilityScore || 86;
    const combinedText = `${it.title || it.headline || ''} ${it.fullText || ''} ${it.summary || ''}`.trim();
    const eventTopic = classifyWireEventTopic(combinedText);
    const explicitPlayerKeys = Array.isArray(it.mentionedPlayers)
      ? it.mentionedPlayers.map(mp => String(mp.name || mp.id || '').toLowerCase()).filter(Boolean)
      : [];
    const playerKeys = explicitPlayerKeys.length > 0 ? explicitPlayerKeys : extractFallbackPlayerKeys(combinedText);
    const pubMs = it.publishedAt ? new Date(it.publishedAt).getTime() : NaN;
    return {
      ...it,
      trustTier,
      credibilityScore,
      authorHandle: it.authorHandle || dirEntry?.handle || '',
      authorProfileUrl: dirEntry?.xUrl || it.authorProfileUrl || null,
      _eventTopic: eventTopic,
      _playerKeys: playerKeys,
      _pubMs: Number.isFinite(pubMs) ? pubMs : 0
    };
  });

  // Group recent player-specific injury / transaction items into corroboration clusters
  const windowMs = clusterWindowHours * 3_600_000;
  const clusters = new Map();

  for (let idx = 0; idx < annotated.length; idx++) {
    const it = annotated[idx];
    if (!it._eventTopic || it._playerKeys.length === 0 || !it._pubMs) continue;
    if (nowMs - it._pubMs > windowMs) continue;

    // Key by primary mentioned player + event topic
    const primaryPlayerKey = it._playerKeys[0];
    const clusterKey = `${primaryPlayerKey}::${it._eventTopic}`;
    if (!clusters.has(clusterKey)) clusters.set(clusterKey, []);
    clusters.get(clusterKey).push(idx);
  }

  for (const memberIndices of clusters.values()) {
    // Sort chronologically ascending (oldest = first to tweet/report!)
    const sortedAsc = [...memberIndices].sort((a, b) => annotated[a]._pubMs - annotated[b]._pubMs);
    const firstIdx = sortedAsc[0];
    const firstItem = annotated[firstIdx];

    // Distinct reporter names in this cluster
    const distinctReporters = [];
    const seenAuthorKeys = new Set();
    for (const idx of sortedAsc) {
      const cand = annotated[idx];
      const authName = String(cand.author || cand.reporterName || '').trim();
      const authKey = (cand.reporterId || authName).toLowerCase();
      if (!authName || seenAuthorKeys.has(authKey)) continue;
      seenAuthorKeys.add(authKey);
      distinctReporters.push({
        reporterId: cand.reporterId || '',
        name: authName,
        handle: cand.authorHandle || '',
        trustTier: cand.trustTier
      });
    }

    const firstAgeHours = Math.max(0, (nowMs - firstItem._pubMs) / 3_600_000);
    if (
      (firstItem._eventTopic === 'acute_injury' || firstItem._eventTopic === 'roster_ir_tx') &&
      firstAgeHours <= 12
    ) {
      firstItem.isFirstMoverInjuryScoop = true;
    }

    for (const idx of memberIndices) {
      const cur = annotated[idx];
      const curAuthKey = String(cur.reporterId || cur.author || cur.reporterName || '').toLowerCase();
      const others = distinctReporters.filter(
        r => (r.reporterId || r.name).toLowerCase() !== curAuthKey
      );
      cur.corroborationCount = Math.max(1, distinctReporters.length);
      if (others.length > 0) {
        cur.corroboratedBy = others
          .sort((a, b) => a.trustTier - b.trustTier)
          .slice(0, 3)
          .map(r => r.name);
      }
      if (idx !== firstIdx && distinctReporters.length >= 2) {
        const firstAuthor = String(firstItem.author || firstItem.reporterName || '').trim();
        if (firstAuthor && firstAuthor.toLowerCase() !== curAuthKey) {
          cur.firstReportedBy = firstAuthor;
        }
      }
    }
  }

  return annotated.map(({ _eventTopic, _playerKeys, _pubMs, ...clean }) => clean);
}

export const TOP_TRUSTED_49ERS_X_HANDLES = [
  'MaioccoNBCS',
  'nwagoner',
  'mattbarrows',
  'LombardiHimself',
  'jenniferleechan',
  'Eric_Branch',
  'CamInman',
  '49ers',
  'AdamSchefter',
  'RapSheet',
  'TomPelissero',
  'MikeGarafolo'
];

export const ALL_VIABLE_49ERS_INJURY_X_HANDLES = [
  'MaioccoNBCS',
  'nwagoner',
  'mattbarrows',
  'LombardiHimself',
  'jenniferleechan',
  'Eric_Branch',
  'CamInman',
  'SamWarren_SF',
  'BrianaJeannel',
  'TheSFNiners',
  'grantcohn',
  '49ers'
];

/**
 * Builds a 1-tap Live X (`x.com`) search URL sorted by Latest (`f=live`) across the top trusted
 * 49ers beat writers & national insiders, or filtered specifically for live sideline/practice injury tweets.
 */
export function buildXBeatListSearchUrl(mode = 'trusted') {
  if (mode === 'injuries') {
    const fromClause = ALL_VIABLE_49ERS_INJURY_X_HANDLES.map(h => `from:${h}`).join(' OR ');
    const q = `(${fromClause}) (injury OR tent OR practice OR questionable OR return OR IR OR warmups OR DNP)`;
    return `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`;
  }
  if (mode === 'insiders') {
    const q = `(from:AdamSchefter OR from:RapSheet OR from:TomPelissero OR from:MikeGarafolo OR from:DMRussini OR from:FieldYates) (49ers OR Niners OR Shanahan OR Lynch)`;
    return `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`;
  }
  const coreBeat = TOP_TRUSTED_49ERS_X_HANDLES.slice(0, 8).map(h => `from:${h}`).join(' OR ');
  return `https://x.com/search?q=${encodeURIComponent(`(${coreBeat})`)}&src=typed_query&f=live`;
}

/**
 * Builds a 1-tap Live X (`x.com`) search URL for breaking beat updates on a specific 49ers player.
 */
export function buildXPlayerScoopSearchUrl(playerName = '') {
  const cleanName = String(playerName || '')
    .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
    .trim();
  if (!cleanName) return buildXBeatListSearchUrl('trusted');
  const q = `"${cleanName}" (49ers OR from:MaioccoNBCS OR from:nwagoner OR from:mattbarrows OR from:LombardiHimself OR from:Eric_Branch OR from:CamInman)`;
  return `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`;
}
