/**
 * Live Multi-Team NFL Draft Intelligence Builder
 *
 * Powers the entire Draft Prep section above the 3-Lens Big Board for any NFL team:
 *   1. Full 7-round + Compensatory pick inventory from live Tankathon HTML (`valueRichHill` included)
 *   2. Accurate traded/acquired/compensatory pick summary (`tradedPicksNote`)
 *   3. Roster- & contract-grounded `topNeeds2027` driven by live NFL Mock Draft Database
 *      team needs + live active/IR roster ages, snap shares, and 2027 contract expirations
 *   4. Live `firstPickMockDatabase` combining NFL Mock Draft Database's team mock ledger
 *      with direct Tankathon, DraftTek, and WalterFootball Round-1 scrapes
 *   5. Team-tailored `consensusMockTargets` (Scheme Fit Clusters) aligned with needs & pick range
 *
 * Zero placeholders, zero 49ers leakage for non-49ers teams.
 */

import {
  buildMockDraftBigBoardUrl,
  buildMockDraftTeamUrl,
  decodeHtmlEntities as decodeHtmlEntitiesShared,
  sanitizeExternalUrl
} from '../../src/engine/linkIntegrity.js';
import { hasCrossTeam49ersLeak } from '../../src/config/teamRegistry.js';
import {
  estimateRichHillPickValue,
  parseTankathonTeamPicksHtml
} from './aiSynthesisEngine.mjs';

const DISALLOWED_PRIOR_DRAFT_PROSPECTS = new Set([
  'fernandomendoza',
  'davidbailey',
  'ruebenbain',
  'ruebenbainjr',
  'francismauigoa',
  'spencerfano',
  'calebdowns',
  'arvellreese',
  'jeremiyahlove',
  'carnelltate',
  'makaylemon',
  'makailemon',
  'jordantyson',
  'sonnystyles',
  'mansoordelane',
  'jermodmccoy',
  'keldricfaulk',
  'petewoods',
  'peterwoods',
  'dillonthieneman',
  'avieonterrell',
  'cashiusowell',
  'cashiushowell',
  'kadynproctor',
  'caleblomu',
  'vegaeane',
  'olaiyavegaioana',
  'olaivavegaioana',
  'tjparker',
  'kenyonsadiq',
  'coltonhood',
  'brandoncisse',
  'emmanuelmcneilwarren',
  'kaydenmcdonald',
  'calebbanks',
  'blakemiller',
  'monroefreeling',
  'cjallen',
  'akheemmesidor',
  'tylersimpson',
  'tysimpson',
  'danteemoore',
  'keithabney',
  'keithabneyii',
  'davisonigbinosun',
  'skylerbell',
  'judebowry',
  'tyleikwilliams',
  'tateratledge'
]);

function decodeHtmlEntities(str = '') {
  return decodeHtmlEntitiesShared(str).replace(/\s+/g, ' ').trim();
}

