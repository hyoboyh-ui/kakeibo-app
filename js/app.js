// ============================================================
// 木村家 家計簿アプリ
// ============================================================

const GAS_URL = 'https://script.google.com/macros/s/AKfycbylz_Wl5dAR6hHz0DxIE-gWpAWxGbkzQZKNtkCQ41w_5gdqPZvyTcJ0TAexsTsQ1x0x/exec'; // デプロイ後に置き換え

const CATEGORIES = [
  { key: '食費',             hasMemo: false },
  { key: '雑費',             hasMemo: false },
  { key: '交際費(交通費)',   hasMemo: false },
  { key: '交際費(外食)',     hasMemo: false },
  { key: '保険代',           hasMemo: false },
  { key: '光熱費(ガス電気)', hasMemo: false },
  { key: '光熱費(携帯ネット)', hasMemo: false },
  { key: '水道代',           hasMemo: false },
  { key: '緊急出費',         hasMemo: true  },
  { key: '固定費',           hasMemo: false }
];

const CARD_TYPES = ['三井住友', 'セゾン', 'JCB', 'その他'];

// ============================================================
// STATE
// ============================================================

const state = {
  monthData: null,
  currentSheet: null,
  availableSheets: [],
  selectedDate: null,
  editingEntry: null,
  chartData: null,
  currentView: 'dashboard'
};

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  if (isLoggedIn()) {
    showApp();
  } else {
    document.getElementById('login-screen').style.display = 'flex';
  }

  document.getElementById('login-form').addEventListener('submit', handleLogin);
  setupNav();
  setupFab();
  setupModal();
});

// ============================================================
// AUTH
// ============================================================

function isLoggedIn() {
  return sessionStorage.getItem('kakeibo_auth') === getStoredHash();
}

function getStoredHash() {
  return localStorage.getItem('kakeibo_pwd_hash') || '';
}

async function sha256(msg) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleLogin(e) {
  e.preventDefault();
  const pwd = document.getElementById('pwd-input').value;
  const hash = await sha256(pwd);
  const stored = getStoredHash();

  if (!stored) {
    // 初回：パスワード設定
    localStorage.setItem('kakeibo_pwd_hash', hash);
    sessionStorage.setItem('kakeibo_auth', hash);
    showApp();
    return;
  }

  if (hash === stored) {
    sessionStorage.setItem('kakeibo_auth', hash);
    showApp();
  } else {
    document.getElementById('login-error').textContent = 'パスワードが違います';
  }
}

// ============================================================
// APP INIT
// ============================================================

async function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  const app = document.getElementById('app-screen');
  app.style.display = 'flex';

  showLoading(true);
  await loadCurrentMonth();
  showLoading(false);
  renderDashboard();
}

async function loadCurrentMonth(sheetName) {
  try {
    const res = await gasCall({ action: 'getMonthData', sheetName: sheetName || null });
    state.monthData = res;
    state.currentSheet = res.sheetName;
    document.getElementById('header-title').textContent = res.sheetName + ' 家計簿';
    updateAvailableSheets();
  } catch (err) {
    showToast('データ読み込みエラー: ' + err.message);
  }
}

function updateAvailableSheets() {
  // シート切替用（グラフ画面などで使用）
}

// ============================================================
// NAV
// ============================================================

function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      switchView(view);
    });
  });
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== `view-${view}`));

  if (view === 'dashboard') renderDashboard();
  if (view === 'history')   renderHistory();
  if (view === 'chart')     renderChart();
  if (view === 'settings')  renderSettings();
}

// ============================================================
// DASHBOARD
// ============================================================

