import * as W from '../data/whatwg.js';

export type IndexName = 'jis0208' | 'jis0212' | 'big5' | 'gb18030' | 'euc-kr' | 'windows-1252' | 'iso-2022-jp-katakana';

const SOURCES: Record<IndexName, string> = {
  jis0208: W.JIS0208,
  jis0212: W.JIS0212,
  big5: W.BIG5,
  gb18030: W.GB18030,
  'euc-kr': W.EUC_KR,
  'windows-1252': W.WINDOWS_1252,
  'iso-2022-jp-katakana': W.ISO_2022_JP_KATAKANA,
};

const cache = new Map<IndexName, Int32Array>();

/** Pointer -> code point, or -1 when the pointer has no code point. */
export function index(name: IndexName): Int32Array {
  let a = cache.get(name);
  if (!a) {
    const src = SOURCES[name];
    a = new Int32Array(src.length);
    let n = 0;
    for (const ch of src) {
      const cp = ch.codePointAt(0)!;
      a[n++] = cp === 0xfffd ? -1 : cp;
    }
    a = a.subarray(0, n);
    cache.set(name, a);
  }
  return a;
}

const reverseCache = new Map<IndexName, Map<number, number[]>>();

/** Code point -> all pointers that decode to it, in pointer order. */
export function reverseIndex(name: IndexName): Map<number, number[]> {
  let m = reverseCache.get(name);
  if (!m) {
    m = new Map();
    const a = index(name);
    for (let p = 0; p < a.length; p++) {
      const cp = a[p]!;
      if (cp < 0) continue;
      const list = m.get(cp);
      if (list) list.push(p);
      else m.set(cp, [p]);
    }
    reverseCache.set(name, m);
  }
  return m;
}

/** WHATWG "index gb18030 ranges code point". */
export function gb18030RangesCodePoint(pointer: number): number {
  if ((pointer > 39419 && pointer < 189000) || pointer > 1237575) return -1;
  if (pointer >= 189000) return 0x10000 + pointer - 189000;
  if (pointer === 7457) return 0xe7c7;
  const r = W.GB18030_RANGES;
  let lo = 0;
  let hi = r.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (r[mid]![0] <= pointer) lo = mid;
    else hi = mid - 1;
  }
  const [offset, cpOffset] = r[lo]!;
  return cpOffset + pointer - offset;
}

/** WHATWG "index gb18030 ranges pointer". */
export function gb18030RangesPointer(cp: number): number {
  if (cp >= 0x10000) return 189000 + cp - 0x10000;
  if (cp === 0xe7c7) return 7457;
  const r = W.GB18030_RANGES;
  let lo = 0;
  let hi = r.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (r[mid]![1] <= cp) lo = mid;
    else hi = mid - 1;
  }
  const [pointerOffset, offset] = r[lo]!;
  return pointerOffset + cp - offset;
}
