#!/usr/bin/env python3
"""Downloads lame.min.js to static/lib/ if not already present."""
from pathlib import Path
import urllib.request

dest = Path(__file__).parent / "static" / "lib" / "lame.min.js"
if dest.exists():
    print(f"lame.min.js already present at {dest}")
else:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print("Downloading lame.min.js...")
    urllib.request.urlretrieve(
        "https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js",
        dest,
    )
    print(f"Saved to {dest}")
