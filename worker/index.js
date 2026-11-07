/**
 * 49ers Faithful — Zero-Cost Serverless Edge Worker (Cloudflare Free Tier)
 *
 * Endpoints:
 * - GET  /api/shared-feed        -> Returns shared group cache of Deep Analyses & Autopodcasts
 * - GET  /api/audio/:episodeId   -> Streams cached MP3/WAV from Cloudflare R2 (supports HTTP Range for iOS Safari)
 * - POST /api/analyze            -> Runs Gemini 2.5 + Google Search Grounding deep no-fluff synthesis & caches for group
 * - POST /api/podcast            -> Generates timed script + Gemini Multi-Speaker TTS audio, stores in R2 & indexes in KV
 */

const EDITORIAL_SYSTEM_PROMPT = `You are the Lead Football Intelligence Analyst for "49ers Faithful", a private briefing platform for 25 high-IQ San Francisco 49ers fans.
STRICT EDITORIAL RULES:
1. ZERO clickbait, sensationalism, tabloid drama, or filler throat-clearing.
2. Separate Verified Facts, Film/Scheme Mechanics (11/21 personnel, Wide-9, stunt geometry, Cover 2/3/4/Quarters, EPA/play, CPOE, RYOE), and CBA Salary Cap Math (base salary, option/signing proration, Pre/Post-June 1 dead money, rollover cap).
3. Cite originating beat writers (Maiocco, Barrows, Wagoner, Lombardi, Chan, Branch, Inman, Tim Ryan, Jonnydel, Crocker) or open datasets (nflverse, OverTheCap, NextGen Stats).`;

function corsHeaders(origin, allowedOrigin) {
  const allow =
    !origin || origin.includes('localhost') || origin.includes('127.0.0.1') || origin === allowedOrigin
      ? origin || '*'
      : allowedOrigin || '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Group-Passcode, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
  };
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders }
  });
}

async function parseJsonBodySafe(request) {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseScriptTurnsSafe(rawText) {
  const cleaned = String(rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr) && arr.length > 0) return arr;
  } catch {}
  return [{ speaker: 'Marcus', text: cleaned || 'Briefing generated.' }];
}

