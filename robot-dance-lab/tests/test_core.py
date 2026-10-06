import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
from dancebot.skeleton import *
from dancebot.motion import generate, leg_ik, Motion
from dancebot.retarget import Embodiment, humanoid_full, retarget_humanoid, retarget_arm, ARM
from dancebot.edge_adapter import from_smpl, to_smpl
from dancebot import metrics as M
from dancebot.audio import detect_beats

BEATS = np.arange(0.3, 16, 0.5)


def _motion(genre='pop', seed=3):
    return generate(BEATS, 16.0, genre, seed=seed)


def test_rest_pose():
    P, _ = fk(HUMAN_OFFSETS, np.zeros((1, J, 3)), np.array([[0, .96, 0]]))
    assert abs(P[0, IDX['head'], 1] - 1.60) < 1e-9 and abs(P[0, IDX['ltoe'], 1]) < 1e-9


def test_bone_lengths_constant():
    P = _motion().positions()
    for a, b in BONES:
        L = np.linalg.norm(P[:, b] - P[:, a], axis=1)
        assert np.ptp(L) < 1e-9, (JOINTS[a], JOINTS[b])


def test_leg_ik_reaches_target():
    rng = np.random.default_rng(0)
    hip = rng.normal(size=(200, 3)) * 0.05 + [0, .9, 0]
    tgt = hip + rng.uniform(-.5, .5, (200, 3)) * [1, 1, 1] + [0, -.5, 0]
    tgt = hip + (tgt - hip) / np.linalg.norm(tgt - hip, axis=1, keepdims=True) * rng.uniform(.3, .8, (200, 1))
    pole = np.tile([0, 0, 1.0], (200, 1))
    d, s, u, flex, tc = leg_ik(hip, tgt, pole)
    ank = hip + THIGH * d + SHANK * s
    assert np.abs(ank - tgt).max() < 1e-9
    assert np.abs(np.linalg.norm(d, axis=1) - 1).max() < 1e-9 and np.abs((d * u).sum(1)).max() < 1e-9


def test_planted_feet_do_not_float_in_bounce():
    m = generate(BEATS, 8.0, 'groove', seed=1)
    P = m.positions()
    assert P[:, [IDX['ltoe'], IDX['rtoe']], 1].min() > -1e-9


def test_retarget_identity():
    """no locks, no limits, no speed limit  =>  robot == scaled human"""
    m = _motion('house')
    e = Embodiment('id', 0.77, np.full((J, 3), -np.inf), np.full((J, 3), np.inf), np.ones((J, 3), bool), vmax=np.inf)
    H = m.positions(); r = retarget_humanoid(m, e)
    assert np.abs(r.pos - H * 0.77).max() < 1e-9
    assert not r.limit_clip.any() and not r.rate_clip.any()


def test_arm_ik_exact_when_unconstrained(monkeypatch=None):
    import dancebot.retarget as RT
    m = _motion('groove'); H = m.positions()
    old = dict(RT.ARM); RT.ARM.update(q1=(-9, 9), q2=(-9, 9), q3=(-9, 9))
    try:
        a = retarget_arm(m, H, vmax=1e9)
    finally:
        RT.ARM.update(old)
    reach = a.extras['reach_loss'] == 0
    err = np.linalg.norm(a.extras['tip'] - a.extras['target'], axis=1)
    assert err[reach].max() < 1e-6 and reach.mean() > 0.9


def test_smpl_roundtrip():
    m = _motion('pop')
    aa, trans = to_smpl(m)
    m2 = from_smpl(aa, trans)
    m2.root = m.root.copy()
    assert np.abs(m2.positions() - m.positions()).max() < 1e-8


def test_bas_synthetic():
    fps = 30; t = np.arange(16 * fps) / fps
    beats = np.arange(0.25, 16, 0.5)
    pos = np.zeros((len(t), 3, 3)); pos[:, 0, 1] = np.abs(np.sin(np.pi * t / 0.5))  # exactly one speed minimum per beat, at 0.25+0.5k
    kb, _ = M.kinematic_beats(pos, fps)
    on = M.bas(beats, kb, fps); off = M.bas(beats + 0.25, kb, fps)
    assert on > 0.95 and off < 0.1, (on, off)


def test_dtw():
    x = np.random.default_rng(0).normal(size=(100, 3))
    assert M.dtw(x, x) < 1e-12
    assert M.dtw(x[:-5], x[5:]) < M.dtw(x, x[::-1].copy())


def test_beat_tracker_on_synth():
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'audio', 'house.wav')
    if os.path.exists(p):
        tempo, b, d = detect_beats(p)
        assert abs(tempo - 124) < 4


if __name__ == '__main__':
    fns = [v for k, v in sorted(globals().items()) if k.startswith('test_') and callable(v)]
    bad = 0
    for f in fns:
        try:
            f(); print('PASS', f.__name__)
        except Exception as ex:
            bad += 1; import traceback; print('FAIL', f.__name__, repr(ex)); traceback.print_exc()
    print(f'{len(fns) - bad}/{len(fns)} passed'); sys.exit(1 if bad else 0)
