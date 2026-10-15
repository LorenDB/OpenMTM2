#!/bin/sh
# Rebuild the git-ignored reverse-engineering workspace in <repo>/re/ from a retail install:
# Ghidra auto-analysis of MONSTER.EXE, a full decompile export, then the derived indexes.
#   MTM2_DIR=~/games/mtm2 tools/re/decompile.sh            (MTM2, into re/)
#   MTM1_DIR=~/games/mtm1 tools/re/decompile.sh mtm1       (MTM1, into re/mtm1/)
#   EVO2_DIR=~/games/evo2 tools/re/decompile.sh evo2       (4x4 Evo 2, into re/evo2/)
#   EVO1_DIR=~/games/evo1 tools/re/decompile.sh evo1       (4x4 Evo 1, into re/evo1/)
# Needs Ghidra (brew install ghidra) and Python 3. Takes a few minutes.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
TARGET=${1:-mtm2}
EXE=MONSTER.EXE
HEADLESS=${GHIDRA_HEADLESS:-$(brew --prefix ghidra 2>/dev/null)/libexec/support/analyzeHeadless}
if [ "$TARGET" = mtm1 ]; then
  GAME_DIR=${MTM1_DIR:-$HOME/games/mtm1}
  WORK="$REPO/re/mtm1"
  # MTM1 is not incrementally linked: a third of its code is only reached through MFC message
  # maps and vtables, which FindFuncs.java turns into functions before the export.
  SCRIPTS="-postScript FindFuncs.java -postScript ExportAll.java"
elif [ "$TARGET" = evo2 ]; then
  # 4x4 Evolution 2 is a Watcom build (AUTO/DGROUP sections, register calling convention).
  GAME_DIR=${EVO2_DIR:-$HOME/games/evo2}
  WORK="$REPO/re/evo2"
  EXE=4x42.exe
  SCRIPTS="-postScript FindFuncs.java -postScript ExportAll.java"
elif [ "$TARGET" = evo1 ]; then
  # 4x4 Evolution (build 57 era, 4x4LE.exe): Watcom, like Evo 2.
  GAME_DIR=${EVO1_DIR:-$HOME/games/evo1}
  WORK="$REPO/re/evo1"
  EXE=4x4LE.exe
  SCRIPTS="-postScript FindFuncs.java -postScript ExportAll.java"
else
  GAME_DIR=${MTM2_DIR:-$HOME/games/mtm2}
  WORK="$REPO/re"
  SCRIPTS="-postScript ExportAll.java"
fi
mkdir -p "$WORK/ghidra" "$WORK/out" "$WORK/notes"
cp "$GAME_DIR/$EXE" "$WORK/ghidra/$EXE"
chmod u+w "$WORK/ghidra/$EXE"
if [ ! -d "$REPO/re/venv" ]; then
  python3 -m venv "$REPO/re/venv"
  "$REPO/re/venv/bin/pip" -q install -r "$HERE/requirements.txt"
fi
if [ -f "$WORK/ghidra/proj.gpr" ]; then
  "$HEADLESS" "$WORK/ghidra" proj -process "$EXE" -noanalysis \
    -scriptPath "$HERE" -postScript ExportAll.java "$WORK/out"
else
  "$HEADLESS" "$WORK/ghidra" proj -import "$WORK/ghidra/$EXE" -max-cpu 8 \
    -scriptPath "$HERE" $SCRIPTS "$WORK/out"
fi
RE_TARGET=$TARGET "$REPO/re/venv/bin/python" "$HERE/postprocess.py"
if [ "$TARGET" = mtm1 ]; then
  RE_TARGET=mtm1 "$REPO/re/venv/bin/python" "$HERE/rsrc.py" "$GAME_DIR/MONSTER.EXE" > "$WORK/out/resources.txt"
  RE_TARGET=mtm1 "$REPO/re/venv/bin/python" "$HERE/msgmap.py" > "$WORK/out/msgmaps.txt"
fi
