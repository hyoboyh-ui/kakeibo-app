// ============================================================
// 木村家 家計簿 - Google Apps Script バックエンド
// ============================================================

// このスクリプトが紐づいているスプレッドシートを使うため、通常はIDの設定は不要。
// スプレッドシートから独立したスクリプトとして動かす場合のみ、下記にIDを入れる。
// （スプレッドシートのURL https://docs.google.com/spreadsheets/d/★ここ★/edit の部分）
const SPREADSHEET_ID = '';

function getSS() {
  if (_ssCache) return _ssCache;
  const active = SpreadsheetApp.getActive();
  if (active) {
    _ssCache = active;
    return _ssCache;
  }
  if (!SPREADSHEET_ID) {
    throw new Error('スプレッドシートに紐づいていません。Code.gs の SPREADSHEET_ID を設定してください。');
  }
  _ssCache = SpreadsheetApp.openById(SPREADSHEET_ID);
  return _ssCache;
}

// シート取得も1リクエスト内では使い回す（getSheetByNameも毎回API往復になるため）
function getSheetCached(name) {
  if (Object.prototype.hasOwnProperty.call(_sheetCache, name)) return _sheetCache[name];
  const ws = getSS().getSheetByName(name);
  _sheetCache[name] = ws;
  return ws;
}

// 列定義
// メモ列は既存シートとの互換性のため、各カテゴリの現金/カード/カード種類の
// 直後ではなく末尾(34〜42列目)にまとめて追加している。
// こうすることで、既存の月シートの列位置は一切変わらない。
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
  固定費現金: 31, 固定費カード: 32, 固定費カード種類: 33,
  食費メモ: 34, 雑費メモ: 35, 交際費交通費メモ: 36, 交際費外食メモ: 37,
  保険代メモ: 38, 光熱費ガス電気メモ: 39, 光熱費携帯ネットメモ: 40,
  水道代メモ: 41, 固定費メモ: 42
};

const CATEGORIES = [
  { key: '食費', cashCol: 3, cardCol: 4, cardTypeCol: 5, memoCol: 34 },
  { key: '雑費', cashCol: 6, cardCol: 7, cardTypeCol: 8, memoCol: 35 },
  { key: '交際費(交通費)', cashCol: 9, cardCol: 10, cardTypeCol: 11, memoCol: 36 },
  { key: '交際費(外食)', cashCol: 12, cardCol: 13, cardTypeCol: 14, memoCol: 37 },
  { key: '保険代', cashCol: 15, cardCol: 16, cardTypeCol: 17, memoCol: 38 },
  { key: '光熱費(ガス電気)', cashCol: 18, cardCol: 19, cardTypeCol: 20, memoCol: 39 },
  { key: '光熱費(携帯ネット)', cashCol: 21, cardCol: 22, cardTypeCol: 23, memoCol: 40 },
  { key: '水道代', cashCol: 24, cardCol: 25, cardTypeCol: 26, memoCol: 41 },
  { key: '緊急出費', cashCol: 27, cardCol: 28, cardTypeCol: 29, memoCol: 30 },
  { key: '固定費', cashCol: 31, cardCol: 32, cardTypeCol: 33, memoCol: 42 }
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
  '固定費現金', '固定費カード', '固定費カード種類',
  '食費メモ', '雑費メモ', '交際費(交通費)メモ', '交際費(外食)メモ',
  '保険代メモ', '光熱費(ガス電気)メモ', '光熱費(携帯ネット)メモ',
  '水道代メモ', '固定費メモ'
];

const DAYS_JP = ['日', '月', '火', '水', '木', '金', '土'];
const DATA_START_ROW = 5;
const BUDGET_ROW = 3;
const TOTAL_COLS = 42;

// ============================================================
// エントリポイント
// ============================================================

const WRITE_ACTIONS = ['saveEntry', 'updateEntry', 'updateBudget', 'updateLogItem', 'deleteLogItem', 'updateResidual', 'syncEntries'];

// ============================================================
// 認証
//
// このWebアプリは「全員（匿名を含む）」で公開する必要がある。つまりURLは
// 秘密にできない。また配信元が静的サイト（GitHub Pages）である以上、
// フロントに埋め込んだ文字列も秘密にできない。
//
// したがって鍵は「フロントに書けないもの」＝家族が頭で覚えるパスワードだけ。
// パスワードそのものは保存せず、ソルト付きの反復ハッシュだけを持つ。
// ログインに成功した端末にはトークンを発行し、以降はそれで認証する。
// ============================================================

const PASSWORD_PROP = 'PASSWORD_RECORD';    // { salt, hash, iterations, updatedAt }
const SESSIONS_PROP = 'SESSIONS';           // { token: 有効期限(ms), ... }
const LEGACY_SECRET_PROP = 'API_SECRET';    // 旧方式。もう読まない（setupPasswordで削除する）

