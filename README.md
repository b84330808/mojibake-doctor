# Mojibake Doctor · 亂碼醫生 · 文字化けドクター

[![CI](https://github.com/b84330808/mojibake-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/b84330808/mojibake-doctor/actions/workflows/ci.yml)

Paste garbled CJK text, get the original back, and see in plain words what went wrong.

**Try it: https://b84330808.github.io/mojibake-doctor/** (Traditional Chinese, Japanese and English UI)

Everything runs in your browser. The page has a Content Security Policy with `connect-src 'none'`, so it cannot send your text anywhere.

| You paste | You get | What happened |
| --- | --- | --- |
| `縺薙ｓ縺ｫ縺｡縺ｯ` | こんにちは | UTF-8 read as Shift_JIS (cp932) |
| `譚ｱ莠ｬ` | 東京 | UTF-8 read as Shift_JIS (cp932) |
| `cafﾃｩ` | café | UTF-8 read as Shift_JIS (cp932) |
| `æ—¥æœ¬èªž` | 日本語 | UTF-8 read as cp1252 |
| `ç¹é«”ä¸­æ–‡` | 繁體中文 | UTF-8 read as cp1252, with a dropped byte filled back in |
| `浣犲ソ` | 你好 | UTF-8 read as GBK |
| `‚±‚ñ‚É‚¿‚Í` | こんにちは | Shift_JIS read as cp1252 |
| `¤¤¤å` | 中文 | Big5 read as cp1252 |
| `ﾁcﾅ鬢､､蟐ｺﾀﾉｮﾗｦWｺﾙ` | 繁體中文的檔案名稱 | Big5 read as Shift_JIS (the classic ZIP file name case) |
| `擔杮岅偺僥僉僗僩` | 日本語のテキスト | Shift_JIS read as GBK |
| `ÇÑ±Û` | 한글 | EUC-KR read as cp1252 |
| `$B$3$s$K$A$O(B` | こんにちは | ISO-2022-JP mail with its ESC characters stripped |
| `Ã¦â€”Â¥Ã¦Å“Â¬` | 日本 | UTF-8 read as cp1252, twice |
| `譁・ｭ怜喧縺・` | ?字化? (guesses underlined, 文 among the candidates) | UTF-8 read by Windows cp932, which put `・` where it gave up |
| `锟斤拷` | (already broken) | U+FFFD bytes read as GBK: the data was lost before this |

Each result comes with the steps that produced it, the bytes involved, where this mistake usually comes from (Excel and BOM-less CSV, Python `open()` without `encoding=`, HTTP without `charset`, MySQL `latin1`, ZIP file names across Windows locales, ...) and a short "how to avoid it" list.

## Supported encodings

UTF-8, Shift_JIS (cp932), EUC-JP, ISO-2022-JP, Big5 (cp950/HKSCS), GBK/GB18030, EUC-KR (cp949), Latin-1/cp1252.

The doctor tries every "saved as X, read as Y" pair between them, and chains of up to three misreadings (double mojibake such as UTF-8 → cp932 → UTF-8 → cp1252).

## How it works

1. **Exact codecs.** The decoders follow the [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) (what browsers use), with tables generated from its index files. The encoders are the inverse of those decoders, so garbled text maps back to exactly the bytes a decoder saw, including Windows quirks (cp932 PUA bytes, `・` and `?` placeholders, C1 controls from Latin-1).
2. **Search.** For each candidate misreading, re-encode the text with the wrong encoding and decode it with the right one. A beam search goes up to three steps deep.
3. **Scoring.** A small character model scores each candidate as a rough log-probability: kanji/hanzi frequencies from Unicode's Unihan data (`kHanyuPinlu`, Jōyō, TGH, HK grade lists), kana and Hangul classes, Latin-1 symbols, and penalties for odd script mixes (accented Latin next to kanji, kana next to Hangul, simplified-only hanzi in Japanese text). Fewer, more common characters explaining the same bytes win.
4. **Lost bytes.** When bytes were dropped or replaced (`�`, `?`, `・`, copy-paste eating invisible characters), a dynamic program fills the gaps with the most plausible characters, marks them as guesses, and lists alternatives; what cannot be recovered is shown as `�`.

## Results

From the test suite (`npm test`) and `npm run stats`, on generated Japanese, Chinese and Korean text (60 texts per pair):

- When the wrong decoding kept every byte: **955 / 970 restored exactly (98.5%)**. The misses are EUC-JP read as GBK, where both readings are real-looking text (kana bytes are identical in both).
- When bytes were lost, the share of characters that come back: UTF-8 read as Shift_JIS 71%, as EUC-KR 60%, as GBK 94%; Big5 read as Shift_JIS 79%; Shift_JIS read as EUC-KR 90%. Anything decoded as UTF-8 by mistake is mostly unrecoverable (0-5%), and the doctor says so.
- Clean text is left alone: no false positives on 960 generated Japanese, Chinese and Korean texts, nor on the hand-picked clean samples in the tests (Russian, emoji, halfwidth katakana, `髙橋さん`, ...).

The decoders were cross-checked against Chromium's `TextDecoder` on all two-byte sequences plus 20,000 random ones per encoding: identical for UTF-8, Shift_JIS, GBK/GB18030, EUC-KR and cp1252. The only differences are in EUC-JP/ISO-2022-JP error recovery and Big5 `88 62`-style sequences, where Chromium deviates from the standard.

## Use it as a library

Not on npm yet. Install from GitHub:

```sh
npm install github:b84330808/mojibake-doctor
```

```ts
import { diagnose, explain, fix, garble } from 'mojibake-doctor';

fix('縺薙ｓ縺ｫ縺｡縺ｯ'); // 'こんにちは'

const d = diagnose('æ—¥æœ¬èªž');
d.best?.text; // '日本語'
d.best?.chain; // [{ from: 'utf-8', readAs: 'windows-1252' }]
explain(d, 'zh-TW').summary; // '這是 UTF-8 的文字被當成 Latin-1 / cp1252 讀取所造成的亂碼。'

garble('文字化け', [{ from: 'utf-8', readAs: 'shift_jis' }]); // make mojibake on purpose
```

`diagnose()` also returns ranked `candidates`, a `confidence` (`high`/`medium`/`low`/`none`), per-character `segments` (`ok`, `guessed` with alternatives, `lost`) and known garbage `patterns` (`锟斤拷`, `烫烫烫`, `ﾌﾌﾌﾌ`, `???`). `trace(input, chain)` gives the bytes at each step. Works in Node 20+ and browsers; no dependencies.

## Limits

- Short or random strings can be genuinely ambiguous: `中文` is fine, but a 2-3 character string may read plausibly in two encodings. The page shows the other candidates.
- Guesses for lost bytes are based on single-character frequency, not context, so `譁・ｭ怜喧縺・` gives `方字化の` with 文 and け among the alternatives. A small bigram model would help.
- Text that mixes garbled and clean parts is fixed as a whole; segment-by-segment repair is not done yet.
- Only the encodings above. No UTF-16, Windows-1251, KOI8 or Thai code pages.

## Development

```sh
npm install
npm test            # vitest: sample table, codec tests, property tests (fast-check)
npm run dev         # site at http://localhost:8317 with live rebuild
npm run build       # library -> dist/
npm run build:web   # site -> site/
npm run stats       # recovery tables above
```

`src/data/*.ts` are generated by `scripts/gen-data.mjs` from the WHATWG `indexes.json` and the Unihan database (instructions in the script header).

## 中文說明

貼上亂碼，就能找回原文，並用白話說明「哪個編碼被當成哪個編碼讀了」，以及下次怎麼避免。支援 UTF-8、Shift_JIS、EUC-JP、ISO-2022-JP、Big5、GBK/GB18030、EUC-KR、Latin-1/cp1252 之間的誤讀，最多三層疊加的亂碼。位元組遺失的部分會用推測補上並標示出來，救不回來的地方會老實顯示 �。全部在瀏覽器裡執行，文字不會送出。

## 日本語の説明

文字化けしたテキストを貼り付けると、元の文章を復元し、「どの文字コードがどの文字コードとして読まれたのか」と再発を防ぐ方法をわかりやすく説明します。UTF-8・Shift_JIS・EUC-JP・ISO-2022-JP・Big5・GBK/GB18030・EUC-KR・Latin-1/cp1252 の取り違え（最大 3 重）に対応し、失われたバイトは推測で補って印を付けます。処理はすべてブラウザ内で行われ、テキストは送信されません。

## License

MIT © 2026 Wei-Lun Li. Encoding tables come from the WHATWG Encoding Standard (BSD 3-Clause) and frequency data from the Unicode Unihan database (Unicode License v3); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
