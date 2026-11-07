/**
 * NFL CBA Salary Cap & Armchair GM Simulator Engine
 * Computes exact multi-year cap space, dead money, Top-51 / 53 replacement rule offsets,
 * and CBA Post-June 1 designation limits (max 2 pre-June 1 designations).
 */

export const VALID_CAP_ACTIONS = new Set([
  'none',
  'restructure',
  'cut',
  'june_1_cut',
  'trade',
  'june_1_trade',
  'extension'
]);

// NFL Minimum Salary replacement cost when cutting/trading a roster player (approx 2026 rookie/1-yr vet min)
export const ROSTER_REPLACEMENT_MIN_SALARY = 960_000;

/**
 * Computes the multi-year salary cap impact of a map of user-selected GM actions.
 *
 * @param {object} capData - Parsed OverTheCap multi-year cap object ({ years: { "2026": {...}, "2027": {...} }, players: [...] })
 * @param {Record<string, string>} selectedActions - Map of playerId -> action ('restructure' | 'cut' | 'june_1_cut' | 'trade' | 'june_1_trade' | 'extension')
 * @param {object} [options] - { baseYear?: string, applyReplacementRule?: boolean }
 */
export function simulateCapScenario(capData, selectedActions = {}, options = {}) {
  const baseYear = String(options.baseYear || '2026');
  const nextYear = String(Number(baseYear) + 1);
  const year3 = String(Number(baseYear) + 2);
  const applyReplacementRule = options.applyReplacementRule !== false;

  const baseSummary = capData?.years?.[baseYear] || {
    capCeiling: 301_200_000,
    totalLiabilities: 305_398_241,
    top51: 239_503_827,
    teamCapSpace: 35_164_858,
    deadMoneyTotal: 28_450_000,
    draftPoolReserve: 8_420_000,
    inSeasonBuffer: 7_500_000
  };
  const nextSummary = capData?.years?.[nextYear] || {
    capCeiling: 322_000_000,
    teamCapSpace: 24_800_000,
    deadMoneyTotal: 11_200_000
  };
  const year3Summary = capData?.years?.[year3] || {
    capCeiling: 344_000_000,
    teamCapSpace: 68_500_000,
    deadMoneyTotal: 4_100_000
  };

  const playersById = new Map((capData?.players || []).map(p => [String(p.id), p]));

  let baseYearSavingsGross = 0;
  let baseYearReplacementCost = 0;
  let baseYearDeadMoneyAdded = 0;
  let nextYearCapDelta = 0;
  let nextYearDeadMoneyAdded = 0;
  let year3CapDelta = 0;
  let postJune1CutCount = 0;

  const appliedMoves = [];
  const warnings = [];

  for (const [playerId, rawAction] of Object.entries(selectedActions || {})) {
    const action = String(rawAction || 'none');
    if (action === 'none' || !VALID_CAP_ACTIONS.has(action)) continue;

    const player = playersById.get(String(playerId));
    if (!player) continue;

    const yrBase = player.contractsByYear?.[baseYear];
    if (!yrBase) continue;

    const yrNext = player.contractsByYear?.[nextYear] || null;
    const yr3 = player.contractsByYear?.[year3] || null;
    const tx = yrBase.transactions?.[action];
    if (!tx) continue;

    const savingsThisYear = Number(tx.capSavings || 0);
    const deadThisYear = Number(tx.deadMoney || 0);
    const currentProratedDeadIfKept =
      Number(yrBase.proratedSigning || 0) + Number(yrBase.proratedOption || 0);

    let moveNextYearDelta = 0;
    let moveNextYearDead = 0;
    let moveYear3Delta = 0;
    let replacementOffset = 0;

    if (action === 'restructure') {
      // Simple restructure spreads converted salary over up to 4 future years (5 total incl base year)
      const annualFutureProration = Math.round(savingsThisYear / 4);
      moveNextYearDelta = -annualFutureProration;
      moveYear3Delta = -annualFutureProration;
    } else if (action === 'extension') {
      // Extension lowers Year 1 cap hit and adds moderate proration + new-money structure in future years
      const annualFutureProration = Math.round(savingsThisYear * 0.35);
      moveNextYearDelta = -annualFutureProration;
      moveYear3Delta = -annualFutureProration;
    } else if (action === 'cut' || action === 'trade') {
      // Pre-June 1 release/trade: all unamortized bonus accelerates into baseYear,
      // freeing 100% of scheduled cap hits in nextYear and year3!
      if (yrNext) moveNextYearDelta = Number(yrNext.capNumber || 0);
      if (yr3) moveYear3Delta = Number(yr3.capNumber || 0);
      if (applyReplacementRule && yrBase.rosterBucket === 'active') {
        replacementOffset = ROSTER_REPLACEMENT_MIN_SALARY;
      }
    } else if (action === 'june_1_cut' || action === 'june_1_trade') {
      if (action === 'june_1_cut') postJune1CutCount += 1;
      // Post-June 1: baseYear keeps only baseYear proration; remaining unamortized bonus hits nextYear dead cap
      const fullPreJuneDead = Number(
        yrBase.transactions?.[action === 'june_1_cut' ? 'cut' : 'trade']?.deadMoney ?? deadThisYear
      );
      const acceleratedToNextYear = Math.max(0, fullPreJuneDead - deadThisYear);
      moveNextYearDead = acceleratedToNextYear;
      const scheduledNextCap = yrNext ? Number(yrNext.capNumber || 0) : 0;
      moveNextYearDelta = scheduledNextCap - acceleratedToNextYear;
      if (yr3) moveYear3Delta = Number(yr3.capNumber || 0);
      if (applyReplacementRule && yrBase.rosterBucket === 'active') {
        replacementOffset = ROSTER_REPLACEMENT_MIN_SALARY;
      }
    }

    const netDeadAddedBase = Math.max(0, deadThisYear - currentProratedDeadIfKept);
    baseYearSavingsGross += savingsThisYear;
    baseYearReplacementCost += replacementOffset;
    baseYearDeadMoneyAdded += netDeadAddedBase;
    nextYearCapDelta += moveNextYearDelta;
    nextYearDeadMoneyAdded += moveNextYearDead;
    year3CapDelta += moveYear3Delta;

    appliedMoves.push({
      playerId: player.id,
      name: player.name,
      position: player.position,
      action,
      actionLabel: formatCapActionLabel(action),
      originalCapHit: Number(yrBase.capNumber || 0),
      baseYearSavingsGross: savingsThisYear,
      baseYearReplacementCost: replacementOffset,
      baseYearNetDelta: savingsThisYear - replacementOffset,
      baseYearDeadMoney: deadThisYear,
      nextYearCapDelta: moveNextYearDelta,
      nextYearDeadMoney: moveNextYearDead,
      year3CapDelta: moveYear3Delta
    });
  }

  if (postJune1CutCount > 2) {
    warnings.push(
      `CBA Rule Alert: You selected ${postJune1CutCount} Post-June 1 Cuts. Under the NFL CBA, teams may only designate a maximum of 2 players as Post-June 1 releases prior to June 1 (additional Post-June 1 cuts require carrying their full cap hit until June 2).`
    );
  }

  const baseYearNetCapDelta = baseYearSavingsGross - baseYearReplacementCost;
  const updatedTeamCapSpace = Number(baseSummary.teamCapSpace || 0) + baseYearNetCapDelta;
  const effectiveCapSpace =
    updatedTeamCapSpace -
    Number(baseSummary.draftPoolReserve || 0) -
    Number(baseSummary.inSeasonBuffer || 0);

  if (updatedTeamCapSpace < 0) {
    warnings.push(
      `Cap Compliance Warning: Selected transactions put the 49ers ${formatCompactDollars(Math.abs(updatedTeamCapSpace))} OVER the ${baseYear} salary cap ceiling.`
    );
  }

  return {
    baseYear,
    nextYear,
    year3,
    moveCount: appliedMoves.length,
    postJune1CutCount,
    appliedMoves,
    warnings,
    summary: {
      originalCapSpace: Number(baseSummary.teamCapSpace || 0),
      baseYearSavingsGross,
      baseYearReplacementCost,
      baseYearNetCapDelta,
      updatedCapSpace: updatedTeamCapSpace,
      effectiveCapSpace,
      baseYearDeadMoneyAdded,
      updatedDeadMoneyTotal: Number(baseSummary.deadMoneyTotal || 0) + baseYearDeadMoneyAdded,
      originalNextYearCapSpace: Number(nextSummary.teamCapSpace || 0),
      nextYearCapDelta,
      updatedNextYearCapSpace: Number(nextSummary.teamCapSpace || 0) + nextYearCapDelta,
      nextYearDeadMoneyAdded,
      originalYear3CapSpace: Number(year3Summary.teamCapSpace || 0),
      year3CapDelta,
      updatedYear3CapSpace: Number(year3Summary.teamCapSpace || 0) + year3CapDelta
    }
  };
}

export function formatCapActionLabel(action) {
  switch (action) {
    case 'restructure':
      return 'Max Restructure';
    case 'cut':
      return 'Cut (Pre-June 1)';
    case 'june_1_cut':
      return 'Cut (Post-June 1)';
    case 'trade':
      return 'Trade (Pre-June 1)';
    case 'june_1_trade':
      return 'Trade (Post-June 1)';
    case 'extension':
      return 'Extension / Rework';
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
