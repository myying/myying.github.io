# vort3d uncertainty demo — data bundle

Interactive widget: `pages/software/2026.DA.short.tutorial/vort3d-demo.html` (no external libraries,
plain HTML5 canvas). Data lives in `data/`.

## Contents

| file | what |
|---|---|
| `data/metadata.json` | grid / levels / quantization / sampling info, member list |
| `data/timeseries.bin` | float32 LE: `[days(265)][track_x][track_y][vmax][size]`, each `(265,20)` (selected 20 members only) |
| `data/bundle.js` | embedded copy of metadata + timeseries (base64) so the page also works when opened from disk (`file://`, where `fetch` is blocked); structure maps need HTTP |
| `data/structure/mem{NNN}.bin.gz` | per pool member, 89 steps (3-hourly, day 0–11): wind-speed map (32×32 int8), pstar map (32×32 int16), radius–height radial- and tangential-wind (8×40 int8 each) and θ (8×40 int16) cross-sections |

Per step (4352 bytes): wind 1024 B, pstar 2048 B, vt 320 B, vr 320 B, theta 640 B
(theta = 320 int16, not 640 — mind the byte/element distinction when decoding).

Quantization: wind, vt & vr ×0.7 m/s (int8, no offset); pstar −80000 Pa (int16);
θ −250 K, ×100 (int16). All little-endian.

## Source

- 200-member free-running `vort3d` pool (NEDAS, Olivia):
  `/cluster/projects/nn2993k/yingyue/vort3d_da_exp/pool/` — day 0→11 window
  (hourly output; on-disk coverage currently through day 13).
- Diagnostics caches: `~/code/vort3d_da_exp/pool_diagnostics_day0-10_n200_hourly.npz`
  and `day10-13_n200_hourly.npz` (track/intensity/size, hourly).
- 20 of 200 members selected with `np.random.default_rng(42)`, no replacement (members: 16, 17, 25, 38, 80, 90, 100, 101, 119, 131, 139, 140, 142, 147, 154, 159, 167, 184, 186, 187, 0-based).
- `timeseries.bin` is subset to the selected members (a previous bug shipped all 200 — fixed 2026-08-02); `bundle.js` is a packaging step (`window.VORT3D_BUNDLE`), regenerate it whenever `timeseries.bin`/`metadata.json` change.

## Regenerate

Run on Olivia (reads the pool netCDF + diagnostics caches, writes `demo_web/`):

```bash
cd ~/code/vort3d_da_exp
NPROC=48 python3 build_vort3d_demo_data.py
```

then copy `demo_web/*` into this folder. Rebuild takes ~3 min.
