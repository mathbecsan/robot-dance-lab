'use strict';
const E = Engine, $ = id => document.getElementById(id);
const J = E.J, FPS = E.FPS, N3 = J * 3;
const C = { human: '#dfe5ec', humanoid: '#5b8cff', reduced: '#ffb02e', arm: '#2fd1a8', custom: '#c58bff', gap: '#ff3d8b', amber: '#ffb02e', ok: '#3ddc97', neutral: '#cfd8e3' };
const NAMES = { human: 'AI human', humanoid: 'Full humanoid', reduced: 'Reduced humanoid', arm: 'Robot arm', custom: 'Your robot' };
const LEGN = { salsa_basic: 'salsa basic (forward and back)', salsa_side: 'salsa side basic', cumbia_basic: 'cumbia side-and-close', bachata_basic: 'bachata side steps and taps', idle: 'standing', bounce: 'bouncing', sway: 'hip sway', step_touch: 'side step-touches', squat_pulse: 'deep squat pulses', kick: 'high kicks' };
const ARMN = { salsa_arms: 'salsa arm frame', cumbia_arms: 'cumbia arm swing', bachata_arms: 'bachata arm frame', none: 'arms relaxed', arm_pump: 'arm pumps', arm_wave: 'arm waves', arms_up: 'hands overhead', torso_twist: 'torso twists', head_bang: 'head banging', lean_back: 'leaning back' };
const EXAMPLES = ['salsa, then salsa side basic', 'bachata, then cumbia', 'kick high, then hands up and twist, finish with deep squats', 'slow sway with waving arms, then head bang', 'wild step-touch with arm pumps twice', 'lean back and kick, then bounce', 'hands in the air'];
const WHY = { 'sho:2': 'Arms overhead need a very wide shoulder-raise range; many robots stop around 130°.', 'hip:2': 'Stepping sideways opens the hip outward and the foot has to stay flat; hip roll is often only about 30°.',
  'ank:2': 'Ankle roll keeps the foot flat when the body leans sideways; most robots have only about 15°.', 'ank:0': 'Deep squats need the ankle to tilt a long way so the foot stays flat.',
  'spine:1': 'Without a waist twist the torso stays rigid and only the arms can turn.', 'chest:1': 'Without a waist twist the torso stays rigid and only the arms can turn.', 'spine:0': 'Leaning back needs waist pitch; robot waists often bend only about 15°.',
  'chest:0': 'Leaning back needs waist pitch; robot waists often bend only about 15°.', 'neck:0': 'Many humanoids have no neck, so the head cannot nod.', 'head:0': 'Many humanoids have no neck, so the head cannot nod.',
  'sho:0': 'Swinging the arm needs shoulder pitch.', 'hip:0': 'Kicks and squats need a large hip swing.', 'knee:0': 'Knees bend the legs for squats and kicks.', 'elb:0': 'Elbows bend the arms for pumps and waves.' };
const REDUCED_MOTION = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const SONGS = DATA.songs, SONG_IDS = Object.keys(SONGS);
const hex = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const pct = x => Math.round(100 * x) + '%';
let store = {}; try { store = JSON.parse(localStorage.getItem('rdl') || '{}'); } catch (e) { store = {}; }
const save = () => { try { localStorage.setItem('rdl', JSON.stringify(store)); } catch (e) {} };

// ================================================================== state
const S = { song: 'house', body: 'humanoid', speed: 8, phrases: [], unknown: [], mot: null, rob: {}, ev: {}, ex: {}, ghost: {}, arm: null, sel: { j: IDX('rsho'), a: 2 }, userRan: false,
  ghostOn: true, hits: true, bal: false, camAuto: true, custom: { groups: {}, shoulderWide: 0, vmax: 8 }, done: store.done || {} };
function IDX(n) { return E.IDX[n]; }
E.GROUPS.forEach(g => S.custom.groups[g.id] = 1);
const cam = { yaw: .38, pitch: .22 };
const audio = {}; SONG_IDS.forEach(s => { const a = new Audio(); a.preload = 'auto'; a.src = SONGS[s].audio; audio[s] = a; });

let audioWarned = false;
function audioProblem(err) { const el = $('snd'); if (el) { el.textContent = 'Sound blocked'; el.style.color = 'var(--gap)'; }
  if (!audioWarned) { audioWarned = true; toast((err && err.name === 'NotAllowedError') ? 'Your browser blocked the sound. Press Play again, or open this file in its own browser tab.' : 'Sound could not start (' + ((err && err.name) || 'unknown') + '). Try opening this file in its own browser tab.'); } }
function setMuted(m) { S.muted = m; Object.values(audio).forEach(a => a.muted = m); const el = $('snd'); if (el) { el.textContent = m ? 'Sound off' : 'Sound on'; el.style.color = ''; } }
Object.values(audio).forEach(a => a.addEventListener('error', () => audioProblem({ name: 'DecodeError' })));
// ================================================================== player (one clock for whichever tab is active)
// seconds into the song for a given scene frame: scenes may start part-way in (audioStart / offset) and play at a practice speed (rate)
const audioTime = (sc, f) => (sc.audioStart != null ? sc.audioStart : (sc.offset || 0) / FPS) + f / FPS * (sc.rate || 1);
const Player = { scene: null, playing: false, frame: 0, base: 0, raf: 0,
  load(scene) { this.stop(); this.scene = scene; this.frame = 0; scene.draw(0); },
  play() { const sc = this.scene; if (!sc) return; if (this.frame >= sc.T - 1) this.frame = 0; this.base = performance.now() - this.frame / FPS * 1000; this.playing = true; this._audio(true); sc.onState && sc.onState(true); this.raf = requestAnimationFrame(() => this.tick()); },
  stop() { if (!this.playing && !this.scene) return; this.playing = false; cancelAnimationFrame(this.raf); Object.values(audio).forEach(a => { try { a.pause(); } catch (e) {} }); this.scene && this.scene.onState && this.scene.onState(false); },
  seek(f) { const sc = this.scene; if (!sc) return; this.frame = clamp(Math.round(f), 0, sc.T - 1); this.base = performance.now() - this.frame / FPS * 1000; if (this.playing) this._audio(false); sc.draw(this.frame); },
  _audio(start) { const sc = this.scene, a = audio[sc.song]; if (!a) return; const t = audioTime(sc, this.frame);
    Object.values(audio).forEach(x => { if (x !== a) { try { x.pause(); } catch (e) {} } });
    try { a.playbackRate = sc.rate || 1; } catch (e) {}
    // 1) start playback first, inside the click that triggered it (browsers only allow sound after a user gesture)
    if (start || a.paused) { try { const p = a.play(); if (p && p.catch) p.catch(err => audioProblem(err)); } catch (e) { audioProblem(e); } }
    // 2) then seek; if the file has not loaded yet, seek as soon as it has
    const seek = () => { try { a.currentTime = t; } catch (e) {} };
    if (a.readyState >= 1) seek(); else a.addEventListener('loadedmetadata', seek, { once: true }); },
  tick() { if (!this.playing) return; const sc = this.scene; let f = Math.floor((performance.now() - this.base) / 1000 * FPS);
    if (f >= sc.T - 1) { if (sc.loop) { f = 0; this.base = performance.now(); this._audio(false); } else { this.frame = sc.T - 1; sc.draw(this.frame); this.playing = false; this.stop(); sc.onEnd && sc.onEnd(); return; } }
    this.frame = f; if (f % 45 === 0) { const a = audio[sc.song]; try { if (a && Math.abs(a.currentTime - audioTime(sc, f)) > .25) a.currentTime = audioTime(sc, f); } catch (e) {} }
    sc.draw(f); this.raf = requestAnimationFrame(() => this.tick()); } };

