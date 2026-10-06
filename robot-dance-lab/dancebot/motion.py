"""Motion container + STAND-IN music->dance generator.

IMPORTANT: this generator is a *placeholder* for EDGE / Bailando (no GPU or checkpoint access in the
build sandbox). It is beat-locked by construction, so its beat-alignment score is optimistic. The
research question lives downstream (retargeting), and any model that yields a `Motion` (see
`edge_adapter.py`) can replace this file without touching the rest of the pipeline.
"""
from dataclasses import dataclass, field
import numpy as np
from scipy.spatial.transform import Rotation as R
from .skeleton import (J, IDX, HUMAN_OFFSETS, THIGH, SHANK, ANKLE_H, PELVIS_STAND_Y,
                       euler_to_mat, mat_to_euler, fk, plant_on_ground)

FPS = 30


@dataclass
class Motion:
    euler: np.ndarray            # (T,J,3) local Euler angles (pelvis entry = global orientation)
    root: np.ndarray             # (T,3) pelvis world position
    fps: int = FPS
    offsets: np.ndarray = field(default_factory=lambda: HUMAN_OFFSETS.copy())
    leg_label: list = field(default_factory=list)
    arm_label: list = field(default_factory=list)
    meta: dict = field(default_factory=dict)

    @property
    def T(self):
        return self.euler.shape[0]

    def positions(self):
        P, _ = fk(self.offsets, self.euler, self.root)
        P, root = plant_on_ground(P, self.root)
        return P


# ----------------------------------------------------------------------------- helpers
def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def bump(s):
    """sin^2 pulse on s in [0,1]; 0 elsewhere. zero value AND slope at both ends."""
    return np.where((s >= 0) & (s <= 1), np.sin(np.pi * np.clip(s, 0, 1)) ** 2, 0.0)


def shift_prof(s):
    """weight shift: complete within the first 30% of the beat, held, released in the last 30%"""
    return np.where((s >= 0) & (s <= 1), smoothstep(s / 0.3) * smoothstep((1 - s) / 0.3), 0.0)


def lift_prof(s):
    """foot lift happens in the middle 60% of the beat, AFTER the weight has been shifted"""
    return bump((s - 0.2) / 0.6)


def beat_clock(n_frames, fps, beats):
    """Continuous beat counter Phi(t): integer at each (detected) beat, linear in between."""
    beats = np.asarray(beats, float)
    per = np.median(np.diff(beats))
    pre = int(np.ceil(beats[0] / per)) + 1
    ext = np.concatenate([beats[0] - per * np.arange(pre, 0, -1), beats, beats[-1] + per * np.arange(1, 4)])
    t = np.arange(n_frames) / fps
    return np.interp(t, ext, np.arange(len(ext)) - pre)


def smooth_noise(n, fps, amp, rng, freqs=(0.13, 0.31, 0.47)):
    t = np.arange(n) / fps
    return amp * sum(np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) for f in freqs) / len(freqs)


def leg_ik(hip, target, pole):
    """Analytic two-bone IK. hip,target,pole: (T,3). Returns thigh dir d, shank dir s, bend plane axis u, knee flexion."""
    a = target - hip
    D = np.linalg.norm(a, axis=1)
    Dc = np.minimum(D, (THIGH + SHANK) * 0.9995)
    ahat = a / D[:, None]
    target_c = hip + ahat * Dc[:, None]
    pp = pole - (pole * ahat).sum(1, keepdims=True) * ahat
    pp /= np.linalg.norm(pp, axis=1, keepdims=True)
    alpha = np.arccos(np.clip(Dc / (2 * THIGH), -1, 1))
    ca, sa = np.cos(alpha)[:, None], np.sin(alpha)[:, None]
    d = ca * ahat + sa * pp
    knee = hip + THIGH * d
    s = target_c - knee; s /= np.linalg.norm(s, axis=1, keepdims=True)
    u = ca * pp - sa * ahat
    return d, s, u, 2 * alpha, target_c



