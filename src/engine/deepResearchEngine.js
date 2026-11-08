/**
 * 49ers Faithful — Multi-Stage Deep Football Research & NotebookLM Audio Script Engine
 *
 * Powers Stage 1 (Deep Research Dossier) and Stage 2 (NotebookLM-Style Conversational
 * Audio Overview Script & Deep Scouting Markdown Synthesis), ensuring every position room,
 * player, scheme concept, injury report, trade candidate, draft pick, and multi-year CBA
 * cap implication is thoroughly researched and accurately paced to the requested duration.
 */

import { formatCompactDollars } from './capSimulator.js';
import { getDisallowedFormer49ers } from './groundingValidator.js';

export const POSITION_GROUP_DEFINITIONS = [
  {
    id: 'WR',
    label: 'Wide Receiver Room',
    singular: 'wide receiver',
    positions: ['WR'],
    regex: /\b(wide\s*rec(?:ei|ie)vers?|rec(?:ei|ie)vers?|wideouts?|wrs?|pass\s*catchers?|perimeter\s*weapons?|x\s*rec(?:ei|ie)ver|slot\s*rec(?:ei|ie)ver)\b/i,
    schemeNote:
      "Kyle Shanahan's motion-heavy 21 and 11 personnel passing structure relies on high-effort perimeter dig/glance route leverage, condensed-split motion releases, and yards-after-catch physicality against two-high shells."
  },
  {
    id: 'QB',
    label: 'Quarterback Room',
    singular: 'quarterback',
    positions: ['QB'],
    regex: /\b(quarter\s*backs?|qbs?|signal\s*callers?|under\s*center|passing\s*game)\b/i,
    schemeNote:
      "Shanahan's play-action boot, middle-of-field anticipation throws, and pre-snap motion alert checks demand elite processing speed, CPOE accuracy, and low pressure-to-sack conversion."
  },
  {
    id: 'RB',
    label: 'Running Back & Fullback Backfield',
    singular: 'running back',
    positions: ['RB', 'FB'],
    regex: /\b(running\s*backs?|rbs?|full\s*backs?|fbs?|backfield|tailbacks?|ground\s*game|run\s*game)\b/i,
    schemeNote:
      'Outside-zone wide stretch married to duo/inside-zone split-flow blocks and choice-route backfield mismatches out of 21 personnel.'
  },
  {
    id: 'TE',
    label: 'Tight End Room',
    singular: 'tight end',
    positions: ['TE'],
    regex: /\b(tight\s*ends?|tes?|12\s*personnel|move\s*tight\s*end|inline\s*blocking)\b/i,
    schemeNote:
      'C-gap wham/slice run-game displacement paired with seam/over-route vertical stress against Cover-3 and Quarters linebackers.'
  },
  {
    id: 'OL',
    label: 'Offensive Line & Trench Protection',
    singular: 'offensive lineman',
    positions: ['OT', 'OG', 'G', 'T', 'C', 'OL'],
    regex: /\b(offensive\s*line(?:men)?|o[-\s]?line|tackles?|guards?|centers?|left\s*guard|right\s*tackle|left\s*tackle|pass\s*pro(?:tection)?|trenches)\b/i,
    schemeNote:
      'Lateral outside-zone reach-block athleticism combined with interior half-slide anchor strength against 3-technique and T-E stunt games.'
  },
  {
    id: 'DL',
    label: 'Defensive Line & Wide-9 Pass Rush',
    singular: 'defensive lineman',
    positions: ['DE', 'DT', 'DL', 'EDGE', 'NT'],
    regex: /\b(defensive\s*line(?:men)?|d[-\s]?line|pass\s*rush(?:ers?)?|edge\s*rush(?:ers?)?|defensive\s*tackles?|defensive\s*ends?|wide[-\s]?9|stunt\s*geometry|sacks?)\b/i,
    schemeNote:
      "DC Raheem Morris's Wide-9 four-man rush pairs explosive edge alignments with interior 3-technique penetraters to force one-on-one guard slides without sacrificing 7-in-coverage shells."
  },
  {
    id: 'LB',
    label: 'Linebacker Corps',
    singular: 'linebacker',
    positions: ['LB', 'ILB', 'OLB', 'MLB'],
    regex: /\b(line\s*backers?|lbs?|mike\s*backer|will\s*backer|second\s*level)\b/i,
    schemeNote:
      'Sideline-to-sideline run-and-hit range plus deep middle Tampa-2 / Cover-3 Buzz carry responsibilities erasing intermediate seams.'
  },
  {
    id: 'DB',
    label: 'Cornerback & Safety Secondary',
    singular: 'defensive back',
    positions: ['CB', 'S', 'FS', 'SS', 'DB'],
    regex: /\b(secondary|defensive\s*backs?|dbs?|corner\s*backs?|corners?|cbs?|safet(?:y|ies)|nickel|slot\s*corner|coverage\s*shells?)\b/i,
    schemeNote:
      "Raheem Morris's disguised two-high to late-rotated Cover-3 Buzz, Quarters, and press-bail outside leverage with physical nickel run-support."
  },
  {
    id: 'ST',
    label: 'Special Teams Unit',
    singular: 'specialist',
    positions: ['K', 'P', 'LS', 'PK'],
    regex: /\b(special\s*teams?|kickers?|punters?|long\s*snapper|field\s*goals?|kickoff\s*returns?)\b/i,
    schemeNote:
      'Hidden-yardage directional hang-time, dynamic kickoff landing-zone discipline, and high-leverage fourth-quarter field-goal execution.'
  }
];

