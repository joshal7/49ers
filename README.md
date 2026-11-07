# 49ers Faithful (`49ers.joshal.com`)

A zero-cost, mobile-first Progressive Web App (PWA) engineered for iPhone 16 Safari Home Screen mode and mobile Chrome. Built for ~25 analytically minded San Francisco 49ers fans who want verified facts, All-22 film & scheme mechanics, EPA/NextGen metrics, and CBA salary cap math—with zero clickbait or sensationalism.

- **Live Custom Domain**: `https://49ers.joshal.com`
- **GitHub Repository**: `https://github.com/Joshal7/49ers`

---

## Core Architecture & Features

### 1. Dynamic NFL Calendar State Machine (`src/engine/seasonStateMachine.js`)
Automatically activates relevant dashboard modules and retires off-cycle war rooms to the **Seasonal Vault (`🗄️ Vault`)** without losing user-customized card ordering:
- **Year-Round**:
  - **Roster & 5-Tab Player Dossiers**: Searchable/sortable 88-player roster (53 Active, IR/Reserve, Practice Squad) with 2026 & Career stats, `nflverse` EPA/CPOE/WOPR, NFL NextGen Stats, Pro-Football-Reference Advanced metrics, **MockDraftable-style 0–100th Positional Percentile SVG Spider Charts** + historical NFL comps, multi-year OverTheCap contract tables, and injury play-likelihood priors.
  - **Dual-Mode Depth Chart**: 1-tap toggle between **Projected Active Game-Day Alignment** (auto-promoting healthy backups when starters are Out/IR) and **Baseline Full-Roster Hierarchy**.
  - **Team News & Anti-Fluff Synthesis**: Auto-ranked registry of 45 49ers beat writers, X/film analysts, national insiders, and official team voices (`data/reporters.json`) with per-user outlet/reporter mute controls, clustered fact & film briefs, and inline click-to-play YouTube timestamped clips.
  - **Multi-Year Salary Cap & Armchair GM Simulator**: Live 2026–2029 OverTheCap ledger paired with an interactive CBA calculator supporting Restructures, Extensions, Pre/Post-June 1 Cuts, and Pre/Post-June 1 Trades (including the Top-53 minimum replacement rule and the NFL CBA 2-player Post-June 1 designation limit).
  - **Matchups & International Venue Tracker**: Full 18-week schedule tracking stadium surfaces, rest differentials, and International Series venues (Melbourne Cricket Ground & Estadio Banorte in Mexico City at 7,200 ft altitude).
- **In-Season (`Sept – Postseason Elimination`)**:
  - **Team Health & IR Tracker**: Wed/Thu/Fri practice progression, **Player-Specific Play-Probability Model (%)** (distinguishing habitual veteran rest days for Trent Williams / CMC from acute ankle/soft-tissue tags, and factoring Fred Warner / George Kittle toughness priors), plus an NFL 4-game IR return calculator that automatically excludes the Bye Week.
  - **Team Stats & Power Rankings**: 1st–32nd NFL standard & advanced EPA rankings + aggregated multi-outlet consensus power rankings.
  - **Upcoming Matchup War Room**: Spread/O-U line movement, rest differential, franchise H2H history, coaching staff H2H tendencies (Kyle Shanahan vs. opposing play-callers), and trench/coverage mismatch matrix.
- **Temporal War Rooms**:
  - **Trade Deadline War Room (`Oct 1 – NFL Trade Deadline`)**: Completed move grades, remaining EPA-weighted needs, realistic seller-team fit matrix with pro-rated base salary cap math, Rich Hill pick costs, and credibility-tiered rumors.
  - **Near-Playoffs Monte Carlo (`Final 5 Weeks`)**: **10,000-iteration Monte Carlo Playoff & Seeding Simulator** with official NFL divisional/Wild Card tiebreakers, `#1–#7` seed probability bars, explicit seed paths, and an interactive game-winner **Rooting Guide** that re-runs 10,000 simulations live on tap.
  - **Post-Season to Draft (`Elimination – Draft Eve`)**: Multi-year draft needs, pick capital inventory, consensus mock aggregation, Shanahan/Lynch archetype fit scores, and a searchable NFL Scouting Combine RAS leaderboard.
  - **Draft Live & UDFA Hub (`Draft Day 1 – Post-UDFA`)**: Pick-by-pick value steals vs. consensus big board, inline athletic spider charts, guaranteed UDFA contract tracker, and college highlight reels.
- **Autopodcast Studio & Shared Deep Analysis (`🎧 Audio & AI`)**:
  - Pre-generated studio two-host neural AAC (`.m4a`) episodes + on-demand custom duration (`2–20 min`) podcast & deep analysis generator with sticky cross-tab mini-player, synced interactive transcript seeking, `1x–2x` variable speed, and iOS lock-screen `MediaSession` controls.

---

## Linking `49ers.joshal.com` via GoDaddy DNS

Follow these exact steps on **GoDaddy** (matching `workouts.joshal.com`) and **GitHub**:

### Step 1 — Add the `CNAME` Record in GoDaddy
1. Sign in to [GoDaddy Domain Portfolio](https://dcc.godaddy.com/domains) and select **`joshal.com`**.
2. Open the **DNS** tab -> **DNS Records** and click **Add New Record**.
3. Enter the following values:
   - **Type**: `CNAME`
   - **Name** (Host): `49ers` *(enter only `49ers`, not the full domain)*
   - **Value** (Points to): `joshal7.github.io`
   - **TTL**: `1 Hour` (or `Default` / `600 seconds`)
4. Click **Save**. *(If GoDaddy warns of an existing `49ers` record, edit/replace that record so only one `CNAME` exists for `49ers`.)*

### Step 2 — Verify GitHub Pages & Enforce HTTPS
1. Open `https://github.com/Joshal7/49ers/settings/pages`.
2. Under **Build and deployment**:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main` / `/ (root)` -> **Save**.
3. Under **Custom domain**:
   - Confirm **`49ers.joshal.com`** is entered and wait 1–5 minutes for **DNS check successful** (this repository already includes the root `CNAME` file set to `49ers.joshal.com`).
   - Check **Enforce HTTPS** once GitHub finishes provisioning the free Let's Encrypt TLS certificate (typically 2–15 minutes after GoDaddy DNS propagates).

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

## Local Development & QA Testing

Zero external runtime dependencies are required (`Node.js >= 20`, `Python 3` for static serving, and Google Chrome for headless mobile CDP E2E tests).

```bash
# Start local server at http://localhost:8080
npm start

# Refresh live 49ers roster, OverTheCap contracts, nflverse EPA, health & beat news JSON
npm run refresh-data

# Auto-review & re-rank the 45-reporter popularity registry
npm run update-reporters

# Run the complete Unit, Data, Edge Worker & Headless Chrome Mobile E2E QA Suite
npm test
```

---

## Optional Zero-Cost Shared AI & Audio Edge Worker (`worker/`)

Out of the box, the app works 100% standalone on GitHub Pages with pre-generated neural `.m4a` episodes and a local data-grounded synthesis engine. To enable live Gemini Google-Search-grounded reports and shared cloud R2 audio caching across all ~25 friends (`\$0/month` on Cloudflare Free Tier + Google AI Studio Free Tier):

```bash
cd worker
npx wrangler kv namespace create SHARED_CACHE
npx wrangler r2 bucket create 49ers-podcasts
# Update the KV id in worker/wrangler.toml, then set secrets:
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GROUP_PASSCODE
npx wrangler deploy
```

Then open **⚙️ Settings** inside `49ers.joshal.com`, paste your Worker URL and shared **Group Passcode**, and tap **Save Group Credentials**.
