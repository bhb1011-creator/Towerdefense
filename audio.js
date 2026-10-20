"use strict";

// Musik und Soundeffekte, komplett im Browser erzeugt (Web Audio API, keine Dateien).
// Der Soundtrack ist ein entspannter 80er-Synthwave-Track in A-Moll mit 88 BPM.

const Sound = (() => {
  let ctx = null;
  let musicGain, sfxGain, musicBus, reverb, delay, delayFeedback, compressor, duck, sfxVerb;
  let settings = { music: true, musicVol: 0.5, sfx: true, sfxVol: 0.6 };
  let noiseBuffer = null;
  const lastPlayed = {};

  // ---------- Grundaufbau ----------
  // offline: optionaler eigener Audio-Kontext (z. B. für Hörproben ohne Musik)
  function init(offline) {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC && !offline) return;
    ctx = offline || new AC();

    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.ratio.value = 3;
    compressor.connect(ctx.destination);

    musicGain = ctx.createGain();
    musicGain.connect(compressor);
    sfxGain = ctx.createGain();
    sfxGain.connect(compressor);
    // eigener Hall für die Effekte (Aliens klingen räumlich, auch wenn die Musik aus ist)
    sfxVerb = ctx.createConvolver();
    sfxVerb.buffer = impulseResponse(1.8, 2.6);
    const sfxVerbGain = ctx.createGain();
    sfxVerbGain.gain.value = 0.5;
    sfxVerb.connect(sfxVerbGain);
    sfxVerbGain.connect(sfxGain);

    // "Pumpen" der Musik im Takt der Bassdrum (Sidechain-Effekt)
    duck = ctx.createGain();
    duck.connect(musicGain);
    musicBus = ctx.createGain();
    musicBus.connect(duck);

    reverb = ctx.createConvolver();
    reverb.buffer = impulseResponse(2.8, 2.2);
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.35;
    reverb.connect(reverbGain);
    reverbGain.connect(duck);

    delay = ctx.createDelay(1.5);
    delay.delayTime.value = (60 / BPM) * 0.75; // punktierte Achtel
    delayFeedback = ctx.createGain();
    delayFeedback.gain.value = 0.38;
    const delayFilter = ctx.createBiquadFilter();
    delayFilter.type = "lowpass";
    delayFilter.frequency.value = 2200;
    delay.connect(delayFilter);
    delayFilter.connect(delayFeedback);
    delayFeedback.connect(delay);
    delayFilter.connect(duck);
    delayFilter.connect(reverb);

    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    applySettings(settings);
    if (!offline) startMusic();
  }

  function impulseResponse(seconds, decay) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function applySettings(s) {
    settings = { ...settings, ...s };
    if (!ctx) return;
    const t = ctx.currentTime;
    musicGain.gain.setTargetAtTime(settings.music ? settings.musicVol * 0.55 : 0, t, 0.3);
    sfxGain.gain.setTargetAtTime(settings.sfx ? settings.sfxVol * 0.9 : 0, t, 0.05);
  }

  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // ---------- Musik ----------
  const BPM = 88;
  const STEP = 60 / BPM / 4; // Sechzehntel
  // Akkorde: Fmaj7 – G6 – Em7 – Am7 (je ein Takt)
  const CHORDS = [
    { root: 41, notes: [53, 57, 60, 64] },
    { root: 43, notes: [55, 59, 62, 64] },
    { root: 40, notes: [52, 55, 59, 62] },
    { root: 45, notes: [57, 60, 64, 67] },
  ];
  // Melodie über 8 Takte: [Takt, Sechzehntel, MIDI-Note, Länge in Sechzehnteln]
  const MELODY = [
    [0, 0, 76, 6], [0, 6, 74, 2], [0, 8, 72, 8],
    [1, 0, 74, 4], [1, 4, 76, 4], [1, 8, 79, 8],
    [2, 0, 76, 6], [2, 6, 74, 2], [2, 8, 71, 6], [2, 14, 72, 2],
    [3, 0, 69, 12],
    [4, 0, 72, 4], [4, 4, 74, 4], [4, 8, 76, 8],
    [5, 0, 79, 4], [5, 4, 81, 4], [5, 8, 79, 6], [5, 14, 76, 2],
    [6, 0, 74, 8], [6, 8, 76, 4], [6, 12, 74, 4],
    [7, 0, 72, 4], [7, 4, 71, 4], [7, 8, 69, 8],
  ];
  let musicTimer = null;
  let nextTime = 0;
  let step = 0;

  function startMusic() {
    if (musicTimer) return;
    nextTime = ctx.currentTime + 0.1;
    step = 0;
    musicTimer = setInterval(schedule, 25);
  }

  function schedule() {
    while (nextTime < ctx.currentTime + 0.15) {
      playStep(step, nextTime);
      nextTime += STEP;
      step++;
    }
  }

  function playStep(i, t) {
    const bar = Math.floor(i / 16);
    const s = i % 16;
    const section = bar % 16; // 16 Takte: Intro (0–3), Hauptteil (4–15)
    const loop = Math.floor(bar / 16);
    const chord = CHORDS[bar % 4];

    if (s === 0) pad(chord.notes, t, STEP * 16);
    // rollender Achtel-Bass
    if (s % 2 === 0) bass(chord.root + (s % 4 === 2 ? 12 : 0), t, STEP * 1.8, section < 2 ? 0.5 : 1);
    // Schlagzeug
    if (section >= 2) {
      if (s === 0 || s === 8 || (s === 11 && bar % 2 === 1)) kick(t);
      if (s === 4 || s === 12) snare(t);
      if (s % 2 === 0) hat(t, s % 4 === 2 ? 0.05 : 0.03, 0.04);
      if (s === 14 && bar % 4 === 3) hat(t, 0.04, 0.22);
    } else if (s % 4 === 2) hat(t, 0.025, 0.04);
    // Arpeggio ab Takt 4
    if (section >= 4 && s % 2 === 0) {
      const order = [0, 1, 2, 3, 2, 1, 3, 2];
      arp(chord.notes[order[(s / 2) % 8]] + 12, t, STEP * 1.6);
    }
    // Melodie im zweiten Teil, jede zweite Runde eine Oktave tiefer und sanfter
    if (section >= 8) {
      const mBar = section - 8;
      for (const [b, st, note, len] of MELODY) {
        if (b === mBar && st === s) lead(note - (loop % 2 ? 12 : 0), t, len * STEP);
      }
    }
  }

  function voice(type, freq, t, dur, gain, dest, { attack = 0.01, release = 0.2, detune = 0, filter = null } = {}) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || "lowpass";
      f.frequency.setValueAtTime(filter.freq, t);
      if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t + dur);
      f.Q.value = filter.q || 0.7;
      o.connect(f);
      node = f;
    }
    node.connect(g);
    if (Array.isArray(dest)) dest.forEach((d) => g.connect(d));
    else g.connect(dest);
    o.start(t);
    o.stop(t + dur + release + 0.05);
    return o;
  }

  function pad(notes, t, dur) {
    for (const n of notes) {
      for (const det of [-8, 8]) {
        voice("sawtooth", midi(n), t, dur, 0.022, [musicBus, reverb], { attack: 0.9, release: 1.4, detune: det, filter: { freq: 900, q: 0.5 } });
      }
    }
  }

  function bass(n, t, dur, vol) {
    voice("sawtooth", midi(n), t, dur, 0.07 * vol, musicBus, { attack: 0.005, release: 0.08, filter: { freq: 900, to: 300, q: 4 } });
    voice("sine", midi(n - 12), t, dur, 0.06 * vol, musicBus, { attack: 0.005, release: 0.1 });
  }

  function arp(n, t, dur) {
    voice("triangle", midi(n), t, dur, 0.035, [musicBus, delay], { attack: 0.005, release: 0.15, filter: { freq: 3200 } });
  }

  function lead(n, t, dur) {
    const o = voice("sine", midi(n), t, dur, 0.06, [musicBus, delay, reverb], { attack: 0.06, release: 0.6 });
    voice("triangle", midi(n), t, dur, 0.018, [musicBus, delay], { attack: 0.08, release: 0.5, detune: 6 });
    // leichtes Vibrato
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 5.2;
    lfoGain.gain.setValueAtTime(0, t);
    lfoGain.gain.linearRampToValueAtTime(midi(n) * 0.006, t + Math.min(0.6, dur));
    lfo.connect(lfoGain);
    lfoGain.connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.7);
  }

  function kick(t) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g);
    g.connect(musicBus);
    o.start(t);
    o.stop(t + 0.4);
    // Musik kurz absenken (Pump-Effekt)
    duck.gain.cancelScheduledValues(t);
    duck.gain.setValueAtTime(0.7, t);
    duck.gain.linearRampToValueAtTime(1, t + 0.28);
  }

  function noise(t, dur, gain, dest, filterType, freq, freqTo, q = 0.8) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    if (Array.isArray(dest)) dest.forEach((d) => g.connect(d));
    else g.connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  function snare(t) {
    noise(t, 0.25, 0.12, [musicBus, reverb], "bandpass", 1800, 900, 0.6);
    voice("triangle", 190, t, 0.06, 0.06, musicBus, { attack: 0.002, release: 0.08 });
  }

  function hat(t, gain, dur) {
    noise(t, dur, gain, musicBus, "highpass", 7500);
  }

  // ---------- Alien-Stimmen ----------
  // Formant-Synthese: eine raue Quelle (Sägezahn + Unterton + Atem) wird durch drei
  // Bandpässe geschickt, die wie Vokale klingen. Wandernde Formanten = "Sprechen", Verzerrung = Knurren.
  const VOWELS = {
    a: [800, 1150, 2900], o: [450, 800, 2830], u: [325, 700, 2700], e: [400, 1600, 2700], i: [300, 2200, 3000], x: [600, 1900, 3600],
  };
  const shaperCurves = new Map();
  function shaperCurve(amount) {
    const key = Math.round(amount * 10);
    if (!shaperCurves.has(key)) {
      const n = 1024;
      const c = new Float32Array(n);
      const k = amount * 60 + 1;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
      }
      shaperCurves.set(key, c);
    }
    return shaperCurves.get(key);
  }

  // pitch: Liste von Tonhöhen über die Dauer, vowels: Vokalfolge, shift: Formanten verschieben (klein = höher)
  function creature(t, { pitch, dur, vowels, shift = 1, gain = 0.05, rough = 0.3, vib = 6, vibDepth = 0.03, breath = 0.2, drive = 0.3, ring = 0, verb = 0.3, q = 7 }) {
    const end = t + dur;
    const src = ctx.createGain();
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const sub = ctx.createOscillator();
    sub.type = "square";
    const pts = pitch.length > 1 ? pitch : [pitch[0], pitch[0]];
    osc.frequency.setValueAtTime(pts[0], t);
    sub.frequency.setValueAtTime(pts[0] * 0.5, t);
    pts.forEach((f, i) => {
      if (i === 0) return;
      const at = t + (dur * i) / (pts.length - 1);
      osc.frequency.exponentialRampToValueAtTime(f, at);
      sub.frequency.exponentialRampToValueAtTime(f * 0.5 * 1.01, at);
    });
    // Vibrato bzw. Zittern
    const lfo = ctx.createOscillator();
    lfo.frequency.value = vib;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = pts[0] * vibDepth;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfoGain.connect(sub.frequency);
    const subGain = ctx.createGain();
    subGain.gain.value = rough;
    osc.connect(src);
    sub.connect(subGain);
    subGain.connect(src);
    // metallischer Ringmodulator für das Fremdartige
    let mix = src;
    if (ring > 0) {
      const rm = ctx.createGain();
      rm.gain.value = 1 - ring;
      const rmOsc = ctx.createOscillator();
      rmOsc.frequency.value = pts[0] * 1.48;
      const rmDepth = ctx.createGain();
      rmDepth.gain.value = ring;
      rmOsc.connect(rmDepth);
      rmDepth.connect(rm.gain);
      src.connect(rm);
      rmOsc.start(t);
      rmOsc.stop(end + 0.1);
      mix = rm;
    }
    const shaper = ctx.createWaveShaper();
    shaper.curve = shaperCurve(drive);
    mix.connect(shaper);
    // Atemgeräusch
    const nsrc = ctx.createBufferSource();
    nsrc.buffer = noiseBuffer;
    const ng = ctx.createGain();
    ng.gain.value = breath;
    nsrc.connect(ng);
    // Formantfilter
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.04, dur * 0.2));
    env.gain.setValueAtTime(gain, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    const vs = vowels.map((v) => VOWELS[v]);
    [0, 1, 2].forEach((k) => {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = q * (k === 0 ? 0.7 : 1);
      vs.forEach((v, i) => {
        const at = t + (dur * i) / Math.max(1, vs.length - 1);
        if (i === 0) bp.frequency.setValueAtTime(v[k] / shift, at);
        else bp.frequency.linearRampToValueAtTime(v[k] / shift, at);
      });
      const fg = ctx.createGain();
      fg.gain.value = [1, 0.7, 0.35][k];
      shaper.connect(bp);
      ng.connect(bp);
      bp.connect(fg);
      fg.connect(env);
    });
    env.connect(sfxGain);
    if (verb > 0) {
      const vg = ctx.createGain();
      vg.gain.value = verb;
      env.connect(vg);
      vg.connect(sfxVerb);
    }
    for (const o of [osc, sub, lfo]) {
      o.start(t);
      o.stop(end + 0.1);
    }
    nsrc.start(t, Math.random() * 0.5);
    nsrc.stop(end + 0.1);
  }

  // dumpfer Herzschlag (Mutterschiff)
  function thump(t, gain) {
    voice("sine", 62, t, 0.18, gain, sfxGain, { attack: 0.005, release: 0.25 }).frequency.exponentialRampToValueAtTime(34, t + 0.2);
  }

  // nasses Schmatzen
  function squelch(t, gain) {
    noise(t, 0.22, gain, [sfxGain, sfxVerb], "bandpass", 380, 1400, 6);
    noise(t + 0.08, 0.18, gain * 0.7, sfxGain, "bandpass", 900, 260, 8);
  }

  // ---------- Soundeffekte ----------
  // Mindestabstand zwischen gleichen Effekten (damit es bei vielen Gegnern nicht zu laut wird)
  const LIMITS = {
    laser: 0.05, beam: 0.12, plasma: 0.08, cryo: 0.15, mortar: 0.1, boom: 0.07, pop: 0.035, deflect: 0.12, ship: 0.2, leak: 0.25, regen: 0.3, shatter: 0.1,
    alienDie: 0.06, chitter: 0.5, tunnel: 0.35, bruteDie: 0.15, roar: 2, bossDie: 1, hiveSpawn: 3, hiveBurst: 2, ability: 0.5,
  };
  function allowed(name) {
    const now = ctx.currentTime;
    const gap = LIMITS[name] || 0.03;
    if (lastPlayed[name] && now - lastPlayed[name] < gap) return false;
    lastPlayed[name] = now;
    return true;
  }

  function play(name, opts = {}) {
    if (!ctx || !settings.sfx || !allowed(name)) return;
    const t = ctx.currentTime + 0.005 + (opts.delay || 0);
    const out = sfxGain;
    switch (name) {
      case "laser":
        voice("square", 1500, t, 0.06, 0.035, out, { attack: 0.002, release: 0.04, filter: { freq: 4000, to: 900 } }).frequency.exponentialRampToValueAtTime(420, t + 0.07);
        break;
      case "beam":
        voice("sawtooth", 880 + Math.random() * 60, t, 0.1, 0.012, out, { attack: 0.01, release: 0.05, filter: { freq: 2500 } });
        break;
      case "plasma":
        voice("sine", 200, t, 0.16, 0.09, out, { attack: 0.003, release: 0.1 }).frequency.exponentialRampToValueAtTime(70, t + 0.18);
        noise(t, 0.12, 0.04, out, "lowpass", 1400, 300);
        break;
      case "cryo":
        voice("triangle", 1760, t, 0.25, 0.025, out, { attack: 0.005, release: 0.35 });
        voice("sine", 2637, t + 0.03, 0.2, 0.018, out, { attack: 0.005, release: 0.4 });
        noise(t, 0.35, 0.025, out, "highpass", 6000);
        break;
      case "mortar":
        voice("sine", 110, t, 0.2, 0.14, out, { attack: 0.002, release: 0.15 }).frequency.exponentialRampToValueAtTime(40, t + 0.25);
        noise(t, 0.2, 0.06, out, "lowpass", 900, 200);
        break;
      case "boom": {
        const size = Math.min(1.5, (opts.size || 40) / 50);
        noise(t, 0.3 + size * 0.2, 0.07 + size * 0.05, out, "lowpass", 1400, 120);
        voice("sine", 90, t, 0.25, 0.08 * size, out, { attack: 0.003, release: 0.2 }).frequency.exponentialRampToValueAtTime(35, t + 0.3);
        break;
      }
      case "pop": {
        // dezent: kleiner Blip, höhere Stufen klingen höher
        const f = 420 + (opts.level || 1) * 110;
        voice("sine", f, t, 0.04, opts.dead ? 0.03 : 0.018, out, { attack: 0.002, release: 0.05 }).frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.05);
        break;
      }
      case "heavyDeath":
        noise(t, 0.9, 0.16, out, "lowpass", 1800, 80);
        voice("sine", 70, t, 0.6, 0.18, out, { attack: 0.005, release: 0.5 }).frequency.exponentialRampToValueAtTime(28, t + 0.8);
        [72, 76, 79].forEach((n, i) => voice("triangle", midi(n), t + 0.1 + i * 0.07, 0.2, 0.03, out, { release: 0.4 }));
        break;
      case "deflect":
        voice("square", 2400, t, 0.03, 0.015, out, { attack: 0.001, release: 0.08, filter: { freq: 5000, type: "highpass" } });
        break;
      case "shatter":
        noise(t, 0.25, 0.05, out, "highpass", 4000);
        voice("triangle", 3136, t, 0.08, 0.02, out, { release: 0.2 });
        break;
      case "ship":
        noise(t, 0.5, 0.05, out, "bandpass", 300, 2400, 2);
        voice("sine", 280, t, 0.4, 0.03, out, { attack: 0.05, release: 0.2 }).frequency.exponentialRampToValueAtTime(640, t + 0.4);
        break;
      case "build":
        voice("sine", 220, t, 0.06, 0.08, out, { release: 0.1 });
        voice("sine", 330, t + 0.06, 0.08, 0.07, out, { release: 0.15 });
        noise(t, 0.08, 0.04, out, "lowpass", 800);
        break;
      case "upgrade":
        [72, 76, 79, 84].forEach((n, i) => voice("triangle", midi(n), t + i * 0.06, 0.1, 0.045, [out, delay], { release: 0.25 }));
        break;
      case "sell":
        [76, 72, 67].forEach((n, i) => voice("triangle", midi(n), t + i * 0.06, 0.08, 0.04, out, { release: 0.2 }));
        break;
      case "click":
        voice("sine", 1200, t, 0.02, 0.03, out, { attack: 0.001, release: 0.03 });
        break;
      case "waveStart":
        voice("triangle", midi(69), t, 0.15, 0.05, [out, delay], { release: 0.4 });
        voice("triangle", midi(76), t + 0.12, 0.25, 0.05, [out, delay], { release: 0.6 });
        break;
      case "waveEnd":
        [69, 72, 76, 81].forEach((n, i) => voice("triangle", midi(n), t + i * 0.08, 0.3, 0.04, [out, delay], { release: 0.6 }));
        break;
      case "bossWave": {
        const o = voice("sawtooth", 110, t, 1.6, 0.06, out, { attack: 0.1, release: 0.5, filter: { freq: 900 } });
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = 1.5;
        lg.gain.value = 40;
        lfo.connect(lg);
        lg.connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + 2.2);
        voice("sine", 55, t, 1.6, 0.12, out, { attack: 0.2, release: 0.6 });
        break;
      }
      case "bossSpawn":
        noise(t, 1.4, 0.08, out, "lowpass", 300, 1200, 3);
        voice("sawtooth", 55, t, 1.2, 0.08, out, { attack: 0.3, release: 0.5, filter: { freq: 400 } });
        break;
      case "alienDie": {
        // kurzer Quiek-Schrei, kleinere Aliens höher; Spezialaliens klingen anders
        const lv = opts.level || 1;
        const f = 330 + lv * 70 + Math.random() * 60;
        if (opts.kind === "beetle") creature(t, { pitch: [f * 0.6, f * 0.3], dur: 0.16, vowels: ["x", "o"], shift: 0.9, gain: 0.03, rough: 0.7, drive: 0.6, vib: 40, vibDepth: 0.08, breath: 0.4, verb: 0.15 });
        else creature(t, { pitch: [f, f * 1.25, f * 0.5], dur: 0.2 + Math.random() * 0.06, vowels: ["i", "a", "u"], shift: 0.62, gain: 0.04, rough: 0.15, vib: 28, vibDepth: 0.05, breath: 0.15, drive: 0.25, ring: 0.3, verb: 0.2 });
        break;
      }
      case "chitter": {
        // Schwarm-Geklacker: viele kurze Klicklaute
        const n = opts.count || 6;
        for (let i = 0; i < n; i++) {
          const f = 900 + Math.random() * 900;
          creature(t + i * (0.05 + Math.random() * 0.05), { pitch: [f, f * 0.8], dur: 0.04 + Math.random() * 0.03, vowels: ["i", "x"], shift: 0.5, gain: 0.018, rough: 0.1, vib: 60, vibDepth: 0.1, breath: 0.5, drive: 0.4, verb: 0.35 });
        }
        break;
      }
      case "tunnel":
        // Ansaug-Geräusch am Tunnelportal
        noise(t, 0.6, 0.05, [out, sfxVerb], "bandpass", 300, 3200, 3);
        voice("sine", 180, t, 0.5, 0.025, out, { attack: 0.05, release: 0.2 }).frequency.exponentialRampToValueAtTime(900, t + 0.5);
        break;
      case "bruteDie":
        creature(t, { pitch: [150, 110, 55], dur: 0.8, vowels: ["a", "o", "u"], shift: 1.25, gain: 0.07, rough: 0.8, vib: 9, vibDepth: 0.05, breath: 0.35, drive: 0.75, verb: 0.4 });
        noise(t, 0.5, 0.08, out, "lowpass", 900, 120);
        break;
      case "roar":
        // Omega-Jäger: tiefes Brüllen mit Zischen und schrillem Kreischen darüber
        creature(t, { pitch: [80, 135, 120, 70], dur: 2.3, vowels: ["u", "o", "a", "a", "o"], shift: 1.35, gain: 0.11, rough: 0.9, vib: 7, vibDepth: 0.07, breath: 0.6, drive: 0.85, verb: 0.6, q: 5 });
        creature(t + 0.25, { pitch: [520, 880, 760, 430], dur: 1.8, vowels: ["e", "i", "e", "x"], shift: 1.0, gain: 0.035, rough: 0.2, vib: 13, vibDepth: 0.04, breath: 0.3, drive: 0.5, ring: 0.4, verb: 0.6 });
        noise(t + 1.9, 0.9, 0.05, [out, sfxVerb], "highpass", 3200, 5200);
        break;
      case "bossDie":
        creature(t, { pitch: [760, 900, 300, 90], dur: 1.6, vowels: ["i", "e", "a", "o", "u"], shift: 1.05, gain: 0.09, rough: 0.6, vib: 11, vibDepth: 0.06, breath: 0.5, drive: 0.8, ring: 0.25, verb: 0.7, q: 6 });
        noise(t, 1.2, 0.12, out, "lowpass", 1600, 90);
        break;
      case "hiveSpawn": {
        // Mutterschiff: dröhnendes Summen mit Herzschlag und Schmatzen
        voice("sawtooth", 41, t, 3.2, 0.06, out, { attack: 0.8, release: 1.5, filter: { freq: 180, to: 700 } });
        voice("sawtooth", 41.6, t, 3.2, 0.06, out, { attack: 0.8, release: 1.5, filter: { freq: 220, to: 600 } });
        for (let i = 0; i < 4; i++) {
          thump(t + 0.4 + i * 0.75, 0.16);
          thump(t + 0.62 + i * 0.75, 0.1);
        }
        squelch(t + 1.1, 0.06);
        squelch(t + 2.3, 0.05);
        creature(t + 1.4, { pitch: [60, 90, 50], dur: 2.2, vowels: ["u", "o", "u"], shift: 1.5, gain: 0.07, rough: 1, vib: 4, vibDepth: 0.08, breath: 0.4, drive: 0.9, verb: 0.8, q: 4 });
        break;
      }
      case "hiveBurst":
        squelch(t, 0.12);
        squelch(t + 0.15, 0.1);
        noise(t, 1.4, 0.14, out, "lowpass", 1400, 70);
        creature(t + 0.2, { pitch: [300, 520, 140], dur: 1.8, vowels: ["a", "i", "o", "u"], shift: 1.2, gain: 0.09, rough: 0.9, vib: 8, vibDepth: 0.07, breath: 0.5, drive: 0.85, ring: 0.3, verb: 0.8 });
        break;
      case "ability":
        [60, 67, 72, 79].forEach((n, i) => voice("sawtooth", midi(n), t + i * 0.04, 0.35, 0.03, [out, delay], { release: 0.4, filter: { freq: 3000, to: 900 } }));
        noise(t, 0.6, 0.05, out, "bandpass", 600, 4000, 2);
        break;
      case "leak":
        voice("square", 120, t, 0.15, 0.04, out, { release: 0.1, filter: { freq: 600 } });
        break;
      case "regen":
        voice("sine", 880, t, 0.08, 0.015, out, { release: 0.1 }).frequency.exponentialRampToValueAtTime(1320, t + 0.08);
        break;
      case "globalFreeze":
        noise(t, 1.2, 0.06, out, "highpass", 3000, 9000);
        [84, 88, 91].forEach((n, i) => voice("sine", midi(n), t + i * 0.1, 0.4, 0.02, [out, delay], { release: 0.6 }));
        break;
      case "strike":
        voice("sawtooth", 1800, t, 0.25, 0.04, out, { filter: { freq: 4000, to: 300 } }).frequency.exponentialRampToValueAtTime(200, t + 0.3);
        noise(t + 0.1, 1.0, 0.16, out, "lowpass", 2000, 80);
        break;
      case "win":
        [69, 72, 76, 81, 84, 88].forEach((n, i) => voice("triangle", midi(n), t + i * 0.12, 0.5, 0.05, [out, delay], { release: 0.8 }));
        break;
      case "lose":
        [69, 65, 62, 57].forEach((n, i) => voice("triangle", midi(n), t + i * 0.2, 0.5, 0.05, [out, delay], { release: 0.8 }));
        break;
    }
  }

  // Ereignisse aus der Spiellogik in Klänge übersetzen
  function handleEvents(events) {
    if (!ctx) return;
    for (const ev of events) {
      if (ev.type === "shoot") play(ev.tower === "laser" ? (ev.beam ? "beam" : "laser") : ev.tower);
      else if (ev.type === "pop") play(ev.dead ? "alienDie" : "pop", ev);
      else if (ev.type === "heavyDeath") {
        play("heavyDeath", ev);
        play(ev.kind === "tank" ? "bruteDie" : ev.kind === "bossA" ? "bossDie" : "hiveBurst", ev);
      } else if (ev.type === "bossSpawn") play(ev.kind === "bossB" ? "hiveSpawn" : "roar", ev);
      else if (ev.type === "waveStart" || ev.type === "bossWave") {
        play(ev.type, ev);
        play("chitter", { count: 7 });
      }
      else if (ev.type === "boom") play("boom", ev);
      else play(ev.type, ev);
    }
  }

  return { init, play, applySettings, handleEvents };
})();
