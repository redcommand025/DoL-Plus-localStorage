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
		plusThirst: 2.6, // ~156/h awake: a drink every ~2.5h
		plusBladder: 3.6, // ~216/h awake, plus drinks fill it further
		plusBowels: 0.5, // ~30/h awake, plus meals fill it further
	};
	const SLEEP_RATE = { plusHunger: 0.25, plusThirst: 0.25, plusBladder: 0.5, plusBowels: 0.5 }; // bodily needs slow down during long rests
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
	// During a long rest bladder/bowels stop at the sidebar's "You should find a toilet soon" tier (400-999),
	// so you never wake up at "You really need a toilet now!" (<400) from sleep alone.
	const LONG_PASS_FLOOR = 400;

	function init() {
		const V = State.variables;
		if (!V) return;
		for (const k of Object.keys(RATE)) {
			if (!Number.isFinite(V[k])) V[k] = MAX;
		}
		if (!Number.isFinite(V.plusContinence)) V.plusContinence = 3;
		if (!Number.isFinite(V.plusContinenceXP)) V.plusContinenceXP = 0;
		if (!V.plusNeedsDrift || typeof V.plusNeedsDrift !== "object") V.plusNeedsDrift = {};
		for (const k of Object.keys(RATE)) {
			if (!Number.isFinite(V.plusNeedsDrift[k])) V.plusNeedsDrift[k] = 1;
		}
	}
	window.plusNeedsInit = init;

	/* Lifetime statistics shown on the Statistics page ("Needs" foldout). */
	const STAT_KEYS = ["mlTotal", "drinks", "meals", "snacks", "kcal", "pees", "poops", "accWet", "accSoiled", "accBoth", "zeroHunger", "zeroThirst", "mlToday", "smelt", "laundromat", "accFloor", "accSpotted", "findPlace", "findPlaceSpotted"];
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
		
		const loss = {};
		for (const k of Object.keys(RATE)) {
			const d = Math.clamp(V.plusNeedsDrift[k] + (Math.random() * 2 - 1) * DRIFT_STEP * Math.sqrt(minutes / 60), DRIFT_MIN, DRIFT_MAX);
			V.plusNeedsDrift[k] = d;
			loss[k] = RATE[k] * minutes * (longPass ? SLEEP_RATE[k] : 1) * d * jitter(TICK_NOISE);
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
		try {
			window.plusClothesTick(minutes);
		} catch (e) {}
		const inToilet = /^Plus Needs (Outdoor |Class )?Toilet$/.test(State.passage || "");
		const lvl = window.plusContinenceLevel();
		const G = V.plusGrace || (V.plusGrace = { plusBladder: 0, plusBowels: 0 });
		for (const k of ["plusBladder", "plusBowels"]) {
			const start = V[k];
			let v = start - loss[k];
			if (longPass && v < LONG_PASS_FLOOR) v = Math.min(start, LONG_PASS_FLOOR);
			v = clamp(v);
			V[k] = v;
			if (inToilet) {
				if (V[k] <= 0) V[k] = 1; // already on the toilet: no accident, the visit empties it
				continue;
			}
			// Holding practice: +1 XP per 10 awake minutes while this bar is urgent.
			if (!longPass && v < CONT_HOLD_BELOW) window.plusContinenceXP(minutes / 10, true);
			// Low continence: accident rolls start above 0 (never from a long rest alone).
			const thr = CONT_EARLY_THRESHOLD[lvl] || 0;
			if (!longPass && thr > 0 && v > 0 && v < thr && start > v) {
				const steps = Math.max(1, Math.min(240, Math.ceil(minutes))), drop = (start - v) / steps;
				let hit = false;
				for (let m = 1; m <= steps && !hit; m++) {
					const vm = start - drop * m;
					if (vm >= thr) continue;
					if (Math.random() < window.plusContinenceChance(lvl, vm, drop)) hit = true;
				}
				if (hit) {
					accident(k);
					continue;
				}
			}
			if (V[k] <= 0) {
				// High continence: a grace period at 0 before the accident.
				const grace = CONT_GRACE[lvl] || 0;
				const atZero = start > 0 ? minutes * Math.max(0, 1 - start / Math.max(loss[k], 1e-9)) : minutes;
				G[k] = (G[k] || 0) + atZero;
				if (grace > 0 && G[k] < grace && !(longPass && start <= 0)) {
					V[k] = 0;
					const stage = G[k] >= grace * 0.75 ? 2 : 1;
					const N = V.plusHoldNote || (V.plusHoldNote = {});
					if ((N[k] || 0) < stage) {
						N[k] = stage;
						V.plusHoldShow = Math.max(V.plusHoldShow || 0, stage);
					}
				} else accident(k);
			}
		}
		function accident(k) {
			// One pending notice = one control loss = one counted accident per type.
			// Bladder and bowels on the same tick (or before the notice is shown) produce one combined notice.
			const prev = V.plusAccident;
			if (prev !== k && prev !== "both") {
				if (k === "plusBladder") S.accWet++;
				else S.accSoiled++;
				if (prev) S.accBoth++;
				V.plusAccident = prev ? "both" : k;
				const before = prev ? CONT_ACC_XP[prev] : 0;
				window.plusContinenceXP(CONT_ACC_XP[V.plusAccident] - before);
			}
			V[k] = MAX;
			G[k] = 0;
			if (V.plusHoldNote) V.plusHoldNote[k] = 0;
		}
	};

	/* ---- Continence: level 0-6 (start 3), XP -600..+600 per level. ----
	 * Level 0-2: accident rolls start once the bar falls below a threshold (1800 / 1200 / 600).
	 *   Per point the bar drops below the threshold, chance = h * (1 - v/threshold)^2: ~0 at the threshold, max near 0.
	 * Level 3: accident only at 0. Level 4-6: hold on at 0 for 30 / 60 / 120 in-game minutes, then accident. */
	const CONT_NAMES = ["Leaky", "Weak", "Unreliable", "Normal", "Strong", "Iron", "Steel"];
	const CONT_EARLY_THRESHOLD = [1800, 1200, 600, 0, 0, 0, 0];
	const CONT_HAZARD = [0.0038, 0.0023, 0.0018];
	const CONT_GRACE = [0, 0, 0, 0, 30, 60, 120];
	const CONT_XP_STEP = 600;
	const CONT_HOLD_BELOW = 300;
	const CONT_RELIEF_XP = [[0, 120], [200, 80], [400, 40]]; // bar <= 0 (holding on): +120, < 200: +80, < 400: +40
	const CONT_ACC_XP = { plusBladder: -250, plusBowels: -300, both: -450 };
	window.plusContinenceNames = CONT_NAMES;
	window.plusContinenceChance = function (lvl, v, drop = 1) {
		const thr = CONT_EARLY_THRESHOLD[lvl] || 0;
		if (!(thr > 0) || v >= thr) return 0;
		const x = 1 - Math.max(0, v) / thr;
		return 1 - Math.exp(-CONT_HAZARD[lvl] * x * x * drop);
	};
	window.plusContinenceLevel = function () {
		const V = State.variables;
		if (!Number.isFinite(V.plusContinence)) V.plusContinence = 3;
		if (!Number.isFinite(V.plusContinenceXP)) V.plusContinenceXP = 0;
		return V.plusContinence;
	};
	window.plusContinenceXP = function (delta, quiet) {
		const V = State.variables;
		window.plusContinenceLevel();
		V.plusContinenceXP += delta;
		if (V.plusContinenceXP >= CONT_XP_STEP) {
			if (V.plusContinence < 6) {
				V.plusContinence++;
				V.plusContinenceXP = 0;
				V.plusContinenceNote = "up";
			} else V.plusContinenceXP = CONT_XP_STEP;
		} else if (V.plusContinenceXP <= -CONT_XP_STEP) {
			if (V.plusContinence > 0) {
				V.plusContinence--;
				V.plusContinenceXP = 0;
				V.plusContinenceNote = "down";
			} else V.plusContinenceXP = -CONT_XP_STEP;
		}
	};
	window.plusContinenceReliefXP = function (v) {
		for (const [lim, xp] of CONT_RELIEF_XP) if (v <= 0 ? lim === 0 : v < lim && lim > 0) return xp;
		return 0;
	};
	$(document).on(":passagerender", function (ev) {
		const V = State.variables;
		if (!V || V.combat === 1 || V.intro) return;
		let html = "";
		if (V.plusContinenceNote) {
			const n = CONT_NAMES[V.plusContinence];
			html += V.plusContinenceNote === "up"
				? `<span class="green">You feel more in control of your bladder and bowels. Continence: ${n}.</span>`
				: `<span class="red">You feel less able to hold it than before. Continence: ${n}.</span>`;
			delete V.plusContinenceNote;
		}
		if (V.plusHoldShow && !(V.passage || "").startsWith("Plus Needs")) {
			const which = ["plusBladder", "plusBowels"].filter(k => V[k] <= 0).map(k => (k === "plusBladder" ? "bladder" : "bowels"));
			if (which.length) {
				const w = which.join(" and ");
				html += (html ? " " : "") + (V.plusHoldShow >= 2
					? `<span class="red">You can't hold on much longer. Your ${w} ${which.length > 1 ? "are" : "is"} at breaking point. Find a toilet now!</span>`
					: `<span class="pink">You're desperately holding on. Your ${w} ${which.length > 1 ? "are" : "is"} full to bursting, but you keep it together for now.</span>`);
			}
			delete V.plusHoldShow;
		}
		if (!html) return;
		const div = document.createElement("div");
		div.className = "plus-needs-continence";
		div.innerHTML = html + "<br><br>";
		ev.content.prepend(div);
	});

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
		const G = V.plusGrace || (V.plusGrace = {});
		if (which !== "bowels") window.plusContinenceXP(window.plusContinenceReliefXP(V.plusBladder));
		if (which === "bowels" || (which !== "bladder" && V.plusBowels < 1000)) window.plusContinenceXP(window.plusContinenceReliefXP(V.plusBowels));
		for (const k of ["plusBladder", "plusBowels"]) { G[k] = 0; if (V.plusHoldNote) V.plusHoldNote[k] = 0; }
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
	// Snacks (anything under a meal's 500 hunger) refill twice their listed hunger value but still count as snacks.
	const SNACK_MUL = 2;
	const DRINK_SCALE = 0.6; // drinks are smaller so ~8 a day are needed
	window.plusNeedsProp = function (prop) {
		try {
			if (typeof prop !== "string") return;
			const key = prop.toLowerCase().replace(/_/g, " ").trim();
			const v = PROPS[key];
			if (!v) return;
			const T = State.temporary;
			T.plusNeedsPropsSeen = T.plusNeedsPropsSeen || {};
			if (T.plusNeedsPropsSeen[key]) return;
			// School lunch is already counted once by plusNeedsSchoolLunch; don't add food props shown during it.
			// Drinks (no hunger value) are still counted.
			if (v[0] > 0 && State.variables.plusSchoolLunchDay === dayKey() && /^Canteen Lunch/.test(State.passage)) return;
			T.plusNeedsPropsSeen[key] = true;
			const ml = Number.isFinite(ML[key]) ? ML[key] : v[1] > 0 ? (v[0] > 0 ? ML["meal drink"] : ML.tap) : 0;
			// Mostly-liquid props (milkshake, hot cocoa, milk) count as drinks, not snacks.
			const kind = v[1] > v[0] ? "drink" : v[0] > 0 && v[0] < 500 ? "snack" : undefined;
			window.plusNeedsConsume(kind === "snack" ? v[0] * SNACK_MUL : v[0], v[1] * DRINK_SCALE, kind, ml);
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
		window.plusNeedsConsume(0, 500, "drink", ML.tap); // glass of water (~250 ml)
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
	/* Hunger/thirst flavour notices. Tier 1: <=500, 2: <=200, 3: empty (0, stress/pain penalty active). */
	const NOTICE_REPEAT = 45 * 60; // seconds of game time before the same tier is mentioned again
	const NOTICE_LINES = {
		plusHunger: {
			1: ["Your stomach gives a low, hollow grumble. You should eat something soon.",
				"You catch yourself thinking about food. It's been a while since you last ate.",
				"A faint emptiness gnaws at your stomach.",
				"Your stomach rumbles loudly enough that you hope no one else heard.",
				"You feel a little peckish. A proper meal wouldn't go amiss."],
			2: ["You're starving. Your stomach twists painfully and you can't stop thinking about food.",
				"Hunger claws at your insides. You need to eat, and soon.",
				"Your hands feel shaky and your thoughts keep drifting to food. You're starving.",
				"The smell of anything edible would make your mouth water right now. You're ravenous.",
				"A dull ache has settled in your empty stomach. You badly need a meal."],
			3: ["Your stomach cramps with hunger. You feel weak and lightheaded, and every movement takes effort.",
				"You haven't eaten in far too long. The gnawing pain in your belly makes it hard to think.",
				"Your legs tremble and your vision swims for a moment. Your body is running on empty.",
				"Hunger has become a constant, aching pain. You need food now.",
				"You feel faint from hunger. The emptiness in your stomach has turned into real pain."],
		},
		plusThirst: {
			1: ["Your mouth feels a little dry. You could use a drink.",
				"You lick your lips and notice how dry they feel.",
				"A mild thirst nags at you. A glass of water would be nice.",
				"You swallow and find your throat a bit scratchy. You should drink something."],
			2: ["You're parched. Your tongue sticks to the roof of your mouth.",
				"Your throat is dry and raw. You need water, and soon.",
				"Every swallow scrapes your throat. You're desperately thirsty.",
				"A dull headache pulses behind your eyes. You're badly dehydrated.",
				"You can't stop thinking about a cold drink of water. You're parched."],
			3: ["Your head pounds and your lips are cracked. Your body is crying out for water.",
				"You feel dizzy and weak from thirst. Your mouth is completely dry.",
				"Dehydration makes your head throb painfully. You need to drink right now.",
				"Your throat burns with thirst and your thoughts feel slow and foggy.",
				"Your vision blurs for a moment. Without water, you won't last much longer like this."],
		},
	};
	function needTier(v) {
		return v <= 0 ? 3 : v <= 200 ? 2 : v <= 500 ? 1 : 0;
	}
	/* Returns [{which, tier, text}] to show now, updating the shown-state. At most one per need per passage. */
	window.plusNeedsNotices = function () {
		const V = State.variables;
		const out = [];
		V.plusNeedsNotice = V.plusNeedsNotice || {};
		const now = V.timeStamp || 0;
		for (const k of ["plusHunger", "plusThirst"]) {
			const tier = needTier(V[k]);
			const st = V.plusNeedsNotice[k] || (V.plusNeedsNotice[k] = { tier: 0, ts: -Infinity, last: -1 });
			if (tier === 0 || tier < st.tier) {
				st.tier = tier; // recovered: reset silently so a later drop is announced
				continue;
			}
			if (tier === st.tier && now - st.ts < NOTICE_REPEAT) continue;
			const lines = NOTICE_LINES[k][tier];
			let i = Math.floor(Math.random() * lines.length);
			if (i === st.last && lines.length > 1) i = (i + 1 + Math.floor(Math.random() * (lines.length - 1))) % lines.length;
			Object.assign(st, { tier, ts: now, last: i });
			out.push({ which: k, tier, text: lines[i] });
		}
		return out;
	};
	$(document).on(":passagerender", function (ev) {
		const V = State.variables;
		if (!V || V.combat === 1 || V.intro || !Number.isFinite(V.plusHunger) || (V.passage || "").startsWith("Plus Needs")) return;
		try {
			const list = window.plusNeedsNotices();
			if (!list.length) return;
			const div = document.createElement("div");
			div.className = "plus-needs-hungerthirst";
			T_set(list);
			$(div).wiki("<<plusNeedsNeedNotice>><br><br>");
			ev.content.prepend(div);
		} catch (e) {
			console.warn("plusNeedsNotices", e);
		}
	});
	function T_set(list) {
		State.temporary.plusNeedsNoticeList = list;
		const V = State.variables, empty = list.some(n => n.tier >= 3);
		State.temporary.plusNeedsNoticeStress = empty;
		// Pain is only applied outside soft mode (see plusNeedsTick).
		State.temporary.plusNeedsNoticePain = empty && V.gamemode !== "soft";
	}
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
	/* ---- Per-item clothing dirt (0-2000) and soiling (0-10), stored on the clothing objects themselves
	 * ($worn[slot].plusDirt / .plusSoiled) so they travel with the item into the wardrobe and back. ---- */
	const CL_SLOTS = ["over_upper", "over_lower", "upper", "lower", "under_upper", "under_lower"];
	const DIRT_MAX = 2000, SOIL_MAX = 10;
	const DIRT_RATE = DIRT_MAX / (5 * 24 * 60); // ~0.278/min: a worn item goes 0 -> 2000 in 5 in-game days
	const DIRT_PENALTY_FROM = 1000; // penalties start here and peak at DIRT_MAX
	const ALLURE_PENALTY = 0.15, SEDUCTION_PENALTY = 0.15, BULLY_PENALTY = { school: 6, outside: 3 }; // at max dirt
	const SMELL_PER_SOIL = 0.02, SMELL_CAP = 0.4, SMELL_COOLDOWN = 30 * 60; // seconds of game time
	const LAUNDROMAT_COST = 500; // $money is in pence: GBP 5
	const CLEAN_CHANCE = 0.6;
	const ACC = { soil: 5, dirt: 250, overflowSoil: 2, overflowDirt: 100 };
	// Passage-entry dirt spikes; first match wins, applied once per passage change, never in combat.
	const NSFW = /Rape|Molest|Orgasm|Sex|Breastfeed|Seduce|Grope/;
	const DIRT_SPIKES = [
		[t => /Mud\b/.test(t), 300],
		[t => /^(Moor Quicksand|Bog)/.test(t), 250],
		[t => /^(Farm Work( Naked)?|Farm Fields|Farm Pigs.*|Livestock Field.*)$/.test(t), 200],
		[t => /^Beach Run$/.test(t), 150],
		[t => /Beach Volleyball Play$/.test(t), 120],
		[(t, V) => /^Sewers/.test(t) || V.location === "sewers", 100],
		[(t, V) => /Fight Finish$/.test(t) && V.outside && ["town", "alley", "park", "beach"].includes(V.location), 150],
		[(t, V) => V.location === "forest" && /^Forest\b/.test(t), 60],
	];
	const PRIVATE_LOC = ["home", "forest", "lake", "moor", "bog", "sewers", "cabin", "wolf_cave", "underground", "tentworld", "dungeon", "prison", "island", "landfill", "estate", "changingroom"];
	const PRIVATE_PASS = /Bath|Toilet|Bedroom|Wardrobe|Shower|Changing|Plus Needs|Bed\b|Locker|Sleep/;

	function realItem(it) {
		return !!(it && Array.isArray(it.type) && !it.type.includes("naked"));
	}
	function clInit(it) {
		if (!Number.isFinite(it.plusDirt)) it.plusDirt = 0;
		if (!Number.isFinite(it.plusSoiled)) it.plusSoiled = 0;
		return it;
	}
	function addItem(it, dirt, soil) {
		if (!realItem(it)) return;
		clInit(it);
		it.plusDirt = Math.clamp(it.plusDirt + dirt, 0, DIRT_MAX);
		it.plusSoiled = Math.clamp(it.plusSoiled + soil, 0, SOIL_MAX);
	}
	function worn() {
		const W = State.variables.worn;
		if (!W) return [];
		return CL_SLOTS.map(s => W[s]).filter(realItem).map(clInit);
	}
	function isSkirt(it) {
		if (!it) return false;
		if (it.skirt === 1 || (it.type || []).includes("dress")) return true;
		try {
			const d = setup.clothes.lower.find(c => c.name === it.name);
			if (d && d.skirt === 1) return true;
		} catch (e) {}
		return /skirt|dress|kilt/i.test(it.name || "");
	}
	window.plusClothesWorn = worn;
	window.plusClothesMaxDirt = () => worn().reduce((m, it) => Math.max(m, it.plusDirt), 0);
	window.plusClothesSoiled = () => worn().reduce((m, it) => m + it.plusSoiled, 0) + (window.plusDiaperSmell ? window.plusDiaperSmell() : 0);
	function dirtFactor() {
		try {
			return Math.clamp((window.plusClothesMaxDirt() - DIRT_PENALTY_FROM) / (DIRT_MAX - DIRT_PENALTY_FROM), 0, 1);
		} catch (e) {
			return 0;
		}
	}
	window.plusDirtFactor = dirtFactor;
	window.plusDirtAllureMul = () => 1 - ALLURE_PENALTY * dirtFactor();
	window.plusDirtSeductionMul = () => 1 - SEDUCTION_PENALTY * dirtFactor();
	window.plusDirtBullyDaily = function () {
		const V = State.variables, f = dirtFactor();
		if (f <= 0) return;
		if (Number.isFinite(V.bullytimer)) V.bullytimer += Math.round(BULLY_PENALTY.school * f);
		if (Number.isFinite(V.bullytimeroutside)) V.bullytimeroutside += Math.round(BULLY_PENALTY.outside * f);
	};
	window.plusClothesDirt = function (amount) {
		for (const it of worn()) addItem(it, amount, 0);
	};
	window.plusClothesTick = function (minutes) {
		const V = State.variables;
		if (!V || V.intro || !V.worn) return;
		window.plusClothesDirt(DIRT_RATE * minutes);
	};
	/* Bowel accident: soil the underwear; a full (10) pair overflows into the lower item unless it's a skirt/dress. */
	window.plusClothesAccident = function (which) {
		const V = State.variables;
		if (!V.worn || (which !== "plusBowels" && which !== "both")) return;
		const ul = V.worn.under_lower, lo = V.worn.lower;
		const loOk = realItem(lo) && !isSkirt(lo);
		if (realItem(ul) && window.plusDiaperFull(ul)) {
			addItem(ul, ACC.overflowDirt, 0); // a full diaper leaks: the mess goes on to the next layer
			if (loOk) addItem(lo, ACC.dirt, ACC.soil);
		} else if (realItem(ul)) {
			addItem(ul, ACC.dirt, ACC.soil);
			if (ul.plusSoiled >= SOIL_MAX && loOk) addItem(lo, ACC.overflowDirt, ACC.overflowSoil);
		} else if (loOk) {
			addItem(lo, ACC.dirt, ACC.soil); // no underwear: it goes straight into the lower item
		}
	};
	window.plusClothesIsSkirt = isSkirt;
	/* Removal and daily decay, detected lazily so every undress path (wardrobe, events, sleep) is covered. */
	window.plusClothesSync = function () {
		const V = State.variables;
		if (!V || !V.worn) return;
		const day = dayKey();
		if (!V.plusWornIds || typeof V.plusWornIds !== "object") V.plusWornIds = {};
		if (!Number.isFinite(V.plusClothId)) V.plusClothId = 0;
		for (const s of CL_SLOTS) {
			const it = V.worn[s];
			if (!realItem(it)) {
				V.plusWornIds[s] = null;
				continue;
			}
			clInit(it);
			if (!it.plusId) {
				it.plusId = ++V.plusClothId;
				it.plusDay = day;
			} else if (V.plusWornIds[s] !== it.plusId) {
				it.plusSoiled = Math.max(0, it.plusSoiled - 1); // it was taken off since we last saw it
			}
			if (!Number.isFinite(it.plusDay)) it.plusDay = day;
			if (day > it.plusDay) it.plusSoiled = Math.max(0, it.plusSoiled - (day - it.plusDay));
			it.plusDay = day;
			V.plusWornIds[s] = it.plusId;
		}
	};
	window.plusClothesSpike = function (title) {
		const V = State.variables;
		if (!V || V.combat === 1 || NSFW.test(title)) return 0;
		for (const [test, amt] of DIRT_SPIKES) {
			if (test(title, V)) {
				window.plusClothesDirt(amt);
				return amt;
			}
		}
		return 0;
	};
	window.plusSmellChance = function () {
		return Math.min(SMELL_CAP, SMELL_PER_SOIL * window.plusClothesSoiled());
	};
	window.plusIsPublic = function (title) {
		const V = State.variables;
		return V.combat !== 1 && !PRIVATE_LOC.includes(V.location) && !PRIVATE_PASS.test(title || "");
	};
	window.plusSmellCheck = function (title) {
		const V = State.variables, now = V.timeStamp || 0;
		const c = window.plusSmellChance();
		if (c <= 0 || !window.plusIsPublic(title)) return false;
		if (Number.isFinite(V.plusSmellNext) && now < V.plusSmellNext) return false;
		if (Math.random() >= c) return false;
		V.plusSmellNext = now + SMELL_COOLDOWN;
		stats().smelt++;
		V.plusSmelt = true;
		return true;
	};
	window.plusClothesClean = function () {
		if (Math.random() >= CLEAN_CHANCE) return false;
		for (const it of worn()) {
			it.plusDirt = Math.max(0, it.plusDirt - (150 + Math.floor(Math.random() * 101)));
			it.plusSoiled = Math.max(0, it.plusSoiled - (1 + Math.floor(Math.random() * 2)));
			if (window.plusDiaperDef(it) && window.plusDiaperDef(it).cloth) window.plusDiaperReset(it);
		}
		return true;
	};
	window.plusLaundromatCost = LAUNDROMAT_COST;
	window.plusLaundromatWash = function () {
		const V = State.variables;
		if (!(V.money >= LAUNDROMAT_COST)) return false;
		V.money -= LAUNDROMAT_COST;
		for (const it of worn()) {
			it.plusDirt = 0;
			it.plusSoiled = 0;
			if (window.plusDiaperDef(it) && window.plusDiaperDef(it).cloth) window.plusDiaperReset(it);
		}
		for (const s of CL_SLOTS) {
			const k = s.replace("_", "");
			V[k + "wet"] = 0;
			V[k + "wetstage"] = 0;
		}
		stats().laundromat++;
		return true;
	};
	/* Short second-person status lines for the sidebar and wardrobes. */
	window.plusClothesStatus = function () {
		const out = [], d = window.plusClothesMaxDirt(), s = window.plusClothesSoiled();
		if (d >= 1500) out.push(["red", "Your clothes are filthy and stained."]);
		else if (d >= 1000) out.push(["purple", "Your clothes are dirty."]);
		else if (d >= 500) out.push(["lblue", "Your clothes look a little grubby."]);
		if (s >= 8) out.push(["red", "Your soiled clothes reek. People can smell you."]);
		else if (s > 0) out.push(["purple", "Your clothes are soiled and smell unpleasant."]);
		return out;
	};
	/* Sidebar clothing caption prefixes, in the same style as the base game's integrityWord():
	 * coloured adjectives, nothing shown for the default (clean / not soiled) state. */
	window.plusDirtKeyword = it => {
		const d = (it && it.plusDirt) || 0;
		return d >= 1500 ? "filthy" : d >= 1000 ? "dirty" : d >= 500 ? "grubby" : "";
	};
	window.plusSoilKeyword = it => {
		const s = (it && it.plusSoiled) || 0;
		return s >= 5 ? "heavily soiled" : s > 0 ? "soiled" : "";
	};
	const WORD_COLOUR = { damp: "teal", used: "purple", full: "red", grubby: "teal", dirty: "purple", filthy: "red", soiled: "purple", "heavily soiled": "red" };
	window.plusDirtWord = function (it) {
		if (!realItem(it)) return "";
		let out = "";
		for (const kw of [window.plusDiaperKeyword(it), window.plusDirtKeyword(it), window.plusSoilKeyword(it)]) if (kw) out += `<span class="${WORD_COLOUR[kw]}">${kw}</span> `;
		return out;
	};
	window.plusClothesItemLines = function () {
		const W = State.variables.worn, out = [];
		for (const s of CL_SLOTS) {
			const it = W && W[s];
			if (!realItem(it)) continue;
			clInit(it);
			const dl = it.plusDirt >= 1500 ? "filthy" : it.plusDirt >= 1000 ? "dirty" : it.plusDirt >= 500 ? "a little grubby" : "clean";
			out.push(`Your ${it.name} ${it.plural ? "are" : "is"} ${dl}${it.plusSoiled > 0 ? " and soiled" : ""}.`);
			const dk = window.plusDiaperKeyword(it);
			if (dk) out.push(`Your ${it.name} is ${dk === "damp" ? "damp" : dk === "used" ? "used" : "full"}${window.plusDiaperDef(it).cloth ? " and needs washing" : " and needs changing"}.`);
		}
		return out;
	};
	$(document).on(":passagestart", function (ev) {
		const V = State.variables;
		if (!V || V.intro || !V.worn) return;
		try {
			window.plusClothesSync();
			const t = ev.passage.title;
			if (V.plusDirtLastPassage !== t || V.plusDirtLastTs !== V.timeStamp) {
				V.plusDirtLastPassage = t;
				V.plusDirtLastTs = V.timeStamp;
				window.plusClothesSpike(t);
				window.plusSmellCheck(t);
			}
		} catch (e) {
			console.warn("plusClothes", e);
		}
	});
	$(document).on(":passagerender", function (ev) {
		const V = State.variables;
		if (!V || !V.plusSmelt || V.combat === 1 || V.intro) return;
		delete V.plusSmelt;
		const div = document.createElement("div");
		div.className = "plus-needs-smell";
		$(div).wiki("<<plusNeedsSmellNotice>><br><br>");
		ev.content.prepend(div);
	});
	/* ---- Dirt flavour notices: fire once per item when its dirt crosses up into a sidebar tier
	 * (grubby 500 / dirty 1000 / filthy 1500). Last-notified tier is stored on the item
	 * (plusDirtNoteTier) and drops back down when the item is cleaned, so it can fire again. ---- */
	const DIRT_TIERS = [["grubby", 500], ["dirty", 1000], ["filthy", 1500]];
	const dirtTierOf = d => DIRT_TIERS.reduce((t, x, i) => (d >= x[1] ? i + 1 : t), 0);
	const DIRT_NOTE_LINES = {
		1: [
			"You notice {your} {is} starting to look grubby.",
			"A smudge catches your eye. {Your} {is} getting a little grubby.",
			"{Your} {is} no longer quite fresh. {It} {is} looking grubby.",
			"You brush at a mark on {your}. {It} {is} starting to look worn and grubby.",
		],
		2: [
			"You glance down. {Your} {is} properly dirty now.",
			"{Your} {is} dirty. Stains and grime are hard to miss.",
			"You notice {your} {is} looking dirty. A wash wouldn't hurt.",
			"Dust and stains have built up. {Your} {is} clearly dirty.",
		],
		3: [
			"{Your} {is} filthy. You really need to wash {them}.",
			"You catch a whiff of {your}. {It} {is} absolutely filthy.",
			"{Your} {is} caked with grime. {It} {is} filthy.",
			"People might start to notice. {Your} {is} filthy.",
		],
	};
	const DIRT_NOTE_COLOUR = { 1: "teal", 2: "purple", 3: "red" };
	const joinNames = a => (a.length < 2 ? a[0] : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);
	window.plusDirtNoteFill = function (line, items) {
		const plural = items.length > 1 || !!items[0].plural;
		const names = "your " + joinNames(items.map(i => i.name));
		const cap = x => x[0].toUpperCase() + x.slice(1);
		return line.replace(/\{your\}/g, names).replace(/\{Your\}/g, cap(names))
			.replace(/\{is\}/g, plural ? "are" : "is").replace(/\{It\}/g, plural ? "They" : "It")
			.replace(/\{them\}/g, plural ? "them" : "it");
	};
	window.plusDirtNotices = function () {
		const V = State.variables, W = V.worn, byTier = {};
		if (!W) return [];
		for (const s of CL_SLOTS) {
			const it = W[s];
			if (!realItem(it)) continue;
			clInit(it);
			const t = dirtTierOf(it.plusDirt);
			if (!Number.isFinite(it.plusDirtNoteTier)) { it.plusDirtNoteTier = t; continue; } // baseline silently
			if (t < it.plusDirtNoteTier) it.plusDirtNoteTier = t; // cleaned: re-arm
			else if (t > it.plusDirtNoteTier) { it.plusDirtNoteTier = t; (byTier[t] = byTier[t] || []).push(it); }
		}
		const last = V.plusDirtNoteLast || (V.plusDirtNoteLast = {}), out = [];
		for (const t of Object.keys(byTier).sort().reverse()) {
			const lines = DIRT_NOTE_LINES[t];
			let i = Math.floor(Math.random() * lines.length);
			if (i === last[t] && lines.length > 1) i = (i + 1 + Math.floor(Math.random() * (lines.length - 1))) % lines.length;
			last[t] = i;
			out.push({ tier: +t, cls: DIRT_NOTE_COLOUR[t], text: window.plusDirtNoteFill(lines[i], byTier[t]) });
		}
		return out;
	};
	$(document).on(":passagerender", function (ev) {
		const V = State.variables;
		if (!V || V.combat === 1 || V.intro || !V.worn || (V.passage || "").startsWith("Plus Needs")) return;
		try {
			const list = window.plusDirtNotices();
			if (!list.length) return;
			const div = document.createElement("div");
			div.className = "plus-needs-dirtnotice";
			list.forEach((n, i) => {
				if (i) div.append(" ");
				const sp = document.createElement("span");
				sp.className = n.cls;
				sp.textContent = n.text;
				div.append(sp);
			});
			div.append(document.createElement("br"), document.createElement("br"));
			ev.content.prepend(div);
		} catch (e) {
			console.warn("plusDirtNotices", e);
		}
	});
	/* ---- Accidents with nothing in the way, being spotted, and "find a place to go". ---- */
	const SCHOOL_PASS = /^(School|Hallways|Canteen|(Science|Maths|English|History|Housekeeping) Classroom|Classroom)/;
	const TOWN_BUSY = ["High Street", "Connudatus Street", "Barb Street", "Oxford Street", "Cliff Street", "Starfish Street", "Nightingale Street", "Shopping Centre"];
	const BUSY_LOC = ["high", "connudatus", "barb", "oxford", "cliff", "starfish", "nightingale", "shopping_centre", "cafe", "arcade", "promenade"];
	const ACC_SPOT = { clothed: 0.25, floor: 0.6, busyMul: 1.5, cap: 0.95 };
	const FIND_SPOT = { school: 0.8, busy: 0.65, quiet: 0.35 };
	const URGENT = 300;
	const FIND_PLACES = ["High Street", "Barb Street", "Connudatus Street", "Domus Street", "Oxford Street", "Nightingale Street", "Wolf Street", "Starfish Street", "Cliff Street", "Danube Street", "Mer Street", "Elk Street", "Harvest Street", "Commercial Alleyways", "Industrial Alleyways", "Residential Alleyways", "Hallways", "School Front Courtyard", "School Rear Courtyard", "Canteen", "School Library"];
	function night() {
		try {
			return Time.dayState === "night";
		} catch (e) {
			return false;
		}
	}
	window.plusIsSchool = function (title = State.passage) {
		return State.variables.location === "school" || SCHOOL_PASS.test(title || "");
	};
	function busy(title) {
		return TOWN_BUSY.includes(title) || BUSY_LOC.includes(State.variables.location);
	}
	/* True when nothing is worn that would catch an accident (skirts/dresses don't count). */
	window.plusAccidentFloor = function () {
		const W = State.variables.worn;
		if (!W) return false;
		if (realItem(W.under_lower)) return false;
		for (const s of ["lower", "over_lower"]) if (realItem(W[s]) && !isSkirt(W[s])) return false;
		return true;
	};
	window.plusAccidentSpotChance = function (floor, title = State.passage) {
		if (window.plusIsSchool(title)) return 1;
		if (!window.plusIsPublic(title)) return 0;
		let p = floor ? ACC_SPOT.floor : ACC_SPOT.clothed;
		if (busy(title)) p *= ACC_SPOT.busyMul;
		if (night()) p *= 0.5;
		return Math.min(ACC_SPOT.cap, p);
	};
	/* 0 = unseen, 1 = seen in public, 2 = seen at school. Counts the stat and applies school effects. */
	window.plusAccidentSpotRoll = function (floor, mul = 1) {
		const S = stats();
		if (floor) S.accFloor++;
		const c = window.plusAccidentSpotChance(floor) * mul;
		if (!(c >= 1 || Math.random() < c)) return 0;
		S.accSpotted++;
		if (window.plusIsSchool()) {
			window.plusSchoolBullyBump();
			return 2;
		}
		return 1;
	};
	window.plusSchoolBullyBump = function () {
		const V = State.variables;
		if (Number.isFinite(V.bullytimer)) V.bullytimer += 10;
	};
	function fpTitle() {
		return State.passage === "Plus Needs Find Place" ? State.variables.plusToiletReturn : State.passage;
	}
	window.plusFindPlaceKind = function (title = fpTitle()) {
		return window.plusIsSchool(title) ? "school" : busy(title) ? "busy" : "quiet";
	};
	window.plusFindPlaceChance = function (title = fpTitle()) {
		let p = FIND_SPOT[window.plusFindPlaceKind(title)];
		if (night()) p *= 0.5;
		return Math.round(p * 1000) / 1000;
	};
	window.plusFindPlaceAvailable = function (title = State.passage) {
		const V = State.variables;
		if (!V || V.combat === 1 || V.intro || !FIND_PLACES.includes(title)) return false;
		return V.plusBladder <= URGENT || V.plusBowels <= URGENT;
	};
	window.plusFindPlaceRoll = function () {
		const S = stats();
		S.findPlace++;
		const spotted = Math.random() < window.plusFindPlaceChance();
		if (spotted) {
			S.findPlaceSpotted++;
			window.plusNeedsSpotted();
			if (window.plusIsSchool(fpTitle())) window.plusSchoolBullyBump();
		}
		return spotted;
	};
})();

