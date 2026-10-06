import pickle, os, json, numpy as np
from dancebot.render import render_study_clip, mux
bundle = pickle.load(open('out/bundle.pkl', 'rb'))
S = 'study/stimuli'; os.makedirs(S, exist_ok=True); os.makedirs('out/tmp', exist_ok=True)
songs = ['groove', 'house', 'pop']; embs = ['human', 'humanoid', 'reduced', 'arm']
manifest = []
for g in songs:
    for e in embs:
        raw = f'out/tmp/{g}_{e}.mp4'; render_study_clip(bundle, g, e, raw)
        f = f'{g}_{e}_matched.mp4'; mux(raw, f'audio/{g}.wav', f'{S}/{f}', 4.0, 8.0)
        manifest.append(dict(file=f, song=g, embodiment=e, audio=g, condition='matched'))
for i, e in enumerate(embs):                       # one mismatched control per embodiment, rotating songs
    g = songs[i % 3]; a = songs[(i + 1) % 3]
    f = f'{g}_{e}_mismatch-{a}.mp4'; mux(f'out/tmp/{g}_{e}.mp4', f'audio/{a}.wav', f'{S}/{f}', 4.0, 8.0)
    manifest.append(dict(file=f, song=g, embodiment=e, audio=a, condition='mismatched'))
json.dump(manifest, open('study/manifest.json', 'w'), indent=1)
print(len(manifest), 'stimuli'); 
