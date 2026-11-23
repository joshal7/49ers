/**
 * Verified NFL & International Stadium Coordinates, Roof Type, and Elevation Metadata
 * Used for outdoor kickoff weather formatting (Open-Meteo at build time + live ESPN scoreboard override)
 * and high-altitude indicators (>= 4,500 ft: Denver, Mexico City).
 * Indoor domes automatically suppress weather displays to avoid clutter.
 */

export const NFL_STADIUMS_BY_HOME_TEAM = {
  ARI: { name: 'State Farm Stadium', city: 'Glendale, AZ', lat: 33.5276, lon: -112.2626, roof: 'retractable', isIndoor: true, altitudeFt: 1080 },
  ATL: { name: 'Mercedes-Benz Stadium', city: 'Atlanta, GA', lat: 33.7554, lon: -84.4008, roof: 'retractable', isIndoor: true, altitudeFt: 1050 },
  BAL: { name: 'M&T Bank Stadium', city: 'Baltimore, MD', lat: 39.278, lon: -76.6227, roof: 'outdoor', isIndoor: false, altitudeFt: 30 },
  BUF: { name: 'Highmark Stadium', city: 'Orchard Park, NY', lat: 42.7738, lon: -78.787, roof: 'outdoor', isIndoor: false, altitudeFt: 790 },
  CAR: { name: 'Bank of America Stadium', city: 'Charlotte, NC', lat: 35.2258, lon: -80.8528, roof: 'outdoor', isIndoor: false, altitudeFt: 730 },
  CHI: { name: 'Soldier Field', city: 'Chicago, IL', lat: 41.8623, lon: -87.6167, roof: 'outdoor', isIndoor: false, altitudeFt: 590 },
  CIN: { name: 'Paycor Stadium', city: 'Cincinnati, OH', lat: 39.0955, lon: -84.5161, roof: 'outdoor', isIndoor: false, altitudeFt: 490 },
  CLE: { name: 'Huntington Bank Field', city: 'Cleveland, OH', lat: 41.5061, lon: -81.6995, roof: 'outdoor', isIndoor: false, altitudeFt: 580 },
  DAL: { name: 'AT&T Stadium', city: 'Arlington, TX', lat: 32.7473, lon: -97.0945, roof: 'retractable', isIndoor: true, altitudeFt: 600 },
  DEN: { name: 'Empower Field at Mile High', city: 'Denver, CO', lat: 39.7439, lon: -105.0201, roof: 'outdoor', isIndoor: false, altitudeFt: 5280 },
  DET: { name: 'Ford Field', city: 'Detroit, MI', lat: 42.34, lon: -83.0456, roof: 'dome', isIndoor: true, altitudeFt: 600 },
  GB: { name: 'Lambeau Field', city: 'Green Bay, WI', lat: 44.5013, lon: -88.0622, roof: 'outdoor', isIndoor: false, altitudeFt: 640 },
  HOU: { name: 'NRG Stadium', city: 'Houston, TX', lat: 29.6847, lon: -95.4107, roof: 'retractable', isIndoor: true, altitudeFt: 45 },
  IND: { name: 'Lucas Oil Stadium', city: 'Indianapolis, IN', lat: 39.7601, lon: -86.1639, roof: 'retractable', isIndoor: true, altitudeFt: 715 },
  JAX: { name: 'EverBank Stadium', city: 'Jacksonville, FL', lat: 30.3239, lon: -81.6373, roof: 'outdoor', isIndoor: false, altitudeFt: 15 },
  KC: { name: 'GEHA Field at Arrowhead Stadium', city: 'Kansas City, MO', lat: 39.0489, lon: -94.4839, roof: 'outdoor', isIndoor: false, altitudeFt: 880 },
  LAC: { name: 'SoFi Stadium', city: 'Inglewood, CA', lat: 33.9535, lon: -118.339, roof: 'dome', isIndoor: true, altitudeFt: 130 },
  LAR: { name: 'SoFi Stadium', city: 'Inglewood, CA', lat: 33.9535, lon: -118.339, roof: 'dome', isIndoor: true, altitudeFt: 130 },
  LV: { name: 'Allegiant Stadium', city: 'Las Vegas, NV', lat: 36.0909, lon: -115.1833, roof: 'dome', isIndoor: true, altitudeFt: 2150 },
  MIA: { name: 'Hard Rock Stadium', city: 'Miami Gardens, FL', lat: 25.958, lon: -80.2389, roof: 'outdoor', isIndoor: false, altitudeFt: 10 },
  MIN: { name: 'U.S. Bank Stadium', city: 'Minneapolis, MN', lat: 44.9736, lon: -93.2575, roof: 'dome', isIndoor: true, altitudeFt: 840 },
  NE: { name: 'Gillette Stadium', city: 'Foxborough, MA', lat: 42.0909, lon: -71.2643, roof: 'outdoor', isIndoor: false, altitudeFt: 260 },
  NO: { name: 'Caesars Superdome', city: 'New Orleans, LA', lat: 29.9511, lon: -90.0812, roof: 'dome', isIndoor: true, altitudeFt: 5 },
  NYG: { name: 'MetLife Stadium', city: 'East Rutherford, NJ', lat: 40.8128, lon: -74.0742, roof: 'outdoor', isIndoor: false, altitudeFt: 10 },
  NYJ: { name: 'MetLife Stadium', city: 'East Rutherford, NJ', lat: 40.8128, lon: -74.0742, roof: 'outdoor', isIndoor: false, altitudeFt: 10 },
  PHI: { name: 'Lincoln Financial Field', city: 'Philadelphia, PA', lat: 39.9008, lon: -75.1675, roof: 'outdoor', isIndoor: false, altitudeFt: 25 },
  PIT: { name: 'Acrisure Stadium', city: 'Pittsburgh, PA', lat: 40.4468, lon: -80.0158, roof: 'outdoor', isIndoor: false, altitudeFt: 730 },
  SEA: { name: 'Lumen Field', city: 'Seattle, WA', lat: 47.5952, lon: -122.3316, roof: 'outdoor', isIndoor: false, altitudeFt: 20 },
  SF: { name: "Levi's Stadium", city: 'Santa Clara, CA', lat: 37.4033, lon: -121.9694, roof: 'outdoor', isIndoor: false, altitudeFt: 40 },
  TB: { name: 'Raymond James Stadium', city: 'Tampa, FL', lat: 27.9759, lon: -82.5033, roof: 'outdoor', isIndoor: false, altitudeFt: 40 },
  TEN: { name: 'Nissan Stadium', city: 'Nashville, TN', lat: 36.1665, lon: -86.7713, roof: 'outdoor', isIndoor: false, altitudeFt: 420 },
  WAS: { name: 'Northwest Stadium', city: 'Landover, MD', lat: 38.9076, lon: -76.8645, roof: 'outdoor', isIndoor: false, altitudeFt: 180 }
};

