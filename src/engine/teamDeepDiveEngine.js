/**
 * Team Deep-Dive Deterministic Engine (< 5 ms synchronous execution)
 *
 * Powers Wave 1 & Wave 2 single-team analytical modules across all 32 NFL teams:
 * 1. Player Weekly Game Logs + 5 Core Situational Splits (`Game Log | 2026 | Career`)
 * 2. Sortable Team Player Stats (`Pass | Rush | Rec | Def`) with EPA/Efficiency
 * 3. Weekly Snap Count Heatmap Matrix (`Offense | Defense`) with 3-week role delta
 * 4. Chronological 1-Line Roster Moves Ledger + Practice Squad Elevation Counter (`X/3`)
 * 5. Upcoming Free Agent Horizon (`UFA / RFA / ERFA` + Void-Year flags) & Positional Cap Spend vs. NFL Avg
 * 6. Live NFL Scoreboard Indexing for `Playoffs → Rooting Guide`
 */

import { getTeamByAbbr, normalizeAnyTeamAbbr } from '../config/teamRegistry.js';

const CANONICAL_ABBR_OVERRIDES = {
  LA: 'LAR',
  STL: 'LAR',
  WSH: 'WAS',
  JAC: 'JAX',
  OAK: 'LV',
  SD: 'LAC'
};

function normalizeTeamCode(abbr = '') {
  const raw = String(abbr || '').trim().toUpperCase();
  if (!raw) return '';
  const mapped = CANONICAL_ABBR_OVERRIDES[raw] || normalizeAnyTeamAbbr(raw) || raw;
  return CANONICAL_ABBR_OVERRIDES[mapped] || mapped;
}

const PLAYER_CANONICAL_NAME_ALIASES = {
  ogbonniaokoronkwo: 'ogbookoronkwo',
  joshuapalmer: 'joshpalmer',
  kennethwalker: 'kenwalker',
  gabriel: 'gabe'
};

