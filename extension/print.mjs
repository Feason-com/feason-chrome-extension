const sheet = document.getElementById("studySheet");
const button = document.getElementById("printButton");
const { studyExport } = await chrome.storage.session.get("studyExport");
sheet.textContent =
  studyExport || "Open Feason’s Studies tab to prepare a study sheet.";
button.disabled = !studyExport;
button.addEventListener("click", () => window.print());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.feasonAuthToken) {
    sheet.textContent =
      "Your sign-in changed. Prepare this export again from Feason.";
    button.disabled = true;
  }
});
