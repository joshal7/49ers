/**
 * Deterministic 3-Lens NFL Draft Big Board Engine
 *
 * Powers the 250–300 prospect Consensus / Likely Draft (Buzz & EDP) / PFF (NFL Accuracy)
 * comparison table (Desktop >= 768px) and 3-pill progressive-disclosure list (Mobile < 768px).
 *
 * Pure synchronous client engine (< 5ms across 300 prospects) with zero network dependencies.
 */

import {
  normalizePlayerKey,
  slugifyPlayerName,
  sanitizeExternalUrl,
  buildMockDraftProspectUrl,
  buildMockDraftBigBoardUrl
} from './linkIntegrity.js';

export const BIG_BOARD_LENSES = {
  consensus: {
    key: 'consensus',
    label: 'Consensus',
    shortLabel: 'Cons.',
    pillLabel: 'Consensus',
    desktopTitle: 'Consensus',
    desktopSub: 'Talent Baseline',
    badge: 'Talent & Value Baseline',
    jargonKey: 'consensus_big_board',
    defaultDir: 'asc'
  },
  buzz: {
    key: 'buzz',
    label: 'Likely (Buzz)',
    shortLabel: 'Likely',
    pillLabel: 'Likely (Buzz)',
    desktopTitle: 'Likely Draft',
    desktopSub: 'Buzz & EDP',
    badge: 'Most Likely Draft Order',
    jargonKey: 'draft_buzz_edp',
    defaultDir: 'asc'
  },
  pff: {
    key: 'pff',
    label: 'PFF (Perf.)',
    shortLabel: 'PFF',
    pillLabel: 'PFF (Perf.)',
    desktopTitle: 'PFF Value',
    desktopSub: 'NFL Accuracy',
    badge: 'Most Accurate NFL Projection',
    jargonKey: 'pff_big_board',
    defaultDir: 'asc'
  }
};

export const BIG_BOARD_LENS_ORDER = ['consensus', 'buzz', 'pff'];

export const BIG_BOARD_SORT_FIELDS = [
  { key: 'consensus', label: 'Consensus Rank', shortLabel: 'Consensus', defaultDir: 'asc' },
  { key: 'buzz', label: 'Likely Draft (Buzz / EDP)', shortLabel: 'Likely (Buzz)', defaultDir: 'asc' },
  { key: 'pff', label: 'PFF Value (NFL Accuracy)', shortLabel: 'PFF (Perf.)', defaultDir: 'asc' },
  { key: 'spread', label: 'Spread (Δ)', shortLabel: 'Spread Δ', defaultDir: 'desc' },
  { key: 'tier', label: 'Draft Tier (T1–T5)', shortLabel: 'Tier', defaultDir: 'asc' },
  { key: 'pos', label: 'Position', shortLabel: 'Position', defaultDir: 'asc' },
  { key: 'name', label: 'Player Name', shortLabel: 'Name', defaultDir: 'asc' }
];

export const BIG_BOARD_INDIVIDUAL_POSITIONS = [
  'QB',
  'RB',
  'WR',
  'TE',
  'OT',
  'IOL',
  'EDGE',
  'DL',
  'LB',
  'CB',
  'S'
];

export const BIG_BOARD_POS_BUCKETS = {
  OL: new Set(['OT', 'IOL', 'OG', 'G', 'C', 'OL', 'T', 'LT', 'RT']),
  WR_TE: new Set(['WR', 'TE']),
  DL_EDGE: new Set(['EDGE', 'DE', 'DT', 'DL', 'NT', 'IDL', 'OLB', 'ED']),
  DB_LB: new Set(['CB', 'S', 'SAF', 'FS', 'SS', 'DB', 'LB', 'ILB', 'MLB']),
  QB_RB: new Set(['QB', 'RB', 'FB', 'HB']),
  OFF: new Set(['QB', 'RB', 'FB', 'HB', 'WR', 'TE', 'OT', 'IOL', 'OG', 'G', 'C', 'OL', 'T', 'LT', 'RT']),
  DEF: new Set(['EDGE', 'DE', 'DT', 'DL', 'NT', 'IDL', 'OLB', 'ED', 'LB', 'ILB', 'MLB', 'CB', 'S', 'SAF', 'FS', 'SS', 'DB'])
};

