// Helper: format currency and percent
function fmtMoney(num) {
  if (!isFinite(num)) return "–";
  return "$" + num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtRate(num) {
  if (!isFinite(num)) return "–";
  return num.toFixed(3) + "%";
}

// Autofill location from ZIP (US only)
function setupZipLookup() {
  const zipInput = document.getElementById("zip");
  const locInput = document.getElementById("locationDisplay");
  if (!zipInput || !locInput) return;

  zipInput.addEventListener("change", () => {
    const zip = zipInput.value.trim();
    if (!/^\d{5}$/.test(zip)) {
      locInput.value = "";
      return;
    }

    fetch(`https://api.zippopotam.us/us/${zip}`)
      .then((res) => {
        if (!res.ok) throw new Error("ZIP not found");
        return res.json();
      })
      .then((data) => {
        const place = data.places && data.places[0];
        if (!place) return;
        const city = place["place name"];
        const state = place["state abbreviation"];
        locInput.value = `${city}, ${state}`;
      })
      .catch(() => {
        locInput.value = "ZIP not found";
      });
  });
}

// Auto-fill Loan / LTV
function setupAutoCalc() {
  const ppInput = document.getElementById("pp");
  const loanInput = document.getElementById("loan");
  const ltvInput = document.getElementById("ltv");
  if (!ppInput || !loanInput || !ltvInput) return;

  function recalc() {
    const pp = parseFloat(ppInput.value || "0");
    const loan = parseFloat(loanInput.value || "0");
    const ltv = parseFloat(ltvInput.value || "0");

    // If PP + Loan => set LTV
    if (pp > 0 && loan > 0 && !ltvInput.value) {
      const calcLtv = (loan / pp) * 100;
      ltvInput.value = calcLtv.toFixed(2);
    }

    // If PP + LTV => set Loan
    if (pp > 0 && ltv > 0 && !loanInput.value) {
      const calcLoan = (pp * ltv) / 100;
      loanInput.value = calcLoan.toFixed(0);
    }
  }

  [ppInput, loanInput, ltvInput].forEach((el) =>
    el.addEventListener("change", recalc)
  );
}

// Stub: monthly payment (P&I only) for 30 years
function calcMonthlyPayment(loanAmount, ratePercent) {
  const r = ratePercent / 100 / 12;
  const n = 30 * 12;
  if (!loanAmount || !ratePercent) return NaN;
  return (loanAmount * r) / (1 - Math.pow(1 + r, -n));
}

// Core pricing function
function runPricing() {
  const noticeEl = document.getElementById("resultNotice");
  const wrapperEl = document.getElementById("duLpWrapper");
  const discEl = document.getElementById("disclaimer");
  const rateDU = document.getElementById("rateDU");
  const rateLP = document.getElementById("rateLP");
  const payDU = document.getElementById("payDU");
  const payLP = document.getElementById("payLP");

  const program = document.getElementById("program").value;
  const lock = document.getElementById("lock").value;
  const occ = document.getElementById("occ").value;
  const ptype = document.getElementById("ptype").value;
  const fico = parseFloat(document.getElementById("fico").value || "0");
  const purpose = document.getElementById("purpose").value;
  const loan = parseFloat(document.getElementById("loan").value || "0");

  // You will later replace this with real XLS-based pricing from window.pricingModel
  // For now, we make a simple placeholder logic so the UI works.
  let baseRateDU = NaN;
  let baseRateLP = NaN;

  if (program === "conf_30") {
    baseRateDU = 6.5;
    baseRateLP = 6.375;
  } else if (program === "conf_15") {
    baseRateDU = 6.25;
    baseRateLP = 6.125;
  }

  // Apply simple fico / occ adjustments as placeholders (internally)
  function internalAdj(base, isLP) {
    if (!isFinite(base)) return NaN;
    let rate = base;

    // simple fictitious adjustments just so numbers change:
    if (fico < 740) rate += 0.125;
    if (fico < 700) rate += 0.25;
    if (purpose === "cash_out") rate += 0.25;
    if (occ === "investment") rate += 0.375;
    if (ptype === "condo") rate += 0.125;

    // broker comp, LLPA, payups are all applied as price adjustments behind the scenes.
    // We are ONLY showing the final equivalent note rate here.

    return rate;
  }

  const finalRateDU = internalAdj(baseRateDU, false);
  const finalRateLP = internalAdj(baseRateLP, true);

  if (!isFinite(finalRateDU) && !isFinite(finalRateLP)) {
    noticeEl.textContent =
      "No pricing available for this combination yet. Make sure a rate sheet is loaded in Admin.";
    wrapperEl.classList.add("hidden");
    discEl.classList.add("hidden");
    return;
  }

  const payDUv = calcMonthlyPayment(loan, finalRateDU);
  const payLPv = calcMonthlyPayment(loan, finalRateLP);

  noticeEl.textContent = "Pricing calculated.";
  wrapperEl.classList.remove("hidden");
  discEl.classList.remove("hidden");

  rateDU.textContent = fmtRate(finalRateDU);
  rateLP.textContent = fmtRate(finalRateLP);

  payDU.textContent = isFinite(payDUv) ? fmtMoney(payDUv) : "–";
  payLP.textContent = isFinite(payLPv) ? fmtMoney(payLPv) : "–";
}

document.addEventListener("DOMContentLoaded", () => {
  setupZipLookup();
  setupAutoCalc();

  const btn = document.getElementById("runPrice");
  if (btn) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      runPricing();
    });
  }
});
