const E = require('./engine.js'), B = require('../out/beats32.json');
const beats = B.house.beats;
const AUD = [['kick','arms_up',.9],['step_touch','torso_twist',.8],['squat_pulse','arm_wave',.9],['sway','head_bang',.6]];
const seq = { '-1': ['idle','none',.5] }; AUD.forEach((p, i) => seq[i] = p);
const mot = E.generate(beats, 4*8*60/B.house.tempo + 1, seq, { jitter: 0 });
console.log('T', mot.T);
const ids = E.GROUPS.map(g => g.id), res = [], t0 = Date.now();
for (let m = 0; m < (1 << ids.length); m++) for (const sp of E.SPEEDS) for (const wide of [0, 1]) {
  const groups = {}; ids.forEach((id, i) => groups[id] = (m >> i) & 1); if (wide && !groups.shRoll) continue;
  const cfg = { groups, shoulderWide: wide, vmax: sp.v }, r = E.retargetHumanoid(mot, E.customRobot(cfg)); const fid = E.keypointFidelity(mot.pos, r.pos, mot.T, r.scale, null);
  res.push({ cost: E.robotCost(cfg), fid, cfg }); }
console.log('configs', res.length, 'time', (Date.now() - t0) / 1000, 's');
const full = E.retargetHumanoid(mot, E.humanoidFull()); console.log('full G1-like fidelity', E.keypointFidelity(mot.pos, full.pos, mot.T, .77, null).toFixed(3), 'cost', E.GROUPS.reduce((s, g) => s + g.cost, 0) + 1 + 1);
const best = {}; for (const r of res) if (!best[r.cost] || r.fid > best[r.cost].fid) best[r.cost] = r;
for (const c of Object.keys(best).map(Number).sort((a, b) => a - b)) { const b = best[c], on = Object.keys(b.cfg.groups).filter(k => b.cfg.groups[k]); console.log(String(c).padStart(2), (100*b.fid).toFixed(1).padStart(5) + '%', 'v' + b.cfg.vmax, b.cfg.shoulderWide ? 'wide' : '    ', on.join(',')); }
const fs = require('fs'); const frontier = []; let bestSoFar = -1;
for (const c of Object.keys(best).map(Number).sort((a, b) => a - b)) { frontier.push({ cost: c, fid: +best[c].fid.toFixed(4), cfg: best[c].cfg }); }
fs.writeFileSync('../out/frontier.json', JSON.stringify({ audition: AUD, song: 'house', frontier, g1: (() => { const g = {}; E.GROUPS.forEach(x => g[x.id] = 1); const cfg = { groups: g, shoulderWide: 0, vmax: 8 }, r = E.retargetHumanoid(mot, E.customRobot(cfg)); return { cost: E.robotCost(cfg), fid: +E.keypointFidelity(mot.pos, r.pos, mot.T, r.scale, null).toFixed(4) }; })() }));