export const BIG_BOARD_RANGE_OPTIONS = [
  { key: 'all', label: 'All Ranges' },
  { key: 'rd1', label: 'Top 32 (Rd 1)' },
  { key: 'day2', label: 'Day 2 (33–100)' },
  { key: 'day3', label: 'Day 3 (101+)' },
  { key: 'sf_window', label: 'SF Pick Window' },
  { key: 't1', label: 'Tier 1 (1–12)' },
  { key: 't2', label: 'Tier 2 (13–32)' },
  { key: 't3', label: 'Tier 3 (33–100)' },
  { key: 't4', label: 'Tier 4 (101–175)' },
  { key: 't5', label: 'Tier 5 (176+)' }
];

export const BIG_BOARD_AGREEMENT_OPTIONS = [
  { key: 'all', label: 'All Agreement' },
  { key: 'polarizing', label: 'Most Polarizing (Δ ≥ 15)' },
  { key: 'locks', label: 'Consensus Locks (Δ ≤ 5)' }
];

const POS_SORT_INDEX = new Map(BIG_BOARD_INDIVIDUAL_POSITIONS.map((p, idx) => [p, idx]));

/**
 * Maps raw prospect position labels (`OG`, `DE`, `SAF`, `ILB`, etc.) onto the 11 canonical draft positions.
 */
export function normalizeCanonicalDraftPos(rawPos = '') {
  const token = String(rawPos || '')
    .toUpperCase()
    .split(/[/,\s]+/)
    .map(s => s.trim())
    .find(Boolean) || 'ATH';

  if (token === 'QB') return 'QB';
  if (token === 'RB' || token === 'HB' || token === 'FB' || /^RB/.test(token)) return 'RB';
  if (token === 'WR' || /^WR/.test(token)) return 'WR';
  if (token === 'TE' || /^TE/.test(token)) return 'TE';
  if (token === 'OT' || token === 'LT' || token === 'RT' || token === 'T') return 'OT';
  if (token === 'IOL' || token === 'OG' || token === 'G' || token === 'C' || token === 'OL' || token === 'OC') return 'IOL';
  if (token === 'EDGE' || token === 'DE' || token === 'OLB' || token === 'ED') return 'EDGE';
  if (token === 'DL' || token === 'DT' || token === 'NT' || token === 'IDL' || /^DL/.test(token)) return 'DL';
  if (token === 'LB' || token === 'ILB' || token === 'MLB') return 'LB';
  if (token === 'CB' || token === 'CBN' || token === 'NB') return 'CB';
  if (token === 'S' || token === 'SAF' || token === 'FS' || token === 'SS' || token === 'DB') return 'S';
  return token;
}

export function resolveDraftPosUnit(canonicalPos = '') {
  if (BIG_BOARD_POS_BUCKETS.OFF.has(canonicalPos)) return 'OFF';
  if (BIG_BOARD_POS_BUCKETS.DEF.has(canonicalPos)) return 'DEF';
  return 'ATH';
}

export function computeDraftTierFromRank(rank = 999) {
  const r = Number(rank);
  if (!Number.isFinite(r) || r <= 0) return 5;
  if (r <= 12) return 1;
  if (r <= 32) return 2;
  if (r <= 100) return 3;
  if (r <= 175) return 4;
  return 5;
}

function toValidRankOrNull(val) {
  if (val === null || val === undefined || val === '' || val === 'NR') return null;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
}

export function formatShortBoardDate(isoOrYmd = '') {
  const raw = String(isoOrYmd || '').trim();
  if (!raw) return '';
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return raw;
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles'
  });
}

/**
 * Normalizes a raw prospect record (either v2 3-lens schema or legacy v1 schema)
 * into a guaranteed, deterministic prospect object with `NR` (`null`) safety.
 */