# ----------------------------------------------------------------------------- Latin footwork (salsa / cumbia / bachata)
# NOTE: these are SIMPLIFIED, hand-authored approximations of the basic steps, not reviewed by dance teachers.
LATIN_LEG = ('salsa_basic', 'salsa_side', 'cumbia_basic', 'bachata_basic')
LATIN_ARM = ('salsa_arms', 'cumbia_arms', 'bachata_arms')
DEFAULT_PRM = {'step': 1.0, 'lift': 1.0, 'hip': 1.0, 'arm': 1.0}
_W8 = [(0, 1), (1, 0), (2, 1), (3, 1), (4, 0), (5, 1), (6, 0), (7, 0)]      # weight on LEFT foot after each count (1 = left)


def foot_track(tau, keys, period, dur_max=0.6):
    """Stepping foot, periodic. keys: [(arrive, dx, dz, lift)] sorted by arrive. The foot sits where it last arrived and, before each
    arrival, moves (smoothstep) and lifts (sin^2 bump) over min(dur_max, gap) beats. Returns dx, dz, lift arrays."""
    n = len(keys); arr = np.array([k[0] for k in keys], float)
    idx = np.searchsorted(arr, tau, side='right') - 1
    idx = np.where(idx < 0, n - 1, idx)
    X = np.array([k[1] for k in keys], float)[idx]; Z = np.array([k[2] for k in keys], float)[idx]; Lf = np.zeros_like(tau)
    for i in range(n):
        a, kx, kz, kl = keys[i]
        pa, px, pz, _ = keys[i - 1]
        pa_eff = pa - period if i == 0 else pa
        dur = min(dur_max, a - pa_eff); d = a - dur
        for off in (0.0, float(period)):
            m = (tau >= d + off) & (tau < a + off)
            if not np.any(m):
                continue
            u = (tau - (d + off)) / dur; sm = smoothstep(u)
            X = np.where(m, px + (kx - px) * sm, X); Z = np.where(m, pz + (kz - pz) * sm, Z); Lf = np.where(m, kl * bump(u), Lf)
    return X, Z, Lf


def weight_track(tau, keys, period, dur=0.2):
    """Weight on the left foot (1) or right (0). The shift happens just AFTER the stepping foot lands: [arrive, arrive+dur]."""
    n = len(keys); arr = np.array([k[0] for k in keys], float)
    idx = np.searchsorted(arr, tau, side='right') - 1
    idx = np.where(idx < 0, n - 1, idx)
    Wv = np.array([k[1] for k in keys], float)[idx]
    for i in range(n):
        a, wv = keys[i]; pa, pw = keys[i - 1]
        for off in (0.0, -float(period)):
            m = (tau >= a + off) & (tau < a + dur + off)
            if np.any(m):
                Wv = np.where(m, pw + (wv - pw) * smoothstep((tau - (a + off)) / dur), Wv)
    return Wv


