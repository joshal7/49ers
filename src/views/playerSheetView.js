/**
 * 5-Tab Player Dossier Slide-Up Bottom Sheet Renderer
 * Tabs:
 * 1. overview  — Bio, Draft Info, Snap %, Efficiency Callout & Player News
 * 2. stats     — 2026 Season vs Career Year-by-Year Standard + EPA + NextGen Stats + PFR Adv
 * 3. spider    — MockDraftable 0–100th Positional Percentile SVG Radar Chart + Comps
 * 4. contract  — Multi-Year OverTheCap Breakdown + Pre/Post-June 1 Cut/Trade/Restructure Calculator
 * 5. health    — Week 9 Practice Progression, Player Toughness/Vet-Rest Priors & 2026 Injury Log
 */

import { esc, playProbBadgeClass } from './uiHelpers.js';
import { iconSvg } from './icons.js';
import { renderSpiderChartHtml } from '../components/spiderChart.js';
import { formatDollars, formatCompactDollars, formatCapActionLabel } from '../engine/capSimulator.js';

export function renderPlayerDossierSheetHtml({
  player,
  activeTab = 'overview',
  statsMode = '2026', // '2026' | 'career'
  txScenario = 'cut'
}) {
  if (!player) return `<div class="empty-state">Player not found.</div>`;

  const tabDefs = [
    ['overview', 'football', 'Overview'],
    ['stats', 'season', 'Stats & EPA'],
    ['spider', 'radar', 'Spider Chart'],
    ['contract', 'cap', 'Contract & Cap'],
    ['health', 'heartPulse', 'Health & Priors']
  ];

  const tabsBar = `
    <div class="pill-bar" role="tablist" aria-label="Player Dossier Sections">
      ${tabDefs
        .map(
          ([key, ic, label]) => `
        <button type="button" role="tab" aria-selected="${activeTab === key}"
                class="pill-btn ${activeTab === key ? 'active' : ''}"
                data-action="set-player-tab" data-player-tab="${key}">
          ${iconSvg(ic, 13)}
          <span>${esc(label)}</span>
        </button>
      `
        )
        .join('')}
    </div>
  `;

  let contentHtml = '';

  if (activeTab === 'overview') {
    contentHtml = renderOverviewTab(player);
  } else if (activeTab === 'stats') {
    contentHtml = renderStatsTab(player, statsMode);
  } else if (activeTab === 'spider') {
    contentHtml = renderSpiderChartHtml(player.spiderProfile, player.name);
  } else if (activeTab === 'contract') {
    contentHtml = renderContractTab(player, txScenario);
  } else if (activeTab === 'health') {
    contentHtml = renderHealthTab(player);
  }

  return `${tabsBar}${contentHtml}`;
}

function renderOverviewTab(p) {
  const newsHtml =
    Array.isArray(p.recentNews) && p.recentNews.length > 0
      ? `
        <div>
          <div class="sub-label" style="margin-bottom:6px">Recent Beat &amp; Roster Mentions</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${p.recentNews
              .map(
                n => `
              <div class="subcard-panel" style="font-size:12.5px">
                <a href="${esc(n.url)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(n.headline)}</strong> ${iconSvg('externalLink', 12)}</a>
                ${n.summary ? `<div style="color:var(--text-secondary);margin-top:2px">${esc(n.summary)}</div>` : ''}
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `
      : `<div style="font-size:12px;color:var(--text-muted)">No breaking beat items specific to ${esc(p.name)} in the past 7 days.</div>`;

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="jersey-chip mono" style="width:42px;height:42px;font-size:15px">#${p.jersey ?? '—'}</div>
        <div>
          <div style="font-weight:800;font-size:15px">${esc(p.position)} • ${esc(p.unit)} (${esc(p.rosterBucket.replace('_', ' ').toUpperCase())})</div>
          <div style="font-size:12px;color:var(--text-secondary)">${esc(p.displayHeight)} • ${esc(p.displayWeight)} • Age ${p.age ?? '—'} • ${esc(p.college)}</div>
        </div>
      </div>
      <span class="badge ${playProbBadgeClass(p.health?.playProbabilityPct)} mono">${esc(p.health?.playBadgeLabel)}</span>
    </div>

    <div class="kpi-grid">
      <div class="kpi-box">
        <div class="kpi-label">Draft Pedigree</div>
        <div class="kpi-val" style="font-size:12px">${esc(p.draftInfo)}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">2026 Snap Share</div>
        <div class="kpi-val mono">${p.primarySnapPct}%</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">2026 Cap Hit</div>
        <div class="kpi-val mono">${p.capHit2026 ? formatCompactDollars(p.capHit2026) : 'PS/Min'}</div>
      </div>
    </div>

    ${
      p.publicEfficiencyNote
        ? `<div style="padding:9px 11px;border-radius:9px;background:var(--gold-soft);border:1px solid var(--gold-border);font-size:12.5px">
            <strong style="color:var(--gold-bright)">Beat &amp; Film Efficiency Callout:</strong> ${esc(p.publicEfficiencyNote)}
           </div>`
        : ''
    }

    ${newsHtml}
  `;
}

