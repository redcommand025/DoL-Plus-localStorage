#!/usr/bin/env python3
"""Build script for the Plus Needs mod.

The repo ships only the compiled DoL+ HTML (no Twee sources), so this script
patches the compiled file in place. It is idempotent: everything it injects is
wrapped in /*plusneeds*/ ... /*/plusneeds*/ markers, tagged 'plusneeds', or in
<script id="script-module-plus-needs">, and is stripped before re-applying.

Usage: python3 mods/plus-needs/build.py   (writes index.html and 'Degrees of Lewdity.html')
"""
import html, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(ROOT, "Degrees of Lewdity.html")
OUTS = [SRC, os.path.join(ROOT, "index.html")]
M0, M1 = "/*plusneeds*/", "/*/plusneeds*/"

def esc(t):
    return html.escape(t, quote=True).replace("&#x27;", "&#39;")

def mark(code):
    return M0 + code + M1

def strip_marks(t):
    return re.sub(re.escape(M0) + r".*?" + re.escape(M1), "", t, flags=re.S)

# Passage edits: (passage, mode, anchor, code). mode: before|after|prepend|append
FOOD = {  # explicit meals that have no food prop: (hunger, thirst)
    "Asylum Breakfast": (800, 150), "Flats Poppy Eat Meal": (900, 150),
    "Forest Cabin Food": (750, 100), "Avery Date Cheap": (850, 200),
    "Whitney Home Dawn Breakfast Toast Eat": (600, 100), "Prison Dinner Kylar": (750, 100),
}
EDITS = [("StoryCaption", "after", "<<tirednesscaption>>", "<<plusneedscaption>>")]
# Wardrobe: show each diaper's fill next to its name (listed items and the worn one).
EDITS.append(("Widgets Wardrobe", "after", "<<wearlink_norefresh _itemData.name_cap _i>>", "<<print plusDiaperFillLabel(_item)>>"))
# Outfits: keep an already-worn diaper of the outfit's type; otherwise equip the most loaded copy from the wardrobe.
EDITS.append(("Widgets Outfits", "after", '<<widget "wearoutfit">>', "<<run plusOutfitPre()>>"))
EDITS.append(("Widgets Outfits", "before", '\t<<set $wear_outfit to "none">>\n\t<<unset $storeLocation>>\n<</widget>>', "<<run plusOutfitPost()>>"))
EDITS.append(("Widgets Wardrobe", "after", "<<print _wornItemData.name_cap>>", "<<print plusDiaperFillLabel(_wornItem)>>"))
for p in ["Men's Toilets", "Women's Toilets", "School Boy's Toilets", "School Girl's Toilets",
          "Bathroom", "Brothel Bathroom", "Flats Poppy Bathroom"]:
    EDITS.append((p, "before", "<<pregnancyTest", "<<plusToiletLink>>"))
EDITS.append(("Strip Club Bathroom", "before", "<<getouticon>>", "<<plusToiletLink>><br>"))
EDITS.append(("mobileStats", "before", "<<if Number.isFinite($drunk) and $drunk gt 0>>", "<<plusNeedsMobile>>\n\t"))
EDITS.append(("Characteristics", "after", "<<characteristic-box _deviancyConfig>>", "\n\t\t\t<<plusContinenceBox>>"))
EDITS.append(("Statistics", "before", '<<foldout false "_miscFoldout">>', "<<plusNeedsStatistics>>\n\t"))
EDITS.append(("Mansion Bathroom", "append", None, "<br><<plusToiletLink>>"))
# "Incontinent" character-creator background
EDITS.append(("Widgets Settings", "after", "You get a bonus to Tending as your Trauma increases.</span></mouse>\n\t\t\t\t</label>",
              '\n\t\t\t\t<br>\n\t\t\t\t<label><span class="purple">Incontinent</span> <<checkbox "$background.incontinent" false true autocheck>> - You\'ve always struggled to hold it. <span class="green">You start with Leaky continence and wear pull-ups.</span></label>'))
EDITS.append(("Start2", "append", None, "<<run plusIncontinentStart()>>"))
EDITS.append(("Start2", "after", "Welcome to the alpha of Degrees of Lewdity Plus!", "<br><<plusNeedsIntroTip>>"))
EDITS.append(("Widgets modUpdate", "after",
              '<<if $background is "plantlover">>\n\t\t\t<<set _tmp to "plantlover">>\n\t\t<</if>>',
              '\n\t\t<<if $background is "incontinent">>\n\t\t\t<<set _tmp to "incontinent">>\n\t\t<</if>>'))
EDITS.append(("Widgets modUpdate", "after",
              '<<if $background.plantlover is undefined>>\n\t\t<<set $background.plantlover to false>>\n\t<</if>>',
              '\n\n\t<<if $background.incontinent is undefined>>\n\t\t<<set $background.incontinent to false>>\n\t<</if>>'))
