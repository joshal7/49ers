/**
 * Unified 32-Team Local Beat RSS & Curated YouTube Film Channel Registry
 *
 * Gives ALL 32 NFL clubs equal high-SNR local beat article + embedded-X video/GIF coverage:
 *  - Verified SB Nation club blog RSS (`/rss/current.xml`, auto-derived from `config/reporters/<abbr>.json`)
 *  - Verified USA Today NFL Wire RSS (`https://<wireSlug>.usatoday.com/feed/`)
 *  - High-SNR regional TV/radio/independent beat RSS feeds where available
 *  - Curated official & local All-22 film YouTube channel IDs
 */

export const USA_TODAY_WIRE_SLUG_BY_ABBR = Object.freeze({
  ARI: 'cardswire',
  ATL: 'thefalconswire',
  BAL: 'ravenswire',
  BUF: 'billswire',
  CAR: 'pantherswire',
  CHI: 'bearswire',
  CIN: 'bengalswire',
  CLE: 'brownswire',
  DAL: 'cowboyswire',
  DEN: 'broncoswire',
  DET: 'lionswire',
  GB: 'packerswire',
  HOU: 'texanswire',
  IND: 'coltswire',
  JAX: 'jaguarswire',
  KC: 'chiefswire',
  LAC: 'chargerswire',
  LAR: 'theramswire',
  LV: 'raiderswire',
  MIA: 'dolphinswire',
  MIN: 'vikingswire',
  NE: 'patriotswire',
  NO: 'saintswire',
  NYG: 'giantswire',
  NYJ: 'jetswire',
  PHI: 'eagleswire',
  PIT: 'steelerswire',
  SEA: 'seahawkswire',
  SF: 'ninerswire',
  TB: 'bucswire',
  TEN: 'titanswire',
  WAS: 'commanderswire'
});

/**
 * Additional high-SNR regional beat RSS feeds beyond Club Official, PFR, ESPN, SB Nation & USA Today Wire.
 */