function summarizePlayer2026Stats(player) {
  const s = player?.stats2026;
  if (!s) return null;
  const pos = String(player?.position || '').toUpperCase();
  const parts = [];

  if (pos === 'QB' && s.passing?.attempts > 0) {
    const p = s.passing;
    parts.push(
      `${p.completions}/${p.attempts} for ${p.yards} pass yds, ${p.tds} TD, ${p.ints} INT, ${p.epa >= 0 ? '+' : ''}${Number(p.epa).toFixed(1)} passing EPA, ${p.cpoe >= 0 ? '+' : ''}${Number(p.cpoe).toFixed(1)}% CPOE`
    );
    if (s.rushing?.carries > 0) {
      parts.push(`${s.rushing.carries} carries for ${s.rushing.yards} rush yds (${s.rushing.tds} TD)`);
    }
  } else if (['RB', 'FB'].includes(pos) && (s.rushing?.carries > 0 || s.receiving?.targets > 0)) {
    if (s.rushing?.carries > 0) {
      parts.push(
        `${s.rushing.carries} carries for ${s.rushing.yards} yds, ${s.rushing.tds} rush TD (${s.rushing.epa >= 0 ? '+' : ''}${Number(s.rushing.epa).toFixed(1)} rush EPA)`
      );
    }
    if (s.receiving?.targets > 0) {
      parts.push(`${s.receiving.receptions}/${s.receiving.targets} rec for ${s.receiving.yards} yds`);
    }
  } else if (['WR', 'TE'].includes(pos) && s.receiving?.targets > 0) {
    const r = s.receiving;
    parts.push(
      `${r.receptions} catches on ${r.targets} targets for ${r.yards} yds, ${r.tds} TD, ${r.epa >= 0 ? '+' : ''}${Number(r.epa).toFixed(1)} receiving EPA, ${r.targetSharePct}% target share, ${r.airYardsSharePct}% air-yards share, ${r.firstDowns} first downs`
    );
  } else if (['DE', 'DT', 'DL', 'EDGE', 'NT', 'LB', 'ILB', 'OLB', 'CB', 'S', 'FS', 'SS', 'DB'].includes(pos)) {
    const d = s.defense || {};
    if (d.totalTackles > 0 || d.sacks > 0 || d.ints > 0 || d.passDefended > 0) {
      parts.push(
        `${d.totalTackles} tackles (${d.tfl || 0} TFL), ${d.sacks || 0} sacks, ${d.qbHits || 0} QB hits, ${d.passDefended || 0} PBU, ${d.ints || 0} INT, ${d.forcedFumbles || 0} FF`
      );
    }
  } else if (['K', 'PK', 'P'].includes(pos) && s.kicking) {
    const k = s.kicking;
    if (k.fgAtt > 0) parts.push(`${k.fgMade}/${k.fgAtt} FG (${k.fgPct}%, long ${k.fgLong})`);
    if (k.punts > 0) parts.push(`${k.punts} punts (${k.puntInside20} inside-20)`);
  }

  if (parts.length === 0 && s.games > 0) {
    parts.push(`${s.games} games played in 2026`);
  }
  return parts.length > 0 ? parts.join('; ') : null;
}

function summarizeSpokenStatHighlight(player) {
  const s = player?.stats2026;
  if (!s) return '';
  const pos = String(player?.position || '').toUpperCase();
  if (pos === 'QB' && s.passing?.attempts > 0) {
    const p = s.passing;
    return `${p.yards} passing yards, ${p.tds} touchdowns to ${p.ints} interceptions, and ${p.epa >= 0 ? '+' : ''}${Number(p.epa).toFixed(1)} passing EPA`;
  }
  if (['RB', 'FB'].includes(pos) && s.rushing?.carries > 0) {
    const r = s.rushing;
    return `${r.yards} rushing yards and ${r.tds} touchdowns on ${r.carries} carries`;
  }
  if (['WR', 'TE'].includes(pos) && s.receiving?.targets > 0) {
    const r = s.receiving;
    const tdPart = r.tds > 0 ? `, ${r.tds} ${r.tds === 1 ? 'touchdown' : 'touchdowns'},` : '';
    return `${r.receptions} catches for ${r.yards} yards${tdPart} and ${r.epa >= 0 ? '+' : ''}${Number(r.epa).toFixed(1)} receiving EPA`;
  }
  if (['DE', 'DT', 'DL', 'EDGE', 'NT', 'LB', 'ILB', 'OLB', 'CB', 'S', 'FS', 'SS', 'DB'].includes(pos)) {
    const d = s.defense || {};
    if (d.sacks > 0 || d.totalTackles > 0) {
      return `${d.totalTackles} tackles${d.sacks ? ` and ${d.sacks} sacks` : ''}${d.passDefended ? ` with ${d.passDefended} pass breakups` : ''}`;
    }
  }
  return '';
}

export function normalizeDisplayTopic(rawQuery = '') {
  return String(rawQuery || '')
    .trim()
    .replace(/\brecievers\b/gi, 'receivers')
    .replace(/\breciever\b/gi, 'receiver');
}

const COMMON_ENGLISH_SURNAME_STOPLIST = new Set([
  'ward',
  'cook',
  'west',
  'long',
  'hill',
  'king',
  'reed',
  'hall',
  'gray',
  'wood',
  'park',
  'white',
  'green',
  'brown',
  'young',
  'scott',
  'stout',
  'height',
  'bell',
  'ford',
  'grant',
  'james',
  'miles',
  'price',
  'smith',
  'stone'
]);

