// Key used for storing the parsed pricing model in localStorage
const MODEL_KEY = "tpoPricingModel_v1";

// Show status messages in the admin panel
function setAdminStatus(msg, isError = false) {
  const box = document.getElementById("adminStatus");
  if (!box) return;
  box.textContent = msg;
  box.style.backgroundColor = isError ? "#fef2f2" : "#eff6ff";
  box.style.color = isError ? "#b91c1c" : "#1d4ed8";
  box.style.borderColor = isError ? "#fecaca" : "#bfdbfe";
}

// Parse the workbook and build a simple base grid model
function buildModelFromWorkbook(workbook) {
  // For now: use the first sheet and look for "CONVENTIONAL PRICING" / "CONFORMING 30 YEAR FIXED"
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

    // Parse rate as number (e.g. 6.500) and price as float (e.g. 101.974)
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

  // Model structure is simple for now, but can be extended later
  const model = {
    lastUpdated: new Date().toISOString(),
    sourceSheet: firstSheetName,
    programs: {
      conf_30: {
        id: "conf_30",
        label: "Conforming 30 Year Fixed",
        baseGrid // array of { rate, price }
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

      // This supports .xls AND .xlsx when using xlsx.full.min.js
      const workbook = XLSX.read(data, { type: "array" });

      const model = buildModelFromWorkbook(workbook);

      // Persist in localStorage so the front-end pricing page can use it
      localStorage.setItem(MODEL_KEY, JSON.stringify(model));

      setAdminStatus(
        `Loaded ${file.name}. Found ${model.programs.conf_30.baseGrid.length} Conforming 30 Year Fixed rows (30-Day column).`
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

  // Read as ArrayBuffer so it works for both .xls and .xlsx
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
