import { describe, expect, it } from 'vitest';
import { diagnose, explain, garble, LANGS } from '../src/index.js';

const chainOf = (input: string) =>
  diagnose(input).best?.chain.map((s) => (s.escapesLost ? `${s.from}(esc lost)` : `${s.from}>${s.readAs}`));

// Garbled text as people actually paste it, with the original and what went wrong.
const SAMPLES: Array<{ input: string; expected: string; chain: string[]; note?: string }> = [
  { input: '縺薙ｓ縺ｫ縺｡縺ｯ', expected: 'こんにちは', chain: ['utf-8>shift_jis'] },
  { input: '譚ｱ莠ｬ', expected: '東京', chain: ['utf-8>shift_jis'] },
  { input: 'cafﾃｩ', expected: 'café', chain: ['utf-8>shift_jis'] },
  { input: '繝輔ぃ繧､繝ｫ', expected: 'ファイル', chain: ['utf-8>shift_jis'] },
  { input: 'æ—¥æœ¬èªž', expected: '日本語', chain: ['utf-8>windows-1252'] },
  { input: 'ç¹\u0081é«”ä¸­æ–‡', expected: '繁體中文', chain: ['utf-8>windows-1252'], note: 'exact cp1252' },
  { input: 'ç¹é«”ä¸­æ–‡', expected: '繁體中文', chain: ['utf-8>windows-1252'], note: 'C1 byte lost in copy-paste' },
  { input: 'cafÃ©', expected: 'café', chain: ['utf-8>windows-1252'] },
  { input: 'â€œHelloâ€\u009d', expected: '“Hello”', chain: ['utf-8>windows-1252'] },
  { input: 'â€œHelloâ€', expected: '“Hello”', chain: ['utf-8>windows-1252'], note: '0x9D lost' },
  { input: 'í•œê¸€', expected: '한글', chain: ['utf-8>windows-1252'] },
  { input: '浣犲ソ', expected: '你好', chain: ['utf-8>gb18030'] },
  { input: '‚±‚ñ‚É‚¿‚Í', expected: 'こんにちは', chain: ['shift_jis>windows-1252'] },
  { input: '¤³¤ó¤Ë¤Á¤Ï', expected: 'こんにちは', chain: ['euc-jp>windows-1252'] },
  { input: '¤¤¤å', expected: '中文', chain: ['big5>windows-1252'] },
  { input: 'ÇÑ±Û', expected: '한글', chain: ['euc-kr>windows-1252'] },
  { input: 'ÇÑ±¹¾î ÅØ½ºÆ®ÀÔ´Ï´Ù', expected: '한국어 텍스트입니다', chain: ['euc-kr>windows-1252'] },
  { input: '$B$3$s$K$A$O(B', expected: 'こんにちは', chain: ['iso-2022-jp(esc lost)'] },
  { input: '\x1b$B$3$s$K$A$O\x1b(B', expected: 'こんにちは', chain: ['iso-2022-jp>windows-1252'] },
  { input: 'ﾁcﾅ鬢､､蟐ｺﾀﾉｮﾗｦWｺﾙ', expected: '繁體中文的檔案名稱', chain: ['big5>shift_jis'], note: 'Big5 read as cp932' },
  { input: '擔杮岅偺僥僉僗僩', expected: '日本語のテキスト', chain: ['shift_jis>gb18030'], note: 'cp932 read as GBK' },
  { input: '潠极笢恅腔恅璃', expected: '简体中文的文件', chain: ['gb18030>big5'] },
  { input: '羉砰いゅ郎', expected: '繁體中文的檔案', chain: ['big5>gb18030'], note: 'with PUA characters' },
  { input: 'Ã¦â€”Â¥Ã¦Å“Â¬', expected: '日本', chain: ['utf-8>windows-1252', 'utf-8>windows-1252'], note: 'double' },
  {
    input: 'ç¸ºè–™ï½“ç¸ºï½«ç¸ºï½¡ç¸ºï½¯',
    expected: 'こんにちは',
    chain: ['utf-8>shift_jis', 'utf-8>windows-1252'],
    note: 'cp932 garbage saved as UTF-8, then read as cp1252',
  },
];

describe('real garbled samples', () => {
  for (const s of SAMPLES) {
    it(`${s.input} -> ${s.expected}${s.note ? ` (${s.note})` : ''}`, () => {
      const d = diagnose(s.input);
      expect(d.isMojibake).toBe(true);
      expect(d.best?.text).toBe(s.expected);
      expect(chainOf(s.input)).toEqual(s.chain);
    });
  }
});

