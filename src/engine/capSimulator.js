/**
 * Interactive 49ers Armchair GM Salary Cap Simulator Engine
 * Supports multi-year simulation across this year and the next 4 years (e.g., 2026–2030).
 * Uses real OverTheCap per-player contract structures and NFL CBA rules:
 *  - Pre-June 1 Cut
 *  - Post-June 1 Cut (max 2 early designations per league year; splits remaining proration to year+1)
 *  - Pre-June 1 Trade
 *  - Post-June 1 Trade
 *  - Simple Restructure (converts base salary -> prorated signing bonus across up to 5 years)
 *  - Contract Extension
 *  - Top-51 / 53-man minimum-salary replacement rule when releasing/trading an active player
 */

export const GM_MOVES = [
  { id: 'none', label: 'Do Nothing (Keep)', shortLabel: 'Keep' },
  { id: 'cut', label: 'Cut (Pre-June 1)', shortLabel: 'Cut Pre-6/1' },
  { id: 'june_1_cut', label: 'Cut (Post-June 1)', shortLabel: 'Cut Post-6/1' },
  { id: 'trade', label: 'Trade (Pre-June 1)', shortLabel: 'Trade Pre-6/1' },
  { id: 'june_1_trade', label: 'Trade (Post-June 1)', shortLabel: 'Trade Post-6/1' },
  { id: 'restructure', label: 'Simple Restructure', shortLabel: 'Restructure' },
  { id: 'extension', label: 'Extend Contract', shortLabel: 'Extend' }
];

function getDefaultMinReplacementSalary(yearNum) {
  const offset = Math.max(0, Number(yearNum) - 2026);
  return 885_000 + offset * 45_000;
}

/**
 * Simulates user-selected roster moves on top of the baseline OverTheCap ledger for any selected year.
 *
 * @param {object} capData - Parsed `data/cap.json` object
 * @param {Record<string, string>} selectedActions - Map of `playerId -> moveId` for the target year
 * @param {object} [options]
 * @param {string|number} [options.baseYear] - Selected cap year (defaults to earliest year in `capData.years`)
 * @param {number} [options.minReplacementSalary] - Veteran/Rookie minimum replacement cost when roster < 51
 * @param {boolean} [options.applyReplacementRule=true]
 */