// ================================================================== stage renderer
function beatDt(beats, t) { let lo = 0, hi = beats.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (beats[m] <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k < 0 ? 9 : t - beats[k]; }
class Stage {
  constructor(cv) { this.cv = cv; this.hit = []; this.fit(); }
  fit() { const r = Math.min(window.devicePixelRatio || 1, 2), b = this.cv.getBoundingClientRect(); const w = Math.max(20, Math.round((b.width || 800) * r)), h = Math.max(20, Math.round((b.height || 500) * r)); if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; } this.r = r; this.W = w; this.H = h; }
  proj(p, ox, yaw) { const s = this.H * .40 * (this.zoom || 1), x = p[0] + ox, y = p[1], z = p[2], cy = Math.cos(yaw), sy = Math.sin(yaw), xr = x * cy + z * sy, zr = -x * sy + z * cy, yv = y * Math.cos(cam.pitch) - zr * Math.sin(cam.pitch); return [this.W / 2 + s * xr, this.H * .86 - s * yv, zr]; }
  draw(actors, frame, o) {
    o = o || {}; this.zoom = o.zoom || 1; const g = this.cv.getContext('2d'), W = this.W, H = this.H, s = H * .40 * this.zoom, k = H / 620 * this.zoom, t = frame / FPS, beats = o.beats || [];
    const yaw = cam.yaw + (o.camAuto && !REDUCED_MOTION ? .28 * Math.sin(t * .35) : 0), pulse = REDUCED_MOTION ? 0 : Math.exp(-beatDt(beats, t) * 5);
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0c1626'); bg.addColorStop(1, '#17283f'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.lineWidth = Math.max(1, k); for (let q = -3; q <= 3.01; q += .5) { g.strokeStyle = `rgba(110,155,215,${.10 + .10 * pulse})`;
      let a = this.proj([q, 0, -2.2], 0, yaw), b = this.proj([q, 0, 2.2], 0, yaw); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      a = this.proj([-3, 0, q * .73], 0, yaw); b = this.proj([3, 0, q * .73], 0, yaw); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
    this.hit = [];
    for (const a of actors) {
      const c = this.proj([0, 0, 0], a.ox, yaw), dt = beatDt(beats, t);
      g.save(); g.translate(c[0], c[1]); g.scale(1, .3); const gr = g.createRadialGradient(0, 0, 0, 0, 0, s * 1.15); gr.addColorStop(0, hex(a.color, .30 + .18 * pulse)); gr.addColorStop(1, hex(a.color, 0)); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, s * 1.15, 0, 7); g.fill();
      if (!REDUCED_MOTION && dt < .6) { g.strokeStyle = hex(a.color, Math.exp(-dt * 4) * .55); g.lineWidth = 3 * k * 3; g.beginPath(); g.arc(0, 0, s * (.3 + .7 * (1 - Math.exp(-dt * 5))), 0, 7); g.stroke(); } g.restore();
      g.fillStyle = 'rgba(147,164,186,.9)'; g.font = `${13 * this.r}px system-ui`; g.textAlign = 'center'; if (a.label) g.fillText(a.label, c[0], c[1] + 26 * this.r);
      if (a.kind === 'arm') this._arm(g, a, frame, yaw, k, o); else this._body(g, a, frame, yaw, k, o); }
  }
  _body(g, a, f, yaw, k, o) {
    const nj = J, base = f * nj * 3, q = []; for (let j = 0; j < nj; j++) q.push(this.proj([a.pos[base + j*3], a.pos[base + j*3 + 1], a.pos[base + j*3 + 2]], a.ox, yaw));
    g.lineCap = 'round'; g.lineJoin = 'round';
    const THK = { '0,1': 11, '1,2': 13, '2,3': 6, '3,4': 4, '2,5': 8, '2,8': 8, '0,11': 9, '0,15': 9 }, sc = a.scale || 1, s = this.H * .40 * (this.zoom || 1);
    const bones = E.BONES.slice().sort((p, r) => q[r[0]][2] - q[p[0]][2]);
    if (a.ghost && o.ghost) { const gb = f * nj * 3, gq = []; for (let j = 0; j < nj; j++) gq.push(this.proj([a.ghost[gb + j*3], a.ghost[gb + j*3 + 1], a.ghost[gb + j*3 + 2]], a.ox, yaw));
      g.strokeStyle = hex('#ffffff', .30); g.setLineDash([6 * k, 6 * k]); g.lineWidth = 3 * k; for (const [p, r] of E.BONES) { g.beginPath(); g.moveTo(gq[p][0], gq[p][1]); g.lineTo(gq[r][0], gq[r][1]); g.stroke(); } g.setLineDash([]); }
    for (const [p, r] of bones) { g.strokeStyle = a.color; g.lineWidth = (THK[p + ',' + r] || 6) * (.85 + .25 * sc) * k; g.beginPath(); g.moveTo(q[p][0], q[p][1]); g.lineTo(q[r][0], q[r][1]); g.stroke(); }
    g.fillStyle = a.color; g.beginPath(); g.arc(q[4][0], q[4][1] - .07 * s * sc, .095 * s * sc, 0, 7); g.fill();
    if (a.id !== 'human') for (let j = 0; j < nj; j++) { if (j === 14 || j === 18 || j === 4) continue; g.fillStyle = '#0c1626'; g.beginPath(); g.arc(q[j][0], q[j][1], 4.4 * k, 0, 7); g.fill(); g.strokeStyle = a.color; g.lineWidth = 1.4 * k; g.stroke(); }
    if (a.lim && o.hits) for (let j = 1; j < nj; j++) { const L = a.lim[f * nj + j], R = a.rate ? a.rate[f * nj + j] : 0; if (L || R) { g.strokeStyle = L ? C.gap : C.amber; g.lineWidth = (L ? 3.2 : 2.4) * k; g.beginPath(); g.arc(q[j][0], q[j][1], (L ? 11 : 9.5) * k, 0, 7); g.stroke(); } }
    if (o.bal && a.margins) { const cm = E.comOf(a.pos, f), c2 = this.proj([cm[0], 0, cm[2]], a.ox, yaw); g.fillStyle = a.margins[f] >= 0 ? C.ok : C.gap; g.beginPath(); g.arc(c2[0], c2[1], 6 * k, 0, 7); g.fill(); }
    if (a.id !== 'human' && o.pick) q.forEach((p, j) => { if (j && j !== 14 && j !== 18) this.hit.push({ id: a.id, j, x: p[0], y: p[1] }); });
  }
  _arm(g, a, f, yaw, k, o) {
    const q = []; for (let j = 0; j < 4; j++) q.push(this.proj([a.pos[f*12 + j*3], a.pos[f*12 + j*3 + 1], a.pos[f*12 + j*3 + 2]], a.ox, yaw)); g.lineCap = 'round';
    g.strokeStyle = '#6b7b90'; g.lineWidth = 16 * k; g.beginPath(); g.moveTo(q[0][0], q[0][1]); g.lineTo(q[1][0], q[1][1]); g.stroke();
    if (a.tgt && o.ghost) { const t = this.proj([a.tgt[f*3], a.tgt[f*3+1], a.tgt[f*3+2]], a.ox, yaw); g.strokeStyle = hex('#ffffff', .55); g.setLineDash([5 * k, 5 * k]); g.lineWidth = 2 * k; g.beginPath(); g.arc(t[0], t[1], 11 * k, 0, 7); g.stroke(); g.setLineDash([]);
      if (Math.hypot(t[0] - q[3][0], t[1] - q[3][1]) > 14 * k) { g.strokeStyle = C.gap; g.lineWidth = 2 * k; g.beginPath(); g.moveTo(q[3][0], q[3][1]); g.lineTo(t[0], t[1]); g.stroke(); } }
    g.strokeStyle = a.color; g.lineWidth = 13 * k; g.beginPath(); g.moveTo(q[1][0], q[1][1]); g.lineTo(q[2][0], q[2][1]); g.stroke(); g.lineWidth = 10 * k; g.beginPath(); g.moveTo(q[2][0], q[2][1]); g.lineTo(q[3][0], q[3][1]); g.stroke();
    for (const j of [1, 2]) { g.fillStyle = '#0c1626'; g.beginPath(); g.arc(q[j][0], q[j][1], 8 * k, 0, 7); g.fill(); g.strokeStyle = a.color; g.lineWidth = 2 * k; g.stroke(); }
    g.fillStyle = a.color; g.beginPath(); g.arc(q[3][0], q[3][1], 7 * k, 0, 7); g.fill();
    if (a.lim && o.hits && (a.lim[f] || (a.reach && a.reach[f]) || (a.rate && a.rate[f]))) { g.strokeStyle = (a.lim[f] || (a.reach && a.reach[f])) ? C.gap : C.amber; g.lineWidth = 3 * k; for (const j of [1, 2]) { g.beginPath(); g.arc(q[j][0], q[j][1], 12 * k, 0, 7); g.stroke(); } }
    if (o.pick) [1, 2].forEach(j => this.hit.push({ id: 'arm', j, x: q[j][0], y: q[j][1] }));
  }
}
function fitCanvas(c, cssH) { const r = Math.min(window.devicePixelRatio || 1, 2), b = c.getBoundingClientRect(), w = Math.round((b.width || 600) * r), h = Math.round((cssH || b.height || 120) * r); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } return r; }


function renderCounts(boxId, leg, count) { const box = $(boxId); const labels = E.COUNTS[leg]; if (!labels) { box.hidden = true; return; } box.hidden = false;
  if (box.dataset.leg !== leg) { box.dataset.leg = leg; box.innerHTML = labels.map(l => `<div>${l}</div>`).join(''); box.dataset.on = ''; }
  if (box.dataset.on !== String(count)) { box.dataset.on = String(count); [...box.children].forEach((c, i) => c.classList.toggle('on', i === count)); } }
