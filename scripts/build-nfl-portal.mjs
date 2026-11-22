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

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist-nfl');
const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const PORTAL_CONFERENCES = ['NFC', 'AFC'];
export const PORTAL_DIVISIONS = ['North', 'South', 'East', 'West'];
const ASSET_VER = '1';

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

function buildNflPortalIconSvg({ fullBleedSquare = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0C1B3A"/>
      <stop offset="50%" stop-color="#0B111E"/>
      <stop offset="100%" stop-color="#2D0C14"/>
    </linearGradient>
    <radialGradient id="spot" cx="50%" cy="38%" r="58%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="shieldRim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F8FAFC"/>
      <stop offset="50%" stop-color="#CBD5E1"/>
      <stop offset="100%" stop-color="#64748B"/>
    </linearGradient>
    <linearGradient id="shieldLeft" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1D5FD6"/>
      <stop offset="100%" stop-color="#012456"/>
    </linearGradient>
    <linearGradient id="shieldRight" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#E02424"/>
      <stop offset="100%" stop-color="#7F0A14"/>
    </linearGradient>
    <linearGradient id="ruleL" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#94A3B8" stop-opacity="0"/>
      <stop offset="100%" stop-color="#E2E8F0" stop-opacity="0.9"/>
    </linearGradient>
    <linearGradient id="ruleR" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#E2E8F0" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#94A3B8" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="clipIcon">
      <rect width="512" height="512" rx="${fullBleedSquare ? 0 : 112}"/>
    </clipPath>
    <clipPath id="shieldInnerClip">
      <path d="M256 76 C214 96 164 102 128 96 L128 214 C128 286 184 334 256 356 C328 334 384 286 384 214 L384 96 C348 102 298 96 256 76 Z"/>
    </clipPath>
    <filter id="drop" x="-18%" y="-18%" width="136%" height="145%">
      <feDropShadow dx="0" dy="14" stdDeviation="14" flood-color="#020408" flood-opacity="0.72"/>
    </filter>
  </defs>
  <g clip-path="url(#clipIcon)">
    <rect width="512" height="512" fill="url(#bg)"/>
    <rect width="512" height="512" fill="url(#spot)"/>
    <g filter="url(#drop)">
      <path d="M256 62 C210 84 156 90 116 84 L116 216 C116 296 178 348 256 372 C334 348 396 296 396 216 L396 84 C356 90 302 84 256 62 Z" fill="url(#shieldRim)"/>
      <g clip-path="url(#shieldInnerClip)">
        <rect x="116" y="62" width="140" height="310" fill="url(#shieldLeft)"/>
        <rect x="256" y="62" width="140" height="310" fill="url(#shieldRight)"/>
        <rect x="116" y="62" width="280" height="106" fill="#0B1220" opacity="0.52"/>
        <ellipse cx="256" cy="120" rx="34" ry="18" fill="#FFFFFF" opacity="0.95"/>
        <line x1="234" y1="120" x2="278" y2="120" stroke="#0B1220" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="244" y1="113" x2="244" y2="127" stroke="#0B1220" stroke-width="3" stroke-linecap="round"/>
        <line x1="256" y1="113" x2="256" y2="127" stroke="#0B1220" stroke-width="3" stroke-linecap="round"/>
        <line x1="268" y1="113" x2="268" y2="127" stroke="#0B1220" stroke-width="3" stroke-linecap="round"/>
      </g>
      <text x="256" y="274" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Arial Black', sans-serif" font-weight="900" font-size="100" letter-spacing="4" fill="#FFFFFF" stroke="#070B14" stroke-width="6" paint-order="stroke fill">NFL</text>
    </g>
    <rect x="64" y="421.5" width="58" height="2" rx="1" fill="url(#ruleL)"/>
    <rect x="390" y="421.5" width="58" height="2" rx="1" fill="url(#ruleR)"/>
    <circle cx="129" cy="422.5" r="2.2" fill="#E2E8F0"/>
    <circle cx="383" cy="422.5" r="2.2" fill="#E2E8F0"/>
    <g transform="translate(256, 435) scale(1.12, 1)">
      <text x="0" y="0" text-anchor="middle" font-family="Georgia, 'Charter', serif" font-weight="900" font-size="36" letter-spacing="5" fill="#FFFFFF" stroke="#000000" stroke-width="2.5" paint-order="stroke fill">JOSHAL</text>
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
  const label = escapeHtml(team.brandName);
  const aria = escapeHtml(`${team.brandName} — ${team.fullName} (${team.domain})`);
  return `<a class="team-tile" href="${href}" data-team="${escapeHtml(team.slug)}" data-abbr="${escapeHtml(team.abbr)}" style="--team-accent:${escapeHtml(accent)}" aria-label="${aria}" title="${escapeHtml(team.fullName)}">
                  <span class="logo-wrap">
                    <img class="team-logo" src="./icons/${escapeHtml(team.slug)}.png?v=${ASSET_VER}" alt="${escapeHtml(team.brandName)}" width="180" height="180" decoding="async" fetchpriority="high">
                  </span>
                  <span class="team-name">${label}</span>
                </a>`;
}

function renderConferenceColumn({ conference, divisions }) {
  const confSlug = conference.toLowerCase();
  const divsHtml = divisions
    .map(
      ({ name, teams }) => `<div class="division" data-division="${escapeHtml(`${conference} ${name}`)}">
              <div class="div-header">
                <h2 class="div-title">${escapeHtml(name)}</h2>
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
            <h1 class="conf-title">${conference}</h1>
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
  <meta name="description" content="NFL team hubs across all 32 NFC and AFC franchises at nfl.joshal.com.">
  <title>NFL — joshal.com</title>
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
      --shadow-card: 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 8px 20px rgba(0, 0, 0, 0.28);
      --shadow-logo: 0 3px 8px rgba(0, 0, 0, 0.48), 0 0 0 1px rgba(255, 255, 255, 0.12);
      --icon-size: clamp(28px, min(11.4vw, 4.65dvh), 46px);
      --radius-card: 12px;
      --radius-tile: 9px;
      color-scheme: dark;
    }

    [data-theme="light"] {
      --bg: #F5F6FA;
      --bg-card: rgba(255, 255, 255, 0.94);
      --bg-tile-hover: rgba(15, 23, 42, 0.05);
      --border: rgba(15, 23, 42, 0.08);
      --border-strong: rgba(15, 23, 42, 0.16);
      --text: #0F172A;
      --text-muted: #475569;
      --text-subtle: #64748B;
      --nfc: #013369;
      --nfc-soft: rgba(1, 51, 105, 0.09);
      --afc: #C8102E;
      --afc-soft: rgba(200, 16, 46, 0.09);
      --shadow-card: 0 1px 2px rgba(15, 23, 42, 0.05), 0 6px 16px rgba(15, 23, 42, 0.04);
      --shadow-logo: 0 3px 8px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.08);
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
      max-width: 1180px;
      margin: 0 auto;
      padding-top: max(6px, env(safe-area-inset-top));
      padding-bottom: max(6px, env(safe-area-inset-bottom));
      padding-left: max(8px, env(safe-area-inset-left));
      padding-right: max(8px, env(safe-area-inset-right));
      display: flex;
      flex-direction: column;
      gap: 5px;
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

    /* Top bar: ultra-minimal, crisp identity + subtle theme switch */
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
      gap: 7px;
      text-decoration: none;
      color: var(--text);
    }

    .brand-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px 6px;
      border-radius: 6px;
      font-size: 10.5px;
      font-weight: 800;
      letter-spacing: 0.08em;
      color: #FFFFFF;
      background: linear-gradient(135deg, #1D4ED8 0%, #0F172A 50%, #DC2626 100%);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }

    .brand-domain {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: -0.015em;
      color: var(--text);
    }

    .brand-domain span {
      color: var(--text-muted);
      font-weight: 500;
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
      gap: 7px;
    }

    .conference {
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
      gap: 4px;
    }

    .conf-header {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 3px 8px;
      border-radius: 8px;
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
      font-size: 11.5px;
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
      gap: 5px;
    }

    .division {
      display: flex;
      flex-direction: column;
      min-height: 0;
      min-width: 0;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      padding: 4px 4px 3px;
      box-shadow: var(--shadow-card);
    }

    .div-header {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 0 3px 2px;
    }

    .div-title {
      margin: 0;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--text-subtle);
      line-height: 1;
      flex: 0 0 auto;
    }

    .div-rule {
      flex: 1 1 auto;
      height: 1px;
      background: var(--border);
    }

    /* 2x2 team grid per division on iPhone so all 32 fit cleanly in one screen */
    .team-grid {
      flex: 1 1 0;
      min-height: 0;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-rows: repeat(2, minmax(0, 1fr));
      gap: 2px;
    }

    .team-tile {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      min-width: 0;
      min-height: 0;
      padding: 2px 2px;
      border-radius: var(--radius-tile);
      text-decoration: none;
      color: var(--text);
      transition: transform 140ms cubic-bezier(0.22, 1, 0.36, 1), background 140ms ease;
      outline: none;
    }

    .team-tile:hover {
      background: var(--bg-tile-hover);
      transform: translateY(-1px);
    }

    .team-tile:active {
      transform: scale(0.95);
    }

    .team-tile:focus-visible {
      box-shadow: 0 0 0 2px var(--team-accent, var(--nfc));
      background: var(--bg-tile-hover);
    }

    .logo-wrap {
      flex: 0 0 auto;
      width: var(--icon-size);
      height: var(--icon-size);
      border-radius: 22%;
      overflow: hidden;
      box-shadow: var(--shadow-logo);
      transition: box-shadow 160ms ease, transform 160ms ease;
      background: #0B1018;
    }

    .team-tile:hover .logo-wrap {
      box-shadow: 0 6px 14px rgba(0, 0, 0, 0.42), 0 0 0 1.5px var(--team-accent, rgba(255, 255, 255, 0.3));
    }

    .team-logo {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .team-name {
      display: block;
      width: 100%;
      text-align: center;
      font-size: clamp(8.5px, 2.35vw, 10.5px);
      font-weight: 600;
      line-height: 1.08;
      letter-spacing: -0.02em;
      color: var(--text);
      text-wrap: balance;
      overflow-wrap: break-word;
      max-height: 2.25em;
      overflow: hidden;
    }

    /* Taller phones (iPhone 14/15/16/Pro/Pro Max): extra polish & breathing room */
    @media (min-height: 760px) and (max-width: 859px) {
      :root {
        --icon-size: clamp(42px, min(12.6vw, 5.5dvh), 52px);
      }
      .shell {
        gap: 7px;
        padding-top: max(10px, env(safe-area-inset-top));
        padding-bottom: max(10px, env(safe-area-inset-bottom));
        padding-left: max(10px, env(safe-area-inset-left));
        padding-right: max(10px, env(safe-area-inset-right));
      }
      .conferences {
        gap: 9px;
      }
      .divisions {
        gap: 7px;
      }
      .division {
        padding: 5px 5px 4px;
      }
      .div-title {
        font-size: 9.5px;
      }
      .team-tile {
        gap: 3px;
      }
      .team-name {
        font-size: clamp(9.5px, 2.55vw, 11px);
      }
    }

    /* Short landscape phone fallback: never crush below readable height */
    @media (max-height: 589px) {
      :root {
        --icon-size: 46px;
      }
      .shell {
        padding: 10px 14px 16px;
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
        gap: 8px;
      }
      .division {
        padding: 8px;
      }
      .team-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        grid-template-rows: auto;
        gap: 6px;
      }
      .team-tile {
        padding: 6px 4px;
        gap: 5px;
      }
      .team-name {
        font-size: 11px;
        max-height: none;
      }
    }

    /* Tablet & Desktop: crisp 4-across rows inside each division, still fits on ONE screen */
    @media (min-width: 860px) {
      :root {
        --icon-size: clamp(50px, min(5.4vw, 8.6dvh), 72px);
        --radius-card: 16px;
        --radius-tile: 12px;
      }
      .shell {
        padding: 14px 24px 18px;
        gap: 12px;
      }
      .topbar {
        min-height: 34px;
      }
      .brand-badge {
        font-size: 12px;
        padding: 3px 8px;
      }
      .brand-domain {
        font-size: 15px;
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
        gap: 18px;
      }
      .conference {
        gap: 10px;
      }
      .conf-header {
        padding: 7px 14px;
        border-radius: 11px;
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
        gap: 10px;
      }
      .division {
        padding: 9px 10px 8px;
      }
      .div-header {
        padding: 0 4px 6px;
        gap: 8px;
      }
      .div-title {
        font-size: 10.5px;
        letter-spacing: 0.14em;
      }
      .team-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        grid-template-rows: 1fr;
        gap: 6px;
      }
      .team-tile {
        gap: 6px;
        padding: 6px 4px;
      }
      .team-name {
        font-size: clamp(11px, 1vw, 12.5px);
        line-height: 1.18;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header class="topbar">
      <div class="brand" aria-label="nfl.joshal.com">
        <span class="brand-badge">NFL</span>
        <span class="brand-domain">nfl<span>.joshal.com</span></span>
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

export function buildNflPortalDist() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // 1. Copy all 32 180x180 JOSHAL team icons
  copyTeamIcons(path.join(DIST, 'icons'));

  // 2. Write portal favicon + iOS apple-touch-icon + manifest
  const roundedSvg = buildNflPortalIconSvg({ fullBleedSquare: false });
  const squareSvg = buildNflPortalIconSvg({ fullBleedSquare: true });
  fs.writeFileSync(path.join(DIST, 'nfl-icon.svg'), roundedSvg, 'utf8');
  rasterizePortalIconPng(squareSvg, path.join(DIST, 'apple-touch-icon.png'));

  const manifest = {
    name: 'NFL — joshal.com',
    short_name: 'NFL',
    description: 'All 32 NFC and AFC team hubs at nfl.joshal.com',
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

  // 3. Generate index.html
  const grouped = getGroupedPortalTeams();
  const html = buildIndexHtml(grouped);
  fs.writeFileSync(path.join(DIST, 'index.html'), html, 'utf8');

  // 4. Cloudflare Pages static caching & security headers
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
