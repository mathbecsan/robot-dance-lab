"""Perception-study analysis.
    python study/analysis.py --data study/data            # real CSVs, one per participant
    python study/analysis.py --demo                       # SIMULATED data: tests the pipeline ONLY, not a finding
"""
import argparse, glob, os, sys
import numpy as np, pandas as pd
from scipy.stats import friedmanchisquare, wilcoxon
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
import statsmodels.formula.api as smf

ap = argparse.ArgumentParser(); ap.add_argument('--data', default='study/data'); ap.add_argument('--demo', action='store_true'); a = ap.parse_args()
ITEMS = ['looks_like_dancing', 'matches_music', 'human_like', 'enjoyable']
EMB = ['human', 'humanoid', 'reduced', 'arm']

def simulate(n=24, seed=0):
    import json
    rng = np.random.default_rng(seed); man = json.load(open(os.path.join(os.path.dirname(__file__), 'manifest.json')))
    mu = {'looks_like_dancing': dict(human=5.6, humanoid=5.0, reduced=4.2, arm=3.0), 'matches_music': dict(human=5.4, humanoid=5.0, reduced=4.5, arm=4.2),
          'human_like': dict(human=5.5, humanoid=4.4, reduced=3.5, arm=1.8), 'enjoyable': dict(human=4.8, humanoid=4.5, reduced=3.9, arm=3.4)}
    rows = []
    for p in range(n):
        off = rng.normal(0, .7)
        for i, c in enumerate(rng.permutation(len(man))):
            m = man[c]; r = dict(pid=f'sim{p:02d}', trial=i + 1, file=m['file'], song=m['song'], embodiment=m['embodiment'], audio=m['audio'], condition=m['condition'])
            for it in ITEMS:
                base = mu[it][m['embodiment']] + off + rng.normal(0, 1.0) - (1.8 if (m['condition'] == 'mismatched' and it == 'matches_music') else 0)
                r[it] = int(np.clip(round(base), 1, 7))
            rows.append(r)
    return pd.DataFrame(rows)

if a.demo:
    df = simulate(); print('*' * 70, '\n*** SIMULATED DATA - pipeline test only. Not evidence about anything. ***\n' + '*' * 70)
else:
    files = glob.glob(os.path.join(a.data, '*.csv')); 
    if not files: sys.exit(f'no CSVs in {a.data}')
    df = pd.concat([pd.read_csv(f) for f in files]); 
    bad = df[df.attn_pass == 0].pid.unique() if 'attn_pass' in df else []
    print(f'{df.pid.nunique()} participants; excluding {len(bad)} failed attention check'); df = df[~df.pid.isin(bad)]
m = df[df.condition == 'matched']
print(f'\nN = {df.pid.nunique()} participants, {len(m)} matched trials\n')
tab = m.groupby('embodiment')[ITEMS].agg(['mean', 'std']).loc[EMB].round(2); print(tab.to_string())

def holm(ps):
    o = np.argsort(ps); adj = np.empty(len(ps)); run = 0
    for r, i in enumerate(o): run = max(run, (len(ps) - r) * ps[i]); adj[i] = min(1, run)
    return adj
print('\n== Friedman across embodiments (participant means over songs) + Holm pairwise Wilcoxon ==')
for it in ITEMS:
    W = m.groupby(['pid', 'embodiment'])[it].mean().unstack()[EMB]
    chi, p = friedmanchisquare(*[W[e] for e in EMB])
    pairs = [(x, y) for i, x in enumerate(EMB) for y in EMB[i + 1:]]
    ps = [wilcoxon(W[x], W[y]).pvalue for x, y in pairs]; adj = holm(np.array(ps))
    sig = ', '.join(f'{x}>{y}' if W[x].mean() > W[y].mean() else f'{y}>{x}' for (x, y), q in zip(pairs, adj) if q < .05)
    print(f'{it:20s} chi2={chi:6.2f} p={p:.2g} | Holm-significant pairs: {sig or "none"}')
print('\n== Linear mixed model: rating ~ embodiment + (1|participant) + (song as fixed) ==')
for it in ITEMS:
    fit = smf.mixedlm(f'{it} ~ C(embodiment, Treatment("human")) + C(song)', m, groups=m['pid']).fit(reml=True)
    co = fit.params.filter(like='embodiment'); ci = fit.conf_int().loc[co.index]
    print(it, {k.split('T.')[1].rstrip(']'): f'{v:+.2f} [{ci.loc[k, 0]:+.2f},{ci.loc[k, 1]:+.2f}]' for k, v in co.items()})
print('\n== Is the music-motion link perceived? matched vs mismatched audio (same visuals) ==')
pair = df[df.condition.isin(['matched', 'mismatched'])]
mm = []
for _, r in df[df.condition == 'mismatched'].iterrows():
    mt = df[(df.pid == r.pid) & (df.file == f'{r.song}_{r.embodiment}_matched.mp4')]
    if len(mt): mm.append((r.embodiment, mt.matches_music.iloc[0], r.matches_music))
mm = pd.DataFrame(mm, columns=['embodiment', 'matched', 'mismatched']); mm['drop'] = mm.matched - mm.mismatched
print(mm.groupby('embodiment')['drop'].agg(['mean', 'count']).loc[EMB].round(2).to_string()); 
print('overall drop in "matches the music": %.2f, Wilcoxon p=%.2g' % (mm['drop'].mean(), wilcoxon(mm.matched, mm.mismatched).pvalue))
fig, ax = plt.subplots(1, 4, figsize=(13, 3.2), sharey=True)
for a_, it in zip(ax, ITEMS):
    g = m.groupby(['pid', 'embodiment'])[it].mean().unstack()[EMB]
    mu = g.mean(); se = 1.96 * g.std() / np.sqrt(len(g)); a_.bar(EMB, mu, yerr=se, color=['#2b2b2b', '#1f77b4', '#ff7f0e', '#2ca02c'], capsize=3)
    a_.set_title(it.replace('_', ' '), fontsize=9); a_.set_ylim(1, 7); a_.tick_params(axis='x', labelsize=8)
fig.suptitle('SIMULATED DATA - pipeline test' if a.demo else 'Perception ratings (mean, 95% CI over participants)', fontsize=9, color='crimson' if a.demo else 'k')
plt.tight_layout(); out = 'study/results_demo.png' if a.demo else 'study/results.png'; plt.savefig(out, dpi=140); print('saved', out)