// ================================================================== studio: compute everything for the current prompt
function sequenceFor(beats) { const nph = Math.floor((beats.length - 1) / 8); return E.toSequence(S.phrases.length ? S.phrases : [{ leg: 'idle', arm: 'none', e: .5 }], nph); }
function compute() {
  const B = SONGS[S.song]; S.mot = E.generate(B.beats, 32, sequenceFor(B.beats), { jitter: .03 });
  const emb = { humanoid: E.humanoidFull(.77, S.speed), reduced: E.humanoidReduced(.77, S.speed), custom: E.customRobot(S.custom) };
  S.rob = {}; S.ev = {}; S.ex = {}; S.ghost = {};
  for (const k of Object.keys(emb)) { const r = E.retargetHumanoid(S.mot, emb[k]); S.rob[k] = r; S.ev[k] = E.evaluate(S.mot, r, B.beats); S.ex[k] = E.explain(S.mot, r);
    const gp = new Float64Array(S.mot.pos.length); for (let i = 0; i < gp.length; i++) gp[i] = S.mot.pos[i] * r.scale; S.ghost[k] = gp; }
  S.arm = E.retargetArm(S.mot, S.mot.pos, S.speed); S.ev.arm = E.evaluate(S.mot, S.arm, B.beats); S.ev.human = E.humanMetrics(S.mot, B.beats);
  buildStrips(); pickDefaultSelection();
}
function groupRows(r) { const G = [['Head', [3, 4]], ['Torso', [1, 2]], ['Left arm', [5, 6, 7]], ['Right arm', [8, 9, 10]], ['Left leg', [11, 12, 13, 14]], ['Right leg', [15, 16, 17, 18]]], T = S.mot.T;
  return G.map(([name, js]) => { const lim = new Uint8Array(T), rate = new Uint8Array(T); for (let t = 0; t < T; t++) for (const j of js) { if (r.lim[t*J + j]) lim[t] = 1; if (r.rate[t*J + j]) rate[t] = 1; } return { name, lim, rate }; }); }
function buildStrips() { S.strips = {}; for (const k of ['humanoid', 'reduced', 'custom']) S.strips[k] = groupRows(S.rob[k]); S.strips.arm = [{ name: 'Arm joints', lim: S.arm.lim.map((v, t) => v | S.arm.reach[t]), rate: S.arm.rate }]; }
function pickDefaultSelection() { const b = S.body; if (b === 'arm') { S.sel = { j: 2, a: 2 }; return; } const ex = S.ex[b]; if (ex && ex.length) S.sel = { j: ex[0].joint, a: ex[0].axis }; else if (!S.sel || S.selBody !== b) S.sel = { j: IDX('rsho'), a: 2 }; S.selBody = b; }

function scoreOf(b) { return E.danceScore(S.ev[b], S.ev.human); }
function coachText(b) { const ev = S.ev[b], hu = S.ev.human, ex = S.ex[b] || [], out = [];
  if (b === 'arm') { out.push('The arm follows your right wrist and nothing else: legs, torso, head and left arm are discarded.');
    if (ev.lostFrames > .25) out.push(`It also cannot fold its hand in close to its own base, so near-the-body moves are missed on ${pct(ev.lostFrames)} of frames.`); }
  else { if (ev.fidelity >= .97) out.push('Clean. This body can do everything you asked.'); else if (ex[0]) { const w = ex[0]; out.push(w.locked ? `Biggest loss: ${w.label.toLowerCase()} ${w.motion}. This body has no such joint.` : `Biggest loss: ${w.label.toLowerCase()} ${w.motion}. You asked for ${Math.round(w.needDeg)}°; this body stops at ${Math.round(w.limDeg)}°.`); } else out.push('Small differences only.');
    if (ev.stability < .9) out.push(`Balance: its weight leaves its feet on ${pct(1 - ev.stability)} of frames${hu.stability < .9 ? ' (the human does too, so this check is strict)' : ''}.`); }
  if (ev.beatLock < hu.beatLock - .15) out.push('Its motors are too slow to hit every beat.'); return out.join(' '); }

function renderRight() {
  const b = S.body, ev = S.ev[b], sc = scoreOf(b); $('scTitle').textContent = NAMES[b]; $('scBig').textContent = sc.score; $('scStars').textContent = '★'.repeat(sc.stars) + '☆'.repeat(3 - sc.stars);
  const m = (l, v, note) => `<div class="meter"><div class="l"><span>${l}</span><b>${pct(v)}</b></div><div class="t"><div style="width:${100 * v}%;background:${C[b]}"></div></div>${note ? `<div class="small muted">${note}</div>` : ''}</div>`;
  $('meters').innerHTML = m(b === 'arm' ? 'Visible fidelity (wrist only)' : 'Visible fidelity', ev.fidelity, '') + m('Beat lock', ev.beatLock, `the human dancer: ${pct(S.ev.human.beatLock)}`) + (b === 'arm' ? m('Target reached', 1 - ev.lostFrames, '') : m('Balance check', ev.stability, `the human dancer: ${pct(S.ev.human.stability)}`));
  $('coach').textContent = coachText(b); $('coach').style.borderColor = C[b];
  const w = $('whys'); w.innerHTML = '';
  if (b === 'arm') { w.innerHTML = '<div class="small muted">The arm has three joints (base turn, shoulder, elbow). Click a joint on the arm to see its angle and its limits.</div>'; return; }
  const ex = S.ex[b].slice(0, 5); if (!ex.length) { w.innerHTML = '<div class="small muted">Nothing held this body back. Try “hands in the air”.</div>'; return; }
  ex.forEach(r => { const bt = document.createElement('button'); bt.className = 'why'; bt.setAttribute('aria-pressed', S.sel.j === r.joint && S.sel.a === r.axis);
    const key = E.jointInfo(r.joint).key + ':' + r.axis; bt.innerHTML = `<b>${r.label} ${r.motion}</b> <span class="tag">${pct(r.frames)} of frames</span><div>${r.locked ? 'This body has no such joint.' : `Asked for ${Math.round(r.needDeg)}°, stops at ${Math.round(r.limDeg)}°.`}</div><div class="small muted">${WHY[key] || ''}</div>`;
    bt.onclick = () => { select(r.joint, r.axis, true); }; w.appendChild(bt); });
}
function renderHeard() { const h = $('heard'); let html = '';
  if (S.phrases.length) { html += '<div class="small muted" style="margin-bottom:4px">What I heard (8 beats each):</div>'; S.phrases.slice(0, 6).forEach((p, i) => { html += `<div class="phr"><span class="n">${i * 8 + 1}–${i * 8 + 8}</span><span><b>${p.leg === 'idle' ? '' : LEGN[p.leg]}${p.leg !== 'idle' && p.arm !== 'none' ? ' + ' : ''}${p.arm === 'none' ? (p.leg === 'idle' ? 'standing' : '') : ARMN[p.arm]}</b>${p.e >= 1 ? ' <i>, full energy</i>' : p.e <= .3 ? ' <i>, gentle</i>' : ''}</span></div>`; });
    html += `<div class="small muted" style="margin-top:6px">${S.phrases.length > 6 ? '…and more. ' : ''}${S.phrases.length * 8 < 8 * Math.floor((SONGS[S.song].beats.length - 1) / 8) ? 'The routine repeats until the song ends.' : ''}</div>`; }
  if (S.unknown.length) html += `<div class="small" style="margin-top:8px;color:var(--reduced)">I did not understand “${S.unknown.join('”, “')}”. I know: kick, squat, step-touch, sway, bounce, hands up, arm pump, wave, twist, head bang, lean back. Words like fast, slow, wild and gentle set the energy.</div>`;
  h.innerHTML = html; }
function renderMissions() { const M = MISSIONS, n = M.filter(m => S.done[m.id]).length; $('xp').innerHTML = `Missions <b>${n}/${M.length}</b>`;
  $('missions').innerHTML = M.map(m => `<div class="mission ${S.done[m.id] ? 'done' : ''}"><span class="ck">✓</span><div><b>${m.t}</b><span class="muted small">${m.d}</span></div></div>`).join(''); }
let toastT = 0; function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }
function complete(id) { if (S.done[id]) return; S.done[id] = true; store.done = S.done; save(); renderMissions(); const m = MISSIONS.find(x => x.id === id); toast('Mission complete: ' + m.t); }
const MISSIONS = [
  { id: 'warm', t: 'Warm-up', d: 'Choreograph a dance the full humanoid reproduces at 98% fidelity or better.', check: () => S.ev.humanoid.fidelity >= .98 },
  { id: 'break', t: 'Break the humanoid', d: 'Find a dance that drops the full humanoid below 85% fidelity.', check: () => S.ev.humanoid.fidelity < .85 },
  { id: 'dead', t: 'The arm’s dead zone', d: 'Make the robot arm miss its target on more than half the frames.', check: () => S.ev.arm.lostFrames >= .5 },
  { id: 'balance', t: 'Off balance', d: 'Make the full humanoid fail the balance check on a quarter of the frames.', check: () => S.ev.humanoid.stability <= .75 },
  { id: 'speed', t: 'Slow motors, lost groove', d: 'On Pop, set motors to 4 rad/s or less and get the humanoid under 85% fidelity.', check: () => S.song === 'pop' && S.speed <= 4 && S.ev.humanoid.fidelity < .85 },
  { id: 'learn', t: 'Fast learner', d: 'In the Dance school, make a robot improve its lesson score by 8 points or more (hint: slow its motors).' },
  { id: 'grad', t: 'Graduate', d: 'Complete all four lessons of one style with the same robot.' },
  { id: 'triple', t: 'Three styles', d: 'Graduate in salsa, cumbia and bachata.' },
  { id: 'inspect', t: 'Detective', d: 'Click a magenta joint, or a row under “What held it back”, to inspect it.' },
  { id: 'audition', t: 'Lean machine', d: 'In the Workshop, pass the audition (90% or better) within 12 points.' },
  { id: 'ears', t: 'Good ears', d: 'Score 4 out of 5 in the Listening test.' }];