/* ---- Classroom: ask the teacher to leave for the toilet / a drink ---- */
(function () {
	const TEACHERS = { Science: "Sirris", Maths: "River", English: "Doren", History: "Winter", Swimming: "Mason" };
	window.plusClassTeacher = function (passage) {
		const m = /^(\w+) Lesson$/.exec(passage || "");
		return m ? TEACHERS[m[1]] : undefined;
	};
	window.plusClassLove = function (name) {
		try { const n = C.npc[name]; return n && typeof n.love === "number" ? n.love : 0; } catch (e) { return 0; }
	};
	// Refusal chance 0..0.85
	window.plusClassRefuseChance = function (name, asks = 0) {
		const V = State.variables;
		const del = Number(V.delinquency) || 0, love = window.plusClassLove(name);
		let p = 0.05;
		p += 0.45 * Math.clamp((del - 400) / 600, 0, 1);
		p += 0.40 * Math.clamp((20 - love) / 40, 0, 1);
		p -= 0.10 * Math.clamp((love - 30) / 50, 0, 1);
		p += 0.15 * asks;
		return Math.clamp(p, 0.02, 0.85);
	};
	// Rolls a request. Returns true if granted. Tracks repeated asks per lesson (passage + hour + day).
	window.plusClassAsk = function (kind) {
		const V = State.variables, passage = State.passage;
		const name = window.plusClassTeacher(passage) || "Sirris";
		const key = passage + "|" + Time.days + "|" + Time.hour;
		if (!V.plusClassAsks || V.plusClassAsks.key !== key) V.plusClassAsks = { key, n: 0 };
		const p = window.plusClassRefuseChance(name, V.plusClassAsks.n);
		V.plusClassAsks.n++;
		V.plusClassTeacherName = name;
		V.plusClassKind = kind;
		V.plusClassRepeat = V.plusClassAsks.n;
		V.plusClassReturn = passage;
		V.plusClassGranted = Math.random() >= p;
		return V.plusClassGranted;
	};
})();

