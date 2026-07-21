# 木村家 家計簿アプリ セットアップ手順

## 全体の流れ
1. Google スプレッドシートを作成
2. Google Apps Script をデプロイ
3. アプリの設定ファイルを更新
4. GitHub Pages に公開

---

## Step 1: Google スプレッドシートの作成

1. [Google スプレッドシート](https://sheets.google.com) を開く
2. 「空白のスプレッドシート」を新規作成
3. 名前を「木村家 家計簿」に変更
4. URLのスプレッドシートIDをコピーして控える
   - 例: `https://docs.google.com/spreadsheets/d/【ここがID】/edit`

---

## Step 2: Google Apps Script のセットアップ

1. スプレッドシートのメニュー「拡張機能」→「Apps Script」を開く
2. エディタが開いたら、既存のコードをすべて削除
3. `gas/Code.gs` の内容をすべてコピーして貼り付ける
4. ファイル上部の `SPREADSHEET_ID` を Step 1 でコピーしたIDに変更する
   ```
   const SPREADSHEET_ID = 'ここにIDを貼り付ける';
   ```
5. 「保存」（Ctrl+S）する

### Apps Script をデプロイする

1. 右上の「デプロイ」→「新しいデプロイ」をクリック
2. 歯車アイコン「種類の選択」→「ウェブアプリ」を選択
3. 以下のように設定：
   - 説明: `家計簿API`
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
4. 「デプロイ」をクリック
5. Googleアカウントの認証を求められたら「許可」する
6. 表示された「ウェブアプリのURL」をコピーして控える
   - 例: `https://script.google.com/macros/s/XXXX/exec`

### 月次自動シート生成のトリガーを設定

1. Apps Script エディタの左メニュー「トリガー（時計アイコン）」を開く
2. 「トリガーを追加」をクリック
3. 以下のように設定：
   - 実行する関数: `dailyCheck`
   - イベントのソース: 時間主導型
   - 時間の種類: 日タイマー
   - 時刻: 午前0時〜1時
4. 「保存」する

---

## Step 3: アプリの設定を更新

`js/app.js` を開いて、1行目付近の `GAS_URL` を更新する：

```javascript
const GAS_URL = 'Step 2 でコピーしたウェブアプリURL';
```

---

## Step 4: GitHub Pages に公開

### リポジトリを作成

1. [GitHub](https://github.com) にログイン
2. 右上「+」→「New repository」
3. Repository name: `kakeibo-app`（または任意の名前）
4. **Public** を選択（GitHub Pages 無料プランの要件）
5. 「Create repository」をクリック

### ファイルをアップロード

```bash
# ターミナル（PowerShell）で以下を実行
cd C:\Users\hyobo\kakeibo-app

git init
git add index.html css/ js/
git commit -m "初回コミット"
git branch -M main
git remote add origin https://github.com/【GitHubユーザー名】/kakeibo-app.git
git push -u origin main
```

### GitHub Pages を有効化

1. GitHubのリポジトリページ → 「Settings」タブ
2. 左メニュー「Pages」
3. Source: **Deploy from a branch**
4. Branch: **main** / **/ (root)**
5. 「Save」をクリック
6. 数分後にURL `https://【GitHubユーザー名】.github.io/kakeibo-app/` でアクセス可能になる

---

## Step 5: 初回ログイン・初期設定

1. スマホでアプリのURLを開く
2. **パスワードを設定**（初回は好きなパスワードを入力してログインするとそれが設定されます）
3. ホーム画面の「設定（⚙️）」タブ → 「月次予算の設定」で各カテゴリの予算を入力して「予算を保存」

---

## 毎月の使い方

- 支出が発生したら「＋」ボタンをタップ → カテゴリ・支払方法・金額を入力
- ホーム画面で各カテゴリの残高をリアルタイム確認
- 「履歴（📋）」タブで記録の修正
- 「グラフ（📊）」タブで月ごとの比較

毎月16日になると自動で新しい月のシートが作成されます。

---

## トラブルシューティング

| 症状 | 対処法 |
|---|---|
| データが保存されない | Apps Script のデプロイURLが正しいか確認 |
| 「アクセス拒否」エラー | Apps Script の「アクセスできるユーザー: 全員」を再確認 |
| グラフが表示されない | ブラウザがChart.js CDNに接続できるか確認 |
| パスワードを忘れた | スマホのブラウザ → 設定 → サイトデータ → kakeibo-app のデータを削除（リセット） |
