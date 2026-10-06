// Pure computation (no DOM). Port of dancebot/{skeleton,motion,retarget}.py + simplified metrics.
(function (root) {
'use strict';
const J = 19, FPS = 30;
const JOINTS = ['pelvis','spine','chest','neck','head','lsho','lelb','lwri','rsho','relb','rwri','lhip','lknee','lank','ltoe','rhip','rknee','rank','rtoe'];
const IDX = {}; JOINTS.forEach((n, i) => IDX[n] = i);
const PARENT = [-1,0,1,2,3,2,5,6,2,8,9,0,11,12,13,0,15,16,17];
const OFFSETS = [[0,0,0],[0,.10,0],[0,.20,0],[0,.22,0],[0,.12,0],[.18,.17,0],[0,-.28,0],[0,-.26,0],[-.18,.17,0],[0,-.28,0],[0,-.26,0],
  [.09,-.05,0],[0,-.42,0],[0,-.42,0],[0,-.07,.14],[-.09,-.05,0],[0,-.42,0],[0,-.42,0],[0,-.07,.14]];
const BONES = [[0,1],[1,2],[2,3],[3,4],[2,5],[5,6],[6,7],[2,8],[8,9],[9,10],[0,11],[11,12],[12,13],[13,14],[0,15],[15,16],[16,17],[17,18]];
const THIGH = .42, SHANK = .42, ANKLE_H = .07, PELVIS_Y = .93, HUMAN_H = 1.72;
const SEGS = [['pelvis','spine',.12],['spine','chest',.12],['chest','neck',.18],['neck','head',.03],['head','head',.05],
  ['lsho','lelb',.028],['lelb','lwri',.022],['lwri','lwri',.008],['lhip','lknee',.10],['lknee','lank',.047],['lank','ltoe',.015],
  ['rsho','relb',.028],['relb','rwri',.022],['rwri','rwri',.008],['rhip','rknee',.10],['rknee','rank',.047],['rank','rtoe',.015]]
  .map(([a, b, m]) => [IDX[a], IDX[b], m]);

// ---------------------------------------------------------------- 3x3 helpers (flat row-major arrays)
const mmul = (a, b) => [a[0]*b[0]+a[1]*b[3]+a[2]*b[6], a[0]*b[1]+a[1]*b[4]+a[2]*b[7], a[0]*b[2]+a[1]*b[5]+a[2]*b[8],
  a[3]*b[0]+a[4]*b[3]+a[5]*b[6], a[3]*b[1]+a[4]*b[4]+a[5]*b[7], a[3]*b[2]+a[4]*b[5]+a[5]*b[8],
  a[6]*b[0]+a[7]*b[3]+a[8]*b[6], a[6]*b[1]+a[7]*b[4]+a[8]*b[7], a[6]*b[2]+a[7]*b[5]+a[8]*b[8]];
const mT = a => [a[0],a[3],a[6],a[1],a[4],a[7],a[2],a[5],a[8]];
const mv = (a, v) => [a[0]*v[0]+a[1]*v[1]+a[2]*v[2], a[3]*v[0]+a[4]*v[1]+a[5]*v[2], a[6]*v[0]+a[7]*v[1]+a[8]*v[2]];
function eulerToMat(a, b, c) {
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return [cb*cc, -cb*sc, sb,  sa*sb*cc + ca*sc, -sa*sb*sc + ca*cc, -sa*cb,  -ca*sb*cc + sa*sc, ca*sb*sc + sa*cc, ca*cb];
}
function matToEuler(m) {
  const sb = Math.max(-1, Math.min(1, m[2])), b = Math.asin(sb);
  if (Math.abs(sb) < 0.999999) return [Math.atan2(-m[5], m[8]), b, Math.atan2(-m[1], m[0])];
  return [Math.atan2(m[7], m[4]), b, 0];
}
function rotvecToMat(v) {
  const th = Math.hypot(v[0], v[1], v[2]); if (th < 1e-12) return [1,0,0,0,1,0,0,0,1];
  const x = v[0]/th, y = v[1]/th, z = v[2]/th, c = Math.cos(th), s = Math.sin(th), C = 1 - c;
  return [c+x*x*C, x*y*C-z*s, x*z*C+y*s,  y*x*C+z*s, c+y*y*C, y*z*C-x*s,  z*x*C-y*s, z*y*C+x*s, c+z*z*C];
}
function matToRotvec(m) {
  const tr = m[0] + m[4] + m[8], th = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
  if (th < 1e-9) return [0, 0, 0];
  const k = th / (2 * Math.sin(th)); return [(m[7]-m[5])*k, (m[2]-m[6])*k, (m[3]-m[1])*k];
}
const Rx = a => { const c = Math.cos(a), s = Math.sin(a); return [1,0,0,0,c,-s,0,s,c]; };
const Ry = a => { const c = Math.cos(a), s = Math.sin(a); return [c,0,s,0,1,0,-s,0,c]; };
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = v => Math.hypot(v[0], v[1], v[2]);
const mod = (x, m) => ((x % m) + m) % m;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const bump = s => (s >= 0 && s <= 1) ? Math.pow(Math.sin(Math.PI * s), 2) : 0;
const shiftProf = s => (s >= 0 && s <= 1) ? smoothstep(s / .3) * smoothstep((1 - s) / .3) : 0;
const liftProf = s => bump((s - .2) / .6);

// ---------------------------------------------------------------- FK + planting
function fk(offsets, euler, rootPos, T) {
  const P = new Float64Array(T * J * 3), G = new Array(J);
  for (let t = 0; t < T; t++) {
    for (let j = 0; j < J; j++) {
      const o = (t * J + j) * 3, R = eulerToMat(euler[o], euler[o+1], euler[o+2]), p = PARENT[j];
      if (p < 0) { G[j] = R; P[o] = rootPos[t*3]; P[o+1] = rootPos[t*3+1]; P[o+2] = rootPos[t*3+2]; }
      else { const gp = G[p], off = offsets[j], po = (t * J + p) * 3; G[j] = mmul(gp, R);
        P[o] = P[po] + gp[0]*off[0] + gp[1]*off[1] + gp[2]*off[2]; P[o+1] = P[po+1] + gp[3]*off[0] + gp[4]*off[1] + gp[5]*off[2]; P[o+2] = P[po+2] + gp[6]*off[0] + gp[7]*off[1] + gp[8]*off[2]; }
    }
  }
  return P;
}
function plant(P, rootPos, T, scale) {
  for (let t = 0; t < T; t++) {
    const b = t * J * 3; let low = Math.min(P[b + IDX.ltoe*3 + 1], P[b + IDX.rtoe*3 + 1]);
    low = Math.min(low, Math.min(P[b + IDX.lank*3 + 1], P[b + IDX.rank*3 + 1]) - ANKLE_H * scale);
    for (let j = 0; j < J; j++) P[b + j*3 + 1] -= low; rootPos[t*3 + 1] -= low;
  }
}
const scaledOffsets = s => OFFSETS.map(o => [o[0]*s, o[1]*s, o[2]*s]);

// ---------------------------------------------------------------- generator
function beatClock(n, fps, beats) {
  const per = (() => { const d = []; for (let i = 1; i < beats.length; i++) d.push(beats[i] - beats[i-1]); d.sort((a, b) => a - b); const m = d.length >> 1; return d.length % 2 ? d[m] : (d[m-1] + d[m]) / 2; })();
  const pre = Math.ceil(beats[0] / per) + 1, ext = [];
  for (let i = pre; i > 0; i--) ext.push(beats[0] - per * i);
  beats.forEach(b => ext.push(b)); for (let i = 1; i <= 3; i++) ext.push(beats[beats.length-1] + per * i);
  const out = new Float64Array(n); let k = 0;
  for (let i = 0; i < n; i++) { const t = i / fps; while (k < ext.length - 2 && ext[k+1] < t) k++;
    let u = (t - ext[k]) / (ext[k+1] - ext[k]); u = clamp(u, k === 0 ? 0 : -1e9, 1e9); if (t <= ext[0]) { out[i] = -pre; continue; } if (t >= ext[ext.length-1]) { out[i] = ext.length - 1 - pre; continue; }
    out[i] = k - pre + u; }
  return out;
}
function legIK(hip, target, pole) {
  const a = [target[0]-hip[0], target[1]-hip[1], target[2]-hip[2]], D = norm(a), Dc = Math.min(D, (THIGH+SHANK)*.9995), ah = a.map(v => v / D);
  const dp = pole[0]*ah[0] + pole[1]*ah[1] + pole[2]*ah[2]; let pp = [pole[0]-dp*ah[0], pole[1]-dp*ah[1], pole[2]-dp*ah[2]]; const pn = norm(pp); pp = pp.map(v => v / pn);
  const alpha = Math.acos(clamp(Dc / (2*THIGH), -1, 1)), ca = Math.cos(alpha), sa = Math.sin(alpha);
  const d = [ca*ah[0]+sa*pp[0], ca*ah[1]+sa*pp[1], ca*ah[2]+sa*pp[2]], u = [ca*pp[0]-sa*ah[0], ca*pp[1]-sa*ah[1], ca*pp[2]-sa*ah[2]];
  return { d, u, flex: 2*alpha };
}

// ---------------------------------------------------------------- Latin footwork (salsa / cumbia / bachata). SIMPLIFIED, not reviewed by dance teachers.
const LATIN_LEG = ['salsa_basic', 'salsa_side', 'cumbia_basic', 'bachata_basic'], LATIN_ARM = ['salsa_arms', 'cumbia_arms', 'bachata_arms'];
const DEFAULT_PRM = { step: 1, lift: 1, hip: 1, arm: 1 };
const W8 = [[0,1],[1,0],[2,1],[3,1],[4,0],[5,1],[6,0],[7,0]];
function footAt(tau, keys, period) {
  const n = keys.length; let idx = -1; for (let i = 0; i < n; i++) if (keys[i][0] <= tau) idx = i; if (idx < 0) idx = n - 1;
  let X = keys[idx][1], Z = keys[idx][2], Lf = 0;
  for (let i = 0; i < n; i++) { const [a, kx, kz, kl] = keys[i], pk = keys[(i + n - 1) % n], paEff = i === 0 ? pk[0] - period : pk[0], dur = Math.min(.6, a - paEff), d = a - dur;
    for (const off of [0, period]) if (tau >= d + off && tau < a + off) { const u = (tau - (d + off)) / dur, sm = smoothstep(u); X = pk[1] + (kx - pk[1]) * sm; Z = pk[2] + (kz - pk[2]) * sm; Lf = kl * bump(u); } }
  return [X, Z, Lf];
}
function weightAt(tau, keys, period) {
  const n = keys.length; let idx = -1; for (let i = 0; i < n; i++) if (keys[i][0] <= tau) idx = i; if (idx < 0) idx = n - 1; let Wv = keys[idx][1];
  for (let i = 0; i < n; i++) { const [a, wv] = keys[i], pw = keys[(i + n - 1) % n][1];
    for (const off of [0, -period]) if (tau >= a + off && tau < a + .2 + off) Wv = pw + (wv - pw) * smoothstep((tau - (a + off)) / .2); }
  return Wv;
}
function latinLeg(C, i, lm, ph, p, w, prm) {
  const s = prm.step, lf = prm.lift, hp = prm.hip; let period = 8, Wk = W8, L, R;
  if (lm === 'salsa_basic') { L = [[0,0,.20*s,.06*lf],[2,0,0,.06*lf]]; R = [[4,0,-.20*s,.06*lf],[6,0,0,.06*lf]]; }
  else if (lm === 'salsa_side') { L = [[0,.18*s,0,.06*lf],[2,0,0,.06*lf]]; R = [[4,-.18*s,0,.06*lf],[6,0,0,.06*lf]]; }
  else if (lm === 'bachata_basic') { const st = .16 * s;
    L = [[0,st,0,.04*lf],[2,2*st,0,.04*lf],[5,st,0,.04*lf],[7,0,0,.035*lf]]; R = [[1,st,0,.04*lf],[3,2*st,0,.035*lf],[4,st,0,.04*lf],[6,0,0,.04*lf]]; }
  else { period = 4; const s1 = .12 * s; L = [[0,s1,0,.02*lf],[3,0,0,0]]; R = [[1,s1,0,0],[2,0,0,.02*lf]]; Wk = [[0,1],[1,1],[2,0],[3,0]]; }
  const tau = mod(ph - 8 * p, period), a = footAt(tau, L, period), b = footAt(tau, R, period), wl = weightAt(tau, Wk, period);
  const flx = .07 + a[0], flz = a[1], frx = -.07 + b[0], frz = b[1];
  const px = .10 * (flx + frx) / 2 + .90 * (wl * flx + (1 - wl) * frx), pz = .10 * (flz + frz) / 2 + .90 * (wl * flz + (1 - wl) * frz);
  C.Lfx[i] += w * a[0]; C.Lfz[i] += w * a[1]; C.Lfy[i] += w * a[2]; C.Rfx[i] += w * b[0]; C.Rfz[i] += w * b[1]; C.Rfy[i] += w * b[2];
  C.wide[i] += w * -.05; C.pdx[i] += w * px; C.pdz[i] += w * pz;
  const sway = 2 * wl - 1; C.proll[i] += w * hp * .07 * sway; C.pyaw[i] += w * hp * .10 * sway; C.pdy[i] += w * (-.02 * hp) * (.5 + .5 * Math.cos(2 * Math.PI * ph));
  if (lm === 'cumbia_basic') { C.pdy[i] += w * -.03; C.pyaw[i] += w * hp * .06 * Math.sin(Math.PI * ph); }
  if (lm === 'bachata_basic') { const h4 = bump((tau - 2.5) / 1), h8 = bump((tau - 6.5) / 1); C.pdy[i] += w * hp * .025 * (h4 + h8); C.proll[i] += w * hp * .09 * (h4 - h8); }
}
function latinArm(U, i3, am, ph, w, prm) {
  const a = prm.arm, sw = Math.sin(Math.PI * ph);
  if (am === 'salsa_arms') { U.lsho[i3] += w*a*(-.5 + .10*sw); U.lsho[i3+2] += w*a*.25; U.lelb[i3] += w*a*-1.3; U.rsho[i3] += w*a*(-.5 - .10*sw); U.rsho[i3+2] -= w*a*.25; U.relb[i3] += w*a*-1.3; }
  else if (am === 'cumbia_arms') { U.lsho[i3+2] += w*a*(.45 + .25*sw); U.rsho[i3+2] -= w*a*(.45 - .25*sw); U.lelb[i3] += w*a*-.5; U.relb[i3] += w*a*-.5; }
  else { U.lsho[i3+2] += w*a*.7; U.lsho[i3] += w*a*(-.3 + .08*sw); U.lelb[i3] += w*a*-1.2; U.rsho[i3] += w*a*(-.6 - .08*sw); U.rsho[i3+2] -= w*a*.15; U.relb[i3] += w*a*-1.4; }
}
const LEG_MOVES = ['idle','bounce','sway','step_touch','squat_pulse','kick'].concat(LATIN_LEG);
const ARM_MOVES = ['none','arm_pump','arm_wave','arms_up','torso_twist','head_bang','lean_back'].concat(LATIN_ARM);

// sequence: {phraseIndex: [leg, arm, energy]}; phrase 0 begins on the first detected beat; missing phrases idle.
function generate(beats, duration, sequence, opts) {
  opts = opts || {}; const fps = opts.fps || FPS, jitter = opts.jitter || 0, T = Math.floor(duration * fps);
  const Phi = beatClock(T, fps, beats);
  if (jitter) for (let i = 0; i < T; i++) { const t = i / fps; Phi[i] += jitter * (Math.sin(2*Math.PI*.13*t + 1.1) + Math.sin(2*Math.PI*.31*t + 2.3) + Math.sin(2*Math.PI*.47*t + .4)) / 3; }
  let pmin = Infinity, pmax = -Infinity; for (let i = 0; i < T; i++) { pmin = Math.min(pmin, Phi[i]); pmax = Math.max(pmax, Phi[i]); }
  const first = Math.floor(pmin / 8), nPhr = Math.ceil(pmax / 8) + 2, seq = {};
  for (let p = first; p < first + nPhr; p++) seq[p] = (sequence && sequence[p]) || ['idle', 'none', .5];
  const names = ['pdx','pdy','pdz','proll','pyaw','ppitch','Lfx','Lfy','Lfz','Rfx','Rfy','Rfz','Lfree','Rfree','wide']; const C = {}; names.forEach(n => C[n] = new Float64Array(T));
  const Un = ['spine','chest','neck','head','lsho','lelb','lwri','rsho','relb','rwri']; const U = {}; Un.forEach(n => U[n] = new Float64Array(T * 3));
  const legLabel = new Array(T), armLabel = new Array(T);
  for (let i = 0; i < T; i++) { const p = Math.floor(Phi[i] / 8); legLabel[i] = seq[p][0]; armLabel[i] = seq[p][1]; }
  for (let i = 0; i < T; i++) {
    C.pdy[i] += -.015 * (.5 + .5*Math.cos(2*Math.PI*Phi[i])); U.lsho[i*3+2] += .12; U.rsho[i*3+2] -= .12; U.lelb[i*3] += -.15; U.relb[i*3] += -.15; U.neck[i*3] += .04*Math.cos(2*Math.PI*Phi[i]);
  }
  for (let p = first; p < first + nPhr; p++) {
    const [lm, am, e, pr] = seq[p], prm = Object.assign({}, DEFAULT_PRM, pr || {}), isL = LATIN_LEG.indexOf(lm) >= 0, isA = LATIN_ARM.indexOf(am) >= 0;
    for (let i = 0; i < T; i++) {
      const ph = Phi[i], w = smoothstep((ph - 8*p) / .75) * smoothstep((8*(p+1) - ph) / .75), w2 = smoothstep((ph - 8*p + .375) / .75) - smoothstep((ph - 8*(p+1) + .375) / .75);
      if (!(w > 0) && !(w2 > 0)) continue;
      const s2 = mod(ph, 2), c1 = Math.cos(2*Math.PI*ph), i3 = i * 3;
      if (lm === 'bounce') { C.pdy[i] += w * -(.03 + .05*e) * (.5 + .5*c1); U.neck[i3] += w * .12 * c1; }
      else if (lm === 'sway') { const sn = Math.sin(Math.PI*ph); C.pdx[i] += w*.07*sn; C.proll[i] += w*.07*sn; C.pyaw[i] += w*.12*Math.sin(Math.PI*ph + .8); C.pdy[i] += w * -.03 * (.5 + .5*c1); }
      else if (lm === 'step_touch') { const lift = .09 + .05*e;
        C.Lfy[i] += w*lift*liftProf(s2); C.Lfx[i] += w*.16*liftProf(s2); C.Rfy[i] += w*lift*liftProf(s2-1); C.Rfx[i] += w*-.16*liftProf(s2-1);
        C.pdx[i] += w * (-.12*shiftProf(s2) + .12*shiftProf(s2-1)); C.pdy[i] += w * -.03 * (.5 + .5*c1); }
      else if (lm === 'squat_pulse') { C.pdy[i] += w * -(.14 + .16*e) * (.5 + .5*Math.cos(Math.PI*ph)); C.wide[i] += w*.10; C.ppitch[i] += w*.10*(.5 + .5*Math.cos(Math.PI*ph)); }
      else if (lm === 'kick') { const kh = .50 + .12*e, kf = .42 + .12*e, sl = mod(ph + 1, 4), sr = mod(ph - 1, 4);
        C.Lfy[i] += w*kh*liftProf(sl); C.Lfz[i] += w*kf*liftProf(sl); C.Rfy[i] += w*kh*liftProf(sr); C.Rfz[i] += w*kf*liftProf(sr);
        C.Lfree[i] += w*liftProf(sl); C.Rfree[i] += w*liftProf(sr); C.pdx[i] += w * (-.13*shiftProf(sl) + .13*shiftProf(sr));
        C.ppitch[i] += w * -.05 * (liftProf(sl) + liftProf(sr)); C.pdy[i] += w * -.025 * (.5 + .5*c1); }
      if (isL) latinLeg(C, i, lm, ph, p, w2, prm);
      if (isA) latinArm(U, i3, am, ph, w2, prm); else if (am === 'arm_pump') { const a = .5 + .5*Math.cos(Math.PI*ph), b = .5 + .5*Math.cos(Math.PI*ph + Math.PI), amp = 1.1 + .8*e;
        U.lsho[i3] += w*-amp*a; U.rsho[i3] += w*-amp*b; U.lelb[i3] += w*-1.3*a; U.relb[i3] += w*-1.3*b; }
      else if (am === 'arm_wave') { const q = Math.PI*ph;
        U.lsho[i3+2] += w*(.9 + .5*Math.sin(q)); U.rsho[i3+2] -= w*(.9 + .5*Math.sin(q + Math.PI));
        U.lelb[i3] += w*-.5*(.5 + .5*Math.sin(q + 1)); U.relb[i3] += w*-.5*(.5 + .5*Math.sin(q + 1 + Math.PI));
        U.lwri[i3+2] += w*.5*Math.sin(2*q); U.rwri[i3+2] += w*.5*Math.sin(2*q + Math.PI); }
      else if (am === 'arms_up') { const top = 2.3 + .35*e, pulse = .25*(.5 + .5*c1);
        U.lsho[i3+2] += w*(top + pulse); U.rsho[i3+2] -= w*(top + pulse); U.lelb[i3] += w*-.35*(.5 - .5*c1); U.relb[i3] += w*-.35*(.5 - .5*c1); U.chest[i3] += w*-.10*(.5 + .5*c1); }
      else if (am === 'torso_twist') { const tw = Math.sin(Math.PI*ph);
        U.spine[i3+1] += w*.35*tw; U.chest[i3+1] += w*(.30 + .25*e)*tw; U.chest[i3+2] += w*.14*Math.cos(Math.PI*ph);
        U.lsho[i3+2] += w*.5; U.rsho[i3+2] -= w*.5; U.lsho[i3+1] += w*.5*tw; U.rsho[i3+1] += w*.5*tw; U.lelb[i3] += w*-.8; U.relb[i3] += w*-.8; }
      else if (am === 'head_bang') { const nod = .5 + .5*c1;
        U.neck[i3] += w*(.30 + .35*e)*nod; U.head[i3] += w*.25*nod; U.chest[i3] += w*.12*nod; }
      else if (am === 'lean_back') { const hold = .6 + .4*Math.cos(Math.PI*ph);
        U.spine[i3] += w*-(.20 + .15*e)*hold; U.chest[i3] += w*-(.30 + .25*e)*hold; U.lsho[i3+2] += w*.4; U.rsho[i3+2] -= w*.4; }
    }
  }
  const euler = new Float64Array(T * J * 3), rootPos = new Float64Array(T * 3);
  for (let i = 0; i < T; i++) { rootPos[i*3] = C.pdx[i]; rootPos[i*3+1] = PELVIS_Y + C.pdy[i]; rootPos[i*3+2] = C.pdz[i]; euler[i*J*3] = C.ppitch[i]; euler[i*J*3+1] = C.pyaw[i]; euler[i*J*3+2] = C.proll[i]; }
  for (const [side, sx] of [['l', 1], ['r', -1]]) {
    const S = side === 'l' ? 'L' : 'R', yaw = side === 'l' ? .14 : -.14, RY = Ry(yaw), pole = mv(RY, [0, 0, 1]), hipOff = OFFSETS[IDX[side + 'hip']];
    for (let i = 0; i < T; i++) {
      const Rp = eulerToMat(C.ppitch[i], C.pyaw[i], C.proll[i]), ho = mv(Rp, hipOff), hip = [rootPos[i*3] + ho[0], rootPos[i*3+1] + ho[1], rootPos[i*3+2] + ho[2]];
      const tgt = [sx * (.12 + C.wide[i]) + C[S + 'fx'][i], ANKLE_H + C[S + 'fy'][i], C[S + 'fz'][i]];
      const { d, u, flex } = legIK(hip, tgt, pole), yA = [-d[0], -d[1], -d[2]], xA = cross(yA, u);
      const Gt = [xA[0], yA[0], u[0], xA[1], yA[1], u[1], xA[2], yA[2], u[2]];
      const he = matToEuler(mmul(mT(Rp), Gt)), hb = (i * J + IDX[side + 'hip']) * 3; euler[hb] = he[0]; euler[hb+1] = he[1]; euler[hb+2] = he[2];
      euler[(i * J + IDX[side + 'knee']) * 3] = flex;
      const Gs = mmul(Gt, Rx(flex)), rel = mmul(mT(Gs), RY), rv = matToRotvec(rel), f = 1 - clamp(C[S + 'free'][i], 0, 1);
      const ae = matToEuler(rotvecToMat([rv[0]*f, rv[1]*f, rv[2]*f])), ab = (i * J + IDX[side + 'ank']) * 3; euler[ab] = ae[0]; euler[ab+1] = ae[1]; euler[ab+2] = ae[2];
    }
  }
  for (const k of Un) { const j = IDX[k]; for (let i = 0; i < T; i++) { const o = (i*J + j)*3; euler[o] = U[k][i*3]; euler[o+1] = U[k][i*3+1]; euler[o+2] = U[k][i*3+2]; } }
  const pos = fk(OFFSETS, euler, rootPos, T); plant(pos, rootPos, T, 1);
  return { T, fps, euler, root: rootPos, pos, legLabel, armLabel, Phi };
}

// ---------------------------------------------------------------- embodiments
const INF = Infinity;
function blank() { return { lo: new Float64Array(J*3).fill(-INF), hi: new Float64Array(J*3).fill(INF), mask: new Uint8Array(J*3) }; }
function setDoF(E, joint, axis, a, b) { const k = IDX[joint]*3 + axis; E.lo[k] = a; E.hi[k] = b; E.mask[k] = 1; }
function freeBase(E) { for (let a = 0; a < 3; a++) { E.mask[a] = 1; E.lo[a] = -INF; E.hi[a] = INF; } }
function humanoidFull(scale, vmax) {
  const E = blank(); E.scale = scale || .77; E.vmax = vmax == null ? 8 : vmax; E.name = 'humanoid';
  for (const j of ['spine','chest']) { setDoF(E, j, 0, -.26, .26); setDoF(E, j, 1, -1.3, 1.3); setDoF(E, j, 2, -.26, .26); }
  for (const [s, sg] of [['l', 1], ['r', -1]]) {
    setDoF(E, s+'sho', 0, -2.67, 3.09); setDoF(E, s+'sho', 1, -2.6, 2.6); if (sg === 1) setDoF(E, s+'sho', 2, -1.59, 2.25); else setDoF(E, s+'sho', 2, -2.25, 1.59);
    setDoF(E, s+'elb', 0, -2.09, 1.05); for (let a = 0; a < 3; a++) setDoF(E, s+'wri', a, -1.6, 1.6);
    setDoF(E, s+'hip', 0, -2.88, 2.53); setDoF(E, s+'hip', 1, -2.76, 2.76); if (sg === 1) setDoF(E, s+'hip', 2, -.52, 2.97); else setDoF(E, s+'hip', 2, -2.97, .52);
    setDoF(E, s+'knee', 0, -.087, 2.88); setDoF(E, s+'ank', 0, -.87, .52); setDoF(E, s+'ank', 2, -.26, .26);
  }
  freeBase(E); return E;
}
function humanoidReduced(scale, vmax) {
  const E = blank(); E.scale = scale || .77; E.vmax = vmax == null ? 8 : vmax; E.name = 'reduced';
  for (const [s, sg] of [['l', 1], ['r', -1]]) {
    setDoF(E, s+'sho', 0, -2.67, 3.09); if (sg === 1) setDoF(E, s+'sho', 2, -1.59, 2.25); else setDoF(E, s+'sho', 2, -2.25, 1.59);
    setDoF(E, s+'elb', 0, -2.09, 1.05); setDoF(E, s+'hip', 0, -2.88, 2.53); setDoF(E, s+'hip', 1, -1, 1);
    if (sg === 1) setDoF(E, s+'hip', 2, -.52, 1.2); else setDoF(E, s+'hip', 2, -1.2, .52);
    setDoF(E, s+'knee', 0, -.087, 2.6); setDoF(E, s+'ank', 0, -.87, .52);
  }
  freeBase(E); return E;
}
// Workshop robots: choose joint groups. cfg = {groups:{waistYaw:1,...}, shoulderWide:0/1, vmax}
const GROUPS = [
  { id: 'waistYaw',  name: 'Waist twist',          cost: 2, hint: 'Rotates the upper body left/right.' },
  { id: 'waistTilt', name: 'Waist lean & side-bend', cost: 2, hint: 'Tips the torso forward, back and sideways.' },
  { id: 'neck',      name: 'Neck & head',          cost: 1, hint: 'Lets the head nod and turn.' },
  { id: 'shPitch',   name: 'Shoulder swing',       cost: 2, hint: 'Swings the arms forward and back.' },
  { id: 'shRoll',    name: 'Shoulder raise',       cost: 2, hint: 'Lifts the arms out to the side and overhead.' },
  { id: 'elbow',     name: 'Elbows',               cost: 1, hint: 'Bends the arms.' },
  { id: 'wrist',     name: 'Wrists',               cost: 1, hint: 'Flicks the hands.' },
  { id: 'hipPitch',  name: 'Hip swing',            cost: 2, hint: 'Swings the legs forward and back: kicks, squats.' },
  { id: 'hipRoll',   name: 'Hip sideways & turn',  cost: 2, hint: 'Opens the legs sideways and turns the feet.' },
  { id: 'knee',      name: 'Knees',                cost: 1, hint: 'Bends the legs.' },
  { id: 'anklePitch',name: 'Ankle tilt',           cost: 1, hint: 'Keeps feet flat when you squat.' },
  { id: 'ankleRoll', name: 'Ankle roll',           cost: 1, hint: 'Keeps feet flat when you lean sideways.' }];
const SPEEDS = [{ v: 4, cost: 0, name: 'Slow motors (4 rad/s)' }, { v: 8, cost: 1, name: 'Standard motors (8 rad/s)' }, { v: 14, cost: 3, name: 'Fast motors (14 rad/s)' }];
function customRobot(cfg) {
  const g = cfg.groups, E = blank(); E.scale = .77; E.vmax = cfg.vmax || 8; E.name = 'custom'; const wide = cfg.shoulderWide ? 1 : 0;
  if (g.waistYaw) for (const j of ['spine','chest']) setDoF(E, j, 1, -1.3, 1.3);
  if (g.waistTilt) for (const j of ['spine','chest']) { setDoF(E, j, 0, -.26, .26); setDoF(E, j, 2, -.26, .26); }
  if (g.neck) for (const j of ['neck','head']) for (let a = 0; a < 3; a++) setDoF(E, j, a, -.6, .6);
  for (const [s, sg] of [['l', 1], ['r', -1]]) {
    if (g.shPitch) { setDoF(E, s+'sho', 0, -2.67, 3.09); setDoF(E, s+'sho', 1, -2.6, 2.6); }
    if (g.shRoll) { const hiR = wide ? 2.9 : 2.25, loR = wide ? -2.9 : -1.59; if (sg === 1) setDoF(E, s+'sho', 2, loR, hiR); else setDoF(E, s+'sho', 2, -hiR, -loR); }
    if (g.elbow) setDoF(E, s+'elb', 0, -2.09, 1.05);
    if (g.wrist) for (let a = 0; a < 3; a++) setDoF(E, s+'wri', a, -1.6, 1.6);
    if (g.hipPitch) setDoF(E, s+'hip', 0, -2.88, 2.53);
    if (g.hipRoll) { setDoF(E, s+'hip', 1, -2.76, 2.76); if (sg === 1) setDoF(E, s+'hip', 2, -.52, 2.97); else setDoF(E, s+'hip', 2, -2.97, .52); }
    if (g.knee) setDoF(E, s+'knee', 0, -.087, 2.88);
    if (g.anklePitch) setDoF(E, s+'ank', 0, -.87, .52);
    if (g.ankleRoll) setDoF(E, s+'ank', 2, -.26, .26);
  }
  freeBase(E); return E;
}
function robotCost(cfg) { let c = 0; for (const G of GROUPS) if (cfg.groups[G.id]) c += G.cost; if (cfg.shoulderWide && cfg.groups.shRoll) c += 1; c += (SPEEDS.find(s => s.v === cfg.vmax) || SPEEDS[1]).cost; return c; }

// ---------------------------------------------------------------- retargeting
const FLAG = .10;
function retargetHumanoid(mot, E) {
  const T = mot.T, dt = 1 / mot.fps, N = J * 3, out = new Float64Array(T * N), limAx = new Uint8Array(T * N);
  for (let t = 0; t < T; t++) for (let k = 0; k < N; k++) {
    const h = mot.euler[t*N + k]; let e = E.mask[k] ? h : 0; const lockRem = Math.abs(h - e) > FLAG, c = clamp(e, E.lo[k], E.hi[k]), rangeRem = Math.abs(c - e) > FLAG;
    out[t*N + k] = c; limAx[t*N + k] = (lockRem || rangeRem) ? 1 : 0;
  }
  const step = E.vmax * dt, rateAx = new Uint8Array(T * N);
  if (isFinite(step)) for (let t = 1; t < T; t++) for (let k = 3; k < N; k++) { const d = out[t*N + k] - out[(t-1)*N + k], dc = clamp(d, -step, step); if (Math.abs(dc - d) > 1e-6) rateAx[t*N + k] = 1; out[t*N + k] = out[(t-1)*N + k] + dc; }
  const root = new Float64Array(T * 3); for (let i = 0; i < T * 3; i++) root[i] = mot.root[i] * E.scale;
  const pos = fk(scaledOffsets(E.scale), out, root, T); plant(pos, root, T, E.scale);
  const lim = new Uint8Array(T * J), rate = new Uint8Array(T * J);
  for (let t = 0; t < T; t++) for (let j = 1; j < J; j++) for (let a = 0; a < 3; a++) { if (limAx[(t*J + j)*3 + a]) lim[t*J + j] = 1; if (rateAx[(t*J + j)*3 + a]) rate[t*J + j] = 1; }
  return { kind: 'humanoid', T, pos, angles: out, lim, rate, limAx, scale: E.scale, E };
}
const ARM = { S0: [0, 1, 0], L1: .55, L2: .60, k: 1, q1: [-2.9, 2.9], q2: [-1.6, 2.4], q3: [0, 2.6] };
function retargetArm(mot, humanPos, vmax) {
  vmax = vmax == null ? 8 : vmax; const T = mot.T, { S0, L1, L2, k } = ARM, Q = new Float64Array(T * 3), lim = new Uint8Array(T), reach = new Uint8Array(T), tgt = new Float64Array(T * 3);
  const idealQ = new Float64Array(T * 3), limAx = new Uint8Array(T * 3);
  for (let t = 0; t < T; t++) {
    const b = t * J * 3, w = [humanPos[b + IDX.rwri*3] - humanPos[b], humanPos[b + IDX.rwri*3 + 1] - humanPos[b + 1], humanPos[b + IDX.rwri*3 + 2] - humanPos[b + 2]];
    const rel = [k*w[0], k*w[1], k*w[2]]; tgt[t*3] = S0[0] + rel[0]; tgt[t*3+1] = S0[1] + rel[1]; tgt[t*3+2] = S0[2] + rel[2];
    const r = Math.hypot(rel[0], rel[2]), h = rel[1], q1 = Math.atan2(rel[0], rel[2]), D = Math.hypot(r, h), Dc = clamp(D, .05, (L1 + L2) * .999);
    if (D - (L1 + L2) > 0) reach[t] = 1;
    const cphi = clamp((L1*L1 + L2*L2 - Dc*Dc) / (2*L1*L2), -1, 1), q3 = Math.PI - Math.acos(cphi), beta = Math.acos(clamp((L1*L1 + Dc*Dc - L2*L2) / (2*L1*Dc), -1, 1)), q2 = Math.atan2(r, h) - beta;
    const lo = [ARM.q1[0], ARM.q2[0], ARM.q3[0]], hi = [ARM.q1[1], ARM.q2[1], ARM.q3[1]], q = [q1, q2, q3];
    for (let a = 0; a < 3; a++) { const c = clamp(q[a], lo[a], hi[a]); if (Math.abs(c - q[a]) > .10) { limAx[t*3 + a] = 1; lim[t] = 1; } Q[t*3 + a] = c; }
  }
  const step = vmax / mot.fps, rate = new Uint8Array(T);
  for (let t = 1; t < T; t++) for (let a = 0; a < 3; a++) { const d = Q[t*3+a] - Q[(t-1)*3+a], dc = clamp(d, -step, step); if (Math.abs(dc - d) > 1e-6) rate[t] = 1; Q[t*3+a] = Q[(t-1)*3+a] + dc; }
  const pos = new Float64Array(T * 4 * 3);
  for (let t = 0; t < T; t++) {
    const [q1, q2, q3] = [Q[t*3], Q[t*3+1], Q[t*3+2]], s1 = Math.sin(q1), c1 = Math.cos(q1);
    const er = L1*Math.sin(q2), eh = L1*Math.cos(q2), tr = er + L2*Math.sin(q2 + q3), th = eh + L2*Math.cos(q2 + q3), o = t * 12;
    pos.set([0, 0, 0, S0[0], S0[1], S0[2], er*s1, S0[1] + eh, er*c1, tr*s1, S0[1] + th, tr*c1], o);
  }
  return { kind: 'arm', T, pos, angles: Q, lim, rate, reach, tgt, limAx, scale: 1 };
}

// ---------------------------------------------------------------- metrics
function comOf(P, t) { const b = t * J * 3; let x = 0, y = 0, z = 0, m = 0;
  for (const [a, c, w] of SEGS) { x += w*.5*(P[b+a*3] + P[b+c*3]); y += w*.5*(P[b+a*3+1] + P[b+c*3+1]); z += w*.5*(P[b+a*3+2] + P[b+c*3+2]); m += w; } return [x/m, y/m, z/m]; }
function hull(pts) { pts = pts.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]); const cr = (o, a, b) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]); const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length-2], lo[lo.length-1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length-2], up[up.length-1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up); }
function balanceMargins(P, T, scale) {
  const out = new Float64Array(T).fill(-1);
  for (let t = 0; t < T; t++) { const b = t * J * 3, pts = [];
    for (const s of ['l', 'r']) { const a = IDX[s + 'ank']*3, o = IDX[s + 'toe']*3;
      if (Math.min(P[b+o+1], P[b+a+1] - ANKLE_H*scale) < .02*scale) { const ax = [P[b+a], P[b+a+2]], tx = [P[b+o], P[b+o+2]], f = [tx[0]-ax[0], tx[1]-ax[1]], n = Math.hypot(f[0], f[1]);
        const lat = n > 1e-6 ? [-f[1]/n*.045*scale, f[0]/n*.045*scale] : [.045*scale, 0]; pts.push([ax[0]+lat[0], ax[1]+lat[1]], [ax[0]-lat[0], ax[1]-lat[1]], [tx[0]+lat[0], tx[1]+lat[1]], [tx[0]-lat[0], tx[1]-lat[1]]); } }
    if (pts.length < 3) continue; const H = hull(pts); if (H.length < 3) continue; const c = comOf(P, t); let m = Infinity;
    for (let i = 0; i < H.length; i++) { const a = H[i], bb = H[(i+1) % H.length], ex = bb[0]-a[0], ey = bb[1]-a[1], L = Math.hypot(ex, ey) || 1; m = Math.min(m, (ex*(c[2]-a[1]) - ey*(c[0]-a[0])) / L); }
    out[t] = m; }
  return out;
}
function gauss1(v, sigma) { const r = Math.ceil(3*sigma), k = []; let s = 0; for (let i = -r; i <= r; i++) { const w = Math.exp(-i*i / (2*sigma*sigma)); k.push(w); s += w; }
  return v.map((_, i) => { let a = 0; for (let j = -r; j <= r; j++) a += k[j + r] * v[clamp(i + j, 0, v.length - 1)]; return a / s; }); }