function runMissions() { if (!S.userRan) return; MISSIONS.forEach(m => { if (m.check && !S.done[m.id] && m.check()) complete(m.id); }); }

// ================================================================== studio scene + UI
let stage, studioScene;
function studioActors() { const acts = [{ id: 'human', kind: 'human', color: C.human, label: 'AI human', pos: S.mot.pos, scale: 1, ox: -.85, margins: S.ev.human.margins }], b = S.body;
  if (b === 'arm') acts.push({ id: 'arm', kind: 'arm', color: C.arm, label: NAMES.arm, pos: S.arm.pos, ox: .85, tgt: S.arm.tgt, lim: S.arm.lim, rate: S.arm.rate, reach: S.arm.reach });
  else { const r = S.rob[b]; acts.push({ id: b, kind: 'humanoid', color: C[b], label: NAMES[b], pos: r.pos, scale: r.scale, ox: .85, lim: r.lim, rate: r.rate, ghost: S.ghost[b], margins: S.ev[b].margins }); } return acts; }
function makeStudioScene() { return { T: S.mot.T, song: S.song, loop: true,
  draw(f) { stage.draw(studioActors(), f, { beats: SONGS[S.song].beats, camAuto: S.camAuto, ghost: S.ghostOn, hits: S.hits, bal: S.bal, pick: true });
    { const ph = S.mot.Phi[f], leg = ph >= 0 ? S.mot.legLabel[f] : (S.phrases[0] ? S.phrases[0].leg : 'idle'); renderCounts('counts', leg, ph >= 0 ? Math.floor(((ph % 8) + 8) % 8) : -1); }
    $('scrub').value = 1000 * f / (S.mot.T - 1); $('clock').textContent = (f / FPS).toFixed(1) + ' / ' + (S.mot.T / FPS).toFixed(1) + ' s'; drawInsp(f); drawStrip(f); },
  onState(p) { $('play').textContent = p ? 'Pause' : 'Play'; } }; }
function refreshStudio(keepFrame) { const f = keepFrame ? Player.frame : 0; Player.stop(); studioScene = makeStudioScene(); Player.scene = studioScene; Player.frame = Math.min(f, S.mot.T - 1); renderRight(); renderHeard(); renderInspTabs(); studioScene.draw(Player.frame); }
function choreograph(text, autoplay) { const P = E.parsePrompt(text); S.unknown = P.unknown;
  if (!P.phrases.length) { renderHeard(); toast('I could not find any dance moves in that. Try “kick, then hands up”.'); return false; }
  S.phrases = P.phrases; S.userRan = true; compute(); refreshStudio(false); runMissions(); if (autoplay) Player.play(); return true; }

// ---- selection + inspector
function select(j, a, user) { S.sel = { j, a }; S.selBody = S.body; if (user) complete('inspect'); renderInspTabs(); renderRight(); drawInsp(Player.frame); }
function renderInspTabs() { const box = $('axtabs'); box.innerHTML = ''; const b = S.body;
  if (b === 'arm') ['Base turn', 'Shoulder', 'Elbow'].forEach((n, a) => { const bt = document.createElement('button'); bt.textContent = n; bt.setAttribute('aria-pressed', S.sel.a === a); bt.onclick = () => { S.sel = { j: a, a }; renderInspTabs(); drawInsp(Player.frame); }; box.appendChild(bt); });
  else { const info = E.jointInfo(S.sel.j); if (!info) return; info.axes.forEach((n, a) => { const bt = document.createElement('button'); bt.textContent = n; bt.setAttribute('aria-pressed', S.sel.a === a); bt.onclick = () => select(S.sel.j, a, false); box.appendChild(bt); }); } }
function drawInsp(f) { const c = $('insp'); if (!c || !S.mot) return; const r = fitCanvas(c, 150), g = c.getContext('2d'), W = c.width, H = c.height, T = S.mot.T, b = S.body; g.clearRect(0, 0, W, H);
  let human = null, robot = [], lo = -Infinity, hi = Infinity, title = '', locked = false;
  if (b === 'arm') { const a = S.sel.a; for (let t = 0; t < T; t++) robot.push(S.arm.angles[t*3 + a] * 180 / Math.PI); lo = [E.ARM.q1[0], E.ARM.q2[0], E.ARM.q3[0]][a] * 180 / Math.PI; hi = [E.ARM.q1[1], E.ARM.q2[1], E.ARM.q3[1]][a] * 180 / Math.PI; title = 'Robot arm · ' + ['base turn', 'shoulder', 'elbow'][a]; }
  else { const rb = S.rob[b], info = E.jointInfo(S.sel.j); if (!info) return; const k = S.sel.j * 3 + S.sel.a; human = []; for (let t = 0; t < T; t++) { human.push(S.mot.euler[t*N3 + k] * 180 / Math.PI); robot.push(rb.angles[t*N3 + k] * 180 / Math.PI); }
    locked = !rb.E.mask[k]; lo = rb.E.lo[k] * 180 / Math.PI; hi = rb.E.hi[k] * 180 / Math.PI; title = `${info.label} · ${info.axes[S.sel.a]}`; }
  const all = robot.concat(human || []); let mn = Math.min(...all, isFinite(lo) ? lo : 0, -20), mx = Math.max(...all, isFinite(hi) ? hi : 0, 20); const pad = (mx - mn) * .08; mn -= pad; mx += pad;
  const L = 40 * r, Rr = 6 * r, Tp = 8 * r, Bt = 16 * r, pw = W - L - Rr, ph = H - Tp - Bt, X = t => L + pw * t / (T - 1), Y = v => Tp + ph * (1 - (v - mn) / (mx - mn));
  g.font = `${10.5 * r}px system-ui`; g.fillStyle = '#62768f'; g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const v of [Math.round(mn / 10) * 10, 0, Math.round(mx / 10) * 10]) { g.fillText(v + '°', L - 4 * r, Y(v)); g.strokeStyle = 'rgba(147,164,186,.12)'; g.lineWidth = r; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(W - Rr, Y(v)); g.stroke(); }
  if (isFinite(hi)) { g.fillStyle = hex(C.gap, .13); g.fillRect(L, Tp, pw, Math.max(0, Y(hi) - Tp)); g.strokeStyle = C.gap; g.setLineDash([5 * r, 4 * r]); g.lineWidth = 1.6 * r; g.beginPath(); g.moveTo(L, Y(hi)); g.lineTo(W - Rr, Y(hi)); g.stroke(); g.setLineDash([]); }
  if (isFinite(lo)) { g.fillStyle = hex(C.gap, .13); g.fillRect(L, Y(lo), pw, Math.max(0, Tp + ph - Y(lo))); g.strokeStyle = C.gap; g.setLineDash([5 * r, 4 * r]); g.lineWidth = 1.6 * r; g.beginPath(); g.moveTo(L, Y(lo)); g.lineTo(W - Rr, Y(lo)); g.stroke(); g.setLineDash([]); }
  const line = (arr, col, w) => { g.strokeStyle = col; g.lineWidth = w * r; g.beginPath(); arr.forEach((v, t) => t ? g.lineTo(X(t), Y(v)) : g.moveTo(X(t), Y(v))); g.stroke(); };
  if (human) line(human, 'rgba(223,229,236,.85)', 1.6); line(robot, C[b], 2.4);
  g.strokeStyle = '#fff'; g.lineWidth = 1.5 * r; g.beginPath(); g.moveTo(X(f), Tp); g.lineTo(X(f), Tp + ph); g.stroke();
  $('inspTitle').innerHTML = `<b style="color:var(--ink)">${title}</b>. ${human ? '<span style="color:var(--human)">white</span> = what the human did, ' : ''}<span style="color:${C[b]}">coloured</span> = what this body did. ${locked ? '<span style="color:var(--gap)">This body has no such joint, so it stays at 0°.</span>' : isFinite(lo) || isFinite(hi) ? '<span style="color:var(--gap)">Dashed magenta</span> = its limit; the shaded area is out of range.' : ''}`; }
function drawStrip(f) { const c = $('strip'); if (!c || !S.mot) return; const r = fitCanvas(c, 104), g = c.getContext('2d'), W = c.width, H = c.height, T = S.mot.T, b = S.body; g.clearRect(0, 0, W, H);
  const rows = S.strips[b], L = 66 * r, Rr = 6 * r, Tp = 6 * r, Bt = 6 * r, pw = W - L - Rr, rh = (H - Tp - Bt) / rows.length;
  g.strokeStyle = 'rgba(147,164,186,.18)'; g.lineWidth = r; for (const bt of SONGS[S.song].beats) { const x = L + pw * bt * FPS / T; if (x > W) break; g.beginPath(); g.moveTo(x, Tp); g.lineTo(x, H - Bt); g.stroke(); }
  g.font = `${10.5 * r}px system-ui`; g.textBaseline = 'middle'; g.textAlign = 'left';
  rows.forEach((row, i) => { g.fillStyle = '#93a4ba'; g.fillText(row.name, 4 * r, Tp + rh * (i + .5)); const w = Math.max(1, pw / T + .6);
    for (let t = 0; t < T; t++) { if (row.lim[t] || row.rate[t]) { g.fillStyle = row.lim[t] ? C.gap : C.amber; g.fillRect(L + pw * t / T, Tp + rh * i + 1.5 * r, w, rh - 3 * r); } } });
  const px = L + pw * f / T; g.strokeStyle = '#fff'; g.lineWidth = 2 * r; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); }

