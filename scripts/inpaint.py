#!/usr/bin/env python3
"""Samsung-AI-tier object removal.

Two hard guarantees:
1. BACKGROUND PRESERVED — every pixel outside the mask is byte-identical to the
   original. We composite ONLY the masked region back into a copy of the original.
2. SHARP NATURAL FILL — the object region is inpainted at NATIVE resolution (no
   whole-image downscale) using LaMa, then detail/contrast-matched to surroundings.

Why background changed before: iopaint RESIZE strategy downscaled the WHOLE image to
1536 then upscaled — softening everything. Fix: use CROP strategy (process only a crop
around the mask at native res) and composite tightly.

Pipeline:
1. Crop a region around the mask (with margin) at native resolution
2. Inpaint that crop with LaMa
3. Detail + contrast match the filled area to its surroundings
4. Paste the filled crop back into a copy of the ORIGINAL
5. Feather only a 3px boundary; everything else stays original
"""
import sys
import argparse
import time

import cv2
import numpy as np


_model_cache = {}


# ============================================================================
# Engine runners
# ============================================================================

def _iopaint(model_name, img_bgr, binmask, ldm_steps=35):
    """Run iopaint at native resolution (ORIGINAL strategy — we already crop ourselves)."""
    try:
        from iopaint.model_manager import ModelManager
        from iopaint.schema import InpaintRequest, HDStrategy, LDMSampler
    except ImportError:
        return None
    try:
        if model_name not in _model_cache:
            _model_cache[model_name] = ModelManager(name=model_name, device="cpu")
        model = _model_cache[model_name]
        rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

        # We crop ourselves, so the input here is already small → process at ORIGINAL res.
        # Only fall back to RESIZE for genuinely huge crops to avoid OOM.
        long_side = max(img_bgr.shape[:2])
        hd = HDStrategy.ORIGINAL if long_side <= 2048 else HDStrategy.RESIZE
        cfg = {
            "hd_strategy": hd,
            "hd_strategy_crop_margin": 128,
            "hd_strategy_crop_trigger_size": 99999,
            "hd_strategy_resize_limit": 2048,
        }
        if model_name == "ldm":
            cfg["ldm_steps"] = ldm_steps
            cfg["ldm_sampler"] = LDMSampler.k_lms
        result_rgb = model(rgb, binmask, InpaintRequest(**cfg))
        return cv2.cvtColor(result_rgb.astype(np.uint8), cv2.COLOR_RGB2BGR)
    except Exception as e:
        print(f"WARN: iopaint {model_name} failed: {e}", file=sys.stderr)
        return None


def _simple_lama(img_bgr, binmask):
    try:
        from simple_lama_inpainting import SimpleLama
        from PIL import Image
    except ImportError:
        return None
    try:
        rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        if "simple_lama" not in _model_cache:
            _model_cache["simple_lama"] = SimpleLama()
        out = _model_cache["simple_lama"](Image.fromarray(rgb), Image.fromarray(binmask))
        return cv2.cvtColor(np.array(out), cv2.COLOR_RGB2BGR)
    except Exception as e:
        print(f"WARN: simple-lama failed: {e}", file=sys.stderr)
        return None


def _cv2_inpaint(img_bgr, binmask, method="telea"):
    h, w = img_bgr.shape[:2]
    flag = cv2.INPAINT_NS if method == "ns" else cv2.INPAINT_TELEA
    r = max(5, int(min(h, w) * 0.02))
    return cv2.inpaint(img_bgr, binmask, r, flag)


