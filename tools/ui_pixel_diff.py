#!/usr/bin/env python3
"""Strict PNG parity gate for AurumB. Requires real legacy-reference captures."""
import argparse, json, sys
from pathlib import Path
from PIL import Image, ImageChops

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--reference",required=True)
    ap.add_argument("--actual",required=True)
    ap.add_argument("--report",required=True)
    ap.add_argument("--max-different-pixels",type=int,default=0)
    args=ap.parse_args()
    ref=Image.open(args.reference).convert("RGBA")
    actual=Image.open(args.actual).convert("RGBA")
    report={"reference":args.reference,"actual":args.actual,"referenceSize":ref.size,"actualSize":actual.size}
    if ref.size!=actual.size:
        report.update({"passed":False,"reason":"SIZE_MISMATCH"})
    else:
        diff=ImageChops.difference(ref,actual)
        different=sum(1 for px in diff.getdata() if px!=(0,0,0,0))
        report.update({"differentPixels":different,"totalPixels":ref.width*ref.height,
                       "differentRatio":different/(ref.width*ref.height),
                       "passed":different<=args.max_different_pixels})
    Path(args.report).write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps(report,indent=2))
    return 0 if report["passed"] else 1
if __name__=="__main__": sys.exit(main())
