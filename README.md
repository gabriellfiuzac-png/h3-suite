# H3 Suite

A single-node ComfyUI interface for **MiniMax H3 Reference Director** — the full
9-picture / 3-video / 2-audio fixed-role reference system, an in-node 3D camera
guide director, speed-optimization toggles (FirstBlockCache / SageAttention /
low-VRAM attention), and prompt-enhance via a local LLM using a distilled
MiniMax H3 prompt-engineering ruleset.

This is a standalone custom node — it has no dependency on any other custom
node repository beyond what's listed below.

## Install

1. Clone (or copy) this folder into `ComfyUI/custom_nodes/h3-suite`.
2. Restart ComfyUI. `install.py` runs automatically and installs the small,
   code-only required dependencies (see below). This never downloads model
   weights.
3. Add the **H3 Suite** node to a graph (search for it in the node picker).
4. Open its **Setup** tab:
   - **Required** items should already be green after step 2. If not, click
     *Install missing required items*.
   - **Optional** items are the MiniMax H3 model weights (~42GB) and the
     optional speed nodes (SageAttention / FirstBlockCache / KJNodes). Only
     installed when you click the button — never automatically.
5. If you already have the MiniMax H3 model files somewhere else, add that
   folder to `ComfyUI/extra_model_paths.yaml` under the `diffusion_models` /
   `text_encoders` / `vae` categories, restart ComfyUI, then use the
   **Models** dropdowns in the node's Settings tab (click *Refresh model
   list*) instead of downloading again.

## Required dependencies (installed automatically by `install.py`)

- [`ComfyUI-H3-Multishot`](https://github.com/jlucasmcrell/ComfyUI-H3-Multishot) — `H3ConditionStrength`, `H3FreeTextEncoder`
- The bundled `ComfyUI-H3-ExactMasterMemory` package (`vendor/`) — `H3SemanticReferenceToVideo`, `H3ResolutionPreset`, `H3DurationPlanner`, `H3TrimAVToFrames`, `H3SourceEditAudioPriority`
- `av` (PyAV), for the in-node camera-guide renderer
- A recent ComfyUI with native MiniMax H3 support (`UNETLoader`/`CLIPLoader` for the H3 model files) and native `VIDEO`/`LoadVideo`/`GetVideoComponents` support

## Optional dependencies (installed on demand from the Setup tab)

- The 4 MiniMax H3 model files (diffusion model, text/vision encoder, video VAE, audio VAE) from `huggingface.co/Comfy-Org/MiniMax-H3`
- [`ComfyUI-KJNodes`](https://github.com/kijai/ComfyUI-KJNodes) — SageAttention patch + low-VRAM attention
- [`ComfyUI-MiniMaxH3-FirstBlockCache`](https://github.com/duckyshell/ComfyUI-MiniMaxH3-FirstBlockCache)

## Prompt Enhance

The "✨ Enhance Prompt" button runs a local LLM already expected to be part of
your ComfyUI's native text-generation nodes (`CLIPLoader` type `ltxv` +
`TextGenerate` + `SaveText`), using `gemma_3_12B_it_fp8_scaled.safetensors` as
the model file. If you don't have that file, either add it to your
`text_encoders` folder or edit `workflows/h3_suite_prompt_enhance.json` to
point at a different local LLM you already have.

## Notes

- Video reference slots (Motion / Camera / Source-edit) use ComfyUI's native
  `LoadVideo` + `GetVideoComponents` — no VideoHelperSuite dependency.
- The in-node Camera Director is a simplified keyframe + preset editor (not a
  full mouse-driven 3D orbit canvas), but renders through the same math engine
  a full 3D editor would use, producing fully compatible camera guides.
