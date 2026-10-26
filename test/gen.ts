// Generators of realistic CJK text, shared by the property tests and scripts/stats.ts.

import fc from 'fast-check';
import { decode, encode, type EncodingId } from '../src/index.js';
import { HAN_FREQ, HAN_TIER1A } from '../src/data/han.js';
import { index } from '../src/encodings/tables.js';

export const HIRAGANA = [...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだでどばびぶべぼ'];
export const KATAKANA = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワンー'];
export const HANGUL = [...'이다는의에을하고가한지로기서사도대정수일리자어나시아인를해적부제국상들으구주전과게성만장경그여위유소원보연동화했문라우생비니마개신면세것회무실미방계데내교학관공당중조행오간요법안발물저히업결등선년'];
const roundTrips = (c: string, e: EncodingId) => {
  const r = encode(c, e);
  return r.unmappable === 0 && decode(r.bytes, e) === c;
};
const HAN = [...HAN_TIER1A];
// Real text leans on frequent characters: about 1 in 2,000 or more.
const FREQUENT = HAN_FREQ.filter(([w]) => w >= -11).flatMap(([, chars]) => [...chars]);
// Everyday Japanese kanji: JIS X 0208 level 1 (rows 16-47).
const JIS_LEVEL1 = new Set([...index('jis0208').subarray(15 * 94, 47 * 94)].filter((cp) => cp >= 0).map((cp) => String.fromCodePoint(cp)));

export type Lang = 'ja' | 'zh-Hant' | 'zh-Hans' | 'ko';
export const LANGS_FOR: Record<string, Lang[]> = {
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
export function textArb(lang: Lang, enc: EncodingId): fc.Arbitrary<string> {
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

export const WRONG: EncodingId[] = ['utf-8', 'shift_jis', 'euc-jp', 'big5', 'gb18030', 'euc-kr', 'windows-1252'];

/** Garbling is lossless when the wrong decoding keeps every byte. */
export function garbleLossless(s: string, from: EncodingId, readAs: EncodingId): string | null {
  const bytes = encode(s, from).bytes;
  const g = decode(bytes, readAs);
  const back = encode(g, readAs);
  if (g.includes('\ufffd') || back.unmappable || back.bytes.length !== bytes.length) return null;
  return back.bytes.every((b, i) => b === bytes[i]) ? g : null;
}
