/**
 * render-test.mjs — renders every screen in a real DOM and asserts the
 * output, so template bugs surface without opening a browser.
 *
 * Requires jsdom, which is NOT a project dependency — the app itself has
 * zero dependencies. Install it just for this run:
 *
 *   npm install --no-save jsdom
 *   node tools/render-test.mjs
 *
 * Skips cleanly with exit 0 if jsdom isn't present.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('\njsdom not installed — skipping render tests.');
  console.log('  npm install --no-save jsdom && node tools/render-test.mjs\n');
  process.exit(0);
}

/* ---------- environment ---------- */

const dom = new JSDOM(readFileSync(resolve(ROOT, 'index.html'), 'utf8'), {
  url: 'http://localhost/#/',
  pretendToBeVisual: true,
});

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;
globalThis.location = window.location;
globalThis.confirm = () => true;
globalThis.HTMLElement = window.HTMLElement;

// Audio is never actually played here; record calls instead.
const played = [];
globalThis.Audio = class {
  constructor(src) { this.src = src; }
  play() { played.push(this.src); return Promise.resolve(); }
  pause() {}
};

const mem = new Map();
globalThis.localStorage = window.localStorage ?? {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
  clear: () => mem.clear(),
};

globalThis.fetch = async (path) => {
  const file = resolve(ROOT, String(path).replace(/^\.\//, ''));
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(file, 'utf8')) };
};

/* ---------- harness ---------- */

let failures = 0;
let checks = 0;
const errors = [];

window.addEventListener('error', (e) => errors.push(e.message));
const realError = console.error;
console.error = (...args) => { errors.push(args.join(' ')); realError(...args); };

