"""
H3 Suite camera director engine.

A self-contained 3D camera previs renderer (originally based on the Previze
Bridge H3 Camera Director concept), with no ComfyUI node wrapper: this module
exposes plain functions callable directly from an aiohttp route, so the H3
Suite UI gets an instant camera-guide preview without going through the
ComfyUI graph/queue at all, and with no dependency on any other custom node.

Math (Catmull-Rom position/target interpolation, per-segment cubic-Bezier
easing, simple per-face-shaded perspective projection with global depth sort)
is self-contained pure Python/NumPy/PyAV.
"""

import json
import math
import os
import time
from fractions import Fraction

import numpy as np
from PIL import Image, ImageDraw

try:
    import av
except Exception:
    av = None

try:
    import folder_paths
except Exception:
    folder_paths = None

PRESETS = {
    "Fast Landscape (864x480)": (864, 480),
    "Fast Portrait (480x864)": (480, 864),
    "Test Landscape (960x544)": (960, 544),
    "Test Portrait (544x960)": (544, 960),
    "H3 Native Landscape (1344x768)": (1344, 768),
    "H3 Native Portrait (768x1344)": (768, 1344),
    "H3 4:3 Landscape (1024x768)": (1024, 768),
    "H3 3:4 Portrait (768x1024)": (768, 1024),
    "H3 Square (768x768)": (768, 768),
    "H3 Cinematic 21:9 (1536x672)": (1536, 672),
}

PROXY_TYPES = ["Humanoid", "Product Bottle", "Cube", "Sphere", "Cylinder", "Capsule"]

DEFAULT_POSE = {
    "time": 0.0,
    "position": [0.0, 1.85, 7.0],
    "target": [0.0, 1.65, 0.0],
    "fov": 42.0,
}

DEFAULT_EASE = [1.0 / 3.0, 1.0 / 3.0, 2.0 / 3.0, 2.0 / 3.0]


def _normalize_ease(ease):
    try:
        e = [float(x) for x in ease]
        if len(e) != 4:
            raise ValueError
    except Exception:
        e = list(DEFAULT_EASE)
    x1, y1, x2, y2 = e
    x1 = max(0.0, min(1.0, x1)); y1 = max(0.0, min(1.0, y1))
    x2 = max(0.0, min(1.0, x2)); y2 = max(0.0, min(1.0, y2))
    if x1 > x2:
        m = (x1 + x2) * 0.5
        x1 = x2 = m
    return [x1, y1, x2, y2]


def _bez1(t, a, b):
    mt = 1.0 - t
    return 3.0 * mt * mt * t * a + 3.0 * mt * t * t * b + t * t * t


def _bez1d(t, a, b):
    mt = 1.0 - t
    return 3.0 * mt * mt * a + 6.0 * mt * t * (b - a) + 3.0 * t * t * (1.0 - b)


def _ease_progress(u, ease):
    u = max(0.0, min(1.0, float(u)))
    x1, y1, x2, y2 = _normalize_ease(ease)
    if abs(x1 - y1) < 1e-6 and abs(x2 - y2) < 1e-6:
        return u
    t = u
    for _ in range(7):
        err = _bez1(t, x1, x2) - u
        der = _bez1d(t, x1, x2)
        if abs(err) < 1e-7 or abs(der) < 1e-8:
            break
        t = max(0.0, min(1.0, t - err / der))
    lo, hi = 0.0, 1.0
    for _ in range(14):
        x = _bez1(t, x1, x2)
        if abs(x - u) < 1e-7:
            break
        if x < u: lo = t
        else: hi = t
        t = (lo + hi) * 0.5
    return max(0.0, min(1.0, _bez1(t, y1, y2)))


def _normalize(v):
    v = np.asarray(v, dtype=np.float64)
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else np.array([0.0, 0.0, 1.0])


def _look_basis(cam, target):
    forward = _normalize(np.asarray(target) - np.asarray(cam))
    up_world = np.array([0.0, 1.0, 0.0], dtype=np.float64)
    right = _normalize(np.cross(forward, up_world))
    up = _normalize(np.cross(right, forward))
    return right, up, forward


