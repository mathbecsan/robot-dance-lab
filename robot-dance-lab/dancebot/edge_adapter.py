"""Plug real model output into the pipeline.

EDGE (Stanford-TML/EDGE, `test.py --save_motions`) writes AIST++-style pickles: 'smpl_poses' (T,72) axis-angle for the
24 SMPL joints, 'smpl_trans' (T,3), 'smpl_scaling'. At 30 fps. Bailando/FACT give the same SMPL layout.
`from_smpl` converts that into this project's 19-joint `Motion`, so everything downstream
(retargeting, metrics, rendering, viewer) works unchanged.

Verified here by an exact round-trip (tests/test_core.py). NOT yet verified against genuine EDGE output:
when you first load a real file, eyeball it with `render` and, if the character is rotated, set `root_fix`.
"""
import pickle
import numpy as np
from scipy.spatial.transform import Rotation as R
from .skeleton import J, IDX, HUMAN_OFFSETS, euler_to_mat, mat_to_euler
from .motion import Motion

QL = R.from_euler('z', np.pi / 2).as_matrix()      # SMPL T-pose left arm (+x)  -> arms-down
QR = R.from_euler('z', -np.pi / 2).as_matrix()


def _rm(aa):
    return R.from_rotvec(aa.reshape(-1, 3)).as_matrix().reshape(aa.shape[:-1] + (3, 3))


def _mm(a, b):
    return np.einsum('...ij,...jk->...ik', a, b)


def _T(a):
    return np.swapaxes(a, -1, -2)


def from_smpl(poses, trans, fps=30, trans_scale=1.0, root_fix=None):
    T = len(poses)
    Rs = _rm(np.asarray(poses, float).reshape(T, 24, 3))
    out = np.zeros((T, J, 3, 3)); eye = np.tile(np.eye(3), (T, 1, 1))
    out[:, IDX['pelvis']] = Rs[:, 0] if root_fix is None else _mm(root_fix, Rs[:, 0])
    for s, h, k, a in (('l', 1, 4, 7), ('r', 2, 5, 8)):
        out[:, IDX[s + 'hip']] = Rs[:, h]; out[:, IDX[s + 'knee']] = Rs[:, k]; out[:, IDX[s + 'ank']] = Rs[:, a]
        out[:, IDX[s + 'toe']] = eye
    out[:, IDX['spine']] = Rs[:, 3]
    out[:, IDX['chest']] = _mm(Rs[:, 6], Rs[:, 9])
    out[:, IDX['neck']] = Rs[:, 12]; out[:, IDX['head']] = Rs[:, 15]
    for s, col, sh, el, wr, Q in (('l', 13, 16, 18, 20, QL), ('r', 14, 17, 19, 21, QR)):
        out[:, IDX[s + 'sho']] = _mm(_mm(Rs[:, col], Rs[:, sh]), Q)
        out[:, IDX[s + 'elb']] = _mm(_mm(_T(Q), Rs[:, el]), Q)
        out[:, IDX[s + 'wri']] = _mm(_mm(_T(Q), Rs[:, wr]), Q)
    trans = np.asarray(trans, float) * trans_scale
    root = np.stack([trans[:, 0] - trans[0, 0], np.full(T, 0.93), trans[:, 2] - trans[0, 2]], 1)   # height re-planted later
    return Motion(euler=mat_to_euler(out), root=root, fps=fps, offsets=HUMAN_OFFSETS.copy(),
                  meta={'generator': 'smpl-import'})


def to_smpl(mot):
    """Inverse of from_smpl (used only for the round-trip test and for exporting stand-in dances in SMPL layout)."""
    Rm = euler_to_mat(mot.euler); T = mot.T
    Rs = np.tile(np.eye(3), (T, 24, 1, 1))
    Rs[:, 0] = Rm[:, IDX['pelvis']]
    for s, h, k, a in (('l', 1, 4, 7), ('r', 2, 5, 8)):
        Rs[:, h] = Rm[:, IDX[s + 'hip']]; Rs[:, k] = Rm[:, IDX[s + 'knee']]; Rs[:, a] = Rm[:, IDX[s + 'ank']]
    Rs[:, 3] = Rm[:, IDX['spine']]; Rs[:, 6] = Rm[:, IDX['chest']]
    Rs[:, 12] = Rm[:, IDX['neck']]; Rs[:, 15] = Rm[:, IDX['head']]
    for s, sh, el, wr, Q in (('l', 16, 18, 20, QL), ('r', 17, 19, 21, QR)):
        Rs[:, sh] = _mm(Rm[:, IDX[s + 'sho']], _T(Q))
        Rs[:, el] = _mm(_mm(Q, Rm[:, IDX[s + 'elb']]), _T(Q))
        Rs[:, wr] = _mm(_mm(Q, Rm[:, IDX[s + 'wri']]), _T(Q))
    aa = R.from_matrix(Rs.reshape(-1, 3, 3)).as_rotvec().reshape(T, 72)
    return aa, mot.root.copy()


def load_edge_pkl(path, **kw):
    with open(path, 'rb') as f:
        d = pickle.load(f)
    poses = d['smpl_poses']; trans = d['smpl_trans']
    return from_smpl(poses.reshape(len(poses), -1), trans, **kw)