// 反復回数。GASの computeDigest は1回あたり約0.9msと遅く、12000回で約11秒かかった
// （2026-08-22実測）。ログイン体感を優先して2000回＝約1.8秒に下げている。
//
// この回数はここでは主役ではない。ハッシュを読めるのはスクリプト所有者だけで、
// そこまで入られていればシート本体が見えている。現実的な脅威はWeb経由の推測であり、
// それは下の LOGIN_FAIL_MAX による回数制限が防いでいる。反復SHA-256はGPUでの
// 総当たりには回数を増やしても大差なく弱いので、効いているのはソルトと回数制限。
//
// 値は setupPassword 実行時にパスワード記録へ焼き付く。変えるときは
// benchmarkHash() で測ってから setupPassword をやり直すこと（順番が逆だと反映されない）。
const PWD_ITERATIONS = 2000;
const TOKEN_TTL_DAYS = 90;      // トークンの有効期間
const TOKEN_RENEW_DAYS = 30;    // 残りがこれを切ったら自動で延長する
const MAX_SESSIONS = 20;        // 保持する端末数の上限（古いものから捨てる）

const LOGIN_FAIL_KEY = 'login_fail_count';
const LOGIN_FAIL_MAX = 10;      // この回数を超えたらロック
const LOGIN_FAIL_WINDOW = 900;  // 15分（秒）

// ============================================================
// 初回セットアップ（Apps Scriptエディタから手動で1回だけ実行する）
//
//   setupPassword('ここに家族で使うパスワード')
//
// を実行する。実行後、この行のパスワードは必ず消してから保存すること
// （エディタの中身は履歴に残るため）。
// パスワードはログに出さない。忘れた場合は再度この関数を実行して上書きする。
// ※これを実行するまで、このWebアプリは全リクエストを拒否する（安全側に倒すため）
// ============================================================
function setupPassword(plainPassword) {
  if (typeof plainPassword !== 'string' || plainPassword.length < 6) {
    throw new Error('setupPassword("6文字以上のパスワード") の形で実行してください');
  }
  const salt = Utilities.getUuid().replace(/-/g, '');
  const record = {
    salt: salt,
    hash: hashPassword(plainPassword, salt, PWD_ITERATIONS),
    iterations: PWD_ITERATIONS,
    updatedAt: new Date().toISOString()
  };
  const props = PropertiesService.getScriptProperties();
  props.setProperty(PASSWORD_PROP, JSON.stringify(record));

  // 全端末のログイン状態を破棄（パスワードを変えたら入り直してもらう）
  props.deleteProperty(SESSIONS_PROP);

  // 旧 API_SECRET はここでは消さない。
  // 同じプロジェクトの別スクリプト（月次JSON出力の exportMonthlyReport など）が
  // まだ読んでいる可能性があるため、消すのは全部の動作確認が済んでから
  // removeLegacySecret() で行う。認証には一切使っていないので、残っていても無害。

  Logger.log('パスワードを設定しました（' + record.updatedAt + '）。'
    + '\n全端末のログイン状態を破棄したので、各自もう一度ログインしてください。'
    + '\n※このエディタに書いたパスワード文字列は消してから保存すること');
  return 'ok';
}

// 旧方式の合言葉を片付ける。すべての動作確認（アプリのログイン、月次JSON出力）が
// 済んでから、気が向いたときに1回実行すればよい。急ぐ必要はない。
function removeLegacySecret() {
  PropertiesService.getScriptProperties().deleteProperty(LEGACY_SECRET_PROP);
  Logger.log('旧 API_SECRET を削除しました');
  return 'ok';
}

// ログイン失敗のロックを手動で解除する（家族が締め出された場合の非常口）
function resetLoginLock() {
  CacheService.getScriptCache().remove(LOGIN_FAIL_KEY);
  Logger.log('ログイン失敗カウンタをリセットしました');
  return 'ok';
}

// ログイン1回にかかるハッシュ計算の時間を測る（エディタから実行する）。
// 2秒を大きく超えるようなら PWD_ITERATIONS を下げてよい。
// 反復回数はパスワード記録側に保存しているため、下げても既存のパスワードは
// そのまま使える（次に setupPassword / パスワード変更をした時から新しい値になる）。
function benchmarkHash() {
  const t0 = Date.now();
  hashPassword('benchmark', 'saltsaltsaltsalt', PWD_ITERATIONS);
  const ms = Date.now() - t0;
  Logger.log(PWD_ITERATIONS + '回の反復に ' + ms + 'ms かかりました'
    + '\n（この時間がログイン1回あたりの計算コスト。2秒を大きく超えるなら PWD_ITERATIONS を下げる）');
  return ms;
}

// ============================================================
// ハッシュ
// ============================================================

function hashPassword(password, salt, iterations) {
  let bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, salt + ':' + password, Utilities.Charset.UTF_8);
  for (let i = 1; i < iterations; i++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
  }
  return hex;
}

// タイミング攻撃を避けるため、長さと全文字を必ず最後まで比較する
function constantTimeEquals(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// ============================================================
// セッション（トークン）
// ============================================================

function readSessions() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(SESSIONS_PROP);
    const obj = raw ? JSON.parse(raw) : {};
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (err) {
    return {};
  }
}

