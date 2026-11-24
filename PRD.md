# Product Requirements Document (PRD): 49ers Faithful & All-32 NFL Team Platform (`*.joshal.com` / `nfl.joshal.com`)

| Metadata | Details |
| :--- | :--- |
| **Flagship Product** | **49ers Faithful Briefing** (`49ers Faithful` — `https://49ers.joshal.com`) |
| **Multi-Tenant Platform** | All 32 NFL Franchises (`https://<team>.joshal.com`) + **NFL Team Hub** (`https://nfl.joshal.com`) |
| **Repository** | `https://github.com/Joshal7/49ers` |
| **Target Platform** | Mobile Web PWA (iOS 18+ Safari `"Add to Home Screen"` on iPhone 16 / 16 Pro & Mobile/Desktop Chrome) |
| **Target Audience** | Analytically minded NFL & 49ers fans seeking verified facts, All-22 film mechanics, and CBA cap math |
| **Operating Budget** | **Strictly \$0/month** (GitHub Pages + GitHub Actions + Cloudflare Pages/Workers/KV Free Tier + Google AI Studio BYOK/Free Tier) |
| **Design Philosophy** | High-signal football intelligence, zero clickbait/fluff, All-22 X's & O's, CBA salary cap math, instant first-tap responsiveness, sub-minute live wire & 2s live Gamecast, and **Accuracy-Over-Latency** generative synthesis |
| **Technical Reference** | See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for complete module architecture, multi-tenant edge routing, caching/polling budgets, and 6-suite QA matrix |

---

## 1. Executive Summary & Product Vision

**49ers Faithful (`49ers.joshal.com`)** and its multi-tenant **All-32 NFL Team Platform (`<team>.joshal.com` & `nfl.joshal.com`)** deliver a mobile-first Progressive Web App for deeply knowledgeable football fans who want **verified facts, All-22 film/scheme mechanics, quantitative modeling, live Gamecast telemetry, and NFL CBA salary cap math**—stripped of clickbait, rage-bait, and engagement-farming hot takes.

The platform combines four pillars at **\$0/month**:
1. **22 Deterministic Quantitative & Guardrail Engines (`<50 ms` Synchronous Execution)**: Powers 5-year OverTheCap salary cap simulations (`2026–2030`), player-specific play-likelihood & 21-day IR activation modeling, `[T-90m, Final)` NFL 47/48 game-day rosters & healthy scratches, live/historical Gamecast visualizers, 10,000-iteration Empirical-Bayes playoff Monte Carlo, 32-team Power Rankings & Wave 1/2 Deep-Dive analytics, a 3-Lens 250+ Prospect NFL Draft Big Board (`Consensus`, `Likely`, `PFF`), 4-unit 32-team statistical leaderboards, Universal Search, X-first beat attribution, and StoryRank news clustering.
2. **Sub-Minute Live Telemetry & 2-Second Gamecast**: Polls 7 bounded live beat/official channels (`20s` in-game / `45s` standard, pausing cleanly in background tabs), refreshes per-team `~275 KB` ESPN injury/score/standings overlays (`24s` live / `60s` standard), and streams live play-by-play Gamecast (`2s` live / `6s` replay).
3. **Two-Tier Gemini 4 Hydrogen (`gemini-4-hydrogen`) Synthesis & Studio Audio**: Uses maximum `XHIGH` thinking on non-time-sensitive daily syntheses (`1/day 5:00 PM PT` / `8:00 PM ET` Top-News Brief and `1/day` Matchup Intel) and fast `HIGH` thinking on live user-waiting requests (`On-Demand Deep Analysis` and `Auto Pod` multi-speaker studio podcasts), with BYOK Gemini keys seamlessly synced across all 33 origins via `nfl.joshal.com/key-sync` and zero-knowledge 1-tap WebAuthn Passkey PRF sync.
4. **Instant Startup & First-Tap Responsiveness**: Single-instance ES module graph, Cache-First versioned SW assets, `touch-action: manipulation`, and pointer-safe coalesced background renders guarantee that taps register cleanly on the first touch even while live telemetry hydrates in the background.

