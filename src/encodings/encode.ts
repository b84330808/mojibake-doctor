// Encoders built as the inverse of the WHATWG decoders.
//
// To undo mojibake we need the exact bytes a decoder saw, so for every code
// point we return every byte sequence the decoder maps to it, with the one the
// WHATWG encoder would pick first. A few extra mappings cover text that went
// through non-WHATWG decoders (JIS-strict Shift_JIS, Python's latin-1, Windows).

import type { EncodingId } from './types.js';
import { gb18030RangesPointer, index, reverseIndex } from './tables.js';

type Alts = number[][] | null;

// Code points that other Shift_JIS/EUC-JP decoders produce, mapped to the
// code point the WHATWG (cp932) table uses for the same bytes.
const JIS_ALIASES: Record<number, number> = {
  0x2212: 0xff0d, // MINUS SIGN -> FULLWIDTH HYPHEN-MINUS
  0x301c: 0xff5e, // WAVE DASH -> FULLWIDTH TILDE
  0x2016: 0x2225, // DOUBLE VERTICAL LINE -> PARALLEL TO
  0x2014: 0x2015, // EM DASH -> HORIZONTAL BAR
  0x00a2: 0xffe0,
  0x00a3: 0xffe1,
  0x00ac: 0xffe2,
};

// Windows maps these undefined cp932 single bytes into the private use area.
const CP932_WINDOWS_PUA: Record<number, number> = { 0xf8f0: 0xa0, 0xf8f1: 0xfd, 0xf8f2: 0xfe, 0xf8f3: 0xff };

const sjisPointerBytes = (p: number): number[] => {
  const lead = Math.floor(p / 188);
  const trail = p % 188;
  return [lead + (lead < 0x1f ? 0x81 : 0xc1), trail + (trail < 0x3f ? 0x40 : 0x41)];
};

function shiftJisAlts(cp: number): Alts {
  if (cp <= 0x80) return [[cp]];
  if (cp >= 0xff61 && cp <= 0xff9f) return [[cp - 0xff61 + 0xa1]];
  if (cp >= 0xe000 && cp <= 0xe757) return [sjisPointerBytes(cp - 0xe000 + 8836)];
  const ps = reverseIndex('jis0208').get(cp);
  if (ps) {
    const pref = ps.find((p) => p < 8272 || p > 8835) ?? ps[0]!;
    return [pref, ...ps.filter((p) => p !== pref)].map(sjisPointerBytes);
  }
  if (cp === 0xa5) return [[0x5c]];
  if (cp === 0x203e) return [[0x7e]];
  const win = CP932_WINDOWS_PUA[cp];
  if (win !== undefined) return [[win]];
  const alias = JIS_ALIASES[cp];
  return alias !== undefined ? shiftJisAlts(alias) : null;
}

function eucJpAlts(cp: number): Alts {
  if (cp < 0x80) return [[cp]];
  if (cp >= 0xff61 && cp <= 0xff9f) return [[0x8e, cp - 0xff61 + 0xa1]];
  const out: number[][] = [];
  for (const p of reverseIndex('jis0208').get(cp) ?? []) {
    if (p < 94 * 94) out.push([Math.floor(p / 94) + 0xa1, (p % 94) + 0xa1]);
  }
  for (const p of reverseIndex('jis0212').get(cp) ?? []) {
    out.push([0x8f, Math.floor(p / 94) + 0xa1, (p % 94) + 0xa1]);
  }
  if (out.length) return out;
  if (cp === 0xa5) return [[0x5c]];
  if (cp === 0x203e) return [[0x7e]];
  const alias = JIS_ALIASES[cp];
  return alias !== undefined ? eucJpAlts(alias) : null;
}

const big5PointerBytes = (p: number): number[] => {
  const trail = p % 157;
  return [Math.floor(p / 157) + 0x81, trail + (trail < 0x3f ? 0x40 : 0x62)];
};