// 期限切れを捨て、多すぎる場合は期限が近いものから捨てて書き戻す
function writeSessions(sessions) {
  const now = Date.now();
  let entries = Object.keys(sessions)
    .filter(function (t) { return sessions[t] > now; })
    .map(function (t) { return [t, sessions[t]]; });

  if (entries.length > MAX_SESSIONS) {
    entries.sort(function (a, b) { return b[1] - a[1]; });  // 期限が遠い＝新しいものを残す
    entries = entries.slice(0, MAX_SESSIONS);
  }
  const out = {};
  entries.forEach(function (pair) { out[pair[0]] = pair[1]; });
  PropertiesService.getScriptProperties().setProperty(SESSIONS_PROP, JSON.stringify(out));
  return out;
}

function issueToken() {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const expiry = Date.now() + TOKEN_TTL_DAYS * 86400000;
  const sessions = readSessions();
  sessions[token] = expiry;
  writeSessions(sessions);
  return { token: token, expiresAt: expiry };
}

// 有効なら true。期限が近ければ黙って延長する（ログインし直しを避けるため）
function tokenIsValid(token) {
  if (typeof token !== 'string' || token.length < 32) return false;
  const sessions = readSessions();
  const expiry = sessions[token];
  if (!expiry || expiry <= Date.now()) return false;

  if (expiry - Date.now() < TOKEN_RENEW_DAYS * 86400000) {
    sessions[token] = Date.now() + TOKEN_TTL_DAYS * 86400000;
    writeSessions(sessions);
  }
  return true;
}

function revokeToken(token) {
  const sessions = readSessions();
  if (sessions[token]) {
    delete sessions[token];
    writeSessions(sessions);
  }
  return { ok: true };
}

// ============================================================
// ログイン
// ============================================================

function loginFailCount() {
  const v = CacheService.getScriptCache().get(LOGIN_FAIL_KEY);
  return v ? parseInt(v, 10) : 0;
}

function bumpLoginFail() {
  const next = loginFailCount() + 1;
  CacheService.getScriptCache().put(LOGIN_FAIL_KEY, String(next), LOGIN_FAIL_WINDOW);
  return next;
}

function handleLogin(data) {
  // 総当たり対策。GASからは接続元IPが見えないため全体で数える。
  // 家族が締め出された場合は resetLoginLock() をエディタで実行する。
  if (loginFailCount() >= LOGIN_FAIL_MAX) {
    return { error: 'ログインの失敗が続いたため一時的にロックしています。15分ほど待ってからお試しください', code: 'LOCKED' };
  }

  const raw = PropertiesService.getScriptProperties().getProperty(PASSWORD_PROP);
  if (!raw) {
    return { error: 'サーバー未設定です（Apps Scriptで setupPassword を1回実行してください）', code: 'NO_PASSWORD' };
  }
  const record = JSON.parse(raw);
  const given = hashPassword(String(data.password || ''), record.salt, record.iterations);

  if (!constantTimeEquals(given, record.hash)) {
    bumpLoginFail();
    return { error: 'パスワードが違います', code: 'BAD_PASSWORD' };
  }

  CacheService.getScriptCache().remove(LOGIN_FAIL_KEY);
  return issueToken();
}

// アプリの設定画面から呼ぶ。現在のパスワードを知っている人だけが変更できる。
// 変更したら、呼び出した端末以外のログインは全部無効にする。
function handleChangePassword(data) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(PASSWORD_PROP);
  if (!raw) return { error: 'サーバー未設定です', code: 'NO_PASSWORD' };

  const record = JSON.parse(raw);
  const oldGiven = hashPassword(String(data.oldPassword || ''), record.salt, record.iterations);
  if (!constantTimeEquals(oldGiven, record.hash)) {
    bumpLoginFail();
    return { error: '現在のパスワードが違います', code: 'BAD_PASSWORD' };
  }

  const newPassword = String(data.newPassword || '');
  if (newPassword.length < 6) return { error: '新しいパスワードは6文字以上にしてください' };

  const salt = Utilities.getUuid().replace(/-/g, '');
  props.setProperty(PASSWORD_PROP, JSON.stringify({
    salt: salt,
    hash: hashPassword(newPassword, salt, PWD_ITERATIONS),
    iterations: PWD_ITERATIONS,
    updatedAt: new Date().toISOString()
  }));

  // 他端末のトークンを全部捨て、呼び出し元だけ新しく発行し直す
  props.deleteProperty(SESSIONS_PROP);
  const issued = issueToken();
  return { ok: true, token: issued.token, expiresAt: issued.expiresAt };
}

