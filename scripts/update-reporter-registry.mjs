#!/usr/bin/env node
/**
 * Automated 49ers Beat Reporter, Analyst & Insider Registry Builder & Popularity Updater
 * Seeds the 45+ core 49ers beat writers, film analysts, national NFL insiders, and team voices,
 * then queries live Google News / RSS / ESPN mention velocity to dynamically score and rank
 * popularity, auto-surfacing rising voices every 14 days via GitHub Actions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeExternalUrl } from '../src/engine/linkIntegrity.js';
import { getReporterTrustTier, TRUST_TIER_LABELS } from '../src/engine/beatAttributionEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

export const OUTLETS = [
  { id: '49ers_official', name: '49ers.com / Official Team', tier: 1, type: 'official', url: 'https://www.49ers.com/news/' },
  { id: 'nbcsba', name: 'NBC Sports Bay Area', tier: 1, type: 'beat', url: 'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/' },
  { id: 'athletic', name: 'The Athletic (Public Beat Wire)', tier: 1, type: 'beat', url: 'https://x.com/mattbarrows' },
  { id: 'espn', name: 'ESPN NFL & 49ers Beat', tier: 1, type: 'national_beat', url: 'https://www.espn.com/nfl/team/_/name/sf/san-francisco-49ers' },
  { id: 'sf_standard', name: 'The San Francisco Standard', tier: 1, type: 'beat', url: 'https://sfstandard.com/sports/' },
  { id: 'sf_chronicle', name: 'San Francisco Chronicle (Public Beat Wire)', tier: 1, type: 'beat', url: 'https://x.com/Eric_Branch' },
  { id: 'bay_area_news', name: 'Bay Area News Group (Public Beat Wire)', tier: 1, type: 'beat', url: 'https://x.com/CamInman' },
  { id: 'niners_nation', name: 'Niners Nation', tier: 2, type: 'blog_analysis', url: 'https://www.ninersnation.com/' },
  { id: '49ers_webzone', name: '49ers Webzone', tier: 2, type: 'blog_news', url: 'https://www.49erswebzone.com/' },
  { id: 'niners_wire', name: 'Niners Wire (USA Today)', tier: 2, type: 'blog_news', url: 'https://ninerswire.usatoday.com/' },
  { id: 'nfl_network', name: 'NFL Network / NFL.com', tier: 1, type: 'national', url: 'https://www.nfl.com/teams/san-francisco-49ers/' },
  { id: 'youtube_film', name: 'Independent Film & Analytics Creators', tier: 1, type: 'video_film', url: 'https://www.youtube.com/results?search_query=49ers+all+22+film' },
  { id: 'knbr_radio', name: 'KNBR / Radio & Broadcast Booth', tier: 1, type: 'audio_beat', url: 'https://www.knbr.com/49ers/' }
];

const BSKY_HANDLES = {
  matt_maiocco: 'mattmaiocco.bsky.social',
  matt_barrows: 'mattbarrows.bsky.social',
  jennifer_lee_chan: 'jenniferleechan.bsky.social',
  eric_branch: 'eric-branch.bsky.social',
  rob_guerrera: 'statsonfire.bsky.social',
  vic_tafur: 'victafur.bsky.social',
  tim_kawakami: 'timkawakami.bsky.social',
  al_sacco: '49erswebzone.bsky.social',
  adam_schefter: 'adamscheftermirror.bsky.social',
  ian_rapoport: 'rapsheet.bsky.social',
  tom_pelissero: 'tompelissero.bsky.social',
  dianna_russini: 'diannarussini.bsky.social',
  mina_kimes: 'minakimes.bsky.social',
  ben_solak: 'benjaminsolak.bsky.social',
  brett_kollmann: 'brettkollmann.bsky.social',
  nate_tice: 'natetice.bsky.social',
  judah_fortgang: 'throwthedamball.bsky.social',
  ben_baldwin: 'rbsdm.com',
  seth_walder: 'sethwalder.bsky.social'
};

const SEEDED_REPORTERS = [
  // Official Team Podium Voices
  { id: 'kyle_shanahan', name: 'Kyle Shanahan', handle: '@49ers', outletId: '49ers_official', role: 'Head Coach Podium & Scheme Transcripts', category: 'official', styleTag: 'factual-scheme', baseScore: 99 },
  { id: 'john_lynch', name: 'John Lynch', handle: '@JohnLynch49ers', outletId: '49ers_official', role: 'General Manager Roster & Trade Briefings', category: 'official', styleTag: 'factual-roster', baseScore: 96 },
  { id: 'brianna_jeannel', name: 'Briana Jeannel', handle: '@BrianaJeannel', outletId: '49ers_official', role: '49ers.com Senior Team Reporter', category: 'official', styleTag: 'factual-beat', baseScore: 84 },
  { id: '49ers_news', name: 'San Francisco 49ers Official', handle: '@49ers', outletId: '49ers_official', role: 'Transactions, Injury Reports & Depth Releases', category: 'official', styleTag: 'factual-beat', baseScore: 97 },

  // Core 49ers Beat Reporters
  { id: 'matt_maiocco', name: 'Matt Maiocco', handle: '@MaioccoNBCS', outletId: 'nbcsba', role: '49ers Insider • 49ers Talk Podcast', category: 'beat', styleTag: 'factual-beat', baseScore: 98 },
  { id: 'matt_barrows', name: 'Matt Barrows', handle: '@mattbarrows', outletId: 'athletic', role: 'Senior 49ers Beat Writer • 49ers +/- Podcast', category: 'beat', styleTag: 'factual-beat', baseScore: 97 },
  { id: 'nick_wagoner', name: 'Nick Wagoner', handle: '@nwagoner', outletId: 'espn', role: 'ESPN 49ers Beat Reporter', category: 'beat', styleTag: 'factual-beat', baseScore: 96 },
  { id: 'david_lombardi', name: 'David Lombardi', handle: '@LombardiHimself', outletId: 'sf_standard', role: 'EPA, Cap Mechanics & Efficiency Analyst', category: 'beat', styleTag: 'analytics-cap', baseScore: 94 },
  { id: 'jennifer_lee_chan', name: 'Jennifer Lee Chan', handle: '@jenniferleechan', outletId: 'nbcsba', role: '49ers Beat Reporter • 49ers Talk Podcast', category: 'beat', styleTag: 'factual-beat', baseScore: 92 },
  { id: 'eric_branch', name: 'Eric Branch', handle: '@Eric_Branch', outletId: 'sf_chronicle', role: '49ers Beat Writer (SF Chronicle)', category: 'beat', styleTag: 'factual-beat', baseScore: 91 },
  { id: 'cam_inman', name: 'Cam Inman', handle: '@CamInman', outletId: 'bay_area_news', role: '49ers Beat Writer (Mercury News)', category: 'beat', styleTag: 'factual-beat', baseScore: 90 },
  { id: 'vic_tafur', name: 'Vic Tafur', handle: '@VicTafur', outletId: 'athletic', role: '49ers Beat Writer (The Athletic)', category: 'beat', styleTag: 'factual-beat', baseScore: 89 },
  { id: 'harrison_rich', name: 'Harrison Rich', handle: '@harrisonrich_', outletId: 'sf_chronicle', role: '49ers & NFL Reporter (SF Chronicle)', category: 'beat', styleTag: 'factual-beat', baseScore: 88 },
  { id: 'matt_lively', name: 'Matt Lively', handle: '@mattblively', outletId: 'knbr_radio', role: '49ers Beat Reporter (CBS News Bay Area / KPIX)', category: 'beat', styleTag: 'factual-beat', baseScore: 88 },
  { id: 'chris_biderman', name: 'Chris Biderman', handle: '@ChrisBiderman', outletId: 'youtube_film', role: '49ers Beat Writer • Candlestick Chronicles', category: 'beat', styleTag: 'factual-beat', baseScore: 88 },
  { id: 'tim_kawakami', name: 'Tim Kawakami', handle: '@timkawakami', outletId: 'sf_standard', role: 'Editor-at-Large • TK Show & 49ers +/-', category: 'beat', styleTag: 'columnist-insider', baseScore: 88 },
  { id: 'dieter_kurtenbach', name: 'Dieter Kurtenbach', handle: '@dieter', outletId: 'bay_area_news', role: 'Sports Columnist (Mercury News) & KNBR Host', category: 'beat', styleTag: 'opinion-hot-take', baseScore: 82 },

  // Broadcast, Film, Analytics & High-Signal 49ers Creators
  { id: 'tim_ryan', name: 'Tim Ryan', handle: '@TimRyan99', outletId: 'knbr_radio', role: '49ers Color Analyst • Trench & Technique Tape', category: 'film', styleTag: 'film-breakdown', baseScore: 93 },
  { id: 'greg_papa', name: 'Greg Papa', handle: '', outletId: 'knbr_radio', role: 'Voice of the 49ers (KNBR 680 Radio)', category: 'beat', styleTag: 'factual-beat', baseScore: 87 },
  { id: 'guy_haberman', name: 'Guy Haberman', handle: '@GuyHaberman', outletId: 'youtube_film', role: 'Host • Haberman & Middlekauff / Bay Area Pod', category: 'video_pod', styleTag: 'analytical-pod', baseScore: 92 },
  { id: 'rob_guerrera', name: 'Rob "Stats" Guerrera', handle: '@StatsOnFire', outletId: 'youtube_film', role: 'Host • The Gold Standard 49ers Podcast', category: 'video_pod', styleTag: 'analytical-pod', baseScore: 90 },
  { id: 'john_chapman', name: 'John Chapman', handle: '@JL_Chapman', outletId: 'youtube_film', role: '49ers Rush • All-22 & Draft Prospect Tape', category: 'film', styleTag: 'film-breakdown', baseScore: 90 },
  { id: 'brian_peacock', name: 'Brian Peacock', handle: '@BDPeacock', outletId: 'youtube_film', role: 'Co-Host • Locked On 49ers Daily Podcast', category: 'video_pod', styleTag: 'analytical-pod', baseScore: 90 },
  { id: 'eric_crocker', name: 'Eric Crocker', handle: '@Crocky209', outletId: 'youtube_film', role: 'Former DB • Locked On 49ers & Coverage Tape', category: 'film', styleTag: 'film-breakdown', baseScore: 91 },
  { id: 'jonnydel', name: "Jonnydel's Football Academy", handle: '@jonnydels', outletId: 'youtube_film', role: 'QB Progression & Shanahan Play-Design All-22', category: 'film', styleTag: 'film-breakdown', baseScore: 93 },
  { id: 'brady_grustas', name: 'Brady Grustas', handle: '@GrustasBrady', outletId: 'youtube_film', role: '49ers All-22 Pass-Rush & Trench Film Clips', category: 'film', styleTag: 'film-breakdown', baseScore: 87 },
  { id: 'jt_osullivan', name: "JT O'Sullivan (The QB School)", handle: '@theqbschool', outletId: 'youtube_film', role: 'Former NFL QB • The QB School 49ers QB All-22', category: 'film', styleTag: 'film-breakdown', baseScore: 93 },
  { id: 'jeff_deeney', name: 'Jeff Deeney', handle: '@PFF_Jeff', outletId: 'youtube_film', role: '49ers Advanced Grading & Snap Share Analyst', category: 'analytics', styleTag: 'analytics-cap', baseScore: 89 },
  { id: 'brad_graham', name: 'Brad Graham', handle: '@Graham_SFN', outletId: 'youtube_film', role: 'TheSFNiners • Camp Clips & Film Cutups', category: 'video_pod', styleTag: 'factual-beat', baseScore: 88 },
  { id: 'al_sacco', name: 'Al Sacco', handle: '@AlSacco49', outletId: '49ers_webzone', role: 'Founder • 49ers Webzone News & Transcripts', category: 'beat', styleTag: 'factual-beat', baseScore: 85 },
  { id: 'kyle_posey', name: 'Kyle Posey', handle: '@KP_Show', outletId: 'niners_nation', role: 'Lead Managing Editor & All-22 Analyst', category: 'film', styleTag: 'film-breakdown', baseScore: 89 },
  { id: 'rohan_chakravarthi', name: 'Rohan Chakravarthi', handle: '@RohanChakrav', outletId: 'niners_nation', role: 'Roster, Draft & Cap Breakdowns', category: 'beat', styleTag: 'analytics-cap', baseScore: 83 },
  { id: 'akash_anavarathan', name: 'Akash Anavarathan', handle: '@akashanav', outletId: 'youtube_film', role: '49ers EPA Charts & Trend Visualizations', category: 'analytics', styleTag: 'analytics-cap', baseScore: 87 },
  { id: 'steph_sanchez', name: 'Steph Sanchez', handle: '@Steph49K', outletId: 'youtube_film', role: '49ers Know It All • Data & Prop Analytics', category: 'analytics', styleTag: 'analytics-cap', baseScore: 83 },
  { id: 'jason_aponte', name: 'Jason Aponte', handle: '@JasonAponte2103', outletId: 'youtube_film', role: 'Sprint Right Option • All-22 & Matchups', category: 'film', styleTag: 'film-breakdown', baseScore: 84 },
  { id: 'vish_kumaran', name: 'Vish Kumaran', handle: '@VishKumaran', outletId: 'niners_nation', role: 'Scheme, QB Play & Draft Film Analyst', category: 'film', styleTag: 'film-breakdown', baseScore: 84 },
  { id: 'larry_krueger', name: 'Larry Krueger', handle: '@sportslarryk', outletId: 'youtube_film', role: 'The Krueg Show • Practice & Roster Notes', category: 'video_pod', styleTag: 'opinion-hot-take', baseScore: 80 },
  { id: 'grant_cohn', name: 'Grant Cohn', handle: '@grantcohn', outletId: 'youtube_film', role: 'Camp 1-on-1 Logs & Columnist', category: 'beat', styleTag: 'opinion-hot-take', baseScore: 78 },

  // National NFL Insiders & Analytical Heavyweights
  { id: 'adam_schefter', name: 'Adam Schefter', handle: '@AdamSchefter', outletId: 'espn', role: 'ESPN Senior NFL Insider (Tier-1 Transactions)', category: 'national_insider', styleTag: 'factual-roster', baseScore: 99 },
  { id: 'ian_rapoport', name: 'Ian Rapoport', handle: '@RapSheet', outletId: 'nfl_network', role: 'NFL Network National Insider (Tier-1 Injury/Trades)', category: 'national_insider', styleTag: 'factual-roster', baseScore: 98 },
  { id: 'tom_pelissero', name: 'Tom Pelissero', handle: '@TomPelissero', outletId: 'nfl_network', role: 'NFL Network Insider (Contracts & CBA Rules)', category: 'national_insider', styleTag: 'factual-roster', baseScore: 96 },
  { id: 'dianna_russini', name: 'Dianna Russini', handle: '@DMRussini', outletId: 'nfl_network', role: 'NFL Insider • The Russini Report', category: 'national_insider', styleTag: 'factual-roster', baseScore: 95 },
  { id: 'mike_garafolo', name: 'Mike Garafolo', handle: '@MikeGarafolo', outletId: 'nfl_network', role: 'NFL Network National Reporter', category: 'national_insider', styleTag: 'factual-roster', baseScore: 93 },
  { id: 'albert_breer', name: 'Albert Breer', handle: '@AlbertBreer', outletId: 'nfl_network', role: 'MMQB Front Office & Coaching Intel', category: 'national_insider', styleTag: 'factual-scheme', baseScore: 92 },
  { id: 'jordan_schultz', name: 'Jordan Schultz', handle: '@Schultz_Report', outletId: 'nfl_network', role: 'NFL Insider (Trade & Free Agency)', category: 'national_insider', styleTag: 'factual-roster', baseScore: 87 },
  { id: 'field_yates', name: 'Field Yates', handle: '@FieldYates', outletId: 'espn', role: 'Contract Restructures, Cap & Draft Analyst', category: 'national_insider', styleTag: 'analytics-cap', baseScore: 91 },
  { id: 'jeremy_fowler', name: 'Jeremy Fowler', handle: '@JFowlerESPN', outletId: 'espn', role: 'ESPN National NFL Reporter', category: 'national_insider', styleTag: 'factual-roster', baseScore: 89 },
  { id: 'mina_kimes', name: 'Mina Kimes', handle: '@minakimes', outletId: 'espn', role: 'ESPN NFL Analyst • Scheme & DVOA/EPA', category: 'analytics', styleTag: 'film-breakdown', baseScore: 93 },
  { id: 'ben_solak', name: 'Ben Solak', handle: '@BenjaminSolak', outletId: 'espn', role: 'ESPN NFL Film & Tendency Researcher', category: 'film', styleTag: 'film-breakdown', baseScore: 91 },
  { id: 'brett_kollmann', name: 'Brett Kollmann', handle: '@BrettKollmann', outletId: 'youtube_film', role: 'The Film Room • Deep Coverage & Trench Tape', category: 'film', styleTag: 'film-breakdown', baseScore: 89 },
  { id: 'brian_baldinger', name: 'Brian Baldinger', handle: '@BaldyNFL', outletId: 'youtube_film', role: "Baldy's Breakdowns • All-22 Trench & QB Tape", category: 'film', scope: 'national', styleTag: 'film-breakdown', baseScore: 94 },
  { id: 'brandon_thorn', name: 'Brandon Thorn', handle: '@BrandonThornNFL', outletId: 'youtube_film', role: 'Trench Warfare • OL & DL All-22 Film & GIFs', category: 'film', scope: 'national', styleTag: 'film-breakdown', baseScore: 94 },
  { id: 'ted_nguyen', name: 'Ted Nguyen', handle: '@FB_FilmAnalysis', outletId: 'youtube_film', role: 'The Athletic • All-22 Scheme & Play-Design Clips', category: 'film', scope: 'national', styleTag: 'film-breakdown', baseScore: 94 },
  { id: 'derrik_klassen', name: 'Derrik Klassen', handle: '@QBKlass', outletId: 'youtube_film', role: 'All-22 QB, WR & Coverage Film Breakdowns', category: 'film', scope: 'national', styleTag: 'film-breakdown', baseScore: 91 },
  { id: 'kurt_warner', name: 'Kurt Warner', handle: '@kurt13warner', outletId: 'youtube_film', role: 'QB Confidential • All-22 Passing & Progression Tape', category: 'film', scope: 'national', styleTag: 'film-breakdown', baseScore: 93 },
  { id: 'dan_orlovsky', name: 'Dan Orlovsky', handle: '@danorlovsky7', outletId: 'espn', role: 'ESPN • All-22 Quarterback & Scheme Video Clips', category: 'film', scope: 'national', styleTag: 'film-breakdown', baseScore: 90 },
  { id: 'tej_seth', name: 'Tej Seth', handle: '@tejfbanalytics', outletId: 'youtube_film', role: 'SumerSports • EPA, Coverage & Efficiency Scatter Charts', category: 'analytics', scope: 'national', styleTag: 'film-breakdown', baseScore: 91 },
  { id: 'sumersports', name: 'SumerSports', handle: '@SumerSports', outletId: 'youtube_film', role: 'League-Wide NFL EPA, Trench & Coverage Charts', category: 'analytics', scope: 'national', styleTag: 'film-breakdown', baseScore: 91 },
  { id: 'timo_riske', name: 'Timo Riske', handle: '@PFF_Moo', outletId: 'youtube_film', role: 'PFF Analytics • Positional Value & Efficiency Charts', category: 'analytics', scope: 'national', styleTag: 'film-breakdown', baseScore: 90 },
  { id: 'nate_tice', name: 'Nate Tice', handle: '@Nate_Tice', outletId: 'youtube_film', role: 'All-22 Scheme, Fronts & Draft Film Analyst', category: 'film', scope: 'national', styleTag: 'film-breakdown', baseScore: 92 },
  { id: 'cris_collinsworth', name: 'Cris Collinsworth', handle: '@CollinsworthPFF', outletId: 'youtube_film', role: 'PFF Grades, EPA Rankings & QB Efficiency', category: 'analytics', scope: 'national', styleTag: 'film-breakdown', baseScore: 90 },
  { id: 'judah_fortgang', name: 'Judah Fortgang', handle: '@throwthedamball', outletId: 'youtube_film', role: 'PFF Separation, Coverage & QB Analytics Charts', category: 'analytics', scope: 'national', styleTag: 'film-breakdown', baseScore: 90 },
  { id: 'george_hatzadony', name: 'George Hatzadony', handle: '@ghatz_28', outletId: 'youtube_film', role: 'Statyx NFL Coverage & Efficiency Scatter Charts', category: 'analytics', scope: 'national', styleTag: 'film-breakdown', baseScore: 87 },
  { id: 'dane_brugler', name: 'Dane Brugler', handle: '@dpbrugler', outletId: 'athletic', role: 'The Beast • Lead NFL Draft Prospect Evaluator', category: 'draft', styleTag: 'film-breakdown', baseScore: 94 },
  { id: 'daniel_jeremiah', name: 'Daniel Jeremiah', handle: '@MoveTheSticks', outletId: 'nfl_network', role: 'Former NFL Scout & Top-50 Draft Analyst', category: 'draft', styleTag: 'film-breakdown', baseScore: 93 }
];

async function fetchLiveMentionCounts() {
  const counts = new Map();
  const urls = [
    'https://www.ninersnation.com/rss/current.xml',
    'https://www.nbcsportsbayarea.com/nfl/san-francisco-49ers/?rss=1',
    'https://www.rotowire.com/rss/news.php?sport=NFL',
    'https://news.google.com/rss/search?q=%2249ers%22+when:7d&hl=en-US&gl=US&ceid=US:en',
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=25&limit=40'
  ];

  let corpus = '';
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) });
      if (r.ok) {
        corpus += '\n' + (await r.text());
      }
    } catch {
      // Offline or rate-limited; proceed with remaining sources
    }
  }

  const lower = corpus.toLowerCase();
  for (const rep of SEEDED_REPORTERS) {
    const last = rep.name.split(' ').slice(-1)[0].toLowerCase();
    const full = rep.name.toLowerCase();
    const fullMatches = (lower.match(new RegExp(full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    const lastMatches = last.length >= 5
      ? (lower.match(new RegExp(`\\b${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) || []).length
      : fullMatches;
    counts.set(rep.id, fullMatches * 2 + Math.min(12, lastMatches));
  }
  return counts;
}

export async function buildReporterRegistry() {
  fs.mkdirSync(dataDir, { recursive: true });
  const mentionCounts = await fetchLiveMentionCounts();
  const totalLiveMentions = [...mentionCounts.values()].reduce((acc, n) => acc + n, 0);
  const outPath = path.join(dataDir, 'reporters.json');
  const priorMentionsById = new Map();
  if (totalLiveMentions === 0 && fs.existsSync(outPath)) {
    try {
      const prior = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      for (const r of prior.reporters || []) {
        if (r?.id && Number.isFinite(r.liveWeeklyMentions)) {
          priorMentionsById.set(r.id, r.liveWeeklyMentions);
        }
      }
    } catch {
      // Ignore invalid prior JSON
    }
  }

  const outletMap = new Map(OUTLETS.map(o => [o.id, o]));
  const reporters = SEEDED_REPORTERS.map(rep => {
    const liveMentions = totalLiveMentions > 0 ? (mentionCounts.get(rep.id) || 0) : (priorMentionsById.get(rep.id) || 0);
    const popularityScore = Math.min(100, Math.round(rep.baseScore * 0.88 + Math.min(12, liveMentions * 0.9)));
    const cleanHandle = (rep.handle || '').replace(/^@/, '');
    const bskyHandle = BSKY_HANDLES[rep.id] || null;
    const xUrl = cleanHandle ? `https://x.com/${cleanHandle}` : null;
    const outlet = outletMap.get(rep.outletId);
    const safeOutletUrl = sanitizeExternalUrl(outlet?.url, xUrl || 'https://www.49ers.com/news/');
    const safeProfileUrl = sanitizeExternalUrl(
      xUrl || safeOutletUrl,
      'https://www.49ers.com/news/'
    );
    const trustTier = getReporterTrustTier(rep.id);
    return {
      ...rep,
      trustTier,
      trustTierLabel: TRUST_TIER_LABELS[trustTier] || TRUST_TIER_LABELS[2],
      xUrl,
      bskyHandle,
      bskyUrl: null,
      profileUrl: safeProfileUrl,
      outletUrl: safeOutletUrl,
      liveWeeklyMentions: liveMentions,
      popularityScore,
      defaultEnabled: true
    };
  }).sort((a, b) => a.trustTier - b.trustTier || b.popularityScore - a.popularityScore || a.name.localeCompare(b.name));

  const payload = {
    updatedAt: new Date().toISOString(),
    reviewCadenceDays: 14,
    nextAutoReviewAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    totalTrackedReporters: reporters.length,
    outlets: OUTLETS,
    reporters
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`[reporters] Wrote ${reporters.length} ranked reporters across ${OUTLETS.length} outlets -> ${outPath}`);
  return payload;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildReporterRegistry().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
