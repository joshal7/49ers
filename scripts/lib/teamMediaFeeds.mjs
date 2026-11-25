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
    { outletId: 'nbcs_was', outletName: 'NBC4 Washington', url: 'https://www.nbcwashington.com/tag/washington-commanders/feed/', trustTier: 1 }
  ]
});

/**
 * Optional team-specific curated YouTube channels (official club video + verified local All-22 film creators).
 * National All-22 channels (NFL, The QB School, Brett Kollmann, Alex Rollins) are polled once in Stage 1 for all 32 teams.
 */
export const TEAM_CURATED_YOUTUBE_CHANNELS_BY_ABBR = Object.freeze({
  SF: [
    { id: 'UCeIOarQkwmGhimim9cDUTng', name: 'San Francisco 49ers', handle: '@49ers', category: 'beat', embeddable: false, trustTier: 1 },
    { id: 'UCt1LfHRE5eGiacPVtiaC10w', name: "Jonnydel's Football Academy", handle: '@jonnydels', category: 'film', embeddable: true, trustTier: 2 }
  ]
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