export const INTERNATIONAL_STADIUMS = [
  { pattern: /banorte|azteca|mexico city/i, name: 'Estadio Banorte', city: 'Mexico City, Mexico', lat: 19.3029, lon: -99.1505, roof: 'outdoor', isIndoor: false, altitudeFt: 7200 },
  { pattern: /tottenham/i, name: 'Tottenham Hotspur Stadium', city: 'London, UK', lat: 51.6042, lon: -0.0662, roof: 'outdoor', isIndoor: false, altitudeFt: 85 },
  { pattern: /wembley/i, name: 'Wembley Stadium', city: 'London, UK', lat: 51.556, lon: -0.2795, roof: 'outdoor', isIndoor: false, altitudeFt: 120 },
  { pattern: /allianz|munich/i, name: 'Allianz Arena', city: 'Munich, Germany', lat: 48.2188, lon: 11.6247, roof: 'outdoor', isIndoor: false, altitudeFt: 1650 },
  { pattern: /olympiastadion|berlin/i, name: 'Olympiastadion', city: 'Berlin, Germany', lat: 52.5147, lon: 13.2395, roof: 'outdoor', isIndoor: false, altitudeFt: 170 },
  { pattern: /bernab[eé]u|madrid/i, name: 'Estadio Santiago Bernabéu', city: 'Madrid, Spain', lat: 40.453, lon: -3.6883, roof: 'retractable', isIndoor: true, altitudeFt: 2200 },
  { pattern: /corinthians|s[aã]o paulo|maracan[aã]|rio de janeiro/i, name: 'Arena Corinthians', city: 'São Paulo, Brazil', lat: -23.5453, lon: -46.4742, roof: 'outdoor', isIndoor: false, altitudeFt: 2520 },
  { pattern: /melbourne|mcg/i, name: 'Melbourne Cricket Ground', city: 'Melbourne, Australia', lat: -37.82, lon: 144.9834, roof: 'outdoor', isIndoor: false, altitudeFt: 80 },
  { pattern: /croke park|dublin/i, name: 'Croke Park', city: 'Dublin, Ireland', lat: 53.3607, lon: -6.2512, roof: 'outdoor', isIndoor: false, altitudeFt: 50 }
];

