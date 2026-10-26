// Re-encoding garbled text into the bytes it came from, and decoding those
// bytes again while repairing what got lost on the way.
//
// Garbled text is encoded with the encoding it was wrongly decoded as. The
// result is a token stream: known bytes, plus
//   - holes, where the wrong decoder emitted U+FFFD (1..n unknown bytes),
//   - choices, for characters with several possible byte sequences, or for
//     '?' and '・', which Windows emits for bytes it cannot decode,
//   - pass-through characters the wrong encoding cannot represent.
// Decoding to UTF-8 runs a dynamic program over the tokens that picks, for
// every unknown byte, the value giving the most plausible character, and can
// re-insert bytes that tools silently drop (C1 controls, soft hyphens).

import { decodeToCodePoints, codePointsToString } from './encodings/decode.js';
import { encodeAlternatives } from './encodings/encode.js';
import type { EncodingId } from './encodings/types.js';
import { charWeight, classify, Script, scoreText } from './score.js';

export type Special =
  | { t: 'hole'; min: number; max: number }
  | { t: 'choice'; alts: number[][]; litCost: number; hole?: { min: number; max: number; cost: number } }
  | { t: 'pass'; cp: number };
export type Tok = number | Special;

export interface Segment {
  text: string;
  kind: 'ok' | 'guessed' | 'lost' | 'error';
  /** Other likely characters for a guessed one. */
  alternatives?: string[];
}

export interface RepairResult {
  text: string;
  segments: Segment[];
  /** Sum of repair penalties (<= 0): guesses, inserted bytes, new decoding errors. */
  cost: number;
  guessed: number;
  lost: number;
  errors: number;
}

export interface Encoded {
  toks: Tok[];
  pass: number;
  /** Any byte >= 0x80 or unknown byte. */
  high: boolean;
  /** Contains ESC (0x1B). */
  esc: boolean;
}

/** How many bytes one U+FFFD from this decoder can stand for. */
const HOLE_MAX: Record<EncodingId, number> = {
  'utf-8': 3,
  shift_jis: 2,
  'euc-jp': 2,
  'iso-2022-jp': 2,
  big5: 2,
  gb18030: 2,
  'euc-kr': 2,
  'windows-1252': 1,
};

/** Replacement characters Windows uses: '?' for most code pages, '・' for cp932. */
const MARKERS: Partial<Record<EncodingId, ReadonlyArray<readonly [cp: number, litCost: number, holeCost: number]>>> = {
  shift_jis: [
    [0x30fb, -5, -3],
    [0x3f, 0, -5],
  ],
  'euc-jp': [[0x3f, 0, -5]],
  big5: [[0x3f, 0, -5]],
  gb18030: [[0x3f, 0, -5]],
  'euc-kr': [[0x3f, 0, -5]],
};

// Penalties, in the same log2 units as the text score.
const ERROR_COST = -10;
const GUESS_COST = -2;
const NBSP_COST = -3;
// A lost character that swallows bytes we do know throws away evidence.
const DROP_COST = -8;
// A guess this unlikely (rare symbols, other scripts) is shown as lost instead.
const GUESS_FLOOR = -13;
const LOST_WEIGHT = charWeight(0xfffd);

/**
 * Bytes that vanish when text decoded as Latin-1/cp1252 is copied around:
 * cp1252's five undefined bytes and other C1 controls, soft hyphen, NBSP.
 */
const LATIN1_DROPPED: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number]> = [];
  for (const b of [0x81, 0x8d, 0x8f, 0x90, 0x9d]) out.push([b, -2]);
  out.push([0xad, -3], [0xa0, -3]);
  for (let b = 0x80; b <= 0x9f; b++) if (![0x81, 0x8d, 0x8f, 0x90, 0x9d].includes(b)) out.push([b, -5]);
  return out;
})();

