/**
 * Live Verified NFL Power Rankings Fetcher & Parsers (`49ers.joshal.com`)
 *
 * Fetches actual live 49ers rankings and freshness metadata (record, games included,
 * throughWeek, asOfIso, prior-week delta, and real blurbs) directly from:
 *  1. Inpredictable / Betting Market Power Rating (`stats.inpredictable.com/rankings/nfl.php`)
 *  2. nfelo Quantitative Elo & EPA Power Ratings (`nfeloapp.com/nfl-power-ratings/`)
 *  3. RBSDM / nflverse Team Ratings (`rbsdm.com/api/playoff-sim/ratings` -> `rbsdm.com/#ratings`)
 *  4. ESPN Football Power Index (FPI) (`site.web.api.espn.com/.../powerindex` -> `espn.com/nfl/fpi`)
 *  5. ESPN NFL Power Rankings Panel (`espn.com` NFL news/search + `now.core.api.espn.com/v1/sports/news/<id>`)
 *  6. CBS Sports NFL Power Rankings (`cbssports.com/nfl/powerrankings/`)
 *
 * ZERO fabricated or offset ranks: if an outlet fails to fetch, it is omitted (or falls back
 * only to its last verified snapshot subject to the 24-hour post-game freshness cutoff).
 */

import {
  formatRankDelta,
  parseRecordGamesCount,
  resolveConsistentPowerRankings,
  POST_GAME_FRESHNESS_CUTOFF_HOURS
} from '../../src/engine/powerRankingsEngine.js';
import { sanitizeExternalUrl } from '../../src/engine/linkIntegrity.js';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MONTH_MAP = {
  january: '01', jan: '01',
  february: '02', feb: '02',
  march: '03', mar: '03',
  april: '04', apr: '04',
  may: '05',
  june: '06', jun: '06',
  july: '07', jul: '07',
  august: '08', aug: '08',
  september: '09', sep: '09', sept: '09',
  october: '10', oct: '10',
  november: '11', nov: '11',
  december: '12', dec: '12'
};

function decodeHtmlEntities(str = '') {
  return String(str)
    .replace(/&nbsp;?/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&rdquo;|&ldquo;/gi, '"')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&#(\d+);/g, (_, num) => {
      const code = Number(num);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
    });
}

