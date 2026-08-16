# Assumptions & Decisions

Running log of calls made during the build where the README didn't specify,
per §1. Each entry says what was decided and why, so it can be revisited.

---

## Day 1

### A1 — Repo has no GitHub remote
The GitHub CLI (`gh`) is **not installed** on this machine, so no GitHub repo
was created and nothing was pushed. The local git repo is initialised and
committed on `main`.

**To connect a remote manually:**
```bash
git remote add origin https://github.com/<you>/nihongo-tabi.git
git push -u origin main
npm run deploy        # publishes to the gh-pages branch
```
Then enable GitHub Pages once: *Settings → Pages → Source: Deploy from a
branch → `gh-pages` / (root)*.

`npm run deploy` already detects the missing remote and prints these steps
rather than failing obscurely.

### A2 — Audio generated via Google Translate TTS, not gTTS/eSpeak
README §3-audio left the TTS choice open ("Claude Code's call"). Python on
this machine is the Microsoft Store stub, not a real interpreter, so `gTTS`
was not available; eSpeak-NG is not installed either. Node 22 is present, so
`tools/generate-audio.mjs` calls the same public Google Translate TTS
endpoint that gTTS wraps, directly via `fetch`. Zero dependencies to install.

The vendor decision is isolated in a single function (`synthesise()`), so
swapping to eSpeak-NG, a paid API, or real native-speaker recordings (Phase 2,
§9) touches one function and no app code.

### A3 — Synthesis is driven from kana, not kanji
Each phrase carries an `audioHint` field holding the kana reading, and the
generator prefers it over the kanji `japanese` field. Synthesisers routinely
mis-read kanji with multiple readings (七時 as *nanaji* rather than *shichiji*),
and this made the output measurably more accurate. `audioHint` is the
"audio-hint" field named in §3a, given a concrete job.

### A4 — Furigana stored as segments, not a parallel string
§3a lists `furigana` as a field but not its shape. It's stored as an array of
`{ b: base, r: reading }` segments so a reading attaches to the specific kanji
run rather than the whole phrase — `[{b:"電車",r:"でんしゃ"},{b:"は"}]`. This is
what makes correct `<ruby>` rendering possible, and the self-test asserts that
concatenating the segments reproduces the `japanese` field exactly.

### A5 — Placement quiz pulls 20 cards, 2 per category
§6a says "~15-20 sample cards spread across all 10 categories". 2 per category
× 10 = 20, at the top of that range but exactly even in coverage. The two picks
per category are deliberately the **easiest and the hardest** available card:
anime-derived knowledge is lopsided, and sampling both ends is what exposes the
lopsidedness rather than just measuring an average.

### A6 — Categories 5-10 seeded on Day 1, not Day 2
The Day 2 checklist puts categories 5-10 in Day 2, but §6a requires the
placement quiz — a Day 1 item — to span **all ten** categories. Those two
can't both hold with six empty files. Resolution: 4 phrases each were written
for categories 5-10 on Day 1 (enough for the quiz to sample from), and Day 2
expands them to full thin coverage. Day 1's audio pass therefore covered 112
phrases rather than only categories 1-4's 88.

### A7 — Three-way self-grading, but only "known" skips ahead
§6a describes "known" vs "recognised but wouldn't produce" vs unknown. The quiz
offers all three, but per the spec's explicit wording only **"I know this"**
seeds the card forward (6 days); "recognise" and "new" both start at the normal
first interval. The "recognise" answer still counts as 0.5 toward the category
score, so it influences *sibling* cards even though it doesn't advance its own.

### A8 — Placement results also seed unsampled cards
§6a only describes what happens to the sampled cards. Extending that: a
category whose placement score is ≥0.75 gets its easy (difficulty ≤2) cards
seeded at a 4-day interval when the category is activated, and ≥0.5 seeds
difficulty-1 cards at 2 days. Without this, answering "I know this" to two
greetings cards would still leave you grinding all 22 remaining greetings from
zero — which is the exact waste §6a exists to prevent. Tunable in
`js/deck.js → activateCategory()`.

### A9 — Week-1 rollout enforced, later categories opt-in
§7 says don't front-load all 10 categories. On finishing the quiz, only the
four week-1 categories are activated. The rest are visible and readable in
Browse from the start, but only enter the review queue when explicitly added.
Cards for unrolled categories that the quiz happened to sample are stored but
excluded from the queue until their category is activated.

### A10 — Failed cards return within the same session
SM-2 proper just reschedules a lapsed card. Here a lapse sets a 10-minute
learning step *and* the card is pushed to the back of the current session
queue, so it's seen again before you close the app. This is standard Anki-style
behaviour and materially improves same-day retention.

### A11 — Icons generated, not designed
`tools/make-icons.mjs` writes the PWA PNGs from raw RGBA scanlines via
`zlib` — a torii drawn with rectangles. No image library, no binary assets
committed that can't be regenerated. Fine for a launcher icon; replace with
real artwork any time by dropping PNGs into `icons/`.

### A12 — Dark-first single stylesheet
Not specified anywhere. One CSS file, dark by default with a
`prefers-color-scheme: light` override, sized for a phone held one-handed.
Text-size slider in Settings drives a `--text-scale` custom property, which
covers the §8 accessibility requirement alongside the furigana/romaji toggles.

### A13 — Romaji auto-retires after week 1
§6 says romaji should be "off by default after week 1". Rather than silently
changing behaviour, the app flips the default once, 7 days after first launch,
and shows a toast explaining it. It can be turned straight back on in Settings
and won't auto-flip again.