function speedCurve(P, T, nj) { const v = new Array(T).fill(0); for (let t = 1; t < T; t++) { let a = 0; for (let j = 0; j < nj; j++) { const o = (t*nj + j)*3, p = ((t-1)*nj + j)*3; a += Math.hypot(P[o]-P[p], P[o+1]-P[p+1], P[o+2]-P[p+2]); } v[t] = a / nj * FPS; } v[0] = v[1]; return v; }
// "beat lock": share of music beats with a motion-speed minimum within +-100 ms (simplified BAS; same idea, not the paper's exact number)
function beatLock(P, T, nj, beats) {
  const v = gauss1(speedCurve(P, T, nj), 1), lo = Math.min(...v), hi = Math.max(...v), minima = [], win = 8;
  for (let i = 1; i < T - 1; i++) if (v[i] < v[i-1] && v[i] <= v[i+1]) { let mx = 0; for (let j = Math.max(0, i - win); j <= Math.min(T - 1, i + win); j++) mx = Math.max(mx, v[j]); if (mx - v[i] > .10 * (hi - lo)) { if (minima.length && i - minima[minima.length-1] < 6) { if (v[i] < v[minima[minima.length-1]]) minima[minima.length-1] = i; } else minima.push(i); } }
  let hits = 0, n = 0; for (const b of beats) { const f = b * FPS; if (f > T - 1) break; n++; if (minima.some(m => Math.abs(m - f) <= 3)) hits++; }
  return n ? hits / n : 0;
}

