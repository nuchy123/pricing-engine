// upload.js
// Parses the uploaded TPO Go Excel workbook and stores a simple pricing model
// in localStorage. For now we extract only the CONVENTIONAL 30 YEAR FIXED
// section and use the 30-Day column as base grid.

const PRICING_MODEL_KEY = "tpoPricingModelV1";

const rateSheetInput = document.getElementById("rateSheetInput");
const uploadStatus = document.getElementById("uploadStatus");

if (rateSheetInput) {
  rateSheetInput.addEventListener("change", handleRateSheetChange);
}

function setStatus(message, type = "info") {
  if (!uploadStatus) return;
  uploadStatus.textContent = message;
  uploadStatus.classList.remove("ok", "error");
  if (type === "ok") uploadStatus.classList.add("ok");
  if (type === "error") uploadStatus.classList.add("error");
}

// Main handler for file input
function handleRateSheetChange(evt) {
  const file = evt.target.files && evt.target.files[0];
  if (!file) {
    setStatus("No file selected.");
    return;
  }

  setStatus(`Reading "${file.name}" ...`);

  const reader = new FileReader();

  reader.onerror = () => {
    setStatus("Error reading file in browser.", "error");
  };

  reader.onload = (e) => {
    try {
      const data = e.target.result;
      // SheetJS will detect .xls vs .xlsx automatically
      const wb = XLSX.read(data, { type: "binary" });

      const model = buildPricingModelFromWorkbook(wb);
      if (!model) {
        setStatus(
          "Could not find a recognizable CONVENTIONAL 30 YEAR FIXED grid in this workbook.",
          "error"
        );
        return;
      }

      localStorage.setItem(PRICING_MODEL_KEY, JSON.stringify(model));
      setStatus(
        `Pricing model stored successfully (${model.programs.CONV_30Y.baseGrid.length} rows).`,
        "ok"
      );
    } catch (err) {
      console.error(err);
      setStatus("Error parsing workbook. Check format or try another file.", "error");
    }
  };

  // `readAsBinaryString` keeps compatibility with older .xls
  reader.readAsBinaryString(file);
}

// Try to build a minimal model from the workbook
function buildPricingModelFromWorkbook(wb) {
  const sheetNames = wb.SheetNames || [];
  if (!sheetNames.length) return null;

  // Heuristic: scan all sheets for a header row that looks like:
  //  "Rate | 15-Day | 30-Day | 45-Day | 60-Day"
  for (const sheetName of sheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
    if (!rows || !rows.length) continue;

    const headerIndex = findLockHeaderRowIndex(rows);
    if (headerIndex === -1) continue;

    const headerRow = rows[headerIndex];
    const grid = extractConforming30YGrid(rows, headerIndex, headerRow);
    if (grid && grid.length) {
      const model = {
        updatedAt: new Date().toISOString(),
        version: 1,
        sourceSheet: sheetName,
        programs: {
          CONV_30Y: {
            id: "CONV_30Y",
            label: "Conforming 30 Year Fixed",
            baseGrid: grid, // [{ rate, price }]
          },
        },
      };

      // For now, reuse same base grid for related programs until we wire them properly
      model.programs.CONV_20Y = {
        id: "CONV_20Y",
        label: "Conforming 20 Year Fixed",
        baseGrid: grid,
      };
      model.programs.CONV_15Y = {
        id: "CONV_15Y",
        label: "Conforming 15 Year Fixed",
        baseGrid: grid,
      };
      model.programs.CONV_10Y = {
        id: "CONV_10Y",
        label: "Conforming 10 Year Fixed",
        baseGrid: grid,
      };
      model.programs.HP_30Y = {
        id: "HP_30Y",
        label: "Home Possible 30 Year Fixed",
        baseGrid: grid,
      };
      model.programs.HP_20Y = {
        id: "HP_20Y",
        label: "Home Possible 20 Year Fixed",
        baseGrid: grid,
      };
      model.programs.HB_30Y = {
        id: "HB_30Y",
        label: "High Balance 30 Year Fixed",
        baseGrid: grid,
      };

      return model;
    }
  }

  return null;
}

// Find a row whose first few cells look like Rate / 15-Day / 30-Day / 45-Day / 60-Day
function findLockHeaderRowIndex(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].map((v) => String(v || "").trim());
    if (!row.length) continue;
    const hasRate = row.some((c) => /^rate$/i.test(c));
    const has30Day = row.some((c) => /30[-\s]?Day/i.test(c));
    if (hasRate && has30Day) {
      return i;
    }
  }
  return -1;
}

// Extract rate/price pairs for Conforming 30Y block below the header
function extractConforming30YGrid(rows, headerIndex, headerRow) {
  const header = headerRow.map((v) => String(v || "").trim());

  const rateColIndex = header.findIndex((c) => /^rate$/i.test(c));
  const day30ColIndex = header.findIndex((c) => /30[-\s]?Day/i.test(c));

  if (rateColIndex === -1 || day30ColIndex === -1) return null;

  const grid = [];
  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) break;

    const rawRate = (row[rateColIndex] ?? "").toString().trim();
    if (!rawRate) break; // blank row ends block

    const rawPrice = (row[day30ColIndex] ?? "").toString().trim();
    if (!rawPrice) continue;

    const rate = parseFloat(rawRate.replace(/[^\d.\-]/g, ""));
    const price = parseFloat(rawPrice.replace(/[^\d.\-]/g, ""));

    if (Number.isFinite(rate) && Number.isFinite(price)) {
      grid.push({ rate, price });
    }
  }

  return grid;
}

