"""Metrics computed identically for every embodiment."""
import numpy as np
from scipy.signal import find_peaks
from scipy.ndimage import gaussian_filter1d
from scipy.spatial import ConvexHull, QhullError
from .skeleton import IDX, ANKLE_H, HUMAN_HEIGHT, com, J

SIGMA_FRAMES = 3          # EDGE / AIST++ convention (3 frames at 30 fps)


# ------------------------------------------------------------------ beat alignment
def kinematic_beats(pos, fps):
    """Local minima of mean joint speed (AIST++ definition). pos (T,Jn,3)."""
    v = np.linalg.norm(np.diff(pos, axis=0), axis=2).mean(1) * fps
    v = gaussian_filter1d(v, 1.0)
    v = np.append(v, v[-1])
    pk, _ = find_peaks(-v, distance=int(0.2 * fps), prominence=0.1 * np.ptp(v))
    return pk, v


def bas(music_beats, kin_frames, fps, sigma=SIGMA_FRAMES):
    if len(kin_frames) == 0:
        return 0.0
    mb = np.asarray(music_beats) * fps
    d = np.abs(mb[:, None] - kin_frames[None, :]).min(1)
    return float(np.mean(np.exp(-d ** 2 / (2 * sigma ** 2))))


def chance_bas(music_beats, kin_frames, fps, n=24):
    """BAS when the music-beat grid is shifted by 15-85% of a period: what 'no relationship' scores."""
    per = np.median(np.diff(music_beats))
    return float(np.mean([bas(np.asarray(music_beats) + f * per, kin_frames, fps) for f in np.linspace(.15, .85, n)]))


# ------------------------------------------------------------------ DTW retention
def dtw(a, b, band=20):
    """Mean per-step Euclidean cost along the optimal warping path (Sakoe-Chiba band, frames)."""
    n, m = len(a), len(b)
    INF = 1e18
    D = np.full((n + 1, m + 1), INF); L = np.zeros((n + 1, m + 1)); D[0, 0] = 0
    for i in range(1, n + 1):
        lo, hi = max(1, i - band), min(m, i + band)
        c = np.linalg.norm(a[i - 1] - b[lo - 1:hi], axis=1)
        for k, j in enumerate(range(lo, hi + 1)):
            opts = (D[i - 1, j - 1], D[i - 1, j], D[i, j - 1])
            q = int(np.argmin(opts))
            pj = [(i - 1, j - 1), (i - 1, j), (i, j - 1)][q]
            D[i, j] = c[k] + opts[q]; L[i, j] = L[pj] + 1
    return float(D[n, m] / L[n, m])


def _kp(pos, scale, names):
    rel = pos - pos[:, 0:1]
    H = HUMAN_HEIGHT * scale
    return np.concatenate([rel[:, IDX[n]] / H for n in names], 1)


POSE_KP = ['head', 'lwri', 'rwri', 'lank', 'rank']


def pose_retention(human_pos, rob_pos, scale):
    A, B = _kp(human_pos, 1.0, POSE_KP), _kp(rob_pos, scale, POSE_KP)
    return {'pose_dtw': dtw(A, B), 'pose_err': float(np.linalg.norm(A - B, axis=1).mean())}


def rwrist_retention_humanoid(human_pos, rob_pos, scale):
    A, B = _kp(human_pos, 1.0, ['rwri']), _kp(rob_pos, scale, ['rwri'])
    return {'rwrist_dtw': dtw(A, B), 'rwrist_err': float(np.linalg.norm(A - B, axis=1).mean())}


def rwrist_retention_arm(human_pos, arm):
    A = _kp(human_pos, 1.0, ['rwri'])
    B = (arm.extras['tip'] - arm.extras['S0']) / (HUMAN_HEIGHT * arm.extras['k'])
    return {'rwrist_dtw': dtw(A, B), 'rwrist_err': float(np.linalg.norm(A - B, axis=1).mean())}


