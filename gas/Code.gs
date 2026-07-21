// ============================================================
// 木村家 家計簿 - Google Apps Script バックエンド
// ============================================================

const SPREADSHEET_ID = 'AKfycbz0DSBuzH0mcWphQFSNYqn3ePe47h5up6EpAB6qDjW7-oQwYKqOrdFiGcetXaepafhO'; // デプロイ後に置き換え

// 列定義
const COLS = {
  DATE: 1, DAY: 2,
  食費現金: 3, 食費カード: 4, 食費カード種類: 5,
  雑費現金: 6, 雑費カード: 7, 雑費カード種類: 8,
  交際費交通費現金: 9, 交際費交通費カード: 10, 交際費交通費カード種類: 11,
  交際費外食現金: 12, 交際費外食カード: 13, 交際費外食カード種類: 14,
  保険代現金: 15, 保険代カード: 16, 保険代カード種類: 17,
  光熱費ガス電気現金: 18, 光熱費ガス電気カード: 19, 光熱費ガス電気カード種類: 20,
  光熱費携帯ネット現金: 21, 光熱費携帯ネットカード: 22, 光熱費携帯ネットカード種類: 23,
  水道代現金: 24, 水道代カード: 25, 水道代カード種類: 26,
  緊急出費現金: 27, 緊急出費カード: 28, 緊急出費カード種類: 29, 緊急出費メモ: 30,
  固定費現金: 31, 固定費カード: 32, 固定費カード種類: 33
};

const CATEGORIES = [
  { key: '食費', cashCol: 3, cardCol: 4, cardTypeCol: 5 },
  { key: '雑費', cashCol: 6, cardCol: 7, cardTypeCol: 8 },
  { key: '交際費(交通費)', cashCol: 9, cardCol: 10, cardTypeCol: 11 },
  { key: '交際費(外食)', cashCol: 12, cardCol: 13, cardTypeCol: 14 },
  { key: '保険代', cashCol: 15, cardCol: 16, cardTypeCol: 17 },
  { key: '光熱費(ガス電気)', cashCol: 18, cardCol: 19, cardTypeCol: 20 },
  { key: '光熱費(携帯ネット)', cashCol: 21, cardCol: 22, cardTypeCol: 23 },
  { key: '水道代', cashCol: 24, cardCol: 25, cardTypeCol: 26 },
  { key: '緊急出費', cashCol: 27, cardCol: 28, cardTypeCol: 29, memoCol: 30 },
  { key: '固定費', cashCol: 31, cardCol: 32, cardTypeCol: 33 }
];

const HEADERS = [
  '日付', '曜日',
  '食費現金', '食費カード', '食費カード種類',
  '雑費現金', '雑費カード', '雑費カード種類',
  '交際費(交通費)現金', '交際費(交通費)カード', '交際費(交通費)カード種類',
  '交際費(外食)現金', '交際費(外食)カード', '交際費(外食)カード種類',
  '保険代現金', '保険代カード', '保険代カード種類',
  '光熱費(ガス電気)現金', '光熱費(ガス電気)カード', '光熱費(ガス電気)カード種類',
  '光熱費(携帯ネット)現金', '光熱費(携帯ネット)カード', '光熱費(携帯ネット)カード種類',
  '水道代現金', '水道代カード', '水道代カード種類',
  '緊急出費現金', '緊急出費カード', '緊急出費カード種類', '緊急出費メモ',
  '固定費現金', '固定費カード', '固定費カード種類'
];

const DAYS_JP = ['日', '月', '火', '水', '木', '金', '土'];
const DATA_START_ROW = 5;
const BUDGET_ROW = 3;
const TOTAL_COLS = 33;

// ============================================================
// エントリポイント
// ============================================================

function doPost(e) {
  const headers = { 'Access-Control-Allow-Origin': '*' };
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let result;

    switch (action) {
      case 'getMonthData':    result = getMonthData(data.sheetName);   break;
      case 'saveEntry':       result = saveEntry(data);                 break;
      case 'updateEntry':     result = updateEntry(data);               break;
      case 'getBudget':       result = getBudget(data.sheetName);       break;
      case 'updateBudget':    result = updateBudget(data);              break;
      case 'getAllMonths':     result = getAllMonthsData();              break;
      case 'checkNewSheet':   result = checkAndCreateNewSheet();        break;
      default: result = { error: 'Unknown action' };
    }
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return doPost({ postData: { contents: JSON.stringify(e.parameter) } });
}

// ============================================================
// シート名ユーティリティ
// ============================================================

