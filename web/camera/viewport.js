// Owns the three.js renderer/scene/controls/RAF lifecycle for the Camera
// tab's interactive previz viewport. h3_suite.js never touches THREE.*
// directly — it only calls this module's public API and reads/writes
// S.camera by reference, which this module also reads/writes by reference
// (no parallel copy of keyframe data, so there is nothing to reconcile).

import * as THREE from "../lib/three/three.module.min.js";
import { OrbitControls } from "../lib/three/OrbitControls.js";
import { TransformControls } from "../lib/three/TransformControls.js";
import { buildProxyMesh, buildGroundGrid, buildAxes, disposeObject3D } from "./scene-builder.js";
import { sampleCurve, interpVec3, interpScalarFov } from "./interp.js";

const COLOR_POS = 0xf0ff41;
const COLOR_POS_SELECTED = 0xffffff;
const COLOR_TARGET = 0xe6be46;
const COLOR_SCRUB = 0x39d0ff;
const BG_COLORS = { Neutral: 0x48484e, Dark: 0x1c1c1f, White: 0xf5f5f5 };
const DEFAULT_NAV_POS = [6, 4, 9];
const DEFAULT_NAV_TARGET = [0, 1.2, 0];

// createCameraViewport(containerEl, { getState, persist, onSelect, onChange })
//   getState()  → returns the live S.camera object (read fresh each call, never cached)
//   persist()   → same persist() h3_suite.js already calls after every S mutation
//   onSelect(i) → called when selection changes (from a 3D click OR viewport.selectKeyframe)
//   onChange(i) → called after a gizmo drag mutates keyframes[i] in place
export function createCameraViewport(containerEl, { getState, persist, onSelect, onChange }) {
  let renderer = null, scene = null, navCamera = null, orbitControls = null, transformControls = null;
  let groundGrid = null, axesGroup = null, subjectGroup = null, pathLine = null, scrubMarker = null;
  let shotCamera = null, pipEl = null, pipRect = null, theaterMode = false;
  let markers = [];   // { index, kind: 'position'|'target', mesh }
  let sightLines = []; // sightLines[index] = THREE.Line between that keyframe's position/target markers
  let raf = null, active = false, mounted = false;
  let resizeObserver = null;
  let selectedIndex = -1, selectedKind = null;
  let proxyType = null;
  let lastTime = 0;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  // Hidden from the "through the lens" PiP render pass — a camera operator
  // doesn't see the previz gizmos in their own viewfinder.
  const pipHidden = () => [pathLine, scrubMarker, transformControls].concat(
    markers.map((m) => m.mesh), sightLines
  ).filter(Boolean);

  function state() { return getState(); }

  function mount() {
    if (mounted) return;
    mounted = true;

    const st = state();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(BG_COLORS[st.background] || BG_COLORS.Neutral);

    const w = containerEl.clientWidth || 800, h = containerEl.clientHeight || 300;
    navCamera = new THREE.PerspectiveCamera(50, w / Math.max(1, h), 0.05, 200);
    navCamera.position.set(...DEFAULT_NAV_POS);
    navCamera.lookAt(...DEFAULT_NAV_TARGET);

    // The "shot camera" — what the staged camera itself frames, updated every
    // time the keyframes/interpolation/scrub time change. Rendered as a
    // picture-in-picture inset (see _renderOnce) so staging a shot doesn't
    // require a full server-side "Render Camera Guide" round-trip just to see
    // whether the move looks right.
    shotCamera = new THREE.PerspectiveCamera(42, 16 / 9, 0.05, 200);

    pipEl = document.createElement("div");
    Object.assign(pipEl.style, {
      position: "absolute", boxSizing: "border-box", border: "1.5px solid #f0ff41",
      borderRadius: "4px", pointerEvents: "none", boxShadow: "0 2px 10px rgba(0,0,0,.5)",
      transition: "left .25s ease, top .25s ease, width .25s ease, height .25s ease",
    });
    const pipLabel = document.createElement("div");
    Object.assign(pipLabel.style, {
      position: "absolute", top: "-1.5px", left: "-1.5px", background: "#f0ff41", color: "#111",
      fontSize: "8px", fontWeight: "800", letterSpacing: ".04em", padding: "2px 5px",
      borderRadius: "3px 0 4px 0", fontFamily: "system-ui,-apple-system,sans-serif",
    });
    pipLabel.textContent = "SHOT CAMERA";
    pipEl.appendChild(pipLabel);
    containerEl.appendChild(pipEl);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    containerEl.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.75);
    dirLight.position.set(4, 8, 6);
    scene.add(dirLight);

    groundGrid = buildGroundGrid();
    groundGrid.visible = !!st.show_floor;
    scene.add(groundGrid);

    axesGroup = buildAxes();
    axesGroup.visible = !!st.show_axes;
    scene.add(axesGroup);

    proxyType = st.proxy_type;
    subjectGroup = buildProxyMesh(proxyType);
    subjectGroup.scale.setScalar(st.proxy_scale || 1);
    scene.add(subjectGroup);

    pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: COLOR_POS }));
    scene.add(pathLine);

    scrubMarker = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), new THREE.MeshBasicMaterial({ color: COLOR_SCRUB }));
    scrubMarker.visible = false;
    scene.add(scrubMarker);

    orbitControls = new OrbitControls(navCamera, renderer.domElement);
    orbitControls.target.set(0, 1.2, 0);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.08;

    transformControls = new TransformControls(navCamera, renderer.domElement);
    transformControls.setMode("translate");
    transformControls.setSize(1.3);
    transformControls.addEventListener("dragging-changed", (e) => { orbitControls.enabled = !e.value; });
    transformControls.addEventListener("objectChange", _onGizmoChange);
    scene.add(transformControls);

    renderer.domElement.addEventListener("pointerdown", _onPointerDown);

    resizeObserver = new ResizeObserver(() => _resize());
    resizeObserver.observe(containerEl);

    refreshKeyframes();
    _resize();
  }

  function _onGizmoChange() {
    if (selectedIndex < 0 || !selectedKind) return;
    const marker = markers.find((m) => m.index === selectedIndex && m.kind === selectedKind);
    if (!marker) return;
    const st = state();
    const kf = (st.keyframes || [])[selectedIndex];
    if (!kf) return;
    kf[selectedKind][0] = marker.mesh.position.x;
    kf[selectedKind][1] = marker.mesh.position.y;
    kf[selectedKind][2] = marker.mesh.position.z;
    persist();
    _updateSightLine(selectedIndex);
    _rebuildPathLine();
    if (onChange) onChange(selectedIndex);
  }

  function _onPointerDown(e) {
    if (!markers.length) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, navCamera);
    const hits = raycaster.intersectObjects(markers.map((m) => m.mesh), false);
    if (hits.length) {
      const hit = markers.find((m) => m.mesh === hits[0].object);
      if (hit) selectKeyframe(hit.index, hit.kind);
    } else if (!transformControls.dragging && !transformControls.axis) {
      selectKeyframe(-1, null);
    }
  }

  function selectKeyframe(index, kind) {
    selectedIndex = index; selectedKind = kind;
    markers.forEach((m) => {
      const isSel = m.index === index && m.kind === kind;
      const base = m.kind === "position" ? COLOR_POS : COLOR_TARGET;
      m.mesh.material.color.set(isSel ? COLOR_POS_SELECTED : base);
    });
    if (index >= 0 && kind) {
      const marker = markers.find((m) => m.index === index && m.kind === kind);
      if (marker) transformControls.attach(marker.mesh);
    } else {
      transformControls.detach();
    }
    _renderOnce();
    if (onSelect) onSelect(index);
  }

  function _clearMarkers() {
    markers.forEach((m) => { scene.remove(m.mesh); m.mesh.geometry.dispose(); m.mesh.material.dispose(); });
    sightLines.forEach((l) => { scene.remove(l); l.geometry.dispose(); l.material.dispose(); });
    markers = []; sightLines = [];
    transformControls.detach();
  }

  function refreshKeyframes() {
    if (!mounted) return;
    _clearMarkers();
    const st = state();
    const keys = st.keyframes || [];
    keys.forEach((k, i) => {
      // Sized to be easy to click at typical viewport-navigation distances (the
      // scene grid spans 16 units) — the original 0.12/0.08 radii were only a
      // few screen-pixels wide once zoomed out, hard to grab precisely.
      const posMesh = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 8), new THREE.MeshBasicMaterial({ color: COLOR_POS }));
      posMesh.position.set(k.position[0], k.position[1], k.position[2]);
      scene.add(posMesh);
      markers.push({ index: i, kind: "position", mesh: posMesh });

      const tgtMesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), new THREE.MeshBasicMaterial({ color: COLOR_TARGET }));
      tgtMesh.position.set(k.target[0], k.target[1], k.target[2]);
      scene.add(tgtMesh);
      markers.push({ index: i, kind: "target", mesh: tgtMesh });

      const lineGeo = new THREE.BufferGeometry().setFromPoints([posMesh.position, tgtMesh.position]);
      const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: 0x777777, dashSize: 0.12, gapSize: 0.08 }));
      line.computeLineDistances();
      scene.add(line);
      sightLines.push(line);
    });
    _rebuildPathLine();
    if (selectedIndex >= 0 && !keys[selectedIndex]) selectKeyframe(-1, null);
    _applyShotCamera(lastTime);
    _renderOnce();
  }

  // Cheap per-keyframe update (numeric field edit on the JS side) — moves
  // the one marker pair + its sight line and re-samples the path curve.
  // Must NOT rebuild the marker list (that's refreshKeyframes()'s job) so
  // this stays safe to call at input-change frequency.
  function refreshKeyframe(i) {
    if (!mounted) return;
    const st = state();
    const k = (st.keyframes || [])[i];
    if (!k) return;
    const posMarker = markers.find((m) => m.index === i && m.kind === "position");
    const tgtMarker = markers.find((m) => m.index === i && m.kind === "target");
    if (posMarker) posMarker.mesh.position.set(k.position[0], k.position[1], k.position[2]);
    if (tgtMarker) tgtMarker.mesh.position.set(k.target[0], k.target[1], k.target[2]);
    _updateSightLine(i);
    _rebuildPathLine();
    _applyShotCamera(lastTime);
    _renderOnce();
  }

  function _updateSightLine(i) {
    const line = sightLines[i];
    const posMarker = markers.find((m) => m.index === i && m.kind === "position");
    const tgtMarker = markers.find((m) => m.index === i && m.kind === "target");
    if (!line || !posMarker || !tgtMarker) return;
    line.geometry.setFromPoints([posMarker.mesh.position, tgtMarker.mesh.position]);
    line.computeLineDistances();
  }

  function _rebuildPathLine() {
    if (!mounted) return;
    const st = state();
    const keys = st.keyframes || [];
    if (keys.length < 2) { pathLine.geometry.setFromPoints([]); return; }
    const smooth = st.interpolation === "Smooth" && keys.length >= 3;
    const samples = sampleCurve(keys, st.duration, smooth, 96);
    pathLine.geometry.setFromPoints(samples.map((s) => new THREE.Vector3(s.position[0], s.position[1], s.position[2])));
  }

  // The nav camera's current orbit pose (position + look-at target) — lets
  // h3_suite.js offer "stamp this as a keyframe" so a user can frame a shot
  // by eye (orbit/pan/zoom) instead of typing or dragging numbers.
  function getViewPose() {
    if (!mounted || !navCamera || !orbitControls) return null;
    return {
      position: [navCamera.position.x, navCamera.position.y, navCamera.position.z],
      target: [orbitControls.target.x, orbitControls.target.y, orbitControls.target.z],
    };
  }

  function setProxy(type, scale) {
    if (!mounted) return;
    if (type !== proxyType) {
      scene.remove(subjectGroup);
      disposeObject3D(subjectGroup);
      proxyType = type;
      subjectGroup = buildProxyMesh(type);
      scene.add(subjectGroup);
    }
    subjectGroup.scale.setScalar(scale || 1);
    _renderOnce();
  }

  function setInterpolation() { _rebuildPathLine(); _applyShotCamera(lastTime); _renderOnce(); }
  function setDuration() { _rebuildPathLine(); _applyShotCamera(lastTime); _renderOnce(); }

  function setEnvironment({ show_floor, show_axes, background }) {
    if (!mounted) return;
    if (groundGrid) groundGrid.visible = !!show_floor;
    if (axesGroup) axesGroup.visible = !!show_axes;
    if (scene) scene.background = new THREE.Color(BG_COLORS[background] || BG_COLORS.Neutral);
    _renderOnce();
  }

  function setTime(t) {
    lastTime = t;
    if (!mounted) return;
    const st = state();
    const keys = st.keyframes || [];
    if (!keys.length) { scrubMarker.visible = false; _renderOnce(); return; }
    const smooth = st.interpolation === "Smooth" && keys.length >= 3;
    const pos = interpVec3(keys, t, "position", smooth);
    scrubMarker.position.set(pos[0], pos[1], pos[2]);
    scrubMarker.visible = true;
    _applyShotCamera(t);
    _renderOnce();
  }

  // Points shotCamera at the interpolated pose for time t — same math the
  // scrub marker uses, so the PiP inset and the marker never disagree about
  // where the camera is.
  function _applyShotCamera(t) {
    if (!shotCamera) return;
    const st = state();
    const keys = st.keyframes || [];
    if (!keys.length) return;
    const smooth = st.interpolation === "Smooth" && keys.length >= 3;
    const pos = interpVec3(keys, t, "position", smooth);
    const tgt = interpVec3(keys, t, "target", smooth);
    const fov = interpScalarFov(keys, t, smooth);
    shotCamera.position.set(pos[0], pos[1], pos[2]);
    shotCamera.up.set(0, 1, 0);
    shotCamera.lookAt(tgt[0], tgt[1], tgt[2]);
    shotCamera.fov = Math.max(1, Math.min(179, fov));
    shotCamera.updateProjectionMatrix();
  }

  function setTheaterMode(on) {
    if (theaterMode === !!on) return;
    theaterMode = !!on;
    _resize();
    _renderOnce();
  }

  function resetView() {
    if (!mounted) return;
    navCamera.position.set(...DEFAULT_NAV_POS);
    orbitControls.target.set(...DEFAULT_NAV_TARGET);
    navCamera.lookAt(...DEFAULT_NAV_TARGET);
    orbitControls.update();
    _renderOnce();
  }

  // Reserved for future multi-object scene staging. The backend already
  // supports camera.scene_objects (see camera_engine.py's
  // _normalize_scene_objects) but the frontend has never built this array
  // — intentionally out of scope for this pass (see plan notes). Kept as a
  // no-op entry point now so wiring it up later is additive, not a rewrite.
  function setSceneObjects(_list) { /* no-op for now */ }

  function _resize() {
    if (!renderer || !navCamera) return;
    // clientWidth/Height (not getBoundingClientRect) for the layout size: the
    // rect reflects LiteGraph's canvas-zoom CSS transform and would size the
    // renderer wrong as the user zooms the graph. The rect IS used for one
    // thing though — the node's fullscreen mode applies CSS `zoom`, which
    // scales rendering but not layout px, so without this ratio the canvas
    // would render blurry at fullscreen.
    const w = containerEl.clientWidth, h = containerEl.clientHeight;
    if (!w || !h) return;
    const rect = containerEl.getBoundingClientRect();
    const zoomRatio = rect.width > 0 ? rect.width / w : 1;
    const dpr = Math.min((window.devicePixelRatio || 1) * zoomRatio, 3);
    if (Math.abs(renderer.getPixelRatio() - dpr) > 0.01) renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    navCamera.aspect = w / h;
    navCamera.updateProjectionMatrix();

    // PiP inset: a small bottom-right corner window for staging (~34% of the
    // viewport width) that grows to fill most of the viewport in theater
    // mode — Play is meant to be watched, not squinted at in a thumbnail.
    let pipW, pipH, pad;
    if (theaterMode) {
      pad = 14;
      pipW = Math.round(Math.min(w - pad * 2, (h - pad * 2) * (16 / 9)));
      pipH = Math.round(pipW * 9 / 16);
      pipRect = { x: Math.round((w - pipW) / 2), y: Math.round((h - pipH) / 2), w: pipW, h: pipH };
    } else {
      pad = 8;
      pipW = Math.round(Math.max(140, Math.min(260, w * 0.34)));
      pipH = Math.round(pipW * 9 / 16);
      pipRect = { x: w - pipW - pad, y: h - pipH - pad, w: pipW, h: pipH };
    }
    if (pipEl) {
      pipEl.style.left = pipRect.x + "px"; pipEl.style.top = pipRect.y + "px";
      pipEl.style.width = pipRect.w + "px"; pipEl.style.height = pipRect.h + "px";
    }
    if (shotCamera) { shotCamera.aspect = pipW / pipH; shotCamera.updateProjectionMatrix(); }

    if (active) _renderOnce();
  }

  function _renderOnce() {
    if (!renderer || !scene || !navCamera) return;
    renderer.setViewport(0, 0, containerEl.clientWidth, containerEl.clientHeight);
    renderer.setScissorTest(false);
    renderer.render(scene, navCamera);
    _renderPip();
  }

  function _renderPip() {
    if (!shotCamera || !pipRect || !state().keyframes?.length) return;
    const hidden = pipHidden();
    hidden.forEach((o) => { o._pipPrevVisible = o.visible; o.visible = false; });
    // three.js viewport/scissor Y origin is bottom-left; pipRect.y was computed
    // from the top, so flip it.
    const glY = containerEl.clientHeight - pipRect.y - pipRect.h;
    renderer.setScissorTest(true);
    renderer.setScissor(pipRect.x, glY, pipRect.w, pipRect.h);
    renderer.setViewport(pipRect.x, glY, pipRect.w, pipRect.h);
    renderer.render(scene, shotCamera);
    renderer.setScissorTest(false);
    hidden.forEach((o) => { o.visible = o._pipPrevVisible; });
  }

  function _tick() {
    if (!active) return;
    if (orbitControls) orbitControls.update();
    _renderOnce();
    raf = requestAnimationFrame(_tick);
  }

  function onActivate() {
    if (!mounted) mount();
    if (active) return;
    active = true;
    _tick();
  }

  function onDeactivate() {
    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  function dispose() {
    onDeactivate();
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    if (renderer) renderer.domElement.removeEventListener("pointerdown", _onPointerDown);
    if (transformControls) { transformControls.removeEventListener("objectChange", _onGizmoChange); transformControls.dispose(); }
    if (orbitControls) orbitControls.dispose();
    if (scene) disposeObject3D(scene);
    if (renderer) { renderer.dispose(); renderer.domElement.remove(); }
    if (pipEl) pipEl.remove();
    renderer = null; scene = null; navCamera = null; orbitControls = null; transformControls = null;
    groundGrid = null; axesGroup = null; subjectGroup = null; pathLine = null; scrubMarker = null;
    shotCamera = null; pipEl = null; pipRect = null;
    markers = []; sightLines = [];
    mounted = false;
  }

  return {
    mount, dispose,
    refreshKeyframes, refreshKeyframe, selectKeyframe,
    setProxy, setInterpolation, setEnvironment, setDuration, setTime, setSceneObjects, resetView,
    getViewPose, setTheaterMode,
    onActivate, onDeactivate,
  };
}