function jsonOutput(obj) {
  return ContentService
    .createTextOutput(typeof obj === 'string' ? obj : JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    resetRequestCaches();
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    // --- ログインだけは認証前に通す（これ自体が認証なので） ------------
    if (action === 'login')  return jsonOutput(handleLogin(data));
    if (action === 'logout') return jsonOutput(revokeToken(data.token));

    // --- 認証 ---------------------------------------------------------
    if (!tokenIsValid(data.token)) {
      // 旧バージョンのフロントは token を知らず、代わりに secret を送ってくる。
      // 「パスワードが違う」と誤解させないよう、更新を促す専用の応答を返す。
      if (data.secret && !data.token) {
        return jsonOutput({ error: 'アプリが古いため接続できません。画面を再読み込みしてください', code: 'STALE_CLIENT' });
      }
      return jsonOutput({ error: 'ログインの有効期限が切れました。もう一度ログインしてください', code: 'AUTH' });
    }

    // パスワード変更は認証済みだがシートに触らないので、ロックの外で処理する
    if (action === 'changePassword') return jsonOutput(handleChangePassword(data));

    // --- 書き込みは直列化 ----------------------------------------------
    // saveEntry等は「セルを読む→加算して書く」構造のため、2人が同時に記録すると
    // 後勝ちで片方の金額が丸ごと消える。書き込み系は必ずロックを取ってから実行する。
    const isWrite = WRITE_ACTIONS.includes(action);
    if (!isWrite) return jsonOutput(routeAction(action, data));

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) {
      return jsonOutput({ error: '混み合っています。少し待ってからもう一度お試しください' });
    }
    try {
      // 重複実行の防止（フロント側のリトライで実際は成功していた処理を
      // 二重実行し、金額が二重加算されるのを防ぐ）。ロック取得後に判定するため、
      // 「1回目がまだ実行中に再送が来る」ケースもここで確実に検知できる。
      const cache = CacheService.getScriptCache();
      const dedupeKey = data.requestId ? 'req_' + data.requestId : null;
      if (dedupeKey) {
        const cached = cache.get(dedupeKey);
        if (cached) return jsonOutput(cached);
      }

      const output = JSON.stringify(routeAction(action, data));
      if (dedupeKey) cache.put(dedupeKey, output, 300); // 5分間だけ再送を検知
      return jsonOutput(output);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonOutput({ error: err.message });
  }
}

function routeAction(action, data) {
  switch (action) {
    case 'getMonthData':    return getMonthData(data.sheetName);
    case 'saveEntry':       return saveEntry(data);
    case 'updateEntry':     return updateEntry(data);
    case 'getBudget':       return getBudget(data.sheetName);
    case 'updateBudget':    return updateBudget(data);
    case 'getAllMonths':    return getAllMonthsData();
    case 'checkNewSheet':   return checkAndCreateNewSheet();
    case 'updateLogItem':   return updateLogItem(data);
    case 'deleteLogItem':   return deleteLogItem(data);
    case 'updateResidual':  return updateResidual(data);
    case 'syncEntries':     return syncEntries(data);
    default: return { error: 'Unknown action' };
  }
}

// GETは一切受け付けない。
// 以前はdoPostへそのまま流していたため、URLを開くだけ（あるいは外部サイトの
// <img src="...">を踏むだけ）でデータを書き換えられる状態だった。
function doGet() {
  return jsonOutput({ error: 'GETは利用できません' });
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
  const ss = getSS();
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

  invalidateMonthsCache();
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
// 取引ログ（1回ごとの記録を個別に残す、月シートとは別の追記専用シート）
//
// 月シート側の集計セル(cashCol/cardCol)はこれまで通り合計値を持たせ続ける
// （予算・グラフ・集計はこのセルだけを見ているため無停止で動く）。
// このログは履歴ページで「同じ日の内訳」を個別表示するための追加データで、
// 過去（このログが存在する前）の記録には対応する行がないため、履歴側は
// 「集計セルの合計 - ログの合計」を差分として1行にまとめて表示する。
// ============================================================

const LOG_SHEET_NAME = '取引ログ';
const LOG_HEADERS = ['id', 'sheetName', 'date', 'category', 'paymentMethod', 'cardType', 'amount', 'memo', 'recordedAt', 'deleted'];

function getLogSheet() {
  const ss = getSS();
  let ws = ss.getSheetByName(LOG_SHEET_NAME);
  if (!ws) {
    ws = ss.insertSheet(LOG_SHEET_NAME);
    ws.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    ws.setFrozenRows(1);
    ws.hideSheet();
  }
  // sheetName・date列は"2026年08月"や"2026/08/21"のような日付に見える文字列のため、
  // 書式が既定(自動)のままだとSheetsが自動的にDate型へ変換してしまい、
  // 文字列としての一致比較(getLogRows)が壊れる。
  // 列そのものに書式を掛けておけば、以後どれだけ行が増えても効くので、1回だけ実行する。
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('LOG_COLS_FORMATTED') !== '1') {
    ws.getRange('B:C').setNumberFormat('@');
    props.setProperty('LOG_COLS_FORMATTED', '1');
  }
  return ws;
}

function buildLogRow({ id, sheetName, date, category, paymentMethod, cardType, amount, memo }) {
  return [id || Utilities.getUuid(), sheetName, date, category, paymentMethod,
          cardType || '', amount, memo || '', new Date(), false];
}

// 複数行をまとめて1回で書き込む（1件ずつ書くと件数分だけ通信が発生するため）
function appendLogRows(rows) {
  if (rows.length === 0) return;
  const ws = getLogSheet();
  // 列全体に文字列書式を掛けてあるので、行ごとの書式設定は不要
  const startRow = readLogValues().values.length + 2;
  ws.getRange(startRow, 1, rows.length, LOG_HEADERS.length).setValues(rows);
  if (_logValuesCache) rows.forEach(r => _logValuesCache.values.push(r)); // 読み込み済みの一覧にも足しておく
}

