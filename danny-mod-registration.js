/**
 * Danny – Modded Love Interest registration & slot defaults
 * Safe loader – waits for SugarCube, no infinite loops.
 */
(function () {
  "use strict";

  const NAME = "Danny";
  let attempts = 0;
  const MAX = 60; // ~30s

  function tryRegister() {
    attempts++;
    if (typeof setup === "undefined" || typeof State === "undefined" || !State.variables) {
      if (attempts < MAX) setTimeout(tryRegister, 500);
      return;
    }

    if (!Array.isArray(setup.modLIRegistry)) setup.modLIRegistry = [];
    if (!setup.modLIRegistry.includes(NAME)) setup.modLIRegistry.push(NAME);

    setup.dannyMetadata = {
      title: "dependent",
      insecurity: "weak",
      adult: 0,
      teen: 1,
      type: "human",
      patience: 80,
      anger: 0
    };

    function buildDannyDefaults() {
      return {
        nam: NAME, init: 0, intro: 0, aware: 0, name_known: 0,
        description: NAME, fullDescription: NAME, pronoun: "f",
        title: "dependent", insecurity: "weak", adult: 0, teen: 1, type: "human",
        love: 0, lust: 0, dom: 0, trauma: 0, rage: 0, trust: 0, purity: 0, corruption: 0,
        control: 30, dependency: 20, bladder: 0, accidentCount: 0, diaperState: "dry",
        virginity: { vaginal: true, penile: true, anal: true, oral: true, handholding: true },
        timer: {}, maxOrgasms: 1, orgasm: 0, promiscuity: 0,
        skincolour: "white", haircolour: "brown", eyecolour: "blue",
        breastsize: 2, penissize: 0,
        pregnancy: { type: "none", timer: 0, enabled: false, fetus: [] }
      };
    }

    const V = State.variables;
    if (!Array.isArray(V.NPCNameList)) V.NPCNameList = [];
    if (!Array.isArray(V.NPCName)) V.NPCName = [];

    if (!V.NPCNameList.includes(NAME)) {
      V.NPCNameList.push(NAME);
      V.NPCName.push(buildDannyDefaults());
      if (!V.modLIUnlocks || typeof V.modLIUnlocks !== "object") V.modLIUnlocks = {};
      V.modLIUnlocks[NAME] = true;
    }

    console.log("[Danny Mod] Registration complete");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryRegister);
  } else {
    tryRegister();
  }
})();
