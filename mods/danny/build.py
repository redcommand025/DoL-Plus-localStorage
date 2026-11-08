#!/usr/bin/env python3
"""Integrate Danny as a standard named NPC (same path as Robin)."""
import html, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(ROOT, "Degrees of Lewdity.html")
OUTS = [SRC, os.path.join(ROOT, "index.html")]

def esc(t):
    return html.escape(t, quote=True).replace("&#x27;", "&#39;")

def parse_tw(path):
    text = open(path, encoding="utf-8").read()
    parts = re.split(r'(?m)^:: ', text)
    out = []
    for p in parts[1:]:
        lines = p.split("\n", 1)
        header = lines[0].strip()
        body = lines[1] if len(lines) > 1 else ""
        m = re.match(r'(.+?)\s*\[([^\]]*)\]\s*$', header)
        if m:
            name, tags = m.group(1).strip(), m.group(2).strip()
        else:
            name, tags = header, ""
        out.append((name, tags, body.strip()))
    return out

def main():
    s = open(SRC, encoding="utf-8").read()
    # Strip previous danny artifacts
    s = re.sub(r'<script id="script-module-danny">.*?</script>', "", s, flags=re.S)
    s = re.sub(r'<tw-passagedata[^>]*tags="[^"]*danny[^"]*"[^>]*>.*?</tw-passagedata>', "", s, flags=re.S)
    s = s.replace("<<dannyroom_link>>", "")

    lt, gt, q = chr(38)+"lt;", chr(38)+"gt;", chr(38)+"quot;"

    # 1. Add to setup.NPCNameList
    marker = "setup.NPCNameList = ["
    idx = s.find(marker)
    if idx > 0:
        end = s.find("]"+gt+gt, idx)
        if end > 0 and "Danny" not in s[idx:end]:
            s = s[:end] + ", " + q + "Danny" + q + s[end:]

    # 2. Extend parallel arrays
    def extend(name, val):
        nonlocal s
        m = lt+lt+"set "+name+" to ["
        i = s.find(m)
        if i < 0: return
        e = s.find("]"+gt+gt, i)
        if e > 0 and val not in s[i:e]:
            s = s[:e] + ", " + q + val + q + s[e:]
    extend("_tit", "dependent")
    extend("_ins", "weak")
    extend("_tpe", "human")
    extend("_swi", "t")

    # 3. loveAlias
    pop = q+"Poppy"+q+": () ="+gt+" "+q+"Love"+q
    if pop in s and "Danny" not in s[s.find(pop):s.find(pop)+300]:
        s = s.replace(pop, pop + ",\n\t\t" + q+"Danny"+q+": () ="+gt+" "+q+"Love"+q, 1)

    # 4. Room link
    s = s.replace(lt+lt+"robinroom_link"+gt+gt, lt+lt+"robinroom_link"+gt+gt+lt+lt+"dannyroom_link"+gt+gt)

    # 5. Passages
    pid = max(int(x) for x in re.findall(r'<tw-passagedata pid="(\d+)"', s))
    new = ""
    for n, tg, body in parse_tw(os.path.join(HERE, "passages.tw")):
        pid += 1
        new += '<tw-passagedata pid="%d" name="%s" tags="%s" position="0,0" size="100,100">%s</tw-passagedata>' % (pid, esc(n), esc(tg), esc(body))
    i = s.index("</tw-storydata>")
    s = s[:i] + new + s[i:]

    # 6. JS module
    js = open(os.path.join(HERE, "danny.js"), encoding="utf-8").read()
    s = s.replace("</body>", '<script id="script-module-danny">%s</script>\n</body>' % js, 1)

    for o in OUTS:
        open(o, "w", encoding="utf-8").write(s)
    print("built")

if __name__ == "__main__":
    main()
