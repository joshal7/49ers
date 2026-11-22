#!/usr/bin/env node
/**
 * Builds the permanent static landing page for `nfl.joshal.com` into `dist-nfl/`.
 *
 * Architecture:
 *   - 100% static Cloudflare Pages site (dedicated project `nfl-joshal`, completely separate from `nfl-hq-canary`).
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
  getAllowedNflTeamOrigins
} from '../src/services/sharedApiKeyStore.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist-nfl');
const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const PORTAL_CONFERENCES = ['NFC', 'AFC'];
export const PORTAL_DIVISIONS = ['North', 'South', 'East', 'West'];
const ASSET_VER = '3';

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
    [98, 92], [126, 76], [154, 65], [182, 59],
    [278, 59], [306, 65], [334, 76], [362, 92]
  ];
  const starsMarkup = starCoords
    .map(([x, y]) => `<path d="${buildStarPath(x, y, 11.2, 4.7)}" fill="#FFFFFF"/>`)
    .join('\n      ');

  const stripeFills = [
    'url(#crestRed)', 'url(#crestWhite)', 'url(#crestRed)', 'url(#crestWhite)',
    'url(#crestRed)', 'url(#crestWhite)', 'url(#crestRed)', 'url(#crestWhite)', 'url(#crestRed)'
  ];
  const stripes = stripeFills
    .map((fill, i) => {
      const x = (44 + i * 41.34).toFixed(2);
      return `<rect x="${x}" y="102" width="42" height="150" fill="${fill}"/>`;
    })
    .join('\n      ');

  const lettersPath = `${NFL_MONOGRAM_PATHS.N} ${NFL_MONOGRAM_PATHS.F} ${NFL_MONOGRAM_PATHS.L}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 272" width="460" height="272">
  <defs>
    <linearGradient id="crestSilver" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F8FAFC"/>
      <stop offset="48%" stop-color="#CBD5E1"/>
      <stop offset="100%" stop-color="#7E8FA6"/>
    </linearGradient>
    <linearGradient id="crestNavy" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0B46A0"/>
      <stop offset="55%" stop-color="#013369"/>
      <stop offset="100%" stop-color="#011E44"/>
    </linearGradient>
    <linearGradient id="crestRed" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#E11D2E"/>
      <stop offset="55%" stop-color="#C8102E"/>
      <stop offset="100%" stop-color="#8F0A1D"/>
    </linearGradient>
    <linearGradient id="crestWhite" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#DCE4F0"/>
    </linearGradient>
    <linearGradient id="crestHorizon" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#94A3B8"/>
      <stop offset="50%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#94A3B8"/>
    </linearGradient>
    <linearGradient id="crestEdgeShade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#020814" stop-opacity="0.28"/>
      <stop offset="18%" stop-color="#020814" stop-opacity="0"/>
      <stop offset="82%" stop-color="#020814" stop-opacity="0"/>
      <stop offset="100%" stop-color="#020814" stop-opacity="0.28"/>
    </linearGradient>
    <clipPath id="crestInnerClip">
      <ellipse cx="230" cy="136" rx="184" ry="107"/>
    </clipPath>
  </defs>
  <ellipse cx="230" cy="136" rx="228" ry="134" fill="#FFFFFF" stroke="#94A3B8" stroke-opacity="0.32" stroke-width="2"/>
  <ellipse cx="230" cy="136" rx="219" ry="125" fill="#071122"/>
  <ellipse cx="230" cy="136" rx="201" ry="117" fill="url(#crestSilver)"/>
  <ellipse cx="230" cy="136" rx="187" ry="109" fill="#061022"/>
  <g clip-path="url(#crestInnerClip)">
    <g>
      ${stripes}
    </g>
    <path d="M 40,115 Q 230,101 420,115 L 420,24 L 40,24 Z" fill="url(#crestNavy)"/>
    <path d="M 40,118 Q 230,104 420,118" fill="none" stroke="#011532" stroke-width="6"/>
    <path d="M 40,115 Q 230,101 420,115" fill="none" stroke="url(#crestHorizon)" stroke-width="4.5"/>
    <g>
      ${starsMarkup}
    </g>
    <path d="${buildFootballPath(230, 62, 27, 14.5)}" fill="#FFFFFF"/>
    <line x1="215" y1="62" x2="245" y2="62" stroke="#012554" stroke-width="3.6" stroke-linecap="round"/>
    <line x1="222" y1="56" x2="222" y2="68" stroke="#012554" stroke-width="3.2" stroke-linecap="round"/>
    <line x1="230" y1="55.5" x2="230" y2="68.5" stroke="#012554" stroke-width="3.2" stroke-linecap="round"/>
    <line x1="238" y1="56" x2="238" y2="68" stroke="#012554" stroke-width="3.2" stroke-linecap="round"/>
    <rect x="44" y="26" width="372" height="220" fill="url(#crestEdgeShade)"/>
    <g transform="translate(230, 158) scale(0.97, 0.91)">
      <path d="${lettersPath}" transform="translate(4, 5)" fill="#01132E" stroke="#01132E" stroke-width="18" stroke-linejoin="round"/>
      <path d="${lettersPath}" fill="#FFFFFF" stroke="#011D47" stroke-width="17" stroke-linejoin="round" paint-order="stroke fill"/>
    </g>
  </g>
</svg>`;
}

export function buildNflPortalIconSvg({ fullBleedSquare = false } = {}) {
  const starCoords = [
    [144, 178], [168, 164], [193, 155], [218, 150],
    [294, 150], [319, 155], [344, 164], [368, 178]
  ];
  const starsMarkup = starCoords
    .map(([x, y]) => `<path d="${buildStarPath(x, y, 8.8, 3.7)}" fill="url(#starFace)" stroke="#011A40" stroke-width="1.2" paint-order="stroke fill"/>`)
    .join('\n        ');

  // 9 crisp vertical stripes inside the inner oval (x = 98..414, 316px -> 9 stripes of ~35.2px)
  const stripeColors = [
    'url(#ovalRed)', 'url(#ovalWhite)', 'url(#ovalRed)', 'url(#ovalWhite)',
    'url(#ovalRed)', 'url(#ovalWhite)', 'url(#ovalRed)', 'url(#ovalWhite)', 'url(#ovalRed)'
  ];
  const stripesMarkup = stripeColors
    .map((fill, i) => {
      const x = (98 + i * 35.12).toFixed(2);
      return `<rect x="${x}" y="192" width="35.6" height="122" fill="${fill}"/>`;
    })
    .join('\n        ');

  const lettersPath = `${NFL_MONOGRAM_PATHS.N} ${NFL_MONOGRAM_PATHS.F} ${NFL_MONOGRAM_PATHS.L}`;
  const ballPath = buildFootballPath(256, 152, 23.5, 13);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Deep Studio NFL Navy Base matching JOSHAL Icon Family -->
    <linearGradient id="bgBase" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#113478"/>
      <stop offset="46%" stop-color="#091D47"/>
      <stop offset="84%" stop-color="#051029"/>
      <stop offset="100%" stop-color="#030816"/>
    </linearGradient>
    <radialGradient id="spotlight" cx="50%" cy="38%" r="58%">
      <stop offset="0%" stop-color="#3B82F6" stop-opacity="0.34"/>
      <stop offset="52%" stop-color="#1D4ED8" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#030816" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="afcGlow" cx="84%" cy="80%" r="54%">
      <stop offset="0%" stop-color="#DC2626" stop-opacity="0.28"/>
      <stop offset="60%" stop-color="#991B1B" stop-opacity="0.08"/>
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
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="28%" stop-color="#E2E8F0"/>
      <stop offset="55%" stop-color="#A8B5C7"/>
      <stop offset="82%" stop-color="#64748B"/>
      <stop offset="100%" stop-color="#94A3B8"/>
    </linearGradient>
    <linearGradient id="chromeInnerPin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.88"/>
      <stop offset="50%" stop-color="#CBD5E1" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#F8FAFC" stop-opacity="0.65"/>
    </linearGradient>

    <!-- Oval Interior: Deep Starfield Canton + Dimensional Stripes -->
    <radialGradient id="cantonNavy" cx="50%" cy="22%" r="68%">
      <stop offset="0%" stop-color="#1759C4"/>
      <stop offset="52%" stop-color="#013369"/>
      <stop offset="100%" stop-color="#011B3D"/>
    </radialGradient>
    <linearGradient id="ovalRed" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#E5192D"/>
      <stop offset="50%" stop-color="#C8102E"/>
      <stop offset="100%" stop-color="#87081B"/>
    </linearGradient>
    <linearGradient id="ovalWhite" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="68%" stop-color="#EDF2F8"/>
      <stop offset="100%" stop-color="#CBD5E1"/>
    </linearGradient>
    <linearGradient id="cylShade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#010918" stop-opacity="0.42"/>
      <stop offset="18%" stop-color="#010918" stop-opacity="0.06"/>
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.09"/>
      <stop offset="82%" stop-color="#010918" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#010918" stop-opacity="0.42"/>
    </linearGradient>
    <linearGradient id="horizonBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#64748B"/>
      <stop offset="24%" stop-color="#E2E8F0"/>
      <stop offset="50%" stop-color="#FFFFFF"/>
      <stop offset="76%" stop-color="#E2E8F0"/>
      <stop offset="100%" stop-color="#64748B"/>
    </linearGradient>
    <linearGradient id="starFace" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#D7E2F0"/>
    </linearGradient>
    <linearGradient id="ballBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="65%" stop-color="#EEF3F9"/>
      <stop offset="100%" stop-color="#B8C7DB"/>
    </linearGradient>
    <linearGradient id="letterFace" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="65%" stop-color="#F1F5FA"/>
      <stop offset="100%" stop-color="#CBD7E8"/>
    </linearGradient>
    <linearGradient id="ovalEnamel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.22"/>
      <stop offset="46%" stop-color="#FFFFFF" stop-opacity="0.03"/>
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
      <feDropShadow dx="0" dy="3.5" stdDeviation="3" flood-color="#010918" flood-opacity="0.65"/>
    </filter>

    <clipPath id="iconClip">
      <rect width="512" height="512" rx="${fullBleedSquare ? 0 : 112}"/>
    </clipPath>
    <clipPath id="ovalInnerClip">
      <ellipse cx="256" cy="212" rx="154" ry="93"/>
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

    <!-- 2. Detailed Multi-Bezel NFL Oval Crest Medallion -->
    <g filter="url(#crestShadow)">
      <ellipse cx="256" cy="212" rx="188" ry="116" fill="#FFFFFF" opacity="0.97"/>
      <ellipse cx="256" cy="212" rx="180" ry="109" fill="#060B16"/>
      <ellipse cx="256" cy="212" rx="168" ry="102" fill="url(#chromeBezel)"/>
      <ellipse cx="256" cy="212" rx="166" ry="100.5" fill="none" stroke="url(#chromeInnerPin)" stroke-width="1.6"/>
      <ellipse cx="256" cy="212" rx="157" ry="95" fill="#040B18"/>

      <g clip-path="url(#ovalInnerClip)">
        <!-- Lower Dimensional Red & White Stripes -->
        <g>
          ${stripesMarkup}
        </g>

        <!-- Upper Deep Navy Starfield Canton with Subtle Stadium Rays -->
        <path d="M 96,196 Q 256,182 416,196 L 416,114 L 96,114 Z" fill="url(#cantonNavy)"/>
        <g stroke="#93C5FD" stroke-opacity="0.14" stroke-width="1.2">
          <line x1="256" y1="152" x2="140" y2="112"/>
          <line x1="256" y1="152" x2="196" y2="110"/>
          <line x1="256" y1="152" x2="256" y2="108"/>
          <line x1="256" y1="152" x2="316" y2="110"/>
          <line x1="256" y1="152" x2="372" y2="112"/>
          <line x1="256" y1="152" x2="116" y2="162"/>
          <line x1="256" y1="152" x2="396" y2="162"/>
        </g>
        <ellipse cx="256" cy="148" rx="92" ry="32" fill="#3B82F6" opacity="0.2"/>

        <!-- Curved Brushed-Silver Horizon Divider -->
        <path d="M 96,199 Q 256,185 416,199" fill="none" stroke="#01122C" stroke-width="5.5"/>
        <path d="M 96,196 Q 256,182 416,196" fill="none" stroke="url(#horizonBar)" stroke-width="3.6"/>
        <path d="M 96,194.6 Q 256,180.6 416,194.6" fill="none" stroke="#FFFFFF" stroke-opacity="0.6" stroke-width="0.9"/>

        <!-- 8 Sculpted Conference Division Stars (4 NFC left, 4 AFC right) -->
        <g filter="url(#badgeLift)">
          ${starsMarkup}
        </g>

        <!-- Detailed 3D Stitched Football -->
        <g filter="url(#badgeLift)">
          <path d="${ballPath}" fill="url(#ballBody)" stroke="#011B40" stroke-width="1.4"/>
          <g clip-path="url(#ballClip)">
            <rect x="237" y="136" width="4.2" height="32" fill="#013369" opacity="0.86"/>
            <rect x="270.8" y="136" width="4.2" height="32" fill="#C8102E" opacity="0.88"/>
            <ellipse cx="256" cy="144.5" rx="18" ry="5" fill="#FFFFFF" opacity="0.62"/>
            <ellipse cx="256" cy="161" rx="22" ry="5" fill="#64748B" opacity="0.28"/>
          </g>
          <line x1="244.5" y1="152" x2="267.5" y2="152" stroke="#011E47" stroke-width="2.6" stroke-linecap="round"/>
          <line x1="248" y1="147.2" x2="248" y2="156.8" stroke="#011E47" stroke-width="2.1" stroke-linecap="round"/>
          <line x1="253.3" y1="146.5" x2="253.3" y2="157.5" stroke="#011E47" stroke-width="2.1" stroke-linecap="round"/>
          <line x1="258.7" y1="146.5" x2="258.7" y2="157.5" stroke="#011E47" stroke-width="2.1" stroke-linecap="round"/>
          <line x1="264" y1="147.2" x2="264" y2="156.8" stroke="#011E47" stroke-width="2.1" stroke-linecap="round"/>
        </g>

        <!-- Cylindrical 3D Depth Shading Across Oval -->
        <rect x="98" y="116" width="316" height="194" fill="url(#cylShade)"/>

        <!-- 3D-Extruded Athletic Slab-Serif NFL Monogram -->
        <g transform="translate(256, 232) scale(0.82, 0.77)" filter="url(#badgeLift)">
          <path d="${lettersPath}" transform="translate(5.4, 6.4)" fill="#010E22" stroke="#010E22" stroke-width="18.5" stroke-linejoin="round"/>
          <path d="${lettersPath}" transform="translate(2.7, 3.2)" fill="#01183B" stroke="#01183B" stroke-width="18" stroke-linejoin="round"/>
          <path d="${lettersPath}" fill="url(#letterFace)" stroke="#011D47" stroke-width="16.5" stroke-linejoin="round" paint-order="stroke fill"/>
          <path d="${lettersPath}" fill="none" stroke="#FFFFFF" stroke-opacity="0.65" stroke-width="1.8"/>
        </g>

        <!-- Subtle Enamel Top Glass Gloss -->
        <ellipse cx="256" cy="146" rx="154" ry="62" fill="url(#ovalEnamel)"/>
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

function rasterizePortalIconPng(svgMarkup, png180Path) {
  if (!fs.existsSync(CHROME_BIN)) return false;
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
    execFileSync('sips', ['-z', '180', '180', tmp512, '--out', png180Path], {
      stdio: 'pipe',
      timeout: 10000
    });
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
  const accent = team.themes?.dark?.primaryBright || '#60A5FA';
  const aria = escapeHtml(`${team.brandName} — ${team.fullName} (${team.domain})`);
  const tip = escapeHtml(`${team.brandName} — ${team.fullName}`);
  return `<a class="team-tile" href="${href}" data-team="${escapeHtml(team.slug)}" data-abbr="${escapeHtml(team.abbr)}" style="--team-accent:${escapeHtml(accent)}" aria-label="${aria}" title="${tip}">
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
      var btn = document.getElementById('themeToggle');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
        var next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        var m = document.getElementById('metaThemeColor');
        if (m) m.setAttribute('content', next === 'light' ? '#F5F6FA' : '#080B10');
        try { localStorage.setItem('nfl_joshal_theme_v1', next); } catch (e) {}
      });
    })();
  </script>
</body>
</html>
`;
}

export function getKeySyncAllowedOrigins() {
  const fromRegistry = ALL_NFL_TEAMS.map(t => `https://${t.slug}.joshal.com`);
  return Array.from(new Set([...getAllowedNflTeamOrigins(), ...fromRegistry, 'https://49ers2.joshal.com', 'https://nfl.joshal.com'])).sort();
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
          if (!raw) return null;
          return normalizeRecord(JSON.parse(raw));
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
        if (msg.type === 'get') {
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
    })();
  </script>
</body>
</html>
`;
}

export function buildNflPortalDist() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // 1. Copy all 32 180x180 JOSHAL team icons
  copyTeamIcons(path.join(DIST, 'icons'));

  // 2. Write portal oval crest + favicon + iOS apple-touch-icon + manifest
  const crestSvg = buildNflCrestSvg();
  const roundedSvg = buildNflPortalIconSvg({ fullBleedSquare: false });
  const squareSvg = buildNflPortalIconSvg({ fullBleedSquare: true });
  fs.writeFileSync(path.join(DIST, 'nfl-crest.svg'), crestSvg, 'utf8');
  fs.writeFileSync(path.join(DIST, 'nfl-icon.svg'), roundedSvg, 'utf8');
  rasterizePortalIconPng(squareSvg, path.join(DIST, 'apple-touch-icon.png'));

  const manifest = {
    name: 'NFL Team Hub',
    short_name: 'NFL',
    description: 'All 32 NFC and AFC franchise hubs',
    start_url: '/',
    display: 'standalone',
    background_color: '#080B10',
    theme_color: '#080B10',
    icons: [
      { src: './apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      { src: './nfl-icon.svg', sizes: '512x512', type: 'image/svg+xml' }
    ]
  };
  fs.writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // 3. Generate index.html + hermetically sealed same-site key-sync.html vault
  const grouped = getGroupedPortalTeams();
  const html = buildIndexHtml(grouped);
  fs.writeFileSync(path.join(DIST, 'index.html'), html, 'utf8');
  fs.writeFileSync(path.join(DIST, 'key-sync.html'), buildKeySyncVaultHtml(), 'utf8');

  // 4. Cloudflare Pages static caching & security headers
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
    '/key-sync.html',
    `  Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; frame-ancestors ${frameAncestorsList}`,
    '  Cache-Control: public, max-age=300, stale-while-revalidate=3600',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(DIST, '_headers'), headersTxt, 'utf8');

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
