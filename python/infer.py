"""
YOLO inference sidecar — dipanggil sekali per gambar.

Alur:
  1. Electron spawn: python infer.py --weights best.pt --classes OK,scratch,...
  2. Electron kirim base64 JPEG via STDIN
  3. Script decode, run YOLO, output JSON ke STDOUT

Output JSON:
  {
    "detections": [{"x1","y1","x2","y2","confidence","class_id","class_name"}, ...],
    "verdict": "OK" | "NG",
    "minConfidence": 0.0-1.0,
    "inferenceMS": 12.3
  }
"""
import argparse
import base64
import io
import json
import sys
import time

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--conf", type=float, default=0.35)
    ap.add_argument("--iou", type=float, default=0.45)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--classes", required=True, help="comma-separated")
    args = ap.parse_args()

    classes = args.classes.split(",")

    # Baca base64 JPEG dari stdin
    b64 = sys.stdin.readline().strip()
    if not b64:
        print(json.dumps({"error": "no input"}))
        sys.exit(1)

    try:
        img_bytes = base64.b64decode(b64)
    except Exception as e:
        print(json.dumps({"error": f"base64 decode: {e}"}))
        sys.exit(1)

    # Lazy import — hindari import ultralytics kalau tidak ada input
    try:
        from ultralytics import YOLO
        from PIL import Image
        import numpy as np
    except ImportError as e:
        print(json.dumps({"error": f"deps missing: {e}. Run: pip install ultralytics pillow"}))
        sys.exit(1)
    try:
        import cv2  # untuk pengukuran GD&T dari kontur mask (segmentation)
    except Exception:
        cv2 = None

    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    arr = np.array(img)

    model = YOLO(args.weights)
    t0 = time.time()
    results = model.predict(
        source=arr,
        conf=args.conf,
        iou=args.iou,
        imgsz=args.imgsz,
        verbose=False,
    )
    infer_ms = (time.time() - t0) * 1000

    def measure_from_contour(contour):
        """Ukuran (piksel) dari kontur mask segmentation — untuk GD&T presisi.
        diameterPx = diameter lingkaran min-enclosing; width/height = sisi min-area rect."""
        if cv2 is None or contour is None or len(contour) < 3:
            return None
        try:
            cnt = np.array(contour, dtype=np.float32).reshape(-1, 1, 2)
            (_, _), radius = cv2.minEnclosingCircle(cnt)
            (_, _), (w, h), _ = cv2.minAreaRect(cnt)
            return {
                "diameterPx": float(radius * 2.0),
                "widthPx": float(min(w, h)),
                "heightPx": float(max(w, h)),
                "areaPx": float(cv2.contourArea(cnt)),
            }
        except Exception:
            return None

    detections = []
    min_conf = 1.0
    verdict = "OK"
    for r in results:
        if r.boxes is None:
            continue
        # Kontur mask (kalau model segmentation) — selaras urutannya dengan boxes.
        masks_xy = None
        if getattr(r, "masks", None) is not None:
            try:
                masks_xy = r.masks.xy
            except Exception:
                masks_xy = None
        for j, box in enumerate(r.boxes):
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            xyxy = box.xyxy[0].tolist()
            cls_name = classes[cls_id] if cls_id < len(classes) else str(cls_id)
            det = {
                "x1": xyxy[0], "y1": xyxy[1],
                "x2": xyxy[2], "y2": xyxy[3],
                "confidence": conf,
                "class_id": cls_id,
                "class_name": cls_name,
            }
            if masks_xy is not None and j < len(masks_xy):
                meas = measure_from_contour(masks_xy[j])
                if meas:
                    det["measure"] = meas
            detections.append(det)
            if cls_name != "OK":
                verdict = "NG"
                if conf < min_conf:
                    min_conf = conf

    output = {
        "verdict": verdict,
        "minConfidence": min_conf if verdict == "NG" else 1.0,
        "inferenceMS": infer_ms,
        "detections": detections,
    }
    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
