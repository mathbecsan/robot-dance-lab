"""Orthographic OpenCV renderer -> mp4 (with audio). No GPU/OpenGL needed.
Overlay mode (red = joint-limit loss, orange = speed-limit, green/red CoM dot, beat pulse) is for analysis videos.
Neutral mode (identical style for every embodiment, no overlays) is for the perception study."""
import subprocess, numpy as np, cv2
from .skeleton import BONES, IDX

BG = (250, 248, 245)
CAM = dict(yaw=0.55, pitch=0.20)
STYLE = {'human': (60, 60, 60), 'humanoid': (180, 119, 31), 'reduced': (14, 127, 255), 'arm': (44, 160, 44),
         'neutral': (85, 70, 60)}
THICK = {(0, 1): 11, (1, 2): 13, (2, 3): 6, (3, 4): 4, (2, 5): 8, (2, 8): 8, (0, 11): 9, (0, 15): 9}


def project(P, W, H, s, yaw=CAM['yaw'], pitch=CAM['pitch'], gy=0.88):
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    xr = x * np.cos(yaw) + z * np.sin(yaw)
    zr = -x * np.sin(yaw) + z * np.cos(yaw)
    yv = y * np.cos(pitch) - zr * np.sin(pitch)
    return np.stack([W / 2 + s * xr, H * gy - s * yv], -1)


def _floor(img, W, H, s):
    for g in np.arange(-1.2, 1.21, 0.4):
        a = project(np.array([g, 0, -1.2]), W, H, s); b = project(np.array([g, 0, 1.2]), W, H, s)
        c = project(np.array([-1.2, 0, g]), W, H, s); d = project(np.array([1.2, 0, g]), W, H, s)
        cv2.line(img, tuple(a.astype(int)), tuple(b.astype(int)), (225, 222, 218), 1, cv2.LINE_AA)
        cv2.line(img, tuple(c.astype(int)), tuple(d.astype(int)), (225, 222, 218), 1, cv2.LINE_AA)


def draw(img, pos_t, bones, kind, color, scale=1.0, W=420, H=420, s=170, clip=None, rate=None, com=None, com_ok=None, joints=False):
    _floor(img, W, H, s)
    p2 = project(pos_t, W, H, s)
    # soft shadow under the root
    sh = project(np.array([pos_t[0, 0], 0, pos_t[0, 2]]) if kind != 'arm' else np.array([0, 0, 0]), W, H, s)
    cv2.ellipse(img, tuple(sh.astype(int)), (int(36 * scale + 10), int(11 * scale + 4)), 0, 0, 360, (232, 229, 226), -1, cv2.LINE_AA)
    if kind == 'arm':
        base = p2[0].astype(int); sho = p2[1].astype(int)
        cv2.ellipse(img, tuple(base), (34, 10), 0, 0, 360, (150, 150, 150), -1, cv2.LINE_AA)
        cv2.line(img, tuple(base), tuple(sho), (170, 170, 170), 16, cv2.LINE_AA)
        for (a, b), th in zip([(1, 2), (2, 3)], (14, 11)):
            cv2.line(img, tuple(p2[a].astype(int)), tuple(p2[b].astype(int)), color, th, cv2.LINE_AA)
        for j in (1, 2):
            cv2.circle(img, tuple(p2[j].astype(int)), 9, (255, 255, 255), -1, cv2.LINE_AA); cv2.circle(img, tuple(p2[j].astype(int)), 9, color, 2, cv2.LINE_AA)
        tip = p2[3].astype(int)
        cv2.circle(img, tuple(tip), 8, color, -1, cv2.LINE_AA)
        # gripper hint
        return
    order = sorted(range(len(bones)), key=lambda i: -(pos_t[bones[i][0], 2] * np.cos(CAM['yaw']) - pos_t[bones[i][0], 0] * np.sin(CAM['yaw'])))
    for i in order:
        a, b = bones[i]
        th = int(THICK.get((a, b), 6) * (0.9 + 0.25 * scale))
        cv2.line(img, tuple(p2[a].astype(int)), tuple(p2[b].astype(int)), color, th, cv2.LINE_AA)
    hd = p2[IDX['head']].astype(int)
    cv2.circle(img, (hd[0], hd[1] - int(0.07 * s * scale)), int(0.095 * s * scale), color, -1, cv2.LINE_AA)
    if joints:
        for j in range(len(p2)):
            if j in (IDX['ltoe'], IDX['rtoe'], IDX['head']): continue
            cv2.circle(img, tuple(p2[j].astype(int)), 5, (255, 255, 255), -1, cv2.LINE_AA); cv2.circle(img, tuple(p2[j].astype(int)), 5, color, 1, cv2.LINE_AA)
    if clip is not None:
        for j in np.where(clip)[0]:
            cv2.circle(img, tuple(p2[j].astype(int)), 11, (40, 40, 220), 3, cv2.LINE_AA)
    if rate is not None:
        for j in np.where(rate & ~(clip if clip is not None else False))[0]:
            cv2.circle(img, tuple(p2[j].astype(int)), 10, (0, 150, 255), 2, cv2.LINE_AA)
    if com is not None:
        c = project(np.array([com[0], 0, com[2]]), W, H, s).astype(int)
        cv2.circle(img, tuple(c), 6, (60, 170, 60) if com_ok else (40, 40, 220), -1, cv2.LINE_AA)


