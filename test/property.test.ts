// Garble random CJK strings with every supported (original, wrong) encoding
// pair and check that the doctor gets the original back.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decode, diagnose, encode, type EncodingId } from '../src/index.js';
import { HAN_FREQ, HAN_TIER1A } from '../src/data/han.js';
import { index } from '../src/encodings/tables.js';

const HIRAGANA = [...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだでどばびぶべぼ'];
const KATAKANA = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワンー'];
const HANGUL = [...'이다는의에을하고가한지로기서사도대정수일리자어나시아인를해적부제국상들으구주전과게성만장경그여위유소원보연동화했문라우생비니마개신면세것회무실미방계데내교학관공당중조행오간요법안발물저히업결등선년'];
const roundTrips = (c: string, e: EncodingId) => {
  const r = encode(c, e);
  return r.unmappable === 0 && decode(r.bytes, e) === c;
};
const HAN = [...HAN_TIER1A];
// Real text leans on frequent characters: about 1 in 2,000 or more.
const FREQUENT = HAN_FREQ.filter(([w]) => w >= -11).flatMap(([, chars]) => [...chars]);
// Everyday Japanese kanji: JIS X 0208 level 1 (rows 16-47).
const JIS_LEVEL1 = new Set([...index('jis0208').subarray(15 * 94, 47 * 94)].filter((cp) => cp >= 0).map((cp) => String.fromCodePoint(cp)));

type Lang = 'ja' | 'zh-Hant' | 'zh-Hans' | 'ko';
const LANGS_FOR: Record<string, Lang[]> = {
  'utf-8': ['ja', 'zh-Hant', 'zh-Hans', 'ko'],
  shift_jis: ['ja'],
  'euc-jp': ['ja'],
  big5: ['zh-Hant'],
  gb18030: ['zh-Hans'],
  'euc-kr': ['ko'],
};

/**
 * Text that looks like the language: Japanese is ~60% kana plus everyday kanji,
 * Chinese leans on frequent characters, Korean is Hangul.
 */
function textArb(lang: Lang, enc: EncodingId): fc.Arbitrary<string> {
  if (lang === 'ko') return fc.array(fc.constantFrom(...HANGUL), { minLength: 6, maxLength: 20 }).map((a) => a.join(''));
  const native: EncodingId = lang === 'ja' ? 'shift_jis' : lang === 'zh-Hant' ? 'big5' : 'gb18030';
  const ok = (c: string) => roundTrips(c, enc) && roundTrips(c, native) && (lang !== 'ja' || JIS_LEVEL1.has(c));
  const han = fc.oneof(
    { arbitrary: fc.constantFrom(...FREQUENT.filter(ok)), weight: 3 },
    { arbitrary: fc.constantFrom(...HAN.filter(ok)), weight: 2 },
  );
  if (lang !== 'ja') return fc.array(han, { minLength: 6, maxLength: 20 }).map((a) => a.join(''));
  // Japanese as word-like runs: hiragana 1-3, katakana 2-5, kanji 1-3.
  const run = (chars: fc.Arbitrary<string>, min: number, max: number) =>
    fc.array(chars, { minLength: min, maxLength: max }).map((a) => a.join(''));
  const word = fc.oneof(
    { arbitrary: run(fc.constantFrom(...HIRAGANA), 1, 3), weight: 3 },
    { arbitrary: run(fc.constantFrom(...KATAKANA), 2, 5), weight: 1 },
    { arbitrary: run(han, 1, 3), weight: 3 },
  );
  return fc.array(word, { minLength: 3, maxLength: 8 }).map((a) => a.join(''));
}

const WRONG: EncodingId[] = ['utf-8', 'shift_jis', 'euc-jp', 'big5', 'gb18030', 'euc-kr', 'windows-1252'];

/** Garbling is lossless when the wrong decoding keeps every byte. */
function garbleLossless(s: string, from: EncodingId, readAs: EncodingId): string | null {
  const bytes = encode(s, from).bytes;
  const g = decode(bytes, readAs);
  const back = encode(g, readAs);
  if (g.includes('�') || back.unmappable || back.bytes.length !== bytes.length) return null;
  return back.bytes.every((b, i) => b === bytes[i]) ? g : null;
}

// Pairs where both decodings are plausible text for short random strings
// (EUC-JP and GBK share the same two-byte layout), so a few misses are expected.
const AMBIGUOUS = new Set(['euc-jp>gb18030', 'gb18030>euc-jp']);

describe('encode -> wrong decode -> doctor recovers the original', () => {
  for (const [from, langs] of Object.entries(LANGS_FOR) as Array<[EncodingId, Lang[]]>) {
    for (const readAs of WRONG) {
      if (readAs === from) continue;
      const key = `${from}>${readAs}`;
      it(key, () => {
        const arb = fc.constantFrom(...langs).chain((lang) => textArb(lang, from));
        const samples = fc.sample(arb, { seed: 42, numRuns: 60 });
        let tried = 0;
        let ok = 0;
        const misses: string[] = [];
        for (const s of samples) {
          const g = garbleLossless(s, from, readAs);
          if (g === null) continue;
          tried++;
          const got = diagnose(g).best?.text;
          if (got === s) ok++;
          else misses.push(`${s} -> ${g} -> ${got ?? '(no fix)'}`);
        }
        if (tried === 0) return; // this pair always loses bytes; covered by the partial-recovery test
        // At most 5% misses (25% for ambiguous pairs), and one miss is fine on small samples.
        const allowed = AMBIGUOUS.has(key) ? Math.max(2, Math.floor(tried * 0.25)) : Math.max(1, Math.floor(tried * 0.05));
        expect(tried - ok, `${ok}/${tried}\n${misses.slice(0, 3).join('\n')}`).toBeLessThanOrEqual(allowed);
      });
    }
  }

  it('fast-check: UTF-8 read as cp1252 always recovers', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Lang>('ja', 'zh-Hant', 'zh-Hans', 'ko').chain((l) => textArb(l, 'utf-8')),
        (s) => {
          const g = decode(encode(s, 'utf-8').bytes, 'windows-1252');
          expect(diagnose(g).best?.text).toBe(s);
        },
      ),
      { seed: 7, numRuns: 50 },
    );
  });

  it('fast-check: Shift_JIS read as GBK always recovers', () => {
    fc.assert(
      fc.property(textArb('ja', 'shift_jis'), (s) => {
        const g = garbleLossless(s, 'shift_jis', 'gb18030');
        fc.pre(g !== null);
        expect(diagnose(g!).best?.text).toBe(s);
      }),
      { seed: 7, numRuns: 50 },
    );
  });
});

