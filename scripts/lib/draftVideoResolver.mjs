/**
 * Universal 32-Team Draft Recap Highlight Video Resolver
 *
 * Discovers, relevance-scores, and embed-verifies YouTube college/draft highlight reels
 * for every NFL team's drafted rookies and priority UDFAs.
 *
 * Guardrails:
 *  - Strict player-identity matching (never assigns another player's video as a fallback).
 *  - Normalizes college aliases (e.g. Mississippi -> Ole Miss, Southern California -> USC)
 *    and punctuation/suffixes (Jr., II, De'Zhaun, TJ / T.J., Ar'maj, O'Neill, M'ba).
 *  - Prefers embeddable inline-playable highlight/film reels (40s–15m), gracefully falling back
 *    to verified non-embeddable official YouTube clips (`embeddable: false`, rendered as a clean
 *    "Watch on YouTube" facade card) rather than leaving players blank or broken.
 *  - Reuses previously verified cached videos across scheduled refreshes so 2-hour CI runs
 *    spend zero redundant YouTube requests once a team's draft class is populated.
 */

const embedCheckCache = new Map();

const COLLEGE_SEARCH_ALIASES = new Map([
  ['mississippi', 'Ole Miss'],
  ['ole miss', 'Ole Miss'],
  ['miami (fl)', 'Miami'],
  ['miami fl', 'Miami'],
  ['southern california', 'USC'],
  ['usc', 'USC'],
  ['brigham young', 'BYU'],
  ['central florida', 'UCF'],
  ['connecticut', 'UConn'],
  ['north carolina state', 'NC State'],
  ['nc state', 'NC State'],
  ['southern methodist', 'SMU'],
  ['texas christian', 'TCU'],
  ['nevada-las vegas', 'UNLV'],
  ['louisiana-lafayette', 'Louisiana'],
  ['louisiana–lafayette', 'Louisiana'],
  ['florida international', 'FIU'],
  ['florida atlantic', 'FAU'],
  ['texas-san antonio', 'UTSA'],
  ['texas-el paso', 'UTEP'],
  ['middle tennessee state', 'Middle Tennessee'],
  ['california', 'Cal'],
  ['pittsburgh', 'Pitt'],
  ['massachusetts', 'UMass'],
  ['alabama-birmingham', 'UAB'],
  ['virginia tech', 'Virginia Tech'],
  ['georgia tech', 'Georgia Tech'],
  ['texas a&m', 'Texas A&M'],
  ['arizona state', 'Arizona State'],
  ['ohio state', 'Ohio State'],
  ['penn state', 'Penn State'],
  ['boston college', 'Boston College'],
  ['south carolina', 'South Carolina'],
  ['texas tech', 'Texas Tech'],
  ['florida state', 'Florida State'],
  ['michigan state', 'Michigan State'],
  ['oregon state', 'Oregon State'],
  ['oklahoma state', 'Oklahoma State'],
  ['washington state', 'Washington State'],
  ['kansas state', 'Kansas State'],
  ['iowa state', 'Iowa State'],
  ['mississippi state', 'Mississippi State'],
  ['boise state', 'Boise State'],
  ['fresno state', 'Fresno State'],
  ['san diego state', 'San Diego State'],
  ['appalachian state', 'Appalachian State'],
  ['southeastern louisiana', 'Southeastern Louisiana']
]);

