"""32-s tracks for the interactive game + reference fixture for the JS<->Python parity test."""
import json, numpy as np, soundfile as sf, subprocess
from dancebot.audio import render, TRACKS, SR, detect_beats
from dancebot.motion import generate
from dancebot.retarget import humanoid_full, humanoid_reduced, retarget_humanoid, retarget_arm
from dancebot import metrics as M
beats = {}
for g, bpm in TRACKS.items():
    sf.write(f'audio/{g}_32.wav', render(g, bpm, 32.0), SR)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'audio/{g}_32.wav', '-codec:a', 'libmp3lame', '-b:a', '80k', '-ac', '1', f'out/{g}_32.mp3'], check=True)
    tempo, b, d = detect_beats(f'audio/{g}_32.wav'); beats[g] = dict(tempo=tempo, beats=b.tolist(), dur=d)
    true = np.arange(0, d, 60 / bpm); dev = np.median([np.min(np.abs(true - x)) for x in b]) * 1000
    print(g, round(tempo, 1), len(b), 'beats; median dev %.0f ms' % dev)
json.dump(beats, open('out/beats32.json', 'w'))

# ---- parity fixture
SEQ = {-1: ('idle', 'none', .5), 0: ('kick', 'arms_up', 1.0), 1: ('step_touch', 'head_bang', .7), 2: ('squat_pulse', 'lean_back', .8),
       3: ('sway', 'torso_twist', .4), 4: ('bounce', 'arm_wave', .6), 5: ('kick', 'arm_pump', .9)}
b = np.array(beats['house']['beats']); dur = 32.0
mot = generate(b, dur, 'house', sequence=SEQ, jitter=0.0); H = mot.positions()
fx = dict(beats=b.tolist(), dur=dur, seq={str(k): list(v) for k, v in SEQ.items()}, euler=mot.euler.ravel().tolist(), root=mot.root.ravel().tolist(), human=H.ravel().tolist())
for emb in (humanoid_full(), humanoid_reduced()):
    r = retarget_humanoid(mot, emb); fx[emb.name] = dict(pos=r.pos.ravel().tolist(), lim=r.limit_clip.astype(int).ravel().tolist(), rate=r.rate_clip.astype(int).ravel().tolist(),
                                                         angles=r.angles.ravel().tolist())
a = retarget_arm(mot, H); fx['arm'] = dict(pos=a.pos.ravel().tolist(), lim=a.limit_clip.astype(int).ravel().tolist(), reach=(a.extras['reach_loss'] > 0).astype(int).tolist())
fx['balance'] = M.balance(H)['margin'].tolist()
json.dump(fx, open('out/parity_fixture.json', 'w'))
print('fixture T =', mot.T, 'human-vs-humanoid limit frames', retarget_humanoid(mot, humanoid_full()).limit_clip.any(1).mean().round(3))

# ============================================================ Latin tracks (salsa / cumbia / bachata)
from dancebot.audio import LATIN_TRACKS, LATIN_HINT, render_latin, detect_beats_hint, estimate_downbeat, estimate_downbeat_clave
latin = {}
for st, bpm in LATIN_TRACKS.items():
    sf.write(f'audio/{st}_32.wav', render_latin(st, bpm, 32.0), SR)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'audio/{st}_32.wav', '-codec:a', 'libmp3lame', '-b:a', '80k', '-ac', '1', f'out/{st}_32.mp3'], check=True)
    tempo, b, d = detect_beats_hint(f'audio/{st}_32.wav', LATIN_HINT[st])
    if st == 'salsa': off, _ = estimate_downbeat_clave(f'audio/{st}_32.wav', b); method = 'clave template'
    else: off, _ = estimate_downbeat(f'audio/{st}_32.wav', b, 4); method = 'chord-change'
    b2 = b[off:]; true = np.arange(0, d, 60 / bpm); dev = np.median([np.min(np.abs(true - x)) for x in b2]) * 1000
    k0 = int(round(b2[0] / (60 / bpm))) % 8
    latin[st] = dict(tempo=tempo, beats=b2.tolist(), dur=d, offset=off, method=method)
    print(f'{st:8s} {tempo:.1f} bpm, {len(b2)} beats from downbeat (method: {method}); phase error {dev:.0f} ms; first dance beat is true beat index {k0} of 8')
json.dump(latin, open('out/beats_latin.json', 'w'))

SEQL = {-1: ('idle', 'none', .5),
        0: ('salsa_basic', 'salsa_arms', .6, {'step': .7, 'lift': .5, 'hip': .6, 'arm': .8}), 1: ('salsa_side', 'salsa_arms', .6, {}),
        2: ('bachata_basic', 'bachata_arms', .6, {'step': 1.2, 'hip': 1.3}), 3: ('bachata_basic', 'salsa_arms', .6, {'arm': 0.0}),
        4: ('cumbia_basic', 'cumbia_arms', .6, {'step': .5, 'lift': 1.4}), 5: ('cumbia_basic', 'cumbia_arms', .6, {}),
        6: ('salsa_basic', 'none', .6, {'hip': 0.0}), 7: ('kick', 'arms_up', .8)}
bl = np.array(beats['house']['beats'])
motl = generate(bl, 32.0, 'house', sequence=SEQL, jitter=0.0); Hl = motl.positions()
fl = dict(beats=bl.tolist(), dur=32.0, seq={str(k): [v[0], v[1], v[2], (v[3] if len(v) > 3 else {})] for k, v in SEQL.items()}, euler=motl.euler.ravel().tolist(), root=motl.root.ravel().tolist(), human=Hl.ravel().tolist())
r = retarget_humanoid(motl, humanoid_full(speed := None) if False else humanoid_full()); fl['humanoid'] = dict(pos=r.pos.ravel().tolist(), lim=r.limit_clip.astype(int).ravel().tolist(), rate=r.rate_clip.astype(int).ravel().tolist())
r2 = retarget_humanoid(motl, humanoid_reduced()); fl['reduced'] = dict(pos=r2.pos.ravel().tolist(), lim=r2.limit_clip.astype(int).ravel().tolist())
json.dump(fl, open('out/parity_fixture_latin.json', 'w')); print('latin fixture written, T =', motl.T)