export const EXTRA_TEAM_BEAT_RSS_BY_ABBR = Object.freeze({
  SF: [
    { outletId: 'nbcsba', outletName: 'NBC Sports Bay Area', url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/?rss=1', trustTier: 1 },
    { outletId: '49ers_webzone', outletName: '49ers Webzone', url: 'https://feeds.feedburner.com/49erswebzone', trustTier: 2 },
    { outletId: 'sf_standard', outletName: 'The SF Standard', url: 'https://www.sfstandard.com/sports/feed/', trustTier: 2, filterByTeam: true },
    { outletId: 'knbr_radio', outletName: 'KNBR', url: 'https://www.knbr.com/category/49ers/feed/', trustTier: 2 }
  ],
  PHI: [
    { outletId: 'nbcs_phi', outletName: 'NBC Sports Philadelphia', url: 'https://www.nbcsportsphiladelphia.com/nfl/philadelphia-eagles/?rss=1', trustTier: 1 }
  ],
  NE: [
    { outletId: 'nbcs_bos', outletName: 'NBC Sports Boston', url: 'https://www.nbcsportsboston.com/nfl/new-england-patriots/?rss=1', trustTier: 1 }
  ],
  CHI: [
    { outletId: 'nbcs_chi', outletName: 'NBC Sports Chicago', url: 'https://www.nbcsportschicago.com/nfl/chicago-bears/?rss=1', trustTier: 1 }
  ],
  WAS: [
    { outletId: 'nbcs_was', outletName: 'NBC4 Washington', url: 'https://www.nbcwashington.com/tag/washington-commanders/feed/', trustTier: 1, filterByTeam: true }
  ]
});

/**
 * Builds an official YouTube Atom XML URL for a channel:
 *  - `uulf`: Long-form uploads only (`playlist_id=UULF...`) — prevents meme Shorts from crowding out highlights/film
 *  - `uush`: YouTube Shorts only (`playlist_id=UUSH...`) — used strictly behind our selective high-SNR Short gate
 *  - `all`: Default mixed channel feed (`channel_id=UC...`)
 */
export function buildYouTubeFeedUrl(channelId = '', mode = 'uulf') {
  const cid = String(channelId || '').trim();
  if (!cid) return '';
  if (cid.startsWith('UC') && cid.length >= 20) {
    if (mode === 'uulf') {
      return `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(`UULF${cid.slice(2)}`)}`;
    }
    if (mode === 'uush') {
      return `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(`UUSH${cid.slice(2)}`)}`;
    }
  }
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(cid)}`;
}

/**
 * Shared Stage-1 National All-22 Film, Analytics & Highlight/Mic'd-Up YouTube Channels.
 * Polled ONCE per multi-team run using `UULF` (long-form) feeds and filtered cleanly to all 32 teams.
 */
export const NATIONAL_YOUTUBE_FEEDS = Object.freeze([
  { id: 'nfl_official', channelId: 'UCDVYQ4Zhbm3S2dlz7P1GBDg', name: 'NFL', handle: '@NFL', category: 'highlights', embeddable: false, trustTier: 1, feedMode: 'uulf' },
  { id: 'nfl_films', channelId: 'UCY3NEq2LYrmdoGkevo9BH5A', name: 'NFL Films', handle: '@NFLFilms', category: 'highlights', embeddable: false, trustTier: 1, feedMode: 'uulf' },
  { id: 'all_22_films', channelId: 'UC7Dbn36zT6XjfBh9YDLmGIg', name: 'All_22_Films', handle: '@All_22_Films', category: 'film', embeddable: true, trustTier: 2, feedMode: 'uulf' },
  { id: 'jackson_krueger', channelId: 'UC9LrQByjJFCGqUgvylTiVLQ', name: 'Jackson Krueger Sports', handle: '@JacksonKruegerSports', category: 'film', embeddable: true, trustTier: 2, feedMode: 'uulf' },
  { id: 'kurt_warner_studyball', channelId: 'UCI9A2lRNGq52OUWgPtuYbIQ', name: "Kurt Warner's Study Ball", handle: '@kurtwarnerqbc', category: 'film', embeddable: true, trustTier: 1, feedMode: 'uulf' },
  { id: 'the_qb_school', channelId: 'UCGfxHp2yuimtLsFaq1r7aIQ', name: 'The QB School', handle: '@TheQBSchool', category: 'film', embeddable: true, trustTier: 1, feedMode: 'uulf' },
  { id: 'pff_official_yt', channelId: 'UCY-IDqcyz8tev_jmRboQRsg', name: 'Pro Football Focus', handle: '@ProFootballFocus', category: 'film', embeddable: true, trustTier: 1, feedMode: 'uulf' },
  { id: 'sumersports_yt', channelId: 'UCV2zhEdAxJqjQjY63TXzsrw', name: 'SumerSports', handle: '@SumerSports', category: 'film', embeddable: true, trustTier: 1, feedMode: 'uulf' },
  { id: 'bootleg_football', channelId: 'UCWSxLqyVmZ2b8LDNMucX3uw', name: 'Bootleg Football', handle: '@BootlegFootball', category: 'film', embeddable: true, trustTier: 2, feedMode: 'uulf' },
  { id: 'check_the_mic', channelId: 'UCD7ft3cvhVZmkED0FwwqADg', name: 'Check the Mic', handle: '@CheckTheMic', category: 'film', embeddable: true, trustTier: 2, feedMode: 'uulf' },
  { id: 'brett_kollmann', channelId: 'UCYzfVBuCfGz-oF3aOCGgOmw', name: 'Brett Kollmann', handle: '@BrettKollmann', category: 'film', embeddable: true, trustTier: 2, feedMode: 'all' },
  { id: 'alex_rollins', channelId: 'UCSnTko7TBHGlGlA7yvzQVpA', name: 'Alex Rollins', handle: '@AlexRollinsNFL', category: 'film', embeddable: true, trustTier: 2, feedMode: 'uulf' }
]);

/**
 * Shared Stage-1 National Free Scheme, PFF Grade & EPA Analytics RSS Feeds.
 * Polled ONCE per multi-team run and strictly filtered for zero paywalls & zero betting/fantasy spam.
 */
export const NATIONAL_FILM_ANALYTICS_RSS_FEEDS = Object.freeze([
  {
    id: 'matchquarters',
    name: 'MatchQuarters',
    author: 'Cody Alexander',
    handle: '@The_Coach_A',
    profileUrl: 'https://www.matchquarters.com',
    url: 'https://www.matchquarters.com/feed',
    category: 'film',
    trustTier: 1,
    checkSubstackPaywall: false,
    allowLeagueWideFilmOnly: false,
    maxAgeDays: 14
  },
  {
    id: 'pff_news',
    name: 'PFF',
    author: 'Pro Football Focus',
    handle: '@PFF',
    profileUrl: 'https://www.pff.com/news',
    url: 'https://www.pff.com/feed',
    category: 'film',
    trustTier: 1,
    checkSubstackPaywall: false,
    allowLeagueWideFilmOnly: false,
    maxAgeDays: 10
  },
  {
    id: 'unexpected_points',
    name: 'Unexpected Points',
    author: 'Kevin Cole',
    handle: '@KevinCole___',
    profileUrl: 'https://www.unexpectedpoints.com',
    url: 'https://unexpectedpoints.substack.com/feed',
    category: 'film',
    trustTier: 1,
    checkSubstackPaywall: true,
    allowLeagueWideFilmOnly: false,
    maxAgeDays: 14
  },
  {
    id: 'coach_dan_casey',
    name: 'Coach Dan Casey',
    author: 'Coach Dan Casey',
    handle: '@CoachDanCasey',
    profileUrl: 'https://coachdancasey.substack.com',
    url: 'https://coachdancasey.substack.com/feed',
    category: 'film',
    trustTier: 2,
    checkSubstackPaywall: true,
    allowLeagueWideFilmOnly: false,
    maxAgeDays: 14
  }
]);

/**
 * Verified Official YouTube Channels for ALL 32 NFL Clubs + Local All-22 Film Creators.
 * Every official club channel polls `UULF` (clean long-form highlights & Mic'd Up) PLUS
 * selectively gated `UUSH` Shorts (high-SNR locker-room / Mic'd Up / player moments, max 2/48h).
 */
export const TEAM_CURATED_YOUTUBE_CHANNELS_BY_ABBR = Object.freeze({
  ARI: [{ id: 'UCzNfiKcvNjLHljohEkO83Rg', name: 'Arizona Cardinals', handle: '@azcardinals', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  ATL: [{ id: 'UCzjCfV3LHyarKbdb-2ScGZg', name: 'Atlanta Falcons', handle: '@AtlantaFalcons', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  BAL: [{ id: 'UCbpj2JAUMb8G_oQQFPeGrhg', name: 'Baltimore Ravens', handle: '@BaltimoreRavens', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  BUF: [{ id: 'UCcEvCxUe2Sm5W6MliEUv0vg', name: 'Buffalo Bills', handle: '@buffalobills', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  CAR: [{ id: 'UC6vl4XAyO5mZLczhFC8MgpA', name: 'Carolina Panthers', handle: '@CarolinaPanthers', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  CHI: [{ id: 'UCP0Cdc6moLMyDJiO0s-yhbQ', name: 'Chicago Bears', handle: '@ChicagoBears', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  CIN: [{ id: 'UCnQUpSnJ39KsjZKbT0CprHQ', name: 'Cincinnati Bengals', handle: '@Bengals', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  CLE: [{ id: 'UCQQQO7Kdo0cu9iEb19qOoYA', name: 'Cleveland Browns', handle: '@browns', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  DAL: [{ id: 'UCC0BPKJxAyxjQoRTYbpW0FQ', name: 'Dallas Cowboys', handle: '@DallasCowboys', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  DEN: [{ id: 'UCDGdBexlDZA8T7hnweWWyow', name: 'Denver Broncos', handle: '@broncos', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  DET: [{ id: 'UCv5J06V-ESk5_1uriG65f3w', name: 'Detroit Lions', handle: '@detroitlionsnfl', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  GB:  [{ id: 'UCJtI-l6La0zniodFtSHYrBg', name: 'Green Bay Packers', handle: '@packers', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  HOU: [{ id: 'UCa_FcpOBe8G6VAR18RYS-aA', name: 'Houston Texans', handle: '@HoustonTexans', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  IND: [{ id: 'UCyYn26HPC4HIedifGnNbjBw', name: 'Indianapolis Colts', handle: '@colts', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  JAX: [{ id: 'UCsGacW6z0GedR-Wv45SBRZg', name: 'Jacksonville Jaguars', handle: '@jaguars', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  KC:  [{ id: 'UC-hXefb6XBFSubWz6Ezf_lA', name: 'Kansas City Chiefs', handle: '@KansasCityChiefs', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  LAC: [{ id: 'UCUyz_gEY_N-KBU4zjt2s-uQ', name: 'Los Angeles Chargers', handle: '@chargers', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  LAR: [{ id: 'UCyJ6yZdVUkBvt2vl4R03jcA', name: 'Los Angeles Rams', handle: '@LARams', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  LV:  [{ id: 'UC1es5fp8FEK1L0EgHjCvmtQ', name: 'Las Vegas Raiders', handle: '@raiders', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  MIA: [{ id: 'UCHUSfEzpSRkUUsRkk_aJwDw', name: 'Miami Dolphins', handle: '@MiamiDolphins', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  MIN: [{ id: 'UCcsw_KrB_wg5lQ5nXWR_LFA', name: 'Minnesota Vikings', handle: '@vikings', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  NE:  [{ id: 'UCMm_V8YjmnZRhToXIqDYDuw', name: 'New England Patriots', handle: '@patriots', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  NO:  [{ id: 'UCwuddf1JrodMlc5fYpVlrQA', name: 'New Orleans Saints', handle: '@NewOrleansSaints', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  NYG: [{ id: 'UCk2FqoG8dN5EAz5WU3A0D7A', name: 'New York Giants', handle: '@nygiants', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  NYJ: [{ id: 'UCROj9vBjc4ZW3AL4cd_BjHg', name: 'New York Jets', handle: '@nyjets', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  PHI: [{ id: 'UCaogx6OHpsGg0zuGRKsjbtQ', name: 'Philadelphia Eagles', handle: '@eagles', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  PIT: [{ id: 'UChaRXjMDs4ppKfnTPE6Z89w', name: 'Pittsburgh Steelers', handle: '@steelers', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  SEA: [{ id: 'UCzkFCRiMcOBeef8xcaqipmw', name: 'Seattle Seahawks', handle: '@seahawks', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  SF: [
    { id: 'UCeIOarQkwmGhimim9cDUTng', name: 'San Francisco 49ers', handle: '@49ers', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true },
    { id: 'UCt1LfHRE5eGiacPVtiaC10w', name: "Jonnydel's Football Academy", handle: '@jonnydels', category: 'film', embeddable: true, trustTier: 2 },
    { id: 'UC7gIEoJDYihnVc_7FkHARoA', name: '49ers Rush', handle: '@49ersRush', category: 'beat', embeddable: true, trustTier: 2 },
    { id: 'UCdn6zbhFQ7_vMLYfjSiLSYA', name: 'Gold Standard Network', handle: '@GoldStandardNetwork', category: 'beat', embeddable: true, trustTier: 2, includeSelectiveShorts: true },
    { id: 'UC_iZU1mCi72-18O-RRGwPCw', name: '95.7 The Game', handle: '@957TheGame', category: 'beat', embeddable: true, trustTier: 2, filterByTeam: true, filterRadioHotTakes: true, includeSelectiveShorts: true }
  ],
  TB:  [{ id: 'UC0Wwu7r1ybaaR09ANhudTzA', name: 'Tampa Bay Buccaneers', handle: '@buccaneers', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  TEN: [{ id: 'UCHBsqVkFraWvtNd1w0Qx4_g', name: 'Tennessee Titans', handle: '@titans', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }],
  WAS: [{ id: 'UC2a0ENbCZqIO5C1fWXGXZXA', name: 'Washington Commanders', handle: '@commanders', category: 'beat', embeddable: false, trustTier: 1, includeSelectiveShorts: true }]
});

/**
 * Resolves all high-SNR local beat RSS feeds for any of the 32 NFL clubs.
 */
export function resolveTeamBeatRssFeeds(team, reportersData = null) {
  const abbr = String(team?.abbr || '').toUpperCase();
  const feeds = [];
  const seenUrls = new Set();
  const push = f => {
    if (!f?.url || seenUrls.has(f.url)) return;
    seenUrls.add(f.url);
    feeds.push(f);
  };

  // 1. SB Nation team blog RSS (auto-discovered from `config/reporters/<abbr>.json` `blog_analysis` outlet)
  const outlets = Array.isArray(reportersData?.outlets) ? reportersData.outlets : [];
  const sbNationOutlet = outlets.find(
    o =>
      o?.type === 'blog_analysis' &&
      /^https:\/\/(?:www\.)?[a-z0-9-]+\.com\/?$/i.test(String(o.url || '').trim())
  );
  if (sbNationOutlet) {
    const base = String(sbNationOutlet.url).trim().replace(/\/+$/, '');
    push({
      outletId: sbNationOutlet.id,
      outletName: sbNationOutlet.name.replace(/\s*\(SB Nation\)\s*$/i, '').trim(),
      url: `${base}/rss/current.xml`,
      trustTier: Number(sbNationOutlet.tier) || 2
    });
  }

  // 2. USA Today NFL Wire RSS (all 32 teams)
  const wireSlug = USA_TODAY_WIRE_SLUG_BY_ABBR[abbr];
  if (wireSlug) {
    push({
      outletId: `${wireSlug}_rss`,
      outletName: `${team.nickname} Wire`,
      url: `https://${wireSlug}.usatoday.com/feed/`,
      trustTier: 2
    });
  }

  // 3. Regional high-SNR TV/radio/beat RSS feeds
  for (const extra of EXTRA_TEAM_BEAT_RSS_BY_ABBR[abbr] || []) {
    push(extra);
  }

  return feeds;
}