// Step timing: when does each foot touch down? Compare the robot's touchdown times with the teacher's (lateness is what slow motors cause).
function landings(P, T, scale, nj) {
  const ev = [];
  for (const side of ['l', 'r']) { const a = IDX[side + 'ank'] * 3; let up = false;
    for (let t = 0; t < T; t++) { const y = (P[(t*nj)*3 + a + 1] - ANKLE_H * scale) / scale; if (!up && y > .022) up = true; else if (up && y < .010) { up = false; ev.push(t / FPS); } } }
  return ev.sort((x, y) => x - y);
}
function stepTiming(teacherPos, robotPos, T, scale) {
  const te = landings(teacherPos, T, 1, J), re = landings(robotPos, T, scale, J); if (te.length < 2) return { timing: 1, n: te.length, errMs: 0 };
  let err = 0; for (const t of te) { let m = .4; for (const r of re) m = Math.min(m, Math.abs(r - t)); err += m; } err /= te.length; return { timing: clamp(1 - err / .25, 0, 1), n: te.length, errMs: err * 1000 };
}
function schoolScore(ev, hu) { if (ev.kind === 'arm') { const sc = Math.round(100 * (ev.fidelity || 0)); return { score: sc, stars: sc >= 90 ? 3 : sc >= 75 ? 2 : sc >= 55 ? 1 : 0, tm: 1, st: 1 }; }
  const fid = ev.fidelity == null ? 0 : ev.fidelity, tm = ev.timing == null ? 1 : ev.timing, st = ev.stability == null ? 1 : Math.min(1, ev.stability / Math.max(.2, hu.stability));
  const score = Math.round(100 * (.5 * fid + .3 * tm + .2 * st)); return { score, stars: score >= 90 ? 3 : score >= 75 ? 2 : score >= 55 ? 1 : 0, tm, st }; }

