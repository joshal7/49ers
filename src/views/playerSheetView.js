/**
 * 5-Tab Player Dossier Slide-Up Bottom Sheet Renderer
 * Tabs:
 * 1. overview  — Bio, Draft Info, Snap %, Efficiency Callout & Player News
 * 2. stats     — 2026 Season vs Career Year-by-Year Standard + EPA + NextGen Stats + PFR Adv
 * 3. spider    — MockDraftable 0–100th Positional Percentile SVG Radar Chart + Comps
 * 4. contract  — Multi-Year OverTheCap Breakdown + Pre/Post-June 1 Cut/Trade/Restructure Calculator
 * 5. health    — Week 9 Practice Progression, Player Toughness/Vet-Rest Priors & 2026 Injury Log
 */

import { esc, escJargon, jargonTerm, formatRelativeAge, playProbBadgeClass, rankBadgeClass, renderPlayerAvatarHtml, renderMiniMeterHtml } from './uiHelpers.js';
import { iconSvg } from './icons.js';
import { renderSpiderChartHtml } from '../components/spiderChart.js';
import { formatDollars, formatOtcDollars, formatCompactDollars, formatCapActionLabel } from '../engine/capSimulator.js';
import { resolveCareerTableSchema } from '../engine/statsLeaderboardEngine.js';
import {
  SHORT_TWEET_FULL_TEXT_LIMIT,
  sortNewsWithBreakingPriority,
  deduplicateAndGroupWireItems,
  stripRedundantAuthorBoilerplate,
  isRedundantProfileSelfLink,
  formatTweetBodyForDisplay,
  filterOutCompletedGameAvailabilityItems
} from '../engine/breakingClassifier.js';
import {
  isIndividualOtcPlayerUrl,
  isPaywalledPublisher,
  sanitizeExternalUrl
} from '../engine/linkIntegrity.js';
import {
  buildXPlayerScoopSearchUrl,
  resolveItemAuthorProfileUrl,
  resolveOriginalTweetUrl
} from '../engine/beatAttributionEngine.js';