export function normalizeBigBoardProspect(raw, index = 0, draftYear = 2027) {
  if (!raw || !raw.name) return null;
  const dy = Number(draftYear) || 2027;
  const name = String(raw.name).trim();
  const slug = raw.slug || slugifyPlayerName(name);
  const canonicalPos = normalizeCanonicalDraftPos(raw.canonicalPos || raw.pos || 'ATH');
  const posGroup = raw.pos_group === 'OFF' || raw.pos_group === 'DEF'
    ? raw.pos_group
    : resolveDraftPosUnit(canonicalPos);

  const rawBoards = raw.boards && typeof raw.boards === 'object' ? raw.boards : {};
  const consRank =
    toValidRankOrNull(rawBoards.consensus?.rank) ??
    toValidRankOrNull(raw.consensusRank) ??
    index + 1;

  const buzzRank = toValidRankOrNull(rawBoards.buzz?.rank);
  const pffRank = toValidRankOrNull(rawBoards.pff?.rank ?? rawBoards.alt?.rank);

  const buzzDelta = buzzRank !== null ? consRank - buzzRank : null;
  const pffDelta = pffRank !== null ? consRank - pffRank : null;

  const lensRanks = [consRank, buzzRank, pffRank].filter(r => r !== null);
  let spread = null;
  if (Number.isFinite(raw.spread) && raw.spread >= 0 && lensRanks.length >= 2) {
    spread = Math.max(...lensRanks) - Math.min(...lensRanks);
  } else if (lensRanks.length >= 2) {
    spread = Math.max(...lensRanks) - Math.min(...lensRanks);
  } else if (!raw.boards && Number.isFinite(raw.bestRank) && Number.isFinite(raw.worstRank)) {
    spread = Math.max(0, Number(raw.worstRank) - Number(raw.bestRank));
  }

  const tier =
    Number.isFinite(Number(raw.tier)) && Number(raw.tier) >= 1 && Number(raw.tier) <= 5
      ? Number(raw.tier)
      : computeDraftTierFromRank(consRank);

  const defaultUpdated = String(rawBoards.consensus?.updated_at || raw.updatedAt || `${dy - 1}-11-12`);
  const mockDbUrl =
    sanitizeExternalUrl(raw.mockDbUrl, null) || buildMockDraftProspectUrl(dy, slug, dy);
  const profileUrl = sanitizeExternalUrl(raw.profileUrl, null) || mockDbUrl;

  return {
    ...raw,
    id: String(raw.id || `${slug}-${dy}`),
    slug,
    name,
    playerKey: normalizePlayerKey(name),
    pos: String(raw.pos || canonicalPos).trim().toUpperCase(),
    canonicalPos,
    pos_group: posGroup,
    posRank: raw.posRank || '',
    school: String(raw.school || '').trim(),
    tier,
    consensusRank: consRank,
    spread,
    boards: {
      consensus: {
        rank: consRank,
        delta: 0,
        updated_at: String(rawBoards.consensus?.updated_at || defaultUpdated)
      },
      buzz: {
        rank: buzzRank,
        delta: buzzDelta,
        updated_at: String(rawBoards.buzz?.updated_at || defaultUpdated)
      },
      pff: {
        rank: pffRank,
        delta: pffDelta,
        updated_at: String(rawBoards.pff?.updated_at || rawBoards.alt?.updated_at || defaultUpdated)
      }
    },
    profileUrl,
    mockDbUrl,
    buzzUrl:
      sanitizeExternalUrl(raw.buzzUrl, null) || 'https://grindingthemocks.com/',
    pffUrl:
      sanitizeExternalUrl(raw.pffUrl, null) || 'https://www.pff.com/draft/big-board',
    bigBoardUrl: buildMockDraftBigBoardUrl(dy)
  };
}

export function normalizeBigBoardDataset(board = [], draftYear = 2027) {
  if (!Array.isArray(board)) return [];
  const out = [];
  for (let i = 0; i < board.length; i++) {
    const item = normalizeBigBoardProspect(board[i], i, draftYear);
    if (item) out.push(item);
  }
  return out;
}

