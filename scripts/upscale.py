#!/usr/bin/env python3
"""AI super-resolution upscaling via OpenCV dnn_superres.

Uses real learned SR models (EDSR / ESPCN / FSRCNN) instead of plain
interpolation. Models are downloaded once and cached locally.

Usage:
   python upscale.py INPUT OUTPUT --scale 2|3|4 --model edsr|espcn|fsrcnn --models-dir DIR
"""
import argparse
import os
import sys
import urllib.request

import cv2

# Pre-trained .pb models (TensorFlow) bundled by the OpenCV dnn_superres authors.
MODELS = {
    "edsr": {
        "name": "edsr",
        "url": "https://github.com/Saafke/EDSR_Tensorflow/raw/master/models/EDSR_x{scale}.pb",
        "file": "EDSR_x{scale}.pb",
    },
    "espcn": {
        "name": "espcn",
        "url": "https://github.com/fannymonori/TF-ESPCN/raw/master/export/ESPCN_x{scale}.pb",
        "file": "ESPCN_x{scale}.pb",
    },
    "fsrcnn": {
        "name": "fsrcnn",
        "url": "https://github.com/Saafke/FSRCNN_Tensorflow/raw/master/models/FSRCNN_x{scale}.pb",
        "file": "FSRCNN_x{scale}.pb",
    },
}


def ensure_model(model_key, scale, models_dir):
    spec = MODELS[model_key]
    os.makedirs(models_dir, exist_ok=True)
    file_name = spec["file"].format(scale=scale)
    dest = os.path.join(models_dir, file_name)
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        return dest, spec["name"]
    url = spec["url"].format(scale=scale)
    print(f"downloading {model_key} x{scale} model...", file=sys.stderr)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        f.write(r.read())
    if not os.path.exists(dest) or os.path.getsize(dest) < 1000:
        raise RuntimeError("model download failed")
    return dest, spec["name"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--scale", type=int, choices=[2, 3, 4], default=2)
    parser.add_argument("--model", choices=list(MODELS), default="edsr")
    parser.add_argument("--models-dir", default=os.path.join(os.path.dirname(__file__), "..", "data", "sr-models"))
    args = parser.parse_args()

    image = cv2.imread(args.input, cv2.IMREAD_COLOR)
    if image is None:
        print("ERROR: cannot read input image", file=sys.stderr)
        sys.exit(2)

    model_path, model_name = ensure_model(args.model, args.scale, args.models_dir)

    sr = cv2.dnn_superres.DnnSuperResImpl_create()
    sr.readModel(model_path)
    sr.setModel(model_name, args.scale)
    result = sr.upsample(image)

    # EDSR/ESPCN output BGR; write as PNG to preserve quality.
    if not cv2.imwrite(args.output, result):
        print("ERROR: cannot write output image", file=sys.stderr)
        sys.exit(3)
    print(f"upscaled model={model_name} x{args.scale} -> {result.shape[1]}x{result.shape[0]}")


if __name__ == "__main__":
    main()
