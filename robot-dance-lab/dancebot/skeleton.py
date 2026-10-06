"""19-joint kinematic skeleton, forward kinematics, ground planting, centre of mass.

Conventions: y up, +z = character forward, +x = character's LEFT. Metres, radians.
All local rotations are intrinsic 'XYZ' Euler angles (R = Rx @ Ry @ Rz).
In the arms-down rest pose, for a limb hanging along -y:
    +x rotation swings the limb BACKWARD (so arm-forward / hip-flexion are negative x,
        knee flexion is positive x)
    +z rotation swings the limb toward +x (left-arm abduction is +z, right-arm is -z)
"""
import numpy as np
from scipy.spatial.transform import Rotation as R

JOINTS = ['pelvis', 'spine', 'chest', 'neck', 'head',
          'lsho', 'lelb', 'lwri', 'rsho', 'relb', 'rwri',
          'lhip', 'lknee', 'lank', 'ltoe', 'rhip', 'rknee', 'rank', 'rtoe']
J = len(JOINTS)
IDX = {n: i for i, n in enumerate(JOINTS)}
PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 13, 0, 15, 16, 17]

# (parent-frame offsets) for a 1.72 m human, feet flat: ankle 0.07 above floor, toe on floor.
HUMAN_OFFSETS = np.array([
    [0, 0, 0],            # pelvis
    [0, .10, 0],          # spine
    [0, .20, 0],          # chest
    [0, .22, 0],          # neck
    [0, .12, 0],          # head
    [.18, .17, 0],        # lsho
    [0, -.28, 0],         # lelb
    [0, -.26, 0],         # lwri
    [-.18, .17, 0],       # rsho
    [0, -.28, 0],         # relb
    [0, -.26, 0],         # rwri
    [.09, -.05, 0],       # lhip
    [0, -.42, 0],         # lknee
    [0, -.42, 0],         # lank
    [0, -.07, .14],       # ltoe
    [-.09, -.05, 0],      # rhip
    [0, -.42, 0],         # rknee
    [0, -.42, 0],         # rank
    [0, -.07, .14],       # rtoe
], dtype=float)

THIGH, SHANK, ANKLE_H = 0.42, 0.42, 0.07
HUMAN_HEIGHT = 1.72
PELVIS_STAND_Y = 0.93

BONES = [(0, 1), (1, 2), (2, 3), (3, 4), (2, 5), (5, 6), (6, 7), (2, 8), (8, 9), (9, 10),
         (0, 11), (11, 12), (12, 13), (13, 14), (0, 15), (15, 16), (16, 17), (17, 18)]

# segment list for centre of mass: (joint a, joint b, mass fraction)
_SEGS = [('pelvis', 'spine', .12), ('spine', 'chest', .12), ('chest', 'neck', .18), ('neck', 'head', .03),
         ('head', 'head', .05)]
for s in 'lr':
    _SEGS += [(s + 'sho', s + 'elb', .028), (s + 'elb', s + 'wri', .022), (s + 'wri', s + 'wri', .008),
              (s + 'hip', s + 'knee', .10), (s + 'knee', s + 'ank', .047), (s + 'ank', s + 'toe', .015)]
SEGMENTS = [(IDX[a], IDX[b], m) for a, b, m in _SEGS]


def euler_to_mat(e):
    sh = e.shape[:-1]
    return R.from_euler('XYZ', e.reshape(-1, 3)).as_matrix().reshape(sh + (3, 3))


def mat_to_euler(m):
    sh = m.shape[:-2]
    return R.from_matrix(m.reshape(-1, 3, 3)).as_euler('XYZ').reshape(sh + (3,))


def fk(offsets, euler, root_pos):
    """euler (T,J,3), root_pos (T,3) -> world joint positions (T,J,3), global rotations (T,J,3,3)."""
    T = euler.shape[0]
    Rl = euler_to_mat(euler)
    G = np.zeros((T, J, 3, 3))
    P = np.zeros((T, J, 3))
    for j in range(J):
        p = PARENT[j]
        if p < 0:
            G[:, j] = Rl[:, j]
            P[:, j] = root_pos
        else:
            G[:, j] = G[:, p] @ Rl[:, j]
            P[:, j] = P[:, p] + np.einsum('tij,j->ti', G[:, p], offsets[j])
    return P, G


def sole_height(pos, scale=1.0):
    """Lowest sole point per frame: toe y, or ankle y minus ankle height."""
    low = np.minimum(pos[:, IDX['ltoe'], 1], pos[:, IDX['rtoe'], 1])
    low = np.minimum(low, np.minimum(pos[:, IDX['lank'], 1], pos[:, IDX['rank'], 1]) - ANKLE_H * scale)
    return low


def plant_on_ground(pos, root_pos, scale=1.0):
    """Shift each frame vertically so the lowest sole point sits on the floor."""
    dy = -sole_height(pos, scale)
    pos = pos.copy(); root_pos = root_pos.copy()
    pos[:, :, 1] += dy[:, None]; root_pos[:, 1] += dy
    return pos, root_pos


def com(pos):
    num = np.zeros((pos.shape[0], 3)); den = 0.0
    for a, b, m in SEGMENTS:
        num += m * 0.5 * (pos[:, a] + pos[:, b]); den += m
    return num / den
