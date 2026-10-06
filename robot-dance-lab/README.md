# Robot Dance Lab

**Does a robot need a human body to dance like a human?** An interactive lab (plus the research pipeline behind it) where you describe a dance in plain words, a dancer performs it, and different robot bodies try to follow it. Includes a Dance school where a robot learns salsa, cumbia or bachata.

- **Play it:** open `docs/index.html` in a browser (one self-contained file, works offline, has sound). If GitHub Pages is on, it is served at `https://mathbecsan.github.io/robot-dance-lab/`.
- **Research viewer:** `docs/research-viewer.html` (the earlier four-bodies comparison).
- **Status:** a class mini-project / prototype. The dancer is a rule-based stand-in (not a trained model), joint limits are approximations, the dance steps are simplified and **not reviewed by dancers**, and the perception study is built but **has not been run**. See the cautions below before quoting any number.

Built with AI assistance (Claude, Anthropic) for the code, tests and documentation, directed and reviewed by the repo owner.

---

# Music → Dance → Robot: the embodiment gap (simulation prototype)

**Question:** does a robot need a human body to dance like a human?
**Pipeline:** music → beats → AI-style human dance → retarget to 3 robot bodies → metrics → videos → interactive viewer → perception-study kit.

Open **`out/viewer.html`** (single offline file) first. Press Play, switch songs, drag to rotate.

## What exists, and how far it is verified

| Piece | Status |
|---|---|
| Beat tracking (librosa on percussive component) | Verified against the synthesizer's true beat grid: ≤ 26 ms median error on all 3 tracks. (A first attempt locked onto the offbeat on house, ~200 ms off; fixed.) |
| Skeleton, FK, analytic leg IK | Unit-tested (bone lengths constant, IK reaches target to 1e-9, retarget-identity test). |
| **Music→dance model** | **STAND-IN.** A beat-locked procedural dancer, *not EDGE* (no GPU / checkpoint access when this was built). Its beat alignment is optimistic by construction. |
| EDGE / SMPL adapter (`edge_adapter.py`) | Exact round-trip tested on my skeleton. **Not yet tested on real EDGE files**; check orientation on first load (`root_fix`). |
| Humanoid retargeting | Joint-space: lock missing DoFs → clamp to range → rate-limit → scale → re-plant feet. Ranges are **G1-inspired approximations**, not read from the MJCF. |
| Robot arm | Hand-written rules (wrist→tip 1:1, closed-form IK, limits). Unit-tested to be exact when unconstrained. |
| Metrics | BAS (EDGE convention, 3 frames @30fps) with a chance baseline, DTW retention, limit/rate losses, foot skating, quasi-static balance. |
| Physics (Tier 2) | **Not done.** Balance is a conservative standing test, not a fall prediction. |
| Perception study | **Built and smoke-tested (16 trials, gating, CSV), not run.** Needs IRB / consent text. Analysis script tested on simulated data only. |

## Results on the stand-in (15 clips = 3 songs × 5 dances; treat as method demonstration)

| | beat alignment above chance | right-wrist error (DTW) | frames with lost motion | joint-angle motion kept |
|---|---|---|---|---|
| AI human | 0.270 | – | – | – |
| Full humanoid | 0.255 | 0.044 | 40% | 81% |
| Reduced humanoid | 0.351 | 0.075 | 77% | 76% |
| Robot arm | 0.285 | 0.004 | 4% | wrist only |

1. **Little breaks the full humanoid, but what breaks is specific.** Only overhead arms (shoulder-roll limit, 85% of those frames) and lateral step-touch (hip/ankle roll, 14%). Kicks, squats, bounces, arm pumps pass.
2. **The reduced humanoid loses a lot more**: torso twist 94%, squat 90%, arm wave 80%, step-touch 70%, sway 49%, kick 32% of frames. Right-wrist error is +0.032 vs the full humanoid (paired Wilcoxon p<0.001, n=15).
3. **Joint speed is a hidden bottleneck.** Below ~6 rad/s the fast track loses most of its beat alignment (`results/fig2_speed_limit.png`); slow music tolerates ~3 rad/s.
4. **Beat alignment is a poor judge here.** The reduced humanoid *scores higher* than the human (+0.08, CI +0.02 to +0.14, p=0.075) just because it moves less; BAS correlates with the count of kinematic beats (ρ=0.52) and varies 0.0–0.6 across seeds of the same song. This is why the human rating study is the real test.
5. **The arm "keeps" the wrist almost perfectly** (error 0.004) only because it was given one point to follow: retention is not like-for-like across body plans.
6. Foot skating and quasi-static instability are statistically near-identical for human and robots (~2–7%): kinematic playback cannot separate them. That gap is exactly what Tier 2 physics must fill.