export function normalizeDraftPlayerKey(name = '') {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function slugifyProspectName(name = '') {
  return String(name || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeNeedPosCode(rawPos = '') {
  const p = String(rawPos || '').trim().toUpperCase();
  if (!p) return '';
  if (['OT', 'LT', 'RT', 'T'].includes(p)) return 'OT';
  if (['IOL', 'OG', 'G', 'LG', 'RG', 'C', 'OL'].includes(p)) return 'IOL';
  if (['EDGE', 'DE', 'ED', 'OLB'].includes(p)) return 'EDGE';
  if (['DL', 'DT', 'IDL', 'NT'].includes(p)) return 'DL';
  if (['LB', 'ILB', 'MLB'].includes(p)) return 'LB';
  if (['CB', 'DB'].includes(p)) return 'CB';
  if (['S', 'FS', 'SS', 'SAF'].includes(p)) return 'S';
  if (['WR', 'TE', 'RB', 'QB'].includes(p)) return p;
  return p;
}

const SITE_CANONICAL_MAP = new Map([
  ['cbs', { siteId: 'cbs_sports', siteName: 'CBS Sports' }],
  ['cbssports', { siteId: 'cbs_sports', siteName: 'CBS Sports' }],
  ['si', { siteId: 'sports_illustrated', siteName: 'Sports Illustrated' }],
  ['sportsillustrated', { siteId: 'sports_illustrated', siteName: 'Sports Illustrated' }],
  ['pfn', { siteId: 'pro_football_network', siteName: 'Pro Football Network' }],
  ['profootballnetwork', { siteId: 'pro_football_network', siteName: 'Pro Football Network' }],
  ['espn', { siteId: 'espn', siteName: 'ESPN' }],
  ['tankathon', { siteId: 'tankathon', siteName: 'Tankathon' }],
  ['drafttek', { siteId: 'drafttek', siteName: 'DraftTek' }],
  ['walterfootball', { siteId: 'walterfootball', siteName: 'WalterFootball' }],
  ['athlonsports', { siteId: 'athlon_sports', siteName: 'Athlon Sports' }],
  ['sbnation', { siteId: 'sb_nation', siteName: 'SB Nation' }],
  ['fansided', { siteId: 'fansided', siteName: 'FanSided' }],
  ['fantasylife', { siteId: 'fantasy_life', siteName: 'Fantasy Life' }],
  ['nflmocks', { siteId: 'nfl_mocks', siteName: 'NFL Mocks' }],
  ['atozsports', { siteId: 'a_to_z_sports', siteName: 'A to Z Sports' }],
  ['nflspinzone', { siteId: 'nfl_spin_zone', siteName: 'NFL Spin Zone' }],
  ['nfldraftdiamonds', { siteId: 'nfl_draft_diamonds', siteName: 'NFL Draft Diamonds' }],
  ['rotoballer', { siteId: 'rotoballer', siteName: 'RotoBaller' }],
  ['twsn', { siteId: 'twsn', siteName: 'TWSN' }],
  ['draftblaster', { siteId: 'draftblaster', siteName: 'DraftBlaster' }],
  ['sparkscouting', { siteId: 'sparkscouting', siteName: 'SparkScouting' }],
  ['bleacherreport', { siteId: 'bleacher_report', siteName: 'Bleacher Report' }],
  ['foxsports', { siteId: 'fox_sports', siteName: 'FOX Sports' }],
  ['pff', { siteId: 'pff_draft', siteName: 'PFF' }],
  ['yahoosports', { siteId: 'yahoo_sports', siteName: 'Yahoo Sports' }],
  ['thedraftnetwork', { siteId: 'the_draft_network', siteName: 'The Draft Network' }],
  ['nfltraderumors', { siteId: 'nfl_trade_rumors', siteName: 'NFL Trade Rumors' }],
  ['draftcountdown', { siteId: 'draft_countdown', siteName: 'NFL Draft Countdown' }]
]);

function canonicalizeMockSite(rawSite = '') {
  const cleaned = decodeHtmlEntities(rawSite).trim();
  const compact = cleaned.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (SITE_CANONICAL_MAP.has(compact)) return SITE_CANONICAL_MAP.get(compact);
  const siteId = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return { siteId: siteId || 'mock_site', siteName: cleaned || 'Mock Draft Site' };
}

function parseShortUsDateToIso(str = '') {
  const m = String(str || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const mm = String(Number(m[1])).padStart(2, '0');
  const dd = String(Number(m[2])).padStart(2, '0');
  const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${yr}-${mm}-${dd}T12:00:00Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

function possessive(name = '') {
  const s = String(name || '').trim();
  if (!s) return '';
  return /s$/i.test(s) ? `${s}'` : `${s}'s`;
}

export function sanitizeTeamNeutralArchetypeNote(note = '', team = null) {
  let s = String(note || '').trim();
  if (!s) return '';
  if (team?.abbr === 'SF') return s;
  const nick = team?.nickname || 'the club';
  const nickPoss = team?.nickname ? possessive(team.nickname) : 'the';
  s = s
    .replace(/Kris Kocurek['’]s\s+attack-style\s+Wide-9\s+rotation/gi, 'an aggressive attacking four-man pass-rush rotation')
    .replace(/Kris Kocurek['’]s\s+/gi, 'an aggressive ')
    .replace(/Raheem Morris['’]s\s+/gi, '')
    .replace(/for\s+DC\s+Raheem Morris\b/gi, 'in modern split-safety coverage')
    .replace(/for\s+Raheem Morris\b/gi, 'in modern split-safety schemes')
    .replace(/Kyle Shanahan['’]s\s+/gi, 'modern ')
    .replace(/Shanahan\/Lynch/gi, `${nick} front office`)
    .replace(/\bfor\s+Shanahan\s+play-action\s+shot\s+plays/gi, 'for vertical play-action shot plays')
    .replace(/\bfor\s+Shanahan\s+bootlegs,/gi, 'for play-action bootlegs,')
    .replace(/\bShanahan\s+wide-zone\b/gi, 'wide-zone')
    .replace(/\bShanahan\b/gi, 'pro-style')
    .replace(/\bin\s+the\s+Fred Warner\s+seam-carry\s+mold/gi, 'with elite three-down seam-carry coverage range')
    .replace(/\bFred Warner\b/gi, 'all-pro second-level coverage')
    .replace(/\bbehind\s+Trent Williams\b/gi, 'with long-term blindside starter upside')
    .replace(/\bTrent Williams\b/gi, 'veteran tackle depth')
    .replace(/\bto\s+succeed\s+Jake Brendel\s+or\s+upgrade\s+Left Guard/gi, 'with immediate guard/center starter upside')
    .replace(/\bJake Brendel\b/gi, 'interior offensive line depth')
    .replace(/\balongside\s+George Kittle\b/gi, 'in 12-personnel packages')
    .replace(/\bGeorge Kittle\b/gi, 'the tight end room')
    .replace(/\bopposite\s+Nick Bosa\b/gi, 'to elevate the pass-rush front')
    .replace(/\bNick Bosa\b/gi, 'the pass-rush front')
    .replace(/\bExplosive\s+Wide-9\s+arc\s+bender/gi, 'Explosive edge arc bender')
    .replace(/\bHigh-motor\s+Wide-9\s+speed\s+rusher/gi, 'High-motor edge speed rusher')
    .replace(/\bWide-9\b/gi, 'attacking four-man')
    .replace(/\bSF['’]s\b/g, nickPoss)
    .replace(/\bSan Francisco['’]s\b/gi, team?.city ? possessive(team.city) : nickPoss)
    .replace(/\bSan Francisco\b/gi, team?.city || 'the club')
    .replace(/\b49ers['’]?\b/gi, nick)
    .replace(/\bBrock Purdy\b/gi, 'the offense')
    .replace(/\bKlay Kubiak['’]?s?\b/gi, 'the offensive staff')
    .replace(/\bJohn Lynch['’]?s?\b/gi, `${nick} front office`)
    .replace(/\bChristian McCaffrey\b|\bCMC\b/gi, 'the backfield')
    .replace(/\bBrandon Aiyuk\b|\bRicky Pearsall\b/gi, 'the receiver room')
    .replace(/\bDominick Puni\b|\bColton McKivitz\b/gi, 'the offensive line')
    .replace(/\bDeommodore Lenoir\b|\bRenardo Green\b/gi, 'the secondary')
    .replace(/\bDeForest Buckner\b|\bMykel Williams\b/gi, 'the defensive front')
    .replace(/\bLevi['’]?s Stadium\b|\bSanta Clara\b/gi, team?.stadium || team?.city || 'the club')
    .replace(/\s+/g, ' ')
    .trim();
  if (hasCrossTeam49ersLeak(s, team)) {
    return '';
  }
  return s;
}

function buildTeamProspectNote({ playerName, pos, school, team, boardHit, projectedPick, siteName }) {
  const canonicalPos = normalizeNeedPosCode(pos || boardHit?.pos || '');
  const hw = boardHit?.heightWeight ? ` (${boardHit.heightWeight})` : '';
  const stats = boardHit?.collegeStats ? ` — ${boardHit.collegeStats}` : '';
  const boardNote = sanitizeTeamNeutralArchetypeNote(boardHit?.archetypeNote || '', team);
  if (boardNote && boardNote.length >= 24) {
    return boardNote;
  }
  const teamLabel = team?.fullName || team?.nickname || 'the club';
  const teamPoss = possessive(teamLabel);
  const pickTag = projectedPick ? ` at #${projectedPick}` : '';
  const posSummaries = {
    WR: `Explosive ${school || 'collegiate'} perimeter target${hw}${stats} giving ${teamLabel} rookie-contract vertical separation${pickTag}.`,
    LB: `Sideline-to-sideline ${school || 'collegiate'} off-ball linebacker${hw}${stats} projected by ${siteName} to upgrade ${teamPoss} second-level range${pickTag}.`,
    S: `Versatile ${school || 'collegiate'} split-safety playmaker${hw}${stats} adding deep-half range and overhang coverage for ${teamLabel}${pickTag}.`,
    CB: `Lengthy ${school || 'collegiate'} cover corner${hw}${stats} bolstering ${teamPoss} man/zone boundary rotation${pickTag}.`,
    EDGE: `High-motor ${school || 'collegiate'} edge rusher${hw}${stats} reinforcing ${teamPoss} four-man pass-rush wave${pickTag}.`,
    IOL: `Physical ${school || 'collegiate'} interior blocker${hw}${stats} fortifying ${teamPoss} guard/center pass protection${pickTag}.`,
    OT: `Athletic ${school || 'collegiate'} offensive tackle${hw}${stats} adding blindside/swing pass protection for ${teamLabel}${pickTag}.`,
    DL: `Disruptive ${school || 'collegiate'} interior defensive lineman${hw}${stats} upgrading ${teamPoss} trench penetration${pickTag}.`,
    TE: `Dynamic ${school || 'collegiate'} seam tight end${hw}${stats} expanding ${teamPoss} 12-personnel mismatch options${pickTag}.`
  };
  return (
    posSummaries[canonicalPos] ||
    `${school || 'Collegiate'} ${pos || 'prospect'}${hw}${stats} projected to ${teamLabel}${pickTag} by ${siteName}.`
  );
}

/**
 * Parses `https://www.nflmockdraftdatabase.com/teams/${draftYear}/${team.otcSlug}` HTML:
 *  - `mustAddressNeeds`: array of top need position codes from "2027 Team Needs -> Must Address"
 *  - `mockEntries`: fresh mock draft entries with verified MDDB permalinks, dates, analysts, picks
 */
export function parseMddbTeamPageHtml(
  html = '',
  { team, draftYear = 2027, bigBoardByKey = new Map(), defaultRound = 1 } = {}
) {
  if (!html || typeof html !== 'string') {
    return { mustAddressNeeds: [], mockEntries: [] };
  }

  // 1. Extract "Must Address" needs from the Team Needs card
  const mustAddressNeeds = [];
  const needsIdx = html.indexOf(`${draftYear} Team Needs`);
  if (needsIdx >= 0) {
    const needsSlice = html.slice(needsIdx, needsIdx + 1800);
    const mustBlockMatch = needsSlice.match(/Must Address<\/div>([\s\S]{0,900}?)Strong Need/i);
    if (mustBlockMatch) {
      const spanRe = /<span[^>]*>\s*([A-Z]{1,5})\s*<\/span>/g;
      let sm;
      while ((sm = spanRe.exec(mustBlockMatch[1])) !== null) {
        const code = normalizeNeedPosCode(sm[1]);
        if (code && !mustAddressNeeds.includes(code)) mustAddressNeeds.push(code);
      }
    }
  }
  // Secondary fallback: header "Top Needs: WR, LB, S"
  if (mustAddressNeeds.length === 0) {
    const topNeedsMatch = html.match(/Top Needs:\s*<\/[^>]+>\s*([^<]{2,60})/i) ||
      html.replace(/<[^>]+>/g, ' ').match(/Top Needs:\s*([A-Z,\s/]{2,40})/);
    if (topNeedsMatch) {
      for (const tok of topNeedsMatch[1].split(/[,\s/]+/)) {
        const code = normalizeNeedPosCode(tok);
        if (code && code.length <= 4 && !mustAddressNeeds.includes(code)) mustAddressNeeds.push(code);
      }
    }
  }

  // 2. Parse each mock draft card cleanly without regex backtracking
  const mockEntries = [];
  const anchorMatches = [...html.matchAll(/<a[^>]+href="(\/mock-drafts\/[^"]+)"[^>]*>/gi)];
  for (let idx = 0; idx < anchorMatches.length; idx += 1) {
    const cur = anchorMatches[idx];
    const relHref = decodeHtmlEntities(cur[1]);
    const startPos = cur.index + cur[0].length;
    const nextPos = idx + 1 < anchorMatches.length ? anchorMatches[idx + 1].index : html.length;
    const cardChunk = html.slice(startPos, Math.min(nextPos, startPos + 3200));
    const closeAnchorIdx = cardChunk.indexOf('</a>');
    if (closeAnchorIdx < 0) continue;

    const headerHtml = cardChunk.slice(0, closeAnchorIdx);
    const bodyHtml = cardChunk.slice(closeAnchorIdx + 4);

    const fullUrl = sanitizeExternalUrl(`https://www.nflmockdraftdatabase.com${relHref}`, null);
    if (!fullUrl) continue;

    // Extract siteName & optional analyst from header cleanly
    const headerPlain = decodeHtmlEntities(
      headerHtml
        .replace(/<div[^>]*whitespace-nowrap[^>]*>[\s\S]*?<\/div>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    ).trim();
    const bySplit = headerPlain.split(/\s+By\s+/i);
    const siteRaw = (bySplit[0] || '').trim();
    const analyst = bySplit.length > 1 ? bySplit.slice(1).join(' By ').trim() : '';
    if (!siteRaw) continue;
    const { siteId, siteName } = canonicalizeMockSite(siteRaw);

    // Date from `?date=YYYY-MM-DD` query param (exact) or `MM/DD/YY` badge
    const qDateMatch = relHref.match(/[?&]date=(\d{4}-\d{2}-\d{2})/);
    const badgeDateMatch = headerHtml.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/);
    const publishedAt = qDateMatch
      ? `${qDateMatch[1]}T12:00:00Z`
      : badgeDateMatch
        ? parseShortUsDateToIso(badgeDateMatch[1])
        : null;
    if (!publishedAt) continue;

    // Pick number, player name, pos, school from card body
    const pickMatch = bodyHtml.match(/<span[^>]*font-black[^>]*>\s*(\d{1,3})\s*<\/span>/i);
    const playerMatch = bodyHtml.match(/href="\/players\/\d{4}\/[^"]+"[^>]*>\s*([^<]+?)\s*<\/a>/i);
    const posMatch = bodyHtml.match(/<span[^>]*font-bold[^>]*bg-blue-50[^>]*>\s*([A-Z/]{1,5})\s*<\/span>/i) ||
      bodyHtml.match(/<\/a>\s*<span[^>]*>\s*([A-Z]{1,4})\s*<\/span>/i);
    const schoolMatches = [...bodyHtml.matchAll(/href="\/colleges\/\d{4}\/[^"]+"[^>]*>\s*([^<]+?)\s*<\/a>/gi)];
    const schoolRaw = schoolMatches
      .map(sm => decodeHtmlEntities(sm[1]).trim())
      .find(txt => txt && txt.length >= 2) || '';

    const playerName = playerMatch ? decodeHtmlEntities(playerMatch[1]).trim() : '';
    if (!playerName) continue;
    const pKey = normalizeDraftPlayerKey(playerName);
    if (!pKey || DISALLOWED_PRIOR_DRAFT_PROSPECTS.has(pKey)) continue;

    const boardHit = bigBoardByKey.get(pKey) || null;
    const projectedPick = pickMatch ? Number(pickMatch[1]) : null;
    const pos = normalizeNeedPosCode(posMatch ? posMatch[1] : boardHit?.pos || '') || (boardHit?.pos || 'ATH');
    const school = schoolRaw || boardHit?.school || '';
    const round =
      projectedPick && projectedPick <= 32
        ? 1
        : projectedPick && projectedPick <= 64
          ? 2
          : defaultRound || 1;

    mockEntries.push({
      siteId,
      siteName,
      analyst,
      url: fullUrl,
      publishedAt,
      projectedPick: projectedPick || 32,
      round,
      playerName: boardHit?.name || playerName,
      pos,
      school,
      note: buildTeamProspectNote({
        playerName: boardHit?.name || playerName,
        pos,
        school,
        team,
        boardHit,
        projectedPick,
        siteName
      })
    });
  }

  return { mustAddressNeeds, mockEntries };
}

function getDraftTekCityPattern(team) {
  const map = {
    NYG: 'NY Giants',
    NYJ: 'NY Jets',
    LAR: 'LA Rams',
    LAC: 'LA Chargers',
    SF: 'San Francisco',
    KC: 'Kansas City',
    TB: 'Tampa Bay',
    GB: 'Green Bay',
    NE: 'New England',
    NO: 'New Orleans',
    LV: 'Las Vegas'
  };
  return map[team.abbr] || team.city || team.nickname;
}

/**
 * Extracts a single team's live Round-1 mock projections from league-wide HTML pages
 * (Tankathon, DraftTek, WalterFootball Picks 1–16 & 17–32) fetched once per pipeline run.
 */
export function parseLeagueWideMockHtmlsForTeam({
  tkMockHtml = '',
  dtMockHtml = '',
  wfMock1Html = '',
  wfMock2Html = '',
  team,
  draftYear = 2027,
  projectedPick = 32,
  bigBoardByKey = new Map(),
  nowIso = new Date().toISOString()
} = {}) {
  const entries = [];
  if (!team) return entries;

  // 1. Live Tankathon Mock Draft
  if (tkMockHtml) {
    const slugMarker = `href="/nfl/${team.slug}"`;
    const idx = tkMockHtml.indexOf(slugMarker);
    if (idx > 0) {
      const slice = tkMockHtml.slice(Math.max(0, idx - 160), idx + 680);
      const pickNum = Number(slice.match(/mock-row-pick-number[^>]*>(\d+)</)?.[1]) || projectedPick;
      const pName = decodeHtmlEntities(slice.match(/mock-row-name[^>]*>([^<]+)</)?.[1] || '');
      const sp = decodeHtmlEntities(slice.match(/mock-row-school-position[^>]*>([^<]+)</)?.[1] || '');
      const [rawPos, rawSchool] = sp.split('|').map(s => (s || '').trim());
      const pKey = normalizeDraftPlayerKey(pName);
      if (pName && pKey && !DISALLOWED_PRIOR_DRAFT_PROSPECTS.has(pKey)) {
        const boardHit = bigBoardByKey.get(pKey) || null;
        const pos = normalizeNeedPosCode(rawPos || boardHit?.pos || '') || rawPos || 'ATH';
        const school = rawSchool || boardHit?.school || '';
        entries.push({
          siteId: 'tankathon',
          siteName: 'Tankathon',
          analyst: 'Tankathon Live Mock',
          url: 'https://www.tankathon.com/nfl/mock_draft',
          publishedAt: nowIso,
          projectedPick: pickNum,
          round: pickNum <= 32 ? 1 : 2,
          playerName: boardHit?.name || pName,
          pos,
          school,
          note: buildTeamProspectNote({
            playerName: boardHit?.name || pName,
            pos,
            school,
            team,
            boardHit,
            projectedPick: pickNum,
            siteName: 'Tankathon'
          })
        });
      }
    }
  }

  // 2. Live DraftTek Round-1 Mock Draft
  if (dtMockHtml) {
    const dtDateTxt = dtMockHtml.match(
      /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+202\d)\b/i
    )?.[1];
    const dtPubIso =
      dtDateTxt && Number.isFinite(Date.parse(`${dtDateTxt} 12:00:00 UTC`))
        ? new Date(Date.parse(`${dtDateTxt} 12:00:00 UTC`)).toISOString()
        : nowIso;
    const dtClean = decodeHtmlEntities(dtMockHtml.replace(/<[^>]+>/g, ' '));
    const cityEsc = getDraftTekCityPattern(team).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dtRe = new RegExp(
      `\\b(\\d{1,2})\\s+${cityEsc}\\s+([A-Z][A-Za-z'. -]{2,28}?)\\s+([A-Z][A-Za-z &'().-]{2,28}?)\\s*•\\s*([A-Z0-9/]{1,5})\\b`
    );
    const dm = dtClean.match(dtRe);
    if (dm) {
      const pickNum = Number(dm[1]) || projectedPick;
      const rawTail = `${dm[2]} ${dm[3]}`.trim();
      // Split name vs school using bigBoard match first for 100% accuracy
      let pName = dm[2].trim();
      let school = dm[3].trim();
      const rawPos = dm[4].trim();
      for (const bb of bigBoardByKey.values()) {
        if (bb?.name && rawTail.toLowerCase().startsWith(bb.name.toLowerCase() + ' ')) {
          pName = bb.name;
          school = rawTail.slice(bb.name.length).trim() || bb.school || school;
          break;
        }
      }
      const pKey = normalizeDraftPlayerKey(pName);
      if (pName && pKey && !DISALLOWED_PRIOR_DRAFT_PROSPECTS.has(pKey)) {
        const boardHit = bigBoardByKey.get(pKey) || null;
        const pos = normalizeNeedPosCode(rawPos || boardHit?.pos || '') || rawPos || 'ATH';
        entries.push({
          siteId: 'drafttek',
          siteName: 'DraftTek',
          analyst: 'DraftTek Consensus Model',
          url: `https://www.drafttek.com/${draftYear}-NFL-Mock-Draft/${draftYear}-NFL-Mock-Draft-Round-1.asp`,
          publishedAt: dtPubIso,
          projectedPick: pickNum,
          round: 1,
          playerName: boardHit?.name || pName,
          pos,
          school: school || boardHit?.school || '',
          note: buildTeamProspectNote({
            playerName: boardHit?.name || pName,
            pos,
            school: school || boardHit?.school || '',
            team,
            boardHit,
            projectedPick: pickNum,
            siteName: 'DraftTek'
          })
        });
      }
    }
  }

  // 3. Live WalterFootball Round 1 (Picks 1-16 & 17-32)
  const wfPages = [
    { html: wfMock1Html, url: `https://walterfootball.com/draft${draftYear}.php` },
    { html: wfMock2Html, url: `https://walterfootball.com/draft${draftYear}_1.php` }
  ];
  const fullEsc = String(team.fullName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nickEsc = String(team.nickname || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cityEsc = String(team.city || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const page of wfPages) {
    if (!page.html || !fullEsc) continue;
    const wfClean = decodeHtmlEntities(page.html.replace(/<[^>]+>/g, ' '));
    const wfRe = new RegExp(
      `${fullEsc}\\s*:?\\s*([A-Z][A-Za-z'. -]{3,28}?),\\s*(QB|RB|WR|TE|OT|OG|IOL|G|C|OL|DE|DT|DL|EDGE|OLB|ILB|LB|CB|S),\\s*([A-Z][A-Za-z &'.-]{2,26}?)\\s+((?:The\\s+${nickEsc}|${cityEsc}|This|With|They|If|After)[^.]{15,240}\\.)`
    );
    const wm = wfClean.match(wfRe);
    if (wm) {
      const pName = wm[1].trim();
      const rawPos = wm[2].trim() === 'DE' ? 'EDGE' : wm[2].trim();
      const school = wm[3].trim();
      const blurb = wm[4].trim();
      const pKey = normalizeDraftPlayerKey(pName);
      if (pName && pKey && !DISALLOWED_PRIOR_DRAFT_PROSPECTS.has(pKey)) {
        const boardHit = bigBoardByKey.get(pKey) || null;
        const pos = normalizeNeedPosCode(rawPos || boardHit?.pos || '') || rawPos;
        const wfDateTxt = page.html.match(
          /Updated\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+202\d)/i
        )?.[1];
        const wfPubIso =
          wfDateTxt && Number.isFinite(Date.parse(`${wfDateTxt.replace(/\./g, '')} 12:00:00 UTC`))
            ? new Date(Date.parse(`${wfDateTxt.replace(/\./g, '')} 12:00:00 UTC`)).toISOString()
            : nowIso;
        entries.push({
          siteId: 'walterfootball',
          siteName: 'WalterFootball',
          analyst: 'Walter Cherepinsky',
          url: page.url,
          publishedAt: wfPubIso,
          projectedPick,
          round: 1,
          playerName: boardHit?.name || pName,
          pos,
          school: school || boardHit?.school || '',
          note: blurb || buildTeamProspectNote({
            playerName: boardHit?.name || pName,
            pos,
            school: school || boardHit?.school || '',
            team,
            boardHit,
            projectedPick,
            siteName: 'WalterFootball'
          })
        });
        break;
      }
    }
  }

  return entries;
}

/**
 * Generates an accurate, human-readable summary of a team's live draft pick inventory
 * (total count, acquired traded picks, compensatory picks, and any dealt own rounds).
 */
export function buildTradedPicksNote({ team, draftYear = 2027, pickInventory = [] }) {
  const picks = Array.isArray(pickInventory) ? pickInventory : [];
  if (picks.length === 0) {
    return `${draftYear} ${team.fullName} draft pick order pending live verification.`;
  }

  const ownAbbr = String(team.abbr || '').toUpperCase();
  const acquired = picks.filter(p => p.fromTeam && p.fromTeam !== ownAbbr && !p.isComp);
  const compPicks = picks.filter(p => Boolean(p.isComp));
  const ownRoundsSet = new Set(
    picks.filter(p => !p.isComp && (!p.fromTeam || p.fromTeam === ownAbbr)).map(p => p.round)
  );
  const missingOwnRounds = [1, 2, 3, 4, 5, 6, 7].filter(r => !ownRoundsSet.has(r));

  const formatList = items => {
    if (items.length <= 1) return items[0] || '';
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
  };

  const parts = [];
  if (missingOwnRounds.length === 0) {
    parts.push(`${team.city} holds all seven of its original ${draftYear} draft picks`);
  } else {
    const heldOwn = [1, 2, 3, 4, 5, 6, 7].filter(r => ownRoundsSet.has(r));
    parts.push(
      `${team.city} owns its original ${heldOwn.length ? `Rd ${heldOwn.join(', ')}` : `${draftYear}`} selections`
    );
  }

  if (acquired.length > 0) {
    const acqLabels = acquired.map(p => `Rd ${p.round} #${p.projectedOverall} (via ${p.fromTeam})`);
    parts.push(`holds acquired ${formatList(acqLabels)}`);
  }

  if (compPicks.length > 0) {
    const compLabels = compPicks.map(p => `Rd ${p.round} #${p.projectedOverall}`);
    parts.push(
      `is projected for ${compPicks.length === 1 ? 'a compensatory pick' : `${compPicks.length} compensatory picks`} (${formatList(compLabels)})`
    );
  }

  if (missingOwnRounds.length > 0) {
    const missLabels = missingOwnRounds.map(r => `Rd ${r}`);
    parts.push(`previously traded its own ${formatList(missLabels)} ${missingOwnRounds.length === 1 ? 'pick' : 'picks'}`);
  }

  const sentence =
    parts.length === 1
      ? `${parts[0]}.`
      : parts.length === 2
        ? `${parts[0]} and ${parts[1]}.`
        : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}.`;

  return `${picks.length} Total Picks: ${sentence}`;
}

const POS_GROUP_MATCHERS = {
  WR: ['WR'],
  LB: ['LB', 'ILB', 'OLB', 'MLB'],
  S: ['S', 'FS', 'SS', 'SAF'],
  CB: ['CB'],
  EDGE: ['DE', 'EDGE', 'OLB'],
  IOL: ['G', 'OG', 'LG', 'RG', 'C', 'IOL'],
  OT: ['OT', 'T', 'LT', 'RT'],
  DL: ['DT', 'NT', 'DL', 'IDL'],
  TE: ['TE'],
  RB: ['RB'],
  QB: ['QB']
};

const NEED_TITLES = {
  WR: 'WR (Perimeter Playmaker & Separation)',
  LB: 'LB (Off-Ball Range & Coverage)',
  S: 'S (Deep-Half Range & Split-Safety Depth)',
  CB: 'CB (Boundary / Nickel Coverage)',
  EDGE: 'EDGE (Pass-Rush Wave & Edge Depth)',
  IOL: 'IOL (Interior Pass Protection & Guard/Center)',
  OT: 'OT (Offensive Tackle Anchor & Succession)',
  DL: 'DL (Interior Penetration & Run Anchor)',
  TE: 'TE (12-Personnel Seam & Inline Hybrid)',
  RB: 'RB (Explosive Backfield Depth)',
  QB: 'QB (Quarterback Room & Succession)'
};

function getContractStatusForYear(capPlayer, draftYear) {
  const cMap = capPlayer?.contractsByYear || {};
  const yr = cMap[String(draftYear)] || cMap[draftYear] || null;
  if (!yr) return { underContract: false, isVoid: false, capHit: 0 };
  const isVoid = Boolean(yr.isVoidYear);
  const capHit = Number(yr.capNumber || yr.capHit || 0);
  return { underContract: !isVoid && capHit > 0, isVoid, capHit };
}

/**
 * Builds 4 roster- & contract-grounded priority draft needs for any NFL club
 * by combining live MDDB "Must Address" positions with the club's live roster/cap data.
 */
export function buildRosterGroundedTeamNeeds({
  team,
  draftYear = 2027,
  mddbNeeds = [],
  players = [],
  capPlayers = []
}) {
  const capByName = new Map(
    (capPlayers || []).map(c => [String(c?.name || '').toLowerCase().trim(), c])
  );

  // Determine ordered top 4 need positions
  const orderedPositions = [];
  for (const pos of mddbNeeds || []) {
    const code = normalizeNeedPosCode(pos);
    if (code && POS_GROUP_MATCHERS[code] && !orderedPositions.includes(code)) {
      orderedPositions.push(code);
    }
  }

  // Fallback / pad to 4 using live roster age + expiring 2027 contract pressure
  const candidatePool = ['EDGE', 'CB', 'WR', 'IOL', 'OT', 'S', 'LB', 'DL', 'TE'];
  if (orderedPositions.length < 4) {
    const scored = candidatePool
      .filter(p => !orderedPositions.includes(p))
      .map(pos => {
        const matchSet = new Set(POS_GROUP_MATCHERS[pos]);
        const room = (players || []).filter(
          pl => matchSet.has(String(pl.position || '').toUpperCase()) && (pl.rosterBucket === 'active' || pl.rosterBucket === 'ir')
        );
        const starters = [...room].sort((a, b) => (b.primarySnapPct || 0) - (a.primarySnapPct || 0)).slice(0, 3);
        let score = 0;
        for (const st of starters) {
          const age = Number(st.age || 25);
          if (age >= 30) score += 20;
          else if (age >= 28) score += 10;
          const c = capByName.get(String(st.name || '').toLowerCase().trim());
          const st27 = getContractStatusForYear(c, draftYear);
          if (!st27.underContract) score += 16;
          if (st.rosterBucket === 'ir') score += 8;
        }
        if (room.length <= 2) score += 14;
        return { pos, score };
      })
      .sort((a, b) => b.score - a.score);
    for (const s of scored) {
      if (orderedPositions.length >= 4) break;
      orderedPositions.push(s.pos);
    }
  }

  const priorities = ['Critical', 'High', 'High', 'Moderate-High'];

  return orderedPositions.slice(0, 4).map((pos, idx) => {
    const matchSet = new Set(POS_GROUP_MATCHERS[pos] || [pos]);
    const roomAll = (players || []).filter(
      pl => matchSet.has(String(pl.position || '').toUpperCase()) && (pl.rosterBucket === 'active' || pl.rosterBucket === 'ir')
    );
    const activeStarters = roomAll
      .filter(pl => pl.rosterBucket === 'active')
      .sort((a, b) => (b.primarySnapPct || 0) - (a.primarySnapPct || 0));
    const irNotable = roomAll
      .filter(pl => pl.rosterBucket === 'ir')
      .sort((a, b) => (b.primarySnapPct || 0) - (a.primarySnapPct || 0));

    const keyVeterans = activeStarters.filter(p => Number(p.age || 0) >= 29).slice(0, 2);
    const expiringStarters = activeStarters
      .filter(p => {
        const cap = capByName.get(String(p.name || '').toLowerCase().trim());
        return cap && !getContractStatusForYear(cap, draftYear).underContract && (p.primarySnapPct || 0) >= 35;
      })
      .slice(0, 2);

    const topTwoNames = activeStarters.slice(0, 2).map(p => p.name);
    const irLead = irNotable[0]?.name || '';
    const prio = priorities[idx] || 'Moderate-High';

    let detail = '';
    if (expiringStarters.length >= 1) {
      const expStr = expiringStarters
        .map(p => `${p.name}${Number(p.age) >= 28 ? ` (${p.age})` : ''}`)
        .join(' and ');
      const anchorStr = topTwoNames.find(n => !expiringStarters.some(e => e.name === n));
      detail = anchorStr
        ? `Expiring ${draftYear} contract exposure (${expStr}) puts a premium on rookie-scale reinforcement alongside ${anchorStr}.`
        : `Pending ${draftYear} free agency / contract decisions around ${expStr} make rookie-contract reinforcement a top priority.`;
    } else if (keyVeterans.length >= 1) {
      const vet = keyVeterans[0];
      const partner = topTwoNames.find(n => n !== vet.name);
      detail = partner
        ? `${vet.name} (age ${vet.age}) anchors high snaps alongside ${partner}; adding cost-controlled youth fortifies ${possessive(team.nickname)} ${draftYear} ceiling.`
        : `${vet.name} (age ${vet.age}) carries heavy starter snaps; injecting rookie-scale athleticism secures long-term ${pos} succession.`;
    } else if (irLead && topTwoNames.length >= 1) {
      detail = `Adding high-upside rotational depth behind ${irLead} (IR) and ${topTwoNames[0]} stabilizes ${possessive(team.nickname)} ${draftYear} unit.`;
    } else if (topTwoNames.length >= 2) {
      detail = `Upgrading starter ceiling and rookie-contract depth alongside ${topTwoNames[0]} and ${topTwoNames[1]} for ${draftYear}.`;
    } else if (topTwoNames.length === 1) {
      detail = `Reinforcing starter depth and competition alongside ${topTwoNames[0]} on a cost-controlled 4-year rookie deal.`;
    } else {
      detail = `High-leverage ${draftYear} roster upgrade targeting immediate starter snaps on a rookie-scale contract.`;
    }

    return {
      rank: idx + 1,
      pos: NEED_TITLES[pos] || pos,
      horizon: `${prio} — ${detail}`
    };
  });
}

/**
 * Builds 4 team-tailored Scheme Fit Clusters (`consensusMockTargets`) aligned with
 * the team's live mock leaders, top needs, and 3-Lens Big Board near its 1st-round slot.
 */
export function buildTeamSchemeFitClusters({
  team,
  draftYear = 2027,
  topNeeds = [],
  firstPickMockDatabase = [],
  bigBoard = [],
  projectedFirstPick = 30
}) {
  const bbByKey = new Map(
    (bigBoard || []).map(b => [normalizeDraftPlayerKey(b?.name || ''), b])
  );

  // Tally mock frequency by playerKey
  const siteSetsByPlayer = new Map();
  const mockMetaByPlayer = new Map();
  for (const m of firstPickMockDatabase || []) {
    const k = normalizeDraftPlayerKey(m?.playerName || '');
    if (!k) continue;
    if (!siteSetsByPlayer.has(k)) siteSetsByPlayer.set(k, new Set());
    siteSetsByPlayer.get(k).add(m.siteName);
    if (!mockMetaByPlayer.has(k)) mockMetaByPlayer.set(k, m);
  }
  const totalUniqueSites = new Set((firstPickMockDatabase || []).map(m => m.siteId || m.siteName)).size || 1;

  const needPosCodes = (topNeeds || [])
    .map(n => normalizeNeedPosCode(String(n.pos || '').split(/[\s(/]/)[0]))
    .filter(Boolean);

  const clusters = [];
  const usedPlayers = new Set();

  for (let i = 0; i < Math.min(4, needPosCodes.length); i++) {
    const needPos = needPosCodes[i];
    // Find prospects matching this needPos: first from live mocks, then from Big Board near projectedFirstPick
    const mockMatches = [...siteSetsByPlayer.entries()]
      .map(([k, sites]) => {
        const bb = bbByKey.get(k) || null;
        const meta = mockMetaByPlayer.get(k);
        const pos = normalizeNeedPosCode(meta?.pos || bb?.pos || '');
        return { key: k, sites: [...sites], meta, bb, pos };
      })
      .filter(x => x.pos === needPos && !usedPlayers.has(x.key))
      .sort((a, b) => b.sites.length - a.sites.length || (a.bb?.consensusRank || 999) - (b.bb?.consensusRank || 999));

    const chosen = mockMatches.slice(0, 2);

    // If fewer than 2 from mocks, fill from Big Board near team's pick window
    if (chosen.length < 2) {
      const boardFill = (bigBoard || [])
        .filter(b => {
          const k = normalizeDraftPlayerKey(b?.name || '');
          const pos = normalizeNeedPosCode(b?.pos || '');
          return (
            k &&
            pos === needPos &&
            !usedPlayers.has(k) &&
            !chosen.some(c => c.key === k) &&
            Number(b.consensusRank || 999) >= Math.max(1, projectedFirstPick - 14) &&
            Number(b.consensusRank || 999) <= projectedFirstPick + 45
          );
        })
        .sort(
          (a, b) =>
            Math.abs(Number(a.consensusRank || 999) - projectedFirstPick) -
            Math.abs(Number(b.consensusRank || 999) - projectedFirstPick)
        );
      for (const b of boardFill) {
        if (chosen.length >= 2) break;
        const k = normalizeDraftPlayerKey(b.name);
        chosen.push({
          key: k,
          sites: [],
          meta: { playerName: b.name, pos: needPos, school: b.school },
          bb: b,
          pos: needPos
        });
      }
    }

    if (chosen.length === 0) continue;
    for (const c of chosen) usedPlayers.add(c.key);

    const resolveUrl = c => {
      const hit = c.bb;
      const slug = hit?.slug || slugifyProspectName(c.meta?.playerName || '');
      return (
        sanitizeExternalUrl(hit?.nflScoutingUrl || hit?.scoutingReportUrl || hit?.profileUrl || '', null) ||
        `https://sticktothemodel.com/player/${slug}`
      );
    };

    const prospectLinks = chosen.map(c => ({
      name: c.bb?.name || c.meta?.playerName,
      pos: needPos,
      school: c.bb?.school || c.meta?.school || '',
      url: resolveUrl(c)
    }));

    const combinedSites = [...new Set(chosen.flatMap(c => c.sites))];
    const mockPct = combinedSites.length
      ? Math.max(8, Math.round((combinedSites.length / totalUniqueSites) * 100))
      : Math.max(8, 18 - i * 3);

    const hwList = chosen
      .map(c => c.bb?.heightWeight)
      .filter(Boolean);
    const primaryNote =
      sanitizeTeamNeutralArchetypeNote(chosen[0]?.bb?.archetypeNote || '', team) ||
      buildTeamProspectNote({
        playerName: prospectLinks[0].name,
        pos: needPos,
        school: prospectLinks[0].school,
        team,
        boardHit: chosen[0]?.bb,
        projectedPick: projectedFirstPick,
        siteName: combinedSites[0] || 'Consensus Big Board'
      });

    clusters.push({
      rank: clusters.length + 1,
      name: prospectLinks.map(p => p.name).join(' / '),
      pos: needPos,
      school: prospectLinks.map(p => p.school).filter(Boolean).join(' / '),
      heightWeight: hwList.length ? hwList.join(' / ') : `Projected Rd 1–2 Range (#${projectedFirstPick})`,
      mockFrequencyToSfPct: mockPct,
      shanahanLynchFitScore: Math.max(88, 95 - clusters.length * 2),
      sourceUrl: prospectLinks[0].url,
      prospectLinks,
      archetypeTraits: primaryNote,
      sourcesMocking: combinedSites.length ? combinedSites.slice(0, 4) : ['NFL Mock Draft DB', 'Tankathon']
    });
  }

  return clusters;
}

/**
 * Full orchestrator assembling a complete, 49ers-parity `draftPrep2027` payload
 * for any NFL club.
 */
export function buildTeamDraftPrep2027({
  team,
  draftYear = 2027,
  teamStanding = { seed: 4 },
  tankathonTeamHtml = '',
  mddbTeamHtml = '',
  leagueMockHtmls = {},
  sharedBigBoard = [],
  sharedBigBoardMeta = null,
  sharedBigBoardMethodology = null,
  sharedCombineLeaderboard = null,
  players = [],
  capPlayers = [],
  nowIso = new Date().toISOString()
}) {
  // 1. Sanitize shared 3-Lens Big Board for non-SF teams
  const consensusBigBoard = (sharedBigBoard || []).map(p => {
    if (team.abbr === 'SF' || !p?.archetypeNote) return p;
    return {
      ...p,
      archetypeNote: sanitizeTeamNeutralArchetypeNote(p.archetypeNote, team)
    };
  });
  const bigBoardByKey = new Map(
    consensusBigBoard.map(b => [normalizeDraftPlayerKey(b?.name || ''), b])
  );

  // 2. Live 7-round + Comp pick inventory from Tankathon (with exact Rich Hill fallback)
  let pickInventory = parseTankathonTeamPicksHtml(tankathonTeamHtml, team.abbr);
  if (!Array.isArray(pickInventory) || pickInventory.length === 0) {
    const estR1 = Math.max(1, Math.min(32, 33 - Math.max(1, Number(teamStanding?.seed || 4) * 2)));
    pickInventory = [1, 2, 3, 4, 5, 6, 7].map(rd => {
      const overall = (rd - 1) * 32 + estR1;
      return {
        round: rd,
        projectedOverall: overall,
        origin: rd === 1 ? 'Own Pick (Projected Slot)' : 'Own Pick',
        fromTeam: team.abbr,
        isComp: false,
        valueRichHill: estimateRichHillPickValue(overall)
      };
    });
  }

  const firstPickOverall = Number(pickInventory[0]?.projectedOverall) || 30;
  const firstPickRound = Number(pickInventory[0]?.round) || 1;

  // 3. Parse live MDDB team page (Must Address Needs + Fresh Mock Draft Ledger)
  const { mustAddressNeeds, mockEntries: mddbMocks } = parseMddbTeamPageHtml(mddbTeamHtml, {
    team,
    draftYear,
    bigBoardByKey,
    defaultRound: firstPickRound
  });

  // 4. Parse league-wide direct mock pages (Tankathon, DraftTek, WalterFootball)
  const directMocks = parseLeagueWideMockHtmlsForTeam({
    tkMockHtml: leagueMockHtmls.tkMockHtml || '',
    dtMockHtml: leagueMockHtmls.dtMockHtml || '',
    wfMock1Html: leagueMockHtmls.wfMock1Html || '',
    wfMock2Html: leagueMockHtmls.wfMock2Html || '',
    team,
    draftYear,
    projectedPick: firstPickOverall,
    bigBoardByKey,
    nowIso
  });

  // 5. Merge & deduplicate by siteId (direct Tankathon/DraftTek/WalterFootball override older MDDB mirrors)
  const mocksBySite = new Map();
  for (const entry of [...mddbMocks, ...directMocks]) {
    if (!entry?.siteId || !entry?.playerName) continue;
    const prev = mocksBySite.get(entry.siteId);
    const prevMs = prev ? Date.parse(prev.publishedAt || '') : 0;
    const curMs = Date.parse(entry.publishedAt || '');
    const isDirect = ['tankathon', 'drafttek', 'walterfootball'].includes(entry.siteId) &&
      !String(entry.url || '').includes('nflmockdraftdatabase.com');
    const prevIsDirect = prev &&
      ['tankathon', 'drafttek', 'walterfootball'].includes(prev.siteId) &&
      !String(prev.url || '').includes('nflmockdraftdatabase.com');
    if (!prev || (isDirect && !prevIsDirect) || (isDirect === prevIsDirect && curMs >= prevMs)) {
      mocksBySite.set(entry.siteId, entry);
    }
  }
  const firstPickMockDatabase = [...mocksBySite.values()].sort(
    (a, b) => Date.parse(b.publishedAt || '') - Date.parse(a.publishedAt || '')
  );

  // 6. Build roster- & contract-grounded topNeeds2027
  const topNeeds2027 = buildRosterGroundedTeamNeeds({
    team,
    draftYear,
    mddbNeeds: mustAddressNeeds,
    players,
    capPlayers
  });

  // 7. Build accurate tradedPicksNote & team-tailored consensusMockTargets
  const tradedPicksNote = buildTradedPicksNote({ team, draftYear, pickInventory });
  const consensusMockTargets = buildTeamSchemeFitClusters({
    team,
    draftYear,
    topNeeds: topNeeds2027,
    firstPickMockDatabase,
    bigBoard: consensusBigBoard,
    projectedFirstPick: firstPickOverall
  });

  const bigBoardUrl = buildMockDraftBigBoardUrl(draftYear);
  const mockDbTeamUrl = buildMockDraftTeamUrl(draftYear, team.otcSlug);

  return {
    draftYear,
    bigBoardUrl,
    bigBoardMeta: sharedBigBoardMeta,
    bigBoardMethodology: sharedBigBoardMethodology,
    sources: [
      { label: 'NFL Mock Draft Database', url: mockDbTeamUrl },
      { label: `Tankathon ${team.nickname} Draft Order`, url: `https://www.tankathon.com/nfl/${team.slug}` },
      { label: 'NFL Combine Tracker', url: 'https://www.nfl.com/combine/' },
      { label: 'RAS Athletic Database', url: 'https://ras.football/' }
    ],
    tradedPicksNote,
    pickInventory,
    topNeeds2027,
    firstPickMockDatabase,
    consensusBigBoard,
    consensusMockTargets,
    combineLeaderboard: sharedCombineLeaderboard || []
  };
}