/* ---- Diapers (under_lower clothing). Fill is counted in units: wet = 1, soiled = 1, both = 2.
 * While a diaper has room the accident is absorbed (no wetness or soiling reaches other clothes, spotting x0.5);
 * once full, accidents leak through the normal logic. Disposables are thrown away; cloth ones must be washed. ---- */
(function () {
	"use strict";
	const DIAPERS = [
		// name, variable, cost (pence), capacity (units), cloth, description
		["plastic diaper (large)", "plusdiaperlarge", 3000, 3, false, "Thick and bulky, with a crinkly plastic backing. Holds a lot."],
		["plastic diaper", "plusdiaper", 2000, 2, false, "A disposable diaper with a crinkly plastic backing."],
		["plastic diaper (small)", "plusdiapersmall", 1000, 1, false, "A slim disposable diaper. It won't hold much."],
		["cloth diaper", "plusclothdiaper", 2000, 1, true, "Soft, washable cloth. Reusable, but it needs a wash after every use."],
		["pull-up", "pluspullup", 1000, 2, false, "Disposable underwear that pulls up and down like normal pants."],
	];
	const DEF = {};
	for (const [name, variable, cost, cap, cloth, desc] of DIAPERS) DEF[name] = { name, variable, cost, cap, cloth, desc };
	window.plusDiaperDefs = DEF;
	window.plusDiaperItems = function () {
		return DIAPERS.map(([name, variable, cost, cap, cloth, desc]) => new ClothesItem({
			index: 0, slot: "under_lower", name, name_cap: name[0].toUpperCase() + name.slice(1),
			name_simple: name === "pull-up" ? "pull-up" : "diaper", variable,
			combat: { reference: "plainpanties", accessory: false },
			integrity: 100, integrity_max: 100, fabric_strength: 15, reveal: 400, rearresize: 0, word: "a",
			one_piece: 0, state: "waist", state_base: "waist", plural: 0,
			colour: 0, colour_options: ["pale white"], colour_sidebar: 0,
			exposed: 0, exposed_base: 0, vagina_exposed: 0, vagina_exposed_base: 0, anus_exposed: 0, anus_exposed_base: 0,
			type: ["normal", "antitransparent"], anal_shield: 0, set: "under_lower", gender: "n", femininity: 0,
			warmth: 2, cost, description: desc, shop: ["clothing"],
			accessory: 0, accessory_colour: 0, accessory_colour_options: [], penis_img: 1, high_img: 0,
			cursed: 0, location: 0, iconFile: "plain_panties.png", accIcon: 0, modder: "plusneeds",
		}));
	};
	const def = it => (it && Array.isArray(it.type) && !it.type.includes("naked") && DEF[it.name]) || null;
	function init(it) {
		if (!Number.isFinite(it.plusDiaperFill)) it.plusDiaperFill = 0;
		if (!Number.isFinite(it.plusDiaperWet)) it.plusDiaperWet = 0;
		if (!Number.isFinite(it.plusDiaperSoil)) it.plusDiaperSoil = 0;
		return it;
	}
	window.plusDiaperDef = def;
	window.plusDiaperCap = it => (def(it) ? def(it).cap : 0);
	window.plusDiaperWorn = function () {
		const W = State.variables.worn, it = W && W.under_lower;
		return def(it) ? init(it) : null;
	};
	window.plusDiaperFull = it => !!def(it) && init(it).plusDiaperFill >= def(it).cap;
	/* Called once per accident notice. Returns true when the diaper takes it all (no leak). */
	window.plusDiaperAbsorb = function (which) {
		const it = window.plusDiaperWorn();
		if (!it) return false;
		const d = def(it), wet = which !== "plusBowels" ? 1 : 0, soil = which !== "plusBladder" ? 1 : 0, units = wet + soil;
		const room = d.cap - it.plusDiaperFill;
		if (room <= 0) return false;
		it.plusDiaperFill = Math.min(d.cap, it.plusDiaperFill + units);
		it.plusDiaperWet += wet;
		it.plusDiaperSoil += soil;
		it.plusDirt = Math.min(2000, (it.plusDirt || 0) + (soil ? 250 : 100));
		return units <= room;
	};
	/* Soiled diaper units smell like soiled clothing (5 points each, the same as a bowel accident in underwear). */
	window.plusDiaperSmell = function () {
		const it = window.plusDiaperWorn();
		return it ? 5 * it.plusDiaperSoil : 0;
	};
	window.plusDiaperReset = function (it) {
		if (!def(it)) return;
		it.plusDiaperFill = it.plusDiaperWet = it.plusDiaperSoil = 0;
	};
	window.plusDiaperKeyword = function (it) {
		const d = def(it);
		if (!d) return "";
		init(it);
		if (it.plusDiaperFill <= 0) return "";
		if (it.plusDiaperFill >= d.cap) return "full";
		return it.plusDiaperSoil > 0 ? "used" : "damp";
	};
	/* "Change" option: a used disposable is thrown away. */
	window.plusDiaperCanDispose = function () {
		const it = window.plusDiaperWorn();
		return !!it && !def(it).cloth && it.plusDiaperFill > 0;
	};
})();
