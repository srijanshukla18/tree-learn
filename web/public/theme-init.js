// Runs before first paint so the page never flashes the wrong theme. Kept as a file (not inline) to satisfy the CSP.
(function () {
  try {
    var pref = localStorage.getItem("tree-learn:theme") || "system";
    var light = pref === "light" || (pref === "system" && matchMedia("(prefers-color-scheme: light)").matches);
    document.documentElement.dataset.theme = light ? "light" : "dark";
  } catch (e) {}
})();
