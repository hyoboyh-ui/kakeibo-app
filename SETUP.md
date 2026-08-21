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

`js/config.js` を開いて、`GAS_URL` を更新する：

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

## Step 5: パスワードを設定する（アプリを開く前に必須）

パスワードはアプリ側ではなくサーバー（Apps Script）に設定する。
これを済ませるまで、アプリは全リクエストを拒否する。

1. Apps Script エディタを開く
2. 関数を選ぶ欄で `setupPassword` を選び、エディタ上で一時的に次のように書いて実行する

   ```js
   function tmp() { setupPassword('家族で使うパスワード'); }
   ```

   （`tmp` を実行したあと、**書いたパスワードの行は必ず消してから保存する**。
   エディタの内容は版として残るため）
3. 家族にパスワードを口頭で伝える

パスワードを変えたいときは、アプリの「設定」タブ →「パスワード変更」から変更できる
（変更すると他の端末はログインし直しになる）。

## Step 6: 初回ログイン・初期設定

1. スマホでアプリのURLを開く
2. Step 5 で決めたパスワードでログインする
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
| パスワードを忘れた | Apps Script エディタで `setupPassword('新しいパスワード')` を実行して上書きする（全端末が再ログインになる） |
| 「ログインの失敗が続いたため…」と出て入れない | Apps Script エディタで `resetLoginLock()` を実行する（15分待っても解除される） |
| 「アプリが古いため接続できません」と出る | ブラウザで再読み込みする。ホーム画面に追加したアプリなら一度閉じて開き直す |
