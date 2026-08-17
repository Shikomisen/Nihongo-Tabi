/**
 * characters.js — the Characters section (hiragana, katakana, kanji).
 *
 * Two screens: a reference chart per set, and a list of sets. Review
 * itself is not implemented here — character cards are phrase-shaped
 * (see content.js → normaliseCharacter), so they go through the exact
 * same runSession() flashcard loop that phrases do. This file only has
 * to get the user into it.
 *
 * Kana render as the traditional grid by row; kanji as a browsable list
 * grouped by usage, each entry showing which phrases already contain it
 * so the two halves of the app reinforce each other rather than sitting
 * side by side (README §12).
 */

import { loadContent, getCharacterSet, gridFor } from './content.js';
import * as deck from './deck.js';
import * as audio from './audio.js';
import { el, clear, japaneseNode, toast } from './render.js';

const ROW_LABEL = {
  a: 'あ', ka: 'か', sa: 'さ', ta: 'た', na: 'な',
  ha: 'は', ma: 'ま', ya: 'や', ra: 'ら', wa: 'わ', n: 'ん',
  ga: 'が', za: 'ざ', da: 'だ', ba: 'ば', pa: 'ぱ',
  ki: 'き', shi: 'し', chi: 'ち', ni: 'に', hi: 'ひ',
  mi: 'み', ri: 'り', gi: 'ぎ', ji: 'じ', bi: 'び', pi: 'ぴ',
  extended: '—',
};

async function playCharacter(c) {
  const result = await audio.play(c.audio);
  if (result === 'missing') toast(`No audio clip for ${c.character} yet`);
  return result;
}

/* ---------- set list ---------- */

export async function renderCharacterList(root) {
  const { characterSets } = await loadContent();
  const s = await deck.getSettings();

  const rows = await Promise.all(characterSets.map(async (set) => {
    const progress = await deck.setProgress(set.id);
    const active = s.activeCharacterSets.includes(set.id);
    const studied = progress.total - progress.new;
    const pct = set.characters.length ? Math.round((studied / set.characters.length) * 100) : 0;

    return el('div', { class: `row-card ${active ? 'is-active' : ''}` },
      el('span', { class: 'row-icon char-icon' }, set.icon || '字'),
      el('a', { class: 'row-body', href: `#/characters/${set.id}` },
        el('span', { class: 'row-title' }, set.title),
        el('span', { class: 'row-sub' },
          set.missing
            ? '⚠️ content file missing'
            : active
              ? `${studied}/${set.characters.length} started · ${progress.due} due`
              : `${set.characters.length} characters`),
        active ? el('span', { class: 'bar' }, el('span', { class: 'bar-fill', style: `width:${pct}%` })) : null),
      active
        ? el('span', { class: 'pill pill-on' }, 'in deck')
        : el('button', {
            class: 'btn btn-small',
            onclick: async (e) => {
              e.preventDefault();
              const { added, seeded } = await deck.activateCharacterSet(set.id);
              toast(seeded ? `Added ${added} characters (${seeded} seeded forward)` : `Added ${added} characters`);
              renderCharacterList(clear(root));
            },
          }, 'Add'));
  }));

  const summary = await deck.characterSummary();
  const stats = await deck.todayStats();

  root.append(
    el('div', { class: 'screen' },
      el('header', { class: 'screen-header' },
        el('h1', {}, 'Characters'),
        el('p', { class: 'lede' },
          'Reading, kept separate from your phrase reviews so neither buries the other. ' +
          'Tap any character in a chart to hear it.')),

      summary.total
        ? el('div', {},
            el('div', { class: 'stat-row' },
              stat(summary.due, 'due'),
              stat(summary.new, 'unseen'),
              stat(stats.charReviews, 'done today'),
              stat(summary.mature, 'mature')),
            summary.due || summary.new
              ? el('button', {
                  class: 'btn btn-primary btn-lg full',
                  onclick: () => { location.hash = '/characters/review'; },
                }, 'Review characters')
              : el('p', { class: 'muted queue-breakdown' }, 'Nothing due right now.'))
        : el('p', { class: 'muted' },
            'No character sets in your deck yet. Add one below — hiragana is the place to start.'),

      el('h2', { class: 'section-title' }, 'Sets'),
      el('div', { class: 'card-list' }, rows),

      el('p', { class: 'muted small footnote' },
        'Handwriting and stroke-order practice are deliberately not here — this app is built for ' +
        'reading signs and menus on a trip, not for learning to write. See ASSUMPTIONS.md (A24).')
    )
  );
}

function stat(value, label) {
  return el('div', { class: 'stat' },
    el('div', { class: 'stat-value' }, String(value)),
    el('div', { class: 'stat-label' }, label));
}

/* ---------- chart / reference view ---------- */

