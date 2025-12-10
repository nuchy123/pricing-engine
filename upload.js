// Key used for storing the parsed pricing model in localStorage
const MODEL_KEY = "tpoPricingModel_v1";

// Utility: populate the Term dropdown on the front-end
function populateProductTerms(terms) {
  const termSelect = document.getElementById('productTerm');
  if (!termSelect) return;

  termSelect.innerHTML = '';

  const niceLabels = {
    '30yr': '30 Year Fixed',
    '25yr': '25 Year Fixed',
    '20yr': '20 Year Fixed',
    '15yr': '15 Year Fixed',
    '10yr': '10 Year Fixed',
    'arm': 'ARM'
  };

  terms.forEach(termKey => {
    const opt = document.createElement('option');
    opt.value = termKey;
    opt.textContent = niceLabels[termKey] || termKey;
    termSelect.appendChild(opt);
  });
}

// Identify available product terms from sheet names
function detectTermsFromWorkbook(workbook) {
  const terms = new Set();

  workbook.SheetNames.forEach(sheetName => {
    const name = sheetName.toUpperCase();

    if (name.includes("30")) terms.add("30yr");
    if (name.includes("25")) terms.add("25yr");
    if (name.includes("20")) terms.add("20yr");
    if (name.includes("15")) terms.add("15yr");
    if (name.includes("10")) terms.add("10yr");
    if (name.includes("ARM")) terms.add("arm");
  });

  // Fallback if nothing was detected
  if (terms.size === 0) terms.add("30yr");

  return Array.from(terms);
}

// Parse workbook → Build placeholder model (kept the same)
function buildModelFromWorkbook(workbook) {
  // Detect available terms (Task 3)
  const detectedTerms = detectTermsFromWorkbook(workbook);
  populateProductTerms(detectedTerms);

  // For now: still use the FIRST sheet as before
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

  // Find the header row that contains "CONFORMING 30 YEAR FIXED"
  let headerRowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    const rowText = (rows[i] || []).join(" ").toUpperCase();
    if (rowText.includes("CONFORMING 30 YEAR FIXED")) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error("Could not find 'CONFORMING 30 YEAR FIXED' section in sheet.");
  }

  // Next row should contain the column labels including "30-Day"
  const colHeader = rows[headerRowIndex + 1] || [];
  const rateColIndex = colHeader.findIndex((c) =>
    String(c || "").toUpperCase().startsWith("RATE")
  );
  const col30Index = colHeader.findIndex((c) =>
    String(c || "").toUpperCase().includes("30")
  );

  if (rateColIndex === -1 || col30Index === -1) {
    throw new Error("Could not find RATE / 30-Day columns in pricing grid.");
  }

  const baseGrid = [];

  // Following rows contain rate / price pairs until we hit a blank or a new section
  for (let r = headerRowIndex + 2; r < rows.length; r++) {
    const row = rows[r] || [];
    const rawRate = String(row[rateColIndex] || "").trim();
    const rawPrice = String(row[col30Index] || "").trim();

    // Stop if we hit an empty line or a new header
    if (!rawRate && !rawPrice) break;
    if (rawRate.toUpperCase().includes("CONFORMING")) break;

    const rateNum = parseFloat(rawRate.replace(/[^\d.]/g, ""));
    const priceNum = parseFloat(rawPrice.replace(/[^\d.-]/g, ""));

    if (!isFinite(rateNum) || !isFinite(priceNum)) continue;

    baseGrid.push({
      rate: rateNum,
      price: priceNum
    });
  }

  if (!baseGrid.length) {
    throw new Error("No pricing rows were found under the Conforming 30 Year Fixed section.");
  }

  // Model structure stays simple for now
  const model = {
    lastUpdated: new Date().toISOString(),
    sourceSheet: firstSheetName,
    availableTerms: detectedTerms,   // <-- NEW FIELD
    programs: {
      conf_30: {
        id: "conf_30",
        label: "Conforming 30 Year Fixed",
        baseGrid
      }
    }
  };

  return model;
}

// Handle file selection and parsing
function handleFile(file) {
  if (!file) {
    setAdminStatus("Please choose a rate sheet file first.", true);
    return;
  }

  const reader = new FileReader();

  reader.onload = (ev) => {
    try {
      const data = new Uint8Array(ev.target.result);
      const workbook = XLSX.read(data, { type: "array" });

      const model = buildModelFromWorkbook(workbook);

      // Store in localStorage
      localStorage.setItem(MODEL_KEY, JSON.stringify(model));

      setAdminStatus(
        `Loaded ${file.name}. Found ${model.programs.conf_30.baseGrid.length} rows.`
      );
    } catch (err) {
      console.error(err);
      setAdminStatus(
        "Error parsing workbook. Check format or try another file. Details: " + err.message,
        true
      );
    }
  };

  reader.onerror = () => {
    setAdminStatus("Error reading file from your computer.", true);
  };

  reader.readAsArrayBuffer(file);
}

document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("rateFile");
  const loadBtn = document.getElementById("loadPricing");

  if (!fileInput || !loadBtn) return;

  loadBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const file = fileInput.files && fileInput.files[0];
    handleFile(file);
  });
});
