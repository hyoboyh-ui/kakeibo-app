// gas/Code.gs の月次JSON出力（exportMonthlyReport）を、GASのAPIをシムして
// 実際に走らせる検証用ハーネス。本番のスプレッドシートにもDriveにも触らない。
//
//   node tools/export_sim.js
//
// 見ているのは exportMonthlyReport 自身の責務、つまり
//   ・どの期間のシートを対象に選ぶか
//   ・Driveのどこへ、どんな名前で、新規作成か更新か
// の2点。中身の組み立ては getMonthData の担当なのでスタブに置き換えている。

const fs = require('fs');
const path = require('path');

// 改行コードに依存しないよう、読み込み時にLFへ正規化する
const src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8')
  .split('\r\n').join('\n');

function grab(re, label) {
  const m = src.match(re);
  if (!m) throw new Error(label + ' が見つかりません');
  return m[0];
}

const pieces = [
  grab(/^const REPORT_FOLDER_ID = .*$/m, 'REPORT_FOLDER_ID'),
  grab(/^function getSheetName\(date\) \{[\s\S]*?^\}/m, 'getSheetName'),
  grab(/^function exportMonthlyReport\(\) \{[\s\S]*?^\}/m, 'exportMonthlyReport')
].join('\n\n');

const shim = `
const MimeType = { PLAIN_TEXT: 'text/plain' };
const DriveApp = {
  getFolderById: (id) => {
    __drive.folderId = id;
    return {
      getFilesByName: (name) => {
        const hit = Object.prototype.hasOwnProperty.call(__drive.files, name);
        let done = false;
        return {
          hasNext: () => hit && !done,
          next: () => { done = true; return {
            setContent: (c) => { __drive.files[name] = c; __drive.updated = name; }
          }; }
        };
      },
      createFile: (name, content, mime) => {
        __drive.files[name] = content;
        __drive.created = name;
        __drive.mime = mime;
      }
    };
  }
};
// 中身の組み立ては getMonthData の担当。ここでは呼ばれ方だけ記録する
function getMonthData(sheetName) {
  __asked.push(sheetName);
  return { sheetName: sheetName, entries: [], budget: {} };
}
`;

let drive = { files: {} }, asked = [];
let NOW = new Date(2026, 7, 22).getTime();

const FakeDate = class extends Date {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
};

const G = new Function('__drive', '__asked', 'Date',
  shim + '\n' + pieces + '\n' + 'return { exportMonthlyReport, getSheetName };'
)(drive, asked, FakeDate);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function runAt(y, m, d) {
  NOW = new Date(y, m, d).getTime();
  asked.length = 0;
  delete drive.created; delete drive.updated;
  G.exportMonthlyReport();
  return asked[0];
}

console.log('\n[1] 対象期間の選び方（期間は16日〜翌15日）');
[
  [[2026, 7, 16], '2026年07月', 'トリガーが走る8/16 → 締まったばかりの7月期'],
  [[2026, 7, 22], '2026年07月', '月の後半に手動実行'],
  [[2026, 8, 16], '2026年08月', '次回のトリガー9/16'],
  [[2027, 0, 16], '2026年12月', '年をまたぐ1/16'],
  [[2026, 11, 16], '2026年11月', '12/16'],
  [[2027, 2, 16], '2027年02月', '3/16']
].forEach(([ymd, expect, label]) => {
  const got = runAt(ymd[0], ymd[1], ymd[2]);
  check(label + ' → ' + expect, got === expect, got);
});

console.log('\n[2] 月の前半に手動実行した場合（実際の運用では起きない）');
// 実装は「当月1日」を基準にするため、1〜15日に回すとまだ進行中の期間を書き出す。
// トリガーは16日固定なので自動実行では起きない。手動で早回しした時だけの挙動。
check('9/5に実行すると進行中の8月期を書き出す（未完成のまま上書きされる）',
  runAt(2026, 8, 5) === '2026年08月', runAt(2026, 8, 5));

console.log('\n[3] Driveへの書き出し');
drive.files = {};
runAt(2026, 7, 22);
check('共有フォルダ「家計簿レポート出力」のIDを使う',
  drive.folderId === '1TD3kX8bJ1GYHMYWf_kMZV4Jo8O3pjmMx', drive.folderId);
check('ファイル名は <シート名>.json', drive.created === '2026年07月.json', drive.created);
check('MIMEは text/plain（実物と同じ）', drive.mime === 'text/plain', drive.mime);
check('中身は妥当なJSON', (() => {
  try { JSON.parse(drive.files['2026年07月.json']); return true; } catch (e) { return false; }
})());
check('getMonthData の戻りをそのまま書く（sheetName/entries/budget）',
  JSON.stringify(Object.keys(JSON.parse(drive.files['2026年07月.json'])))
    === JSON.stringify(['sheetName', 'entries', 'budget']));

runAt(2026, 7, 22);
check('2回目は新規作成せず既存を更新する（ファイルIDと共有リンクを保つため）',
  drive.updated === '2026年07月.json' && drive.created === undefined,
  { updated: drive.updated, created: drive.created });
check('ファイルが増えていない', Object.keys(drive.files).length === 1, Object.keys(drive.files));

runAt(2026, 8, 16);
check('月が変われば新しいファイルを作る', drive.created === '2026年08月.json', drive.created);
check('前月のファイルは残る', Object.keys(drive.files).length === 2, Object.keys(drive.files));

console.log('\n================================');
console.log('  成功 ' + pass + ' / 失敗 ' + fail);
console.log('================================\n');
process.exit(fail ? 1 : 0);
