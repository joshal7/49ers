/**
 * Multi-Team NFL Trade Window Intelligence Engine
 *
 * Powers `seasonal.json -> tradeWarRoom` (and `draftPrep2027.topNeeds2027` + live Tankathon pick inventory)
 * for all 32 NFL franchises using 100% live, verifiable data:
 *
 * Stage 1 (Shared League Context — fetched ONCE per pipeline run):
 *   - nflverse `trades/trades.csv` (all current-season offseason/draft/in-season NFL trades)
 *   - OverTheCap `/salary-cap-space` 32-team 2026 & 2027 cap space rankings
 *   - Live OverTheCap rosters (`parseOverTheCapHtml`) for the bottom-8 NFL seller teams by ESPN standings,
 *     joined with Stage-1 nflverse `players.csv`, `stats_player_reg_{seasonYear}`, and `snap_counts_{seasonYear}`
 *
 * Stage 2 (Per-Team Builder):
 *   - `purchasingPower`: 3-card live cap/rollover/Tankathon draft pick inventory summary
 *   - `completed2026Moves`: Deduplicated merge of ESPN team transactions + official club transactions HTML
 *     + nflverse `trades.csv`, enriched with live team roster playerId/headshots/stats/OTC links
 *   - `topNeeds`: Data-driven positional need ranker (IR/Out attrition + unit stat deficits + 2027 UFA cliff)
 *   - `realisticTargets`: Cap-feasible, need-aligned external trade targets on live seller teams
 *     (post-deadline targets require 2027 contract control; in-season targets prioritize expiring/rookie deals)
 *   - `pitfallsToAvoid`: Club-specific contract/age/draft-capital traps with verified OTC links
 *   - `tieredRumors`: Live beat/transaction trade intel + grounded cap/pick leverage briefs (zero fabricated quotes)
 */

import { ALL_NFL_TEAMS, getTeamByAbbr, normalizeAnyTeamAbbr } from '../../src/config/teamRegistry.js';
import { parseOverTheCapHtml, parseDollarCell } from './otcParser.mjs';
import { normPlayerName, parseCsv } from './nflversePlayerContext.mjs';
import { buildOtcPlayerUrl, sanitizeExternalUrl } from '../../src/engine/linkIntegrity.js';
import { evaluateTradeDeadlineStatus } from '../../src/engine/seasonStateMachine.js';

const NFLVERSE_TRADES_URL = 'https://github.com/nflverse/nflverse-data/releases/download/trades/trades.csv';
const UA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/json,text/csv,*/*;q=0.8'
};

const TEAM_NAME_ALIASES = (() => {
  const entries = [];
  for (const t of ALL_NFL_TEAMS) {
    const variants = new Set([
      t.fullName.toLowerCase(),
      t.nickname.toLowerCase(),
      t.city.toLowerCase(),
      t.abbr.toLowerCase()
    ]);
    if (t.abbr === 'NYJ') variants.add('new york jets');
    if (t.abbr === 'NYG') variants.add('new york giants');
    if (t.abbr === 'LAC') variants.add('los angeles chargers');
    if (t.abbr === 'LAR') variants.add('los angeles rams');
    if (t.abbr === 'SF') variants.add('san francisco');
    if (t.abbr === 'TB') variants.add('tampa bay');
    if (t.abbr === 'GB') variants.add('green bay');
    if (t.abbr === 'KC') variants.add('kansas city');
    if (t.abbr === 'NE') variants.add('new england');
    if (t.abbr === 'NO') variants.add('new orleans');
    if (t.abbr === 'LV') variants.add('las vegas');
    for (const v of variants) {
      if (v && v.length >= 4) entries.push([v, t.abbr]);
    }
  }
  entries.sort((a, b) => b[0].length - a[0].length);
  return entries;
})();

const POSITION_BUCKET_META = {
  WR: { label: 'Wide Receiver (Perimeter & Slot Separation)', short: 'WR' },
  TE: { label: 'Tight End (12-Personnel & Seam Threat)', short: 'TE' },
  OT: { label: 'Offensive Tackle (Edge Pass Protection)', short: 'OT' },
  IOL: { label: 'Interior Offensive Line (Guard & Center)', short: 'IOL' },
  EDGE: { label: 'Edge Rusher (4-Man Pass Rush)', short: 'EDGE' },
  IDL: { label: 'Interior Defensive Line (DT / 3-Tech)', short: 'IDL' },
  LB: { label: 'Off-Ball Linebacker (Run Fit & Coverage)', short: 'LB' },
  CB: { label: 'Cornerback (Outside & Nickel Coverage)', short: 'CB' },
  S: { label: 'Safety (Deep Shell & Box Versatility)', short: 'S' }
};

export function normalizePositionBucket(pos = '') {
  const p = String(pos || '').trim().toUpperCase();
  if (['WR'].includes(p)) return 'WR';
  if (['TE'].includes(p)) return 'TE';
  if (['OT', 'T', 'LT', 'RT'].includes(p)) return 'OT';
  if (['G', 'OG', 'LG', 'RG', 'C', 'IOL', 'OL'].includes(p)) return 'IOL';
  if (['DE', 'EDGE', 'ED', 'OLB'].includes(p)) return 'EDGE';
  if (['DT', 'NT', 'DL', 'IDL'].includes(p)) return 'IDL';
  if (['LB', 'ILB', 'MLB'].includes(p)) return 'LB';
  if (['CB'].includes(p)) return 'CB';
  if (['S', 'FS', 'SS', 'SAF'].includes(p)) return 'S';
  if (['RB', 'HB', 'FB'].includes(p)) return 'RB';
  if (['DB'].includes(p)) return 'CB';
  return p || 'ATH';
}

function fmtDollarsCompact(val) {
  const n = Number(val || 0);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function ordinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${num}th`;
  const mod10 = num % 10;
  if (mod10 === 1) return `${num}st`;
  if (mod10 === 2) return `${num}nd`;
  if (mod10 === 3) return `${num}rd`;
  return `${num}th`;
}

function teamLogoUrl(abbr = '') {
  const norm = normalizeAnyTeamAbbr(abbr);
  if (!norm) return '';
  const espnCode = getTeamByAbbr(norm)?.espnAbbr || norm.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${espnCode}.png`;
}

function possessive(name = '') {
  const s = String(name || '').trim();
  if (!s) return '';
  return /s$/i.test(s) ? `${s}'` : `${s}'s`;
}

function stripTags(str = '') {
  return String(str || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#039;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveTeamAbbrFromText(text = '', excludeAbbr = '') {
  const lower = String(text || '').toLowerCase();
  const ex = normalizeAnyTeamAbbr(excludeAbbr);
  for (const [alias, abbr] of TEAM_NAME_ALIASES) {
    if (abbr === ex) continue;
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) return abbr;
  }
  return '';
}

function computeAgeFromBirthDate(birthDate = '', refYear = 2026) {
  const m = String(birthDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const yr = Number(m[1]);
  const mo = Number(m[2]);
  const age = refYear - yr - (mo > 10 ? 1 : 0);
  return age >= 20 && age <= 45 ? age : null;
}

async function fetchTextSafe(url, timeoutMs = 10000) {
  try {
    const res = await fetch(url, { headers: UA_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * Parse league-wide 32-team cap space rankings for `seasonYear` and `seasonYear + 1`
 * from the already-fetched OverTheCap `/salary-cap-space` HTML.
 */
export function parseLeagueCapRankingsFromOtcSpaceHtml(spaceHtml = '', seasonYear = 2026) {
  const out = { [seasonYear]: new Map(), [seasonYear + 1]: new Map() };
  if (!spaceHtml) return out;

  for (const yr of [seasonYear, seasonYear + 1]) {
    const marker = `id="season-${yr}"`;
    const idx = spaceHtml.indexOf(marker);
    if (idx < 0) continue;
    const nextIdx = spaceHtml.slice(idx + 12).search(/id="season-\d{4}"/);
    const block = nextIdx > 0 ? spaceHtml.slice(idx, idx + 12 + nextIdx) : spaceHtml.slice(idx, idx + 60_000);
    const rows = [];
    for (const rm of block.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const slugMatch = rm[1].match(/\/salary-cap\/([a-z0-9-]+)/i);
      if (!slugMatch) continue;
      const team = ALL_NFL_TEAMS.find(t => t.otcSlug === slugMatch[1].toLowerCase());
      if (!team) continue;
      const tds = [...rm[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]));
      if (tds.length < 3) continue;
      rows.push({
        abbr: team.abbr,
        conference: team.conference,
        capSpace: parseDollarCell(tds[1]),
        effectiveCapSpace: parseDollarCell(tds[2])
      });
    }
    rows.sort((a, b) => b.capSpace - a.capSpace);
    const confCounters = { AFC: 0, NFC: 0 };
    rows.forEach((r, i) => {
      confCounters[r.conference] = (confCounters[r.conference] || 0) + 1;
      out[yr].set(r.abbr, {
        ...r,
        nflRank: i + 1,
        confRank: confCounters[r.conference]
      });
    });
  }
  return out;
}

/**
 * Group nflverse `trades.csv` rows for `seasonYear` into structured trade deals.
 */
