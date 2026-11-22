/**
 * Universal Instant Search, Autocomplete, Spelling Autocorrect & Deep Word/Source Filtering Engine
 *
 * 100% deterministic, synchronous, in-browser (<3ms per keystroke with WeakMap/fingerprint caching).
 * Powers:
 *  - Word & multi-word autocomplete (from live tweets, articles, players, reporters, outlets, NFL terms)
 *  - News source autocomplete & source-scoped filtering (beat writers, @handles, outlets, film creators)
 *  - Damerau-Levenshtein + 49ers alias spelling autocorrect ("Showing results for..." / "Did you mean...?")
 *  - Full-text word & phrase filtering across tweets, articles, summaries, linked article cards & related reports
 *  - Contextual matched-word snippet extraction & XSS-safe highlighting
 *  - Players, News & Film (Tweets/Articles/Videos), Sources, Podcasts & AI, NFL Glossary & Quick Jumps
 */

import { formatWireSourceDisplayName, sanitizeExternalUrl } from './linkIntegrity.js';
import { resolveOriginalTweetUrl } from './beatAttributionEngine.js';
import { JARGON_GLOSSARY } from './jargonGlossary.js';
import { isUrgentBreakingBadge } from './breakingClassifier.js';

export const QUICK_SECTION_TARGETS = [
  {
    id: 'sec_matchup',
    title: 'Upcoming Matchup & Coaching Intel',
    subtitle: 'Game & Season',
    keywords: 'matchup game preview spread coaching trenches opponent betting line weather',
    navTab: 'season',
    subTab: 'matchup'
  },
  {
    id: 'sec_health',
    title: 'Team Health & Injury Report',
    subtitle: 'Game & Season',
    keywords: 'health injury injuries report practice dnp lp fp ir reserve questionable doubtful out gtd',
    navTab: 'season',
    subTab: 'health'
  },
  {
    id: 'sec_schedule',
    title: 'Full Season Schedule',
    subtitle: 'Game & Season',
    keywords: 'schedule calendar games bye international venue scores results week',
    navTab: 'season',
    subTab: 'schedule'
  },
  {
    id: 'sec_stats',
    title: 'Team Stats & Power Rankings',
    subtitle: 'Game & Season',
    keywords: 'stats rankings epa offense defense special teams power rankings leaderboard dvoa',
    navTab: 'season',
    subTab: 'stats'
  },
  {
    id: 'sec_trade',
    title: 'Trades & Deadline Intel',
    subtitle: 'Game & Season',
    keywords: 'trade trades deadline rumors acquisitions needs targets signings',
    navTab: 'season',
    subTab: 'trade'
  },
  {
    id: 'sec_playoffs',
    title: 'Playoff Odds & Rooting Guide',
    subtitle: 'Game & Season',
    keywords: 'playoffs playoff monte carlo seed bye rooting guide standings clinch nfc west',
    navTab: 'season',
    subTab: 'playoffs'
  },
  {
    id: 'sec_draft',
    title: 'Draft Big Board & Mocks',
    subtitle: 'Game & Season',
    keywords: 'draft big board mock mocks prospects combine pff buzz edp',
    navTab: 'season',
    subTab: 'draft_prep'
  },
  {
    id: 'sec_draft_recap',
    title: 'Draft Recap & Rookies',
    subtitle: 'Game & Season',
    keywords: 'draft recap rookies udfa spider chart class',
    navTab: 'season',
    subTab: 'draft_class'
  },
  {
    id: 'sec_roster',
    title: '53-Man Roster Explorer',
    subtitle: 'Roster & Cap',
    keywords: 'roster players jersey ras snap share active practice squad',
    navTab: 'roster',
    subTab: 'roster'
  },
  {
    id: 'sec_depth',
    title: 'Dual Depth Chart',
    subtitle: 'Roster & Cap',
    keywords: 'depth chart starters backups rotation offense defense',
    navTab: 'roster',
    subTab: 'depth'
  },
  {
    id: 'sec_cap',
    title: 'Salary Cap & Armchair GM Simulator',
    subtitle: 'Roster & Cap',
    keywords: 'salary cap overthecap dead money restructure cut rollover contract contracts extension',
    navTab: 'roster',
    subTab: 'cap'
  },
  {
    id: 'sec_podcasts',
    title: '49ers Beat Podcasts (6 Shows)',
    subtitle: 'Audio & AI',
    keywords: 'podcasts podcast gold standard 49ers talk locked on lombardi plus minus dieter hutch',
    navTab: 'audio',
    subTab: 'beat_podcasts'
  },
  {
    id: 'sec_autopod',
    title: 'Auto Pod Studio',
    subtitle: 'Audio & AI',
    keywords: 'autopod auto pod audio briefing studio generate',
    navTab: 'audio',
    subTab: 'podcast'
  },
  {
    id: 'sec_analysis',
    title: 'On-Demand AI Deep Analysis',
    subtitle: 'Audio & AI',
    keywords: 'ai analysis deep research scouting ask gemini',
    navTab: 'audio',
    subTab: 'analysis'
  }
];

export const SEARCH_SCOPES = [
  { key: 'all', label: 'All' },
  { key: 'tweets', label: 'Tweets' },
  { key: 'articles', label: 'Articles' },
  { key: 'videos', label: 'Videos' },
  { key: 'players', label: 'Players' },
  { key: 'sources', label: 'Sources' }
];

const POSITION_SYNONYMS = {
  QB: ['quarterback', 'signal caller'],
  RB: ['running back', 'halfback', 'tailback'],
  FB: ['fullback'],
  WR: ['wide receiver', 'receiver', 'wideout'],
  TE: ['tight end'],
  OT: ['offensive tackle', 'tackle', 'offensive line', 'oline', 'ol'],
  OG: ['offensive guard', 'guard', 'offensive line', 'oline', 'ol'],
  C: ['center', 'offensive line', 'oline', 'ol'],
  OL: ['offensive line', 'oline'],
  DE: ['defensive end', 'edge', 'pass rusher', 'defensive line', 'dline', 'dl'],
  EDGE: ['edge rusher', 'pass rusher', 'defensive end', 'dline'],
  DT: ['defensive tackle', 'interior defensive line', 'dline', 'dl'],
  DL: ['defensive line', 'dline'],
  LB: ['linebacker', 'mike', 'will', 'sam'],
  CB: ['cornerback', 'corner', 'secondary', 'db'],
  S: ['safety', 'free safety', 'strong safety', 'secondary', 'db'],
  FS: ['free safety', 'safety', 'secondary', 'db'],
  SS: ['strong safety', 'safety', 'secondary', 'db'],
  K: ['kicker', 'special teams'],
  P: ['punter', 'special teams'],
  LS: ['long snapper', 'special teams']
};

const PLAYER_NICKNAME_ALIASES = {
  cmc: 'Christian McCaffrey',
  juice: 'Kyle Juszczyk',
  silverback: 'Trent Williams',
  'slick rick': 'Ricky Pearsall',
  'all pro fred': 'Fred Warner',
  'third and jauan': 'Jauan Jennings',
  '3rd and jauan': 'Jauan Jennings'
};

