/**
 * Data Loader & Resilient LocalStorage User Preferences Manager
 */

import { scoreContentSignal, cleanSensationalistText } from '../engine/antiFluffFilter.js';
import { computePlayerPlayProbability } from '../engine/injuryProbabilityModel.js';
import { runPlayoffMonteCarlo } from '../engine/playoffMonteCarlo.js';

const STORAGE_KEY = 'joshal_49ers_hq_prefs_v1';
const GITHUB_RAW_DATA_BASE = 'https://raw.githubusercontent.com/joshal7/49ers/main/data';

const LIVE_BLUESKY_BEAT_ACCOUNTS = [
  {
    actor: 'mattmaiocco.bsky.social',
    reporterId: 'matt_maiocco',
    reporterName: 'Matt Maiocco',
    authorHandle: '@MaioccoNBCS',
    outletId: 'nbcsba',
    outletName: 'NBC Sports Bay Area'
  },
  {
    actor: 'mattbarrows.bsky.social',
    reporterId: 'matt_barrows',
    reporterName: 'Matt Barrows',
    authorHandle: '@mattbarrows',
    outletId: 'athletic',
    outletName: 'The Athletic'
  },
  {
    actor: 'jenniferleechan.bsky.social',
    reporterId: 'jennifer_lee_chan',
    reporterName: 'Jennifer Lee Chan',
    authorHandle: '@jenniferleechan',
    outletId: 'nbcsba',
    outletName: 'NBC Sports Bay Area'
  },
  {
    actor: 'nbcs49ers.bsky.social',
    reporterId: 'matt_maiocco',
    reporterName: '49ers on NBCSBA',
    authorHandle: '@NBCS49ers',
    outletId: 'nbcsba',
    outletName: 'NBC Sports Bay Area'
  },
  {
    actor: '49erswebzone.bsky.social',
    reporterId: 'al_sacco',
    reporterName: '49ers Webzone',
    authorHandle: '@49erswebzone',
    outletId: '49ers_webzone',
    outletName: '49ers Webzone'
  }
];

export const DEFAULT_USER_PREFS = {
  theme: 'dark', // 'dark' = Levi's Night Game | 'light' = '94 Throwback White & Gold
  dashboardOrder: [],
  dashboardOrderVersion: 2,
  disabledReporterIds: [],
  disabledOutlets: [],
  muteHotTakePersonalities: false,
  strictAnalyticsFilmOnly: false,
  groupPasscode: '',
  authorName: 'Josh',
  workerBaseUrl: '',
  capMoves: {}, // playerId -> action
  playoffForcedWinners: {}, // gameId -> 'HOME' | 'AWAY'
  localCustomAnalyses: [],
  localCustomEpisodes: []
};

export function loadUserPrefs() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredCloneFallback(DEFAULT_USER_PREFS);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return structuredCloneFallback(DEFAULT_USER_PREFS);
    }
    const orderIsV2 = parsed.dashboardOrderVersion === 2;
    return {
      ...structuredCloneFallback(DEFAULT_USER_PREFS),
      ...parsed,
      dashboardOrderVersion: 2,
      dashboardOrder: orderIsV2 && Array.isArray(parsed.dashboardOrder) ? parsed.dashboardOrder : [],
      disabledReporterIds: Array.isArray(parsed.disabledReporterIds) ? parsed.disabledReporterIds : [],
      disabledOutlets: Array.isArray(parsed.disabledOutlets) ? parsed.disabledOutlets : [],
      capMoves: parsed.capMoves && typeof parsed.capMoves === 'object' ? parsed.capMoves : {},
      playoffForcedWinners:
        parsed.playoffForcedWinners && typeof parsed.playoffForcedWinners === 'object'
          ? parsed.playoffForcedWinners
          : {},
      localCustomAnalyses: Array.isArray(parsed.localCustomAnalyses) ? parsed.localCustomAnalyses : [],
      localCustomEpisodes: Array.isArray(parsed.localCustomEpisodes) ? parsed.localCustomEpisodes : []
    };
  } catch {
    return structuredCloneFallback(DEFAULT_USER_PREFS);
  }
}

