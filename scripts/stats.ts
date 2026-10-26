// Prints the recovery table in the README: for every (original, wrong) pair,
// how many lossless garblings of 60 generated texts the doctor restores exactly.
//   npm run stats

import fc from 'fast-check';
import { decode, diagnose, encode, type EncodingId } from '../src/index.js';
import { garbleLossless, LANGS_FOR, textArb, WRONG, type Lang } from '../test/gen.js';

const RUNS = 60;
let tried = 0;
let ok = 0;
console.log('| Original | Read as | Restored exactly | Lossy (skipped) |');
console.log('| --- | --- | --- | --- |');
for (const [from, langs] of Object.entries(LANGS_FOR) as Array<[EncodingId, Lang[]]>) {
  for (const readAs of WRONG) {
    if (readAs === from) continue;
    const samples = fc.sample(
      fc.constantFrom(...langs).chain((lang) => textArb(lang, from)),
      { seed: 42, numRuns: RUNS },
    );
    let t = 0;
    let k = 0;
    for (const s of samples) {
      const g = garbleLossless(s, from, readAs);
      if (g === null) continue;
      t++;
      if (diagnose(g).best?.text === s) k++;
    }
    tried += t;
    ok += k;
    console.log(`| ${from} | ${readAs} | ${t ? `${k}/${t}` : '—'} | ${RUNS - t} |`);
  }
}
console.log(`\nTotal: ${ok}/${tried} (${((100 * ok) / tried).toFixed(1)}%)`);

// Lossy garbling: share of original characters that come back (LCS / length).
const recovered = (a: string, b: string) => {
  const x = [...a];
  const y = [...b];
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++)
      dp[i]![j] = x[i - 1] === y[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
  return dp[x.length]![y.length]! / x.length;
};
console.log('\n| Original | Read as | Characters recovered when bytes were lost |');
console.log('| --- | --- | --- |');
for (const [from, langs] of Object.entries(LANGS_FOR) as Array<[EncodingId, Lang[]]>) {
  for (const readAs of WRONG) {
    if (readAs === from) continue;
    const samples = fc.sample(
      fc.constantFrom(...langs).chain((lang) => textArb(lang, from)),
      { seed: 42, numRuns: RUNS },
    );
    let n = 0;
    let sum = 0;
    for (const s of samples) {
      if (garbleLossless(s, from, readAs) !== null) continue;
      const g = decode(encode(s, from).bytes, readAs);
      sum += recovered(s, diagnose(g).best?.text ?? '');
      n++;
    }
    if (n >= 10) console.log(`| ${from} | ${readAs} | ${Math.round((100 * sum) / n)}% (${n} texts) |`);
  }
}
