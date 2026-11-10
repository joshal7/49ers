/**
 * Comprehensive Headless Chrome Mobile & Multi-Viewport E2E QA Suite
 * Tests every PRD feature, interactive control, quantitative engine integration,
 * responsive mobile viewport (iPhone 16 393x852, 375x667, 360x780, 768x1024),
 * zero horizontal overflow, zero console/page errors, and edge/corner cases.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const PORT = 8094;
const CDP_PORT = 9239;
const BASE_URL = `http://127.0.0.1:${PORT}/index.html`;

let passed = 0;
let failed = 0;
const failures = [];

function recordPass(label) {
  passed++;
  console.log(`  ✓ ${label}`);
}

function recordFail(label, err) {
  failed++;
  const msg = err instanceof Error ? err.message : String(err);
  failures.push({ label, msg });
  console.error(`  ✗ ${label}\n      -> ${msg}`);
}

async function runStep(label, fn) {
  try {
    await fn();
    recordPass(label);
  } catch (err) {
    recordFail(label, err);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

const mockGeminiRequests = [];

function buildMockNotebookLmScript12Turns() {
  return [
    {
      speaker: 'Marcus',
      text: "Alright, let's get right into this 49ers wide receiver room because if you just glance at the injury report on paper, it looks chaotic—but when you actually watch the All-22 tape from the first eight weeks, there's a really clear structural reason Brock Purdy is still sitting near the top of the league in EPA per dropback."
    },
    {
      speaker: 'Elena',
      text: "Yeah, and honestly that's the part casual takes miss. With Brandon Aiyuk on season-ending IR and Mike Evans rehabbing on injured reserve, everybody assumed defenses would just play press-man across the board and suffocate the intermediate middle. Instead, look at how Kyle Shanahan is using Jordan Watkins and Ricky Pearsall."
    },
    {
      speaker: 'Marcus',
      text: "Exactly! Jordan Watkins isn't just running clear-out go routes—Shanahan's motioning him into reduced splits so safeties in two-high quarters can't trigger downhill early on the dagger and dig windows. When Ricky Pearsall works that weakside glance or deep over off play-action, Purdy's hitting the back of his drop in rhythm."
    },
    {
      speaker: 'Elena',
      text: "Wait—and look at how Demarcus Robinson changes the third-down math when his ankle is right. Having a veteran boundary receiver who understands leverage against Cover-3 buzz means you aren't forcing rookie route runners to beat disguised cloud corners on third-and-seven."
    },
    {
      speaker: 'Marcus',
      text: "That's huge heading into Sunday against Las Vegas, too. Because if the Raiders try totilt coverage toward George Kittle and Christian McCaffrey on choice routes, Watkins and Robinson get isolated one-on-one outside the numbers with zero safety overlap."
    },
    {
      speaker: 'Elena',
      text: "Now let's flip to the front-office ledger, because people keep asking why John Lynch doesn't just burn all 35.16 million dollars of 2026 cap space on an expensive veteran wideout rental before the November 10th trade deadline."
    },
    {
      speaker: 'Marcus',
      text: "Right—on the surface 35 million sounds like a blank check. Walk through why spending that on a big receiver contract right now would actually blow up 2027."
    },
    {
      speaker: 'Elena',
      text: "Under Article 13 of the CBA, every single dollar of unused 2026 cap space rolls over one-for-one into 2027, where San Francisco is currently projected at minus 31.54 million dollars. That 2026 cushion isn't luxury spending cash—it's literally the bridge keeping the 2027 roster compliant without gutting core starters."
    },
    {
      speaker: 'Marcus',
      text: "Plus, even if you acquire a receiver midseason, you're absorbing nine eighteenths of his remaining 2026 base salary AND inheriting whatever unguaranteed 2027 cap hit sits on that deal—not to mention San Francisco only holds six picks in the 2027 draft after sending their fourth-rounder for DeForest Buckner."
    },
    {
      speaker: 'Elena',
      text: "Spot on. That's why getting cost-controlled separation snaps from rookie and second-year wideouts like Ricky Pearsall and Jordan Watkins is worth its weight in gold on OverTheCap."
    },
    {
      speaker: 'Marcus',
      text: "And the counter-argument we have to stay honest about is red-zone physicality against tight press in January. Until Mike Evans or Ricky Pearsall are back at full throttle inside the twenty, Shanahan has to manufacture condensed bunches and motion stacks so nobody gets jammed cleanly at the line."
    },
    {
      speaker: 'Elena',
      text: "That's the exact chessboard to watch: protect that 35.16 million Article 13 rollover for 2027, lean on Pearsall, Watkins, and Demarcus Robinson in rhythm spacing, and let Purdy dissect two-high shells from clean pockets."
    }
  ];
}

function buildMockHarmonicPcmBase64(durationSec = 90, sampleRate = 24000) {
  const totalSamples = Math.max(2400, Math.round(durationSec * sampleRate));
  const buf = Buffer.allocUnsafe(totalSamples * 2);
  for (let i = 0; i < totalSamples; i++) {
    const env = i < 1200 ? i / 1200 : i > totalSamples - 1200 ? (totalSamples - i) / 1200 : 1;
    const sample = Math.round(
      env * (Math.sin(i * 0.058) * 5800 + Math.sin(i * 0.087) * 2900)
    );
    buf.writeInt16LE(sample, i * 2);
  }
  return buf.toString('base64');
}

function startStaticServer(port) {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg'
  };

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

      // Local Mock Gemini v1beta API for deterministic E2E testing of Browser -> Gemini Pro High + NotebookLM TTS
      if (urlPath === '/v1beta/models' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        });
        res.end(
          JSON.stringify({
            models: [
              { name: 'models/gemini-3.8-pro', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-2.5-pro-preview-tts', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] }
            ]
          })
        );
        return;
      }

      if (urlPath.startsWith('/v1beta/models/') && urlPath.endsWith(':generateContent') && req.method === 'POST') {
        let rawBody = '';
        req.on('data', chunk => {
          rawBody += chunk;
        });
        req.on('end', async () => {
          let parsed = {};
          try {
            parsed = JSON.parse(rawBody || '{}');
          } catch {}
          mockGeminiRequests.push({ urlPath, body: parsed });

          if (urlPath.includes('preview-tts:generateContent')) {
            await new Promise(r => setTimeout(r, 750));
            const fullText = String(parsed?.contents?.[0]?.parts?.[0]?.text || '');
            const afterHeader = fullText.includes('Transcript:\n')
              ? fullText.split('Transcript:\n')[1]
              : fullText;
            const spokenWords = afterHeader
              .trim()
              .split(/\s+/)
              .filter(Boolean).length;
            const segSeconds = Math.max(25, Math.min(130, (spokenWords / 148) * 60));
            const b64Audio = buildMockHarmonicPcmBase64(segSeconds, 24000);
            res.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store'
            });
            res.end(
              JSON.stringify({
                candidates: [
                  {
                    content: {
                      parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: b64Audio } }]
                    }
                  }
                ]
              })
            );
            return;
          }

          // Text reasoning stages (Stage 1 Deep Research / Stage 2 Synthesis / Stage 3 Audit)
          await new Promise(r => setTimeout(r, 450));
          const userPrompt = String(parsed?.contents?.[0]?.parts?.[0]?.text || '');

          if (
            userPrompt.includes('raw JSON array') ||
            userPrompt.includes('DRAFT JSON SCRIPT:')
          ) {
            res.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store'
            });
            res.end(
              JSON.stringify({
                candidates: [
                  {
                    content: {
                      parts: [
                        { thought: true, text: 'Auditing conversational cadence, contractions, and WR cap math...' },
                        { text: JSON.stringify(buildMockNotebookLmScript12Turns()) }
                      ]
                    }
                  }
                ]
              })
            );
            return;
          }

          // Extract user question for tailored response (including retired Bryce Huff check & XSS escaping check)
          const qMatch =
            userPrompt.match(/USER(?:'S EXACT QUESTION| TOPIC \/ QUESTION TO INVESTIGATE IN DEPTH):\s*"([^"]+)"/) ||
            userPrompt.match(/specifically answer "([^"]+)"/);
          const extractedQ = qMatch ? qMatch[1] : userPrompt.slice(0, 180);

          let mdText = `### Executive Thesis: 49ers Wide Receiver Spacing & 2027 Cap Discipline
With **Brandon Aiyuk** on season-ending IR and **Mike Evans** rehabbing on IR, Kyle Shanahan keeps **Brock Purdy** operating in rhythm by pairing **Jordan Watkins**, **Ricky Pearsall**, and **Demarcus Robinson** in condensed motion stacks against two-high shells.

### All-22 Film Mechanics & Route Distribution
* **Jordan Watkins** stretches quarters safeties vertically from reduced splits so intermediate dig and glance windows stay clean.
* **Ricky Pearsall** and **Demarcus Robinson** handle high-leverage third-down isolation and sight adjustments outside the numbers.

### Multi-Year CBA Article 13 Cap Verdict
* San Francisco's **$35.16M** in 2026 Top-51 space must roll over 1-for-1 under **CBA Article 13** to offset the projected **-$31.54M** 2027 cap deficit rather than overpaying for a long-term veteran WR contract.`;

          if (/Bryce Huff/i.test(extractedQ) || /Bryce Huff/i.test(userPrompt.slice(0, 500))) {
            mdText = `### Live Roster Grounding Verification
* **Bryce Huff** is a **retired/departed** former NFL edge rusher and is **not on the live 2026 San Francisco 49ers** active 53-man roster, Injured Reserve, or Practice Squad.
* San Francisco's active 2026 defensive end rotation under DC Raheem Morris features **Nick Bosa**, **Keion White**, and **Mykel Williams** alongside interior trade acquisition **DeForest Buckner**.`;
          } else if (extractedQ.includes('<img') || extractedQ.includes('<script') || userPrompt.includes('<img src=x')) {
            mdText = `### Security Escaping Audit: <img src=x onerror="window.__xssTriggered=true"><script>window.__xssTriggered=true</script>\n* **Brock Purdy** posts elite efficiency against two-high shells while preserving **$35.16M** in 2026 Article 13 rollover.`;
          }

          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
          });
          res.end(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      { thought: true, text: 'Deep Stage-1/2/3 reasoning scratchpad...' },
                      { text: mdText }
                    ]
                  },
                  groundingMetadata: {
                    groundingChunks: [
                      {
                        web: {
                          title: 'OverTheCap 49ers Salary Cap',
                          uri: 'https://overthecap.com/salary-cap/san-francisco-49ers'
                        }
                      }
                    ]
                  }
                }
              ]
            })
          );
        });
        return;
      }

      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const fullPath = path.resolve(rootDir, rel);

      if (!fullPath.startsWith(rootDir) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      const contentType = mime[path.extname(fullPath).toLowerCase()] || 'application/octet-stream';
      const buf = fs.readFileSync(fullPath);
      const range = req.headers.range;

      if (range && /^bytes=\d*-\d*$/.test(range)) {
        const [startStr, endStr] = range.replace('bytes=', '').split('-');
        const start = startStr ? parseInt(startStr, 10) : 0;
        const end = endStr ? Math.min(buf.length - 1, parseInt(endStr, 10)) : buf.length - 1;
        if (start >= 0 && start <= end && end < buf.length) {
          const slice = buf.subarray(start, end + 1);
          res.writeHead(206, {
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${buf.length}`,
            'Content-Length': slice.length
          });
          res.end(slice);
          return;
        }
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Length': buf.length,
        'Cache-Control': 'no-cache'
      });
      res.end(buf);
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function launchHeadlessChrome(userDataDir) {
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (!fs.existsSync(chromePath)) {
    throw new Error(`Google Chrome not found at ${chromePath}`);
  }

  const proc = spawn(
    chromePath,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--disable-audio-output',
      `--user-data-dir=${userDataDir}`,
      BASE_URL
    ],
    { stdio: 'ignore' }
  );

  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (res.ok) {
        const pages = await res.json();
        const target = pages.find(p => p.type === 'page' && p.url.includes(String(PORT)));
        if (target?.webSocketDebuggerUrl) {
          return { proc, wsUrl: target.webSocketDebuggerUrl };
        }
      }
    } catch {}
  }

  proc.kill('SIGKILL');
  throw new Error('Timed out waiting for Headless Chrome CDP target');
}

class CdpHarness {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.consoleErrors = [];
    this.pageExceptions = [];
    this.localNetworkFailures = [];

    this.ws.addEventListener('message', evt => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.method === 'Runtime.consoleAPICalled') {
          if (msg.params?.type === 'error') {
            const text = (msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
            // Ignore blocked external YouTube embed telemetry inside headless Chromium
            if (!/youtube\.com|doubleclick|googleads/i.test(text)) {
              this.consoleErrors.push(text);
            }
          }
        } else if (msg.method === 'Runtime.exceptionThrown') {
          const details = msg.params?.exceptionDetails;
          this.pageExceptions.push(details?.exception?.description || details?.text || JSON.stringify(details));
        } else if (msg.method === 'Network.responseReceived') {
          const url = msg.params?.response?.url || '';
          const status = msg.params?.response?.status || 200;
          if (url.includes(`127.0.0.1:${PORT}`) && status >= 400) {
            this.localNetworkFailures.push(`HTTP ${status}: ${url}`);
          }
        }
      } catch {}
    });
  }

  send(method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => reject(new Error(`CDP timeout on ${method}`)), timeoutMs);
      const onMsg = evt => {
        const data = JSON.parse(evt.data);
        if (data.id === id) {
          clearTimeout(timer);
          this.ws.removeEventListener('message', onMsg);
          if (data.error) reject(new Error(`${method} error: ${JSON.stringify(data.error)}`));
          else resolve(data.result);
        }
      };
      this.ws.addEventListener('message', onMsg);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async setViewport(width, height, mobile = true, deviceScaleFactor = 3) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile
    });
    await this.sleep(80);
  }

  async eval(fnOrExpr, arg = undefined) {
    const expression =
      typeof fnOrExpr === 'function'
        ? `(${fnOrExpr.toString()})(${arg === undefined ? '' : JSON.stringify(arg)})`
        : fnOrExpr;
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(
        `Eval exception: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`
      );
    }
    return res.result?.value;
  }

  async waitFor(predicateFn, arg = undefined, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const val = await this.eval(predicateFn, arg);
      if (val) return val;
      await this.sleep(100);
    }
    throw new Error(`Timed out waiting for condition: ${predicateFn.toString().slice(0, 120)}`);
  }

  async assertNoOverflow(label) {
    const metrics = await this.eval(() => {
      const docOverflow = document.documentElement.scrollWidth - window.innerWidth;
      const bodyOverflow = document.body.scrollWidth - window.innerWidth;
      const sheetBody = document.getElementById('sheetBody');
      const backdrop = document.getElementById('bottomSheetBackdrop');
      let sheetOverflow = 0;
      if (backdrop && !backdrop.hidden && sheetBody) {
        const sheetEl = document.getElementById('bottomSheetContainer');
        if (sheetEl) {
          sheetOverflow = sheetEl.scrollWidth - sheetEl.clientWidth;
        }
      }
      return {
        innerWidth: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        docOverflow,
        bodyOverflow,
        sheetOverflow
      };
    });

    assert(
      metrics.docOverflow <= 1 && metrics.bodyOverflow <= 1 && metrics.sheetOverflow <= 1,
      `Horizontal overflow detected in [${label}]: innerWidth=${metrics.innerWidth}, docScrollWidth=${metrics.docScrollWidth}, docOverflow=${metrics.docOverflow}px, sheetOverflow=${metrics.sheetOverflow}px`
    );
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('49ERS FAITHFUL — HEADLESS CHROME MOBILE E2E QA SUITE');
  console.log('======================================================');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), '49ers-hq-e2e-'));
  const server = await startStaticServer(PORT);
  let chromeProc = null;
  let ws = null;

  try {
    const launched = await launchHeadlessChrome(tmpDir);
    chromeProc = launched.proc;

    ws = new WebSocket(launched.wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    const cdp = new CdpHarness(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Page.enable');

    // Intercept external youtube.com iframe navigations so headless tests never stall on external ads
    await cdp.send('Network.setBlockedURLs', {
      urls: ['*://www.youtube.com/embed/*']
    });

    // Configure primary target device: iPhone 16 Safari Portrait (393 x 852 @3x)
    await cdp.setViewport(393, 852, true, 3);
    await cdp.send('Page.reload', { ignoreCache: true });

    // Wait for live JSON feeds & dashboard cards to render
    await cdp.waitFor(() => {
      return document.querySelectorAll('[data-dashboard-block], .reorder-bar').length > 0 ||
        document.getElementById('mainView')?.textContent?.includes('Customize Order');
    });

    console.log('\n=== [1/9] PWA Meta, iPhone 16 Home Screen Shortcut, CNAME & Service Worker ===');

    await runStep('PWA manifest, iOS web-app-capable meta tags, apple-touch-icon & CNAME verified', async () => {
      const pwaInfo = await cdp.eval(async () => {
        const appleCapable = document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content;
        const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content;
        const touchIcon = document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href');
        const manifestRes = await fetch('./manifest.json');
        const manifest = await manifestRes.json();
        const iconRes = await fetch(touchIcon);
        const cnameRes = await fetch('./CNAME');
        const cname = (await cnameRes.text()).trim();
        return {
          appleCapable,
          appleTitle,
          manifestDisplay: manifest.display,
          manifestIcons: manifest.icons?.length || 0,
          iconStatus: iconRes.status,
          cname
        };
      });

      assert(pwaInfo.appleCapable === 'yes', 'Missing apple-mobile-web-app-capable=yes');
      assert(pwaInfo.appleTitle === '49ers HQ', `Unexpected apple title: ${pwaInfo.appleTitle}`);
      assert(pwaInfo.manifestDisplay === 'standalone', 'Manifest display must be standalone');
      assert(pwaInfo.manifestIcons >= 2, 'Manifest must define icons');
      assert(pwaInfo.iconStatus === 200, 'apple-touch-icon.png did not return HTTP 200');
      assert(pwaInfo.cname === '49ers.joshal.com', `CNAME mismatch: ${pwaInfo.cname}`);
    });

    await runStep('Service Worker registers cleanly and activates without errors', async () => {
      const swReady = await cdp.waitFor(async () => {
        if (!('serviceWorker' in navigator)) return false;
        const reg = await navigator.serviceWorker.getRegistration();
        return Boolean(reg && (reg.active || reg.installing || reg.waiting));
      }, undefined, 6000);
      assert(swReady, 'Service Worker failed to register');
    });

    console.log('\n=== [2/9] Home Dashboard, Season State Machine & Persistent Drag/Tap Reordering ===');

    await runStep('Home Dashboard renders exact requested default module order, top tweets & articles, opponent health, source links, and zero PRD callouts', async () => {
      await cdp.assertNoOverflow('Home Dashboard (iPhone 16 393x852)');
      const homeInfo = await cdp.eval(() => {
        const bannerEl = document.getElementById('phaseBanner');
        const bannerHiddenOnHome = Boolean(bannerEl?.hidden);
        const recordText = document.getElementById('headerRecordPill')?.textContent?.trim();
        const customizeBtn = document.querySelector('[data-action="toggle-customize-layout"]');
        const reorderBarText = document.querySelector('.reorder-bar')?.textContent || '';
        const navSvgCount = document.querySelectorAll('.bottom-nav svg.ui-icon').length;
        const cardBadgeSvgCount = document.querySelectorAll('.card-icon-badge svg.ui-icon').length;
        const blockOrder = Array.from(document.querySelectorAll('[data-dashboard-block]')).map(el =>
          el.getAttribute('data-dashboard-block')
        );
        const mainText = document.getElementById('mainView')?.textContent || '';
        const newsCard = document.querySelector('[data-dashboard-block="news_briefs"]');
        const tweetLinks = newsCard ? newsCard.querySelectorAll('.home-wire-item a[href^="https://"]').length : 0;
        const articleLinks = newsCard ? newsCard.querySelectorAll('a.home-article-row[href^="https://"]').length : 0;
        const externalLinksCount = document.querySelectorAll('#mainView a[href^="https://"]').length;
        const matchupCard = document.querySelector('[data-dashboard-block="upcoming_matchup"]');
        const matchupText = matchupCard?.textContent || '';
        const matchupPlayerAvatars = matchupCard ? matchupCard.querySelectorAll('.player-avatar').length : 0;
        return {
          bannerHiddenOnHome,
          recordText,
          hasCustomize: Boolean(customizeBtn),
          reorderBarText,
          navSvgCount,
          cardBadgeSvgCount,
          blockOrder,
          hasWarRoom: /war\s*room/i.test(mainText),
          hasClickbaitCut: /clickbait\s*cut/i.test(mainText),
          tweetLinks,
          articleLinks,
          externalLinksCount,
          matchupPlayerAvatars,
          expectedRecord: window.__49ersDiagnostics.getState().appData.meta.teamRecord,
          hasOpponentHealthPreview:
            matchupText.includes(window.__49ersDiagnostics.getState().appData.scheduleMatchup.upcomingMatchup.oppName) &&
            matchupText.includes('Health')
        };
      });

      assert(
        homeInfo.recordText === homeInfo.expectedRecord,
        `Expected header record ${homeInfo.expectedRecord}, got ${homeInfo.recordText}`
      );
      assert(homeInfo.bannerHiddenOnHome === true, 'Phase banner ("Active NFL Trade Window") must be hidden on Home tab');
      assert(homeInfo.matchupPlayerAvatars === 0, `Expected 0 player avatars in Home Upcoming Matchup box, got ${homeInfo.matchupPlayerAvatars}`);
      assert(homeInfo.hasCustomize, 'Missing Customize Order button');
      assert(homeInfo.reorderBarText.includes('active modules'), 'Missing active modules summary');
      assert(homeInfo.navSvgCount === 5, `Expected 5 SVG icons in bottom nav, got ${homeInfo.navSvgCount}`);
      assert(homeInfo.cardBadgeSvgCount >= 6, `Expected >=6 SVG card icon badges on Home Dashboard, got ${homeInfo.cardBadgeSvgCount}`);
      assert(
        JSON.stringify(homeInfo.blockOrder) ===
          JSON.stringify([
            'news_briefs',
            'upcoming_matchup',
            'team_health',
            'schedule_overview',
            'trade_deadline',
            'team_stats',
            'roster_depth',
            'salary_cap',
            'autopodcast_ai'
          ]),
        `Unexpected default Home block order: ${JSON.stringify(homeInfo.blockOrder)}`
      );
      assert(!homeInfo.hasWarRoom, 'Found "War Room" text on Home Dashboard');
      assert(!homeInfo.hasClickbaitCut, 'Found "clickbait cut" PRD text on Home Dashboard');
      assert(homeInfo.tweetLinks >= 3, `Expected >=3 clickable top beat tweet links on Home, got ${homeInfo.tweetLinks}`);
      assert(homeInfo.articleLinks >= 3, `Expected >=3 clickable top beat article links on Home, got ${homeInfo.articleLinks}`);
      assert(homeInfo.externalLinksCount >= 12, `Expected >=12 external source links on Home, got ${homeInfo.externalLinksCount}`);
      assert(homeInfo.hasOpponentHealthPreview, 'Missing Opposing Team Health preview on Home Upcoming Matchup card');
    });

    await runStep('Customizing Dashboard card order via Up/Down + HTML5 Drag/Drop persists across reload & resets cleanly', async () => {
      const initialOrder = await cdp.eval(() => {
        document.querySelector('[data-action="toggle-customize-layout"]').click();
        return Array.from(document.querySelectorAll('[data-action="move-block-up"]')).map(b =>
          b.getAttribute('data-block-id')
        );
      });
      assert(initialOrder.length >= 6, `Expected >=6 active blocks, got ${initialOrder.length}`);

      // Check boundary buttons disabled properly
      const boundaryState = await cdp.eval(() => {
        const ups = document.querySelectorAll('[data-action="move-block-up"]');
        const downs = document.querySelectorAll('[data-action="move-block-down"]');
        return {
          firstUpDisabled: ups[0]?.disabled,
          lastDownDisabled: downs[downs.length - 1]?.disabled
        };
      });
      assert(boundaryState.firstUpDisabled === true, 'First block Up button must be disabled');
      assert(boundaryState.lastDownDisabled === true, 'Last block Down button must be disabled');

      // Move 2nd block up to 1st position
      const secondBlockId = initialOrder[1];
      await cdp.eval(id => {
        document.querySelector(`[data-action="move-block-up"][data-block-id="${id}"]`).click();
      }, secondBlockId);

      const afterMoveUp = await cdp.eval(() =>
        Array.from(document.querySelectorAll('[data-action="move-block-up"]')).map(b =>
          b.getAttribute('data-block-id')
        )
      );
      assert(afterMoveUp[0] === secondBlockId, 'Moving 2nd block up did not place it at index 0');

      // Also test HTML5 Drag-and-Drop reordering between cards while Customize Layout is active
      const thirdBlockId = afterMoveUp[2];
      await cdp.eval(
        ({ dragId, dropId }) => {
          const srcCard = document.querySelector(`[data-dashboard-block="${dragId}"]`);
          const dstCard = document.querySelector(`[data-dashboard-block="${dropId}"]`);
          if (srcCard && dstCard) {
            srcCard.dispatchEvent(new Event('dragstart', { bubbles: true }));
            dstCard.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
            dstCard.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
            srcCard.dispatchEvent(new Event('dragend', { bubbles: true }));
          }
        },
        { dragId: thirdBlockId, dropId: secondBlockId }
      );

      const afterDragDrop = await cdp.eval(() =>
        Array.from(document.querySelectorAll('[data-action="move-block-up"]')).map(b =>
          b.getAttribute('data-block-id')
        )
      );
      assert(afterDragDrop[0] === thirdBlockId, 'HTML5 drag-and-drop did not move dragged card to target slot');

      // Reload page and confirm custom order persisted in localStorage
      await cdp.send('Page.reload');
      await cdp.waitFor(() => document.querySelector('[data-action="toggle-customize-layout"]'));

      const persistedFirst = await cdp.eval(() => {
        document.querySelector('[data-action="toggle-customize-layout"]').click();
        return document.querySelector('[data-action="move-block-up"]')?.getAttribute('data-block-id');
      });
      assert(persistedFirst === thirdBlockId, 'Custom dashboard order did not persist across reload');

      // Test Reset to Default
      await cdp.eval(() => {
        document.querySelector('[data-action="reset-dashboard-order"]').click();
      });
      const restoredOrder = await cdp.eval(() => {
        const list = Array.from(document.querySelectorAll('[data-action="move-block-up"]')).map(b =>
          b.getAttribute('data-block-id')
        );
        document.querySelector('[data-action="toggle-customize-layout"]').click(); // Exit customize mode
        return list;
      });
      assert(restoredOrder[0] === initialOrder[0], 'Reset Default did not restore original top card');
    });

    console.log('\n=== [3/9] Team News, Source Links, Verified Video Embeds & Deep Dive AI Jump ===');

    await runStep('News & Film view defaults to Wire & Video (left tab), swaps Synthesis Briefs to right, and supports verified YouTube embeds & filters', async () => {
      await cdp.eval(() => document.querySelector('[data-nav-tab="news"]').click());
      await cdp.assertNoOverflow('News & Film Default Wire & Video View');

      // 1. Verify News & Film defaults to Wire & Video ('raw') on the LEFT and Synthesis Briefs ('clustered') on the RIGHT
      const defaultTabOrder = await cdp.eval(() => {
        const rawBtn = document.querySelector('[data-action="set-news-mode"][data-mode="raw"]');
        const clusBtn = document.querySelector('[data-action="set-news-mode"][data-mode="clustered"]');
        const rRect = rawBtn?.getBoundingClientRect();
        const cRect = clusBtn?.getBoundingClientRect();
        return {
          rawActiveByDefault: Boolean(rawBtn?.classList.contains('active')),
          rawLeftOfClustered: Boolean(rRect && cRect && rRect.left < cRect.left)
        };
      });
      assert(defaultTabOrder.rawActiveByDefault, 'News & Film must default to Wire & Video (raw) mode');
      assert(defaultTabOrder.rawLeftOfClustered, 'Wire & Video tab must sit to the LEFT of Synthesis Briefs');

      // 2. Audit default Raw Beat Stream mode (including Tweets, Articles, Videos filters & non-embeddable fallback card)
      const rawStreamAudit = await cdp.eval(() => {
        const totalCards = document.querySelectorAll('.brief-card').length;

        document.querySelector('[data-action="set-news-category"][data-category="tweets"]')?.click();
        const tweetCards = document.querySelectorAll('.brief-card').length;

        document.querySelector('[data-action="set-news-category"][data-category="articles"]')?.click();
        const articleCards = document.querySelectorAll('.brief-card').length;

        document.querySelector('[data-action="set-news-category"][data-category="videos"]')?.click();
        const videoCards = document.querySelectorAll('.brief-card').length;
        const externalFallbackCards = document.querySelectorAll('a.video-external-card[href*="youtube.com/watch"]').length;

        document.querySelector('[data-action="set-news-category"][data-category="all"]')?.click();
        return { totalCards, tweetCards, articleCards, videoCards, externalFallbackCards };
      });
      assert(rawStreamAudit.totalCards >= 12, `Expected >=12 raw stream items, got ${rawStreamAudit.totalCards}`);
      assert(rawStreamAudit.tweetCards >= 5, `Expected >=5 tweets in Raw Tweets filter, got ${rawStreamAudit.tweetCards}`);
      assert(rawStreamAudit.articleCards >= 4, `Expected >=4 articles in Raw Articles filter, got ${rawStreamAudit.articleCards}`);
      assert(rawStreamAudit.videoCards >= 3, `Expected >=3 videos in Raw Videos filter, got ${rawStreamAudit.videoCards}`);
      assert(rawStreamAudit.externalFallbackCards >= 1, 'Expected DRM-blocked channel videos to render external YouTube thumbnail card instead of broken iframe');
      await cdp.assertNoOverflow('News Raw Beat Stream');

      // 3. Switch to Synthesis Briefs ('clustered') and verify source links, inline YouTube embeds, category filters & Deep Dive AI jump
      const newsSnapshot = await cdp.eval(() => {
        document.querySelector('[data-action="set-news-mode"][data-mode="clustered"]').click();
        const mainText = document.getElementById('mainView').textContent;
        const headlines = Array.from(document.querySelectorAll('.brief-headline')).map(h => h.textContent.trim());
        const hasClickbaitCut = /clickbait\s*cut/i.test(mainText);
        const hasNoFluffEngine = /no-fluff\s*synthesis\s*engine/i.test(mainText);
        const playClipBtns = document.querySelectorAll('[data-action="play-inline-video"]').length;
        const sourceCardLinks = document.querySelectorAll('.source-card-link[href^="https://"]').length;
        return { count: headlines.length, hasClickbaitCut, hasNoFluffEngine, playClipBtns, sourceCardLinks };
      });
      assert(newsSnapshot.count >= 3, `Expected >=3 clustered briefs, got ${newsSnapshot.count}`);
      assert(!newsSnapshot.hasClickbaitCut, 'Found PRD "clickbait cut" text in News view');
      assert(!newsSnapshot.hasNoFluffEngine, 'Found PRD "No-Fluff Synthesis Engine" text in News view');
      assert(newsSnapshot.playClipBtns >= 1, 'Expected at least 1 verified inline video clip facade');
      assert(newsSnapshot.sourceCardLinks >= 4, `Expected >=4 clickable source links on briefs, got ${newsSnapshot.sourceCardLinks}`);

      const iframeCheck = await cdp.eval(() => {
        const btn = document.querySelector('[data-action="play-inline-video"]');
        btn.click();
        const iframe = document.querySelector('.video-iframe-wrap iframe');
        return {
          src: iframe?.getAttribute('src') || '',
          refPolicy: iframe?.getAttribute('referrerpolicy') || ''
        };
      });
      assert(
        iframeCheck.src.includes('https://www.youtube.com/embed/') && iframeCheck.src.includes('playsinline=1'),
        `Invalid YouTube iframe src: ${iframeCheck.src}`
      );
      assert(iframeCheck.refPolicy === 'strict-origin-when-cross-origin', 'Missing strict-origin-when-cross-origin referrerpolicy on YouTube iframe');
      await cdp.assertNoOverflow('News View with Expanded Video Embed');

      for (const cat of ['film', 'cap', 'scheme', 'roster', 'all']) {
        await cdp.eval(c => {
          document.querySelector(`[data-action="set-news-category"][data-category="${c}"]`)?.click();
        }, cat);
      }

      // Test Deep Dive AI jump button and leave News default mode back on 'raw'
      const jumpedPrompt = await cdp.eval(() => {
        const jumpBtn = document.querySelector('[data-action="analyze-topic-jump"]');
        jumpBtn.click();
        const res = {
          activeTab: document.querySelector('.nav-tab-btn.active')?.getAttribute('data-nav-tab'),
          promptValue: document.getElementById('analysisPromptInput')?.value || ''
        };
        window.__49ersDiagnostics.getState().newsMode = 'raw';
        return res;
      });
      assert(jumpedPrompt.activeTab === 'audio', 'Deep Dive AI jump should navigate to audio/AI tab');
      assert(jumpedPrompt.promptValue.length > 10, 'Deep Dive AI jump should pre-fill analysis prompt');
    });

    console.log('\n=== [4/9] Roster Explorer (Simplified Dropdown + Up/Down Arrow Toggle), Dual Depth Chart & GM Cap Sim ===');

    await runStep('Roster Explorer defaults to Roster Number sort, supports First Name & Last Name sort with Up/Down Arrow toggle across all 8 fields, keeps 2 filter rows, and preserves search focus', async () => {
      await cdp.eval(() => document.querySelector('[data-nav-tab="roster"]').click());
      await cdp.assertNoOverflow('Roster Explorer Default');

      const defaultSortAudit = await cdp.eval(() => {
        const sel = document.getElementById('rosterSortSelect');
        const optionKeys = Array.from(sel.options).map(o => o.value);
        const dirBtn = document.getElementById('rosterSortDirBtn');
        const sortDirAttr = dirBtn?.getAttribute('data-sort-dir') || '';
        const dirAria = dirBtn?.getAttribute('aria-label') || '';
        const sortBubblesCount = document.querySelectorAll('[data-action="set-roster-sort"]').length;
        const unitFilterRowExists = Boolean(document.querySelector('[aria-label="Unit Filter"]'));
        const posFilterRowExists = Boolean(document.querySelector('[aria-label="Position Group Filter"]'));
        const jerseys = Array.from(document.querySelectorAll('.player-row .jersey-chip')).map(el =>
          el.textContent.trim()
        );
        const names = Array.from(document.querySelectorAll('.player-name-line')).map(el =>
          el.childNodes[0]?.textContent?.trim() || el.textContent.trim()
        );
        return {
          totalCount: document.querySelectorAll('.player-row').length,
          selectedValue: sel.value,
          optionKeys,
          sortDirAttr,
          dirAria,
          sortBubblesCount,
          unitFilterRowExists,
          posFilterRowExists,
          firstThreeJerseys: jerseys.slice(0, 3),
          firstTwoNames: names.slice(0, 2),
          lastJersey: jerseys[jerseys.length - 1]
        };
      });
      assert(defaultSortAudit.sortBubblesCount === 0, `Expected 0 sort bubbles (dropdown-only sort UX), got ${defaultSortAudit.sortBubblesCount}`);
      assert(defaultSortAudit.unitFilterRowExists && defaultSortAudit.posFilterRowExists, 'Expected both Unit and Position filter rows kept intact');
      assert(defaultSortAudit.totalCount >= 80, `Expected >=80 players on full roster, got ${defaultSortAudit.totalCount}`);
      assert(defaultSortAudit.selectedValue === 'jersey', `Expected default roster sort 'jersey', got '${defaultSortAudit.selectedValue}'`);
      assert(
        defaultSortAudit.optionKeys[0] === 'jersey' &&
          defaultSortAudit.optionKeys[1] === 'firstName' &&
          defaultSortAudit.optionKeys[2] === 'lastName',
        `Expected Roster Number, First Name, Last Name at top of sort options, got ${JSON.stringify(defaultSortAudit.optionKeys.slice(0, 3))}`
      );
      assert(defaultSortAudit.sortDirAttr === 'asc' && defaultSortAudit.dirAria.includes('Ascending'), `Expected default ascending arrow button, got ${defaultSortAudit.sortDirAttr} / ${defaultSortAudit.dirAria}`);
      assert(
        defaultSortAudit.firstThreeJerseys[0] === '#0' && defaultSortAudit.firstThreeJerseys[1] === '#1',
        `Players not sorted by Roster Number ascending by default: ${JSON.stringify(defaultSortAudit.firstThreeJerseys)}`
      );

      // Flip Roster Number sort to descending via #rosterSortDirBtn arrow button (#99 at top)
      const reversedJerseyAudit = await cdp.eval(() => {
        document.getElementById('rosterSortDirBtn').click();
        const dirBtn = document.getElementById('rosterSortDirBtn');
        const sortDirAttr = dirBtn?.getAttribute('data-sort-dir') || '';
        const firstJersey = document.querySelector('.player-row .jersey-chip')?.textContent?.trim() || '';
        return { sortDirAttr, firstJersey };
      });
      assert(reversedJerseyAudit.sortDirAttr === 'desc', `Expected desc arrow state after clicking arrow button, got ${reversedJerseyAudit.sortDirAttr}`);
      assert(reversedJerseyAudit.firstJersey === '#99', `Expected #99 at top on descending Roster Number sort, got ${reversedJerseyAudit.firstJersey}`);

      // Verify First Name sort (asc & desc) and Last Name sort (asc & desc) explicitly
      const nameSortAudit = await cdp.eval(() => {
        let sel = document.getElementById('rosterSortSelect');

        sel.value = 'firstName';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        const firstAscNames = Array.from(document.querySelectorAll('.player-name-line')).map(
          el => el.childNodes[0]?.textContent?.trim() || el.textContent.trim()
        );
        document.getElementById('rosterSortDirBtn').click();
        const firstDescTop = document.querySelector('.player-name-line')?.childNodes[0]?.textContent?.trim() || '';

        sel = document.getElementById('rosterSortSelect');
        sel.value = 'lastName';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        const lastAscNames = Array.from(document.querySelectorAll('.player-name-line')).map(
          el => el.childNodes[0]?.textContent?.trim() || el.textContent.trim()
        );
        document.getElementById('rosterSortDirBtn').click();
        const lastDescTop = document.querySelector('.player-name-line')?.childNodes[0]?.textContent?.trim() || '';

        return {
          firstAscTop2: firstAscNames.slice(0, 2),
          firstAscLast: firstAscNames[firstAscNames.length - 1],
          firstDescTop,
          lastAscTop3: lastAscNames.slice(0, 3),
          lastAscLast: lastAscNames[lastAscNames.length - 1],
          lastDescTop
        };
      });
      assert(
        nameSortAudit.firstAscTop2[0] === 'Alfred Collins' && nameSortAudit.firstDescTop === nameSortAudit.firstAscLast,
        `First Name sort mismatch: ${JSON.stringify(nameSortAudit)}`
      );
      assert(
        nameSortAudit.lastAscTop3[0] === 'Brandon Aiyuk' &&
          nameSortAudit.lastAscTop3[1] === 'Isaac Alarcon' &&
          nameSortAudit.lastAscTop3[2] === 'Robert Beal Jr.' &&
          nameSortAudit.lastDescTop === nameSortAudit.lastAscLast,
        `Last Name sort (with Jr. suffix handling) mismatch: ${JSON.stringify(nameSortAudit)}`
      );

      // Exercise Dropdown selection + Up/Down Arrow toggle for EVERY sort field (jersey, firstName, lastName, cap, snaps, health, ras, age)
      for (const fieldKey of ['jersey', 'firstName', 'lastName', 'cap', 'snaps', 'health', 'ras', 'age']) {
        const pairCheck = await cdp.eval(fk => {
          const sel = document.getElementById('rosterSortSelect');
          sel.value = fk;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          const firstPassTop = document.querySelector('.player-name-line')?.textContent?.trim() || '';
          const firstDirAttr = document.getElementById('rosterSortDirBtn')?.getAttribute('data-sort-dir') || '';
          // Click arrow button next to dropdown to toggle up <-> down
          document.getElementById('rosterSortDirBtn').click();
          const secondPassTop = document.querySelector('.player-name-line')?.textContent?.trim() || '';
          const secondDirAttr = document.getElementById('rosterSortDirBtn')?.getAttribute('data-sort-dir') || '';
          return { firstPassTop, secondPassTop, firstDirAttr, secondDirAttr };
        }, fieldKey);
        assert(
          pairCheck.firstDirAttr !== pairCheck.secondDirAttr && pairCheck.firstPassTop !== pairCheck.secondPassTop,
          `Dropdown + arrow up/down toggle failed for "${fieldKey}": ${JSON.stringify(pairCheck)}`
        );
      }

      // Reset back to default Roster Number (#0 .. #99)
      await cdp.eval(() => {
        const sel = document.getElementById('rosterSortSelect');
        sel.value = 'jersey';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Test search + focus preservation
      const focusTest = await cdp.eval(() => {
        const input = document.getElementById('rosterSearchInput');
        input.focus();
        input.value = 'Purdy';
        input.setSelectionRange(5, 5);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return {
          activeId: document.activeElement?.id,
          rows: document.querySelectorAll('.player-row').length,
          firstText: document.querySelector('.player-row')?.textContent || ''
        };
      });
      assert(focusTest.activeId === 'rosterSearchInput', 'Search input lost focus during re-render!');
      assert(focusTest.rows === 1 && focusTest.firstText.includes('Brock Purdy'), 'Search for Purdy failed');

      // Search by #13 jersey number
      const jerseySearchRows = await cdp.eval(() => {
        const input = document.getElementById('rosterSearchInput');
        input.value = '#13';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return document.querySelectorAll('.player-row').length;
      });
      assert(jerseySearchRows >= 1, 'Jersey #13 search returned 0 results');

      // Zero-match edge case
      const emptyMsg = await cdp.eval(() => {
        const input = document.getElementById('rosterSearchInput');
        input.value = 'ZZZZ_NO_SUCH_PLAYER_999';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return document.querySelector('.player-list')?.textContent?.trim() || '';
      });
      assert(emptyMsg.includes('No players match'), 'Expected clean empty state message for zero-match query');

      // Reset search and exercise all unit filters & position filters
      await cdp.eval(() => {
        const input = document.getElementById('rosterSearchInput');
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });

      for (const unit of ['Active 53', 'Offense', 'Defense', 'Special Teams', 'IR / Reserve', 'Practice Squad', 'All']) {
        const c = await cdp.eval(u => {
          document.querySelector(`[data-action="set-roster-unit"][data-unit="${u}"]`).click();
          return document.querySelectorAll('.player-row').length;
        }, unit);
        assert(c >= 1, `Unit filter "${unit}" unexpectedly returned 0 players`);
      }

      for (const pos of ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'DB', 'ALL']) {
        const c = await cdp.eval(p => {
          document.querySelector(`[data-action="set-roster-pos"][data-pos="${p}"]`).click();
          return document.querySelectorAll('.player-row').length;
        }, pos);
        assert(c >= 1, `Position filter "${pos}" returned 0 players`);
      }
      await cdp.assertNoOverflow('Roster Explorer After Filter & Sort Matrix');
    });

    await runStep('Dual Depth Chart toggles Projected Week 9 Active vs Baseline and launches Player Dossier', async () => {
      const depthCheck = await cdp.eval(() => {
        document.querySelector('[data-action="set-roster-sub"][data-roster-sub="depth"]').click();
        const projectedText = document.getElementById('mainView').textContent;
        const chipsCount = document.querySelectorAll('.depth-player-chip').length;
        document.querySelector('[data-action="set-depth-mode"][data-depth-mode="baseline"]').click();
        const baselineChipsCount = document.querySelectorAll('.depth-player-chip').length;
        document.querySelector('[data-action="set-depth-mode"][data-depth-mode="projected"]').click();
        const unitTitles = Array.from(document.querySelectorAll('#mainView section.card h3.card-title')).map(el => el.textContent.trim());
        return {
          chipsCount,
          baselineChipsCount,
          hasUnits: projectedText.includes('Offense') && projectedText.includes('Defense'),
          unitTitles
        };
      });
      assert(depthCheck.hasUnits && depthCheck.chipsCount >= 30, 'Depth chart missing units or player chips');
      assert(depthCheck.unitTitles[0]?.includes('Offense'), `Expected first unit to be Offense, got ${depthCheck.unitTitles[0]}`);
      assert(depthCheck.unitTitles[1]?.includes('Defense'), `Expected second unit to be Defense, got ${depthCheck.unitTitles[1]}`);
      assert(depthCheck.unitTitles[2]?.includes('Special Teams'), `Expected third unit to be Special Teams, got ${depthCheck.unitTitles[2]}`);
      await cdp.assertNoOverflow('Dual Depth Chart View');
    });

    await runStep('Armchair GM Cap Simulator computes Blueprint restructures, CBA >2 Post-June 1 warning, Over-Cap warning & Reset', async () => {
      await cdp.eval(() => document.querySelector('[data-action="set-roster-sub"][data-roster-sub="cap"]').click());
      await cdp.assertNoOverflow('Salary Cap & Armchair GM View');

      // Apply AI Blueprint
      const afterBlueprint = await cdp.eval(() => {
        const beforeText = document.querySelector('.gm-summary-banner')?.textContent || '';
        document.querySelector('[data-action="apply-ai-cap-blueprint"]').click();
        const afterText = document.querySelector('.gm-summary-banner')?.textContent || '';
        return { beforeText, afterText };
      });
      assert(
        afterBlueprint.afterText.includes('2 move(s) active') && afterBlueprint.afterText.includes('+'),
        `Blueprint did not apply expected positive cap delta: ${afterBlueprint.afterText}`
      );

      // Select 3 Post-June 1 cuts (re-querying live DOM after each render) to verify NFL CBA 2-player designation warning
      const cbaWarningShown = await cdp.eval(() => {
        document.querySelector('[data-action="reset-cap-moves"]').click();
        for (let i = 0; i < 3; i++) {
          const liveSelects = document.querySelectorAll('.gm-move-select');
          const sel = liveSelects[i];
          sel.value = 'june_1_cut';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return document.getElementById('mainView').textContent.includes('maximum of 2 players as Post-June 1 releases');
      });
      assert(cbaWarningShown, 'Expected NFL CBA 2-player Post-June 1 warning banner');

      // Select Pre-June 1 cuts on top 6 contracts to force negative cap space & verify Over-Cap warning (and no $$ formatting bug)
      const overCapCheck = await cdp.eval(() => {
        document.querySelector('[data-action="reset-cap-moves"]').click();
        for (let i = 0; i < 6; i++) {
          const liveSelects = document.querySelectorAll('.gm-move-select');
          const sel = liveSelects[i];
          sel.value = 'cut';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const txt = document.getElementById('mainView').textContent;
        return {
          hasWarning: txt.includes('Cap Compliance Warning'),
          hasDoubleDollar: txt.includes('$$')
        };
      });
      assert(overCapCheck.hasWarning, 'Expected Cap Compliance Warning when dead money pushes SF over ceiling');
      assert(!overCapCheck.hasDoubleDollar, 'Found double-dollar ($$) formatting bug in Cap Compliance Warning');

      // Reset Cap Moves
      const afterReset = await cdp.eval(() => {
        document.querySelector('[data-action="reset-cap-moves"]').click();
        return document.querySelector('.gm-summary-banner')?.textContent || '';
      });
      assert(afterReset.includes('0 move(s) active'), 'Reset Cap Moves did not clear active moves');
    });

    console.log('\n=== [5/9] 5-Tab Player Dossier Sheet (QB, OL Non-Box-Score, PS Non-Top-51 & SVG Spider Chart) ===');

    await runStep('5-Tab Player Dossier renders Overview, 2026/Career EPA+NGS, SVG Spider Chart, 6 Contract Scenarios & Health Priors', async () => {
      await cdp.eval(() => document.querySelector('[data-action="set-roster-sub"][data-roster-sub="roster"]').click());

      // Open Brock Purdy Dossier
      const openedTitle = await cdp.eval(() => {
        const purdyBtn = Array.from(document.querySelectorAll('.player-row')).find(el =>
          el.textContent.includes('Brock Purdy')
        );
        purdyBtn.click();
        return document.getElementById('sheetTitle')?.textContent?.trim();
      });
      assert(openedTitle === 'Brock Purdy', `Expected Brock Purdy sheet, got ${openedTitle}`);
      await cdp.assertNoOverflow('Player Dossier: Overview Tab');

      // Stats & EPA (2026 + Career toggle)
      const statsInfo = await cdp.eval(() => {
        document.querySelector('[data-action="set-player-tab"][data-player-tab="stats"]').click();
        const text2026 = document.getElementById('sheetBody').textContent;
        document.querySelector('[data-action="set-player-stats-mode"][data-stats-mode="career"]').click();
        const careerRows = document.querySelectorAll('#sheetBody table tbody tr').length;
        document.querySelector('[data-action="set-player-stats-mode"][data-stats-mode="2026"]').click();
        return {
          hasEpa: text2026.includes('Passing EPA') && text2026.includes('CPOE'),
          careerRows
        };
      });
      assert(statsInfo.hasEpa && statsInfo.careerRows >= 3, 'Purdy Stats tab missing EPA/CPOE or career seasons');
      await cdp.assertNoOverflow('Player Dossier: Stats Tab');

      // Spider Chart SVG + 10 Axes + 3 Comps
      const spiderInfo = await cdp.eval(() => {
        document.querySelector('[data-action="set-player-tab"][data-player-tab="spider"]').click();
        const svg = document.querySelector('#sheetBody svg.spider-svg');
        const polygonPts = svg?.querySelectorAll('polygon')?.length || 0;
        const axisBars = document.querySelectorAll('#sheetBody .spider-drill-row').length;
        const bodyText = document.getElementById('sheetBody').textContent;
        return { hasSvg: Boolean(svg), polygonPts, axisBars, hasNoNaN: !bodyText.includes('NaN') };
      });
      assert(
        spiderInfo.hasSvg && spiderInfo.polygonPts >= 5 && spiderInfo.axisBars === 10 && spiderInfo.hasNoNaN,
        `Spider chart malformed: ${JSON.stringify(spiderInfo)}`
      );
      await cdp.assertNoOverflow('Player Dossier: Spider Chart Tab');

      // Contract & Cap tab across all 6 transaction scenarios
      for (const tx of ['cut', 'june_1_cut', 'trade', 'june_1_trade', 'restructure', 'extension']) {
        const ok = await cdp.eval(t => {
          const btn = document.querySelector(`[data-action="set-player-tx-scenario"][data-tx="${t}"]`);
          if (t === 'cut') {
            document.querySelector('[data-action="set-player-tab"][data-player-tab="contract"]').click();
          }
          document.querySelector(`[data-action="set-player-tx-scenario"][data-tx="${t}"]`)?.click();
          const txt = document.getElementById('sheetBody').textContent;
          return !txt.includes('NaN') && !txt.includes('undefined');
        }, tx);
        assert(ok, `Contract tab transaction scenario "${tx}" leaked NaN/undefined`);
      }
      await cdp.assertNoOverflow('Player Dossier: Contract Tab');

      // Health & Priors tab
      const healthTxt = await cdp.eval(() => {
        document.querySelector('[data-action="set-player-tab"][data-player-tab="health"]').click();
        return document.getElementById('sheetBody').textContent;
      });
      assert(!healthTxt.includes('NaN') && healthTxt.length > 40, 'Health tab failed to render cleanly');
      await cdp.assertNoOverflow('Player Dossier: Health Tab');

      // Close via Escape key
      const closedViaEsc = await cdp.eval(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return document.getElementById('bottomSheetBackdrop').hidden;
      });
      assert(closedViaEsc === true, 'Escape key did not close Bottom Sheet');

      // Corner Case: Open an Offensive Lineman (Trent Williams) & Practice Squad player to ensure zero NaN on non-box-score/non-OTC players
      const cornerPlayersOk = await cdp.eval(() => {
        const trentBtn = Array.from(document.querySelectorAll('.player-row')).find(el =>
          el.textContent.includes('Trent Williams')
        );
        trentBtn.click();
        document.querySelector('[data-action="set-player-tab"][data-player-tab="stats"]').click();
        const olStatsText = document.getElementById('sheetBody').textContent;
        document.getElementById('closeSheetBtn').click();

        // Switch to Practice Squad filter and open first PS player on Contract tab
        document.querySelector('[data-action="set-roster-unit"][data-unit="Practice Squad"]').click();
        document.querySelector('.player-row').click();
        document.querySelector('[data-action="set-player-tab"][data-player-tab="contract"]').click();
        const psContractText = document.getElementById('sheetBody').textContent;
        document.querySelector('[data-action="set-roster-unit"][data-unit="All"]').click();

        // Close via backdrop click
        const backdrop = document.getElementById('bottomSheetBackdrop');
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        return {
          olOk: olStatsText.includes('Snaps Logged') && !olStatsText.includes('NaN'),
          psOk: !psContractText.includes('NaN') && psContractText.length > 20,
          backdropClosed: backdrop.hidden
        };
      });
      assert(cornerPlayersOk.olOk, 'OL non-box-score stats tab failed');
      assert(cornerPlayersOk.psOk, 'Practice Squad contract tab failed');
      assert(cornerPlayersOk.backdropClosed, 'Clicking backdrop did not close Bottom Sheet');
    });

    await runStep('Player Dossier 7-Day Mentions (Mike Evans & Nick Bosa) render salient tweets + articles, 100% authors, and full short tweets', async () => {
      const mentionsAudit = await cdp.eval(() => {
        document.querySelector('[data-nav-tab="roster"]').click();
        document.querySelector('[data-action="set-roster-sub"][data-roster-sub="roster"]').click();
        document.querySelector('[data-action="set-roster-unit"][data-unit="All"]').click();
        document.querySelector('[data-action="set-roster-pos"][data-pos="ALL"]').click();

        const inspectPlayer = playerName => {
          const inp = document.getElementById('rosterSearchInput');
          inp.value = playerName;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          const row = Array.from(document.querySelectorAll('.player-row')).find(el =>
            el.textContent.includes(playerName)
          );
          if (!row) return { found: false };
          row.click();
          document.querySelector('[data-action="set-player-tab"][data-player-tab="overview"]').click();

          const cards = Array.from(document.querySelectorAll('#sheetBody .player-mention-card'));
          const tweetCards = cards.filter(c => c.getAttribute('data-mention-type') === 'tweet');
          const articleCards = cards.filter(c => c.getAttribute('data-mention-type') === 'article');
          const allHaveAuthor = cards.every(c => {
            const authTxt = c.querySelector('.player-mention-author')?.textContent?.trim() || '';
            return authTxt.length >= 4 && !/undefined|null/i.test(authTxt);
          });
          const shortTweetBodies = tweetCards.map(
            c => c.querySelector('.player-mention-tweet-body')?.textContent?.trim() || ''
          );

          const allText = cards.map(c => c.textContent || '').join(' ');
          document.getElementById('closeSheetBtn').click();
          inp.value = '';
          inp.dispatchEvent(new Event('input', { bubbles: true }));

          return {
            found: true,
            totalCards: cards.length,
            tweetCount: tweetCards.length,
            articleCount: articleCards.length,
            allHaveAuthor,
            shortTweetBodies,
            hasStaleWk9WontPlay: /\b(won['’]?t play|inactives\b|before raiders game)\b/i.test(allText)
          };
        };

        return {
          mikeEvans: inspectPlayer('Mike Evans'),
          brockPurdy: inspectPlayer('Brock Purdy'),
          nickBosa: inspectPlayer('Nick Bosa')
        };
      });

      assert(mentionsAudit.mikeEvans.found, 'Mike Evans not found on Roster');
      assert(mentionsAudit.mikeEvans.allHaveAuthor, 'Mike Evans mentions missing author attribution');
      assert(
        !mentionsAudit.mikeEvans.hasStaleWk9WontPlay,
        `Mike Evans dossier still rendered stale completed-game availability blurb: ${JSON.stringify(mentionsAudit.mikeEvans)}`
      );

      assert(
        mentionsAudit.brockPurdy.found &&
          mentionsAudit.brockPurdy.totalCards >= 5 &&
          mentionsAudit.brockPurdy.tweetCount >= 1 &&
          mentionsAudit.brockPurdy.articleCount >= 1 &&
          mentionsAudit.brockPurdy.allHaveAuthor,
        `Brock Purdy 7d mentions incomplete: ${JSON.stringify(mentionsAudit.brockPurdy)}`
      );
      assert(
        [...mentionsAudit.brockPurdy.shortTweetBodies, ...mentionsAudit.nickBosa.shortTweetBodies].some(
          t => t.length >= 60 && !t.endsWith('…')
        ),
        `Expected full untruncated short tweet on player dossiers, got: ${JSON.stringify(mentionsAudit.brockPurdy.shortTweetBodies)}`
      );

      assert(
        mentionsAudit.nickBosa.found &&
          mentionsAudit.nickBosa.totalCards >= 5 &&
          mentionsAudit.nickBosa.tweetCount >= 1 &&
          mentionsAudit.nickBosa.articleCount >= 1 &&
          mentionsAudit.nickBosa.allHaveAuthor,
        `Nick Bosa 7d mentions incomplete: ${JSON.stringify(mentionsAudit.nickBosa)}`
      );
      await cdp.assertNoOverflow('Player Mentions Verification');
    });

    console.log('\n=== [6/9] Game & Season Views (Opponent Health & Play Odds + All 8 Sub-Modules + Monte Carlo) ===');

    await runStep('Upcoming Matchup renders Opposing Team Health & Play Likelihood, and all 8 Game & Season views have zero War Room text', async () => {
      await cdp.eval(() => document.querySelector('[data-nav-tab="season"]').click());

      // Verify Opposing Team Health & Play Likelihood section in Upcoming Matchup
      const oppHealthAudit = await cdp.eval(() => {
        document.querySelector('[data-action="set-season-sub"][data-season-sub="matchup"]').click();
        const sec = document.getElementById('opponentHealthSection');
        const txt = sec?.textContent || '';
        const oppName = window.__49ersDiagnostics.getState().appData.scheduleMatchup.upcomingMatchup.oppName;
        const pctBadges = sec ? Array.from(sec.querySelectorAll('.badge')).filter(b => b.textContent.includes('%')).length : 0;
        const injuryLink = Boolean(sec?.querySelector('a[href^="https://"]'));
        return {
          exists: Boolean(sec),
          oppName,
          hasOppName: txt.includes(oppName),
          pctBadges,
          injuryLink
        };
      });
      assert(oppHealthAudit.exists, 'Missing #opponentHealthSection in Upcoming Matchup view');
      assert(oppHealthAudit.hasOppName, `Opponent Health section missing ${oppHealthAudit.oppName}`);
      assert(oppHealthAudit.pctBadges >= 2, `Expected >=2 opponent play likelihood % badges, got ${oppHealthAudit.pctBadges}`);
      assert(oppHealthAudit.injuryLink, 'Missing external ESPN Injuries source link in Opponent Health section');

      for (const sub of ['matchup', 'health', 'schedule', 'trade', 'playoffs', 'draft_prep', 'draft_class', 'stats']) {
        await cdp.eval(s => {
          document.querySelector(`[data-action="set-season-sub"][data-season-sub="${s}"]`).click();
        }, sub);
        await cdp.assertNoOverflow(`Game & Season Sub-Tab: ${sub}`);
        const text = await cdp.eval(() => document.getElementById('mainView').textContent);
        assert(!text.includes('NaN') && !text.includes('undefined'), `Sub-tab ${sub} rendered NaN/undefined`);
        assert(!/war\s*room/i.test(text), `Sub-tab ${sub} still contains "War Room" text`);
      }

      // Deep Health & IR Return Window Tracker DOM regression audit (Alfred Collins Season-Ending IR, Nate Hobbs 21d Window, zero synthetic notes)
      const irDomAudit = await cdp.eval(() => {
        document.querySelector('[data-action="set-season-sub"][data-season-sub="health"]').click();
        const mainEl = document.getElementById('mainView');
        const mainText = mainEl?.textContent || '';
        const irItems = Array.from(mainEl.querySelectorAll('.subcard-panel[data-action="open-player-sheet"]'));
        const collinsCard = irItems.find(el => el.textContent.includes('Alfred Collins'));
        const collinsBadge = collinsCard?.querySelector('.badge');
        const hobbsCard = irItems.find(el => el.textContent.includes('Nate Hobbs'));
        const hobbsBadge = hobbsCard?.querySelector('.badge');

        // Also open Alfred Collins Player Dossier -> Health tab to verify Reserve List / Ineligible / Out for Season boxes
        const collinsTrigger = collinsCard?.hasAttribute?.('data-player-id')
          ? collinsCard
          : collinsCard?.querySelector('[data-action="open-player-sheet"]');
        if (collinsTrigger?.getAttribute?.('data-player-id')) {
          collinsTrigger.click();
        } else {
          const appState = window.__49ersDiagnostics.getState();
          const ac = appState.appData.roster.players.find(p => p.name === 'Alfred Collins');
          appState.sheetMode = 'player';
          appState.sheetPlayerId = ac.id;
          window.__49ersDiagnostics.forceRender();
        }
        document.querySelector('[data-action="set-player-tab"][data-player-tab="health"]')?.click();
        const sheetHealthText = document.getElementById('sheetBody')?.textContent || '';
        document.getElementById('closeSheetBtn')?.click();

        return {
          hasSyntheticRehabNote: /Rehabbing on side field/i.test(mainText),
          collinsCardText: collinsCard?.textContent || '',
          collinsBadgeText: collinsBadge?.textContent?.trim() || '',
          collinsBadgeIsDanger: Boolean(collinsBadge?.classList?.contains('badge-danger')),
          hobbsCardText: hobbsCard?.textContent || '',
          hobbsBadgeText: hobbsBadge?.textContent?.trim() || '',
          hobbsBadgeIsPositive: Boolean(hobbsBadge?.classList?.contains('badge-positive')),
          sheetHealthText
        };
      });
      assert(!irDomAudit.hasSyntheticRehabNote, 'Team Health DOM still contains synthetic "Rehabbing on side field" placeholder');
      assert(
        irDomAudit.collinsBadgeText === 'Out for 2026 Season' && irDomAudit.collinsBadgeIsDanger,
        `Alfred Collins IR badge should be danger "Out for 2026 Season", got "${irDomAudit.collinsBadgeText}"`
      );
      assert(
        !/Week 10[–-]11/i.test(irDomAudit.collinsCardText),
        `Alfred Collins IR card still shows bogus Week 10–11 return window: ${irDomAudit.collinsCardText}`
      );
      assert(
        /Week 10/i.test(irDomAudit.hobbsBadgeText) &&
          irDomAudit.hobbsBadgeIsPositive &&
          irDomAudit.hobbsCardText.includes('21-Day Window Open'),
        `Nate Hobbs IR card should highlight open 21-day window + Week 10 badge, got "${irDomAudit.hobbsBadgeText}" / "${irDomAudit.hobbsCardText}"`
      );
      assert(
        irDomAudit.sheetHealthText.includes('Season-Ending IR') &&
          irDomAudit.sheetHealthText.includes('Ineligible') &&
          irDomAudit.sheetHealthText.includes('Out for Season') &&
          !irDomAudit.sheetHealthText.includes('NaN') &&
          !irDomAudit.sheetHealthText.includes('undefined'),
        `Alfred Collins Dossier Health tab failed verification: ${irDomAudit.sheetHealthText}`
      );

      // Check International Schedule venues (Melbourne & Mexico City)
      const intlVerified = await cdp.eval(() => {
        document.querySelector('[data-action="set-season-sub"][data-season-sub="schedule"]').click();
        const txt = document.getElementById('mainView').textContent;
        return txt.includes('Melbourne') && txt.includes('Mexico City');
      });
      assert(intlVerified, 'Schedule view missing Melbourne & Mexico City international venue callouts');

      // Test interactive Monte Carlo Playoff Rooting Guide game-winner override & Clear button
      const mcInteractive = await cdp.eval(() => {
        document.querySelector('[data-action="set-season-sub"][data-season-sub="playoffs"]').click();
        const firstPickBtn = document.querySelector('[data-action="toggle-playoff-winner"]');
        firstPickBtn.click();
        const hasClearBtn = Boolean(document.querySelector('[data-action="reset-playoff-overrides"]'));
        document.querySelector('[data-action="reset-playoff-overrides"]')?.click();
        const cleared = !document.querySelector('[data-action="reset-playoff-overrides"]');
        return { hasClearBtn, cleared };
      });
      assert(mcInteractive.hasClearBtn && mcInteractive.cleared, 'Playoff Monte Carlo override toggle/clear failed');

      // Test 2026 Draft Class inline Spider Chart expand/collapse
      const draftSpiderOk = await cdp.eval(() => {
        document.querySelector('[data-action="set-season-sub"][data-season-sub="draft_class"]').click();
        document.querySelector('[data-action="toggle-draft-spider"][data-draft-idx="0"]').click();
        const hasSvg = Boolean(document.querySelector('#mainView svg.spider-svg'));
        document.querySelector('[data-action="toggle-draft-spider"][data-draft-idx="0"]').click();
        const hiddenAfter = !document.querySelector('#mainView svg.spider-svg');
        return { hasSvg, hiddenAfter };
      });
      assert(draftSpiderOk.hasSvg && draftSpiderOk.hiddenAfter, '2026 Draft Pick spider chart toggle failed');

      // Test 2027 Combine search focus preservation
      const combineSearchOk = await cdp.eval(() => {
        document.querySelector('[data-action="set-season-sub"][data-season-sub="draft_prep"]').click();
        const inp = document.getElementById('combineSearchInput');
        inp.focus();
        inp.value = 'EDGE';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        const focused = document.activeElement?.id === 'combineSearchInput';
        const rows = document.querySelectorAll('#mainView table tbody tr').length;
        inp.value = '';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        return { focused, rows };
      });
      assert(combineSearchOk.focused && combineSearchOk.rows >= 1, 'Combine search failed or lost input focus');
    });

    console.log('\n=== [7/9] 49ers Beat Podcasts (7-Day Native Launch), Autopodcast Studio & Grounded Deep AI ===');

    await runStep('49ers Podcasts tab renders all 6 flagship shows (last 7 days), toggles By Date vs By Podcast, filters by show, and builds native iOS/Android deep links', async () => {
      await cdp.eval(() => {
        document.querySelector('[data-nav-tab="audio"]').click();
        document.querySelector('[data-action="set-studio-sub"][data-studio-sub="beat_podcasts"]').click();
      });
      await cdp.assertNoOverflow('Audio & AI: 49ers Podcasts By Date');

      const byDateAudit = await cdp.eval(async () => {
        const epCards = Array.from(document.querySelectorAll('#mainView .beat-podcast-ep-card'));
        const allHaveTitleAndSummary = epCards.every(c => {
          const title = c.querySelector('.beat-podcast-ep-title')?.textContent?.trim() || '';
          const summary = c.querySelector('.beat-podcast-ep-summary')?.textContent?.trim() || '';
          return title.length >= 4 && summary.length >= 15;
        });

        // Test individual show filter pill in By Date mode then reset to All
        const gsFilterBtn = document.querySelector('[data-action="set-beat-pod-show-filter"][data-show-id="the_gold_standard"]');
        gsFilterBtn?.click();
        const filteredShows = Array.from(document.querySelectorAll('#mainView .beat-podcast-ep-card')).map(c =>
          c.getAttribute('data-podcast-show')
        );
        document.querySelector('[data-action="set-beat-pod-show-filter"][data-show-id="all"]')?.click();

        // Switch to By Podcast grouped mode
        document.querySelector('[data-action="set-beat-pod-view"][data-pod-view="show"]').click();
        const groupHeadings = Array.from(document.querySelectorAll('#mainView .beat-podcast-show-group h3.card-title')).map(
          el => el.textContent.trim()
        );

        // Verify native deep link builder inside browser module for iPhone 16 Safari & Android Chrome
        const { buildNativePodcastAppHref } = await import('/src/views/audioAiView.js');
        const sample = window.__49ersDiagnostics.getState().appData.beatPodcasts.episodes[0];
        const iosHref = buildNativePodcastAppHref(
          sample,
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
          5
        );
        const androidHref = buildNativePodcastAppHref(
          sample,
          'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
          5
        );

        // Return to By Date default
        document.querySelector('[data-action="set-beat-pod-view"][data-pod-view="date"]').click();

        return {
          epCount: epCards.length,
          allHaveTitleAndSummary,
          filteredAllGoldStandard: filteredShows.length >= 1 && filteredShows.every(s => s === 'the_gold_standard'),
          groupHeadings,
          iosHref,
          androidHref
        };
      });

      assert(byDateAudit.epCount >= 10, `Expected >=10 7-day 49ers podcast episodes, got ${byDateAudit.epCount}`);
      assert(byDateAudit.allHaveTitleAndSummary, 'Every podcast episode card must display both name and summary');
      assert(byDateAudit.filteredAllGoldStandard, 'Filtering By Date to The Gold Standard failed');
      for (const expectedShow of [
        'The Gold Standard',
        '49ers Talk',
        '49ers +/-',
        'Dieter and Hutch',
        'Locked On 49ers',
        'Lombardi Lounge'
      ]) {
        assert(
          byDateAudit.groupHeadings.includes(expectedShow),
          `By Podcast view missing required show "${expectedShow}". Found: ${JSON.stringify(byDateAudit.groupHeadings)}`
        );
      }
      assert(byDateAudit.iosHref.href.startsWith('podcasts://podcasts.apple.com/'), 'iOS native podcast URI failed');
      assert(byDateAudit.androidHref.href.startsWith('intent://') && byDateAudit.androidHref.href.includes('scheme=pcast'), 'Android native podcast intent URI failed');
      await cdp.assertNoOverflow('Audio & AI: 49ers Podcasts Grouped & Reset');
    });

    await runStep('Zero retired-player hallucinations (Bryce Huff), <1m live wire config (20s in-game / 45s standard), and live in-game injury tweet rises to #1', async () => {
      const liveWireAndGroundingAudit = await cdp.eval(async () => {
        // 1. Check zero "Bryce Huff" across Home, News (Briefs & Raw), Season, and Audio
        const huffHits = [];
        for (const tab of ['home', 'news', 'roster', 'season', 'audio']) {
          document.querySelector(`[data-nav-tab="${tab}"]`).click();
          if (/Bryce Huff/i.test(document.getElementById('mainView').textContent || '')) {
            huffHits.push(tab);
          }
        }
        document.querySelector('[data-nav-tab="news"]').click();
        document.querySelector('[data-action="set-news-mode"][data-mode="raw"]').click();
        if (/Bryce Huff/i.test(document.getElementById('mainView').textContent || '')) {
          huffHits.push('news_raw');
        }

        // 2. Check <1m polling config
        const wireCfg = window.__49ersDiagnostics.getLiveWireConfig();

        // 3. Simulate a late-breaking in-game injury return tweet arriving in real time
        const appState = window.__49ersDiagnostics.getState();
        const bosa = appState.appData.roster.players.find(p => p.name === 'Nick Bosa');
        const breakingTweet = {
          id: 'qa_live_in_game_inj_1',
          type: 'tweet',
          title: 'Injury update from Levi’s Stadium: 49ers DE Nick Bosa (ankle) is questionable to return after exiting to the blue medical tent in Q3.',
          fullText: 'Injury update from Levi’s Stadium: 49ers DE Nick Bosa (ankle) is questionable to return after exiting to the blue medical tent in Q3.',
          isFullTweet: true,
          summary: '',
          mentionedPlayers: [{ id: bosa.id, name: bosa.name, shortName: 'N. Bosa', position: 'DE', jersey: 97, headshotUrl: bosa.headshotUrl }],
          publishedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
          url: 'https://bsky.app/profile/mattmaiocco.bsky.social/post/qaliveinj1',
          outletId: 'nbcsba',
          outletName: 'NBC Sports Bay Area',
          reporterId: 'matt_maiocco',
          reporterName: 'Matt Maiocco',
          author: 'Matt Maiocco',
          authorHandle: '@MaioccoNBCS',
          authorProfileUrl: 'https://bsky.app/profile/mattmaiocco.bsky.social',
          category: 'injury',
          signalScore: 98,
          fluffScore: 0,
          isClickbait: false
        };
        // Insert at the END of rawStream & bosa.recentNews to prove priority sorting elevates it to #1!
        appState.appData.news.rawStream.push(breakingTweet);
        bosa.recentNews.push({
          type: 'tweet',
          headline: breakingTweet.title,
          fullText: breakingTweet.fullText,
          author: 'Matt Maiocco',
          authorHandle: '@MaioccoNBCS',
          outletName: 'NBC Sports Bay Area',
          publishedAt: breakingTweet.publishedAt,
          url: breakingTweet.url
        });
        window.__49ersDiagnostics.forceRender();

        const rawTopCardText = document.querySelector('#mainView .brief-card')?.textContent || '';
        document.querySelector('[data-action="set-news-mode"][data-mode="clustered"]').click();
        const clusteredBannerText = document.querySelector('#mainView .breaking-wire-card')?.textContent || '';

        // Check Bosa's Dossier #1 mention
        appState.sheetMode = 'player';
        appState.sheetPlayerId = bosa.id;
        appState.sheetPlayerTab = 'overview';
        window.__49ersDiagnostics.forceRender();
        const bosaTopMention = document.querySelector('#sheetBody .player-mention-card')?.textContent || '';
        document.getElementById('closeSheetBtn').click();

        // Clean up simulated item
        appState.appData.news.rawStream = appState.appData.news.rawStream.filter(x => x.id !== 'qa_live_in_game_inj_1');
        bosa.recentNews = bosa.recentNews.filter(x => x.url !== breakingTweet.url);
        window.__49ersDiagnostics.forceRender();

        return {
          huffHits,
          wireCfg,
          rawRisesToTop: rawTopCardText.includes('LIVE INJURY UPDATE') && rawTopCardText.includes('questionable to return'),
          clusteredBannerShows: clusteredBannerText.includes('LIVE INJURY UPDATE') && clusteredBannerText.includes('questionable to return'),
          bosaMentionRisesToTop: bosaTopMention.includes('LIVE INJURY UPDATE') && bosaTopMention.includes('Matt Maiocco')
        };
      });

      assert(liveWireAndGroundingAudit.huffHits.length === 0, `Found retired player Bryce Huff in tabs: ${JSON.stringify(liveWireAndGroundingAudit.huffHits)}`);
      assert(
        liveWireAndGroundingAudit.wireCfg.gameLivePollMs <= 25_000 &&
          liveWireAndGroundingAudit.wireCfg.standardPollMs < 60_000,
        `Expected <1m tweet polling latency, got: ${JSON.stringify(liveWireAndGroundingAudit.wireCfg)}`
      );
      assert(liveWireAndGroundingAudit.rawRisesToTop, 'Live in-game injury tweet did not rise to #1 in Raw Wire');
      assert(liveWireAndGroundingAudit.clusteredBannerShows, 'Live in-game injury tweet did not surface in Breaking Wire banner on Synthesis Briefs');
      assert(liveWireAndGroundingAudit.bosaMentionRisesToTop, 'Live in-game injury tweet did not rise to #1 in Nick Bosa Dossier mentions');
    });

    await runStep('Studio .m4a podcast loads into sticky Mini-Player, seeks, cycles 1x..2x speed, persists across tabs & closes', async () => {
      await cdp.eval(() => {
        document.querySelector('[data-nav-tab="audio"]').click();
        document.querySelector('[data-action="set-studio-sub"][data-studio-sub="podcast"]')?.click();
      });
      await cdp.assertNoOverflow('Autopodcast Studio Default');

      await cdp.eval(() => {
        document.querySelector('[data-action="play-episode"]').click();
      });

      await cdp.waitFor(() => !document.getElementById('miniPlayer').hidden);
      await cdp.assertNoOverflow('Autopodcast Active + Sticky Mini-Player');

      // Test default-hidden transcript -> click to expand -> +30s skip, turn tap seek, speed cycling -> click to collapse
      const playerControls = await cdp.eval(async () => {
        const { humanizeNflTextForTts, selectBestBrowserVoices } = await import('/src/engine/podcastSpeechEngine.js');
        const defaultHiddenTurnCount = document.querySelectorAll('[data-action="seek-podcast-turn"]').length;

        // Expand transcript on click
        const toggleBtn = document.querySelector('[data-podcast-ready-card] [data-action="toggle-podcast-transcript"]');
        toggleBtn?.click();

        document.getElementById('mpFwd30Btn').click();
        const speeds = [];
        for (let i = 0; i < 4; i++) {
          document.getElementById('mpSpeedBtn').click();
          speeds.push(document.getElementById('mpSpeedBtn').textContent.trim());
        }
        const turns = document.querySelectorAll('[data-action="seek-podcast-turn"]');
        if (turns[2]) turns[2].click();
        const timeText = document.getElementById('miniPlayerTime').textContent;
        const activeTurnCount = document.querySelectorAll('.transcript-turn.active-turn').length;

        // Collapse transcript back on second click
        document.querySelector('[data-podcast-ready-card] [data-action="toggle-podcast-transcript"]')?.click();
        const collapsedAgainCount = document.querySelectorAll('[data-action="seek-podcast-turn"]').length;

        const sampleSpoken = humanizeNflTextForTts('The 6-1 Niners are SF -9.5 with 9/18ths base proration.');
        const voicePick = selectBestBrowserVoices([
          { name: 'Fred', lang: 'en-US', localService: true },
          { name: 'Evan (Enhanced)', lang: 'en-US', localService: true },
          { name: 'Ava (Premium)', lang: 'en-US', localService: true }
        ]);
        return {
          defaultHiddenTurnCount,
          collapsedAgainCount,
          speeds,
          turnCount: turns.length,
          activeTurnCount,
          timeText,
          sampleSpoken,
          pickedMale: voicePick.maleVoice?.name,
          pickedFemale: voicePick.femaleVoice?.name
        };
      });
      assert(
        playerControls.defaultHiddenTurnCount === 0 && playerControls.collapsedAgainCount === 0,
        `Transcripts must be hidden by default and collapse on click: ${JSON.stringify(playerControls)}`
      );
      assert(
        JSON.stringify(playerControls.speeds) === JSON.stringify(['1.25x', '1.5x', '2x', '1x']),
        `Unexpected speed cycle: ${JSON.stringify(playerControls.speeds)}`
      );
      assert(playerControls.turnCount >= 9, `Expected >=9 conversational podcast turns, got ${playerControls.turnCount}`);
      assert(playerControls.activeTurnCount === 1, 'Seeking to a turn must highlight active-turn in transcript');
      assert(
        playerControls.sampleSpoken.includes('six and one Niners') &&
          playerControls.sampleSpoken.includes('San Francisco minus nine and a half') &&
          playerControls.sampleSpoken.includes('nine eighteenths'),
        `Unexpected browser speech humanization: ${playerControls.sampleSpoken}`
      );
      assert(
        playerControls.pickedMale === 'Evan (Enhanced)' && playerControls.pickedFemale === 'Ava (Premium)',
        `Unexpected browser voice selection: ${JSON.stringify(playerControls)}`
      );

      // Switch to Home tab, confirm mini-player persists, tap title to expand back to Audio tab, then close
      const crossTabPersistence = await cdp.eval(() => {
        document.querySelector('[data-nav-tab="home"]').click();
        const stillVisibleOnHome = !document.getElementById('miniPlayer').hidden;
        document.getElementById('miniPlayerExpandTrigger').click();
        const backOnAudio = document.querySelector('.nav-tab-btn.active')?.getAttribute('data-nav-tab') === 'audio';
        document.getElementById('mpCloseBtn').click();
        const closedCleanly = document.getElementById('miniPlayer').hidden;
        return { stillVisibleOnHome, backOnAudio, closedCleanly };
      });
      assert(
        crossTabPersistence.stillVisibleOnHome && crossTabPersistence.backOnAudio && crossTabPersistence.closedCleanly,
        `Mini-player lifecycle check failed: ${JSON.stringify(crossTabPersistence)}`
      );
    });

    await runStep('3-min "wide recievers" Autopodcast + Deep Analysis run full 3-stage Gemini Pro High + NotebookLM TTS workflow, Archive/Restore/Delete & native Share links', async () => {
      // 1. Empty podcast topic validation & Unconnected Gemini API Key Gate (never a silent 1-second template!)
      const gateAndConnectAudit = await cdp.eval(async portNum => {
        const inp = document.getElementById('podTopicInput');
        inp.value = '   ';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-action="generate-autopodcast"]').click();
        const emptyErrText = document.getElementById('mainView').textContent || '';

        // Verify new-user guide link sits OVER the 1-time API key setup card, expands 4-step instructions + direct AI Studio deep links, and has 0 overflow
        const guideBanner = document.querySelector('[data-gemini-guide-banner]');
        const unconnectedCard = document.querySelector('[data-gemini-setup-card="unconnected"]');
        const guideRect = guideBanner?.getBoundingClientRect();
        const cardRect = unconnectedCard?.getBoundingClientRect();
        const guidePositionedAboveCard = Boolean(
          guideRect && cardRect && guideRect.height > 0 && guideRect.bottom <= cardRect.top + 4
        );

        document.querySelector('[data-action="toggle-gemini-key-guide"]')?.click();
        await new Promise(r => setTimeout(r, 40));
        const guideStepsEl = document.querySelector('[data-gemini-guide-steps]');
        const stepCount = guideStepsEl?.querySelectorAll('.gemini-guide-step-item')?.length || 0;
        const hasDirectAppApiKeyLink = Boolean(
          guideStepsEl?.querySelector('a[href="https://aistudio.google.com/app/apikey"]')
        );
        const hasRateLimitLink = Boolean(
          guideStepsEl?.querySelector('a[href="https://aistudio.google.com/rate-limit"]')
        );
        const guideExpandedNoOverflow =
          document.documentElement.scrollWidth <= window.innerWidth + 1;
        document.querySelector('[data-action="focus-inline-gemini-key"]')?.click();
        const jumpBtnFocusedInput = document.activeElement?.id === 'inlineGeminiApiKeyInput';

        const keyInput = document.getElementById('inlineGeminiApiKeyInput');
        const inlineKeyFontSize = keyInput ? parseFloat(window.getComputedStyle(keyInput).fontSize) : 0;

        // Pre-click coarse estimates via slider (#podDurationSlider) — zero preset duration buttons
        const presetBtnsCount = document.querySelectorAll('[data-action="set-pod-duration"]').length;
        const setSliderMins = mins => {
          const sl = document.getElementById('podDurationSlider');
          sl.value = String(mins);
          sl.dispatchEvent(new Event('input', { bubbles: true }));
        };
        setSliderMins(3);
        const preClickHint3m = document.querySelector('[data-est-wait-preview="podcast"]')?.textContent?.trim() || '';
        setSliderMins(8);
        const preClickHint8m = document.querySelector('[data-est-wait-preview="podcast"]')?.textContent?.trim() || '';
        setSliderMins(3);

        // Attempting generation without a key must immediately prompt to connect Gemini key & focus #inlineGeminiApiKeyInput
        const topicEl = document.getElementById('podTopicInput');
        topicEl.value = 'wide recievers';
        topicEl.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-action="generate-autopodcast"]').click();
        await new Promise(r => setTimeout(r, 80));
        const missingKeyErrText = document.getElementById('mainView').textContent || '';
        const focusedKeyInput = document.activeElement?.id === 'inlineGeminiApiKeyInput';

        // Point geminiApiBaseUrl to our local mock v1beta server and connect inline Gemini API key
        const st = window.__49ersDiagnostics.getState();
        st.prefs.geminiApiBaseUrl = `http://127.0.0.1:${portNum}/v1beta`;
        const liveKeyInput = document.getElementById('inlineGeminiApiKeyInput');
        liveKeyInput.value = 'AIzaMockE2EStudioKey49ers';
        document.querySelector('[data-action="save-inline-gemini-key"]').click();

        const waitStart = Date.now();
        while (document.querySelector('[data-gemini-setup-card="unconnected"]') && Date.now() - waitStart < 4000) {
          await new Promise(r => setTimeout(r, 60));
        }
        const noConnectedClutterBanner = !document.querySelector('[data-gemini-setup-card]');
        const guideHiddenOnceConnected = !document.querySelector('[data-gemini-guide-banner]');

        return {
          emptyErrText,
          hasUnconnectedCard: Boolean(unconnectedCard),
          guidePositionedAboveCard,
          stepCount,
          hasDirectAppApiKeyLink,
          hasRateLimitLink,
          guideExpandedNoOverflow,
          jumpBtnFocusedInput,
          guideHiddenOnceConnected,
          inlineKeyFontSize,
          presetBtnsCount,
          preClickHint3m,
          preClickHint8m,
          missingKeyErrText,
          focusedKeyInput,
          noConnectedClutterBanner
        };
      }, PORT);

      assert(gateAndConnectAudit.emptyErrText.includes('Please enter or select a podcast topic'), 'Missing empty podcast topic validation');
      assert(gateAndConnectAudit.hasUnconnectedCard && gateAndConnectAudit.inlineKeyFontSize >= 16, 'Unconnected Gemini setup card missing or <16px input');
      assert(gateAndConnectAudit.presetBtnsCount === 0, 'Preset duration buttons should be removed in favor of slider');
      assert(
        gateAndConnectAudit.guidePositionedAboveCard &&
          gateAndConnectAudit.stepCount === 4 &&
          gateAndConnectAudit.hasDirectAppApiKeyLink &&
          gateAndConnectAudit.hasRateLimitLink &&
          gateAndConnectAudit.guideExpandedNoOverflow &&
          gateAndConnectAudit.jumpBtnFocusedInput &&
          gateAndConnectAudit.guideHiddenOnceConnected,
        `New-user Gemini API key guide audit failed: ${JSON.stringify(gateAndConnectAudit)}`
      );
      assert(
        gateAndConnectAudit.preClickHint3m === '3 min pod • Est. 45–90 sec',
        `Unexpected 3m pre-click text: "${gateAndConnectAudit.preClickHint3m}"`
      );
      assert(
        gateAndConnectAudit.preClickHint8m === '8 min pod • Est. 1–3 min',
        `Unexpected 8m coarse pre-click text: "${gateAndConnectAudit.preClickHint8m}"`
      );
      assert(
        gateAndConnectAudit.missingKeyErrText.includes('Connect your free Google AI Studio Gemini API Key') &&
          gateAndConnectAudit.focusedKeyInput,
        `Unconnected Gemini key gate failed: ${JSON.stringify(gateAndConnectAudit)}`
      );
      assert(
        gateAndConnectAudit.noConnectedClutterBanner,
        'Connected state must hide setup/model clutter banner cleanly'
      );
      await cdp.assertNoOverflow('Audio & AI Connected Clean View');

      // 2. Configure exact user scenario: 3 min Two-Host podcast (Host Format configured in Settings!) on "wide recievers"
      mockGeminiRequests.length = 0;
      const genStartWallMs = Date.now();
      const podSetupAndProgress = await cdp.eval(async () => {
        document.getElementById('openSettingsBtn').click();
        document.querySelector('[data-action="set-pod-format"][data-format="two_host"]')?.click();
        document.getElementById('closeSheetBtn').click();

        const sl = document.getElementById('podDurationSlider');
        sl.value = '3';
        sl.dispatchEvent(new Event('input', { bubbles: true }));
        const inp = document.getElementById('podTopicInput');
        inp.value = 'wide recievers';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-action="generate-autopodcast"]').click();

        await new Promise(r => setTimeout(r, 150));
        const banner = document.querySelector('[data-job-progress="active"]');
        const stageLabels = Array.from(banner?.querySelectorAll('.job-stage-label') || []).map(el =>
          el.textContent.trim()
        );
        const spinner = banner?.querySelector('.job-spinner-ring');
        const spinnerRect = spinner?.getBoundingClientRect();
        const waveBars = banner?.querySelectorAll('.job-wave-bars span')?.length || 0;
        const progressFill = banner?.querySelector('.job-progress-fill');
        const elapsedClock = document.getElementById('jobElapsedClock')?.textContent || '';
        const genBtn = document.querySelector('[data-action="generate-autopodcast"]');

        return {
          hasBanner: Boolean(banner),
          stageLabels,
          bannerText: banner?.textContent || '',
          spinnerVisible: Boolean(spinnerRect && spinnerRect.width >= 18 && spinnerRect.height >= 18),
          waveBars,
          hasProgressBar: Boolean(progressFill),
          elapsedClock,
          btnDisabled: Boolean(genBtn?.disabled),
          btnSpinIcon: Boolean(genBtn?.querySelector('.btn-spin-icon'))
        };
      });

      assert(
        JSON.stringify(podSetupAndProgress.stageLabels) ===
          JSON.stringify([
            '1. Deep research on the topic',
            '2. Restructure into audio script',
            '3. Convert to podcast'
          ]),
        `Missing 3-stage pipeline labels: ${JSON.stringify(podSetupAndProgress.stageLabels)}`
      );
      assert(
        podSetupAndProgress.hasBanner &&
          podSetupAndProgress.spinnerVisible &&
          podSetupAndProgress.waveBars === 4 &&
          podSetupAndProgress.hasProgressBar &&
          podSetupAndProgress.bannerText.includes('Est. wait:') &&
          !podSetupAndProgress.bannerText.includes('Gemini 3.8') &&
          podSetupAndProgress.elapsedClock.startsWith('Elapsed') &&
          podSetupAndProgress.btnDisabled &&
          podSetupAndProgress.btnSpinIcon,
        `Podcast 3-stage wait bar check failed: ${JSON.stringify(podSetupAndProgress)}`
      );
      await cdp.assertNoOverflow('Active 3-Stage Podcast Wait Bar');

      // Wait for 3-stage Gemini Pro High + Multi-Speaker NotebookLM TTS + Stereo WAV Mastering to complete
      await cdp.waitFor(
        () => !document.querySelector('[data-job-progress="active"]') && Boolean(document.querySelector('[data-podcast-ready-card]')),
        null,
        45_000
      );
      const totalGenWallMs = Date.now() - genStartWallMs;
      assert(
        totalGenWallMs >= 1000,
        `Generation finished suspiciously fast (${totalGenWallMs}ms); expected multi-stage deep research + NotebookLM TTS`
      );

      // Verify actual v1beta Gemini requests sent from browser: High Thinking + Google Search Grounding + Puck/Aoede Multi-Speaker TTS!
      const textReqs = mockGeminiRequests.filter(r => r.urlPath.includes('gemini-3.8-pro:generateContent'));
      const ttsReqs = mockGeminiRequests.filter(r => r.urlPath.includes('preview-tts:generateContent'));
      assert(textReqs.length >= 1, `Expected >=1 High-Thinking stage (Research + Script), got ${textReqs.length}`);
      assert(
        textReqs.every(
          r =>
            r.body?.generationConfig?.thinkingConfig?.thinkingLevel === 'HIGH' &&
            !('thinkingBudget' in (r.body?.generationConfig?.thinkingConfig || {}))
        ),
        'Gemini 3+ requests must send thinkingConfig: { thinkingLevel: "HIGH" } without thinkingBudget'
      );
      assert(
        Array.isArray(textReqs[0].body?.tools) && Boolean(textReqs[0].body.tools[0]?.google_search),
        'Stage 1 Deep Research must enable live google_search grounding tool'
      );
      assert(ttsReqs.length >= 1, 'Expected Gemini 2.5 Pro Preview Multi-Speaker NotebookLM TTS call');
      const speakerCfgs =
        ttsReqs[0].body?.generationConfig?.speechConfig?.multiSpeakerVoiceConfig?.speakerVoiceConfigs || [];
      assert(
        speakerCfgs.some(s => s.speaker === 'Marcus' && s.voiceConfig?.prebuiltVoiceConfig?.voiceName === 'Puck') &&
          speakerCfgs.some(s => s.speaker === 'Elena' && s.voiceConfig?.prebuiltVoiceConfig?.voiceName === 'Aoede'),
        `Expected NotebookLM Puck + Aoede speakerVoiceConfigs, got: ${JSON.stringify(speakerCfgs)}`
      );

      // Verify "Podcast Ready to Play" state, ~3:00 duration (NOT 1:21!), hidden-by-default transcript, and real Stereo WAV audio!
      const readyAndPlaybackAudit = await cdp.eval(async () => {
        const readyCard = document.querySelector('[data-podcast-ready-card]');
        const readyCardText = readyCard?.textContent || '';
        const hiddenTurnsBeforeClick = document.querySelectorAll('[data-action="seek-podcast-turn"]').length;

        const st = window.__49ersDiagnostics.getState();
        const ep = st.audioState?.episode;
        const { getEpisodeAudioUrl } = await import('/src/services/podcastAudioStore.js');
        const wavBlobUrl = await getEpisodeAudioUrl(ep?.id);
        let wavHeader = '';
        let wavChannels = 0;
        let wavByteLength = 0;
        let wavNonZeroSamples = 0;
        if (wavBlobUrl) {
          const buf = await (await fetch(wavBlobUrl)).arrayBuffer();
          wavByteLength = buf.byteLength;
          const view = new DataView(buf);
          wavHeader = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
          wavChannels = view.getUint16(22, true);
          for (let off = 24000; off < Math.min(buf.byteLength - 2, 96000); off += 20) {
            if (Math.abs(view.getInt16(off, true)) > 150) wavNonZeroSamples++;
          }
        }

        // Hit Play on the Ready-to-Play card and verify it stays playing past 2.3 seconds (never pauses at 1s!)
        readyCard?.querySelector('[data-action="play-episode"]')?.click();
        await new Promise(r => setTimeout(r, 2300));
        const afterPlayState = window.__49ersDiagnostics.getState().audioState;
        const stillPlayingAt2s = Boolean(afterPlayState?.isPlaying);
        const currentTimeAt2s = Number(afterPlayState?.currentTimeSec || 0);

        // Expand transcript on click and inspect WR deep-research content
        document.querySelector('[data-podcast-ready-card] [data-action="toggle-podcast-transcript"]')?.click();
        const expandedTurnCount = document.querySelectorAll('[data-action="seek-podcast-turn"]').length;
        const fullTranscriptText = (ep?.transcript || []).map(t => t.text).join(' ');

        // Pause cleanly
        document.getElementById('mpPlayPauseBtn')?.click();

        return {
          epId: ep?.id,
          readyCardText,
          hiddenTurnsBeforeClick,
          expandedTurnCount,
          epTitle: ep?.title,
          durationSec: ep?.durationSec,
          wavHeader,
          wavChannels,
          wavByteLength,
          wavNonZeroSamples,
          stillPlayingAt2s,
          currentTimeAt2s,
          mentionsWatkinsOrRobinson:
            fullTranscriptText.includes('Jordan Watkins') || fullTranscriptText.includes('Demarcus Robinson'),
          mentionsPearsallOrAiyuk:
            fullTranscriptText.includes('Ricky Pearsall') || fullTranscriptText.includes('Brandon Aiyuk')
        };
      });

      assert(
        readyAndPlaybackAudit.readyCardText.includes('Podcast Ready to Play'),
        `Missing "Podcast Ready to Play" header: ${readyAndPlaybackAudit.readyCardText.slice(0, 160)}`
      );
      assert(
        readyAndPlaybackAudit.hiddenTurnsBeforeClick === 0 && readyAndPlaybackAudit.expandedTurnCount >= 10,
        `Transcript default-hidden / expand behavior failed: ${JSON.stringify(readyAndPlaybackAudit)}`
      );
      assert(
        readyAndPlaybackAudit.durationSec >= 145 && readyAndPlaybackAudit.durationSec <= 235,
        `Expected ~3:00 duration (145s..235s) for 3m WR podcast, got ${readyAndPlaybackAudit.durationSec}s`
      );
      assert(
        readyAndPlaybackAudit.wavHeader === 'RIFF' &&
          readyAndPlaybackAudit.wavChannels === 2 &&
          readyAndPlaybackAudit.wavByteLength > 4_000_000 &&
          readyAndPlaybackAudit.wavNonZeroSamples > 50,
        `Expected real 2-channel Stereo WAV audio (>4MB non-silent speech), got: ${JSON.stringify(readyAndPlaybackAudit)}`
      );
      assert(
        readyAndPlaybackAudit.stillPlayingAt2s && readyAndPlaybackAudit.currentTimeAt2s >= 1.5,
        `Podcast paused prematurely or failed to advance past 1.5s: ${JSON.stringify(readyAndPlaybackAudit)}`
      );
      assert(
        readyAndPlaybackAudit.mentionsWatkinsOrRobinson && readyAndPlaybackAudit.mentionsPearsallOrAiyuk,
        `WR Deep Research script missed live 2026 49ers WR room players: ${JSON.stringify(readyAndPlaybackAudit)}`
      );
      await cdp.assertNoOverflow('Custom 3m WR Podcast Ready to Play + Expanded Transcript');

      // 3. Test Share Icon + Colleague Deep-Link Import & Playback on 49ers.joshal.com
      const shareRoundTrip = await cdp.eval(async () => {
        let nativeShareCaptured = null;
        const origShare = navigator.share;
        navigator.share = async payload => {
          nativeShareCaptured = payload;
        };
        try {
          document.querySelector('[data-podcast-ready-card] [data-action="share-podcast"]')?.click();
          await new Promise(r => setTimeout(r, 200));
        } finally {
          navigator.share = origShare;
        }

        const sharedUrl = window.__lastSharedUrl || nativeShareCaptured?.url || '';
        document.getElementById('mpCloseBtn')?.click();
        await window.__49ersDiagnostics.openSharedUrl(new URL(sharedUrl));
        const loadedSharedEp = window.__49ersDiagnostics.getState().audioState?.episode;
        return {
          sharedUrl,
          nativeTitle: nativeShareCaptured?.title || '',
          loadedTitle: loadedSharedEp?.title || '',
          loadedTurns: loadedSharedEp?.transcript?.length || 0
        };
      });
      assert(
        shareRoundTrip.sharedUrl.includes('?pod=custom_ep_') &&
          shareRoundTrip.sharedUrl.includes('#shared-pod=z.') &&
          shareRoundTrip.nativeTitle.includes('49ers Faithful Podcast') &&
          shareRoundTrip.loadedTurns >= 10,
        `Podcast native share & colleague deep-link hydration failed: ${JSON.stringify(shareRoundTrip)}`
      );

      // 4. Test Podcast Archive -> Active/Archived Filter -> Archive Vault Sheet -> Restore -> Delete (+ IDB & Mini-Player cleanup!)
      const podArchiveAndDeleteAudit = await cdp.eval(async customEpId => {
        // Archive custom podcast from Ready-to-Play / Library
        document.querySelector(`[data-episode-card="${customEpId}"] [data-action="archive-podcast"]`)?.click();
        const absentFromActive = !document.querySelector(`[data-episode-card="${customEpId}"]`);

        // Switch library filter to Archived (1)
        document.querySelector('[data-action="set-pod-library-filter"][data-filter="archived"]')?.click();
        const visibleInArchivedTab = Boolean(document.querySelector(`[data-episode-card="${customEpId}"]`));

        // Open Top-Bar Archive Vault sheet and confirm it appears under #archivePodcastsSection
        document.getElementById('openArchiveBtn')?.click();
        const vaultPodText = document.getElementById('archivePodcastsSection')?.textContent || '';
        // Restore directly from Archive Vault sheet!
        document.querySelector(`#archivePodcastsSection [data-action="unarchive-podcast"][data-episode-id="${customEpId}"]`)?.click();
        document.getElementById('closeSheetBtn')?.click();

        // Switch back to Active filter and confirm restored episode is back
        document.querySelector('[data-action="set-pod-library-filter"][data-filter="active"]')?.click();
        const restoredToActive = Boolean(document.querySelector(`[data-episode-card="${customEpId}"]`));

        // Now Delete the custom episode and confirm Mini-Player closes + IndexedDB WAV blob is purged!
        document.querySelector(`[data-episode-card="${customEpId}"] [data-action="delete-podcast"]`)?.click();
        await new Promise(r => setTimeout(r, 150));
        const goneAfterDelete = !document.querySelector(`[data-episode-card="${customEpId}"]`);
        const miniPlayerHiddenAfterDelete = document.getElementById('miniPlayer').hidden;
        const { getEpisodeAudioUrl } = await import('/src/services/podcastAudioStore.js');
        const idbUrlAfterDelete = await getEpisodeAudioUrl(customEpId);

        return {
          absentFromActive,
          visibleInArchivedTab,
          inVaultSheet: vaultPodText.includes('wide receivers'),
          restoredToActive,
          goneAfterDelete,
          miniPlayerHiddenAfterDelete,
          idbPurged: idbUrlAfterDelete === null
        };
      }, readyAndPlaybackAudit.epId);

      assert(
        podArchiveAndDeleteAudit.absentFromActive &&
          podArchiveAndDeleteAudit.visibleInArchivedTab &&
          podArchiveAndDeleteAudit.inVaultSheet &&
          podArchiveAndDeleteAudit.restoredToActive &&
          podArchiveAndDeleteAudit.goneAfterDelete &&
          podArchiveAndDeleteAudit.miniPlayerHiddenAfterDelete &&
          podArchiveAndDeleteAudit.idbPurged,
        `Podcast Archive / Restore / Delete lifecycle failed: ${JSON.stringify(podArchiveAndDeleteAudit)}`
      );

      // 5. Switch to AI Analysis Tab, verify parallel 3-step wait bar, Pro High estimate, grounding, Share, Archive & Delete
      const emptyAnalysisErr = await cdp.eval(() => {
        document.querySelector('[data-action="set-studio-sub"][data-studio-sub="analysis"]').click();
        const area = document.getElementById('analysisPromptInput');
        area.value = '';
        area.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-action="run-deep-analysis"]').click();
        return document.getElementById('mainView').textContent;
      });
      assert(emptyAnalysisErr.includes('Please enter an analysis topic'), 'Missing empty analysis prompt validation');

      const beforeReportCount = await cdp.eval(() => document.querySelectorAll('#mainView article.brief-card').length);
      const analysisProgress = await cdp.eval(async () => {
        const preHint = document.querySelector('[data-est-wait-preview="analysis"]')?.textContent?.trim() || '';
        const area = document.getElementById('analysisPromptInput');
        area.value = 'wide recievers';
        area.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-action="run-deep-analysis"]').click();
        await new Promise(r => setTimeout(r, 140));
        const banner = document.querySelector('[data-job-progress="active"]');
        const stageLabels = Array.from(banner?.querySelectorAll('.job-stage-label') || []).map(el =>
          el.textContent.trim()
        );
        return {
          preHint,
          hasBanner: Boolean(banner),
          stageLabels,
          bannerText: banner?.textContent || '',
          hasSpinner: Boolean(banner?.querySelector('.job-spinner-ring'))
        };
      });
      assert(
        analysisProgress.preHint === 'Est. 25–60 sec' &&
          analysisProgress.hasBanner &&
          analysisProgress.hasSpinner &&
          analysisProgress.stageLabels.length === 3 &&
          analysisProgress.bannerText.includes('Est. wait:') &&
          !analysisProgress.bannerText.includes('Gemini 3.8'),
        `Analysis 3-stage wait bar / estimate check failed: ${JSON.stringify(analysisProgress)}`
      );

      await cdp.waitFor(
        prev => document.querySelectorAll('#mainView article.brief-card').length > prev,
        beforeReportCount,
        20_000
      );

      // Verify Share icon + Archive / Restore / Delete lifecycle on AI Analysis report card
      const analysisShareAndLifecycle = await cdp.eval(async () => {
        const firstCard = document.querySelector('#mainView article.brief-card[data-analysis-card]');
        const analysisId = firstCard?.getAttribute('data-analysis-card') || '';

        let shared = null;
        const origShare = navigator.share;
        navigator.share = async d => {
          shared = d;
        };
        try {
          firstCard?.querySelector('[data-action="share-analysis"]')?.click();
          await new Promise(r => setTimeout(r, 150));
        } finally {
          navigator.share = origShare;
        }
        const sharedUrl = shared?.url || window.__lastSharedUrl || '';

        // Archive report -> check Archived filter & Vault -> Restore -> Delete
        firstCard?.querySelector('[data-action="archive-analysis"]')?.click();
        const hiddenFromActive = !document.querySelector(`[data-analysis-card="${analysisId}"]`);

        document.querySelector('[data-action="set-analysis-library-filter"][data-filter="archived"]')?.click();
        const shownInArchived = Boolean(document.querySelector(`[data-analysis-card="${analysisId}"]`));

        document.getElementById('openArchiveBtn')?.click();
        const vaultAnalysisText = document.getElementById('archiveAnalysesSection')?.textContent || '';
        document.querySelector(`#archiveAnalysesSection [data-action="unarchive-analysis"][data-analysis-id="${analysisId}"]`)?.click();
        document.getElementById('closeSheetBtn')?.click();

        document.querySelector('[data-action="set-analysis-library-filter"][data-filter="active"]')?.click();
        const restoredOk = Boolean(document.querySelector(`[data-analysis-card="${analysisId}"]`));

        document.querySelector(`[data-analysis-card="${analysisId}"] [data-action="delete-analysis"]`)?.click();
        const deletedOk = !document.querySelector(`[data-analysis-card="${analysisId}"]`);

        return {
          sharedUrl,
          hiddenFromActive,
          shownInArchived,
          inVault: vaultAnalysisText.includes('wide recievers'),
          restoredOk,
          deletedOk
        };
      });
      assert(
        analysisShareAndLifecycle.sharedUrl.includes('?analysis=') &&
          analysisShareAndLifecycle.sharedUrl.includes('#shared-analysis=z.') &&
          analysisShareAndLifecycle.hiddenFromActive &&
          analysisShareAndLifecycle.shownInArchived &&
          analysisShareAndLifecycle.inVault &&
          analysisShareAndLifecycle.restoredOk &&
          analysisShareAndLifecycle.deletedOk,
        `AI Analysis Share / Archive / Restore / Delete failed: ${JSON.stringify(analysisShareAndLifecycle)}`
      );

      // 6. Ask about retired former 49er Bryce Huff and verify Live Roster Grounding Verification explicitly flags him as non-rostered
      const countBeforeHuffQuery = await cdp.eval(() => document.querySelectorAll('#mainView article.brief-card').length);
      await cdp.eval(() => {
        const area = document.getElementById('analysisPromptInput');
        area.value = 'How is Bryce Huff fitting into the 2026 49ers pass rush?';
        area.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-action="run-deep-analysis"]').click();
      });
      await cdp.waitFor(
        prev => document.querySelectorAll('#mainView article.brief-card').length > prev,
        countBeforeHuffQuery,
        20_000
      );
      const topGeneratedCardText = await cdp.eval(
        () => document.querySelector('#mainView article.brief-card')?.textContent || ''
      );
      assert(
        topGeneratedCardText.includes('not on the live 2026 San Francisco 49ers') &&
          topGeneratedCardText.includes('retired/departed'),
        `Expected explicit live-roster non-rostered verification when querying retired player, got: ${topGeneratedCardText.slice(0, 260)}`
      );

      await cdp.assertNoOverflow('Deep Analysis Runner With Generated Report');
    });

    console.log('\n=== [8/9] Settings, Theme Switching, Reporter/Outlet Filtering, Vault & Storage Resilience ===');

    await runStep('Settings toggles 94 Throwback Light/Night Dark theme, filters outlets/reporters, and opens Vault modules', async () => {
      // Open Settings
      await cdp.eval(() => document.getElementById('openSettingsBtn').click());
      await cdp.assertNoOverflow('Settings Bottom Sheet');

      // Switch to Light Theme ('94 Throwback White & Gold)
      const lightAttr = await cdp.eval(() => {
        document.querySelector('[data-action="toggle-theme"]').click();
        return {
          theme: document.documentElement.getAttribute('data-theme'),
          metaColor: document.getElementById('metaThemeColor')?.getAttribute('content')
        };
      });
      assert(lightAttr.theme === 'light' && lightAttr.metaColor === '#F7F5F0', 'Light theme toggle failed');
      await cdp.assertNoOverflow('Settings Sheet in Light Theme');

      // Mute an outlet & search/mute a reporter while verifying input focus stays in search box
      const filterState = await cdp.eval(() => {
        document.querySelector('[data-action="toggle-outlet"]').click();
        const searchInp = document.getElementById('reporterFilterSearchInput');
        searchInp.focus();
        searchInp.value = 'Kawakami';
        searchInp.dispatchEvent(new Event('input', { bubbles: true }));
        const keptFocus = document.activeElement?.id === 'reporterFilterSearchInput';
        const cb = document.querySelector('[data-action="toggle-reporter"]');
        if (cb) {
          cb.checked = false;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return { keptFocus, mutedReporterFound: Boolean(cb) };
      });
      assert(filterState.keptFocus && filterState.mutedReporterFound, 'Reporter search/mute failed');

      // Re-enable all reporters & switch back to Dark theme, save credentials, close sheet
      await cdp.eval(() => {
        document.querySelector('[data-action="enable-all-reporters"]').click();
        document.querySelector('[data-action="toggle-theme"]').click();
        document.querySelector('[data-action="save-group-config"]').click();
        document.getElementById('closeSheetBtn').click();
      });

      // Open Seasonal Archive Vault & jump into off-cycle module
      const vaultJump = await cdp.eval(() => {
        document.getElementById('openArchiveBtn').click();
        const btn = document.querySelector('[data-action="open-vault-module"]');
        const targetSub = btn?.getAttribute('data-season-sub');
        btn?.click();
        return {
          sheetClosed: document.getElementById('bottomSheetBackdrop').hidden,
          activeNav: document.querySelector('.nav-tab-btn.active')?.getAttribute('data-nav-tab'),
          targetSub
        };
      });
      assert(vaultJump.sheetClosed && vaultJump.activeNav === 'season', 'Vault Inspect jump failed');
    });

    await runStep('Corrupted localStorage payloads recover gracefully without crashing app boot', async () => {
      await cdp.eval(() => {
        window.localStorage.setItem('joshal_49ers_hq_prefs_v1', '{corrupted_json_payload!!!');
      });
      await cdp.send('Page.reload');
      await cdp.waitFor(() => document.querySelector('[data-action="toggle-customize-layout"]'));
      const healthyAfterCorrupt = await cdp.eval(portNum => {
        const rec = document.getElementById('headerRecordPill')?.textContent?.trim();
        // Restore mock v1beta connection so subsequent Deep Analysis XSS test exercises real LLM Markdown rendering
        const st = window.__49ersDiagnostics.getState();
        const expectedRec = st.appData.meta.teamRecord;
        st.prefs.geminiApiKey = 'AIzaMockE2EStudioKey49ers';
        st.prefs.verifiedGeminiModel = 'gemini-3.8-pro';
        st.prefs.geminiApiBaseUrl = `http://127.0.0.1:${portNum}/v1beta`;
        window.__49ersDiagnostics.forceRender();
        return { rec, expectedRec };
      }, PORT);
      assert(
        healthyAfterCorrupt.rec === healthyAfterCorrupt.expectedRec,
        `App failed to recover from corrupted localStorage: got ${healthyAfterCorrupt.rec}`
      );
    });

    await runStep('XSS HTML/Script payloads in search, prompts & markdown are strictly escaped; all inputs >=16px (no iOS zoom)', async () => {
      await cdp.setViewport(393, 852, true, 3);
      const securityAndZoom = await cdp.eval(async () => {
        window.__xssTriggered = false;
        const payload = `<img src=x onerror="window.__xssTriggered=true"><script>window.__xssTriggered=true</script>`;

        // Check Roster Search + GM Selects font-size >= 16px
        document.querySelector('[data-nav-tab="roster"]').click();
        const rSearch = document.getElementById('rosterSearchInput');
        rSearch.value = payload;
        rSearch.dispatchEvent(new Event('input', { bubbles: true }));

        document.querySelector('[data-action="set-roster-sub"][data-roster-sub="cap"]').click();
        const gmSelectFontSizes = Array.from(document.querySelectorAll('input, select, textarea')).map(el =>
          parseFloat(window.getComputedStyle(el).fontSize)
        );
        document.querySelector('[data-action="set-roster-sub"][data-roster-sub="roster"]').click();
        document.getElementById('rosterSearchInput').value = '';
        document.getElementById('rosterSearchInput').dispatchEvent(new Event('input', { bubbles: true }));

        // Check Deep Analysis markdown escaping with raw HTML payload
        document.querySelector('[data-nav-tab="audio"]').click();
        document.querySelector('[data-action="set-studio-sub"][data-studio-sub="analysis"]').click();
        const area = document.getElementById('analysisPromptInput');
        area.value = `Purdy EPA ${payload}`;
        area.dispatchEvent(new Event('input', { bubbles: true }));
        const audioInputSizes = Array.from(document.querySelectorAll('input, select, textarea'))
          .filter(el => el.type !== 'range' && el.type !== 'checkbox')
          .map(el => parseFloat(window.getComputedStyle(el).fontSize));
        document.querySelector('[data-action="run-deep-analysis"]').click();

        const waitStart = Date.now();
        while (document.querySelector('[data-job-progress="active"]') && Date.now() - waitStart < 9000) {
          await new Promise(r => setTimeout(r, 150));
        }
        await new Promise(r => setTimeout(r, 120));

        // Check Settings inputs >= 16px
        document.getElementById('openSettingsBtn').click();
        const settingsInputSizes = Array.from(document.querySelectorAll('#sheetBody input[type="text"], #sheetBody input[type="password"], #sheetBody input[type="url"], #sheetBody input[type="search"]'))
          .map(el => parseFloat(window.getComputedStyle(el).fontSize));
        document.getElementById('closeSheetBtn').click();

        const allSizes = [...gmSelectFontSizes, ...audioInputSizes, ...settingsInputSizes];
        const minFontSize = Math.min(...allSizes);
        const injectedImgCount = document.querySelectorAll('img[src="x"]').length;

        return {
          xssTriggered: Boolean(window.__xssTriggered),
          injectedImgCount,
          minFontSize
        };
      });

      assert(securityAndZoom.xssTriggered === false && securityAndZoom.injectedImgCount === 0, 'XSS payload was not escaped!');
      assert(
        securityAndZoom.minFontSize >= 16,
        `Form control has font-size ${securityAndZoom.minFontSize}px (<16px causes iOS Safari auto-zoom on iPhone 16)`
      );
    });

    await runStep('Service Worker CacheStorage populates offline shell & JSON feeds for Levi Stadium / airplane-mode resilience', async () => {
      const cacheInfo = await cdp.eval(async () => {
        const keys = await caches.keys();
        let cachedCount = 0;
        for (const k of keys) {
          const c = await caches.open(k);
          const reqs = await c.keys();
          cachedCount += reqs.length;
        }
        return { cacheBuckets: keys.length, cachedCount };
      });
      assert(
        cacheInfo.cacheBuckets >= 1 && cacheInfo.cachedCount >= 20,
        `Expected >=20 pre-cached assets in CacheStorage, got ${JSON.stringify(cacheInfo)}`
      );
    });

    await runStep('Uncommon edge cases: #0 jersey search, apostrophe search, away-game scoreboard orientation, outbound link security & non-embeddable video guard', async () => {
      const edgeAudit = await cdp.eval(async () => {
        // 1. Test #0 jersey search (Renardo Green #0 — guards against falsy 0 bug!) & iOS curly/omitted apostrophe search
        document.querySelector('[data-nav-tab="roster"]').click();
        document.querySelector('[data-action="set-roster-sub"][data-roster-sub="roster"]').click();
        document.querySelector('[data-action="set-roster-unit"][data-unit="All"]')?.click();
        document.querySelector('[data-action="set-roster-pos"][data-pos="ALL"]')?.click();
        const setRosterQuery = val => {
          const inp = document.getElementById('rosterSearchInput');
          inp.value = val;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          return document.getElementById('mainView').textContent || '';
        };

        const zeroText = setRosterQuery('#0');
        const foundNumberZero = zeroText.includes('Renardo Green');

        // Test BOTH iOS curly smart-quote ('De’Zhaun') AND omitted apostrophe ('Dezhaun')
        const curlyApostropheFound = setRosterQuery('De\u2019Zhaun').includes("De'Zhaun Stribling");
        const noApostropheFound = setRosterQuery('Dezhaun').includes("De'Zhaun Stribling");
        const apostropheFound = curlyApostropheFound && noApostropheFound;

        const emptyGraceful = setRosterQuery('zzzz_no_such_player_999').toLowerCase().includes('no players match');
        setRosterQuery('');

        // 2. Test away-game matchup scoreboard orientation (49ers on left @ Home Team on right)
        const { renderSeasonMatchupViewHtml } = await import('/src/views/seasonMatchupView.js');
        const awayHtml = renderSeasonMatchupViewHtml({
          seasonSub: 'matchup',
          activePhases: ['YEAR_ROUND', 'IN_SEASON'],
          appData: {
            meta: { teamRecord: '7-1', currentWeek: 10 },
            scheduleMatchup: {
              upcomingMatchup: {
                week: 10,
                homeAway: 'away',
                oppAbbr: 'DAL',
                oppName: 'Dallas Cowboys',
                oppRecord: '3-5',
                sfRecord: '7-1 (1st NFC West)',
                kickoffDisplay: 'Sun, Nov 15 • 1:25 PM PT (FOX)',
                venue: 'AT&T Stadium',
                betting: { spread: 'SF -3.5', overUnder: '53.5', restAdvantage: 'Even Rest' },
                coachingMatchup: { headline: 'Kyle Shanahan vs Brian Schottenheimer' },
                opponentHealth: { summary: {}, injuryReport: [], keyStartersHealthy: [], irReserve: [] },
                franchiseHistory: { recentRecord: '3-1', pfrQueryUrl: 'https://www.pro-football-reference.com/boxscores/game_query.cgi?tm1=sfo&tm2=dal&yr=all', recentGames: [] }
              }
            }
          }
        });
        const tmpDiv = document.createElement('div');
        tmpDiv.innerHTML = awayHtml;
        const awayTitle = tmpDiv.querySelector('.card-title')?.textContent || '';
        const sbCols = Array.from(tmpDiv.querySelectorAll('.matchup-scoreboard .sb-team-abbr')).map(n => n.textContent.trim());

        // 3. Outbound links across all primary tabs, sub-tabs, Player Dossier modals & Settings must be https://, non-paywalled, with target="_blank" & rel*="noopener"
        const { isPaywalledOrBlockedUrl } = await import('/src/engine/linkIntegrity.js');
        const badLinks = [];
        let checkedExternalLinks = 0;
        const collectAnchors = scopeLabel => {
          for (const a of document.querySelectorAll('a[href]')) {
            const href = a.getAttribute('href') || '';
            if (href.startsWith('http')) {
              checkedExternalLinks++;
              const rel = a.getAttribute('rel') || '';
              if (
                !href.startsWith('https://') ||
                a.getAttribute('target') !== '_blank' ||
                !rel.includes('noopener') ||
                isPaywalledOrBlockedUrl(href)
              ) {
                badLinks.push({ scope: scopeLabel, href, target: a.getAttribute('target'), rel });
              }
            }
          }
        };

        for (const tab of ['home', 'news', 'roster', 'season', 'audio']) {
          document.querySelector(`[data-nav-tab="${tab}"]`).click();
          collectAnchors(`tab:${tab}`);
          if (tab === 'roster') {
            for (const rSub of ['roster', 'depth', 'cap']) {
              document.querySelector(`[data-action="set-roster-sub"][data-roster-sub="${rSub}"]`)?.click();
              collectAnchors(`roster:${rSub}`);
            }
          }
          if (tab === 'season') {
            for (const sSub of ['matchup', 'health', 'schedule', 'trade', 'playoffs', 'draft_prep', 'draft_class', 'stats']) {
              document.querySelector(`[data-action="set-season-sub"][data-season-sub="${sSub}"]`)?.click();
              collectAnchors(`season:${sSub}`);
            }
          }
        }

        // Open Player Dossier sheets for James Thompson Jr. & Khalil Dinkins and verify exact player links across all 5 dossier tabs
        document.querySelector('[data-nav-tab="roster"]').click();
        document.querySelector('[data-action="set-roster-sub"][data-roster-sub="roster"]').click();
        document.querySelector('[data-action="set-roster-unit"][data-unit="All"]')?.click();
        setRosterQuery('James Thompson');
        document.querySelector('[data-action="open-player-sheet"]')?.click();
        const jtSheetHrefs = Array.from(document.querySelectorAll('#sheetBody a[href]')).map(a => a.getAttribute('href'));
        for (const pTab of ['overview', 'stats', 'spider', 'contract', 'health']) {
          document.querySelector(`[data-action="set-player-tab"][data-player-tab="${pTab}"]`)?.click();
          collectAnchors(`dossier:JamesThompson:${pTab}`);
        }
        document.querySelector('[data-action="close-sheet"]')?.click();

        setRosterQuery('Khalil Dinkins');
        document.querySelector('[data-action="open-player-sheet"]')?.click();
        const kdSheetHrefs = Array.from(document.querySelectorAll('#sheetBody a[href]')).map(a => a.getAttribute('href'));
        collectAnchors('dossier:KhalilDinkins:overview');
        document.querySelector('[data-action="close-sheet"]')?.click();
        setRosterQuery('');

        document.getElementById('openSettingsBtn')?.click();
        collectAnchors('sheet:settings');
        document.querySelector('[data-action="close-sheet"]')?.click();

        // 4. Verify non-embeddable videos in news.json never attach [data-action="activate-video"]
        document.querySelector('[data-nav-tab="news"]').click();
        const newsRes = await fetch('./data/news.json');
        const newsData = await newsRes.json();
        const blockedIds = new Set();
        for (const c of newsData.clusteredBriefs || []) {
          if (c.videoClip && c.videoClip.embeddable === false) blockedIds.add(c.videoClip.videoId);
        }
        for (const r of newsData.rawStream || []) {
          if (r.videoId && r.embeddable === false) blockedIds.add(r.videoId);
        }
        const leakedBlockedTriggers = Array.from(document.querySelectorAll('[data-action="activate-video"]'))
          .map(el => el.getAttribute('data-video-id'))
          .filter(vid => blockedIds.has(vid));

        return {
          foundNumberZero,
          apostropheFound,
          emptyGraceful,
          awayTitle,
          sbCols,
          checkedExternalLinks,
          badLinks,
          jtSheetHrefs,
          kdSheetHrefs,
          leakedBlockedTriggers
        };
      });

      assert(edgeAudit.foundNumberZero, 'Searching #0 failed to match Renardo Green');
      assert(edgeAudit.apostropheFound, "Searching De'Zhaun failed to match De'Zhaun Stribling");
      assert(edgeAudit.emptyGraceful, 'Empty roster search state did not render gracefully');
      assert(
        edgeAudit.awayTitle.startsWith('49ers') && edgeAudit.sbCols[0] === '49ers' && edgeAudit.sbCols[1] === 'Dallas Cowboys',
        `Away-game scoreboard orientation wrong: title="${edgeAudit.awayTitle}", cols=${JSON.stringify(edgeAudit.sbCols)}`
      );
      assert(edgeAudit.checkedExternalLinks >= 80, `Expected >=80 external links across tabs & modals, checked ${edgeAudit.checkedExternalLinks}`);
      assert(edgeAudit.badLinks.length === 0, `Insecure, paywalled, or malformed outbound links found: ${JSON.stringify(edgeAudit.badLinks)}`);
      assert(
        edgeAudit.jtSheetHrefs.includes('https://www.pro-football-reference.com/players/T/ThomJa06.htm') &&
          edgeAudit.jtSheetHrefs.includes('https://overthecap.com/player/james-thompson-jr/13808/'),
        `James Thompson Jr. dossier links mismatch: ${JSON.stringify(edgeAudit.jtSheetHrefs)}`
      );
      assert(
        edgeAudit.kdSheetHrefs.includes('https://overthecap.com/player/khalil-dinkins/13810/'),
        `Khalil Dinkins dossier OTC link mismatch: ${JSON.stringify(edgeAudit.kdSheetHrefs)}`
      );
      assert(
        edgeAudit.leakedBlockedTriggers.length === 0,
        `Embed-blocked videoIds rendered inline iframe triggers: ${JSON.stringify(edgeAudit.leakedBlockedTriggers)}`
      );
    });

    await runStep('Verify 6 new functional upgrades: Trade Banner exclusivity, Jargon Popover bubbles, 5-Yr OTC Cap Summary & Simulator, Matchup Avatars/Opponent Parity & 30d Trade Archive', async () => {
      const upgradesAudit = await cdp.eval(() => {
        // 1. Verify #phaseBanner ("Active NFL Trade Window") ONLY shows in Game & Season > Trade Window
        const bannerStates = {};
        for (const nav of ['home', 'news', 'roster', 'audio']) {
          document.querySelector(`[data-nav-tab="${nav}"]`).click();
          const b = document.getElementById('phaseBanner');
          bannerStates[nav] = { hidden: b.hidden, display: window.getComputedStyle(b).display };
        }
        document.querySelector('[data-nav-tab="season"]').click();
        for (const sSub of ['matchup', 'health', 'schedule', 'trade', 'playoffs', 'draft_prep', 'draft_class', 'stats']) {
          document.querySelector(`[data-action="set-season-sub"][data-season-sub="${sSub}"]`)?.click();
          const b = document.getElementById('phaseBanner');
          bannerStates[`season:${sSub}`] = {
            hidden: b.hidden,
            display: window.getComputedStyle(b).display,
            text: b.textContent.trim()
          };
        }

        // 2. Verify Upcoming Matchup hero card has zero 49ers player avatars & Opponent Health has full parity
        document.querySelector('[data-action="set-season-sub"][data-season-sub="matchup"]').click();
        const matchupCards = document.querySelectorAll('#mainView > section.card');
        const heroMatchupCard = matchupCards[0];
        const heroPlayerAvatars = heroMatchupCard ? heroMatchupCard.querySelectorAll('.player-avatar').length : -1;
        const oppSec = document.getElementById('opponentHealthSection');
        const oppSecText = oppSec?.textContent || '';
        const oppHasParity =
          oppSecText.includes('Availability Index') &&
          oppSecText.includes('Starters Cleared') &&
          oppSecText.includes('Practice Participation') &&
          oppSecText.includes('4-Game Return Window Tracker');

        // 3. Verify Trade Window 30-day cutoff + Older Trades in Archive
        document.querySelector('[data-action="set-season-sub"][data-season-sub="trade"]').click();
        const recentTradesText = document.getElementById('recentCompletedTradesList')?.textContent || '';
        const tradeHasBucknerOnly =
          recentTradesText.includes('DeForest Buckner') && !recentTradesText.includes('Osa Odighizuwa');

        document.querySelector('[data-action="open-archive"]')?.click();
        const archiveTradesText = document.getElementById('archiveOlderTradesSection')?.textContent || '';
        const archiveHasOsa = archiveTradesText.includes('Osa Odighizuwa');
        document.getElementById('closeSheetBtn')?.click();

        // 4. Verify Jargon Quick-Bubble Popover opens, stays inside viewport, and closes cleanly
        document.querySelector('[data-nav-tab="news"]').click();
        document.querySelector('[data-action="set-news-mode"][data-mode="clustered"]')?.click();
        const jargonTermsFound = document.querySelectorAll('#mainView .jargon-term[data-jargon]').length;
        const firstJargon = document.querySelector('#mainView .jargon-term[data-jargon]');
        let jargonPopInfo = { opened: false };
        if (firstJargon) {
          firstJargon.click();
          const pop = document.getElementById('jargonPopover');
          const rect = pop.getBoundingClientRect();
          jargonPopInfo = {
            opened: !pop.hidden && pop.textContent.length > 25,
            withinLeft: rect.left >= 8,
            withinRight: rect.right <= window.innerWidth - 8,
            withinTop: rect.top >= 8,
            withinBottom: rect.bottom <= window.innerHeight - 8
          };
          document.querySelector('[data-action="close-jargon-popover"]')?.click();
          jargonPopInfo.closedCleanly = pop.hidden;
        }

        // 5. Verify 5-Year OTC Summary & 5-Year Salary Cap Simulator (2026–2030) + combined columns + nominal $0/$0
        document.querySelector('[data-nav-tab="roster"]').click();
        document.querySelector('[data-action="set-roster-sub"][data-roster-sub="cap"]').click();
        document.querySelector('[data-action="reset-cap-moves"]')?.click();

        const yearTabButtons = Array.from(
          document.querySelectorAll('#capHorizonSummaryCard .otc-year-tab[data-action="set-cap-year"]')
        ).map(b => b.getAttribute('data-cap-year'));

        // Check baseline 2026 simulator table
        const simHeaders = Array.from(document.querySelectorAll('#capSimulatorCard table thead th')).map(th =>
          th.textContent.trim()
        );
        const rows2026 = document.querySelectorAll('#capSimulatorCard table tbody tr');
        const firstDeadNominal = rows2026[0]?.querySelector('[data-col="dead-money"]')?.textContent?.trim();
        const firstSaveNominal = rows2026[0]?.querySelector('[data-col="cap-savings"]')?.textContent?.trim();

        // Select Post-June 1 Cut on Brock Purdy (row 0) & verify OTC Dead Money ($66,213,530) & Cap Savings (($42,504,000))
        const purdySelect = rows2026[0]?.querySelector('.gm-move-select');
        purdySelect.value = 'june_1_cut';
        purdySelect.dispatchEvent(new Event('change', { bubbles: true }));
        const rowsAfterMove = document.querySelectorAll('#capSimulatorCard table tbody tr');
        const purdyDeadAfter = rowsAfterMove[0]?.querySelector('[data-col="dead-money"]')?.textContent?.trim();
        const purdySaveAfter = rowsAfterMove[0]?.querySelector('[data-col="cap-savings"]')?.textContent?.trim();
        document.querySelector('[data-action="reset-cap-moves"]')?.click();

        // Switch across all 5 years (2026..2030) and verify each renders its summary & simulator rows cleanly
        const countsByYear = {};
        for (const yr of ['2026', '2027', '2028', '2029', '2030']) {
          document.querySelector(`#capSimulatorCard [data-action="set-cap-year"][data-cap-year="${yr}"]`)?.click();
          countsByYear[yr] = {
            rows: document.querySelectorAll('#capSimulatorCard table tbody tr').length,
            summaryTitle: document.querySelector('#capHorizonSummaryCard .card-title')?.textContent?.trim() || '',
            hasNoNaN: !document.getElementById('mainView').textContent.includes('NaN')
          };
        }
        // Return to 2026
        document.querySelector('#capSimulatorCard [data-action="set-cap-year"][data-cap-year="2026"]')?.click();

        return {
          bannerStates,
          heroPlayerAvatars,
          oppHasParity,
          tradeHasBucknerOnly,
          archiveHasOsa,
          jargonTermsFound,
          jargonPopInfo,
          yearTabButtons,
          simHeaders,
          rows2026Count: rows2026.length,
          firstDeadNominal,
          firstSaveNominal,
          purdyDeadAfter,
          purdySaveAfter,
          countsByYear
        };
      });

      // Assert #1: Trade banner exclusivity
      for (const [k, v] of Object.entries(upgradesAudit.bannerStates)) {
        if (k === 'season:trade') {
          assert(
            v.hidden === false && v.display !== 'none' && v.text.includes('Active NFL Trade Window'),
            `Expected Active NFL Trade Window banner visible in season:trade, got ${JSON.stringify(v)}`
          );
        } else {
          assert(
            v.hidden === true && v.display === 'none',
            `Expected Active NFL Trade Window banner hidden in ${k}, got ${JSON.stringify(v)}`
          );
        }
      }

      // Assert #5A & #5B
      assert(upgradesAudit.heroPlayerAvatars === 0, `Expected 0 player avatars in Upcoming Matchup hero box, got ${upgradesAudit.heroPlayerAvatars}`);
      assert(upgradesAudit.oppHasParity, 'Opponent Health section missing parity metrics (Availability Index, Starters Cleared, Maxx Crosby, 4-Game IR Tracker)');

      // Assert #6
      assert(upgradesAudit.tradeHasBucknerOnly, 'Trade Window Completed Impact Acquisitions failed 30-day filter');
      assert(upgradesAudit.archiveHasOsa, 'Archive missing older (>30d) trade Osa Odighizuwa');

      // Assert #2
      assert(upgradesAudit.jargonTermsFound >= 5, `Expected >=5 subtle jargon links on News view, got ${upgradesAudit.jargonTermsFound}`);
      assert(
        upgradesAudit.jargonPopInfo.opened &&
          upgradesAudit.jargonPopInfo.withinLeft &&
          upgradesAudit.jargonPopInfo.withinRight &&
          upgradesAudit.jargonPopInfo.withinTop &&
          upgradesAudit.jargonPopInfo.withinBottom &&
          upgradesAudit.jargonPopInfo.closedCleanly,
        `Jargon popover failed bounds/lifecycle check: ${JSON.stringify(upgradesAudit.jargonPopInfo)}`
      );

      // Assert #3, #4A, #4B
      assert(
        JSON.stringify(upgradesAudit.yearTabButtons) === JSON.stringify(['2026', '2027', '2028', '2029', '2030']),
        `Expected 5 cap year tabs (2026..2030), got ${JSON.stringify(upgradesAudit.yearTabButtons)}`
      );
      assert(
        JSON.stringify(upgradesAudit.simHeaders) ===
          JSON.stringify([
            'Player',
            'Base Salary',
            'Prorated Bonuses',
            'Current Yr Bonuses',
            'Guaranteed Salary',
            'Cap Number',
            'Roster Move',
            'Dead Money',
            'Cap Savings'
          ]),
        `Unexpected Simulator headers: ${JSON.stringify(upgradesAudit.simHeaders)}`
      );
      assert(upgradesAudit.rows2026Count === 53, `Expected all 53 active roster players in 2026 simulator, got ${upgradesAudit.rows2026Count}`);
      assert(
        upgradesAudit.firstDeadNominal === '$0' && upgradesAudit.firstSaveNominal === '$0',
        `Expected nominal $0 / $0 Dead Money & Cap Savings when doing nothing, got ${upgradesAudit.firstDeadNominal} / ${upgradesAudit.firstSaveNominal}`
      );
      assert(
        upgradesAudit.purdyDeadAfter === '$66,213,530' && upgradesAudit.purdySaveAfter === '($42,504,000)',
        `Purdy Post-June 1 Cut simulator mismatch: dead=${upgradesAudit.purdyDeadAfter}, save=${upgradesAudit.purdySaveAfter}`
      );
      for (const yr of ['2026', '2027', '2028', '2029', '2030']) {
        const info = upgradesAudit.countsByYear[yr];
        assert(
          info.rows >= 15 && info.summaryTitle.includes(yr) && info.hasNoNaN,
          `Year ${yr} cap summary/simulator check failed: ${JSON.stringify(info)}`
        );
      }
      await cdp.assertNoOverflow('Upgrades Verification');
    });

    console.log('\n=== [9/9] Multi-Viewport Responsive Overflow Sweep & Zero Runtime Error Audit ===');

    const viewports = [
      { name: 'Ultra-Narrow Mobile (320x640)', w: 320, h: 640, mobile: true, dpr: 2 },
      { name: 'Compact Mobile (360x780)', w: 360, h: 780, mobile: true, dpr: 3 },
      { name: 'iPhone SE / Small Mobile (375x667)', w: 375, h: 667, mobile: true, dpr: 2 },
      { name: 'iPhone 16 Pro Portrait (402x874)', w: 402, h: 874, mobile: true, dpr: 3 },
      { name: 'iPhone 16 Pro Max (430x932)', w: 430, h: 932, mobile: true, dpr: 3 },
      { name: 'iPhone 16 Pro Landscape (874x402)', w: 874, h: 402, mobile: true, dpr: 3 },
      { name: 'iPad / Tablet (768x1024)', w: 768, h: 1024, mobile: false, dpr: 2 },
      { name: 'Desktop Widescreen (1280x900)', w: 1280, h: 900, mobile: false, dpr: 2 }
    ];

    for (const vp of viewports) {
      await runStep(`Zero horizontal overflow across all 5 primary tabs at ${vp.name}`, async () => {
        await cdp.setViewport(vp.w, vp.h, vp.mobile, vp.dpr);
        for (const tab of ['home', 'news', 'roster', 'season', 'audio']) {
          await cdp.eval(t => document.querySelector(`[data-nav-tab="${t}"]`).click(), tab);
          await cdp.assertNoOverflow(`${vp.name} -> ${tab}`);
        }
      });
    }

    await runStep('iPhone 16 Pro UX Geometry: Landscape Cap Table shows all 9 columns without scrolling; Portrait News header & Dossier tabs stay compact', async () => {
      // 1. iPhone 16 Pro Landscape (874x402) & iPhone 16 Landscape (852x393): All 9 Cap Simulator columns visible simultaneously
      for (const [lw, lh] of [[874, 402], [852, 393]]) {
        await cdp.setViewport(lw, lh, true, 3);
        const capGeo = await cdp.eval(() => {
          document.querySelector('[data-nav-tab="roster"]').click();
          document.querySelector('[data-action="set-roster-sub"][data-roster-sub="cap"]').click();
          const simScroll = document.querySelector('#capSimulatorCard .table-scroll');
          const sumScroll = document.querySelector('#capHorizonSummaryCard .table-scroll');
          const thRects = Array.from(document.querySelectorAll('#capSimulatorCard table.cap-sim-table thead th')).map(th => {
            const r = th.getBoundingClientRect();
            return { text: th.textContent.trim(), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) };
          });
          return {
            vw: window.innerWidth,
            thCount: thRects.length,
            simClientW: simScroll.clientWidth,
            simScrollW: simScroll.scrollWidth,
            sumClientW: sumScroll.clientWidth,
            sumScrollW: sumScroll.scrollWidth,
            allThInViewport: thRects.every(t => t.w >= 45 && t.left >= 0 && t.right <= window.innerWidth + 1),
            thRects
          };
        });
        assert(
          capGeo.thCount === 9 &&
            capGeo.simScrollW <= capGeo.simClientW + 1 &&
            capGeo.sumScrollW <= capGeo.sumClientW + 1 &&
            capGeo.allThInViewport,
          `Cap table overflowed in ${lw}x${lh} landscape: ${JSON.stringify(capGeo)}`
        );
      }

      // 2. iPhone 16 Pro Portrait (402x874): News toolbar header compact (<68px) & Player Dossier pill-bar un-squished (>=30px)
      await cdp.setViewport(402, 874, true, 3);
      const portraitGeo = await cdp.eval(() => {
        document.querySelector('[data-nav-tab="news"]').click();
        const newsCard = document.querySelector('#mainView > .news-toolbar-card');
        const newsHead = newsCard?.querySelector('.news-toolbar-head');
        const newsCardH = Math.round(newsCard?.getBoundingClientRect()?.height || 999);
        const newsHeadH = Math.round(newsHead?.getBoundingClientRect()?.height || 999);

        document.querySelector('[data-nav-tab="roster"]').click();
        document.querySelector('[data-action="set-roster-sub"][data-roster-sub="roster"]').click();
        document.querySelector('.player-row').click();
        const pillBarH = Math.round(document.querySelector('#sheetBody .pill-bar')?.getBoundingClientRect()?.height || 0);
        document.getElementById('closeSheetBtn').click();

        return { newsCardH, newsHeadH, pillBarH };
      });
      assert(
        portraitGeo.newsHeadH <= 68 && portraitGeo.newsCardH <= 180,
        `News toolbar header too tall on mobile portrait: ${JSON.stringify(portraitGeo)}`
      );
      assert(
        portraitGeo.pillBarH >= 30,
        `Player Dossier pill-bar squished on mobile portrait: ${JSON.stringify(portraitGeo)}`
      );
    });

    await runStep('UX Navigation & Layout Upgrades: Bottom Nav swap, Two-Cluster Season Bars (0px scroll), Trade Banner below bars & Single-Screen Portrait Team Stats', async () => {
      // Test across Compact Mobile (360x780), iPhone SE (375x667), iPhone 16 (393x852), and iPhone 16 Pro (402x874)
      const portraitViewports = [
        { name: 'Compact 360x780', w: 360, h: 780 },
        { name: 'iPhone SE 375x667', w: 375, h: 667 },
        { name: 'iPhone 16 393x852', w: 393, h: 852 },
        { name: 'iPhone 16 Pro 402x874', w: 402, h: 874 }
      ];

      for (const vp of portraitViewports) {
        await cdp.setViewport(vp.w, vp.h, true, 3);

        const audit = await cdp.eval(() => {
          window.scrollTo({ top: 0, behavior: 'instant' });

          // 1. Bottom Nav tab order & visual left-to-right X positions
          const navBtns = Array.from(document.querySelectorAll('.bottom-nav .nav-tab-btn'));
          const navTabs = navBtns.map(b => b.getAttribute('data-nav-tab'));
          const navX = navBtns.map(b => Math.round(b.getBoundingClientRect().left));

          // 2. Navigate to Game & Season and inspect Two-Cluster Bars
          document.querySelector('[data-nav-tab="season"]').click();
          window.scrollTo({ top: 0, behavior: 'instant' });

          const clusterBars = Array.from(document.querySelectorAll('.season-subnav-card .season-cluster-bar'));
          const barDetails = clusterBars.map(bar => {
            const r = bar.getBoundingClientRect();
            const btns = Array.from(bar.querySelectorAll('.season-tab-btn'));
            return {
              clusterId: bar.getAttribute('data-season-cluster'),
              top: Math.round(r.top),
              bottom: Math.round(r.bottom),
              clientW: bar.clientWidth,
              scrollW: bar.scrollWidth,
              keys: btns.map(b => b.getAttribute('data-season-sub')),
              labels: btns.map(b => b.querySelector('span')?.textContent?.trim() || ''),
              allBtnsVisibleInViewport: btns.every(b => {
                const br = b.getBoundingClientRect();
                return br.width >= 42 && br.left >= 0 && br.right <= window.innerWidth + 1;
              })
            };
          });

          // 3. Switch to Trade sub-tab & verify Active NFL Trade Window (#phaseBanner) is BELOW .season-subnav-card and ABOVE .card.temporal-highlight
          document.querySelector('[data-action="set-season-sub"][data-season-sub="trade"]').click();
          window.scrollTo({ top: 0, behavior: 'instant' });
          const subnavRect = document.querySelector('.season-subnav-card')?.getBoundingClientRect();
          const bannerEl = document.getElementById('phaseBanner');
          const tradeBannerHidden = Boolean(bannerEl?.hidden);
          const bannerRect = bannerEl?.getBoundingClientRect();
          const tradeCardRect = document.querySelector('#mainView > section.card.temporal-highlight')?.getBoundingClientRect();
          const tradeLiveDot = Boolean(
            document.querySelector('[data-action="set-season-sub"][data-season-sub="trade"] .season-live-dot')
          );

          // 4. Switch to Stats sub-tab & verify 4 stacked unit cards (Offense, Defense, Special Teams, Margin), Category column hidden, and zero horizontal scroll
          document.querySelector('[data-action="set-season-sub"][data-season-sub="stats"]').click();
          window.scrollTo({ top: 0, behavior: 'instant' });
          const unitCards = Array.from(document.querySelectorAll('#mainView section[data-team-stats-unit]'));
          const unitIds = unitCards.map(c => c.getAttribute('data-team-stats-unit'));
          const statsCard = document.getElementById('teamStatsRankingsCard');
          const statsScrolls = Array.from(document.querySelectorAll('#mainView section[data-team-stats-unit] .table-scroll'));
          const statsTable = statsCard?.querySelector('table.team-stats-table');
          const statsHeaders = Array.from(statsTable?.querySelectorAll('thead th') || []).map(th =>
            th.textContent.trim()
          );
          const statsCardText = unitCards.map(c => c.textContent || '').join(' ');

          return {
            navTabs,
            navStrictlyLeftToRight: navX.every((x, idx) => idx === 0 || x > navX[idx - 1]),
            barDetails,
            tradeBannerGeo: {
              hidden: tradeBannerHidden,
              subnavBottom: Math.round(subnavRect?.bottom || 0),
              bannerTop: Math.round(bannerRect?.top || 0),
              bannerBottom: Math.round(bannerRect?.bottom || 0),
              tradeCardTop: Math.round(tradeCardRect?.top || 0),
              tradeLiveDot
            },
            statsGeo: {
              unitIds,
              headers: statsHeaders,
              hasCategoryText:
                statsCardText.includes('Advanced Offense') ||
                statsCardText.includes('Standard Offense') ||
                statsCardText.includes('Standard Defense'),
              anyTableOverflow: statsScrolls.some(sc => sc.scrollWidth > sc.clientWidth + 1)
            }
          };
        });

        // Assert #1: Swapped Game & Season and Roster & Cap icons in bottom bar
        assert(
          JSON.stringify(audit.navTabs) === JSON.stringify(['home', 'news', 'season', 'roster', 'audio']) &&
            audit.navStrictlyLeftToRight,
          `[${vp.name}] Bottom nav order mismatch: ${JSON.stringify(audit.navTabs)}`
        );

        // Assert #2 & #5: Two-bar clustered Game & Season navigation with swapped Stats/Trade, shortened labels & 0px scroll
        assert(audit.barDetails.length === 2, `[${vp.name}] Expected 2 season cluster bars, got ${audit.barDetails.length}`);
        assert(
          JSON.stringify(audit.barDetails[0].keys) === JSON.stringify(['matchup', 'health', 'schedule', 'stats']) &&
            JSON.stringify(audit.barDetails[0].labels) === JSON.stringify(['Matchup', 'Health', 'Schedule', 'Stats']),
          `[${vp.name}] Cluster Bar 1 mismatch: ${JSON.stringify(audit.barDetails[0])}`
        );
        assert(
          JSON.stringify(audit.barDetails[1].keys) === JSON.stringify(['trade', 'playoffs', 'draft_prep', 'draft_class']) &&
            JSON.stringify(audit.barDetails[1].labels) === JSON.stringify(['Trade', 'Playoffs', 'Draft', 'Draft Recap']),
          `[${vp.name}] Cluster Bar 2 mismatch: ${JSON.stringify(audit.barDetails[1])}`
        );
        assert(
          audit.barDetails[0].bottom <= audit.barDetails[1].top + 1,
          `[${vp.name}] Cluster Bar 1 should stack cleanly above Cluster Bar 2: ${JSON.stringify(audit.barDetails)}`
        );
        for (const bar of audit.barDetails) {
          assert(
            bar.scrollW <= bar.clientW + 1 && bar.allBtnsVisibleInViewport,
            `[${vp.name}] Cluster bar ${bar.clusterId} overflowed horizontally: ${JSON.stringify(bar)}`
          );
        }

        // Assert #4: Active NFL Trade Window block positioned BELOW the Game & Season navigation bars and ABOVE Trade Window card
        assert(
          audit.tradeBannerGeo.hidden === false &&
            audit.tradeBannerGeo.bannerTop >= audit.tradeBannerGeo.subnavBottom &&
            audit.tradeBannerGeo.bannerBottom <= audit.tradeBannerGeo.tradeCardTop &&
            audit.tradeBannerGeo.tradeLiveDot,
          `[${vp.name}] Active NFL Trade Window banner placement wrong: ${JSON.stringify(audit.tradeBannerGeo)}`
        );

        // Assert #3: 4 stacked unit cards (Offense -> Defense -> Special Teams -> Margin), Category column hidden, and zero horizontal overflow!
        assert(
          JSON.stringify(audit.statsGeo.unitIds) === JSON.stringify(['offense', 'defense', 'special_teams', 'margin']) &&
            JSON.stringify(audit.statsGeo.headers) === JSON.stringify(['Metric', '49ers', 'Rank', 'NFL Avg']) &&
            !audit.statsGeo.hasCategoryText,
          `[${vp.name}] Team Stats 4-unit order/columns mismatch: ${JSON.stringify(audit.statsGeo)}`
        );
        assert(
          !audit.statsGeo.anyTableOverflow,
          `[${vp.name}] Team Stats table overflowed horizontally in portrait: ${JSON.stringify(audit.statsGeo)}`
        );
      }
    });

    await runStep('Live X-Beat Multi-Source Telemetry, Live X Search Strip & X-First Reporter Links', async () => {
      await cdp.setViewport(402, 874, true);
      const xAudit = await cdp.eval(() => {
        const cfg = window.__49ersDiagnostics?.getLiveWireConfig?.() || {};
        document.querySelector('.nav-tab-btn[data-nav-tab="news"]')?.click();
        const strip = document.querySelector('.x-beat-launch-strip');
        const stripLinks = Array.from(strip?.querySelectorAll('a.x-beat-chip') || []).map(a => ({
          label: a.textContent.trim(),
          href: a.getAttribute('href') || ''
        }));
        const headH = Math.round(document.querySelector('.news-toolbar-head')?.getBoundingClientRect().height || 0);
        const cardH = Math.round(document.querySelector('.news-toolbar-card')?.getBoundingClientRect().height || 0);

        // Open Settings and verify X-first reporter links + Trust Tier badges
        document.getElementById('openSettingsBtn')?.click();
        const sheetBody = document.getElementById('sheetBody');
        const repAnchorHrefs = Array.from(sheetBody?.querySelectorAll('label a[href]') || [])
          .map(a => a.getAttribute('href') || '')
          .slice(0, 8);
        const hasTierBadges = (sheetBody?.textContent || '').includes('Tier 1 Trusted');
        document.getElementById('closeSheetBtn')?.click();

        // Open Roster -> first player dossier -> verify Live X Beat link chip
        document.querySelector('.nav-tab-btn[data-nav-tab="roster"]')?.click();
        document.querySelector('.player-row')?.click();
        const dossierLinks = Array.from(document.querySelectorAll('#sheetBody .source-link-strip a.source-chip-link')).map(a => ({
          label: a.textContent.trim(),
          href: a.getAttribute('href') || ''
        }));
        document.getElementById('closeSheetBtn')?.click();
        document.querySelector('.nav-tab-btn[data-nav-tab="home"]')?.click();

        return { cfg, stripExists: Boolean(strip), stripLinks, headH, cardH, repAnchorHrefs, hasTierBadges, dossierLinks };
      });

      assert(
        Array.isArray(xAudit.cfg.sourcesPolled) && xAudit.cfg.sourcesPolled.length >= 5,
        `Expected >=5 live wire sources in diagnostics, got ${JSON.stringify(xAudit.cfg)}`
      );
      assert(
        xAudit.stripExists &&
          xAudit.stripLinks.length === 3 &&
          xAudit.stripLinks.every(l => l.href.startsWith('https://x.com/search?q=') && l.href.includes('f=live')),
        `Live X Search strip missing or invalid links: ${JSON.stringify(xAudit.stripLinks)}`
      );
      assert(
        xAudit.headH <= 68 && xAudit.cardH <= 180,
        `News toolbar compact geometry regressed: head=${xAudit.headH}px, card=${xAudit.cardH}px`
      );
      assert(
        xAudit.repAnchorHrefs.length >= 5 && xAudit.repAnchorHrefs.every(h => h.startsWith('https://x.com/')),
        `Expected X-first reporter links in Settings, got ${JSON.stringify(xAudit.repAnchorHrefs)}`
      );
      assert(xAudit.hasTierBadges, 'Expected Tier 1 Trusted badges in Settings reporter directory');
      assert(
        xAudit.dossierLinks.some(l => l.label.includes('Live X Beat') && l.href.startsWith('https://x.com/search?q=')),
        `Expected Live X Beat link chip in Player Dossier, got ${JSON.stringify(xAudit.dossierLinks)}`
      );
      await cdp.assertNoOverflow('Live X-Beat Telemetry & Search Strip Audit');
    });

    await runStep('Game-Day Roster [T-90m, Final), Frozen Col 1, Narrow Opponent Health, Questionable->In/Out, Post-Game Blank W/T/F, Single-Attribution Wire & Clutter Scrub', async () => {
      await cdp.setViewport(360, 780, true, 3);

      // 1. Sticky Col 1 + Narrow Opponent Table + Post-Game Week Rollover Blank W/T/F Audit
      const tableAndRolloverAudit = await cdp.eval(() => {
        document.querySelector('[data-nav-tab="season"]').click();
        document.querySelector('[data-action="set-season-sub"][data-season-sub="health"]').click();
        const sfWrap = document.querySelector('[data-health-table="sf"]');
        const sfTable = sfWrap?.querySelector('table');
        const sfTh = sfTable?.querySelector('thead th.sticky-first-col');
        const sfTd = sfTable?.querySelector('tbody td.sticky-first-col');
        const sfThStyle = sfTh ? window.getComputedStyle(sfTh) : null;
        const sfTdStyle = sfTd ? window.getComputedStyle(sfTd) : null;
        const sfSticky =
          sfThStyle?.position === 'sticky' && sfTdStyle?.position === 'sticky' && sfThStyle?.left === '0px';
        const sfWidth = Math.round(sfTable?.scrollWidth || 0);
        const sfBeforeLeft = Math.round(sfTd?.getBoundingClientRect().left || 0);
        if (sfWrap) sfWrap.scrollLeft = 60;
        const sfAfterLeft = Math.round(sfTd?.getBoundingClientRect().left || 0);
        if (sfWrap) sfWrap.scrollLeft = 0;
        const sfNoGamedayOutsideWindow = !document.querySelector('[data-gameday-roster-block="sf"]');
        const sfPracCells = Array.from(sfTable?.querySelectorAll('tbody tr td:nth-child(3)') || []).map(c =>
          c.textContent.trim()
        );

        document.querySelector('[data-action="set-season-sub"][data-season-sub="matchup"]').click();
        const oppWrap = document.querySelector('[data-health-table="opp"]');
        const oppTable = oppWrap?.querySelector('table');
        const oppTh = oppTable?.querySelector('thead th.sticky-first-col');
        const oppTd = oppTable?.querySelector('tbody td.sticky-first-col');
        const oppThStyle = oppTh ? window.getComputedStyle(oppTh) : null;
        const oppTdStyle = oppTd ? window.getComputedStyle(oppTd) : null;
        const oppSticky =
          oppThStyle?.position === 'sticky' && oppTdStyle?.position === 'sticky' && oppThStyle?.left === '0px';
        const oppWidth = Math.round(oppTable?.scrollWidth || 0);
        const oppSubLines = Array.from(oppTable?.querySelectorAll('.sticky-player-sub') || []).map(el =>
          el.textContent.trim()
        );
        const oppNoGamedayOutsideWindow = !document.querySelector('[data-gameday-roster-block="opp"]');
        const oppPracCells = Array.from(oppTable?.querySelectorAll('tbody tr td:nth-child(3)') || []).map(c =>
          c.textContent.trim()
        );

        const kickoffIso = window.__49ersDiagnostics.getState().appData.scheduleMatchup.upcomingMatchup.kickoffIso || '';
        const hoursUntilKo = (Date.parse(kickoffIso) - Date.now()) / 3600_000;
        const isEarlyWeek = hoursUntilKo > 98;

        return {
          sfSticky,
          oppSticky,
          sfPinnedDuringScroll: Math.abs(sfAfterLeft - sfBeforeLeft) <= 1,
          sfWidth,
          oppWidth,
          widthDelta: Math.abs(oppWidth - sfWidth),
          oppHasPosAndImportance:
            oppSubLines.length > 0 && oppSubLines.every(s => /•\s*(Starter|Rotation|Depth|\d+% snaps)/.test(s)),
          sfNoGamedayOutsideWindow,
          oppNoGamedayOutsideWindow,
          isEarlyWeek,
          sfPracCells,
          oppPracCells
        };
      });

      assert(tableAndRolloverAudit.sfSticky, `49ers Team Health Col 1 must be position: sticky; left: 0px (got ${JSON.stringify(tableAndRolloverAudit)})`);
      assert(tableAndRolloverAudit.oppSticky, 'Opponent Matchup Health Col 1 must be position: sticky; left: 0px');
      assert(tableAndRolloverAudit.sfPinnedDuringScroll, 'Col 1 must stay frozen horizontally when scrolling right');
      assert(
        tableAndRolloverAudit.oppWidth <= 500 && tableAndRolloverAudit.widthDelta <= 60,
        `Opponent table width (${tableAndRolloverAudit.oppWidth}px) should closely match 49ers Health (${tableAndRolloverAudit.sfWidth}px)`
      );
      assert(
        tableAndRolloverAudit.oppHasPosAndImportance,
        'Opponent table must show position + importance (Starter/Rotation/Snap%) under player name'
      );
      assert(
        tableAndRolloverAudit.sfNoGamedayOutsideWindow && tableAndRolloverAudit.oppNoGamedayOutsideWindow,
        'Game-Day Roster blocks must NOT appear outside [T-90m, Final)'
      );
      if (tableAndRolloverAudit.isEarlyWeek) {
        assert(
          tableAndRolloverAudit.sfPracCells.every(c => c === '— / — / —') &&
            tableAndRolloverAudit.oppPracCells.every(c => c === '— / — / —'),
          `Post-game upcoming week rollover must render blank — / — / — W/T/F columns, got SF=${JSON.stringify(tableAndRolloverAudit.sfPracCells)}, OPP=${JSON.stringify(tableAndRolloverAudit.oppPracCells)}`
        );
      }

      // 2. Simulate Game-Day [T-90m, Final) Window (T-45m with official inactives declared -> then Final)
      const gameDayLifecycleAudit = await cdp.eval(() => {
        const st = window.__49ersDiagnostics.getState();
        const sm = st.appData.scheduleMatchup;
        const nextGame = sm.schedule.find(g => !g.completed);
        const savedDateIso = nextGame.dateIso;
        const savedUmKickoff = sm.upcomingMatchup.kickoffIso;
        const savedLiveGameDay = st.appData.liveGameDay;

        try {
          const koIn45m = new Date(Date.now() + 45 * 60_000).toISOString();
          nextGame.dateIso = koIn45m;
          sm.upcomingMatchup.kickoffIso = koIn45m;
          st.appData.liveGameDay = {
            sf: {
              officialPosted: true,
              inactives: [
                { name: 'Deebo Samuel Sr.', position: 'WR', jersey: 19, reason: 'Hamstring' },
                { name: 'Mike Evans', position: 'WR', jersey: 5, reason: 'Ribs, Achilles' },
                { name: 'Siran Neal', position: 'S', jersey: 33, reason: 'Knee' },
                { name: 'Jordan James', position: 'RB', jersey: 28, reason: 'Healthy Scratch' },
                { name: 'Spencer Burford', position: 'OL', jersey: 74, reason: 'Healthy Scratch' }
              ]
            },
            opp: {
              officialPosted: true,
              inactives: [
                { name: 'Luke Schoonmaker', position: 'TE', jersey: 86, reason: 'Groin' },
                { name: 'Tyrus Wheat', position: 'LB', jersey: 59, reason: 'Healthy Scratch' },
                { name: 'Ajani Cornelius', position: 'OT', jersey: 77, reason: 'Healthy Scratch' },
                { name: 'Camden Brown', position: 'WR', jersey: 81, reason: 'Healthy Scratch' },
                { name: 'Jordan Hudson', position: 'WR', jersey: 84, reason: 'Healthy Scratch' }
              ]
            }
          };

          // Check Niners Team Health at T-45m
          document.querySelector('[data-action="set-season-sub"][data-season-sub="health"]').click();
          const sfBlock = document.querySelector('[data-gameday-roster-block="sf"]');
          const sfDetails = sfBlock?.querySelector('details[data-gameday-active-roster]');
          const sfStartedCollapsed = sfDetails ? sfDetails.open === false : false;
          const sfUnits = Array.from(sfBlock?.querySelectorAll('[data-gameday-unit]') || []).map(u =>
            u.getAttribute('data-gameday-unit')
          );
          const sfActiveChips = sfBlock?.querySelectorAll('.gameday-active-chip').length || 0;
          const sfInactiveChips = sfBlock?.querySelectorAll('.gameday-inactive-chip').length || 0;
          if (sfDetails) sfDetails.open = true;
          const sfExpandedOk = Boolean(sfDetails?.open);
          const sfBadges = Array.from(
            document.querySelectorAll('[data-health-table="sf"] tbody td:nth-child(4) .badge')
          ).map(b => b.textContent.trim());
          const sfZeroStaleQuestionable = sfBadges.every(
            b => b.includes('In (Active)') || b.includes('Out (Inactive)') || b === 'Active • GTD'
          );

          // Check Matchup Opponent Block at T-45m (directly above Opponent Practice Participation table!)
          document.querySelector('[data-action="set-season-sub"][data-season-sub="matchup"]').click();
          const oppBlock = document.querySelector('[data-gameday-roster-block="opp"]');
          const oppTableWrap = document.querySelector('[data-health-table="opp"]');
          const oppAboveTable =
            Boolean(oppBlock && oppTableWrap) &&
            oppBlock.getBoundingClientRect().bottom <= oppTableWrap.getBoundingClientRect().top + 32;
          const oppDetails = oppBlock?.querySelector('details[data-gameday-active-roster]');
          const oppStartedCollapsed = oppDetails ? oppDetails.open === false : false;
          const oppUnits = Array.from(oppBlock?.querySelectorAll('[data-gameday-unit]') || []).map(u =>
            u.getAttribute('data-gameday-unit')
          );
          const oppActiveChips = oppBlock?.querySelectorAll('.gameday-active-chip').length || 0;
          const oppBadges = Array.from(
            document.querySelectorAll('[data-health-table="opp"] tbody td:nth-child(4) .badge')
          ).map(b => b.textContent.trim());
          const oppZeroStaleQuestionable = oppBadges.every(
            b => b.includes('In (Active)') || b.includes('Out (Inactive)') || b === 'Active • GTD'
          );

          // Now mark game Final (completed = true) -> both blocks must immediately disappear!
          nextGame.completed = true;
          document.querySelector('[data-action="set-season-sub"][data-season-sub="health"]').click();
          const sfGoneAfterFinal = !document.querySelector('[data-gameday-roster-block="sf"]');
          document.querySelector('[data-action="set-season-sub"][data-season-sub="matchup"]').click();
          const oppGoneAfterFinal = !document.querySelector('[data-gameday-roster-block="opp"]');

          return {
            sfBlockExists: Boolean(sfBlock),
            sfStartedCollapsed,
            sfExpandedOk,
            sfUnits,
            sfActiveChips,
            sfInactiveChips,
            sfZeroStaleQuestionable,
            oppBlockExists: Boolean(oppBlock),
            oppAboveTable,
            oppStartedCollapsed,
            oppUnits,
            oppActiveChips,
            oppZeroStaleQuestionable,
            sfGoneAfterFinal,
            oppGoneAfterFinal
          };
        } finally {
          nextGame.completed = false;
          nextGame.dateIso = savedDateIso;
          sm.upcomingMatchup.kickoffIso = savedUmKickoff;
          st.appData.liveGameDay = savedLiveGameDay;
          window.__49ersDiagnostics.forceRender();
        }
      });

      assert(
        gameDayLifecycleAudit.sfBlockExists &&
          gameDayLifecycleAudit.sfStartedCollapsed &&
          gameDayLifecycleAudit.sfExpandedOk &&
          JSON.stringify(gameDayLifecycleAudit.sfUnits) === JSON.stringify(['Offense', 'Defense', 'Special Teams']) &&
          gameDayLifecycleAudit.sfActiveChips >= 40 &&
          gameDayLifecycleAudit.sfInactiveChips >= 5 &&
          gameDayLifecycleAudit.sfZeroStaleQuestionable,
        `49ers Game-Day Roster lifecycle failed: ${JSON.stringify(gameDayLifecycleAudit)}`
      );
      assert(
        gameDayLifecycleAudit.oppBlockExists &&
          gameDayLifecycleAudit.oppAboveTable &&
          gameDayLifecycleAudit.oppStartedCollapsed &&
          JSON.stringify(gameDayLifecycleAudit.oppUnits) === JSON.stringify(['Offense', 'Defense', 'Special Teams']) &&
          gameDayLifecycleAudit.oppActiveChips >= 40 &&
          gameDayLifecycleAudit.oppZeroStaleQuestionable,
        `Opponent Game-Day Roster lifecycle failed: ${JSON.stringify(gameDayLifecycleAudit)}`
      );
      assert(
        gameDayLifecycleAudit.sfGoneAfterFinal && gameDayLifecycleAudit.oppGoneAfterFinal,
        'Both Game-Day Roster blocks must disappear immediately upon game completion'
      );
      await cdp.assertNoOverflow('Game-Day Roster Lifecycle & Narrow Health Tables (360px)');

      // 3. Single-Attribution Wire Cards & Site-Wide Clutter Scrub Audit
      const wireAndClutterAudit = await cdp.eval(() => {
        document.querySelector('[data-nav-tab="news"]').click();
        document.querySelector('[data-action="set-news-mode"][data-mode="raw"]')?.click();
        document.querySelector('[data-action="set-news-category"][data-category="tweets"]')?.click();

        const tweetCards = Array.from(document.querySelectorAll('#mainView .brief-card'));
        const hasAuthorLinks = tweetCards.every(c => Boolean(c.querySelector('[data-wire-author-link]')));
        const hasRelativeAges = tweetCards.every(c => Boolean(c.querySelector('[data-wire-age]')));
        const leakedTweetHandlePills = tweetCards.filter(c => /Tweet\s*•\s*@/i.test(c.textContent || '')).length;
        const leakedSelfProfileLinks = tweetCards.filter(c => /Linked Story:.*\bon X/i.test(c.textContent || '')).length;
        const leakedEspnPlayerBioTweetLinks = tweetCards.filter(c => {
          const bodyAnchor = c.querySelectorAll('a[href]')[1];
          return /espn\.com\/nfl\/player\//i.test(bodyAnchor?.getAttribute('href') || '');
        }).length;
        document.querySelector('[data-action="set-news-category"][data-category="all"]')?.click();

        // Scrub check across all 5 main tabs
        const excessPhrases = [];
        for (const tab of ['home', 'news', 'season', 'roster', 'audio']) {
          document.querySelector(`[data-nav-tab="${tab}"]`).click();
          const txt = document.getElementById('mainView')?.textContent || '';
          if (/created with gemini|live ai connected|notebooklm voices|using gemini 3\.8/i.test(txt)) {
            excessPhrases.push(tab);
          }
        }

        // Verify Host Format & Default Podcast Duration live inside Settings
        document.getElementById('openSettingsBtn').click();
        const sheetTxt = document.getElementById('sheetBody')?.textContent || '';
        const hasSettingsHostFormat = Boolean(document.querySelector('#sheetBody [data-action="set-pod-format"]'));
        const hasSettingsDurationSlider = Boolean(document.getElementById('prefPodDurationSlider'));
        document.getElementById('closeSheetBtn').click();

        // Verify "XX reports" clickable link on Home AND News -> Synthesis Briefs opens full clickable report sheet!
        document.querySelector('[data-nav-tab="home"]').click();
        const homeReportsBtn = document.querySelector('#mainView [data-action="open-synthesis-sources"]');
        const homeBtnMatch = (homeReportsBtn?.textContent || '').match(/(\d+)\s+report/i);
        const homeExpectedCount = homeBtnMatch ? Number(homeBtnMatch[1]) : -1;
        homeReportsBtn?.click();
        const homeSheetOpen = !document.getElementById('bottomSheetBackdrop').hidden;
        const homeSheetLinks = Array.from(document.querySelectorAll('#sheetBody a[data-synthesis-report-link]'));
        const homeAllHttpsNewTab = homeSheetLinks.every(
          a => (a.getAttribute('href') || '').startsWith('https://') && a.getAttribute('target') === '_blank'
        );
        document.getElementById('closeSheetBtn').click();

        document.querySelector('[data-nav-tab="news"]').click();
        document.querySelector('[data-action="set-news-mode"][data-mode="clustered"]')?.click();
        const newsReportsBtn = document.querySelector('#mainView [data-action="open-synthesis-sources"]');
        const newsBtnMatch = (newsReportsBtn?.textContent || '').match(/(\d+)\s+report/i);
        const newsExpectedCount = newsBtnMatch ? Number(newsBtnMatch[1]) : -1;
        newsReportsBtn?.click();
        const newsSheetOpen = !document.getElementById('bottomSheetBackdrop').hidden;
        const newsSheetLinksCount = document.querySelectorAll('#sheetBody a[data-synthesis-report-link]').length;
        document.getElementById('closeSheetBtn').click();
        document.querySelector('[data-action="set-news-mode"][data-mode="raw"]')?.click();

        return {
          tweetCount: tweetCards.length,
          hasAuthorLinks,
          hasRelativeAges,
          leakedTweetHandlePills,
          leakedSelfProfileLinks,
          leakedEspnPlayerBioTweetLinks,
          excessPhrases,
          hasSettingsHostFormat,
          hasSettingsDurationSlider,
          sheetHasPodcastSection: sheetTxt.includes('Custom Podcast Preferences'),
          homeSheetOpen,
          homeExpectedCount,
          homeActualCount: homeSheetLinks.length,
          homeAllHttpsNewTab,
          newsSheetOpen,
          newsExpectedCount,
          newsSheetLinksCount
        };
      });

      assert(
        wireAndClutterAudit.tweetCount >= 5 &&
          wireAndClutterAudit.hasAuthorLinks &&
          wireAndClutterAudit.hasRelativeAges &&
          wireAndClutterAudit.leakedTweetHandlePills === 0 &&
          wireAndClutterAudit.leakedSelfProfileLinks === 0 &&
          wireAndClutterAudit.leakedEspnPlayerBioTweetLinks === 0,
        `Tweet single-attribution & non-ESPN-bio link audit failed: ${JSON.stringify(wireAndClutterAudit)}`
      );
      assert(
        wireAndClutterAudit.excessPhrases.length === 0,
        `Found excess Gemini/NotebookLM clutter text on tabs: ${JSON.stringify(wireAndClutterAudit.excessPhrases)}`
      );
      assert(
        wireAndClutterAudit.hasSettingsHostFormat &&
          wireAndClutterAudit.hasSettingsDurationSlider &&
          wireAndClutterAudit.sheetHasPodcastSection,
        `Podcast Host Format / Default Duration missing in Settings: ${JSON.stringify(wireAndClutterAudit)}`
      );
      assert(
        wireAndClutterAudit.homeSheetOpen &&
          wireAndClutterAudit.homeExpectedCount >= 3 &&
          wireAndClutterAudit.homeActualCount === wireAndClutterAudit.homeExpectedCount &&
          wireAndClutterAudit.homeAllHttpsNewTab &&
          wireAndClutterAudit.newsSheetOpen &&
          wireAndClutterAudit.newsExpectedCount >= 3 &&
          wireAndClutterAudit.newsSheetLinksCount === wireAndClutterAudit.newsExpectedCount,
        `Clickable "XX reports" synthesis sources sheet audit failed: ${JSON.stringify(wireAndClutterAudit)}`
      );

      await cdp.setViewport(393, 852, true, 3);
    });

    await runStep('Site-wide rendered DOM link scrub across all 5 primary tabs, sub-views, and Player Dossier', async () => {
      const linkScrubResult = await cdp.eval(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const badLinks = [];
        let totalChecked = 0;

        function auditVisibleAnchors(viewLabel) {
          const anchors = [...document.querySelectorAll('#mainView a[href], #bottomSheetBackdrop:not([hidden]) a[href]')];
          for (const a of anchors) {
            const rawHref = (a.getAttribute('href') || '').trim();
            totalChecked++;
            if (!rawHref || rawHref === '#' || /(^|\/)(undefined|null|NaN)(\/|$|\?)/i.test(rawHref)) {
              badLinks.push(viewLabel + ': invalid href="' + rawHref + '" text="' + (a.textContent || '').trim().slice(0, 40) + '"');
              continue;
            }
            if (/^(podcasts|intent):\/\//i.test(rawHref)) continue;
            if (!/^https:\/\//i.test(rawHref)) {
              badLinks.push(viewLabel + ': non-HTTPS href="' + rawHref + '"');
              continue;
            }
            if (a.getAttribute('target') !== '_blank' || !(a.getAttribute('rel') || '').includes('noopener')) {
              badLinks.push(viewLabel + ': missing target=_blank/noopener on "' + rawHref + '"');
            }
            if (/news\.google\.com\/rss\/articles|dlvr\.it\/|bit\.ly\/|\/nfl\/draft2027\/?$|\/nfl\/story\/_\/page\/nflpowerrankings|utm_source=/i.test(rawHref)) {
              badLinks.push(viewLabel + ': uncleaned/dead/opaque URL "' + rawHref + '"');
            }
          }
        }

        // 1. Home
        document.querySelector('[data-nav-tab="home"]')?.click();
        await sleep(60);
        auditVisibleAnchors('home');

        // 2. News & Film (Wire & Video + Synthesis Briefs + Synthesis Sources Sheet)
        document.querySelector('[data-nav-tab="news"]')?.click();
        await sleep(60);
        auditVisibleAnchors('news:raw');
        const synthReportTriggers = [...document.querySelectorAll('[data-action="set-news-mode"][data-mode="clustered"]')];
        synthReportTriggers[0]?.click();
        await sleep(60);
        auditVisibleAnchors('news:clustered');
        document.querySelector('[data-action="open-synthesis-sources"]')?.click();
        await sleep(60);
        auditVisibleAnchors('news:sources-sheet');
        document.getElementById('closeSheetBtn')?.click();
        await sleep(40);

        // 3. Game & Season (all 8 sub-views)
        document.querySelector('[data-nav-tab="season"]')?.click();
        await sleep(60);
        for (const sub of ['matchup', 'health', 'schedule', 'stats', 'trade', 'playoffs', 'draft_prep', 'draft_class']) {
          document.querySelector('[data-action="set-season-sub"][data-season-sub="' + sub + '"]')?.click();
          await sleep(45);
          auditVisibleAnchors('season:' + sub);
        }

        // 4. Roster & Cap + Player Dossier 5 tabs
        document.querySelector('[data-nav-tab="roster"]')?.click();
        await sleep(60);
        for (const rmode of ['roster', 'depth', 'cap']) {
          document.querySelector('[data-action="set-roster-sub"][data-roster-sub="' + rmode + '"]')?.click();
          await sleep(45);
          auditVisibleAnchors('roster:' + rmode);
        }
        document.querySelector('[data-action="set-roster-sub"][data-roster-sub="roster"]')?.click();
        await sleep(45);
        document.querySelector('[data-action="open-player-sheet"]')?.click();
        await sleep(60);
        for (const ptab of ['overview', 'stats', 'spider', 'contract', 'health']) {
          document.querySelector('#sheetBody [data-action="set-player-tab"][data-player-tab="' + ptab + '"]')?.click();
          await sleep(35);
          auditVisibleAnchors('player:' + ptab);
        }
        document.getElementById('closeSheetBtn')?.click();
        await sleep(40);

        // 5. Audio & AI (Podcasts + Auto Pod + AI Analysis)
        document.querySelector('[data-nav-tab="audio"]')?.click();
        await sleep(60);
        for (const amode of ['beat_podcasts', 'podcast', 'analysis']) {
          document.querySelector('[data-action="set-studio-sub"][data-studio-sub="' + amode + '"]')?.click();
          await sleep(45);
          auditVisibleAnchors('audio:' + amode);
        }

        document.querySelector('[data-nav-tab="home"]')?.click();
        await sleep(40);
        return { totalChecked, badLinks };
      });

      assert(
        linkScrubResult.totalChecked >= 120 && linkScrubResult.badLinks.length === 0,
        `Site-wide DOM link scrub failed (checked=${linkScrubResult.totalChecked}): ${JSON.stringify(linkScrubResult.badLinks.slice(0, 10))}`
      );
    });

    await runStep('Exhaustive interactive click & link verification (jargon popovers, inline player links, Spider Comps, Combine, Dead Cap, H2H Box Scores & transcripts)', async () => {
      const clickAudit = await cdp.eval(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const nestedAnchors = [];
        const duplicateArticleChips = [];

        const scanCurrentDom = view => {
          for (const a of document.querySelectorAll('a[href]')) {
            if (a.parentElement?.closest('a')) {
              nestedAnchors.push({ view, href: a.getAttribute('href') });
            }
            const txt = (a.textContent || '').trim();
            if (a.classList.contains('source-chip-link') && txt.startsWith('Article:')) {
              const card = a.closest('.brief-card, .home-wire-item, .player-mention-card');
              if (card) {
                const others = [...card.querySelectorAll('a')].filter(
                  x => x !== a && !x.classList.contains('raw-item-thumb') && !x.hasAttribute('data-wire-author-link')
                );
                if (others.some(o => o.getAttribute('href') === a.getAttribute('href'))) {
                  duplicateArticleChips.push({ view, href: a.getAttribute('href') });
                }
              }
            }
          }
        };

        // 1. Home: Dead Cap tooltip + Scoreboard team links + Upcoming 4 Schedule KPI game links
        document.querySelector('[data-nav-tab="home"]')?.click();
        await sleep(45);
        scanCurrentDom('home');
        const homeDeadCapTrigger = document.querySelector('[data-dashboard-block="salary_cap"] [data-jargon="dead_money"]');
        homeDeadCapTrigger?.click();
        const pop = document.getElementById('jargonPopover');
        const homeDeadCapOpened = Boolean(pop && !pop.hidden && pop.textContent.includes('Dead Money'));
        document.querySelector('[data-action="close-jargon-popover"]')?.click();
        const homeScoreboardLinks = document.querySelectorAll('[data-dashboard-block="upcoming_matchup"] a.sb-team-col').length;
        const homeSchedGameLinks = document.querySelectorAll('[data-dashboard-block="schedule_overview"] a.kpi-box').length;

        // 2. News: Inline prose player link opens Player Dossier
        document.querySelector('[data-nav-tab="news"]')?.click();
        await sleep(45);
        scanCurrentDom('news:raw');
        document.querySelector('[data-action="set-news-mode"][data-mode="clustered"]')?.click();
        await sleep(45);
        scanCurrentDom('news:clustered');
        const inlinePlayerEl = document.querySelector('#mainView .inline-player-link[data-action="open-player-sheet"]');
        let inlinePlayerOpened = false;
        if (inlinePlayerEl) {
          inlinePlayerEl.click();
          await sleep(30);
          const backdrop = document.getElementById('bottomSheetBackdrop');
          const title = document.getElementById('sheetTitle')?.textContent?.trim() || '';
          inlinePlayerOpened = Boolean(backdrop && !backdrop.hidden && title && title !== 'Player Dossier');
          document.getElementById('closeSheetBtn')?.click();
          await sleep(25);
        }

        // 3. Season: H2H boxscores, Trade targets & pitfalls, NFC standings, Combine & UDFA triggers
        document.querySelector('[data-nav-tab="season"]')?.click();
        await sleep(45);
        document.querySelector('[data-action="set-season-sub"][data-season-sub="matchup"]')?.click();
        await sleep(40);
        scanCurrentDom('season:matchup');
        const h2hBoxscoreLinks = [...document.querySelectorAll('#mainView a.ext-link')].filter(a =>
          /espn\.com\/nfl\/game|pro-football-reference\.com\/boxscores/i.test(a.getAttribute('href') || '')
        ).length;

        document.querySelector('[data-action="set-season-sub"][data-season-sub="trade"]')?.click();
        await sleep(40);
        scanCurrentDom('season:trade');
        const tradePitfallLinks = [...document.querySelectorAll('#mainView a.ext-link')].filter(a =>
          /overthecap\.com\/player\//i.test(a.getAttribute('href') || '')
        ).length;

        document.querySelector('[data-action="set-season-sub"][data-season-sub="playoffs"]')?.click();
        await sleep(40);
        scanCurrentDom('season:playoffs');
        const nfcStandingsTeamLinks = document.querySelectorAll('#mainView table.data-table tbody td a.ext-link').length;

        document.querySelector('[data-action="set-season-sub"][data-season-sub="draft_prep"]')?.click();
        await sleep(40);
        scanCurrentDom('season:draft_prep');
        const combineLinks = document.querySelectorAll('#mainView table.data-table tbody td a.ext-link, #mainView table.data-table tbody td .inline-player-link').length;

        document.querySelector('[data-action="set-season-sub"][data-season-sub="draft_class"]')?.click();
        await sleep(40);
        scanCurrentDom('season:draft_class');
        const udfaTriggers = document.querySelectorAll('#mainView .inline-player-link[data-action="open-player-sheet"]').length;

        // 4. Roster & Cap: 11/21 personnel tooltips, Dead Cap player links & Spider Chart NFL Comp links
        document.querySelector('[data-nav-tab="roster"]')?.click();
        await sleep(45);
        document.querySelector('[data-action="set-roster-sub"][data-roster-sub="depth"]')?.click();
        await sleep(40);
        const p11Trigger = document.querySelector('#mainView [data-jargon="personnel_11"]');
        p11Trigger?.click();
        const p11Opened = Boolean(pop && !pop.hidden && pop.textContent.includes('11 Personnel'));
        document.querySelector('[data-action="close-jargon-popover"]')?.click();

        document.querySelector('[data-action="set-roster-sub"][data-roster-sub="cap"]')?.click();
        await sleep(40);
        scanCurrentDom('roster:cap');
        const deadCapPlayerLinks = document.querySelectorAll('#capHorizonSummaryCard .subcard-panel a.ext-link, #capHorizonSummaryCard .subcard-panel .inline-player-link').length;

        document.querySelector('[data-action="set-roster-sub"][data-roster-sub="roster"]')?.click();
        await sleep(40);
        document.querySelector('#mainView [data-action="open-player-sheet"]')?.click();
        await sleep(30);
        document.querySelector('#sheetBody [data-action="set-player-tab"][data-player-tab="spider"]')?.click();
        await sleep(30);
        scanCurrentDom('player:spider');
        const spiderCompInteractive = document.querySelectorAll('#sheetBody .spider-comps-grid a.spider-comp-chip, #sheetBody .spider-comps-grid button.spider-comp-chip').length;
        document.getElementById('closeSheetBtn')?.click();
        await sleep(25);

        // 5. Audio & AI: By-Podcast host links & Autopodcast transcript inline player + jargon links
        document.querySelector('[data-nav-tab="audio"]')?.click();
        await sleep(45);
        document.querySelector('[data-action="set-studio-sub"][data-studio-sub="beat_podcasts"]')?.click();
        await sleep(35);
        document.querySelector('[data-action="set-beat-pod-view"][data-pod-view="show"]')?.click();
        await sleep(35);
        scanCurrentDom('audio:beat_podcasts:show');
        const beatPodHostLinks = document.querySelectorAll('.beat-podcast-show-group .card-eyebrow a.ext-link').length;
        document.querySelector('[data-action="set-beat-pod-view"][data-pod-view="date"]')?.click();

        document.querySelector('[data-action="set-studio-sub"][data-studio-sub="podcast"]')?.click();
        await sleep(40);
        document.querySelector('#mainView [data-action="toggle-podcast-transcript"]')?.click();
        await sleep(35);
        scanCurrentDom('audio:podcast:transcript');
        const transcriptPlayerLinks = document.querySelectorAll('.podcast-transcript-drawer .inline-player-link').length;

        document.querySelector('[data-nav-tab="home"]')?.click();
        await sleep(35);

        return {
          nestedAnchors,
          duplicateArticleChips,
          homeDeadCapOpened,
          homeScoreboardLinks,
          homeSchedGameLinks,
          inlinePlayerOpened,
          h2hBoxscoreLinks,
          tradePitfallLinks,
          nfcStandingsTeamLinks,
          combineLinks,
          udfaTriggers,
          p11Opened,
          deadCapPlayerLinks,
          spiderCompInteractive,
          beatPodHostLinks,
          transcriptPlayerLinks
        };
      });

      assert(
        clickAudit.nestedAnchors.length === 0 &&
          clickAudit.duplicateArticleChips.length === 0 &&
          clickAudit.homeDeadCapOpened &&
          clickAudit.homeScoreboardLinks === 2 &&
          clickAudit.homeSchedGameLinks >= 1 &&
          clickAudit.inlinePlayerOpened &&
          clickAudit.h2hBoxscoreLinks >= 5 &&
          clickAudit.tradePitfallLinks >= 10 &&
          clickAudit.nfcStandingsTeamLinks === 16 &&
          clickAudit.combineLinks >= 20 &&
          clickAudit.udfaTriggers >= 5 &&
          clickAudit.p11Opened &&
          clickAudit.deadCapPlayerLinks >= 5 &&
          clickAudit.spiderCompInteractive >= 1 &&
          clickAudit.beatPodHostLinks >= 4 &&
          clickAudit.transcriptPlayerLinks >= 3,
        `Interactive click & link audit failed: ${JSON.stringify(clickAudit)}`
      );
    });

    await runStep('News mode filter reset, in-place touch-safe podcast duration slider, and Dark/Light sticky Column 1 opaque surface QA', async () => {
      const qaSweepCheck = await cdp.eval(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));

        // 1. News mode switch resets incompatible category filters so user never lands on an empty filter state
        document.querySelector('[data-nav-tab="news"]')?.click();
        await sleep(50);
        document.querySelector('[data-action="set-news-mode"][data-mode="clustered"]')?.click();
        await sleep(50);
        document.querySelector('[data-action="set-news-category"][data-category="cap"]')?.click();
        await sleep(50);
        document.querySelector('[data-action="set-news-mode"][data-mode="raw"]')?.click();
        await sleep(50);
        const rawActivePillCat = document
          .querySelector('[data-action="set-news-category"].active')
          ?.getAttribute('data-category');
        const rawModeTabAria = document
          .querySelector('[data-action="set-news-mode"][data-mode="raw"]')
          ?.getAttribute('aria-selected');
        const rawVisibleItems = document.querySelectorAll('[data-raw-type]').length;

        // 2. Podcast duration slider updates in-place without replacing <input id="podDurationSlider"> DOM node
        document.querySelector('[data-nav-tab="audio"]')?.click();
        await sleep(50);
        document.querySelector('[data-action="set-studio-sub"][data-studio-sub="podcast"]')?.click();
        await sleep(50);
        const slBefore = document.getElementById('podDurationSlider');
        slBefore.value = '11';
        slBefore.dispatchEvent(new Event('input', { bubbles: true }));
        const slAfter = document.getElementById('podDurationSlider');
        const sliderPreservedDomNode = Boolean(slBefore && slBefore === slAfter);
        const badgeText = document.getElementById('podDurationBadge')?.textContent?.trim() || '';
        const btnText = document.querySelector('[data-action="generate-autopodcast"]')?.textContent?.trim() || '';
        const waitPreviewText = document.querySelector('[data-est-wait-preview="podcast"]')?.textContent?.trim() || '';

        // 3. Sticky Column 1 computed position & opaque background in Dark Mode AND '94 Throwback Light Mode
        const inspectStickyCol = () => {
          const th = document.querySelector('th.sticky-first-col');
          const td = document.querySelector('td.sticky-first-col');
          if (!th || !td) return { found: false };
          const thCs = getComputedStyle(th);
          const tdCs = getComputedStyle(td);
          const isOpaque = bg => Boolean(bg && bg !== 'transparent' && !/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)$/.test(bg));
          return {
            found: true,
            thSticky: thCs.position === 'sticky' && thCs.left === '0px',
            tdSticky: tdCs.position === 'sticky' && tdCs.left === '0px',
            thBg: thCs.backgroundColor,
            tdBg: tdCs.backgroundColor,
            opaque: isOpaque(thCs.backgroundColor) && isOpaque(tdCs.backgroundColor)
          };
        };

        document.querySelector('[data-nav-tab="season"]')?.click();
        await sleep(50);
        document.querySelector('[data-action="set-season-sub"][data-season-sub="health"]')?.click();
        await sleep(50);
        const darkHealthSticky = inspectStickyCol();
        document.querySelector('[data-action="set-season-sub"][data-season-sub="matchup"]')?.click();
        await sleep(50);
        const darkMatchupSticky = inspectStickyCol();

        // Switch to Light Mode and verify sticky Column 1 stays opaque light surface
        document.getElementById('openSettingsBtn')?.click();
        await sleep(40);
        document.querySelector('[data-action="toggle-theme"]')?.click();
        await sleep(50);
        document.getElementById('closeSheetBtn')?.click();
        await sleep(40);
        const lightMatchupSticky = inspectStickyCol();

        // Restore Dark Mode
        document.getElementById('openSettingsBtn')?.click();
        await sleep(40);
        document.querySelector('[data-action="toggle-theme"]')?.click();
        await sleep(40);
        document.getElementById('closeSheetBtn')?.click();
        await sleep(40);
        document.querySelector('[data-nav-tab="home"]')?.click();
        await sleep(40);

        return {
          rawActivePillCat,
          rawModeTabAria,
          rawVisibleItems,
          sliderPreservedDomNode,
          badgeText,
          btnText,
          waitPreviewText,
          darkHealthSticky,
          darkMatchupSticky,
          lightMatchupSticky
        };
      });

      assert(
        qaSweepCheck.rawActivePillCat === 'all' &&
          qaSweepCheck.rawModeTabAria === 'true' &&
          qaSweepCheck.rawVisibleItems > 0,
        `News mode switch filter reset failed: ${JSON.stringify(qaSweepCheck)}`
      );
      assert(
        qaSweepCheck.sliderPreservedDomNode &&
          qaSweepCheck.badgeText === '11 min' &&
          /11[\s-]min/i.test(qaSweepCheck.btnText) &&
          qaSweepCheck.waitPreviewText.startsWith('11 min pod'),
        `In-place podcast slider DOM preservation failed: ${JSON.stringify(qaSweepCheck)}`
      );
      assert(
        qaSweepCheck.darkHealthSticky.found &&
          qaSweepCheck.darkHealthSticky.thSticky &&
          qaSweepCheck.darkHealthSticky.tdSticky &&
          qaSweepCheck.darkHealthSticky.opaque &&
          qaSweepCheck.darkMatchupSticky.found &&
          qaSweepCheck.darkMatchupSticky.opaque &&
          qaSweepCheck.lightMatchupSticky.found &&
          qaSweepCheck.lightMatchupSticky.opaque &&
          qaSweepCheck.lightMatchupSticky.tdBg !== qaSweepCheck.darkMatchupSticky.tdBg,
        `Sticky Column 1 Dark/Light opaque surface audit failed: ${JSON.stringify(qaSweepCheck)}`
      );
    });

    await runStep('Schedule Previous Games collapsible box starts collapsed (only current/future visible) & post-game availability news/synthesis briefs hidden', async () => {
      const schedAndNewsAudit = await cdp.eval(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const staleRe = /\b(inactives\s+week\s+9|active\s+vs\.\s+raiders|before\s+raiders\s+game|won['’]?t\s+play\s+in\s+sunday['’]?s\s+game\s+against\s+the\s+raiders)\b/i;

        // 1. Home check
        document.querySelector('[data-nav-tab="home"]')?.click();
        await sleep(50);
        const homeText = document.getElementById('mainView')?.textContent || '';
        const homeStaleHit = staleRe.test(homeText);

        // 2. News Wire & Video + Synthesis Briefs check
        document.querySelector('[data-nav-tab="news"]')?.click();
        await sleep(50);
        document.querySelector('[data-action="set-news-mode"][data-mode="raw"]')?.click();
        await sleep(50);
        const rawText = document.getElementById('mainView')?.textContent || '';
        const rawStaleHit = staleRe.test(rawText);

        document.querySelector('[data-action="set-news-mode"][data-mode="clustered"]')?.click();
        await sleep(50);
        const clusteredText = document.getElementById('mainView')?.textContent || '';
        const clusteredStaleHit = staleRe.test(clusteredText);

        // 3. Schedule Previous Games collapsible box check
        document.querySelector('[data-nav-tab="season"]')?.click();
        await sleep(50);
        document.querySelector('[data-action="set-season-sub"][data-season-sub="schedule"]')?.click();
        await sleep(50);

        const prevDetails = document.querySelector('[data-schedule-previous-games]');
        const prevSummary = document.querySelector('[data-schedule-previous-summary]');
        const prevRows = [...document.querySelectorAll('[data-schedule-previous-list] [data-schedule-game-row="previous"]')];
        const upcomingRows = [...document.querySelectorAll('[data-schedule-upcoming-list] [data-schedule-game-row="upcoming"]')];
        const anyPrevInUpcoming = Boolean(document.querySelector('[data-schedule-upcoming-list] [data-schedule-game-row="previous"]'));

        const startsCollapsed = Boolean(prevDetails && prevDetails.open === false);
        const prevHiddenByDefault = prevRows.length > 0 && prevRows.every(r => r.getClientRects().length === 0);
        const upcomingVisibleByDefault = upcomingRows.length > 0 && upcomingRows.every(r => r.getClientRects().length > 0);

        prevSummary?.click();
        await sleep(40);
        const expandsOnClick = Boolean(prevDetails && prevDetails.open === true);
        const prevVisibleWhenExpanded = prevRows.length > 0 && prevRows.every(r => r.getClientRects().length > 0);

        prevSummary?.click();
        await sleep(40);
        const collapsesAgain = Boolean(prevDetails && prevDetails.open === false);

        return {
          homeStaleHit,
          rawStaleHit,
          clusteredStaleHit,
          prevCount: prevRows.length,
          upcomingCount: upcomingRows.length,
          anyPrevInUpcoming,
          startsCollapsed,
          prevHiddenByDefault,
          upcomingVisibleByDefault,
          expandsOnClick,
          prevVisibleWhenExpanded,
          collapsesAgain
        };
      });

      await cdp.assertNoOverflow('Game & Season: Schedule Collapsible Previous Games');
      assert(
        !schedAndNewsAudit.homeStaleHit &&
          !schedAndNewsAudit.rawStaleHit &&
          !schedAndNewsAudit.clusteredStaleHit,
        `Stale completed-game availability headline leaked into rendered DOM: ${JSON.stringify(schedAndNewsAudit)}`
      );
      assert(
        schedAndNewsAudit.startsCollapsed &&
          schedAndNewsAudit.prevHiddenByDefault &&
          schedAndNewsAudit.upcomingVisibleByDefault &&
          !schedAndNewsAudit.anyPrevInUpcoming &&
          schedAndNewsAudit.expandsOnClick &&
          schedAndNewsAudit.prevVisibleWhenExpanded &&
          schedAndNewsAudit.collapsesAgain,
        `Schedule Previous Games collapsible box audit failed: ${JSON.stringify(schedAndNewsAudit)}`
      );
    });

    await runStep('4-Unit Team Stats, Overall Rank Tooltips, Matchup H2H Stats, Clickable #X Leaderboard Modals & Position-Specific Player Stats', async () => {
      await cdp.setViewport(393, 852, true, 3);
      const deepStatsAudit = await cdp.eval(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));

        // 1. Navigate to Game & Season -> Stats
        document.querySelector('[data-nav-tab="season"]').click();
        document.querySelector('[data-action="set-season-sub"][data-season-sub="stats"]').click();
        await sleep(30);

        // Click "Composite Score" tooltip link on Offense Overall Rank & verify single-line layout + % formatting + zero "How calculated" / "idx" / top eyebrow
        const compLink = document.querySelector('[data-team-stats-unit="offense"] .overall-how-wrap [data-jargon]');
        compLink?.click();
        const pop = document.getElementById('jargonPopover');
        const tooltipOpened = Boolean(
          pop &&
            !pop.hidden &&
            pop.textContent.includes('0%–100%') &&
            pop.textContent.includes('40%') &&
            pop.textContent.includes('30%')
        );
        document.querySelector('[data-action="close-jargon-popover"]')?.click();

        const offCard = document.querySelector('[data-team-stats-unit="offense"]');
        const offCardText = offCard?.textContent || '';
        const noHowCalculatedText = !/how\s+calculated/i.test(offCardText);
        const noIdxText = !/\bidx\b/i.test(offCardText) && /\d+\.\d+%/.test(offCardText);
        const noTopEyebrow = !offCard?.querySelector('.team-stats-header .card-eyebrow');

        // Verify single-line geometry, larger font than normal metrics, column alignment & matching background
        const bannerEl = offCard?.querySelector('.unit-overall-banner');
        const headingEl = bannerEl?.querySelector('.unit-overall-heading');
        const valCellEl = bannerEl?.querySelector('[data-overall-col="sf-val"]');
        const rankCellEl = bannerEl?.querySelector('[data-overall-col="sf-rank"]');
        const avgCellEl = bannerEl?.querySelector('[data-overall-col="nfl-avg"]');
        const overallPillEl = bannerEl?.querySelector('.overall-rank-pill');
        const normalTdEl = offCard?.querySelector('tbody tr td:first-child');
        const normalBadgeEl = offCard?.querySelector('tbody tr .badge');
        const ths = Array.from(offCard?.querySelectorAll('table.team-stats-table thead th') || []);

        const headingRect = headingEl?.getBoundingClientRect();
        const pillRect = bannerEl?.querySelector('.unit-overall-right')?.getBoundingClientRect();
        const singleLineBanner =
          Boolean(headingRect && pillRect) &&
          Math.abs(headingRect.top + headingRect.height / 2 - (pillRect.top + pillRect.height / 2)) <= 14;

        const overallFontLargerTeam =
          parseFloat(window.getComputedStyle(headingEl).fontSize) > parseFloat(window.getComputedStyle(normalTdEl).fontSize) &&
          parseFloat(window.getComputedStyle(valCellEl).fontSize) > parseFloat(window.getComputedStyle(normalTdEl).fontSize) &&
          parseFloat(window.getComputedStyle(overallPillEl).fontSize) > parseFloat(window.getComputedStyle(normalBadgeEl).fontSize);

        const colsAlignedTeam =
          ths.length >= 4 &&
          Math.abs(valCellEl.getBoundingClientRect().right - ths[1].getBoundingClientRect().right) <= 2 &&
          Math.abs(rankCellEl.getBoundingClientRect().left - ths[2].getBoundingClientRect().left) <= 2 &&
          Math.abs(avgCellEl.getBoundingClientRect().right - ths[3].getBoundingClientRect().right) <= 2;

        // Expand Offense & Defense detailed metrics drawers
        const offExp = document.querySelector('details[data-stats-expander="offense"]');
        const defExp = document.querySelector('details[data-stats-expander="defense"]');
        const bannerBg = bannerEl ? window.getComputedStyle(bannerEl).backgroundColor : '';
        const expBg = offExp ? window.getComputedStyle(offExp).backgroundColor : '';
        const matchingTransparentBg =
          (bannerBg === 'rgba(0, 0, 0, 0)' || bannerBg === 'transparent') &&
          (expBg === 'rgba(0, 0, 0, 0)' || expBg === 'transparent');
        offExp?.querySelector('summary')?.click();
        defExp?.querySelector('summary')?.click();
        await sleep(30);
        const expandersOpened = Boolean(offExp?.open && defExp?.open);

        // Click #X Rank badge on Points / Game -> verify 32-team modal opens, highlights 49ers, renders NFL Avg divider, and closes
        const ptsRankBtn = document.querySelector('[data-action="open-stat-rank-modal"][data-rank-key="off_pts_game"]');
        ptsRankBtn?.click();
        await sleep(40);
        const modalBackdrop = document.getElementById('statRankModalBackdrop');
        const teamModalOpen = Boolean(modalBackdrop && !modalBackdrop.hidden);
        const teamModalRows = document.querySelectorAll('#rankModalBody .rank-modal-row').length;
        const sfHighlighted = document.querySelector('#rankModalBody [data-rank-highlight="true"]')?.textContent?.includes('49ers');
        const hasAvgDivider = Boolean(document.querySelector('#rankModalBody [data-rank-avg-divider="true"]'));
        document.getElementById('closeRankModalBtn')?.click();
        const teamModalClosed = Boolean(modalBackdrop?.hidden);

        // 2. Navigate to Game & Season -> Matchup & test Head-to-Head 5-column Team Stats Comparison card
        document.querySelector('[data-action="set-season-sub"][data-season-sub="matchup"]').click();
        await sleep(30);
        const h2hCard = document.getElementById('matchupTeamStatsCard');
        const h2hThs = Array.from(h2hCard?.querySelectorAll('table.matchup-stats-table thead th') || []).slice(0, 5);
        const h2hHeaders = h2hThs.map(th => th.textContent.trim());
        const h2hSfVal = h2hCard?.querySelector('[data-overall-col="sf-val"]');
        const h2hSfRank = h2hCard?.querySelector('[data-overall-col="sf-rank"]');
        const h2hOppVal = h2hCard?.querySelector('[data-overall-col="opp-val"]');
        const h2hOppRank = h2hCard?.querySelector('[data-overall-col="opp-rank"]');
        const h2hNormalTd = h2hCard?.querySelector('tbody tr td:first-child');
        const h2hHeading = h2hCard?.querySelector('.unit-overall-heading');

        const overallFontLargerH2h =
          Boolean(h2hHeading && h2hSfVal && h2hNormalTd) &&
          parseFloat(window.getComputedStyle(h2hHeading).fontSize) > parseFloat(window.getComputedStyle(h2hNormalTd).fontSize) &&
          parseFloat(window.getComputedStyle(h2hSfVal).fontSize) > parseFloat(window.getComputedStyle(h2hNormalTd).fontSize);

        const colsAlignedH2h =
          h2hThs.length === 5 &&
          Math.abs(h2hSfVal.getBoundingClientRect().right - h2hThs[1].getBoundingClientRect().right) <= 2 &&
          Math.abs(h2hSfRank.getBoundingClientRect().left - h2hThs[2].getBoundingClientRect().left) <= 2 &&
          Math.abs(h2hOppVal.getBoundingClientRect().right - h2hThs[3].getBoundingClientRect().right) <= 2 &&
          Math.abs(h2hOppRank.getBoundingClientRect().left - h2hThs[4].getBoundingClientRect().left) <= 2;
        // Switch H2H unit pill to Defense, then click Opponent's #X rank badge
        h2hCard?.querySelector('[data-action="set-matchup-stats-unit"][data-unit-id="defense"]')?.click();
        await sleep(30);
        const defH2hCard = document.getElementById('matchupTeamStatsCard');
        const oppRankBtn = defH2hCard?.querySelectorAll('tbody tr:first-child [data-action="open-stat-rank-modal"]')?.[1];
        oppRankBtn?.click();
        await sleep(40);
        const h2hModalRows = document.querySelectorAll('#rankModalBody .rank-modal-row').length;
        document.getElementById('closeRankModalBtn')?.click();

        // 3. Open Brock Purdy Dossier -> Stats & EPA -> click #X Rank inside Sheet -> verify Modal stacks WITHOUT closing Dossier!
        document.querySelector('[data-nav-tab="roster"]').click();
        document.querySelector('[data-action="set-roster-sub"][data-roster-sub="roster"]').click();
        const inp = document.getElementById('rosterSearchInput');
        inp.value = 'Brock Purdy';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('.player-row')?.click();
        document.querySelector('[data-action="set-player-tab"][data-player-tab="stats"]')?.click();
        await sleep(30);

        const purdySections = document.querySelectorAll('#sheetBody .player-stat-section').length;
        const purdyFirstRankBtn = document.querySelector('#sheetBody [data-action="open-stat-rank-modal"]');
        purdyFirstRankBtn?.click();
        await sleep(40);
        const playerModalOpen = !document.getElementById('statRankModalBackdrop').hidden;
        const sheetStillOpenBehind = !document.getElementById('bottomSheetBackdrop').hidden;
        const purdyHighlightedInModal = document
          .querySelector('#rankModalBody [data-rank-highlight="true"]')
          ?.textContent?.includes('Brock Purdy');

        // Press Escape -> must close Rank Modal ONLY while keeping Brock Purdy's Dossier open!
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const modalClosedAfterFirstEsc = document.getElementById('statRankModalBackdrop').hidden;
        const sheetStillOpenAfterFirstEsc = !document.getElementById('bottomSheetBackdrop').hidden;
        document.getElementById('closeSheetBtn')?.click();

        // 4. Open Nick Bosa -> Stats & EPA -> Career Year-by-Year -> verify defensive columns & zero blank Passing/Receiving columns
        const setLiveRosterSearch = q => {
          const liveInp = document.getElementById('rosterSearchInput');
          liveInp.value = q;
          liveInp.dispatchEvent(new Event('input', { bubbles: true }));
        };
        setLiveRosterSearch('Nick Bosa');
        document.querySelector('.player-row')?.click();
        document.querySelector('[data-action="set-player-tab"][data-player-tab="stats"]')?.click();
        document.querySelector('[data-action="set-player-stats-mode"][data-stats-mode="career"]')?.click();
        const bosaCareerHeaders = Array.from(document.querySelectorAll('#sheetBody table[data-career-pos-table] thead th')).map(th =>
          th.textContent.trim()
        );
        document.getElementById('closeSheetBtn')?.click();
        setLiveRosterSearch('');

        return {
          tooltipOpened,
          noHowCalculatedText,
          noIdxText,
          noTopEyebrow,
          singleLineBanner,
          overallFontLargerTeam,
          colsAlignedTeam,
          overallFontLargerH2h,
          colsAlignedH2h,
          matchingTransparentBg,
          expandersOpened,
          teamModalOpen,
          teamModalRows,
          sfHighlighted,
          hasAvgDivider,
          teamModalClosed,
          h2hHeaders,
          h2hModalRows,
          purdySections,
          playerModalOpen,
          sheetStillOpenBehind,
          purdyHighlightedInModal,
          modalClosedAfterFirstEsc,
          sheetStillOpenAfterFirstEsc,
          bosaCareerHeaders
        };
      });

      await cdp.assertNoOverflow('Deep Team & Player Stats Leaderboard Modal Audit');
      assert(
        deepStatsAudit.tooltipOpened &&
          deepStatsAudit.noHowCalculatedText &&
          deepStatsAudit.noIdxText &&
          deepStatsAudit.noTopEyebrow &&
          deepStatsAudit.singleLineBanner &&
          deepStatsAudit.overallFontLargerTeam &&
          deepStatsAudit.colsAlignedTeam &&
          deepStatsAudit.overallFontLargerH2h &&
          deepStatsAudit.colsAlignedH2h &&
          deepStatsAudit.matchingTransparentBg,
        `Overall Rank single-line / larger font / column alignment / % / Composite Score link check failed: ${JSON.stringify(deepStatsAudit)}`
      );
      assert(deepStatsAudit.expandersOpened, 'Team Stats Offense & Defense detailed expanders failed to open');
      assert(
        deepStatsAudit.teamModalOpen &&
          deepStatsAudit.teamModalRows === 32 &&
          deepStatsAudit.sfHighlighted &&
          deepStatsAudit.hasAvgDivider &&
          deepStatsAudit.teamModalClosed,
        `32-Team Leaderboard Modal failed: ${JSON.stringify(deepStatsAudit)}`
      );
      assert(
        deepStatsAudit.h2hHeaders.length === 5 &&
          deepStatsAudit.h2hHeaders[0] === 'Metric' &&
          deepStatsAudit.h2hHeaders[1] === '49ers' &&
          deepStatsAudit.h2hHeaders[2] === 'Rank' &&
          deepStatsAudit.h2hHeaders[4] === 'Rank' &&
          deepStatsAudit.h2hModalRows === 32,
        `Matchup H2H 5-column Team Stats card failed: ${JSON.stringify(deepStatsAudit)}`
      );
      assert(
        deepStatsAudit.purdySections >= 2 &&
          deepStatsAudit.playerModalOpen &&
          deepStatsAudit.sheetStillOpenBehind &&
          deepStatsAudit.purdyHighlightedInModal &&
          deepStatsAudit.modalClosedAfterFirstEsc &&
          deepStatsAudit.sheetStillOpenAfterFirstEsc,
        `Player Positional Leaderboard Modal / Escape stack failed: ${JSON.stringify(deepStatsAudit)}`
      );
      assert(
        deepStatsAudit.bosaCareerHeaders.includes('Sacks') &&
          deepStatsAudit.bosaCareerHeaders.includes('TFL') &&
          !deepStatsAudit.bosaCareerHeaders.some(h => /Pass|Rec|Rush/i.test(h)),
        `Nick Bosa Career Year-by-Year table should be defensive-only: ${JSON.stringify(deepStatsAudit.bosaCareerHeaders)}`
      );
    });

    await runStep('Zero console errors, zero uncaught page exceptions, and zero local HTTP 404/500 errors', async () => {
      assert(
        cdp.consoleErrors.length === 0,
        `Console errors encountered: ${JSON.stringify(cdp.consoleErrors)}`
      );
      assert(
        cdp.pageExceptions.length === 0,
        `Uncaught page exceptions encountered: ${JSON.stringify(cdp.pageExceptions)}`
      );
      assert(
        cdp.localNetworkFailures.length === 0,
        `Local HTTP failures encountered: ${JSON.stringify(cdp.localNetworkFailures)}`
      );
    });
  } finally {
    try {
      ws?.close();
    } catch {}
    if (chromeProc) {
      chromeProc.kill('SIGKILL');
    }
    server.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }

  console.log('\n======================================================');
  console.log(`MOBILE E2E QA SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal E2E QA runner error:', err);
  process.exit(1);
});
