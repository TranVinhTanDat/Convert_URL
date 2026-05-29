#!/usr/bin/env python3
"""Instance segmentation for Samsung-style object removal.

Detects ALL objects (people, bikes, cars, etc.) using YOLOv8-seg, identifies the
MAIN subject (largest + most central), and classifies the rest as "secondary"
(distracting objects you'd typically want to remove).

Usage:
    python3 detect_objects.py <image> <mask_output_dir> [--conf 0.35]

Outputs JSON to stdout:
{
  "width": W, "height": H,
  "objects": [
    {"id": 0, "label": "person", "confidence": 0.92, "bbox": [x,y,w,h],
     "area_pct": 12.3, "is_main": true, "mask_file": "obj_0.png", "cx": .., "cy": ..},
    ...
  ],
  "secondary_mask_file": "secondary_combined.png"  # all non-main objects merged
}

Each object's mask PNG (white = object) is written to mask_output_dir.
"""
import sys
import os
import json
import argparse

try:
    import cv2
    import numpy as np
except ImportError as e:
    print(json.dumps({"error": f"opencv/numpy missing: {e}"}))
    sys.exit(2)


# COCO classes that make sense to remove as "distracting objects"
REMOVABLE_CLASSES = {
    "person", "bicycle", "car", "motorcycle", "bus", "truck", "boat",
    "bird", "cat", "dog", "horse", "backpack", "umbrella", "handbag",
    "suitcase", "skateboard", "bottle", "cup", "chair", "potted plant",
    "traffic light", "fire hydrant", "stop sign", "bench", "train"
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("image")
    parser.add_argument("mask_dir")
    parser.add_argument("--conf", type=float, default=0.35)
    parser.add_argument("--model", default="yolov8x-seg.pt", help="YOLOv8-seg model")
    args = parser.parse_args()

    try:
        from ultralytics import YOLO
    except ImportError:
        print(json.dumps({"error": "ultralytics not installed. pip install ultralytics"}))
        return 2

    img = cv2.imread(args.image, cv2.IMREAD_COLOR)
    if img is None:
        print(json.dumps({"error": f"cannot read {args.image}"}))
        return 1
    H, W = img.shape[:2]
    os.makedirs(args.mask_dir, exist_ok=True)

    # Load model (downloads on first run). Use smaller model if x not available.
    model = None
    for model_name in [args.model, "yolov8l-seg.pt", "yolov8m-seg.pt", "yolov8n-seg.pt"]:
        try:
            model = YOLO(model_name)
            break
        except Exception as e:
            print(f"WARN: failed to load {model_name}: {e}", file=sys.stderr)
            continue
    if model is None:
        print(json.dumps({"error": "could not load any YOLOv8-seg model"}))
        return 1

    # Run inference
    results = model.predict(img, conf=args.conf, retina_masks=True, verbose=False)
    if not results or results[0].masks is None:
        print(json.dumps({"width": W, "height": H, "objects": [], "secondary_mask_file": None}))
        return 0

    res = results[0]
    names = res.names
    masks = res.masks.data.cpu().numpy()   # (N, h, w) float 0..1
    boxes = res.boxes.xyxy.cpu().numpy()    # (N, 4)
    confs = res.boxes.conf.cpu().numpy()
    classes = res.boxes.cls.cpu().numpy().astype(int)

    img_cx, img_cy = W / 2.0, H / 2.0
    img_area = float(W * H)

    objects = []
    for i in range(len(masks)):
        label = names.get(classes[i], str(classes[i])) if isinstance(names, dict) else names[classes[i]]
        if label not in REMOVABLE_CLASSES:
            continue
        m = masks[i]
        # Resize mask to full image size
        if m.shape[:2] != (H, W):
            m = cv2.resize(m, (W, H), interpolation=cv2.INTER_NEAREST)
        m_bin = (m > 0.5).astype(np.uint8) * 255
        area = float((m_bin > 127).sum())
        if area < img_area * 0.0005:  # skip tiny detections (<0.05%)
            continue
        x1, y1, x2, y2 = boxes[i]
        bw, bh = x2 - x1, y2 - y1
        cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
        # "Main subject" score: large area + central position
        area_score = area / img_area
        center_dist = ((cx - img_cx) ** 2 + (cy - img_cy) ** 2) ** 0.5 / ((W ** 2 + H ** 2) ** 0.5)
        main_score = area_score * 2.0 - center_dist  # bigger + more central = higher
        objects.append({
            "idx": i,
            "label": label,
            "confidence": round(float(confs[i]), 3),
            "bbox": [int(x1), int(y1), int(bw), int(bh)],
            "area": area,
            "area_pct": round(area_score * 100, 2),
            "cx": round(cx / W, 4),
            "cy": round(cy / H, 4),
            "main_score": main_score,
            "mask": m_bin
        })

    if not objects:
        print(json.dumps({"width": W, "height": H, "objects": [], "secondary_mask_file": None}))
        return 0

    # Identify MAIN subject = highest main_score among persons (prefer person as main)
    persons = [o for o in objects if o["label"] == "person"]
    pool = persons if persons else objects
    main_obj = max(pool, key=lambda o: o["main_score"])
    main_idx = main_obj["idx"]

    # Sometimes a couple/group = main. Mark objects close to + overlapping main bbox as main too.
    # (heuristic: persons with area >= 60% of main's area AND near center)
    main_area = main_obj["area"]
    for o in objects:
        o["is_main"] = (o["idx"] == main_idx)
    # Group main: include large central persons
    for o in persons:
        if o["idx"] == main_idx:
            continue
        if o["area"] >= main_area * 0.5 and o["cy"] >= 0.35:  # similar size, lower half (foreground)
            o["is_main"] = True

    # Write individual masks + build secondary combined mask
    secondary_combined = np.zeros((H, W), dtype=np.uint8)
    out_objects = []
    for n, o in enumerate(objects):
        mask_file = f"obj_{n}.png"
        cv2.imwrite(os.path.join(args.mask_dir, mask_file), o["mask"])
        if not o["is_main"]:
            secondary_combined = cv2.bitwise_or(secondary_combined, o["mask"])
        out_objects.append({
            "id": n,
            "label": o["label"],
            "confidence": o["confidence"],
            "bbox": o["bbox"],
            "area_pct": o["area_pct"],
            "cx": o["cx"],
            "cy": o["cy"],
            "is_main": o["is_main"],
            "mask_file": mask_file
        })

    secondary_file = None
    if secondary_combined.sum() > 0:
        secondary_file = "secondary_combined.png"
        cv2.imwrite(os.path.join(args.mask_dir, secondary_file), secondary_combined)

    print(json.dumps({
        "width": W,
        "height": H,
        "objects": out_objects,
        "secondary_mask_file": secondary_file,
        "main_count": sum(1 for o in out_objects if o["is_main"]),
        "secondary_count": sum(1 for o in out_objects if not o["is_main"])
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
