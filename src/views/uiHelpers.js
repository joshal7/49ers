/**
 * Shared UI Formatting & Safe HTML/Markdown Helpers
 */

import { annotateJargonPlainText, jargonTerm } from '../engine/jargonGlossary.js';

export { jargonTerm };
export const escJargon = annotateJargonPlainText;

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

  const formatSegmentWithBoldAndJargon = seg => {
    // Split on **bold** markers, preserving jargon links inside or outside bold safely
    const parts = String(seg || '').split(/(\*\*[^*]+\*\*)/g);
    return parts
      .map(part => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return `<strong>${annotateJargonPlainText(part.slice(2, -2), { maxTerms: 4, seenKeys: seenJargon })}</strong>`;
        }
        return annotateJargonPlainText(part, { maxTerms: 6, seenKeys: seenJargon });
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
  const cleanAbbr = String(abbr || 'NFL').toUpperCase();
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
