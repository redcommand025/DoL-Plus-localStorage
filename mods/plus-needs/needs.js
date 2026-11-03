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
	// Stress / pain per hour while starving (hunger 0) or parched (thirst 0); they stack, thirst is a bit harsher.
	const EMPTY_STRESS_PER_HOUR = { plusHunger: 80, plusThirst: 120 }; // $stress max is 10000; base game recovers ~60/h
	const EMPTY_PAIN_PER_HOUR = { plusHunger: 20, plusThirst: 26 }; // $pain 0-200; base game heals some over time
	const EMPTY_PAIN_CAP = { plusHunger: 40, plusThirst: 60 }; // pain from needs alone won't push past this (caps add when both are 0)
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

	/* Lifetime statistics shown on the Statistics page ("Needs" foldout). */
	const STAT_KEYS = ["mlTotal", "drinks", "meals", "snacks", "kcal", "pees", "poops", "accWet", "accSoiled", "accBoth", "zeroHunger", "zeroThirst", "mlToday"];
	function stats() {
		const V = State.variables;
		if (!V.plusNeedsStats || typeof V.plusNeedsStats !== "object") V.plusNeedsStats = {};
		const S = V.plusNeedsStats;
		for (const k of STAT_KEYS) if (!Number.isFinite(S[k])) S[k] = 0;
		const day = dayKey();
		if (S.mlTodayDay !== day) {
			S.mlTodayDay = day;
			S.mlToday = 0;
		}
		return S;
	}
	function dayKey() {
		try {
			if (typeof Time !== "undefined" && Number.isFinite(Time.days)) return Time.days;
		} catch (e) {}
		return Math.floor((State.variables.timeStamp || 0) / 86400);
	}
	window.plusNeedsStats = stats;
	/* Millilitres per drink. Keys are prop names (see PROPS below) plus a few special sources. */
	const ML = {
		"water bottle": 500, "water bottle open": 500, tap: 250, "kitchen water": 250, "meal drink": 200,
		coffee: 250, tea: 250, "travel cup": 300, "thermos open": 300, "hot cocoa": 250, "bottle of milk": 300,
		juice: 250, lemonade: 330, "strawberry lemonade": 330, milkshake: 400, "fizzy drink": 330, "soft drink": 330,
		"solo cup": 350, "beer mug": 500, "beer bottle": 330, "autumn ale": 500, "fruity ale": 500, "winter ale": 500,
		shandy: 500, cider: 330, "hot cider": 250, "travel cup cider": 300, "red wine": 175, "white wine": 175,
		champagne: 150, "strawberry cocktail": 200, shot: 30, whisky: 30, brandy: 30, vodka: 30, scotch: 30,
		coconut: 300, fountain: 200, stream: 300, lake: 300, "water cooler": 200, "cafe water": 250, "soup bowl": 250, salad: 0, apple: 0, pear: 0,
	};
	window.plusNeedsML = ML;

	/* Chance (0-1) of being spotted when relieving yourself outdoors. Higher near town and in busy places. */
	const SPOT_BASE = { park: 0.4, beach: 0.35, wolfcave: 0.05 };
	window.plusNeedsSpotChance = function (spot) {
		const V = State.variables;
		let p;
		if (Number.isFinite(SPOT_BASE[spot])) p = SPOT_BASE[spot];
		else {
			// forest / lake: $forest is depth (0 = edge of town, 100+ = deep)
			const depth = Number.isFinite(V.forest) ? V.forest : 50;
			p = Math.clamp(0.35 - 0.003 * depth, 0.03, 0.35);
		}
		try {
			if (typeof Time !== "undefined" && Time.dayState === "night") p *= 0.5;
		} catch (e) {}
		return Math.round(p * 1000) / 1000;
	};
	window.plusNeedsSpotted = function () {
		const S = stats();
		S.spotted = (S.spotted || 0) + 1;
	};

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
		const S = stats();
		const wasH = V.plusHunger, wasT = V.plusThirst;
		V.plusHunger = clamp(V.plusHunger - loss.plusHunger);
		V.plusThirst = clamp(V.plusThirst - loss.plusThirst);
		if (wasH > 0 && V.plusHunger <= 0) S.zeroHunger++;
		if (wasT > 0 && V.plusThirst <= 0) S.zeroThirst++;
		if (V.plusHunger <= 0 || V.plusThirst <= 0) {
			// Light effect: running on empty makes you tired.
			try {
				if (Number.isFinite(V.tiredness)) {
					const max = typeof C !== "undefined" && C.tiredness && C.tiredness.max ? C.tiredness.max : 2000;
					V.tiredness = Math.clamp(V.tiredness + (WEAK_FATIGUE_PER_HOUR * minutes) / 60, 0, max);
				}
			} catch (e) {}
			// Stress and pain each turn, skipped during combat (combat manages its own pain/stress).
			try {
				if (V.combat !== 1) {
					let st = 0, pn = 0, cap = 0;
					for (const k of ["plusHunger", "plusThirst"]) if (V[k] <= 0) {
						cap += EMPTY_PAIN_CAP[k];
						st += (EMPTY_STRESS_PER_HOUR[k] * minutes) / 60;
						pn += (EMPTY_PAIN_PER_HOUR[k] * minutes) / 60;
					}
					const smax = Number.isFinite(V.stressmax) ? V.stressmax : 10000;
					if (Number.isFinite(V.stress)) V.stress = Math.clamp(V.stress + st, 0, smax);
					if (Number.isFinite(V.pain) && V.gamemode !== "soft" && V.pain < cap) V.pain = Math.clamp(V.pain + pn, 0, cap);
				}
			} catch (e) {}
		}
		for (const k of ["plusBladder", "plusBowels"]) {
			let v = V[k] - loss[k];
			if (longPass && v <= 0) v = Math.min(V[k], LONG_PASS_FLOOR);
			V[k] = clamp(v);
			if (V[k] <= 0) {
				if (k === "plusBladder") S.accWet++;
				else S.accSoiled++;
				if (V.plusAccident && V.plusAccident !== k) S.accBoth++;
				// Bladder and bowels on the same tick (or before the notice is shown) produce one combined notice.
				V.plusAccident = V.plusAccident && V.plusAccident !== k ? "both" : k;
				V[k] = MAX;
			}
		}
	};

	/* Eating and drinking. hunger/thirst = points restored. */
	/* kind: "meal" | "snack" | "drink" (auto-detected if omitted); ml: millilitres drunk (auto if omitted). */
	window.plusNeedsConsume = function (hunger = 0, thirst = 0, kind, ml) {
		const V = State.variables;
		if (!V) return;
		init();
		try {
			const S = stats();
			if (!kind) kind = hunger >= 500 ? "meal" : hunger > 0 ? "snack" : thirst > 0 ? "drink" : "";
			if (!Number.isFinite(ml)) ml = thirst > 0 ? (kind === "drink" ? ML.tap : ML["meal drink"]) : 0;
			if (kind === "meal") S.meals++;
			else if (kind === "snack") S.snacks++;
			else if (kind === "drink") S.drinks++;
			S.kcal += Math.max(0, Math.round(hunger)); // 1 hunger point ~ 1 kcal
			S.mlTotal += ml;
			S.mlToday += ml;
		} catch (e) {
			console.warn("plusNeedsStats", e);
		}
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
		const S = stats();
		if (which !== "bowels") {
			if (V.plusBladder < 1900) S.pees++;
			V.plusBladder = MAX;
		}
		if (which === "bowels" || (which !== "bladder" && V.plusBowels < 1000)) {
			S.poops++;
			V.plusBowels = MAX;
		}
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
			// School lunch is already counted once by plusNeedsSchoolLunch; don't add props shown during it.
			if (State.variables.plusSchoolLunchDay === dayKey() && /^Canteen Lunch/.test(State.passage)) return;
			T.plusNeedsPropsSeen[prop] = true;
			const key = prop.toLowerCase().replace(/_/g, " ").trim();
			const ml = Number.isFinite(ML[key]) ? ML[key] : v[1] > 0 ? (v[0] > 0 ? ML["meal drink"] : ML.tap) : 0;
			window.plusNeedsConsume(v[0], v[1] * DRINK_SCALE, undefined, ml);
		} catch (e) {
			console.warn("plusNeedsProp", e);
		}
	};

	/* Eating lunch in the school canteen: a good meal plus a glass of water, once per day. */
	const SCHOOL_LUNCH = ["Canteen Lunch", "Canteen Lunch Robin", "Canteen Lunch Robin CD 1", "Canteen Lunch Robin Dolp",
		"Canteen Robin Whitney", "Canteen Lunch Intervene", "Canteen Lunch Kylar", "Canteen Lunch Sydney"];
	window.plusNeedsSchoolLunch = function () {
		const V = State.variables;
		if (!V) return;
		init();
		const d = dayKey();
		if (V.plusSchoolLunchDay === d) return;
		V.plusSchoolLunchDay = d;
		window.plusNeedsConsume(1000, 0, "meal", 0); // good meal
		window.plusNeedsConsume(0, 300, "drink", ML.tap); // glass of water (~250 ml)
	};

	$(document).on(":passagestart", function (ev) {
		init();
		try {
			if (SCHOOL_LUNCH.includes(ev.passage.title)) window.plusNeedsSchoolLunch();
		} catch (e) {
			console.warn("plusNeedsSchoolLunch", e);
		}
		try {
			if (State.variables) stats();
		} catch (e) {}
	});
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