export function encodeForRepair(text: string, enc: EncodingId, maxPass = Infinity): Encoded | null {
  const toks: Tok[] = [];
  let pass = 0;
  let high = false;
  let esc = false;
  const markers = MARKERS[enc];
  const holeMax = HOLE_MAX[enc];
  const cps = Array.from(text, (c) => c.codePointAt(0)!);
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i]!;
    if (cp === 0xfffd) {
      toks.push({ t: 'hole', min: 1, max: holeMax });
      high = true;
      continue;
    }
    if (enc === 'big5' && (cp === 0xca || cp === 0xea) && (cps[i + 1] === 0x304 || cps[i + 1] === 0x30c)) {
      toks.push(0x88, cps[i + 1] === 0x304 ? (cp === 0xca ? 0x62 : 0xa3) : cp === 0xca ? 0x64 : 0xa5);
      high = true;
      i++;
      continue;
    }
    const alts = encodeAlternatives(cp, enc);
    if (!alts) {
      if (++pass > maxPass) return null;
      toks.push({ t: 'pass', cp });
      continue;
    }
    const marker = markers?.find((m) => m[0] === cp);
    if (marker) {
      toks.push({ t: 'choice', alts: [alts[0]!], litCost: marker[1], hole: { min: 1, max: holeMax, cost: marker[2] } });
      high = true;
      continue;
    }
    const first = alts[0]!;
    if (alts.length === 1) {
      for (const b of first) {
        toks.push(b);
        if (b >= 0x80) high = true;
        else if (b === 0x1b) esc = true;
      }
    } else {
      toks.push({ t: 'choice', alts: alts.slice(0, 3), litCost: 0 });
      high = true;
    }
  }
  return { toks, pass, high, esc };
}

export interface DecodeOptions {
  /** The encoding the garbled text was wrongly decoded with; enables repairs that fit it. */
  wrong?: EncodingId;
}

export function decodeTokens(toks: Tok[], enc: EncodingId, opts: DecodeOptions = {}): RepairResult {
  if (enc === 'utf-8') return decodeUtf8Tokens(toks, opts);
  const segments: Segment[] = [];
  let errors = 0;
  let lost = 0;
  let buf: number[] = [];
  const pushText = (text: string, kind: Segment['kind']) => {
    const last = segments[segments.length - 1];
    if (last && last.kind === kind && kind === 'ok') last.text += text;
    else segments.push({ text, kind });
  };
  const flush = () => {
    if (!buf.length) return;
    const r = decodeToCodePoints(buf, enc);
    errors += r.errors;
    let run: number[] = [];
    for (const cp of r.cps) {
      if (cp < 0) {
        if (run.length) pushText(codePointsToString(run), 'ok');
        run = [];
        pushText('\ufffd', 'error');
      } else run.push(cp);
    }
    if (run.length) pushText(codePointsToString(run), 'ok');
    buf = [];
  };
  let guessed = 0;
  let guessCost = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (typeof t === 'number') buf.push(t);
    else if (t.t === 'choice') buf.push(...t.alts[0]!);
    else {
      flush();
      if (t.t === 'hole') {
        const g = guessLostLead(toks, i + 1, enc);
        if (g) {
          segments.push({ text: g.text, kind: 'guessed', alternatives: g.alternatives });
          guessed++;
          guessCost += GUESS_COST;
          i++;
        } else {
          pushText('\ufffd', 'lost');
          lost++;
        }
      } else pushText(String.fromCodePoint(t.cp), 'ok');
    }
  }
  flush();
  return {
    text: segments.map((s) => s.text).join(''),
    segments,
    cost: errors * ERROR_COST + guessCost,
    guessed,
    lost,
    errors,
  };
}

const weight = charWeight;

/**
 * WHATWG decoders for double-byte encodings emit U+FFFD for a bad pair and
 * re-read the trail byte when it is ASCII. So "U+FFFD + x" often hides one lost
 * lead byte whose trail is x. Try every lead and keep the best one if it beats
 * treating the U+FFFD as lost, judged on the next few bytes.
 */
function guessLostLead(toks: Tok[], start: number, enc: EncodingId): { text: string; alternatives: string[] } | null {
  const next: number[] = [];
  for (let i = start; i < toks.length && next.length < 12; i++) {
    const t = toks[i]!;
    if (typeof t !== 'number') break;
    next.push(t);
  }
  if (!next.length) return null;
  const judge = (bytes: number[]) => {
    const r = decodeToCodePoints(bytes, enc);
    return scoreText(codePointsToString(r.cps)) + r.errors * ERROR_COST;
  };
  const cands: Array<[string, number]> = [];
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    const r = decodeToCodePoints([lead, next[0]!], enc);
    if (r.errors || r.cps.length !== 1) continue;
    const cp = r.cps[0]!;
    const w = weight(cp);
    if (w > GUESS_FLOOR) cands.push([String.fromCodePoint(cp), w]);
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b[1] - a[1]);
  const [text, w] = cands[0]!;
  // An ASCII byte right after U+FFFD is usually a re-read trail byte, not text.
  const asciiTrail = next[0]! >= 0x40 && next[0]! <= 0x7e ? 4 : 0;
  if (w + GUESS_COST + asciiTrail + judge(next.slice(1)) <= LOST_WEIGHT + judge(next)) return null;
  return { text, alternatives: cands.slice(1, 5).map((c) => c[0]) };
}

