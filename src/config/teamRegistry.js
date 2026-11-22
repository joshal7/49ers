/**
 * Universal 32-Team NFL Multi-Tenant Registry & Theme/Identity Resolver
 *
 * Single source of truth shared across:
 *   - Browser PWA (`src/app.js`, `src/services/*`, `src/engine/*`, `src/views/*`)
 *   - Service Worker (`sw.js`)
 *   - Multi-Tenant Cloudflare Edge Worker & HTMLRewriter (`worker/canary-worker.js`, `worker/index.js`)
 *   - Two-Stage Data Ingestion Pipeline (`scripts/fetch-team-data.mjs`, `scripts/build-team-icons.mjs`)
 *
 * Zero-Regression Invariants for `49ers.joshal.com`:
 *   - `SF` preserves exact legacy branding (`49ers Faithful` / `49ers HQ`), exact legacy `localStorage`,
 *     IndexedDB, and `CacheStorage` keys, and `priorityTier: 'vip'` (Priority #0, always eager, never lazy).
 *   - All other 31 NFL clubs use their franchise fanbase brand (e.g., `Lions One Pride`, `Bills Mafia`)
 *     with isolated per-subdomain storage namespaces and WCAG AA (`>= 4.5:1`) contrast-verified dark & light themes.
 */

export const CANARY_TEAM_SLUGS = ['lions', 'bills'];

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
  const shortTitle = raw.shortTitle || brandName;

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
      `https://www.${clubDomain}/rss/video`
    ],
    priorityTier: isSf ? 'vip' : 'standard',
    isCanary: CANARY_TEAM_SLUGS.includes(slug),
    storageKeys,
    assets,
    themes: raw.themes,
    coachesSeed: raw.coachesSeed || null,
    keywordRules: {
      requiredNicknames: raw.requiredNicknames || [raw.nickname],
      excludeGenericCity: Boolean(raw.excludeGenericCity),
      searchAliases: raw.searchAliases || [raw.nickname, `${raw.city} ${raw.nickname}`]
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
    brandName: '49ers Faithful', shortTitle: '49ers HQ',
    timezone: 'America/Los_Angeles', clubDomain: '49ers.com',
    requiredNicknames: ['49ers', 'Niners'],
    searchAliases: ['49ers', 'Niners', 'San Francisco 49ers'],
    coachesSeed: { hc: 'Kyle Shanahan', oc: 'Klay Kubiak', dc: 'Robert Saleh', gm: 'John Lynch' },
    themes: buildThemeSpec({
      darkName: "Levi's Night Game", lightName: "'94 Throwback",
      darkBg: '#0B0D10', darkElevated: '#13171E', darkCardAlt: '#181E27',
      darkPrimary: '#AA0000', darkPrimaryBright: '#D41919',
      darkSecondary: '#B3995D', darkSecondaryBright: '#E7D29B',
      lightBg: '#F7F5F0', lightCardAlt: '#F1EDE2',
      lightPrimary: '#AA0000', lightPrimaryBright: '#B80000',
      lightSecondary: '#8C7034', lightSecondaryBright: '#6B5320',
      crestPrimary: '#AA0000', crestSecondary: '#B3995D'
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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

export function resolveTeamFromHostname(hostname = '', search = '') {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const queryTeam = params.get('team');
  if (queryTeam) {
    const qHit = ALIAS_TO_TEAM.get(queryTeam.trim().toLowerCase());
    if (qHit) return qHit;
  }

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
  return `:root{--bg-primary:${d.bgPrimary};--bg-elevated:${d.bgElevated};--bg-card-alt:${d.bgCardAlt};--bg-input:${d.bgInput};--bg-header:${d.bgHeader};--bg-glass:${d.bgGlass};--scarlet:${d.primary};--scarlet-bright:${d.primaryBright};--scarlet-soft:${d.primarySoft};--gold:${d.secondary};--gold-bright:${d.secondaryBright};--gold-soft:${d.secondarySoft};--gold-border:${d.secondaryBorder};--bg-glow-primary:${d.glowPrimary};--bg-glow-secondary:${d.glowSecondary};}[data-theme="light"]{--bg-primary:${l.bgPrimary};--bg-elevated:${l.bgElevated};--bg-card-alt:${l.bgCardAlt};--bg-input:${l.bgInput};--bg-header:${l.bgHeader};--bg-glass:${l.bgGlass};--scarlet:${l.primary};--scarlet-bright:${l.primaryBright};--scarlet-soft:${l.primarySoft};--gold:${l.secondary};--gold-bright:${l.secondaryBright};--gold-soft:${l.secondarySoft};--gold-border:${l.secondaryBorder};--bg-glow-primary:${l.glowPrimary};--bg-glow-secondary:${l.glowSecondary};}`;
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
}

export function isOfficialTeamHost(hostname = '') {
  const host = String(hostname || '').trim().toLowerCase();
  const m = host.match(/^([a-z0-9-]+)\.joshal\.com$/);
  if (!m) return false;
  return Boolean(TEAM_BY_SLUG[m[1]]);
}
