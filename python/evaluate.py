"""
Evaluasi model YOLO pada sebuah split (test/val/train).

Dipanggil oleh Electron (lib/inference.js). Menghasilkan:
  - metrik keseluruhan (mAP50, mAP50-95, precision, recall, F1)
  - metrik per-kelas
  - confusion matrix + kurva PR/F1 (PNG dari ultralytics)
  - prediksi visual per gambar (anotasi tergambar)
Semua disimpan ke <model>/eval/<timestamp>/ dan hasilnya di-print sebagai:
  "EVAL_RESULT { ...json... }"
"""
import argparse
import glob
import json
import sys
import time
from pathlib import Path


def find_plot(d, *patterns):
    for pat in patterns:
        hits = sorted(glob.glob(str(Path(d) / pat)))
        if hits:
            return str(Path(hits[0]).resolve())
    return ""


def has_imgs(d):
    return d.exists() and any(
        p.suffix.lower() in (".jpg", ".jpeg", ".png") for p in d.iterdir()
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--split", default="test")
    ap.add_argument("--out", required=True)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--iou", type=float, default=0.45)
    a = ap.parse_args()

    stamp = time.strftime("%Y%m%d-%H%M%S")
    run_dir = Path(a.out) / stamp
    run_dir.mkdir(parents=True, exist_ok=True)

    # --- Self-heal path + pastikan key split ada di data.yaml ---
    import yaml
    data_file = Path(a.data)
    ds_dir = data_file.parent
    try:
        cfg = yaml.safe_load(data_file.read_text(encoding="utf-8")) or {}
    except Exception:
        cfg = {}
    cfg["path"] = str(ds_dir.resolve()).replace("\\", "/")

    split = a.split
    if not has_imgs(ds_dir / "images" / split):
        if has_imgs(ds_dir / "images" / "val"):
            split = "val"
        elif has_imgs(ds_dir / "images" / "train"):
            split = "train"
    cfg[split] = f"images/{split}"
    if "train" not in cfg:
        cfg["train"] = "images/train"
    if "val" not in cfg:
        cfg["val"] = "images/val" if has_imgs(ds_dir / "images" / "val") else "images/train"
    data_file.write_text(yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True), encoding="utf-8")

    print(f"PROGRESS 1/3 validasi split={split}", flush=True)
    try:
        from ultralytics import YOLO
    except ImportError:
        print("[X] ultralytics belum ter-install.", flush=True)
        sys.exit(1)

    model = YOLO(a.weights)
    names = model.names if isinstance(model.names, dict) else {i: n for i, n in enumerate(model.names)}

    val = model.val(
        data=str(data_file), split=split, imgsz=a.imgsz, conf=a.conf, iou=a.iou,
        project=str(run_dir), name="val", plots=True, save_json=False, verbose=False,
    )
    b = val.box

    def at(x, i, d=0.0):
        try:
            return float(x[i])
        except Exception:
            return d

    per_class = []
    try:
        idxs = list(b.ap_class_index)
    except Exception:
        idxs = []
    for i, ci in enumerate(idxs):
        per_class.append({
            "name": names.get(int(ci), str(ci)),
            "precision": at(b.p, i), "recall": at(b.r, i),
            "map50": at(b.ap50, i), "map5095": at(b.ap, i),
        })

    mp = float(getattr(b, "mp", 0) or 0)
    mr = float(getattr(b, "mr", 0) or 0)
    overall = {
        "map50": float(getattr(b, "map50", 0) or 0),
        "map5095": float(getattr(b, "map", 0) or 0),
        "precision": mp, "recall": mr,
        "f1": (2 * mp * mr / (mp + mr)) if (mp + mr) > 0 else 0.0,
    }

    val_dir = getattr(val, "save_dir", run_dir / "val")
    plots = {
        "confusionMatrix": find_plot(val_dir, "confusion_matrix.png"),
        "confusionMatrixNorm": find_plot(val_dir, "confusion_matrix_normalized.png"),
        "prCurve": find_plot(val_dir, "*PR_curve.png", "PR_curve.png"),
        "f1Curve": find_plot(val_dir, "*F1_curve.png", "F1_curve.png"),
        "pCurve": find_plot(val_dir, "*P_curve.png", "P_curve.png"),
        "rCurve": find_plot(val_dir, "*R_curve.png", "R_curve.png"),
    }

    print("PROGRESS 2/3 prediksi gambar", flush=True)
    preds = []
    src_dir = ds_dir / "images" / split
    try:
        results = model.predict(
            source=str(src_dir), save=True, project=str(run_dir), name="pred",
            conf=a.conf, iou=a.iou, imgsz=a.imgsz, verbose=False, exist_ok=True,
        )
        for r in results:
            dets = []
            if r.boxes is not None:
                for bx in r.boxes:
                    ci = int(bx.cls[0])
                    dets.append({"name": names.get(ci, str(ci)), "conf": float(bx.conf[0])})
            src = Path(r.path)
            saved = Path(r.save_dir) / src.name
            preds.append({
                "name": src.name,
                "image": str(saved.resolve()) if saved.exists() else str(src.resolve()),
                "detections": dets,
            })
    except Exception as e:
        print(f"[!] predict gagal: {e}", flush=True)

    result = {
        "split": split,
        "savedDir": str(run_dir.resolve()),
        "overall": overall,
        "perClass": per_class,
        "plots": plots,
        "predictions": preds,
        "generatedAt": stamp,
    }
    (run_dir / "results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print("PROGRESS 3/3 selesai", flush=True)
    print("EVAL_RESULT " + json.dumps(result), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[X] Evaluasi gagal: {e}", flush=True)
        sys.exit(1)
