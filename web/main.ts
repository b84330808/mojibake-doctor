import {
  diagnose,
  explain,
  garble,
  trace,
  ENCODING_LABELS,
  type Candidate,
  type Diagnosis,
  type EncodingId,
  type Lang,
  type Segment,
} from '../src/index.js';
import { t, type UiKey } from './i18n.js';

const SAMPLE_LENGTH = 3000;
const EXAMPLES = [
  '縺薙ｓ縺ｫ縺｡縺ｯ',
  'æ—¥æœ¬èªž',
  'ç¹é«”ä¸­æ–‡',
  '譁・ｭ怜喧縺・',
  '‚±‚ñ‚É‚¿‚Í',
  '浣犲ソ',
  '¤¤¤å',
  'í•œê¸€',
  'ﾁcﾅ鬢､､蟐ｺﾀﾉｮﾗｦWｺﾙ',
  '$B$3$s$K$A$O(B',
  'cafÃ©',
  '锟斤拷',
];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const input = $<HTMLTextAreaElement>('#input');
const result = $<HTMLDivElement>('#result');

let lang: Lang = pickLang();
let current: { d: Diagnosis; shown: Candidate | null } | null = null;

function pickLang(): Lang {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('lang');
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('lang');
  } catch {
    // Storage may be unavailable (private mode); fall back to the browser language.
  }
  for (const l of [fromHash, saved]) if (l === 'zh-TW' || l === 'ja' || l === 'en') return l;
  for (const l of navigator.languages ?? [navigator.language]) {
    if (/^ja/i.test(l)) return 'ja';
    if (/^zh/i.test(l)) return 'zh-TW';
    if (/^en/i.test(l)) return 'en';
  }
  return 'en';
}

const HTML_LANG: Record<Lang, string> = { 'zh-TW': 'zh-Hant-TW', ja: 'ja', en: 'en' };

