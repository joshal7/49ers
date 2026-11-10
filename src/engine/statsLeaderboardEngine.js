/**
 * NFL Team Stats, Matchup Comparison & Positional Player Leaderboard Engine
 * 100% deterministic, zero-network module shared by the Node ingestion pipeline
 * (`scripts/fetch-live-49ers-data.mjs`) and browser views (`seasonMatchupView.js`,
 * `playerSheetView.js`, `app.js`).
 */

import { normalizeTeamAbbr } from './playoffMonteCarlo.js';

export const NFL_TEAM_NAMES = {
  ARI: { name: 'Arizona Cardinals', shortName: 'Cardinals' },
  ATL: { name: 'Atlanta Falcons', shortName: 'Falcons' },
  BAL: { name: 'Baltimore Ravens', shortName: 'Ravens' },
  BUF: { name: 'Buffalo Bills', shortName: 'Bills' },
  CAR: { name: 'Carolina Panthers', shortName: 'Panthers' },
  CHI: { name: 'Chicago Bears', shortName: 'Bears' },
  CIN: { name: 'Cincinnati Bengals', shortName: 'Bengals' },
  CLE: { name: 'Cleveland Browns', shortName: 'Browns' },
  DAL: { name: 'Dallas Cowboys', shortName: 'Cowboys' },
  DEN: { name: 'Denver Broncos', shortName: 'Broncos' },
  DET: { name: 'Detroit Lions', shortName: 'Lions' },
  GB: { name: 'Green Bay Packers', shortName: 'Packers' },
  HOU: { name: 'Houston Texans', shortName: 'Texans' },
  IND: { name: 'Indianapolis Colts', shortName: 'Colts' },
  JAX: { name: 'Jacksonville Jaguars', shortName: 'Jaguars' },
  KC: { name: 'Kansas City Chiefs', shortName: 'Chiefs' },
  LAC: { name: 'Los Angeles Chargers', shortName: 'Chargers' },
  LAR: { name: 'Los Angeles Rams', shortName: 'Rams' },
  LV: { name: 'Las Vegas Raiders', shortName: 'Raiders' },
  MIA: { name: 'Miami Dolphins', shortName: 'Dolphins' },
  MIN: { name: 'Minnesota Vikings', shortName: 'Vikings' },
  NE: { name: 'New England Patriots', shortName: 'Patriots' },
  NO: { name: 'New Orleans Saints', shortName: 'Saints' },
  NYG: { name: 'New York Giants', shortName: 'Giants' },
  NYJ: { name: 'New York Jets', shortName: 'Jets' },
  PHI: { name: 'Philadelphia Eagles', shortName: 'Eagles' },
  PIT: { name: 'Pittsburgh Steelers', shortName: 'Steelers' },
  SEA: { name: 'Seattle Seahawks', shortName: 'Seahawks' },
  SF: { name: 'San Francisco 49ers', shortName: '49ers' },
  TB: { name: 'Tampa Bay Buccaneers', shortName: 'Buccaneers' },
  TEN: { name: 'Tennessee Titans', shortName: 'Titans' },
  WAS: { name: 'Washington Commanders', shortName: 'Commanders' }
};