function normNameKey(name = '') {
  const raw = String(name || '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
  return PLAYER_CANONICAL_NAME_ALIASES[raw] || raw;
}

function round1(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
}

function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function fmtSigned(n, decimals = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const fixed = v.toFixed(decimals);
  return v > 0 ? `+${fixed}` : fixed;
}

// =============================================================================
// 1. PLAYER WEEKLY GAME LOGS & 5 CORE SITUATIONAL SPLITS (Wave 1A)
// =============================================================================

export function resolvePlayerGameLogRole(position = '', weeklyLog = []) {
  const p = String(position || '').toUpperCase().trim();
  if (p === 'QB') return 'qb';
  if (p === 'RB' || p === 'FB') return 'rb';
  if (p === 'WR' || p === 'TE') return 'rec';
  if (['OT', 'OG', 'G', 'C', 'OL', 'T'].includes(p)) return 'ol';
  if (p === 'K' || p === 'P' || p === 'LS') return 'st';
  // Check if a player has defensive stats/snaps
  const hasDef = (weeklyLog || []).some(w => (w.dPct || 0) > 0 || (w.tkl || 0) > 0 || (w.sck || 0) > 0);
  if (hasDef || ['DE', 'DT', 'NT', 'DL', 'EDGE', 'LB', 'ILB', 'OLB', 'MLB', 'CB', 'S', 'SS', 'FS', 'DB', 'SAF'].includes(p)) {
    return 'def';
  }
  return 'rec';
}

function formatGameLogRowByRole(w, role) {
  const snapPct =
    role === 'def'
      ? Number(w.dPct || 0)
      : role === 'st'
        ? Number(w.sPct || 0)
        : Number(w.oPct || w.sPct || 0);
  const snapStr = snapPct > 0 ? `${Math.round(snapPct)}%` : '—';

  if (role === 'qb') {
    const att = Number(w.pAtt || 0);
    const cmp = Number(w.pCmp || 0);
    const yds = Number(w.pYds || 0);
    const td = Number(w.pTd || 0);
    const ints = Number(w.pInt || 0);
    const plays = att + Number(w.pSck || 0) + Number(w.rAtt || 0);
    const totEpa = Number(w.pEpa || 0) + Number(w.rEpa || 0);
    const epaPlay = plays > 0 ? totEpa / plays : null;
    return {
      cells: [
        snapStr,
        att > 0 ? `${cmp}/${att}` : '0/0',
        String(yds),
        `${td}/${ints}`,
        epaPlay !== null ? fmtSigned(epaPlay, 2) : '—'
      ],
      highlightTone: epaPlay === null ? 'neutral' : epaPlay >= 0.1 ? 'pos' : epaPlay <= -0.1 ? 'neg' : 'neutral',
      trendValue: epaPlay !== null ? round2(epaPlay) : 0
    };
  }

  if (role === 'rb') {
    const rAtt = Number(w.rAtt || 0);
    const rYds = Number(w.rYds || 0);
    const rec = Number(w.rec || 0);
    const recYds = Number(w.recYds || 0);
    const td = Number(w.rTd || 0) + Number(w.recTd || 0);
    const totEpa = Number(w.rEpa || 0) + Number(w.recEpa || 0);
    const touches = rAtt + rec;
    const epaTouch = touches > 0 ? totEpa / touches : null;
    return {
      cells: [
        snapStr,
        rAtt > 0 ? `${rAtt}-${rYds}` : '—',
        rec > 0 ? `${rec}-${recYds}` : '—',
        String(td),
        epaTouch !== null ? fmtSigned(epaTouch, 2) : '—'
      ],
      highlightTone: epaTouch === null ? 'neutral' : epaTouch >= 0.08 ? 'pos' : epaTouch <= -0.1 ? 'neg' : 'neutral',
      trendValue: rYds + recYds
    };
  }

  if (role === 'rec') {
    const rec = Number(w.rec || 0);
    const tgt = Number(w.tgt || 0);
    const yds = Number(w.recYds || 0);
    const td = Number(w.recTd || 0) + Number(w.rTd || 0);
    const epa = tgt > 0 ? Number(w.recEpa || 0) / tgt : null;
    return {
      cells: [
        snapStr,
        tgt > 0 ? `${rec}/${tgt}` : '0/0',
        String(yds),
        String(td),
        epa !== null ? fmtSigned(epa, 2) : '—'
      ],
      highlightTone: epa === null ? 'neutral' : epa >= 0.15 ? 'pos' : epa <= -0.1 ? 'neg' : 'neutral',
      trendValue: yds
    };
  }

  if (role === 'ol') {
    const offSnaps = Number(w.oSn || 0);
    const offPct = Number(w.oPct || 0);
    const stSnaps = Number(w.sSn || 0);
    const stPct = Number(w.sPct || 0);
    return {
      cells: [
        String(offSnaps),
        offPct > 0 ? `${Math.round(offPct)}%` : '—',
        stSnaps > 0 ? `${stSnaps} (${Math.round(stPct)}%)` : '0'
      ],
      highlightTone: offPct >= 90 ? 'pos' : 'neutral',
      trendValue: Math.round(offPct)
    };
  }

  if (role === 'st') {
    const fgM = Number(w.fgM || 0);
    const fgA = Number(w.fgA || 0);
    const patM = Number(w.patM || 0);
    const patA = Number(w.patA || 0);
    const punts = Number(w.ptA || 0);
    const pYds = Number(w.ptY || 0);
    const pIn20 = Number(w.pt20 || 0);
    const isPunter = punts > 0 && fgA === 0;
    return {
      cells: isPunter
        ? [snapStr, String(punts), punts > 0 ? (pYds / punts).toFixed(1) : '—', String(pIn20)]
        : [snapStr, fgA > 0 ? `${fgM}/${fgA}` : '—', patA > 0 ? `${patM}/${patA}` : '—', Number(w.fgL || 0) > 0 ? `${w.fgL}y` : '—'],
      highlightTone: isPunter ? (pIn20 >= 2 ? 'pos' : 'neutral') : fgA > 0 && fgM === fgA ? 'pos' : fgA > fgM ? 'neg' : 'neutral',
      trendValue: isPunter ? (punts > 0 ? round1(pYds / punts) : 0) : fgM * 3 + patM
    };
  }

  // Defense
  const tkl = Number(w.tkl || 0);
  const sck = Number(w.sck || 0);
  const tfl = Number(w.tfl || 0);
  const qbh = Number(w.qbh || 0);
  const pd = Number(w.pd || 0);
  const ints = Number(w.dInt || 0);
  const splash = sck > 0 || ints > 0 || tfl >= 2;
  return {
    cells: [
      snapStr,
      String(tkl),
      sck > 0 ? String(round1(sck)) : '0',
      qbh > 0 || tfl > 0 ? `${tfl}/${qbh}` : '0/0',
      ints > 0 ? `${ints}I/${pd}` : String(pd)
    ],
    highlightTone: splash ? 'pos' : 'neutral',
    trendValue: tkl + sck * 2 + qbh + ints * 3 + pd
  };
}

function summarizeSplitBucket(rows, role) {
  if (!rows.length) return null;
  const gCount = rows.length;
  const wins = rows.filter(r => r.res === 'W').length;
  const losses = rows.filter(r => r.res === 'L').length;
  const ties = rows.filter(r => r.res === 'T').length;
  const recStr = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  const sample = wins + losses + ties > 0 ? `${gCount}G (${recStr})` : `${gCount}G`;

  if (role === 'qb') {
    const cmp = rows.reduce((s, r) => s + Number(r.pCmp || 0), 0);
    const att = rows.reduce((s, r) => s + Number(r.pAtt || 0), 0);
    const yds = rows.reduce((s, r) => s + Number(r.pYds || 0), 0);
    const td = rows.reduce((s, r) => s + Number(r.pTd || 0), 0);
    const ints = rows.reduce((s, r) => s + Number(r.pInt || 0), 0);
    const plays = att + rows.reduce((s, r) => s + Number(r.pSck || 0) + Number(r.rAtt || 0), 0);
    const totEpa = rows.reduce((s, r) => s + Number(r.pEpa || 0) + Number(r.rEpa || 0), 0);
    const cmpPct = att > 0 ? ((cmp / att) * 100).toFixed(1) : '0.0';
    const epaP = plays > 0 ? totEpa / plays : 0;
    return {
      sample,
      primary: `${cmpPct}% · ${Math.round(yds / gCount)} Y/G · ${td} TD/${ints} I`,
      badge: `${fmtSigned(epaP, 2)} EPA/p`,
      tone: epaP >= 0.1 ? 'emerald' : epaP <= -0.05 ? 'crimson' : 'gold'
    };
  }

  if (role === 'rb') {
    const rAtt = rows.reduce((s, r) => s + Number(r.rAtt || 0), 0);
    const rYds = rows.reduce((s, r) => s + Number(r.rYds || 0), 0);
    const rec = rows.reduce((s, r) => s + Number(r.rec || 0), 0);
    const recYds = rows.reduce((s, r) => s + Number(r.recYds || 0), 0);
    const td = rows.reduce((s, r) => s + Number(r.rTd || 0) + Number(r.recTd || 0), 0);
    const ypc = rAtt > 0 ? (rYds / rAtt).toFixed(1) : '—';
    const scrimPg = round1((rYds + recYds) / gCount);
    const touches = rAtt + rec;
    const epaT = touches > 0 ? rows.reduce((s, r) => s + Number(r.rEpa || 0) + Number(r.recEpa || 0), 0) / touches : 0;
    return {
      sample,
      primary: `${scrimPg} Y/G · ${ypc} YPC · ${td} TD`,
      badge: `${fmtSigned(epaT, 2)} EPA/t`,
      tone: epaT >= 0.05 ? 'emerald' : epaT <= -0.08 ? 'crimson' : 'gold'
    };
  }

  if (role === 'rec') {
    const rec = rows.reduce((s, r) => s + Number(r.rec || 0), 0);
    const tgt = rows.reduce((s, r) => s + Number(r.tgt || 0), 0);
    const yds = rows.reduce((s, r) => s + Number(r.recYds || 0), 0);
    const td = rows.reduce((s, r) => s + Number(r.recTd || 0) + Number(r.rTd || 0), 0);
    const epaT = tgt > 0 ? rows.reduce((s, r) => s + Number(r.recEpa || 0), 0) / tgt : 0;
    return {
      sample,
      primary: `${round1(rec / gCount)} Rec/G · ${round1(yds / gCount)} Y/G · ${td} TD`,
      badge: tgt > 0 ? `${fmtSigned(epaT, 2)} EPA/tgt` : `${Math.round(rows.reduce((s, r) => s + Number(r.oPct || 0), 0) / gCount)}% snaps`,
      tone: epaT >= 0.12 ? 'emerald' : epaT <= -0.05 ? 'crimson' : 'gold'
    };
  }

  if (role === 'ol') {
    const avgPct = Math.round(rows.reduce((s, r) => s + Number(r.oPct || 0), 0) / gCount);
    const totSnaps = rows.reduce((s, r) => s + Number(r.oSn || 0), 0);
    return {
      sample,
      primary: `${totSnaps} Off Snaps (${Math.round(totSnaps / gCount)}/gm)`,
      badge: `${avgPct}% snaps`,
      tone: avgPct >= 85 ? 'emerald' : 'gold'
    };
  }

  if (role === 'st') {
    const fgM = rows.reduce((s, r) => s + Number(r.fgM || 0), 0);
    const fgA = rows.reduce((s, r) => s + Number(r.fgA || 0), 0);
    const punts = rows.reduce((s, r) => s + Number(r.ptA || 0), 0);
    const pYds = rows.reduce((s, r) => s + Number(r.ptY || 0), 0);
    const p20 = rows.reduce((s, r) => s + Number(r.pt20 || 0), 0);
    if (punts > 0 && fgA === 0) {
      return {
        sample,
        primary: `${punts} Punts · ${p20} In-20`,
        badge: `${(pYds / punts).toFixed(1)} avg`,
        tone: 'gold'
      };
    }
    const pct = fgA > 0 ? Math.round((fgM / fgA) * 100) : null;
    return {
      sample,
      primary: fgA > 0 ? `${fgM}/${fgA} FG` : `${Math.round(rows.reduce((s, r) => s + Number(r.sPct || 0), 0) / gCount)}% ST snaps`,
      badge: pct !== null ? `${pct}% FG` : `${gCount}G`,
      tone: pct !== null && pct >= 85 ? 'emerald' : 'gold'
    };
  }

  // Defense
  const tkl = rows.reduce((s, r) => s + Number(r.tkl || 0), 0);
  const sck = round1(rows.reduce((s, r) => s + Number(r.sck || 0), 0));
  const qbh = rows.reduce((s, r) => s + Number(r.qbh || 0), 0);
  const ints = rows.reduce((s, r) => s + Number(r.dInt || 0), 0);
  const pd = rows.reduce((s, r) => s + Number(r.pd || 0), 0);
  const avgSnap = Math.round(rows.reduce((s, r) => s + Number(r.dPct || 0), 0) / gCount);
  return {
    sample,
    primary: `${tkl} Tkl · ${sck} Sck · ${qbh} QBH${ints ? ` · ${ints} INT` : pd ? ` · ${pd} PD` : ''}`,
    badge: `${avgSnap}% snaps`,
    tone: sck >= 2 || ints >= 1 ? 'emerald' : 'gold'
  };
}

export function buildPlayerWeeklyGameLogModel(
  player = {},
  { schedule = [], teamAbbr = 'SF', seasonYear = 2026 } = {}
) {
  const rawLog = Array.isArray(player?.weeklyLog2026)
    ? player.weeklyLog2026
    : Array.isArray(player?.weeklyLog)
      ? player.weeklyLog
      : [];

  const role = resolvePlayerGameLogRole(player?.position, rawLog);
  const teamCfg = getTeamByAbbr(teamAbbr);
  const teamDiv = teamCfg?.division || '';

  // Index team schedule by week so we can attach ESPN gameId, home/away, score & result
  const schedByWeek = new Map();
  for (const g of schedule || []) {
    if (!g || g.isByeWeek || String(g.seasonType || 'REG').toUpperCase() === 'PRE') continue;
    const wk = Number(g.week || 0);
    if (wk > 0 && !schedByWeek.has(wk)) schedByWeek.set(wk, g);
  }

  const enriched = rawLog
    .filter(w => w && Number(w.wk || w.week) > 0)
    .map(w => {
      const wk = Number(w.wk || w.week);
      const sg = schedByWeek.get(wk) || null;
      const oppAbbr = normalizeTeamCode(w.opp || sg?.opponent?.abbr || '') || String(w.opp || 'OPP');
      const oppCfg = getTeamByAbbr(oppAbbr);
      const ha = w.ha || (sg?.homeAway === 'away' ? 'away' : sg?.homeAway === 'neutral' ? 'neutral' : 'home');
      const res = w.res || sg?.result || '';
      const pf = w.pf != null ? Number(w.pf) : sg?.sfScore != null ? Number(sg.sfScore) : null;
      const pa = w.pa != null ? Number(w.pa) : sg?.oppScore != null ? Number(sg.oppScore) : null;
      const isDiv = w.div != null ? Boolean(w.div) : Boolean(teamDiv && oppCfg?.division && oppCfg.division === teamDiv);
      const espnGameId =
        (w.gid && /^\d{6,}$/.test(String(w.gid)) ? String(w.gid) : '') ||
        (sg?.id && /^\d{6,}$/.test(String(sg.id)) ? String(sg.id) : '');
      return {
        ...w,
        wk,
        opp: oppAbbr,
        ha,
        res,
        pf,
        pa,
        div: isDiv,
        gid: espnGameId
      };
    })
    .sort((a, b) => b.wk - a.wk); // Newest week first for mobile scanning

  const isPunter = role === 'st' && enriched.some(w => Number(w.ptA || 0) > 0) && !enriched.some(w => Number(w.fgA || 0) > 0);
  const headersByRole = {
    qb: ['Game', 'Res', 'Snap', 'C/A', 'Yds', 'TD/I', 'EPA/p'],
    rb: ['Game', 'Res', 'Snap', 'Rush', 'Rec', 'TD', 'EPA/t'],
    rec: ['Game', 'Res', 'Snap', 'Rec/T', 'Yds', 'TD', 'EPA/t'],
    ol: ['Game', 'Res', 'Off Sn', 'Off %', 'ST'],
    st: isPunter ? ['Game', 'Res', 'Snap', 'Punts', 'Avg', 'In20'] : ['Game', 'Res', 'Snap', 'FG', 'XP', 'Lng'],
    def: ['Game', 'Res', 'Snap', 'Tkl', 'Sck', 'TFL/QBH', 'PD/I']
  };
  const trendLabelByRole = {
    qb: 'EPA/Play Trend',
    rb: 'Scrimmage Yds Trend',
    rec: 'Receiving Yds Trend',
    ol: 'Offense Snap % Trend',
    st: isPunter ? 'Punt Avg Trend' : 'Kicking Points Trend',
    def: 'Defensive Impact Trend'
  };

  const rows = enriched.map(w => {
    const formatted = formatGameLogRowByRole(w, role);
    const locPrefix = w.ha === 'away' ? '@' : 'vs';
    const scoreStr = w.res && w.pf != null && w.pa != null ? `${w.res} ${w.pf}-${w.pa}` : w.res || '—';
    return {
      wk: w.wk,
      opp: w.opp,
      gameLabel: `W${w.wk} ${locPrefix} ${w.opp}`,
      res: w.res,
      scoreStr,
      espnGameId: w.gid,
      cells: formatted.cells,
      highlightTone: formatted.highlightTone,
      trendValue: formatted.trendValue
    };
  });

  // Chronological trend series (up to latest 8 weeks)
  const chronoRows = [...rows].reverse();
  const trendSeries = chronoRows.slice(-8).map(r => ({ wk: r.wk, val: r.trendValue }));

  // 5 Core Situational Splits (strictly factual, omitting empty buckets)
  const splitDefs = [
    { id: 'last4', label: 'Last 4 Games', subset: enriched.slice(0, 4) },
    { id: 'home', label: 'Home', subset: enriched.filter(w => w.ha === 'home') },
    { id: 'away', label: 'Away / Neutral', subset: enriched.filter(w => w.ha !== 'home') },
    { id: 'wins', label: 'In Wins', subset: enriched.filter(w => w.res === 'W') },
    { id: 'div', label: `vs. ${teamDiv || 'Division'}`, subset: enriched.filter(w => w.div) }
  ];
  const splits = splitDefs
    .map(def => {
      const sum = summarizeSplitBucket(def.subset, role);
      return sum ? { id: def.id, label: def.label, ...sum } : null;
    })
    .filter(Boolean);

  return {
    seasonYear,
    role,
    headers: headersByRole[role] || headersByRole.rec,
    trendLabel: trendLabelByRole[role] || 'Weekly Trend',
    trendSeries,
    rows,
    splits,
    hasGames: rows.length > 0
  };
}

// =============================================================================
// 2. SORTABLE TEAM PLAYER STATS (Wave 1B — Players Sub-View)
// =============================================================================

export const TEAM_PLAYER_STATS_CATEGORIES = [
  {
    key: 'pass',
    label: 'Pass',
    defaultSort: 'yards',
    cols: [
      { key: 'ca', label: 'C/A', numeric: false },
      { key: 'yards', label: 'Yds', numeric: true },
      { key: 'tds', label: 'TD/I', numeric: true },
      { key: 'epa', label: 'EPA', numeric: true, accent: true }
    ]
  },
  {
    key: 'rush',
    label: 'Rush',
    defaultSort: 'yards',
    cols: [
      { key: 'carries', label: 'Att', numeric: true },
      { key: 'yards', label: 'Yds', numeric: true },
      { key: 'ypc', label: 'YPC', numeric: true },
      { key: 'tds', label: 'TD', numeric: true },
      { key: 'epa', label: 'EPA', numeric: true, accent: true }
    ]
  },
  {
    key: 'rec',
    label: 'Rec',
    defaultSort: 'yards',
    cols: [
      { key: 'receptions', label: 'Rec', numeric: true },
      { key: 'targets', label: 'Tgt', numeric: true },
      { key: 'yards', label: 'Yds', numeric: true },
      { key: 'tds', label: 'TD', numeric: true },
      { key: 'epa', label: 'EPA', numeric: true, accent: true }
    ]
  },
  {
    key: 'def',
    label: 'Def',
    defaultSort: 'tackles',
    cols: [
      { key: 'tackles', label: 'Tkl', numeric: true },
      { key: 'tfl', label: 'TFL', numeric: true },
      { key: 'sacks', label: 'Sck', numeric: true, accent: true },
      { key: 'qbHits', label: 'QBH', numeric: true },
      { key: 'intsPd', label: 'I/PD', numeric: true }
    ]
  }
];

export function buildTeamPlayerStatsModel(
  players = [],
  { category = 'rec', sortKey = '', sortDir = 'desc' } = {}
) {
  const catDef = TEAM_PLAYER_STATS_CATEGORIES.find(c => c.key === category) || TEAM_PLAYER_STATS_CATEGORIES[2];
  const numericKeys = catDef.cols.filter(c => c.numeric).map(c => c.key);
  const activeSortKey = numericKeys.includes(sortKey) ? sortKey : catDef.defaultSort;
  const dirMult = sortDir === 'asc' ? -1 : 1;

  const rows = [];
  for (const p of players || []) {
    if (!p || !p.stats2026) continue;
    const st = p.stats2026;
    if (catDef.key === 'pass') {
      const ps = st.passing || {};
      if ((ps.attempts || 0) <= 0) continue;
      rows.push({
        id: p.id,
        name: p.shortName || p.name,
        fullName: p.name,
        position: p.position || 'QB',
        ca: `${ps.completions || 0}/${ps.attempts || 0}`,
        yards: Number(ps.yards || 0),
        yardsDisp: Number(ps.yards || 0).toLocaleString('en-US'),
        tds: Number(ps.tds || 0),
        tdsDisp: `${ps.tds || 0}/${ps.ints || 0}`,
        epa: round1(ps.epa || 0),
        epaDisp: fmtSigned(ps.epa || 0, 1)
      });
    } else if (catDef.key === 'rush') {
      const ru = st.rushing || {};
      if ((ru.carries || 0) <= 0) continue;
      const ypc = ru.carries > 0 ? round1(ru.yards / ru.carries) : 0;
      rows.push({
        id: p.id,
        name: p.shortName || p.name,
        fullName: p.name,
        position: p.position || 'RB',
        carries: Number(ru.carries || 0),
        carriesDisp: String(ru.carries || 0),
        yards: Number(ru.yards || 0),
        yardsDisp: Number(ru.yards || 0).toLocaleString('en-US'),
        ypc,
        ypcDisp: ypc.toFixed(1),
        tds: Number(ru.tds || 0),
        tdsDisp: String(ru.tds || 0),
        epa: round1(ru.epa || 0),
        epaDisp: fmtSigned(ru.epa || 0, 1)
      });
    } else if (catDef.key === 'rec') {
      const rc = st.receiving || {};
      if ((rc.targets || 0) <= 0 && (rc.receptions || 0) <= 0) continue;
      rows.push({
        id: p.id,
        name: p.shortName || p.name,
        fullName: p.name,
        position: p.position || 'WR',
        receptions: Number(rc.receptions || 0),
        receptionsDisp: String(rc.receptions || 0),
        targets: Number(rc.targets || 0),
        targetsDisp: String(rc.targets || 0),
        yards: Number(rc.yards || 0),
        yardsDisp: Number(rc.yards || 0).toLocaleString('en-US'),
        tds: Number(rc.tds || 0),
        tdsDisp: String(rc.tds || 0),
        epa: round1(rc.epa || 0),
        epaDisp: fmtSigned(rc.epa || 0, 1)
      });
    } else if (catDef.key === 'def') {
      const df = st.defense || {};
      const tkl = Number(df.totalTackles || 0);
      const sck = round1(df.sacks || 0);
      const tfl = Number(df.tfl || 0);
      const qbh = Number(df.qbHits || 0);
      const ints = Number(df.ints || 0);
      const pd = Number(df.passDefended || 0);
      if (tkl <= 0 && sck <= 0 && qbh <= 0 && ints <= 0 && pd <= 0) continue;
      rows.push({
        id: p.id,
        name: p.shortName || p.name,
        fullName: p.name,
        position: p.position || 'DEF',
        tackles: tkl,
        tacklesDisp: String(tkl),
        tfl,
        tflDisp: String(tfl),
        sacks: sck,
        sacksDisp: sck > 0 ? sck.toFixed(1) : '0',
        qbHits: qbh,
        qbHitsDisp: String(qbh),
        intsPd: ints * 10 + pd,
        intsPdDisp: ints > 0 ? `${ints}/${pd}` : `0/${pd}`
      });
    }
  }

  rows.sort((a, b) => {
    const diff = (Number(b[activeSortKey]) || 0) - (Number(a[activeSortKey]) || 0);
    if (diff !== 0) return diff * dirMult;
    return String(a.fullName || '').localeCompare(String(b.fullName || ''));
  });

  return {
    category: catDef.key,
    cols: catDef.cols,
    sortKey: activeSortKey,
    sortDir: sortDir === 'asc' ? 'asc' : 'desc',
    rows: rows.slice(0, 20)
  };
}

// =============================================================================
// 3. WEEKLY SNAP COUNT HEATMAP MATRIX (Wave 1B — Snap Trends Sub-View)
// =============================================================================

export function buildWeeklySnapMatrixModel(
  players = [],
  { unit = 'offense', maxWeeks = 8 } = {}
) {
  const isDef = String(unit || 'offense').toLowerCase() === 'defense';
  const pctField = isDef ? 'dPct' : 'oPct';
  const seasonAvgField = isDef ? 'defenseSnapPct' : 'offenseSnapPct';

  const allWeeksSet = new Set();
  for (const p of players || []) {
    for (const w of p?.weeklyLog2026 || p?.weeklyLog || []) {
      const wk = Number(w?.wk || 0);
      if (wk > 0 && Number(w?.[pctField] || 0) > 0) allWeeksSet.add(wk);
    }
  }

  const allWeeks = [...allWeeksSet].sort((a, b) => a - b);
  const displayWeeks = allWeeks.slice(-Math.max(1, maxWeeks));

  const rows = [];
  for (const p of players || []) {
    if (!p) continue;
    const log = p.weeklyLog2026 || p.weeklyLog || [];
    const byWk = new Map();
    const playedPcts = [];
    for (const w of log) {
      const wk = Number(w?.wk || 0);
      const pct = Math.round(Number(w?.[pctField] || 0));
      if (wk > 0 && pct > 0) {
        byWk.set(wk, pct);
        playedPcts.push({ wk, pct });
      }
    }
    playedPcts.sort((a, b) => a.wk - b.wk);
    const seasonAvg = Math.round(
      Number(p.snapSummary?.[seasonAvgField] || 0) ||
        (playedPcts.length ? playedPcts.reduce((s, x) => s + x.pct, 0) / playedPcts.length : 0)
    );
    if (playedPcts.length === 0 && seasonAvg <= 0) continue;

    // 3-week delta vs prior weeks (only when >= 4 played games for real signal)
    let deltaNum = null;
    if (playedPcts.length >= 4) {
      const recent3 = playedPcts.slice(-3);
      const earlier = playedPcts.slice(0, -3);
      const recAvg = recent3.reduce((s, x) => s + x.pct, 0) / recent3.length;
      const earAvg = earlier.reduce((s, x) => s + x.pct, 0) / earlier.length;
      deltaNum = Math.round(recAvg - earAvg);
    }
    const latest3Avg = playedPcts.length
      ? playedPcts.slice(-3).reduce((s, x) => s + x.pct, 0) / Math.min(3, playedPcts.length)
      : seasonAvg;

    rows.push({
      id: p.id,
      name: p.shortName || p.name,
      fullName: p.name,
      position: p.position || '',
      rosterBucket: p.rosterBucket || 'active',
      seasonAvg,
      latest3Avg,
      deltaNum,
      deltaLabel:
        deltaNum === null
          ? ''
          : Math.abs(deltaNum) <= 2
            ? '0%'
            : deltaNum > 0
              ? `↑+${deltaNum}%`
              : `↓${deltaNum}%`,
      deltaTone:
        deltaNum === null || Math.abs(deltaNum) <= 2 ? 'flat' : deltaNum > 0 ? 'up' : 'down',
      weekCells: displayWeeks.map(wk => ({
        wk,
        pct: byWk.has(wk) ? byWk.get(wk) : null
      }))
    });
  }

  rows.sort((a, b) => b.latest3Avg - a.latest3Avg || b.seasonAvg - a.seasonAvg || a.fullName.localeCompare(b.fullName));

  return {
    unit: isDef ? 'defense' : 'offense',
    weeks: displayWeeks,
    rows: rows.slice(0, 26)
  };
}

// =============================================================================
// 4. CHRONOLOGICAL 1-LINE TRANSACTIONS LEDGER & PS ELEVATION COUNTER (Wave 2A)
// =============================================================================

const POS_PREFIX_RE = /^(?:QBs?|RBs?|FBs?|WRs?|TEs?|OLs?|OTs?|OGs?|Gs?|Cs?|DLs?|DEs?|DTs?|NTs?|EDGEs?|LBs?|ILBs?|OLBs?|MLBs?|CBs?|DBs?|Ss?|FSs?|SSs?|Ks?|Ps?|LSs?)\s+/i;

function extractPosAndPlayerName(rawChunk = '') {
  const cleaned = String(rawChunk || '')
    .replace(/^(?:and|with|for|the)\s+/i, '')
    .replace(/[.,;]+$/g, '')
    .trim();
  if (!cleaned) return { pos: '', player: '' };

  let pos = '';
  let rest = cleaned;
  // Handle occasional doubled pos typos in ESPN feed ("DL DL Viliami Fehoko")
  for (let i = 0; i < 2; i += 1) {
    const m = rest.match(POS_PREFIX_RE);
    if (!m) break;
    pos = m[0].trim().replace(/s$/i, '').toUpperCase();
    rest = rest.slice(m[0].length).trim();
  }

  // Stop before trailing qualifiers ("from the practice squad", "off injured reserve", "to a ...", "with an injury ...")
  const player = rest
    .replace(
      /\s+(?:from|off|to|on|for|with|via|after|out of|by|in exchange|pending|following)\b[\s\S]*$/i,
      ''
    )
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .trim();

  return { pos, player };
}

function classifyTransactionClause(clause = '') {
  const low = String(clause || '').toLowerCase();

  if (/\belevated\b/.test(low) && /\bpractice squad\b|\bactive roster\b/.test(low)) {
    return { cat: 'ps', tag: 'PS Elev', tone: 'gold', isElevation: true };
  }
  if (/\bdesignated\b[\s\S]{0,60}\breturn\b|\b21-day\b|\bopened\b[\s\S]{0,30}\bpractice window\b/.test(low)) {
    return { cat: 'ir', tag: '21d Window', tone: 'emerald', isElevation: false };
  }
  if (/\bactivated\b[\s\S]{0,60}\b(?:injured reserve|ir|pup|nfi|physically unable)\b/.test(low)) {
    return { cat: 'ir', tag: 'Activated', tone: 'emerald', isElevation: false };
  }
  if (/\bplaced\b[\s\S]{0,60}\b(?:injured reserve|ir)\b/.test(low)) {
    return { cat: 'ir', tag: 'Placed IR', tone: 'crimson', isElevation: false };
  }
  if (/\bplaced\b[\s\S]{0,60}\b(?:pup|nfi|reserve|suspended|exempt|left squad)\b/.test(low)) {
    return { cat: 'ir', tag: 'Reserve', tone: 'amber', isElevation: false };
  }
  if (/\breinstated\b/.test(low)) {
    return { cat: 'ir', tag: 'Reinstated', tone: 'emerald', isElevation: false };
  }
  if (/\b(?:signed|re-signed|restored)\b[\s\S]{0,60}\bpractice squad\b/.test(low)) {
    return { cat: 'ps', tag: 'Signed PS', tone: 'neutral', isElevation: false };
  }
  if (/\b(?:released|terminated|cut)\b[\s\S]{0,60}\bpractice squad\b/.test(low)) {
    return { cat: 'ps', tag: 'Cut PS', tone: 'neutral', isElevation: false };
  }
  if (/\bacquired\b|\btraded\b/.test(low)) {
    return { cat: 'signing', tag: 'Trade', tone: 'gold', isElevation: false };
  }
  if (/\bclaimed\b[\s\S]{0,40}\bwaivers?\b/.test(low)) {
    return { cat: 'signing', tag: 'Claimed', tone: 'blue', isElevation: false };
  }
  if (/\bsigned\b[\s\S]{0,50}\b(?:extension|contract extension)\b|\bagreed to (?:a )?[\d-]+-year/.test(low)) {
    return { cat: 'signing', tag: 'Extended', tone: 'emerald', isElevation: false };
  }
  if (/\brestructured\b/.test(low)) {
    return { cat: 'signing', tag: 'Restructure', tone: 'gold', isElevation: false };
  }
  if (/\b(?:signed|re-signed)\b/.test(low)) {
    return { cat: 'signing', tag: 'Signed 53', tone: 'blue', isElevation: false };
  }
  if (/\bwaived\b/.test(low)) {
    return { cat: 'signing', tag: 'Waived', tone: 'crimson', isElevation: false };
  }
  if (/\breleased\b|\bcut\b|\bterminated\b/.test(low)) {
    return { cat: 'signing', tag: 'Released', tone: 'crimson', isElevation: false };
  }
  return { cat: 'signing', tag: 'Move', tone: 'neutral', isElevation: false };
}

function splitClauseIntoPlayers(clause = '') {
  // Strip leading action verb phrase ("Elevated ", "Activated ", "Placed ", "Signed ", "Waived ", "Released ", "Re-signed ", "Designated ", "Acquired ", "Reinstated ", "Claimed ", "Restructured ")
  const stripped = String(clause || '')
    .replace(
      /^(?:re-?signed|signed|waived|released|terminated|cut|activated|placed|elevated|designated|reinstated|acquired|traded|claimed|restored|restructured|exercised|tendered)\s+/i,
      ''
    )
    .trim();
  if (!stripped) return [];

  // Extract subject portion before trailing prepositional target
  const subjectPart = stripped
    .replace(
      /\s+(?:from|off|to|on|for|with|via|after|in exchange|pending|following)\b[\s\S]*$/i,
      ''
    )
    .trim();

  // Split multi-player lists ("LB Jalen Graham and WR Malik Turner", "DLs Kevin Givens and Sebastian Valdez", "A, B and C")
  const rawParts = subjectPart
    .split(/\s*,\s*and\s+|\s+and\s+|\s*,\s*/i)
    .map(s => s.trim())
    .filter(Boolean);

  let inheritedPos = '';
  const results = [];
  for (const part of rawParts) {
    const parsed = extractPosAndPlayerName(part);
    if (parsed.pos) inheritedPos = parsed.pos;
    const playerName = parsed.player;
    if (!playerName || playerName.length < 3 || /^\d+$/.test(playerName)) continue;
    results.push({
      player: playerName,
      pos: parsed.pos || inheritedPos
    });
  }
  return results;
}

/**
 * Parses raw ESPN `transactions?team=...` array into clean atomic 1-line moves
 * plus an accurate regular-season Practice Squad standard elevation counter (`X/3`).
 */
export function parseEspnTransactionsToLedger(
  rawTransactions = [],
  { teamRoster = [], seasonYear = 2026, maxItems = 120 } = {}
) {
  const rosterByNorm = new Map();
  for (const p of teamRoster || []) {
    const nk = normNameKey(p?.name);
    if (nk && !rosterByNorm.has(nk)) rosterByNorm.set(nk, p);
  }

  const seasonStartIso = `${seasonYear}-03-01`;
  const regSeasonElevationStartIso = `${seasonYear}-09-01`;
  const atomicMoves = [];
  const seenKeys = new Set();

  for (const tx of rawTransactions || []) {
    if (!tx) continue;
    const rawDate = String(tx.date || tx.dateIso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || rawDate < seasonStartIso) continue;
    const desc = String(tx.description || '').trim();
    if (!desc) continue;

    // Split multi-sentence transaction notes into individual sentences, preserving Jr./Sr./St.
    const sentences = desc
      .replace(/\b(Jr|Sr|St)\./gi, '$1__DOT__')
      .split(/\.\s+|\.(?=$)/)
      .map(s => s.replace(/__DOT__/g, '.').trim())
      .filter(Boolean);

    for (const sentence of sentences) {
      const cls = classifyTransactionClause(sentence);
      const subjects = splitClauseIntoPlayers(sentence);
      if (subjects.length === 0) {
        const key = `${rawDate}|${cls.tag}|${normNameKey(sentence.slice(0, 40))}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        atomicMoves.push({
          date: rawDate,
          cat: cls.cat,
          tag: cls.tag,
          tone: cls.tone,
          player: sentence.slice(0, 56),
          pos: '',
          playerId: null,
          isElevation: false
        });
        continue;
      }

      for (const subj of subjects) {
        const nk = normNameKey(subj.player);
        const rosterMatch = rosterByNorm.get(nk) || null;
        const resolvedName = rosterMatch?.name || subj.player;
        const resolvedPos = rosterMatch?.position || subj.pos || '';
        const dedupeKey = `${rawDate}|${cls.tag}|${nk}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        atomicMoves.push({
          date: rawDate,
          cat: cls.cat,
          tag: cls.tag,
          tone: cls.tone,
          player: resolvedName,
          pos: resolvedPos,
          playerId: rosterMatch?.id || null,
          isElevation: Boolean(cls.isElevation && rawDate >= regSeasonElevationStartIso)
        });
      }
    }
  }

  // Sort newest first
  atomicMoves.sort((a, b) => b.date.localeCompare(a.date));

  // Count regular-season Practice Squad elevations chronologically (oldest -> newest) so each move gets (1/3), (2/3), (3/3)
  const elevCountsByPlayer = new Map();
  const chronoElevations = atomicMoves.filter(m => m.isElevation).reverse();
  for (const m of chronoElevations) {
    const nk = normNameKey(m.player);
    const prev = elevCountsByPlayer.get(nk) || {
      player: m.player,
      pos: m.pos,
      playerId: m.playerId,
      used: 0,
      dates: []
    };
    prev.used += 1;
    prev.dates.push(m.date);
    if (!prev.pos && m.pos) prev.pos = m.pos;
    if (!prev.playerId && m.playerId) prev.playerId = m.playerId;
    elevCountsByPlayer.set(nk, prev);
    m.elevationNum = prev.used;
    m.tag = `PS Elev (${prev.used}/3)`;
  }

  const psElevations = [...elevCountsByPlayer.values()]
    .map(item => {
      const rosterMatch = rosterByNorm.get(normNameKey(item.player)) || null;
      return {
        player: rosterMatch?.name || item.player,
        pos: rosterMatch?.position || item.pos || '',
        playerId: rosterMatch?.id || item.playerId || null,
        used: item.used,
        max: 3,
        remaining: Math.max(0, 3 - item.used),
        rosterBucket: rosterMatch?.rosterBucket || 'other',
        lastDate: item.dates[item.dates.length - 1] || ''
      };
    })
    .sort((a, b) => {
      const aCur = a.rosterBucket === 'practice_squad' || a.rosterBucket === 'active' ? 1 : 0;
      const bCur = b.rosterBucket === 'practice_squad' || b.rosterBucket === 'active' ? 1 : 0;
      return bCur - aCur || b.used - a.used || b.lastDate.localeCompare(a.lastDate) || a.player.localeCompare(b.player);
    });

  return {
    transactions: atomicMoves.slice(0, maxItems),
    psElevations
  };
}

export function mergeTransactionsLedgers(
  existingMoves = [],
  incomingRawTransactions = [],
  { teamRoster = [], seasonYear = 2026, maxItems = 120 } = {}
) {
  const incoming = parseEspnTransactionsToLedger(incomingRawTransactions, {
    teamRoster,
    seasonYear,
    maxItems
  });

  const rosterByNorm = new Map();
  for (const p of teamRoster || []) {
    const nk = normNameKey(p?.name);
    if (nk && !rosterByNorm.has(nk)) rosterByNorm.set(nk, p);
  }

  const merged = [];
  const seen = new Set();
  for (const m of [...incoming.transactions, ...(existingMoves || [])]) {
    if (!m || !m.date || !m.player) continue;
    const baseTag = String(m.tag || 'Move').replace(/\s*\(\d+\/3\)$/, '');
    const nk = normNameKey(m.player);
    const key = `${m.date}|${baseTag}|${nk}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rosterMatch = rosterByNorm.get(nk) || null;
    merged.push({
      date: m.date,
      cat: m.cat || 'signing',
      tag: baseTag,
      tone: m.tone || 'neutral',
      player: rosterMatch?.name || m.player,
      pos: rosterMatch?.position || m.pos || '',
      playerId: rosterMatch?.id || m.playerId || null,
      isElevation: Boolean(m.isElevation || /^PS Elev/i.test(baseTag))
    });
  }

  merged.sort((a, b) => b.date.localeCompare(a.date));

  const regSeasonElevationStartIso = `${seasonYear}-09-01`;
  const elevMap = new Map();
  for (const m of merged.filter(x => x.isElevation && x.date >= regSeasonElevationStartIso).reverse()) {
    const nk = normNameKey(m.player);
    const cur = elevMap.get(nk) || {
      player: m.player,
      pos: m.pos,
      playerId: m.playerId,
      used: 0,
      lastDate: ''
    };
    cur.used += 1;
    cur.lastDate = m.date;
    elevMap.set(nk, cur);
    m.elevationNum = cur.used;
    m.tag = `PS Elev (${cur.used}/3)`;
  }

  const psElevations = [...elevMap.values()]
    .map(item => {
      const rosterMatch = rosterByNorm.get(normNameKey(item.player)) || null;
      return {
        player: rosterMatch?.name || item.player,
        pos: rosterMatch?.position || item.pos || '',
        playerId: rosterMatch?.id || item.playerId || null,
        used: item.used,
        max: 3,
        remaining: Math.max(0, 3 - item.used),
        rosterBucket: rosterMatch?.rosterBucket || 'other',
        lastDate: item.lastDate
      };
    })
    .sort((a, b) => {
      const aCur = a.rosterBucket === 'practice_squad' || a.rosterBucket === 'active' ? 1 : 0;
      const bCur = b.rosterBucket === 'practice_squad' || b.rosterBucket === 'active' ? 1 : 0;
      return bCur - aCur || b.used - a.used || b.lastDate.localeCompare(a.lastDate) || a.player.localeCompare(b.player);
    });

  return {
    transactions: merged.slice(0, maxItems),
    psElevations
  };
}

// =============================================================================
// 5. UPCOMING FREE AGENTS (UFA / RFA / ERFA) & POSITIONAL CAP SPEND (Wave 2B)
// =============================================================================

export const DEFAULT_NFL_POSITIONAL_CAP_AVG_PCT = {
  dl: 15.4,
  ol: 15.6,
  wr_te: 14.8,
  db: 12.7,
  qb: 11.4,
  lb: 6.9,
  rb_st: 5.8
};

const CAP_UNIT_DEFS = [
  { id: 'dl', label: 'DL / Edge', positions: new Set(['DE', 'DT', 'NT', 'DL', 'EDGE']) },
  { id: 'ol', label: 'Off. Line', positions: new Set(['OT', 'OG', 'G', 'C', 'OL', 'T']) },
  { id: 'wr_te', label: 'WR / TE', positions: new Set(['WR', 'TE']) },
  { id: 'db', label: 'Secondary', positions: new Set(['CB', 'S', 'FS', 'SS', 'DB', 'SAF']) },
  { id: 'qb', label: 'QB Room', positions: new Set(['QB']) },
  { id: 'lb', label: 'Linebackers', positions: new Set(['LB', 'ILB', 'OLB', 'MLB']) },
  { id: 'rb_st', label: 'RB / ST', positions: new Set(['RB', 'FB', 'K', 'P', 'LS']) }
];

function classifyCapPositionUnit(pos = '') {
  const p = String(pos || '').toUpperCase().trim();
  for (const def of CAP_UNIT_DEFS) {
    if (def.positions.has(p)) return def.id;
  }
  return 'rb_st';
}

export function buildPositionalCapSpendModel(
  capData = {},
  { yearKey = '2026', leagueAvgByUnit = null } = {}
) {
  const yrStr = String(yearKey || '2026');
  const yrRow = capData?.years?.[yrStr] || {};
  const ceiling = Math.max(1, Number(yrRow.capCeiling || 304_000_000));
  const totals = Object.fromEntries(CAP_UNIT_DEFS.map(d => [d.id, 0]));

  for (const p of capData?.players || []) {
    const c = p?.contractsByYear?.[yrStr];
    if (!c || c.isVoidYear) continue;
    const capNum = Math.max(0, Number(c.capNumber || 0));
    if (capNum <= 0) continue;
    const uid = classifyCapPositionUnit(p.position);
    totals[uid] = (totals[uid] || 0) + capNum;
  }

  const avgMap = leagueAvgByUnit || capData?.nflPositionalAvgPct || DEFAULT_NFL_POSITIONAL_CAP_AVG_PCT;
  const units = CAP_UNIT_DEFS.map(d => {
    const dollars = totals[d.id] || 0;
    const teamPct = round1((dollars / ceiling) * 100);
    const nflAvgPct = round1(avgMap[d.id] ?? DEFAULT_NFL_POSITIONAL_CAP_AVG_PCT[d.id] ?? 10);
    return {
      id: d.id,
      label: d.label,
      dollars,
      teamPct,
      nflAvgPct,
      deltaPct: round1(teamPct - nflAvgPct)
    };
  }).sort((a, b) => b.teamPct - a.teamPct);

  return {
    yearKey: yrStr,
    capCeiling: ceiling,
    units
  };
}

/**
 * Identifies upcoming free agents whose current non-void contract expires after `baseYear`
 * (entering free agency in `baseYear + 1`), classified by CBA accrued seasons (`UFA`/`RFA`/`ERFA`).
 */
export function buildUpcomingFreeAgentsModel(
  capData = {},
  rosterPlayers = [],
  { baseYear = 2026, statusFilter = 'ALL' } = {}
) {
  const yrNum = Number(baseYear) || 2026;
  const yrStr = String(yrNum);
  const targetFaYear = yrNum + 1;
  const targetFaYearStr = String(targetFaYear);

  const rosterById = new Map();
  const rosterByNorm = new Map();
  for (const p of rosterPlayers || []) {
    if (p?.id) rosterById.set(String(p.id), p);
    const nk = normNameKey(p?.name);
    if (nk && !rosterByNorm.has(nk)) rosterByNorm.set(nk, p);
  }

  const allExpiring = [];
  for (const cp of capData?.players || []) {
    if (!cp || cp.rosterBucket === 'practice_squad') continue;
    const cMap = cp.contractsByYear || {};
    const curContract = cMap[yrStr];
    if (!curContract || curContract.isVoidYear) continue;

    // Check if player has any NON-void contract year strictly after baseYear
    const futureActiveYears = Object.keys(cMap)
      .map(Number)
      .filter(y => Number.isFinite(y) && y > yrNum && !cMap[String(y)]?.isVoidYear);
    if (futureActiveYears.length > 0) continue;

    const rMatch = rosterById.get(String(cp.id || '')) || rosterByNorm.get(normNameKey(cp.name)) || null;
    if (rMatch?.rosterBucket === 'practice_squad') continue;

    const expNow = Number.isFinite(Number(rMatch?.experienceYears)) ? Number(rMatch.experienceYears) : null;
    // After completing `baseYear`, accrued seasons = experienceYears + 1 (if already >= 0)
    const accruedAfterSeason = expNow !== null ? expNow + 1 : 4;
    const faStatus = accruedAfterSeason >= 4 ? 'UFA' : accruedAfterSeason === 3 ? 'RFA' : 'ERFA';
    const hasVoidYears = Boolean(cMap[targetFaYearStr]?.isVoidYear);
    const snapPct = Number(rMatch?.primarySnapPct || 0);
    const age = Number.isFinite(Number(rMatch?.age)) ? Number(rMatch.age) : null;
    const capHit = Number(curContract.capNumber || 0);

    allExpiring.push({
      id: rMatch?.id || cp.id || null,
      name: rMatch?.name || cp.name,
      shortName: rMatch?.shortName || cp.name,
      position: rMatch?.position || cp.position || '',
      rosterBucket: rMatch?.rosterBucket || cp.rosterBucket || 'active',
      faStatus,
      hasVoidYears,
      snapPct,
      age,
      capHit,
      otcUrl: cp.otcUrl || rMatch?.otcUrl || null
    });
  }

  allExpiring.sort((a, b) => b.snapPct - a.snapPct || b.capHit - a.capHit || a.name.localeCompare(b.name));

  const counts = {
    ALL: allExpiring.length,
    UFA: allExpiring.filter(x => x.faStatus === 'UFA').length,
    RFA: allExpiring.filter(x => x.faStatus === 'RFA').length,
    ERFA: allExpiring.filter(x => x.faStatus === 'ERFA').length
  };

  const normFilter = ['ALL', 'UFA', 'RFA', 'ERFA'].includes(String(statusFilter || '').toUpperCase())
    ? String(statusFilter).toUpperCase()
    : 'ALL';

  const players =
    normFilter === 'ALL' ? allExpiring : allExpiring.filter(x => x.faStatus === normFilter);

  return {
    baseYear: yrNum,
    targetFaYear,
    statusFilter: normFilter,
    counts,
    players
  };
}

// =============================================================================
// 6. LIVE NFL SCOREBOARD MAP FOR PLAYOFFS → ROOTING GUIDE (Wave 2C-2)
// =============================================================================

export function extractLiveScoreboardMap(espnScoreboardJson = {}) {
  const events = Array.isArray(espnScoreboardJson?.events) ? espnScoreboardJson.events : [];
  const weekNum = Number(espnScoreboardJson?.week?.number || 0);
  const byMatchup = {};

  for (const ev of events) {
    const comp = ev?.competitions?.[0];
    if (!comp) continue;
    const comps = Array.isArray(comp.competitors) ? comp.competitors : [];
    const awayC = comps.find(c => c.homeAway === 'away');
    const homeC = comps.find(c => c.homeAway === 'home');
    if (!awayC || !homeC) continue;

    const away = normalizeTeamCode(awayC.team?.abbreviation || '');
    const home = normalizeTeamCode(homeC.team?.abbreviation || '');
    if (!away || !home) continue;

    const state = String(comp.status?.type?.state || ev.status?.type?.state || 'pre').toLowerCase();
    const completed = Boolean(comp.status?.type?.completed || state === 'post');
    const shortDetail = String(comp.status?.type?.shortDetail || comp.status?.type?.description || '').trim();
    const evWeek = Number(ev.week?.number || weekNum || 0);

    const entry = {
      espnGameId: String(ev.id || ''),
      week: evWeek,
      away,
      home,
      awayScore: Number(awayC.score ?? 0),
      homeScore: Number(homeC.score ?? 0),
      state: completed ? 'post' : state,
      completed,
      shortDetail
    };

    if (evWeek > 0) {
      byMatchup[`${evWeek}_${away}_${home}`] = entry;
    }
    byMatchup[`${away}_${home}`] = entry;
  }

  return byMatchup;
}

export function lookupRootingGameLiveScore(rootingGame = {}, liveScoresMap = null) {
  if (!rootingGame || !liveScoresMap || typeof liveScoresMap !== 'object') return null;
  const away = normalizeTeamCode(rootingGame.away || '');
  const home = normalizeTeamCode(rootingGame.home || '');
  const wk = Number(rootingGame.week || 0);
  if (!away || !home) return null;

  const exact = wk > 0 ? liveScoresMap[`${wk}_${away}_${home}`] : null;
  if (exact && (exact.state === 'in' || exact.state === 'post')) return exact;

  const loose = liveScoresMap[`${away}_${home}`] || null;
  if (loose && (!wk || !loose.week || Number(loose.week) === wk) && (loose.state === 'in' || loose.state === 'post')) {
    return loose;
  }
  return null;
}
