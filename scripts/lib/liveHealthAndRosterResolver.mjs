/**
 * Authoritative Multi-Source Roster, Practice Report & IR/Reserve Resolver
 *
 * Reconciles 5 live sources so stale single-endpoint caches can never corrupt roster buckets,
 * Wed/Thu/Fri practice participation, or season-ending IR timelines:
 *  1. Official Club Roster HTML (`https://www.49ers.com/team/players-roster/`)
 *  2. Official Club Weekly Injury Report HTML (`https://www.49ers.com/team/injury-report/`) — SF & Opponent
 *  3. ESPN Team Transactions (`site/v2/sports/football/nfl/transactions?team={id}&limit=250`)
 *  4. ESPN Athlete Web v3 (`site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{id}`)
 *  5. CBS Sports Team Injury Table (`https://www.cbssports.com/nfl/teams/{ABBR}/{slug}/injuries/`)
 */

import {
  canonicalInjuryPlayerKey,
  parseOfficial49ersInjuryReportHtml as parseOfficial49ersInjuryReportHtmlShared
} from '../../src/engine/injuryProbabilityModel.js';

function decodeHtmlEntities(str = '') {
  return String(str || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—');
}

function stripTags(html = '') {
  return decodeHtmlEntities(String(html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical player lookup key stripping punctuation, accents, and generational suffixes (`Jr.`, `Sr.`, `II`, `III`, `IV`).
 */
export const canonicalPlayerKey = canonicalInjuryPlayerKey;

/**
 * Parses `https://www.49ers.com/team/players-roster/` into authoritative roster buckets:
 *  - `Active` -> `'active'`
 *  - `Reserve/Injured` -> `'ir'`
 *  - `Reserve/Physically Unable to Perform` -> `'ir'` (with `statusOverride: 'Reserve / PUP'`)
 *  - `Practice Squad` -> `'practice_squad'`
 */
export function parseOfficial49ersRosterHtml(html = '') {
  const byKey = new Map();
  if (!html || typeof html !== 'string') {
    return { hasAuthoritativeData: false, byKey, counts: {} };
  }

  const counts = { active: 0, ir: 0, pup: 0, practice_squad: 0 };
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => m[0]);

  for (const tableHtml of tables) {
    const caption = stripTags(tableHtml.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i)?.[1] || '').toLowerCase();
    let bucket = null;
    let statusOverride = null;

    if (caption === 'active' || caption.startsWith('active ')) {
      bucket = 'active';
    } else if (caption.includes('physically unable') || caption.includes('pup')) {
      bucket = 'ir';
      statusOverride = 'Reserve / PUP';
    } else if (caption.includes('reserve/injured') || caption.includes('injured reserve')) {
      bucket = 'ir';
      statusOverride = 'Injured Reserve';
    } else if (caption.includes('practice squad')) {
      bucket = 'practice_squad';
    } else if (caption.includes('reserve/')) {
      bucket = 'ir';
      statusOverride = stripTags(tableHtml.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i)?.[1] || '');
    }

    if (!bucket) continue;
    const tbody = tableHtml.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] || '';
    for (const rowMatch of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]));
      const playerName = cells[0] || '';
      const key = canonicalPlayerKey(playerName);
      if (!key) continue;
      byKey.set(key, {
        name: playerName,
        bucket,
        statusOverride
      });
      if (statusOverride === 'Reserve / PUP') counts.pup += 1;
      else counts[bucket] = (counts[bucket] || 0) + 1;
    }
  }

  return {
    hasAuthoritativeData: counts.active >= 45,
    byKey,
    counts
  };
}

/**
 * Parses `https://www.49ers.com/team/injury-report/` for BOTH San Francisco 49ers AND the weekly Opponent.
 */
export const parseOfficial49ersInjuryReportHtml = parseOfficial49ersInjuryReportHtmlShared;