export function saveUserPrefs(prefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

function structuredCloneFallback(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function fetchJsonSafe(pathUrl) {
  const res = await fetch(pathUrl, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`Failed to load ${pathUrl} (HTTP ${res.status})`);
  }
  return res.json();
}

export async function loadAll49ersData(basePrefix = './data') {
  const cleanBase = String(basePrefix || './data').replace(/\/+$/, '');
  const [
    meta,
    roster,
    depthChart,
    cap,
    reporters,
    news,
    scheduleMatchup,
    health,
    seasonal,
    podcastIndex
  ] = await Promise.all([
    fetchJsonSafe(`${cleanBase}/meta.json`),
    fetchJsonSafe(`${cleanBase}/roster.json`),
    fetchJsonSafe(`${cleanBase}/depth-chart.json`),
    fetchJsonSafe(`${cleanBase}/cap.json`),
    fetchJsonSafe(`${cleanBase}/reporters.json`),
    fetchJsonSafe(`${cleanBase}/news.json`),
    fetchJsonSafe(`${cleanBase}/schedule-matchup.json`),
    fetchJsonSafe(`${cleanBase}/health.json`),
    fetchJsonSafe(`${cleanBase}/seasonal.json`),
    fetchJsonSafe(`${cleanBase}/podcasts/index.json`)
  ]);

  return {
    meta,
    roster,
    depthChart,
    cap,
    reporters,
    news,
    scheduleMatchup,
    health,
    seasonal,
    podcastIndex
  };
}

function isProductionHostedOrigin() {
  if (typeof window === 'undefined' || !window.location) return false;
  const host = String(window.location.hostname || '').toLowerCase();
  return host.endsWith('joshal.com') || host.endsWith('github.io');
}

/**
 * Checks both same-origin `./data/meta.json` and (in production) GitHub's CORS-enabled
 * `raw.githubusercontent.com/joshal7/49ers/main/data/meta.json` so automated `GITHUB_TOKEN`
 * commits from GitHub Actions always propagate within seconds even without a Jekyll rebuild.
 */
export async function fetchFresherUpstreamData(currentUpdatedAt = '') {
  const curMs = Date.parse(currentUpdatedAt || '') || 0;
  const candidates = ['./data'];
  if (isProductionHostedOrigin()) {
    candidates.push(GITHUB_RAW_DATA_BASE);
  }

  let bestPrefix = null;
  let bestMs = curMs;

  await Promise.all(
    candidates.map(async prefix => {
      try {
        const res = await fetch(`${prefix}/meta.json?t=${Date.now()}`, { cache: 'no-cache' });
        if (!res.ok) return;
        const meta = await res.json();
        const ts = Date.parse(meta?.updatedAt || '') || 0;
        if (ts > bestMs) {
          bestMs = ts;
          bestPrefix = prefix;
        }
      } catch {
        // Ignore transient offline / network errors
      }
    })
  );

  if (!bestPrefix) return null;
  return loadAll49ersData(bestPrefix);
}

/**
 * Fetches real-time 49ers beat posts directly from CORS-enabled Bluesky public feeds
 * (`public.api.bsky.app`) so social updates between 2-hour CI runs appear to-the-minute.
 */
export async function hydrateLiveBlueskyBeatWire(appData) {
  if (!appData?.news || !Array.isArray(appData.news.rawStream)) return 0;
  const existingUrls = new Set(appData.news.rawStream.map(it => it.url).filter(Boolean));
  const rosterPlayers = appData.roster?.players || [];

  const matchPlayers = text => {
    const hay = String(text || '').toLowerCase();
    const hits = [];
    for (const p of rosterPlayers) {
      if (hits.length >= 3) break;
      if (hay.includes(p.name.toLowerCase())) {
        hits.push({
          id: p.id,
          name: p.name,
          shortName: `${p.name[0]}. ${p.name.split(/\s+/).slice(-1)[0]}`,
          position: p.position,
          jersey: p.jersey,
          headshotUrl: p.headshotUrl || ''
        });
      }
    }
    return hits;
  };

  const discovered = [];
  await Promise.all(
    LIVE_BLUESKY_BEAT_ACCOUNTS.map(async acct => {
      try {
        const apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(acct.actor)}&limit=4&filter=posts_no_replies`;
        const res = await fetch(apiUrl, { cache: 'no-cache' });
        if (!res.ok) return;
        const payload = await res.json();
        for (const row of payload.feed || []) {
          if (row.reason) continue;
          const post = row.post;
          const rec = post?.record;
          const rawText = String(rec?.text || '').replace(/\s+/g, ' ').trim();
          if (!rawText || rawText.length < 24) continue;
          const rkey = String(post?.uri || '').split('/').pop();
          if (!rkey) continue;
          const postUrl = `https://bsky.app/profile/${acct.actor}/post/${rkey}`;
          if (existingUrls.has(postUrl)) continue;

          const cleanText = cleanSensationalistText(rawText);
          const sig = scoreContentSignal(cleanText, '');
          if (sig.isClickbait) continue;

          const extEmbed = post?.embed?.external || rec?.embed?.external || null;
          const imgThumb =
            post?.embed?.images?.[0]?.thumb ||
            extEmbed?.thumb ||
            '';

          existingUrls.add(postUrl);
          discovered.push({
            id: `bsky_live_${acct.reporterId}_${rkey}`,
            type: 'tweet',
            title: cleanText,
            summary: extEmbed?.title ? cleanSensationalistText(extEmbed.title) : '',
            imageUrl: typeof imgThumb === 'string' && imgThumb.startsWith('https://') ? imgThumb : '',
            imageAlt: `${acct.reporterName} social post`,
            mentionedPlayers: matchPlayers(cleanText),
            publishedAt: rec?.createdAt || post?.indexedAt || new Date().toISOString(),
            url: postUrl,
            externalUrl: typeof extEmbed?.uri === 'string' && extEmbed.uri.startsWith('https://') ? extEmbed.uri : null,
            externalTitle: extEmbed?.title ? cleanSensationalistText(extEmbed.title) : null,
            outletId: acct.outletId,
            outletName: acct.outletName,
            reporterId: acct.reporterId,
            reporterName: acct.reporterName,
            authorHandle: acct.authorHandle,
            authorProfileUrl: `https://bsky.app/profile/${acct.actor}`,
            category: /injur|practice|questionable|ruled out|bosa|cmc/i.test(cleanText) ? 'injury' : 'beat',
            signalScore: Math.max(76, sig.signalScore),
            fluffScore: sig.fluffScore,
            isClickbait: false
          });
        }
      } catch {
        // Ignore network/offline errors cleanly
      }
    })
  );

  if (discovered.length > 0) {
    appData.news.rawStream = [...discovered, ...appData.news.rawStream].sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
  }
  return discovered.length;
}

