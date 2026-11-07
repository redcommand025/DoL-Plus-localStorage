/**
 * Danny – safe post-init registration
 * Creates a complete $NPCName slot so npcSettingsMenu does not crash.
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
           Array.isArray(setup.NPCNameList) &&
           typeof Story !== "undefined";
  }

  function makeFullSlot() {
    // Match the fields npcSettingsMenu and baseNNPC expect
    return {
      nam: "Danny",
      description: "Danny",
      fullDescription: "Danny",
      title: "dependent",
      insecurity: "weak",
      pronoun: "f",
      gender: "f",
      adult: 0,
      teen: 1,
      type: "human",
      init: 0,
      intro: 0,
      aware: 0,
      name_known: 0,
      love: 0,
      lust: 0,
      dom: 0,
      trauma: 0,
      rage: 0,
      trust: 0,
      purity: 0,
      corruption: 0,
      penis: 0,
      vagina: 1,
      penissize: 0,
      penisdesc: "none",
      breastsize: 2,
      breastdesc: 0,
      breastsdesc: 0,
      bottomsize: 0,
      ballssize: 0,
      maxOrgasms: 1,
      orgasm: 0,
      skincolour: "white",
      eyeColour: "blue",
      hairColour: "brown",
      chastity: { penis: "", vagina: "", anus: "" },
      control: 30,
      dependency: 20,
      bladder: 0,
      diaperState: "dry",
      accidentCount: 0
    };
  }

  function registerDanny() {
    if (done) return;
    var NAME = "Danny";

    try { window.registerModLI(NAME); } catch (e) {}

    // Keep setup.NPCNameList in sync
    if (setup.NPCNameList.indexOf(NAME) === -1) {
      setup.NPCNameList.push(NAME);
    }

    var V = State.variables;
    if (!Array.isArray(V.NPCNameList)) V.NPCNameList = [];
    if (!Array.isArray(V.NPCName)) V.NPCName = [];

    var idx = V.NPCNameList.indexOf(NAME);
    var slot = makeFullSlot();

    if (idx === -1) {
      V.NPCNameList.push(NAME);
      V.NPCName.push(slot);
    } else {
      // Patch existing slot so required fields exist
      var existing = V.NPCName[idx] || {};
      for (var k in slot) {
        if (existing[k] === undefined) existing[k] = slot[k];
      }
      V.NPCName[idx] = existing;
    }

    // Skeleton passages (unchanged)
    if (typeof Story.add === "function" && !Story.has("Danny Room")) {
      Story.add({
        name: "Danny Room",
        tags: "danny",
        content: 'Danny\\\'s room.\\n<<link "Leave">><<goto "Orphanage Hallway">><</link>>'
      });
    }

    done = true;
    console.log("[Danny] Full slot registered. Index:", V.NPCNameList.indexOf(NAME));
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