function evaluate(mot, r, beats) {
  const T = mot.T, out = { kind: r.kind };
  let lf = 0; for (let t = 0; t < T; t++) { let any = 0; if (r.kind === 'arm') any = r.lim[t] | r.reach[t]; else for (let j = 1; j < J; j++) if (r.lim[t*J + j]) { any = 1; break; } lf += any; } out.lostFrames = lf / T;
  const nj = r.kind === 'arm' ? 4 : J; out.beatLock = beatLock(r.pos, T, nj, beats);
  if (r.kind === 'humanoid') {
    out.fidelity = keypointFidelity(mot.pos, r.pos, T, r.scale, null); const stp = stepTiming(mot.pos, r.pos, T, r.scale); out.timing = stp.timing; out.timingMs = stp.errMs; out.steps = stp.n;
    const m = balanceMargins(r.pos, T, r.scale); let ok = 0; for (let t = 0; t < T; t++) if (m[t] >= 0) ok++; out.stability = ok / T; out.margins = m;
  } else { let e = 0; const S0 = ARM.S0; for (let t = 0; t < T; t++) { const o = t*12 + 9; e += Math.hypot(r.pos[o] - r.tgt[t*3], r.pos[o+1] - r.tgt[t*3+1], r.pos[o+2] - r.tgt[t*3+2]); } out.wristErr = e / T; out.fidelity = keypointFidelity(mot.pos, r.pos, T, 1, r); out.stability = null; out.timing = null; }
  return out;
}
// "Visible fidelity": 1 - (error of head/hands/feet) / (how far the human moved them from a neutral stand). Arm: only the right wrist has a counterpart; the other points stay at rest.
// For the arm only the right wrist has a counterpart; the other four points count as not moving.
const KP = ['head', 'lwri', 'rwri', 'lank', 'rank'];
const REST = (() => { const P = fk(OFFSETS, new Float64Array(J*3), [0, .96, 0], 1); return KP.map(n => { const o = IDX[n]*3; return [(P[o] - P[0]) / HUMAN_H, (P[o+1] - P[1]) / HUMAN_H, (P[o+2] - P[2]) / HUMAN_H]; }); })();
function keypointFidelity(hp, rp, T, scale, arm) {
  const rel = (P, nj, t, name, sc) => { const b = t * nj * 3, o = (IDX[name]) * 3; return [(P[b+o] - P[b]) / (HUMAN_H*sc), (P[b+o+1] - P[b+1]) / (HUMAN_H*sc), (P[b+o+2] - P[b+2]) / (HUMAN_H*sc)]; };
  let err = 0, amp = 0;
  for (let t = 0; t < T; t++) KP.forEach((n, i) => { const a = rel(hp, J, t, n, 1); let b;
    if (arm) { if (n === 'rwri') { const o = t*12 + 9; b = [(rp[o] - ARM.S0[0]) / (HUMAN_H*ARM.k), (rp[o+1] - ARM.S0[1]) / (HUMAN_H*ARM.k), (rp[o+2] - ARM.S0[2]) / (HUMAN_H*ARM.k)]; } else b = REST[i]; }
    else b = rel(rp, J, t, n, scale);
    err += Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]); amp += Math.hypot(a[0]-REST[i][0], a[1]-REST[i][1], a[2]-REST[i][2]); });
  return clamp(1 - err / (amp + .03 * T * KP.length), 0, 1);
}
function humanMetrics(mot, beats) { const m = balanceMargins(mot.pos, mot.T, 1); let ok = 0; for (let t = 0; t < mot.T; t++) if (m[t] >= 0) ok++; return { kind: 'human', timing: 1, beatLock: beatLock(mot.pos, mot.T, J, beats), stability: ok / mot.T, fidelity: 1, lostFrames: 0, margins: m }; }