const POSITION_SEARCH_KEYWORDS = {
  QB: ['qb', 'quarterback'],
  RB: ['rb', 'running back'],
  FB: ['fb', 'fullback'],
  WR: ['wr', 'wide receiver', 'receiver'],
  TE: ['te', 'tight end'],
  OT: ['ot', 'offensive tackle', 'tackle', 'ol', 'offensive line', 'lineman'],
  T: ['ot', 'offensive tackle', 'tackle', 'ol', 'offensive line', 'lineman'],
  OG: ['og', 'guard', 'iol', 'ol', 'offensive line', 'lineman'],
  G: ['og', 'guard', 'iol', 'ol', 'offensive line', 'lineman'],
  C: ['center', 'iol', 'ol', 'offensive line', 'lineman'],
  OL: ['ol', 'offensive line', 'tackle', 'guard', 'lineman'],
  DE: ['de', 'edge', 'defensive end', 'pass rusher', 'dl', 'defensive line'],
  EDGE: ['edge', 'de', 'olb', 'pass rusher', 'defensive end'],
  DT: ['dt', 'defensive tackle', 'dl', 'interior', 'nose tackle', 'defensive line'],
  NT: ['nt', 'dt', 'defensive tackle', 'dl', 'nose tackle'],
  DL: ['dl', 'dt', 'de', 'defensive line', 'defensive tackle', 'edge'],
  LB: ['lb', 'linebacker', 'ilb', 'mlb', 'olb', 'edge'],
  ILB: ['lb', 'linebacker', 'ilb', 'mlb'],
  OLB: ['lb', 'linebacker', 'olb', 'edge', 'pass rusher'],
  CB: ['cb', 'cornerback', 'corner', 'db', 'defensive back'],
  S: ['safety', 'db', 'defensive back', 'fs', 'ss'],
  FS: ['safety', 'db', 'defensive back', 'fs'],
  SS: ['safety', 'db', 'defensive back', 'ss'],
  DB: ['db', 'cb', 'safety', 'defensive back', 'cornerback'],
  K: ['kicker', 'kicking', 'field goal'],
  P: ['punter', 'punting', 'punt', 'special teams'],
  LS: ['long snapper', 'snapper']
};

const NON_FOOTBALL_NOISE_RE =
  /\b(basketball|nba|wnba|ncaa basketball|march madness|baseball|mlb|softball|hockey|nhl|soccer|mls|premier league|tennis|golf|pga|ufc|mma|boxing|wrestling|volleyball|lacrosse|track and field|official music video|music video|official audio|lyrics|full album|podcast episode)\b/i;

const VIDEO_GAME_NOISE_RE =
  /\b(madden\s*2[0-9]|cfb\s*2[0-9]|ncaa\s*2[0-9]|college football\s*2[0-9]|rebuild|franchise mode|ultimate team|mut\s*2[0-9])\b/i;

const FOOTBALL_SIGNAL_RE =
  /\b(highlights?|highlight reel|film|breakdown|scouting|tape|all[- ]22|nfl draft|draft|football|cfb|best plays|ultimate|senior bowl|shrine bowl|combine|touchdowns?|sacks?|interceptions?|tackles?|punting|punts?|kicking|rookie|prospect|fit)\b/i;

const NFL_TEAM_NICKNAMES = [
  '49ers', 'bears', 'bengals', 'bills', 'broncos', 'browns', 'buccaneers', 'cardinals',
  'chargers', 'chiefs', 'colts', 'commanders', 'cowboys', 'dolphins', 'eagles', 'falcons',
  'giants', 'jaguars', 'jets', 'lions', 'packers', 'panthers', 'patriots', 'raiders',
  'rams', 'ravens', 'saints', 'seahawks', 'steelers', 'texans', 'titans', 'vikings'
];

export function normalizeCollegeSearchAlias(college = '') {
  const raw = String(college || '').trim();
  if (!raw || /^college$/i.test(raw)) return '';
  const key = raw.toLowerCase().replace(/\s+/g, ' ');
  return COLLEGE_SEARCH_ALIASES.get(key) || raw;
}

export function stripNameSuffix(name = '') {
  return String(name || '')
    .trim()
    .replace(/\s+(?:jr\.?|sr\.?|ii|iii|iv|v)$/i, '')
    .trim();
}