---

## 2. Editorial Charter & Guardrails

1. **Faithful Editorial Charter (`antiFluffFilter.js`, `linkIntegrity.js`)**:
   - Ground every insight in verified facts, All-22 mechanics (`EPA/play`, `CPOE`, `RYOE`, `11/21 personnel`, `Wide-9` stunt geometry, disguised split-safety / `Quarters` / `Cover 6` rotations), and CBA cap math (`Article 13` 1-for-1 rollover, weekly base-salary trade proration, `Post-June 1` 2-designation rule, `Top-53` replacement).
   - Never render internal labels (`"War Room"`, `"clickbait cut"`, `"No-Fluff Synthesis Engine"`) in visible UI titles or copy.
2. **Zero Retired/Departed Player or Cross-Team Hallucinations (`groundingValidator.js`, `teamRegistry.js`)**:
   - Departed former 49ers (`DISALLOWED_FORMER_49ERS`) are never cited as active 2026 49ers, and non-49ers team sites enforce strict cross-team leak prevention (`hasCrossTeam49ersLeak`).
3. **100% Clean Outbound Links & X-First Attribution (`linkIntegrity.js`, `beatAttributionEngine.js`)**:
   - Every external URL (`5,400+` verified across `/data/*.json`) uses `https://`, strips `utm_*`, blocks paywalls (`nytimes.com/athletic`, `sfchronicle.com`, `mercurynews.com`, `pff.com/nfl/players/`, `espn.com/nfl/insider/`), blocks shorteners/wrappers (`dlvr.it`, `bit.ly`, `news.google.com/rss/articles`), prevents podium subjects from hijacking journalist authorship, and prioritizes direct `https://x.com/<handle>/status/<id>` links over Bluesky mirrors whenever discoverable.

---

## 3. Permanent Year-Round Information Architecture & Navigation

1. **Zero Calendar Content Locks / Zero Archive Vault (`seasonStateMachine.js`)**:
   - All views and sub-tabs remain permanently accessible 365 days/year with zero `.off-cycle` dimming, zero `#phaseBanner` strips, and zero Seasonal Archive Vaults.
   - **6-Card Default `Home` Dashboard**: `news_briefs` (1) → `upcoming_matchup` (2) → `team_health` (3) → `team_stats` (4) → `salary_cap` (5) → `autopodcast_ai` (6), with 6 optional pinnable cards and drag/tap reordering in `Customize Order`.
2. **5-Tab Bottom Navigation (`index.html`) + Universal Search**:
   - `Home` (`home`) → `News & Film` (`news`) → `Game & Season` (`season`) → `Roster & Cap` (`roster`) → `Audio & AI` (`audio`), plus header Universal Search (`/`) and `NFL Team Hub` back navigation in hub mode.
3. **Unified Two-Row 6-Filter `News & Film` Bar (`newsView.js`)**:
   - Row 1: `All` | `Tweets` | `Articles`
   - Row 2: `Highlights & Videos` | `Film & Trench` | `Trades & Roster` (`0px` mobile horizontal scroll).
   - Renders the schedule-aware **1/day `gemini-4-hydrogen` (`XHIGH`) Top-News Brief** (at `5:00 PM PT` / `6:00 PM MT` / `7:00 PM CT` / `8:00 PM ET`, or post-game on game days) at the top of `All` and `Home`, promoting uncovered breaking news above the brief when it breaks after generation.
4. **Two-Cluster 8-Tab `Game & Season` Navigation (`seasonMatchupView.js`)**:
   - Cluster Bar 1: `Matchup` | `Health` | `Schedule` | `Stats`
   - Cluster Bar 2: `Trade` | `Playoffs` | `Draft` | `Draft Recap` (`0px` horizontal scroll across `360px–430px`).
