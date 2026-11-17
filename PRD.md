# Product Requirements Document (PRD): 49ers Faithful Briefing (`49ers.joshal.com`)

| Metadata | Details |
| :--- | :--- |
| **Product Name** | **49ers Faithful Briefing** (`49ers Faithful`) |
| **Production URL** | `https://49ers.joshal.com` (`CNAME` → `joshal7.github.io`) |
| **Repository** | `https://github.com/Joshal7/49ers` |
| **Target Platform** | Mobile Web PWA (iOS 18+ Safari `"Add to Home Screen"` on iPhone 16 / 16 Pro, title `49ers HQ`, & Mobile/Desktop Chrome) |
| **Target Audience** | Josh & ~24 die-hard, analytically minded 49ers-fan friends |
| **Operating Budget** | **Strictly \$0/month** (GitHub Pages + GitHub Actions + Cloudflare Free Tier + Google AI Studio Free Tier) |
| **Design Philosophy** | High-signal football intelligence, zero clickbait/fluff, All-22 X's & O's, CBA salary cap math, sub-second deterministic engines, sub-minute live wire, and **Accuracy-Over-Latency** generative synthesis |
| **Technical Reference** | See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for full module-level engineering specs, latency budgets, time-based rules, and QA suites |

---

## 1. Executive Summary & Product Vision

**49ers Faithful Briefing (`49ers.joshal.com`)** is a private-group, mobile-first Progressive Web App built for ~25 deeply knowledgeable San Francisco 49ers fans who want **verified facts, All-22 film/scheme mechanics, quantitative modeling, and NFL CBA salary cap math**—stripped of clickbait, rage-bait, and engagement-farming hot takes.

The platform combines three pillars at **\$0/month**:
1. **15 Deterministic Quantitative & Guardrail Engines (`<50 ms` Synchronous Execution)**: Powers 5-year OverTheCap salary cap simulations (`2026–2030`), player-specific play-likelihood & 21-day IR activation modeling, `[T-90m, Final)` game-day rosters, 10,000-iteration Empirical-Bayes NFC playoff Monte Carlo simulations, a 3-Lens 250+ Prospect NFL Draft Big Board (`Consensus`, `Likely`, `PFF`), 4-unit 32-team statistical leaderboards, X-first beat attribution, and StoryRank news clustering directly in the browser.
2. **7-Channel Sub-Minute Live Telemetry (`20s` In-Game / `45s` Standard)**: Polls ESPN's 24/7 X-Beat Player Wire, RotoWire Live NFL RSS, Official 49ers/ESPN Transactions, ESPN's Rapid NFL Breaking Desk, Official `49ers.com` News & Video RSS, Bluesky Beat Mirrors, and optional Edge Worker `/api/live-wire` alongside a `60s` live ESPN standings/score/per-team injury (`~275 KB`) overlay.
3. **Two-Tier Gemini 4 Hydrogen (`gemini-4-hydrogen`) Synthesis & Studio Audio**: Uses maximum `XHIGH` thinking on non-time-sensitive daily syntheses (`1/day 5:00 PM PT Top-News Brief` and `1/day Matchup Intel`) and fast `HIGH` thinking on live user-waiting requests (`On-Demand Deep Analysis` and `Auto Pod` multi-speaker studio podcasts), caching outputs in Cloudflare KV & R2 (with HTTP `Range` `206 Partial Content` streaming) so the other ~24 friends get `<50 ms` instant reads.

---

## 2. Editorial Charter & Guardrails

1. **Faithful Editorial Charter (`antiFluffFilter.js`, `linkIntegrity.js`)**:
   - Ground every insight in verified facts, All-22 mechanics (`EPA/play`, `CPOE`, `RYOE`, `11/21 personnel`, `Wide-9` stunt geometry, disguised split-safety / `Quarters` / `Cover 6` rotations), and CBA cap math (`Article 13` 1-for-1 rollover, weekly base-salary trade proration, `Post-June 1` 2-designation rule, `Top-53` replacement).
   - Never render internal labels (`"War Room"`, `"clickbait cut"`, `"No-Fluff Synthesis Engine"`) in visible UI titles or copy.
2. **Zero Retired/Departed Player Hallucinations (`groundingValidator.js`)**:
   - Departed former 49ers (`DISALLOWED_FORMER_49ERS`: Bryce Huff, Javon Hargrave, Charvarius Ward, Talanoa Hufanga, Aaron Banks, Leonard Floyd, Maliek Collins, Jordan Mason, Elijah Mitchell, Jauan Jennings, Arik Armstead, Chase Young, Randy Gregory, etc.) are never cited as active 2026 49ers; mentions are allowed strictly in verified historical, 2026 dead-cap, opponent, or external trade-target contexts.
