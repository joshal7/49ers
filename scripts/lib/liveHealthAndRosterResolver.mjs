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
export function canonicalPlayerKey(rawName = '') {
  return String(rawName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

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

function normalizeOfficialPracticeCell(rawCell = '', injuryText = '') {
  const c = String(rawCell || '').trim().toUpperCase();
  if (!c || c === '(-)' || c === '-' || c === '—') return '-';
  if (c === 'DNP' && /not injury related|resting player|\brest\b/i.test(injuryText)) {
    return 'Vet Rest';
  }
  if (c === 'FP' || c === 'FULL') return 'FP';
  if (c === 'LP' || c === 'LIMITED') return 'LP';
  if (c === 'DNP') return 'DNP';
  return rawCell.trim();
}

function normalizeOfficialGameStatus(rawStatus = '') {
  const s = String(rawStatus || '').trim().toUpperCase();
  if (!s || s === 'UNSPECIFIED' || s === '(-)' || s === '-' || s === '—') return '';
  if (s.includes('QUESTIONABLE')) return 'Questionable';
  if (s.includes('DOUBTFUL')) return 'Doubtful';
  if (s.includes('OUT')) return 'Out';
  return '';
}

/**
 * Parses `https://www.49ers.com/team/injury-report/` for BOTH San Francisco 49ers AND the weekly Opponent.
 */
export function parseOfficial49ersInjuryReportHtml(html = '', oppTeamName = '') {
  const sfByKey = new Map();
  const oppByKey = new Map();
  if (!html || typeof html !== 'string') {
    return { hasSfReport: false, hasOppReport: false, reportMatchesCurrentOpponent: false, sfByKey, oppByKey };
  }

  const oppLower = String(oppTeamName || '').toLowerCase();
  const oppMascot = oppLower.split(/\s+/).filter(Boolean).pop() || '';
  const htmlLower = html.toLowerCase();
  const reportMatchesCurrentOpponent = !oppMascot || htmlLower.includes(oppMascot);
  if (!reportMatchesCurrentOpponent) {
    return { hasSfReport: false, hasOppReport: false, reportMatchesCurrentOpponent: false, sfByKey, oppByKey };
  }
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  let match;
  let tableIdx = 0;

  while ((match = tableRegex.exec(html)) !== null) {
    const tableHtml = match[0];
    const precedingContext = stripTags(html.slice(Math.max(0, match.index - 800), match.index)).toLowerCase();
    const headers = [
      ...(tableHtml.match(/<thead[\s\S]*?<\/thead>/i)?.[0] || '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)
    ].map(m => stripTags(m[1]).toLowerCase());

    if (!headers.includes('player') || (!headers.includes('wed') && !headers.includes('thu') && !headers.includes('fri'))) {
      continue;
    }

    const isSf =
      precedingContext.includes('san francisco 49ers') &&
      (!oppMascot || precedingContext.lastIndexOf('49ers') > precedingContext.lastIndexOf(oppMascot));
    const targetMap = isSf || (tableIdx === 0 && !oppMascot) ? sfByKey : oppByKey;
    tableIdx += 1;

    const pIdx = headers.indexOf('player');
    const posIdx = headers.indexOf('position');
    const injIdx = headers.indexOf('injury');
    const d1Idx = headers.findIndex(h => h === 'wed' || h === 'tue' || h === 'thu');
    const wedIdx = headers.indexOf('wed');
    const thuIdx = headers.indexOf('thu');
    const friIdx = headers.indexOf('fri');
    const satIdx = headers.indexOf('sat');
    const gsIdx = headers.findIndex(h => h.includes('status'));

    const tbody = tableHtml.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] || '';
    for (const rowMatch of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]));
      const playerName = cells[pIdx] || '';
      const key = canonicalPlayerKey(playerName);
      if (!key) continue;

      const rawInjury = injIdx >= 0 ? cells[injIdx] || '' : '';
      const cleanInjury = /not injury related.*rest/i.test(rawInjury) ? 'NIR - Rest' : rawInjury;

      // Support both standard Wed/Thu/Fri weeks and Mon/Thu shifted weeks (Tue/Wed/Thu or Thu/Fri/Sat)
      const c1 = wedIdx >= 0 ? cells[wedIdx] : d1Idx >= 0 ? cells[d1Idx] : '-';
      const c2 = thuIdx >= 0 ? cells[thuIdx] : '-';
      const c3 = friIdx >= 0 ? cells[friIdx] : satIdx >= 0 ? cells[satIdx] : '-';

      targetMap.set(key, {
        name: playerName,
        position: posIdx >= 0 ? cells[posIdx] || '' : '',
        injuryType: cleanInjury,
        wed: normalizeOfficialPracticeCell(c1, rawInjury),
        thu: normalizeOfficialPracticeCell(c2, rawInjury),
        fri: normalizeOfficialPracticeCell(c3, rawInjury),
        gameStatus: gsIdx >= 0 ? normalizeOfficialGameStatus(cells[gsIdx]) : ''
      });
    }
  }

  return {
    hasSfReport: sfByKey.size > 0,
    hasOppReport: oppByKey.size > 0,
    reportMatchesCurrentOpponent: true,
    sfByKey,
    oppByKey
  };
}

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
      .split(/\.\s+|\.$/)
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

      // 7. Signed / Promoted to active roster
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

      // 8. Released / Waived
      if ((m = sent.match(/^(?:Released|Waived)\s+(.+?)(?:\s+from\s+the\s+practice\s+squad)?$/i))) {
        for (const nm of extractNamesFromClause(m[1])) {
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

  return {
    byKey: playerTxState,
    regularSeasonIrDesignationsCount,
    designatedIrKeysInTx
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
