#!/usr/bin/env node
/**
 * Builds the permanent static landing page for `nfl.joshal.com` into `dist-nfl/`.
 *
 * Architecture:
 *   - 100% static Cloudflare Pages site (dedicated project `nfl-joshal`, separate from `nfl-teams`).
 *   - Single source of truth: reads all 32 teams, divisions, fanbase brand names, slugs, and theme accents
 *     directly from `src/config/teamRegistry.js`.
 *   - Layout: Two conference columns (`NFC` | `AFC`), each containing `North`, `South`, `East`, `West`
 *     in exact order, with teams alphabetized by team name inside each division.
 *   - Engineered to fit all 32 JOSHAL team icons + fanbase names cleanly on ONE iPhone screen
 *     (and ONE desktop screen) with 0px horizontal overflow and zero visual clutter.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ALL_NFL_TEAMS } from '../src/config/teamRegistry.js';
import {
  SHARED_GEMINI_KEY_CHANNEL,
  SHARED_GEMINI_KEY_STORAGE_KEY,
  SHARED_KEY_HASH_PARAM,
  getAllowedNflTeamOrigins
} from '../src/services/sharedApiKeyStore.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist-nfl');
const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const PORTAL_CONFERENCES = ['NFC', 'AFC'];
export const PORTAL_DIVISIONS = ['North', 'South', 'East', 'West'];
const ASSET_VER = '5';

const NFL_MONOGRAM_PATHS = {
  N: 'M -124,-48 L -95,-48 L -68,7 L -68,-34 L -74,-34 L -74,-48 L -42,-48 L -42,-34 L -48,-34 L -48,48 L -71,48 L -98,-7 L -98,34 L -92,34 L -92,48 L -124,48 L -124,34 L -118,34 L -118,-34 L -124,-34 Z',
  F: 'M -27,-48 L 37,-48 L 37,-18 L 22,-18 L 22,-30 L -1,-30 L -1,-9 L 13,-9 L 13,-14 L 26,-14 L 26,12 L 13,12 L 13,7 L -1,7 L -1,34 L 7,34 L 7,48 L -27,48 L -27,34 L -21,34 L -21,-34 L -27,-34 Z',
  L: 'M 52,-48 L 84,-48 L 84,-34 L 78,-34 L 78,30 L 109,30 L 109,16 L 124,16 L 124,48 L 52,48 L 52,34 L 58,34 L 58,-34 L 52,-34 Z'
};

function buildStarPath(cx, cy, rOuter, rInner) {
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? rOuter : rInner;
    pts.push(`${(cx + Math.cos(angle) * r).toFixed(2)},${(cy + Math.sin(angle) * r).toFixed(2)}`);
  }
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`;
}

function buildFootballPath(cx, cy, rx, ry) {
  const xL = (cx - rx).toFixed(2);
  const xR = (cx + rx).toFixed(2);
  const xC1 = (cx - rx * 0.56).toFixed(2);
  const xC2 = (cx + rx * 0.56).toFixed(2);
  const yTop = (cy - ry * 1.18).toFixed(2);
  const yBot = (cy + ry * 1.18).toFixed(2);
  const yMid = cy.toFixed(2);
  return `M ${xL} ${yMid} C ${xC1} ${yTop}, ${xC2} ${yTop}, ${xR} ${yMid} C ${xC2} ${yBot}, ${xC1} ${yBot}, ${xL} ${yMid} Z`;
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getGroupedPortalTeams() {
  return PORTAL_CONFERENCES.map(conference => ({
    conference,
    divisions: PORTAL_DIVISIONS.map(divisionName => {
      const fullDiv = `${conference} ${divisionName}`;
      const teams = ALL_NFL_TEAMS
        .filter(t => t.division === fullDiv)
        .slice()
        .sort((a, b) => a.nickname.localeCompare(b.nickname, 'en', { sensitivity: 'base' }));
      return { name: divisionName, fullDiv, teams };
    })
  }));
}

export function buildNflCrestSvg() {
  const starCoords = [
    [102, 91], [129, 76], [156, 66], [184, 60],
    [276, 60], [304, 66], [331, 76], [358, 91]
  ];
  const starsMarkup = starCoords
    .map(([x, y]) => `<path d="${buildStarPath(x, y, 9.8, 4.1)}" fill="#FFFFFF" opacity="0.9"/>`)
    .join('\n      ');

  // 7 calm, balanced vertical stripes: muted satin crimson alternating with dimmed cool silver-white
  const stripeCount = 7;
  const xStart = 42;
  const stripeWidth = 376 / stripeCount;
  const stripes = Array.from({ length: stripeCount }, (_, i) => {
    const x = (xStart + i * stripeWidth).toFixed(2);
    const fill = i % 2 === 0 ? 'url(#crestRed)' : 'url(#crestMist)';
    return `<rect x="${x}" y="102" width="${(stripeWidth + 0.6).toFixed(2)}" height="150" fill="${fill}"/>`;
  }).join('\n      ');

  const lettersPath = `${NFL_MONOGRAM_PATHS.N} ${NFL_MONOGRAM_PATHS.F} ${NFL_MONOGRAM_PATHS.L}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 272" width="460" height="272">
  <defs>
    <linearGradient id="crestSilver" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F1F5F9"/>
      <stop offset="52%" stop-color="#B8C4D4"/>
      <stop offset="100%" stop-color="#6F8096"/>
    </linearGradient>
    <linearGradient id="crestNavy" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B3A84"/>
      <stop offset="58%" stop-color="#062559"/>
      <stop offset="100%" stop-color="#04193E"/>
    </linearGradient>
    <linearGradient id="crestStripeBase" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#171E30"/>
      <stop offset="100%" stop-color="#0C111E"/>
    </linearGradient>
    <linearGradient id="crestRed" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#A3162B"/>
      <stop offset="58%" stop-color="#871022"/>
      <stop offset="100%" stop-color="#5E0A17"/>
    </linearGradient>
    <linearGradient id="crestMist" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#CBD5E1" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="#64748B" stop-opacity="0.24"/>
    </linearGradient>
    <linearGradient id="crestLetter" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#EBF1F8"/>
    </linearGradient>
    <linearGradient id="crestEdgeShade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#030816" stop-opacity="0.36"/>
      <stop offset="20%" stop-color="#030816" stop-opacity="0"/>
      <stop offset="80%" stop-color="#030816" stop-opacity="0"/>
      <stop offset="100%" stop-color="#030816" stop-opacity="0.36"/>
    </linearGradient>
    <filter id="crestTextShadow" x="-16%" y="-16%" width="132%" height="145%">
      <feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#020816" flood-opacity="0.78"/>
      <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-color="#020816" flood-opacity="0.54"/>
    </filter>
    <clipPath id="crestInnerClip">
      <ellipse cx="230" cy="136" rx="188" ry="110"/>
    </clipPath>
  </defs>
  <ellipse cx="230" cy="136" rx="228" ry="134" fill="#FFFFFF" stroke="#94A3B8" stroke-opacity="0.28" stroke-width="2"/>
  <ellipse cx="230" cy="136" rx="219" ry="126" fill="#081121"/>
  <ellipse cx="230" cy="136" rx="202" ry="118" fill="url(#crestSilver)"/>
  <g clip-path="url(#crestInnerClip)">
    <rect x="40" y="100" width="380" height="154" fill="url(#crestStripeBase)"/>
    <g>
      ${stripes}
    </g>
    <path d="M 40,113 Q 230,101 420,113 L 420,24 L 40,24 Z" fill="url(#crestNavy)"/>
    <path d="M 40,113 Q 230,101 420,113" fill="none" stroke="#E2E8F0" stroke-opacity="0.38" stroke-width="2.2"/>
    <g>
      ${starsMarkup}
    </g>
    <path d="${buildFootballPath(230, 62, 25, 13.5)}" fill="#FFFFFF" opacity="0.95"/>
    <line x1="217" y1="62" x2="243" y2="62" stroke="#041A3B" stroke-width="3.2" stroke-linecap="round"/>
    <line x1="223" y1="56.5" x2="223" y2="67.5" stroke="#041A3B" stroke-width="2.8" stroke-linecap="round"/>
    <line x1="230" y1="56" x2="230" y2="68" stroke="#041A3B" stroke-width="2.8" stroke-linecap="round"/>
    <line x1="237" y1="56.5" x2="237" y2="67.5" stroke="#041A3B" stroke-width="2.8" stroke-linecap="round"/>
    <rect x="40" y="24" width="380" height="226" fill="url(#crestEdgeShade)"/>
    <g transform="translate(230, 162) scale(0.98, 0.92)" filter="url(#crestTextShadow)">
      <path d="${lettersPath}" fill="url(#crestLetter)"/>
    </g>
  </g>
</svg>`;
}

export function buildNflPortalIconSvg({ fullBleedSquare = false } = {}) {
  const starCoords = [
    [146, 177], [169, 164], [193, 155], [218, 150],
    [294, 150], [319, 155], [343, 164], [366, 177]
  ];
  const starsMarkup = starCoords
    .map(([x, y]) => `<path d="${buildStarPath(x, y, 8.2, 3.45)}" fill="url(#starFace)" opacity="0.92"/>`)
    .join('\n        ');

  // 7 calm, dimensional vertical stripes inside the inner oval (matching header crest rhythm)
  const stripeCount = 7;
  const xStart = 98;
  const stripeWidth = 316 / stripeCount;
  const stripesMarkup = Array.from({ length: stripeCount }, (_, i) => {
    const x = (xStart + i * stripeWidth).toFixed(2);
    const fill = i % 2 === 0 ? 'url(#ovalRed)' : 'url(#ovalMist)';
    return `<rect x="${x}" y="191" width="${(stripeWidth + 0.6).toFixed(2)}" height="124" fill="${fill}"/>`;
  }).join('\n        ');

  const lettersPath = `${NFL_MONOGRAM_PATHS.N} ${NFL_MONOGRAM_PATHS.F} ${NFL_MONOGRAM_PATHS.L}`;
  const ballPath = buildFootballPath(256, 152, 22.5, 12.2);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Deep Studio NFL Navy Base matching JOSHAL Icon Family -->
    <linearGradient id="bgBase" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#103272"/>
      <stop offset="46%" stop-color="#091C44"/>
      <stop offset="84%" stop-color="#050F27"/>
      <stop offset="100%" stop-color="#030816"/>
    </linearGradient>
    <radialGradient id="spotlight" cx="50%" cy="38%" r="58%">
      <stop offset="0%" stop-color="#3B82F6" stop-opacity="0.32"/>
      <stop offset="52%" stop-color="#1D4ED8" stop-opacity="0.11"/>
      <stop offset="100%" stop-color="#030816" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="afcGlow" cx="84%" cy="80%" r="54%">
      <stop offset="0%" stop-color="#DC2626" stop-opacity="0.24"/>
      <stop offset="60%" stop-color="#991B1B" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="#030816" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="50%" cy="50%" r="72%">
      <stop offset="56%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#02050C" stop-opacity="0.72"/>
    </radialGradient>
    <linearGradient id="glassSheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.16"/>
      <stop offset="42%" stop-color="#FFFFFF" stop-opacity="0.025"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>

    <!-- Multi-Stop Brushed Platinum Chrome Bezel -->
    <linearGradient id="chromeBezel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F8FAFC"/>
      <stop offset="30%" stop-color="#DCE4EE"/>
      <stop offset="58%" stop-color="#9EB0C5"/>
      <stop offset="85%" stop-color="#607289"/>
      <stop offset="100%" stop-color="#8B9DB3"/>
    </linearGradient>
    <linearGradient id="chromeInnerPin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.82"/>
      <stop offset="50%" stop-color="#CBD5E1" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#F8FAFC" stop-opacity="0.58"/>
    </linearGradient>

    <!-- Oval Interior: Velvety Starfield Canton + Dimmed Satin Stripes -->
    <radialGradient id="cantonNavy" cx="50%" cy="22%" r="68%">
      <stop offset="0%" stop-color="#144EB0"/>
      <stop offset="54%" stop-color="#062961"/>
      <stop offset="100%" stop-color="#031636"/>
    </radialGradient>
    <linearGradient id="ovalStripeBase" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#171E30"/>
      <stop offset="100%" stop-color="#0B101D"/>
    </linearGradient>
    <linearGradient id="ovalRed" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#A6172D"/>
      <stop offset="55%" stop-color="#871022"/>
      <stop offset="100%" stop-color="#580A16"/>
    </linearGradient>
    <linearGradient id="ovalMist" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#D1DAE6" stop-opacity="0.39"/>
      <stop offset="68%" stop-color="#94A3B8" stop-opacity="0.29"/>
      <stop offset="100%" stop-color="#64748B" stop-opacity="0.20"/>
    </linearGradient>
    <linearGradient id="cylShade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#020714" stop-opacity="0.46"/>
      <stop offset="18%" stop-color="#020714" stop-opacity="0.08"/>
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.07"/>
      <stop offset="82%" stop-color="#020714" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#020714" stop-opacity="0.46"/>
    </linearGradient>
    <linearGradient id="horizonBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#94A3B8" stop-opacity="0.18"/>
      <stop offset="28%" stop-color="#E2E8F0" stop-opacity="0.52"/>
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.70"/>
      <stop offset="72%" stop-color="#E2E8F0" stop-opacity="0.52"/>
      <stop offset="100%" stop-color="#94A3B8" stop-opacity="0.18"/>
    </linearGradient>
    <linearGradient id="starFace" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#D7E2F0"/>
    </linearGradient>
    <linearGradient id="ballBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="65%" stop-color="#EEF3F9"/>
      <stop offset="100%" stop-color="#BCC9DB"/>
    </linearGradient>
    <linearGradient id="letterFace" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="66%" stop-color="#F5F8FC"/>
      <stop offset="100%" stop-color="#DCE5F2"/>
    </linearGradient>
    <linearGradient id="ovalEnamel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.18"/>
      <stop offset="46%" stop-color="#FFFFFF" stop-opacity="0.025"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>

    <!-- JOSHAL Metallic Silver Flanking Rules -->
    <linearGradient id="ruleLeft" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#94A3B8" stop-opacity="0"/>
      <stop offset="100%" stop-color="#E2E8F0" stop-opacity="0.92"/>
    </linearGradient>
    <linearGradient id="ruleRight" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#E2E8F0" stop-opacity="0.92"/>
      <stop offset="100%" stop-color="#94A3B8" stop-opacity="0"/>
    </linearGradient>

    <filter id="crestShadow" x="-18%" y="-18%" width="136%" height="145%">
      <feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#020408" flood-opacity="0.76"/>
      <feDropShadow dx="0" dy="3" stdDeviation="3.5" flood-color="#000000" flood-opacity="0.52"/>
    </filter>
    <filter id="wordmarkShadow" x="-20%" y="-30%" width="140%" height="170%">
      <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#020408" flood-opacity="0.72"/>
    </filter>
    <filter id="badgeLift" x="-12%" y="-12%" width="124%" height="132%">
      <feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-color="#010918" flood-opacity="0.52"/>
    </filter>
    <filter id="monogramShadow" x="-18%" y="-18%" width="136%" height="148%">
      <feDropShadow dx="0" dy="5.5" stdDeviation="6" flood-color="#020714" flood-opacity="0.80"/>
      <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" flood-color="#020714" flood-opacity="0.54"/>
    </filter>

    <clipPath id="iconClip">
      <rect width="512" height="512" rx="${fullBleedSquare ? 0 : 112}"/>
    </clipPath>
    <clipPath id="ovalInnerClip">
      <ellipse cx="256" cy="212" rx="156" ry="94"/>
    </clipPath>
    <clipPath id="ballClip">
      <path d="${ballPath}"/>
    </clipPath>
  </defs>

  <g clip-path="url(#iconClip)">
    <!-- 1. Studio Background Layers (exact JOSHAL flagship family formula) -->
    <rect width="512" height="512" fill="url(#bgBase)"/>
    <rect width="512" height="512" fill="url(#spotlight)"/>
    <rect width="512" height="512" fill="url(#afcGlow)"/>
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

    <!-- 2. Detailed Multi-Bezel NFL Oval Crest Medallion (clean, balanced luxury studio finish) -->
    <g filter="url(#crestShadow)">
      <ellipse cx="256" cy="212" rx="188" ry="116" fill="#FFFFFF" opacity="0.97"/>
      <ellipse cx="256" cy="212" rx="180" ry="109" fill="#060B16"/>
      <ellipse cx="256" cy="212" rx="167" ry="101" fill="url(#chromeBezel)"/>
      <ellipse cx="256" cy="212" rx="165.5" ry="99.6" fill="none" stroke="url(#chromeInnerPin)" stroke-width="1.4"/>

      <g clip-path="url(#ovalInnerClip)">
        <!-- Dimmed Satin Crimson & Cool Silver-Mist Stripes -->
        <rect x="96" y="188" width="320" height="128" fill="url(#ovalStripeBase)"/>
        <g>
          ${stripesMarkup}
        </g>

        <!-- Upper Deep Navy Starfield Canton with Whisper-Soft Stadium Rays -->
        <path d="M 96,195 Q 256,182 416,195 L 416,114 L 96,114 Z" fill="url(#cantonNavy)"/>
        <g stroke="#93C5FD" stroke-opacity="0.10" stroke-width="1.1">
          <line x1="256" y1="152" x2="140" y2="112"/>
          <line x1="256" y1="152" x2="196" y2="110"/>
          <line x1="256" y1="152" x2="256" y2="108"/>
          <line x1="256" y1="152" x2="316" y2="110"/>
          <line x1="256" y1="152" x2="372" y2="112"/>
        </g>
        <ellipse cx="256" cy="148" rx="90" ry="30" fill="#3B82F6" opacity="0.16"/>

        <!-- Fine Brushed-Silver Curved Horizon Hairline -->
        <path d="M 96,195 Q 256,182 416,195" fill="none" stroke="url(#horizonBar)" stroke-width="2.2"/>

        <!-- 8 Sculpted Conference Division Stars (4 NFC left, 4 AFC right) -->
        <g filter="url(#badgeLift)">
          ${starsMarkup}
        </g>

        <!-- Detailed 3D Stitched Football -->
        <g filter="url(#badgeLift)">
          <path d="${ballPath}" fill="url(#ballBody)"/>
          <g clip-path="url(#ballClip)">
            <rect x="238" y="136" width="3.8" height="32" fill="#0B3E8C" opacity="0.72"/>
            <rect x="270.2" y="136" width="3.8" height="32" fill="#B5162B" opacity="0.76"/>
            <ellipse cx="256" cy="145" rx="17" ry="4.5" fill="#FFFFFF" opacity="0.6"/>
            <ellipse cx="256" cy="160.5" rx="21" ry="4.5" fill="#64748B" opacity="0.25"/>
          </g>
          <line x1="245" y1="152" x2="267" y2="152" stroke="#051E47" stroke-width="2.4" stroke-linecap="round"/>
          <line x1="248.3" y1="147.6" x2="248.3" y2="156.4" stroke="#051E47" stroke-width="1.9" stroke-linecap="round"/>
          <line x1="253.4" y1="147" x2="253.4" y2="157" stroke="#051E47" stroke-width="1.9" stroke-linecap="round"/>
          <line x1="258.6" y1="147" x2="258.6" y2="157" stroke="#051E47" stroke-width="1.9" stroke-linecap="round"/>
          <line x1="263.7" y1="147.6" x2="263.7" y2="156.4" stroke="#051E47" stroke-width="1.9" stroke-linecap="round"/>
        </g>

        <!-- Cylindrical 3D Depth Shading Across Oval -->
        <rect x="96" y="114" width="320" height="198" fill="url(#cylShade)"/>

        <!-- Clean Floating Athletic Slab-Serif NFL Monogram (subtle bevel + soft drop shadow, zero heavy border) -->
        <g transform="translate(256, 234) scale(0.84, 0.78)" filter="url(#monogramShadow)">
          <path d="${lettersPath}" fill="url(#letterFace)" stroke="#05132B" stroke-opacity="0.32" stroke-width="2.2" stroke-linejoin="round" paint-order="stroke fill"/>
          <path d="${lettersPath}" fill="none" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="1.4"/>
        </g>

        <!-- Subtle Enamel Top Glass Gloss -->
        <ellipse cx="256" cy="146" rx="156" ry="60" fill="url(#ovalEnamel)"/>
      </g>
    </g>

    <!-- 3. Standard JOSHAL Studio Wordmark Footer (exact match to all 32 team icons) -->
    <g filter="url(#wordmarkShadow)">
      <rect x="62" y="388.5" width="58" height="2" rx="1" fill="url(#ruleLeft)"/>
      <rect x="392" y="388.5" width="58" height="2" rx="1" fill="url(#ruleRight)"/>
      <circle cx="127" cy="389.5" r="2.2" fill="#E2E8F0" opacity="0.92"/>
      <circle cx="385" cy="389.5" r="2.2" fill="#E2E8F0" opacity="0.92"/>
      <g transform="translate(256.5, 402) scale(1.15, 1)">
        <text x="3.2" y="3.5" text-anchor="middle" font-family="Georgia, 'Charter', 'Times New Roman', serif" font-weight="900" font-size="37" letter-spacing="5" fill="#000000" stroke="#000000" stroke-width="3.2" stroke-linejoin="miter">JOSHAL</text>
        <text x="1.6" y="1.8" text-anchor="middle" font-family="Georgia, 'Charter', 'Times New Roman', serif" font-weight="900" font-size="37" letter-spacing="5" fill="#000000" stroke="#000000" stroke-width="3.2" stroke-linejoin="miter">JOSHAL</text>
        <text x="0" y="0" text-anchor="middle" font-family="Georgia, 'Charter', 'Times New Roman', serif" font-weight="900" font-size="37" letter-spacing="5" fill="#FFFFFF" stroke="#000000" stroke-width="2.8" stroke-linejoin="miter" paint-order="stroke fill">JOSHAL</text>
      </g>
    </g>
  </g>
</svg>`;
}

function rasterizePortalIconPng(svgMarkup, png180Path, png512Path = '') {
  const cached180 = path.join(ROOT, 'assets', 'nfl', 'apple-touch-icon-180.png');
  const cached512 = path.join(ROOT, 'assets', 'nfl', 'icon-512.png');
  if (!fs.existsSync(CHROME_BIN)) {
    if (fs.existsSync(cached180)) {
      fs.copyFileSync(cached180, png180Path);
    }
    if (png512Path && fs.existsSync(cached512)) {
      fs.copyFileSync(cached512, png512Path);
    }
    return fs.existsSync(png180Path);
  }
  const tmpHtml = path.join(path.dirname(png180Path), '_portal_icon_tmp.html');
  const tmp512 = path.join(path.dirname(png180Path), '_portal_icon_512.png');
  fs.writeFileSync(
    tmpHtml,
    `<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;width:512px;height:512px;overflow:hidden;background:#0B111E;}svg{display:block;width:512px;height:512px;}</style></head><body>${svgMarkup}</body></html>`
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
        `--screenshot=${tmp512}`,
        `file://${tmpHtml}`
      ],
      { stdio: 'pipe', timeout: 15000 }
    );
    if (png512Path) {
      fs.copyFileSync(tmp512, png512Path);
    }
    try {
      execFileSync('sips', ['-z', '180', '180', tmp512, '--out', png180Path], {
        stdio: 'pipe',
        timeout: 10000
      });
    } catch {
      fs.copyFileSync(tmp512, png180Path);
    }
    // Keep pre-rasterized assets/nfl/* synced so Linux CI builds are 100% deterministic without macOS Chrome/sips
    try {
      fs.mkdirSync(path.dirname(cached180), { recursive: true });
      fs.copyFileSync(png180Path, cached180);
      fs.copyFileSync(tmp512, cached512);
    } catch {}
    return true;
  } finally {
    fs.rmSync(tmpHtml, { force: true });
    fs.rmSync(tmp512, { force: true });
  }
}

function copyTeamIcons(iconsDir) {
  fs.mkdirSync(iconsDir, { recursive: true });
  const missing = [];

  for (const team of ALL_NFL_TEAMS) {
    const destPng = path.join(iconsDir, `${team.slug}.png`);
    if (team.abbr === 'SF') {
      const sfSrc = path.join(ROOT, 'apple-touch-icon.png');
      if (!fs.existsSync(sfSrc)) {
        missing.push(team.slug);
        continue;
      }
      try {
        execFileSync('sips', ['-z', '180', '180', sfSrc, '--out', destPng], {
          stdio: 'pipe',
          timeout: 10000
        });
      } catch {
        fs.copyFileSync(sfSrc, destPng);
      }
    } else {
      const src180 = path.join(ROOT, 'assets', 'teams', team.slug, 'apple-touch-icon-180.png');
      const src512 = path.join(ROOT, 'assets', 'teams', team.slug, 'apple-touch-icon.png');
      if (fs.existsSync(src180)) {
        fs.copyFileSync(src180, destPng);
      } else if (fs.existsSync(src512)) {
        fs.copyFileSync(src512, destPng);
      } else {
        missing.push(team.slug);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing JOSHAL icons for: ${missing.join(', ')}. Run "npm run build-team-icons:all" first.`
    );
  }
}

function renderTeamTile(team) {
  const href = `https://${team.slug}.joshal.com`;
  const hubHref = `./?team=${encodeURIComponent(team.slug)}`;
  const accent = team.themes?.dark?.primaryBright || '#60A5FA';
  const aria = escapeHtml(`${team.brandName} — ${team.fullName} (${team.domain})`);
  const tip = escapeHtml(`${team.brandName} — ${team.fullName}`);
  return `<a class="team-tile" href="${href}" data-external-href="${href}" data-hub-href="${hubHref}" data-team="${escapeHtml(team.slug)}" data-abbr="${escapeHtml(team.abbr)}" style="--team-accent:${escapeHtml(accent)}" aria-label="${aria}" title="${tip}">
                  <span class="logo-wrap">
                    <img class="team-logo" src="./icons/${escapeHtml(team.slug)}.png?v=${ASSET_VER}" alt="${escapeHtml(team.brandName)}" width="180" height="180" decoding="async" fetchpriority="high">
                  </span>
                </a>`;
}

function renderConferenceColumn({ conference, divisions }) {
  const confSlug = conference.toLowerCase();
  const divsHtml = divisions
    .map(
      ({ name, teams }) => `<div class="division" data-division="${escapeHtml(`${conference} ${name}`)}">
              <div class="div-header">
                <h3 class="div-title">${escapeHtml(name)}</h3>
                <span class="div-rule" aria-hidden="true"></span>
              </div>
              <div class="team-grid">
                ${teams.map(renderTeamTile).join('\n                ')}
              </div>
            </div>`
    )
    .join('\n            ');

  return `<section class="conference conference--${confSlug}" data-conference="${conference}" aria-label="${conference} Conference">
          <div class="conf-header">
            <span class="conf-dot" aria-hidden="true"></span>
            <h2 class="conf-title">${conference}</h2>
          </div>
          <div class="divisions">
            ${divsHtml}
          </div>
        </section>`;
}

function buildIndexHtml(grouped) {
  const conferencesHtml = grouped.map(renderConferenceColumn).join('\n        ');

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#080B10" id="metaThemeColor">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="NFL">
  <meta name="description" content="NFL Team Hub — All 32 NFC and AFC franchise hubs.">
  <title>NFL Team Hub</title>
  <link rel="icon" type="image/svg+xml" href="./nfl-icon.svg?v=${ASSET_VER}">
  <link rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png?v=${ASSET_VER}">
  <link rel="manifest" href="./manifest.json?v=${ASSET_VER}">
  <script>
    (function () {
      try {
        var saved = localStorage.getItem('nfl_joshal_theme_v1');
        var theme = saved === 'light' || saved === 'dark'
          ? saved
          : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
        document.documentElement.setAttribute('data-theme', theme);
        var m = document.getElementById('metaThemeColor');
        if (m) m.setAttribute('content', theme === 'light' ? '#F5F6FA' : '#080B10');
      } catch (e) {}
    })();
  </script>
  <style>
    :root {
      --bg: #080B10;
      --bg-card: rgba(17, 23, 34, 0.84);
      --bg-tile-hover: rgba(255, 255, 255, 0.055);
      --border: rgba(255, 255, 255, 0.08);
      --border-strong: rgba(255, 255, 255, 0.14);
      --text: #F4F7FC;
      --text-muted: #93A1B8;
      --text-subtle: #6D7C96;
      --nfc: #3B82F6;
      --nfc-soft: rgba(59, 130, 246, 0.14);
      --afc: #EF4444;
      --afc-soft: rgba(239, 68, 68, 0.14);
      --shadow-card: 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 8px 22px rgba(0, 0, 0, 0.3);
      --shadow-logo: 0 4px 12px rgba(0, 0, 0, 0.52), 0 0 0 1px rgba(255, 255, 255, 0.14);
      --icon-size: clamp(44px, min(16.2vw, 6.85dvh), 70px);
      --radius-card: 14px;
      --radius-tile: 14px;
      color-scheme: dark;
    }

    [data-theme="light"] {
      --bg: #F5F6FA;
      --bg-card: rgba(255, 255, 255, 0.94);
      --bg-tile-hover: rgba(15, 23, 42, 0.045);
      --border: rgba(15, 23, 42, 0.08);
      --border-strong: rgba(15, 23, 42, 0.16);
      --text: #0F172A;
      --text-muted: #475569;
      --text-subtle: #64748B;
      --nfc: #013369;
      --nfc-soft: rgba(1, 51, 105, 0.09);
      --afc: #C8102E;
      --afc-soft: rgba(200, 16, 46, 0.09);
      --shadow-card: 0 1px 2px rgba(15, 23, 42, 0.05), 0 6px 18px rgba(15, 23, 42, 0.05);
      --shadow-logo: 0 4px 12px rgba(15, 23, 42, 0.2), 0 0 0 1px rgba(15, 23, 42, 0.08);
      color-scheme: light;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }

    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Inter', system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      overflow-x: hidden;
    }

    body {
      min-height: 100dvh;
      background-image:
        radial-gradient(60% 45% at 14% 0%, var(--nfc-soft), transparent 72%),
        radial-gradient(60% 45% at 86% 0%, var(--afc-soft), transparent 72%);
      background-attachment: fixed;
    }

    .shell {
      width: 100%;
      max-width: 1160px;
      margin: 0 auto;
      padding-top: max(7px, env(safe-area-inset-top));
      padding-bottom: max(7px, env(safe-area-inset-bottom));
      padding-left: max(10px, env(safe-area-inset-left));
      padding-right: max(10px, env(safe-area-inset-right));
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    /* Single-screen fit lock on portrait phones, tablets, and desktops */
    @media (min-height: 590px) {
      html, body {
        height: 100dvh;
        overflow: hidden;
      }
      .shell {
        height: 100dvh;
      }
    }

    /* Top bar: crisp per-team-consistent oval crest + title + subtle theme switch */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex: 0 0 auto;
      padding: 0 2px;
      min-height: 26px;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      color: var(--text);
      min-width: 0;
    }

    .brand-crest {
      display: block;
      width: 34px;
      height: 20px;
      flex: 0 0 auto;
      object-fit: contain;
      filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.42));
    }

    [data-theme="light"] .brand-crest {
      filter: drop-shadow(0 1px 2.5px rgba(15, 23, 42, 0.24));
    }

    .brand-title {
      margin: 0;
      font-size: 15px;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.15;
      color: var(--text);
      white-space: nowrap;
    }

    .theme-btn {
      appearance: none;
      border: 1px solid var(--border);
      background: var(--bg-card);
      color: var(--text-muted);
      width: 26px;
      height: 26px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      transition: background 140ms ease, color 140ms ease, border-color 140ms ease, transform 120ms ease;
    }

    .theme-btn:hover {
      color: var(--text);
      border-color: var(--border-strong);
    }

    .theme-btn:active {
      transform: scale(0.92);
    }

    .theme-btn svg {
      width: 13px;
      height: 13px;
      display: block;
    }

    .icon-sun { display: none; }
    [data-theme="dark"] .icon-sun { display: block; }
    [data-theme="dark"] .icon-moon { display: none; }
    [data-theme="light"] .icon-sun { display: none; }
    [data-theme="light"] .icon-moon { display: block; }

    /* Two-column NFC / AFC layout */
    .conferences {
      flex: 1 1 0;
      min-height: 0;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 9px;
    }

    .conference {
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
      gap: 6px;
    }

    .conf-header {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 9px;
      background: var(--bg-card);
      border: 1px solid var(--border);
    }

    .conference--nfc .conf-header {
      border-color: color-mix(in srgb, var(--nfc) 32%, var(--border));
      background: linear-gradient(180deg, var(--nfc-soft), var(--bg-card));
    }

    .conference--afc .conf-header {
      border-color: color-mix(in srgb, var(--afc) 32%, var(--border));
      background: linear-gradient(180deg, var(--afc-soft), var(--bg-card));
    }

    .conf-dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      flex: 0 0 auto;
    }

    .conference--nfc .conf-dot {
      background: var(--nfc);
      box-shadow: 0 0 8px var(--nfc);
    }

    .conference--afc .conf-dot {
      background: var(--afc);
      box-shadow: 0 0 8px var(--afc);
    }

    .conf-title {
      margin: 0;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.14em;
      line-height: 1.2;
      color: var(--text);
    }

    /* Four divisions stacked vertically: North, South, East, West */
    .divisions {
      flex: 1 1 0;
      min-height: 0;
      display: grid;
      grid-template-rows: repeat(4, minmax(0, 1fr));
      gap: 7px;
    }

    .division {
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      padding: 5px 7px 6px;
      box-shadow: var(--shadow-card);
    }

    .div-header {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 3px 4px;
    }

    .div-title {
      margin: 0;
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.13em;
      color: var(--text-subtle);
      line-height: 1;
      flex: 0 0 auto;
    }

    .div-rule {
      flex: 1 1 auto;
      height: 1px;
      background: var(--border);
    }

    /* 2x2 logo grid per division on iPhone: large readable logos + balanced whitespace */
    .team-grid {
      flex: 1 1 0;
      min-height: 0;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-rows: repeat(2, minmax(0, 1fr));
      place-items: center;
      gap: 5px;
    }

    .team-tile {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px;
      border-radius: var(--radius-tile);
      text-decoration: none;
      color: var(--text);
      transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1), background 150ms ease;
      outline: none;
    }

    .team-tile:hover {
      transform: translateY(-2px) scale(1.035);
    }

    .team-tile:active {
      transform: scale(0.94);
    }

    .team-tile:focus-visible .logo-wrap {
      box-shadow: 0 0 0 2.5px var(--team-accent, var(--nfc)), var(--shadow-logo);
    }

    .logo-wrap {
      display: block;
      width: var(--icon-size);
      height: var(--icon-size);
      border-radius: 22.5%;
      overflow: hidden;
      box-shadow: var(--shadow-logo);
      transition: box-shadow 160ms ease;
      background: #0B1018;
    }

    .team-tile:hover .logo-wrap {
      box-shadow: 0 8px 18px rgba(0, 0, 0, 0.44), 0 0 0 2px var(--team-accent, rgba(255, 255, 255, 0.36));
    }

    .team-logo {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    /* Taller phones (iPhone 14/15/16/Pro/Pro Max): bold readable logos + generous even air */
    @media (min-height: 760px) and (max-width: 859px) {
      :root {
        --icon-size: clamp(56px, min(16.6vw, 7.25dvh), 72px);
      }
      .shell {
        gap: 9px;
        padding-top: max(12px, env(safe-area-inset-top));
        padding-bottom: max(12px, env(safe-area-inset-bottom));
        padding-left: max(12px, env(safe-area-inset-left));
        padding-right: max(12px, env(safe-area-inset-right));
      }
      .conferences {
        gap: 11px;
      }
      .conference {
        gap: 8px;
      }
      .divisions {
        gap: 9px;
      }
      .division {
        padding: 7px 9px 9px;
      }
      .div-header {
        padding: 0 3px 5px;
      }
      .div-title {
        font-size: 10px;
      }
      .team-grid {
        gap: 8px;
      }
    }

    /* Short landscape phone fallback: never crush below readable height */
    @media (max-height: 589px) {
      :root {
        --icon-size: 60px;
      }
      .shell {
        padding: 10px 16px 18px;
        gap: 10px;
      }
      .conferences,
      .divisions,
      .team-grid {
        flex: none;
        min-height: auto;
      }
      .divisions {
        grid-template-rows: auto;
        gap: 10px;
      }
      .division {
        padding: 9px 10px 10px;
      }
      .team-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        grid-template-rows: auto;
        gap: 10px;
      }
    }

    /* Tablet & Desktop: crisp 4-across logo rows inside each division, still fits on ONE screen */
    @media (min-width: 860px) {
      :root {
        --icon-size: clamp(68px, min(7.6vw, 11.4dvh), 96px);
        --radius-card: 18px;
        --radius-tile: 18px;
      }
      .shell {
        padding: 16px 28px 22px;
        gap: 14px;
      }
      .topbar {
        min-height: 34px;
      }
      .brand {
        gap: 10px;
      }
      .brand-crest {
        width: 42px;
        height: 25px;
      }
      .brand-title {
        font-size: 17px;
      }
      .theme-btn {
        width: 32px;
        height: 32px;
      }
      .theme-btn svg {
        width: 15px;
        height: 15px;
      }
      .conferences {
        gap: 20px;
      }
      .conference {
        gap: 11px;
      }
      .conf-header {
        padding: 8px 14px;
        border-radius: 12px;
        gap: 8px;
      }
      .conf-dot {
        width: 8px;
        height: 8px;
      }
      .conf-title {
        font-size: 14px;
        letter-spacing: 0.16em;
      }
      .divisions {
        gap: 12px;
      }
      .division {
        padding: 10px 14px 12px;
      }
      .div-header {
        padding: 0 4px 8px;
        gap: 8px;
      }
      .div-title {
        font-size: 10.5px;
        letter-spacing: 0.14em;
      }
      .team-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        grid-template-rows: 1fr;
        gap: 12px;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand" aria-label="NFL Team Hub">
        <img class="brand-crest" src="./nfl-crest.svg?v=${ASSET_VER}" alt="" width="34" height="20" decoding="async" fetchpriority="high">
        <h1 class="brand-title">NFL Team Hub</h1>
      </div>
      <button type="button" class="theme-btn" id="themeToggle" aria-label="Toggle light and dark theme" title="Toggle theme">
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
        </svg>
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      </button>
    </header>

    <main class="conferences">
      ${conferencesHtml}
    </main>
  </div>

  <script>
    (function () {
      var SESSION_KEY = 'nfl_hub_standalone_session_v1';
      var SHARED_KEY_STORAGE = ${JSON.stringify(SHARED_GEMINI_KEY_STORAGE_KEY)};
      var HASH_PARAM = ${JSON.stringify(SHARED_KEY_HASH_PARAM)};
      var ALLOWED_HANDOFF_ORIGINS = new Set(${JSON.stringify(getKeySyncAllowedOrigins())});

      function normalizeSharedRecord(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        var t = Number(raw.t);
        if (!isFinite(t) || t <= 0) return null;
        var cleared = raw.c === 1 || raw.c === true;
        var k = cleared ? '' : String(raw.k || '').trim();
        var m = cleared ? '' : String(raw.m || '').trim();
        if (!cleared && !k) return null;
        return { v: 1, k: k, m: m, t: Math.floor(t), c: cleared ? 1 : 0 };
      }

      function decodeB64UrlJson(token) {
        try {
          var clean = String(token || '').trim();
          if (!clean || clean.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(clean)) return null;
          var pad = (4 - (clean.length % 4)) % 4;
          var b64 = clean.replace(/-/g, '+').replace(/_/g, '/') + new Array(pad + 1).join('=');
          var bin = atob(b64);
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
          var text = typeof TextDecoder === 'function' ? new TextDecoder().decode(bytes) : decodeURIComponent(escape(bin));
          return normalizeSharedRecord(JSON.parse(text));
        } catch (e) {
          return null;
        }
      }

      function encodeB64UrlJson(rec) {
        try {
          var norm = normalizeSharedRecord(rec);
          if (!norm) return '';
          var json = JSON.stringify(norm);
          var bin = typeof TextEncoder === 'function'
            ? (function () {
                var arr = new TextEncoder().encode(json);
                var s = '';
                for (var i = 0; i < arr.length; i += 1) s += String.fromCharCode(arr[i]);
                return s;
              })()
            : unescape(encodeURIComponent(json));
          return btoa(bin).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/g, '');
        } catch (e) {
          return '';
        }
      }

      function readStoredSharedKey() {
        try {
          var raw = localStorage.getItem(SHARED_KEY_STORAGE);
          if (raw) {
            var parsed = normalizeSharedRecord(JSON.parse(raw));
            if (parsed) return parsed;
          }
          var best = null;
          for (var i = 0; i < localStorage.length; i += 1) {
            var k = localStorage.key(i);
            if (!k || (k !== 'sf49ers_hq_prefs_v2' && !/^joshal_[a-z0-9-]+_hq_prefs_v1$/.test(k))) continue;
            try {
              var p = JSON.parse(localStorage.getItem(k) || 'null');
              var keyStr = p && typeof p.geminiApiKey === 'string' ? p.geminiApiKey.trim() : '';
              if (!keyStr) continue;
              var ts = Number((p && p.geminiApiKeyUpdatedAt) || 0);
              var cand = normalizeSharedRecord({
                v: 1,
                k: keyStr,
                m: p && typeof p.verifiedGeminiModel === 'string' ? p.verifiedGeminiModel.trim() : '',
                t: isFinite(ts) && ts > 0 ? Math.floor(ts) : Math.max(1, Date.now() - 1000),
                c: 0
              });
              if (cand && (!best || cand.t > best.t)) best = cand;
            } catch (e2) {}
          }
          if (best) {
            try { localStorage.setItem(SHARED_KEY_STORAGE, JSON.stringify(best)); } catch (e3) {}
          }
          return best;
        } catch (e) {
          return null;
        }
      }

      function writeStoredSharedKey(rec) {
        try {
          var norm = normalizeSharedRecord(rec);
          if (!norm) return null;
          var cur = readStoredSharedKey();
          if (cur && cur.t > norm.t) return cur;
          localStorage.setItem(SHARED_KEY_STORAGE, JSON.stringify(norm));
          return norm;
        } catch (e) {
          return null;
        }
      }

      function consumeIncomingKeyHandoff() {
        try {
          var hash = window.location.hash || '';
          if (!hash || hash.indexOf(HASH_PARAM + '=') === -1) return;
          var parts = hash.slice(1).split('&');
          var kept = [];
          var rec = null;
          for (var i = 0; i < parts.length; i += 1) {
            var part = parts[i];
            if (!part) continue;
            if (part.indexOf(HASH_PARAM + '=') === 0) {
              if (!rec) rec = decodeB64UrlJson(part.slice(HASH_PARAM.length + 1));
            } else {
              kept.push(part);
            }
          }
          var cleanHash = kept.length > 0 ? '#' + kept.join('&') : '';
          if (window.history && typeof window.history.replaceState === 'function') {
            window.history.replaceState(
              window.history.state,
              '',
              (window.location.pathname || '/') + (window.location.search || '') + cleanHash
            );
          }
          if (rec) writeStoredSharedKey(rec);
        } catch (e) {}
      }

      consumeIncomingKeyHandoff();
      readStoredSharedKey();

      function isStandalonePseudoApp() {
        try {
          if (window.navigator && window.navigator.standalone === true) return true;
          if (window.matchMedia) {
            if (
              window.matchMedia('(display-mode: standalone)').matches ||
              window.matchMedia('(display-mode: fullscreen)').matches ||
              window.matchMedia('(display-mode: minimal-ui)').matches ||
              window.matchMedia('(display-mode: window-controls-overlay)').matches
            ) {
              return true;
            }
          }
          if (sessionStorage.getItem(SESSION_KEY) === '1') return true;
        } catch (e) {}
        return false;
      }

      function syncTeamTileHrefs() {
        var standalone = isStandalonePseudoApp();
        if (standalone) {
          document.documentElement.setAttribute('data-standalone-app', 'true');
          try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) {}
        } else {
          document.documentElement.removeAttribute('data-standalone-app');
        }
        var tiles = document.querySelectorAll('a.team-tile[data-team]');
        for (var i = 0; i < tiles.length; i += 1) {
          var tile = tiles[i];
          var hubHref = tile.getAttribute('data-hub-href');
          var extHref = tile.getAttribute('data-external-href');
          if (standalone && hubHref) {
            tile.setAttribute('href', hubHref);
          } else if (extHref) {
            tile.setAttribute('href', extHref);
          }
        }
      }

      syncTeamTileHrefs();
      window.addEventListener('pageshow', function () {
        consumeIncomingKeyHandoff();
        syncTeamTileHrefs();
      });

      try {
        if (window.matchMedia) {
          var mq = window.matchMedia('(display-mode: standalone)');
          if (typeof mq.addEventListener === 'function') mq.addEventListener('change', syncTeamTileHrefs);
          else if (typeof mq.addListener === 'function') mq.addListener(syncTeamTileHrefs);
        }
      } catch (e) {}

      var mainEl = document.querySelector('.conferences');
      if (mainEl) {
        mainEl.addEventListener('click', function (ev) {
          var tile = ev.target && ev.target.closest ? ev.target.closest('a.team-tile[data-team]') : null;
          if (!tile || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
          if (isStandalonePseudoApp()) {
            var hubHref = tile.getAttribute('data-hub-href');
            if (hubHref && tile.getAttribute('href') !== hubHref) {
              tile.setAttribute('href', hubHref);
            }
            return;
          }
          var extHref = tile.getAttribute('data-external-href');
          if (!extHref) return;
          try {
            var dest = new URL(extHref, window.location.href);
            if (dest.origin === window.location.origin) return;
            if (!ALLOWED_HANDOFF_ORIGINS.has(dest.origin)) return;
            var rec = readStoredSharedKey();
            if (!rec) return;
            var token = encodeB64UrlJson(rec);
            if (!token) return;
            dest.hash = '#' + HASH_PARAM + '=' + token;
            tile.setAttribute('href', dest.toString());
            setTimeout(function () {
              tile.setAttribute('href', extHref);
            }, 250);
          } catch (e) {}
        });
      }

      var btn = document.getElementById('themeToggle');
      if (btn) {
        btn.addEventListener('click', function () {
          var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
          var next = cur === 'dark' ? 'light' : 'dark';
          document.documentElement.setAttribute('data-theme', next);
          var m = document.getElementById('metaThemeColor');
          if (m) m.setAttribute('content', next === 'light' ? '#F5F6FA' : '#080B10');
          try { localStorage.setItem('nfl_joshal_theme_v1', next); } catch (e) {}
        });
      }

      try {
        var host = String(window.location.hostname || '').toLowerCase();
        var isHubProd = host === 'nfl.joshal.com' || host === 'nfl-joshal.pages.dev' || host.endsWith('.nfl-joshal.pages.dev');
        if (isHubProd && 'serviceWorker' in navigator) {
          window.addEventListener('load', function () {
            navigator.serviceWorker.register('./sw.js?v=118', { updateViaCache: 'none' }).catch(function () {});
          }, { once: true });
        }
      } catch (e) {}
    })();
  </script>
