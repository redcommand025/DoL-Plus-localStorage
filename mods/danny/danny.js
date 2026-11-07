/*danny*/
(function () {
  "use strict";
  var fullyReady = false;

  function isInGame() {
    try {
      var p = State && State.passage;
      return p && p !== "Start" && p !== "Start2" && p !== "Tutorial" && p !== "Character Creation";
    } catch (e) { return false; }
  }

  function ensureDanny() {
    if (typeof setup === "undefined" || typeof State === "undefined" || !State.variables) return false;
    var V = State.variables;

    // Always safe: mod LI registry + loveAlias
    if (typeof window.registerModLI === "function") {
      try { window.registerModLI("Danny"); } catch (e) {}
    }
    if (!setup.loveAlias) setup.loveAlias = {};
    if (typeof setup.loveAlias.Danny !== "function") {
      setup.loveAlias.Danny = function () { return "Love"; };
    }

    // Only touch NPC lists once we're past the Start/Tutorial screens
    if (!isInGame()) return true;
    if (fullyReady) return true;
    if (!Array.isArray(setup.NPCNameList)) return false;
    if (!Array.isArray(V.NPCNameList)) V.NPCNameList = [];
    if (!Array.isArray(V.NPCName)) V.NPCName = [];

    if (setup.NPCNameList.indexOf("Danny") === -1) {
      setup.NPCNameList.push("Danny");
    }

    var idx = V.NPCNameList.indexOf("Danny");
    if (idx === -1) {
      V.NPCNameList.push("Danny");
      V.NPCName.push({
        nam: "Danny", description: "Danny", title: "dependent", insecurity: "weak",
        pronoun: "f", gender: "f", adult: 0, teen: 1, type: "human",
        init: 1, intro: 0, aware: 0, love: 0, lust: 0, dom: 0,
        trust: 0, trauma: 0, rage: 0, purity: 0, corruption: 0,
        penis: 0, vagina: 1, maxOrgasms: 1,
        chastity: { penis: "", vagina: "", anus: "" },
        virginity: { vaginal: true, penile: true, anal: true, kiss: true, handholding: true },
        patience: 0, anger: 0
      });
    }

    if (typeof window.initCNPC === "function") {
      try { window.initCNPC(); } catch (e) {}
    }

    fullyReady = true;
    return true;
  }

  function tryInit() {
    ensureDanny();
    if (!fullyReady) setTimeout(tryInit, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryInit);
  } else {
    tryInit();
  }
})();
/*/danny*/
