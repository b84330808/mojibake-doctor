// Text plausibility score: a rough log2-probability of the text under a
// character model that mixes Japanese, Chinese, Korean and Latin text.
//
// Each character gets a log-probability from its class (frequent kanji/hanzi,
// kana, Hangul, ASCII, Latin-1 symbols, halfwidth katakana, C1 controls, ...),
// and adjacent characters from scripts that rarely touch (accented Latin next
// to kanji, kana next to Hangul, ...) cost extra. Because a decoding that
// explains the same bytes with fewer, more common characters is more likely,
// comparing total scores between a garbled text and its candidate fixes is a
// (crude) likelihood-ratio test.

import { HAN_FREQ, HAN_TIER1A, HAN_TIER1B, HAN_TIER1C, HAN_TIER2 } from './data/han.js';
import { index } from './encodings/tables.js';

export enum Script {
  Neutral = 0,
  Latin = 1,
  LatinX = 2,
  Han = 3,
  Kana = 4,
  HalfKana = 5,
  Hangul = 6,
  Junk = 7,
  Other = 8,
  Punct2 = 9,
  HanNoJis = 10,
  Katakana = 11,
}

// Han tiers, best first: 1A, 1B, 1C, 2, 3 (in some national standard), else rare.
// A character's weight is the better of its tier weight and its log2 frequency.
const HAN_WEIGHT = [0, -12, -12.5, -13.5, -15, -16.5];
const HAN_RARE = -19;

// Frequent Hangul syllables (rough list); other KS X 1001 syllables are less likely.
const HANGUL_COMMON =
  '이다는의에을하고가한지로기서사도대정수일리자어나시아인를해적부제국상들으구주전과게성만장경그여위유소원보연동화했문라우생비니마개신면세것회무실미방계데내교학관공당중조행오간요법안발물저히업결등선년거터같있없되된될할합습입까와은겠며각감강건검곳광군권규금급길김끝난남날너네녀노높누눈늘단달담더덕독돌두드득든듯때또뜻람래량러려력련령례론료루류률르른름립막말매맞머먼메명모목몸못민바반받밖배백번변별병본봉분불브빠산살삼새색석설섭센셨속손송순술스승식심십써씨악알앞애야약양언얼엄었엔역열영예옛온올완왜외용운울웃월율음응익임잘잡재쟁점접져졌종좋죠준줄즈즉증직진질집차참창찾채책처천철청체초최추출충취치친칙카커컴케코크키타태택텔토통투트특티파판편평포표품프피필함항향허현형호혹확환활효후휘흐힘글국녕요안세계말씀드립니께서할겁니까';

// Small bonus for the most frequent hiragana (particles and endings).
const KANA_BONUS = new Map<number, number>();
'のにはをたがでてとしいかなるすまっれもこうくだんりきつらあ'
  .split('')
  .forEach((c, i, a) => KANA_BONUS.set(c.codePointAt(0)!, 1.5 * (1 - i / a.length)));

const SMALL_VOWELS = new Set(Array.from('ぁぃぅぇぉゎァィゥェォヮ', (c) => c.codePointAt(0)!));
const SMALL_YOON = new Set(Array.from('ゃゅょャュョ', (c) => c.codePointAt(0)!));
const SMALL_TSU = new Set([0x3063, 0x30c3]);
// Kana that small ya/yu/yo can follow (plus a few katakana used in loanwords).
const I_ROW = new Set(Array.from('きしちにひみりぎじぢびぴキシチニヒミリギジヂビピテデフヴ', (c) => c.codePointAt(0)!));

// BMP flags: low 3 bits = Han tier (1..5), 6 = common Hangul, 7 = other KS X 1001 Hangul; bit 3 = in JIS X 0208.
let flags: Uint8Array | null = null;
const supTier = new Map<number, number>();
const hanFreq = new Map<number, number>();
const IN_JIS = 8;
const JIS_LEVEL1 = 16;

