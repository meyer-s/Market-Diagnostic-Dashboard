(function () {
  var storageKey = "market-diagnostic.theme-preview";
  var allowedThemes = ["evidence", "ledger", "observatory"];
  var themeColors = {
    evidence: "#0e1520",
    ledger: "#0a1420",
    observatory: "#071619"
  };
  var theme = "evidence";

  try {
    var savedTheme = window.localStorage.getItem(storageKey);
    if (savedTheme && allowedThemes.indexOf(savedTheme) !== -1) {
      theme = savedTheme;
    }
  } catch (error) {
    // Evidence Field remains the safe default when storage is unavailable.
  }

  document.documentElement.setAttribute("data-theme", theme);

  var themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", themeColors[theme]);
  }
})();
