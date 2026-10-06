import pickle, os, time, numpy as np
from dancebot.render import *
bundle = pickle.load(open('out/bundle.pkl', 'rb'))
os.makedirs('out/videos', exist_ok=True)
t0 = time.time()
for g in bundle:
    render_analysis(bundle, g, f'audio/{g}.wav', f'out/videos/compare_{g}.mp4', g.upper()); print(g, 'analysis video', round(time.time() - t0, 1), 's')