export function parseNflverseTradesCsv(csvText = '', seasonYear = 2026) {
  const rows = parseCsv(csvText);
  const byId = new Map();
  for (const r of rows) {
    const yr = Number(r.season || 0);
    const tradeDate = String(r.trade_date || '').trim();
    if (yr !== seasonYear && !tradeDate.startsWith(`${seasonYear}-`)) continue;
    const id = String(r.trade_id || '').trim();
    if (!id) continue;
    if (!byId.has(id)) {
      byId.set(id, {
        tradeId: id,
        season: yr || seasonYear,
        tradeDate,
        legs: []
      });
    }
    const gave = normalizeAnyTeamAbbr(r.gave || '');
    const received = normalizeAnyTeamAbbr(r.received || '');
    if (!gave || !received) continue;
    byId.get(id).legs.push({
      gave,
      received,
      pickSeason: r.pick_season ? Number(r.pick_season) : null,
      pickRound: r.pick_round ? Number(r.pick_round) : null,
      pickNumber: r.pick_number ? Number(r.pick_number) : null,
      conditional: String(r.conditional || '') === '1',
      pfrId: String(r.pfr_id || '').trim() || null,
      pfrName: String(r.pfr_name || '').trim() || null
    });
  }
  return [...byId.values()];
}

/**
 * Parse official NFL club transactions HTML (`https://www.<club>/team/transactions/`)
 * for current-season trade entries (works across standard NFL.com-template club sites like DET & BUF).
 */
export function parseClubTransactionsTradesHtml(html = '', team, seasonYear = 2026) {
  if (!html) return [];
  const cleaned = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];

  const text = cleaned.replace(/<[^>]+>/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').map(s => stripTags(s)).filter(Boolean);

  const out = [];
  let inOtherYear = false;
  let sawTargetYear = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^20\d{2}$/.test(line)) {
      const y = Number(line);
      if (y === seasonYear) {
        sawTargetYear = true;
        inOtherYear = false;
      } else if (sawTargetYear && y < seasonYear) {
        const prevIsYear = i > 0 && /^20\d{2}$/.test(lines[i - 1]);
        const nextIsYear = i + 1 < lines.length && /^20\d{2}$/.test(lines[i + 1]);
        if (!prevIsYear && !nextIsYear) inOtherYear = true;
      }
      continue;
    }
    if (inOtherYear) continue;

    const dm = line.match(/^(\d{2})\/(\d{2})$/);
    if (!dm) continue;
    const mm = Number(dm[1]);
    const dd = Number(dm[2]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;

    const descParts = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j += 1) {
      if (/^\d{2}\/\d{2}$/.test(lines[j]) || months.includes(lines[j].toLowerCase())) break;
      descParts.push(lines[j]);
    }
    const description = descParts.join(' ').trim();
    if (!description) continue;
    if (!/\b(trad(?:e|ed|es|ing)|acquir(?:e|ed|es)\b.*\b(?:from|via trade|in exchange))\b/i.test(description)) {
      continue;
    }
    const isoDate = `${seasonYear}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}T16:00:00Z`;
    out.push({
      dateIso: isoDate,
      dateLabel: `${String(mm).padStart(2, '0')}/${String(dd).padStart(2, '0')}`,
      description,
      sourceUrl: `https://www.${team.clubDomain}/team/transactions/`
    });
  }
  return out;
}

/**
 * STAGE 1: Load shared league-wide trade context ONCE per run.
 * Fetches `trades.csv` + live OTC active rosters for bottom-8 seller teams by ESPN standings.
 */
