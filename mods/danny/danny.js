/*danny*/
(function () {
  "use strict";
  function tryInit() {
    if (typeof setup === "undefined" || typeof window.registerModLI !== "function") {
      setTimeout(tryInit, 200);
      return;
    }
    try { window.registerModLI("Danny"); } catch (e) {}
    if (Array.isArray(setup.NPCNameList) && setup.NPCNameList.indexOf("Danny") === -1) {
      setup.NPCNameList.push("Danny");
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryInit);
  } else {
    tryInit();
  }
})();
/*/danny*/