def latin_leg(C, lm, Phi, p, w, prm):
    s, lf, hp = prm['step'], prm['lift'], prm['hip']
    period, Wk = 8.0, _W8
    if lm == 'salsa_basic':
        L = [(0, 0, .20 * s, .06 * lf), (2, 0, 0, .06 * lf)]; R = [(4, 0, -.20 * s, .06 * lf), (6, 0, 0, .06 * lf)]
    elif lm == 'salsa_side':
        L = [(0, .18 * s, 0, .06 * lf), (2, 0, 0, .06 * lf)]; R = [(4, -.18 * s, 0, .06 * lf), (6, 0, 0, .06 * lf)]
    elif lm == 'bachata_basic':
        st = .16 * s
        L = [(0, st, 0, .04 * lf), (2, 2 * st, 0, .04 * lf), (5, st, 0, .04 * lf), (7, 0, 0, .035 * lf)]
        R = [(1, st, 0, .04 * lf), (3, 2 * st, 0, .035 * lf), (4, st, 0, .04 * lf), (6, 0, 0, .04 * lf)]
    else:                                   # cumbia_basic: side-close with a foot DRAG (almost no lift), 4-count cycle
        period = 4.0; s1 = .12 * s
        L = [(0, s1, 0, .02 * lf), (3, 0, 0, 0.0)]; R = [(1, s1, 0, 0.0), (2, 0, 0, .02 * lf)]; Wk = [(0, 1), (1, 1), (2, 0), (3, 0)]
    tau = np.mod(Phi - 8 * p, period)
    Lx, Lz, Ll = foot_track(tau, L, period); Rx, Rz, Rl = foot_track(tau, R, period); wl = weight_track(tau, Wk, period)
    fl = np.stack([.07 + Lx, Lz]); fr = np.stack([-.07 + Rx, Rz])
    pel = .10 * (fl + fr) / 2 + .90 * (wl * fl + (1 - wl) * fr)
    C['Lfx'] += w * Lx; C['Lfz'] += w * Lz; C['Lfy'] += w * Ll; C['Rfx'] += w * Rx; C['Rfz'] += w * Rz; C['Rfy'] += w * Rl
    C['wide'] += w * -0.05; C['pdx'] += w * pel[0]; C['pdz'] += w * pel[1]
    sway = 2 * wl - 1
    C['proll'] += w * hp * 0.07 * sway; C['pyaw'] += w * hp * 0.10 * sway
    C['pdy'] += w * (-0.02 * hp) * (0.5 + 0.5 * np.cos(2 * np.pi * Phi))
    if lm == 'cumbia_basic':
        C['pdy'] += w * -0.03; C['pyaw'] += w * hp * 0.06 * np.sin(np.pi * Phi)
    if lm == 'bachata_basic':
        h4 = bump((tau - 2.5) / 1.0); h8 = bump((tau - 6.5) / 1.0)
        C['pdy'] += w * hp * 0.025 * (h4 + h8); C['proll'] += w * hp * 0.09 * (h4 - h8)

# ----------------------------------------------------------------------------- dance vocabulary
GENRES = {
    # name: (energy, leg moves, arm moves)
    'groove': (0.45, ['sway', 'step_touch', 'bounce'], ['arm_wave', 'arm_pump', 'torso_twist']),
    'house':  (0.75, ['bounce', 'step_touch', 'squat_pulse'], ['arm_pump', 'arms_up', 'torso_twist']),
    'pop':    (1.00, ['kick', 'bounce', 'step_touch', 'squat_pulse'], ['arms_up', 'arm_pump', 'torso_twist']),
}


