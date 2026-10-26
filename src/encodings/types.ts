export type EncodingId =
  | 'utf-8'
  | 'shift_jis'
  | 'euc-jp'
  | 'iso-2022-jp'
  | 'big5'
  | 'gb18030'
  | 'euc-kr'
  | 'windows-1252';

export const ENCODINGS: readonly EncodingId[] = [
  'utf-8',
  'shift_jis',
  'euc-jp',
  'iso-2022-jp',
  'big5',
  'gb18030',
  'euc-kr',
  'windows-1252',
];

/** Display names. Windows code page names in parentheses are what most people see in their tools. */
export const ENCODING_LABELS: Record<EncodingId, string> = {
  'utf-8': 'UTF-8',
  shift_jis: 'Shift_JIS (cp932)',
  'euc-jp': 'EUC-JP',
  'iso-2022-jp': 'ISO-2022-JP (JIS)',
  big5: 'Big5 (cp950)',
  gb18030: 'GBK / GB18030 (cp936)',
  'euc-kr': 'EUC-KR (cp949)',
  'windows-1252': 'Latin-1 / cp1252',
};
