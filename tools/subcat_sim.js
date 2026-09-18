// gas/Code.gs を丸ごと読み込み、Googleスプレッドシート側のAPIを偽物に差し替えて
// 「緊急出費の内訳」が正しく保存・読み出し・更新されるかを検証するハーネス。
// 本番のスプレッドシートには一切触らない（ネットワークも使わない）。
//
//   node tools/subcat_sim.js
//
// 内訳まわり（SUB_CATEGORIES / 取引ログの列 / メモ欄の組み立て）を直したら必ず通すこと。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'gas', 'Code.gs');
// 改行コードに依存しないよう、読み込み時にLFへ正規化する
const src = fs.readFileSync(SRC, 'utf8').split('\r\n').join('\n');

// ---- 偽のスプレッドシート -------------------------------------------
// 実物と同じ「行と列のます目」だけを持つ。数式は評価しない（文字列として置くだけ）。
class FakeSheet {
  constructor(name) {
    this.name = name;
    this.cells = [];        // cells[row][col] = 値（1始まり）
    this.maxRows = 1000;
    this.maxCols = 26;
    this.hidden = false;
    this.frozenRows = 0;
  }
  getName() { return this.name; }
  hideSheet() { this.hidden = true; }
  setFrozenRows(n) { this.frozenRows = n; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(after, howMany) { this.maxCols = Math.max(this.maxCols, after + howMany); }
  _cell(r, c) {
    if (!this.cells[r]) this.cells[r] = [];
    const v = this.cells[r][c];
    return v === undefined ? '' : v;
  }
  _set(r, c, v) {
    if (!this.cells[r]) this.cells[r] = [];
    this.cells[r][c] = v;
    this.maxRows = Math.max(this.maxRows, r);
    this.maxCols = Math.max(this.maxCols, c);
  }
  getLastRow() {
    let last = 0;
    for (let r = 1; r < this.cells.length; r++) {
      const row = this.cells[r];
      if (!row) continue;
      if (row.some(v => v !== undefined && v !== '')) last = r;
    }
    return last;
  }
  getLastColumn() {
    let last = 0;
    for (let r = 1; r < this.cells.length; r++) {
      const row = this.cells[r];
      if (!row) continue;
      for (let c = 1; c < row.length; c++) if (row[c] !== undefined && row[c] !== '') last = Math.max(last, c);
    }
    return last;
  }
  getRange(row, col, numRows, numCols) {
    const sheet = this;
    const nr = numRows === undefined ? 1 : numRows;
    const nc = numCols === undefined ? 1 : numCols;
    // 'B:C' のような列指定は書式設定にしか使われないので、何もしない箱を返す
    if (typeof row === 'string') return FakeSheet._noop();
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < nr; r++) {
          const line = [];
          for (let c = 0; c < nc; c++) line.push(sheet._cell(row + r, col + c));
          out.push(line);
        }
        return out;
      },
      getValue() { return sheet._cell(row, col); },
      setValues(vals) {
        vals.forEach((line, r) => line.forEach((v, c) => sheet._set(row + r, col + c, v)));
        return this;
      },
      setValue(v) { sheet._set(row, col, v); return this; },
      setNumberFormat() { return this; },
      merge() { return this; },
      setFontWeight() { return this; },
      setBackground() { return this; },
      setFontColor() { return this; },
      setFontSize() { return this; }
    };
  }
  getDataRange() {
    return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  static _noop() {
    const box = {};
    ['setNumberFormat', 'merge', 'setFontWeight', 'setBackground', 'setFontColor', 'setFontSize', 'setValue', 'setValues']
      .forEach(k => { box[k] = () => box; });
    box.getValues = () => [[]];
    box.getValue = () => '';
    return box;
  }
}

class FakeSpreadsheet {
  constructor() { this.sheets = []; }
  getSheets() { return this.sheets; }
  getSheetByName(name) { return this.sheets.find(s => s.name === name) || null; }
  insertSheet(name) { const s = new FakeSheet(name); this.sheets.push(s); return s; }
}

const ss = new FakeSpreadsheet();
const scriptProps = {};
const cacheStore = {};

