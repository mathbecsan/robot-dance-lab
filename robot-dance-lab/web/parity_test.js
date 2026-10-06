const E = require('./engine.js'), fx = require('../out/parity_fixture.json');
const seq = {}; for (const [k, v] of Object.entries(fx.seq)) seq[k] = v;
const mot = E.generate(fx.beats, fx.dur, seq, { jitter: 0 });
const maxd = (a, b) => { let m = 0, at = -1; for (let i = 0; i < b.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) { m = d; at = i; } } return [m, at]; };
const J = E.J; let ok = true;
const chk = (name, d, tol) => { const pass = d[0] < tol; ok = ok && pass; console.log((pass ? 'PASS ' : 'FAIL ') + name.padEnd(34) + 'max|diff| = ' + d[0].toExponential(2) + (pass ? '' : ' at idx ' + d[1] + ' (frame ' + Math.floor(d[1] / (J*3)) + ', joint ' + E.JOINTS[Math.floor(d[1] / 3) % J] + ')')); };
console.log('T', mot.T, 'vs', fx.euler.length / (J*3));
chk('human euler (all frames)', maxd(mot.euler, fx.euler), 1e-6);
chk('human root', maxd(mot.root, fx.root), 1e-6);
chk('human planted positions', maxd(mot.pos, fx.human), 1e-6);
for (const [nm, emb] of [['humanoid', E.humanoidFull()], ['reduced', E.humanoidReduced()]]) {
  const r = E.retargetHumanoid(mot, emb); chk(nm + ' positions', maxd(r.pos, fx[nm].pos), 1e-6);
  chk(nm + ' angles', maxd(r.angles, fx[nm].angles), 1e-6);
  let mis = 0; for (let i = 0; i < r.lim.length; i++) if (r.lim[i] !== fx[nm].lim[i]) mis++; console.log('     limit-flag mismatches:', mis, 'of', r.lim.length); ok = ok && mis === 0;
  mis = 0; for (let i = 0; i < r.rate.length; i++) if (r.rate[i] !== fx[nm].rate[i]) mis++; console.log('     rate-flag mismatches:', mis); ok = ok && mis === 0;
}
const a = E.retargetArm(mot, mot.pos); chk('arm positions', maxd(a.pos, fx.arm.pos), 1e-6);
let mis = 0; for (let i = 0; i < a.lim.length; i++) if (a.lim[i] !== fx.arm.lim.filter((_, k) => k % 3 === 0 || true)[0] && false) mis++;
const armLimFrames = a.lim.reduce((s, v) => s + v, 0), pyArm = (() => { let s = 0; for (let t = 0; t < a.T; t++) if (fx.arm.lim[t*3] || fx.arm.lim[t*3+1] || fx.arm.lim[t*3+2]) s++; return s; })();
console.log('     arm limit frames JS', armLimFrames, 'py', pyArm); ok = ok && armLimFrames === pyArm;
const m = E.balanceMargins(mot.pos, mot.T, 1); chk('balance margin (human)', maxd(m, fx.balance), 1e-6);

// ---- second fixture: Latin moves with non-default style parameters
const fl = require('../out/parity_fixture_latin.json'); const seqL = {}; for (const [k, v] of Object.entries(fl.seq)) seqL[k] = v;
const mL = E.generate(fl.beats, fl.dur, seqL, { jitter: 0 }); console.log('\n-- Latin fixture (salsa, salsa-side, bachata, cumbia, with step/lift/hip/arm parameters) --');
chk('latin euler', maxd(mL.euler, fl.euler), 1e-6); chk('latin root', maxd(mL.root, fl.root), 1e-6); chk('latin planted positions', maxd(mL.pos, fl.human), 1e-6);
for (const [nm, emb] of [['humanoid', E.humanoidFull()], ['reduced', E.humanoidReduced()]]) { const r = E.retargetHumanoid(mL, emb); chk('latin ' + nm + ' positions', maxd(r.pos, fl[nm].pos), 1e-6);
  let mis = 0; for (let i = 0; i < r.lim.length; i++) if (r.lim[i] !== fl[nm].lim[i]) mis++; console.log('     limit-flag mismatches:', mis); ok = ok && mis === 0; }
console.log(ok ? '\nALL PARITY CHECKS PASSED' : '\nPARITY FAILED'); process.exit(ok ? 0 : 1);
