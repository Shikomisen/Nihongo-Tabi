/**
 * app.js — router + screens.
 *
 * Vanilla ES modules, hash routing, no build step (README §3).
 * Screens render into #app; each render is a full teardown, which is fine
 * at this scale and removes a whole class of stale-state bugs.
 */

import { loadContent, getCategory, scenariosFor } from './content.js';
import * as deck from './deck.js';
import * as srs from './srs.js';
import * as audio from './audio.js';
import * as store from './store.js';
import { el, clear, phraseBlock, japaneseNode, notesBlock, tagRow, audioButton, toast } from './render.js';
import { renderPlacement } from './quiz.js';
import { renderScenarioList, renderScenario } from './scenario.js';

const app = () => document.getElementById('app');

/* ---------- routing ---------- */

const routes = [
  [/^\/?$/, home],
  [/^\/browse$/, browse],
  [/^\/category\/([\w-]+)$/, category],
  [/^\/study\/([\w-]+)$/, studyCategory],
  [/^\/review$/, review],
  [/^\/scenarios$/, (root) => renderScenarioList(root)],
  [/^\/scenario\/([\w-]+)$/, (root, id) => renderScenario(root, id)],
  [/^\/settings$/, settings],
];

function parseHash() {
  return decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
}

export function go(path) {
  location.hash = path;
}

async function router() {
  const path = parseHash();

  // The placement quiz gates everything else on first launch (README §4.1).
  if (!(await deck.isOnboarded())) {
    const root = clear(app());
    document.body.classList.add('onboarding');
    return renderPlacement(root, {
      onDone: () => {
        document.body.classList.remove('onboarding');
        go('/');
        router();
      },
    });
  }
  document.body.classList.remove('onboarding');

  for (const [pattern, handler] of routes) {
    const m = path.match(pattern);
    if (m) {
      const root = clear(app());
      window.scrollTo(0, 0);
      try {
        await handler(root, ...m.slice(1));
      } catch (err) {
        console.error(err);
        root.append(el('div', { class: 'screen' }, el('p', { class: 'error' }, String(err.message || err))));
      }
      highlightNav(path);
      return;
    }
  }
  go('/');
}

function highlightNav(path) {
  document.querySelectorAll('.tabbar a').forEach((a) => {
    const target = a.getAttribute('href').slice(1);
    a.classList.toggle('active', target === path || (target === '/' && path === '/'));
  });
}

/* ---------- shared bits ---------- */

function header(title, subtitle) {
  return el('header', { class: 'screen-header' },
    el('h1', {}, title),
    subtitle ? el('p', { class: 'lede' }, subtitle) : null);
}

async function playPhrase(phrase) {
  const result = await audio.play(phrase.audio);
  if (result === 'missing') toast('No audio clip for this phrase yet');
  return result;
}

/**
 * Inline furigana/romaji toggles (README §6, Day 2).
 *
 * Deliberately duplicated next to the content rather than buried in
 * Settings: deciding whether you need the reading is a per-card judgement
 * made mid-study, and a trip to Settings to check yourself is a trip you
 * won't make.
 */
function toggleStrip(onChange) {
  const make = async (key, label) => {
    const s = await deck.getSettings();
    return el('button', {
      class: `chip ${s[key] ? 'chip-on' : ''}`,
      type: 'button',
      'aria-pressed': s[key] ? 'true' : 'false',
      onclick: async () => {
        const cur = await deck.getSettings();
        await deck.saveSettings({ [key]: !cur[key] });
        onChange();
      },
    }, label);
  };

  const strip = el('div', { class: 'toggle-strip' });
  Promise.all([make('furigana', 'ふりがな'), make('romaji', 'romaji')])
    .then((chips) => chips.forEach((c) => strip.append(c)));
  return strip;
}

/* ---------- home / due today ---------- */