function renderDashboard() {
  const container = document.getElementById('budget-list');
  if (!state.monthData) return;

  const { entries, budget } = state.monthData;

  // カテゴリ別合計を計算
  const totals = {};
  CATEGORIES.forEach(cat => { totals[cat.key] = 0; });
  entries.forEach(entry => {
    CATEGORIES.forEach(cat => {
      const d = entry[cat.key];
      if (d) totals[cat.key] += (d.現金 || 0) + (d.カード || 0);
    });
  });

  container.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const budgetAmt = budget[cat.key] || 0;
    const spent = totals[cat.key] || 0;
    const remaining = budgetAmt - spent;
    const pct = budgetAmt > 0 ? Math.min((spent / budgetAmt) * 100, 100) : 0;
    const isOver = remaining < 0;
    const fillClass = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : '';

    const el = document.createElement('div');
    el.className = 'budget-item';
    el.innerHTML = `
      <div class="budget-header">
        <span class="budget-label">${cat.key}</span>
        <span class="budget-amount${isOver ? ' over' : ''}">
          ${fmt(spent)} / ${budgetAmt > 0 ? fmt(budgetAmt) : '未設定'}円
        </span>
      </div>
      ${budgetAmt > 0 ? `
      <div class="progress-bar">
        <div class="progress-fill ${fillClass}" style="width:${pct}%"></div>
      </div>
      <div class="budget-remaining${isOver ? ' over' : ''}">
        ${isOver ? `超過 ¥${fmt(-remaining)}` : `残り ¥${fmt(remaining)}`}
      </div>` : ''}
    `;
    container.appendChild(el);
  });
}

// ============================================================
// HISTORY
// ============================================================

function renderHistory() {
  const container = document.getElementById('history-list');
  if (!state.monthData) return;

  const { entries } = state.monthData;
  container.innerHTML = '';

  // 入力済みの行だけ表示
  const filled = entries.filter(entry =>
    CATEGORIES.some(cat => {
      const d = entry[cat.key];
      return d && ((d.現金 || 0) + (d.カード || 0)) > 0;
    })
  ).reverse();

  if (filled.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <p>まだ記録がありません</p>
    </div>`;
    return;
  }

  filled.forEach(entry => {
    const group = document.createElement('div');
    group.className = 'day-group';

    const dateParts = String(entry.date).replace(/\//g, '-');
    const d = new Date(dateParts);
    const dayClass = d.getDay() === 6 ? 'sat' : d.getDay() === 0 ? 'sun' : '';
    const isToday = isTodayDate(entry.date);

    group.innerHTML = `
      <div class="day-header">
        <span class="day-date">${formatDate(entry.date)}</span>
        <span class="day-badge ${dayClass}">${entry.day}</span>
        ${isToday ? '<span class="today-chip">今日</span>' : ''}
      </div>
    `;

    CATEGORIES.forEach(cat => {
      const d = entry[cat.key];
      if (!d || ((d.現金 || 0) + (d.カード || 0)) === 0) return;

      const hasCash = (d.現金 || 0) > 0;
      const hasCard = (d.カード || 0) > 0;
      const item = document.createElement('div');
      item.className = 'entry-item';
      item.innerHTML = `
        <div style="flex:1">
          <div class="entry-cat">${cat.key}</div>
          ${d.カード種類 ? `<div class="entry-cat-sub">${d.カード種類}</div>` : ''}
          ${d.メモ ? `<div class="entry-cat-sub">📝 ${d.メモ}</div>` : ''}
        </div>
        <div class="entry-amount">
          ${hasCash ? `<div>¥${fmt(d.現金)} <span class="payment-badge badge-cash">現金</span></div>` : ''}
          ${hasCard ? `<div>¥${fmt(d.カード)} <span class="payment-badge badge-card">カード</span></div>` : ''}
        </div>
        <div style="font-size:18px;color:var(--text-sub);margin-left:4px">›</div>
      `;
      item.addEventListener('click', () => openEditModal(entry, cat.key));
      group.appendChild(item);
    });

    container.appendChild(group);
  });
}

// ============================================================
// CHART
// ============================================================

let chartInstance = null;

async function renderChart() {
  const container = document.getElementById('chart-container');
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';

  try {
    const res = await gasCall({ action: 'getAllMonths' });
    state.chartData = res.months;
    renderBarChart('total');
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>データ取得エラー</p></div>`;
  }
}