3. **100% Clean Outbound Links & X-First Attribution (`linkIntegrity.js`, `beatAttributionEngine.js`)**:
   - Every external URL (`5,400+` verified across `/data/*.json`) uses `https://`, strips `utm_*`, blocks paywalls (`nytimes.com/athletic`, `sfchronicle.com`, `mercurynews.com`, `pff.com/nfl/players/`, `espn.com/nfl/insider/`), blocks shorteners/wrappers (`dlvr.it`, `bit.ly`, `news.google.com/rss/articles`), prevents podium subjects (`Kyle Shanahan`, `John Lynch`) from hijacking journalist authorship, and prioritizes direct `https://x.com/<handle>/status/<id>` links over Bluesky mirrors whenever discoverable.

---

## 3. Permanent Year-Round Information Architecture & Navigation

1. **Zero Calendar Content Locks / Zero Archive Vault (`seasonStateMachine.js`)**:
   - All views and sub-tabs remain permanently accessible 365 days/year with zero `.off-cycle` dimming, zero `#phaseBanner` strips, and zero Seasonal Archive Vaults.
   - **Tighter 6-Card Default `Home` Dashboard**: `news_briefs` (1) → `upcoming_matchup` (2) → `team_health` (3) → `team_stats` (4) → `salary_cap` (5) → `autopodcast_ai` (6), with 6 optional pinnable cards (`schedule_overview`, `trade_deadline`, `playoff_picture`, `draft_prep`, `draft_live_udfa`, `roster_depth`) and drag/tap reordering in `Customize Order`.
2. **5-Tab Bottom Navigation (`index.html`)**:
   - `Home` (`home`) → `News & Film` (`news`) → `Game & Season` (`season`) → `Roster & Cap` (`roster`) → `Audio & AI` (`audio`).
3. **Unified Two-Row 6-Filter `News & Film` Bar (`newsView.js`)**:
   - Row 1: `All` | `Tweets` | `Articles`
   - Row 2: `Highlights & Videos` | `Film & Trench` | `Trades & Roster` (`0px` mobile horizontal scroll).
   - Renders the schedule-aware **1/day 5:00 PM PT `gemini-4-hydrogen` (`XHIGH`) Top-News Brief** (`~185–240` visible words across 3–5 fluid bullets, upper-right `"xxh ago"`, inline source links, expandable `Sources (N)` list, zero redundant summary box) at the top of `All` and `Home`, promoting uncovered breaking news above the brief when it breaks after generation.
4. **Two-Cluster 8-Tab `Game & Season` Navigation (`seasonMatchupView.js`)**:
   - Cluster Bar 1: `Matchup` | `Health` | `Schedule` | `Stats`
   - Cluster Bar 2: `Trade` | `Playoffs` | `Draft` | `Draft Recap` (`0px` horizontal scroll across `360px–430px`).

---

## 4. Module Functional Requirements & Time-Based Rules

### 4.1 `Game & Season` (`Matchup`, `Health`, `Schedule`, `Stats`, `Trade`, `Playoffs`, `Draft`, `Draft Recap`)
- **Live Scoreboard, `[T-90m, Final)` Game-Day Rosters & Post-Whistle Rollover**:
  - Scoreboards on `Home` and `Matchup` display `@` pre-game, `LIVE • Away–Home` during active play, and `FINAL • Away–Home` (`Season Complete` when concluded).
  - From **90 minutes before kickoff until final whistle (`[T-90m, Final)`)**, both 49ers `Health` and `Matchup` Opponent Health mount declared **Game-Day Inactives** + a **starting-collapsed `<details>` Active Roster (`Offense → Defense → Special Teams`)**, resolving `Questionable` players to `99% • In (Active)` or `0% • Out (Inactive)` while tracking live in-game sideline exits (`50% QTR` → `99% Returned` or `0% Out`).
  - At **`0m` post-whistle (`completed === true`)**, game-day blocks close, weekly IR locks release immediately, and `Matchup` & `Health` roll forward to `Week N+1` with `W / T / F` blanked (`— / — / —`) until Practice Day 1 (`12:15 PM PT`: `2` days prior for `Wed` games, `3` days for `Thu`/`Fri`, `4` days for `Sat`/`Sun`/`Mon`).
  - Both health tables freeze **Column 1 (`Player`)** (`position: sticky; left: 0`) over solid opaque surfaces.
- **21-Day IR Return Lifecycle (`injuryProbabilityModel.js`)**:
  - Models `P(Activated to 53-Man Roster ∩ Plays)` (`>0% GTD`) for open 21-day windows, enforces the weekly `4:00 PM ET` NFL activation deadline (`0% • IR` once missed until final whistle), excludes the Bye week from the 4-game IR minimum, and holds unactivated IR players at `0% • IR` once the 49ers season concludes (`seasonConcluded`).
