"""
Dataset augmentation — output SEPARATE file per aug type per source image,
DAN ikut men-transform label bounding box (YOLO format) supaya anotasi
tetap valid di gambar hasil augmentasi.

Logika:
  Untuk tiap gambar asli yang PUNYA label:
    Untuk tiap aug type enabled, tiap multiplier index:
      - Apply HANYA aug type ini (bukan kombinasi) ke gambar
      - Transform label sesuai aug:
          * geometric (rotate / flip-h / flip-v) → koordinat box diubah
          * photometric (blur / exposure / noise) → label disalin apa adanya
      - Save <stem>.<augtype>.aug<i>.jpg + <stem>.<augtype>.aug<i>.txt

Gambar tanpa label DILEWATI (biar dataset augmentasi tetap punya anotasi).
Progress di-stream ke stdout: "PROGRESS <done>/<total>" supaya Electron bisa
tampilkan bar persen.
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


# ---------- Label (YOLO bbox) transforms ----------
# box = (cls_str, cx, cy, w, h) semua normalized 0..1

def boxes_fliph(boxes):
    return [(c, 1.0 - cx, cy, bw, bh) for (c, cx, cy, bw, bh) in boxes]


def boxes_flipv(boxes):
    return [(c, cx, 1.0 - cy, bw, bh) for (c, cx, cy, bw, bh) in boxes]


def boxes_rotate(boxes, M, w, h):
    """Rotate tiap box pakai matrix affine yang SAMA dengan gambar (M dari
    cv2.getRotationMatrix2D), lalu ambil axis-aligned bounding box dari 4 sudut
    yang sudah diputar. Box yang keluar frame di-clip; kalau habis, dibuang."""
    out = []
    for (c, cx, cy, bw, bh) in boxes:
        px, py = cx * w, cy * h
        pw, ph = bw * w, bh * h
        corners = [
            (px - pw / 2, py - ph / 2),
            (px + pw / 2, py - ph / 2),
            (px + pw / 2, py + ph / 2),
            (px - pw / 2, py + ph / 2),
        ]
        xs, ys = [], []
        for (X, Y) in corners:
            nx = M[0, 0] * X + M[0, 1] * Y + M[0, 2]
            ny = M[1, 0] * X + M[1, 1] * Y + M[1, 2]
            xs.append(nx)
            ys.append(ny)
        x1 = max(0.0, min(xs))
        y1 = max(0.0, min(ys))
        x2 = min(float(w), max(xs))
        y2 = min(float(h), max(ys))
        if x2 <= x1 or y2 <= y1:
            continue  # box keluar frame sepenuhnya
        out.append((
            c,
            ((x1 + x2) / 2) / w,
            ((y1 + y2) / 2) / h,
            (x2 - x1) / w,
            (y2 - y1) / h,
        ))
    return out


def read_label(p):
    boxes = []
    if p.exists():
        for line in p.read_text().splitlines():
            parts = line.split()
            if len(parts) >= 5:
                try:
                    cx, cy, bw, bh = map(float, parts[1:5])
                except ValueError:
                    continue
                boxes.append((parts[0], cx, cy, bw, bh))
    return boxes


def write_label(p, boxes):
    lines = [f"{c} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}"
             for (c, cx, cy, bw, bh) in boxes]
    p.write_text(("\n".join(lines) + "\n") if lines else "")


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

    args = ap.parse_args()

    base = Path(args.dir)
    src_dir = base / "images" / "train"
    lbl_dir = base / "labels" / "train"
    if not src_dir.exists():
        print(f"[X] {src_dir} not found", flush=True)
        print("generated: 0", flush=True)
        return
    lbl_dir_exists = lbl_dir.exists()

    # Daftar aug type enabled. Tiap entry: (name, kind)
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

    # Kumpulkan gambar asli (bukan hasil augment) yang PUNYA label
    sources = []
    skipped_no_label = 0
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

    total = len(sources) * len(enabled) * args.multiplier
    if total == 0:
        print("generated: 0", flush=True)
        print(f"[!] Tidak ada gambar ber-label untuk di-augment "
              f"(skipped {skipped_no_label} tanpa label).", flush=True)
        return

    generated = 0
    done = 0
    print(f"PROGRESS 0/{total}", flush=True)

    for img_path, lbl_path in sources:
        img = cv2.imread(str(img_path))
        if img is None:
            done += len(enabled) * args.multiplier
            print(f"PROGRESS {done}/{total}", flush=True)
            continue
        h, w = img.shape[:2]
        boxes = read_label(lbl_path)
        stem = img_path.stem

        for aug_name, kind in enabled:
            for i in range(args.multiplier):
                try:
                    if kind == "rotate":
                        angle = random.uniform(-args.rotate_max, args.rotate_max)
                        M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
                        out_img = cv2.warpAffine(img, M, (w, h))
                        out_boxes = boxes_rotate(boxes, M, w, h)
                    elif kind == "fliph":
                        out_img = apply_flip_h(img)
                        out_boxes = boxes_fliph(boxes)
                    elif kind == "flipv":
                        out_img = apply_flip_v(img)
                        out_boxes = boxes_flipv(boxes)
                    elif kind == "blur":
                        out_img = apply_blur(img, args.blur_sigma)
                        out_boxes = list(boxes)
                    elif kind == "exposure":
                        out_img = apply_exposure(img, args.exposure_alpha)
                        out_boxes = list(boxes)
                    elif kind == "noise":
                        out_img = apply_noise(img, args.noise_sigma)
                        out_boxes = list(boxes)
                    else:
                        continue

                    out_img_path = src_dir / f"{stem}.{aug_name}.aug{i}.jpg"
                    out_lbl_path = lbl_dir / f"{stem}.{aug_name}.aug{i}.txt"
                    cv2.imwrite(str(out_img_path), out_img)
                    write_label(out_lbl_path, out_boxes)
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
