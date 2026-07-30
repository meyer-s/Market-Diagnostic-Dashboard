(function () {
  var storageKey = "market-diagnostic.theme-preview";

  try {
    window.localStorage.setItem(storageKey, "evidence");
  } catch (error) {
    // Evidence Field remains the safe default when storage is unavailable.
  }

  document.documentElement.setAttribute("data-theme", "evidence");

  var themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", "#0e1520");
  }
})();