// ================================================================== studio wiring
function buildStudioUI() {
  stage = new Stage($('stage'));
  $('bodies').innerHTML = ['humanoid', 'reduced', 'arm', 'custom'].map(b => `<button data-b="${b}" aria-pressed="${b === S.body}"><i style="background:${C[b]}"></i>${NAMES[b]}</button>`).join('');
  $('bodies').onclick = e => { const bt = e.target.closest('button'); if (!bt) return; S.body = bt.dataset.b; document.querySelectorAll('#bodies button').forEach(x => x.setAttribute('aria-pressed', x === bt)); pickDefaultSelection(); refreshStudio(true); };
  $('songs').innerHTML = SONG_IDS.map(s => `<button data-s="${s}" aria-pressed="${s === S.song}">${s[0].toUpperCase() + s.slice(1)} <span class="muted small">${Math.round(SONGS[s].tempo)} bpm</span></button>`).join('');
  $('songs').onclick = e => { const bt = e.target.closest('button'); if (!bt) return; S.song = bt.dataset.s; document.querySelectorAll('#songs button').forEach(x => x.setAttribute('aria-pressed', x === bt)); compute(); refreshStudio(false); runMissions(); };
  $('examples').innerHTML = EXAMPLES.map(t => `<button class="chip">${t}</button>`).join(''); $('examples').onclick = e => { const c = e.target.closest('.chip'); if (!c) return; $('prompt').value = c.textContent; choreograph(c.textContent, true); };
  $('go').onclick = () => choreograph($('prompt').value, true);
  $('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); choreograph($('prompt').value, true); } });
  $('surprise').onclick = () => { const L = ['kick', 'squat', 'side step', 'sway', 'bounce', 'salsa', 'bachata', 'cumbia'], A = ['hands up', 'arm pumps', 'waving arms', 'twist', 'head bang', 'lean back'], pick = a => a[Math.floor(Math.random() * a.length)], en = ['', 'wild ', 'gentle '];
    const t = [0, 1, 2].map(() => en[Math.floor(Math.random() * 3)] + pick(L) + ' with ' + pick(A)).join(', then '); $('prompt').value = t; choreograph(t, true); };
  $('speed').oninput = e => { S.speed = +e.target.value; $('speedv').textContent = S.speed + ' rad/s'; clearTimeout(S.sd); S.sd = setTimeout(() => { compute(); refreshStudio(true); runMissions(); }, 60); };
  $('play').onclick = () => Player.playing ? Player.stop() : Player.play();
  $('scrub').oninput = e => Player.seek(e.target.value / 1000 * (S.mot.T - 1));
  for (const [id, key] of [['oGhost', 'ghostOn'], ['oHits', 'hits'], ['oBal', 'bal'], ['oCam', 'camAuto']]) $(id).onchange = e => { S[key] = e.target.checked; if (!Player.playing) Player.seek(Player.frame); };
  $('tourX').onclick = () => { $('tour').style.display = 'none'; store.tour = 1; save(); }; if (store.tour) $('tour').style.display = 'none';
  const cv = $('stage'); let drag = null; cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, moved: false }; try { cv.setPointerCapture(e.pointerId); } catch (_) {} });
  cv.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 5) { drag.moved = true; S.camAuto = false; $('oCam').checked = false; cam.yaw = drag.yaw + dx * .008; cam.pitch = clamp(drag.pitch + dy * .005, -.1, .8); if (!Player.playing) Player.seek(Player.frame); } });
  cv.addEventListener('pointerup', e => { if (drag && !drag.moved) { const b = cv.getBoundingClientRect(), sx = (e.clientX - b.left) * (cv.width / (b.width || cv.width)), sy = (e.clientY - b.top) * (cv.height / (b.height || cv.height)); let best = null, bd = 28 * stage.r; for (const h of stage.hit) { const d = Math.hypot(h.x - sx, h.y - sy); if (d < bd) { bd = d; best = h; } }
      if (best) { if (best.id === 'arm') { S.sel = { j: best.j, a: best.j }; complete('inspect'); renderInspTabs(); drawInsp(Player.frame); } else { const ex = S.ex[best.id].find(r => r.joint === best.j); let a = ex ? ex.axis : 0; if (!ex) { let mx = -1; for (let q = 0; q < 3; q++) { let m = 0; for (let t = 0; t < S.mot.T; t++) m = Math.max(m, Math.abs(S.mot.euler[t*N3 + best.j*3 + q])); if (m > mx) { mx = m; a = q; } } } select(best.j, a, !!ex); } } } drag = null; });
  cv.addEventListener('dblclick', () => { cam.yaw = .38; cam.pitch = .22; S.camAuto = true; $('oCam').checked = true; if (!Player.playing) Player.seek(Player.frame); });
}

// ================================================================== workshop
let wstage, wScene, W = {};
const AUDITION = DATA.frontier.audition;
function wInit() { const B = SONGS.house, seq = { '-1': ['idle', 'none', .5] }; AUDITION.forEach((p, i) => seq[i] = p); W.mot = E.generate(B.beats, 4 * 8 * 60 / B.tempo + 1, seq, { jitter: 0 }); W.beats = B.beats; wstage = new Stage($('wstage'));
  $('groups').innerHTML = E.GROUPS.map(g => `<label class="grp"><input type="checkbox" data-g="${g.id}"><div><b>${g.name}</b><div>${g.hint}</div></div><span class="c">${g.cost}</span></label>`).join('');
  $('motors').innerHTML = E.SPEEDS.map(s => `<button data-v="${s.v}" aria-pressed="false">${s.name} <span class="muted small">${s.cost ? '+' + s.cost : 'free'}</span></button>`).join('');
  $('groups').onchange = e => { const id = e.target.dataset.g; if (!id) return; S.custom.groups[id] = e.target.checked ? 1 : 0; if (!S.custom.groups.shRoll) S.custom.shoulderWide = 0; wUpdate(); };
  $('wide').onchange = e => { S.custom.shoulderWide = e.target.checked ? 1 : 0; wUpdate(); };
  $('motors').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.custom.vmax = +b.dataset.v; wUpdate(); };
  document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { const p = b.dataset.preset, G = {}; E.GROUPS.forEach(g => G[g.id] = 0);
    if (p === 'g1') { E.GROUPS.forEach(g => G[g.id] = 1); S.custom = { groups: G, shoulderWide: 0, vmax: 8 }; } else if (p === 'cheap') { ['shPitch', 'shRoll', 'elbow', 'hipPitch', 'hipRoll', 'knee', 'anklePitch'].forEach(k => G[k] = 1); S.custom = { groups: G, shoulderWide: 0, vmax: 8 }; } else S.custom = { groups: G, shoulderWide: 0, vmax: 4 }; wUpdate(); });
  $('wplay').onclick = () => Player.playing ? Player.stop() : Player.play(); $('wscrub').oninput = e => Player.seek(e.target.value / 1000 * (W.mot.T - 1));
  $('wreveal').onclick = wReveal; wScene = { T: W.mot.T, song: 'house', loop: true, draw: f => wDraw(f), onState: p => $('wplay').textContent = p ? 'Pause' : 'Play' }; }
function wUpdate() { const cfg = S.custom; $('groups').querySelectorAll('input').forEach(i => i.checked = !!cfg.groups[i.dataset.g]); $('wide').checked = !!cfg.shoulderWide; $('wide').disabled = !cfg.groups.shRoll;
  $('motors').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.v === cfg.vmax));
  const cost = E.robotCost(cfg); $('wcost').textContent = cost + ' / 12'; $('budget').classList.toggle('over', cost > 12); $('budget').firstElementChild.style.width = Math.min(100, 100 * cost / 12) + '%';
  W.rob = E.retargetHumanoid(W.mot, E.customRobot(cfg)); W.ev = E.evaluate(W.mot, W.rob, W.beats); W.ex = E.explain(W.mot, W.rob); W.ghost = new Float64Array(W.mot.pos.length); for (let i = 0; i < W.ghost.length; i++) W.ghost[i] = W.mot.pos[i] * W.rob.scale; W.cost = cost;
  $('wfid').textContent = pct(W.ev.fidelity); const v = $('wverdict'); if (cost > 12) v.innerHTML = `<span style="color:var(--gap)">Over budget by ${cost - 12}. Remove something.</span>`; else if (W.ev.fidelity >= .90) { v.innerHTML = `<span style="color:var(--ok)">Audition passed with ${12 - cost} point${12 - cost === 1 ? '' : 's'} to spare.</span>`; complete('audition'); }
  else { const w = W.ex[0]; v.textContent = w ? `Not yet. Biggest loss: ${w.label.toLowerCase()} ${w.motion}${w.locked ? ' (no such joint).' : '.'}` : 'Not yet.'; }
  if (S.rob.custom) { /* keep studio's “Your robot” in sync */ compute(); if (studioScene) { renderRight(); } }
  drawFront(); if (!Player.playing || Player.scene !== wScene) { if (Player.scene === wScene) wDraw(Player.frame); } }
