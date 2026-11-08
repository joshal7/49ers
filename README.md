# 49ers Faithful (`49ers.joshal.com`)

A zero-cost, mobile-first Progressive Web App (PWA) engineered for iPhone 16 / 16 Pro Safari Home Screen mode (`49ers HQ`) and mobile Chrome. Built for ~25 analytically minded San Francisco 49ers fans who want verified facts, All-22 film & scheme mechanics, EPA/NextGen metrics, and CBA salary cap math—with zero clickbait or sensationalism.

- **Live Custom Domain**: `https://49ers.joshal.com`
- **GitHub Repository**: `https://github.com/Joshal7/49ers`
- **Internal Documentation**:
  - [`ARCHITECTURE.md`](./ARCHITECTURE.md) — Holistic Technical Architecture, Quality vs. Speed Philosophy, Engine Specs & QA Playbook
  - [`PRD.md`](./PRD.md) — Product Requirements & Functional Specifications
  - [`AGENTS.md`](./AGENTS.md) & [`GEMINI.md`](./GEMINI.md) — Agent Rules, Invariants & Quick-Reference Map

---

## Core Architecture & Features

### 1. Dynamic NFL Calendar State Machine (`src/engine/seasonStateMachine.js`)
Automatically activates relevant dashboard modules in a strict 12-block priority order and retires off-cycle modules to the **Seasonal Vault** without losing user-customized card ordering (via Up/Down controls or HTML5 Drag-and-Drop):
- **Year-Round**:
  - **Roster Explorer & 5-Tab Player Dossiers**: Searchable/sortable 88-player roster (53 Active, IR/Reserve, Practice Squad) with a streamlined **Sort Dropdown + Up/Down Arrow Direction Toggle** (`Name`, `Jersey Number`, `2026 Cap Hit`, `Off/Def Snap %`, `Play Likelihood %`, `Athletic RAS`, `Age`), Unit & Position group filter bars, `#0` & smart-quote apostrophe search, 2026 & Career stats, `nflverse` EPA/CPOE/WOPR, NFL NextGen Stats, Pro-Football-Reference Advanced metrics, **MockDraftable-style 10-Axis 0–100th Positional Percentile SVG Spider Charts** + historical NFL comps, 6-scenario OverTheCap contract tables, injury play-likelihood priors, and **7-day player news & beat tweet mentions** with 100% author attribution.
  - **Dual-Mode Depth Chart**: 1-tap toggle between **Projected Active Game-Day Alignment** (auto-promoting healthy backups when starters are Out/IR) and **Baseline Full-Roster Hierarchy**, ordered `Offense`, `Defense`, `Special Teams`.
  - **Team News, Sub-Minute Breaking Wire & Jargon Popovers**: Auto-ranked registry of 45 49ers beat writers, X/Bluesky film analysts, national insiders, and official team voices (`data/reporters.json`) with per-user outlet/reporter mute controls, clustered fact & film briefs, **45+ interactive football/cap Jargon Quick-Bubble Popovers** (`src/engine/jargonGlossary.js`), verified YouTube oEmbed inline clips (with automatic external fallback cards for DRM-restricted videos), and a **<1-minute live Bluesky/ESPN breaking wire** (`20s` poll during active 49ers game windows; `45s` standard) that automatically elevates in-game injury return updates (`LIVE INJURY UPDATE`) to `#1`.
  - **5-Year Salary Cap Horizon & Armchair GM Simulator (`2026–2030`)**: Live 5-year OverTheCap summary & 53-player simulator table supporting Restructures, Extensions, Pre/Post-June 1 Cuts, and Pre/Post-June 1 Trades (including combined Prorated & Current-Yr Bonuses, nominal `$0/$0` baseline Dead Money & Cap Savings, Top-53 minimum replacement rules, NFL CBA 2-player Post-June 1 designation warnings, CBA Article 13 rollover modeling, and full 9-column fit in iPhone 16 Pro landscape).
  - **Matchups & International Venue Tracker**: Full 18-week schedule tracking stadium surfaces, rest differentials, and International Series venues (Melbourne Cricket Ground & Estadio Banorte in Mexico City at 7,200 ft altitude).
