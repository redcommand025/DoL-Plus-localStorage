/**
 * Danny – safe post-init registration + skeleton schedule/interactions
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

  function addPassage(name, content) {
    if (Story.has(name)) return;
    try {
      Story.add({ name: name, tags: "danny", content: content });
    } catch (e) {
      console.warn("[Danny] passage failed", name, e);
    }
  }

  function registerDanny() {
    if (done) return;
    var NAME = "Danny";

    try { window.registerModLI(NAME); } catch (e) {}

    if (setup.NPCNameList.indexOf(NAME) === -1) {
      setup.NPCNameList.push(NAME);
    }

    var V = State.variables;
    if (!Array.isArray(V.NPCNameList)) V.NPCNameList = [];
    if (!Array.isArray(V.NPCName)) V.NPCName = [];

    if (V.NPCNameList.indexOf(NAME) === -1) {
      V.NPCNameList.push(NAME);
      V.NPCName.push({
        nam: NAME, description: NAME, title: "dependent", insecurity: "weak",
        pronoun: "f", gender: "f", adult: 0, teen: 1, type: "human",
        love: 0, lust: 0, init: 0, intro: 0, aware: 0,
        control: 30, dependency: 20, bladder: 0, diaperState: "dry"
      });
    }

    // Skeleton passages
    addPassage("Danny Room Door", `
<<if $time gte 1260 or $time lt 420>>
  A note: "Sleeping. Please don't wake me."
  <<link "Wait until morning">><<set $time to 420>><<goto "Danny Room Door">><</link>>
<<elseif $schoolDay and $time gte 480 and $time lt 900>>
  A note: "At school. Back later."
  <<link "Leave">><<goto "Orphanage Hallway">><</link>>
<<else>>
  <<link "Knock and enter">><<goto "Danny Room">><</link>>
  <<link "Leave">><<goto "Orphanage Hallway">><</link>>
<</if>>
    `);

    addPassage("Danny Room", `
You enter Danny's room. <<npc "Danny">> looks up.
<<if $dannyIntro isnot 1>>
  <<set $dannyIntro to 1>>
  "H-hey... I'm Danny. I live here too. I... have a weak bladder. Please don't tell Bailey."
  <<love "Danny" 5>>
<</if>>
<<link "Talk">><<love "Danny" 2>><<goto "Danny Room">><</link>>
<<link "Help with control training">><<set $danny.control += 5>><<love "Danny" 3>><<goto "Danny Room">><</link>>
<<link "Offer dependency care">><<set $danny.dependency += 5>><<love "Danny" 4>><<goto "Danny Room">><</link>>
<<link "Leave">><<goto "Orphanage Hallway">><</link>>
    `);

    addPassage("Danny First Meeting Canteen", `
In the canteen Danny nearly bumps into you.
"S-sorry! I'm Danny. We both live at the orphanage, right?"
<<link "Continue">><<set $dannyIntro to 1>><<goto "School Canteen">><</link>>
    `);

    // Simple schedule flags
    window.updateDannySchedule = function () {
      if (typeof State === "undefined") return;
      var V = State.variables;
      var hour = Math.floor(V.time / 60);
      V.dannySleeping = (hour >= 21 || hour < 7);
      V.dannyAtSchool = (hour >= 8 && hour < 15 && V.schoolDay);
    };

    done = true;
    console.log("[Danny] Registered + skeleton schedule/passages ready");
    console.log("[Danny] Test passages: Danny Room Door, Danny Room, Danny First Meeting Canteen");
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
