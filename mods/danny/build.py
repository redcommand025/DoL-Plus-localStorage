#!/usr/bin/env python3
"""Build script for the Danny mod.
Patches the compiled DoL+ HTML. Idempotent.
"""
import html, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = os.path.join(ROOT, "Degrees of Lewdity.html")
OUTS = [SRC, os.path.join(ROOT, "index.html")]
M0, M1 = "/*danny*/", "/*/danny*/"

def esc(t):
    return html.escape(t, quote=True).replace("&#x27;", "&#39;")

def mark(code):
    return M0 + code + M1

def strip_marks(t):
    return re.sub(re.escape(M0) + r".*?" + re.escape(M1), "", t, flags=re.S)

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
    s = strip_marks(s)
    s = re.sub(r'<script id="script-module-danny">.*?</script>', "", s, flags=re.S)
    s = re.sub(r'<tw-passagedata[^>]*tags="[^"]*danny[^"]*"[^>]*>.*?</tw-passagedata>', "", s, flags=re.S)

    # Inject dannyroom_link calls after robinroom_link
    s = s.replace(chr(38)+"lt;"+chr(38)+"lt;robinroom_link"+chr(38)+"gt;"+chr(38)+"gt;", chr(38)+"lt;"+chr(38)+"lt;robinroom_link"+chr(38)+"gt;"+chr(38)+"gt;"+chr(38)+"lt;"+chr(38)+"lt;dannyroom_link"+chr(38)+"gt;"+chr(38)+"gt;")

    # Inject registerModLI call after the existing Poppy registration
    anchor = 'registerModLI("Poppy");'
    if anchor in s:
        s = s.replace(anchor, anchor + "\n" + mark('registerModLI("Danny");'), 1)

    # Add Danny to setup.NPCNameList
    npc_list_anchor = 'setup.NPCNameList = ['
    if npc_list_anchor in s:
        # Find the closing of the array and insert before it
        idx = s.find(npc_list_anchor)
        end = s.find("];", idx)
        if end > 0:
            s = s[:end] + ', "Danny"' + s[end:]

    # Add passages
    pid = max(int(x) for x in re.findall(r'<tw-passagedata pid="(\d+)"', s))
    new = ""
    for n, tg, body in parse_tw(os.path.join(HERE, "passages.tw")):
        pid += 1
        new += '<tw-passagedata pid="%d" name="%s" tags="%s" position="0,0" size="100,100">%s</tw-passagedata>' % (pid, esc(n), esc(tg), esc(body))
    i = s.index("</tw-storydata>")
    s = s[:i] + new + s[i:]

    # Inject the small JS module
    js = open(os.path.join(HERE, "danny.js"), encoding="utf-8").read()
    script = '<script id="script-module-danny">%s</script>' % js
    s = s.replace("</body>", script + "\n</body>", 1)

    for o in OUTS:
        open(o, "w", encoding="utf-8").write(s)
    print("built", OUTS)

if __name__ == "__main__":
    main()
