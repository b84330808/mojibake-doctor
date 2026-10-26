// Decoders that follow the WHATWG Encoding Standard, so results match what
// browsers produce. Errors become U+FFFD and are counted.

import type { EncodingId } from './types.js';
import { gb18030RangesCodePoint, index } from './tables.js';

export interface DecodeResult {
  /** Decoded code points; -1 marks a decoding error (U+FFFD). */
  cps: number[];
  errors: number;
}

type Bytes = ArrayLike<number>;

export function decodeToCodePoints(bytes: Bytes, enc: EncodingId): DecodeResult {
  switch (enc) {
    case 'utf-8':
      return decodeUtf8(bytes);
    case 'shift_jis':
      return decodeShiftJis(bytes);
    case 'euc-jp':
      return decodeEucJp(bytes);
    case 'iso-2022-jp':
      return decodeIso2022Jp(bytes);
    case 'big5':
      return decodeBig5(bytes);
    case 'gb18030':
      return decodeGb18030(bytes);
    case 'euc-kr':
      return decodeEucKr(bytes);
    case 'windows-1252':
      return decodeWindows1252(bytes);
  }
}

export function decode(bytes: Bytes, enc: EncodingId): string {
  return codePointsToString(decodeToCodePoints(bytes, enc).cps);
}

export function codePointsToString(cps: readonly number[]): string {
  let s = '';
  for (let i = 0; i < cps.length; i += 4096) {
    const chunk = cps.slice(i, i + 4096).map((c) => (c < 0 ? 0xfffd : c));
    s += String.fromCodePoint(...chunk);
  }
  return s;
}

function decodeUtf8(b: Bytes): DecodeResult {
  const cps: number[] = [];
  let errors = 0;
  let i = 0;
  const n = b.length;
  while (i < n) {
    const x = b[i]!;
    if (x < 0x80) {
      cps.push(x);
      i++;
      continue;
    }
    let need = 0;
    let cp = 0;
    let lo = 0x80;
    let hi = 0xbf;
    if (x >= 0xc2 && x <= 0xdf) {
      need = 1;
      cp = x & 0x1f;
    } else if (x >= 0xe0 && x <= 0xef) {
      need = 2;
      cp = x & 0x0f;
      if (x === 0xe0) lo = 0xa0;
      if (x === 0xed) hi = 0x9f;
    } else if (x >= 0xf0 && x <= 0xf4) {
      need = 3;
      cp = x & 0x07;
      if (x === 0xf0) lo = 0x90;
      if (x === 0xf4) hi = 0x8f;
    } else {
      cps.push(-1);
      errors++;
      i++;
      continue;
    }
    let j = i + 1;
    let ok = true;
    for (let k = 0; k < need; k++, j++) {
      const y = j < n ? b[j]! : -1;
      if (y < lo || y > hi) {
        ok = false;
        break;
      }
      cp = (cp << 6) | (y & 0x3f);
      lo = 0x80;
      hi = 0xbf;
    }
    if (ok) {
      cps.push(cp);
      i = j;
    } else {
      // Maximal subpart: drop the lead and the valid continuation bytes seen so far.
      cps.push(-1);
      errors++;
      i = j;
    }
  }
  return { cps, errors };
}

function decodeShiftJis(b: Bytes): DecodeResult {
  const jis = index('jis0208');
  const cps: number[] = [];
  let errors = 0;
  let lead = 0;
  for (let i = 0; i < b.length; i++) {
    const x = b[i]!;
    if (lead !== 0) {
      const l = lead;
      lead = 0;
      let pointer = -1;
      const offset = x < 0x7f ? 0x40 : 0x41;
      const leadOffset = l < 0xa0 ? 0x81 : 0xc1;
      if ((x >= 0x40 && x <= 0x7e) || (x >= 0x80 && x <= 0xfc)) pointer = (l - leadOffset) * 188 + x - offset;
      if (pointer >= 8836 && pointer <= 10715) {
        cps.push(0xe000 - 8836 + pointer);
        continue;
      }
      const cp = pointer >= 0 && pointer < jis.length ? jis[pointer]! : -1;
      if (cp >= 0) {
        cps.push(cp);
        continue;
      }
      if (x < 0x80) i--;
      cps.push(-1);
      errors++;
      continue;
    }
    if (x <= 0x80) cps.push(x);
    else if (x >= 0xa1 && x <= 0xdf) cps.push(0xff61 - 0xa1 + x);
    else if ((x >= 0x81 && x <= 0x9f) || (x >= 0xe0 && x <= 0xfc)) lead = x;
    else {
      cps.push(-1);
      errors++;
    }
  }
  if (lead !== 0) {
    cps.push(-1);
    errors++;
  }
  return { cps, errors };
}