def _catmull(p0, p1, p2, p3, t):
    p0, p1, p2, p3 = map(lambda x: np.asarray(x, dtype=np.float64), (p0, p1, p2, p3))
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def _interp(keys, t, field, smooth=True):
    if not keys:
        return np.asarray(DEFAULT_POSE[field], dtype=np.float64)
    if len(keys) == 1:
        return np.asarray(keys[0][field], dtype=np.float64)
    if t <= keys[0]["time"]:
        return np.asarray(keys[0][field], dtype=np.float64)
    if t >= keys[-1]["time"]:
        return np.asarray(keys[-1][field], dtype=np.float64)
    i = 0
    while i < len(keys) - 1 and t > keys[i + 1]["time"]:
        i += 1
    a, b = keys[i], keys[i + 1]
    u_raw = (t - a["time"]) / max(1e-9, b["time"] - a["time"])
    u = _ease_progress(u_raw, a.get("ease", DEFAULT_EASE))
    if not smooth or len(keys) < 3:
        return np.asarray(a[field], dtype=np.float64) * (1 - u) + np.asarray(b[field], dtype=np.float64) * u
    p0 = keys[max(0, i - 1)][field]
    p1 = a[field]
    p2 = b[field]
    p3 = keys[min(len(keys) - 1, i + 2)][field]
    return _catmull(p0, p1, p2, p3, u)


def _interp_scalar(keys, t, field, smooth=True):
    if not keys:
        return float(DEFAULT_POSE[field])
    vals = [float(k[field]) for k in keys]
    if len(keys) == 1:
        return vals[0]
    if t <= keys[0]["time"]:
        return vals[0]
    if t >= keys[-1]["time"]:
        return vals[-1]
    i = 0
    while i < len(keys) - 1 and t > keys[i + 1]["time"]:
        i += 1
    a, b = keys[i], keys[i + 1]
    u_raw = (t - a["time"]) / max(1e-9, b["time"] - a["time"])
    u = _ease_progress(u_raw, a.get("ease", DEFAULT_EASE))
    if not smooth or len(keys) < 3:
        return float(a[field]) * (1 - u) + float(b[field]) * u
    p0 = float(keys[max(0, i - 1)][field])
    p1 = float(a[field])
    p2 = float(b[field])
    p3 = float(keys[min(len(keys) - 1, i + 2)][field])
    v = 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)
    return max(15.0, min(90.0, v))


