'use strict';

(() => {
  const STORAGE_KEY = 'countAppData';
  const DEFAULT_LIMIT = 240;

  /* =========================================================
   * データ層
   * ========================================================= */

  // localStorageからデータを読み込む。存在しない／壊れている場合は初期データを返す
  function loadData() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { monthlyLimit: DEFAULT_LIMIT, records: [] };
    }
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.monthlyLimit !== 'number' || !Array.isArray(parsed.records)) {
        throw new Error('invalid data shape');
      }
      return parsed;
    } catch (error) {
      console.warn('保存データの読み込みに失敗したため、初期データを使用します。', error);
      return { monthlyLimit: DEFAULT_LIMIT, records: [] };
    }
  }

  // データをlocalStorageに保存する
  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  // records内のamountを合計し、現在値を算出する
  function getCurrentCount(data) {
    return data.records.reduce((sum, record) => sum + record.amount, 0);
  }

  // 使用率（%）を算出する
  function calcUsageRate(currentCount, monthlyLimit) {
    if (!monthlyLimit) return 0;
    return Math.round((currentCount / monthlyLimit) * 100);
  }

  // 履歴レコード用のID（簡易的な一意文字列）を生成する
  function generateId() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // 新しい操作履歴をdata.recordsに追加する
  function addRecord(data, type, amount) {
    const now = new Date();
    const record = {
      id: generateId(),
      date: now.toISOString().slice(0, 10), // YYYY-MM-DD（将来のカレンダー集計用）
      timestamp: now.toISOString(),
      type, // 'increment' | 'decrement' | 'manual' | 'reset'
      amount
    };
    data.records.push(record);
    return data;
  }

  /* =========================================================
   * 状態
   * ========================================================= */

  let appData = loadData();

  /* =========================================================
   * DOM参照
   * ========================================================= */

  const els = {
    currentCount: document.getElementById('currentCount'),
    monthlyLimit: document.getElementById('monthlyLimit'),
    usageRate: document.getElementById('usageRate'),
    progressFill: document.getElementById('progressFill'),
    decrementBtn: document.getElementById('decrementBtn'),
    incrementBtn: document.getElementById('incrementBtn'),
    customAmount: document.getElementById('customAmount'),
    addCustomBtn: document.getElementById('addCustomBtn'),
    inputError: document.getElementById('inputError'),
    resetBtn: document.getElementById('resetBtn'),
    dialogOverlay: document.getElementById('resetDialogOverlay'),
    cancelResetBtn: document.getElementById('cancelResetBtn'),
    confirmResetBtn: document.getElementById('confirmResetBtn')
  };

  /* =========================================================
   * 操作層
   * ========================================================= */

  // +1
  function increment() {
    addRecord(appData, 'increment', 1);
    saveData(appData);
    render();
  }

  // -1（現在値が0以下のときは何もしない）
  function decrement() {
    const current = getCurrentCount(appData);
    if (current <= 0) return;
    addRecord(appData, 'decrement', -1);
    saveData(appData);
    render();
  }

  // 任意数追加
  function addCustomAmount(rawValue) {
    const validation = validateCustomInput(rawValue);
    if (!validation.valid) {
      showInputError(validation.message);
      return;
    }
    hideInputError();
    addRecord(appData, 'manual', validation.value);
    saveData(appData);
    els.customAmount.value = '';
    render();
  }

  // リセットボタン押下：確認ダイアログを表示するのみ（実際のリセットはconfirmResetで行う）
  function requestReset() {
  console.log('reset clicked');
  showResetDialog();
}

  // ダイアログで「リセットする」を選択した場合の処理
  function confirmReset() {
    const current = getCurrentCount(appData);
    if (current !== 0) {
      // 現在値を打ち消す負の値を記録することで、履歴を残したまま現在値を0にする
      addRecord(appData, 'reset', -current);
      saveData(appData);
    }
    hideResetDialog();
    render();
  }

  // ダイアログで「キャンセル」を選択した場合の処理
  function cancelReset() {
    hideResetDialog();
  }

  /* =========================================================
   * 入力検証
   * ========================================================= */

  function validateCustomInput(rawValue) {
    const trimmed = String(rawValue).trim();

    if (trimmed === '') {
      return { valid: false, message: '枚数を入力してください。' };
    }

    const value = Number(trimmed);

    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return { valid: false, message: '半角の整数で入力してください。' };
    }
    if (value <= 0) {
      return { valid: false, message: '1以上の数値を入力してください。' };
    }
    if (value > 999) {
      return { valid: false, message: '999以下の数値を入力してください。' };
    }

    return { valid: true, value };
  }

  function showInputError(message) {
    els.inputError.textContent = message;
    els.inputError.hidden = false;
  }

  function hideInputError() {
    els.inputError.hidden = true;
    els.inputError.textContent = '';
  }

  /* =========================================================
   * 画面描画層
   * ========================================================= */

  function render() {
    renderCount();
    renderProgressBar();
  }

  // 現在値・上限値・使用率の数値表示を更新する
  function renderCount() {
    const current = getCurrentCount(appData);
    const rate = calcUsageRate(current, appData.monthlyLimit);

    els.currentCount.textContent = current;
    els.monthlyLimit.textContent = appData.monthlyLimit;
    els.usageRate.textContent = rate;
    els.decrementBtn.disabled = current <= 0;
  }

  // 進捗バーの幅と配色（通常／警告／上限超過）を更新する
  function renderProgressBar() {
    const current = getCurrentCount(appData);
    const rate = calcUsageRate(current, appData.monthlyLimit);
    const visualWidth = Math.min(Math.max(rate, 0), 100);

    els.progressFill.style.width = visualWidth + '%';

    els.progressFill.classList.remove('is-warning', 'is-over');
    if (rate >= 100) {
      els.progressFill.classList.add('is-over');
    } else if (rate >= 80) {
      els.progressFill.classList.add('is-warning');
    }
  }

  /* =========================================================
   * ダイアログ制御
   * ========================================================= */

  let lastFocusedElement = null;

  function showResetDialog() {
  lastFocusedElement = document.activeElement;
  els.dialogOverlay.classList.add('is-open');
  els.cancelResetBtn.focus();
}

  function hideResetDialog() {
  els.dialogOverlay.classList.remove('is-open');
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
  }
}

  /* =========================================================
   * 初期化
   * ========================================================= */

  function initApp() {
    render();

    els.incrementBtn.addEventListener('click', increment);
    els.decrementBtn.addEventListener('click', decrement);

    els.addCustomBtn.addEventListener('click', () => {
      addCustomAmount(els.customAmount.value);
    });

    els.customAmount.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addCustomAmount(els.customAmount.value);
      }
    });

    els.resetBtn.addEventListener('click', requestReset);
    els.cancelResetBtn.addEventListener('click', cancelReset);
    els.confirmResetBtn.addEventListener('click', confirmReset);

    els.dialogOverlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        cancelReset();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();
