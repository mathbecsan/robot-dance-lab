"""End-to-end: audio -> beats -> dance -> retarget (3 embodiments) -> metrics -> figures + clip bundle.
    python run_pipeline.py            # ~1 min on a laptop CPU
"""
import os, sys, pickle, json, time
import numpy as np, pandas as pd
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from dancebot.audio import make_tracks, detect_beats, TRACKS
from dancebot.motion import generate, GENRES
from dancebot.retarget import humanoid_full, humanoid_reduced, retarget_humanoid, retarget_arm
from dancebot.skeleton import IDX, JOINTS, J
from dancebot import metrics as M

SEEDS = [1, 2, 3, 4, 5]
GENRE_LIST = list(TRACKS)
os.makedirs('results', exist_ok=True); os.makedirs('out', exist_ok=True)
COL = {'human': '#2b2b2b', 'humanoid': '#1f77b4', 'reduced': '#ff7f0e', 'arm': '#2ca02c'}
LEG = [IDX[s + n] for s in 'lr' for n in ('hip', 'knee', 'ank')]
UPPER = [IDX[n] for n in ('spine', 'chest', 'lsho', 'rsho', 'lelb', 'relb', 'lwri', 'rwri')]

t0 = time.time()
paths = make_tracks('audio')
music = {g: detect_beats(paths[g]) for g in GENRE_LIST}
print({g: (round(v[0], 1), len(v[1])) for g, v in music.items()})

rows, move_rows, bundle = [], [], {}
for g in GENRE_LIST:
    tempo, beats, dur = music[g]
    for seed in SEEDS:
        mot = generate(beats, dur, g, seed=seed); H = mot.positions()
        res = {'human': M.evaluate('human', H, mot.fps, beats)}
        robots = {}
        for emb in (humanoid_full(), humanoid_reduced()):
            r = retarget_humanoid(mot, emb); robots[emb.name] = r
            res[emb.name] = M.evaluate(emb.name, r.pos, mot.fps, beats, human_pos=H, scale=emb.scale, robot=r, human_euler=mot.euler)
            lab_leg, lab_arm = np.array(mot.leg_label), np.array(mot.arm_label)
            diff = np.abs(r.extras['human_euler'] - r.angles)
            for lab, arr, js in (('leg', lab_leg, LEG), ('arm', lab_arm, UPPER)):
                for mv in sorted(set(arr)):
                    sel = arr == mv
                    move_rows.append(dict(genre=g, seed=seed, embodiment=emb.name, group=lab, move=mv, frames=int(sel.sum()),
                                          clip_frac=float(r.limit_clip[sel][:, js].any(1).mean()),
                                          angle_loss=float(diff[sel][:, js].mean())))
        arm = retarget_arm(mot, H); robots['arm'] = arm
        res['arm'] = M.evaluate('arm', arm.pos, mot.fps, beats, human_pos=H, arm=arm)
        for k, v in res.items():
            v = dict(v); v.pop('_margin', None); v.update(genre=g, seed=seed); rows.append(v)
        if seed == SEEDS[0]:
            bundle[g] = dict(motion=mot, human_pos=H, robots=robots, beats=beats, tempo=tempo, dur=dur,
                             margins={k: v.get('_margin') for k, v in res.items()})
df = pd.DataFrame(rows); df['bas_lift'] = df['bas'] - df['bas_chance']
df.to_csv('results/metrics_all_seeds.csv', index=False)
mv = pd.DataFrame(move_rows); mv.to_csv('results/per_move.csv', index=False)

# ---------------- speed-limit sweep (humanoid) ----------------
sweep = []
for g in GENRE_LIST:
    tempo, beats, dur = music[g]
    for seed in SEEDS:
        mot = generate(beats, dur, g, seed=seed); H = mot.positions()
        for vmax in [2, 3, 4, 6, 8, 12, 20, np.inf]:
            emb = humanoid_full(vmax=vmax); r = retarget_humanoid(mot, emb)
            kb, _ = M.kinematic_beats(r.pos, mot.fps)
            sweep.append(dict(genre=g, seed=seed, vmax=vmax, bas_lift=M.bas(beats, kb, mot.fps) - M.chance_bas(beats, kb, mot.fps),
                              pose_dtw=M.pose_retention(H, r.pos, emb.scale)['pose_dtw'], rate_frames=float(r.rate_clip.any(1).mean())))
sw = pd.DataFrame(sweep); sw.to_csv('results/vmax_sweep.csv', index=False)

# ---------------- summaries ----------------
metric_cols = ['bas', 'bas_chance', 'bas_lift', 'pose_dtw', 'rwrist_dtw', 'energy_retained', 'limit_frames', 'rate_frames',
               'skate_ratio', 'unstable_frac', 'reach_loss_frac']
order = ['human', 'humanoid', 'reduced', 'arm']
summ = df.groupby(['genre', 'embodiment'])[metric_cols].agg(['mean', 'std'])
summ.to_csv('results/summary_by_genre.csv')
overall = df.groupby('embodiment')[metric_cols].mean().loc[order]
overall.to_csv('results/summary_overall.csv')
print(overall.round(3).T)