</body>
</html>
`;
}

export function getKeySyncAllowedOrigins() {
  const fromRegistry = ALL_NFL_TEAMS.map(t => `https://${t.slug}.joshal.com`);
  return Array.from(new Set([...getAllowedNflTeamOrigins(), ...fromRegistry, 'https://nfl.joshal.com'])).sort();
}

export function buildKeySyncVaultHtml({ extraAllowedOrigins = [] } = {}) {
  const origins = Array.from(new Set([...getKeySyncAllowedOrigins(), ...extraAllowedOrigins]));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="robots" content="noindex,nofollow" />
  <title>NFL Key Sync Vault</title>
</head>
<body>
  <script>
    (function () {
      var CHANNEL = ${JSON.stringify(SHARED_GEMINI_KEY_CHANNEL)};
      var STORAGE_KEY = ${JSON.stringify(SHARED_GEMINI_KEY_STORAGE_KEY)};
      var ALLOWED_ORIGINS = new Set(${JSON.stringify(origins)});

      function normalizeRecord(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        var t = Number(raw.t);
        if (!isFinite(t) || t <= 0) return null;
        var cleared = raw.c === 1 || raw.c === true;
        var k = cleared ? '' : String(raw.k || '').trim();
        var m = cleared ? '' : String(raw.m || '').trim();
        if (!cleared && !k) return null;
        return { v: 1, k: k, m: m, t: Math.floor(t), c: cleared ? 1 : 0 };
      }

      function readStored() {
        try {
          var raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            var parsed = normalizeRecord(JSON.parse(raw));
            if (parsed) return parsed;
          }
          var best = null;
          for (var i = 0; i < localStorage.length; i += 1) {
            var k = localStorage.key(i);
            if (!k || (k !== 'sf49ers_hq_prefs_v2' && !/^joshal_[a-z0-9-]+_hq_prefs_v1$/.test(k))) continue;
            try {
              var p = JSON.parse(localStorage.getItem(k) || 'null');
              var keyStr = p && typeof p.geminiApiKey === 'string' ? p.geminiApiKey.trim() : '';
              if (!keyStr) continue;
              var ts = Number((p && p.geminiApiKeyUpdatedAt) || 0);
              var cand = normalizeRecord({
                v: 1,
                k: keyStr,
                m: p && typeof p.verifiedGeminiModel === 'string' ? p.verifiedGeminiModel.trim() : '',
                t: isFinite(ts) && ts > 0 ? Math.floor(ts) : Math.max(1, Date.now() - 1000),
                c: 0
              });
              if (cand && (!best || cand.t > best.t)) best = cand;
            } catch (e2) {}
          }
          if (best) {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(best)); } catch (e3) {}
          }
          return best;
        } catch (e) {
          return null;
        }
      }

      function writeStored(rec) {
        var next = normalizeRecord(rec);
        if (!next) return readStored();
        var cur = readStored();
        if (cur && cur.t > next.t) return cur;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          return next;
        } catch (e) {
          return cur;
        }
      }

      window.addEventListener('message', function (event) {
        if (!ALLOWED_ORIGINS.has(event.origin)) return;
        var msg = event.data;
        if (!msg || typeof msg !== 'object' || msg.channel !== CHANNEL || !msg.id) return;
        var reply = { channel: CHANNEL, id: msg.id, ok: true, record: null };
        if (msg.type === 'ping') {
          reply.ready = true;
        } else if (msg.type === 'get') {
          reply.record = readStored();
        } else if (msg.type === 'set') {
          reply.record = writeStored(msg.record);
        } else if (msg.type === 'clear') {
          var clearTs = Math.max(1, Math.floor(Number(msg.t) || Date.now()));
          reply.record = writeStored({ v: 1, k: '', m: '', t: clearTs, c: 1 });
        } else {
          reply.ok = false;
        }
        try {
          if (event.source && typeof event.source.postMessage === 'function') {
            event.source.postMessage(reply, event.origin);
          }
        } catch (e) {}
      });

      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ channel: CHANNEL, type: 'ready' }, '*');
        }
      } catch (e) {}
    })();
  </script>
