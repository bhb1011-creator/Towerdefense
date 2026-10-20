"use strict";

// Turm-Modelle, die sich je Ausbauweg und Stufe stark verändern.
// Der stärkste Weg bestimmt die Form des Turmkopfs, der zweite Weg (höchstens Stufe 2)
// fügt kleine Anbauten hinzu. Blickrichtung des Geschützes ist +X.
// Die Helfer (Materialien, Geometrie-Cache) kommen aus scene.js über Towers.init().

const Towers = (() => {
  let H = null;

  function init(helpers) {
    H = helpers;
  }

  // ---------- Bausteine ----------
  const GEO = {
    cyl: (rt, rb, h, seg = 24) => H.G(`cyl${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)),
    // Zylinder entlang +X (für Läufe)
    barrel: (r, len, seg = 16) => H.G(`barrel${r}|${len}|${seg}`, () => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(-Math.PI / 2).translate(len / 2, 0, 0)),
    cone: (r, h, seg = 16) => H.G(`cone${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
    sphere: (r, seg = 24) => H.G(`sph${r}|${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(8, Math.round(seg * 0.6)))),
    hemi: (r) => H.G(`hemi${r}`, () => new THREE.SphereGeometry(r, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2)),
    torus: (r, t, seg = 40, arc = Math.PI * 2) => H.G(`tor${r}|${t}|${seg}|${arc}`, () => new THREE.TorusGeometry(r, t, 8, seg, arc)),
    // Ring quer zur X-Achse (um einen Lauf herum)
    collar: (r, t) => H.G(`collar${r}|${t}`, () => new THREE.TorusGeometry(r, t, 8, 28).rotateY(Math.PI / 2)),
    flat: (r, t) => H.G(`flatRing${r}|${t}`, () => new THREE.TorusGeometry(r, t, 8, 48).rotateX(Math.PI / 2)),
    box: (w, h, d, r = 0.03) => H.G(`rbox${w}|${h}|${d}|${r}`, () => new THREE.RoundedBoxGeometry(w, h, d, 3, r)),
    capsuleX: (r, len) => H.G(`capX${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 14).rotateZ(Math.PI / 2)),
    octa: (r, detail = 0) => H.G(`octa${r}|${detail}`, () => new THREE.OctahedronGeometry(r, detail)),
    ico: (r, detail = 0) => H.G(`ico${r}|${detail}`, () => new THREE.IcosahedronGeometry(r, detail)),
  };

  function part(parent, geo, mat, p = [0, 0, 0], r = [0, 0, 0], s = 1, cast = true) {
    const m = H.mesh(geo, mat, { cast });
    m.position.set(...p);
    m.rotation.set(...r);
    if (Array.isArray(s)) m.scale.set(...s);
    else m.scale.setScalar(s);
    parent.add(m);
    return m;
  }

  function group(parent, p = [0, 0, 0]) {
    const g = new THREE.Group();
    g.position.set(...p);
    parent.add(g);
    return g;
  }

  const C = {
    chrome: (c = "#e8ecff", r = 0.1) => H.chrome(c, r),
    dark: () => H.metal("#252840", 0.25, 1),
    gun: () => H.metal("#3a3f5c", 0.22, 1),
    neon: (c, i = 2.6) => H.neon(c, i),
  };

  // Mehrere Läufe nebeneinander (Anzahl n), Länge len
  function barrels(parent, n, len, r, spread, mat, tipColor, x0 = 0.1) {
    const muzzles = [];
    for (let i = 0; i < n; i++) {
      const z = (i - (n - 1) / 2) * spread;
      part(parent, GEO.barrel(r, len), mat, [x0, 0, z]);
      if (tipColor) part(parent, GEO.sphere(r * 1.1, 12), C.neon(tipColor, 3), [x0 + len, 0, z], [0, 0, 0], 1, false);
      muzzles.push([x0 + len, 0, z]);
    }
    return muzzles;
  }

  // Ring aus kreisförmig angeordneten Läufen (Gatling), dreht sich beim Feuern
  function gatling(parent, n, len, ringR, r, color) {
    const spinner = group(parent, [0.12, 0, 0]);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      part(spinner, GEO.barrel(r, len), C.gun(), [0, Math.cos(a) * ringR, Math.sin(a) * ringR]);
    }
    part(spinner, GEO.collar(ringR + r + 0.01, 0.018), C.neon(color), [len * 0.85, 0, 0], [0, 0, 0], 1, false);
    part(spinner, GEO.collar(ringR + r + 0.01, 0.025), C.chrome(), [0.05, 0, 0]);
    part(spinner, GEO.capsuleX(ringR * 0.6, len * 0.6), C.dark(), [len * 0.4, 0, 0]);
    return spinner;
  }

  // ---------- Sockel (für alle Typen gleich aufgebaut, wächst mit der Gesamtstufe) ----------
  function buildBase(root, type, levels, ctx) {
    const color = TOWER_TYPES[type].color;
    const sum = levels[0] + levels[1] + levels[2];
    const top = Math.max(...levels);
    part(root, GEO.box(1.62, 0.12, 1.62, 0.12), C.chrome("#3a3460", 0.35), [0, 0.06, 0]);
    part(root, GEO.flat(0.74, 0.02), C.neon(color, 2.2), [0, 0.125, 0], [0, 0, 0], 1, false);
    const col = type === "station" ? 0.62 : 0.46;
    part(root, GEO.cyl(col * 0.82, col, 0.34, 36), C.chrome("#e8ecff", 0.12), [0, 0.29, 0]);
    part(root, GEO.flat(col * 0.86, 0.025), C.neon(color, 2.6), [0, 0.42, 0], [0, 0, 0], 1, false);
    // Stützen an den vier Ecken ab Gesamtstufe 4
    if (sum >= 4) {
      for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        part(root, GEO.box(0.16, 0.22, 0.16, 0.04), C.chrome("#d8dcff", 0.15), [x * 0.62, 0.23, z * 0.62]);
        part(root, GEO.sphere(0.04, 12), C.neon(color, 3), [x * 0.62, 0.37, z * 0.62], [0, 0, 0], 1, false);
      }
    }
    // Ausbaustufen als leuchtende Punkte am Sockelrand
    levels.forEach((lvl, p) => {
      const center = Math.PI / 2 + (p - 1) * 1.1;
      for (let i = 0; i < lvl; i++) {
        const a = center + (i - (lvl - 1) / 2) * 0.17;
        part(root, GEO.sphere(0.035, 10), C.neon(PATH_COLORS[p], 3), [Math.cos(a) * 0.8, 0.13, Math.sin(a) * 0.8], [0, 0, 0], 1, false);
      }
    });
    if (top >= 3) part(root, GEO.flat(0.52, 0.022), C.neon(color, 3), [0, 0.2, 0], [0, 0, 0], 1, false);
    if (top >= 5) {
      // Stufe 5: goldener Ring am Boden und Leuchtkrone
      part(root, GEO.flat(0.8, 0.03), C.neon("#ffd740", 3), [0, 0.13, 0], [0, 0, 0], 1, false);
      const crown = part(root, GEO.torus(0.16, 0.02, 6), C.neon("#ffffff", 3.5), [0, ctx.crownY, 0], [Math.PI / 2, 0, 0], 1, false);
      ctx.spin.push({ obj: crown, axis: "z", speed: 1.5 });
      const halo = H.glowSprite(color, 1.3);
      halo.position.y = ctx.crownY;
      root.add(halo);
    }
    return 0.46;
  }

  // ---------- LASER ----------
  const LASER = [
    // 0 Überladung: mehr Läufe, Gatling, Strahlenkanone, Sonnenfeuer
    {
      main(t, k) {
        const color = "#29e6ff";
        if (t <= 2) barrels(k.gun, t === 2 ? 4 : 2, 0.42, 0.035, 0.09, C.gun(), color);
        else if (t === 3) k.spinFire.push(gatling(k.gun, 6, 0.55, 0.07, 0.025, color));
        else {
          // große Strahlenkanone mit Kühlrippen und Spulen
          part(k.gun, GEO.barrel(0.11, 0.62, 24), C.gun(), [0.05, 0, 0]);
          for (let i = 0; i < 4; i++) part(k.gun, GEO.collar(0.125, 0.022), C.neon(color, 3), [0.18 + i * 0.12, 0, 0], [0, 0, 0], 1, false);
          for (const s of [-1, 1]) for (let i = 0; i < 4; i++) part(k.gun, GEO.box(0.05, 0.16, 0.02, 0.008), C.chrome("#d8f7ff", 0.08), [0.12 + i * 0.09, 0, s * 0.14]);
          part(k.gun, GEO.sphere(0.09, 16), C.neon("#bff8ff", 3.5), [0.7, 0, 0], [0, 0, 0], 1, false);
          if (t === 5) {
            // Sonnenfeuer: glühende Sonnenkugel mit Ringen über dem Turm
            const sun = group(k.head, [0, 0.6, 0]);
            part(sun, GEO.sphere(0.2, 28), C.neon("#ffd27a", 3.2), [0, 0, 0], [0, 0, 0], 1, false);
            const r1 = part(sun, GEO.torus(0.3, 0.015, 48), C.neon("#ff8a3d", 3), [0, 0, 0], [1.2, 0, 0], 1, false);
            const r2 = part(sun, GEO.torus(0.36, 0.012, 48), C.neon("#ffd740", 3), [0, 0, 0], [0.4, 0.8, 0], 1, false);
            k.spin.push({ obj: r1, axis: "z", speed: 2 }, { obj: r2, axis: "z", speed: -1.4 });
            const glow = H.glowSprite("#ffb347", 1.6);
            sun.add(glow);
          }
        }
      },
      addon(t, k) {
        // kleine Kondensatoren an den Seiten
        for (let i = 0; i < t; i++) {
          for (const s of [-1, 1]) {
            part(k.head, GEO.cyl(0.045, 0.045, 0.16, 12), C.chrome("#d8f7ff", 0.1), [-0.15 + i * 0.1, 0.05, s * 0.26]);
            part(k.head, GEO.sphere(0.03, 10), C.neon("#29e6ff", 3), [-0.15 + i * 0.1, 0.15, s * 0.26], [0, 0, 0], 1, false);
          }
        }
      },
    },
    // 1 Fokus: Linsen, längerer Lauf, Railgun, Singularitäts-Lanze (ein einziger, sehr langer Lauf)
    {
      main(t, k) {
        const color = "#ff3cac";
        const len = [0.45, 0.5, 0.62, 0.78, 0.9, 1.25][t];
        if (t === 4) {
          // Railgun: zwei lange Schienen mit Spulen dazwischen
          for (const s of [-1, 1]) part(k.gun, GEO.box(len, 0.05, 0.035, 0.012), C.chrome("#f0f2ff", 0.06), [0.1 + len / 2, 0, s * 0.06]);
          for (let i = 0; i < 6; i++) part(k.gun, GEO.collar(0.085, 0.014), C.neon(color, 3), [0.15 + i * (len / 6.5), 0, 0], [0, 0, 0], 1, false);
          part(k.gun, GEO.box(0.3, 0.12, 0.2, 0.03), C.dark(), [0.05, 0, 0]);
          return;
        }
        part(k.gun, GEO.barrel(t === 5 ? 0.06 : 0.045, len, 20), t === 5 ? C.chrome("#f4f6ff", 0.05) : C.gun(), [0.1, 0, 0]);
        // Fokuslinsen entlang des Laufs
        for (let i = 0; i < Math.min(t, 3) + (t === 5 ? 3 : 0); i++) {
          part(k.gun, GEO.collar(t === 5 ? 0.085 : 0.065, 0.016), C.neon(color, 3), [0.25 + i * (len / (t === 5 ? 6.5 : 4)), 0, 0], [0, 0, 0], 1, false);
        }
        part(k.gun, GEO.sphere(t === 5 ? 0.07 : 0.045, 14), C.neon(t >= 1 ? "#ff8ae6" : "#29e6ff", 3.2), [0.1 + len, 0, 0], [0, 0, 0], 1, false);
        if (t === 5) {
          // Singularität: schwarze Kugel mit leuchtendem Ring am hinteren Ende, Stabilisatorflügel
          part(k.gun, GEO.sphere(0.13, 24), H.metal("#05030a", 0.05, 0.6), [-0.2, 0, 0]);
          const ring = part(k.gun, GEO.collar(0.19, 0.02), C.neon("#b14dff", 3.4), [-0.2, 0, 0], [0, 0, 0], 1, false);
          k.spin.push({ obj: ring, axis: "x", speed: 3 });
          for (const s of [-1, 1]) part(k.gun, GEO.box(0.5, 0.015, 0.12, 0.006), C.chrome("#f4f6ff", 0.06), [0.4, s * 0.06, 0], [s * 0.6, 0, 0]);
        }
      },
      addon(t, k) {
        // Zielfernrohr oben
        part(k.head, GEO.barrel(0.03, 0.22 + t * 0.06), C.chrome("#f4f6ff", 0.08), [-0.05, 0.2, 0]);
        part(k.head, GEO.collar(0.035, 0.008), C.neon("#ff3cac", 3), [0.15 + t * 0.06, 0.2, 0], [0, 0, 0], 1, false);
      },
    },
    // 2 Sensorik: Teleskop, Radar, Zielcomputer, Markierungslaser, Orbital-Uplink
    {
      main(t, k) {
        barrels(k.gun, 2, 0.4, 0.032, 0.09, C.gun(), "#ffd740");
        if (t >= 1) part(k.head, GEO.barrel(0.035, 0.3), C.chrome("#fff6d0", 0.08), [-0.1, 0.22, 0.1]);
        if (t >= 2) {
          const radar = group(k.head, [-0.12, 0.3, -0.1]);
          part(radar, GEO.cyl(0.015, 0.015, 0.16, 8), C.chrome(), [0, 0.08, 0]);
          part(radar, GEO.box(0.04, 0.12, 0.26, 0.01), C.chrome("#fff6d0", 0.1), [0.03, 0.18, 0], [0, 0, 0.3]);
          k.spin.push({ obj: radar, axis: "y", speed: 2.5 });
        }
        if (t >= 3) {
          // Zielcomputer mit Bildschirmen
          part(k.head, GEO.box(0.22, 0.16, 0.3, 0.03), C.dark(), [-0.22, 0.12, 0]);
          for (const s of [-1, 1]) part(k.head, GEO.box(0.005, 0.1, 0.12, 0.002), C.neon("#69f0ae", 2), [-0.11, 0.13, s * 0.07], [0, 0, 0], 1, false);
        }
        if (t >= 4) {
          part(k.gun, GEO.barrel(0.02, 0.55), C.chrome("#fff6d0", 0.08), [0.05, 0.1, 0]);
          part(k.gun, GEO.sphere(0.035, 10), C.neon("#ff2a4a", 3.5), [0.6, 0.1, 0], [0, 0, 0], 1, false);
        }
        if (t === 5) {
          // Orbital-Uplink: hoher Mast mit großer Schüssel und Hologramm-Ringen
          const mast = group(k.root, [0, k.headY, 0]);
          part(mast, GEO.cyl(0.03, 0.05, 1.0, 10), C.chrome("#f4f6ff", 0.1), [0, 0.7, 0]);
          const dish = group(mast, [0, 1.15, 0]);
          part(dish, H.G("uplinkDish", () => new THREE.SphereGeometry(0.32, 28, 10, 0, Math.PI * 2, 0, Math.PI / 3.5)), C.chrome("#fff6d0", 0.08), [0, 0, 0], [Math.PI, 0, 0]);
          part(dish, GEO.cyl(0.01, 0.01, 0.3, 6), C.chrome(), [0, -0.12, 0]);
          part(dish, GEO.sphere(0.04, 12), C.neon("#ffd740", 3.5), [0, -0.28, 0], [0, 0, 0], 1, false);
          k.spin.push({ obj: dish, axis: "y", speed: 0.8 });
          for (let i = 0; i < 3; i++) {
            const ring = part(mast, GEO.flat(0.35 + i * 0.12, 0.012), C.neon("#ffd740", 2.6), [0, 0.45 + i * 0.22, 0], [0, 0, 0], 1, false);
            k.pulse.push({ obj: ring, phase: i });
          }
        }
      },
      addon(t, k) {
        const radar = group(k.head, [-0.18, 0.2, 0]);
        part(radar, GEO.box(0.03, 0.08 + t * 0.03, 0.18, 0.01), C.chrome("#fff6d0", 0.1), [0, 0.06, 0]);
        part(radar, GEO.sphere(0.022, 8), C.neon("#ffd740", 3), [0, 0.14 + t * 0.03, 0], [0, 0, 0], 1, false);
        k.spin.push({ obj: radar, axis: "y", speed: 2 });
      },
    },
  ];

  function laserHead(k) {
    // Chromkapsel mit leuchtendem Kern
    part(k.gun, GEO.sphere(0.22, 28), C.chrome("#d8f7ff", 0.07), [0, 0, 0], [0, 0, 0], [1.3, 0.75, 1]);
    part(k.gun, GEO.collar(0.24, 0.018), C.neon("#29e6ff", 2.6), [0, 0, 0], [0, 0, 0], [1, 0.8, 1.05], false);
    part(k.head, GEO.sphere(0.06, 14), C.neon("#29e6ff", 2.8), [0, 0.18, 0], [0, 0, 0], 1, false);
  }

  // ---------- PLASMA ----------
  const PLASMA = [
    // 0 Sprengkraft
    {
      main(t, k) {
        const r = [0.09, 0.105, 0.12, 0.12, 0.17, 0.12][t];
        const len = [0.4, 0.45, 0.48, 0.48, 0.6, 0.35][t];
        part(k.gun, GEO.barrel(r, len, 24), C.gun(), [0.1, 0, 0]);
        for (let i = 0; i < 3; i++) part(k.gun, GEO.collar(r + 0.015, 0.02), C.neon("#ff8a3d", 2.8), [0.18 + i * (len / 3.5), 0, 0], [0, 0, 0], 1, false);
        if (t >= 2) part(k.gun, GEO.sphere(0.16, 20), C.chrome("#ffd9c2", 0.1), [-0.05, 0, 0], [0, 0, 0], [1.3, 1, 1]);
        if (t >= 3) for (const s of [-1, 1]) {
          // Cluster-Kapseln an den Seiten
          for (let i = 0; i < 3; i++) part(k.gun, GEO.capsuleX(0.04, 0.12), C.chrome("#ffb38a", 0.12), [0.05, -0.06 + i * 0.06, s * 0.2]);
        }
        if (t === 4) part(k.gun, GEO.cone(0.2, 0.18, 24), C.gun(), [0.72, 0, 0], [0, 0, -Math.PI / 2]);
        if (t === 5) {
          // Supernova: Kugelwerfer mit gefangenem Stern
          const star = part(k.gun, GEO.sphere(0.2, 28), C.neon("#fff1c4", 3.4), [0.55, 0, 0], [0, 0, 0], 1, false);
          for (let i = 0; i < 3; i++) {
            const cage = part(k.gun, GEO.torus(0.26, 0.016, 40), C.chrome("#ffd9c2", 0.06), [0.55, 0, 0], [i * 1.05, i * 0.7, 0]);
            k.spin.push({ obj: cage, axis: "y", speed: 1 + i * 0.6 });
          }
          const glow = H.glowSprite("#ff8a3d", 1.4);
          glow.position.copy(star.position);
          k.gun.add(glow);
        }
      },
      addon(t, k) {
        part(k.head, GEO.box(0.18, 0.1 + t * 0.04, 0.2, 0.03), C.chrome("#ffd9c2", 0.12), [-0.24, 0.05, 0]);
        part(k.head, GEO.box(0.005, 0.06, 0.12, 0.002), C.neon("#ff8a3d", 2.5), [-0.145, 0.06, 0], [0, 0, 0], 1, false);
      },
    },
    // 1 Schnellfeuer
    {
      main(t, k) {
        const n = [1, 1, 2, 3, 3, 4][t];
        if (t === 5) {
          // Inferno-Batterie: 2×2 Läufe in einem drehenden Block
          const block = group(k.gun, [0.1, 0, 0]);
          for (const [y, z] of [[0.07, 0.07], [0.07, -0.07], [-0.07, 0.07], [-0.07, -0.07]]) part(block, GEO.barrel(0.055, 0.5), C.gun(), [0, y, z]);
          part(block, GEO.collar(0.15, 0.03), C.neon("#ff5a1a", 3), [0.42, 0, 0], [0, 0, 0], 1, false);
          part(block, GEO.collar(0.15, 0.04), C.chrome("#ffd9c2", 0.1), [0.05, 0, 0]);
          k.spinFire.push(block);
          return;
        }
        barrels(k.gun, n, 0.42, 0.07 - n * 0.008, 0.13, C.gun(), "#ff8a3d");
        if (t >= 1) part(k.gun, GEO.cyl(0.08, 0.08, 0.1, 16), C.chrome("#ffd9c2", 0.1), [-0.05, -0.12, 0], [Math.PI / 2, 0, 0]);
        if (t >= 4) for (const s of [-1, 1]) {
          // Flammendüsen
          part(k.gun, GEO.cone(0.05, 0.14, 12), C.gun(), [0.35, 0.1, s * 0.15], [0, 0, -Math.PI / 2]);
          part(k.gun, GEO.sphere(0.035, 10), C.neon("#ff5a1a", 3.2), [0.43, 0.1, s * 0.15], [0, 0, 0], 1, false);
        }
      },
      addon(t, k) {
        // Munitionstrommel
        part(k.head, GEO.cyl(0.08 + t * 0.02, 0.08 + t * 0.02, 0.09, 18), C.chrome("#ffd9c2", 0.12), [-0.1, 0.02, 0.26], [Math.PI / 2, 0, 0]);
      },
    },
    // 2 Schockwelle
    {
      main(t, k) {
        part(k.gun, GEO.barrel(0.09, 0.4, 20), C.gun(), [0.1, 0, 0]);
        for (let i = 0; i < 2 + t; i++) part(k.gun, GEO.collar(0.12 + (i % 2) * 0.02, 0.012), C.neon("#7af3ff", 3), [0.15 + i * 0.07, 0, 0], [0, 0, 0], 1, false);
        if (t >= 2) for (const s of [-1, 1]) {
          // Tesla-Spulen
          part(k.head, GEO.cyl(0.03, 0.05, 0.3, 10), C.chrome("#e8ecff", 0.1), [-0.1, 0.15, s * 0.28]);
          part(k.head, GEO.sphere(0.06, 14), C.neon("#7af3ff", 3), [-0.1, 0.32, s * 0.28], [0, 0, 0], 1, false);
        }
        if (t >= 3) part(k.gun, H.G("empDish", () => new THREE.SphereGeometry(0.2, 24, 8, 0, Math.PI * 2, 0, Math.PI / 3).rotateZ(-Math.PI / 2)), C.chrome("#d8f7ff", 0.08), [0.56, 0, 0]);
        if (t >= 4) {
          const ring = part(k.head, GEO.flat(0.42, 0.03), C.neon("#7af3ff", 3), [0, 0.0, 0], [0, 0, 0], 1, false);
          k.pulse.push({ obj: ring, phase: 0 });
        }
        if (t === 5) {
          // Zeitbombe: großes Ziffernblatt mit drehenden Zeigern über dem Turm
          const clock = group(k.root, [0, k.headY + 0.75, 0]);
          part(clock, GEO.torus(0.3, 0.03, 48), C.chrome("#fff6d0", 0.06), [0, 0, 0]);
          part(clock, GEO.torus(0.26, 0.012, 48), C.neon("#ffd740", 3), [0, 0, 0], [0, 0, 0], 1, false);
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            part(clock, GEO.box(0.02, 0.05, 0.01, 0.004), C.neon("#ffd740", 3), [Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0], [0, 0, a + Math.PI / 2], 1, false);
          }
          const hand = group(clock);
          part(hand, GEO.box(0.02, 0.2, 0.01, 0.004), C.neon("#ff2a4a", 3.5), [0, 0.09, 0.01], [0, 0, 0], 1, false);
          k.spin.push({ obj: hand, axis: "z", speed: -2 }, { obj: clock, axis: "y", speed: 0.5 });
        }
      },
      addon(t, k) {
        for (let i = 0; i < t; i++) part(k.head, GEO.cyl(0.02, 0.03, 0.18, 8), C.chrome(), [-0.2, 0.15, -0.1 + i * 0.2]);
        for (let i = 0; i < t; i++) part(k.head, GEO.sphere(0.035, 10), C.neon("#7af3ff", 3), [-0.2, 0.26, -0.1 + i * 0.2], [0, 0, 0], 1, false);
      },
    },
  ];

  function plasmaHead(k) {
    part(k.head, GEO.sphere(0.28, 28), C.chrome("#ffd9c2", 0.09), [0, 0, 0], [0, 0, 0], [1, 0.8, 1]);
    part(k.head, GEO.flat(0.29, 0.02), C.neon("#ff8a3d", 2.6), [0, 0, 0], [0, 0, 0], 1, false);
    k.gun.position.y = 0.06;
    k.gun.rotation.z = 0.16;
  }

  // ---------- KRYO ----------
  function crystalMat(color, emissive) {
    return H.cachedMat(`crystal${color}${emissive}`, () => new THREE.MeshPhysicalMaterial({
      color, metalness: 0.3, roughness: 0.04, iridescence: 1, iridescenceIOR: 1.8,
      emissive, emissiveIntensity: 0.9, clearcoat: 1, flatShading: true,
    }));
  }

  const CRYO = [
    // 0 Tiefkühlung: der Kristall wächst, Eisstacheln, Nullpunkt-Kristall
    {
      main(t, k) {
        const size = [0.2, 0.22, 0.25, 0.27, 0.29, 0.34][t];
        const mat = t === 5 ? crystalMat("#9fd8ff", "#1a4cff") : crystalMat("#e6dcff", "#7c4dff");
        k.crystal = part(k.head, GEO.octa(size), mat, [0, 0.38, 0], [0, 0, 0], [1, 1.8, 1]);
        if (t >= 2) for (let i = 0; i < 4 + t; i++) {
          const a = (i / (4 + t)) * Math.PI * 2;
          part(k.head, GEO.octa(0.06), crystalMat("#e6f7ff", "#29e6ff"), [Math.cos(a) * 0.3, 0.1, Math.sin(a) * 0.3], [Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4], [0.7, 2.4, 0.7]);
        }
        if (t >= 4) {
          const orbit = group(k.head, [0, 0.38, 0]);
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            part(orbit, GEO.octa(0.05), crystalMat("#e6f7ff", "#29e6ff"), [Math.cos(a) * 0.45, Math.sin(a * 2) * 0.08, Math.sin(a) * 0.45], [0, 0, 0], [0.6, 1.8, 0.6]);
          }
          k.spin.push({ obj: orbit, axis: "y", speed: 1.4 });
        }
        if (t === 5) {
          part(k.head, GEO.sphere(0.09, 16), C.neon("#ffffff", 3.5), [0, 0.38, 0], [0, 0, 0], 1, false);
          const aura = H.glowSprite("#7fdcff", 1.8);
          aura.position.y = 0.38;
          k.head.add(aura);
        }
      },
      addon(t, k) {
        for (let i = 0; i < t + 1; i++) {
          const a = (i / (t + 1)) * Math.PI * 2 + 0.4;
          part(k.head, GEO.octa(0.05), crystalMat("#e6f7ff", "#29e6ff"), [Math.cos(a) * 0.32, 0.08, Math.sin(a) * 0.32], [0, 0, 0], [0.7, 2, 0.7]);
        }
      },
    },
    // 1 Kältefeld: Ringe werden größer und mehr, Eiskuppel, Schneeflocke
    {
      main(t, k) {
        k.crystal = part(k.head, GEO.octa(0.22), crystalMat("#e6dcff", "#7c4dff"), [0, 0.38, 0], [0, 0, 0], [1, 1.7, 1]);
        const n = 2 + Math.min(t, 3);
        for (let i = 0; i < n; i++) {
          const ring = part(k.head, GEO.torus(0.3 + t * 0.04 + i * 0.03, 0.014, 48), C.neon(i % 2 ? "#29e6ff" : "#b388ff", 2.6), [0, 0.38, 0], [Math.PI / 2 + (i - n / 2) * 0.5, 0, 0], 1, false);
          k.spin.push({ obj: ring, axis: "z", speed: (i % 2 ? -1 : 1) * (1.2 + i * 0.3) });
        }
        if (t >= 4) {
          const dome = part(k.head, GEO.hemi(0.55), H.glass(), [0, -0.05, 0], [0, 0, 0], 1, false);
          dome.renderOrder = 2;
        }
        if (t === 5) {
          // Eiszeit: große Schneeflocke über dem Turm
          const flake = group(k.root, [0, k.headY + 0.95, 0]);
          for (let i = 0; i < 6; i++) {
            const arm = group(flake);
            arm.rotation.y = (i / 6) * Math.PI * 2;
            part(arm, GEO.box(0.5, 0.03, 0.03, 0.01), C.neon("#bff4ff", 3), [0.25, 0, 0], [0, 0, 0], 1, false);
            for (const s of [-1, 1]) part(arm, GEO.box(0.14, 0.025, 0.025, 0.01), C.neon("#bff4ff", 3), [0.32, 0, s * 0.05], [0, s * 0.8, 0], 1, false);
          }
          k.spin.push({ obj: flake, axis: "y", speed: 0.7 });
        }
      },
      addon(t, k) {
        const ring = part(k.head, GEO.flat(0.36 + t * 0.06, 0.012), C.neon("#29e6ff", 2.6), [0, 0.08, 0], [0, 0, 0], 1, false);
        k.pulse.push({ obj: ring, phase: 1 });
      },
    },
    // 2 Kristalle: Splitter-Werfer, Prismen, Diamant-Kern
    {
      main(t, k) {
        if (t === 5) {
          // Diamant-Kern: großer geschliffener Diamant
          k.crystal = part(k.head, H.G("diamond", () => {
            const g = new THREE.CylinderGeometry(0.0, 0.32, 0.42, 8, 1);
            const top = new THREE.CylinderGeometry(0.2, 0.32, 0.12, 8, 1).translate(0, 0.27, 0);
            const parts = [g.toNonIndexed(), top.toNonIndexed()];
            return THREE.BufferGeometryUtils.mergeBufferGeometries(parts);
          }), crystalMat("#ffffff", "#ff8ae6"), [0, 0.42, 0]);
        } else {
          k.crystal = part(k.head, GEO.octa(0.2), crystalMat("#e6dcff", "#7c4dff"), [0, 0.38, 0], [0, 0, 0], [1, 1.7, 1]);
        }
        // Splitter-Werfer rund um den Kristall
        const n = [0, 2, 3, 4, 6, 6][t];
        const launchers = group(k.head);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const l = group(launchers, [Math.cos(a) * 0.32, 0.12, Math.sin(a) * 0.32]);
          l.rotation.y = -a;
          part(l, GEO.barrel(0.03, 0.14), C.chrome("#e6dcff", 0.08), [0, 0, 0]);
          part(l, GEO.octa(0.035), crystalMat("#ffffff", "#ff8ae6"), [0.16, 0, 0], [0, 0, 0], [1.4, 1, 1]);
        }
        if (t >= 3) k.spin.push({ obj: launchers, axis: "y", speed: 0.8 });
        if (t >= 3) for (let i = 0; i < 3; i++) {
          const prism = part(k.head, GEO.cone(0.06, 0.2, 3), crystalMat("#ffffff", "#ff8ae6"), [Math.cos(i * 2.1) * 0.15, 0.75, Math.sin(i * 2.1) * 0.15], [0.3, i, 0]);
          k.spin.push({ obj: prism, axis: "y", speed: 2 });
        }
      },
      addon(t, k) {
        for (let i = 0; i < t; i++) {
          const a = i * Math.PI + 0.8;
          part(k.head, GEO.barrel(0.025, 0.12), C.chrome("#e6dcff", 0.08), [Math.cos(a) * 0.3, 0.1, Math.sin(a) * 0.3], [0, -a, 0]);
        }
      },
    },
  ];

  function cryoHead(k) {
    part(k.head, GEO.cyl(0.24, 0.3, 0.1, 6), C.chrome("#e6dcff", 0.1), [0, -0.02, 0]);
    part(k.head, GEO.flat(0.27, 0.015), C.neon("#b388ff", 2.6), [0, 0.03, 0], [0, 0, 0], 1, false);
  }

  // ---------- MÖRSER ----------
  const MORTAR = [
    // 0 Präzision: Rohr wird größer, Haubitze, Titanenhammer
    {
      main(t, k) {
        const r = [0.1, 0.11, 0.13, 0.15, 0.17, 0.2][t];
        const len = [0.5, 0.55, 0.6, 0.66, 0.8, 0.85][t];
        part(k.gun, GEO.barrel(r, len, 24), C.gun(), [0.05, 0, 0]);
        part(k.gun, GEO.collar(r + 0.015, 0.025), C.neon("#ffd740", 3), [0.05 + len, 0, 0], [0, 0, 0], 1, false);
        if (t >= 2) part(k.gun, GEO.collar(r + 0.02, 0.03), C.chrome("#ffe6a0", 0.1), [0.25, 0, 0]);
        if (t >= 4) for (const s of [-1, 1]) {
          // Rückstoßdämpfer
          part(k.gun, GEO.barrel(0.03, 0.4), C.chrome("#f4f6ff", 0.1), [-0.05, 0, s * (r + 0.05)]);
        }
        if (t === 5) {
          // Hammerkopf an der Mündung
          part(k.gun, GEO.box(0.18, 0.5, 0.5, 0.06), C.chrome("#ffe6a0", 0.08), [0.95, 0, 0]);
          part(k.gun, GEO.box(0.02, 0.3, 0.3, 0.02), C.neon("#ffd740", 3), [1.05, 0, 0], [0, 0, 0], 1, false);
        }
      },
      addon(t, k) {
        part(k.head, GEO.box(0.16, 0.14, 0.14, 0.03), C.chrome("#ffe6a0", 0.12), [-0.25, 0.08, 0.2]);
        for (let i = 0; i < t; i++) part(k.head, GEO.sphere(0.03, 10), C.neon("#ffd740", 3), [-0.25 + i * 0.05, 0.17, 0.2], [0, 0, 0], 1, false);
      },
    },
    // 1 Kadenz: mehr Rohre, Munitionsgurt, Sperrfeuer-Raketenwerfer
    {
      main(t, k) {
        if (t === 5) {
          // Sperrfeuer: 3×2 Raketenrohre
          for (let y = 0; y < 2; y++) for (let z = 0; z < 3; z++) {
            part(k.gun, GEO.barrel(0.065, 0.5), C.gun(), [0.05, -0.07 + y * 0.14, -0.14 + z * 0.14]);
            part(k.gun, GEO.sphere(0.05, 10), C.neon("#ff5a1a", 3), [0.52, -0.07 + y * 0.14, -0.14 + z * 0.14], [0, 0, 0], 1, false);
          }
          part(k.gun, GEO.box(0.3, 0.32, 0.46, 0.04), C.chrome("#ffe6a0", 0.12), [0.1, 0, 0]);
          return;
        }
        const n = [1, 1, 2, 3, 3][t];
        barrels(k.gun, n, 0.5, 0.1 - n * 0.015, 0.17, C.gun(), "#ffd740", 0.05);
        if (t >= 1) part(k.head, GEO.box(0.08, 0.06, 0.34, 0.02), C.chrome("#ffe6a0", 0.15), [-0.2, 0.03, 0.12], [0, 0.4, 0]);
        if (t >= 4) for (const s of [-1, 1]) part(k.gun, GEO.sphere(0.04, 10), C.neon("#ff5a1a", 3.2), [0.2, 0.12, s * 0.2], [0, 0, 0], 1, false);
      },
      addon(t, k) {
        for (let i = 0; i < t; i++) part(k.head, GEO.cyl(0.04, 0.04, 0.16, 10), C.chrome("#ffe6a0", 0.12), [-0.28, 0.06, -0.15 + i * 0.1]);
      },
    },
    // 2 Smart-Munition: Sensoren, Raketenkapseln, Orbitalsatellit
    {
      main(t, k) {
        part(k.gun, GEO.barrel(0.1, 0.5, 24), C.gun(), [0.05, 0, 0]);
        part(k.gun, GEO.collar(0.115, 0.025), C.neon("#69f0ae", 3), [0.55, 0, 0], [0, 0, 0], 1, false);
        if (t >= 1) {
          part(k.head, GEO.cyl(0.012, 0.012, 0.4, 6), C.chrome(), [-0.15, 0.3, -0.15]);
          part(k.head, GEO.sphere(0.03, 10), C.neon("#69f0ae", 3), [-0.15, 0.5, -0.15], [0, 0, 0], 1, false);
        }
        if (t >= 3) part(k.head, GEO.sphere(0.07, 16), C.dark(), [0.05, 0.25, 0.18]);
        if (t >= 3) part(k.head, GEO.sphere(0.035, 10), C.neon("#ff2a4a", 3), [0.11, 0.25, 0.18], [0, 0, 0], 1, false);
        if (t >= 4) for (const s of [-1, 1]) {
          for (let i = 0; i < 2; i++) part(k.gun, GEO.capsuleX(0.04, 0.2), C.chrome("#d0ffe8", 0.1), [0.1, -0.04 + i * 0.08, s * 0.2]);
        }
        if (t === 5) {
          // Orbitalschlag: schwebender Satellit mit Sonnensegeln
          const sat = group(k.root, [0, k.headY + 1.1, 0]);
          part(sat, GEO.box(0.2, 0.2, 0.2, 0.04), C.chrome("#f4f6ff", 0.08), [0, 0, 0]);
          for (const s of [-1, 1]) part(sat, GEO.box(0.02, 0.18, 0.4, 0.005), H.metal("#1a2a6a", 0.2, 0.8), [0, 0, s * 0.33]);
          part(sat, GEO.cone(0.08, 0.14, 16), C.chrome(), [0, -0.16, 0], [Math.PI, 0, 0]);
          part(sat, GEO.sphere(0.04, 10), C.neon("#69f0ae", 3.5), [0, -0.25, 0], [0, 0, 0], 1, false);
          k.spin.push({ obj: sat, axis: "y", speed: 0.6 });
          k.bob.push(sat);
        }
      },
      addon(t, k) {
        part(k.head, GEO.cyl(0.01, 0.01, 0.25 + t * 0.1, 6), C.chrome(), [-0.2, 0.2, -0.18]);
        part(k.head, GEO.sphere(0.025, 8), C.neon("#69f0ae", 3), [-0.2, 0.33 + t * 0.05, -0.18], [0, 0, 0], 1, false);
      },
    },
  ];

  function mortarHead(k) {
    part(k.head, GEO.hemi(0.34), C.chrome("#ffe6a0", 0.09), [0, -0.05, 0]);
    part(k.head, GEO.flat(0.34, 0.02), C.neon("#ffd740", 2.6), [0, -0.04, 0], [0, 0, 0], 1, false);
    k.gun.position.y = 0.12;
    k.gun.rotation.z = 0.95; // steil nach oben
  }

  // ---------- RAUMSTATION ----------
  const STATION = [
    // 0 Rumpf: Panzerplatten, Schildkuppel, Schlachtkreuzer
    {
      main(t, k) {
        for (let i = 0; i < Math.min(t, 4) * 2; i++) {
          const a = (i / 8) * Math.PI * 2;
          part(k.head, GEO.box(0.2, 0.12, 0.05, 0.02), C.chrome("#ffd0f0", 0.12), [Math.cos(a) * 0.48, 0.0, Math.sin(a) * 0.48], [0, -a + Math.PI / 2, 0]);
        }
        if (t >= 2) {
          const dome = part(k.head, GEO.hemi(0.62), H.cachedMat("shieldDome", () => new THREE.MeshPhysicalMaterial({
            color: "#ff8ae6", transparent: true, opacity: 0.16, roughness: 0.05, clearcoat: 1, emissive: "#ff3cac", emissiveIntensity: 0.3, depthWrite: false,
          })), [0, -0.05, 0], [0, 0, 0], 1, false);
          dome.renderOrder = 2;
        }
        if (t === 5) {
          // Schlachtkreuzer schwebt über der Station
          const cruiser = group(k.root, [0, k.headY + 1.0, 0]);
          part(cruiser, GEO.capsuleX(0.13, 0.7), C.chrome("#ffe6fb", 0.06), [0, 0, 0]);
          part(cruiser, GEO.box(0.3, 0.04, 0.6, 0.02), C.chrome("#ffd0f0", 0.08), [-0.1, 0, 0]);
          part(cruiser, GEO.box(0.18, 0.12, 0.12, 0.03), C.chrome("#f4f6ff", 0.08), [-0.05, 0.13, 0]);
          for (const s of [-1, 1]) part(cruiser, GEO.sphere(0.05, 10), C.neon("#29e6ff", 3.5), [-0.5, 0, s * 0.08], [0, 0, 0], 1, false);
          part(cruiser, GEO.barrel(0.025, 0.3), C.gun(), [0.4, 0.05, 0]);
          k.spin.push({ obj: cruiser, axis: "y", speed: 0.4 });
          k.bob.push(cruiser);
        }
      },
      addon(t, k) {
        for (let i = 0; i < t * 2; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          part(k.head, GEO.box(0.14, 0.08, 0.04, 0.015), C.chrome("#ffd0f0", 0.12), [Math.cos(a) * 0.47, -0.02, Math.sin(a) * 0.47], [0, -a + Math.PI / 2, 0]);
        }
      },
    },
    // 1 Hangar: mehr Hangartore und Landeplätze, Trägerflotte
    {
      main(t, k) {
        const bays = [1, 1, 2, 3, 4, 4][t];
        for (let i = 0; i < bays; i++) {
          const a = (i / 4) * Math.PI * 2;
          part(k.head, GEO.box(0.22, 0.14, 0.04, 0.02), C.neon("#ffd740", 2), [Math.cos(a) * 0.36, 0.1, Math.sin(a) * 0.36], [0, -a + Math.PI / 2, 0], 1, false);
        }
        if (t >= 3) for (const s of [-1, 1]) {
          part(k.root, GEO.cyl(0.22, 0.24, 0.05, 24), C.chrome("#5a6090", 0.2), [s * 0.55, 0.15, s * -0.55]);
          part(k.root, GEO.flat(0.18, 0.012), C.neon("#ffd740", 2.6), [s * 0.55, 0.18, s * -0.55], [0, 0, 0], 1, false);
        }
        if (t === 5) {
          // Trägerflotte: drei Schiffe kreisen über der Station
          const fleet = group(k.root, [0, k.headY + 0.8, 0]);
          for (let i = 0; i < 3; i++) {
            const ship = H.makeShipModel("#ffd740");
            const a = (i / 3) * Math.PI * 2;
            ship.position.set(Math.cos(a) * 0.55, Math.sin(i) * 0.08, Math.sin(a) * 0.55);
            ship.rotation.y = -a - Math.PI / 2;
            ship.scale.setScalar(0.9);
            fleet.add(ship);
          }
          k.spin.push({ obj: fleet, axis: "y", speed: 0.9 });
        }
      },
      addon(t, k) {
        for (let i = 0; i < t; i++) {
          const a = Math.PI + (i - 0.5) * 0.8;
          part(k.head, GEO.box(0.16, 0.1, 0.03, 0.015), C.neon("#ffd740", 2), [Math.cos(a) * 0.37, 0.08, Math.sin(a) * 0.37], [0, -a + Math.PI / 2, 0], 1, false);
        }
      },
    },
    // 2 Sprengkern: leuchtender Reaktorkern wächst, Nova-Kern
    {
      main(t, k) {
        const r = [0.08, 0.1, 0.12, 0.14, 0.16, 0.22][t];
        const core = part(k.head, GEO.sphere(r, 24), C.neon(t === 5 ? "#ffffff" : "#ff5a1a", 3.2), [0, 0.42, 0], [0, 0, 0], 1, false);
        k.pulse.push({ obj: core, phase: 0, scale: true });
        for (let i = 0; i < Math.min(t, 4); i++) {
          const ring = part(k.head, GEO.torus(r + 0.06 + i * 0.03, 0.012, 40), C.neon(i % 2 ? "#ffd740" : "#ff3cac", 2.8), [0, 0.42, 0], [i * 0.8, i * 0.5, 0], 1, false);
          k.spin.push({ obj: ring, axis: "y", speed: 1 + i * 0.4 });
        }
        part(k.head, GEO.cyl(0.05, 0.08, 0.25, 12), C.chrome(), [0, 0.22, 0]);
        if (t === 5) {
          const glow = H.glowSprite("#ff8a3d", 1.6);
          glow.position.y = 0.42;
          k.head.add(glow);
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            part(k.head, GEO.cone(0.03, 0.2, 8), C.chrome("#ffd0a0", 0.08), [Math.cos(a) * 0.32, 0.42, Math.sin(a) * 0.32], [0, 0, -Math.PI / 2], 1).lookAt(0, 0.42, 0);
          }
        }
      },
      addon(t, k) {
        part(k.head, GEO.sphere(0.05 + t * 0.015, 14), C.neon("#ff5a1a", 3), [0, 0.38, 0], [0, 0, 0], 1, false);
      },
    },
  ];

  function stationHead(k) {
    part(k.head, GEO.cyl(0.46, 0.5, 0.16, 36), C.chrome("#e8ecff", 0.12), [0, -0.02, 0]);
    part(k.head, GEO.hemi(0.34), C.chrome("#ffe6fb", 0.06), [0, 0.06, 0]);
    const ring = part(k.head, GEO.flat(0.56, 0.03), C.neon("#ff4fd8", 2.6), [0, 0.04, 0], [0, 0, 0], 1, false);
    k.stationRing = ring;
  }

  const TYPES = {
    laser: { head: laserHead, paths: LASER, headY: 0.62, aims: true },
    plasma: { head: plasmaHead, paths: PLASMA, headY: 0.68, aims: true },
    cryo: { head: cryoHead, paths: CRYO, headY: 0.48, aims: false },
    mortar: { head: mortarHead, paths: MORTAR, headY: 0.6, aims: true },
    station: { head: stationHead, paths: STATION, headY: 0.5, aims: false },
  };

  // Baut das Modell eines Turms mit bestimmten Ausbaustufen.
  // Rückgabe: { root, head, gun, crystal, spin, spinFire, pulse, bob, stationRing, aims }
  function build(type, levels) {
    const def = TYPES[type];
    const root = new THREE.Group();
    const head = group(root, [0, def.headY, 0]);
    const gun = group(head);
    const order = [0, 1, 2].sort((a, b) => levels[b] - levels[a] || a - b);
    const main = order[0];
    const second = order[1];
    const k = { root, head, gun, headY: def.headY, crownY: def.headY + 1.0, spin: [], spinFire: [], pulse: [], bob: [], crystal: null, stationRing: null };
    buildBase(root, type, levels, k);
    def.head(k);
    def.paths[main].main(levels[main], k);
    if (levels[second] > 0) def.paths[second].addon(levels[second], k);
    // höhere Stufen machen den Turm insgesamt etwas größer
    const top = Math.max(...levels);
    head.scale.setScalar(1 + top * 0.06);
    root.traverse((o) => { if (o.isMesh && o.material && o.material.transparent) o.castShadow = false; });
    return { ...k, aims: def.aims };
  }

  // Animation pro Bild: Drehteile, Pulsieren, Schweben
  function animate(m, time, recoil) {
    for (const s of m.spin) s.obj.rotation[s.axis] = time * s.speed;
    for (const g of m.spinFire) g.rotation.x += 0.05 + recoil * 0.5;
    for (const p of m.pulse) {
      const k = 1 + Math.sin(time * 3 + p.phase * 2) * (p.scale ? 0.12 : 0.06);
      p.obj.scale.setScalar(k);
    }
    for (const b of m.bob) b.position.y += Math.sin(time * 2) * 0.002;
    if (m.crystal) {
      m.crystal.rotation.y = time * 1.5;
      if (m.crystal.material.emissiveIntensity !== undefined) m.crystal.material.emissiveIntensity = 0.7 + recoil * 1.6;
    }
  }

  return { init, build, animate };
})();
