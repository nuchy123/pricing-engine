document.addEventListener("DOMContentLoaded", () => {
  const zipInput = document.getElementById("zip");
  const locationDisplay = document.getElementById("locationDisplay");

  // ZIP → City / State autofill
  zipInput.addEventListener("change", () => {
    const zip = zipInput.value.trim();
    if (!/^\d{5}$/.test(zip)) {
      locationDisplay.value = "";
      return;
    }

    fetch(`https://api.zippopotam.us/us/${zip}`)
      .then(res => res.json())
      .then(data => {
        const place = data.places ? data.places[0] : null;
        if (!place) return;
        const city = place["place name"];
        const state = place["state abbreviation"];
        locationDisplay.value = `${city}, ${state}`;
      })
      .catch(() => {
        locationDisplay.value = "ZIP not found";
      });
  });

  const runBtn = document.getElementById("runPrice");
  runBtn.addEventListener("click", () => {
    // NOTE: This now ONLY shows rate + payment

    // Dummy pulled base pricing placeholder until XLS parser completes
    const calculatedRate = 6.50; 
    const loanAmount = parseFloat(document.getElementById("loan").value || 630000);

    // monthly payment calc
    const monthly = (loanAmount * (calculatedRate / 100 / 12)) /
      (1 - Math.pow(1 + calculatedRate / 100 / 12, -360));

    // Push to display
    document.getElementById("rateBox").innerHTML = `<strong>${calculatedRate.toFixed(3)}%</strong>`;
    document.getElementById("paymentBox").innerHTML = `<strong>$${monthly.toLocaleString(undefined, {maximumFractionDigits: 2})}</strong>`;
  });
});