function safeNum(v, fallback = 0) {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function fmtSigned(n, decimals = 2, suffix = '') {
  const clean = Number(safeNum(n).toFixed(decimals));
  const sign = clean > 0 ? '+' : '';
  return `${sign}${clean.toFixed(decimals)}${suffix}`;
}

function fmtPlain(n, decimals = 1, suffix = '') {
  return `${safeNum(n).toFixed(decimals)}${suffix}`;
}

/**
 * Compute traditional NFL Passer Rating (0.0 – 158.3)
 */
export function computeNflPasserRating(comp, att, yds, td, int) {
  const a = safeNum(att);
  if (a <= 0) return 0;
  const clamp = x => Math.max(0, Math.min(2.375, x));
  const p1 = clamp((safeNum(comp) / a - 0.3) * 5);
  const p2 = clamp((safeNum(yds) / a - 3) * 0.25);
  const p3 = clamp((safeNum(td) / a) * 20);
  const p4 = clamp(2.375 - (safeNum(int) / a) * 25);
  return Number((((p1 + p2 + p3 + p4) / 6) * 100).toFixed(1));
}

/**
 * 4 Vertically Stacked Team Stat Units (in exact user-specified order):
 * 1. Offense -> 2. Defense -> 3. Special Teams -> 4. Overview & Margin
 * Offense and Defense maintain strict 1-to-1 metric symmetry across Core & Expanded drawers.
 */
export const TEAM_STAT_UNITS_SCHEMA = [
  {
    id: 'offense',
    title: '49ers Offense',
    shortLabel: 'Offense',
    overallKey: 'overall_offense_composite',
    overallLabel: 'Overall Offense Rank',
    jargonKey: 'overall_offense_rank',
    icon: 'bolt',
    compositeWeights: [
      { key: 'off_epa_play', weight: 0.4, higherIsBetter: true },
      { key: 'off_pts_game', weight: 0.3, higherIsBetter: true },
      { key: 'off_total_yds_game', weight: 0.15, higherIsBetter: true },
      { key: 'off_third_down_pct', weight: 0.15, higherIsBetter: true }
    ],
    coreMetrics: [
      { key: 'off_pts_game', label: 'Points / Game', higherIsBetter: true, format: v => fmtPlain(v, 1) },
      { key: 'off_total_yds_game', label: 'Total Yards / Game', higherIsBetter: true, format: v => fmtPlain(v, 1, ' yds') },
      { key: 'total_off_epa_game', label: 'Offensive EPA / Game', higherIsBetter: true, format: v => fmtSigned(v, 2) },
      { key: 'off_pass_yds_game', label: 'Passing Yards / Game', higherIsBetter: true, format: v => fmtPlain(v, 1, ' yds') },
      { key: 'passing_epa_game', label: 'Passing EPA / Game', higherIsBetter: true, format: v => fmtSigned(v, 2) },
      { key: 'rush_yds_game', label: 'Rushing Yards / Game', higherIsBetter: true, format: v => fmtPlain(v, 1, ' yds') },
      { key: 'rushing_epa_game', label: 'Rushing EPA / Game', higherIsBetter: true, format: v => fmtSigned(v, 2) }
    ],
    expandedGroups: [
      {
        groupTitle: 'Passing Efficiency & Explosives',
        metrics: [
          { key: 'yards_per_pass_att', label: 'Net Yards / Pass Att', higherIsBetter: true, format: v => fmtPlain(v, 2, ' yds') },
          { key: 'passing_cpoe', label: 'Completion CPOE', higherIsBetter: true, format: v => fmtSigned(v, 2, '%') },
          { key: 'off_explosive_pass_game', label: 'Explosive Passes (20+ Yd) / Gm', higherIsBetter: true, format: v => fmtPlain(v, 2) }
        ]
      },
      {
        groupTitle: 'Rushing Efficiency & Explosives',
        metrics: [
          { key: 'off_yds_per_carry', label: 'Yards / Carry', higherIsBetter: true, format: v => fmtPlain(v, 2, ' yds') },
          { key: 'off_rush_1d_rate', label: 'Rush 1st-Down Rate', higherIsBetter: true, format: v => fmtPlain(v, 1, '%') },
          { key: 'off_explosive_rush_game', label: 'Explosive Runs (10+ Yd) / Gm', higherIsBetter: true, format: v => fmtPlain(v, 2) }
        ]
      },
      {
        groupTitle: 'Trenches & Situational',
        metrics: [
          { key: 'explosive_plays_game', label: 'Explosive Plays / Game', higherIsBetter: true, format: v => fmtPlain(v, 1) },
          { key: 'sack_rate_allowed', label: 'Sacks Allowed Rate', higherIsBetter: false, format: v => fmtPlain(v, 1, '%') },
          { key: 'off_third_down_pct', label: '3rd Down Conversion %', higherIsBetter: true, format: v => fmtPlain(v, 1, '%') },
          { key: 'off_red_zone_td_pct', label: 'Red Zone TD %', higherIsBetter: true, format: v => fmtPlain(v, 1, '%') }
        ]
      }
    ]
  },
  {
    id: 'defense',
    title: '49ers Defense',
    shortLabel: 'Defense',
    overallKey: 'overall_defense_composite',
    overallLabel: 'Overall Defense Rank',
    jargonKey: 'overall_defense_rank',
    icon: 'shield',
    compositeWeights: [
      { key: 'def_epa_play_allowed', weight: 0.4, higherIsBetter: false },
      { key: 'def_pts_allowed_game', weight: 0.3, higherIsBetter: false },
      { key: 'def_total_yds_allowed_game', weight: 0.15, higherIsBetter: false },
      { key: 'def_third_down_pct_allowed', weight: 0.15, higherIsBetter: false }
    ],
    coreMetrics: [
      { key: 'def_pts_allowed_game', label: 'Points Allowed / Game', higherIsBetter: false, format: v => fmtPlain(v, 1) },
      { key: 'def_total_yds_allowed_game', label: 'Yards Allowed / Game', higherIsBetter: false, format: v => fmtPlain(v, 1, ' yds') },
      { key: 'def_epa_allowed_game', label: 'Def. EPA Allowed / Game', higherIsBetter: false, format: v => fmtSigned(v, 2) },
      { key: 'def_pass_yds_allowed_game', label: 'Pass Yards Allowed / Gm', higherIsBetter: false, format: v => fmtPlain(v, 1, ' yds') },
      { key: 'def_pass_epa_allowed_game', label: 'Pass EPA Allowed / Gm', higherIsBetter: false, format: v => fmtSigned(v, 2) },
      { key: 'def_rush_yds_allowed_game', label: 'Rush Yards Allowed / Gm', higherIsBetter: false, format: v => fmtPlain(v, 1, ' yds') },
      { key: 'def_rush_epa_allowed_game', label: 'Rush EPA Allowed / Gm', higherIsBetter: false, format: v => fmtSigned(v, 2) }
    ],
    expandedGroups: [
      {
        groupTitle: 'Pass Coverage & Explosives Allowed',
        metrics: [
          { key: 'def_yds_per_pass_att_allowed', label: 'Net Yards / Pass Att Allowed', higherIsBetter: false, format: v => fmtPlain(v, 2, ' yds') },
          { key: 'def_cpoe_allowed', label: 'Completion CPOE Allowed', higherIsBetter: false, format: v => fmtSigned(v, 2, '%') },
          { key: 'def_explosive_pass_allowed_game', label: 'Explosive Passes Allowed / Gm', higherIsBetter: false, format: v => fmtPlain(v, 2) }
        ]
      },
      {
        groupTitle: 'Run Front & Explosives Allowed',
        metrics: [
          { key: 'def_yds_per_carry_allowed', label: 'Yards / Carry Allowed', higherIsBetter: false, format: v => fmtPlain(v, 2, ' yds') },
          { key: 'def_rush_1d_rate_allowed', label: 'Rush 1st-Down Rate Allowed', higherIsBetter: false, format: v => fmtPlain(v, 1, '%') },
          { key: 'def_explosive_rush_allowed_game', label: 'Explosive Runs Allowed / Gm', higherIsBetter: false, format: v => fmtPlain(v, 2) }
        ]
      },
      {
        groupTitle: 'Pass Rush, Havoc & Situational',
        metrics: [
          { key: 'def_explosive_plays_allowed_game', label: 'Explosive Plays Allowed / Gm', higherIsBetter: false, format: v => fmtPlain(v, 1) },
          { key: 'def_sack_rate', label: 'Defensive Sack Rate', higherIsBetter: true, format: v => fmtPlain(v, 1, '%') },
          { key: 'def_sacks_game', label: 'Defensive Sacks / Game', higherIsBetter: true, format: v => fmtPlain(v, 2) },
          { key: 'def_tfl_game', label: 'Tackles For Loss (TFL) / Gm', higherIsBetter: true, format: v => fmtPlain(v, 2) },
          { key: 'def_third_down_pct_allowed', label: '3rd Down Conv % Allowed', higherIsBetter: false, format: v => fmtPlain(v, 1, '%') },
          { key: 'def_red_zone_td_pct_allowed', label: 'Red Zone TD % Allowed', higherIsBetter: false, format: v => fmtPlain(v, 1, '%') }
        ]
      }
    ]
  },
  {
    id: 'special_teams',
    title: '49ers Special Teams',
    shortLabel: 'Special Teams',
    overallKey: 'overall_st_composite',
    overallLabel: 'Overall Special Teams Rank',
    jargonKey: 'overall_st_rank',
    icon: 'compass',
    compositeWeights: [
      { key: 'st_fg_pct', weight: 0.35, higherIsBetter: true },
      { key: 'st_punt_net_avg', weight: 0.3, higherIsBetter: true },
      { key: 'st_kr_avg', weight: 0.2, higherIsBetter: true },
      { key: 'st_pr_avg', weight: 0.15, higherIsBetter: true }
    ],
    coreMetrics: [
      { key: 'st_fg_pct', label: 'Field Goal %', higherIsBetter: true, format: v => fmtPlain(v, 1, '%') },
      { key: 'st_punt_net_avg', label: 'Net Punt Average', higherIsBetter: true, format: v => fmtPlain(v, 1, ' yds') },
      { key: 'st_kr_avg', label: 'Kickoff Return Average', higherIsBetter: true, format: v => fmtPlain(v, 1, ' yds') },
      { key: 'st_pr_avg', label: 'Punt Return Average', higherIsBetter: true, format: v => fmtPlain(v, 1, ' yds') }
    ],
    expandedGroups: [
      {
        groupTitle: 'Distance Kicking & Coverage Units',
        metrics: [
          { key: 'st_fg_50_plus_made', label: '50+ Yard Field Goals Made', higherIsBetter: true, format: v => String(Math.round(v)) },
          { key: 'st_punt_in20_pct', label: 'Punts Inside 20 %', higherIsBetter: true, format: v => fmtPlain(v, 1, '%') },
          { key: 'st_opp_kr_avg', label: 'Opp. Kick Return Avg Allowed', higherIsBetter: false, format: v => fmtPlain(v, 1, ' yds') },
          { key: 'st_opp_pr_avg', label: 'Opp. Punt Return Avg Allowed', higherIsBetter: false, format: v => fmtPlain(v, 1, ' yds') }
        ]
      }
    ]
  },
  {
    id: 'margin',
    title: 'Overview & Margin',
    shortLabel: 'Margin',
    overallKey: 'overall_margin_composite',
    overallLabel: 'Overall Team Margin Rank',
    jargonKey: 'overall_margin_rank',
    icon: 'trophy',
    compositeWeights: [
      { key: 'margin_pt_diff_game', weight: 0.4, higherIsBetter: true },
      { key: 'margin_net_epa_play', weight: 0.35, higherIsBetter: true },
      { key: 'margin_turnover_diff_game', weight: 0.25, higherIsBetter: true }
    ],
    coreMetrics: [
      {
        key: 'margin_turnover_diff',
        label: 'Turnover Differential',
        higherIsBetter: true,
        format: v => {
          const n = Math.round(safeNum(v));
          return `${n > 0 ? '+' : ''}${n}`;
        }
      },
      { key: 'margin_pt_diff_game', label: 'Point Differential / Gm', higherIsBetter: true, format: v => fmtSigned(v, 1) },
      { key: 'margin_net_epa_play', label: 'Net EPA / Play', higherIsBetter: true, format: v => fmtSigned(v, 3) },
      { key: 'def_takeaways_game', label: 'Def. Takeaways / Game', higherIsBetter: true, format: v => fmtPlain(v, 2) }
    ],
    expandedGroups: [
      {
        groupTitle: 'Ball Security, Yardage Margin & Discipline',
        metrics: [
          { key: 'margin_giveaways_game', label: 'Offensive Giveaways / Gm', higherIsBetter: false, format: v => fmtPlain(v, 2) },
          { key: 'margin_yds_diff_game', label: 'Net Yards Differential / Gm', higherIsBetter: true, format: v => fmtSigned(v, 1, ' yds') },
          { key: 'margin_explosive_diff_game', label: 'Explosive Play Margin / Gm', higherIsBetter: true, format: v => fmtSigned(v, 2) },
          { key: 'margin_pen_yds_game', label: 'Penalty Yards / Game', higherIsBetter: false, format: v => fmtPlain(v, 1, ' yds') }
        ]
      }
    ]
  }
];

/**
 * Compute full 32-team metrics, 4 unit composite scores, and leaderboards.
 */
export function computeLeagueTeamStatsPayload({
  regTeams = [],
  statsTeamWeek = [],
  espnTeamStatsByAbbr = new Map(),
  teamRecordsMap = new Map(),
  seasonYear = 2026
} = {}) {
  // 1. Aggregate opponent-paired defensive & coverage totals from weekly nflverse rows
  const oppAggByTeam = new Map();
  for (const row of statsTeamWeek || []) {
    if (row.season_type && row.season_type !== 'REG') continue;
    const offTeam = normalizeTeamAbbr(row.team || '');
    const defTeam = normalizeTeamAbbr(row.opponent_team || '');
    if (!offTeam || !defTeam) continue;

    const cur = oppAggByTeam.get(defTeam) || {
      games: 0,
      attempts: 0,
      completions: 0,
      passingYards: 0,
      sackYardsLostAbs: 0,
      sacksTaken: 0,
      passingEpa: 0,
      cpoeWeightedSum: 0,
      cpoeAttSum: 0,
      passing20: 0,
      passingFirstDowns: 0,
      carries: 0,
      rushingYards: 0,
      rushingEpa: 0,
      rushing10: 0,
      rushingFirstDowns: 0,
      kickoffReturns: 0,
      kickoffReturnYards: 0,
      puntReturns: 0,
      puntReturnYards: 0
    };

    const att = safeNum(row.attempts);
    cur.games += 1;
    cur.attempts += att;
    cur.completions += safeNum(row.completions);
    cur.passingYards += safeNum(row.passing_yards);
    cur.sackYardsLostAbs += Math.abs(safeNum(row.sack_yards_lost));
    cur.sacksTaken += safeNum(row.sacks_suffered);
    cur.passingEpa += safeNum(row.passing_epa);
    if (row.passing_cpoe !== '' && row.passing_cpoe != null && att > 0) {
      cur.cpoeWeightedSum += safeNum(row.passing_cpoe) * att;
      cur.cpoeAttSum += att;
    }
    cur.passing20 += safeNum(row.passing_20);
    cur.passingFirstDowns += safeNum(row.passing_first_downs);
    cur.carries += safeNum(row.carries);
    cur.rushingYards += safeNum(row.rushing_yards);
    cur.rushingEpa += safeNum(row.rushing_epa);
    cur.rushing10 += safeNum(row.rushing_10);
    cur.rushingFirstDowns += safeNum(row.rushing_first_downs);
    cur.kickoffReturns += safeNum(row.kickoff_returns);
    cur.kickoffReturnYards += safeNum(row.kickoff_return_yards);
    cur.puntReturns += safeNum(row.punt_returns);
    cur.puntReturnYards += safeNum(row.punt_return_yards);
    oppAggByTeam.set(defTeam, cur);
  }

  const regByTeam = new Map();
  for (const r of regTeams || []) {
    if (r.season_type && r.season_type !== 'REG') continue;
    const abbr = normalizeTeamAbbr(r.team || '');
    if (abbr) regByTeam.set(abbr, r);
  }

  const allTeamAbbrs = Object.keys(NFL_TEAM_NAMES);
  const teamsMeta = {};
  const rawMetricsByTeam = new Map();

  for (const abbr of allTeamAbbrs) {
    const reg = regByTeam.get(abbr) || {};
    const opp = oppAggByTeam.get(abbr) || null;
    const recInfo = teamRecordsMap.get(abbr) || {};
    const espnSt = espnTeamStatsByAbbr.get(abbr) || null;

    const wins = safeNum(recInfo.wins);
    const losses = safeNum(recInfo.losses);
    const ties = safeNum(recInfo.ties);
    const standingsGp = wins + losses + ties;
    const gp = Math.max(1, safeNum(reg.games) || standingsGp || 1);
    const oppGp = Math.max(1, opp?.games || gp);

    teamsMeta[abbr] = {
      abbr,
      name: NFL_TEAM_NAMES[abbr]?.name || abbr,
      shortName: NFL_TEAM_NAMES[abbr]?.shortName || abbr,
      record: recInfo.record || (standingsGp > 0 ? `${wins}-${losses}${ties ? `-${ties}` : ''}` : '0-0'),
      logoUrl: recInfo.logoUrl || `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr === 'WAS' ? 'wsh' : abbr.toLowerCase()}.png`
    };

    const pf = safeNum(recInfo.pointsFor, safeNum(espnSt?.offPointsTotal, 0));
    const pa = safeNum(recInfo.pointsAgainst, safeNum(espnSt?.defPointsTotal, 0));
    const ptDiff = recInfo.pointDiff != null ? safeNum(recInfo.pointDiff) : pf - pa;

    const passAtt = safeNum(reg.attempts);
    const sacksTaken = safeNum(reg.sacks_suffered);
    const passGrossYds = safeNum(reg.passing_yards);
    const sackYdsLostAbs = Math.abs(safeNum(reg.sack_yards_lost));
    const netPassYds =
      espnSt?.netPassingYards != null && passGrossYds === 0
        ? safeNum(espnSt.netPassingYards)
        : Math.max(0, passGrossYds - sackYdsLostAbs);
    const carries = safeNum(reg.carries);
    const rushYds = safeNum(reg.rushing_yards);
    const dropbacks = Math.max(1, passAtt + sacksTaken);
    const offPlays = Math.max(1, dropbacks + carries);

    const passEpa = safeNum(reg.passing_epa);
    const rushEpa = safeNum(reg.rushing_epa);
    const offEpaTotal = passEpa + rushEpa;

    const oppDropbacks = Math.max(1, (opp?.attempts || 0) + (opp?.sacksTaken || 0));
    const oppCarries = Math.max(1, opp?.carries || 1);
    const oppPlays = Math.max(1, oppDropbacks + (opp?.carries || 0));
    const oppNetPassYds = opp
      ? Math.max(0, opp.passingYards - opp.sackYardsLostAbs)
      : safeNum(espnSt?.oppNetPassingYards, 215 * oppGp);
    const oppRushYds = opp ? opp.rushingYards : safeNum(espnSt?.oppRushingYards, 115 * oppGp);
    const oppTotalEpa = opp ? opp.passingEpa + opp.rushingEpa : 0;

    const defSacks = safeNum(reg.def_sacks);
    const defTfl = safeNum(reg.def_tackles_for_loss);
    const takeawaysNflverse = safeNum(reg.def_interceptions) + safeNum(reg.fumble_recovery_opp);
    const giveawaysNflverse = safeNum(reg.passing_interceptions) + safeNum(reg.fumbles_lost_total);

    const takeaways = espnSt?.takeaways != null ? safeNum(espnSt.takeaways) : takeawaysNflverse;
    const giveaways = espnSt?.giveaways != null ? safeNum(espnSt.giveaways) : giveawaysNflverse;
    const turnoverDiff =
      espnSt?.turnoverDiff != null ? safeNum(espnSt.turnoverDiff) : takeaways - giveaways;

    // Situational 3rd Down & Red Zone (ESPN authoritative with deterministic nflverse fallback)
    const off1dProxyPct = ((safeNum(reg.passing_first_downs) + safeNum(reg.rushing_first_downs)) / offPlays) * 100;
    const opp1dProxyPct = opp
      ? ((opp.passingFirstDowns + opp.rushingFirstDowns) / oppPlays) * 100
      : 30;

    const offThirdDownPct =
      espnSt?.offThirdDownPct != null ? safeNum(espnSt.offThirdDownPct) : Math.min(58, Math.max(26, off1dProxyPct * 1.28));
    const defThirdDownPctAllowed =
      espnSt?.defThirdDownPctAllowed != null
        ? safeNum(espnSt.defThirdDownPctAllowed)
        : Math.min(58, Math.max(26, opp1dProxyPct * 1.28));

    const offRedZoneTdPct =
      espnSt?.offRedZoneTdPct != null
        ? safeNum(espnSt.offRedZoneTdPct)
        : Math.min(78, Math.max(35, 42 + ((safeNum(reg.passing_tds) + safeNum(reg.rushing_tds)) / gp) * 6.5));
    const defRedZoneTdPctAllowed =
      espnSt?.defRedZoneTdPctAllowed != null
        ? safeNum(espnSt.defRedZoneTdPctAllowed)
        : Math.min(78, Math.max(35, 38 + (pa / gp) * 0.85));

    // Special Teams
    const fgMade = safeNum(reg.fg_made);
    const fgAtt = safeNum(reg.fg_att);
    const fgPct = fgAtt > 0 ? (fgMade / fgAtt) * 100 : safeNum(reg.fg_pct) * 100;
    const fg50PlusMade = safeNum(reg.fg_made_50_59) + safeNum(reg.fg_made_60_);
    const punts = safeNum(reg.pt_att);
    const puntNetAvg =
      espnSt?.puntNetAvg != null && safeNum(espnSt.puntNetAvg) > 0
        ? safeNum(espnSt.puntNetAvg)
        : punts > 0
          ? safeNum(reg.pt_net_yards || reg.pt_yards) / punts
          : 41.5;
    const puntIn20Pct = punts > 0 ? (safeNum(reg.pt_inside_20) / punts) * 100 : 35.0;
    const krAtt = safeNum(reg.kickoff_returns);
    const krAvg =
      krAtt > 0
        ? safeNum(reg.kickoff_return_yards) / krAtt
        : safeNum(espnSt?.krAvg, 25.5);
    const prAtt = safeNum(reg.punt_returns);
    const prAvg =
      prAtt > 0
        ? safeNum(reg.punt_return_yards) / prAtt
        : safeNum(espnSt?.prAvg, 8.8);

    const oppKrAvg =
      opp && opp.kickoffReturns > 0
        ? opp.kickoffReturnYards / opp.kickoffReturns
        : safeNum(espnSt?.oppKrAvg, 25.5);
    const oppPrAvg =
      opp && opp.puntReturns > 0
        ? opp.puntReturnYards / opp.puntReturns
        : safeNum(espnSt?.oppPrAvg, 8.8);

    const offPassYdsGm = netPassYds / gp;
    const offRushYdsGm = rushYds / gp;
    const offTotalYdsGm = offPassYdsGm + offRushYdsGm;

    const defPassYdsGm = oppNetPassYds / oppGp;
    const defRushYdsGm = oppRushYds / oppGp;
    const defTotalYdsGm = defPassYdsGm + defRushYdsGm;

    const offExplosivePlaysGm = (safeNum(reg.passing_20) + safeNum(reg.rushing_10)) / gp;
    const defExplosivePlaysGm = opp ? (opp.passing20 + opp.rushing10) / oppGp : 4.5;

    const offEpaPlay = offEpaTotal / offPlays;
    const defEpaPlayAllowed = oppTotalEpa / oppPlays;

    rawMetricsByTeam.set(abbr, {
      games: gp,
      // Offense
      off_pts_game: pf / gp,
      off_total_yds_game: offTotalYdsGm,
      total_off_epa_game: offEpaTotal / gp,
      off_epa_play: offEpaPlay,
      off_pass_yds_game: offPassYdsGm,
      passing_epa_game: passEpa / gp,
      rush_yds_game: offRushYdsGm,
      rushing_epa_game: rushEpa / gp,
      yards_per_pass_att: netPassYds / dropbacks,
      passing_cpoe: safeNum(reg.passing_cpoe),
      off_explosive_pass_game: safeNum(reg.passing_20) / gp,
      off_yds_per_carry: carries > 0 ? rushYds / carries : 0,
      off_rush_1d_rate: carries > 0 ? (safeNum(reg.rushing_first_downs) / carries) * 100 : 0,
      off_explosive_rush_game: safeNum(reg.rushing_10) / gp,
      explosive_plays_game: offExplosivePlaysGm,
      sack_rate_allowed: (sacksTaken / dropbacks) * 100,
      off_third_down_pct: offThirdDownPct,
      off_red_zone_td_pct: offRedZoneTdPct,

      // Defense
      def_pts_allowed_game: pa / gp,
      def_total_yds_allowed_game: defTotalYdsGm,
      def_epa_allowed_game: oppTotalEpa / oppGp,
      def_epa_play_allowed: defEpaPlayAllowed,
      def_pass_yds_allowed_game: defPassYdsGm,
      def_pass_epa_allowed_game: (opp?.passingEpa || 0) / oppGp,
      def_rush_yds_allowed_game: defRushYdsGm,
      def_rush_epa_allowed_game: (opp?.rushingEpa || 0) / oppGp,
      def_yds_per_pass_att_allowed: oppNetPassYds / oppDropbacks,
      def_cpoe_allowed: opp && opp.cpoeAttSum > 0 ? opp.cpoeWeightedSum / opp.cpoeAttSum : 0,
      def_explosive_pass_allowed_game: (opp?.passing20 || 0) / oppGp,
      def_yds_per_carry_allowed: (opp?.rushingYards || 0) / oppCarries,
      def_rush_1d_rate_allowed: opp && opp.carries > 0 ? (opp.rushingFirstDowns / opp.carries) * 100 : 0,
      def_explosive_rush_allowed_game: (opp?.rushing10 || 0) / oppGp,
      def_explosive_plays_allowed_game: defExplosivePlaysGm,
      def_sack_rate: (defSacks / Math.max(1, (opp?.attempts || 0) + defSacks)) * 100,
      def_sacks_game: defSacks / gp,
      def_tfl_game: defTfl / gp,
      def_third_down_pct_allowed: defThirdDownPctAllowed,
      def_red_zone_td_pct_allowed: defRedZoneTdPctAllowed,

      // Special Teams
      st_fg_pct: fgPct,
      st_punt_net_avg: puntNetAvg,
      st_kr_avg: krAvg,
      st_pr_avg: prAvg,
      st_fg_50_plus_made: fg50PlusMade,
      st_punt_in20_pct: puntIn20Pct,
      st_opp_kr_avg: oppKrAvg,
      st_opp_pr_avg: oppPrAvg,

      // Margin & Overview
      margin_turnover_diff: turnoverDiff,
      margin_turnover_diff_game: turnoverDiff / gp,
      margin_pt_diff_game: ptDiff / gp,
      margin_net_epa_play: offEpaPlay - defEpaPlayAllowed,
      def_takeaways_game: takeaways / gp,
      margin_giveaways_game: giveaways / gp,
      margin_yds_diff_game: offTotalYdsGm - defTotalYdsGm,
      margin_explosive_diff_game: offExplosivePlaysGm - defExplosivePlaysGm,
      margin_pen_yds_game: safeNum(reg.penalty_yards) / gp
    });
  }

  // Helper to min-max normalize a metric across all 32 teams into [0, 100]
  function normalizeMetric0To100(metricKey, higherIsBetter) {
    const vals = allTeamAbbrs.map(tm => rawMetricsByTeam.get(tm)?.[metricKey] ?? 0);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const span = maxV - minV;
    const out = new Map();
    for (const tm of allTeamAbbrs) {
      const v = rawMetricsByTeam.get(tm)?.[metricKey] ?? 0;
      if (span <= 1e-9) {
        out.set(tm, 50);
      } else {
        const pct = higherIsBetter ? ((v - minV) / span) * 100 : ((maxV - v) / span) * 100;
        out.set(tm, pct);
      }
    }
    return out;
  }

  // Compute composite 0–100 scores for each of the 4 units
  for (const unit of TEAM_STAT_UNITS_SCHEMA) {
    const compNormMaps = unit.compositeWeights.map(w => ({
      weight: w.weight,
      normMap: normalizeMetric0To100(w.key, w.higherIsBetter)
    }));
    for (const tm of allTeamAbbrs) {
      let score = 0;
      for (const { weight, normMap } of compNormMaps) {
        score += (normMap.get(tm) ?? 50) * weight;
      }
      rawMetricsByTeam.get(tm)[unit.overallKey] = Number(score.toFixed(1));
    }
  }

  function buildMetricRankingObject(metricDef, unitTitle = '') {
    const { key, label, higherIsBetter, format } = metricDef;
    const entries = allTeamAbbrs.map(tm => {
      const raw = rawMetricsByTeam.get(tm)?.[key] ?? 0;
      const tiebreaker =
        key === 'margin_turnover_diff' ? rawMetricsByTeam.get(tm)?.margin_turnover_diff_game ?? 0 : 0;
      return {
        team: tm,
        val: Number(raw.toFixed(4)),
        tiebreaker,
        disp: format(raw)
      };
    });

    entries.sort((a, b) => {
      const primary = higherIsBetter ? b.val - a.val : a.val - b.val;
      if (Math.abs(primary) > 1e-9) return primary;
      const tb = higherIsBetter ? b.tiebreaker - a.tiebreaker : a.tiebreaker - b.tiebreaker;
      if (Math.abs(tb) > 1e-9) return tb;
      return a.team.localeCompare(b.team);
    });

    const leaderboard = entries.map((e, idx) => ({
      team: e.team,
      rank: idx + 1,
      val: e.val,
      disp: e.disp
    }));

    const sfEntry = leaderboard.find(x => x.team === 'SF') || leaderboard[15];
    const leagueAvgRaw = entries.reduce((acc, x) => acc + x.val, 0) / Math.max(1, entries.length);
    const leagueAvgDisplay = key === 'margin_turnover_diff' ? '0.0' : format(leagueAvgRaw);

    return {
      key,
      label,
      unitTitle,
      higherIsBetter,
      rank: sfEntry.rank,
      value: sfEntry.val,
      displayValue: sfEntry.disp,
      leagueAvg: Number(leagueAvgRaw.toFixed(4)),
      leagueAvgDisplay,
      leaderboard
    };
  }

  const flatByKey = {};
  const unitsOutput = TEAM_STAT_UNITS_SCHEMA.map(unit => {
    const overallMetric = buildMetricRankingObject(
      {
        key: unit.overallKey,
        label: unit.overallLabel,
        higherIsBetter: true,
        format: v => `${safeNum(v).toFixed(1)} idx`
      },
      unit.title
    );
    flatByKey[unit.overallKey] = overallMetric;

    const coreRows = unit.coreMetrics.map(m => {
      const built = buildMetricRankingObject(m, unit.title);
      flatByKey[m.key] = built;
      return built;
    });

    const expandedGroups = unit.expandedGroups.map(grp => ({
      groupTitle: grp.groupTitle,
      rows: grp.metrics.map(m => {
        const built = buildMetricRankingObject(m, `${unit.title} • ${grp.groupTitle}`);
        flatByKey[m.key] = built;
        return built;
      })
    }));

    return {
      id: unit.id,
      title: unit.title,
      shortLabel: unit.shortLabel,
      icon: unit.icon,
      jargonKey: unit.jargonKey,
      overall: overallMetric,
      coreRows,
      expandedGroups
    };
  });

  // Preserve & enrich backward-compatible top-level `teamStatRankings` array
  const legacySummaryKeys = [
    'off_pts_game',
    'def_pts_allowed_game',
    'margin_turnover_diff',
    'total_off_epa_game',
    'passing_epa_game',
    'passing_cpoe',
    'rushing_epa_game',
    'yards_per_pass_att',
    'sack_rate_allowed',
    'explosive_plays_game',
    'rush_yds_game',
    'def_sacks_game',
    'def_tfl_game',
    'def_takeaways_game'
  ];

  const teamStatRankings = legacySummaryKeys
    .map(k => flatByKey[k])
    .filter(Boolean)
    .map(m => ({
      key: m.key,
      label: m.label,
      rank: m.rank,
      displayValue: m.displayValue,
      leagueAvgDisplay: m.leagueAvgDisplay
    }));

  return {
    teamStats: {
      seasonYear,
      teams: teamsMeta,
      units: unitsOutput,
      flatByKey
    },
    teamStatRankings
  };
}

/**
 * Classify any NFL player into a true NFL position peer group:
 * QB, RB, WR, TE, EDGE, IDL, LB, CB, S, OL, K, P, LS
 */
export function normalizePositionalPeerGroup(rawPos = '', nflMeta = null) {
  const p = String(rawPos || nflMeta?.position || '').toUpperCase().trim();
  const pff = String(nflMeta?.pff_position || '').toUpperCase().trim();
  const ngs = String(nflMeta?.ngs_position || '').toUpperCase().trim();

  if (p === 'QB' || pff === 'QB') return 'QB';
  if (p === 'RB' || p === 'FB' || p === 'HB' || pff === 'HB' || pff === 'FB') return 'RB';
  if (p === 'WR' || pff === 'WR') return 'WR';
  if (p === 'TE' || pff === 'TE') return 'TE';
  if (['OT', 'T'].includes(p) || pff === 'T') return 'OT';
  if (['G', 'OG', 'C', 'OL'].includes(p) || ['G', 'C'].includes(pff)) return 'IOL';
  if (p === 'K' || p === 'PK' || pff === 'K') return 'K';
  if (p === 'P' || pff === 'P') return 'P';
  if (p === 'LS' || pff === 'LS') return 'LS';

  // Defensive Front & Linebackers (distinguish 3-4 OLB Edge Rushers from Off-Ball LBs)
  if (p === 'DE' || p === 'EDGE' || pff === 'ED' || ngs === 'EDGE') return 'EDGE';
  if (['DT', 'NT', 'DL'].includes(p) || pff === 'DI' || ngs === 'DT' || ngs === 'NT') return 'IDL';
  if (p === 'OLB') {
    if (pff === 'ED' || ngs === 'EDGE') return 'EDGE';
    return 'LB';
  }
  if (['LB', 'ILB', 'MLB', 'LLB', 'RLB'].includes(p) || pff === 'LB' || ngs === 'LB') return 'LB';

  // Secondary (distinguish Cornerbacks from Safeties)
  if (p === 'CB' || pff === 'CB' || ngs === 'CB' || ngs === 'SCB') return 'CB';
  if (['S', 'FS', 'SS', 'SAF', 'DB'].includes(p) || pff === 'S' || ngs === 'S') return 'S';

  return 'WR';
}

export const PEER_GROUP_LABELS = {
  QB: 'Quarterbacks',
  RB: 'Running Backs',
  WR: 'Wide Receivers',
  TE: 'Tight Ends',
  EDGE: 'Edge Rushers (DE/EDGE)',
  IDL: 'Interior DL (DT/NT)',
  LB: 'Off-Ball Linebackers',
  CB: 'Cornerbacks',
  S: 'Safeties',
  OT: 'Offensive Tackles',
  IOL: 'Interior O-Line (G/C)',
  OL: 'Offensive Linemen',
  K: 'Kickers',
  P: 'Punters',
  LS: 'Long Snappers'
};

/**
 * Position-specific metric definitions (Core Tier + Expandable Advanced Drawer).
 * Every metric is a clean single-stat row (no multi-stat jammed boxes) merging
 * nflverse box/EPA, NextGen Stats, PFR Advanced, and Snap Counts.
 */
export const POSITIONAL_METRIC_TEMPLATES = {
  QB: {
    primaryTitle: 'Passing & Quarterback Efficiency',
    core: [
      { key: 'pass_yds_game', label: 'Passing Yards / Game', higherIsBetter: true, qual: 'qb_att', format: v => fmtPlain(v, 1, ' yds'), extract: u => (u.games > 0 ? u.passYds / u.games : null) },
      { key: 'pass_tds', label: 'Passing Touchdowns', higherIsBetter: true, qual: 'any_pass', format: v => String(Math.round(v)), extract: u => u.passTds },
      { key: 'pass_ints', label: 'Interceptions Thrown', higherIsBetter: false, qual: 'qb_att', format: v => String(Math.round(v)), extract: u => u.passInts },
      { key: 'pass_epa_total', label: 'Passing EPA', higherIsBetter: true, qual: 'any_pass', format: v => fmtSigned(v, 1), extract: u => u.passEpa },
      { key: 'pass_cpoe', label: 'CPOE (Comp % Over Expected)', higherIsBetter: true, qual: 'qb_att', format: v => fmtSigned(v, 2, '%'), extract: u => u.passCpoe },
      { key: 'pass_ny_att', label: 'Net Yards / Dropback', higherIsBetter: true, qual: 'qb_att', format: v => fmtPlain(v, 2, ' yds'), extract: u => (u.passAtt + u.sacksTaken > 0 ? Math.max(0, u.passYds - u.sackYdsLostAbs) / (u.passAtt + u.sacksTaken) : null) },
      { key: 'passer_rating', label: 'Passer Rating', higherIsBetter: true, qual: 'qb_att', format: v => fmtPlain(v, 1), extract: u => u.passerRating }
    ],
    expanded: [
      { key: 'comp_pct', label: 'Completion %', higherIsBetter: true, qual: 'qb_att', format: v => fmtPlain(v, 1, '%'), extract: u => (u.passAtt > 0 ? (u.passComp / u.passAtt) * 100 : null) },
      { key: 'pass_yds_total', label: 'Total Passing Yards', higherIsBetter: true, qual: 'any_pass', format: v => String(Math.round(v)), extract: u => u.passYds },
      { key: 'sack_rate', label: 'Sack Rate Taken', higherIsBetter: false, qual: 'qb_att', format: v => fmtPlain(v, 1, '%'), extract: u => (u.passAtt + u.sacksTaken > 0 ? (u.sacksTaken / (u.passAtt + u.sacksTaken)) * 100 : null) },
      { key: 'ngs_time_to_throw', label: 'Avg Time to Throw (NGS)', higherIsBetter: false, qual: 'qb_att', format: v => fmtPlain(v, 2, 's'), extract: u => u.ngsTimeToThrow },
      { key: 'ngs_iay', label: 'Avg Intended Air Yards (aDOT)', higherIsBetter: true, qual: 'qb_att', format: v => fmtPlain(v, 2, ' yds'), extract: u => u.ngsIay },
      { key: 'ngs_aggr', label: 'Tight-Window Aggressiveness %', higherIsBetter: false, qual: 'qb_att', format: v => fmtPlain(v, 1, '%'), extract: u => u.ngsAggr },
      { key: 'pfr_bad_throw_pct', label: 'Bad Throw % (PFR)', higherIsBetter: false, qual: 'qb_att', format: v => fmtPlain(v, 1, '%'), extract: u => u.pfrBadThrowPct },
      { key: 'pfr_pressure_pct', label: 'Pressure % Faced (PFR)', higherIsBetter: false, qual: 'qb_att', format: v => fmtPlain(v, 1, '%'), extract: u => u.pfrPressurePct }
    ]
  },

  RB: {
    primaryTitle: 'Rushing & Backfield Production',
    core: [
      { key: 'rush_yds_game', label: 'Rushing Yards / Game', higherIsBetter: true, qual: 'rb_car', format: v => fmtPlain(v, 1, ' yds'), extract: u => (u.games > 0 ? u.rushYds / u.games : null) },
      { key: 'rush_yds_total', label: 'Total Rushing Yards', higherIsBetter: true, qual: 'any_rush', format: v => String(Math.round(v)), extract: u => u.rushYds },
      { key: 'rush_ypc', label: 'Yards / Carry', higherIsBetter: true, qual: 'rb_car', format: v => fmtPlain(v, 2, ' yds'), extract: u => (u.carries > 0 ? u.rushYds / u.carries : null) },
      { key: 'rush_tds', label: 'Rushing Touchdowns', higherIsBetter: true, qual: 'any_rush', format: v => String(Math.round(v)), extract: u => u.rushTds },
      { key: 'rush_epa', label: 'Rushing EPA', higherIsBetter: true, qual: 'any_rush', format: v => fmtSigned(v, 1), extract: u => u.rushEpa },
      { key: 'ngs_ryoe_att', label: 'Rush Yds Over Expected / Att (RYOE)', higherIsBetter: true, qual: 'rb_car', format: v => fmtSigned(v, 2, ' yds'), extract: u => u.ngsRyoePerAtt },
      { key: 'rush_explosive_10', label: 'Explosive Runs (10+ Yds)', higherIsBetter: true, qual: 'any_rush', format: v => String(Math.round(v)), extract: u => u.rush10Plus }
    ],
    expanded: [
      { key: 'carries', label: 'Rushing Carries', higherIsBetter: true, qual: 'any_rush', format: v => String(Math.round(v)), extract: u => u.carries },
      { key: 'pfr_yac_att', label: 'Yards After Contact / Carry', higherIsBetter: true, qual: 'rb_car', format: v => fmtPlain(v, 2, ' yds'), extract: u => u.pfrRushYacPerAtt },
      { key: 'pfr_brk_tkl', label: 'Broken Tackles Forced (Rush)', higherIsBetter: true, qual: 'any_rush', format: v => String(Math.round(v)), extract: u => u.pfrRushBrkTkl },
      { key: 'ngs_ryoe_total', label: 'Total RYOE (NGS)', higherIsBetter: true, qual: 'rb_car', format: v => fmtSigned(v, 1, ' yds'), extract: u => u.ngsRyoeTotal },
      { key: 'ngs_8box_pct', label: '8+ Defenders in Box %', higherIsBetter: true, qual: 'rb_car', format: v => fmtPlain(v, 1, '%'), extract: u => u.ngsStackedBoxPct },
      { key: 'rush_1d', label: 'Rushing 1st Downs', higherIsBetter: true, qual: 'any_rush', format: v => String(Math.round(v)), extract: u => u.rushFirstDowns },
      { key: 'fumbles_lost', label: 'Fumbles Lost', higherIsBetter: false, qual: 'rb_car', format: v => String(Math.round(v)), extract: u => u.fumblesLost }
    ]
  },

  WR: {
    primaryTitle: 'Receiving & Route Efficiency',
    core: [
      { key: 'rec_yds_game', label: 'Receiving Yards / Game', higherIsBetter: true, qual: 'wr_tgt', format: v => fmtPlain(v, 1, ' yds'), extract: u => (u.games > 0 ? u.recYds / u.games : null) },
      { key: 'rec_total', label: 'Receptions', higherIsBetter: true, qual: 'any_rec', format: v => String(Math.round(v)), extract: u => u.receptions },
      { key: 'rec_yds_total', label: 'Total Receiving Yards', higherIsBetter: true, qual: 'any_rec', format: v => String(Math.round(v)), extract: u => u.recYds },
      { key: 'rec_tds', label: 'Receiving Touchdowns', higherIsBetter: true, qual: 'any_rec', format: v => String(Math.round(v)), extract: u => u.recTds },
      { key: 'rec_epa', label: 'Receiving EPA', higherIsBetter: true, qual: 'any_rec', format: v => fmtSigned(v, 1), extract: u => u.recEpa },
      { key: 'tgt_share', label: 'Target Share %', higherIsBetter: true, qual: 'wr_tgt', format: v => fmtPlain(v, 1, '%'), extract: u => u.targetSharePct },
      { key: 'yds_per_tgt', label: 'Yards / Target', higherIsBetter: true, qual: 'wr_tgt', format: v => fmtPlain(v, 2, ' yds'), extract: u => (u.targets > 0 ? u.recYds / u.targets : null) }
    ],
    expanded: [
      { key: 'catch_pct', label: 'Catch %', higherIsBetter: true, qual: 'wr_tgt', format: v => fmtPlain(v, 1, '%'), extract: u => (u.targets > 0 ? (u.receptions / u.targets) * 100 : null) },
      { key: 'ngs_sep', label: 'Avg Route Separation (NGS)', higherIsBetter: true, qual: 'wr_tgt', format: v => fmtPlain(v, 2, ' yds'), extract: u => u.ngsSeparation },
      { key: 'ngs_yac_oe', label: 'YAC Above Expectation (NGS)', higherIsBetter: true, qual: 'wr_tgt', format: v => fmtSigned(v, 2, ' yds'), extract: u => u.ngsYacAboveExp },
      { key: 'yac_per_rec', label: 'Yards After Catch / Rec', higherIsBetter: true, qual: 'wr_tgt', format: v => fmtPlain(v, 2, ' yds'), extract: u => (u.receptions > 0 ? u.recYac / u.receptions : null) },
      { key: 'wopr', label: 'WOPR (Weighted Opportunity)', higherIsBetter: true, qual: 'wr_tgt', format: v => fmtPlain(v, 2), extract: u => u.wopr },
      { key: 'adot', label: 'Avg Depth of Target (aDOT)', higherIsBetter: true, qual: 'wr_tgt', format: v => fmtPlain(v, 1, ' yds'), extract: u => u.adot },
      { key: 'rec_1d', label: 'Receiving 1st Downs', higherIsBetter: true, qual: 'any_rec', format: v => String(Math.round(v)), extract: u => u.recFirstDowns },
      { key: 'pfr_drop_pct', label: 'Drop % (PFR)', higherIsBetter: false, qual: 'wr_tgt', format: v => fmtPlain(v, 1, '%'), extract: u => u.pfrDropPct }
    ]
  },

  TE: {
    primaryTitle: 'Tight End Receiving & Efficiency',
    core: [
      { key: 'rec_yds_game', label: 'Receiving Yards / Game', higherIsBetter: true, qual: 'te_tgt', format: v => fmtPlain(v, 1, ' yds'), extract: u => (u.games > 0 ? u.recYds / u.games : null) },
      { key: 'rec_total', label: 'Receptions', higherIsBetter: true, qual: 'any_rec', format: v => String(Math.round(v)), extract: u => u.receptions },
      { key: 'rec_yds_total', label: 'Total Receiving Yards', higherIsBetter: true, qual: 'any_rec', format: v => String(Math.round(v)), extract: u => u.recYds },
      { key: 'rec_tds', label: 'Receiving Touchdowns', higherIsBetter: true, qual: 'any_rec', format: v => String(Math.round(v)), extract: u => u.recTds },
      { key: 'rec_epa', label: 'Receiving EPA', higherIsBetter: true, qual: 'any_rec', format: v => fmtSigned(v, 1), extract: u => u.recEpa },
      { key: 'yds_per_tgt', label: 'Yards / Target', higherIsBetter: true, qual: 'te_tgt', format: v => fmtPlain(v, 2, ' yds'), extract: u => (u.targets > 0 ? u.recYds / u.targets : null) },
      { key: 'yac_per_rec', label: 'Yards After Catch / Rec', higherIsBetter: true, qual: 'te_tgt', format: v => fmtPlain(v, 2, ' yds'), extract: u => (u.receptions > 0 ? u.recYac / u.receptions : null) }
    ],
    expanded: [
      { key: 'catch_pct', label: 'Catch %', higherIsBetter: true, qual: 'te_tgt', format: v => fmtPlain(v, 1, '%'), extract: u => (u.targets > 0 ? (u.receptions / u.targets) * 100 : null) },
      { key: 'tgt_share', label: 'Target Share %', higherIsBetter: true, qual: 'te_tgt', format: v => fmtPlain(v, 1, '%'), extract: u => u.targetSharePct },
      { key: 'ngs_sep', label: 'Avg Route Separation (NGS)', higherIsBetter: true, qual: 'te_tgt', format: v => fmtPlain(v, 2, ' yds'), extract: u => u.ngsSeparation },
      { key: 'ngs_yac_oe', label: 'YAC Above Expectation (NGS)', higherIsBetter: true, qual: 'te_tgt', format: v => fmtSigned(v, 2, ' yds'), extract: u => u.ngsYacAboveExp },
      { key: 'adot', label: 'Avg Depth of Target (aDOT)', higherIsBetter: true, qual: 'te_tgt', format: v => fmtPlain(v, 1, ' yds'), extract: u => u.adot },
      { key: 'rec_1d', label: 'Receiving 1st Downs', higherIsBetter: true, qual: 'any_rec', format: v => String(Math.round(v)), extract: u => u.recFirstDowns },
      { key: 'off_snap_pct', label: 'Offensive Snap Share %', higherIsBetter: true, qual: 'any_snap', format: v => fmtPlain(v, 1, '%'), extract: u => u.offSnapPct }
    ]
  },

  EDGE: {
    primaryTitle: 'Edge Pass Rush & Run Disruption',
    core: [
      { key: 'def_sacks', label: 'Sacks', higherIsBetter: true, qual: 'any_def', format: v => fmtPlain(v, 1), extract: u => u.sacks },
      { key: 'pfr_pressures', label: 'Total QB Pressures (PFR)', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.pfrPressures },
      { key: 'def_qb_hits', label: 'QB Hits', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.qbHits },
      { key: 'def_tfl', label: 'Tackles For Loss (TFL)', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.tfl },
      { key: 'def_tackles_total', label: 'Total Tackles', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.totalTackles },
      { key: 'def_ff', label: 'Forced Fumbles', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.forcedFumbles }
    ],
    expanded: [
      { key: 'pfr_hurries', label: 'QB Hurries (PFR)', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.pfrHurries },
      { key: 'pressure_per_game', label: 'Pressures / Game', higherIsBetter: true, qual: 'front_snaps', format: v => fmtPlain(v, 2), extract: u => (u.games > 0 && u.pfrPressures != null ? u.pfrPressures / u.games : null) },
      { key: 'def_solo', label: 'Solo Tackles', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.soloTackles },
      { key: 'def_pd', label: 'Passes Defended / Bats', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.passDefended },
      { key: 'pfr_mtkl_pct', label: 'Missed Tackle % (PFR)', higherIsBetter: false, qual: 'front_snaps', format: v => fmtPlain(v, 1, '%'), extract: u => u.pfrMissedTacklePct },
      { key: 'def_snap_pct', label: 'Defensive Snap Share %', higherIsBetter: true, qual: 'any_def', format: v => fmtPlain(v, 1, '%'), extract: u => u.defSnapPct }
    ]
  },

  IDL: {
    primaryTitle: 'Interior Trench Disruption & Run Defense',
    core: [
      { key: 'def_sacks', label: 'Sacks', higherIsBetter: true, qual: 'any_def', format: v => fmtPlain(v, 1), extract: u => u.sacks },
      { key: 'pfr_pressures', label: 'Interior QB Pressures (PFR)', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.pfrPressures },
      { key: 'def_qb_hits', label: 'QB Hits', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.qbHits },
      { key: 'def_tfl', label: 'Tackles For Loss (TFL)', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.tfl },
      { key: 'def_tackles_total', label: 'Total Tackles', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.totalTackles },
      { key: 'def_solo', label: 'Solo Tackles', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.soloTackles }
    ],
    expanded: [
      { key: 'pfr_hurries', label: 'QB Hurries (PFR)', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.pfrHurries },
      { key: 'pressure_per_game', label: 'Pressures / Game', higherIsBetter: true, qual: 'front_snaps', format: v => fmtPlain(v, 2), extract: u => (u.games > 0 && u.pfrPressures != null ? u.pfrPressures / u.games : null) },
      { key: 'def_ff', label: 'Forced Fumbles', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.forcedFumbles },
      { key: 'def_pd', label: 'Batted Passes / PD', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.passDefended },
      { key: 'pfr_mtkl_pct', label: 'Missed Tackle % (PFR)', higherIsBetter: false, qual: 'front_snaps', format: v => fmtPlain(v, 1, '%'), extract: u => u.pfrMissedTacklePct },
      { key: 'def_snap_pct', label: 'Defensive Snap Share %', higherIsBetter: true, qual: 'any_def', format: v => fmtPlain(v, 1, '%'), extract: u => u.defSnapPct }
    ]
  },

  LB: {
    primaryTitle: 'Linebacker Tackling, Coverage & Blitz',
    core: [
      { key: 'def_tackles_total', label: 'Total Tackles', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.totalTackles },
      { key: 'def_solo', label: 'Solo Tackles', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.soloTackles },
      { key: 'def_tfl', label: 'Tackles For Loss (TFL)', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.tfl },
      { key: 'pfr_rat_allowed', label: 'Passer Rating Allowed', higherIsBetter: false, qual: 'cov_tgt', format: v => fmtPlain(v, 1), extract: u => u.pfrRatingAllowed },
      { key: 'def_pd', label: 'Passes Defended', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.passDefended },
      { key: 'def_ints', label: 'Interceptions', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.ints },
      { key: 'def_sacks', label: 'Sacks', higherIsBetter: true, qual: 'any_def', format: v => fmtPlain(v, 1), extract: u => u.sacks }
    ],
    expanded: [
      { key: 'pfr_cmp_pct_allowed', label: 'Completion % Allowed', higherIsBetter: false, qual: 'cov_tgt', format: v => fmtPlain(v, 1, '%'), extract: u => u.pfrCmpPctAllowed },
      { key: 'pfr_yds_tgt_allowed', label: 'Yards / Target Allowed', higherIsBetter: false, qual: 'cov_tgt', format: v => fmtPlain(v, 2, ' yds'), extract: u => u.pfrYdsPerTgtAllowed },
      { key: 'pfr_pressures', label: 'Blitz Pressures (PFR)', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.pfrPressures },
      { key: 'def_ff', label: 'Forced Fumbles', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.forcedFumbles },
      { key: 'pfr_mtkl_pct', label: 'Missed Tackle % (PFR)', higherIsBetter: false, qual: 'front_snaps', format: v => fmtPlain(v, 1, '%'), extract: u => u.pfrMissedTacklePct },
      { key: 'def_snap_pct', label: 'Defensive Snap Share %', higherIsBetter: true, qual: 'any_def', format: v => fmtPlain(v, 1, '%'), extract: u => u.defSnapPct }
    ]
  },

  CB: {
    primaryTitle: 'Cornerback Coverage & Ball Production',
    core: [
      { key: 'pfr_rat_allowed', label: 'Passer Rating Allowed', higherIsBetter: false, qual: 'cov_tgt', format: v => fmtPlain(v, 1), extract: u => u.pfrRatingAllowed },
      { key: 'pfr_cmp_pct_allowed', label: 'Completion % Allowed', higherIsBetter: false, qual: 'cov_tgt', format: v => fmtPlain(v, 1, '%'), extract: u => u.pfrCmpPctAllowed },
      { key: 'pfr_yds_tgt_allowed', label: 'Yards / Target Allowed', higherIsBetter: false, qual: 'cov_tgt', format: v => fmtPlain(v, 2, ' yds'), extract: u => u.pfrYdsPerTgtAllowed },
      { key: 'def_ints', label: 'Interceptions', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.ints },
      { key: 'def_pd', label: 'Passes Defended (PBUs)', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.passDefended },
      { key: 'def_tackles_total', label: 'Total Tackles', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.totalTackles }
    ],
    expanded: [
      { key: 'pfr_tgts_allowed', label: 'Targets Faced in Coverage', higherIsBetter: false, qual: 'cov_tgt', format: v => String(Math.round(v)), extract: u => u.pfrTargetsAllowed },
      { key: 'pfr_dadot', label: 'Avg Depth of Target (dADOT)', higherIsBetter: true, qual: 'cov_tgt', format: v => fmtPlain(v, 1, ' yds'), extract: u => u.pfrDadot },
      { key: 'def_solo', label: 'Solo Tackles', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.soloTackles },
      { key: 'def_tfl', label: 'Tackles For Loss (TFL)', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.tfl },
      { key: 'pfr_mtkl_pct', label: 'Missed Tackle % (PFR)', higherIsBetter: false, qual: 'cov_tgt', format: v => fmtPlain(v, 1, '%'), extract: u => u.pfrMissedTacklePct },
      { key: 'def_snap_pct', label: 'Defensive Snap Share %', higherIsBetter: true, qual: 'any_def', format: v => fmtPlain(v, 1, '%'), extract: u => u.defSnapPct }
    ]
  },

  S: {
    primaryTitle: 'Safety Coverage, Range & Run Support',
    core: [
      { key: 'pfr_rat_allowed', label: 'Passer Rating Allowed', higherIsBetter: false, qual: 'cov_tgt', format: v => fmtPlain(v, 1), extract: u => u.pfrRatingAllowed },
      { key: 'pfr_cmp_pct_allowed', label: 'Completion % Allowed', higherIsBetter: false, qual: 'cov_tgt', format: v => fmtPlain(v, 1, '%'), extract: u => u.pfrCmpPctAllowed },
      { key: 'def_ints', label: 'Interceptions', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.ints },
      { key: 'def_pd', label: 'Passes Defended', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.passDefended },
      { key: 'def_tackles_total', label: 'Total Tackles', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.totalTackles },
      { key: 'def_solo', label: 'Solo Tackles', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.soloTackles }
    ],
    expanded: [
      { key: 'pfr_yds_tgt_allowed', label: 'Yards / Target Allowed', higherIsBetter: false, qual: 'cov_tgt', format: v => fmtPlain(v, 2, ' yds'), extract: u => u.pfrYdsPerTgtAllowed },
      { key: 'pfr_dadot', label: 'Avg Depth of Target (dADOT)', higherIsBetter: true, qual: 'cov_tgt', format: v => fmtPlain(v, 1, ' yds'), extract: u => u.pfrDadot },
      { key: 'def_tfl', label: 'Tackles For Loss (TFL)', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.tfl },
      { key: 'pfr_pressures', label: 'Box / Blitz Pressures', higherIsBetter: true, qual: 'any_def', format: v => String(Math.round(v)), extract: u => u.pfrPressures },
      { key: 'pfr_mtkl_pct', label: 'Missed Tackle % (PFR)', higherIsBetter: false, qual: 'front_snaps', format: v => fmtPlain(v, 1, '%'), extract: u => u.pfrMissedTacklePct },
      { key: 'def_snap_pct', label: 'Defensive Snap Share %', higherIsBetter: true, qual: 'any_def', format: v => fmtPlain(v, 1, '%'), extract: u => u.defSnapPct }
    ]
  },

  OT: {
    primaryTitle: 'Offensive Tackle Accountability & Snap Share',
    core: [
      { key: 'off_snap_pct', label: 'Offensive Snap Share %', higherIsBetter: true, qual: 'ol_games', format: v => fmtPlain(v, 1, '%'), extract: u => u.offSnapPct },
      { key: 'off_snaps_game', label: 'Offensive Snaps / Game', higherIsBetter: true, qual: 'ol_games', format: v => fmtPlain(v, 1), extract: u => ((u.snapGames || u.games) > 0 ? u.offSnaps / (u.snapGames || u.games) : null) },
      { key: 'off_snaps', label: 'Total Offensive Snaps', higherIsBetter: true, qual: 'ol_games', format: v => String(Math.round(v)), extract: u => u.offSnaps },
      { key: 'snap_games', label: 'Active Games Logged', higherIsBetter: true, qual: 'any_snap', format: v => String(Math.round(v)), extract: u => u.snapGames || u.games }
    ],
    expanded: [
      { key: 'st_snaps', label: 'Special Teams Snaps', higherIsBetter: true, qual: 'any_snap', format: v => String(Math.round(v)), extract: u => u.stSnaps }
    ]
  },

  IOL: {
    primaryTitle: 'Interior O-Line Accountability & Snap Share',
    core: [
      { key: 'off_snap_pct', label: 'Offensive Snap Share %', higherIsBetter: true, qual: 'ol_games', format: v => fmtPlain(v, 1, '%'), extract: u => u.offSnapPct },
      { key: 'off_snaps_game', label: 'Offensive Snaps / Game', higherIsBetter: true, qual: 'ol_games', format: v => fmtPlain(v, 1), extract: u => ((u.snapGames || u.games) > 0 ? u.offSnaps / (u.snapGames || u.games) : null) },
      { key: 'off_snaps', label: 'Total Offensive Snaps', higherIsBetter: true, qual: 'ol_games', format: v => String(Math.round(v)), extract: u => u.offSnaps },
      { key: 'snap_games', label: 'Active Games Logged', higherIsBetter: true, qual: 'any_snap', format: v => String(Math.round(v)), extract: u => u.snapGames || u.games }
    ],
    expanded: [
      { key: 'st_snaps', label: 'Special Teams Snaps', higherIsBetter: true, qual: 'any_snap', format: v => String(Math.round(v)), extract: u => u.stSnaps }
    ]
  },

  K: {
    primaryTitle: 'Placekicking Accuracy & Range',
    core: [
      { key: 'fg_pct', label: 'Field Goal %', higherIsBetter: true, qual: 'k_att', format: v => fmtPlain(v, 1, '%'), extract: u => (u.fgAtt > 0 ? (u.fgMade / u.fgAtt) * 100 : null) },
      { key: 'fg_made', label: 'Field Goals Made', higherIsBetter: true, qual: 'any_kick', format: v => String(Math.round(v)), extract: u => u.fgMade },
      { key: 'fg_long', label: 'Longest Field Goal', higherIsBetter: true, qual: 'any_kick', format: v => fmtPlain(v, 0, ' yds'), extract: u => u.fgLong },
      { key: 'fg_50_plus', label: '50+ Yard Field Goals Made', higherIsBetter: true, qual: 'any_kick', format: v => String(Math.round(v)), extract: u => u.fg50PlusMade },
      { key: 'pat_pct', label: 'Extra Point (PAT) %', higherIsBetter: true, qual: 'any_kick', format: v => fmtPlain(v, 1, '%'), extract: u => (u.patAtt > 0 ? (u.patMade / u.patAtt) * 100 : null) }
    ],
    expanded: [
      { key: 'fg_att', label: 'Field Goal Attempts', higherIsBetter: true, qual: 'any_kick', format: v => String(Math.round(v)), extract: u => u.fgAtt },
      { key: 'pat_made', label: 'Extra Points Made', higherIsBetter: true, qual: 'any_kick', format: v => String(Math.round(v)), extract: u => u.patMade }
    ]
  },

  P: {
    primaryTitle: 'Punting Field Position & Directional Control',
    core: [
      { key: 'punt_gross_avg', label: 'Gross Punt Average', higherIsBetter: true, qual: 'p_att', format: v => fmtPlain(v, 1, ' yds'), extract: u => (u.punts > 0 ? u.puntYds / u.punts : null) },
      { key: 'punt_net_avg', label: 'Net Punt Average', higherIsBetter: true, qual: 'p_att', format: v => fmtPlain(v, 1, ' yds'), extract: u => (u.punts > 0 ? u.puntNetYds / u.punts : null) },
      { key: 'punt_in20', label: 'Punts Inside 20', higherIsBetter: true, qual: 'any_punt', format: v => String(Math.round(v)), extract: u => u.puntIn20 },
      { key: 'punt_in20_pct', label: 'Inside-20 %', higherIsBetter: true, qual: 'p_att', format: v => fmtPlain(v, 1, '%'), extract: u => (u.punts > 0 ? (u.puntIn20 / u.punts) * 100 : null) }
    ],
    expanded: [
      { key: 'punts', label: 'Total Punts', higherIsBetter: true, qual: 'any_punt', format: v => String(Math.round(v)), extract: u => u.punts },
      { key: 'punt_long', label: 'Longest Punt', higherIsBetter: true, qual: 'any_punt', format: v => fmtPlain(v, 0, ' yds'), extract: u => u.puntLong }
    ]
  },

  LS: {
    primaryTitle: 'Special Teams Operation & Availability',
    core: [
      { key: 'st_snaps', label: 'Special Teams Snaps', higherIsBetter: true, qual: 'any_snap', format: v => String(Math.round(v)), extract: u => u.stSnaps },
      { key: 'st_snap_pct', label: 'Special Teams Snap Share %', higherIsBetter: true, qual: 'any_snap', format: v => fmtPlain(v, 1, '%'), extract: u => u.stSnapPct },
      { key: 'snap_games', label: 'Active Games Logged', higherIsBetter: true, qual: 'any_snap', format: v => String(Math.round(v)), extract: u => u.snapGames || u.games }
    ],
    expanded: []
  }
};

export const SECONDARY_ROLE_TEMPLATES = {
  RB_RECEIVING: {
    id: 'rb_receiving',
    title: 'Receiving & Mismatch Role (vs. NFL RBs)',
    peerGroup: 'RB',
    metrics: [
      { key: 'rb_rec_total', label: 'Receptions', higherIsBetter: true, qual: 'any_rec', format: v => String(Math.round(v)), extract: u => u.receptions },
      { key: 'rb_rec_yds_game', label: 'Receiving Yards / Game', higherIsBetter: true, qual: 'rb_tgt', format: v => fmtPlain(v, 1, ' yds'), extract: u => (u.games > 0 ? u.recYds / u.games : null) },
      { key: 'rb_rec_tds', label: 'Receiving Touchdowns', higherIsBetter: true, qual: 'any_rec', format: v => String(Math.round(v)), extract: u => u.recTds },
      { key: 'rb_rec_epa', label: 'Receiving EPA', higherIsBetter: true, qual: 'any_rec', format: v => fmtSigned(v, 1), extract: u => u.recEpa },
      { key: 'rb_tgt_share', label: 'Target Share %', higherIsBetter: true, qual: 'rb_tgt', format: v => fmtPlain(v, 1, '%'), extract: u => u.targetSharePct },
      { key: 'rb_yac_rec', label: 'Yards After Catch / Rec', higherIsBetter: true, qual: 'rb_tgt', format: v => fmtPlain(v, 2, ' yds'), extract: u => (u.receptions > 0 ? u.recYac / u.receptions : null) }
    ]
  },
  SKILL_RUSHING: {
    id: 'skill_rushing',
    title: 'Rushing & Mobility Production',
    metrics: [
      { key: 'sec_rush_yds_game', label: 'Rushing Yards / Game', higherIsBetter: true, qual: 'sec_rush', format: v => fmtPlain(v, 1, ' yds'), extract: u => (u.games > 0 ? u.rushYds / u.games : null) },
      { key: 'sec_carries', label: 'Rushing Carries', higherIsBetter: true, qual: 'any_rush', format: v => String(Math.round(v)), extract: u => u.carries },
      { key: 'sec_rush_ypc', label: 'Yards / Carry', higherIsBetter: true, qual: 'sec_rush', format: v => fmtPlain(v, 2, ' yds'), extract: u => (u.carries > 0 ? u.rushYds / u.carries : null) },
      { key: 'sec_rush_tds', label: 'Rushing Touchdowns', higherIsBetter: true, qual: 'any_rush', format: v => String(Math.round(v)), extract: u => u.rushTds },
      { key: 'sec_rush_epa', label: 'Rushing EPA', higherIsBetter: true, qual: 'any_rush', format: v => fmtSigned(v, 1), extract: u => u.rushEpa }
    ]
  }
};

function evaluateQualifier(qualKey, u, refGames) {
  switch (qualKey) {
    case 'qb_att':
      return { ok: u.passAtt >= Math.max(20, Math.round(refGames * 14)), label: `Min. ${Math.max(20, Math.round(refGames * 14))} Pass Att` };
    case 'any_pass':
      return { ok: u.passAtt >= Math.max(15, Math.round(refGames * 8)), label: `Min. ${Math.max(15, Math.round(refGames * 8))} Pass Att` };
    case 'rb_car':
      return { ok: u.carries >= Math.max(15, Math.round(refGames * 6)), label: `Min. ${Math.max(15, Math.round(refGames * 6))} Carries` };
    case 'rb_tgt':
      return { ok: u.targets >= Math.max(6, Math.round(refGames * 1.5)), label: `Min. ${Math.max(6, Math.round(refGames * 1.5))} Targets` };
    case 'any_rush':
      return { ok: u.carries >= Math.max(8, Math.round(refGames * 2.5)), label: `Min. ${Math.max(8, Math.round(refGames * 2.5))} Carries` };
    case 'sec_rush':
      return { ok: u.carries >= Math.max(8, Math.round(refGames * 1.2)), label: `Min. ${Math.max(8, Math.round(refGames * 1.2))} Carries` };
    case 'wr_tgt':
      return { ok: u.targets >= Math.max(12, Math.round(refGames * 2.8)), label: `Min. ${Math.max(12, Math.round(refGames * 2.8))} Targets` };
    case 'te_tgt':
      return { ok: u.targets >= Math.max(8, Math.round(refGames * 1.8)), label: `Min. ${Math.max(8, Math.round(refGames * 1.8))} Targets` };
    case 'any_rec':
      return { ok: u.targets >= Math.max(8, Math.round(refGames * 1.5)), label: `Min. ${Math.max(8, Math.round(refGames * 1.5))} Targets` };
    case 'cov_tgt':
      return { ok: (u.pfrTargetsAllowed ?? 0) >= Math.max(8, Math.round(refGames * 1.8)), label: `Min. ${Math.max(8, Math.round(refGames * 1.8))} Coverage Tgts` };
    case 'front_snaps':
      return { ok: u.defSnaps >= Math.max(50, Math.round(refGames * 18)) || u.totalTackles >= Math.max(6, refGames), label: `Min. ${Math.max(50, Math.round(refGames * 18))} Def Snaps` };
    case 'any_def':
      return { ok: u.defSnaps >= Math.max(40, Math.round(refGames * 15)) || u.totalTackles >= Math.max(5, refGames), label: `Min. ${Math.max(40, Math.round(refGames * 15))} Def Snaps` };
    case 'ol_games':
      return { ok: (u.snapGames || u.games) >= Math.max(2, Math.floor(refGames * 0.4)) && u.offSnaps >= Math.max(30, refGames * 18), label: `Min. ${Math.max(30, refGames * 18)} Off Snaps` };
    case 'any_snap':
      return { ok: u.offSnaps + u.defSnaps + u.stSnaps >= Math.max(15, refGames * 4), label: `Min. ${Math.max(15, refGames * 4)} Snaps` };
    case 'k_att':
      return { ok: u.fgAtt >= Math.max(4, Math.round(refGames * 1.0)), label: `Min. ${Math.max(4, Math.round(refGames * 1.0))} FG Att` };
    case 'any_kick':
      return { ok: u.fgAtt >= 1 || u.patAtt >= 1, label: 'Active Kickers' };
    case 'p_att':
      return { ok: u.punts >= Math.max(6, Math.round(refGames * 1.8)), label: `Min. ${Math.max(6, Math.round(refGames * 1.8))} Punts` };
    case 'any_punt':
      return { ok: u.punts >= 1, label: 'Active Punters' };
    default:
      return { ok: u.games >= 1, label: 'Active Players' };
  }
}

function normKeySimple(name = '') {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(jr\.?|sr\.?|ii|iii|iv)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Build league-wide positional leaderboards + per-49ers-player `statProfile2026`.
 */
export function computeLeaguePositionalLeaderboards({
  statsPlayerCurrent = [],
  ngsPass2026 = new Map(),
  ngsRec2026 = new Map(),
  ngsRush2026 = new Map(),
  pfrPass2026 = new Map(),
  pfrRush2026 = new Map(),
  pfrRec2026 = new Map(),
  pfrDef2026 = new Map(),
  snaps2026 = [],
  nflPlayers = [],
  rosterPlayers = [],
  teamStatsPayload = null,
  seasonYear = 2026
} = {}) {
  const nflByGsis = new Map();
  const nflByPfr = new Map();
  for (const np of nflPlayers || []) {
    if (np.gsis_id) nflByGsis.set(np.gsis_id, np);
    if (np.pfr_id) nflByPfr.set(np.pfr_id, np);
  }

  // Aggregate 2026 snap counts across ALL 32 NFL teams (deduplicated per game_id + player)
  const leagueSnapsByPfr = new Map();
  const leagueSnapsByTeamName = new Map();
  const seenSnapPlayerGames = new Set();
  for (const s of snaps2026 || []) {
    if (s.game_type && s.game_type !== 'REG') continue;
    const pfrId = String(s.pfr_player_id || '').trim();
    const tm = normalizeTeamAbbr(s.team || '');
    const nk = normKeySimple(s.player || '');
    if (!pfrId && !nk) continue;
    const key = pfrId || `${tm}:${nk}`;
    const gameDedupKey = `${key}::${s.game_id || s.week || ''}`;
    if (seenSnapPlayerGames.has(gameDedupKey)) continue;
    seenSnapPlayerGames.add(gameDedupKey);

    const cur = leagueSnapsByPfr.get(key) || {
      pfrId,
      name: s.player || '',
      pos: s.position || '',
      team: tm,
      games: 0,
      offSnaps: 0,
      offPctSum: 0,
      defSnaps: 0,
      defPctSum: 0,
      stSnaps: 0,
      stPctSum: 0
    };
    cur.games += 1;
    cur.offSnaps += safeNum(s.offense_snaps);
    cur.offPctSum += safeNum(s.offense_pct);
    cur.defSnaps += safeNum(s.defense_snaps);
    cur.defPctSum += safeNum(s.defense_pct);
    cur.stSnaps += safeNum(s.st_snaps);
    cur.stPctSum += safeNum(s.st_pct);
    cur.team = tm || cur.team;
    leagueSnapsByPfr.set(key, cur);
    if (tm && nk) leagueSnapsByTeamName.set(`${tm}:${nk}`, cur);
  }

  // Map SF roster players by gsisId, pfrId, and normName
  const sfByGsis = new Map();
  const sfByPfr = new Map();
  const sfByName = new Map();
  for (const rp of rosterPlayers || []) {
    if (rp.gsisId) sfByGsis.set(rp.gsisId, rp);
    if (rp.pfrId) sfByPfr.set(rp.pfrId, rp);
    sfByName.set(normKeySimple(rp.name), rp);
  }

  // Build unified league-wide player stat records
  const unifiedPlayers = new Map();
  let maxLeagueGames = 1;

  for (const row of statsPlayerCurrent || []) {
    if (row.season_type && row.season_type !== 'REG') continue;
    const gsisId = String(row.player_id || '').trim();
    const nflMeta = (gsisId && nflByGsis.get(gsisId)) || null;
    const pfrId = String(nflMeta?.pfr_id || '').trim();
    const team = normalizeTeamAbbr(row.recent_team || nflMeta?.latest_team || '');
    const dispName = row.player_display_name || nflMeta?.display_name || row.player_name || 'Player';
    const nk = normKeySimple(dispName);
    const sfMatch =
      (gsisId && sfByGsis.get(gsisId)) ||
      (pfrId && sfByPfr.get(pfrId)) ||
      (team === 'SF' ? sfByName.get(nk) : null) ||
      null;

    const posAbbr = sfMatch?.position || row.position || nflMeta?.position || 'WR';
    const peerGroup = normalizePositionalPeerGroup(posAbbr, nflMeta);
    const snapRec =
      (pfrId && leagueSnapsByPfr.get(pfrId)) ||
      leagueSnapsByTeamName.get(`${team}:${nk}`) ||
      null;

    const rowGp = safeNum(row.games);
    const games = Math.min(18, Math.max(rowGp <= 18 ? rowGp : 0, snapRec?.games || 0));
    if (games > maxLeagueGames && games <= 18) maxLeagueGames = games;

    const ngsP = gsisId ? ngsPass2026.get(gsisId) : null;
    const ngsRc = gsisId ? ngsRec2026.get(gsisId) : null;
    const ngsRu = gsisId ? ngsRush2026.get(gsisId) : null;
    const pfrP = pfrId ? pfrPass2026.get(pfrId) : null;
    const pfrRu = pfrId ? pfrRush2026.get(pfrId) : null;
    const pfrRc = pfrId ? pfrRec2026.get(pfrId) : null;
    const pfrD = pfrId ? pfrDef2026.get(pfrId) : null;

    const passComp = safeNum(row.completions);
    const passAtt = safeNum(row.attempts);
    const passYds = safeNum(row.passing_yards);
    const passTds = safeNum(row.passing_tds);
    const passInts = safeNum(row.passing_interceptions);
    const sacksTaken = safeNum(row.sacks_suffered);
    const targets = safeNum(row.targets);
    const recAirYds = safeNum(row.receiving_air_yards);

    const uid = sfMatch ? `sf_${sfMatch.id}` : gsisId || pfrId || `${team}_${nk}`;
    const espnId = sfMatch?.id || (nflMeta?.espn_id ? String(nflMeta.espn_id).trim() : '');

    unifiedPlayers.set(uid, {
      uid,
      sfPlayerId: sfMatch?.id || null,
      name: sfMatch?.name || dispName,
      team: sfMatch ? 'SF' : team,
      pos: posAbbr,
      peerGroup,
      headshotUrl:
        sfMatch?.headshotUrl ||
        row.headshot_url ||
        nflMeta?.headshot ||
        (/^\d+$/.test(espnId) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png` : ''),
      pfrUrl:
        sfMatch?.pfrUrl ||
        (pfrId ? `https://www.pro-football-reference.com/players/${pfrId[0]}/${pfrId}.htm` : null),
      espnUrl: sfMatch?.espnUrl || (/^\d+$/.test(espnId) ? `https://www.espn.com/nfl/player/_/id/${espnId}` : null),
      games,
      snapGames: snapRec?.games || 0,
      offSnaps: snapRec?.offSnaps ?? sfMatch?.snapSummary?.offenseSnaps ?? 0,
      offSnapPct:
        snapRec && snapRec.games > 0
          ? Number(((snapRec.offPctSum / snapRec.games) * 100).toFixed(1))
          : sfMatch?.snapSummary?.offenseSnapPct ?? 0,
      defSnaps: snapRec?.defSnaps ?? sfMatch?.snapSummary?.defenseSnaps ?? 0,
      defSnapPct:
        snapRec && snapRec.games > 0
          ? Number(((snapRec.defPctSum / snapRec.games) * 100).toFixed(1))
          : sfMatch?.snapSummary?.defenseSnapPct ?? 0,
      stSnaps: snapRec?.stSnaps ?? sfMatch?.snapSummary?.stSnaps ?? 0,
      stSnapPct:
        snapRec && snapRec.games > 0
          ? Number(((snapRec.stPctSum / snapRec.games) * 100).toFixed(1))
          : sfMatch?.snapSummary?.stSnapPct ?? 0,

      // Passing
      passComp,
      passAtt,
      passYds,
      passTds,
      passInts,
      sacksTaken,
      sackYdsLostAbs: Math.abs(safeNum(row.sack_yards_lost)),
      passEpa: row.passing_epa !== '' && row.passing_epa != null ? safeNum(row.passing_epa) : null,
      passCpoe:
        row.passing_cpoe !== '' && row.passing_cpoe != null
          ? safeNum(row.passing_cpoe)
          : ngsP?.cpoe ?? null,
      passerRating:
        ngsP?.passerRating != null && passAtt > 0
          ? ngsP.passerRating
          : passAtt > 0
            ? computeNflPasserRating(passComp, passAtt, passYds, passTds, passInts)
            : null,
      ngsTimeToThrow: ngsP?.avgTimeToThrow ?? null,
      ngsIay: ngsP?.avgIntendedAirYards ?? null,
      ngsAggr: ngsP?.aggressivenessPct ?? null,
      pfrBadThrowPct: pfrP?.badThrowPct ?? null,
      pfrPressurePct: pfrP?.pressurePct ?? null,

      // Rushing
      carries: safeNum(row.carries),
      rushYds: safeNum(row.rushing_yards),
      rushTds: safeNum(row.rushing_tds),
      rushEpa: row.rushing_epa !== '' && row.rushing_epa != null ? safeNum(row.rushing_epa) : null,
      rush10Plus: safeNum(row.rushing_10),
      rushFirstDowns: safeNum(row.rushing_first_downs),
      fumblesLost: safeNum(row.fumbles_lost_total || row.rushing_fumbles_lost),
      ngsRyoePerAtt: ngsRu?.ryoePerAtt ?? null,
      ngsRyoeTotal: ngsRu?.ryoeTotal ?? null,
      ngsStackedBoxPct: ngsRu?.stackedBox8PlusPct ?? null,
      pfrRushYacPerAtt: pfrRu?.yacPerAtt ?? null,
      pfrRushBrkTkl: pfrRu?.brokenTackles ?? null,

      // Receiving
      receptions: safeNum(row.receptions),
      targets,
      recYds: safeNum(row.receiving_yards),
      recTds: safeNum(row.receiving_tds),
      recEpa: row.receiving_epa !== '' && row.receiving_epa != null ? safeNum(row.receiving_epa) : null,
      recYac: safeNum(row.receiving_yards_after_catch),
      recFirstDowns: safeNum(row.receiving_first_downs),
      targetSharePct:
        row.target_share !== '' && row.target_share != null ? Number((safeNum(row.target_share) * 100).toFixed(1)) : null,
      wopr: row.wopr !== '' && row.wopr != null ? safeNum(row.wopr) : null,
      adot:
        pfrRc?.adot ??
        ngsRc?.avgIntendedAirYards ??
        (targets > 0 ? Number((recAirYds / targets).toFixed(1)) : null),
      ngsSeparation: ngsRc?.avgSeparation ?? null,
      ngsYacAboveExp: ngsRc?.avgYacAboveExpectation ?? null,
      pfrDropPct: pfrRc?.dropPct ?? null,

      // Defense
      soloTackles: safeNum(row.def_tackles_solo),
      totalTackles:
        safeNum(row.def_tackles_solo) +
        safeNum(row.def_tackle_assists) +
        safeNum(row.def_tackles_with_assist),
      tfl: safeNum(row.def_tackles_for_loss),
      sacks: safeNum(row.def_sacks),
      qbHits: safeNum(row.def_qb_hits),
      ints: safeNum(row.def_interceptions),
      passDefended: safeNum(row.def_pass_defended),
      forcedFumbles: safeNum(row.def_fumbles_forced),
      pfrPressures: pfrD?.pressures ?? null,
      pfrHurries: pfrD?.hurries ?? null,
      pfrTargetsAllowed: pfrD?.targetsAllowed ?? null,
      pfrCmpPctAllowed: pfrD?.completionPctAllowed ?? null,
      pfrYdsPerTgtAllowed: pfrD?.yardsPerTargetAllowed ?? null,
      pfrRatingAllowed: pfrD?.passerRatingAllowed ?? null,
      pfrDadot: pfrD?.dadot ?? null,
      pfrMissedTacklePct: pfrD?.missedTacklePct ?? null,

      // Kicking & Punting
      fgMade: safeNum(row.fg_made),
      fgAtt: safeNum(row.fg_att),
      fgLong: safeNum(row.fg_long),
      fg50PlusMade: safeNum(row.fg_made_50_59) + safeNum(row.fg_made_60_),
      patMade: safeNum(row.pat_made),
      patAtt: safeNum(row.pat_att),
      punts: safeNum(row.pt_att),
      puntYds: safeNum(row.pt_yards),
      puntNetYds: safeNum(row.pt_net_yards || row.pt_yards),
      puntIn20: safeNum(row.pt_inside_20),
      puntLong: safeNum(row.pt_long)
    });
  }

  // Add non-box-score NFL players from `snaps2026` (OL, LS, blocking TEs, DBs without box rows)
  for (const snapRec of leagueSnapsByPfr.values()) {
    const pfrId = snapRec.pfrId;
    const nflMeta = (pfrId && nflByPfr.get(pfrId)) || null;
    const nk = normKeySimple(snapRec.name);
    const sfMatch =
      (pfrId && sfByPfr.get(pfrId)) ||
      (snapRec.team === 'SF' ? sfByName.get(nk) : null) ||
      null;
    const uid = sfMatch ? `sf_${sfMatch.id}` : nflMeta?.gsis_id || pfrId || `${snapRec.team}_${nk}`;
    if (unifiedPlayers.has(uid)) continue;

    const posAbbr = sfMatch?.position || snapRec.pos || nflMeta?.position || 'OL';
    const peerGroup = normalizePositionalPeerGroup(posAbbr, nflMeta);
    const espnId = sfMatch?.id || (nflMeta?.espn_id ? String(nflMeta.espn_id).trim() : '');
    const pfrD = pfrId ? pfrDef2026.get(pfrId) : null;

    unifiedPlayers.set(uid, {
      uid,
      sfPlayerId: sfMatch?.id || null,
      name: sfMatch?.name || snapRec.name || nflMeta?.display_name || 'Player',
      team: sfMatch ? 'SF' : snapRec.team,
      pos: posAbbr,
      peerGroup,
      headshotUrl:
        sfMatch?.headshotUrl ||
        nflMeta?.headshot ||
        (/^\d+$/.test(espnId) ? `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png` : ''),
      pfrUrl:
        sfMatch?.pfrUrl ||
        (pfrId ? `https://www.pro-football-reference.com/players/${pfrId[0]}/${pfrId}.htm` : null),
      espnUrl: sfMatch?.espnUrl || (/^\d+$/.test(espnId) ? `https://www.espn.com/nfl/player/_/id/${espnId}` : null),
      games: snapRec.games,
      snapGames: snapRec.games,
      offSnaps: snapRec.offSnaps,
      offSnapPct: snapRec.games > 0 ? Number(((snapRec.offPctSum / snapRec.games) * 100).toFixed(1)) : 0,
      defSnaps: snapRec.defSnaps,
      defSnapPct: snapRec.games > 0 ? Number(((snapRec.defPctSum / snapRec.games) * 100).toFixed(1)) : 0,
      stSnaps: snapRec.stSnaps,
      stSnapPct: snapRec.games > 0 ? Number(((snapRec.stPctSum / snapRec.games) * 100).toFixed(1)) : 0,
      passComp: 0, passAtt: 0, passYds: 0, passTds: 0, passInts: 0, sacksTaken: 0, sackYdsLostAbs: 0,
      passEpa: null, passCpoe: null, passerRating: null, ngsTimeToThrow: null, ngsIay: null, ngsAggr: null,
      pfrBadThrowPct: null, pfrPressurePct: null,
      carries: 0, rushYds: 0, rushTds: 0, rushEpa: null, rush10Plus: 0, rushFirstDowns: 0, fumblesLost: 0,
      ngsRyoePerAtt: null, ngsRyoeTotal: null, ngsStackedBoxPct: null, pfrRushYacPerAtt: null, pfrRushBrkTkl: null,
      receptions: 0, targets: 0, recYds: 0, recTds: 0, recEpa: null, recYac: 0, recFirstDowns: 0,
      targetSharePct: null, wopr: null, adot: null, ngsSeparation: null, ngsYacAboveExp: null, pfrDropPct: null,
      soloTackles: 0, totalTackles: 0, tfl: 0, sacks: 0, qbHits: 0, ints: 0, passDefended: 0, forcedFumbles: 0,
      pfrPressures: pfrD?.pressures ?? null, pfrHurries: pfrD?.hurries ?? null,
      pfrTargetsAllowed: pfrD?.targetsAllowed ?? null, pfrCmpPctAllowed: pfrD?.completionPctAllowed ?? null,
      pfrYdsPerTgtAllowed: pfrD?.yardsPerTargetAllowed ?? null, pfrRatingAllowed: pfrD?.passerRatingAllowed ?? null,
      pfrDadot: pfrD?.dadot ?? null, pfrMissedTacklePct: pfrD?.missedTacklePct ?? null,
      fgMade: 0, fgAtt: 0, fgLong: 0, fg50PlusMade: 0, patMade: 0, patAtt: 0,
      punts: 0, puntYds: 0, puntNetYds: 0, puntIn20: 0, puntLong: 0
    });
  }

  const playersByPeerGroup = new Map();
  for (const u of unifiedPlayers.values()) {
    if (!playersByPeerGroup.has(u.peerGroup)) playersByPeerGroup.set(u.peerGroup, []);
    playersByPeerGroup.get(u.peerGroup).push(u);
  }

  const positionalLeaderboards = {};
  const peerDirectory = {};
  const fullPoolCache = new Map();

  function registerPeerDirectoryEntry(u) {
    if (!peerDirectory[u.uid]) {
      peerDirectory[u.uid] = {
        name: u.name,
        team: u.team,
        pos: u.pos,
        headshotUrl: u.headshotUrl || '',
        pfrUrl: u.pfrUrl || null,
        espnUrl: u.espnUrl || null,
        sfPlayerId: u.sfPlayerId || null
      };
    }
  }

  function ensureMetricLeaderboard(peerGroup, metricDef) {
    const lbKey = `${peerGroup}:${metricDef.key}`;
    if (fullPoolCache.has(lbKey)) return fullPoolCache.get(lbKey);

    const groupPool = playersByPeerGroup.get(peerGroup) || [];
    const qualifiedList = [];
    let qualifierNote = 'Active Players';

    for (const u of groupPool) {
      const val = metricDef.extract(u);
      if (val === null || val === undefined || !Number.isFinite(Number(val))) continue;
      const q = evaluateQualifier(metricDef.qual, u, maxLeagueGames);
      qualifierNote = q.label;
      if (q.ok) {
        qualifiedList.push({
          uid: u.uid,
          u,
          val: Number(Number(val).toFixed(4)),
          disp: metricDef.format(val)
        });
      }
    }

    qualifiedList.sort((a, b) => {
      const d = metricDef.higherIsBetter ? b.val - a.val : a.val - b.val;
      if (Math.abs(d) > 1e-9) return d;
      return a.u.name.localeCompare(b.u.name);
    });

    const ranked = qualifiedList.map((item, idx) => ({
      uid: item.uid,
      rank: idx + 1,
      val: item.val,
      disp: item.disp,
      isSf: Boolean(item.u.sfPlayerId)
    }));

    const avgRaw =
      ranked.length > 0 ? ranked.reduce((s, x) => s + x.val, 0) / ranked.length : 0;
    const avgDisp = ranked.length > 0 ? metricDef.format(avgRaw) : '—';

    // Keep top 48 qualified peers PLUS any qualified SF teammates so modal stays compact & fast
    const storedRows = ranked.filter((r, idx) => idx < 48 || r.isSf);
    for (const r of storedRows) {
      const uObj = unifiedPlayers.get(r.uid);
      if (uObj) registerPeerDirectoryEntry(uObj);
    }

    const lbPayload = {
      key: lbKey,
      peerGroup,
      peerGroupLabel: PEER_GROUP_LABELS[peerGroup] || peerGroup,
      label: metricDef.label,
      higherIsBetter: metricDef.higherIsBetter,
      qualifierLabel: qualifierNote,
      totalQualified: ranked.length,
      posAvg: Number(avgRaw.toFixed(4)),
      posAvgDisplay: avgDisp,
      rows: storedRows.map(r => [r.uid, r.rank, r.disp, r.val])
    };

    positionalLeaderboards[lbKey] = lbPayload;
    const cacheEntry = { lbPayload, fullRanked: ranked };
    fullPoolCache.set(lbKey, cacheEntry);
    return cacheEntry;
  }

  function buildPlayerRowForMetric(u, peerGroup, metricDef) {
    const rawVal = metricDef.extract(u);
    if (rawVal === null || rawVal === undefined || !Number.isFinite(Number(rawVal))) return null;

    const { lbPayload, fullRanked } = ensureMetricLeaderboard(peerGroup, metricDef);
    if (fullRanked.length === 0) return null;

    const numVal = Number(Number(rawVal).toFixed(4));
    const dispVal = metricDef.format(numVal);
    const exactHit = fullRanked.find(r => r.uid === u.uid);

    let rank = exactHit ? exactHit.rank : 1;
    const qualified = Boolean(exactHit);
    if (!exactHit) {
      // Compute effective placement inside the qualified distribution for non-qualified backups
      const betterCount = fullRanked.filter(r =>
        metricDef.higherIsBetter ? r.val > numVal : r.val < numVal
      ).length;
      rank = Math.min(fullRanked.length, betterCount + 1);
      registerPeerDirectoryEntry(u);
    }

    return {
      key: metricDef.key,
      label: metricDef.label,
      value: numVal,
      displayValue: dispVal,
      rank,
      totalPeers: fullRanked.length,
      qualified,
      higherIsBetter: metricDef.higherIsBetter,
      posAvgDisplay: lbPayload.posAvgDisplay,
      scope: 'player',
      leaderboardKey: lbPayload.key
    };
  }

  // Attach `statProfile2026` to every 49ers roster player
  const profilesBySfPlayerId = new Map();
  const teamFlat = teamStatsPayload?.teamStats?.flatByKey || {};

  for (const rp of rosterPlayers || []) {
    const uid = `sf_${rp.id}`;
    const u = unifiedPlayers.get(uid) || null;
    const peerGroup = normalizePositionalPeerGroup(rp.position, null);
    const template = POSITIONAL_METRIC_TEMPLATES[peerGroup] || POSITIONAL_METRIC_TEMPLATES.WR;

    const has2026Participation =
      Boolean(u) &&
      (u.games > 0 || u.snapGames > 0 || u.offSnaps + u.defSnaps + u.stSnaps > 0);

    if (!has2026Participation) {
      profilesBySfPlayerId.set(rp.id, {
        seasonYear,
        peerGroup,
        peerGroupLabel: PEER_GROUP_LABELS[peerGroup] || peerGroup,
        hasActiveStats: false,
        sections: []
      });
      continue;
    }

    const coreRows = template.core
      .map(m => buildPlayerRowForMetric(u, peerGroup, m))
      .filter(Boolean);
    const expandedRows = template.expanded
      .map(m => buildPlayerRowForMetric(u, peerGroup, m))
      .filter(Boolean);

    // For Offensive Linemen & Long Snappers, append clickable 49ers Unit Context rows!
    if (peerGroup === 'OT' || peerGroup === 'IOL') {
      for (const tKey of ['sack_rate_allowed', 'rushing_epa_game', 'off_yds_per_carry']) {
        const tmRow = teamFlat[tKey];
        if (tmRow) {
          coreRows.push({
            key: tmRow.key,
            label: `49ers Unit: ${tmRow.label}`,
            value: tmRow.value,
            displayValue: tmRow.displayValue,
            rank: tmRow.rank,
            totalPeers: 32,
            qualified: true,
            higherIsBetter: tmRow.higherIsBetter,
            posAvgDisplay: tmRow.leagueAvgDisplay,
            scope: 'team',
            leaderboardKey: tmRow.key
          });
        }
      }
    } else if (peerGroup === 'LS') {
      for (const tKey of ['st_fg_pct', 'st_punt_net_avg']) {
        const tmRow = teamFlat[tKey];
        if (tmRow) {
          coreRows.push({
            key: tmRow.key,
            label: `49ers Unit: ${tmRow.label}`,
            value: tmRow.value,
            displayValue: tmRow.displayValue,
            rank: tmRow.rank,
            totalPeers: 32,
            qualified: true,
            higherIsBetter: tmRow.higherIsBetter,
            posAvgDisplay: tmRow.leagueAvgDisplay,
            scope: 'team',
            leaderboardKey: tmRow.key
          });
        }
      }
    }

    const sections = [];
    if (coreRows.length > 0 || expandedRows.length > 0) {
      sections.push({
        id: 'primary',
        title: `${seasonYear} ${template.primaryTitle}`,
        peerGroupLabel: PEER_GROUP_LABELS[peerGroup] || peerGroup,
        coreRows,
        expandedRows
      });
    }

    // Automatic Secondary-Skill Block: RB/FB Receiving (>=10 targets, or FB >=3 targets)
    if (peerGroup === 'RB' && (u.targets >= 10 || (rp.position === 'FB' && u.targets >= 3))) {
      const secRows = SECONDARY_ROLE_TEMPLATES.RB_RECEIVING.metrics
        .map(m => buildPlayerRowForMetric(u, 'RB', m))
        .filter(Boolean);
      if (secRows.length > 0) {
        sections.push({
          id: 'rb_receiving',
          title: `${seasonYear} ${SECONDARY_ROLE_TEMPLATES.RB_RECEIVING.title}`,
          peerGroupLabel: PEER_GROUP_LABELS.RB,
          coreRows: secRows,
          expandedRows: []
        });
      }
    }

    // Automatic Secondary-Skill Block: QB or WR Rushing (>=10 carries)
    if ((peerGroup === 'QB' || peerGroup === 'WR') && u.carries >= 10) {
      const secRows = SECONDARY_ROLE_TEMPLATES.SKILL_RUSHING.metrics
        .map(m => buildPlayerRowForMetric(u, peerGroup, m))
        .filter(Boolean);
      if (secRows.length > 0) {
        sections.push({
          id: 'skill_rushing',
          title: `${seasonYear} ${SECONDARY_ROLE_TEMPLATES.SKILL_RUSHING.title}`,
          peerGroupLabel: PEER_GROUP_LABELS[peerGroup],
          coreRows: secRows,
          expandedRows: []
        });
      }
    }

    profilesBySfPlayerId.set(rp.id, {
      seasonYear,
      peerGroup,
      peerGroupLabel: PEER_GROUP_LABELS[peerGroup] || peerGroup,
      hasActiveStats: sections.length > 0,
      sections
    });
  }

  return {
    positionalLeaderboards,
    peerDirectory,
    profilesBySfPlayerId
  };
}

/**
 * Position-specific Career Year-by-Year Table Column Schemas
 * Eliminates empty offensive columns on defenders and kickers.
 */
export function resolveCareerTableSchema(position = '') {
  const grp = normalizePositionalPeerGroup(position, null);

  if (grp === 'QB') {
    return {
      headers: ['Year', 'Tm', 'GP', 'Cmp/Att', 'Pass Yds', 'TD / INT', 'Pass EPA', 'Rush Yds/TD'],
      cells: s => [
        `<strong>${s.season}</strong>`,
        s.team || '—',
        s.games,
        s.passing?.attempts ? `${s.passing.completions}/${s.passing.attempts}` : '—',
        s.passing?.attempts ? s.passing.yards : '—',
        s.passing?.attempts ? `${s.passing.tds} / ${s.passing.ints}` : '—',
        s.passing?.attempts ? fmtSigned(s.passing.epa, 1) : '—',
        s.rushing?.carries ? `${s.rushing.yards} / ${s.rushing.tds}` : '—'
      ]
    };
  }

  if (grp === 'RB') {
    return {
      headers: ['Year', 'Tm', 'GP', 'Car', 'Rush Yds', 'YPC', 'Rush TD', 'Rec / Yds / TD', 'Tot EPA'],
      cells: s => {
        const totEpa = safeNum(s.rushing?.epa) + safeNum(s.receiving?.epa);
        return [
          `<strong>${s.season}</strong>`,
          s.team || '—',
          s.games,
          s.rushing?.carries || '—',
          s.rushing?.carries ? s.rushing.yards : '—',
          s.rushing?.carries ? (s.rushing.yards / s.rushing.carries).toFixed(1) : '—',
          s.rushing?.carries ? s.rushing.tds : '—',
          s.receiving?.targets ? `${s.receiving.receptions}/${s.receiving.yards}/${s.receiving.tds}` : '—',
          s.rushing?.carries || s.receiving?.targets ? fmtSigned(totEpa, 1) : '—'
        ];
      }
    };
  }

  if (grp === 'WR' || grp === 'TE') {
    return {
      headers: ['Year', 'Tm', 'GP', 'Rec / Tgt', 'Rec Yds', 'Y/Tgt', 'Rec TD', 'Tgt %', 'Rec EPA'],
      cells: s => [
        `<strong>${s.season}</strong>`,
        s.team || '—',
        s.games,
        s.receiving?.targets ? `${s.receiving.receptions}/${s.receiving.targets}` : '—',
        s.receiving?.targets ? s.receiving.yards : '—',
        s.receiving?.targets ? (s.receiving.yards / s.receiving.targets).toFixed(1) : '—',
        s.receiving?.targets ? s.receiving.tds : '—',
        s.receiving?.targetSharePct ? `${s.receiving.targetSharePct}%` : '—',
        s.receiving?.targets ? fmtSigned(s.receiving.epa, 1) : '—'
      ]
    };
  }

  if (['EDGE', 'IDL', 'LB', 'CB', 'S'].includes(grp)) {
    return {
      headers: ['Year', 'Tm', 'GP', 'Tackles (Solo)', 'TFL', 'Sacks', 'QBH', 'INT / PD', 'FF'],
      cells: s => [
        `<strong>${s.season}</strong>`,
        s.team || '—',
        s.games,
        s.defense?.totalTackles ? `${s.defense.totalTackles} (${s.defense.soloTackles})` : '0',
        s.defense?.tfl ?? 0,
        s.defense?.sacks ?? 0,
        s.defense?.qbHits ?? 0,
        `${s.defense?.ints ?? 0} / ${s.defense?.passDefended ?? 0}`,
        s.defense?.forcedFumbles ?? 0
      ]
    };
  }

  if (grp === 'K') {
    return {
      headers: ['Year', 'Tm', 'GP', 'FG Made/Att', 'FG %', 'Long', 'PAT Made/Att'],
      cells: s => [
        `<strong>${s.season}</strong>`,
        s.team || '—',
        s.games,
        `${s.kicking?.fgMade ?? 0}/${s.kicking?.fgAtt ?? 0}`,
        s.kicking?.fgAtt ? `${s.kicking.fgPct}%` : '—',
        s.kicking?.fgLong ? `${s.kicking.fgLong} yd` : '—',
        `${s.kicking?.patMade ?? 0}/${s.kicking?.patAtt ?? 0}`
      ]
    };
  }

  if (grp === 'P') {
    return {
      headers: ['Year', 'Tm', 'GP', 'Punts', 'Punt Yds', 'Gross Avg', 'Inside 20'],
      cells: s => [
        `<strong>${s.season}</strong>`,
        s.team || '—',
        s.games,
        s.kicking?.punts ?? 0,
        s.kicking?.puntYards ?? 0,
        s.kicking?.punts ? (s.kicking.puntYards / s.kicking.punts).toFixed(1) : '—',
        s.kicking?.puntInside20 ?? 0
      ]
    };
  }

  return {
    headers: ['Year', 'Tm', 'GP', 'Snaps / Box Notes'],
    cells: s => [`<strong>${s.season}</strong>`, s.team || '—', s.games, 'Active Roster']
  };
}

/**
 * Resolve any clicked `#X` badge into a complete scrollable modal view model.
 */
export function resolveLeaderboardModalModel({ appData, scope = 'team', key = '', playerId = null } = {}) {
  if (scope === 'team') {
    const ts = appData?.scheduleMatchup?.teamStats;
    const metric = ts?.flatByKey?.[key];
    if (!metric || !Array.isArray(metric.leaderboard)) return null;

    const teamsMeta = ts.teams || {};
    const values = metric.leaderboard.map(r => safeNum(r.val));
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const span = Math.max(1e-9, maxV - minV);

    const rows = metric.leaderboard.map(r => {
      const tmInfo = teamsMeta[r.team] || NFL_TEAM_NAMES[r.team] || { name: r.team, record: '' };
      const barPct = metric.higherIsBetter
        ? ((safeNum(r.val) - minV) / span) * 100
        : ((maxV - safeNum(r.val)) / span) * 100;
      return {
        rank: r.rank,
        id: r.team,
        title: tmInfo.name || r.team,
        subtitle: tmInfo.record ? `${r.team} • ${tmInfo.record}` : r.team,
        logoUrl: tmInfo.logoUrl || '',
        headshotUrl: '',
        displayValue: r.disp,
        rawValue: r.val,
        barPct: Math.max(8, Math.min(100, Math.round(barPct))),
        isHighlighted: r.team === 'SF',
        sfPlayerId: null,
        extUrl: `https://www.espn.com/nfl/team/_/name/${r.team === 'WAS' ? 'wsh' : r.team.toLowerCase()}`
      };
    });

    // Find exact insertion index for the NFL Average divider line
    let avgInsertAfterIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const aboveAvg = metric.higherIsBetter
        ? rows[i].rawValue >= metric.leagueAvg
        : rows[i].rawValue <= metric.leagueAvg;
      if (aboveAvg) avgInsertAfterIdx = i;
    }

    return {
      scope: 'team',
      title: metric.label,
      eyebrow: `${ts.seasonYear || 2026} NFL 32-Team Leaderboard • ${metric.higherIsBetter ? 'Higher is Better' : 'Lower is Better'}`,
      avgLabel: `NFL Average: ${metric.leagueAvgDisplay}`,
      avgInsertAfterIdx,
      rows
    };
  }

  // Player Positional Leaderboard
  const lb = appData?.roster?.positionalLeaderboards?.[key];
  const dir = appData?.roster?.peerDirectory || {};
  if (!lb || !Array.isArray(lb.rows)) return null;

  const activePlayer = playerId
    ? (appData?.roster?.players || []).find(p => String(p.id) === String(playerId))
    : null;

  let rawRows = lb.rows.map(([uid, rank, disp, val]) => {
    const meta = dir[uid] || {};
    return {
      uid,
      rank,
      disp,
      val: safeNum(val),
      meta,
      isHighlighted: Boolean(activePlayer && String(meta.sfPlayerId) === String(activePlayer.id)),
      unqualifiedNote: false
    };
  });

  // If the viewed 49ers player was below the volume qualifier, insert them at their effective position!
  if (activePlayer && !rawRows.some(r => r.isHighlighted)) {
    const secRows = (activePlayer.statProfile2026?.sections || []).flatMap(s => [
      ...(s.coreRows || []),
      ...(s.expandedRows || [])
    ]);
    const matchingStat = secRows.find(sr => sr.leaderboardKey === key);
    if (matchingStat) {
      const insertIdx = rawRows.findIndex(r =>
        lb.higherIsBetter ? matchingStat.value >= r.val : matchingStat.value <= r.val
      );
      const entry = {
        uid: `sf_${activePlayer.id}`,
        rank: matchingStat.rank,
        disp: matchingStat.displayValue,
        val: matchingStat.value,
        meta: {
          name: activePlayer.name,
          team: 'SF',
          pos: activePlayer.position,
          headshotUrl: activePlayer.headshotUrl || '',
          sfPlayerId: activePlayer.id,
          pfrUrl: activePlayer.pfrUrl || null,
          espnUrl: activePlayer.espnUrl || null
        },
        isHighlighted: true,
        unqualifiedNote: true
      };
      if (insertIdx >= 0) {
        rawRows.splice(insertIdx, 0, entry);
      } else {
        rawRows.push(entry);
      }
    }
  }

  const values = rawRows.map(r => r.val);
  const minV = values.length ? Math.min(...values) : 0;
  const maxV = values.length ? Math.max(...values) : 1;
  const span = Math.max(1e-9, maxV - minV);

  const rows = rawRows.map(r => {
    const barPct = lb.higherIsBetter
      ? ((r.val - minV) / span) * 100
      : ((maxV - r.val) / span) * 100;
    return {
      rank: r.rank,
      id: r.uid,
      title: r.meta.name || 'Player',
      subtitle: `${r.meta.team || 'NFL'} • ${r.meta.pos || lb.peerGroup}${r.unqualifiedNote ? ' • Below Min. Vol' : ''}`,
      logoUrl: '',
      headshotUrl: r.meta.headshotUrl || '',
      displayValue: r.disp,
      rawValue: r.val,
      barPct: Math.max(8, Math.min(100, Math.round(barPct))),
      isHighlighted: r.isHighlighted,
      is49erTeammate: Boolean(r.meta.sfPlayerId && !r.isHighlighted),
      sfPlayerId: r.meta.sfPlayerId || null,
      extUrl: r.meta.pfrUrl || r.meta.espnUrl || null
    };
  });

  let avgInsertAfterIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const aboveAvg = lb.higherIsBetter
      ? rows[i].rawValue >= lb.posAvg
      : rows[i].rawValue <= lb.posAvg;
    if (aboveAvg) avgInsertAfterIdx = i;
  }

  return {
    scope: 'player',
    title: lb.label,
    eyebrow: `${lb.peerGroupLabel} • ${lb.qualifierLabel} (${lb.totalQualified} NFL Qualified)`,
    avgLabel: `${lb.peerGroup} Positional Avg: ${lb.posAvgDisplay}`,
    avgInsertAfterIdx,
    rows
  };
}
