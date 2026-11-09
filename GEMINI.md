# 49ers.joshal.com — Workspace Guidelines & Rules for Agents

## Strict Naming & Branding Rule
- **NEVER use or mention the phrase "Nerd HQ"** (or variants such as `NerdHQ`, `49ers Nerd HQ`, `The Nerd Edge`, etc.) anywhere in this repository.
- This applies universally across:
  - Code (JavaScript, HTML, CSS, Worker scripts, build pipelines)
  - Comments and documentation
  - Image files, SVG graphics, badges, and image descriptions (`alt` attributes, titles, metadata)
  - Audio podcast scripts, transcripts, and metadata
  - CI/CD workflow definitions and bot names
  - Commit messages and agent responses
- Preferred nomenclature:
  - Repository / Domain: `49ers.joshal.com`
  - Platform / Brand: `49ers Faithful` or `49ers Faithful Briefing` (or `49ers War Room`)
  - Mobile App Short Title: `49ers` or `49ers HQ`
  - Editorial Standards: `Faithful Editorial Charter`

## Editorial Standards
- Ground all insights in verified facts, All-22 film mechanics (EPA/play, CPOE, RYOE, coverage shells, Wide-9 stunt geometry), and CBA salary cap math (Article 13 rollover, weekly base proration, Post-June 1 rules). Zero rage-bait, zero sensationalism, zero clickbait.
- Never render `"War Room"`, `"clickbait cut"`, or `"No-Fluff Synthesis Engine"` in visible UI card titles or copy.

---

## Core Engineering Philosophy: Quality vs. Speed Decision Matrix

When building or modifying features in this repository, adhere strictly to the two-tier performance philosophy (see `ARCHITECTURE.md` for full details):

1. **When to Push for Accuracy, Depth & Audio Realism Over Generation Time (`accuracy_over_latency`)**:
   - **Applies to**: On-demand AI Deep Analysis (`/api/analyze`), On-demand Autopodcast Script & Audio Generation (`/api/podcast`), Scheduled Daily Briefs (`scripts/lib/aiSynthesisEngine.mjs`), and Studio `.m4a` Podcast Builds (`scripts/build-podcasts.mjs`).
   - **Rule**: Never rush, truncate verification, approximate CBA contract math, or downgrade model thinking budgets to save a few seconds. Use the highest-scoring free-tier Gemini model (`gemini-3.8-flash` or `gemini-3.8-pro` via `scoreFreeTierGeminiModel`) with `thinkingBudget: 24576` (`HIGH`), live Google Search Grounding, and a **2-pass internal verification audit** (`verifyPass: true`).
   - **Audio Studio Quality**: Cascade `gemini-2.5-pro-preview-tts` → `gemini-2.5-flash-preview-tts` on the Edge Worker (or `edge-tts` Multilingual Neural voices + 44.1 kHz 7-stage broadcast DSP mastering in `scripts/build-podcasts.mjs`), always passing dialogue through `humanizeNflTextForTts` first.
   - **UX Wait Transparency & Group Deduplication**: Always show pre-click rough duration hints (`[data-est-wait-preview]`) and the live active job banner (`[data-job-progress="active"]` with spinner, 4-bar audio wave, progress bar, elapsed clock, and `Gemini 3.8 High • Accuracy-First` badge). Cache completed outputs in Cloudflare KV (`SHARED_CACHE`) and R2 (`PODCAST_BUCKET`) so the other ~24 friends get `<50ms` instant reads.

2. **When to Push for Sub-Second Interactivity & Sub-Minute Live Telemetry**:
   - **Applies to**: App boot & offline shell (`sw.js`, `<300ms`), 5-year Armchair GM cap simulation (`<5ms`), 10,000-run Empirical-Bayes Playoff Monte Carlo rooting toggles (`<150ms`), roster search/sort, jargon popovers, and in-game injury wire polling.
   - **Rule**: Quantitative engines in `src/engine/` must remain 100% deterministic and synchronous in-browser. Live client telemetry in `src/services/dataService.js` polls Bluesky AT Protocol (`app.bsky.feed.getAuthorFeed`) & ESPN every **20 seconds during active 49ers game windows** (`is49ersGameLiveWindow`) and every **45 seconds** otherwise, elevating in-game injury updates (`LIVE INJURY UPDATE`) to `#1` in `<1 minute`.

---

## Holistic Application Makeup & File Map