function escapeRegexLiteral(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseTopicIntent(rawQuery = '', appData = {}) {
  const q = String(rawQuery || '').trim();
  const qLower = q.toLowerCase();
  const players = appData?.roster?.players || [];

  const surnameCounts = new Map();
  for (const p of players) {
    const cleanParts = String(p.name || '')
      .toLowerCase()
      .replace(/\b(jr\.?|sr\.?|ii|iii|iv|v)\b/g, '')
      .trim()
      .split(/\s+/);
    const last = cleanParts[cleanParts.length - 1] || '';
    if (last) surnameCounts.set(last, (surnameCounts.get(last) || 0) + 1);
  }

  const matchedGroups = POSITION_GROUP_DEFINITIONS.filter(g => g.regex.test(qLower));
  const explicitlyNamedPlayers = players.filter(p => {
    const full = String(p.name || '').toLowerCase().trim();
    const strippedFull = full.replace(/\s+\b(jr\.?|sr\.?|ii|iii|iv|v)\b$/g, '').trim();
    const parts = strippedFull.split(/\s+/);
    const last = parts[parts.length - 1] || '';
    if (
      (full && new RegExp(`\\b${escapeRegexLiteral(full)}\\b`, 'i').test(qLower)) ||
      (strippedFull.length >= 6 && new RegExp(`\\b${escapeRegexLiteral(strippedFull)}\\b`, 'i').test(qLower))
    ) {
      return true;
    }
    const isDistinctiveSurname =
      !COMMON_ENGLISH_SURNAME_STOPLIST.has(last) &&
      (last.length >= 5 || (last.length === 4 && surnameCounts.get(last) === 1));
    if (isDistinctiveSurname && new RegExp(`\\b${escapeRegexLiteral(last)}\\b`, 'i').test(qLower)) {
      return true;
    }
    return false;
  });

  const disallowedAsked = getDisallowedFormer49ers(players).filter(nm =>
    qLower.includes(nm.toLowerCase())
  );

  const isTrade = /\b(trade|deadline|seller|buyer|target|acquire|rental|fit)\b/i.test(qLower);
  const isCap = /\b(cap|contract|salary|restructure|rollover|dead\s*money|overthecap|extension|cut)\b/i.test(qLower);
  const isDraft = /\b(draft|2027\s*picks?|prospect|combine|tankathon|mock)\b/i.test(qLower);
  const isPlayoffs = /\b(playoff|seed|bye|nfc|standings|monte\s*carlo|odds|tiebreaker)\b/i.test(qLower);
  const isHealth = /\b(injur(?:y|ies)|health|ir|practice\s*report|questionable|return\s*timeline)\b/i.test(qLower);
  const oppName = appData?.scheduleMatchup?.upcomingMatchup?.oppName || '';
  const oppMascot = oppName.split(' ').slice(-1)[0]?.toLowerCase() || '';
  const isMatchup =
    (oppMascot && qLower.includes(oppMascot)) ||
    /\b(matchup|game\s*plan|preview|week\s*\d+|raiders|seahawks|rams|cardinals|vikings|packers|chiefs|lions)\b/i.test(
      qLower
    );

  return {
    rawQuery: q,
    matchedGroups,
    explicitlyNamedPlayers,
    disallowedAsked,
    isTrade,
    isCap,
    isDraft,
    isPlayoffs,
    isHealth,
    isMatchup
  };
}

/**
 * Compiles a structured Stage-1 Deep Research Dossier across all live 2026 49ers datasets
 * plus optional live network search items (ESPN / Bluesky beat wire).
 */
export function compileDeepResearchDossier({ query = '', appData = {}, liveSearchItems = [] } = {}) {
  const intent = parseTopicIntent(query, appData);
  const allPlayers = appData?.roster?.players || [];
  const targetPositions = new Set();
  for (const g of intent.matchedGroups) {
    for (const p of g.positions) targetPositions.add(p);
  }

  let roomPlayers = [];
  if (targetPositions.size > 0) {
    roomPlayers = allPlayers.filter(p => targetPositions.has(String(p.position || '').toUpperCase()));
  }
  for (const ep of intent.explicitlyNamedPlayers) {
    if (!roomPlayers.some(x => x.id === ep.id || x.name === ep.name)) {
      roomPlayers.unshift(ep);
    }
  }

  // If query didn't specify a single position group, pull top focal contributors across roster
  if (roomPlayers.length === 0) {
    roomPlayers = allPlayers
      .filter(p => p.rosterBucket === 'active')
      .sort((a, b) => (b.primarySnapPct || 0) - (a.primarySnapPct || 0))
      .slice(0, 10);
  }

  const activeHealthy = roomPlayers
    .filter(p => p.rosterBucket === 'active' && !['Out', 'Doubtful'].includes(p.health?.status))
    .sort((a, b) => (b.primarySnapPct || 0) - (a.primarySnapPct || 0));

  const activeSidelined = roomPlayers
    .filter(p => p.rosterBucket === 'active' && ['Out', 'Doubtful'].includes(p.health?.status))
    .sort((a, b) => (b.primarySnapPct || 0) - (a.primarySnapPct || 0));

  const irAndReserve = roomPlayers.filter(p => p.rosterBucket === 'ir');
  const practiceSquad = roomPlayers.filter(p => p.rosterBucket === 'practice_squad');

  const enrichPlayer = p => {
    const c26 = p.contractsByYear?.['2026'];
    const c27 = p.contractsByYear?.['2027'];
    return {
      name: p.name,
      position: p.position,
      jersey: p.jersey,
      rosterBucket: p.rosterBucket,
      snapPct: p.primarySnapPct || 0,
      ras: p.spiderProfile?.compositeRas ?? null,
      statLine: summarizePlayer2026Stats(p),
      spokenStat: summarizeSpokenStatHighlight(p),
      healthStatus: p.health?.status || 'Active',
      injuryType: p.health?.injuryType || '',
      playBadge: p.health?.playBadgeLabel || '',
      playProb: p.health?.playProbabilityPct ?? null,
      beatNote: p.health?.longComment || p.health?.shortComment || p.publicEfficiencyNote || '',
      cap2026: c26?.capNumber ?? null,
      base2026: c26?.baseSalary ?? null,
      restructure2026: c26?.transactions?.restructure?.capSavings ?? null,
      cap2027: c27?.capNumber ?? null
    };
  };

  const activeHealthyDossiers = activeHealthy.map(enrichPlayer);
  const activeSidelinedDossiers = activeSidelined.map(enrichPlayer);
  const irReserveDossiers = irAndReserve.map(enrichPlayer);
  const psDossiers = practiceSquad.map(enrichPlayer);

  // Match relevant trade targets
  const tw = appData?.seasonal?.tradeWarRoom || {};
  const allTargets = tw.realisticTargets || [];
  const relevantTradeTargets =
    targetPositions.size > 0
      ? allTargets.filter(t => {
          const tp = String(t.position || '').toUpperCase();
          return (
            targetPositions.has(tp) ||
            (targetPositions.has('OL') && /OG|OT|OL|G|T|C/.test(tp)) ||
            (targetPositions.has('DL') && /DE|DT|EDGE|DL/.test(tp)) ||
            (targetPositions.has('DB') && /CB|S|DB/.test(tp))
          );
        })
      : allTargets.slice(0, 4);

  // Match relevant news & live beat posts
  const keywords = String(query || '')
    .toLowerCase()
    .replace(/\breciever/g, 'receiver')
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !['the', 'and', 'for', 'about', 'with', 'how', 'are', 'min', 'pod', 'podcast'].includes(w));
  for (const p of roomPlayers.slice(0, 6)) {
    const last = p.name.split(' ').slice(-1)[0]?.toLowerCase();
    if (last && last.length >= 4) keywords.push(last);
  }

  const staticFeedItems = [
    ...(appData?.news?.clusteredBriefs || []),
    ...(appData?.news?.rawStream || []),
    ...(appData?.news?.articles || []),
    ...(appData?.news?.socialPosts || [])
  ];
  const seenNewsKeys = new Set();
  const matchedNews = [...liveSearchItems, ...staticFeedItems]
    .map(item => {
      const hay = `${item.headline || ''} ${item.title || ''} ${item.summary || ''} ${item.text || ''}`.toLowerCase();
      const kwHits =
        keywords.length === 0
          ? 1
          : keywords.reduce((cnt, kw) => (hay.includes(kw) ? cnt + 1 : cnt), 0);
      const salience =
        kwHits * 18 +
        Number(item.signalScore || 68) +
        (item.isInGameInjury ? 24 : item.isBreaking ? 14 : 0);
      return { item, kwHits, salience, dedupeKey: (item.headline || item.title || item.text || '').toLowerCase().slice(0, 72) };
    })
    .filter(row => {
      if (row.kwHits <= 0 || !row.dedupeKey || seenNewsKeys.has(row.dedupeKey)) return false;
      seenNewsKeys.add(row.dedupeKey);
      return true;
    })
    .sort((a, b) => b.salience - a.salience)
    .slice(0, 8)
    .map(row => row.item);

  const cap26 = appData?.cap?.years?.['2026'] || {};
  const cap27 = appData?.cap?.years?.['2027'] || {};
  const matchup = appData?.scheduleMatchup?.upcomingMatchup || {};
  const sfOdds = appData?.seasonal?.playoffPicture?.baselineSimulation?.sfOdds || {};
  const dp = appData?.seasonal?.draftPrep2027 || {};

  // Build text summary for LLM prompts or grounding logs
  const summaryLines = [
    `DEEP RESEARCH DOSSIER FOR TOPIC: "${query}"`,
    `Primary Focus: ${intent.matchedGroups.map(g => g.label).join(', ') || 'Full-Team 49ers Roster, Scheme & Cap Synthesis'}`,
    `Team Standing: ${appData?.meta?.teamRecord || '6-1'} (${appData?.meta?.standingSummary || '1st NFC West'}) | Week ${matchup.week || appData?.meta?.currentWeek || 9} vs. ${matchup.oppName || 'Opponent'} (${matchup.betting?.spread || 'SF favored'})`,
    `Active Available Contributors (${activeHealthyDossiers.length}):`,
    ...activeHealthyDossiers.map(
      d =>
        `  - ${d.name} (${d.position} #${d.jersey ?? '—'}): ${d.snapPct}% snaps | Status: ${d.healthStatus} (${d.playBadge}) | 2026 Stats: ${d.statLine || 'Rotational role'} | 2026 Cap: ${d.cap2026 ? formatCompactDollars(d.cap2026) : 'Min/Rookie'} ${d.beatNote ? `| Beat Note: ${d.beatNote}` : ''}`
    )
  ];

  if (activeSidelinedDossiers.length > 0) {
    summaryLines.push(
      `Active-53 Players Ruled Out / Sidelined This Week (${activeSidelinedDossiers.length}):`,
      ...activeSidelinedDossiers.map(
        d =>
          `  - ${d.name} (${d.position}): ${d.healthStatus} (${d.injuryType || 'Injury'}) | 2026 Stats prior to injury: ${d.statLine || '—'} | Beat Note: ${d.beatNote}`
      )
    );
  }

  if (irReserveDossiers.length > 0) {
    summaryLines.push(
      `Injured Reserve & Reserve List Players in Unit (${irReserveDossiers.length}):`,
      ...irReserveDossiers.map(
        d => `  - ${d.name} (${d.position}): ${d.healthStatus}${d.injuryType ? ` (${d.injuryType})` : ''}${d.cap2026 ? ` | 2026 Cap: ${formatCompactDollars(d.cap2026)}` : ''}`
      )
    );
  }

  if (psDossiers.length > 0) {
    summaryLines.push(
      `Practice Squad Call-Up Depth (${psDossiers.length}): ${psDossiers.map(d => `${d.name} (${d.position})`).join(', ')}`
    );
  }

  if (relevantTradeTargets.length > 0) {
    summaryLines.push(
      `Verified External Trade Targets (${relevantTradeTargets.length}):`,
      ...relevantTradeTargets.map(
        t =>
          `  - ${t.name} (${t.position}, ${t.currentTeam || ''}): Fit ${t.fitScore}/100, Est. Cost ${t.projectedPickCost}, 2026 Buyer Proration ${t.acquiring2026CapHit || formatCompactDollars(t.prorated2026CapCharge)}. ${t.fitBreakdown || ''}`
      )
    );
  }

  if (matchedNews.length > 0) {
    summaryLines.push(
      `Recent Beat Wire & Reporting Signals (${matchedNews.length}):`,
      ...matchedNews.map(
        n => `  - [${n.author || n.outlet || 'Beat Wire'}]: ${(n.title || n.text || n.summary || '').slice(0, 220)}`
      )
    );
  }

  summaryLines.push(
    `Multi-Year CBA Cap & Draft Context: 2026 Top-51 Cap Space ${formatCompactDollars(cap26.teamCapSpace || 35_164_858)} (9/18ths midseason trade proration), 2027 Projected Cap Space ${formatCompactDollars(cap27.teamCapSpace ?? -31_540_066)} requiring CBA Article 13 rollover; ${dp.pickInventory?.length || 6} total 2027 draft picks.`
  );

  return {
    intent,
    primaryGroup: intent.matchedGroups[0] || null,
    activeHealthy: activeHealthyDossiers,
    activeSidelined: activeSidelinedDossiers,
    irReserve: irReserveDossiers,
    practiceSquad: psDossiers,
    relevantTradeTargets,
    matchedNews,
    cap26,
    cap27,
    matchup,
    sfOdds,
    draftPrep: dp,
    dossierSummaryText: summaryLines.join('\n')
  };
}

