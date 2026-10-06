"""Retargeting human dance to robot embodiments (kinematic, 'Tier 1').

Humanoids: joint-space retargeting  ->  lock unavailable DoFs -> clamp to joint ranges -> rate-limit ->
           scale proportions -> re-plant on the floor.
Arm:       task-space rules (right wrist -> end effector, closed-form 2-link IK, joint limits, rate limit).

JOINT LIMITS are *approximations inspired by* Unitree G1 (29-DoF) published ranges, expressed in this
project's sign convention. Before reporting numbers, replace them with values read from the robot's
MJCF/URDF (mujoco_menagerie/unitree_g1) and swap joint-space copy for GMR-style keypoint IK.
"""
from dataclasses import dataclass, field
import numpy as np
from .skeleton import J, IDX, HUMAN_OFFSETS, ANKLE_H, fk, plant_on_ground
from .motion import Motion

INF = np.inf


@dataclass
class Embodiment:
    name: str
    scale: float
    lo: np.ndarray
    hi: np.ndarray
    mask: np.ndarray              # (J,3) bool: DoF present
    vmax: float = 8.0             # rad/s joint speed limit
    offsets: np.ndarray = None

    def __post_init__(self):
        self.offsets = HUMAN_OFFSETS * self.scale


def _blank():
    return np.full((J, 3), -INF), np.full((J, 3), INF), np.zeros((J, 3), bool)


def _set(lo, hi, mask, joint, axis, a, b):
    i = IDX[joint]; lo[i, axis] = a; hi[i, axis] = b; mask[i, axis] = True


def humanoid_full(scale=0.77, vmax=8.0):
    """G1-inspired: 3-DoF waist, no neck, 3-DoF shoulders/wrists, 1-DoF elbow, 3-DoF hips, 2-DoF ankle."""
    lo, hi, m = _blank()
    for j, ax, a, b in [('spine', 0, -.26, .26), ('spine', 1, -1.3, 1.3), ('spine', 2, -.26, .26),
                        ('chest', 0, -.26, .26), ('chest', 1, -1.3, 1.3), ('chest', 2, -.26, .26)]:
        _set(lo, hi, m, j, ax, a, b)
    for s, sg in (('l', 1), ('r', -1)):
        _set(lo, hi, m, s + 'sho', 0, -2.67, 3.09)
        _set(lo, hi, m, s + 'sho', 1, -2.6, 2.6)
        _set(lo, hi, m, s + 'sho', 2, *(( -1.59, 2.25) if sg == 1 else (-2.25, 1.59)))
        _set(lo, hi, m, s + 'elb', 0, -2.09, 1.05)
        for ax in range(3): _set(lo, hi, m, s + 'wri', ax, -1.6, 1.6)
        _set(lo, hi, m, s + 'hip', 0, -2.88, 2.53)
        _set(lo, hi, m, s + 'hip', 1, -2.76, 2.76)
        _set(lo, hi, m, s + 'hip', 2, *((-.52, 2.97) if sg == 1 else (-2.97, .52)))
        _set(lo, hi, m, s + 'knee', 0, -0.087, 2.88)
        _set(lo, hi, m, s + 'ank', 0, -0.87, 0.52)
        _set(lo, hi, m, s + 'ank', 2, -0.26, 0.26)
    m[0, :] = True; lo[0, :] = -INF; hi[0, :] = INF        # floating base: free
    return Embodiment('humanoid', scale, lo, hi, m, vmax)


def humanoid_reduced(scale=0.77, vmax=8.0):
    """Cheap kid-size humanoid: rigid torso & head, 2-DoF shoulders, 1-DoF elbow, no wrists, 2-DoF ankle->1."""
    lo, hi, m = _blank()
    for s, sg in (('l', 1), ('r', -1)):
        _set(lo, hi, m, s + 'sho', 0, -2.67, 3.09)
        _set(lo, hi, m, s + 'sho', 2, *((-1.59, 2.25) if sg == 1 else (-2.25, 1.59)))
        _set(lo, hi, m, s + 'elb', 0, -2.09, 1.05)
        _set(lo, hi, m, s + 'hip', 0, -2.88, 2.53)
        _set(lo, hi, m, s + 'hip', 1, -1.0, 1.0)
        _set(lo, hi, m, s + 'hip', 2, *((-.52, 1.2) if sg == 1 else (-1.2, .52)))
        _set(lo, hi, m, s + 'knee', 0, -0.087, 2.6)
        _set(lo, hi, m, s + 'ank', 0, -0.87, 0.52)
    m[0, :] = True; lo[0, :] = -INF; hi[0, :] = INF
    return Embodiment('reduced', scale, lo, hi, m, vmax)


@dataclass
class RobotMotion:
    name: str
    pos: np.ndarray               # (T,Jr,3) world joint positions for drawing/metrics
    bones: list
    angles: np.ndarray            # (T,Jr,3) or (T,nq)
    limit_clip: np.ndarray        # (T,Jr) bool: a range limit or locked DoF removed motion
    rate_clip: np.ndarray         # (T,Jr) bool: speed limit bit
    scale: float
    fps: int
    kind: str                     # 'humanoid' | 'arm'
    extras: dict = field(default_factory=dict)