- **In-Season (`Sept – Postseason Elimination`)**:
  - **Team Health & Season-Ending IR Resolver**: Reconciles official `49ers.com` Roster & Injury Reports (with opponent-match guard against stale prior-week reports), CBS Injuries, and ESPN transactions. Features a **Player-Specific Play-Probability Model (%)** (distinguishing veteran rest days for Trent Williams / CMC from acute ankle/soft-tissue tags, plus Fred Warner / George Kittle toughness priors), an NFL 4-game IR return calculator that excludes the Bye Week, and explicit classification of **Season-Ending IR** (`Out for Season`), **IR — 21-Day Window Open**, `TBD (21d Window Not Open)`, `Reserve / PUP`, and `Reserve / Left Squad`.
  - **Single-Screen Portrait Team Stats & Power Rankings**: 1st–32nd NFL standard & advanced EPA rankings formatted in a compact 4-column table (`Metric`, `49ers`, `Rank`, `NFL Avg`) that fits in a single mobile portrait screen above the bottom nav, plus aggregated multi-outlet consensus power rankings.
  - **Upcoming Matchup & Opponent Health Parity**: Spread/O-U line movement, rest differential, franchise H2H history, coaching staff H2H tendencies (Kyle Shanahan & Raheem Morris vs. opposing play-callers), trench/coverage mismatch matrix, and full **Opposing Team Health & Play Likelihood** parity (Availability Index, 22-starter clearance, healthy Offense/Defense stars, Wed/Thu/Fri injury report, and 4-game IR tracker).
- **Temporal Modules (`Game & Season` Two-Cluster Navigation)**:
  - **Trade Window (`Oct 1 – NFL Trade Deadline`)**: 30-day recency filter for completed acquisitions (moving older trades `>30d` to the Archive Vault), 3-tier CBA base-salary purchasing power, remaining EPA-weighted needs, verified seller-team targets with `2027` cap impact, pitfalls/traps to avoid, and credibility-tiered rumors.
  - **Near-Playoffs Monte Carlo (`Final 5 Weeks`)**: **Calibrated Empirical-Bayes 10,000-iteration Monte Carlo Playoff & Seeding Simulator** (`src/engine/playoffMonteCarlo.js`) with official NFL 2-club/3+-club divisional & Wild Card tiebreakers (including 3-club complete H2H sweep & Step-1 restart rules), `#1–#7` seed probability bars, explicit seed paths, and an interactive **Rooting Guide** that re-runs 10,000 simulations in `<150ms` on tap.
  - **Post-Season to Draft (`Elimination – Draft Eve`)**: Multi-year draft needs, live 6-pick 2027 Tankathon draft capital inventory (accounting for the Rd 4 DeForest Buckner trade), consensus mock aggregation, Shanahan/Lynch archetype fit scores, and a searchable NFL Scouting Combine RAS leaderboard.
  - **Draft Live & UDFA Hub (`Draft Day 1 – Post-UDFA`)**: Pick-by-pick value steals vs. consensus big board, inline athletic spider charts, guaranteed UDFA contract tracker, and college highlight reels.
- **Audio & AI Studio (`🎧 Audio & AI`)**:
  - **49ers Podcasts (7d)**: Aggregates all episodes from the last 7 days across the 6 flagship 49ers beat shows (*The Gold Standard*, *49ers Talk*, *49ers +/-*, *Dieter and Hutch*, *Locked On 49ers*, *Lombardi Lounge*) with `By Date` / `By Podcast` views and native mobile app deep links (`podcasts://` on iOS/iPadOS, `intent://` on Android).
  - **Autopodcast Studio & Deep Analysis Runner**: Pre-generated studio two-host 44.1 kHz 96kbps AAC (`.m4a`) episodes + on-demand custom duration (`2–20 min`) podcast & deep analysis generator powered by **Gemini 3.8 High (`thinkingBudget: 24576`, 2-pass accuracy verification)**, spoken-NFL prosody (`humanizeNflTextForTts`), sticky cross-tab mini-player, synced interactive transcript seeking, `1x–2x` variable speed, iOS lock-screen `MediaSession` controls, and **iOS built-in speaker `AVAudioSessionCategoryPlayback` stereo carrier unlock** (so auto-generated podcasts play out loud on iPhone speakers even when the hardware Silent switch is ON).

---

## Engineering Philosophy: Quality vs. Speed

- **Accuracy & Studio Realism Over Generation Time (`accuracy_over_latency`)**: On-demand AI Deep Analysis and Autopodcast generation deliberately prioritize analytical depth, multi-pass fact/cap verification, and natural multi-speaker TTS over latency. The UI surfaces rough estimated wait times (`~20–40s` for deep analysis; `~30–130s` for cloud podcasts) and a live processing banner with spinner, audio wave bars, and elapsed clock—while Cloudflare KV/R2 shared caching ensures that once one friend generates an item, the other ~24 friends load it in `<50ms`.
- **Sub-Second UI & Sub-Minute Live Wire**: App startup (`<300ms` via Service Worker `CacheStorage`), 5-year cap moves (`<5ms`), 10,000-run Monte Carlo re-simulations (`<150ms`), and live Bluesky/ESPN injury wire polling (`20s` in-game / `45s` standard) execute with sub-second / sub-minute responsiveness.
- **Strict Anti-Hallucination & Link Hygiene**: `groundingValidator.js` blocks retired/departed former 49ers from being hallucinated onto the active 2026 roster, and `linkIntegrity.js` enforces 100% `https://`, blocks paywalls (`The Athletic`, `SF Chronicle`, `Mercury News`, `PFF` grades, `ESPN+`), and defeats `nflverse` retired homonym collisions.

