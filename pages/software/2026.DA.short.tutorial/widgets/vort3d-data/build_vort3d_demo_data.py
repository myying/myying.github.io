"""Build the interactive "uncertainty demo" data bundle for the vort3d pool.

Runs on Olivia. Reads the 200-member free-running pool diagnostics caches
(track/intensity/size, hourly, day 0-13) plus the raw pool netCDF state files,
and writes a compact web bundle:

  out/
    metadata.json          - grid/levels/quantization/sampling info
    timeseries.bin         - float32 LE: [days(nt)][x(nt,nens)][y][vmax][size]
    structure/mem{NNN}.bin - per selected member, per 3-hourly step:
                             wind-speed map (32x32 int8), pstar map (32x32 int16),
                             radius-height vt + vr cross-sections (8x40 int8 each),
                             radius-height theta cross-section (8x40 int16)

Maps are cropped to a 64-cell (1280 km) window centred on the vortex (x
periodically wrapped, y clamped to the domain) and downsampled 2x -> 32x32.
Cross-sections are azimuthal means over the full domain (40 bins x 20 km),
all 8 sigma levels (7 free atmosphere + boundary layer).

Selection: 20 of the 200 pool members drawn with a fixed RNG seed.
Window: day 0 -> day 11 (11 days), hourly for the time series, 3-hourly for
the structure fields (89 steps).
"""
import os, sys, json, gzip, glob
sys.path.insert(0, os.path.expanduser('~/code/NEDAS'))
sys.path.insert(0, os.path.expanduser('~/code/vort3d_da_exp'))
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('MKL_NUM_THREADS', '1')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('NUMEXPR_NUM_THREADS', '1')

import numpy as np
from datetime import datetime, timezone, timedelta
from multiprocessing import Pool

HERE = os.path.expanduser('~/code/vort3d_da_exp')
SWEEP_ROOT = '/cluster/projects/nn2993k/yingyue/vort3d_da_exp/pool'
TIME_START = datetime(2001, 1, 1, tzinfo=timezone.utc)
CYCLE_PERIOD = timedelta(hours=6)

NENS_POOL = 200
NENS_SEL = 20
RNG_SEED = 42
DAY_END = 11.0
STRUCT_STEP_H = 3.0

MAP_CELLS = 64        # crop window in grid cells (centred on vortex)
MAP_SIZE = 32         # downsampled map size (cells of 2 grid cells)
NR = 40               # cross-section radius bins
DX = 20.0             # km, grid spacing

OUT = os.path.join(HERE, 'demo_web') if 'DEMO_OUT' not in os.environ else os.environ['DEMO_OUT']