EDITS.append(("Pharmacy", "before", "Looking at the items on the shelves, you notice a few objects of interest.", "<<plusDiaperShop>>"))
EDITS.append(("Clothing Shop", "after", '<div id="clothingShop-div" class="main-shop-div">', "<<plusDiaperShop>>"))
EDITS.append(("Characteristics", "before", '<</widget>>\n\n<<widget "heatRutDisplay">>', "\n<<plusDiaperInsecurity>>\n"))
EDITS.append(("Widgets Attitudes", "before", "<<if $attitudesControl.unlockProstitution>>", "<<plusDiaperAttitudes>>"))
EDITS.append(("Widgets Attitudes", "after",
              'V.attitudesControl.unlockExhibitionismUnderwear = V.exhibitionism >= 35;',
              '\n\t\tV.attitudesControl.unlockDiaperSeen = typeof window.plusDiaperUnlockAttitudes === "function" && window.plusDiaperUnlockAttitudes();\n\t\tV.attitudesControl.unlockDiaperUse = V.attitudesControl.unlockDiaperSeen;'))

EDITS.append(("Widgets variablesStart2", "after",
              '<<set _backgroundOptions to ["waif","nerd","athlete","delinquent","promiscuous","exhibitionist","deviant","beautiful","lustful","plantlover"]>>',
              '<<run _backgroundOptions.push("incontinent")>>'))
# Public drinking spots and extra toilets: (passage, anchor, code). Inserted before the anchor.
SPOTS = [
    ("Dance Studio", "<<barbicon>><<link [[Leave|Barb Street]]>><</link>>", '<<plusDrinkLink "cooler">>'),
    ("Dance Studio Changing Room", "<<getouticon>><<link [[Leave|Dance Studio]]>>", "<<plusToiletLink>><br>"),
    ("Wolf Cave Clearing", '<<wolfcaveicon "inside">><<link [[Go inside|Wolf Cave]]>>', '<<plusDrinkLink "stream">><<plusOutdoorToiletLink "wolfcave">><br>'),
    ("Hallways", "<<scienceicon>><<link [[Science classroom (0:01)|Science Classroom]]>>", '<<plusDrinkLink "fountain">>'),
    ("School Library", "<<getouticon>><<link [[Leave the library (0:01)|Hallways]]>>", '<<plusDrinkLink "fountain">>'),
    ("Park", '<<add_link "<br>Alternate routes<br>">>', '<<plusDrinkLink "fountain">><<plusOutdoorToiletLink "park">>'),
    ("Beach", '<<add_link "Travel<br>">>', '<<plusPublicToiletLink "Use the public toilets by the showers">><<plusDrinkLink "fountain">><<plusOutdoorToiletLink "beach">><br>'),
    ("Lake Shore", "<<foresticon>><<link [[Forest (0:10)|Forest]]>>", '<<plusDrinkLink "lake">><<plusOutdoorToiletLink "lake">>'),
    ("Lake Waterfall", "<<foresticon>><<link [[Forest (0:10)|Forest]]>>", '<<plusDrinkLink "lake">><<plusOutdoorToiletLink "lake">>'),
    ("Lake Campsite", "<<foresticon>><<link [[Forest (0:10)|Forest]]>>", '<<plusDrinkLink "lake">><<plusOutdoorToiletLink "lake">>'),
    ("Hospital Foyer", "<<getouticon>><<link [[Go outside (0:01)|Hospital front]]>>", '<<plusDrinkLink "cooler">><<plusToiletLink>><<plusBladderExerciseLink>><br>'),
    ("Shopping Centre", '<<stairsicon "up">><<link [[Go upstairs (0:02)|Shopping Centre Top]]>>', '<<plusDrinkLink "fountain">><<plusToiletLink>><br>'),
    ("Ocean Breeze", "<<clifficon>><<link [[Leave|Cliff Street]]>>", '<<plusDrinkLink "cafe">><<plusToiletLink>><br>'),
]
for p, a, c in SPOTS:
    EDITS.append((p, "before_all" if p == "Shopping Centre" else "before", a, c))
EDITS.append(("Forest", "before_all", "<<forestlessdeep>>", '<<plusOutdoorToiletLink "forest">><br>'))
for _s in ["Science", "Maths", "English", "History", "Swimming"]:
    EDITS.append((_s + " Lesson", "before_all", "<<daydreamicon>><<link [[Daydream|" + _s + " Lesson Daydream]]>>", "<<plusClassAskLinks>>"))
for p in ["Wardrobe", "Changing Room", "School Pool Wardrobe"]:
    EDITS.append((p, "before", '<div id="wardrobewear">', "<<plusClothesLines>><<plusCleanLink>><<plusDiaperChangeLink>><br>"))
