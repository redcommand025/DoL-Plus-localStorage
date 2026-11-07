/**
 * Danny – aggressive post-init registration
 * Forces registerModLI and re-registers on settings refresh.
 */
(function () {
  "use strict";

  var attempts = 0;
  var MAX = 100;
  var registered = false;

  function log(msg) {
    console.log("[Danny] " + msg);
    try {
      if (window.parent && window.parent !== window && window.parent.document) {
        var bar = window.parent.document.getElementById("bar");
        if (bar) bar.textContent = "[Danny] " + msg;
      }
    } catch (e) {}
  }

  function ready() {
    return typeof setup !== "undefined" &&
           typeof State !== "undefined" && State.variables &&
           typeof window.registerModLI === "function";
  }

  function doRegister() {
    try {
      window.registerModLI("Danny");
      var V = State.variables;
      if (!V.modLIUnlocks || typeof V.modLIUnlocks !== "object") V.modLIUnlocks = {};
      // Do not auto-activate
      registered = true;
      var avail = (window.getAvailableModLIs && window.getAvailableModLIs()) || [];
      log("Registered. Available: " + avail.join(", "));
    } catch (e) {
      log("register failed: " + e.message);
    }
  }

  function tryInit() {
    attempts++;
    if (ready()) {
      doRegister();
      // Hook ensureModLISettings so it stays registered
      if (typeof window.ensureModLISettings === "function" && !window._dannyHooked) {
        var orig = window.ensureModLISettings;
        window.ensureModLISettings = function () {
          var ret = orig.apply(this, arguments);
          try { window.registerModLI("Danny"); } catch (e) {}
          return ret;
        };
        window._dannyHooked = true;
      }
      return;
    }
    if (attempts < MAX) {
      setTimeout(tryInit, 400);
    } else {
      log("Timed out waiting for modLI API");
    }
  }

  setTimeout(tryInit, 300);
})();