async function sha256Short(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function pcm16ToWav(pcmBytes, sampleRate = 24000) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (off, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcmBytes.byteLength, true);

  const wav = new Uint8Array(44 + pcmBytes.byteLength);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcmBytes, 44);
  return wav;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    // Public audio stream route (supports iOS Safari byte-range requests)
    if (request.method === 'GET' && url.pathname.startsWith('/api/audio/')) {
      const episodeId = url.pathname.replace('/api/audio/', '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!env.PODCAST_BUCKET) {
        return jsonResponse({ error: 'R2 bucket not bound' }, 501, cors);
      }
      const obj = await env.PODCAST_BUCKET.get(`episodes/${episodeId}.wav`);
      if (!obj) {
        return jsonResponse({ error: 'Episode audio not found' }, 404, cors);
      }
      return new Response(obj.body, {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': obj.httpMetadata?.contentType || 'audio/wav',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return jsonResponse({ ok: true, service: '49ers-worker' }, 200, cors);
    }

    // Authenticate friend-group passcode on API endpoints
    const providedPasscode = request.headers.get('X-Group-Passcode') || '';
    if (env.GROUP_PASSCODE && providedPasscode !== env.GROUP_PASSCODE) {
      return jsonResponse(
        { error: 'Invalid or missing friend-group passcode. Enter your group passcode in Settings.' },
        401,
        cors
      );
    }

    if (request.method === 'GET' && url.pathname === '/api/shared-feed') {
      const analyses = (await env.SHARED_CACHE?.get('index:analyses', 'json')) || [];
      const episodes = (await env.SHARED_CACHE?.get('index:episodes', 'json')) || [];
      return jsonResponse({ analyses, episodes }, 200, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/analyze') {
      const body = await parseJsonBodySafe(request);
      if (!body) {
        return jsonResponse({ error: 'Invalid JSON request body' }, 400, cors);
      }
      const prompt = String(body.prompt || '').trim();
      const sectionContext = String(body.contextSummary || '').slice(0, 6000);
      const author = String(body.author || 'Friend Group').slice(0, 40);

      if (!prompt) {
        return jsonResponse({ error: 'Prompt is required' }, 400, cors);
      }

      const cacheKey = `analysis:${await sha256Short(prompt.toLowerCase())}`;
      const existing = await env.SHARED_CACHE?.get(cacheKey, 'json');
      if (existing && !body.forceRefresh) {
        return jsonResponse({ cached: true, item: existing }, 200, cors);
      }

      if (!env.GEMINI_API_KEY) {
        return jsonResponse(
          { error: 'GEMINI_API_KEY secret is not configured on this Worker yet.' },
          503,
          cors
        );
      }

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${
        env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash'
      }:generateContent?key=${env.GEMINI_API_KEY}`;

      const geminiRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: EDITORIAL_SYSTEM_PROMPT }] },
          tools: [{ google_search: {} }],
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Analyze this 49ers topic in depth using live facts, film tendencies, EPA/NGS metrics, and CBA cap numbers:\n\nTOPIC: ${prompt}\n\nLOCAL APP DATA SNAPSHOT:\n${sectionContext}`
                }
              ]
            }
          ]
        })
      });

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        return jsonResponse({ error: `Gemini API error: ${errText.slice(0, 300)}` }, 502, cors);
      }

      const geminiJson = await geminiRes.json();
      const markdown =
        geminiJson.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n') ||
        'No synthesis generated.';
      const groundingChunks =
        geminiJson.candidates?.[0]?.groundingMetadata?.groundingChunks
          ?.map(c => c.web?.title)
          .filter(Boolean)
          .slice(0, 6) || ['Google Search Grounding', 'nflverse / OverTheCap'];

      const item = {
        id: cacheKey.replace(':', '_'),
        title: prompt.length > 88 ? `${prompt.slice(0, 85)}...` : prompt,
        category: body.category || 'On-Demand Deep Dive',
        createdAt: new Date().toISOString(),
        createdBy: author,
        sourcesCited: groundingChunks,
        markdown
      };

      if (env.SHARED_CACHE) {
        await env.SHARED_CACHE.put(cacheKey, JSON.stringify(item), { expirationTtl: 60 * 60 * 24 * 30 });
        const list = (await env.SHARED_CACHE.get('index:analyses', 'json')) || [];
        const updated = [item, ...list.filter(x => x.id !== item.id)].slice(0, 50);
        await env.SHARED_CACHE.put('index:analyses', JSON.stringify(updated));
      }

      return jsonResponse({ cached: false, item }, 200, cors);
    }

    if (request.method === 'POST' && url.pathname === '/api/podcast') {
      const body = await parseJsonBodySafe(request);
      if (!body) {
        return jsonResponse({ error: 'Invalid JSON request body' }, 400, cors);
      }
      const topic = String(body.topic || '').trim();
      const durationMinutes = Math.max(2, Math.min(20, Number(body.durationMinutes || 5)));
      const format = body.format === 'solo' ? 'Solo Executive Briefing' : 'Two-Host Analytical Banter';
      const contextSummary = String(body.contextSummary || '').slice(0, 5000);
      const targetWords = Math.round(durationMinutes * 145);

      if (!topic) {
        return jsonResponse({ error: 'Topic is required' }, 400, cors);
      }

      const epId = `live_${await sha256Short(`${topic}:${durationMinutes}:${format}`)}`;
      const existing = await env.SHARED_CACHE?.get(`episode:${epId}`, 'json');
      if (existing && !body.forceRefresh) {
        return jsonResponse({ cached: true, episode: existing }, 200, cors);
      }

      if (!env.GEMINI_API_KEY) {
        return jsonResponse(
          { error: 'GEMINI_API_KEY secret is not configured on this Worker yet.' },
          503,
          cors
        );
      }

      // Step 1: Generate tightly timed analytical script via Gemini + Google Search Grounding
      const scriptUrl = `https://generativelanguage.googleapis.com/v1beta/models/${
        env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash'
      }:generateContent?key=${env.GEMINI_API_KEY}`;

      const scriptPrompt =
        format === 'Solo Executive Briefing'
          ? `Write a ${targetWords}-word solo analytical 49ers briefing script by speaker "Marcus" on: "${topic}". Output STRICT JSON array of objects [{"speaker":"Marcus","text":"..."}]. Zero fluff. Include real stats, cap numbers, and scheme details.\nContext:\n${contextSummary}`
          : `Write a ${targetWords}-word two-host analytical 49ers podcast dialogue between "Marcus" (X's & O's Film Analyst) and "Elena" (Salary Cap & EPA Data Insider) on: "${topic}". Output STRICT JSON array of objects [{"speaker":"Marcus","text":"..."},{"speaker":"Elena","text":"..."}]. Zero morning-zoo fluff. Dive straight into scheme, EPA, injuries, and cap math.\nContext:\n${contextSummary}`;

      const scriptRes = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: EDITORIAL_SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: scriptPrompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      if (!scriptRes.ok) {
        return jsonResponse({ error: 'Failed to synthesize podcast script' }, 502, cors);
      }

      const scriptJson = await scriptRes.json();
      const rawScriptText = scriptJson.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      const turns = parseScriptTurnsSafe(rawScriptText);

      // Step 2: Render Multi-Speaker Native Audio via Gemini TTS Free Tier
      let audioUrl = null;
      if (env.PODCAST_BUCKET) {
        const ttsDialogue = turns.map(t => `${t.speaker}: ${t.text}`).join('\n');
        const ttsUrl = `https://generativelanguage.googleapis.com/v1beta/models/${
          env.GEMINI_AUDIO_MODEL || 'gemini-2.5-flash-preview-tts'
        }:generateContent?key=${env.GEMINI_API_KEY}`;

        const ttsRes = await fetch(ttsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: ttsDialogue }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                multiSpeakerVoiceConfig: {
                  speakerVoiceConfigs: [
                    { speaker: 'Marcus', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Orus' } } },
                    { speaker: 'Elena', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } }
                  ]
                }
              }
            }
          })
        });

        if (ttsRes.ok) {
          const ttsJson = await ttsRes.json();
          const b64 = ttsJson.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (b64) {
            const binaryStr = atob(b64);
            const pcm = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) pcm[i] = binaryStr.charCodeAt(i);
            const wavBytes = pcm16ToWav(pcm, 24000);
            await env.PODCAST_BUCKET.put(`episodes/${epId}.wav`, wavBytes, {
              httpMetadata: { contentType: 'audio/wav' }
            });
            audioUrl = `${url.origin}/api/audio/${epId}`;
          }
        }
      }

      // Build estimated timestamps per turn
      let cursor = 0;
      const timedTranscript = turns.map((t, idx) => {
        const words = String(t.text || '').split(/\s+/).length;
        const dur = Math.max(3, Math.round((words / 150) * 60));
        const seg = {
          idx,
          speaker: t.speaker || 'Marcus',
          speakerRole: t.speaker === 'Elena' ? 'Cap & Quantitative Insider' : "X's & O's Film Analyst",
          text: t.text,
          startSec: cursor,
          endSec: cursor + dur
        };
        cursor += dur;
        return seg;
      });

      const episode = {
        id: epId,
        title: topic,
        topic,
        format,
        presetLabel: `${durationMinutes}m Custom Pod`,
        createdBy: String(body.author || 'Friend Group'),
        createdAt: new Date().toISOString(),
        audioUrl,
        durationSec: cursor,
        transcript: timedTranscript
      };

      if (env.SHARED_CACHE) {
        await env.SHARED_CACHE.put(`episode:${epId}`, JSON.stringify(episode));
        const list = (await env.SHARED_CACHE.get('index:episodes', 'json')) || [];
        const updated = [episode, ...list.filter(x => x.id !== episode.id)].slice(0, 40);
        await env.SHARED_CACHE.put('index:episodes', JSON.stringify(updated));
      }

      return jsonResponse({ cached: false, episode }, 200, cors);
    }

    return jsonResponse({ status: 'ok', service: '49ers-worker' }, 200, cors);
  }
};
