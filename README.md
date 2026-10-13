# Gulmira

One Iron Man Mk III mission in the browser, modelled on the Gulmira desert sequence from *Iron Man* (2008). You start in the air over the Kunar valley at dusk, fly to the village, free the hostages without hurting civilians, take out the tank, wipe out the Stark Industries missile cache, intercept the launched missile and then shake off a pair of F-22s.

Everything is built with three.js and plain ES modules. There is no build step.

## Run locally

```bash
python3 tools/serve.py 8790
```

Open `http://localhost:8790/` in Chrome (the browser it was tested in) on a machine with a decent GPU. The render resolution is chosen automatically and can be changed in Settings.

URL switches for testing: `?mission=0` (free roam), `?at=village` (start in the village), `?pop=test` (test population).

## Controls

| Key | Action |
|---|---|
| Mouse | Look / steer |
| W A S D | Move (ground, hover) / throttle (flight) |
| Space | Take off, climb |
| Ctrl / C | Descend, land |
| Shift + W | Fly / boost |
| S (flight) | Air brake to hover |
| Left mouse | Repulsors |
| Right mouse | Hold to lock micro-missiles, release to fire |
| F | Forearm anti-tank rocket |
| E | Flares |
| V | Helmet view |
| Esc | Pause |

## How it is made

- **Terrain**: `tools/gen-terrain.mjs` bakes a 20 km, 4096² heightfield offline (multi-scale hydraulic erosion, a carved canyon, the village plateau and the missile cache bowl) plus a terrain-shadow map for the low sun. At runtime the terrain is drawn with CDLOD, the CPU and GPU sample identical bicubic heights, and the surface uses hex-tiled Poly Haven materials.
- **Atmosphere**: a precomputed Nishita sky LUT (Rayleigh, Mie and ozone) drives the sky dome, procedural clouds, aerial perspective and image-based lighting. Cascaded shadow maps are refreshed on a staggered schedule.
- **Mk III**: the armour is generated in code. Plates are cut from superellipse loft surfaces, the shader adds panel lines, rivets, dust and scratches, and the animation is procedural (flight, hover, aim IK, the superhero landing, shoulder micro-missile pods and the forearm launcher).
- **People and vehicles**: hand-scripted skinned humans with procedural animation and Verlet ragdolls. Procedural T-72, Hilux technical with a DShK, MAZ-543 with a Scud, ZU-23 and F-22.
- **Rendering**: HDR with MSAA and a logarithmic depth buffer, soft depth-aware particles, mip-chain bloom, camera motion blur, sun shafts and ACES tone mapping.
- **Audio**: Web Audio with HRTF panning, distance filtering, the speed-of-sound delay and convolution reverb. JARVIS speaks through the browser's speech synthesis.

## Tools

- `tools/serve.py`: no-cache dev server. It also saves screenshots posted from the game (`G.shot(name)`).
- `tools/playtest.mjs`, `tools/profile.mjs`, `tools/cpuprof.mjs`: real-loop FPS, GPU cost breakdown and CPU profile in headless Chrome.
- `tools/bake-props.py`: Blender script that decimates Poly Haven scans into LOD GLBs.
- `tools/suit-viewer.html`, `tools/human-viewer.html`, `tools/vehicle-viewer.html`: model viewers.

## Credits

- Textures and scanned props: [Poly Haven](https://polyhaven.com) (CC0).
- Sound effects and music: see `assets/audio/CREDITS.md` and `assets/audio/mz/CREDITS-markzero.md` (CC0, CC BY and public domain).
- three.js r169 is vendored under `vendor/` (MIT).

A fan project, not affiliated with Marvel.
