/**
 * Shared UI Formatting & Safe HTML/Markdown Helpers
 */

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

  const formatInline = text =>
    esc(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

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
