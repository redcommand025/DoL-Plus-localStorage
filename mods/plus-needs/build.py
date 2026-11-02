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
    "Canteen Lunch": (1100, 300), "Asylum Breakfast": (900, 300), "Flats Poppy Eat Meal": (1100, 300),
    "Forest Cabin Food": (800, 200), "Avery Date Cheap": (1000, 400),
    "Whitney Home Dawn Breakfast Toast Eat": (600, 200), "Prison Dinner Kylar": (800, 200),
}
EDITS = [("StoryCaption", "after", "<<tirednesscaption>>", "<<plusneedscaption>>")]
for p in ["Men's Toilets", "Women's Toilets", "School Boy's Toilets", "School Girl's Toilets",
          "Bathroom", "Brothel Bathroom", "Flats Poppy Bathroom"]:
    EDITS.append((p, "before", "<<pregnancyTest", "<<plusToiletLink>>"))
EDITS.append(("Strip Club Bathroom", "before", "<<getouticon>>", "<<plusToiletLink>><br>"))
EDITS.append(("mobileStats", "before", "<<if Number.isFinite($drunk) and $drunk gt 0>>", "<<plusNeedsMobile>>\n\t"))
EDITS.append(("Mansion Bathroom", "append", None, "<br><<plusToiletLink>>"))
for p in ["Kitchen", "Farm Kitchen"]:
    EDITS.append((p, "before", "<<kitchenDisplay>>", "<<plusKitchenSnack>><br>"))
for p, (h, t) in FOOD.items():
    EDITS.append((p, "prepend", None, "<<run plusNeedsConsume(%d, %d)>>" % (h, t)))

JS_PATCHES = [
    ("\tconst multiplier = secondsMapper[type] || 1;\n\tTime.pass(time * multiplier);",
     "\n\twindow.plusNeedsPassTotal = 0;"),
    ("function minutePassed(minutes) {", '\n\tif (typeof window.plusNeedsTick === "function") window.plusNeedsTick(minutes);'),
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
            body = body[:k] + c + body[k:] if mode == "before" else body[:k + len(a)] + c + body[k + len(a):]
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
