/* Game time in seconds. The game keeps it in Time.date.timeStamp; there is no $timeStamp story variable. */
window.plusNowTs = function () {
	try {
		const t = Time.date.timeStamp;
		if (Number.isFinite(t)) return t;
	} catch (e) {}
	return (State.variables && State.variables.timeStamp) || 0;
};
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
		if (!Number.isFinite(V.insecurity_diaper)) V.insecurity_diaper = 0;
		if (!Number.isFinite(V.acceptance_diaper)) V.acceptance_diaper = 0;
		if (!Number.isFinite(V.plusContRep)) V.plusContRep = 0;
		if (!Number.isFinite(V.plusContRepCleanDays)) V.plusContRepCleanDays = 0;
		if (V.plusContRepDayGain !== 0 && V.plusContRepDayGain !== 1) V.plusContRepDayGain = 0;
		if (!Number.isFinite(V.plusContRepDecayDay)) V.plusContRepDecayDay = dayKey();
		if (!V.uncomfortable || typeof V.uncomfortable !== "object") V.uncomfortable = {};
		if (V.uncomfortable.diaperSeen === undefined) V.uncomfortable.diaperSeen = true;
		if (V.uncomfortable.diaperUse === undefined) V.uncomfortable.diaperUse = true;
		if (!V.plusNeedsDrift || typeof V.plusNeedsDrift !== "object") V.plusNeedsDrift = {};
		for (const k of Object.keys(RATE)) {
			if (!Number.isFinite(V.plusNeedsDrift[k])) V.plusNeedsDrift[k] = 1;
		}
		if (!V.plusFlat || typeof V.plusFlat !== "object") V.plusFlat = { rented: false };
	}
	window.plusNeedsInit = init;

	/* Lifetime statistics shown on the Statistics page ("Needs" foldout). */
	const STAT_KEYS = ["mlTotal", "drinks", "meals", "snacks", "kcal", "pees", "poops", "accWet", "accSoiled", "accBoth", "zeroHunger", "zeroThirst", "mlToday", "smelt", "laundromat", "accFloor", "accSpotted", "findPlace", "findPlaceSpotted", "mlAbsorbed", "lbAbsorbed", "diaperNoticed", "accDiaper", "diapersUsed", "bedwets"];
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
		return Math.floor(window.plusNowTs() / 86400);
	}
	window.plusNeedsStats = stats;
	window.plusDayKey = dayKey;
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
		try { if (typeof window.plusContRepDecay === "function") window.plusContRepDecay(); } catch (e) {}
		try { if (typeof window.plusFlatOnTick === "function") window.plusFlatOnTick(); } catch (e) {}
		const longPass = Math.max(minutes, window.plusNeedsPassTotal || 0) >= LONG_PASS;
		
		const loss = {};
		for (const k of Object.keys(RATE)) {
			const d = Math.clamp(V.plusNeedsDrift[k] + (Math.random() * 2 - 1) * DRIFT_STEP * Math.sqrt(minutes / 60), DRIFT_MIN, DRIFT_MAX);
			V.plusNeedsDrift[k] = d;
			loss[k] = RATE[k] * minutes * (longPass ? SLEEP_RATE[k] : 1) * d * jitter(TICK_NOISE);
		}
		// Diuretics (coffee, energy drinks, alcohol) make the bladder fill faster for a while; water is unchanged.
		if ((V.plusDiureticMin || 0) > 0) {
			loss.plusBladder *= V.plusDiureticMul || 1;
			V.plusDiureticMin = Math.max(0, V.plusDiureticMin - minutes);
			if (V.plusDiureticMin <= 0) V.plusDiureticMul = 1;
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
			// Night protection: a long rest (sleep) at low continence can cause bed-wetting if no diaper is worn.
			// A worn diaper prevents a wet bed (it absorbs instead). Never from short time skips.
			if (longPass && k === "plusBladder" && minutes >= LONG_PASS && lvl <= 2) {
				const hours = minutes / 60;
				let risk = [0.88, 0.48, 0.18][lvl] * Math.min(1, hours / 8);
				if (start < 1000) risk = Math.min(0.98, risk + 0.25);
				if (Math.random() < risk) {
					if (window.plusDiaperWorn && window.plusDiaperWorn()) {
						try { window.plusDiaperAbsorb("plusBladder"); } catch (e) {}
						S.accWet++;
						V[k] = MAX;
						G[k] = 0;
						V.plusNightProtect = 1;
					} else {
						accident(k);
						V.plusBedwet = 1;
						S.bedwets++;
						if (Number.isFinite(V.upperwet)) V.upperwet = Math.max(V.upperwet, 80);
						if (Number.isFinite(V.lowerwet)) V.lowerwet = Math.max(V.lowerwet, 140);
						if (Number.isFinite(V.underlowerwet)) V.underlowerwet = Math.max(V.underlowerwet, 200);
						try { if (window.plusClothesDirt) window.plusClothesDirt(80); } catch (e) {}
					}
					continue;
				}
			}
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
			// One pending notice = one counted accident per type.
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
	 *   Per point the bar drops below the threshold, hazard = h * (1 - v/threshold): small at the threshold, rising linearly to max at 0.
 *   Tuned so the median accident lands around bar ~1000 / ~500 / ~200 and an accident before 0 is ~97% / ~87% / ~79% likely.
	 * Level 3: accident only at 0. Level 4-6: hold on at 0 for 30 / 60 / 120 in-game minutes, then accident. */
	const CONT_NAMES = ["Leaky", "Weak", "Unreliable", "Normal", "Strong", "Iron", "Steel"];
	const CONT_EARLY_THRESHOLD = [1800, 1200, 600, 0, 0, 0, 0];
	const CONT_HAZARD = [0.0038, 0.0034, 0.0052];
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
		return 1 - Math.exp(-CONT_HAZARD[lvl] * x * drop);
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
	/* Scheduled-toilet habit: going while moderately full (remaining 200-1600) grants bonus XP. */
	window.plusScheduleBonus = function (v) {
		const V = State.variables;
		if (!V || !V.plusScheduleOn || !Number.isFinite(v)) return 0;
		if (v > 1600 || v < 200) return 0;
		return 40;
	};
	window.plusScheduleToggle = function () {
		const V = State.variables;
		V.plusScheduleOn = !V.plusScheduleOn;
		return V.plusScheduleOn;
	};
	/* Hospital bladder exercises: £10, 30 minutes (caller passes time), +90 XP first visit each day, +25 after. */
	window.plusBladderExercise = function () {
		const V = State.variables;
		if (!V) return { ok: false, reason: "state" };
		init();
		if (!Number.isFinite(V.money) || V.money < 1000) return { ok: false, reason: "money", price: 1000 };
		if (typeof statChange !== "undefined" && statChange.money) statChange.money(-1000, "plusneeds");
		else V.money -= 1000;
		const d = dayKey();
		const xp = V.plusExerciseDay === d ? 25 : 90;
		V.plusExerciseDay = d;
		window.plusContinenceXP(xp);
		return { ok: true, xp, price: 1000 };
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
		if (V.plusBedwet) {
			html += (html ? " " : "") + `<span class="red">You wet the bed in your sleep. Your pyjamas and the sheets are soaked.</span>`;
			delete V.plusBedwet;
		} else if (V.plusNightProtect) {
			html += (html ? " " : "") + `<span class="lblue">You leaked in your sleep, but your diaper kept the bed dry.</span>`;
			delete V.plusNightProtect;
		}
		if (V.plusDiaperAcceptanceNote) {
			html += (html ? " " : "") + `<span class="green">You realise you no longer mind people knowing you wear a diaper. You've gained the Acceptance: Diaper trait.</span>`;
			delete V.plusDiaperAcceptanceNote;
		}
		let supply = "";
		try { supply = window.plusSupplyWarn && window.plusSupplyWarn(); } catch (e) { console.warn(e); }
		if (supply) html += (html ? " " : "") + `<span class="purple">${supply}</span>`;
		if (!html) return;
		const div = document.createElement("div");
		div.className = "plus-needs-continence";
		div.innerHTML = html + "<br><br>";
		ev.content.prepend(div);
	});

	/* Eating and drinking. hunger/thirst = points restored. */
	/* kind: "meal" | "snack" | "drink" (auto-detected if omitted); ml: millilitres drunk (auto if omitted). */
	window.plusNeedsConsume = function (hunger = 0, thirst = 0, kind, ml, drinkKey) {
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
		if (drinkKey) window.plusApplyDiuretic(drinkKey);
		else if (kind === "drink") window.plusApplyDiuretic(window.plusLastDrinkKey || "");
	};

	/* Coffee / energy drinks / alcohol temporarily speed bladder fill. Water, juice and milk have no extra effect. */
	const DIURETIC = {
		coffee: [2.0, 90], tea: [1.3, 45], "travel cup": [2.0, 90],
		"fizzy drink": [1.6, 75], "soft drink": [1.5, 60], "energy drink": [2.5, 120],
		lemonade: [1.3, 45], "strawberry lemonade": [1.3, 45],
		"beer mug": [1.8, 150], "beer bottle": [1.8, 120], "autumn ale": [1.8, 150],
		"fruity ale": [1.8, 150], "winter ale": [1.8, 150], shandy: [1.5, 120],
		cider: [1.7, 120], "hot cider": [1.6, 90], "travel cup cider": [1.7, 120],
		"red wine": [1.6, 90], "white wine": [1.6, 90], champagne: [1.6, 75],
		"strawberry cocktail": [1.7, 90], shot: [1.9, 60], whisky: [1.9, 60],
		brandy: [1.9, 60], vodka: [1.9, 60], scotch: [1.9, 60],
	};
	window.plusDiureticInfo = DIURETIC;
	window.plusApplyDiuretic = function (key) {
		const V = State.variables;
		if (!V || !key) return false;
		const d = DIURETIC[String(key).toLowerCase().replace(/_/g, " ").trim()];
		if (!d) return false;
		if (!(V.plusDiureticMin > 0) || d[0] >= (V.plusDiureticMul || 1)) {
			V.plusDiureticMul = d[0];
			V.plusDiureticMin = Math.max(V.plusDiureticMin || 0, d[1]);
		} else {
			V.plusDiureticMin = Math.max(V.plusDiureticMin, Math.round(d[1] * 0.5));
		}
		return true;
	};

	window.plusNeedsToilet = function (which = "both") {
		const V = State.variables;
		init();
		// Bladder is always emptied; bowels only when you need to go ("should find a toilet soon" or worse).
		const S = stats();
		const G = V.plusGrace || (V.plusGrace = {});
		if (which !== "bowels") window.plusContinenceXP(window.plusContinenceReliefXP(V.plusBladder) + window.plusScheduleBonus(V.plusBladder));
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
			window.plusLastDrinkKey = v[1] > 0 ? key : "";
			window.plusNeedsConsume(kind === "snack" ? v[0] * SNACK_MUL : v[0], v[1] * DRINK_SCALE, kind, ml, key);
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
		const now = window.plusNowTs();
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
	window.plusClothesSoiled = () => worn().reduce((m, it) => m + it.plusSoiled, 0);
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
	window.plusClothesAccident = function (which, frac) {
		const V = State.variables;
		const f = Number.isFinite(frac) ? Math.clamp(frac, 0, 1) : 1;
		if (!V.worn || (which !== "plusBowels" && which !== "both")) return;
		const ul = V.worn.under_lower, lo = V.worn.lower;
		const loOk = realItem(lo) && !isSkirt(lo);
		if (realItem(ul) && window.plusDiaperDef(ul)) {
			// a full diaper leaks: the overflow portion of the mess goes on to the next layer
			addItem(ul, Math.round(ACC.overflowDirt * f), 0);
			if (loOk) addItem(lo, Math.round(ACC.dirt * f), Math.max(1, Math.round(ACC.soil * f)));
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
			let fresh = false;
			if (!it.plusId) {
				it.plusId = ++V.plusClothId;
				it.plusDay = day;
				fresh = true;
			}
			const holds = window.plusDiaperDef && window.plusDiaperDef(it) && (it.plusMl > 0 || it.plusLb > 0);
			if (!fresh && V.plusWornIds[s] !== it.plusId && !holds) {
				it.plusSoiled = Math.max(0, it.plusSoiled - 1); // it was taken off since we last saw it
			}
			if (!Number.isFinite(it.plusDay)) it.plusDay = day;
			// A diaper's contents don't dry out: no daily soiled fade while it still holds anything.
			if (day > it.plusDay && !holds) it.plusSoiled = Math.max(0, it.plusSoiled - (day - it.plusDay));
			// The base game dries $underlowerwet over time; keep a worn diaper's wetness in step with what it holds.
			if (s === "under_lower" && holds && Number.isFinite(V.underlowerwet)) {
				const f = Math.min(1, it.plusMl / (it.plusCapMl || 1));
				V.underlowerwet = Math.max(V.underlowerwet, Math.round(95 * f));
			}
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
	/* Smell: 2% per soiled point on clothes (cap 40%) plus 16% per lb of solids held in a worn diaper;
	 * any mess in the diaper raises the cap to 60%. Under 0.75 lb in the diaper it's only a faint whiff. */
	const VISIBLE_MUL = 1.5;
	window.plusVisibleMul = VISIBLE_MUL;
	const SMELL_PER_LB = 0.16, SMELL_CAP_DIAPER = 0.6, SMELL_FAINT_LB = 0.75;
	window.plusSmellChance = function () {
		const lb = window.plusDiaperPoops ? window.plusDiaperPoops() : 0;
		const cap = lb > 0 ? SMELL_CAP_DIAPER : SMELL_CAP;
		return Math.min(cap, SMELL_PER_SOIL * window.plusClothesSoiled() + SMELL_PER_LB * lb);
	};
	/* 1 = faint whiff, 2 = unmistakable (chance 16%+ from soiled clothes, or 0.75 lb+ in the diaper). */
	window.plusSmellIntensity = function () {
		const lb = window.plusDiaperPoops ? window.plusDiaperPoops() : 0;
		if (lb > 0 && window.plusClothesSoiled() === 0) return lb >= SMELL_FAINT_LB ? 2 : 1;
		return window.plusSmellChance() >= 0.16 ? 2 : 1;
	};
	window.plusIsPublic = function (title) {
		const V = State.variables;
		return V.combat !== 1 && !PRIVATE_LOC.includes(V.location) && !PRIVATE_PASS.test(title || "");
	};
	window.plusSmellCheck = function (title) {
		const V = State.variables, now = window.plusNowTs();
		const c = Math.min(0.9, window.plusSmellChance() * (window.plusDiaperVisible && window.plusDiaperVisible() ? VISIBLE_MUL : 1));
		if (c <= 0 || !window.plusIsPublic(title)) return false;
		if (Number.isFinite(V.plusSmellNext) && now < V.plusSmellNext) return false;
		if (Math.random() >= c) return false;
		V.plusSmellNext = now + SMELL_COOLDOWN;
		stats().smelt++;
		V.plusSmelt = window.plusSmellIntensity();
		return true;
	};
	window.plusClothesClean = function () {
		if (Math.random() >= CLEAN_CHANCE) return false;
		for (const it of worn()) {
			it.plusDirt = Math.max(0, it.plusDirt - (150 + Math.floor(Math.random() * 101)));
			it.plusSoiled = Math.max(0, it.plusSoiled - (1 + Math.floor(Math.random() * 2)));
			// scrubbing with paper towels doesn't empty a diaper; only changing/washing it does
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
		const dp = window.plusDiaperPoops ? window.plusDiaperPoops() : 0;
		if (dp >= 0.75) out.push(["red", "Your messy diaper smells. People nearby can probably tell."]);
		else if (dp > 0) out.push(["purple", "There's a faint smell from your used diaper."]);
		const vis = window.plusDiaperVisibility ? window.plusDiaperVisibility() : null;
		if (vis && vis.visible) out.push(vis.conceal < 0 ? ["red", "Nothing covers your diaper. Anyone can see it."] : ["purple", "Your diaper is visible under your clothes."]);
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
	const WORD_COLOUR = { damp: "teal", wet: "purple", soaked: "red", messy: "purple", "very messy": "red", full: "red", "full of mess": "red", snug: "lblue", puffy: "teal", swollen: "purple", bulging: "red", grubby: "teal", dirty: "purple", filthy: "red", soiled: "purple", "heavily soiled": "red" };
	window.plusDirtWord = function (it) {
		if (!realItem(it)) return "";
		let out = "";
		for (const kw of [window.plusSwellWord ? window.plusSwellWord(it) : "", ...window.plusDiaperWords(it), window.plusDirtKeyword(it), window.plusSoilKeyword(it)]) if (kw) out += `<span class="${WORD_COLOUR[kw]}">${kw}</span> `;
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
			const dw = window.plusDiaperWords(it);
			if (window.plusDiaperDef(it)) out.push(`Your ${it.name}: ${window.plusDiaperMeterText(it)}.`);
			if ((s === "lower" || s === "over_lower") && window.plusConcealText) out.push(`Your ${it.name}: ${window.plusConcealText(window.plusConcealOf(it, s))}.`);
			if (dw.length) out.push(`Your ${it.name} is ${dw.join(" and ")}${window.plusDiaperDef(it).cloth ? " and needs washing" : " and needs changing"}.`);
		}
		return out;
	};
	$(document).on(":passagestart", function (ev) {
		const V = State.variables;
		if (!V || V.intro || !V.worn) return;
		try {
			window.plusClothesSync();
			const t = ev.passage.title;
			if (V.plusDirtLastPassage !== t || V.plusDirtLastTs !== window.plusNowTs()) {
				V.plusDirtLastPassage = t;
				V.plusDirtLastTs = window.plusNowTs();
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
		const tier = V.plusSmelt === 1 ? 1 : 2;
		delete V.plusSmelt;
		const div = document.createElement("div");
		div.className = "plus-needs-smell";
		$(div).wiki(`<<plusNeedsSmellNotice ${tier}>><br><br>`);
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
		const c = window.plusAccidentSpotChance(floor) * mul * (!floor && window.plusDiaperVisible && window.plusDiaperVisible() ? window.plusVisibleMul : 1);
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
			try { if (typeof window.plusContRepOnOutdoor === "function") window.plusContRepOnOutdoor(fpTitle()); } catch (e) {}
			if (window.plusIsSchool(fpTitle())) window.plusSchoolBullyBump();
		}
		return spotted;
	};

	/* Ask to use a resident's restroom when knocking for work (Domus / Danube / Flats).
	 * Self-contained: never enters the base work/danger/sex house chains.
	 * Chance starts at 55% and is modified by appearance, fame, allure, crime, time of day,
	 * urgency (pleading), and whether a diaper is visible or they notice a smell.
	 * Once per house-type (the knock event's usual work destination) per day. */
	const RESTROOM_BASE = 0.55;
	const RESTROOM_MIN = 0.08, RESTROOM_MAX = 0.92;
	const BAD_FAME = ["sex", "prostitution", "rape", "bestiality", "exhibitionism", "impreg"];
	function restroomDay() {
		return typeof window.plusDayKey === "function" ? window.plusDayKey() : 0;
	}
	function restroomUsedMap() {
		const V = State.variables;
		if (!V.plusRestroomUsed || typeof V.plusRestroomUsed !== "object") V.plusRestroomUsed = { day: restroomDay(), keys: {} };
		if (V.plusRestroomUsed.day !== restroomDay()) {
			V.plusRestroomUsed.day = restroomDay();
			V.plusRestroomUsed.keys = {};
		}
		return V.plusRestroomUsed.keys;
	}
	window.plusRestroomHouseKey = function (street, house) {
		return String(street || "") + "::" + String(house || "");
	};
	window.plusRestroomCanAsk = function (street, house) {
		if (!street || !house) return false;
		return !restroomUsedMap()[window.plusRestroomHouseKey(street, house)];
	};
	window.plusRestroomMarkUsed = function (street, house) {
		if (!street || !house) return;
		restroomUsedMap()[window.plusRestroomHouseKey(street, house)] = 1;
	};
	function crimeSum() {
		const V = State.variables;
		if (!V || !V.crime || typeof V.crime !== "object") return 0;
		let tot = 0;
		for (const k of Object.keys(V.crime)) {
			const c = V.crime[k];
			if (c && Number.isFinite(c.current)) tot += c.current;
		}
		return tot;
	}
	function fameGood() {
		const f = State.variables && State.variables.fame;
		return f && Number.isFinite(f.good) ? f.good : 0;
	}
	function fameBad() {
		const f = State.variables && State.variables.fame;
		if (!f) return 0;
		return BAD_FAME.reduce((s, k) => s + (Number.isFinite(f[k]) ? f[k] : 0), 0);
	}
	window.plusRestroomSmellNoticed = function (force) {
		if (force === true) return true;
		if (force === false) return false;
		const c = typeof window.plusSmellChance === "function" ? window.plusSmellChance() : 0;
		if (c <= 0) return false;
		const inten = typeof window.plusSmellIntensity === "function" ? window.plusSmellIntensity() : 1;
		if (inten >= 2 && c >= 0.08) return Math.random() < Math.min(0.95, c * 4);
		return Math.random() < Math.min(0.9, c * 2.5);
	};
	window.plusRestroomAcceptChance = function (opts = {}) {
		const V = State.variables;
		const beauty = Number(V && V.beauty) || 0;
		const allure = Number(V && V.allure) || 0;
		const exposed = Number(V && V.exposed) || 0;
		const bladder = Number(V && V.plusBladder);
		const bowels = Number(V && V.plusBowels);
		const urgent = (Number.isFinite(bladder) && bladder <= URGENT) || (Number.isFinite(bowels) && bowels <= URGENT);
		const desperate = (Number.isFinite(bladder) && bladder <= 100) || (Number.isFinite(bowels) && bowels <= 100);
		const isNight = opts.night != null ? !!opts.night : night();
		let dusk = false, dawn = false;
		try {
			const st = Time.dayState;
			dusk = st === "dusk";
			dawn = st === "dawn";
		} catch (e) {}
		if (opts.dusk != null) dusk = !!opts.dusk;
		if (opts.dawn != null) dawn = !!opts.dawn;
		const visible = opts.visible != null ? !!opts.visible : !!(window.plusDiaperVisible && window.plusDiaperVisible());
		const smell = opts.smell != null ? !!opts.smell : window.plusRestroomSmellNoticed();
		const mods = {
			beauty: Math.clamp((beauty - 2500) / 10000, -0.10, 0.15),
			fameGood: Math.clamp(fameGood() / 1000 * 0.08, 0, 0.12),
			fameBad: -Math.clamp(fameBad() / 2000 * 0.10, 0, 0.15),
			allure: allure >= 2000 ? -Math.clamp((allure - 2000) / 8000, 0, 0.15) : (allure > 0 && allure < 1500 ? 0.03 : 0),
			crime: -Math.clamp(crimeSum() / 20000, 0, 0.25),
			exposed: exposed > 0 ? -0.20 : 0,
			night: isNight ? -0.22 : dusk ? -0.08 : dawn ? -0.04 : 0,
			pleading: desperate ? 0.20 : urgent ? 0.12 : 0,
			visible: visible ? -0.18 : 0,
			smell: smell ? -0.16 : 0,
			contRep: typeof window.plusContRepRestroomMod === "function" ? window.plusContRepRestroomMod() : 0,
		};
		let p = RESTROOM_BASE;
		for (const k of Object.keys(mods)) p += mods[k];
		p = Math.clamp(p, RESTROOM_MIN, RESTROOM_MAX);
		return {
			p: Math.round(p * 1000) / 1000,
			base: RESTROOM_BASE,
			mods,
			night: isNight,
			dusk,
			dawn,
			urgent,
			desperate,
			pleading: mods.pleading > 0,
			visible,
			smell,
			commented: visible || smell,
		};
	};
	window.plusRestroomRefuseAccidentChance = function () {
		const V = State.variables;
		const bladder = Number(V && V.plusBladder);
		const bowels = Number(V && V.plusBowels);
		const lowest = Math.min(Number.isFinite(bladder) ? bladder : 2000, Number.isFinite(bowels) ? bowels : 2000);
		if (lowest > URGENT) return 0;
		return lowest <= 100 ? 0.5 : 0.25;
	};
	window.plusRestroomAccidentWhich = function () {
		const V = State.variables;
		const b = Number(V && V.plusBladder), w = Number(V && V.plusBowels);
		const bU = Number.isFinite(b) && b <= URGENT, wU = Number.isFinite(w) && w <= URGENT;
		if (bU && wU) return "both";
		if (wU) return "plusBowels";
		if (bU) return "plusBladder";
		return "";
	};
	window.plusRestroomResolve = function (opts = {}) {
		const V = State.variables;
		const street = opts.street || V.plusRestroomReturn || "";
		const house = opts.house || V.plusRestroomHouse || "";
		const info = window.plusRestroomAcceptChance(opts);
		if (street && house) window.plusRestroomMarkUsed(street, house);
		let accepted = opts.force === true ? true : opts.force === false ? false : Math.random() < info.p;
		const accP = window.plusRestroomRefuseAccidentChance();
		const which = window.plusRestroomAccidentWhich();
		const accident = !accepted && which && (opts.forceAccident === true || (opts.forceAccident !== false && Math.random() < accP));
		const out = Object.assign({}, info, {
			accepted,
			street,
			house,
			accident: !!accident,
			accidentWhich: accident ? which : "",
			accidentChance: accP,
		});
		V.plusRestroomLast = out;
		return out;
	};

	/* ---- Continence reputation (0-1000): witnessed accidents and visible diapers. ----
	 * Uses the same tier names as the Social fame panel, scaled to 0-1000
	 * (Unknown → Obscure → Low-key → Known → Recognised → Famous → Notorious). */
	const CONTREP_STATES = [
		{ min: 0, name: "Unknown", color: "green", restroom: 0, work: 1 },
		{ min: 30, name: "Obscure", color: "teal", restroom: -0.02, work: 0.97 },
		{ min: 100, name: "Low-key", color: "lblue", restroom: -0.05, work: 0.94 },
		{ min: 200, name: "Known", color: "blue", restroom: -0.08, work: 0.90 },
		{ min: 400, name: "Recognised", color: "purple", restroom: -0.12, work: 0.86 },
		{ min: 600, name: "Famous", color: "pink", restroom: -0.16, work: 0.80 },
		{ min: 1000, name: "Notorious", color: "red", restroom: -0.22, work: 0.74 },
	];
	const CONTREP_GAIN = {
		absorbed: { plusBladder: 8, plusBowels: 10, both: 14 },
		clothed: { plusBladder: 20, plusBowels: 28, both: 36 },
		floor: { plusBladder: 40, plusBowels: 50, both: 60 },
		seen: 4, wet: 3, dirty: 4, outdoor: 12,
		busyMul: 1.5, schoolMul: 1.5, nightMul: 0.5, seenBusyMul: 1.25,
	};
	const CONTREP_DECAY = { afterGain: 4, clean: 12, cleanStep: 4, max: 28 };
	const CONTREP_REMARK_CHANCE = [0, 0, 0, 0.08, 0.15, 0.25, 0.40];
	const CONTREP_REMARK_CD = 60 * 60;
	const CONTREP_REMARK_STRESS = 8;
	const CONTREP_REMARKS = {
		3: [
			"Someone gives you a second look, as if they're trying to remember why they recognise you.",
			"A passer-by glances at you and whispers something to their friend.",
		],
		4: [
			"You hear someone murmur, \"That's the one who had that accident,\" as you walk past.",
			"A stranger looks at you, then quickly away, like they've heard a story about you.",
		],
		5: [
			"Two townsfolk stop talking when they see you. One of them mutters something about needing to be more careful.",
			"A shopper tugs their friend's sleeve and nods in your direction. You catch the word \"accident.\"",
		],
		6: [
			"People glance at you and smirk. Someone says, just loud enough, \"Watch out they don't have another accident.\"",
			"A group of locals goes quiet as you pass, then one of them snickers. Your reputation has clearly travelled.",
			"Someone calls after you, \"There's the infamous one. Better find a toilet.\"",
		],
	};
	function contWhich(which) {
		if (which === "both" || which === "plusBowels" || which === "plusBladder") return which;
		return "plusBladder";
	}
	window.plusContRepStates = CONTREP_STATES;
	window.plusContRepGains = CONTREP_GAIN;
	window.plusContRepDecayInfo = CONTREP_DECAY;
	window.plusContRepInit = function () {
		const V = State.variables;
		if (!V) return;
		if (!Number.isFinite(V.plusContRep)) V.plusContRep = 0;
		if (!Number.isFinite(V.plusContRepCleanDays)) V.plusContRepCleanDays = 0;
		if (V.plusContRepDayGain !== 0 && V.plusContRepDayGain !== 1) V.plusContRepDayGain = 0;
		if (!Number.isFinite(V.plusContRepDecayDay)) V.plusContRepDecayDay = window.plusDayKey();
	};
	window.plusContRepInfo = function () {
		window.plusContRepInit();
		const v = State.variables.plusContRep || 0;
		let st = CONTREP_STATES[0];
		for (const row of CONTREP_STATES) if (v >= row.min) st = row;
		return Object.assign({ value: v, index: CONTREP_STATES.indexOf(st) }, st);
	};
	window.plusContRepLabel = function () {
		return window.plusContRepInfo().name;
	};
	window.plusContRepRestroomMod = function () {
		return window.plusContRepInfo().restroom;
	};
	window.plusContRepWorkMul = function () {
		return window.plusContRepInfo().work;
	};
	window.plusContRepAdd = function (amt, opts) {
		window.plusContRepInit();
		const V = State.variables;
		const n = Math.round(Number(amt) || 0);
		if (!n) return V.plusContRep;
		V.plusContRep = Math.clamp(V.plusContRep + n, 0, 1000);
		if (n > 0 && !(opts && opts.quiet)) V.plusContRepDayGain = 1;
		return V.plusContRep;
	};
	window.plusContRepOnAccident = function (seen, opts = {}) {
		if (!(seen > 0)) return 0;
		window.plusContRepInit();
		const title = opts.title || State.passage;
		const table = opts.absorbed ? CONTREP_GAIN.absorbed : opts.floor ? CONTREP_GAIN.floor : CONTREP_GAIN.clothed;
		let amt = table[contWhich(opts.which)];
		const isBusy = opts.busy != null ? !!opts.busy : busy(title);
		const isSchool = opts.school != null ? !!opts.school : window.plusIsSchool(title);
		const isNight = opts.night != null ? !!opts.night : night();
		if (isBusy) amt = Math.round(amt * CONTREP_GAIN.busyMul);
		if (isSchool) amt = Math.round(amt * CONTREP_GAIN.schoolMul);
		if (isNight) amt = Math.round(amt * CONTREP_GAIN.nightMul);
		window.plusContRepAdd(amt);
		return amt;
	};
	window.plusContRepOnSeen = function (opts = {}) {
		window.plusContRepInit();
		const title = opts.title || State.passage;
		let amt = CONTREP_GAIN.seen;
		const it = typeof window.plusDiaperWorn === "function" ? window.plusDiaperWorn() : null;
		const wet = opts.wet != null ? !!opts.wet : !!(it && it.plusMl > 0);
		const dirty = opts.dirty != null ? !!opts.dirty : !!(it && it.plusLb > 0);
		if (wet) amt += CONTREP_GAIN.wet;
		if (dirty) amt += CONTREP_GAIN.dirty;
		const isBusy = opts.busy != null ? !!opts.busy : busy(title);
		const isSchool = opts.school != null ? !!opts.school : window.plusIsSchool(title);
		if (isBusy) amt = Math.round(amt * CONTREP_GAIN.seenBusyMul);
		if (isSchool) amt = Math.round(amt * CONTREP_GAIN.seenBusyMul);
		window.plusContRepAdd(amt);
		return amt;
	};
	window.plusContRepOnOutdoor = function (title) {
		let amt = CONTREP_GAIN.outdoor;
		if (busy(title)) amt = Math.round(amt * CONTREP_GAIN.busyMul);
		if (window.plusIsSchool(title)) amt = Math.round(amt * CONTREP_GAIN.schoolMul);
		if (night()) amt = Math.round(amt * CONTREP_GAIN.nightMul);
		window.plusContRepAdd(amt);
		return amt;
	};
	window.plusContRepDecayAmt = function (cleanDays, hadGain) {
		if (hadGain) return CONTREP_DECAY.afterGain;
		const extra = Math.max(0, (cleanDays || 1) - 1);
		return Math.min(CONTREP_DECAY.max, CONTREP_DECAY.clean + extra * CONTREP_DECAY.cleanStep);
	};
	window.plusContRepDecay = function () {
		window.plusContRepInit();
		const V = State.variables;
		const day = window.plusDayKey();
		if (V.plusContRepDecayDay === day) return 0;
		let days = 1;
		if (Number.isFinite(V.plusContRepDecayDay) && day > V.plusContRepDecayDay) days = Math.min(30, day - V.plusContRepDecayDay);
		let total = 0;
		for (let i = 0; i < days; i++) {
			if (V.plusContRepDayGain) V.plusContRepCleanDays = 0;
			else V.plusContRepCleanDays = (V.plusContRepCleanDays || 0) + 1;
			const amt = window.plusContRepDecayAmt(V.plusContRepCleanDays, !!V.plusContRepDayGain);
			V.plusContRepDayGain = 0;
			const next = Math.clamp((V.plusContRep || 0) - amt, 0, 1000);
			total += (V.plusContRep || 0) - next;
			V.plusContRep = next;
		}
		V.plusContRepDecayDay = day;
		return total;
	};
	window.plusContRepRemarkStress = function () {
		const V = State.variables;
		if (typeof window.plusDiaperAccepted === "function" && window.plusDiaperAccepted()) return 0;
		const acc = Number(V && V.acceptance_diaper) || 0;
		if (acc >= 500) return Math.round(CONTREP_REMARK_STRESS / 2);
		return CONTREP_REMARK_STRESS;
	};
	window.plusContRepRemarkChance = function () {
		return CONTREP_REMARK_CHANCE[window.plusContRepInfo().index] || 0;
	};
	window.plusContRepRemarkCheck = function (title, force) {
		const V = State.variables;
		if (!V || V.combat === 1 || V.intro) return "";
		const info = window.plusContRepInfo();
		const lines = CONTREP_REMARKS[info.index];
		if (!lines || !lines.length) return "";
		if (!force && !window.plusIsPublic(title || State.passage)) return "";
		const now = window.plusNowTs();
		if (!force && Number.isFinite(V.plusContRepRemarkNext) && now < V.plusContRepRemarkNext) return "";
		if (!force && Math.random() >= window.plusContRepRemarkChance()) return "";
		V.plusContRepRemarkNext = now + CONTREP_REMARK_CD;
		const text = lines[Math.floor(Math.random() * lines.length)];
		const stress = window.plusContRepRemarkStress();
		if (stress && Number.isFinite(V.stress)) {
			V.stress = Math.min(Number.isFinite(V.stressmax) ? V.stressmax : 10000, V.stress + stress);
			V.plusContRepRemarkStressed = 1;
		} else delete V.plusContRepRemarkStressed;
		V.plusContRepRemark = text;
		return text;
	};
	window.plusKnockAdjustPool = function (opts = {}) {
		const pool = opts.pool || (typeof T !== "undefined" && T.eventpool) || (State.temporary && State.temporary.eventpool);
		if (!Array.isArray(pool)) return pool;
		const title = opts.title != null ? opts.title : (State.passage || "");
		if (!opts.force && !/(House Knock|Flats Knock)/.test(title)) return pool;
		const mul = window.plusContRepWorkMul();
		if (!(mul < 1)) return pool;
		for (const ev of pool) {
			if (!ev || typeof ev.content !== "string" || ev.content.indexOf("Ask for work") < 0) continue;
			const w = typeof ev.weight === "function" ? ev.weight() : ev.weight;
			ev.weight = (Number.isFinite(w) ? w : 1) * mul;
		}
		return pool;
	};
	$(document).on(":passagestart", function (ev) {
		const V = State.variables;
		if (!V || V.intro || V.combat === 1) return;
		try {
			window.plusContRepDecay();
			const t = ev.passage && ev.passage.title;
			if (V.plusContRepLastPassage !== t || V.plusContRepLastTs !== window.plusNowTs()) {
				V.plusContRepLastPassage = t;
				V.plusContRepLastTs = window.plusNowTs();
				window.plusContRepRemarkCheck(t);
			}
		} catch (e) {
			console.warn("plusContRep", e);
		}
	});
	$(document).on(":passagerender", function (ev) {
		const V = State.variables;
		if (!V || !V.plusContRepRemark || V.combat === 1 || V.intro) return;
		const text = V.plusContRepRemark;
		const stressed = V.plusContRepRemarkStressed;
		delete V.plusContRepRemark;
		delete V.plusContRepRemarkStressed;
		const div = document.createElement("div");
		div.className = "plus-needs-contrep";
		div.innerHTML = `<span class="purple">${text}</span>${stressed ? " You feel stressed." : ""}<br><br>`;
		ev.content.prepend(div);
	});
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

/* ---- Diapers (under_lower clothing), v2: continuous meters.
 * Each item carries plusMl / plusLb (what it holds) and plusCapMl / plusCapLb (its capacity, rolled once per item
 * instance within the model's range, the first time the item is seen). A pee accident is ~400 ml and a poop ~0.5 lb
 * (each +-15%). What fits is absorbed; the overflow fraction leaks through the normal wetness/soiling rules, scaled.
 * Disposables are thrown away; cloth ones are washed to reset. Single-use pull-ups are spent after their first use.
 * Prices (pence): plastic-backed Small 500 .. Hyper 6000; pull-ups 400 .. 1800; cloth 1200 .. 3000 (reusable, so dearer
 * up front). Price rises with capacity within each category. ---- */
(function () {
	"use strict";
	const PEE_ML = 400, POOP_LB = 0.5, VAR = 0.15;
	// category, size, variable, ml [min,max], lb [min,max], avg use, cost (pence), sprite folder, icon
	const P = "plastic-backed diaper", C = "cloth diaper", U = "pull-up";
	const MODELS = [
		[P, "Hyper", "plusdphyper", [12000, 12000], [9, 9], "3–4 days", 6000, "diaper-large.png"],
		[P, "Max", "plusdpmax", [7500, 7500], [5.5, 5.5], "1–2 days", 4000, "diaper-large.png"],
		[P, "Ultra", "plusdpultra", [5000, 5000], [3.75, 3.75], "1 day", 2800, "diaper-large.png"],
		[P, "Extra Large", "plusdpxl", [3500, 3500], [2.75, 2.75], "12–24 hours", 1800, "diaper-large.png"],
		[P, "Large", "plusdpl", [2500, 2500], [2, 2], "8–12 hours", 1300, "diaper-large.png"],
		[P, "Medium", "plusdpm", [1800, 1800], [1.5, 1.5], "6–10 hours", 900, "diaper.png"],
		[P, "Small", "plusdps", [1000, 1000], [1, 1], "4–8 hours", 500, "diaper-small.png"],
		[C, "Extra Large", "pluscdxl", [2000, 2000], [1.75, 1.75], "6–12 hours (until capacity or comfort fails)", 3000, "cloth-diaper.png"],
		[C, "Large", "pluscdl", [1500, 1500], [1.25, 1.25], "4–8 hours (until capacity or comfort fails)", 2400, "cloth-diaper.png"],
		[C, "Medium", "pluscdm", [1000, 1000], [0.875, 0.875], "3–6 hours (until capacity or comfort fails)", 1800, "cloth-diaper.png"],
		[C, "Small", "pluscds", [600, 600], [0.5, 0.5], "2–4 hours (until capacity or comfort fails)", 1200, "cloth-diaper.png"],
		[U, "Large", "pluspul", [2200, 2200], [1.5, 1.5], "8–12 hours", 1800, "pull-up.png"],
		[U, "Medium", "pluspum", [1600, 1600], [1, 1], "6–10 hours", 1200, "pull-up.png"],
		[U, "Small", "pluspus", [1000, 1000], [0.75, 0.75], "4–8 hours", 800, "pull-up.png"],
		[U, "Extra Small", "pluspuxs", [450, 450], [0.4, 0.4], "2–4 hours (or until first significant use saturates it)", 400, "pull-up.png"],
	];
	const BLURB = { [P]: "A disposable diaper with a crinkly plastic backing.", [C]: "Soft, washable cloth. Reusable: wash it to reset it.", [U]: "Disposable underwear that pulls up and down like normal pants." };
	/* Large (size 4 on the swell scale) is the standard/"normal" capacity.
	 * The clothing shop and pharmacy sell Large and below; Extra Large and up
	 * are only stocked at the adult shop after it opens ($adultshopunlocked). */
	const OVERSIZE = new Set(["Extra Large", "Ultra", "Max", "Hyper"]);
	const DEF = {};
	const fmtR = (r, u) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`) + u;
	for (const [cat, size, variable, ml, lb, use, cost, icon] of MODELS) {
		const single = size === "Extra Small";
		const name = `${cat} (${size})`;
		const desc = `${BLURB[cat]}${single ? " Single use." : ""} Avg. Use: ${use}. Holds ${fmtR(ml, " ml")} and ${fmtR(lb, " lb")}.`;
		const shop = OVERSIZE.has(size) ? "adult" : "clothing";
		DEF[name] = { name, cat, size, variable, ml, lb, use, cost, icon: "plusneeds/" + icon, cloth: cat === C, single, desc, shop };
	}
	window.plusDiaperDefs = DEF;
	// v1 saves -> nearest v2 model (wet/soil counts convert at 400 ml / 0.5 lb each)
	const OLD = { "plastic diaper (large)": "plastic-backed diaper (Extra Large)", "plastic diaper": "plastic-backed diaper (Medium)", "plastic diaper (small)": "plastic-backed diaper (Small)", "cloth diaper": "cloth diaper (Small)", "pull-up": "pull-up (Medium)" };
	window.plusDiaperOldMap = OLD;
	window.plusDiaperItems = function () {
		return Object.values(DEF).map(d => new ClothesItem({
			index: 0, slot: "under_lower", name: d.name, name_cap: d.name[0].toUpperCase() + d.name.slice(1),
			name_simple: d.cat === U ? "pull-up" : "diaper", variable: d.variable,
			combat: { reference: "plainpanties", accessory: false },
			integrity: 100, integrity_max: 100, fabric_strength: 15, reveal: 400, rearresize: 0, word: "a",
			one_piece: 0, state: "waist", state_base: "waist", plural: 0,
			colour: 0, colour_options: ["pale white"], colour_sidebar: 0,
			exposed: 0, exposed_base: 0, vagina_exposed: 0, vagina_exposed_base: 0, anus_exposed: 0, anus_exposed_base: 0,
			type: ["normal", "antitransparent"], anal_shield: 0, set: "under_lower", gender: "n", femininity: 0,
			warmth: 2, cost: d.cost, description: d.desc, shop: [d.shop],
			accessory: 0, accessory_colour: 0, accessory_colour_options: [], penis_img: 1, high_img: 0,
			cursed: 0, location: 0, iconFile: d.icon, accIcon: 0, modder: "plusneeds",
		}));
	};
	const roll = r => (r[0] === r[1] ? r[0] : r[0] + Math.random() * (r[1] - r[0]));
	const r2 = x => Math.round(x * 100) / 100;
	function migrate(it) {
		const nn = OLD[it.name];
		if (!nn || !it.type || it.type.includes("naked")) return false;
		const tpl = setup.clothes.under_lower.find(c => c.name === nn);
		if (!tpl) return false;
		for (const k of ["name", "name_cap", "name_simple", "variable", "index", "iconFile", "cost", "description"]) it[k] = tpl[k];
		const w = Number(it.plusDiaperWet) || 0, p = Number(it.plusDiaperSoil) || 0;
		delete it.plusCapMl;
		delete it.plusCapLb;
		it.plusMl = w * PEE_ML;
		it.plusLb = p * POOP_LB;
		delete it.plusDiaperWet;
		delete it.plusDiaperSoil;
		return true;
	}
	const def = it => {
		if (!it || !Array.isArray(it.type) || it.type.includes("naked")) return null;
		if (OLD[it.name] && typeof setup !== "undefined" && setup.clothes) migrate(it);
		return DEF[it.name] || null;
	};
	function init(it) {
		const d = def(it);
		if (!d) return it;
		if (!it.colour) it.colour = "pale white";
		// (re)roll when missing or outside the model's current range (capacity table changes migrate old items)
		if (!Number.isFinite(it.plusCapMl) || it.plusCapMl < d.ml[0] || it.plusCapMl > d.ml[1]) it.plusCapMl = Math.round(roll(d.ml));
		if (!Number.isFinite(it.plusCapLb) || it.plusCapLb < d.lb[0] - 1e-9 || it.plusCapLb > d.lb[1] + 1e-9) it.plusCapLb = Math.round(roll(d.lb) * 1000) / 1000;
		if (!Number.isFinite(it.plusMl)) it.plusMl = 0;
		if (!Number.isFinite(it.plusLb)) it.plusLb = 0;
		it.plusMl = Math.clamp(it.plusMl, 0, it.plusCapMl);
		it.plusLb = Math.clamp(it.plusLb, 0, it.plusCapLb);
		it.plusDiaperFill = it.plusMl + it.plusLb; // truthy when used (display/compat)
		return it;
	}
	window.plusDiaperInit = init;
	/* One pass over the save on load: migrate every old diaper anywhere in the state (worn, wardrobes, carried, ...). */
	window.plusDiaperMigrateAll = function () {
		const V = State.variables;
		if (!V || V.plusDiaperV2) return 0;
		let n = 0;
		const seen = new Set();
		(function walk(o, depth) {
			if (!o || typeof o !== "object" || seen.has(o) || depth > 8) return;
			seen.add(o);
			if (typeof o.name === "string" && OLD[o.name] && Array.isArray(o.type)) {
				if (migrate(o)) {
					init(o);
					n++;
				}
				return;
			}
			for (const k of Object.keys(o)) walk(o[k], depth + 1);
		})(V, 0);
		V.plusDiaperV2 = 1;
		return n;
	};
	$(document).on(":passagestart", () => {
		try {
			if (State.variables && State.variables.worn) window.plusDiaperMigrateAll();
		} catch (e) {
			console.warn("plusDiaperMigrate", e);
		}
	});
	window.plusDiaperDef = def;
	window.plusDiaperWorn = function () {
		const W = State.variables.worn, it = W && W.under_lower;
		return def(it) ? init(it) : null;
	};
	const spent = it => def(it).single && it.plusSpent;
	window.plusDiaperPeeFull = it => !!def(it) && (init(it).plusMl >= it.plusCapMl || spent(it));
	window.plusDiaperPoopFull = it => !!def(it) && (init(it).plusLb >= it.plusCapLb || spent(it));
	window.plusDiaperFull = it => window.plusDiaperPeeFull(it) && window.plusDiaperPoopFull(it);
	window.plusPeeAmount = () => Math.round(PEE_ML * (1 - VAR + Math.random() * 2 * VAR));
	window.plusPoopAmount = () => r2(POOP_LB * (1 - VAR + Math.random() * 2 * VAR));
	/* Called once per accident notice. Returns the part that leaks: "", "plusBladder", "plusBowels" or "both".
	 * The leaking fractions (0-1) are left in State.temporary.plusLeakPee / plusLeakPoop / plusLeakFrac (the largest). */
	window.plusDiaperAbsorb = function (which, peeMl, poopLb) {
		const T = State.temporary, V = State.variables;
		T.plusLeakPee = T.plusLeakPoop = T.plusLeakFrac = 0;
		const it = window.plusDiaperWorn();
		if (!it) {
			T.plusLeakPee = which !== "plusBowels" ? 1 : 0;
			T.plusLeakPoop = which !== "plusBladder" ? 1 : 0;
			T.plusLeakFrac = 1;
			return which;
		}
		const d = def(it), S = V.plusNeedsStats || (V.plusNeedsStats = {});
		const wasSpent = spent(it);
		if (which !== "plusBowels") {
			const amt = Number.isFinite(peeMl) ? peeMl : window.plusPeeAmount();
			const room = wasSpent ? 0 : Math.max(0, it.plusCapMl - it.plusMl);
			const took = Math.min(amt, room);
			it.plusMl += took;
			S.mlAbsorbed = (S.mlAbsorbed || 0) + took;
			T.plusLeakPee = amt > 0 ? (amt - took) / amt : 0;
			if (took > 0) it.plusDirt = Math.min(2000, (it.plusDirt || 0) + 100);
		}
		if (which !== "plusBladder") {
			const amt = Number.isFinite(poopLb) ? poopLb : window.plusPoopAmount();
			const room = wasSpent ? 0 : Math.max(0, it.plusCapLb - it.plusLb);
			const took = Math.min(amt, room);
			it.plusLb = r2(it.plusLb + took);
			S.lbAbsorbed = r2((S.lbAbsorbed || 0) + took);
			T.plusLeakPoop = amt > 0 ? (amt - took) / amt : 0;
			if (took > 0) it.plusDirt = Math.min(2000, (it.plusDirt || 0) + 250);
		}
		if ((T.plusLeakPee < 1 && which !== "plusBowels") || (T.plusLeakPoop < 1 && which !== "plusBladder")) S.accDiaper = (S.accDiaper || 0) + 1;
		if (d.single) it.plusSpent = true; // first significant use saturates a single-use pull-up
		init(it);
		const lw = T.plusLeakPee > 0.001, ls = T.plusLeakPoop > 0.001;
		if (lw || ls) it.plusOverflow = 1;
		window.plusSwellUpdate(it);
		T.plusLeakFrac = Math.max(lw ? T.plusLeakPee : 0, ls ? T.plusLeakPoop : 0);
		return lw && ls ? "both" : lw ? "plusBladder" : ls ? "plusBowels" : "";
	};
	/* Solids held in the worn diaper, in lb (smell scales with this). */
	window.plusDiaperPoops = function () {
		const it = window.plusDiaperWorn();
		return it ? it.plusLb : 0;
	};
	window.plusDiaperReset = function (it) {
		if (!def(it)) return;
		init(it);
		it.plusMl = it.plusLb = it.plusDiaperFill = 0;
		delete it.plusSpent;
		delete it.plusOverflow;
		it.plusSwellStage = it.plusSwellNoted = it.plusSagNoted = 0;
	};
	/* Sidebar words. Pee by fill %: damp >0, wet >40%, soaked >75%, full 100%. Poop: messy >0, very messy >60%, full. */
	window.plusDiaperWords = function (it) {
		const d = def(it);
		if (!d) return [];
		init(it);
		const out = [], w = it.plusMl / it.plusCapMl, p = it.plusLb / it.plusCapLb;
		const pf = w >= 1 || (spent(it) && it.plusMl > 0), sf = p >= 1 || (spent(it) && it.plusLb > 0);
		if (pf && sf) return ["full"];
		if (pf) out.push("full");
		else if (w > 0.75) out.push("soaked");
		else if (w > 0.4) out.push("wet");
		else if (w > 0) out.push("damp");
		if (sf) out.push(pf ? "" : "full of mess");
		else if (p > 0.6) out.push("very messy");
		else if (p > 0) out.push("messy");
		return out.filter(Boolean);
	};
	window.plusDiaperKeyword = it => window.plusDiaperWords(it).join(" ");
	const fmtLb = x => String(Math.round(x * 1000) / 1000);
	window.plusDiaperMeterText = function (it) {
		if (!def(it)) return "";
		init(it);
		return `${Math.round(it.plusMl)}/${it.plusCapMl} ml, ${fmtLb(it.plusLb)}/${fmtLb(it.plusCapLb)} lb`;
	};
	/* The base game dries $underlowerwet over time (and on sleep/pass). Re-pin it to what a worn diaper holds after every passage. */
	window.plusDiaperPinWet = function () {
		const V = State.variables, it = window.plusDiaperWorn();
		if (!it || !(it.plusMl > 0) || !Number.isFinite(V.underlowerwet)) return;
		V.underlowerwet = Math.max(V.underlowerwet, Math.round(95 * Math.min(1, it.plusMl / (it.plusCapMl || 1))));
	};
	$(document).on(":passageend", () => { try { window.plusDiaperPinWet(); } catch (e) { console.error(e); } });
	/* Sidebar meter data (lb scaled x1000 so the bar macro works on integers). null when no diaper is worn. */
	window.plusDiaperBarData = function () {
		const it = window.plusDiaperWorn();
		if (!it) return null;
		init(it);
		const sp = spent(it);
		return {
			ml: sp && it.plusMl > 0 ? it.plusCapMl : Math.round(it.plusMl), capMl: it.plusCapMl,
			lb: sp && it.plusLb > 0 ? Math.round(it.plusCapLb * 1000) : Math.round(it.plusLb * 1000), capLb: Math.round(it.plusCapLb * 1000),
			mlText: `${Math.round(it.plusMl)}/${it.plusCapMl} ml`, lbText: `${fmtLb(it.plusLb)}/${fmtLb(it.plusCapLb)} lb`,
		};
	};
	/* Wardrobe label: "(ml/capml) (lb/caplb)" for any mod diaper item, "" otherwise. */
	window.plusDiaperFillLabel = function (it) {
		if (!it || !def(it)) return "";
		init(it);
		return ` <span class="plusdiaperfill lblue">(${Math.round(it.plusMl)}/${it.plusCapMl}ml) (${fmtLb(it.plusLb)}/${fmtLb(it.plusCapLb)}lb)</span>`;
	};
	/* How loaded a diaper is: mean fill fraction of ml+lb, tie-broken by absolute amount. */
	const loadScore = it => { init(it); return [(Math.min(1, it.plusMl / (it.plusCapMl || 1)) + Math.min(1, it.plusLb / (it.plusCapLb || 1))) / 2, it.plusMl + it.plusLb * 1000]; };
	const moreLoaded = (a, b) => { const x = loadScore(a), y = loadScore(b); return x[0] > y[0] + 1e-9 || (Math.abs(x[0] - y[0]) <= 1e-9 && x[1] > y[1]); };
	/* Swap the worn diaper for the most loaded wardrobe copy of the same diaper (the worn one goes back into that wardrobe slot untouched). */
	window.plusEquipMostLoaded = function (wardrobe) {
		const V = State.variables, w = V.worn.under_lower;
		if (!w || !def(w)) return false;
		const list = (wardrobe || (typeof selectWardrobe === "function" ? selectWardrobe() : V.wardrobe)).under_lower || [];
		let best = -1;
		list.forEach((c, i) => { if (c && c.name === w.name && def(c) && moreLoaded(c, best < 0 ? w : list[best])) best = i; });
		if (best < 0) return false;
		const pick = list[best];
		list[best] = w;
		V.worn.under_lower = pick;
		return true;
	};
	/* Outfit hook: keep an already-worn diaper of the outfit's type, otherwise put on the most loaded copy. */
	window.plusOutfitPre = function () {
		const V = State.variables, o = V.outfit && V.outfit[V.wear_outfit];
		window.plusOutfitKeep = null;
		if (!o || !o.under_lower || !def(V.worn.under_lower) || o.under_lower !== V.worn.under_lower.name) return null;
		const keep = { idx: V.wear_outfit, name: o.under_lower };
		delete o.under_lower; // skip the slot: the matching diaper is already on
		window.plusOutfitKeep = keep;
		return keep;
	};
	window.plusOutfitPost = function () {
		const keep = window.plusOutfitKeep, V = State.variables;
		window.plusOutfitKeep = null;
		if (keep) { const o = V.outfit && V.outfit[keep.idx]; if (o && o.under_lower === undefined) o.under_lower = keep.name; return; }
		// only when an outfit actually put this diaper on (the widget also runs with $wear_outfit "none" when entering a wardrobe)
		const o = V.outfit && V.outfit[V.wear_outfit];
		if (o && V.worn.under_lower && o.under_lower === V.worn.under_lower.name) window.plusEquipMostLoaded();
	};
	/* "Change" option: a used disposable is thrown away. */
	window.plusDiaperCanDispose = function () {
		const it = window.plusDiaperWorn();
		return !!it && !def(it).cloth && (it.plusMl > 0 || it.plusLb > 0 || !!it.plusSpent);
	};
	window.plusDiaperDispose = function () {
		if (!window.plusDiaperCanDispose()) return false;
		window.plusNeedsStats().diapersUsed++;
		return true;
	};
	/* Clean unused spare diapers in the (selected) wardrobe. Used/spent copies don't count. */
	window.plusDiaperSpareCount = function () {
		const V = State.variables;
		let list = [];
		try { const w = typeof selectWardrobe === "function" ? selectWardrobe() : V.wardrobe; list = (w && w.under_lower) || []; } catch (e) { list = (V.wardrobe && V.wardrobe.under_lower) || []; }
		let n = 0;
		for (const it of list) {
			if (!it || !def(it)) continue;
			init(it);
			if (!it.plusSpent && !(it.plusMl > 0) && !(it.plusLb > 0)) n++;
		}
		return n;
	};
	window.plusSupplyWarn = function () {
		const V = State.variables;
		if (!V || V.intro) return "";
		const n = window.plusDiaperSpareCount();
		const relevant = !!window.plusDiaperWorn() || n > 0 || (V.background && V.background.incontinent) || (window.plusNeedsStats().diapersUsed > 0);
		if (!relevant || n > 2) return "";
		const d = window.plusDayKey();
		if (V.plusSupplyWarnDay === d) return "";
		V.plusSupplyWarnDay = d;
		const hint = window.plusDiaperAdultShopOpen()
			? " You can pick up more at the clothing shop, the pharmacy, or larger sizes at the adult shop on Elk Street."
			: " You can pick up more at the clothing shop or the pharmacy.";
		return (n <= 0 ? "You're out of clean spare diapers." : `You're running low on clean spare diapers (${n} left).`) + hint;
	};
	window.plusDiaperItemShop = function (name) {
		const d = DEF[name] || (name && name.name && DEF[name.name]);
		return d ? d.shop : "";
	};
	window.plusDiaperAdultShopOpen = function () {
		return !!(State.variables && State.variables.adultshopunlocked);
	};
	window.plusDiaperSoldAt = function (name, location) {
		if (window.plusDiaperItemShop(name) !== location) return false;
		if (location === "adult" && !window.plusDiaperAdultShopOpen()) return false;
		return true;
	};
	window.plusDiaperShopNames = function (location) {
		return Object.values(DEF).filter(d => d.shop === location).map(d => d.name);
	};
	const PACKS = [
		["plastic-backed diaper (Medium)", 5, "clothing"],
		["plastic-backed diaper (Medium)", 10, "clothing"],
		["plastic-backed diaper (Large)", 5, "clothing"],
		["plastic-backed diaper (Large)", 10, "clothing"],
		["pull-up (Medium)", 5, "clothing"],
		["pull-up (Medium)", 10, "clothing"],
		["pull-up (Large)", 5, "clothing"],
		["plastic-backed diaper (Small)", 5, "clothing"],
		["plastic-backed diaper (Extra Large)", 5, "adult"],
		["plastic-backed diaper (Extra Large)", 10, "adult"],
		["plastic-backed diaper (Ultra)", 5, "adult"],
		["plastic-backed diaper (Ultra)", 10, "adult"],
		["plastic-backed diaper (Max)", 5, "adult"],
		["plastic-backed diaper (Hyper)", 5, "adult"],
	];
	window.plusDiaperPackList = function (location) {
		const loc = location || "clothing";
		if (loc === "adult" && !window.plusDiaperAdultShopOpen()) return [];
		return PACKS.filter(p => p[2] === loc).map(([name, count]) => window.plusDiaperPackPrice(name, count)).filter(Boolean);
	};
	window.plusDiaperPackPrice = function (name, count) {
		const d = DEF[name];
		if (!d || !(count > 0)) return null;
		const disc = count >= 10 ? 0.3 : count >= 5 ? 0.2 : 0;
		return { name, count, disc, unit: d.cost, price: Math.round(d.cost * count * (1 - disc)) };
	};
	window.plusDiaperBuyPack = function (name, count) {
		const V = State.variables, info = window.plusDiaperPackPrice(name, count);
		if (!info) return { ok: false, reason: "item" };
		if (window.plusDiaperItemShop(name) === "adult" && !window.plusDiaperAdultShopOpen()) return { ok: false, reason: "item", ...info };
		if (!Number.isFinite(V.money) || V.money < info.price) return { ok: false, reason: "money", ...info };
		const tpl = setup.clothes.under_lower.find(c => c.name === name);
		if (!tpl || !V.wardrobe || !Array.isArray(V.wardrobe.under_lower)) return { ok: false, reason: "wardrobe", ...info };
		for (let i = 0; i < count; i++) {
			const it = JSON.parse(JSON.stringify(tpl));
			window.plusDiaperInit(it);
			it.colour = (it.colour_options && it.colour_options[0]) || it.colour;
			V.wardrobe.under_lower.push(it);
		}
		if (typeof statChange !== "undefined" && statChange.money) statChange.money(-info.price, "plusneeds");
		else V.money -= info.price;
		return { ok: true, ...info };
	};
	/* Diaper insecurity / acceptance: same 0-1000 scale as the base game.
	 * Acceptance at 1000 removes the stress penalty (bullying/notices can still happen).
	 * Attitudes $uncomfortable.diaperSeen / diaperUse default on; unchecking them also removes that source of stress. */
	const DIAPER_ACCEPT_MAX = 1000;
	window.plusDiaperAcceptMax = DIAPER_ACCEPT_MAX;
	window.plusDiaperInitInsecurity = function () {
		const V = State.variables;
		if (!V) return;
		if (!Number.isFinite(V.insecurity_diaper)) V.insecurity_diaper = 0;
		if (!Number.isFinite(V.acceptance_diaper)) V.acceptance_diaper = 0;
		if (!V.uncomfortable || typeof V.uncomfortable !== "object") V.uncomfortable = {};
		if (V.uncomfortable.diaperSeen === undefined) V.uncomfortable.diaperSeen = true;
		if (V.uncomfortable.diaperUse === undefined) V.uncomfortable.diaperUse = true;
	};
	window.plusDiaperInsecurityPossible = function () {
		const V = State.variables;
		if (!V) return false;
		window.plusDiaperInitInsecurity();
		if ((V.acceptance_diaper || 0) >= DIAPER_ACCEPT_MAX) return false;
		return !!(window.plusDiaperWorn && window.plusDiaperWorn())
			|| (V.insecurity_diaper > 0)
			|| (V.acceptance_diaper > 0)
			|| !!(V.background && V.background.incontinent);
	};
	window.plusDiaperAccepted = function () {
		const V = State.variables;
		return !!V && (V.acceptance_diaper || 0) >= DIAPER_ACCEPT_MAX;
	};
	window.plusDiaperUnlockAttitudes = function () {
		const V = State.variables;
		if (V && Number.isFinite(V.exhibitionism) && V.exhibitionism >= 35) return true; // exhibitionism level 3
		return window.plusDiaperAccepted();
	};
	/* kind: "seen" (visible diaper noticed) or "use" (accident/use in a diaper spotted, or the smell noticed). */
	window.plusDiaperStressApplies = function (kind) {
		const V = State.variables;
		if (!V) return false;
		window.plusDiaperInitInsecurity();
		const on = kind === "seen" ? V.uncomfortable.diaperSeen : V.uncomfortable.diaperUse;
		if (on === false) return false;
		if (window.plusDiaperAccepted()) return false;
		return true;
	};
	window.plusDiaperWantsPrivacy = function () {
		return window.plusDiaperStressApplies("use") && !!(window.plusDiaperWorn && window.plusDiaperWorn());
	};
	/* One exposure: +1 insecurity (0-1000) and acceptance like the base macros
	 * (acceptance -= 1, then += 10 * (ceil(insecurity/200) + 1)). */
	window.plusDiaperExposure = function () {
		const V = State.variables;
		window.plusDiaperInitInsecurity();
		const before = V.acceptance_diaper || 0;
		if (before >= DIAPER_ACCEPT_MAX) return { accepted: true, gained: false, acceptance: before, insecurity: V.insecurity_diaper };
		V.insecurity_diaper = Math.clamp((V.insecurity_diaper || 0) + 1, 0, 1000);
		V.acceptance_diaper = Math.clamp((V.acceptance_diaper || 0) - 1, 0, 1000);
		const mod = Math.ceil(V.insecurity_diaper / 200) + 1;
		V.acceptance_diaper = Math.clamp(V.acceptance_diaper + 10 * mod, 0, 1000);
		const gained = before < DIAPER_ACCEPT_MAX && V.acceptance_diaper >= DIAPER_ACCEPT_MAX;
		if (gained) {
			V.plusDiaperAcceptanceNote = 1;
			try { if (State.temporary) State.temporary.acceptanceAchieved = "diaper"; } catch (e) {}
		}
		return { accepted: V.acceptance_diaper >= DIAPER_ACCEPT_MAX, gained, acceptance: V.acceptance_diaper, insecurity: V.insecurity_diaper };
	};
	/* "Incontinent" background: Leaky continence, a pull-up worn instead of underwear and 5 spares in the wardrobe. */
	window.plusIncontinentStart = function () {
		const V = State.variables;
		if (!V.background || V.background.incontinent !== true) return false;
		V.plusContinence = 0;
		V.plusContinenceXP = 0;
		window.plusDiaperInitInsecurity();
		V.acceptance_diaper = Math.max(V.acceptance_diaper || 0, Math.round(window.plusDiaperAcceptMax * 0.5));
		if (!(V.insecurity_diaper > 0)) V.insecurity_diaper = 1;
		const idx = setup.clothes.under_lower.findIndex(c => c.name === "pull-up (Medium)");
		if (idx < 0) return false;
		const fresh = () => {
			const it = JSON.parse(JSON.stringify(setup.clothes.under_lower[idx]));
			window.plusDiaperInit(it);
			it.colour = (it.colour_options && it.colour_options[0]) || it.colour; // "pale white", as the shop sets it
			return it;
		};
		V.worn.under_lower = fresh();
		if (V.wardrobe && Array.isArray(V.wardrobe.under_lower)) for (let i = 0; i < 5; i++) V.wardrobe.under_lower.push(fresh());
		if (Array.isArray(V.backgroundTraits) && !V.backgroundTraits.includes("incontinent")) V.backgroundTraits.push("incontinent");
		return true;
	};

	/* ---- Swell. Size scale 0-8: 1 Extra Small, 2 Small, 3 Medium, 4 Large, 5 Extra Large, 6 Ultra, 7 Max, 8 Hyper
	 * (all categories map by size name). Fill fraction f = max(ml/capMl, lb/capLb) (spent single-use = 1).
	 * Stage = floor(f * N) (0..N, N = stage count per model); stage N+1 = "overflowing" (anything has leaked).
	 * Effective size (0-15 scale) = min(15, base + floor(min(stage, N) * G / N) + (overflowing ? 1 : 0)),
	 * G (growth at 100%) per model: see GROW. A full Hyper reaches 15. ---- */
	const SIZE = { "Extra Small": 1, Small: 2, Medium: 3, Large: 4, "Extra Large": 5, Ultra: 6, Max: 7, Hyper: 8 };
	const SIZE_NAMES = ["nothing", "Extra Small", "Small", "Medium", "Large", "Extra Large", "Ultra", "Max", "Hyper"];
	const STAGES = { [P]: { Hyper: 20, Max: 15, Ultra: 10, "Extra Large": 8, Large: 5, Medium: 4, Small: 3 }, [C]: { "Extra Large": 5, Large: 4, Medium: 3, Small: 2 }, [U]: { Large: 4, Medium: 3, Small: 3, "Extra Small": 2 } };
	const GROW = { [P]: { Hyper: 7, Max: 6, Ultra: 5, "Extra Large": 4, Large: 3, Medium: 3, Small: 2 }, [C]: { "Extra Large": 4, Large: 3, Medium: 2, Small: 1 }, [U]: { Large: 3, Medium: 2, Small: 2, "Extra Small": 1 } };
	const SIZE_MAX = 15;
	for (const d of Object.values(DEF)) {
		d.base = SIZE[d.size];
		d.stages = STAGES[d.cat][d.size];
		d.grow = GROW[d.cat][d.size];
		d.thresholds = Array.from({ length: d.stages }, (_, i) => Math.round(((i + 1) / d.stages) * 10000) / 100);
	}
	window.plusSizeNames = SIZE_NAMES;
	window.plusDiaperFillFrac = function (it) {
		if (!def(it)) return 0;
		init(it);
		if (spent(it) && (it.plusMl > 0 || it.plusLb > 0)) return 1;
		return Math.max(it.plusMl / it.plusCapMl, it.plusLb / it.plusCapLb);
	};
	window.plusSwellStage = function (it) {
		const d = def(it);
		if (!d) return 0;
		if (it.plusOverflow) return d.stages + 1;
		return Math.min(d.stages, Math.floor(window.plusDiaperFillFrac(it) * d.stages + 1e-9));
	};
	window.plusSwellUpdate = function (it) {
		if (!def(it)) return 0;
		it.plusSwellStage = window.plusSwellStage(it);
		if (!Number.isFinite(it.plusSwellNoted)) it.plusSwellNoted = 0;
		if (it.plusSwellNoted > it.plusSwellStage) it.plusSwellNoted = it.plusSwellStage;
		return it.plusSwellStage;
	};
	window.plusDiaperSize = function (it) {
		const d = def(it);
		if (!d) return 0;
		const st = window.plusSwellStage(it), over = st > d.stages;
		return Math.min(SIZE_MAX, d.base + Math.floor((Math.min(st, d.stages) * d.grow) / d.stages) + (over ? 1 : 0));
	};
	window.plusSwellWord = function (it) {
		const d = def(it);
		if (!d) return "";
		const st = window.plusSwellStage(it);
		if (st <= 0) return "";
		if (st >= d.stages) return "bulging";
		return st * 3 >= d.stages * 2 ? "swollen" : st * 3 >= d.stages ? "puffy" : "snug";
	};
	/* ---- Conceal 0-8: the largest diaper size an item can hide. Keyword defaults, per-item overrides. ---- */
	/* ---- Conceal 0-15 (same scale as effective diaper size; 15 = a fully swollen Hyper). ---- */
	const CONCEAL_OVERRIDE = { "school trousers": 4, "school shorts": 1, "school skirt": 7, jeans: 4, "baggy jeans": 9, overalls: 12, "long skirt": 10, "maid skirt": 8, kimono: 10, "witch robe": 15, hanfu: 10, "gym bloomers": 0, leggings: 0, "bike shorts": 0, "micro skirt": 1, "mini skirt": 5, "yoga pants": 0, "gothic trousers": 4, "short cheongsam skirt": 6, "skimpy lolita skirt": 5, "short ballgown skirt": 7, shortalls: 5, "wide leg trousers": 6, "leather skirt": 5, "leather miniskirt": 3, "sexy nun's habit skirt": 5, "patient gown skirt": 8, "virgin killer skirt": 4 };
	const CONCEAL_RULES = [
		[/swim|bikini|leotard|tights|legging|thong|bloomer|bike short|hot ?pants|booty|latex|leather|spandex|micro|body ?suit|wetsuit|catsuit|unitard/, 0],
		[/robe|cloak|gown|cassock|habit/, 15, "over"],
		[/coat|cape|poncho/, 14, "over"],
		[/overall|dungaree|jumpsuit/, 12],
		[/baggy|cargo|hakama|harem|kilt/, 11],
		[/mini|short (cut|school) skirt/, 5],
		[/long|maxi|ankle|floor|gown|kimono|robe|habit|cassock|ballgown|hanfu/, 10],
		[/dress|sundress|pinafore|gothic|lolita|cheongsam|qipao/, 9],
		[/skirt|skort/, 7],
		[/sweat|jogger|track|pyjama|pajama|lounge/, 6],
		[/shorts/, 1],
		[/jeans|trouser|pants|slacks|chino/, 4],
	];
	window.plusConcealOf = function (it, slot) {
		if (!it || !it.name || !Array.isArray(it.type) || it.type.includes("naked")) return -1;
		if (Number.isFinite(it.plusConceal)) return it.plusConceal;
		slot = slot || it.slot;
		if (slot === "under_lower" || slot === "under_upper") return 0;
		const n = it.name.toLowerCase();
		if (n in CONCEAL_OVERRIDE) return CONCEAL_OVERRIDE[n];
		for (const [re, v, only] of CONCEAL_RULES) if (re.test(n) && (!only || slot === "over_lower")) return v;
		return slot === "over_lower" ? 13 : 4;
	};
	const sizeLabel = v => (v <= 8 ? SIZE_NAMES[Math.max(0, v)] : v >= 15 ? "fully swollen Hyper" : v >= 12 ? "swollen Hyper" : "puffy Hyper");
	window.plusSizeLabel = sizeLabel;
	const concealText = v => (v <= 0 ? "Can hide: no diaper (0/15)" : `Can hide: up to ${sizeLabel(v)} (${v}/15)`);
	window.plusConcealText = concealText;
	window.plusConcealSetupDone = false;
	window.plusConcealSetup = function () {
		if (window.plusConcealSetupDone || typeof setup === "undefined" || !setup.clothes) return false;
		for (const slot of ["lower", "over_lower"])
			for (const it of setup.clothes[slot] || []) {
				if (!it || !it.name || (Array.isArray(it.type) && it.type.includes("naked"))) continue;
				it.plusConceal = window.plusConcealOf(it, slot);
				const t = concealText(it.plusConceal);
				if (typeof it.description === "string" && !it.description.includes("Can hide:")) it.description += ` ${t}.`;
			}
		window.plusConcealSetupDone = true;
		return true;
	};
	/* Worn: effective conceal = max over lower/over_lower (-1 = nothing worn there). */
	window.plusEffectiveConceal = function () {
		const W = State.variables.worn || {};
		let c = -1;
		for (const s of ["lower", "over_lower"]) c = Math.max(c, window.plusConcealOf(W[s], s));
		return c;
	};
	window.plusDiaperVisibility = function () {
		const it = window.plusDiaperWorn();
		if (!it) return { worn: false, visible: false, size: 0, conceal: window.plusEffectiveConceal(), over: 0 };
		const size = window.plusDiaperSize(it), conceal = window.plusEffectiveConceal();
		const visible = conceal < 0 || size > conceal;
		return { worn: true, visible, size, conceal, over: visible ? size - Math.max(0, conceal) : 0, stage: window.plusSwellStage(it), word: window.plusSwellWord(it) };
	};
	window.plusDiaperVisible = () => window.plusDiaperVisibility().visible;
	/* Noticing: 3% per size point over conceal, cap 25%, at most once per 30 game minutes, public passages only. */
	const NOTICE_PER = 0.03, NOTICE_CAP = 0.25, NOTICE_COOLDOWN = 30 * 60, NOTICE_STRESS = 50;
	window.plusDiaperNoticeChance = function (title = State.passage) {
		const v = window.plusDiaperVisibility();
		if (!v.visible || !window.plusIsPublic(title)) return 0;
		return Math.min(NOTICE_CAP, NOTICE_PER * v.over);
	};
	window.plusDiaperNoticeCheck = function (title, force) {
		const V = State.variables, now = window.plusNowTs();
		const c = window.plusDiaperNoticeChance(title);
		if (c <= 0) return 0;
		if (Number.isFinite(V.plusDiaperSeenNext) && now < V.plusDiaperSeenNext) return 0;
		if (!force && Math.random() >= c) return 0;
		V.plusDiaperSeenNext = now + NOTICE_COOLDOWN;
		const S = V.plusNeedsStats || (V.plusNeedsStats = {});
		S.diaperNoticed = (S.diaperNoticed || 0) + 1;
		try { window.plusDiaperExposure(); } catch (e) {}
		try { if (typeof window.plusContRepOnSeen === "function") window.plusContRepOnSeen({ title: title }); } catch (e) {}
		if (window.plusDiaperStressApplies("seen") && Number.isFinite(V.stress)) {
			V.stress = Math.min(Number.isFinite(V.stressmax) ? V.stressmax : 10000, V.stress + NOTICE_STRESS);
			V.plusDiaperSeenStressed = 1;
		}
		const school = window.plusIsSchool(title);
		if (school) window.plusSchoolBullyBump();
		V.plusDiaperSeen = school ? 2 : 1;
		return V.plusDiaperSeen;
	};
	/* Sag tiers (sprites + stage text): 0 <25%, 1 25%, 2 50%, 3 75%, 4 100%, 5 overflowing.
	 * Sprites: img/clothes/under-lower/<variable>/sag<N>/<integrity|penis>.png (tier 0 = the base sprite). */
	window.plusSagTier = function (it) {
		const d = def(it);
		if (!d) return 0;
		if (it.plusOverflow) return 5;
		const f = window.plusDiaperFillFrac(it);
		return f >= 1 - 1e-9 ? 4 : f >= 0.75 ? 3 : f >= 0.5 ? 2 : f >= 0.25 ? 1 : 0;
	};
	window.plusSagSrc = function (src) {
		try {
			const it = window.plusDiaperWorn && window.plusDiaperWorn();
			if (!it || typeof src !== "string") return src;
			const t = window.plusSagTier(it);
			if (t <= 0) return src;
			return src.replace(/^(img\/clothes\/under-lower\/plus[a-z]+)\/((?:full|frayed|torn|tattered|penis)\.png)$/, `$1/sag${t}/$2`);
		} catch (e) {
			return src;
		}
	};
	window.plusSagHook = function () {
		const M = typeof Renderer !== "undefined" && Renderer.CanvasModels && Renderer.CanvasModels.main;
		if (!M || !M.layers || M.plusSagHooked) return !!(M && M.plusSagHooked);
		for (const k of ["under_lower", "under_lower_penis"]) {
			const L = M.layers[k];
			if (!L || typeof L.srcfn !== "function") continue;
			const orig = L.srcfn;
			L.srcfn = function (options) {
				return window.plusSagSrc(orig.call(this, options));
			};
		}
		M.plusSagHooked = true;
		return true;
	};
	const SAG_MSG = {
		[P]: ["Your diaper crinkles a little louder now, the padding starting to dome out.", "Your diaper sags below your crotch, the plastic pulled taut. It crinkles with every step.", "Your diaper hangs low and heavy. You have to waddle to keep walking.", "Your diaper is stretched glassy-tight and swings heavily with each step.", "The tapes are peeling and the seams have given. Your diaper droops, leaking."],
		[C]: ["The cloth of your diaper feels damp and soft against you.", "Your cloth diaper is sodden and sagging, clinging in heavy folds.", "Your soaked cloth diaper hangs low, squishing as you walk.", "Your cloth diaper is dark and dripping-heavy. Every step squelches.", "Your cloth diaper has given up. It sags, leaking through."],
		[U]: ["Your pull-up feels a little thicker between your legs.", "The stretch panels of your pull-up strain as it starts to sag.", "Your pull-up droops low and squishes with every step.", "Your pull-up is completely full, stretched out and heavy.", "Your pull-up sags and leaks. It can't hold any more."],
	};
	const SEEN_MSG = {
		1: ["Someone glances down at the bulge under your clothes, then looks away quickly. Your face burns.", "You catch a passer-by staring at your diaper. They whisper something to their companion.", "A stranger's eyes linger on the obvious padding under your clothes. You feel very self-conscious."],
		2: ["A group of students points at the bulge under your clothes and snickers. 'Is that a diaper?'", "You hear giggling behind you. Someone has noticed your diaper, and word is spreading."],
	};
	window.plusSwellNoticeText = function (it) {
		const d = def(it);
		if (!d) return "";
		window.plusSwellUpdate(it);
		const t = window.plusSagTier(it);
		if (!Number.isFinite(it.plusSagNoted) || it.plusSagNoted > t) it.plusSagNoted = Math.min(t, Number.isFinite(it.plusSagNoted) ? it.plusSagNoted : t);
		if (t <= it.plusSagNoted) return "";
		it.plusSagNoted = t;
		return SAG_MSG[d.cat][t - 1];
	};
	window.plusDiaperSeenText = n => (SEEN_MSG[n] || SEEN_MSG[1]).random();
	$(document).on(":passagestart", function (ev) {
		const V = State.variables;
		try {
			window.plusConcealSetup();
			window.plusSagHook();
			if (!V || V.intro || !V.worn || V.combat === 1) return;
			const it = window.plusDiaperWorn();
			if (it) window.plusSwellUpdate(it);
			const t = ev.passage.title;
			if (V.plusSeenLastPassage !== t || V.plusSeenLastTs !== window.plusNowTs()) {
				V.plusSeenLastPassage = t;
				V.plusSeenLastTs = window.plusNowTs();
				window.plusDiaperNoticeCheck(t);
			}
		} catch (e) {
			console.warn("plusSwell", e);
		}
	});
	$(document).on(":passagerender", function (ev) {
		const V = State.variables;
		if (!V || V.intro || V.combat === 1 || !V.worn) return;
		try {
			const out = [];
			const it = window.plusDiaperWorn();
			if (it) {
				const m = window.plusSwellNoticeText(it);
				if (m) out.push(`<span class="purple">${m}</span>`);
			}
			if (V.plusDiaperSeen) {
				out.push(`<span class="red">${window.plusDiaperSeenText(V.plusDiaperSeen)}</span>${V.plusDiaperSeenStressed ? " You feel stressed." : ""}`);
				delete V.plusDiaperSeen;
				delete V.plusDiaperSeenStressed;
			}
			if (!out.length) return;
			const div = document.createElement("div");
			div.className = "plus-needs-swell";
			$(div).wiki(out.join("<br>") + "<br><br>");
			ev.content.prepend(div);
		} catch (e) {
			console.warn("plusSwellRender", e);
		}
	});
})();
/* Rented flat on Barb Street: winter letting, monthly rent, Bailey pause. */
(function () {
	"use strict";
	const DEPOSIT = 300000; // £3,000 in pence
	const RENT = 150000; // £1,500 in pence
	const REMIND_DAYS = 3;
	const GRACE_DAYS = 3;
	window.plusFlatDeposit = DEPOSIT;
	window.plusFlatRent = RENT;
	window.plusFlatGraceDays = GRACE_DAYS;
	window.plusFlatRemindDays = REMIND_DAYS;

	function V() {
		return State.variables;
	}
	function flat() {
		const vars = V();
		if (!vars.plusFlat || typeof vars.plusFlat !== "object") vars.plusFlat = { rented: false };
		return vars.plusFlat;
	}
	function period(y, m) {
		return (Number(y) || 0) * 12 + (Number(m) || 0);
	}
	function nowPeriod() {
		return period(Time.year, Time.month);
	}
	function daysInMonth(y, m) {
		try {
			return DateTime.getDaysOfMonthFromYear(y)[m - 1];
		} catch (e) {
			return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] || 30;
		}
	}
	function advanceDue(f) {
		f.dueM = (f.dueM || Time.month) + 1;
		if (f.dueM > 12) {
			f.dueM = 1;
			f.dueY = (f.dueY || Time.year) + 1;
		}
	}
	function charge(amount, source) {
		if (typeof money === "function") money(-amount, source);
		else V().money -= amount;
	}
	function spendOk(amount) {
		return (V().money || 0) >= amount;
	}

	window.plusFlatIsWinter = function () {
		try {
			return Time.season === "winter";
		} catch (e) {
			return false;
		}
	};
	window.plusFlatHasDeposit = function () {
		return spendOk(DEPOSIT);
	};
	window.plusFlatRented = function () {
		return !!(flat().rented);
	};
	window.plusFlatCanSign = function () {
		if (flat().rented) return { ok: false, reason: "rented" };
		if (!window.plusFlatIsWinter()) return { ok: false, reason: "winter" };
		if (!window.plusFlatHasDeposit()) return { ok: false, reason: "money" };
		return { ok: true };
	};
	window.plusFlatDueDateText = function () {
		const f = flat();
		if (!f.rented || !f.dueY || !f.dueM) return "";
		const day = daysInMonth(f.dueY, f.dueM);
		try {
			const d = new DateTime(f.dueY, f.dueM, day);
			if (typeof window.getFormattedDate === "function") return window.getFormattedDate(d, false);
			return d.monthName + " " + day;
		} catch (e) {
			return day + " / " + f.dueM;
		}
	};
	window.plusFlatStatusLine = function () {
		const f = flat();
		if (!f.rented) return "";
		const due = window.plusFlatDueDateText();
		if ((f.grace || 0) > 0 || (nowPeriod() > period(f.dueY, f.dueM))) {
			return "Home: Flat (rent £1,500 due " + due + " — overdue)";
		}
		return "Home: Flat (rent £1,500 due " + due + ")";
	};
	window.plusFlatCanPay = function () {
		const f = flat();
		if (!f.rented) return false;
		if (!spendOk(RENT)) return false;
		return nowPeriod() >= period(f.dueY, f.dueM);
	};
	window.plusFlatPayRent = function () {
		const f = flat();
		if (!f.rented) return { ok: false, reason: "rented" };
		if (!spendOk(RENT)) return { ok: false, reason: "money" };
		if (nowPeriod() < period(f.dueY, f.dueM)) return { ok: false, reason: "early" };
		charge(RENT, "plusFlatRent");
		advanceDue(f);
		f.grace = 0;
		f.last = "paid";
		f.msg = "paid";
		return { ok: true };
	};
	window.plusFlatPauseBailey = function () {
		const vars = V();
		if (flat().rented && Number.isFinite(vars.renttime) && vars.renttime < 7) vars.renttime = 7;
	};
	window.plusFlatSign = function () {
		const check = window.plusFlatCanSign();
		if (!check.ok) return check;
		charge(DEPOSIT, "plusFlatDeposit");
		const f = flat();
		f.rented = true;
		f.grace = 0;
		f.dueY = Time.year;
		f.dueM = Time.month;
		try {
			if (Time.date && typeof Time.date.isLastDayOfMonth === "function" && Time.date.isLastDayOfMonth()) advanceDue(f);
		} catch (e) {}
		f.last = "signed";
		f.msg = "signed";
		try {
			f.processDay = window.plusDayKey();
		} catch (e) {}
		const vars = V();
		vars.renttime = 7;
		return { ok: true };
	};
	window.plusFlatMoveOut = function () {
		const f = flat();
		f.rented = false;
		f.grace = 0;
		f.last = "movedout";
		f.msg = "movedout";
		V().renttime = 7;
		return { ok: true };
	};
	window.plusFlatEvict = function () {
		const f = flat();
		f.rented = false;
		f.grace = 0;
		f.last = "evicted";
		f.msg = "evicted";
		V().renttime = 7;
		return { ok: true };
	};
	window.plusFlatTryCollect = function () {
		if (!spendOk(RENT)) return false;
		charge(RENT, "plusFlatRent");
		advanceDue(flat());
		const f = flat();
		f.grace = 0;
		f.last = "collected";
		f.msg = "collected";
		return true;
	};
	window.plusFlatDaily = function () {
		const f = flat();
		if (!f.rented) return f.last || null;
		window.plusFlatPauseBailey();
		const dueP = period(f.dueY, f.dueM);
		const nowP = nowPeriod();
		const lastDay = daysInMonth(Time.year, Time.month);
		const day = Time.monthDay;
		if (nowP < dueP) {
			f.grace = 0;
			return f.last || null;
		}
		if (nowP === dueP) {
			f.grace = 0;
			if (day >= lastDay - REMIND_DAYS && day < lastDay) {
				f.last = "remind";
				f.msg = "remind";
			}
			if (day >= lastDay) {
				if (!window.plusFlatTryCollect()) {
					f.last = "unpaid";
					f.msg = "grace";
				}
			}
			return f.last || null;
		}
		// Past the due month: grace period, then eviction.
		if (window.plusFlatTryCollect()) return f.last;
		f.grace = (f.grace || 0) + 1;
		f.last = "grace";
		f.msg = "grace";
		if (f.grace > GRACE_DAYS) window.plusFlatEvict();
		return f.last;
	};
	window.plusFlatOnTick = function () {
		const f = flat();
		if (!f.rented) return;
		window.plusFlatPauseBailey();
		let day;
		try {
			day = window.plusDayKey();
		} catch (e) {
			return;
		}
		if (f.processDay !== day) {
			f.processDay = day;
			window.plusFlatDaily();
		}
	};
	window.plusFlatClearMsg = function () {
		const f = flat();
		delete f.msg;
	};
})();
