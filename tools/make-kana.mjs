/**
 * make-kana.mjs — generates content/hiragana.json and content/katakana.json.
 *
 * Kana is a grid, not a vocabulary list: hand-writing 220 near-identical
 * JSON entries invites typos that no test would catch, because a wrong
 * romaji on ぬ still validates. Generating from a compact table means the
 * romaji conventions are stated once, in one place.
 *
 * The output files are committed — this is a build tool, not a runtime
 * dependency. Re-run it if the table changes.
 *
 *   node tools/make-kana.mjs
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- tables ----------
 * Each row: [rowId, hiragana…, katakana…, romaji…]
 * Romaji follows Hepburn, which is what romaji signage in Japan uses:
 * shi/chi/tsu/fu/ji, not si/ti/tu/hu/zi.
 */

const COLUMNS = ['a', 'i', 'u', 'e', 'o'];

const BASE = [
  ['a',  'あいうえお', 'アイウエオ', ['a', 'i', 'u', 'e', 'o']],
  ['ka', 'かきくけこ', 'カキクケコ', ['ka', 'ki', 'ku', 'ke', 'ko']],
  ['sa', 'さしすせそ', 'サシスセソ', ['sa', 'shi', 'su', 'se', 'so']],
  ['ta', 'たちつてと', 'タチツテト', ['ta', 'chi', 'tsu', 'te', 'to']],
  ['na', 'なにぬねの', 'ナニヌネノ', ['na', 'ni', 'nu', 'ne', 'no']],
  ['ha', 'はひふへほ', 'ハヒフヘホ', ['ha', 'hi', 'fu', 'he', 'ho']],
  ['ma', 'まみむめも', 'マミムメモ', ['ma', 'mi', 'mu', 'me', 'mo']],
  ['ya', 'やゆよ',    'ヤユヨ',    ['ya', 'yu', 'yo'], ['a', 'u', 'o']],
  ['ra', 'らりるれろ', 'ラリルレロ', ['ra', 'ri', 'ru', 're', 'ro']],
  ['wa', 'わを',      'ワヲ',      ['wa', 'wo'], ['a', 'o']],
  ['n',  'ん',        'ン',        ['n'], ['n']],
];

// Voiced (dakuten) and semi-voiced (handakuten) rows.
const DAKUTEN = [
  ['ga', 'がぎぐげご', 'ガギグゲゴ', ['ga', 'gi', 'gu', 'ge', 'go'],  'dakuten'],
  ['za', 'ざじずぜぞ', 'ザジズゼゾ', ['za', 'ji', 'zu', 'ze', 'zo'],  'dakuten'],
  ['da', 'だぢづでど', 'ダヂヅデド', ['da', 'ji', 'zu', 'de', 'do'],  'dakuten'],
  ['ba', 'ばびぶべぼ', 'バビブベボ', ['ba', 'bi', 'bu', 'be', 'bo'],  'dakuten'],
  ['pa', 'ぱぴぷぺぽ', 'パピプペポ', ['pa', 'pi', 'pu', 'pe', 'po'],  'handakuten'],
];

// ぢ/づ collide with じ/ず in Hepburn. Keep the romaji honest and
// disambiguate only the machine-facing id.
const ID_OVERRIDE = { 'da-i': 'di', 'da-u': 'du' };

// Yōon: consonant + small ya/yu/yo, written as one mora.
const YOON = [
  ['ki', 'き', 'キ', ['kya', 'kyu', 'kyo']],
  ['shi', 'し', 'シ', ['sha', 'shu', 'sho']],
  ['chi', 'ち', 'チ', ['cha', 'chu', 'cho']],
  ['ni', 'に', 'ニ', ['nya', 'nyu', 'nyo']],
  ['hi', 'ひ', 'ヒ', ['hya', 'hyu', 'hyo']],
  ['mi', 'み', 'ミ', ['mya', 'myu', 'myo']],
  ['ri', 'り', 'リ', ['rya', 'ryu', 'ryo']],
  ['gi', 'ぎ', 'ギ', ['gya', 'gyu', 'gyo']],
  ['ji', 'じ', 'ジ', ['ja', 'ju', 'jo']],
  ['bi', 'び', 'ビ', ['bya', 'byu', 'byo']],
  ['pi', 'ぴ', 'ピ', ['pya', 'pyu', 'pyo']],
];

const SMALL_HIRA = ['ゃ', 'ゅ', 'ょ'];
const SMALL_KATA = ['ャ', 'ュ', 'ョ'];

/**
 * Katakana-only combinations for foreign sounds. Not decorative — a
 * traveller reads these constantly (メニュー, チェックイン, ウィスキー),
 * so "full functional set" for katakana has to include them.
 */
const EXTENDED = [
  ['ファ', 'fa'], ['フィ', 'fi'], ['フェ', 'fe'], ['フォ', 'fo'],
  ['ティ', 'ti'], ['ディ', 'di'], ['ウィ', 'wi'], ['ウェ', 'we'],
  ['ジェ', 'je'], ['チェ', 'che'], ['シェ', 'she'], ['ヴ', 'vu'],
];

/* ---------- notes worth attaching ---------- */

const NOTES = {
  'shi': 'Written "shi", never "si" — Hepburn romanisation is what road signs and station names use.',
  'tsu': 'The small version っ/ッ doubles the next consonant instead: きって = kitte.',
  'fu': 'Between "fu" and "hu" — the lips barely touch. ふ is the one Westerners over-pronounce.',
  'wo': 'Pronounced "o". Only ever used as the object particle, never inside a word.',
  'n': 'The only kana that is a consonant on its own, and the only one that can end a word.',
  'ha': 'As the topic particle it is pronounced "wa", not "ha" — 私は = watashi wa.',
  'he': 'As the direction particle it is pronounced "e", not "he".',
  'ji': 'じ and ぢ are both "ji"; じ is the one you will almost always want.',
  'zu': 'ず and づ are both "zu"; ず is the common one.',
};