async function home(root) {
  const [summary, stats, streakDays, s, { categories }] = await Promise.all([
    deck.deckSummary(), deck.todayStats(), deck.streak(), deck.getSettings(), loadContent(),
  ]);

  const q = await deck.queue();
  const activeCats = categories.filter((c) => s.activeCategories.includes(c.id));

  root.append(
    el('div', { class: 'screen' },
      header('Today', dueLine(q.length, summary)),

      el('div', { class: 'stat-row' },
        stat(summary.due, 'due'),
        stat(Math.min(summary.new, s.newPerDay), 'new'),
        stat(stats.reviews, 'done today'),
        stat(streakDays, streakDays === 1 ? 'day streak' : 'day streak')),

      q.length
        ? el('div', {},
            el('button', { class: 'btn btn-primary btn-lg full', onclick: () => go('/review') },
              `Start review · ${q.length} card${q.length === 1 ? '' : 's'}`),
            queueBreakdown(q))
        : el('div', { class: 'empty-state' },
            el('p', {}, '✅ Nothing due right now.'),
            el('p', { class: 'muted' }, 'Add a category or study ahead from the browse screen.'),
            el('button', { class: 'btn btn-primary', onclick: () => go('/browse') }, 'Browse phrases')),

      el('h2', { class: 'section-title' }, 'In your deck'),
      el('div', { class: 'card-list' },
        activeCats.length
          ? await Promise.all(activeCats.map(categoryRow))
          : el('p', { class: 'muted' }, 'No categories active yet.')),

      await forecastBlock(),

      el('button', { class: 'btn btn-ghost full', onclick: () => go('/browse') }, 'Add more categories →')
    )
  );
}

/** What's actually in today's queue, split by why it's there. */
function queueBreakdown(queue) {
  const fresh = queue.filter((c) => c.state === 'new').length;
  const relearn = queue.filter((c) => c.state === 'learning').length;
  const due = queue.length - fresh - relearn;
  const parts = [
    due && `${due} to review`,
    relearn && `${relearn} relearning`,
    fresh && `${fresh} new`,
  ].filter(Boolean);
  return el('p', { class: 'muted small queue-breakdown' }, parts.join(' · '));
}

/**
 * Seven-day forecast straight off the SRS due dates — the thing that makes
 * the scheduler legible rather than a black box, and shows why adding six
 * categories at once is a bad idea.
 */
async function forecastBlock() {
  const s = await deck.getSettings();
  const active = new Set(s.activeCategories);
  const cards = (await deck.getDeck()).filter((c) => active.has(c.categoryId) && c.state !== 'new');

  const days = Array.from({ length: 7 }, (_, i) => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const count = cards.filter((c) =>
      i === 0 ? c.due < end.getTime() : c.due >= start.getTime() && c.due < end.getTime()
    ).length;
    return { label: i === 0 ? 'today' : start.toLocaleDateString(undefined, { weekday: 'short' }), count };
  });

  const peak = Math.max(1, ...days.map((d) => d.count));

  return el('section', {},
    el('h2', { class: 'section-title' }, 'Next 7 days'),
    el('div', { class: 'forecast' },
      days.map((d) =>
        el('div', { class: 'forecast-day' },
          el('div', { class: 'forecast-bar' },
            el('div', { class: 'forecast-fill', style: `height:${(d.count / peak) * 100}%` })),
          el('div', { class: 'forecast-count' }, String(d.count)),
          el('div', { class: 'forecast-label muted small' }, d.label)))));
}

function dueLine(queueLength, summary) {
  if (!summary.total) return 'Your deck is empty — add a category to get going.';
  if (!queueLength) return 'All caught up. Come back later today.';
  return `${queueLength} card${queueLength === 1 ? '' : 's'} waiting. ${summary.mature} are sticking.`;
}

function stat(value, label) {
  return el('div', { class: 'stat' }, el('div', { class: 'stat-value' }, String(value)), el('div', { class: 'stat-label' }, label));
}

