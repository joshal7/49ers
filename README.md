# 49ers Faithful (`49ers.joshal.com`)

A zero-cost, mobile-first Progressive Web App (PWA) engineered for iPhone 16 / 16 Pro Safari Home Screen mode (`49ers HQ`) and mobile/desktop Chrome. Built for ~25 analytically minded San Francisco 49ers fans who want verified facts, All-22 film & scheme mechanics, EPA/NextGen metrics, and NFL CBA salary cap math—with zero clickbait or sensationalism.

- **Live Custom Domain**: `https://49ers.joshal.com`
- **GitHub Repository**: `https://github.com/Joshal7/49ers`
- **Internal Documentation**:
  - [`ARCHITECTURE.md`](./ARCHITECTURE.md) — Holistic Technical Architecture, Quality vs. Speed Philosophy, Time-Based Lifecycle Rules, 15-Engine Map & 4-Suite QA Playbook
  - [`PRD.md`](./PRD.md) — Product Requirements & Functional Specifications
  - [`AGENTS.md`](./AGENTS.md) & [`GEMINI.md`](./GEMINI.md) — Agent Rules, Layout Invariants & Quick-Reference Map

---

## Core Architecture & Features

### 1. Permanent Year-Round Architecture & Customizable 6-Card `Home` Dashboard (`src/engine/seasonStateMachine.js`)
Every module across the app is permanently live year-round (zero Seasonal Archive Vault, zero `#phaseBanner` locks, zero `.off-cycle` dimming) while `Home` defaults to a scannable 6-card layout (`news_briefs`, `upcoming_matchup`, `team_health`, `team_stats`, `salary_cap`, `autopodcast_ai`) with 6 optional pinnable cards and drag/tap reordering in `Customize Order`:
- **Unified `News & Film` Hub (`src/views/newsView.js`, `src/engine/breakingClassifier.js`)**:
  - Single two-row 6-filter bar (`All`, `Tweets`, `Articles` / `Highlights & Videos`, `Film & Trench`, `Trades & Roster`) with `0px` mobile horizontal scroll.
  - **Schedule-Aware 1/Day `gemini-4-hydrogen` (`XHIGH`) Top-News Brief** (`5:00 PM PT` on non-game days; post-whistle + podium buffer on game days) with inline source links, expandable `Sources (N)` citations, and automatic promotion of uncovered breaking news above the brief.
  - **7-Channel Sub-Minute Live Wire (`20s` live game / `45s` standard)**: Polls ESPN 24/7 X-Beat Player Wire, RotoWire Live NFL RSS, Official 49ers/ESPN Transactions, ESPN Rapid NFL Breaking Desk, Official `49ers.com` News & Video RSS, Bluesky Beat Mirrors, and optional Edge Worker `/api/live-wire`, prioritizing direct `https://x.com/<handle>/status/<id>` permalinks, inline X/ESPN MP4 & YouTube clips, and **50+ interactive Jargon Quick-Bubble Popovers**.
- **Two-Cluster 8-Tab `Game & Season` Hub (`src/views/seasonMatchupView.js`)**:
  - **Bar 1 (`Matchup`, `Health`, `Schedule`, `Stats`)**: Live `LIVE • X–Y` / `FINAL • X–Y` scoreboards, **`[T-90m, Final)` 49ers & Opponent Game-Day Inactives + starting-collapsed Active Roster (`Offense → Defense → Special Teams`)**, frozen sticky **Column 1 (`Player`)** health tables, **`0m` post-whistle `Week N+1` rollover** (`W/T/F = —` until Practice Day 1 across `Wed`/`Thu`/`Fri`/`Sat`/`Sun`/`Mon` schedules), **21-day IR activation modeling** (`4:00 PM ET` weekly deadline + Bye-week-aware 4-game floor), collapsible `Previous Games` + dynamic `PRE`/`REG`/`POST` schedule progression, and single-screen portrait **Team Stats** + 4-unit 32-team modal leaderboards.
  - **Bar 2 (`Trade`, `Playoffs`, `Draft`, `Draft Recap`)**: Inline completed trades (`<= 30d` visible + `> 30d` `<details>`), 3-tier CBA base-salary purchasing power, **10,000-iteration Empirical-Bayes NFC Playoff Monte Carlo** (`<150 ms`) with interactive Rooting Guide toggles, **3-Lens 250+ Prospect NFL Draft Big Board** (`Consensus`, `Likely`, `PFF` with `NR`-at-bottom sort & shareable URL sync), `draftYear`-gated Combine RAS Leaderboard, `30d`/`7d` First-Pick Mock Draft Database, and 2026 Draft/UDFA class recap.