function applyLang(): void {
  document.documentElement.lang = HTML_LANG[lang];
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(lang, el.dataset.i18n as UiKey);
  });
  document.querySelectorAll<HTMLTextAreaElement>('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(lang, el.dataset.i18nPlaceholder as UiKey);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  });
  document.title = lang === 'en' ? 'Mojibake Doctor' : `${t(lang, 'title')} · Mojibake Doctor`;
  renderMakeSteps();
  render();
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** Renders text with `code` spans for the backtick parts of explanation strings. */
function rich(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  text.split(/(`[^`]+`)/).forEach((part) => {
    frag.append(part.startsWith('`') && part.endsWith('`') ? el('code', {}, part.slice(1, -1)) : part);
  });
  return frag;
}

/** Best guess at the language of a fixed text, so CJK glyphs use the right regional forms. */
function textLang(c: Candidate): string {
  const from = c.chain[0]?.from;
  if (from === 'shift_jis' || from === 'euc-jp' || from === 'iso-2022-jp') return 'ja';
  if (from === 'big5') return 'zh-Hant';
  if (from === 'gb18030') return 'zh-Hans';
  if (from === 'euc-kr') return 'ko';
  if (/[぀-ヿ]/.test(c.text)) return 'ja';
  if (/[가-힣]/.test(c.text)) return 'ko';
  return '';
}

function segmentNodes(segments: Segment[]): Node[] {
  return segments.map((s) => {
    if (s.kind === 'ok') return document.createTextNode(s.text);
    if (s.kind === 'guessed') {
      return el('span', {
        className: 'guessed',
        title: t(lang, 'guessedTitle', { alts: (s.alternatives ?? []).join(' ') || '—' }),
        textContent: s.text,
      });
    }
    return el('span', { className: s.kind, title: t(lang, 'lostTitle'), textContent: s.text });
  });
}

const hex = (bytes: number[]) =>
  bytes
    .slice(0, 24)
    .map((b) => (b < 0 ? '??' : b.toString(16).toUpperCase().padStart(2, '0')))
    .join(' ') + (bytes.length > 24 ? ' …' : '');
const short = (s: string) => {
  const chars = [...s];
  return chars.length > 24 ? chars.slice(0, 24).join('') + '…' : s;
};

function chainView(c: Candidate, source: string): HTMLElement {
  const box = el('div', { className: 'chain' });
  for (const stage of trace(source, c.chain)) {
    const { step } = stage;
    const row = el('div', { className: 'stage' });
    row.append(
      el('span', { className: 'text', title: stage.before, textContent: short(stage.before) }),
      el('span', {
        className: 'arrow',
        textContent: step.escapesLost ? 'ISO-2022-JP →' : t(lang, 'savedAs', { enc: ENCODING_LABELS[step.from] }) + ' →',
      }),
      el('span', { className: 'bytes', title: t(lang, 'unknownByte'), textContent: hex(stage.bytes) }),
      el('span', {
        className: 'arrow',
        textContent: '→ ' + (step.escapesLost ? t(lang, 'escLost') : t(lang, 'readAs', { enc: ENCODING_LABELS[step.readAs] })),
      }),
      el('span', { className: 'text', title: stage.after, textContent: short(stage.after) }),
    );
    box.append(row);
  }
  return box;
}

function list(title: UiKey, items: string[]): Node[] {
  if (!items.length) return [];
  return [el('h3', {}, t(lang, title)), el('ul', {}, ...items.map((i) => el('li', {}, rich(i))))];
}

function render(): void {
  result.replaceChildren();
  if (!current) {
    result.append(el('p', { className: 'muted' }, t(lang, 'empty')));
    return;
  }
  const { d, shown } = current;
  const view: Diagnosis = shown ? { ...d, best: shown, isMojibake: true } : d;
  const e = explain(view, lang);
  const card = el('div', { className: 'card' });

  const verdict = el('div', { className: 'verdict' }, el('p', {}, e.summary));
  if (view.best && d.confidence !== 'none') {
    verdict.append(
      el('span', { className: `pill ${shown === d.best ? d.confidence : 'low'}` }, `${t(lang, 'confidence')}: ${t(lang, shown === d.best ? d.confidence : 'low')}`),
    );
  }
  card.append(verdict);

  if (view.best) {
    const best = view.best;
    const text = el('div', { className: 'result-text', lang: textLang(best) }, ...segmentNodes(best.segments));
    const copy = el('button', { type: 'button', className: 'secondary' }, t(lang, 'copy'));
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(best.text);
        copy.textContent = t(lang, 'copied');
        setTimeout(() => (copy.textContent = t(lang, 'copy')), 1500);
      } catch {
        // Clipboard access can be denied; the text is still selectable.
      }
    });
    card.append(el('h3', {}, t(lang, 'restored')), text);
    const guesses = best.segments.filter((s) => s.kind === 'guessed');
    if (guesses.length) {
      card.append(
        el(
          'ul',
          { className: 'guesses' },
          ...guesses.slice(0, 8).map((s) =>
            el('li', { lang: textLang(best) }, el('span', { className: 'guessed' }, s.text), ' ', t(lang, 'alternatives', { alts: (s.alternatives ?? []).join(' ') || '—' })),
          ),
        ),
      );
    }
    card.append(el('div', { className: 'row' }, copy));
    if ([...d.input].length > SAMPLE_LENGTH) card.append(el('p', { className: 'muted' }, t(lang, 'sampled', { n: SAMPLE_LENGTH })));
    card.append(el('h3', {}, t(lang, 'happened')), chainView(best, d.input), el('ul', {}, ...e.steps.map((s) => el('li', {}, rich(s)))));
  }
  card.append(...list('causes', e.causes), ...list('tips', e.tips), ...list('notes', e.notes));

  const others = d.candidates.filter((c) => c.text !== view.best?.text).slice(0, 4);
  if (others.length) {
    const det = el('details', {}, el('summary', {}, t(lang, 'others')));
    for (const c of others) {
      const use = el('button', { type: 'button', className: 'secondary' }, t(lang, 'use'));
      use.addEventListener('click', () => {
        current = { d, shown: c };
        render();
      });
      const chain = c.chain
        .map((s) => (s.escapesLost ? 'ISO-2022-JP (ESC)' : `${ENCODING_LABELS[s.from]} → ${ENCODING_LABELS[s.readAs]}`))
        .join(' · ');
      det.append(el('div', { className: 'cand' }, el('div', { className: 't' }, el('span', { lang: textLang(c) }, short(c.text)), el('small', {}, chain)), use));
    }
    card.append(det);
  }
  result.append(card);
}

let timer: number | undefined;
function scheduleDiagnose(): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    const text = input.value;
    if (!text.trim()) current = null;
    else {
      const d = diagnose(text, { sampleLength: SAMPLE_LENGTH });
      current = { d, shown: d.best };
    }
    render();
  }, 200);
}

// ---- Make mojibake ----

const MAKE_ENCODINGS: EncodingId[] = ['utf-8', 'shift_jis', 'euc-jp', 'iso-2022-jp', 'big5', 'gb18030', 'euc-kr', 'windows-1252'];
let makeSteps: Array<{ from: EncodingId; readAs: EncodingId }> = [{ from: 'utf-8', readAs: 'shift_jis' }];
const makeInput = $<HTMLTextAreaElement>('#make-input');
const makeOutput = $<HTMLDivElement>('#make-output');

function select(value: EncodingId, onChange: (v: EncodingId) => void, labelText: string): HTMLElement {
  const s = el('select', {}, ...MAKE_ENCODINGS.map((e) => el('option', { value: e, selected: e === value }, ENCODING_LABELS[e])));
  s.addEventListener('change', () => onChange(s.value as EncodingId));
  return el('label', {}, labelText, s);
}

function renderMakeSteps(): void {
  const box = $<HTMLDivElement>('#make-steps');
  box.replaceChildren(
    ...makeSteps.map((step, i) => {
      const row = el('div', { className: 'step-row' });
      row.append(
        select(step.from, (v) => ((step.from = v), updateMake()), t(lang, 'makeFrom')),
        select(step.readAs, (v) => ((step.readAs = v), updateMake()), t(lang, 'makeAs')),
      );
      if (i > 0) {
        const rm = el('button', { type: 'button', className: 'secondary' }, t(lang, 'makeRemove'));
        rm.addEventListener('click', () => {
          makeSteps.splice(i, 1);
          renderMakeSteps();
        });
        row.append(rm);
      } else row.append(el('span'));
      return row;
    }),
  );
  if (!makeInput.value) makeInput.value = t(lang, 'makeDefault');
  updateMake();
}

function updateMake(): void {
  makeOutput.textContent = garble(makeInput.value, makeSteps);
}

// ---- Wiring ----

function selectTab(fix: boolean): void {
  $('#tab-fix').setAttribute('aria-selected', String(fix));
  $('#tab-make').setAttribute('aria-selected', String(!fix));
  $('#panel-fix').hidden = !fix;
  $('#panel-make').hidden = fix;
}

document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
  b.addEventListener('click', () => {
    lang = b.dataset.lang as Lang;
    try {
      localStorage.setItem('lang', lang);
    } catch {
      // Not critical: the choice just will not be remembered.
    }
    applyLang();
  }),
);
$('#tab-fix').addEventListener('click', () => selectTab(true));
$('#tab-make').addEventListener('click', () => selectTab(false));
input.addEventListener('input', scheduleDiagnose);
makeInput.addEventListener('input', updateMake);
$('#make-add').addEventListener('click', () => {
  makeSteps.push({ from: 'utf-8', readAs: 'windows-1252' });
  renderMakeSteps();
});
$('#make-copy').addEventListener('click', () => void navigator.clipboard?.writeText(makeOutput.textContent ?? '').catch(() => {}));
$('#make-send').addEventListener('click', () => {
  input.value = makeOutput.textContent ?? '';
  selectTab(true);
  scheduleDiagnose();
});

const examples = $<HTMLSpanElement>('#examples');
for (const ex of EXAMPLES) {
  const b = el('button', { type: 'button', className: 'chip', textContent: ex, title: ex });
  b.addEventListener('click', () => {
    input.value = ex;
    scheduleDiagnose();
    input.focus();
  });
  examples.append(b);
}

applyLang();
