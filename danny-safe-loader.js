/**
 * Danny – safe post-init registration
 * - registerModLI("Danny") for the exclusive LI section
 * - adds to setup.NPCNameList so Named NPC Settings (gender/genitalia) lists them
 * - ensures a matching $NPCName slot
 */
(function () {
  "use strict";

  var attempts = 0;
  var MAX = 60;
  var done = false;

  function ready() {
    return typeof setup !== "undefined" &&
           typeof State !== "undefined" && State.variables &&
           typeof window.registerModLI === "function" &&
           Array.isArray(setup.NPCNameList);
  }

  function registerDanny() {
    if (done) return;
    var NAME = "Danny";

    // 1. Mod exclusive LI
    try { window.registerModLI(NAME); } catch (e) { console.warn(e); }

    // 2. Named NPC list (gender/genitalia settings iterate this)
    if (setup.NPCNameList.indexOf(NAME) === -1) {
      setup.NPCNameList.push(NAME);
    }

    // 3. Ensure $NPCName / $NPCNameList slot
    var V = State.variables;
    if (!Array.isArray(V.NPCNameList)) V.NPCNameList = [];
    if (!Array.isArray(V.NPCName)) V.NPCName = [];

    if (V.NPCNameList.indexOf(NAME) === -1) {
      // Prefer the game's newNamedNpc if available
      if (typeof Wikifier !== "undefined" && Wikifier.wikifyEval) {
        try {
          Wikifier.wikifyEval('<<newNamedNpc {nam: "Danny", title: "dependent", insecurity: "weak", teen: 1, adult: 0, type: "human"}>>');
        } catch (e) {
          console.warn("[Danny] newNamedNpc failed, falling back", e);
        }
      }
      // Fallback manual slot if still missing
      if (V.NPCNameList.indexOf(NAME) === -1) {
        V.NPCNameList.push(NAME);
        V.NPCName.push({
          nam: NAME, description: NAME, title: "dependent", insecurity: "weak",
          pronoun: "f", gender: "f", adult: 0, teen: 1, type: "human",
          love: 0, lust: 0, init: 0, intro: 0,
          penis: 0, vagina: 1, penissize: 0, breastsize: 2,
          control: 30, dependency: 20, bladder: 0, diaperState: "dry"
        });
      }
    }

    if (!V.modLIUnlocks || typeof V.modLIUnlocks !== "object") V.modLIUnlocks = {};
    // leave unlocked state to the user

    done = true;
    console.log("[Danny] Registered. In NPCNameList:", setup.NPCNameList.indexOf(NAME) !== -1);
  }

  function tryInit() {
    attempts++;
    if (ready()) {
      registerDanny();
      return;
    }
    if (attempts < MAX) setTimeout(tryInit, 500);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(tryInit, 300);
  } else {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(tryInit, 300); });
  }
})();
