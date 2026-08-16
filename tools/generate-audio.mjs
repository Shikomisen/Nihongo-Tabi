/**
 * generate-audio.mjs — build-time TTS pass (README §3-audio).
 *
 * This is a ONE-TIME build step, not a runtime dependency. It walks the
 * content manifest, synthesises every phrase to an mp3, and writes it to
 * the path already declared in that phrase's `audio` field. The app then
 * just plays a file — no speechSynthesis call, no dependency on the end
 * user's device having a Japanese voice installed.
 *
 * Usage:
 *   node tools/generate-audio.mjs                 # only missing clips
 *   node tools/generate-audio.mjs --force         # re-synthesise everything
 *   node tools/generate-audio.mjs --only greetings,numbers
 *   node tools/generate-audio.mjs --check         # report coverage, generate nothing
 *
 * Source: Google Translate's public TTS endpoint (the same one gTTS
 * wraps), used here for a few hundred short public-domain phrases. Swap
 * `synthesise()` for eSpeak-NG, a paid API, or real voice recordings and
 * nothing else in the project changes — Phase 2 (README §9) is a
 * drop-in replacement of these files.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const CHECK = args.includes('--check');
const ONLY = (() => {
  const i = args.indexOf('--only');
  return i >= 0 && args[i + 1] ? new Set(args[i + 1].split(',')) : null;
})();

const THROTTLE_MS = 350;   // be a good citizen against a free endpoint
const MAX_RETRIES = 3;
const MIN_VALID_BYTES = 800; // anything smaller is an error page, not audio

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJSON(relPath) {
  return JSON.parse(readFileSync(resolve(ROOT, relPath), 'utf8'));
}

/**
 * Synthesise one line of Japanese to mp3 bytes.
 * The whole TTS-vendor decision is contained in this function.
 */
async function synthesise(text) {
  const url =
    'https://translate.google.com/translate_tts' +
    `?ie=UTF-8&q=${encodeURIComponent(text)}&tl=ja&client=tw-ob&ttsspeed=1`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      Referer: 'https://translate.google.com/',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MIN_VALID_BYTES) throw new Error(`suspiciously small response (${buf.length}B)`);
  return buf;
}

async function synthesiseWithRetry(text) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await synthesise(text);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) await sleep(1200 * attempt); // back off
    }
  }
  throw lastErr;
}

/* ---------- collect work ---------- */

const manifest = readJSON('content/manifest.json');
const jobs = [];
const problems = [];

for (const entry of manifest.categories) {
  if (ONLY && !ONLY.has(entry.id)) continue;
  const path = resolve(ROOT, entry.file);
  if (!existsSync(path)) {
    problems.push(`missing content file: ${entry.file}`);
    continue;
  }
  const cat = JSON.parse(readFileSync(path, 'utf8'));
  for (const p of cat.phrases || []) {
    if (!p.audio) { problems.push(`${p.id}: no audio path declared`); continue; }
    // audioHint carries the kana reading, which the synthesiser handles far
    // more reliably than raw kanji.
    const text = p.audioHint || p.japanese;
    jobs.push({ id: p.id, category: entry.id, text, out: resolve(ROOT, p.audio) });
  }
}

const existing = jobs.filter((j) => existsSync(j.out) && statSync(j.out).size >= MIN_VALID_BYTES);
const todo = FORCE ? jobs : jobs.filter((j) => !existing.includes(j));

console.log(`Phrases: ${jobs.length}  ·  already generated: ${existing.length}  ·  to generate: ${todo.length}`);
if (problems.length) {
  console.log('\nContent problems:');
  problems.forEach((p) => console.log(`  ! ${p}`));
}

if (CHECK) {
  const missing = jobs.filter((j) => !existsSync(j.out));
  if (missing.length) {
    console.log(`\n${missing.length} clips missing:`);
    missing.slice(0, 20).forEach((m) => console.log(`  - ${m.id} (${m.category})`));
    if (missing.length > 20) console.log(`  … and ${missing.length - 20} more`);
  } else {
    console.log('\nAll phrases have audio. ✅');
  }
  process.exit(missing.length ? 1 : 0);
}

if (!todo.length) {
  console.log('Nothing to do. Use --force to re-synthesise.');
  process.exit(0);
}

/* ---------- run ---------- */

let ok = 0;
const failed = [];

for (const [i, job] of todo.entries()) {
  mkdirSync(dirname(job.out), { recursive: true });
  const label = `[${String(i + 1).padStart(3)}/${todo.length}] ${job.id}`;
  try {
    const bytes = await synthesiseWithRetry(job.text);
    writeFileSync(job.out, bytes);
    ok++;
    console.log(`${label}  ✓  ${job.text}  (${(bytes.length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    failed.push({ ...job, error: err.message });
    console.log(`${label}  ✗  ${job.text}  — ${err.message}`);
  }
  await sleep(THROTTLE_MS);
}

console.log(`\nDone. ${ok} generated, ${failed.length} failed.`);
if (failed.length) {
  console.log('Re-run the script to retry just the failures:');
  failed.forEach((f) => console.log(`  - ${f.id}: ${f.error}`));
  process.exit(1);
}