export function normalizeBigBoardSort(rawField = 'consensus', rawDir = '') {
  let field = String(rawField || 'consensus').trim().toLowerCase();
  if (field === 'alt' || field === 'analytics' || field === 'scouting') field = 'pff';
  if (field === 'edp' || field === 'likely') field = 'buzz';
  if (field === 'delta') field = 'spread';

  const spec = BIG_BOARD_SORT_FIELDS.find(s => s.key === field) || BIG_BOARD_SORT_FIELDS[0];
  let dir = String(rawDir || '').trim().toLowerCase();
  if (dir !== 'asc' && dir !== 'desc') {
    dir = spec.defaultDir;
  }
  return { field: spec.key, dir };
}

export function normalizeBigBoardLens(rawLens = 'consensus') {
  const k = String(rawLens || 'consensus').trim().toLowerCase();
  if (k === 'buzz' || k === 'likely' || k === 'edp') return 'buzz';
  if (k === 'pff' || k === 'alt' || k === 'accurate') return 'pff';
  return 'consensus';
}

function normalizeSearchQuery(raw = '') {
  return String(raw || '')
    .toLowerCase()
    .trim();
}

function stripPunct(str = '') {
  return String(str || '')
    .toLowerCase()
    .replace(/['’`. -]/g, '');
}

/**
 * Deterministic comparator enforcing:
 * - `NR` (`null` rank or `null` spread) is ALWAYS pinned to the bottom regardless of `asc` or `desc`.
 * - Ties (including two `NR` rows) break deterministically by `boards.consensus.rank ASC`, then `name ASC`.
 */
export function compareBigBoardProspects(a, b, sortField = 'consensus', sortDir = 'asc') {
  const mult = sortDir === 'desc' ? -1 : 1;
  const tieBreak = () =>
    (a.boards.consensus.rank - b.boards.consensus.rank) ||
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

  if (sortField === 'consensus' || sortField === 'buzz' || sortField === 'pff') {
    const aRank = a.boards?.[sortField]?.rank ?? null;
    const bRank = b.boards?.[sortField]?.rank ?? null;
    const aNull = aRank === null || !Number.isFinite(aRank);
    const bNull = bRank === null || !Number.isFinite(bRank);
    if (aNull && bNull) return tieBreak();
    if (aNull) return 1; // NR pinned to bottom
    if (bNull) return -1; // NR pinned to bottom
    if (aRank !== bRank) return mult * (aRank - bRank);
    return tieBreak();
  }

  if (sortField === 'spread') {
    const aSp = a.spread;
    const bSp = b.spread;
    const aNull = aSp === null || aSp === undefined || !Number.isFinite(aSp);
    const bNull = bSp === null || bSp === undefined || !Number.isFinite(bSp);
    if (aNull && bNull) return tieBreak();
    if (aNull) return 1; // NR/uncomputed spread pinned to bottom
    if (bNull) return -1;
    if (aSp !== bSp) return mult * (aSp - bSp);
    return tieBreak();
  }

  if (sortField === 'tier') {
    if (a.tier !== b.tier) return mult * (a.tier - b.tier);
    return tieBreak();
  }

  if (sortField === 'pos') {
    const aIdx = POS_SORT_INDEX.has(a.canonicalPos) ? POS_SORT_INDEX.get(a.canonicalPos) : 99;
    const bIdx = POS_SORT_INDEX.has(b.canonicalPos) ? POS_SORT_INDEX.get(b.canonicalPos) : 99;
    if (aIdx !== bIdx) return mult * (aIdx - bIdx);
    const cmpPos = a.canonicalPos.localeCompare(b.canonicalPos);
    if (cmpPos !== 0) return mult * cmpPos;
    return tieBreak();
  }

  if (sortField === 'name') {
    const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (cmp !== 0) return mult * cmp;
    return tieBreak();
  }

  return tieBreak();
}

/**
 * Full query, filter, and deterministic sort pipeline for the 3-Lens NFL Draft Big Board.
 */
export function queryBigBoardProspects(
  rawBoard = [],
  {
    draftYear = 2027,
    lens = 'consensus',
    sortField = 'consensus',
    sortDir = 'asc',
    search = '',
    posGroup = 'ALL',
    positions = [],
    range = 'all',
    agreement = 'all',
    rankedOnly = false,
    sfPickOverall = 31
  } = {}
) {
  const normalized = normalizeBigBoardDataset(rawBoard, draftYear);
  const activeLens = normalizeBigBoardLens(lens);
  const { field: cleanSortField, dir: cleanSortDir } = normalizeBigBoardSort(sortField, sortDir);

  const q = normalizeSearchQuery(search);
  const qCompact = stripPunct(q);
  const grp = String(posGroup || 'ALL').trim().toUpperCase();
  const posSet = new Set(
    (Array.isArray(positions) ? positions : [])
      .map(p => normalizeCanonicalDraftPos(p))
      .filter(p => p && p !== 'ALL')
  );
  const cleanRange = String(range || 'all').trim().toLowerCase();
  const cleanAgree = String(agreement || 'all').trim().toLowerCase();
  const minSfWin = Math.max(1, Number(sfPickOverall || 31) - 11);
  const maxSfWin = Number(sfPickOverall || 31) + 14;

  const filtered = normalized.filter(p => {
    // 1. Ranked-on-Selected-Board filter (hides NR rows on active lens or active rank sort)
    if (rankedOnly) {
      const checkLens =
        cleanSortField === 'buzz' || cleanSortField === 'pff' || cleanSortField === 'consensus'
          ? cleanSortField
          : activeLens;
      if (p.boards?.[checkLens]?.rank === null) return false;
    }

    // 2. Quick Position Group filter (`ALL`, `SF_RANGE`, `OL`, `WR_TE`, `DL_EDGE`, `DB_LB`, `QB_RB`, `OFF`, `DEF`)
    if (grp === 'SF_RANGE') {
      const r = p.boards.consensus.rank;
      if (r < minSfWin || r > maxSfWin) return false;
    } else if (grp !== 'ALL' && BIG_BOARD_POS_BUCKETS[grp]) {
      const rawTokens = String(p.pos || '')
        .toUpperCase()
        .split(/[/,\s]+/)
        .filter(Boolean);
      rawTokens.push(p.canonicalPos);
      if (!rawTokens.some(tok => BIG_BOARD_POS_BUCKETS[grp].has(tok))) return false;
    }

    // 3. Multi-select canonical positions (`QB`, `OT`, `EDGE`, etc.)
    if (posSet.size > 0 && !posSet.has(p.canonicalPos)) {
      return false;
    }

    // 4. Draft Range / Tier filter (evaluated against active lens rank if ranked, else Consensus rank)
    if (cleanRange && cleanRange !== 'all') {
      const refRank = p.boards?.[activeLens]?.rank ?? p.boards.consensus.rank;
      if (cleanRange === 'rd1' && refRank > 32) return false;
      if (cleanRange === 'day2' && (refRank < 33 || refRank > 100)) return false;
      if (cleanRange === 'day3' && refRank < 101) return false;
      if (cleanRange === 'sf_window' && (p.boards.consensus.rank < minSfWin || p.boards.consensus.rank > maxSfWin)) {
        return false;
      }
      if (/^t[1-5]$/.test(cleanRange)) {
        const targetTier = Number(cleanRange.slice(1));
        if (p.tier !== targetTier) return false;
      }
    }

    // 5. Board Agreement filter (`polarizing` spread >= 15, `locks` spread <= 5)
    if (cleanAgree === 'polarizing') {
      if (p.spread === null || p.spread < 15) return false;
    } else if (cleanAgree === 'locks') {
      if (p.spread === null || p.spread > 5) return false;
    }

    // 6. Instant Search (player name, school, position, archetype note)
    if (q) {
      const hay = `${p.name} ${p.pos} ${p.canonicalPos} ${p.posRank} ${p.school} ${p.archetypeNote || ''}`.toLowerCase();
      if (!hay.includes(q)) {
        if (qCompact.length >= 2) {
          const nameSchoolCompact = stripPunct(`${p.name} ${p.school}`);
          if (!nameSchoolCompact.includes(qCompact)) return false;
        } else {
          return false;
        }
      }
    }

    return true;
  });

  filtered.sort((a, b) => compareBigBoardProspects(a, b, cleanSortField, cleanSortDir));

  let activeFilterCount = 0;
  if (q) activeFilterCount += 1;
  if (grp !== 'ALL') activeFilterCount += 1;
  if (posSet.size > 0) activeFilterCount += 1;
  if (cleanRange !== 'all') activeFilterCount += 1;
  if (cleanAgree !== 'all') activeFilterCount += 1;
  if (rankedOnly) activeFilterCount += 1;

  const isNonDefaultSort = cleanSortField !== 'consensus' || cleanSortDir !== 'asc' || activeLens !== 'consensus';

  return {
    items: filtered,
    totalCount: normalized.length,
    filteredCount: filtered.length,
    activeLens,
    sortField: cleanSortField,
    sortDir: cleanSortDir,
    positions: [...posSet],
    posGroup: grp,
    range: cleanRange,
    agreement: cleanAgree,
    rankedOnly: Boolean(rankedOnly),
    activeFilterCount,
    hasActiveControls: activeFilterCount > 0 || isNonDefaultSort
  };
}

/**
 * Backward-compatible wrapper used by existing callers/tests (`filterConsensusBigBoard`).
 */
export function filterConsensusBigBoard(
  board = [],
  {
    search = '',
    posGroup = 'ALL',
    positions = [],
    range = 'all',
    agreement = 'all',
    rankedOnly = false,
    lens = 'consensus',
    sortField = 'consensus',
    sortDir = 'asc',
    sfPickOverall = 31,
    draftYear = 2027
  } = {}
) {
  return queryBigBoardProspects(board, {
    draftYear,
    lens,
    sortField,
    sortDir,
    search,
    posGroup,
    positions,
    range,
    agreement,
    rankedOnly,
    sfPickOverall
  }).items;
}

/**
 * Parses shareable URL query parameters (`?sort=buzz&dir=asc&pos=QB,EDGE` or `bb_*` equivalents)
 * into clean Big Board UI state.
 */
export function parseBigBoardUrlParams(searchStr = '') {
  const raw = String(searchStr || '').replace(/^\?/, '');
  if (!raw) return { hasBigBoardParams: false };

  const params = new URLSearchParams(raw);
  // Avoid colliding with unrelated views unless explicitly on draft or passing bb_* / draft params
  const hasExplicitBb =
    params.has('bb_lens') ||
    params.has('bb_sort') ||
    params.has('bb_dir') ||
    params.has('bb_pos') ||
    params.has('bb_group') ||
    params.has('bb_range') ||
    params.has('bb_agree') ||
    params.has('bb_ranked') ||
    params.has('bb_q');

  const isDraftTarget =
    params.get('sub') === 'draft' ||
    params.get('sub') === 'draft_prep' ||
    params.has('lens') ||
    (params.has('sort') && /^(consensus|buzz|pff|alt|likely|edp|spread|tier)$/i.test(params.get('sort') || '')) ||
    params.has('pos') ||
    params.has('range') ||
    params.has('agree') ||
    params.has('ranked');

  if (!hasExplicitBb && !isDraftTarget) {
    return { hasBigBoardParams: false };
  }

  const rawSort = params.get('bb_sort') || params.get('sort') || '';
  const rawDir = params.get('bb_dir') || params.get('dir') || '';
  const rawLens = params.get('bb_lens') || params.get('lens') || (rawSort === 'buzz' || rawSort === 'pff' ? rawSort : 'consensus');
  const lens = normalizeBigBoardLens(rawLens);
  const { field: sortField, dir: sortDir } = normalizeBigBoardSort(rawSort || lens, rawDir);

  const rawPosCsv = params.get('bb_pos') || params.get('pos') || '';
  const positions = rawPosCsv
    ? rawPosCsv
        .split(',')
        .map(s => normalizeCanonicalDraftPos(s))
        .filter(s => BIG_BOARD_INDIVIDUAL_POSITIONS.includes(s))
    : [];

  const rawGroup = String(params.get('bb_group') || params.get('group') || 'ALL').toUpperCase();
  const posGroup =
    rawGroup === 'ALL' || rawGroup === 'SF_RANGE' || BIG_BOARD_POS_BUCKETS[rawGroup] ? rawGroup : 'ALL';

  const rawRange = String(params.get('bb_range') || params.get('range') || 'all').toLowerCase();
  const range = BIG_BOARD_RANGE_OPTIONS.some(r => r.key === rawRange) ? rawRange : 'all';

  const rawAgree = String(params.get('bb_agree') || params.get('agree') || 'all').toLowerCase();
  const agreement = BIG_BOARD_AGREEMENT_OPTIONS.some(a => a.key === rawAgree) ? rawAgree : 'all';

  const rawRanked = params.get('bb_ranked') ?? params.get('ranked') ?? '';
  const rankedOnly = rawRanked === '1' || rawRanked === 'true';

  const search = String(params.get('bb_q') || params.get('q') || '').trim();

  return {
    hasBigBoardParams: true,
    openDraftTab: params.get('tab') === 'season' || params.get('sub') === 'draft' || params.get('sub') === 'draft_prep' || isDraftTarget,
    lens,
    sortField,
    sortDir,
    positions,
    posGroup,
    range,
    agreement,
    rankedOnly,
    search
  };
}

/**
 * Builds clean URL query string reflecting active Big Board sort & filter state.
 * Strips default values so clean unfiltered views don't clutter browser URLs.
 */
export function buildBigBoardUrlSearch(
  baseSearchStr = '',
  {
    lens = 'consensus',
    sortField = 'consensus',
    sortDir = 'asc',
    positions = [],
    posGroup = 'ALL',
    range = 'all',
    agreement = 'all',
    rankedOnly = false,
    search = '',
    includeDraftNav = false
  } = {}
) {
  const params = new URLSearchParams(String(baseSearchStr || '').replace(/^\?/, ''));
  for (const k of [
    'lens',
    'sort',
    'dir',
    'pos',
    'group',
    'range',
    'agree',
    'ranked',
    'q',
    'bb_lens',
    'bb_sort',
    'bb_dir',
    'bb_pos',
    'bb_group',
    'bb_range',
    'bb_agree',
    'bb_ranked',
    'bb_q'
  ]) {
    params.delete(k);
  }

  const cleanLens = normalizeBigBoardLens(lens);
  const { field: cleanSort, dir: cleanDir } = normalizeBigBoardSort(sortField, sortDir);
  const defaultSpec = BIG_BOARD_SORT_FIELDS.find(s => s.key === cleanSort) || BIG_BOARD_SORT_FIELDS[0];
  const cleanPos = (Array.isArray(positions) ? positions : [])
    .map(p => normalizeCanonicalDraftPos(p))
    .filter(p => BIG_BOARD_INDIVIDUAL_POSITIONS.includes(p));
  const cleanGroup = String(posGroup || 'ALL').toUpperCase();
  const cleanRange = String(range || 'all').toLowerCase();
  const cleanAgree = String(agreement || 'all').toLowerCase();
  const cleanQ = String(search || '').trim();

  const hasAnyActive =
    includeDraftNav ||
    cleanLens !== 'consensus' ||
    cleanSort !== 'consensus' ||
    cleanDir !== 'asc' ||
    cleanPos.length > 0 ||
    cleanGroup !== 'ALL' ||
    cleanRange !== 'all' ||
    cleanAgree !== 'all' ||
    Boolean(rankedOnly) ||
    Boolean(cleanQ);

  if (!hasAnyActive) {
    params.delete('tab');
    params.delete('sub');
    const rest = params.toString();
    return rest ? `?${rest}` : '';
  }

  if (includeDraftNav) {
    params.set('tab', 'season');
    params.set('sub', 'draft');
  }
  if (cleanLens !== 'consensus') params.set('lens', cleanLens);
  if (cleanSort !== 'consensus') params.set('sort', cleanSort);
  if (cleanDir !== defaultSpec.defaultDir || cleanSort !== 'consensus') params.set('dir', cleanDir);
  if (cleanPos.length > 0) params.set('pos', cleanPos.join(','));
  if (cleanGroup !== 'ALL') params.set('group', cleanGroup);
  if (cleanRange !== 'all') params.set('range', cleanRange);
  if (cleanAgree !== 'all') params.set('agree', cleanAgree);
  if (rankedOnly) params.set('ranked', '1');
  if (cleanQ) params.set('q', cleanQ);

  const out = params.toString();
  return out ? `?${out}` : '';
}
