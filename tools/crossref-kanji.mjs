/**
 * crossref-kanji.mjs — links each kanji to the phrases it already appears in.
 *
 * The point of the Characters section is reinforcement, not a second
 * disconnected vocabulary list. This scans every phrase in content/ and
 * writes a `seenIn` array onto each kanji entry, so the app can show
 * "you already know this from: 出口はどこですか".
 *
 * Idempotent — safe to re-run whenever phrase content changes.
 *
 *   node tools/crossref-kanji.mjs
 *   node tools/crossref-kanji.mjs --check   # report only, write nothing
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const MAX_REFS = 6; // enough to show overlap without bloating the file

const readJSON = (rel) => JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'));

const manifest = readJSON('content/manifest.json');

/* ---------- gather every phrase ---------- */

const phrases = [];
for (const entry of manifest.categories) {
  if (!existsSync(resolve(ROOT, entry.file))) continue;
  const cat = readJSON(entry.file);
  for (const p of cat.phrases || []) {
    phrases.push({ id: p.id, japanese: p.japanese, english: p.english, category: cat.title });
  }
}

/* ---------- match ---------- */

const kanjiSet = (manifest.characterSets || []).find((s) => s.script === 'kanji');
const kanjiFile = kanjiSet ? kanjiSet.file : 'content/kanji-common.json';
const kanji = readJSON(kanjiFile);

let linked = 0;
let orphans = [];

for (const c of kanji.characters) {
  // Exact written form only. A component match would be a lie: 曜日 does
  // not appear in 日本語が少しわかります just because 日 does, and claiming
  // otherwise sends the learner to a phrase that doesn't contain the word.
  const matches = phrases.filter((p) => p.japanese.includes(c.character));
  const refs = matches.slice(0, MAX_REFS).map((p) => p.id);

  if (refs.length) {
    c.seenIn = refs;
    linked++;
  } else {
    delete c.seenIn;
    orphans.push(`${c.character} (${c.english})`);
  }
}

/* ---------- report ---------- */

const total = kanji.characters.length;
console.log(`Cross-referenced ${linked}/${total} kanji against ${phrases.length} phrases.`);

if (orphans.length) {
  console.log(`\n${orphans.length} not yet reinforced by any phrase (fine — they are signage-only):`);
  console.log(orphans.map((o) => `  · ${o}`).join('\n'));
}

const top = [...kanji.characters]
  .filter((c) => c.seenIn)
  .sort((a, b) => b.seenIn.length - a.seenIn.length)
  .slice(0, 5);
console.log('\nMost reinforced:');
for (const c of top) console.log(`  ${c.character.padEnd(6)} ${c.seenIn.length} phrases — ${c.seenIn.join(', ')}`);

if (CHECK) {
  console.log('\n--check: nothing written.');
  process.exit(0);
}

writeFileSync(resolve(ROOT, kanjiFile), JSON.stringify(kanji, null, 2) + '\n');
console.log(`\nWrote ${kanjiFile}`);