function appendLogItem(item) {
  const row = buildLogRow(item);
  appendLogRows([row]);
  return row[0];
}

// 文字列であるべき列がすでにDate型で保存されてしまっている過去データを、元の文字列表現に戻す
function normalizeLogDateValue(v, pattern) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', pattern);
  return v;
}

// ============================================================
// 残高ベース（ログ導入前からある「内訳の分からない金額」の記録）
//
// 集計セルの値は「残高ベース + 有効なログの合計」で必ず再計算する。
// 加算/減算を積み重ねる方式をやめることで、二重加算・取りこぼし・
// ログと集計セルの食い違いが構造的に起こらなくなる。
// ============================================================

const RESIDUAL_SHEET_NAME = '残高ベース';
const RESIDUAL_HEADERS = ['sheetName', 'date', 'category', 'cash', 'card', 'cardType', 'memo'];

function getResidualSheet() {
  const ss = getSS();
  let ws = ss.getSheetByName(RESIDUAL_SHEET_NAME);
  if (!ws) {
    ws = ss.insertSheet(RESIDUAL_SHEET_NAME);
    ws.getRange(1, 1, 1, RESIDUAL_HEADERS.length).setValues([RESIDUAL_HEADERS]);
    ws.setFrozenRows(1);
    ws.hideSheet();
    // 取引ログと同じ理由（日付に見える文字列の自動変換対策）で文字列書式に固定
    ws.getRange(2, 1, Math.max(ws.getMaxRows() - 1, 1), 3).setNumberFormat('@');
  }
  return ws;
}

// 1リクエスト中に同じシートを何度も読み直さないためのキャッシュ
// （doPostの入口で必ず破棄するので、リクエストをまたいで古い値が残ることはない）
let _residualCache = null;
let _logValuesCache = null;
let _ssCache = null;
let _sheetCache = {};
let _dateRowCache = {};

function resetRequestCaches() {
  _residualCache = null;
  _logValuesCache = null;
  _ssCache = null;
  _sheetCache = {};
  _dateRowCache = {};
}

function readResidualRows() {
  if (_residualCache) return _residualCache;
  const ws = getResidualSheet();
  const lastRow = ws.getLastRow();
  if (lastRow < 2) {
    _residualCache = { ws, rows: [] };
    return _residualCache;
  }
  const values = ws.getRange(2, 1, lastRow - 1, RESIDUAL_HEADERS.length).getValues();
  const rows = values.map((r, i) => ({
    rowIndex: i + 2,
    sheetName: normalizeLogDateValue(r[0], 'yyyy年MM月'),
    date: normalizeLogDateValue(r[1], 'yyyy/MM/dd'),
    category: r[2],
    cash: typeof r[3] === 'number' ? r[3] : 0,
    card: typeof r[4] === 'number' ? r[4] : 0,
    cardType: r[5] || '',
    memo: r[6] || ''
  }));
  _residualCache = { ws, rows };
  return _residualCache;
}

function findResidual(sheetName, date, category) {
  const { ws, rows } = readResidualRows();
  const found = rows.find(r => r.sheetName === sheetName && r.date === date && r.category === category);
  return { ws, found };
}

function writeResidual(sheetName, date, category, values) {
  const { ws, found } = findResidual(sheetName, date, category);
  const row = [sheetName, date, category, values.cash || 0, values.card || 0, values.cardType || '', values.memo || ''];
  const rowIndex = found ? found.rowIndex : ws.getLastRow() + 1;
  if (!found) ws.getRange(rowIndex, 1, 1, 3).setNumberFormat('@');
  ws.getRange(rowIndex, 1, 1, RESIDUAL_HEADERS.length).setValues([row]);
  _residualCache = null; // 書き換えたので読み直させる
}

// その日・その分類にログが1件も無い状態で初めて触るとき、
// 既存の集計セルの値を「内訳不明の記録」として退避しておく。
// これをしないと、ログ導入前の金額が再計算で消えてしまう。
function ensureResidual(monthWs, sheetName, date, category, cat, targetRow) {
  const { found } = findResidual(sheetName, date, category);
  if (found) return;
  const trio = monthWs.getRange(targetRow, cat.cashCol, 1, 3).getValues()[0];
  const memo = cat.memoCol ? (monthWs.getRange(targetRow, cat.memoCol).getValue() || '') : '';
  writeResidual(sheetName, date, category, {
    cash: typeof trio[0] === 'number' ? trio[0] : 0,
    card: typeof trio[1] === 'number' ? trio[1] : 0,
    cardType: trio[2] || '',
    memo: memo
  });
}