function normPlayerNameKey(s = '') {
  return String(s || '')
    .toLowerCase()
    .replace(/\b(jr\.?|sr\.?|ii|iii|iv)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function normalizeTeamAbbrClient(abbr = '') {
  const clean = String(abbr || '').toUpperCase().trim();
  if (clean === 'WSH') return 'WAS';
  if (clean === 'LA') return 'LAR';
  return clean;
}

function extractBodyPartSafe(shortComment = '') {
  const m = String(shortComment || '').match(/^[A-Z][A-Za-z'. -]{1,28}\s+\(([a-zA-Z /,-]{3,28})\)/);
  if (!m) return '';
  const cand = m[1].trim();
  if (/\b(solo|tackle|yard|target|catch|carry|touchdown|sack|int|fumble|pat|attempt)\b/i.test(cand)) {
    return '';
  }
  return cand.charAt(0).toUpperCase() + cand.slice(1);
}

/**
 * Zero-server real-time client hydration directly from CORS-enabled ESPN NFL APIs
 * (`site.api.espn.com` + `site.web.api.espn.com`). Automatically updates standings,
 * game scores, week rollover (`upcomingMatchup` + Pickcenter odds), 49ers & opponent
 * injury play probabilities, 10,000-run Monte Carlo playoff odds, and ESPN beat articles.
 */
export async function hydrateLiveEspnOverlay(appData) {
  if (!appData?.meta || !appData?.scheduleMatchup) return false;
  let mutated = false;
  let standingsOrScoresChanged = false;

  const fetchCorsJson = async url => {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    return res.json();
  };

  const [standingsRaw, scheduleRaw, injuriesRaw, espnNewsRaw] = await Promise.all([
    fetchCorsJson('https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings').catch(() => null),
    fetchCorsJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/sf/schedule').catch(() => null),
    fetchCorsJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries').catch(() => null),
    fetchCorsJson('https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?team=25&limit=15').catch(() => null)
  ]);

  const teamRecords = new Map();

  // 1. Live Standings & NFC West Rank
  if (standingsRaw?.children?.length) {
    for (const conf of standingsRaw.children) {
      for (const entry of conf.standings?.entries || []) {
        const abbr = normalizeTeamAbbrClient(entry.team?.abbreviation);
        const getStat = n => entry.stats?.find(s => s.name === n);
        const record = getStat('overall')?.displayValue || '0-0';
        const wins = Number(getStat('wins')?.value || 0);
        const losses = Number(getStat('losses')?.value || 0);
        const ties = Number(getStat('ties')?.value || 0);
        const winPct = Number(getStat('winPercent')?.value || 0);
        const pd = Number(getStat('pointDifferential')?.value || 0);
        const pf = Number(getStat('pointsFor')?.value || 0);
        const pa = Number(getStat('pointsAgainst')?.value || 0);
        const seed = Number(getStat('playoffSeed')?.value || 1);
        const divRec = getStat('vs. Div.')?.displayValue || getStat('divisionRecord')?.displayValue || '0-0';
        const confRec = getStat('vs. Conf.')?.displayValue || '0-0';
        teamRecords.set(abbr, { record, wins, losses, ties, winPct, pd, pf, pa, seed, divRec, confRec });
      }
    }

    const sfSt = teamRecords.get('SF');
    if (sfSt) {
      const nfcWestRanked = ['SF', 'SEA', 'LAR', 'ARI']
        .map(a => ({ abbr: a, ...(teamRecords.get(a) || { winPct: 0, wins: 0, pd: 0 }) }))
        .sort((a, b) => b.winPct - a.winPct || b.wins - a.wins || b.pd - a.pd);
      const divIdx = Math.max(0, nfcWestRanked.findIndex(t => t.abbr === 'SF'));
      const divOrd = ['1st', '2nd', '3rd', '4th'][divIdx] || '1st';
      const newSummary = `${divOrd} in NFC West • #${sfSt.seed} Seed in NFC`;
      const newPdDisp = `${sfSt.pd >= 0 ? '+' : ''}${sfSt.pd} (${sfSt.pf} PF / ${sfSt.pa} PA)`;

      if (appData.meta.teamRecord !== sfSt.record) standingsOrScoresChanged = true;
      appData.meta.teamRecord = sfSt.record;
      appData.meta.divisionRecord = sfSt.divRec;
      appData.meta.conferenceRecord = sfSt.confRec;
      appData.meta.standingSummary = newSummary;
      appData.meta.pointDifferential = newPdDisp;
      mutated = true;

      // Sync NFC simulator team records
      const nfcInputs = appData.seasonal?.playoffPicture?.simulatorInputs?.nfcTeams || [];
      for (const nt of nfcInputs) {
        const liveT = teamRecords.get(normalizeTeamAbbrClient(nt.abbr));
        if (liveT) {
          nt.wins = liveT.wins;
          nt.losses = liveT.losses;
          nt.ties = liveT.ties;
        }
      }
    }
  }

  // 2. Live Schedule Scores & Automatic Week Rollover
  if (scheduleRaw?.events?.length && Array.isArray(appData.scheduleMatchup.schedule)) {
    const byWeek = new Map(appData.scheduleMatchup.schedule.map(g => [Number(g.week), g]));
    for (const ev of scheduleRaw.events) {
      const wk = Number(ev.week?.number || 0);
      const item = byWeek.get(wk);
      if (!item) continue;
      const comp = ev.competitions?.[0] || {};
      const sfComp = (comp.competitors || []).find(c => c.team?.abbreviation === 'SF');
      const oppComp = (comp.competitors || []).find(c => c.team?.abbreviation !== 'SF');
      const completed = Boolean(comp.status?.type?.completed);
      if (completed && !item.completed) standingsOrScoresChanged = true;
      if (completed) {
        const sfSc = Number(sfComp?.score?.value ?? sfComp?.score?.displayValue ?? item.sfScore ?? 0);
        const opSc = Number(oppComp?.score?.value ?? oppComp?.score?.displayValue ?? item.oppScore ?? 0);
        item.completed = true;
        item.sfScore = sfSc;
        item.oppScore = opSc;
        item.result = sfSc > opSc ? 'W' : sfSc < opSc ? 'L' : 'T';
      }
      if (comp.status?.type?.shortDetail) {
        item.statusDetail = comp.status.type.shortDetail;
      }
      const oppLive = teamRecords.get(normalizeTeamAbbrClient(item.opponent?.abbr));
      if (oppLive && item.opponent) {
        item.opponent.record = oppLive.record;
        item.opponent.pointDiff = oppLive.pd;
      }
      mutated = true;
    }

    const nextGame =
      appData.scheduleMatchup.schedule.find(g => !g.completed) ||
      appData.scheduleMatchup.schedule[appData.scheduleMatchup.schedule.length - 1];

    if (nextGame) {
      const um = appData.scheduleMatchup.upcomingMatchup || {};
      const nextWk = Number(nextGame.week || appData.meta.currentWeek || 9);
      const weekAdvanced = um.week && nextWk !== Number(um.week);
      appData.meta.currentWeek = nextWk;
      if (appData.meta.teamStatus) appData.meta.teamStatus.currentWeek = nextWk;

      const oppAbbr = normalizeTeamAbbrClient(nextGame.opponent?.abbr || um.oppAbbr || 'LV');
      const oppLiveRec = teamRecords.get(oppAbbr)?.record || nextGame.opponent?.record || um.oppRecord;
      if (oppLiveRec) um.oppRecord = oppLiveRec;
      if (appData.meta.teamRecord) {
        const divOrdPart = (appData.meta.standingSummary || '').split('•')[0]?.trim() || 'NFC West';
        um.sfRecord = `${appData.meta.teamRecord} (${divOrdPart})`;
      }

      if (weekAdvanced) {
        const PFR_CODES = {
          ARI: 'crd', ATL: 'atl', BAL: 'rav', BUF: 'buf', CAR: 'car', CHI: 'chi', CIN: 'cin', CLE: 'cle',
          DAL: 'dal', DEN: 'den', DET: 'det', GB: 'gnb', HOU: 'htx', IND: 'clt', JAX: 'jax', KC: 'kan',
          LAC: 'sdg', LAR: 'ram', LV: 'rai', MIA: 'mia', MIN: 'min', NE: 'nwe', NO: 'nor', NYG: 'nyg',
          NYJ: 'nyj', PHI: 'phi', PIT: 'pit', SEA: 'sea', SF: 'sfo', TB: 'tam', TEN: 'oti', WAS: 'was'
        };
        const dt = nextGame.dateIso ? new Date(nextGame.dateIso) : null;
        const kickoffFmt = dt && !Number.isNaN(dt.getTime())
          ? `${dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' })} • ${dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })} PT (${nextGame.broadcast || 'NFL'})`
          : nextGame.statusDetail || '';

        um.week = nextWk;
        um.gameUrl = nextGame.gameUrl || um.gameUrl;
        um.oppAbbr = oppAbbr;
        um.oppName = nextGame.opponent?.name || oppAbbr;
        um.oppLogoUrl = nextGame.opponent?.logoUrl || `https://a.espncdn.com/i/teamlogos/nfl/500/${oppAbbr.toLowerCase()}.png`;
        um.homeAway = nextGame.homeAway || 'home';
        um.kickoffIso = nextGame.dateIso || um.kickoffIso;
        um.kickoffDisplay = kickoffFmt;
        um.venue = `${nextGame.venue?.name || ''}${nextGame.venue?.city ? ` (${nextGame.venue.city})` : ''} • ${nextGame.venue?.surface || 'Grass'}`;
        um.coachingMatchup = {
          headline: `Kyle Shanahan vs. ${nextGame.opponent?.coach || `${um.oppName} Staff`} (${nextGame.homeAway === 'home' ? "Levi's Stadium" : 'Road Test'})`,
          summary: `Week ${nextWk} schematic matchup pitting Kyle Shanahan's 21/11-personnel motion and Wide-9 defensive front against ${um.oppName} (${um.oppRecord}).`
        };
        if (um.franchiseHistory) {
          um.franchiseHistory.pfrQueryUrl = `https://www.pro-football-reference.com/boxscores/game_query.cgi?tm1=sfo&tm2=${PFR_CODES[oppAbbr] || oppAbbr.toLowerCase()}&yr=all`;
        }
        if (um.opponentHealth) {
          um.opponentHealth.teamAbbr = oppAbbr;
          um.opponentHealth.teamName = um.oppName;
          um.opponentHealth.teamInjuriesUrl = `https://www.espn.com/nfl/team/injuries/_/name/${oppAbbr.toLowerCase()}`;
          um.opponentHealth.keyStartersHealthy = [];
          um.opponentHealth.irReserve = [];
        }
      }

      // Fetch live Pickcenter spread & O/U for nextScheduledGame
      if (nextGame.id) {
        const summaryRaw = await fetchCorsJson(
          `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${encodeURIComponent(nextGame.id)}`
        ).catch(() => null);
        const pc = summaryRaw?.pickcenter?.[0];
        if (pc && um.betting) {
          if (pc.details) um.betting.spread = pc.details;
          if (pc.overUnder) um.betting.overUnder = Number(pc.overUnder);
        }
      }
    }
  }

  // 3. Re-run 10,000-trial Playoff Monte Carlo if standings or completed games changed
  if (standingsOrScoresChanged && appData.seasonal?.playoffPicture?.simulatorInputs) {
    try {
      const simIn = appData.seasonal.playoffPicture.simulatorInputs;
      const freshMc = runPlayoffMonteCarlo({ ...simIn, iterations: 10000, seed: 492026 });
      if (freshMc?.sfOdds) {
        appData.seasonal.playoffPicture.baselineSimulation = freshMc;
      }
    } catch {
      // Keep baseline simulation on error
    }
  }

  // 4. Live ESPN Injury Designations (49ers + Upcoming Opponent)
  if (Array.isArray(injuriesRaw?.injuries)) {
    const sfTeamInj = injuriesRaw.injuries.find(
      t => String(t.id) === '25' || /49ers/i.test(t.displayName || '')
    );
    const activeOppAbbr = normalizeTeamAbbrClient(appData.scheduleMatchup.upcomingMatchup?.oppAbbr || '');
    const oppTeamInj = injuriesRaw.injuries.find(t => {
      const sampleAbbr = normalizeTeamAbbrClient(t.injuries?.[0]?.athlete?.team?.abbreviation || '');
      return sampleAbbr === activeOppAbbr || (appData.scheduleMatchup.upcomingMatchup?.oppName && t.displayName === appData.scheduleMatchup.upcomingMatchup.oppName);
    });

    if (sfTeamInj?.injuries?.length && Array.isArray(appData.roster?.players)) {
      const rosterByNorm = new Map(appData.roster.players.map(p => [normPlayerNameKey(p.name), p]));
      for (const item of sfTeamInj.injuries) {
        const nm = item.athlete?.displayName || '';
        const rp = rosterByNorm.get(normPlayerNameKey(nm));
        if (!rp || !rp.health) continue;
        const rawStatus = item.status || rp.health.status || 'Active';
        const shortC = cleanSensationalistText(item.shortComment || '');
        const longC = cleanSensationalistText(item.longComment || shortC);
        const bodyPart = item.details?.type || extractBodyPartSafe(shortC) || rp.health.injuryType || '';
        const isIrReturnQ =
          rp.rosterBucket === 'ir' &&
          /(listed as questionable|questionable for sunday|likely will be activated|expected to be activated)/i.test(`${shortC} ${longC}`);
        const isRealReport =
          ['out', 'doubtful', 'questionable'].includes(rawStatus.toLowerCase()) ||
          Boolean(bodyPart) ||
          isIrReturnQ;
        if (!isRealReport && rp.rosterBucket === 'active') continue;

        const playProb = computePlayerPlayProbability({
          name: rp.name,
          position: rp.position,
          gameStatus: isIrReturnQ ? 'Questionable' : rawStatus,
          isIrReturnQuestionable: isIrReturnQ,
          injuryType: bodyPart,
          wed: rp.health.wed,
          thu: rp.health.thu,
          fri: rp.health.fri,
          beatNote: `${shortC} ${longC}`.trim()
        });
        rp.health.status = isIrReturnQ ? 'Questionable (IR Return Window)' : rawStatus;
        rp.health.injuryType = bodyPart;
        rp.health.shortComment = shortC;
        rp.health.longComment = longC;
        rp.health.playProbabilityPct = playProb.probabilityPct;
        rp.health.playTier = playProb.tier;
        rp.health.playBadgeLabel = playProb.badgeLabel;
        rp.health.isOnPracticeReport = rp.rosterBucket === 'active' || isIrReturnQ;
      }

      if (appData.health) {
        appData.health.practiceReport = appData.roster.players
          .filter(p => p.health?.isOnPracticeReport)
          .sort((a, b) => a.health.playProbabilityPct - b.health.playProbabilityPct || (b.capHit2026 || 0) - (a.capHit2026 || 0))
          .map(p => ({
            playerId: p.id,
            name: p.name,
            position: p.position,
            jersey: p.jersey,
            headshotUrl: p.headshotUrl || '',
            wed: p.health.wed || '-',
            thu: p.health.thu || '-',
            fri: p.health.fri || '-',
            injuryType: p.health.injuryType || 'Cleared — No Designation',
            gameStatus: p.health.status,
            playProbabilityPct: p.health.playProbabilityPct,
            playBadgeLabel: p.health.playBadgeLabel,
            archetypeNote: p.health.archetypeNote || '',
            factors: p.health.factors || [],
            beatComment: p.health.longComment || p.health.shortComment || ''
          }));
      }
      mutated = true;
    }

    if (oppTeamInj?.injuries && appData.scheduleMatchup.upcomingMatchup?.opponentHealth) {
      const liveOppReport = [];
      for (const item of oppTeamInj.injuries) {
        const ath = item.athlete || {};
        const nm = ath.displayName || '';
        if (!nm) continue;
        const rawSt = item.status || 'Active';
        const stLower = rawSt.toLowerCase();
        if (stLower.includes('injured reserve')) continue;
        const shortC = cleanSensationalistText(item.shortComment || '');
        const bodyPart = item.details?.type || extractBodyPartSafe(shortC);
        const isReportWorthy =
          ['out', 'doubtful', 'questionable'].includes(stLower) ||
          (Boolean(bodyPart) && /(designation|questionable|ruled out|will miss|doubtful)/i.test(shortC));
        if (!isReportWorthy) continue;

        const headshot = ath.headshot?.href || '';
        const espnIdM = headshot.match(/\/(\d+)\.png/);
        const espnId = espnIdM ? espnIdM[1] : '';
        const wed = stLower === 'out' ? 'DNP' : 'LP';
        const thu = stLower === 'out' ? 'DNP' : stLower === 'active' ? 'FP' : 'LP';
        const fri = stLower === 'out' ? 'DNP' : stLower === 'active' ? 'FP' : 'LP';
        const prob = computePlayerPlayProbability({
          name: nm,
          position: ath.position?.abbreviation || 'ATH',
          gameStatus: rawSt,
          injuryType: bodyPart,
          wed,
          thu,
          fri,
          beatNote: shortC
        });

        liveOppReport.push({
          name: nm,
          position: ath.position?.abbreviation || 'ATH',
          jersey: null,
          headshotUrl: headshot.startsWith('http://') ? `https://${headshot.slice(7)}` : headshot,
          espnUrl: espnId ? `https://www.espn.com/nfl/player/_/id/${espnId}` : null,
          wed,
          thu,
          fri,
          injuryType: bodyPart || 'Undisclosed',
          gameStatus: stLower === 'active' ? 'No Designation (Cleared)' : rawSt,
          shortComment: shortC,
          playProbabilityPct: prob.probabilityPct,
          playBadgeLabel: prob.badgeLabel
        });
      }
      if (liveOppReport.length > 0) {
        liveOppReport.sort((a, b) => a.playProbabilityPct - b.playProbabilityPct);
        const oh = appData.scheduleMatchup.upcomingMatchup.opponentHealth;
        oh.injuryReport = liveOppReport;
        oh.summary = {
          ...(oh.summary || {}),
          ruledOutCount: liveOppReport.filter(p => p.playProbabilityPct === 0).length,
          questionableOrDoubtfulCount: liveOppReport.filter(p => p.playProbabilityPct > 0 && p.playProbabilityPct < 90).length,
          clearedCount: liveOppReport.filter(p => p.playProbabilityPct >= 90).length
        };
        mutated = true;
      }
    }
  }

  // 5. Live ESPN 49ers Beat Articles
  if (Array.isArray(espnNewsRaw?.articles) && Array.isArray(appData.news?.rawStream)) {
    const existingUrls = new Set(appData.news.rawStream.map(it => it.url).filter(Boolean));
    const newArts = [];
    for (const art of espnNewsRaw.articles) {
      const title = cleanSensationalistText(art.headline || '');
      if (!title) continue;
      let url = art.links?.web?.href || '';
      if (url.startsWith('http://')) url = `https://${url.slice(7)}`;
      if (!url.startsWith('https://') || existingUrls.has(url)) continue;

      const summary = cleanSensationalistText(art.description || '');
      const sig = scoreContentSignal(title, summary);
      if (sig.isClickbait) continue;
      let imgUrl = art.images?.[0]?.url || '';
      if (imgUrl.startsWith('http://')) imgUrl = `https://${imgUrl.slice(7)}`;

      existingUrls.add(url);
      newArts.push({
        id: `espn_live_${art.id || Date.now()}`,
        type: 'article',
        title,
        summary,
        imageUrl: imgUrl.startsWith('https://') ? imgUrl : '',
        imageAlt: title,
        mentionedPlayers: [],
        publishedAt: art.published || new Date().toISOString(),
        url,
        outletId: 'espn',
        outletName: 'ESPN 49ers Beat',
        reporterId: 'nick_wagoner',
        reporterName: art.byline ? cleanSensationalistText(art.byline) : 'ESPN 49ers Beat',
        category: /injur|bosa|questionable/i.test(title) ? 'injury' : 'beat',
        signalScore: Math.max(70, sig.signalScore),
        fluffScore: sig.fluffScore,
        isClickbait: false
      });
    }
    if (newArts.length > 0) {
      appData.news.rawStream = [...newArts, ...appData.news.rawStream].sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      );
      mutated = true;
    }
  }

  if (mutated) {
    appData.meta.updatedAt = new Date().toISOString();
  }
  return mutated;
}
