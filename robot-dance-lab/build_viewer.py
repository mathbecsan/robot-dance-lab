"""Bundle motions + audio + metrics into ONE self-contained viewer.html (no network, no server)."""
import pickle, json, base64, numpy as np, pandas as pd
from dancebot.skeleton import BONES, JOINTS

bundle = pickle.load(open('out/bundle.pkl', 'rb'))
allm = pd.read_csv('results/metrics_all_seeds.csv'); allm['bas_lift'] = allm.bas - allm.bas_chance
pooled = allm.groupby('embodiment')[['bas_lift', 'rwrist_dtw', 'pose_dtw', 'limit_frames', 'rate_frames', 'energy_retained', 'unstable_frac', 'reach_loss_frac']].mean().round(4)
pooled = json.loads(pooled.to_json(orient='index'))

def mask(b):                      # (T,J) bool -> int bitmask per frame
    return (b.astype(np.int64) * (1 << np.arange(b.shape[1]))).sum(1).tolist()

data = {'joints': JOINTS, 'bones': BONES, 'songs': {}, 'pooled': pooled}
for g, b in bundle.items():
    S = {'tempo': round(b['tempo'], 1), 'beats': [round(float(x), 3) for x in b['beats']], 'fps': b['motion'].fps, 'bodies': {}}
    rm = b['robots']
    S['bodies']['human'] = dict(pos=np.round(b['human_pos'] * 100).astype(int).ravel().tolist(), nj=19, scale=1.0)
    for k in ('humanoid', 'reduced'):
        r = rm[k]; S['bodies'][k] = dict(pos=np.round(r.pos * 100).astype(int).ravel().tolist(), nj=19, scale=0.77, lim=mask(r.limit_clip), rate=mask(r.rate_clip))
    a = rm['arm']
    S['bodies']['arm'] = dict(pos=np.round(a.pos * 100).astype(int).ravel().tolist(), nj=4, scale=1.0, lim=mask(a.limit_clip), rate=mask(a.rate_clip),
                              reach=(a.extras['reach_loss'] > 0).astype(int).tolist())
    for k in ('human', 'humanoid', 'reduced'):
        mg = b['margins'][k]; S['bodies'][k]['bal'] = (mg >= 0).astype(int).tolist()
    # per-clip metrics (seed 1 clip shown in the viewer)
    cm = allm[(allm.genre == g) & (allm.seed == 1)].set_index('embodiment')
    S['metrics'] = json.loads(cm[['bas_lift', 'rwrist_dtw', 'pose_dtw', 'limit_frames', 'rate_frames', 'energy_retained', 'unstable_frac', 'reach_loss_frac']].round(4).to_json(orient='index'))
    S['audio'] = 'data:audio/mpeg;base64,' + base64.b64encode(open(f'out/{g}.mp3', 'rb').read()).decode()
    data['songs'][g] = S

tmpl = open('viewer_template.html').read()
html = tmpl.replace('__DATA__', json.dumps(data, separators=(',', ':')))
open('out/viewer.html', 'w').write(html)
print('viewer.html %.2f MB' % (len(html) / 1e6))