// 集計セルを「残高ベース + 有効なログ」から再計算して書き戻す（唯一の書き込み口）
function recalcCell(monthWs, sheetName, date, category, knownRow) {
  const cat = CATEGORIES.find(c => c.key === category);
  if (!cat) return null;
  const targetRow = knownRow || findDateRow(monthWs, date);
  if (targetRow === -1) return null;

  const { found } = findResidual(sheetName, date, category);
  const base = found || { cash: 0, card: 0, cardType: '', memo: '' };

  const items = getLogRows(sheetName).filter(r => r.date === date && r.category === category);

  let cash = base.cash;
  let card = base.card;
  const cardTypes = base.cardType ? [base.cardType] : [];
  const memos = base.memo ? [base.memo] : [];
  items.forEach(it => {
    if (it.paymentMethod === '現金') cash += it.amount;
    else {
      card += it.amount;
      if (it.cardType && cardTypes.indexOf(it.cardType) === -1) cardTypes.push(it.cardType);
    }
    if (it.memo) memos.push(it.memo);
  });

  const cardTypeText = cardTypes.join(', ');
  const memoText = memos.join(' / ');
  monthWs.getRange(targetRow, cat.cashCol, 1, 3).setValues([[cash, card, cardTypeText]]);
  if (cat.memoCol) monthWs.getRange(targetRow, cat.memoCol).setValue(memoText);

  invalidateMonthsCache();
  return { date, category, 現金: cash, カード: card, カード種類: cardTypeText, メモ: memoText };
}

// ログシート本体の読み出し（1リクエスト内では1回だけ実際に読む）
function readLogValues() {
  if (_logValuesCache) return _logValuesCache;
  const ws = getLogSheet();
  const lastRow = ws.getLastRow();
  const values = lastRow < 2 ? [] : ws.getRange(2, 1, lastRow - 1, LOG_HEADERS.length).getValues();
  _logValuesCache = { ws, values };
  return _logValuesCache;
}

// sheetName(月シート名)に属する、削除されていないログ行だけを取得
function getLogRows(sheetName) {
  const { values } = readLogValues();
  const rows = [];
  values.forEach((row, i) => {
    const rowSheetName = normalizeLogDateValue(row[1], 'yyyy年MM月');
    const rowDate = normalizeLogDateValue(row[2], 'yyyy/MM/dd');
    if (rowSheetName !== sheetName || row[9] === true) return;
    rows.push({
      rowIndex: i + 2,
      id: row[0], sheetName: rowSheetName, date: rowDate, category: row[3],
      paymentMethod: row[4], cardType: row[5] || '', amount: row[6] || 0,
      memo: row[7] || '', recordedAt: row[8]
    });
  });
  return rows;
}

function findLogRowById(id) {
  const { ws, values } = readLogValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === id) return { ws, rowIndex: i + 2, row: values[i] };
  }
  return null;
}

function updateLogItem(data) {
  const { id, amount, cardType, memo } = data;
  const found = findLogRowById(id);
  if (!found) return { error: '記録が見つかりません' };
  const { ws, rowIndex, row } = found;
  const [, rawSheetName, rawDate, category] = row;
  const sheetName = normalizeLogDateValue(rawSheetName, 'yyyy年MM月');
  const date = normalizeLogDateValue(rawDate, 'yyyy/MM/dd');

  const monthWs = getSheetCached(sheetName);
  if (!monthWs) return { error: '月シートが見つかりません' };

  // ログ行を更新してから、集計セルを丸ごと再計算する（差分加算はしない）
  ws.getRange(rowIndex, 6, 1, 3).setValues([[cardType || '', amount || 0, memo || '']]);
  row[5] = cardType || ''; row[6] = amount || 0; row[7] = memo || ''; // 読み込み済みの値も更新

  const updated = recalcCell(monthWs, sheetName, date, category);
  if (!updated) return { error: `再計算に失敗しました: ${date} / ${category}` };
  return { success: true, updated };
}

function deleteLogItem(data) {
  const { id } = data;
  const found = findLogRowById(id);
  if (!found) return { error: '記録が見つかりません' };
  const { ws, rowIndex, row } = found;
  const [, rawSheetName, rawDate, category] = row;
  const sheetName = normalizeLogDateValue(rawSheetName, 'yyyy年MM月');
  const date = normalizeLogDateValue(rawDate, 'yyyy/MM/dd');

  ws.getRange(rowIndex, 10).setValue(true);
  row[9] = true; // 読み込み済みの値も更新

  const monthWs = getSheetCached(sheetName);
  if (!monthWs) return { error: '月シートが見つかりません' };

  const updated = recalcCell(monthWs, sheetName, date, category);
  if (!updated) return { error: `再計算に失敗しました: ${date} / ${category}` };
  return { success: true, updated };
}

