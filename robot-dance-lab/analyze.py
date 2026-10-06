"""Paired statistics across (genre x seed) = 15 matched clips. Wilcoxon signed-rank + bootstrap 95% CI of the mean difference."""
import numpy as np, pandas as pd
from scipy.stats import wilcoxon
df = pd.read_csv('results/metrics_all_seeds.csv')
df['bas_lift'] = df['bas'] - df['bas_chance']
rng = np.random.default_rng(0)

def paired(metric, a, b):
    A = df[df.embodiment == a].set_index(['genre', 'seed'])[metric]; B = df[df.embodiment == b].set_index(['genre', 'seed'])[metric]
    d = (A - B).dropna().values
    boot = [rng.choice(d, len(d)).mean() for _ in range(4000)]
    try: p = wilcoxon(d).pvalue
    except ValueError: p = np.nan
    return dict(metric=metric, comparison=f'{a} - {b}', n=len(d), mean_diff=d.mean(), ci_lo=np.percentile(boot, 2.5), ci_hi=np.percentile(boot, 97.5), p_wilcoxon=p)

tests = [('bas_lift', 'humanoid', 'human'), ('bas_lift', 'reduced', 'human'), ('bas_lift', 'arm', 'human'),
         ('rwrist_dtw', 'reduced', 'humanoid'), ('rwrist_dtw', 'arm', 'humanoid'),
         ('limit_frames', 'reduced', 'humanoid'), ('energy_retained', 'reduced', 'humanoid'),
         ('skate_ratio', 'humanoid', 'human'), ('unstable_frac', 'humanoid', 'human'), ('unstable_frac', 'reduced', 'humanoid')]
out = pd.DataFrame([paired(*t) for t in tests])
out.to_csv('results/paired_stats.csv', index=False)
pd.set_option('display.width', 200); print(out.round(4).to_string(index=False))
# how noisy is BAS across seeds?
h = df[df.embodiment == 'human'].groupby('genre')['bas_lift'].agg(['mean', 'std', 'min', 'max']); print('\nhuman BAS-lift spread across seeds\n', h.round(3))
print('\nBAS vs number of kinematic beats (all embodiments): spearman', df[['bas', 'n_kin_beats']].corr(method='spearman').iloc[0, 1].round(3))
