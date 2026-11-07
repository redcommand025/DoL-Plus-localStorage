/**
 * Danny – safe post-init registration via official modLI API
 * Calls registerModLI("Danny") so it appears in the Mod-exclusive LI section.
 * Hard retry limit. No early side effects.
 */
(function () {
  "use strict";

  var attempts = 0;
  var MAX = 60;
  var registered = false;

  function ready() {
    return typeof setup !== "undefined" &&
           typeof State !== "undefined" && State.variables &&
           typeof window.registerModLI === "function";
  }

  function doRegister() {
    if (registered) return;
    try {
      window.registerModLI("Danny");
      // Ensure unlocks object exists
      var V = State.variables;
      if (!V.modLIUnlocks || typeof V.modLIUnlocks !== "object") V.modLIUnlocks = {};
      // Do not auto-activate; leave it available for the user to click in the settings panel
      registered = true;
      console.log("[Danny] registerModLI complete. Available:", window.getAvailableModLIs && window.getAvailableModLIs());
    } catch (e) {
      console.warn("[Danny] registerModLI failed:", e);
    }
  }

  function tryInit() {
    attempts++;
    if (ready()) {
      doRegister();
      return;
    }
    if (attempts < MAX) {
      setTimeout(tryInit, 500);
    } else {
      console.warn("[Danny] Timed out waiting for modLI API");
    }
  }

  // Also re-register if the settings panel is refreshed later
  if (typeof window.ensureModLISettings === "function") {
    var orig = window.ensureModLISettings;
    window.ensureModLISettings = function () {
      var ret = orig.apply(this, arguments);
      if (typeof window.registerModLI === "function") {
        try { window.registerModLI("Danny"); } catch (e) {}
      }
      return ret;
    };
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(tryInit, 200);
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(tryInit, 200);
    });
  }
})();
