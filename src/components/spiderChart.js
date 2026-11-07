/**
 * MockDraftable-Style Positional Percentile SVG Radar / Spider Chart Renderer
 * Renders a crisp 10-axis radar chart (0–100th positional percentile) + drill table + historical NFL comps.
 */

function escapeHtml(str = '') {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderSpiderChartHtml(spiderProfile, playerName = '') {
  if (!spiderProfile || !Array.isArray(spiderProfile.axes) || spiderProfile.axes.length === 0) {
    return `<div class="empty-state">Athletic profile measurables unavailable.</div>`;
  }

  const axes = spiderProfile.axes;
  const n = axes.length;
  const size = 300;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 96;

  const angleFor = idx => -Math.PI / 2 + (idx * 2 * Math.PI) / n;
  const pointFor = (idx, pct) => {
    const r = (Math.max(4, Math.min(100, pct)) / 100) * maxR;
    const a = angleFor(idx);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  // Concentric reference polygons at 25th, 50th (average), 75th, 100th percentiles
  const rings = [25, 50, 75, 100].map(level => {
    const pts = axes
      .map((_, i) => pointFor(i, level).map(v => v.toFixed(1)).join(','))
      .join(' ');
    const isAvg = level === 50;
    return `<polygon points="${pts}" fill="none" stroke="${
      isAvg ? '#B3995D' : 'rgba(179,153,93,0.22)'
    }" stroke-width="${isAvg ? '1.4' : '1'}" ${isAvg ? 'stroke-dasharray="3 3"' : ''}/>`;
  });

  // Spokes & outer labels
  const spokes = [];
  const labels = [];
  for (let i = 0; i < n; i++) {
    const [ox, oy] = pointFor(i, 100);
    spokes.push(
      `<line x1="${cx}" y1="${cy}" x2="${ox.toFixed(1)}" y2="${oy.toFixed(1)}" stroke="rgba(255,255,255,0.12)" stroke-width="1"/>`
    );

    const a = angleFor(i);
    const lx = cx + (maxR + 27) * Math.cos(a);
    const ly = cy + (maxR + 22) * Math.sin(a);
    const anchor = Math.abs(Math.cos(a)) < 0.22 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
    const shortLbl = axes[i].label
      .replace('40-Yd Dash', '40-Yd')
      .replace('10-Yd Split', '10-Split')
      .replace('20-Yd Shuttle', 'Shuttle')
      .replace('Broad Jump', 'Broad')
      .replace('Bench Press', 'Bench')
      .replace('Arm Length', 'Arm');

    labels.push(`
      <text x="${lx.toFixed(1)}" y="${(ly - 3).toFixed(1)}" text-anchor="${anchor}" class="spider-axis-name">${escapeHtml(shortLbl)}</text>
      <text x="${lx.toFixed(1)}" y="${(ly + 9).toFixed(1)}" text-anchor="${anchor}" class="spider-axis-pct">${axes[i].percentile}th</text>
    `);
  }

  // Player percentile polygon & vertex dots
  const polyPoints = axes
    .map((ax, i) => pointFor(i, ax.percentile).map(v => v.toFixed(1)).join(','))
    .join(' ');

  const dots = axes.map((ax, i) => {
    const [px, py] = pointFor(i, ax.percentile);
    const dotColor = ax.percentile >= 80 ? '#10B981' : ax.percentile >= 45 ? '#E5CF96' : '#EF4444';
    return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.8" fill="${dotColor}" stroke="#0B0D10" stroke-width="1.3"/>`;
  });

  const rasScore = Number(spiderProfile.compositeRas || 0).toFixed(2);
  const rasClass =
    spiderProfile.compositeRas >= 8.0
      ? 'badge-positive'
      : spiderProfile.compositeRas >= 5.5
        ? 'badge-gold'
        : 'badge-neutral';

  const drillRows = axes
    .map(ax => {
      const barColor =
        ax.percentile >= 80 ? 'var(--emerald)' : ax.percentile >= 45 ? 'var(--gold)' : 'var(--crimson)';
      return `
        <div class="spider-drill-row">
          <div class="spider-drill-meta">
            <span class="spider-drill-label">${escapeHtml(ax.label)}</span>
            <span class="spider-drill-val mono">${escapeHtml(ax.displayValue)}</span>
          </div>
          <div class="spider-bar-track">
            <div class="spider-bar-fill" style="width:${ax.percentile}%;background:${barColor}"></div>
          </div>
          <span class="spider-drill-pct mono">${ax.percentile}%</span>
        </div>
      `;
    })
    .join('');

  const compsHtml =
    Array.isArray(spiderProfile.historicalComps) && spiderProfile.historicalComps.length > 0
      ? `
        <div class="spider-comps-box">
          <div class="sub-label">MockDraftable Euclidean NFL Athletic Comps (${escapeHtml(spiderProfile.posGroup)})</div>
          <div class="spider-comps-grid">
            ${spiderProfile.historicalComps
              .map(
                c => `
              <div class="spider-comp-chip">
                <span class="comp-name">${escapeHtml(c.name)}</span>
                <span class="comp-meta mono">${c.draftYear ? `'${String(c.draftYear).slice(-2)} • ` : ''}${c.similarityPct}% match</span>
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `
      : '';

  return `
    <div class="spider-card" aria-label="MockDraftable Athletic Spider Chart for ${escapeHtml(playerName)}">
      <div class="spider-header">
        <div>
          <div class="sub-label">Positional Athletic Percentiles (${escapeHtml(spiderProfile.posGroup)})</div>
          <div class="spider-source-note">${escapeHtml(spiderProfile.sourceType)} • Dashed Gold = 50th Pct NFL Avg</div>
        </div>
        <span class="badge ${rasClass} mono">RAS ${rasScore} / 10</span>
      </div>

      <div class="spider-svg-wrap">
        <svg viewBox="0 0 ${size} ${size}" class="spider-svg" role="img" aria-label="${escapeHtml(playerName)} athletic percentile radar chart">
          <defs>
            <radialGradient id="sfSpiderGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="#D11919" stop-opacity="0.52"/>
              <stop offset="100%" stop-color="#AA0000" stop-opacity="0.26"/>
            </radialGradient>
          </defs>
          ${rings.join('')}
          ${spokes.join('')}
          <polygon points="${polyPoints}" fill="url(#sfSpiderGrad)" stroke="#E5CF96" stroke-width="2.1"/>
          ${dots.join('')}
          ${labels.join('')}
        </svg>
      </div>

      <div class="spider-drills-list">
        ${drillRows}
      </div>

      ${compsHtml}
    </div>
  `;
}