async function categoryRow(cat) {
  const p = await deck.categoryProgress(cat.id);
  const studied = p.total - p.new;
  const pct = p.total ? Math.round((studied / p.total) * 100) : 0;
  return el('a', { class: 'row-card', href: `#/category/${cat.id}` },
    el('span', { class: 'row-icon' }, cat.icon || '📄'),
    el('span', { class: 'row-body' },
      el('span', { class: 'row-title' }, cat.title),
      el('span', { class: 'row-sub' },
        p.total ? `${studied}/${p.total} started · ${p.due} due` : `${cat.phrases.length} phrases`),
      el('span', { class: 'bar' }, el('span', { class: 'bar-fill', style: `width:${pct}%` }))),
    el('span', { class: 'row-chev' }, '›'));
}

/* ---------- browse ---------- */

async function browse(root) {
  const { categories } = await loadContent();
  const s = await deck.getSettings();

  const groups = [
    ['Week 1 — get off the plane', 1],
    ['Week 2 — moving around', 2],
    ['Week 3 — spending money', 3],
    ['Week 4 — edge cases & chat', 4],
  ];

  root.append(
    el('div', { class: 'screen' },
      header('Browse', 'Ordered by trip relevance, not alphabetically. Add categories a couple at a time — the review load is cumulative.'),
      groups.map(([label, week]) => {
        const inWeek = categories.filter((c) => (c.week ?? 1) === week);
        if (!inWeek.length) return null;
        return el('section', {},
          el('h2', { class: 'section-title' }, label),
          el('div', { class: 'card-list' }, inWeek.map((cat) => browseRow(cat, s))));
      })
    )
  );
}

function browseRow(cat, s) {
  const active = s.activeCategories.includes(cat.id);
  return el('div', { class: `row-card ${active ? 'is-active' : ''}` },
    el('span', { class: 'row-icon' }, cat.icon || '📄'),
    el('a', { class: 'row-body', href: `#/category/${cat.id}` },
      el('span', { class: 'row-title' }, cat.title),
      el('span', { class: 'row-sub' },
        cat.missing ? '⚠️ content file missing' : `${cat.phrases.length} phrases`)),
    active
      ? el('span', { class: 'pill pill-on' }, 'in deck')
      : el('button', {
          class: 'btn btn-small',
          onclick: async (e) => {
            e.preventDefault();
            const { added, seeded } = await deck.activateCategory(cat.id);
            toast(seeded ? `Added ${added} cards (${seeded} seeded forward)` : `Added ${added} cards`);
            router();
          },
        }, 'Add'));
}

/* ---------- category detail ---------- */

async function category(root, id) {
  const cat = await getCategory(id);
  if (!cat) { go('/browse'); return; }
  const s = await deck.getSettings();
  const active = s.activeCategories.includes(id);
  const progress = await deck.categoryProgress(id);
  const scenarios = await scenariosFor(id);

  root.append(
    el('div', { class: 'screen' },
      el('a', { class: 'back-link', href: '#/browse' }, '← Browse'),
      header(`${cat.icon || ''} ${cat.title}`, cat.description),

      scenarios.length
        ? el('div', { class: 'card-list scenario-teaser' },
            scenarios.map((sc) =>
              el('a', { class: 'row-card', href: `#/scenario/${sc.id}` },
                el('span', { class: 'row-icon' }, sc.icon || '🗣️'),
                el('span', { class: 'row-body' },
                  el('span', { class: 'row-title' }, sc.title),
                  el('span', { class: 'row-sub' }, 'Practise the full exchange')),
                el('span', { class: 'row-chev' }, '›'))))
        : null,

      toggleStrip(router),

      el('div', { class: 'action-row' },
        active
          ? el('button', { class: 'btn btn-primary', onclick: () => go(`/study/${id}`) }, 'Study this category')
          : el('button', {
              class: 'btn btn-primary',
              onclick: async () => {
                const { added } = await deck.activateCategory(id);
                toast(`Added ${added} cards to your deck`);
                router();
              },
            }, 'Add to deck'),
        active ? el('span', { class: 'muted small' }, `${progress.due} due · ${progress.new} new`) : null),

      el('div', { class: 'phrase-list' },
        cat.phrases.map((p) => phraseCard(p, s)))
    )
  );
}

