"""
Wrapper untuk jalankan Label Studio dengan compatibility shim Python 3.14.

Python 3.14 menghapus pkgutil.find_loader() yang deprecated sejak 3.12.
Beberapa dependency Label Studio (environ, dll) masih pakai fungsi ini.
Kita re-inject implementasi minimal supaya library lama tetap jalan.
"""
import sys
import importlib.util
import pkgutil

# Shim untuk pkgutil.find_loader (dihapus di Python 3.14)
if not hasattr(pkgutil, "find_loader"):
    def find_loader(name):
        try:
            spec = importlib.util.find_spec(name)
            return spec.loader if spec is not None else None
        except (ImportError, AttributeError, ValueError):
            return None
    pkgutil.find_loader = find_loader

# Shim tambahan yang mungkin dibutuhkan
if not hasattr(pkgutil, "ImpImporter"):
    class ImpImporter:
        pass
    pkgutil.ImpImporter = ImpImporter

# Sekarang import & jalankan label-studio
try:
    from label_studio.server import main
except ImportError as e:
    print(f"[X] Label Studio tidak ter-install: {e}", file=sys.stderr)
    print("Install: pip install label-studio", file=sys.stderr)
    sys.exit(1)

if __name__ == "__main__":
    # Set args: default "start" kalau tidak ada
    if len(sys.argv) == 1:
        sys.argv.append("start")
    sys.exit(main() or 0)
