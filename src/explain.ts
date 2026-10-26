// Plain-language explanations of a diagnosis, in Traditional Chinese, Japanese and English.

import type { Diagnosis, PatternId, Step } from './doctor.js';
import { ENCODING_LABELS, type EncodingId } from './encodings/types.js';

export type Lang = 'zh-TW' | 'ja' | 'en';
export const LANGS: readonly Lang[] = ['zh-TW', 'ja', 'en'];

export interface Explanation {
  /** One-sentence verdict. */
  summary: string;
  /** What happened, one line per misreading, in order. */
  steps: string[];
  /** Where this kind of mistake usually comes from. */
  causes: string[];
  /** How to avoid it next time. */
  tips: string[];
  /** Caveats: guessed or lost characters, well-known garbage patterns. */
  notes: string[];
}

type Msg = Record<Lang, string>;
type Fill = Record<string, string | number>;

const fill = (s: string, v: Fill) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));

const SUMMARY = {
  none: {
    'zh-TW': '看起來不是亂碼，或是找不到比原文更合理的解讀。',
    ja: '文字化けではないか、元の文字列より自然な解釈が見つかりませんでした。',
    en: 'This does not look like mojibake, or no reading is more plausible than the text itself.',
  },
  one: {
    'zh-TW': '這是 {from} 的文字被當成 {readAs} 讀取所造成的亂碼。',
    ja: '{from} のテキストを {readAs} として読み込んだことによる文字化けです。',
    en: 'This is {from} text that was read as {readAs}.',
  },
  many: {
    'zh-TW': '這段文字被讀錯了 {n} 次，亂碼疊在亂碼上。',
    ja: '文字化けが {n} 回重なっています。',
    en: 'The text was garbled {n} times over.',
  },
  esc: {
    'zh-TW': '這是 ISO-2022-JP（JIS）編碼的文字，但控制字元 ESC 被刪掉了，只剩下「$B」「(B」這類記號。',
    ja: 'ISO-2022-JP（JIS コード）のテキストから制御文字 ESC が消え、「$B」「(B」などの記号だけが残ったものです。',
    en: 'This is ISO-2022-JP (JIS) text whose ESC control characters were stripped, leaving "$B" and "(B" behind.',
  },
  broken: {
    'zh-TW': '在被讀錯之前，這段文字就已經壞掉了：還原後只剩下 �（已遺失的字元）。',
    ja: '読み違える前の時点で、すでにテキストが壊れていました。復元しても �（失われた文字）しか残りません。',
    en: 'The text was already broken before it was misread: undoing the mistake only gives � (lost characters).',
  },
} satisfies Record<string, Msg>;

const STEP_FIRST: Msg = {
  'zh-TW': '以 {from} 編碼存成的位元組，被當成 {readAs} 解讀。',
  ja: '{from} でエンコードされたバイト列が、{readAs} として解釈されました。',
  en: 'Bytes encoded as {from} were decoded as {readAs}.',
};
const STEP_AGAIN: Msg = {
  'zh-TW': '上一步的亂碼又被存成 {from}，再被當成 {readAs} 解讀。',
  ja: 'その文字化けしたテキストが {from} で保存され、さらに {readAs} として解釈されました。',
  en: 'That garbled text was saved as {from} and decoded as {readAs} again.',
};
const STEP_ESC: Msg = {
  'zh-TW': 'ISO-2022-JP 的切換序列（ESC $ B、ESC ( B）裡的 ESC 字元被刪除。',
  ja: 'ISO-2022-JP の切り替えシーケンス（ESC $ B、ESC ( B）から ESC 文字が削除されました。',
  en: 'The ESC characters of the ISO-2022-JP switch sequences (ESC $ B, ESC ( B) were removed.',
};