def generate(beats, duration, genre, fps=FPS, seed=0, sequence=None, jitter=0.05):
    """Beat-locked stand-in dance. Returns a Motion.
    sequence: optional {phrase_index: (leg_move, arm_move, energy)} to choreograph explicitly (phrase 0 starts on the
    first detected beat; missing phrases idle). Used by the interactive game and by the JS<->Python parity test."""
    rng = np.random.default_rng(seed)
    T = int(duration * fps)
    e, leg_pool, arm_pool = GENRES[genre]
    Phi = beat_clock(T, fps, beats) + smooth_noise(T, fps, jitter, rng)     # humanlike timing wobble
    phrase_len = 8
    n_phr = int(np.ceil(Phi.max() / phrase_len)) + 2
    first = int(np.floor(Phi.min() / phrase_len))

    # choose moves per phrase (never the same leg move twice in a row)
    leg_seq, arm_seq, e_seq, prm_seq, last = {}, {}, {}, {}, None
    for p in range(first, first + n_phr):
        if sequence is None:
            opts = [m for m in leg_pool if m != last]
            leg_seq[p] = last = rng.choice(opts)
            arm_seq[p] = rng.choice(arm_pool)
            e_seq[p] = e
        else:
            tup = sequence.get(p, ('idle', 'none', 0.5)); leg_seq[p], arm_seq[p], e_seq[p] = tup[0], tup[1], tup[2]
            prm_seq[p] = dict(DEFAULT_PRM, **(tup[3] if len(tup) > 3 else {}))

    C = {k: np.zeros(T) for k in ['pdx', 'pdy', 'pdz', 'proll', 'pyaw', 'ppitch', 'Lfx', 'Lfy', 'Lfz', 'Rfx', 'Rfy', 'Rfz',
                                  'Lfree', 'Rfree', 'wide']}
    U = {k: np.zeros((T, 3)) for k in ['spine', 'chest', 'neck', 'head', 'lsho', 'lelb', 'lwri', 'rsho', 'relb', 'rwri']}

    leg_label, arm_label = [], []
    for i in range(T):
        p = int(np.floor(Phi[i] / phrase_len)); leg_label.append(str(leg_seq[p])); arm_label.append(str(arm_seq[p]))

    def window(p):
        return smoothstep((Phi - phrase_len * p) / 0.75) * smoothstep((phrase_len * (p + 1) - Phi) / 0.75)

    # base idle: gentle bounce + arms slightly away from the body
    D0 = 0.015
    C['pdy'] += -D0 * (0.5 + 0.5 * np.cos(2 * np.pi * Phi))
    U['lsho'][:, 2] += 0.12; U['rsho'][:, 2] -= 0.12
    U['lelb'][:, 0] += -0.15; U['relb'][:, 0] += -0.15
    U['neck'][:, 0] += 0.04 * np.cos(2 * np.pi * Phi)

    for p in range(first, first + n_phr):
        w = window(p)
        if not np.any(w > 0):
            continue
        lm, am = leg_seq[p], arm_seq[p]
        e = e_seq[p]; prm = prm_seq.get(p, DEFAULT_PRM)
        w2 = smoothstep((Phi - 8 * p + .375) / .75) - smoothstep((Phi - 8 * (p + 1) + .375) / .75)   # crossfades sum to 1 (no dip between repeats)
        s2 = np.mod(Phi, 2.0)
        c1 = np.cos(2 * np.pi * Phi)
        if lm == 'bounce':
            C['pdy'] += w * -(0.03 + 0.05 * e) * (0.5 + 0.5 * c1)
            U['neck'][:, 0] += w * 0.12 * c1
        elif lm == 'sway':
            C['pdx'] += w * 0.07 * np.sin(np.pi * Phi)
            C['proll'] += w * 0.07 * np.sin(np.pi * Phi)
            C['pyaw'] += w * 0.12 * np.sin(np.pi * Phi + 0.8)
            C['pdy'] += w * -0.03 * (0.5 + 0.5 * c1)
        elif lm == 'step_touch':
            lift = 0.09 + 0.05 * e
            C['Lfy'] += w * lift * lift_prof(s2); C['Lfx'] += w * 0.16 * lift_prof(s2)
            C['Rfy'] += w * lift * lift_prof(s2 - 1); C['Rfx'] += w * -0.16 * lift_prof(s2 - 1)
            C['pdx'] += w * (-0.12 * shift_prof(s2) + 0.12 * shift_prof(s2 - 1))
            C['pdy'] += w * -0.03 * (0.5 + 0.5 * c1)
        elif lm == 'squat_pulse':
            C['pdy'] += w * -(0.14 + 0.16 * e) * (0.5 + 0.5 * np.cos(np.pi * Phi))
            C['wide'] += w * 0.10
            C['ppitch'] += w * 0.10 * (0.5 + 0.5 * np.cos(np.pi * Phi))
        elif lm == 'kick':
            kh, kf = 0.50 + 0.12 * e, 0.42 + 0.12 * e
            sl = np.mod(Phi + 1, 4.0)                               # L kick on beat 2 of each bar, R on beat 4
            C['Lfy'] += w * kh * lift_prof(sl); C['Lfz'] += w * kf * lift_prof(sl)
            sr = np.mod(Phi - 1, 4.0)
            C['Rfy'] += w * kh * lift_prof(sr); C['Rfz'] += w * kf * lift_prof(sr)
            C['Lfree'] += w * lift_prof(sl); C['Rfree'] += w * lift_prof(sr)
            C['pdx'] += w * (-0.13 * shift_prof(sl) + 0.13 * shift_prof(sr))     # weight shift onto the standing leg
            C['ppitch'] += w * -0.05 * (lift_prof(sl) + lift_prof(sr))
            C['pdy'] += w * -0.025 * (0.5 + 0.5 * c1)
        if lm in LATIN_LEG:
            latin_leg(C, lm, Phi, p, w2, prm)
        # ---- arms / torso
        if am == 'arm_pump':
            a = 0.5 + 0.5 * np.cos(np.pi * Phi)       # L high on even beats
            b = 0.5 + 0.5 * np.cos(np.pi * Phi + np.pi)
            amp = 1.1 + 0.8 * e
            U['lsho'][:, 0] += w * -amp * a; U['rsho'][:, 0] += w * -amp * b
            U['lelb'][:, 0] += w * -1.3 * a; U['relb'][:, 0] += w * -1.3 * b
        elif am == 'arm_wave':
            ph = np.pi * Phi
            U['lsho'][:, 2] += w * (0.9 + 0.5 * np.sin(ph)); U['rsho'][:, 2] -= w * (0.9 + 0.5 * np.sin(ph + np.pi))
            U['lelb'][:, 0] += w * -0.5 * (0.5 + 0.5 * np.sin(ph + 1)); U['relb'][:, 0] += w * -0.5 * (0.5 + 0.5 * np.sin(ph + 1 + np.pi))
            U['lwri'][:, 2] += w * 0.5 * np.sin(2 * ph); U['rwri'][:, 2] += w * 0.5 * np.sin(2 * ph + np.pi)
        elif am == 'arms_up':
            top = 2.3 + 0.35 * e
            pulse = 0.25 * (0.5 + 0.5 * c1)
            U['lsho'][:, 2] += w * (top + pulse); U['rsho'][:, 2] -= w * (top + pulse)
            U['lelb'][:, 0] += w * -0.35 * (0.5 - 0.5 * c1); U['relb'][:, 0] += w * -0.35 * (0.5 - 0.5 * c1)
            U['chest'][:, 0] += w * -0.10 * (0.5 + 0.5 * c1)
        elif am == 'torso_twist':
            tw = np.sin(np.pi * Phi)
            U['spine'][:, 1] += w * 0.35 * tw; U['chest'][:, 1] += w * (0.30 + 0.25 * e) * tw
            U['chest'][:, 2] += w * 0.14 * np.cos(np.pi * Phi)
            U['lsho'][:, 2] += w * 0.5; U['rsho'][:, 2] -= w * 0.5
            U['lsho'][:, 1] += w * 0.5 * tw; U['rsho'][:, 1] += w * 0.5 * tw
            U['lelb'][:, 0] += w * -0.8; U['relb'][:, 0] += w * -0.8
        elif am in LATIN_ARM:
            a_ = prm['arm']; sw = np.sin(np.pi * Phi)
            if am == 'salsa_arms':
                U['lsho'][:, 0] += w2 * a_ * (-0.5 + 0.10 * sw); U['lsho'][:, 2] += w2 * a_ * 0.25; U['lelb'][:, 0] += w2 * a_ * -1.3
                U['rsho'][:, 0] += w2 * a_ * (-0.5 - 0.10 * sw); U['rsho'][:, 2] -= w2 * a_ * 0.25; U['relb'][:, 0] += w2 * a_ * -1.3
            elif am == 'cumbia_arms':
                U['lsho'][:, 2] += w2 * a_ * (0.45 + 0.25 * sw); U['rsho'][:, 2] -= w2 * a_ * (0.45 - 0.25 * sw)
                U['lelb'][:, 0] += w2 * a_ * -0.5; U['relb'][:, 0] += w2 * a_ * -0.5
            else:
                U['lsho'][:, 2] += w2 * a_ * 0.7; U['lsho'][:, 0] += w2 * a_ * (-0.3 + 0.08 * sw); U['lelb'][:, 0] += w2 * a_ * -1.2
                U['rsho'][:, 0] += w2 * a_ * (-0.6 - 0.08 * sw); U['rsho'][:, 2] -= w2 * a_ * 0.15; U['relb'][:, 0] += w2 * a_ * -1.4
        elif am == 'head_bang':
            nod = 0.5 + 0.5 * c1
            U['neck'][:, 0] += w * (0.30 + 0.35 * e) * nod; U['head'][:, 0] += w * 0.25 * nod
            U['chest'][:, 0] += w * 0.12 * nod
        elif am == 'lean_back':
            hold = 0.6 + 0.4 * np.cos(np.pi * Phi)
            U['spine'][:, 0] += w * -(0.20 + 0.15 * e) * hold; U['chest'][:, 0] += w * -(0.30 + 0.25 * e) * hold
            U['lsho'][:, 2] += w * 0.4; U['rsho'][:, 2] -= w * 0.4

    # ------------------------------------------------------------------ assemble pelvis + legs (IK)
    root = np.zeros((T, 3))
    root[:, 0] = C['pdx']; root[:, 2] = C['pdz']; root[:, 1] = PELVIS_STAND_Y + C['pdy']
    euler = np.zeros((T, J, 3))
    euler[:, 0] = np.stack([C['ppitch'], C['pyaw'], C['proll']], 1)
    Rp = euler_to_mat(euler[:, 0])
    foot_yaw = {'l': 0.14, 'r': -0.14}
    for side, sx in (('l', 1.0), ('r', -1.0)):
        hip_off = HUMAN_OFFSETS[IDX[side + 'hip']]
        hip_w = root + np.einsum('tij,j->ti', Rp, hip_off)
        S = 'L' if side == 'l' else 'R'
        wide = C['wide']
        tgt = np.stack([sx * (0.12 + wide) + C[S + 'fx'], ANKLE_H + C[S + 'fy'], C[S + 'fz']], 1)
        yaw = foot_yaw[side]
        Ry = R.from_euler('y', yaw).as_matrix()
        pole = np.tile(Ry @ np.array([0, 0, 1.0]), (T, 1))
        d, s, u, flex, _ = leg_ik(hip_w, tgt, pole)
        y_ax = -d; z_ax = u; x_ax = np.cross(y_ax, z_ax)
        Gt = np.stack([x_ax, y_ax, z_ax], axis=2)                           # columns = axes
        euler[:, IDX[side + 'hip']] = mat_to_euler(np.einsum('tji,tjk->tik', Rp, Gt))
        euler[:, IDX[side + 'knee']] = np.stack([flex, np.zeros(T), np.zeros(T)], 1)
        Rk = R.from_rotvec(np.stack([flex, np.zeros(T), np.zeros(T)], 1)).as_matrix()
        Gs = Gt @ Rk
        Gflat = np.tile(Ry, (T, 1, 1))
        rel = np.einsum('tji,tjk->tik', Gs, Gflat)
        rv = R.from_matrix(rel).as_rotvec() * (1 - np.clip(C[S + 'free'], 0, 1))[:, None]
        euler[:, IDX[side + 'ank']] = mat_to_euler(R.from_rotvec(rv).as_matrix())
    # ------------------------------------------------------------------ upper body
    for k, v in U.items():
        euler[:, IDX[k]] = v
    euler[:, IDX['spine'], 1] += 0.0
    return Motion(euler=euler, root=root, fps=fps, leg_label=leg_label, arm_label=arm_label,
                  meta={'genre': genre, 'generator': 'stand-in (beat-locked procedural)'})