const shim = `
const SpreadsheetApp = { getActive: () => __ss };
const Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  getUuid: () => __uuid(),
  computeDigest: (alg, value) => [0],
  formatDate: (d, tz, pattern) => __formatDate(d, pattern)
};
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => (k in __props ? __props[k] : null),
    setProperty: (k, v) => { __props[k] = String(v); },
    deleteProperty: (k) => { delete __props[k]; }
  })
};
const CacheService = {
  getScriptCache: () => ({
    get: (k) => (k in __cache ? __cache[k] : null),
    put: (k, v) => { __cache[k] = String(v); },
    remove: (k) => { delete __cache[k]; }
  })
};
const LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
const ContentService = {
  MimeType: { JSON: 'JSON' },
  createTextOutput: (t) => ({ setMimeType: () => t })
};
const Logger = { log: () => {} };
const MimeType = { PLAIN_TEXT: 'text/plain' };
const DriveApp = { getFolderById: () => ({ getFilesByName: () => ({ hasNext: () => false }), createFile: () => ({}) }) };
`;

function __uuid() { return crypto.randomUUID(); }
function __formatDate(d, pattern) {
  const p2 = (n) => String(n).padStart(2, '0');
  return pattern
    .replace('yyyy', d.getFullYear())
    .replace('MM', p2(d.getMonth() + 1))
    .replace('dd', p2(d.getDate()))
    .replace('HH', p2(d.getHours()))
    .replace('mm', p2(d.getMinutes()));
}

const factory = new Function(
  '__ss', '__props', '__cache', '__uuid', '__formatDate',
  shim + '\n' + src + '\n' +
  'return { createSheet, saveEntry, syncEntries, updateLogItem, deleteLogItem, getMonthData, ' +
  'getLogRows, buildLogRow, sanitizeSubCategory, resetRequestCaches, LOG_HEADERS, SUB_CATEGORIES, ' +
  'getLogSheet, CATEGORIES, COLS };'
);

const G = factory(ss, scriptProps, cacheStore, __uuid, __formatDate);

// ---- テスト ----------------------------------------------------------
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

const SHEET = '2026年09月';
G.createSheet(SHEET);
const DATE = '2026/09/20';

// 1リクエストごとにキャッシュを捨てるのが本番の動きなので、毎操作の前に呼ぶ
const save = (data) => { G.resetRequestCaches(); return G.saveEntry(Object.assign({ sheetName: SHEET }, data)); };

console.log('\n[1] 内訳の寄せ方（sanitizeSubCategory）');
check('内訳を持たないカテゴリは常に空', G.sanitizeSubCategory('食費', '通院費', true) === '');
check('決められた3つはそのまま通る', G.sanitizeSubCategory('緊急出費', '通院費', true) === '通院費');
check('新規で未指定なら先頭（急な出費）', G.sanitizeSubCategory('緊急出費', '', true) === '急な出費');
check('新規で知らない値なら先頭', G.sanitizeSubCategory('緊急出費', 'でっちあげ', true) === '急な出費');
check('更新で未指定なら空のまま（古い記録を勝手に分類しない）', G.sanitizeSubCategory('緊急出費', '', false) === '');

console.log('\n[2] 取引ログの列');
check('見出しの最後が subCategory', G.LOG_HEADERS[G.LOG_HEADERS.length - 1] === 'subCategory');
check('見出しは11列', G.LOG_HEADERS.length === 11, G.LOG_HEADERS.length);
const row = G.buildLogRow({ sheetName: SHEET, date: DATE, category: '緊急出費', paymentMethod: '現金', amount: 100, subCategory: '通院費' });
check('deleted は今までと同じ10列目（添字9）', row[9] === false, row[9]);
check('内訳は11列目（添字10）', row[10] === '通院費', row[10]);
const foodRow = G.buildLogRow({ sheetName: SHEET, date: DATE, category: '食費', paymentMethod: '現金', amount: 100, subCategory: '通院費' });
check('食費の行には内訳が入らない', foodRow[10] === '', foodRow[10]);

