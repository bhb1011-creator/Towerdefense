"use strict";

// Alien-Modelle mit beweglichen Gliedmaßen und Lauf-Animationen.
// Blickrichtung ist +X, oben ist +Y. Jedes Modell liefert eine animate()-Funktion.

const Aliens = (() => {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const UP = V(0, 1, 0);
  const geoCache = new Map();

  // ---------- Geometrie-Helfer ----------
  function xf(geo, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
    const g = geo.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(V(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), V(...s)));
    return g;
  }

  // Segmentzahl nach Größe: kleine Teile brauchen weniger Dreiecke
  const autoSeg = (r) => (r < 0.02 ? 5 : r < 0.05 ? 7 : r < 0.1 ? 9 : 12);

  function limb(a, b, r, seg = autoSeg(r)) {
    const A = V(...a);
    const B = V(...b);
    const d = B.clone().sub(A);
    const len = Math.max(0.001, d.length());
    const g = new THREE.CapsuleGeometry(r, len, 2, seg);
    g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), V(1, 1, 1)));
    return g;
  }

  const ball = (p, r, s = [1, 1, 1], seg = 0, rot = [0, 0, 0]) => {
    const n = Math.min(seg || 99, autoSeg(r) + 2);
    return xf(new THREE.SphereGeometry(r, n, Math.max(5, Math.round(n * 0.65))), { p, s, r: rot });
  };
  const cone = (p, r, h, rot, seg = 6) => xf(new THREE.ConeGeometry(r, h, seg), { p, r: rot });

  function merge(list) {
    // Normalen der Einzelteile bleiben erhalten, damit alles rund und glatt aussieht
    return THREE.BufferGeometryUtils.mergeBufferGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)));
  }

  // Geometrien werden einmal je Schlüssel gebaut und geteilt
  function cachedGeo(key, make) {
    if (!geoCache.has(key)) {
      const g = make();
      g.userData.shared = true;
      geoCache.set(key, g);
    }
    return geoCache.get(key);
  }

  function mesh(geo, mat, cast = false) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    return m;
  }

  function pivot(parent, p) {
    const g = new THREE.Group();
    g.position.set(...p);
    parent.add(g);
    return g;
  }

  // ---------- Materialien ----------
  const matCache = new Map();
  const shared = (key, make) => {
    if (!matCache.has(key)) matCache.set(key, make());
    return matCache.get(key);
  };

  function skinMaterial(color, opts = {}) {
    // dunkle, nasse Haut in der Grundfarbe; der Schimmer an den Kanten hat die volle Farbe
    const c = new THREE.Color(color);
    const hsl = c.getHSL({});
    const m = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.1), hsl.l * 0.32), roughness: 0.3, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.12,
      sheen: 0.6, sheenColor: c, sheenRoughness: 0.35,
      emissive: c.clone().multiplyScalar(0.05), ...opts,
    });
    m.userData.baseEmissive = m.emissive.clone();
    return m;
  }

  const glowMat = (color, intensity = 2.6) => shared(`glow${color}${intensity}`, () =>
    new THREE.MeshStandardMaterial({ color: "#000000", emissive: color, emissiveIntensity: intensity }));

  function eyeMaterial(glow) {
    return new THREE.MeshPhysicalMaterial({ color: "#05040a", roughness: 0.04, metalness: 0.3, clearcoat: 1, emissive: glow, emissiveIntensity: 0.18 });
  }

  const iceMat = () => shared("ice", () => new THREE.MeshPhysicalMaterial({
    color: "#c8f4ff", transparent: true, opacity: 0.6, roughness: 0.05, clearcoat: 1, emissive: "#3fb6ff", emissiveIntensity: 0.35, flatShading: true,
  }));
  const chitinMat = () => shared("chitin", () => new THREE.MeshPhysicalMaterial({
    color: "#22202e", roughness: 0.3, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.2,
  }));
  const toothMat = () => shared("tooth", () => new THREE.MeshStandardMaterial({ color: "#e8e6f0", roughness: 0.3, metalness: 0.4 }));

  // ---------- Start-Alien (Stufe 1–5, gleiche Form, Farbe je Stufe) ----------
  // Bogen (halber Ring) quer über die Brust, Mitte zeigt nach vorne (+X)
  const ribArc = (p, r, sz, sx) => xf(new THREE.TorusGeometry(r, 0.011, 4, 12, Math.PI), { p, r: [Math.PI / 2, 0, -Math.PI / 2], s: [sz, sx, 1] });

  function starterGeo(level) {
    return cachedGeo(`starterBody${level}`, () => {
      const parts = [
        ball([0, 0.5, 0], 0.085, [1, 0.75, 1.25]),
        limb([0, 0.52, 0], [0.03, 0.68, 0], 0.062),
        ball([0.04, 0.77, 0], 0.12, [0.95, 1.1, 1.25]),
        ball([0.0, 0.82, 0.12], 0.05, [1, 0.8, 1]),
        ball([0.0, 0.82, -0.12], 0.05, [1, 0.8, 1]),
        limb([0.06, 0.86, 0], [0.11, 0.98, 0], 0.034),
        // langer, nach hinten gezogener Schädel mit Knochenkamm
        ball([-0.02, 1.13, 0], 0.15, [1.65, 0.9, 0.85], 20, [0, 0, 0.5]),
        ball([0.12, 1.03, 0], 0.085, [1.05, 1.15, 0.88], 18),
        // wütender Stirnwulst (innen tief, außen hoch) und Wangenknochen
        limb([0.2, 1.1, 0.012], [0.16, 1.135, 0.1], 0.017),
        limb([0.2, 1.1, -0.012], [0.16, 1.135, -0.1], 0.017),
        ball([0.17, 1.0, 0.075], 0.03, [1.2, 0.8, 1]),
        ball([0.17, 1.0, -0.075], 0.03, [1.2, 0.8, 1]),
        // Unterkiefer, leicht geöffnet
        ball([0.17, 0.935, 0], 0.055, [1.25, 0.55, 1.05]),
      ];
      for (let i = 0; i < 5; i++) parts.push(cone([-0.2 + i * 0.07, 1.24 - i * 0.012 + (i === 2 ? 0.02 : 0), 0], 0.02, 0.09 - Math.abs(i - 2) * 0.012, [0, 0, 0.7]));
      // Rippenbögen auf der Brust und am Bauch
      for (let i = 0; i < 3; i++) parts.push(ribArc([0.04, 0.71 + i * 0.05, 0], 0.112 - i * 0.004, 1.18, 0.92));
      for (let i = 0; i < 2; i++) parts.push(ribArc([0.015, 0.56 + i * 0.05, 0], 0.064, 1.05, 0.95));
      // Rückenwirbel
      for (let i = 0; i < 6; i++) parts.push(ball([-0.075 + i * 0.006, 0.55 + i * 0.065, 0], 0.024, [0.8, 0.7, 1]));
      // ab Stufe 4 Hörner, ab Stufe 5 zusätzliche Stacheln am Rücken
      if (level >= 4) parts.push(cone([-0.13, 1.24, 0.07], 0.028, 0.18, [0.45, 0, 0.9]), cone([-0.13, 1.24, -0.07], 0.028, 0.18, [-0.45, 0, 0.9]));
      if (level >= 5) for (let i = 0; i < 4; i++) parts.push(cone([-0.1, 0.62 + i * 0.08, 0], 0.022, 0.1, [0, 0, 1.25]));
      return merge(parts);
    });
  }

  function buildStarter(level, color, skin) {
    const root = new THREE.Group();
    const body = pivot(root, [0, 0, 0]);
    const eyeMat = eyeMaterial(color);
    body.add(mesh(starterGeo(level), skin, true));
    // böse schwarze Mandelaugen: außen hochgezogen, innen tief
    body.add(mesh(cachedGeo("starterEyes", () => merge([
      ball([0.192, 1.07, 0.055], 0.06, [0.5, 0.5, 1.3], 16, [-0.5, 0.35, 0.2]),
      ball([0.192, 1.07, -0.055], 0.06, [0.5, 0.5, 1.3], 16, [0.5, -0.35, 0.2]),
    ])), eyeMat));
    // Maul: dunkler Schlund mit spitzen Zähnen
    body.add(mesh(cachedGeo("starterMaw", () => ball([0.2, 0.96, 0], 0.036, [0.6, 0.45, 1.3])), shared("maw", () => new THREE.MeshBasicMaterial({ color: "#14000a" }))));
    body.add(mesh(cachedGeo("starterTeeth", () => merge([
      ...Array.from({ length: 6 }, (_, i) => cone([0.218 - Math.abs(i - 2.5) * 0.008, 0.975, (i - 2.5) * 0.013], 0.006, 0.026, [Math.PI, 0, 0], 4)),
      ...Array.from({ length: 5 }, (_, i) => cone([0.216 - Math.abs(i - 2) * 0.008, 0.946, (i - 2) * 0.014], 0.006, 0.022, [0, 0, 0], 4)),
    ])), toothMat()));
    // leuchtende Zeichnung: Pupillen, Kiemen am Hals, Linie über den Schädel, Punkte am Rücken (Anzahl = Stufe)
    body.add(mesh(cachedGeo(`starterGlow${level}`, () => merge([
      ball([0.222, 1.068, 0.056], 0.014, [0.5, 1.7, 0.6]), ball([0.222, 1.068, -0.056], 0.014, [0.5, 1.7, 0.6]),
      ...[0, 1, 2].flatMap((i) => [1, -1].map((s) => limb([0.07 + i * 0.012, 0.88 + i * 0.022, 0.035 * s], [0.1 + i * 0.012, 0.88 + i * 0.022, 0.028 * s], 0.006, 4))),
      limb([-0.2, 1.22, 0.03], [0.08, 1.2, 0.035], 0.006), limb([-0.2, 1.22, -0.03], [0.08, 1.2, -0.035], 0.006),
      ball([0.16, 0.8, 0], 0.022, [0.6, 1, 1]),
      ...Array.from({ length: level }, (_, i) => ball([-0.098, 0.84 - i * 0.065, 0], 0.02)),
    ])), glowMat(color)));
    const arms = [];
    for (const s of [1, -1]) {
      const arm = pivot(body, [0.03, 0.82, 0.16 * s]);
      arm.add(mesh(cachedGeo(`starterArm${s}`, () => merge([
        ball([0, 0, 0], 0.04),
        limb([0, 0, 0], [0.01, -0.2, 0.03 * s], 0.03),
        ball([0.01, -0.2, 0.03 * s], 0.03),
        limb([0.01, -0.2, 0.03 * s], [0.13, -0.33, 0.02 * s], 0.025),
        ball([0.13, -0.33, 0.02 * s], 0.03, [1.2, 0.8, 1]),
        // drei lange Krallenfinger
        ...[-1, 0, 1].map((k) => limb([0.14, -0.34, (0.02 + k * 0.018) * s], [0.25, -0.41, (0.03 + k * 0.03) * s], 0.009, 4)),
      ])), skin));
      arms.push(arm);
    }
    // Beine mit Rückwärts-Knick wie bei einem Raubtier
    const legs = [];
    for (const s of [1, -1]) {
      const hip = pivot(body, [0, 0.5, 0.075 * s]);
      hip.add(mesh(cachedGeo("starterThigh", () => merge([limb([0, 0, 0], [0.1, -0.2, 0], 0.045), ball([0.04, -0.07, 0], 0.05, [1, 1.4, 1])])), skin));
      const knee = pivot(hip, [0.1, -0.2, 0]);
      knee.add(mesh(cachedGeo("starterShin", () => merge([
        ball([0, 0, 0], 0.035),
        limb([0, 0, 0], [-0.09, -0.17, 0], 0.032),
        limb([-0.09, -0.17, 0], [-0.05, -0.29, 0], 0.024),
        ...[-1, 0, 1].map((k) => limb([-0.05, -0.29, 0], [0.04, -0.3, k * 0.035], 0.012, 4)),
      ])), skin));
      legs.push({ hip, knee });
    }
    return {
      root, body, eyeMat, height: 1.3,
      anchors: { back: [-0.12, 0.78, 0], shoulderL: [0.02, 0.86, 0.15], shoulderR: [0.02, 0.86, -0.15], head: [-0.02, 1.27, 0] },
      animate(t, moving) {
        const a = moving ? 1 : 0.15;
        const ph = t * 9;
        legs[0].hip.rotation.z = Math.sin(ph) * 0.6 * a;
        legs[1].hip.rotation.z = -Math.sin(ph) * 0.6 * a;
        legs[0].knee.rotation.z = -Math.max(0, Math.cos(ph)) * 0.7 * a;
        legs[1].knee.rotation.z = -Math.max(0, -Math.cos(ph)) * 0.7 * a;
        arms[0].rotation.z = -Math.sin(ph) * 0.5 * a;
        arms[1].rotation.z = Math.sin(ph) * 0.5 * a;
        body.position.y = Math.abs(Math.sin(ph)) * 0.035 * a;
        body.rotation.z = -0.14 * a;
      },
    };
  }

  // ---------- Schleicher (Tarnung): flach am Boden krabbelnd ----------
  function buildCrawler(color, skin) {
    const root = new THREE.Group();
    const body = pivot(root, [0, 0, 0]);
    const eyeMat = eyeMaterial(color);
    body.add(mesh(cachedGeo("crawlerBody", () => merge([
      limb([-0.28, 0.17, 0], [0.26, 0.2, 0], 0.1),
      ball([0.05, 0.2, 0], 0.13, [2.2, 0.75, 1.05]),
      // flacher Kopf mit Kiefer
      ball([0.4, 0.2, 0], 0.11, [1.5, 0.6, 1]),
      ball([0.47, 0.15, 0], 0.07, [1.5, 0.45, 0.9]),
      // Rückenstacheln und Wirbel
      ...Array.from({ length: 6 }, (_, i) => ball([-0.25 + i * 0.1, 0.285, 0], 0.03, [1.4, 0.6, 1.2])),
      ...Array.from({ length: 5 }, (_, i) => cone([-0.2 + i * 0.1, 0.33, 0], 0.018, 0.09, [0, 0, 0.9])),
    ])), skin));
    body.add(mesh(cachedGeo("crawlerEyes", () => merge([
      ball([0.52, 0.23, 0.05], 0.025, [1.4, 0.6, 1]), ball([0.52, 0.23, -0.05], 0.025, [1.4, 0.6, 1]),
      ball([0.47, 0.25, 0.075], 0.016), ball([0.47, 0.25, -0.075], 0.016),
      ball([0.43, 0.26, 0.085], 0.012), ball([0.43, 0.26, -0.085], 0.012),
    ])), glowMat(color, 3)));
    body.add(mesh(cachedGeo("crawlerGlow", () => merge([
      limb([-0.3, 0.25, 0.06], [0.3, 0.26, 0.05], 0.007), limb([-0.3, 0.25, -0.06], [0.3, 0.26, -0.05], 0.007),
    ])), glowMat(color)));
    // Schwanz aus verketteten Segmenten
    const tail = [];
    let parent = pivot(body, [-0.32, 0.17, 0]);
    for (let i = 0; i < 6; i++) {
      parent.add(mesh(cachedGeo(`crawlerTail${i}`, () => limb([0, 0, 0], [-0.12, 0, 0], 0.055 * (1 - i * 0.13))), skin));
      tail.push(parent);
      parent = pivot(parent, [-0.12, 0, 0]);
    }
    const legs = [];
    for (const [x, s] of [[0.18, 1], [0.18, -1], [-0.16, 1], [-0.16, -1]]) {
      const hip = pivot(body, [x, 0.17, 0.09 * s]);
      hip.add(mesh(cachedGeo(`crawlerUpper${s}`, () => limb([0, 0, 0], [0, 0.06, 0.17 * s], 0.032)), skin));
      const knee = pivot(hip, [0, 0.06, 0.17 * s]);
      knee.add(mesh(cachedGeo(`crawlerLower${s}`, () => limb([0, 0, 0], [0.05, -0.24, 0.09 * s], 0.025)), skin));
      legs.push({ hip, knee, phase: (x > 0) === (s > 0) ? 0 : Math.PI });
    }
    return {
      root, body, eyeMat, height: 0.45,
      anchors: { back: [0, 0.3, 0], shoulderL: [0.18, 0.27, 0.08], shoulderR: [0.18, 0.27, -0.08], head: [0.42, 0.3, 0] },
      animate(t, moving) {
        const a = moving ? 1 : 0.2;
        const ph = t * 11;
        for (const l of legs) {
          l.hip.rotation.y = Math.sin(ph + l.phase) * 0.55 * a;
          l.knee.rotation.x = Math.max(0, Math.cos(ph + l.phase)) * 0.4 * a * Math.sign(l.hip.position.z);
        }
        body.rotation.y = Math.sin(ph) * 0.12 * a;
        tail.forEach((seg, i) => { seg.rotation.y = Math.sin(t * 5 - i * 0.7) * 0.25; });
      },
    };
  }

  // ---------- Panzer-Alien (Explosionspanzer): ekliger, sechsbeiniger Käfer ----------
  function buildBeetle(color, skin) {
    const root = new THREE.Group();
    const body = pivot(root, [0, 0, 0]);
    const eyeMat = eyeMaterial(color);
    // weicher, aufgeblähter Hinterleib mit Ringen und Unterseite
    body.add(mesh(cachedGeo("beetleUnder", () => merge([
      ball([0, 0.22, 0], 0.27, [1.2, 0.5, 0.9]),
      ball([-0.3, 0.26, 0], 0.2, [1.2, 0.85, 0.95]),
      ...[0, 1, 2].map((i) => xf(new THREE.TorusGeometry(0.17 - i * 0.03, 0.018, 6, 20), { p: [-0.36 - i * 0.07, 0.26, 0], r: [0, Math.PI / 2, 0], s: [0.95, 0.85, 1] })),
      ball([0.36, 0.25, 0], 0.12, [1.1, 0.9, 1]),
    ])), skin));
    body.add(mesh(cachedGeo("beetleShell", () => merge([
      ball([0.02, 0.3, 0], 0.27, [1.25, 0.72, 1.05], 18),
      // Hörner und Borsten
      cone([0.34, 0.36, 0.07], 0.022, 0.18, [0.3, 0, -1.2]),
      cone([0.34, 0.36, -0.07], 0.022, 0.18, [-0.3, 0, -1.2]),
      ...Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2;
        return cone([0.02 + Math.cos(a) * 0.3, 0.34, Math.sin(a) * 0.25], 0.006, 0.08, [Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8], 3);
      }),
    ])), chitinMat(), true));
    body.add(mesh(cachedGeo("beetleSeam", () => merge([
      limb([-0.28, 0.5, 0], [0.26, 0.5, 0], 0.012),
      ...[-1, 1].map((s) => limb([-0.2, 0.44, 0.17 * s], [0.2, 0.46, 0.15 * s], 0.008)),
    ])), glowMat(color)));
    // kränklich leuchtende Eiterbeulen
    body.add(mesh(cachedGeo("beetlePus", () => merge([
      ball([-0.08, 0.5, 0.1], 0.05), ball([0.1, 0.49, -0.12], 0.04), ball([-0.18, 0.45, -0.14], 0.045),
      ball([-0.38, 0.4, 0.06], 0.055), ball([-0.32, 0.36, -0.12], 0.04), ball([0.15, 0.47, 0.13], 0.032),
      ball([-0.5, 0.3, 0.04], 0.035),
    ])), shared("pus", () => new THREE.MeshPhysicalMaterial({
      color: "#c8ff4a", transparent: true, opacity: 0.85, roughness: 0.1, clearcoat: 1, emissive: "#9cff1a", emissiveIntensity: 1.1,
    }))));
    // viele kleine rote Augen
    body.add(mesh(cachedGeo("beetleEyes", () => merge([
      ball([0.47, 0.3, 0.045], 0.03), ball([0.47, 0.3, -0.045], 0.03),
      ball([0.44, 0.33, 0.08], 0.017), ball([0.44, 0.33, -0.08], 0.017),
      ball([0.43, 0.27, 0.085], 0.014), ball([0.43, 0.27, -0.085], 0.014),
      ball([0.45, 0.35, 0.025], 0.012), ball([0.45, 0.35, -0.025], 0.012),
    ])), glowMat("#ff2a2a", 3)));
    // Sabberfäden aus dem Maul
    body.add(mesh(cachedGeo("beetleDrool", () => merge([
      limb([0.47, 0.2, 0.02], [0.49, 0.08, 0.025], 0.006), ball([0.49, 0.075, 0.025], 0.012),
      limb([0.46, 0.2, -0.03], [0.47, 0.12, -0.03], 0.005), ball([0.47, 0.115, -0.03], 0.01),
    ])), shared("drool", () => new THREE.MeshPhysicalMaterial({ color: "#d8ff9a", transparent: true, opacity: 0.6, roughness: 0, clearcoat: 1, emissive: "#6aff00", emissiveIntensity: 0.4 }))));
    const mandibles = [];
    for (const s of [1, -1]) {
      const m = pivot(body, [0.45, 0.22, 0.05 * s]);
      m.add(mesh(cachedGeo(`mandible${s}`, () => merge([
        limb([0, 0, 0], [0.1, -0.01, 0.06 * s], 0.02),
        limb([0.1, -0.01, 0.06 * s], [0.17, -0.02, 0.0], 0.014),
        ...[0, 1, 2].map((k) => cone([0.07 + k * 0.035, -0.01, (0.05 - k * 0.022) * s], 0.008, 0.04, [-1.5 * s, 0, 0], 4)),
      ])), chitinMat()));
      mandibles.push(m);
    }
    const legs = [];
    [0.2, 0, -0.2].forEach((x, i) => {
      for (const s of [1, -1]) {
        const hip = pivot(body, [x, 0.18, 0.18 * s]);
        hip.add(mesh(cachedGeo(`beetleLeg${s}`, () => merge([
          limb([0, 0, 0], [0, 0.1, 0.15 * s], 0.025),
          ball([0, 0.1, 0.15 * s], 0.026),
          limb([0, 0.1, 0.15 * s], [0.03, -0.18, 0.24 * s], 0.019),
          ...[0, 1].map((k) => cone([0.01 + k * 0.01, 0.03 - k * 0.1, (0.18 + k * 0.03) * s], 0.006, 0.05, [0, 0, -1.2], 3)),
        ])), chitinMat()));
        legs.push({ hip, phase: (i % 2 === 0) === (s > 0) ? 0 : Math.PI });
      }
    });
    return {
      root, body, eyeMat, height: 0.6,
      anchors: { back: [-0.05, 0.54, 0], shoulderL: [0.15, 0.47, 0.2], shoulderR: [0.15, 0.47, -0.2], head: [0.38, 0.42, 0] },
      animate(t, moving) {
        const a = moving ? 1 : 0.15;
        const ph = t * 10;
        for (const l of legs) l.hip.rotation.y = Math.sin(ph + l.phase) * 0.45 * a;
        mandibles.forEach((m, i) => { m.rotation.y = (i ? -1 : 1) * (0.25 + Math.sin(t * 7) * 0.25); });
        body.position.y = Math.abs(Math.sin(ph)) * 0.015 * a;
        body.rotation.x = Math.sin(ph * 0.5) * 0.04 * a;
      },
    };
  }

  // Leuchtende Hülle, die an den Rändern stärker strahlt (Frost, Spiegel, Regeneration)
  const auraMat = (color, power = 2.2, gain = 1.4) => shared(`aura${color}${power}${gain}`, () => new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, power: { value: power }, gain: { value: gain } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; uniform float power; uniform float gain; varying vec3 vN; varying vec3 vV;
      void main() { float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), power) * gain; gl_FragColor = vec4(color * f, f); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));

  // Hülle um das ganze Modell legen; liefert das Mesh zurück
  function addAura(model, color, extra = 1.25) {
    const box = new THREE.Box3().setFromObject(model.root);
    const size = box.getSize(V(0, 0, 0));
    const center = box.getCenter(V(0, 0, 0));
    const m = mesh(cachedGeo("auraSphere", () => new THREE.SphereGeometry(0.5, 24, 16)), auraMat(color));
    m.position.copy(center);
    m.scale.set(size.x * extra, size.y * extra, size.z * extra + 0.1);
    model.root.add(m);
    return m;
  }

  // Bodenring aus Leuchtpunkten oder Eiszacken
  function addGroundRing(model, mat, geoKey, makePiece, count, radius) {
    const g = cachedGeo(`${geoKey}${count}${radius}`, () => merge(Array.from({ length: count }, (_, i) => makePiece((i / count) * Math.PI * 2, radius))));
    const ring = mesh(g, mat);
    model.root.add(ring);
    return ring;
  }

  // Zusatzteile für Frostschild, Spiegelpanzer und Regeneration – gut sichtbar
  function addOverlays(model, props, color, skin) {
    const { anchors } = model;
    const reach = model.height < 0.7 ? 0.38 : 0.3;
    const animations = [];
    if (props.frost) {
      // Haut wird eisblau überzogen, große Kristalle wachsen heraus
      skin.sheenColor = new THREE.Color("#bff4ff");
      skin.sheen = 1;
      skin.emissive.lerp(new THREE.Color("#1a6cff"), 0.6);
      skin.userData.baseEmissive = skin.emissive.clone();
      const parts = [];
      for (const [key, n, h] of [["back", 4, 0.32], ["shoulderL", 3, 0.2], ["shoulderR", 3, 0.2], ["head", 3, 0.2]]) {
        const [x, y, z] = anchors[key];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          parts.push(xf(new THREE.OctahedronGeometry(0.06, 0), { p: [x - i * 0.03, y + 0.04, z + Math.sin(a) * 0.05], s: [0.7, h * 9, 0.7], r: [Math.sin(a) * 0.6, 0, -0.3 + Math.cos(a) * 0.5] }));
        }
      }
      model.body.add(mesh(merge(parts), iceMat()));
      addGroundRing(model, iceMat(), "frostRing", (a, r) => xf(new THREE.OctahedronGeometry(0.04, 0), { p: [Math.cos(a) * r, 0.04, Math.sin(a) * r], s: [0.8, 2.2, 0.8], r: [Math.sin(a) * 0.5, 0, Math.cos(a) * 0.5] }), 10, reach);
      addAura(model, "#7fdcff");
    }
    if (props.shield) {
      // Chromhaut, Kamm und ein sechseckiges Schutzgitter um den Körper
      skin.metalness = 1;
      skin.roughness = 0.05;
      skin.color.lerp(new THREE.Color("#ffffff"), 0.55);
      skin.sheen = 0;
      skin.iridescence = 1;
      skin.iridescenceIOR = 1.6;
      const [x, y, z] = anchors.head;
      model.body.add(mesh(merge([xf(new THREE.ConeGeometry(0.06, 0.3, 4), { p: [x - 0.05, y + 0.06, z], s: [1.8, 1, 0.25], r: [0, 0, 0.9] })]), skin));
      const aura = addAura(model, "#c9f6ff", 1.35);
      const cage = new THREE.LineSegments(
        cachedGeo("shieldCage", () => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.5, 1))),
        shared("cageMat", () => new THREE.LineBasicMaterial({ color: "#bdf6ff", transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })),
      );
      cage.position.copy(aura.position);
      cage.scale.copy(aura.scale);
      model.root.add(cage);
      animations.push((t) => { cage.rotation.y = t * 0.8; });
    }
    if (props.regen) {
      const sacs = new THREE.Group();
      const sacMat = shared("regenSac", () => new THREE.MeshPhysicalMaterial({
        color: "#3dff9a", transparent: true, opacity: 0.75, roughness: 0.1, clearcoat: 1, emissive: "#2bff8a", emissiveIntensity: 1.6,
      }));
      for (const key of ["back", "shoulderL", "shoulderR", "head"]) {
        const s = mesh(cachedGeo("sac", () => new THREE.SphereGeometry(0.075, 14, 10)), sacMat);
        s.position.set(...anchors[key]);
        s.position.y += 0.03;
        sacs.add(s);
      }
      model.body.add(sacs);
      const aura = addAura(model, "#3dff9a", 1.3);
      const ring = addGroundRing(model, glowMat("#3dff9a", 2.4), "regenRing", (a, r) => ball([Math.cos(a) * r, 0.02, Math.sin(a) * r], 0.022, [1, 0.5, 1], 8), 12, reach);
      animations.push((t) => {
        sacs.children.forEach((s, i) => s.scale.setScalar(1 + Math.sin(t * 5 + i * 2) * 0.3));
        const p = 1 + Math.sin(t * 4) * 0.08;
        aura.scale.multiplyScalar(p / (aura.userData.p || 1));
        aura.userData.p = p;
        ring.rotation.y = t * 1.5;
      });
    }
    if (animations.length) {
      const prev = model.animate;
      model.animate = (t, moving) => {
        prev(t, moving);
        for (const f of animations) f(t);
      };
    }
  }

  // ---------- Panzerkern: wuchtiger Brute auf Fäusten ----------
  function buildBrute(skin) {
    const root = new THREE.Group();
    const body = pivot(root, [0, 0, 0]);
    const eyeMat = eyeMaterial("#ff8a3d");
    body.add(mesh(cachedGeo("bruteBody", () => merge([
      ball([0, 0.78, 0], 0.42, [1.1, 0.95, 1.2], 16),
      ball([0.05, 0.98, 0.33], 0.24), ball([0.05, 0.98, -0.33], 0.24),
      ball([-0.12, 0.55, 0], 0.3, [1, 0.9, 1.1]),
      ball([0.42, 0.82, 0], 0.15, [1.1, 0.9, 1]),
      ball([0.5, 0.75, 0], 0.09, [1, 0.7, 1.3]),
    ])), skin, true));
    body.add(mesh(cachedGeo("bruteMouth", () => merge([
      xf(new THREE.BoxGeometry(0.03, 0.025, 0.16), { p: [0.58, 0.75, 0] }),
      ball([0.53, 0.86, 0.06], 0.025), ball([0.53, 0.86, -0.06], 0.025),
    ])), eyeMat));
    // glühende Risse in der Haut und Hauer
    body.add(mesh(cachedGeo("bruteCracks", () => {
      const rng = (() => { let x = 7; return () => ((x = (x * 16807) % 2147483647) / 2147483647); })();
      const parts = [];
      for (let i = 0; i < 16; i++) {
        const a = rng() * Math.PI * 2;
        const y = 0.55 + rng() * 0.5;
        const r = 0.44 - Math.abs(y - 0.78) * 0.4;
        let p0 = [Math.cos(a) * r * 1.05, y, Math.sin(a) * r * 1.15];
        for (let k = 0; k < 3; k++) {
          const p1 = [p0[0] + (rng() - 0.5) * 0.1, p0[1] + (rng() - 0.5) * 0.1, p0[2] + (rng() - 0.5) * 0.1];
          parts.push(limb(p0, p1, 0.008, 5));
          p0 = p1;
        }
      }
      return merge(parts);
    }), glowMat("#ff7a2a", 2.4)));
    body.add(mesh(cachedGeo("bruteTusks", () => merge([
      cone([0.58, 0.72, 0.09], 0.028, 0.16, [0, 0, -0.5]), cone([0.58, 0.72, -0.09], 0.028, 0.16, [0, 0, -0.5]),
      ...Array.from({ length: 7 }, (_, i) => cone([0.595, 0.765, (i - 3) * 0.024], 0.008, 0.04, [Math.PI, 0, 0], 4)),
    ])), toothMat()));
    // finsterer Stirnwulst und Knochendornen auf den Schultern
    body.add(mesh(cachedGeo("bruteBrow", () => merge([
      limb([0.56, 0.885, 0.012], [0.5, 0.93, 0.11], 0.035), limb([0.56, 0.885, -0.012], [0.5, 0.93, -0.11], 0.035),
      ...[1, -1].flatMap((s) => [0, 1, 2].map((k) => cone([0.12 - k * 0.12, 1.16 - k * 0.02, 0.36 * s], 0.04, 0.2, [0.5 * s, 0, 0.3]))),
    ])), chitinMat()));
    const plates = [];
    for (let i = 0; i < 4; i++) {
      const plate = mesh(cachedGeo("brutePlate", () => xf(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), { s: [1.1, 0.5, 1.3] })), chitinMat());
      plate.position.set(0.2 - i * 0.17, 1.08 - Math.abs(i - 1.5) * 0.05, 0);
      plate.rotation.z = 0.2 - i * 0.15;
      body.add(plate);
      plates.push(plate);
    }
    const arms = [];
    for (const s of [1, -1]) {
      const sh = pivot(body, [0.08, 0.98, 0.4 * s]);
      sh.add(mesh(cachedGeo(`bruteArm${s}`, () => merge([
        limb([0, 0, 0], [0.2, -0.5, 0.08 * s], 0.11),
        limb([0.2, -0.5, 0.08 * s], [0.24, -0.88, 0.08 * s], 0.12),
        ball([0.25, -0.92, 0.08 * s], 0.14, [1, 0.8, 1]),
      ])), skin, true));
      arms.push(sh);
    }
    const legs = [];
    for (const s of [1, -1]) {
      const hip = pivot(body, [-0.2, 0.45, 0.2 * s]);
      hip.add(mesh(cachedGeo("bruteLeg", () => merge([limb([0, 0, 0], [0.03, -0.38, 0], 0.11), ball([0.08, -0.42, 0], 0.1, [1.4, 0.6, 1])])), skin));
      legs.push(hip);
    }
    return {
      root, body, eyeMat, height: 1.25, breaks: plates.map((m, i) => ({ mesh: m, at: [0.8, 0.6, 0.4, 0.2][i] })),
      animate(t, moving) {
        const a = moving ? 1 : 0.2;
        const ph = t * 5.5;
        arms[0].rotation.z = Math.sin(ph) * 0.45 * a;
        arms[1].rotation.z = -Math.sin(ph) * 0.45 * a;
        legs[0].rotation.z = -Math.sin(ph) * 0.3 * a;
        legs[1].rotation.z = Math.sin(ph) * 0.3 * a;
        body.rotation.x = Math.sin(ph) * 0.06 * a;
        body.position.y = Math.abs(Math.cos(ph)) * 0.04 * a;
      },
    };
  }

  // ---------- Boss: schlanker, biomechanischer Jäger mit langem Kopf und Schwanz ----------
  function buildStalker(skin) {
    const root = new THREE.Group();
    const body = pivot(root, [0, 0, 0]);
    const eyeMat = eyeMaterial("#b14dff");
    body.add(mesh(cachedGeo("stalkerBody", () => {
      const parts = [
        ball([0, 0.95, 0], 0.15, [1.1, 0.9, 1.1]),
        limb([0, 0.98, 0], [0.28, 1.32, 0], 0.11),
        ball([0.18, 1.2, 0], 0.19, [1.25, 1, 0.85]),
        limb([0.28, 1.32, 0], [0.43, 1.43, 0], 0.055),
        // langer, glatter Hinterkopf
        limb([0.56, 1.45, 0], [0.04, 1.66, 0], 0.13, 14),
        ball([0.6, 1.42, 0], 0.1, [1.25, 0.85, 0.85]),
        limb([0.5, 1.37, 0], [0.66, 1.33, 0], 0.045),
      ];
      // Rippen und Wirbel
      for (let i = 0; i < 5; i++) parts.push(xf(new THREE.TorusGeometry(0.16 - i * 0.012, 0.014, 6, 20), { p: [0.08 + i * 0.05, 1.08 + i * 0.06, 0], r: [Math.PI / 2, 0.55, 0], s: [1, 1, 0.8] }));
      for (let i = 0; i < 6; i++) parts.push(ball([-0.02 + i * 0.05, 1.08 + i * 0.065, 0], 0.03, [1, 0.6, 1.4]));
      // Rückenröhren
      for (const s of [1, -1]) {
        parts.push(limb([0.18, 1.34, 0.08 * s], [-0.12, 1.55, 0.2 * s], 0.032));
        parts.push(limb([0.1, 1.3, 0.12 * s], [-0.16, 1.45, 0.26 * s], 0.026));
      }
      return merge(parts);
    }), skin, true));
    body.add(mesh(cachedGeo("stalkerTeeth", () => merge([
      ...Array.from({ length: 7 }, (_, i) => cone([0.6 + i * 0.012, 1.36, (i - 3) * 0.018], 0.008, 0.035, [Math.PI, 0, 0], 4)),
      ...Array.from({ length: 5 }, (_, i) => cone([0.62 + i * 0.01, 1.31, (i - 2) * 0.018], 0.007, 0.03, [0, 0, 0], 4)),
    ])), toothMat()));
    // schwach leuchtende Linie am Kopf
    body.add(mesh(cachedGeo("stalkerGlow", () => merge([limb([0.5, 1.53, 0.07], [0.12, 1.7, 0.08], 0.008), limb([0.5, 1.53, -0.07], [0.12, 1.7, -0.08], 0.008)])), eyeMat));
    const arms = [];
    for (const s of [1, -1]) {
      const sh = pivot(body, [0.3, 1.3, 0.18 * s]);
      sh.add(mesh(cachedGeo(`stalkerArm${s}`, () => merge([
        ball([0, 0, 0], 0.05),
        limb([0, 0, 0], [0.12, -0.28, 0.06 * s], 0.04),
        limb([0.12, -0.28, 0.06 * s], [0.32, -0.36, 0.04 * s], 0.032),
        ...[-1, 0, 1].map((k) => limb([0.32, -0.36, 0.04 * s], [0.44, -0.42 + k * 0.02, (0.04 + k * 0.03) * s], 0.008)),
      ])), skin));
      arms.push(sh);
    }
    const legs = [];
    for (const s of [1, -1]) {
      const hip = pivot(body, [0, 0.92, 0.13 * s]);
      hip.add(mesh(cachedGeo("stalkerThigh", () => merge([limb([0, 0, 0], [0.22, -0.32, 0], 0.07), ball([0.08, -0.1, 0], 0.085, [1, 1.5, 0.9])])), skin));
      const knee = pivot(hip, [0.22, -0.32, 0]);
      knee.add(mesh(cachedGeo("stalkerShin", () => merge([
        limb([0, 0, 0], [-0.2, -0.3, 0], 0.05),
        ball([-0.2, -0.3, 0], 0.045),
        limb([-0.2, -0.3, 0], [-0.08, -0.58, 0], 0.038),
        ...[-1, 0, 1].map((k) => limb([-0.08, -0.58, 0], [0.04, -0.6, k * 0.04], 0.012)),
      ])), skin));
      legs.push({ hip, knee });
    }
    // Schwanz: 12 Segmente mit Klinge am Ende
    const tail = [];
    let parent = pivot(body, [-0.12, 0.92, 0]);
    for (let i = 0; i < 12; i++) {
      parent.add(mesh(cachedGeo(`stalkerTail${i}`, () => merge([limb([0, 0, 0], [-0.13, 0, 0], 0.06 * (1 - i * 0.065) + 0.008), ball([-0.06, 0.03, 0], 0.03 * (1 - i * 0.06), [1, 0.7, 1])])), skin));
      tail.push(parent);
      parent = pivot(parent, [-0.13, 0, 0]);
    }
    parent.add(mesh(cachedGeo("stalkerBlade", () => cone([-0.08, 0, 0], 0.045, 0.2, [0, 0, Math.PI / 2], 4)), toothMat()));
    return {
      root, body, eyeMat, height: 1.75,
      animate(t, moving) {
        const a = moving ? 1 : 0.2;
        const ph = t * 4.2;
        legs[0].hip.rotation.z = Math.sin(ph) * 0.45 * a;
        legs[1].hip.rotation.z = -Math.sin(ph) * 0.45 * a;
        legs[0].knee.rotation.z = -Math.max(0, Math.cos(ph)) * 0.5 * a;
        legs[1].knee.rotation.z = -Math.max(0, -Math.cos(ph)) * 0.5 * a;
        arms[0].rotation.z = -0.2 - Math.sin(ph) * 0.3 * a;
        arms[1].rotation.z = -0.2 + Math.sin(ph) * 0.3 * a;
        body.position.y = Math.abs(Math.sin(ph)) * 0.03 * a - 0.04;
        body.rotation.z = -0.1 + Math.sin(t * 1.3) * 0.03;
        tail.forEach((seg, i) => {
          seg.rotation.y = Math.sin(t * 2.2 - i * 0.45) * 0.16;
          seg.rotation.z = (i === 0 ? 0.35 : -0.06) + Math.sin(t * 1.7 - i * 0.4) * 0.05;
        });
      },
    };
  }

  // ---------- Endboss: organisches Alien-Mutterschiff (lebender Schwarm-Stock) ----------
  let veinTex = null;
  function hiveVeins() {
    if (veinTex) return veinTex;
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 512;
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, 1024, 512);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // verzweigte Adern
    const vein = (x, y, ang, w, depth) => {
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x, y);
      const steps = 6 + Math.floor(rnd() * 6);
      for (let k = 0; k < steps; k++) {
        ang += (rnd() - 0.5) * 0.9;
        x += Math.cos(ang) * 14;
        y += Math.sin(ang) * 14;
        g.lineTo(x, y);
        if (depth < 3 && rnd() < 0.22) {
          g.stroke();
          vein(x, y, ang + (rnd() < 0.5 ? 0.8 : -0.8), w * 0.6, depth + 1);
          g.lineWidth = w;
          g.beginPath();
          g.moveTo(x, y);
        }
      }
      g.stroke();
    };
    g.shadowBlur = 10;
    for (let i = 0; i < 46; i++) {
      const pink = rnd() < 0.7;
      g.strokeStyle = pink ? "rgba(255,70,190,0.9)" : "rgba(80,230,255,0.85)";
      g.shadowColor = g.strokeStyle;
      vein(rnd() * 1024, rnd() * 512, rnd() * 6.28, 2.5 + rnd() * 2.5, 0);
    }
    // Poren: glühender Rand, dunkle Mitte
    g.shadowBlur = 0;
    for (let i = 0; i < 70; i++) {
      const x = rnd() * 1024;
      const y = rnd() * 512;
      const r = 2 + rnd() * 6;
      const grad = g.createRadialGradient(x, y, r * 0.3, x, y, r * 1.6);
      grad.addColorStop(0, "rgba(0,0,0,1)");
      grad.addColorStop(0.5, "rgba(255,120,220,0.9)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r * 1.6, 0, 7);
      g.fill();
    }
    veinTex = new THREE.CanvasTexture(c);
    veinTex.encoding = THREE.sRGBEncoding;
    veinTex.wrapS = veinTex.wrapT = THREE.RepeatWrapping;
    return veinTex;
  }

  // Oberfläche des Kerns: Beulen auf einer abgeflachten Kugel
  const HIVE_SCALE = [1.5, 0.85, 1.5];
  function hiveBump(v) {
    return 1 + 0.08 * Math.sin(v.x * 5 + v.y * 3) * Math.cos(v.z * 4) + 0.05 * Math.sin(v.y * 11 + v.x * 7) + 0.03 * Math.sin(v.z * 17 + v.y * 9);
  }
  function hiveSurface(theta, phi, out = 1) {
    const d = V(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
    const n = hiveBump(d) * out;
    return V(d.x * n * HIVE_SCALE[0], d.y * n * HIVE_SCALE[1], d.z * n * HIVE_SCALE[2]);
  }

  function buildHive(skin) {
    const root = new THREE.Group();
    const body = pivot(root, [0, 1.6, 0]);
    skin.emissiveMap = hiveVeins();
    skin.map = hiveVeins();
    skin.emissive = new THREE.Color("#ffffff");
    skin.emissiveIntensity = 1.2;
    skin.userData.baseEmissive = skin.emissive.clone();
    const eyeMat = eyeMaterial("#ff3cac");
    body.add(mesh(cachedGeo("hiveCore", () => {
      const g = new THREE.IcosahedronGeometry(1, 6);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const v = V(p.getX(i), p.getY(i), p.getZ(i));
        v.multiplyScalar(hiveBump(v));
        p.setXYZ(i, v.x * HIVE_SCALE[0], v.y * HIVE_SCALE[1], v.z * HIVE_SCALE[2]);
      }
      g.computeVertexNormals();
      return g;
    }), skin, true));
    // Panzerrippen aus Chitin, die den Kern wie Finger umgreifen
    body.add(mesh(cachedGeo("hiveRibs", () => {
      const parts = [];
      for (let i = 0; i < 8; i++) {
        const phi = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const pts = [];
        for (let k = 0; k <= 8; k++) pts.push(hiveSurface(0.25 + k * 0.27, phi + Math.sin(k * 0.7) * 0.08, 1.05 + Math.sin((k / 8) * Math.PI) * 0.07));
        parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.07, 6));
        // kleine Dornen entlang der Rippe
        for (let k = 2; k <= 6; k += 2) {
          const p0 = hiveSurface(0.25 + k * 0.27, phi, 1.12);
          const dir = p0.clone().normalize();
          parts.push(xf(new THREE.ConeGeometry(0.035, 0.16, 5), { p: p0.add(dir.clone().multiplyScalar(0.08)).toArray(), r: new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir)).toArray().slice(0, 3) }));
        }
      }
      parts.push(xf(new THREE.TorusGeometry(1.58, 0.06, 8, 64), { r: [Math.PI / 2, 0, 0], s: [1, 1, 1] }));
      return merge(parts);
    }), chitinMat(), true));
    // großes Auge vorne mit leuchtender Iris
    body.add(mesh(cachedGeo("hiveEye", () => ball([1.5, -0.12, 0], 0.26, [0.7, 0.85, 1.1], 24)), eyeMat));
    body.add(mesh(cachedGeo("hiveIris", () => merge([
      xf(new THREE.TorusGeometry(0.15, 0.025, 8, 32), { p: [1.68, -0.12, 0], r: [0, Math.PI / 2, 0], s: [1, 1.15, 1] }),
      ball([1.69, -0.12, 0], 0.035, [0.6, 2.4, 1]),
      // kleine Nebenaugen
      ...[[-0.33, 0.12], [0.33, 0.12], [-0.28, -0.32], [0.28, -0.32]].map(([z, y]) => ball([1.5 - Math.abs(z) * 0.2, y - 0.1, z], 0.05, [0.7, 1, 1])),
    ])), glowMat("#ff3cac", 3.2)));
    // Maul an der Unterseite: glühender Schlund, Lippe und Zahnkranz
    body.add(mesh(cachedGeo("hiveThroat", () => xf(new THREE.SphereGeometry(0.36, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), { p: [0, -0.78, 0], s: [1, 0.5, 1] })), glowMat("#ff2a8a", 2.2)));
    body.add(mesh(cachedGeo("hiveLip", () => xf(new THREE.TorusGeometry(0.42, 0.08, 10, 40), { p: [0, -0.8, 0], r: [Math.PI / 2, 0, 0] })), skin));
    body.add(mesh(cachedGeo("hiveTeeth", () => merge(Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return cone([Math.cos(a) * 0.36, -0.9, Math.sin(a) * 0.36], 0.035, 0.18, [Math.PI + Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5], 5);
    }))), toothMat()));
    // Pusteln auf der Haut
    body.add(mesh(cachedGeo("hivePustules", () => {
      const parts = [];
      for (let i = 0; i < 40; i++) {
        const th = 0.5 + ((i * 0.618) % 1) * 1.6;
        const ph = i * 2.399;
        parts.push(ball(hiveSurface(th, ph, 1.0).toArray(), 0.04 + (i % 4) * 0.015, [1, 1, 1], 10));
      }
      return merge(parts);
    }), shared("pustule", () => new THREE.MeshPhysicalMaterial({
      color: "#ff9ae6", transparent: true, opacity: 0.75, roughness: 0.1, clearcoat: 1, emissive: "#ff3cac", emissiveIntensity: 0.9,
    }))));
    // Stachelkrone oben (bricht bei Schaden ab)
    const spines = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const sp = mesh(cachedGeo("hiveSpine", () => merge([cone([0, 0.3, 0], 0.07, 0.6, [0, 0, 0], 7), ball([0, 0.02, 0], 0.1, [1, 0.6, 1])])), chitinMat());
      sp.position.set(Math.cos(a) * 0.5, 0.74, Math.sin(a) * 0.5);
      sp.rotation.set(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55);
      body.add(sp);
      spines.push(sp);
    }
    body.add(mesh(cachedGeo("hiveCrown", () => ball([0, 0.86, 0], 0.16, [1, 0.6, 1])), glowMat("#29e6ff", 2.4)));
    // 4 leuchtende Brutkapseln mit Kolossen darin
    const sacs = [];
    const sacMat = shared("hiveSac", () => new THREE.MeshPhysicalMaterial({
      color: "#ff7ad9", transparent: true, opacity: 0.42, roughness: 0.08, clearcoat: 1, emissive: "#ff3cac", emissiveIntensity: 0.6, side: THREE.DoubleSide,
    }));
    const embryoMat = shared("embryo", () => new THREE.MeshPhysicalMaterial({ color: "#0e0d18", roughness: 0.15, metalness: 0.4, clearcoat: 1 }));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const sac = new THREE.Group();
      sac.position.copy(hiveSurface(1.45, a, 0.98));
      sac.add(mesh(cachedGeo("sacBubble", () => new THREE.SphereGeometry(0.42, 24, 16)), sacMat));
      sac.add(mesh(cachedGeo("sacVeins", () => merge(Array.from({ length: 6 }, (_, k) => {
        const b = (k / 6) * Math.PI * 2;
        return xf(new THREE.TorusGeometry(0.425, 0.01, 4, 32, Math.PI * 0.9), { r: [0, b, 0.3] });
      }))), glowMat("#ff3cac", 1.8)));
      // eingerollter Koloss als Schatten in der Blase
      sac.add(mesh(cachedGeo("sacEmbryo", () => merge([
        limb([0.16, 0.06, 0], [-0.16, 0.12, 0], 0.09), ball([0.2, 0.02, 0], 0.11, [1.4, 0.9, 0.8]),
        ball([-0.05, -0.1, 0], 0.13, [1, 0.8, 0.8]), limb([-0.2, 0.1, 0], [-0.2, -0.15, 0.05], 0.04),
      ])), embryoMat));
      sac.rotation.y = -a;
      body.add(sac);
      sacs.push(sac);
    }
    // Tentakel mit leuchtenden Spitzen
    const tentacles = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      let parent = pivot(body, [Math.cos(a) * 0.85, -0.55, Math.sin(a) * 0.85]);
      parent.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      const chain = [];
      for (let k = 0; k < 7; k++) {
        parent.add(mesh(cachedGeo(`tent${k}`, () => merge([limb([0, 0, 0], [0, -0.26, 0], 0.075 * (1 - k * 0.12) + 0.008), ball([0, -0.13, 0.05 * (1 - k * 0.12)], 0.02 * (1 - k * 0.1))])), skin));
        chain.push(parent);
        parent = pivot(parent, [0, -0.26, 0]);
      }
      parent.add(mesh(cachedGeo("tentTip", () => ball([0, -0.03, 0], 0.04)), glowMat("#29e6ff", 3)));
      tentacles.push({ chain, a });
    }
    return {
      root, body, eyeMat, height: 3.4, breaks: spines.map((m, i) => ({ mesh: m, at: 0.95 - i * 0.1 })), sacs,
      animate(t) {
        body.position.y = 1.6 + Math.sin(t * 0.9) * 0.08;
        body.rotation.y = Math.sin(t * 0.15) * 0.5;
        body.rotation.z = Math.sin(t * 0.7) * 0.03;
        const breathe = 1 + Math.sin(t * 1.2) * 0.015;
        body.scale.set(breathe, 1 / breathe, breathe);
        sacs.forEach((s, i) => s.scale.setScalar(1 + Math.sin(t * 2.4 + i * 1.6) * 0.07));
        tentacles.forEach(({ chain, a }, i) => chain.forEach((seg, k) => {
          seg.rotation.x = Math.sin(t * 1.8 + i + k * 0.6) * 0.16;
          seg.rotation.z = Math.cos(t * 1.6 + i * 1.3 + k * 0.6) * 0.16;
        }));
      },
    };
  }

  // ---------- Öffentliche Schnittstelle ----------
  // kind: "drone" | "tank" | "bossA" | "bossB"; für Drohnen bestimmt props die Körperform
  function build(kind, { level = 1, color = "#29e6ff", props = {} } = {}) {
    let model;
    let skin;
    if (kind === "drone") {
      skin = skinMaterial(color, props.camo ? { transparent: true, opacity: 0.5, iridescence: 1, iridescenceIOR: 1.5 } : {});
      if (props.camo) model = buildCrawler(color, skin);
      else if (props.blast) model = buildBeetle(color, skin);
      else model = buildStarter(level, color, skin);
      addOverlays(model, props, color, skin);
    } else if (kind === "tank") {
      skin = skinMaterial("#7d8cff", { roughness: 0.4 });
      model = buildBrute(skin);
    } else if (kind === "bossA") {
      skin = new THREE.MeshPhysicalMaterial({
        color: "#0f0e1a", roughness: 0.16, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08,
        sheen: 1, sheenColor: new THREE.Color("#6a3cff"), sheenRoughness: 0.3, emissive: "#000000",
      });
      skin.userData.baseEmissive = new THREE.Color("#000000");
      model = buildStalker(skin);
    } else {
      skin = new THREE.MeshPhysicalMaterial({ color: "#3a1a52", roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15, sheen: 0.6, sheenColor: new THREE.Color("#ff7ad9") });
      model = buildHive(skin);
    }
    model.skin = skin;
    model.breaks = model.breaks || [];
    return model;
  }

  return { build };
})();