def retarget_humanoid(mot: Motion, emb: Embodiment) -> RobotMotion:
    dt = 1.0 / mot.fps
    human = mot.euler.copy()
    e = human.copy()
    e[:, ~emb.mask] = 0.0                                        # locked DoFs
    FLAG = 0.10                                                   # rad (~6 deg): smaller losses are imperceptible
    locked_removed = np.abs(human - e) > FLAG
    clipped = np.clip(e, emb.lo, emb.hi)                          # range limits (root unconstrained)
    range_removed = np.abs(clipped - e) > FLAG
    out = clipped.copy()
    rate_flag = np.zeros(out.shape, bool)
    step = emb.vmax * dt
    if np.isfinite(step):
        for t in range(1, mot.T):
            d = out[t] - out[t - 1]
            dc = np.clip(d, -step, step)
            dc[0] = d[0]                                          # root orientation not rate-limited
            rate_flag[t] = np.abs(dc - d) > 1e-6
            out[t] = out[t - 1] + dc
    root = mot.root * emb.scale
    P, _ = fk(emb.offsets, out, root)
    P, root = plant_on_ground(P, root, emb.scale)
    lim = (locked_removed | range_removed)
    lim[:, 0] = False
    lim_j = lim.any(axis=2)
    rate_j = rate_flag.any(axis=2); rate_j[:, 0] = False
    return RobotMotion(emb.name, P, __import__('dancebot.skeleton', fromlist=['BONES']).BONES, out, lim_j, rate_j,
                       emb.scale, mot.fps, 'humanoid',
                       extras={'human_euler': human, 'locked_removed': locked_removed, 'range_removed': range_removed,
                               'robot_euler': out, 'mask': emb.mask})


# ------------------------------------------------------------------------------------------ arm
ARM = dict(base=(0.0, 0.0, 0.0), S0=(0.0, 1.0, 0.0), L1=0.55, L2=0.60, k=1.0,
           q1=(-2.9, 2.9), q2=(-1.6, 2.4), q3=(0.0, 2.6), vmax=8.0)


def retarget_arm(mot: Motion, human_pos: np.ndarray, vmax=8.0) -> RobotMotion:
    """Mapping rules (the independent variable of the non-humanoid condition):
        R1  target = S0 + k * (human right wrist - human pelvis)   [k = 1.0, arm shoulder at 1.0 m on a pedestal]
        R2  base yaw = atan2(x, z)   (arm turns to face the target)
        R3  shoulder/elbow from closed-form 2-link IK in the vertical plane, elbow-up
        R4  clamp to joint ranges, rate-limit, then recompute the tip by forward kinematics
    Everything else (legs, torso, head, left arm, pelvis bounce) has no counterpart and is discarded.
    """
    S0 = np.array(ARM['S0']); L1, L2, k = ARM['L1'], ARM['L2'], ARM['k']
    w = human_pos[:, IDX['rwri']] - human_pos[:, 0]
    # human_pos is planted: pelvis y already includes squats, so wrist-pelvis is body-relative (R1)
    tgt = S0 + k * w
    rel = tgt - S0
    r = np.hypot(rel[:, 0], rel[:, 2]); h = rel[:, 1]
    q1 = np.arctan2(rel[:, 0], rel[:, 2])
    D = np.hypot(r, h); Dc = np.clip(D, 0.05, (L1 + L2) * 0.999)
    reach_loss = np.maximum(D - (L1 + L2), 0)
    cphi = np.clip((L1 ** 2 + L2 ** 2 - Dc ** 2) / (2 * L1 * L2), -1, 1)
    q3 = np.pi - np.arccos(cphi)
    beta = np.arccos(np.clip((L1 ** 2 + Dc ** 2 - L2 ** 2) / (2 * L1 * Dc), -1, 1))
    q2 = np.arctan2(r, h) - beta
    Q_ideal = np.stack([q1, q2, q3], 1)
    lo = np.array([ARM['q1'][0], ARM['q2'][0], ARM['q3'][0]]); hi = np.array([ARM['q1'][1], ARM['q2'][1], ARM['q3'][1]])
    Q = np.clip(Q_ideal, lo, hi)
    limit_hit = np.abs(Q - Q_ideal) > 0.10
    step = vmax / mot.fps
    rate_hit = np.zeros_like(limit_hit)
    for t in range(1, len(Q)):
        d = Q[t] - Q[t - 1]; dc = np.clip(d, -step, step)
        rate_hit[t] = np.abs(dc - d) > 1e-6; Q[t] = Q[t - 1] + dc
    q1, q2, q3 = Q.T
    s1, c1 = np.sin(q1), np.cos(q1)
    elb_r = L1 * np.sin(q2); elb_h = L1 * np.cos(q2)
    tip_r = elb_r + L2 * np.sin(q2 + q3); tip_h = elb_h + L2 * np.cos(q2 + q3)
    def lift(rr, hh): return np.stack([rr * s1, S0[1] + hh, rr * c1], 1)
    base = np.tile(ARM['base'], (len(Q), 1)); shoulder = np.tile(S0, (len(Q), 1))
    elbow = lift(elb_r, elb_h); tip = lift(tip_r, tip_h)
    pos = np.stack([base, shoulder, elbow, tip], 1)
    return RobotMotion('arm', pos, [(0, 1), (1, 2), (2, 3)], Q, limit_hit, rate_hit, 1.0, mot.fps, 'arm',
                       extras={'target': tgt, 'reach_loss': reach_loss, 'tip': tip, 'k': k, 'S0': S0,
                               'human_wrist_rel': w})
