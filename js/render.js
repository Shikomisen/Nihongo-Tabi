/**
 * render.js — small DOM helpers shared by every screen.
 *
 * No framework, no build step (README §3). Just element creation and the
 * furigana/romaji rendering that the toggles in §6 drive.
 */

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * Renders a phrase's Japanese with optional ruby furigana.
 *
 * Furigana is stored as segments: [{ b: "電車", r: "でんしゃ" }, { b: "は" }]
 * so the reading attaches to the right kanji run rather than the whole
 * string. Falls back to the plain `japanese` field if segments are absent.
 */
export function japaneseNode(phrase, { furigana = true } = {}) {
  const wrap = el('span', { class: 'jp' });

  if (!furigana || !Array.isArray(phrase.furigana) || phrase.furigana.length === 0) {
    wrap.textContent = phrase.japanese;
    return wrap;
  }

  for (const seg of phrase.furigana) {
    if (seg.r) {
      wrap.append(el('ruby', {}, seg.b, el('rp', {}, '('), el('rt', {}, seg.r), el('rp', {}, ')')));
    } else {
      wrap.append(document.createTextNode(seg.b));
    }
  }
  return wrap;
}

/** The standard phrase block: Japanese, romaji, English — toggles applied. */
export function phraseBlock(phrase, settings, { size = 'md' } = {}) {
  return el(
    'div',
    { class: `phrase-block phrase-${size}` },
    japaneseNode(phrase, { furigana: settings.furigana }),
    settings.romaji ? el('div', { class: 'romaji' }, phrase.romaji) : null,
    el('div', { class: 'english' }, phrase.english)
  );
}

export function tagRow(phrase) {
  const tags = phrase.tags || [];
  if (!tags.length) return null;
  return el('div', { class: 'tags' }, tags.map((t) => el('span', { class: 'tag' }, t)));
}

/** Register / anime-divergence notes (README §6). */
export function notesBlock(phrase) {
  const parts = [];
  if (phrase.registerNotes) {
    parts.push(
      el('div', { class: 'note' }, el('span', { class: 'note-label' }, 'Register'), phrase.registerNotes)
    );
  }
  if (phrase.animeNote) {
    parts.push(
      el(
        'div',
        { class: 'note note-anime' },
        el('span', { class: 'note-label' }, 'From anime?'),
        phrase.animeNote
      )
    );
  }
  return parts.length ? el('div', { class: 'notes' }, parts) : null;
}

export function audioButton(phrase, onPlay) {
  if (!phrase.audio) return null;
  const btn = el(
    'button',
    { class: 'audio-btn', type: 'button', 'aria-label': `Play audio for ${phrase.romaji}` },
    '🔊'
  );
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    btn.classList.add('playing');
    const result = await onPlay(phrase);
    btn.classList.remove('playing');
    if (result === 'missing') {
      btn.classList.add('audio-missing');
      btn.title = 'No audio clip generated for this phrase yet';
    }
  });
  return btn;
}

export function toast(message, ms = 2400) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host' });
    document.body.append(host);
  }
  const node = el('div', { class: 'toast' }, message);
  host.append(node);
  setTimeout(() => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 300);
  }, ms);
}