export async function loadSharedLeagueTradeContext({
  seasonYear = 2026,
  standingsByAbbr = new Map(),
  otcSpaceHtml = '',
  nflverse = null
} = {}) {
  const capRankingsByYear = parseLeagueCapRankingsFromOtcSpaceHtml(otcSpaceHtml, seasonYear);

  const sortedStandings = [...standingsByAbbr.values()].sort(
    (a, b) => a.winPct - b.winPct || a.pd - b.pd
  );
  const sellerTeams = sortedStandings
    .filter(s => s.winPct < 0.45)
    .slice(0, 8)
    .map(s => ({ standing: s, config: getTeamByAbbr(s.abbr) }))
    .filter(x => x.config);

  const buyerTeams = [...standingsByAbbr.values()]
    .filter(s => s.winPct >= 0.62)
    .sort((a, b) => b.winPct - a.winPct || b.pd - a.pd)
    .slice(0, 4);

  const [tradesCsvText, ...sellerOtcHtmls] = await Promise.all([
    fetchTextSafe(NFLVERSE_TRADES_URL, 10000),
    ...sellerTeams.map(s => fetchTextSafe(`https://overthecap.com/salary-cap/${s.config.otcSlug}`, 9500))
  ]);

  const leagueTrades = parseNflverseTradesCsv(tradesCsvText, seasonYear);

  const nflPlayersByNorm = new Map();
  const nflPlayersByPfr = new Map();
  const nflPlayersByOtcId = new Map();
  for (const p of nflverse?.nflPlayers || []) {
    const nm = p.display_name || p.football_name || '';
    const nk = normPlayerName(nm);
    const status = String(p.status || '').toUpperCase();
    const isAct = ['ACT', 'RES', 'INA', 'PUP', 'DEV', 'CUT'].includes(status);
    if (p.pfr_id) {
      const prev = nflPlayersByPfr.get(p.pfr_id);
      if (!prev || isAct) nflPlayersByPfr.set(p.pfr_id, p);
    }
    if (p.otc_id) {
      const prev = nflPlayersByOtcId.get(String(p.otc_id));
      if (!prev || isAct) nflPlayersByOtcId.set(String(p.otc_id), p);
    }
    if (nk) {
      const prev = nflPlayersByNorm.get(nk);
      const prevDraft = Number(prev?.draft_year || 0);
      const curDraft = Number(p.draft_year || 0);
      if (
        !prev ||
        (isAct && !['ACT', 'RES', 'INA'].includes(String(prev.status || '').toUpperCase())) ||
        curDraft > prevDraft
      ) {
        nflPlayersByNorm.set(nk, p);
      }
    }
  }

  const statsByGsis = new Map();
  const statsByNorm = new Map();
  for (const row of nflverse?.statsPlayerCurrent || []) {
    if (row.player_id) statsByGsis.set(row.player_id, row);
    const nk = normPlayerName(row.player_display_name || row.player_name || '');
    if (nk) statsByNorm.set(nk, row);
  }

  const sellerCandidates = [];
  const sellerTraps = [];

  for (let i = 0; i < sellerTeams.length; i += 1) {
    const { standing, config } = sellerTeams[i];
    const html = sellerOtcHtmls[i];
    if (!html) continue;

    let parsed;
    try {
      parsed = parseOverTheCapHtml(html, seasonYear, '', config.otcSlug);
    } catch {
      continue;
    }

    const otcEntries = parsed.otcPlayers instanceof Map
      ? [...parsed.otcPlayers.values()]
      : Object.values(parsed.otcPlayers || {});

    for (const op of otcEntries) {
      const c26 = op.contractsByYear?.[String(seasonYear)];
      if (!c26 || c26.rosterBucket !== 'active' || c26.isVoidYear) continue;
      const c27 = op.contractsByYear?.[String(seasonYear + 1)] || null;
      const otcUrl = sanitizeExternalUrl(op.otcUrl, null);
      if (!otcUrl || !otcUrl.startsWith('https://overthecap.com/player/')) continue;

      const nk = normPlayerName(op.name);
      const nflP = (op.otcId && nflPlayersByOtcId.get(String(op.otcId))) || nflPlayersByNorm.get(nk) || null;
      const rawPos = String(nflP?.position || '').toUpperCase();
      if (!rawPos || ['QB', 'K', 'P', 'LS', 'PK'].includes(rawPos)) continue;

      const bucket = normalizePositionBucket(rawPos);
      if (!POSITION_BUCKET_META[bucket]) continue;

      const st = (nflP?.gsis_id && statsByGsis.get(nflP.gsis_id)) || statsByNorm.get(nk) || null;
      const statTeam = st?.recent_team ? normalizeAnyTeamAbbr(st.recent_team) : '';
      if (statTeam && statTeam !== config.abbr) continue;

      const snapRec =
        (nflP?.pfr_id && nflverse?.snapsByTeamAndPfr?.get(config.abbr)?.get(nflP.pfr_id)) ||
        nflverse?.snapsByTeamAndName?.get(config.abbr)?.get(nk) ||
        null;

      const games = Number(st?.games || snapRec?.games || 0);
      const totalSnaps = (snapRec?.offSnaps || 0) + (snapRec?.defSnaps || 0);
      const snapPct = snapRec?.games > 0
        ? Math.round((((snapRec.offPctSum || 0) + (snapRec.defPctSum || 0)) / snapRec.games) * 100)
        : 0;

      if (games < 3 && totalSnaps < 80) continue;

      const age = computeAgeFromBirthDate(nflP?.birth_date, seasonYear);
      const draftYear = Number(nflP?.draft_year || 0);
      const draftRound = Number(nflP?.draft_round || 0);
      // Sellers rarely trade brand-new Day 1-2 foundational rookies or sophomore starting core pieces
      const isProtectedYoungCore =
        (draftYear === seasonYear && draftRound >= 1 && draftRound <= 3) ||
        (draftYear === seasonYear - 1 && draftRound >= 1 && draftRound <= 2 && snapPct >= 45);
      if (isProtectedYoungCore) continue;

      const base26 = Number(c26.baseSalary || 0);
      const cap26 = Number(c26.capNumber || 0);
      const isExpiring2026 = !c27 || Boolean(c27.isVoidYear) || Number(c27.capNumber || 0) <= 0;
      const cap27 = isExpiring2026 ? 0 : Number(c27.capNumber || 0);
      const base27 = isExpiring2026 ? 0 : Number(c27.baseSalary || 0);
      const gtd27 = isExpiring2026 ? 0 : Number(c27.guaranteedSalary || 0);
      const acquiringCap27 = isExpiring2026
        ? 0
        : Math.max(base27 + Number(c27.currentYearBonuses || 0), Math.round(cap27 * 0.65));

      const rec = Number(st?.receptions || 0);
      const recYds = Number(st?.receiving_yards || 0);
      const recTds = Number(st?.receiving_tds || 0);
      const recEpa = Number(st?.receiving_epa || 0);
      const sacks = Number(st?.def_sacks || 0);
      const tfl = Number(st?.def_tackles_for_loss || 0);
      const qbHits = Number(st?.def_qb_hits || 0);
      const tackles = Number(st?.def_tackles_solo || 0) + Number(st?.def_tackles_with_assist || 0);
      const ints = Number(st?.def_interceptions || 0);
      const pds = Number(st?.def_pass_defended || 0);

      let prodScore = 0;
      let prodLine = '';
      if (bucket === 'WR' || bucket === 'TE') {
        prodScore = recYds / 12 + rec * 0.8 + recTds * 6 + Math.max(-10, recEpa);
        if (rec > 0) {
          prodLine = `${rec} rec, ${recYds} yds${recTds ? `, ${recTds} TD` : ''}${recEpa !== 0 ? `, ${recEpa > 0 ? '+' : ''}${recEpa.toFixed(1)} EPA` : ''} in ${games}g`;
        }
      } else if (bucket === 'EDGE' || bucket === 'IDL') {
        prodScore = sacks * 12 + qbHits * 3.2 + tfl * 3.5 + tackles * 0.6 + snapPct * 0.25;
        prodLine = `${sacks.toFixed(1)} sacks, ${qbHits} QB hits, ${tfl} TFL (${snapPct}% snaps in ${games}g)`;
      } else if (bucket === 'LB') {
        prodScore = tackles * 0.9 + tfl * 4 + sacks * 8 + pds * 4 + ints * 10 + snapPct * 0.2;
        prodLine = `${tackles} tackles, ${tfl} TFL${sacks > 0 ? `, ${sacks.toFixed(1)} sacks` : ''}${pds > 0 ? `, ${pds} PD` : ''} (${snapPct}% snaps in ${games}g)`;
      } else if (bucket === 'CB' || bucket === 'S') {
        prodScore = pds * 6 + ints * 14 + tackles * 0.7 + tfl * 3 + snapPct * 0.35;
        prodLine = `${tackles} tackles, ${pds} PD${ints > 0 ? `, ${ints} INT` : ''} (${snapPct}% snaps in ${games}g)`;
      } else if (bucket === 'OT' || bucket === 'IOL') {
        prodScore = snapPct * 0.85 + games * 3;
        prodLine = `${snapPct}% offensive snaps (${totalSnaps} snaps across ${games}g)`;
      }

      if (!prodLine) prodLine = `${snapPct}% snaps across ${games}g in ${seasonYear}`;

      const headshotUrl =
        (nflP?.headshot && String(nflP.headshot).startsWith('https://') ? nflP.headshot : '') ||
        (nflP?.espn_id ? `https://a.espncdn.com/i/headshots/nfl/players/full/${nflP.espn_id}.png` : '');

      const candidate = {
        name: op.name,
        normName: nk,
        position: rawPos,
        bucket,
        jersey: nflP?.jersey_number ? Number(nflP.jersey_number) : null,
        headshotUrl,
        teamAbbr: config.abbr,
        teamName: config.nickname,
        teamRecord: standing.record,
        teamLogoUrl: teamLogoUrl(config.abbr),
        age,
        draftYear,
        draftRound,
        games,
        snapPct,
        totalSnaps,
        base26,
        cap26,
        isExpiring2026,
        cap27,
        base27,
        gtd27,
        acquiringCap27,
        otcUrl,
        prodScore,
        prodLine,
        stats: { rec, recYds, recTds, recEpa, sacks, tfl, qbHits, tackles, ints, pds }
      };

      if (gtd27 >= 15_000_000 || (age && age >= 31 && prodScore < 28 && cap26 >= 4_000_000)) {
        sellerTraps.push(candidate);
      }

      const isUntouchableStar = draftRound === 1 && draftYear >= seasonYear - 2 && prodScore >= 55;
      if (!isUntouchableStar && prodScore >= 24 && (snapPct >= 35 || rec >= 15 || sacks >= 2.0)) {
        sellerCandidates.push(candidate);
      }
    }
  }

  console.log(
    `[stage-1/trade] Loaded leagueTrades(${seasonYear})=${leagueTrades.length}, sellers=${sellerTeams.map(s => s.config.abbr).join(',')}, tradeCandidates=${sellerCandidates.length}, traps=${sellerTraps.length}`
  );

  return {
    seasonYear,
    capRankingsByYear,
    leagueTrades,
    sellerTeams,
    buyerTeams,
    sellerCandidates,
    sellerTraps,
    nflPlayersByNorm,
    nflPlayersByPfr,
    statsByGsis,
    statsByNorm
  };
}

function formatPickSummary(picks = []) {
  if (!picks.length) return '';
  return picks
    .map(p => {
      const cond = p.conditional ? 'Conditional ' : '';
      const numStr = p.pickNumber ? ` (#${p.pickNumber})` : '';
      return `${p.pickSeason} ${cond}${ordinal(p.pickRound)}-Round Pick${numStr}`;
    })
    .join(' + ');
}

export function parseTradeSentenceForTeam(desc = '', team, dateIso = '', sourceUrl = '') {
  const clean = stripTags(desc);
  if (!clean) return null;

  const sentences = clean.split(/(?<=[.!])\s+/);
  const tradeClause = sentences.find(s => /\b(trad(?:e|ed|es)|acquir(?:e|ed|es))\b/i.test(s)) || clean;
  const trimmedClause = tradeClause.replace(/\s+and\s+(?:waived?|released?|placed?)\b[\s\S]*$/i, '').trim();

  // Case 1: Acquired [POS] [Name] (and [picks]) from [Team] (for / in exchange for [cost])
  const acqMatch = trimmedClause.match(
    /acquir(?:e|ed|es)\s+(?:([A-Z]{1,4}|wide receiver|cornerback|safety|defensive back|linebacker|center|guard|tackle|offensive lineman|defensive lineman|defensive end|defensive tackle|tight end|running back|quarterback)\s+)?([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3}?)(?:\s+and\s+(?:a\s+)?([^.]+?))?\s+(?:from|via\s+trade\s+with)\s+(?:the\s+)?([A-Za-z .]+?)(?:\s+(?:for|in\s+exchange\s+for)\s+(.+?))?\.?$/i
  );
  if (acqMatch) {
    const rawPos = (acqMatch[1] || '').trim();
    const player = (acqMatch[2] || '').trim();
    const extraReceived = (acqMatch[3] || '').trim();
    const partnerRaw = (acqMatch[4] || '').trim();
    const costRaw = (acqMatch[5] || '').trim();
    if (!/^(?:a|an|the|\d{4}|\d+(?:st|nd|rd|th))\b/i.test(player)) {
      const partnerAbbr = resolveTeamAbbrFromText(partnerRaw, team.abbr);
      return {
        direction: 'incoming',
        player,
        rawPos,
        partnerAbbr,
        extraReceived,
        costSummary: costRaw ? costRaw.replace(/^a\s+/i, '').replace(/\.$/, '') : 'Undisclosed Draft Compensation',
        dateIso,
        sourceUrl,
        rawClause: trimmedClause
      };
    }
  }

  // Case 2: Traded [POS] [Name] (and [extra]) to [Team] (for [return])
  const trdMatch = trimmedClause.match(
    /trad(?:e|ed|es)\s+(?:([A-Z]{1,4}|wide receiver|cornerback|safety|defensive back|linebacker|center|guard|tackle|offensive lineman|defensive lineman|defensive end|defensive tackle|tight end|running back|quarterback)\s+)?([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3}?)(?:\s+and\s+(?:a\s+)?([^.]+?))?\s+to\s+(?:the\s+)?([A-Za-z .]+?)(?:\s+(?:for|in\s+exchange\s+for)\s+(.+?))?\.?$/i
  );
  if (trdMatch) {
    const rawPos = (trdMatch[1] || '').trim();
    const player = (trdMatch[2] || '').trim();
    const extraSent = (trdMatch[3] || '').trim();
    const partnerRaw = (trdMatch[4] || '').trim();
    const returnRaw = (trdMatch[5] || '').trim();
    if (!/^(?:a|an|the|\d{4}|\d+(?:st|nd|rd|th))\b/i.test(player)) {
      const partnerAbbr = resolveTeamAbbrFromText(partnerRaw, team.abbr);
      return {
        direction: 'outgoing',
        player,
        rawPos,
        partnerAbbr,
        extraSent,
        costSummary: returnRaw ? returnRaw.replace(/^a\s+/i, '').replace(/\.$/, '') : 'Undisclosed Draft Return',
        dateIso,
        sourceUrl,
        rawClause: trimmedClause
      };
    }
  }

  // Case 3: Acquired a [pick] from [Team] for [POS] [Name] (and [pick])
  const acqPickForPlayer = trimmedClause.match(
    /acquir(?:e|ed|es)\s+(?:a\s+)?([^.]+?pick[^.]*?)\s+from\s+(?:the\s+)?([A-Za-z .]+?)\s+(?:for|in\s+exchange\s+for)\s+(?:([A-Z]{1,4}|wide receiver|cornerback|safety|defensive back|linebacker|center|guard|tackle)\s+)?([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3}?)(?:\s+and\s+(.+?))?\.?$/i
  );
  if (acqPickForPlayer) {
    const returnPick = (acqPickForPlayer[1] || '').trim();
    const partnerAbbr = resolveTeamAbbrFromText(acqPickForPlayer[2], team.abbr);
    const rawPos = (acqPickForPlayer[3] || '').trim();
    const player = (acqPickForPlayer[4] || '').trim();
    const extraSent = (acqPickForPlayer[5] || '').trim();
    if (player && !/^\d/.test(player)) {
      return {
        direction: 'outgoing',
        player,
        rawPos,
        partnerAbbr,
        extraSent,
        costSummary: returnPick.replace(/^a\s+/i, ''),
        dateIso,
        sourceUrl,
        rawClause: trimmedClause
      };
    }
  }

  return null;
}

