/* Hunger & Thirst bars for DoL+ (injected early-load patch)
   Adds $hunger / $thirst that rise over time, display as bars, and can be reduced by eating/drinking.
   Compatible with existing DoL+ uses of these variables. */
(function() {
  "use strict";

  const HUNGER_MAX = 2000;
  const THIRST_MAX = 2000;
  const RISE_PER_MINUTE = 4; // ~240 per hour while awake — noticeable after a few hours

  function ensureVars() {
    if (typeof State === "undefined" || !State.variables) return false;
    const v = State.variables;
    if (typeof v.hunger !== "number") v.hunger = 0;
    if (typeof v.thirst !== "number") v.thirst = 0;
    if (typeof v.hungermax !== "number") v.hungermax = HUNGER_MAX;
    if (typeof v.thirstmax !== "number") v.thirstmax = THIRST_MAX;
    return true;
  }

  function clampStats() {
    const v = State.variables;
    v.hunger = Math.max(0, Math.min(v.hungermax || HUNGER_MAX, v.hunger));
    v.thirst = Math.max(0, Math.min(v.thirstmax || THIRST_MAX, v.thirst));
  }

  function riseOverTime(minutes) {
    if (!ensureVars()) return;
    const v = State.variables;
    v.hunger += RISE_PER_MINUTE * minutes;
    v.thirst += RISE_PER_MINUTE * minutes * 1.2;
    clampStats();
  }

  window.DoLHunger = {
    add: function(amount) {
      if (!ensureVars()) return;
      State.variables.hunger += amount;
      clampStats();
    },
    reduce: function(amount) {
      if (!ensureVars()) return;
      State.variables.hunger = Math.max(0, State.variables.hunger - amount);
    },
    addThirst: function(amount) {
      if (!ensureVars()) return;
      State.variables.thirst += amount;
      clampStats();
    },
    reduceThirst: function(amount) {
      if (!ensureVars()) return;
      State.variables.thirst = Math.max(0, State.variables.thirst - amount);
    },
    getHunger: function() { return ensureVars() ? State.variables.hunger : 0; },
    getThirst: function() { return ensureVars() ? State.variables.thirst : 0; }
  };

  function makeBar(id, label, value, max, colorClass) {
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    let text = "full";
    if (pct >= 90) text = "starving";
    else if (pct >= 70) text = "very hungry";
    else if (pct >= 40) text = "hungry";
    else if (pct >= 15) text = "peckish";
    if (id === "thirst") {
      if (pct >= 90) text = "dehydrated";
      else if (pct >= 70) text = "very thirsty";
      else if (pct >= 40) text = "thirsty";
      else if (pct >= 15) text = "a little dry";
      else text = "hydrated";
    }
    return `<div id="${id}caption" title="${label}: ${value.toFixed(0)} / ${max}">
      <div class="rightMeterText">${label}: <span class="${pct >= 70 ? 'red' : pct >= 40 ? 'pink' : 'blue'}">${text}</span></div>
      <div class="rightMeter"><div class="${colorClass}" style="width:${pct}%"></div></div>
      <div style="clear:both;"></div>
    </div>`;
  }

  function injectBars() {
    if (!ensureVars()) return;
    const meters = document.getElementById("statmeters");
    if (!meters) return;
    if (document.getElementById("hungercaption")) return;

    const v = State.variables;
    const hungerHtml = makeBar("hunger", "Hunger", v.hunger, v.hungermax || HUNGER_MAX, "redbar");
    const thirstHtml = makeBar("thirst", "Thirst", v.thirst, v.thirstmax || THIRST_MAX, "bluebar");
    meters.insertAdjacentHTML("beforeend", hungerHtml + thirstHtml);
  }

  function onPassage() {
    ensureVars();
    riseOverTime(2);
    const v = State.variables;
    if (v.hunger > v.hungermax * 0.7) {
      v.stress = (v.stress || 0) + 5;
    }
    if (v.thirst > v.thirstmax * 0.7) {
      v.stress = (v.stress || 0) + 4;
    }
    injectBars();
  }

  function init() {
    let tries = 0;
    const iv = setInterval(function() {
      tries++;
      if (typeof State !== "undefined" && State.variables && typeof Engine !== "undefined") {
        clearInterval(iv);
        ensureVars();
        if (typeof $(document).on === "function") {
          $(document).on(":passagerender", onPassage);
        } else {
          setInterval(function() {
            if (typeof State !== "undefined" && State.variables) {
              riseOverTime(1);
              injectBars();
            }
          }, 60000);
        }
        setTimeout(injectBars, 500);
        console.log("[DoL Hunger/Thirst] system active");
      } else if (tries > 40) {
        clearInterval(iv);
        console.warn("[DoL Hunger/Thirst] SugarCube not detected");
      }
    }, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
