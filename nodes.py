import json
import os
import threading

import folder_paths
from aiohttp import web
from server import PromptServer

from . import camera_engine
from . import gallery
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


class H3SaveAVLatent:
    """Drop-in replacement for the core SaveLatent node that also understands
    MiniMax H3's joint audio+video latent (a torch NestedTensor of
    [video, audio] — see ComfyUI-H3-ExactMasterMemory's _lock_audio_latent).
    Core SaveLatent crashes on that shape with
    'NestedTensor' object has no attribute 'contiguous' because
    safetensors can only serialize plain dense tensors. Here we unbind the
    nested tensor into its two component tensors first (and its noise_mask
    counterpart, if any) and store them as separate safetensors keys, so a
    later H3LoadAVLatent can rebuild the exact same NestedTensor. A plain
    (non-AV, e.g. image/video-only) latent is saved exactly like core
    SaveLatent, unchanged, so this node is safe to use everywhere SaveLatent
    was used before."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"samples": ("LATENT",), "filename_prefix": ("STRING", {"default": "ComfyUI"})},
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "H3 Suite"

    def save(self, samples, filename_prefix="ComfyUI", prompt=None, extra_pnginfo=None):
        import torch
        import comfy.utils

        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
            filename_prefix, folder_paths.get_output_directory()
        )

        prompt_info = json.dumps(prompt) if prompt is not None else ""
        metadata = None
        from comfy.cli_args import args as comfy_args
        if not comfy_args.disable_metadata:
            metadata = {"prompt": prompt_info}
            if extra_pnginfo is not None:
                for x in extra_pnginfo:
                    metadata[x] = json.dumps(extra_pnginfo[x])

        s = samples.get("samples")
        is_av = bool(getattr(s, "is_nested", False))

        output = {}
        if is_av:
            parts = list(s.unbind())
            if len(parts) < 2:
                raise ValueError("H3SaveAVLatent: expected a joint [video, audio] AV latent, got a nested tensor with fewer than 2 parts.")
            output["video_tensor"] = parts[0].contiguous()
            output["audio_tensor"] = parts[1].contiguous()
            nm = samples.get("noise_mask")
            if nm is not None and getattr(nm, "is_nested", False):
                nm_parts = list(nm.unbind())
                output["video_mask"] = nm_parts[0].contiguous()
                output["audio_mask"] = nm_parts[1].contiguous()
            output["is_av_latent"] = torch.tensor([1])
        else:
            output["latent_tensor"] = s.contiguous()
            output["is_av_latent"] = torch.tensor([0])
        output["latent_format_version_0"] = torch.tensor([])

        file = f"{filename}_{counter:05}_.latent"
        comfy.utils.save_torch_file(output, os.path.join(full_output_folder, file), metadata=metadata)

        results = [{"filename": file, "subfolder": subfolder, "type": "output"}]
        return {"ui": {"latents": results}, "result": (samples,)}


class H3LoadAVLatent:
    """Drop-in replacement for the core LoadLatent node that also understands
    the joint audio+video latent H3SaveAVLatent writes — rebuilds the same
    torch NestedTensor([video, audio]) so downstream nodes that expect one
    (e.g. LTXVSeparateAVLatent) keep working unchanged. A plain (non-AV)
    file saved by core SaveLatent or H3SaveAVLatent still loads exactly like
    core LoadLatent."""

    SEARCH_ALIASES = ["import latent", "open latent", "h3 load latent"]

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        try:
            files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f)) and f.endswith(".latent")]
        except Exception:
            files = []
        return {"required": {"latent": (sorted(files),)}}

    CATEGORY = "H3 Suite"
    RETURN_TYPES = ("LATENT",)
    FUNCTION = "load"

    def load(self, latent):
        import safetensors.torch
        import comfy.nested_tensor

        latent_path = folder_paths.get_annotated_filepath(latent)
        data = safetensors.torch.load_file(latent_path, device="cpu")
        multiplier = 1.0 if "latent_format_version_0" in data else (1.0 / 0.18215)

        is_av = bool(data.get("is_av_latent", None) is not None and int(data["is_av_latent"][0]) == 1)
        if is_av:
            video = data["video_tensor"].float() * multiplier
            audio = data["audio_tensor"].float() * multiplier
            out = {"samples": comfy.nested_tensor.NestedTensor((video, audio))}
            if "video_mask" in data and "audio_mask" in data:
                out["noise_mask"] = comfy.nested_tensor.NestedTensor((data["video_mask"], data["audio_mask"]))
        else:
            out = {"samples": data["latent_tensor"].float() * multiplier}
        return (out,)

    @classmethod
    def IS_CHANGED(cls, latent):
        import hashlib
        image_path = folder_paths.get_annotated_filepath(latent)
        m = hashlib.sha256()
        with open(image_path, "rb") as f:
            m.update(f.read())
        return m.digest().hex()

    @classmethod
    def VALIDATE_INPUTS(cls, latent):
        if not folder_paths.exists_annotated_filepath(latent):
            return "Invalid latent file: {}".format(latent)
        return True


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
routes.get("/h3suite/workflow_motion_guide")(_serve_json_file(os.path.join(WORKFLOWS_DIR, "h3_suite_motion_guide.json")))
routes.get("/h3suite/reference_map")(_serve_json_file(os.path.join(NODE_DIR, "reference_map.json")))
routes.get("/h3suite/prompt_system")(_serve_text_file(os.path.join(NODE_DIR, "prompt_engineer_system_prompt.md")))


@routes.get("/h3suite/models")
async def h3suite_models(request):
    return web.json_response({
        "diffusion_models": _scan_models("diffusion_models"),
        "text_encoders": _scan_models("text_encoders"),
        "vae": _scan_models("vae"),
        "loras": _scan_models("loras"),
        "latent_upscale_models": _scan_models("latent_upscale_models"),
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


@routes.get("/h3suite/gallery")
async def h3suite_gallery(request):
    try:
        offset = max(0, int(request.query.get("offset", 0)))
    except Exception:
        offset = 0
    try:
        limit = min(max(1, int(request.query.get("limit", 50))), 200)
    except Exception:
        limit = 50
    favonly = request.query.get("favonly", "0") == "1"
    try:
        return web.json_response(gallery.list_gallery(offset, limit, favonly))
    except ValueError:
        return web.json_response({"error": "invalid subfolder"}, status=400)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@routes.post("/h3suite/save_meta")
async def h3suite_save_meta(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "invalid JSON body"}, status=400)
    filename = body.get("filename", "")
    if not filename:
        return web.json_response({"ok": False, "error": "no filename"}, status=400)
    try:
        return web.json_response(gallery.save_meta(filename, body.get("subfolder", ""), body.get("meta") or {}))
    except ValueError:
        return web.json_response({"ok": False, "error": "invalid path"}, status=400)
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@routes.post("/h3suite/update_meta")
async def h3suite_update_meta(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "invalid JSON body"}, status=400)
    filename = body.get("filename", "")
    patch = body.get("patch")
    if not filename or not isinstance(patch, dict):
        return web.json_response({"ok": False, "error": "bad request"}, status=400)
    try:
        return web.json_response(gallery.update_meta(filename, body.get("subfolder", ""), patch))
    except ValueError:
        return web.json_response({"ok": False, "error": "invalid path"}, status=400)
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@routes.get("/h3suite/meta")
async def h3suite_meta(request):
    filename = request.query.get("filename", "")
    if not filename:
        return web.json_response({"ok": False, "error": "no filename"}, status=400)
    try:
        return web.json_response(gallery.get_meta(filename, request.query.get("subfolder", "")))
    except ValueError:
        return web.json_response({"ok": False, "error": "invalid path"}, status=400)
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@routes.post("/h3suite/open_folder")
async def h3suite_open_folder(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "invalid JSON body"}, status=400)
    filename = body.get("filename", "")
    if not filename:
        return web.json_response({"ok": False, "error": "no filename"}, status=400)
    try:
        return web.json_response(gallery.reveal_in_explorer(filename, body.get("subfolder", "")))
    except ValueError:
        return web.json_response({"ok": False, "error": "invalid path"}, status=400)
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


@routes.post("/h3suite/delete")
async def h3suite_delete(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "invalid JSON body"}, status=400)
    filename = body.get("filename", "")
    if not filename:
        return web.json_response({"ok": False, "error": "filename required"}, status=400)
    try:
        return web.json_response(gallery.delete_entry(filename, body.get("subfolder", "")))
    except ValueError:
        return web.json_response({"ok": False, "error": "invalid path"}, status=400)
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=500)


NODE_CLASS_MAPPINGS = {
    "H3SuiteNode": H3SuiteNode,
    "H3SaveAVLatent": H3SaveAVLatent,
    "H3LoadAVLatent": H3LoadAVLatent,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "H3SuiteNode": "H3 Suite",
    "H3SaveAVLatent": "Save Latent (H3 AV-aware)",
    "H3LoadAVLatent": "Load Latent (H3 AV-aware)",
}
