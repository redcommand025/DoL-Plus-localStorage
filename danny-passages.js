/**
 * Danny Full Integration – Passage & Event Overlay
 * Degrees of Lewdity Plus (SugarCube 2.36)
 *
 * Injects first meetings, schedule hooks, relationship interactions,
 * control vs dependency paths, and quest skeleton.
 *
 * Requires danny-mod-registration.js to have run first.
 * Load this after SugarCube is ready (e.g. via userscript or after init).
 */

(function () {
  "use strict";

  if (typeof Story === "undefined" || typeof SugarCube === "undefined") {
    console.warn("[Danny] SugarCube not ready – retrying...");
    setTimeout(arguments.callee, 1000);
    return;
  }

  const NAME = "Danny";

  // Helper to add a passage if it doesn't exist
  function addPassage(name, tags, content) {
    if (Story.has(name)) return;
    Story.add({
      name: name,
      tags: tags || "",
      content: content
    });
  }

  // ========== FIRST MEETINGS ==========

  addPassage("Danny First Meeting Orphanage", "danny,orphanage,first", `
<<if $dannyIntro isnot 1>>
  <<set $dannyIntro to 1>>
  You hear a soft, embarrassed voice from the main hall.
  <<npc "Danny">> is standing near the bathroom door, shifting uncomfortably and clutching a bag.
  "H-hey... you're the new one, right? I'm Danny. I... um... live here too."
  They glance down, cheeks flushed. "Bailey doesn't make it easy. And I... have a bit of a problem."
  <<link "Ask what's wrong">><<goto "Danny First Meeting Orphanage Explain">><</link>>
  <<link "Just say hi and leave">><<goto "Orphanage Main Hall">><</link>>
<<else>>
  <<goto "Orphanage Main Hall">>
<</if>>
  `);

  addPassage("Danny First Meeting Orphanage Explain", "danny", `
  Danny hesitates, then lowers their voice.
  "I have a weak bladder. I... need diapers sometimes. It's not by choice. Please don't tell Bailey."
  They look at you hopefully. "You can visit my room anytime. Just... knock first, okay?"
  <<set $dannyAware to 1>>
  <<love "Danny" 5>>
  <<link "Promise to keep it quiet">><<goto "Orphanage Main Hall">><</link>>
  `);

  addPassage("Danny First Meeting Canteen", "danny,school", `
<<if $dannyIntro isnot 1 and $schoolState is "lunch">>
  <<set $dannyIntro to 1>>
  In the canteen, <<npc "Danny">> nearly collides with you while hurrying toward the bathrooms.
  "S-sorry! I'm Danny. We both live at the orphanage, right?"
  They look mortified. "I was trying to get to the bathroom in time..."
  <<link "Offer to walk with them later">><<set $dannyAware to 1>><<love "Danny" 3>><<goto "School Canteen">><</link>>
  <<link "Let them go">><<goto "School Canteen">><</link>>
<<else>>
  <<goto "School Canteen">>
<</if>>
  `);

  // ========== SCHEDULE / DOOR NOTES ==========

  addPassage("Danny Room Door", "danny,room", `
<<if $dannySleeping>>
  A note on the door: "Sleeping! Please don't wake me."
  <<link "Wait until morning">><<set $time to 420>><<goto "Danny Room Door">><</link>>
<<elseif $dannyAtSchool>>
  A note: "At school. Back later."
  <<link "Leave">><<goto "Orphanage Hallway">><</link>>
<<else>>
  <<link "Knock and enter">><<goto "Danny Room">><</link>>
  <<link "Leave">><<goto "Orphanage Hallway">><</link>>
<</if>>
  `);

  addPassage("Danny Room", "danny,room", `
You enter Danny's room. It's tidy but has a discreet stack of supplies near the bed.
<<npc "Danny">> looks up.
<<if $danny.control lt 40>>
  "H-hey. Sorry if I seem distracted. It's been a rough day with... you know."
<<else>>
  "Hey! Good to see you. I've been practicing the exercises you suggested."
<</if>>
<<link "Talk">><<goto "Danny Talk">><</link>>
<<link "Help with control training">><<goto "Danny Control Training">><</link>>
<<link "Offer dependency care / check">><<goto "Danny Dependency Care">><</link>>
<<link "Leave">><<goto "Orphanage Hallway">><</link>>
  `);

  // ========== RELATIONSHIP & PATHS ==========

  addPassage("Danny Talk", "danny", `
You talk with Danny about school, the orphanage, and their situation.
<<love "Danny" 2>>
<<if $danny.dependency gt 50>>
  They lean on you a little more than usual.
<<elseif $danny.control gt 60>>
  They seem more confident today.
<</if>>
<<link "Continue">><<goto "Danny Room">><</link>>
  `);

  addPassage("Danny Control Training", "danny", `
You help Danny with timed bathroom trips and pelvic exercises.
<<set $danny.control += 5>>
<<set $danny.dependency -= 2>>
<<love "Danny" 3>>
"Thanks... I think it's helping. I don't want to rely on these forever."
<<link "Keep going">><<goto "Danny Room">><</link>>
  `);

  addPassage("Danny Dependency Care", "danny", `
You offer to help check or change Danny.
<<set $danny.dependency += 5>>
<<set $danny.control -= 1>>
<<love "Danny" 4>>
<<lust "Danny" 2>>
They look both embarrassed and relieved. "I... appreciate you not making it weird."
<<link "Finish">><<goto "Danny Room">><</link>>
  `);

  // ========== ACCIDENT EVENT STUB ==========

  addPassage("Danny Accident", "danny,event", `
<<if $danny.bladder gt 80 and random(1,100) lt 30>>
  Danny suddenly freezes. "Oh no..."
  An accident happens.
  <<set $danny.accidentCount += 1>>
  <<set $danny.diaperState to "wet">>
  <<set $danny.bladder to 0>>
  <<trauma "Danny" 5>>
  <<link "Comfort them">><<love "Danny" 5>><<goto "Danny Room">><</link>>
  <<link "Help change them">><<set $danny.dependency += 3>><<goto "Danny Room">><</link>>
<<else>>
  <<goto "Danny Room">>
<</if>>
  `);

  // ========== QUEST SKELETON ==========

  addPassage("Danny Quest Start", "danny,quest", `
At high Love, Danny confides about Bailey's increasing payments and how the incontinence makes them more vulnerable.
<<link "Offer to take on their debt">><<set $dannyQuest to 1>><<goto "Bailey Office">><</link>>
<<link "Listen but do nothing yet">><<goto "Danny Room">><</link>>
  `);

  // ========== SOCIAL / STATUS HOOKS (stubs for later wiring) ==========

  // These would be called from existing Social tab or status widgets via further patches.
  console.log("[Danny] Passages injected:", [
    "Danny First Meeting Orphanage",
    "Danny Room",
    "Danny Control Training",
    "Danny Dependency Care",
    "Danny Accident",
    "Danny Quest Start"
  ].length);

  // Simple schedule flag updater (call from time-passage or existing schedule system)
  window.updateDannySchedule = function () {
    if (typeof State === "undefined") return;
    const V = State.variables;
    const hour = Math.floor(V.time / 60);
    // Placeholder logic – expand to match real timetable
    V.dannySleeping = (hour >= 21 || hour < 7);
    V.dannyAtSchool = (hour >= 8 && hour < 15 && V.schoolDay);
  };

})();