// ---------------------------------------------------------------- explanations: which joints lost what, and why
const AXN = { spine: ['lean', 'twist', 'side-bend'], chest: ['lean', 'twist', 'side-bend'], neck: ['nod', 'turn', 'tilt'], head: ['nod', 'turn', 'tilt'],
  sho: ['swing', 'twist', 'raise'], elb: ['bend', 'twist', 'roll'], wri: ['flex', 'twist', 'roll'], hip: ['swing', 'turn', 'sideways'], knee: ['bend', 'twist', 'roll'], ank: ['tilt', 'turn', 'roll'] };
const JNAME = { spine: 'Lower back', chest: 'Upper back', neck: 'Neck', head: 'Head', sho: 'shoulder', elb: 'elbow', wri: 'wrist', hip: 'hip', knee: 'knee', ank: 'ankle' };
function jointInfo(j) { const n = JOINTS[j]; if (n === 'pelvis' || n.endsWith('toe')) return null; const side = n[0] === 'l' && n.length > 3 && !['lower'].includes(n) && ['sho','elb','wri','hip','knee','ank'].includes(n.slice(1)) ? 'Left ' : (n[0] === 'r' && ['sho','elb','wri','hip','knee','ank'].includes(n.slice(1)) ? 'Right ' : ''); const key = side ? n.slice(1) : n;
  return { key, label: side ? side + JNAME[key] : JNAME[key], axes: AXN[key] }; }