function wDraw(f) { wstage.draw([{ id: 'human', kind: 'human', color: C.human, label: 'AI human', pos: W.mot.pos, scale: 1, ox: -.85 }, { id: 'custom', kind: 'humanoid', color: C.custom, label: 'Your robot', pos: W.rob.pos, scale: W.rob.scale, ox: .85, lim: W.rob.lim, rate: W.rob.rate, ghost: W.ghost }], f, { beats: W.beats, camAuto: true, ghost: true, hits: true });
  $('wscrub').value = 1000 * f / (W.mot.T - 1); $('wclock').textContent = (f / FPS).toFixed(1) + ' s'; }
function drawFront() { const c = $('front'), r = fitCanvas(c, c.getBoundingClientRect().height || 220), g = c.getContext('2d'), Wd = c.width, H = c.height, F = DATA.frontier.frontier; g.clearRect(0, 0, Wd, H);
  const L = 44 * r, R = 14 * r, Tp = 14 * r, Bt = 42 * r, pw = Wd - L - R, ph = H - Tp - Bt, X = v => L + pw * v / 22, Y = v => Tp + ph * (1 - (v - .1) / .95);
  g.font = `${11 * r}px system-ui`; g.fillStyle = '#62768f'; g.textAlign = 'right'; g.textBaseline = 'middle'; for (const v of [.2, .4, .6, .8, 1]) { g.fillText(Math.round(v * 100) + '%', L - 6 * r, Y(v)); g.strokeStyle = 'rgba(147,164,186,.12)'; g.lineWidth = r; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(Wd - R, Y(v)); g.stroke(); }
  g.textAlign = 'center'; g.textBaseline = 'top'; for (let v = 0; v <= 22; v += 4) g.fillText(v, X(v), Tp + ph + 6 * r); g.fillText('points spent', L + pw / 2, Tp + ph + 18 * r);
  g.strokeStyle = hex(C.gap, .7); g.setLineDash([5 * r, 4 * r]); g.beginPath(); g.moveTo(X(12), Tp); g.lineTo(X(12), Tp + ph); g.stroke(); g.setLineDash([]); g.fillStyle = C.gap; g.textAlign = 'left'; g.fillText('budget', X(12) + 4 * r, Tp);
  g.strokeStyle = C.humanoid; g.lineWidth = 2.5 * r; g.beginPath(); F.forEach((p, i) => { i ? g.lineTo(X(p.cost), Y(p.fid)) : g.moveTo(X(p.cost), Y(p.fid)); }); g.stroke();
  const dot = (cost, fid, col, label, dy) => { g.fillStyle = col; g.beginPath(); g.arc(X(cost), Y(fid), 6 * r, 0, 7); g.fill(); g.fillStyle = '#e8edf4'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(label, X(cost) + 10 * r, Y(fid) + (dy || 0) * r); };
  dot(DATA.frontier.g1.cost, DATA.frontier.g1.fid, C.reduced, 'G1-style, all joints', 16); if (W.ev) dot(W.cost, W.ev.fidelity, C.custom, 'your build', -14); if (W.revealed) dot(W.revealed.cost, W.revealed.fid, C.ok, 'best at this price', 14); }
function wReveal() { const F = DATA.frontier.frontier.filter(p => p.cost <= 12).pop(); W.revealed = F; const on = E.GROUPS.filter(g => F.cfg.groups[g.id]).map(g => g.name.toLowerCase());
  $('fnote').innerHTML = `The best build for 12 points scores <b>${pct(F.fid)}</b>: ${on.join(', ')}${F.cfg.shoulderWide ? ', extra-wide shoulder raise' : ''}, ${E.SPEEDS.find(s => s.v === F.cfg.vmax).name.toLowerCase()}. The G1-style build with every joint costs ${DATA.frontier.g1.cost} and scores ${pct(DATA.frontier.g1.fid)}: <b>more joints are not the same as a better dancer</b>; the right joint with enough range is. <button class="btn" id="wload" style="padding:3px 10px;margin-left:6px">Load this build</button>`;
  $('wload').onclick = () => { S.custom = JSON.parse(JSON.stringify(F.cfg)); wUpdate(); }; drawFront(); }

// ================================================================== listening test
let lstage, L = { round: 0, score: 0, tally: {}, cur: null, answered: true };
function lInit() { lstage = new Stage($('lstage')); $('lstart').onclick = lNext; $('lplay').onclick = () => { if (L.cur) { Player.stop(); Player.frame = 0; Player.play(); } };
  $('ans').onclick = e => { const b = e.target.closest('button'); if (!b || L.answered) return; lAnswer(b.dataset.a === '1'); }; }
function lNext() { if (L.round >= 5) { L = { round: 0, score: 0, tally: {}, cur: null, answered: true }; $('lres').textContent = 'Five rounds. Score 4 or more to complete the mission.'; }
  const songs = SONG_IDS, song = songs[Math.floor(Math.random() * 3)], body = ['human', 'humanoid', 'reduced', 'arm'][(L.round + Math.floor(Math.random() * 4)) % 4], matched = Math.random() < .5, other = songs.filter(s => s !== song)[Math.floor(Math.random() * 2)];
  const legs = ['bounce', 'sway', 'step_touch', 'squat_pulse', 'kick'], arms = ['arm_pump', 'arm_wave', 'arms_up', 'torso_twist', 'head_bang'], pick = a => a[Math.floor(Math.random() * a.length)];
  const ph = [0, 1].map(() => ({ leg: pick(legs), arm: pick(arms), e: .8 })), B = SONGS[song], seq = E.toSequence(ph, Math.floor((B.beats.length - 1) / 8)), mot = E.generate(B.beats, 32, seq, { jitter: .03 });
  let pos, scale = 1, kind = 'humanoid'; if (body === 'human') pos = mot.pos; else if (body === 'arm') { const a = E.retargetArm(mot, mot.pos, 8); pos = a.pos; kind = 'arm'; } else { const r = E.retargetHumanoid(mot, body === 'humanoid' ? E.humanoidFull() : E.humanoidReduced()); pos = r.pos; scale = r.scale; }
  const off = Math.round(B.beats[0] * FPS), T = 8 * FPS; L.cur = { song, body, matched, other, kind }; L.answered = false; L.round++;
  const scene = { T, song: matched ? song : other, offset: off, loop: false, draw: f => { lstage.draw([{ id: body, kind, color: C.neutral, label: '', pos, scale, ox: 0 }], f + off, { beats: [], camAuto: true }); $('lclock').textContent = `Round ${L.round} of 5 · ${(f / FPS).toFixed(1)} s`; }, onState: p => { }, onEnd: () => { } };
  L.scene = scene; Player.load(scene); Player.play(); $('ans').hidden = false; $('lmsg').style.display = 'none'; $('lbody').innerHTML = `<div class="muted small">Round ${L.round} of 5. Watch, listen, then answer.</div>`; $('lstart').style.display = 'none'; }
function lAnswer(says) { const c = L.cur, ok = says === c.matched; L.answered = true; if (ok) L.score++; const t = L.tally[c.body] = L.tally[c.body] || [0, 0]; t[1]++; if (ok) t[0]++;
  const msg = $('lmsg'); msg.style.display = 'block'; msg.style.borderColor = ok ? C.ok : C.gap;
  msg.innerHTML = `<b>${ok ? 'Correct.' : 'Not this time.'}</b> ${c.matched ? 'The music was the one this dance was built to.' : `The music was swapped: this ${Math.round(SONGS[c.song].tempo)} bpm dance was playing over a ${Math.round(SONGS[c.other].tempo)} bpm song.`} The dancer was the <b style="color:${C[c.body === 'human' ? 'human' : c.body]}">${NAMES[c.body].toLowerCase()}</b>.`;
  $('lstart').style.display = ''; $('lstart').textContent = L.round >= 5 ? 'Play again' : 'Next round'; $('ans').hidden = true; Player.stop();
  if (L.round >= 5) { const rows = Object.entries(L.tally).map(([b, [a, n]]) => `${NAMES[b]}: ${a}/${n}`).join(' · '); $('lres').innerHTML = `<b style="color:var(--ink)">${L.score} / 5 correct.</b> ${rows}.<br>In the real study this control checks that viewers can perceive the music-to-dance link at all; ratings are on 1–7 scales rather than yes/no. Small samples like yours say nothing about people in general.`; if (L.score >= 4) complete('ears'); } else $('lres').textContent = `${L.score} correct so far.`; }


