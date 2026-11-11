/**
 * Shared UI Formatting & Safe HTML/Markdown Helpers
 */

import { annotateJargonPlainText, jargonTerm } from '../engine/jargonGlossary.js';
import { resolveReporterFromNameOrHandle } from '../engine/beatAttributionEngine.js';
import { sanitizeExternalUrl, toEspnTeamSlug } from '../engine/linkIntegrity.js';
import { iconSvg } from './icons.js';

export { jargonTerm };

let cachedRosterArrayRef = null;
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

export function registerRosterPlayersForInlineLinks(players = null) {
  if (!Array.isArray(players) || players.length === 0) return;
  if (players === cachedRosterArrayRef && inlinePlayerRegex) return;
  cachedRosterArrayRef = players;

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
  { maxTerms = 8, maxPlayers = 6, seenKeys = null, seenPlayerIds = null, excludePlayerId = null } = {}
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
      out += `<span class="inline-player-link" role="button" tabindex="0" data-action="open-player-sheet" data-player-id="${esc(pEntry.id)}" aria-label="Open ${esc(pEntry.name)} dossier">${esc(matchedText)}</span>`;
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

const KNOWN_SOURCE_OUTLET_URLS = {
  'nfl mock draft db': 'https://www.nflmockdraftdatabase.com/nfl-teams/2027/san-francisco-49ers',
  'nfl mock draft database': 'https://www.nflmockdraftdatabase.com/nfl-teams/2027/san-francisco-49ers',
  'cbs sports': 'https://www.cbssports.com/nfl/draft/',
  'espn': 'https://www.espn.com/nfl/team/_/name/sf/san-francisco-49ers',
  'overthecap': 'https://overthecap.com/salary-cap/san-francisco-49ers',
  'tankathon': 'https://www.tankathon.com/nfl/49ers'
};

export function renderReporterSourceLinksHtml(sourcesInput, fallbackUrl = null) {
  const safeFallback = sanitizeExternalUrl(fallbackUrl, null);
  if (Array.isArray(sourcesInput)) {
    const names = sourcesInput.map(s => String(s || '').trim()).filter(Boolean);
    if (names.length === 0) return '';
    return names
      .map(label => {
        const rep = resolveReporterFromNameOrHandle(label);
        const outletUrl = KNOWN_SOURCE_OUTLET_URLS[label.toLowerCase()] || null;
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
      const outletUrl = KNOWN_SOURCE_OUTLET_URLS[label.toLowerCase()] || null;
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

export function playProbBadgeClass(pct) {
  const n = Number(pct ?? 0);
  if (n >= 85) return 'badge-positive';
  if (n >= 45) return 'badge-warning';
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
  const hasValidUrl = /^https:\/\//i.test(rawUrl);
  const fallbackLabel =
    !showJerseyBadge && player?.jersey != null
      ? `#${player.jersey}`
      : playerInitials(player?.name || '');

  return `
    <span class="player-avatar ${hero ? 'hero-avatar' : ''} ${hasValidUrl ? '' : 'no-photo'} ${extraClass}" style="--av-size:${Number(size)}px">
      <span class="player-avatar-fallback mono" aria-hidden="true">${esc(fallbackLabel)}</span>
      ${
        hasValidUrl
          ? `<img class="player-avatar-img" src="${esc(rawUrl)}" alt="${esc(player?.name || 'Player')}" width="${Number(size)}" height="${Number(size)}" loading="lazy" decoding="async" />`
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
  return `
    <span class="team-logo-wrap ${extraClass}" style="--logo-size:${Number(size)}px">
      <span class="team-logo-fallback mono" aria-hidden="true">${esc(cleanAbbr)}</span>
      <img class="team-logo-img" src="${esc(resolved)}" alt="${esc(cleanAbbr)}" width="${Number(size)}" height="${Number(size)}" loading="lazy" decoding="async" />
    </span>
  `;
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