function explain(mot, r) {
  if (r.kind !== 'humanoid') return []; const T = mot.T, N = J*3, E = r.E, rows = [];
  for (let j = 1; j < J; j++) { const info = jointInfo(j); if (!info) continue;
    for (let a = 0; a < 3; a++) { const k = j*3 + a; let n = 0, peak = 0, sgn = 1;
      for (let t = 0; t < T; t++) if (r.limAx[t*N + k]) { n++; const h = mot.euler[t*N + k]; if (Math.abs(h) > Math.abs(peak)) { peak = h; sgn = Math.sign(h) || 1; } }
      if (n < 3) continue; const locked = !E.mask[k], lim = locked ? 0 : (sgn > 0 ? E.hi[k] : E.lo[k]);
      rows.push({ joint: j, axis: a, label: info.label, motion: info.axes[a], frames: n / T, needDeg: Math.abs(peak) * 180 / Math.PI, limDeg: Math.abs(lim) * 180 / Math.PI, locked, score: n / T * (Math.abs(peak) - Math.abs(lim)) }); } }
  rows.sort((p, q) => q.score - p.score); return rows;
}

// ---------------------------------------------------------------- prompt -> choreography ("director")
const LEX = {
  leg: { salsa_side: /\b(salsa side|side[- ]?basic|cuban basic)\b/, salsa_basic: /\bsalsa\b(?! side)/, cumbia_basic: /\bcumbia\b/, bachata_basic: /\bbachata\b/, kick: /\b(kicks?|karate|high[- ]?kick|punt)\b/, squat_pulse: /\b(squat\w*|crouch\w*|get low|drop\w*|deep|low)\b/, step_touch: /\b(step\w*|shuffle\w*|side[- ]?to[- ]?side|tap\w*|slide\w*|sidestep)\b/, sway: /\b(sway\w*|hips?|swing\w*|rock\w*|roll\w*)\b/, bounce: /\b(bounc\w*|bob\w*|jump\w*|hop\w*|pulse\w*|groov\w*|dance)\b/ },
  arm: { arms_up: /\b(hands? (up|in the air)|arms? (up|in the air)|overhead|raise\w*|reach\w* up|sky|touch the sky|celebrat\w*)\b/, arm_pump: /\b(pump\w*|punch\w*|fists?|box\w*|fist[- ]?pump)\b/, arm_wave: /\b(wav\w*|flow\w*|ripple\w*|sweep\w*)\b/, torso_twist: /\b(twist\w*|spin\w*|turn\w*|rotat\w*|torso)\b/, head_bang: /\b(head[- ]?bang\w*|headbang\w*|nod\w*|bang\w*|rock out)\b/, lean_back: /\b(lean\w*|bend\w* back|backbend|limbo|arch\w*)\b/ } };