function decodeEucJp(b: Bytes): DecodeResult {
  const jis = index('jis0208');
  const jis12 = index('jis0212');
  const cps: number[] = [];
  let errors = 0;
  let lead = 0;
  let jis0212 = false;
  for (let i = 0; i < b.length; i++) {
    const x = b[i]!;
    if (lead === 0x8e && x >= 0xa1 && x <= 0xdf) {
      lead = 0;
      cps.push(0xff61 - 0xa1 + x);
      continue;
    }
    if (lead === 0x8f && x >= 0xa1 && x <= 0xfe) {
      jis0212 = true;
      lead = x;
      continue;
    }
    if (lead !== 0) {
      const l = lead;
      lead = 0;
      let cp = -1;
      if (l >= 0xa1 && l <= 0xfe && x >= 0xa1 && x <= 0xfe) {
        const pointer = (l - 0xa1) * 94 + x - 0xa1;
        const table = jis0212 ? jis12 : jis;
        cp = pointer < table.length ? table[pointer]! : -1;
      }
      jis0212 = false;
      if (cp >= 0) {
        cps.push(cp);
        continue;
      }
      if (x < 0x80) i--;
      cps.push(-1);
      errors++;
      continue;
    }
    if (x < 0x80) cps.push(x);
    else if (x === 0x8e || x === 0x8f || (x >= 0xa1 && x <= 0xfe)) lead = x;
    else {
      cps.push(-1);
      errors++;
    }
  }
  if (lead !== 0) {
    cps.push(-1);
    errors++;
  }
  return { cps, errors };
}

function decodeIso2022Jp(b: Bytes): DecodeResult {
  const jis = index('jis0208');
  const cps: number[] = [];
  let errors = 0;
  const ASCII = 0;
  const ROMAN = 1;
  const KATAKANA = 2;
  const LEAD = 3;
  const TRAIL = 4;
  const ESC_START = 5;
  const ESC = 6;
  let state = ASCII;
  let outState = ASCII;
  let lead = 0;
  let outputFlag = false;
  const err = () => {
    cps.push(-1);
    errors++;
  };
  const queue: number[] = [];
  let i = 0;
  const next = (): number => (queue.length ? queue.shift()! : i < b.length ? b[i++]! : -1);
  for (;;) {
    const x = next();
    if (x < 0) {
      // End of input.
      if (state === TRAIL) {
        state = LEAD;
        err();
      } else if (state === ESC_START) {
        state = outState;
        err();
      } else if (state === ESC) {
        queue.push(lead);
        lead = 0;
        state = outState;
        err();
        continue;
      }
      break;
    }
    switch (state) {
      case ASCII:
      case ROMAN:
        if (x === 0x1b) state = ESC_START;
        else if (x <= 0x7f && x !== 0x0e && x !== 0x0f) {
          outputFlag = false;
          cps.push(state === ROMAN && x === 0x5c ? 0xa5 : state === ROMAN && x === 0x7e ? 0x203e : x);
        } else {
          outputFlag = false;
          err();
        }
        break;
      case KATAKANA:
        if (x === 0x1b) state = ESC_START;
        else if (x >= 0x21 && x <= 0x5f) {
          outputFlag = false;
          cps.push(0xff61 - 0x21 + x);
        } else {
          outputFlag = false;
          err();
        }
        break;
      case LEAD:
        if (x === 0x1b) state = ESC_START;
        else if (x >= 0x21 && x <= 0x7e) {
          outputFlag = false;
          lead = x;
          state = TRAIL;
        } else {
          outputFlag = false;
          err();
        }
        break;
      case TRAIL:
        if (x === 0x1b) {
          state = ESC_START;
          err();
        } else if (x >= 0x21 && x <= 0x7e) {
          state = LEAD;
          const cp = jis[(lead - 0x21) * 94 + x - 0x21] ?? -1;
          if (cp >= 0) cps.push(cp);
          else err();
        } else {
          state = LEAD;
          err();
        }
        break;
      case ESC_START:
        if (x === 0x24 || x === 0x28) {
          lead = x;
          state = ESC;
        } else {
          queue.unshift(x);
          outputFlag = false;
          state = outState;
          err();
        }
        break;
      case ESC: {
        const l = lead;
        lead = 0;
        let s = -1;
        if (l === 0x28 && x === 0x42) s = ASCII;
        else if (l === 0x28 && x === 0x4a) s = ROMAN;
        else if (l === 0x28 && x === 0x49) s = KATAKANA;
        else if (l === 0x24 && (x === 0x40 || x === 0x42)) s = LEAD;
        if (s >= 0) {
          state = outState = s;
          const output = outputFlag;
          outputFlag = true;
          if (output) err();
        } else {
          queue.unshift(l, x);
          outputFlag = false;
          state = outState;
          err();
        }
        break;
      }
    }
  }
  return { cps, errors };
}

