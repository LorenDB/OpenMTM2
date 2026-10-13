"""Diff an MTM1 function against its MTM2 counterpart, addresses and variable names blanked.

    python3 tools/re/fdiff.py 44d1e0 470810          (MTM1 address, MTM2 address)
    python3 tools/re/fdiff.py -k 44d1e0 470810       (keep the global addresses, to name them)
"""
import difflib
import os
import re
import sys

from match import REPO, Target

keep = sys.argv[1] == "-k"
a1, a2 = (int(x, 16) for x in sys.argv[2 if keep else 1:][:2])
t1 = Target(os.path.join(REPO, "re", "mtm1", "out"), os.environ.get("MTM1_DIR", "~/games/mtm1") + "/MONSTER.EXE")
t2 = Target(os.path.join(REPO, "re", "out"), os.environ.get("MTM2_DIR", "~/games/mtm2") + "/MONSTER.EXE")


def lines(t, a):
    if keep:
        s = t.text.get(a, "").split("\n", 1)[1]
        s = re.sub(r"\bthunk_", "", s)
        raw = [l.strip() for l in s.splitlines() if l.strip()]
    else:
        raw = t.norm(a)
    out, cur = [], ""
    for l in raw:  # one statement per line, whatever Ghidra's wrapping
        cur = (cur + " " + l).strip()
        if cur.endswith((";", "{", "}", ":")):
            out.append(cur)
            cur = ""
    return out + ([cur] if cur else [])


for l in difflib.unified_diff(lines(t1, a1), lines(t2, a2), "mtm1 %x" % a1, "mtm2 %x" % a2, n=2, lineterm=""):
    print(l)