console.log('\n[3] 保存すると内訳が付く');
const r1 = save({ date: DATE, category: '緊急出費', paymentMethod: '現金', amount: 3000, memo: '歯科', subCategory: '通院費' });
check('保存が成功する', r1.success === true, r1);
check('返ってくる内訳が通院費', r1.item.subCategory === '通院費', r1.item);
const r2 = save({ date: DATE, category: '緊急出費', paymentMethod: 'カード', cardType: 'Olive', amount: 42000, memo: '炊飯器', subCategory: '家電・贈り物' });
check('2件目も成功する', r2.success === true, r2);
const r3 = save({ date: DATE, category: '緊急出費', paymentMethod: '現金', amount: 500 });
check('内訳を送らなければ急な出費になる', r3.item.subCategory === '急な出費', r3.item);
const r4 = save({ date: DATE, category: '食費', paymentMethod: '現金', amount: 1200, memo: 'スーパー' });
check('食費には内訳が付かない', r4.item.subCategory === undefined || r4.item.subCategory === '', r4.item);

console.log('\n[4] 読み出し（getMonthData）');
G.resetRequestCaches();
const month = G.getMonthData(SHEET);
const day = month.entries.find(e => e.date === DATE);
const kin = day['緊急出費'];
check('緊急出費の明細が3件', kin.items.length === 3, kin.items.length);
check('内訳が3件すべて読める', kin.items.map(i => i.subCategory).join(',') === '通院費,家電・贈り物,急な出費', kin.items.map(i => i.subCategory));
check('現金の合計は 3000+500', kin.現金 === 3500, kin.現金);
check('カードの合計は 42000', kin.カード === 42000, kin.カード);
check('食費の明細に内訳は無い', day['食費'].items[0].subCategory === '', day['食費'].items[0]);

console.log('\n[5] スプレッドシートのメモ欄に内訳が残る');
check('「内訳：メモ」の形で並ぶ',
  kin.メモ === '通院費：歯科 / 家電・贈り物：炊飯器 / 急な出費',
  kin.メモ);
check('メモが無い記録は内訳だけ出る', kin.メモ.endsWith('急な出費'), kin.メモ);
check('食費のメモは今までどおり', day['食費'].メモ === 'スーパー', day['食費'].メモ);

console.log('\n[6] 修正（updateLogItem）');
const target = kin.items.find(i => i.subCategory === '通院費');
G.resetRequestCaches();
const u1 = G.updateLogItem({ id: target.id, amount: 3300, memo: '歯科', subCategory: '家電・贈り物' });
check('内訳を変えられる', u1.success === true, u1);
check('メモ欄も新しい内訳に追従する', u1.updated.メモ.startsWith('家電・贈り物：歯科'), u1.updated.メモ);
check('金額の変更も効いている', u1.updated.現金 === 3800, u1.updated.現金);

// 内訳が付く前の古い記録を模して、内訳を空にしたログを1件差し込む
G.resetRequestCaches();
const legacyId = G.saveEntry({ sheetName: SHEET, date: DATE, category: '緊急出費', paymentMethod: '現金', amount: 8000 }).item.id;
const logWs = G.getLogSheet();
const legacyRow = (() => {
  for (let r = 2; r <= logWs.getLastRow(); r++) if (logWs.getRange(r, 1).getValue() === legacyId) return r;
  return -1;
})();
logWs.getRange(legacyRow, 11).setValue('');
G.resetRequestCaches();
const u2 = G.updateLogItem({ id: legacyId, amount: 8000, memo: '' });
check('内訳の無い記録を編集しても勝手に分類されない', logWs.getRange(legacyRow, 11).getValue() === '', logWs.getRange(legacyRow, 11).getValue());
check('編集自体は成功する', u2.success === true, u2);

console.log('\n[7] 削除（新しい列を足しても壊れていない）');
G.resetRequestCaches();
const before = G.getMonthData(SHEET).entries.find(e => e.date === DATE)['緊急出費'];
G.resetRequestCaches();
const d1 = G.deleteLogItem({ id: legacyId });
check('削除が成功する', d1.success === true, d1);
check('削除ぶんだけ現金が減る', d1.updated.現金 === before.現金 - 8000, { after: d1.updated.現金, before: before.現金 });
G.resetRequestCaches();
check('削除した明細は一覧から消える',
  !G.getMonthData(SHEET).entries.find(e => e.date === DATE)['緊急出費'].items.some(i => i.id === legacyId));