def _ffmpeg(path, W, H, fps, audio=None, ss=0, t=None):
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(fps), '-i', '-']
    if audio:
        cmd += ['-ss', str(ss)] + (['-t', str(t)] if t else []) + ['-i', audio, '-c:a', 'aac', '-b:a', '128k', '-shortest']
    cmd += ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', path]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)


def _com(pos):
    from .skeleton import com as _c
    return _c(pos)


def render_analysis(bundle, genre, audio_path, outpath, label):
    b = bundle[genre]; mot = b['motion']; fps = mot.fps; T = mot.T
    from .skeleton import BONES as BN
    panels = [('human', 'AI human (stand-in)', b['human_pos'], BN, 'human', 1.0, None, None),
              ('humanoid', 'Full humanoid (G1-like)', b['robots']['humanoid'].pos, BN, 'humanoid', 0.77, b['robots']['humanoid'], 1),
              ('reduced', 'Reduced humanoid', b['robots']['reduced'].pos, BN, 'reduced', 0.77, b['robots']['reduced'], 1),
              ('arm', 'Robot arm (wrist -> tip)', b['robots']['arm'].pos, b['robots']['arm'].bones, 'arm', 1.0, b['robots']['arm'], 0)]
    pw, ph, top = 420, 440, 56
    W, H = pw * 4, ph + top
    ff = _ffmpeg(outpath, W, H, fps, audio_path, 0, T / fps)
    beats = np.asarray(b['beats'])
    for t in range(T):
        img = np.full((H, W, 3), 255, np.uint8); img[:top] = (245, 243, 240)
        cv2.putText(img, f'{label}  |  {b["tempo"]:.0f} bpm  |  t = {t / fps:4.1f}s', (14, 36), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (50, 50, 50), 2, cv2.LINE_AA)
        last = beats[beats <= t / fps]; pulse = float(np.exp(-(t / fps - last[-1]) / 0.12)) if len(last) else 0
        cv2.circle(img, (W - 40, 28), int(8 + 14 * pulse), (60, 60, 230), -1 if pulse > 0.15 else 2, cv2.LINE_AA)
        for k, (nm, title, pos, bones, kind, sc, rob, hum) in enumerate(panels):
            pan = np.full((ph, pw, 3), BG, np.uint8)
            clip = rob.limit_clip[t] if (rob is not None and kind != 'arm') else None
            rate = rob.rate_clip[t] if (rob is not None and kind != 'arm') else None
            mg = b['margins'].get(nm)
            comv = _com(pos[t:t + 1])[0] if kind != 'arm' else None
            draw(pan, pos[t], bones, kind, STYLE[nm], sc, pw, ph, 170, clip, rate, comv, (mg[t] >= 0) if mg is not None else None, joints=(nm != 'human'))
            cv2.putText(pan, title, (12, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.62, (50, 50, 50), 2, cv2.LINE_AA)
            if kind == 'arm':
                r = rob.extras['reach_loss'][t]
                if r > 0: cv2.putText(pan, 'out of reach', (12, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (40, 40, 220), 1, cv2.LINE_AA)
            img[top:, k * pw:(k + 1) * pw] = pan
            if k: cv2.line(img, (k * pw, top), (k * pw, H), (220, 220, 220), 1)
        ff.stdin.write(img.tobytes())
    ff.stdin.close(); ff.wait()


def render_study_clip(bundle, genre, emb, outpath, t0=4.0, dur=8.0, size=480):
    """neutral style, no overlays, no labels. Silent (audio muxed later so matched/mismatched share visuals)."""
    b = bundle[genre]; fps = b['motion'].fps
    from .skeleton import BONES as BN
    pos = b['human_pos'] if emb == 'human' else b['robots'][emb].pos
    bones = BN if emb != 'arm' else b['robots']['arm'].bones
    sc = 1.0 if emb in ('human', 'arm') else 0.77
    kind = 'arm' if emb == 'arm' else 'h'
    ff = _ffmpeg(outpath, size, size, fps)
    for t in range(int(t0 * fps), int((t0 + dur) * fps)):
        img = np.full((size, size, 3), BG, np.uint8)
        # equalise on-screen height / stroke / joint markers: only the MOTION (and the arm's body plan) should differ
        draw(img, pos[t], bones, kind, STYLE['neutral'], (sc if kind == 'h' else 1.0), size, size, int(size * 0.405 / (sc if kind == 'h' else 1.0)), joints=True)
        ff.stdin.write(img.tobytes())
    ff.stdin.close(); ff.wait()


def mux(video, audio, out, ss, t):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', video, '-ss', str(ss), '-t', str(t), '-i', audio, '-map', '0:v', '-map', '1:a',
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', out], check=True)
