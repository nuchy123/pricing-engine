// upload.js – runs only on admin.html

// Shared key with front-end
const MODEL_KEY = "tpoPricingModel_v2";

// ---- UI helpers -----------------------------------------------------------

function setAdminStatus(msg, isError = false) {
  const box = document.getElementById("adminStatus");
  if (!box) return;
  box.textContent = msg;
  box.style.backgroundColor = isError ? "#fef2f2" : "#eff6ff";
  box.style.color = isError ? "#b91c1c" : "#1d4ed8";
  box.style.borderColor = isError ? "#fecaca" : "#bfdbfe";
}

// Populate Term dropdown on the USER page (index.html) after upload.
// We do it by storing the model only; the front-end will read and populate.
function populateProductTermsFromModel(model) {
  // nothing to do here – front-end will handle it on load
}

// ---- Workbook parsing -----------------------------------------------------

// Term patterns to detect headers in the sheet
const TERM_PATTERNS = [
  { key: "30yr", regex: /30\s*YEAR/i },
  { key: "25yr", regex: /25\s*YEAR/i },
  { key: "20yr", regex: /20\s*YEAR/i },
  { key: "15yr", regex: /15\s*YEAR/i },
  { key: "10yr", regex: /10\s*YEAR/i },
  { key: "arm", regex: /ARM/i }
];

// Map sheet names to program IDs and whether they are high-balance
function detectProgramFromSheetName(sheetName) {
  const name = sheetName.toUpperCase();

  // High-balance vs regular conventional
  if (name.includes("CONFORMING") && name.includes("HIGH BALANCE")) {
    return { program: "conventional", highBalance: true };
  }
  if (name.includes("CONFORMING") && !name.includes("HIGH BALANCE")) {
    return { program: "conventional", highBalance: false };
  }

  // FHA vs FHA High Balance (ignore FHA 203)
  if (name.includes("FHA") && name.includes("HIGH BALANCE") && !name.includes("203")) {
    return { program: "fha", highBalance: true };
  }
  if (name.includes("FHA") && !name.includes("203")) {
    return { program: "fha", highBalance: false };
  }

  // Homestyle -> actually Home Possible tab per your instructions
  if (name.includes("HOME POSSIBLE")) {
    return { program: "homestyle", highBalance: false };
  }

  // HomeReady
  if (name.includes("HOMEREADY") || name.includes("HOME READY")) {
    return { program: "homeready", highBalance: false };
  }

  // Non-QM
  if (name.includes("NON") && name.includes("QM")) {
    return { program: "nonqm", highBalance: false };
  }

  return null;
}

function ensureProgram(model, id, label) {
  if (!model.programs[id]) {
    model.programs[id] = {
      id,
      label,
      grids: {},   // term -> { sourceSheet, rows: [ {rate, price} ] }
      hbGrids: {}  // high balance version, same structure
    };
  }
  return model.programs[id];
}

// Parse one sheet into one program
function parseSheetIntoProgram(model, workbook, sheetName) {
  const mapping = detectProgramFromSheetName(sheetName);
  if (!mapping) return;

  const programId = mapping.program;
  const isHB = mapping.highBalance;

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

  const programLabelMap = {
    conventional: "Conventional",
    fha: "FHA",
    homestyle: "Homestyle",
    homeready: "HomeReady",
    nonqm: "Non QM"
  };

  const program = ensureProgram(model, programId, programLabelMap[programId] || programId);

  // scan for each term pattern
  for (const tp of TERM_PATTERNS) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      const rowText = row.join(" ").toUpperCase();
      if (!tp.regex.test(rowText)) continue;

      // Next row: column headers containing RATE and 30-Day
      const headerRow = rows[r + 1] || [];
      const rateColIndex = headerRow.findIndex(c => String(c || "").toUpperCase().startsWith("RATE"));
      // "30" is usually part of "30-Day" heading
      const col30Index = headerRow.findIndex(c => String(c || "").toUpperCase().includes("30"));

      if (rateColIndex === -1 || col30Index === -1) {
        continue; // can't parse this section
      }

      const gridRows = [];
      for (let rr = r + 2; rr < rows.length; rr++) {
        const dataRow = rows[rr] || [];
        const rawRate = String(dataRow[rateColIndex] || "").trim();
        const rawPrice = String(dataRow[col30Index] || "").trim();

        if (!rawRate && !rawPrice) break; // empty line – end of block

        // If we hit a new section header (another YEAR/ARM), also stop
        const joined = dataRow.join(" ").toUpperCase();
        if (joined.includes("YEAR") || joined.includes("ARM")) {
          break;
        }

        const rateNum = parseFloat(rawRate.replace(/[^\d.]/g, ""));
        const priceNum = parseFloat(rawPrice.replace(/[^\d.\-]/g, ""));

        if (!isFinite(rateNum) || !isFinite(priceNum)) continue;

        gridRows.push({ rate: rateNum, price: priceNum });
      }

      if (!gridRows.length) continue;

      const target = isHB ? program.hbGrids : program.grids;
      if (!target[tp.key]) {
        target[tp.key] = {
          sourceSheet: sheetName,
          rows: gridRows
        };
      }

      // Stop searching further rows for this same term; go to next term pattern.
      break;
    }
  }
}

