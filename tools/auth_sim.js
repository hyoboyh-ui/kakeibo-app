// gas/Code.gs の認証部分を、GASのAPI（Utilities / PropertiesService / CacheService 等）を
// シムして実際に走らせる検証用ハーネス。本番のスプレッドシートには一切触らない。
//
//   node tools/auth_sim.js
//
// 認証まわりを直したら必ずこれを通すこと。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'gas', 'Code.gs');
// 改行コードに依存しないよう、読み込み時にLFへ正規化する
const src = fs.readFileSync(SRC, 'utf8').split('\r\n').join('\n');

// 認証セクション〜doGet までを切り出す（シート操作は含めない）
const start = src.indexOf('// ============================================================\n// 認証');
const endMarker = "function doGet() {\n  return jsonOutput({ error: 'GETは利用できません' });\n}";
const end = src.indexOf(endMarker);
if (start < 0 || end < 0) throw new Error('切り出し位置が見つかりません');
const authCode = src.slice(start, end + endMarker.length);

// ---- GAS API のシム ------------------------------------------------
let NOW = Date.now();
let scriptProps = {};
let cacheStore = {};   // key -> { value, expiresAt }

const shim = `
const Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' },
  getUuid: () => __uuid(),
  computeDigest: (alg, value, charset) => __digest(value)
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
    get: (k) => { const e = __cache[k]; if (!e || e.expiresAt <= __now()) return null; return e.value; },
    put: (k, v, sec) => { __cache[k] = { value: String(v), expiresAt: __now() + sec * 1000 }; },
    remove: (k) => { delete __cache[k]; }
  })
};
const LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
const ContentService = {
  MimeType: { JSON: 'JSON' },
  createTextOutput: (t) => ({ setMimeType: () => t })
};
const Logger = { log: () => {} };
function resetRequestCaches() {}
`;

// WRITE_ACTIONS は認証セクションより前で定義されているので、実物を拾ってくる
const waLine = src.match(/^const WRITE_ACTIONS = .*$/m);
if (!waLine) throw new Error('WRITE_ACTIONS が見つかりません');

// ルーティング先はシート操作なのでスタブに差し替える
const stubbedAuth = authCode.replace(
  /function routeAction\(action, data\) \{[\s\S]*?\n\}/,
  'function routeAction(action, data) { return { ok: true, action: action }; }'
);

let uuidCounter = 0;
function __uuid() {
  uuidCounter++;
  return crypto.randomUUID();
}
function __digest(value) {
  const h = crypto.createHash('sha256');
  if (typeof value === 'string') h.update(value, 'utf8');
  else h.update(Buffer.from(value.map(b => b & 0xff)));
  // GASのByte[]はJavaのsigned byteなので -128..127 を返して本番に寄せる
  return Array.from(h.digest()).map(b => (b > 127 ? b - 256 : b));
}

const factory = new Function(
  '__props', '__cache', '__now', '__uuid', '__digest', 'Date',
  shim + '\n' + waLine[0] + '\n' + stubbedAuth + '\n' +
  'return { doPost, handleLogin, handleChangePassword, tokenIsValid, issueToken, readSessions, ' +
  'resetLoginLock, setupPassword, hashPassword, loginFailCount, revokeToken, MAX_SESSIONS, TOKEN_TTL_DAYS };'
);

class FakeDate extends Date {
  constructor(...args) { if (args.length === 0) super(NOW); else super(...args); }
  static now() { return NOW; }
}

const G = factory(scriptProps, cacheStore, () => NOW, __uuid, __digest, FakeDate);

// ---- テスト -----------------------------------------------------------
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + JSON.stringify(extra) : '')); }
}
const post = (body) => JSON.parse(G.doPost({ postData: { contents: JSON.stringify(body) } }));

console.log('\n[1] setupPassword 前は全部拒否される');
check('login は NO_PASSWORD', post({ action: 'login', password: 'x' }).code === 'NO_PASSWORD');
check('getMonthData は AUTH', post({ action: 'getMonthData' }).code === 'AUTH');

console.log('\n[2] setupPassword');
check('短すぎるパスワードは弾く', (() => { try { G.setupPassword('abc'); return false; } catch (e) { return true; } })());
G.setupPassword('kimura-2026');
check('PASSWORD_RECORD が保存される', !!scriptProps.PASSWORD_RECORD);
check('平文は保存されない', !JSON.stringify(scriptProps).includes('kimura-2026'));
const rec = JSON.parse(scriptProps.PASSWORD_RECORD);
check('ソルトがある', typeof rec.salt === 'string' && rec.salt.length >= 16);
check('ハッシュは64桁hex', /^[0-9a-f]{64}$/.test(rec.hash), rec.hash);

console.log('\n[3] ログイン');
check('間違ったパスワードは弾かれる', post({ action: 'login', password: 'wrong' }).code === 'BAD_PASSWORD');
const ok1 = post({ action: 'login', password: 'kimura-2026' });
check('正しいパスワードでトークンが出る', typeof ok1.token === 'string' && ok1.token.length === 64, ok1);
check('成功で失敗カウンタがリセットされる', G.loginFailCount() === 0);
check('有効期限は90日後', Math.round((ok1.expiresAt - NOW) / 86400000) === 90);

console.log('\n[4] トークン認証');
check('有効トークンなら通る', post({ action: 'getMonthData', token: ok1.token }).ok === true);
check('デタラメなトークンは弾く', post({ action: 'getMonthData', token: 'a'.repeat(64) }).code === 'AUTH');
check('トークン無しは弾く', post({ action: 'getMonthData' }).code === 'AUTH');
check('旧クライアント(secretのみ)は STALE_CLIENT',
  post({ action: 'getMonthData', secret: 'dummy-old-secret' }).code === 'STALE_CLIENT');
