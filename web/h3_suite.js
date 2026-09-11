import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { createCameraViewport } from "./camera/viewport.js";

// ── Palette / helpers ─────────────────────────────────────────────────────
const LIME = "#f0ff41";
const C = {
  lime: LIME, bg0: "#0b0b0b", bg1: "#111111", bg2: "#181818",
  bg3: "#222222", border: "#2a2a2a", borderH: "#3c3c3c",
  text: "#dedede", muted: "#565656", dim: "#2e2e2e",
  warn: "#ffb347", err: "#ff6767", ok: "#5ee88a",
};
const NODE_W = 1020;
const NODE_H = 760;
const LS_KEY = "h3_suite_state";

const mk = (tag, css = {}, props = {}) => { const e = document.createElement(tag); Object.assign(e.style, css); Object.assign(e, props); return e; };
const tx = (e, t) => { e.textContent = t; return e; };
const cap = (t) => tx(mk("div", { fontSize: "9px", fontWeight: "700", letterSpacing: ".1em", textTransform: "uppercase", color: C.muted, marginBottom: "5px" }), t);
// Sentence-case helper text — cap() is uppercase+tracked and turns anything
// longer than a couple of words into an unreadable block.
const note = (t) => tx(mk("div", { fontSize: "10px", color: C.muted, lineHeight: "1.5" }), t);
// Framed section container, so groups of controls read as blocks instead of
// floating in the panel.
function card(title) {
  const box = mk("div", {
    display: "flex", flexDirection: "column", gap: "8px", padding: "10px 12px",
    border: `1px solid ${C.border}`, borderRadius: "10px", background: C.bg1, boxSizing: "border-box",
  });
  if (title) { const h = cap(title); h.style.marginBottom = "0"; box.appendChild(h); }
  return box;
}
// Toggle() is styled for a stacked settings list (full-width, underlined);
// this strips that chrome so it can sit inline next to other controls.
function compactToggle(t) {
  t.el.style.borderBottom = "none";
  t.el.style.padding = "2px 0";
  t.el.style.justifyContent = "flex-start";
  t.el.style.gap = "8px";
  return t;
}
function fmtErr(v) {
  try {
    if (!v) return "Unknown error.";
    if (typeof v === "string") return v;
    if (v.message) return String(v.message);
    if (v.error) return typeof v.error === "string" ? v.error : (v.error.message || JSON.stringify(v.error));
    return JSON.stringify(v);
  } catch (e) { return String(v); }
}
function loadState() { try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch (e) { return {}; } }
function saveState(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch (e) { } }

// ── Cross-directory file refs (ComfyUI's "annotated path" convention) ──────
// A reference the user uploads always lands in ComfyUI's input/ folder, and a
// bare filename is enough for LoadImage/LoadVideo/LoadAudio to find it. But a
// file a *pipeline* produced (e.g. the Motion Director's rendered guide) is
// saved under output/, and those native Load* nodes only browse input/ by
// default — passing them a bare output-folder filename fails prompt
// validation ("value not in list" / "Invalid video file"). ComfyUI's own
// fix for this is the "name [output]"/"name [temp]" annotated-path suffix
// (folder_paths.annotated_filepath on the backend); these two helpers build
// and parse that same convention on the client side.
function annotatedRef(file) {
  const parts = [];
  if (file.subfolder) parts.push(file.subfolder.replace(/\\/g, "/"));
  parts.push(file.filename);
  const rel = parts.join("/");
  return file.type && file.type !== "input" ? `${rel} [${file.type}]` : rel;
}
function parseAnnotatedRef(ref) {
  const m = /^(.*) \[(input|output|temp)\]$/.exec(ref || "");
  const rest = m ? m[1] : (ref || "");
  const type = m ? m[2] : "input";
  const idx = rest.lastIndexOf("/");
  return idx >= 0 ? { filename: rest.slice(idx + 1), subfolder: rest.slice(0, idx), type } : { filename: rest, subfolder: "", type };
}

