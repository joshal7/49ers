/**
 * OverTheCap (OTC) HTML Parser for San Francisco 49ers
 * Parses live multi-year salary cap liabilities, gross/effective cap space, Top-51,
 * positional spend, non-active reserve/dead money charges, and per-player contract mechanics
 * (Cut, Post-June 1 Cut, Trade, Post-June 1 Trade, Restructure, Extension) across 5 years.
 */

export function parseDollarCell(str) {
  if (!str) return 0;
  const cleaned = String(str).replace(/<[^>]+>/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '—' || /^void$/i.test(cleaned)) return 0;
  const isParenNegative = cleaned.startsWith('(') && cleaned.endsWith(')');
  const isMinusNegative = cleaned.startsWith('-') || cleaned.includes('-$');
  const digits = cleaned.replace(/[^0-9.]/g, '');
  if (!digits) return 0;
  const val = Math.round(Number(digits));
  return isParenNegative || isMinusNegative ? -val : val;
}

function stripTags(str) {
  return String(str || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function estimateCbaMinSalary(yearNum) {
  const offset = Math.max(0, Number(yearNum) - 2026);
  return 885_000 + offset * 45_000;
}

/**
 * Parses OverTheCap's league-wide /salary-cap-space HTML (if provided) to extract
 * official Base Salary Cap ceilings and exact Effective Cap Space for San Francisco.
 */
export function parseOtcSalaryCapSpaceHtml(spaceHtml = '') {
  const byYear = {};
  if (!spaceHtml) return byYear;

  for (const m of spaceHtml.matchAll(/id="season-(\d{4})"/g)) {
    const yr = m[1];
    const startIdx = m.index;
    const nextMatch = spaceHtml.slice(startIdx + 12).search(/id="season-\d{4}"/);
    const block =
      nextMatch > 0
        ? spaceHtml.slice(startIdx, startIdx + 12 + nextMatch)
        : spaceHtml.slice(startIdx, startIdx + 50_000);

    const topPlain = stripTags(block.slice(0, 900));
    const baseLeagueCap = parseDollarCell(
      topPlain.match(/Base Salary Cap:\s*(-?\(?\$[0-9,]+\)?)/i)?.[1]
    );

    let sfRowHtml = null;
    for (const rm of block.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      if (/san-francisco-49ers/i.test(rm[1])) {
        sfRowHtml = rm[1];
        break;
      }
    }
    if (sfRowHtml) {
      const tds = [...sfRowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => stripTags(c[1]));
      // Columns: [0] Team, [1] Cap Space, [2] Effective Cap Space, [3] #, [4] Active Cap Spending, [5] Dead Money
      if (tds.length >= 6) {
        byYear[yr] = {
          baseLeagueCap: baseLeagueCap || null,
          teamCapSpace: parseDollarCell(tds[1]),
          effectiveCapSpace: parseDollarCell(tds[2]),
          totalSignedCount: Number.parseInt(tds[3], 10) || null,
          activeCapSpending: parseDollarCell(tds[4]),
          deadMoneyTotal: parseDollarCell(tds[5])
        };
      }
    } else if (baseLeagueCap) {
      byYear[yr] = { baseLeagueCap };
    }
  }
  return byYear;
}

function parseNonActiveSubtable(tableHtml) {
  const entries = [];
  let explicitTotal = null;
  const tbody = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] || tableHtml;
  const rows = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const r of rows) {
    const tds = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (tds.length < 2) continue;
    const name = stripTags(tds[0][1]);
    const capCharge = parseDollarCell(tds[1][1]);
    if (!name) continue;
    if (/^total$/i.test(name)) {
      explicitTotal = capCharge;
      continue;
    }
    if (capCharge !== 0) {
      entries.push({ name, capCharge });
    }
  }
  const summed = entries.reduce((acc, x) => acc + x.capCharge, 0);
  return {
    total: explicitTotal !== null ? explicitTotal : summed,
    entries
  };
}

/**
 * Resolves the 5-year salary cap window dynamically from HTML containers (`id="y2026"` .. `id="y2035"`),
 * anchored to `baseYear` (defaulting to current seasonYear if present, or earliest available container).
 */
