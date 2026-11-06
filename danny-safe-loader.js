/**
 * Danny – safe post-init loader
 * Only runs after SugarCube / State / setup exist.
 * Hard retry limit, no arguments.callee, no early side effects.
 */
(function () {
  "use strict";

  var attempts = 0;
  var MAX = 40; // ~20–40s

  function ready() {
    return typeof setup !== "undefined" &&
           typeof State !== "undefined" && State.variables &&
           typeof Story !== "undefined";
  }

  function registerDanny() {
    if (!Array.isArray(setup.modLIRegistry)) setup.modLIRegistry = [];
    if (setup.modLIRegistry.indexOf("Danny") === -1) {
      setup.modLIRegistry.push("Danny");
    }

    var V = State.variables;
    if (!Array.isArray(V.NPCNameList)) V.NPCNameList = [];
    if (!Array.isArray(V.NPCName)) V.NPCName = [];

    if (V.NPCNameList.indexOf("Danny") === -1) {
      V.NPCNameList.push("Danny");
      V.NPCName.push({
        nam: "Danny",
        init: 0, intro: 0, aware: 0, name_known: 0,
        description: "Danny", fullDescription: "Danny",
        pronoun: "f",
        title: "dependent", insecurity: "weak",
        adult: 0, teen: 1, type: "human",
        love: 0, lust: 0, dom: 0, trauma: 0, rage: 0,
        trust: 0, purity: 0, corruption: 0,
        control: 30, dependency: 20,
        bladder: 0, accidentCount: 0, diaperState: "dry",
        virginity: { vaginal: true, penile: true, anal: true, oral: true, handholding: true },
        timer: {}, maxOrgasms: 1, orgasm: 0, promiscuity: 0,
        skincolour: "white", haircolour: "brown", eyecolour: "blue",
        breastsize: 2, penissize: 0,
        pregnancy: { type: "none", timer: 0, enabled: false, fetus: [] }
      });
      if (!V.modLIUnlocks || typeof V.modLIUnlocks !== "object") V.modLIUnlocks = {};
      V.modLIUnlocks.Danny = true;
    }

    // Minimal passages
    if (typeof Story.add === "function" && !Story.has("Danny Room")) {
      Story.add({
        name: "Danny Room",
        tags: "danny",
        content: 'You are in Danny\'s room.\n<<link "Leave">><<goto "Orphanage Hallway">><</link>>'
      });
    }

    console.log("[Danny] Safe registration complete");
  }

  function tryInit() {
    attempts++;
    if (ready()) {
      try {
        registerDanny();
      } catch (e) {
        console.warn("[Danny] Registration error:", e);
      }
      return;
    }
    if (attempts < MAX) {
      setTimeout(tryInit, 500);
    } else {
      console.warn("[Danny] Gave up waiting for SugarCube");
    }
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(tryInit, 100);
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      setTimeout(tryInit, 100);
    });
  }
})();