const KATA_NOTES = {
  'a': 'Katakana is for loanwords, foreign names, onomatopoeia and emphasis — menus and product packaging are full of it.',
  'n': 'Easily confused with ソ (so). ン ends low-left to high-right; ソ strokes downward.',
  'shi': 'シ (shi) vs ツ (tsu) is the classic katakana trap. シ strokes come in low and flat; ツ strokes come down from the top.',
  'tsu': 'ツ (tsu) vs シ (shi) — compare them side by side and learn them as a pair, not separately.',
  'so': 'ソ (so) vs ン (n). Learn this pair together with シ/ツ.',
};

/* ---------- build ---------- */

function entry({ script, id, character, romaji, row, column, group, difficulty, note }) {
  const prefix = script === 'hiragana' ? 'hira' : 'kata';
  return {
    id: `${prefix}-${id}`,
    character,
    // `japanese` / `furigana` / `english` mirror the phrase schema so the
    // existing flashcard, furigana toggle and audio components render a
    // character with no special-casing (see ASSUMPTIONS A20).
    japanese: character,
    furigana: [{ b: character }],
    readings: [character],
    romaji,
    english: null,
    audio: `audio/ja/chars/${prefix}-${id}.mp3`,
    audioHint: character,
    row,
    column,
    group,
    tags: [script, group],
    difficulty,
    ...(note ? { note } : {}),
  };
}

function buildScript(script) {
  const kanaIndex = script === 'hiragana' ? 1 : 2;
  const small = script === 'hiragana' ? SMALL_HIRA : SMALL_KATA;
  const out = [];

  for (const [row, hira, kata, romaji, cols] of BASE) {
    const chars = [...(kanaIndex === 1 ? hira : kata)];
    const columns = cols || COLUMNS;
    chars.forEach((character, i) => {
      const note = (script === 'katakana' && KATA_NOTES[romaji[i]]) || NOTES[romaji[i]];
      out.push(entry({
        script, id: romaji[i], character, romaji: romaji[i],
        row, column: columns[i], group: 'base', difficulty: 1, note,
      }));
    });
  }

  for (const [row, hira, kata, romaji, group] of DAKUTEN) {
    const chars = [...(kanaIndex === 1 ? hira : kata)];
    chars.forEach((character, i) => {
      const id = ID_OVERRIDE[`${row}-${COLUMNS[i]}`] || romaji[i];
      out.push(entry({
        script, id, character, romaji: romaji[i],
        row, column: COLUMNS[i], group, difficulty: 2,
        note: NOTES[romaji[i]],
      }));
    });
  }

  for (const [base, hira, kata, romaji] of YOON) {
    const lead = kanaIndex === 1 ? hira : kata;
    romaji.forEach((r, i) => {
      out.push(entry({
        script, id: r, character: lead + small[i], romaji: r,
        row: base, column: ['ya', 'yu', 'yo'][i], group: 'yoon', difficulty: 3,
        note: i === 0 && base === 'ki'
          ? 'Written small, read as a single beat: きゃ is one mora, not two.'
          : undefined,
      }));
    });
  }

  if (script === 'katakana') {
    for (const [character, romaji] of EXTENDED) {
      // Namespaced: ディ (extended) and ヂ (dakuten) both romanise to "di".
      out.push(entry({
        script, id: `ext-${romaji}`, character, romaji,
        row: 'extended', column: romaji, group: 'extended', difficulty: 3,
        note: 'Katakana-only combination for a sound Japanese does not natively have.',
      }));
    }
  }

  return out;
}

const META = {
  hiragana: {
    title: 'Hiragana',
    description:
      'The core syllabary — grammar, particles and any Japanese word without kanji. ' +
      'Learn this first: it unlocks the furigana readings used everywhere else in the app.',
  },
  katakana: {
    title: 'Katakana',
    description:
      'Loanwords, foreign names and menus. Often more immediately useful to a traveller than hiragana, ' +
      'because so much of it is English you can already understand once you can read it.',
  },
};

for (const script of ['hiragana', 'katakana']) {
  const characters = buildScript(script);
  const file = {
    schemaVersion: 1,
    id: script,
    kind: 'characters',
    title: META[script].title,
    script,
    description: META[script].description,
    groups: [
      { id: 'base', title: 'Base', description: 'The 46 core characters.' },
      { id: 'dakuten', title: 'Dakuten ゛', description: 'Voiced: k→g, s→z, t→d, h→b.' },
      { id: 'handakuten', title: 'Handakuten ゜', description: 'h→p.' },
      { id: 'yoon', title: 'Yōon', description: 'Contracted sounds — consonant + small ya/yu/yo, one beat.' },
      ...(script === 'katakana'
        ? [{ id: 'extended', title: 'Extended', description: 'Foreign-sound combinations, katakana only.' }]
        : []),
    ],
    characters,
  };

  const path = resolve(ROOT, `content/${script}.json`);
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n');

  const counts = characters.reduce((acc, c) => ({ ...acc, [c.group]: (acc[c.group] || 0) + 1 }), {});
  console.log(
    `  content/${script}.json  ${characters.length} characters  ` +
    Object.entries(counts).map(([g, n]) => `${g}:${n}`).join(' ')
  );
}

console.log('Kana content written.');
