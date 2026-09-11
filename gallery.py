"""
H3 Suite library/gallery backend.

Scans this node's own ComfyUI output subfolder ("h3-suite/", matching the
SaveVideo filename_prefix baked into workflows/h3_suite_director.json)
directly off disk on every request — no separate manifest/database, the
filesystem plus one small JSON sidecar per video is the source of truth.

Adapted from the sibling one-node-flux-2-klein project's gallery backend,
trimmed for H3 Suite's video-only (.mp4) output: no PNG tEXt-chunk
embedding (not applicable to video files) and no per-generation-mode
restore branching (H3 Suite has a single generation mode).
"""

import glob
import json
import os
import platform
import subprocess
from pathlib import Path

import folder_paths

NODE_DIR = os.path.dirname(os.path.abspath(__file__))
SUBFOLDER = "h3-suite"


def _favorites_path():
    return os.path.join(NODE_DIR, "favorites.json")


def _load_favorites():
    path = _favorites_path()
    if not os.path.exists(path):
        return set()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return set(data) if isinstance(data, list) else set()
    except Exception:
        return set()


def _save_favorites(favset):
    path = _favorites_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(sorted(favset), f, ensure_ascii=False, indent=2)


def _favorites_add(filename):
    favs = _load_favorites()
    favs.add(filename)
    _save_favorites(favs)


def _favorites_remove(filename):
    favs = _load_favorites()
    favs.discard(filename)
    _save_favorites(favs)


def _get_output_dir():
    try:
        return str(Path(folder_paths.get_output_directory()).resolve())
    except Exception:
        return str(Path(os.path.join(os.path.dirname(NODE_DIR), "output")).resolve())


def _safe_resolve_output_path(output_dir, subfolder="", filename=""):
    """Resolve subfolder/filename under output_dir, refusing anything that
    escapes it (path traversal via '..' or an absolute path)."""
    base = Path(output_dir).resolve()
    target = base
    if subfolder:
        target = target / subfolder
    if filename:
        target = target / filename
    target = target.resolve()
    try:
        target.relative_to(base)
    except Exception:
        raise ValueError("invalid path")
    return str(target)


def _file_key(filename, subfolder=""):
    return f"{subfolder}/{filename}" if subfolder else filename


def _meta_dir(video_path):
    return os.path.join(os.path.dirname(video_path), "metadata")


def _meta_path(video_path):
    fname = os.path.splitext(os.path.basename(video_path))[0] + ".json"
    return os.path.join(_meta_dir(video_path), fname)


def _read_json_meta(video_path):
    mp = _meta_path(video_path)
    if not os.path.exists(mp):
        return None
    try:
        with open(mp, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception as e:
        print(f"[H3Suite] read_json_meta error: {e}")
        return None


def _write_json_meta(video_path, meta_dict):
    mp = _meta_path(video_path)
    tmp = mp + ".tmp"
    try:
        os.makedirs(os.path.dirname(mp), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(meta_dict, f, ensure_ascii=False, indent=2)
        os.replace(tmp, mp)
        return True
    except Exception as e:
        print(f"[H3Suite] write_json_meta error: {e}")
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except Exception:
                pass
        return False


def list_gallery(offset=0, limit=50, favonly=False):
    output_dir = _get_output_dir()
    subf_dir = os.path.normpath(_safe_resolve_output_path(output_dir, SUBFOLDER))

    if favonly:
        fav_names = _load_favorites()
        unique = []
        missing = set()
        for name in fav_names:
            p = os.path.join(subf_dir, name)
            if os.path.isfile(p):
                unique.append(p)
            else:
                missing.add(name)
        if missing:
            _save_favorites(fav_names - missing)
        unique.sort(key=os.path.getmtime, reverse=True)
        fav_set = fav_names
    else:
        unique = []
        if os.path.isdir(subf_dir):
            vids = glob.glob(os.path.join(subf_dir, "**", "*.mp4"), recursive=True)
            unique = sorted(set(vids), key=os.path.getmtime, reverse=True)
        fav_set = _load_favorites()

    total = len(unique)
    items = []
    for f in unique[offset:offset + limit]:
        rel = os.path.relpath(os.path.dirname(f), output_dir)
        fname = os.path.basename(f)
        subfolder = "" if rel == "." else rel
        items.append({
            "filename": fname,
            "subfolder": subfolder,
            "mtime": os.path.getmtime(f),
            "key": _file_key(fname, subfolder),
            "has_meta": os.path.exists(_meta_path(f)),
            "favorite": fname in fav_set,
        })
    return {"videos": items, "total": total, "offset": offset, "limit": limit}


def save_meta(filename, subfolder, meta):
    output_dir = _get_output_dir()
    vpath = _safe_resolve_output_path(output_dir, subfolder, filename)
    if not os.path.exists(vpath):
        return {"ok": False, "error": f"not found: {filename}"}
    ok = _write_json_meta(vpath, meta)
    return {"ok": ok, "filename": filename}


def update_meta(filename, subfolder, patch):
    output_dir = _get_output_dir()
    vpath = _safe_resolve_output_path(output_dir, subfolder, filename)
    if not os.path.exists(vpath):
        return {"ok": False, "error": "video not found"}
    existing = _read_json_meta(vpath) or {}
    existing.update(patch)
    ok = _write_json_meta(vpath, existing)
    if "favorite" in patch:
        if patch["favorite"] is True:
            _favorites_add(filename)
        else:
            _favorites_remove(filename)
    return {"ok": ok}


def get_meta(filename, subfolder):
    output_dir = _get_output_dir()
    vpath = _safe_resolve_output_path(output_dir, subfolder, filename)
    if not os.path.exists(vpath):
        return {"ok": False, "error": "video not found"}
    meta = _read_json_meta(vpath)
    if meta is None:
        return {"ok": False, "error": "no metadata"}
    return {"ok": True, "meta": meta}


def delete_entry(filename, subfolder):
    output_dir = _get_output_dir()
    vpath = _safe_resolve_output_path(output_dir, subfolder, filename)
    if not os.path.exists(vpath):
        return {"ok": False, "error": "file not found"}
    os.remove(vpath)
    mp = _meta_path(vpath)
    if os.path.exists(mp):
        try:
            os.remove(mp)
        except Exception:
            pass
    _favorites_remove(filename)
    return {"ok": True}


def reveal_in_explorer(filename, subfolder):
    output_dir = _get_output_dir()
    vpath = _safe_resolve_output_path(output_dir, subfolder, filename)
    if not os.path.exists(vpath):
        return {"ok": False, "error": "file not found"}
    system = platform.system()
    if system == "Windows":
        subprocess.Popen(["explorer", "/select,", vpath.replace("/", "\\")])
    elif system == "Darwin":
        subprocess.Popen(["open", "-R", vpath])
    else:
        subprocess.Popen(["xdg-open", os.path.dirname(vpath)])
    return {"ok": True}
