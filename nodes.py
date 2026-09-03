import json
import os
import threading

import folder_paths
from aiohttp import web
from server import PromptServer

from . import camera_engine
from . import installer

NODE_DIR = os.path.dirname(os.path.abspath(__file__))          # .../custom_nodes/h3-suite (this package's own root)
WORKFLOWS_DIR = os.path.join(NODE_DIR, "workflows")


class H3SuiteNode:
    """Empty backend node — the entire UI lives in web/h3_suite.js as a DOM widget.
    Nothing here runs during graph execution."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}, "hidden": {"unique_id": "UNIQUE_ID"}}

    RETURN_TYPES = ()
    FUNCTION = "noop"
    CATEGORY = "H3 Suite"
    OUTPUT_NODE = True

    def noop(self, **kwargs):
        return {}

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")


def _serve_json_file(path):
    async def handler(request):
        if not os.path.isfile(path):
            return web.json_response({"error": f"not found: {os.path.basename(path)}"}, status=404)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return web.json_response(data)
    return handler


def _serve_text_file(path):
    async def handler(request):
        if not os.path.isfile(path):
            return web.Response(text="", status=404)
        with open(path, "r", encoding="utf-8") as f:
            return web.Response(text=f.read(), content_type="text/plain")
    return handler


def _scan_models(folder_key, extensions=(".safetensors", ".ckpt", ".pt", ".pth")):
    """Recursively list model files ComfyUI already knows about for this category —
    covers both the default models/<category>/ folder and any extra path a user has
    registered for it via ComfyUI's extra_model_paths.yaml. This is how an existing
    MiniMax H3 model folder gets picked up without moving or re-downloading anything."""
    try:
        bases = folder_paths.get_folder_paths(folder_key)
    except Exception:
        return []
    found = []
    for base in bases:
        if not os.path.isdir(base):
            continue
        for root, _, files in os.walk(base):
            for fn in files:
                if any(fn.lower().endswith(e) for e in extensions):
                    found.append(os.path.relpath(os.path.join(root, fn), base))
    return sorted(found)


routes = PromptServer.instance.routes

routes.get("/h3suite/workflow_director")(_serve_json_file(os.path.join(WORKFLOWS_DIR, "h3_suite_director.json")))
routes.get("/h3suite/workflow_prompt_enhance")(_serve_json_file(os.path.join(WORKFLOWS_DIR, "h3_suite_prompt_enhance.json")))
routes.get("/h3suite/reference_map")(_serve_json_file(os.path.join(NODE_DIR, "reference_map.json")))
routes.get("/h3suite/prompt_system")(_serve_text_file(os.path.join(NODE_DIR, "prompt_engineer_system_prompt.md")))


@routes.get("/h3suite/models")
async def h3suite_models(request):
    return web.json_response({
        "diffusion_models": _scan_models("diffusion_models"),
        "text_encoders": _scan_models("text_encoders"),
        "vae": _scan_models("vae"),
    })


@routes.get("/h3suite/setup/status")
async def h3suite_setup_status(request):
    try:
        return web.json_response(installer.status())
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.get("/h3suite/setup/progress")
async def h3suite_setup_progress(request):
    return web.json_response(installer.get_progress())


@routes.post("/h3suite/setup/install")
async def h3suite_setup_install(request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    item_ids = body.get("items") or []
    if not isinstance(item_ids, list) or not item_ids:
        return web.json_response({"error": "expected non-empty 'items' list"}, status=400)

    def _worker():
        installer.install_items(item_ids)

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()
    return web.json_response({"started": True, "items": item_ids})


@routes.post("/h3suite/camera/render")
async def h3suite_camera_render(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON body"}, status=400)

    try:
        input_dir = folder_paths.get_input_directory()
        out_path, meta = camera_engine.render_camera_guide(
            duration=body.get("duration", 5),
            fps=24,
            resolution_preset=body.get("resolution_preset", "Fast Landscape (864x480)"),
            proxy_type=body.get("proxy_type", "Humanoid"),
            proxy_scale=body.get("proxy_scale", 1.0),
            interpolation=body.get("interpolation", "Smooth"),
            show_floor=bool(body.get("show_floor", True)),
            show_axes=bool(body.get("show_axes", False)),
            background=body.get("background", "Neutral"),
            keyframes=body.get("keyframes") or [],
            scene_objects=body.get("scene_objects") or [],
            out_dir=input_dir,
        )
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)

    return web.json_response({"filename": os.path.basename(out_path), "metadata": meta})


NODE_CLASS_MAPPINGS = {"H3SuiteNode": H3SuiteNode}
NODE_DISPLAY_NAME_MAPPINGS = {"H3SuiteNode": "H3 Suite"}
