/**
 * Danny passages – safe loader.
 */
(function () {
  "use strict";

  let attempts = 0;
  const MAX = 40;

  function tryInject() {
    attempts++;
    if (typeof Story === "undefined" || typeof SugarCube === "undefined") {
      if (attempts < MAX) setTimeout(tryInject, 1000);
      return;
    }

    function addPassage(name, tags, content) {
      if (Story.has(name)) return;
      try {
        Story.add({ name: name, tags: tags || "", content: content });
      } catch (e) {
        console.warn("[Danny] Failed to add passage", name, e);
      }
    }

    addPassage("Danny First Meeting Orphanage", "danny", `
<<if $dannyIntro isnot 1>>
  <<set $dannyIntro to 1>>
  You hear a soft voice. <<npc "Danny">> is nearby.
  "Hey... I'm Danny."
  <<link "Continue">><<goto "Orphanage Main Hall">><</link>>
<<else>>
  <<goto "Orphanage Main Hall">>
<</if>>
    `);

    addPassage("Danny Room", "danny", `
Danny's room.
<<link "Talk">><<love "Danny" 1>><<goto "Danny Room">><</link>>
<<link "Leave">><<goto "Orphanage Hallway">><</link>>
    `);

    console.log("[Danny] Passages injected");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryInject);
  } else {
    tryInject();
  }
})();
