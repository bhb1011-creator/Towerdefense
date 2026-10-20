"use strict";

// Gebäude auf dem Spielfeld (Hindernisse, die man abreißen kann) und Deko an der Uferpromenade.
// Jedes Gebäude passt auf ein Feld (ca. 0,9 × 0,9), Mittelpunkt unten bei (0, 0, 0).
// Die Helfer (Materialien, Geometrie-Cache, Animationen) kommen aus scene.js über Buildings.init().

const Buildings = (() => {
  let H = null;
  const PASTELS = ["#c2508f", "#3f8fb8", "#7a55c2", "#3fa58a", "#c28a4a"];
  const NEONS = ["#ff3cac", "#29e6ff", "#b388ff", "#69f0ae", "#ffd740"];
  const SIGNS = [["DINER", "#ff4fd8", "#ffd740"], ["ARCADE", "#29e6ff", "#ff4fd8"], ["24/7", "#29e6ff", "#b388ff"], ["NUDELN", "#ff4fd8", "#ffd740"],
    ["VIDEO", "#b388ff", "#29e6ff"], ["SODA", "#69f0ae", "#29e6ff"], ["PIZZA", "#ffd740", "#ff8a3d"], ["TAPES", "#ff8ad8", "#b388ff"]];
  const signTex = new Map();
  const wallMats = new Map();

  function init(helpers) {
    H = helpers;
  }

  const pick = (list, v, k = 1) => list[Math.floor(v * list.length * k) % list.length];

  function sign(text, a, b) {
    if (!signTex.has(text)) signTex.set(text, H.holoTexture([text], a, b));
    return signTex.get(text);
  }

  // Wand mit leuchtenden Fenstern
  function wall(color, seed, rx = 1, ry = 1) {
    const key = `${color}${seed}${rx}${ry}`;
    if (!wallMats.has(key)) {
      const tex = H.windowTexture(seed).clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(rx, ry);
      wallMats.set(key, new THREE.MeshStandardMaterial({
        color, roughness: 0.3, metalness: 0.5, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 0.9,
      }));
    }
    return wallMats.get(key);
  }

  const box = (key, w, h, d, r = 0.04) => H.G(key, () => new THREE.RoundedBoxGeometry(w, h, d, 3, r));

  function add(g, geo, mat, p, opts = {}) {
    const m = H.mesh(geo, mat, { cast: opts.cast !== false, receive: !!opts.receive });
    m.position.set(...p);
    if (opts.r) m.rotation.set(...opts.r);
    if (opts.s) m.scale.set(...opts.s);
    g.add(m);
    return m;
  }

  function holoSign(g, text, a, b, p, w = 0.56, bob = 0) {
    const m = new THREE.Mesh(H.G(`sign${w}`, () => new THREE.PlaneGeometry(w, w * 0.5)), new THREE.MeshBasicMaterial({
      map: sign(text, a, b), transparent: true, side: THREE.DoubleSide, depthWrite: false,
    }));
    m.userData.ownMaterial = true;
    m.position.set(...p);
    g.add(m);
    if (bob) {
      const ph = Math.random() * 10;
      H.animate((t) => { m.position.y = p[1] + Math.sin(t * 1.6 + ph) * 0.03; });
    }
    return m;
  }

  // ---------- 1. Mini-Hochhaus im Art-déco-Stil ----------
  function tower(v) {
    const g = new THREE.Group();
    const color = pick(PASTELS, v);
    const accent = pick(NEONS, v, 3);
    const h = 1.15 + v * 0.7;
    const tiers = [[0.78, h * 0.55], [0.6, h * 0.3], [0.42, h * 0.15]];
    let y = 0;
    tiers.forEach(([w, th], i) => {
      add(g, box(`towerTier${i}${th.toFixed(2)}`, w, th, w, 0.05), wall(color, 3 + Math.floor(v * 7), 1, Math.max(1, Math.round(th * 2))), [0, y + th / 2, 0]);
      // Neonband an jeder Stufe
      add(g, box(`towerBand${i}`, w + 0.03, 0.035, w + 0.03, 0.015), H.neon(accent, 2.4), [0, y + th, 0], { cast: false });
      y += th;
    });
    // senkrechte Chromrippen vorne
    for (const s of [-1, 1]) add(g, box("towerRib", 0.05, h * 0.55, 0.05, 0.02), H.chrome("#f4f6ff", 0.08), [s * 0.2, h * 0.275, 0.4]);
    // Spitze mit Funkellicht
    add(g, H.G("spire", () => new THREE.ConeGeometry(0.06, 0.45, 10)), H.chrome("#f4f6ff", 0.08), [0, y + 0.22, 0]);
    const light = add(g, H.G("spireLight", () => new THREE.SphereGeometry(0.035, 10, 8)), H.neon("#ff2a4a", 3), [0, y + 0.47, 0], { cast: false });
    const ph = v * 10;
    H.animate((t) => { light.visible = Math.sin(t * 3 + ph) > -0.2; });
    g.rotation.y = Math.floor(v * 4) * (Math.PI / 2);
    return g;
  }

  // ---------- 2. Retro-Diner (Chromkapsel mit Leuchtschrift) ----------
  function diner(v) {
    const g = new THREE.Group();
    const color = pick(["#ff9ad5", "#8ae8ff", "#ffd59a"], v);
    add(g, H.G("dinerBody", () => new THREE.CapsuleGeometry(0.22, 0.42, 8, 20).rotateZ(Math.PI / 2)), H.chrome(color, 0.12), [0, 0.24, 0], { s: [1, 1, 1.2] });
    add(g, H.G("dinerStripe", () => new THREE.TorusGeometry(0.235, 0.018, 6, 32).rotateY(Math.PI / 2)), H.neon("#ff2a6a", 2.6), [0.0, 0.24, 0], { s: [1, 1, 1.2], cast: false });
    // runde Fenster entlang der Seite
    for (let i = -1; i <= 1; i++) {
      add(g, H.G("dinerWin", () => new THREE.CircleGeometry(0.06, 16)), H.neon("#ffe6a8", 1.8), [i * 0.2, 0.27, 0.268], { cast: false });
    }
    add(g, box("dinerBase", 0.86, 0.06, 0.6, 0.02), H.metal("#2a2440", 0.4, 0.6), [0, 0.03, 0], { receive: true });
    const s = holoSign(g, "DINER", "#ff4fd8", "#ffd740", [0, 0.68, 0], 0.5, 1);
    s.rotation.y = 0.2;
    g.rotation.y = v * Math.PI * 2;
    return g;
  }

  // ---------- 3. Spielhalle mit Lauflichtern ----------
  function arcade(v) {
    const g = new THREE.Group();
    const color = pick(["#c7a6ff", "#8ae8ff", "#ff9ad5"], v);
    add(g, box("arcadeBody", 0.8, 0.5, 0.7, 0.05), H.chrome(color, 0.22, 0.6), [0, 0.25, 0]);
    // Dach als Neon-Pyramide
    add(g, H.G("arcadeRoof", () => new THREE.ConeGeometry(0.5, 0.32, 4).rotateY(Math.PI / 4)), H.chrome("#2a1d4a", 0.2), [0, 0.66, 0]);
    const edges = new THREE.LineSegments(H.G("arcadeRoofEdge", () => new THREE.EdgesGeometry(new THREE.ConeGeometry(0.51, 0.33, 4).rotateY(Math.PI / 4))), H.basicLine(pick(NEONS, v, 2)));
    edges.position.y = 0.66;
    g.add(edges);
    // Eingang mit Leuchtschild
    add(g, box("arcadeDoor", 0.3, 0.32, 0.02, 0.01), H.neon("#1affd5", 1.4), [0, 0.17, 0.355], { cast: false });
    holoSign(g, "ARCADE", "#29e6ff", "#ff4fd8", [0, 0.48, 0.37], 0.62).rotation.x = -0.15;
    // Lauflichter am Rand
    const bulbs = [];
    for (let i = 0; i < 8; i++) bulbs.push(add(g, H.G("bulb", () => new THREE.SphereGeometry(0.022, 8, 6)), H.neon("#ffd740", 3), [-0.35 + i * 0.1, 0.52, 0.36], { cast: false }));
    const ph = v * 10;
    H.animate((t) => bulbs.forEach((b, i) => { b.visible = Math.floor(t * 6 + ph + i) % 3 !== 0; }));
    g.rotation.y = Math.floor(v * 4) * (Math.PI / 2);
    return g;
  }

  // ---------- 4. Glaskuppel mit leuchtenden Pflanzen ----------
  function dome(v) {
    const g = new THREE.Group();
    add(g, H.G("domeBase", () => new THREE.CylinderGeometry(0.42, 0.45, 0.1, 32)), H.chrome("#e8ecff", 0.15), [0, 0.05, 0], { receive: true });
    add(g, H.G("domeRing", () => new THREE.TorusGeometry(0.4, 0.02, 6, 40).rotateX(Math.PI / 2)), H.neon(pick(NEONS, v), 2.6), [0, 0.1, 0], { cast: false });
    // Pflanzen
    const plantMat = H.neon("#2bff8a", 0.9);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + v;
      add(g, H.G("plant", () => new THREE.IcosahedronGeometry(0.09, 1)), plantMat, [Math.cos(a) * 0.2, 0.17 + (i % 2) * 0.06, Math.sin(a) * 0.2], { s: [1, 1.4, 1], cast: false });
    }
    add(g, H.G("plantTall", () => new THREE.ConeGeometry(0.07, 0.4, 7)), H.neon("#ff4fd8", 1.2), [0, 0.3, 0], { cast: false });
    const glass = add(g, H.G("domeGlass", () => new THREE.SphereGeometry(0.4, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2)), H.glass(), [0, 0.1, 0], { cast: false });
    glass.renderOrder = 2;
    add(g, H.G("domeFrame", () => {
      const parts = [];
      for (let i = 0; i < 6; i++) parts.push(new THREE.TorusGeometry(0.402, 0.008, 4, 24, Math.PI).rotateY((i / 6) * Math.PI));
      return THREE.BufferGeometryUtils.mergeBufferGeometries(parts);
    }), H.chrome("#f4f6ff", 0.1), [0, 0.1, 0], { cast: false });
    return g;
  }

  // ---------- 5. Funkmast mit drehender Schüssel ----------
  function antenna(v) {
    const g = new THREE.Group();
    add(g, box("mastBase", 0.5, 0.12, 0.5, 0.03), H.metal("#2a2440", 0.4, 0.6), [0, 0.06, 0], { receive: true });
    add(g, H.G("mastLattice", () => {
      const parts = [];
      const h = 1.3;
      for (const [x, z] of [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]]) {
        parts.push(new THREE.CylinderGeometry(0.012, 0.016, h, 5).translate(x * 0.6, h / 2, z * 0.6));
      }
      for (let y = 0.1; y < h; y += 0.18) {
        const w = 0.12 * (1 - y / h * 0.4);
        parts.push(new THREE.BoxGeometry(w, 0.012, 0.012).translate(0, y, 0.06), new THREE.BoxGeometry(0.012, 0.012, w).translate(0.06, y, 0));
      }
      return THREE.BufferGeometryUtils.mergeBufferGeometries(parts.map((p) => p.toNonIndexed()));
    }), H.chrome("#e8ecff", 0.2), [0, 0.1, 0]);
    const head = new THREE.Group();
    head.position.y = 1.0;
    g.add(head);
    add(head, H.G("dish", () => new THREE.SphereGeometry(0.2, 20, 8, 0, Math.PI * 2, 0, Math.PI / 3.2).rotateX(-Math.PI / 2)), H.chrome("#f4f6ff", 0.12), [0, 0, 0.08], { r: [0, 0, 0] });
    add(head, H.G("dishFeed", () => new THREE.CylinderGeometry(0.008, 0.008, 0.2, 5).rotateX(Math.PI / 2)), H.chrome("#f4f6ff", 0.12), [0, 0, 0.15]);
    add(head, H.G("dishTip", () => new THREE.SphereGeometry(0.025, 8, 6)), H.neon("#29e6ff", 3), [0, 0, 0.26], { cast: false });
    const light = add(g, H.G("mastLight", () => new THREE.SphereGeometry(0.035, 8, 6)), H.neon("#ff2a4a", 3.5), [0, 1.47, 0], { cast: false });
    const ph = v * 10;
    H.animate((t) => {
      head.rotation.y = t * 0.6 + ph;
      light.visible = Math.sin(t * 4 + ph) > 0.3;
    });
    return g;
  }

  // ---------- 6. Neon-Laden mit Markise ----------
  function shop(v) {
    const g = new THREE.Group();
    const color = pick(PASTELS, v, 2);
    const [text, a, b] = pick(SIGNS.slice(2), v, 3);
    add(g, box("shopBody", 0.74, 0.44, 0.62, 0.04), wall(color, 11 + Math.floor(v * 5), 1, 1), [0, 0.22, -0.02]);
    add(g, box("shopGlass", 0.6, 0.24, 0.02, 0.01), H.neon("#ffd0a8", 0.8), [0, 0.16, 0.3], { cast: false });
    // gestreifte Markise
    const awning = add(g, H.G("awning", () => new THREE.CylinderGeometry(0.06, 0.06, 0.7, 12, 1, true, 0, Math.PI).rotateZ(Math.PI / 2)), H.stripes(a), [0, 0.34, 0.32], { r: [0.4, 0, 0] });
    awning.castShadow = true;
    add(g, box("shopRoof", 0.8, 0.04, 0.68, 0.015), H.neon(a, 2), [0, 0.46, -0.02], { cast: false });
    holoSign(g, text, a, b, [0, 0.66, 0.05], 0.52, 1);
    g.rotation.y = Math.floor(v * 4) * (Math.PI / 2);
    return g;
  }

  // ---------- 7. Parkhaus mit kleinen Autos ----------
  function garage(v) {
    const g = new THREE.Group();
    const color = pick(["#c7a6ff", "#8ae8ff"], v);
    for (let i = 0; i < 3; i++) {
      add(g, box("deck", 0.84, 0.05, 0.84, 0.02), H.metal(color, 0.55, 0.3), [0, 0.03 + i * 0.26, 0], { receive: true });
      add(g, box("deckEdge", 0.86, 0.02, 0.86, 0.01), H.neon(i % 2 ? "#29e6ff" : "#ff4fd8", 2), [0, 0.065 + i * 0.26, 0], { cast: false });
    }
    for (const [x, z] of [[-0.38, -0.38], [0.38, -0.38], [0.38, 0.38], [-0.38, 0.38]]) {
      add(g, box("pillar", 0.06, 0.55, 0.06, 0.02), H.chrome("#e8ecff", 0.2), [x, 0.3, z]);
    }
    const carColors = ["#ff4f8a", "#29e6ff", "#ffd740", "#f4f6ff", "#b388ff"];
    for (let i = 0; i < 5; i++) {
      const lvl = i % 3;
      add(g, box("miniCar", 0.22, 0.07, 0.11, 0.03), H.chrome(carColors[(i + Math.floor(v * 5)) % 5], 0.15), [-0.22 + (i % 2) * 0.42, 0.1 + lvl * 0.26, -0.2 + Math.floor(i / 2) * 0.2]);
    }
    holoSign(g, "P", "#29e6ff", "#ffffff", [0.32, 0.86, 0.32], 0.24).rotation.y = Math.PI / 4;
    g.rotation.y = Math.floor(v * 4) * (Math.PI / 2);
    return g;
  }

  // ---------- 8. Holo-Kiosk ----------
  function kiosk(v) {
    const g = new THREE.Group();
    const color = pick(["#ff6ad5", "#4fd8ff", "#c38bff", "#ffd36a"], v);
    add(g, box("kioskBody", 0.5, 0.42, 0.42, 0.1), H.chrome(color, 0.18), [0, 0.21, 0]);
    add(g, box("kioskRoof", 0.66, 0.07, 0.56, 0.03), H.chrome("#f0f2ff", 0.1), [0, 0.46, 0]);
    add(g, box("kioskCounter", 0.42, 0.04, 0.12, 0.02), H.neon("#ffffff", 1.6), [0, 0.24, 0.22], { cast: false });
    const [text, a, b] = pick(SIGNS.slice(2), v, 5);
    const s = holoSign(g, text, a, b, [0, 0.72, 0], 0.6, 1);
    const ph = v * 20;
    H.animate((t) => { s.rotation.y = Math.sin(t * 0.5 + ph) * 0.4; });
    g.rotation.y = (Math.floor(v * 4) - 1.5) * 0.2;
    return g;
  }

  // ---------- 9. Palmengarten ----------
  function palms(v) {
    const g = new THREE.Group();
    add(g, H.G("planter", () => new THREE.CylinderGeometry(0.42, 0.44, 0.12, 6)), H.chrome("#f4f6ff", 0.2, 0.5), [0, 0.06, 0], { receive: true });
    add(g, H.G("planterSoil", () => new THREE.CylinderGeometry(0.39, 0.39, 0.02, 6)), H.metal("#1b0f24", 0.9, 0), [0, 0.12, 0], { cast: false });
    add(g, H.G("planterRing", () => new THREE.TorusGeometry(0.43, 0.012, 4, 6).rotateX(Math.PI / 2).rotateY(Math.PI / 6)), H.neon("#ff4fd8", 2.4), [0, 0.125, 0], { cast: false });
    const rng = mulberry32(Math.floor(v * 1e6));
    const n = 2 + Math.floor(v * 2);
    for (let i = 0; i < n; i++) {
      const p = H.makePalm(rng, 0.75 + rng() * 0.45, false);
      const a = (i / n) * Math.PI * 2 + v * 3;
      p.position.set(Math.cos(a) * 0.17, 0.12, Math.sin(a) * 0.17);
      g.add(p);
    }
    return g;
  }

  // ---------- 10. Kühltanks mit Rohren ----------
  function tank(v) {
    const g = new THREE.Group();
    add(g, box("tankBase", 0.84, 0.06, 0.6, 0.02), H.metal("#2a2440", 0.4, 0.6), [0, 0.03, 0], { receive: true });
    const level = [];
    for (const s of [-1, 1]) {
      add(g, H.G("tankBody", () => new THREE.CapsuleGeometry(0.17, 0.5, 8, 20)), H.chrome("#e8ecff", 0.12), [s * 0.2, 0.43, 0]);
      for (const y of [0.25, 0.6]) add(g, H.G("tankBand", () => new THREE.TorusGeometry(0.175, 0.014, 6, 24).rotateX(Math.PI / 2)), H.chrome("#b388ff", 0.2), [s * 0.2, y, 0], { cast: false });
      // Füllstandsanzeige
      level.push(add(g, H.G("tankGauge", () => new THREE.BoxGeometry(0.03, 0.4, 0.01)), H.neon("#29e6ff", 2.5), [s * 0.2, 0.43, 0.176], { cast: false }));
    }
    add(g, H.G("tankPipe", () => new THREE.TorusGeometry(0.2, 0.025, 8, 20, Math.PI)), H.chrome("#f4f6ff", 0.15), [0, 0.82, 0]);
    add(g, H.G("tankFrost", () => new THREE.SphereGeometry(0.06, 10, 8)), H.neon("#bff4ff", 1.5), [0, 1.02, 0], { cast: false });
    const ph = v * 10;
    H.animate((t) => level.forEach((m, i) => { m.scale.y = 0.6 + 0.4 * Math.abs(Math.sin(t * 0.4 + ph + i)); }));
    g.rotation.y = v * Math.PI;
    return g;
  }

  const MAKERS = { tower, diner, arcade, dome, antenna, shop, garage, kiosk, palms, tank };

  function make(kind, v) {
    return (MAKERS[kind] || kiosk)(v);
  }

  return { init, make };
})();
