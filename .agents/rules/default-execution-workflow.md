---
trigger: always_on
description: Default end-to-end execution workflow (persona, thoughtful implementation with unintended-consequence mitigation and zero regressions, uncluttered UI, comprehensive QA, and commit/push/go-live) for all 49ers.joshal.com change requests unless specified otherwise
---

# Default End-to-End Change Execution Rule (`49ers.joshal.com` & All 32 NFL Teams)

For **all conversations in the `49ers` workspace** where the user asks for a change pertaining to `49ers.joshal.com` or the `*.joshal.com` NFL sites, **default to applying the change across ALL 32 NFL teams (`49ers.joshal.com` through `vikings.joshal.com` + `nfl.joshal.com`)** and executing the full 5-step workflow (`0–4`) below unless the user explicitly specifies otherwise (e.g., *"don't implement"*, *"plan only"*, *"just brainstorm"*, *"49ers only"*, or asks a pure question without requesting a change):

0. **Adopt the Correct Multi-Disciplinary Persona**:
   - Operate simultaneously as an **NFL & 49ers Domain Expert** (Shanahan/Saleh/Wide-9 film mechanics, EPA/CPOE/RYOE analytics, NFL CBA salary cap & proration math, IR/practice-window rules, NFL Draft evaluation across all 32 clubs), a **Diehard Analytical Fan**, a **Mobile-First UX & Information Designer**, a **Principal Software & Edge Systems Engineer**, and a **Relentless QA Automation Expert**.

1. **All-32-Team Full Implementation, Unintended-Consequence Mitigation & Zero Latency/Behavior Regressions**:
   - **Unified 32-Team Parity Rule**: Never ship an engine, UI, Worker, or static-data change for `49ers.joshal.com` alone (except intentional per-team config in `src/config/teamRegistry.js`, `config/reporters/`, or explicit SF quota/token preferences in `worker/nfl-teams-worker.js`). Whenever any data-generation or Monte Carlo/seasonal logic changes, update the shared pipeline (`scripts/lib/leaguePlayoffPipeline.mjs` + `scripts/refresh-all-nfl-teams.mjs`) and sync **ALL 32 teams** (`data/*.json` + `data/teams/<slug>/*.json` + `data/league/meta.json`) — use `npm run refresh-data:seasonal` (`--seasonal-only`, ~5–8s) for seasonal/playoff updates or `npm run refresh-data` for full 32-team refreshes.
   - **Assess & Proactively Mitigate Unintended Consequences**: Before and during implementation, explicitly analyze whether the proposed change could trigger unintended side effects or downstream regressions (e.g., stale `localStorage`/PWA/KV cache snapshots, cross-team 49ers leaks, singleton `ACTIVE_TEAM` contamination, heuristic false positives or over-suppression, live-overlay vs. static-pipeline mismatches, cross-module ripple effects across `src/`, `sw.js`, `scripts/`, `data/`, and `worker/nfl-teams-worker.js`, **client or CDN latency regressions for 49ers or any other team**, or mobile layout/UX impacts). Whenever any unintended consequence is identified, proactively mitigate it upfront.
   - Think carefully through diverse use cases and edge cases: NFL calendar phases, `[T-90m, Final)` game-day rosters, immediate post-game `Week N+1` rollovers, Bye weeks, offseason/Combine/Draft blank & freshness windows, empty/fallback/offline PWA states, `'94 Throwback` light and dark themes across all 32 team palettes, portrait/landscape mobile viewports (`320px–1280px`), and deep links.
   - Confirm that the change introduces zero regressions anywhere else in the application.

2. **Clean, Uncluttered, Non-Redundant UI (Progressive Disclosure)**:
   - Design every card, table, toolbar, and control to be high-signal, scannable, and strictly non-redundant (never repeat badges, timestamps, stats, or internal metadata across the same view).
   - Hide secondary, verbose, or supplementary information behind **inline links** (player dossier links, source/tweet links, jargon popovers) and/or **expandable sections, drawers, or modals** (`<details>`, collapsible rows, `Sources (N)` / `+N related` toggles, slide-up sheets).

3. **Comprehensive All-32-Team QA Testing (Build New Coverage + Run Existing Suites)**:
   - Add targeted unit, holistic regression, and/or headless Chrome mobile E2E assertions—or build new dedicated QA test suites when warranted—to verify the new behavior, edge cases, and mitigations for any identified unintended consequences across SF and non-SF clubs.
   - Run the full mandatory QA suites (`npm run test:all`: `unit-engines-qa.mjs`, `holistic-qa-regressions.mjs`, `timeliness-simulation-qa.mjs`, `e2e-mobile-qa.mjs`, `nfl-portal-qa.mjs`, `all-32-teams-qa.mjs`, plus `playoff-model-calibration-qa.mjs` when playoff code/data changes), ensuring **0 failures, 0 cross-team leaks, 0 horizontal overflow across all viewports, and 0 console/page/network errors**.

4. **Commit, Push to GitHub & Deploy All 32 Teams Live**:
   - When client assets (`index.html`, `src/**`, `manifest.json`, `assets/**`) change, bump cache-busters (`sw.js` `CACHE_NAME` and `index.html` `?v=` asset query strings) so PWA clients pick up the update immediately.
   - Stage all modified code and synced 32-team data cleanly (leaving zero uncommitted modified files), commit cleanly, `git push origin main`, AND deploy the unified Cloudflare Pages bundle (`npm run deploy:nfl-teams -- --skip-fetch`) so **all 32 `<team>.joshal.com` sites (including `https://49ers.joshal.com`) AND `https://nfl.joshal.com`** go live together with zero drift.