## Run it
```
pip install numpy scipy matplotlib pandas librosa soundfile statsmodels opencv-python   # + ffmpeg
python tests/test_core.py        # 10 tests
python run_pipeline.py           # ~30 s: tracks, dances, retarget, metrics, figures -> results/
python analyze.py                # paired stats
python render_all.py             # comparison videos -> out/videos/
python make_study.py             # 16 neutral clips -> study/stimuli/
python build_viewer.py           # -> out/viewer.html
```
Study: `cd study && python -m http.server` then open `index.html?pid=P01` (add `&post=URL` to POST the CSV). Analyse: `python study/analysis.py --data study/data`. Add your IRB consent text first. Stimuli equalise on-screen height, stroke and joint markers, so only motion (and the arm's body plan) differs; one mismatched-music control per body.

## Next steps, in order of payoff
1. **Real dancer:** run EDGE in Colab on the three tracks (`test.py --save_motions`; check the repo README for current flags), load with `edge_adapter.load_edge_pkl`, rerun everything. Expect lower, noisier beat alignment than the stand-in.
2. **Real robot limits:** read G1 ranges and link lengths from `mujoco_menagerie/unitree_g1`; replace `humanoid_full()`; try GMR keypoint IK next to joint-space copy and report both.
3. **Tier 2:** physics tracking in MuJoCo/Isaac with a pretrained motion tracker; fall rate by move type is the strongest quantitative result still missing.
4. **Run the study** (n≈24, within-subject), then write up.

Layout: `dancebot/` library · `run_pipeline.py` · `analyze.py` · `render_all.py` · `make_study.py` · `build_viewer.py` · `results/` (CSVs, figures) · `out/` (viewer, videos) · `study/` (page, stimuli, analysis) · `tests/`.

---
## Robot Dance Lab (`docs/index.html`): the interactive, gamified version

Single offline file. Four modes:
- **Studio**: type a dance in plain words; a rule-based dancer performs it on the beat; the full humanoid, reduced humanoid, robot arm and *your* robot each try to follow. Ghost = the pose it was asked for; magenta rings = joints that could not follow; click a ring to open the **joint inspector** (human angle vs robot angle vs its limit) and a "where it failed" timeline. Eight missions, a motor-speed slider, balance dot, orbit camera.
- **Workshop**: build a robot on a 12-point joint budget and audition it. The cost-vs-fidelity chart comes from trying all 18,432 builds. Under this model the best 12-point build scores 92.2% and the all-joints G1-style build (19 points) 90.2%: the right joint with enough range beats more joints.
- **Listening test**: the study's swapped-music control as a 5-round game.
- **The study**: the pipeline, glossary, pooled results, and "show me" buttons that stage live demos.

How it stays honest:
- The whole motion/retarget/metric engine was **ported to JavaScript** (`web/engine.js`) and checked against Python: joint angles, planted positions, humanoid/reduced/arm retargets, limit and rate flags, balance margins all match to ~1e-14 (`node web/parity_test.js`, fixture from `game_assets.py`).
- The prompt is read by a **keyword matcher, not a language model**; it echoes what it understood and lists words it did not. To upgrade: have an LLM return the same `{phrases:[{leg,arm,e}]}` JSON. Moves are limited to the 11-move vocabulary; extending it means adding a move to `motion.py` and `engine.js` (parity test will tell you if they diverge).
- In-game **fidelity** (head/hands/feet vs the human, relative to the human's own movement from standing) and **beat lock** (simplified BAS) are game metrics, deliberately simpler than the research ones in `dancebot/metrics.py`. Scores, missions and the "best build" are properties of this model, not measurements of real robots or people.
- UI logic was exercised by a scripted full session (prompts, all bodies, 5 missions, Workshop, 5-round listening test, every demo button) with no runtime errors, and frames were rendered and inspected. It has not been opened in a real browser or tested on touch devices.

Rebuild: `python game_assets.py && node web/budget.js && python build_game.py`. Tests: `node web/parity_test.js && node web/parser_test.js`.

---
## Salsa, cumbia, bachata + the Dance school (robots that learn)

**New styles.** Three original synthesized tracks (`dancebot/audio.py::render_latin`; CC0) built around each genre's signature rhythm (salsa: 3-2 clave, conga, anticipated bass; cumbia: scraper, low llamador drum, offbeat chord chop; bachata: bongo, guira, plucked arpeggio, clap on 4), and four hand-authored step patterns (`salsa_basic`, `salsa_side`, `cumbia_basic`, `bachata_basic`) with matching arm styles, in both Python (`dancebot/motion.py`) and JavaScript (`web/engine.js`). The JS port matches Python to ~1e-14 including the style parameters (`node web/parity_test.js`).

**Dance counted from the right beat.** Beat trackers find beats but not which one is "1". All three tracks' first detected beat was beat 2 of the bar, so a naive dance would have started a count late. Salsa uses a **clave-template match** (clear winner, 1.0 vs 0.71); cumbia and bachata use **chord-change detection**. The chroma method got salsa wrong (syncopated music avoids stressing beat 1), which is why salsa has its own detector. A genre tempo prior is given to the tracker (salsa ~160-200, cumbia ~80-100, bachata ~120-140). Resulting beat phase error: 21-25 ms. These detectors were validated only on my own synthetic tracks.

**Learning.** The Dance school runs a 4-lesson curriculum (feet only -> + hips -> + arms -> full tempo; lessons 1-3 at 60% speed). The student robot tries random variations of four numbers (step length, foot lift, hip movement, arm height), runs the dance through its body's real joint ranges and motor speed, scores itself against the teacher (accuracy 50% / step timing 30% / balance 20%), and keeps a change only if the score improves. That is a (1+1) hill-climber, **not deep learning**. Step timing = how close each footfall lands to the teacher's footfall (slow motors land late).

What the evidence says (`results/learning_evidence.txt`, `node web/learning_evidence.js`):
- With motors limited to 2-3 rad/s, learning helped in 12 of 48 lesson runs (mean +10 points, max +15) and **never made a score worse**. Example: salsa, 3 rad/s, full tempo: 85 -> 96, step lateness 103 ms -> 6 ms, at a cost of ~3 points of accuracy.
- At 8 rad/s or above these steps need **almost no learning**; cumbia needs none at any speed (its dragged steps are slow and small). Joint count barely mattered for these steps (full and reduced humanoids learned identically); **motor speed** did.
- The robot arm cannot learn footwork: learning adapts within a body, it cannot add joints.
- Early in development I found my beat-lock metric penalised a perfect copy (the teacher itself scored 8% on it for step dances) and replaced it with the step-timing measure for the School; the Studio score now compares against the teacher's own beat lock.

**Limits and cautions.**
- The step patterns are **simplified sketches written by me, not reviewed by dancers or teachers**. Cumbia in particular varies widely by region (Colombian, Peruvian chicha, Mexican...). The tracks are synthetic, not authentic recordings. Have people who dance these styles correct the steps (the key lists are in `latin_leg` in `motion.py` / `engine.js`, a few lines each).
- Weight-shift timing was tuned so the teacher passes the balance check: salsa and cumbia 0% unstable frames, bachata and salsa-side 10-15% marginal (< 1.5 cm).
- Learning is kinematic only (no physics) and the joint ranges are G1-inspired approximations, as elsewhere.

Rebuild: `python game_assets.py && node web/budget.js && python build_game.py`. Tests: `python tests/test_core.py && node web/parity_test.js && node web/parser_test.js`.
