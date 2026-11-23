#!/usr/bin/env node
/**
 * Generates `assets/gemini-key-walkthrough.gif` — a crisp, lightweight, team-neutral
 * looping mobile walkthrough GIF showing a first-time Gmail user:
 *   1. Tapping "Get Free Key" in the app
 *   2. Checking Google AI Studio's Terms box & tapping "Continue"
 *   3. Tapping "Create API key" -> keeping defaults (no renaming) -> tapping "Create key" -> tapping "Copy"
 *   4. Returning to the app, pasting the key, and tapping "Connect"
 *
 * Uses Headless Chrome CDP for razor-sharp HTML/SVG rendering and macOS native Swift ImageIO
 * (`CGImageDestination`) to encode an optimized looping GIF with per-frame timing.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT_GIF = path.join(ROOT, 'assets', 'gemini-key-walkthrough.gif');
const CHROME_BIN = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const WIDTH = 420;
const HEIGHT = 330;

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTapCursor(x, y, { pressed = false } = {}) {
  return `
    <div class="tap-cursor ${pressed ? 'pressed' : ''}" style="left:${x}px;top:${y}px">
      ${pressed ? '<div class="tap-ring"></div>' : ''}
      <div class="tap-dot"></div>
    </div>
  `;
}

function renderFrameHtml({
  stepNum = 1,
  caption = '',
  chromeBar = 'App • Audio & AI',
  isGoogle = false,
  bodyHtml = '',
  cursor = null
}) {
  const dots = [1, 2, 3, 4]
    .map(n => `<span class="step-dot ${n === stepNum ? 'active' : n < stepNum ? 'done' : ''}"></span>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    overflow: hidden;
    background: #0D1117;
    color: #F3F6FA;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .stage {
    width: 100%;
    height: 100%;
    padding: 12px 14px 13px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: radial-gradient(90% 80% at 50% 0%, rgba(212, 175, 55, 0.14), transparent 72%), #0D1117;
  }
  .caption-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .caption-left {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .step-pill {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #D4AF37;
    color: #0B0D10;
    font-size: 12px;
    font-weight: 900;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .caption-text {
    font-size: 13.5px;
    font-weight: 800;
    color: #FFFFFF;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .step-dots {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .step-dot {
    width: 6px;
    height: 6px;
    border-radius: 99px;
    background: rgba(255,255,255,0.2);
  }
  .step-dot.done { background: rgba(52, 211, 153, 0.78); }
  .step-dot.active { width: 16px; background: #F5D061; }

  .phone {
    position: relative;
    flex: 1;
    border-radius: 16px;
    border: 1.5px solid rgba(255,255,255,0.14);
    background: ${isGoogle ? '#FFFFFF' : '#141923'};
    color: ${isGoogle ? '#1F2937' : '#F3F6FA'};
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 26px rgba(0,0,0,0.48);
  }
  .browser-bar {
    height: 30px;
    padding: 0 11px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: ${isGoogle ? '#F1F3F4' : '#0E121A'};
    border-bottom: 1px solid ${isGoogle ? '#E2E5E9' : 'rgba(255,255,255,0.08)'};
    font-size: 11px;
    font-weight: 700;
    color: ${isGoogle ? '#5F6368' : '#9CA8BC'};
  }
  .url-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 9px;
    border-radius: 99px;
    background: ${isGoogle ? '#FFFFFF' : 'rgba(255,255,255,0.06)'};
    border: 1px solid ${isGoogle ? '#DADCE0' : 'rgba(255,255,255,0.08)'};
    font-size: 10.5px;
    font-weight: 600;
    color: ${isGoogle ? '#202124' : '#D2DAE6'};
  }
  .screen-body {
    position: relative;
    flex: 1;
    padding: 14px 15px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 10px;
  }

  /* App screen styles */
  .app-card {
    border-radius: 12px;
    padding: 13px;
    background: linear-gradient(155deg, rgba(212,175,55,0.14), rgba(180,30,30,0.08));
    border: 1px solid rgba(212,175,55,0.4);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .app-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .app-card-title {
    font-size: 13.5px;
    font-weight: 800;
    color: #F5D061;
  }
  .get-key-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border-radius: 99px;
    background: #232B3A;
    border: 1.5px solid rgba(245, 208, 97, 0.72);
    color: #FFFFFF;
    font-size: 11.5px;
    font-weight: 800;
  }
  .get-key-chip.glow {
    background: #D4AF37;
    color: #0B0D10;
    border-color: #FFF2C2;
    box-shadow: 0 0 0 4px rgba(245, 208, 97, 0.3);
  }
  .input-row {
    display: flex;
    gap: 7px;
    align-items: center;
  }
  .fake-input {
    flex: 1;
    height: 36px;
    border-radius: 8px;
    padding: 0 10px;
    background: #0C1018;
    border: 1.5px solid rgba(255,255,255,0.16);
    color: #7D8B9F;
    font-size: 12.5px;
    display: flex;
    align-items: center;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .fake-input.filled {
    border-color: #F5D061;
    color: #FFFFFF;
    letter-spacing: 0.04em;
  }
  .app-btn {
    height: 36px;
    padding: 0 14px;
    border-radius: 8px;
    background: #273142;
    border: 1.5px solid rgba(255,255,255,0.18);
    color: #FFFFFF;
    font-size: 12.5px;
    font-weight: 800;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .app-btn.primary {
    background: #D4AF37;
    color: #0B0D10;
    border-color: #FFF2C2;
    box-shadow: 0 0 0 4px rgba(245, 208, 97, 0.25);
  }
  .connected-card {
    border-radius: 12px;
    padding: 18px 14px;
    background: linear-gradient(155deg, rgba(16, 185, 129, 0.2), rgba(16, 185, 129, 0.06));
    border: 1.5px solid rgba(52, 211, 153, 0.65);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 8px;
  }
  .check-circle {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: #10B981;
    color: #FFFFFF;
    font-size: 22px;
    font-weight: 900;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 14px rgba(16,185,129,0.45);
  }

  /* Google AI Studio screen styles */
  .g-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 8px;
    border-bottom: 1px solid #E8EAED;
  }
  .g-logo {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13.5px;
    font-weight: 700;
    color: #202124;
  }
  .g-spark {
    width: 18px;
    height: 18px;
    border-radius: 5px;
    background: linear-gradient(135deg, #4285F4, #8AB4F8);
    color: #FFFFFF;
    font-size: 11px;
    font-weight: 900;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .g-avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #1A73E8;
    color: #FFFFFF;
    font-size: 11px;
    font-weight: 800;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .g-modal {
    border-radius: 12px;
    border: 1px solid #DADCE0;
    background: #FFFFFF;
    padding: 13px 14px;
    box-shadow: 0 6px 18px rgba(60, 64, 67, 0.16);
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .g-title {
    font-size: 14px;
    font-weight: 700;
    color: #202124;
  }
  .g-sub {
    font-size: 11px;
    color: #5F6368;
    line-height: 1.35;
  }
  .g-check-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 9px;
    border-radius: 8px;
    background: #F8F9FA;
    border: 1.5px solid #DADCE0;
    font-size: 11.5px;
    font-weight: 600;
    color: #202124;
  }
  .g-check-row.checked {
    background: #E8F0FE;
    border-color: #1A73E8;
  }
  .g-box {
    width: 17px;
    height: 17px;
    border-radius: 4px;
    border: 2px solid #5F6368;
    background: #FFFFFF;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 900;
    color: #FFFFFF;
    flex-shrink: 0;
  }
  .g-box.checked {
    background: #1A73E8;
    border-color: #1A73E8;
  }
  .g-field-label {
    font-size: 10px;
    font-weight: 700;
    color: #5F6368;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 3px;
  }
  .g-field {
    height: 30px;
    padding: 0 9px;
    border-radius: 7px;
    border: 1px solid #DADCE0;
    background: #F8F9FA;
    color: #3C4043;
    font-size: 11.5px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .g-field-tag {
    font-size: 9.5px;
    font-weight: 700;
    color: #137333;
    background: #E6F4EA;
    padding: 1px 6px;
    border-radius: 99px;
  }
  .g-btn-row {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 2px;
  }
  .g-btn {
    height: 32px;
    padding: 0 14px;
    border-radius: 99px;
    background: #1A73E8;
    color: #FFFFFF;
    font-size: 12px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }
  .g-btn.disabled {
    background: #DADCE0;
    color: #80868B;
  }
  .g-btn.glow {
    box-shadow: 0 0 0 4px rgba(26, 115, 232, 0.28);
  }
  .g-btn.copied {
    background: #137333;
    box-shadow: 0 0 0 4px rgba(19, 115, 51, 0.25);
  }
  .g-key-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 9px;
    background: #F1F3F4;
    border: 1.5px solid #DADCE0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    font-weight: 700;
    color: #202124;
  }

  /* Animated finger tap indicator — translucent touch halo so button labels stay 100% legible */
  .tap-cursor {
    position: absolute;
    z-index: 20;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .tap-dot {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(245, 208, 97, 0.36);
    border: 2.5px solid #F5D061;
    box-shadow: 0 2px 10px rgba(0,0,0,0.38);
  }
  .tap-cursor.pressed .tap-dot {
    transform: scale(0.86);
    background: rgba(245, 208, 97, 0.52);
    border-color: #FFFFFF;
  }
  .tap-ring {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 42px;
    height: 42px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: 2.5px solid rgba(245, 208, 97, 0.92);
    background: rgba(245, 208, 97, 0.14);
  }
</style>
</head>
<body>
  <div class="stage">
    <div class="caption-bar">
      <div class="caption-left">
        <span class="step-pill">${stepNum}</span>
        <span class="caption-text">${esc(caption)}</span>
      </div>
      <div class="step-dots">${dots}</div>
    </div>
    <div class="phone">
      <div class="browser-bar">
        <span class="url-pill">${esc(chromeBar)}</span>
        <span>${isGoogle ? 'Gmail' : '1-Time Setup'}</span>
      </div>
      <div class="screen-body">
        ${bodyHtml}
        ${cursor ? renderTapCursor(cursor.x, cursor.y, { pressed: cursor.pressed }) : ''}
      </div>
    </div>
  </div>
</body>
</html>`;
}

function buildFrames() {
  const frames = [];
  const push = (delaySec, html) => frames.push({ delaySec, html });

  // ── STEP 1: Tap "Get Free Key" in the app ─────────────────────────────────
  const appStartBody = glow => `
    <div class="app-card">
      <div class="app-card-top">
        <span class="app-card-title">Connect API Key</span>
        <span class="get-key-chip ${glow ? 'glow' : ''}">Get Free Key ↗</span>
      </div>
      <div class="input-row">
        <div class="fake-input">Paste AIza... API Key</div>
        <div class="app-btn">Connect</div>
      </div>
    </div>
  `;
  push(1.1, renderFrameHtml({
    stepNum: 1,
    caption: 'Tap "Get Free Key" & sign in with Gmail',
    chromeBar: 'Audio & AI',
    bodyHtml: appStartBody(false),
    cursor: { x: 285, y: 125, pressed: false }
  }));
  push(0.45, renderFrameHtml({
    stepNum: 1,
    caption: 'Tap "Get Free Key" & sign in with Gmail',
    chromeBar: 'Audio & AI',
    bodyHtml: appStartBody(true),
    cursor: { x: 318, y: 97, pressed: false }
  }));
  push(0.65, renderFrameHtml({
    stepNum: 1,
    caption: 'Tap "Get Free Key" & sign in with Gmail',
    chromeBar: 'Audio & AI',
    bodyHtml: appStartBody(true),
    cursor: { x: 318, y: 97, pressed: true }
  }));

  // ── STEP 2: First-time Google AI Studio Terms & Consent ───────────────────
  const termsBody = ({ checked = false, btnGlow = false }) => `
    <div class="g-header">
      <span class="g-logo"><span class="g-spark">✦</span>Google AI Studio</span>
      <span class="g-avatar">J</span>
    </div>
    <div class="g-modal">
      <div class="g-title">Welcome to Google AI Studio</div>
      <div class="g-sub">Accept once with your Gmail account ($0, no card).</div>
      <div class="g-check-row ${checked ? 'checked' : ''}">
        <span class="g-box ${checked ? 'checked' : ''}">${checked ? '✓' : ''}</span>
        <span>I consent to the Google APIs Terms</span>
      </div>
      <div class="g-btn-row">
        <span class="g-btn ${checked ? (btnGlow ? 'glow' : '') : 'disabled'}">Continue</span>
      </div>
    </div>
  `;
  push(0.95, renderFrameHtml({
    stepNum: 2,
    caption: 'Check the Terms box & tap Continue',
    chromeBar: 'aistudio.google.com/app/apikey',
    isGoogle: true,
    bodyHtml: termsBody({ checked: false }),
    cursor: { x: 44, y: 151, pressed: false }
  }));
  push(0.45, renderFrameHtml({
    stepNum: 2,
    caption: 'Check the Terms box & tap Continue',
    chromeBar: 'aistudio.google.com/app/apikey',
    isGoogle: true,
    bodyHtml: termsBody({ checked: true }),
    cursor: { x: 44, y: 151, pressed: true }
  }));
  push(0.6, renderFrameHtml({
    stepNum: 2,
    caption: 'Check the Terms box & tap Continue',
    chromeBar: 'aistudio.google.com/app/apikey',
    isGoogle: true,
    bodyHtml: termsBody({ checked: true, btnGlow: true }),
    cursor: { x: 321, y: 196, pressed: false }
  }));
  push(0.65, renderFrameHtml({
    stepNum: 2,
    caption: 'Check the Terms box & tap Continue',
    chromeBar: 'aistudio.google.com/app/apikey',
    isGoogle: true,
    bodyHtml: termsBody({ checked: true, btnGlow: true }),
    cursor: { x: 321, y: 196, pressed: true }
  }));

  // ── STEP 3a: Tap "Create API key" on API Keys page ────────────────────────
  const apiKeysBody = glow => `
    <div class="g-header">
      <span class="g-logo"><span class="g-spark">✦</span>API Keys</span>
      <span class="g-btn ${glow ? 'glow' : ''}">+ Create API key</span>
    </div>
    <div class="g-modal" style="align-items:center;text-align:center;padding:24px 14px;background:#F8F9FA">
      <div class="g-title" style="font-size:13px">No API keys yet</div>
      <div class="g-sub">Tap <strong>+ Create API key</strong> above to make your free key.</div>
    </div>
  `;
  push(0.95, renderFrameHtml({
    stepNum: 3,
    caption: 'Tap "+ Create API key"',
    chromeBar: 'aistudio.google.com/app/apikey',
    isGoogle: true,
    bodyHtml: apiKeysBody(false),
    cursor: { x: 308, y: 58, pressed: false }
  }));
  push(0.7, renderFrameHtml({
    stepNum: 3,
    caption: 'Tap "+ Create API key"',
    chromeBar: 'aistudio.google.com/app/apikey',
    isGoogle: true,
    bodyHtml: apiKeysBody(true),
    cursor: { x: 308, y: 54, pressed: true }
  }));

  // ── STEP 3b: Create dialog — leave default name & project as-is, tap Create key
  const createDialogBody = glow => `
    <div class="g-modal">
      <div class="g-title">Create a new key</div>
      <div>
        <div class="g-field-label">Project (keep default)</div>
        <div class="g-field">
          <span>Default Gemini Project</span>
          <span class="g-field-tag">Auto</span>
        </div>
      </div>
      <div>
        <div class="g-field-label">Key Name (no need to change)</div>
        <div class="g-field"><span>Gemini API Key</span></div>
      </div>
      <div class="g-btn-row">
        <span class="g-btn ${glow ? 'glow' : ''}">Create key</span>
      </div>
    </div>
  `;
  push(1.1, renderFrameHtml({
    stepNum: 3,
    caption: 'Keep defaults & tap "Create key"',
    chromeBar: 'aistudio.google.com/app/apikey',
    isGoogle: true,
    bodyHtml: createDialogBody(false),
    cursor: { x: 318, y: 205, pressed: false }
  }));
  push(0.75, renderFrameHtml({
    stepNum: 3,
    caption: 'Keep defaults & tap "Create key"',
    chromeBar: 'aistudio.google.com/app/apikey',
    isGoogle: true,
    bodyHtml: createDialogBody(true),
    cursor: { x: 318, y: 205, pressed: true }
  }));

  // ── STEP 3c: Copy your new AIza... key ────────────────────────────────────
  const copyBody = copied => `
    <div class="g-header">
      <span class="g-logo"><span class="g-spark">✦</span>API Key Ready</span>
      <span class="g-avatar">J</span>
    </div>
    <div class="g-modal">
      <div class="g-title">Your free Gemini API key</div>
      <div class="g-key-box">
        <span>AIzaSyD9xR4•••••kQ8</span>
        <span class="g-btn ${copied ? 'copied' : 'glow'}" style="height:28px;padding:0 12px;font-size:11.5px">${copied ? '✓ Copied!' : 'Copy'}</span>
      </div>
      <div class="g-sub">${copied ? 'Copied! Now switch back to the NFL app.' : 'Tap Copy to save it to your clipboard.'}</div>
    </div>
  `;
  push(0.95, renderFrameHtml({
    stepNum: 3,
    caption: 'Tap "Copy" next to your AIza... key',
    chromeBar: 'aistudio.google.com/app/apikey',
    isGoogle: true,
    bodyHtml: copyBody(false),
    cursor: { x: 314, y: 148, pressed: false }
  }));
  push(0.55, renderFrameHtml({
    stepNum: 3,
    caption: 'Tap "Copy" next to your AIza... key',
    chromeBar: 'aistudio.google.com/app/apikey',
    isGoogle: true,
    bodyHtml: copyBody(true),
    cursor: { x: 314, y: 148, pressed: true }
  }));
  push(0.95, renderFrameHtml({
    stepNum: 3,
    caption: 'Copied! Switch back to the app',
    chromeBar: 'aistudio.google.com/app/apikey',
    isGoogle: true,
    bodyHtml: copyBody(true),
    cursor: null
  }));

  // ── STEP 4: Paste back in the app & tap Connect -> Connected! ─────────────
  const appPasteBody = ({ filled = false, connectGlow = false }) => `
    <div class="app-card">
      <div class="app-card-top">
        <span class="app-card-title">Connect API Key</span>
        <span class="get-key-chip">Get Free Key ↗</span>
      </div>
      <div class="input-row">
        <div class="fake-input ${filled ? 'filled' : ''}">${filled ? 'AIzaSyD9xR4•••••kQ8' : 'Paste AIza... API Key'}</div>
        <div class="app-btn ${connectGlow ? 'primary' : ''}">Connect</div>
      </div>
    </div>
  `;
  push(0.75, renderFrameHtml({
    stepNum: 4,
    caption: 'Paste your key & tap "Connect"',
    chromeBar: 'Audio & AI',
    bodyHtml: appPasteBody({ filled: false }),
    cursor: { x: 130, y: 142, pressed: true }
  }));
  push(0.8, renderFrameHtml({
    stepNum: 4,
    caption: 'Paste your key & tap "Connect"',
    chromeBar: 'Audio & AI',
    bodyHtml: appPasteBody({ filled: true, connectGlow: true }),
    cursor: { x: 322, y: 142, pressed: false }
  }));
  push(0.6, renderFrameHtml({
    stepNum: 4,
    caption: 'Paste your key & tap "Connect"',
    chromeBar: 'Audio & AI',
    bodyHtml: appPasteBody({ filled: true, connectGlow: true }),
    cursor: { x: 322, y: 142, pressed: true }
  }));
  push(2.1, renderFrameHtml({
    stepNum: 4,
    caption: 'Done! Auto Pod & AI Analysis unlocked',
    chromeBar: 'Audio & AI',
    bodyHtml: `
      <div class="connected-card">
        <div class="check-circle">✓</div>
        <div style="font-size:15px;font-weight:800;color:#FFFFFF">Connected!</div>
        <div style="font-size:11.5px;color:#A7F3D0">Auto Pod &amp; AI Analysis are ready to use.</div>
      </div>
    `,
    cursor: null
  }));

  return frames;
}

async function launchChrome(debugPort, userDataDir) {
  const proc = spawn(
    CHROME_BIN,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-sandbox',
      'about:blank'
    ],
    { stdio: 'ignore' }
  );
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (r.ok) {
        const list = await r.json();
        const page = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl);
        if (page) return { proc, wsUrl: page.webSocketDebuggerUrl };
      }
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  proc.kill('SIGKILL');
  throw new Error('Failed to launch Headless Chrome for GIF capture');
}

function createCdpClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = nextId++;
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          try { ws.close(); } catch {}
        }
      });
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
        else res(msg.result);
      }
    });
  });
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-key-gif-'));
  const chromeDir = path.join(tmpDir, 'chrome');
  const debugPort = 9550 + Math.floor(Math.random() * 200);
  const frames = buildFrames();
  const manifest = [];

  const chrome = await launchChrome(debugPort, chromeDir);
  const cdp = await createCdpClient(chrome.wsUrl);
  try {
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false
    });

    for (let i = 0; i < frames.length; i += 1) {
      const f = frames[i];
      const htmlPath = path.join(tmpDir, `frame_${String(i).padStart(2, '0')}.html`);
      const pngPath = path.join(tmpDir, `frame_${String(i).padStart(2, '0')}.png`);
      fs.writeFileSync(htmlPath, f.html, 'utf8');
      await cdp.send('Page.navigate', { url: `file://${htmlPath}` });
      await new Promise(r => setTimeout(r, 90));
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(pngPath, Buffer.from(shot.data, 'base64'));
      manifest.push({ pngPath, delaySec: f.delaySec });
    }
  } finally {
    cdp.close();
    chrome.proc.kill('SIGKILL');
  }

  // Encode optimized looping GIF via macOS native Swift ImageIO (`CGImageDestination`)
  const swiftScript = path.join(tmpDir, 'encode_gif.swift');
  const manifestPath = path.join(tmpDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
  fs.writeFileSync(
    swiftScript,
    `
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct FrameSpec: Decodable {
  let pngPath: String
  let delaySec: Double
}

let args = CommandLine.arguments
let manifestUrl = URL(fileURLWithPath: args[1])
let outUrl = URL(fileURLWithPath: args[2])
let data = try Data(contentsOf: manifestUrl)
let frames = try JSONDecoder().decode([FrameSpec].self, from: data)

guard let dest = CGImageDestinationCreateWithURL(outUrl as CFURL, UTType.gif.identifier as CFString, frames.count, nil) else {
  fatalError("Failed to create GIF destination")
}
let fileProps: [CFString: Any] = [
  kCGImagePropertyGIFDictionary: [
    kCGImagePropertyGIFLoopCount: 0
  ]
]
CGImageDestinationSetProperties(dest, fileProps as CFDictionary)

for f in frames {
  let u = URL(fileURLWithPath: f.pngPath)
  guard let src = CGImageSourceCreateWithURL(u as CFURL, nil),
        let cgImg = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    fatalError("Failed to load PNG: \\(f.pngPath)")
  }
  let frameProps: [CFString: Any] = [
    kCGImagePropertyGIFDictionary: [
      kCGImagePropertyGIFDelayTime: f.delaySec,
      kCGImagePropertyGIFUnclampedDelayTime: f.delaySec
    ]
  ]
  CGImageDestinationAddImage(dest, cgImg, frameProps as CFDictionary)
}
guard CGImageDestinationFinalize(dest) else {
  fatalError("Failed to finalize GIF")
}
`,
    'utf8'
  );

  fs.mkdirSync(path.dirname(OUT_GIF), { recursive: true });
  execFileSync('swift', [swiftScript, manifestPath, OUT_GIF], { stdio: 'inherit', timeout: 30000 });
  // Ensure strict GIF89a header when NETSCAPE2.0 / Graphic Control Extension blocks are present
  const gifBytes = fs.readFileSync(OUT_GIF);
  if (gifBytes.subarray(0, 6).toString('ascii') === 'GIF87a' && gifBytes.includes(Buffer.from('NETSCAPE2.0'))) {
    gifBytes.write('GIF89a', 0, 'ascii');
    fs.writeFileSync(OUT_GIF, gifBytes);
  }
  const stat = fs.statSync(OUT_GIF);
  // Keep 4 preview PNGs briefly in scratch for visual inspection if requested
  if (process.argv.includes('--keep-previews')) {
    const previewDir = path.join(os.tmpdir(), 'gemini-key-gif-previews');
    fs.mkdirSync(previewDir, { recursive: true });
    for (const idx of [2, 6, 10, 12, 16, 17]) {
      if (manifest[idx]) {
        fs.copyFileSync(manifest[idx].pngPath, path.join(previewDir, `scene_${idx}.png`));
      }
    }
    console.log(`Preview PNGs copied to ${previewDir}`);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`[build-gemini-key-gif] Wrote ${OUT_GIF} (${frames.length} frames, ${(stat.size / 1024).toFixed(1)} KB)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