function getSheetName(date) {
  const d = date || new Date();
  const day = d.getDate();
  // 16日以降は当月、1-15日は前月が対象期間
  let year = d.getFullYear();
  let month = d.getMonth() + 1;
  if (day <= 15) {
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
  }
  return `${year}年${String(month).padStart(2, '0')}月`;
}

function getCurrentSheetName() {
  return getSheetName(new Date());
}

// ============================================================
// シート作成
// ============================================================

function createSheet(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let ws = ss.getSheetByName(sheetName);
  if (ws) return ws;

  ws = ss.insertSheet(sheetName);

  // タイトル行
  ws.getRange(1, 1).setValue(`木村家の${sheetName}家計簿`);
  ws.getRange(1, 1, 1, TOTAL_COLS).merge();

  // 予算行（空で初期化）
  const budgetRow = new Array(TOTAL_COLS).fill('');
  ws.getRange(BUDGET_ROW, 1, 1, TOTAL_COLS).setValues([budgetRow]);

  // ヘッダー行
  ws.getRange(4, 1, 1, TOTAL_COLS).setValues([HEADERS]);

  // 日付行を生成（16日〜翌月15日）
  const [year, month] = sheetName.match(/(\d+)年(\d+)月/).slice(1).map(Number);
  const rows = [];
  const start = new Date(year, month - 1, 16);
  for (let i = 0; i < 31; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    // 翌月15日まで
    if (d.getMonth() + 1 !== month && d.getDate() > 15) break;
    if (d.getMonth() + 1 === month && d.getDate() < 16) break;
    const row = new Array(TOTAL_COLS).fill('');
    row[0] = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd');
    row[1] = DAYS_JP[d.getDay()];
    rows.push(row);
  }
  ws.getRange(DATA_START_ROW, 1, rows.length, TOTAL_COLS).setValues(rows);

  // 集計行
  const totalRowIdx = DATA_START_ROW + rows.length;
  const totalRow = new Array(TOTAL_COLS).fill('');
  totalRow[0] = '集計';
  for (let c = 3; c <= TOTAL_COLS; c++) {
    const col = columnLetter(c);
    totalRow[c - 1] = `=SUM(${col}${DATA_START_ROW}:${col}${totalRowIdx - 1})`;
  }
  ws.getRange(totalRowIdx, 1, 1, TOTAL_COLS).setValues([totalRow]);

  // 書式設定
  ws.setFrozenRows(4);
  ws.getRange(4, 1, 1, TOTAL_COLS).setFontWeight('bold').setBackground('#CBBDDD').setFontColor('#3D2466');
  ws.getRange(1, 1).setFontSize(14).setFontWeight('bold');

  return ws;
}

function columnLetter(n) {
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

// ============================================================
// データ取得
// ============================================================

function getMonthData(sheetName) {
  const name = sheetName || getCurrentSheetName();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let ws = ss.getSheetByName(name);
  if (!ws) ws = createSheet(name);

  const lastRow = ws.getLastRow();
  const allData = ws.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, TOTAL_COLS).getValues();
  const budgetData = ws.getRange(BUDGET_ROW, 1, 1, TOTAL_COLS).getValues()[0];

  const entries = [];
  allData.forEach((row, i) => {
    if (!row[0] || row[0] === '集計') return;
    const rawDate = row[0];
    const dateStr = rawDate instanceof Date
      ? Utilities.formatDate(rawDate, 'Asia/Tokyo', 'yyyy/MM/dd')
      : String(rawDate);
    const entry = { rowIndex: i + DATA_START_ROW, date: dateStr, day: row[1] };
    CATEGORIES.forEach(cat => {
      entry[cat.key] = {
        現金: row[cat.cashCol - 1] || 0,
        カード: row[cat.cardCol - 1] || 0,
        カード種類: row[cat.cardTypeCol - 1] || ''
      };
      if (cat.memoCol) entry[cat.key].メモ = row[cat.memoCol - 1] || '';
    });
    entries.push(entry);
  });

  const budget = {};
  CATEGORIES.forEach(cat => {
    budget[cat.key] = budgetData[cat.cashCol - 1] || 0;
  });

  return { sheetName: name, entries, budget };
}

function getBudget(sheetName) {
  const name = sheetName || getCurrentSheetName();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let ws = ss.getSheetByName(name);
  if (!ws) ws = createSheet(name);
  const budgetData = ws.getRange(BUDGET_ROW, 1, 1, TOTAL_COLS).getValues()[0];
  const budget = {};
  CATEGORIES.forEach(cat => {
    budget[cat.key] = budgetData[cat.cashCol - 1] || 0;
  });
  return { budget };
}

