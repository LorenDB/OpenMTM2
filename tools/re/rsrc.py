"""Dump the dialogs, menus, string tables and resource inventory of an executable.

    python3 tools/re/rsrc.py path/to/MONSTER.EXE > re/<target>/out/resources.txt
"""
import struct
import sys

import pefile

TYPES = {1: "CURSOR", 2: "BITMAP", 3: "ICON", 4: "MENU", 5: "DIALOG", 6: "STRING", 9: "ACCELERATOR",
         10: "RCDATA", 12: "GROUP_CURSOR", 14: "GROUP_ICON", 16: "VERSION", 240: "DLGINIT", 241: "TOOLBAR"}
CLASSES = {0x80: "Button", 0x81: "Edit", 0x82: "Static", 0x83: "ListBox", 0x84: "ScrollBar", 0x85: "ComboBox"}


def wstr(b, o):
    """A UTF-16 string or an 0xFFFF ordinal at o; returns (value, next offset)."""
    if struct.unpack_from("<H", b, o)[0] == 0xFFFF:
        return "#%d" % struct.unpack_from("<H", b, o + 2)[0], o + 4
    e = o
    while b[e:e + 2] != b"\0\0":
        e += 2
    return b[o:e].decode("utf-16le", "replace"), e + 2


def dialog(b):
    ex = struct.unpack_from("<HH", b, 0) == (1, 0xFFFF)
    if ex:
        _help, _ex, style, n, x, y, cx, cy = struct.unpack_from("<IIIHhhhh", b, 4)
        o = 26
    else:
        style, _ex, n, x, y, cx, cy = struct.unpack_from("<IIHhhhh", b, 0)
        o = 18
    menu, o = wstr(b, o)
    cls, o = wstr(b, o)
    title, o = wstr(b, o)
    out = [f'  title="{title}" style={style:08x} pos={x},{y} size={cx}x{cy} menu="{menu}" class="{cls}" controls={n}']
    if style & 0x40:
        size = struct.unpack_from("<H", b, o)[0]
        face, o = wstr(b, o + (6 if ex else 2))
        out[0] += f' font="{face}" {size}pt'
    for _ in range(n):
        o = (o + 3) & ~3
        if ex:
            _help, _cex, cstyle, x, y, cx, cy, cid = struct.unpack_from("<IIIhhhhI", b, o)
            o += 24
        else:
            cstyle, _cex, x, y, cx, cy, cid = struct.unpack_from("<IIhhhhH", b, o)
            o += 18
        if struct.unpack_from("<H", b, o)[0] == 0xFFFF:
            c = struct.unpack_from("<H", b, o + 2)[0]
            cls, o = CLASSES.get(c, "#%x" % c), o + 4
        else:
            cls, o = wstr(b, o)
        text, o = wstr(b, o)
        extra = struct.unpack_from("<H", b, o)[0]
        o += 2 + extra
        out.append(f'    id={cid:<6} {cls:<10} style={cstyle:08x} {x},{y} {cx}x{cy} "{text}"')
    return out


def menu(b):
    out, o, depth = [], 4, 0
    stack = []
    while o < len(b):
        flags = struct.unpack_from("<H", b, o)[0]
        o += 2
        mid = None
        if not flags & 0x10:
            mid = struct.unpack_from("<H", b, o)[0]
            o += 2
        text, o = wstr(b, o)
        grey = " (GRAYED)" if flags & 1 else ""
        out.append("    " + "  " * depth + (f'POPUP "{text}"' if flags & 0x10 else f'id={mid} "{text}"') + grey)
        if flags & 0x10:
            stack.append(flags & 0x80)
            depth += 1
        elif flags & 0x80:
            while stack:
                depth -= 1
                if not stack.pop():
                    break
            else:
                break
    return out


def main(path):
    pe = pefile.PE(path)
    counts = {}
    for t in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        tname = TYPES.get(t.id, str(t.name) if t.name else str(t.id))
        for e in t.directory.entries:
            ename = str(e.name) if e.name else str(e.id)
            for lang in e.directory.entries:
                d = lang.data.struct
                b = pe.get_data(d.OffsetToData, d.Size)
                counts.setdefault(tname, []).append((ename, d.Size))
                if t.id == 5:
                    print(f"DIALOG {ename}")
                    try:
                        print("\n".join(dialog(b)))
                    except Exception as ex:
                        print("   (parse failed: %s)" % ex)
                elif t.id == 4:
                    print(f"MENU {ename}")
                    print("\n".join(menu(b)))
                elif t.id == 9:
                    print(f"ACCELERATOR {ename}")
                    for i in range(0, len(b), 8):
                        fl, key, cmd, _ = struct.unpack_from("<HHHH", b, i)
                        mods = "".join(n for bit, n in ((8, "Ctrl+"), (16, "Alt+"), (4, "Shift+")) if fl & bit)
                        if fl & 1 and 0x70 <= key <= 0x7B:
                            k = "F%d" % (key - 0x6F)
                        else:
                            k = chr(key) if 32 < key < 127 else "VK_%02x" % key
                        print(f"    {mods}{k} -> id={cmd}" + (" (virtkey)" if fl & 1 else ""))
                elif t.id == 6:
                    o = 0
                    for i in range(16):
                        n = struct.unpack_from("<H", b, o)[0]
                        o += 2
                        if n:
                            s = b[o:o + 2 * n].decode("utf-16le", "replace").replace("\n", "\\n")
                            print(f"STRING {(e.id - 1) * 16 + i}\t{s}")
                        o += 2 * n
    print("\nINVENTORY")
    for t, items in counts.items():
        print(f"  {t}: {len(items)} entries, {sum(s for _, s in items)} bytes: " +
              " ".join(n for n, _ in items[:400]))


if __name__ == "__main__":
    main(sys.argv[1])