export function renderPlayerDossierSheetHtml({
  player,
  activeTab = 'overview',
  statsMode = '2026', // '2026' | 'career'
  txScenario = 'cut',
  rawStream = [],
  appData = null
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
    contentHtml = renderOverviewTab(player, rawStream, appData);
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

function renderOverviewTab(p, rawStream = [], appData = null) {
  const sortedMentions = Array.isArray(p.recentNews)
    ? deduplicateAndGroupWireItems(
        sortNewsWithBreakingPriority(
          filterOutCompletedGameAvailabilityItems(
            p.recentNews.filter(
              n => sanitizeExternalUrl(n?.url, null) && !isPaywalledPublisher(n?.outletName, n?.url)
            ),
            appData
          ),
          Date.now(),
          { appData }
        )
      )
    : [];
  const combinedDirectPosts = Array.isArray(rawStream) && rawStream.length > 0
    ? [...rawStream, ...sortedMentions]
    : sortedMentions;

  const newsHtml =
    sortedMentions.length > 0
      ? `
        <div class="player-mentions-section">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:7px">
            <div class="sub-label" style="margin:0">Recent Mentions (7d)</div>
            <span class="mono" style="font-size:11px;color:var(--text-muted)">${sortedMentions.length} updates</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:7px">
            ${sortedMentions
              .map(n => {
                const isTweet = n.type === 'tweet' || n.type === 'social';
                const hasImg = n.imageUrl && /^https:\/\//i.test(n.imageUrl);
                const authorName = n.author || n.reporterName || n.outletName || '49ers Beat';
                const resolvedMentionUrl = isTweet
                  ? sanitizeExternalUrl(
                      resolveOriginalTweetUrl(
                        { ...n, primaryPlayer: { name: p.name } },
                        combinedDirectPosts
                      ),
                      '#'
                    )
                  : sanitizeExternalUrl(n.url, '#');
                const authorHref = sanitizeExternalUrl(
                  resolveItemAuthorProfileUrl(n, resolvedMentionUrl),
                  resolvedMentionUrl
                );
                const ageStr = n.publishedAt ? formatRelativeAge(n.publishedAt) : '';

                const tweetFormatted = isTweet
                  ? formatTweetBodyForDisplay(
                      stripRedundantAuthorBoilerplate(n.fullText || n.headline || '', authorName),
                      SHORT_TWEET_FULL_TEXT_LIMIT
                    )
                  : null;

                const cleanSummary =
                  !isTweet &&
                  n.summary &&
                  !n.summary.startsWith('Published via ') &&
                  n.summary.toLowerCase() !== `${authorName} • ${n.outletName || ''}`.toLowerCase()
                    ? stripRedundantAuthorBoilerplate(n.summary, authorName)
                    : '';

                const breakingPill = n.breakingBadge
                  ? `<span class="badge ${n.isInGameInjury ? 'badge-danger live-breaking-pill' : 'badge-scarlet live-breaking-pill'}">${iconSvg('bolt', 11)}<span>${esc(n.breakingBadge)}</span></span>`
                  : '';

                const safeMentionExt = sanitizeExternalUrl(n.externalUrl, null);
                const showMentionExt =
                  Boolean(safeMentionExt) &&
                  !isRedundantProfileSelfLink(safeMentionExt, resolvedMentionUrl) &&
                  !isRedundantProfileSelfLink(safeMentionExt, n.url) &&
                  !/\bon X$/i.test(String(n.externalTitle || ''));

                return `
              <div class="subcard-panel player-mention-card ${n.breakingPriority > 0 ? 'breaking-elevated' : ''}" data-mention-type="${isTweet ? 'tweet' : 'article'}" style="font-size:12.5px">
                <div class="player-mention-meta">
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0">
                    ${breakingPill}
                    ${!isTweet ? `<span class="badge badge-neutral">${iconSvg('news', 11)}<span>Article</span></span>` : ''}
                    <span class="player-mention-author">
                      ${
                        authorHref
                          ? `<a href="${esc(authorHref)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(authorName)}</strong></a>`
                          : `<strong>${esc(authorName)}</strong>`
                      }
                    </span>
                  </div>
                  ${ageStr ? `<span class="mono" style="font-size:11px;color:var(--text-muted);flex-shrink:0">${esc(ageStr)}</span>` : ''}
                </div>

                <div class="${hasImg ? 'media-split-row' : ''}" style="margin-top:5px">
                  <div style="min-width:0">
                    ${
                      isTweet
                        ? `<a href="${esc(resolvedMentionUrl)}" target="_blank" rel="noopener noreferrer" class="player-mention-tweet-body">${esc(tweetFormatted.text)} <span class="inline-ext-icon">${iconSvg('externalLink', 11)}</span></a>
                           ${
                             showMentionExt
                               ? `<div style="margin-top:5px">
                                    <a href="${esc(safeMentionExt)}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
                                      <span>Article: ${esc((n.externalTitle || n.headline || n.outletName || 'Read Story').slice(0, 56))}</span>
                                      ${iconSvg('externalLink', 10)}
                                    </a>
                                  </div>`
                               : ''
                           }`
                        : `<a href="${esc(resolvedMentionUrl)}" target="_blank" rel="noopener noreferrer" class="ext-link"><strong>${esc(n.headline)}</strong> ${iconSvg('externalLink', 12)}</a>
                           ${cleanSummary ? `<div style="color:var(--text-secondary);margin-top:3px">${escJargon(cleanSummary, { excludePlayerId: p.id })}</div>` : ''}`
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
  const safeXBeatUrl = sanitizeExternalUrl(buildXPlayerScoopSearchUrl(p.name), null);
  const profileLinks = [
    safeXBeatUrl ? { label: 'Live X Beat', url: safeXBeatUrl } : null,
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
            <strong style="color:var(--gold-bright)">Scouting Note:</strong> ${escJargon(p.publicEfficiencyNote, { excludePlayerId: p.id })}
           </div>`
        : ''
    }

    ${newsHtml}
  `;
}

function renderPlayerStatRankCellHtml(row, playerId) {
  const rank = Number(row.rank || 1);
  const total = Math.max(1, Number(row.totalPeers || 32));
  const scaledRank32 = Math.max(1, Math.min(32, Math.round((rank / total) * 32)));
  const pct = Math.max(6, Math.min(100, Math.round(((total - rank + 1) / total) * 100)));
  const meterColor = scaledRank32 <= 8 ? 'emerald' : scaledRank32 <= 18 ? 'gold' : 'scarlet';
  const scope = row.scope || 'player';

  if (!row.leaderboardKey) {
    return `<span class="badge ${rankBadgeClass(scaledRank32)} mono">#${rank}</span>`;
  }

  return `
    <button type="button" class="rank-badge-trigger"
            data-action="open-stat-rank-modal"
            data-rank-scope="${esc(scope)}"
            data-rank-key="${esc(row.leaderboardKey)}"
            data-player-id="${esc(playerId || '')}"
            aria-label="Rank #${rank} of ${total} — tap to view leaderboard">
      <span class="badge ${rankBadgeClass(scaledRank32)} mono">#${rank}${!row.qualified ? '*' : ''}</span>
      ${renderMiniMeterHtml(pct, meterColor)}
    </button>
  `;
}

function renderPlayerStatTableRowsHtml(rows = [], playerId = '') {
  return rows
    .map(
      r => `
      <tr>
        <td><strong>${escJargon(r.label)}</strong></td>
        <td class="mono num-col"><strong>${esc(r.displayValue)}</strong></td>
        <td class="rank-col">${renderPlayerStatRankCellHtml(r, playerId)}</td>
        <td class="mono num-col" style="color:var(--text-muted)">${esc(r.posAvgDisplay)}</td>
      </tr>
    `
    )
    .join('');
}

function renderStatsTab(p, statsMode) {
  const seasons = p.careerSeasons || [];
  const profile = p.statProfile2026 || null;

  const modeToggle = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <div class="segmented-control compact-seg" role="tablist" aria-label="Player Stat View Mode" style="flex:1 1 240px;margin:0">
        <button type="button" role="tab" aria-selected="${statsMode === '2026' ? 'true' : 'false'}" class="pill-btn seg-btn ${statsMode === '2026' ? 'active' : ''}" data-action="set-player-stats-mode" data-stats-mode="2026"><span>2026 Season</span></button>
        <button type="button" role="tab" aria-selected="${statsMode === 'career' ? 'true' : 'false'}" class="pill-btn seg-btn ${statsMode === 'career' ? 'active' : ''}" data-action="set-player-stats-mode" data-stats-mode="career"><span>Career Year-by-Year (${seasons.length})</span></button>
      </div>
      <div class="source-link-strip">
        ${p.pfrUrl ? `<a href="${esc(p.pfrUrl)}" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>PFR Stats</span>${iconSvg('externalLink', 10)}</a>` : ''}
        <a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>nflverse</span>${iconSvg('externalLink', 10)}</a>
        <a href="https://nextgenstats.nfl.com/" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>NextGen</span>${iconSvg('externalLink', 10)}</a>
      </div>
    </div>
  `;

  if (statsMode === 'career') {
    if (seasons.length === 0) {
      return `${modeToggle}<div class="subcard-panel" style="font-size:12.5px;color:var(--text-muted)">
        No multi-year NFL box-score seasons recorded yet (${esc(p.position)} • ${esc(p.draftInfo || 'Roster')}).
      </div>`;
    }
    const schema = resolveCareerTableSchema(p.position);
    return `
      ${modeToggle}
      <section class="card team-stats-card player-stat-section">
        <div class="card-header team-stats-header">
          <div class="card-header-left">
            <div class="card-icon-badge compact" aria-hidden="true">${iconSvg('calendar', 15)}</div>
            <div class="card-title-group">
              <h3 class="card-title">Career Stats (${seasons[seasons.length - 1].season}–${seasons[0].season})</h3>
            </div>
          </div>
        </div>
        <div class="table-scroll">
          <table class="data-table team-stats-table mono" data-career-pos-table="${esc(p.position)}">
            <thead>
              <tr>
                ${schema.headers.map((h, idx) => `<th class="${idx >= 2 ? 'num-col' : ''}">${esc(h)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${seasons
                .map(s => {
                  const cells = schema.cells(s);
                  return `
                    <tr>
                      ${cells
                        .map((cell, idx) =>
                          idx === 0
                            ? `<td>${cell}</td>`
                            : `<td class="${idx >= 2 ? 'num-col' : ''}">${esc(String(cell))}</td>`
                        )
                        .join('')}
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  // 2026 Season Mode — Position-Tailored Single-Stat Rows + Clickable #X Positional Leaderboards
  const snapBannerHtml = `
    <div class="subcard-panel player-snaps-banner" style="font-size:12px;color:var(--text-secondary)">
      <strong style="color:var(--text-primary)">2026 Snaps Logged:</strong>
      Offense <span class="mono">${p.snapSummary?.offenseSnaps || 0} (${p.snapSummary?.offenseSnapPct || 0}%)</span> •
      Defense <span class="mono">${p.snapSummary?.defenseSnaps || 0} (${p.snapSummary?.defenseSnapPct || 0}%)</span> •
      Special Teams <span class="mono">${p.snapSummary?.stSnaps || 0} (${p.snapSummary?.stSnapPct || 0}%)</span>
    </div>
  `;

  if (!profile?.hasActiveStats || !(profile.sections || []).length) {
    return `
      ${modeToggle}
      ${snapBannerHtml}
      <div class="subcard-panel" style="font-size:12.5px;color:var(--text-secondary)">
        No 2026 regular-season game snaps logged yet (${esc(p.health?.status || p.rosterBucket)}).${
          seasons.length > 0
            ? ` Switch to <strong>Career Year-by-Year (${seasons.length})</strong> above to inspect prior NFL seasons.`
            : ''
        }
      </div>
    `;
  }

  const hasAnyUnqualified = (profile.sections || []).some(sec =>
    [...(sec.coreRows || []), ...(sec.expandedRows || [])].some(r => !r.qualified)
  );

  const sectionsHtml = (profile.sections || [])
    .map(sec => {
      const expRows = sec.expandedRows || [];
      const expSubgroups = [];
      for (const r of expRows) {
        const gTitle = r.group || 'Advanced Efficiency, NextGen & Film Metrics';
        const lastGrp = expSubgroups[expSubgroups.length - 1];
        if (!lastGrp || lastGrp.groupTitle !== gTitle) {
          expSubgroups.push({ groupTitle: gTitle, rows: [r] });
        } else {
          lastGrp.rows.push(r);
        }
      }
      return `
        <section class="card team-stats-card player-stat-section" data-player-stat-section="${esc(sec.id)}">
          <div class="card-header team-stats-header">
            <div class="card-header-left">
              <div class="card-icon-badge compact" aria-hidden="true">${iconSvg('season', 15)}</div>
              <div class="card-title-group">
                <h3 class="card-title">${esc(sec.title)}</h3>
              </div>
            </div>
          </div>
          <div class="table-scroll">
            <table class="data-table team-stats-table player-stats-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th class="mono num-col">${esc(p.shortName || 'Player')}</th>
                  <th class="mono rank-col">Rank</th>
                  <th class="mono num-col">NFL Avg</th>
                </tr>
              </thead>
              <tbody>
                ${renderPlayerStatTableRowsHtml(sec.coreRows || [], p.id)}
              </tbody>
            </table>
          </div>
          ${
            expRows.length > 0
              ? `
            <details class="stats-expand-details" data-player-stats-expander="${esc(sec.id)}">
              <summary class="stats-expand-summary">
                <span>Detailed ${esc(p.position)} Metrics (${expRows.length})</span>
                <span class="mono stats-expand-hint">Expand</span>
              </summary>
              <div class="stats-expand-body">
                ${expSubgroups
                  .map(
                    grp => `
                  <div class="stats-subgroup-block">
                    <div class="sub-label stats-subgroup-title">${esc(grp.groupTitle)}</div>
                    <div class="table-scroll">
                      <table class="data-table team-stats-table player-stats-table">
                        <tbody>
                          ${renderPlayerStatTableRowsHtml(grp.rows, p.id)}
                        </tbody>
                      </table>
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>
            </details>
          `
              : ''
          }
        </section>
      `;
    })
    .join('');

  const footnoteHtml = hasAnyUnqualified
    ? `<div style="font-size:11px;color:var(--text-muted)">* Below full-starter per-game volume threshold; effective placement shown against qualified NFL ${esc(profile.peerGroupLabel || p.position)}.</div>`
    : '';

  return `${modeToggle}${snapBannerHtml}${sectionsHtml}${footnoteHtml}`;
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
        <div class="sub-label">Contract Breakdown (${yrs[0].year}–${yrs[yrs.length - 1].year})</div>
        <a href="${esc(p.otcUrl || 'https://overthecap.com/salary-cap/san-francisco-49ers')}" target="_blank" rel="noopener noreferrer" class="source-chip-link">
          <span>OverTheCap</span>${iconSvg('externalLink', 10)}
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
      <div class="sub-label" style="margin-bottom:6px">${activeYrLabel} ${jargonTerm('Dead Cap', 'dead_cap')} &amp; Cap Savings</div>
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
        <div class="sub-label">Availability</div>
        <div style="font-size:13px;color:var(--text-secondary)">Status: <strong>${esc(h.status || 'Active')}</strong> ${h.injuryType ? `(${esc(h.injuryType)})` : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <a href="https://www.49ers.com/team/injury-report/" target="_blank" rel="noopener noreferrer" class="source-chip-link"><span>49ers.com Report</span>${iconSvg('externalLink', 10)}</a>
        <span class="badge ${playProbBadgeClass(h.playProbabilityPct)} mono" style="font-size:13px;padding:4px 10px">${esc(h.playBadgeLabel)}</span>
      </div>
    </div>

    ${irDetailHtml}

    <div class="subcard-panel" style="border-color:var(--gold-border);font-size:12.5px">
      <strong style="color:var(--gold-bright)">Player Availability Prior:</strong> ${escJargon(h.archetypeNote || 'Standard positional prior.', { excludePlayerId: p.id })}
    </div>

    <div>
      <div class="sub-label" style="margin-bottom:4px">Model Factors</div>
      <ul class="brief-bullets">
        ${(h.factors || []).map(f => `<li>${escJargon(f, { excludePlayerId: p.id })}</li>`).join('')}
      </ul>
    </div>

    ${
      noteBody
        ? `<div class="subcard-panel" style="font-size:12.5px">
            <strong>Beat &amp; Medical Note:</strong> ${escJargon(noteBody, { excludePlayerId: p.id })}
           </div>`
        : ''
    }
  `;
}
