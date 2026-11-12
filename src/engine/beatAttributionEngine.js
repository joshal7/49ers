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
  { id: 'jonnydel', name: "Jonnydel's Football Academy", handle: '@jonnydelsfa', outletId: 'youtube_film', outletName: "Jonnydel's FA", trustTier: 2, credibilityScore: 93, aliases: ['jonnydel'] },
  { id: 'jt_osullivan', name: "JT O'Sullivan", handle: '@theqbschool', outletId: 'youtube_film', outletName: 'The QB School', trustTier: 2, credibilityScore: 92, aliases: ['the qb school', 'qb school'] },
  { id: 'chase_daniel', name: 'Chase Daniel', handle: '@ChaseDaniel', outletId: 'youtube_film', outletName: 'Chase Daniel Film', trustTier: 2, credibilityScore: 90, aliases: ["chase daniel and bussin' with the boys"] },
  { id: 'alex_rollins', name: 'Alex Rollins', handle: '@AlexRollinsNFL', outletId: 'youtube_film', outletName: 'Alex Rollins NFL', trustTier: 2, credibilityScore: 91, aliases: ['alex rollins nfl'] },
  { id: 'mike_florio', name: 'ProFootballTalk', handle: '@ProFootballTalk', outletId: 'nfl_network', outletName: 'NBC ProFootballTalk', trustTier: 2, credibilityScore: 88, aliases: ['mike florio', 'pft'] },
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

  // Tier 3: Viable Columnists, Camp & Sideline Observers (lower weight on opinion, full First-Mover elevation on acute injury observations)
  { id: 'dieter_kurtenbach', name: 'Dieter Kurtenbach', handle: '@dkurtenbach', outletId: 'bay_area_news', outletName: 'Bay Area News Group', trustTier: 3, credibilityScore: 80 },
  { id: 'larry_krueger', name: 'Larry Krueger', handle: '@sportslarryknbr', outletId: 'youtube_film', outletName: 'The Krueg Show', trustTier: 3, credibilityScore: 78 },
  { id: 'grant_cohn', name: 'Grant Cohn', handle: '@grantcohn', outletId: 'youtube_film', outletName: '49ers On SI', trustTier: 3, credibilityScore: 76 },
  { id: 'harrison_rich', name: 'Harrison Rich', handle: '@harrisonrich_', outletId: 'sf_chronicle', outletName: 'San Francisco Chronicle', trustTier: 2, credibilityScore: 88 },
  { id: 'dane_brugler', name: 'Dane Brugler', handle: '@dpbrugler', outletId: 'athletic', outletName: 'The Athletic Draft', trustTier: 1, credibilityScore: 95 },
  { id: 'mel_kiper', name: 'Mel Kiper Jr.', aliases: ['Mel Kiper'], handle: '@MelKiperESPN', outletId: 'espn', outletName: 'ESPN NFL Draft', trustTier: 2, credibilityScore: 88 },
  { id: 'daniel_jeremiah', name: 'Daniel Jeremiah', handle: '@MoveTheSticks', outletId: 'nfl_network', outletName: 'NFL Network', trustTier: 1, credibilityScore: 95 },
  { id: 'lance_zierlein', name: 'Lance Zierlein', handle: '@LanceZierlein', outletId: 'nfl_network', outletName: 'NFL.com Draft', trustTier: 1, credibilityScore: 93 },
  { id: 'todd_archer', name: 'Todd Archer', handle: '@toddarcher', outletId: 'espn', outletName: 'ESPN', trustTier: 1, credibilityScore: 93 },
  { id: 'jon_machota', name: 'Jon Machota', handle: '@jonmachota', outletId: 'athletic', outletName: 'The Athletic', trustTier: 2, credibilityScore: 91 },
  { id: 'calvin_watkins', name: 'Calvin Watkins', handle: '@calvinwatkins', outletId: 'national_nfl', outletName: 'Dallas Morning News', trustTier: 2, credibilityScore: 89 },
  { id: 'tommy_yarrish', name: 'Tommy Yarrish', handle: '@tommy_yarrish', outletId: 'national_nfl', outletName: 'DallasCowboys.com', trustTier: 2, credibilityScore: 89 },
  { id: 'patrik_walker', name: 'Patrik Walker', handle: '@VoiceOfTheStar', outletId: 'national_nfl', outletName: 'DallasCowboys.com', trustTier: 2, credibilityScore: 89 },
  { id: 'brady_henderson', name: 'Brady Henderson', handle: '@BradyHenderson', outletId: 'espn', outletName: 'ESPN', trustTier: 1, credibilityScore: 92 },
  { id: 'gregg_bell', name: 'Gregg Bell', handle: '@gbellseattle', outletId: 'national_nfl', outletName: 'Tacoma News Tribune', trustTier: 2, credibilityScore: 90 },
  { id: 'bob_condotta', name: 'Bob Condotta', handle: '@bcondotta', outletId: 'national_nfl', outletName: 'Seattle Times', trustTier: 2, credibilityScore: 90 },
  { id: 'michael_shawn_dugar', name: 'Michael-Shawn Dugar', handle: '@MikeDugar', outletId: 'athletic', outletName: 'The Athletic', trustTier: 2, credibilityScore: 90 },
  { id: 'jourdan_rodrigue', name: 'Jourdan Rodrigue', handle: '@JourdanRodrigue', outletId: 'athletic', outletName: 'The Athletic', trustTier: 1, credibilityScore: 94 },
  { id: 'sarah_barshop', name: 'Sarah Barshop', handle: '@sarahbarshop', outletId: 'espn', outletName: 'ESPN', trustTier: 2, credibilityScore: 90 },
  { id: 'gary_klein', name: 'Gary Klein', handle: '@LATimesklein', outletId: 'national_nfl', outletName: 'Los Angeles Times', trustTier: 2, credibilityScore: 90 },
  { id: 'stu_jackson', name: 'Stu Jackson', handle: '@StuJRams', outletId: 'national_nfl', outletName: 'TheRams.com', trustTier: 2, credibilityScore: 89 },
  { id: 'josh_weinfuss', name: 'Josh Weinfuss', handle: '@joshweinfuss', outletId: 'espn', outletName: 'ESPN', trustTier: 2, credibilityScore: 89 },
  { id: 'darren_urban', name: 'Darren Urban', handle: '@Cardschatter', outletId: 'national_nfl', outletName: 'AZCardinals.com', trustTier: 2, credibilityScore: 89 },
  { id: 'tyler_drake', name: 'Tyler Drake', handle: '@Tdrake4sports', outletId: 'national_nfl', outletName: 'Arizona Sports', trustTier: 2, credibilityScore: 88 },
  { id: 'tashan_reed', name: 'Tashan Reed', handle: '@tashanreed', outletId: 'athletic', outletName: 'The Athletic', trustTier: 2, credibilityScore: 90 },
  { id: 'vinny_bonsignore', name: 'Vinny Bonsignore', handle: '@VinnyBonsignore', outletId: 'national_nfl', outletName: 'Las Vegas Review-Journal', trustTier: 2, credibilityScore: 89 },
  { id: 'paul_gutierrez', name: 'Paul Gutierrez', handle: '@PGutierrezESPN', outletId: 'espn', outletName: 'ESPN', trustTier: 2, credibilityScore: 89 },
  { id: 'rob_demovsky', name: 'Rob Demovsky', handle: '@RobDemovsky', outletId: 'espn', outletName: 'ESPN', trustTier: 2, credibilityScore: 90 },
  { id: 'matt_schneidman', name: 'Matt Schneidman', handle: '@mattschneidman', outletId: 'athletic', outletName: 'The Athletic', trustTier: 2, credibilityScore: 90 },
  { id: 'courtney_cronin', name: 'Courtney Cronin', handle: '@CourtneyRCronin', outletId: 'espn', outletName: 'ESPN', trustTier: 2, credibilityScore: 91 },
  { id: 'colton_pouncy', name: 'Colton Pouncy', handle: '@colton_pouncy', outletId: 'athletic', outletName: 'The Athletic', trustTier: 2, credibilityScore: 90 },
  { id: 'john_keim', name: 'John Keim', handle: '@john_keim', outletId: 'espn', outletName: 'ESPN', trustTier: 1, credibilityScore: 92 },
  { id: 'nicki_jhabvala', name: 'Nicki Jhabvala', handle: '@NickiJhabvala', outletId: 'national_nfl', outletName: 'Washington Post', trustTier: 2, credibilityScore: 90 },
  { id: 'jeff_legwold', name: 'Jeff Legwold', handle: '@Jeff_Legwold', outletId: 'espn', outletName: 'ESPN', trustTier: 2, credibilityScore: 90 },
  { id: 'marc_raimondi', name: 'Marc Raimondi', handle: '@marcraimondi', outletId: 'espn', outletName: 'ESPN', trustTier: 2, credibilityScore: 89 },
  { id: 'marcel_louis_jacques', name: 'Marcel Louis-Jacques', handle: '@Marcel_LJ', outletId: 'espn', outletName: 'ESPN', trustTier: 2, credibilityScore: 90 }
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
  'shanahan',
  'john lynch',
  'lynch',
  'note',
  'watch',
  'video'
]);

