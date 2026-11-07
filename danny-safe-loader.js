/**
 * Danny – safe post-init registration
 * Uses <<newNamedNpc>> so the slot is a proper clone of setup.baseNNPC
 * and $NPCName / $NPCNameList stay in sync.
 * Does NOT touch setup.NPCNameList until the slot exists.
 */
(function () {
  "use strict";

  var attempts = 0;
  var MAX = 80;
  var done = false;

  function ready() {
    return typeof setup !== "undefined" &&
           typeof State !== "undefined" && State.variables &&
           typeof window.registerModLI === "function" &&
           typeof Wikifier !== "undefined" &&
           typeof Story !== "undefined";
  }

  function registerDanny() {
    if (done) return;
    var NAME = "Danny";
    var V = State.variables;

    // 1. Exclusive LI registry
    try { window.registerModLI(NAME); } catch (e) {}

    // 2. Ensure lists exist
    if (!Array.isArray(V.NPCNameList)) V.NPCNameList = [];
    if (!Array.isArray(V.NPCName)) V.NPCName = [];

    // 3. Use the game's own newNamedNpc widget (clones baseNNPC)
    if (V.NPCNameList.indexOf(NAME) === -1) {
      try {
        Wikifier.wikifyEval(
          '<<newNamedNpc {nam: "Danny", title: "dependent", insecurity: "weak", teen: 1, adult: 0, type: "human", pronoun: "f", gender: "f", maxOrgasms: 1}>>'
        );
      } catch (e) {
        console.warn("[Danny] newNamedNpc failed:", e);
      }
    }

    // 4. Verify and patch if needed
    var idx = V.NPCNameList.indexOf(NAME);
    if (idx !== -1 && V.NPCName[idx]) {
      var slot = V.NPCName[idx];
      if (slot.nam === undefined) slot.nam = NAME;
      if (slot.title === undefined) slot.title = "dependent";
      if (slot.pronoun === undefined) slot.pronoun = "f";
      if (slot.maxOrgasms === undefined) slot.maxOrgasms = 1;
      if (slot.gender === undefined) slot.gender = "f";
      // custom fields
      if (slot.control === undefined) slot.control = 30;
      if (slot.dependency === undefined) slot.dependency = 20;
      if (slot.bladder === undefined) slot.bladder = 0;
      if (slot.diaperState === undefined) slot.diaperState = "dry";
    } else {
      console.warn("[Danny] Slot still missing after newNamedNpc");
      return; // don't mark done so we can retry
    }

    // 5. Now safe to add to setup.NPCNameList (for future new games)
    if (Array.isArray(setup.NPCNameList) && setup.NPCNameList.indexOf(NAME) === -1) {
      setup.NPCNameList.push(NAME);
    }

    done = true;
    console.log("[Danny] Registered cleanly. Index:", idx, "nam:", V.NPCName[idx].nam);
  }

  function tryInit() {
    attempts++;
    if (ready()) {
      registerDanny();
      if (done) return;
    }
    if (attempts < MAX) setTimeout(tryInit, 500);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(tryInit, 500);
  } else {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(tryInit, 500); });
  }
})();
