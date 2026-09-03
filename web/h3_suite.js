import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// ── Palette / helpers ─────────────────────────────────────────────────────
const LIME = "#f0ff41";
const C = {
  lime: LIME, bg0: "#0b0b0b", bg1: "#111111", bg2: "#181818",
  bg3: "#222222", border: "#2a2a2a", borderH: "#3c3c3c",
  text: "#dedede", muted: "#565656", dim: "#2e2e2e",
  warn: "#ffb347", err: "#ff6767", ok: "#5ee88a",
};
const NODE_W = 880;
const NODE_H = Math.round(NODE_W * 3 / 4);
const LS_KEY = "h3_suite_state";

const mk = (tag, css = {}, props = {}) => { const e = document.createElement(tag); Object.assign(e.style, css); Object.assign(e, props); return e; };
const tx = (e, t) => { e.textContent = t; return e; };
const cap = (t) => tx(mk("div", { fontSize: "9px", fontWeight: "700", letterSpacing: ".1em", textTransform: "uppercase", color: C.muted, marginBottom: "5px" }), t);
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
function MediaSlot(kind, labelTxt, tooltip, onFile) {
  const accept = kind === "image" ? "image/*" : kind === "video" ? "video/*" : "audio/*";
  const wrap = mk("div", {
    width: "76px", height: "76px", borderRadius: "10px", border: `1.5px dashed ${C.border}`,
    background: C.bg2, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    cursor: "pointer", position: "relative", overflow: "hidden", flexShrink: "0", boxSizing: "border-box",
    transition: "border-color .15s,background .15s",
  });
  wrap.title = tooltip || labelTxt || "";
  const icoWrap = mk("div", { position: "absolute", inset: "0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", pointerEvents: "none", padding: "4px" });
  const glyph = mk("div", { fontSize: "18px", color: C.muted }); tx(glyph, kind === "image" ? "\u{1F5BC}" : kind === "video" ? "\u{1F3A5}" : "\u{1F3B5}");
  const lbl = mk("div", { fontSize: "7px", color: C.muted, textAlign: "center", lineHeight: "1.15", letterSpacing: ".02em" }); tx(lbl, labelTxt || "");
  icoWrap.append(glyph, lbl);

  const fileLbl = mk("div", { position: "absolute", inset: "0", display: "none", alignItems: "center", justifyContent: "center", padding: "4px", boxSizing: "border-box", textAlign: "center" });
  const fileName = mk("div", { fontSize: "7px", color: LIME, wordBreak: "break-all", lineHeight: "1.2", maxHeight: "60px", overflow: "hidden" });
  fileLbl.appendChild(fileName);

  const rm = mkRmBtn();
  const inp = mk("input", { display: "none" }, { type: "file", accept });
  wrap.append(icoWrap, fileLbl, rm, inp);

  wrap.onmouseenter = () => { wrap.style.borderColor = LIME; };
  wrap.onmouseleave = () => { wrap.style.borderColor = C.border; };
  wrap.onclick = () => inp.click();

  let _name = null;
  const _showLoaded = (fname) => { icoWrap.style.display = "none"; fileLbl.style.display = "flex"; rm.style.display = "flex"; tx(fileName, fname); wrap.style.borderColor = LIME; };

  const _load = async (file) => {
    _showLoaded(file.name);
    const fd = new FormData(); fd.append("image", file); fd.append("overwrite", "true");
    try {
      const r = await api.fetchApi("/upload/image", { method: "POST", body: fd });
      const d = await r.json(); _name = d.name || file.name;
      onFile(_name);
    } catch (err) { _name = file.name; onFile(_name); }
  };
  inp.onchange = () => { if (inp.files[0]) _load(inp.files[0]); };
  rm.onclick = (e) => { e.stopPropagation(); fileLbl.style.display = "none"; rm.style.display = "none"; icoWrap.style.display = "flex"; wrap.style.borderColor = C.border; inp.value = ""; _name = null; onFile(null); };

  const setName = (name) => { if (!name) { _name = null; return; } _name = name; _showLoaded(name); };

  return { el: wrap, get name() { return _name; }, hasFile() { return !!_name; }, setName };
}

