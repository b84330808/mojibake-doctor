import { encode } from './encodings/encode.js';
import { decode } from './encodings/decode.js';
import { ENCODINGS, type EncodingId } from './encodings/types.js';
import { decodeTokens, encodeForRepair, type Segment } from './repair.js';
import { scoreText } from './score.js';

/** One misreading: bytes in `from` were decoded as `readAs`. */
export interface Step {
  from: EncodingId;
  readAs: EncodingId;
  /** ISO-2022-JP text whose ESC characters were stripped (shows up as "$B...(B"). */
  escapesLost?: boolean;
}

export interface Candidate {
  text: string;
  /** What went wrong, in the order it happened. */
  chain: Step[];
  score: number;
  segments: Segment[];
  /** Characters filled in by guessing lost bytes. */
  guessed: number;
  /** Characters that could not be recovered. */
  lost: number;
}

export type PatternId = 'kunkinkao' | 'tangtang' | 'tuntun' | 'fufufu' | 'hehehe' | 'question-marks' | 'replacement-chars';

export interface Diagnosis {
  input: string;
  inputScore: number;
  isMojibake: boolean;
  confidence: 'high' | 'medium' | 'low' | 'none';
  /** The most likely original text, when the input looks garbled. */
  best: Candidate | null;
  /** Ranked alternatives, best first (may include `best`). */
  candidates: Candidate[];
  /** Well-known garbage patterns found in the input. */
  patterns: PatternId[];
}

export interface DiagnoseOptions {
  /** Longest chain of misreadings to consider (1-3). Default 3. */
  maxDepth?: number;
  /** Candidates kept per depth. Default 6. */
  beam?: number;
  /** Candidates returned. Default 5. */
  maxCandidates?: number;
  /** Long inputs are diagnosed on their first `sampleLength` characters, then fixed whole. Default 3000. */
  sampleLength?: number;
}

/** Encodings that garbled text may have been wrongly decoded as. */
const WRONG: readonly EncodingId[] = ['utf-8', 'shift_jis', 'euc-jp', 'big5', 'gb18030', 'euc-kr', 'windows-1252'];
const ASIAN = new Set<EncodingId>(['shift_jis', 'euc-jp', 'big5', 'gb18030', 'euc-kr']);
// In log2 units, like the text score.
const PASS_COST = -8;
const MARGIN = 3;
// A fix that introduces unreadable characters into clean-looking text needs much more evidence.
const NEW_DAMAGE_MARGIN = 8;
// Byte patterns of uninitialized memory, not encoding mistakes.
const MEMORY_PATTERNS = /烫|屯|ﾌ|ﾍ/g;
// Being garbled twice is much rarer than once.
const EXTRA_STEP = -4;

/** Prior log2-probability of one misreading; common mistakes are cheaper. */
function stepPrior(from: EncodingId, readAs: EncodingId): number {
  if (from === 'utf-8' || readAs === 'windows-1252') return -3;
  if (readAs === 'utf-8' || from === 'iso-2022-jp') return -4;
  if (ASIAN.has(from) && ASIAN.has(readAs)) return -4;
  return -5;
}

interface Node {
  text: string;
  /** Fix steps in the order applied: the first undoes the last misreading. */
  fix: Step[];
  cost: number;
  score: number;
  segments: Segment[];
  guessed: number;
  lost: number;
}

interface Applied {
  text: string;
  cost: number;
  segments: Segment[];
  guessed: number;
  lost: number;
}