check('旧secretでは書き込めない',
  post({ action: 'saveEntry', secret: 'dummy-old-secret', amount: 999 }).code === 'STALE_CLIENT');

console.log('\n[5] 総当たり対策');
for (let i = 0; i < 9; i++) post({ action: 'login', password: 'guess' + i });
check('9回失敗ではまだロックされない', post({ action: 'login', password: 'kimura-2026' }).token !== undefined);
for (let i = 0; i < 10; i++) post({ action: 'login', password: 'guess' + i });
check('10回超でロックされる', post({ action: 'login', password: 'kimura-2026' }).code === 'LOCKED');
check('ロック中は正しいパスワードでも入れない', post({ action: 'login', password: 'kimura-2026' }).code === 'LOCKED');
G.resetLoginLock();
check('resetLoginLock で解除できる', post({ action: 'login', password: 'kimura-2026' }).token !== undefined);
NOW += 901 * 1000;
for (let i = 0; i < 11; i++) post({ action: 'login', password: 'guess' + i });
check('ロックは15分で自然に解ける', (() => { NOW += 901 * 1000; return post({ action: 'login', password: 'kimura-2026' }).token !== undefined; })());

console.log('\n[6] 有効期限と自動延長');
const t6 = post({ action: 'login', password: 'kimura-2026' }).token;
NOW += 89 * 86400000;
check('89日後も有効', post({ action: 'getMonthData', token: t6 }).ok === true);
check('残り30日を切ったので延長された',
  Math.round((G.readSessions()[t6] - NOW) / 86400000) === 90);
NOW += 91 * 86400000;
check('期限切れは弾かれる', post({ action: 'getMonthData', token: t6 }).code === 'AUTH');

console.log('\n[7] ログアウト');
const t7 = post({ action: 'login', password: 'kimura-2026' }).token;
check('ログアウト前は通る', post({ action: 'getMonthData', token: t7 }).ok === true);
post({ action: 'logout', token: t7 });
check('ログアウト後は弾かれる', post({ action: 'getMonthData', token: t7 }).code === 'AUTH');

console.log('\n[8] パスワード変更');
const tA = post({ action: 'login', password: 'kimura-2026' }).token;
const tB = post({ action: 'login', password: 'kimura-2026' }).token;   // 別端末
check('旧パスワードが違えば変更できない',
  post({ action: 'changePassword', token: tA, oldPassword: 'zzz', newPassword: 'newpass-1' }).code === 'BAD_PASSWORD');
check('短い新パスワードは弾く',
  !!post({ action: 'changePassword', token: tA, oldPassword: 'kimura-2026', newPassword: 'abc' }).error);
G.resetLoginLock();
const chg = post({ action: 'changePassword', token: tA, oldPassword: 'kimura-2026', newPassword: 'newpass-1' });
check('変更に成功し新トークンが返る', chg.ok === true && typeof chg.token === 'string');
check('変更した端末は使い続けられる', post({ action: 'getMonthData', token: chg.token }).ok === true);
check('他端末のトークンは無効になる', post({ action: 'getMonthData', token: tB }).code === 'AUTH');
check('旧パスワードではもう入れない', post({ action: 'login', password: 'kimura-2026' }).code === 'BAD_PASSWORD');
G.resetLoginLock();
check('新パスワードで入れる', post({ action: 'login', password: 'newpass-1' }).token !== undefined);

console.log('\n[9] セッション数の上限');
const tokens = [];
for (let i = 0; i < G.MAX_SESSIONS + 5; i++) {
  NOW += 1000;   // 期限に差をつけて「新しいものが残る」を確かめる
  tokens.push(post({ action: 'login', password: 'newpass-1' }).token);
}
check('保持数が上限で頭打ちになる', Object.keys(G.readSessions()).length <= G.MAX_SESSIONS,
  Object.keys(G.readSessions()).length);
check('最後にログインした端末は残っている', post({ action: 'getMonthData', token: tokens[tokens.length - 1] }).ok === true);
check('あふれた古い端末は落ちている', post({ action: 'getMonthData', token: tokens[0] }).code === 'AUTH');

console.log('\n[10] setupPassword のやり直し');
scriptProps.API_SECRET = 'old-legacy-secret';
const before = post({ action: 'login', password: 'newpass-1' }).token;
G.setupPassword('reset-pass-9');
check('旧API_SECRETは残す（別スクリプトが読んでいる可能性があるため）', 'API_SECRET' in scriptProps);
check('全端末がログアウトされる', post({ action: 'getMonthData', token: before }).code === 'AUTH');
G.resetLoginLock();
check('新しいパスワードで入れる', post({ action: 'login', password: 'reset-pass-9' }).token !== undefined);
check('前のパスワードでは入れない', post({ action: 'login', password: 'newpass-1' }).code === 'BAD_PASSWORD');

console.log('\n[11] ハッシュの性質');
const s = 'saltsaltsaltsalt';
check('同じ入力なら同じ結果', G.hashPassword('abc', s, 100) === G.hashPassword('abc', s, 100));
check('ソルトが違えば結果も違う', G.hashPassword('abc', s, 100) !== G.hashPassword('abc', 'other-salt-xxxx', 100));
check('反復回数が違えば結果も違う', G.hashPassword('abc', s, 100) !== G.hashPassword('abc', s, 101));
check('区切り文字で連結の曖昧さが無い', G.hashPassword('b', 'a', 50) !== G.hashPassword('', 'a:b', 50));

console.log('\n================================');
console.log(`  成功 ${pass} / 失敗 ${fail}`);
console.log('================================\n');
process.exit(fail ? 1 : 0);