function big5Alts(cp: number): Alts {
  if (cp < 0x80) return [[cp]];
  const ps = reverseIndex('big5').get(cp);
  if (!ps) return null;
  // The WHATWG encoder skips the HKSCS block below pointer 5024 and prefers
  // the last pointer for a handful of duplicated characters.
  const valid = ps.filter((p) => p >= (0xa1 - 0x81) * 157);
  let pref = ps[0]!;
  if (valid.length) {
    pref = [0x2550, 0x255e, 0x2561, 0x256a, 0x5341, 0x5345].includes(cp) ? valid[valid.length - 1]! : valid[0]!;
  }
  return [pref, ...ps.filter((p) => p !== pref)].map(big5PointerBytes);
}

const GB18030_PUA: Record<number, number> = Object.fromEntries(
  (
    [
      [0xe78d, 0xa6d9],
      [0xe78e, 0xa6da],
      [0xe78f, 0xa6db],
      [0xe790, 0xa6dc],
      [0xe791, 0xa6dd],
      [0xe792, 0xa6de],
      [0xe793, 0xa6df],
      [0xe794, 0xa6ec],
      [0xe795, 0xa6ed],
      [0xe796, 0xa6f3],
      [0xe81e, 0xfe59],
      [0xe826, 0xfe61],
      [0xe82b, 0xfe66],
      [0xe82c, 0xfe67],
      [0xe832, 0xfe6d],
      [0xe843, 0xfe7e],
      [0xe854, 0xfe90],
      [0xe864, 0xfea0],
    ] as const
  ).map(([cp, bytes]) => [cp, ((bytes >> 8) - 0x81) * 190 + ((bytes & 0xff) - ((bytes & 0xff) < 0x7f ? 0x40 : 0x41))]),
);

const gbPointerBytes = (p: number): number[] => {
  const trail = p % 190;
  return [Math.floor(p / 190) + 0x81, trail + (trail < 0x3f ? 0x40 : 0x41)];
};

function gb18030Alts(cp: number): Alts {
  if (cp < 0x80) return [[cp]];
  if (cp >= 0xd800 && cp <= 0xdfff) return null;
  const ps = reverseIndex('gb18030').get(cp);
  const out: number[][] = ps ? ps.map(gbPointerBytes) : [];
  if (cp === 0x20ac) out.push([0x80]);
  if (out.length) return out;
  if (cp === 0xe5e5) return null;
  // GB18030-2022 moved 18 characters out of the private use area; the WHATWG
  // encoder still maps the old PUA code points to their two-byte sequences.
  const pua = GB18030_PUA[cp];
  if (pua !== undefined) return [gbPointerBytes(pua)];
  let p = gb18030RangesPointer(cp);
  const b1 = Math.floor(p / 12600);
  p -= b1 * 12600;
  const b2 = Math.floor(p / 1260);
  p -= b2 * 1260;
  const b3 = Math.floor(p / 10);
  const b4 = p - b3 * 10;
  return [[b1 + 0x81, b2 + 0x30, b3 + 0x81, b4 + 0x30]];
}

function eucKrAlts(cp: number): Alts {
  if (cp < 0x80) return [[cp]];
  const ps = reverseIndex('euc-kr').get(cp);
  return ps ? ps.map((p) => [Math.floor(p / 190) + 0x81, (p % 190) + 0x41]) : null;
}

function windows1252Alts(cp: number): Alts {
  if (cp < 0x80) return [[cp]];
  const ps = reverseIndex('windows-1252').get(cp);
  if (ps) return ps.map((p) => [p + 0x80]);
  // ISO-8859-1 decoders (Python's latin-1, MySQL's latin1) turn 0x80-0x9F into C1 controls.
  return cp <= 0x9f ? [[cp]] : null;
}

export function utf8Bytes(cp: number): number[] | null {
  if (cp < 0x80) return [cp];
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 0x3f)];
  if (cp >= 0xd800 && cp <= 0xdfff) return null;
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f)];
}