function phraseCard(phrase, s) {
  const node = el('article', { class: 'phrase-card' },
    el('div', { class: 'phrase-main' },
      phraseBlock(phrase, s),
      audioButton(phrase, playPhrase)),
    notesBlock(phrase),
    tagRow(phrase));
  return node;
}

/* ---------- study & review ---------- */

async function studyCategory(root, id) {
  const cat = await getCategory(id);
  if (!cat) { go('/browse'); return; }
  if (!(await deck.isActive(id))) await deck.activateCategory(id);

  const all = await deck.getDeck();
  const scoped = all.filter((c) => c.categoryId === id);
  const s = await deck.getSettings();
  const queue = srs.buildQueue(scoped, { newLimit: s.newPerDay });

  if (!queue.length) {
    root.append(el('div', { class: 'screen' },
      el('a', { class: 'back-link', href: `#/category/${id}` }, '← Back'),
      el('div', { class: 'empty-state' },
        el('p', {}, `Nothing due in ${cat.title}.`),
        el('p', { class: 'muted' }, 'Everything here is scheduled further out. That is the system working.'),
        el('button', { class: 'btn btn-primary', onclick: () => go('/') }, 'Back to today'))));
    return;
  }

  await runSession(root, queue, { title: cat.title, exitTo: `#/category/${id}` });
}

async function review(root) {
  const queue = await deck.queue();
  if (!queue.length) { go('/'); return; }
  await runSession(root, queue, { title: 'Review', exitTo: '#/' });
}

/**
 * The core study loop. Front = Japanese; flip reveals meaning and notes;
 * grading feeds SM-2. Failed cards are pushed back into the same session
 * rather than disappearing for ten minutes.
 */
async function runSession(root, queue, { title, exitTo }) {
  const { phrases } = await loadContent();
  const s = await deck.getSettings();
  const total = queue.length;
  let done = 0;
  let flipped = false;
  let cards = [...queue];

  const view = el('div', { class: 'screen study' });
  root.append(view);

  async function draw() {
    if (!cards.length) return finish();
    const card = cards[0];
    const phrase = phrases.get(card.id);
    if (!phrase) { cards.shift(); return draw(); } // content removed under us
    clear(view);

    // Re-read settings each draw so the inline toggles take effect immediately.
    Object.assign(s, await deck.getSettings());

    const previews = srs.gradePreviews(card);

    view.append(
      el('div', { class: 'study-top' },
        el('a', { class: 'back-link', href: exitTo }, '✕'),
        el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: `width:${(done / total) * 100}%` })),
        el('span', { class: 'muted small' }, `${done}/${total}`)),

      el('div', {
        class: `study-card ${flipped ? 'flipped' : ''}`,
        onclick: () => { if (!flipped) { flipped = true; draw(); } },
      },
        el('div', { class: 'card-cat muted small' }, phrase.categoryTitle),
        japaneseNode(phrase, { furigana: s.furigana }),
        s.romaji ? el('div', { class: 'romaji' }, phrase.romaji) : null,
        audioButton(phrase, playPhrase),

        flipped
          ? el('div', { class: 'study-back' },
              el('div', { class: 'english big' }, phrase.english),
              notesBlock(phrase),
              tagRow(phrase))
          : el('p', { class: 'muted tap-hint' }, 'Tap to reveal')),

      toggleStrip(draw),

      flipped
        ? el('div', { class: 'grade-row' },
            gradeBtn('again', 'No idea', previews.AGAIN, srs.GRADE.AGAIN),
            gradeBtn('hard', 'Shaky', previews.HARD, srs.GRADE.HARD),
            gradeBtn('good', 'Got it', previews.GOOD, srs.GRADE.GOOD),
            gradeBtn('easy', 'Too easy', previews.EASY, srs.GRADE.EASY))
        : el('button', { class: 'btn btn-primary btn-lg full', onclick: () => { flipped = true; draw(); } }, 'Show answer')
    );

    if (s.autoPlayAudio && flipped) audio.play(phrase.audio);
  }

  function gradeBtn(cls, label, preview, quality) {
    return el('button', { class: `btn btn-grade grade-${cls}`, onclick: () => submit(quality) },
      el('strong', {}, label), el('span', { class: 'grade-when' }, preview));
  }

  async function submit(quality) {
    const card = cards.shift();
    const updated = await deck.grade(card.id, quality);
    done++;
    flipped = false;
    // A lapsed card comes back at the end of this session, not tomorrow.
    if (updated && quality < 3) cards.push(updated);
    draw();
  }

  async function finish() {
    document.removeEventListener('keydown', onKey);
    clear(view);
    const stats = await deck.todayStats();
    view.append(el('div', { class: 'empty-state' },
      el('h1', {}, 'Session done'),
      el('p', { class: 'lede' }, `${done} cards graded · ${stats.reviews} total today`),
      el('button', { class: 'btn btn-primary btn-lg', onclick: () => go('/') }, 'Back to today')));
  }

  // Keyboard shortcuts — desktop review is much faster with them.
  const onKey = (e) => {
    if (!view.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!flipped) { flipped = true; draw(); } }
    else if (flipped && ['1', '2', '3', '4'].includes(e.key)) {
      submit([srs.GRADE.AGAIN, srs.GRADE.HARD, srs.GRADE.GOOD, srs.GRADE.EASY][Number(e.key) - 1]);
    }
  };
  document.addEventListener('keydown', onKey);

  draw();
}