interface Opt {
  b: number; // byte value, or -1 for an unknown byte
  ni: number;
  nj: number;
  cost: number;
}

interface Cand {
  cp: number; // -1 = lost character
  dest: number;
  cost: number;
  guessed: boolean;
}

const contRange = (lead: number, k: number): [number, number] => {
  if (k > 0) return [0x80, 0xbf];
  if (lead === 0xe0) return [0xa0, 0xbf];
  if (lead === 0xed) return [0x80, 0x9f];
  if (lead === 0xf0) return [0x90, 0xbf];
  if (lead === 0xf4) return [0x80, 0x8f];
  return [0x80, 0xbf];
};
const leadNeed = (b: number) => (b >= 0xc2 && b <= 0xdf ? 1 : b >= 0xe0 && b <= 0xef ? 2 : b >= 0xf0 && b <= 0xf4 ? 3 : 0);
const leadBits = (b: number) => (b <= 0xdf ? b & 0x1f : b <= 0xef ? b & 0x0f : b & 0x07);

function decodeUtf8Tokens(toks: Tok[], opts: DecodeOptions): RepairResult {
  if (toks.every((t) => typeof t === 'number')) {
    const r = decodeToCodePoints(toks as number[], 'utf-8');
    if (r.errors === 0) {
      const text = codePointsToString(r.cps);
      return { text, segments: [{ text, kind: 'ok' }], cost: 0, guessed: 0, lost: 0, errors: 0 };
    }
  }
  return repairUtf8(toks, opts);
}

/**
 * DP over positions (token index i, offset j inside a hole or choice token).
 * key = i * 16 + j. For holes j = bytes used; for choices j = 1 + alt*4 + (bytes used - 1)
 * on a literal path and 12 + bytes used on the hole path.
 */
