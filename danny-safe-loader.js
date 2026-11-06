/**
 * Danny – safe post-init registration
 * Registers via setup.modLIRegistry and ensures an $NPCName slot.
 * Only runs after SugarCube / State / setup exist.
 * Hard retry limit. No arguments.callee. No early side effects.
 */
(function () {
  "use strict";

  var attempts = 0;
  var MAX = 50;

  function ready() {
    return typeof setup !== "undefined" &&
           typeof State !== "undefined" && State.variables &&
           typeof Story !== "undefined";
  }

  function registerDanny() {
    var NAME = "Danny";

    // 1. modLIRegistry (molded / modded love interest path)
    if (!Array.isArray(setup.modLIRegistry)) setup.modLIRegistry = [];
    if (setup.modLIRegistry.indexOf(NAME) === -1) {
      setup.modLIRegistry.push(NAME);
    }

    // Metadata for any CONFIGS / guarantor that looks for it
    setup.dannyMetadata = {
      title: "dependent",
      insecurity: "weak",
      adult: 0,
      teen: 1,
      type: "human"
    };

    var V = State.variables;
    if (!Array.isArray(V.NPCNameList)) V.NPCNameList = [];
    if (!Array.isArray(V.NPCName)) V.NPCName = [];

    if (V.NPCNameList.indexOf(NAME) === -1) {
      V.NPCNameList.push(NAME);
      V.NPCName.push({
        nam: NAME,
        init: 0, intro: 0, aware: 0, name_known: 0,
        description: NAME, fullDescription: NAME,
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
    }

    if (!V.modLIUnlocks || typeof V.modLIUnlocks !== "object") V.modLIUnlocks = {};
    V.modLIUnlocks[NAME] = true;

    // Minimal passages so the slot is usable
    if (typeof Story.add === "function") {
      if (!Story.has("Danny Room")) {
        Story.add({
          name: "Danny Room",
          tags: "danny",
          content: 'Danny\'s room.\n<<link "Leave">><<goto "Orphanage Hallway">><</link>>'
        });
      }
      if (!Story.has("Danny First Meeting")) {
        Story.add({
          name: "Danny First Meeting",
          tags: "danny",
          content: '<<npc "Danny">> looks up. "Hey... I\'m Danny."\n<<link "Continue">><<goto "Orphanage Main Hall">><</link>>'
        });
      }
    }

    console.log("[Danny] Registered via modLIRegistry");
  }

  function tryInit() {
    attempts++;
    if (ready()) {
      try {
        registerDanny();
      } catch (e) {
        console.warn("[Danny] Registration failed:", e);
      }
      return;
    }
    if (attempts < MAX) {
      setTimeout(tryInit, 400);
    } else {
      console.warn("[Danny] Timed out waiting for game");
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