function init(): Uint8Array {
  const f = new Uint8Array(0x10000);
  const setTier = (cp: number, t: number) => {
    if (cp < 0x10000) {
      const cur = f[cp]! & 7;
      if (cur === 0 || t < cur) f[cp] = (f[cp]! & ~7) | t;
    } else if (!supTier.has(cp) || t < supTier.get(cp)!) supTier.set(cp, t);
  };
  [HAN_TIER1A, HAN_TIER1B, HAN_TIER1C, HAN_TIER2].forEach((s, i) => {
    for (const ch of s) setTier(ch.codePointAt(0)!, i + 1);
  });
  const jis = index('jis0208');
  for (let p = 0; p < jis.length; p++) {
    const cp = jis[p]!;
    if (cp < 0) continue;
    setTier(cp, 5);
    if (cp < 0x10000) f[cp]! |= IN_JIS | (p >= 15 * 94 && p < 47 * 94 ? JIS_LEVEL1 : 0);
  }
  const gb = index('gb18030');
  for (let lead = 0xa1; lead <= 0xf7; lead++)
    for (let trail = 0xa1; trail <= 0xfe; trail++) {
      const cp = gb[(lead - 0x81) * 190 + trail - 0x41]!;
      if (cp >= 0) setTier(cp, 5);
    }
  const big5 = index('big5');
  for (let p = (0xa1 - 0x81) * 157; p < big5.length; p++) {
    const cp = big5[p]!;
    if (cp >= 0) setTier(cp, 5);
  }
  const kr = index('euc-kr');
  for (let lead = 0xb0; lead <= 0xc8; lead++)
    for (let trail = 0xa1; trail <= 0xfe; trail++) {
      const cp = kr[(lead - 0x81) * 190 + trail - 0x41]!;
      if (cp >= 0xac00 && cp <= 0xd7a3) f[cp] = 7;
    }
  for (const ch of HANGUL_COMMON) f[ch.codePointAt(0)!] = 6;
  for (const [w, chars] of HAN_FREQ) for (const ch of chars) hanFreq.set(ch.codePointAt(0)!, w);
  return f;
}

const COMMON_ACCENTED = new Set(Array.from('àáâäçèéêëíîïñóôöùúûüßÉ', (c) => c.codePointAt(0)!));
const COMMON_LATIN1_SYMBOLS = new Set([0xb0, 0xa9, 0xae, 0xab, 0xbb, 0xb7, 0xa3, 0xa7]);
const GOOD_CP1252_PUNCT = new Set([0x2018, 0x2019, 0x201c, 0x201d, 0x2013, 0x2014, 0x2026, 0x2022]);
const BAD_CP1252 = new Set([0x2122, 0x201a, 0x201e, 0x2020, 0x2021, 0x02c6, 0x2030, 0x2039, 0x203a, 0x0192, 0x02dc]);
const CP1252_LETTERS = new Set([0x0160, 0x0152, 0x017d, 0x0161, 0x0153, 0x017e, 0x0178]);
const COMMON_ASCII_PUNCT = new Set(Array.from('.,:;!?\'"()-/', (c) => c.charCodeAt(0)));
const FULLWIDTH_PUNCT = new Set([0xff01, 0xff1f, 0xff08, 0xff09, 0xff0c, 0xff0e, 0xff1a, 0xff1b]);