5. **NFL Team Hub (`nfl.joshal.com`)**:
   - Single-screen NFC / AFC 32-team icon launcher organized by division (`North`, `South`, `East`, `West`) with light/dark theme toggle, instant standalone PWA navigation (`/?team=<slug>`), and cross-device Gemini key sync.

---

## 4. Module Functional Requirements & Time-Based Rules

### 4.1 `Game & Season` (`Matchup`, `Health`, `Schedule`, `Stats`, `Trade`, `Playoffs`, `Draft`, `Draft Recap`) & `Gamecast`
- **Live Scoreboard, Live/Historical Gamecast, `[T-90m, Final)` Game-Day Rosters & Post-Whistle Rollover**:
  - Scoreboards on `Home`, `Matchup`, and `Schedule` display `@` pre-game, `LIVE • Away–Home` during play, and `FINAL • Away–Home`, tapping directly into the native **Gamecast** sheet (live field visualizer, play-by-play, win probability, drive logs, and full box scores).
  - From **90 minutes before kickoff until final whistle (`[T-90m, Final)`)**, both Team `Health` and `Matchup` Opponent Health mount declared **Game-Day Inactives** + a **starting-collapsed `<details>` Active Roster (`Offense → Defense → Special Teams`)** obeying the **NFL 47/48 active game-day limit** (`48` with `>= 8` active OL, `47` otherwise). Medical scratches render in red while **Healthy Scratches / Coach's Decisions** and **Emergency 3rd QBs** render in distinct neutral slate styling; `Questionable` players resolve to `99% • In (Active)` or `0% • Out (Inactive)` while live sideline exits track in real time.
  - At **`0m` post-whistle (`completed === true`)**, game-day blocks close, weekly IR locks release immediately, and `Matchup` & `Health` roll forward to `Week N+1` with `W / T / F` blanked (`— / — / —`) until Practice Day 1 (`12:15 PM PT`: `2` days prior for `Wed` games, `3` days for `Thu`/`Fri`, `4` days for `Sat`/`Sun`/`Mon`).
  - Both health tables freeze **Column 1 (`Player`)** (`position: sticky; left: 0`) over solid opaque surfaces.
- **21-Day IR Return Lifecycle (`injuryProbabilityModel.js`)**:
  - Models `P(Activated to 53-Man Roster ∩ Plays)` (`>0% GTD`) for open 21-day windows, enforces the weekly `4:00 PM ET` NFL activation deadline (`0% • IR` once missed until final whistle), excludes the Bye week from the 4-game IR minimum, and holds unactivated IR players at `0% • IR` once the team's season concludes (`seasonConcluded`).
- **Schedule, 4-Unit Team Stats, Deep-Dive Analytics, Trade, Playoffs & 3-Lens Draft Big Board**:
  - `Schedule`: Collapsible `Previous Games` (`PRE 1..3` + completed `REG`/`POST`) + upcoming `REG`/`POST` progression with 1-tap historical/live Gamecast access.
  - `Stats`: Single-screen portrait NFL rankings table (`0px` horizontal scroll), 4-unit deep stats (`Offense`, `Defense`, `Special Teams`, `Penalties & Turnovers`), Wave 1/2 team tendencies, 32-team Power Rankings, and clickable 32-team leaderboard modals.
  - `Trade`: Factual pre/post-deadline status, inline completed trades (`<= 30d` visible + `> 30d` collapsible `<details>`), 3-tier CBA base-salary purchasing power, targets, and pitfalls.
  - `Playoffs`: 10,000-run Empirical-Bayes conference Monte Carlo (`<150 ms`) with interactive week-grouped Rooting Guide toggles.
  - `Draft` & `Draft Recap`: **3-Lens 250+ Prospect Big Board** (`Consensus`, `Likely`, `PFF`, `NR`-at-bottom sort, multi-filters, shareable URL sync) above the **Combine Leaderboard** (gated strictly by upcoming `draftYear` availability), **First-Pick Mock Draft Database** (`30d` through Super Bowl → `7d` post-Super Bowl), draft pick inventory, and class recap.