- **`Roster & Cap` & 5-Tab `Player Dossier` (`src/views/rosterCapView.js`, `src/views/playerSheetView.js`)**:
  - 88-player Roster Explorer (`#rosterSortSelect` defaulting to `Roster Number` asc + `#rosterSortDirBtn`, Unit & Position filter bars), Dual-Mode Depth Chart, **5-Year (`2026–2030`) OverTheCap Armchair GM Simulator** (`0.03 ms`, full 9-column fit in iPhone 16 Pro landscape), and slide-up **5-Tab Player Dossier** (`Overview`, `Health`, `Stats & EPA`, `Spider Chart`, `Contract`).
- **`Audio & AI` Studio (`src/views/audioAiView.js`, `src/services/aiWorkerClient.js`)**:
  - **49ers Podcasts (7d)** across 6 flagship beat shows (`podcasts://` iOS & `intent://` Android deep links), **Autopodcast Studio** (`2–20 min` custom pods via `gemini-4-hydrogen` `HIGH` + Studio Pro/Flash TTS or WebWorker Kokoro ONNX + iOS 2-channel Stereo `-84 dBFS` speaker unlock), **On-Demand AI Deep Analysis** (`gemini-4-hydrogen` `HIGH` + Google Search Grounding), self-contained `?pod=` / `?analysis=` gzip share URLs, and native MP3 export.

---

## Engineering Philosophy: Quality vs. Speed

- **Two-Tier Gemini 4 Hydrogen Reasoning (`XHIGH` Scheduled vs. `HIGH` Live)**: Non-time-sensitive daily syntheses (`5:00 PM PT Top-News Brief`, `1/day Matchup Intel`, `aiSynthesisEngine.mjs`) run `gemini-4-hydrogen` at `thinkingLevel: "XHIGH"`, while live user-waiting jobs (`On-Demand Analysis`, `Auto Pod`) run `thinkingLevel: "HIGH"` over pre-compiled Stage-1 OverTheCap/EPA dossiers + Google Search Grounding for ~35–50% faster turnaround with Cloudflare KV/R2 caching (`<50 ms` shared reads).
- **Consistent Sub-Second UI & Low-Bandwidth Polling**: Service Worker (`49ers-faithful-v89`) warm-cache `2.2s` fast fallback (`<300 ms` boot), `<35 ms` `reconcileRosterAndHealthWithNews` (`87 players × 352 items`), `<5 ms` Cap Simulator, `<150 ms` 10,000-trial Playoff Monte Carlo, and per-team `~275 KB` ESPN injury polling (`94%` smaller than the `8.76 MB` league payload).
- **Strict Anti-Hallucination & Link Hygiene**: `groundingValidator.js` blocks departed former 49ers from active-roster claims, and `linkIntegrity.js` enforces 100% `https://` (`5,400+` verified links), blocks paywalls/shorteners/wrappers, and resolves `nflverse` homonyms.

---

## Local Development, Pipelines & QA Testing

Zero external runtime dependencies are required (`Node.js >= 20`, `Python 3` for local static serving, `ffmpeg` + `edge-tts` for offline studio `.m4a` builds, and Google Chrome for headless mobile CDP E2E tests).

```bash
# Start local server at http://localhost:8080
npm start

# Refresh live 49ers roster, OverTheCap 5-yr contracts, nflverse EPA, 49ers.com health & beat news JSON
npm run refresh-data

# Rebuild the 3 studio-mastered 44.1kHz neural AAC (.m4a) podcast episodes
npm run build-podcasts

# Auto-review & re-rank the 49-voice reporter registry
npm run update-reporters

# Run Unit + Holistic Regressions + Timeliness/Race-Condition Simulation Suites
npm run test:unit && node tests/timeliness-simulation-qa.mjs

# Run Headless Chrome Mobile & 8-Viewport Responsive E2E QA Suite
npm run test:e2e

# Run ALL 4 Mandatory QA Suites (unit + holistic + timeliness + mobile E2E — must pass 100% before every commit)
npm test
```

---

## Optional Zero-Cost Shared AI & Audio Edge Worker (`worker/`)

Out of the box, the app runs 100% standalone on GitHub Pages (or with a personal free Google AI Studio key pasted into Settings). To enable shared Cloudflare KV caching, R2 stereo WAV HTTP `Range` (`206 Partial Content`) audio streaming, `/api/live-wire` edge RSS/video aggregation, and 6-hour `/v1beta/models` auto-upgrades across all ~25 friends (`\$0/month` on Cloudflare Free Tier):

```bash
cd worker
npx wrangler kv namespace create SHARED_CACHE
npx wrangler r2 bucket create 49ers-podcasts
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GROUP_PASSCODE
npx wrangler deploy
```
