#!/bin/sh
# Rebuild the git-ignored reverse-engineering workspace in <repo>/re/ from a retail install:
# Ghidra auto-analysis of MONSTER.EXE, a full decompile export, then the derived indexes.
#   MTM2_DIR=~/games/mtm2 tools/re/decompile.sh            (MTM2, into re/)
#   MTM1_DIR=~/games/mtm1 tools/re/decompile.sh mtm1       (MTM1, into re/mtm1/)
# Needs Ghidra (brew install ghidra) and Python 3. Takes a few minutes.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
TARGET=${1:-mtm2}
HEADLESS=${GHIDRA_HEADLESS:-$(brew --prefix ghidra 2>/dev/null)/libexec/support/analyzeHeadless}
if [ "$TARGET" = mtm1 ]; then
  GAME_DIR=${MTM1_DIR:-$HOME/games/mtm1}
  WORK="$REPO/re/mtm1"
  # MTM1 is not incrementally linked: a third of its code is only reached through MFC message
  # maps and vtables, which FindFuncs.java turns into functions before the export.
  SCRIPTS="-postScript FindFuncs.java -postScript ExportAll.java"
else
  GAME_DIR=${MTM2_DIR:-$HOME/games/mtm2}
  WORK="$REPO/re"
  SCRIPTS="-postScript ExportAll.java"
fi
mkdir -p "$WORK/ghidra" "$WORK/out" "$WORK/notes"
cp "$GAME_DIR/MONSTER.EXE" "$WORK/ghidra/MONSTER.EXE"
chmod u+w "$WORK/ghidra/MONSTER.EXE"
if [ ! -d "$REPO/re/venv" ]; then
  python3 -m venv "$REPO/re/venv"
  "$REPO/re/venv/bin/pip" -q install -r "$HERE/requirements.txt"
fi
if [ -f "$WORK/ghidra/proj.gpr" ]; then
  "$HEADLESS" "$WORK/ghidra" proj -process MONSTER.EXE -noanalysis \
    -scriptPath "$HERE" -postScript ExportAll.java "$WORK/out"
else
  "$HEADLESS" "$WORK/ghidra" proj -import "$WORK/ghidra/MONSTER.EXE" -max-cpu 8 \
    -scriptPath "$HERE" $SCRIPTS "$WORK/out"
fi
RE_TARGET=$TARGET "$REPO/re/venv/bin/python" "$HERE/postprocess.py"
if [ "$TARGET" = mtm1 ]; then
  RE_TARGET=mtm1 "$REPO/re/venv/bin/python" "$HERE/rsrc.py" "$GAME_DIR/MONSTER.EXE" > "$WORK/out/resources.txt"
  RE_TARGET=mtm1 "$REPO/re/venv/bin/python" "$HERE/msgmap.py" > "$WORK/out/msgmaps.txt"
fi
