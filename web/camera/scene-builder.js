// Pure THREE geometry factories — no lifecycle, no event wiring, just
// "given params, return an Object3D". Proxy geometry is transcribed 1:1
// from camera_engine.py's _proxy_mesh() coefficients (kept at unit scale,
// s=1; the caller applies proxy_scale as a group-level Group.scale instead
// of baking it into every dimension like the Python side does, so a
// scale-only change is one group.scale.setScalar() call with no rebuild).
//
// Deliberate fidelity tradeoff: camera_engine.py hand-tunes per-triangle
// brightness (base * face_factor) as a stylized flat-shading hack — not
// physically based. Chasing exact tonal parity here isn't worth it; every
// proxy shares one MeshStandardMaterial instead. Silhouette, proportions,
// and the +Z-front convention are what actually matter for previz, and
// those match exactly since the coefficients are copied verbatim.

import * as THREE from "../lib/three/three.module.min.js";

function proxyMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x9a9a9a, flatShading: true, roughness: 0.85, metalness: 0.05 });
}

function addBox(group, cx, cy, cz, sx, sy, sz) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), proxyMaterial());
  mesh.position.set(cx, cy, cz);
  group.add(mesh);
}

function addSphere(group, cx, cy, cz, r) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), proxyMaterial());
  mesh.position.set(cx, cy, cz);
  group.add(mesh);
}

function addCylinder(group, cx, cy, cz, r, h) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), proxyMaterial());
  mesh.position.set(cx, cy, cz);
  group.add(mesh);
}

export function buildProxyMesh(kind = "Humanoid") {
  const group = new THREE.Group();
  switch (kind) {
    case "Cube":
      addBox(group, 0, 0.5, 0, 1, 1, 1);
      break;
    case "Sphere":
      addSphere(group, 0, 1, 0, 0.55);
      break;
    case "Cylinder":
      addCylinder(group, 0, 0.75, 0, 0.45, 1.5);
      break;
    case "Capsule":
      addCylinder(group, 0, 1, 0, 0.38, 1.25);
      addSphere(group, 0, 1.63, 0, 0.38);
      addSphere(group, 0, 0.37, 0, 0.38);
      break;
    case "Product Bottle":
      addBox(group, 0, 0.72, 0, 0.78, 1.44, 0.48);
      addCylinder(group, 0, 1.56, 0, 0.23, 0.28);
      addBox(group, 0, 0.78, 0.255, 0.50, 0.56, 0.04);
      break;
    default: // Humanoid — 12 stacked boxes, same centers/sizes as the Python else-branch
      addBox(group, 0, 2.18, 0, 1.05, 1.18, 0.60);       // torso
      addBox(group, 0, 1.48, 0, 0.84, 0.52, 0.54);       // hips
      addBox(group, 0, 2.87, 0, 0.30, 0.28, 0.30);       // neck
      addBox(group, 0, 3.32, 0, 0.74, 0.82, 0.68);       // head
      addBox(group, 0, 3.32, 0.45, 0.18, 0.18, 0.24);    // face/hair block
      addBox(group, 0, 2.25, 0.325, 0.48, 0.30, 0.05);   // chest plate
      addBox(group, -0.69, 2.05, 0, 0.30, 1.48, 0.36);   // left arm
      addBox(group, 0.69, 2.05, 0, 0.30, 1.48, 0.36);    // right arm
      addBox(group, -0.25, 0.74, 0, 0.37, 1.48, 0.44);   // left upper leg
      addBox(group, 0.25, 0.74, 0, 0.37, 1.48, 0.44);    // right upper leg
      addBox(group, -0.25, 0.10, 0.17, 0.43, 0.20, 0.72); // left lower leg/foot
      addBox(group, 0.25, 0.10, 0.17, 0.43, 0.20, 0.72);  // right lower leg/foot
      break;
  }
  return group;
}

// Ground grid matching camera_engine.py's -8..8 step-2 line grid extent/spacing.
export function buildGroundGrid() {
  return new THREE.GridHelper(16, 8, 0x606268, 0x505258);
}

// Custom 3-line axes (deliberately NOT THREE.AxesHelper) so Z stays yellow,
// matching the backend's RGB(220,190,70) Z axis and its "+Z front"
// convention — stock AxesHelper's default blue Z would contradict it.
export function buildAxes(length = 2) {
  const group = new THREE.Group();
  const addLine = (dir, color) => {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      dir.clone().multiplyScalar(length),
    ]);
    group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })));
  };
  addLine(new THREE.Vector3(1, 0, 0), 0xc83c3c); // X — red
  addLine(new THREE.Vector3(0, 1, 0), 0x3cc850); // Y — green
  addLine(new THREE.Vector3(0, 0, 1), 0xdcbe46); // Z — yellow ("+Z front")
  return group;
}

export function disposeObject3D(obj) {
  obj.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose());
      else node.material.dispose();
    }
  });
}