export const PODIUM_SUBJECT_IDS = new Set(['kyle_shanahan', 'john_lynch']);

export function isPodiumSubjectId(reporterId = '') {
  return PODIUM_SUBJECT_IDS.has(String(reporterId || '').trim());
}

export const BSKY_ACTOR_TO_X_HANDLE = {
  'mattmaiocco.bsky.social': '@MaioccoNBCS',
  'mattbarrows.bsky.social': '@mattbarrows',
  'jenniferleechan.bsky.social': '@jenniferleechan',
  'timkawakami.bsky.social': '@timkawakami',
  'nbcs49ers.bsky.social': '@NBCS49ers',
  'nbcsportsbayarea.com': '@NBCSAuthentic',
  '49erswebzone.bsky.social': '@49erswebzone',
  'victafur.bsky.social': '@VicTafur',
  'adamscheftermirror.bsky.social': '@AdamSchefter',
  'rapsheet.bsky.social': '@RapSheet',
  'tompelissero.bsky.social': '@TomPelissero',
  'diannarussini.bsky.social': '@DMRussini',
  'profootballtalk.bsky.social': '@ProFootballTalk',
  'minakimes.bsky.social': '@minakimes',
  'nfltraderumors.bsky.social': '@nflrums',
  'insidenflnews.bsky.social': '@NFL',
  'nflnewsreposterbot.bsky.social': '@NFL'
};

export function extractXHandleFromBskyUrl(url = '') {
  const m = String(url || '').trim().match(/^https?:\/\/bsky\.app\/profile\/([^/?#]+)/i);
  if (!m) return '';
  const actor = m[1].toLowerCase();
  if (BSKY_ACTOR_TO_X_HANDLE[actor]) return BSKY_ACTOR_TO_X_HANDLE[actor];
  const prefix = actor.replace(/\.bsky\.social$/i, '').replace(/mirror$/i, '');
  const entry = resolveReporterFromNameOrHandle(prefix);
  return entry?.handle || '';
}

const OUTLET_DEFAULT_HUB_URLS = {
  espn: 'https://www.espn.com/nfl/team/_/name/sf/san-francisco-49ers',
  '49ers_official': 'https://www.49ers.com/news/',
  nbcsba: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/',
  sf_standard: 'https://sfstandard.com/sports/',
  niners_nation: 'https://www.ninersnation.com/',
  '49ers_webzone': 'https://www.49erswebzone.com/',
  pfrumors: 'https://www.profootballrumors.com/san-francisco-49ers',
  nfl_trade_rumors: 'https://nfltraderumors.co/',
  nfl_network: 'https://www.nfl.com/teams/san-francisco-49ers/',
  knbr_radio: 'https://www.knbr.com/49ers/'
};

/**
 * Resolves the authentic profile or outlet link for an item's author, strictly preventing
 * cross-reporter X profile mismatches (e.g., never linking "Dan Graziano" to "@nwagoner"
 * or "Kerry Crowley" to "@timkawakami", and never treating podium coaches as article authors).
 */
export function resolveItemAuthorProfileUrl(item = {}, fallbackUrl = null) {
  const authorStr = String(item?.author || item?.reporterName || '').trim();
  const matchedAuthor = authorStr ? resolveReporterFromNameOrHandle(authorStr) : null;
  if (matchedAuthor && !PODIUM_SUBJECT_IDS.has(matchedAuthor.id) && matchedAuthor.xUrl) {
    return matchedAuthor.xUrl;
  }

  const rawProfileUrl = String(item?.authorProfileUrl || '').trim();
  if (/^https?:\/\/bsky\.app\//i.test(rawProfileUrl)) {
    const mappedHandle = extractXHandleFromBskyUrl(rawProfileUrl).replace(/^@/, '');
    if (mappedHandle) return `https://x.com/${mappedHandle}`;
  } else if (rawProfileUrl) {
    const xHandleMatch = rawProfileUrl.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{2,25})\/?$/i);
    if (xHandleMatch) {
      const handleOwner = resolveReporterFromNameOrHandle(xHandleMatch[1]);
      if (handleOwner && authorStr) {
        const lowerAuth = authorStr.toLowerCase();
        const ownerLower = handleOwner.name.toLowerCase();
        const handleLower = handleOwner.handle.replace(/^@/, '').toLowerCase();
        const outletLower = String(handleOwner.outletName || '').toLowerCase();
        const isSameAuthorOrOrg =
          lowerAuth === ownerLower ||
          lowerAuth.includes(ownerLower) ||
          lowerAuth.replace(/^@/, '') === handleLower ||
          (PODIUM_SUBJECT_IDS.has(handleOwner.id) && /49ers|official/i.test(lowerAuth)) ||
          lowerAuth === outletLower;
        if (!isSameAuthorOrOrg) {
          return OUTLET_DEFAULT_HUB_URLS[item?.outletId] || fallbackUrl;
        }
      }
    }
    return rawProfileUrl;
  }

  const cleanHandle = String(item?.authorHandle || extractXHandleFromBskyUrl(item?.url) || '')
    .replace(/^@/, '')
    .trim();
  if (cleanHandle) {
    return `https://x.com/${cleanHandle}`;
  }

  const safeFallback =
    fallbackUrl && /^https?:\/\/bsky\.app\//i.test(String(fallbackUrl))
      ? 'https://x.com/49ers'
      : fallbackUrl;
  return OUTLET_DEFAULT_HUB_URLS[item?.outletId] || safeFallback;
}

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
    const isCustomExternalWriter = Boolean(customName);
    const cleanFallbackHandle = isCustomExternalWriter ? '' : String(fallback.authorHandle || '').replace(/^@/, '');
    const fallbackXUrl = cleanFallbackHandle
      ? `https://x.com/${cleanFallbackHandle}`
      : isCustomExternalWriter
        ? `https://x.com/search?q=${encodeURIComponent(`"${customName}" 49ers`)}&src=typed_query&f=live`
        : null;
    const customSlug = isCustomExternalWriter
      ? `ext_${String(customName).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`
      : null;
    return {
      cleanedText: cleanedBody || original,
      reporterId: customSlug || fallback.reporterId || null,
      reporterName: finalName,
      author: finalName,
      authorHandle: isCustomExternalWriter ? '' : fallback.authorHandle || '',
      xUrl: fallbackXUrl,
      authorProfileUrl: fallbackXUrl || (isCustomExternalWriter ? null : fallback.authorProfileUrl || null),
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
        if (matched && !PODIUM_SUBJECT_IDS.has(matched.id)) {
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
        if (PODIUM_SUBJECT_IDS.has(matched.id)) continue;
        return buildResult(matched, original, null, null, true);
      }
      // Valid 2-word capitalized reporter name from wire (e.g. "Brooke Evans", "Paul Gutierrez")
      if (
        /^[A-Z][a-z'.-]+\s+[A-Z][a-z'.-]+$/.test(candidatePerson) &&
        !/\b(Head Coach|General Manager|San Francisco|Las Vegas|Kyle Shanahan|John Lynch|Robert Saleh|Raheem Morris|Brock Purdy)\b/i.test(candidatePerson)
      ) {
        return buildResult(null, original, candidatePerson, candidateOutlet, true);
      }
    }
  }

  return buildResult(fallbackEntry && !PODIUM_SUBJECT_IDS.has(fallbackEntry.id) ? fallbackEntry : null, original);
}