describe('partly lost bytes', () => {
  it('Windows cp932 "・" placeholders: 譁・ｭ怜喧縺・ (文字化け)', () => {
    const best = diagnose('譁・ｭ怜喧縺・').best!;
    expect([...best.text].slice(1, 3).join('')).toBe('字化');
    expect(best.guessed).toBeGreaterThanOrEqual(2);
    const first = best.segments[0]!;
    expect(first.kind).toBe('guessed');
    expect([first.text, ...(first.alternatives ?? [])]).toContain('文');
  });

  it('cp950 "?" placeholder: 銝剜?皜祈岫 (中文測試)', () => {
    const best = diagnose('銝剜?皜祈岫').best!;
    expect(best.text).toBe('中�測試');
    expect(best.lost).toBe(1);
  });

  it('WHATWG U+FFFD in UTF-8 read as Shift_JIS keeps the readable parts', () => {
    const g = garble('ファイルが見つかりません。パスを確認してください。', [{ from: 'utf-8', readAs: 'shift_jis' }]);
    expect(g).toContain('�');
    const best = diagnose(g).best!;
    expect(best.text.startsWith('ファイルが見つかりません。パスを確認してください')).toBe(true);
  });

  it('Shift_JIS read as UTF-8 cannot be restored and says so', () => {
    const g = garble('日本語のテキスト', [{ from: 'shift_jis', readAs: 'utf-8' }]);
    const d = diagnose(g);
    expect(d.patterns).toContain('replacement-chars');
    const e = explain(d, 'en');
    expect([...e.tips, ...e.notes].join(' ')).toMatch(/gone|lost/);
  });
});

describe('well-known garbage', () => {
  it('锟斤拷 is UTF-8 U+FFFD read as GBK: already broken', () => {
    const d = diagnose('锟斤拷锟斤拷');
    expect(d.patterns).toContain('kunkinkao');
    expect(d.best?.text).toBe('����');
    expect(explain(d, 'zh-TW').notes.join()).toContain('锟斤拷');
  });

  it('烫烫烫 and ﾌﾌﾌﾌ are uninitialized memory, not mojibake', () => {
    for (const s of ['烫烫烫烫', '屯屯屯屯', 'ﾌﾌﾌﾌﾌﾌ']) {
      const d = diagnose(s);
      expect(d.isMojibake).toBe(false);
      expect(d.patterns.length).toBeGreaterThan(0);
    }
  });

  it('??? from lossy saves is reported', () => {
    expect(diagnose('Name: ??????').patterns).toContain('question-marks');
  });
});

describe('clean text is left alone', () => {
  const CLEAN = [
    'こんにちは、世界',
    '東京都渋谷区',
    '農地に行きます',
    '繁體中文測試',
    '简体中文测试',
    '한국어 텍스트',
    'café crème brûlée',
    'naïve résumé',
    'Hello, world!',
    'Привет, мир',
    '😀 emoji OK',
    'Excelで開くとき',
    '¥100',
    '©2026 Wei-Lun Li',
    'ﾃｽﾄ',
    'Ｔｅｓｔ',
    '①②③',
    '髙橋さん',
    'ソフトウェア',
    'Café ☕ と コーヒー',
    '中文',
    '扶耐',
  ];
  for (const s of CLEAN) {
    it(s, () => {
      const d = diagnose(s);
      expect(d.isMojibake).toBe(false);
      expect(d.best).toBeNull();
    });
  }
});

describe('explanations', () => {
  it('cover every language for every kind of chain', () => {
    const inputs = [
      '縺薙ｓ縺ｫ縺｡縺ｯ',
      'æ—¥æœ¬èªž',
      '浣犲ソ',
      'í•œê¸€',
      '‚±‚ñ‚É‚¿‚Í',
      'ﾁcﾅ鬢､､蟐ｺﾀﾉｮﾗｦWｺﾙ',
      '$B$3$s$K$A$O(B',
      'Ã¦â€”Â¥Ã¦Å“Â¬',
      '譁・ｭ怜喧縺・',
      'Hello',
    ];
    for (const input of inputs) {
      const d = diagnose(input);
      for (const lang of LANGS) {
        const e = explain(d, lang);
        expect(e.summary.length).toBeGreaterThan(5);
        const all = [e.summary, ...e.steps, ...e.causes, ...e.tips, ...e.notes].join('\n');
        expect(all).not.toMatch(/\{\w+\}/);
        if (d.best) {
          expect(e.steps.length).toBe(d.best.chain.length);
          expect(e.causes.length).toBeGreaterThan(0);
          expect(e.tips.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