---

## Linking `49ers.joshal.com` via GoDaddy DNS

### Step 1 — Add the `CNAME` Record in GoDaddy
1. Sign in to [GoDaddy Domain Portfolio](https://dcc.godaddy.com/domains) and select **`joshal.com`**.
2. Open the **DNS** tab -> **DNS Records** and click **Add New Record**.
3. Enter the following values:
   - **Type**: `CNAME`
   - **Name** (Host): `49ers` *(enter only `49ers`, not the full domain)*
   - **Value** (Points to): `joshal7.github.io`
   - **TTL**: `1 Hour` (or `Default` / `600 seconds`)
4. Click **Save**.

### Step 2 — Verify GitHub Pages & Enforce HTTPS
1. Open `https://github.com/Joshal7/49ers/settings/pages`.
2. Under **Build and deployment**:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main` / `/ (root)` -> **Save**.
3. Under **Custom domain**:
   - Confirm **`49ers.joshal.com`** is entered and wait 1–5 minutes for **DNS check successful** (this repository includes the root `CNAME` file set to `49ers.joshal.com`).
   - Check **Enforce HTTPS** once GitHub finishes provisioning the Let's Encrypt TLS certificate.

### Step 3 — Verify DNS Propagation from Terminal (Optional)
```bash
dig 49ers.joshal.com +nostats +nocomments +nocmd
```
You should see `49ers.joshal.com. IN CNAME joshal7.github.io.` resolving to GitHub Pages' IPv4/IPv6 addresses.

### Step 4 — Install as an App on iPhone 16 (Safari)
1. Open **`https://49ers.joshal.com`** in **Safari** on your iPhone 16.
2. Tap the **Share** icon (`↑` square at the bottom center).
3. Scroll down and tap **Add to Home Screen**.
4. Confirm the title **`49ers HQ`** and tap **Add**. Launching from your Home Screen opens the standalone full-screen experience (`apple-mobile-web-app-capable`) with the custom 49ers medallion icon and lock-screen audio controls.

---

## Local Development, Pipelines & QA Testing

Zero external runtime dependencies are required (`Node.js >= 20`, `Python 3` for static serving, `ffmpeg` + `edge-tts` for offline studio `.m4a` builds, and Google Chrome for headless mobile CDP E2E tests).

```bash
# Start local server at http://localhost:8080
npm start

# Refresh live 49ers roster, OverTheCap 5-yr contracts, nflverse EPA, 49ers.com health & beat news JSON
npm run refresh-data

# Rebuild the 3 studio-mastered 44.1kHz neural AAC (.m4a) podcast episodes
npm run build-podcasts

# Auto-review & re-rank the 45-reporter popularity registry
npm run update-reporters

# Run Unit, Quantitative Math, Link Policy, Anti-Hallucination & Edge Worker QA Suite
npm run test:unit

# Run Headless Chrome Mobile & 8-Viewport Responsive E2E QA Suite
npm run test:e2e

# Run the complete Unit + Mobile E2E QA Suite (must pass 100% before every commit)
npm test
```

---

## Optional Zero-Cost Shared AI & Audio Edge Worker (`worker/`)

Out of the box, the app works 100% standalone on GitHub Pages with pre-generated neural `.m4a` episodes, a local data-grounded synthesis engine, and natural multi-voice browser speech synthesis (with iOS built-in speaker unlock). To enable live Gemini `3.8-flash` High-Thinking (2-pass audit + Google Search Grounding), Studio Pro TTS cascade, automatic 6-hour `/v1beta/models` upgrades, and shared cloud KV/R2 audio caching across all ~25 friends (`\$0/month` on Cloudflare Free Tier + Google AI Studio Free Tier):

```bash
cd worker
npx wrangler kv namespace create SHARED_CACHE
npx wrangler r2 bucket create 49ers-podcasts
# Update the KV id in worker/wrangler.toml, then set secrets:
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GROUP_PASSCODE
npx wrangler deploy
```

Then open **Settings** inside `49ers.joshal.com`, paste your Worker URL and shared **Group Passcode**, and tap **Save Group Credentials**.