export function simulateCapScenario(capData, selectedActions = {}, options = {}) {
  const sortedYears = Object.keys(capData?.years || {}).sort();
  const requestedYear = options.baseYear ? String(options.baseYear) : null;
  const baseYear =
    requestedYear && capData?.years?.[requestedYear]
      ? requestedYear
      : sortedYears[0] || '2026';

  const baseYearNum = Number(baseYear);
  const nextYear = String(baseYearNum + 1);
  const yearPlus2 = String(baseYearNum + 2);

  const applyReplacementRule = options.applyReplacementRule ?? true;
  const minReplacementSalary =
    options.minReplacementSalary ?? getDefaultMinReplacementSalary(baseYearNum);

  const baseYearSummary = capData?.years?.[baseYear] || {
    teamCapSpace: 0,
    effectiveCapSpace: 0,
    totalCapLiabilities: 0,
    top51: 0,
    deadMoneyTotal: 0,
    contractedCount: 53
  };
  const nextYearSummary = capData?.years?.[nextYear] || {
    teamCapSpace: 0,
    totalCapLiabilities: 0,
    deadMoneyTotal: 0
  };
  const baselineRosterCount = Number(baseYearSummary.contractedCount) || 53;

  let baseYearDelta = 0;
  let nextYearDelta = 0;
  let yearPlus2Delta = 0;
  let addedDeadMoneyBaseYear = 0;
  let postJune1CutCount = 0;
  let rosterSpotsOpened = 0;

  const appliedMoves = [];
  const warnings = [];
  const validMoveIds = new Set(GM_MOVES.map(m => m.id));

  // Build simulated player rows for all players contracted in `baseYear`
  const playersForYear = (capData?.players || [])
    .filter(p => Boolean(p?.contractsByYear?.[baseYear]))
    .sort(
      (a, b) =>
        (b.contractsByYear?.[baseYear]?.capNumber || 0) -
        (a.contractsByYear?.[baseYear]?.capNumber || 0)
    );

  const simulatedPlayers = playersForYear.map(player => {
    const c = player.contractsByYear[baseYear];
    const rawRequested = selectedActions?.[player.id] || 'none';
    const move = validMoveIds.has(rawRequested) ? rawRequested : 'none';

    const proratedSigning = Number(c.proratedSigning) || 0;
    const proratedOption = Number(c.proratedOption) || 0;
    const proratedBonus = proratedSigning + proratedOption;

    const rosterBonusRegular = Number(c.rosterBonusRegular) || 0;
    const rosterBonusPerGame = Number(c.rosterBonusPerGame) || 0;
    const workoutBonus = Number(c.workoutBonus) || 0;
    const otherBonus = Number(c.otherBonus) || 0;
    const currentYearBonuses =
      rosterBonusRegular + rosterBonusPerGame + workoutBonus + otherBonus;

    const baseSalary = Number(c.baseSalary) || 0;
    const guaranteedSalary = Number(c.guaranteedSalary) || 0;
    const capNumber = Number(c.capNumber) || 0;

    // Nominally $0 Dead Money and $0 Cap Savings if we do nothing ('none')
    let moveDeadMoney = 0;
    let moveCapSavings = 0;
    let netSavingsAfterReplacement = 0;
    let nextYrImpact = 0;
    let effectiveCapNumber = capNumber;

    if (move !== 'none') {
      const tx = c.transactions?.[move];
      if (tx) {
        moveDeadMoney = Number(tx.deadMoney) || 0;
        moveCapSavings = Number(tx.capSavings) || 0;
        effectiveCapNumber = Math.max(0, capNumber - moveCapSavings);

        const isDeparture =
          move === 'cut' ||
          move === 'june_1_cut' ||
          move === 'trade' ||
          move === 'june_1_trade';

        let replacementCost = 0;
        if (isDeparture) {
          const remainingCountBeforeThisMove = baselineRosterCount - rosterSpotsOpened;
          rosterSpotsOpened += 1;
          // Under Top-51 / 53-man accounting, vacating a slot when the roster falls below 51 requires a minimum replacement contract
          if (applyReplacementRule && remainingCountBeforeThisMove <= 51) {
            replacementCost = minReplacementSalary;
          }
        }

        netSavingsAfterReplacement = moveCapSavings - replacementCost;
        baseYearDelta += netSavingsAfterReplacement;

        if (isDeparture) {
          addedDeadMoneyBaseYear += moveDeadMoney;
        }

        if (move === 'june_1_cut') {
          postJune1CutCount += 1;
        }

        if (move === 'june_1_cut' || move === 'june_1_trade') {
          const preKey = move === 'june_1_cut' ? 'cut' : 'trade';
          const preDead = c.transactions?.[preKey]?.deadMoney ?? moveDeadMoney;
          const deferredDead = Math.max(0, preDead - moveDeadMoney);
          const scheduledNextCap = player.contractsByYear?.[nextYear]?.capNumber || 0;
          nextYrImpact = scheduledNextCap - deferredDead;
          nextYearDelta += nextYrImpact;
        } else if (move === 'cut' || move === 'trade') {
          const scheduledNextCap = player.contractsByYear?.[nextYear]?.capNumber || 0;
          nextYrImpact = scheduledNextCap;
          nextYearDelta += nextYrImpact;
        } else if (move === 'restructure' && moveCapSavings > 0) {
          const annualAddedProration = Math.round(moveCapSavings / 4);
          nextYrImpact = -annualAddedProration;
          nextYearDelta += nextYrImpact;
          yearPlus2Delta -= annualAddedProration;
        }

        appliedMoves.push({
          playerId: player.id,
          name: player.name,
          position: player.position,
          move,
          moveLabel: GM_MOVES.find(m => m.id === move)?.label || move,
          originalCapHit: capNumber,
          deadMoneyThisYear: moveDeadMoney,
          grossCapSavings: moveCapSavings,
          replacementOffset: replacementCost,
          netCapDeltaThisYear: netSavingsAfterReplacement,
          nextYearCapDelta: nextYrImpact
        });
      }
    }

    return {
      id: player.id,
      name: player.name,
      position: player.position,
      jersey: player.jersey,
      headshotUrl: player.headshotUrl,
      otcUrl: player.otcUrl,
      espnUrl: player.espnUrl,
      year: baseYearNum,
      isVoidYear: Boolean(c.isVoidYear),
      baseSalary,
      proratedSigning,
      proratedOption,
      proratedBonus,
      rosterBonusRegular,
      rosterBonusPerGame,
      workoutBonus,
      otherBonus,
      currentYearBonuses,
      guaranteedSalary,
      capNumber,
      effectiveCapNumber,
      selectedMove: move,
      moveDeadMoney,
      moveCapSavings,
      netSavingsAfterReplacement,
      transactions: c.transactions || {}
    };
  });

  if (postJune1CutCount > 2) {
    warnings.push(
      `NFL CBA Rule Alert: Teams may designate a maximum of 2 players as Post-June 1 releases prior to June 1 (you selected ${postJune1CutCount}). Moves #3+ must occur on or after June 2.`
    );
  }

  const baselineCapSpace = Number(baseYearSummary.teamCapSpace) || 0;
  const updatedCapSpace = baselineCapSpace + baseYearDelta;

  const baselineEffectiveSpace =
    baseYearSummary.effectiveCapSpace !== undefined
      ? Number(baseYearSummary.effectiveCapSpace)
      : baselineCapSpace;
  const updatedEffectiveCapSpace = baselineEffectiveSpace + baseYearDelta;

  const baselineDeadMoney = Number(baseYearSummary.deadMoneyTotal) || 0;
  const updatedDeadMoney = baselineDeadMoney + addedDeadMoneyBaseYear;

  const baselineLiabilities = Number(baseYearSummary.totalCapLiabilities) || 0;
  const updatedTotalLiabilities = Math.max(0, baselineLiabilities - baseYearDelta);

  const baselineTop51 = Number(baseYearSummary.top51) || 0;
  const updatedTop51 = Math.max(0, baselineTop51 - baseYearDelta);

  const updatedNextYearSpace = (Number(nextYearSummary.teamCapSpace) || 0) + nextYearDelta;

  if (updatedCapSpace < 0) {
    warnings.push(
      `Cap Compliance Warning: Simulated 49ers ledger is $${Math.abs(updatedCapSpace).toLocaleString()} OVER the ${baseYear} salary cap ceiling.`
    );
  }

  return {
    baseYear,
    nextYear,
    yearPlus2,
    year3: yearPlus2,
    summary: {
      capCeiling: Number(baseYearSummary.capCeiling) || 0,
      capCeilingProjected: Boolean(baseYearSummary.capCeilingProjected),
      originalCapSpace: baselineCapSpace,
      baselineCapSpace,
      updatedCapSpace,
      baselineEffectiveSpace,
      effectiveCapSpace: updatedEffectiveCapSpace,
      updatedEffectiveCapSpace,
      baselineLiabilities,
      updatedTotalLiabilities,
      baselineTop51,
      updatedTop51,
      baselineDeadMoney,
      baseYearDeadMoneyAdded: addedDeadMoneyBaseYear,
      updatedDeadMoneyTotal: updatedDeadMoney,
      updatedDeadMoney,
      baseYearNetCapDelta: baseYearDelta,
      originalNextYearCapSpace: Number(nextYearSummary.teamCapSpace) || 0,
      baselineNextYearSpace: Number(nextYearSummary.teamCapSpace) || 0,
      updatedNextYearCapSpace: updatedNextYearSpace,
      updatedNextYearSpace,
      nextYearCapDelta: nextYearDelta,
      yearPlus2CapDelta: yearPlus2Delta,
      rosterSpotsOpened,
      activeContractedCount: Math.max(0, baselineRosterCount - rosterSpotsOpened),
      baselineContractedCount: baselineRosterCount
    },
    simulatedPlayers,
    appliedMoves,
    moveCount: appliedMoves.length,
    postJune1CutCount,
    warnings
  };
}