export function normalizeTextForMatch(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compactAlnum(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function parseDurationSeconds(durationStr = '') {
  const s = String(durationStr || '').trim();
  if (!s) return null;
  const parts = s.split(':').map(n => Number(n));
  if (parts.some(n => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWord(haystack, word) {
  if (!word) return false;
  return new RegExp(`(?:^|\\s)${escapeRegExp(word)}(?:$|\\s)`).test(haystack);
}

/**
 * Scores a candidate YouTube video for a specific drafted rookie / UDFA.
 * Returns `-Infinity` if the video fails the strict player-identity gate so a wrong player's
 * clip is NEVER attached.
 */
export function scoreDraftVideoCandidate(candidate = {}, player = {}) {
  const videoId = String(candidate?.videoId || '').trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return -Infinity;

  const rawTitle = String(candidate?.title || '').trim();
  const rawChannel = String(candidate?.channel || '').trim();
  if (!rawTitle) return -Infinity;

  const titleNorm = normalizeTextForMatch(rawTitle);
  const titleCompact = compactAlnum(rawTitle);
  const combinedNorm = normalizeTextForMatch(`${rawTitle} ${rawChannel}`);

  const baseName = stripNameSuffix(player?.name || '');
  const rawTokens = baseName
    .split(/\s+/)
    .map(t => normalizeTextForMatch(t))
    .filter(Boolean);
  if (rawTokens.length < 2) return -Infinity;

  const firstRaw = rawTokens[0];
  const lastParts = rawTokens.slice(1);
  const lastJoined = lastParts.join(' ');
  const lastCompact = compactAlnum(lastJoined);
  const firstCompact = compactAlnum(firstRaw);
  const fullCompact = compactAlnum(baseName);

  // Surname match in title is mandatory
  const lastExact =
    hasWord(titleNorm, lastJoined) ||
    (lastCompact.length >= 4 && titleCompact.includes(lastCompact)) ||
    (lastParts.length >= 2 && lastParts.every(p => p.length >= 3 && hasWord(titleNorm, p)));
  if (!lastExact) return -Infinity;

  // First name match (handles TJ / T.J., De'Zhaun / DeZhaun, Ar'maj / Armaj, O'Neill / ONeill)
  const firstExact =
    hasWord(titleNorm, firstRaw) ||
    (firstCompact.length >= 2 &&
      new RegExp(`(?:^|\\s)${escapeRegExp(firstCompact.split('').join('\\s*'))}(?:$|\\s)`).test(titleNorm)) ||
    (firstCompact.length >= 4 && titleCompact.includes(firstCompact)) ||
    (fullCompact.length >= 6 && titleCompact.includes(fullCompact));

  const collegeRaw = String(player?.college || '').trim();
  const collegeAlias = normalizeCollegeSearchAlias(collegeRaw);
  const collegeVariants = Array.from(
    new Set([collegeRaw, collegeAlias].map(c => normalizeTextForMatch(c)).filter(c => c && c !== 'college'))
  );
  const hasCollege = collegeVariants.some(c => hasWord(combinedNorm, c) || (c.length >= 5 && combinedNorm.includes(c)));

  const teamNickname = normalizeTextForMatch(player?.teamNickname || '');
  const teamCity = normalizeTextForMatch(player?.teamCity || '');
  const hasTeam =
    (teamNickname && hasWord(combinedNorm, teamNickname)) || (teamCity && hasWord(combinedNorm, teamCity));

  const hasFootballSignal = FOOTBALL_SIGNAL_RE.test(combinedNorm);
  const posKey = String(player?.position || '').toUpperCase();
  const posKeywords = POSITION_SEARCH_KEYWORDS[posKey] || [];
  const hasPos = posKeywords.some(kw => hasWord(combinedNorm, kw));

  // Strict first-name gate:
  // Always require first name match UNLESS surname is highly distinctive (>= 7 chars or hyphenated)
  // AND paired with college or team AND football signal.
  const isDistinctiveSurname = lastCompact.length >= 7 || lastParts.length >= 2;
  if (!firstExact) {
    if (!(isDistinctiveSurname && (hasCollege || hasTeam) && hasFootballSignal)) {
      return -Infinity;
    }
  }

  // Reject non-football sports / music / video games
  if (NON_FOOTBALL_NOISE_RE.test(rawTitle) && !/\b(nfl|football|cfb)\b/i.test(rawTitle)) {
    return -Infinity;
  }
  if (VIDEO_GAME_NOISE_RE.test(rawTitle)) {
    return -Infinity;
  }

  // Must have at least ONE football/college/team/position context clue so non-football namesakes are rejected
  if (!hasFootballSignal && !hasCollege && !hasTeam && !hasPos) {
    return -Infinity;
  }

  let score = 0;
  if (fullCompact.length >= 6 && titleCompact.includes(fullCompact)) score += 45;
  else if (firstExact && lastExact) score += 38;
  else score += 20;

  if (hasCollege) score += 22;
  if (hasTeam) score += 14;
  if (hasFootballSignal) score += 16;
  if (/\b(highlights?|highlight reel|tape|film|breakdown|best plays|all[- ]22)\b/i.test(rawTitle)) score += 22;
  if (/\b(reaction|reacts to|on why|press conference|interview|speaks to media|meets the media)\b/i.test(rawTitle)) score -= 14;
  if (hasPos) score += 8;

  const dy = Number(player?.draftYear || 2026);
  if (new RegExp(`\\b(${dy}|${dy - 1})\\b`).test(rawTitle)) score += 6;

  // Prefer embeddable inline-playable videos strongly over watch-on-YouTube facades
  if (candidate.embeddable !== false) score += 35;

  // Duration preference: crisp 40s–15m highlight/breakdown videos beat tiny Shorts or 1h podcasts
  const sec = parseDurationSeconds(candidate.duration);
  if (sec != null) {
    if (sec >= 40 && sec <= 900) score += 12;
    else if (sec >= 20 && sec < 40) score += 2;
    else if (sec < 20) score -= 18;
    else if (sec > 1800) score -= 22;
  }

  // Penalize generic full-class / multi-player roundups when a player-specific reel exists
  if (/\b(full\s+draft\s+class|draft\s+grades|every\s+pick|mock\s+draft|7[- ]round)\b/i.test(rawTitle)) {
    score -= 20;
  }

  // Mildly prefer neutral or player's-own-team channels over rival-team fan channels (e.g. Packerfan for a Lions rookie)
  if (teamNickname && !hasTeam) {
    const rivalMentioned = NFL_TEAM_NICKNAMES.some(
      nick => nick !== teamNickname && new RegExp(`\\b${nick.replace(/s$/, '')}s?(?:fan|nation|wire)?\\b`, 'i').test(combinedNorm)
    );
    if (rivalMentioned) score -= 10;
  }

  return score;
}

/**
 * Checks whether an existing cached `highlightVideo` object from a prior seasonal.json
 * is still valid and genuinely matches this player (automatically invalidating legacy
 * wrong-player fallback videos).
 */
export function isCachedDraftVideoValid(video, player) {
  if (!video || !/^[A-Za-z0-9_-]{11}$/.test(String(video.videoId || ''))) return false;
  // Explicitly reject the legacy generic SF Omar Cooper fallback if attached to another player
  if (video.videoId === 'cPvdiBVxl-0' && !/omar\s+cooper/i.test(String(player?.name || ''))) {
    return false;
  }
  const score = scoreDraftVideoCandidate(video, player);
  return Number.isFinite(score) && score >= 45;
}

export async function verifyYouTubeEmbeddable(videoId, { refererUrl = 'https://49ers.joshal.com/' } = {}) {
  if (!videoId) return { exists: false, embeddable: false, authorName: '', title: '' };
  if (embedCheckCache.has(videoId)) return embedCheckCache.get(videoId);

  let result = { exists: false, embeddable: false, authorName: '', title: '' };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const [oeRes, embRes] = await Promise.all([
        fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, {
          signal: AbortSignal.timeout(6500)
        }),
        fetch(`https://www.youtube.com/embed/${videoId}`, {
          headers: {
            Referer: refererUrl,
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
          },
          signal: AbortSignal.timeout(6500)
        })
      ]);

      if (oeRes.ok) {
        const meta = await oeRes.json();
        const embHtml = embRes.ok ? await embRes.text() : '';
        const isBlocked =
          !embRes.ok ||
          embHtml.includes('emb_err_woyt') ||
          embHtml.includes('blocked it from display') ||
          embHtml.includes('"Video unavailable"') ||
          embHtml.includes('UNPLAYABLE');
        result = {
          exists: true,
          embeddable: !isBlocked,
          authorName: meta.author_name || '',
          title: meta.title || ''
        };
      }
      break;
    } catch {
      result = { exists: false, embeddable: false, authorName: '', title: '' };
    }
  }

  embedCheckCache.set(videoId, result);
  return result;
}

async function fetchYouTubeSearchCandidates(query, scanLimit = 10) {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(7500)
    });
    if (!r.ok) return [];
    const html = await r.text();
    const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/);
    if (!m) return [];
    const data = JSON.parse(m[1]);
    const candidates = [];
    const seen = new Set();

    function walk(o) {
      if (!o || typeof o !== 'object' || candidates.length >= scanLimit) return;
      if (o.videoRenderer && o.videoRenderer.videoId && !seen.has(o.videoRenderer.videoId)) {
        const vr = o.videoRenderer;
        seen.add(vr.videoId);
        candidates.push({
          videoId: vr.videoId,
          url: `https://www.youtube.com/watch?v=${vr.videoId}`,
          title: vr.title?.runs?.map(x => x.text).join('') || vr.title?.simpleText || '',
          channel: vr.ownerText?.runs?.[0]?.text || 'YouTube',
          publishedAgo: vr.publishedTimeText?.simpleText || '',
          duration: vr.lengthText?.simpleText || '',
          thumbnailUrl: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault.jpg`
        });
        return;
      }
      for (const k of Object.keys(o)) walk(o[k]);
    }
    walk(data);
    return candidates;
  } catch {
    return [];
  }
}

export function buildPlayerSearchQueries(player = {}) {
  const cleanName = stripNameSuffix(player?.name || '').replace(/['’]/g, '');
  const origName = stripNameSuffix(player?.name || '');
  const collegeAlias = normalizeCollegeSearchAlias(player?.college || '');
  const posKey = String(player?.position || '').toUpperCase();
  const teamNickname = String(player?.teamNickname || '').trim();
  const draftYear = Number(player?.draftYear || 2026);
  const posHint = posKey === 'P' ? 'punter' : posKey === 'K' ? 'kicker' : 'football';

  const queries = [];
  if (collegeAlias) {
    queries.push(`${origName} ${collegeAlias} highlights ${draftYear} NFL draft`);
    if (cleanName !== origName) {
      queries.push(`${cleanName} ${collegeAlias} highlights ${posHint}`);
    } else {
      queries.push(`${origName} ${collegeAlias} ${posHint} highlights`);
    }
  } else {
    queries.push(`${origName} highlights ${draftYear} NFL draft`);
  }
  if (teamNickname) {
    queries.push(`${cleanName} ${teamNickname} ${draftYear} draft`);
  }
  if (!collegeAlias) {
    queries.push(`${cleanName} ${posHint} highlights`);
  }
  return Array.from(new Set(queries.map(q => q.replace(/\s+/g, ' ').trim()).filter(Boolean)));
}

/**
 * Resolves the highest-scoring verified YouTube highlight video for a single player.
 * Prefers embeddable inline-playable videos; gracefully falls back to verified non-embeddable
 * official YouTube clips (`embeddable: false`) only if no embeddable match passes the identity gate.
 */
export async function resolvePlayerDraftHighlightVideo(player, { refererUrl = 'https://49ers.joshal.com/' } = {}) {
  const queries = buildPlayerSearchQueries(player);
  const candidatePool = new Map();

  for (let qi = 0; qi < queries.length; qi += 1) {
    const rawCands = await fetchYouTubeSearchCandidates(queries[qi], 10);
    const preScored = rawCands
      .map(c => ({ cand: c, preScore: scoreDraftVideoCandidate({ ...c, embeddable: true }, player) }))
      .filter(x => Number.isFinite(x.preScore) && x.preScore >= 40)
      .sort((a, b) => b.preScore - a.preScore)
      .slice(0, 6);

    const verified = await Promise.all(
      preScored.map(async ({ cand }) => {
        if (candidatePool.has(cand.videoId)) return candidatePool.get(cand.videoId);
        const chk = await verifyYouTubeEmbeddable(cand.videoId, { refererUrl });
        if (!chk.exists) return null;
        const enriched = {
          videoId: cand.videoId,
          url: `https://www.youtube.com/watch?v=${cand.videoId}`,
          title: cand.title || chk.title || `${player.name} Highlights`,
          channel: cand.channel || chk.authorName || 'YouTube',
          duration: cand.duration || '',
          embeddable: chk.embeddable,
          thumbnailUrl: `https://i.ytimg.com/vi/${cand.videoId}/hqdefault.jpg`
        };
        const finalScore = scoreDraftVideoCandidate(enriched, player);
        const record = { video: enriched, score: finalScore };
        candidatePool.set(cand.videoId, record);
        return record;
      })
    );

    const bestEmbeddable = verified
      .filter(r => r && r.video.embeddable && r.score >= 85)
      .sort((a, b) => b.score - a.score)[0];
    if (bestEmbeddable) {
      return bestEmbeddable.video;
    }
  }

  const allSorted = Array.from(candidatePool.values())
    .filter(r => r && Number.isFinite(r.score) && r.score >= 45)
    .sort((a, b) => b.score - a.score);

  return allSorted[0]?.video || null;
}