// ── Camera guide preview player ──────────────────────────────────────────────
function VideoPreview() {
  const wrap = mk("div", { width: "100%", background: "#000", borderRadius: "8px", overflow: "hidden", display: "none", aspectRatio: "16/9" });
  const vid = mk("video", { width: "100%", height: "100%", display: "block", objectFit: "contain" }, { controls: true, loop: true, muted: false });
  wrap.appendChild(vid);
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
  fbcache: true,
  fbcacheMode: "H3 Safe — 0.08 / max 2",
  sage: true,
  lowvram: false,
  headChunks: 4,
  camera: { duration: 5, resolution_preset: "Fast Landscape (864x480)", proxy_type: "Humanoid", proxy_scale: 1.0, interpolation: "Smooth", show_floor: true, show_axes: false, background: "Neutral", keyframes: [] },
});

const RES_PRESETS = [
  "Fast Landscape (864x480)", "Fast Portrait (480x864)", "Test Landscape (960x544)", "Test Portrait (544x960)",
  "H3 Native Landscape (1344x768)", "H3 Native Portrait (768x1344)", "H3 4:3 Landscape (1024x768)",
  "H3 3:4 Portrait (768x1024)", "H3 Square (768x768)", "H3 Cinematic 21:9 (1536x672)",
];
const FBCACHE_MODES = ["H3 Safe — 0.08 / max 2", "H3 Fast — 0.10 / max 2", "H3 Aggressive — 0.12 / max 2", "Custom — manual values"];
const CANONICAL_MODELS = {
  unet: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
  clip: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  vae_video: "minimax_h3_video_vae_fp16.safetensors",
  vae_audio: "minimax_h3_audio_vae_fp32.safetensors",
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
      const TABS = ["References", "Camera", "Settings", "Setup"];
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
      header.append(title, tabsWrap);

      const body = mk("div", { flex: "1", overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "12px" });

      const promptWrap = mk("div", { padding: "10px 14px", borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: "6px", flexShrink: "0" });
      const promptTA = mk("textarea", {
        width: "100%", minHeight: "56px", maxHeight: "120px", resize: "vertical", boxSizing: "border-box",
        background: C.bg2, border: `1px solid ${C.border}`, borderRadius: "8px", color: C.text,
        fontSize: "11px", padding: "8px 10px", outline: "none", fontFamily: "inherit", lineHeight: "1.5",
      }, { placeholder: "Describe the shot. Use <Picture 1>, <Video 2>, <Audio 1>… for the references you enable above." });
      promptTA.value = S.prompt || "";
      promptTA.oninput = () => { S.prompt = promptTA.value; persist(); };

      const enhanceRow = mk("div", { display: "flex", alignItems: "center", gap: "8px" });
      const enhanceBtn = mk("button", {
        background: "none", border: `1px solid ${C.border}`, cursor: "pointer", padding: "4px 9px",
        color: C.muted, outline: "none", borderRadius: "6px", fontSize: "9px", fontWeight: "700", letterSpacing: ".04em",
      });
      tx(enhanceBtn, "✨ Enhance Prompt");
      const enhanceStatus = mk("div", { fontSize: "9px", color: C.muted, flex: "1" });
      enhanceRow.append(enhanceBtn, enhanceStatus);

      const errBox = mk("div", { fontSize: "10px", color: C.err, display: "none" });

      const footer = mk("div", { display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", borderTop: `1px solid ${C.border}`, flexShrink: "0" });
      const progWrap = mk("div", { flex: "1", height: "6px", background: C.bg2, borderRadius: "3px", overflow: "hidden", display: "none" });
      const progBar = mk("div", { height: "100%", width: "0%", background: LIME, transition: "width .2s" });
      progWrap.appendChild(progBar);
      const stageLbl = mk("div", { fontSize: "9px", color: C.muted, display: "none" });
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

      const preview = VideoPreview();

      root.append(header, body, preview.el, promptWrap, footer);
      promptWrap.append(promptTA, enhanceRow, errBox);

      this.addDOMWidget("h3s_ui", "div", root, {
        getValue() { return null; }, setValue() { }, serialize: false,
        computeSize() { return [NODE_W, NODE_H]; },
      });
      this.setSize([NODE_W, NODE_H]);

      function showError(msg) { errBox.style.display = "block"; tx(errBox, msg); }
      function clearError() { errBox.style.display = "none"; }

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
      }

      // ── References panel ─────────────────────────────────────────────────
      const refPanel = mk("div", { display: "flex", flexDirection: "column", gap: "14px" });
      panels["References"] = refPanel;
      const picSection = mk("div", { display: "flex", flexDirection: "column", gap: "6px" });
      picSection.appendChild(cap("Pictures (fixed roles)"));
      const picGrid = mk("div", { display: "flex", flexWrap: "wrap", gap: "8px" });
      picSection.appendChild(picGrid);

      const vidSection = mk("div", { display: "flex", flexDirection: "column", gap: "6px" });
      vidSection.appendChild(cap("Videos"));
      const vidGrid = mk("div", { display: "flex", flexWrap: "wrap", gap: "8px" });
      vidSection.appendChild(vidGrid);

      const audSection = mk("div", { display: "flex", flexDirection: "column", gap: "6px" });
      audSection.appendChild(cap("Audio"));
      const audGrid = mk("div", { display: "flex", flexWrap: "wrap", gap: "8px" });
      audSection.appendChild(audGrid);

      refPanel.append(picSection, vidSection, audSection);
      body.appendChild(refPanel);

      // ── Camera panel ──────────────────────────────────────────────────────
      const camPanel = mk("div", { display: "none", flexDirection: "column", gap: "10px" });
      panels["Camera"] = camPanel;
      body.appendChild(camPanel);

      const camPresetsRow = mk("div", { display: "flex", flexWrap: "wrap", gap: "6px" });
      CAMERA_PRESETS.forEach(p => {
        const b = mk("button", { background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: "6px", padding: "5px 9px", fontSize: "10px", cursor: "pointer" });
        tx(b, p.label);
        b.onclick = () => { S.camera.keyframes = p.build(S.camera.duration); persist(); renderKeyList(); };
        camPresetsRow.appendChild(b);
      });

      const camSettingsRow = mk("div", { display: "flex", gap: "10px", flexWrap: "wrap" });
      const camDur = NumberField("Duration (s)", S.camera.duration, 4, 15, 1, v => { S.camera.duration = v; persist(); });
      const camRes = Select("Preview Resolution", RES_PRESETS.filter(r => r.startsWith("Fast") || r.startsWith("Test")).concat(RES_PRESETS.filter(r => !r.startsWith("Fast") && !r.startsWith("Test"))), S.camera.resolution_preset, v => { S.camera.resolution_preset = v; persist(); });
      const camProxy = Select("Proxy", ["Humanoid", "Product Bottle", "Cube", "Sphere", "Cylinder", "Capsule"], S.camera.proxy_type, v => { S.camera.proxy_type = v; persist(); });
      const camInterp = Select("Interpolation", ["Smooth", "Linear"], S.camera.interpolation, v => { S.camera.interpolation = v; persist(); });
      camSettingsRow.append(camDur.el, camRes.el, camProxy.el, camInterp.el);

      const keyListWrap = mk("div", { display: "flex", flexDirection: "column", gap: "6px" });
      keyListWrap.appendChild(cap("Keyframes (time / position xyz / target xyz / fov)"));
      const keyList = mk("div", { display: "flex", flexDirection: "column", gap: "5px" });
      keyListWrap.appendChild(keyList);
      const addKeyBtn = mk("button", { alignSelf: "flex-start", background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: "6px", padding: "5px 10px", fontSize: "10px", cursor: "pointer" });
      tx(addKeyBtn, "+ Add keyframe");
      addKeyBtn.onclick = () => {
        const last = S.camera.keyframes[S.camera.keyframes.length - 1];
        const t = last ? Math.min(S.camera.duration, last.time + 1) : 0;
        S.camera.keyframes.push(last ? { ...last, time: t } : { time: 0, position: [0, 1.85, 7], target: [0, 1.65, 0], fov: 42 });
        persist(); renderKeyList();
      };

      function renderKeyList() {
        keyList.innerHTML = "";
        S.camera.keyframes.forEach((k, i) => {
          const row = mk("div", { display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap", background: C.bg2, borderRadius: "6px", padding: "5px 6px" });
          const mkTiny = (val, onChange, w) => {
            const inp = mk("input", { width: w || "44px", background: C.bg1, border: `1px solid ${C.border}`, color: C.text, borderRadius: "4px", padding: "3px 4px", fontSize: "9px", outline: "none" }, { type: "number", value: val, step: "0.1" });
            inp.onchange = () => onChange(parseFloat(inp.value));
            return inp;
          };
          row.append(
            tx(mk("span", { fontSize: "9px", color: C.muted }), "t"), mkTiny(k.time, v => { k.time = v; persist(); }),
            tx(mk("span", { fontSize: "9px", color: C.muted }), "pos"),
            mkTiny(k.position[0], v => { k.position[0] = v; persist(); }), mkTiny(k.position[1], v => { k.position[1] = v; persist(); }), mkTiny(k.position[2], v => { k.position[2] = v; persist(); }),
            tx(mk("span", { fontSize: "9px", color: C.muted }), "tgt"),
            mkTiny(k.target[0], v => { k.target[0] = v; persist(); }), mkTiny(k.target[1], v => { k.target[1] = v; persist(); }), mkTiny(k.target[2], v => { k.target[2] = v; persist(); }),
            tx(mk("span", { fontSize: "9px", color: C.muted }), "fov"), mkTiny(k.fov, v => { k.fov = v; persist(); }, "40px"),
          );
          const del = mk("button", { marginLeft: "auto", background: "none", border: "none", color: C.err, cursor: "pointer", fontSize: "13px" });
          tx(del, "×");
          del.onclick = () => { S.camera.keyframes.splice(i, 1); persist(); renderKeyList(); };
          row.appendChild(del);
          keyList.appendChild(row);
        });
      }
      renderKeyList();

      const camRenderRow = mk("div", { display: "flex", alignItems: "center", gap: "8px" });
      const camRenderBtn = mk("button", { background: LIME, color: "#111", border: "none", borderRadius: "7px", padding: "8px 16px", fontSize: "11px", fontWeight: "800", cursor: "pointer" });
      tx(camRenderBtn, "Render Camera Guide");
      const camRenderStatus = mk("div", { fontSize: "9px", color: C.muted });
      camRenderRow.append(camRenderBtn, camRenderStatus);
      const camPreview = VideoPreview();
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
        setTab("References");
      };
      camPanel.append(camPresetsRow, camSettingsRow, keyListWrap, addKeyBtn, camRenderRow, camPreview.el, useAsVideo2Btn);

      // ── Settings panel ────────────────────────────────────────────────────
      const setPanel = mk("div", { display: "none", flexDirection: "column", gap: "10px" });
      panels["Settings"] = setPanel;
      body.appendChild(setPanel);
      setPanel.appendChild(cap("Models — already have these files somewhere else? Add that folder to ComfyUI's extra_model_paths.yaml under diffusion_models/text_encoders/vae, restart ComfyUI, then Refresh here and pick them below."));
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
          const byCat = { diffusion_models: d.diffusion_models || [], text_encoders: d.text_encoders || [], vae: d.vae || [] };
          MODEL_SLOTS.forEach(slot => {
            const found = byCat[slot.category] || [];
            const options = found.includes(CANONICAL_MODELS[slot.key]) ? found : [CANONICAL_MODELS[slot.key], ...found];
            const sel = modelSelects[slot.key].sel;
            const keep = S.models[slot.key] || CANONICAL_MODELS[slot.key];
            sel.innerHTML = "";
            options.forEach(o => { const opt = mk("option", {}, { value: o }); opt.textContent = o; sel.appendChild(opt); });
            sel.value = options.includes(keep) ? keep : options[0];
          });
          tx(modelsStatus, `Found ${byCat.diffusion_models.length} diffusion / ${byCat.text_encoders.length} text-encoder / ${byCat.vae.length} vae file(s).`);
        } catch (e) { tx(modelsStatus, "Could not scan models: " + fmtErr(e)); }
      }
      modelsRefreshBtn.onclick = refreshModelLists;
      refreshModelLists();
      setPanel.append(modelsGrid, modelsRefreshRow);

      const resSel = Select("Resolution", RES_PRESETS, S.resolutionPreset, v => { S.resolutionPreset = v; persist(); });
      const durNum = NumberField("Duration (seconds)", S.duration, 2, 15, 1, v => { S.duration = v; persist(); });
      const stepsNum = NumberField("Steps", S.steps, 4, 60, 1, v => { S.steps = v; persist(); });
      const seedNum = NumberField("Seed", S.seed, 0, 999999999999, 1, v => { S.seed = v; persist(); });
      const randSeedToggle = Toggle("Randomize seed", S.randomizeSeed, v => { S.randomizeSeed = v; persist(); });
      const visStrNum = NumberField("Visual strength", S.visualStrength, 0, 1, 0.001, v => { S.visualStrength = v; persist(); });
      const audStrNum = NumberField("Audio strength", S.audioStrength, 0, 1, 0.001, v => { S.audioStrength = v; persist(); });
      const wardrobeCropNum = NumberField("Wardrobe head-crop %", S.wardrobeCrop, 0, 40, 1, v => { S.wardrobeCrop = v; persist(); });
      const grid1 = mk("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" });
      grid1.append(resSel.el, durNum.el, stepsNum.el, seedNum.el, visStrNum.el, audStrNum.el, wardrobeCropNum.el);
      setPanel.append(grid1, randSeedToggle.el);

      setPanel.appendChild(cap("Speed optimizations (need the optional custom nodes from Setup)"));
      const fbcacheToggle = Toggle("FirstBlockCache", S.fbcache, v => { S.fbcache = v; persist(); });
      const fbcacheModeSel = Select("", FBCACHE_MODES, S.fbcacheMode, v => { S.fbcacheMode = v; persist(); });
      const sageToggle = Toggle("SageAttention", S.sage, v => { S.sage = v; persist(); });
      const lowvramToggle = Toggle("Low-VRAM attention (head chunking)", S.lowvram, v => { S.lowvram = v; persist(); });
      const headChunksNum = NumberField("Head chunks", S.headChunks, 1, 56, 1, v => { S.headChunks = v; persist(); });
      setPanel.append(fbcacheToggle.el, fbcacheModeSel.el, sageToggle.el, lowvramToggle.el, headChunksNum.el);

      // ── Setup panel ───────────────────────────────────────────────────────
      const setupPanel = mk("div", { display: "none", flexDirection: "column", gap: "10px" });
      panels["Setup"] = setupPanel;
      body.appendChild(setupPanel);
      const setupRequired = mk("div", { display: "flex", flexDirection: "column", gap: "4px" });
      const setupOptional = mk("div", { display: "flex", flexDirection: "column", gap: "4px" });
      const setupInstallBtn = mk("button", { alignSelf: "flex-start", background: LIME, color: "#111", border: "none", borderRadius: "7px", padding: "7px 14px", fontSize: "10px", fontWeight: "800", cursor: "pointer" });
      tx(setupInstallBtn, "Install missing required items");
      const setupOptInstallBtn = mk("button", { alignSelf: "flex-start", background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: "7px", padding: "7px 14px", fontSize: "10px", fontWeight: "700", cursor: "pointer" });
      tx(setupOptInstallBtn, "Install missing optional items (models, ~42GB)");
      const setupStatusLine = mk("div", { fontSize: "9px", color: C.muted });
      setupPanel.append(cap("Required"), setupRequired, setupInstallBtn, cap("Optional (speed / large downloads)"), setupOptional, setupOptInstallBtn, setupStatusLine);

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
          const slot = MediaSlot("image", p.short, `${p.label}\n${p.tooltip || ""}`, (name) => { if (name) S.pics[p.key] = name; else delete S.pics[p.key]; persist(); });
          if (S.pics[p.key]) slot.setName(S.pics[p.key]);
          picSlots[p.key] = slot;
          const lbl = mk("div", { fontSize: "8px", color: C.muted, textAlign: "center" }); tx(lbl, `${p.slot}. ${p.short}`);
          col.append(slot.el, lbl); picGrid.appendChild(col);
        });
        (refMap.videos || []).forEach(v => {
          const col = mk("div", { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" });
          const slot = MediaSlot("video", v.short, `${v.label}\n${v.tooltip || ""}`, (name) => { if (name) S.vids[v.key] = name; else delete S.vids[v.key]; persist(); });
          if (S.vids[v.key]) slot.setName(S.vids[v.key]);
          vidSlots[v.key] = slot;
          const lbl = mk("div", { fontSize: "8px", color: C.muted, textAlign: "center" }); tx(lbl, `${v.slot}. ${v.short}`);
          col.append(slot.el, lbl);
          if (v.key === "camera_video") {
            const camBtn = mk("button", { fontSize: "7px", background: "none", border: `1px solid ${C.border}`, color: C.text, borderRadius: "4px", padding: "2px 5px", cursor: "pointer" });
            tx(camBtn, "Camera Director"); camBtn.onclick = () => setTab("Camera");
            col.appendChild(camBtn);
          }
          vidGrid.appendChild(col);
        });
        (refMap.audios || []).forEach(a => {
          const col = mk("div", { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" });
          const slot = MediaSlot("audio", a.short, `${a.label}\n${a.tooltip || ""}`, (name) => { if (name) S.auds[a.key] = name; else delete S.auds[a.key]; persist(); });
          if (S.auds[a.key]) slot.setName(S.auds[a.key]);
          audSlots[a.key] = slot;
          const lbl = mk("div", { fontSize: "8px", color: C.muted, textAlign: "center" }); tx(lbl, `${a.slot}. ${a.short}`);
          col.append(slot.el, lbl); audGrid.appendChild(col);
        });
      }
      loadReferenceMap();

      // ── Enhance prompt ────────────────────────────────────────────────────
      function activeRefSummary() {
        const parts = [];
        (refMap.pictures || []).forEach(p => { if (S.pics[p.key]) parts.push(`Picture ${p.slot} (${p.label})`); });
        (refMap.videos || []).forEach(v => { if (S.vids[v.key]) parts.push(`Video ${v.slot} (${v.label})`); });
        (refMap.audios || []).forEach(a => { if (S.auds[a.key]) parts.push(`Audio ${a.slot} (${a.label})`); });
        return parts.length ? parts.join(", ") : "none";
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
          const fullSys = `${sys}\n\nActive: ${activeRefSummary()}`;
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
          promptTA.value = resultText.trim(); S.prompt = promptTA.value; persist();
          tx(enhanceStatus, "Done.");
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
      function resetGenBtn() {
        _generating = false; genBtn.disabled = false; tx(genBtn, "Generate");
        stopBtn.style.display = "none"; progWrap.style.display = "none"; stageLbl.style.display = "none";
      }
      genBtn.onclick = async () => {
        if (_generating) return;
        clearError();
        const text = (promptTA.value || "").trim();
        if (!text) { showError("Type a prompt first."); return; }
        _generating = true; genBtn.disabled = true; tx(genBtn, "Generating…");
        stopBtn.style.display = "inline-block"; progWrap.style.display = "block"; stageLbl.style.display = "block";
        progBar.style.width = "0%"; tx(stageLbl, "Preparing workflow…");

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
          prompt["H3:scheduler"].inputs.steps = S.steps;
          prompt["H3:condstrength"].inputs.visual_strength = S.visualStrength;
          prompt["H3:condstrength"].inputs.audio_strength = S.audioStrength;
          prompt["H3:semantic"].inputs.wardrobe_head_crop_pct = S.wardrobeCrop;
          const seedVal = S.randomizeSeed ? Math.floor(Math.random() * 1e12) : S.seed;
          prompt["H3:seed"].inputs.noise_seed = seedVal;
          prompt["H3:seed"].inputs.control_after_generate = S.randomizeSeed ? "randomize" : "fixed";
          if (S.randomizeSeed) { S.seed = seedVal; seedNum.setValue(seedVal); persist(); }

          // Speed chain: unet -> [fbcache?] -> [sage?] -> [lowvram?] -> scheduler/guider
          let modelSrc = ["H3:unet", 0];
          if (S.fbcache) {
            prompt["H3:fbcache"] = { class_type: "ApplyMiniMaxH3FirstBlockCache", inputs: { model: modelSrc, mode: S.fbcacheMode, threshold: 0.08, start_percent: 0.1, end_percent: 0.95, max_consecutive_hits: 2, temporal_guard: false } };
            modelSrc = ["H3:fbcache", 0];
          }
          if (S.sage) {
            prompt["H3:sage"] = { class_type: "PathchSageAttentionKJ", inputs: { model: modelSrc, sage_attention: "auto", allow_compile: false } };
            modelSrc = ["H3:sage", 0];
          }
          if (S.lowvram) {
            prompt["H3:lowvram"] = { class_type: "MiniMaxLowVRAMAttention", inputs: { model: modelSrc, head_chunks: S.headChunks } };
            modelSrc = ["H3:lowvram", 0];
          }
          prompt["H3:scheduler"].inputs.model = modelSrc;
          prompt["H3:guider"].inputs.model = modelSrc;

          // Pictures
          (refMap.pictures || []).forEach(p => {
            const name = S.pics[p.key];
            if (!name) { delete prompt["H3:semantic"].inputs[p.key]; return; }
            const nid = `H3:pic_${p.key}`;
            prompt[nid] = { class_type: "LoadImage", inputs: { image: name } };
            prompt["H3:semantic"].inputs[p.key] = [nid, 0];
          });

          // Videos (native LoadVideo + GetVideoComponents, no VideoHelperSuite needed)
          (refMap.videos || []).forEach(v => {
            const name = S.vids[v.key];
            if (!name) { delete prompt["H3:semantic"].inputs[v.key]; return; }
            const lid = `H3:vidload_${v.key}`, gid = `H3:vidget_${v.key}`;
            prompt[lid] = { class_type: "LoadVideo", inputs: { file: name } };
            prompt[gid] = { class_type: "GetVideoComponents", inputs: { video: [lid, 0] } };
            prompt["H3:semantic"].inputs[v.key] = [gid, 0];
            if (v.key === "source_video") {
              prompt["H3:semantic"].inputs.source_video_audio = [gid, 1];
              prompt["H3:audiopriority"].inputs.source_video_audio = [gid, 1];
            }
          });

          // Audio
          (refMap.audios || []).forEach(a => {
            const name = S.auds[a.key];
            if (!name) { delete prompt["H3:semantic"].inputs[a.key]; delete prompt["H3:audiopriority"].inputs[a.key]; return; }
            const nid = `H3:aud_${a.key}`;
            prompt[nid] = { class_type: "LoadAudio", inputs: { audio: name } };
            prompt["H3:semantic"].inputs[a.key] = [nid, 0];
            prompt["H3:audiopriority"].inputs[a.key] = [nid, 0];
          });

          const qR = await api.fetchApi("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, client_id: api.clientId }) });
          const qD = await qR.json();
          if (qD.error) throw new Error(fmtErr(qD.error));
          _promptId = qD.prompt_id;
          tx(stageLbl, "Queued…");

          const progHandler = (evt) => {
            if (!_generating) return;
            const { value, max } = evt.detail || {};
            if (max > 0) { const pct = Math.round(value / max * 100); progBar.style.width = pct + "%"; tx(stageLbl, `Sampling… ${value}/${max}`); }
          };
          api.addEventListener("progress", progHandler);

          await new Promise((resolve, reject) => {
            const errHandler = (evt) => {
              const d = evt.detail || {};
              if (d.prompt_id && d.prompt_id !== _promptId) return;
              cleanup(); reject(new Error(fmtErr(d.exception_message || d.error || "Execution failed.")));
            };
            const doneHandler = (evt) => {
              const d = evt.detail || evt;
              if (d.prompt_id !== _promptId) return;
              cleanup(); resolve(d);
            };
            const cleanup = () => { api.removeEventListener("execution_error", errHandler); api.removeEventListener("executed", doneHandler); api.removeEventListener("progress", progHandler); };
            api.addEventListener("execution_error", errHandler);
            api.addEventListener("executed", doneHandler);
          });

          const histR = await api.fetchApi(`/history/${_promptId}`);
          const histD = await histR.json();
          const file = extractOutputFile(histD[_promptId]?.outputs, "H3:savevideo");
          if (file) {
            const url = api.apiURL(`/view?filename=${encodeURIComponent(file.filename)}&type=${encodeURIComponent(file.type || "output")}&subfolder=${encodeURIComponent(file.subfolder || "")}&t=${Date.now()}`);
            preview.show(url);
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
    };
  },
});