function renderBarChart(mode) {
  const container = document.getElementById('chart-container');
  const months = state.chartData;
  if (!months || months.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>データがありません</p></div>`;
    return;
  }

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  container.innerHTML = '<canvas id="main-chart"></canvas>';

  const labels = months.map(m => m.sheetName.replace('年', '/').replace('月', ''));
  let datasets;

  if (mode === 'total') {
    // 月ごとの総支出
    datasets = [{
      label: '総支出',
      data: months.map(m => CATEGORIES.reduce((s, cat) => s + (m.totals[cat.key] || 0), 0)),
      backgroundColor: '#4A90D9'
    }];
  } else {
    // カテゴリ別積み上げ
    const colors = ['#4A90D9','#48BB78','#F6AD55','#E53E3E','#9F7AEA','#38B2AC','#ED64A6','#ECC94B','#667EEA','#FC8181'];
    datasets = CATEGORIES.map((cat, i) => ({
      label: cat.key,
      data: months.map(m => m.totals[cat.key] || 0),
      backgroundColor: colors[i % colors.length]
    }));
  }

  chartInstance = new Chart(document.getElementById('main-chart'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { display: mode === 'category', position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ¥${fmt(ctx.raw)}` } }
      },
      scales: {
        x: { stacked: mode === 'category', ticks: { font: { size: 11 } } },
        y: {
          stacked: mode === 'category',
          ticks: { callback: v => '¥' + fmt(v), font: { size: 11 } }
        }
      }
    }
  });
}

// ============================================================
// SETTINGS
// ============================================================

function renderSettings() {
  renderBudgetInputs();
}

function renderBudgetInputs() {
  const container = document.getElementById('budget-inputs');
  container.innerHTML = '';
  const budget = state.monthData?.budget || {};

  CATEGORIES.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'budget-input-row';
    row.innerHTML = `
      <label class="budget-input-label">${cat.key}</label>
      <input type="number" class="budget-input-field" data-cat="${cat.key}"
        value="${budget[cat.key] || ''}" placeholder="0" inputmode="numeric">
    `;
    container.appendChild(row);
  });
}

async function saveBudget() {
  const budget = {};
  document.querySelectorAll('.budget-input-field').forEach(el => {
    budget[el.dataset.cat] = parseInt(el.value) || 0;
  });
  showLoading(true);
  try {
    await gasCall({ action: 'updateBudget', sheetName: state.currentSheet, budget });
    await loadCurrentMonth(state.currentSheet);
    showToast('予算を保存しました');
  } catch (err) {
    showToast('保存エラー: ' + err.message);
  }
  showLoading(false);
}

async function changePassword() {
  const oldPwd = document.getElementById('old-pwd').value;
  const newPwd = document.getElementById('new-pwd').value;
  if (!oldPwd || !newPwd) { showToast('パスワードを入力してください'); return; }

  const oldHash = await sha256(oldPwd);
  if (oldHash !== getStoredHash()) { showToast('現在のパスワードが違います'); return; }

  const newHash = await sha256(newPwd);
  localStorage.setItem('kakeibo_pwd_hash', newHash);
  sessionStorage.setItem('kakeibo_auth', newHash);
  document.getElementById('old-pwd').value = '';
  document.getElementById('new-pwd').value = '';
  showToast('パスワードを変更しました');
}

// ============================================================
// ENTRY FORM (Modal)
// ============================================================

let entryFormState = {
  date: null,
  category: null,
  payment: null,
  cardType: null
};

function setupFab() {
  document.getElementById('fab').addEventListener('click', openEntryModal);
}

