"""
YOLO inference SERVER (persisten) — load model & torch SEKALI, lalu layani banyak
request tanpa reload. Ini menghilangkan lag ~6 dtk/frame yang disebabkan oleh
import torch + load model berulang tiap panggilan.

Protokol (baris demi baris via stdin/stdout):
  - Saat siap:  stdout -> "@@READY@@"
  - Request  :  stdin  <- {"id":1,"weights":"...best.pt","conf":0.35,"iou":0.45,
                            "imgsz":640,"classes":["a","b"],"image":"<base64 jpg>"}
  - Response :  stdout -> "@@RESP@@ {json}"  (dengan field "id" yang sama)

Model di-cache per path weights → ganti-ganti model (Object Detector / Socket
Measurement) tidak reload.
"""
import sys
import io
import json
import base64
import time


def eprint(*a):
    print(*a, file=sys.stderr, flush=True)


def main():
    # Import berat SEKALI di awal (bukan tiap request).
    try:
        from ultralytics import YOLO
        from PIL import Image
        import numpy as np
    except ImportError as e:
        print("@@RESP@@ " + json.dumps({"error": f"deps missing: {e}. Run: pip install ultralytics pillow"}), flush=True)
        return
    try:
        import cv2  # untuk pengukuran GD&T dari kontur mask (segmentation)
    except Exception:
        cv2 = None

    models = {}   # weights_path -> YOLO (cache)

    def measure_from_contour(contour):
        if cv2 is None or contour is None or len(contour) < 3:
            return None
        try:
            cnt = np.array(contour, dtype=np.float32).reshape(-1, 1, 2)
            # Haluskan kontur: buang duri/noise kecil di tepi mask supaya ukuran lebih stabil
            # (kurangi fluktuasi minAreaRect akibat pantulan/kilau).
            peri = cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, 0.008 * peri, True)
            if approx is not None and len(approx) >= 3:
                cnt = approx.astype(np.float32)
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

    def handle(req):
        rid = req.get("id")
        weights = req["weights"]
        classes = req.get("classes", [])
        conf = float(req.get("conf", 0.35))
        iou = float(req.get("iou", 0.45))
        imgsz = int(req.get("imgsz", 640))
        img = Image.open(io.BytesIO(base64.b64decode(req["image"]))).convert("RGB")
        arr = np.array(img)

        model = models.get(weights)
        if model is None:
            model = YOLO(weights)
            models[weights] = model

        t0 = time.time()
        results = model.predict(source=arr, conf=conf, iou=iou, imgsz=imgsz, verbose=False)
        infer_ms = (time.time() - t0) * 1000

        detections = []
        min_conf = 1.0
        verdict = "OK"
        for r in results:
            if r.boxes is None:
                continue
            masks_xy = None
            if getattr(r, "masks", None) is not None:
                try:
                    masks_xy = r.masks.xy
                except Exception:
                    masks_xy = None
            for j, box in enumerate(r.boxes):
                cls_id = int(box.cls[0])
                c = float(box.conf[0])
                xyxy = box.xyxy[0].tolist()
                cls_name = classes[cls_id] if cls_id < len(classes) else str(cls_id)
                det = {
                    "x1": xyxy[0], "y1": xyxy[1], "x2": xyxy[2], "y2": xyxy[3],
                    "confidence": c, "class_id": cls_id, "class_name": cls_name,
                }
                if masks_xy is not None and j < len(masks_xy):
                    meas = measure_from_contour(masks_xy[j])
                    if meas:
                        det["measure"] = meas
                detections.append(det)
                if cls_name != "OK":
                    verdict = "NG"
                    if c < min_conf:
                        min_conf = c
        return {
            "id": rid,
            "verdict": verdict,
            "minConfidence": min_conf if verdict == "NG" else 1.0,
            "inferenceMS": infer_ms,
            "detections": detections,
        }

    eprint("[infer_server] deps loaded, ready")
    print("@@READY@@", flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as e:
            print("@@RESP@@ " + json.dumps({"error": f"bad request: {e}"}), flush=True)
            continue
        try:
            out = handle(req)
            print("@@RESP@@ " + json.dumps(out), flush=True)
        except Exception as e:
            print("@@RESP@@ " + json.dumps({"id": req.get("id"), "error": str(e)}), flush=True)


if __name__ == "__main__":
    main()