EDITS.append(("High Street", "before", '<<if Time.dayState is "day" and $exposed is 0 and $photo', "<<plusLaundromatLink>><<plusPublicToiletLink \"Use the public toilets\">><<plusDrinkLink \"fountain\">>"))
# Sidebar clothing caption: dirt/soiled adjectives next to the integrity word ("a grubby soiled frayed school shirt")
EDITS.append(("Widgets Clothing caption text", "after", "<<set $_wornIntegrity to window.integrityWord($_wornItem,_args[0])>>",
              "<<set $_wornIntegrity to plusDirtWord($_wornItem) + $_wornIntegrity>>"))
# "Find a place to go" (urgent need, public hubs)
for p in ["High Street", "Barb Street", "Connudatus Street", "Domus Street", "Oxford Street", "Nightingale Street", "Wolf Street",
          "Starfish Street", "Cliff Street", "Danube Street", "Mer Street", "Elk Street", "Harvest Street",
          "Commercial Alleyways", "Industrial Alleyways", "Residential Alleyways"]:
    EDITS.append((p, "before", '<<add_link "Travel<br>">>', "<<plusFindPlaceLink>>"))
for p, a in [("Hallways", "<<scienceicon>><<link [[Science classroom (0:01)|Science Classroom]]>>"),
             ("School Front Courtyard", '<<schoolicon "courtyard">><<link [[Rear courtyard (0:02)|School Rear Courtyard]]>>'),
             ("School Rear Courtyard", '<<schoolicon "courtyard">><<link [[Front courtyard (0:02)|School Front Courtyard]]>>'),
             ("Canteen", "<<getouticon>><<link [[Leave the canteen (0:01)|Hallways]]>>"),
             ("School Library", "<<getouticon>><<link [[Leave the library (0:01)|Hallways]]>>")]:
    EDITS.append((p, "before", a, "<<plusFindPlaceLink>>"))
for p in ["Kitchen", "Farm Kitchen"]:
    EDITS.append((p, "before", "<<kitchenDisplay>>", "<<plusKitchenSnack>><br>"))
for p, (h, t) in FOOD.items():
    EDITS.append((p, "prepend", None, "<<run plusNeedsConsume(%d, %d)>>" % (h, t)))

JS_PATCHES = [
    ("\tsetup.moddedClothes.under_lower = [];", '\n\tif (typeof window.plusDiaperItems === "function") setup.moddedClothes.under_lower.push(...window.plusDiaperItems());'),
    ("\tconst multiplier = secondsMapper[type] || 1;\n\tTime.pass(time * multiplier);",
     "\n\twindow.plusNeedsPassTotal = 0;"),
    ("function minutePassed(minutes) {", '\n\tif (typeof window.plusNeedsTick === "function") window.plusNeedsTick(minutes);'),
    ("\tlet result = V[skill];\n\tif (disableStatNerf === 0) {",
     '\n\tif (skill === "seductionskill" && typeof window.plusDirtSeductionMul === "function") result *= window.plusDirtSeductionMul();'),
    ("\t// Allure modifier\n\tallure *= V.settings.allureModifier;",
     '\n\tif (typeof window.plusDirtAllureMul === "function") allure *= window.plusDirtAllureMul();'),
    ("\tif (V.locker_suspicion > 0) statChange.lockerSuspicion(-1);",
     '\n\tif (typeof window.plusDirtBullyDaily === "function") window.plusDirtBullyDaily();'),
    ("function wearProp(prop, colour, accColour) {", '\n\tif (typeof window.plusNeedsProp === "function") window.plusNeedsProp(prop);'),
]

def parse_tw(path):
    out, cur = [], None
    for line in open(path, encoding="utf-8").read().split("\n"):
        m = re.match(r"^:: (.+?)(?: \[(.*?)\])?\s*$", line)
        if m:
            cur = [m.group(1), m.group(2) or "", []]; out.append(cur)
        elif cur is not None:
            cur[2].append(line)
    return [(n, tg, "\n".join(b).strip("\n")) for n, tg, b in out]