// 端末に貯めた未同期の記録をまとめて反映する。
// 1件ずつsaveEntryを呼ぶのに比べ、通信もロックも1回で済む。
// 各記録のidは端末側で採番したものをそのまま使うため、同じものを二重に
// 送ってしまっても既存idとして弾かれ、金額が重複することはない。
function syncEntries(data) {
  const entries = data.entries || [];
  if (entries.length === 0) return { success: true, results: [] };

  const existingIds = {};
  readLogValues().values.forEach(r => { existingIds[r[0]] = true; });

  const results = [];
  const newRows = [];
  const affected = {};

  entries.forEach(en => {
    const name = en.sheetName || getCurrentSheetName();
    let ws = getSheetCached(name);
    if (!ws) ws = createSheet(name);

    const cat = CATEGORIES.find(c => c.key === en.category);
    if (!cat) { results.push({ id: en.id, error: `カテゴリが見つかりません: ${en.category}` }); return; }

    const targetRow = findDateRow(ws, en.date);
    if (targetRow === -1) { results.push({ id: en.id, error: `日付が見つかりません: ${en.date}` }); return; }

    if (existingIds[en.id]) { results.push({ id: en.id, success: true, duplicate: true }); return; }

    ensureResidual(ws, name, en.date, en.category, cat, targetRow);
    newRows.push(buildLogRow({
      id: en.id, sheetName: name, date: en.date, category: en.category,
      paymentMethod: en.paymentMethod, cardType: en.cardType, amount: en.amount, memo: en.memo
    }));
    existingIds[en.id] = true;
    affected[name + '|' + en.date + '|' + en.category] = { name, date: en.date, category: en.category, row: targetRow };
    results.push({ id: en.id, success: true });
  });

  appendLogRows(newRows);

  // 影響のあった日・カテゴリだけ、最後に1回ずつ再計算する
  const updated = [];
  Object.keys(affected).forEach(k => {
    const a = affected[k];
    const u = recalcCell(getSheetCached(a.name), a.name, a.date, a.category, a.row);
    if (u) updated.push(u);
  });

  return { success: true, results, updated };
}

// 「それ以前の記録」(内訳の分からない過去分)だけを直接編集する。
// ログ明細には触れないので、同じ日の個別記録は保持される。
function updateResidual(data) {
  const { sheetName, date, category, cash, card } = data;
  const name = sheetName || getCurrentSheetName();
  const monthWs = getSheetCached(name);
  if (!monthWs) return { error: 'シートが見つかりません' };
  const cat = CATEGORIES.find(c => c.key === category);
  if (!cat) return { error: `カテゴリが見つかりません: ${category}` };
  const targetRow = findDateRow(monthWs, date);
  if (targetRow === -1) return { error: `日付が見つかりません: ${date}` };

  // 既存の残高ベースがあればカード種類/メモを引き継ぐ
  const { found } = findResidual(name, date, category);
  writeResidual(name, date, category, {
    cash: cash || 0,
    card: card || 0,
    cardType: found ? found.cardType : '',
    memo: found ? found.memo : ''
  });

  const updated = recalcCell(monthWs, name, date, category);
  if (!updated) return { error: `再計算に失敗しました: ${date} / ${category}` };
  return { success: true, updated };
}

// 月シート内で指定日付に対応する行番号を探す（見つからなければ-1）
// 日付列は1リクエスト中に何度も引くので、読んだ内容を使い回す
function findDateRow(ws, date) {
  const key = ws.getName();
  let dateCol = _dateRowCache[key];
  if (!dateCol) {
    const lastRow = ws.getLastRow();
    if (lastRow <= DATA_START_ROW) return -1;
    dateCol = ws.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW, 1).getValues();
    _dateRowCache[key] = dateCol;
  }
  for (let i = 0; i < dateCol.length; i++) {
    const cellDate = dateCol[i][0];
    const cellStr = cellDate instanceof Date
      ? Utilities.formatDate(cellDate, 'Asia/Tokyo', 'yyyy/MM/dd')
      : String(cellDate);
    if (cellStr === date) return DATA_START_ROW + i;
  }
  return -1;
}

// ============================================================
// データ取得
// ============================================================

function getMonthData(sheetName) {
  const name = sheetName || getCurrentSheetName();
  const ss = getSS();
  let ws = ss.getSheetByName(name);
  if (!ws) ws = createSheet(name);

  const lastRow = ws.getLastRow();
  const allData = ws.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, TOTAL_COLS).getValues();
  const budgetData = ws.getRange(BUDGET_ROW, 1, 1, TOTAL_COLS).getValues()[0];

  // 日付+カテゴリごとに個別記録をまとめておく（取引ログ由来）
  const logByDateCategory = {};
  getLogRows(name).forEach(item => {
    const k = item.date + '|' + item.category;
    if (!logByDateCategory[k]) logByDateCategory[k] = [];
    logByDateCategory[k].push({
      id: item.id,
      paymentMethod: item.paymentMethod,
      cardType: item.cardType,
      amount: item.amount,
      memo: item.memo,
      time: item.recordedAt instanceof Date
        ? Utilities.formatDate(item.recordedAt, 'Asia/Tokyo', 'HH:mm')
        : ''
    });
  });

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
        カード種類: row[cat.cardTypeCol - 1] || '',
        items: logByDateCategory[dateStr + '|' + cat.key] || []
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
  const ss = getSS();
  let ws = ss.getSheetByName(name);
  if (!ws) ws = createSheet(name);
  const budgetData = ws.getRange(BUDGET_ROW, 1, 1, TOTAL_COLS).getValues()[0];
  const budget = {};
  CATEGORIES.forEach(cat => {
    budget[cat.key] = budgetData[cat.cashCol - 1] || 0;
  });
  return { budget };
}

const MONTHS_CACHE_KEY = 'allMonthsData';
const MONTHS_CACHE_SEC = 300;