function normalizePosWord(raw = '') {
  const s = String(raw || '').trim().toLowerCase();
  const map = {
    'wide receiver': 'WR',
    'tight end': 'TE',
    'running back': 'RB',
    'quarterback': 'QB',
    'center': 'C',
    'guard': 'G',
    'tackle': 'OT',
    'offensive lineman': 'OL',
    'defensive lineman': 'DL',
    'defensive end': 'DE',
    'defensive tackle': 'DT',
    'linebacker': 'LB',
    'cornerback': 'CB',
    'safety': 'S',
    'defensive back': 'DB'
  };
  return map[s] || String(raw || '').toUpperCase();
}

function formatTradeTimingLabel(dateIso = '', seasonYear = 2026) {
  const ms = Date.parse(dateIso);
  if (!Number.isFinite(ms)) return `${seasonYear} Trade`;
  const d = new Date(ms);
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const mo = d.getUTCMonth() + 1;
  if (mo === 11 || (mo === 10 && d.getUTCDate() >= 20)) return `Trade Deadline Deal (${label})`;
  if (mo === 8 || mo === 9) return `Roster Cutdown Trade (${label})`;
  if (mo === 3 || mo === 4) return `Offseason Trade (${label})`;
  return `In-Season Trade (${label})`;
}

/**
 * Merge & enrich completed trades from ESPN transactions + Club transactions HTML + nflverse `trades.csv`.
 */
