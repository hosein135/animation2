# Animation Generator (d3.js / Bun)

Declarative **JavaScript** animation pipeline: describe objects and actions in JSON, render with **d3.js** (SVG → PNG), encode with hardware-aware FFmpeg.

This is the JS counterpart of [`../animation1`](../animation1) (Blender / Python). Default data recreates a pelican riding a bicycle along a sunset boardwalk — same `data/` schema and scene.

## Tooling (Windows)

| Tool | How it is installed |
|------|---------------------|
| **Bun `1.1.42`** | **vfox** (`vfox add bun` → `vfox install bun@1.1.42`) via `run.ps1` |
| **FFmpeg `7.1`** | **winget** `Gyan.FFmpeg` |
| **vfox `0.6.2`** | **winget** `version-fox.vfox` |

## Acceleration

| Mode | Workload |
|------|----------|
| `--renderer d3` (default) | Bun scene graph → d3 orthographic SVG → resvg PNG frames |
| Encode | **NVENC** → **QSV** → all-core **libx264** |

## Quick start

```powershell
# Windows (admin — installs bun via vfox, then renders)
.\run.cmd
.\run.ps1
.\run.ps1 --renderer d3
```

Already bootstrapped:

```powershell
bun install
bun scripts/pipeline.js
```

## Authoring a scene

| Path | Role |
|------|------|
| `data/scene.json` | Timing, camera, lights, object placements, **actions**, encode knobs |
| `data/materials.json` | Shared material palette (`color`, `metallic`, `roughness`, optional `emission`) |
| `data/objects/*.json` | Reusable object graphs (primitives, groups, factory refs) |

### Object types

`group` / `empty`, `sphere`, `box`, `rod` / `cylinder`, `torus`, `path`, `mesh`, `camera`, `light`, `factory`, `instance` / `ref`

Procedural pieces (wheels, palms, waves, pouch meshes, …) use `"type": "factory"` with a name from `scripts/factories.js`.

### Actions

Declared under `scene.json` → `actions`. Built-ins in `scripts/actions.js`:

| Action | Purpose |
|--------|---------|
| `translate` | Keyframe location A→B |
| `rotate` | Keyframe euler rotation |
| `spin` | Continuous spin (or from `distance` / `radius`) |
| `bob` | Sinusoidal location offset |
| `flutter` | Sinusoidal rotation sway |
| `follow_axis` | Offset one axis over time |
| `look_at` | Orient toward points |
| `parent` | Parent keep-transform |
| `bob_matching` | Bob all objects with a name prefix |
| `set_interpolation` | LINEAR / BEZIER on channels |

Example placement:

```json
{
  "objects": [
    { "ref": "ride_root", "name": "RideRoot", "children": [
      { "ref": "bicycle", "name": "Bicycle" },
      { "ref": "pelican", "name": "Pelican" }
    ]},
    { "ref": "boardwalk" },
    { "ref": "environment" }
  ],
  "actions": [
    { "action": "translate", "target": "RideRoot", "from": [-3.2, 0, 0], "to": [3.8, 0, 0] }
  ]
}
```

Point the pipeline at another data directory with `--data-dir` / `DATA_DIR`.

## Layout

| Path | Role |
|------|------|
| `run.cmd` / `run.ps1` | Windows bootstrap (vfox → Bun) + pipeline |
| `scripts/pipeline.js` | Orchestrator + timing/hardware summary |
| `scripts/scene_builder.js` | JSON → scene graph |
| `scripts/prims.js` | Mesh / material primitives |
| `scripts/actions.js` | Animation action registry |
| `scripts/factories.js` | Procedural object factories |
| `scripts/render_animation.js` | d3.js SVG frames + resvg PNG |
| `scripts/encode_video.js` | NVENC / QSV / libx264 |
| `scripts/validate_data.js` | Schema + ref/action checks |
| `data/` | Scene, materials, objects |

Tune `output.prefer_encoder` (`auto` / `nvenc` / `qsv` / `cpu`) in `data/scene.json`.

Output: `output/animation.mp4`.