- **Schedule, 4-Unit Team Stats, Trade, Playoffs & 3-Lens Draft Big Board**:
  - `Schedule`: Collapsible `Previous Games` (`PRE 1..3` + completed `REG`/`POST`) + upcoming `REG`/`POST` progression (`WC`, `WC BYE`, `DIV`, `NFC CHAMP`, `SUPER BOWL`).
  - `Stats`: Single-screen portrait NFL rankings table (`0px` horizontal scroll) + 4-unit deep stats (`Offense`, `Defense`, `Special Teams`, `Penalties & Turnovers`) with clickable 32-team leaderboard modals.
  - `Trade`: Factual pre/post-deadline status, inline completed trades (`<= 30d` visible + `> 30d` collapsible `<details>`), 3-tier CBA base-salary purchasing power, targets, and pitfalls.
  - `Playoffs`: 10,000-run Empirical-Bayes NFC Monte Carlo (`<150 ms`) with interactive week-grouped Rooting Guide toggles.
  - `Draft` & `Draft Recap`: **3-Lens 250+ Prospect Big Board** (`Consensus`, `Likely`, `PFF`, `NR`-at-bottom sort, multi-filters, shareable URL sync) above the **Combine Leaderboard** (gated strictly by upcoming `draftYear` availability), **First-Pick Mock Draft Database** (`30d` through Super Bowl → `7d` post-Super Bowl), 6-pick Tankathon inventory, and 2026 Draft/UDFA class recap.

### 4.2 `Roster & Cap` & 5-Tab `Player Dossier`
- **Roster Explorer (`rosterCapView.js`)**: 88-player roster with `#rosterSortSelect` (`Roster Number` asc default, `First Name`, `Last Name`, `2026 Cap Hit`, `Snap Share %`, `Play Likelihood`, `Athletic RAS`, `Age`) + `#rosterSortDirBtn`, Unit & Position filter bars, Dual-Mode Depth Chart, and 5-year (`2026–2030`) 9-column Armchair GM Cap Simulator (fitting in iPhone 16 Pro landscape with `0px` scroll).
- **5-Tab Player Dossier (`playerSheetView.js`)**: `Overview` → `Health` (full rolling tweets, videos & articles + play-likelihood factors) → `Stats & EPA` (`2026` vs `Career` + 32-team rank modals) → `Spider Chart` (10-axis percentiles + comps) → `Contract` (6 transaction scenarios).

### 4.3 `Audio & AI` Studio & `Settings`
- **Unified Saved Libraries & Shared Hero UX (`audioAiView.js`)**:
  - `49ers Podcasts (7d)` across 6 flagship beat shows (`podcasts://` iOS & `intent://` Android deep links).
  - `Auto Pod` (`2–20 min` slider, `gemini-4-hydrogen` `HIGH` script + Studio TTS / WebWorker Kokoro ONNX + iOS 2-channel Stereo `-84 dBFS` speaker carrier unlock, unified Saved library with `Share Link`, `Share MP3`, `Delete`, zero Archive/Restore clutter).
  - `AI Deep Analysis` (`gemini-4-hydrogen` `HIGH` + Google Search Grounding over Stage-1 dossier, unified Saved library with `Share` & `Delete`).

---

## 5. Automated Quality Assurance (`npm test`)

Every change must pass all 4 automated QA suites (`0` failures, `0px` horizontal overflow across 8 viewports, `0` console/page/network errors):
1. [`tests/unit-engines-qa.mjs`](file:///Users/joshal/workspace/49ers/tests/unit-engines-qa.mjs) — Unit math, data integrity (`5,400+` HTTPS URLs), Worker HTTP `Range` & AI cascades, and `<50 ms` latency budgets.
2. [`tests/holistic-qa-regressions.mjs`](file:///Users/joshal/workspace/49ers/tests/holistic-qa-regressions.mjs) — Multi-year `2027–2030+` rollovers, X-first link priority, Daily Brief citations, and 21-day IR lifecycles.
3. [`tests/timeliness-simulation-qa.mjs`](file:///Users/joshal/workspace/49ers/tests/timeliness-simulation-qa.mjs) — Live Q3 in-game, `0m` post-whistle, Monday rollover, mid-week film, and race-condition simulations.
4. [`tests/e2e-mobile-qa.mjs`](file:///Users/joshal/workspace/49ers/tests/e2e-mobile-qa.mjs) — Headless Chrome CDP E2E across 8 mobile/tablet/desktop viewports (`320x640`–`1280x900`).