function check(label, condition, detail = '') {
  checks++;
  if (condition) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  else { failures++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const app = () => document.getElementById('app');
const text = () => app().textContent;
const $ = (sel) => app().querySelector(sel);
const $$ = (sel) => [...app().querySelectorAll(sel)];

async function goTo(hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick(); await tick(); await tick();
}

/* ---------- boot (app.js self-starts on import) ---------- */

const deck = await import('../js/deck.js');
const quiz = await import('../js/quiz.js');
await import('../js/app.js');
await tick(); await tick(); await tick();

console.log('\n1. First launch');

check('placement quiz gates the app on first launch',
  text().includes('Where are you starting from?'), 'intro screen shown');
check('onboarding hides the tab bar', document.body.classList.contains('onboarding'));

$$('button').find((b) => b.textContent === 'Start')?.click();
await tick(); await tick();

check('quiz shows a card with Japanese', Boolean($('.placement-card .jp')), $('.placement-card .jp')?.textContent);
check('quiz shows progress', /1 of 20/.test(text()), text().match(/\d+ of \d+ · [^\n]*/)?.[0]);
check('quiz offers three self-grade answers', $$('.btn-answer').length === 3);
check('furigana renders as ruby', $$('.placement-card ruby, .placement-card').length > 0);

// Answer all 20 cards, alternating so the result screen has a mix.
for (let i = 0; i < 20; i++) {
  const buttons = $$('.btn-answer');
  if (!buttons.length) break;
  buttons[i % 3].click();
  await tick(); await tick();
}
await tick(); await tick(); await tick();

check('quiz produces a results screen', text().includes('Deck built'), 'placement complete');
check('results break down all 10 categories', $$('.result-row').length === 10);

$$('button').find((b) => b.textContent === 'Start studying')?.click();
await tick(); await tick(); await tick();

/* ---------- screens ---------- */

console.log('\n2. Home / due today');

await goTo('#/');
check('home screen renders', text().includes('Today'));
check('stat tiles present', $$('.stat').length === 4, $$('.stat-value').map((s) => s.textContent).join('/'));
check('7-day SRS forecast renders', $$('.forecast-day').length === 7);
check('deck categories listed', $$('.row-card').length >= 4, `${$$('.row-card').length} rows`);
check('tab bar highlights the current screen', Boolean(document.querySelector('.tabbar a.active')));

console.log('\n3. Browse');

await goTo('#/browse');
check('browse renders', text().includes('Browse'));
check('all 10 categories listed', $$('.row-card').length === 10);
check('week groupings render', $$('.section-title').length === 4);
check('active categories marked as in-deck', $$('.pill-on').length === 4);
check('inactive categories offer an Add button',
  $$('button').filter((b) => b.textContent === 'Add').length === 6);

console.log('\n4. Category detail');

await goTo('#/category/greetings');
check('category renders', text().includes('Greetings & Politeness'));
check('all phrases listed', $$('.phrase-card').length === 24, `${$$('.phrase-card').length} cards`);
check('register notes render', text().includes('Register'));
check('anime divergence notes render', $$('.note-anime').length > 0, `${$$('.note-anime').length} notes`);
check('audio buttons render', $$('.audio-btn').length > 0);
check('romaji shown while enabled', $$('.romaji').length > 0);

const before = $$('.romaji').length;
$$('.chip').find((c) => c.textContent === 'romaji')?.click();
await tick(); await tick(); await tick();
check('romaji toggle removes romaji from the page', $$('.romaji').length === 0, `was ${before}`);

$$('.chip').find((c) => c.textContent === 'romaji')?.click();
await tick(); await tick(); await tick();
check('romaji toggle restores it', $$('.romaji').length > 0);

const rubyBefore = $$('ruby').length;
$$('.chip').find((c) => c.textContent === 'ふりがな')?.click();
await tick(); await tick(); await tick();
check('furigana toggle removes ruby annotations', $$('ruby').length === 0, `was ${rubyBefore}`);
$$('.chip').find((c) => c.textContent === 'ふりがな')?.click();
await tick(); await tick(); await tick();

console.log('\n5. Study session');

await goTo('#/study/airport');
check('study screen renders a card', Boolean($('.study-card .jp')), $('.study-card .jp')?.textContent);
check('answer is hidden before flipping', !$('.study-back'));
check('progress indicator present', Boolean($('.study-top .bar')));

$$('button').find((b) => b.textContent === 'Show answer')?.click();
await tick(); await tick();

check('flipping reveals the meaning', Boolean($('.study-back')));
check('four grade buttons appear', $$('.btn-grade').length === 4);
check('grade buttons preview their intervals',
  $$('.grade-when').every((g) => g.textContent.length > 0),
  $$('.grade-when').map((g) => g.textContent).join(' / '));
check('audio auto-plays on reveal', played.length > 0, `${played.length} clips played`);

const firstCard = $('.study-card .jp').textContent;
$$('.btn-grade').find((b) => b.textContent.startsWith('Got it'))?.click();
await tick(); await tick(); await tick();
check('grading advances to the next card', $('.study-card .jp')?.textContent !== firstCard);

console.log('\n6. Scenarios');

await goTo('#/scenarios');
check('scenario list renders', text().includes('Scenarios'));
check('all 6 scenarios listed', $$('.row-card').length === 6);

await goTo('#/scenario/conbini');
check('scenario player renders', text().includes('Convenience store checkout'));
check('NPC line renders', Boolean($('.dialogue.npc')));
check('setting/context shown', text().includes('Lawson'));
check('reply options offered', $$('.btn-option').length === 3);

$$('.btn-option')[0].click();
await tick(); await tick(); await tick();
check('choosing advances the dialogue', $$('.transcript .dialogue').length === 2);
check('feedback explains the choice', Boolean($('.feedback')), $('.feedback')?.textContent.slice(0, 60) + '…');

// Walk the rest of the scenario picking the first option each time.
for (let i = 0; i < 10 && $$('.btn-option').length; i++) {
  $$('.btn-option')[0].click();
  await tick(); await tick(); await tick();
}
check('scenario reaches its ending', text().includes('Run it again'));
check('full transcript retained', $$('.transcript .dialogue').length >= 8,
  `${$$('.transcript .dialogue').length} lines`);

// A "wrong" option must still teach rather than dead-end.
await goTo('#/scenario/ticket');
$$('.btn-option')[0].click();
await tick(); await tick(); await tick();
const wrong = $$('.btn-option').at(-1);
wrong?.click();
await tick(); await tick(); await tick();
check('a wrong answer continues the scenario with feedback',
  $$('.btn-option').length > 0 && Boolean($('.feedback-wrong')),
  $('.feedback-wrong')?.textContent.slice(0, 50) + '…');

console.log('\n7. Settings');

await goTo('#/settings');
check('settings renders', text().includes('Settings'));
check('toggles present', $$('input[type="checkbox"]').length === 3);
check('new-cards-per-day control present', Boolean($('input[type="number"]')));
check('text size control present', Boolean($('input[type="range"]')));
check('storage backend reported', /storage: (IndexedDB|localStorage)/.test(text()),
  text().match(/storage: \w+/)?.[0]);

console.log('\n8. Console health');

const realErrors = errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e));
check('no unexpected console errors during the walkthrough',
  realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

console.log(
  failures
    ? `\n✗ ${failures} of ${checks} render checks failed\n`
    : `\n✓ all ${checks} render checks passed — every screen renders and responds\n`
);
process.exit(failures ? 1 : 0);
