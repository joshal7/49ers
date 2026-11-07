/**
 * In-Season & Temporal War Rooms View
 * Sub-modules:
 * - matchup     : Week 9 Matchup War Room (Betting, Franchise H2H, Shanahan vs Kubiak Staff H2H, Trench Matrix)
 * - health      : Team Health (Wed/Thu/Fri Practice, Player Toughness & Vet-Rest Priors, IR 4-Game Return Tracker)
 * - stats       : Team Stats (1st–32nd NFL Standard & Advanced EPA Rankings + Aggregated Power Rankings)
 * - trade       : Trade Deadline War Room (Oct 1 – Nov 10: Buckner/Odighizuwa Grades, Needs, Fits, Pick Costs, Tiered Rumors)
 * - playoffs    : Near-Playoffs 10,000-Run Monte Carlo Simulator, Explicit Seed Paths & Interactive Rooting Guide
 * - schedule    : Full 2026 Schedule (Melbourne & Mexico City International Venues, Turf, Rest Deltas)
 * - draft_prep  : Post-Season Draft War Room (2027 Needs, Consensus Mocks, Shanahan/Lynch Archetype Fit Score, Combine Hub)
 * - draft_class : 2026 Draft Picks & Priority UDFAs (Consensus Value Steals, Guaranteed UDFA $, Spider Charts & Highlight Reels)
 */

import { esc, playProbBadgeClass, rankBadgeClass } from './uiHelpers.js';
import { renderVideoEmbedOrFacade } from './newsView.js';
import { renderSpiderChartHtml } from '../components/spiderChart.js';
import { formatCompactDollars } from '../engine/capSimulator.js';

export function renderSeasonMatchupViewHtml({
  seasonSub = 'matchup',
  activePhases = [],
  appData,
  mcSimResult,
  forcedWinners = {},
  combineSearch = '',
  expandedDraftSpiderIdx = -1,
  activeVideosSet
}) {
  const phaseSet = new Set(activePhases || []);

  const subTabs = [
    { key: 'matchup', label: '⚔️ Wk 9 Matchup', activeNow: phaseSet.has('IN_SEASON') },
    { key: 'health', label: '🩺 Health & IR', activeNow: phaseSet.has('IN_SEASON') },
    { key: 'trade', label: '🔄 Trade Deadline', activeNow: phaseSet.has('TRADE_WINDOW') },
    { key: 'stats', label: '📈 Team Stats & Ranks', activeNow: phaseSet.has('IN_SEASON') },
    { key: 'schedule', label: '🗓️ Schedule', activeNow: true },
    { key: 'playoffs', label: '🎲 Playoff Monte Carlo', activeNow: phaseSet.has('PLAYOFF_PUSH') },
    { key: 'draft_class', label: '🎬 2026 Draft & UDFAs', activeNow: phaseSet.has('DRAFT_LIVE_UDFA') },
    { key: 'draft_prep', label: '🧭 2027 Draft & Combine', activeNow: phaseSet.has('DRAFT_PREP') }
  ];

  // Sort active-phase tabs first while keeping off-cycle tabs accessible in Vault/Preview
  subTabs.sort((a, b) => Number(b.activeNow) - Number(a.activeNow));

  const switcherCard = `
    <div class="card">
      <div class="pill-bar" role="tablist" aria-label="Game Week and Seasonal War Rooms">
        ${subTabs
          .map(
            t => `
          <button type="button" class="pill-btn ${seasonSub === t.key ? 'active' : ''}"
                  data-action="set-season-sub" data-season-sub="${t.key}">
            ${esc(t.label)}${!t.activeNow ? ' (Vault)' : ''}
          </button>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  if (seasonSub === 'matchup') return switcherCard + renderUpcomingMatchup(appData);
  if (seasonSub === 'health') return switcherCard + renderTeamHealthAndIr(appData);
  if (seasonSub === 'stats') return switcherCard + renderTeamStatsAndPower(appData);
  if (seasonSub === 'trade') return switcherCard + renderTradeWarRoom(appData);
  if (seasonSub === 'playoffs') return switcherCard + renderPlayoffSimulator(appData, mcSimResult, forcedWinners);
  if (seasonSub === 'schedule') return switcherCard + renderFullSchedule(appData);
  if (seasonSub === 'draft_prep') return switcherCard + renderDraftPrepAndCombine(appData, combineSearch);
  return switcherCard + renderDraftClassAndUdfas(appData, expandedDraftSpiderIdx, activeVideosSet);
}