const TEAM_ABBR_ALIASES = { WSH: 'WAS', LA: 'LAR', JAC: 'JAX', OAK: 'LV', SD: 'LAC', STL: 'LAR' };

export function resolveNflStadiumMeta({ venueName = '', homeTeamAbbr = '' } = {}) {
  const vStr = String(venueName || '').trim();
  if (vStr) {
    for (const intl of INTERNATIONAL_STADIUMS) {
      if (intl.pattern.test(vStr)) return { ...intl };
    }
    const lower = vStr.toLowerCase();
    for (const st of Object.values(NFL_STADIUMS_BY_HOME_TEAM)) {
      const token = st.name.toLowerCase().split(' at ')[0].slice(0, 14);
      if (token && lower.includes(token)) return { ...st };
    }
  }
  const rawAbbr = String(homeTeamAbbr || '').trim().toUpperCase();
  const normAbbr = TEAM_ABBR_ALIASES[rawAbbr] || rawAbbr;
  if (normAbbr && NFL_STADIUMS_BY_HOME_TEAM[normAbbr]) {
    return { ...NFL_STADIUMS_BY_HOME_TEAM[normAbbr] };
  }
  return null;
}

export function windDegreesToCompass(deg) {
  if (deg === null || deg === undefined || !Number.isFinite(Number(deg))) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round((((Number(deg) % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

export function wmoCodeToShortCondition(code) {
  const c = Number(code);
  if (!Number.isFinite(c)) return '';
  if (c === 0) return 'Clear';
  if (c <= 2) return 'Partly Cloudy';
  if (c === 3) return 'Cloudy';
  if (c === 45 || c === 48) return 'Fog';
  if ((c >= 51 && c <= 57) || (c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'Rain';
  if ((c >= 71 && c <= 77) || (c >= 85 && c <= 86)) return 'Snow';
  if (c >= 95) return 'Storms';
  return '';
}

export function formatStadiumAltitudeLabel(stadiumMeta) {
  const alt = Number(stadiumMeta?.altitudeFt || 0);
  if (!Number.isFinite(alt) || alt < 4500) return '';
  return `${alt.toLocaleString('en-US')} ft`;
}

/**
 * Formats a concise, single-line outdoor weather readout (e.g. "64°F, 7 mph SW" or "57°F · Partly cloudy").
 * Strictly returns '' for indoor domes or missing temperature so domes remain clutter-free.
 */
export function formatMatchupWeatherInline(weather = null, stadiumMeta = null) {
  if (!weather || typeof weather !== 'object') return '';
  const isIndoor = weather.indoor === true || (weather.indoor !== false && stadiumMeta?.isIndoor === true);
  if (isIndoor) return '';
  const temp = weather.tempF != null && Number.isFinite(Number(weather.tempF))
    ? Math.round(Number(weather.tempF))
    : null;
  if (temp === null) return '';

  const parts = [`${temp}°F`];
  const wind = weather.windMph != null && Number.isFinite(Number(weather.windMph))
    ? Math.round(Number(weather.windMph))
    : null;
  const windDir = String(weather.windDir || '').trim();
  const cond = String(weather.condition || '').trim();
  const precip = weather.precipPct != null && Number.isFinite(Number(weather.precipPct))
    ? Math.round(Number(weather.precipPct))
    : null;

  if (wind !== null && wind >= 4) {
    parts.push(`${wind} mph${windDir ? ` ${windDir}` : ''}`);
  } else if (cond) {
    parts.push(cond);
  }
  if (precip !== null && precip >= 30 && !/rain|snow|storm/i.test(parts.join(' '))) {
    parts.push(`${precip}% precip`);
  } else if (cond && /rain|snow|storm|wind/i.test(cond) && !parts.includes(cond)) {
    parts.push(cond);
  }
  return parts.join(', ');
}