### 4.2 `Roster & Cap` & Cross-Team Native 5-Tab `Player Dossier`
- **Roster Explorer (`rosterCapView.js`)**: Full roster with `#rosterSortSelect` (`Roster Number` asc default, `First Name`, `Last Name`, `2026 Cap Hit`, `Snap Share %`, `Play Likelihood`, `Athletic RAS`, `Age`) + `#rosterSortDirBtn`, Unit & Position filter bars, Dual-Mode Depth Chart, and 5-year (`2026–2030`) 9-column Armchair GM Cap Simulator (fitting in iPhone 16 Pro landscape with `0px` scroll).
- **Cross-Team Native 5-Tab Player Dossier (`playerSheetView.js`, `remoteTeamDossierService.js`)**: `Overview` → `Health` (rolling tweets, videos & articles + play-likelihood factors) → `Stats & EPA` (`2026` vs `Career` + 32-team rank modals) → `Spider Chart` (10-axis percentiles + comps) → `Contract` (6 transaction scenarios)—available seamlessly for both active-team and opponent/cross-team players.

### 4.3 `Audio & AI` Studio & `Settings`
- **Unified Saved Libraries & Shared Hero UX (`audioAiView.js`)**:
  - Team Beat Podcasts (`7d`) across curated flagship shows (`podcasts://` iOS & `intent://` Android deep links).
  - `Auto Pod` (`2–20 min` slider, `gemini-4-hydrogen` `HIGH` script + Studio TTS / WebWorker Kokoro ONNX + iOS 2-channel Stereo `-84 dBFS` speaker carrier unlock, unified Saved library with `Share Link`, `Share MP3`, `Delete`, zero Archive/Restore clutter).
  - `AI Deep Analysis` (`gemini-4-hydrogen` `HIGH` + Google Search Grounding over Stage-1 dossier, unified Saved library with `Share` & `Delete`).
  - `Settings`: All-32 Team Switcher, Light/Dark theme, Beat Reporter & Outlet Filters, Quiet Push Alerts, Podcast defaults, and 1-Tap Passkey PRF Gemini API Key Sync.

---

## 5. Automated 6-Suite Quality Assurance

Every change must pass all applicable automated QA suites with **0 failures, 0px horizontal overflow across all viewports, and 0 console/page/network errors**:
1. [`tests/unit-engines-qa.mjs`](file:///Users/joshal/workspace/49ers/tests/unit-engines-qa.mjs) — All 22 engines, data integrity (`5,400+` HTTPS URLs), single-instance module graph, Worker KV TTL / `404 JSON` / HTTP `Range` & AI cascades, and `<50 ms` latency budgets.
2. [`tests/holistic-qa-regressions.mjs`](file:///Users/joshal/workspace/49ers/tests/holistic-qa-regressions.mjs) — Multi-year `2027–2030+` rollovers, X-first link priority, Daily Brief citations, and 21-day IR lifecycles.
3. [`tests/timeliness-simulation-qa.mjs`](file:///Users/joshal/workspace/49ers/tests/timeliness-simulation-qa.mjs) — Live Q3 in-game, `0m` post-whistle, Monday rollover, mid-week film, and race-condition simulations.
4. [`tests/e2e-mobile-qa.mjs`](file:///Users/joshal/workspace/49ers/tests/e2e-mobile-qa.mjs) — Headless Chrome CDP E2E across 8 mobile/tablet/desktop viewports (`320x640`–`1280x900`), including pointer-safe first-tap responsiveness and Gamecast/Search/Dossier flows.
5. [`tests/nfl-portal-qa.mjs`](file:///Users/joshal/workspace/49ers/tests/nfl-portal-qa.mjs) — `nfl.joshal.com` 32-team portal, standalone hub mode, and `/key-sync` vault verification.
6. [`tests/all-32-teams-qa.mjs`](file:///Users/joshal/workspace/49ers/tests/all-32-teams-qa.mjs) — All 32 team data bundles, themes, icons, and zero cross-team leak verification.
