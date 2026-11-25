#!/usr/bin/env node
/**
 * Generates per-team studio crests (`crest.svg`), PWA app icons (`app-icon.svg`),
 * and iOS Safari-compatible `512x512` & `180x180` PNG `apple-touch-icon` files
 * matching the `49ers.joshal.com` studio-gradient + JOSHAL wordmark aesthetic.
 *
 * Usage:
 *   node scripts/build-team-icons.mjs --teams=lions,bills
 *   node scripts/build-team-icons.mjs --all
 *
 * Note: Preserves custom flagship `assets/teams/49ers/{crest.svg,app-icon.svg,apple-touch-icon*.png}` artwork by default.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ALL_NFL_TEAMS, getTeamBySlug } from '../src/config/teamRegistry.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function darkenHex(hex, factor = 0.55) {
  const clean = String(hex || '#00338D').replace(/^#/, '');
  const n = parseInt(clean, 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * factor)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * factor)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * factor)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function lightenHex(hex, mix = 0.28) {
  const clean = String(hex || '#00338D').replace(/^#/, '');
  const n = parseInt(clean, 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) + (255 - ((n >> 16) & 255)) * mix));
  const g = Math.min(255, Math.round(((n >> 8) & 255) + (255 - ((n >> 8) & 255)) * mix));
  const b = Math.min(255, Math.round((n & 255) + (255 - (n & 255)) * mix));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

async function fetchEspnLogoDataUri(espnAbbr) {
  const url = `https://a.espncdn.com/i/teamlogos/nfl/500/${espnAbbr.toLowerCase()}.png`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null;
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

const LIGHT_MEDALLION_SLUGS = new Set(['jets', 'rams', 'giants', 'colts', 'cowboys']);

function buildCrestSvg(team, logoDataUri) {
  const pri = team.themes.crest.primary;
  const sec = team.themes.crest.secondary;
  const priDark = darkenHex(pri, 0.72);
  const secHi = lightenHex(sec, 0.25);
  const useLightInner = LIGHT_MEDALLION_SLUGS.has(team.slug);
  const innerStops = useLightInner
    ? `<stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="55%" stop-color="#F1F5F9"/>
      <stop offset="100%" stop-color="#CBD5E1"/>`
    : `<stop offset="0%" stop-color="${lightenHex(pri, 0.14)}"/>
      <stop offset="55%" stop-color="${pri}"/>
      <stop offset="100%" stop-color="${priDark}"/>`;

  if (logoDataUri) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 272" width="460" height="272">
  <defs>
    <linearGradient id="crestOuter" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${secHi}"/>
      <stop offset="50%" stop-color="${sec}"/>
      <stop offset="100%" stop-color="${darkenHex(sec, 0.75)}"/>
    </linearGradient>
    <linearGradient id="crestInner" x1="0" y1="0" x2="0" y2="1">
      ${innerStops}
    </linearGradient>
  </defs>
  <ellipse cx="230" cy="136" rx="228" ry="134" fill="#FFFFFF"/>
  <ellipse cx="230" cy="136" rx="220" ry="126" fill="#0B0F14"/>
  <ellipse cx="230" cy="136" rx="200" ry="118" fill="url(#crestOuter)"/>
  <ellipse cx="230" cy="136" rx="184" ry="108" fill="url(#crestInner)"/>
  <image href="${logoDataUri}" x="108" y="20" width="244" height="232" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 272" width="460" height="272">
  <ellipse cx="230" cy="136" rx="228" ry="134" fill="#FFFFFF"/>
  <ellipse cx="230" cy="136" rx="220" ry="126" fill="#0B0F14"/>
  <ellipse cx="230" cy="136" rx="200" ry="118" fill="${sec}"/>
  <ellipse cx="230" cy="136" rx="184" ry="108" fill="${pri}"/>
  <text x="230" y="168" text-anchor="middle" font-family="Georgia, serif" font-weight="900" font-size="118" letter-spacing="4" fill="#FFFFFF" stroke="#000000" stroke-width="6" paint-order="stroke fill">${team.abbr}</text>
</svg>`;
}

function buildAppIconSvg(team, logoDataUri, { fullBleedSquare = false } = {}) {
  const pri = team.themes.crest.primary;
  const sec = team.themes.crest.secondary;
  const topCol = lightenHex(pri, 0.12);
  const midCol = darkenHex(pri, 0.85);
  const deepCol = darkenHex(pri, 0.45);
  const voidCol = darkenHex(pri, 0.24);
  const spotCol = lightenHex(pri, 0.34);
  const secHi = lightenHex(sec, 0.28);

  const centerGraphic = logoDataUri
    ? `<g filter="url(#crestShadow)">
      <ellipse cx="256" cy="212" rx="186" ry="116" fill="#FFFFFF" opacity="0.96"/>
      <ellipse cx="256" cy="212" rx="178" ry="109" fill="#0A0E14"/>
      <ellipse cx="256" cy="212" rx="164" ry="101" fill="url(#secMetal)"/>
      <ellipse cx="256" cy="212" rx="152" ry="93" fill="url(#innerMedallion)"/>
      <image href="${logoDataUri}" x="134" y="102" width="244" height="220" preserveAspectRatio="xMidYMid meet"/>
    </g>`
    : `<g filter="url(#crestShadow)">
      <ellipse cx="256" cy="212" rx="186" ry="116" fill="#FFFFFF"/>
      <ellipse cx="256" cy="212" rx="168" ry="102" fill="url(#secMetal)"/>
      <ellipse cx="256" cy="212" rx="154" ry="93" fill="url(#innerMedallion)"/>
      <text x="256" y="242" text-anchor="middle" font-family="Georgia, serif" font-weight="900" font-size="96" fill="#FFFFFF" stroke="#000000" stroke-width="5" paint-order="stroke fill">${team.abbr}</text>
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgBase" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${topCol}"/>
      <stop offset="48%" stop-color="${midCol}"/>
      <stop offset="85%" stop-color="${deepCol}"/>
      <stop offset="100%" stop-color="${voidCol}"/>
    </linearGradient>
    <radialGradient id="spotlight" cx="50%" cy="38%" r="58%">
      <stop offset="0%" stop-color="${spotCol}" stop-opacity="0.52"/>
      <stop offset="55%" stop-color="${pri}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${voidCol}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="50%" cy="50%" r="72%">
      <stop offset="58%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#05070B" stop-opacity="0.66"/>
    </radialGradient>
    <linearGradient id="glassSheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.16"/>
      <stop offset="42%" stop-color="#FFFFFF" stop-opacity="0.02"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="secMetal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${secHi}"/>
      <stop offset="50%" stop-color="${sec}"/>
      <stop offset="100%" stop-color="${darkenHex(sec, 0.72)}"/>
    </linearGradient>
    <linearGradient id="innerMedallion" x1="0" y1="0" x2="0" y2="1">
      ${LIGHT_MEDALLION_SLUGS.has(team.slug)
        ? `<stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="55%" stop-color="#F1F5F9"/>
      <stop offset="100%" stop-color="#CBD5E1"/>`
        : `<stop offset="0%" stop-color="${lightenHex(pri, 0.16)}"/>
      <stop offset="55%" stop-color="${pri}"/>
      <stop offset="100%" stop-color="${darkenHex(pri, 0.72)}"/>`}
    </linearGradient>
    <linearGradient id="ruleLeft" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${sec}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${secHi}" stop-opacity="0.92"/>
    </linearGradient>
    <linearGradient id="ruleRight" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${secHi}" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="${sec}" stop-opacity="0"/>
    </linearGradient>
    <filter id="crestShadow" x="-18%" y="-18%" width="136%" height="145%">
      <feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#020408" flood-opacity="0.72"/>
      <feDropShadow dx="0" dy="3" stdDeviation="3.5" flood-color="#000000" flood-opacity="0.48"/>
    </filter>
    <filter id="wordmarkShadow" x="-20%" y="-30%" width="140%" height="170%">
      <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#020408" flood-opacity="0.68"/>
    </filter>
    <clipPath id="iconClip">
      <rect width="512" height="512" rx="${fullBleedSquare ? 0 : 112}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#iconClip)">
    <rect width="512" height="512" fill="url(#bgBase)"/>
    <rect width="512" height="512" fill="url(#spotlight)"/>
    <g stroke="#FFFFFF" stroke-opacity="0.032" stroke-width="1.5">
      <line x1="-60" y1="130" x2="210" y2="-40"/>
      <line x1="-60" y1="215" x2="345" y2="-40"/>
      <line x1="-60" y1="300" x2="480" y2="-40"/>
      <line x1="-40" y1="385" x2="572" y2="0"/>
      <line x1="50" y1="540" x2="572" y2="210"/>
      <line x1="185" y1="545" x2="572" y2="300"/>
      <line x1="320" y1="550" x2="572" y2="390"/>
    </g>
    <ellipse cx="256" cy="-28" rx="340" ry="175" fill="url(#glassSheen)"/>
    <rect width="512" height="512" fill="url(#vignette)"/>
    ${centerGraphic}
    <g filter="url(#wordmarkShadow)">
      <rect x="62" y="388.5" width="58" height="2" rx="1" fill="url(#ruleLeft)"/>
      <rect x="392" y="388.5" width="58" height="2" rx="1" fill="url(#ruleRight)"/>
      <circle cx="127" cy="389.5" r="2.2" fill="${secHi}" opacity="0.9"/>
      <circle cx="385" cy="389.5" r="2.2" fill="${secHi}" opacity="0.9"/>
      <g transform="translate(256.5, 402) scale(1.15, 1)">
        <text x="3.2" y="3.5" text-anchor="middle" font-family="Georgia, 'Charter', 'Times New Roman', serif" font-weight="900" font-size="37" letter-spacing="5" fill="#000000" stroke="#000000" stroke-width="3.2" stroke-linejoin="miter">JOSHAL</text>
        <text x="1.6" y="1.8" text-anchor="middle" font-family="Georgia, 'Charter', 'Times New Roman', serif" font-weight="900" font-size="37" letter-spacing="5" fill="#000000" stroke="#000000" stroke-width="3.2" stroke-linejoin="miter">JOSHAL</text>
        <text x="0" y="0" text-anchor="middle" font-family="Georgia, 'Charter', 'Times New Roman', serif" font-weight="900" font-size="37" letter-spacing="5" fill="#FFFFFF" stroke="#000000" stroke-width="2.8" stroke-linejoin="miter" paint-order="stroke fill">JOSHAL</text>
      </g>
    </g>
  </g>
</svg>`;
}

function rasterizeSvgToPng(svgPath, png512Path, png180Path) {
  if (!fs.existsSync(CHROME_BIN)) {
    throw new Error(`Google Chrome not found at ${CHROME_BIN}; cannot rasterize PNG apple-touch-icon.`);
  }
  const tmpHtml = path.join(path.dirname(png512Path), '_render_icon.html');
  const svgRaw = fs.readFileSync(svgPath, 'utf8');
  fs.writeFileSync(
    tmpHtml,
    `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;width:512px;height:512px;overflow:hidden;background:transparent;}svg{display:block;width:512px;height:512px;}</style></head><body>${svgRaw}</body></html>`
  );
  try {
    execFileSync(
      CHROME_BIN,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--window-size=512,512',
        `--screenshot=${png512Path}`,
        `file://${tmpHtml}`
      ],
      { stdio: 'pipe', timeout: 15000 }
    );
    execFileSync('sips', ['-z', '180', '180', png512Path, '--out', png180Path], {
      stdio: 'pipe',
      timeout: 10000
    });
  } finally {
    fs.rmSync(tmpHtml, { force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const allFlag = args.includes('--all');
  const teamsArg = args.find(a => a.startsWith('--teams='));
  const slugs = teamsArg && !allFlag
    ? teamsArg.replace('--teams=', '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : ALL_NFL_TEAMS.filter(t => t.abbr !== 'SF').map(t => t.slug);

  for (const slug of slugs) {
    const team = getTeamBySlug(slug);
    if (!team || team.abbr === 'SF') continue;
    const outDir = path.join(ROOT, 'assets', 'teams', team.slug);
    fs.mkdirSync(outDir, { recursive: true });

    const logoDataUri = await fetchEspnLogoDataUri(team.espnAbbr);
    const crestSvgPath = path.join(outDir, 'crest.svg');
    const appIconSvgPath = path.join(outDir, 'app-icon.svg');
    const png512Path = path.join(outDir, 'apple-touch-icon.png');
    const png180Path = path.join(outDir, 'apple-touch-icon-180.png');

    fs.writeFileSync(crestSvgPath, buildCrestSvg(team, logoDataUri), 'utf8');
    fs.writeFileSync(appIconSvgPath, buildAppIconSvg(team, logoDataUri, { fullBleedSquare: false }), 'utf8');
    const squareSvgPath = path.join(outDir, '_apple_square.svg');
    fs.writeFileSync(squareSvgPath, buildAppIconSvg(team, logoDataUri, { fullBleedSquare: true }), 'utf8');
    try {
      rasterizeSvgToPng(squareSvgPath, png512Path, png180Path);
    } finally {
      fs.rmSync(squareSvgPath, { force: true });
    }

    const s512 = fs.statSync(png512Path).size;
    const s180 = fs.statSync(png180Path).size;
    console.log(`[icons] Built ${team.slug} (${team.abbr}): logo=${Boolean(logoDataUri)} 512px=${s512}B 180px=${s180}B`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
