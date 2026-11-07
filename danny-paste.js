// === Danny paste-in loader ===
// Paste this entire block into the browser console AFTER the game has loaded
// (password entered, start screen or in-game visible).
(function(){
  "use strict";
  var attempts = 0, MAX = 100, done = false;
  function ready(){
    return typeof setup !== "undefined" &&
           typeof State !== "undefined" && State.variables &&
           typeof window.registerModLI === "function" &&
           typeof Wikifier !== "undefined";
  }
  function go(){
    if(done) return;
    attempts++;
    if(!ready()){
      if(attempts < MAX) setTimeout(go, 400);
      else console.warn("[Danny] timed out – game not ready");
      return;
    }
    try {
      window.registerModLI("Danny");
      var V = State.variables;
      if(!Array.isArray(V.NPCNameList)) V.NPCNameList = [];
      if(!Array.isArray(V.NPCName)) V.NPCName = [];
      if(V.NPCNameList.indexOf("Danny") === -1){
        Wikifier.wikifyEval('<<newNamedNpc {nam: "Danny", title: "dependent", insecurity: "weak", teen: 1, adult: 0, type: "human", pronoun: "f", gender: "f", maxOrgasms: 1}>>');
      }
      var idx = V.NPCNameList.indexOf("Danny");
      if(idx !== -1 && V.NPCName[idx]){
        var s = V.NPCName[idx];
        if(s.nam === undefined) s.nam = "Danny";
        if(s.maxOrgasms === undefined) s.maxOrgasms = 1;
        if(s.pronoun === undefined) s.pronoun = "f";
        done = true;
        console.log("[Danny] Registered cleanly. Index:", idx);
        console.log("[Danny] Available LIs:", window.getAvailableModLIs && window.getAvailableModLIs());
      } else {
        console.warn("[Danny] slot missing, retrying");
        if(attempts < MAX) setTimeout(go, 400);
      }
    } catch(e){
      console.error("[Danny] error:", e);
    }
  }
  setTimeout(go, 200);
})();