// ================================================================== dance school
const SCH = { style: 'salsa', body: 'humanoid', speed: 3, lesson: 3, store: {}, L: null, after: null, afterTheta: null, hist: [], training: false, scene: null };
const PRMN = { step: 'Step length', lift: 'Foot lift', hip: 'Hip movement', arm: 'Arm height' };
let sstage;
function schKey() { return [SCH.style, SCH.body, SCH.speed, SCH.body === 'custom' ? JSON.stringify(S.custom) : ''].join('|'); }
function schState() { const k = schKey(); return SCH.store[k] || (SCH.store[k] = { results: [null, null, null, null] }); }
function schBody() { const sp = SCH.speed; if (SCH.body === 'arm') return { kind: 'arm', emb: { vmax: sp } }; if (SCH.body === 'reduced') return { kind: 'h', emb: E.humanoidReduced(.77, sp) }; if (SCH.body === 'custom') return { kind: 'h', emb: E.customRobot(S.custom) }; return { kind: 'h', emb: E.humanoidFull(.77, sp) }; }
function startTheta() { const st = schState(); for (let i = SCH.lesson - 1; i >= 0; i--) if (st.results[i]) return Object.assign({}, st.results[i].theta); return Object.assign({}, E.TEACHER); }
function schBuild() {
  const st = schState(), b = schBody(), lesson = E.LESSONS[SCH.lesson], res = st.results[SCH.lesson];
  const L = E.makeLearner({ style: SCH.style, kind: b.kind, emb: b.emb, lesson, beats: SONGS[SCH.style].beats, theta: startTheta(), trials: 24, seed: 100 + SCH.lesson * 7 + SCH.speed });
  SCH.L = L; SCH.after = res ? L.run(res.theta) : L.cur; SCH.afterTheta = res ? res.theta : L.theta; SCH.hist = res ? res.history : [L.start];
  SCH.scene = { T: L.teacherMot.T, song: SCH.style, loop: true, audioStart: L.clip.audioStart, rate: L.clip.rate, draw: f => schDraw(f), onState: p => { $('splay').textContent = p ? 'Pause' : 'Play'; } };
  if ($('tab-school').classList.contains('on')) Player.load(SCH.scene);
  schRender();
}
function schActors() {
  const L = SCH.L, robot = (r, label, ox, color) => SCH.body === 'arm' ? { id: 'arm', kind: 'arm', color, label, pos: r.pos, ox, tgt: r.tgt, lim: r.lim, rate: r.rate, reach: r.reach } : { id: SCH.body, kind: 'humanoid', color, label, pos: r.pos, scale: r.scale, ox, lim: r.lim, rate: r.rate };
  const col = C[SCH.body === 'humanoid' ? 'humanoid' : SCH.body];
  return [{ id: 'human', kind: 'human', color: C.human, label: 'Teacher', pos: L.teacherMot.pos, scale: 1, ox: -1.35 }, robot(L.before.r, 'Before learning', 0, hex(col, .75) && col), robot(SCH.after.r, SCH.L.i || schState().results[SCH.lesson] ? 'After learning' : 'Not trained yet', 1.35, C.ok)];
}
function schDraw(f) {
  const L = SCH.L; sstage.draw(schActors(), f, { beats: L.clip.beats, camAuto: false, ghost: false, hits: true, zoom: .8 });
  $('sscrub').value = 1000 * f / (L.teacherMot.T - 1); $('sclock').textContent = (f / FPS * L.clip.rate).toFixed(1) + ' s of song';
  const ph = L.teacherMot.Phi[f], leg = ph >= 0 ? L.teacherMot.legLabel[f] : E.STYLES[SCH.style].legs[0]; renderCounts('sCounts', leg, ph >= 0 ? Math.floor(((ph % 8) + 8) % 8) : -1);
}
function pctS(x) { return Math.round(100 * x) + '%'; }
function schSentence() {
  const L = SCH.L, st = schState(), res = st.results[SCH.lesson]; if (!res) return SCH.training ? 'Practising…' : 'Press “Train the robot”. It will try 24 small variations of its own style and keep whatever scores better.';
  const th = res.theta, ch = [];
  for (const k of L.lesson.train) { const d = th[k] - 1; if (Math.abs(d) >= .1) ch.push({ step: d < 0 ? `shortened its steps to ${pctS(th.step)} of the teacher’s` : `lengthened its steps to ${pctS(th.step)}`, lift: d < 0 ? `lifted its feet only ${pctS(th.lift)} as high` : `lifted its feet ${pctS(th.lift)} as high`, hip: d < 0 ? `reduced its hip movement to ${pctS(th.hip)}` : `exaggerated its hips to ${pctS(th.hip)}`, arm: d < 0 ? `lowered its arms to ${pctS(th.arm)}` : `raised its arms to ${pctS(th.arm)}` }[k]); }
  if (!ch.length) return res.before >= 97 ? `Nothing to learn here: this body already performs the lesson almost perfectly (${res.before}). Try slowing the motors.` : `It found no change that helped (${res.before} → ${res.after}). Some limits cannot be learned around.${SCH.body === 'arm' ? ' The arm has no legs, so it can only copy the wrist; learning cannot add joints.' : ''}`;
  let t = `It ${ch.join(' and ')}.`; if (res.ev0.timingMs != null && res.ev0.timingMs > 8) t += ` Its steps landed ${Math.round(res.ev0.timingMs)} ms late; now ${Math.round(res.ev1.timingMs)} ms.`;
  if (res.ev1.fidelity < res.ev0.fidelity - .005) t += ` It gave up some accuracy (${pctS(res.ev0.fidelity)} → ${pctS(res.ev1.fidelity)}) to keep the beat.`; return t;
}
function schRender() {
  const L = SCH.L, st = schState(), res = st.results[SCH.lesson], lesson = L.lesson, b = SCH.body;
  $('sTitle').textContent = `Lesson ${lesson.id}: ${lesson.name}`; $('sBefore').textContent = L.before.sc.score; $('sAfter').textContent = (res || SCH.L.i) ? SCH.after.sc.score : '–'; const sc = SCH.after.sc;
  $('sStars').textContent = (res || SCH.L.i) ? '★'.repeat(sc.stars) + '☆'.repeat(3 - sc.stars) : '';
  const e0 = L.before.ev, e1 = SCH.after.ev, show = !!(res || SCH.L.i), row = (n, a, c) => `<div>${n}</div><b>${pctS(a)}${show ? ' → ' + pctS(c) : ''}</b>`;
  $('sCmp').innerHTML = '<div class="cmp">' + (b === 'arm' ? row('Wrist accuracy', e0.fidelity, e1.fidelity) : row('Accuracy: where hands and feet end up', e0.fidelity, e1.fidelity) + row('Timing: steps land on the beat', e0.timing, e1.timing) + row('Balance (relative to teacher)', Math.min(1, e0.stability / Math.max(.2, L.hu.stability)), Math.min(1, e1.stability / Math.max(.2, L.hu.stability)))) + '</div>';
  $('sPrm').innerHTML = Object.keys(PRMN).map(k => { const on = lesson.train.indexOf(k) >= 0 && !(k === 'hip' && !lesson.hip) && !(k === 'arm' && !lesson.arms), v = SCH.afterTheta[k]; return `<div class="prm" style="${on ? '' : 'opacity:.4'}"><span>${PRMN[k]}</span><div class="bar"><i style="width:${100 * Math.min(1, v / 1.3)}%;background:${on ? C.ok : C.dim || '#62768f'}"></i></div><b>${on ? pctS(v) : 'not used yet'}</b></div>`; }).join('') + '<div class="small muted">100% = exactly as the teacher does it. Practice is random, so another run can find a different fix.</div>';
  $('sLearned').textContent = schSentence(); $('sLearned').style.borderColor = C.ok;
  $('sStatus').textContent = SCH.training ? `trial ${SCH.L.i} of ${SCH.L.trials}` : (res ? 'trained' : 'untrained');
  $('sNote').textContent = `${lesson.about} ${lesson.rate < 1 ? 'Played at ' + Math.round(lesson.rate * 100) + '% speed, like slow practice.' : 'Played at the song’s real tempo (' + Math.round(SONGS[SCH.style].tempo) + ' bpm).'} Counts above: ${E.COUNTS[E.STYLES[SCH.style].legs[0]].join(' · ')}.`;
  $('sLessons').innerHTML = E.LESSONS.map((l, i) => { const r = st.results[i]; return `<button class="lesson ${r ? 'done' : ''}" data-l="${i}" aria-pressed="${i === SCH.lesson}"><span class="n">${r ? '✓' : l.id}</span><span><b>${l.name}</b><div class="small muted">${l.about}</div></span><span class="r">${r ? r.before + ' → ' + r.after : ''}</span></button>`; }).join('');
  $('sReport').innerHTML = `<div class="muted" style="margin-bottom:6px">${E.STYLES[SCH.style].name}, ${NAMES[b === 'humanoid' ? 'humanoid' : b]}, motors ${b === 'custom' ? 'from your Workshop build' : SCH.speed + ' rad/s'}</div>` + E.LESSONS.map((l, i) => { const r = st.results[i]; return `<div class="cmp"><div>${l.id}. ${l.name}</div><b>${r ? r.before + ' → ' + r.after : '–'}</b></div>`; }).join('');
  drawCurve();
}
function drawCurve() {
  const c = $('sCurve'), r = fitCanvas(c, 140), g = c.getContext('2d'), W = c.width, H = c.height, h = SCH.hist, L = SCH.L; g.clearRect(0, 0, W, H);
  const lo0 = Math.min(...h, L.before.sc.score), mn = Math.max(0, Math.floor((lo0 - 6) / 10) * 10), mx = 100, Lm = 34 * r, Rm = 8 * r, Tp = 8 * r, Bt = 20 * r, pw = W - Lm - Rm, ph = H - Tp - Bt, X = i => Lm + pw * i / L.trials, Y = v => Tp + ph * (1 - (v - mn) / (mx - mn));
  g.font = `${10.5 * r}px system-ui`; g.fillStyle = '#62768f'; g.textAlign = 'right'; g.textBaseline = 'middle'; for (let v = mn; v <= mx; v += 10) { g.fillText(v, Lm - 5 * r, Y(v)); g.strokeStyle = 'rgba(147,164,186,.12)'; g.lineWidth = r; g.beginPath(); g.moveTo(Lm, Y(v)); g.lineTo(W - Rm, Y(v)); g.stroke(); }
  g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText('practice trials', Lm + pw / 2, Tp + ph + 6 * r);
  g.strokeStyle = '#62768f'; g.setLineDash([4 * r, 4 * r]); g.beginPath(); g.moveTo(Lm, Y(L.before.sc.score)); g.lineTo(W - Rm, Y(L.before.sc.score)); g.stroke(); g.setLineDash([]); g.fillStyle = '#62768f'; g.textAlign = 'left'; g.fillText('untrained', Lm + 4 * r, Y(L.before.sc.score) - 12 * r);
  g.strokeStyle = C.ok; g.lineWidth = 2.5 * r; g.beginPath(); h.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.stroke(); if (h.length) { g.fillStyle = C.ok; g.beginPath(); g.arc(X(h.length - 1), Y(h[h.length - 1]), 4.5 * r, 0, 7); g.fill(); }
}
function schTrain() {
  if (SCH.training) return; const L = SCH.L; SCH.training = true; $('sTrain').disabled = true; SCH.hist = [L.start]; SCH.L.i = 0; SCH.L.done = false; L.history = [L.start]; L.theta = startTheta(); L.cur = L.run(L.theta); schRender();
  const tick = () => { for (let k = 0; k < 2 && !L.done; k++) L.step(); SCH.hist = L.history.slice(); SCH.afterTheta = L.theta; SCH.after = L.cur; schRender(); if (Player.scene === SCH.scene && !Player.playing) Player.seek(Player.frame);
    if (!L.done) { setTimeout(tick, 35); return; }
    const st = schState(); st.results[SCH.lesson] = { theta: Object.assign({}, L.theta), history: L.history.slice(), before: L.before.sc.score, after: L.cur.sc.score, ev0: L.before.ev, ev1: L.cur.ev };
    SCH.training = false; $('sTrain').disabled = false; schRender(); if (!Player.playing && Player.scene === SCH.scene) Player.play();
    if (L.cur.sc.score - L.before.sc.score >= 8) complete('learn');
    if (st.results.every(Boolean)) { complete('grad'); store.grad = store.grad || {}; store.grad[SCH.style] = true; save(); if (['salsa', 'cumbia', 'bachata'].every(k => store.grad[k])) complete('triple'); } };
  setTimeout(tick, 35);
}
function buildSchool() {
  sstage = new Stage($('sstage'));
  $('sStyles').innerHTML = Object.entries(E.STYLES).map(([k, v]) => `<button data-s="${k}" aria-pressed="${k === SCH.style}">${v.name} <span class="muted small">${Math.round(SONGS[k].tempo)} bpm</span></button>`).join('');
  $('sBodies').innerHTML = ['humanoid', 'reduced', 'custom', 'arm'].map(b => `<button data-b="${b}" aria-pressed="${b === SCH.body}"><i style="background:${C[b]}"></i>${NAMES[b]}</button>`).join('');
  const sync = () => { document.querySelectorAll('#sStyles button').forEach(x => x.setAttribute('aria-pressed', x.dataset.s === SCH.style)); document.querySelectorAll('#sBodies button').forEach(x => x.setAttribute('aria-pressed', x.dataset.b === SCH.body)); $('sAbout').textContent = E.STYLES[SCH.style].about; $('sSpeed').value = SCH.speed; $('sSpeedV').textContent = SCH.speed + ' rad/s'; $('sSpeed').disabled = SCH.body === 'custom'; };
  $('sStyles').onclick = e => { const b = e.target.closest('button'); if (!b || SCH.training) return; SCH.style = b.dataset.s; sync(); Player.stop(); schBuild(); };
  $('sBodies').onclick = e => { const b = e.target.closest('button'); if (!b || SCH.training) return; SCH.body = b.dataset.b; sync(); Player.stop(); schBuild(); };
  $('sSpeed').oninput = e => { if (SCH.training) return; SCH.speed = +e.target.value; $('sSpeedV').textContent = SCH.speed + ' rad/s'; clearTimeout(SCH.sd); SCH.sd = setTimeout(() => { Player.stop(); schBuild(); }, 80); };
  $('sLessons').onclick = e => { const b = e.target.closest('.lesson'); if (!b || SCH.training) return; SCH.lesson = +b.dataset.l; Player.stop(); schBuild(); };
  $('sTrain').onclick = schTrain; $('sReset').onclick = () => { if (SCH.training) return; delete SCH.store[schKey()]; Player.stop(); schBuild(); };
  $('splay').onclick = () => Player.playing ? Player.stop() : Player.play(); $('sscrub').oninput = e => Player.seek(e.target.value / 1000 * (SCH.L.teacherMot.T - 1));
  sync(); schBuild();
}

