"""Put the payload tools and the repo root on sys.path for the tests."""
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = REPO_ROOT / "payload" / "tools" / "context-notepad"
for path in (TOOLS_DIR, REPO_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))
sys.dont_write_bytecode = True
