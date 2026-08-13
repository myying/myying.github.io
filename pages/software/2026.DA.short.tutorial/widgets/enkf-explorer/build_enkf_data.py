"""Builds widgets/enkf-explorer/data.js for the Ensemble Kalman Filter
Explorer (Ch. 3).

The EnKF widget reuses the EXACT same synthetic experiment as Ch. 2
(widgets/corr-explorer/data.js): same 50x50 grid, same truth blob, same
100-member position-perturbed ensemble, same observation. Chapter 3 then
assimilates that observation with the stochastic EnKF.

The only addition is obs_z: one unit normal per member, the standardized
observation perturbation of the stochastic EnKF (y^m = y + eps^m,
eps^m ~ N(0, R), so eps^m = obs_z[m] * sqrt(R)). R is interactive in the
widget, so only the unit normals are stored.

Usage:  python3 build_enkf_data.py
"""
import json
import re
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
CORR_DATA = HERE.parent / "corr-explorer" / "data.js"

src = CORR_DATA.read_text()
m = re.match(r"window\.NEDAS_DATA = (\{.*\});?\s*$", src, re.S)
if not m:
    raise SystemExit(f"cannot parse {CORR_DATA}")
d = json.loads(m.group(1))

rng = np.random.default_rng(20260701)  # fixed seed -> reproducible obs_z
d["obs_z"] = [round(float(x), 6) for x in rng.normal(size=d["meta"]["nens"])]

out = "window.NEDAS_DATA = " + json.dumps(d, separators=(",", ":")) + ";\n"
(HERE / "data.js").write_text(out)
print(f"wrote {HERE / 'data.js'}: {d['meta']['nens']} members, obs_z[0:3] = {d['obs_z'][:3]}")