/** Log2-probability and script of one code point. */
export function classify(cp: number): [number, Script] {
  if (cp < 0x80) {
    if (cp === 0x20) return [-3, Script.Neutral];
    if (cp >= 0x61 && cp <= 0x7a) return [-4.5, Script.Latin];
    if (cp >= 0x41 && cp <= 0x5a) return [-6, Script.Latin];
    if (cp >= 0x30 && cp <= 0x39) return [-5, Script.Neutral];
    if (cp === 9 || cp === 10 || cp === 13) return [-5, Script.Neutral];
    if (cp < 0x20 || cp === 0x7f) return [-20, Script.Junk];
    if (COMMON_ASCII_PUNCT.has(cp)) return [-6, Script.Neutral];
    return [-8, Script.Neutral];
  }
  if (cp <= 0x9f) return [-20, Script.Junk];
  if (cp <= 0xff) {
    if (cp === 0xa0) return [-12, Script.Junk];
    if (cp === 0xad) return [-16, Script.Junk];
    if (cp === 0xc2 || cp === 0xc3) return [-13, Script.LatinX];
    if (COMMON_ACCENTED.has(cp)) return [-9, Script.LatinX];
    if (cp >= 0xc0 && cp !== 0xd7 && cp !== 0xf7) return [-12, Script.LatinX];
    if (COMMON_LATIN1_SYMBOLS.has(cp)) return [-12, Script.Junk];
    return [-14, Script.Junk];
  }
  if (GOOD_CP1252_PUNCT.has(cp)) return [-9, Script.Punct2];
  if (cp === 0x20ac) return [-12, Script.Punct2];
  if (BAD_CP1252.has(cp)) return [-15, Script.Junk];
  if (CP1252_LETTERS.has(cp)) return [-14, Script.LatinX];
  if (cp < 0x0250) return [-13, Script.LatinX];
  // Basic Greek and Russian letters are languages of their own; other letters
  // in these blocks mostly show up when CJK bytes are decoded as UTF-8.
  if ((cp >= 0x0391 && cp <= 0x03c9) || (cp >= 0x0401 && cp <= 0x0451)) return [-6.5, Script.Other];
  if (cp >= 0x0370 && cp <= 0x052f) return [-13, Script.Other];
  if (cp >= 0x2000 && cp <= 0x206f) return [-12, Script.Neutral];
  if (cp >= 0x2100 && cp <= 0x214f) return [-13, Script.Junk];
  if (cp >= 0x2150 && cp <= 0x218f) return [-14, Script.Neutral];
  if (cp >= 0x2190 && cp <= 0x21ff) return [-12, Script.Neutral];
  if (cp >= 0x2200 && cp <= 0x22ff) return [-14, Script.Neutral];
  if (cp >= 0x2300 && cp <= 0x23ff) return [-15, Script.Neutral];
  if (cp >= 0x2460 && cp <= 0x24ff) return [-12, Script.Neutral];
  if (cp >= 0x2500 && cp <= 0x259f) return [-15, Script.Neutral];
  if (cp >= 0x25a0 && cp <= 0x26ff) return [-12, Script.Neutral];
  if (cp >= 0x3000 && cp <= 0x303f) {
    if (cp === 0x3005) return [-8, Script.Han];
    if (cp === 0x3001 || cp === 0x3002 || (cp >= 0x300c && cp <= 0x300f)) return [-6, Script.Neutral];
    if (cp >= 0x3008 && cp <= 0x3011) return [-8, Script.Neutral];
    if (cp === 0x3000) return [-8, Script.Neutral];
    if (cp === 0x301c) return [-9, Script.Neutral];
    if (cp === 0x3013) return [-16, Script.Junk];
    return [-11, Script.Neutral];
  }
  if (cp >= 0x3041 && cp <= 0x309f) {
    if (SMALL_VOWELS.has(cp)) return [-12, Script.Kana];
    if (SMALL_YOON.has(cp) || SMALL_TSU.has(cp)) return [-8, Script.Kana];
    if (cp === 0x3090 || cp === 0x3091) return [-13, Script.Kana];
    if (cp >= 0x3094) return [-14, Script.Kana];
    return [-7 + (KANA_BONUS.get(cp) ?? 0), Script.Kana];
  }
  if (cp >= 0x30a1 && cp <= 0x30ff) {
    if (cp === 0x30fb) return [-12, Script.Neutral];
    if (cp === 0x30fc) return [-7.5, Script.Katakana];
    if (SMALL_VOWELS.has(cp)) return [-10, Script.Katakana];
    if (cp >= 0x30f7 && cp <= 0x30fa) return [-14, Script.Katakana];
    if (cp === 0x30f0 || cp === 0x30f1 || cp === 0x30f5 || cp === 0x30f6) return [-12, Script.Katakana];
    if (cp >= 0x30fd) return [-13, Script.Katakana];
    return [-8.5, Script.Katakana];
  }
  if (cp >= 0x31f0 && cp <= 0x31ff) return [-13, Script.Katakana];
  if (cp >= 0x3131 && cp <= 0x318e) return [-13, Script.Hangul];
  if (cp >= 0x1100 && cp <= 0x11ff) return [-19, Script.Hangul];
  if (cp >= 0x3200 && cp <= 0x33ff) return [-14, Script.Neutral];
  if ((cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0x20000 && cp <= 0x3134f)) {
    flags ??= init();
    const t = cp < 0x10000 ? flags[cp]! & 7 : (supTier.get(cp) ?? 0);
    const w = Math.max(t === 0 ? HAN_RARE : HAN_WEIGHT[t]!, hanFreq.get(cp) ?? -Infinity);
    return [w, cp < 0x10000 && flags[cp]! & IN_JIS ? Script.Han : Script.HanNoJis];
  }
  if (cp >= 0xa000 && cp <= 0xa4cf) return [-20, Script.Other];
  if (cp >= 0xac00 && cp <= 0xd7a3) {
    flags ??= init();
    const f = flags[cp]!;
    return [f === 6 ? -8.5 : f === 7 ? -13 : -17, Script.Hangul];
  }
  if (cp >= 0xd800 && cp <= 0xdfff) return [-24, Script.Junk];
  if (cp >= 0xe000 && cp <= 0xf8ff) return [-20, Script.Junk];
  if (cp >= 0xf900 && cp <= 0xfaff) return [HAN_RARE, Script.Han];
  if (cp >= 0xfb00 && cp <= 0xfdff) return [-18, Script.Other];
  if (cp >= 0xfe30 && cp <= 0xfe6f) return [-15, Script.Neutral];
  if (cp >= 0xff01 && cp <= 0xff5e) {
    if (FULLWIDTH_PUNCT.has(cp)) return [-8, Script.Neutral];
    if (cp >= 0xff41 && cp <= 0xff5a) return [-11, Script.Neutral];
    return [-10, Script.Neutral];
  }
  if (cp >= 0xff61 && cp <= 0xff9f) return [-13, Script.HalfKana];
  if (cp >= 0xffa0 && cp <= 0xffdc) return [-18, Script.Other];
  if (cp >= 0xffe0 && cp <= 0xffe6) return [-14, Script.Neutral];
  // An unknown character: the decoder that produced it saw bytes it could not read.
  if (cp === 0xfffd) return [-3, Script.Neutral];
  if (cp >= 0xfff0) return [-24, Script.Junk];
  if (cp >= 0x1f000 && cp <= 0x1faff) return [-11, Script.Neutral];
  // Core letters of Hebrew, Arabic, Devanagari and Thai.
  if (
    (cp >= 0x05d0 && cp <= 0x05ea) ||
    (cp >= 0x0621 && cp <= 0x064a) ||
    (cp >= 0x0905 && cp <= 0x094d) ||
    (cp >= 0x0e01 && cp <= 0x0e4e)
  )
    return [-8, Script.Other];
  return [-12, Script.Other];
}

