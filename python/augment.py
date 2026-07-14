"""
Dataset augmentation — output SEPARATE file per aug type per source image,
DAN ikut men-transform label supaya anotasi tetap valid di gambar hasil.

Mendukung DUA format label YOLO:
  * Detection (bounding box): "cls cx cy w h"            (4 koordinat)
  * Segmentation (polygon)  : "cls x1 y1 x2 y2 ... xn yn" (>=6, genap)

Logika:
  Untuk tiap gambar asli yang PUNYA label, untuk tiap aug type enabled &
  tiap multiplier index:
    - Apply HANYA aug type ini ke gambar
    - Transform label sesuai aug:
        * geometric (rotate / flip-h / flip-v) -> koordinat diubah
        * photometric (blur / exposure / noise) -> label disalin apa adanya
    - Save <stem>.<augtype>.aug<i>.jpg + .txt

Gambar tanpa label DILEWATI. Progress: "PROGRESS <done>/<total>".
"""
import argparse
import random
from pathlib import Path

import cv2
import numpy as np


# ---------- Image ops ----------

def apply_flip_h(img):
    return cv2.flip(img, 1)


def apply_flip_v(img):
    return cv2.flip(img, 0)


def apply_blur(img, sigma):
    if sigma <= 0:
        return img.copy()
    return cv2.GaussianBlur(img, (0, 0), sigmaX=sigma, sigmaY=sigma)


def apply_exposure(img, alpha):
    return cv2.convertScaleAbs(img, alpha=alpha, beta=0)


def apply_noise(img, sigma):
    noise = np.random.normal(0, sigma, img.shape).astype(np.int16)
    return np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)


# ---------- Label parsing ----------
# item = (cls_str, vals[list of float], is_poly[bool])
#   bbox    : vals = [cx, cy, w, h]
#   polygon : vals = [x1, y1, x2, y2, ...]  (semua normalized 0..1)

def read_label(p):
    items = []
    if not p.exists():
        return items
    for line in p.read_text().splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        cls = parts[0]
        try:
            vals = list(map(float, parts[1:]))
        except ValueError:
            continue
        if len(vals) == 4:
            items.append((cls, vals, False))                 # bbox
        elif len(vals) >= 6 and len(vals) % 2 == 0:
            items.append((cls, vals, True))                  # polygon
    return items


def write_label(p, items):
    lines = [cls + " " + " ".join(f"{v:.6f}" for v in vals)
             for (cls, vals, _poly) in items]
    p.write_text(("\n".join(lines) + "\n") if lines else "")


def _clamp(v):
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


# ---------- Label transforms (format-aware) ----------

def flip_item(cls, vals, is_poly, axis):
    """axis 'h' -> mirror X, axis 'v' -> mirror Y."""
    if is_poly:
        out = []
        for i, v in enumerate(vals):
            flip_this = (axis == 'h' and i % 2 == 0) or (axis == 'v' and i % 2 == 1)
            out.append(1.0 - v if flip_this else v)
        return (cls, out, True)
    cx, cy, bw, bh = vals
    if axis == 'h':
        cx = 1.0 - cx
    else:
        cy = 1.0 - cy
    return (cls, [cx, cy, bw, bh], False)