</body>
</html>
`;
}

export function writeNflPortalAssetsToDir(
  targetDir,
  {
    portalHtmlFilename = 'index.html',
    appleTouchIconFilename = 'apple-touch-icon.png',
    writeManifestAndHeaders = true
  } = {}
) {
  fs.mkdirSync(targetDir, { recursive: true });

  // 1. Copy all 32 180x180 JOSHAL team icons
  copyTeamIcons(path.join(targetDir, 'icons'));

  // 2. Write portal oval crest + favicon + iOS apple-touch-icon
  const crestSvg = buildNflCrestSvg();
  const roundedSvg = buildNflPortalIconSvg({ fullBleedSquare: false });
  const squareSvg = buildNflPortalIconSvg({ fullBleedSquare: true });
  fs.writeFileSync(path.join(targetDir, 'nfl-crest.svg'), crestSvg, 'utf8');
  fs.writeFileSync(path.join(targetDir, 'nfl-icon.svg'), roundedSvg, 'utf8');
  rasterizePortalIconPng(
    squareSvg,
    path.join(targetDir, appleTouchIconFilename),
    path.join(targetDir, 'nfl-icon-512.png')
  );

  // 3. Generate portal HTML + hermetically sealed same-site key-sync.html vault
  const grouped = getGroupedPortalTeams();
  const html = buildIndexHtml(grouped);
  fs.writeFileSync(path.join(targetDir, portalHtmlFilename), html, 'utf8');
  fs.writeFileSync(path.join(targetDir, 'key-sync.html'), buildKeySyncVaultHtml(), 'utf8');

  if (writeManifestAndHeaders) {
    const manifest = {
      name: 'NFL Team Hub',
      short_name: 'NFL',
      description: 'All 32 NFC and AFC franchise hubs',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#080B10',
      theme_color: '#080B10',
      icons: [
        { src: `./${appleTouchIconFilename}`, sizes: '180x180', type: 'image/png' },
        { src: './nfl-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        { src: './nfl-icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
      ]
    };
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const frameAncestorsList = ["'self'", ...getKeySyncAllowedOrigins()].join(' ');
    const headersTxt = [
      '/*',
      '  X-Content-Type-Options: nosniff',
      '  Referrer-Policy: strict-origin-when-cross-origin',
      '',
      '/icons/*',
      '  Cache-Control: public, max-age=86400, stale-while-revalidate=604800',
      '',
      '/index.html',
      '  Cache-Control: public, max-age=300, stale-while-revalidate=3600',
      '',
      '/key-sync',
      `  Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; frame-ancestors ${frameAncestorsList}`,
      '  Cache-Control: public, max-age=300, stale-while-revalidate=3600',
      '',
      '/key-sync.html',
      `  Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; frame-ancestors ${frameAncestorsList}`,
      '  Cache-Control: public, max-age=300, stale-while-revalidate=3600',
      ''
    ].join('\n');
    fs.writeFileSync(path.join(targetDir, '_headers'), headersTxt, 'utf8');
  }

  return { grouped };
}

export function buildNflPortalDist() {
  fs.rmSync(DIST, { recursive: true, force: true });
  const { grouped } = writeNflPortalAssetsToDir(DIST, {
    portalHtmlFilename: 'index.html',
    appleTouchIconFilename: 'apple-touch-icon.png',
    writeManifestAndHeaders: true
  });

  let fileCount = 0;
  let totalBytes = 0;
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        fileCount += 1;
        totalBytes += fs.statSync(p).size;
      }
    }
  };
  walk(DIST);
  return { distDir: DIST, fileCount, totalBytes, grouped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = buildNflPortalDist();
  console.log(
    `[build:nfl] Built dist-nfl/ (${res.fileCount} files, ${(res.totalBytes / 1024).toFixed(1)} KB) ready for Cloudflare Pages (nfl-joshal).`
  );
}