function repairUtf8(toks: Tok[], opts: DecodeOptions): RepairResult {
  const n = toks.length;
  const size = (n + 1) * 16;
  const score = new Float64Array(size).fill(-Infinity);
  const costs = new Float64Array(size);
  const prev = new Int32Array(size).fill(-1);
  const seg: Array<Segment | null> = new Array(size).fill(null);
  const insert = opts.wrong === 'windows-1252' ? LATIN1_DROPPED : null;
  const nbsp = opts.wrong === 'windows-1252';

  const take = (i: number, j: number, acc: number, out: Opt[]): void => {
    if (i >= n) return;
    const t = toks[i]!;
    if (typeof t === 'number') {
      out.push({ b: t, ni: i + 1, nj: 0, cost: acc });
      return;
    }
    if (t.t === 'pass') return;
    if (t.t === 'hole') {
      if (j < t.max) out.push(j + 1 === t.max ? { b: -1, ni: i + 1, nj: 0, cost: acc } : { b: -1, ni: i, nj: j + 1, cost: acc });
      if (j >= t.min) take(i + 1, 0, acc, out);
      return;
    }
    if (j === 0) {
      t.alts.forEach((alt, a) =>
        out.push(
          alt.length === 1
            ? { b: alt[0]!, ni: i + 1, nj: 0, cost: acc + t.litCost }
            : { b: alt[0]!, ni: i, nj: 1 + a * 4, cost: acc + t.litCost },
        ),
      );
      if (t.hole) {
        const h = t.hole;
        out.push(h.max === 1 ? { b: -1, ni: i + 1, nj: 0, cost: acc + h.cost } : { b: -1, ni: i, nj: 13, cost: acc + h.cost });
      }
      return;
    }
    if (j < 13) {
      const a = (j - 1) >> 2;
      const k = ((j - 1) & 3) + 1;
      const alt = t.alts[a]!;
      out.push(k + 1 === alt.length ? { b: alt[k]!, ni: i + 1, nj: 0, cost: acc } : { b: alt[k]!, ni: i, nj: j + 1, cost: acc });
      return;
    }
    const h = t.hole!;
    const used = j - 12;
    if (used < h.max) out.push(used + 1 === h.max ? { b: -1, ni: i + 1, nj: 0, cost: acc } : { b: -1, ni: i, nj: j + 1, cost: acc });
    if (used >= h.min) take(i + 1, 0, acc, out);
  };
  const takeAll = (i: number, j: number): Opt[] => {
    const out: Opt[] = [];
    take(i, j, 0, out);
    return out;
  };

  const relax = (from: number, to: number, w: number, c: number, s: Segment | null) => {
    const v = score[from]! + w + c;
    if (v > score[to]!) {
      score[to] = v;
      costs[to] = costs[from]! + c;
      prev[to] = from;
      seg[to] = s;
    }
  };

  // Consumes a lost character's remaining bytes: up to `left` unknown or continuation bytes.
  const lostTail = (ni: number, nj: number, cost: number, left: number, out: Cand[]) => {
    out.push({ cp: -1, dest: ni * 16 + nj, cost, guessed: false });
    if (left === 0) return;
    for (const o of takeAll(ni, nj)) {
      // Swallowing another unknown byte costs as much as a separate lost character, so
      // merging several U+FFFD into one cannot make a candidate look better.
      if (o.b === -1 || (o.b >= 0x80 && o.b <= 0xbf))
        lostTail(o.ni, o.nj, cost + o.cost + (o.b === -1 ? LOST_WEIGHT : DROP_COST), left - 1, out);
    }
  };

  const fill = (
    lead: number,
    need: number,
    k: number,
    acc: number,
    ni: number,
    nj: number,
    cost: number,
    wild: number,
    ins: number,
    out: Cand[],
  ): void => {
    if (k === need) {
      out.push({ cp: acc, dest: ni * 16 + nj, cost, guessed: wild + ins > 0 });
      return;
    }
    const [lo, hi] = contRange(lead, k);
    for (const o of takeAll(ni, nj)) {
      if (o.b === -1) {
        if (wild >= 1) {
          lostTail(o.ni, o.nj, cost + o.cost, need - k - 1, out);
          continue;
        }
        for (let v = lo; v <= hi; v++)
          fill(lead, need, k + 1, (acc << 6) | (v & 0x3f), o.ni, o.nj, cost + o.cost + GUESS_COST, wild + 1, ins, out);
      } else if (o.b >= lo && o.b <= hi) {
        fill(lead, need, k + 1, (acc << 6) | (o.b & 0x3f), o.ni, o.nj, cost + o.cost, wild, ins, out);
      } else if (nbsp && o.b === 0x20 && ins === 0 && lo <= 0xa0 && 0xa0 <= hi) {
        fill(lead, need, k + 1, (acc << 6) | 0x20, o.ni, o.nj, cost + o.cost + NBSP_COST, wild, ins + 1, out);
      }
    }
    if (insert && ins === 0 && wild === 0) {
      for (const [v, c] of insert)
        if (v >= lo && v <= hi) fill(lead, need, k + 1, (acc << 6) | (v & 0x3f), ni, nj, cost + c, wild, ins + 1, out);
    }
  };

  // An unknown byte used as the lead of a character whose continuation bytes are known.
  const guessLead = (o: Opt, out: Cand[]) => {
    const walk = (ni: number, nj: number, conts: number[], cost: number) => {
      if (conts.length) {
        const need = conts.length;
        const [from, to] = need === 1 ? [0xc2, 0xdf] : need === 2 ? [0xe0, 0xef] : [0xf0, 0xf4];
        for (let lead = from; lead <= to; lead++) {
          const [lo, hi] = contRange(lead, 0);
          if (conts[0]! < lo || conts[0]! > hi) continue;
          let cp = leadBits(lead);
          for (const c of conts) cp = (cp << 6) | (c & 0x3f);
          out.push({ cp, dest: ni * 16 + nj, cost: cost + GUESS_COST, guessed: true });
        }
      }
      if (conts.length === 3) return;
      for (const p of takeAll(ni, nj)) {
        if (p.b >= 0x80 && p.b <= 0xbf) walk(p.ni, p.nj, [...conts, p.b], cost + p.cost);
      }
    };
    walk(o.ni, o.nj, [], o.cost);
  };

  const emit = (from: number, cands: Cand[]) => {
    const byDest = new Map<number, Cand[]>();
    for (const c of cands) {
      const list = byDest.get(c.dest);
      if (list) list.push(c);
      else byDest.set(c.dest, [c]);
    }
    for (const [dest, all] of byDest) {
      // Guesses that land on rare symbols or unrelated scripts are not worth showing.
      const implausible = (c: Cand) =>
        c.guessed && c.cp >= 0 && (weight(c.cp) <= GUESS_FLOOR || classify(c.cp)[1] === Script.Other);
      const list = all.filter((c) => !implausible(c));
      if (!list.length) {
        relax(from, dest, LOST_WEIGHT, all[0]!.cost + DROP_COST, { text: '�', kind: 'lost' });
        continue;
      }
      const val = (c: Cand) => (c.cp < 0 ? LOST_WEIGHT : weight(c.cp)) + c.cost;
      list.sort((a, b) => val(b) - val(a));
      const best = list[0]!;
      if (best.cp < 0) {
        relax(from, dest, LOST_WEIGHT, best.cost, { text: '\ufffd', kind: 'lost' });
        continue;
      }
      const text = String.fromCodePoint(best.cp);
      if (!best.guessed) {
        relax(from, dest, weight(best.cp), best.cost, { text, kind: 'ok' });
        continue;
      }
      const alternatives: string[] = [];
      for (const c of list.slice(1)) {
        if (alternatives.length >= 4) break;
        if (c.cp < 0) continue;
        const s = String.fromCodePoint(c.cp);
        if (s !== text && !alternatives.includes(s)) alternatives.push(s);
      }
      relax(from, dest, weight(best.cp), best.cost, { text, kind: 'guessed', alternatives });
    }
  };

  score[0] = 0;
  for (let key = 0; key < size; key++) {
    if (score[key] === -Infinity) continue;
    const i = key >> 4;
    const j = key & 15;
    if (i >= n) continue;
    const t = toks[i]!;
    if (typeof t !== 'number') {
      if (t.t === 'pass') {
        relax(key, (i + 1) * 16, weight(t.cp), 0, { text: String.fromCodePoint(t.cp), kind: 'ok' });
        continue;
      }
      if (t.t === 'hole' && j >= t.min) relax(key, (i + 1) * 16, 0, 0, null);
      if (t.t === 'choice' && j >= 13 && j - 12 >= t.hole!.min) relax(key, (i + 1) * 16, 0, 0, null);
    }
    for (const o of takeAll(i, j)) {
      const dest = o.ni * 16 + o.nj;
      if (o.b === -1) {
        const cands: Cand[] = [];
        lostTail(o.ni, o.nj, o.cost, 3, cands);
        guessLead(o, cands);
        emit(key, cands);
        continue;
      }
      if (o.b < 0x80) {
        relax(key, dest, weight(o.b), o.cost, { text: String.fromCharCode(o.b), kind: 'ok' });
        continue;
      }
      relax(key, dest, LOST_WEIGHT, o.cost + ERROR_COST, { text: '\ufffd', kind: 'error' });
      const need = leadNeed(o.b);
      if (!need) continue;
      const cands: Cand[] = [];
      fill(o.b, need, 0, leadBits(o.b), o.ni, o.nj, o.cost, 0, 0, cands);
      emit(key, cands);
    }
  }

  const end = n * 16;
  const segments: Segment[] = [];
  let guessed = 0;
  let lost = 0;
  let errors = 0;
  // Collapsed characters still count toward the score, so collapsing cannot make a candidate look better.
  let collapsed = 0;
  for (let k = end; k > 0; k = prev[k]!) {
    const s = seg[k];
    if (!s) continue;
    if (s.kind === 'guessed') guessed++;
    else if (s.kind === 'lost') lost++;
    else if (s.kind === 'error') errors++;
    const first = segments[0];
    // Collapse runs of lost/error characters into one, and merge plain text.
    if (first && first.kind === s.kind && (s.kind === 'ok' || s.kind === 'lost' || s.kind === 'error')) {
      if (s.kind === 'ok') first.text = s.text + first.text;
      else {
        if (s.kind === 'lost') lost--;
        else errors--;
        collapsed++;
      }
    } else segments.unshift({ ...s });
  }
  return {
    text: segments.map((s) => s.text).join(''),
    segments,
    cost: costs[end]! + collapsed * LOST_WEIGHT,
    guessed,
    lost,
    errors,
  };
}
