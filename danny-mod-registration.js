/**
 * Danny – Modded Love Interest registration & slot defaults
 * Drop-in for Degrees of Lewdity Plus (push-style overlay)
 *
 * Registers Danny in setup.modLIRegistry, supplies CONFIGS metadata,
 * and ensures a proper $NPCName slot with diaper/control state.
 *
 * Load after the base game has initialised SugarCube / setup.
 */

(function () {
  "use strict";

  // Ensure registry exists
  if (typeof setup === "undefined") window.setup = {};
  if (!Array.isArray(setup.modLIRegistry)) setup.modLIRegistry = [];

  const NAME = "Danny";

  if (!setup.modLIRegistry.includes(NAME)) {
    setup.modLIRegistry.push(NAME);
  }

  // Metadata used by the modLI guarantor (extend CONFIGS pattern)
  const DANNY_METADATA = {
    title: "dependent",
    insecurity: "weak",
    adult: 0,
    teen: 1,
    type: "human",
    patience: 80,
    anger: 0
  };

  // Expose for the Widgets modLI CONFIGS merge if needed
  setup.dannyMetadata = DANNY_METADATA;

  // Slot defaults (called by guarantor or manually)
  function buildDannyDefaults() {
    return {
      nam: NAME,
      init: 0,
      intro: 0,
      aware: 0,
      name_known: 0,
      description: NAME,
      fullDescription: NAME,
      pronoun: "f",
      title: DANNY_METADATA.title,
      insecurity: DANNY_METADATA.insecurity,
      adult: DANNY_METADATA.adult,
      teen: DANNY_METADATA.teen,
      type: DANNY_METADATA.type,
      love: 0,
      lust: 0,
      dom: 0,
      trauma: 0,
      rage: 0,
      trust: 0,
      purity: 0,
      corruption: 0,
      control: 30,          // 0–100, higher = better bladder control
      dependency: 20,       // rises if player encourages diaper reliance
      bladder: 0,           // current fullness tracker
      accidentCount: 0,
      diaperState: "dry",   // dry / wet / soiled / changed
      virginity: {
        vaginal: true,
        penile: true,
        anal: true,
        oral: true,
        handholding: true
      },
      timer: {},
      maxOrgasms: 1,
      orgasm: 0,
      promiscuity: 0,
      skincolour: "white",
      haircolour: "brown",
      eyecolour: "blue",
      breastsize: 2,
      penissize: 0,
      pregnancy: { type: "none", timer: 0, enabled: false, fetus: [] }
    };
  }

  // Ensure slot exists once SugarCube State is available
  function ensureDannySlot() {
    if (typeof State === "undefined" || !State.variables) return;
    const V = State.variables;
    if (!Array.isArray(V.NPCNameList)) V.NPCNameList = [];
    if (!Array.isArray(V.NPCName)) V.NPCName = [];

    if (!V.NPCNameList.includes(NAME)) {
      V.NPCNameList.push(NAME);
      V.NPCName.push(buildDannyDefaults());
      if (typeof V.modLIUnlocks !== "object" || V.modLIUnlocks === null) {
        V.modLIUnlocks = {};
      }
      V.modLIUnlocks[NAME] = true;
    } else {
      // Patch missing fields on existing slot
      const idx = V.NPCNameList.indexOf(NAME);
      const slot = V.NPCName[idx];
      const defaults = buildDannyDefaults();
      for (const k in defaults) {
        if (slot[k] === undefined) slot[k] = defaults[k];
      }
    }
  }

  // Hook into common init points
  if (typeof window.ensureModLISettings === "function") {
    const orig = window.ensureModLISettings;
    window.ensureModLISettings = function () {
      orig.apply(this, arguments);
      ensureDannySlot();
    };
  }

  // Also run on next passage or when State becomes ready
  const tryInit = function () {
    if (typeof State !== "undefined" && State.variables) {
      ensureDannySlot();
    } else {
      setTimeout(tryInit, 500);
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryInit);
  } else {
    tryInit();
  }

  console.log("[Danny Mod] Registration complete – Danny added to modLIRegistry");
})();