// High-confidence spelling corrections & well-known 49ers / NFL shorthand aliases
const TYPO_AND_ALIAS_MAP = {
  // Players & coaches
  purdey: 'Purdy',
  prudy: 'Purdy',
  pudy: 'Purdy',
  purdi: 'Purdy',
  brok: 'Brock',
  mccafrey: 'McCaffrey',
  mcaffrey: 'McCaffrey',
  mccaffery: 'McCaffrey',
  macaffrey: 'McCaffrey',
  macafrey: 'McCaffrey',
  mcafrey: 'McCaffrey',
  mccafry: 'McCaffrey',
  cristian: 'Christian',
  kitle: 'Kittle',
  kittel: 'Kittle',
  kitel: 'Kittle',
  aiyk: 'Aiyuk',
  ayuk: 'Aiyuk',
  auiyk: 'Aiyuk',
  aiyuck: 'Aiyuk',
  aiyuk: 'Aiyuk',
  pearsal: 'Pearsall',
  persall: 'Pearsall',
  pearsel: 'Pearsall',
  jenings: 'Jennings',
  jennngs: 'Jennings',
  jauan: 'Jauan',
  juszcyk: 'Juszczyk',
  jusczyk: 'Juszczyk',
  juszyck: 'Juszczyk',
  juszck: 'Juszczyk',
  shannahan: 'Shanahan',
  shanahn: 'Shanahan',
  shanhan: 'Shanahan',
  shanny: 'Shanahan',
  kubiack: 'Kubiak',
  bsoa: 'Bosa',
  warne: 'Warner',
  wiliams: 'Williams',
  lenoir: 'Lenoir',
  lenior: 'Lenoir',
  mustafa: 'Mustapha',
  guerendo: 'Guerendo',
  gueredo: 'Guerendo',
  puni: 'Puni',
  // Beat writers, insiders & outlets
  maioco: 'Maiocco',
  maicco: 'Maiocco',
  miocco: 'Maiocco',
  maiacco: 'Maiocco',
  barows: 'Barrows',
  barow: 'Barrows',
  barrows: 'Barrows',
  lombardie: 'Lombardi',
  lomabrdi: 'Lombardi',
  lombard: 'Lombardi',
  wagnor: 'Wagoner',
  waggoner: 'Wagoner',
  scheffter: 'Schefter',
  shefter: 'Schefter',
  scheft: 'Schefter',
  rapaport: 'Rapoport',
  rappoport: 'Rapoport',
  rappaport: 'Rapoport',
  pelisero: 'Pelissero',
  pellissero: 'Pelissero',
  rusini: 'Russini',
  russinni: 'Russini',
  kawakmi: 'Kawakami',
  kawakammi: 'Kawakami',
  baldy: 'Baldinger',
  webzon: '49ers Webzone',
  nbcsba: 'NBC Sports Bay Area',
  pft: 'ProFootballTalk',
  qbschool: 'The QB School',
  jto: "JT O'Sullivan",
  jonnydell: "Jonnydel's Football Academy",
  // Injuries, roster, cap & football terms
  achiles: 'Achilles',
  achillies: 'Achilles',
  achilies: 'Achilles',
  hamsting: 'Hamstring',
  hamstiring: 'Hamstring',
  concusion: 'Concussion',
  concusssion: 'Concussion',
  inury: 'Injury',
  injry: 'Injury',
  injuires: 'Injuries',
  injurys: 'Injuries',
  questonable: 'Questionable',
  doubtfull: 'Doubtful',
  practise: 'Practice',
  restructre: 'Restructure',
  restructur: 'Restructure',
  extention: 'Extension',
  extenssion: 'Extension',
  contarct: 'Contract',
  contrac: 'Contract',
  playofs: 'Playoffs',
  playofff: 'Playoffs',
  schedual: 'Schedule',
  shedule: 'Schedule',
  reciever: 'Receiver',
  linebaker: 'Linebacker',
  cornerbak: 'Cornerback',
  quarterbak: 'Quarterback',
  exemtion: 'Exemption',
  rosenhause: 'Rosenhaus',
  standngs: 'Standings',
  rankigs: 'Rankings',
  powerankings: 'Power Rankings',
  highligts: 'Highlights',
  analitics: 'Analytics'
};

const CORE_NFL_LEXICON_WORDS = [
  'Injury', 'Injuries', 'Injured Reserve', 'Practice Report', 'Questionable', 'Doubtful', 'Active', 'Inactive',
  'Achilles', 'Hamstring', 'Concussion', 'Knee', 'Ankle', 'Shoulder', 'Groin', 'Calf', 'Quad', 'Oblique', 'Back', 'Foot', 'Wrist', 'Rib', 'Turf Toe', 'ACL', 'MCL',
  'Salary Cap', 'Contract', 'Extension', 'Restructure', 'Dead Money', 'Rollover', 'Post-June 1', 'Exemption',
  'Trade', 'Trade Rumors', 'Waived', 'Signed', 'Activated', 'Practice Squad', 'Roster', 'Depth Chart',
  'Kyle Shanahan', 'John Lynch', 'Klay Kubiak', 'Raheem Morris', 'Robert Saleh',
  'All-22', 'Film', 'Playbook', 'Play-Action', 'Wide-9', 'Red Zone', 'Third Down', 'Pass Rush', 'Run Game', 'Coverage', 'Blitz', 'Snap Share',
  'Power Rankings', 'Playoffs', 'Standings', 'Rooting Guide', 'Matchup', 'Schedule', 'Draft', 'Big Board', 'Combine', 'Highlights', 'Press Conference', 'Presser'
];

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'will', 'about', 'their', 'into',
  'over', 'after', 'before', 'been', 'were', 'they', 'them', 'your', 'just', 'more', 'some',
  'than', 'then', 'what', 'when', 'where', 'which', 'while', 'would', 'could', 'should', 'here',
  'there', 'also', 'very', 'much', 'most', 'only', 'still', 'back', 'going', 'says', 'said',
  'today', 'tomorrow', 'yesterday', 'week', 'year', 'time', 'http', 'https', 'www', 'com'
]);

const SOURCE_ALIASES_BY_NAME = {
  'nbc sports bay area': ['nbcsba', 'nbc', 'bay area', 'maiocco', 'jennifer lee chan'],
  'profootballtalk': ['pft', 'florio', 'nbc pft'],
  '49ers webzone': ['webzone', '49erswebzone'],
  'niners nation': ['ninersnation', 'sbnation'],
  'the athletic': ['athletic', 'barrows', 'kawakami', 'lombardi'],
  '49ers.com official': ['49ers.com', 'official', 'team site'],
  'the qb school': ['qb school', 'jto', 'osullivan', "o'sullivan", 'jt osullivan'],
  "jonnydel's football academy": ['jonnydel', '49ers playbook', 'football academy'],
  'knbr 680': ['knbr', 'radio', '680'],
  'the sf standard': ['sf standard', 'standard', 'kawakami'],
  'espn': ['espn', 'wagoner', 'schefter', 'espn nfl'],
  'nfl network': ['nfln', 'rapoport', 'pelissero', 'garafolo'],
  'nfl trade rumors': ['trade rumors', 'nfltr']
};