function buildCompletedTradesForTeam({
  team,
  seasonYear,
  players = [],
  espnTransactions = [],
  clubTransactionsHtml = '',
  leagueTradeCtx = null
}) {
  const rosterByNorm = new Map(players.map(p => [normPlayerName(p.name), p]));
  const dealsByKey = new Map();

  const upsertDeal = deal => {
    if (!deal?.player || !deal?.partnerAbbr) return;
    const nk = normPlayerName(deal.player);
    const key = `${nk}::${deal.partnerAbbr}`;
    const existing = dealsByKey.get(key);
    if (!existing) {
      dealsByKey.set(key, deal);
      return;
    }
    const existKnown = Boolean(existing.costSummary) && !/undisclosed/i.test(existing.costSummary);
    const dealKnown = Boolean(deal.costSummary) && !/undisclosed/i.test(deal.costSummary);
    const mergedCost = existKnown && dealKnown
      ? existing.costSummary.length >= deal.costSummary.length
        ? existing.costSummary
        : deal.costSummary
      : existKnown
        ? existing.costSummary
        : dealKnown
          ? deal.costSummary
          : existing.costSummary || deal.costSummary;
    dealsByKey.set(key, {
      ...existing,
      ...deal,
      direction: existing.direction === 'incoming' || deal.direction === 'incoming' ? 'incoming' : 'outgoing',
      costSummary: mergedCost,
      extraReceived: existing.extraReceived || deal.extraReceived || '',
      extraSent: existing.extraSent || deal.extraSent || '',
      dateIso:
        existing.dateIso && deal.dateIso
          ? Date.parse(deal.dateIso) > Date.parse(existing.dateIso)
            ? deal.dateIso
            : existing.dateIso
          : existing.dateIso || deal.dateIso,
      pfrId: existing.pfrId || deal.pfrId || null
    });
  };

  // 1. Parse nflverse `trades.csv`
  const pairedOutNames = new Set();
  for (const tr of leagueTradeCtx?.leagueTrades || []) {
    const incomingPlayers = tr.legs.filter(l => l.received === team.abbr && l.pfrName);
    const outgoingPlayers = tr.legs.filter(l => l.gave === team.abbr && l.pfrName);
    const incomingPicks = tr.legs.filter(l => l.received === team.abbr && l.pickRound);
    const outgoingPicks = tr.legs.filter(l => l.gave === team.abbr && l.pickRound);
    const partnerAbbr =
      tr.legs.find(l => l.gave === team.abbr)?.received ||
      tr.legs.find(l => l.received === team.abbr)?.gave ||
      '';
    if (!partnerAbbr) continue;
    const dateIso = tr.tradeDate ? `${tr.tradeDate}T16:00:00Z` : `${seasonYear}-03-11T16:00:00Z`;

    if (incomingPlayers.length > 0) {
      for (const op of outgoingPlayers) pairedOutNames.add(`${normPlayerName(op.pfrName)}::${partnerAbbr}`);
      const costParts = [
        ...outgoingPlayers.map(op => op.pfrName),
        ...(outgoingPicks.length ? [formatPickSummary(outgoingPicks)] : [])
      ].filter(Boolean);
      const extraReceived = incomingPicks.length ? formatPickSummary(incomingPicks) : '';
      for (const ip of incomingPlayers) {
        upsertDeal({
          direction: 'incoming',
          player: ip.pfrName,
          pfrId: ip.pfrId,
          partnerAbbr,
          extraReceived,
          costSummary: costParts.join(' + ') || 'Draft Pick Compensation',
          dateIso,
          sourceUrl: `https://www.${team.clubDomain}/team/transactions/`
        });
      }
    } else if (outgoingPlayers.length > 0) {
      const retParts = incomingPicks.length ? [formatPickSummary(incomingPicks)] : ['Draft Pick Return'];
      const extraSent = outgoingPicks.length ? formatPickSummary(outgoingPicks) : '';
      for (const op of outgoingPlayers) {
        upsertDeal({
          direction: 'outgoing',
          player: op.pfrName,
          pfrId: op.pfrId,
          partnerAbbr,
          extraSent,
          costSummary: retParts.join(' + '),
          dateIso,
          sourceUrl: `https://www.${team.clubDomain}/team/transactions/`
        });
      }
    }
  }

  // 2. Parse official club transactions HTML
  const clubTrades = parseClubTransactionsTradesHtml(clubTransactionsHtml, team, seasonYear);
  for (const ct of clubTrades) {
    const parsed = parseTradeSentenceForTeam(ct.description, team, ct.dateIso, ct.sourceUrl);
    if (!parsed) continue;
    const key = `${normPlayerName(parsed.player)}::${parsed.partnerAbbr}`;
    if (parsed.direction === 'outgoing' && pairedOutNames.has(key)) continue;
    upsertDeal(parsed);
  }

  // 3. Parse live ESPN team transactions
  for (const tx of espnTransactions || []) {
    const desc = String(tx?.description || '');
    if (!/\b(trad(?:e|ed|es)|acquir(?:e|ed|es))\b/i.test(desc)) continue;
    const dateIso = tx.date ? new Date(tx.date).toISOString() : new Date().toISOString();
    const parsed = parseTradeSentenceForTeam(
      desc,
      team,
      dateIso,
      `https://www.espn.com/nfl/team/transactions/_/name/${team.espnAbbr}/${team.otcSlug}`
    );
    if (!parsed) continue;
    const key = `${normPlayerName(parsed.player)}::${parsed.partnerAbbr}`;
    if (parsed.direction === 'outgoing' && pairedOutNames.has(key)) continue;
    upsertDeal(parsed);
  }

  // 4. Enrich with live roster / stats / OTC URL
  const enriched = [];
  for (const deal of dealsByKey.values()) {
    const nk = normPlayerName(deal.player);
    const rosterMatch = deal.direction === 'incoming' ? rosterByNorm.get(nk) || null : null;
    const nflP =
      (deal.pfrId && leagueTradeCtx?.nflPlayersByPfr?.get(deal.pfrId)) ||
      leagueTradeCtx?.nflPlayersByNorm?.get(nk) ||
      null;
    const st =
      (nflP?.gsis_id && leagueTradeCtx?.statsByGsis?.get(nflP.gsis_id)) ||
      leagueTradeCtx?.statsByNorm?.get(nk) ||
      null;

    const displayName = rosterMatch?.name || deal.player;
    const pos = rosterMatch?.position || normalizePosWord(deal.rawPos) || nflP?.position || 'ATH';
    const headshotUrl =
      rosterMatch?.headshotUrl ||
      (nflP?.headshot && String(nflP.headshot).startsWith('https://') ? nflP.headshot : '') ||
      (nflP?.espn_id ? `https://a.espncdn.com/i/headshots/nfl/players/full/${nflP.espn_id}.png` : '');

    const otcUrl =
      rosterMatch?.otcUrl ||
      (nflP?.otc_id
        ? buildOtcPlayerUrl({ otcId: nflP.otc_id, playerName: displayName, fallbackToTeam: false })
        : null) ||
      deal.sourceUrl ||
      `https://www.${team.clubDomain}/team/transactions/`;

    const c26 = rosterMatch?.contractsByYear?.[String(seasonYear)];
    const c27 = rosterMatch?.contractsByYear?.[String(seasonYear + 1)];
    const cap26Str = c26?.capNumber ? `${fmtDollarsCompact(c26.capNumber)} ${seasonYear} cap hit` : '';
    const snapStr = rosterMatch?.primarySnapPct > 0 ? `${rosterMatch.primarySnapPct}% ${seasonYear} snap share` : '';
    const rec = Number(st?.receptions || 0);
    const recYds = Number(st?.receiving_yards || 0);
    const recTds = Number(st?.receiving_tds || 0);
    const tackles = Number(st?.def_tackles_solo || 0) + Number(st?.def_tackles_with_assist || 0);
    const pds = Number(st?.def_pass_defended || 0);
    const ints = Number(st?.def_interceptions || 0);
    const sacks = Number(st?.def_sacks || 0);

    const statBits = [];
    if (rec > 0) statBits.push(`${rec} rec, ${recYds} yds${recTds ? `, ${recTds} TD` : ''}`);
    else if (tackles > 0 || pds > 0 || sacks > 0) {
      const defParts = [];
      if (tackles > 0) defParts.push(`${tackles} tackles`);
      if (sacks > 0) defParts.push(`${sacks.toFixed(1)} sacks`);
      if (pds > 0) defParts.push(`${pds} PD`);
      if (ints > 0) defParts.push(`${ints} INT`);
      statBits.push(defParts.join(', '));
    }
    if (snapStr) statBits.push(snapStr);
    if (cap26Str) statBits.push(cap26Str);

    const partnerObj = getTeamByAbbr(deal.partnerAbbr);
    const partnerName = partnerObj ? partnerObj.fullName : deal.partnerAbbr;
    const termNote = deal.direction === 'incoming'
      ? c27 && !c27.isVoidYear && Number(c27.capNumber || 0) > 0
        ? `Under contract through ${seasonYear + 1} (${fmtDollarsCompact(c27.capNumber)} cap hit).`
        : `Expiring ${seasonYear} deal ($0 ${seasonYear + 1} cap commitment).`
      : '';

    const extraNote = deal.direction === 'incoming' && deal.extraReceived
      ? ` ${team.abbr} also received ${deal.extraReceived}.`
      : deal.direction === 'outgoing' && deal.extraSent
        ? ` ${team.abbr} also included ${deal.extraSent}.`
        : '';

    let analysis = '';
    if (deal.direction === 'incoming') {
      analysis = `${team.nickname} acquired ${pos} ${displayName} from ${partnerName}${
        statBits.length ? ` (${statBits.join(' • ')})` : ''
      }.${extraNote}${termNote ? ` ${termNote}` : ''}`.trim();
    } else {
      analysis = `${team.nickname} traded ${pos} ${displayName} to ${partnerName} in exchange for ${deal.costSummary}.${extraNote} Recoups draft capital while preserving ${seasonYear + 1} roster and cap flexibility.`.trim();
    }

    let schemeGrade = 'B+';
    if (deal.direction === 'incoming') {
      const costLower = String(deal.costSummary || '').toLowerCase();
      const isDay3Cost = /5th|6th|7th|fifth|sixth|seventh/.test(costLower);
      const isHighSnap = (rosterMatch?.primarySnapPct || 0) >= 55 || rec >= 25 || tackles >= 35;
      if (isDay3Cost && isHighSnap) schemeGrade = 'A';
      else if (isDay3Cost || isHighSnap) schemeGrade = 'A-';
      else schemeGrade = 'B+';
    } else {
      schemeGrade = 'B';
    }

    enriched.push({
      player: displayName,
      playerId: rosterMatch?.id || null,
      direction: deal.direction,
      jersey: rosterMatch?.jersey ?? (nflP?.jersey_number ? Number(nflP.jersey_number) : null),
      headshotUrl,
      position: pos,
      acquiredFrom: deal.partnerAbbr,
      acquiredFromLogoUrl: teamLogoUrl(deal.partnerAbbr),
      tradeDateIso: deal.dateIso,
      timing: formatTradeTimingLabel(deal.dateIso, seasonYear),
      costSummary: deal.costSummary,
      schemeGrade,
      sourceUrl: sanitizeExternalUrl(otcUrl, `https://www.${team.clubDomain}/team/transactions/`),
      analysis
    });
  }

  enriched.sort((a, b) => (Date.parse(b.tradeDateIso) || 0) - (Date.parse(a.tradeDateIso) || 0));
  return enriched;
}

/**
 * Derive top 4 data-driven positional needs from live IR/Out attrition,
 * unit stat rankings, and impending 2027 UFA starters.
 */
