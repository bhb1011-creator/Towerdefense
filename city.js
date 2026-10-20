"use strict";

// Die Stadt rund um das Spielfeld im Retro-Miami-Stil (80er Jahre, ohne Science-Fiction):
// Straßennetz mit fahrenden Autos, Ocean Drive mit Art-déco-Häusern, Hochhäuser,
// Strand mit Liegen, Sonnenschirmen, Strandkörben und Rettungsschwimmer-Türmen.
// Die Helfer (Materialien, Texturen, Palmen, Animationen) kommen aus scene.js über City.build(H).

const City = (() => {
  let H = null;
  let rng = null;

  // ---------- Grundriss ----------
  // Avenues (Nord-Süd) und Straßen (Ost-West); das Spielfeld liegt in der Mitte
  const AVENUES = [-74, -58, -44, -30, -17, 17, 30, 44, 58, 74];
  const STREETS = [-10.6, 13, 25, 38, 52, 68];
  const STREET_W = 1.5;
  const WALK_W = 0.4;
  const BOARD = { x: 15.5, z0: -9.4, z1: 11.6 }; // Bereich um das Spielfeld, der frei bleibt
  const EXTENT = { x0: -80, x1: 80, z1: 74 };

  const PASTELS = ["#ff9ad5", "#8ae8ff", "#ffd59a", "#b9a6ff", "#9cffd9", "#ffb38a", "#f4f6ff"];
  const NEONS = ["#ff3cac", "#29e6ff", "#b388ff", "#ffd740", "#69f0ae", "#ff8a5c"];

  // ---------- Geometrie-Sammler: viele Teile zu wenigen Meshes zusammenfassen ----------
  function Batch() {
    const lists = new Map();
    return {
      add(key, geo, matFn, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
        const g = geo.index ? geo.toNonIndexed() : geo.clone();
        g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz)));
        if (!lists.has(key)) lists.set(key, { geos: [], matFn });
        lists.get(key).geos.push(g);
      },
      build(parent, { cast = false, receive = false } = {}) {
        for (const { geos, matFn } of lists.values()) {
          // nur gemeinsame Attribute behalten (Position, Normale, UV)
          for (const g of geos) for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
          const merged = THREE.BufferGeometryUtils.mergeBufferGeometries(geos);
          const m = H.mesh(merged, matFn(), { cast, receive });
          parent.add(m);
        }
      },
    };
  }

  // Quader mit Fenster-UVs: eine Fensterkachel pro Feld Breite und je 2 Felder Höhe
  function windowBox(w, h, d) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const n = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const side = Math.abs(n.getX(i)) > 0.5 ? d : w;
      if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, 0.012, 0.996); // Dach ohne Fenster (dunkle Ecke der Textur, oben links)
      else uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(side)), uv.getY(i) * Math.max(1, Math.round(h / 1.6)));
    }
    return g;
  }

  // ---------- Materialien ----------
  const matCache = new Map();
  const shared = (key, make) => {
    if (!matCache.has(key)) matCache.set(key, make());
    return matCache.get(key);
  };
  function windowTex(seed) {
    return shared(`win${seed}`, () => {
      const t = H.windowTexture(seed).clone();
      t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      // ohne Mipmaps, damit die dunkle Dachecke dunkel bleibt
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      return t;
    });
  }
  // Fenstermaterialien merken, damit nachts mehr Fenster leuchten können
  const lit = [];
  const remember = (m) => {
    m.userData.baseEmissive = m.emissiveIntensity;
    lit.push(m);
    return m;
  };
  const towerMat = (seed) => () => shared(`towerMat${seed}`, () => remember(new THREE.MeshStandardMaterial({
    color: "#1d1433", metalness: 0.85, roughness: 0.28, emissive: "#ffffff", emissiveMap: windowTex(seed), emissiveIntensity: 1.1,
  })));
  const decoMat = (color, seed) => () => shared(`deco${color}${seed}`, () => remember(new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.6), metalness: 0.15, roughness: 0.6, emissive: "#ffe6c8", emissiveMap: windowTex(seed), emissiveIntensity: 0.3,
  })));

  // Helligkeit der Fenster (1 = normal, nachts höher)
  function setLight(k) {
    for (const m of lit) m.emissiveIntensity = m.userData.baseEmissive * k;
  }
  const plainMat = (color, rough = 0.6, metal = 0.1) => () => shared(`plain${color}${rough}${metal}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));

  // ---------- Straßen ----------
  function streetSegments() {
    const segs = [];
    // Avenues von der Ocean Drive bis zum Stadtrand
    for (const x of AVENUES) segs.push({ axis: "z", c: x, a: STREETS[0], b: EXTENT.z1 });
    // Ost-West-Straßen; nahe am Spielfeld unterbrochen
    for (const z of STREETS) {
      if (z < BOARD.z1 + 1 && z > BOARD.z0 - 2 && z !== STREETS[0]) {
        segs.push({ axis: "x", c: z, a: EXTENT.x0, b: -BOARD.x - 1.5 });
        segs.push({ axis: "x", c: z, a: BOARD.x + 1.5, b: EXTENT.x1 });
      } else segs.push({ axis: "x", c: z, a: EXTENT.x0, b: EXTENT.x1 });
    }
    // Zufahrten zu den Portalen (Westen) und vom Stadttor (Osten)
    for (const pts of PATHS) segs.push({ axis: "x", c: pts[0][1] + 0.5 - ROWS / 2, a: -17, b: -COLS / 2 - 0.4, link: true });
    const gateRow = SHARED_PATH[SHARED_PATH.length - 1][1];
    segs.push({ axis: "x", c: gateRow + 0.5 - ROWS / 2, a: COLS / 2 + 2.5, b: 17, link: true });
    return segs;
  }

  function buildStreets(group, segs) {
    const asphalt = new Batch();
    const walks = new Batch();
    const marks = new Batch();
    const y = H.GROUND_Y;
    for (const s of segs) {
      const len = s.b - s.a;
      const mid = (s.a + s.b) / 2;
      const [x, z, ry] = s.axis === "x" ? [mid, s.c, 0] : [s.c, mid, Math.PI / 2];
      asphalt.add("road", new THREE.PlaneGeometry(len + STREET_W, STREET_W).rotateX(-Math.PI / 2), plainMat("#1b1828", 0.35, 0.6), x, y + 0.012, z, ry);
      for (const side of [-1, 1]) {
        const off = side * (STREET_W / 2 + WALK_W / 2);
        const [wx2, wz2] = s.axis === "x" ? [x, z + off] : [x + off, z];
        walks.add("walk", new THREE.BoxGeometry(len + STREET_W + WALK_W * 2, 0.06, WALK_W), plainMat("#4a3d63", 0.8, 0.1), wx2, y + 0.03, wz2, ry);
      }
      // gestrichelte Mittellinie
      for (let d = s.a + 0.6; d < s.b - 0.4; d += 1.4) {
        const [mx, mz] = s.axis === "x" ? [d, s.c] : [s.c, d];
        marks.add("dash", new THREE.PlaneGeometry(0.6, 0.06).rotateX(-Math.PI / 2), () => H.neon("#ffd740", 1.2), mx, y + 0.016, mz, ry);
      }
    }
    asphalt.build(group, { receive: true });
    walks.build(group, { receive: true });
    marks.build(group);
  }

  // ---------- Häuserblöcke ----------
  function blocks(segs) {
    const xs = [EXTENT.x0, ...AVENUES, EXTENT.x1];
    const zs = [...STREETS, EXTENT.z1 + 4];
    const out = [];
    const m = STREET_W / 2 + WALK_W + 0.25;
    for (let i = 0; i < xs.length - 1; i++) {
      for (let k = 0; k < zs.length - 1; k++) {
        const b = { x0: xs[i] + m, x1: xs[i + 1] - m, z0: zs[k] + m, z1: zs[k + 1] - m };
        if (b.x1 - b.x0 < 2 || b.z1 - b.z0 < 2) continue;
        // Bereich um das Spielfeld frei lassen
        if (b.x1 > -BOARD.x - 1 && b.x0 < BOARD.x + 1 && b.z0 < BOARD.z1) continue;
        out.push(b);
      }
    }
    // Zufahrten nicht zubauen
    return out.map((b) => ({ ...b, avoid: segs.filter((s) => s.link) }));
  }

  // Höhe nach Lage: am Strand niedrige Art-déco-Häuser, hinter dem Spielfeld hohe Türme
  function heightFor(x, z) {
    const back = Math.max(0, z - 20) / 50; // je weiter südlich, desto höher
    const side = Math.max(0, Math.abs(x) - 20) / 55;
    return 2 + rng() * 3 + (back * 14 + side * 9) * (0.5 + rng());
  }

  function buildBlocks(group, list) {
    const towers = new Batch();
    const deco = new Batch();
    const trims = new Batch();
    const roofs = new Batch();
    const signs = [];
    const roofLights = [];
    for (const b of list) {
      const oceanRow = b.z0 < 0; // Häuser an der Ocean Drive
      const lotW = oceanRow ? 3.2 : 3.6;
      for (let x = b.x0; x + 1.4 < b.x1; x += lotW) {
        for (let z = b.z0; z + 1.4 < b.z1; z += lotW) {
          const w = Math.min(lotW - 0.5, b.x1 - x) * (0.75 + rng() * 0.25);
          const d = Math.min(lotW - 0.5, b.z1 - z) * (0.75 + rng() * 0.25);
          const cx = x + w / 2 + 0.1;
          const cz = z + d / 2 + 0.1;
          if (b.avoid.some((s) => Math.abs(cz - s.c) < STREET_W / 2 + WALK_W + d / 2 + 0.2 && cx > s.a - 1 && cx < s.b + 1)) continue;
          if (oceanRow) {
            buildDeco(deco, trims, signs, cx, cz, w, d);
          } else {
            const h = heightFor(cx, cz);
            buildTower(towers, trims, roofs, roofLights, cx, cz, w, d, h);
          }
        }
      }
    }
    towers.build(group, { cast: true });
    deco.build(group, { cast: true });
    trims.build(group);
    roofs.build(group);
    for (const s of signs) group.add(s);
    // blinkende Lichter auf den Dächern
    const lights = new THREE.InstancedMesh(H.G("cityRoofLight", () => new THREE.SphereGeometry(0.07, 6, 4)), H.neon("#ff2a4a", 3), roofLights.length);
    roofLights.forEach((p, i) => lights.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    lights.frustumCulled = false;
    group.add(lights);
    H.animate((t) => { lights.visible = Math.sin(t * 2.5) > -0.3; });
  }

  function buildTower(towers, trims, roofs, roofLights, x, z, w, d, h) {
    const y = H.GROUND_Y;
    const seed = 100 + Math.floor(rng() * 5);
    const led = NEONS[Math.floor(rng() * NEONS.length)];
    const style = rng();
    let top = h;
    if (style < 0.25) {
      // runder Turm mit Leuchtringen
      const r = Math.min(w, d) / 2;
      const geo = new THREE.CylinderGeometry(r * 0.92, r, h, 20);
      const uv = geo.attributes.uv;
      const nrm = geo.attributes.normal;
      for (let i = 0; i < uv.count; i++) {
        if (Math.abs(nrm.getY(i)) > 0.9) uv.setXY(i, 0.012, 0.996);
        else uv.setXY(i, uv.getX(i) * Math.round(r * 6), uv.getY(i) * Math.max(1, Math.round(h / 1.6)));
      }
      towers.add(`t${seed}`, geo, towerMat(seed), x, y + h / 2, z);
      for (let ry = 1; ry < h; ry += 1.6 + rng()) trims.add(`ring${led}`, new THREE.TorusGeometry(r * 0.97, 0.03, 6, 24).rotateX(Math.PI / 2), () => H.neon(led, 2.2), x, y + ry, z);
    } else if (style < 0.7) {
      // Block mit Leuchtkanten
      towers.add(`t${seed}`, windowBox(w, h, d), towerMat(seed), x, y + h / 2, z);
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        if (rng() < 0.45) continue;
        trims.add(`edge${led}`, new THREE.BoxGeometry(0.06, h, 0.06), () => H.neon(led, 2.4), x + (sx * w) / 2, y + h / 2, z + (sz * d) / 2);
      }
      roofFrame(trims, led, x, y + h, z, w, d);
    } else {
      // Stufenturm
      let yy = 0;
      let ww = w;
      let dd = d;
      const parts = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < parts; i++) {
        const ph = (h / parts) * (1 - i * 0.1);
        towers.add(`t${seed}`, windowBox(ww, ph, dd), towerMat(seed), x, y + yy + ph / 2, z);
        roofFrame(trims, led, x, y + yy + ph, z, ww, dd);
        yy += ph;
        ww *= 0.72;
        dd *= 0.72;
      }
      top = yy;
    }
    if (h > 5 && rng() < 0.6) {
      const ah = 0.5 + rng() * 1.5;
      roofs.add("antenna", new THREE.CylinderGeometry(0.02, 0.04, ah, 5), plainMat("#b0b8d0", 0.3, 1), x, y + top + ah / 2, z);
      roofLights.push({ x, y: y + top + ah, z });
    }
  }

  // Leuchtender Rahmen um die Dachkante (nur die Kanten, nicht die ganze Fläche)
  function roofFrame(trims, led, x, y, z, w, d) {
    for (const s of [-1, 1]) {
      trims.add(`edge${led}`, new THREE.BoxGeometry(w + 0.06, 0.07, 0.06), () => H.neon(led, 2.4), x, y, z + (s * d) / 2);
      trims.add(`edge${led}`, new THREE.BoxGeometry(0.06, 0.07, d + 0.06), () => H.neon(led, 2.4), x + (s * w) / 2, y, z);
    }
  }

  // Art-déco-Haus an der Ocean Drive: Pastellfarbe, Vordächer, Neon-Schriftzug
  const DECO_NAMES = ["HOTEL", "MOTEL", "CAFE", "DINER", "CLUB", "PALMS", "TIKI", "BAR", "SURF", "ROLLER"];
  function buildDeco(deco, trims, signs, x, z, w, d) {
    const y = H.GROUND_Y;
    const color = PASTELS[Math.floor(rng() * PASTELS.length)];
    const seed = 100 + Math.floor(rng() * 5);
    const h = 1.6 + rng() * 1.6;
    deco.add(`deco${color}${seed}`, windowBox(w, h, d), decoMat(color, seed), x, y + h / 2, z);
    // runde Ecke zur Straße
    deco.add(`deco${color}${seed}`, new THREE.CylinderGeometry(0.45, 0.45, h + 0.3, 16), decoMat(color, seed), x + (rng() < 0.5 ? -1 : 1) * (w / 2 - 0.3), y + (h + 0.3) / 2, z - d / 2 + 0.3);
    const neonC = NEONS[Math.floor(rng() * NEONS.length)];
    // waagerechte Vordächer ("Augenbrauen") mit Neonkante
    for (let ey = 0.9; ey < h - 0.2; ey += 0.8) {
      deco.add("eyebrow", new THREE.BoxGeometry(w + 0.1, 0.05, 0.28), plainMat("#f4f6ff", 0.4), x, y + ey, z - d / 2 - 0.12);
      trims.add(`edge${neonC}`, new THREE.BoxGeometry(w + 0.12, 0.025, 0.025), () => H.neon(neonC, 2.2), x, y + ey - 0.03, z - d / 2 - 0.26);
    }
    // senkrechte Mittelfinne mit Leuchtschrift
    const fh = h + 0.8;
    deco.add("fin", new THREE.BoxGeometry(0.12, fh, 0.5), plainMat("#f4f6ff", 0.4), x, y + fh / 2, z - d / 2 - 0.05);
    trims.add(`edge${neonC}`, new THREE.BoxGeometry(0.03, fh, 0.03), () => H.neon(neonC, 2.6), x, y + fh / 2, z - d / 2 - 0.31);
    if (rng() < 0.75) {
      const name = DECO_NAMES[Math.floor(rng() * DECO_NAMES.length)];
      const sign = new THREE.Mesh(H.G("decoSign", () => new THREE.PlaneGeometry(1.5, 0.75)), new THREE.MeshBasicMaterial({
        map: H.signTexture(name, neonC), transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
      sign.position.set(x, y + h + 0.25, z - d / 2 - 0.2);
      signs.push(sign);
    }
  }

  // ---------- Strand ----------
  function buildBeach(group) {
    const y = H.GROUND_Y;
    const SHORE = H.SHORE_Z;
    // Sand mit feiner Körnung
    const sandTex = H.canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = "#c98fa8";
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 4000; i++) {
        g.fillStyle = `rgba(${rng() < 0.5 ? "255,230,240" : "120,60,110"},${rng() * 0.25})`;
        g.fillRect(rng() * w, rng() * h, 2, 2);
      }
    });
    sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
    sandTex.repeat.set(60, 3);
    const sand = H.mesh(new THREE.PlaneGeometry(260, 5.2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: sandTex, color: "#8a5a86", roughness: 0.95 }), { receive: true });
    sand.position.set(0, y + 0.005, SHORE + 2.6);
    group.add(sand);
    // Strandpromenade mit gemustertem Pflaster
    const promTex = H.canvasTexture(128, 32, (g, w, h) => {
      g.fillStyle = "#e6a8c8";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#8a4a7a";
      g.lineWidth = 3;
      g.beginPath();
      for (let x = 0; x <= w; x += 16) {
        g.moveTo(x, 0);
        g.quadraticCurveTo(x + 8, h / 2, x, h);
      }
      g.stroke();
    });
    promTex.wrapS = THREE.RepeatWrapping;
    promTex.repeat.set(200, 1);
    const prom = H.mesh(new THREE.PlaneGeometry(260, 0.9).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: promTex, roughness: 0.7 }), { receive: true });
    prom.position.set(0, y + 0.02, SHORE + 5.85);
    group.add(prom);

    const props = new Batch();
    const umbrellaColors = ["#ff3cac", "#29e6ff", "#ffd740", "#b388ff", "#ff8a5c", "#69f0ae"];
    const towelColors = ["#ff6ad5", "#4fd8ff", "#ffe066", "#a98bff"];
    const zRows = [SHORE + 1.5, SHORE + 2.8, SHORE + 4.0];
    const lifeguards = [-38, -12, 13, 39];
    for (let x = -64; x < 64; x += 2.6) {
      if (lifeguards.some((lx) => Math.abs(lx - x) < 2.4)) continue;
      zRows.forEach((zr, row) => {
        const ox = x + (row % 2) * 1.3 + (rng() - 0.5) * 0.4;
        const z = zr + (rng() - 0.5) * 0.3;
        const kind = rng();
        if (kind < 0.55) {
          // Sonnenschirm mit zwei Liegen
          const c = umbrellaColors[Math.floor(rng() * umbrellaColors.length)];
          props.add("pole", new THREE.CylinderGeometry(0.015, 0.015, 0.75, 5), plainMat("#f4f6ff", 0.4, 0.3), ox, y + 0.375, z);
          props.add(`umb${c}`, new THREE.ConeGeometry(0.42, 0.18, 8, 1, true), () => H.stripeMat(c), ox, y + 0.78, z, rng() * 3);
          for (const s of [-1, 1]) {
            props.add("lounger", new THREE.BoxGeometry(0.2, 0.04, 0.55), plainMat("#f4f6ff", 0.5), ox + s * 0.22, y + 0.1, z + 0.08);
            props.add("loungerBack", new THREE.BoxGeometry(0.2, 0.04, 0.2), plainMat("#f4f6ff", 0.5), ox + s * 0.22, y + 0.16, z - 0.17, 0, 1, 1, 1);
            props.add("loungerLegs", new THREE.BoxGeometry(0.18, 0.08, 0.02), plainMat("#9aa4c8", 0.4, 0.8), ox + s * 0.22, y + 0.04, z + 0.3);
            props.add(`towel${s}`, new THREE.BoxGeometry(0.16, 0.012, 0.42), plainMat(towelColors[Math.floor(rng() * 4)], 0.9), ox + s * 0.22, y + 0.128, z + 0.1);
          }
        } else if (kind < 0.8) {
          // Strandkorb (mit Haube, gestreiftem Polster)
          const c = umbrellaColors[Math.floor(rng() * umbrellaColors.length)];
          const ry = (rng() - 0.5) * 0.6;
          props.add("korbBase", new THREE.BoxGeometry(0.5, 0.28, 0.32), plainMat("#e8d8b0", 0.85), ox, y + 0.14, z, ry);
          props.add("korbBack", new THREE.BoxGeometry(0.5, 0.42, 0.08), plainMat("#e8d8b0", 0.85), ox, y + 0.48, z - 0.12, ry);
          props.add("korbHood", new THREE.CylinderGeometry(0.25, 0.25, 0.5, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), plainMat("#e8d8b0", 0.85), ox, y + 0.66, z - 0.04, ry);
          props.add(`cushion${c}`, new THREE.BoxGeometry(0.44, 0.05, 0.26), plainMat(c, 0.7), ox, y + 0.3, z + 0.01, ry);
        } else if (kind < 0.9) {
          // Handtuch mit Ball
          props.add(`towelOnly${kind}`, new THREE.BoxGeometry(0.3, 0.01, 0.6), plainMat(towelColors[Math.floor(rng() * 4)], 0.9), ox, y + 0.012, z, rng() * 3);
          props.add("ball", new THREE.SphereGeometry(0.07, 10, 8), plainMat("#ffffff", 0.4), ox + 0.3, y + 0.07, z + 0.1);
        }
      });
    }
    // Rettungsschwimmer-Türme im Miami-Stil (bunt, auf Stelzen, mit Rampe)
    lifeguards.forEach((lx, i) => {
      const z = SHORE + 2.2;
      const c = ["#ff9ad5", "#8ae8ff", "#ffd59a", "#b9a6ff"][i % 4];
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) props.add("stilt", new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6), plainMat("#f4f6ff", 0.4), lx + sx * 0.35, y + 0.45, z + sz * 0.3);
      props.add("lgDeck", new THREE.BoxGeometry(1.1, 0.06, 0.9), plainMat("#f4f6ff", 0.4), lx, y + 0.92, z);
      props.add(`lgHut${c}`, new THREE.BoxGeometry(0.8, 0.6, 0.6), plainMat(c, 0.5), lx, y + 1.25, z + 0.05);
      props.add("lgRoof", new THREE.ConeGeometry(0.65, 0.3, 4).rotateY(Math.PI / 4), plainMat("#f4f6ff", 0.4), lx, y + 1.7, z + 0.05);
      props.add("lgWindow", new THREE.BoxGeometry(0.6, 0.22, 0.02), plainMat("#2a2148", 0.1, 0.8), lx, y + 1.32, z - 0.26);
      props.add("lgRamp", new THREE.BoxGeometry(0.35, 0.04, 1.4), plainMat("#f4f6ff", 0.4), lx, y + 0.46, z + 1.05, 0, 1, 1, 1);
      props.add("lgFlag", new THREE.BoxGeometry(0.02, 0.5, 0.02), plainMat("#f4f6ff", 0.4), lx + 0.45, y + 2.0, z);
      props.add("lgFlagCloth", new THREE.BoxGeometry(0.01, 0.15, 0.25), plainMat("#ff2a4a", 0.7), lx + 0.45, y + 2.15, z + 0.13);
    });
    props.build(group, { cast: true });

    // Palmen an der Promenade
    for (let x = -66; x <= 66; x += 4.4) {
      if (Math.abs(x) < 3) continue;
      const palm = H.makePalm(rng, 2.6 + rng() * 1.2);
      palm.position.set(x + (rng() - 0.5) * 0.8, y, SHORE + 5.25);
      group.add(palm);
    }
    // Palmen-Grünstreifen zwischen Spielfeld und Ocean Drive
    for (let x = -14; x <= 14; x += 3.5) {
      const palm = H.makePalm(rng, 1.8 + rng() * 0.8);
      palm.position.set(x, y, -9.0 + (rng() - 0.5) * 0.4);
      group.add(palm);
    }
  }

  // ---------- Laternen entlang der Straßen ----------
  function buildLamps(group, segs) {
    const pos = [];
    for (const s of segs) {
      if (s.link) continue;
      for (let d = s.a + 1; d < s.b; d += 7) {
        const off = STREET_W / 2 + WALK_W * 0.6;
        if (s.axis === "x") pos.push([d, s.c - off], [d + 2, s.c + off]);
        else pos.push([s.c - off, d], [s.c + off, d + 2]);
      }
    }
    const y = H.GROUND_Y;
    const poles = new THREE.InstancedMesh(H.G("cityLampPole", () => new THREE.CylinderGeometry(0.03, 0.04, 1.3, 5, 1, true)), H.metal("#c0c8e8", 0.3, 1), pos.length);
    const heads = new THREE.InstancedMesh(H.G("cityLampHead", () => new THREE.SphereGeometry(0.09, 6, 4)), H.neon("#ffd0a0", 2.4), pos.length);
    pos.forEach(([x, z], i) => {
      poles.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y + 0.65, z));
      heads.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y + 1.32, z));
    });
    group.add(poles, heads);
  }

  // ---------- Fahrende Retro-Autos ----------
  function buildCars(group, segs) {
    const lanes = segs.filter((s) => !s.link);
    const N = 90;
    const y = H.GROUND_Y;
    // Keilförmiger 80er-Sportwagen
    const bodyGeo = H.G("retroCarBody", () => {
      const parts = [
        new THREE.BoxGeometry(0.62, 0.1, 0.28).translate(0, 0.1, 0),
        new THREE.BoxGeometry(0.28, 0.08, 0.24).translate(-0.04, 0.19, 0),
      ];
      return THREE.BufferGeometryUtils.mergeBufferGeometries(parts.map((p) => p.toNonIndexed()));
    });
    const glassGeo = H.G("retroCarGlass", () => new THREE.BoxGeometry(0.3, 0.05, 0.22).translate(-0.04, 0.2, 0));
    const wheelGeo = H.G("retroCarWheels", () => {
      const parts = [];
      for (const [x, z] of [[0.2, 0.13], [0.2, -0.13], [-0.2, 0.13], [-0.2, -0.13]]) parts.push(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10).rotateX(Math.PI / 2).translate(x, 0.05, z).toNonIndexed());
      return THREE.BufferGeometryUtils.mergeBufferGeometries(parts);
    });
    const headGeo = H.G("retroCarHead", () => new THREE.BoxGeometry(0.02, 0.03, 0.22).translate(0.31, 0.11, 0));
    const tailGeo = H.G("retroCarTail", () => new THREE.BoxGeometry(0.02, 0.03, 0.24).translate(-0.31, 0.12, 0));
    const body = new THREE.InstancedMesh(bodyGeo, H.chrome("#ffffff", 0.18), N);
    const glass = new THREE.InstancedMesh(glassGeo, H.metal("#14102a", 0.05, 0.9), N);
    const wheels = new THREE.InstancedMesh(wheelGeo, H.metal("#0c0a14", 0.6, 0.2), N);
    const heads = new THREE.InstancedMesh(headGeo, H.neon("#fff6d8", 3), N);
    const tails = new THREE.InstancedMesh(tailGeo, H.neon("#ff2a4a", 3), N);
    const carColors = ["#ff3c8a", "#29e6ff", "#ffd740", "#f4f6ff", "#b388ff", "#ff8a3d", "#69f0ae", "#ff2a4a"];
    const cars = [];
    for (let i = 0; i < N; i++) {
      const lane = lanes[Math.floor(rng() * lanes.length)];
      const dir = rng() < 0.5 ? 1 : -1;
      cars.push({ lane, dir, d: lane.a + rng() * (lane.b - lane.a), speed: 1.6 + rng() * 2.2 });
      body.setColorAt(i, new THREE.Color(carColors[i % carColors.length]));
    }
    for (const m of [body, glass, wheels, heads, tails]) {
      m.frustumCulled = false;
      m.castShadow = m === body;
      group.add(m);
    }
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    let last = 0;
    H.animate((t) => {
      const dt = Math.min(0.1, Math.max(0, t - last));
      last = t;
      cars.forEach((c, i) => {
        const L = c.lane;
        c.d += c.dir * c.speed * dt;
        if (c.d > L.b) c.d = L.a;
        if (c.d < L.a) c.d = L.b;
        const off = c.dir * 0.36;
        if (L.axis === "x") {
          p.set(c.d, y + 0.012, L.c + off);
          q.setFromAxisAngle(up, c.dir > 0 ? 0 : Math.PI);
        } else {
          p.set(L.c - off, y + 0.012, c.d);
          q.setFromAxisAngle(up, c.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
        }
        mat.compose(p, q, one);
        body.setMatrixAt(i, mat);
        glass.setMatrixAt(i, mat);
        wheels.setMatrixAt(i, mat);
        heads.setMatrixAt(i, mat);
        tails.setMatrixAt(i, mat);
      });
      for (const m of [body, glass, wheels, heads, tails]) m.instanceMatrix.needsUpdate = true;
    });
  }

  // ---------- Park rund um das Spielfeld ----------
  function buildPark(group) {
    const y = H.GROUND_Y;
    const lawn = H.mesh(new THREE.PlaneGeometry(BOARD.x * 2 + 1.6, BOARD.z1 - BOARD.z0 + 1.0).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
      color: "#0f2a2e", roughness: 0.95, emissive: "#0a3a3a", emissiveIntensity: 0.25,
    }), { receive: true });
    lawn.position.set(0, y + 0.004, (BOARD.z0 + BOARD.z1) / 2);
    group.add(lawn);
    const slabX = COLS / 2 + 0.6;
    const slabZ = ROWS / 2 + 0.6;
    const free = (x, z) => (Math.abs(x) > slabX + 0.6 || Math.abs(z) > slabZ + 0.6) &&
      !PATHS.some((pts) => Math.abs(z - (pts[0][1] + 0.5 - ROWS / 2)) < 1.4 && x < 0) &&
      !(x > 0 && Math.abs(z - (SHARED_PATH[SHARED_PATH.length - 1][1] + 0.5 - ROWS / 2)) < 2.4);
    let n = 0;
    for (let tries = 0; tries < 400 && n < 34; tries++) {
      const x = (rng() - 0.5) * BOARD.x * 2;
      const z = BOARD.z0 + 1.2 + rng() * (BOARD.z1 - BOARD.z0 - 1.6);
      if (!free(x, z)) continue;
      const palm = H.makePalm(rng, 1.6 + rng() * 1.4);
      palm.position.set(x, y, z);
      group.add(palm);
      n++;
    }
    // Gehweg-Ring um das Spielfeld
    const ring = new Batch();
    for (const [w, d, x, z] of [[slabX * 2 + 2.4, 0.5, 0, -slabZ - 0.9], [slabX * 2 + 2.4, 0.5, 0, slabZ + 0.9], [0.5, slabZ * 2 + 1.8, -slabX - 0.9, 0], [0.5, slabZ * 2 + 1.8, slabX + 0.9, 0]]) {
      ring.add("parkWalk", new THREE.BoxGeometry(w, 0.05, d), plainMat("#5a4a78", 0.8, 0.1), x, y + 0.025, z);
    }
    ring.build(group, { receive: true });
  }

  // ---------- Aufbau ----------
  function build(helpers) {
    H = helpers;
    rng = mulberry32(9090);
    const group = new THREE.Group();
    // Stadtboden (dunkler Asphalt-Ton mit feinem Raster)
    const ground = H.mesh(new THREE.PlaneGeometry(420, 260).rotateX(-Math.PI / 2), H.metal("#120a24", 0.6, 0.5), { receive: true });
    ground.position.set(0, H.GROUND_Y - 0.02, H.SHORE_Z + 6.2 + 130);
    group.add(ground);
    buildPark(group);
    const segs = streetSegments();
    buildStreets(group, segs);
    buildBlocks(group, blocks(segs));
    buildBeach(group);
    buildLamps(group, segs);
    buildCars(group, segs);
    return group;
  }

  return { build, setLight };
})();
