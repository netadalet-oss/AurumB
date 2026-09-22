#!/usr/bin/env python3
"""Verify the five APK-exact assets that must be copied locally."""
from pathlib import Path
import hashlib, sys

EXPECTED = {
 "core.js":"e1c55ed27fb3f905ea5807a33eb9e958acd16061e4d7faeb2c337a5d1b24f325",
 "features.js":"73975ab3184fd93aac5334c9158b175825a06e56bb6320697da8be21a5ba982e",
 "runtime.js":"46a7a9f721c7c66f5acd33f31e9c5fbf50400ee2fd7ab9675e15cb295a17ace2",
 "styles.css":"1c6ff7c946c6d21302cd11f6d0552a32fad7fd3232ceb0c5fe1bdf81d8875bd2",
 "rev20-customization.js":"24e723703af59bf4cb6f831f307b46d208935317d430c4a666c9418abdbd6b5e",
}
root=Path(sys.argv[1] if len(sys.argv)>1 else ".")/"app/src/main/assets"
bad=False
for name,want in EXPECTED.items():
    p=root/name
    if not p.is_file():
        print(f"MISSING {p}"); bad=True; continue
    got=hashlib.sha256(p.read_bytes()).hexdigest()
    ok=got==want
    print(("OK     " if ok else "BAD    ")+f"{name} {got}")
    bad |= not ok
raise SystemExit(1 if bad else 0)