const CAUSES = {
  'utf8-as-cp932': {
    'zh-TW':
      '常見於日文 Windows：Excel 直接開啟沒有 BOM 的 UTF-8 CSV、Python 的 open() 沒指定 encoding（預設是 cp932）、PowerShell 5.1 的 Get-Content、JDK 17 以前的預設編碼 MS932。',
    ja: '日本語版 Windows でよく起きます：BOM なし UTF-8 の CSV を Excel で直接開いた、Python の open() で encoding を指定しなかった（既定は cp932）、PowerShell 5.1 の Get-Content、JDK 17 以前の既定文字コード MS932 など。',
    en: 'Typical on Japanese Windows: Excel opening a UTF-8 CSV without BOM, Python open() without encoding= (defaults to cp932), PowerShell 5.1 Get-Content, Java before 18 (default MS932).',
  },
  'utf8-as-big5': {
    'zh-TW': '常見於繁體中文 Windows（cp950）：Excel 開 UTF-8 CSV、cmd 或 PowerShell 主控台（chcp 950）、Python 沒指定 encoding。',
    ja: '繁体字中国語版 Windows（cp950）でよく起きます：Excel で UTF-8 の CSV を開く、cmd や PowerShell のコンソール（chcp 950）、Python で encoding 未指定など。',
    en: 'Typical on Traditional Chinese Windows (cp950): Excel opening a UTF-8 CSV, the cmd/PowerShell console (chcp 950), Python without encoding=.',
  },
  'utf8-as-gbk': {
    'zh-TW': '常見於簡體中文 Windows（cp936/GBK）：Excel 開 UTF-8 CSV、主控台（chcp 936）、Python 或 Java 使用系統預設編碼。',
    ja: '簡体字中国語版 Windows（cp936/GBK）でよく起きます：Excel で UTF-8 の CSV を開く、コンソール（chcp 936）、Python や Java がシステム既定の文字コードを使うなど。',
    en: 'Typical on Simplified Chinese Windows (cp936/GBK): Excel opening a UTF-8 CSV, the console (chcp 936), Python or Java using the system default encoding.',
  },
  'utf8-as-euckr': {
    'zh-TW': '常見於韓文 Windows（cp949）：Excel 開 UTF-8 CSV、主控台、程式使用系統預設編碼。',
    ja: '韓国語版 Windows（cp949）でよく起きます：Excel で UTF-8 の CSV を開く、コンソール、プログラムがシステム既定の文字コードを使うなど。',
    en: 'Typical on Korean Windows (cp949): Excel opening a UTF-8 CSV, the console, programs using the system default encoding.',
  },
  'utf8-as-eucjp': {
    'zh-TW': '常見於舊的 Unix/Linux 日文環境、宣告為 EUC-JP 的舊網頁，或終端機、編輯器被設成 EUC-JP。',
    ja: '古い Unix/Linux の日本語環境、EUC-JP と宣言された古い Web ページ、EUC-JP に設定されたターミナルやエディタでよく起きます。',
    en: 'Typical of old Japanese Unix/Linux setups, old web pages declared as EUC-JP, or terminals and editors set to EUC-JP.',
  },
  'utf8-as-latin1': {
    'zh-TW': '常見於：網頁或 HTTP 回應沒有宣告 charset（瀏覽器退回 windows-1252）、MySQL 連線或欄位用 latin1、西歐語系 Windows 上的程式（Python 預設 cp1252）、郵件標頭的 charset 寫錯。',
    ja: 'よくある原因：Web ページや HTTP レスポンスで charset を宣言していない（ブラウザが windows-1252 にフォールバック）、MySQL の接続やカラムが latin1、欧米ロケールの Windows 上のプログラム（Python の既定は cp1252）、メールヘッダーの charset の誤りなど。',
    en: 'Common causes: a web page or HTTP response without a charset (browsers fall back to windows-1252), a MySQL connection or column in latin1, programs on Western-locale Windows (Python defaults to cp1252), a wrong charset in mail headers.',
  },
  'legacy-as-utf8': {
    'zh-TW': '新工具預設用 UTF-8（VS Code、pandas.read_csv、Git、瀏覽器）去讀舊編碼的檔案，無效的位元組被換成 � 後就消失了。',
    ja: 'UTF-8 を既定とする新しいツール（VS Code、pandas.read_csv、Git、ブラウザなど）で古い文字コードのファイルを読み、不正なバイトが � に置き換えられて失われました。',
    en: 'A modern tool that assumes UTF-8 (VS Code, pandas.read_csv, Git, a browser) read a legacy-encoded file; invalid bytes were replaced by � and are gone.',
  },
  'legacy-as-latin1': {
    'zh-TW': '舊編碼（Big5、Shift_JIS 等）的檔案被西歐語系的工具開啟，或網頁被當成 ISO-8859-1 傳送。',
    ja: '旧来の文字コード（Shift_JIS、Big5 など）のファイルを欧米向けのツールで開いた、または Web ページが ISO-8859-1 として配信されました。',
    en: 'A legacy-encoded file (Shift_JIS, Big5, ...) was opened by a Western tool, or a page was served as ISO-8859-1.',
  },
  'legacy-as-legacy': {
    'zh-TW': '兩台電腦的「非 Unicode 程式的語言」（系統地區設定）不同：例如日文 Windows 建立的 ZIP 檔名在台灣的 Windows 上解壓，或在日、台、中、韓之間交換的字幕與文字檔。',
    ja: '2 台の PC で「Unicode 対応ではないプログラムの言語」（システムロケール）が違う場合に起きます。例：日本語 Windows で作った ZIP のファイル名を台湾の Windows で展開した、日中台韓の間でやり取りした字幕やテキストファイルなど。',
    en: 'The two machines use different "language for non-Unicode programs" (system locale): for example ZIP file names created on Japanese Windows extracted on Taiwanese Windows, or subtitle and text files exchanged between Japan, Taiwan, China and Korea.',
  },
  'esc-lost': {
    'zh-TW': 'ISO-2022-JP 主要用在舊的日文電子郵件；轉存、複製貼上或某些系統會把看不見的 ESC 控制字元刪掉。',
    ja: 'ISO-2022-JP は主に古い日本語メールで使われます。転送やコピー＆ペースト、一部のシステムで見えない ESC 制御文字が削除されます。',
    en: 'ISO-2022-JP is mostly used in old Japanese email; forwarding, copy-paste or some systems drop the invisible ESC control characters.',
  },
  'iso2022-as-other': {
    'zh-TW': 'ISO-2022-JP（JIS）的郵件原文被當成別的編碼顯示。',
    ja: 'ISO-2022-JP（JIS コード）のメール本文が別の文字コードとして表示されました。',
    en: 'A raw ISO-2022-JP (JIS) message was displayed as another encoding.',
  },
} satisfies Record<string, Msg>;
type CauseId = keyof typeof CAUSES;