function renderUpcomingMatchup(appData) {
  const um = appData?.scheduleMatchup?.upcomingMatchup || {};
  const bet = um.betting || {};

  return `
    <section class="card temporal-highlight">
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-eyebrow">Week ${um.week} Matchup War Room • ${esc(um.kickoffDisplay)}</div>
          <h2 class="card-title">${esc(um.oppName)} (${esc(um.oppRecord)}) @ 49ers (${esc(um.sfRecord)})</h2>
        </div>
        <button type="button" class="btn-ghost" data-action="analyze-topic-jump"
                data-prompt="Deep film and protection breakdown for Week 9 Las Vegas Raiders at 49ers: Klint Kubiak vs Kyle Shanahan and neutralizing Maxx Crosby">
          ⚡ AI Film Prep
        </button>
      </div>

      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">🏟️ ${esc(um.venue)}</div>

      <div class="kpi-grid">
        <div class="kpi-box"><div class="kpi-label">Consensus Line</div><div class="kpi-val mono" style="color:var(--emerald)">${esc(bet.spread)}</div></div>
        <div class="kpi-box"><div class="kpi-label">Total (O/U)</div><div class="kpi-val mono">${esc(bet.overUnder)}</div></div>
        <div class="kpi-box"><div class="kpi-label">Implied Score</div><div class="kpi-val mono" style="font-size:12.5px">${esc(bet.impliedScore)}</div></div>
      </div>

      <div style="padding:8px 10px;border-radius:8px;background:var(--bg-card-alt);font-size:12px;color:var(--text-secondary)">
        <strong>Line Movement &amp; Rest:</strong> ${esc(bet.openingSpread)} • Moneyline <span class="mono">${esc(bet.moneyline)}</span> • <strong style="color:var(--gold-bright)">${esc(bet.restAdvantage)}</strong>
      </div>
    </section>

    <section class="card">
      <div class="card-eyebrow">Opposing Coaching Staff Tendencies</div>
      <h3 class="card-title" style="margin-bottom:8px">${esc(um.coachingMatchup?.headline)}</h3>
      <p style="margin:0 0 8px;font-size:13px;color:var(--text-secondary)">${esc(um.coachingMatchup?.summary)}</p>
      <ul class="brief-bullets">
        ${(um.coachingMatchup?.bullets || []).map(b => `<li>${esc(b)}</li>`).join('')}
      </ul>
    </section>

    <section class="card">
      <div class="card-eyebrow">Trench &amp; Coverage Mismatches</div>
      <h3 class="card-title" style="margin-bottom:8px">Key Matchup Matrix</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${(um.keyMatchupsMatrix || [])
          .map(
            m => `
          <div style="padding:9px 10px;border-radius:9px;background:var(--bg-card-alt);border:1px solid var(--border-subtle)">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
              <strong style="font-size:13px">${esc(m.unitMatchup)}</strong>
              <span class="badge badge-positive">${esc(m.advantage)}</span>
            </div>
            <div style="font-size:12.5px;color:var(--text-secondary)">${esc(m.tacticalDetail || '')}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </section>

    <section class="card">
      <div class="card-eyebrow">Recent Franchise History (${esc(um.franchiseHistory?.recentRecord)})</div>
      <h3 class="card-title" style="margin-bottom:8px">49ers vs. Raiders Recent Meetings</h3>
      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">${esc(um.franchiseHistory?.lastMeetingNote)}</div>
      <div class="table-scroll">
        <table class="data-table mono">
          <thead><tr><th>Season</th><th>Date</th><th>Site</th><th>Result</th></tr></thead>
          <tbody>
            ${(um.franchiseHistory?.recentGames || [])
              .map(
                g => `
              <tr>
                <td>${g.season}</td>
                <td>${esc(g.date)}</td>
                <td>${esc(g.venue)}</td>
                <td style="color:${g.sfWon ? 'var(--emerald)' : 'var(--crimson)'}"><strong>${g.sfWon ? 'W' : 'L'}</strong> ${esc(g.scoreDisplay)}${g.overtime ? ' (OT)' : ''}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderTeamHealthAndIr(appData) {
  const h = appData?.health || {};
  return `
    <section class="card">
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-eyebrow">Player-Specific Priors (Vet Rest &amp; Toughness Adjusted)</div>
          <h2 class="card-title">Week ${h.week || 9} Practice &amp; Play Likelihood</h2>
        </div>
        <span class="badge badge-gold mono">IR Returns Left: ${h.remainingIrDesignations}/${h.maxRegularSeasonIrDesignations}</span>
      </div>

      <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">
        Accounts for player-specific habits (e.g., Trent Williams / CMC veteran rest days vs. acute ankle/soft-tissue tags, plus Fred Warner / George Kittle "plays through Questionable" toughness rates). Tap any player for full factor breakdown.
      </div>

      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>Player</th><th>Injury / Context</th><th class="mono">W / T / F</th><th>Play Likelihood</th>
            </tr>
          </thead>
          <tbody>
            ${(h.practiceReport || [])
              .map(
                p => `
              <tr style="cursor:pointer" data-action="open-player-sheet" data-player-id="${esc(p.playerId)}" data-initial-tab="health">
                <td><strong>${esc(p.name)}</strong> <span style="color:var(--gold-bright);font-size:11px">${esc(p.position)}</span></td>
                <td>${esc(p.injuryType)}</td>
                <td class="mono">${esc(p.wed)} / ${esc(p.thu)} / ${esc(p.fri)}</td>
                <td><span class="badge ${playProbBadgeClass(p.playProbabilityPct)} mono">${esc(p.playBadgeLabel)}</span></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <div class="card-eyebrow">NFL 4-Game Minimum Rule (Week 8 Bye Excluded)</div>
      <h3 class="card-title" style="margin-bottom:8px">IR &amp; Reserve Return Window Tracker (${(h.irAndReserveTracker || []).length})</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${(h.irAndReserveTracker || [])
          .map(
            ir => `
          <div style="padding:9px 10px;border-radius:9px;background:var(--bg-card-alt);border:1px solid var(--border-subtle);cursor:pointer"
               data-action="open-player-sheet" data-player-id="${esc(ir.playerId)}" data-initial-tab="health">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
              <strong>${esc(ir.name)} <span style="color:var(--gold-bright)">(${esc(ir.position)})</span></strong>
              <span class="badge badge-gold mono">Est. Return: ${esc(ir.projectedReturnWeek)}</span>
            </div>
            <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">
              ${esc(ir.status)} • Earliest Eligible: Wk ${ir.earliestEligibleWeek} (${esc(ir.byeWeekNote)})
            </div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">${esc(ir.beatNote)}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderTeamStatsAndPower(appData) {
  const ranks = appData?.scheduleMatchup?.teamStatRankings || [];
  const pwr = appData?.scheduleMatchup?.powerRankings || {};

  return `
    <section class="card">
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-eyebrow">nflverse 2026 Regular Season • 32-Team Benchmarks</div>
          <h2 class="card-title">49ers Team Stats &amp; NFL Rankings</h2>
        </div>
      </div>

      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr><th>Metric</th><th>Category</th><th class="mono">49ers Value</th><th class="mono">NFL Rank</th><th class="mono">NFL Avg</th></tr>
          </thead>
          <tbody>
            ${ranks
              .map(
                r => `
              <tr>
                <td><strong>${esc(r.label)}</strong></td>
                <td style="color:var(--text-secondary);font-size:11.5px">${esc(r.category)}</td>
                <td class="mono"><strong>${esc(r.displayValue)}</strong></td>
                <td><span class="badge ${rankBadgeClass(r.rank)} mono">#${r.rank}</span></td>
                <td class="mono" style="color:var(--text-muted)">${esc(r.leagueAvgDisplay)}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-eyebrow">${esc(pwr.weekLabel)}</div>
          <h2 class="card-title">Aggregated NFL Power Rankings</h2>
        </div>
        <span class="badge badge-positive mono" style="font-size:13px">#${pwr.consensusRank} Consensus</span>
      </div>

      <p style="margin:0 0 10px;font-size:13px;color:var(--text-secondary)">${esc(pwr.synthesizedTakeaway)}</p>

      <div style="display:flex;flex-direction:column;gap:8px">
        ${(pwr.sources || [])
          .map(
            s => `
          <div style="padding:9px 10px;border-radius:9px;background:var(--bg-card-alt)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
              <strong>${esc(s.outlet)}</strong>
              <span class="badge badge-gold mono">Rank #${s.rank} (${esc(s.delta)})</span>
            </div>
            <div style="font-size:12.5px;color:var(--text-secondary)">${esc(s.blurb)}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderTradeWarRoom(appData) {
  const tw = appData?.seasonal?.tradeWarRoom || {};
  return `
    <section class="card temporal-highlight">
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-eyebrow">Oct 1 – Trade Deadline • ${esc(tw.deadlineDisplay)}</div>
          <h2 class="card-title">Trade Deadline War Room</h2>
        </div>
        <span class="badge badge-positive mono">${formatCompactDollars(tw.availableGrossCap)} Gross Cap</span>
      </div>

      <div class="sub-label" style="margin-bottom:6px">Completed 2026 Impact Acquisitions</div>
      <div style="display:flex;flex-direction:column;gap:7px;margin-bottom:12px">
        ${(tw.completed2026Moves || [])
          .map(
            m => `
          <div style="padding:9px 10px;border-radius:9px;background:var(--bg-card-alt);border:1px solid var(--gold-border)">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
              <strong>${esc(m.player)} (${esc(m.position)}) ← ${esc(m.acquiredFrom)}</strong>
              <span class="badge badge-positive mono">Grade ${esc(m.schemeGrade)}</span>
            </div>
            <div style="font-size:11.5px;color:var(--gold-bright);margin:2px 0">${esc(m.timing)} • Cost: ${esc(m.costSummary)}</div>
            <div style="font-size:12.5px;color:var(--text-secondary)">${esc(m.analysis)}</div>
          </div>
        `
          )
          .join('')}
      </div>

      <div class="sub-label" style="margin-bottom:6px">Remaining Pre-Deadline Needs</div>
      <div style="display:flex;flex-direction:column;gap:7px">
        ${(tw.topNeeds || [])
          .map(
            n => `
          <div style="padding:8px 10px;border-radius:8px;background:var(--bg-card-alt)">
            <strong>#${n.rank} ${esc(n.positionGroup)}</strong> <span class="badge badge-warning">${esc(n.urgency)}</span>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:3px">${esc(n.epaContext)}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </section>

    <section class="card">
      <div class="card-eyebrow">9/18ths Pro-Rated Base Salary &amp; Rich Hill Pick Costs</div>
      <h3 class="card-title" style="margin-bottom:8px">Realistic Seller-Team Fit Matrix</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${(tw.realisticTargets || [])
          .map(
            t => `
          <div style="padding:9px 10px;border-radius:9px;background:var(--bg-card-alt)">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
              <strong>${esc(t.name)} (${esc(t.position)})</strong>
              <span class="badge badge-gold mono">Fit ${t.fitScore}/100 • Cap ${formatCompactDollars(t.prorated2026CapCharge)}</span>
            </div>
            <div style="font-size:11.5px;color:var(--emerald);margin:2px 0">Est. Cost: ${esc(t.projectedPickCost)}</div>
            <div style="font-size:12.5px;color:var(--text-secondary)">${esc(t.fitBreakdown)}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </section>

    <section class="card">
      <div class="card-eyebrow">Anti-Sensationalism Credibility Tiers</div>
      <h3 class="card-title" style="margin-bottom:8px">Verified Trade Rumors &amp; Front Office Intel</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${(tw.tieredRumors || [])
          .map(
            r => `
          <div style="padding:9px 10px;border-radius:9px;background:var(--bg-card-alt)">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:3px">
              <span class="badge ${r.tier.includes('Tier 1') ? 'badge-positive' : 'badge-gold'}">${esc(r.tier)}</span>
              <span style="font-size:11px;color:var(--text-muted)">${esc(r.sources)}</span>
            </div>
            <div style="font-size:12.5px">${esc(r.summary)}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderPlayoffSimulator(appData, mcSimResult, forcedWinners) {
  const pp = appData?.seasonal?.playoffPicture || {};
  const sim = mcSimResult || pp.baselineSimulation || {};
  const sf = sim.sfOdds || {};
  const seeds = sf.seedDistribution || {};
  const overrideCount = Object.keys(forcedWinners || {}).length;

  return `
    <section class="card temporal-highlight">
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-eyebrow">10,000-Iteration Monte Carlo • Official NFL Tiebreakers</div>
          <h2 class="card-title">49ers Playoff &amp; Seeding Probabilities</h2>
        </div>
        ${
          overrideCount > 0
            ? `<button type="button" class="btn-ghost" data-action="reset-playoff-overrides">↺ Clear (${overrideCount})</button>`
            : `<span class="badge badge-gold mono">10,000 Runs</span>`
        }
      </div>

      <div class="kpi-grid">
        <div class="kpi-box">
          <div class="kpi-label">Make Playoffs</div>
          <div class="kpi-val mono" style="color:var(--emerald)">${sf.makePlayoffsPct ?? 0}%</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">Win NFC West</div>
          <div class="kpi-val mono" style="color:var(--gold-bright)">${sf.winDivisionPct ?? 0}%</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-label">#1 Seed Bye</div>
          <div class="kpi-val mono">${sf.seed1ByePct ?? 0}%</div>
        </div>
      </div>

      <div class="sub-label" style="margin:10px 0 6px">Exact NFC Seed Distribution (Proj. ${sf.projectedWins ?? 13.1} Wins)</div>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${[1, 2, 3, 4, 5, 6, 7]
          .map(s => {
            const pct = seeds[s] ?? 0;
            return `
              <div class="spider-drill-row" style="grid-template-columns:86px 1fr 46px">
                <span class="mono" style="font-size:12px;font-weight:700">Seed #${s}${s === 1 ? ' (Bye)' : ''}</span>
                <div class="spider-bar-track"><div class="spider-bar-fill" style="width:${Math.min(100, pct)}%;background:${s === 1 ? 'var(--emerald)' : s <= 4 ? 'var(--gold)' : 'var(--scarlet-bright)'}"></div></div>
                <span class="mono" style="font-size:12px;text-align:right">${pct}%</span>
              </div>
            `;
          })
          .join('')}
      </div>
    </section>

    <section class="card">
      <div class="card-header">
        <div class="card-title-group">
          <div class="card-eyebrow">Tap Any Team to Lock Winner &amp; Re-Run 10,000 Simulations</div>
          <h3 class="card-title">Interactive Rooting Guide &amp; Scenario Toggler</h3>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:7px">
        ${(pp.rootingLeverage || [])
          .map(g => {
            const picked = forcedWinners?.[g.gameId] || null;
            return `
              <div class="scenario-game-row">
                <div style="min-width:0">
                  <div style="font-weight:700;font-size:13px">
                    Wk ${g.week}: ${esc(g.matchupLabel)}
                    ${g.is49ersGame ? `<span class="badge badge-scarlet">49ers</span>` : ''}
                  </div>
                  <div style="font-size:11.5px;color:var(--text-secondary)">
                    Root for <strong style="color:var(--emerald)">${esc(g.rootForTeam)}</strong> •
                    <span class="mono">+${g.primaryDeltaPct}% ${esc(g.primaryMetric)} swing</span>
                  </div>
                </div>
                <div class="scenario-toggle-pair">
                  <button type="button"
                          class="team-pick-btn mono ${picked === 'AWAY' ? 'selected' : ''} ${g.recommendedWinner === 'AWAY' ? 'recommended' : ''}"
                          data-action="toggle-playoff-winner" data-game-id="${esc(g.gameId)}" data-side="AWAY">
                    ${esc(g.away)}
                  </button>
                  <button type="button"
                          class="team-pick-btn mono ${picked === 'HOME' ? 'selected' : ''} ${g.recommendedWinner === 'HOME' ? 'recommended' : ''}"
                          data-action="toggle-playoff-winner" data-game-id="${esc(g.gameId)}" data-side="HOME">
                    ${esc(g.home)}
                  </button>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    </section>

    <section class="card">
      <div class="card-eyebrow">Explicit Seeding Scenarios</div>
      <h3 class="card-title" style="margin-bottom:8px">Paths to #1 Seed &amp; Division Crown</h3>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
        ${(pp.seedPathCards || [])
          .map(
            c => `
          <div style="padding:9px 10px;border-radius:9px;background:var(--bg-card-alt)">
            <strong>${esc(c.target)}</strong>
            <div style="font-size:12.5px;color:var(--text-secondary);margin-top:3px">${esc(c.pathSummary)}</div>
          </div>
        `
          )
          .join('')}
      </div>

      <div class="sub-label" style="margin-bottom:6px">Full 16-Team NFC Simulated Standings</div>
      <div class="table-scroll">
        <table class="data-table mono">
          <thead><tr><th>Team</th><th>Div</th><th>Rec</th><th>Proj W</th><th>Playoffs</th><th>Div %</th><th>#1 Bye</th></tr></thead>
          <tbody>
            ${(sim.allTeamOdds || [])
              .map(
                t => `
              <tr style="${t.abbr === 'SF' ? 'background:var(--gold-soft)' : ''}">
                <td><strong>${esc(t.abbr)}</strong></td>
                <td style="font-family:var(--font-sans);font-size:11px">${esc(t.division.replace('NFC ', ''))}</td>
                <td>${esc(t.currentRecord)}</td>
                <td>${t.projectedWins}</td>
                <td>${t.makePlayoffsPct}%</td>
                <td>${t.winDivisionPct}%</td>
                <td>${t.seed1ByePct}%</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderFullSchedule(appData) {
  const sched = appData?.scheduleMatchup?.schedule || [];
  return `
    <section class="card">
      <div class="card-eyebrow">2026 Regular Season • International, Surface &amp; Rest Differential</div>
      <h2 class="card-title" style="margin-bottom:10px">49ers Matchups &amp; Venue Tracker</h2>

      <div style="display:flex;flex-direction:column;gap:8px">
        ${sched
          .map(g => {
            const restBadge =
              g.restAdvantageDays > 0
                ? `<span class="badge badge-positive mono">+${g.restAdvantageDays}d Rest</span>`
                : g.restAdvantageDays < 0
                  ? `<span class="badge badge-danger mono">${g.restAdvantageDays}d Rest</span>`
                  : '';
            return `
              <div style="padding:9px 10px;border-radius:10px;background:var(--bg-card-alt);border:1px solid ${
                g.venue?.isInternational ? 'var(--gold-border)' : 'var(--border-subtle)'
              }">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                  <div>
                    <span class="mono" style="color:var(--gold-bright);font-weight:800">WK ${g.week}</span> •
                    <strong>${g.homeAway === 'home' ? 'vs.' : '@'} ${esc(g.opponent?.name)}</strong>
                    <span class="mono" style="font-size:11.5px;color:var(--text-muted)">(${esc(g.opponent?.record)})</span>
                  </div>
                  <div style="display:flex;gap:5px;align-items:center">
                    ${restBadge}
                    ${
                      g.completed
                        ? `<span class="badge ${g.result === 'W' ? 'badge-positive' : 'badge-danger'} mono">${g.result} ${g.sfScore}-${g.oppScore}</span>`
                        : `<span class="badge badge-neutral mono">${esc(g.statusDetail)}</span>`
                    }
                  </div>
                </div>
                <div style="font-size:11.5px;color:var(--text-secondary);margin-top:4px">
                  🏟️ ${esc(g.venue?.name)} (${esc(g.venue?.city)}) • ${esc(g.venue?.surface)}
                  ${g.spreadLineSf != null && !g.completed ? ` • Line: <strong class="mono">SF ${g.spreadLineSf > 0 ? '+' : ''}${g.spreadLineSf}</strong>` : ''}
                </div>
                ${
                  g.venue?.internationalNote
                    ? `<div style="margin-top:4px;font-size:11.5px;color:var(--gold-bright);font-weight:700">${esc(g.venue.internationalNote)}</div>`
                    : ''
                }
              </div>
            `;
          })
          .join('')}
      </div>
    </section>
  `;
}

function renderDraftPrepAndCombine(appData, combineSearch) {
  const dp = appData?.seasonal?.draftPrep2027 || {};
  const q = String(combineSearch || '').toLowerCase().trim();
  const filteredCombine = (dp.combineLeaderboard || []).filter(
    c => !q || c.name.toLowerCase().includes(q) || c.pos.toLowerCase().includes(q) || c.school.toLowerCase().includes(q)
  );

  return `
    <section class="card">
      <div class="card-eyebrow">Post-Season Until Draft • 2-Year Cap &amp; Roster Horizon</div>
      <h2 class="card-title" style="margin-bottom:8px">2027 Draft War Room &amp; Pick Inventory</h2>

      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
        ${(dp.topNeeds2027 || [])
          .map(
            n => `
          <div style="padding:8px 10px;border-radius:8px;background:var(--bg-card-alt);font-size:12.5px">
            <strong style="color:var(--gold-bright)">#${n.rank} ${esc(n.pos)}:</strong> ${esc(n.horizon)}
          </div>
        `
          )
          .join('')}
      </div>

      <div class="sub-label" style="margin-bottom:6px">49ers 2027 Draft Pick Capital (Incl. Comp Projections)</div>
      <div class="table-scroll">
        <table class="data-table mono">
          <thead><tr><th>Rd</th><th>Est. Pick</th><th>Origin</th><th>Rich Hill Pts</th></tr></thead>
          <tbody>
            ${(dp.pickInventory || [])
              .map(
                p => `
              <tr>
                <td>Rd ${p.round}</td><td>#${p.projectedOverall}</td>
                <td style="font-family:var(--font-sans)">${esc(p.origin)}</td>
                <td>${p.valueRichHill}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <div class="card-eyebrow">Aggregated Mock Consensus + Shanahan/Lynch Archetype Fit</div>
      <h3 class="card-title" style="margin-bottom:8px">Top Projected 49ers Prospect Fits</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${(dp.consensusMockTargets || [])
          .map(
            m => `
          <div style="padding:9px 10px;border-radius:9px;background:var(--bg-card-alt)">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
              <strong>${esc(m.name)} (${esc(m.pos)} • ${esc(m.school)})</strong>
              <span class="badge badge-positive mono">SF Fit ${m.shanahanLynchFitScore}/100 • ${m.mockFrequencyToSfPct}% Mocks</span>
            </div>
            <div style="font-size:11.5px;color:var(--gold-bright);margin:2px 0">${esc(m.heightWeight)} • Mocked by: ${esc((m.sourcesMocking || []).join(', '))}</div>
            <div style="font-size:12.5px;color:var(--text-secondary)">${esc(m.archetypeTraits)}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </section>

    <section class="card">
      <div class="card-eyebrow">NFL Scouting Combine Measurables &amp; RAS Leaderboard</div>
      <h3 class="card-title" style="margin-bottom:8px">Searchable Combine Results (${filteredCombine.length})</h3>
      <input type="search" id="combineSearchInput" class="text-input" style="margin-bottom:8px"
             placeholder="Filter Combine athletes by name, position, college…" value="${esc(combineSearch)}" aria-label="Search Combine Results" />
      <div class="table-scroll">
        <table class="data-table mono">
          <thead><tr><th>Athlete</th><th>Pos</th><th>School</th><th>Ht / Wt</th><th>40-Yd</th><th>Vert</th><th>3-Cone</th><th>RAS</th></tr></thead>
          <tbody>
            ${filteredCombine
              .slice(0, 35)
              .map(
                c => `
              <tr>
                <td style="font-family:var(--font-sans)"><strong>${esc(c.name)}</strong></td>
                <td>${esc(c.pos)}</td>
                <td style="font-family:var(--font-sans)">${esc(c.school)}</td>
                <td>${esc(c.ht)} / ${c.wt ?? '—'}</td>
                <td>${c.forty ?? '—'}</td>
                <td>${c.vertical ?? '—'}</td>
                <td>${c.threeCone ?? '—'}</td>
                <td><span class="badge badge-positive">${Number(c.ras).toFixed(2)}</span></td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderDraftClassAndUdfas(appData, expandedDraftSpiderIdx, activeVideosSet) {
  const dc = appData?.seasonal?.draftClass2026 || {};
  const picks = dc.picks || [];
  const udfas = dc.priorityUdfas || [];

  return `
    <section class="card">
      <div class="card-eyebrow">Draft Day 1 Through Post-UDFA • Value vs. Consensus &amp; Film</div>
      <h2 class="card-title" style="margin-bottom:8px">2026 49ers Draft Class (${picks.length} Picks)</h2>

      <div style="display:flex;flex-direction:column;gap:10px">
        ${picks
          .map((pk, idx) => {
            const vidKey = `draft26_${pk.pick}_${pk.highlightVideo?.videoId || idx}`;
            const isVidPlaying = activeVideosSet.has(vidKey);
            const isSpiderOpen = expandedDraftSpiderIdx === idx;
            const stealBadge =
              pk.stealDelta > 0
                ? `<span class="badge badge-positive mono">+${pk.stealDelta} Value Steal (Board #${pk.consensusBigBoardRank})</span>`
                : `<span class="badge badge-gold mono">Board #${pk.consensusBigBoardRank}</span>`;

            return `
              <div class="brief-card">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
                  <div>
                    <span class="badge badge-scarlet mono">Rd ${pk.round} • Pick #${pk.pick}</span>
                    <strong style="font-size:14.5px;margin-left:5px">${esc(pk.name)}</strong>
                    <span style="color:var(--gold-bright);font-weight:700"> ${esc(pk.position)} • ${esc(pk.college)}</span>
                  </div>
                  ${stealBadge}
                </div>

                <div style="font-size:12.5px;color:var(--text-secondary)">${esc(pk.roleSummary)}</div>

                <ul class="brief-bullets">
                  ${(pk.strengths || []).map(s => `<li>${esc(s)}</li>`).join('')}
                </ul>

                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
                  <span class="mono" style="font-size:11.5px;color:var(--text-muted)">Est. 4-Yr Deal: ${formatCompactDollars(pk.estimated4YrRookieTotal)}</span>
                  <button type="button" class="btn-ghost" data-action="toggle-draft-spider" data-draft-idx="${idx}">
                    ${isSpiderOpen ? '▲ Hide Spider Chart' : '🕸️ Athletic Spider Chart'}
                  </button>
                </div>

                ${isSpiderOpen ? renderSpiderChartHtml(pk.spiderProfile, pk.name) : ''}

                ${
                  pk.highlightVideo?.videoId
                    ? renderVideoEmbedOrFacade(
                        vidKey,
                        pk.highlightVideo.videoId,
                        0,
                        pk.highlightVideo.title || `${pk.name} College Highlights`,
                        pk.highlightVideo.channel,
                        isVidPlaying
                      )
                    : ''
                }
              </div>
            `;
          })
          .join('')}
      </div>
    </section>

    <section class="card">
      <div class="card-eyebrow">Guaranteed Money = #1 Predictor of 53-Man / Priority PS Odds</div>
      <h3 class="card-title" style="margin-bottom:8px">Priority Undrafted Free Agents (UDFAs)</h3>
      <div style="display:flex;flex-direction:column;gap:9px">
        ${udfas
          .map((u, idx) => {
            const vidKey = `udfa26_${idx}_${u.highlightVideo?.videoId || idx}`;
            return `
              <div class="brief-card">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
                  <strong>${esc(u.displayName || u.name)} (${esc(u.position)})</strong>
                  <span class="badge badge-gold mono">${formatCompactDollars(u.guaranteedTotal)} Guaranteed</span>
                </div>
                <div style="font-size:12px;color:var(--emerald)">${esc(u.rosterOddsNote)}</div>
                <div style="font-size:12.5px;color:var(--text-secondary)">${esc(u.roleSummary)}</div>
                ${
                  u.highlightVideo?.videoId
                    ? renderVideoEmbedOrFacade(
                        vidKey,
                        u.highlightVideo.videoId,
                        0,
                        u.highlightVideo.title,
                        u.highlightVideo.channel,
                        activeVideosSet.has(vidKey)
                      )
                    : ''
                }
              </div>
            `;
          })
          .join('')}
      </div>
    </section>
  `;
}