// ================================================================== learn + demos + tabs
function buildLearn() { const p = DATA.pooled, f3 = x => x == null ? '–' : x.toFixed(3), pc = x => x == null ? '–' : Math.round(100 * x) + '%'; let h = '<tr><th></th><th>Beat alignment above chance</th><th>Right-wrist path error</th><th>Frames with a limit hit</th><th>Joint-angle motion kept</th></tr>';
  for (const k of ['human', 'humanoid', 'reduced', 'arm']) h += `<tr><td>${NAMES[k]}</td><td>${f3(p[k].bas_lift)}</td><td>${f3(p[k].rwrist_dtw)}</td><td>${pc(p[k].limit_frames)}</td><td>${pc(p[k].energy_retained)}</td></tr>`; $('pooltbl').innerHTML = h;
  document.querySelectorAll('[data-demo]').forEach(b => b.onclick = () => demo(b.dataset.demo)); }
function demo(name) { const run = (txt, o) => { showTab('studio'); if (o.song) { S.song = o.song; document.querySelectorAll('#songs button').forEach(x => x.setAttribute('aria-pressed', x.dataset.s === S.song)); } if (o.speed) { S.speed = o.speed; $('speed').value = o.speed; $('speedv').textContent = o.speed + ' rad/s'; } if (o.body) { S.body = o.body; document.querySelectorAll('#bodies button').forEach(x => x.setAttribute('aria-pressed', x.dataset.b === S.body)); } $('prompt').value = txt; choreograph(txt, true); };
  if (name === 'clip') run('hands in the air', { song: 'house', body: 'humanoid' }); else if (name === 'step') run('side step, side-to-side step-touch, then step again', { song: 'house', body: 'humanoid' }); else if (name === 'speed') run('wild arm pumps', { song: 'pop', speed: 4, body: 'humanoid' });
  else if (name === 'dead') run('squat low and bounce', { song: 'house', body: 'arm' }); else if (name === 'school') { showTab('school'); SCH.style = 'salsa'; SCH.body = 'humanoid'; SCH.speed = 3; SCH.lesson = 3; document.querySelectorAll('#sStyles button').forEach(x => x.setAttribute('aria-pressed', x.dataset.s === 'salsa')); document.querySelectorAll('#sBodies button').forEach(x => x.setAttribute('aria-pressed', x.dataset.b === 'humanoid')); $('sSpeed').value = 3; $('sSpeedV').textContent = '3 rad/s'; schBuild(); schTrain(); } else if (name === 'work') showTab('workshop'); else if (name === 'listen') showTab('listen'); }
function showTab(n) { Player.stop(); document.querySelectorAll('#nav button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === n)); document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + n)); window.scrollTo(0, 0);
  requestAnimationFrame(() => { if (n === 'studio') { stage.fit(); refreshStudio(true); } else if (n === 'school') { sstage.fit(); Player.load(SCH.scene); schRender(); } else if (n === 'workshop') { wstage.fit(); Player.load(wScene); wUpdate(); } else if (n === 'listen') { lstage.fit(); Player.scene = null; lstage.draw([], 0, {}); } }); }

// ================================================================== boot
function boot() { $('snd').onclick = () => { setMuted(!S.muted); if (!S.muted) audioWarned = false; }; setMuted(false); buildStudioUI(); wInit(); lInit(); buildLearn(); buildSchool(); $('nav').onclick = e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); };
  document.addEventListener('keydown', e => { if (e.code === 'Space' && !/INPUT|TEXTAREA|BUTTON/.test(e.target.tagName)) { e.preventDefault(); Player.playing ? Player.stop() : Player.play(); } });
  addEventListener('resize', () => { stage.fit(); wstage.fit(); lstage.fit(); sstage.fit(); if (Player.scene) Player.scene.draw(Player.frame); });
  const first = 'bounce and pump your arms'; $('prompt').value = first; S.phrases = E.parsePrompt(first).phrases; compute(); renderMissions(); wUpdate(); refreshStudio(false); }
boot();
