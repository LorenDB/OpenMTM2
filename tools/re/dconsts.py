"""Compare the initialised .data values (tunable globals) used by paired MTM1 and MTM2 functions.

Reads the pairing written by match.py and, for every pair, lists the initialised globals each
side touches with their start-up value read as a float (or an integer when that is no float).
Pairs whose value lists differ are printed; -a prints every pair.

    python3 tools/re/dconsts.py re/mtm1/out/match_sim.tsv [-a]
"""
import os
import struct
import sys

import capstone

from match import BASE, REPO, Target


def data_range(t):
    for s in t.pe.sections:
        if s.Name.startswith(b".data"):
            return BASE + s.VirtualAddress, BASE + s.VirtualAddress + s.SizeOfRawData
    raise KeyError


def globals_of(t, rng, start, size):
    out = {}
    code = t.img[start - BASE:start - BASE + size]
    for ins in t.md.disasm(code, start):
        for op in ins.operands:
            if op.type == capstone.x86.X86_OP_MEM and op.mem.base == 0 and op.mem.index == 0 \
                    and rng[0] <= op.mem.disp < rng[1] and op.mem.disp not in out:
                o = op.mem.disp - BASE
                if op.size == 8:
                    v = "%.6g" % struct.unpack("<d", t.img[o:o + 8])[0]
                else:
                    raw = struct.unpack("<I", t.img[o:o + 4])[0]
                    f = struct.unpack("<f", t.img[o:o + 4])[0]
                    v = "%.6g" % f if raw == 0 or 1e-6 < abs(f) < 1e9 else "i%d" % struct.unpack("<i", t.img[o:o + 4])[0]
                out[op.mem.disp] = v
    return out


def main(path, show_all):
    t1 = Target(os.path.join(REPO, "re", "mtm1", "out"), os.environ.get("MTM1_DIR", "~/games/mtm1") + "/MONSTER.EXE")
    t2 = Target(os.path.join(REPO, "re", "out"), os.environ.get("MTM2_DIR", "~/games/mtm2") + "/MONSTER.EXE")
    r1, r2 = data_range(t1), data_range(t2)
    size1 = {a: s for a, _n, s in t1.funcs}
    size2 = {a: s for a, _n, s in t2.funcs}
    for line in open(path).read().splitlines()[1:]:
        a, _s1, b, _s2 = line.split("\t")[:4]
        if a == "-" or b == "-":
            continue
        a, b = int(a, 16), int(b, 16)
        g1, g2 = globals_of(t1, r1, a, size1[a]), globals_of(t2, r2, b, size2[b])
        v1, v2 = sorted(g1.values()), sorted(g2.values())
        if v1 != v2 or show_all:
            only1 = [f"{k:x}={v}" for k, v in g1.items() if v1.count(v) != v2.count(v)]
            only2 = [f"{k:x}={v}" for k, v in g2.items() if v1.count(v) != v2.count(v)]
            print(f"{a:x} / {b:x}\n   mtm1: " + " ".join(only1 if not show_all else [f"{k:x}={v}" for k, v in g1.items()])
                  + "\n   mtm2: " + " ".join(only2 if not show_all else [f"{k:x}={v}" for k, v in g2.items()]))


if __name__ == "__main__":
    main(sys.argv[1], "-a" in sys.argv)
