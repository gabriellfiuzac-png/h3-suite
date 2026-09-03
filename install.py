"""
Runs automatically when this custom node is installed/updated (ComfyUI
Manager / comfy-cli convention: a top-level install.py at the package root).

Only installs the small, code-only H3 Suite dependencies (the two public
custom-node repos it needs + the bundled proprietary zip + the 'av' pip
package) — never the ~42GB of MiniMax H3 model weights or the optional
SageAttention/Triton speed wheels. Those stay a deliberate, visible,
user-triggered step in the H3 Suite Setup panel inside ComfyUI (see
installer.py / the POST /h3suite/setup/install route) so a fresh
node install never starts a multi-hour silent download.

Best-effort: never raises, so a network hiccup here can't block ComfyUI
from starting. Missing pieces just show up as "missing" in the Setup panel.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import installer

    errors = installer.install_required()
    if errors:
        print("[H3 Suite] install.py: some required dependencies could not be installed automatically:")
        for e in errors:
            print("  -", e)
        print("[H3 Suite] Open the H3 Suite node's Setup panel in ComfyUI to retry.")
    else:
        print("[H3 Suite] install.py: required dependencies OK.")
except Exception as e:
    print(f"[H3 Suite] install.py failed (non-fatal): {e}")