const TIPS = {
  'utf8-explicit': {
    'zh-TW':
      '讀寫檔案時明確指定 UTF-8：Python `open(path, encoding="utf-8")`、Java `Files.readString(path, StandardCharsets.UTF_8)`、Node.js `fs.readFileSync(path, "utf8")`。',
    ja: 'ファイルの読み書きで UTF-8 を明示する：Python `open(path, encoding="utf-8")`、Java `Files.readString(path, StandardCharsets.UTF_8)`、Node.js `fs.readFileSync(path, "utf8")`。',
    en: 'Name UTF-8 explicitly when reading and writing files: Python `open(path, encoding="utf-8")`, Java `Files.readString(path, StandardCharsets.UTF_8)`, Node.js `fs.readFileSync(path, "utf8")`.',
  },
  'python-utf8': {
    'zh-TW': 'Windows 上的 Python 可設定環境變數 `PYTHONUTF8=1`，讓預設編碼變成 UTF-8。',
    ja: 'Windows の Python では環境変数 `PYTHONUTF8=1` を設定すると既定の文字コードが UTF-8 になります。',
    en: 'For Python on Windows, set `PYTHONUTF8=1` so the default encoding becomes UTF-8.',
  },
  'excel-bom': {
    'zh-TW': '要給 Excel 開的 CSV 請存成「UTF-8 (含 BOM)」（Python 用 `encoding="utf-8-sig"`），或用「資料 → 從文字/CSV」匯入並選 65001 (UTF-8)。',
    ja: 'Excel で開く CSV は「UTF-8 (BOM 付き)」で保存する（Python なら `encoding="utf-8-sig"`）か、「データ → テキストまたは CSV から」で 65001 (UTF-8) を選んで取り込みます。',
    en: 'Save CSV files meant for Excel as "UTF-8 with BOM" (Python: `encoding="utf-8-sig"`), or import via Data → From Text/CSV and pick 65001 (UTF-8).',
  },
  'http-charset': {
    'zh-TW': '網頁回應加上 `Content-Type: text/html; charset=utf-8`，HTML 開頭寫 `<meta charset="utf-8">`。',
    ja: 'HTTP レスポンスに `Content-Type: text/html; charset=utf-8` を付け、HTML の先頭に `<meta charset="utf-8">` を書きます。',
    en: 'Send `Content-Type: text/html; charset=utf-8` and put `<meta charset="utf-8">` at the top of the HTML.',
  },
  db: {
    'zh-TW': '資料庫的連線與資料表都用 UTF-8（MySQL 請用 `utf8mb4`，不要用 latin1）。',
    ja: 'データベースの接続とテーブルを UTF-8 にする（MySQL は latin1 ではなく `utf8mb4`）。',
    en: 'Use UTF-8 for database connections and tables (MySQL: `utf8mb4`, not latin1).',
  },
  console: {
    'zh-TW': '終端機改用 UTF-8：Windows 執行 `chcp 65001`，或改用 Windows Terminal 加 PowerShell 7。',
    ja: 'ターミナルを UTF-8 にする：Windows なら `chcp 65001`、または Windows Terminal と PowerShell 7 を使います。',
    en: 'Switch the terminal to UTF-8: `chcp 65001` on Windows, or Windows Terminal with PowerShell 7.',
  },
  'read-legacy': {
    'zh-TW':
      '舊檔案要用原本的編碼讀取：Python `encoding="cp932"`（別用 "shift_jis"，① 或 髙 會出錯）、`"cp950"`、`"gbk"`、`"cp949"`，再轉存成 UTF-8（`iconv -f CP932 -t UTF-8`、`nkf -w`）。',
    ja: '古いファイルは元の文字コードで読む：Python なら `encoding="cp932"`（"shift_jis" だと ① や 髙 でエラー）、`"cp950"`、`"gbk"`、`"cp949"`。そのうえで UTF-8 に変換します（`iconv -f CP932 -t UTF-8`、`nkf -w`）。',
    en: 'Read old files with their real encoding: Python `encoding="cp932"` (not "shift_jis", which fails on ① or 髙), `"cp950"`, `"gbk"`, `"cp949"`, then convert to UTF-8 (`iconv -f CP932 -t UTF-8`, `nkf -w`).',
  },
  'from-source': {
    'zh-TW': '� 代表位元組已經丟失，從亂碼救不回來；請找出原始檔案，用正確的編碼重新讀取。',
    ja: '� はバイトがすでに失われていることを示し、文字化けした文字列からは復元できません。元のファイルを正しい文字コードで読み直してください。',
    en: '� means the bytes are gone and cannot be recovered from the garbled text; go back to the original file and read it with the right encoding.',
  },
  zip: {
    'zh-TW': 'ZIP 檔名亂碼：解壓時用 `unzip -O cp932` 或 7-Zip 指定字碼頁；建立 ZIP 時使用 UTF-8 檔名（7-Zip `-mcu=on`）。',
    ja: 'ZIP のファイル名の文字化け：展開時に `unzip -O cp932` や 7-Zip でコードページを指定し、作成時は UTF-8 ファイル名にします（7-Zip `-mcu=on`）。',
    en: 'Garbled ZIP file names: extract with `unzip -O cp932` or pick the code page in 7-Zip; create archives with UTF-8 names (7-Zip `-mcu=on`).',
  },
  email: {
    'zh-TW': '郵件請用 UTF-8（`Content-Type: text/plain; charset=UTF-8`）。',
    ja: 'メールは UTF-8（`Content-Type: text/plain; charset=UTF-8`）で送ります。',
    en: 'Send email as UTF-8 (`Content-Type: text/plain; charset=UTF-8`).',
  },
  ci: {
    'zh-TW': '在 CI 用非 UTF-8 的 locale 再跑一次測試（例如 `LANG=ja_JP.SJIS`，或 Windows runner 的系統字碼頁），提早抓出「忘了指定編碼」的 bug。',
    ja: 'CI で UTF-8 以外のロケールでもテストを実行し（例：`LANG=ja_JP.SJIS`、Windows ランナーのシステムコードページ）、「文字コード指定漏れ」のバグを早めに見つけます。',
    en: 'Run your tests once more in CI under a non-UTF-8 locale (e.g. `LANG=ja_JP.SJIS`, or a Windows runner\'s system code page) to catch missing encoding= bugs early.',
  },
} satisfies Record<string, Msg>;
type TipId = keyof typeof TIPS;

