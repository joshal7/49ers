/**
 * OverTheCap Multi-Year HTML Parser for San Francisco 49ers
 * Parses Active Roster, Injured Reserve, Practice Squad, and Dead Money tables
 * across 2026–2030, extracting exact Base Salary, Prorated Bonuses, Cap Hits,
 * and Pre/Post-June 1 Cut, Trade, Restructure, & Extension deltas.
 */

export function parseDollarCell(raw = '') {
  const clean = String(raw || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!clean || clean === '-' || clean === '$0') return 0;
  const isNeg = clean.startsWith('(') && clean.endsWith(')') || clean.startsWith('-');
  const digits = Number(clean.replace(/[^0-9.]/g, ''));
  if (Number.isNaN(digits)) return 0;
  return isNeg ? -Math.round(digits) : Math.round(digits);
}

function parseTxDivs(cellHtml = '') {
  const out = {};
  for (const key of ['cut', 'june_1_cut', 'trade', 'june_1_trade', 'restructure', 'extension']) {
    const m = cellHtml.match(new RegExp(`<div\\s+class="${key}"[^>]*>([\\s\\S]*?)<\\/div>`, 'i'));
    out[key] = m ? parseDollarCell(m[1]) : 0;
  }
  return out;
}

export function parseOverTheCapHtml(html = '') {
  const years = ['2026', '2027', '2028', '2029', '2030'];
  const yearSummaries = {};
  const playersMap = new Map(); // key: otcId or normalized name
  const deadMoneyLedgerByYear = {};

  // Projected NFL Cap Ceilings for multi-year planning
  const projectedCeilings = {
    '2026': 301_200_000,
    '2027': 323_500_000,
    '2028': 346_000_000,
    '2029': 368_500_000,
    '2030': 391_000_000
  };

  for (let idx = 0; idx < years.length; idx++) {
    const yr = years[idx];
    const nextYr = years[idx + 1] || '2031';
    const startIdx = html.indexOf(`id="y${yr}"`);
    if (startIdx === -1) continue;
    const endIdx = html.indexOf(`id="y${nextYr}"`, startIdx + 10);
    const block = endIdx !== -1 ? html.slice(startIdx, endIdx) : html.slice(startIdx, startIdx + 100000);

    const totalLiabilities = parseDollarCell(block.match(/Total Cap Liabilities:\s*(\$[0-9,()-]+)/i)?.[1]);
    const top51 = parseDollarCell(block.match(/Top 51:\s*(\$[0-9,()-]+)/i)?.[1]);
    const teamCapSpace = parseDollarCell(block.match(/Team Cap Space:\s*(\(?\$[0-9,]+\)?)/i)?.[1]);
    const offenseSpend = parseDollarCell(block.match(/Offense:\s*(\$[0-9,()-]+)/i)?.[1]);
    const defenseSpend = parseDollarCell(block.match(/Defense:\s*(\$[0-9,()-]+)/i)?.[1]);
    const specialSpend = parseDollarCell(block.match(/Special:\s*(\$[0-9,()-]+)/i)?.[1]);

    // Parse Active / Contracted Players table
    const contractedMatch = block.match(
      /<table[^>]*class="[^"]*contracted-players[^"]*"[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i
    );
    let activeCount = 0;

    if (contractedMatch) {
      const rows = [...contractedMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      for (const rMatch of rows) {
        const rowHtml = rMatch[1];
        const linkMatch = rowHtml.match(/<a\s+href="\/player\/([^/]+)\/(\d+)\/?">([^<]+)<\/a>/i);
        if (!linkMatch) continue;
        const [, slug, otcId, rawName] = linkMatch;
        const name = rawName.trim();
        const tds = [...rowHtml.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/gi)];
        if (tds.length < 13) continue;

        const baseSalary = parseDollarCell(tds[1]?.[2]);
        const proratedSigning = parseDollarCell(tds[2]?.[2]);
        const proratedOption = parseDollarCell(tds[3]?.[2]);
        const rosterBonusRegular = parseDollarCell(tds[4]?.[2]);
        const rosterBonusPerGame = parseDollarCell(tds[5]?.[2]);
        const workoutBonus = parseDollarCell(tds[6]?.[2]);
        const otherBonus = parseDollarCell(tds[7]?.[2]);
        const guaranteedSalary = parseDollarCell(tds[9]?.[2]);
        const capNumber = parseDollarCell(tds[11]?.[2]);

        const deadCell = tds.find(t => t[1].includes('player-dead-money'))?.[2] || '';
        const saveCell = tds.find(t => t[1].includes('player-cap-savings'))?.[2] || '';
        const deadByTx = parseTxDivs(deadCell);
        const saveByTx = parseTxDivs(saveCell);

        const transactions = {};
        for (const txKey of ['cut', 'june_1_cut', 'trade', 'june_1_trade', 'restructure', 'extension']) {
          transactions[txKey] = {
            deadMoney: deadByTx[txKey] || 0,
            capSavings: saveByTx[txKey] || 0
          };
        }

        if (!playersMap.has(otcId)) {
          playersMap.set(otcId, {
            otcId,
            slug,
            name,
            contractsByYear: {}
          });
        }
        playersMap.get(otcId).contractsByYear[yr] = {
          year: Number(yr),
          rosterBucket: 'active',
          baseSalary,
          proratedSigning,
          proratedOption,
          rosterBonusRegular,
          rosterBonusPerGame,
          workoutBonus,
          otherBonus,
          guaranteedSalary,
          capNumber,
          transactions
        };
        activeCount += 1;
      }
    }

    // Parse Non-Active sub-tables (Injured Reserve, Practice Squad, Dead Money, Reserve/PUP)
    const nonActiveBlocks = [
      ...block.matchAll(
        /<div\s+class="non-active-table">\s*<h5>([^<]+)<\/h5>\s*<table[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>\s*<\/table>/gi
      )
    ];

    let deadMoneyTotal = 0;
    let irCapTotal = 0;
    let psCapTotal = 0;
    deadMoneyLedgerByYear[yr] = [];

    for (const nab of nonActiveBlocks) {
      const categoryTitle = nab[1].trim();
      const catLower = categoryTitle.toLowerCase();
      const rows = [...nab[2].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      for (const r of rows) {
        const tds = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
        if (tds.length < 2) continue;
        const linkMatch = tds[0][1].match(/<a\s+href="\/player\/([^/]+)\/(\d+)\/?">([^<]+)<\/a>/i);
        const name = linkMatch ? linkMatch[3].trim() : tds[0][1].replace(/<[^>]+>/g, '').trim();
        const otcId = linkMatch ? linkMatch[2] : `na_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        const capCharge = parseDollarCell(tds[tds.length - 1][1]);
        if (!name || capCharge === 0) continue;

        if (catLower.includes('dead')) {
          deadMoneyTotal += capCharge;
          deadMoneyLedgerByYear[yr].push({ otcId, name, capCharge });
        } else {
          if (catLower.includes('injured') || catLower.includes('pup')) irCapTotal += capCharge;
          if (catLower.includes('practice')) psCapTotal += capCharge;
          if (playersMap.has(otcId) && !playersMap.get(otcId).contractsByYear[yr]) {
            playersMap.get(otcId).contractsByYear[yr] = {
              year: Number(yr),
              rosterBucket: catLower.includes('practice') ? 'practice_squad' : 'ir',
              baseSalary: capCharge,
              proratedSigning: 0,
              proratedOption: 0,
              rosterBonusRegular: 0,
              rosterBonusPerGame: 0,
              workoutBonus: 0,
              otherBonus: 0,
              guaranteedSalary: 0,
              capNumber: capCharge,
              transactions: {
                cut: { deadMoney: capCharge, capSavings: 0 },
                june_1_cut: { deadMoney: capCharge, capSavings: 0 },
                trade: { deadMoney: capCharge, capSavings: 0 },
                june_1_trade: { deadMoney: capCharge, capSavings: 0 },
                restructure: { deadMoney: 0, capSavings: 0 },
                extension: { deadMoney: 0, capSavings: 0 }
              }
            };
          }
        }
      }
    }

    const draftPoolReserve = yr === '2026' ? 0 : 8_850_000; // 2026 rookies already signed!
    const inSeasonBuffer = yr === '2026' ? 6_500_000 : 7_500_000;

    yearSummaries[yr] = {
      year: Number(yr),
      capCeiling: projectedCeilings[yr] || 301_200_000,
      totalLiabilities,
      top51,
      teamCapSpace,
      effectiveCapSpace: teamCapSpace - draftPoolReserve - inSeasonBuffer,
      offenseSpend,
      defenseSpend,
      specialSpend,
      deadMoneyTotal,
      irCapTotal,
      psCapTotal,
      draftPoolReserve,
      inSeasonBuffer,
      contractedCount: activeCount,
      topDeadMoneyEntries: deadMoneyLedgerByYear[yr].slice(0, 12)
    };
  }

  return {
    years: yearSummaries,
    otcPlayers: Array.from(playersMap.values())
  };
}