export function charWeight(cp: number): number {
  return classify(cp)[0];
}

const isCjk = (s: Script) =>
  s === Script.Han ||
  s === Script.HanNoJis ||
  s === Script.Kana ||
  s === Script.Katakana ||
  s === Script.Hangul ||
  s === Script.HalfKana;
const isLatinJunk = (s: Script) => s === Script.LatinX || s === Script.Junk || s === Script.Punct2;
const pair2 = (a: Script, b: Script, x: Script, y: Script) => (a === x && b === y) || (a === y && b === x);

/** Extra log2-probability (<= 0) for two adjacent characters. */
export function transition(a: Script, b: Script): number {
  if (a === Script.Neutral || b === Script.Neutral) return 0;
  if (isLatinJunk(a) && isLatinJunk(b)) return -3;
  if ((isLatinJunk(a) && isCjk(b)) || (isCjk(a) && isLatinJunk(b))) return -4;
  // Katakana behaves like hiragana, except that switching between the two costs a little.
  if (pair2(a, b, Script.Kana, Script.Katakana)) return -1.5;
  if (a === Script.Katakana) a = Script.Kana;
  if (b === Script.Katakana) b = Script.Kana;
  const pair = (x: Script, y: Script) => pair2(a, b, x, y);
  if (pair(Script.Latin, Script.Junk)) return -1.5;
  if (pair(Script.Kana, Script.Hangul)) return -6;
  if (pair(Script.HalfKana, Script.Hangul)) return -5;
  if (pair(Script.Han, Script.Hangul) || pair(Script.HanNoJis, Script.Hangul)) return -3;
  if (pair(Script.HanNoJis, Script.Kana)) return -3;
  if (pair(Script.HalfKana, Script.Han) || pair(Script.HalfKana, Script.HanNoJis) || pair(Script.HalfKana, Script.Kana))
    return -2;
  if (pair(Script.Latin, Script.HalfKana)) return -2;
  if (pair(Script.Latin, Script.Han) || pair(Script.Latin, Script.HanNoJis) || pair(Script.Latin, Script.Hangul)) return -1;
  if ((a === Script.Other && isCjk(b)) || (isCjk(a) && b === Script.Other)) return -3;
  return 0;
}