function decodeBig5(b: Bytes): DecodeResult {
  const big5 = index('big5');
  const cps: number[] = [];
  let errors = 0;
  let lead = 0;
  for (let i = 0; i < b.length; i++) {
    const x = b[i]!;
    if (lead !== 0) {
      const l = lead;
      lead = 0;
      let pointer = -1;
      const offset = x < 0x7f ? 0x40 : 0x62;
      if ((x >= 0x40 && x <= 0x7e) || (x >= 0xa1 && x <= 0xfe)) pointer = (l - 0x81) * 157 + (x - offset);
      if (pointer === 1133) cps.push(0xca, 0x304);
      else if (pointer === 1135) cps.push(0xca, 0x30c);
      else if (pointer === 1164) cps.push(0xea, 0x304);
      else if (pointer === 1166) cps.push(0xea, 0x30c);
      else {
        const cp = pointer >= 0 && pointer < big5.length ? big5[pointer]! : -1;
        if (cp >= 0) cps.push(cp);
        else {
          if (x < 0x80) i--;
          cps.push(-1);
          errors++;
        }
      }
      continue;
    }
    if (x < 0x80) cps.push(x);
    else if (x >= 0x81 && x <= 0xfe) lead = x;
    else {
      cps.push(-1);
      errors++;
    }
  }
  if (lead !== 0) {
    cps.push(-1);
    errors++;
  }
  return { cps, errors };
}

function decodeGb18030(b: Bytes): DecodeResult {
  const gb = index('gb18030');
  const cps: number[] = [];
  let errors = 0;
  let first = 0;
  let second = 0;
  let third = 0;
  const queue: number[] = [];
  let i = 0;
  const next = (): number => (queue.length ? queue.shift()! : i < b.length ? b[i++]! : -1);
  const err = () => {
    cps.push(-1);
    errors++;
  };
  for (;;) {
    const x = next();
    if (x < 0) {
      if (first || second || third) {
        first = second = third = 0;
        err();
      }
      break;
    }
    if (third !== 0) {
      if (x < 0x30 || x > 0x39) {
        queue.unshift(second, third, x);
        first = second = third = 0;
        err();
        continue;
      }
      const cp = gb18030RangesCodePoint(
        (((first - 0x81) * 10 + second - 0x30) * 126 + third - 0x81) * 10 + x - 0x30,
      );
      first = second = third = 0;
      if (cp < 0) err();
      else cps.push(cp);
      continue;
    }
    if (second !== 0) {
      if (x >= 0x81 && x <= 0xfe) {
        third = x;
        continue;
      }
      queue.unshift(second, x);
      first = second = 0;
      err();
      continue;
    }
    if (first !== 0) {
      if (x >= 0x30 && x <= 0x39) {
        second = x;
        continue;
      }
      const l = first;
      first = 0;
      let pointer = -1;
      const offset = x < 0x7f ? 0x40 : 0x41;
      if ((x >= 0x40 && x <= 0x7e) || (x >= 0x80 && x <= 0xfe)) pointer = (l - 0x81) * 190 + (x - offset);
      const cp = pointer >= 0 && pointer < gb.length ? gb[pointer]! : -1;
      if (cp >= 0) {
        cps.push(cp);
        continue;
      }
      if (x < 0x80) queue.unshift(x);
      err();
      continue;
    }
    if (x < 0x80) cps.push(x);
    else if (x === 0x80) cps.push(0x20ac);
    else if (x <= 0xfe) first = x;
    else err();
  }
  return { cps, errors };
}

function decodeEucKr(b: Bytes): DecodeResult {
  const kr = index('euc-kr');
  const cps: number[] = [];
  let errors = 0;
  let lead = 0;
  for (let i = 0; i < b.length; i++) {
    const x = b[i]!;
    if (lead !== 0) {
      const l = lead;
      lead = 0;
      const pointer = x >= 0x41 && x <= 0xfe ? (l - 0x81) * 190 + (x - 0x41) : -1;
      const cp = pointer >= 0 && pointer < kr.length ? kr[pointer]! : -1;
      if (cp >= 0) {
        cps.push(cp);
        continue;
      }
      if (x < 0x80) i--;
      cps.push(-1);
      errors++;
      continue;
    }
    if (x < 0x80) cps.push(x);
    else if (x >= 0x81 && x <= 0xfe) lead = x;
    else {
      cps.push(-1);
      errors++;
    }
  }
  if (lead !== 0) {
    cps.push(-1);
    errors++;
  }
  return { cps, errors };
}

function decodeWindows1252(b: Bytes): DecodeResult {
  const t = index('windows-1252');
  const cps: number[] = new Array(b.length);
  for (let i = 0; i < b.length; i++) {
    const x = b[i]!;
    cps[i] = x < 0x80 ? x : t[x - 0x80]!;
  }
  return { cps, errors: 0 };
}
