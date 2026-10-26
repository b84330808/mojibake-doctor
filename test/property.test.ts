// Garble random CJK strings with every supported (original, wrong) encoding
// pair and check that the doctor gets the original back.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decode, diagnose, encode, type EncodingId } from '../src/index.js';
import { garbleLossless, LANGS_FOR, textArb, WRONG, type Lang } from './gen.js';

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
