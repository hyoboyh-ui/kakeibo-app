// ============================================================
// 接続設定
//
// このアプリはGitHub Pages（このリポジトリ自体）で配信しているため、
// このファイルもコミットする必要がある（除外すると本番で404になる）。
//
// なお API_SECRET は静的サイトである以上ブラウザから読み取れるので、
// 秘密として守れるものではない。URLを知っただけの第三者や外部サイトからの
// 誘導を弾くための仕切りであり、それ以上の強度は無い。
// 本格的な保護が必要な場合はGAS側でGoogleアカウント認証等に切り替えること。
// ============================================================

const GAS_URL = 'https://script.google.com/macros/s/AKfycbylz_Wl5dAR6hHz0DxIE-gWpAWxGbkzQZKNtkCQ41w_5gdqPZvyTcJ0TAexsTsQ1x0x/exec';

// Apps Scriptエディタで setupApiSecret() を1回実行し、出力された文字列を貼り付ける
const API_SECRET = '911aa189-4e22-4d58-ae19-7a93eee97098aa434cb3817e4a70864adce70b2f589c';