def path_for(T):
    n_cycles = int((T - TIME_START) // CYCLE_PERIOD)
    cycle_start = TIME_START + n_cycles * CYCLE_PERIOD
    return os.path.join(SWEEP_ROOT, 'cycle', cycle_start.strftime('%Y%m%d%H%M'), 'vort3d')


# ---------------------------------------------------------------- time series
def load_timeseries():
    caches = [os.path.join(HERE, f) for f in (
        'pool_diagnostics_day0-10_n200_hourly.npz',
        'pool_diagnostics_day10-13_n200_hourly.npz')]
    days_list, center_list, vmax_list, size_list = [], [], [], []
    last_day = None
    for p in caches:
        d = np.load(p)
        days, center, vmax, size = d['days'], d['center'], d['vmax'], d['size']
        start = 1 if (last_day is not None and abs(days[0] - last_day) < 1e-6) else 0
        days_list.append(days[start:]); center_list.append(center[start:])
        vmax_list.append(vmax[start:]); size_list.append(size[start:])
        last_day = days[-1]
    days = np.concatenate(days_list)
    center = np.concatenate(center_list)
    vmax = np.concatenate(vmax_list)
    size = np.concatenate(size_list)
    keep = days <= DAY_END + 1e-9
    return days[keep], center[keep], vmax[keep], size[keep]


# ------------------------------------------------------------------ structure
def _polar_grid(nx, ny, ci, cj):
    ii, jj = np.meshgrid(np.arange(nx), np.arange(ny))
    di = ii - ci
    di = (di + nx // 2) % nx - nx // 2
    dj = jj - cj
    return np.hypot(di, dj), np.arctan2(dj, di)


def _azim_mean(field, r, nr):
    """field: (..., ny, nx); r: (ny, nx) -> radius-binned mean, last axis = radius."""
    r_idx = np.round(r).astype(int)
    r_flat = r_idx.ravel()
    f_flat = field.reshape(field.shape[:-2] + (-1,))
    out = np.full(field.shape[:-2] + (nr,), np.nan)
    for k in range(nr):
        m = r_flat == k
        if m.any():
            out[..., k] = f_flat[..., m].mean(axis=-1)
    return out


def _worker_member(args):
    member, time_strs, centers = args
    import netCDF4 as nc
    from NEDAS.config import Config
    from NEDAS.schemes import get_scheme
    config = Config(config_file=os.path.join(HERE, 'vort3d_da_config_pool_full.yml'),
                    nproc=1, debug=False, quiet=True)
    scheme = get_scheme(config)
    model = scheme.c.models['vort3d']
    nx, ny, nz = model.nx, model.ny, model.nz
    nt = len(time_strs)
    winds = np.zeros((nt, nz + 1, 2, ny, nx), dtype=np.float32)   # u,v all levels
    theta = np.zeros((nt, nz + 1, ny, nx), dtype=np.float32)
    pstar = np.zeros((nt, ny, nx), dtype=np.float32)
    centers = np.asarray(centers)
    for n, ts in enumerate(time_strs):
        T = datetime.strptime(ts, '%Y%m%d%H%M%S').replace(tzinfo=timezone.utc)
        fname = model.filename(path=path_for(T), time=T, member=member)
        ds = nc.Dataset(fname)
        u = ds.variables['u'][0]; v = ds.variables['v'][0]
        winds[n, :, 0] = u; winds[n, :, 1] = v
        theta[n] = ds.variables['theta'][0]
        pstar[n] = ds.variables['pstar'][0]
        ds.close()

    blob = bytearray()
    i0s, j0s = [], []
    for n in range(nt):
        ci, cj = centers[n]
        # --- crop map window (x periodic wrap, y clamped)
        i0 = (ci - MAP_CELLS // 2) % nx
        i1 = i0 + MAP_CELLS
        j0 = max(0, min(cj - MAP_CELLS // 2, ny - MAP_CELLS))
        j1 = j0 + MAP_CELLS
        # downsampled indices: every 2nd grid cell
        di = (np.arange(MAP_SIZE) * 2) % nx
        dj = np.arange(MAP_SIZE) * 2
        gi = (i0 + di) % nx
        gj = j0 + dj
        uu = winds[n, nz, 0][np.ix_(gj, gi)]
        vv = winds[n, nz, 1][np.ix_(gj, gi)]
        speed = np.hypot(uu, vv)
        ps = pstar[n][np.ix_(gj, gi)]
        v_int = np.clip(np.round(speed / 0.7), 0, 127).astype(np.int8)
        p_int = np.clip(np.round(ps - 80000.0), -32768, 32767).astype(np.int16)
        blob += v_int.tobytes()
        blob += p_int.tobytes()
        # --- radius-height cross-sections (all levels)
        r, ang = _polar_grid(nx, ny, ci, cj)
        vt = np.zeros((nz + 1, NR))
        vr = np.zeros((nz + 1, NR))
        th = np.zeros((nz + 1, NR))
        for k in range(nz + 1):
            uu2, vv2 = winds[n, k, 0], winds[n, k, 1]
            v_r = uu2 * np.cos(ang) + vv2 * np.sin(ang)
            v_t = -uu2 * np.sin(ang) + vv2 * np.cos(ang)
            vt[k] = _azim_mean(v_t, r, NR)
            vr[k] = _azim_mean(v_r, r, NR)
            th[k] = _azim_mean(theta[n, k], r, NR)
        vt_int = np.clip(np.round(vt / 0.7), -127, 127).astype(np.int8)
        vr_int = np.clip(np.round(vr / 0.7), -127, 127).astype(np.int8)
        th_int = np.clip(np.round((th - 250.0) * 100.0), -32768, 32767).astype(np.int16)
        blob += vt_int.tobytes()
        blob += vr_int.tobytes()
        blob += th_int.tobytes()
        i0s.append(int(i0)); j0s.append(int(j0))
    return member, bytes(blob), i0s, j0s


def build_structure(members, days, center):
    """members: pool member indices (0-based). days: full hourly day axis."""
    t_hours = np.arange(0.0, DAY_END * 24.0 + 1e-9, STRUCT_STEP_H)
    idx = np.searchsorted(days, t_hours / 24.0)
    time_strs = [(TIME_START + timedelta(hours=h)).strftime('%Y%m%d%H%M%S') for h in t_hours]
    n_struct = len(t_hours)
    print(f'structure: {n_struct} steps (every {STRUCT_STEP_H:g}h, day0-{DAY_END:g}), '
          f'{len(members)} members', flush=True)

    args = [(m, time_strs, center[idx, m]) for m in members]
    os.makedirs(os.path.join(OUT, 'structure'), exist_ok=True)
    crop = {}
    with Pool(int(os.environ.get('NPROC', 48))) as pool:
        for i, (m, blob, i0s, j0s) in enumerate(pool.imap_unordered(_worker_member, args)):
            gz = gzip.compress(blob, compresslevel=9)
            with open(os.path.join(OUT, 'structure', f'mem{m + 1:03d}.bin.gz'), 'wb') as f:
                f.write(gz)
            crop[m] = (i0s, j0s)
            if (i + 1) % 10 == 0 or (i + 1) == len(members):
                print(f'  {i+1}/{len(members)} members done', flush=True)
    return t_hours, idx, crop


def main():
    os.makedirs(OUT, exist_ok=True)
    days, center, vmax, size = load_timeseries()
    nt, nens_pool = vmax.shape
    print(f'timeseries: {nt} hourly steps day{days[0]:g}-{days[-1]:g}, '
          f'{nens_pool} pool members', flush=True)

    rng = np.random.default_rng(RNG_SEED)
    members = np.sort(rng.choice(nens_pool, size=NENS_SEL, replace=False))
    print('selected members (0-based):', members.tolist(), flush=True)

    # ---- write timeseries.bin (float32 LE) - subset diagnostics to selected members only
    c_s = center[:, members]
    v_s = vmax[:, members]
    s_s = size[:, members]
    ts = np.concatenate([days.astype(np.float32),
                         c_s[..., 0].astype(np.float32).ravel(),
                         c_s[..., 1].astype(np.float32).ravel(),
                         v_s.astype(np.float32).ravel(),
                         s_s.astype(np.float32).ravel()])
    with open(os.path.join(OUT, 'timeseries.bin'), 'wb') as f:
        f.write(ts.tobytes())

    # ---- structure fields (per pool member; full center grid used for cropping)
    t_hours, idx, crop = build_structure(members, days, center)

    # ---- metadata
    import sys as _sys
    _sys.path.insert(0, os.path.join(HERE))
    _sys.path.insert(0, os.path.expanduser('~/code/NEDAS'))
    from NEDAS.models.vort3d.core import make_sigma_levels, PSTAR_FAR, p_top
    sigma_mid, _ = make_sigma_levels(7)
    meta = {
        'title': 'vort3d 200-member free-running pool - uncertainty demo',
        'model': 'vort3d (Zhu, Smith & Ulrich 2001 3D tropical cyclone toy model, NEDAS port)',
        'pool': {'nens': NENS_POOL, 'days': DAY_END, 'dx_km': DX, 'nx': 128, 'ny': 128,
                 'nz': 7, 'PSTAR_FAR_pa': float(PSTAR_FAR), 'p_top_pa': float(p_top)},
        'selection': {'nens': NENS_SEL, 'rng_seed': RNG_SEED,
                      'members': members.tolist()},
        'timeseries': {'nt': int(nt), 'start_day': float(days[0]),
                       'step_hours': float((days[1] - days[0]) * 24.0),
                       'day_end': float(DAY_END),
                       'fields': ['track_x_cells', 'track_y_cells', 'vmax_ms', 'size_km']},
        'structure': {'n_steps': int(len(t_hours)), 'step_hours': float(STRUCT_STEP_H),
                      'day_end': float(DAY_END),
                      'map': {'cells': MAP_CELLS, 'size': MAP_SIZE, 'dx_km': DX},
                      'xsect': {'nr': NR, 'dr_km': DX, 'n_levels': 8,
                                'sigma_mid': sigma_mid.tolist(),
                                'p_hpa': (sigma_mid * PSTAR_FAR + p_top).tolist()},
                      'quant': {'wind_scale_ms': 0.7,
                                'pstar_offset_pa': 80000.0,
                                'vt_scale_ms': 0.7,
                                'vr_scale_ms': 0.7,
                                'theta_offset_k': 250.0, 'theta_scale_k': 0.01},
                      'crop_i0': {str(m): crop[m][0] for m in members},
                      'crop_j0': {str(m): crop[m][1] for m in members}},
        'files': {'timeseries': 'timeseries.bin',
                  'structure_dir': 'structure',
                  'structure_file': 'structure/mem{NNN}.bin.gz'},
    }
    with open(os.path.join(OUT, 'metadata.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print('wrote', OUT, flush=True)


if __name__ == '__main__':
    main()