/**
 * Attaches verified YouTube highlight videos to both `picks` and `priorityUdfas` of a team's
 * `draftClass2026` payload, reusing valid cached videos from `existingDraftClass` so routine
 * CI refreshes don't waste YouTube lookups.
 */
export async function attachDraftClassHighlightVideos(
  draftClass,
  team = {},
  {
    existingDraftClass = null,
    forceRefresh = false,
    concurrency = 3,
    includeUdfas = true
  } = {}
) {
  if (!draftClass || typeof draftClass !== 'object') return { draftClass, stats: { total: 0, reusedCount: 0, fetchedCount: 0, missingCount: 0 } };

  const refererUrl = team?.domain ? `https://${team.domain}/` : 'https://49ers.joshal.com/';
  const draftYear = Number(draftClass.draftYear || 2026);
  const existingMap = new Map();
  if (!forceRefresh && existingDraftClass) {
    for (const item of [...(existingDraftClass.picks || []), ...(existingDraftClass.priorityUdfas || [])]) {
      const key = compactAlnum(stripNameSuffix(item?.name || ''));
      if (key && item?.highlightVideo?.videoId) {
        existingMap.set(key, item.highlightVideo);
      }
    }
  }

  const targets = [
    ...(draftClass.picks || []).map(item => ({ item, kind: 'pick' })),
    ...(includeUdfas ? (draftClass.priorityUdfas || []).map(item => ({ item, kind: 'udfa' })) : [])
  ];

  let nextIdx = 0;
  let reusedCount = 0;
  let fetchedCount = 0;
  let missingCount = 0;

  async function worker() {
    while (nextIdx < targets.length) {
      const idx = nextIdx;
      nextIdx += 1;
      const { item } = targets[idx];
      const playerCtx = {
        name: item.name,
        college: item.college,
        position: item.position,
        teamNickname: team?.nickname || '',
        teamCity: team?.city || '',
        draftYear
      };
      const key = compactAlnum(stripNameSuffix(item.name));

      // 1. Check already-attached or previously cached video
      const candidateCached = !forceRefresh ? item.highlightVideo || existingMap.get(key) || null : null;
      if (candidateCached && isCachedDraftVideoValid(candidateCached, playerCtx)) {
        item.highlightVideo = {
          ...candidateCached,
          url: candidateCached.url || `https://www.youtube.com/watch?v=${candidateCached.videoId}`,
          embeddable: candidateCached.embeddable !== false,
          thumbnailUrl: candidateCached.thumbnailUrl || `https://i.ytimg.com/vi/${candidateCached.videoId}/hqdefault.jpg`
        };
        reusedCount += 1;
        continue;
      }

      // 2. Discover & verify live on YouTube
      const resolved = await resolvePlayerDraftHighlightVideo(playerCtx, { refererUrl });
      if (resolved) {
        item.highlightVideo = resolved;
        fetchedCount += 1;
      } else {
        item.highlightVideo = null;
        missingCount += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, targets.length)) }, () => worker()));
  return {
    draftClass,
    stats: {
      total: targets.length,
      reusedCount,
      fetchedCount,
      missingCount
    }
  };
}
