"""Original (CC0) synthesized test tracks + beat tracking.

Using self-made tracks removes licence problems for public videos. Swap in any CC-licensed
wav/mp3 and the rest of the pipeline is unchanged (beats come from librosa, not from the synth).
"""
import numpy as np, soundfile as sf, librosa
from scipy.signal import butter, lfilter

SR = 22050
rng = np.random.default_rng(7)


def _env(n, decay):
    return np.exp(-np.arange(n) / (SR * decay))


def kick(dur=0.30):
    n = int(SR * dur); t = np.arange(n) / SR
    f = 120 * np.exp(-t * 18) + 45
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(n, 0.09) * 1.0


def snare(dur=0.22):
    n = int(SR * dur); t = np.arange(n) / SR
    noise = rng.standard_normal(n) * _env(n, 0.05)
    tone = np.sin(2 * np.pi * 190 * t) * _env(n, 0.04)
    return 0.6 * noise + 0.5 * tone


def hat(dur=0.07, open_=False):
    n = int(SR * (0.22 if open_ else dur))
    b, a = butter(2, 7000 / (SR / 2), 'high')
    return lfilter(b, a, rng.standard_normal(n)) * _env(n, 0.09 if open_ else 0.02) * 0.35


def tone(freq, dur, kind='saw', amp=0.2):
    n = int(SR * dur); t = np.arange(n) / SR
    if kind == 'saw':
        x = 2 * ((t * freq) % 1) - 1
        b, a = butter(2, min(2200, freq * 6) / (SR / 2)); x = lfilter(b, a, x)
    else:
        x = np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(2 * np.pi * freq * 2.005 * t)
    a_env = np.minimum(1, np.arange(n) / (SR * 0.01)) * np.exp(-np.arange(n) / (SR * dur * 0.9))
    return x * a_env * amp


def _place(buf, snd, t0):
    i = int(t0 * SR)
    if i < len(buf):
        buf[i:i + len(snd)] += snd[:len(buf) - i]


def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


