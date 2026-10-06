"""Assemble out/robot_dance_lab.html (single offline file)."""
import json, base64, pandas as pd
beats = json.load(open('out/beats32.json')); fr = json.load(open('out/frontier.json'))
allm = pd.read_csv('results/metrics_all_seeds.csv'); allm['bas_lift'] = allm.bas - allm.bas_chance
pooled = json.loads(allm.groupby('embodiment')[['bas_lift', 'rwrist_dtw', 'limit_frames', 'energy_retained']].mean().round(4).to_json(orient='index'))
songs = {g: dict(tempo=round(b['tempo'], 1), beats=[round(x, 3) for x in b['beats']], audio='data:audio/mpeg;base64,' + base64.b64encode(open(f'out/{g}_32.mp3', 'rb').read()).decode()) for g, b in beats.items()}
latin = json.load(open('out/beats_latin.json'))
for g, v in latin.items():
    songs[g] = dict(tempo=round(v['tempo'], 1), beats=[round(x, 3) for x in v['beats']], latin=True, method=v['method'], audio='data:audio/mpeg;base64,' + base64.b64encode(open(f'out/{g}_32.mp3', 'rb').read()).decode())
data = dict(songs=songs, frontier=fr, pooled=pooled)
html = open('web/game_template.html').read()
html = html.replace('__ENGINE__', open('web/engine.js').read()).replace('__APP__', open('web/app.js').read()).replace('__DATA__', json.dumps(data, separators=(',', ':')))
open('out/robot_dance_lab.html', 'w').write(html); print('robot_dance_lab.html %.2f MB' % (len(html) / 1e6))
