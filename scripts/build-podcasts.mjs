#!/usr/bin/env node
/**
 * Studio-Grade Multi-Speaker Neural Autopodcast Builder for 49ers Faithful
 * Uses edge-tts (Two-Host Analytical Banter: AndrewNeural + AvaNeural) and macOS afconvert
 * to synthesize compact 24kHz AAC (.m4a) episodes with exact per-segment seek timestamps!
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const podcastDir = path.join(rootDir, 'data', 'podcasts');

const SAMPLE_RATE = 24000;
const HOST_VOICES = {
  Marcus: { voice: 'en-US-AndrewNeural', role: "X's & O's Film Analyst", rate: '+4%' },
  Elena: { voice: 'en-US-AvaNeural', role: 'Cap & Quantitative Insider', rate: '+4%' }
};

const EPISODES_SPEC = [
  {
    id: 'ep-week9-raiders-film',
    title: "Week 9 Trench & Scheme Preview: Bosa + Buckner Debut vs. Klint Kubiak's Raiders",
    topic: 'Week 9 LV @ SF Matchup, Wide-9 Stunt Geometry & Maxx Crosby Protection Plan',
    format: 'Two-Host Analytical Banter',
    presetLabel: '3m Quick Hit',
    createdBy: '49ers Faithful Desk',
    createdAt: '2026-11-06T21:15:00-08:00',
    sourceLinks: [
      { label: 'ESPN Raiders @ 49ers Matchup', url: 'https://www.espn.com/nfl/team/_/name/sf/san-francisco-49ers' },
      { label: 'nflverse 2026 EPA Dataset', url: 'https://github.com/nflverse/nflverse-data' },
      { label: '49ers Official Injury Report', url: 'https://www.49ers.com/team/injury-report/' }
    ],
    turns: [
      {
        speaker: 'Marcus',
        text: "Welcome into 49ers Faithful. Sunday afternoon on FOX at Levi's Stadium, the six-and-one Niners come out of the Week 8 bye holding the number one seed in the NFC, laying eight and a half points against the four-and-four Las Vegas Raiders. And for the first time since Week 2, Nick Bosa is officially off the injury designation list and cleared to hunt alongside DeForest Buckner and Osa Odighizuwa."
      },
      {
        speaker: 'Elena',
        text: "The math behind that defensive front is staggering, Marcus. Even without Bosa from Weeks 3 through 7, Osa Odighizuwa kept the interior disruption afloat. Now you drop six-foot-seven DeForest Buckner into the three-technique next to Odighizuwa, with Bosa and Keion White on the Wide-9 edges. Opposing centers literally cannot slide protection toward Bosa without leaving Buckner singled up on a guard."
      },
      {
        speaker: 'Marcus',
        text: "Exactly. And look across the sideline at who is calling plays for Las Vegas: first-year Raiders head coach Klint Kubiak, who spent all of 2023 inside Kyle Shanahan's building as our Passing Game Specialist. Kubiak wants to marry outside zone with Ashton Jeanty to deep play-action crossers for Kirk Cousins and Brock Bowers—the exact concepts Fred Warner and Deommodore Lenoir rep against every day in Santa Clara."
      },
      {
        speaker: 'Elena',
        text: "Plus San Francisco enters with a plus-seven-day rest advantage coming off the bye. Under Shanahan since 2017, when QB1 is healthy post-bye, the 49ers average plus 0.21 EPA per play on their opening fifteen scripted snaps, and Brock Purdy is already sitting top-three in the NFL at plus 63.2 passing EPA and plus 4.25 percent completion percentage over expected."
      },
      {
        speaker: 'Marcus',
        text: "The one wrecker we have to respect for sixty minutes is Maxx Crosby. Whenever he flips away from Trent Williams to line up over right tackle Colton McKivitz, watch for 21-personnel chip-and-release help from George Kittle and Kyle Juszczyk, paired with quick 2.6-second rhythm digs to Brandin Cooks, Jordan Watkins, and Jacob Cowing—plus Demarcus Robinson if activated from IR."
      },
      {
        speaker: 'Elena',
        text: "Control Crosby on third-and-medium, keep Bosa on a smart 45-snap pitch count in his return, and the implied market score of Niners 29, Raiders 20 tracks right on the numbers."
      }
    ]
  },
  {
    id: 'ep-cap-aiyuk-blueprint',
    title: '2026–2028 Salary Cap Blueprint: Rollover Math, Purdy/Bosa Levers & Aiyuk Resolution',
    topic: 'OverTheCap Multi-Year Ledger, CBA Rollover Strategy & Brandon Aiyuk Cap Mechanics',
    format: 'Two-Host Analytical Banter',
    presetLabel: '4m Cap Dive',
    createdBy: '49ers Faithful Desk',
    createdAt: '2026-11-06T19:50:00-08:00',
    sourceLinks: [
      { label: 'OverTheCap 49ers Cap Table', url: 'https://overthecap.com/salary-cap/san-francisco-49ers' },
      { label: 'NFLPA Public Cap Report', url: 'https://nflpa.com/reports/public-salary-cap-report' }
    ],
    turns: [
      {
        speaker: 'Elena',
        text: "Let's open up the OverTheCap ledger for November 2026, because there is a ton of confusion online about why John Lynch and Paraag Marathe are sitting on 35.16 million dollars in gross 2026 cap space right now instead of spending every dollar at the deadline."
      },
      {
        speaker: 'Marcus',
        text: "Break down the multi-year mechanics, Elena. Casual fans see 35 million and assume it disappears in January if we don't spend it."
      },
      {
        speaker: 'Elena',
        text: "Under Article 13 of the NFL Collective Bargaining Agreement, unused 2026 cap room carries over one-for-one into 2027. Look at how Brock Purdy and Nick Bosa's deals are structured: Purdy carries a 23.71 million cap number this year with 7.55 million in option proration, while Bosa sits at 22.99 million on a minimum 1.21 million base salary and over 21 million in combined signing and option proration. Rolling over 25 million dollars of clean space into 2027 absorbs next year's scheduled jumps without touching aging veteran contracts."
      },
      {
        speaker: 'Marcus',
        text: "Now factor in Friday's headline at SAP Performance Facility: Brandon Aiyuk meeting with team brass saying he is healthy and seeking reinstatement as both sides navigate a likely exit."
      },
      {
        speaker: 'Elena',
        text: "Here is the exact Post-June-1 math on Aiyuk or any major veteran contract after June first: any trade or release executed after June 1st—including right now in November—keeps only the current 2026 prorated bonus on the 2026 books, while accelerating remaining future unamortized bonus proration onto the 2027 dead-cap ledger. And if the resolution includes a bilateral settlement on unaccrued guarantees, San Francisco protects even more of its 2027 cap horizon."
      },
      {
        speaker: 'Marcus',
        text: "Which is why drafting 19 combined players across the 2025 and 2026 classes—guys like Mykel Williams, Alfred Collins, De'Zhaun Stribling, Gracen Halton, and Romello Height—was mandatory. Rookie-scale starters keep the championship window wide open while Purdy, Warner, and Bosa anchor the top of the payroll."
      }
    ]
  },
  {
    id: 'ep-trade-deadline-seeding',
    title: 'Nov 10 Trade Window & 10,000-Run NFC #1 Seed Outlook',
    topic: 'Tuesday Nov 10 Deadline Targets, Pro-Rated Cap Costs & NFC Tiebreaker Equity',
    format: 'Two-Host Analytical Banter',
    presetLabel: '3m Strategy Brief',
    createdBy: '49ers Faithful Analytics',
    createdAt: '2026-11-06T17:20:00-08:00',
    sourceLinks: [
      { label: 'OverTheCap 49ers Contracts', url: 'https://overthecap.com/salary-cap/san-francisco-49ers' },
      { label: 'ESPN NFL Standings', url: 'https://www.espn.com/nfl/standings' },
      { label: 'NFL Transactions Wire', url: 'https://www.espn.com/nfl/transactions' }
    ],
    turns: [
      {
        speaker: 'Marcus',
        text: "We are inside the final 96 hours before Tuesday's November 10th, 1 PM Pacific NFL Trade Deadline. John Lynch already swung early to bring DeForest Buckner back home to the Bay Area alongside Osa Odighizuwa. Where does the roster still have vulnerability for January?"
      },
      {
        speaker: 'Elena',
        text: "Looking at snap-weighted EPA and injury exposure, two spots stand out: boundary X-receiver insurance with Aiyuk out of the lineup, and veteran swing tackle depth behind 38-year-old Trent Williams. Because nine weeks of the eighteen-week season have elapsed, an incoming player only costs fifty percent—nine eighteenths—of their remaining 2026 base salary against our cap."
      },
      {
        speaker: 'Marcus',
        text: "So a veteran Z or X separator on a four-million base salary costs barely two million against our 2026 cap, or under one million if a seller eats half the money for a fifth-for-seventh pick swap."
      },
      {
        speaker: 'Elena',
        text: "Exactly. And look at why every marginal upgrade matters right now: in our ten-thousand-run Monte Carlo NFC simulator, sitting at six-and-one with a three-and-oh NFC West mark—already owning road or neutral wins over the Rams in Melbourne and the Seahawks in Seattle—gives the 49ers a 97.7 percent division probability and a 54.8 percent shot at the number-one seed and first-round bye."
      },
      {
        speaker: 'Marcus',
        text: "And look at the December gauntlet ahead: Vikings at 7,200 feet in Mexico City in Week 11, Seahawks in Week 12, Rams in Week 14, at Kansas City in Week 16, and the Eagles visiting Levi's in Week 17. Securing that Wild Card bye is everything."
      }
    ]
  }
];

const PRE_CACHED_ANALYSES = [
  {
    id: 'analysis_wide9_buckner_bosa',
    title: 'Scheme & EPA Deep Dive: How DeForest Buckner + Osa Odighizuwa Transform Nick Bosa’s Pass-Rush Geometry',
    category: 'Film & Trench Analytics',
    createdAt: '2026-11-06T20:40:00-08:00',
    createdBy: '49ers Faithful Film Desk',
    sourcesCited: [
      { label: 'nflverse 2026 Pass-Rush & EPA', url: 'https://github.com/nflverse/nflverse-data' },
      { label: 'Kyle Shanahan Press Conference', url: 'https://www.youtube.com/watch?v=x0TpSoyfx7I' },
      { label: 'Pro-Football-Reference 49ers Defense', url: 'https://www.pro-football-reference.com/teams/sfo/2026.htm' }
    ],
    markdown: `### Executive Finding
Pairing **DeForest Buckner** (6'7", 295 lbs, 34.4" arm length) and **Osa Odighizuwa** inside with **Nick Bosa** and **Keion White** on the Wide-9 rails eliminates the #1 protection adjustment offenses used against San Francisco in 2024–2025: **5-man half-slide + RB chip toward Bosa**.

### Key Quantitative & Film Mechanics
1. **Interior Slide Conflict (2i / 3-Tech Split)**:
   * When SF aligns Buckner at the 3-technique weak and Odighizuwa at the 2i/shade strong, the opposing center must turn toward Odighizuwa or risk immediate A-gap penetration in Brock Purdy's opponent mirror (2.4s pocket collapse).
   * If the center slides away from Buckner + Bosa's side, the offensive guard is left on an island against Buckner's forklift bull-rush, preventing the guard from widening to help the tackle on **T-E (Tackle-End) stunts**.
2. **Early-Down Run-Fit Integrity vs. Outside Zone**:
   * Through Week 7 without Bosa for 5 games, SF relied heavily on **Fred Warner** erasing leaky B-gap creases. Buckner's career tackle-for-loss rate against outside zone restores two-gap knock-back, keeping Warner clean to rob play-action crossers.
3. **Snap-Count Pitch Count Projection (Week 9 vs. Raiders)**:
   * Expect Bosa around **42–46 snaps (~68%)**, with **Bryce Huff** and 3rd-round rookie **Romello Height** rotating on 2nd-and-long speed rushes.`
  },
  {
    id: 'analysis_purdy_2026_cpoe_epa',
    title: 'Brock Purdy 2026 Through 7 Games: Why +4.25% CPOE & 3.2% Sack Avoidance Sustain Top-3 NFL Offense',
    category: 'QB & Passing Analytics',
    createdAt: '2026-11-06T18:10:00-08:00',
    createdBy: '49ers Faithful Analytics',
    sourcesCited: [
      { label: 'nflverse 2026 REG Player & Team Stats', url: 'https://github.com/nflverse/nflverse-data' },
      { label: 'NFL NextGen Stats Passing', url: 'https://nextgenstats.nfl.com/stats/passing' },
      { label: 'RBSDM Quarterback EPA + CPOE', url: 'https://rbsdm.com/stats/stats/' }
    ],
    markdown: `### 2026 Statistical Snapshot (Weeks 1–7, 6-1 Record)
* **Passing Efficiency**: \`146/211 (69.2%)\`, \`1,748 Yards (8.28 YPA)\`, \`15 TD\`, \`4 INT\`
* **Total Passing EPA**: \`+63.23\` (**Top-3 NFL** per game at \`+9.03 EPA/game\`)
* **Completion % Over Expected (CPOE)**: \`+4.25%\`
* **Sacks Taken**: Only \`7 sacks\` across \`218 dropbacks\` (\`3.2% sack rate\`, **#2 best in NFL**)

### What Changed on Film in 2026
1. **Faster Backside Checkdowns vs. Simulated Pressures**: Rather than hunting hero throws when two-high shells bracket the deep over route, Purdy has cut his pressure-to-sack conversion nearly in half by hitting **Christian McCaffrey** and **George Kittle** on hot option/angle outlets.
2. **Anticipation Window Between the Numbers (10–19 Air Yards)**: Even without Brandon Aiyuk active, Purdy has completed **70 passes of 10+ yards** and **24 explosive passes of 20+ yards** through 7 games by trusting **Brandin Cooks**, **Jordan Watkins**, **Jacob Cowing**, and early-season reps from **Mike Evans** and **Ricky Pearsall** before they cleared linebacker leverage.`
  }
];

function findEdgeTtsPython() {
  const candidates = [
    process.env.EDGE_TTS_PYTHON,
    '/Users/joshal/.gemini/antigravity/brain/c0f17fdc-d6dd-435f-beaf-ea2a3251feec/scratch/tts-env/bin/python3',
    'python3'
  ].filter(Boolean);

  for (const bin of candidates) {
    try {
      execFileSync(bin, ['-c', 'import edge_tts'], { stdio: 'ignore' });
      return bin;
    } catch {}
  }
  return null;
}

function parseWavInt16Mono(buf) {
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      const start = offset + 8;
      const end = Math.min(buf.length, start + chunkSize);
      const count = Math.floor((end - start) / 2);
      const samples = new Int16Array(count);
      for (let i = 0; i < count; i++) {
        samples[i] = buf.readInt16LE(start + i * 2);
      }
      return samples;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  throw new Error('WAV data chunk not found');
}

function writeWavInt16Mono(filePath, samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i], 44 + i * 2);
  }
  fs.writeFileSync(filePath, buf);
}

const PY_RENDER_TURNS = `
import asyncio, json, os, subprocess, sys, edge_tts

async def render_one(sem, idx, text, voice, rate, tmp_dir, sr):
    mp3_p = os.path.join(tmp_dir, f"turn-{idx}.mp3")
    wav_p = os.path.join(tmp_dir, f"turn-{idx}.wav")
    async with sem:
        for attempt in range(4):
            try:
                comm = edge_tts.Communicate(text, voice, rate=rate)
                await comm.save(mp3_p)
                break
            except Exception as e:
                if attempt == 3:
                    raise e
                await asyncio.sleep(0.7 * (attempt + 1))
    subprocess.run(["/usr/bin/afconvert", "-f", "WAVE", "-d", f"LEI16@{sr}", "-c", "1", mp3_p, wav_p], check=True)

async def main():
    spec = json.loads(sys.stdin.read())
    sem = asyncio.Semaphore(4)
    tasks = [
        render_one(sem, t["idx"], t["ttsText"], t["voice"], t["rate"], spec["tmpDir"], spec["sampleRate"])
        for t in spec["turns"]
    ]
    await asyncio.gather(*tasks)

asyncio.run(main())
`;

function pronounceableNflText(text = '') {
  return text
    .replace(/\bEPA\b/g, 'E-P-A')
    .replace(/\bCPOE\b/g, 'C-P-O-E')
    .replace(/\b2i\b/g, 'two-eye')
    .replace(/\bQB1\b/g, 'Q-B-1')
    .replace(/\bOdighizuwa\b/gi, 'Oh-diggy-zoo-wah')
    .replace(/\bJuszczyk\b/gi, 'Yooz-check')
    .replace(/\bAiyuk\b/gi, 'Eye-yook')
    .replace(/\bDe'Zhaun\b/gi, 'Day-zhon')
    .replace(/\bLenoir\b/gi, 'Luh-nor')
    .replace(/\bParaag Marathe\b/gi, 'Puh-rahg Muh-rah-thee');
}

async function main() {
  fs.mkdirSync(podcastDir, { recursive: true });
  const pyBin = findEdgeTtsPython();
  if (!pyBin) {
    throw new Error('Could not locate python3 with edge_tts installed.');
  }

  const episodesMeta = [];
  const interTurnPauseSamples = Math.round(SAMPLE_RATE * 0.28); // natural 280ms breath pause between hosts

  for (const ep of EPISODES_SPEC) {
    console.log(`[podcast] Rendering multi-speaker neural audio for: ${ep.id}...`);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `49ers-pod-${ep.id}-`));
    try {
      const pyInput = {
        tmpDir,
        sampleRate: SAMPLE_RATE,
        turns: ep.turns.map((t, idx) => ({
          idx,
          ttsText: pronounceableNflText(t.text),
          voice: HOST_VOICES[t.speaker].voice,
          rate: HOST_VOICES[t.speaker].rate
        }))
      };

      execFileSync(pyBin, ['-c', PY_RENDER_TURNS], {
        input: JSON.stringify(pyInput),
        stdio: ['pipe', 'inherit', 'inherit']
      });

      const chunks = [];
      const timedTranscript = [];
      let cursorSamples = 0;

      for (let i = 0; i < ep.turns.length; i++) {
        const wavPath = path.join(tmpDir, `turn-${i}.wav`);
        const samples = parseWavInt16Mono(fs.readFileSync(wavPath));
        const startSec = Number((cursorSamples / SAMPLE_RATE).toFixed(2));
        chunks.push(samples);
        cursorSamples += samples.length;
        const endSec = Number((cursorSamples / SAMPLE_RATE).toFixed(2));

        timedTranscript.push({
          idx: i,
          speaker: ep.turns[i].speaker,
          speakerRole: HOST_VOICES[ep.turns[i].speaker].role,
          text: ep.turns[i].text,
          startSec,
          endSec
        });

        if (i < ep.turns.length - 1) {
          chunks.push(new Int16Array(interTurnPauseSamples));
          cursorSamples += interTurnPauseSamples;
        }
      }

      const fullPcm = new Int16Array(cursorSamples);
      let writeOffset = 0;
      for (const ch of chunks) {
        fullPcm.set(ch, writeOffset);
        writeOffset += ch.length;
      }

      const masterWav = path.join(tmpDir, 'master.wav');
      const outM4a = path.join(podcastDir, `${ep.id}.m4a`);
      writeWavInt16Mono(masterWav, fullPcm, SAMPLE_RATE);

      execFileSync('/usr/bin/afconvert', [
        '-f', 'm4af',
        '-d', 'aac',
        '-b', '64000',
        masterWav,
        outM4a
      ]);

      const durationSec = Math.round(cursorSamples / SAMPLE_RATE);
      const fileSizeBytes = fs.statSync(outM4a).size;

      episodesMeta.push({
        id: ep.id,
        title: ep.title,
        topic: ep.topic,
        format: ep.format,
        presetLabel: ep.presetLabel,
        createdBy: ep.createdBy,
        createdAt: ep.createdAt,
        sourceLinks: ep.sourceLinks || [],
        audioUrl: `./data/podcasts/${ep.id}.m4a`,
        durationSec,
        fileSizeBytes,
        transcript: timedTranscript
      });
      console.log(`  -> Saved ${ep.id}.m4a (${durationSec}s, ${(fileSizeBytes / 1024).toFixed(0)} KB)`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  const indexPayload = {
    updatedAt: new Date().toISOString(),
    episodes: episodesMeta,
    sharedAnalyses: PRE_CACHED_ANALYSES
  };

  fs.writeFileSync(path.join(podcastDir, 'index.json'), JSON.stringify(indexPayload, null, 2));
  console.log(`[podcast] Wrote ${episodesMeta.length} studio neural episodes & ${PRE_CACHED_ANALYSES.length} deep analyses -> data/podcasts/index.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