function stripTagsClean(html = '') {
  return decodeHtmlEntities(String(html).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function truncateClean(text = '', maxLen = 210) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen - 1);
  const lastPeriod = cut.lastIndexOf('. ');
  if (lastPeriod >= Math.floor(maxLen * 0.55)) {
    return cut.slice(0, lastPeriod + 1);
  }
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

function parseMonthDayYearToIsoDate(str = '') {
  const m = String(str).match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const mm = MONTH_MAP[m[1].toLowerCase()];
  if (!mm) return null;
  const dd = String(Number(m[2])).padStart(2, '0');
  const yyyy = m[3];
  return `${yyyy}-${mm}-${dd}`;
}

function toFiniteNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatSignedNum(val, digits = 1) {
  const n = toFiniteNum(val);
  if (n == null) return '0.0';
  const fixed = n.toFixed(digits);
  return n > 0 ? `+${fixed}` : fixed;
}

async function fetchWithTimeout(url, { timeoutMs = 12000, headers = {}, fetchImpl = globalThis.fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: '*/*', ...headers },
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 1. Parse Inpredictable NFL Betting Market Rankings HTML (`stats.inpredictable.com/rankings/nfl.php`)
 */
export function parseInpredictableHtml(html) {
  if (!html || typeof html !== 'string') return null;

  const asOfMatch = html.match(/As of\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/i);
  const asOfIso = asOfMatch ? parseMonthDayYearToIsoDate(asOfMatch[1]) : null;
  const asOfLabel = asOfMatch ? asOfMatch[1].replace(/,\s*\d{4}$/, '') : null;

  const trMatches = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trMatches) {
    // Strip mouseover/mouseout tooltips before reading cell text
    const trStripped = tr
      .replace(/\sonMouse\w+\s*=\s*'[^']*'/gi, '')
      .replace(/\sonMouse\w+\s*=\s*"[^"]*"/gi, '');
    const tdMatches = [...trStripped.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (tdMatches.length < 8) continue;

    const cells = tdMatches.map(m => stripTagsClean(m[1]));
    const rankNum = Number(cells[0]);
    const teamCode = (cells[1] || '').replace(/[^A-Z]/gi, '').toUpperCase();
    if (!Number.isInteger(rankNum) || rankNum < 1 || rankNum > 32) continue;
    if (teamCode !== 'SF' && teamCode !== 'SFO') continue;

    const lstWkNum = Number(cells[2]);
    const previousRank = Number.isInteger(lstWkNum) && lstWkNum >= 1 && lstWkNum <= 32 ? lstWkNum : null;
    const delta = previousRank != null ? formatRankDelta(previousRank - rankNum) : '0';

    // Locate W-L record cell reliably (e.g. "8-1" or "8-1-0")
    const recCell = cells.find(c => /^\d{1,2}-\d{1,2}(?:-\d{1,2})?$/.test(c)) || null;
    const recParsed = parseRecordGamesCount(recCell);

    // GPF, oGPF (+rank), dGPF (+rank) from standard Inpredictable column layout
    const gpfNum = Number(cells[4]);
    const oGpfNum = Number(cells[6]);
    const oGpfRank = Number(cells[7]);
    const dGpfNum = Number(cells[9]);
    const dGpfRank = Number(cells[10]);

    // Extract Past Schedule tooltip to confirm exact highest week included (e.g. "Wk 10: @DAL")
    let throughWeek = null;
    const pastSchedMatch = tr.match(/<b>Past Schedule:<\/b>([\s\S]*?)(?:"|')/i);
    if (pastSchedMatch) {
      const wkNums = [...pastSchedMatch[1].matchAll(/Wk\s+(\d+)\s*:/gi)]
        .map(m => Number(m[1]))
        .filter(n => Number.isInteger(n) && n >= 1 && n <= 22);
      if (wkNums.length > 0) throughWeek = Math.max(...wkNums);
    }

    const metricBits = [];
    if (Number.isFinite(gpfNum)) metricBits.push(`GPF ${formatSignedNum(gpfNum, 1)}`);
    if (Number.isInteger(oGpfRank) && Number.isInteger(dGpfRank)) {
      metricBits.push(`#${oGpfRank} Offense / #${dGpfRank} Defense`);
    } else if (Number.isFinite(oGpfNum) && Number.isFinite(dGpfNum)) {
      metricBits.push(`Off ${formatSignedNum(oGpfNum, 1)} / Def ${formatSignedNum(dGpfNum, 1)}`);
    }

    const blurbParts = [];
    if (metricBits.length) blurbParts.push(`Betting market rating ${metricBits.join(' (').replace(/\(([^)]+)$/, '($1)')}`);
    if (recParsed) blurbParts.push(`at ${recParsed.normalized}`);
    if (throughWeek != null) blurbParts.push(`through Week ${throughWeek}`);
    else if (asOfLabel) blurbParts.push(`as of ${asOfLabel}`);

    const blurb = blurbParts.length
      ? `${blurbParts.join(' ')}.`
      : 'Betting-market spread implied NFL power rating.';

    return {
      id: 'inpredictable',
      outlet: 'Inpredictable / Betting Market Power Rating',
      shortName: 'Inpredictable',
      url: 'https://stats.inpredictable.com/rankings/nfl.php',
      rank: rankNum,
      previousRank,
      delta,
      reportedRecord: recParsed?.normalized || null,
      gamesIncluded: recParsed?.games ?? null,
      throughWeek,
      asOfIso,
      asOfLabel,
      verified: true,
      blurb
    };
  }
  return null;
}

/**
 * 2. Parse nfelo Power Ratings Next.js SSR HTML (`nfeloapp.com/nfl-power-ratings/`)
 */
export function parseNfeloHtml(html, { seasonYear = null } = {}) {
  if (!html || typeof html !== 'string') return null;
  const unescaped = html.replace(/\\"/g, '"');

  const objMatches = unescaped.match(/\{"team":"[A-Z]{2,3}","season":\d+,"nfelo":[0-9.]+[^}]+\}/g) || [];
  if (objMatches.length < 24) return null;

  const parsed = [];
  for (const raw of objMatches) {
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj.team === 'string' && Number.isFinite(Number(obj.nfelo))) {
        parsed.push(obj);
      }
    } catch {
      // ignore malformed match
    }
  }
  if (parsed.length < 24) return null;

  const targetSeason = seasonYear || Math.max(...parsed.map(p => Number(p.season) || 0));
  const seasonFiltered = parsed.filter(p => Number(p.season) === Number(targetSeason));
  const pool = seasonFiltered.length >= 24 ? seasonFiltered : parsed;

  const byTeam = new Map();
  for (const t of pool) {
    byTeam.set(String(t.team).toUpperCase(), t);
  }
  const teams = [...byTeam.values()];
  if (teams.length < 24) return null;

  teams.sort((a, b) => Number(b.nfelo) - Number(a.nfelo));
  const sfIdx = teams.findIndex(t => String(t.team).toUpperCase() === 'SF');
  if (sfIdx === -1) return null;

  const sf = teams[sfIdx];
  const rank = sfIdx + 1;

  // Compute exact prior-week implied rank using spreadValue - spreadValueWoWChange
  let previousRank = null;
  const allHaveWoW = teams.every(
    t => Number.isFinite(Number(t.spreadValue)) && Number.isFinite(Number(t.spreadValueWoWChange))
  );
  if (allHaveWoW) {
    const prevSorted = [...teams].sort(
      (a, b) =>
        (Number(b.spreadValue) - Number(b.spreadValueWoWChange)) -
        (Number(a.spreadValue) - Number(a.spreadValueWoWChange))
    );
    const prevIdx = prevSorted.findIndex(t => String(t.team).toUpperCase() === 'SF');
    if (prevIdx !== -1) previousRank = prevIdx + 1;
  }
  const delta = previousRank != null ? formatRankDelta(previousRank - rank) : '0';

  const wins = toFiniteNum(sf.wins);
  const losses = toFiniteNum(sf.losses);
  const ties = toFiniteNum(sf.ties) ?? 0;
  const gamesIncluded = wins != null && losses != null ? wins + losses + ties : null;
  const reportedRecord =
    wins != null && losses != null
      ? ties > 0
        ? `${wins}-${losses}-${ties}`
        : `${wins}-${losses}`
      : null;

  const nfeloScore = Math.round(Number(sf.nfelo));
  const spreadStr = Number.isFinite(Number(sf.spreadValue)) ? formatSignedNum(sf.spreadValue, 1) : null;
  const offEpaRank = Number.isFinite(Number(sf.epaPerPlayRank)) ? `#${Math.round(sf.epaPerPlayRank)} Off EPA` : null;
  const netEpaRank = Number.isFinite(Number(sf.netEpaPerPlayRank)) ? `#${Math.round(sf.netEpaPerPlayRank)} Net EPA` : null;
  const details = [
    spreadStr ? `${spreadStr} spread value` : null,
    offEpaRank,
    netEpaRank
  ].filter(Boolean);

  const blurb = `nfelo ${nfeloScore}${details.length ? ` (${details.join(', ')})` : ''}${reportedRecord ? ` at ${reportedRecord}` : ''}.`;

  return {
    id: 'nfelo',
    outlet: 'nfelo Quantitative Elo & EPA Power Ratings',
    shortName: 'nfelo',
    url: 'https://nfeloapp.com/nfl-power-ratings/',
    rank,
    previousRank,
    delta,
    reportedRecord,
    gamesIncluded,
    throughWeek: null, // Verified deterministically via exact SF W-L-T gamesIncluded
    asOfIso: null,
    asOfLabel: reportedRecord ? `${reportedRecord} record` : null,
    verified: true,
    blurb
  };
}

/**
 * 3. Parse RBSDM Team Ratings JSON (`https://rbsdm.com/api/playoff-sim/ratings` + optional `/api/meta`)
 */
export function parseRbsdmRatingsJson(ratingsJson, metaJson = null) {
  if (!ratingsJson || !Array.isArray(ratingsJson.teams) || ratingsJson.teams.length < 24) return null;
  const teams = ratingsJson.teams.filter(t => t && typeof t.team === 'string' && Number.isFinite(Number(t.win_pct)));
  if (teams.length < 24) return null;

  const sortedNow = [...teams].sort((a, b) => Number(b.win_pct) - Number(a.win_pct));
  const sfIdx = sortedNow.findIndex(t => String(t.team).toUpperCase() === 'SF');
  if (sfIdx === -1) return null;

  const sf = sortedNow[sfIdx];
  const rank = sfIdx + 1;

  let previousRank = null;
  if (teams.every(t => Number.isFinite(Number(t.week_ago_win_pct)))) {
    const sortedPrev = [...teams].sort((a, b) => Number(b.week_ago_win_pct) - Number(a.week_ago_win_pct));
    const prevIdx = sortedPrev.findIndex(t => String(t.team).toUpperCase() === 'SF');
    if (prevIdx !== -1) previousRank = prevIdx + 1;
  }
  const delta = previousRank != null ? formatRankDelta(previousRank - rank) : '0';

  const wins = toFiniteNum(sf.record_wins);
  const losses = toFiniteNum(sf.record_losses);
  const ties = toFiniteNum(sf.record_ties) ?? 0;
  const gamesIncluded = wins != null && losses != null ? wins + losses + ties : null;
  const reportedRecord =
    wins != null && losses != null
      ? ties > 0
        ? `${wins}-${losses}-${ties}`
        : `${wins}-${losses}`
      : null;

  const stamp = ratingsJson.stamp || {};
  const metaBound = Array.isArray(metaJson?.season_week_bounds)
    ? metaJson.season_week_bounds.find(b => Number(b.season) === Number(stamp.season))
    : null;
  const throughWeek = toFiniteNum(stamp.change_week) ?? toFiniteNum(metaBound?.max_week);
  const asOfIso = stamp.ratings_updated_at || null;

  const winPct = Number(sf.win_pct).toFixed(1);
  const meanWins = Number.isFinite(Number(sf.mean_wins)) ? Number(sf.mean_wins).toFixed(1) : null;
  const tierBit = Number.isFinite(Number(sf.tier)) ? `Tier ${Math.round(sf.tier)}` : 'Power rating';
  const blurb = `${tierBit} (${winPct}% neutral-field win rating${meanWins ? `, ${meanWins} proj. wins` : ''})${reportedRecord ? ` at ${reportedRecord}` : ''}${throughWeek != null ? ` through Week ${throughWeek}` : ''}.`;

  return {
    id: 'rbsdm',
    outlet: 'RBSDM / nflverse Team Ratings',
    shortName: 'RBSDM',
    url: 'https://rbsdm.com/#ratings',
    rank,
    previousRank,
    delta,
    reportedRecord,
    gamesIncluded,
    throughWeek,
    asOfIso,
    asOfLabel: throughWeek != null ? `Thru Wk ${throughWeek}` : null,
    verified: true,
    blurb
  };
}

/**
 * 4. Parse CBS Sports NFL Power Rankings HTML (`https://www.cbssports.com/nfl/powerrankings/`)
 */
export function parseCbsSportsHtml(html) {
  if (!html || typeof html !== 'string') return null;

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTagsClean(titleMatch[1]) : '';
  const wkMatch = title.match(/\bWeek\s+(\d{1,2})\b/i);
  const forWeek = wkMatch ? Number(wkMatch[1]) : null;
  const throughWeek = forWeek != null && forWeek >= 1 ? forWeek - 1 : null;

  const modMatch = html.match(/"dateModified"\s*:\s*"([^"]+)"/i) || html.match(/"datePublished"\s*:\s*"([^"]+)"/i);
  const asOfIso = modMatch ? modMatch[1] : null;

  const rowMatches = html.match(/<tr[^>]*class="[^"]*team-rankings-stats[^"]*"[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rowMatches) {
    if (!/san-francisco-49ers|>49ers<|\b49ers\b/i.test(row)) continue;

    const tdMatches = [...row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)];
    if (tdMatches.length < 4) continue;

    const rankNum = Number(stripTagsClean(tdMatches[0][2]));
    if (!Number.isInteger(rankNum) || rankNum < 1 || rankNum > 32) continue;

    const blurbRaw = tdMatches[2] ? stripTagsClean(tdMatches[2][2]) : '';
    const chgAttrs = tdMatches[3]?.[1] || '';
    const chgText = stripTagsClean(tdMatches[3]?.[2] || '');
    const chgVal = Number(chgText);
    let delta = '0';
    let previousRank = rankNum;
    if (Number.isFinite(chgVal) && chgVal > 0) {
      if (/change-up|arrow-up|\bup\b/i.test(chgAttrs)) {
        delta = `+${chgVal}`;
        previousRank = Math.min(32, rankNum + chgVal);
      } else if (/change-down|arrow-down|\bdown\b/i.test(chgAttrs)) {
        delta = `-${chgVal}`;
        previousRank = Math.max(1, rankNum - chgVal);
      }
    }

    const recText = tdMatches[4] ? stripTagsClean(tdMatches[4][2]) : '';
    const recParsed = parseRecordGamesCount(recText);

    return {
      id: 'cbs',
      outlet: 'CBS Sports NFL Power Rankings',
      shortName: 'CBS Sports',
      url: 'https://www.cbssports.com/nfl/powerrankings/',
      rank: rankNum,
      previousRank,
      delta,
      reportedRecord: recParsed?.normalized || null,
      gamesIncluded: recParsed?.games ?? null,
      throughWeek,
      forWeek,
      asOfIso,
      asOfLabel: forWeek != null ? `Week ${forWeek}` : null,
      verified: true,
      blurb: blurbRaw ? truncateClean(blurbRaw, 200) : `Pete Prisco's CBS Sports Week ${forWeek || ''} power ranking.`
    };
  }
  return null;
}

/**
 * 5. Parse ESPN Football Power Index (FPI) JSON API
 */
export function parseEspnFpiJson(fpiJson) {
  if (!fpiJson || !Array.isArray(fpiJson.teams) || fpiJson.teams.length < 24) return null;

  const catNames = {};
  for (const cat of fpiJson.categories || []) {
    if (cat?.name && Array.isArray(cat.names)) {
      catNames[cat.name] = cat.names;
    }
  }
  const sfEntry = fpiJson.teams.find(
    t => String(t?.team?.abbreviation || '').toUpperCase() === 'SF'
  );
  if (!sfEntry) return null;

  const readCat = name => {
    const names = catNames[name] || [];
    const vals = (sfEntry.categories || []).find(c => c.name === name)?.values || [];
    const out = {};
    for (let i = 0; i < names.length; i += 1) {
      out[names[i]] = vals[i];
    }
    return out;
  };

  const fpiCat = readCat('fpi');
  const effCat = readCat('efficiencies');
  const projCat = readCat('projections');

  const rankNum = Math.round(Number(fpiCat.fpirank));
  if (!Number.isInteger(rankNum) || rankNum < 1 || rankNum > 32) return null;

  const deltaNum = Number.isFinite(Number(fpiCat.rankchange7days)) ? Math.round(Number(fpiCat.rankchange7days)) : 0;
  const delta = formatRankDelta(deltaNum);
  const previousRank = Math.max(1, Math.min(32, rankNum + deltaNum));

  const winsRaw = toFiniteNum(fpiCat.numwins);
  const lossesRaw = toFiniteNum(fpiCat.numlosses);
  const tiesRaw = toFiniteNum(fpiCat.numties);
  const wins = winsRaw != null ? Math.round(winsRaw) : null;
  const losses = lossesRaw != null ? Math.round(lossesRaw) : null;
  const ties = tiesRaw != null ? Math.round(tiesRaw) : 0;
  const gamesIncluded = wins != null && losses != null ? wins + losses + ties : null;
  const reportedRecord =
    wins != null && losses != null
      ? ties > 0
        ? `${wins}-${losses}-${ties}`
        : `${wins}-${losses}`
      : null;

  const throughWeek = toFiniteNum(fpiJson.currentSeason?.type?.week?.number);
  const asOfIso = fpiJson.lastUpdated || null;

  const fpiRating = Number.isFinite(Number(fpiCat.fpi)) ? formatSignedNum(fpiCat.fpi, 1) : null;
  const offRank = Number.isFinite(Number(effCat.offefficiencyrank)) ? `#${Math.round(effCat.offefficiencyrank)} Off` : null;
  const defRank = Number.isFinite(Number(effCat.defefficiencyrank)) ? `#${Math.round(effCat.defefficiencyrank)} Def` : null;
  const projW = Number.isFinite(Number(projCat.projectedw)) ? `${Number(projCat.projectedw).toFixed(1)} proj. wins` : null;
  const sbPct = Number.isFinite(Number(projCat.probwintitle)) ? `${Number(projCat.probwintitle).toFixed(1)}% SB odds` : null;

  const bits = [
    offRank && defRank ? `${offRank} / ${defRank} efficiency` : null,
    projW,
    sbPct
  ].filter(Boolean);

  const blurb = `FPI ${fpiRating || ''}${bits.length ? ` (${bits.join(', ')})` : ''}${reportedRecord ? ` at ${reportedRecord}` : ''}.`.replace(/\s+/g, ' ').trim();

  return {
    id: 'espn_fpi',
    outlet: 'ESPN Football Power Index (FPI)',
    shortName: 'ESPN FPI',
    url: 'https://www.espn.com/nfl/fpi',
    rank: rankNum,
    previousRank,
    delta,
    reportedRecord,
    gamesIncluded,
    throughWeek,
    asOfIso,
    asOfLabel: throughWeek != null ? `Thru Wk ${throughWeek}` : null,
    verified: true,
    blurb
  };
}

/**
 * 6. Parse ESPN Weekly NFL Power Rankings Panel Article (`now.core.api.espn.com/v1/sports/news/<id>`)
 */
export function parseEspnPanelArticle(articleMeta = {}, storyHtml = '') {
  if (!storyHtml || typeof storyHtml !== 'string') return null;
  const headline = String(articleMeta.headline || '');
  const url = sanitizeExternalUrl(articleMeta.url || '', null);
  if (!url || !/espn\.com\/nfl\/story\//i.test(url)) return null;

  const wkMatch =
    headline.match(/\bWeek\s+(\d{1,2})\b/i) ||
    url.match(/power-rankings-week-(\d{1,2})\b/i);
  const forWeek = wkMatch ? Number(wkMatch[1]) : null;
  const throughWeek = forWeek != null && forWeek >= 1 ? forWeek - 1 : null;

  const plain = stripTagsClean(storyHtml);
  // Match "1. San Francisco 49ers (8-1)" or "2. San Francisco 49ers"
  const sfMatch = plain.match(
    /(?:^|\s)(\d{1,2})\.\s*San Francisco 49ers\s*(?:\((\d{1,2}-\d{1,2}(?:-\d{1,2})?)\))?([\s\S]{0,650})/i
  );
  if (!sfMatch) return null;

  const rankNum = Number(sfMatch[1]);
  if (!Number.isInteger(rankNum) || rankNum < 1 || rankNum > 32) return null;

  const recParsed = parseRecordGamesCount(sfMatch[2] || '');
  const tail = sfMatch[3] || '';

  // Stop tail before next ranked team (e.g., "2. Buffalo Bills")
  const nextTeamIdx = tail.search(/\s\d{1,2}\.\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\s*\(/);
  const sfBody = nextTeamIdx > 20 ? tail.slice(0, nextTeamIdx).trim() : tail.trim();

  const prevRankMatch = sfBody.match(/(?:Week\s+\d+\s+ranking|Previous\s+ranking|Last\s+week)\s*:\s*(\d{1,2})/i);
  const previousRank = prevRankMatch ? Number(prevRankMatch[1]) : null;
  const delta = previousRank != null ? formatRankDelta(previousRank - rankNum) : '0';

  const resultMatch = sfBody.match(/Week\s+\d+\s+result\s*:\s*([^.]+?)(?=\s+Week\s+\d+\s+ranking|\s+Previous\s+ranking|$)/i);
  const resultClause = resultMatch ? resultMatch[1].trim() : '';

  // Strip structured lead-in fields to get the editorial takeaway sentence
  const cleanedEditorial = sfBody
    .replace(/Week\s+\d+\s+result\s*:[^:]*?(?=Week\s+\d+\s+ranking|Previous\s+ranking|$)/i, '')
    .replace(/(?:Week\s+\d+\s+ranking|Previous\s+ranking)\s*:\s*\d{1,2}\s*/i, '')
    .trim();

  const blurb = truncateClean(
    resultClause && cleanedEditorial
      ? `${resultClause}. ${cleanedEditorial}`
      : cleanedEditorial || resultClause || `ESPN NFL Nation panel Week ${forWeek || ''} ranking.`,
    200
  );

  return {
    id: 'espn_panel',
    outlet: 'ESPN NFL Power Rankings Panel',
    shortName: 'ESPN Panel',
    url,
    rank: rankNum,
    previousRank,
    delta,
    reportedRecord: recParsed?.normalized || null,
    gamesIncluded: recParsed?.games ?? null,
    throughWeek,
    forWeek,
    asOfIso: articleMeta.published || null,
    asOfLabel: forWeek != null ? `Week ${forWeek}` : null,
    verified: true,
    blurb
  };
}

/**
 * Discovers the newest ESPN NFL Power Rankings weekly panel article across provided
 * ESPN news articles + ESPN Search API. Strictly excludes College Football / NBA / Fantasy.
 */
async function discoverAndFetchEspnPanel({ seasonYear, currentWeek, espnNewsArticles = [], fetchImpl = globalThis.fetch }) {
  const candidates = [];
  const pushCandidate = item => {
    const hl = String(item?.headline || item?.displayName || item?.title || '');
    const href = String(item?.links?.web?.href || item?.link?.web || item?.url || '');
    if (!hl || !href) return;
    if (item?.premium) return;
    if (!/espn\.com\/nfl\/story\//i.test(href)) return;
    if (!/nfl\s+power\s+rankings/i.test(hl) && !/nfl-power-rankings/i.test(href)) return;
    if (/fantasy|college|ncaa|nba|mlb|nhl/i.test(href)) return;
    const idMatch = href.match(/\/id\/(\d+)/);
    if (!idMatch) return;
    const wkMatch = hl.match(/\bWeek\s+(\d{1,2})\b/i) || href.match(/week-(\d{1,2})\b/i);
    candidates.push({
      id: idMatch[1],
      headline: hl,
      url: href,
      published: item?.published || item?.date || null,
      forWeek: wkMatch ? Number(wkMatch[1]) : 0
    });
  };

  for (const a of espnNewsArticles || []) pushCandidate(a);

  // Also query ESPN Search API specifically for current week's NFL Power Rankings
  const searchQueries = [
    `NFL power rankings week ${currentWeek} ${seasonYear}`,
    `NFL power rankings ${seasonYear}`
  ];
  for (const q of searchQueries) {
    try {
      const text = await fetchWithTimeout(
        `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(q)}&limit=8&type=article`,
        { timeoutMs: 10000, fetchImpl }
      );
      const data = JSON.parse(text);
      const contents = data?.results?.[0]?.contents || [];
      for (const c of contents) pushCandidate(c);
    } catch {
      // ignore search failure
    }
  }

  if (!candidates.length) return null;

  // Dedupe by story id, pick highest week then newest published timestamp
  const byId = new Map();
  for (const c of candidates) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }
  const best = [...byId.values()].sort(
    (a, b) =>
      (b.forWeek || 0) - (a.forWeek || 0) ||
      (Date.parse(b.published || '') || 0) - (Date.parse(a.published || '') || 0)
  )[0];

  const storyRespText = await fetchWithTimeout(
    `https://now.core.api.espn.com/v1/sports/news/${best.id}`,
    { timeoutMs: 12000, fetchImpl }
  );
  const storyJson = JSON.parse(storyRespText);
  const headlineObj = storyJson?.headlines?.[0] || {};
  const storyHtml = headlineObj.story || '';
  return parseEspnPanelArticle(
    {
      headline: headlineObj.headline || best.headline,
      url: best.url,
      published: headlineObj.published || best.published
    },
    storyHtml
  );
}

/**
 * Fetches all 6 live NFL Power Rankings sources in parallel, preserves last verified snapshot
 * on transient per-source network failure (never fabricating ranks), and enforces strict
 * week consistency + 24-hour post-game freshness cutoff via `resolveConsistentPowerRankings`.
 */
export async function fetchLivePowerRankings({
  seasonYear = 2026,
  currentWeek = 1,
  schedule = [],
  sfRecord = null,
  oppShortName = null,
  espnNewsArticles = [],
  previousPowerRankings = null,
  nowMs = Date.now(),
  cutoffHours = POST_GAME_FRESHNESS_CUTOFF_HOURS,
  fetchImpl = globalThis.fetch
} = {}) {
  const prevById = new Map();
  const prevList = Array.isArray(previousPowerRankings?.allSources)
    ? previousPowerRankings.allSources
    : Array.isArray(previousPowerRankings?.sources)
      ? previousPowerRankings.sources
      : [];
  for (const p of prevList) {
    if (p && p.verified === true && p.id) {
      prevById.set(p.id, p);
    }
  }

  const tasks = [
    {
      id: 'inpredictable',
      run: async () => {
        const html = await fetchWithTimeout('https://stats.inpredictable.com/rankings/nfl.php', { fetchImpl });
        return parseInpredictableHtml(html);
      }
    },
    {
      id: 'nfelo',
      run: async () => {
        const html = await fetchWithTimeout('https://www.nfeloapp.com/nfl-power-ratings/', { fetchImpl });
        return parseNfeloHtml(html, { seasonYear });
      }
    },
    {
      id: 'rbsdm',
      run: async () => {
        const [ratingsTxt, metaTxt] = await Promise.all([
          fetchWithTimeout('https://rbsdm.com/api/playoff-sim/ratings', { fetchImpl }),
          fetchWithTimeout('https://rbsdm.com/api/meta', { fetchImpl }).catch(() => null)
        ]);
        return parseRbsdmRatingsJson(JSON.parse(ratingsTxt), metaTxt ? JSON.parse(metaTxt) : null);
      }
    },
    {
      id: 'cbs',
      run: async () => {
        const html = await fetchWithTimeout('https://www.cbssports.com/nfl/powerrankings/', { fetchImpl });
        return parseCbsSportsHtml(html);
      }
    },
    {
      id: 'espn_fpi',
      run: async () => {
        const txt = await fetchWithTimeout(
          `https://site.web.api.espn.com/apis/fitt/v3/sports/football/nfl/powerindex?region=us&lang=en&season=${seasonYear}&limit=32`,
          { fetchImpl }
        );
        return parseEspnFpiJson(JSON.parse(txt));
      }
    },
    {
      id: 'espn_panel',
      run: async () => discoverAndFetchEspnPanel({ seasonYear, currentWeek, espnNewsArticles, fetchImpl })
    }
  ];

  const settled = await Promise.allSettled(tasks.map(t => t.run()));
  const allSources = [];

  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i];
    const outcome = settled[i];
    if (outcome.status === 'fulfilled' && outcome.value && Number.isInteger(outcome.value.rank)) {
      allSources.push(outcome.value);
    } else {
      const errMsg = outcome.status === 'rejected' ? outcome.reason?.message || String(outcome.reason) : 'empty parse';
      console.warn(`[power-rankings] ${task.id} live fetch skipped (${errMsg})`);
      // Fall back ONLY to previously-verified snapshot for that exact outlet (never synthesize!)
      const prev = prevById.get(task.id);
      if (prev) allSources.push(prev);
    }
  }

  return resolveConsistentPowerRankings(
    {
      allSources,
      fetchedAtIso: new Date(nowMs).toISOString()
    },
    schedule,
    {
      nowMs,
      cutoffHours,
      currentWeek,
      sfRecord,
      oppShortName
    }
  );
}
