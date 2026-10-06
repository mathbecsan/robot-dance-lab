const E = require('./engine.js'), B = require('../out/beats_latin.json'); const f = x => (100 * x).toFixed(0).padStart(3) + '%';
let all = [];
for (const v of [3, 2]) { console.log(`\n=== motors limited to ${v} rad/s: curriculum learning (lessons carry parameters forward), 24 trials/lesson ===`);
 for (const style of Object.keys(E.STYLES)) for (const [bn, mk] of [['full humanoid', () => ({ kind: 'h', emb: E.humanoidFull(.77, v) })], ['reduced', () => ({ kind: 'h', emb: E.humanoidReduced(.77, v) })]]) {
  let theta = Object.assign({}, E.TEACHER); const line = [];
  for (const lesson of E.LESSONS) { const b = mk(), L = E.makeLearner({ style, kind: b.kind, emb: b.emb, lesson, beats: B[style].beats, theta, trials: 24, seed: 11 + lesson.id }), s0 = L.before.sc.score, t0 = L.before.ev.timingMs; while (!L.done) L.step(); theta = L.theta;
    line.push(`L${lesson.id} ${s0}→${L.cur.sc.score}`); all.push({ v, style, bn, lesson: lesson.id, s0, s1: L.cur.sc.score, ms0: t0, ms1: L.cur.ev.timingMs, fid0: L.before.ev.fidelity, fid1: L.cur.ev.fidelity }); }
  console.log(style.padEnd(8), bn.padEnd(13), line.join('  '), '| learned', Object.entries(theta).map(([k, x]) => k + ' ' + Math.round(x * 100) + '%').join(' ')); } }
const imp = all.filter(r => r.s1 > r.s0), worse = all.filter(r => r.s1 < r.s0);
console.log('\nimproved', imp.length, '/', all.length, '| never worse:', worse.length === 0, '| mean gain when improved', (imp.reduce((s, r) => s + r.s1 - r.s0, 0) / Math.max(1, imp.length)).toFixed(1), '| max gain', Math.max(...all.map(r => r.s1 - r.s0)));
console.log('largest gains:', all.filter(r => r.s1 - r.s0 >= 5).map(r => `${r.style}/${r.bn}/${r.v}rad/s/L${r.lesson}: ${r.s0}→${r.s1} (lateness ${Math.round(r.ms0)}→${Math.round(r.ms1)} ms, fidelity ${f(r.fid0)}→${f(r.fid1)})`).join('\n               '));
