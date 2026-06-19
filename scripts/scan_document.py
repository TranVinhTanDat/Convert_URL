#!/usr/bin/env python3
"""CamScanner-style document scanner.

Pipeline:
1. Detect the document's 4 corners (largest quadrilateral contour) and apply a
   perspective warp to get a flat top-down view. Falls back to the whole frame
   if no clear document boundary is found.
2. Auto-deskew: correct small residual rotation using the dominant text angle.
3. Output mode:
   - color : white-balanced + CLAHE contrast, keeps colors (photos, IDs)
   - gray  : grayscale + local contrast
   - bw    : adaptive threshold → clean black-on-white scan (text documents)

Usage:
   python scan_document.py INPUT OUTPUT --mode bw|gray|color [--no-crop]
"""
import argparse
import sys

import cv2
import numpy as np


def order_points(pts):
    """Order 4 points as top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]      # top-left  = smallest x+y
    rect[2] = pts[np.argmax(s)]      # bottom-right = largest x+y
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]   # top-right = smallest y-x
    rect[3] = pts[np.argmax(diff)]   # bottom-left = largest y-x
    return rect


def find_document_contour(image):
    """Return ordered 4 corners of the document, or None if not confidently found."""
    h, w = image.shape[:2]
    ratio = 1000.0 / max(h, w)
    small = cv2.resize(image, (int(w * ratio), int(h * ratio)))

    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(gray, 60, 180)
    edged = cv2.dilate(edged, np.ones((3, 3), np.uint8), iterations=2)

    contours, _ = cv2.findContours(edged, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
    frame_area = small.shape[0] * small.shape[1]

    for c in contours:
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            area = cv2.contourArea(approx)
            # Document must cover a meaningful part of the frame, but not be the
            # whole frame (that just means no border was detected).
            if 0.20 * frame_area < area < 0.98 * frame_area:
                return order_points(approx.reshape(4, 2) / ratio)
    return None


def four_point_warp(image, rect):
    (tl, tr, br, bl) = rect
    width = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    height = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    width = max(width, 1)
    height = max(height, 1)
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
                   dtype="float32")
    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(image, M, (width, height))


def deskew(image):
    """Correct small rotation using the dominant text/edge angle."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    if len(coords) < 50:
        return image
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = 90 + angle
    if abs(angle) < 0.5 or abs(angle) > 20:
        return image  # ignore tiny noise or absurd angles
    h, w = image.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(image, M, (w, h), flags=cv2.INTER_CUBIC,
                          borderMode=cv2.BORDER_REPLICATE)


def white_balance(image):
    """Gray-world white balance to neutralize lighting tint."""
    result = image.astype(np.float32)
    avg = result.reshape(-1, 3).mean(axis=0)
    gray = avg.mean()
    for i in range(3):
        if avg[i] > 1:
            result[:, :, i] *= gray / avg[i]
    return np.clip(result, 0, 255).astype(np.uint8)


def enhance_color(image):
    img = white_balance(image)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l = clahe.apply(l)
    return cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)


def to_gray_scan(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
    return clahe.apply(gray)


def to_bw_scan(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 9, 50, 50)
    bw = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                               cv2.THRESH_BINARY, 21, 12)
    # Remove salt-and-pepper noise
    bw = cv2.medianBlur(bw, 3)
    return bw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--mode", choices=["color", "gray", "bw"], default="bw")
    parser.add_argument("--no-crop", action="store_true",
                        help="Skip document boundary detection / perspective warp")
    args = parser.parse_args()

    image = cv2.imread(args.input, cv2.IMREAD_COLOR)
    if image is None:
        print("ERROR: cannot read input image", file=sys.stderr)
        sys.exit(2)

    warped = image
    cropped = False
    if not args.no_crop:
        rect = find_document_contour(image)
        if rect is not None:
            warped = four_point_warp(image, rect)
            cropped = True

    warped = deskew(warped)

    if args.mode == "bw":
        out = to_bw_scan(warped)
    elif args.mode == "gray":
        out = to_gray_scan(warped)
    else:
        out = enhance_color(warped)

    if not cv2.imwrite(args.output, out):
        print("ERROR: cannot write output image", file=sys.stderr)
        sys.exit(3)
    print(f"scan ok mode={args.mode} cropped={cropped} size={out.shape[1]}x{out.shape[0]}")


if __name__ == "__main__":
    main()