const NOTES = {
  guessed: {
    'zh-TW': '有 {n} 個字是從遺失的位元組推測出來的（畫底線），可能不正確，可以參考其他候選字。',
    ja: '{n} 文字は失われたバイトから推測したもので（下線付き）、正しくない可能性があります。候補も確認してください。',
    en: '{n} character(s) were guessed from lost bytes (underlined) and may be wrong; check the alternatives.',
  },
  lost: {
    'zh-TW': '有 {n} 處位元組已經遺失（顯示為 �），無法還原。',
    ja: '{n} か所でバイトが失われており（� で表示）、復元できません。',
    en: '{n} place(s) lost their bytes (shown as �) and cannot be restored.',
  },
  low: {
    'zh-TW': '可信度低：文字太短或有好幾種可能的解讀，請一併參考其他候選。',
    ja: '信頼度は低めです。文字列が短いか、複数の解釈が考えられます。ほかの候補も参照してください。',
    en: 'Low confidence: the text is short or several readings are possible; see the other candidates too.',
  },
  kunkinkao: {
    'zh-TW': '「锟斤拷」是替代字元 U+FFFD 的 UTF-8 位元組（EF BF BD）被當成 GBK 讀出來的結果：在這之前資料就已經壞了，原文救不回來。',
    ja: '「锟斤拷」は置換文字 U+FFFD の UTF-8 バイト列（EF BF BD）を GBK として読んだものです。その前の段階でデータはすでに壊れており、元の文字は復元できません。',
    en: '"锟斤拷" is the UTF-8 bytes of the replacement character U+FFFD (EF BF BD) read as GBK: the data was already broken before this, so the original is lost.',
  },
  tangtang: {
    'zh-TW': '「烫烫烫」是位元組 0xCC 用 GBK 讀出來的樣子。MSVC 除錯版會用 0xCC 填滿未初始化的堆疊記憶體：這是程式讀到未初始化的變數，不是編碼問題。',
    ja: '「烫烫烫」はバイト 0xCC を GBK で読んだものです。MSVC のデバッグビルドは未初期化のスタックを 0xCC で埋めます。文字コードではなく、未初期化の変数を読んでいるバグです。',
    en: '"烫烫烫" is byte 0xCC read as GBK. MSVC debug builds fill uninitialized stack memory with 0xCC: the program read an uninitialized variable; it is not an encoding problem.',
  },
  tuntun: {
    'zh-TW': '「屯屯屯」是位元組 0xCD 用 GBK 讀出來的樣子，0xCD 是 MSVC 除錯版未初始化的 heap 記憶體：程式讀到了沒初始化的資料。',
    ja: '「屯屯屯」はバイト 0xCD を GBK で読んだものです。0xCD は MSVC デバッグビルドの未初期化ヒープです。未初期化のデータを読んでいます。',
    en: '"屯屯屯" is byte 0xCD read as GBK, MSVC\'s marker for uninitialized heap memory: the program read data it never initialized.',
  },
  fufufu: {
    'zh-TW': '「ﾌﾌﾌﾌ」是位元組 0xCC 用 Shift_JIS 讀出來的樣子（MSVC 除錯版未初始化的堆疊記憶體），不是編碼問題。',
    ja: '「ﾌﾌﾌﾌ」はバイト 0xCC を Shift_JIS で読んだものです（MSVC デバッグビルドの未初期化スタック）。文字コードの問題ではありません。',
    en: '"ﾌﾌﾌﾌ" is byte 0xCC read as Shift_JIS (MSVC\'s uninitialized stack marker); it is not an encoding problem.',
  },
  hehehe: {
    'zh-TW': '「ﾍﾍﾍﾍ」是位元組 0xCD 用 Shift_JIS 讀出來的樣子（MSVC 除錯版未初始化的 heap 記憶體）。',
    ja: '「ﾍﾍﾍﾍ」はバイト 0xCD を Shift_JIS で読んだものです（MSVC デバッグビルドの未初期化ヒープ）。',
    en: '"ﾍﾍﾍﾍ" is byte 0xCD read as Shift_JIS (MSVC\'s uninitialized heap marker).',
  },
  'question-marks': {
    'zh-TW': '連續的「???」通常代表文字在存檔時被轉成不支援這些字的編碼（例如 MySQL 的 latin1 欄位、Windows 字碼頁），原字已經被換成問號，無法還原。',
    ja: '連続する「???」は、保存時にその文字を表せない文字コード（MySQL の latin1 カラム、Windows のコードページなど）に変換され、? に置き換わったことを示します。復元はできません。',
    en: 'Runs of "???" usually mean the text was saved in an encoding that cannot represent it (a MySQL latin1 column, a Windows code page); the characters became question marks and are gone.',
  },
  'replacement-chars': {
    'zh-TW': '輸入裡已經有 �（U+FFFD）：某個解碼器丟掉了它看不懂的位元組。',
    ja: '入力にすでに �（U+FFFD）が含まれています。どこかのデコーダーが解釈できないバイトを捨てています。',
    en: 'The input already contains � (U+FFFD): some decoder threw away bytes it could not read.',
  },
} satisfies Record<string, Msg>;