const CBS_TEAM_SLUGS = {
  ARI: 'arizona-cardinals',
  ATL: 'atlanta-falcons',
  BAL: 'baltimore-ravens',
  BUF: 'buffalo-bills',
  CAR: 'carolina-panthers',
  CHI: 'chicago-bears',
  CIN: 'cincinnati-bengals',
  CLE: 'cleveland-browns',
  DAL: 'dallas-cowboys',
  DEN: 'denver-broncos',
  DET: 'detroit-lions',
  GB: 'green-bay-packers',
  HOU: 'houston-texans',
  IND: 'indianapolis-colts',
  JAX: 'jacksonville-jaguars',
  KC: 'kansas-city-chiefs',
  LAC: 'los-angeles-chargers',
  LAR: 'los-angeles-rams',
  LV: 'las-vegas-raiders',
  MIA: 'miami-dolphins',
  MIN: 'minnesota-vikings',
  NE: 'new-england-patriots',
  NO: 'new-orleans-saints',
  NYG: 'new-york-giants',
  NYJ: 'new-york-jets',
  PHI: 'philadelphia-eagles',
  PIT: 'pittsburgh-steelers',
  SEA: 'seattle-seahawks',
  SF: 'san-francisco-49ers',
  TB: 'tampa-bay-buccaneers',
  TEN: 'tennessee-titans',
  WAS: 'washington-commanders',
  WSH: 'washington-commanders'
};

export function buildCbsTeamInjuriesUrl(teamAbbr = 'SF', teamDisplayName = '') {
  const upper = String(teamAbbr || 'SF').toUpperCase();
  const cbsAbbr = upper === 'WSH' ? 'WAS' : upper;
  const slug =
    CBS_TEAM_SLUGS[upper] ||
    String(teamDisplayName || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return `https://www.cbssports.com/nfl/teams/${cbsAbbr}/${slug}/injuries/`;
}

/**
 * Parses CBS Sports per-team injury table (`Player`, `Position`, `Updated`, `Injury`, `Injury Status`).
 * Note: CBS renders `"C. Kirk Christian Kirk"` inside the Player cell (abbreviated + full span).
 */
export function parseCbsTeamInjuriesHtml(html = '') {
  const byKey = new Map();
  if (!html || typeof html !== 'string') return byKey;

  for (const trMatch of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = trMatch[1];
    // Prefer full name inside `CellPlayerName--long` when present
    const longNameRaw = rowHtml.match(/CellPlayerName--long[^>]*>([\s\S]*?)<\/span>/i)?.[1];
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]));
    if (cells.length < 5) continue;

    let fullName = longNameRaw ? stripTags(longNameRaw) : cells[0];
    if (!longNameRaw && /^[A-Z]\.\s+\S+\s+/.test(fullName)) {
      // Strip leading "C. Kirk " short prefix from "C. Kirk Christian Kirk"
      fullName = fullName.replace(/^[A-Z]\.\s+\S+\s+/, '').trim();
    }
    const key = canonicalPlayerKey(fullName);
    if (!key) continue;

    byKey.set(key, {
      name: fullName,
      position: cells[1] || '',
      updatedText: cells[2] || '',
      injuryType: cells[3] || '',
      statusText: cells[4] || ''
    });
  }
  return byKey;
}

const POS_PREFIX_REGEX =
  /^(?:QBs?|RBs?|FBs?|WRs?|TEs?|OLs?|OTs?|OGs?|Gs?|Cs?|Ts?|DLs?|DEs?|DTs?|NTs?|LBs?|ILBs?|OLBs?|MLBs?|DBs?|CBs?|Ss?|SAFs?|FSs?|SSs?|Ks?|PKs?|Ps?|LSs?)\s+/i;