- **Entry & Shell**: `index.html`, `manifest.json`, `sw.js` (`CACHE_NAME = '49ers-faithful-v14'`), `src/app.js`, `src/styles.css`.
- **10 Deterministic Engines (`src/engine/`)**:
  - `seasonStateMachine.js`: Evaluates 6 NFL calendar phases (`YEAR_ROUND`, `IN_SEASON`, `TRADE_WINDOW`, `PLAYOFF_PUSH`, `DRAFT_PREP`, `DRAFT_LIVE_UDFA`), resolves the 12-block Home priority order, and partitions completed trades by a **30-day recency window** (`<=30d` in Trade Window; `>30d` in Archive Vault).
  - `capSimulator.js`: 5-year (`2026–2030`) OverTheCap simulator across all 53 active contracts; combines Prorated & Current-Yr Bonuses, defaults nominal Dead Money & Cap Savings to `$0`, enforces Top-53 replacement rules, `>2` Post-June 1 CBA designation warnings, and Article 13 rollover math.
  - `injuryProbabilityModel.js`: Player-specific play likelihood (`0–99%`, Trent Williams/CMC `Vet Rest` vs. acute ankle, Warner/Kittle toughness priors, Friday DNP setback drops), Bye-week-aware 4-game IR return calculator, and `classifyIrAndReserveTimeline` (`Season-Ending IR` vs. `IR — 21-Day Window Open` vs. `TBD (21d Window Not Open)`).
  - `playoffMonteCarlo.js`: Seeded 10,000-iteration NFC simulator with Empirical-Bayes power rating shrinkage (`62%` regressed record + `38%` schedule-adjusted point diff) and NFL 2-club/3+-club tiebreakers (including 3-club complete H2H sweep & Step-1 restart rules).
  - `antiFluffFilter.js`: Signal vs. clickbait scoring and per-user reporter/outlet mute filtering.
  - `groundingValidator.js`: Anti-hallucination guardrail (`DISALLOWED_FORMER_49ERS` including Bryce Huff, Javon Hargrave, Charvarius Ward, Talanoa Hufanga, Aaron Banks, etc.) ensuring departed players are never cited as active 2026 49ers while allowing verified historical, dead-cap, or external trade-target mentions.
  - `breakingClassifier.js`: Sub-minute breaking & in-game injury return classifier, live game-window detector, and short-tweet full-text preservation (`<=320` chars).
  - `linkIntegrity.js`: Enforces `https://`, blocks paywalled/404 domains (`nytimes.com/athletic`, `sfchronicle.com`, `mercurynews.com`, `pff.com/nfl/players/`, `espn.com/nfl/insider/`), resolves `nflverse` retired homonym collisions (`ThomJa06` vs `ThomJa01`, `Ogbo` ↔ `Ogbonnia Okoronkwo`, `Khalil Dinkins` OTC `13810`), and handles dynamic year rollovers (`2026–2030+`).
  - `jargonGlossary.js`: 45+ analytics, scheme, and CBA glossary terms with XSS-safe inline annotation and viewport-clamped popovers (`#jargonPopover`).
  - `podcastSpeechEngine.js`: Spoken-NFL text humanizer (`humanizeNflTextForTts`), conversational turn prosody, browser neural voice selector, and 44.1 kHz 7-stage broadcast DSP mastering.
  - `deepResearchEngine.js`: Multi-stage Deep Football Research Dossier (Stage 1) and NotebookLM-style Conversational Audio Overview Script & Scouting Synthesis (Stage 2) engine.
- **UI Views & Components (`src/views/`, `src/components/`)**:
  - `homeView.js`, `newsView.js`, `seasonMatchupView.js`, `rosterCapView.js`, `playerSheetView.js`, `audioAiView.js`, `settingsArchiveView.js`, `icons.js`, `uiHelpers.js`, `spiderChart.js`, `audioPlayer.js` (includes iOS built-in speaker `AVAudioSessionCategoryPlayback` + 2-ch Stereo `-84 dBFS` dithered WAV carrier unlock so auto podcasts play on phone speakers without AirPods).
- **Pipelines & Edge Worker**:
  - `scripts/fetch-live-49ers-data.mjs` (`npm run refresh-data`), `scripts/build-podcasts.mjs` (`npm run build-podcasts`), `scripts/update-reporter-registry.mjs` (`npm run update-reporters`), and `worker/index.js`.
- **Deep Architecture Reference**: See `ARCHITECTURE.md` and `PRD.md`.

---

## Critical Layout, Data & QA Invariants

1. **Bottom Navigation Order**: `Home` (`home`) → `News & Film` (`news`) → `Game & Season` (`season`) → `Roster & Cap` (`roster`) → `Audio & AI` (`audio`).
2. **Two-Cluster `Game & Season` Sub-Nav**: Bar 1 = `Matchup`, `Health`, `Schedule`, `Stats`; Bar 2 = `Trade`, `Playoffs`, `Draft`, `Draft Recap` (`0px` horizontal scroll across `360px–430px`). `#phaseBanner` (`Active NFL Trade Window`) displays **only** inside `Game & Season → Trade` directly below `.season-subnav-card`.
3. **Single-Screen Portrait Team Stats & Landscape Cap Fit**: `Team Stats` omits the `Category` column so all 11 rankings fit in one portrait screen above `.bottom-nav`. `Cap Simulator` fits all 9 columns without scrolling in iPhone 16 / 16 Pro landscape (`852x393` & `874x402`).
4. **Roster Sort UX**: Dropdown (`#rosterSortSelect`, default `jersey` / `Roster Number` asc, with `First Name`, `Last Name`, `2026 Cap Hit`, `Snap Share %`, `Play Likelihood`, `Athletic RAS`, `Age`) + Up/Down Arrow button (`#rosterSortDirBtn`, `data-sort-dir="asc|desc"`), zero sort pills, and 2 filter rows (`Unit Filter` + `Position Group Filter`).
5. **Mandatory QA Suite (`npm test`)**:
   - Always run `npm test` (`node tests/unit-engines-qa.mjs && node tests/e2e-mobile-qa.mjs`) before completing any task. Both suites must pass with **0 failures, 0 horizontal overflow across all 8 viewports, and 0 console/page/network errors**.