function renderStatsTab(p, statsMode) {
  const seasons = p.careerSeasons || [];
  const s26 = p.stats2026;

  const modeToggle = `
    <div style="display:flex;gap:6px">
      <button type="button" class="pill-btn ${statsMode === '2026' ? 'active' : ''}" data-action="set-player-stats-mode" data-stats-mode="2026">2026 Season</button>
      <button type="button" class="pill-btn ${statsMode === 'career' ? 'active' : ''}" data-action="set-player-stats-mode" data-stats-mode="career">Career Year-by-Year (${seasons.length})</button>
    </div>
  `;

  let primaryStatsHtml = '';
  if (statsMode === '2026') {
    const snapBannerHtml = `
      <div class="subcard-panel" style="font-size:12px;color:var(--text-secondary)">
        <strong style="color:var(--text-primary)">2026 Snaps Logged:</strong>
        Offense <span class="mono">${p.snapSummary?.offenseSnaps || 0} (${p.snapSummary?.offenseSnapPct || 0}%)</span> •
        Defense <span class="mono">${p.snapSummary?.defenseSnaps || 0} (${p.snapSummary?.defenseSnapPct || 0}%)</span> •
        Special Teams <span class="mono">${p.snapSummary?.stSnaps || 0} (${p.snapSummary?.stSnapPct || 0}%)</span>
      </div>
    `;

    if (!s26) {
      primaryStatsHtml = `${snapBannerHtml}<div style="font-size:12px;color:var(--text-muted)">
        (Offensive linemen &amp; reserve players do not accrue box-score ball-handling stats unless recording a tackle or fumble recovery.)
      </div>`;
    } else {
      const blocks = [snapBannerHtml];
      if (s26.passing.attempts > 0) {
        blocks.push(`
          <div class="sub-label">2026 Passing &amp; EPA (${s26.games} GP)</div>
          <div class="kpi-grid">
            <div class="kpi-box"><div class="kpi-label">Comp / Att</div><div class="kpi-val mono">${s26.passing.completions}/${s26.passing.attempts}</div></div>
            <div class="kpi-box"><div class="kpi-label">Pass Yds / TD / INT</div><div class="kpi-val mono">${s26.passing.yards} / ${s26.passing.tds} / ${s26.passing.ints}</div></div>
            <div class="kpi-box"><div class="kpi-label">Passing EPA</div><div class="kpi-val mono" style="color:var(--emerald)">${s26.passing.epa >= 0 ? '+' : ''}${s26.passing.epa}</div></div>
            <div class="kpi-box"><div class="kpi-label">CPOE</div><div class="kpi-val mono">${s26.passing.cpoe >= 0 ? '+' : ''}${s26.passing.cpoe}%</div></div>
            <div class="kpi-box"><div class="kpi-label">Air Yards</div><div class="kpi-val mono">${s26.passing.airYards}</div></div>
            <div class="kpi-box"><div class="kpi-label">Sacks Taken</div><div class="kpi-val mono">${s26.passing.sacks}</div></div>
          </div>
        `);
      }
      if (s26.rushing.carries > 0) {
        blocks.push(`
          <div class="sub-label">2026 Rushing &amp; EPA</div>
          <div class="kpi-grid">
            <div class="kpi-box"><div class="kpi-label">Carries / Yds</div><div class="kpi-val mono">${s26.rushing.carries} / ${s26.rushing.yards}</div></div>
            <div class="kpi-box"><div class="kpi-label">Rush TD / 10+ Yd</div><div class="kpi-val mono">${s26.rushing.tds} / ${s26.rushing.explosive10Plus}</div></div>
            <div class="kpi-box"><div class="kpi-label">Rushing EPA</div><div class="kpi-val mono">${s26.rushing.epa >= 0 ? '+' : ''}${s26.rushing.epa}</div></div>
          </div>
        `);
      }
      if (s26.receiving.targets > 0) {
        blocks.push(`
          <div class="sub-label">2026 Receiving &amp; Opportunity Share</div>
          <div class="kpi-grid">
            <div class="kpi-box"><div class="kpi-label">Rec / Tgt / Yds</div><div class="kpi-val mono">${s26.receiving.receptions}/${s26.receiving.targets} • ${s26.receiving.yards}</div></div>
            <div class="kpi-box"><div class="kpi-label">Rec TD / EPA</div><div class="kpi-val mono">${s26.receiving.tds} TD (${s26.receiving.epa >= 0 ? '+' : ''}${s26.receiving.epa})</div></div>
            <div class="kpi-box"><div class="kpi-label">Target Share / WOPR</div><div class="kpi-val mono">${s26.receiving.targetSharePct}% / ${s26.receiving.wopr}</div></div>
          </div>
        `);
      }
      if (s26.defense.totalTackles > 0 || s26.defense.sacks > 0 || s26.defense.ints > 0) {
        blocks.push(`
          <div class="sub-label">2026 Defensive Production (${s26.games} GP)</div>
          <div class="kpi-grid">
            <div class="kpi-box"><div class="kpi-label">Tackles (Solo)</div><div class="kpi-val mono">${s26.defense.totalTackles} (${s26.defense.soloTackles})</div></div>
            <div class="kpi-box"><div class="kpi-label">Sacks / QB Hits</div><div class="kpi-val mono">${s26.defense.sacks} / ${s26.defense.qbHits}</div></div>
            <div class="kpi-box"><div class="kpi-label">TFL / INT / PD</div><div class="kpi-val mono">${s26.defense.tfl} / ${s26.defense.ints} / ${s26.defense.passDefended}</div></div>
          </div>
        `);
      }
      if (s26.kicking.fgAtt > 0 || s26.kicking.punts > 0) {
        blocks.push(`
          <div class="sub-label">2026 Special Teams</div>
          <div class="kpi-grid">
            <div class="kpi-box"><div class="kpi-label">FG Made/Att</div><div class="kpi-val mono">${s26.kicking.fgMade}/${s26.kicking.fgAtt} (${s26.kicking.fgPct}%)</div></div>
            <div class="kpi-box"><div class="kpi-label">FG Long / PAT</div><div class="kpi-val mono">${s26.kicking.fgLong} yd • ${s26.kicking.patMade}/${s26.kicking.patAtt}</div></div>
            <div class="kpi-box"><div class="kpi-label">Punts (In 20)</div><div class="kpi-val mono">${s26.kicking.punts} (${s26.kicking.puntInside20})</div></div>
          </div>
        `);
      }
      primaryStatsHtml = blocks.join('') || `<div style="font-size:12.5px">Active in ${s26.games} games (${p.primarySnapPct}% snaps).</div>`;
    }
  } else {
    // Year-by-year table (2023-2026)
    if (seasons.length === 0) {
      primaryStatsHtml = `<div style="font-size:12.5px;color:var(--text-muted)">No multi-year box-score rows in nflverse (OL / Rookie / PS).</div>`;
    } else {
      primaryStatsHtml = `
        <div class="table-scroll">
          <table class="data-table mono">
            <thead>
              <tr>
                <th>Year</th><th>Tm</th><th>GP</th><th>Pass Yds/TD</th><th>Rush Yds/TD</th><th>Rec/Yds/TD</th><th>Tkl / Sk / INT</th><th>Tot EPA</th>
              </tr>
            </thead>
            <tbody>
              ${seasons
                .map(s => {
                  const totEpa = (s.passing.epa + s.rushing.epa + s.receiving.epa).toFixed(1);
                  return `
                    <tr>
                      <td><strong>${s.season}</strong></td>
                      <td>${esc(s.team)}</td>
                      <td>${s.games}</td>
                      <td>${s.passing.attempts ? `${s.passing.yards}/${s.passing.tds}` : '—'}</td>
                      <td>${s.rushing.carries ? `${s.rushing.yards}/${s.rushing.tds}` : '—'}</td>
                      <td>${s.receiving.targets ? `${s.receiving.receptions}/${s.receiving.yards}/${s.receiving.tds}` : '—'}</td>
                      <td>${s.defense.totalTackles || s.defense.sacks ? `${s.defense.totalTackles} / ${s.defense.sacks} / ${s.defense.ints}` : '—'}</td>
                      <td>${Number(totEpa) !== 0 ? (Number(totEpa) > 0 ? `+${totEpa}` : totEpa) : '—'}</td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  }

  // NextGen Stats & PFR Advanced Stats cards
  let ngsHtml = '';
  if (p.nextGenStats) {
    const ngs = p.nextGenStats;
    const entries = Object.entries(ngs).filter(([k]) => k !== 'type' && k !== 'season');
    ngsHtml = `
      <div>
        <div class="sub-label">${esc(ngs.type)} (${ngs.season} NFL NextGen Stats)</div>
        <div class="kpi-grid">
          ${entries
            .map(
              ([k, v]) => `
            <div class="kpi-box">
              <div class="kpi-label">${esc(k.replace(/([A-Z])/g, ' $1'))}</div>
              <div class="kpi-val mono" style="font-size:13px">${esc(v)}</div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  let pfrHtml = '';
  if (p.pfrAdvStats) {
    const adv = p.pfrAdvStats;
    const entries = Object.entries(adv).filter(([k]) => k !== 'type' && k !== 'season');
    pfrHtml = `
      <div>
        <div class="sub-label">Pro-Football-Reference Advanced (${adv.season} ${esc(adv.type)})</div>
        <div class="kpi-grid">
          ${entries
            .slice(0, 6)
            .map(
              ([k, v]) => `
            <div class="kpi-box">
              <div class="kpi-label">${esc(k.replace(/([A-Z])/g, ' $1'))}</div>
              <div class="kpi-val mono" style="font-size:13px">${esc(v)}</div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  return `${modeToggle}${primaryStatsHtml}${ngsHtml}${pfrHtml}`;
}

function renderContractTab(p, txScenario) {
  const yrs = Object.values(p.contractsByYear || {}).sort((a, b) => a.year - b.year);
  if (yrs.length === 0) {
    return `<div class="subcard-panel" style="font-size:12.5px">
      Practice Squad / Non-Top-51 standard weekly agreement (no multi-year guaranteed dead-money exposure).
    </div>`;
  }

  const yr2026 = p.contractsByYear['2026'] || yrs[0];
  const tx = yr2026.transactions?.[txScenario] || { deadMoney: 0, capSavings: 0 };

  const txButtons = [
    ['cut', 'Pre-6/1 Cut'],
    ['june_1_cut', 'Post-6/1 Cut'],
    ['trade', 'Pre-6/1 Trade'],
    ['june_1_trade', 'Post-6/1 Trade'],
    ['restructure', 'Max Restructure'],
    ['extension', 'Extension']
  ]
    .map(
      ([key, label]) => `
      <button type="button" class="pill-btn ${txScenario === key ? 'active' : ''}"
              data-action="set-player-tx-scenario" data-tx="${key}">${esc(label)}</button>
    `
    )
    .join('');

  return `
    <div>
      <div class="sub-label" style="margin-bottom:6px">Multi-Year OverTheCap Ledger (${yrs[0].year}–${yrs[yrs.length - 1].year})</div>
      <div class="table-scroll">
        <table class="data-table mono">
          <thead>
            <tr>
              <th>Year</th><th>Base Salary</th><th>Signing Pror.</th><th>Option Pror.</th><th>Bonuses</th><th>Guaranteed</th><th>Cap Hit</th>
            </tr>
          </thead>
          <tbody>
            ${yrs
              .map(
                y => `
              <tr>
                <td><strong>${y.year}</strong></td>
                <td>${formatCompactDollars(y.baseSalary)}</td>
                <td>${formatCompactDollars(y.proratedSigning)}</td>
                <td>${formatCompactDollars(y.proratedOption)}</td>
                <td>${formatCompactDollars((y.rosterBonusRegular || 0) + (y.rosterBonusPerGame || 0) + (y.workoutBonus || 0))}</td>
                <td>${formatCompactDollars(y.guaranteedSalary)}</td>
                <td><strong>${formatCompactDollars(y.capNumber)}</strong></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <div class="sub-label" style="margin-bottom:6px">2026 Dead Money &amp; Cap Savings Scenario Explorer</div>
      <div class="pill-bar" style="margin-bottom:8px">${txButtons}</div>
      <div class="kpi-grid kpi-grid-2">
        <div class="kpi-box">
          <div class="kpi-label">${esc(formatCapActionLabel(txScenario))} — Dead Cap</div>
          <div class="kpi-val mono" style="color:var(--crimson)">${formatDollars(tx.deadMoney)}</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">2026 Net Cap Savings</div>
          <div class="kpi-val mono" style="color:${tx.capSavings >= 0 ? 'var(--emerald)' : 'var(--crimson)'}">
            ${formatDollars(tx.capSavings, true)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderHealthTab(p) {
  const h = p.health || {};
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div>
        <div class="sub-label">Projected Week 9 Play Likelihood</div>
        <div style="font-size:13px;color:var(--text-secondary)">Status: <strong>${esc(h.status)}</strong> ${h.injuryType ? `(${esc(h.injuryType)})` : ''}</div>
      </div>
      <span class="badge ${playProbBadgeClass(h.playProbabilityPct)} mono" style="font-size:13px;padding:4px 10px">${esc(h.playBadgeLabel)}</span>
    </div>

    <div class="kpi-grid">
      <div class="kpi-box"><div class="kpi-label">Wednesday</div><div class="kpi-val mono">${esc(h.wed || '-')}</div></div>
      <div class="kpi-box"><div class="kpi-label">Thursday</div><div class="kpi-val mono">${esc(h.thu || '-')}</div></div>
      <div class="kpi-box"><div class="kpi-label">Friday</div><div class="kpi-val mono">${esc(h.fri || '-')}</div></div>
    </div>

    <div class="subcard-panel" style="border-color:var(--gold-border);font-size:12.5px">
      <strong style="color:var(--gold-bright)">Player Availability Prior:</strong> ${esc(h.archetypeNote || 'Standard positional prior.')}
    </div>

    <div>
      <div class="sub-label" style="margin-bottom:4px">Model Factors</div>
      <ul class="brief-bullets">
        ${(h.factors || []).map(f => `<li>${esc(f)}</li>`).join('')}
      </ul>
    </div>

    ${
      h.longComment
        ? `<div class="subcard-panel" style="font-size:12.5px">
            <strong>Beat &amp; Medical Note:</strong> ${esc(h.longComment)}
           </div>`
        : ''
    }
  `;
}
