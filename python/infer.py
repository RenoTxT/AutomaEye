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

    detections = []
    min_conf = 1.0
    verdict = "OK"
    for r in results:
        if r.boxes is None:
            continue
        for box in r.boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            xyxy = box.xyxy[0].tolist()
            cls_name = classes[cls_id] if cls_id < len(classes) else str(cls_id)
            detections.append({
                "x1": xyxy[0], "y1": xyxy[1],
                "x2": xyxy[2], "y2": xyxy[3],
                "confidence": conf,
                "class_id": cls_id,
                "class_name": cls_name,
            })
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
