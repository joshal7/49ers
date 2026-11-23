/**
 * Universal 32-Team NFL Multi-Tenant Registry & Theme/Identity Resolver
 *
 * Single source of truth shared across:
 *   - Browser PWA (`src/app.js`, `src/services/*`, `src/engine/*`, `src/views/*`)
 *   - Service Worker (`sw.js`)
 *   - Multi-Tenant Cloudflare Edge Worker & HTMLRewriter (`worker/nfl-teams-worker.js`, `worker/index.js`)
 *   - Two-Stage Data Ingestion Pipeline (`scripts/fetch-team-data.mjs`, `scripts/build-team-icons.mjs`)
 *
 * Zero-Regression Invariants for `49ers.joshal.com`:
 *   - `SF` preserves exact legacy branding (`49ers Faithful` / `49ers HQ`), exact legacy `localStorage`,
 *     IndexedDB, and `CacheStorage` keys, and `priorityTier: 'vip'` (Priority #0, always eager, never lazy).
 *   - All other 31 NFL clubs use their franchise fanbase brand (e.g., `Lions One Pride`, `Bills Mafia`)
 *     with isolated per-subdomain storage namespaces and WCAG AA (`>= 4.5:1`) contrast-verified dark & light themes.
 */

export const NFL_DIVISIONS = {
  // NFC
  SF: 'NFC West', SEA: 'NFC West', LAR: 'NFC West', ARI: 'NFC West',
  DET: 'NFC North', MIN: 'NFC North', GB: 'NFC North', CHI: 'NFC North',
  PHI: 'NFC East', DAL: 'NFC East', NYG: 'NFC East', WAS: 'NFC East',
  TB: 'NFC South', NO: 'NFC South', ATL: 'NFC South', CAR: 'NFC South',
  // AFC
  BUF: 'AFC East', MIA: 'AFC East', NE: 'AFC East', NYJ: 'AFC East',
  BAL: 'AFC North', CIN: 'AFC North', CLE: 'AFC North', PIT: 'AFC North',
  HOU: 'AFC South', IND: 'AFC South', JAX: 'AFC South', TEN: 'AFC South',
  DEN: 'AFC West', KC: 'AFC West', LV: 'AFC West', LAC: 'AFC West'
};

export const NFC_DIVISION_NAMES = ['NFC West', 'NFC North', 'NFC East', 'NFC South'];
export const AFC_DIVISION_NAMES = ['AFC East', 'AFC North', 'AFC South', 'AFC West'];