describe('partial recovery when bytes are lost', () => {
  // Share of original characters found in order in the best result (LCS / length).
  const recovered = (a: string, b: string) => {
    const x = [...a];
    const y = [...b];
    const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
    for (let i = 1; i <= x.length; i++)
      for (let j = 1; j <= y.length; j++)
        dp[i]![j] = x[i - 1] === y[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    return dp[x.length]![y.length]! / x.length;
  };
  const CASES: Array<[EncodingId, EncodingId, Lang, number]> = [
    ['utf-8', 'shift_jis', 'ja', 0.6],
    ['utf-8', 'big5', 'zh-Hant', 0.3],
    ['utf-8', 'euc-kr', 'ko', 0.5],
    ['shift_jis', 'euc-kr', 'ja', 0.7],
    ['big5', 'shift_jis', 'zh-Hant', 0.6],
    ['euc-kr', 'big5', 'ko', 0.7],
  ];
  for (const [from, readAs, lang, min] of CASES) {
    it(`${from}>${readAs}: at least ${min * 100}% of characters come back`, () => {
      const samples = fc.sample(textArb(lang, from), { seed: 3, numRuns: 30 });
      let total = 0;
      for (const s of samples) {
        const g = decode(encode(s, from).bytes, readAs);
        total += recovered(s, diagnose(g).best?.text ?? '');
      }
      expect(total / samples.length).toBeGreaterThanOrEqual(min);
    });
  }
});

describe('no false positives on clean text', () => {
  for (const lang of ['ja', 'zh-Hant', 'zh-Hans', 'ko'] as Lang[]) {
    it(lang, () => {
      const enc: EncodingId = lang === 'ja' ? 'shift_jis' : lang === 'ko' ? 'euc-kr' : lang === 'zh-Hant' ? 'big5' : 'gb18030';
      const samples = fc.sample(textArb(lang, enc), { seed: 11, numRuns: 80 });
      const flagged = samples.filter((s) => diagnose(s).isMojibake);
      expect(flagged.length, flagged.slice(0, 3).join('\n')).toBeLessThanOrEqual(1);
    });
  }
});