// Build full model from workbook
function buildModelFromWorkbook(workbook) {

  // ALWAYS use the first sheet in this workbook (your TPO Go WS-NDC)
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

  // Program header patterns to search for inside sheet rows
  const PROGRAM_HEADERS = {
    "conforming": /CONFORMING(?!.*HIGH BALANCE)/i,
    "high_balance": /CONFORMING.*HIGH BALANCE/i,
    "fha": /^FHA(?!.*203)/i,
    "fha_high_balance": /FHA.*HIGH BALANCE/i,
    "home_possible": /HOME POSSIBLE/i,
    "home_ready": /HOMEREADY/i,
    "non_qm": /NON.?QM/i
  };

  const model = {
    lastUpdated: new Date().toISOString(),
    programs: {},
    terms: new Set()
  };

  let currentProgramKey = null;
  let rateColIndex = -1;
  let priceColIndex = -1;

  for (let r = 0; r < rows.length; r++) {
    const rowText = (rows[r] || []).join(" ").toUpperCase();

    // 1️⃣ Detect program header
    for (const [key, pattern] of Object.entries(PROGRAM_HEADERS)) {
      if (pattern.test(rowText)) {
        currentProgramKey = key;
        model.programs[key] = { label: key, grid: [] };
        rateColIndex = -1;
        priceColIndex = -1;
      }
    }

    if (!currentProgramKey) continue;

    const row = rows[r];

    // 2️⃣ Detect column headers (RATE / 30-DAY)
    if (rateColIndex === -1 && row.some(c => /^RATE$/i.test(c))) {
      rateColIndex = row.findIndex(c => /^RATE$/i.test(c));
      priceColIndex = row.findIndex(c =>
        (c || "").toUpperCase().includes("30")
      );
      continue;
    }

    // 3️⃣ Extract rate/price rows
    if (rateColIndex >= 0 && row[rateColIndex]) {
      const rateNum = parseFloat(String(row[rateColIndex]).replace(/[^\d.]/g, ""));
      const priceNum = parseFloat(String(row[priceColIndex]).replace(/[^\d.-]/g, ""));

      if (isFinite(rateNum) && isFinite(priceNum)) {
        model.programs[currentProgramKey].grid.push({ rate: rateNum, price: priceNum });
      }
    }

    // 4️⃣ Detect terms inside headers
    if (/30.?YEAR/i.test(rowText)) model.terms.add("30yr");
    if (/20.?YEAR/i.test(rowText)) model.terms.add("20yr");
    if (/15.?YEAR/i.test(rowText)) model.terms.add("15yr");
    if (/10.?YEAR/i.test(rowText)) model.terms.add("10yr");
    if (/ARM/i.test(rowText)) model.terms.add("arm");
  }

  // Convert terms Set → array
  model.terms = Array.from(model.terms);

  return model;
}


// ---- File handling --------------------------------------------------------

function handleFile(file) {
  if (!file) {
    setAdminStatus("Please choose a rate sheet file first.", true);
    return;
  }

  const reader = new FileReader();

  reader.onload = (ev) => {
    try {
      const data = new Uint8Array(ev.target.result);
      // xlsx.full.min.js can read both .xls and .xlsx from an ArrayBuffer
      const workbook = XLSX.read(data, { type: "array" });

      const model = buildModelFromWorkbook(workbook);

      localStorage.setItem(MODEL_KEY, JSON.stringify(model));

      // light summary for the admin
      const programSummary = Object.values(model.programs)
        .map(p => {
          const terms = new Set([
            ...Object.keys(p.grids || {}),
            ...Object.keys(p.hbGrids || {})
          ]);
          return `${p.label}: ${Array.from(terms).join(", ") || "no terms"}`;
        })
        .join(" | ");

      setAdminStatus(
        `Loaded ${file.name}. Programs detected: ${programSummary}`,
        false
      );

      populateProductTermsFromModel(model);
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

// Wire up events
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