export function normalizeSearchText(s = '') {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘`']/g, '')
    .replace(/[/\\|_,;:!?()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompactToken(s = '') {
  return normalizeSearchText(s).replace(/[-.\s]+/g, '');
}

export function escapeRegexChars(str = '') {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getItemTimestampMs(item = {}) {
  const ms = item?.publishedAt ? Date.parse(item.publishedAt) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Bounded Optimal String Alignment (Damerau-Levenshtein) edit distance.
 * Handles adjacent character transpositions (e.g. `pruy` -> `purdy`, `lomabrdi` -> `lombardi`)
 * in a single edit.
 */
export function damerauLevenshtein(aRaw = '', bRaw = '', maxDist = 3) {
  const a = String(aRaw || '');
  const b = String(bRaw || '');
  if (a === b) return 0;
  const alen = a.length;
  const blen = b.length;
  if (Math.abs(alen - blen) > maxDist) return maxDist + 1;
  if (alen === 0) return blen;
  if (blen === 0) return alen;

  const dp = Array.from({ length: alen + 1 }, () => new Int16Array(blen + 1));
  for (let i = 0; i <= alen; i++) dp[i][0] = i;
  for (let j = 0; j <= blen; j++) dp[0][j] = j;

  for (let i = 1; i <= alen; i++) {
    let rowMin = maxDist + 1;
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + 1);
      }
      dp[i][j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return dp[alen][blen];
}

function collapseDoubleLetters(s = '') {
  return String(s || '').replace(/(.)\1+/g, '$1');
}

export function tokenizeSearchQuery(rawQuery = '') {
  const raw = String(rawQuery || '').trim();
  if (!raw) {
    return { raw: '', phrases: [], tokens: [], rawTokens: [], isJerseyQuery: false, jerseyNum: '', isHandleQuery: false };
  }

  const phrases = [];
  let stripped = raw;
  const quoteRe = /"([^"]+)"/g;
  let m;
  while ((m = quoteRe.exec(raw)) !== null) {
    const p = normalizeSearchText(m[1]);
    if (p) phrases.push(p);
  }
  stripped = stripped.replace(quoteRe, ' ').trim();

  const rawTokens = stripped
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean);

  const isJerseyQuery = /^#?\d{1,2}$/.test(raw);
  const jerseyNum = isJerseyQuery ? raw.replace(/^#/, '') : '';
  const isHandleQuery = raw.startsWith('@') && raw.length >= 2;

  const tokens = rawTokens
    .map(t => normalizeSearchText(t.replace(/^[#@]+/, '')))
    .filter(Boolean);

  return { raw, phrases, tokens, rawTokens, isJerseyQuery, jerseyNum, isHandleQuery };
}

/* ============================================================================
 * Memoized Search Index & Live Corpus Lexicon Builder
 * ============================================================================ */

let _cachedLexiconSig = '';
let _cachedLexicon = null;

function computeLexiconSignature(appData, newsItems, allEpisodes, allAnalyses) {
  const pLen = appData?.roster?.players?.length || 0;
  const rLen = appData?.reporters?.reporters?.length || 0;
  const oLen = appData?.reporters?.outlets?.length || 0;
  const nLen = newsItems?.length || 0;
  const nFirst = newsItems?.[0]?.id || '';
  const nLast = newsItems?.[nLen - 1]?.id || '';
  const bLen = appData?.beatPodcasts?.episodes?.length || 0;
  const eLen = allEpisodes?.length || 0;
  const aLen = allAnalyses?.length || 0;
  return `${pLen}|${rLen}|${oLen}|${nLen}|${nFirst}|${nLast}|${bLen}|${eLen}|${aLen}`;
}

function addVocabEntry(map, displayText, { kind = 'word', weight = 1, meta = null } = {}) {
  const display = String(displayText || '').trim();
  const norm = normalizeSearchText(display);
  if (!norm || norm.length < 2) return;
  const existing = map.get(norm);
  if (existing) {
    existing.weight += weight;
    if (meta && !existing.meta) existing.meta = meta;
    // Prefer capitalized display form
    if (/^[a-z]/.test(existing.display) && /^[A-Z]/.test(display)) {
      existing.display = display;
    }
    return;
  }
  map.set(norm, {
    norm,
    compact: normalizeCompactToken(display),
    display,
    kind,
    weight,
    meta
  });
}

function buildSourceKey(name = '', handle = '') {
  const n = normalizeSearchText(name);
  const h = normalizeSearchText(String(handle || '').replace(/^@/, ''));
  return n || h;
}

export function buildUniversalSearchLexicon({
  appData = null,
  filteredRawItems = [],
  allEpisodes = [],
  allAnalyses = []
} = {}) {
  const newsSource =
    Array.isArray(filteredRawItems) && filteredRawItems.length > 0
      ? filteredRawItems
      : appData?.news?.rawStream || [];

  const sig = computeLexiconSignature(appData, newsSource, allEpisodes, allAnalyses);
  if (_cachedLexicon && _cachedLexiconSig === sig) {
    return _cachedLexicon;
  }

  const vocabMap = new Map();
  const tokenVocabMap = new Map(); // single words for fast token-level spelling correction
  const sourceMap = new Map();

  const registerSource = ({
    id = '',
    name = '',
    handle = '',
    outletName = '',
    outletId = '',
    role = '',
    trustTier = 2,
    sourceKind = 'Beat',
    aliases = []
  }) => {
    const cleanName = String(name || '').trim();
    const cleanHandle = String(handle || '').trim();
    const cleanOutlet = String(outletName || '').trim();
    const key = buildSourceKey(cleanName || cleanOutlet, cleanHandle);
    if (!key) return null;

    const existing = sourceMap.get(key);
    if (existing) {
      if (cleanHandle && !existing.handle) existing.handle = cleanHandle;
      if (cleanOutlet && !existing.outletName) existing.outletName = cleanOutlet;
      if (outletId && !existing.outletId) existing.outletId = outletId;
      if (id && !existing.reporterIds.includes(id)) existing.reporterIds.push(id);
      if (role && !existing.role) existing.role = role;
      for (const al of aliases) {
        const nal = normalizeSearchText(al);
        if (nal && !existing.aliasNorms.includes(nal)) existing.aliasNorms.push(nal);
      }
      return existing;
    }

    const extraAliases = [
      ...(SOURCE_ALIASES_BY_NAME[normalizeSearchText(cleanName)] || []),
      ...(SOURCE_ALIASES_BY_NAME[normalizeSearchText(cleanOutlet)] || []),
      ...aliases
    ];
    const aliasNorms = [...new Set(extraAliases.map(normalizeSearchText).filter(Boolean))];
    const entry = {
      id: id || `src_${key.replace(/\s+/g, '_')}`,
      key,
      name: cleanName || cleanOutlet,
      normName: normalizeSearchText(cleanName || cleanOutlet),
      handle: cleanHandle,
      normHandle: normalizeSearchText(cleanHandle.replace(/^@/, '')),
      outletName: cleanOutlet,
      normOutlet: normalizeSearchText(cleanOutlet),
      outletId: outletId || '',
      reporterIds: id ? [id] : [],
      role: role || cleanOutlet || '',
      trustTier: Number(trustTier) || 2,
      sourceKind,
      aliasNorms,
      itemCount: 0
    };
    sourceMap.set(key, entry);
    return entry;
  };

  // 1. Reporters & Outlets from reporters.json
  for (const r of appData?.reporters?.reporters || []) {
    if (!r?.name) continue;
    const kind =
      r.category === 'official'
        ? 'Official'
        : r.category === 'film' || r.category === 'analytics'
          ? 'Film'
          : r.category === 'national'
            ? 'Insider'
            : 'Beat';
    const src = registerSource({
      id: r.id,
      name: r.name,
      handle: r.handle || '',
      outletName: r.outletName || '',
      outletId: r.outletId || '',
      role: r.role || '',
      trustTier: r.trustTier || 2,
      sourceKind: kind
    });
    if (src) {
      addVocabEntry(vocabMap, r.name, { kind: 'source', weight: 18, meta: { sourceKey: src.key } });
      for (const tok of normalizeSearchText(r.name).split(/\s+/)) {
        if (tok.length >= 3) addVocabEntry(tokenVocabMap, tok, { kind: 'source', weight: 16 });
      }
      if (src.normHandle.length >= 3) {
        addVocabEntry(tokenVocabMap, src.normHandle, { kind: 'source', weight: 12 });
      }
    }
  }

  for (const o of appData?.reporters?.outlets || []) {
    const oName = String(o?.name || o?.label || '').replace(/\s*\(Public Beat Wire\)/i, '').trim();
    if (!oName) continue;
    const src = registerSource({
      id: o.id || '',
      name: oName,
      outletName: oName,
      outletId: o.id || '',
      role: 'News Outlet',
      trustTier: 1,
      sourceKind: 'Outlet'
    });
    if (src) {
      addVocabEntry(vocabMap, oName, { kind: 'source', weight: 16, meta: { sourceKey: src.key } });
      for (const tok of normalizeSearchText(oName).split(/\s+/)) {
        if (tok.length >= 3) addVocabEntry(tokenVocabMap, tok, { kind: 'source', weight: 12 });
      }
    }
  }

  // 2. Discover & count sources directly from live news items + extract live corpus words
  const wordDocFreq = new Map();
  const wordDisplayCasing = new Map();

  for (const it of newsSource) {
    if (!it || typeof it !== 'object') continue;
    const displayAuthor = formatWireSourceDisplayName(
      it.author || it.reporterName || it.outletName || '',
      it
    );
    const outletName = String(it.outletName || '').trim();
    const authorHandle = String(it.authorHandle || '').trim();

    if (displayAuthor && displayAuthor !== '49ers Beat') {
      const authorSrc = registerSource({
        id: it.reporterId || '',
        name: displayAuthor,
        handle: authorHandle,
        outletName,
        outletId: it.outletId || '',
        trustTier: it.trustTier || 2,
        sourceKind: it.category === 'film' ? 'Film' : it.type === 'tweet' ? 'Beat' : 'Outlet'
      });
      if (authorSrc) authorSrc.itemCount += 1;
      addVocabEntry(vocabMap, displayAuthor, { kind: 'source', weight: 8 });
      for (const tok of normalizeSearchText(displayAuthor).split(/\s+/)) {
        if (tok.length >= 3) addVocabEntry(tokenVocabMap, tok, { kind: 'source', weight: 8 });
      }
    }

    if (outletName && normalizeSearchText(outletName) !== normalizeSearchText(displayAuthor)) {
      const outletSrc = registerSource({
        id: it.outletId || '',
        name: outletName,
        outletName,
        outletId: it.outletId || '',
        role: 'News Outlet',
        trustTier: it.trustTier || 2,
        sourceKind: 'Outlet'
      });
      if (outletSrc) outletSrc.itemCount += 1;
      addVocabEntry(vocabMap, outletName, { kind: 'source', weight: 6 });
    }

    // Extract live vocabulary words from tweets & articles
    const itemText = `${it.title || ''} ${it.fullText || ''} ${it.summary || ''} ${it.externalTitle || ''} ${it.externalDescription || ''}`;
    const cleanedForWords = itemText.replace(/https?:\/\/\S+/g, ' ');
    const seenInDoc = new Set();
    const rawWords = cleanedForWords.match(/[A-Za-z][A-Za-z0-9'-]{2,26}/g) || [];
    for (const rw of rawWords) {
      const cleaned = rw.replace(/^[-']+|[-']+$/g, '');
      const norm = normalizeSearchText(cleaned);
      if (norm.length < 3 || STOP_WORDS.has(norm) || /^\d+$/.test(norm)) continue;
      if (seenInDoc.has(norm)) continue;
      seenInDoc.add(norm);
      wordDocFreq.set(norm, (wordDocFreq.get(norm) || 0) + 1);
      if (!wordDisplayCasing.has(norm) || (/^[A-Z]/.test(cleaned) && /^[a-z]/.test(wordDisplayCasing.get(norm)))) {
        wordDisplayCasing.set(norm, cleaned);
      }
    }
  }

  // Promote corpus words into vocab maps
  for (const [norm, freq] of wordDocFreq.entries()) {
    const display = wordDisplayCasing.get(norm) || norm;
    // Any word appearing in >= 1 live item is searchable for spelling; >= 2 mentions is strong autocomplete
    const weight = freq >= 2 ? 4 + Math.min(20, freq * 2) : /^[A-Z]/.test(display) ? 4 : 2;
    addVocabEntry(tokenVocabMap, display, { kind: 'word', weight });
    if (freq >= 2) {
      addVocabEntry(vocabMap, display, { kind: 'word', weight });
    }
  }

  // 3. Roster Players
  for (const p of appData?.roster?.players || []) {
    if (!p?.name) continue;
    addVocabEntry(vocabMap, p.name, { kind: 'player', weight: 28, meta: { playerId: p.id } });
    for (const tok of normalizeSearchText(p.name).split(/\s+/)) {
      if (tok.length >= 3) addVocabEntry(tokenVocabMap, tok, { kind: 'player', weight: 26 });
    }
    if (p.injuryType) {
      addVocabEntry(vocabMap, p.injuryType, { kind: 'word', weight: 14 });
      for (const tok of normalizeSearchText(p.injuryType).split(/\s+/)) {
        if (tok.length >= 3) addVocabEntry(tokenVocabMap, tok, { kind: 'word', weight: 14 });
      }
    }
    if (p.college) {
      addVocabEntry(vocabMap, p.college, { kind: 'word', weight: 6 });
    }
  }

  // 4. Beat Podcast Shows & Core NFL / 49ers Vocabulary & Glossary Terms
  for (const sh of appData?.beatPodcasts?.shows || []) {
    if (sh?.name) {
      addVocabEntry(vocabMap, sh.name, { kind: 'podcast', weight: 16 });
      for (const tok of normalizeSearchText(sh.name).split(/\s+/)) {
        if (tok.length >= 3) addVocabEntry(tokenVocabMap, tok, { kind: 'podcast', weight: 12 });
      }
    }
  }

  for (const phrase of CORE_NFL_LEXICON_WORDS) {
    addVocabEntry(vocabMap, phrase, { kind: 'word', weight: 14 });
    for (const tok of normalizeSearchText(phrase).split(/\s+/)) {
      if (tok.length >= 3) addVocabEntry(tokenVocabMap, tok, { kind: 'word', weight: 14 });
    }
  }

  for (const [gKey, gDef] of Object.entries(JARGON_GLOSSARY || {})) {
    if (!gDef?.term) continue;
    const shortTerm = gDef.term.split('(')[0].trim();
    if (shortTerm.length >= 2) {
      addVocabEntry(vocabMap, shortTerm, { kind: 'glossary', weight: 11, meta: { jargonKey: gKey } });
      for (const tok of normalizeSearchText(shortTerm).split(/\s+/)) {
        if (tok.length >= 3) addVocabEntry(tokenVocabMap, tok, { kind: 'glossary', weight: 10 });
      }
    }
  }

  // Sort sources by live item volume & trust tier
  const sources = [...sourceMap.values()].sort(
    (a, b) => b.itemCount - a.itemCount || a.trustTier - b.trustTier || a.name.localeCompare(b.name)
  );

  const lexicon = {
    sources,
    sourceMap,
    vocabList: [...vocabMap.values()],
    vocabMap,
    tokenVocabList: [...tokenVocabMap.values()],
    tokenVocabMap,
    wordDocFreq
  };

  _cachedLexiconSig = sig;
  _cachedLexicon = lexicon;
  return lexicon;
}

/* ============================================================================
 * Spelling Autocorrect / "Did You Mean...?" Engine
 * ============================================================================ */

function findBestTokenCorrection(rawTok, lexicon) {
  const tok = normalizeSearchText(rawTok.replace(/^[#@]+/, ''));
  if (!tok || tok.length < 3 || /^\d+$/.test(tok) || /^49ers?$/.test(tok)) return null;

  // 1. Direct known typo/shorthand map
  if (TYPO_AND_ALIAS_MAP[tok]) {
    const mapped = TYPO_AND_ALIAS_MAP[tok];
    if (normalizeSearchText(mapped) !== tok) {
      return { from: rawTok, to: mapped, distance: 1, confidence: 0.96 };
    }
    return null;
  }

  // 2. If token already exists cleanly in our corpus OR is a strong prefix of a frequent corpus word (>= 3 chars),
  //    don't falsely "correct" a valid word or in-progress prefix typing.
  if (lexicon.tokenVocabMap.has(tok) || lexicon.vocabMap.has(tok)) {
    return null;
  }
  const hasStrongPrefixMatch = lexicon.tokenVocabList.some(
    v => v.weight >= 4 && v.norm.startsWith(tok) && v.norm.length > tok.length
  );
  if (hasStrongPrefixMatch && tok.length <= 5) {
    return null;
  }

  const maxDist = tok.length <= 4 ? 1 : tok.length <= 8 ? 2 : 3;
  const tokCollapsed = collapseDoubleLetters(tok);

  let best = null;
  let bestScore = -Infinity;

  for (const cand of lexicon.tokenVocabList) {
    if (cand.norm.length < 3) continue;
    if (Math.abs(cand.norm.length - tok.length) > maxDist) continue;
    // Prevent wild short-word false positives unless first char matches or transposition at start
    if (tok.length <= 4 && cand.norm[0] !== tok[0] && !(cand.norm[0] === tok[1] && cand.norm[1] === tok[0])) {
      continue;
    }

    const dist = damerauLevenshtein(tok, cand.norm, maxDist);
    const collapsedDist =
      dist > 1 ? damerauLevenshtein(tokCollapsed, collapseDoubleLetters(cand.norm), 1) : dist;
    const effectiveDist = Math.min(dist, collapsedDist + (collapsedDist < dist ? 0.5 : 0));

    if (effectiveDist > maxDist) continue;
    // Require tight relative similarity
    const maxLen = Math.max(tok.length, cand.norm.length);
    const similarity = 1 - effectiveDist / maxLen;
    if (similarity < 0.62) continue;

    const sameFirstBonus = cand.norm[0] === tok[0] ? 1.5 : 0;
    const sameLastBonus = cand.norm[cand.norm.length - 1] === tok[tok.length - 1] ? 0.5 : 0;
    const score = similarity * 24 + sameFirstBonus + sameLastBonus + Math.log2(cand.weight + 1) * 1.4 - effectiveDist * 5;

    if (score > bestScore) {
      bestScore = score;
      best = {
        from: rawTok,
        to: cand.display,
        distance: effectiveDist,
        confidence: Math.min(0.95, similarity + (sameFirstBonus > 0 ? 0.08 : 0))
      };
    }
  }

  return best;
}

export function suggestSpellingCorrection(rawQuery = '', lexicon = null) {
  const parsed = tokenizeSearchQuery(rawQuery);
  if (!parsed.raw || parsed.isJerseyQuery || parsed.rawTokens.length === 0 || !lexicon) {
    return null;
  }

  const corrections = [];
  const rebuiltTokens = [];

  for (const rawTok of parsed.rawTokens) {
    const corr = findBestTokenCorrection(rawTok, lexicon);
    if (corr) {
      corrections.push(corr);
      rebuiltTokens.push(corr.to);
    } else {
      rebuiltTokens.push(rawTok);
    }
  }

  if (corrections.length === 0) return null;

  const suggestedQuery = rebuiltTokens.join(' ').trim();
  if (!suggestedQuery || normalizeSearchText(suggestedQuery) === normalizeSearchText(parsed.raw)) {
    return null;
  }

  const avgConf = corrections.reduce((acc, c) => acc + c.confidence, 0) / corrections.length;
  return {
    originalQuery: parsed.raw,
    suggestedQuery,
    corrections,
    confidence: Math.round(avgConf * 100) / 100
  };
}

/* ============================================================================
 * Word, Player & News Source Autocomplete Engine
 * ============================================================================ */

export function getSearchAutocompleteSuggestions(
  rawQuery = '',
  {
    appData = null,
    filteredRawItems = [],
    allEpisodes = [],
    allAnalyses = [],
    activeSource = null,
    limit = 6
  } = {}
) {
  const qRaw = String(rawQuery || '').trimStart();
  const qTrim = qRaw.trim();
  if (!qTrim || /^#?\d{1,2}$/.test(qTrim)) return [];

  const lexicon = buildUniversalSearchLexicon({ appData, filteredRawItems, allEpisodes, allAnalyses });
  const trailingSpace = /\s$/.test(rawQuery);
  const parts = qTrim.split(/\s+/);
  const prefixWords = trailingSpace ? parts : parts.slice(0, -1);
  const activeTokenRaw = trailingSpace ? '' : parts[parts.length - 1] || '';
  const activeTokenClean = activeTokenRaw.replace(/^[@#]+/, '');
  const activeTokenNorm = normalizeSearchText(activeTokenClean);
  const fullNorm = normalizeSearchText(qTrim.replace(/^[@#]+/, ''));
  const isHandleTyped = activeTokenRaw.startsWith('@');

  if (!activeTokenNorm && !fullNorm) return [];

  const candidates = [];
  const seenKeys = new Set();

  const pushCand = item => {
    const dedupKey = `${item.kind}:${normalizeSearchText(item.query || item.label)}`;
    if (seenKeys.has(dedupKey)) return;
    // Don't suggest the exact query the user already finished typing (unless it's a Source filter pill!)
    if (item.kind !== 'source' && normalizeSearchText(item.query) === normalizeSearchText(qTrim)) return;
    seenKeys.add(dedupKey);
    candidates.push(item);
  };

  // Helper to compose multi-word completion cleanly
  const composeMultiWordQuery = completedWord =>
    prefixWords.length > 0 ? `${prefixWords.join(' ')} ${completedWord}` : completedWord;

  // 1. News Source Autocomplete (Reporters, Beat Writers, @handles, Outlets, Film Creators)
  if (!activeSource) {
    for (const src of lexicon.sources) {
      const directParts = [src.normName, src.normHandle, src.normOutlet].filter(Boolean);
      const nameStarts = src.normName.startsWith(fullNorm) || src.normOutlet.startsWith(fullNorm);
      const handleStarts = src.normHandle && src.normHandle.startsWith(activeTokenNorm);
      const directWordPrefix = directParts.some(h =>
        h.split(/\s+/).some(w => w.startsWith(fullNorm) || (activeTokenNorm.length >= 2 && w.startsWith(activeTokenNorm)))
      );
      const aliasPrefix = src.aliasNorms.some(
        a => a.startsWith(fullNorm) || a.split(/\s+/).some(w => w.startsWith(fullNorm))
      );
      const contains = fullNorm.length >= 3 && directParts.some(h => h.includes(fullNorm));
      if (!nameStarts && !handleStarts && !directWordPrefix && !aliasPrefix && !contains) continue;

      let score = 0;
      if (isHandleTyped && handleStarts) score += 72;
      else if (nameStarts) score += 62;
      else if (directWordPrefix) score += 56;
      else if (handleStarts) score += 48;
      else if (aliasPrefix) score += 32;
      else if (contains) score += 22;

      score += Math.min(14, src.itemCount * 1.4);
      score += src.trustTier === 1 ? 6 : 2;

      const subParts = [];
      if (src.handle) subParts.push(src.handle);
      else if (src.outletName && src.outletName !== src.name) subParts.push(src.outletName);
      if (src.itemCount > 0) subParts.push(`${src.itemCount} ${src.itemCount === 1 ? 'post' : 'posts'}`);
      else if (src.role) subParts.push(src.role);

      pushCand({
        kind: 'source',
        badge: src.sourceKind === 'Outlet' ? 'Outlet' : 'Source',
        label: src.name,
        sublabel: subParts.join(' • '),
        query: src.name,
        sourceKey: src.key,
        sourceName: src.name,
        score
      });
    }
  }

  // 2. Player & Nickname Autocomplete
  if (!isHandleTyped) {
    const nickTarget = PLAYER_NICKNAME_ALIASES[fullNorm] || PLAYER_NICKNAME_ALIASES[activeTokenNorm];
    for (const p of appData?.roster?.players || []) {
      if (!p?.name) continue;
      const pNorm = normalizeSearchText(p.name);
      const pWords = pNorm.split(/\s+/);
      const isNick = nickTarget && normalizeSearchText(nickTarget) === pNorm;
      const startsFull = pNorm.startsWith(fullNorm);
      const startsWord = pWords.some(w => w.startsWith(fullNorm) || (prefixWords.length > 0 && activeTokenNorm.length >= 2 && w.startsWith(activeTokenNorm)));
      if (!isNick && !startsFull && !startsWord) continue;

      let score = isNick ? 60 : startsFull ? 54 : 42;
      if (p.rosterBucket === 'active') score += 6;
      if (p.injuryType) score += 3;

      const queryOut =
        prefixWords.length > 0 && !startsFull && !pNorm.startsWith(fullNorm)
          ? composeMultiWordQuery(pWords[pWords.length - 1] ? p.name.split(/\s+/).pop() : p.name)
          : p.name;

      pushCand({
        kind: 'player',
        badge: p.position || 'Player',
        label: prefixWords.length > 0 && queryOut !== p.name ? queryOut : p.name,
        sublabel: `${p.position || ''}${p.jersey != null ? ` #${p.jersey}` : ''}${p.injuryType ? ` • ${p.injuryType}` : ''}`.trim(),
        query: queryOut,
        playerId: p.id,
        score
      });
    }
  }

  // 3. Word & Topic Autocomplete (from live tweets, articles, injuries, cap & NFL terms)
  if (!isHandleTyped && activeTokenNorm.length >= 2) {
    // Check full phrase completions (e.g., "power ran" -> "Power Rankings", "trade ru" -> "Trade Rumors")
    for (const v of lexicon.vocabList) {
      if (v.kind === 'player' || v.kind === 'source') continue;
      const matchesFull = v.norm.startsWith(fullNorm) && v.norm !== fullNorm;
      const matchesLastTok =
        prefixWords.length > 0 &&
        !v.norm.includes(' ') &&
        v.norm.startsWith(activeTokenNorm) &&
        v.norm !== activeTokenNorm;
      const matchesSingle =
        prefixWords.length === 0 && v.norm.startsWith(activeTokenNorm) && v.norm !== activeTokenNorm;

      if (!matchesFull && !matchesLastTok && !matchesSingle) continue;

      const completedQuery = matchesFull ? v.display : composeMultiWordQuery(v.display);
      const docCount = lexicon.wordDocFreq.get(v.norm) || 0;
      let score = (matchesFull ? 44 : 34) + Math.min(18, v.weight * 0.9) + Math.min(12, docCount * 1.5);
      if (v.kind === 'podcast') score += 4;
      if (v.kind === 'glossary') score += 2;

      pushCand({
        kind: v.kind === 'podcast' ? 'podcast' : 'word',
        badge: v.kind === 'podcast' ? 'Podcast' : v.kind === 'glossary' ? 'Term' : 'Topic',
        label: completedQuery,
        sublabel: docCount > 0 ? `${docCount} ${docCount === 1 ? 'story' : 'stories'}` : '',
        query: completedQuery,
        score
      });
    }

    // Also check live single-word corpus dictionary for rarer live tweet/article words (e.g., "exemp" -> "exemption", "rosen" -> "Rosenhaus")
    // Require >= 2 live mentions OR high curated weight (>= 10) OR long non-typo word (>= 6 chars) so 1-off tweet typos (e.g. "Maico") never pollute autocomplete
    for (const tv of lexicon.tokenVocabList) {
      if (tv.kind === 'player' || tv.kind === 'source') continue;
      if (!tv.norm.startsWith(activeTokenNorm) || tv.norm === activeTokenNorm) continue;
      const docCount = lexicon.wordDocFreq.get(tv.norm) || 0;
      if (docCount < 2 && tv.weight < 10 && tv.norm.length < 6) continue;
      const completedQuery = composeMultiWordQuery(tv.display);
      const score = 30 + Math.min(16, tv.weight) + Math.min(10, docCount * 1.6);
      pushCand({
        kind: 'word',
        badge: docCount > 0 ? 'In Feed' : 'Word',
        label: completedQuery,
        sublabel: docCount > 0 ? `${docCount} ${docCount === 1 ? 'mention' : 'mentions'}` : '',
        query: completedQuery,
        score
      });
    }
  }

  // Sort by score, ensuring balanced visibility if a top Source + Word/Player both match
  candidates.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return candidates.slice(0, limit);
}

/* ============================================================================
 * Shared News / Tweet / Article Deep Word & Source Matcher + Snippet Highlight
 * ============================================================================ */

function doesItemMatchSource(item = {}, sourceFilter = null) {
  if (!sourceFilter) return true;
  const targetName = normalizeSearchText(
    typeof sourceFilter === 'string' ? sourceFilter : sourceFilter.name || sourceFilter.sourceName || ''
  );
  const targetHandle = normalizeSearchText(
    typeof sourceFilter === 'object' ? String(sourceFilter.handle || '').replace(/^@/, '') : ''
  );
  const targetOutlet = normalizeSearchText(
    typeof sourceFilter === 'object' ? sourceFilter.outletName || '' : ''
  );
  const targetIds = new Set(
    typeof sourceFilter === 'object'
      ? [sourceFilter.id, sourceFilter.outletId, ...(sourceFilter.reporterIds || [])].filter(Boolean)
      : []
  );

  if (targetIds.size > 0 && (targetIds.has(item.reporterId) || targetIds.has(item.outletId))) {
    return true;
  }

  const displayAuthor = formatWireSourceDisplayName(
    item.author || item.reporterName || item.outletName || '',
    item
  );
  const hay = normalizeSearchText(
    `${item.author || ''} ${displayAuthor} ${item.reporterName || ''} ${item.outletName || ''} ${String(item.authorHandle || '').replace(/^@/, '')}`
  );

  if (targetHandle && targetHandle.length >= 2 && hay.includes(targetHandle)) return true;
  if (targetName && targetName.length >= 2 && hay.includes(targetName)) return true;
  if (targetOutlet && targetOutlet.length >= 3 && hay.includes(targetOutlet)) return true;

  // Check alias expansions (e.g., NBC Sports Bay Area <-> NBCSBA)
  const aliases = SOURCE_ALIASES_BY_NAME[targetName] || SOURCE_ALIASES_BY_NAME[targetOutlet] || [];
  if (aliases.some(al => hay.includes(normalizeSearchText(al)))) return true;

  return false;
}

function extractMatchedSnippet(text = '', matchTokens = [], maxLen = 155) {
  const clean = String(text || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';

  const lower = clean.toLowerCase();
  let firstIdx = -1;
  for (const tok of matchTokens) {
    if (!tok || tok.length < 2) continue;
    const idx = lower.indexOf(tok.toLowerCase());
    if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) {
      firstIdx = idx;
    }
  }

  if (clean.length <= maxLen) return clean;
  if (firstIdx === -1 || firstIdx < 50) {
    return `${clean.slice(0, maxLen - 1).replace(/\s+\S*$/, '')}…`;
  }

  const start = Math.max(0, firstIdx - 42);
  let slice = clean.slice(start, start + maxLen);
  if (start > 0) {
    slice = slice.replace(/^\S*\s+/, '');
  }
  if (start + maxLen < clean.length) {
    slice = slice.replace(/\s+\S*$/, '');
  }
  return `${start > 0 ? '…' : ''}${slice}${start + maxLen < clean.length ? '…' : ''}`;
}

export function highlightSearchTextHtml(rawText = '', highlightTokens = [], escapeHtmlFn = s => String(s || '')) {
  const text = String(rawText || '');
  const cleanTokens = [...new Set((highlightTokens || []).map(t => String(t || '').trim()).filter(t => t.length >= 2))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);
  if (!text || cleanTokens.length === 0) return escapeHtmlFn(text);

  const re = new RegExp(`(${cleanTokens.map(escapeRegexChars).join('|')})`, 'gi');
  const parts = text.split(re);
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg) continue;
    if (i % 2 === 1) {
      out += `<mark class="search-hl">${escapeHtmlFn(seg)}</mark>`;
    } else {
      out += escapeHtmlFn(seg);
    }
  }
  return out;
}

/**
 * Shared deep-text & source matcher for tweets, news articles, and videos.
 * Used by BOTH Universal Search and `newsView.js` feed filtering!
 */
export function matchNewsItemSearchQuery(item = {}, rawQuery = '', { sourceFilter = null } = {}) {
  if (!item || typeof item !== 'object') {
    return { matched: false, score: 0, matchedIn: '', snippet: '', matchedTokens: [] };
  }

  if (sourceFilter && !doesItemMatchSource(item, sourceFilter)) {
    return { matched: false, score: 0, matchedIn: '', snippet: '', matchedTokens: [] };
  }

  const parsed = tokenizeSearchQuery(rawQuery);
  if (!parsed.raw) {
    return {
      matched: Boolean(sourceFilter),
      score: sourceFilter ? 20 : 0,
      matchedIn: sourceFilter ? 'source' : '',
      snippet: extractMatchedSnippet(item.fullText || item.summary || item.title || '', [], 140),
      matchedTokens: []
    };
  }

  const displayAuthor = formatWireSourceDisplayName(
    item.author || item.reporterName || item.outletName || '',
    item
  );
  const titleStr = String(item.title || '');
  const bodyStr = String(item.fullText || '');
  const summaryStr = String(item.summary || '');
  const extTitleStr = String(item.externalTitle || '');
  const extDescStr = String(item.externalDescription || '');
  const sourceStr = `${item.author || ''} ${displayAuthor} ${item.reporterName || ''} ${item.outletName || ''} ${String(item.authorHandle || '').replace(/^@/, '')}`;
  const playersStr = (item.mentionedPlayers || []).map(p => p?.name || '').join(' ');
  const confirmingStr = Array.isArray(item.confirmingReports)
    ? item.confirmingReports
        .map(cr => `${cr?.title || ''} ${cr?.fullText || ''} ${cr?.summary || ''} ${cr?.author || ''} ${cr?.outletName || ''}`)
        .join(' ')
    : '';

  const normTitle = normalizeSearchText(titleStr);
  const normBody = normalizeSearchText(bodyStr);
  const normSummary = normalizeSearchText(summaryStr);
  const normExt = normalizeSearchText(`${extTitleStr} ${extDescStr}`);
  const normSource = normalizeSearchText(sourceStr);
  const normPlayers = normalizeSearchText(playersStr);
  const normConfirming = normalizeSearchText(confirmingStr);
  const normCategory = normalizeSearchText(`${item.category || ''} ${item.type || ''} ${item.breakingBadge || ''}`);

  // Add outlet/source alias expansions to source haystack so "nbcsba", "pft", "webzone", "qbschool" match cleanly
  const sourceAliasExtra = [
    ...(SOURCE_ALIASES_BY_NAME[normalizeSearchText(item.outletName || '')] || []),
    ...(SOURCE_ALIASES_BY_NAME[normalizeSearchText(displayAuthor)] || [])
  ].join(' ');
  const normSourceExpanded = normalizeSearchText(`${sourceStr} ${sourceAliasExtra}`);

  const fullHay = `${normTitle} ${normBody} ${normSummary} ${normExt} ${normSourceExpanded} ${normPlayers} ${normCategory} ${normConfirming}`;

  // 1. Quoted phrases must all match strictly
  for (const ph of parsed.phrases) {
    if (!fullHay.includes(ph)) {
      return { matched: false, score: 0, matchedIn: '', snippet: '', matchedTokens: [] };
    }
  }

  // 2. All query tokens must match (with nickname/alias support for single tokens like `cmc` -> `mccaffrey`)
  const matchedTokens = [...parsed.phrases];
  let score = 0;

  for (const tok of parsed.tokens) {
    const nickExpansion = PLAYER_NICKNAME_ALIASES[tok] ? normalizeSearchText(PLAYER_NICKNAME_ALIASES[tok]) : '';
    const aliasExpansion = TYPO_AND_ALIAS_MAP[tok] ? normalizeSearchText(TYPO_AND_ALIAS_MAP[tok]) : '';
    const tokenVariants = [tok];
    if (nickExpansion) tokenVariants.push(nickExpansion);
    if (aliasExpansion && aliasExpansion !== tok && ['nbcsba', 'pft', 'qbschool', 'jto', 'baldy', 'shanny'].includes(tok)) {
      tokenVariants.push(aliasExpansion);
    }

    const hitVariant = tokenVariants.find(v => fullHay.includes(v));
    if (!hitVariant) {
      return { matched: false, score: 0, matchedIn: '', snippet: '', matchedTokens: [] };
    }
    matchedTokens.push(hitVariant);

    // Score field-by-field relevance
    const wordBoundaryRe = new RegExp(`(?:^|\\s)${escapeRegexChars(hitVariant)}(?:\\s|$)`);
    if (normSourceExpanded.includes(hitVariant)) {
      score += wordBoundaryRe.test(normSourceExpanded) ? 24 : 14;
    }
    if (normTitle.includes(hitVariant)) {
      score += wordBoundaryRe.test(normTitle) ? 20 : 12;
    }
    if (normBody.includes(hitVariant)) {
      score += wordBoundaryRe.test(normBody) ? 16 : 10;
    }
    if (normSummary.includes(hitVariant)) {
      score += wordBoundaryRe.test(normSummary) ? 12 : 7;
    }
    if (normExt.includes(hitVariant)) {
      score += 10;
    }
    if (normPlayers.includes(hitVariant)) {
      score += 12;
    }
    if (normConfirming.includes(hitVariant)) {
      score += 5;
    }
  }

  // Exact full phrase boost
  const fullPhraseNorm = normalizeSearchText(parsed.raw.replace(/^[@#]+/, ''));
  if (fullPhraseNorm.length >= 3) {
    if (normTitle.includes(fullPhraseNorm) || normBody.includes(fullPhraseNorm)) score += 22;
    else if (normSourceExpanded.includes(fullPhraseNorm)) score += 26;
    else if (normSummary.includes(fullPhraseNorm) || normExt.includes(fullPhraseNorm)) score += 14;
  }

  if (isUrgentBreakingBadge(item.breakingBadge)) score += 8;

  // Determine where the match landed so we can show the most informative snippet
  const primarySearchToken = matchedTokens[0] || '';
  let matchedIn = 'headline';
  let snippetSource = '';

  const titleHasMatch = primarySearchToken && normTitle.includes(primarySearchToken);
  if (!titleHasMatch) {
    if (primarySearchToken && normBody.includes(primarySearchToken) && bodyStr !== titleStr) {
      matchedIn = 'tweet';
      snippetSource = bodyStr;
    } else if (primarySearchToken && normSummary.includes(primarySearchToken)) {
      matchedIn = 'article';
      snippetSource = summaryStr;
    } else if (primarySearchToken && normExt.includes(primarySearchToken)) {
      matchedIn = 'linked';
      snippetSource = `${extTitleStr}${extDescStr ? ` — ${extDescStr}` : ''}`;
    } else if (primarySearchToken && normSourceExpanded.includes(primarySearchToken)) {
      matchedIn = 'source';
      snippetSource = summaryStr || bodyStr;
    } else if (primarySearchToken && normConfirming.includes(primarySearchToken)) {
      matchedIn = 'related';
      snippetSource = confirmingStr;
    }
  } else {
    snippetSource = bodyStr.length > titleStr.length + 20 ? bodyStr : summaryStr;
  }

  const snippet = snippetSource ? extractMatchedSnippet(snippetSource, matchedTokens, 150) : '';

  return {
    matched: true,
    score,
    matchedIn,
    snippet,
    matchedTokens
  };
}

/* ============================================================================
 * Main Universal Search Entry Point
 * ============================================================================ */

function executeSearchPass(
  queryStr,
  { appData, newsSource, allEpisodes, allAnalyses, lexicon, scope = 'all', sourceFilter = null }
) {
  const parsed = tokenizeSearchQuery(queryStr);
  const qNorm = normalizeSearchText(parsed.raw.replace(/^[#@]+/, ''));
  const tokens = parsed.tokens;

  const matchesAllTokens = haystack => {
    if (tokens.length === 0 && parsed.phrases.length === 0) return Boolean(sourceFilter);
    const h = normalizeSearchText(haystack);
    if (parsed.phrases.some(ph => !h.includes(ph))) return false;
    return tokens.every(tok => {
      if (h.includes(tok)) return true;
      const nick = PLAYER_NICKNAME_ALIASES[tok];
      if (nick && h.includes(normalizeSearchText(nick))) return true;
      return false;
    });
  };

  // 1. News Sources (Reporters, Beat Writers, Outlets, Film Creators)
  const sources = [];
  if (!sourceFilter && (tokens.length > 0 || parsed.phrases.length > 0)) {
    for (const src of lexicon.sources) {
      const hay = `${src.name} ${src.handle} ${src.outletName} ${src.role} ${src.aliasNorms.join(' ')}`;
      if (!matchesAllTokens(hay)) continue;
      let score = 0;
      if (src.normName.startsWith(qNorm) || src.normOutlet.startsWith(qNorm) || src.normHandle.startsWith(qNorm)) {
        score += 30;
      }
      if (src.aliasNorms.some(a => a === qNorm || a.startsWith(qNorm))) {
        score += 24;
      }
      score += Math.min(24, src.itemCount * 2.5) + (src.trustTier === 1 ? 6 : 2);
      sources.push({
        id: src.id,
        key: src.key,
        name: src.name,
        handle: src.handle,
        outletName: src.outletName,
        role: src.role,
        trustTier: src.trustTier,
        sourceKind: src.sourceKind,
        itemCount: src.itemCount,
        score
      });
    }
    sources.sort((a, b) => b.score - a.score || b.itemCount - a.itemCount || a.name.localeCompare(b.name));
  }

  // 2. Players
  const players = [];
  if (!sourceFilter && (tokens.length > 0 || parsed.phrases.length > 0 || parsed.isJerseyQuery)) {
    for (const p of appData?.roster?.players || []) {
      const jerseyStr = p.jersey != null ? String(p.jersey) : '';
      const isExactJersey = parsed.isJerseyQuery && jerseyStr === parsed.jerseyNum;
      const posSyns = (POSITION_SYNONYMS[String(p.position || '').toUpperCase()] || []).join(' ');
      const hay = `${p.name || ''} ${p.shortName || ''} ${p.position || ''} ${posSyns} ${p.college || ''} ${p.injuryType || ''} ${p.rosterBucket || ''} ${jerseyStr}`;
      if (isExactJersey || matchesAllTokens(hay)) {
        const pNorm = normalizeSearchText(p.name);
        const nameStarts = pNorm.startsWith(qNorm) ? 14 : pNorm.split(/\s+/).some(w => w.startsWith(qNorm)) ? 10 : 0;
        const exactName = pNorm === qNorm ? 20 : 0;
        const activeBonus = p.rosterBucket === 'active' ? 3 : 0;
        players.push({
          id: p.id,
          name: p.name,
          position: p.position,
          jersey: p.jersey,
          headshotUrl: p.headshotUrl,
          rosterBucket: p.rosterBucket,
          injuryType: p.injuryType,
          playBadgeLabel: p.playBadgeLabel,
          playProbabilityPct: p.playProbabilityPct,
          score: (isExactJersey ? 40 : 0) + exactName + nameStarts + activeBonus
        });
      }
    }
    players.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  // 3. Tweets, Articles & Videos (Deep full-text word & source filtering)
  const allNewsMatches = [];
  const seenNewsUrls = new Set();
  const nowMs = Date.now();

  for (const it of newsSource) {
    const matchInfo = matchNewsItemSearchQuery(it, queryStr, { sourceFilter });
    if (!matchInfo.matched) continue;

    const isTw = it.type === 'tweet' || it.type === 'social';
    const isVid = it.type === 'video' || Boolean(it.videoId || it.videoStreamUrl);
    const isArt = !isTw && !isVid;
    const href = isTw
      ? sanitizeExternalUrl(resolveOriginalTweetUrl(it, newsSource), null)
      : sanitizeExternalUrl(it.url, null);
    if (!href) continue;

    const normUrl = href.toLowerCase().replace(/\/+$/, '');
    if (seenNewsUrls.has(normUrl)) continue;
    seenNewsUrls.add(normUrl);

    const pubMs = getItemTimestampMs(it);
    const ageHours = pubMs > 0 ? Math.max(0, (nowMs - pubMs) / 3_600_000) : 120;
    const recencyBonus = Math.max(0, 14 - ageHours * 0.12);
    const displayTitle = isTw ? it.fullText || it.title || '' : it.title || it.fullText || '';

    allNewsMatches.push({
      id: it.id,
      type: it.type,
      category: it.category,
      isTweet: isTw,
      isVideo: isVid,
      isArticle: isArt,
      formatLabel: isVid ? (it.category === 'film' ? 'Film' : 'Video') : isTw ? 'Tweet' : 'Article',
      title: displayTitle,
      snippet: matchInfo.snippet,
      matchedIn: matchInfo.matchedIn,
      matchedTokens: matchInfo.matchedTokens,
      author: formatWireSourceDisplayName(it.author || it.reporterName || it.outletName || '49ers Beat', it),
      outletName: it.outletName || '',
      href,
      publishedAt: it.publishedAt,
      pubMs,
      relevanceScore: matchInfo.score + recencyBonus
    });
  }

  allNewsMatches.sort((a, b) => {
    const diff = b.relevanceScore - a.relevanceScore;
    if (Math.abs(diff) >= 4) return diff;
    return b.pubMs - a.pubMs;
  });

  // 4. Podcasts & AI Briefs
  const audioAndAi = [];
  if (!sourceFilter && (tokens.length > 0 || parsed.phrases.length > 0)) {
    for (const ep of appData?.beatPodcasts?.episodes || []) {
      if (matchesAllTokens(`${ep.title || ''} ${ep.showName || ''} ${ep.hosts || ''} ${ep.summary || ''}`)) {
        audioAndAi.push({
          kind: 'beat_podcast',
          id: ep.id || ep.title,
          title: ep.title,
          subtitle: `${ep.showName || 'Podcast'}${ep.durationDisplay ? ` • ${ep.durationDisplay}` : ''}`,
          publishedAt: ep.publishedAt,
          showId: ep.showId
        });
      }
    }
    for (const ep of allEpisodes || []) {
      if (matchesAllTokens(`${ep.title || ''} ${ep.topic || ''}`)) {
        audioAndAi.push({
          kind: 'autopod',
          id: ep.id,
          title: ep.title,
          subtitle: `Auto Pod • ${ep.presetLabel || 'Briefing'}`,
          publishedAt: ep.createdAt
        });
      }
    }
    for (const rep of allAnalyses || []) {
      if (matchesAllTokens(`${rep.title || ''} ${rep.summary || ''}`)) {
        audioAndAi.push({
          kind: 'analysis',
          id: rep.id,
          title: rep.title,
          subtitle: 'AI Deep Analysis',
          publishedAt: rep.createdAt
        });
      }
    }
  }

  // 5. NFL Analytics & CBA Glossary
  const glossary = [];
  if (!sourceFilter && qNorm.length >= 2) {
    for (const [key, def] of Object.entries(JARGON_GLOSSARY || {})) {
      if (!def?.term) continue;
      const hay = `${key.replace(/_/g, ' ')} ${def.term} ${def.category || ''} ${def.definition || ''}`;
      if (!matchesAllTokens(hay)) continue;
      const termStarts = normalizeSearchText(def.term).startsWith(qNorm) || key.replace(/_/g, ' ').startsWith(qNorm);
      glossary.push({
        key,
        term: def.term,
        category: def.category || 'NFL Term',
        definition: def.definition || '',
        score: termStarts ? 20 : 8
      });
    }
    glossary.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
  }

  // 6. Quick Section Jumps
  const sections = !sourceFilter
    ? QUICK_SECTION_TARGETS.filter(sec => matchesAllTokens(`${sec.title} ${sec.subtitle} ${sec.keywords}`))
    : [];

  // Scope counts before applying active scope filter
  const tweetsMatches = allNewsMatches.filter(n => n.isTweet);
  const articlesMatches = allNewsMatches.filter(n => n.isArticle);
  const videosMatches = allNewsMatches.filter(n => n.isVideo);

  const countsByScope = {
    all: players.length + allNewsMatches.length + sources.length + audioAndAi.length + glossary.length + sections.length,
    tweets: tweetsMatches.length,
    articles: articlesMatches.length,
    videos: videosMatches.length,
    players: players.length,
    sources: sources.length,
    audio: audioAndAi.length
  };

  // Apply scope slice
  const scopedNews =
    scope === 'tweets'
      ? tweetsMatches
      : scope === 'articles'
        ? articlesMatches
        : scope === 'videos'
          ? videosMatches
          : scope === 'players' || scope === 'sources'
            ? []
            : allNewsMatches;

  const topSources = scope === 'sources' ? sources.slice(0, 12) : scope === 'all' ? sources.slice(0, 4) : [];
  const topPlayers = scope === 'players' ? players.slice(0, 15) : scope === 'all' ? players.slice(0, 5) : [];
  const topNews =
    scope === 'tweets' || scope === 'articles' || scope === 'videos'
      ? scopedNews.slice(0, 18)
      : scope === 'all'
        ? scopedNews.slice(0, sourceFilter ? 14 : 8)
        : [];
  const topAudio = scope === 'all' ? audioAndAi.slice(0, 4) : [];
  const topGlossary = scope === 'all' ? glossary.slice(0, 2) : [];
  const topSections = scope === 'all' ? sections.slice(0, 4) : [];

  const totalCount =
    topSources.length +
    topPlayers.length +
    topNews.length +
    topAudio.length +
    topGlossary.length +
    topSections.length;

  return {
    totalCount,
    totalNewsMatches: scopedNews.length,
    totalAllNewsMatches: allNewsMatches.length,
    countsByScope,
    sources: topSources,
    players: topPlayers,
    news: topNews,
    audioAndAi: topAudio,
    glossary: topGlossary,
    sections: topSections
  };
}

export function runUniversalSearch(
  rawQuery = '',
  {
    appData = null,
    filteredRawItems = [],
    allEpisodes = [],
    allAnalyses = [],
    scope = 'all',
    sourceFilter = null,
    forceLiteral = false
  } = {}
) {
  const qRaw = String(rawQuery || '').trim();
  const activeScope = SEARCH_SCOPES.some(s => s.key === scope) ? scope : 'all';
  const newsSource =
    Array.isArray(filteredRawItems) && filteredRawItems.length > 0
      ? filteredRawItems
      : appData?.news?.rawStream || [];

  const lexicon = buildUniversalSearchLexicon({ appData, filteredRawItems: newsSource, allEpisodes, allAnalyses });

  // Resolve sourceFilter object from string/key if provided
  let resolvedSource = null;
  if (sourceFilter) {
    if (typeof sourceFilter === 'string') {
      const k = normalizeSearchText(sourceFilter);
      resolvedSource = lexicon.sourceMap.get(k) || { key: k, name: sourceFilter, handle: '', outletName: sourceFilter };
    } else if (typeof sourceFilter === 'object') {
      resolvedSource =
        (sourceFilter.key && lexicon.sourceMap.get(sourceFilter.key)) ||
        sourceFilter;
    }
  }

  if (!qRaw && !resolvedSource) {
    return {
      query: '',
      originalQuery: '',
      effectiveQuery: '',
      didAutoCorrect: false,
      correctedQuery: '',
      spellingSuggestion: null,
      autocomplete: [],
      activeScope,
      activeSource: null,
      countsByScope: { all: 0, tweets: 0, articles: 0, videos: 0, players: 0, sources: 0, audio: 0 },
      totalCount: 0,
      totalNewsMatches: 0,
      totalAllNewsMatches: 0,
      sources: [],
      players: [],
      news: [],
      audioAndAi: [],
      glossary: [],
      sections: QUICK_SECTION_TARGETS.slice(0, 6),
      topSources: lexicon.sources.filter(s => s.itemCount > 0).slice(0, 6)
    };
  }

  const autocomplete = qRaw
    ? getSearchAutocompleteSuggestions(rawQuery, {
        appData,
        filteredRawItems: newsSource,
        allEpisodes,
        allAnalyses,
        activeSource: resolvedSource,
        limit: 6
      })
    : [];

  const spellingSuggestion = qRaw ? suggestSpellingCorrection(qRaw, lexicon) : null;

  const literalPass = executeSearchPass(qRaw, {
    appData,
    newsSource,
    allEpisodes,
    allAnalyses,
    lexicon,
    scope: activeScope,
    sourceFilter: resolvedSource
  });

  // Auto-correct fallback: if literal query got 0 overall results and we have a high-confidence spelling fix,
  // automatically display results for the corrected spelling (with a 1-tap "Search instead for..." escape hatch)
  let finalPass = literalPass;
  let didAutoCorrect = false;
  let effectiveQuery = qRaw;

  if (
    !forceLiteral &&
    literalPass.countsByScope.all === 0 &&
    spellingSuggestion &&
    spellingSuggestion.confidence >= 0.66
  ) {
    const correctedPass = executeSearchPass(spellingSuggestion.suggestedQuery, {
      appData,
      newsSource,
      allEpisodes,
      allAnalyses,
      lexicon,
      scope: activeScope,
      sourceFilter: resolvedSource
    });
    if (correctedPass.countsByScope.all > 0) {
      finalPass = correctedPass;
      didAutoCorrect = true;
      effectiveQuery = spellingSuggestion.suggestedQuery;
    }
  }

  return {
    query: qRaw,
    originalQuery: qRaw,
    effectiveQuery,
    didAutoCorrect,
    correctedQuery: didAutoCorrect ? effectiveQuery : '',
    spellingSuggestion:
      spellingSuggestion && (!didAutoCorrect || spellingSuggestion.suggestedQuery !== qRaw)
        ? spellingSuggestion
        : null,
    autocomplete,
    activeScope,
    activeSource: resolvedSource,
    ...finalPass
  };
}
