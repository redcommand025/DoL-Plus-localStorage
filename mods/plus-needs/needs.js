/* DoL+ "Plus Needs" mod: hunger, thirst, bladder and bowels.
 * Values run from 2000 (fully satisfied) down to 0.
 * Stored in $plusHunger, $plusThirst, $plusBladder, $plusBowels so they do not
 * collide with the base game's own $hunger/$thirst (0 = full, used by captivity events). */
(function () {
	"use strict";
	const MAX = 2000;
	// Base points lost per in-game minute while awake (tuned for ~2.5 meals, ~8 drinks,
	// ~1 bowel movement and ~4-10 bladder trips per in-game day).
	const RATE = {
		plusHunger: 1.6, // ~96/h awake: full to "should eat" (<1000) in ~10h
		plusThirst: 3.2, // ~192/h awake: a drink every ~2h
		plusBladder: 3.6, // ~216/h awake, plus drinks fill it further
		plusBowels: 0.5, // ~30/h awake, plus meals fill it further
	};
	const SLEEP_RATE = 0.5; // bodily needs slow down during long rests
	const TICK_NOISE = 0.25; // +-25% randomness per tick
	const DRIFT_STEP = 0.03, DRIFT_MIN = 0.8, DRIFT_MAX = 1.2; // slowly drifting per-stat multiplier (per hour)
	const REFILL_NOISE = 0.22; // +-22% randomness per meal/drink
	const WEAK_FATIGUE_PER_HOUR = 15; // fatigue added per hour while starving or parched
	// A single long time skip (sleep, passing out, hospital) never causes an accident on its own.
	const LONG_PASS = 180;
	const LONG_PASS_FLOOR = 200;

	function init() {
		const V = State.variables;
		if (!V) return;
		for (const k of Object.keys(RATE)) {
			if (!Number.isFinite(V[k])) V[k] = MAX;
		}
		if (!V.plusNeedsDrift || typeof V.plusNeedsDrift !== "object") V.plusNeedsDrift = {};
		for (const k of Object.keys(RATE)) {
			if (!Number.isFinite(V.plusNeedsDrift[k])) V.plusNeedsDrift[k] = 1;
		}
	}
	window.plusNeedsInit = init;

	function clamp(v) {
		return Math.clamp(v, 0, MAX);
	}
	function jitter(n) {
		return 1 + (Math.random() * 2 - 1) * n;
	}

	window.plusNeedsTick = function (minutes) {
		const V = State.variables;
		if (!V || V.intro || !Number.isFinite(minutes) || minutes <= 0) return;
		init();
		const longPass = Math.max(minutes, window.plusNeedsPassTotal || 0) >= LONG_PASS;
		const sleepMul = longPass ? SLEEP_RATE : 1;
		const loss = {};
		for (const k of Object.keys(RATE)) {
			const d = Math.clamp(V.plusNeedsDrift[k] + (Math.random() * 2 - 1) * DRIFT_STEP * Math.sqrt(minutes / 60), DRIFT_MIN, DRIFT_MAX);
			V.plusNeedsDrift[k] = d;
			loss[k] = RATE[k] * minutes * sleepMul * d * jitter(TICK_NOISE);
		}
		V.plusHunger = clamp(V.plusHunger - loss.plusHunger);
		V.plusThirst = clamp(V.plusThirst - loss.plusThirst);
		if (V.plusHunger <= 0 || V.plusThirst <= 0) {
			// Light effect: running on empty makes you tired.
			try {
				if (Number.isFinite(V.tiredness)) {
					const max = typeof C !== "undefined" && C.tiredness && C.tiredness.max ? C.tiredness.max : 2000;
					V.tiredness = Math.clamp(V.tiredness + (WEAK_FATIGUE_PER_HOUR * minutes) / 60, 0, max);
				}
			} catch (e) {}
		}
		for (const k of ["plusBladder", "plusBowels"]) {
			let v = V[k] - loss[k];
			if (longPass && v <= 0) v = Math.min(V[k], LONG_PASS_FLOOR);
			V[k] = clamp(v);
			if (V[k] <= 0) {
				// Bladder and bowels on the same tick (or before the notice is shown) produce one combined notice.
				V.plusAccident = V.plusAccident && V.plusAccident !== k ? "both" : k;
				V[k] = MAX;
			}
		}
	};

	/* Eating and drinking. hunger/thirst = points restored. */
	window.plusNeedsConsume = function (hunger = 0, thirst = 0) {
		const V = State.variables;
		if (!V) return;
		init();
		hunger *= jitter(REFILL_NOISE);
		thirst *= jitter(REFILL_NOISE);
		V.plusHunger = clamp(V.plusHunger + hunger);
		V.plusThirst = clamp(V.plusThirst + thirst);
		// Drinks fill the bladder, meals fill the bowels.
		V.plusBladder = clamp(V.plusBladder - thirst * 0.4);
		V.plusBowels = clamp(V.plusBowels - hunger * 0.2);
	};

	window.plusNeedsToilet = function (which = "both") {
		const V = State.variables;
		init();
		// Bladder is always emptied; bowels only when you need to go ("should find a toilet soon" or worse).
		if (which !== "bowels") V.plusBladder = MAX;
		if (which === "bowels" || (which !== "bladder" && V.plusBowels < 1000)) V.plusBowels = MAX;
	};

	/* Food and drink props shown via <<wearProp>>: [hunger, thirst]. Applied once per passage per prop. */
	const PROPS = {
		"full english breakfast": [1000, 100], "pancake fork": [900, 0], "pasta fork": [900, 0], fork: [600, 0],
		"salad fork": [500, 0], "soup bowl": [700, 200], "lunch tray": [900, 200], "lunch bag": [700, 0],
		"ham sandwich": [600, 0], "questionable sandwich": [400, 0], "fish and chips": [1000, 0], cheeseburger: [900, 0],
		"chicken tikka masala": [1000, 0], steak: [1000, 0], "honeyed pork": [900, 0], bacon: [400, 0], salad: [400, 100],
		pasty: [700, 0], pastry: [400, 0], "cream buns": [400, 0], gingerbread: [300, 0], chocolate: [250, 0],
		"valentines chocolate": [250, 0], "choc chip cookie gift": [250, 0], "choco donut": [400, 0], "sprinkle donut": [400, 0],
		crisps: [250, 0], apple: [250, 50], "apple slice": [100, 20], pear: [250, 50], nuts: [250, 0], popcorn: [300, 0],
		mushroom: [150, 0], "riding fruit": [300, 100], "bean tin": [500, 0], "tuna tin": [500, 0], "custard tin": [400, 0],
		"bakewell tart": [400, 0], "packet of sweets": [150, 0], "picnic basket": [800, 200], coconut: [300, 300],
		"lollipop small": [80, 0], "lollipop big": [120, 0], strawberry: [80, 20], blackberry: [80, 20],
		tea: [0, 500], coffee: [0, 500], "travel cup": [0, 500], milkshake: [200, 700], lemonade: [0, 700],
		"strawberry lemonade": [0, 700], juice: [0, 700], "fizzy drink": [0, 600], "soft drink": [0, 600],
		"water bottle": [0, 800], "water bottle open": [0, 800], "hot cocoa": [100, 600], "thermos open": [0, 500],
		"hot cider": [0, 500], "travel cup cider": [0, 500], "bottle of milk": [100, 600], "solo cup": [0, 400],
		"beer mug": [0, 500], "beer bottle": [0, 500], "autumn ale": [0, 500], "fruity ale": [0, 500], "winter ale": [0, 500],
		shandy: [0, 500], cider: [0, 500], "red wine": [0, 300], "white wine": [0, 300], champagne: [0, 300],
		"strawberry cocktail": [0, 400], shot: [0, 100], whisky: [0, 100], brandy: [0, 100], vodka: [0, 100], scotch: [0, 100],
	};
	const DRINK_SCALE = 0.6; // drinks are smaller so ~8 a day are needed
	window.plusNeedsProp = function (prop) {
		try {
			if (typeof prop !== "string") return;
			const v = PROPS[prop.toLowerCase().replace(/_/g, " ").trim()];
			if (!v) return;
			const T = State.temporary;
			T.plusNeedsPropsSeen = T.plusNeedsPropsSeen || {};
			if (T.plusNeedsPropsSeen[prop]) return;
			T.plusNeedsPropsSeen[prop] = true;
			window.plusNeedsConsume(v[0], v[1] * DRINK_SCALE);
		} catch (e) {
			console.warn("plusNeedsProp", e);
		}
	};

	$(document).on(":passagestart", init);
	// Show an accident notice at the top of the next normal (non-combat) passage.
	$(document).on(":passagerender", function (ev) {
		const V = State.variables;
		if (!V || !V.plusAccident || V.combat === 1 || V.intro) return;
		const which = V.plusAccident;
		delete V.plusAccident;
		const div = document.createElement("div");
		div.className = "plus-needs-accident";
		$(div).wiki(`<<plusNeedsAccident "${which}">><br><br>`);
		ev.content.prepend(div);
	});
})();