const ENERGY = [[/\b(wild|fast|energetic|intense|powerful|big|hard|hype|crazy|high energy|huge|explosive)\b/, 1.0], [/\b(slow|gentle|calm|soft|small|subtle|chill|smooth|easy)\b/, .3]];
const LATIN_ARM_FOR = { salsa_basic: 'salsa_arms', salsa_side: 'salsa_arms', cumbia_basic: 'cumbia_arms', bachata_basic: 'bachata_arms' };
function findAll(group, s) { const hits = []; for (const [k, re] of Object.entries(group)) { const m = re.exec(s); if (m) hits.push({ k, i: m.index }); } return hits.sort((a, b) => a.i - b.i).map(h => h.k); }
function parsePrompt(text) {
  const segs = text.toLowerCase().split(/[,;.\n]|\bthen\b|\band then\b|\bafter that\b|\bnext\b|\bfinally\b|\bfinish(?:ing)?(?: with| off with)?\b|\bend(?:ing)?(?: with| on)?\b|\bto end\b|\bfollowed by\b|\bbefore\b|\bafterwards?\b/).map(s => s.trim()).filter(Boolean);
  const out = [], unknown = [];
  for (const s of segs) {
    let legs = findAll(LEX.leg, s); const arms = findAll(LEX.arm, s); if (legs.some(l => LATIN_LEG.indexOf(l) >= 0)) legs = legs.filter(l => LATIN_LEG.indexOf(l) >= 0);   // 'salsa step' is salsa, not step-touch
    if (!legs.length && !arms.length) { unknown.push(s); continue; }
    let e = .6; for (const [re, v] of ENERGY) if (re.test(s)) { e = v; break; }
    let rep = 1; if (/\b(twice|two times|double|x2|2x)\b/.test(s)) rep = 2; else if (/\b(three times|thrice|x3|3x)\b/.test(s)) rep = 3;
    const n = Math.max(legs.length, arms.length, 1);
    for (let r = 0; r < rep; r++) for (let i = 0; i < n; i++) { const leg = legs[i] || legs[legs.length - 1] || 'bounce'; out.push({ leg, arm: arms[i] || LATIN_ARM_FOR[leg] || 'none', e, text: s }); }
  }
  return { phrases: out, unknown };
}
function toSequence(phrases, nPhrases) { const seq = { '-1': ['idle', 'none', .5] }; for (let p = 0; p < nPhrases; p++) { const ph = phrases[p % phrases.length]; seq[p] = [ph.leg, ph.arm, ph.e]; } return seq; }