def energy_retained(human_euler, robot_euler):
    """Share of the human's joint-angle variance (non-root joints) that survives retargeting."""
    h = human_euler[:, 1:].reshape(len(human_euler), -1); r = robot_euler[:, 1:].reshape(len(robot_euler), -1)
    return float(r.var(0).sum() / h.var(0).sum())


# ------------------------------------------------------------------ feasibility
def foot_skate(pos, fps, scale=1.0, speed_thr=0.10):
    out = {}
    cont_all = skate_all = 0
    for s in 'lr':
        a = pos[:, IDX[s + 'ank']]
        contact = (a[:, 1] < (ANKLE_H + 0.02) * scale)
        v = np.linalg.norm(np.gradient(a[:, [0, 2]], axis=0), axis=1) * fps
        cont_all += contact.sum(); skate_all += (contact & (v > speed_thr * scale)).sum()
    return {'skate_ratio': float(skate_all / max(cont_all, 1))}


def balance(pos, scale=1.0):
    """Quasi-static test: is the CoM ground-projection inside the support polygon of grounded feet?
    Conservative: dynamic balance (ZMP) can legitimately leave the polygon, so read as 'needs an active
    balance controller', not 'falls'."""
    c = com(pos)[:, [0, 2]]
    T = len(pos); margin = np.full(T, -1.0)
    for t in range(T):
        pts = []
        for s in 'lr':
            a, toe = pos[t, IDX[s + 'ank']], pos[t, IDX[s + 'toe']]
            if min(toe[1], a[1] - ANKLE_H * scale) < 0.02 * scale:
                ax, tx = a[[0, 2]], toe[[0, 2]]
                f = tx - ax; n = np.linalg.norm(f)
                lat = np.array([-f[1], f[0]]) / n * 0.045 * scale if n > 1e-6 else np.array([0.045 * scale, 0])
                pts += [ax + lat, ax - lat, tx + lat, tx - lat]
        if len(pts) >= 3:
            try:
                eq = ConvexHull(np.array(pts)).equations
                margin[t] = float(-(eq[:, :2] @ c[t] + eq[:, 2]).max())
            except QhullError:
                pass
    H = HUMAN_HEIGHT * scale
    return {'unstable_frac': float((margin < 0).mean()), 'min_margin_cm': float(margin.min() * 100 / scale),
            'margin': margin}


def evaluate(name, pos, fps, music_beats, human_pos=None, scale=1.0, robot=None, human_euler=None, arm=None):
    kb, _ = kinematic_beats(pos, fps)
    r = {'embodiment': name, 'bas': bas(music_beats, kb, fps), 'bas_chance': chance_bas(music_beats, kb, fps),
         'n_kin_beats': int(len(kb))}
    if name == 'human':
        r.update(foot_skate(pos, fps, 1.0)); b = balance(pos, 1.0); r.update({k: v for k, v in b.items() if k != 'margin'})
        r['_margin'] = b['margin']
        return r
    if arm is not None:
        r.update(rwrist_retention_arm(human_pos, arm))
        r['reach_loss_frac'] = float((arm.extras['reach_loss'] > 0).mean())
        r['limit_frames'] = float(arm.limit_clip.any(1).mean()); r['rate_frames'] = float(arm.rate_clip.any(1).mean())
        r['tip_err_cm'] = float(np.linalg.norm(arm.extras['tip'] - arm.extras['target'], axis=1).mean() * 100)
        return r
    r.update(pose_retention(human_pos, pos, scale)); r.update(rwrist_retention_humanoid(human_pos, pos, scale))
    r['energy_retained'] = energy_retained(human_euler, robot.angles)
    r['limit_frames'] = float(robot.limit_clip.any(1).mean()); r['rate_frames'] = float(robot.rate_clip.any(1).mean())
    r.update(foot_skate(pos, fps, scale)); b = balance(pos, scale)
    r.update({k: v for k, v in b.items() if k != 'margin'}); r['_margin'] = b['margin']
    return r
