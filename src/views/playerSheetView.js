/**
 * 5-Tab Player Dossier Slide-Up Bottom Sheet Renderer
 * Tabs:
 * 1. overview  — Bio, Draft Info, Snap %, Efficiency Callout & Player News
 * 2. stats     — 2026 Season vs Career Year-by-Year Standard + EPA + NextGen Stats + PFR Adv
 * 3. spider    — MockDraftable 0–100th Positional Percentile SVG Radar Chart + Comps
 * 4. contract  — Multi-Year OverTheCap Breakdown + Pre/Post-June 1 Cut/Trade/Restructure Calculator
 * 5. health    — Week 9 Practice Progression, Player Toughness/Vet-Rest Priors & 2026 Injury Log
 */

import { esc, escJargon, jargonTerm, formatRelativeAge, playProbBadgeClass, renderPlayerAvatarHtml, renderMiniMeterHtml } from './uiHelpers.js';
import { iconSvg } from './icons.js';
import { renderSpiderChartHtml } from '../components/spiderChart.js';
import { formatDollars, formatOtcDollars, formatCompactDollars, formatCapActionLabel } from '../engine/capSimulator.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  sortNewsWithBreakingPriority,
  formatTweetBodyForDisplay
} from '../engine/breakingClassifier.js';
import {
  isIndividualOtcPlayerUrl,
  isPaywalledPublisher,
  sanitizeExternalUrl
} from '../engine/linkIntegrity.js';

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
  const sortedMentions = Array.isArray(p.recentNews)
    ? sortNewsWithBreakingPriority(
        p.recentNews.filter(
          n => sanitizeExternalUrl(n?.url, null) && !isPaywalledPublisher(n?.outletName, n?.url)
        )
      )
    : [];

  const newsHtml =
    sortedMentions.length > 0
      ? `
        <div class="player-mentions-section">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:7px">
            <div class="sub-label" style="margin:0">Recent Beat &amp; Roster Mentions (7d)</div>
            <span class="mono" style="font-size:11px;color:var(--text-muted)">${sortedMentions.length} tweets &amp; articles</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:7px">
            ${sortedMentions
              .map(n => {
                const isTweet = n.type === 'tweet' || n.type === 'social';
                const hasImg = n.imageUrl && /^https:\/\//i.test(n.imageUrl);
                const authorName = n.author || n.reporterName || n.outletName || '49ers Beat';
                const outletLabel =
                  n.outletName && n.outletName.toLowerCase() !== authorName.toLowerCase()
                    ? n.outletName
                    : '';
                const ageStr = n.publishedAt ? formatRelativeAge(n.publishedAt) : '';

                const tweetFormatted = isTweet
                  ? formatTweetBodyForDisplay(n.fullText || n.headline || '', SHORT_TWEET_FULL_TEXT_LIMIT)
                  : null;

                const cleanSummary =
                  !isTweet &&
                  n.summary &&
                  !n.summary.startsWith('Published via ') &&
                  n.summary.toLowerCase() !== `${authorName} • ${n.outletName || ''}`.toLowerCase()
                    ? n.summary
                    : '';

                const breakingPill = n.breakingBadge
                  ? `<span class="badge ${n.isInGameInjury ? 'badge-danger live-breaking-pill' : 'badge-scarlet live-breaking-pill'}">${iconSvg('bolt', 11)}<span>${esc(n.breakingBadge)}</span></span>`
                  : '';

                const typePill = isTweet
                  ? `<span class="badge badge-gold">${iconSvg('tweet', 11)}<span>Tweet</span></span>`
                  : `<span class="badge badge-neutral">${iconSvg('news', 11)}<span>Article</span></span>`;

                return `
              <div class="subcard-panel player-mention-card ${n.breakingPriority > 0 ? 'breaking-elevated' : ''}" data-mention-type="${isTweet ? 'tweet' : 'article'}" style="font-size:12.5px">
                <div class="player-mention-meta">
                  <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;min-width:0">
                    ${breakingPill}
                    ${typePill}
                    <span class="player-mention-author">
                      by ${
                        sanitizeExternalUrl(n.authorProfileUrl, null)
                          ? `<a href="${esc(sanitizeExternalUrl(n.authorProfileUrl))}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(authorName)}</strong></a>`
                          : `<strong>${esc(authorName)}</strong>`
                      }${isTweet && n.authorHandle ? ` <span class="mono" style="font-size:11px;color:var(--text-muted)">${esc(n.authorHandle)}</span>` : ''}${outletLabel ? ` <span style="color:var(--text-muted)">• ${esc(outletLabel)}</span>` : ''}
                    </span>
                  </div>
                  ${ageStr ? `<span class="mono" style="font-size:11px;color:var(--text-muted);flex-shrink:0">${esc(ageStr)}</span>` : ''}
                </div>

                <div class="${hasImg ? 'media-split-row' : ''}" style="margin-top:5px">
                  <div style="min-width:0">
                    ${
                      isTweet
                        ? `<a href="${esc(sanitizeExternalUrl(n.url, '#'))}" target="_blank" rel="noopener noreferrer" class="player-mention-tweet-body">${esc(tweetFormatted.text)} <span class="inline-ext-icon">${iconSvg('externalLink', 11)}</span></a>
                           ${
                             sanitizeExternalUrl(n.externalUrl, null)
                               ? `<div style="margin-top:5px">
                                    <a href="${esc(sanitizeExternalUrl(n.externalUrl))}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
                                      <span>Linked: ${esc((n.summary || n.outletName || 'Read Story').slice(0, 56))}</span>
                                      ${iconSvg('externalLink', 10)}
                                    </a>
                                  </div>`
                               : ''
                           }`
                        : `<a href="${esc(sanitizeExternalUrl(n.url, '#'))}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(n.headline)}</strong> ${iconSvg('externalLink', 12)}</a>
                           ${cleanSummary ? `<div style="color:var(--text-secondary);margin-top:3px">${esc(cleanSummary)}</div>` : ''}`
                    }
                  </div>
                  ${
                    hasImg
                      ? `<div class="raw-item-thumb compact" style="width:54px;height:54px">
                          <img src="${esc(n.imageUrl)}" alt="${esc(n.headline)}" width="54" height="54" loading="lazy" decoding="async" />
                        </div>`
                      : ''
                  }
                </div>
              </div>
            `;
              })
              .join('')}
          </div>
        </div>
      `
      : `<div style="font-size:12px;color:var(--text-muted)">No beat tweets or articles specific to ${esc(p.name)} in the past 7 days.</div>`;

  const safeEspnUrl = sanitizeExternalUrl(p.espnUrl, null);
  const safeOtcUrl = sanitizeExternalUrl(p.otcUrl, null);
  const safePfrUrl = sanitizeExternalUrl(p.pfrUrl, null);
  const profileLinks = [
    safeEspnUrl ? { label: 'ESPN Profile', url: safeEspnUrl } : null,
    safeOtcUrl
      ? {
          label: isIndividualOtcPlayerUrl(safeOtcUrl) ? 'OverTheCap Contract' : 'OverTheCap 49ers Cap',
          url: safeOtcUrl
        }
      : null,
    safePfrUrl ? { label: 'Pro-Football-Ref', url: safePfrUrl } : null
  ].filter(Boolean);

  return `
    <div class="dossier-hero-banner">
      <div style="display:flex;align-items:center;gap:12px;min-width:0">
        ${renderPlayerAvatarHtml(p, 68, { showJerseyBadge: true, hero: true })}
        <div style="min-width:0">
          <div style="font-weight:800;font-size:15px">${esc(p.position)} • ${esc(p.unit)} (${esc(p.rosterBucket.replace('_', ' ').toUpperCase())})</div>
          <div style="font-size:12px;color:var(--text-secondary)">${esc(p.displayHeight)} • ${esc(p.displayWeight)} • Age ${p.age ?? '—'} • ${esc(p.college)}</div>
        </div>
      </div>
      <span class="badge ${playProbBadgeClass(p.health?.playProbabilityPct)} mono">${esc(p.health?.playBadgeLabel)}</span>
    </div>

    ${
      profileLinks.length
        ? `<div class="source-link-strip">
            ${profileLinks
              .map(
                pl => `<a href="${esc(pl.url)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>${esc(pl.label)}</span>${iconSvg('externalLink', 11)}</a>`
              )
              .join('')}
          </div>`
        : ''
    }

    <div class="kpi-grid">
      <div class="kpi-box">
        <div class="kpi-label">Draft Pedigree</div>
        <div class="kpi-val" style="font-size:12px">${esc(p.draftInfo)}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">2026 Snap Share</div>
        <div class="kpi-val mono">${p.primarySnapPct}%</div>
        ${renderMiniMeterHtml(p.primarySnapPct, 'gold')}
      </div>
      <div class="kpi-box">
        <div class="kpi-label">2026 Cap Hit</div>
        <div class="kpi-val mono">${p.capHit2026 ? formatCompactDollars(p.capHit2026) : 'PS/Min'}</div>
      </div>
    </div>

    ${
      p.publicEfficiencyNote
        ? `<div style="padding:9px 11px;border-radius:9px;background:var(--gold-soft);border:1px solid var(--gold-border);font-size:12.5px">
            <strong style="color:var(--gold-bright)">Beat &amp; Film Efficiency Callout:</strong> ${escJargon(p.publicEfficiencyNote)}
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
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div style="display:flex;gap:6px">
        <button type="button" class="pill-btn ${statsMode === '2026' ? 'active' : ''}" data-action="set-player-stats-mode" data-stats-mode="2026">2026 Season</button>
        <button type="button" class="pill-btn ${statsMode === 'career' ? 'active' : ''}" data-action="set-player-stats-mode" data-stats-mode="career">Career Year-by-Year (${seasons.length})</button>
      </div>
      <div class="source-link-strip">
        ${p.pfrUrl ? `<a href="${esc(p.pfrUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>PFR Stats</span>${iconSvg('externalLink', 10)}</a>` : ''}
        <a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>nflverse</span>${iconSvg('externalLink', 10)}</a>
        <a href="https://nextgenstats.nfl.com/" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>NextGen</span>${iconSvg('externalLink', 10)}</a>
      </div>
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
          <div class="sub-label">2026 Passing &amp; ${jargonTerm('EPA', 'epa')} (${s26.games} GP)</div>
          <div class="kpi-grid">
            <div class="kpi-box"><div class="kpi-label">Comp / Att</div><div class="kpi-val mono">${s26.passing.completions}/${s26.passing.attempts}</div></div>
            <div class="kpi-box"><div class="kpi-label">Pass Yds / TD / INT</div><div class="kpi-val mono">${s26.passing.yards} / ${s26.passing.tds} / ${s26.passing.ints}</div></div>
            <div class="kpi-box"><div class="kpi-label">Passing ${jargonTerm('EPA', 'epa')}</div><div class="kpi-val mono" style="color:var(--emerald)">${s26.passing.epa >= 0 ? '+' : ''}${s26.passing.epa}</div></div>
            <div class="kpi-box"><div class="kpi-label">${jargonTerm('CPOE', 'cpoe')}</div><div class="kpi-val mono">${s26.passing.cpoe >= 0 ? '+' : ''}${s26.passing.cpoe}%</div></div>
            <div class="kpi-box"><div class="kpi-label">Air Yards</div><div class="kpi-val mono">${s26.passing.airYards}</div></div>
            <div class="kpi-box"><div class="kpi-label">Sacks Taken</div><div class="kpi-val mono">${s26.passing.sacks}</div></div>
          </div>
        `);
      }
      if (s26.rushing.carries > 0) {
        blocks.push(`
          <div class="sub-label">2026 Rushing &amp; ${jargonTerm('EPA', 'epa')}</div>
          <div class="kpi-grid">
            <div class="kpi-box"><div class="kpi-label">Carries / Yds</div><div class="kpi-val mono">${s26.rushing.carries} / ${s26.rushing.yards}</div></div>
            <div class="kpi-box"><div class="kpi-label">Rush TD / 10+ Yd</div><div class="kpi-val mono">${s26.rushing.tds} / ${s26.rushing.explosive10Plus}</div></div>
            <div class="kpi-box"><div class="kpi-label">Rushing ${jargonTerm('EPA', 'epa')}</div><div class="kpi-val mono">${s26.rushing.epa >= 0 ? '+' : ''}${s26.rushing.epa}</div></div>
          </div>
        `);
      }
      if (s26.receiving.targets > 0) {
        blocks.push(`
          <div class="sub-label">2026 Receiving &amp; Opportunity Share</div>
          <div class="kpi-grid">
            <div class="kpi-box"><div class="kpi-label">Rec / Tgt / Yds</div><div class="kpi-val mono">${s26.receiving.receptions}/${s26.receiving.targets} • ${s26.receiving.yards}</div></div>
            <div class="kpi-box"><div class="kpi-label">Rec TD / ${jargonTerm('EPA', 'epa')}</div><div class="kpi-val mono">${s26.receiving.tds} TD (${s26.receiving.epa >= 0 ? '+' : ''}${s26.receiving.epa})</div></div>
            <div class="kpi-box"><div class="kpi-label">Target Share / ${jargonTerm('WOPR', 'wopr')}</div><div class="kpi-val mono">${s26.receiving.targetSharePct}% / ${s26.receiving.wopr}</div></div>
          </div>
        `);
      }
      if (s26.defense.totalTackles > 0 || s26.defense.sacks > 0 || s26.defense.ints > 0) {
        blocks.push(`
          <div class="sub-label">2026 Defensive Production (${s26.games} GP)</div>
          <div class="kpi-grid">
            <div class="kpi-box"><div class="kpi-label">Tackles (Solo)</div><div class="kpi-val mono">${s26.defense.totalTackles} (${s26.defense.soloTackles})</div></div>
            <div class="kpi-box"><div class="kpi-label">Sacks / QB Hits</div><div class="kpi-val mono">${s26.defense.sacks} / ${s26.defense.qbHits}</div></div>
            <div class="kpi-box"><div class="kpi-label">${jargonTerm('TFL', 'tfl')} / INT / PD</div><div class="kpi-val mono">${s26.defense.tfl} / ${s26.defense.ints} / ${s26.defense.passDefended}</div></div>
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

  const activeContractYr = p.contractsByYear['2026'] || yrs[0];
  const activeYrLabel = activeContractYr?.year || 2026;
  const tx = activeContractYr.transactions?.[txScenario] || { deadMoney: 0, capSavings: 0 };

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
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <div class="sub-label">Multi-Year OverTheCap Ledger (${yrs[0].year}–${yrs[yrs.length - 1].year})</div>
        <a href="${esc(p.otcUrl || 'https://overthecap.com/salary-cap/san-francisco-49ers')}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
          <span>View Contract on OverTheCap</span>${iconSvg('externalLink', 10)}
        </a>
      </div>
      <div class="table-scroll">
        <table class="data-table mono">
          <thead>
            <tr>
              <th>Year</th><th>Base Salary</th><th>${jargonTerm('Prorated Bonuses', 'prorated_bonus')}</th><th>Current Yr Bonuses</th><th>${jargonTerm('Guaranteed', 'guaranteed_salary')}</th><th>Cap Hit</th>
            </tr>
          </thead>
          <tbody>
            ${yrs
              .map(
                y => `
              <tr>
                <td><strong>${y.year}</strong></td>
                <td>${y.isVoidYear ? `<span class="badge badge-neutral">${jargonTerm('Void', 'void_years')}</span>` : formatOtcDollars(y.baseSalary)}</td>
                <td>${formatOtcDollars((y.proratedSigning || 0) + (y.proratedOption || 0))}</td>
                <td>${formatOtcDollars((y.rosterBonusRegular || 0) + (y.rosterBonusPerGame || 0) + (y.workoutBonus || 0) + (y.otherBonus || 0))}</td>
                <td>${formatOtcDollars(y.guaranteedSalary)}</td>
                <td><strong>${formatOtcDollars(y.capNumber)}</strong></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <div class="sub-label" style="margin-bottom:6px">${activeYrLabel} ${jargonTerm('Dead Cap', 'dead_cap')} &amp; Cap Savings Scenario Explorer</div>
      <div class="pill-bar" style="margin-bottom:8px">${txButtons}</div>
      <div class="kpi-grid kpi-grid-2">
        <div class="kpi-box">
          <div class="kpi-label">${esc(formatCapActionLabel(txScenario))} — Dead Cap</div>
          <div class="kpi-val mono" style="color:var(--crimson)">${formatDollars(tx.deadMoney)}</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">${activeYrLabel} Net Cap Savings</div>
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
  const isIrOrReserve = p.rosterBucket === 'ir' || p.rosterBucket === 'suspended';
  const irDetailHtml = isIrOrReserve
    ? `
    <div class="kpi-grid">
      <div class="kpi-box">
        <div class="kpi-label">Reserve List</div>
        <div class="kpi-val" style="font-size:12.5px">${esc(h.status || 'Injured Reserve')}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Earliest Eligible</div>
        <div class="kpi-val mono">${h.isSeasonEnding ? 'Ineligible' : h.earliestEligibleWeek ? `Week ${h.earliestEligibleWeek}` : '—'}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-label">Return Window</div>
        <div class="kpi-val mono" style="font-size:12px;color:${h.isSeasonEnding ? 'var(--crimson)' : 'var(--gold-bright)'}">
          ${esc(h.isSeasonEnding ? 'Out for Season' : h.projectedReturnWeek || 'TBD')}
        </div>
      </div>
    </div>
    `
    : `
    <div class="kpi-grid">
      <div class="kpi-box"><div class="kpi-label">Wednesday</div><div class="kpi-val mono">${esc(h.wed || '-')}</div></div>
      <div class="kpi-box"><div class="kpi-label">Thursday</div><div class="kpi-val mono">${esc(h.thu || '-')}</div></div>
      <div class="kpi-box"><div class="kpi-label">Friday</div><div class="kpi-val mono">${esc(h.fri || '-')}</div></div>
    </div>
    `;

  const noteBody = h.irBeatNote || h.longComment || h.shortComment || '';

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div>
        <div class="sub-label">Next-Game Play Likelihood</div>
        <div style="font-size:13px;color:var(--text-secondary)">Status: <strong>${esc(h.status || 'Active')}</strong> ${h.injuryType ? `(${esc(h.injuryType)})` : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <a href="https://www.49ers.com/team/injury-report/" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>49ers.com Report</span>${iconSvg('externalLink', 10)}</a>
        <span class="badge ${playProbBadgeClass(h.playProbabilityPct)} mono" style="font-size:13px;padding:4px 10px">${esc(h.playBadgeLabel)}</span>
      </div>
    </div>

    ${irDetailHtml}

    <div class="subcard-panel" style="border-color:var(--gold-border);font-size:12.5px">
      <strong style="color:var(--gold-bright)">Player Availability Prior:</strong> ${escJargon(h.archetypeNote || 'Standard positional prior.')}
    </div>

    <div>
      <div class="sub-label" style="margin-bottom:4px">Model Factors</div>
      <ul class="brief-bullets">
        ${(h.factors || []).map(f => `<li>${escJargon(f)}</li>`).join('')}
      </ul>
    </div>

    ${
      noteBody
        ? `<div class="subcard-panel" style="font-size:12.5px">
            <strong>Beat &amp; Medical Note:</strong> ${escJargon(noteBody)}
           </div>`
        : ''
    }
  `;
}
