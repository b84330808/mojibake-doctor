import type { Lang } from '../src/index.js';

const UI = {
  title: { 'zh-TW': '亂碼醫生', ja: '文字化けドクター', en: 'Mojibake Doctor' },
  tagline: {
    'zh-TW': '貼上亂碼，找回原文，並用白話說明是哪裡出錯。',
    ja: '文字化けを貼り付けると、元の文章を復元し、何が起きたのかをわかりやすく説明します。',
    en: 'Paste garbled text to get the original back, with a plain explanation of what went wrong.',
  },
  privacy: {
    'zh-TW': '完全在你的瀏覽器裡處理，文字不會離開這個頁面。',
    ja: '処理はすべてブラウザ内で行われ、テキストがこのページの外に送られることはありません。',
    en: 'Runs entirely in your browser. Your text never leaves this page.',
  },
  tabFix: { 'zh-TW': '修復亂碼', ja: '文字化けを直す', en: 'Fix mojibake' },
  tabMake: { 'zh-TW': '製造亂碼', ja: '文字化けを作る', en: 'Make mojibake' },
  inputLabel: { 'zh-TW': '亂碼文字', ja: '文字化けしたテキスト', en: 'Garbled text' },
  placeholder: {
    'zh-TW': '在這裡貼上亂碼，例如：縺薙ｓ縺ｫ縺｡縺ｯ',
    ja: 'ここに文字化けしたテキストを貼り付けてください（例：縺薙ｓ縺ｫ縺｡縺ｯ）',
    en: 'Paste garbled text here, e.g. 縺薙ｓ縺ｫ縺｡縺ｯ',
  },
  examples: { 'zh-TW': '試試看', ja: '例', en: 'Try' },
  empty: {
    'zh-TW': '貼上文字後會自動診斷。',
    ja: 'テキストを貼り付けると自動で診断します。',
    en: 'Diagnosis starts as soon as you paste something.',
  },
  restored: { 'zh-TW': '還原結果', ja: '復元結果', en: 'Restored text' },
  copy: { 'zh-TW': '複製', ja: 'コピー', en: 'Copy' },
  copied: { 'zh-TW': '已複製', ja: 'コピーしました', en: 'Copied' },
  confidence: { 'zh-TW': '可信度', ja: '信頼度', en: 'Confidence' },
  high: { 'zh-TW': '高', ja: '高', en: 'high' },
  medium: { 'zh-TW': '中', ja: '中', en: 'medium' },
  low: { 'zh-TW': '低', ja: '低', en: 'low' },
  happened: { 'zh-TW': '發生了什麼事', ja: '何が起きたか', en: 'What happened' },
  causes: { 'zh-TW': '常見原因', ja: 'よくある原因', en: 'Where this usually comes from' },
  tips: { 'zh-TW': '怎麼避免', ja: '防ぐには', en: 'How to avoid it' },
  notes: { 'zh-TW': '注意', ja: '注意', en: 'Notes' },
  others: { 'zh-TW': '其他候選', ja: 'ほかの候補', en: 'Other candidates' },
  use: { 'zh-TW': '改用這個', ja: 'これを使う', en: 'Use this' },
  savedAs: { 'zh-TW': '存成 {enc}', ja: '{enc} で保存', en: 'saved as {enc}' },
  readAs: { 'zh-TW': '被當成 {enc} 讀取', ja: '{enc} として読み込み', en: 'read as {enc}' },
  escLost: { 'zh-TW': 'ESC 被刪除', ja: 'ESC が削除された', en: 'ESC removed' },
  bytes: { 'zh-TW': '位元組', ja: 'バイト列', en: 'bytes' },
  unknownByte: { 'zh-TW': '?? = 已遺失的位元組', ja: '?? = 失われたバイト', en: '?? = lost byte' },
  guessedTitle: {
    'zh-TW': '推測的字。其他可能：{alts}',
    ja: '推測した文字。ほかの候補：{alts}',
    en: 'Guessed. Other possibilities: {alts}',
  },
  alternatives: { 'zh-TW': '（推測，其他可能：{alts}）', ja: '（推測。ほかの候補：{alts}）', en: '(guessed; could also be {alts})' },
  lostTitle: { 'zh-TW': '這裡的位元組已遺失', ja: 'ここのバイトは失われています', en: 'The bytes here are lost' },
  sampled: {
    'zh-TW': '文字很長：先用前 {n} 個字判斷，再套用到全文。',
    ja: '長いテキストのため、先頭 {n} 文字で判定してから全文に適用しました。',
    en: 'Long text: diagnosed on the first {n} characters, then applied to all of it.',
  },
  makeIntro: {
    'zh-TW': '把正常的文字故意弄成亂碼，看看各種編碼錯誤會變成什麼樣子。',
    ja: '普通の文章をわざと文字化けさせて、文字コードの取り違えでどう化けるかを確かめられます。',
    en: 'Garble normal text on purpose to see what each encoding mix-up looks like.',
  },
  makeInput: { 'zh-TW': '原文', ja: '元の文章', en: 'Original text' },
  makeDefault: { 'zh-TW': '繁體中文的亂碼測試', ja: '文字化けのテストです', en: 'café 東京 한글' },
  makeFrom: { 'zh-TW': '存檔時的編碼', ja: '保存した文字コード', en: 'Saved as' },
  makeAs: { 'zh-TW': '讀取時誤用的編碼', ja: '読み込みに使った文字コード', en: 'Read as' },
  makeAdd: { 'zh-TW': '再錯一次', ja: 'もう一度化けさせる', en: 'Garble again' },
  makeRemove: { 'zh-TW': '移除', ja: '削除', en: 'Remove' },
  makeResult: { 'zh-TW': '結果', ja: '結果', en: 'Result' },
  makeSend: { 'zh-TW': '交給醫生診斷', ja: 'ドクターに診てもらう', en: 'Diagnose this' },
  footer: {
    'zh-TW':
      'MIT 授權 · 編碼表來自 WHATWG Encoding Standard（BSD 3-Clause）· 漢字頻率來自 Unicode Unihan（Unicode License v3）',
    ja: 'MIT ライセンス · 文字コード表は WHATWG Encoding Standard（BSD 3-Clause）· 漢字の頻度は Unicode Unihan（Unicode License v3）',
    en: 'MIT licensed · Encoding tables from the WHATWG Encoding Standard (BSD 3-Clause) · Han frequencies from Unicode Unihan (Unicode License v3)',
  },
} satisfies Record<string, Record<Lang, string>>;

export type UiKey = keyof typeof UI;

export function t(lang: Lang, key: UiKey, vars: Record<string, string | number> = {}): string {
  return UI[key][lang].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