def rotate_item(cls, vals, is_poly, M, w, h):
    """Putar pakai matrix affine yang SAMA dengan gambar. Poligon: tiap titik
    ditransform lalu di-clamp ke [0,1]. Bbox: ambil axis-aligned box dari 4 sudut."""
    def tf(x, y):
        return (M[0, 0] * x + M[0, 1] * y + M[0, 2],
                M[1, 0] * x + M[1, 1] * y + M[1, 2])
    if is_poly:
        out = []
        for i in range(0, len(vals), 2):
            nx, ny = tf(vals[i] * w, vals[i + 1] * h)
            out.append(_clamp(nx / w))
            out.append(_clamp(ny / h))
        return (cls, out, True)
    cx, cy, bw, bh = vals
    px, py, pw, ph = cx * w, cy * h, bw * w, bh * h
    corners = [(px - pw / 2, py - ph / 2), (px + pw / 2, py - ph / 2),
               (px + pw / 2, py + ph / 2), (px - pw / 2, py + ph / 2)]
    xs, ys = [], []
    for (X, Y) in corners:
        nx, ny = tf(X, Y)
        xs.append(nx)
        ys.append(ny)
    x1 = max(0.0, min(xs))
    y1 = max(0.0, min(ys))
    x2 = min(float(w), max(xs))
    y2 = min(float(h), max(ys))
    if x2 <= x1 or y2 <= y1:
        return None
    return (cls, [((x1 + x2) / 2) / w, ((y1 + y2) / 2) / h,
                  (x2 - x1) / w, (y2 - y1) / h], False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--multiplier", type=int, default=2)
    ap.add_argument("--rotate", action="store_true")
    ap.add_argument("--rotate-max", type=float, default=15.0)
    ap.add_argument("--flip-h", action="store_true")
    ap.add_argument("--flip-v", action="store_true")
    ap.add_argument("--blur", action="store_true")
    ap.add_argument("--blur-sigma", type=float, default=2.0)
    ap.add_argument("--exposure", action="store_true")
    ap.add_argument("--exposure-alpha", type=float, default=1.2)
    ap.add_argument("--noise", action="store_true")
    ap.add_argument("--noise-sigma", type=float, default=8.0)
    ap.add_argument("--splits", default="train",
                    help="split yang di-augment, pisah koma. mis: train  atau  train,val,test")
    ap.add_argument("--clean", action="store_true",
                    help="hapus augmentasi lama (.aug) di split terkait sebelum generate baru")
    args = ap.parse_args()

    base = Path(args.dir)
    splits = [s.strip() for s in (args.splits or "train").split(",") if s.strip()]

    # Regenerasi bersih: hapus augmentasi lama (.aug) di split terkait dulu,
    # supaya aug lama (mis. rotasi) tidak ikut saat generate set baru.
    if args.clean:
        removed = 0
        for split in splits:
            for kind in ("images", "labels"):
                d = base / kind / split
                if not d.exists():
                    continue
                for f in list(d.iterdir()):
                    if ".aug" in f.name:
                        try:
                            f.unlink()
                            removed += 1
                        except Exception:
                            pass
        print(f"[i] Regenerasi bersih: {removed} file augmentasi lama dihapus.", flush=True)

    enabled = []
    if args.rotate:
        enabled.append(("rotate", "rotate"))
    if args.flip_h:
        enabled.append(("fliph", "fliph"))
    if args.flip_v:
        enabled.append(("flipv", "flipv"))
    if args.blur:
        enabled.append(("blur", "blur"))
    if args.exposure:
        enabled.append(("exposure", "exposure"))
    if args.noise:
        enabled.append(("noise", "noise"))
    if not enabled:
        print("generated: 0", flush=True)
        print("[!] Tidak ada augmentasi enabled", flush=True)
        return

    # Kumpulkan sumber PER SPLIT. Output tiap split ditulis kembali ke foldernya
    # sendiri (train->train, val->val, test->test) → tidak ada percampuran antar-split.
    per_split = []          # (split, src_dir, lbl_dir, [(img, lbl), ...])
    total = 0
    skipped_no_label = 0
    for split in splits:
        src_dir = base / "images" / split
        lbl_dir = base / "labels" / split
        if not src_dir.exists():
            print(f"[i] lewati split '{split}' — {src_dir} tidak ada", flush=True)
            continue
        lbl_dir_exists = lbl_dir.exists()
        sources = []
        for img_path in sorted(src_dir.iterdir()):
            if ".aug" in img_path.name:
                continue
            if img_path.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                continue
            lbl_path = lbl_dir / (img_path.stem + ".txt")
            if not (lbl_dir_exists and lbl_path.exists()):
                skipped_no_label += 1
                continue
            sources.append((img_path, lbl_path))
        per_split.append((split, src_dir, lbl_dir, sources))
        total += len(sources) * len(enabled) * args.multiplier

    if total == 0:
        print("generated: 0", flush=True)
        print(f"[!] Tidak ada gambar ber-label untuk di-augment "
              f"(skipped {skipped_no_label} tanpa label).", flush=True)
        return

    generated = 0
    done = 0
    print(f"PROGRESS 0/{total}", flush=True)

    for split, src_dir, lbl_dir, sources in per_split:
        for img_path, lbl_path in sources:
            img = cv2.imread(str(img_path))
            if img is None:
                done += len(enabled) * args.multiplier
                print(f"PROGRESS {done}/{total}", flush=True)
                continue
            h, w = img.shape[:2]
            items = read_label(lbl_path)
            stem = img_path.stem

            for aug_name, kind in enabled:
                for i in range(args.multiplier):
                    try:
                        if kind == "rotate":
                            angle = random.uniform(-args.rotate_max, args.rotate_max)
                            M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
                            out_img = cv2.warpAffine(img, M, (w, h))
                            out_items = [r for r in
                                         (rotate_item(c, v, p, M, w, h) for (c, v, p) in items)
                                         if r]
                        elif kind == "fliph":
                            out_img = apply_flip_h(img)
                            out_items = [flip_item(c, v, p, 'h') for (c, v, p) in items]
                        elif kind == "flipv":
                            out_img = apply_flip_v(img)
                            out_items = [flip_item(c, v, p, 'v') for (c, v, p) in items]
                        elif kind == "blur":
                            out_img = apply_blur(img, args.blur_sigma)
                            out_items = list(items)
                        elif kind == "exposure":
                            out_img = apply_exposure(img, args.exposure_alpha)
                            out_items = list(items)
                        elif kind == "noise":
                            out_img = apply_noise(img, args.noise_sigma)
                            out_items = list(items)
                        else:
                            continue

                        out_img_path = src_dir / f"{stem}.{aug_name}.aug{i}.jpg"
                        out_lbl_path = lbl_dir / f"{stem}.{aug_name}.aug{i}.txt"
                        cv2.imwrite(str(out_img_path), out_img)
                        write_label(out_lbl_path, out_items)
                        generated += 1
                    except Exception as e:
                        print(f"[!] {aug_name} on {img_path.name}: {e}", flush=True)
                    finally:
                        done += 1
                        if done % 10 == 0 or done == total:
                            print(f"PROGRESS {done}/{total}", flush=True)

    print(f"generated: {generated}", flush=True)
    if skipped_no_label:
        print(f"[i] {skipped_no_label} gambar tanpa label dilewati.", flush=True)


if __name__ == "__main__":
    main()