const ASIAN = new Set<EncodingId>(['shift_jis', 'euc-jp', 'big5', 'gb18030', 'euc-kr']);

function causeOf(step: Step): CauseId {
  if (step.escapesLost) return 'esc-lost';
  if (step.from === 'iso-2022-jp') return 'iso2022-as-other';
  if (step.from === 'utf-8') {
    switch (step.readAs) {
      case 'shift_jis':
        return 'utf8-as-cp932';
      case 'big5':
        return 'utf8-as-big5';
      case 'gb18030':
        return 'utf8-as-gbk';
      case 'euc-kr':
        return 'utf8-as-euckr';
      case 'euc-jp':
        return 'utf8-as-eucjp';
      default:
        return 'utf8-as-latin1';
    }
  }
  if (step.readAs === 'utf-8') return 'legacy-as-utf8';
  if (step.readAs === 'windows-1252') return 'legacy-as-latin1';
  return ASIAN.has(step.readAs) ? 'legacy-as-legacy' : 'legacy-as-latin1';
}

const TIPS_FOR: Record<CauseId, TipId[]> = {
  'utf8-as-cp932': ['utf8-explicit', 'excel-bom', 'python-utf8', 'ci'],
  'utf8-as-big5': ['utf8-explicit', 'excel-bom', 'console', 'ci'],
  'utf8-as-gbk': ['utf8-explicit', 'excel-bom', 'console', 'ci'],
  'utf8-as-euckr': ['utf8-explicit', 'excel-bom', 'console', 'ci'],
  'utf8-as-eucjp': ['utf8-explicit', 'http-charset', 'ci'],
  'utf8-as-latin1': ['http-charset', 'db', 'utf8-explicit', 'ci'],
  'legacy-as-utf8': ['from-source', 'read-legacy'],
  'legacy-as-latin1': ['read-legacy', 'http-charset'],
  'legacy-as-legacy': ['zip', 'read-legacy', 'ci'],
  'esc-lost': ['email'],
  'iso2022-as-other': ['email'],
};