/** Undo one misreading. Returns null when the text cannot have come from it. */
function undo(text: string, step: Step, maxPass = Infinity): Applied | null {
  if (step.escapesLost) {
    const restored = text.replace(/\$[@B]|\([BJI]/g, (m) => '\x1b' + m);
    if (/[^\x00-\x7f]/.test(restored)) return null;
    const out = decode(encode(restored, 'windows-1252').bytes, 'iso-2022-jp');
    return { text: out, cost: 0, segments: [{ text: out, kind: 'ok' }], guessed: 0, lost: 0 };
  }
  const enc = encodeForRepair(text, step.readAs, maxPass);
  if (!enc) return null;
  const r = decodeTokens(enc.toks, step.from, { wrong: step.readAs });
  return { text: r.text, cost: r.cost + enc.pass * PASS_COST, segments: r.segments, guessed: r.guessed, lost: r.lost };
}

function expand(node: Node, out: Node[]): void {
  const len = [...node.text].length;
  const maxPass = Math.max(2, Math.floor(len * 0.15));
  const last = node.fix[node.fix.length - 1];
  for (const wrong of WRONG) {
    const enc = encodeForRepair(node.text, wrong, maxPass);
    if (!enc) continue;
    for (const from of ENCODINGS) {
      if (from === wrong) continue;
      if (from === 'iso-2022-jp' ? !enc.esc : !enc.high) continue;
      if (last && !last.escapesLost && last.from === wrong && last.readAs === from) continue;
      const r = decodeTokens(enc.toks, from, { wrong });
      if (r.text === node.text || r.text.length === 0) continue;
      const cost = node.cost + r.cost + enc.pass * PASS_COST + stepPrior(from, wrong) + (node.fix.length ? EXTRA_STEP : 0);
      out.push({
        text: r.text,
        fix: [...node.fix, { from, readAs: wrong }],
        cost,
        score: scoreText(r.text) + cost,
        segments: r.segments,
        guessed: node.guessed + r.guessed,
        lost: node.lost + r.lost,
      });
    }
  }
  if (!node.text.includes('\x1b') && /\$[@B]/.test(node.text) && /\([BJ]/.test(node.text)) {
    const step: Step = { from: 'iso-2022-jp', readAs: 'windows-1252', escapesLost: true };
    const r = undo(node.text, step);
    if (r && r.text !== node.text) {
      const cost = node.cost + stepPrior('iso-2022-jp', 'windows-1252') + (node.fix.length ? EXTRA_STEP : 0);
      out.push({ ...r, fix: [...node.fix, step], cost, score: scoreText(r.text) + cost, guessed: node.guessed, lost: node.lost });
    }
  }
}

const toCandidate = (n: Node): Candidate => ({
  text: n.text,
  chain: [...n.fix].reverse(),
  score: Math.round(n.score * 100) / 100,
  segments: n.segments,
  guessed: n.guessed,
  lost: n.lost,
});

/** Share of positions where two strings have the same character. */
function similarity(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const n = Math.max(x.length, y.length);
  if (n === 0) return 1;
  let same = 0;
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] === y[i]) same++;
  return same / n;
}

export function findPatterns(text: string): PatternId[] {
  const out: PatternId[] = [];
  if (/锟斤拷/.test(text)) out.push('kunkinkao');
  if (/烫烫/.test(text)) out.push('tangtang');
  if (/屯屯/.test(text)) out.push('tuntun');
  if (/ﾌﾌﾌ/.test(text)) out.push('fufufu');
  if (/ﾍﾍﾍ/.test(text)) out.push('hehehe');
  if (/\?{3,}/.test(text) && !/[^\x00-\x7f]/.test(text.replace(/\?/g, ''))) out.push('question-marks');
  if (text.includes('\ufffd')) out.push('replacement-chars');
  return out;
}

