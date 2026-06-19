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

  // 残り枚数を算出する
  function getRemainingCount(currentCount, monthlyLimit) {
    return monthlyLimit - currentCount;
  }

  // 履歴レコード用のID（簡易的な一意文字列）を生成する
  function generateId() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // 新しい操作履歴をdata.recordsに追加する
  // dateKeyは呼び出し側が必ず指定する（このタイミングで日付の自動生成は行わない）
  function addRecord(data, type, amount, dateKey) {
    const now = new Date();
    const record = {
      id: generateId(),
      date: dateKey, // YYYY-MM-DD（呼び出し側が指定した対象日）
      timestamp: now.toISOString(),
      type, // 'increment' | 'decrement' | 'manual' | 'reset'
      amount
    };
    data.records.push(record);
    return data;
  }

  // 日付（Dateオブジェクト）を records[].date と同じ形式（YYYY-MM-DD）の文字列に変換する
  // ※ record.date はこの形式（toISOString().slice(0, 10)）で保存されるため、
  //   カレンダー側で日付キーを照合する際も同じ変換方式を用いて整合性を保つ
  function formatDateKey(date) {
    return date.toISOString().slice(0, 10);
  }

  // 「今日」の日付キー（YYYY-MM-DD）を取得する
  // 正午（12:00）に固定して生成することで、タイムゾーンによる
  // toISOString()変換時の日付ズレ（前日／翌日にずれる現象）を防ぐ
  function getTodayKey() {
    const now = new Date();
    return formatDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12));
  }

  // recordsをdate単位で集計し、日付ごとの合計値マップを生成する
  // 例: { "2026-06-19": 3, "2026-06-20": 1 }
  function getDailyTotals(records) {
    const totals = {};
    records.forEach((record) => {
      totals[record.date] = (totals[record.date] || 0) + record.amount;
    });
    return totals;
  }

  /* =========================================================
   * 状態
   * ========================================================= */

  let appData = loadData();

  // カレンダー上で選択中の日付（カウント追加・調整の対象日）。初期値は「今日」
  let selectedDateKey = getTodayKey();

  // カレンダーの表示基準月（この月と「前月」の2ヶ月分を表示する）
  // day は常に1に固定しておく（setMonth() による月末日のオーバーフロー・ズレを防ぐため）
  let calendarBase = (() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1, 12);
  })();

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
    confirmResetBtn: document.getElementById('confirmResetBtn'),
    calendar: document.getElementById('calendar'),
    calendarTitle: document.getElementById('calendarTitle'),
    selectedDateLabel: document.getElementById('selectedDateLabel')
  };

  /* =========================================================
   * 操作層
   * ========================================================= */

  // +1（選択中の日付に対して加算）
  function increment() {
    addRecord(appData, 'increment', 1, selectedDateKey);
    saveData(appData);
    render();
  }

  // -1（選択中の日付に対して減算。現在値が0以下のときは何もしない）
  function decrement() {
    const current = getCurrentCount(appData);
    if (current <= 0) return;
    addRecord(appData, 'decrement', -1, selectedDateKey);
    saveData(appData);
    render();
  }

  // 任意数追加（選択中の日付に対して加算）
  function addCustomAmount(rawValue) {
    const validation = validateCustomInput(rawValue);
    if (!validation.valid) {
      showInputError(validation.message);
      return;
    }
    hideInputError();
    addRecord(appData, 'manual', validation.value, selectedDateKey);
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
      // リセットは「現在の合計を打ち消す」操作のため、対象日は選択中の日付ではなく常に今日とする
      addRecord(appData, 'reset', -current, getTodayKey());
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
    console.log('render start');
    renderCount();
    console.log('after count');
    renderProgressBar();
    console.log('after progress');
    renderCalendar();
    console.log('after calendar');
  }

  // 現在値・上限値・使用率の数値表示を更新する
  function renderCount() {
    const current = getCurrentCount(appData);
    const remaining = getRemainingCount(current, appData.monthlyLimit);

    els.currentCount.textContent = current;
    els.monthlyLimit.textContent = appData.monthlyLimit;
    els.usageRate.textContent = remaining;
    els.decrementBtn.disabled = current <= 0;
  }

  // 進捗バーの幅と配色（通常／警告／上限超過）を更新する
  function renderProgressBar() {
    const current = getCurrentCount(appData);
    const limit = appData.monthlyLimit;

    const remaining = limit - current;
    const rate = Math.min(Math.max((current / limit) * 100, 0), 100);

    els.progressFill.style.width = rate + '%';

    els.progressFill.classList.remove('is-warning', 'is-over');
    if (rate >= 100) {
      els.progressFill.classList.add('is-over');
    } else if (rate >= 80) {
      els.progressFill.classList.add('is-warning');
    }

    els.usageRate.textContent = remaining;
  }

  // 指定した年・月（monthは0始まり）の日数と、1日の曜日（0=日 ... 6=土）を返す
  function getMonthData(year, month) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = new Date(year, month, 1).getDay();
    return { daysInMonth, startWeekday };
  }

  // 1ヶ月分の日付セルHTMLを生成する
  // ※ 元のrenderCalendar()にあった日付セル生成ロジックをそのまま関数化したもの（ロジックの変更なし）
  function renderMonthCells(year, month, dailyTotals, todayKey) {
    const { daysInMonth, startWeekday } = getMonthData(year, month);

    let html = '';

    // 1日が始まる曜日まで空セルを詰める
    for (let i = 0; i < startWeekday; i++) {
      html += '<div class="calendar-cell calendar-cell--empty"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const cellDate = new Date(year, month, day, 12);
      const dateKey = formatDateKey(cellDate);
      const total = dailyTotals[dateKey] || 0;
      const isToday = dateKey === todayKey;
      const isSelected = dateKey === selectedDateKey;

      let cellClass = 'calendar-cell';
      if (isToday) cellClass += ' today';
      if (isSelected) cellClass += ' selected';

      html +=
        '<div class="' + cellClass + '" data-date="' + dateKey + '">' +
          '<span class="calendar-day">' + day + '</span>' +
          (total !== 0 ? '<span class="calendar-amount">' + total + '</span>' : '') +
        '</div>';
    }

    // 月末を7の倍数まで空セルで埋める
    // → グリッドは7列固定のため、これをしないと次の月の1日が誤った曜日列から始まってしまう
    const totalCells = startWeekday + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 0; i < trailing; i++) {
      html += '<div class="calendar-cell calendar-cell--empty"></div>';
    }

    return html;
  }

  // calendarBaseの「前月」と「当月」の2ヶ月分カレンダーを生成し、#calendar に描画する
  function renderCalendar() {
    if (!els.calendar) return;

    const dailyTotals = getDailyTotals(appData.records);
    const todayKey = getTodayKey();

    const baseYear = calendarBase.getFullYear();
    const baseMonth = calendarBase.getMonth();

    const prevRef = new Date(baseYear, baseMonth - 1, 1);

    // 表示順：前月 → 当月
    const months = [
      { year: prevRef.getFullYear(), month: prevRef.getMonth() },
      { year: baseYear, month: baseMonth }
    ];

    let html = '';
    months.forEach((m) => {
      html += renderMonthCells(m.year, m.month, dailyTotals, todayKey);
    });

    els.calendar.innerHTML = html;

    if (els.calendarTitle) {
      const first = months[0];
      const last = months[months.length - 1];
      els.calendarTitle.textContent =
        first.year + '年' + (first.month + 1) + '月 - ' + last.year + '年' + (last.month + 1) + '月';
    }

    if (els.selectedDateLabel) {
      els.selectedDateLabel.textContent = '選択中の日付：' + selectedDateKey;
    }
  }

  /* =========================================================
   * カレンダー：月移動
   * ========================================================= */

  // calendarBaseをoffsetヶ月分移動し、再描画する（+1で次の月、-1で前の月）
  function shiftMonth(offset) {
    calendarBase.setMonth(calendarBase.getMonth() + offset);
    renderCalendar();
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

    // カレンダーの日付セルクリックで選択日付（selectedDateKey）を切り替える
    // ※ 集計・現在値ロジックには影響しないため、再描画はrenderCalendar()のみで十分
    els.calendar.addEventListener('click', (event) => {
      const cell = event.target.closest('.calendar-cell[data-date]');
      if (!cell) return;
      selectedDateKey = cell.dataset.date;
      renderCalendar();
    });

    // カレンダーのスワイプ操作
    // 右スワイプ → 前の月へ／左スワイプ → 次の月へ（外部ライブラリ不使用、判定は移動距離50px以上のみ）
    let touchStartX = null;

    els.calendar.addEventListener('touchstart', (event) => {
      touchStartX = event.changedTouches[0].clientX;
    }, { passive: true });

    els.calendar.addEventListener('touchend', (event) => {
      if (touchStartX === null) return;

      const touchEndX = event.changedTouches[0].clientX;
      const deltaX = touchEndX - touchStartX;
      touchStartX = null;

      if (Math.abs(deltaX) < 50) return; // 50px未満は誤操作防止のため無視

      if (deltaX < 0) {
        shiftMonth(1);  // 左スワイプ → 次の月
      } else {
        shiftMonth(-1); // 右スワイプ → 前の月
      }
    }, { passive: true });

    els.dialogOverlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        cancelReset();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', initApp);
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js");
  });
}
