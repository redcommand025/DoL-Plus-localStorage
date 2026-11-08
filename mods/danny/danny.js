/*danny*/
(function () {
  "use strict";
  function ensureExtras() {
    if (typeof setup === "undefined") return false;
    if (typeof window.registerModLI === "function") {
      try { window.registerModLI("Danny"); } catch (e) {}
    }
    if (!setup.loveAlias) setup.loveAlias = {};
    if (typeof setup.loveAlias.Danny !== "function") {
      setup.loveAlias.Danny = function () { return "Love"; };
    }
    return true;
  }
  function tryInit() {
    if (ensureExtras()) return;
    setTimeout(tryInit, 300);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryInit);
  } else {
    tryInit();
  }
})();
/*/danny*/