def render(style, bpm, dur=16.0):
    buf = np.zeros(int(SR * dur)); beat = 60 / bpm
    nb = int(dur / beat) + 1
    K, S, H, HO = kick(), snare(), hat(), hat(open_=True)
    if style == 'groove':      # swung, laid-back
        prog = [45, 45, 48, 43]
        for b in range(nb):
            t = b * beat
            if b % 4 in (0, 2): _place(buf, K, t)
            if b % 4 in (1, 3): _place(buf, S, t)
            _place(buf, H, t); _place(buf, H * 0.7, t + beat * 0.62)
            _place(buf, tone(midi(prog[(b // 4) % 4]), beat * 1.8, 'saw', 0.30), t) if b % 2 == 0 else None
            if b % 4 == 0:
                for n in (60, 64, 67): _place(buf, tone(midi(n + prog[(b // 4) % 4] - 45), beat * 3.5, 'sine', 0.07), t)
    elif style == 'house':     # four on the floor
        prog = [45, 41, 43, 40]
        for b in range(nb):
            t = b * beat
            _place(buf, K, t)
            _place(buf, HO, t + beat * 0.5)
            if b % 2 == 1: _place(buf, S * 0.8, t)
            _place(buf, tone(midi(prog[(b // 4) % 4]), beat * 0.45, 'saw', 0.28), t + beat * 0.5)
            if b % 4 == 0:
                for n in (57, 60, 64): _place(buf, tone(midi(n + prog[(b // 4) % 4] - 45), beat * 0.35, 'sine', 0.10), t)
    else:                      # 'pop' fast, syncopated
        prog = [48, 52, 45, 43]
        for b in range(nb):
            t = b * beat
            if b % 4 in (0, 2): _place(buf, K, t)
            if b % 4 == 2: _place(buf, K, t + beat * 0.75)
            if b % 4 in (1, 3): _place(buf, S, t)
            for sub in range(4): _place(buf, H * (1.0 if sub % 2 == 0 else 0.5), t + sub * beat / 4)
            arp = [0, 4, 7, 12]
            for sub in range(2):
                _place(buf, tone(midi(60 + prog[(b // 4) % 4] - 48 + arp[(b * 2 + sub) % 4]), beat * 0.4, 'sine', 0.12), t + sub * beat / 2)
            _place(buf, tone(midi(prog[(b // 4) % 4] - 12), beat * 0.9, 'saw', 0.28), t)
    buf = np.tanh(buf * 1.2)
    buf /= np.abs(buf).max() / 0.9
    fade = int(SR * 0.05); buf[:fade] *= np.linspace(0, 1, fade); buf[-fade:] *= np.linspace(1, 0, fade)
    return buf.astype(np.float32)


TRACKS = {'groove': 92, 'house': 124, 'pop': 138}


def make_tracks(outdir):
    paths = {}
    for style, bpm in TRACKS.items():
        p = f'{outdir}/{style}.wav'
        sf.write(p, render(style, bpm), SR); paths[style] = p
    return paths


def detect_beats(path):
    y, sr = librosa.load(path, sr=SR)
    # percussive component only: on offbeat-bass house the full mix locked onto the offbeat (~200 ms phase error)
    yp = librosa.effects.percussive(y, margin=3.0)
    oenv = librosa.onset.onset_strength(y=yp, sr=sr)
    # 120 BPM prior avoids the 2/3-tempo lock-on seen on the raw-audio path
    tempo, t = librosa.beat.beat_track(onset_envelope=oenv, sr=sr, start_bpm=120, tightness=100, units='time')
    tempo = float(np.atleast_1d(tempo)[0])
    return tempo, t, len(y) / sr


# ============================================================ Latin-inspired synthetic tracks (original, CC0)
# Simplified textures meant to carry each style's characteristic rhythm; NOT authentic recordings.
LATIN_TRACKS = {'salsa': 170, 'cumbia': 88, 'bachata': 128}
LATIN_HINT = dict(LATIN_TRACKS)           # genre tempo prior handed to the beat tracker (salsa ~160-200, cumbia ~80-100, bachata ~120-140)


def _click(freq=2400, dur=0.05):
    n = int(SR * dur); t = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * t) * _env(n, 0.012) * 0.55


def _bell(dur=0.18):
    n = int(SR * dur); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 562 * t) + 0.8 * np.sin(2 * np.pi * 845 * t)) * _env(n, 0.06) * 0.22


def _conga(open_=True, dur=0.22):
    n = int(SR * dur); t = np.arange(n) / SR
    f = (210 if open_ else 300) * np.exp(-t * 9) + 150
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(n, 0.10 if open_ else 0.05)
    return (tone + (0.0 if open_ else 0.35) * rng.standard_normal(n) * _env(n, 0.012)) * 0.5


def _low_drum(dur=0.28):
    n = int(SR * dur); t = np.arange(n) / SR
    f = 95 * np.exp(-t * 14) + 70
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(n, 0.11) * 0.9


def _scrape(accent=1.0, dur=0.06):
    n = int(SR * dur); b, a = butter(2, 3500 / (SR / 2), 'high')
    return lfilter(b, a, rng.standard_normal(n)) * _env(n, 0.022) * 0.22 * accent


def _clap(dur=0.12):
    n = int(SR * dur); b, a = butter(2, [900 / (SR / 2), 4500 / (SR / 2)], 'band')
    return lfilter(b, a, rng.standard_normal(n)) * _env(n, 0.035) * 0.5


def _pluck(freq, dur=0.5, amp=0.16):
    n = int(SR * dur); t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * freq * k * t) / k ** 1.3 for k in range(1, 6))
    return x * np.exp(-t / 0.22) * np.minimum(1, t / 0.004) * amp


def _reed(freq, dur, amp=0.12):
    n = int(SR * dur); t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * freq * (1 + d) * t) for d in (-0.004, 0.0, 0.004)) + 0.5 * np.sin(2 * np.pi * freq * 2 * t)
    return x * np.minimum(1, t / 0.02) * np.exp(-t / (dur * 0.7)) * amp


def render_latin(style, bpm, dur=32.0):
    buf = np.zeros(int(SR * dur)); beat = 60 / bpm; e8 = beat / 2
    nb = int(dur / beat) + 2; n8 = int(dur / e8) + 2
    Am, Dm, E7, F, G = (57, 60, 64), (50, 53, 57), (52, 56, 59), (53, 57, 60), (55, 59, 62)
    if style == 'salsa':
        prog = [(Am, 45), (Dm, 38), (E7, 40), (Am, 45)]
        clave8 = {0, 3, 6, 10, 12}
        for b in range(nb): _place(buf, _bell(), b * beat)                        # quarter-note bell keeps the pulse
        for i in range(n8):
            t = i * e8; bar8 = i % 16
            if bar8 in clave8: _place(buf, _click(), t)
            q = i % 8
            if q == 2: _place(buf, _conga(False), t)
            if q == 3: _place(buf, _conga(True), t)
            if q == 6: _place(buf, _conga(False), t)
            if q == 7: _place(buf, _conga(True), t)
            chord, root = prog[(i // 16) % 4]
            if q in (3, 6): _place(buf, tone(midi(root), beat * 0.9, 'saw', 0.30), t)       # anticipated tumbao bass
            if q in (0, 3, 5, 6):
                for nn in chord: _place(buf, _pluck(midi(nn), 0.28, 0.10), t)               # montuno-style piano stabs
    elif style == 'cumbia':
        prog = [(Am, 45), (Dm, 38), (E7, 40), (Am, 45)]
        for b in range(nb):
            t = b * beat; chord, root = prog[(b // 4) % 4]
            if b % 2 == 1: _place(buf, _low_drum(), t)                                    # llamador on 2 and 4
            _place(buf, tone(midi(root + (7 if b % 2 else 0)), beat * 0.8, 'saw', 0.30), t) if b % 2 == 0 else None
            for sub in range(2):
                _place(buf, _scrape(1.0 if sub == 0 else 1.5), t + sub * e8)              # guacharaca scrape, offbeat accent
            for nn in chord: _place(buf, _reed(midi(nn + 12), beat * 0.4, 0.07), t + e8)   # offbeat chord chop
            if b % 4 in (1, 3): _place(buf, _conga(False), t + e8)
    else:  # bachata
        prog = [(Am, 45), (F, 41), (G, 43), (Am, 45)]
        for i in range(n8):
            t = i * e8; q = i % 8; b = i // 2
            chord, root = prog[(i // 8) % 4]
            _place(buf, _conga(q % 2 == 1), t) if q % 2 == 0 or q in (3, 7) else None     # bongo martillo
            _place(buf, _scrape(1.0 if q % 2 == 0 else 1.6), t)
            arp = [chord[0], chord[1], chord[2], chord[1]][(i % 4)]
            _place(buf, _pluck(midi(arp + 12), 0.45, 0.14), t)                            # guitar arpeggio
            if q in (0, 4): _place(buf, tone(midi(root), beat * 1.2, 'saw', 0.30), t)
            if q == 7: _place(buf, tone(midi(root + 7), beat * 0.45, 'saw', 0.26), t)
            if q == 6: _place(buf, _clap(), t)                                            # accent on beat 4: the step's "tap"
            if q == 0: _place(buf, _low_drum(), t)
    buf = np.tanh(buf * 1.1); buf /= np.abs(buf).max() / 0.9
    fade = int(SR * 0.05); buf[:fade] *= np.linspace(0, 1, fade); buf[-fade:] *= np.linspace(1, 0, fade)
    return buf.astype(np.float32)


def detect_beats_hint(path, bpm_hint):
    y, sr = librosa.load(path, sr=SR)
    yp = librosa.effects.percussive(y, margin=3.0)
    oenv = librosa.onset.onset_strength(y=yp, sr=sr)
    tempo, t = librosa.beat.beat_track(onset_envelope=oenv, sr=sr, start_bpm=bpm_hint, tightness=100, units='time')
    return float(np.atleast_1d(tempo)[0]), t, len(y) / sr


def estimate_downbeat(path, beats, per_bar=4):
    """Which beat is '1'? Chords change on bar lines, so pick the beat offset (0..per_bar-1) where beat-synchronous
    chroma changes most. Returns (offset, scores). Dances are counted from this beat."""
    y, sr = librosa.load(path, sr=SR)
    yh = librosa.effects.harmonic(y, margin=3.0)
    chroma = librosa.feature.chroma_cqt(y=yh, sr=sr)
    frames = librosa.time_to_frames(beats, sr=sr)
    C = librosa.util.sync(chroma, frames, aggregate=np.median)               # (12, nbeats+1)
    flux = np.linalg.norm(np.diff(C, axis=1), axis=0)                         # change arriving at beat k+1
    flux = np.concatenate([[0.0], flux])[:len(beats)]
    scores = np.array([flux[o::per_bar].mean() for o in range(per_bar)])
    return int(np.argmax(scores)), scores


def estimate_downbeat_clave(path, beats, clave8=(0, 3, 6, 10, 12)):
    """Salsa: the 3-2 son clave is a fixed asymmetric pattern, so aligning a template to a band-passed onset envelope finds beat 1
    of the 2-bar cycle. Returns (offset in beats 0..7, scores)."""
    y, sr = librosa.load(path, sr=SR)
    S = np.abs(librosa.stft(y, n_fft=1024, hop_length=256))
    f = librosa.fft_frequencies(sr=sr, n_fft=1024); band = S[(f > 1800) & (f < 3200)].sum(0)
    env = np.maximum(0, np.diff(band, prepend=band[0])); times = librosa.frames_to_time(np.arange(len(env)), sr=sr, hop_length=256)
    per = float(np.median(np.diff(beats))); scores = []
    for o in range(8):
        tot = 0.0; cnt = 0
        for c in range(0, (len(beats) - o) // 8):
            t0 = beats[o + 8 * c]
            for slot in clave8:
                t = t0 + slot * per / 2; i = np.searchsorted(times, t)
                tot += env[max(0, i - 2):i + 3].max() if i < len(env) else 0; cnt += 1
        scores.append(tot / max(cnt, 1))
    return int(np.argmax(scores)), np.array(scores)
