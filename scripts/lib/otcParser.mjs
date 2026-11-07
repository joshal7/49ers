/**
 * OverTheCap Multi-Year HTML Parser for San Francisco 49ers
 * Parses Active Roster, Injured Reserve, Practice Squad, and Dead Money tables
 * across the live 5-year OTC window (dynamically detected from HTML, e.g. 2026–2030),
 * extracting exact Base Salary, Prorated Bonuses, Cap Hits, player slugs/IDs,
 * and Pre/Post-June 1 Cut, Trade, Restructure, & Extension deltas.
 */

export function parseDollarCell(raw = '') {
  const clean = String(raw || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!clean || clean === '-' || clean === '$0') return 0;
  const isNeg = (clean.startsWith('(') && clean.endsWith(')')) || clean.startsWith('-');
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

export function parseOverTheCapHtml(html = '', fallbackBaseYear = 2026) {
  const detectedYears = [...new Set([...String(html || '').matchAll(/\bid="y(20\d{2})"/g)].map(m => m[1]))]
    .sort((a, b) => Number(a) - Number(b))
    .slice(0, 5);
  const baseYrNum = detectedYears.length ? Number(detectedYears[0]) : Number(fallbackBaseYear) || new Date().getFullYear();
  const years =
    detectedYears.length >= 3
      ? detectedYears
      : Array.from({ length: 5 }, (_, i) => String(baseYrNum + i));
  const baseYearStr = years[0];

  const yearSummaries = {};
  const playersMap = new Map(); // key: numeric otcId
  const directoryMap = new Map(); // key: numeric otcId across ALL tables on the page (active, IR, PS, PUP, dead)
  const deadMoneyLedgerByYear = {};

  // Capture every genuine /player/<slug>/<otcId>/ anchor on the page for link resolution
  for (const lm of String(html || '').matchAll(/<a\s+href="\/player\/([^/"]+)\/(\d+)\/?"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const slug = lm[1].trim();
    const otcId = lm[2].trim();
    const name = lm[3].replace(/<[^>]+>/g, '').trim();
    if (slug && otcId && name && !directoryMap.has(otcId)) {
      directoryMap.set(otcId, { otcId, slug, name });
    }
  }

  // Projected NFL Cap Ceilings for multi-year planning (with linear CBA growth extrapolation for future years)
  const knownCeilings = {
    '2026': 301_200_000,
    '2027': 323_500_000,
    '2028': 346_000_000,
    '2029': 368_500_000,
    '2030': 391_000_000
  };
  const getProjectedCeiling = yrStr =>
    knownCeilings[yrStr] || Math.round(301_200_000 + Math.max(0, Number(yrStr) - 2026) * 22_500_000);

  for (let idx = 0; idx < years.length; idx++) {
    const yr = years[idx];
    const nextYr = years[idx + 1] || String(Number(yr) + 1);
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
        const linkMatch = rowHtml.match(/<a\s+href="\/player\/([^/"]+)\/(\d+)\/?"[^>]*>([\s\S]*?)<\/a>/i);
        if (!linkMatch) continue;
        const slug = linkMatch[1].trim();
        const otcId = linkMatch[2].trim();
        const name = linkMatch[3].replace(/<[^>]+>/g, '').trim();
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
        } else if (slug && !playersMap.get(otcId).slug) {
          playersMap.get(otcId).slug = slug;
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
        const linkMatch = tds[0][1].match(/<a\s+href="\/player\/([^/"]+)\/(\d+)\/?"[^>]*>([\s\S]*?)<\/a>/i);
        const slug = linkMatch ? linkMatch[1].trim() : null;
        const otcId = linkMatch ? linkMatch[2].trim() : `na_${tds[0][1].replace(/<[^>]+>/g, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        const name = linkMatch
          ? linkMatch[3].replace(/<[^>]+>/g, '').trim()
          : tds[0][1].replace(/<[^>]+>/g, '').trim();
        const capCharge = parseDollarCell(tds[tds.length - 1][1]);
        if (!name || capCharge === 0) continue;

        if (catLower.includes('dead')) {
          deadMoneyTotal += capCharge;
          deadMoneyLedgerByYear[yr].push({
            otcId,
            slug,
            otcUrl: slug && /^\d+$/.test(otcId) ? `https://overthecap.com/player/${slug}/${otcId}/` : null,
            name,
            capCharge
          });
        } else {
          if (catLower.includes('injured') || catLower.includes('pup')) irCapTotal += capCharge;
          if (catLower.includes('practice')) psCapTotal += capCharge;

          // Ensure IR / PUP / Practice Squad players WITH genuine OTC links are registered in playersMap
          // even when they do not appear in the active-roster table for that season.
          if (linkMatch && /^\d+$/.test(otcId) && !playersMap.has(otcId)) {
            playersMap.set(otcId, {
              otcId,
              slug,
              name,
              contractsByYear: {}
            });
          }

          if (playersMap.has(otcId) && !playersMap.get(otcId).contractsByYear[yr]) {
            if (slug && !playersMap.get(otcId).slug) {
              playersMap.get(otcId).slug = slug;
            }
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

    const draftPoolReserve = yr === baseYearStr ? 0 : 8_850_000;
    const inSeasonBuffer = yr === baseYearStr ? 6_500_000 : 7_500_000;

    yearSummaries[yr] = {
      year: Number(yr),
      capCeiling: getProjectedCeiling(yr),
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

  // Merge any remaining directory-only OTC links (e.g. dead-money-only or zero-dollar reserve players)
  // into `otcDirectory` so player link resolution never misses a genuine OTC slug/ID.
  for (const [otcId, p] of playersMap.entries()) {
    if (!directoryMap.has(otcId) && p.slug) {
      directoryMap.set(otcId, { otcId, slug: p.slug, name: p.name });
    }
  }

  return {
    baseYear: Number(baseYearStr),
    yearKeys: years,
    years: yearSummaries,
    otcPlayers: Array.from(playersMap.values()),
    otcDirectory: Array.from(directoryMap.values())
  };
}