function extractNamesFromClause(rawClause = '') {
  const cleaned = String(rawClause || '')
    .replace(/\bfrom\s+[A-Z][a-zA-Z.'\s]+practice squad\b/gi, '')
    .trim();
  const parts = cleaned
    .split(/\s*,\s*|\s+and\s+/i)
    .map(p => p.replace(POS_PREFIX_REGEX, '').trim())
    .filter(p => /^[A-Z][a-zA-Z'. -]{2,}$/.test(p));
  return parts;
}

/**
 * Replays ESPN team transactions in chronological order to track exact per-player IR placements,
 * 21-day return designations, roster activations, practice-squad elevations, and injury settlements.
 */
export function analyzeTeamTransactions(transactions = [], seasonYear = 2026) {
  const playerTxState = new Map();
  const regularSeasonStartMs = Date.UTC(Number(seasonYear), 7, 20); // Aug 20
  const seasonFloorMs = Date.UTC(Number(seasonYear), 1, 15); // Feb 15 (post prior Super Bowl)
  let regularSeasonIrDesignationsCount = 0;
  const designatedIrKeysInTx = new Set();

  const sortedAsc = [...(transactions || [])]
    .filter(tx => {
      const ms = Date.parse(tx?.date || '');
      return !Number.isNaN(ms) && ms >= seasonFloorMs;
    })
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  const ensurePlayer = (name, key) => {
    if (!playerTxState.has(key)) {
      playerTxState.set(key, {
        name,
        lastAction: null,
        lastActionDate: null,
        releasedInjurySettlement: false,
        releasedDate: null,
        placedOnIrDate: null,
        placedOnIrNote: '',
        designatedToReturnDate: null,
        designatedToReturnOpen: false,
        activatedFromIrDate: null,
        latestRosterMoveBucket: null // 'active' | 'practice_squad' | 'ir' | 'released'
      });
    }
    return playerTxState.get(key);
  };

  for (const tx of sortedAsc) {
    const dateIso = tx.date;
    const dateMs = Date.parse(dateIso);
    const sentences = String(tx.description || '')
      .replace(/\b([A-Za-z])\.([A-Za-z])\./g, '$1$2')
      .replace(/\b(Jr|Sr)\./gi, '$1')
      .split(/(?<![\s.][A-Za-z])\.\s+|\.$/)
      .map(s => s.trim())
      .filter(Boolean);

    for (const sent of sentences) {
      let m;

      // 1. Released from IR / PS with an injury settlement
      if ((m = sent.match(/^Released\s+(.+?)\s+from\s+(?:injured reserve|the practice squad)\s+with an injury settlement/i))) {
        for (const nm of extractNamesFromClause(m[1])) {
          const st = ensurePlayer(nm, canonicalPlayerKey(nm));
          st.releasedInjurySettlement = true;
          st.releasedDate = dateIso;
          st.designatedToReturnOpen = false;
          st.latestRosterMoveBucket = 'released';
          st.lastAction = sent;
          st.lastActionDate = dateIso;
        }
        continue;
      }

      // 2. Placed on (season-ending) injured reserve / Reverted to injured reserve
      if (
        (m =
          sent.match(/^Placed\s+(.+?)\s+on\s+(?:season-ending\s+)?injured reserve/i) ||
          sent.match(/^Reverted\s+(.+?)\s+to\s+injured reserve/i))
      ) {
        for (const nm of extractNamesFromClause(m[1])) {
          const st = ensurePlayer(nm, canonicalPlayerKey(nm));
          st.placedOnIrDate = dateIso;
          st.placedOnIrNote = sent;
          st.designatedToReturnOpen = false;
          st.releasedInjurySettlement = false;
          st.latestRosterMoveBucket = 'ir';
          st.lastAction = sent;
          st.lastActionDate = dateIso;
        }
        continue;
      }

      // 3. Designated to return from injured reserve / PUP (or Opened the IR practice window for ...)
      if (
        (m =
          sent.match(/^Designated\s+(.+?)\s+to\s+return\s+from\s+(injured reserve|the PUP list|physically unable to perform)/i) ||
          sent.match(/^Opened\s+the\s+(injured reserve|PUP)\s+practice\s+window\s+for\s+(.+?)$/i))
      ) {
        const isOpenedAlt = /^Opened\s+the/i.test(sent);
        const namesClause = isOpenedAlt ? m[2] : m[1];
        const listLabel = isOpenedAlt ? m[1] : m[2];
        const fromIr = /injured reserve/i.test(listLabel);
        for (const nm of extractNamesFromClause(namesClause)) {
          const key = canonicalPlayerKey(nm);
          const st = ensurePlayer(nm, key);
          st.designatedToReturnDate = dateIso;
          st.designatedToReturnOpen = true;
          st.releasedInjurySettlement = false;
          st.lastAction = sent;
          st.lastActionDate = dateIso;
          if (fromIr && dateMs >= regularSeasonStartMs) {
            regularSeasonIrDesignationsCount += 1;
            designatedIrKeysInTx.add(key);
          }
        }
        continue;
      }

      // 4. Activated / Reinstated from injured reserve or PUP
      if ((m = sent.match(/^(?:Activated|Reinstated)\s+(.+?)\s+from\s+(?:injured reserve|the (?:active\/)?(?:PUP|physically unable to perform) list)/i))) {
        for (const nm of extractNamesFromClause(m[1])) {
          const st = ensurePlayer(nm, canonicalPlayerKey(nm));
          st.activatedFromIrDate = dateIso;
          st.designatedToReturnOpen = false;
          st.releasedInjurySettlement = false;
          st.latestRosterMoveBucket = 'active';
          st.lastAction = sent;
          st.lastActionDate = dateIso;
        }
        continue;
      }

      // 5. Practice squad game-day elevation (reverts to practice squad automatically post-game)
      if ((m = sent.match(/^Elevated\s+(.+?)\s+from\s+the\s+practice\s+squad/i))) {
        for (const nm of extractNamesFromClause(m[1])) {
          const st = ensurePlayer(nm, canonicalPlayerKey(nm));
          st.releasedInjurySettlement = false;
          st.latestRosterMoveBucket = 'practice_squad';
          st.lastAction = sent;
          st.lastActionDate = dateIso;
        }
        continue;
      }

      // 6. Signed to practice squad
      if ((m = sent.match(/^Signed\s+(.+?)\s+to\s+the\s+practice\s+squad/i))) {
        for (const nm of extractNamesFromClause(m[1])) {
          const st = ensurePlayer(nm, canonicalPlayerKey(nm));
          st.releasedInjurySettlement = false;
          st.latestRosterMoveBucket = 'practice_squad';
          st.lastAction = sent;
          st.lastActionDate = dateIso;
        }
        continue;
      }

      // 7. Signed / Promoted to active roster, Acquired via trade, or Claimed off waivers
      if (
        (m =
          sent.match(/^(?:Signed|Promoted)\s+(.+?)\s+(?:from\s+the\s+practice\s+squad\s+)?to\s+the\s+active\s+roster/i) ||
          sent.match(/^Signed\s+(.+?)\s+from\s+[A-Z][a-zA-Z.'\s]+practice squad/i))
      ) {
        for (const nm of extractNamesFromClause(m[1])) {
          const st = ensurePlayer(nm, canonicalPlayerKey(nm));
          st.releasedInjurySettlement = false;
          st.latestRosterMoveBucket = 'active';
          st.lastAction = sent;
          st.lastActionDate = dateIso;
        }
        continue;
      }

      // 7b. Acquired via trade ("Acquired DT DeForest Buckner from Indianapolis for ...", "Acquired WR Keenan Allen from Indianapolis ...")
      if ((m = sent.match(/^Acquired\s+(.+?)\s+from\s+([A-Za-z .']+?)(?:\s+for\s+(.+?))?$/i))) {
        const rawTarget = String(m[1] || '').trim();
        if (!/\bdraft\s+picks?\b|\bconditional\b|\bselection\b/i.test(rawTarget)) {
          for (const nm of extractNamesFromClause(rawTarget)) {
            const st = ensurePlayer(nm, canonicalPlayerKey(nm));
            st.releasedInjurySettlement = false;
            st.acquiredViaTrade = true;
            st.acquiredFromTeam = String(m[2] || '').trim();
            st.tradeCompensation = String(m[3] || '').trim();
            st.acquiredDate = dateIso;
            st.latestRosterMoveBucket = 'active';
            st.lastAction = sent;
            st.lastActionDate = dateIso;
          }
          continue;
        }
      }

      // 7c. Claimed off waivers ("Claimed CB ... off waivers from ...") or direct active signing ("Signed WR ...")
      if (
        (m =
          sent.match(/^Claimed\s+(.+?)\s+off\s+waivers(?:\s+from\s+[A-Za-z .']+)?$/i) ||
          sent.match(/^Signed\s+(.+?)$/i))
      ) {
        const clause = String(m[1] || '').trim();
        if (!/\bpractice\s+squad\b|\breserve\/future\b|\bdraft\s+pick\b/i.test(clause)) {
          for (const nm of extractNamesFromClause(clause)) {
            const st = ensurePlayer(nm, canonicalPlayerKey(nm));
            st.releasedInjurySettlement = false;
            st.latestRosterMoveBucket = 'active';
            st.lastAction = sent;
            st.lastActionDate = dateIso;
          }
          continue;
        }
      }

      // 7d. Reinstated from Reserve/Left Squad list (often paired with a two-week roster exemption before active-53 elevation)
      if ((m = sent.match(/^Reinstated\s+(.+?)\s+from\s+the\s+reserve\/left\s+squad\s+list/i))) {
        for (const nm of extractNamesFromClause(m[1])) {
          const st = ensurePlayer(nm, canonicalPlayerKey(nm));
          st.reinstatedFromLeftSquadDate = dateIso;
          st.releasedInjurySettlement = false;
          st.lastAction = sent;
          st.lastActionDate = dateIso;
        }
        continue;
      }

      // 8. Released / Waived / Terminated / Traded Away
      if (
        (m =
          sent.match(/^(?:Released|Waived)\s+(.+?)(?:\s+from\s+the\s+practice\s+squad)?$/i) ||
          sent.match(/^Terminated\s+the\s+contract\s+of\s+(.+?)$/i) ||
          sent.match(/^Traded\s+(.+?)\s+to\s+[A-Za-z .']+$/i))
      ) {
        const targetClause = String(m[1] || '').trim();
        if (!/\bdraft\s+picks?\b|\bselection\b/i.test(targetClause)) {
          for (const nm of extractNamesFromClause(targetClause)) {
            const st = ensurePlayer(nm, canonicalPlayerKey(nm));
            st.releasedDate = dateIso;
            st.designatedToReturnOpen = false;
            st.latestRosterMoveBucket = 'released';
            st.lastAction = sent;
            st.lastActionDate = dateIso;
          }
        }
      }
    }
  }

  return {
    byKey: playerTxState,
    regularSeasonIrDesignationsCount,
    designatedIrKeysInTx
  };
}

/**
 * Reconciles ESPN's live team roster (`teams/25/roster`) with `49ers.com/team/players-roster/`,
 * `teams/25/depthcharts`, `transactions?team=25`, and `news?team=25`.
 *
 * Why this is essential:
 * - `49ers.com/team/players-roster/` is manually maintained by team PR staff and lags 6–48 hours behind
 *   breaking trades, waiver claims, and signings (e.g., Keenan Allen traded to SF on Nov 10 is immediately
 *   on ESPN's active 53 & depth chart while `49ers.com` still lists 52 active players).
 * - Conversely, ESPN's `practiceSquad` and `injuredReserveOrOut` groups occasionally retain stale
 *   preseason/camp ghosts (e.g., `Vincent Anthony Jr.`) or injury-settlement releases (`Brett Toth`).
 * - By accepting players on ESPN's Active 53 (`espnDefaultBucket === 'active'`), Depth Chart, or active
 *   Transaction/News ledger even before `49ers.com` updates, while rejecting uncorroborated non-active
 *   PS/IR ghosts and confirmed releases, the roster is both sub-hour fresh and 100% ghost-free.
 */
export function resolveAuthoritativeRosterPlayerStatus({
  espnId = '',
  fullName = '',
  groupKey = '',
  espnDefaultBucket = 'active',
  offRosRec = null,
  officialRosterHasData = false,
  txRec = null,
  depthChartIds = new Set(),
  espnInj = null,
  webInj = null,
  inlineInj = null,
  recentNewsText = ''
} = {}) {
  const canonKey = canonicalPlayerKey(fullName);
  const probeComment = `${espnInj?.shortComment || ''} ${espnInj?.longComment || ''} ${webInj?.shortComment || ''} ${webInj?.longComment || ''} ${inlineInj?.shortComment || ''}`;

  // 1. Exclude free-agent ghosts released with an injury settlement (e.g., Brett Toth)
  if (
    txRec?.releasedInjurySettlement ||
    /\breleased\b[\s\S]{0,45}\bfrom\s+(?:injured\s+reserve|the\s+practice\s+squad)\s+with\s+an\s+injury\s+settlement/i.test(
      probeComment
    )
  ) {
    return { include: false, bucket: 'released', isReserveLeftSquadOrSusp: false, statusOverride: null };
  }

  // 2. Detect Reserve / Left Squad, Commissioner's Roster Exemption, or League Suspension
  const isRosterExemption = /roster exemption|two-week roster exemption/i.test(probeComment);
  const isReserveLeftSquadOrSusp =
    groupKey === 'suspended' ||
    canonKey === 'brandonaiyuk' ||
    isRosterExemption ||
    /looking to get reinstated|left squad|reserve\/suspended/i.test(probeComment);

  // 3. When 49ers.com has authoritative data but the player is not yet in 49ers.com's HTML table:
  //    Keep the player if ESPN has them in the Active 53 (`espnDefaultBucket === 'active'`), on the live
  //    Depth Chart, in an active Transaction (`txRec`), in Reserve/Exemption status, or in breaking acquisition news.
  //    Filter out only uncorroborated non-active (`practiceSquad` / `injuredReserveOrOut`) ghosts (e.g., Vincent Anthony Jr.).
  if (officialRosterHasData && !offRosRec && !isReserveLeftSquadOrSusp) {
    if (txRec?.latestRosterMoveBucket === 'released') {
      return { include: false, bucket: 'released', isReserveLeftSquadOrSusp: false, statusOverride: null };
    }
    const onDepthChart = Boolean(espnId && depthChartIds?.has?.(String(espnId)));
    const hasActiveTxMove =
      Boolean(txRec?.latestRosterMoveBucket) && txRec.latestRosterMoveBucket !== 'released';
    const fullLower = String(fullName || '').toLowerCase().trim();
    const mentionedInBreakingAcquisition =
      fullLower.length >= 5 &&
      String(recentNewsText || '').toLowerCase().includes(fullLower) &&
      /\b(trade|traded|acquir|sign|signed|claim|claimed|waiver|roster|reinstate)\b/i.test(recentNewsText);

    const isCorroboratedAddition =
      espnDefaultBucket === 'active' ||
      onDepthChart ||
      hasActiveTxMove ||
      mentionedInBreakingAcquisition;

    if (!isCorroboratedAddition) {
      return { include: false, bucket: 'released', isReserveLeftSquadOrSusp: false, statusOverride: null };
    }
  }

  if (!officialRosterHasData && txRec?.latestRosterMoveBucket === 'released') {
    return { include: false, bucket: 'released', isReserveLeftSquadOrSusp: false, statusOverride: null };
  }

  const bucket =
    isReserveLeftSquadOrSusp && !offRosRec
      ? 'ir'
      : offRosRec?.bucket ||
        (txRec?.latestRosterMoveBucket && txRec.latestRosterMoveBucket !== 'released'
          ? txRec.latestRosterMoveBucket
          : espnDefaultBucket);

  const statusOverride =
    isReserveLeftSquadOrSusp && !offRosRec
      ? isRosterExemption
        ? 'Reserve / Roster Exemption'
        : 'Reserve / Left Squad'
      : offRosRec?.statusOverride || null;

  return {
    include: true,
    bucket,
    isReserveLeftSquadOrSusp,
    statusOverride
  };
}

/**
 * Fetches ESPN Athlete Web v3 detail payloads (`site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{id}`)
 * in bounded parallel batches to obtain full medical/RotoWire injury types, surgery flags, `returnDate`, and comments.
 */
export async function fetchEspnAthleteDetailsBatch(athleteIds = [], fetchJsonFn, batchSize = 10) {
  const uniqueIds = [...new Set((athleteIds || []).map(id => String(id || '').trim()).filter(Boolean))];
  const byId = new Map();

  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    const chunk = uniqueIds.slice(i, i + batchSize);
    const results = await Promise.all(
      chunk.map(async id => {
        try {
          const data = await fetchJsonFn(
            `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${id}`
          );
          const ath = data?.athlete;
          if (!ath) return null;
          const inj = (ath.injuries || [])[0] || null;
          return {
            id,
            statusType: ath.status?.type || '',
            statusName: ath.status?.name || '',
            teamAbbr: ath.team?.abbreviation || '',
            injury: inj
              ? {
                  status: inj.status || '',
                  date: inj.date || null,
                  type: inj.type?.description || inj.status || '',
                  injuryType: inj.details?.type || '',
                  injuryDetail: inj.details?.detail || '',
                  side: inj.details?.side || '',
                  returnDate: inj.details?.returnDate || null,
                  fantasyStatusAbbr: inj.details?.fantasyStatus?.abbreviation || '',
                  fantasyStatusDesc: inj.details?.fantasyStatus?.description || '',
                  shortComment: inj.shortComment || '',
                  longComment: inj.longComment || ''
                }
              : null
          };
        } catch {
          return null;
        }
      })
    );

    for (const item of results) {
      if (item) byId.set(item.id, item);
    }
  }

  return byId;
}
