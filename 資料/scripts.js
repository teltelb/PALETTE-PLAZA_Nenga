// 設定一元化：このPRICINGを書き換えるだけで金額改定に対応
const PRICING = {
  postcard: { perUnit: 85 },
  inputAssistanceFee: 1500,
  discounts: { super_early: 0.2, early: 0.1, normal: 0 },
  dmCoupon: { super_early: 500, early: 500, normal: 300 },
  finishes: {
    photo: {
      base: { simple: 2200, light: 2800, premium: 4800, high: 5400, standard: 3800 },
      stepSize: 10,
      initialFreeQty: 10,
      increments: [{ upto: Infinity, perStep: 660 }],
    },
    print: {
      base: { simple: 2000, light: 2600, premium: 4600, high: 5200, standard: 3600 },
      stepSize: 10,
      initialFreeQty: 10,
      increments: [
        { upto: 50, perStep: 600 },
        { upto: 100, perStep: 550 },
        { upto: Infinity, perStep: 500 },
      ],
    },
  },
  plans: {
    self: { addFixed: 0 },
    sakutto: { addFixed: 1480 },
    omakase: { perUnitByDiscount: { super_early: 100, early: 200, normal: 200 } },
    marunageExtra: 1960,
  },
};

// 表記の揺れ・文字化けに強い正規化
function normalizeFinish(label) {
  if (!label) return 'print';
  return /写真/.test(label) ? 'photo' : 'print';
}
function normalizeGrade(label) {
  if (!label) return 'standard';
  if (/プレミ/.test(label)) return 'premium';
  if (/ハイ/.test(label)) return 'high';
  if (/スタン/.test(label)) return 'standard';
  if (/ライ/.test(label)) return 'light';
  return 'simple';
}
function normalizeDiscount(label) {
  if (!label) return 'normal';
  const hasEarly = /早/.test(label);
  const hasSuper = /超/.test(label) || /超早/.test(label);
  if (hasEarly && hasSuper) return 'super_early';
  if (hasEarly) return 'early';
  return 'normal';
}
function normalizePlan(label) {
  if (!label) return 'self';
  if (/まる/.test(label)) return 'marunage';
  if (/のん/.test(label)) return 'omakase';
  if (/宛名|高速/.test(label)) return 'fast';
  if (/サク|セルフ/.test(label)) return 'self';
  return 'self';
}

// 基本価格計算（設定駆動）
function calculateBasePrice(gradeNorm, finishNorm, quantity) {
  const finishCfg = PRICING.finishes[finishNorm] || PRICING.finishes.print;
  const base = finishCfg.base[gradeNorm] ?? finishCfg.base.standard;
  const step = finishCfg.stepSize;
  const free = finishCfg.initialFreeQty;
  const incs = finishCfg.increments;

  if (quantity <= free) return base;
  const stepsNeeded = Math.ceil((quantity - free) / step);

  if (incs.length === 1) {
    return base + stepsNeeded * incs[0].perStep;
  }

  // 段階式（印刷仕上げなど）
  let remainSteps = stepsNeeded;
  let added = 0;
  let coveredUpto = free;
  for (const band of incs) {
    if (remainSteps <= 0) break;
    const bandMaxSteps = band.upto === Infinity
      ? remainSteps
      : Math.max(0, Math.ceil((band.upto - coveredUpto) / step));
    const use = Math.min(remainSteps, bandMaxSteps);
    added += use * band.perStep;
    remainSteps -= use;
    coveredUpto = band.upto === Infinity ? coveredUpto + use * step : band.upto;
  }
  return base + added;
}

// 価格計算（UIと接続）
function calculatePrice() {
  const quantity = parseInt(document.getElementById('quantity')?.value) || 0;

  const gradeNorm = normalizeGrade(document.getElementById('grade')?.value);
  const finishNorm = normalizeFinish(document.getElementById('finish')?.value);
  const discountNorm = normalizeDiscount(document.getElementById('discount')?.value);
  const bringYourOwn = !!document.getElementById('bring-your-own')?.checked;
  const dmCouponChecked = !!document.getElementById('dm-option')?.checked;
  const inputAssistance = !!document.getElementById('input-assistance')?.checked;

  let selfPrice = calculateBasePrice(gradeNorm, finishNorm, quantity);

  // 割引
  const rate = PRICING.discounts[discountNorm] || 0;
  if (rate > 0) selfPrice = Math.floor(selfPrice * (1 - rate));

  // はがき代
  if (!bringYourOwn) selfPrice += quantity * PRICING.postcard.perUnit;

  // DMクーポン
  if (dmCouponChecked) selfPrice -= PRICING.dmCoupon[discountNorm] || 0;

  // 入力代行
  if (inputAssistance) selfPrice += PRICING.inputAssistanceFee;

  // プラン別
  let sakuttoPrice = selfPrice + PRICING.plans.sakutto.addFixed;
  let omakasePrice = selfPrice + quantity * (PRICING.plans.omakase.perUnitByDiscount[discountNorm] || 0);
  let marunagePrice = omakasePrice + PRICING.plans.marunageExtra;

  if (!quantity) selfPrice = sakuttoPrice = omakasePrice = marunagePrice = 0;

  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = `¥${(isNaN(v) ? 0 : v).toLocaleString()}`; };
  setText('yukkuri-plan-price', selfPrice);
  setText('self-plan-price', sakuttoPrice);
  setText('omakase-plan-price', omakasePrice);
  setText('marunage-plan-price', marunagePrice);
}

