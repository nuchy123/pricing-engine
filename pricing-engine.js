// pricing-engine.js
// Reads the pricing model produced by upload.js and calculates a
// simple note rate + P&I payment for the scenario page.
//
// IMPORTANT: This is a starter engine.
// - Uses Conforming 30Y grid as base for all programs.
// - Adds 2.5% broker comp to price internally.
// - LLPA & payup hooks are present but return 0 for now.

const PRICING_MODEL_KEY = "tpoPricingModelV1";
const BROKER_COMP_PRICE = 2.5; // 2.50% added to price

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("scenarioForm");
  const statusEl = document.getElementById("pricingStatus");
  const resultBox = document.getElementById("pricingOutput");
  const resultRateEl = document.getElementById("resultRate");
  const resultPaymentEl = document.getElementById("resultPayment");
  const resultDetailsEl = document.getElementById("resultDetails");

  const purchasePriceInput = document.getElementById("purchasePrice");
  const loanAmountInput = document.getElementById("loanAmount");
  const ltvInput = document.getElementById("ltv");

  if (!form) return;

  // Auto-calc LTV / Loan Amount
  function recalcLtvLoan() {
    const purchase = parseFloat(purchasePriceInput.value || "0");
    const loan = parseFloat(loanAmountInput.value || "0");
    const ltv = parseFloat(ltvInput.value || "0");

    if (purchase > 0 && loan > 0) {
      const newLtv = (loan / purchase) * 100;
      if (Number.isFinite(newLtv)) {
        ltvInput.value = newLtv.toFixed(2);
      }
    } else if (purchase > 0 && ltv > 0) {
      const newLoan = (purchase * ltv) / 100;
      if (Number.isFinite(newLoan)) {
        loanAmountInput.value = Math.round(newLoan / 100) * 100; // round to nearest 100
      }
    }
  }

  purchasePriceInput.addEventListener("input", recalcLtvLoan);
  loanAmountInput.addEventListener("input", recalcLtvLoan);
  ltvInput.addEventListener("input", recalcLtvLoan);

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const model = loadPricingModel();
    if (!model) {
      setStatus(
        statusEl,
        "No rate sheet loaded. Please upload a TPO Go XLS in the Admin page first.",
        "error"
      );
      resultBox.classList.add("hidden");
      return;
    }

    const data = readScenario(form);
    if (!data.ok) {
      setStatus(statusEl, data.message, "error");
      resultBox.classList.add("hidden");
      return;
    }

    const program = model.programs[data.programId];
    if (!program || !Array.isArray(program.baseGrid) || !program.baseGrid.length) {
      setStatus(
        statusEl,
        "Selected program is not available in the current rate sheet.",
        "error"
      );
      resultBox.classList.add("hidden");
      return;
    }

    const bestRow = pickBestRow(program.baseGrid, data);
    if (!bestRow) {
      setStatus(statusEl, "No rate found for this scenario.", "error");
      resultBox.classList.add("hidden");
      return;
    }

    const basePrice = bestRow.price;

    const llpaAdj = getLlpaAdjustment(data); // currently 0
    const payupAdj = getPayupAdjustment(data); // currently 0

    // Apply LLPA (cost) and payups (credit) to price
    const netPriceBeforeComp = basePrice - llpaAdj + payupAdj;

    // Broker comp 2.50 added internally
    const finalPrice = netPriceBeforeComp + BROKER_COMP_PRICE;

    const noteRate = bestRow.rate;
    const monthlyPi = calculateMonthlyPI(data.loanAmount, noteRate, data.termYears);

    setStatus(statusEl, "Pricing calculated.", "ok");
    resultRateEl.textContent = `${noteRate.toFixed(3)}%`;
    resultPaymentEl.textContent = isFinite(monthlyPi)
      ? `$${monthlyPi.toLocaleString(undefined, {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2,
        })}`
      : "—";

    resultDetailsEl.textContent =
      `Base price: ${basePrice.toFixed(3)} | ` +
      `LLPA adj: ${(-llpaAdj).toFixed(3)} | ` +
      `Payup adj: ${payupAdj.toFixed(3)} | ` +
      `Broker comp: +${BROKER_COMP_PRICE.toFixed(3)} | ` +
      `Final internal price: ${finalPrice.toFixed(3)}`;

    resultBox.classList.remove("hidden");
  });
});

/* Helpers */

function setStatus(el, msg, type = "info") {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("ok", "error");
  if (type === "ok") el.classList.add("ok");
  if (type === "error") el.classList.add("error");
}

function loadPricingModel() {
  try {
    const raw = localStorage.getItem(PRICING_MODEL_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error(e);
    return null;
  }
}

function readScenario(form) {
  const formData = new FormData(form);

  const programId = formData.get("program");
  const lockTermDays = parseInt(formData.get("lockTerm") || "30", 10);
  const occupancy = formData.get("occupancy");
  const propertyType = formData.get("propertyType");
  const fico = parseInt(formData.get("fico") || "780", 10);
  const purpose = formData.get("purpose");

  const purchasePrice = parseFloat(formData.get("purchasePrice") || "0");
  const loanAmount = parseFloat(formData.get("loanAmount") || "0");
  const ltv = parseFloat(formData.get("ltv") || "0");

  if (!(purchasePrice > 0 && loanAmount > 0 && ltv > 0)) {
    return { ok: false, message: "Please fill Purchase Price, Loan Amount and LTV." };
  }

  return {
    ok: true,
    programId,
    lockTermDays,
    occupancy,
    propertyType,
    fico,
    purpose,
    purchasePrice,
    loanAmount,
    ltv,
    termYears: 30, // for now all programs shown are fixed 30yr; we can vary later
  };
}

// Pick the "best" row from the grid. For now we simply choose the row whose
// rate is closest to 6.500% as a neutral target; you can change this logic to
// "lowest rate", "best price", etc.
function pickBestRow(grid, scenario) {
  if (!Array.isArray(grid) || !grid.length) return null;

  const targetRate = 6.5;
  let best = null;
  let bestDiff = Infinity;

  for (const row of grid) {
    if (!row || !isFinite(row.rate) || !isFinite(row.price)) continue;
    const diff = Math.abs(row.rate - targetRate);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = row;
    }
  }

  return best;
}

// Simple 30-year amortization payment calculator
function calculateMonthlyPI(loanAmount, ratePercent, termYears) {
  const n = termYears * 12;
  const r = ratePercent / 100 / 12;
  if (!(loanAmount > 0 && n > 0 && r > 0)) return NaN;
  return (loanAmount * r) / (1 - Math.pow(1 + r, -n));
}

/* LLPA & Payup hooks
   For now both return 0. Later we can wire them to the LLPA / Payup grids
   from your second sheet exactly as you described.
*/

function getLlpaAdjustment(scenario) {
  // LLPA is usually a cost (positive number that will be subtracted from price)
  // TODO: read LLPA from price-adjustment grids
  return 0;
}

function getPayupAdjustment(scenario) {
  // Payups are usually credits for specific high coupon rates
  // TODO: read Payup incentive grid
  return 0;
}