const memo = new Map<EncodingId, Map<number, Alts>>();

/**
 * All byte sequences that `enc`'s decoder turns into `cp`, preferred first.
 * Returns null when the code point cannot be encoded. Not used for ISO-2022-JP,
 * which is stateful.
 */
export function encodeAlternatives(cp: number, enc: EncodingId): Alts {
  if (enc === 'utf-8') {
    const b = utf8Bytes(cp);
    return b ? [b] : null;
  }
  let m = memo.get(enc);
  if (!m) memo.set(enc, (m = new Map()));
  let r = m.get(cp);
  if (r === undefined) {
    switch (enc) {
      case 'shift_jis':
        r = shiftJisAlts(cp);
        break;
      case 'euc-jp':
        r = eucJpAlts(cp);
        break;
      case 'big5':
        r = big5Alts(cp);
        break;
      case 'gb18030':
        r = gb18030Alts(cp);
        break;
      case 'euc-kr':
        r = eucKrAlts(cp);
        break;
      case 'windows-1252':
        r = windows1252Alts(cp);
        break;
      default:
        r = cp < 0x80 ? [[cp]] : null;
    }
    m.set(cp, r);
  }
  return r;
}

export interface EncodeResult {
  bytes: Uint8Array;
  /** Code points that had no mapping and were replaced by '?'. */
  unmappable: number;
}

/** Encode text, replacing unmappable characters with '?'. */
export function encode(text: string, enc: EncodingId): EncodeResult {
  if (enc === 'iso-2022-jp') return encodeIso2022Jp(text);
  const out: number[] = [];
  let unmappable = 0;
  const cps = Array.from(text, (c) => c.codePointAt(0)!);
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i]!;
    if (enc === 'big5' && (cp === 0xca || cp === 0xea)) {
      const next = cps[i + 1];
      const p = next === 0x304 ? 1133 : next === 0x30c ? 1135 : -1;
      if (p > 0) {
        out.push(...big5PointerBytes(cp === 0xca ? p : p + 31));
        i++;
        continue;
      }
    }
    const alts = encodeAlternatives(cp, enc);
    if (alts) out.push(...alts[0]!);
    else {
      out.push(0x3f);
      unmappable++;
    }
  }
  return { bytes: Uint8Array.from(out), unmappable };
}

function encodeIso2022Jp(text: string): EncodeResult {
  const jis = reverseIndex('jis0208');
  const kata = index('iso-2022-jp-katakana');
  const out: number[] = [];
  let unmappable = 0;
  let state = 'ascii' as 'ascii' | 'roman' | 'jis';
  const to = (s: typeof state) => {
    if (state === s) return;
    state = s;
    out.push(...(s === 'ascii' ? [0x1b, 0x28, 0x42] : s === 'roman' ? [0x1b, 0x28, 0x4a] : [0x1b, 0x24, 0x42]));
  };
  for (const ch of text) {
    let cp = ch.codePointAt(0)!;
    if (cp < 0x80 && cp !== 0x0e && cp !== 0x0f && cp !== 0x1b) {
      if (!(state === 'roman' && cp !== 0x5c && cp !== 0x7e)) to('ascii');
      out.push(cp);
      continue;
    }
    if (cp === 0xa5 || cp === 0x203e) {
      to('roman');
      out.push(cp === 0xa5 ? 0x5c : 0x7e);
      continue;
    }
    if (cp === 0x2212) cp = 0xff0d;
    if (cp >= 0xff61 && cp <= 0xff9f) cp = kata[cp - 0xff61]!;
    const p = jis.get(cp)?.[0];
    if (p === undefined || p >= 94 * 94) {
      to('ascii');
      out.push(0x3f);
      unmappable++;
      continue;
    }
    to('jis');
    out.push(Math.floor(p / 94) + 0x21, (p % 94) + 0x21);
  }
  to('ascii');
  return { bytes: Uint8Array.from(out), unmappable };
}
