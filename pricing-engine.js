// pricing-engine.js – runs only on index.html

const MODEL_KEY = "tpoPricingModel_v2";

// Hard-coded 2026 baseline limits for Conventional / FHA high-balance
// (numbers you provided in the screenshot)
const HIGH_BALANCE_LIMITS_2026 = {
  1: { conforming: 832750, highBalance: 1249125 },
  2: { conforming: 1066250, highBalance: 1599375 },
  3: { conforming: 1288800, highBalance: 1933200 },
  4: { conforming: 1601750, highBalance: 2402625 }
};

let pricingModel = null;

// ---- Helpers --------------------------------------------------------------

function getEl(id) {
  return document.getElementById(id);
}

function setFrontStatus(msg) {
  const box = getEl("frontStatus");
  if (box) box.textContent = msg || "";
}

function setPricingError(msg) {
  const errBox = getEl("pricingError");
  if (!errBox) return;
  if (!msg) {
    errBox.style.display = "none";
    errBox.textContent = "";
    return;
  }
  errBox.style.display = "block";
  errBox.textContent = msg;
}

function showNoScenario() {
  const noSc = getEl("noScenario");
  const res = getEl("pricingResult");
  if (noSc) noSc.style.display = "block";
  if (res) res.style.display = "none";
}

function showResultPanel() {
  const noSc = getEl("noScenario");
  const res = getEl("pricingResult");
  if (noSc) noSc.style.display = "none";
  if (res) res.style.display = "block";
}

// Program -> nice label
const PROGRAM_LABELS = {
  conventional: "Conventional",
  fha: "FHA",
  homestyle: "Homestyle",
  homeready: "HomeReady",
  nonqm: "Non QM"
};

const TERM_LABELS = {
  "30yr": "30 Year Fixed",
  "25yr": "25 Year Fixed",
  "20yr": "20 Year Fixed",
  "15yr": "15 Year Fixed",
  "10yr": "10 Year Fixed",
  "arm": "ARM"
};

function termKeyToYears(termKey) {
  switch (termKey) {
    case "30yr": return 30;
    case "25yr": return 25;
    case "20yr": return 20;
    case "15yr": return 15;
    case "10yr": return 10;
    case "arm": return 30; // assume 30-year amortization for ARM
    default: return 30;
  }
}

function getUnitsFromPropertyType(propertyType) {
  if (!propertyType) return 1;
  const text = propertyType.toUpperCase();
  if (text.includes("2-4") || text.includes("2 – 4")) return 2;
  return 1;
}

function isHighBalance(programId, loanAmount, propertyType) {
  if (!loanAmount || loanAmount <= 0) return false;
  if (programId !== "conventional" && programId !== "fha") return false;

  const units = getUnitsFromPropertyType(propertyType);
  const limits = HIGH_BALANCE_LIMITS_2026[units] || HIGH_BALANCE_LIMITS_2026[1];

  if (loanAmount <= limits.conforming) return false;
  if (loanAmount <= limits.highBalance) return true;

  // beyond high-balance – technically jumbo / Non-QM territory, but
  // we'll still treat as high-balance grid if it exists.
  return true;
}

// Choose grid for given program/term/loan
function pickGrid(programId, termKey, loanAmount, propertyType) {
  if (!pricingModel || !pricingModel.programs) return null;
  const program = pricingModel.programs[programId];
  if (!program) return null;

  const hb = isHighBalance(programId, loanAmount, propertyType);
  const source = hb ? program.hbGrids : program.grids;

  if (!source) return null;
  const grid = source[termKey];
  return grid || null;
}

// Choose "best" rate row – closest to par (100) after adding broker comp
function chooseBestRow(gridRows) {
  if (!gridRows || !gridRows.length) return null;
  const brokerComp = 2.5; // always add 2.5% comp internally

  let best = null;
  let bestDistance = Infinity;

  gridRows.forEach(row => {
    const finalPrice = row.price + brokerComp;
    const distance = Math.abs(finalPrice - 100);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = {
        rate: row.rate,
        basePrice: row.price,
        finalPrice
      };
    }
  });

  return best;
}

function formatMoney(n) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatPercent(n) {
  return n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") + "%";
}

// Standard mortgage payment formula: P&I only
function calculateMonthlyPI(ratePercent, years, loanAmount) {
  const r = (ratePercent / 100) / 12;
  const n = years * 12;
  if (r === 0) return loanAmount / n;
  return loanAmount * r / (1 - Math.pow(1 + r, -n));
}

// ---- Dropdown population --------------------------------------------------

function populateProgramDropdown() {
  const select = getEl("programSelect");
  if (!select) return;
  select.innerHTML = "";

  const programs = ["conventional", "fha", "homestyle", "homeready", "nonqm"];
  programs.forEach(id => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = PROGRAM_LABELS[id] || id;
    select.appendChild(opt);
  });
}