function countWords(text = '') {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function cleanSentence(s = '') {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Stage 2: NotebookLM-Style Conversational Audio Overview Script Builder.
 * Produces natural human studio dialogue calibrated accurately to `durationMinutes`
 * (~146 words per minute of spoken neural audio, so 3m -> ~438 words / ~3:00 duration).
 */
export function buildNotebookLmPodcastScript({
  query = '',
  durationMinutes = 3,
  format = 'two_host',
  appData = {},
  dossier = null
} = {}) {
  const cleanTopic = normalizeDisplayTopic(query) || 'San Francisco 49ers';
  const d = dossier || compileDeepResearchDossier({ query: cleanTopic, appData });
  const mins = Math.max(2, Math.min(20, Number(durationMinutes || 3)));
  const targetWords = Math.round(mins * 146);
  const solo = format === 'solo';
  const rec = appData?.meta?.teamRecord || '6-1';
  const curWk = d.matchup?.week || appData?.meta?.currentWeek || 9;
  const oppName = d.matchup?.oppName || 'Las Vegas Raiders';
  const spread = d.matchup?.betting?.spread || 'SF -9.5';
  const groupLabel = d.primaryGroup?.label || cleanTopic;
  const cap26M = ((d.cap26?.teamCapSpace || 35_164_858) / 1_000_000).toFixed(2);
  const cap27DefM = Math.abs((d.cap27?.teamCapSpace ?? -31_540_066) / 1_000_000).toFixed(2);
  const pickCount = d.draftPrep?.pickInventory?.length || 6;

  // Build ordered pool of rich, non-repetitive conversational modules from the Deep Research Dossier
  const candidateModules = [];

  // Module 1: Cold Open & Big-Picture Framing
  candidateModules.push([
    {
      speaker: 'Marcus',
      text: solo
        ? `Welcome in to 49ers Faithful. Today we're doing a deep-dive ${mins}-minute briefing on ${cleanTopic}—pulling straight from the live 2026 fifty-three-man ledger, nflverse play-by-play EPA, practice participation, and OverTheCap's multi-year books.`
        : `Welcome in to 49ers Faithful. Elena, we just wrapped our deep research pass on ${cleanTopic}, and with the Niners sitting at ${rec} coming into Week ${curWk} against the ${oppName}, there's a ton moving underneath the surface right now.`
    },
    {
      speaker: solo ? 'Marcus' : 'Elena',
      text:
        d.activeSidelined.length > 0 || d.irReserve.length > 0
          ? `There really is, Marcus. On paper people see San Francisco holding the one seed in the NFC, but when you open up the ${groupLabel.toLowerCase()} depth chart, injuries and reserve designations have completely reshaped who's actually taking snaps on Sunday.`
          : `That's right. When you cross-check our live snap shares with expected points added and the 2027 salary cap horizon, the picture is way more nuanced than standard box-score talk.`
    }
  ]);

  // If user asked about a retired/departed former 49er, address immediately
  if (d.intent.disallowedAsked.length > 0) {
    candidateModules.push([
      {
        speaker: 'Marcus',
        text: `First, quick roster housekeeping—${d.intent.disallowedAsked.join(' and ')} ${
          d.intent.disallowedAsked.length === 1 ? 'is' : 'are'
        } no longer on the live 2026 San Francisco roster, so we're focusing strictly on the active contributors and reserve timelines actually in the building.`
      }
    ]);
  }

  // Module 2: Sidelined Starters & Injury / IR Reality in the Room
  if (d.activeSidelined.length > 0 || d.irReserve.length > 0) {
    const sidelinedSummary = d.activeSidelined
      .slice(0, 3)
      .map(p => {
        const st = p.spokenStat ? `—who's given us ${p.spokenStat}—` : '';
        return `${p.name}${st}is ruled ${p.healthStatus.toLowerCase()} dealing with ${p.injuryType ? p.injuryType.toLowerCase() : 'an injury'}`;
      })
      .join(', while ');

    const irNames = d.irReserve
      .slice(0, 4)
      .map(p => `${p.name} on ${p.healthStatus}`)
      .join(', ');

    if (sidelinedSummary) {
      candidateModules.push([
        {
          speaker: 'Marcus',
          text: `Let's start with availability, because that's the headline from the practice report. Right now ${sidelinedSummary}.`
        },
        {
          speaker: solo ? 'Marcus' : 'Elena',
          text: irNames
            ? `And stack that on top of ${irNames}. That's a massive chunk of target and snap volume that Kyle Shanahan has to redistribute in a single game plan.`
            : `Exactly, and missing that kind of proven efficiency forces everyone else in the rotation up a full tier against top coverage looks.`
        }
      ]);
    } else if (irNames) {
      candidateModules.push([
        {
          speaker: 'Marcus',
          text: `Availability is a huge part of this room's story right now, with ${irNames} all unavailable on the reserve ledger.`
        }
      ]);
    }
  }

  // Module 3: Active Available Contributors & Film/Statistical Breakdown
  if (d.activeHealthy.length > 0) {
    const lead = d.activeHealthy[0];
    const second = d.activeHealthy[1];
    const rest = d.activeHealthy.slice(2, 5);

    candidateModules.push([
      {
        speaker: 'Marcus',
        text: `So let's look at who's healthy and carrying the load right now. ${lead.name} is logging a ${lead.snapPct} percent snap share${
          lead.spokenStat ? `, posting ${lead.spokenStat}` : ''
        }.${lead.beatNote ? ` ${cleanSentence(lead.beatNote.split('.')[0])}.` : ''}`
      },
      ...(second
        ? [
            {
              speaker: solo ? 'Marcus' : 'Elena',
              text: `And right alongside ${lead.name.split(' ')[0]}, ${second.name} is playing ${second.snapPct} percent of snaps${
                second.spokenStat ? ` with ${second.spokenStat}` : ''
              }.${
                rest.length > 0
                  ? ` Behind those two, ${rest.map(x => `${x.name} at ${x.snapPct} percent`).join(', ')} round out the active game-day rotation.`
                  : ''
              }`
            }
          ]
        : [])
    ]);
  }

  // Module 4: Scheme Mechanics & Quarterback / Coordinator Synergy
  const purdy = (appData?.roster?.players || []).find(p => p.name === 'Brock Purdy');
  const kittle = (appData?.roster?.players || []).find(p => p.name === 'George Kittle');
  const cmc = (appData?.roster?.players || []).find(p => p.name === 'Christian McCaffrey');
  const schemeText =
    d.primaryGroup?.schemeNote ||
    "Kyle Shanahan's condensed splits and Raheem Morris's disguised split-safety rotations dictate how San Francisco wins leverage on third down.";

  candidateModules.push([
    {
      speaker: 'Marcus',
      text: `Put on the All-22 tape and see how this fits the scheme. ${schemeText}`
    },
    {
      speaker: solo ? 'Marcus' : 'Elena',
      text:
        d.primaryGroup?.id === 'WR'
          ? `Right, and look at how Brock Purdy's ${
              purdy?.stats2026?.passing?.epa ? `+${Number(purdy.stats2026.passing.epa).toFixed(1)}` : '+63.2'
            } passing EPA interacts with that. When perimeter wideouts are banged up, George Kittle commands a ${
              kittle?.stats2026?.receiving?.targetSharePct ?? 22.4
            } percent target share over the middle and Christian McCaffrey absorbs ${
              cmc?.stats2026?.receiving?.targetSharePct ?? 20.5
            } percent on choice routes—forcing safeties down so healthy wideouts get cleaner glances and deep overs.`
          : `And the numbers back up the tape. Brock Purdy sits at +${
              purdy?.stats2026?.passing?.epa ? Number(purdy.stats2026.passing.epa).toFixed(1) : '63.2'
            } passing EPA with a +${
              purdy?.stats2026?.passing?.cpoe ? Number(purdy.stats2026.passing.cpoe).toFixed(1) : '4.2'
            } percent completion rate over expected because every unit stays married to run-action leverage.`
    }
  ]);

  // Module 5: Salary Cap, Contracts & 2026 -> 2027 Article 13 Rollover Math
  const capPlayers = [...d.activeHealthy, ...d.activeSidelined, ...d.irReserve].filter(p => p.cap2026);
  const capPlayerDetail =
    capPlayers.length > 0
      ? `Inside this group, ${capPlayers
          .slice(0, 3)
          .map(p => `${p.name} carries a ${formatCompactDollars(p.cap2026)} cap charge in 2026`)
          .join(', ')}. `
      : '';

  candidateModules.push([
    {
      speaker: solo ? 'Marcus' : 'Elena',
      text: `Now let's connect the OverTheCap ledger, because every roster decision right now is really a two-year equation. ${capPlayerDetail}Team-wide, San Francisco holds $${cap26M}M in 2026 Top-51 space, which gives John Lynch huge 9/18ths midseason base-salary flexibility—but we're staring at a projected -$${cap27DefM}M cap deficit in 2027.`
    },
    {
      speaker: 'Marcus',
      text: `Hold on—underscore that point for everyone listening. Because of CBA Article 13 rollover, every dollar we don't spend right now carries straight into 2027 to erase that deficit, and we only own ${pickCount} total picks in the 2027 draft after sending our fourth-rounder to Indy for DeForest Buckner.`
    }
  ]);

  // Module 6: External Trade Fits & Practice Squad Elevations
  if (d.relevantTradeTargets.length > 0 || d.practiceSquad.length > 0) {
    const tList = d.relevantTradeTargets
      .slice(0, 3)
      .map(
        t =>
          `${t.name} from ${t.currentTeam || 'a seller roster'} at a ${t.projectedPickCost || 'Day 3'} cost`
      )
      .join(', ');
    const psList = d.practiceSquad.map(p => p.name).join(', ');

    candidateModules.push([
      {
        speaker: solo ? 'Marcus' : 'Elena',
        text: tList
          ? `That's why if the front office looks outside the building before the deadline, discipline is everything. Our highest-graded realistic fits here are cost-controlled targets like ${tList}—players whose remaining 2026 base proration stays tiny without wrecking our 2027 books.`
          : `That's why internal development and smart practice-squad elevations matter so much before burning scarce 2027 draft capital.`
      },
      ...(psList
        ? [
            {
              speaker: 'Marcus',
              text: `And internally on the practice squad, keep an eye on ${psList} as game-day standard elevation options if snap counts get tight.`
            }
          ]
        : [])
    ]);
  }

  // Module 7: Upcoming Matchup Tactical Application
  const trenchKey =
    d.matchup?.keyMatchupsMatrix?.[0]?.tacticalDetail ||
    `Against the ${oppName} at ${spread}, staying ahead of the chains on first down neutralizes pass-rush ears pinning back.`;

  candidateModules.push([
    {
      speaker: 'Marcus',
      text: `Looking straight ahead to Week ${curWk} against the ${oppName} with the line sitting at ${spread}: ${cleanSentence(
        trenchKey
      )}`
    }
  ]);

  // Module 8: Extended Deep-Dive Player-by-Player & Playoff Leverage Modules (for 5m–20m podcasts!)
  const extraPlayers = [...d.activeHealthy.slice(2), ...d.activeSidelined, ...d.irReserve];
  for (let i = 0; i < extraPlayers.length; i++) {
    const ep = extraPlayers[i];
    const statPhrase = ep.statLine ? ` with ${ep.statLine}` : '';
    const notePhrase = ep.beatNote ? ` ${cleanSentence(ep.beatNote.split('.').slice(0, 2).join('.'))}.` : '';
    candidateModules.push([
      {
        speaker: i % 2 === 0 ? 'Marcus' : solo ? 'Marcus' : 'Elena',
        text: `Going deeper down the sheet on ${ep.name}: listed at ${ep.position} in the ${ep.rosterBucket.replace('_', ' ')} group at ${ep.snapPct} percent snaps and ${ep.healthStatus} status${statPhrase}.${notePhrase}`
      }
    ]);
  }

  // Module 9: Calibrated 10,000-Run Playoff & Seeding Context (for longer pods or playoff topics)
  candidateModules.push([
    {
      speaker: solo ? 'Marcus' : 'Elena',
      text: `Zooming out to the NFC playoff race across ten thousand calibrated simulations: San Francisco projects for ${
        d.sfOdds?.projectedWins ?? 12.0
      } wins, a ${d.sfOdds?.makePlayoffsPct ?? 93.0} percent playoff berth, ${
        d.sfOdds?.winDivisionPct ?? 82.6
      } percent to take the NFC West, and a ${
        d.sfOdds?.seed1ByePct ?? 34.5
      } percent shot at the number-one seed bye—making every single week of health management crucial.`
    }
  ]);

  // Closing Turn (always included!)
  const closingTurn = {
    speaker: 'Marcus',
    text: solo
      ? `Bottom line for the Faithful: watch snap distribution, early-down efficiency, and how Kyle Shanahan and John Lynch balance win-now execution with that 2027 cap horizon. Thanks for listening to 49ers Faithful.`
      : `That's the whole puzzle—balancing Sunday execution at ${rec} with smart long-term cap and health discipline. Great breakdown as always, Elena, and thanks for tuning in to 49ers Faithful.`
  };

  const closingWords = countWords(closingTurn.text);
  const selectedTurns = [];
  let runningWords = 0;

  // Greedily include modules until we hit targetWords (minus closingTurn)
  for (const mod of candidateModules) {
    const modWords = mod.reduce((s, t) => s + countWords(t.text), 0);
    if (selectedTurns.length >= 4 && runningWords + modWords + closingWords > targetWords * 1.07) {
      // Check if taking just the first turn of this module gets us closer to targetWords
      const firstWords = countWords(mod[0].text);
      if (runningWords + firstWords + closingWords <= targetWords * 1.08) {
        selectedTurns.push(mod[0]);
        runningWords += firstWords;
      }
      continue;
    }
    for (const t of mod) {
      selectedTurns.push(t);
      runningWords += countWords(t.text);
    }
    if (runningWords + closingWords >= targetWords * 0.94) {
      break;
    }
  }

  // If durationMinutes is very long (e.g. 10–20 min) and we still need more analytical depth,
  // add remaining schedule, blueprint restructure & draft capital breakdowns without repetition
  if (runningWords + closingWords < targetWords * 0.9) {
    const upcoming = (appData?.scheduleMatchup?.schedule || []).filter(g => !g.completed);
    for (let i = 0; i < upcoming.length && runningWords + closingWords < targetWords * 0.94; i++) {
      const g = upcoming[i];
      const opp = g.opponent?.name || g.opponent?.abbr || 'Opponent';
      const turnText = `Looking ahead to Week ${g.week} ${
        g.homeAway === 'home' ? "at Levi's Stadium against" : 'on the road against'
      } the ${opp}, how this ${groupLabel.toLowerCase()} unit holds up in four-minute offense, third-and-medium spacing, and red-zone leverage will directly swing NFC tiebreakers down the stretch.`;
      selectedTurns.push({
        speaker: selectedTurns.length % 2 === 0 ? 'Marcus' : solo ? 'Marcus' : 'Elena',
        text: turnText
      });
      runningWords += countWords(turnText);
    }

    const restructures = appData?.cap?.blueprint?.restructureCandidates || [];
    for (let i = 0; i < restructures.length && runningWords + closingWords < targetWords * 0.94; i++) {
      const r = restructures[i];
      const turnText = `On the multi-year cap blueprint side, ${r.name} at ${r.position} carries a ${formatCompactDollars(
        r.capHit2026
      )} cap number with up to ${formatCompactDollars(
        r.maxRestructureSavings
      )} in simple restructure conversion capacity if San Francisco needs extra flexibility entering next March.`;
      selectedTurns.push({
        speaker: selectedTurns.length % 2 === 0 ? 'Marcus' : solo ? 'Marcus' : 'Elena',
        text: turnText
      });
      runningWords += countWords(turnText);
    }
  }

  // Fix consecutive identical speakers in two_host mode so dialogue alternates naturally
  if (!solo) {
    for (let i = 1; i < selectedTurns.length; i++) {
      if (selectedTurns[i].speaker === selectedTurns[i - 1].speaker) {
        selectedTurns[i] = {
          ...selectedTurns[i],
          speaker: selectedTurns[i - 1].speaker === 'Marcus' ? 'Elena' : 'Marcus'
        };
      }
    }
    if (selectedTurns[selectedTurns.length - 1]?.speaker === 'Marcus') {
      closingTurn.speaker = 'Elena';
      closingTurn.text = `That's the exact balance—maximizing every matchup at ${rec} while keeping the 2027 books clean. Awesome film and cap walk-through, Marcus, and thanks to everyone listening on 49ers Faithful.`;
    }
  }

  selectedTurns.push(closingTurn);
  return selectedTurns;
}

/**
 * Stage 2/3 (Text Analysis Mode): Builds a thorough, multi-section Deep Scouting & Cap Report
 * grounded 100% in the Stage-1 Deep Research Dossier.
 */
export function buildDeepScoutingAnalysisMarkdown({
  query = '',
  appData = {},
  dossier = null
} = {}) {
  const d = dossier || compileDeepResearchDossier({ query, appData });
  const rec = appData?.meta?.teamRecord || '6-1';
  const curWk = d.matchup?.week || appData?.meta?.currentWeek || 9;
  const oppName = d.matchup?.oppName || 'Opponent';
  const groupTitle = d.primaryGroup?.label || '49ers Roster & Tactical';
  const sections = [];

  sections.push(`### Deep Research & Scouting Dossier: ${query}`);

  if (d.intent.disallowedAsked.length > 0) {
    const activeDl = (appData?.roster?.players || [])
      .filter(p => p.rosterBucket === 'active' && ['DE', 'DT', 'DL', 'EDGE'].includes(p.position))
      .map(p => p.name)
      .slice(0, 6)
      .join(', ');
    sections.push(
      `#### Live Roster Grounding Verification\n* **Status Check**: ${d.intent.disallowedAsked
        .map(n => `**${n}**`)
        .join(', ')} ${
        d.intent.disallowedAsked.length === 1 ? 'is' : 'are'
      } **not** on the live ${
        appData?.meta?.seasonYear || 2026
      } San Francisco 49ers 53-man, Injured Reserve, or Practice Squad roster (retired/departed). Active front-line contributors include **${
        activeDl || 'Nick Bosa, DeForest Buckner, Osa Odighizuwa, Keion White, Mykel Williams'
      }**.`
    );
  }

  // Section 1: Executive Summary
  sections.push(
    `#### 1. Executive Situational Thesis (${rec} • Week ${curWk} vs. ${oppName})\n` +
      `* **Unit Snapshot (${groupTitle})**: **${d.activeHealthy.length}** active available game-day contributors, **${d.activeSidelined.length}** active-53 players ruled Out/Doubtful this week, **${d.irReserve.length}** on Injured Reserve / Reserve lists, and **${d.practiceSquad.length}** on Practice Squad.\n` +
      (d.primaryGroup?.schemeNote ? `* **Scheme Identity**: ${d.primaryGroup.schemeNote}` : '')
  );

  // Section 2: Active Available Contributors
  if (d.activeHealthy.length > 0) {
    const activeBullets = d.activeHealthy.slice(0, 8).map(p => {
      const capStr = p.cap2026 ? `2026 Cap \`${formatCompactDollars(p.cap2026)}\`` : `Bucket \`${p.rosterBucket}\``;
      const rasStr = p.ras != null ? ` • RAS \`${p.ras}/10\`` : '';
      const statStr = p.statLine ? ` • **2026 Production**: ${p.statLine}` : '';
      const noteStr = p.beatNote ? ` — *${cleanSentence(p.beatNote.split('.')[0])}.*` : '';
      return `* **${p.name} (#${p.jersey ?? '—'}, ${p.position})**: \`${p.snapPct}%\` snaps${rasStr} • ${capStr} • Health \`${p.playBadge || p.healthStatus}\`${statStr}${noteStr}`;
    });
    sections.push(`#### 2. Active Available Rotation & 2026 Efficiency\n${activeBullets.join('\n')}`);
  }

  // Section 3: Sidelined / IR / Practice Squad Impact
  if (d.activeSidelined.length > 0 || d.irReserve.length > 0 || d.practiceSquad.length > 0) {
    const healthLines = [];
    for (const p of d.activeSidelined) {
      healthLines.push(
        `* **[Active-53 Sidelined] ${p.name} (${p.position})**: \`${p.healthStatus}\` (${p.injuryType || 'Injury'})${
          p.statLine ? ` • Pre-injury 2026 line: ${p.statLine}` : ''
        }.${p.beatNote ? ` ${cleanSentence(p.beatNote)}` : ''}`
      );
    }
    for (const p of d.irReserve) {
      healthLines.push(
        `* **[Reserve / IR] ${p.name} (${p.position})**: \`${p.healthStatus}\`${
          p.injuryType ? ` (${p.injuryType})` : ''
        }${p.cap2026 ? ` • 2026 Cap Charge \`${formatCompactDollars(p.cap2026)}\`` : ''}.`
      );
    }
    if (d.practiceSquad.length > 0) {
      healthLines.push(
        `* **[Practice Squad Call-Up Candidates]**: ${d.practiceSquad
          .map(p => `**${p.name}** (${p.position})`)
          .join(', ')}.`
      );
    }
    sections.push(`#### 3. Injury, Reserve & Elevation Ledger\n${healthLines.join('\n')}`);
  }

  // Section 4: Multi-Year CBA Cap, Trade Fits & 2027 Horizon
  const cap26Space = Number(d.cap26?.teamCapSpace ?? 35_164_858);
  const cap27Space = Number(d.cap27?.teamCapSpace ?? -31_540_066);
  const postRollover2027 = cap27Space + Math.max(0, cap26Space);
  const capLines = [
    `* **2026 → 2027 CBA Rollover Bridge**: San Francisco holds \`${formatCompactDollars(
      cap26Space
    )}\` in 2026 Top-51 space (\`${formatCompactDollars(
      d.cap26?.effectiveCapSpace || 28_664_858
    )}\` effective), which provides >\`$65M\` in annualized midseason 9/18ths base-salary trade capacity—and converts a \`${formatCompactDollars(
      cap27Space
    )}\` nominal 2027 cap deficit into a **\`${formatCompactDollars(
      postRollover2027,
      true
    )}\` net 2027 post-rollover balance** under CBA Article 13.`,
    `* **2027 Draft Capital**: **${d.draftPrep?.pickInventory?.length || 6} total picks** (${
      d.draftPrep?.tradedPicksNote || '2027 Rd 4 traded to IND for DT DeForest Buckner'
    }).`
  ];
  for (const t of d.relevantTradeTargets.slice(0, 4)) {
    capLines.push(
      `* **External Fit — ${t.name} (${t.position}, ${t.currentTeam || 'Seller'})**: Fit \`${t.fitScore}/100\` • Est. Cost \`${t.projectedPickCost}\` • 2026 Buyer Proration \`${
        t.acquiring2026CapHit || formatCompactDollars(t.prorated2026CapCharge)
      }\`. ${t.fitBreakdown || ''}`
    );
  }
  sections.push(`#### 4. CBA Salary Cap, Trade Fits & 2027 Draft Guardrails\n${capLines.join('\n')}`);

  // Section 5: Live Beat Wire & Reporting Signals (when matched)
  if (d.matchedNews.length > 0) {
    const wireLines = d.matchedNews.slice(0, 4).map(n => {
      const src = n.outlet || n.author || n.reporterName || '49ers Beat Wire';
      const txt = cleanSentence(n.headline || n.title || n.summary || n.text || '').slice(0, 220);
      return `* **[${src}]**: ${txt}`;
    });
    sections.push(`#### 5. Verified Beat Wire & Live Reporting Signals\n${wireLines.join('\n')}`);
  }

  // Section 6: Matchup & Playoff Outlook
  const keyMatchup =
    d.matchup?.keyMatchupsMatrix?.[0]?.tacticalDetail ||
    'Leverage 21-personnel motion and four-man Wide-9 rush pressure to dictate third-down spacing.';
  const rawSpread = String(d.matchup?.betting?.spread || '');
  const rawOu = Number(d.matchup?.betting?.overUnder);
  const spreadNumMatch = rawSpread.match(/([+-]?\d+(?:\.\d+)?)/);
  let impliedScoreClause = '';
  if (spreadNumMatch && Number.isFinite(rawOu) && rawOu > 25) {
    const lineVal = Number(spreadNumMatch[1]);
    const sfFav = /sf/i.test(rawSpread) ? lineVal < 0 : lineVal > 0;
    const absSpread = Math.abs(lineVal);
    const sfImplied = ((rawOu + (sfFav ? absSpread : -absSpread)) / 2).toFixed(1);
    const oppImplied = ((rawOu - (sfFav ? absSpread : -absSpread)) / 2).toFixed(1);
    impliedScoreClause = ` • Implied Score \`SF ${sfImplied} – ${oppImplied}\``;
  }
  sections.push(
    `#### ${d.matchedNews.length > 0 ? '6' : '5'}. Week ${curWk} Matchup & Calibrated NFC Seeding Impact\n` +
      `* **Vs. ${oppName} (\`${d.matchup?.betting?.spread || 'SF Favored'}\`, O/U \`${
        d.matchup?.betting?.overUnder || '—'
      }\`${impliedScoreClause})**: ${keyMatchup}\n` +
      `* **10,000-Run Calibrated Simulation**: Projected \`${d.sfOdds?.projectedWins ?? 12.0} Wins\` • Playoff Berth \`${
        d.sfOdds?.makePlayoffsPct ?? 93.0
      }%\` • Win NFC West \`${d.sfOdds?.winDivisionPct ?? 82.6}%\` • **#1 Seed Bye \`${
        d.sfOdds?.seed1ByePct ?? 34.5
      }%\`**.`
  );

  return sections.join('\n\n');
}