function hexToRgb(hex = '#000000') {
  const clean = String(hex || '').replace(/^#/, '').trim();
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return { r: 0, g: 0, b: 0 };
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToRgbTriplet(hex) {
  const { r, g, b } = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
}

export function computeOnPrimaryInk(primaryHex, primaryBrightHex = '') {
  const whitePrimary = computeContrastRatio('#FFFFFF', primaryHex);
  const whiteBright = primaryBrightHex ? computeContrastRatio('#FFFFFF', primaryBrightHex) : whitePrimary;
  const darkPrimary = computeContrastRatio('#0B0D10', primaryHex);
  const darkBright = primaryBrightHex ? computeContrastRatio('#0B0D10', primaryBrightHex) : darkPrimary;
  const minWhite = Math.min(whitePrimary, whiteBright);
  const minDark = Math.min(darkPrimary, darkBright);
  return minWhite < 4.5 && minDark > minWhite ? '#0B0D10' : '#FFFFFF';
}

const OURLADS_TEAM_CODE_OVERRIDES = {
  ARI: 'ARZ',
  BAL: 'BLT',
  CLE: 'CLV',
  HOU: 'HST'
};

export function getOurladsTeamCode(teamInput = null) {
  const team = resolveTeamConfig(teamInput || getActiveTeamConfig());
  return OURLADS_TEAM_CODE_OVERRIDES[team.abbr] || team.abbr;
}

const DEFAULT_TEAM_NICKNAME_ALIASES = {
  SF: ['49ers', 'Niners'],
  SEA: ['Seahawks', 'Hawks'],
  LAR: ['Rams'],
  ARI: ['Cardinals', 'Cards'],
  DET: ['Lions'],
  MIN: ['Vikings', 'Vikes'],
  GB: ['Packers', 'Pack'],
  CHI: ['Bears'],
  PHI: ['Eagles', 'Birds'],
  DAL: ['Cowboys', 'Boys'],
  NYG: ['Giants', 'G-Men'],
  WAS: ['Commanders'],
  TB: ['Buccaneers', 'Bucs'],
  NO: ['Saints'],
  ATL: ['Falcons'],
  CAR: ['Panthers'],
  BUF: ['Bills', 'Buffalo'],
  MIA: ['Dolphins', 'Fins', 'Phins'],
  NE: ['Patriots', 'Pats'],
  NYJ: ['Jets'],
  BAL: ['Ravens'],
  CIN: ['Bengals'],
  CLE: ['Browns'],
  PIT: ['Steelers'],
  HOU: ['Texans'],
  IND: ['Colts'],
  JAX: ['Jaguars', 'Jags'],
  TEN: ['Titans'],
  DEN: ['Broncos'],
  KC: ['Chiefs'],
  LV: ['Raiders'],
  LAC: ['Chargers', 'Bolts']
};

const AMBIGUOUS_GENERIC_CITY_TEAMS = new Set(['NYG', 'NYJ', 'LAR', 'LAC', 'WAS', 'CAR', 'TEN', 'ARI', 'MIN']);

export function computeRelativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lin = [r, g, b].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function computeContrastRatio(hexA, hexB) {
  const l1 = computeRelativeLuminance(hexA);
  const l2 = computeRelativeLuminance(hexB);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

function buildThemeSpec({
  darkName,
  lightName,
  darkBg = '#0B0D10',
  darkElevated = '#13171E',
  darkCardAlt = '#181E27',
  darkPrimary,
  darkPrimaryBright,
  darkSecondary,
  darkSecondaryBright,
  lightBg = '#F6F7FA',
  lightCardAlt = '#ECEFF5',
  lightPrimary,
  lightPrimaryBright,
  lightSecondary,
  lightSecondaryBright,
  crestPrimary,
  crestSecondary,
  crestInk = '#FFFFFF'
}) {
  return {
    dark: {
      name: darkName,
      bgPrimary: darkBg,
      bgElevated: darkElevated,
      bgCardAlt: darkCardAlt,
      bgInput: '#0E1218',
      bgHeader: darkBg,
      bgGlass: hexToRgba(darkBg, 0.9),
      primary: darkPrimary,
      primaryBright: darkPrimaryBright,
      primarySoft: hexToRgba(darkPrimaryBright, 0.16),
      secondary: darkSecondary,
      secondaryBright: darkSecondaryBright,
      secondarySoft: hexToRgba(darkSecondary, 0.15),
      secondaryBorder: hexToRgba(darkSecondary, 0.34),
      glowPrimary: hexToRgba(darkPrimary, 0.17),
      glowSecondary: hexToRgba(darkSecondary, 0.06),
      themeColor: darkBg
    },
    light: {
      name: lightName,
      bgPrimary: lightBg,
      bgElevated: '#FFFFFF',
      bgCardAlt: lightCardAlt,
      bgInput: '#FFFFFF',
      bgHeader: lightBg,
      bgGlass: hexToRgba(lightBg, 0.92),
      primary: lightPrimary,
      primaryBright: lightPrimaryBright,
      primarySoft: hexToRgba(lightPrimary, 0.1),
      secondary: lightSecondary,
      secondaryBright: lightSecondaryBright,
      secondarySoft: hexToRgba(lightSecondary, 0.16),
      secondaryBorder: hexToRgba(lightSecondary, 0.36),
      glowPrimary: hexToRgba(lightSecondary, 0.13),
      glowSecondary: hexToRgba(lightPrimary, 0.05),
      themeColor: lightBg
    },
    crest: {
      primary: crestPrimary || lightPrimary,
      secondary: crestSecondary || darkSecondary,
      ink: crestInk
    }
  };
}

function makeTeamEntry(raw) {
  const abbr = raw.abbr.toUpperCase();
  const slug = raw.slug.toLowerCase();
  const isSf = abbr === 'SF';
  const division = NFL_DIVISIONS[abbr];
  const conference = division.startsWith('AFC') ? 'AFC' : 'NFC';
  const divisionRivals = Object.entries(NFL_DIVISIONS)
    .filter(([k, div]) => div === division && k !== abbr)
    .map(([k]) => k);

  const clubDomain = raw.clubDomain;
  const storageKeys = isSf
    ? {
        prefs: 'joshal_49ers_hq_prefs_v1',
        recentSearches: '49ers_faithful_recent_searches_v1',
        weeklyPracticeLegacy: 'joshal_49ers_weekly_practice_v1',
        weeklyPractice: 'joshal_49ers_weekly_practice_v2',
        gamedayInactives: 'joshal_49ers_gameday_inactives_v1',
        podcastCache: '49ers-podcast-studio-audio-v1',
        podcastCachePrefix: '49ers-podcast-studio-audio-',
        podcastIdb: '49ers_podcast_audio_idb_v1',
        offlineIdb: '49ers_faithful_offline_v1',
        swCachePrefix: '49ers-faithful-'
      }
    : {
        prefs: `joshal_${slug}_hq_prefs_v1`,
        recentSearches: `${slug}_hq_recent_searches_v1`,
        weeklyPracticeLegacy: `joshal_${slug}_weekly_practice_v1`,
        weeklyPractice: `joshal_${slug}_weekly_practice_v2`,
        gamedayInactives: `joshal_${slug}_gameday_inactives_v1`,
        podcastCache: `${slug}-podcast-studio-audio-v1`,
        podcastCachePrefix: `${slug}-podcast-studio-audio-`,
        podcastIdb: `${slug}_podcast_audio_idb_v1`,
        offlineIdb: `${slug}_hq_offline_v1`,
        swCachePrefix: `${slug}-hq-`
      };

  const assets = isSf
    ? {
        crestSvg: './assets/sf-crest.svg?v=1',
        appIconSvg: './assets/app-icon.svg?v=6',
        appleTouchIconPng: './apple-touch-icon.png?v=6',
        appleTouchIcon180Png: './apple-touch-icon.png?v=6'
      }
    : {
        crestSvg: `./assets/teams/${slug}/crest.svg?v=1`,
        appIconSvg: `./assets/teams/${slug}/app-icon.svg?v=1`,
        appleTouchIconPng: `./assets/teams/${slug}/apple-touch-icon.png?v=1`,
        appleTouchIcon180Png: `./assets/teams/${slug}/apple-touch-icon-180.png?v=1`
      };

  const brandName = raw.brandName || (isSf ? '49ers Faithful' : `${raw.nickname} HQ`);
  const shortTitle = raw.shortTitle || raw.nickname;

  return {
    abbr,
    slug,
    domain: `${slug}.joshal.com`,
    aliases: [...new Set([slug, abbr.toLowerCase(), ...(raw.aliases || [])])],
    espnId: Number(raw.espnId),
    espnAbbr: (raw.espnAbbr || abbr).toLowerCase(),
    otcSlug: raw.otcSlug,
    cbsAbbr: (raw.cbsAbbr || abbr).toUpperCase(),
    cbsSlug: raw.cbsSlug || raw.otcSlug,
    pfrAbbr: (raw.pfrAbbr || abbr).toLowerCase(),
    rotowireSlug: raw.rotowireSlug || raw.otcSlug,
    nflTrackerSlug: raw.nflTrackerSlug || raw.otcSlug,
    city: raw.city,
    nickname: raw.nickname,
    fullName: `${raw.city} ${raw.nickname}`,
    stadium: raw.stadium,
    brandName,
    shortTitle,
    conference,
    division,
    divisionRivals,
    timezone: raw.timezone,
    clubDomain,
    clubRosterUrl: `https://www.${clubDomain}/team/players-roster/`,
    clubInjuryUrl: `https://www.${clubDomain}/team/injury-report/`,
    clubNewsUrl: `https://www.${clubDomain}/news/`,
    clubRssUrls: raw.clubRssUrls || [
      `https://www.${clubDomain}/rss/news`,
      `https://www.${clubDomain}/rss/videos`
    ],
    priorityTier: isSf ? 'vip' : 'standard',
    storageKeys,
    assets,
    themes: raw.themes,
    coachesSeed: raw.coachesSeed || null,
    ourladsCode: OURLADS_TEAM_CODE_OVERRIDES[abbr] || abbr,
    keywordRules: {
      requiredNicknames: raw.requiredNicknames || DEFAULT_TEAM_NICKNAME_ALIASES[abbr] || [raw.nickname],
      excludeGenericCity: raw.excludeGenericCity !== undefined ? Boolean(raw.excludeGenericCity) : AMBIGUOUS_GENERIC_CITY_TEAMS.has(abbr),
      searchAliases:
        raw.searchAliases || [
          ...new Set([
            ...(DEFAULT_TEAM_NICKNAME_ALIASES[abbr] || [raw.nickname]),
            `${raw.city} ${raw.nickname}`
          ])
        ]
    },
    beatPodcastShows: raw.beatPodcastShows || [],
    youtubeFilmChannels: raw.youtubeFilmChannels || []
  };
}

export const ALL_NFL_TEAMS = [
  // ============================ NFC WEST ============================
  makeTeamEntry({
    abbr: 'SF', slug: '49ers', aliases: ['niners', 'sfo'],
    espnId: 25, espnAbbr: 'sf', otcSlug: 'san-francisco-49ers', cbsAbbr: 'SF', pfrAbbr: 'sfo',
    city: 'San Francisco', nickname: '49ers', stadium: "Levi's Stadium",
    brandName: '49ers Faithful', shortTitle: '49ers',
    timezone: 'America/Los_Angeles', clubDomain: '49ers.com',
    requiredNicknames: ['49ers', 'Niners'],
    searchAliases: ['49ers', 'Niners', 'San Francisco 49ers'],
    coachesSeed: { hc: 'Kyle Shanahan', oc: 'Klay Kubiak', dc: 'Raheem Morris', gm: 'John Lynch' },
    themes: buildThemeSpec({
      darkName: "Levi's Night Game", lightName: "'94 Throwback",
      darkBg: '#0B0D10', darkElevated: '#13171E', darkCardAlt: '#181E27',
      darkPrimary: '#AA0000', darkPrimaryBright: '#D41919',
      darkSecondary: '#B3995D', darkSecondaryBright: '#E7D29B',
      lightBg: '#F7F5F0', lightCardAlt: '#F1EDE2',
      lightPrimary: '#AA0000', lightPrimaryBright: '#B80000',
      lightSecondary: '#8C7034', lightSecondaryBright: '#6B5320',
      crestPrimary: '#AA0000', crestSecondary: '#B3995D'
    }),
    beatPodcastShows: [
      {
        id: 'the_gold_standard',
        collectionId: 1524313515,
        name: 'The Gold Standard',
        fullTitle: 'The Gold Standard: San Francisco 49ers Podcast Network',
        hosts: 'Rob "Stats" Guerrera & Levin Black',
        network: 'Audacy / Bleav',
        feedUrl: 'https://rss.amperwave.net/v2/feed/audacynetwork/927bb572b427ed0168d252cd464a874b',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/the-gold-standard-san-francisco-49ers-podcast-network/id1524313515'
      },
      {
        id: '49ers_talk',
        collectionId: 1153457233,
        name: '49ers Talk',
        fullTitle: '49ers Talk: A San Francisco 49ers Podcast',
        hosts: 'Matt Maiocco & Jennifer Lee Chan',
        network: 'NBC Sports Bay Area',
        feedUrl: 'https://feeds.simplecast.com/SCmnvidR',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/49ers-talk-a-san-francisco-49ers-podcast/id1153457233'
      },
      {
        id: '49ers_plus_minus',
        collectionId: 1827546443,
        name: '49ers +/-',
        fullTitle: '49ers Plus Minus',
        hosts: 'Tim Kawakami & Matt Barrows',
        network: 'The San Francisco Standard / Audacy',
        feedUrl: 'https://rss.amperwave.net/v2/feed/audacynetwork/49ers-plus-minus',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/49ers-plus-minus/id1827546443'
      },
      {
        id: 'dieter_and_hutch',
        collectionId: 1530087532,
        name: 'Dieter and Hutch',
        fullTitle: 'Dieter and Hutch',
        hosts: 'Dieter Kurtenbach & Jake Hutchinson',
        network: 'Bay Area News Group / KNBR',
        feedUrl: 'https://feeds.castos.com/85z8',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/dieter-and-hutch/id1530087532'
      },
      {
        id: 'locked_on_49ers',
        collectionId: 1143358718,
        name: 'Locked On 49ers',
        fullTitle: 'Locked On 49ers - Daily Podcast On The San Francisco 49ers',
        hosts: 'Brian Peacock & Eric Crocker',
        network: 'Locked On Podcast Network',
        feedUrl: 'https://rss.pdrl.fm/f9f75c/feeds.simplecast.com/P83yLSb_',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/locked-on-49ers-daily-podcast-on-the-san-francisco-49ers/id1143358718'
      },
      {
        id: 'lombardi_lounge',
        collectionId: 1757355831,
        name: 'Lombardi Lounge',
        fullTitle: 'The David Lombardi Lounge',
        hosts: 'David Lombardi',
        network: 'The SF Standard / Lombardi',
        feedUrl: 'https://feeds.megaphone.fm/NSM7362508743',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/the-david-lombardi-lounge/id1757355831'
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'SEA', slug: 'seahawks', aliases: ['hawks'],
    espnId: 26, espnAbbr: 'sea', otcSlug: 'seattle-seahawks', cbsAbbr: 'SEA', pfrAbbr: 'sea',
    city: 'Seattle', nickname: 'Seahawks', stadium: 'Lumen Field',
    brandName: 'Seahawks 12s',
    timezone: 'America/Los_Angeles', clubDomain: 'seahawks.com',
    themes: buildThemeSpec({
      darkName: 'Lumen Night', lightName: 'Royal Throwback',
      darkPrimary: '#2D6CDF', darkPrimaryBright: '#5C9BFF',
      darkSecondary: '#7AD934', darkSecondaryBright: '#A6F065',
      lightBg: '#F4F7FA', lightCardAlt: '#E9EEF5',
      lightPrimary: '#002244', lightPrimaryBright: '#0A3B6E',
      lightSecondary: '#2F6B12', lightSecondaryBright: '#21500B',
      crestPrimary: '#002244', crestSecondary: '#69BE28'
    }),
    coachesSeed: { hc: "Mike Macdonald", oc: "Brian Fleury", dc: "Aden Durde", gm: "John Schneider" },
    beatPodcastShows: [
      {
        "id": "seahawks_locked_on_seahawks",
        "collectionId": 1151621299,
        "name": "Locked On Seahawks",
        "fullTitle": "Locked On Seahawks - Daily Podcast On The Seattle Seahawks",
        "hosts": "Locked On Podcast Network, Corbin Smith, Rob Rang",
        "network": "Locked On Podcast Network, Corbin Smith, Rob Rang",
        "feedUrl": "https://rss.pdrl.fm/099859/feeds.simplecast.com/nxLgqRTF",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-seahawks-daily-podcast-on-the-seattle-seahawks/id1151621299?uo=4"
      },
      {
        "id": "seahawks_seattle_overload",
        "collectionId": 1479116026,
        "name": "Seattle Overload",
        "fullTitle": "Seattle Overload",
        "hosts": "Seattle Overload",
        "network": "Seattle Overload",
        "feedUrl": "https://www.spreaker.com/show/5141915/episodes/feed",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/seattle-overload/id1479116026?uo=4"
      },
      {
        "id": "seahawks_daily_seahawks_podcast",
        "collectionId": 1153170207,
        "name": "Daily Seahawks Podcast",
        "fullTitle": "Daily Seahawks Podcast: HB Mornings & Real Hawk Talk",
        "hosts": "Brian Nemhauser",
        "network": "Brian Nemhauser",
        "feedUrl": "https://feeds.simplecast.com/9EKSl0eW",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/daily-seahawks-podcast-hb-mornings-real-hawk-talk/id1153170207?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'LAR', slug: 'rams', aliases: ['la-rams'],
    espnId: 14, espnAbbr: 'lar', otcSlug: 'los-angeles-rams', cbsAbbr: 'LAR', pfrAbbr: 'ram',
    city: 'Los Angeles', nickname: 'Rams', stadium: 'SoFi Stadium',
    brandName: 'Rams House',
    timezone: 'America/Los_Angeles', clubDomain: 'therams.com', excludeGenericCity: true,
    themes: buildThemeSpec({
      darkName: 'SoFi Night', lightName: 'Royal & Sol',
      darkPrimary: '#2563EB', darkPrimaryBright: '#60A5FA',
      darkSecondary: '#F5C400', darkSecondaryBright: '#FFE159',
      lightBg: '#F5F7FB', lightCardAlt: '#EAEFF8',
      lightPrimary: '#003594', lightPrimaryBright: '#0047C2',
      lightSecondary: '#8A6900', lightSecondaryBright: '#6B5000',
      crestPrimary: '#003594', crestSecondary: '#FFA300'
    }),
    coachesSeed: { hc: "Sean McVay", oc: "Nathan Scheelhaase", dc: "Chris Shula", gm: "Les Snead" },
    beatPodcastShows: [
      {
        "id": "rams_locked_on_rams",
        "collectionId": 1148968947,
        "name": "Locked On Rams",
        "fullTitle": "Locked On Rams - Daily Podcast On The Los Angeles Rams",
        "hosts": "Locked On Podcast Network, Doug McKain, Travis Rodgers",
        "network": "Locked On Podcast Network, Doug McKain, Travis Rodgers",
        "feedUrl": "https://rss.pdrl.fm/3fd73b/feeds.simplecast.com/a4Q6EDeU",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-rams-daily-podcast-on-the-los-angeles-rams/id1148968947?uo=4"
      },
      {
        "id": "rams_11_personnel",
        "collectionId": 1477535034,
        "name": "11 Personnel",
        "fullTitle": "11 Personnel: A show about the Los Angeles Rams",
        "hosts": "The Athletic",
        "network": "The Athletic",
        "feedUrl": "https://feeds.acast.com/public/shows/6838b33f5b56407fa4a8fd2e",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/11-personnel-a-show-about-the-los-angeles-rams/id1477535034?uo=4"
      },
      {
        "id": "rams_rams_revealed",
        "collectionId": 1445232369,
        "name": "Rams Revealed",
        "fullTitle": "Rams Revealed",
        "hosts": "Rams Revealed: A LA Rams Podcast",
        "network": "Rams Revealed: A LA Rams Podcast",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/103243cb-c6ba-4495-9778-aeac015c4e45/5440af2a-32e6-4f66-b05a-aeac015c4e53/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/rams-revealed/id1445232369?uo=4"
      },
      {
        "id": "rams_rams_brothers",
        "collectionId": 1446481503,
        "name": "Rams Brothers",
        "fullTitle": "Rams Brothers: The Pod, An LA Rams Podcast",
        "hosts": "Nick Vespe, Dene Vespe",
        "network": "Nick Vespe, Dene Vespe",
        "feedUrl": "https://feeds.simplecast.com/tsCGHzbj",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/rams-brothers-the-pod-an-la-rams-podcast/id1446481503?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'ARI', slug: 'cardinals', aliases: ['cards'],
    espnId: 22, espnAbbr: 'ari', otcSlug: 'arizona-cardinals', cbsAbbr: 'ARI', pfrAbbr: 'crd',
    city: 'Arizona', nickname: 'Cardinals', stadium: 'State Farm Stadium',
    brandName: 'Cardinals Red Sea',
    timezone: 'America/Phoenix', clubDomain: 'azcardinals.com',
    themes: buildThemeSpec({
      darkName: 'Desert Night', lightName: 'Cardinal White',
      darkPrimary: '#B8254B', darkPrimaryBright: '#F05279',
      darkSecondary: '#F2B830', darkSecondaryBright: '#FFD66B',
      lightBg: '#F9F6F6', lightCardAlt: '#F2EAEA',
      lightPrimary: '#97233F', lightPrimaryBright: '#B02345',
      lightSecondary: '#8A6008', lightSecondaryBright: '#6C4A04',
      crestPrimary: '#97233F', crestSecondary: '#FFB612'
    }),
    coachesSeed: { hc: "Mike LaFleur", oc: "Nathaniel Hackett", dc: "Nick Rallis", gm: "Monti Ossenfort" },
    beatPodcastShows: [
      {
        "id": "cardinals_locked_on_cardinals",
        "collectionId": 1161791386,
        "name": "Locked On Cardinals",
        "fullTitle": "Locked On Cardinals - Daily Podcast On The Arizona Cardinals",
        "hosts": "Locked On Podcast Network, Alex Clancy",
        "network": "Locked On Podcast Network, Alex Clancy",
        "feedUrl": "https://rss.pdrl.fm/21b2e1/feeds.simplecast.com/SRxnlfNZ",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-cardinals-daily-podcast-on-the-arizona-cardinals/id1161791386?uo=4"
      },
      {
        "id": "cardinals_arizona_cardinals_podcasts",
        "collectionId": 333230043,
        "name": "Arizona Cardinals Podcasts",
        "fullTitle": "Arizona Cardinals Podcasts",
        "hosts": "Arizona Cardinals",
        "network": "Arizona Cardinals",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/484044ef-7968-4466-8867-aeac01359d01/ad6ea3ae-0e78-456a-979a-aeac01359d14/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/arizona-cardinals-podcasts/id333230043?uo=4"
      },
      {
        "id": "cardinals_phnx_arizona_cardinals_podcast",
        "collectionId": 1584495230,
        "name": "PHNX Arizona Cardinals Podcast",
        "fullTitle": "PHNX Arizona Cardinals Podcast",
        "hosts": "ALLCITY Network, PHNX Sports",
        "network": "ALLCITY Network, PHNX Sports",
        "feedUrl": "https://rss.pdrl.fm/76e100/feeds.simplecast.com/stOiuixb",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/phnx-arizona-cardinals-podcast/id1584495230?uo=4"
      },
      {
        "id": "cardinals_seein_red",
        "collectionId": 1896892518,
        "name": "SEEIN’ RED",
        "fullTitle": "SEEIN’ RED: Arizona Cardinals Talk from an NFL Vet & Lifelong Fan",
        "hosts": "Seein' RED Podcast",
        "network": "Seein' RED Podcast",
        "feedUrl": "https://anchor.fm/s/10e4a6028/podcast/rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/seein-red-arizona-cardinals-talk-from-an-nfl-vet/id1896892518?uo=4"
      }
    ]
  }),

  // ============================ NFC NORTH ============================
  makeTeamEntry({
    abbr: 'DET', slug: 'lions', aliases: ['detroit', 'onepride'],
    espnId: 8, espnAbbr: 'det', otcSlug: 'detroit-lions', cbsAbbr: 'DET', pfrAbbr: 'det',
    city: 'Detroit', nickname: 'Lions', stadium: 'Ford Field',
    brandName: 'Lions One Pride',
    timezone: 'America/Detroit', clubDomain: 'detroitlions.com',
    requiredNicknames: ['Lions', 'Detroit'],
    searchAliases: ['Lions', 'Detroit Lions', 'One Pride'],
    coachesSeed: { hc: 'Dan Campbell', oc: 'Drew Petzing', dc: 'Kelvin Sheppard', gm: 'Brad Holmes' },
    themes: buildThemeSpec({
      darkName: 'Ford Field Night', lightName: 'Throwback Silver',
      darkBg: '#0A0E14', darkElevated: '#121822', darkCardAlt: '#18212E',
      darkPrimary: '#0076B6', darkPrimaryBright: '#4BB3F4',
      darkSecondary: '#B0B7BC', darkSecondaryBright: '#DCE2E7',
      lightBg: '#F4F7FA', lightCardAlt: '#E8EEF5',
      lightPrimary: '#005A9C', lightPrimaryBright: '#006CB8',
      lightSecondary: '#4B5A68', lightSecondaryBright: '#36434F',
      crestPrimary: '#0076B6', crestSecondary: '#B0B7BC'
    }),
    beatPodcastShows: [
      {
        id: 'locked_on_lions',
        collectionId: 1140514879,
        name: 'Locked On Lions',
        fullTitle: 'Locked On Lions - Daily Podcast On The Detroit Lions',
        hosts: 'Matt Dery',
        network: 'Locked On Podcast Network',
        feedUrl: 'https://rss.pdrl.fm/a0cc13/feeds.simplecast.com/ASw0G4io',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/locked-on-lions-daily-podcast-on-the-detroit-lions/id1140514879'
      },
      {
        id: 'pride_of_detroit',
        collectionId: 1040380210,
        name: 'Pride of Detroit PODcast',
        fullTitle: 'Pride of Detroit: for Detroit Lions fans',
        hosts: 'Jeremy Reisman, Erik Schlitt & Ryan Mathews',
        network: 'SB Nation / Vox Media',
        feedUrl: 'https://feeds.megaphone.fm/pride-of-detroit-lions',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/pride-of-detroit-for-detroit-lions-fans/id1040380210'
      },
      {
        id: 'detroit_lions_podcast',
        collectionId: 1003655963,
        name: 'The Detroit Lions Podcast',
        fullTitle: 'The Detroit Lions Podcast',
        hosts: 'Chris Risdon & Jeff Risdon',
        network: 'Detroit Lions Podcast',
        feedUrl: 'https://feeds.megaphone.fm/TTEOS7469992862',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/the-detroit-lions-podcast/id1003655963'
      },
      {
        id: 'dungeon_of_doom',
        collectionId: 1594683060,
        name: 'Dungeon of Doom',
        fullTitle: 'Dungeon of Doom: A Detroit Lions podcast from MLive',
        hosts: 'Ben Raven & MLive Beat Staff',
        network: 'MLive Media Group',
        feedUrl: 'https://feeds.megaphone.fm/dungeonofdoom',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/dungeon-of-doom-a-detroit-lions-podcast-from-mlive/id1594683060'
      },
      {
        id: 'one_pridecast',
        collectionId: 1387861240,
        name: 'One Pridecast',
        fullTitle: 'Detroit Lions | One Pridecast',
        hosts: 'Tim Twentyman & Dannie Rogers',
        network: 'Detroit Lions Official',
        feedUrl: 'https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/1db823d3-0609-49f2-a7a3-aeac0147ae98/d3f9c6bb-f33c-4f8f-9ded-aeac0147aea6/podcast.rss',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/detroit-lions-one-pridecast/id1387861240'
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'MIN', slug: 'vikings', aliases: ['vikes'],
    espnId: 16, espnAbbr: 'min', otcSlug: 'minnesota-vikings', cbsAbbr: 'MIN', pfrAbbr: 'min',
    city: 'Minnesota', nickname: 'Vikings', stadium: 'U.S. Bank Stadium',
    brandName: 'Vikings Skol',
    timezone: 'America/Chicago', clubDomain: 'vikings.com',
    themes: buildThemeSpec({
      darkName: 'Valhalla Night', lightName: 'Purple & Gold',
      darkPrimary: '#7C4DFF', darkPrimaryBright: '#A98BFF',
      darkSecondary: '#F5C400', darkSecondaryBright: '#FFE066',
      lightBg: '#F7F5FA', lightCardAlt: '#EEE9F5',
      lightPrimary: '#4F2683', lightPrimaryBright: '#61329E',
      lightSecondary: '#8A6700', lightSecondaryBright: '#6B4F00',
      crestPrimary: '#4F2683', crestSecondary: '#FFC62F'
    }),
    coachesSeed: { hc: "Kevin O'Connell", oc: "Wes Phillips", dc: "Brian Flores", gm: "Nolan Teasley" },
    beatPodcastShows: [
      {
        "id": "vikings_locked_on_vikings",
        "collectionId": 1144153403,
        "name": "Locked On Vikings",
        "fullTitle": "Locked On Vikings - Daily Podcast On The Minnesota Vikings",
        "hosts": "Locked On Podcast Network, Luke Braun",
        "network": "Locked On Podcast Network, Luke Braun",
        "feedUrl": "https://rss.pdrl.fm/dbd095/feeds.simplecast.com/sa0QprVo",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-vikings-daily-podcast-on-the-minnesota-vikings/id1144153403?uo=4"
      },
      {
        "id": "vikings_purple_insider",
        "collectionId": 1513529873,
        "name": "Purple Insider",
        "fullTitle": "Purple Insider - a Minnesota Vikings and NFL podcast",
        "hosts": "Matthew Coller, Bleav",
        "network": "Matthew Coller, Bleav",
        "feedUrl": "https://feeds.simplecast.com/PuzMMWua",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/purple-insider-a-minnesota-vikings-and-nfl-podcast/id1513529873?uo=4"
      },
      {
        "id": "vikings_purple_daily",
        "collectionId": 923544550,
        "name": "Purple Daily",
        "fullTitle": "Purple Daily | a Minnesota Vikings podcast",
        "hosts": "SKOR North",
        "network": "SKOR North",
        "feedUrl": "https://rss.art19.com/purple-daily",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/purple-daily-a-minnesota-vikings-podcast/id923544550?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'GB', slug: 'packers', aliases: ['pack', 'gnb'],
    espnId: 9, espnAbbr: 'gb', otcSlug: 'green-bay-packers', cbsAbbr: 'GB', pfrAbbr: 'gnb',
    city: 'Green Bay', nickname: 'Packers', stadium: 'Lambeau Field',
    brandName: 'Go Pack Go',
    timezone: 'America/Chicago', clubDomain: 'packers.com',
    themes: buildThemeSpec({
      darkName: 'Lambeau Night', lightName: 'Titletown Classic',
      darkPrimary: '#247A53', darkPrimaryBright: '#4ADE96',
      darkSecondary: '#F2B830', darkSecondaryBright: '#FFD76E',
      lightBg: '#F6F7F3', lightCardAlt: '#EBF0E6',
      lightPrimary: '#203731', lightPrimaryBright: '#2B4E45',
      lightSecondary: '#8A6300', lightSecondaryBright: '#6B4B00',
      crestPrimary: '#203731', crestSecondary: '#FFB612'
    }),
    coachesSeed: { hc: "Matt LaFleur", oc: "Adam Stenavich", dc: "Jonathan Gannon", gm: "Brian Gutekunst" },
    beatPodcastShows: [
      {
        "id": "packers_locked_on_packers",
        "collectionId": 1144508840,
        "name": "Locked On Packers",
        "fullTitle": "Locked On Packers - Daily Podcast On The Green Bay Packers",
        "hosts": "Peter Bukowski, Locked On Podcast Network",
        "network": "Peter Bukowski, Locked On Podcast Network",
        "feedUrl": "https://rss.pdrl.fm/5b095f/feeds.simplecast.com/FkBDUQLt",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-packers-daily-podcast-on-the-green-bay-packers/id1144508840?uo=4"
      },
      {
        "id": "packers_packers_unscripted",
        "collectionId": 1039516531,
        "name": "Packers Unscripted",
        "fullTitle": "Packers Unscripted",
        "hosts": "Green Bay Packers",
        "network": "Green Bay Packers",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/3862fdb6-c358-40eb-88b2-aea8004103a7/b8766a57-277c-4d7e-965e-aea8004103b9/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/packers-unscripted/id1039516531?uo=4"
      },
      {
        "id": "packers_pack",
        "collectionId": 1414100645,
        "name": "Pack-A-Day",
        "fullTitle": "Pack-A-Day: Your Daily Packers Podcast",
        "hosts": "Blue Wire, Andy Herman",
        "network": "Blue Wire, Andy Herman",
        "feedUrl": "https://feeds.simplecast.com/wX3kDX_W",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/pack-a-day-your-daily-packers-podcast/id1414100645?uo=4"
      },
      {
        "id": "packers_packernet_podcast",
        "collectionId": 1275596861,
        "name": "Packernet Podcast",
        "fullTitle": "Packernet Podcast: Daily Green Bay Packers Podcast",
        "hosts": "AC Sports",
        "network": "AC Sports",
        "feedUrl": "https://feeds.libsyn.com/545942/rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/packernet-podcast-daily-green-bay-packers-podcast/id1275596861?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'CHI', slug: 'bears', aliases: ['da-bears'],
    espnId: 3, espnAbbr: 'chi', otcSlug: 'chicago-bears', cbsAbbr: 'CHI', pfrAbbr: 'chi',
    city: 'Chicago', nickname: 'Bears', stadium: 'Soldier Field',
    brandName: 'Da Bears',
    timezone: 'America/Chicago', clubDomain: 'chicagobears.com',
    themes: buildThemeSpec({
      darkName: 'Soldier Field Night', lightName: 'Midway Classic',
      darkPrimary: '#E35B2B', darkPrimaryBright: '#FF7B4D',
      darkSecondary: '#8BA6CC', darkSecondaryBright: '#B8CCE8',
      lightBg: '#F5F6F9', lightCardAlt: '#EAECEF',
      lightPrimary: '#0B162A', lightPrimaryBright: '#1B2E52',
      lightSecondary: '#B8360A', lightSecondaryBright: '#962B06',
      crestPrimary: '#0B162A', crestSecondary: '#C83803'
    }),
    coachesSeed: { hc: "Ben Johnson", oc: "Press Taylor", dc: "Dennis Allen", gm: "Ryan Poles" },
    beatPodcastShows: [
      {
        "id": "bears_locked_on_bears",
        "collectionId": 1141591437,
        "name": "Locked On Bears",
        "fullTitle": "Locked On Bears - Daily Podcast On The Chicago Bears",
        "hosts": "Locked On Podcast Network, Lorin Cox",
        "network": "Locked On Podcast Network, Lorin Cox",
        "feedUrl": "https://rss.pdrl.fm/16e145/feeds.simplecast.com/yvyasWU5",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-bears-daily-podcast-on-the-chicago-bears/id1141591437?uo=4"
      },
      {
        "id": "bears_chicago_bears_podcasts",
        "collectionId": 848457125,
        "name": "Chicago Bears Podcasts",
        "fullTitle": "Chicago Bears Podcasts",
        "hosts": "Chicago Bears",
        "network": "Chicago Bears",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/4f703a36-2fa9-4d42-b09a-aeac01327730/b3c8eeec-ff0b-46a5-b7e4-aeac0132773e/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/chicago-bears-podcasts/id848457125?uo=4"
      },
      {
        "id": "bears_chgo_chicago_bears_podcast",
        "collectionId": 1039910852,
        "name": "CHGO Chicago Bears Podcast",
        "fullTitle": "CHGO Chicago Bears Podcast",
        "hosts": "ALLCITY Network, CHGO Sports",
        "network": "ALLCITY Network, CHGO Sports",
        "feedUrl": "https://feeds.simplecast.com/oSbdDATR",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/chgo-chicago-bears-podcast/id1039910852?uo=4"
      },
      {
        "id": "bears_the_chicago_bears_podcast",
        "collectionId": 1683659497,
        "name": "The Chicago Bears Podcast",
        "fullTitle": "The Chicago Bears Podcast",
        "hosts": "ESPN Chicago",
        "network": "ESPN Chicago",
        "feedUrl": "https://rss.amperwave.net/v2/feed/good-karma/wmvp-am-the_chicago_bears_podcast/itunes_akrgV",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/the-chicago-bears-podcast/id1683659497?uo=4"
      }
    ]
  }),

  // ============================ NFC EAST ============================
  makeTeamEntry({
    abbr: 'PHI', slug: 'eagles', aliases: ['birds'],
    espnId: 21, espnAbbr: 'phi', otcSlug: 'philadelphia-eagles', cbsAbbr: 'PHI', pfrAbbr: 'phi',
    city: 'Philadelphia', nickname: 'Eagles', stadium: 'Lincoln Financial Field',
    brandName: 'Fly Eagles Fly',
    timezone: 'America/New_York', clubDomain: 'philadelphiaeagles.com',
    themes: buildThemeSpec({
      darkName: 'Midnight Green', lightName: 'Kelly Throwback',
      darkPrimary: '#13828E', darkPrimaryBright: '#36C2CF',
      darkSecondary: '#A5ACAF', darkSecondaryBright: '#D2D8DB',
      lightBg: '#F4F8F8', lightCardAlt: '#E7F0F0',
      lightPrimary: '#004C54', lightPrimaryBright: '#00646E',
      lightSecondary: '#4B575C', lightSecondaryBright: '#354045',
      crestPrimary: '#004C54', crestSecondary: '#A5ACAF'
    }),
    coachesSeed: { hc: "Nick Sirianni", oc: "Sean Mannion", dc: "Vic Fangio", gm: "Howie Roseman" },
    beatPodcastShows: [
      {
        "id": "eagles_locked_on_eagles",
        "collectionId": 1139903017,
        "name": "Locked On Eagles",
        "fullTitle": "Locked On Eagles - Daily Podcast On The Philadelphia Eagles",
        "hosts": "Locked On Podcast Network, Louie DiBiase, Gino Cammilleri",
        "network": "Locked On Podcast Network, Louie DiBiase, Gino Cammilleri",
        "feedUrl": "https://rss.pdrl.fm/32c77c/feeds.simplecast.com/yy6iqCPY",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-eagles-daily-podcast-on-the-philadelphia-eagles/id1139903017?uo=4"
      },
      {
        "id": "eagles_phly_philadelphia_eagles_podcast",
        "collectionId": 1706944557,
        "name": "PHLY Philadelphia Eagles Podcast",
        "fullTitle": "PHLY Philadelphia Eagles Podcast",
        "hosts": "ALLCITY Network, PHLY Sports",
        "network": "ALLCITY Network, PHLY Sports",
        "feedUrl": "https://feeds.simplecast.com/rR8B4DDE",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/phly-philadelphia-eagles-podcast/id1706944557?uo=4"
      },
      {
        "id": "eagles_eagle_eye",
        "collectionId": 1376641140,
        "name": "Eagle Eye",
        "fullTitle": "Eagle Eye: A Philadelphia Eagles Podcast",
        "hosts": "NBC Sports Philadelphia",
        "network": "NBC Sports Philadelphia",
        "feedUrl": "https://feeds.simplecast.com/_ENNUG3a",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/eagle-eye-a-philadelphia-eagles-podcast/id1376641140?uo=4"
      },
      {
        "id": "eagles_eagle_eye_in_the_sky_podcast",
        "collectionId": 1012041038,
        "name": "Eagle Eye In The Sky Podcast",
        "fullTitle": "Eagle Eye In The Sky Podcast",
        "hosts": "Philadelphia Eagles",
        "network": "Philadelphia Eagles",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/691b6a17-8656-4fee-9fbd-aeac01480e8b/5a091549-1020-4a08-beb5-aeac01480e9e/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/eagle-eye-in-the-sky-podcast/id1012041038?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'DAL', slug: 'cowboys', aliases: ['boys'],
    espnId: 6, espnAbbr: 'dal', otcSlug: 'dallas-cowboys', cbsAbbr: 'DAL', pfrAbbr: 'dal',
    city: 'Dallas', nickname: 'Cowboys', stadium: 'AT&T Stadium',
    brandName: 'Cowboys Nation',
    timezone: 'America/Chicago', clubDomain: 'dallascowboys.com',
    themes: buildThemeSpec({
      darkName: 'Starlight Navy', lightName: 'Silver & Blue',
      darkPrimary: '#2965B5', darkPrimaryBright: '#64A2F0',
      darkSecondary: '#A4B0BE', darkSecondaryBright: '#CFD8E3',
      lightBg: '#F5F7FA', lightCardAlt: '#E9EEF5',
      lightPrimary: '#041E42', lightPrimaryBright: '#0B356E',
      lightSecondary: '#4E5B6B', lightSecondaryBright: '#374250',
      crestPrimary: '#041E42', crestSecondary: '#869397'
    }),
    coachesSeed: { hc: "Brian Schottenheimer", oc: "Klayton Adams", dc: "Christian Parker", gm: "Jerry Jones" },
    beatPodcastShows: [
      {
        "id": "cowboys_locked_on_cowboys",
        "collectionId": 1151519475,
        "name": "Locked On Cowboys",
        "fullTitle": "Locked On Cowboys - Daily Podcast On The Dallas Cowboys",
        "hosts": "Landon McCool, Marcus Mosher, Locked On Podcast Network",
        "network": "Landon McCool, Marcus Mosher, Locked On Podcast Network",
        "feedUrl": "https://rss.pdrl.fm/3e3416/feeds.simplecast.com/4NoEmSg7",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-cowboys-daily-podcast-on-the-dallas-cowboys/id1151519475?uo=4"
      },
      {
        "id": "cowboys_dallas_cowboys_podcasts",
        "collectionId": 1421978911,
        "name": "Dallas Cowboys Podcasts",
        "fullTitle": "Dallas Cowboys Podcasts",
        "hosts": "Dallas Cowboys",
        "network": "Dallas Cowboys",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/efde3178-5a7b-4797-90b2-aeac01489d98/8a52d4bf-df4a-40db-bfca-aeac01489da1/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/dallas-cowboys-podcasts/id1421978911?uo=4"
      },
      {
        "id": "cowboys_love_of_the_star",
        "collectionId": 1631178784,
        "name": "Love of the Star",
        "fullTitle": "Love of the Star: A Dallas Cowboys Podcast",
        "hosts": "Audacy",
        "network": "Audacy",
        "feedUrl": "https://rss.amperwave.net/v2/feed/audacynetwork/love-of-the-star",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/love-of-the-star-a-dallas-cowboys-podcast/id1631178784?uo=4"
      },
      {
        "id": "cowboys_talkin_cowboys",
        "collectionId": 213508091,
        "name": "Talkin' Cowboys",
        "fullTitle": "Talkin' Cowboys",
        "hosts": "Dallas Cowboys",
        "network": "Dallas Cowboys",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/daa09c7f-6c6b-44bd-b906-aeac01489de7/f8250829-ef85-42cf-90ff-aeac01489e03/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/talkin-cowboys/id213508091?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'NYG', slug: 'giants', aliases: ['bigblue'],
    espnId: 19, espnAbbr: 'nyg', otcSlug: 'new-york-giants', cbsAbbr: 'NYG', pfrAbbr: 'nyg',
    city: 'New York', nickname: 'Giants', stadium: 'MetLife Stadium',
    brandName: 'Giants Big Blue',
    timezone: 'America/New_York', clubDomain: 'giants.com', excludeGenericCity: true,
    themes: buildThemeSpec({
      darkName: 'Big Blue Night', lightName: 'Meadowlands Classic',
      darkPrimary: '#2D66D4', darkPrimaryBright: '#689CFF',
      darkSecondary: '#E54B5D', darkSecondaryBright: '#FF7D8C',
      lightBg: '#F5F7FA', lightCardAlt: '#E9EEF5',
      lightPrimary: '#0B2265', lightPrimaryBright: '#15348F',
      lightSecondary: '#A71930', lightSecondaryBright: '#851023',
      crestPrimary: '#0B2265', crestSecondary: '#A71930'
    }),
    coachesSeed: { hc: "John Harbaugh", oc: "Matt Nagy", dc: "Dennard Wilson", gm: "Joe Schoen" },
    beatPodcastShows: [
      {
        "id": "giants_locked_on_giants",
        "collectionId": 1144941431,
        "name": "Locked On Giants",
        "fullTitle": "Locked On Giants - Daily Podcast On The New York Giants",
        "hosts": "Locked On Podcast Network",
        "network": "Locked On Podcast Network",
        "feedUrl": "https://rss.pdrl.fm/da64a7/feeds.simplecast.com/Iu3ZtP7n",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-giants-daily-podcast-on-the-new-york-giants/id1144941431?uo=4"
      },
      {
        "id": "giants_big_blue_banter",
        "collectionId": 1387339234,
        "name": "Big Blue Banter",
        "fullTitle": "Big Blue Banter: A New York Giants Football Podcast",
        "hosts": "Blue Wire",
        "network": "Blue Wire",
        "feedUrl": "https://feeds.simplecast.com/Zc7GfsBY",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/big-blue-banter-a-new-york-giants-football-podcast/id1387339234?uo=4"
      },
      {
        "id": "giants_big_blue_kickoff_live",
        "collectionId": 1486876072,
        "name": "Big Blue Kickoff Live",
        "fullTitle": "Big Blue Kickoff Live | New York Giants",
        "hosts": "New York Giants",
        "network": "New York Giants",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/39ec9424-442e-4f83-b8b1-aea900256654/e0103b25-98cc-437f-9cfc-aea90025666b/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/big-blue-kickoff-live-new-york-giants/id1486876072?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'WAS', slug: 'commanders', aliases: ['wsh', 'washington'],
    espnId: 28, espnAbbr: 'wsh', otcSlug: 'washington-commanders', cbsAbbr: 'WAS', pfrAbbr: 'was',
    city: 'Washington', nickname: 'Commanders', stadium: 'Northwest Stadium',
    brandName: 'Hail Washington',
    timezone: 'America/New_York', clubDomain: 'commanders.com',
    themes: buildThemeSpec({
      darkName: 'Burgundy Night', lightName: 'Capital Gold',
      darkPrimary: '#A83244', darkPrimaryBright: '#E56074',
      darkSecondary: '#F2B830', darkSecondaryBright: '#FFD66E',
      lightBg: '#F8F5F4', lightCardAlt: '#EFE8E6',
      lightPrimary: '#5A1414', lightPrimaryBright: '#7A1C1C',
      lightSecondary: '#8A6008', lightSecondaryBright: '#6B4804',
      crestPrimary: '#5A1414', crestSecondary: '#FFB612'
    }),
    coachesSeed: { hc: "Dan Quinn", oc: "David Blough", dc: "Daronte Jones", gm: "Adam Peters" },
    beatPodcastShows: [
      {
        "id": "commanders_locked_on_commanders",
        "collectionId": 1144183096,
        "name": "Locked On Commanders",
        "fullTitle": "Locked On Commanders - Daily Podcast On The Washington Commanders",
        "hosts": "Locked On Podcast Network, David Harrison",
        "network": "Locked On Podcast Network, David Harrison",
        "feedUrl": "https://rss.pdrl.fm/7c3048/feeds.simplecast.com/psq7p3Ar",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-commanders-daily-podcast-on-the-washington/id1144183096?uo=4"
      },
      {
        "id": "commanders_john_keim_report",
        "collectionId": 1455645619,
        "name": "John Keim Report",
        "fullTitle": "John Keim Report",
        "hosts": "Ampire Media, Bleav",
        "network": "Ampire Media, Bleav",
        "feedUrl": "https://feeds.simplecast.com/kSOAGvW5",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/john-keim-report/id1455645619?uo=4"
      },
      {
        "id": "commanders_the_al_galdi_podcast",
        "collectionId": 1553345193,
        "name": "The Al Galdi Podcast",
        "fullTitle": "The Al Galdi Podcast",
        "hosts": "Al Galdi, Blue Wire",
        "network": "Blue Wire",
        "feedUrl": "https://rss.pdrl.fm/411d5a/feeds.simplecast.com/Xn4Ik036",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/the-al-galdi-podcast/id1553345193?uo=4"
      },
      {
        "id": "commanders_beltway_football",
        "collectionId": 1151988852,
        "name": "Beltway Football",
        "fullTitle": "Beltway Football",
        "hosts": "JP Finlay, Mitch Tischler, Pete Hailey",
        "network": "Monumental Sports Network",
        "feedUrl": "https://rss.art19.com/beltway-football",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/beltway-football/id1151988852?uo=4"
      },
      {
        "id": "commanders_the_kevin_sheehan_show",
        "collectionId": 1435515037,
        "name": "The Kevin Sheehan Show",
        "fullTitle": "The Kevin Sheehan Show",
        "hosts": "Kevin Sheehan, Blue Wire",
        "network": "Kevin Sheehan, Blue Wire",
        "feedUrl": "https://feeds.simplecast.com/WN4LInTx",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/the-kevin-sheehan-show/id1435515037?uo=4"
      }
    ]
  }),

  // ============================ NFC SOUTH ============================
  makeTeamEntry({
    abbr: 'TB', slug: 'buccaneers', aliases: ['bucs', 'tam'],
    espnId: 27, espnAbbr: 'tb', otcSlug: 'tampa-bay-buccaneers', cbsAbbr: 'TB', pfrAbbr: 'tam',
    city: 'Tampa Bay', nickname: 'Buccaneers', stadium: 'Raymond James Stadium',
    brandName: 'Bucs Krewe',
    timezone: 'America/New_York', clubDomain: 'buccaneers.com',
    themes: buildThemeSpec({
      darkName: 'Pewter Night', lightName: 'Creamsicle Heritage',
      darkPrimary: '#D51E34', darkPrimaryBright: '#FF5A6E',
      darkSecondary: '#B6A89D', darkSecondaryBright: '#DCD2C9',
      lightBg: '#F8F6F4', lightCardAlt: '#EFEAE6',
      lightPrimary: '#A50E22', lightPrimaryBright: '#C4162C',
      lightSecondary: '#5C514A', lightSecondaryBright: '#453C36',
      crestPrimary: '#D50A0A', crestSecondary: '#B1BABF'
    }),
    coachesSeed: { hc: "Todd Bowles", oc: "Zac Robinson", dc: "Todd Bowles", gm: "Jason Licht" },
    beatPodcastShows: [
      {
        "id": "buccaneers_locked_on_bucs",
        "collectionId": 1139752021,
        "name": "Locked On Bucs",
        "fullTitle": "Locked On Bucs – Daily Podcast On The Tampa Bay Buccaneers",
        "hosts": "Locked On Podcast Network, James Yarcho",
        "network": "Locked On Podcast Network, James Yarcho",
        "feedUrl": "https://rss.pdrl.fm/ca31e9/feeds.simplecast.com/mOWpQkH2",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-bucs-daily-podcast-on-the-tampa-bay-buccaneers/id1139752021?uo=4"
      },
      {
        "id": "buccaneers_salty_dogs",
        "collectionId": 1420665229,
        "name": "Salty Dogs",
        "fullTitle": "Salty Dogs",
        "hosts": "Tampa Bay Buccaneers",
        "network": "Tampa Bay Buccaneers",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/20267f26-3b4d-40d6-a5fd-aea90029f1eb/39bb7413-22e5-4a67-a26e-aea90029f1f9/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/salty-dogs/id1420665229?uo=4"
      },
      {
        "id": "buccaneers_pewter_report_podcast",
        "collectionId": 1216727537,
        "name": "Pewter Report Podcast",
        "fullTitle": "Pewter Report Podcast",
        "hosts": "Bucs",
        "network": "Bucs",
        "feedUrl": "https://feeds.megaphone.fm/RTERE6185627144",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/pewter-report-podcast/id1216727537?uo=4"
      },
      {
        "id": "buccaneers_bucs_players_table",
        "collectionId": 1436038723,
        "name": "Bucs Players' Table",
        "fullTitle": "Bucs Players' Table",
        "hosts": "Tampa Bay Buccaneers",
        "network": "Tampa Bay Buccaneers",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/47ba869d-38cf-4f27-ab21-aea90029f19b/a957d84b-925d-4e55-bb16-aea90029f1ae/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/bucs-players-table/id1436038723?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'NO', slug: 'saints', aliases: ['nor', 'whodat'],
    espnId: 18, espnAbbr: 'no', otcSlug: 'new-orleans-saints', cbsAbbr: 'NO', pfrAbbr: 'nor',
    city: 'New Orleans', nickname: 'Saints', stadium: 'Caesars Superdome',
    brandName: 'Saints Who Dat',
    timezone: 'America/Chicago', clubDomain: 'neworleanssaints.com',
    themes: buildThemeSpec({
      darkName: 'Superdome Black', lightName: 'Old Gold Classic',
      darkPrimary: '#C4A661', darkPrimaryBright: '#E6CA85',
      darkSecondary: '#B8BFC7', darkSecondaryBright: '#DCE2E8',
      lightBg: '#F7F5F0', lightCardAlt: '#EFECE3',
      lightPrimary: '#1A1A1A', lightPrimaryBright: '#333333',
      lightSecondary: '#806526', lightSecondaryBright: '#634D1A',
      crestPrimary: '#101820', crestSecondary: '#D3BC8D'
    }),
    coachesSeed: { hc: "Kellen Moore", oc: "Doug Nussmeier", dc: "Brandon Staley", gm: "Mickey Loomis" },
    beatPodcastShows: [
      {
        "id": "saints_locked_on_saints",
        "collectionId": 997872651,
        "name": "Locked On Saints",
        "fullTitle": "Locked On Saints - Daily Podcast On The New Orleans Saints",
        "hosts": "Locked On Podcast Network, Ross Jackson",
        "network": "Locked On Podcast Network, Ross Jackson",
        "feedUrl": "https://rss.pdrl.fm/83ac39/feeds.simplecast.com/aKgoC4uX",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-saints-daily-podcast-on-the-new-orleans-saints/id997872651?uo=4"
      },
      {
        "id": "saints_neworleans_football",
        "collectionId": 1153789570,
        "name": "NewOrleans.Football",
        "fullTitle": "NewOrleans.Football: Saints Podcast",
        "hosts": "NewOrleans.Football",
        "network": "NewOrleans.Football",
        "feedUrl": "https://feeds.transistor.fm/neworleans-football-saints-podcast",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/neworleans-football-saints-podcast/id1153789570?uo=4"
      },
      {
        "id": "saints_saints_happy_hour",
        "collectionId": 1023150373,
        "name": "Saints Happy Hour",
        "fullTitle": "Saints Happy Hour",
        "hosts": "Saints Happy Hour",
        "network": "Saints Happy Hour",
        "feedUrl": "https://rss.art19.com/saints-happy-hour",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/saints-happy-hour/id1023150373?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'ATL', slug: 'falcons', aliases: ['dirtybirds'],
    espnId: 1, espnAbbr: 'atl', otcSlug: 'atlanta-falcons', cbsAbbr: 'ATL', pfrAbbr: 'atl',
    city: 'Atlanta', nickname: 'Falcons', stadium: 'Mercedes-Benz Stadium',
    brandName: 'Falcons Rise Up',
    timezone: 'America/New_York', clubDomain: 'atlantafalcons.com',
    themes: buildThemeSpec({
      darkName: 'Benz Blackout', lightName: 'Atlanta Classic',
      darkPrimary: '#C8233E', darkPrimaryBright: '#F55670',
      darkSecondary: '#A5ACAF', darkSecondaryBright: '#D2D8DB',
      lightBg: '#F7F6F6', lightCardAlt: '#EFECEC',
      lightPrimary: '#A71930', lightPrimaryBright: '#C21F39',
      lightSecondary: '#4E5559', lightSecondaryBright: '#383E42',
      crestPrimary: '#A71930', crestSecondary: '#A5ACAF'
    }),
    coachesSeed: { hc: "Kevin Stefanski", oc: "Tommy Rees", dc: "Jeff Ulbrich", gm: "Ian Cunningham" },
    beatPodcastShows: [
      {
        "id": "falcons_locked_on_falcons",
        "collectionId": 1147245791,
        "name": "Locked On Falcons",
        "fullTitle": "Locked On Falcons - Daily Podcast On The Atlanta Falcons",
        "hosts": "Locked On Podcast Network, Aaron Freeman",
        "network": "Locked On Podcast Network, Aaron Freeman",
        "feedUrl": "https://rss.pdrl.fm/d31f4c/feeds.simplecast.com/l96cnojt",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-falcons-daily-podcast-on-the-atlanta-falcons/id1147245791?uo=4"
      },
      {
        "id": "falcons_bleav_in_falcons",
        "collectionId": 1563021906,
        "name": "Bleav in Falcons",
        "fullTitle": "Bleav in Falcons",
        "hosts": "Bleav Network",
        "network": "Bleav",
        "feedUrl": "https://feeds.simplecast.com/GVQXOdsn",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/bleav-in-falcons/id1563021906?uo=4"
      },
      {
        "id": "falcons_outta_your_falcon_mind",
        "collectionId": 1590954165,
        "name": "Outta Your Falcon Mind",
        "fullTitle": "Outta Your Falcon Mind",
        "hosts": "Outta Your Falcon Mind",
        "network": "Outta Your Falcon Mind",
        "feedUrl": "https://anchor.fm/s/6b524804/podcast/rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/outta-your-falcon-mind/id1590954165?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'CAR', slug: 'panthers', aliases: ['keeppounding'],
    espnId: 29, espnAbbr: 'car', otcSlug: 'carolina-panthers', cbsAbbr: 'CAR', pfrAbbr: 'car',
    city: 'Carolina', nickname: 'Panthers', stadium: 'Bank of America Stadium',
    brandName: 'Keep Pounding',
    timezone: 'America/New_York', clubDomain: 'panthers.com',
    themes: buildThemeSpec({
      darkName: 'Black & Blue Night', lightName: 'Process Blue',
      darkPrimary: '#0085CA', darkPrimaryBright: '#47B8F5',
      darkSecondary: '#BFC0BF', darkSecondaryBright: '#E0E2E2',
      lightBg: '#F4F8FB', lightCardAlt: '#E8F0F6',
      lightPrimary: '#005F91', lightPrimaryBright: '#0072AD',
      lightSecondary: '#4B555E', lightSecondaryBright: '#363E45',
      crestPrimary: '#0085CA', crestSecondary: '#BFC0BF'
    }),
    coachesSeed: { hc: "Dave Canales", oc: "Brad Idzik", dc: "Todd Wash", gm: "Dan Morgan" },
    beatPodcastShows: [
      {
        "id": "panthers_locked_on_panthers",
        "collectionId": 1150966073,
        "name": "Locked On Panthers",
        "fullTitle": "Locked On Panthers - Daily Podcast On The Carolina Panthers",
        "hosts": "Locked On Podcast Network, Julian Council",
        "network": "Locked On Podcast Network, Julian Council",
        "feedUrl": "https://rss.pdrl.fm/c2438b/feeds.simplecast.com/3JTeh8Y2",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-panthers-daily-podcast-on-the-carolina-panthers/id1150966073?uo=4"
      },
      {
        "id": "panthers_panthers_playbook",
        "collectionId": 1697162650,
        "name": "Panthers Playbook",
        "fullTitle": "Panthers Playbook",
        "hosts": "99.9 The Fan | Raleigh, North Carolina",
        "network": "99.9 The Fan | Raleigh, North Carolina",
        "feedUrl": "https://feed.cdnstream1.com/zjb/feed/download/99/c9/e8/99c9e89a-3322-4455-8c08-b882e03ba2af.xml",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/panthers-playbook/id1697162650?uo=4"
      },
      {
        "id": "panthers_bleav_in_carolina_panthers",
        "collectionId": 1515076603,
        "name": "Bleav in Panthers",
        "fullTitle": "Bleav in Carolina Panthers",
        "hosts": "Bleav Network",
        "network": "Bleav",
        "feedUrl": "https://feeds.simplecast.com/heiTBv_K",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/bleav-in-carolina-panthers/id1515076603?uo=4"
      }
    ]
  }),

  // ============================ AFC EAST ============================
  makeTeamEntry({
    abbr: 'BUF', slug: 'bills', aliases: ['buffalo', 'billsmafia'],
    espnId: 2, espnAbbr: 'buf', otcSlug: 'buffalo-bills', cbsAbbr: 'BUF', pfrAbbr: 'buf',
    city: 'Buffalo', nickname: 'Bills', stadium: 'Highmark Stadium',
    brandName: 'Bills Mafia',
    timezone: 'America/New_York', clubDomain: 'buffalobills.com',
    requiredNicknames: ['Bills', 'Buffalo'],
    searchAliases: ['Bills', 'Buffalo Bills', 'Bills Mafia'],
    coachesSeed: { hc: 'Joe Brady', oc: 'Pete Carmichael Jr.', dc: 'Jim Leonhard', gm: 'Brandon Beane' },
    themes: buildThemeSpec({
      darkName: 'Highmark Night', lightName: 'Standing Buffalo',
      darkBg: '#090D16', darkElevated: '#111827', darkCardAlt: '#172033',
      darkPrimary: '#1D5FD6', darkPrimaryBright: '#5E9AFF',
      darkSecondary: '#E5485B', darkSecondaryBright: '#FF7A8A',
      lightBg: '#F5F7FB', lightCardAlt: '#E8EEF8',
      lightPrimary: '#00338D', lightPrimaryBright: '#0047C2',
      lightSecondary: '#B80B2C', lightSecondaryBright: '#960722',
      crestPrimary: '#00338D', crestSecondary: '#C60C30'
    }),
    beatPodcastShows: [
      {
        id: 'locked_on_bills',
        collectionId: 1145479962,
        name: 'Locked On Bills',
        fullTitle: 'Locked On Bills - Daily Podcast On The Buffalo Bills',
        hosts: 'Joe Marino',
        network: 'Locked On Podcast Network',
        feedUrl: 'https://rss.pdrl.fm/8c06ff/feeds.simplecast.com/LIaoLB9Y',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/locked-on-bills-daily-podcast-on-the-buffalo-bills/id1145479962'
      },
      {
        id: 'cover_1_buffalo',
        collectionId: 1370118411,
        name: 'Cover 1 Buffalo',
        fullTitle: 'Cover 1 Buffalo',
        hosts: 'Greg Tompsett & Aaron Quinn',
        network: 'Cover 1 Sports',
        feedUrl: 'https://www.spreaker.com/show/2885244/episodes/feed',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/cover-1-buffalo/id1370118411'
      },
      {
        id: 'buffalo_rumblings',
        collectionId: 1260431411,
        name: 'Buffalo Rumblings',
        fullTitle: 'Buffalo Rumblings: for Buffalo Bills fans',
        hosts: 'Buffalo Rumblings Network',
        network: 'SB Nation / Vox Media',
        feedUrl: 'https://feeds.megaphone.fm/buffalo-rumblings-bills',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/buffalo-rumblings-for-buffalo-bills-fans/id1260431411'
      },
      {
        id: 'shout_bills_podcast',
        collectionId: 1507446314,
        name: 'Shout! Bills Podcast',
        fullTitle: 'Shout! A football podcast on the Buffalo Bills with Matt Parrino and Ryan Talbot',
        hosts: 'Matt Parrino & Ryan Talbot',
        network: 'Syracuse.com / NYup.com',
        feedUrl: 'https://feeds.megaphone.fm/shoutabuffalobillspodcast',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/shout-a-football-podcast-on-the-buffalo-bills-with/id1507446314'
      },
      {
        id: 'buffalo_plus',
        collectionId: 1516732193,
        name: 'Buffalo Plus',
        fullTitle: 'Buffalo Plus: A Buffalo Bills podcast',
        hosts: 'Mike Catalana, Jenna Cottrell & Dan Fetes',
        network: 'Buffalo Plus',
        feedUrl: 'https://feeds.megaphone.fm/SINCL4140657051',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/buffalo-plus-a-buffalo-bills-podcast/id1516732193'
      },
      {
        id: 'one_bills_live',
        collectionId: 1649776359,
        name: 'One Bills Live',
        fullTitle: 'One Bills Live',
        hosts: 'Chris Brown & Steve Tasker',
        network: 'Buffalo Bills Official',
        feedUrl: 'https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/81b68f85-0c3c-4cd7-a504-aeac01336f91/6f9db0fa-bb9c-4c3f-b0df-aeac01336f9a/podcast.rss',
        appleShowUrl: 'https://podcasts.apple.com/us/podcast/one-bills-live/id1649776359'
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'NE', slug: 'patriots', aliases: ['pats', 'nwe'],
    espnId: 17, espnAbbr: 'ne', otcSlug: 'new-england-patriots', cbsAbbr: 'NE', pfrAbbr: 'nwe',
    city: 'New England', nickname: 'Patriots', stadium: 'Gillette Stadium',
    brandName: 'Pats Nation',
    timezone: 'America/New_York', clubDomain: 'patriots.com',
    themes: buildThemeSpec({
      darkName: 'Foxborough Night', lightName: 'Pat Patriot Classic',
      darkPrimary: '#2A63C9', darkPrimaryBright: '#689CFF',
      darkSecondary: '#E5485B', darkSecondaryBright: '#FF7D8C',
      lightBg: '#F5F7FA', lightCardAlt: '#E9EEF5',
      lightPrimary: '#002244', lightPrimaryBright: '#0D3866',
      lightSecondary: '#B30B2C', lightSecondaryBright: '#8F0722',
      crestPrimary: '#002244', crestSecondary: '#C60C30'
    }),
    coachesSeed: { hc: "Mike Vrabel", oc: "Josh McDaniels", dc: "Zak Kuhr", gm: "Eliot Wolf" },
    beatPodcastShows: [
      {
        "id": "patriots_locked_on_patriots",
        "collectionId": 1140512627,
        "name": "Locked On Patriots",
        "fullTitle": "Locked On Patriots - Daily Podcast On The New England Patriots",
        "hosts": "Locked On Podcast Network, Mike D’Abate",
        "network": "Locked On Podcast Network, Mike D’Abate",
        "feedUrl": "https://rss.pdrl.fm/b4173b/feeds.simplecast.com/wbru9pmV",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-patriots-daily-podcast-on-the-new-england/id1140512627?uo=4"
      },
      {
        "id": "patriots_patriots_unfiltered",
        "collectionId": 187310910,
        "name": "Patriots Unfiltered",
        "fullTitle": "Patriots Unfiltered",
        "hosts": "New England Patriots",
        "network": "New England Patriots",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/73e7109b-287b-452a-a1ac-aea9013f8eb9/fe972ea1-2d5b-44c5-ba0c-aea9013f8ec7/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/patriots-unfiltered/id187310910?uo=4"
      },
      {
        "id": "patriots_patriots_catch",
        "collectionId": 1648381074,
        "name": "Patriots Catch-22",
        "fullTitle": "Patriots Catch-22",
        "hosts": "New England Patriots",
        "network": "New England Patriots",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/fe294560-4c66-449e-9a9d-af200122c7cd/c0ed4fea-6fcc-49d3-a960-af2001232f20/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/patriots-catch-22/id1648381074?uo=4"
      },
      {
        "id": "patriots_patriots_postgame_show",
        "collectionId": 1120749709,
        "name": "Patriots Postgame Show",
        "fullTitle": "Patriots Postgame Show",
        "hosts": "New England Patriots",
        "network": "New England Patriots",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/39c85756-0a7b-45d3-b6dc-aea9013a26b8/db4bbad7-5435-46a4-844c-aea9013a26c1/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/patriots-postgame-show/id1120749709?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'MIA', slug: 'dolphins', aliases: ['fins'],
    espnId: 15, espnAbbr: 'mia', otcSlug: 'miami-dolphins', cbsAbbr: 'MIA', pfrAbbr: 'mia',
    city: 'Miami', nickname: 'Dolphins', stadium: 'Hard Rock Stadium',
    brandName: 'Fins Up',
    timezone: 'America/New_York', clubDomain: 'miamidolphins.com',
    themes: buildThemeSpec({
      darkName: 'Biscayne Night', lightName: 'Aqua Throwback',
      darkPrimary: '#0099A8', darkPrimaryBright: '#3CD3E2',
      darkSecondary: '#FF7D45', darkSecondaryBright: '#FFA075',
      lightBg: '#F3F9FA', lightCardAlt: '#E5F2F4',
      lightPrimary: '#006875', lightPrimaryBright: '#007E8E',
      lightSecondary: '#B83C12', lightSecondaryBright: '#962E0B',
      crestPrimary: '#008E97', crestSecondary: '#FC4C02'
    }),
    coachesSeed: { hc: "Jeff Hafley", oc: "Bobby Slowik", dc: "Sean Duggan", gm: "Jon-Eric Sullivan" },
    beatPodcastShows: [
      {
        "id": "dolphins_locked_on_dolphins",
        "collectionId": 1137170219,
        "name": "Locked On Dolphins",
        "fullTitle": "Locked On Dolphins - Daily Podcast On The Miami Dolphins",
        "hosts": "Kyle Crabbs, Locked On Podcast Network",
        "network": "Kyle Crabbs, Locked On Podcast Network",
        "feedUrl": "https://rss.pdrl.fm/781205/feeds.simplecast.com/f8EFrtWR",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-dolphins-daily-podcast-on-the-miami-dolphins/id1137170219?uo=4"
      },
      {
        "id": "dolphins_drive_time_with_travis_wingfield",
        "collectionId": 1500281964,
        "name": "Drive Time with Travis Wingfield",
        "fullTitle": "Drive Time with Travis Wingfield",
        "hosts": "Miami Dolphins",
        "network": "Miami Dolphins",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/4ed207d2-7db7-4799-9aa5-aea90021be63/66d7bdfb-e635-4f56-bf92-aea90021be6c/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/drive-time-with-travis-wingfield/id1500281964?uo=4"
      },
      {
        "id": "dolphins_3_yards_per_carry",
        "collectionId": 1363764781,
        "name": "3 Yards Per Carry",
        "fullTitle": "3 Yards Per Carry - Miami Dolphins",
        "hosts": "Five Reasons Sports Network",
        "network": "Five Reasons Sports Network",
        "feedUrl": "https://feeds.redcircle.com/94143856-5d8a-44d5-8fd4-430ec1776120",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/3-yards-per-carry-miami-dolphins/id1363764781?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'NYJ', slug: 'jets', aliases: ['ganggreen'],
    espnId: 20, espnAbbr: 'nyj', otcSlug: 'new-york-jets', cbsAbbr: 'NYJ', pfrAbbr: 'nyj',
    city: 'New York', nickname: 'Jets', stadium: 'MetLife Stadium',
    brandName: 'Jets Gang Green',
    timezone: 'America/New_York', clubDomain: 'newyorkjets.com', excludeGenericCity: true,
    themes: buildThemeSpec({
      darkName: 'Stealth Black', lightName: 'Gotham Green',
      darkPrimary: '#198754', darkPrimaryBright: '#47D18E',
      darkSecondary: '#A8B3BE', darkSecondaryBright: '#D4DCE3',
      lightBg: '#F4F8F6', lightCardAlt: '#E8F0EC',
      lightPrimary: '#125740', lightPrimaryBright: '#187053',
      lightSecondary: '#4A5752', lightSecondaryBright: '#34403B',
      crestPrimary: '#125740', crestSecondary: '#FFFFFF'
    }),
    coachesSeed: { hc: "Aaron Glenn", oc: "Frank Reich", dc: "Brian Duker", gm: "Darren Mougey" },
    beatPodcastShows: [
      {
        "id": "jets_locked_on_jets",
        "collectionId": 1149033319,
        "name": "Locked On Jets",
        "fullTitle": "Locked On Jets - Daily Podcast On The New York Jets",
        "hosts": "Locked On Podcast Network, John Butchko",
        "network": "Locked On Podcast Network, John Butchko",
        "feedUrl": "https://rss.pdrl.fm/118578/feeds.simplecast.com/x5WGS9vX",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-jets-daily-podcast-on-the-new-york-jets/id1149033319?uo=4"
      },
      {
        "id": "jets_play_like_a_jet",
        "collectionId": 1236901698,
        "name": "Play Like A Jet",
        "fullTitle": "Play Like A Jet: New York Jets",
        "hosts": "Play Like a Jet",
        "network": "Play Like a Jet",
        "feedUrl": "https://feeds.megaphone.fm/otjetspod",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/play-like-a-jet-new-york-jets/id1236901698?uo=4"
      },
      {
        "id": "jets_turn_on_the_jets",
        "collectionId": 1035386921,
        "name": "Turn On The Jets",
        "fullTitle": "Turn On The Jets: New York Jets",
        "hosts": "Turn on the Jets",
        "network": "Turn on the Jets",
        "feedUrl": "https://feeds.megaphone.fm/otjets",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/turn-on-the-jets-new-york-jets/id1035386921?uo=4"
      },
      {
        "id": "jets_oklahoma_drill",
        "collectionId": 1561404614,
        "name": "Oklahoma Drill",
        "fullTitle": "Oklahoma Drill | New York Jets & NFL Debates",
        "hosts": "Jets X-Factor",
        "network": "Jets X-Factor",
        "feedUrl": "https://rss.amperwave.net/v2/feed/audacynetwork/3837eb977658089e83bd96856c14287a",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/oklahoma-drill-new-york-jets-nfl-debates/id1561404614?uo=4"
      }
    ]
  }),

  // ============================ AFC NORTH ============================
  makeTeamEntry({
    abbr: 'BAL', slug: 'ravens', aliases: ['flock'],
    espnId: 33, espnAbbr: 'bal', otcSlug: 'baltimore-ravens', cbsAbbr: 'BAL', pfrAbbr: 'rav',
    city: 'Baltimore', nickname: 'Ravens', stadium: 'M&T Bank Stadium',
    brandName: 'Ravens Flock',
    timezone: 'America/New_York', clubDomain: 'baltimoreravens.com',
    themes: buildThemeSpec({
      darkName: 'Charm City Night', lightName: 'Purple & Gold',
      darkPrimary: '#7657E5', darkPrimaryBright: '#A38BFF',
      darkSecondary: '#E6B84C', darkSecondaryBright: '#F7D57E',
      lightBg: '#F6F5FA', lightCardAlt: '#ECE9F5',
      lightPrimary: '#241773', lightPrimaryBright: '#3825A3',
      lightSecondary: '#856216', lightSecondaryBright: '#664A0E',
      crestPrimary: '#241773', crestSecondary: '#9E7C0C'
    }),
    coachesSeed: { hc: "Jesse Minter", oc: "Declan Doyle", dc: "Anthony Weaver", gm: "Eric DeCosta" },
    beatPodcastShows: [
      {
        "id": "ravens_locked_on_ravens",
        "collectionId": 1153456714,
        "name": "Locked On Ravens",
        "fullTitle": "Locked On Ravens - Daily Podcast On The Baltimore Ravens",
        "hosts": "Locked On Podcast Network, Kevin Oestreicher",
        "network": "Locked On Podcast Network, Kevin Oestreicher",
        "feedUrl": "https://rss.pdrl.fm/e33f24/feeds.simplecast.com/CxbuJ6nL",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-ravens-daily-podcast-on-the-baltimore-ravens/id1153456714?uo=4"
      },
      {
        "id": "ravens_the_ravens_lounge",
        "collectionId": 1142013759,
        "name": "The Ravens Lounge",
        "fullTitle": "The Ravens Lounge",
        "hosts": "Baltimore Ravens",
        "network": "Baltimore Ravens",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/ab04e7fc-0340-470c-8ca2-aea70183e095/636a6b83-f979-4aeb-9f44-aea70183e0a3/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/the-ravens-lounge/id1142013759?uo=4"
      },
      {
        "id": "ravens_the_vault",
        "collectionId": 1635836036,
        "name": "The Vault",
        "fullTitle": "The Vault: A Podcast Covering the Baltimore Ravens",
        "hosts": "Bleav",
        "network": "Bleav",
        "feedUrl": "https://rss.pdrl.fm/0d589c/feeds.simplecast.com/FLv6o1WR",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/the-vault-a-podcast-covering-the-baltimore-ravens/id1635836036?uo=4"
      },
      {
        "id": "ravens_exit_52_podcast",
        "collectionId": 1874345406,
        "name": "Exit 52 Podcast",
        "fullTitle": "Exit 52 Podcast",
        "hosts": "Exit 52",
        "network": "Exit 52",
        "feedUrl": "https://feeds.soundcloud.com/users/soundcloud:users:1664629343/sounds.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/exit-52-podcast/id1874345406?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'CIN', slug: 'bengals', aliases: ['whodey'],
    espnId: 4, espnAbbr: 'cin', otcSlug: 'cincinnati-bengals', cbsAbbr: 'CIN', pfrAbbr: 'cin',
    city: 'Cincinnati', nickname: 'Bengals', stadium: 'Paycor Stadium',
    brandName: 'Bengals Who Dey',
    timezone: 'America/New_York', clubDomain: 'bengals.com',
    themes: buildThemeSpec({
      darkName: 'Jungle Night', lightName: 'White Bengal',
      darkPrimary: '#E8531E', darkPrimaryBright: '#FF7D4D',
      darkSecondary: '#B3B8BF', darkSecondaryBright: '#DCE0E6',
      lightBg: '#F9F7F5', lightCardAlt: '#F0EBE6',
      lightPrimary: '#B8390E', lightPrimaryBright: '#D44211',
      lightSecondary: '#4B5056', lightSecondaryBright: '#34383D',
      crestPrimary: '#FB4F14', crestSecondary: '#000000'
    }),
    coachesSeed: { hc: "Zac Taylor", oc: "Dan Pitcher", dc: "Al Golden", gm: "Duke Tobin" },
    beatPodcastShows: [
      {
        "id": "bengals_locked_on_bengals",
        "collectionId": 1159723162,
        "name": "Locked On Bengals",
        "fullTitle": "Locked On Bengals - Daily Podcast On The Cincinnati Bengals",
        "hosts": "Locked On Podcast Network, James Rapien, Jake Liscow",
        "network": "Locked On Podcast Network, James Rapien, Jake Liscow",
        "feedUrl": "https://rss.pdrl.fm/8b4258/feeds.simplecast.com/J1A29rxl",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-bengals-daily-podcast-on-the-cincinnati-bengals/id1159723162?uo=4"
      },
      {
        "id": "bengals_hear_that_podcast_growlin",
        "collectionId": 1477129521,
        "name": "Hear That Podcast Growlin'",
        "fullTitle": "Hear That Podcast Growlin': A show about the Cincinnati Bengals",
        "hosts": "Paul Dehner Jr., Jay Morrison",
        "network": "The Athletic",
        "feedUrl": "https://feeds.acast.com/public/shows/68374e7f9bd0275f2c49845e",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/hear-that-podcast-growlin-a-show-about-the/id1477129521?uo=4"
      },
      {
        "id": "bengals_chatterbox_bengals",
        "collectionId": 1652732141,
        "name": "Chatterbox Bengals",
        "fullTitle": "Chatterbox Bengals: A Cincinnati Bengals NFL Podcast",
        "hosts": "Chatterbox Sports",
        "network": "Chatterbox Sports",
        "feedUrl": "https://feed.podbean.com/boxdlunch/feed.xml",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/chatterbox-bengals-a-cincinnati-bengals-nfl-podcast/id1652732141?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'CLE', slug: 'browns', aliases: ['dawgpound'],
    espnId: 5, espnAbbr: 'cle', otcSlug: 'cleveland-browns', cbsAbbr: 'CLE', pfrAbbr: 'cle',
    city: 'Cleveland', nickname: 'Browns', stadium: 'Huntington Bank Field',
    brandName: 'Browns Dawg Pound',
    timezone: 'America/New_York', clubDomain: 'clevelandbrowns.com',
    themes: buildThemeSpec({
      darkName: 'Lakefront Night', lightName: 'Kardiac Classic',
      darkPrimary: '#E8561A', darkPrimaryBright: '#FF804D',
      darkSecondary: '#C49A7A', darkSecondaryBright: '#E3BEA2',
      lightBg: '#F8F6F4', lightCardAlt: '#EFEAE5',
      lightPrimary: '#4A2B11', lightPrimaryBright: '#633B1A',
      lightSecondary: '#B53809', lightSecondaryBright: '#942C05',
      crestPrimary: '#311D00', crestSecondary: '#FF3C00'
    }),
    coachesSeed: { hc: "Todd Monken", oc: "Travis Switzer", dc: "Mike Rutenberg", gm: "Andrew Berry" },
    beatPodcastShows: [
      {
        "id": "browns_locked_on_browns",
        "collectionId": 1149989450,
        "name": "Locked On Browns",
        "fullTitle": "Locked On Browns - Daily Podcast On The Cleveland Browns",
        "hosts": "Locked On Podcast Network, Spencer German",
        "network": "Locked On Podcast Network, Spencer German",
        "feedUrl": "https://rss.pdrl.fm/bc2558/feeds.simplecast.com/KHgFdYZS",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-browns-daily-podcast-on-the-cleveland-browns/id1149989450?uo=4"
      },
      {
        "id": "browns_orange_and_brown_report",
        "collectionId": 1624920373,
        "name": "Orange and Brown Report",
        "fullTitle": "Orange and Brown Report: A Cleveland Browns Podcast",
        "hosts": "247Sports, Cleveland Browns, Cleveland, Football",
        "network": "247Sports, Cleveland Browns, Cleveland, Football",
        "feedUrl": "https://rss.amperwave.net/v2/feed/audacynetwork/clevelandbrowns",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/orange-and-brown-report-a-cleveland-browns-podcast/id1624920373?uo=4"
      },
      {
        "id": "browns_orange_and_brown_talk",
        "collectionId": 1334701895,
        "name": "Orange and Brown Talk",
        "fullTitle": "Orange and Brown Talk: Cleveland Browns Podcast",
        "hosts": "Cleveland.com - Advance Local",
        "network": "Cleveland.com - Advance Local",
        "feedUrl": "https://feeds.megaphone.fm/orangebrowntalk",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/orange-and-brown-talk-cleveland-browns-podcast/id1334701895?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'PIT', slug: 'steelers', aliases: ['stillers'],
    espnId: 23, espnAbbr: 'pit', otcSlug: 'pittsburgh-steelers', cbsAbbr: 'PIT', pfrAbbr: 'pit',
    city: 'Pittsburgh', nickname: 'Steelers', stadium: 'Acrisure Stadium',
    brandName: 'Steeler Nation',
    timezone: 'America/New_York', clubDomain: 'steelers.com',
    themes: buildThemeSpec({
      darkName: 'Three Rivers Night', lightName: 'Steel City Gold',
      darkPrimary: '#F2B816', darkPrimaryBright: '#FFD34D',
      darkSecondary: '#B3BAC2', darkSecondaryBright: '#DCE2E8',
      lightBg: '#F7F6F2', lightCardAlt: '#EFECE3',
      lightPrimary: '#1A1A1A', lightPrimaryBright: '#333333',
      lightSecondary: '#8A6300', lightSecondaryBright: '#6B4B00',
      crestPrimary: '#101820', crestSecondary: '#FFB612'
    }),
    coachesSeed: { hc: "Mike McCarthy", oc: "Brian Angelichio", dc: "Patrick Graham", gm: "Omar Khan" },
    beatPodcastShows: [
      {
        "id": "steelers_locked_on_steelers",
        "collectionId": 1140522532,
        "name": "Locked On Steelers",
        "fullTitle": "Locked On Steelers – Daily Podcast On The Pittsburgh Steelers",
        "hosts": "Locked On Podcast Network, Christopher Carter",
        "network": "Locked On Podcast Network, Christopher Carter",
        "feedUrl": "https://rss.pdrl.fm/cd1f3b/feeds.simplecast.com/y_l5uReM",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-steelers-daily-podcast-on-the-pittsburgh/id1140522532?uo=4"
      },
      {
        "id": "steelers_steel_curtain_network",
        "collectionId": 905962218,
        "name": "Steel Curtain Network",
        "fullTitle": "Steel Curtain Network: A Pittsburgh Steelers podcast",
        "hosts": "FFSN",
        "network": "FFSN",
        "feedUrl": "https://feeds.simplecast.com/uX7rw_2p",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/steel-curtain-network-a-pittsburgh-steelers-podcast/id905962218?uo=4"
      },
      {
        "id": "steelers_black_gold_blueprint",
        "collectionId": 1732507215,
        "name": "Black & Gold Blueprint",
        "fullTitle": "Black & Gold Blueprint: A Pittsburgh Steelers Podcast",
        "hosts": "Roy Countryman",
        "network": "Roy Countryman",
        "feedUrl": "https://feeds.megaphone.fm/RRTET9925285595",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/black-gold-blueprint-a-pittsburgh-steelers-podcast/id1732507215?uo=4"
      },
      {
        "id": "steelers_dk_pittsburgh_sports",
        "collectionId": 1072021022,
        "name": "DK Pittsburgh Sports",
        "fullTitle": "DK Pittsburgh Sports: Daily podcasts on Steelers, Penguins, Pirates!",
        "hosts": "Dejan Kovacevic",
        "network": "Dejan Kovacevic",
        "feedUrl": "https://feeds.simplecast.com/OkvCKc09",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/dk-pittsburgh-sports-daily-podcasts-on-steelers-penguins/id1072021022?uo=4"
      }
    ]
  }),

  // ============================ AFC SOUTH ============================
  makeTeamEntry({
    abbr: 'HOU', slug: 'texans', aliases: ['htown'],
    espnId: 34, espnAbbr: 'hou', otcSlug: 'houston-texans', cbsAbbr: 'HOU', pfrAbbr: 'htx',
    city: 'Houston', nickname: 'Texans', stadium: 'NRG Stadium',
    brandName: 'H-Town Texans',
    timezone: 'America/Chicago', clubDomain: 'houstontexans.com',
    themes: buildThemeSpec({
      darkName: 'Deep Steel Night', lightName: 'Battle Red',
      darkPrimary: '#D93B4E', darkPrimaryBright: '#FF6B7D',
      darkSecondary: '#7BA4DB', darkSecondaryBright: '#A8C7F0',
      lightBg: '#F5F7FA', lightCardAlt: '#EAEFF5',
      lightPrimary: '#03202F', lightPrimaryBright: '#0B3952',
      lightSecondary: '#A71930', lightSecondaryBright: '#871024',
      crestPrimary: '#03202F', crestSecondary: '#A71930'
    }),
    coachesSeed: { hc: "DeMeco Ryans", oc: "Nick Caley", dc: "Matt Burke", gm: "Nick Caserio" },
    beatPodcastShows: [
      {
        "id": "texans_locked_on_texans",
        "collectionId": 1156158142,
        "name": "Locked On Texans",
        "fullTitle": "Locked On Texans - Daily Podcast On The Houston Texans",
        "hosts": "Coty Davis, Locked On Podcast Network, John Hickman",
        "network": "Coty Davis, Locked On Podcast Network, John Hickman",
        "feedUrl": "https://rss.pdrl.fm/de6246/feeds.simplecast.com/eO87ZWbO",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-texans-daily-podcast-on-the-houston-texans/id1156158142?uo=4"
      },
      {
        "id": "texans_texans_on_tap",
        "collectionId": 1706775831,
        "name": "Texans on Tap",
        "fullTitle": "Texans on Tap: A Houston Texans Podcast",
        "hosts": "Space City Pods, Bleav",
        "network": "Space City Pods, Bleav",
        "feedUrl": "https://feeds.simplecast.com/DTDqu9OA",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/texans-on-tap-a-houston-texans-podcast/id1706775831?uo=4"
      },
      {
        "id": "texans_texans_today",
        "collectionId": 6815401698,
        "name": "Texans Today",
        "fullTitle": "Texans Today | Daily Houston Texans Podcast",
        "hosts": "Fan Arch",
        "network": "Fan Arch",
        "feedUrl": "https://feeds.megaphone.fm/BVLLC6295052856",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/texans-today-daily-houston-texans-podcast/id6815401698?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'IND', slug: 'colts', aliases: ['indy'],
    espnId: 11, espnAbbr: 'ind', otcSlug: 'indianapolis-colts', cbsAbbr: 'IND', pfrAbbr: 'clt',
    city: 'Indianapolis', nickname: 'Colts', stadium: 'Lucas Oil Stadium',
    brandName: 'Colts Nation',
    timezone: 'America/Indiana/Indianapolis', clubDomain: 'colts.com',
    themes: buildThemeSpec({
      darkName: 'Indiana Nights', lightName: 'Speed Blue Classic',
      darkPrimary: '#246BCE', darkPrimaryBright: '#63A0FA',
      darkSecondary: '#A5ACAF', darkSecondaryBright: '#D4DADD',
      lightBg: '#F5F7FA', lightCardAlt: '#E8EEF6',
      lightPrimary: '#002C5F', lightPrimaryBright: '#00428C',
      lightSecondary: '#4E5861', lightSecondaryBright: '#384047',
      crestPrimary: '#002C5F', crestSecondary: '#A2AAAD'
    }),
    coachesSeed: { hc: "Shane Steichen", oc: "Jim Bob Cooter", dc: "Lou Anarumo", gm: "Ed Dodds" },
    beatPodcastShows: [
      {
        "id": "colts_locked_on_colts",
        "collectionId": 1151621306,
        "name": "Locked On Colts",
        "fullTitle": "Locked On Colts - Daily Podcast On The Indianapolis Colts",
        "hosts": "Locked On Podcast Network, Jake Arthur, Zach Hicks",
        "network": "Locked On Podcast Network, Jake Arthur, Zach Hicks",
        "feedUrl": "https://rss.pdrl.fm/9766e6/feeds.simplecast.com/PpDN4Fbf",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-colts-daily-podcast-on-the-indianapolis-colts/id1151621306?uo=4"
      },
      {
        "id": "colts_colts_corner_with_kevin_bowen",
        "collectionId": 1294483334,
        "name": "Colts Corner With Kevin Bowen",
        "fullTitle": "Colts Corner With Kevin Bowen",
        "hosts": "Kevin Bowen",
        "network": "Kevin Bowen",
        "feedUrl": "https://www.omnycontent.com/d/playlist/78a347aa-3282-4ac5-837c-a72300032082/e8b83751-d6f4-4639-9a5e-af2c0122e642/8dff4d90-7f00-4069-9cce-af2c0122e654/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/colts-corner-with-kevin-bowen/id1294483334?uo=4"
      },
      {
        "id": "colts_the_blue_horseshoe",
        "collectionId": 1674217156,
        "name": "The Blue Horseshoe",
        "fullTitle": "The Blue Horseshoe",
        "hosts": "Ryan",
        "network": "Ryan",
        "feedUrl": "https://anchor.fm/s/e72e530/podcast/rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/the-blue-horseshoe/id1674217156?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'JAX', slug: 'jaguars', aliases: ['jags', 'jac', 'duval'],
    espnId: 30, espnAbbr: 'jax', otcSlug: 'jacksonville-jaguars', cbsAbbr: 'JAC', pfrAbbr: 'jax',
    city: 'Jacksonville', nickname: 'Jaguars', stadium: 'EverBank Stadium',
    brandName: 'Jags DUUUVAL',
    timezone: 'America/New_York', clubDomain: 'jaguars.com',
    themes: buildThemeSpec({
      darkName: 'Duval Night', lightName: 'Prowler Teal',
      darkPrimary: '#00879A', darkPrimaryBright: '#38C8DB',
      darkSecondary: '#D7A22A', darkSecondaryBright: '#F2C65C',
      lightBg: '#F3F8F9', lightCardAlt: '#E6F1F2',
      lightPrimary: '#006778', lightPrimaryBright: '#007E91',
      lightSecondary: '#7D5C10', lightSecondaryBright: '#614608',
      crestPrimary: '#006778', crestSecondary: '#D7A22A'
    }),
    coachesSeed: { hc: "Liam Coen", oc: "Grant Udinski", dc: "Anthony Campanile", gm: "James Gladstone" },
    beatPodcastShows: [
      {
        "id": "jaguars_locked_on_jaguars",
        "collectionId": 1149175431,
        "name": "Locked On Jaguars",
        "fullTitle": "Locked On Jaguars - Daily Podcast On The Jacksonville Jaguars",
        "hosts": "Locked On Podcast Network, Tony Wiggins",
        "network": "Locked On Podcast Network, Tony Wiggins",
        "feedUrl": "https://rss.pdrl.fm/5b6f8d/feeds.simplecast.com/BgZ7Brxt",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-jaguars-daily-podcast-on-the-jacksonville/id1149175431?uo=4"
      },
      {
        "id": "jaguars_1010_xl_jax_sports_radio",
        "collectionId": 1011442917,
        "name": "1010 XL Jax Sports Radio",
        "fullTitle": "1010 XL Jax Sports Radio",
        "hosts": "1010 XL Jax Sports Radio",
        "network": "1010 XL Jax Sports Radio",
        "feedUrl": "https://feeds.soundcloud.com/users/soundcloud:users:19945124/sounds.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/1010-xl-jax-sports-radio/id1011442917?uo=4"
      },
      {
        "id": "jaguars_jaguars_happy_hour",
        "collectionId": 1479457037,
        "name": "Jaguars Happy Hour",
        "fullTitle": "Jaguars Happy Hour",
        "hosts": "Jacksonville Jaguars",
        "network": "Jacksonville Jaguars",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/e1e6fda3-4a7e-4b46-b749-aeac0018242b/84bc3eef-d7dc-4ed0-b953-aeac0018243e/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/jaguars-happy-hour/id1479457037?uo=4"
      },
      {
        "id": "jaguars_duval_daily",
        "collectionId": 1164993693,
        "name": "Duval Daily",
        "fullTitle": "Duval Daily: A Jacksonville Jaguars Podcast",
        "hosts": "GenJag",
        "network": "GenJag",
        "feedUrl": "https://feeds.redcircle.com/ccb9d288-f663-4159-a278-c8fdda18fab5",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/duval-daily-a-jacksonville-jaguars-podcast/id1164993693?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'TEN', slug: 'titans', aliases: ['titanup'],
    espnId: 10, espnAbbr: 'ten', otcSlug: 'tennessee-titans', cbsAbbr: 'TEN', pfrAbbr: 'oti',
    city: 'Tennessee', nickname: 'Titans', stadium: 'Nissan Stadium',
    brandName: 'Titan Up',
    timezone: 'America/Chicago', clubDomain: 'tennesseetitans.com',
    themes: buildThemeSpec({
      darkName: 'Nashville Night', lightName: 'Oilers Blue',
      darkPrimary: '#4B92DB', darkPrimaryBright: '#78B7F5',
      darkSecondary: '#E34B5D', darkSecondaryBright: '#FF7D8C',
      lightBg: '#F4F7FB', lightCardAlt: '#E7EEF7',
      lightPrimary: '#0C2340', lightPrimaryBright: '#183C6B',
      lightSecondary: '#A81728', lightSecondaryBright: '#8A101E',
      crestPrimary: '#0C2340', crestSecondary: '#4B92DB'
    }),
    coachesSeed: { hc: "Robert Saleh", oc: "Brian Daboll", dc: "Gus Bradley", gm: "Mike Borgonzi" },
    beatPodcastShows: [
      {
        "id": "titans_locked_on_titans",
        "collectionId": 1151215065,
        "name": "Locked On Titans",
        "fullTitle": "Locked On Titans - Daily Podcast On The Tennessee Titans",
        "hosts": "Locked On Podcast Network, Tyler Rowland",
        "network": "Locked On Podcast Network, Tyler Rowland",
        "feedUrl": "https://rss.pdrl.fm/54f99a/feeds.simplecast.com/ZHgqzawD",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-titans-daily-podcast-on-the-tennessee-titans/id1151215065?uo=4"
      },
      {
        "id": "titans_titans_podcast_network",
        "collectionId": 1245825506,
        "name": "Titans Podcast Network",
        "fullTitle": "Titans Podcast Network | Official Podcasts of the Tennessee Titans",
        "hosts": "Tennessee Titans",
        "network": "Tennessee Titans",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/31142dcb-0076-4343-b172-aeac0126b451/a3093306-f091-44f3-ab3a-aeac0126b469/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/titans-podcast-network-official-podcasts-of/id1245825506?uo=4"
      },
      {
        "id": "titans_no_nonsense",
        "collectionId": 1474123006,
        "name": "No Nonsense",
        "fullTitle": "No Nonsense: A Tennessee Titans Podcast",
        "hosts": "No Nonsense Podcast",
        "network": "No Nonsense Podcast",
        "feedUrl": "https://feeds.redcircle.com/4b5c7458-4737-487f-913c-9c7c781ee887",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/no-nonsense-a-tennessee-titans-podcast/id1474123006?uo=4"
      }
    ]
  }),

  // ============================ AFC WEST ============================
  makeTeamEntry({
    abbr: 'KC', slug: 'chiefs', aliases: ['kan'],
    espnId: 12, espnAbbr: 'kc', otcSlug: 'kansas-city-chiefs', cbsAbbr: 'KC', pfrAbbr: 'kan',
    city: 'Kansas City', nickname: 'Chiefs', stadium: 'GEHA Field at Arrowhead Stadium',
    brandName: 'Chiefs Kingdom',
    timezone: 'America/Chicago', clubDomain: 'chiefs.com',
    themes: buildThemeSpec({
      darkName: 'Arrowhead Night', lightName: 'Red & Gold Classic',
      darkPrimary: '#E31837', darkPrimaryBright: '#FF546E',
      darkSecondary: '#FFB81C', darkSecondaryBright: '#FFD466',
      lightBg: '#F9F6F4', lightCardAlt: '#F2EAE6',
      lightPrimary: '#B8102A', lightPrimaryBright: '#D41533',
      lightSecondary: '#8A6200', lightSecondaryBright: '#6B4A00',
      crestPrimary: '#E31837', crestSecondary: '#FFB81C'
    }),
    coachesSeed: { hc: "Andy Reid", oc: "Eric Bieniemy", dc: "Steve Spagnuolo", gm: "Brett Veach" },
    beatPodcastShows: [
      {
        "id": "chiefs_locked_on_chiefs",
        "collectionId": 1141081555,
        "name": "Locked On Chiefs",
        "fullTitle": "Locked On Chiefs - Daily Podcast On The Kansas City Chiefs",
        "hosts": "Chris Clark, Locked On Podcast Network, Ryan Tracy",
        "network": "Chris Clark, Locked On Podcast Network, Ryan Tracy",
        "feedUrl": "https://rss.pdrl.fm/194e78/feeds.simplecast.com/9czLVzrJ",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-chiefs-daily-podcast-on-the-kansas-city-chiefs/id1141081555?uo=4"
      },
      {
        "id": "chiefs_kc_sports_network",
        "collectionId": 1530866619,
        "name": "KC Sports Network",
        "fullTitle": "KC Sports Network: Kansas City Chiefs Podcasts",
        "hosts": "KC Sports Network",
        "network": "KC Sports Network",
        "feedUrl": "https://rss.pdrl.fm/8d7cde/feeds.simplecast.com/BJf5DYgc",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/kc-sports-network-kansas-city-chiefs-podcasts/id1530866619?uo=4"
      },
      {
        "id": "chiefs_arrowhead_addict",
        "collectionId": 1454555052,
        "name": "Arrowhead Addict",
        "fullTitle": "Arrowhead Addict: A Kansas City Chiefs Podcast",
        "hosts": "FanSided Podcasts",
        "network": "FanSided Podcasts",
        "feedUrl": "https://feeds.redcircle.com/1e82f8a1-8697-44b8-9f41-a45fada500f4",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/arrowhead-addict-a-kansas-city-chiefs-podcast/id1454555052?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'DEN', slug: 'broncos', aliases: ['milehigh'],
    espnId: 7, espnAbbr: 'den', otcSlug: 'denver-broncos', cbsAbbr: 'DEN', pfrAbbr: 'den',
    city: 'Denver', nickname: 'Broncos', stadium: 'Empower Field at Mile High',
    brandName: 'Broncos Country',
    timezone: 'America/Denver', clubDomain: 'denverbroncos.com',
    themes: buildThemeSpec({
      darkName: 'Mile High Night', lightName: 'Orange Crush',
      darkPrimary: '#EB5621', darkPrimaryBright: '#FF7D4D',
      darkSecondary: '#7EA5D9', darkSecondaryBright: '#ADC9F0',
      lightBg: '#F5F7FA', lightCardAlt: '#EAEFF5',
      lightPrimary: '#002244', lightPrimaryBright: '#0D3866',
      lightSecondary: '#B8390C', lightSecondaryBright: '#962C07',
      crestPrimary: '#FB4F14', crestSecondary: '#002244'
    }),
    coachesSeed: { hc: "Sean Payton", oc: "Davis Webb", dc: "Vance Joseph", gm: "George Paton" },
    beatPodcastShows: [
      {
        "id": "broncos_locked_on_broncos",
        "collectionId": 1146588641,
        "name": "Locked On Broncos",
        "fullTitle": "Locked On Broncos - Daily Podcast On The Denver Broncos",
        "hosts": "Locked On Podcast Network, Cody Roark, Sayre Bedinger",
        "network": "Locked On Podcast Network, Cody Roark, Sayre Bedinger",
        "feedUrl": "https://rss.pdrl.fm/ed7d56/feeds.simplecast.com/f6CBcmwn",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-broncos-daily-podcast-on-the-denver-broncos/id1146588641?uo=4"
      },
      {
        "id": "broncos_dnvr_denver_broncos_podcast",
        "collectionId": 1067992218,
        "name": "DNVR Denver Broncos Podcast",
        "fullTitle": "DNVR Denver Broncos Podcast",
        "hosts": "ALLCITY Network, DNVR Sports",
        "network": "ALLCITY Network, DNVR Sports",
        "feedUrl": "https://feeds.simplecast.com/w3d46li7",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/dnvr-denver-broncos-podcast/id1067992218?uo=4"
      },
      {
        "id": "broncos_broncos_country_tonight",
        "collectionId": 1477515380,
        "name": "Broncos Country Tonight",
        "fullTitle": "Broncos Country Tonight",
        "hosts": "Ryan Edwards, Benjamin Allbright",
        "network": "KOA 850 AM & 94.1 FM",
        "feedUrl": "https://www.omnycontent.com/d/playlist/98a2599f-cd9b-4f2a-9be4-b22c00e585f2/c3ec75a8-e2e0-4425-97f2-b3ec01744218/750c02de-9fcf-4ebc-bd80-b3ec0174421f/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/broncos-country-tonight/id1477515380?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'LAC', slug: 'chargers', aliases: ['bolts'],
    espnId: 24, espnAbbr: 'lac', otcSlug: 'los-angeles-chargers', cbsAbbr: 'LAC', pfrAbbr: 'sdg',
    city: 'Los Angeles', nickname: 'Chargers', stadium: 'SoFi Stadium',
    brandName: 'Chargers Bolt Up',
    timezone: 'America/Los_Angeles', clubDomain: 'chargers.com', excludeGenericCity: true,
    themes: buildThemeSpec({
      darkName: 'SoFi Bolt Night', lightName: 'Powder Blue Classic',
      darkPrimary: '#0088D1', darkPrimaryBright: '#47B8F5',
      darkSecondary: '#FFC20E', darkSecondaryBright: '#FFDA5C',
      lightBg: '#F3F8FC', lightCardAlt: '#E6F0F8',
      lightPrimary: '#005F94', lightPrimaryBright: '#0074B5',
      lightSecondary: '#8A6300', lightSecondaryBright: '#6B4B00',
      crestPrimary: '#0080C6', crestSecondary: '#FFC20E'
    }),
    coachesSeed: { hc: "Jim Harbaugh", oc: "Mike McDaniel", dc: "Chris O'Leary", gm: "Joe Hortiz" },
    beatPodcastShows: [
      {
        "id": "chargers_locked_on_chargers",
        "collectionId": 1151558476,
        "name": "Locked On Chargers",
        "fullTitle": "Locked On Chargers - Daily Podcast On The Los Angeles Chargers",
        "hosts": "Locked On Podcast Network, David Droegemeier, Daniel Wade",
        "network": "Locked On Podcast Network, David Droegemeier, Daniel Wade",
        "feedUrl": "https://rss.pdrl.fm/d1cedf/feeds.simplecast.com/A8M6ytRb",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-chargers-daily-podcast-on-the-los-angeles/id1151558476?uo=4"
      },
      {
        "id": "chargers_guilty_as_charged",
        "collectionId": 1497748763,
        "name": "Guilty As Charged",
        "fullTitle": "Guilty As Charged: An LA Chargers Podcast",
        "hosts": "Blue Wire",
        "network": "Blue Wire",
        "feedUrl": "https://feeds.simplecast.com/5NvjSmVV",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/guilty-as-charged-an-la-chargers-podcast/id1497748763?uo=4"
      },
      {
        "id": "chargers_chargers_podcast_network",
        "collectionId": 1268765985,
        "name": "Chargers Podcast Network",
        "fullTitle": "Chargers Podcast Network",
        "hosts": "Los Angeles Chargers",
        "network": "Los Angeles Chargers",
        "feedUrl": "https://www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/01891723-b9f7-459c-a03c-aeac01364986/46e9a45b-cb89-4c6d-a54a-aeac01364994/podcast.rss",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/chargers-podcast-network/id1268765985?uo=4"
      },
      {
        "id": "chargers_the_lightning_round",
        "collectionId": 999565022,
        "name": "The Lightning Round",
        "fullTitle": "The Lightning Round: A Los Angeles Chargers Podcast",
        "hosts": "FFSN",
        "network": "FFSN",
        "feedUrl": "https://feeds.megaphone.fm/bolts-from-the-blue-chargers",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/the-lightning-round-a-los-angeles-chargers-podcast/id999565022?uo=4"
      }
    ]
  }),
  makeTeamEntry({
    abbr: 'LV', slug: 'raiders', aliases: ['lvr', 'oak', 'silverandblack'],
    espnId: 13, espnAbbr: 'lv', otcSlug: 'las-vegas-raiders', cbsAbbr: 'LV', pfrAbbr: 'rai',
    city: 'Las Vegas', nickname: 'Raiders', stadium: 'Allegiant Stadium',
    brandName: 'Raider Nation',
    timezone: 'America/Los_Angeles', clubDomain: 'raiders.com',
    themes: buildThemeSpec({
      darkName: 'Death Star Black', lightName: 'Silver & Black',
      darkPrimary: '#A5ACAF', darkPrimaryBright: '#D4DADD',
      darkSecondary: '#8C969E', darkSecondaryBright: '#BCC6CE',
      lightBg: '#F5F6F7', lightCardAlt: '#EAECEF',
      lightPrimary: '#14171A', lightPrimaryBright: '#2E343B',
      lightSecondary: '#4E575E', lightSecondaryBright: '#383F45',
      crestPrimary: '#101820', crestSecondary: '#A5ACAF'
    }),
    coachesSeed: { hc: "Klint Kubiak", oc: "Andrew Janocko", dc: "Rob Leonard", gm: "John Spytek" },
    beatPodcastShows: [
      {
        "id": "raiders_locked_on_raiders",
        "collectionId": 1139751780,
        "name": "Locked On Raiders",
        "fullTitle": "Locked On Raiders - Daily Podcast On The Las Vegas Raiders",
        "hosts": "Locked On Podcast Network, Your Boy Q",
        "network": "Locked On Podcast Network, Your Boy Q",
        "feedUrl": "https://rss.pdrl.fm/427f18/feeds.simplecast.com/FW_wEF1P",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/locked-on-raiders-daily-podcast-on-the-las-vegas-raiders/id1139751780?uo=4"
      },
      {
        "id": "raiders_las_vegas_raiders_insider",
        "collectionId": 1683302878,
        "name": "Las Vegas Raiders Insider",
        "fullTitle": "Las Vegas Raiders Insider: A Raiders podcast network",
        "hosts": "Pro Football Insiders, Bleav Network",
        "network": "Pro Football Insiders, Bleav Network",
        "feedUrl": "https://feeds.simplecast.com/gBQiZMcH",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/las-vegas-raiders-insider-a-raiders-podcast-network/id1683302878?uo=4"
      },
      {
        "id": "raiders_the_autumn_windbags",
        "collectionId": 1544222518,
        "name": "The Autumn Windbags",
        "fullTitle": "The Autumn Windbags: The Best Las Vegas Raiders Podcast Ever!",
        "hosts": "The Autumn Windbags",
        "network": "The Autumn Windbags",
        "feedUrl": "https://feeds.simplecast.com/P5UD4tGc",
        "appleShowUrl": "https://podcasts.apple.com/us/podcast/the-autumn-windbags-the-best-las-vegas-raiders-podcast-ever/id1544222518?uo=4"
      }
    ]
  })
];

export const TEAM_REGISTRY = Object.fromEntries(ALL_NFL_TEAMS.map(t => [t.abbr, t]));
export const TEAM_BY_SLUG = Object.fromEntries(ALL_NFL_TEAMS.map(t => [t.slug, t]));

const ALIAS_TO_TEAM = new Map();
for (const team of ALL_NFL_TEAMS) {
  ALIAS_TO_TEAM.set(team.abbr.toLowerCase(), team);
  ALIAS_TO_TEAM.set(team.slug.toLowerCase(), team);
  ALIAS_TO_TEAM.set(team.espnAbbr.toLowerCase(), team);
  ALIAS_TO_TEAM.set(team.cbsAbbr.toLowerCase(), team);
  ALIAS_TO_TEAM.set(team.pfrAbbr.toLowerCase(), team);
  ALIAS_TO_TEAM.set(team.nickname.toLowerCase(), team);
  for (const a of team.aliases || []) {
    ALIAS_TO_TEAM.set(String(a).toLowerCase(), team);
  }
}

export function normalizeAnyTeamAbbr(raw = '') {
  const clean = String(raw || '').trim().toLowerCase();
  if (!clean) return 'SF';
  const hit = ALIAS_TO_TEAM.get(clean);
  return hit ? hit.abbr : clean.toUpperCase();
}

export function getTeamByAbbr(abbr = 'SF') {
  const key = normalizeAnyTeamAbbr(abbr);
  return TEAM_REGISTRY[key] || TEAM_REGISTRY.SF;
}

export function getTeamBySlug(slug = '49ers') {
  const clean = String(slug || '').trim().toLowerCase();
  return TEAM_BY_SLUG[clean] || ALIAS_TO_TEAM.get(clean) || TEAM_REGISTRY.SF;
}

export function getTeamByEspnId(espnId) {
  const id = Number(espnId);
  return ALL_NFL_TEAMS.find(t => t.espnId === id) || null;
}

export function resolveTeamConfig(input = null) {
  if (!input) return getActiveTeamConfig();
  if (typeof input === 'object' && input.abbr && TEAM_REGISTRY[input.abbr]) {
    return TEAM_REGISTRY[input.abbr];
  }
  const clean = String(input || '').trim().toLowerCase();
  return ALIAS_TO_TEAM.get(clean) || TEAM_REGISTRY.SF;
}

export function resolveExplicitQueryTeam(search = '') {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const queryTeam = params.get('team');
  if (!queryTeam) return null;
  return ALIAS_TO_TEAM.get(queryTeam.trim().toLowerCase()) || null;
}

export function isNflHubHost(hostname = '') {
  const host = String(hostname || '').trim().toLowerCase().split(':')[0];
  return (
    host === 'nfl.joshal.com' ||
    host === 'nfl-joshal.pages.dev' ||
    host.endsWith('.nfl-joshal.pages.dev')
  );
}

export function isNflHubMode(locationLike = typeof window !== 'undefined' ? window.location : null) {
  if (typeof globalThis !== 'undefined' && globalThis.__NFL_HUB_MODE__ === true) {
    return true;
  }
  const host = String(locationLike?.hostname || '').trim().toLowerCase();
  return isNflHubHost(host);
}

export function resolveTeamFromHostname(hostname = '', search = '') {
  const qHit = resolveExplicitQueryTeam(search);
  if (qHit) return qHit;

  const host = String(hostname || '').trim().toLowerCase();
  const match = host.match(/^([a-z0-9-]+)\.joshal\.com$/);
  if (match) {
    const sub = match[1];
    const hit = ALIAS_TO_TEAM.get(sub);
    if (hit) return hit;
  }
  return TEAM_REGISTRY.SF;
}

let activeTeamSingleton = TEAM_REGISTRY.SF;

export function setActiveTeamConfig(input) {
  activeTeamSingleton = resolveTeamConfig(input);
  return activeTeamSingleton;
}

export function getActiveTeamConfig() {
  if (typeof globalThis !== 'undefined' && globalThis.__ACTIVE_TEAM_SLUG__) {
    const resolved = getTeamBySlug(globalThis.__ACTIVE_TEAM_SLUG__);
    if (resolved) return resolved;
  }
  if (typeof window !== 'undefined' && window.location) {
    const fromLoc = resolveTeamFromHostname(window.location.hostname, window.location.search);
    if (fromLoc && (window.location.hostname.endsWith('.joshal.com') || new URLSearchParams(window.location.search).has('team'))) {
      activeTeamSingleton = fromLoc;
      return fromLoc;
    }
  }
  return activeTeamSingleton;
}

/**
 * Resolves the data base URL for a given team config.
 * - `SF` on `49ers.joshal.com` or default localhost keeps `./data` verbatim (zero regression).
 * - Other teams (`lions`, `bills`, etc.) load from `./data/teams/{slug}` (served from R2 via Worker or local disk).
 */
export function resolveTeamDataBasePath(teamInput = null) {
  const team = resolveTeamConfig(teamInput);
  if (team.abbr === 'SF') return './data';
  return `./data/teams/${team.slug}`;
}

export function buildTeamCssVarsStyleBlock(teamInput = null) {
  const team = resolveTeamConfig(teamInput);
  const d = team.themes.dark;
  const l = team.themes.light;
  const dPrimRgb = hexToRgbTriplet(d.primary);
  const dPrimBrightRgb = hexToRgbTriplet(d.primaryBright);
  const dSecRgb = hexToRgbTriplet(d.secondary);
  const dSecBrightRgb = hexToRgbTriplet(d.secondaryBright);
  const dOnPrimary = computeOnPrimaryInk(d.primary, d.primaryBright);
  const lPrimRgb = hexToRgbTriplet(l.primary);
  const lPrimBrightRgb = hexToRgbTriplet(l.primaryBright);
  const lSecRgb = hexToRgbTriplet(l.secondary);
  const lSecBrightRgb = hexToRgbTriplet(l.secondaryBright);
  const lOnPrimary = computeOnPrimaryInk(l.primary, l.primaryBright);
  return `:root{--bg-primary:${d.bgPrimary};--bg-elevated:${d.bgElevated};--bg-card-alt:${d.bgCardAlt};--bg-input:${d.bgInput};--bg-header:${d.bgHeader};--bg-glass:${d.bgGlass};--scarlet:${d.primary};--scarlet-bright:${d.primaryBright};--scarlet-soft:${d.primarySoft};--gold:${d.secondary};--gold-bright:${d.secondaryBright};--gold-soft:${d.secondarySoft};--gold-border:${d.secondaryBorder};--bg-glow-primary:${d.glowPrimary};--bg-glow-secondary:${d.glowSecondary};--primary-rgb:${dPrimRgb};--primary-bright-rgb:${dPrimBrightRgb};--secondary-rgb:${dSecRgb};--secondary-bright-rgb:${dSecBrightRgb};--on-primary:${dOnPrimary};--dossier-hero-glow-primary:rgba(${dPrimRgb},0.18);--dossier-hero-glow-secondary:rgba(${dSecRgb},0.12);}[data-theme="light"]{--bg-primary:${l.bgPrimary};--bg-elevated:${l.bgElevated};--bg-card-alt:${l.bgCardAlt};--bg-input:${l.bgInput};--bg-header:${l.bgHeader};--bg-glass:${l.bgGlass};--scarlet:${l.primary};--scarlet-bright:${l.primaryBright};--scarlet-soft:${l.primarySoft};--gold:${l.secondary};--gold-bright:${l.secondaryBright};--gold-soft:${l.secondarySoft};--gold-border:${l.secondaryBorder};--bg-glow-primary:${l.glowPrimary};--bg-glow-secondary:${l.glowSecondary};--primary-rgb:${lPrimRgb};--primary-bright-rgb:${lPrimBrightRgb};--secondary-rgb:${lSecRgb};--secondary-bright-rgb:${lSecBrightRgb};--on-primary:${lOnPrimary};--dossier-hero-glow-primary:rgba(${lPrimRgb},0.12);--dossier-hero-glow-secondary:rgba(${lSecRgb},0.14);}`;
}

export function applyTeamThemeToDocument(teamInput = null) {
  if (typeof document === 'undefined') return;
  const team = resolveTeamConfig(teamInput);
  const root = document.documentElement;
  root.setAttribute('data-team', team.slug);
  root.setAttribute('data-team-abbr', team.abbr);

  let styleEl = document.getElementById('teamThemeOverrides');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'teamThemeOverrides';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = buildTeamCssVarsStyleBlock(team);

  document.title = `${team.brandName} — ${team.domain}`;
  const descEl = document.querySelector('meta[name="description"]');
  if (descEl) {
    descEl.setAttribute(
      'content',
      `High-signal ${team.fullName} facts, All-22 film synthesis, player spider charts, CBA cap simulator, injury play-probability models, Monte Carlo playoff odds, and Autopodcast Studio.`
    );
  }
  const appTitleEl = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appTitleEl) appTitleEl.setAttribute('content', team.shortTitle);
  const appNameEl = document.querySelector('meta[name="application-name"]');
  if (appNameEl) appNameEl.setAttribute('content', team.shortTitle);

  const iconEl = document.querySelector('link[rel="icon"]');
  if (iconEl && team.assets?.appIconSvg) iconEl.setAttribute('href', team.assets.appIconSvg);
  document.querySelectorAll('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').forEach(el => {
    const sizes = el.getAttribute('sizes');
    const href = sizes === '180x180' ? team.assets?.appleTouchIcon180Png || team.assets?.appleTouchIconPng : team.assets?.appleTouchIconPng;
    if (href) el.setAttribute('href', href);
  });

  const crestImg = document.querySelector('.brand-medallion');
  if (crestImg) {
    crestImg.setAttribute('src', team.assets.crestSvg);
    crestImg.setAttribute('alt', team.nickname);
  }
  const trigger = document.getElementById('brandHomeTrigger');
  if (trigger) trigger.setAttribute('aria-label', `${team.brandName} Home`);
  const titleText = document.getElementById('headerTitleText');
  if (titleText && (titleText.textContent === '49ers Faithful' || !titleText.dataset.customTabTitle)) {
    titleText.textContent = team.brandName;
  }
  const sheetEyebrow = document.getElementById('sheetEyebrow');
  if (sheetEyebrow && /49ers Dossier|Player Dossier/i.test(sheetEyebrow.textContent || '')) {
    sheetEyebrow.textContent = `${team.nickname} Dossier`;
  }
  const splashTitle = document.querySelector('main#mainView .card-title');
  if (splashTitle && /Initializing 49ers Faithful Intelligence/i.test(splashTitle.textContent || '')) {
    splashTitle.textContent = `Initializing ${team.brandName} Intelligence…`;
  }

  const hubBackBtn = document.getElementById('nflHubBackBtn');
  if (hubBackBtn) {
    const inHubMode = isNflHubMode();
    hubBackBtn.hidden = !inHubMode;
    if (inHubMode) {
      root.setAttribute('data-nfl-hub', 'true');
    } else {
      root.removeAttribute('data-nfl-hub');
    }
  }
}

export function isOfficialTeamHost(hostname = '') {
  const host = String(hostname || '').trim().toLowerCase();
  const m = host.match(/^([a-z0-9-]+)\.joshal\.com$/);
  if (!m) return false;
  return Boolean(TEAM_BY_SLUG[m[1]]);
}

export const NFL_COACHES_SEED = {
  ARI: { hc: "Mike LaFleur", oc: "Nathaniel Hackett", dc: "Nick Rallis", gm: "Monti Ossenfort" },
  ATL: { hc: "Kevin Stefanski", oc: "Tommy Rees", dc: "Jeff Ulbrich", gm: "Ian Cunningham" },
  BAL: { hc: "Jesse Minter", oc: "Declan Doyle", dc: "Anthony Weaver", gm: "Eric DeCosta" },
  BUF: { hc: "Joe Brady", oc: "Pete Carmichael Jr.", dc: "Jim Leonhard", gm: "Brandon Beane" },
  CAR: { hc: "Dave Canales", oc: "Brad Idzik", dc: "Todd Wash", gm: "Dan Morgan" },
  CHI: { hc: "Ben Johnson", oc: "Press Taylor", dc: "Dennis Allen", gm: "Ryan Poles" },
  CIN: { hc: "Zac Taylor", oc: "Dan Pitcher", dc: "Al Golden", gm: "Duke Tobin" },
  CLE: { hc: "Todd Monken", oc: "Travis Switzer", dc: "Mike Rutenberg", gm: "Andrew Berry" },
  DAL: { hc: "Brian Schottenheimer", oc: "Klayton Adams", dc: "Christian Parker", gm: "Jerry Jones" },
  DEN: { hc: "Sean Payton", oc: "Davis Webb", dc: "Vance Joseph", gm: "George Paton" },
  DET: { hc: "Dan Campbell", oc: "Drew Petzing", dc: "Kelvin Sheppard", gm: "Brad Holmes" },
  GB: { hc: "Matt LaFleur", oc: "Adam Stenavich", dc: "Jonathan Gannon", gm: "Brian Gutekunst" },
  HOU: { hc: "DeMeco Ryans", oc: "Nick Caley", dc: "Matt Burke", gm: "Nick Caserio" },
  IND: { hc: "Shane Steichen", oc: "Jim Bob Cooter", dc: "Lou Anarumo", gm: "Ed Dodds" },
  JAX: { hc: "Liam Coen", oc: "Grant Udinski", dc: "Anthony Campanile", gm: "James Gladstone" },
  KC: { hc: "Andy Reid", oc: "Eric Bieniemy", dc: "Steve Spagnuolo", gm: "Brett Veach" },
  LAC: { hc: "Jim Harbaugh", oc: "Mike McDaniel", dc: "Chris O'Leary", gm: "Joe Hortiz" },
  LAR: { hc: "Sean McVay", oc: "Nathan Scheelhaase", dc: "Chris Shula", gm: "Les Snead" },
  LV: { hc: "Klint Kubiak", oc: "Andrew Janocko", dc: "Rob Leonard", gm: "John Spytek" },
  MIA: { hc: "Jeff Hafley", oc: "Bobby Slowik", dc: "Sean Duggan", gm: "Jon-Eric Sullivan" },
  MIN: { hc: "Kevin O'Connell", oc: "Wes Phillips", dc: "Brian Flores", gm: "Nolan Teasley" },
  NE: { hc: "Mike Vrabel", oc: "Josh McDaniels", dc: "Zak Kuhr", gm: "Eliot Wolf" },
  NO: { hc: "Kellen Moore", oc: "Doug Nussmeier", dc: "Brandon Staley", gm: "Mickey Loomis" },
  NYG: { hc: "John Harbaugh", oc: "Matt Nagy", dc: "Dennard Wilson", gm: "Joe Schoen" },
  NYJ: { hc: "Aaron Glenn", oc: "Frank Reich", dc: "Brian Duker", gm: "Darren Mougey" },
  PHI: { hc: "Nick Sirianni", oc: "Sean Mannion", dc: "Vic Fangio", gm: "Howie Roseman" },
  PIT: { hc: "Mike McCarthy", oc: "Brian Angelichio", dc: "Patrick Graham", gm: "Omar Khan" },
  SEA: { hc: "Mike Macdonald", oc: "Brian Fleury", dc: "Aden Durde", gm: "John Schneider" },
  SF: { hc: "Kyle Shanahan", oc: "Klay Kubiak", dc: "Raheem Morris", gm: "John Lynch" },
  TB: { hc: "Todd Bowles", oc: "Zac Robinson", dc: "Todd Bowles", gm: "Jason Licht" },
  TEN: { hc: "Robert Saleh", oc: "Brian Daboll", dc: "Gus Bradley", gm: "Mike Borgonzi" },
  WAS: { hc: "Dan Quinn", oc: "David Blough", dc: "Daronte Jones", gm: "Adam Peters" }
};

export function getTeamCoaches(teamOrAbbr = null, metaCoaches = null) {
  const team = resolveTeamConfig(teamOrAbbr);
  const seed = team?.coachesSeed || NFL_COACHES_SEED[team?.abbr] || {};
  const live = metaCoaches && typeof metaCoaches === 'object' ? metaCoaches : {};
  return {
    hc: live.hc || seed.hc || `${team.nickname} Head Coach`,
    oc: live.oc || seed.oc || 'Offensive Coordinator',
    dc: live.dc || seed.dc || 'Defensive Coordinator',
    gm: live.gm || seed.gm || 'General Manager'
  };
}

export function buildDeterministicCoachingMatchup({
  team = null,
  metaCoaches = null,
  week = '',
  oppAbbr = '',
  oppName = 'Opponent',
  oppRecord = '',
  oppCoachName = '',
  homeAway = 'home'
} = {}) {
  const activeTeam = resolveTeamConfig(team || getActiveTeamConfig());
  const coaches = getTeamCoaches(activeTeam, metaCoaches);
  const cleanOppAbbr = String(oppAbbr || '').toUpperCase().trim();
  const oppSeed = cleanOppAbbr && cleanOppAbbr !== 'TBD' && cleanOppAbbr !== 'BYE' ? NFL_COACHES_SEED[cleanOppAbbr] || null : null;
  const oppSameHcDc = oppSeed?.hc && oppSeed?.dc && oppSeed.hc.toLowerCase() === oppSeed.dc.toLowerCase();
  const oppStaffTitle = oppCoachName
    ? oppCoachName
    : oppSeed
      ? oppSameHcDc
        ? `HC/DC ${oppSeed.hc}`
        : [
            oppSeed.hc ? `HC ${oppSeed.hc}` : '',
            oppSeed.dc ? `DC ${oppSeed.dc}` : ''
          ]
            .filter(Boolean)
            .join(' & ')
      : `${oppName} Staff`;
  const venueTag = homeAway === 'home' ? activeTeam.stadium : 'Road Test';
  const oppRecTag = oppRecord && oppRecord !== '—' ? ` (${oppRecord})` : '';

  if (activeTeam.abbr === 'SF') {
    return {
      headline: `${coaches.hc} & DC ${coaches.dc} vs. ${oppStaffTitle} (${venueTag})`,
      summary: `Week ${week} two-sided coordinator chess match pitting ${coaches.hc}'s 21-personnel motion attack and DC ${coaches.dc}'s split-safety defense against ${oppName}${oppRecTag}—testing both ${activeTeam.city}'s offensive efficiency and its defensive pass-rush and secondary consistency.`,
      bullets: [
        `Pass-Game Efficiency & Coverage Shell Delta: ${coaches.hc} uses condensed splits, jet motion, and orbit motion to diagnose ${oppName}'s single-high vs. two-high rotations pre-snap, while ${oppName}'s front and disguised coverage shells aim to disrupt timing windows and pressure intermediate reads.`,
        `Trench Run-Fit & Two-Way Leverage: ${coaches.dc} leans on light-box run fits and disguised Quarters/Cover 6 rotations, while ${oppName}'s offense tests ${activeTeam.city}'s pass rush and perimeter coverage discipline on early downs and in the red zone.`
      ]
    };
  }

  const sameHcDc = coaches.hc && coaches.dc && coaches.hc.toLowerCase() === coaches.dc.toLowerCase();
  const ourLead = sameHcDc ? `HC/DC ${coaches.hc}` : `${coaches.hc} & DC ${coaches.dc}`;
  const ocLabel = coaches.oc && coaches.oc !== coaches.hc ? `OC ${coaches.oc}` : coaches.hc;
  const staffSummaryList = sameHcDc ? `HC/DC ${coaches.hc}, ${ocLabel}` : `${coaches.hc}, ${ocLabel}, DC ${coaches.dc}`;
  const dcLabel = sameHcDc ? `HC/DC ${coaches.hc}` : `DC ${coaches.dc}`;
  return {
    headline: `${ourLead} vs. ${oppStaffTitle} (${venueTag})`,
    summary: `Week ${week} two-sided coordinator chess match pitting ${activeTeam.fullName}'s staff (${staffSummaryList}) against ${oppName}${oppRecTag}—testing both ${activeTeam.city}'s offensive efficiency and its defensive pass-rush and coverage discipline.`,
    bullets: [
      `Pass-Game Efficiency & Coverage Shell Delta: ${coaches.hc} and ${ocLabel} look to stress ${oppName}'s single-high vs. two-high rotations with pre-snap motion, spacing, and play-action timing, while ${oppName}'s defensive front and coverage disguises aim to compress intermediate throwing windows.`,
      `Trench Run-Fit & Two-Way Leverage: ${dcLabel} balances pass-rush pressure with two-high/split-safety discipline on early downs, while ${oppName}'s offense tests ${activeTeam.city}'s edge containment, third-down execution, and red-zone stops.`
    ]
  };
}

/**
 * Guardrail against cross-team 49ers contamination on non-SF team sites (e.g. Bills vs. Chiefs
 * or Lions vs. Bears accidentally inheriting Kyle Shanahan / Raheem Morris / Levi's Stadium).
 * Returns `false` when SF is either the active team or the opponent.
 */
export function hasCrossTeam49ersLeak(text = '', teamInput = null, oppAbbr = '') {
  const activeTeam = resolveTeamConfig(teamInput || getActiveTeamConfig());
  const cleanOpp = String(oppAbbr || '').toUpperCase().trim();
  if (activeTeam.abbr === 'SF' || cleanOpp === 'SF') return false;
  const hay = String(text || '');
  if (!hay) return false;
  return /\b(?:kyle\s+shanahan|raheem\s+morris|klay\s+kubiak|john\s+lynch|levi['’]?s\s+stadium|san\s+francisco\s+49ers|49ers\s+faithful|49ers\.joshal\.com|overthecap\.com\/salary-cap\/san-francisco-49ers)\b/i.test(
    hay
  );
}