const ACUTE_INJURY_OBSERVATION_REGEX =
  /\b(questionable to return|probable to return|doubtful to return|ruled out|will not return|out for the rest|cleared to return|back in the game|returning to the game|returned to the game|medical tent|blue tent|locker room|carted off|limped off|limping|helped off|athletic trainer|with trainers|examined on the sideline|helmet off|concussion evaluation|concussion protocol|not practicing|not seen at practice|missed practice|side field|rehab field|working on a side|in warmups|pregame warmups|during warmups|non-contact jersey|blue non-contact|walking boot|setback|aggravated|re-aggravated|tweaked|mri|x-ray|high-ankle|meniscus|acl|mcl|achilles|pectoral|activated from injured reserve|activated off ir|activated from ir|21-day practice window|designated to return|placed on injured reserve|placed on ir|didn't activate|did not activate|game-time decision|officially active|officially inactive|full workload|no limitations)\b/i;

const SPECULATIVE_EXCLUSION_REGEX =
  /\b(mock trade|trade proposal|trade idea|trade pitch|hypothetical|what if|flashback|on this day|\d+\s+years ago|way-too-early|mailbag)\b/i;

const SECONDARY_OR_TRIVIA_TOPIC_EXCLUSION_REGEX =
  /\b(explains? why|reveals? (?:why|what)|freely gave|jersey (?:no\.|number)|addresses? (?:past )?beef|beef [\s\S]{0,25}(?:squashed|past)|feud resurfaces|called (?:the 49ers )?(?:about|to inquire)|inquired about|on (?:their )?trade radar|were eyeing a trade|traded for a reason|just because people are trading|isn['’]?t surprising|not (?:a )?(?:particularly )?surprising|wife celebrates|makes? strong statement|drops? strong [\s\S]{0,20}statement)\b/i;

function extractPrimaryLeadClaim(item = {}) {
  const isTw = item?.type === 'tweet' || item?.type === 'social';
  const raw = isTw
    ? String(item?.fullText || item?.title || item?.headline || '').trim()
    : String(item?.title || item?.headline || '').trim();
  if (!raw) return '';
  const masked = raw
    .replace(/\b([A-Z])\.([A-Z])\./g, '$1\u0000$2\u0000')
    .replace(/\b([A-Z])\.(?=\s+[A-Z])/g, '$1\u0000')
    .replace(/\b(vs|no|st|jr|sr|mr|dr|mt)\./gi, '$1\u0000');
  const m = masked.match(/^[\s\S]{10,240}?[.!?](?=\s+[A-Z"“]|$)/);
  const picked = m ? m[0].trim() : masked.slice(0, 240).trim();
  return picked.replace(/\u0000/g, '.');
}

/**
 * Returns true if the text describes a concrete, actionable player injury, practice, warmup,
 * or game-availability observation (eligible for First-Mover Injury Scoop elevation).
 */
export function isAcuteInjuryOrAvailabilityScoop(text = '') {
  const clean = String(text || '').trim();
  if (!clean || SPECULATIVE_EXCLUSION_REGEX.test(clean) || SECONDARY_OR_TRIVIA_TOPIC_EXCLUSION_REGEX.test(clean)) {
    return false;
  }
  return ACUTE_INJURY_OBSERVATION_REGEX.test(clean);
}

function classifyWireEventTopic(text = '') {
  const s = String(text || '').trim();
  if (!s || SPECULATIVE_EXCLUSION_REGEX.test(s) || SECONDARY_OR_TRIVIA_TOPIC_EXCLUSION_REGEX.test(s)) {
    return null;
  }
  if (/\b(activated (?:from|off)|placed on (?:ir|injured reserve)|21-day|practice window|designate[sd]? [\s\S]{0,35}(?:for|to) return)\b/i.test(s)) {
    return 'roster_ir_tx';
  }
  if (/\b(\btrade[!: ]|agree[sd]? to (?:a )?trade|completing a trade|finalizing a trade|sending [\s\S]{0,55}to (?:the )?(?:49ers|san francisco|niners)|traded (?:to|for)|(?:49ers|san francisco|niners) (?:officially )?(?:acquire[sd]?|acquiring|re-acquir(?:e[sd]?|ing)|sign(?:ed|s)?|re-sign(?:ed|s)?|waive[sd]?|release[sd]?|claim(?:ed|s)?)|practice squad)\b/i.test(s)) {
    return 'roster_tx_move';
  }
  if (isAcuteInjuryOrAvailabilityScoop(s)) {
    return 'acute_injury';
  }
  if (/\b(restructure[sd]?|cap space|contract extension|signed a \d+-year|signs a \d+-year)\b/i.test(s)) {
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
    const rawDirEntry = resolveReporterFromNameOrHandle(it.author || it.reporterName || it.authorHandle || it.reporterId);
    const dirEntry = rawDirEntry && !PODIUM_SUBJECT_IDS.has(rawDirEntry.id) ? rawDirEntry : null;
    const trustTier = Number(it.trustTier) || rawDirEntry?.trustTier || 2;
    const credibilityScore = Number(it.credibilityScore) || rawDirEntry?.credibilityScore || 86;
    const leadClaimText = extractPrimaryLeadClaim(it);
    const combinedText = `${it.title || it.headline || ''} ${it.fullText || ''} ${it.summary || ''}`.trim();
    const eventTopic = it.type === 'video' ? null : classifyWireEventTopic(leadClaimText);
    const explicitPlayerKeys = Array.isArray(it.mentionedPlayers)
      ? it.mentionedPlayers.map(mp => String(mp.name || mp.id || '').toLowerCase()).filter(Boolean)
      : [];
    const playerKeys = explicitPlayerKeys.length > 0 ? explicitPlayerKeys : extractFallbackPlayerKeys(leadClaimText || combinedText);
    const pubMs = it.publishedAt ? new Date(it.publishedAt).getTime() : NaN;
    return {
      ...it,
      trustTier,
      credibilityScore,
      authorHandle: it.authorHandle || dirEntry?.handle || '',
      authorProfileUrl: resolveItemAuthorProfileUrl(it, it.url || null),
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
      (firstItem._eventTopic === 'acute_injury' ||
        firstItem._eventTopic === 'roster_ir_tx' ||
        firstItem._eventTopic === 'roster_tx_move') &&
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

export const MAX_X_SEARCH_RAW_QUERY_LENGTH = 500;

/**
 * League-wide NFL insiders, draft evaluators, and national film/analytics voices in Settings (`5. Beat Reporters & Analysts`).
 * Scoped with 49ers keywords (`(49ers OR Niners OR Shanahan OR Lynch OR Purdy)`) on X so non-49ers league chatter never floods the feed.
 */
export const NATIONAL_NFL_SETTINGS_REPORTER_IDS = new Set([
  'adam_schefter',
  'ian_rapoport',
  'tom_pelissero',
  'mike_garafolo',
  'dianna_russini',
  'jeremy_fowler',
  'albert_breer',
  'field_yates',
  'jordan_schultz',
  'dane_brugler',
  'daniel_jeremiah',
  'ben_solak',
  'jt_osullivan',
  'mina_kimes',
  'brett_kollmann'
]);

/**
 * Canonical fallback seed matching all 49 Tier 1–3 reporters & analysts in `Settings -> 5. Beat Reporters & Analysts`
 * (`data/reporters.json`), used whenever live `appData.reporters.reporters` is not passed explicitly.
 */
export const SETTINGS_DIRECT_X_REPORTER_SEEDS = [
  // Local 49ers Beat & Official Voices (Tiers 1–3: 21 entries, 20 unique X handles)
  { id: 'kyle_shanahan', handle: '@49ers', outletId: '49ers_official', category: 'official', styleTag: 'factual-scheme', trustTier: 1 },
  { id: '49ers_news', handle: '@49ers', outletId: '49ers_official', category: 'official', styleTag: 'factual-beat', trustTier: 1 },
  { id: 'john_lynch', handle: '@JohnLynch49ers', outletId: '49ers_official', category: 'official', styleTag: 'factual-roster', trustTier: 1 },
  { id: 'brianna_jeannel', handle: '@BrianaJeannel', outletId: '49ers_official', category: 'official', styleTag: 'factual-beat', trustTier: 1 },
  { id: 'matt_maiocco', handle: '@MaioccoNBCS', outletId: 'nbcsba', category: 'beat', styleTag: 'factual-beat', trustTier: 1 },
  { id: 'nick_wagoner', handle: '@nwagoner', outletId: 'espn', category: 'beat', styleTag: 'factual-beat', trustTier: 1 },
  { id: 'jennifer_lee_chan', handle: '@jenniferleechan', outletId: 'nbcsba', category: 'beat', styleTag: 'factual-beat', trustTier: 1 },
  { id: 'matt_barrows', handle: '@mattbarrows', outletId: 'athletic', category: 'beat', styleTag: 'factual-beat', trustTier: 1 },
  { id: 'david_lombardi', handle: '@LombardiHimself', outletId: 'sf_standard', category: 'beat', styleTag: 'analytics-cap', trustTier: 1 },
  { id: 'eric_branch', handle: '@Eric_Branch', outletId: 'sf_chronicle', category: 'beat', styleTag: 'factual-beat', trustTier: 1 },
  { id: 'cam_inman', handle: '@CamInman', outletId: 'bay_area_news', category: 'beat', styleTag: 'factual-beat', trustTier: 1 },
  { id: 'sam_warren', handle: '@SamWarren_SF', outletId: 'athletic', category: 'beat', styleTag: 'factual-beat', trustTier: 2 },
  { id: 'noah_furtado', handle: '@noah_furtado', outletId: 'sf_chronicle', category: 'beat', styleTag: 'factual-beat', trustTier: 2 },
  { id: 'rohan_chakravarthi', handle: '@RohanChakrav', outletId: 'niners_nation', category: 'beat', styleTag: 'analytics-cap', trustTier: 2 },
  { id: 'chris_biderman', handle: '@ChrisBiderman', outletId: 'bay_area_news', category: 'beat', styleTag: 'factual-beat', trustTier: 2 },
  { id: 'greg_papa', handle: '@GregPapa', outletId: 'knbr_radio', category: 'beat', styleTag: 'factual-beat', trustTier: 2 },
  { id: 'tim_kawakami', handle: '@timkawakami', outletId: 'sf_standard', category: 'beat', styleTag: 'columnist-insider', trustTier: 2 },
  { id: 'vic_tafur', handle: '@VicTafur', outletId: 'athletic', category: 'beat', styleTag: 'factual-beat', trustTier: 2 },
  { id: 'al_sacco', handle: '@AlSacco49', outletId: '49ers_webzone', category: 'beat', styleTag: 'factual-beat', trustTier: 2 },
  { id: 'dieter_kurtenbach', handle: '@dkurtenbach', outletId: 'bay_area_news', category: 'beat', styleTag: 'opinion-hot-take', trustTier: 3 },
  { id: 'grant_cohn', handle: '@grantcohn', outletId: 'youtube_film', category: 'beat', styleTag: 'opinion-hot-take', trustTier: 3 },

  // Dedicated 49ers Film, Analytics & Podcast Voices (Tiers 2–3: 13 unique X handles)
  { id: 'kyle_posey', handle: '@KP_Show', outletId: 'niners_nation', category: 'film', styleTag: 'film-breakdown', trustTier: 2 },
  { id: 'jonnydel', handle: '@jonnydelsfa', outletId: 'youtube_film', category: 'film', styleTag: 'film-breakdown', trustTier: 2 },
  { id: 'tim_ryan', handle: '@TimRyan49ers', outletId: 'knbr_radio', category: 'film', styleTag: 'film-breakdown', trustTier: 2 },
  { id: 'guy_haberman', handle: '@GuyHaberman', outletId: 'youtube_film', category: 'video_pod', styleTag: 'analytical-pod', trustTier: 2 },
  { id: 'eric_crocker', handle: '@eric_crocker', outletId: 'youtube_film', category: 'film', styleTag: 'film-breakdown', trustTier: 2 },
  { id: 'jason_aponte', handle: '@JasonAponte2103', outletId: 'youtube_film', category: 'film', styleTag: 'film-breakdown', trustTier: 2 },
  { id: 'john_chapman', handle: '@JL_Chapman', outletId: 'youtube_film', category: 'film', styleTag: 'film-breakdown', trustTier: 2 },
  { id: 'jeff_deeney', handle: '@PFF_Jeff', outletId: 'youtube_film', category: 'analytics', styleTag: 'analytics-cap', trustTier: 2 },
  { id: 'akash_anavarathan', handle: '@akashanav', outletId: 'youtube_film', category: 'analytics', styleTag: 'analytics-cap', trustTier: 2 },
  { id: 'brad_graham', handle: '@TheSFNiners', outletId: 'youtube_film', category: 'video_pod', styleTag: 'factual-beat', trustTier: 2 },
  { id: 'vish_kumaran', handle: '@VishKumaran', outletId: 'niners_nation', category: 'film', styleTag: 'film-breakdown', trustTier: 2 },
  { id: 'steph_sanchez', handle: '@Steph49K', outletId: 'youtube_film', category: 'analytics', styleTag: 'analytics-cap', trustTier: 2 },
  { id: 'larry_krueger', handle: '@sportslarryknbr', outletId: 'youtube_film', category: 'video_pod', styleTag: 'opinion-hot-take', trustTier: 3 },

  // National NFL Insiders, Draft Evaluators & League-Wide Film/Analytics Voices (Tiers 1–2: 15 unique X handles)
  { id: 'adam_schefter', handle: '@AdamSchefter', outletId: 'espn', category: 'national_insider', styleTag: 'factual-roster', trustTier: 1 },
  { id: 'ian_rapoport', handle: '@RapSheet', outletId: 'nfl_network', category: 'national_insider', styleTag: 'factual-roster', trustTier: 1 },
  { id: 'tom_pelissero', handle: '@TomPelissero', outletId: 'nfl_network', category: 'national_insider', styleTag: 'factual-roster', trustTier: 1 },
  { id: 'mike_garafolo', handle: '@MikeGarafolo', outletId: 'nfl_network', category: 'national_insider', styleTag: 'factual-roster', trustTier: 1 },
  { id: 'dane_brugler', handle: '@dpbrugler', outletId: 'athletic', category: 'draft', styleTag: 'film-breakdown', trustTier: 1 },
  { id: 'daniel_jeremiah', handle: '@MoveTheSticks', outletId: 'nfl_network', category: 'draft', styleTag: 'film-breakdown', trustTier: 1 },
  { id: 'dianna_russini', handle: '@DMRussini', outletId: 'athletic', category: 'national_insider', styleTag: 'factual-roster', trustTier: 2 },
  { id: 'jeremy_fowler', handle: '@JFowlerESPN', outletId: 'espn', category: 'national_insider', styleTag: 'factual-roster', trustTier: 2 },
  { id: 'albert_breer', handle: '@AlbertBreer', outletId: 'nfl_network', category: 'national_insider', styleTag: 'factual-scheme', trustTier: 2 },
  { id: 'field_yates', handle: '@FieldYates', outletId: 'espn', category: 'national_insider', styleTag: 'analytics-cap', trustTier: 2 },
  { id: 'jordan_schultz', handle: '@Schultz_Report', outletId: 'nfl_network', category: 'national_insider', styleTag: 'factual-roster', trustTier: 2 },
  { id: 'ben_solak', handle: '@BenjaminSolak', outletId: 'espn', category: 'film', styleTag: 'film-breakdown', trustTier: 2 },
  { id: 'jt_osullivan', handle: '@theqbschool', outletId: 'youtube_film', category: 'film', styleTag: 'film-breakdown', trustTier: 2 },
  { id: 'mina_kimes', handle: '@minakimes', outletId: 'espn', category: 'analytics', styleTag: 'film-breakdown', trustTier: 2 },
  { id: 'brett_kollmann', handle: '@BrettKollmann', outletId: 'youtube_film', category: 'film', styleTag: 'film-breakdown', trustTier: 2 }
];

export const TOP_TRUSTED_49ERS_X_HANDLES = Array.from(
  new Set(
    SETTINGS_DIRECT_X_REPORTER_SEEDS
      .filter(r => !NATIONAL_NFL_SETTINGS_REPORTER_IDS.has(r.id) && (r.category === 'beat' || r.category === 'official'))
      .map(r => r.handle.replace(/^@/, ''))
  )
);

export const ALL_VIABLE_49ERS_INJURY_X_HANDLES = [
  'MaioccoNBCS',
  'nwagoner',
  'mattbarrows',
  'LombardiHimself',
  'jenniferleechan',
  'Eric_Branch',
  'CamInman',
  'BrianaJeannel',
  '49ers',
  'SamWarren_SF',
  'noah_furtado',
  'ChrisBiderman',
  'GregPapa',
  'timkawakami',
  'VicTafur',
  'AlSacco49',
  'TheSFNiners',
  'dkurtenbach',
  'sportslarryknbr',
  'grantcohn'
];

/**
 * Resolves the enabled Settings (`5. Beat Reporters & Analysts`) Tier 1–3 entries after applying
 * user mute preferences (`disabledReporterIds`, `disabledOutlets`, and `muteHotTakePersonalities`).
 */
export function resolveEnabledDirectXReporters({
  reporters = null,
  userPrefs = null,
  includeHotTakes = false
} = {}) {
  const sourceList =
    Array.isArray(reporters) && reporters.length > 0 ? reporters : SETTINGS_DIRECT_X_REPORTER_SEEDS;
  const disabledReps = new Set(userPrefs?.disabledReporterIds || []);
  const disabledOutlets = new Set(userPrefs?.disabledOutlets || []);
  const muteHotTakes = !includeHotTakes && Boolean(userPrefs?.muteHotTakePersonalities);

  return sourceList.filter(r => {
    if (!r || !r.handle) return false;
    if (r.id && disabledReps.has(r.id)) return false;
    if (r.outletId && disabledOutlets.has(r.outletId)) return false;
    if (muteHotTakes && r.styleTag === 'opinion-hot-take') return false;
    const tier = Number(r.trustTier) || getReporterTrustTier(r.id);
    return tier >= 1 && tier <= 3;
  });
}

function packXSearchQueryWithinBudget(handles = [], suffixClause = '', maxChars = MAX_X_SEARCH_RAW_QUERY_LENGTH) {
  const seen = new Set();
  const cleanHandles = [];
  for (const h of handles) {
    const clean = String(h || '').replace(/^@/, '').trim();
    if (!clean) continue;
    const lower = clean.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    cleanHandles.push(clean);
  }
  if (cleanHandles.length === 0) {
    cleanHandles.push('49ers');
  }

  const suffix = suffixClause ? ` ${suffixClause.trim()}` : '';
  const selected = [];
  for (const h of cleanHandles) {
    const next = [...selected, `from:${h}`];
    const candidateQuery = `(${next.join(' OR ')})${suffix}`;
    if (candidateQuery.length > maxChars && selected.length > 0) {
      break;
    }
    selected.push(`from:${h}`);
  }
  return `(${selected.join(' OR ')})${suffix}`;
}

/**
 * Builds a 1-tap Live X (`x.com`) search URL sorted by Latest (`f=live`) across ALL enabled Tier 1–3
 * reporters & analysts in `Settings -> 5. Beat Reporters & Analysts`, partitioned cleanly so every
 * link stays strictly under X's 512-character `rawQuery` limit and national NFL voices stay 49ers-scoped:
 * - `'trusted'`: All Tier 1–3 local 49ers Beat Reporters, Columnists, Broadcast & Official Team handles
 * - `'film'`: All Tier 1–3 dedicated 49ers Film, Analytics & Podcast Analysts
 * - `'injuries'`: Tier 1–3 49ers Beat, Official & Camp Sideline observers filtered for acute injury/practice scoops
 * - `'insiders'`: All Tier 1–3 National NFL Insiders, Draft Evaluators & League-Wide Analysts scoped to 49ers
 */
export function buildXBeatListSearchUrl(mode = 'trusted', options = {}) {
  const isNationalReporter = r =>
    NATIONAL_NFL_SETTINGS_REPORTER_IDS.has(r.id) ||
    r.category === 'national_insider' ||
    r.category === 'draft';

  if (mode === 'injuries') {
    const enabled = resolveEnabledDirectXReporters({ ...options, includeHotTakes: true });
    // Prioritize frontline beat/sideline injury reporters first so the 500-char budget always keeps acute practice/warmup voices
    const priorityOrder = new Map(ALL_VIABLE_49ERS_INJURY_X_HANDLES.map((h, idx) => [h.toLowerCase(), idx]));
    const injuryCandidates = enabled
      .filter(
        r =>
          !isNationalReporter(r) &&
          (r.category === 'beat' ||
            r.category === 'official' ||
            priorityOrder.has(String(r.handle || '').replace(/^@/, '').toLowerCase()))
      )
      .sort((a, b) => {
        const ha = String(a.handle || '').replace(/^@/, '').toLowerCase();
        const hb = String(b.handle || '').replace(/^@/, '').toLowerCase();
        const pa = priorityOrder.has(ha) ? priorityOrder.get(ha) : 999;
        const pb = priorityOrder.has(hb) ? priorityOrder.get(hb) : 999;
        return pa - pb || (Number(a.trustTier) || 2) - (Number(b.trustTier) || 2);
      })
      .map(r => r.handle);
    const q = packXSearchQueryWithinBudget(
      injuryCandidates,
      '(injury OR tent OR practice OR questionable OR return OR IR OR warmups OR DNP)'
    );
    return `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`;
  }

  const enabled = resolveEnabledDirectXReporters(options);

  if (mode === 'insiders') {
    const nationalHandles = enabled.filter(isNationalReporter).map(r => r.handle);
    const q = packXSearchQueryWithinBudget(
      nationalHandles,
      '(49ers OR Niners OR Shanahan OR Lynch OR Purdy)'
    );
    return `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`;
  }

  if (mode === 'film') {
    const localFilmAndAnalyticsHandles = enabled
      .filter(r => !isNationalReporter(r) && r.category !== 'beat' && r.category !== 'official')
      .map(r => r.handle);
    const q = packXSearchQueryWithinBudget(localFilmAndAnalyticsHandles);
    return `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`;
  }

  // Default `'trusted'`: All enabled Tier 1–3 local 49ers Beat Reporters & Official Team Voices
  const localBeatHandles = enabled
    .filter(r => !isNationalReporter(r) && (r.category === 'beat' || r.category === 'official'))
    .map(r => r.handle);
  const q = packXSearchQueryWithinBudget(localBeatHandles);
  return `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`;
}

/**
 * Builds a 1-tap Live X (`x.com`) search URL for breaking beat updates on a specific 49ers player.
 */
export function buildXPlayerScoopSearchUrl(playerName = '') {
  const cleanName = String(playerName || '')
    .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
    .trim();
  if (!cleanName) return buildXBeatListSearchUrl('trusted');
  const dotlessName = cleanName.replace(/\b([A-Za-z])\.([A-Za-z])\./g, '$1$2');
  const nameClause = dotlessName !== cleanName ? `("${cleanName}" OR "${dotlessName}")` : `"${cleanName}"`;
  const q = `${nameClause} (49ers OR Niners OR from:MaioccoNBCS OR from:nwagoner OR from:LombardiHimself OR from:jenniferleechan OR from:Eric_Branch OR from:CamInman)`;
  return `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`;
}

/**
 * Decodes a 64-bit X/Twitter Snowflake status ID into its exact UTC creation timestamp (ms).
 */
export function extractXSnowflakeTimestampMs(tweetId = '') {
  const clean = String(tweetId || '').trim();
  if (!/^\d{15,22}$/.test(clean)) return null;
  try {
    const ms = Number((BigInt(clean) >> 22n) + 1288834974657n);
    return Number.isFinite(ms) && ms > 1_288_834_974_657 ? ms : null;
  } catch {
    return null;
  }
}

/**
 * Returns true if `url` points to a generic ESPN player bio/profile page (`/nfl/player/_/id/...`),
 * which should NEVER be used as the destination link for a tweet.
 */
export function isEspnPlayerProfileUrl(url = '') {
  return /^https?:\/\/(?:www\.|m\.)?espn\.com\/nfl\/player\/_\/id\/\d+/i.test(String(url || '').trim());
}

/**
 * Reporters whose daily beat social posts live on Bluesky rather than X (`from:<handle>` on X returns 0 results).
 */
export const BLUESKY_PRIMARY_REPORTER_IDS = new Set([
  'matt_barrows',
  'tim_kawakami',
  'vic_tafur'
]);

/**
 * Returns true if `url` is a verified direct social post permalink (`x.com/<handle>/status/<id>` or
 * `bsky.app/profile/<actor>/post/<rkey>`), a RotoWire player news permalink, or an official 49ers transaction entry.
 */
export function isDirectSocialPostUrl(url = '') {
  const clean = String(url || '').trim();
  if (/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/i.test(clean)) return true;
  if (/^https?:\/\/bsky\.app\/profile\/[^/?#]+\/post\/[A-Za-z0-9]+/i.test(clean)) return true;
  if (/^https?:\/\/(?:www\.)?49ers\.com\/team\/transactions\//i.test(clean)) return true;
  if (/^https?:\/\/(?:www\.)?rotowire\.com\/+football\/player\/[a-z0-9-]+/i.test(clean)) return true;
  return false;
}

const NON_PLAYER_TWO_WORD_PHRASES = new Set([
  'san francisco',
  'santa clara',
  'bay area',
  'sports bay',
  'las vegas',
  'los angeles',
  'new york',
  'new orleans',
  'green bay',
  'kansas city',
  'tampa bay',
  'new england',
  'dallas cowboys',
  'seattle seahawks',
  'arizona cardinals',
  'kyle shanahan',
  'john lynch',
  'robert saleh',
  'gus bradley',
  'klay kubiak',
  'klint kubiak',
  'super bowl',
  'pro bowl',
  'head coach',
  'practice squad',
  'injured reserve',
  'active roster',
  'medical tent',
  'blue tent',
  'locker room',
  'nfl network',
  'associated press',
  'the athletic',
  'niners nation'
]);

/**
 * Builds a precision X (`x.com`) tweet lookup URL (`from:<handle> "<PlayerSurname>" since:YYYY-MM-DD`)
 * so wire-cited tweets and Bluesky mirrors open directly on the reporter's original post on X.
 */
export function buildTargetedOriginalTweetUrl({
  authorHandle = '',
  authorName = '',
  playerName = '',
  text = '',
  publishedAt = ''
} = {}) {
  const resolvedEntry = resolveReporterFromNameOrHandle(authorHandle || authorName);
  const cleanHandle = String(authorHandle || resolvedEntry?.handle || '')
    .replace(/^@/, '')
    .trim();

  const cleanText = String(text || '').trim();
  const leadBodySubjectMatch = cleanText.match(
    /\b([A-Z][A-Za-z'.-]{2,18})\s+\((?:ankle|knee|hamstring|achilles|groin|shoulder|back|foot|calf|quad|hip|wrist|hand|thumb|rib|ribs|neck|illness|concussion|pectoral|biceps|triceps|oblique|toe|elbow|lower leg|leg|head|shin|nir|rest|personal)[^)]*\)/i
  );
  const textSubjectSurname =
    leadBodySubjectMatch && !/^(The|San|Las|Los|New|Week|Sunday|Monday|Friday|Coach)$/i.test(leadBodySubjectMatch[1])
      ? leadBodySubjectMatch[1].replace(/\b(?:Jr\.?|Sr\.?|II|III|IV|V)\b\.?$/i, '').trim()
      : '';

  const cleanPlayer = String(playerName || '')
    .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
    .trim();
  const surname = cleanPlayer ? cleanPlayer.split(/\s+/).slice(-1)[0] : '';

  let focusTerm =
    textSubjectSurname && textSubjectSurname.length >= 3
      ? textSubjectSurname
      : surname && surname.length >= 3
        ? surname
        : '';
  if (!focusTerm && cleanText) {
    const twoWordMatches = cleanText.matchAll(/\b([A-Z][a-z'.-]{2,15})\s+([A-Z][A-Za-z'.-]{2,18})\b/g);
    for (const m of twoWordMatches) {
      const w1 = m[1];
      const w2 = m[2].replace(/\b(?:Jr\.?|Sr\.?|II|III|IV|V)\b\.?$/i, '').trim();
      const pairLower = `${w1} ${w2}`.toLowerCase();
      if (
        w2.length >= 3 &&
        !NON_PLAYER_TWO_WORD_PHRASES.has(pairLower) &&
        !/^(The|San|Las|Los|New|Week|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Coach|Head|Rookie|Veteran|Injury|Update)$/i.test(w1) &&
        !/^(Stadium|Update|Report|Practice|Quarter|Season|Offense|Defense|Special|Teams|Raiders|Cowboys|Seahawks|Rams|Cardinals|Niners)$/i.test(w2)
      ) {
        focusTerm = w2;
        break;
      }
    }
  }
  if (!focusTerm && cleanText) {
    const leadProper = cleanText.match(/^([A-Z][a-z'.-]{2,18})\b/);
  if (
    leadProper &&
    !/^(The|San|Las|Los|New|Head|Coach|Week|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Rookie|Veteran|Starter|Backup|Injury|Update|Breaking|Practice|Report|Source|Sources|Official|Niners|Today|Tomorrow|Yesterday|Here|There|After|Before|During|Despite|While|With|From|More|Pretty|Just|Watch|Teams|Another|If|Welcome|Agent)$/i.test(
      leadProper[1]
    )
  ) {
    focusTerm = leadProper[1];
  }
}

let sinceClause = '';
const pubMs = publishedAt ? Date.parse(publishedAt) : NaN;
if (Number.isFinite(pubMs)) {
  const sinceIso = new Date(pubMs - 36 * 3_600_000).toISOString().slice(0, 10);
  sinceClause = ` since:${sinceIso}`;
}

// Never lock X search to `from:<handle>` for Bluesky-primary writers who do not post daily updates on X
if (resolvedEntry && BLUESKY_PRIMARY_REPORTER_IDS.has(resolvedEntry.id)) {
  if (cleanPlayer) return buildXPlayerScoopSearchUrl(cleanPlayer);
  if (focusTerm) return buildXPlayerScoopSearchUrl(focusTerm);
  return buildXBeatListSearchUrl('trusted');
}

if (cleanHandle) {
  const q = focusTerm ? `from:${cleanHandle} "${focusTerm}"${sinceClause}` : `from:${cleanHandle} 49ers${sinceClause}`;
  return `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`;
}

  const cleanAuthor = String(authorName || '').trim();
  if (cleanAuthor && cleanAuthor.length >= 4 && !/beat wire|espn|rotowire/i.test(cleanAuthor)) {
    const q = focusTerm ? `"${cleanAuthor}" "${focusTerm}"${sinceClause}` : `"${cleanAuthor}" 49ers${sinceClause}`;
    return `https://x.com/search?q=${encodeURIComponent(q)}&src=typed_query&f=live`;
  }

  if (cleanPlayer) {
    return buildXPlayerScoopSearchUrl(cleanPlayer);
  }
  return buildXBeatListSearchUrl('trusted');
}

/**
 * Resolves the best authentic destination permalink for a social/wire item:
 * 1. Preserves real direct `x.com/<handle>/status/<id>` (upgrading `twitter.com` -> `x.com`) URLs.
 * 2. Cross-matches against `directSocialPosts` for a matching direct `x.com/<handle>/status/<id>` or
 *    `bsky.app/profile/<actor>/post/<rkey>` post by the same reporter within 10 hours.
 * 3. Preserves real direct `bsky.app/profile/<actor>/post/<rkey>`, `rotowire.com/football/player/...`,
 *    `49ers.com/team/transactions/...`, and verified article URLs so live permalinks are never overwritten by dead searches.
 * 4. Falls back to `buildTargetedOriginalTweetUrl` only when a tweet item has no direct post URL.
 */
export function resolveOriginalTweetUrl(item = {}, directSocialPosts = []) {
  const rawUrl = String(item?.url || '').trim();
  if (/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/i.test(rawUrl)) {
    const m = rawUrl.match(/\/([A-Za-z0-9_]+)\/status\/(\d+)/i);
    return `https://x.com/${m[1]}/status/${m[2]}`;
  }
  if (/^https?:\/\/(?:www\.)?49ers\.com\/team\/transactions\//i.test(rawUrl)) {
    return rawUrl.startsWith('http://') ? `https://${rawUrl.slice(7)}` : rawUrl;
  }
  if (/^https?:\/\/(?:www\.)?rotowire\.com\/+football\/player\/[a-z0-9-]+/i.test(rawUrl)) {
    const httpsRw = rawUrl.startsWith('http://') ? `https://${rawUrl.slice(7)}` : rawUrl;
    return httpsRw.replace(/^(https:\/\/[^/?#]+)\/\/+/i, '$1/');
  }

  // Preserve direct ESPN full story URLs
  if (/^https?:\/\/(?:www\.|m\.)?espn\.com\/nfl\/story\/_\/id\/\d+/i.test(rawUrl)) {
    return rawUrl.startsWith('http://') ? `https://${rawUrl.slice(7)}` : rawUrl;
  }

  // For non-tweet article items (including ESPN Injury Wire articles with #:~:text= anchors), keep their HTTPS URL
  if (
    rawUrl &&
    !/^https?:\/\/bsky\.app\//i.test(rawUrl) &&
    item?.type !== 'tweet' &&
    item?.type !== 'social'
  ) {
    return rawUrl.startsWith('http://') ? `https://${rawUrl.slice(7)}` : rawUrl;
  }

  const primaryPlayerName =
    item?.mentionedPlayers?.[0]?.name ||
    item?.primaryPlayer?.name ||
    '';
  const normPlayer = primaryPlayerName
    .toLowerCase()
    .replace(/\b(jr\.?|sr\.?|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  const surname = primaryPlayerName
    .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV|V)$/i, '')
    .trim()
    .split(/\s+/)
    .slice(-1)[0]
    ?.toLowerCase();

  const bskyHandleFallback = extractXHandleFromBskyUrl(rawUrl) || extractXHandleFromBskyUrl(item?.authorProfileUrl);
  const itemAuthorEntry = resolveReporterFromNameOrHandle(
    item?.reporterId || item?.authorHandle || bskyHandleFallback || item?.author || item?.reporterName
  );
  const effectiveHandle = item?.authorHandle || itemAuthorEntry?.handle || bskyHandleFallback || '';
  const itemHandleLower = String(effectiveHandle)
    .replace(/^@/, '')
    .toLowerCase();
  const itemAuthorLower = String(item?.author || item?.reporterName || itemAuthorEntry?.name || '')
    .trim()
    .toLowerCase();
  const itemPubMs = item?.publishedAt ? Date.parse(item.publishedAt) : NaN;

  const hasExistingBskyPermalink = /^https?:\/\/bsky\.app\/profile\/[^/?#]+\/post\/[A-Za-z0-9]+/i.test(rawUrl);
  const itemTextTokens = new Set(
    `${item?.fullText || ''} ${item?.title || ''} ${item?.headline || ''}`
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !/^(49ers|niners|francisco|today|practice|week|sunday|monday|wednesday|thursday|friday|coach|shanahan|said|report|reports)$/.test(w))
  );

  // Cross-match against direct `x.com/.../status/...` (preferred) or `bsky.app/profile/.../post/...` posts in the feed
  if (Array.isArray(directSocialPosts) && directSocialPosts.length > 0 && (itemHandleLower || itemAuthorLower)) {
    let bestDirectXUrl = null;
    let bestDirectBskyUrl = null;

    for (const dp of directSocialPosts) {
      const dpUrl = String(dp?.url || '').trim();
      if (!dpUrl || !isDirectSocialPostUrl(dpUrl) || dpUrl.includes('49ers.com/team/transactions') || dpUrl.includes('rotowire.com')) {
        continue;
      }

      const dpBskyFallback = extractXHandleFromBskyUrl(dpUrl) || extractXHandleFromBskyUrl(dp?.authorProfileUrl);
      const dpEntry = resolveReporterFromNameOrHandle(
        dp?.reporterId || dp?.authorHandle || dpBskyFallback || dp?.author || dp?.reporterName
      );
      const dpHandleLower = String(dp?.authorHandle || dpEntry?.handle || dpBskyFallback || '')
        .replace(/^@/, '')
        .toLowerCase();
      const dpAuthorLower = String(dp?.author || dp?.reporterName || dpEntry?.name || '')
        .trim()
        .toLowerCase();
      if (itemHandleLower) {
        if (dpHandleLower !== itemHandleLower) continue;
      } else if (!itemAuthorLower || dpAuthorLower !== itemAuthorLower) {
        continue;
      }

      const dpPubMs = dp?.publishedAt ? Date.parse(dp.publishedAt) : NaN;
      const maxWindowMs = hasExistingBskyPermalink ? 2 * 3_600_000 : 10 * 3_600_000;
      if (Number.isFinite(itemPubMs) && Number.isFinite(dpPubMs)) {
        if (Math.abs(itemPubMs - dpPubMs) > maxWindowMs) continue;
      }

      const dpTextRaw = `${dp?.fullText || ''} ${dp?.title || ''}`;
      const dpTextLower = dpTextRaw.toLowerCase();
      const mentionsSamePlayer =
        (normPlayer &&
          Array.isArray(dp?.mentionedPlayers) &&
          dp.mentionedPlayers.some(
            mp =>
              String(mp?.name || '')
                .toLowerCase()
                .replace(/\b(jr\.?|sr\.?|ii|iii|iv|v)\b/g, '')
                .replace(/[^a-z0-9]/g, '') === normPlayer
          )) ||
        (surname && surname.length >= 4 && dpTextLower.includes(surname));

      if (!mentionsSamePlayer && normPlayer) continue;

      if (itemTextTokens.size >= 3) {
        const dpTokens = dpTextLower
          .replace(/https?:\/\/\S+/g, ' ')
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length >= 4);
        let sharedCount = 0;
        for (const w of dpTokens) {
          if (itemTextTokens.has(w)) sharedCount++;
        }
        const minRequiredOverlap = Math.min(3, itemTextTokens.size);
        if (sharedCount < minRequiredOverlap) continue;
      }

      if (/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/i.test(dpUrl)) {
        bestDirectXUrl = dpUrl.replace(/^https?:\/\/(?:www\.)?twitter\.com\//i, 'https://x.com/');
        break;
      }
      if (!hasExistingBskyPermalink && !bestDirectBskyUrl && /^https?:\/\/bsky\.app\/profile\/[^/?#]+\/post\/[A-Za-z0-9]+/i.test(dpUrl)) {
        bestDirectBskyUrl = dpUrl.startsWith('http://') ? `https://${dpUrl.slice(7)}` : dpUrl;
      }
    }

    if (bestDirectXUrl) return bestDirectXUrl;
    if (!hasExistingBskyPermalink && bestDirectBskyUrl) return bestDirectBskyUrl;
  }

  // Preserve verified direct Bluesky post permalinks (`https://bsky.app/profile/<actor>/post/<rkey>`)
  // instead of overwriting them with speculative X search queries that may return "No results"!
  if (/^https?:\/\/bsky\.app\/profile\/[^/?#]+\/post\/[A-Za-z0-9]+/i.test(rawUrl)) {
    return rawUrl.startsWith('http://') ? `https://${rawUrl.slice(7)}` : rawUrl;
  }

  return buildTargetedOriginalTweetUrl({
    authorHandle: effectiveHandle,
    authorName: item?.author || item?.reporterName || '',
    playerName: primaryPlayerName,
    text: item?.fullText || item?.title || item?.headline || '',
    publishedAt: item?.publishedAt || ''
  });
}