/* ---------- settings ---------- */

async function settings(root) {
  const s = await deck.getSettings();
  const summary = await deck.deckSummary();

  const toggle = (key, label, help) =>
    el('label', { class: 'setting' },
      el('span', {}, el('strong', {}, label), help ? el('span', { class: 'muted small' }, help) : null),
      el('input', {
        type: 'checkbox', checked: s[key],
        onchange: async (e) => { await deck.saveSettings({ [key]: e.target.checked }); applyTextSettings(); },
      }));

  root.append(
    el('div', { class: 'screen' },
      header('Settings'),
      el('div', { class: 'settings-list' },
        toggle('furigana', 'Furigana', 'Kana readings above kanji'),
        toggle('romaji', 'Romaji', 'Turn this off once the kana stick — README §6 suggests after week 1'),
        toggle('autoPlayAudio', 'Auto-play audio', 'Play the clip when a card is revealed'),

        el('label', { class: 'setting' },
          el('span', {}, el('strong', {}, 'New cards per day'), el('span', { class: 'muted small' }, 'Caps how fast the deck grows')),
          el('input', {
            type: 'number', min: '0', max: '50', value: String(s.newPerDay), class: 'num-input',
            onchange: (e) => deck.saveSettings({ newPerDay: Math.max(0, Number(e.target.value) || 0) }),
          })),

        el('label', { class: 'setting' },
          el('span', {}, el('strong', {}, 'Text size'), el('span', { class: 'muted small' }, 'Doubles as an accessibility control')),
          el('input', {
            type: 'range', min: '0.85', max: '1.6', step: '0.05', value: String(s.textScale),
            onchange: async (e) => { await deck.saveSettings({ textScale: Number(e.target.value) }); applyTextSettings(); },
          }))),

      el('h2', { class: 'section-title' }, 'Deck'),
      el('p', { class: 'muted' },
        `${summary.total} cards · ${summary.review} in review · ${summary.mature} mature · storage: ${store.backend()}`),

      el('button', {
        class: 'btn btn-danger',
        onclick: async () => {
          if (!confirm('Erase all progress, SRS state and placement results? This cannot be undone.')) return;
          await deck.resetEverything();
          location.reload();
        },
      }, 'Reset all progress')
    )
  );
}

/* ---------- boot ---------- */

export async function applyTextSettings() {
  const s = await deck.getSettings();
  document.documentElement.style.setProperty('--text-scale', String(s.textScale));
}

async function boot() {
  audio.primeOnFirstGesture();
  await applyTextSettings();

  if (await deck.maybeRetireRomaji()) {
    toast('Week 1 done — romaji is now off by default. Turn it back on in Settings.', 5000);
  }

  window.addEventListener('hashchange', router);
  await router();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  }
}

boot();
