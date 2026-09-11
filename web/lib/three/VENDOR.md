# Vendored three.js

Pinned version: **r160 / 0.160.0** (pure-ESM release, no UMD build needed).

Files, and where they came from:
- `three.module.min.js` ← `https://unpkg.com/three@0.160.0/build/three.module.min.js`
- `OrbitControls.js` ← `https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js`
- `TransformControls.js` ← `https://unpkg.com/three@0.160.0/examples/jsm/controls/TransformControls.js`

## Required patch after (re-)downloading

Both addon files ship with a bare-specifier import:

```js
} from 'three';
```

This only resolves via an import map, which we don't control (ComfyUI's own
frontend may or may not expose one, and may bundle a different three.js
version for its own 3D nodes). Patch that single line in **both** addon
files to a relative import instead, so the vendored trio is fully
self-contained regardless of ComfyUI version or offline installs:

```js
} from './three.module.min.js';
```

One-liner to redo this after re-vendoring:

```sh
sed -i "s|from 'three';|from './three.module.min.js';|" web/lib/three/OrbitControls.js web/lib/three/TransformControls.js
```

## Version note

r160 predates the `TransformControls.getHelper()` split (later three.js
versions separated the gizmo's visual helper from the controls object) —
`TransformControls` here still extends `Object3D` directly and is added to
the scene with a plain `scene.add(controls)`. If this ever gets upgraded to
a newer three.js, re-check `TransformControls`' scene-attachment API before
assuming `scene.add(controls)` still works as-is.