export function formatCapActionLabel(action) {
  switch (action) {
    case 'restructure':
      return 'Simple Restructure';
    case 'cut':
      return 'Cut (Pre-June 1)';
    case 'june_1_cut':
      return 'Cut (Post-June 1)';
    case 'trade':
      return 'Trade (Pre-June 1)';
    case 'june_1_trade':
      return 'Trade (Post-June 1)';
    case 'extension':
      return 'Extend Contract';
    default:
      return 'Keep Contract';
  }
}

export function formatDollars(amount, showSign = false) {
  const n = Math.round(Number(amount || 0));
  const abs = Math.abs(n).toLocaleString('en-US');
  if (n < 0) return `-$${abs}`;
  if (showSign && n > 0) return `+$${abs}`;
  return `$${abs}`;
}

export function formatOtcDollars(amount) {
  const n = Math.round(Number(amount || 0));
  const abs = Math.abs(n).toLocaleString('en-US');
  if (n < 0) return `($${abs})`;
  return `$${abs}`;
}

export function formatCompactDollars(amount, showSign = false) {
  const n = Number(amount || 0);
  const abs = Math.abs(n);
  let formatted;
  if (abs >= 1_000_000) {
    formatted = `$${(abs / 1_000_000).toFixed(2)}M`;
  } else if (abs >= 1_000) {
    formatted = `$${Math.round(abs / 1_000)}K`;
  } else {
    formatted = `$${Math.round(abs)}`;
  }
  if (n < 0) return `-${formatted}`;
  if (showSign && n > 0) return `+${formatted}`;
  return formatted;
}