def _xphoto_shiftmap(img_bgr, binmask):
    """Patch-based content-aware fill (cv2.xphoto SHIFTMAP) — như Photoshop Content-Aware.

    Copy các patch THẬT từ surrounding → texture lặp lại (gạch/cobblestone/cỏ) sắc nét,
    không bị smear như LaMa. Chỉ có khi cài opencv-contrib-python.
    """
    try:
        import cv2.xphoto  # noqa
        if not hasattr(cv2.xphoto, "inpaint"):
            return None
    except Exception:
        return None
    try:
        # xphoto SHIFTMAP cần mask 1-channel uint8 (255 = inpaint). Giới hạn kích thước
        # để tránh quá chậm: nếu crop > 1400px cạnh dài, downscale → fill → upscale.
        h, w = img_bgr.shape[:2]
        long_side = max(h, w)
        scale = 1.0
        work_img, work_mask = img_bgr, binmask
        if long_side > 1400:
            scale = 1400.0 / long_side
            work_img = cv2.resize(img_bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
            work_mask = cv2.resize(binmask, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_NEAREST)
        dst = np.zeros_like(work_img)
        cv2.xphoto.inpaint(work_img, work_mask, dst, cv2.xphoto.INPAINT_SHIFTMAP)
        if scale != 1.0:
            dst = cv2.resize(dst, (w, h), interpolation=cv2.INTER_LANCZOS4)
        return dst
    except Exception as e:
        print(f"WARN: xphoto SHIFTMAP failed: {e}", file=sys.stderr)
        return None


def _candidate_quality_score(original, candidate, binmask, ring_size=28):
    """Lower is better. Score only the masked region against nearby background statistics."""
    ring = _ring_of(binmask, ring_size)
    rb = ring > 127
    ib = binmask > 127
    if not rb.any() or not ib.any():
        return 1e9

    lab_o = cv2.cvtColor(original, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab_c = cv2.cvtColor(candidate, cv2.COLOR_BGR2LAB).astype(np.float32)
    gray_o = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gray_c = cv2.cvtColor(candidate, cv2.COLOR_BGR2GRAY).astype(np.float32)

    ring_mean = lab_o[rb].mean(axis=0)
    fill_mean = lab_c[ib].mean(axis=0)
    ring_std = np.maximum(lab_o[rb].std(axis=0), 1.0)
    fill_std = np.maximum(lab_c[ib].std(axis=0), 1.0)
    color_penalty = float(np.linalg.norm(ring_mean - fill_mean))
    contrast_penalty = float(np.linalg.norm(ring_std - fill_std))

    lap_o = cv2.Laplacian(gray_o, cv2.CV_32F)
    lap_c = cv2.Laplacian(gray_c, cv2.CV_32F)
    edge_penalty = abs(float(lap_o[rb].var()) - float(lap_c[ib].var())) * 0.03
    return color_penalty + contrast_penalty * 0.65 + edge_penalty


def _best_cv2_inpaint(img_bgr, binmask):
    """Run both OpenCV engines and keep the one that best matches surrounding pixels."""
    candidates = [
        ("cv2-telea", _cv2_inpaint(img_bgr, binmask, method="telea")),
        ("cv2-ns", _cv2_inpaint(img_bgr, binmask, method="ns")),
    ]
    scored = [(name, out, _candidate_quality_score(img_bgr, out, binmask)) for name, out in candidates]
    name, out, score = min(scored, key=lambda item: item[2])
    print(f"[inpaint] cv2 quality pick: {name} score={score:.2f}", file=sys.stderr)
    return out, name


def inpaint_engine(engine, img_bgr, binmask, ldm_steps=35, context=None):
    """Returns (result_bgr, engine_name).

    'auto' routing thông minh:
      - Nền phẳng/gradient (uniform) → Navier-Stokes (sạch, không hallucinate).
      - Nền texture → chạy CẢ LaMa + SHIFTMAP, chấm điểm match surrounding, lấy bản tốt hơn.
        (SHIFTMAP copy patch thật → sắc cho cobblestone/gạch; LaMa giỏi nền có cấu trúc.)
    """
    if engine == "patch":
        r = _xphoto_shiftmap(img_bgr, binmask)
        if r is not None:
            return r, "xphoto-SHIFTMAP"
        r = _iopaint("lama", img_bgr, binmask)
        if r is not None:
            return r, "iopaint-LaMa(patch-fallback)"

    if engine == "ldm":
        r = _iopaint("ldm", img_bgr, binmask, ldm_steps=ldm_steps)
        if r is not None:
            return r, f"iopaint-LDM({ldm_steps})"
        r = _iopaint("lama", img_bgr, binmask)
        if r is not None:
            return r, "iopaint-LaMa(ldm-fallback)"

    if engine == "lama":
        r = _iopaint("lama", img_bgr, binmask)
        if r is not None:
            return r, "iopaint-LaMa"
        r = _simple_lama(img_bgr, binmask)
        if r is not None:
            return r, "simple-lama"

    if engine == "auto":
        uniform = bool(context and context.get("uniform"))
        if uniform:
            return _best_cv2_inpaint(img_bgr, binmask)
        # Textured: best of LaMa vs SHIFTMAP by surrounding-match score
        candidates = []
        lama = _iopaint("lama", img_bgr, binmask) or _simple_lama(img_bgr, binmask)
        if lama is not None:
            candidates.append(("iopaint-LaMa", lama))
        shift = _xphoto_shiftmap(img_bgr, binmask)
        if shift is not None:
            candidates.append(("xphoto-SHIFTMAP", shift))
        if candidates:
            scored = [(n, im, _candidate_quality_score(img_bgr, im, binmask)) for n, im in candidates]
            n, im, _ = min(scored, key=lambda x: x[2])
            others = ", ".join(f"{nn}={ss:.1f}" for nn, _, ss in scored)
            print(f"[inpaint] auto pick: {n} (scores: {others})", file=sys.stderr)
            return im, n
        return _best_cv2_inpaint(img_bgr, binmask)

    # explicit telea/ns
    method = "ns" if engine == "ns" else "telea"
    return _cv2_inpaint(img_bgr, binmask, method=method), f"cv2-{method}"


# ============================================================================
# Crop-around-mask helpers (keep background untouched + native-res fill)
# ============================================================================

def mask_bbox(binmask, margin, shape):
    ys, xs = np.where(binmask > 127)
    if len(ys) == 0:
        return None
    h, w = shape[:2]
    y0 = max(0, ys.min() - margin)
    y1 = min(h, ys.max() + margin + 1)
    x0 = max(0, xs.min() - margin)
    x1 = min(w, xs.max() + margin + 1)
    return y0, y1, x0, x1


def mask_coverage(binmask):
    return float((binmask > 127).sum()) / float(max(1, binmask.shape[0] * binmask.shape[1]))


def fill_mask_holes(binmask):
    """Lấp lỗ nhỏ bên trong mask để LaMa/OpenCV không để lại chấm/rìa vật thể."""
    h, w = binmask.shape[:2]
    flood = binmask.copy()
    flood_mask = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(flood, flood_mask, (0, 0), 255)
    holes = cv2.bitwise_not(flood)
    return cv2.bitwise_or(binmask, holes)


def preprocess_mask(binmask, dilate=10, feather=4):
    """Mask chuẩn Samsung-style: binary sạch, lấp lỗ, mở rộng viền bằng ellipse."""
    _, cleaned = cv2.threshold(binmask, 127, 255, cv2.THRESH_BINARY)
    cleaned = fill_mask_holes(cleaned)
    cleaned = cv2.morphologyEx(
        cleaned,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
        iterations=1
    )
    if dilate > 0:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate * 2 + 1, dilate * 2 + 1))
        cleaned = cv2.dilate(cleaned, k, iterations=1)
    return cleaned