function openEntryModal() {
  entryFormState = { date: todayString(), category: null, payment: null, cardType: null };
  state.editingEntry = null;
  document.getElementById('modal-title').textContent = '支出を記録';
  renderEntryForm();
  openModal();
}

function openEditModal(entry, categoryKey) {
  const cat = CATEGORIES.find(c => c.key === categoryKey);
  const d = entry[categoryKey];
  state.editingEntry = { entry, categoryKey };
  entryFormState = {
    date: normalizeDate(entry.date),
    category: categoryKey,
    payment: null,
    cardType: d?.カード種類 || null
  };
  document.getElementById('modal-title').textContent = '記録を修正';
  renderEditForm(entry, cat, d);
  openModal();
}

function renderEntryForm() {
  const body = document.getElementById('modal-body');

  // 日付ストリップ生成
  const dates = getMonthDates();
  const todayStr = todayString();

  body.innerHTML = `
    <div class="form-group">
      <label class="form-label">日付</label>
      <div class="date-strip" id="date-strip"></div>
    </div>
    <div class="form-group">
      <label class="form-label">カテゴリ</label>
      <select class="form-control" id="cat-select">
        <option value="">選択してください</option>
        ${CATEGORIES.map(c => `<option value="${c.key}">${c.key}</option>`).join('')}
      </select>
    </div>
    <div id="payment-group" class="hidden">
      <div class="form-group">
        <label class="form-label">支払方法</label>
        <div class="radio-group">
          <button class="radio-btn" data-payment="現金" onclick="selectPayment('現金')">💴 現金</button>
          <button class="radio-btn" data-payment="カード" onclick="selectPayment('カード')">💳 カード</button>
        </div>
      </div>
    </div>
    <div id="card-type-group" class="form-group hidden">
      <label class="form-label">カードの種類</label>
      <select class="form-control" id="card-type-select">
        ${CARD_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
      </select>
      <div id="other-card-group" class="hidden mt-4">
        <input type="text" class="form-control" id="other-card-input" placeholder="カード名を入力">
      </div>
    </div>
    <div id="amount-group" class="form-group hidden">
      <label class="form-label">金額</label>
      <input type="number" class="form-control" id="amount-input" placeholder="0" inputmode="numeric">
    </div>
    <div id="memo-group" class="form-group hidden">
      <label class="form-label">メモ</label>
      <input type="text" class="form-control" id="memo-input" placeholder="内容を入力（任意）">
    </div>
    <div id="submit-group" class="hidden">
      <button class="btn btn-primary" onclick="submitEntry()">保存する</button>
    </div>
  `;

  // 日付ストリップ
  const strip = document.getElementById('date-strip');
  dates.forEach(d => {
    const chip = document.createElement('div');
    chip.className = 'date-chip' + (d.day === 6 ? ' sat' : d.day === 0 ? ' sun' : '') + (d.str === todayStr ? ' selected' : '');
    chip.innerHTML = `<span class="chip-day">${d.dayJp}</span><span class="chip-date">${d.dd}</span>`;
    chip.addEventListener('click', () => {
      document.querySelectorAll('.date-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      entryFormState.date = d.str;
    });
    strip.appendChild(chip);
  });
  entryFormState.date = todayStr;

  // スクロールして今日にフォーカス
  setTimeout(() => {
    const sel = strip.querySelector('.selected');
    if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, 50);

  // カテゴリ選択イベント
  document.getElementById('cat-select').addEventListener('change', e => {
    entryFormState.category = e.target.value;
    entryFormState.payment = null;
    updatePaymentVisibility();
  });

  document.getElementById('card-type-select')?.addEventListener('change', e => {
    entryFormState.cardType = e.target.value;
    document.getElementById('other-card-group').classList.toggle('hidden', e.target.value !== 'その他');
  });
}

function renderEditForm(entry, cat, d) {
  const body = document.getElementById('modal-body');
  const cashAmt = d?.現金 || 0;
  const cardAmt = d?.カード || 0;
  const cardType = d?.カード種類 || '';
  const memo = d?.メモ || '';

  body.innerHTML = `
    <div class="card mb-0" style="margin-bottom:16px;background:#F7F8FC">
      <div style="font-size:13px;color:var(--text-sub)">${formatDate(entry.date)} (${entry.day})</div>
      <div style="font-size:17px;font-weight:700;margin-top:4px">${cat.key}</div>
    </div>
    <div class="form-group">
      <label class="form-label">現金</label>
      <input type="number" class="form-control" id="edit-cash" value="${cashAmt || ''}" placeholder="0" inputmode="numeric">
    </div>
    <div class="form-group">
      <label class="form-label">カード</label>
      <input type="number" class="form-control" id="edit-card" value="${cardAmt || ''}" placeholder="0" inputmode="numeric">
    </div>
    <div class="form-group">
      <label class="form-label">カードの種類</label>
      <select class="form-control" id="edit-card-type">
        <option value="">なし</option>
        ${CARD_TYPES.map(t => `<option value="${t}" ${cardType === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <div id="edit-other-group" class="${cardType === 'その他' ? '' : 'hidden'} mt-4">
        <input type="text" class="form-control" id="edit-other-input" value="${cardType === 'その他' ? '' : ''}" placeholder="カード名を入力">
      </div>
    </div>
    ${cat.hasMemo ? `
    <div class="form-group">
      <label class="form-label">メモ</label>
      <input type="text" class="form-control" id="edit-memo" value="${memo}" placeholder="内容">
    </div>` : ''}
    <button class="btn btn-primary" onclick="submitEdit()">更新する</button>
    <button class="btn btn-danger" onclick="clearEntry()" style="margin-top:10px">この項目をクリア</button>
  `;

  document.getElementById('edit-card-type')?.addEventListener('change', e => {
    document.getElementById('edit-other-group').classList.toggle('hidden', e.target.value !== 'その他');
  });
}

function selectPayment(method) {
  entryFormState.payment = method;
  if (method === 'カード') {
    const sel = document.getElementById('card-type-select');
    entryFormState.cardType = sel ? sel.value : CARD_TYPES[0];
  } else {
    entryFormState.cardType = null;
  }
  document.querySelectorAll('[data-payment]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.payment === method);
  });
  updatePaymentVisibility();
}

function updatePaymentVisibility() {
  const hasCat = !!entryFormState.category;
  const hasPay = !!entryFormState.payment;

  document.getElementById('payment-group').classList.toggle('hidden', !hasCat);
  document.getElementById('card-type-group').classList.toggle('hidden', !(hasPay && entryFormState.payment === 'カード'));
  document.getElementById('amount-group').classList.toggle('hidden', !hasPay);

  const cat = CATEGORIES.find(c => c.key === entryFormState.category);
  document.getElementById('memo-group')?.classList.toggle('hidden', !(hasPay && cat?.hasMemo));
  document.getElementById('submit-group').classList.toggle('hidden', !hasPay);
}

async function submitEntry() {
  const { date, category, payment, cardType } = entryFormState;
  const amount = parseInt(document.getElementById('amount-input').value) || 0;
  const memo = document.getElementById('memo-input')?.value || '';

  let resolvedCardType = cardType;
  if (cardType === 'その他') {
    resolvedCardType = document.getElementById('other-card-input')?.value || 'その他';
  }

  if (!date || !category || !payment || !amount) {
    showToast('すべての項目を入力してください');
    return;
  }

  showLoading(true);
  try {
    await gasCall({
      action: 'saveEntry',
      sheetName: state.currentSheet,
      date, category,
      paymentMethod: payment,
      cardType: resolvedCardType,
      amount,
      memo
    });
    await loadCurrentMonth(state.currentSheet);
    closeModal();
    showToast('記録しました ✓');
    if (state.currentView === 'dashboard') renderDashboard();
    if (state.currentView === 'history')   renderHistory();
  } catch (err) {
    showToast('保存エラー: ' + err.message);
  }
  showLoading(false);
}

async function submitEdit() {
  const { entry, categoryKey } = state.editingEntry;
  const cashAmount = parseInt(document.getElementById('edit-cash').value) || 0;
  const cardAmount = parseInt(document.getElementById('edit-card').value) || 0;
  let cardType = document.getElementById('edit-card-type').value;
  if (cardType === 'その他') cardType = document.getElementById('edit-other-input')?.value || 'その他';
  const cat = CATEGORIES.find(c => c.key === categoryKey);
  const memo = cat?.hasMemo ? (document.getElementById('edit-memo')?.value || '') : '';

  showLoading(true);
  try {
    await gasCall({
      action: 'updateEntry',
      sheetName: state.currentSheet,
      rowIndex: entry.rowIndex,
      category: categoryKey,
      cashAmount, cardAmount, cardType, memo
    });
    await loadCurrentMonth(state.currentSheet);
    closeModal();
    showToast('更新しました ✓');
    renderHistory();
    if (state.currentView === 'dashboard') renderDashboard();
  } catch (err) {
    showToast('更新エラー: ' + err.message);
  }
  showLoading(false);
}

async function clearEntry() {
  if (!confirm('この項目をクリアしますか？')) return;
  const { entry, categoryKey } = state.editingEntry;
  const cat = CATEGORIES.find(c => c.key === categoryKey);

  showLoading(true);
  try {
    await gasCall({
      action: 'updateEntry',
      sheetName: state.currentSheet,
      rowIndex: entry.rowIndex,
      category: categoryKey,
      cashAmount: 0, cardAmount: 0, cardType: '', memo: ''
    });
    await loadCurrentMonth(state.currentSheet);
    closeModal();
    showToast('クリアしました');
    renderHistory();
    if (state.currentView === 'dashboard') renderDashboard();
  } catch (err) {
    showToast('エラー: ' + err.message);
  }
  showLoading(false);
}

// ============================================================
// MODAL
// ============================================================

function setupModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  });
}

function openModal() {
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

// ============================================================
// UTILITIES
// ============================================================

async function gasCall(payload) {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

function fmt(n) {
  return Number(n).toLocaleString('ja-JP');
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
}

function normalizeDate(d) {
  if (!d) return todayString();
  return String(d).replace(/-/g, '/').substring(0, 10);
}

function isTodayDate(d) {
  return normalizeDate(d) === todayString();
}

function formatDate(d) {
  const s = normalizeDate(d);
  const [y, m, dd] = s.split('/');
  return `${m}月${dd}日`;
}

function getMonthDates() {
  if (state.monthData?.entries?.length) {
    return state.monthData.entries.map(e => {
      const s = normalizeDate(e.date);
      const d = new Date(s);
      return { str: s, dd: String(d.getDate()), day: d.getDay(), dayJp: ['日','月','火','水','木','金','土'][d.getDay()] };
    });
  }
  // GAS未接続時は現在の請求期間の日付を生成
  const today = new Date();
  const day = today.getDate();
  let year = today.getFullYear(), month = today.getMonth();
  const startDay = day >= 16 ? 16 : 16;
  const start = new Date(day >= 16 ? year : (month === 0 ? year - 1 : year), day >= 16 ? month : (month === 0 ? 11 : month - 1), 16);
  const dates = [];
  for (let i = 0; i < 31; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i > 0 && d.getDate() > 15 && d.getMonth() !== start.getMonth()) break;
    const s = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    dates.push({ str: s, dd: String(d.getDate()), day: d.getDay(), dayJp: ['日','月','火','水','木','金','土'][d.getDay()] });
    if (d.getDate() === 15 && d.getMonth() !== start.getMonth()) break;
  }
  return dates;
}

function showLoading(show) {
  document.getElementById('loading-overlay').classList.toggle('show', show);
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