# ---------------- figures ----------------
plt.rcParams.update({'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False})
fig, ax = plt.subplots(1, 4, figsize=(15, 3.6))
panels = [('bas_lift', 'Beat alignment above chance\n(BAS - chance, higher = better)'),
          ('rwrist_dtw', 'Right-wrist retention\n(DTW distance, lower = better)'),
          ('limit_frames', 'Frames with a joint-limit / locked-DoF loss\n(lower = better)'),
          ('energy_retained', 'Joint-angle variance retained\n(humanoids only)')]
for a, (c, t) in zip(ax, panels):
    for i, e in enumerate(order):
        sub = df[df.embodiment == e]
        if sub[c].isna().all(): continue
        gm = sub.groupby('genre')[c].mean().loc[GENRE_LIST]
        for k, gname in enumerate(GENRE_LIST):
            a.bar(k * 5 + i, gm[gname], color=COL[e], alpha=0.9, label=e if k == 0 else None)
            pts = sub[sub.genre == gname][c].values; a.scatter(np.full(len(pts), k * 5 + i), pts, s=6, color='k', alpha=.35, zorder=3)
    a.set_xticks([k * 5 + 1.5 for k in range(3)]); a.set_xticklabels([f'{g}\n{TRACKS[g]} bpm' for g in GENRE_LIST]); a.set_title(t, fontsize=9)
ax[0].legend(frameon=False, fontsize=8)
plt.tight_layout(); plt.savefig('results/fig1_metrics.png', dpi=150); plt.close()

fig, ax = plt.subplots(1, 3, figsize=(12, 3.4))
fin = sw[np.isfinite(sw.vmax)]; inf_ = sw[~np.isfinite(sw.vmax)].groupby('genre').mean(numeric_only=True)
for g in GENRE_LIST:
    s = fin[fin.genre == g].groupby('vmax').mean(numeric_only=True)
    for a, c in zip(ax, ['bas_lift', 'pose_dtw', 'rate_frames']):
        a.plot(s.index, s[c], 'o-', label=g); a.axhline(inf_.loc[g, c], ls=':', lw=.8, color='gray')
for a, t in zip(ax, ['Beat alignment above chance', 'Pose retention (DTW, lower = better)', 'Frames hitting the speed limit']):
    a.set_xscale('log'); a.set_xlabel('joint speed limit (rad/s)   [dotted = unlimited]'); a.set_title(t, fontsize=9)
ax[0].legend(frameon=False, fontsize=8); plt.tight_layout(); plt.savefig('results/fig2_speed_limit.png', dpi=150); plt.close()

fig, ax = plt.subplots(1, 2, figsize=(11, 3.6))
for a, grp in zip(ax, ['leg', 'arm']):
    sub = mv[(mv.group == grp)]
    piv = sub.groupby(['move', 'embodiment']).apply(lambda d: np.average(d.clip_frac, weights=d.frames), include_groups=False).unstack()
    piv = piv.reindex(columns=['humanoid', 'reduced']).sort_values('humanoid', ascending=False)
    piv.plot.barh(ax=a, color=[COL['humanoid'], COL['reduced']], width=.75); a.invert_yaxis()
    a.set_title(('Leg' if grp == 'leg' else 'Arm/torso') + ' moves: share of frames with a limit/locked-DoF loss', fontsize=9)
    a.set_xlim(0, 1); a.set_ylabel(''); a.legend(frameon=False, fontsize=8)
plt.tight_layout(); plt.savefig('results/fig3_which_moves_break.png', dpi=150); plt.close()

# fig 4: timeline for pop seed 1
b = bundle['pop']; fps = b['motion'].fps; t = np.arange(b['motion'].T) / fps
fig, ax = plt.subplots(3, 1, figsize=(12, 5.2), sharex=True, gridspec_kw={'height_ratios': [1.4, 1.4, 1]})
for a, (nm, pos) in zip(ax[:2], [('human', b['human_pos']), ('humanoid', b['robots']['humanoid'].pos)]):
    kb, v = M.kinematic_beats(pos, fps); a.plot(t, v / v.max(), color=COL[nm], lw=1.2); a.plot(kb / fps, v[kb] / v.max(), 'v', color='crimson', ms=4)
    for bt in b['beats']: a.axvline(bt, color='gray', lw=.5, alpha=.5)
    a.set_ylabel(f'{nm}\nmean joint speed'); a.set_yticks([])
rc = b['robots']['humanoid']
ax[2].imshow(rc.limit_clip.T.astype(float), aspect='auto', cmap='Reds', extent=[0, t[-1], J, 0], interpolation='nearest')
ax[2].set_yticks(np.arange(J) + 0.5); ax[2].set_yticklabels(JOINTS, fontsize=5); ax[2].set_xlabel('time (s) — gray lines = detected music beats; red markers = kinematic beats; bottom: clipped joints')
plt.tight_layout(); plt.savefig('results/fig4_timeline_pop.png', dpi=150); plt.close()

pickle.dump(bundle, open('out/bundle.pkl', 'wb'))
print('done in %.1fs' % (time.time() - t0))
