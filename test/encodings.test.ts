import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decode, encode, ENCODINGS, type EncodingId } from '../src/index.js';
import { encodeAlternatives } from '../src/encodings/encode.js';
import { decodeToCodePoints } from '../src/encodings/decode.js';
import { index } from '../src/encodings/tables.js';

const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

/** Every byte sequence a table-driven decoder maps to a single code point. */
function* tableSequences(enc: EncodingId): Generator<number[]> {
  if (enc === 'shift_jis') {
    const n = index('jis0208').length;
    for (let p = 0; p < n; p++) {
      const lead = Math.floor(p / 188);
      const trail = p % 188;
      yield [lead + (lead < 0x1f ? 0x81 : 0xc1), trail + (trail < 0x3f ? 0x40 : 0x41)];
    }
    for (let b = 0xa1; b <= 0xdf; b++) yield [b];
  } else if (enc === 'euc-jp') {
    for (let p = 0; p < 94 * 94; p++) yield [Math.floor(p / 94) + 0xa1, (p % 94) + 0xa1];
    for (let p = 0; p < 94 * 94; p++) yield [0x8f, Math.floor(p / 94) + 0xa1, (p % 94) + 0xa1];
    for (let b = 0xa1; b <= 0xdf; b++) yield [0x8e, b];
  } else if (enc === 'big5') {
    for (let p = 0; p < index('big5').length; p++) {
      const trail = p % 157;
      yield [Math.floor(p / 157) + 0x81, trail + (trail < 0x3f ? 0x40 : 0x62)];
    }
  } else if (enc === 'gb18030') {
    for (let p = 0; p < index('gb18030').length; p++) {
      const trail = p % 190;
      yield [Math.floor(p / 190) + 0x81, trail + (trail < 0x3f ? 0x40 : 0x41)];
    }
    yield [0x80];
  } else if (enc === 'euc-kr') {
    for (let p = 0; p < index('euc-kr').length; p++) yield [Math.floor(p / 190) + 0x81, (p % 190) + 0x41];
  } else if (enc === 'windows-1252') {
    for (let b = 0x80; b <= 0xff; b++) yield [b];
  }
}

describe('encoders invert the WHATWG decoders', () => {
  for (const enc of ['shift_jis', 'euc-jp', 'big5', 'gb18030', 'euc-kr', 'windows-1252'] as EncodingId[]) {
    it(`${enc}: every decodable sequence is among the encoder's alternatives`, () => {
      let checked = 0;
      for (const bytes of tableSequences(enc)) {
        const r = decodeToCodePoints(bytes, enc);
        if (r.errors || r.cps.length !== 1) continue;
        const alts = encodeAlternatives(r.cps[0]!, enc);
        if (!alts?.some((a) => hex(a) === hex(bytes))) {
          throw new Error(`${enc}: ${hex(bytes)} -> U+${r.cps[0]!.toString(16)} not re-encodable (got ${alts?.map(hex)})`);
        }
        checked++;
      }
      expect(checked).toBeGreaterThan(enc === 'windows-1252' ? 100 : 7000);
    });
  }

  it('gb18030 four-byte sequences round-trip for the whole BMP and beyond', () => {
    for (let cp = 0x80; cp < 0x110000; cp += cp < 0x10000 ? 1 : 997) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      // GB18030-2022 encoder-only mappings decode to the new characters.
      if (cp >= 0xe78d && cp <= 0xe864) continue;
      const s = String.fromCodePoint(cp);
      const { bytes, unmappable } = encode(s, 'gb18030');
      if (unmappable) continue;
      expect(decode(bytes, 'gb18030'), `U+${cp.toString(16)}`).toBe(s);
    }
  });
});

describe('WHATWG decoder details', () => {
  const cases: Array<[EncodingId, number[], string]> = [
    ['shift_jis', [0x80], '\u0080'],
    ['shift_jis', [0x5c, 0x7e], '\\~'],
    ['shift_jis', [0x81, 0x60], '～'],
    ['shift_jis', [0x87, 0x40], '①'],
    ['shift_jis', [0xf0, 0x40], ''],
    ['shift_jis', [0x82, 0x20], '� '],
    ['euc-jp', [0x80], '�'],
    ['euc-jp', [0x8e, 0xb1], 'ｱ'],
    ['euc-jp', [0x8f, 0xb0, 0xa1], '丂'],
    ['big5', [0x88, 0x62], 'Ê̄'],
    ['big5', [0xa4, 0xa4, 0xa4, 0xe5], '中文'],
    ['gb18030', [0x80], '€'],
    ['gb18030', [0x81, 0x30, 0x81, 0x30], '\u0080'],
    ['gb18030', [0x90, 0x30, 0x81, 0x30], '\u{10000}'],
    ['euc-kr', [0xc7, 0xd1, 0xb1, 0xdb], '한글'],
    ['windows-1252', [0x80, 0x81, 0x9d], '€\u0081\u009d'],
    ['iso-2022-jp', [0x1b, 0x24, 0x42, 0x30, 0x21, 0x1b, 0x28, 0x42, 0x41], '亜A'],
    ['iso-2022-jp', [0x1b, 0x28, 0x4a, 0x5c], '¥'],
    ['iso-2022-jp', [0x1b, 0x28, 0x49, 0x31], 'ｱ'],
    ['utf-8', [0xe3, 0x81, 0x93, 0xe3, 0x81], 'こ�'],
    ['utf-8', [0xf0, 0x9f, 0x98, 0x80], '😀'],
  ];
  for (const [enc, bytes, expected] of cases) {
    it(`${enc} ${hex(bytes)}`, () => expect(decode(bytes, enc)).toBe(expected));
  }
});

describe('round-trip property', () => {
  // Characters each encoding can represent, sampled from the tables themselves.
  const charsFor = (enc: EncodingId): string[] => {
    const out = new Set<string>(['a', 'Z', '0', ' ', '\n', '?']);
    const table = enc === 'euc-kr' ? 'euc-kr' : enc === 'big5' ? 'big5' : enc === 'gb18030' ? 'gb18030' : 'jis0208';
    if (enc === 'windows-1252') for (const cp of index('windows-1252')) out.add(String.fromCodePoint(cp));
    else if (enc === 'utf-8') ['é', '日', '한', '😀', '\u0000'].forEach((c) => out.add(c));
    else {
      const t = index(table);
      for (let p = 0; p < t.length; p += 7) {
        const cp = t[p]!;
        if (cp < 0) continue;
        const c = String.fromCodePoint(cp);
        const e = encode(c, enc);
        if (!e.unmappable && decode(e.bytes, enc) === c) out.add(c);
      }
    }
    return [...out];
  };
  for (const enc of ENCODINGS) {
    it(`${enc}: decode(encode(s)) === s`, () => {
      const chars = charsFor(enc);
      fc.assert(
        fc.property(fc.array(fc.constantFrom(...chars), { maxLength: 30 }), (arr) => {
          const s = arr.join('');
          expect(decode(encode(s, enc).bytes, enc)).toBe(s);
        }),
        { seed: 2026, numRuns: 200 },
      );
    });
  }
});