const name = (e: EncodingId) => ENCODING_LABELS[e];

export function explain(d: Diagnosis, lang: Lang): Explanation {
  const out: Explanation = { summary: '', steps: [], causes: [], tips: [], notes: [] };
  const best = d.best;
  const patternNotes = (ids: PatternId[]) => {
    for (const p of ids) if (p !== 'replacement-chars' || !best) out.notes.push(NOTES[p][lang]);
  };
  if (!best) {
    out.summary = SUMMARY.none[lang];
    if (d.patterns.includes('replacement-chars')) out.tips.push(TIPS['from-source'][lang]);
    patternNotes(d.patterns);
    return out;
  }

  const chain = best.chain;
  const onlyLost = best.text.replace(/[�\s]/g, '') === '';
  if (onlyLost) out.summary = SUMMARY.broken[lang];
  else if (chain.length === 1 && chain[0]!.escapesLost) out.summary = SUMMARY.esc[lang];
  else if (chain.length === 1) out.summary = fill(SUMMARY.one[lang], { from: name(chain[0]!.from), readAs: name(chain[0]!.readAs) });
  else out.summary = fill(SUMMARY.many[lang], { n: chain.length });

  chain.forEach((s, i) => {
    const tpl = s.escapesLost ? STEP_ESC : i === 0 ? STEP_FIRST : STEP_AGAIN;
    out.steps.push(fill(tpl[lang], { from: name(s.from), readAs: name(s.readAs) }));
  });

  const causes = [...new Set(chain.map(causeOf))];
  out.causes = causes.map((c) => CAUSES[c][lang]);
  const tips = new Set<TipId>();
  for (const c of causes) for (const t of TIPS_FOR[c]) tips.add(t);
  if (best.lost > 0) tips.add('from-source');
  out.tips = [...tips].slice(0, 5).map((t) => TIPS[t][lang]);

  if (best.guessed > 0) out.notes.push(fill(NOTES.guessed[lang], { n: best.guessed }));
  if (best.lost > 0 && !onlyLost) out.notes.push(fill(NOTES.lost[lang], { n: best.lost }));
  if (d.confidence === 'low') out.notes.push(NOTES.low[lang]);
  patternNotes(d.patterns);
  return out;
}