def expand_shadow_reflection_mask(img_bgr, binmask, remove_shadow=True, remove_reflection=True):
    """Tự động ăn thêm bóng đổ / glare gần vật thể để tránh còn vệt sau khi xoá."""
    if not remove_shadow and not remove_reflection:
        return binmask

    h, w = binmask.shape[:2]
    pad = max(40, int(min(h, w) * 0.04))
    near_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (pad * 2 + 1, pad * 2 + 1))
    near = cv2.dilate(binmask, near_k, iterations=1)
    ring = cv2.subtract(near, binmask)
    if ring.sum() == 0:
        return binmask

    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    hch, sch, vch = cv2.split(hsv)
    rb = ring > 127
    if not rb.any():
        return binmask

    bg_v = float(np.median(vch[rb]))
    bg_s = float(np.median(sch[rb]))
    extra = np.zeros_like(binmask)

    if remove_shadow:
        # Bóng thường tối hơn nền lân cận nhưng vẫn nằm sát object.
        shadow = ((vch.astype(np.float32) < max(18.0, bg_v * 0.72)) &
                  (sch.astype(np.float32) <= min(255.0, bg_s + 95.0)) &
                  rb)
        shadow = shadow.astype(np.uint8) * 255
        shadow = cv2.morphologyEx(shadow, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
        shadow = cv2.morphologyEx(shadow, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
        extra = cv2.bitwise_or(extra, shadow)

    if remove_reflection:
        # Glare/reflection thường rất sáng và ít bão hoà màu.
        reflection = ((vch > 232) & (sch < 55) & rb).astype(np.uint8) * 255
        reflection = cv2.morphologyEx(reflection, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
        extra = cv2.bitwise_or(extra, reflection)

    # Chỉ lấy các mảng extra chạm gần mask chính để tránh ăn nhầm highlight xa.
    if extra.sum() > 0:
        labels, stats = cv2.connectedComponentsWithStats(extra, 8)[1:3]
        filtered = np.zeros_like(extra)
        touch = cv2.dilate(binmask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21)), iterations=1) > 127
        for label in range(1, stats.shape[0]):
            comp = labels == label
            area = int(stats[label, cv2.CC_STAT_AREA])
            if area < 12:
                continue
            if comp[touch].any():
                filtered[comp] = 255
        extra = filtered

    expanded = cv2.bitwise_or(binmask, extra)
    expanded = cv2.morphologyEx(expanded, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    return expanded


def analyze_context(img_bgr, binmask, ring_size=55):
    """Đo màu, noise, sharpness quanh vùng xoá để hậu kỳ match tự nhiên hơn."""
    ring = _ring_of(binmask, ring_size)
    rb = ring > 127
    if not rb.any():
        return {"uniform": False, "noise": 0.0, "sharpness": 0.0}
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    ring_lab = lab[rb]
    std_color = float(np.mean(ring_lab.std(axis=0)))
    noise = float((gray - cv2.GaussianBlur(gray, (0, 0), 1.5))[rb].std())
    sharp = float(cv2.Laplacian(gray, cv2.CV_32F)[rb].var())
    return {
        "uniform": std_color < 8.0,
        "noise": noise,
        "sharpness": sharp,
        "mean_lab": ring_lab.mean(axis=0).tolist(),
        "std_lab": np.maximum(ring_lab.std(axis=0), 1.0).tolist()
    }


# ============================================================================
# Detail / contrast matching (in the crop space)
# ============================================================================

def boundary_color_adjust(original, inpainted, binmask, ring_size=35, strength=0.5):
    """Subtle LAB mean shift toward the surrounding ring. No gradient mixing."""
    if ring_size <= 0 or strength <= 0:
        return inpainted
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ring_size * 2 + 1, ring_size * 2 + 1))
    ring = cv2.subtract(cv2.dilate(binmask, k, iterations=1), binmask)
    rb = ring > 127
    ib = binmask > 127
    if not rb.any() or not ib.any():
        return inpainted
    lab_o = cv2.cvtColor(original, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab_i = cv2.cvtColor(inpainted, cv2.COLOR_BGR2LAB).astype(np.float32)
    mask_f = cv2.GaussianBlur(binmask.astype(np.float32) / 255.0, (15, 15), 0)
    for ch in range(3):
        delta = (float(lab_o[..., ch][rb].mean()) - float(lab_i[..., ch][ib].mean())) * strength
        lab_i[..., ch] += delta * mask_f
    return cv2.cvtColor(np.clip(lab_i, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def lab_mean_std_match(original, inpainted, binmask, ring_size=35, strength=0.55):
    """Match cả mean và contrast màu LAB, giúp vùng fill không bị ám sáng/tối."""
    ring = _ring_of(binmask, ring_size)
    rb = ring > 127
    ib = binmask > 127
    if not rb.any() or not ib.any():
        return inpainted

    lab_o = cv2.cvtColor(original, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab_i = cv2.cvtColor(inpainted, cv2.COLOR_BGR2LAB).astype(np.float32)
    ring_vals = lab_o[rb]
    fill_vals = lab_i[ib]
    ring_mean = ring_vals.mean(axis=0)
    ring_std = np.maximum(ring_vals.std(axis=0), 1.0)
    fill_mean = fill_vals.mean(axis=0)
    fill_std = np.maximum(fill_vals.std(axis=0), 1.0)

    matched = lab_i.copy()
    for ch in range(3):
        channel = matched[..., ch]
        normalized = (channel - fill_mean[ch]) * (ring_std[ch] / fill_std[ch]) + ring_mean[ch]
        matched[..., ch] = channel * (1.0 - strength) + normalized * strength

    mask_f = cv2.GaussianBlur(binmask.astype(np.float32) / 255.0, (17, 17), 0)
    m3 = cv2.merge([mask_f, mask_f, mask_f])
    mixed = matched * m3 + lab_i * (1.0 - m3)
    return cv2.cvtColor(np.clip(mixed, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def _ring_of(binmask, ring_size):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ring_size * 2 + 1, ring_size * 2 + 1))
    return cv2.subtract(cv2.dilate(binmask, k, iterations=1), binmask)


def sharpness_match(original, inpainted, binmask, ring_size=30):
    """MATCH (not boost) the fill's sharpness to the surrounding ring.

    Measures Laplacian variance (sharpness proxy) in fill vs ring:
    - Fill softer than ring → gentle unsharp to reach ring level (capped)
    - Fill sharper than ring → gentle blur to soften to ring level
    Goal: fill sharpness ≈ surrounding sharpness (Samsung's "sharpness matching").
    """
    ring = _ring_of(binmask, ring_size)
    rb = ring > 127
    ib = binmask > 127
    if not rb.any() or not ib.any():
        return inpainted

    gray_i = cv2.cvtColor(inpainted, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gray_o = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY).astype(np.float32)
    lap_i = cv2.Laplacian(gray_i, cv2.CV_32F)
    lap_o = cv2.Laplacian(gray_o, cv2.CV_32F)
    sharp_fill = float(lap_i[ib].var())
    sharp_ring = float(lap_o[rb].var())
    if sharp_fill < 1 or sharp_ring < 1:
        return inpainted

    ratio = sharp_ring / sharp_fill
    mask_f = cv2.GaussianBlur(binmask.astype(np.float32) / 255.0, (13, 13), 0)
    m3 = cv2.merge([mask_f, mask_f, mask_f])

    if ratio > 1.25:
        # Fill too soft → gentle unsharp, amount proportional but capped low (avoid ringing)
        amount = min((ratio - 1.0) * 0.4, 0.6)
        blurred = cv2.GaussianBlur(inpainted, (0, 0), 1.1)
        adj = np.clip(cv2.addWeighted(inpainted, 1.0 + amount, blurred, -amount, 0), 0, 255).astype(np.uint8)
    elif ratio < 0.8:
        # Fill too sharp → gentle blur toward ring level
        adj = cv2.GaussianBlur(inpainted, (0, 0), 0.8)
    else:
        return inpainted  # already matched
    return (adj.astype(np.float32) * m3 + inpainted.astype(np.float32) * (1 - m3)).astype(np.uint8)


def grain_match(original, inpainted, binmask, ring_size=25):
    """Add ONLY enough grain to reach the surrounding noise level (no over-grain)."""
    ring = _ring_of(binmask, ring_size)
    rb = ring > 127
    ib = binmask > 127
    if not rb.any() or not ib.any():
        return inpainted
    gray_o = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gray_i = cv2.cvtColor(inpainted, cv2.COLOR_BGR2GRAY).astype(np.float32)
    ring_noise = float((gray_o - cv2.GaussianBlur(gray_o, (0, 0), 1.5))[rb].std())
    fill_noise = float((gray_i - cv2.GaussianBlur(gray_i, (0, 0), 1.5))[ib].std())
    deficit = ring_noise - fill_noise
    if deficit <= 0.5:
        return inpainted  # already grainy enough
    deficit = min(deficit, 5.0)  # cap
    h, w = inpainted.shape[:2]
    rng = np.random.default_rng(7)
    grain = rng.normal(0, deficit, (h, w, 1)).astype(np.float32)
    grain = np.repeat(grain, 3, axis=2)
    mask_f = cv2.GaussianBlur(binmask.astype(np.float32) / 255.0, (11, 11), 0)
    m3 = cv2.merge([mask_f, mask_f, mask_f])
    grained = np.clip(inpainted.astype(np.float32) + grain * m3, 0, 255).astype(np.uint8)
    return grained


def remove_halo(original, inpainted, binmask, edge_width=6):
    """Remove halo/ringing at the mask boundary via bilateral filter on the edge band only."""
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (edge_width * 2 + 1, edge_width * 2 + 1))
    dil = cv2.dilate(binmask, k, iterations=1)
    ero = cv2.erode(binmask, k, iterations=1)
    edge_band = cv2.subtract(dil, ero)
    if edge_band.sum() == 0:
        return inpainted
    smoothed = cv2.bilateralFilter(inpainted, d=7, sigmaColor=35, sigmaSpace=35)
    eb_f = cv2.GaussianBlur(edge_band.astype(np.float32) / 255.0, (9, 9), 0)
    m3 = cv2.merge([eb_f, eb_f, eb_f])
    return (smoothed.astype(np.float32) * m3 + inpainted.astype(np.float32) * (1 - m3)).astype(np.uint8)


def edge_repair_inside_mask(original, inpainted, binmask, edge_width=5):
    """Repair only the inner edge of the erased area; pixels outside mask stay untouched later."""
    if edge_width <= 0:
        return inpainted
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (edge_width * 2 + 1, edge_width * 2 + 1))
    inner = cv2.subtract(binmask, cv2.erode(binmask, kernel, iterations=1))
    if inner.sum() == 0:
        return inpainted
    guided = cv2.bilateralFilter(inpainted, d=5, sigmaColor=24, sigmaSpace=24)
    inner_f = cv2.GaussianBlur(inner.astype(np.float32) / 255.0, (edge_width * 2 + 1, edge_width * 2 + 1), 0)
    inner_f = inner_f * (binmask.astype(np.float32) / 255.0)
    m3 = cv2.merge([inner_f, inner_f, inner_f])
    return (guided.astype(np.float32) * m3 + inpainted.astype(np.float32) * (1.0 - m3)).astype(np.uint8)


def make_inside_only_alpha(binmask, feather=3):
    """Alpha is zero outside the final mask, so only selected pixels can change."""
    hard = (binmask > 127).astype(np.uint8)
    if feather <= 0:
        return hard.astype(np.float32)

    dist = cv2.distanceTransform(hard, cv2.DIST_L2, 3)
    alpha = np.clip(dist / float(max(1, feather)), 0.0, 1.0)
    alpha[hard == 0] = 0.0
    return alpha.astype(np.float32)


def verify_and_score(original, result, hard_full, ring_size=30):
    """Kiểm tra chất lượng + đảm bảo KHÔNG đổi pixel ngoài mask.

    Trả về dict: changed_outside (số pixel ngoài mask bị đổi — phải = 0),
    color_delta, sharp_delta, noise_delta, score (0-100, cao = tốt).
    """
    hb = hard_full > 127
    outside = ~hb
    # changed_outside: pixel ngoài mask khác ảnh gốc (bất kỳ kênh nào)
    diff = np.abs(original.astype(np.int16) - result.astype(np.int16)).max(axis=2)
    changed_outside = int((diff[outside] > 0).sum())

    ring = _ring_of(hard_full, ring_size)
    rb = ring > 127
    metrics = {"changed_outside": changed_outside, "color_delta": 0.0, "sharp_delta": 0.0, "noise_delta": 0.0, "score": 100.0}
    if not rb.any() or not hb.any():
        return metrics

    lab_o = cv2.cvtColor(original, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab_r = cv2.cvtColor(result, cv2.COLOR_BGR2LAB).astype(np.float32)
    gray_o = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gray_r = cv2.cvtColor(result, cv2.COLOR_BGR2GRAY).astype(np.float32)

    color_delta = float(np.linalg.norm(lab_r[hb].mean(axis=0) - lab_o[rb].mean(axis=0)))
    sharp_fill = float(cv2.Laplacian(gray_r, cv2.CV_32F)[hb].var())
    sharp_ring = float(cv2.Laplacian(gray_o, cv2.CV_32F)[rb].var())
    sharp_delta = abs(sharp_fill - sharp_ring) / max(1.0, sharp_ring)
    noise_fill = float((gray_r - cv2.GaussianBlur(gray_r, (0, 0), 1.5))[hb].std())
    noise_ring = float((gray_o - cv2.GaussianBlur(gray_o, (0, 0), 1.5))[rb].std())
    noise_delta = abs(noise_fill - noise_ring)

    # Score: bắt đầu 100, trừ điểm theo độ lệch
    score = 100.0
    score -= min(40.0, color_delta * 2.0)        # màu lệch nhiều = trừ nhiều
    score -= min(25.0, sharp_delta * 25.0)        # sharpness lệch
    score -= min(15.0, noise_delta * 3.0)         # grain lệch
    if changed_outside > 0:
        score -= 50.0                             # vi phạm nghiêm trọng
    metrics.update({
        "color_delta": round(color_delta, 2),
        "sharp_delta": round(sharp_delta, 3),
        "noise_delta": round(noise_delta, 2),
        "score": max(0.0, round(score, 1))
    })
    return metrics


# ============================================================================
# Main pipeline — crop, inpaint, match, composite into ORIGINAL
# ============================================================================

def run_inpaint(img_bgr, binmask_full, engine="auto", dilate=12, feather=3, ldm_steps=35,
                remove_shadow=True, remove_reflection=True, premium=True):
    t0 = time.time()
    H, W = img_bgr.shape[:2]

    original_coverage = mask_coverage(binmask_full)
    if original_coverage > 0.60:
        print(f"WARN: mask covers {original_coverage * 100:.1f}% of the image; large removals may show artifacts.", file=sys.stderr)

    # 1. Mask preprocessing: lấp lỗ + mở rộng mask để tránh viền cứng.
    binmask_full = preprocess_mask(binmask_full, dilate=dilate, feather=feather)

    # 2. Tự động ăn thêm shadow/reflection/glare quanh object để không còn vết.
    before_extra = int((binmask_full > 127).sum())
    binmask_full = expand_shadow_reflection_mask(
        img_bgr,
        binmask_full,
        remove_shadow=remove_shadow,
        remove_reflection=remove_reflection
    )
    after_extra = int((binmask_full > 127).sum())
    if after_extra > before_extra:
        print(f"[inpaint] shadow/reflection mask +{(after_extra - before_extra) / max(1, H * W) * 100:.2f}% area", file=sys.stderr)

    context = analyze_context(img_bgr, binmask_full, ring_size=55)
    if context.get("uniform"):
        print("[inpaint] context: uniform/gradient background", file=sys.stderr)
    if False:
        # Nền rất phẳng: NS thường sạch hơn AI vì ít hallucination.
        engine = "ns"

    # 2. Crop a region around the mask (with generous margin for context)
    #    so the AI processes ONLY the relevant area at NATIVE resolution.
    margin = max(128, int(min(H, W) * 0.18))
    bbox = mask_bbox(binmask_full, margin, img_bgr.shape)
    if bbox is None:
        return img_bgr.copy(), "noop", {"changed_outside": 0, "score": 0.0}
    y0, y1, x0, x1 = bbox

    crop_img = img_bgr[y0:y1, x0:x1].copy()
    crop_mask = binmask_full[y0:y1, x0:x1].copy()

    # 3. Inpaint the crop
    filled_crop, engine_name = inpaint_engine(engine, crop_img, crop_mask, ldm_steps=ldm_steps)
    if filled_crop.shape[:2] != crop_img.shape[:2]:
        filled_crop = cv2.resize(filled_crop, (crop_img.shape[1], crop_img.shape[0]), interpolation=cv2.INTER_LANCZOS4)

    t_inpaint = time.time() - t0
    print(f"[inpaint] Engine: {engine_name} | crop {crop_img.shape[1]}x{crop_img.shape[0]} of {W}x{H} ({t_inpaint:.1f}s)", file=sys.stderr)

    # 4. Post-process the filled crop — SUBTLE MATCHING (Samsung-style), NOT aggressive enhance.
    #    Aggressive frequency-separation/CLAHE creates chrome-blob artifacts on large fills,
    #    so we instead gently MATCH the fill to its surroundings.
    t1 = time.time()
    pp = boundary_color_adjust(crop_img, filled_crop, crop_mask, ring_size=35, strength=0.45)
    if premium:
        pp = lab_mean_std_match(crop_img, pp, crop_mask, ring_size=38, strength=0.48)
    pp = sharpness_match(crop_img, pp, crop_mask, ring_size=30)
    pp = grain_match(crop_img, pp, crop_mask, ring_size=25)
    pp = remove_halo(crop_img, pp, crop_mask, edge_width=8 if premium else 6)
    pp = edge_repair_inside_mask(crop_img, pp, crop_mask, edge_width=5 if premium else 3)

    # 5. Composite the filled crop back into a COPY of the ORIGINAL (background preserved!)
    result = img_bgr.copy()
    # Inside-only alpha: outside the processed mask stays byte-identical to the original.
    fm = make_inside_only_alpha(crop_mask, feather=max(1, min(int(feather), 6)))
    a3 = cv2.merge([fm, fm, fm])
    blended_crop = (pp.astype(np.float32) * a3 + crop_img.astype(np.float32) * (1 - a3)).astype(np.uint8)
    hard = crop_mask > 127
    result_crop = result[y0:y1, x0:x1]
    result_crop[hard] = blended_crop[hard]
    result[y0:y1, x0:x1] = result_crop

    t_post = time.time() - t1

    # 6. Quality verification — đảm bảo ngoài mask KHÔNG đổi pixel + chấm điểm.
    full_hard = np.zeros((H, W), dtype=np.uint8)
    full_hard[y0:y1, x0:x1][hard] = 255
    qa = verify_and_score(img_bgr, result, full_hard)
    print(f"[inpaint] Post+composite: {t_post:.1f}s | QA: changed_outside={qa['changed_outside']} "
          f"color_delta={qa['color_delta']} sharp_delta={qa['sharp_delta']} "
          f"noise_delta={qa['noise_delta']} score={qa['score']}", file=sys.stderr)
    if qa["changed_outside"] > 0:
        # An toàn tuyệt đối: ép lại các pixel ngoài mask về đúng ảnh gốc.
        outside = full_hard <= 127
        result[outside] = img_bgr[outside]
        print(f"WARN: forced {qa['changed_outside']} outside-mask pixels back to original (pipeline guard).", file=sys.stderr)

    return result, engine_name, qa


def main():
    p = argparse.ArgumentParser()
    p.add_argument("input")
    p.add_argument("mask")
    p.add_argument("output")
    p.add_argument("--method", choices=["auto", "ldm", "lama", "telea", "ns"], default="auto")
    p.add_argument("--dilate", type=int, default=12)
    p.add_argument("--feather", type=int, default=3)
    p.add_argument("--ldm-steps", type=int, default=35)
    p.add_argument("--remove-shadow", choices=["0", "1"], default="1")
    p.add_argument("--remove-reflection", choices=["0", "1"], default="1")
    p.add_argument("--premium", choices=["0", "1"], default="1")
    args = p.parse_args()

    img = cv2.imread(args.input, cv2.IMREAD_COLOR)
    if img is None:
        print(f"ERROR: read {args.input}", file=sys.stderr); return 1
    mask = cv2.imread(args.mask, cv2.IMREAD_GRAYSCALE)
    if mask is None:
        print(f"ERROR: read {args.mask}", file=sys.stderr); return 1

    h, w = img.shape[:2]
    if mask.shape[:2] != (h, w):
        mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)
    _, binmask = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
    if binmask.sum() < 200:
        print("ERROR: empty mask", file=sys.stderr); return 1

    result, engine, qa = run_inpaint(
        img,
        binmask,
        engine=args.method,
        dilate=args.dilate,
        feather=args.feather,
        ldm_steps=args.ldm_steps,
        remove_shadow=args.remove_shadow == "1",
        remove_reflection=args.remove_reflection == "1",
        premium=args.premium == "1"
    )
    if not cv2.imwrite(args.output, result):
        print(f"ERROR: write {args.output}", file=sys.stderr); return 1
    print(f"[inpaint] DONE engine={engine} score={qa.get('score')} changed_outside={qa.get('changed_outside')}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
