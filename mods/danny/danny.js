/*danny*/
(function () {
  "use strict";
  function ensureDanny() {
    if (typeof setup === "undefined" || typeof State === "undefined" || !State.variables) return false;
    var V = State.variables;
    if (!Array.isArray(setup.NPCNameList)) return false;
    if (!Array.isArray(V.NPCNameList)) V.NPCNameList = [];
    if (!Array.isArray(V.NPCName)) V.NPCName = [];

    if (typeof window.registerModLI === "function") {
      try { window.registerModLI("Danny"); } catch (e) {}
    }

    if (setup.NPCNameList.indexOf("Danny") === -1) {
      setup.NPCNameList.push("Danny");
    }

    var idx = V.NPCNameList.indexOf("Danny");
    if (idx === -1) {
      V.NPCNameList.push("Danny");
      var slot = {
        nam: "Danny", description: "Danny", title: "dependent", insecurity: "weak",
        pronoun: "f", gender: "f", adult: 0, teen: 1, type: "human",
        init: 1, intro: 0, aware: 0, love: 0, lust: 0, dom: 0,
        trust: 0, trauma: 0, rage: 0, purity: 0, corruption: 0,
        penis: 0, vagina: 1, maxOrgasms: 1,
        chastity: { penis: "", vagina: "", anus: "" }
      };
      V.NPCName.push(slot);
    }

    if (typeof window.initCNPC === "function") {
      try { window.initCNPC(); } catch (e) {}
    }

    // Social tab needs a loveAlias function
    if (!setup.loveAlias) setup.loveAlias = {};
    if (typeof setup.loveAlias.Danny !== "function") {
      setup.loveAlias.Danny = function () { return "Love"; };
    }

    return true;
  }

  function tryInit() {
    if (ensureDanny()) return;
    setTimeout(tryInit, 300);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryInit);
  } else {
    tryInit();
  }
})();
/*/danny*/