// 仕上げによる表示切替
function updateVisiblePlans() {
  const finishNorm = normalizeFinish(document.getElementById('finish')?.value);
  const marunage = document.getElementById('marunage-plan');
  const sakutto = document.getElementById('sakutto-plan');
  if (finishNorm === 'photo') {
    if (marunage) marunage.style.display = 'none';
    if (sakutto) sakutto.style.display = 'none';
  } else {
    if (marunage) marunage.style.display = 'block';
    if (sakutto) sakutto.style.display = 'block';
  }
}

// 完了日の算出
const PLAN_DAYS = { marunage: 4, omakase: 7, fast: 0, self: 5 };
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
function calculateCompletionDate(planRaw) {
  const key = normalizePlan(planRaw);
  const days = PLAN_DAYS[key] ?? 0;
  const today = new Date();
  if (days === 0) return '1時間後';
  const d = new Date(today);
  d.setDate(today.getDate() + days);
  const month = d.getMonth() + 1;
  const date = d.getDate();
  const weekday = WEEKDAYS[d.getDay()];
  return `${month}月${date}日(${weekday})`;
}

// 起動時セットアップ
document.addEventListener('DOMContentLoaded', () => {
  updateVisiblePlans();
  calculatePrice();

  const finishEl = document.getElementById('finish');
  if (finishEl) finishEl.addEventListener('change', updateVisiblePlans);

  // 入力要素のイベント（即時計算）
  const inputs = ['quantity', 'grade', 'finish', 'discount', 'bring-your-own', 'dm-option', 'input-assistance'];
  inputs.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', calculatePrice);
    el.addEventListener('change', calculatePrice);
  });

  // モーダル
  const modal = document.getElementById('myModal');
  const closeBtn = document.getElementsByClassName('close')[0];
  const openModal = () => { if (modal) modal.style.display = 'block'; };
  const closeModal = () => { if (modal) modal.style.display = 'none'; };
  if (closeBtn) closeBtn.onclick = closeModal;
  window.addEventListener('click', (ev) => { if (ev.target === modal) closeModal(); });

  // プランカードのクリック
  document.querySelectorAll('.plan-card').forEach((card) => {
    card.addEventListener('click', (ev) => {
      ev.preventDefault();
      const qty = parseInt(document.getElementById('quantity')?.value) || 0;
      if (!qty) { alert('枚数を入力してください'); return; }

      const planTitleEl = card.querySelector('.card-title');
      const planPriceEl = card.querySelector('.result-price');
      if (!planTitleEl || !planPriceEl) return;

      const planName = planTitleEl.textContent?.trim() || '';
      const totalCost = parseInt((planPriceEl.textContent || '').replace(/[^0-9]/g, '')) || 0;

      const bringYourOwn = !!document.getElementById('bring-your-own')?.checked;
      const dmCouponChecked = !!document.getElementById('dm-option')?.checked;
      const discountNorm = normalizeDiscount(document.getElementById('discount')?.value);

      const postcardCost = bringYourOwn ? 0 : qty * PRICING.postcard.perUnit;
      const dmDiscount = dmCouponChecked ? (PRICING.dmCoupon[discountNorm] || 0) : 0;

      // 印刷代（クーポン控除前相当）
      const printCost = totalCost - postcardCost + dmDiscount;

      const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      setText('planName', planName);
      setText('postcardCost', `¥${postcardCost.toLocaleString()}`);
      setText('totalCost', `¥${totalCost.toLocaleString()}`);
      setText('dmDiscount', dmDiscount > 0 ? `¥-${dmDiscount.toLocaleString()}` : `¥0`);
      setText('printCost', `¥${printCost.toLocaleString()}`);

      const completionDateEl = document.getElementById('completionDate');
      if (completionDateEl) {
        const dateStr = calculateCompletionDate(planName);
        completionDateEl.innerHTML = `仕上がり目安 <span>${dateStr}</span>`;
      }

      openModal();
    });
  });
});