export async function renderCharacterSet(root, setId) {
  const set = await getCharacterSet(setId);
  if (!set) { location.hash = '/characters'; return; }

  const s = await deck.getSettings();
  const active = s.activeCharacterSets.includes(setId);
  const progress = await deck.setProgress(setId);
  const { phrases } = await loadContent();

  const view = el('div', { class: 'screen' });
  root.append(view);

  view.append(
    el('a', { class: 'back-link', href: '#/characters' }, '← Characters'),
    el('header', { class: 'screen-header' },
      el('h1', {}, `${set.icon || ''} ${set.title}`),
      el('p', { class: 'lede' }, set.description)),

    el('div', { class: 'action-row' },
      active
        ? el('button', {
            class: 'btn btn-primary',
            onclick: () => { location.hash = `/characters/${setId}/study`; },
          }, 'Study this set')
        : el('button', {
            class: 'btn btn-primary',
            onclick: async () => {
              const { added } = await deck.activateCharacterSet(setId);
              toast(`Added ${added} characters to your deck`);
              renderCharacterSet(clear(root), setId);
            },
          }, 'Add to deck'),
      active ? el('span', { class: 'muted small' }, `${progress.due} due · ${progress.new} unseen`) : null),

    el('p', { class: 'muted small tap-hint chart-hint' }, 'Tap any character to hear it.'),

    set.layout === 'list' || set.script === 'kanji'
      ? kanjiList(set, phrases, s)
      : kanaChart(set, s)
  );
}

/* ---------- kana grid ---------- */

function kanaChart(set, settings) {
  const wrap = el('div', { class: 'char-groups' });

  for (const group of set.groups || []) {
    const rows = gridFor(set, group.id);
    if (!rows.length) continue;

    wrap.append(
      el('section', { class: 'char-group' },
        el('h2', { class: 'section-title' }, group.title),
        group.description ? el('p', { class: 'muted small' }, group.description) : null,
        el('div', { class: `kana-grid ${group.id === 'yoon' || group.id === 'extended' ? 'kana-grid-wide' : ''}` },
          rows.map((row) =>
            el('div', { class: 'kana-row' },
              el('div', { class: 'kana-row-label muted' }, ROW_LABEL[row.row] || row.row),
              row.cells.map((c) => (c ? kanaCell(c, settings) : el('div', { class: 'kana-cell kana-empty' }))))))));
  }

  return wrap;
}

function kanaCell(c, settings) {
  return el('button', {
    class: 'kana-cell',
    type: 'button',
    title: c.note || c.romaji,
    'aria-label': `${c.character}, ${c.romaji}`,
    onclick: (e) => {
      playCharacter(c);
      e.currentTarget.classList.add('just-played');
      setTimeout(() => e.currentTarget.classList.remove('just-played'), 400);
    },
  },
    el('span', { class: 'kana-char' }, c.character),
    settings.romaji ? el('span', { class: 'kana-romaji' }, c.romaji) : null);
}

/* ---------- kanji list ---------- */

function kanjiList(set, phrases, settings) {
  const wrap = el('div', { class: 'char-groups' });

  for (const group of set.groups || []) {
    const inGroup = set.characters.filter((c) => c.group === group.id);
    if (!inGroup.length) continue;

    wrap.append(
      el('section', { class: 'char-group' },
        el('h2', { class: 'section-title' }, `${group.title} · ${inGroup.length}`),
        group.description ? el('p', { class: 'muted small' }, group.description) : null,
        el('div', { class: 'kanji-list' }, inGroup.map((c) => kanjiRow(c, phrases, settings)))));
  }

  return wrap;
}

function kanjiRow(c, phrases, settings) {
  // Cross-references written by tools/crossref-kanji.mjs — the whole point
  // of the kanji set is that it overlaps the phrases already being studied.
  const refs = (c.seenIn || []).map((id) => phrases.get(id)).filter(Boolean);

  return el('article', { class: 'kanji-row' },
    el('button', {
      class: 'kanji-glyph',
      type: 'button',
      'aria-label': `${c.character}, ${c.romaji}`,
      onclick: (e) => {
        playCharacter(c);
        e.currentTarget.classList.add('just-played');
        setTimeout(() => e.currentTarget.classList.remove('just-played'), 400);
      },
    }, c.character),

    el('div', { class: 'kanji-body' },
      el('div', { class: 'kanji-meaning' }, c.meaning || c.english),
      el('div', { class: 'kanji-reading' },
        settings.furigana ? (c.readings || []).join('・') : '',
        settings.romaji ? el('span', { class: 'romaji' }, ` ${c.romaji}`) : null),
      c.note ? el('div', { class: 'note' }, c.note) : null,

      refs.length
        ? el('div', { class: 'kanji-refs' },
            el('span', { class: 'note-label' }, 'Already in your phrases'),
            el('div', { class: 'ref-list' },
              refs.map((p) =>
                el('a', { class: 'ref-chip', href: `#/category/${p.categoryId}`, title: p.english },
                  japaneseNode(p, { furigana: false })))))
        : null));
}

/* ---------- study entry points ---------- */

/**
 * Both of these just hand a queue to the shared flashcard session. The
 * character deck is separate from the phrase deck, but the review UI is
 * identical on purpose — one loop to learn, not two.
 */
export async function characterStudyQueue(setId = null) {
  return setId ? deck.characterQueue(setId) : deck.characterQueue();
}