export function parseOverTheCapHtml(html, baseYear = 2026, otcSpaceHtml = '') {
  const discoveredYears = [...new Set([...html.matchAll(/id="y(\d{4})"/g)].map(m => Number(m[1])))]
    .filter(y => Number.isFinite(y) && y >= 2024 && y <= 2040)
    .sort((a, b) => a - b);

  const anchorYear = discoveredYears.includes(Number(baseYear))
    ? Number(baseYear)
    : discoveredYears[0] || Number(baseYear) || 2026;

  const targetYears = [0, 1, 2, 3, 4].map(offset => String(anchorYear + offset));
  const spaceByYear = parseOtcSalaryCapSpaceHtml(otcSpaceHtml);

  const yearsSummary = {};
  const playerContractsByName = new Map();

  // Extract ALL `/player/<slug>/<otcId>/` links anywhere in the OTC HTML (active, IR, PS, dead money, future years)
  const otcDirectoryBySlug = new Map();
  for (const m of html.matchAll(/href="\/player\/([a-z0-9-]+)\/(\d+)\/?"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const slug = m[1].toLowerCase();
    const otcId = m[2];
    const label = stripTags(m[3]);
    if (!slug || !otcId) continue;
    if (!otcDirectoryBySlug.has(slug) || (label && label.length > (otcDirectoryBySlug.get(slug).name?.length || 0))) {
      otcDirectoryBySlug.set(slug, {
        name: label || slug,
        slug,
        otcId,
        otcUrl: `https://overthecap.com/player/${slug}/${otcId}/`
      });
    }
  }

  let lastKnownCapCeiling = 0;

  for (const yr of targetYears) {
    const yrNum = Number(yr);
    const marker = `id="y${yr}"`;
    const startIdx = html.indexOf(marker);
    if (startIdx === -1) continue;

    const nextYrMarker = `id="y${yrNum + 1}"`;
    const endIdx = html.indexOf(nextYrMarker, startIdx);
    const block = endIdx > startIdx ? html.slice(startIdx, endIdx) : html.slice(startIdx, startIdx + 95_000);

    // Strip HTML tags from the top summary banner so `<span class="over-the-cap">($31,540,066)</span>` parses cleanly
    const topBannerPlain = stripTags(block.slice(0, 1800));
    const totalLiabilities = parseDollarCell(
      topBannerPlain.match(/Total Cap Liabilities:\s*(-?\(?\$[0-9,]+\)?)/i)?.[1]
    );
    const top51 = parseDollarCell(topBannerPlain.match(/Top 51:\s*(-?\(?\$[0-9,]+\)?)/i)?.[1]);
    const hasTeamCapSpaceLabel = /Team Cap Space:/i.test(topBannerPlain);
    const otcRawTeamCapSpace = parseDollarCell(
      topBannerPlain.match(/Team Cap Space:\s*(-?\(?\$[0-9,]+\)?)/i)?.[1]
    );
    const offenseSpend = parseDollarCell(topBannerPlain.match(/Offense:\s*(-?\(?\$[0-9,]+\)?)/i)?.[1]);
    const defenseSpend = parseDollarCell(topBannerPlain.match(/Defense:\s*(-?\(?\$[0-9,]+\)?)/i)?.[1]);
    const specialSpend = parseDollarCell(topBannerPlain.match(/Special:\s*(-?\(?\$[0-9,]+\)?)/i)?.[1]);

    const headerActiveCountMatch = block.match(/Active Roster\s*\((\d+)\s*total\)/i);
    const headerActiveCount = headerActiveCountMatch ? Number.parseInt(headerActiveCountMatch[1], 10) : null;

    // Parse Active / Contracted Roster table
    const activeTableMatch = block.match(
      /<table[^>]*class="[^"]*(?:contracted-players|team-salary-cap-table)[^"]*"[^>]*>([\s\S]*?)<\/table>/i
    );
    let parsedActiveRowCount = 0;

    if (activeTableMatch) {
      const tbodyMatch = activeTableMatch[1].match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
      const rowsHtml = tbodyMatch ? tbodyMatch[1] : activeTableMatch[1];
      const rowMatches = [...rowsHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];

      for (const rm of rowMatches) {
        const trInner = rm[1];
        const linkMatch = trInner.match(/href="\/player\/([^/"]+)\/(\d+)\/?"[^>]*>([\s\S]*?)<\/a>/i);
        if (!linkMatch) continue;
        const slug = linkMatch[1];
        const otcId = linkMatch[2];
        const playerName = stripTags(linkMatch[3]);
        if (!playerName || /^total$/i.test(playerName)) continue;

        const rawTds = [];
        for (const tdMatch of trInner.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)) {
          const attrs = tdMatch[1] || '';
          if (/\bspacer\b/i.test(attrs)) continue;
          rawTds.push({ attrs, inner: tdMatch[2] });
        }
        if (rawTds.length < 10) continue;

        parsedActiveRowCount += 1;

        const baseCellPlain = stripTags(rawTds[1].inner);
        const isVoidYear = /^void$/i.test(baseCellPlain);
        const baseSalary = parseDollarCell(rawTds[1].inner);
        const proratedSigning = parseDollarCell(rawTds[2].inner);
        const proratedOption = parseDollarCell(rawTds[3].inner);
        const rosterBonusRegular = parseDollarCell(rawTds[4].inner);
        const rosterBonusPerGame = parseDollarCell(rawTds[5].inner);
        const workoutBonus = parseDollarCell(rawTds[6].inner);
        const otherBonus = parseDollarCell(rawTds[7].inner);
        const guaranteedSalary = parseDollarCell(rawTds[8].inner);
        const capNumber = parseDollarCell(rawTds[9].inner);

        const deadCellHtml = rawTds[10]?.inner || '';
        const saveCellHtml = rawTds[11]?.inner || '';

        const extractTxVal = (cellHtml, txClass) => {
          const re = new RegExp(`class="[^"]*\\bcap_${yr}\\s+${txClass}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/`, 'i');
          const m = cellHtml.match(re);
          if (m) return parseDollarCell(m[1]);
          const reAlt = new RegExp(`class="[^"]*\\b${txClass}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/`, 'i');
          const m2 = cellHtml.match(reAlt);
          return m2 ? parseDollarCell(m2[1]) : 0;
        };

        const transactions = {
          cut: {
            deadMoney: extractTxVal(deadCellHtml, 'cut'),
            capSavings: extractTxVal(saveCellHtml, 'cut')
          },
          june_1_cut: {
            deadMoney: extractTxVal(deadCellHtml, 'june_1_cut'),
            capSavings: extractTxVal(saveCellHtml, 'june_1_cut')
          },
          trade: {
            deadMoney: extractTxVal(deadCellHtml, 'trade'),
            capSavings: extractTxVal(saveCellHtml, 'trade')
          },
          june_1_trade: {
            deadMoney: extractTxVal(deadCellHtml, 'june_1_trade'),
            capSavings: extractTxVal(saveCellHtml, 'june_1_trade')
          },
          restructure: {
            deadMoney: extractTxVal(deadCellHtml, 'restructure'),
            capSavings: extractTxVal(saveCellHtml, 'restructure')
          },
          extension: {
            deadMoney: extractTxVal(deadCellHtml, 'extension'),
            capSavings: extractTxVal(saveCellHtml, 'extension')
          }
        };

        const normKey = playerName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!playerContractsByName.has(normKey)) {
          playerContractsByName.set(normKey, {
            name: playerName,
            otcId,
            slug,
            otcUrl: `https://overthecap.com/player/${slug}/${otcId}/`,
            contractsByYear: {}
          });
        }
        playerContractsByName.get(normKey).contractsByYear[yr] = {
          year: yrNum,
          rosterBucket: 'active',
          isVoidYear,
          baseSalary,
          proratedSigning,
          proratedOption,
          proratedBonus: proratedSigning + proratedOption,
          rosterBonusRegular,
          rosterBonusPerGame,
          workoutBonus,
          otherBonus,
          currentYearBonuses: rosterBonusRegular + rosterBonusPerGame + workoutBonus + otherBonus,
          guaranteedSalary,
          capNumber,
          transactions
        };
      }
    }

    // Parse Non-Active Roster Cap Charges sub-tables (Dead Money, Practice Squad, Injured Reserve, PUP, Suspended)
    let deadMoneyTotal = 0;
    let deadMoneyPlayers = [];
    let practiceSquadTotal = 0;
    let injuredReserveTotal = 0;
    let pupTotal = 0;
    let suspendedTotal = 0;

    const h5Subtables = [
      ...block.matchAll(/<h5[^>]*>([\s\S]*?)<\/h5>\s*(<table[^>]*class="[^"]*non-active[^"]*"[^>]*>[\s\S]*?<\/table>)/gi)
    ];

    if (h5Subtables.length > 0) {
      for (const st of h5Subtables) {
        const heading = stripTags(st[1]).toLowerCase();
        const parsedSub = parseNonActiveSubtable(st[2]);
        if (heading.includes('dead')) {
          deadMoneyTotal = parsedSub.total;
          deadMoneyPlayers = parsedSub.entries;
        } else if (heading.includes('practice')) {
          practiceSquadTotal = parsedSub.total;
        } else if (heading.includes('injured')) {
          injuredReserveTotal = parsedSub.total;
        } else if (heading.includes('physically') || heading.includes('pup')) {
          pupTotal = parsedSub.total;
        } else if (heading.includes('suspend')) {
          suspendedTotal = parsedSub.total;
        }
      }
    } else {
      // Fallback for compact/synthetic OTC HTML with unlabeled `<table class="non-active">`
      const fallbackDeadMatch = block.match(/<table[^>]*class="[^"]*non-active[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
      if (fallbackDeadMatch) {
        const parsedSub = parseNonActiveSubtable(fallbackDeadMatch[0]);
        deadMoneyTotal = parsedSub.total;
        deadMoneyPlayers = parsedSub.entries;
      }
    }

    const contractedCount = headerActiveCount ?? parsedActiveRowCount;
    const spaceMeta = spaceByYear[yr] || null;

    // Resolve cap ceiling and projected gross/effective cap space
    // Note: OTC sets official league cap ceilings 3 years out (e.g. 2026-2028) and leaves Team Cap Space as $0
    // for years +3/+4 (e.g. 2029-2030) until projections publish. When liabilities > 0 and OTC raw space === 0,
    // project the league cap ceiling at +$25.0M/yr from the last published OTC ceiling so 5-year gross & effective space work seamlessly.
    let capCeiling = 0;
    let capCeilingProjected = false;
    let teamCapSpace = otcRawTeamCapSpace;

    if (totalLiabilities > 0 || otcRawTeamCapSpace !== 0) {
      if (otcRawTeamCapSpace !== 0 || !hasTeamCapSpaceLabel) {
        capCeiling = totalLiabilities + otcRawTeamCapSpace;
        lastKnownCapCeiling = spaceMeta?.baseLeagueCap || capCeiling;
      } else if (spaceMeta?.baseLeagueCap) {
        capCeiling = spaceMeta.baseLeagueCap;
        teamCapSpace = capCeiling - totalLiabilities;
        lastKnownCapCeiling = capCeiling;
      } else {
        const baselineAnchor = lastKnownCapCeiling > 0 ? lastKnownCapCeiling : 301_200_000 + Math.max(0, yrNum - 2026) * 25_000_000;
        capCeiling = baselineAnchor + 25_000_000;
        lastKnownCapCeiling = capCeiling;
        teamCapSpace = capCeiling - totalLiabilities;
        capCeilingProjected = true;
      }
    }

    const minSlotFillPenalty =
      contractedCount > 0 && contractedCount < 51
        ? (51 - contractedCount) * estimateCbaMinSalary(yrNum)
        : 0;
    const effectiveCapSpace =
      spaceMeta?.effectiveCapSpace !== undefined
        ? spaceMeta.effectiveCapSpace
        : totalLiabilities > 0 || teamCapSpace !== 0
          ? teamCapSpace - minSlotFillPenalty
          : 0;

    const activeCapSpending =
      spaceMeta?.activeCapSpending !== undefined
        ? spaceMeta.activeCapSpending
        : Math.max(0, totalLiabilities - deadMoneyTotal);

    yearsSummary[yr] = {
      year: yrNum,
      capCeiling,
      baseLeagueCap: spaceMeta?.baseLeagueCap || (capCeilingProjected ? capCeiling : null),
      capCeilingProjected,
      totalCapLiabilities: totalLiabilities,
      top51,
      teamCapSpace,
      otcRawTeamCapSpace,
      effectiveCapSpace,
      activeCapSpending,
      offenseSpend,
      defenseSpend,
      specialSpend,
      deadMoneyTotal,
      injuredReserveTotal,
      practiceSquadTotal,
      pupTotal,
      suspendedTotal,
      reserveAndPsTotal: injuredReserveTotal + practiceSquadTotal + pupTotal + suspendedTotal,
      topDeadMoneyEntries: deadMoneyPlayers.slice(0, 15),
      contractedCount,
      totalSignedCount: spaceMeta?.totalSignedCount || contractedCount
    };
  }

  return {
    years: yearsSummary,
    otcPlayers: Array.from(playerContractsByName.values()),
    otcDirectory: Array.from(otcDirectoryBySlug.values())
  };
}