/** Plausibility of a whole string (log2-probability, so always <= 0). */
export function scoreText(text: string): number {
  let total = 0;
  let prev = Script.Neutral;
  let prevCp = -1;
  let kana = 0;
  let hangul = 0;
  let hanNoJis = 0;
  let hanRareJa = 0;
  let cjk = 0;
  let greekCyrillic = 0;
  // Katakana words are runs; one katakana letter alone between other characters is rare.
  let kataRun = 0;
  let kataFirst = -1;
  const endKataRun = () => {
    if (kataRun === 1 && kataFirst !== 0x30fc && kataFirst !== 0x30f6 && kataFirst !== 0x30f5) total -= 2;
    kataRun = 0;
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const [w, s] = classify(cp);
    total += w + transition(prev, s);
    if (s === Script.Katakana) {
      if (kataRun++ === 0) kataFirst = cp;
    } else endKataRun();
    if (s === Script.Kana || s === Script.Katakana) kana++;
    else if (s === Script.Hangul) hangul++;
    else if (s === Script.HanNoJis) hanNoJis++;
    else if (s === Script.Han && cp < 0x10000 && !(flags![cp]! & JIS_LEVEL1)) hanRareJa++;
    if (isCjk(s)) cjk++;
    else if (cp >= 0x0370 && cp <= 0x052f) greekCyrillic++;
    // Small kana only follow certain kana: いゅ or 、っ never happen in real text.
    if (SMALL_YOON.has(cp) && !I_ROW.has(prevCp)) total -= 10;
    else if (SMALL_TSU.has(cp) && prev !== Script.Kana && prev !== Script.Katakana) total -= 6;
    else if (SMALL_VOWELS.has(cp) && prev !== Script.Katakana) total -= 6;
    prev = s;
    prevCp = cp;
  }
  endKataRun();
  // Japanese text (it has kana) uses JIS kanji and no Hangul; mixing in
  // simplified-only hanzi or Hangul is a typical sign of a wrong decoding.
  // Everyday Japanese kanji are JIS level 1; level 2 ones are rare in running text.
  if (kana >= 2) total -= 4 * hanNoJis + 4 * Math.min(kana, hangul) + 2 * hanRareJa;
  // Greek and Cyrillic letters inside CJK text are mostly symbols from the JIS/GB tables.
  if (cjk >= 2) total -= 4 * greekCyrillic;
  return total;
}