function populateTermDropdownForProgram(programId) {
  const termSelect = getEl("productTerm");
  if (!termSelect) return;
  termSelect.innerHTML = "";

  if (!pricingModel || !pricingModel.programs || !pricingModel.programs[programId]) {
    return;
  }
  const program = pricingModel.programs[programId];
  const termSet = new Set([
    ...Object.keys(program.grids || {}),
    ...Object.keys(program.hbGrids || {})
  ]);

  const termKeys = ["30yr", "25yr", "20yr", "15yr", "10yr", "arm"].filter(k =>
    termSet.has(k)
  );

  termKeys.forEach(termKey => {
    const opt = document.createElement("option");
    opt.value = termKey;
    opt.textContent = TERM_LABELS[termKey] || termKey;
    termSelect.appendChild(opt);
  });
}

// ---- LTV auto-calcs -------------------------------------------------------

function recalcFromPurchaseAndLoan() {
  const purchase = parseFloat(getEl("purchasePrice").value || "0");
  const loan = parseFloat(getEl("loanAmount").value || "0");
  if (purchase > 0 && loan > 0) {
    const ltv = (loan / purchase) * 100;
    getEl("ltv").value = ltv.toFixed(2);
  }
}

function recalcFromPurchaseAndLTV() {
  const purchase = parseFloat(getEl("purchasePrice").value || "0");
  const ltv = parseFloat(getEl("ltv").value || "0");
  if (purchase > 0 && ltv > 0) {
    const loan = purchase * (ltv / 100);
    getEl("loanAmount").value = Math.round(loan);
  }
}

// ---- Main pricing routine -------------------------------------------------

function handleGetPricing() {
  setPricingError("");
  setFrontStatus("");

  if (!pricingModel) {
    setPricingError("No pricing model loaded. Please upload a rate sheet in the Admin XLS Upload page first.");
    return;
  }

  const programId = getEl("programSelect").value || "conventional";
  const termKey = getEl("productTerm").value || "30yr";
  const propertyType = getEl("propertyType").value;
  const loanAmount = parseFloat(getEl("loanAmount").value || "0");

  if (!loanAmount || loanAmount <= 0) {
    setPricingError("Please enter a valid Loan Amount.");
    return;
  }

  const grid = pickGrid(programId, termKey, loanAmount, propertyType);
  if (!grid || !grid.rows || !grid.rows.length) {
    setPricingError("No pricing rows found for this Program / Term combination in the uploaded rate sheet.");
    return;
  }

  const bestRow = chooseBestRow(grid.rows);
  if (!bestRow) {
    setPricingError("Could not determine a best price from the grid.");
    return;
  }

  const years = termKeyToYears(termKey);
  const monthlyPI = calculateMonthlyPI(bestRow.rate, years, loanAmount);

  // Fill UI
  getEl("resultRate").textContent = formatPercent(bestRow.rate);
  getEl("resultPmt").textContent =
    `${formatMoney(monthlyPI)} estimated monthly P&I`;

  getEl("resultProgram").textContent = PROGRAM_LABELS[programId] || programId;
  getEl("resultTerm").textContent = TERM_LABELS[termKey] || termKey;

  getEl("resultBasePrice").textContent = bestRow.basePrice.toFixed(3);
  getEl("resultBrokerComp").textContent = "+2.500";
  getEl("resultFinalPrice").textContent = bestRow.finalPrice.toFixed(3);

  showResultPanel();
}

// ---- Init -----------------------------------------------------------------

function loadModelFromStorage() {
  try {
    const raw = localStorage.getItem(MODEL_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  pricingModel = loadModelFromStorage();

  if (!pricingModel) {
    setFrontStatus("No rate sheet is loaded yet. Please upload one in the Admin XLS Upload page.");
  } else {
    setFrontStatus(`Pricing model loaded. Last updated: ${pricingModel.lastUpdated || ""}`);
  }

  populateProgramDropdown();

  const programSelect = getEl("programSelect");
  programSelect.addEventListener("change", () => {
    populateTermDropdownForProgram(programSelect.value);
  });

  // Initial terms for default program
  populateTermDropdownForProgram(programSelect.value || "conventional");

  // Wiring P / L / LTV auto-calcs
  const pp = getEl("purchasePrice");
  const la = getEl("loanAmount");
  const ltv = getEl("ltv");

  pp.addEventListener("input", () => {
    recalcFromPurchaseAndLoan();
  });
  la.addEventListener("input", () => {
    recalcFromPurchaseAndLoan();
  });
  ltv.addEventListener("input", () => {
    recalcFromPurchaseAndLTV();
  });

  const getBtn = getEl("getPricing");
  getBtn.addEventListener("click", (e) => {
    e.preventDefault();
    handleGetPricing();
  });

  showNoScenario();
});