function Toggle(labelTxt, checked, onChange) {
  const wrap = mk("div", { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.border}` });
  const lbl = mk("span", { fontSize: "11px", color: C.text }); tx(lbl, labelTxt);
  const track = mk("div", { width: "32px", height: "17px", borderRadius: "9px", background: checked ? LIME : C.dim, cursor: "pointer", position: "relative", transition: "background .2s", flexShrink: "0" });
  const thumb = mk("div", { position: "absolute", top: "2px", left: checked ? "16px" : "2px", width: "13px", height: "13px", borderRadius: "50%", background: checked ? "#111" : "#888", transition: "left .2s" });
  track.appendChild(thumb);
  let val = checked;
  const apply = () => { track.style.background = val ? LIME : C.dim; thumb.style.left = val ? "16px" : "2px"; thumb.style.background = val ? "#111" : "#888"; };
  track.onclick = () => { val = !val; apply(); onChange(val); };
  wrap.append(lbl, track);
  return { el: wrap, get value() { return val; }, setValue(v) { val = v; apply(); } };
}

function Select(labelTxt, options, value, onChange) {
  const wrap = mk("div", { display: "flex", flexDirection: "column", gap: "3px" });
  if (labelTxt) wrap.appendChild(cap(labelTxt));
  const sel = mk("select", {
    background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px",
    padding: "6px 8px", fontSize: "11px", outline: "none", cursor: "pointer",
  });
  options.forEach(o => {
    const opt = mk("option", {}, { value: typeof o === "string" ? o : o.value });
    opt.textContent = typeof o === "string" ? o : o.label;
    sel.appendChild(opt);
  });
  sel.value = value;
  sel.onchange = () => onChange(sel.value);
  wrap.appendChild(sel);
  return { el: wrap, sel, get value() { return sel.value; }, setValue(v) { sel.value = v; } };
}

function NumberField(labelTxt, value, min, max, step, onChange) {
  const wrap = mk("div", { display: "flex", flexDirection: "column", gap: "3px" });
  if (labelTxt) wrap.appendChild(cap(labelTxt));
  const inp = mk("input", {
    background: C.bg2, color: C.text, border: `1px solid ${C.border}`, borderRadius: "6px",
    padding: "6px 8px", fontSize: "11px", outline: "none", width: "100%", boxSizing: "border-box",
  }, { type: "number", value, min, max, step });
  inp.onchange = () => onChange(parseFloat(inp.value));
  wrap.appendChild(inp);
  return { el: wrap, inp, get value() { return parseFloat(inp.value); }, setValue(v) { inp.value = v; } };
}

function mkRmBtn() {
  const rm = mk("button", {
    position: "absolute", top: "3px", right: "3px", width: "16px", height: "16px",
    borderRadius: "50%", border: "none", background: "rgba(0,0,0,.6)", color: "#fff",
    display: "none", alignItems: "center", justifyContent: "center", cursor: "pointer",
    fontSize: "11px", lineHeight: "1", padding: "0", zIndex: "2",
  });
  tx(rm, "×");
  return rm;
}

// ── Generic media upload slot (image/video/audio) ───────────────────────────
function MediaSlot(kind, labelTxt, tooltip, onFile, size = 62) {
  const accept = kind === "image" ? "image/*" : kind === "video" ? "video/*" : "audio/*";
  const wrap = mk("div", {
    width: size + "px", height: size + "px", borderRadius: "10px", border: `1.5px dashed ${C.border}`,
    background: C.bg2, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    cursor: "pointer", position: "relative", overflow: "hidden", flexShrink: "0", boxSizing: "border-box",
    transition: "border-color .15s,background .15s",
  });
  const baseTitle = tooltip || labelTxt || "";
  wrap.title = baseTitle;
  const icoWrap = mk("div", { position: "absolute", inset: "0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", pointerEvents: "none", padding: "4px" });
  const glyph = mk("div", { fontSize: Math.round(size * 0.26) + "px", color: C.muted }); tx(glyph, kind === "image" ? "\u{1F5BC}" : kind === "video" ? "\u{1F3A5}" : "\u{1F3B5}");
  const lbl = mk("div", { fontSize: "7px", color: C.muted, textAlign: "center", lineHeight: "1.15", letterSpacing: ".02em" }); tx(lbl, labelTxt || "");
  icoWrap.append(glyph, lbl);

  // Image/video kinds get a real thumbnail (the actual uploaded frame/picture)
  // instead of just the filename as text — audio has no meaningful visual, so
  // it keeps the plain filename label.
  let thumbEl = null, thumbWrap = null;
  if (kind === "image") {
    thumbEl = mk("img", { width: "100%", height: "100%", objectFit: "cover", display: "block" });
  } else if (kind === "video") {
    thumbEl = mk("video", { width: "100%", height: "100%", objectFit: "cover", display: "block" }, { muted: true, playsinline: true, preload: "metadata" });
    thumbEl.addEventListener("loadedmetadata", () => { try { thumbEl.currentTime = Math.min(0.1, thumbEl.duration || 0); } catch (e) { } });
  }
  if (thumbEl) {
    thumbWrap = mk("div", { position: "absolute", inset: "0", display: "none" });
    thumbWrap.appendChild(thumbEl);
  }

  const fileLbl = mk("div", { position: "absolute", inset: "0", display: "none", alignItems: "center", justifyContent: "center", padding: "4px", boxSizing: "border-box", textAlign: "center" });
  const fileName = mk("div", { fontSize: "7px", color: LIME, wordBreak: "break-all", lineHeight: "1.2", maxHeight: (size - 14) + "px", overflow: "hidden" });
  fileLbl.appendChild(fileName);

  const rm = mkRmBtn();
  const inp = mk("input", { display: "none" }, { type: "file", accept });
  wrap.append(icoWrap, fileLbl, ...(thumbWrap ? [thumbWrap] : []), rm, inp);

  wrap.onmouseenter = () => { wrap.style.borderColor = LIME; };
  wrap.onmouseleave = () => { wrap.style.borderColor = C.border; };
  wrap.onclick = () => inp.click();

  let _name = null;
  const _showLoaded = (fname) => {
    icoWrap.style.display = "none"; rm.style.display = "flex"; wrap.style.borderColor = LIME;
    wrap.title = baseTitle ? `${baseTitle}\n${fname}` : fname;
    if (thumbEl) {
      fileLbl.style.display = "none";
      thumbWrap.style.display = "block";
      const { filename, subfolder, type } = parseAnnotatedRef(fname);
      thumbEl.src = api.apiURL(`/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}&t=${Date.now()}`);
    } else {
      fileLbl.style.display = "flex";
      tx(fileName, fname);
    }
  };

  const _load = async (file) => {
    // Don't point the thumbnail at the upload's filename yet — /upload/image
    // hasn't written it to disk until the request resolves, and requesting
    // /view a moment too early leaves the <img>/<video> permanently broken
    // (no automatic retry once it 404s).
    icoWrap.style.display = "none"; if (thumbWrap) thumbWrap.style.display = "none";
    fileLbl.style.display = "flex"; tx(fileName, "Uploading…"); wrap.style.borderColor = LIME;
    const fd = new FormData(); fd.append("image", file); fd.append("overwrite", "true");
    try {
      const r = await api.fetchApi("/upload/image", { method: "POST", body: fd });
      const d = await r.json(); _name = d.name || file.name;
    } catch (err) { _name = file.name; }
    _showLoaded(_name);
    onFile(_name);
  };
  inp.onchange = () => { if (inp.files[0]) _load(inp.files[0]); };
  rm.onclick = (e) => {
    e.stopPropagation();
    fileLbl.style.display = "none"; rm.style.display = "none"; icoWrap.style.display = "flex";
    wrap.style.borderColor = C.border; wrap.title = baseTitle; inp.value = ""; _name = null;
    if (thumbEl) { thumbWrap.style.display = "none"; thumbEl.src = ""; }
    onFile(null);
  };

  const setName = (name) => { if (!name) { _name = null; return; } _name = name; _showLoaded(name); };

  return { el: wrap, get name() { return _name; }, hasFile() { return !!_name; }, setName };
}

// ── Camera guide preview player ──────────────────────────────────────────────
// height: a pixel number, or "fill" to take the remaining height of a flex column.
function VideoPreview(height = 230) {
  const sizing = height === "fill"
    ? { flex: "1", minHeight: "0" }
    : { height: height + "px", flexShrink: "0" };
  const wrap = mk("div", {
    width: "100%", background: "#000", borderRadius: "8px",
    overflow: "hidden", display: "none", position: "relative", ...sizing,
  });
  const vid = mk("video", { width: "100%", height: "100%", display: "block", objectFit: "contain" }, { controls: true, loop: true, muted: false });
  const fsBtn = mk("button", {
    position: "absolute", top: "8px", right: "8px", width: "22px", height: "22px",
    borderRadius: "50%", background: "rgba(0,0,0,.65)", border: `1px solid ${C.border}`,
    color: "rgba(255,255,255,.8)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    padding: "0", zIndex: "2", outline: "none", transition: "border-color .15s,color .15s",
  });
  fsBtn.title = "Fullscreen";
  fsBtn.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
  fsBtn.onmouseenter = () => { fsBtn.style.borderColor = LIME; fsBtn.style.color = LIME; };
  fsBtn.onmouseleave = () => { fsBtn.style.borderColor = C.border; fsBtn.style.color = "rgba(255,255,255,.8)"; };
  fsBtn.onclick = (e) => { e.stopPropagation(); if (vid.requestFullscreen) vid.requestFullscreen().catch(() => { }); };
  wrap.append(vid, fsBtn);
  return {
    el: wrap,
    show(url) { vid.src = url; wrap.style.display = "block"; },
    hide() { wrap.style.display = "none"; vid.src = ""; },
  };
}

// ── State ─────────────────────────────────────────────────────────────────────
const DEFAULTS = () => ({
  prompt: "",
  pics: {}, // key -> filename
  vids: {}, // key -> filename
  auds: {}, // key -> filename
  resolutionPreset: "H3 Native Landscape (1344x768)",
  duration: 6,
  steps: 20,
  seed: 123456789,
  randomizeSeed: false,
  visualStrength: 0.999,
  audioStrength: 1.0,
  wardrobeCrop: 18,
  models: { unet: null, clip: null, vae_video: null, vae_audio: null }, // null = use the canonical filename baked into the workflow
  loras: [
    { enabled: false, name: null, strength: 1.0 },
    { enabled: false, name: null, strength: 1.0 },
    { enabled: false, name: null, strength: 1.0 },
  ],
  fbcache: true,
  fbcacheMode: "H3 Safe — 0.08 / max 2",
  sage: true,
  solattn: false,
  solattnMode: "Balanced — tau 1.3",
  lowvram: false,
  headChunks: 4,
  upscale: false,
  upscaleModel: null, // null = use UPSCALE_CANONICAL_MODEL
  upscaleMultiplier: 1.5,
  upscalePass2Steps: 4,
  derope: false,
  deropeSteps: 6,
  deropeInject: 0.70,
  deropeQ: 0.75,
  deropeDMax: 4,
  camera: { duration: 5, resolution_preset: "Fast Landscape (864x480)", proxy_type: "Humanoid", proxy_scale: 1.0, interpolation: "Smooth", show_floor: true, show_axes: false, background: "Neutral", keyframes: [] },
});

const RES_PRESETS = [
  "Fast Landscape (864x480)", "Fast Portrait (480x864)", "Test Landscape (960x544)", "Test Portrait (544x960)",
  "H3 Native Landscape (1344x768)", "H3 Native Portrait (768x1344)", "H3 4:3 Landscape (1024x768)",
  "H3 3:4 Portrait (768x1024)", "H3 Square (768x768)", "H3 Cinematic 21:9 (1536x672)",
];
const FBCACHE_MODES = ["H3 Safe — 0.08 / max 2", "H3 Fast — 0.10 / max 2", "H3 Aggressive — 0.12 / max 2", "Custom — manual values"];
const SOLATTN_MODES = ["Balanced — tau 1.3", "Fast — tau 1.6", "Max — tau 2.0 + int8"];
const SOLATTN_PARAMS = {
  "Balanced — tau 1.3": { tau: 1.3, int8_qk: false, int8_pv: false },
  "Fast — tau 1.6": { tau: 1.6, int8_qk: false, int8_pv: false },
  "Max — tau 2.0 + int8": { tau: 2.0, int8_qk: true, int8_pv: true },
};
const UPSCALE_CANONICAL_MODEL = "minimax_h3_latent_upscaler_3d_bf16.safetensors";
const CANONICAL_MODELS = {
  unet: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  clip: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  vae_video: "minimax_h3_video_vae_fp16.safetensors",
  vae_audio: "minimax_h3_audio_vae_fp32.safetensors",
};
// "Otimizado" preset — the exact model/config combo validated by hand in the
// "best minimax qt" workflow (Model Loaders + Pass 1 + Pass 2 groups): MiniMax
// H3 Hybrid unet, the 768p ref2v turbo LoRA at full strength, Fast Landscape
// (864x480/0.4MP), and — for the upscale variant — the fp16 3D latent
// upscaler at 2x with an 8+4 step split (Pass 1 8 steps, Pass 2 refine 4).
const OTIMIZADO_CONFIG = {
  models: {
    unet: "minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors",
    clip: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    vae_video: "minimax_h3_video_vae_int8_convrot.safetensors",
    vae_audio: "minimax_h3_audio_vae_fp32.safetensors",
  },
  lora: { name: "minimax_h3_ref2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors", strength: 1.0 },
  resolutionPreset: "Fast Landscape (864x480)",
  steps: 8,
  upscale: { model: "minimax_h3_latent_upscaler_3d_fp16.safetensors", multiplier: 2, pass2Steps: 4 },
};
const CAMERA_PRESETS = [
  { label: "Static", build: () => [{ time: 0, position: [0, 1.85, 7], target: [0, 1.65, 0], fov: 42 }] },
  { label: "Push In", build: (d) => [{ time: 0, position: [0, 1.85, 8], target: [0, 1.65, 0], fov: 42 }, { time: d, position: [0, 1.75, 3.5], target: [0, 1.65, 0], fov: 38 }] },
  { label: "Pull Back", build: (d) => [{ time: 0, position: [0, 1.75, 3.5], target: [0, 1.65, 0], fov: 38 }, { time: d, position: [0, 1.85, 8], target: [0, 1.65, 0], fov: 42 }] },
  { label: "Orbit Left", build: (d) => [{ time: 0, position: [3, 1.85, 5], target: [0, 1.5, 0], fov: 40 }, { time: d, position: [-3, 1.85, 5], target: [0, 1.5, 0], fov: 40 }] },
  { label: "Orbit Right", build: (d) => [{ time: 0, position: [-3, 1.85, 5], target: [0, 1.5, 0], fov: 40 }, { time: d, position: [3, 1.85, 5], target: [0, 1.5, 0], fov: 40 }] },
  { label: "Crane Up", build: (d) => [{ time: 0, position: [0, 0.8, 5], target: [0, 1.2, 0], fov: 42 }, { time: d, position: [0, 3.2, 5], target: [0, 1.6, 0], fov: 42 }] },
];

app.registerExtension({
  name: "H3Suite.v1",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "H3SuiteNode") return;

    nodeType.prototype.onNodeCreated = function () {
      this.color = C.bg0; this.bgcolor = C.bg0; this.resizable = false;
      this.outputs = []; if (this.widgets) this.widgets = [];

      const self = this;
      const root = mk("div", {
        width: "100%", height: "100%", background: C.bg0, color: C.text,
        fontFamily: "system-ui,-apple-system,'Segoe UI',sans-serif", display: "flex", flexDirection: "column",
        boxSizing: "border-box", overflow: "hidden", borderRadius: "10px",
      });

      const S = Object.assign(DEFAULTS(), loadState());
      const persist = () => saveState(S);

      let refMap = { pictures: [], videos: [], audios: [] };

      // ── Layout shell ──────────────────────────────────────────────────────
      const header = mk("div", { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${C.border}`, flexShrink: "0" });
      const title = mk("div", { fontSize: "13px", fontWeight: "800", letterSpacing: ".02em" }); tx(title, "H3 Suite — MiniMax H3 Reference Director");
      const tabsWrap = mk("div", { display: "flex", gap: "4px" });
      const TABS = ["References", "Camera", "Motion", "Library", "Settings", "Setup"];
      let activeTab = "References";
      const tabBtns = {};
      TABS.forEach(t => {
        const b = mk("button", {
          background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: "6px",
          padding: "5px 10px", fontSize: "10px", fontWeight: "700", cursor: "pointer", letterSpacing: ".03em",
        });
        tx(b, t);
        b.onclick = () => setTab(t);
        tabBtns[t] = b;
        tabsWrap.appendChild(b);
      });
      // ── Whole-node fullscreen ────────────────────────────────────────────
      const fsNodeBtn = mk("button", {
        background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: "6px",
        padding: "5px 8px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        outline: "none", transition: "border-color .15s,color .15s",
      });
      fsNodeBtn.title = "Fullscreen";
      const FS_ICON_EXPAND = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
      const FS_ICON_COLLAPSE = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/></svg>`;
      fsNodeBtn.innerHTML = FS_ICON_EXPAND;
      fsNodeBtn.onmouseenter = () => { fsNodeBtn.style.borderColor = LIME; fsNodeBtn.style.color = LIME; };
      fsNodeBtn.onmouseleave = () => { if (!_inFullscreen) { fsNodeBtn.style.borderColor = C.border; fsNodeBtn.style.color = C.muted; } };

      let _inFullscreen = false;
      let _fsOverlay = null;
      let _rootOrigParent = null, _rootOrigNextSibling = null;

      // Fullscreen uses CSS `zoom` rather than `transform: scale()` on purpose:
      // zoom participates in layout, so the flex column actually reflows into the
      // bigger viewport (panels get real extra room) instead of being a magnified
      // photo of the 1020×760 layout with the same content cut off.
      function _fsRescale() {
        if (!_inFullscreen) return;
        const vw = window.innerWidth, vh = window.innerHeight;
        const z = Math.max(1, Math.min(vw / NODE_W, vh / NODE_H, 1.9));
        root.style.zoom = String(z);
      }

      function _enterFullscreen() {
        if (_inFullscreen) return;
        if (!_fsOverlay) {
          _fsOverlay = mk("div", {
            position: "fixed", inset: "0", zIndex: "99990", background: C.bg0,
            display: "none", boxSizing: "border-box", overflow: "hidden",
          });
          document.body.appendChild(_fsOverlay);
        }
        _rootOrigParent = root.parentNode;
        _rootOrigNextSibling = root.nextSibling;
        root.style.width = "100%"; root.style.height = "100%";
        root.style.borderRadius = "0";
        _fsOverlay.appendChild(root);
        _fsOverlay.style.display = "block";
        _fsOverlay.setAttribute("tabindex", "-1");
        _fsOverlay.focus();
        _inFullscreen = true;
        _fsRescale();
        fsNodeBtn.innerHTML = FS_ICON_COLLAPSE;
        fsNodeBtn.style.borderColor = LIME; fsNodeBtn.style.color = LIME;
        window.addEventListener("resize", _fsRescale);
      }

      function _exitFullscreen() {
        if (!_inFullscreen) return;
        if (_rootOrigParent) {
          if (_rootOrigNextSibling) _rootOrigParent.insertBefore(root, _rootOrigNextSibling);
          else _rootOrigParent.appendChild(root);
        }
        root.style.width = "100%"; root.style.height = "100%";
        root.style.borderRadius = "10px"; root.style.zoom = "";
        _fsOverlay.style.display = "none";
        _inFullscreen = false;
        window.removeEventListener("resize", _fsRescale);
        fsNodeBtn.innerHTML = FS_ICON_EXPAND;
        fsNodeBtn.style.borderColor = C.border; fsNodeBtn.style.color = C.muted;
      }

      fsNodeBtn.onclick = () => { if (_inFullscreen) _exitFullscreen(); else _enterFullscreen(); };
      const _fsKeydownHandler = (e) => {
        if (!_inFullscreen) return;
        if (e.key === "Escape") { e.preventDefault(); _exitFullscreen(); }
      };
      document.addEventListener("keydown", _fsKeydownHandler, { capture: true });

      const headerRight = mk("div", { display: "flex", alignItems: "center", gap: "8px" });
      headerRight.append(tabsWrap, fsNodeBtn);
      header.append(title, headerRight);

      // The body itself never scrolls — each tab panel fills it (flex:1) and owns
      // its own scrolling, so a tab like Camera can lay itself out to the exact
      // available height instead of overflowing off the bottom of the node.
      const body = mk("div", { flex: "1", minHeight: "0", overflow: "hidden", padding: "12px 14px", display: "flex", flexDirection: "column" });

      const promptWrap = mk("div", { padding: "10px 14px", borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: "6px", flexShrink: "0" });
      const promptTA = mk("textarea", {
        width: "100%", minHeight: "104px", maxHeight: "260px", resize: "vertical", boxSizing: "border-box",
        background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "8px", color: C.text,
        fontSize: "11px", padding: "8px 10px", outline: "none", fontFamily: "inherit", lineHeight: "1.5",
      }, { placeholder: "Describe the shot. References are optional — with none loaded, H3 generates everything from this text alone. Only use <Picture 1>, <Video 2>, <Audio 1>… for slots you actually filled above." });
      promptTA.value = S.prompt || "";
      promptTA.oninput = () => { S.prompt = promptTA.value; persist(); };

      const enhanceRow = mk("div", { display: "flex", alignItems: "center", gap: "8px" });
      const enhanceBtn = mk("button", {
        background: "none", border: `1px solid ${C.border}`, cursor: "pointer", padding: "4px 9px",
        color: C.muted, outline: "none", borderRadius: "6px", fontSize: "9px", fontWeight: "700", letterSpacing: ".04em",
      });
      tx(enhanceBtn, "✨ Enhance Prompt");
      const enhanceStatus = mk("div", { fontSize: "9px", color: C.muted, flex: "1" });
      // Which mode the next render runs in — text-only vs reference-driven — is
      // otherwise invisible from the prompt box, and it changes what the prompt
      // is allowed to say.
      const refBadge = mk("div", {
        fontSize: "9px", fontWeight: "700", borderRadius: "20px", padding: "3px 9px",
        border: `1px solid ${C.border}`, color: C.muted, flexShrink: "0", letterSpacing: ".03em",
      });
      function updateRefBadge() {
        const n = activeRefCount();
        tx(refBadge, n === 0 ? "Text-only — no references" : `${n} reference${n === 1 ? "" : "s"} active`);
        refBadge.style.color = n === 0 ? C.muted : LIME;
        refBadge.style.borderColor = n === 0 ? C.border : LIME;
        refBadge.title = n === 0
          ? "No references loaded: H3 generates picture and sound from the prompt alone. Reference tags must not appear in the prompt."
          : `Active: ${activeRefSummary()}`;
      }
      enhanceRow.append(enhanceBtn, refBadge, enhanceStatus);

      const errBox = mk("div", { fontSize: "10px", color: C.err, display: "none", alignItems: "center", gap: "10px", lineHeight: "1.5" });

      const footer = mk("div", { display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", borderTop: `1px solid ${C.border}`, flexShrink: "0" });
      const progWrap = mk("div", { flex: "1", height: "20px", background: C.bg2, borderRadius: "5px", overflow: "hidden", display: "none", position: "relative" });
      const progBar = mk("div", { position: "absolute", inset: "0", width: "0%", background: LIME, transition: "width .2s" });
      // A single label, blend-moded so it stays legible whether it's sitting over
      // the filled (lime) or unfilled (dark) part of the bar — avoids needing a
      // second clipped copy kept pixel-synced to the fill width as it animates.
      const progLbl = mk("div", {
        position: "absolute", inset: "0", display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "9px", fontWeight: "700", color: "#fff", mixBlendMode: "difference", whiteSpace: "nowrap",
        pointerEvents: "none", letterSpacing: ".02em",
      });
      progWrap.append(progBar, progLbl);
      const stageLbl = mk("div", { fontSize: "9px", color: C.muted, display: "none", flexShrink: "0" });
      const genBtn = mk("button", {
        background: LIME, color: "#111", border: "2px solid transparent", borderRadius: "8px",
        padding: "9px 20px", fontSize: "12px", fontWeight: "800", cursor: "pointer", letterSpacing: ".02em",
      });
      tx(genBtn, "Generate");
      const stopBtn = mk("button", {
        background: "none", border: `1.5px solid ${C.err}`, color: C.err, borderRadius: "8px",
        padding: "9px 14px", fontSize: "11px", fontWeight: "700", cursor: "pointer", display: "none",
      });
      tx(stopBtn, "Stop");
      footer.append(stageLbl, progWrap, stopBtn, genBtn);

      // The result player lives inside the References tab's "Latest result" card
      // (see below) rather than as a fixed strip above the prompt — that way it
      // fills space the tab had going spare instead of squeezing the panels.
      const preview = VideoPreview("fill");

      root.append(header, body, promptWrap, footer);
      promptWrap.append(promptTA, enhanceRow, errBox);

      this.addDOMWidget("h3s_ui", "div", root, {
        getValue() { return null; }, setValue() { }, serialize: false,
        computeSize() { return [NODE_W, NODE_H]; },
      });
      this.setSize([NODE_W, NODE_H]);

      // action (optional): { label, onClick } — renders a fix button beside the
      // message, so a blocking error can be resolved without leaving the node.
      // action: one {label, onClick}, or an array of them for multiple options
      // (e.g. a recommended fix plus a plain "do it anyway" override).
      function showError(msg, action) {
        errBox.innerHTML = "";
        errBox.style.display = "flex";
        const msgEl = mk("span", { flex: "1" }); tx(msgEl, msg);
        errBox.appendChild(msgEl);
        (action ? (Array.isArray(action) ? action : [action]) : []).forEach(a => {
          const btn = mk("button", {
            background: "none", border: `1px solid ${C.err}`, color: C.err, borderRadius: "6px",
            padding: "3px 9px", fontSize: "9px", fontWeight: "700", cursor: "pointer",
            flexShrink: "0", outline: "none",
          });
          tx(btn, a.label);
          btn.onclick = a.onClick;
          errBox.appendChild(btn);
        });
      }
      function clearError() { errBox.style.display = "none"; errBox.innerHTML = ""; }

      // ── Tabs ──────────────────────────────────────────────────────────────
      const panels = {};
      function setTab(t) {
        activeTab = t;
        TABS.forEach(k => {
          const active = k === t;
          tabBtns[k].style.color = active ? "#111" : C.muted;
          tabBtns[k].style.background = active ? LIME : "none";
          tabBtns[k].style.borderColor = active ? LIME : C.border;
          if (panels[k]) panels[k].style.display = active ? "flex" : "none";
        });
        if (t === "Library" && _libNeedsRefresh) { _libNeedsRefresh = false; libLoad(true); }
        if (t === "Camera") cameraViewport.onActivate(); else { cameraViewport.onDeactivate(); _stopCamPlayback(); }
      }

      // ── References panel ─────────────────────────────────────────────────
      // Two columns: compact reference slots on the left, the result player on the
      // right where it gets real size. Both stay above the prompt box.
      const refPanel = mk("div", { display: "none", gap: "12px", flex: "1", minHeight: "0" });
      panels["References"] = refPanel;
      // Each reference group gets its own framed card so the slots read as
      // organised sections instead of icons floating in empty space.
      const refCard = (title) => {
        const box = card(title);
        const grid = mk("div", { display: "flex", flexWrap: "wrap", gap: "8px" });
        box.appendChild(grid);
        return { box, grid };
      };
      const picCard = refCard("Pictures (fixed roles)");
      const picSection = picCard.box, picGrid = picCard.grid;
      const vidCard = refCard("Videos");
      const vidSection = vidCard.box, vidGrid = vidCard.grid;
      const audCard = refCard("Audio");
      const audSection = audCard.box, audGrid = audCard.grid;

      const refLeftCol = mk("div", {
        display: "flex", flexDirection: "column", gap: "10px", width: "396px",
        flexShrink: "0", overflowY: "auto", paddingRight: "2px",
      });
      // Motion Director — its own tab (mirrors the Camera tab's layout: upload +
      // preview on the left, render/status/output on the right). Turns a raw
      // performance video into the depth+DWPose+DensePose composite the Motion
      // slot expects, via a real queued ComfyUI pipeline
      // (workflows/h3_suite_motion_guide.json — a from-scratch synchronous render
      // like the Camera Director's isn't possible here, this is genuine ML
      // inference across three models).
      const motionPanel = mk("div", { display: "none", flexDirection: "column", gap: "8px", flex: "1", minHeight: "0" });
      panels["Motion"] = motionPanel;
      body.appendChild(motionPanel);

      const motionSrcPreview = VideoPreview("fill");
      const motionSrcCard = card("Source video");
      motionSrcCard.style.flex = "1"; motionSrcCard.style.minWidth = "0"; motionSrcCard.style.minHeight = "150px";
      const motionSrcEmpty = mk("div", {
        flex: "1", minHeight: "0", display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "10px", color: C.muted, border: `1px dashed ${C.border}`, borderRadius: "8px", textAlign: "center", padding: "10px",
      });
      tx(motionSrcEmpty, "Upload a performance video below to preview it here.");
      const motionSrcRow = mk("div", { display: "flex", alignItems: "flex-start", gap: "10px" });
      let _motionSrcName = null;
      const motionSrcSlot = MediaSlot("video", "Source", "Raw performance video to turn into a motion guide — this is the input, not the Motion slot itself.", (name) => {
        _motionSrcName = name;
        if (name) { motionSrcEmpty.style.display = "none"; motionSrcPreview.show(api.apiURL(`/view?filename=${encodeURIComponent(name)}&type=input&t=${Date.now()}`)); }
        else { motionSrcPreview.hide(); motionSrcEmpty.style.display = "flex"; }
      }, 84);
      const motionTrimStartNum = NumberField("Trim start (s)", 0, 0, 600, 1, () => { });
      const motionTrimEndNum = NumberField("Trim end (s) — 0 = to the end", 0, 0, 600, 1, () => { });
      motionTrimStartNum.el.style.flex = "1"; motionTrimEndNum.el.style.flex = "1";
      motionSrcRow.append(motionSrcSlot.el, motionTrimStartNum.el, motionTrimEndNum.el);
      motionSrcCard.append(motionSrcRow, motionSrcEmpty, motionSrcPreview.el);

      const motionGuideCard = card("Motion guide");
      motionGuideCard.style.width = "296px"; motionGuideCard.style.flexShrink = "0"; motionGuideCard.style.overflowY = "auto";
      motionGuideCard.appendChild(note("Turns a raw performance video into the depth + DWPose + DensePose guide the Motion slot expects. Runs a real ComfyUI pipeline — the first run also downloads the pose models from Hugging Face, which can take several minutes."));
      const motionRenderBtn = mk("button", { background: LIME, color: "#111", border: "none", borderRadius: "7px", padding: "8px 16px", fontSize: "11px", fontWeight: "800", cursor: "pointer" });
      tx(motionRenderBtn, "Render Motion Guide");
      const motionStatus = mk("div", { fontSize: "9px", color: C.muted, lineHeight: "1.4" });
      const motionPreview = VideoPreview(150);
      const useAsMotionBtn = mk("button", {
        background: "none", border: `1px solid ${LIME}`, color: LIME, borderRadius: "7px",
        padding: "8px 14px", fontSize: "10px", fontWeight: "700", cursor: "pointer", display: "none",
      });
      tx(useAsMotionBtn, "Use as Video 1 (Motion Guide)");
      motionGuideCard.append(motionRenderBtn, motionStatus, motionPreview.el, useAsMotionBtn);

      const motionMainRow = mk("div", { display: "flex", gap: "12px", flex: "1", minHeight: "0" });
      motionMainRow.append(motionSrcCard, motionGuideCard);
      motionPanel.append(motionMainRow);

      let _motionBusy = false, _motionGuideFile = null;
      motionRenderBtn.onclick = async () => {
        if (_motionBusy) return;
        if (!_motionSrcName) { tx(motionStatus, "Upload a source video first."); return; }
        const trimStart = Math.max(0, motionTrimStartNum.value || 0);
        const trimEnd = Math.max(0, motionTrimEndNum.value || 0);
        if (trimEnd > 0 && trimEnd <= trimStart) { tx(motionStatus, "Trim end must be greater than trim start."); return; }
        _motionBusy = true; motionRenderBtn.disabled = true;
        useAsMotionBtn.style.display = "none";
        const startedAt = Date.now();
        const tick = setInterval(() => { tx(motionStatus, `Processing… ${Math.round((Date.now() - startedAt) / 1000)}s elapsed (first run also downloads the pose models)`); }, 1000);
        tx(motionStatus, "Processing…");
        try {
          const wfR = await api.fetchApi("/h3suite/workflow_motion_guide");
          if (!wfR.ok) throw new Error("HTTP " + wfR.status + " (restart ComfyUI if this node was just installed)");
          const wf = await wfR.json();
          const mg = JSON.parse(JSON.stringify(wf));
          mg["H3MG:load"].inputs.video = _motionSrcName;
          // VHS_LoadVideo trims by frame count at its own fixed force_rate (24fps
          // in this graph): skip_first_frames seeks to the trim-start point, and
          // frame_load_cap (0 = no cap) stops it at trim-end — together giving a
          // real [start, end) range instead of only "first N seconds".
          mg["H3MG:load"].inputs.skip_first_frames = Math.round(trimStart * 24);
          mg["H3MG:load"].inputs.frame_load_cap = trimEnd > 0 ? Math.round((trimEnd - trimStart) * 24) : 0;
          const qR = await api.fetchApi("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: mg, client_id: api.clientId }) });
          const qD = await qR.json();
          if (qD.error) throw new Error(fmtErr(qD.error));
          const promptId = qD.prompt_id;
          // No sampler in this graph, so there's no step-based progress signal to
          // show — an elapsed-time counter (above) is the honest choice instead
          // of forcing the Generate flow's KSampler-shaped ETA bar onto a
          // fundamentally different kind of pipeline.
          // "executed" fires once per node that carries UI output — not just the
          // final one. DWPreprocessor/DensePosePreprocessor emit their own preview
          // partway through the graph, well before VHS_VideoCombine (H3MG:combine)
          // actually writes the video, so resolving on the first "executed" for
          // this prompt_id (as opposed to specifically H3MG:combine's) used to grab
          // the history before the output existed and report "No output video
          // found" even though the render kept running and finished fine.
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { cleanup(); reject(new Error("Timed out after 20 minutes.")); }, 20 * 60 * 1000);
            const cleanup = () => { api.removeEventListener("executed", doneHandler); api.removeEventListener("execution_error", errHandler); clearTimeout(timeout); };
            const doneHandler = (ev) => { const d = ev.detail || ev; if (d.prompt_id !== promptId || d.node !== "H3MG:combine") return; cleanup(); resolve(d); };
            const errHandler = (ev) => {
              const d = ev.detail || {};
              if (d.prompt_id && d.prompt_id !== promptId) return;
              cleanup(); reject(new Error(fmtErr(d.exception_message || d.error || "Motion Guide pipeline failed.")));
            };
            api.addEventListener("executed", doneHandler);
            api.addEventListener("execution_error", errHandler);
          });
          const histR = await api.fetchApi(`/history/${promptId}`);
          const histD = await histR.json();
          const file = extractOutputFile(histD[promptId]?.outputs, "H3MG:combine");
          if (!file) throw new Error("No output video found.");
          _motionGuideFile = file;
          const url = api.apiURL(`/view?filename=${encodeURIComponent(file.filename)}&type=${encodeURIComponent(file.type || "output")}&subfolder=${encodeURIComponent(file.subfolder || "")}&t=${Date.now()}`);
          motionPreview.show(url);
          useAsMotionBtn.style.display = "inline-block";
          tx(motionStatus, "Done — set as Video 1 below.");
        } catch (e) {
          tx(motionStatus, "Failed: " + fmtErr(e));
        } finally {
          clearInterval(tick);
          _motionBusy = false; motionRenderBtn.disabled = false;
        }
      };
      useAsMotionBtn.onclick = () => {
        if (!_motionGuideFile) return;
        // The motion guide is saved under output/ (VHS_VideoCombine writes there,
        // not input/), so the bare filename alone isn't enough for LoadVideo to
        // find it at Generate time — it needs the "subfolder/name [output]"
        // annotated form (see annotatedRef() above).
        const ref = annotatedRef(_motionGuideFile);
        S.vids["motion_video"] = ref; persist();
        const slot = vidSlots["motion_video"]; if (slot) slot.setName(ref);
        updateRefBadge();
        setTab("References");
      };

      refLeftCol.append(picSection, vidSection, audSection);

      // Latest-result card — takes the leftover height of the tab, so the panel
      // has no dead space and the generated video has an obvious home.
      const resultCard = card();
      resultCard.style.flex = "1"; resultCard.style.minWidth = "0"; resultCard.style.minHeight = "150px";
      const resultHead = mk("div", { display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: "0" });
      const resultCap = cap("Latest result"); resultCap.style.marginBottom = "0";
      const resultLibBtn = mk("button", {
        background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: "6px",
        padding: "3px 9px", fontSize: "9px", fontWeight: "700", cursor: "pointer", outline: "none",
      });
      tx(resultLibBtn, "Open Library");
      resultLibBtn.onclick = () => setTab("Library");
      resultHead.append(resultCap, resultLibBtn);
      const resultEmpty = mk("div", {
        flex: "1", minHeight: "0", display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "10px", color: C.muted, border: `1px dashed ${C.border}`, borderRadius: "8px",
      });
      tx(resultEmpty, "Your generated video appears here.");
      resultCard.append(resultHead, resultEmpty, preview.el);

      function showResult(url) { resultEmpty.style.display = "none"; preview.show(url); }

      refPanel.append(refLeftCol, resultCard);
      body.appendChild(refPanel);

      // ── Camera panel ──────────────────────────────────────────────────────
      const camPanel = mk("div", { display: "none", flexDirection: "column", gap: "8px", flex: "1", minHeight: "0" });
      panels["Camera"] = camPanel;
      body.appendChild(camPanel);

      const camPresetsRow = mk("div", { display: "flex", flexWrap: "wrap", gap: "6px" });
      CAMERA_PRESETS.forEach(p => {
        const b = mk("button", { background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: "6px", padding: "5px 9px", fontSize: "10px", cursor: "pointer" });
        tx(b, p.label);
        b.onclick = () => { S.camera.keyframes = p.build(S.camera.duration); persist(); renderKeyList(); cameraViewport.refreshKeyframes(); };
        camPresetsRow.appendChild(b);
      });

      const camSettingsRow = mk("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" });
      const camDur = NumberField("Duration (s)", S.camera.duration, 4, 15, 1, v => { S.camera.duration = v; persist(); cameraViewport.setDuration(v); camScrub.max = String(v); _updateDuplicateHint(); });
      const camRes = Select("Preview Resolution", RES_PRESETS.filter(r => r.startsWith("Fast") || r.startsWith("Test")).concat(RES_PRESETS.filter(r => !r.startsWith("Fast") && !r.startsWith("Test"))), S.camera.resolution_preset, v => { S.camera.resolution_preset = v; persist(); });
      const camProxy = Select("Proxy", ["Humanoid", "Product Bottle", "Cube", "Sphere", "Cylinder", "Capsule"], S.camera.proxy_type, v => { S.camera.proxy_type = v; persist(); cameraViewport.setProxy(v, S.camera.proxy_scale); });
      const camScale = NumberField("Scale", S.camera.proxy_scale || 1.0, 0.25, 4, 0.05, v => { S.camera.proxy_scale = v; persist(); cameraViewport.setProxy(S.camera.proxy_type, v); });
      const camInterp = Select("Interpolation", ["Smooth", "Linear"], S.camera.interpolation, v => { S.camera.interpolation = v; persist(); cameraViewport.setInterpolation(v); });
      const camBg = Select("Background", ["Neutral", "Dark", "White"], S.camera.background, v => { S.camera.background = v; persist(); cameraViewport.setEnvironment(S.camera); });
      camSettingsRow.append(camDur.el, camRes.el, camProxy.el, camScale.el, camInterp.el, camBg.el);

      const camViewportToolsRow = mk("div", { display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" });
      const camFloorToggle = compactToggle(Toggle("Show floor", S.camera.show_floor, v => { S.camera.show_floor = v; persist(); cameraViewport.setEnvironment(S.camera); }));
      const camAxesToggle = compactToggle(Toggle("Show axes", S.camera.show_axes, v => { S.camera.show_axes = v; persist(); cameraViewport.setEnvironment(S.camera); }));
      const camResetViewBtn = mk("button", { background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: "6px", padding: "4px 10px", fontSize: "9px", cursor: "pointer" });
      tx(camResetViewBtn, "Reset view");
      camResetViewBtn.onclick = () => cameraViewport.resetView();
      // The camera holds its final pose past the last keyframe — correct,
      // standard keyframe semantics (camera_engine.py does the same for the
      // actual render), but a shot built at a shorter duration and then
      // stretched via the Duration field leaves a static tail unless the
      // keyframe timing gets rescaled too. This does that rescale in one
      // click instead of retyping every "t" by hand.
      const camStretchBtn = mk("button", { background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: "6px", padding: "4px 10px", fontSize: "9px", cursor: "pointer" });
      tx(camStretchBtn, "⇥ Stretch keyframes to Duration");
      camStretchBtn.title = "Rescale all keyframe times so the first stays at 0s and the last lands exactly at Duration";
      camStretchBtn.onclick = () => {
        const keys = S.camera.keyframes;
        if (keys.length < 2) return;
        const firstT = keys[0].time, span = keys[keys.length - 1].time - firstT;
        keys.forEach(k => {
          k.time = span > 0 ? ((k.time - firstT) / span) * S.camera.duration : 0;
        });
        persist(); renderKeyList(); cameraViewport.refreshKeyframes();
      };
      camViewportToolsRow.append(camFloorToggle.el, camAxesToggle.el, camResetViewBtn, camStretchBtn);

      const camViewportWrap = mk("div", { position: "relative", width: "100%", flex: "1", minHeight: "200px", borderRadius: "8px", overflow: "hidden", border: `1px solid ${C.border}`, background: "#000", boxSizing: "border-box" });
      const camScrubRow = mk("div", { display: "flex", alignItems: "center", gap: "8px", flexShrink: "0" });
      const camPlayBtn = mk("button", {
        background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: "6px",
        width: "26px", height: "22px", fontSize: "10px", cursor: "pointer", flexShrink: "0",
        display: "flex", alignItems: "center", justifyContent: "center", outline: "none",
      });
      tx(camPlayBtn, "▶");
      const camScrub = mk("input", { flex: "1", minWidth: "0", accentColor: LIME }, { type: "range", min: "0", max: String(S.camera.duration), step: "0.05", value: "0" });
      const camScrubLbl = mk("div", { fontSize: "9px", color: C.muted, minWidth: "52px", textAlign: "right" });
      tx(camScrubLbl, "t = 0.00s");
      // Guard flag so a programmatic value set (from the Play loop or from
      // jumping to a keyframe's own time) can never be mistaken for the user
      // grabbing the slider — that would call _stopCamPlayback() and kill
      // playback on literally its own first frame if the browser ever fires
      // "input" from a plain property assignment.
      let _scrubSettingProgrammatically = false;
      const setScrubTime = (t) => {
        _scrubSettingProgrammatically = true;
        camScrub.value = String(t);
        _scrubSettingProgrammatically = false;
        tx(camScrubLbl, `t = ${t.toFixed(2)}s`);
        cameraViewport.setTime(t);
      };
      camScrub.oninput = () => {
        if (_scrubSettingProgrammatically) return;
        _stopCamPlayback(); setScrubTime(parseFloat(camScrub.value));
      };

      // Auto-scrub: the actual "animated preview" — advances t in real time
      // and loops, so the shot-camera PiP plays like a real preview instead
      // of needing a manual drag or a full server render just to see the
      // move. Loops over the KEYFRAMED span (first→last keyframe time), not
      // 0→Duration: past the last keyframe the camera holds its final pose
      // (same as the real render), so looping the full Duration would spend
      // most of "Play" sitting on a frozen frame and look like it's stuck.
      let _camPlayRaf = null, _camPlayLastTs = null;
      function _stopCamPlayback() {
        if (_camPlayRaf) cancelAnimationFrame(_camPlayRaf);
        _camPlayRaf = null; _camPlayLastTs = null;
        tx(camPlayBtn, "▶");
        cameraViewport.setTheaterMode(false);
      }
      function _tickCamPlayback(ts) {
        if (_camPlayLastTs == null) _camPlayLastTs = ts;
        const dt = (ts - _camPlayLastTs) / 1000;
        _camPlayLastTs = ts;
        const keys = S.camera.keyframes;
        const spanStart = keys[0].time, spanEnd = keys[keys.length - 1].time;
        let t = parseFloat(camScrub.value) + dt;
        if (t > spanEnd) t = spanStart;
        setScrubTime(t);
        _camPlayRaf = requestAnimationFrame(_tickCamPlayback);
      }
      camPlayBtn.onclick = () => {
        if (_camPlayRaf) { _stopCamPlayback(); return; }
        if (S.camera.keyframes.length < 2) {
          // Silently doing nothing here reads as "Play is broken" — say why.
          tx(camScrubLbl, "need 2+ keys");
          setTimeout(() => { if (!_camPlayRaf) tx(camScrubLbl, `t = ${parseFloat(camScrub.value).toFixed(2)}s`); }, 1500);
          return;
        }
        tx(camPlayBtn, "❚❚");
        cameraViewport.setTheaterMode(true);
        setScrubTime(S.camera.keyframes[0].time);
        _camPlayRaf = requestAnimationFrame(_tickCamPlayback);
      };

      camScrubRow.append(camPlayBtn, camScrub, camScrubLbl);

      const cameraViewport = createCameraViewport(camViewportWrap, {
        getState: () => S.camera,
        persist,
        onSelect: (i) => updateKeyListSelection(i),
        onChange: (i) => syncKeyRowFields(i),
      });

      const keyListWrap = mk("div", { display: "flex", flexDirection: "column", gap: "4px", flexShrink: "0", maxWidth: "860px" });
      keyListWrap.appendChild(cap("Keyframes — time / position xyz / target xyz / fov"));
      const keyListHint = mk("div", { fontSize: "9px", color: C.warn, lineHeight: "1.4", display: "none", whiteSpace: "pre-line" });
      keyListWrap.appendChild(keyListHint);
      const keyList = mk("div", { display: "flex", flexDirection: "column", gap: "5px", maxHeight: "132px", overflowY: "auto", paddingRight: "2px" });
      keyListWrap.appendChild(keyList);
      // Placing a keyframe past the current Duration extends the Duration to
      // match — like any normal keyframe-animation timeline (Blender, After
      // Effects) — instead of silently clamping the keyframe back and leaving
      // no way to actually put one where you wanted it. ceil() so the exact
      // keyframe time still lands inside the whole-second Duration the
      // backend ends up using (camera_engine.py truncates it to an int).
      const CAM_DUR_MAX = 15; // hard ceiling — matches the Duration field's own max and camera_engine.py's clamp
      function _growDurationTo(t) {
        const target = Math.min(CAM_DUR_MAX, Math.max(S.camera.duration, Math.ceil(t)));
        if (target > S.camera.duration) {
          S.camera.duration = target;
          camDur.setValue(target);
          camScrub.max = String(target);
          cameraViewport.setDuration(target);
        }
      }

      const addKeyRow = mk("div", { display: "flex", gap: "6px", flexShrink: "0" });
      const addKeyBtn = mk("button", { alignSelf: "flex-start", background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: "6px", padding: "5px 10px", fontSize: "10px", cursor: "pointer" });
      tx(addKeyBtn, "+ Add keyframe");
      addKeyBtn.onclick = () => {
        const last = S.camera.keyframes[S.camera.keyframes.length - 1];
        const t = last ? Math.min(CAM_DUR_MAX, last.time + 1) : 0;
        S.camera.keyframes.push(last ? { ...last, time: t } : { time: 0, position: [0, 1.85, 7], target: [0, 1.65, 0], fov: 42 });
        _growDurationTo(t);
        persist(); renderKeyList(); cameraViewport.refreshKeyframes();
      };
      // Frame the shot by eye (orbit/pan/zoom the 3D view) and stamp it straight
      // into a keyframe — no typing coordinates, no dragging the gizmo by hand.
      const addKeyFromViewBtn = mk("button", { alignSelf: "flex-start", background: "none", border: `1px solid ${LIME}`, color: LIME, borderRadius: "6px", padding: "5px 10px", fontSize: "10px", cursor: "pointer" });
      tx(addKeyFromViewBtn, "📷 Add keyframe from view");
      addKeyFromViewBtn.onclick = () => {
        const pose = cameraViewport.getViewPose();
        if (!pose) return;
        const last = S.camera.keyframes[S.camera.keyframes.length - 1];
        const t = last ? Math.min(CAM_DUR_MAX, last.time + 1) : 0;
        S.camera.keyframes.push({ time: t, position: pose.position, target: pose.target, fov: last ? last.fov : 42 });
        _growDurationTo(t);
        persist(); renderKeyList(); cameraViewport.refreshKeyframes();
      };
      addKeyRow.append(addKeyBtn, addKeyFromViewBtn);

      // keyRows[i] = { row, posInputs: [x,y,z inputs], tgtInputs: [x,y,z inputs] } — lets
      // syncKeyRowFields(i) update one row's live values from a 3D gizmo drag without
      // rebuilding the whole list (which would thrash the DOM / steal focus mid-drag).
      let keyRows = [];
      const vec3Eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
      function _updateDuplicateHint() {
        keyRows.forEach(r => { r.row.style.background = C.bg2; });
        const keys = S.camera.keyframes;
        const lines = [];

        const dupes = [];
        for (let i = 0; i < keys.length - 1; i++) {
          const a = keys[i], b = keys[i + 1];
          if (vec3Eq(a.position, b.position) && vec3Eq(a.target, b.target)) dupes.push(i);
        }
        if (dupes.length) {
          lines.push(`⚠ Keyframe${dupes.length > 1 ? "s" : ""} ${dupes.map(i => `${i + 1}→${i + 2}`).join(", ")} ${dupes.length > 1 ? "are" : "is"} at the identical position/target — no camera motion happens between them yet. Drag its cone (position) or sphere (target) in the 3D view, or edit the numbers, to move it.`);
          dupes.forEach(i => { if (keyRows[i]) keyRows[i].row.style.background = "rgba(255,179,71,.08)"; if (keyRows[i + 1]) keyRows[i + 1].row.style.background = "rgba(255,179,71,.08)"; });
        }

        // Past the last keyframe the camera holds its final pose — same for the
        // 3D preview as for the actual server render — so a shot ending well
        // before Duration spends the rest of the clip motionless. Surface that
        // up front rather than letting it read as Play being broken.
        if (keys.length >= 2) {
          const lastT = keys[keys.length - 1].time;
          const gap = S.camera.duration - lastT;
          if (gap > 0.25) {
            lines.push(`ℹ Last keyframe is at t=${lastT.toFixed(2)}s but Duration is ${S.camera.duration}s — the camera will hold still for the last ${gap.toFixed(1)}s of the render. Use "⇥ Stretch keyframes to Duration" below to spread the existing motion across the full clip, or add a keyframe nearer the end, if that's not what you want.`);
          }
        }

        if (lines.length) { keyListHint.style.display = "block"; tx(keyListHint, lines.join("\n")); }
        else keyListHint.style.display = "none";
      }
      function renderKeyList() {
        keyList.innerHTML = "";
        keyRows = [];
        S.camera.keyframes.forEach((k, i) => {
          const row = mk("div", { display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap", background: C.bg2, borderRadius: "6px", padding: "5px 6px", border: "1px solid transparent" });
          const posInputs = [], tgtInputs = [];
          const mkTiny = (val, onChange, w, into) => {
            const inp = mk("input", { width: w || "44px", background: C.bg1, border: `1px solid ${C.border}`, color: C.text, borderRadius: "4px", padding: "3px 4px", fontSize: "9px", outline: "none" }, { type: "number", value: val, step: "0.1" });
            inp.onchange = () => { onChange(parseFloat(inp.value)); persist(); cameraViewport.refreshKeyframe(i); _updateDuplicateHint(); };
            inp.onfocus = () => { updateKeyListSelection(i); cameraViewport.selectKeyframe(i, into === "pos" ? "position" : into === "tgt" ? "target" : null); };
            if (into === "pos") posInputs.push(inp); else if (into === "tgt") tgtInputs.push(inp);
            return inp;
          };
          const timeInp = mk("input", { width: "44px", background: C.bg1, border: `1px solid ${C.border}`, color: C.text, borderRadius: "4px", padding: "3px 4px", fontSize: "9px", outline: "none" }, { type: "number", value: k.time, step: "0.1" });
          // Time re-sorts the array (matching the backend, which always sorts
          // keyframes by time before interpolating) — a structural change, so
          // it needs the full rebuild rather than the cheap per-row update.
          timeInp.onchange = () => {
            // Clamp to the hard ceiling, not the current Duration — Duration
            // grows to fit below, it must never be what silently overrides
            // what you actually typed.
            k.time = Math.max(0, Math.min(CAM_DUR_MAX, parseFloat(timeInp.value) || 0));
            _growDurationTo(k.time);
            S.camera.keyframes.sort((a, b) => a.time - b.time);
            persist(); renderKeyList(); cameraViewport.refreshKeyframes();
          };
          row.append(
            tx(mk("span", { fontSize: "9px", color: C.muted }), "t"), timeInp,
            tx(mk("span", { fontSize: "9px", color: C.muted }), "pos"),
            mkTiny(k.position[0], v => { k.position[0] = v; }, null, "pos"), mkTiny(k.position[1], v => { k.position[1] = v; }, null, "pos"), mkTiny(k.position[2], v => { k.position[2] = v; }, null, "pos"),
            tx(mk("span", { fontSize: "9px", color: C.muted }), "tgt"),
            mkTiny(k.target[0], v => { k.target[0] = v; }, null, "tgt"), mkTiny(k.target[1], v => { k.target[1] = v; }, null, "tgt"), mkTiny(k.target[2], v => { k.target[2] = v; }, null, "tgt"),
            tx(mk("span", { fontSize: "9px", color: C.muted }), "fov"), mkTiny(k.fov, v => { k.fov = v; }, "40px", null),
          );
          const captureBtn = mk("button", {
            marginLeft: "auto", background: "none", border: `1px solid ${C.border}`, color: C.text,
            borderRadius: "4px", padding: "2px 6px", fontSize: "10px", cursor: "pointer", flexShrink: "0",
          });
          tx(captureBtn, "📷");
          captureBtn.title = "Set this keyframe to the camera's current view";
          captureBtn.onclick = () => {
            const pose = cameraViewport.getViewPose();
            if (!pose) return;
            k.position = pose.position; k.target = pose.target;
            persist(); renderKeyList(); cameraViewport.refreshKeyframes();
          };
          const del = mk("button", { background: "none", border: "none", color: C.err, cursor: "pointer", fontSize: "13px" });
          tx(del, "×");
          del.onclick = () => { S.camera.keyframes.splice(i, 1); persist(); renderKeyList(); cameraViewport.refreshKeyframes(); };
          row.append(captureBtn, del);
          keyList.appendChild(row);
          keyRows.push({ row, posInputs, tgtInputs });
        });
        _updateDuplicateHint();
      }
      renderKeyList();

      // 3D-drag → numeric-field sync: cheap, single-row update — must NOT call
      // renderKeyList() (full rebuild) since this fires continuously while dragging.
      function syncKeyRowFields(i) {
        const rowRef = keyRows[i];
        const k = S.camera.keyframes[i];
        if (!rowRef || !k) return;
        rowRef.posInputs.forEach((inp, idx) => { inp.value = k.position[idx]; });
        rowRef.tgtInputs.forEach((inp, idx) => { inp.value = k.target[idx]; });
        _updateDuplicateHint();
      }

      function updateKeyListSelection(i) {
        keyRows.forEach((r, idx) => { r.row.style.borderColor = idx === i ? LIME : "transparent"; });
      }

      const camRenderRow = mk("div", { display: "flex", flexDirection: "column", gap: "5px" });
      const camRenderBtn = mk("button", { background: LIME, color: "#111", border: "none", borderRadius: "7px", padding: "8px 16px", fontSize: "11px", fontWeight: "800", cursor: "pointer" });
      tx(camRenderBtn, "Render Camera Guide");
      const camRenderStatus = mk("div", { fontSize: "9px", color: C.muted, lineHeight: "1.4" });
      camRenderRow.append(camRenderBtn, camRenderStatus);
      const camPreview = VideoPreview(150);
      let _camGuideFilename = null;

      camRenderBtn.onclick = async () => {
        camRenderBtn.disabled = true; tx(camRenderStatus, "Rendering…");
        try {
          const r = await api.fetchApi("/h3suite/camera/render", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              duration: S.camera.duration, resolution_preset: S.camera.resolution_preset,
              proxy_type: S.camera.proxy_type, proxy_scale: S.camera.proxy_scale || 1.0,
              interpolation: S.camera.interpolation, show_floor: S.camera.show_floor,
              show_axes: S.camera.show_axes, background: S.camera.background,
              keyframes: S.camera.keyframes, scene_objects: [],
            }),
          });
          const d = await r.json();
          if (d.error) throw new Error(d.error);
          _camGuideFilename = d.filename;
          camPreview.show(api.apiURL(`/view?filename=${encodeURIComponent(d.filename)}&type=input&t=${Date.now()}`));
          tx(camRenderStatus, "Rendered — set as Video 2 below.");
        } catch (e) {
          tx(camRenderStatus, "Failed: " + fmtErr(e));
        } finally { camRenderBtn.disabled = false; }
      };
      const useAsVideo2Btn = mk("button", { background: "none", border: `1px solid ${LIME}`, color: LIME, borderRadius: "7px", padding: "8px 14px", fontSize: "10px", fontWeight: "700", cursor: "pointer" });
      tx(useAsVideo2Btn, "Use as Video 2 (Camera Guide)");
      useAsVideo2Btn.onclick = () => {
        if (!_camGuideFilename) { tx(camRenderStatus, "Render a guide first."); return; }
        S.vids["camera_video"] = _camGuideFilename; persist();
        const slot = vidSlots["camera_video"]; if (slot) slot.setName(_camGuideFilename);
        updateRefBadge();
        setTab("References");
      };
      // Two columns: the 3D view + its timeline/keyframes get the room on the left,
      // every setting and the guide-render action stay permanently visible on the
      // right, so nothing important lives below the fold.
      const camMainRow = mk("div", { display: "flex", gap: "12px", flex: "1", minHeight: "0" });
      const camLeftCol = mk("div", { display: "flex", flexDirection: "column", gap: "6px", flex: "1", minWidth: "0" });
      const camRightCol = mk("div", { display: "flex", flexDirection: "column", gap: "10px", width: "296px", flexShrink: "0", overflowY: "auto", paddingRight: "2px" });

      camLeftCol.append(camViewportWrap, camScrubRow, keyListWrap, addKeyRow);

      const camPresetsWrap = mk("div", { display: "flex", flexDirection: "column", gap: "4px" });
      camPresetsWrap.append(cap("Shot presets"), camPresetsRow);
      const camSceneWrap = mk("div", { display: "flex", flexDirection: "column", gap: "4px" });
      camSceneWrap.append(cap("Scene"), camSettingsRow);
      const camGuideWrap = mk("div", { display: "flex", flexDirection: "column", gap: "6px", marginTop: "auto" });
      camGuideWrap.append(cap("Camera guide"), camRenderRow, camPreview.el, useAsVideo2Btn);

      camRightCol.append(camPresetsWrap, camSceneWrap, camViewportToolsRow, camGuideWrap);
      camMainRow.append(camLeftCol, camRightCol);
      camPanel.append(camMainRow);

      // ── Settings panel ────────────────────────────────────────────────────
      const setPanel = mk("div", { display: "none", flexDirection: "column", gap: "10px", flex: "1", minHeight: "0", overflowY: "auto" });
      panels["Settings"] = setPanel;
      body.appendChild(setPanel);
      const setCard = card;
      const modelsCard = setCard("Models");
      modelsCard.appendChild(note("Already have these files somewhere else? Add that folder to ComfyUI's extra_model_paths.yaml under diffusion_models / text_encoders / vae, restart ComfyUI, then Refresh here and pick them below."));
      const modelsGrid = mk("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" });
      const modelSelects = {};
      const MODEL_SLOTS = [
        { key: "unet", label: "Diffusion model", category: "diffusion_models" },
        { key: "clip", label: "Text / vision encoder", category: "text_encoders" },
        { key: "vae_video", label: "Video VAE", category: "vae" },
        { key: "vae_audio", label: "Audio VAE", category: "vae" },
      ];
      MODEL_SLOTS.forEach(slot => {
        const sel = Select(slot.label, [CANONICAL_MODELS[slot.key]], S.models[slot.key] || CANONICAL_MODELS[slot.key], v => { S.models[slot.key] = (v === CANONICAL_MODELS[slot.key] ? null : v); persist(); });
        modelSelects[slot.key] = sel;
        modelsGrid.appendChild(sel.el);
      });
      const modelsRefreshRow = mk("div", { display: "flex", alignItems: "center", gap: "8px" });
      const modelsRefreshBtn = mk("button", { background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: "6px", padding: "5px 10px", fontSize: "10px", cursor: "pointer" });
      tx(modelsRefreshBtn, "Refresh model list");
      const modelsStatus = mk("div", { fontSize: "9px", color: C.muted });
      modelsRefreshRow.append(modelsRefreshBtn, modelsStatus);
      async function refreshModelLists() {
        try {
          const r = await api.fetchApi("/h3suite/models");
          const d = await r.json();
          const byCat = { diffusion_models: d.diffusion_models || [], text_encoders: d.text_encoders || [], vae: d.vae || [], loras: d.loras || [], latent_upscale_models: d.latent_upscale_models || [] };
          MODEL_SLOTS.forEach(slot => {
            const found = byCat[slot.category] || [];
            const options = found.includes(CANONICAL_MODELS[slot.key]) ? found : [CANONICAL_MODELS[slot.key], ...found];
            const sel = modelSelects[slot.key].sel;
            const keep = S.models[slot.key] || CANONICAL_MODELS[slot.key];
            sel.innerHTML = "";
            options.forEach(o => { const opt = mk("option", {}, { value: o }); opt.textContent = o; sel.appendChild(opt); });
            sel.value = options.includes(keep) ? keep : options[0];
          });
          const loraOptions = ["(none)", ...byCat.loras];
          loraRows.forEach((row, i) => {
            const sel = row.nameSel.sel;
            const keep = S.loras[i].name || "(none)";
            sel.innerHTML = "";
            loraOptions.forEach(o => { const opt = mk("option", {}, { value: o }); opt.textContent = o; sel.appendChild(opt); });
            sel.value = loraOptions.includes(keep) ? keep : "(none)";
          });
          const upscaleOptions = byCat.latent_upscale_models.includes(UPSCALE_CANONICAL_MODEL) ? byCat.latent_upscale_models : [UPSCALE_CANONICAL_MODEL, ...byCat.latent_upscale_models];
          {
            const sel = upscaleModelSel.sel;
            const keep = S.upscaleModel || UPSCALE_CANONICAL_MODEL;
            sel.innerHTML = "";
            upscaleOptions.forEach(o => { const opt = mk("option", {}, { value: o }); opt.textContent = o; sel.appendChild(opt); });
            sel.value = upscaleOptions.includes(keep) ? keep : upscaleOptions[0];
          }
          tx(modelsStatus, `Found ${byCat.diffusion_models.length} diffusion / ${byCat.text_encoders.length} text-encoder / ${byCat.vae.length} vae / ${byCat.loras.length} lora / ${byCat.latent_upscale_models.length} upscaler file(s).`);
        } catch (e) { tx(modelsStatus, "Could not scan models: " + fmtErr(e)); }
      }
      modelsRefreshBtn.onclick = refreshModelLists;
      modelsCard.append(modelsGrid, modelsRefreshRow);
      refreshModelLists();

      const lorasCard = setCard("LoRAs");
      lorasCard.appendChild(note("Chainable, applied in this order, before the speed optimizations below. Strength 0-2 (default 1.0). Refresh the model list above to pick up new files."));
      const lorasGrid = mk("div", { display: "flex", flexDirection: "column", gap: "8px" });
      const loraRows = [];
      for (let i = 0; i < 3; i++) {
        const row = mk("div", { display: "flex", gap: "8px", alignItems: "end" });
        const enabledToggle = compactToggle(Toggle(`LoRA ${i + 1}`, S.loras[i].enabled, v => { S.loras[i].enabled = v; persist(); }));
        const nameSel = Select("", ["(none)"], S.loras[i].name || "(none)", v => { S.loras[i].name = (v === "(none)" ? null : v); persist(); });
        nameSel.el.style.flex = "1";
        const strengthNum = NumberField("Strength", S.loras[i].strength, 0, 2, 0.05, v => { S.loras[i].strength = v; persist(); });
        strengthNum.el.style.width = "90px";
        row.append(enabledToggle.el, nameSel.el, strengthNum.el);
        loraRows.push({ enabledToggle, nameSel, strengthNum });
        lorasGrid.appendChild(row);
      }
      lorasCard.appendChild(lorasGrid);

      const upscaleCard = setCard("Latent Upscale (2-pass)");
      upscaleCard.appendChild(note("Runs Pass 1 (the Steps field above) at the base resolution, upscales that latent directly (no VAE round-trip), then refines it for the extra steps below at the upscaled size. Needs the optional Comfyui_Minimax_h3_latent_Upscaler node from the Setup tab."));
      // Latent Upscale and De-RoPE are both a second, alternate pass built on top of
      // Pass 1's raw output -- running both would mean a THIRD full pass this graph
      // does not build, so they stay mutually exclusive like Sage/Sol-Attn above.
      const upscaleToggle = compactToggle(Toggle("Enable", S.upscale, v => {
        S.upscale = v; if (v && S.derope) { S.derope = false; deropeToggle.setValue(false); } persist();
      }));
      const upscaleModelSel = Select("Upscaler model", [UPSCALE_CANONICAL_MODEL], S.upscaleModel || UPSCALE_CANONICAL_MODEL, v => { S.upscaleModel = (v === UPSCALE_CANONICAL_MODEL ? null : v); persist(); });
      const upscaleMultNum = NumberField("Multiplier", S.upscaleMultiplier, 1.0, 4.0, 0.05, v => { S.upscaleMultiplier = v; persist(); });
      const upscalePass2Num = NumberField("Pass 2 steps (refine)", S.upscalePass2Steps, 1, 20, 1, v => { S.upscalePass2Steps = v; persist(); });
      const upscaleGrid = mk("div", { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", alignItems: "end" });
      upscaleGrid.append(upscaleModelSel.el, upscaleMultNum.el, upscalePass2Num.el);
      upscaleCard.append(upscaleToggle.el, upscaleGrid);

      const deropeCard = setCard("De-RoPE (Motion Smear Fix)");
      deropeCard.appendChild(note("Fixes smearing on fast camera/subject motion and distant small subjects: detects the jerky spans in Pass 1's own output, regenerates just those spans on a slowed timeline, then restores the original timing/audio. Roughly triples render time -- use it on shots that actually smear, not by default on everything. Needs the optional ComfyUI-MAINodes pack from the Setup tab. Mutually exclusive with Latent Upscale (both are an alternate Pass 2)."));
      const deropeToggle = compactToggle(Toggle("Enable", S.derope, v => {
        S.derope = v; if (v && S.upscale) { S.upscale = false; upscaleToggle.setValue(false); } persist();
      }));
      const deropeStepsNum = NumberField("Steps (v2v pass)", S.deropeSteps, 2, 25, 1, v => { S.deropeSteps = v; persist(); });
      const deropeInjectNum = NumberField("Inject strength", S.deropeInject, 0.3, 0.9, 0.05, v => { S.deropeInject = v; persist(); });
      const deropeQNum = NumberField("Detection sensitivity (q)", S.deropeQ, 0.5, 0.95, 0.05, v => { S.deropeQ = v; persist(); });
      const deropeDMaxNum = NumberField("Max hold (d_max)", S.deropeDMax, 1, 8, 1, v => { S.deropeDMax = v; persist(); });
      const deropeGrid = mk("div", { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px", alignItems: "end" });
      deropeGrid.append(deropeStepsNum.el, deropeInjectNum.el, deropeQNum.el, deropeDMaxNum.el);
      deropeCard.append(deropeToggle.el, deropeGrid);

      const resSel = Select("Resolution", RES_PRESETS, S.resolutionPreset, v => { S.resolutionPreset = v; persist(); });
      const durNum = NumberField("Duration (s)", S.duration, 2, 15, 1, v => { S.duration = v; persist(); });
      const stepsNum = NumberField("Steps", S.steps, 4, 60, 1, v => { S.steps = v; persist(); });
      const seedNum = NumberField("Seed", S.seed, 0, 999999999999, 1, v => { S.seed = v; persist(); });
      const randSeedToggle = compactToggle(Toggle("Randomize seed", S.randomizeSeed, v => { S.randomizeSeed = v; persist(); }));
      const visStrNum = NumberField("Visual strength", S.visualStrength, 0, 1, 0.001, v => { S.visualStrength = v; persist(); });
      const audStrNum = NumberField("Audio strength", S.audioStrength, 0, 1, 0.001, v => { S.audioStrength = v; persist(); });
      const wardrobeCropNum = NumberField("Wardrobe head-crop %", S.wardrobeCrop, 0, 40, 1, v => { S.wardrobeCrop = v; persist(); });

      const genCard = setCard("Generation");
      genCard.style.flex = "1";
      const genGrid = mk("div", { display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr", gap: "10px", alignItems: "end" });
      resSel.el.style.gridColumn = "span 1";
      genGrid.append(resSel.el, durNum.el, stepsNum.el, seedNum.el, visStrNum.el, audStrNum.el, wardrobeCropNum.el, randSeedToggle.el);
      genCard.appendChild(genGrid);

      const speedCard = setCard("Speed optimizations");
      speedCard.style.width = "330px";
      speedCard.style.flexShrink = "0";
      speedCard.appendChild(note("Need the optional custom nodes from the Setup tab."));
      const fbcacheToggle = compactToggle(Toggle("FirstBlockCache", S.fbcache, v => { S.fbcache = v; persist(); }));
      const fbcacheModeSel = Select("", FBCACHE_MODES, S.fbcacheMode, v => { S.fbcacheMode = v; persist(); });
      // SageAttention and Sol-Attn both patch the model's self-attention — running
      // both would just have the second wrap/override the first for no benefit, so
      // the two toggles are kept mutually exclusive here rather than letting the
      // user stack them by accident.
      const sageToggle = compactToggle(Toggle("SageAttention", S.sage, v => {
        S.sage = v; if (v && S.solattn) { S.solattn = false; solattnToggle.setValue(false); } persist();
      }));
      const solattnToggle = compactToggle(Toggle("Sol-Attn (faster than SageAttention)", S.solattn, v => {
        S.solattn = v; if (v && S.sage) { S.sage = false; sageToggle.setValue(false); } persist();
      }));
      const solattnModeSel = Select("", SOLATTN_MODES, S.solattnMode, v => { S.solattnMode = v; persist(); });
      const lowvramToggle = compactToggle(Toggle("Low-VRAM attention", S.lowvram, v => { S.lowvram = v; persist(); }));
      const headChunksNum = NumberField("Head chunks", S.headChunks, 1, 56, 1, v => { S.headChunks = v; persist(); });
      speedCard.append(fbcacheToggle.el, fbcacheModeSel.el, sageToggle.el, solattnToggle.el, solattnModeSel.el, lowvramToggle.el, headChunksNum.el);

      const setBottomRow = mk("div", { display: "flex", gap: "12px", alignItems: "stretch" });
      setBottomRow.append(genCard, speedCard);

      // ── Presets card — one-click "Otimizado" config, with undo ─────────────
      const presetsCard = setCard("Presets");
      presetsCard.appendChild(note("Aplica de uma vez a config validada do \"best minimax qt\": MiniMax H3 Hybrid + LoRA turbo ref2v 768p (1.0) + Fast Landscape 864x480, 8 steps. \"Otimizado + Upscale\" liga também o Latent Upscale 3D fp16 (2x, +4 steps de refino). \"Restaurar\" volta exatamente pro que estava configurado antes do último preset aplicado."));
      // Snapshot only the fields a preset touches -- not the whole S object --
      // so "Restaurar" puts back exactly what the user had there before,
      // whatever it was (not a hardcoded factory default).
      function snapshotPresetFields() {
        return {
          models: { ...S.models },
          loras: S.loras.map(l => ({ ...l })),
          resolutionPreset: S.resolutionPreset,
          steps: S.steps,
          upscale: S.upscale,
          upscaleModel: S.upscaleModel,
          upscaleMultiplier: S.upscaleMultiplier,
          upscalePass2Steps: S.upscalePass2Steps,
          derope: S.derope,
        };
      }
      function applyPresetFields(snap) {
        MODEL_SLOTS.forEach(slot => {
          S.models[slot.key] = snap.models[slot.key];
          modelSelects[slot.key].setValue(S.models[slot.key] || CANONICAL_MODELS[slot.key]);
        });
        snap.loras.forEach((l, i) => {
          S.loras[i] = { ...l };
          loraRows[i].enabledToggle.setValue(l.enabled);
          loraRows[i].nameSel.setValue(l.name || "(none)");
          loraRows[i].strengthNum.setValue(l.strength);
        });
        S.resolutionPreset = snap.resolutionPreset; resSel.setValue(snap.resolutionPreset);
        S.steps = snap.steps; stepsNum.setValue(snap.steps);
        S.derope = snap.derope; deropeToggle.setValue(snap.derope);
        S.upscale = snap.upscale; upscaleToggle.setValue(snap.upscale);
        S.upscaleModel = snap.upscaleModel; upscaleModelSel.setValue(snap.upscaleModel || UPSCALE_CANONICAL_MODEL);
        S.upscaleMultiplier = snap.upscaleMultiplier; upscaleMultNum.setValue(snap.upscaleMultiplier);
        S.upscalePass2Steps = snap.upscalePass2Steps; upscalePass2Num.setValue(snap.upscalePass2Steps);
        persist();
        refreshModelLists();
      }
      function updateRestoreBtnState() {
        const has = !!S._presetSnapshot;
        restoreBtn.disabled = !has;
        restoreBtn.style.opacity = has ? "1" : "0.4";
        restoreBtn.style.cursor = has ? "pointer" : "default";
      }
      function applyOtimizadoPreset(withUpscale) {
        // Only take a new snapshot if there isn't already one pending restore --
        // clicking Otimizado then Otimizado+Upscale should still restore to
        // what was there *before either preset*, not to the first preset's output.
        if (!S._presetSnapshot) { S._presetSnapshot = snapshotPresetFields(); }
        const cfg = OTIMIZADO_CONFIG;
        MODEL_SLOTS.forEach(slot => {
          const val = cfg.models[slot.key];
          S.models[slot.key] = val;
          modelSelects[slot.key].setValue(val);
        });
        S.loras[0] = { enabled: true, name: cfg.lora.name, strength: cfg.lora.strength };
        loraRows[0].enabledToggle.setValue(true);
        loraRows[0].nameSel.setValue(cfg.lora.name);
        loraRows[0].strengthNum.setValue(cfg.lora.strength);
        for (let i = 1; i < loraRows.length; i++) {
          S.loras[i].enabled = false;
          loraRows[i].enabledToggle.setValue(false);
        }
        S.resolutionPreset = cfg.resolutionPreset; resSel.setValue(cfg.resolutionPreset);
        S.steps = cfg.steps; stepsNum.setValue(cfg.steps);
        S.upscale = !!withUpscale; upscaleToggle.setValue(!!withUpscale);
        if (withUpscale) {
          if (S.derope) { S.derope = false; deropeToggle.setValue(false); }
          S.upscaleModel = cfg.upscale.model; upscaleModelSel.setValue(cfg.upscale.model);
          S.upscaleMultiplier = cfg.upscale.multiplier; upscaleMultNum.setValue(cfg.upscale.multiplier);
          S.upscalePass2Steps = cfg.upscale.pass2Steps; upscalePass2Num.setValue(cfg.upscale.pass2Steps);
        }
        persist();
        // Re-sync dropdown option lists/values against the freshly scanned disk
        // catalog, in case a select's <option> list hadn't loaded yet when this
        // ran (setValue() on a <select> silently no-ops for a missing option).
        refreshModelLists();
        updateRestoreBtnState();
      }
      function restorePreviousConfig() {
        if (!S._presetSnapshot) return;
        applyPresetFields(S._presetSnapshot);
        S._presetSnapshot = null;
        persist();
        updateRestoreBtnState();
      }
      function presetBtn(labelTxt, onClick) {
        const b = mk("button", {
          background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: "7px",
          padding: "8px 14px", fontSize: "10px", fontWeight: "800", cursor: "pointer", letterSpacing: ".02em",
        });
        tx(b, labelTxt);
        b.onmouseenter = () => { if (!b.disabled) { b.style.borderColor = LIME; b.style.color = LIME; } };
        b.onmouseleave = () => { if (!b.disabled) { b.style.borderColor = C.border; b.style.color = C.text; } };
        b.onclick = onClick;
        return b;
      }
      const restoreBtn = presetBtn("↺ Restaurar configuração anterior", restorePreviousConfig);
      const presetsRow = mk("div", { display: "flex", gap: "10px" });
      presetsRow.append(
        presetBtn("⚡ Otimizado", () => applyOtimizadoPreset(false)),
        presetBtn("⚡ Otimizado + Upscale", () => applyOtimizadoPreset(true)),
        restoreBtn,
      );
      presetsCard.appendChild(presetsRow);
      updateRestoreBtnState();

      setPanel.append(presetsCard, modelsCard, lorasCard, upscaleCard, deropeCard, setBottomRow);

      // ── Setup panel ───────────────────────────────────────────────────────
      const setupPanel = mk("div", { display: "none", flexDirection: "column", gap: "10px", flex: "1", minHeight: "0", overflowY: "auto" });
      panels["Setup"] = setupPanel;
      body.appendChild(setupPanel);
      const setupRequired = mk("div", { display: "flex", flexDirection: "column", gap: "4px" });
      const setupOptional = mk("div", { display: "flex", flexDirection: "column", gap: "4px" });
      const setupInstallBtn = mk("button", { alignSelf: "flex-start", background: LIME, color: "#111", border: "none", borderRadius: "7px", padding: "7px 14px", fontSize: "10px", fontWeight: "800", cursor: "pointer" });
      tx(setupInstallBtn, "Install missing required items");
      const setupOptInstallBtn = mk("button", { alignSelf: "flex-start", background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: "7px", padding: "7px 14px", fontSize: "10px", fontWeight: "700", cursor: "pointer" });
      tx(setupOptInstallBtn, "Install missing optional items");
      const setupStatusLine = mk("div", { fontSize: "10px", color: C.muted, lineHeight: "1.5" });
      const setupRequiredCard = card("Required");
      setupRequiredCard.style.flex = "1";
      setupRequiredCard.appendChild(note("Code-only custom nodes H3 Suite needs to run. Small and quick to install."));
      setupRequiredCard.append(setupRequired, setupInstallBtn);
      const setupOptionalCard = card("Optional — speed / large downloads");
      setupOptionalCard.style.flex = "1";
      setupOptionalCard.appendChild(note("Model weights and GPU-specific speed packs. These downloads are large and only start when you ask."));
      setupOptionalCard.append(setupOptional, setupOptInstallBtn);
      const setupPathsCard = card("Where things live");
      setupPathsCard.style.flex = "1";
      [
        ["Generated videos", "ComfyUI/output/h3-suite/ — these are what the Library tab lists."],
        ["Result metadata", "output/h3-suite/metadata/*.json — prompt and settings per video, used by \"Load settings into UI\"."],
        ["Camera guides", "ComfyUI/input/ — rendered guides land there so they can be picked as Video 2."],
      ].forEach(([k, v]) => {
        const row = mk("div", { display: "flex", flexDirection: "column", gap: "2px" });
        const key = mk("div", { fontSize: "10px", color: C.text, fontWeight: "700" }); tx(key, k);
        row.append(key, note(v));
        setupPathsCard.appendChild(row);
      });

      const setupRow = mk("div", { display: "flex", gap: "12px", alignItems: "flex-start" });
      setupRow.append(setupRequiredCard, setupOptionalCard, setupPathsCard);
      setupPanel.append(setupRow, setupStatusLine);

      let _lastStatus = null;
      function renderStatusList(container, items) {
        container.innerHTML = "";
        items.forEach(it => {
          const row = mk("div", { display: "flex", alignItems: "center", gap: "8px", fontSize: "10px" });
          const dot = mk("span", { color: it.ok ? C.ok : C.warn }); tx(dot, it.ok ? "●" : "○");
          const lbl = mk("span", { color: C.text }); tx(lbl, it.label);
          if (it.kind === "model" && !it.ok) {
            const pct = _lastStatus?.progress?.[it.id]?.percent;
            if (pct != null) { const p = mk("span", { color: C.muted }); tx(p, ` — ${pct}%`); lbl.appendChild(p); }
          }
          row.append(dot, lbl);
          container.appendChild(row);
        });
      }
      async function refreshStatus() {
        try {
          const r = await api.fetchApi("/h3suite/setup/status");
          const d = await r.json();
          _lastStatus = d;
          renderStatusList(setupRequired, d.required);
          renderStatusList(setupOptional, d.optional);
          const gb = (d.missing_optional_bytes || 0) / (1000 ** 3);
          tx(setupOptInstallBtn, gb > 0 ? `Install missing optional items (~${gb.toFixed(1)}GB)` : "Install missing optional items (nothing missing)");
        } catch (e) { tx(setupStatusLine, "Could not reach H3 Suite backend: " + fmtErr(e)); }
      }
      setupInstallBtn.onclick = async () => {
        if (!_lastStatus) return;
        const missing = _lastStatus.required.filter(i => !i.ok).map(i => i.id);
        if (!missing.length) { tx(setupStatusLine, "Everything required is already installed."); return; }
        tx(setupStatusLine, "Installing… this can take a minute (git clone).");
        await api.fetchApi("/h3suite/setup/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: missing }) });
        pollUntilDone();
      };
      setupOptInstallBtn.onclick = async () => {
        if (!_lastStatus) return;
        const missing = _lastStatus.optional.filter(i => !i.ok).map(i => i.id);
        if (!missing.length) { tx(setupStatusLine, "Nothing optional is missing."); return; }
        tx(setupStatusLine, "Installing… model downloads can take a long time depending on your connection.");
        await api.fetchApi("/h3suite/setup/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: missing }) });
        pollUntilDone();
      };
      let _pollTimer = null;
      function pollUntilDone() {
        if (_pollTimer) clearInterval(_pollTimer);
        _pollTimer = setInterval(async () => {
          await refreshStatus();
        }, 4000);
      }

      // ── Library panel ─────────────────────────────────────────────────────
      const libPanel = mk("div", { display: "none", flexDirection: "column", gap: "8px", position: "relative", flex: "1", minHeight: "0" });
      panels["Library"] = libPanel;
      body.appendChild(libPanel);

      const libToolbar = mk("div", { display: "flex", alignItems: "center", gap: "8px" });
      let _libFavOnly = false;
      const libFavBtn = mk("button", {
        background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: "6px",
        padding: "4px 10px", fontSize: "10px", cursor: "pointer", outline: "none",
        transition: "border-color .15s,color .15s,background .15s",
      });
      tx(libFavBtn, "♥ Favorites");
      const _setLibFavBtn = (active) => {
        _libFavOnly = active;
        libFavBtn.style.background = active ? "rgba(240,255,65,.15)" : "none";
        libFavBtn.style.borderColor = active ? LIME : C.border;
        libFavBtn.style.color = active ? LIME : C.muted;
      };
      libFavBtn.onclick = () => { _setLibFavBtn(!_libFavOnly); libLoad(true); };
      const libRefreshBtn = mk("button", {
        background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: "6px",
        padding: "4px 10px", fontSize: "10px", cursor: "pointer", outline: "none",
      });
      tx(libRefreshBtn, "↺ Refresh");
      libRefreshBtn.onclick = () => libLoad(true);
      const libCount = mk("div", { fontSize: "9px", color: C.muted, marginLeft: "auto" });
      libToolbar.append(libFavBtn, libRefreshBtn, libCount);

      const libScroll = mk("div", { flex: "1", minHeight: "0", overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: "8px", padding: "8px", boxSizing: "border-box" });
      const libGrid = mk("div", { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(158px,1fr))", gap: "8px" });
      const libEmpty = mk("div", { fontSize: "10px", color: C.muted, textAlign: "center", padding: "30px 0", display: "none" });
      tx(libEmpty, "No generations yet — run Generate to fill your library.");
      const libSentinel = mk("div", { height: "2px" });
      libScroll.append(libGrid, libEmpty, libSentinel);
      libPanel.append(libToolbar, libScroll);

      let _libItems = [], _libTotal = 0, _libOffset = 0, _libLoading = false;
      const LIB_LIMIT = 40;
      const _libIo = new IntersectionObserver(entries => {
        if (!entries[0].isIntersecting) return;
        if (_libLoading || _libFavOnly || _libOffset >= _libTotal) return;
        libLoad(false);
      }, { root: libScroll, threshold: 0 });
      _libIo.observe(libSentinel);

      const _libVideoUrl = (v) => api.apiURL(`/view?filename=${encodeURIComponent(v.filename)}&type=output&subfolder=${encodeURIComponent(v.subfolder || "")}&t=${v.mtime}`);

      function _libAppend(items, startIdx) {
        items.forEach((v, i) => {
          const idx = startIdx + i;
          const cell = mk("div", {
            position: "relative", borderRadius: "8px", overflow: "hidden", background: C.bg2,
            border: `1px solid ${v.favorite ? "rgba(240,255,65,.4)" : C.border}`, cursor: "pointer",
            aspectRatio: "16/9", transition: "border-color .15s",
          });
          const thumb = mk("video", {
            width: "100%", height: "100%", objectFit: "cover", display: "block",
            position: "absolute", inset: "0", background: C.bg3,
          }, { muted: true, preload: "metadata", playsinline: true, loop: true });
          thumb.src = _libVideoUrl(v);
          thumb.addEventListener("loadedmetadata", () => { try { thumb.currentTime = Math.min(0.15, thumb.duration || 0); } catch (e) { } }, { once: true });
          const strip = mk("div", {
            position: "absolute", bottom: "0", left: "0", right: "0", padding: "3px 5px", fontSize: "8px",
            color: "#ccc", background: "rgba(0,0,0,.65)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          });
          tx(strip, new Date(v.mtime * 1000).toLocaleString());
          const favIco = mk("div", { position: "absolute", top: "4px", right: "4px", fontSize: "10px", color: LIME, display: v.favorite ? "block" : "none", textShadow: "0 1px 2px rgba(0,0,0,.9)" });
          tx(favIco, "♥");
          cell.append(thumb, strip, favIco);
          cell.onmouseenter = () => { cell.style.borderColor = LIME; thumb.currentTime = 0; thumb.play && thumb.play().catch(() => { }); };
          cell.onmouseleave = () => { cell.style.borderColor = v.favorite ? "rgba(240,255,65,.4)" : C.border; thumb.pause && thumb.pause(); };
          cell.onclick = () => lbShow(v, idx);
          libGrid.appendChild(cell);
        });
      }

      async function libLoad(reset) {
        if (_libLoading && !reset) return;
        _libLoading = true;
        if (reset) { _libItems = []; _libOffset = 0; libGrid.innerHTML = ""; }
        tx(libCount, "loading…");
        try {
          const url = `/h3suite/gallery?offset=${_libOffset}&limit=${LIB_LIMIT}${_libFavOnly ? "&favonly=1" : ""}`;
          const r = await api.fetchApi(url);
          const d = await r.json();
          const items = d.videos || [];
          _libTotal = d.total || 0;
          const startIdx = _libItems.length;
          _libItems.push(...items);
          _libOffset = _libItems.length;
          libEmpty.style.display = _libItems.length ? "none" : "block";
          _libAppend(items, startIdx);
          tx(libCount, `${_libTotal}${_libFavOnly ? " favorite" : ""} video${_libTotal === 1 ? "" : "s"}`);
        } catch (e) {
          tx(libCount, "error: " + fmtErr(e));
        } finally { _libLoading = false; }
      }

      // ── Library lightbox ────────────────────────────────────────────────
      const lbOverlay = mk("div", {
        position: "absolute", inset: "0", zIndex: "20", background: "#0a0a0a", borderRadius: "8px",
        display: "none", flexDirection: "column", padding: "10px", boxSizing: "border-box",
      });
      const lbTop = mk("div", { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexShrink: "0" });
      const lbFilename = mk("div", { fontSize: "10px", color: C.muted, flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
      const lbCounter = mk("div", { fontSize: "9px", color: C.muted, flexShrink: "0" });
      const lbCloseBtn = mk("button", { background: "none", border: `1px solid ${C.err}`, color: C.err, borderRadius: "6px", padding: "3px 10px", fontSize: "10px", cursor: "pointer" });
      tx(lbCloseBtn, "✕");
      lbTop.append(lbFilename, lbCounter, lbCloseBtn);

      const lbBody = mk("div", { display: "flex", alignItems: "center", flex: "1", minHeight: "0", gap: "6px", padding: "6px 0" });
      const lbArrowL = mk("button", { background: "rgba(255,255,255,.08)", border: "none", borderRadius: "6px", width: "30px", alignSelf: "stretch", cursor: "pointer", fontSize: "16px", color: C.text });
      tx(lbArrowL, "‹");
      const lbVidWrap = mk("div", { flex: "1", minWidth: "0", display: "flex", alignItems: "center", justifyContent: "center", height: "100%" });
      const lbVideo = mk("video", { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: "6px", background: "#000" }, { controls: true, loop: true });
      lbVidWrap.appendChild(lbVideo);
      const lbArrowR = mk("button", { background: "rgba(255,255,255,.08)", border: "none", borderRadius: "6px", width: "30px", alignSelf: "stretch", cursor: "pointer", fontSize: "16px", color: C.text });
      tx(lbArrowR, "›");
      lbBody.append(lbArrowL, lbVidWrap, lbArrowR);

      const lbMeta = mk("div", { flexShrink: "0", background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "8px", padding: "8px 10px", display: "flex", flexDirection: "column", gap: "6px" });
      const lbPromptText = mk("div", { fontSize: "10px", color: C.text, lineHeight: "1.5", maxHeight: "40px", overflowY: "auto" });
      const lbChipsRow = mk("div", { display: "flex", gap: "6px", flexWrap: "wrap" });
      const _libChip = () => mk("div", { background: C.bg3, borderRadius: "5px", padding: "3px 7px", fontSize: "9px", color: C.muted });
      const lbChipRes = _libChip(), lbChipSteps = _libChip(), lbChipDur = _libChip(), lbChipTime = _libChip();
      lbChipsRow.append(lbChipRes, lbChipSteps, lbChipDur, lbChipTime);
      const lbActionsRow = mk("div", { display: "flex", gap: "6px", flexWrap: "wrap" });
      const lbFavBtn = mk("button", { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: "6px", padding: "5px 10px", fontSize: "10px", cursor: "pointer" });
      const lbRestoreBtn = mk("button", { background: LIME, color: "#111", border: "none", borderRadius: "6px", padding: "5px 12px", fontSize: "10px", fontWeight: "700", cursor: "pointer" });
      tx(lbRestoreBtn, "Load settings into UI");
      const lbUpscaleBtn = mk("button", { background: "none", border: `1px solid ${C.lime || LIME}`, color: LIME, borderRadius: "6px", padding: "5px 12px", fontSize: "10px", fontWeight: "700", cursor: "pointer" });
      tx(lbUpscaleBtn, "⚡ Upscale este vídeo");
      const lbOpenBtn = mk("button", { background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: "6px", padding: "5px 10px", fontSize: "10px", cursor: "pointer" });
      tx(lbOpenBtn, "Open folder");
      const lbDeleteBtn = mk("button", { background: "none", border: `1px solid ${C.err}`, color: C.err, borderRadius: "6px", padding: "5px 10px", fontSize: "10px", cursor: "pointer" });
      tx(lbDeleteBtn, "Delete");
      lbActionsRow.append(lbFavBtn, lbRestoreBtn, lbUpscaleBtn, lbOpenBtn, lbDeleteBtn);
      lbMeta.append(lbPromptText, lbChipsRow, lbActionsRow);

      lbOverlay.append(lbTop, lbBody, lbMeta);
      libPanel.appendChild(lbOverlay);

      let _lbIdx = 0, _lbActive = null, _lbFavActive = false;

      function _setLbFav(active) {
        _lbFavActive = active;
        tx(lbFavBtn, active ? "♥ Favorited" : "♡ Favorite");
        lbFavBtn.style.borderColor = active ? LIME : C.border;
        lbFavBtn.style.color = active ? LIME : C.muted;
      }

      function _libClose() {
        lbOverlay.style.display = "none";
        lbVideo.pause && lbVideo.pause(); lbVideo.src = "";
        _lbActive = null;
      }
      lbCloseBtn.onclick = _libClose;

      async function lbShow(v, idx) {
        _lbActive = v; _lbIdx = idx;
        tx(lbFilename, v.filename);
        lbVideo.src = _libVideoUrl(v);
        lbVideo.play && lbVideo.play().catch(() => { });
        lbOverlay.style.display = "flex";
        tx(lbCounter, `${idx + 1} / ${_libItems.length}`);
        lbArrowL.style.opacity = idx > 0 ? "1" : ".3";
        lbArrowR.style.opacity = idx < _libItems.length - 1 ? "1" : ".3";
        tx(lbPromptText, "Loading…");
        lbRestoreBtn.style.display = "none";
        lbUpscaleBtn.style.display = "none";
        _setLbFav(v.favorite === true);
        let meta = null;
        try {
          const r = await api.fetchApi(`/h3suite/meta?filename=${encodeURIComponent(v.filename)}&subfolder=${encodeURIComponent(v.subfolder || "")}`);
          const d = await r.json();
          meta = d.ok ? d.meta : null;
        } catch (e) { meta = null; }
        if (_lbActive !== v) return; // navigated away while awaiting
        _lbActive.meta = meta;
        if (meta) {
          tx(lbPromptText, meta.prompt || "(no prompt saved)");
          tx(lbChipRes, meta.resolutionPreset || "—");
          tx(lbChipSteps, meta.steps != null ? `${meta.steps} steps` : "—");
          tx(lbChipDur, meta.duration != null ? `${meta.duration}s` : "—");
          tx(lbChipTime, meta.genTimeSec != null ? `${meta.genTimeSec}s gen` : "—");
          lbRestoreBtn.style.display = "inline-block";
          lbUpscaleBtn.style.display = "inline-block";
        } else {
          tx(lbPromptText, "⚠ No metadata saved for this video.");
          tx(lbChipRes, "—"); tx(lbChipSteps, "—"); tx(lbChipDur, "—"); tx(lbChipTime, "—");
        }
      }

      lbFavBtn.onclick = async () => {
        if (!_lbActive) return;
        const next = !_lbFavActive;
        _setLbFav(next);
        _lbActive.favorite = next;
        try {
          await api.fetchApi("/h3suite/update_meta", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: _lbActive.filename, subfolder: _lbActive.subfolder || "", patch: { favorite: next } }),
          });
        } catch (e) { }
      };

      function applyMetaToUI(meta) {
        if (!meta) return;
        if (meta.prompt != null) { S.prompt = meta.prompt; promptTA.value = meta.prompt; }
        if (meta.resolutionPreset) { S.resolutionPreset = meta.resolutionPreset; resSel.setValue(meta.resolutionPreset); }
        if (meta.duration != null) { S.duration = meta.duration; durNum.setValue(meta.duration); }
        if (meta.steps != null) { S.steps = meta.steps; stepsNum.setValue(meta.steps); }
        if (meta.seed != null) { S.seed = meta.seed; seedNum.setValue(meta.seed); }
        if (meta.visualStrength != null) { S.visualStrength = meta.visualStrength; visStrNum.setValue(meta.visualStrength); }
        if (meta.audioStrength != null) { S.audioStrength = meta.audioStrength; audStrNum.setValue(meta.audioStrength); }
        if (meta.wardrobeCrop != null) { S.wardrobeCrop = meta.wardrobeCrop; wardrobeCropNum.setValue(meta.wardrobeCrop); }
        if (meta.refs) {
          S.pics = { ...(meta.refs.pics || {}) };
          S.vids = { ...(meta.refs.vids || {}) };
          S.auds = { ...(meta.refs.auds || {}) };
          Object.keys(picSlots).forEach(k => picSlots[k].setName(S.pics[k] || null));
          Object.keys(vidSlots).forEach(k => vidSlots[k].setName(S.vids[k] || null));
          Object.keys(audSlots).forEach(k => audSlots[k].setName(S.auds[k] || null));
          updateRefBadge();
        }
        persist();
      }

      lbRestoreBtn.onclick = () => {
        const meta = _lbActive?.meta;
        if (!meta) return;
        applyMetaToUI(meta);
        _libClose();
        setTab("References");
      };

      // "Upscale este vídeo" — loads this video's saved prompt/refs/resolution/
      // steps/seed (same as "Load settings into UI") and forces on the same
      // Latent Upscale 3D fp16 pass used by the "Otimizado + Upscale" preset,
      // then queues generation right away. If this video was generated with
      // H3:savelatent (any plain/derope render since this feature shipped), its
      // Pass 1 latent is on disk -- _fastUpscaleLatent below makes genBtn's
      // handler load it straight into Pass 2 instead of re-sampling Pass 1,
      // which is most of the render time. Older videos (or ones generated with
      // upscale already on, which never save a Pass 1 latent) have no
      // meta.latentFile, so this falls back to a full regenerate with the same
      // seed -- reproduces the same clip, just slower.
      lbUpscaleBtn.onclick = () => {
        const meta = _lbActive?.meta;
        if (!meta) return;
        applyMetaToUI(meta);
        if (!S._presetSnapshot) { S._presetSnapshot = snapshotPresetFields(); }
        const up = OTIMIZADO_CONFIG.upscale;
        if (S.derope) { S.derope = false; deropeToggle.setValue(false); }
        S.upscale = true; upscaleToggle.setValue(true);
        S.upscaleModel = up.model; upscaleModelSel.setValue(up.model);
        S.upscaleMultiplier = up.multiplier; upscaleMultNum.setValue(up.multiplier);
        S.upscalePass2Steps = up.pass2Steps; upscalePass2Num.setValue(up.pass2Steps);
        persist();
        refreshModelLists();
        updateRestoreBtnState();
        _fastUpscaleLatent = meta.latentFile || null;
        _libClose();
        setTab("References");
        genBtn.click();
      };

      lbOpenBtn.onclick = async () => {
        if (!_lbActive) return;
        try {
          await api.fetchApi("/h3suite/open_folder", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: _lbActive.filename, subfolder: _lbActive.subfolder || "" }),
          });
        } catch (e) { }
      };

      lbDeleteBtn.onclick = async () => {
        if (!_lbActive) return;
        if (!window.confirm(`Delete ${_lbActive.filename}? This cannot be undone.`)) return;
        try {
          await api.fetchApi("/h3suite/delete", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: _lbActive.filename, subfolder: _lbActive.subfolder || "" }),
          });
        } catch (e) { }
        _libClose();
        libLoad(true);
      };

      async function _libNav(i) {
        if (i >= _libItems.length && _libOffset < _libTotal && !_libFavOnly) await libLoad(false);
        i = Math.max(0, Math.min(_libItems.length - 1, i));
        lbShow(_libItems[i], i);
      }
      lbArrowL.onclick = () => _libNav(_lbIdx - 1);
      lbArrowR.onclick = () => _libNav(_lbIdx + 1);

      const _libKeydownHandler = (e) => {
        if (lbOverlay.style.display === "none") return;
        if (e.key === "Escape") { e.preventDefault(); _libClose(); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); _libNav(_lbIdx - 1); }
        else if (e.key === "ArrowRight") { e.preventDefault(); _libNav(_lbIdx + 1); }
        else if (e.key === "f" || e.key === "F") { e.preventDefault(); if (lbVideo.requestFullscreen) lbVideo.requestFullscreen().catch(() => { }); }
      };
      document.addEventListener("keydown", _libKeydownHandler, { capture: true });

      let _libNeedsRefresh = true;

      setTab("References");
      refreshStatus();

      // ── Build reference slots once the fixed role map is loaded ────────────
      const picSlots = {}, vidSlots = {}, audSlots = {};
      async function loadReferenceMap() {
        try {
          const r = await api.fetchApi("/h3suite/reference_map");
          refMap = await r.json();
        } catch (e) {
          refMap = { pictures: [], videos: [], audios: [] };
        }
        picGrid.innerHTML = ""; vidGrid.innerHTML = ""; audGrid.innerHTML = "";
        (refMap.pictures || []).forEach(p => {
          const col = mk("div", { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" });
          const slot = MediaSlot("image", p.short, `${p.label}\n${p.tooltip || ""}`, (name) => { if (name) S.pics[p.key] = name; else delete S.pics[p.key]; persist(); updateRefBadge(); });
          if (S.pics[p.key]) slot.setName(S.pics[p.key]);
          picSlots[p.key] = slot;
          const lbl = mk("div", { fontSize: "8px", color: C.muted, textAlign: "center" }); tx(lbl, `${p.slot}. ${p.short}`);
          col.append(slot.el, lbl); picGrid.appendChild(col);
        });
        (refMap.videos || []).forEach(v => {
          const col = mk("div", { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" });
          const slot = MediaSlot("video", v.short, `${v.label}\n${v.tooltip || ""}`, (name) => { if (name) S.vids[v.key] = name; else delete S.vids[v.key]; persist(); updateRefBadge(); });
          if (S.vids[v.key]) slot.setName(S.vids[v.key]);
          vidSlots[v.key] = slot;
          const lbl = mk("div", { fontSize: "8px", color: C.muted, textAlign: "center" }); tx(lbl, `${v.slot}. ${v.short}`);
          col.append(slot.el, lbl);
          if (v.key === "camera_video") {
            const camBtn = mk("button", { fontSize: "7px", background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: "4px", padding: "2px 5px", cursor: "pointer" });
            tx(camBtn, "Camera Director"); camBtn.onclick = () => setTab("Camera");
            col.appendChild(camBtn);
          }
          if (v.key === "motion_video") {
            const motionDirBtn = mk("button", { fontSize: "7px", background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: "4px", padding: "2px 5px", cursor: "pointer" });
            tx(motionDirBtn, "Motion Director"); motionDirBtn.onclick = () => setTab("Motion");
            col.appendChild(motionDirBtn);
          }
          vidGrid.appendChild(col);
        });
        (refMap.audios || []).forEach(a => {
          const col = mk("div", { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" });
          const slot = MediaSlot("audio", a.short, `${a.label}\n${a.tooltip || ""}`, (name) => { if (name) S.auds[a.key] = name; else delete S.auds[a.key]; persist(); updateRefBadge(); });
          if (S.auds[a.key]) slot.setName(S.auds[a.key]);
          audSlots[a.key] = slot;
          const lbl = mk("div", { fontSize: "8px", color: C.muted, textAlign: "center" }); tx(lbl, `${a.slot}. ${a.short}`);
          col.append(slot.el, lbl); audGrid.appendChild(col);
        });
        updateRefBadge();
      }
      loadReferenceMap();

      // ── Reference tags ────────────────────────────────────────────────────
      // No references at all is a fully supported mode: H3SemanticReferenceToVideo
      // takes every reference as an optional input and simply skips the
      // minimax_refs conditioning when none are connected — i.e. plain
      // text-to-video. The one thing that DOES break it is a reference tag in the
      // prompt with no media behind it: the node's _rewrite_family() raises
      // "prompt references media that is not active". It matches the bare form
      // ("Picture 1") as well as "<Picture 1>", so the mirrored check below has to
      // do the same, and Audio 3 is only legal as Video 3's own soundtrack.
      function activeRefSummary() {
        const parts = [];
        (refMap.pictures || []).forEach(p => { if (S.pics[p.key]) parts.push(`Picture ${p.slot} (${p.label})`); });
        (refMap.videos || []).forEach(v => { if (S.vids[v.key]) parts.push(`Video ${v.slot} (${v.label})`); });
        (refMap.audios || []).forEach(a => { if (S.auds[a.key]) parts.push(`Audio ${a.slot} (${a.label})`); });
        return parts.length ? parts.join(", ") : "none";
      }

      function activeRefCount() {
        return Object.keys(S.pics).length + Object.keys(S.vids).length + Object.keys(S.auds).length;
      }

      function activeTagNumbers() {
        const out = { Picture: new Set(), Video: new Set(), Audio: new Set() };
        (refMap.pictures || []).forEach(p => { if (S.pics[p.key]) out.Picture.add(p.slot); });
        (refMap.videos || []).forEach(v => { if (S.vids[v.key]) out.Video.add(v.slot); });
        (refMap.audios || []).forEach(a => { if (S.auds[a.key]) out.Audio.add(a.slot); });
        // Video 3's paired soundtrack occupies logical Audio 3, but only while no
        // external Audio 1/2 is active (they override it) — same rule as the node.
        if (S.vids["source_video"] && !out.Audio.size) out.Audio.add(3);
        return out;
      }

      const TAG_FAMILY_MAX = { Picture: 9, Video: 3, Audio: 3 };
      function tagPatterns(family, n) {
        return [new RegExp(`<${family}\\s+${n}>`, "ig"), new RegExp(`\\b${family}\\s+${n}\\b`, "ig")];
      }

      // Tags in the text that no active reference backs — these are what would
      // abort the render server-side.
      function findOrphanTags(text) {
        const active = activeTagNumbers();
        const orphans = [];
        Object.keys(TAG_FAMILY_MAX).forEach(family => {
          for (let n = 1; n <= TAG_FAMILY_MAX[family]; n++) {
            if (active[family].has(n)) continue;
            if (tagPatterns(family, n).some(re => re.test(text))) orphans.push(`${family} ${n}`);
          }
        });
        return orphans;
      }

      // Drop orphan tags, then tidy the punctuation/whitespace they leave behind.
      function stripOrphanTags(text) {
        const active = activeTagNumbers();
        let out = text;
        Object.keys(TAG_FAMILY_MAX).forEach(family => {
          for (let n = 1; n <= TAG_FAMILY_MAX[family]; n++) {
            if (active[family].has(n)) continue;
            tagPatterns(family, n).forEach(re => { out = out.replace(re, ""); });
          }
        });
        return out.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:])/g, "$1").replace(/\(\s*\)/g, "").replace(/\n{3,}/g, "\n\n").trim();
      }
      let _enhanceBusy = false;
      enhanceBtn.onclick = async () => {
        if (_enhanceBusy) return;
        const text = (promptTA.value || "").trim();
        if (!text) { tx(enhanceStatus, "Type a rough idea first."); return; }
        _enhanceBusy = true; enhanceBtn.disabled = true; tx(enhanceStatus, "Enhancing…");
        try {
          const sysR = await api.fetchApi("/h3suite/prompt_system");
          const sys = await sysR.text();
          // Spell the text-only case out instead of leaving the model to infer it
          // from "Active: none" — a leaked tag is a hard render failure, and the
          // rest of the ruleset is written around references existing.
          const modeBlock = activeRefCount() === 0
            ? "Active: none\nTEXT-ONLY MODE IS IN FORCE. No reference image, video or audio is attached to this render. "
              + "Follow the TEXT-ONLY MODE section of the ruleset: describe identity, wardrobe, product, environment, "
              + "lighting, camera and audio entirely in words, and do not write Picture, Video or Audio followed by a "
              + "number anywhere in the output, with or without angle brackets."
            : `Active: ${activeRefSummary()}`;
          const fullSys = `${sys}\n\n${modeBlock}`;
          const wfR = await api.fetchApi("/h3suite/workflow_prompt_enhance");
          if (!wfR.ok) throw new Error("HTTP " + wfR.status);
          const wf = await wfR.json();
          const ep = JSON.parse(JSON.stringify(wf));
          ep["H3:enh_gen"].inputs.prompt = `${fullSys}\n\nUser prompt:\n${text}`;
          ep["H3:enh_gen"].inputs.max_length = 900;
          const qR = await api.fetchApi("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: ep, client_id: api.clientId }) });
          const qD = await qR.json();
          if (qD.error) throw new Error(fmtErr(qD.error));
          const promptId = qD.prompt_id;
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => { cleanup(); reject(new Error("Timed out waiting for the LLM.")); }, 120000);
            const cleanup = () => { api.removeEventListener("executed", handler); clearTimeout(timeout); };
            const handler = (ev) => { const d = ev.detail || ev; if (d.prompt_id !== promptId) return; cleanup(); resolve(d); };
            api.addEventListener("executed", handler);
          });
          const histR = await api.fetchApi(`/history/${promptId}`);
          const histD = await histR.json();
          const out = histD[promptId]?.outputs?.["H3:enh_gen"] || histD[promptId]?.outputs?.["H3:enh_save"];
          const resultText = (out?.text || out?.string || [])[0];
          if (!resultText || !resultText.trim()) throw new Error("The LLM returned an empty result.");
          // Local LLMs ignore instructions often enough that this can't be trusted
          // to the system prompt alone — a single leaked tag aborts the render.
          let finalText = resultText.trim();
          const leaked = findOrphanTags(finalText);
          if (leaked.length) finalText = stripOrphanTags(finalText);
          promptTA.value = finalText; S.prompt = finalText; persist();
          clearError();
          tx(enhanceStatus, leaked.length
            ? `Done — removed tags with no reference behind them (${leaked.join(", ")}).`
            : "Done.");
        } catch (err) {
          tx(enhanceStatus, "Failed: " + fmtErr(err));
        } finally { _enhanceBusy = false; enhanceBtn.disabled = false; }
      };

      // ── Generate ──────────────────────────────────────────────────────────
      function extractOutputFile(outputs, nodeId) {
        const out = outputs?.[nodeId]; if (!out) return null;
        for (const key of ["video", "videos", "images", "gifs"]) {
          if (Array.isArray(out[key]) && out[key].length) return out[key][0];
        }
        return null;
      }

      let _generating = false, _promptId = null;
      // Set by the Library's "Upscale este vídeo" button when the video being
      // upscaled has a saved Pass 1 latent -- consumed (and cleared) by the
      // very next genBtn.onclick run, which then loads that latent instead of
      // re-running Pass 1's sampling loop. Stays null for every normal click.
      let _fastUpscaleLatent = null;
      function resetGenBtn() {
        _generating = false; genBtn.disabled = false; tx(genBtn, "Generate");
        stopBtn.style.display = "none"; progWrap.style.display = "none"; stageLbl.style.display = "none";
        progBar.style.width = "0%"; tx(progLbl, "");
      }
      genBtn.onclick = async () => {
        if (_generating) return;
        clearError();
        const text = (promptTA.value || "").trim();
        if (!text) { showError("Type a prompt first."); return; }
        // Catch dangling reference tags here rather than letting the sampler start
        // and die on the node's ValueError — and offer the one-click fix.
        const orphans = findOrphanTags(text);
        if (orphans.length) {
          const noRefs = activeRefCount() === 0;
          showError(
            `The prompt mentions ${orphans.join(", ")}, but ${noRefs ? "no reference is loaded" : "those slots are empty"}. `
            + "H3 refuses to render with tags that have no media behind them — remove them, or load the matching references.",
            { label: "Remove those tags", onClick: () => {
              promptTA.value = stripOrphanTags(promptTA.value); S.prompt = promptTA.value; persist(); clearError();
            } });
          return;
        }
        _generating = true; genBtn.disabled = true; tx(genBtn, "Generating…");
        stopBtn.style.display = "inline-block"; progWrap.style.display = "block"; stageLbl.style.display = "block";
        progBar.style.width = "0%"; tx(progLbl, ""); tx(stageLbl, "Preparing workflow…");
        const _genStartedAt = Date.now();
        let _samplingStartedAt = null;

        try {
          const wfR = await api.fetchApi("/h3suite/workflow_director");
          if (!wfR.ok) throw new Error("HTTP " + wfR.status + " (restart ComfyUI if this node was just installed)");
          const wf = await wfR.json();
          const prompt = JSON.parse(JSON.stringify(wf));

          prompt["H3:unet"].inputs.unet_name = S.models.unet || CANONICAL_MODELS.unet;
          prompt["H3:clip"].inputs.clip_name = S.models.clip || CANONICAL_MODELS.clip;
          prompt["H3:vae_video"].inputs.vae_name = S.models.vae_video || CANONICAL_MODELS.vae_video;
          prompt["H3:vae_audio"].inputs.vae_name = S.models.vae_audio || CANONICAL_MODELS.vae_audio;
          prompt["H3:semantic"].inputs.prompt = text;
          prompt["H3:resolution"].inputs.preset = S.resolutionPreset;
          prompt["H3:duration"].inputs.seconds = S.duration;
          // "Steps" above is always Pass 1's count. With Latent Upscale on, the
          // scheduler needs the FULL curve (both passes) so SplitSigmas below can
          // cut it at the Pass 1/Pass 2 boundary -- same trick the "Superb Realism"
          // reference workflow uses (total steps minus split = Pass 2 steps).
          prompt["H3:scheduler"].inputs.steps = S.upscale ? (S.steps + S.upscalePass2Steps) : S.steps;
          prompt["H3:condstrength"].inputs.visual_strength = S.visualStrength;
          prompt["H3:condstrength"].inputs.audio_strength = S.audioStrength;
          prompt["H3:semantic"].inputs.wardrobe_head_crop_pct = S.wardrobeCrop;

          // De-RoPE's v2v pass regenerates the clip at a DIFFERENT (dilated) length
          // than Pass 1, so it needs its own reference-conditioning call rather than
          // reusing H3:semantic's -- start it as a copy of Pass 1's (same prompt,
          // resolution, refs) and the Pictures/Videos/Audio loops below mirror every
          // ref onto it too. Its "length" gets corrected to the dilated frame count
          // once H3 Time Smear exists, in the De-RoPE chain further down.
          if (S.derope) {
            prompt["H3:derope_cond"] = JSON.parse(JSON.stringify(prompt["H3:semantic"]));
            prompt["H3:derope_cond"]._meta = { title: "De-RoPE Pass 2 Conditioning" };
          }

          const seedVal = S.randomizeSeed ? Math.floor(Math.random() * 1e12) : S.seed;
          prompt["H3:seed"].inputs.noise_seed = seedVal;
          prompt["H3:seed"].inputs.control_after_generate = S.randomizeSeed ? "randomize" : "fixed";
          if (S.randomizeSeed) { S.seed = seedVal; seedNum.setValue(seedVal); persist(); }

          // LoRA chain: unet -> [lora1?] -> [lora2?] -> [lora3?] -> speed chain below.
          // Applied before the speed optimizations so FirstBlockCache/Sol-Attn/Sage
          // see the final, LoRA-patched model rather than patching around it.
          let modelSrc = ["H3:unet", 0];
          S.loras.forEach((lora, i) => {
            if (!lora.enabled || !lora.name) return;
            const nodeId = `H3:lora${i + 1}`;
            prompt[nodeId] = { class_type: "LoraLoaderModelOnly", inputs: { model: modelSrc, lora_name: lora.name, strength_model: lora.strength } };
            modelSrc = [nodeId, 0];
          });

          // Speed chain: [lora chain output] -> [fbcache?] -> [sage? xor solattn?] -> [lowvram?] -> scheduler/guider
          if (S.fbcache) {
            prompt["H3:fbcache"] = { class_type: "ApplyMiniMaxH3FirstBlockCache", inputs: { model: modelSrc, mode: S.fbcacheMode, threshold: 0.08, start_percent: 0.1, end_percent: 0.95, max_consecutive_hits: 2, temporal_guard: false } };
            modelSrc = ["H3:fbcache", 0];
          }
          if (S.sage) {
            prompt["H3:sage"] = { class_type: "PathchSageAttentionKJ", inputs: { model: modelSrc, sage_attention: "auto", allow_compile: false } };
            modelSrc = ["H3:sage", 0];
          } else if (S.solattn) {
            const sp = SOLATTN_PARAMS[S.solattnMode] || SOLATTN_PARAMS["Balanced — tau 1.3"];
            prompt["H3:solattn"] = { class_type: "MiniMaxH3MemoryEfficientSolAttentionPatch", inputs: { model: modelSrc, enabled: true, tau: sp.tau, min_tokens: 4096, strict: false, thresh_type: "diag", int8_qk: sp.int8_qk, int8_pv: sp.int8_pv, sink_conditioning: "exact_kv", dense_blocks: "" } };
            modelSrc = ["H3:solattn", 0];
          }
          if (S.lowvram) {
            prompt["H3:lowvram"] = { class_type: "MiniMaxLowVRAMAttention", inputs: { model: modelSrc, head_chunks: S.headChunks } };
            modelSrc = ["H3:lowvram", 0];
          }
          prompt["H3:scheduler"].inputs.model = modelSrc;
          prompt["H3:guider"].inputs.model = modelSrc;

          // Consume the one-shot "load this instead of sampling Pass 1" override
          // set by the Library's "Upscale este vídeo" button. Cleared immediately
          // so it never silently affects a later, ordinary click.
          const fastLatent = _fastUpscaleLatent;
          _fastUpscaleLatent = null;

          // Persist Pass 1's own latent whenever this run does NOT already run
          // the upscale pass on it (a fastLatent run has S.upscale true, so this
          // never re-saves a latent it just loaded) -- so a later Library
          // "Upscale este vídeo" click can load it straight into Pass 2 below
          // instead of re-running the whole Pass 1 sampling loop.
          if (!S.upscale) {
            // H3SaveAVLatent (not core SaveLatent): H3's Pass 1 latent is a
            // NestedTensor([video, audio]) and core SaveLatent crashes on it
            // with "'NestedTensor' object has no attribute 'contiguous'" --
            // this AV-aware save unbinds it into plain tensors first.
            prompt["H3:savelatent"] = { class_type: "H3SaveAVLatent", inputs: { samples: ["H3:sampler", 0], filename_prefix: "h3-suite/latents/h3_suite" } };
          }

          // Optional 2-pass latent upscale: SplitSigmas cuts the full sigma curve at
          // Pass 1's step count; Pass 1 runs at the base resolution exactly like the
          // single-pass case, then its output latent is upscaled directly (no
          // decode/re-encode) and refined by a second SamplerCustomAdvanced that
          // REUSES Pass 1's noise/guider/sampler objects -- the same reuse the
          // "Superb Realism" reference workflow relies on to keep identity and
          // motion consistent between the two passes.
          if (S.upscale) {
            prompt["H3:splitsigmas"] = { class_type: "SplitSigmas", inputs: { sigmas: ["H3:scheduler", 0], step: S.steps } };
            if (fastLatent) {
              // Skip Pass 1 sampling entirely -- load its saved latent straight
              // into the same upscale chain a normal upscale run would use.
              // H3LoadAVLatent rebuilds the NestedTensor([video, audio]) that
              // H3SaveAVLatent wrote, so LTXVSeparateAVLatent below still gets
              // the joint AV shape it expects.
              prompt["H3:loadlatent"] = { class_type: "H3LoadAVLatent", inputs: { latent: annotatedRef(fastLatent) } };
              delete prompt["H3:sampler"];
              prompt["H3:upscale_separate"] = { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["H3:loadlatent", 0] } };
            } else {
              prompt["H3:sampler"].inputs.sigmas = ["H3:splitsigmas", 0];
              prompt["H3:upscale_separate"] = { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: ["H3:sampler", 0] } };
            }
            prompt["H3:upscale"] = {
              class_type: "MinimaxH3LatentUpscaler3D",
              inputs: {
                latent: ["H3:upscale_separate", 0],
                model_name: S.upscaleModel || UPSCALE_CANONICAL_MODEL,
                mode: "scale by multiplier",
                "mode.scale": S.upscaleMultiplier,
                align: 32,
                enable_chunking: true,
                device: "cuda",
                precision: "fp16",
              },
            };
            prompt["H3:upscale_concat"] = { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["H3:upscale", 0], audio_latent: ["H3:upscale_separate", 1] } };
            prompt["H3:sampler2"] = {
              class_type: "SamplerCustomAdvanced",
              inputs: {
                noise: ["H3:seed", 0],
                guider: ["H3:guider", 0],
                sampler: ["H3:samplerselect", 0],
                sigmas: ["H3:splitsigmas", 1],
                latent_image: ["H3:upscale_concat", 0],
              },
            };
            prompt["H3:decode_video"].inputs.samples = ["H3:sampler2", 0];
            prompt["H3:decode_audio"].inputs.samples = ["H3:sampler2", 0];
          } else if (S.derope) {
            // De-RoPE: read Pass 1's own output to find where its motion outran the
            // model (H3 Jerk Oracle), hold frames there to buy it time (H3 Time
            // Smear), re-render just those spans on that slowed timeline (H3 V2V
            // Init + H3 Inject Schedule), then drop the held frames and retime the
            // audio back to the original clock (H3 Exact/Audio Recover). Mirrors
            // matlowai's ComfyUI-MAINodes reference pipeline (motion_pipeline_
            // ref2va_audioinit) 1:1, ported onto this node's own graph.
            prompt["H3:derope_jerk"] = { class_type: "H3JerkOracle", inputs: { samples: ["H3:sampler", 0], length: ["H3:duration", 0], q: S.deropeQ, d_max: S.deropeDMax, ramp: true, preset: "balanced (default)", bridge: 8 } };
            prompt["H3:derope_smear"] = { class_type: "H3TimeSmear", inputs: { images: ["H3:decode_video", 0], dilation: 4, hold_map: ["H3:derope_jerk", 0] } };
            prompt["H3:derope_encode"] = { class_type: "VAEEncode", inputs: { pixels: ["H3:derope_smear", 0], vae: ["H3:vae_video", 0] } };
            prompt["H3:derope_audiosmear"] = { class_type: "H3AudioSmear", inputs: { audio: ["H3:decode_audio", 0], hold_map: ["H3:derope_smear", 1], fps: 24 } };
            prompt["H3:derope_audioenc"] = { class_type: "VAEEncodeAudio", inputs: { audio: ["H3:derope_audiosmear", 0], vae: ["H3:vae_audio", 0] } };
            prompt["H3:derope_v2vinit"] = { class_type: "H3V2VInit", inputs: { samples: ["H3:derope_encode", 0], audio_latent: ["H3:derope_audioenc", 0], audio_mode: "follow the original performance (0.5)", audio_strength: 0.5 } };
            prompt["H3:derope_schedule"] = { class_type: "H3InjectSchedule", inputs: { model: modelSrc, scheduler: "beta", total_steps: S.deropeSteps, inject: S.deropeInject, preset: "faithful detail 0.50 (metric best)" } };
            prompt["H3:derope_noise"] = { class_type: "RandomNoise", inputs: { noise_seed: seedVal } };
            prompt["H3:derope_cond"].inputs.length = ["H3:derope_smear", 2];
            prompt["H3:derope_guider"] = { class_type: "BasicGuider", inputs: { model: modelSrc, conditioning: ["H3:derope_cond", 0] } };
            prompt["H3:derope_samplerselect"] = { class_type: "KSamplerSelect", inputs: { sampler_name: "gradient_estimation" } };
            prompt["H3:derope_sampler"] = { class_type: "SamplerCustomAdvanced", inputs: { noise: ["H3:derope_noise", 0], guider: ["H3:derope_guider", 0], sampler: ["H3:derope_samplerselect", 0], sigmas: ["H3:derope_schedule", 0], latent_image: ["H3:derope_v2vinit", 0] } };
            prompt["H3:derope_decode_video"] = { class_type: "VAEDecode", inputs: { samples: ["H3:derope_sampler", 0], vae: ["H3:vae_video", 0] } };
            prompt["H3:derope_decode_audio"] = { class_type: "VAEDecodeAudio", inputs: { samples: ["H3:derope_sampler", 0], vae: ["H3:vae_audio", 0] } };
            prompt["H3:derope_recover"] = { class_type: "H3ExactRecover", inputs: { images: ["H3:derope_decode_video", 0], hold_map: ["H3:derope_smear", 1] } };
            prompt["H3:derope_audiorecover"] = { class_type: "H3AudioRecover", inputs: { audio: ["H3:derope_decode_audio", 0], hold_map: ["H3:derope_smear", 1], fps: 24, reference: ["H3:decode_audio", 0], reference_mix: 0, audio_source: "use pass 2's foley - ONLY IF the audio rows were seeded" } };
            // H3:decode_video / H3:decode_audio (Pass 1's own decode) stay exactly as
            // the base template built them -- De-RoPE reads FROM them (above) as its
            // Pass 1 baseline, it does not replace them. H3:trim's images input is
            // redirected to the recovered video; the audio side goes through
            // H3:audiopriority (unchanged wiring) so a source-video-audio reference,
            // if any, still wins over generated audio exactly as it would without
            // De-RoPE -- only WHICH generated audio it's arbitrating against changes.
            prompt["H3:trim"].inputs.images = ["H3:derope_recover", 0];
            prompt["H3:audiopriority"].inputs.generated_audio = ["H3:derope_audiorecover", 0];
          }

          // Pictures (mirrored onto H3:derope_cond too, when De-RoPE built one --
          // its Pass 2 conditioning needs the exact same references as Pass 1's)
          (refMap.pictures || []).forEach(p => {
            const name = S.pics[p.key];
            if (!name) { delete prompt["H3:semantic"].inputs[p.key]; if (prompt["H3:derope_cond"]) delete prompt["H3:derope_cond"].inputs[p.key]; return; }
            const nid = `H3:pic_${p.key}`;
            prompt[nid] = { class_type: "LoadImage", inputs: { image: name } };
            prompt["H3:semantic"].inputs[p.key] = [nid, 0];
            if (prompt["H3:derope_cond"]) prompt["H3:derope_cond"].inputs[p.key] = [nid, 0];
          });

          // Videos (native LoadVideo + GetVideoComponents, no VideoHelperSuite needed)
          (refMap.videos || []).forEach(v => {
            const name = S.vids[v.key];
            if (!name) { delete prompt["H3:semantic"].inputs[v.key]; if (prompt["H3:derope_cond"]) delete prompt["H3:derope_cond"].inputs[v.key]; return; }
            const lid = `H3:vidload_${v.key}`, gid = `H3:vidget_${v.key}`;
            prompt[lid] = { class_type: "LoadVideo", inputs: { file: name } };
            prompt[gid] = { class_type: "GetVideoComponents", inputs: { video: [lid, 0] } };
            prompt["H3:semantic"].inputs[v.key] = [gid, 0];
            if (prompt["H3:derope_cond"]) prompt["H3:derope_cond"].inputs[v.key] = [gid, 0];
            if (v.key === "source_video") {
              prompt["H3:semantic"].inputs.source_video_audio = [gid, 1];
              prompt["H3:audiopriority"].inputs.source_video_audio = [gid, 1];
              if (prompt["H3:derope_cond"]) prompt["H3:derope_cond"].inputs.source_video_audio = [gid, 1];
            }
          });

          // Audio
          (refMap.audios || []).forEach(a => {
            const name = S.auds[a.key];
            if (!name) { delete prompt["H3:semantic"].inputs[a.key]; delete prompt["H3:audiopriority"].inputs[a.key]; if (prompt["H3:derope_cond"]) delete prompt["H3:derope_cond"].inputs[a.key]; return; }
            const nid = `H3:aud_${a.key}`;
            prompt[nid] = { class_type: "LoadAudio", inputs: { audio: name } };
            prompt["H3:semantic"].inputs[a.key] = [nid, 0];
            prompt["H3:audiopriority"].inputs[a.key] = [nid, 0];
            if (prompt["H3:derope_cond"]) prompt["H3:derope_cond"].inputs[a.key] = [nid, 0];
          });

          const qR = await api.fetchApi("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, client_id: api.clientId }) });
          const qD = await qR.json();
          if (qD.error) throw new Error(fmtErr(qD.error));
          _promptId = qD.prompt_id;
          tx(stageLbl, "Queued…");

          const fmtEta = (sec) => sec < 60 ? `${Math.ceil(sec)}s` : `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
          const progHandler = (evt) => {
            if (!_generating) return;
            const { value, max } = evt.detail || {};
            if (!(max > 0)) return;
            if (_samplingStartedAt === null) _samplingStartedAt = Date.now();
            const pct = Math.round(value / max * 100);
            progBar.style.width = pct + "%";
            tx(stageLbl, "Sampling…");
            // ETA from this render's own step rate so far — steadier than a fixed
            // "steps × avg seconds" guess, since sampling speed varies a lot by
            // resolution/duration/speed-toggle combination.
            const elapsedSec = (Date.now() - _samplingStartedAt) / 1000;
            if (value > 0 && elapsedSec > 0.5) {
              const etaSec = Math.max(0, (max - value) * (elapsedSec / value));
              tx(progLbl, `${value}/${max} steps · ${pct}% · ~${fmtEta(etaSec)} left`);
            } else {
              tx(progLbl, `${value}/${max} steps · ${pct}%`);
            }
          };
          api.addEventListener("progress", progHandler);

          // ComfyUI fires "executing" (evt.detail = the node id, or null when the
          // whole prompt is done) for every node as it starts — including the
          // model-loading and reference-encoding nodes that run BEFORE the
          // sampler, which can easily be the slowest part of the whole render
          // (loading ~30GB of models, VAE-encoding a reference video) and used to
          // sit behind a static "Queued…" the entire time. Surfacing which stage
          // is actually running answers "is this stuck?" without needing to fix
          // ComfyUI's own model-load/VRAM-swap time, which isn't code this repo
          // controls. Stops updating once real per-step "progress" events start
          // (progHandler already keeps stageLbl on "Sampling…" from then on).
          const EXECUTING_STAGE_LABELS = [
            [["H3:unet", "H3:clip", "H3:vae_video", "H3:vae_audio"], "Loading models… (first use this session can take a while)"],
            [["H3:semantic"], "Encoding references… (scales with reference video length)"],
            [["H3:freetext", "H3:condstrength"], "Encoding prompt…"],
            [["H3:lora1", "H3:lora2", "H3:lora3"], "Applying LoRAs…"],
            [["H3:fbcache", "H3:sage", "H3:solattn", "H3:lowvram"], "Applying speed optimizations…"],
            [["H3:scheduler", "H3:guider", "H3:splitsigmas"], "Preparing sampler…"],
            [["H3:sampler"], "Sampling (pass 1)…"],
            [["H3:savelatent"], "Saving pass 1 latent…"],
            [["H3:loadlatent"], "Loading saved latent…"],
            [["H3:upscale_separate", "H3:upscale", "H3:upscale_concat"], "Upscaling latent…"],
            [["H3:sampler2"], "Sampling (pass 2, refine)…"],
            [["H3:decode_video", "H3:decode_audio"], "Decoding pass 1…"],
            [["H3:derope_jerk"], "De-RoPE: finding smeared spans…"],
            [["H3:derope_smear", "H3:derope_encode", "H3:derope_audiosmear", "H3:derope_audioenc", "H3:derope_v2vinit", "H3:derope_cond", "H3:derope_guider", "H3:derope_schedule"], "De-RoPE: preparing regeneration…"],
            [["H3:derope_sampler"], "De-RoPE: regenerating smeared spans…"],
            [["H3:derope_decode_video", "H3:derope_decode_audio", "H3:derope_recover", "H3:derope_audiorecover"], "De-RoPE: restoring timing…"],
            [["H3:trim", "H3:createvideo", "H3:savevideo", "H3:audiopriority"], "Finalizing video…"],
          ];
          function stageLabelForNode(nodeId) {
            if (!nodeId) return null;
            for (const [ids, label] of EXECUTING_STAGE_LABELS) { if (ids.includes(nodeId)) return label; }
            if (nodeId.startsWith("H3:pic_") || nodeId.startsWith("H3:vidload_") || nodeId.startsWith("H3:vidget_") || nodeId.startsWith("H3:aud_")) return "Loading references…";
            return null; // fast/uninteresting node — leave the current label as-is
          }
          const executingHandler = (evt) => {
            if (!_generating || _samplingStartedAt !== null) return;
            const label = stageLabelForNode(evt.detail);
            if (label) tx(stageLbl, label);
          };
          api.addEventListener("executing", executingHandler);

          await new Promise((resolve, reject) => {
            const errHandler = (evt) => {
              const d = evt.detail || {};
              if (d.prompt_id && d.prompt_id !== _promptId) return;
              cleanup(); reject(new Error(fmtErr(d.exception_message || d.error || "Execution failed.")));
            };
            // "executed" fires per node with UI output, not just once at the end —
            // every LoadImage/LoadVideo/LoadAudio reference node shows its own
            // preview thumbnail this way, almost immediately after the prompt
            // starts. Resolving on the first one (as opposed to specifically
            // H3:savevideo, the node that actually writes the final video) used
            // to tear down progHandler/executingHandler and reset the button
            // within a second of clicking Generate, while the real render kept
            // running server-side — the "stays static" symptom this fixes.
            const doneHandler = (evt) => {
              const d = evt.detail || evt;
              if (d.prompt_id !== _promptId || d.node !== "H3:savevideo") return;
              cleanup(); resolve(d);
            };
            const cleanup = () => {
              api.removeEventListener("execution_error", errHandler); api.removeEventListener("executed", doneHandler);
              api.removeEventListener("progress", progHandler); api.removeEventListener("executing", executingHandler);
            };
            api.addEventListener("execution_error", errHandler);
            api.addEventListener("executed", doneHandler);
          });

          const histR = await api.fetchApi(`/history/${_promptId}`);
          const histD = await histR.json();
          const file = extractOutputFile(histD[_promptId]?.outputs, "H3:savevideo");
          if (file) {
            const url = api.apiURL(`/view?filename=${encodeURIComponent(file.filename)}&type=${encodeURIComponent(file.type || "output")}&subfolder=${encodeURIComponent(file.subfolder || "")}&t=${Date.now()}`);
            showResult(url);
            setTab("References");
            const genTimeSec = Math.round((Date.now() - _genStartedAt) / 1000);
            // H3:savelatent only exists in the prompt when this run didn't already
            // do the upscale pass (see where it's added above) -- so this is null
            // on an upscale/fastLatent run, and set on a plain/derope run, which is
            // exactly when a *later* upscale would need it.
            const latentOut = histD[_promptId]?.outputs?.["H3:savelatent"]?.latents?.[0];
            const meta = {
              prompt: text, resolutionPreset: S.resolutionPreset, duration: S.duration, steps: S.steps,
              seed: seedVal, visualStrength: S.visualStrength, audioStrength: S.audioStrength, wardrobeCrop: S.wardrobeCrop,
              activeRefs: activeRefSummary(), refs: { pics: { ...S.pics }, vids: { ...S.vids }, auds: { ...S.auds } },
              genTimeSec,
              latentFile: latentOut ? { filename: latentOut.filename, subfolder: latentOut.subfolder || "", type: latentOut.type || "output" } : null,
            };
            api.fetchApi("/h3suite/save_meta", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ filename: file.filename, subfolder: file.subfolder || "", meta }),
            }).catch(e => console.warn("[H3Suite] save_meta:", e));
            _libNeedsRefresh = true;
          }
          resetGenBtn();
        } catch (e) {
          showError(fmtErr(e));
          resetGenBtn();
        }
      };
      stopBtn.onclick = async () => {
        try { await api.fetchApi("/interrupt", { method: "POST" }); } catch (e) { }
        resetGenBtn();
      };

      this.onRemoved = () => {
        document.removeEventListener("keydown", _fsKeydownHandler, { capture: true });
        window.removeEventListener("resize", _fsRescale);
        if (_fsOverlay) _fsOverlay.remove();
        document.removeEventListener("keydown", _libKeydownHandler, { capture: true });
        _libIo.disconnect();
        _stopCamPlayback();
        cameraViewport.dispose();
      };
    };
  },
});