function getAllMonthsData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = ss.getSheets();
  const result = [];
  sheets.forEach(ws => {
    const name = ws.getName();
    if (!/\d+年\d+月/.test(name)) return;
    const budget = {};
    const totals = {};
    const budgetData = ws.getRange(BUDGET_ROW, 1, 1, TOTAL_COLS).getValues()[0];
    const lastRow = ws.getLastRow();
    const totalRowValues = ws.getRange(lastRow, 1, 1, TOTAL_COLS).getValues()[0];

    CATEGORIES.forEach(cat => {
      budget[cat.key] = budgetData[cat.cashCol - 1] || 0;
      const cashTotal = totalRowValues[cat.cashCol - 1] || 0;
      const cardTotal = totalRowValues[cat.cardCol - 1] || 0;
      totals[cat.key] = (typeof cashTotal === 'number' ? cashTotal : 0) +
                        (typeof cardTotal === 'number' ? cardTotal : 0);
    });
    result.push({ sheetName: name, budget, totals });
  });
  result.sort((a, b) => a.sheetName.localeCompare(b.sheetName));
  return { months: result };
}

// ============================================================
// データ書き込み
// ============================================================

function saveEntry(data) {
  const { sheetName, date, category, paymentMethod, cardType, amount, memo } = data;
  const name = sheetName || getCurrentSheetName();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let ws = ss.getSheetByName(name);
  if (!ws) ws = createSheet(name);

  const cat = CATEGORIES.find(c => c.key === category);
  if (!cat) return { error: `カテゴリが見つかりません: ${category}` };

  // 日付に対応する行を探す
  const lastRow = ws.getLastRow();
  const dateCol = ws.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW, 1).getValues();
  let targetRow = -1;
  for (let i = 0; i < dateCol.length; i++) {
    const cellDate = dateCol[i][0];
    const cellStr = cellDate instanceof Date
      ? Utilities.formatDate(cellDate, 'Asia/Tokyo', 'yyyy/MM/dd')
      : String(cellDate);
    if (cellStr === date) { targetRow = DATA_START_ROW + i; break; }
  }
  if (targetRow === -1) return { error: `日付が見つかりません: ${date}` };

  const colIdx = paymentMethod === '現金' ? cat.cashCol : cat.cardCol;
  const existing = ws.getRange(targetRow, colIdx).getValue() || 0;
  ws.getRange(targetRow, colIdx).setValue((typeof existing === 'number' ? existing : 0) + amount);

  if (paymentMethod === 'カード') {
    ws.getRange(targetRow, cat.cardTypeCol).setValue(cardType || '');
  }
  if (cat.memoCol && memo) {
    const existingMemo = ws.getRange(targetRow, cat.memoCol).getValue() || '';
    ws.getRange(targetRow, cat.memoCol).setValue(existingMemo ? existingMemo + ' / ' + memo : memo);
  }

  return { success: true };
}

function updateEntry(data) {
  const { sheetName, rowIndex, category, paymentMethod, cardType, cashAmount, cardAmount, memo } = data;
  const name = sheetName || getCurrentSheetName();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const ws = ss.getSheetByName(name);
  if (!ws) return { error: 'シートが見つかりません' };

  const cat = CATEGORIES.find(c => c.key === category);
  if (!cat) return { error: `カテゴリが見つかりません: ${category}` };

  ws.getRange(rowIndex, cat.cashCol).setValue(cashAmount || 0);
  ws.getRange(rowIndex, cat.cardCol).setValue(cardAmount || 0);
  ws.getRange(rowIndex, cat.cardTypeCol).setValue(cardType || '');
  if (cat.memoCol) ws.getRange(rowIndex, cat.memoCol).setValue(memo || '');

  return { success: true };
}

function updateBudget(data) {
  const { sheetName, budget } = data;
  const name = sheetName || getCurrentSheetName();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let ws = ss.getSheetByName(name);
  if (!ws) ws = createSheet(name);

  CATEGORIES.forEach(cat => {
    if (budget[cat.key] !== undefined) {
      ws.getRange(BUDGET_ROW, cat.cashCol).setValue(budget[cat.key]);
    }
  });
  return { success: true };
}

// ============================================================
// 月次シート自動生成チェック
// ============================================================

function checkAndCreateNewSheet() {
  const today = new Date();
  const sheetName = getCurrentSheetName();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  if (!ss.getSheetByName(sheetName)) {
    createSheet(sheetName);
    return { created: true, sheetName };
  }
  return { created: false, sheetName };
}

// 毎日午前0時16分に実行するトリガー用
function dailyCheck() {
  checkAndCreateNewSheet();
}