// 月別集計が変わる書き込みの後に呼ぶ
function invalidateMonthsCache() {
  CacheService.getScriptCache().remove(MONTHS_CACHE_KEY);
}

function getAllMonthsData() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(MONTHS_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const ss = getSS();
  const sheets = ss.getSheets();
  const result = [];
  sheets.forEach(ws => {
    const name = ws.getName();
    if (!/\d+年\d+月/.test(name)) return;
    const budget = {};
    const totals = {};
    // シート1枚につきAPI呼び出し1回にまとめる（旧: getLastRow + getRange×2 の3回）
    const values = ws.getDataRange().getValues();
    if (values.length < BUDGET_ROW) return;
    const budgetData = values[BUDGET_ROW - 1];
    const totalRowValues = values[values.length - 1];

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
  const payload = { months: result };
  try {
    cache.put(MONTHS_CACHE_KEY, JSON.stringify(payload), MONTHS_CACHE_SEC);
  } catch (err) {
    // キャッシュ上限(100KB)超過などは無視して通常応答
  }
  return payload;
}

// ============================================================
// データ書き込み
// ============================================================

function saveEntry(data) {
  const { sheetName, date, category, paymentMethod, cardType, amount, memo } = data;
  const name = sheetName || getCurrentSheetName();
  let ws = getSheetCached(name);
  if (!ws) ws = createSheet(name);

  const cat = CATEGORIES.find(c => c.key === category);
  if (!cat) return { error: `カテゴリが見つかりません: ${category}` };

  const targetRow = findDateRow(ws, date);
  if (targetRow === -1) return { error: `日付が見つかりません: ${date}` };

  // ログを積む前に、内訳の分からない既存分を残高ベースへ退避しておく
  ensureResidual(ws, name, date, category, cat, targetRow);

  const id = appendLogItem({ sheetName: name, date, category, paymentMethod, cardType, amount, memo });

  // 集計セルは「残高ベース + 有効なログ」から必ず再計算する（行番号は判明済み）
  const updated = recalcCell(ws, name, date, category, targetRow);
  if (!updated) return { error: `再計算に失敗しました: ${date} / ${category}` };

  // フロント側が再取得せずに画面を更新できるよう、確定後の値を返す
  return {
    success: true,
    item: {
      id,
      paymentMethod,
      cardType: cardType || '',
      amount,
      memo: memo || '',
      time: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH:mm')
    },
    updated
  };
}

function updateEntry(data) {
  const { sheetName, rowIndex, category, paymentMethod, cardType, cashAmount, cardAmount, memo } = data;
  const name = sheetName || getCurrentSheetName();
  const ss = getSS();
  const ws = ss.getSheetByName(name);
  if (!ws) return { error: 'シートが見つかりません' };

  const cat = CATEGORIES.find(c => c.key === category);
  if (!cat) return { error: `カテゴリが見つかりません: ${category}` };

  // 集計セルを直接編集する操作は「その日・その分類の内容をこの値で確定させる」意味とする。
  // 個別のログ明細を残したままにすると、集計セルとログの合計が食い違ってしまうため、
  // 該当するログをすべて無効化し、指定された値を残高ベースとして書き込んでから再計算する。
  const rawDate = ws.getRange(rowIndex, 1).getValue();
  const date = rawDate instanceof Date
    ? Utilities.formatDate(rawDate, 'Asia/Tokyo', 'yyyy/MM/dd')
    : String(rawDate);

  invalidateLogsFor(name, date, category);
  writeResidual(name, date, category, {
    cash: cashAmount || 0,
    card: cardAmount || 0,
    cardType: cardType || '',
    memo: memo || ''
  });

  const updated = recalcCell(ws, name, date, category);
  if (!updated) return { error: `再計算に失敗しました: ${date} / ${category}` };
  return { success: true, updated };
}

// 指定した日・分類のログ行をすべて無効化する（論理削除）
function invalidateLogsFor(sheetName, date, category) {
  const { ws, values } = readLogValues();
  if (values.length === 0) return;
  const flags = values.map(row => {
    const rowSheetName = normalizeLogDateValue(row[1], 'yyyy年MM月');
    const rowDate = normalizeLogDateValue(row[2], 'yyyy/MM/dd');
    const match = rowSheetName === sheetName && rowDate === date && row[3] === category;
    if (match) row[9] = true; // 読み込み済みの値も更新
    return [row[9]];
  });
  ws.getRange(2, 10, flags.length, 1).setValues(flags);
}

function updateBudget(data) {
  const { sheetName, budget } = data;
  const name = sheetName || getCurrentSheetName();
  const ss = getSS();
  let ws = ss.getSheetByName(name);
  if (!ws) ws = createSheet(name);

  CATEGORIES.forEach(cat => {
    if (budget[cat.key] !== undefined) {
      ws.getRange(BUDGET_ROW, cat.cashCol).setValue(budget[cat.key]);
    }
  });
  invalidateMonthsCache();
  return { success: true };
}

// ============================================================
// 月次シート自動生成チェック
// ============================================================

function checkAndCreateNewSheet() {
  const today = new Date();
  const sheetName = getCurrentSheetName();
  const ss = getSS();
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