def main():
    s = open(SRC, encoding="utf-8").read()
    # 1. JS module
    s = re.sub(r'<script id="script-module-plus-needs".*?</script>\n?', "", s, flags=re.S)
    js = open(os.path.join(HERE, "needs.js"), encoding="utf-8").read()
    assert "</script" not in js
    i = s.index("</head>")
    s = s[:i] + '<script id="script-module-plus-needs" type="text/javascript">\n' + js + "\n</script>\n" + s[i:]
    # 2. JS hooks
    s = strip_marks(s)
    for anchor, code in JS_PATCHES:
        assert s.count(anchor) == 1, anchor
        s = s.replace(anchor, anchor + mark(code), 1)
    # record the total length of the current <<pass>> so a long skip (sleep) can't cause an accident
    a = "\tconst multiplier = secondsMapper[type] || 1;"
    s = s.replace(a, a + mark("\n\twindow.plusNeedsPassTotal = (time * multiplier) / 60;"), 1)
    bg_anchor = '"plantlover"],\n\t\t\t\t\tdisplayName: "Background:"'
    assert s.count(bg_anchor) == 1, bg_anchor
    s = s.replace(bg_anchor, '"plantlover"' + mark(', "incontinent"') + '],\n\t\t\t\t\tdisplayName: "Background:"', 1)
    inc_types = '["penis_small", "penis_big", "breasts_small", "breasts_big", "pregnancy"]'
    assert s.count(inc_types) == 2, inc_types
    s = s.replace(inc_types, '["penis_small", "penis_big", "breasts_small", "breasts_big", "pregnancy"' + mark(', "diaper"') + ']')
    inc_cond = 'pregnancy: playerBellySize() >= 8,\n\t\t\t}[type] && V["acceptance_" + type] < 1000,'
    assert s.count(inc_cond) == 1, inc_cond
    s = s.replace(inc_cond, 'pregnancy: playerBellySize() >= 8,' + mark('\n\t\t\t\tdiaper: typeof window.plusDiaperInsecurityPossible === "function" && window.plusDiaperInsecurityPossible(),') + '\n\t\t\t}[type] && V["acceptance_" + type] < 1000,', 1)

    # House-knock restrooms: after each "Ask for work" option in Domus/Danube/Flats knock passages.
    RESTROOM_HOUSES = (
        ("Domus House Knock", "Domus Street"),
        ("Danube House Knock", "Danube Street"),
        ("Flats Knock", "Flats"),
        ("Flats Knock Intro", "Flats"),
    )
    ask_rx = re.compile(
        r'(&lt;&lt;socialiseicon &quot;ask&quot;&gt;&gt;&lt;&lt;link \[\[Ask for work(?: \([^\]]+\))?\|([^\]]+)\]\]&gt;&gt;(?:&lt;&lt;pass \d+&gt;&gt;)?&lt;&lt;/link&gt;&gt;)'
    )
    for rname, street in RESTROOM_HOUSES:
        rx = re.compile(r'(<tw-passagedata[^>]*name="%s"[^>]*>)(.*?)(</tw-passagedata>)' % re.escape(esc(rname)), re.S)
        m = rx.search(s)
        if not m: sys.exit("passage not found: " + rname)
        body = m.group(2)
        def _repl(mm, street=street):
            dest = html.unescape(mm.group(2))
            return mm.group(1) + esc(mark('\n\t\t<<plusAskRestroomLink "' + street + '" "' + dest + '">>'))
        body2, n = ask_rx.subn(_repl, body)
        if n <= 0: sys.exit("no Ask for work links to hook in " + rname)
        s = s[:m.start(2)] + body2 + s[m.end(2):]

    # 3. remove old mod passages
    s = re.sub(r'<tw-passagedata[^>]*tags="[^"]*plusneeds[^"]*"[^>]*>.*?</tw-passagedata>', "", s, flags=re.S)
    # 4. passage edits
    for name, mode, anchor, code in EDITS:
        rx = re.compile(r'(<tw-passagedata[^>]*name="%s"[^>]*>)(.*?)(</tw-passagedata>)' % re.escape(esc(name)), re.S)
        m = rx.search(s)
        if not m: sys.exit("passage not found: " + name)
        body = m.group(2)
        c = esc(mark(code))
        if mode == "prepend": body = c + body
        elif mode == "append": body = body + c
        else:
            a = esc(anchor); k = body.find(a)
            if k < 0: sys.exit("anchor %r not found in %s" % (anchor, name))
            if mode == "before_all": body = body.replace(a, c + a)
            else: body = body[:k] + c + body[k:] if mode == "before" else body[:k + len(a)] + c + body[k + len(a):]
        s = s[:m.start(2)] + body + s[m.end(2):]
    # 5. new passages
    pid = max(int(x) for x in re.findall(r'<tw-passagedata pid="(\d+)"', s))
    new = ""
    for n, tg, body in parse_tw(os.path.join(HERE, "widgets.tw")):
        pid += 1
        new += '<tw-passagedata pid="%d" name="%s" tags="%s" position="0,0" size="100,100">%s</tw-passagedata>' % (pid, esc(n), esc(tg), esc(body))
    i = s.index("</tw-storydata>")
    s = s[:i] + new + s[i:]
    for o in OUTS:
        open(o, "w", encoding="utf-8").write(s)
    print("built", OUTS)

if __name__ == "__main__":
    main()