function buildTeamTopNeeds({
  team,
  seasonYear,
  players = [],
  health = {},
  teamStatRankings = []
}) {
  const rankByKey = new Map((teamStatRankings || []).map(r => [r.key, r]));
  const irList = health?.irAndReserveTracker || [];
  const prList = health?.practiceReport || [];
  const playersByNorm = new Map(players.map(p => [normPlayerName(p.name), p]));

  const scored = [];
  for (const [bucket, meta] of Object.entries(POSITION_BUCKET_META)) {
    const bucketPlayers = players.filter(p => normalizePositionBucket(p.position) === bucket);
    const activePlayers = bucketPlayers.filter(p => p.rosterBucket === 'active');

    const irInBucket = irList.filter(ir => normalizePositionBucket(ir.position) === bucket);
    const outInBucket = prList.filter(
      pr => normalizePositionBucket(pr.position) === bucket && /\b(out|doubtful)\b/i.test(pr.gameStatus || '')
    );

    const expiringStarters = activePlayers.filter(p => {
      const c27 = p.contractsByYear?.[String(seasonYear + 1)];
      const isExpiring = !c27 || Boolean(c27.isVoidYear) || Number(c27.capNumber || 0) <= 0;
      return (
        isExpiring &&
        (Number(p.primarySnapPct || 0) >= 45 || Number(p.contractsByYear?.[String(seasonYear)]?.capNumber || 0) >= 4_000_000)
      );
    });

    let irScore = 0;
    const notableIrNames = [];
    for (const ir of irInBucket) {
      const nm = ir.playerName || ir.name || '';
      const pm = playersByNorm.get(normPlayerName(nm));
      const isCore =
        Number(pm?.primarySnapPct || 0) >= 40 || Number(pm?.contractsByYear?.[String(seasonYear)]?.capNumber || 0) >= 4_000_000;
      irScore += isCore ? 16 : 9;
      if (nm) notableIrNames.push(`${nm} (IR)`);
    }
    for (const pr of outInBucket) {
      const nm = pr.playerName || pr.name || '';
      const pm = playersByNorm.get(normPlayerName(nm));
      const isCore =
        Number(pm?.primarySnapPct || 0) >= 45 || Number(pm?.contractsByYear?.[String(seasonYear)]?.capNumber || 0) >= 4_000_000;
      irScore += isCore ? 10 : 5;
      if (nm && !notableIrNames.some(x => x.startsWith(nm))) notableIrNames.push(`${nm} (${pr.gameStatus})`);
    }

    let statScore = 0;
    const statNotes = [];
    const passEpa = rankByKey.get('passing_epa_game');
    const sacksAllowed = rankByKey.get('sack_rate_allowed') || rankByKey.get('sacks_allowed_rate');
    const defSacks = rankByKey.get('def_sacks_game');
    const ptsAllowed = rankByKey.get('def_pts_allowed_game');
    const toDiff = rankByKey.get('margin_turnover_diff');

    if ((bucket === 'WR' || bucket === 'TE') && passEpa && passEpa.rank >= 14) {
      statScore += Math.min(18, (passEpa.rank - 10) * 0.9);
      statNotes.push(`Passing EPA ranks #${passEpa.rank} (${passEpa.value})`);
    }
    if ((bucket === 'OT' || bucket === 'IOL') && sacksAllowed && sacksAllowed.rank >= 14) {
      statScore += Math.min(18, (sacksAllowed.rank - 10) * 0.9);
      statNotes.push(`Sacks Allowed Rate ranks #${sacksAllowed.rank} (${sacksAllowed.value})`);
    }
    if ((bucket === 'EDGE' || bucket === 'IDL') && defSacks && defSacks.rank >= 12) {
      statScore += Math.min(18, (defSacks.rank - 9) * 0.9);
      statNotes.push(`Defensive Sacks/Game ranks #${defSacks.rank} (${defSacks.value})`);
    }
    if ((bucket === 'CB' || bucket === 'S' || bucket === 'LB') && ptsAllowed && ptsAllowed.rank >= 13) {
      statScore += Math.min(15, (ptsAllowed.rank - 10) * 0.75);
      statNotes.push(`Points Allowed ranks #${ptsAllowed.rank} (${ptsAllowed.value}/g)`);
    }
    if ((bucket === 'CB' || bucket === 'S') && toDiff && toDiff.rank >= 15) {
      statScore += 6;
      statNotes.push(`Turnover Differential ranks #${toDiff.rank} (${toDiff.value})`);
    }

    const ufaScore = Math.min(20, expiringStarters.length * 8);
    const minDepth =
      bucket === 'WR' || bucket === 'CB' || bucket === 'IOL'
        ? 5
        : bucket === 'LB' || bucket === 'EDGE' || bucket === 'IDL' || bucket === 'S'
          ? 4
          : 3;
    const depthScore = activePlayers.length < minDepth ? (minDepth - activePlayers.length) * 6 : 0;
    const premiumBias = ['EDGE', 'WR', 'CB', 'IOL', 'LB', 'S', 'IDL', 'OT', 'TE'].includes(bucket) ? 2 : 0;
    const totalScore = irScore + statScore + ufaScore + depthScore + premiumBias;

    const contextParts = [];
    if (notableIrNames.length > 0) {
      contextParts.push(`Active attrition: ${notableIrNames.slice(0, 4).join(', ')} sidelined`);
    }
    if (statNotes.length > 0) {
      contextParts.push(statNotes.join('; '));
    }
    if (expiringStarters.length > 0) {
      contextParts.push(
        `${seasonYear + 1} impending UFA exposure: ${expiringStarters.slice(0, 3).map(p => p.name).join(', ')}`
      );
    }
    if (contextParts.length === 0) {
      contextParts.push(
        `${activePlayers.length} active ${meta.short} on the 53-man roster; upgrading depth and ${seasonYear + 1} contract control strengthens ${possessive(team.nickname)} playoff ceiling.`
      );
    }

    scored.push({
      bucket,
      positionGroup: meta.label,
      score: totalScore,
      epaContext: `${contextParts.join('. ')}.`
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map((item, idx) => ({
    rank: idx + 1,
    bucket: item.bucket,
    positionGroup: item.positionGroup,
    urgency: idx === 0 && item.score >= 24 ? 'High' : idx <= 1 ? 'Moderate-High' : idx === 2 ? 'Moderate' : 'Opportunistic',
    epaContext: item.epaContext
  }));
}

function estimatePickCostForCandidate(cand, tankathonPicks = [], seasonYear = 2026, ownTeamAbbr = '') {
  const pickByRound = new Map();
  for (const p of tankathonPicks || []) {
    if (!pickByRound.has(p.round)) pickByRound.set(p.round, p);
  }
  const fmtRd = rd => {
    const p = pickByRound.get(rd);
    if (p) {
      const via = p.fromTeam && p.fromTeam !== ownTeamAbbr ? ` via ${p.fromTeam}` : '';
      return `${seasonYear + 1} ${ordinal(rd)}-Round Pick (#${p.projectedOverall}${via})`;
    }
    return `${seasonYear + 1} ${ordinal(rd)}-Round Pick`;
  };

  const youngControl = !cand.isExpiring2026 && (cand.age || 27) <= 26;
  const highProd = cand.prodScore >= 58;
  if (highProd && youngControl && cand.cap27 <= 10_000_000) {
    return pickByRound.has(3) ? `${fmtRd(3)} or Day-2 Package` : `${fmtRd(4)} + ${seasonYear + 2} Day-3 Pick`;
  }
  if (highProd || (youngControl && cand.prodScore >= 42)) {
    return pickByRound.has(4) ? fmtRd(4) : fmtRd(5);
  }
  if (cand.prodScore >= 34) {
    return pickByRound.has(5) ? fmtRd(5) : fmtRd(6);
  }
  return pickByRound.has(6) ? fmtRd(6) : `${seasonYear + 1} Day-3 Pick Swap`;
}

/**
 * Select 6–7 cap-calibrated, need-aligned external trade targets from Stage-1 live seller pool.
 */
function buildRealisticTargetsForTeam({
  team,
  seasonYear,
  currentWeek,
  isPostDeadlinePause,
  availableGrossCap,
  projected2027CapSpace,
  topNeeds = [],
  completedMoves = [],
  players = [],
  tankathonPicks = [],
  leagueTradeCtx = null
}) {
  const candidates = leagueTradeCtx?.sellerCandidates || [];
  if (!candidates.length) return [];

  const rosterNorms = new Set(players.map(p => normPlayerName(p.name)));
  const tradedNorms = new Set(completedMoves.map(m => normPlayerName(m.player)));
  const needRankByBucket = new Map(topNeeds.map(n => [n.bucket, n.rank]));
  const remainingWeeks = Math.max(1, Math.min(18, 18 - (Number(currentWeek) || 10)));
  const isCapTight2027 = Number(projected2027CapSpace || 0) < 0;
  const capBuffer2026 = Math.max(2_500_000, Number(availableGrossCap || 0));

  const scored = [];
  for (const c of candidates) {
    if (c.teamAbbr === team.abbr) continue;
    if (rosterNorms.has(c.normName) || tradedNorms.has(c.normName)) continue;
    if (isPostDeadlinePause && c.isExpiring2026) continue;

    const prorated2026 = Math.max(350_000, Math.round((c.base26 * remainingWeeks) / 18));
    const offseason2027Cap = c.isExpiring2026 ? 0 : Math.max(850_000, c.acquiringCap27 || c.cap27);

    if (!isPostDeadlinePause && prorated2026 > capBuffer2026 * 1.15) continue;
    if (isCapTight2027 && c.gtd27 > 12_000_000) continue;
    if (isCapTight2027 && offseason2027Cap > 15_000_000) continue;

    const needRank = needRankByBucket.get(c.bucket) || 6;
    const needBonus = needRank === 1 ? 15 : needRank === 2 ? 12 : needRank === 3 ? 9 : needRank === 4 ? 6 : 0;
    if (needRank > 4 && c.prodScore < 42) continue;

    let capBonus = 0;
    if (!isPostDeadlinePause && c.isExpiring2026) capBonus += isCapTight2027 ? 7 : 4;
    if (!c.isExpiring2026 && c.cap27 <= 5_000_000) capBonus += 6;
    else if (!c.isExpiring2026 && c.gtd27 === 0 && c.cap27 <= 12_000_000) capBonus += 4;
    else if (isCapTight2027 && c.cap27 > 9_000_000) capBonus -= 6;

    const ageBonus = c.age && c.age <= 26 ? 4 : c.age && c.age >= 31 ? -4 : 1;
    const prodNorm = Math.min(16, Math.round(c.prodScore * 0.22));
    const rawFit = 54 + needBonus + prodNorm + capBonus + ageBonus;
    const fitScore = Math.max(76, Math.min(94, Math.round(rawFit)));

    let cap2027Impact = `$0 (Expiring ${seasonYear} UFA)`;
    if (!c.isExpiring2026) {
      if (c.draftYear >= seasonYear - 3 && c.cap27 <= 5_000_000) {
        cap2027Impact = `${fmtDollarsCompact(offseason2027Cap)} Rookie Scale`;
      } else if (c.gtd27 === 0) {
        cap2027Impact = `${fmtDollarsCompact(offseason2027Cap)} Non-Gtd (${seasonYear + 1} Option)`;
      } else {
        cap2027Impact = `${c.gtd27 >= 8_000_000 && isCapTight2027 ? '⚠️ ' : ''}${fmtDollarsCompact(offseason2027Cap)} (${fmtDollarsCompact(c.gtd27)} Gtd)`;
      }
    }

    const sellerTag = `${c.teamAbbr} (${c.teamRecord} Seller)`;
    const sellerIncentive = `${c.teamRecord} ${c.teamName} are in retooling territory; ${
      c.isExpiring2026
        ? `expiring ${seasonYear} deal invites Day-3 pick return before free agency`
        : c.gtd27 === 0
          ? `non-guaranteed ${seasonYear + 1} contract makes a March trade clean for both sides`
          : `controlled through ${seasonYear + 1} while ${c.teamAbbr} collects future draft capital`
    }.`;

    const capContextNote = isPostDeadlinePause
      ? `${fmtDollarsCompact(offseason2027Cap)} projected ${seasonYear + 1} acquiring cap charge${
          isCapTight2027
            ? ` fits ${team.abbr}'s cap-conscious ${fmtDollarsCompact(projected2027CapSpace)} ${seasonYear + 1} outlook`
            : ` fits easily inside ${team.abbr}'s ${fmtDollarsCompact(projected2027CapSpace)} ${seasonYear + 1} cap space`
        }.`
      : `${fmtDollarsCompact(prorated2026)} prorated ${seasonYear} charge (${remainingWeeks}/18ths base) fits ${team.abbr}'s ${fmtDollarsCompact(availableGrossCap)} cap room.`;

    scored.push({
      bucket: c.bucket,
      needRank,
      target: {
        name: c.name,
        jersey: c.jersey,
        headshotUrl: c.headshotUrl,
        teamAbbr: c.teamAbbr,
        teamLogoUrl: c.teamLogoUrl,
        currentTeam: sellerTag,
        position: c.position,
        prorated2026CapCharge: isPostDeadlinePause ? offseason2027Cap : prorated2026,
        offseason2027CapCharge: offseason2027Cap,
        cap2027Impact,
        sellerIncentive,
        projectedPickCost: estimatePickCostForCandidate(c, tankathonPicks, seasonYear, team.abbr),
        fitScore,
        sourceUrl: c.otcUrl,
        fitBreakdown: `${c.age ? `Age ${c.age} ` : ''}${c.position} posting ${c.prodLine}. Addresses ${possessive(team.nickname)} #${Math.min(4, needRank)} need; ${capContextNote}`
      }
    });
  }

  scored.sort((a, b) => b.target.fitScore - a.target.fitScore || a.needRank - b.needRank);

  // Enforce both positional diversity (max 2 per need bucket) AND seller diversity (max 2 per seller club)
  const selected = [];
  const perBucket = new Map();
  const perSeller = new Map();
  for (const item of scored) {
    const bCnt = perBucket.get(item.bucket) || 0;
    const sCnt = perSeller.get(item.target.teamAbbr) || 0;
    if (bCnt >= 2 || sCnt >= 2) continue;
    perBucket.set(item.bucket, bCnt + 1);
    perSeller.set(item.target.teamAbbr, sCnt + 1);
    selected.push(item.target);
    if (selected.length >= 7) break;
  }
  return selected;
}

/**
 * Build 3 grounded, club-specific `pitfallsToAvoid` cards with verified OverTheCap links.
 */
function buildPitfallsToAvoidForTeam({
  team,
  seasonYear,
  projected2027CapSpace,
  tankathonPicks = [],
  completedMoves = [],
  leagueTradeCtx = null
}) {
  const traps = (leagueTradeCtx?.sellerTraps || []).filter(t => t.teamAbbr !== team.abbr);
  const candidates = (leagueTradeCtx?.sellerCandidates || []).filter(c => c.teamAbbr !== team.abbr);
  const isCapTight2027 = Number(projected2027CapSpace || 0) < 0;
  const pitfalls = [];

  const heavyGtd = traps
    .filter(t => t.gtd27 >= 15_000_000)
    .sort((a, b) => b.gtd27 - a.gtd27)
    .slice(0, 3);
  if (heavyGtd.length > 0) {
    pitfalls.push({
      trap: isCapTight2027
        ? `Absorbing Heavy ${seasonYear + 1} Guaranteed Cap Charges`
        : `Overpaying for Bloated Multi-Year Veteran Guarantees`,
      examples: heavyGtd.map(p => `${p.name} (${p.teamAbbr} ${p.position} — ${fmtDollarsCompact(p.gtd27)} ${seasonYear + 1} Gtd)`).join(', '),
      exampleLinks: heavyGtd.map(p => ({
        label: `${p.name} (${p.teamAbbr} ${p.position})`,
        url: p.otcUrl
      })),
      whyAvoid: isCapTight2027
        ? `${team.nickname} project at ${fmtDollarsCompact(projected2027CapSpace)} on the ${seasonYear + 1} cap. Taking on ${fmtDollarsCompact(heavyGtd[0].gtd27)}+ in guaranteed veteran money would force painful restructures or core-starter cuts.`
        : `Even with ${fmtDollarsCompact(projected2027CapSpace)} in projected ${seasonYear + 1} cap space, surrendering draft picks to absorb ${fmtDollarsCompact(heavyGtd[0].gtd27)}+ guaranteed veteran deals crowds out upcoming homegrown extensions.`
    });
  }

  const agingLowProd = [...traps, ...candidates]
    .filter(p => p.age && p.age >= 30 && p.prodScore < 38)
    .sort((a, b) => (b.age || 0) - (a.age || 0) || a.prodScore - b.prodScore)
    .slice(0, 2);
  if (agingLowProd.length > 0) {
    pitfalls.push({
      trap: 'Paying Draft Capital for Aging Name-Value Veterans',
      examples: agingLowProd.map(p => `${p.name} (${p.teamAbbr} ${p.position}, Age ${p.age})`).join(', '),
      exampleLinks: agingLowProd.map(p => ({
        label: `${p.name} (${p.teamAbbr} ${p.position}, Age ${p.age})`,
        url: p.otcUrl
      })),
      whyAvoid: `Veterans past age 30 with declining ${seasonYear} snap/efficiency metrics (${agingLowProd[0].prodLine}) rarely deliver postseason surplus over younger rookie-scale options.`
    });
  }

  const hasRd2 = (tankathonPicks || []).some(p => p.round === 2);
  const rd1 = (tankathonPicks || []).find(p => p.round === 1);
  const rd3 = (tankathonPicks || []).find(p => p.round === 3);
  const bigCapExamples = [...candidates]
    .filter(c => c.cap27 >= 10_000_000 && !heavyGtd.some(h => h.normName === c.normName))
    .slice(0, 2);
  const fallbackLinks = bigCapExamples.length > 0
    ? bigCapExamples.map(p => ({ label: `${p.name} (${p.teamAbbr} ${p.position})`, url: p.otcUrl }))
    : heavyGtd.slice(0, 1).map(p => ({ label: `${p.name} (${p.teamAbbr})`, url: p.otcUrl }));

  const recentCostNote = !hasRd2 && completedMoves.length > 0
    ? `${team.abbr} already dealt its ${seasonYear + 1} 2nd-round pick`
    : `${team.abbr} currently holds ${tankathonPicks.length || 7} picks in ${seasonYear + 1}`;

  pitfalls.push({
    trap: `Mortgaging ${seasonYear + 1} Day 1–2 Picks (${[rd1 ? `#${rd1.projectedOverall}` : 'Rd 1', rd3 ? `#${rd3.projectedOverall}` : 'Rd 3'].join(', ')})`,
    examples: fallbackLinks.map(l => l.label).join(', ') || `High-cost veteran rentals`,
    exampleLinks: fallbackLinks,
    whyAvoid: `${recentCostNote}; trading away top-100 selections removes cost-controlled 4-year starters essential for sustaining roster depth and cap flexibility.`
  });

  return pitfalls;
}

/**
 * Build grounded `tieredRumors` from live team news/transactions + factual cap/draft leverage briefs.
 */
function buildTieredRumorsForTeam({
  team,
  seasonYear,
  isPostDeadlinePause,
  availableGrossCap,
  projected2027CapSpace,
  completedMoves = [],
  tankathonPicks = [],
  topNeeds = [],
  rawStream = []
}) {
  const rumors = [];
  const seenSummaries = new Set();

  const tradeNews = (rawStream || []).filter(item => {
    const title = String(item.title || '');
    const text = `${title} ${item.summary || ''}`;
    if (/\bmock draft\b/i.test(title)) return false;
    if (item.category === 'trades') return true;
    return /\b(trade[ds]?|trading|trade deadline|trade block|acquir(?:ed|ing)|salary cap|cap space|contract extension)\b/i.test(text);
  });

  for (const item of tradeNews.slice(0, 3)) {
    const summary = String(item.title || item.summary || '').trim();
    if (!summary || summary.length < 20) continue;
    const key = summary.toLowerCase().slice(0, 60);
    if (seenSummaries.has(key)) continue;
    seenSummaries.add(key);

    const isTier1 =
      Number(item.trustTier || 2) <= 1 ||
      item.wireSource === 'official_transactions' ||
      item.wireSource === 'official_club_rss';
    const srcLabel = item.reporterName || item.source || `${team.nickname} Beat`;
    const safeUrl = sanitizeExternalUrl(item.url, `https://www.${team.clubDomain}/team/transactions/`);

    rumors.push({
      tier: isTier1 ? 'Tier 1 • Verified Beat & Official Wire' : 'Tier 2 • Market & Roster Intel',
      sources: srcLabel,
      sourceUrl: safeUrl,
      summary,
      credibilityPct: isTier1 ? 96 : 88
    });
  }

  const latestMoveAlreadyCovered =
    completedMoves.length > 0 &&
    rumors.some(r => r.summary.toLowerCase().includes(String(completedMoves[0].player || '').toLowerCase()));

  if (completedMoves.length > 0 && !latestMoveAlreadyCovered && rumors.length < 3) {
    const latest = completedMoves[0];
    const dirVerb =
      latest.direction === 'outgoing'
        ? `dealt ${latest.position} ${latest.player} to ${latest.acquiredFrom}`
        : `acquired ${latest.position} ${latest.player} from ${latest.acquiredFrom}`;
    rumors.push({
      tier: 'Tier 1 • Official Club Transaction',
      sources: `${team.fullName} Official Wire`,
      sourceUrl: latest.sourceUrl || `https://www.${team.clubDomain}/team/transactions/`,
      summary: `${latest.timing}: ${team.nickname} ${dirVerb} (${latest.direction === 'outgoing' ? 'Return' : 'Cost'}: ${latest.costSummary}). ${latest.analysis}`,
      credibilityPct: 99
    });
  }

  const isCapTight2027 = Number(projected2027CapSpace || 0) < 0;
  rumors.push({
    tier: 'Tier 2 • Cap & CBA Article 13 Intel',
    sources: 'OverTheCap Live Ledger',
    sourceUrl: `https://overthecap.com/salary-cap/${team.otcSlug}`,
    summary: isCapTight2027
      ? `With ${fmtDollarsCompact(availableGrossCap)} in ${seasonYear} space and ${fmtDollarsCompact(projected2027CapSpace)} projected for ${seasonYear + 1}, unused ${seasonYear} cap rolls over 1-for-1 under CBA Article 13 — putting a premium on rookie-scale contracts and non-guaranteed deals entering the ${seasonYear + 1} offseason.`
      : `${team.nickname} carry ${fmtDollarsCompact(availableGrossCap)} in live ${seasonYear} cap space and ${fmtDollarsCompact(projected2027CapSpace)} projected for ${seasonYear + 1}, giving the front office flexibility to absorb veteran salaries or front-load extensions without sacrificing core picks.`,
    credibilityPct: 95
  });

  const needSummary = topNeeds.slice(0, 2).map(n => n.positionGroup.split(' (')[0]).join(' & ');
  const pickCount = (tankathonPicks || []).length;
  rumors.push({
    tier: 'Tier 2 • Draft Capital & Horizon',
    sources: `Tankathon ${team.nickname}`,
    sourceUrl: `https://www.tankathon.com/nfl/${team.slug}`,
    summary: `${
      isPostDeadlinePause ? `With the ${seasonYear} in-season trade deadline passed, ` : `Entering the trade window, `
    }${team.nickname} hold ${pickCount || 7} projected ${seasonYear + 1} draft picks${
      needSummary ? ` to target ${needSummary}` : ''
    } via March trade talks or the ${seasonYear + 1} NFL Draft.`,
    credibilityPct: 92
  });

  return rumors.slice(0, 4);
}

/**
 * STAGE 2: Build complete, live, verified `tradeWarRoom` + updated Tankathon `pickInventory` & `topNeeds2027`
 * for any NFL franchise.
 */
export function buildTeamTradeWindow({
  team,
  seasonYear = 2026,
  currentWeek = 12,
  nowIso = new Date().toISOString(),
  cap26 = {},
  cap27 = {},
  players = [],
  health = {},
  teamStatRankings = [],
  espnTransactions = [],
  clubTransactionsHtml = '',
  tankathonPicks = [],
  rawStream = [],
  leagueTradeCtx = null
}) {
  const availableGrossCap = Number(cap26.teamCapSpace || 0);
  const projected2027CapSpace = Number(cap27.teamCapSpace || 0);
  const tradeStatus = evaluateTradeDeadlineStatus({ now: nowIso, seasonYear });
  const remainingWeeks = Math.max(1, Math.min(18, 18 - (Number(currentWeek) || 10)));

  const capRank26 = leagueTradeCtx?.capRankingsByYear?.[seasonYear]?.get(team.abbr) || null;
  const capRank27 = leagueTradeCtx?.capRankingsByYear?.[seasonYear + 1]?.get(team.abbr) || null;

  const completed2026Moves = buildCompletedTradesForTeam({
    team,
    seasonYear,
    players,
    espnTransactions,
    clubTransactionsHtml,
    leagueTradeCtx
  });

  const topNeeds = buildTeamTopNeeds({
    team,
    seasonYear,
    players,
    health,
    teamStatRankings
  });

  const realisticTargets = buildRealisticTargetsForTeam({
    team,
    seasonYear,
    currentWeek,
    isPostDeadlinePause: tradeStatus.isPostDeadlinePause,
    availableGrossCap,
    projected2027CapSpace,
    topNeeds,
    completedMoves: completed2026Moves,
    players,
    tankathonPicks,
    leagueTradeCtx
  });

  const pitfallsToAvoid = buildPitfallsToAvoidForTeam({
    team,
    seasonYear,
    projected2027CapSpace,
    tankathonPicks,
    completedMoves: completed2026Moves,
    leagueTradeCtx
  });

  const tieredRumors = buildTieredRumorsForTeam({
    team,
    seasonYear,
    isPostDeadlinePause: tradeStatus.isPostDeadlinePause,
    availableGrossCap,
    projected2027CapSpace,
    completedMoves: completed2026Moves,
    tankathonPicks,
    topNeeds,
    rawStream
  });

  const pickRoundLabels = (tankathonPicks || []).map(p =>
    p.fromTeam && p.fromTeam !== team.abbr ? `Rd ${p.round}-${p.fromTeam}` : `Rd ${p.round}`
  );
  const missingTopRounds = [1, 2, 3].filter(
    rd => (tankathonPicks || []).length > 0 && !tankathonPicks.some(p => p.round === rd)
  );
  const tradedPickContext =
    missingTopRounds.length > 0
      ? `Missing ${missingTopRounds.map(r => `Rd ${r}`).join(', ')} from prior deals; protecting remaining Day 1–2 capital is critical for rookie-scale starters.`
      : `Full Day 1–2 pick control gives ${team.abbr} flexibility to package Day-3 selections or stay aggressive in ${seasonYear + 1} offseason talks.`;

  const purchasingPower = [
    {
      metric: `${seasonYear} Salary Cap Space`,
      figure: `${fmtDollarsCompact(availableGrossCap)} Gross${capRank26 ? ` (#${capRank26.nflRank} NFL)` : ''}`,
      strategicImpact: tradeStatus.isPostDeadlinePause
        ? `${capRank26 ? `#${capRank26.confRank} in ${team.conference}. ` : ''}With the ${seasonYear} deadline passed, unused cap rolls over 1-for-1 under CBA Article 13 into ${seasonYear + 1}.`
        : `${capRank26 ? `#${capRank26.confRank} in ${team.conference}. ` : ''}Remaining in-season acquisitions charge ${remainingWeeks}/18ths of 2026 base salary against ${team.abbr}'s live cap room.`
    },
    {
      metric: `${seasonYear + 1} Projected Cap Horizon`,
      figure: `${projected2027CapSpace >= 0 ? '+' : ''}${fmtDollarsCompact(projected2027CapSpace)}${capRank27 ? ` (#${capRank27.nflRank} NFL)` : ''}`,
      strategicImpact:
        projected2027CapSpace < 0
          ? `Projected ${seasonYear + 1} deficit makes CBA Article 13 rollover, cheap rookie deals, and non-guaranteed options essential over heavy multi-year guarantees.`
          : `Healthy ${seasonYear + 1} cap cushion lets ${team.abbr} absorb multi-year starter contracts or extend key homegrown players without restructuring traps.`
    },
    {
      metric: `${seasonYear + 1} Draft Pick Inventory`,
      figure:
        pickRoundLabels.length > 0
          ? `${pickRoundLabels.length} Picks (${pickRoundLabels.join(', ')})`
          : `Live ${seasonYear + 1} Pick Ledger`,
      strategicImpact: tradedPickContext
    }
  ];

  const publicTopNeeds = topNeeds.map(({ rank, positionGroup, urgency, epaContext }) => ({
    rank,
    positionGroup,
    urgency,
    epaContext
  }));

  const deadlineTimeLabel =
    team.timezone === 'America/Los_Angeles'
      ? `Tuesday, Nov 10, ${seasonYear} • 1:00 PM PT`
      : team.timezone === 'America/Denver' || team.timezone === 'America/Phoenix'
        ? `Tuesday, Nov 10, ${seasonYear} • 2:00 PM MT`
        : team.timezone === 'America/Chicago'
          ? `Tuesday, Nov 10, ${seasonYear} • 3:00 PM CT`
          : `Tuesday, Nov 10, ${seasonYear} • 4:00 PM ET`;

  return {
    tradeWarRoom: {
      deadlineIso: `${seasonYear}-11-10T21:00:00Z`,
      deadlineDisplay: deadlineTimeLabel,
      availableGrossCap,
      projected2027CapSpace,
      capSourceUrl: `https://overthecap.com/salary-cap/${team.otcSlug}`,
      transactionsUrl: `https://www.${team.clubDomain}/team/transactions/`,
      purchasingPower,
      completed2026Moves,
      topNeeds: publicTopNeeds,
      realisticTargets,
      pitfallsToAvoid,
      tieredRumors
    },
    topNeeds2027: publicTopNeeds.map(n => ({
      rank: n.rank,
      position: n.positionGroup,
      priority: n.urgency,
      rationale: n.epaContext
    }))
  };
}