// ---------------------------------------------------------------- scoring + Dance School (curriculum + trial-and-error learner)
function danceScore(ev, hu) {
  const fid = ev.fidelity == null ? 0 : ev.fidelity, bl = hu.beatLock < .12 ? 1 : Math.min(1, ev.beatLock / hu.beatLock), st = ev.stability == null ? 1 : Math.min(1, ev.stability / Math.max(.2, hu.stability));
  const score = Math.round(100 * (.55 * fid + .25 * bl + .20 * st)); return { score, stars: score >= 90 ? 3 : score >= 75 ? 2 : score >= 55 ? 1 : 0, bl, st };
}
const STYLES = {
  salsa:   { name: 'Salsa',   legs: ['salsa_basic', 'salsa_side'], arm: 'salsa_arms',   about: 'Forward-and-back basic with a hold on 4 and 8, then a side basic. Steps land on 1, 2, 3 and 5, 6, 7.' },
  cumbia:  { name: 'Cumbia',  legs: ['cumbia_basic'],              arm: 'cumbia_arms',  about: 'A small side-and-close step with the foot dragged rather than lifted, a low lilting sway, arms swinging out low.' },
  bachata: { name: 'Bachata', legs: ['bachata_basic'],             arm: 'bachata_arms', about: 'Three steps to the side and a tap with a hip pop on 4, then three back and a tap on 8, in a close embrace frame.' } };
const COUNTS = { salsa_basic: ['1 L fwd', '2 weight R', '3 L close', '4 hold', '5 R back', '6 weight L', '7 R close', '8 hold'], salsa_side: ['1 L out', '2 weight R', '3 L close', '4 hold', '5 R out', '6 weight L', '7 R close', '8 hold'],
  bachata_basic: ['1 L side', '2 R close', '3 L side', '4 tap + hip', '5 R side', '6 L close', '7 R side', '8 tap + hip'], cumbia_basic: ['1 L out', '2 R drag', '3 R in', '4 L drag', '1 L out', '2 R drag', '3 R in', '4 L drag'] };
const LESSONS = [
  { id: 1, name: 'Feet only', hip: 0, arms: false, rate: .6, train: ['step', 'lift'], about: 'Just the footwork, at 60% speed.' },
  { id: 2, name: 'Add the hips', hip: 1, arms: false, rate: .6, train: ['step', 'lift', 'hip'], about: 'Weight changes and hip motion, 60% speed.' },
  { id: 3, name: 'Add the arms', hip: 1, arms: true, rate: .6, train: ['step', 'lift', 'hip', 'arm'], about: 'The full style, 60% speed.' },
  { id: 4, name: 'Full speed', hip: 1, arms: true, rate: 1, train: ['step', 'lift', 'hip', 'arm'], about: 'Everything, at the real tempo of the music.' }];
const PRM_RANGE = { step: [.2, 1.3], lift: [.2, 1.3], hip: [0, 1.3], arm: [0, 1.3] };
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }
const NPH = 3;
function schoolClip(beatsAll, lesson) { const rate = lesson.rate, audioStart = Math.max(0, beatsAll[0] - .5); const clip = beatsAll.slice(0, NPH * 8 + 2).map(b => (b - audioStart) / rate);
  return { beats: clip, dur: (beatsAll[NPH * 8] - audioStart) / rate + .3, rate, audioStart }; }
function schoolSeq(style, lesson, theta) { const St = STYLES[style], seq = { '-1': ['idle', 'none', .5] };
  for (let p = 0; p < NPH; p++) seq[p] = [St.legs[p % St.legs.length], lesson.arms ? St.arm : 'none', .6, { step: theta.step, lift: theta.lift, hip: lesson.hip ? theta.hip : 0, arm: theta.arm }]; return seq; }
const TEACHER = { step: 1, lift: 1, hip: 1, arm: 1 };
// A learner tries small random changes to its own style parameters (step length, foot lift, hip motion, arm height), runs the move through its
// body's real limits, scores it against the teacher, and keeps whatever scores better. Simple hill-climbing (a (1+1) evolution strategy), not deep learning.
function makeLearner(o) {
  const lesson = o.lesson, clip = schoolClip(o.beats, lesson), teacherMot = generate(clip.beats, clip.dur, schoolSeq(o.style, lesson, TEACHER), { jitter: 0 }), hu = humanMetrics(teacherMot, clip.beats), rnd = mulberry32(o.seed || 1);
  const run = theta => { const m = generate(clip.beats, clip.dur, schoolSeq(o.style, lesson, theta), { jitter: 0 }); const r = o.kind === 'arm' ? retargetArm(m, m.pos, o.emb.vmax) : retargetHumanoid(m, o.emb); const ev = evaluate(teacherMot, r, clip.beats); return { m, r, ev, sc: schoolScore(ev, hu) }; };
  const L = { lesson, clip, teacherMot, hu, run, theta: Object.assign({}, o.theta || TEACHER), history: [], trials: o.trials || 24, i: 0, done: false };
  L.before = run(TEACHER); L.cur = run(L.theta); L.history.push(L.cur.sc.score); L.start = L.cur.sc.score;
  L.step = function () { if (L.done) return; const sigma = .28 * Math.pow(.93, L.i), cand = Object.assign({}, L.theta);
    for (const k of lesson.train) cand[k] = Math.min(PRM_RANGE[k][1], Math.max(PRM_RANGE[k][0], L.theta[k] + sigma * gauss(rnd)));
    const res = run(cand), better = res.sc.score > L.cur.sc.score || (res.sc.score === L.cur.sc.score && res.ev.fidelity > L.cur.ev.fidelity + 1e-4);
    if (better) { L.theta = cand; L.cur = res; } L.history.push(L.cur.sc.score); L.i++; if (L.i >= L.trials) L.done = true; return better; };
  return L;
}

const api = { schoolScore, stepTiming, landings, danceScore, STYLES, COUNTS, LESSONS, PRM_RANGE, TEACHER, NPH, schoolClip, schoolSeq, makeLearner, LATIN_ARM_FOR, LATIN_LEG, LATIN_ARM, DEFAULT_PRM, J, FPS, JOINTS, IDX, PARENT, OFFSETS, BONES, SEGS, THIGH, SHANK, ANKLE_H, HUMAN_H, LEG_MOVES, ARM_MOVES, generate, fk, plant, scaledOffsets, humanoidFull, humanoidReduced, customRobot, robotCost, GROUPS, SPEEDS,
  retargetHumanoid, retargetArm, ARM, evaluate, keypointFidelity, humanMetrics, balanceMargins, comOf, explain, jointInfo, parsePrompt, toSequence, speedCurve, beatLock };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