console.log('\n[8] まとめて同期（syncEntries）');
const DATE2 = '2026/09/21';
G.resetRequestCaches();
const sync = G.syncEntries({ entries: [
  { id: 'sync-1', sheetName: SHEET, date: DATE2, category: '緊急出費', paymentMethod: '現金', amount: 1000, memo: '', subCategory: '通院費' },
  { id: 'sync-2', sheetName: SHEET, date: DATE2, category: '緊急出費', paymentMethod: 'カード', cardType: 'JCB', amount: 2000, memo: '', subCategory: 'でっちあげ' },
  { id: 'sync-3', sheetName: SHEET, date: DATE2, category: '食費', paymentMethod: '現金', amount: 300, memo: '' }
] });
check('3件すべて成功する', sync.results.filter(r => r.success).length === 3, sync.results);
G.resetRequestCaches();
const day2 = G.getMonthData(SHEET).entries.find(e => e.date === DATE2);
check('内訳が保存されている', day2['緊急出費'].items.find(i => i.id === 'sync-1').subCategory === '通院費');
check('知らない内訳は急な出費に寄る', day2['緊急出費'].items.find(i => i.id === 'sync-2').subCategory === '急な出費',
  day2['緊急出費'].items.find(i => i.id === 'sync-2').subCategory);
check('同じidを二重に送っても増えない', (() => {
  G.resetRequestCaches();
  const again = G.syncEntries({ entries: [{ id: 'sync-1', sheetName: SHEET, date: DATE2, category: '緊急出費', paymentMethod: '現金', amount: 1000, subCategory: '通院費' }] });
  return again.results[0].duplicate === true;
})());

console.log('\n[9] 内訳の列が無い既存ログシートへの移行');
// 本番の取引ログは10列で動いてきたので、11列目を後から足す道を通す必要がある。
// 「既に中身が入っていて、列が足りていないシート」を作り直して再現する。
(() => {
  const idx = ss.sheets.findIndex(sh => sh.name === '取引ログ');
  ss.sheets.splice(idx, 1);
  const narrow = ss.insertSheet('取引ログ');
  const oldHeaders = G.LOG_HEADERS.slice(0, 10);
  oldHeaders.forEach((h, i) => narrow._set(1, i + 1, h));
  narrow._set(2, 1, 'legacy-row');
  narrow._set(2, 2, SHEET);
  narrow._set(2, 3, DATE);
  narrow._set(2, 4, '緊急出費');
  narrow._set(2, 5, '現金');
  narrow._set(2, 7, 4000);
  narrow._set(2, 10, false);
  narrow.maxCols = 10;   // _set で広がってしまうので、足りていない状態に戻す
  delete scriptProps.LOG_SUBCAT_COL;

  G.resetRequestCaches();
  const ws = G.getLogSheet();
  check('11列目に見出しが足される', ws.getRange(1, 11).getValue() === 'subCategory', ws.getRange(1, 11).getValue());
  check('列そのものが広がる', ws.getMaxColumns() >= 11, ws.getMaxColumns());
  check('既存の行はそのまま残る', ws.getRange(2, 7).getValue() === 4000, ws.getRange(2, 7).getValue());
  check('内訳の無い既存行は空として読める', (() => {
    G.resetRequestCaches();
    const r = G.getLogRows(SHEET).find(x => x.id === 'legacy-row');
    return !!r && r.subCategory === '';
  })());
  check('2回目の呼び出しでは何も足さない', (() => {
    G.resetRequestCaches();
    G.getLogSheet();
    return scriptProps.LOG_SUBCAT_COL === '1';
  })());
  check('列を足した後も新しい記録が保存できる', (() => {
    G.resetRequestCaches();
    const r = G.saveEntry({ sheetName: SHEET, date: DATE, category: '緊急出費', paymentMethod: '現金', amount: 700, subCategory: '通院費' });
    return r.success === true && r.item.subCategory === '通院費';
  })());
})();

console.log('\n================================');
console.log(`  成功 ${pass} / 失敗 ${fail}`);
console.log('================================\n');
process.exit(fail === 0 ? 0 : 1);