def _proxy_mesh(kind="Humanoid", scale=1.0):
    """Return vertices plus triangles carrying a base shade. +Z is FRONT."""
    verts = []
    tris = []

    def add_box(cx, cy, cz, sx, sy, sz, base=180, front_boost=False):
        start = len(verts)
        x0, x1 = cx - sx / 2, cx + sx / 2
        y0, y1 = cy - sy / 2, cy + sy / 2
        z0, z1 = cz - sz / 2, cz + sz / 2
        verts.extend([
            (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
            (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
        ])
        faces = [
            ((0, 1, 2), 0), ((0, 2, 3), 0),
            ((4, 6, 5), 1), ((4, 7, 6), 1),
            ((0, 4, 5), 2), ((0, 5, 1), 2),
            ((3, 2, 6), 3), ((3, 6, 7), 3),
            ((0, 3, 7), 4), ((0, 7, 4), 4),
            ((1, 5, 6), 5), ((1, 6, 2), 5),
        ]
        face_factor = [0.62, 1.12, 0.88, 1.03, 0.78, 0.84]
        for (a, b, c), fi in faces:
            factor = face_factor[fi]
            if front_boost and fi == 1:
                factor = 1.28
            elif front_boost and fi == 0:
                factor = 0.50
            tris.append((start + a, start + b, start + c, int(max(35, min(238, base * factor)))))

    def add_uv_sphere(cx, cy, cz, r, segments=10, rings=6, base=190):
        start = len(verts)
        for j in range(rings + 1):
            ph = math.pi * j / rings
            for i in range(segments):
                th = 2 * math.pi * i / segments
                verts.append((cx + r * math.sin(ph) * math.cos(th), cy + r * math.cos(ph), cz + r * math.sin(ph) * math.sin(th)))
        for j in range(rings):
            for i in range(segments):
                a = start + j * segments + i
                b = start + j * segments + (i + 1) % segments
                c = start + (j + 1) * segments + (i + 1) % segments
                d = start + (j + 1) * segments + i
                if j > 0:
                    tris.append((a, b, d, base))
                if j < rings - 1:
                    tris.append((b, c, d, base))

    def add_cyl(cx, cy, cz, r, h, segments=10, base=175):
        start = len(verts)
        for yy in (-h / 2, h / 2):
            for i in range(segments):
                th = 2 * math.pi * i / segments
                verts.append((cx + r * math.cos(th), cy + yy, cz + r * math.sin(th)))
        for i in range(segments):
            a = start + i
            b = start + (i + 1) % segments
            c = start + segments + (i + 1) % segments
            d = start + segments + i
            tris.append((a, b, c, base))
            tris.append((a, c, d, base))

    s = float(scale)
    if kind == "Cube":
        add_box(0, s / 2, 0, s, s, s, 180, True)
    elif kind == "Sphere":
        add_uv_sphere(0, s, 0, s * 0.55)
    elif kind == "Cylinder":
        add_cyl(0, s * 0.75, 0, s * 0.45, s * 1.5)
    elif kind == "Capsule":
        add_cyl(0, s, 0, s * 0.38, s * 1.25)
        add_uv_sphere(0, s * 1.63, 0, s * 0.38)
        add_uv_sphere(0, s * 0.37, 0, s * 0.38)
    elif kind == "Product Bottle":
        add_box(0, s * 0.72, 0, s * 0.78, s * 1.44, s * 0.48, 178, True)
        add_cyl(0, s * 1.56, 0, s * 0.23, s * 0.28, base=195)
        add_box(0, s * 0.78, s * 0.255, s * 0.50, s * 0.56, s * 0.04, 220, True)
    else:
        add_box(0, 2.18 * s, 0, 1.05 * s, 1.18 * s, 0.60 * s, 178, True)
        add_box(0, 1.48 * s, 0, 0.84 * s, 0.52 * s, 0.54 * s, 155, True)
        add_box(0, 2.87 * s, 0, 0.30 * s, 0.28 * s, 0.30 * s, 170, True)
        add_box(0, 3.32 * s, 0, 0.74 * s, 0.82 * s, 0.68 * s, 198, True)
        add_box(0, 3.32 * s, 0.45 * s, 0.18 * s, 0.18 * s, 0.24 * s, 224, True)
        add_box(0, 2.25 * s, 0.325 * s, 0.48 * s, 0.30 * s, 0.05 * s, 218, True)
        add_box(-0.69 * s, 2.05 * s, 0, 0.30 * s, 1.48 * s, 0.36 * s, 150, True)
        add_box(0.69 * s, 2.05 * s, 0, 0.30 * s, 1.48 * s, 0.36 * s, 150, True)
        add_box(-0.25 * s, 0.74 * s, 0, 0.37 * s, 1.48 * s, 0.44 * s, 138, True)
        add_box(0.25 * s, 0.74 * s, 0, 0.37 * s, 1.48 * s, 0.44 * s, 138, True)
        add_box(-0.25 * s, 0.10 * s, 0.17 * s, 0.43 * s, 0.20 * s, 0.72 * s, 126, True)
        add_box(0.25 * s, 0.10 * s, 0.17 * s, 0.43 * s, 0.20 * s, 0.72 * s, 126, True)
    return np.asarray(verts, dtype=np.float64), tris


def _transform_mesh(verts, position=(0, 0, 0), yaw_deg=0.0):
    v = np.asarray(verts, dtype=np.float64).copy()
    a = math.radians(float(yaw_deg))
    c, s = math.cos(a), math.sin(a)
    x = v[:, 0].copy(); z = v[:, 2].copy()
    v[:, 0] = x * c + z * s
    v[:, 2] = -x * s + z * c
    p = np.asarray(position, dtype=np.float64)
    if p.shape == (3,):
        v += p
    return v


def _normalize_scene_objects(raw, legacy_type, legacy_scale):
    objects = []
    if isinstance(raw, list):
        for i, obj in enumerate(raw):
            if not isinstance(obj, dict):
                continue
            try:
                kind = str(obj.get("type", "Humanoid"))
                if kind not in PROXY_TYPES:
                    kind = "Humanoid"
                pos = obj.get("position", [0, 0, 0])
                pos = [float(pos[j]) if j < len(pos) else 0.0 for j in range(3)]
                objects.append({
                    "id": str(obj.get("id", f"obj_{i+1}")),
                    "name": str(obj.get("name", f"Subject {i+1}"))[:64],
                    "type": kind,
                    "scale": max(0.25, min(4.0, float(obj.get("scale", 1.0)))),
                    "position": pos,
                    "yaw": float(obj.get("yaw", 0.0)) % 360.0,
                    "visible": bool(obj.get("visible", True)),
                })
            except Exception:
                pass
    if not objects:
        objects = [{
            "id": "legacy_subject_1", "name": "Subject 1", "type": legacy_type,
            "scale": float(legacy_scale), "position": [0.0, 0.0, 0.0], "yaw": 0.0, "visible": True,
        }]
    return objects


def _project(points, cam, target, fov_deg, w, h):
    right, up, forward = _look_basis(cam, target)
    pts = np.asarray(points, dtype=np.float64) - np.asarray(cam)
    x = pts @ right
    y = pts @ up
    z = pts @ forward
    f = 0.5 * h / math.tan(math.radians(fov_deg) / 2.0)
    good = z > 0.02
    sx = (w / 2) + (x * f / np.maximum(z, 0.02))
    sy = (h / 2) - (y * f / np.maximum(z, 0.02))
    return np.stack([sx, sy, z], axis=1), good


def _shade_tri(p0, p1, p2, base=185):
    e1 = p1 - p0
    e2 = p2 - p0
    area = float(e1[0] * e2[1] - e1[1] * e2[0])
    facing = min(1.0, abs(area) / max(1.0, np.linalg.norm(e1) * np.linalg.norm(e2)))
    return int(max(35, min(242, base * (0.72 + 0.28 * facing))))


def render_camera_guide(
    duration=5,
    fps=24,
    resolution_preset="Fast Landscape (864x480)",
    proxy_type="Humanoid",
    proxy_scale=1.0,
    interpolation="Smooth",
    show_floor=True,
    show_axes=False,
    background="Neutral",
    keyframes=None,
    scene_objects=None,
    out_dir=None,
):
    """Render an H3 camera guide MP4 and return (mp4_path, metadata_dict).

    Pure function — no ComfyUI graph execution involved. `keyframes` /
    `scene_objects` are already-parsed lists (JSON parsing happens in the
    caller so bad input can be reported as a clean HTTP error).
    """
    if av is None:
        raise RuntimeError("The 'av' package (PyAV) is required to render camera guides. Install it via the H3 Suite setup panel.")

    w, h = PRESETS.get(resolution_preset, PRESETS["Fast Landscape (864x480)"])
    duration = max(4, min(15, int(duration)))
    fps = 24

    explicit_keys = []
    for k in (keyframes or []):
        try:
            explicit_keys.append({
                "time": max(0.0, min(float(duration), float(k["time"]))),
                "position": [float(x) for x in k["position"]],
                "target": [float(x) for x in k["target"]],
                "fov": max(15.0, min(90.0, float(k.get("fov", 42.0)))),
                "ease": _normalize_ease(k.get("ease", DEFAULT_EASE)),
            })
        except Exception:
            pass
    explicit_keys = sorted(explicit_keys, key=lambda x: x["time"])
    render_keys = explicit_keys if explicit_keys else [dict(DEFAULT_POSE)]

    scene_list = _normalize_scene_objects(scene_objects or [], proxy_type, proxy_scale)
    scene_meshes = []
    for oi, obj in enumerate(scene_list):
        if not obj.get("visible", True):
            continue
        ov, ot = _proxy_mesh(obj["type"], obj["scale"])
        ov = _transform_mesh(ov, obj["position"], obj["yaw"])
        shade_offset = ((oi % 5) - 2) * 8
        ot2 = [(a, b, c, max(35, min(238, base + shade_offset))) for a, b, c, base in ot]
        scene_meshes.append((obj, ov, ot2))

    total = int(duration * fps)
    if out_dir is None:
        out_dir = folder_paths.get_temp_directory() if folder_paths is not None else os.path.join(os.getcwd(), "temp")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"h3suite_camera_{int(time.time()*1000)}_{os.getpid()}.mp4")

    container = av.open(out_path, mode="w", format="mp4")
    stream = container.add_stream("h264", rate=Fraction(int(fps), 1))
    stream.width = int(w)
    stream.height = int(h)
    stream.pix_fmt = "yuv420p"
    try:
        stream.options = {"preset": "ultrafast", "tune": "zerolatency", "crf": "28"}
    except Exception:
        pass

    try:
        for fi in range(total):
            t = fi / fps
            cam = _interp(render_keys, t, "position", interpolation == "Smooth")
            target = _interp(render_keys, t, "target", interpolation == "Smooth")
            fov = _interp_scalar(render_keys, t, "fov", interpolation == "Smooth")
            bg = (28, 28, 31) if background == "Dark" else ((245, 245, 245) if background == "White" else (72, 76, 82))
            img = Image.new("RGB", (w, h), bg)
            d = ImageDraw.Draw(img)

            if show_floor:
                for z in range(-8, 9, 2):
                    p, _ = _project([[-8, 0, z], [8, 0, z]], cam, target, fov, w, h)
                    if p[:, 2].min() > 0:
                        d.line([(int(p[0, 0]), int(p[0, 1])), (int(p[1, 0]), int(p[1, 1]))], fill=(80, 82, 88), width=max(1, w // 900))
                for x in range(-8, 9, 2):
                    p, _ = _project([[x, 0, -8], [x, 0, 8]], cam, target, fov, w, h)
                    if p[:, 2].min() > 0:
                        d.line([(int(p[0, 0]), int(p[0, 1])), (int(p[1, 0]), int(p[1, 1]))], fill=(80, 82, 88), width=max(1, w // 900))

            if show_axes:
                for a, col in [
                    ([[0, 0, 0], [2, 0, 0]], (200, 60, 60)),
                    ([[0, 0, 0], [0, 2, 0]], (60, 200, 80)),
                    ([[0, 0, 0], [0, 0, 2]], (220, 190, 70)),
                ]:
                    p, _ = _project(a, cam, target, fov, w, h)
                    if p[:, 2].min() > 0:
                        d.line([(int(p[0, 0]), int(p[0, 1])), (int(p[1, 0]), int(p[1, 1]))], fill=col, width=max(2, w // 500))

            tri_draw = []
            projected = []
            for oi, (obj, ov, ot) in enumerate(scene_meshes):
                pp, good = _project(ov, cam, target, fov, w, h)
                projected.append((obj, pp, good))
                for a, b, c, base in ot:
                    if good[a] and good[b] and good[c]:
                        tri_draw.append(((pp[a, 2] + pp[b, 2] + pp[c, 2]) / 3, oi, a, b, c, base))
            tri_draw.sort(reverse=True)
            for _, oi, a, b, c, base in tri_draw:
                pp = projected[oi][1]
                pts = [(int(pp[a, 0]), int(pp[a, 1])), (int(pp[b, 0]), int(pp[b, 1])), (int(pp[c, 0]), int(pp[c, 1]))]
                shade = _shade_tri(np.array(pts[0]), np.array(pts[1]), np.array(pts[2]), base=base)
                d.polygon(pts, fill=(shade, shade, shade), outline=(40, 40, 42))

            tp, _ = _project([target], cam, target, fov, w, h)
            if 0 <= tp[0, 0] < w and 0 <= tp[0, 1] < h:
                x, y = int(tp[0, 0]), int(tp[0, 1])
                r = max(3, w // 250)
                d.line((x - r, y, x + r, y), fill=(230, 190, 70), width=1)
                d.line((x, y - r, x, y + r), fill=(230, 190, 70), width=1)

            arr = np.asarray(img)
            frame = av.VideoFrame.from_ndarray(arr, format="rgb24")
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    finally:
        container.close()

    meta = {
        "name": "H3 Suite Camera Guide",
        "duration_seconds": float(duration),
        "fps": int(fps),
        "resolution": [w, h],
        "resolution_preset": resolution_preset,
        "proxy_type": proxy_type,
        "proxy_front_axis": "+Z",
        "scene_objects": scene_list,
        "scene_object_count": len(scene_list),
        "interpolation": interpolation,
        "user_keyframes": explicit_keys,
        "camera_behavior": "static_default" if not explicit_keys else ("static_custom" if len(explicit_keys) == 1 else "animated"),
        "purpose": "Camera-motion and framing reference for MiniMax H3 Video 2 / Camera Guide.",
    }
    return out_path, meta
