"""
Dependency detection + installation for H3 Suite.

Two tiers:
  - REQUIRED_REPOS / VENDOR_PACKAGE / REQUIRED_PIP: small, code-only, safe to
    run unattended from install.py on every ComfyUI (re)start of this node.
  - MODEL_FILES / OPTIONAL_REPOS / OPTIONAL_PIP: large and/or GPU-specific
    (~42GB of model weights, hash-pinned SageAttention/Triton wheels). These
    are only ever triggered by an explicit call from the H3 Suite Setup panel
    (POST /h3suite/setup/install), never automatically.

Every custom-node pack referenced here (H3-Multishot, KJNodes,
MiniMaxH3-FirstBlockCache) is treated as a black box: this module only
clones/extracts it and checks whether its folder exists. It never inspects
or reimplements the node classes inside. Video reference slots use
ComfyUI's own native LoadVideo + GetVideoComponents nodes, so no
VideoHelperSuite dependency is needed.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile

try:
    import folder_paths
except Exception:
    folder_paths = None

NODE_DIR = os.path.dirname(os.path.abspath(__file__))        # .../custom_nodes/h3-suite (this package's own root)
CUSTOM_NODES_DIR = os.path.dirname(NODE_DIR)                  # .../custom_nodes
VENDOR_DIR = os.path.join(NODE_DIR, "vendor")

REQUIRED_REPOS = [
    {
        "id": "h3_multishot",
        "label": "ComfyUI-H3-Multishot",
        "folder_name": "ComfyUI-H3-Multishot",
        "git_url": "https://github.com/jlucasmcrell/ComfyUI-H3-Multishot",
        "provides": ["H3ConditionStrength", "H3FreeTextEncoder"],
    },
]
# Video 1/2/3 reference slots use ComfyUI's own native LoadVideo + GetVideoComponents
# (same pattern already proven in workflows/video_h3_rv.json), so no VideoHelperSuite
# dependency is needed here.

OPTIONAL_REPOS = [
    {
        "id": "kjnodes",
        "label": "ComfyUI-KJNodes (SageAttention / Low-VRAM attention)",
        "folder_name": "ComfyUI-KJNodes",
        "git_url": "https://github.com/kijai/ComfyUI-KJNodes",
        "provides": ["PathchSageAttentionKJ", "MiniMaxLowVRAMAttention"],
    },
    {
        "id": "fbcache",
        "label": "ComfyUI-MiniMaxH3-FirstBlockCache",
        "folder_name": "ComfyUI-MiniMaxH3-FirstBlockCache",
        "git_url": "https://github.com/duckyshell/ComfyUI-MiniMaxH3-FirstBlockCache",
        "provides": ["ApplyMiniMaxH3FirstBlockCache"],
    },
]

VENDOR_PACKAGE = {
    "id": "exact_master_memory",
    "label": "ComfyUI-H3-ExactMasterMemory v0.4.3 (bundled)",
    "folder_name": "ComfyUI-H3-ExactMasterMemory",
    "zip_path": os.path.join(VENDOR_DIR, "ComfyUI-H3-ExactMasterMemory_v0.4.3.zip"),
    "provides": ["H3SemanticReferenceToVideo", "H3ResolutionPreset", "H3DurationPlanner", "H3TrimAVToFrames", "H3SourceEditAudioPriority"],
}

REQUIRED_PIP = ["av"]

MODEL_FILES = [
    {
        "id": "diffusion",
        "label": "MiniMax H3 REF2VA diffusion model",
        "filename": "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
        "category": "diffusion_models",
        "url": "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors",
    },
    {
        "id": "text_encoder",
        "label": "H3 text/vision encoder (Qwen3-VL 32B)",
        "filename": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
        "category": "text_encoders",
        "url": "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    },
    {
        "id": "video_vae",
        "label": "H3 video VAE",
        "filename": "minimax_h3_video_vae_fp16.safetensors",
        "category": "vae",
        "url": "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors",
    },
    {
        "id": "audio_vae",
        "label": "H3 audio VAE",
        "filename": "minimax_h3_audio_vae_fp32.safetensors",
        "category": "vae",
        "url": "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors",
    },
]

_progress = {}
_progress_lock = threading.Lock()


def _set_progress(item_id, **fields):
    with _progress_lock:
        entry = _progress.setdefault(item_id, {})
        entry.update(fields)
        entry["updated_at"] = time.time()


def get_progress():
    with _progress_lock:
        return json.loads(json.dumps(_progress))


def _repo_installed(repo):
    return os.path.isdir(os.path.join(CUSTOM_NODES_DIR, repo["folder_name"]))


def _model_path(entry):
    """Look for the exact canonical filename in every registered folder for this
    category — including any extra path a user has added via ComfyUI's
    extra_model_paths.yaml, not just the default models/<category>/ folder."""
    if folder_paths is not None:
        try:
            for base in folder_paths.get_folder_paths(entry["category"]):
                if not os.path.isdir(base):
                    continue
                for root, _, files in os.walk(base):
                    if entry["filename"] in files:
                        return os.path.join(root, entry["filename"])
        except Exception:
            pass
    return None


def status():
    """Report install status for every required/optional item, without changing anything."""
    required = []
    for repo in REQUIRED_REPOS:
        required.append({"id": repo["id"], "label": repo["label"], "kind": "custom_node", "ok": _repo_installed(repo)})
    required.append({
        "id": VENDOR_PACKAGE["id"], "label": VENDOR_PACKAGE["label"], "kind": "custom_node",
        "ok": os.path.isdir(os.path.join(CUSTOM_NODES_DIR, VENDOR_PACKAGE["folder_name"])),
    })
    for pkg in REQUIRED_PIP:
        required.append({"id": f"pip_{pkg}", "label": f"Python package: {pkg}", "kind": "pip", "ok": _pip_installed(pkg)})

    optional = []
    for repo in OPTIONAL_REPOS:
        optional.append({"id": repo["id"], "label": repo["label"], "kind": "custom_node", "ok": _repo_installed(repo)})
    for entry in MODEL_FILES:
        path = _model_path(entry)
        optional.append({
            "id": entry["id"], "label": entry["label"], "kind": "model", "ok": path is not None,
            "filename": entry["filename"], "category": entry["category"],
        })

    return {"required": required, "optional": optional, "progress": get_progress()}


def _pip_installed(pkg):
    try:
        __import__(pkg)
        return True
    except Exception:
        return False


def _run(cmd, item_id):
    _set_progress(item_id, state="running", detail=" ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        _set_progress(item_id, state="error", detail=(proc.stderr or proc.stdout)[-2000:])
        raise RuntimeError(f"Command failed ({item_id}): {' '.join(cmd)}\n{proc.stderr or proc.stdout}")
    _set_progress(item_id, state="done", detail="ok")


def install_repo(repo):
    dest = os.path.join(CUSTOM_NODES_DIR, repo["folder_name"])
    if os.path.isdir(dest):
        _set_progress(repo["id"], state="done", detail="already installed")
        return
    os.makedirs(CUSTOM_NODES_DIR, exist_ok=True)
    cmd = ["git", "clone", "--depth", "1", repo["git_url"], dest]
    _run(cmd, repo["id"])
    pinned = repo.get("commit")
    if pinned:
        subprocess.run(["git", "fetch", "--depth", "1", "origin", pinned], cwd=dest, capture_output=True, text=True)
        subprocess.run(["git", "checkout", pinned], cwd=dest, capture_output=True, text=True)


def install_vendor_package():
    item_id = VENDOR_PACKAGE["id"]
    dest = os.path.join(CUSTOM_NODES_DIR, VENDOR_PACKAGE["folder_name"])
    if os.path.isdir(dest):
        _set_progress(item_id, state="done", detail="already installed")
        return
    zip_path = VENDOR_PACKAGE["zip_path"]
    if not os.path.isfile(zip_path):
        _set_progress(item_id, state="error", detail=f"bundled zip missing: {zip_path}")
        raise RuntimeError(f"Bundled vendor zip missing: {zip_path}")
    _set_progress(item_id, state="running", detail="extracting bundled package")
    os.makedirs(CUSTOM_NODES_DIR, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(CUSTOM_NODES_DIR)
    _set_progress(item_id, state="done", detail="extracted")


def install_pip(pkg):
    item_id = f"pip_{pkg}"
    if _pip_installed(pkg):
        _set_progress(item_id, state="done", detail="already installed")
        return
    _run([sys.executable, "-m", "pip", "install", pkg], item_id)


def install_required(only_ids=None):
    """Install every required (small, code-only) dependency. Safe to call unattended."""
    errors = []
    for repo in REQUIRED_REPOS:
        if only_ids and repo["id"] not in only_ids:
            continue
        try:
            install_repo(repo)
        except Exception as e:
            errors.append(str(e))
    if not only_ids or VENDOR_PACKAGE["id"] in only_ids:
        try:
            install_vendor_package()
        except Exception as e:
            errors.append(str(e))
    for pkg in REQUIRED_PIP:
        if only_ids and f"pip_{pkg}" not in only_ids:
            continue
        try:
            install_pip(pkg)
        except Exception as e:
            errors.append(str(e))
    return errors


def install_optional_repo(item_id):
    for repo in OPTIONAL_REPOS:
        if repo["id"] == item_id:
            install_repo(repo)
            return
    raise ValueError(f"Unknown optional repo id: {item_id}")


def _download_with_resume(url, dest_path, item_id, expected_size=None):
    part_path = dest_path + ".part"
    existing = os.path.getsize(part_path) if os.path.isfile(part_path) else 0
    req = urllib.request.Request(url)
    if existing:
        req.add_header("Range", f"bytes={existing}-")
    with urllib.request.urlopen(req, timeout=60) as resp:
        total = resp.length if resp.length is not None else expected_size
        if total is not None:
            total += existing
        mode = "ab" if existing else "wb"
        downloaded = existing
        with open(part_path, mode) as f:
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                pct = (downloaded / total * 100.0) if total else None
                _set_progress(item_id, state="running", bytes_done=downloaded, bytes_total=total,
                               percent=round(pct, 1) if pct is not None else None)
    os.replace(part_path, dest_path)


def install_model(item_id):
    entry = next((m for m in MODEL_FILES if m["id"] == item_id), None)
    if entry is None:
        raise ValueError(f"Unknown model id: {item_id}")
    if _model_path(entry) is not None:
        _set_progress(item_id, state="done", detail="already present")
        return
    if folder_paths is None:
        raise RuntimeError("folder_paths is not available (not running inside ComfyUI).")
    targets = folder_paths.get_folder_paths(entry["category"])
    if not targets:
        raise RuntimeError(f"No model folder registered for category '{entry['category']}'.")
    dest_dir = targets[0]
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, entry["filename"])
    _set_progress(item_id, state="running", detail=f"downloading to {dest_path}")
    try:
        _download_with_resume(entry["url"], dest_path, item_id)
    except Exception as e:
        _set_progress(item_id, state="error", detail=str(e))
        raise
    _set_progress(item_id, state="done", detail="downloaded")


def install_items(item_ids):
    """Install an arbitrary mix of required/optional repo ids, pip ids and model ids.
    Runs sequentially in the calling thread — callers should run this in a background thread."""
    errors = []
    all_repo_ids = {r["id"]: r for r in (REQUIRED_REPOS + OPTIONAL_REPOS)}
    for item_id in item_ids:
        try:
            if item_id in all_repo_ids:
                install_repo(all_repo_ids[item_id])
            elif item_id == VENDOR_PACKAGE["id"]:
                install_vendor_package()
            elif item_id.startswith("pip_"):
                install_pip(item_id[len("pip_"):])
            elif item_id in {m["id"] for m in MODEL_FILES}:
                install_model(item_id)
            else:
                errors.append(f"Unknown item id: {item_id}")
        except Exception as e:
            errors.append(f"{item_id}: {e}")
    return errors