/** Diagnose possibly garbled text: find the most likely original and what went wrong. */
export function diagnose(input: string, options: DiagnoseOptions = {}): Diagnosis {
  const maxDepth = Math.min(3, Math.max(1, options.maxDepth ?? 3));
  const beam = options.beam ?? 6;
  const maxCandidates = options.maxCandidates ?? 5;
  const sampleLength = options.sampleLength ?? 3000;

  const chars = [...input];
  const sample = chars.length > sampleLength ? chars.slice(0, sampleLength).join('') : input;
  const root: Node = {
    text: sample,
    fix: [],
    cost: 0,
    score: scoreText(sample),
    segments: [{ text: sample, kind: 'ok' }],
    guessed: 0,
    lost: 0,
  };

  const best = new Map<string, Node>([[sample, root]]);
  let frontier = [root];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: Node[] = [];
    for (const node of frontier) expand(node, next);
    const fresh: Node[] = [];
    for (const n of next) {
      const seen = best.get(n.text);
      if (seen && seen.score >= n.score) continue;
      best.set(n.text, n);
      fresh.push(n);
    }
    fresh.sort((a, b) => b.score - a.score);
    frontier = fresh.slice(0, beam);
  }

  const ranked = [...best.values()].filter((n) => n !== root).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const newDamage = !!top && top.text.includes('\ufffd') && !sample.includes('\ufffd');
  const memory = (sample.match(MEMORY_PATTERNS)?.length ?? 0) * 2 >= [...sample].length;
  const isMojibake = !!top && !memory && top.score > root.score + MARGIN + (newDamage ? NEW_DAMAGE_MARGIN : 0);

  let winner: Node | null = isMojibake ? top! : null;
  if (winner && sample !== input) {
    // Apply the chain found on the sample to the whole input.
    let cur: Applied | null = { text: input, cost: 0, segments: [], guessed: 0, lost: 0 };
    const acc = { cost: 0, guessed: 0, lost: 0 };
    for (const step of winner.fix) {
      cur = undo(cur.text, step);
      if (!cur) break;
      acc.cost += cur.cost;
      acc.guessed += cur.guessed;
      acc.lost += cur.lost;
    }
    if (cur) winner = { ...winner, text: cur.text, segments: cur.segments, guessed: acc.guessed, lost: acc.lost };
  }

  let confidence: Diagnosis['confidence'] = 'none';
  if (winner && top) {
    const gain = top.score - root.score;
    const rival = ranked.slice(1).find((n) => similarity(n.text, top.text) < 0.8);
    const gap = rival ? top.score - rival.score : Infinity;
    if (gain >= 15 && gap >= 6 && top.lost === 0 && top.guessed === 0) confidence = 'high';
    else if (gain >= 8 && gap >= 3) confidence = 'medium';
    else confidence = 'low';
  }

  const candidates = ranked.slice(0, maxCandidates).map(toCandidate);
  if (winner && candidates[0]) candidates[0] = toCandidate(winner);
  return {
    input,
    inputScore: Math.round(root.score * 100) / 100,
    isMojibake,
    confidence,
    best: winner ? toCandidate(winner) : null,
    candidates,
    patterns: findPatterns(input),
  };
}

/** Shortcut: the most likely original text, or the input unchanged. */
export function fix(input: string, options?: DiagnoseOptions): string {
  const d = diagnose(input, options);
  return d.best ? d.best.text : input;
}

/** Garble text on purpose: encode as `from`, decode as `readAs`, for each step. */
export function garble(text: string, chain: ReadonlyArray<Pick<Step, 'from' | 'readAs'>>): string {
  let cur = text;
  for (const s of chain) cur = decode(encode(cur, s.from).bytes, s.readAs);
  return cur;
}

/** Re-apply a known chain of misreadings in reverse to restore text. */
export function restore(text: string, chain: readonly Step[]): Candidate | null {
  let cur: Applied | null = { text, cost: 0, segments: [{ text, kind: 'ok' }], guessed: 0, lost: 0 };
  let guessed = 0;
  let lost = 0;
  let cost = 0;
  for (const step of [...chain].reverse()) {
    cur = undo(cur.text, step);
    if (!cur) return null;
    guessed += cur.guessed;
    lost += cur.lost;
    cost += cur.cost;
  }
  return { text: cur.text, chain: [...chain], score: scoreText(cur.text) + cost, segments: cur.segments, guessed, lost };
}

/** One misreading with the bytes involved, for showing how the garbage came about. */
export interface Stage {
  step: Step;
  /** Text before this misreading. */
  before: string;
  /** The bytes the wrong decoder saw (-1 = unknown byte). */
  bytes: number[];
  /** Text after it. */
  after: string;
}

/** Walk a chain back from the garbled input and collect every stage, oldest first. */
export function trace(input: string, chain: readonly Step[]): Stage[] {
  const out: Stage[] = [];
  let cur = input;
  for (const step of [...chain].reverse()) {
    let bytes: number[] = [];
    if (step.escapesLost) {
      bytes = Array.from(encode(cur.replace(/\$[@B]|\([BJI]/g, (m) => '\x1b' + m), 'windows-1252').bytes);
    } else {
      const enc = encodeForRepair(cur, step.readAs);
      for (const t of enc?.toks ?? []) {
        if (typeof t === 'number') bytes.push(t);
        // A placeholder such as cp932's '・' most likely stands for lost bytes.
        else if (t.t === 'choice') bytes.push(...(t.hole && t.hole.cost >= t.litCost ? [-1] : t.alts[0]!));
        else if (t.t === 'hole') bytes.push(-1);
      }
    }
    const before = undo(cur, step)?.text ?? '';
    out.unshift({ step, before, bytes, after: cur });
    cur = before;
  }
  return out;
}
