/**
 * Shared UI Formatting & Safe HTML/Markdown Helpers
 */

import { annotateJargonPlainText, jargonTerm, jargonInfoIcon } from '../engine/jargonGlossary.js';
import { resolveReporterFromNameOrHandle } from '../engine/beatAttributionEngine.js';
import { sanitizeExternalUrl, toEspnTeamSlug } from '../engine/linkIntegrity.js';
import { optimizeImageUrlForSlot } from '../engine/salientMediaEngine.js';
import { splitSummaryForExpandableDisplay } from '../engine/breakingClassifier.js';
import { iconSvg } from './icons.js';
import { getActiveTeamConfig } from '../config/teamRegistry.js';

export { jargonTerm, jargonInfoIcon };

let cachedRosterArrayRef = null;
let cachedRosterTeamAbbr = null;
let cachedActiveTeamAbbr = null;
let inlinePlayerRegex = null;
let inlinePlayerByLowerPhrase = new Map();
let rosterByCanonKey = new Map();

function normalizePlayerCanon(name = '') {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(?:jr\.?|sr\.?|ii|iii|iv|v)\b\.?/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function escapeRegexChars(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function registerRosterPlayersForInlineLinks(players = null, { teamAbbr = null, activeTeamAbbr = null } = {}) {
  const resolvedActive = String(activeTeamAbbr || getActiveTeamConfig()?.abbr || 'SF').trim().toUpperCase();
  const nextTeam = String(teamAbbr || resolvedActive).trim().toUpperCase();
  if (!Array.isArray(players) || players.length === 0) {
    if (nextTeam !== resolvedActive) {
      cachedRosterArrayRef = null;
      cachedRosterTeamAbbr = nextTeam;
      cachedActiveTeamAbbr = resolvedActive;
      inlinePlayerRegex = null;
      inlinePlayerByLowerPhrase = new Map();
      rosterByCanonKey = new Map();
    }
    return;
  }
  if (
    players === cachedRosterArrayRef &&
    nextTeam === cachedRosterTeamAbbr &&
    resolvedActive === cachedActiveTeamAbbr &&
    inlinePlayerRegex
  ) {
    return;
  }
  cachedRosterArrayRef = players;
  cachedRosterTeamAbbr = nextTeam;
  cachedActiveTeamAbbr = resolvedActive;

  const phraseMap = new Map();
  const canonMap = new Map();

  for (const p of players) {
    if (!p?.id || !p?.name) continue;
    const full = String(p.name).trim();
    if (!full.includes(' ') || full.length < 6) continue;
    const entry = { id: String(p.id), name: full };

    const ck = normalizePlayerCanon(full);
    if (ck && !canonMap.has(ck)) canonMap.set(ck, entry);

    const variants = new Set([
      full,
      full.replace(/'/g, '’'),
      full.replace(/’/g, "'")
    ]);
    const collapsedFull = full.replace(/\b([A-Za-z])\.\s*([A-Za-z])\.(?=\s|$)/g, '$1$2');
    if (collapsedFull.includes(' ') && collapsedFull.length >= 6) {
      variants.add(collapsedFull);
    }
    const withoutSuffix = full.replace(/,?\s+\b(?:Jr\.?|Sr\.?|II|III|IV|V)\b\.?$/i, '').trim();
    if (withoutSuffix.includes(' ') && withoutSuffix.length >= 6) {
      variants.add(withoutSuffix);
      variants.add(withoutSuffix.replace(/'/g, '’'));
      const collapsedNoSuffix = withoutSuffix.replace(/\b([A-Za-z])\.\s*([A-Za-z])\.(?=\s|$)/g, '$1$2');
      if (collapsedNoSuffix.includes(' ') && collapsedNoSuffix.length >= 6) {
        variants.add(collapsedNoSuffix);
      }
    }

    for (const v of variants) {
      const lower = v.toLowerCase();
      if (!phraseMap.has(lower)) {
        phraseMap.set(lower, { phrase: v, ...entry });
      }
    }
  }

  const sortedPhrases = [...phraseMap.values()]
    .map(x => x.phrase)
    .sort((a, b) => b.length - a.length);

  inlinePlayerByLowerPhrase = phraseMap;
  rosterByCanonKey = canonMap;
  inlinePlayerRegex =
    sortedPhrases.length > 0
      ? new RegExp(
          `(?<![A-Za-z0-9_/'’-])(${sortedPhrases.map(escapeRegexChars).join('|')})(?![A-Za-z0-9_-])`,
          'gi'
        )
      : null;
}

export function lookupRosterPlayerByName(name = '') {
  const ck = normalizePlayerCanon(name);
  return ck ? rosterByCanonKey.get(ck) || null : null;
}

export function annotateRosterAndJargonPlainText(
  rawText,
  { maxTerms = 16, maxPlayers = 10, seenKeys = null, seenPlayerIds = null, excludePlayerId = null } = {}
) {
  if (rawText === null || rawText === undefined) return '';
  const text = String(rawText);
  if (!text) return '';

  if (!inlinePlayerRegex) {
    return annotateJargonPlainText(text, { maxTerms, seenKeys });
  }

  const usedJargon = seenKeys instanceof Set ? seenKeys : new Set();
  const usedPlayers = seenPlayerIds instanceof Set ? seenPlayerIds : new Set();
  const excl = excludePlayerId != null ? String(excludePlayerId) : null;
  let playerCount = 0;
  let lastIdx = 0;
  let out = '';

  inlinePlayerRegex.lastIndex = 0;
  let match;
  while ((match = inlinePlayerRegex.exec(text)) !== null) {
    const matchedText = match[1];
    const mStart = match.index;
    const mEnd = mStart + matchedText.length;

    if (mStart > lastIdx) {
      out += annotateJargonPlainText(text.slice(lastIdx, mStart), {
        maxTerms,
        seenKeys: usedJargon
      });
    }

    const pEntry = inlinePlayerByLowerPhrase.get(matchedText.toLowerCase());
    if (
      pEntry &&
      pEntry.id !== excl &&
      !usedPlayers.has(pEntry.id) &&
      playerCount < maxPlayers
    ) {
      usedPlayers.add(pEntry.id);
      playerCount += 1;
      if (cachedRosterTeamAbbr && cachedActiveTeamAbbr && cachedRosterTeamAbbr !== cachedActiveTeamAbbr) {
        out += `<span class="inline-player-link" role="button" tabindex="0" data-action="open-opponent-player-sheet" data-opp-team="${esc(cachedRosterTeamAbbr)}" data-opp-player-id="${esc(pEntry.id)}" data-opp-player-name="${esc(pEntry.name)}" aria-label="Open ${esc(pEntry.name)} dossier">${esc(matchedText)}</span>`;
      } else {
        out += `<span class="inline-player-link" role="button" tabindex="0" data-action="open-player-sheet" data-player-id="${esc(pEntry.id)}" aria-label="Open ${esc(pEntry.name)} dossier">${esc(matchedText)}</span>`;
      }
    } else {
      out += annotateJargonPlainText(matchedText, { maxTerms, seenKeys: usedJargon });
    }

    lastIdx = mEnd;
  }

  if (lastIdx < text.length) {
    out += annotateJargonPlainText(text.slice(lastIdx), {
      maxTerms,
      seenKeys: usedJargon
    });
  }

  return out;
}

export const escJargon = annotateRosterAndJargonPlainText;

function getKnownSourceOutletUrl(label = '') {
  const key = String(label || '').trim().toLowerCase();
  const team = getActiveTeamConfig();
  if (key === 'nfl mock draft db' || key === 'nfl mock draft database') {
    return `https://www.nflmockdraftdatabase.com/nfl-teams/2027/${team.otcSlug}`;
  }
  if (key === 'cbs sports') return 'https://www.cbssports.com/nfl/draft/';
  if (key === 'espn') return `https://www.espn.com/nfl/team/_/name/${team.espnAbbr}/${team.otcSlug}`;
  if (key === 'overthecap') return `https://overthecap.com/salary-cap/${team.otcSlug}`;
  if (key === 'tankathon') return `https://www.tankathon.com/nfl/${team.slug}`;
  return null;
}

export function renderReporterSourceLinksHtml(sourcesInput, fallbackUrl = null) {
  const safeFallback = sanitizeExternalUrl(fallbackUrl, null);
  if (Array.isArray(sourcesInput)) {
    const names = sourcesInput.map(s => String(s || '').trim()).filter(Boolean);
    if (names.length === 0) return '';
    return names
      .map(label => {
        const rep = resolveReporterFromNameOrHandle(label);
        const outletUrl = getKnownSourceOutletUrl(label);
        const href = sanitizeExternalUrl(rep?.xUrl || outletUrl || safeFallback, null);
        return href
          ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:inherit">${esc(label)} ${iconSvg('externalLink', 9)}</a>`
          : esc(label);
      })
      .join(', ');
  }

  const raw = String(sourcesInput || '').trim();
  if (!raw) return '';
  const tokens = raw.split(/(\s*(?:,|&)\s*)/);
  return tokens
    .map((tok, idx) => {
      if (idx % 2 === 1) return esc(tok);
      const label = tok.trim();
      if (!label) return '';
      const rep = resolveReporterFromNameOrHandle(label);
      const outletUrl = getKnownSourceOutletUrl(label);
      const href = sanitizeExternalUrl(rep?.xUrl || outletUrl || safeFallback, null);
      return href
        ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="ext-link" style="font-size:inherit">${esc(label)} ${iconSvg('externalLink', 9)}</a>`
        : esc(label);
    })
    .join('');
}

export function buildEspnNflTeamUrl(abbr = 'SF') {
  const clean = String(abbr || 'SF').toUpperCase().trim();
  const slugMap = {
    ARI: 'ari/arizona-cardinals',
    ATL: 'atl/atlanta-falcons',
    BAL: 'bal/baltimore-ravens',
    BUF: 'buf/buffalo-bills',
    CAR: 'car/carolina-panthers',
    CHI: 'chi/chicago-bears',
    CIN: 'cin/cincinnati-bengals',
    CLE: 'cle/cleveland-browns',
    DAL: 'dal/dallas-cowboys',
    DEN: 'den/denver-broncos',
    DET: 'det/detroit-lions',
    GB: 'gb/green-bay-packers',
    HOU: 'hou/houston-texans',
    IND: 'ind/indianapolis-colts',
    JAX: 'jax/jacksonville-jaguars',
    KC: 'kc/kansas-city-chiefs',
    LAC: 'lac/los-angeles-chargers',
    LAR: 'lar/los-angeles-rams',
    LV: 'lv/las-vegas-raiders',
    MIA: 'mia/miami-dolphins',
    MIN: 'min/minnesota-vikings',
    NE: 'ne/new-england-patriots',
    NO: 'no/new-orleans-saints',
    NYG: 'nyg/new-york-giants',
    NYJ: 'nyj/new-york-jets',
    PHI: 'phi/philadelphia-eagles',
    PIT: 'pit/pittsburgh-steelers',
    SEA: 'sea/seattle-seahawks',
    SF: 'sf/san-francisco-49ers',
    TB: 'tb/tampa-bay-buccaneers',
    TEN: 'ten/tennessee-titans',
    WAS: 'wsh/washington-commanders',
    WSH: 'wsh/washington-commanders'
  };
  const path = slugMap[clean] || `${toEspnTeamSlug(clean)}/${toEspnTeamSlug(clean)}`;
  return `https://www.espn.com/nfl/team/_/name/${path}`;
}

export function esc(str = '') {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatRelativeAge(isoStr) {
  if (!isoStr) return 'Recently updated';
  const diffMs = Date.now() - new Date(isoStr).getTime();
  if (Number.isNaN(diffMs)) return 'Live';
  const mins = Math.max(1, Math.floor(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
export const relTime = formatRelativeAge;

export function resolvePlayerPlayBadgeLabel(player = null) {
  const h = player?.health || {};
  const explicit = String(h.playBadgeLabel || '').trim();
  if (explicit) return explicit;
  const bucket = String(player?.rosterBucket || 'active').toLowerCase();
  const statusLower = String(h.status || '').toLowerCase();
  if (bucket === 'practice_squad') {
    return statusLower.includes('injured') ? '0% • PS (Injured)' : '0% • Prac. Squad';
  }
  if (bucket === 'suspended' || statusLower.includes('suspended')) return '0% • Suspended';
  if (bucket === 'ir') {
    if (h.isSeasonEnding || statusLower.includes('season')) return '0% • Out for Season';
    if (statusLower.includes('pup')) return '0% • Reserve/PUP';
    if (statusLower.includes('roster exemption')) return '0% • Roster Exemption';
    if (statusLower.includes('left squad')) return '0% • Reinstatement';
    return '0% • IR';
  }
  const pct = Number.isFinite(Number(h.playProbabilityPct)) ? Math.round(Number(h.playProbabilityPct)) : 99;
  if (pct >= 85) return `${pct}% • Full Go`;
  if (pct >= 50) return `${pct}% • GTD`;
  if (pct >= 20) return `${pct}% • Long Shot`;
  if (pct > 0) return `${pct}% • Doubtful`;
  return '0% • Out';
}

export function playProbBadgeClass(pct, meta = null) {
  const tier = String(meta?.playTier || meta?.tier || '').toUpperCase();
  const bucket = String(meta?.rosterBucket || '').toLowerCase();
  const label = String(meta?.playBadgeLabel || meta?.badgeLabel || '').toLowerCase();
  if (
    (tier === 'PRACTICE_SQUAD' ||
      bucket === 'practice_squad' ||
      /\bprac\.?\s*squad\b|\bpractice\s+squad\b/i.test(label)) &&
    !/injur|\bout\b|suspend/i.test(label)
  ) {
    return 'badge-neutral';
  }
  const n = Number(pct ?? 0);
  if (n >= 85) return 'badge-positive';
  if (n >= 50) return 'badge-warning';
  if (n >= 20) return 'badge-orange';
  return 'badge-danger';
}

export function rankBadgeClass(rank) {
  const r = Number(rank || 16);
  if (r <= 8) return 'badge-positive';
  if (r <= 18) return 'badge-gold';
  return 'badge-danger';
}

export function renderMarkdownSafe(md = '') {
  const lines = String(md || '').split(/\r?\n/);
  const html = [];
  let inList = false;
  const seenJargon = new Set();
  const seenPlayers = new Set();

  const formatSegmentWithBoldAndJargon = seg => {
    // Split on **bold** markers, preserving roster & jargon links inside or outside bold safely
    const parts = String(seg || '').split(/(\*\*[^*]+\*\*)/g);
    return parts
      .map(part => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return `<strong>${annotateRosterAndJargonPlainText(part.slice(2, -2), {
            maxTerms: 4,
            maxPlayers: 4,
            seenKeys: seenJargon,
            seenPlayerIds: seenPlayers
          })}</strong>`;
        }
        return annotateRosterAndJargonPlainText(part, {
          maxTerms: 6,
          maxPlayers: 6,
          seenKeys: seenJargon,
          seenPlayerIds: seenPlayers
        });
      })
      .join('');
  };

  const formatInline = text => {
    const codeSplit = String(text || '').split(/(`[^`]+`)/g);
    return codeSplit
      .map(chunk => {
        if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length > 2) {
          return `<code>${esc(chunk.slice(1, -1))}</code>`;
        }
        return formatSegmentWithBoldAndJargon(chunk);
      })
      .join('');
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      continue;
    }

    if (line.startsWith('#### ')) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push(`<h4>${formatInline(line.slice(5))}</h4>`);
    } else if (line.startsWith('### ')) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push(`<h3>${formatInline(line.slice(4))}</h3>`);
    } else if (line.startsWith('* ') || line.startsWith('- ')) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${formatInline(line.slice(2))}</li>`);
    } else if (/^\d+\.\s+/.test(line)) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${formatInline(line.replace(/^\d+\.\s+/, ''))}</li>`);
    } else {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      html.push(`<p style="margin:6px 0">${formatInline(line)}</p>`);
    }
  }
  if (inList) html.push('</ul>');
  return `<div class="md-report">${html.join('')}</div>`;
}

const TEAM_LOGO_SLUGS = {
  WAS: 'wsh',
  WSH: 'wsh',
  LAR: 'lar',
  LA: 'lar',
  LV: 'lv',
  OAK: 'lv',
  SF: 'sf',
  SFO: 'sf',
  GB: 'gb',
  NO: 'no',
  NE: 'ne',
  TB: 'tb',
  KC: 'kc',
  JAX: 'jax'
};

export function espnTeamLogoUrl(abbr = 'SF', explicitUrl = '') {
  if (explicitUrl && /^https:\/\//i.test(explicitUrl)) return explicitUrl;
  const clean = String(abbr || 'SF').toUpperCase().trim();
  const slug = TEAM_LOGO_SLUGS[clean] || clean.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nfl/500/${encodeURIComponent(slug)}.png`;
}

export function playerInitials(name = '') {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'SF';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function renderPlayerAvatarHtml(player = {}, size = 40, opts = {}) {
  const { showJerseyBadge = false, hero = false, extraClass = '' } = opts;
  const rawUrl = String(player?.headshotUrl || '').trim();
  const optImg = /^https:\/\//i.test(rawUrl)
    ? optimizeImageUrlForSlot(rawUrl, hero ? 'hero' : 'avatar')
    : { src: '', fallbackSrc: '' };
  const hasValidUrl = Boolean(optImg.src);
  const fallbackLabel =
    !showJerseyBadge && player?.jersey != null
      ? `#${player.jersey}`
      : playerInitials(player?.name || '');

  return `
    <span class="player-avatar ${hero ? 'hero-avatar' : ''} ${hasValidUrl ? '' : 'no-photo'} ${extraClass}" style="--av-size:${Number(size)}px">
      <span class="player-avatar-fallback mono" aria-hidden="true">${esc(fallbackLabel)}</span>
      ${
        hasValidUrl
          ? `<img class="player-avatar-img" src="${esc(optImg.src)}" ${optImg.fallbackSrc ? `data-fallback-src="${esc(optImg.fallbackSrc)}"` : ''} alt="${esc(player?.name || 'Player')}" width="${Number(size)}" height="${Number(size)}" loading="lazy" decoding="async" />`
          : ''
      }
      ${
        showJerseyBadge && player?.jersey != null
          ? `<span class="player-avatar-num mono">#${player.jersey}</span>`
          : ''
      }
    </span>
  `;
}

export function renderTeamLogoHtml(abbr = 'SF', logoUrl = '', size = 24, extraClass = '') {
  const cleanAbbr = String(abbr || 'NFL').toUpperCase().trim();
  const isPlaceholderAbbr = /^(?:TBD|NFL|OPP|BYE|NFC|AFC)$/.test(cleanAbbr);
  const hasExplicitHttpLogo = Boolean(logoUrl && /^https:\/\//i.test(String(logoUrl).trim()));
  if (isPlaceholderAbbr && !hasExplicitHttpLogo) {
    return `
      <span class="team-logo-wrap img-error no-logo-img ${extraClass}" style="--logo-size:${Number(size)}px">
        <span class="team-logo-fallback mono" aria-hidden="true">${esc(cleanAbbr === 'BYE' ? 'SF' : cleanAbbr)}</span>
      </span>
    `;
  }
  const resolved = espnTeamLogoUrl(cleanAbbr, logoUrl);
  const optLogo = optimizeImageUrlForSlot(resolved, 'logo');
  const imgSrc = optLogo.src || resolved;
  return `
    <span class="team-logo-wrap ${extraClass}" style="--logo-size:${Number(size)}px">
      <span class="team-logo-fallback mono" aria-hidden="true">${esc(cleanAbbr)}</span>
      <img class="team-logo-img" src="${esc(imgSrc)}" ${optLogo.fallbackSrc ? `data-fallback-src="${esc(optLogo.fallbackSrc)}"` : ''} alt="${esc(cleanAbbr)}" width="${Number(size)}" height="${Number(size)}" loading="lazy" decoding="async" />
    </span>
  `;
}

/**
 * Renders a crisp, latency-optimized right-rail thumbnail across News, Home, Sources,
 * Player Dossiers & Health feeds. Handles all 4 visual tiers:
 * - `editorial`: full-bleed sports photography (`object-fit: cover`, top-weighted focal crop)
 * - `player`: stadium-spotlight transparent headshot with subtle jersey number pill
 * - `matchup`: dual-crest SF × OPP visual badge
 * - `team`: compact 49ers editorial/podium crest badge
 *
 * Uses `asStatic: true` whenever embedded inside an outer `<a>` card to guarantee zero nested `<a>` tags.
 */
export function renderSalientThumbHtml(
  visual,
  {
    href = '',
    size = 'lg', // 'lg' (84px) | 'md' (64px) | 'sm' (48px)
    eager = false,
    asStatic = false,
    extraClass = '',
    markReadKey = ''
  } = {}
) {
  if (!visual || !visual.kind) return '';

  const dim = size === 'sm' ? 48 : size === 'md' ? 64 : 84;
  const sizeCls = size === 'sm' ? 'thumb-sm' : size === 'md' ? 'thumb-md' : 'thumb-lg';
  const loadAttr = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy" fetchpriority="low"';
  const safeHref = !asStatic && href ? sanitizeExternalUrl(href, null) : null;
  const cls = `raw-item-thumb salient-thumb ${sizeCls} thumb-kind-${esc(visual.kind)} ${extraClass}`.trim();

  let innerHtml = '';

  if (visual.kind === 'editorial') {
    innerHtml = `<img src="${esc(visual.src)}" ${visual.fallbackSrc ? `data-fallback-src="${esc(visual.fallbackSrc)}"` : ''} alt="${esc(visual.alt || `${getActiveTeamConfig().nickname} photo`)}" width="${dim}" height="${dim}" ${loadAttr} decoding="async" />`;
  } else if (visual.kind === 'player') {
    const showJersey = size !== 'sm' && visual.jersey != null && visual.jersey !== '';
    innerHtml = `
      <img class="salient-player-cutout" src="${esc(visual.src)}" ${visual.fallbackSrc ? `data-fallback-src="${esc(visual.fallbackSrc)}"` : ''} alt="${esc(visual.alt || visual.playerName || `${getActiveTeamConfig().nickname} player`)}" width="${dim}" height="${dim}" ${loadAttr} decoding="async" />
      ${showJersey ? `<span class="salient-thumb-chip mono">#${esc(String(visual.jersey))}</span>` : ''}
    `;
  } else if (visual.kind === 'matchup') {
    const crestDim = size === 'sm' ? 20 : size === 'md' ? 26 : 32;
    innerHtml = `
      <span class="salient-matchup-crests" aria-hidden="true">
        <img class="salient-crest sf" src="${esc(visual.sfLogoSrc)}" ${visual.sfLogoFallback ? `data-fallback-src="${esc(visual.sfLogoFallback)}"` : ''} alt="SF" width="${crestDim}" height="${crestDim}" loading="lazy" decoding="async" />
        <span class="salient-crest-sep"></span>
        <img class="salient-crest opp" src="${esc(visual.oppLogoSrc)}" ${visual.oppLogoFallback ? `data-fallback-src="${esc(visual.oppLogoFallback)}"` : ''} alt="${esc(visual.oppAbbr || 'OPP')}" width="${crestDim}" height="${crestDim}" loading="lazy" decoding="async" />
      </span>
      ${size !== 'sm' ? `<span class="salient-thumb-chip mono">vs ${esc(visual.oppAbbr || 'NFL')}</span>` : ''}
    `;
  } else if (visual.kind === 'team') {
    const crestDim = size === 'sm' ? 24 : size === 'md' ? 30 : 38;
    innerHtml = `
      <img class="salient-team-emblem" src="${esc(visual.sfLogoSrc)}" ${visual.sfLogoFallback ? `data-fallback-src="${esc(visual.sfLogoFallback)}"` : ''} alt="${esc(getActiveTeamConfig().fullName)}" width="${crestDim}" height="${crestDim}" loading="lazy" decoding="async" />
      ${size !== 'sm' && visual.tagLabel ? `<span class="salient-thumb-chip mono">${esc(visual.tagLabel)}</span>` : ''}
    `;
  } else {
    return '';
  }

  if (safeHref) {
    const readAttr = markReadKey ? ` data-mark-read-key="${esc(markReadKey)}"` : '';
    return `<a href="${esc(safeHref)}" target="_blank" rel="noopener noreferrer" class="${cls}" data-salient-thumb="${esc(visual.kind)}"${readAttr} aria-hidden="true" tabindex="-1">${innerHtml}</a>`;
  }
  return `<span class="${cls}" data-salient-thumb="${esc(visual.kind)}" aria-hidden="true">${innerHtml}</span>`;
}

/**
 * Renders a sleek, restrained 16:9 / 2.2:1 editorial lead hero photograph for the
 * Daily Top News Brief or #1 Lead Editorial Story in News & Film.
 */
export function renderSalientHeroBannerHtml(
  hero,
  {
    href = '',
    compact = false,
    creditLabel = '',
    badgeText = '',
    eager = true,
    extraClass = '',
    markReadKey = ''
  } = {}
) {
  if (!hero?.src) return '';
  const safeHref = href ? sanitizeExternalUrl(href, null) : null;
  const loadAttr = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy" fetchpriority="low"';
  const credit = creditLabel || hero.creditLabel || '';
  const wrapCls = `salient-hero-banner ${compact ? 'compact' : ''} ${extraClass}`.trim();

  const imgHtml = `
    <img src="${esc(hero.src)}" ${hero.fallbackSrc ? `data-fallback-src="${esc(hero.fallbackSrc)}"` : ''} alt="${esc(hero.alt || `${getActiveTeamConfig().nickname} editorial photo`)}" class="salient-hero-img" width="640" height="${compact ? 290 : 360}" ${loadAttr} decoding="async" />
    <span class="salient-hero-scrim" aria-hidden="true"></span>
    ${
      badgeText || credit
        ? `<span class="salient-hero-meta">
             ${badgeText ? `<span class="salient-hero-badge mono">${esc(badgeText)}</span>` : '<span></span>'}
             ${credit ? `<span class="salient-hero-credit">${esc(credit)}</span>` : ''}
           </span>`
        : ''
    }
  `;

  if (safeHref) {
    const readAttr = markReadKey ? ` data-mark-read-key="${esc(markReadKey)}"` : '';
    return `<a href="${esc(safeHref)}" target="_blank" rel="noopener noreferrer" class="raw-item-thumb ${wrapCls}" data-salient-hero="true"${readAttr} aria-hidden="true" tabindex="-1">${imgHtml}</a>`;
  }
  return `<div class="${wrapCls}" data-salient-hero="true">${imgHtml}</div>`;
}

export function renderPlayerChipsStripHtml(players = [], max = 5) {
  const list = (players || []).filter(Boolean).slice(0, max);
  if (list.length === 0) return '';
  return `
    <div class="featured-players-strip" aria-label="Featured Players">
      ${list
        .map(p => {
          const inner = `
            ${renderPlayerAvatarHtml(p, 22, { showJerseyBadge: false, extraClass: 'chip-avatar' })}
            <span class="fp-chip-name">${esc(p.shortName || p.name)}</span>
            <span class="fp-chip-meta mono">${p.jersey != null ? `#${p.jersey}` : esc(p.position || '')}</span>
          `;
          if (p.id) {
            return `<button type="button" class="featured-player-chip" data-action="open-player-sheet" data-player-id="${esc(p.id)}">${inner}</button>`;
          }
          return `<span class="featured-player-chip">${inner}</span>`;
        })
        .join('')}
    </div>
  `;
}

export function renderAvatarStackHtml(players = [], size = 30, max = 6) {
  const list = (players || []).filter(Boolean).slice(0, max);
  if (list.length === 0) return '';
  return `
    <div class="avatar-stack" aria-label="Featured Roster Stars">
      ${list
        .map(p => {
          const av = renderPlayerAvatarHtml(p, size, { showJerseyBadge: false, extraClass: 'stack-item' });
          if (p.id) {
            return `<button type="button" class="avatar-stack-btn" title="${esc(p.name)} (${esc(p.position || '')})" data-action="open-player-sheet" data-player-id="${esc(p.id)}">${av}</button>`;
          }
          return `<span class="avatar-stack-btn" title="${esc(p.name)}">${av}</span>`;
        })
        .join('')}
    </div>
  `;
}

export function renderMiniMeterHtml(pct = 0, tone = 'gold') {
  const clamped = Math.max(2, Math.min(100, Number(pct || 0)));
  return `
    <div class="mini-meter-track" aria-hidden="true">
      <div class="mini-meter-fill tone-${esc(tone)}" style="width:${clamped.toFixed(1)}%"></div>
    </div>
  `;
}

/**
 * Renders a wire/article summary with progressive disclosure when it exceeds the rare
 * long-summary threshold (>450 chars, <2% of feed items), hiding the tail behind an inline
 * "Show more" / "Show less" button while leaving normal summaries untouched.
 */
export function renderExpandableSummaryHtml(
  summaryText = '',
  { className = 'wire-card-summary', jargonOptions = undefined, expandThreshold, previewMax } = {}
) {
  const split = splitSummaryForExpandableDisplay(summaryText, {
    ...(expandThreshold != null ? { expandThreshold } : {}),
    ...(previewMax != null ? { previewMax } : {})
  });
  if (!split.fullText) return '';
  if (!split.isTruncated) {
    return `<div class="${esc(className)}">${escJargon(split.fullText, jargonOptions)}</div>`;
  }
  return `<div class="${esc(className)} is-expandable-summary" data-expandable-summary="collapsed"><span class="wire-summary-preview" data-summary-preview>${escJargon(split.previewText, jargonOptions)} <button type="button" class="wire-summary-toggle-btn" data-action="toggle-wire-summary" aria-expanded="false">Show more</button></span><span class="wire-summary-full" data-summary-full hidden>${escJargon(split.fullText, jargonOptions)} <button type="button" class="wire-summary-toggle-btn" data-action="toggle-wire-summary" aria-expanded="true">Show less</button></span></div>`;
}

/**
 * Renders a tasteful, uncluttered direct-click linked article preview card embedded directly
 * below a tweet — eliminating the extra hop through X or Bluesky.
 *
 * Variants:
 * - `'card'` (Bluesky/X media-top link card): Used on standalone Tweet cards when a real
 *   editorial photograph is available (`aspect-ratio` banner on top, crisp 2-line title + domain below).
 * - `'compact'` (Horizontal link preview card): Used inside `Similar stories`, `Daily Brief Sources`,
 *   `Home` compact tweet rows, `Compact` scan mode, or whenever no editorial photo is attached.
 */
export function renderTweetLinkedArticleCardHtml(
  preview = null,
  { variant = 'card', markReadKey = '', eager = false, extraClass = '' } = {}
) {
  if (!preview || !preview.url) return '';
  const safeHref = sanitizeExternalUrl(preview.url, null);
  if (!safeHref) return '';

  const hasPhoto = Boolean(preview.imageUrl);
  const effectiveVariant = variant === 'card' && hasPhoto ? 'card' : 'compact';
  const loadAttr = eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy" fetchpriority="low"';
  const readAttr = markReadKey ? ` data-mark-read-key="${esc(markReadKey)}"` : '';

  let mediaHtml = '';
  if (hasPhoto) {
    const opt = optimizeImageUrlForSlot(preview.imageUrl, effectiveVariant === 'card' ? 'hero' : 'thumb');
    if (opt.src) {
      const dims = effectiveVariant === 'card' ? 'width="560" height="280"' : 'width="84" height="56"';
      mediaHtml = `<span class="tweet-linked-article-media"><img src="${esc(opt.src)}" ${opt.fallbackSrc ? `data-fallback-src="${esc(opt.fallbackSrc)}"` : ''} alt="${esc(preview.title || preview.publisherName || 'Linked article photo')}" ${dims} ${loadAttr} decoding="async" /></span>`;
    }
  }

  const domainText = preview.domain || preview.publisherName || 'Article';
  const bylineSuffix = preview.byline ? ` · ${preview.byline}` : '';
  const ctaLabel = preview.isPodcast ? 'Listen' : 'Read';
  const cls = [
    'tweet-linked-article-card',
    effectiveVariant === 'card' ? 'is-media-top' : 'is-compact',
    mediaHtml ? 'has-media' : 'no-media',
    extraClass
  ]
    .filter(Boolean)
    .join(' ');

  return `
    <a href="${esc(safeHref)}" target="_blank" rel="noopener noreferrer" class="${cls}" data-linked-article-card="true" data-linked-article-variant="${esc(effectiveVariant)}" data-linked-article-domain="${esc(domainText)}"${readAttr}>
      ${mediaHtml}
      <span class="tweet-linked-article-body">
        <span class="tweet-linked-article-title">${esc(preview.title || `Read full story on ${preview.publisherName || domainText}`)}</span>
        <span class="tweet-linked-article-meta">
          <span class="tweet-linked-article-domain">
            ${iconSvg('globe', 11)}
            <span class="tweet-linked-article-domain-text">${esc(domainText)}${esc(bylineSuffix)}</span>
          </span>
          <span class="tweet-linked-article-cta">${esc(ctaLabel)} ${iconSvg('externalLink', 10)}</span>
        </span>
      </span>
    </a>
  `;
}
