"use strict";

// 3D-Darstellung mit Three.js. Liest den Spielzustand aus game.js und
// erzeugt/aktualisiert dafür passende 3D-Objekte.
// Koordinaten: 1 Einheit = 1 Feld, X = Spalte, Z = Zeile, Y = Höhe.

const View = (() => {
  const GRASS_TOP = 0;
  const PATH_TOP = -0.08;
  const WATER_BED = -0.38;
  const WATER_LEVEL = -0.14;
  const BASE_BOTTOM = -0.4;

  let renderer, scene, camera, controls, container;
  let mapGroup = null;
  let obstacleMeshes = new Map();
  let lilyPads = [];
  let hoverMesh, selectMesh, rangeGroup, particleMesh;
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pointer = new THREE.Vector2();

  const towerObjs = new Map();
  const enemyObjs = new Map();
  const projectileObjs = new Map();
  const ringObjs = new Map();
  const textObjs = new Map();
  const textTextures = new Map();

  const MAX_PARTICLES = 1500;
  const tmpMatrix = new THREE.Matrix4();
  const tmpColor = new THREE.Color();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();

  // ---------- Hilfsfunktionen ----------
  const wx = (px) => px / TILE - COLS / 2;
  const wz = (py) => py / TILE - ROWS / 2;
  const tileX = (c) => c + 0.5 - COLS / 2;
  const tileZ = (r) => r + 0.5 - ROWS / 2;

  const matCache = new Map();
  function mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    if (!matCache.has(key)) {
      matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...opts }));
    }
    return matCache.get(key);
  }

  function mesh(geo, material, { cast = true, receive = false } = {}) {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  }

  function disposeTree(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.userData.ownMaterial) o.material.dispose();
    });
  }

  // ---------- Initialisierung ----------
  function init(el) {
    container = el;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.prepend(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color("#9fd0ef");
    scene.fog = new THREE.Fog("#9fd0ef", 28, 55);

    camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 200);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 6;
    controls.maxDistance = 40;
    controls.maxPolarAngle = 1.35;
    controls.screenSpacePanning = false;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    // Licht
    scene.add(new THREE.HemisphereLight("#dcecff", "#3d4a30", 0.55));
    const sun = new THREE.DirectionalLight("#fff1d6", 0.75);
    sun.position.set(-8, 16, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -14; sc.right = 14; sc.top = 10; sc.bottom = -10; sc.near = 1; sc.far = 50;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);

    // Weite Wiese rundherum
    const far = mesh(new THREE.CircleGeometry(80, 32), mat("#3e6a30", { flatShading: false }), { cast: false, receive: true });
    far.rotation.x = -Math.PI / 2;
    far.position.y = -1.05;
    scene.add(far);

    // Hover-, Auswahl- und Reichweitenanzeige
    hoverMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.35, depthWrite: false })
    );
    hoverMesh.visible = false;
    scene.add(hoverMesh);

    selectMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.5, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: "#ffd54a", transparent: true, opacity: 0.9, depthWrite: false })
    );
    selectMesh.visible = false;
    scene.add(selectMesh);

    rangeGroup = new THREE.Group();
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.1, depthWrite: false })
    );
    const edge = new THREE.Mesh(
      new THREE.RingGeometry(0.975, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.6, depthWrite: false })
    );
    rangeGroup.add(fill, edge);
    rangeGroup.visible = false;
    scene.add(rangeGroup);

    // Partikel als kleine Würfel (werden zum Lebensende kleiner)
    particleMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: "#ffffff" }),
      MAX_PARTICLES
    );
    particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    particleMesh.setColorAt(0, tmpColor.set("#ffffff"));
    particleMesh.frustumCulled = false;
    particleMesh.count = 0;
    scene.add(particleMesh);

    setupInput();
    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(container);
    resize();
    resetCamera();
  }

  function resetCamera() {
    // Abstand so wählen, dass die ganze Karte ins Bild passt (auch hochkant)
    const k = Math.max(1, 1.75 / camera.aspect);
    camera.position.set(0, 14.5 * k, 12.5 * k);
    controls.target.set(0, 0, 0.5);
    controls.update();
  }

  // ---------- Eingabe: Klick (ohne Ziehen) = Feld auswählen ----------
  function setupInput() {
    const el = renderer.domElement;
    let down = null;
    el.addEventListener("contextmenu", (ev) => ev.preventDefault());
    el.addEventListener("pointerdown", (ev) => {
      down = { x: ev.clientX, y: ev.clientY, button: ev.button };
    });
    el.addEventListener("pointerup", (ev) => {
      if (!down) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      if (down.button === 0 && moved < 6) {
        const tile = pickTile(ev);
        if (tile) handleTileClick(tile.col, tile.row);
      }
      down = null;
    });
    el.addEventListener("pointermove", (ev) => {
      if (ev.pointerType === "mouse") state.hoverTile = pickTile(ev);
    });
    el.addEventListener("pointerleave", () => {
      state.hoverTile = null;
    });
  }

  function pickTile(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.ray.intersectPlane(groundPlane, tmpPos);
    if (!hit) return null;
    const col = Math.floor(hit.x + COLS / 2);
    const row = Math.floor(hit.z + ROWS / 2);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    return { col, row };
  }

  // ---------- Karte ----------
  function buildMap() {
    if (mapGroup) {
      scene.remove(mapGroup);
      disposeTree(mapGroup);
    }
    mapGroup = new THREE.Group();
    obstacleMeshes = new Map();
    lilyPads = [];
    scene.add(mapGroup);
    const rng = mulberry32(MAP_SEED + 7);

    // Erdsockel
    const base = mesh(new THREE.BoxGeometry(COLS + 0.02, 0.6, ROWS + 0.02), mat("#6d4c33"), { cast: false, receive: true });
    base.position.y = BASE_BOTTOM - 0.3;
    mapGroup.add(base);

    // Felder als Instanzen
    const tiles = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) tiles.push([c, r, grid[r][c]]);
    }
    for (const key of pathTiles) {
      const [c, r] = key.split(",").map(Number);
      if (c < 0 || c >= COLS) tiles.push([c, r, "path"]);
    }
    const tileMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat("#ffffff", { flatShading: false }), tiles.length);
    tileMesh.receiveShadow = true;
    const grassA = new THREE.Color("#4f8a3a");
    const grassB = new THREE.Color("#5b9a42");
    const sandA = new THREE.Color("#c29a5e");
    const sandB = new THREE.Color("#cfab72");
    tiles.forEach(([c, r, type], i) => {
      const v = c >= 0 && c < COLS ? variant[r][c] : 0.5;
      let top = GRASS_TOP;
      if (type === "path") {
        top = PATH_TOP;
        tmpColor.copy(sandA).lerp(sandB, v);
      } else if (type === "water") {
        top = WATER_BED;
        tmpColor.set("#b39b62");
      } else {
        tmpColor.copy(grassA).lerp(grassB, v);
        if ((c + r) % 2 === 0) tmpColor.offsetHSL(0, 0, 0.006);
      }
      const h = top - BASE_BOTTOM;
      tmpMatrix.compose(
        tmpPos.set(tileX(c), BASE_BOTTOM + h / 2, tileZ(r)),
        tmpQuat.identity(),
        tmpScale.set(1, h, 1)
      );
      tileMesh.setMatrixAt(i, tmpMatrix);
      tileMesh.setColorAt(i, tmpColor);
    });
    mapGroup.add(tileMesh);

    // Wasser
    const waterTiles = LAKES.flat();
    const water = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: "#2f78b8", transparent: true, opacity: 0.85, roughness: 0.1, metalness: 0.2 }),
      waterTiles.length
    );
    water.receiveShadow = true;
    waterTiles.forEach(([c, r], i) => {
      tmpMatrix.makeTranslation(tileX(c), WATER_LEVEL, tileZ(r));
      water.setMatrixAt(i, tmpMatrix);
      if (variant[r][c] < 0.45) {
        const pad = new THREE.Group();
        const leaf = mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 10, 1, false, 0.4, Math.PI * 1.8), mat("#3f8f3a"), { cast: false });
        const flower = mesh(new THREE.IcosahedronGeometry(0.05, 0), mat("#f8bbd0"), { cast: false });
        flower.position.y = 0.04;
        pad.add(leaf, flower);
        pad.position.set(tileX(c) - 0.25 + variant[r][c], WATER_LEVEL + 0.01, tileZ(r) + 0.2 - variant[r][c] * 0.5);
        pad.userData.phase = variant[r][c] * 10;
        lilyPads.push(pad);
        mapGroup.add(pad);
      }
    });
    mapGroup.add(water);

    // Grashalme, Blumen und Kiesel
    const grassTiles = tiles.filter(([c, r, t]) => t !== "path" && t !== "water" && c >= 0 && c < COLS);
    const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.025, 0.12, 4), mat("#ffffff"), 700);
    for (let i = 0; i < 700; i++) {
      const [c, r] = grassTiles[Math.floor(rng() * grassTiles.length)];
      tmpMatrix.compose(
        tmpPos.set(tileX(c) - 0.5 + rng(), GRASS_TOP + 0.05, tileZ(r) - 0.5 + rng()),
        tmpQuat.setFromAxisAngle(new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize(), rng() * 0.4),
        tmpScale.setScalar(0.7 + rng() * 0.8)
      );
      tufts.setMatrixAt(i, tmpMatrix);
      tufts.setColorAt(i, tmpColor.set(rng() < 0.5 ? "#3f7a30" : "#4e8f3a"));
    }
    mapGroup.add(tufts);

    const flowerColors = ["#fff59d", "#ffffff", "#f8bbd0", "#ce93d8", "#ffab91"];
    const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.035, 0), mat("#ffffff"), 140);
    for (let i = 0; i < 140; i++) {
      const [c, r] = grassTiles[Math.floor(rng() * grassTiles.length)];
      tmpMatrix.makeTranslation(tileX(c) - 0.5 + rng(), GRASS_TOP + 0.04, tileZ(r) - 0.5 + rng());
      flowers.setMatrixAt(i, tmpMatrix);
      flowers.setColorAt(i, tmpColor.set(flowerColors[Math.floor(rng() * flowerColors.length)]));
    }
    mapGroup.add(flowers);

    const pathList = [...pathTiles].map((k) => k.split(",").map(Number));
    const pebbles = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.04, 0), mat("#ffffff"), 200);
    for (let i = 0; i < 200; i++) {
      const [c, r] = pathList[Math.floor(rng() * pathList.length)];
      tmpMatrix.compose(
        tmpPos.set(tileX(c) - 0.45 + rng() * 0.9, PATH_TOP + 0.01, tileZ(r) - 0.45 + rng() * 0.9),
        tmpQuat.identity(),
        tmpScale.set(1 + rng(), 0.5, 1 + rng())
      );
      pebbles.setMatrixAt(i, tmpMatrix);
      pebbles.setColorAt(i, tmpColor.set(rng() < 0.5 ? "#a98552" : "#ead2a4"));
    }
    pebbles.receiveShadow = true;
    mapGroup.add(pebbles);

    // Bäume und Felsen
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = grid[r][c];
        if (t !== "tree" && t !== "rock") continue;
        const obj = t === "tree" ? makeTree(variant[r][c]) : makeRock(variant[r][c]);
        obj.position.set(tileX(c), GRASS_TOP, tileZ(r));
        obstacleMeshes.set(`${c},${r}`, obj);
        mapGroup.add(obj);
      }
    }

    mapGroup.add(makeCastle());
    for (const pts of pathPoints) mapGroup.add(makeCave(pts[0]));
  }

  function makeTree(v) {
    const g = new THREE.Group();
    const s = 1 + v * 0.35;
    if (v < 0.4) {
      // Tanne
      const trunk = mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 6), mat("#5d4037"));
      trunk.position.y = 0.15;
      g.add(trunk);
      const shades = ["#1b5e20", "#2e7d32", "#388e3c"];
      for (let i = 0; i < 3; i++) {
        const cone = mesh(new THREE.ConeGeometry(0.38 - i * 0.09, 0.45, 7), mat(shades[i]));
        cone.position.y = 0.42 + i * 0.25;
        g.add(cone);
      }
    } else {
      // Laubbaum
      const trunk = mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.45, 6), mat("#6d4c41"));
      trunk.position.y = 0.22;
      g.add(trunk);
      const leafColor = v > 0.75 ? "#8bc34a" : "#4caf50";
      for (const [dx, dy, dz, rad] of [[0, 0.7, 0, 0.3], [-0.18, 0.55, 0.08, 0.22], [0.18, 0.58, -0.06, 0.22], [0.02, 0.9, 0.04, 0.2]]) {
        const blob = mesh(new THREE.IcosahedronGeometry(rad, 0), mat(leafColor));
        blob.position.set(dx, dy, dz);
        blob.rotation.set(v * 5, v * 3, 0);
        g.add(blob);
      }
      if (v > 0.85) {
        for (const [dx, dy, dz] of [[0.2, 0.62, 0.15], [-0.15, 0.75, 0.2], [0.05, 0.6, -0.27]]) {
          const apple = mesh(new THREE.SphereGeometry(0.04, 6, 4), mat("#e53935"), { cast: false });
          apple.position.set(dx, dy, dz);
          g.add(apple);
        }
      }
    }
    g.scale.setScalar(s);
    g.rotation.y = v * Math.PI * 2;
    return g;
  }

  function makeRock(v) {
    const g = new THREE.Group();
    const big = mesh(new THREE.DodecahedronGeometry(0.3, 0), mat("#90a4ae"), { receive: true });
    big.scale.set(1.1, 0.75 + v * 0.3, 0.9);
    big.position.y = 0.15;
    big.rotation.set(v * 3, v * 7, v * 2);
    const small = mesh(new THREE.DodecahedronGeometry(0.15, 0), mat("#78909c"));
    small.position.set(0.25, 0.08, 0.18);
    small.rotation.set(v * 4, v, 0);
    const moss = mesh(new THREE.SphereGeometry(0.12, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), mat("#689f38"), { cast: false });
    moss.scale.set(1.2, 0.35, 0.8);
    moss.position.set(-0.12, 0.33 + v * 0.05, 0.02);
    g.add(big, small, moss);
    g.rotation.y = v * 6;
    return g;
  }

  function makeCastle() {
    const g = new THREE.Group();
    const stone = mat("#a1a1a1");
    const darkStone = mat("#8a8a8a");
    const x = tileX(19);
    // Mauer mit Tor über dem Weg
    for (const z of [tileZ(8), tileZ(10)]) {
      const wall = mesh(new THREE.BoxGeometry(0.5, 0.8, 1), darkStone, { receive: true });
      wall.position.set(x + 0.2, 0.4, z);
      g.add(wall);
    }
    const lintel = mesh(new THREE.BoxGeometry(0.55, 0.35, 1.1), darkStone);
    lintel.position.set(x + 0.2, 1.05, tileZ(9));
    g.add(lintel);
    for (let i = 0; i < 3; i++) {
      const merlon = mesh(new THREE.BoxGeometry(0.55, 0.15, 0.2), darkStone);
      merlon.position.set(x + 0.2, 1.3, tileZ(9) - 0.4 + i * 0.4);
      g.add(merlon);
    }
    const gate = mesh(new THREE.BoxGeometry(0.06, 0.7, 0.8), mat("#4e342e"));
    gate.position.set(x + 0.48, 0.35 + PATH_TOP, tileZ(9));
    g.add(gate);
    // Türme
    for (const r of [8, 10]) {
      const z = tileZ(r);
      const tower = mesh(new THREE.CylinderGeometry(0.42, 0.46, 1.6, 10), stone, { receive: true });
      tower.position.set(x, 0.8, z);
      g.add(tower);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const m = mesh(new THREE.BoxGeometry(0.14, 0.18, 0.14), stone);
        m.position.set(x + Math.cos(a) * 0.38, 1.68, z + Math.sin(a) * 0.38);
        m.rotation.y = -a;
        g.add(m);
      }
      const roof = mesh(new THREE.ConeGeometry(0.36, 0.55, 10), mat("#b71c1c"));
      roof.position.set(x, 1.95, z);
      g.add(roof);
      const pole = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 4), mat("#5d4037"));
      pole.position.set(x, 2.35, z);
      const flag = mesh(new THREE.BoxGeometry(0.25, 0.14, 0.01), mat("#ffd54a"));
      flag.position.set(x + 0.13, 2.47, z);
      flag.userData.flag = true;
      g.add(pole, flag);
      const win = mesh(new THREE.BoxGeometry(0.02, 0.2, 0.1), mat("#3e2723"), { cast: false });
      win.position.set(x - 0.45, 1.1, z);
      g.add(win);
    }
    return g;
  }

  function makeCave(p) {
    const g = new THREE.Group();
    const rock = mesh(new THREE.DodecahedronGeometry(0.9, 0), mat("#6d6a66"), { receive: true });
    rock.scale.set(0.7, 0.8, 1.1);
    rock.position.set(wx(p.x) - 0.45, 0.1, wz(p.y));
    const hole = mesh(new THREE.CircleGeometry(0.38, 12), new THREE.MeshBasicMaterial({ color: "#120e0b" }), { cast: false });
    hole.rotation.y = Math.PI / 2;
    hole.scale.y = 1.2;
    hole.position.set(wx(p.x) + 0.22, 0.25, wz(p.y));
    g.add(rock, hole);
    return g;
  }

  function removeObstacle(c, r) {
    const key = `${c},${r}`;
    const obj = obstacleMeshes.get(key);
    if (!obj) return;
    mapGroup.remove(obj);
    disposeTree(obj);
    obstacleMeshes.delete(key);
  }

  // ---------- Türme ----------
  function makeTower(t) {
    const g = new THREE.Group();
    const base = mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.55, 8), mat("#9e9e9e"), { receive: true });
    base.position.y = 0.275;
    const band = mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.08, 8), mat("#757575"));
    band.position.y = 0.5;
    const door = mesh(new THREE.BoxGeometry(0.14, 0.22, 0.02), mat("#4e342e"), { cast: false });
    door.position.set(0, 0.11, 0.39);
    g.add(base, band, door);

    const head = new THREE.Group();
    head.position.y = 0.62;
    const gun = new THREE.Group();
    head.add(gun);

    if (t.type === "arrow") {
      const plat = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 8), mat("#8d6e63"));
      plat.position.y = 0;
      g.add(plat);
      gun.position.y = 0.12;
      const stock = mesh(new THREE.BoxGeometry(0.5, 0.06, 0.08), mat("#5d4037"));
      stock.position.x = 0.08;
      const bow = mesh(
        new THREE.TorusGeometry(0.2, 0.025, 5, 12, Math.PI).rotateZ(-Math.PI / 2).rotateX(Math.PI / 2),
        mat("#4fc3f7")
      );
      bow.position.x = 0.18;
      const string = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.4, 3).rotateX(Math.PI / 2), mat("#eeeeee"), { cast: false });
      string.position.x = 0.18;
      const bolt = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 4).rotateZ(Math.PI / 2), mat("#d7ccc8"), { cast: false });
      bolt.position.set(0.15, 0.045, 0);
      gun.add(stock, bow, string, bolt);
      const post = mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.12, 6), mat("#5d4037"));
      post.position.y = 0.06;
      head.add(post);
    } else if (t.type === "cannon") {
      const turret = mesh(new THREE.SphereGeometry(0.25, 12, 8), mat("#424242", { metalness: 0.5, roughness: 0.4 }));
      turret.position.y = 0.1;
      gun.position.y = 0.14;
      const barrel = mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.5, 10).rotateZ(Math.PI / 2), mat("#212121", { metalness: 0.6, roughness: 0.35 }));
      barrel.position.x = 0.28;
      const rim = mesh(new THREE.TorusGeometry(0.085, 0.025, 6, 12).rotateY(Math.PI / 2), mat("#ff8a65"));
      rim.position.x = 0.52;
      gun.add(barrel, rim);
      gun.rotation.z = 0.15;
      head.add(turret);
    } else {
      const ring = mesh(new THREE.TorusGeometry(0.22, 0.04, 6, 12).rotateX(Math.PI / 2), mat("#7e57c2"));
      g.add(ring);
      const crystal = mesh(
        new THREE.OctahedronGeometry(0.2, 0),
        new THREE.MeshStandardMaterial({ color: "#d1c4e9", emissive: "#7e57c2", emissiveIntensity: 0.6, roughness: 0.2, flatShading: true })
      );
      crystal.userData.ownMaterial = true;
      crystal.scale.y = 1.7;
      crystal.position.y = 0.35;
      gun.add(crystal);
      for (let i = 0; i < 3; i++) {
        const shard = mesh(new THREE.OctahedronGeometry(0.05, 0), mat("#b3e5fc", { emissive: "#4fc3f7", emissiveIntensity: 0.5 }), { cast: false });
        shard.userData.orbit = i;
        head.add(shard);
      }
      head.userData.crystal = crystal;
    }
    g.add(head);

    const pips = new THREE.Group();
    g.add(pips);
    g.position.set(tileX(t.col), GRASS_TOP, tileZ(t.row));
    g.userData = { head, gun, pips, pipKey: "" };
    return g;
  }

  function updateTower(t, g) {
    const { head, gun, pips } = g.userData;
    if (t.type !== "frost") head.rotation.y = -t.angle;
    gun.position.x = -t.recoil * 0.08;
    if (t.type === "frost") {
      const time = state.time;
      head.userData.crystal.rotation.y = time * 1.5;
      head.userData.crystal.position.y = 0.38 + Math.sin(time * 2 + t.col) * 0.05;
      head.userData.crystal.material.emissiveIntensity = 0.4 + t.recoil * 0.8;
      for (const s of head.children) {
        if (s.userData.orbit === undefined) continue;
        const a = time * 2 + (s.userData.orbit * Math.PI * 2) / 3;
        s.position.set(Math.cos(a) * 0.3, 0.35 + Math.sin(a * 2) * 0.06, Math.sin(a) * 0.3);
        s.rotation.y = a;
      }
    }
    // Ausbaustufen als farbige Steine am Sockel (blau = Reichweite, rot = Schaden)
    const key = `${t.levels.range}-${t.levels.damage}`;
    if (g.userData.pipKey !== key) {
      g.userData.pipKey = key;
      while (pips.children.length) pips.remove(pips.children[0]);
      const add = (count, color, side) => {
        for (let i = 0; i < count; i++) {
          const a = Math.PI / 2 + side * (0.45 + i * 0.32);
          const pip = mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), mat(color, { emissive: color, emissiveIntensity: 0.4 }), { cast: false });
          pip.position.set(Math.cos(a) * 0.41, 0.3, Math.sin(a) * 0.41);
          pip.rotation.y = -a;
          pips.add(pip);
        }
      };
      add(t.levels.range, UPGRADE_PATHS.range.color, 1);
      add(t.levels.damage, UPGRADE_PATHS.damage.color, -1);
    }
  }

  // ---------- Gegner ----------
  function addEyes(model, r, { color = "#ffffff", pupils = true, y = 0.25 } = {}) {
    for (const side of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(r * 0.22, 8, 6), mat(color, color === "#ffffff" ? {} : { emissive: color, emissiveIntensity: 1 }), { cast: false });
      eye.position.set(r * 0.78, r * y, side * r * 0.36);
      model.add(eye);
      if (pupils) {
        const pupil = mesh(new THREE.SphereGeometry(r * 0.12, 6, 4), mat("#1a1a1a"), { cast: false });
        pupil.position.set(r * 0.95, r * y, side * r * 0.36);
        model.add(pupil);
      }
    }
  }

  function makeEnemy(e) {
    const d = e.def;
    const r = (d.radius / TILE) * 1.5;
    const root = new THREE.Group();
    const model = new THREE.Group();
    root.add(model);
    const bodyMat = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.6, flatShading: d.shape === "golem" });
    const tint = [bodyMat];
    const ud = { model, r, bodyMat, tint, parts: {} };

    switch (d.shape) {
      case "slime": {
        bodyMat.transparent = true;
        bodyMat.opacity = 0.82;
        bodyMat.roughness = 0.25;
        const body = mesh(new THREE.SphereGeometry(r, 16, 12), bodyMat);
        body.position.y = r;
        model.add(body);
        ud.parts.body = body;
        if (d.children) {
          // Die Kinder sind im durchsichtigen Körper zu sehen
          const childDef = ENEMY_TYPES[d.children[0][0]];
          for (let i = 0; i < d.children[0][1]; i++) {
            const kid = mesh(new THREE.SphereGeometry(r * 0.32, 8, 6), mat(childDef.color, { transparent: true, opacity: 0.9 }), { cast: false });
            kid.position.set(0, r * 0.75, (i - 0.5) * r * 0.7);
            model.add(kid);
          }
        }
        addEyes(model, r, { y: 1.3 });
        break;
      }
      case "runner": {
        const body = mesh(new THREE.SphereGeometry(r, 12, 10), bodyMat);
        body.scale.set(1.35, 0.85, 0.9);
        body.position.y = r * 1.1;
        model.add(body);
        for (const side of [-1, 1]) {
          const foot = mesh(new THREE.SphereGeometry(r * 0.3, 6, 4), mat("#f9a825"));
          foot.position.set(0, r * 0.3, side * r * 0.45);
          foot.userData.side = side;
          model.add(foot);
          (ud.parts.feet = ud.parts.feet || []).push(foot);
        }
        const ear = mesh(new THREE.ConeGeometry(r * 0.3, r * 0.9, 5), bodyMat);
        ear.rotation.z = Math.PI / 2 + 0.6;
        ear.position.set(-r * 0.9, r * 1.6, 0);
        model.add(ear);
        addEyes(model, r, { y: 1.35 });
        break;
      }
      case "wisp": {
        const core = mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshBasicMaterial({ color: "#e0f7fa" }), { cast: false });
        core.userData.ownMaterial = true;
        core.position.y = r * 2.2;
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: d.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        glow.userData.ownMaterial = true;
        glow.scale.setScalar(r * 6);
        glow.position.y = r * 2.2;
        model.add(core, glow);
        ud.parts.float = [core, glow];
        ud.tint = [];
        break;
      }
      case "beetle": {
        const shell = mesh(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);
        shell.scale.set(1.15, 0.8, 0.95);
        shell.position.y = r * 0.25;
        const line = mesh(new THREE.BoxGeometry(r * 2.1, r * 0.06, r * 0.06), mat("#3e2723"), { cast: false });
        line.position.y = r * 1.03;
        const head = mesh(new THREE.SphereGeometry(r * 0.45, 10, 8), mat("#3e2723"));
        head.position.set(r * 1.1, r * 0.45, 0);
        for (const side of [-1, 1]) {
          const horn = mesh(new THREE.ConeGeometry(r * 0.08, r * 0.5, 4), mat("#3e2723"));
          horn.rotation.z = -Math.PI / 2 + 0.5;
          horn.position.set(r * 1.4, r * 0.8, side * r * 0.2);
          model.add(horn);
        }
        // Gelbe Punkte: die Flitzer im Inneren
        for (const [dx, dz] of [[-0.35, -0.4], [0.25, -0.35], [-0.05, 0.42]]) {
          const dot = mesh(new THREE.SphereGeometry(r * 0.13, 6, 4), mat("#ffee58", { emissive: "#fbc02d", emissiveIntensity: 0.5 }), { cast: false });
          dot.position.set(dx * r, r * 0.95, dz * r);
          model.add(dot);
        }
        model.add(shell, line, head);
        ud.parts.legs = [];
        for (let i = -1; i <= 1; i++) {
          for (const side of [-1, 1]) {
            const leg = mesh(new THREE.BoxGeometry(r * 0.08, r * 0.08, r * 0.7), mat("#3e2723"), { cast: false });
            leg.position.set(i * r * 0.55, r * 0.2, side * r * 0.95);
            leg.userData = { i, side };
            model.add(leg);
            ud.parts.legs.push(leg);
          }
        }
        addEyes(model, r * 0.5, { pupils: false, color: "#ffeb3b" });
        model.children[model.children.length - 1].position.x += r * 0.75;
        model.children[model.children.length - 2].position.x += r * 0.75;
        break;
      }
      case "ghost": {
        bodyMat.transparent = true;
        bodyMat.opacity = 0.8;
        bodyMat.emissive = new THREE.Color("#90a4ae");
        bodyMat.emissiveIntensity = 0.3;
        const top = mesh(new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);
        top.position.y = r * 1.2;
        const skirt = mesh(new THREE.CylinderGeometry(r, r * 1.2, r * 1.1, 14, 1, true), bodyMat);
        skirt.position.y = r * 0.65;
        model.add(top, skirt);
        ud.parts.float = [model];
        addEyes(model, r, { color: "#263238", pupils: false, y: 1.4 });
        break;
      }
      case "healer": {
        const body = mesh(new THREE.SphereGeometry(r, 14, 10), bodyMat);
        body.position.y = r;
        const crossMat = mat("#ffffff", { emissive: "#ffffff", emissiveIntensity: 0.3 });
        const c1 = mesh(new THREE.BoxGeometry(r * 0.25, r * 0.8, r * 0.25), crossMat);
        const c2 = mesh(new THREE.BoxGeometry(r * 0.25, r * 0.25, r * 0.8), crossMat);
        c1.position.y = c2.position.y = r * 2.35;
        const aura = mesh(
          new THREE.TorusGeometry(r * 1.5, r * 0.08, 6, 24).rotateX(Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: "#69f0ae", transparent: true, opacity: 0.6 }),
          { cast: false }
        );
        aura.userData.ownMaterial = true;
        aura.position.y = 0.05;
        model.add(body, c1, c2, aura);
        ud.parts.aura = aura;
        ud.parts.cross = [c1, c2];
        addEyes(model, r, { y: 1.25 });
        break;
      }
      case "golem": {
        const body = mesh(new THREE.IcosahedronGeometry(r, 0), bodyMat);
        body.position.y = r * 1.05;
        body.scale.set(1, 1.05, 1);
        model.add(body);
        ud.parts.arms = [];
        for (const side of [-1, 1]) {
          const arm = mesh(new THREE.DodecahedronGeometry(r * 0.42, 0), bodyMat);
          arm.position.set(0, r * 0.8, side * r * 1.15);
          arm.userData.side = side;
          model.add(arm);
          ud.parts.arms.push(arm);
        }
        const lava = mat("#ff7043", { emissive: "#ff5722", emissiveIntensity: 1 });
        for (const [x, y, z, rot] of [[0.6, 0.6, 0.6, 0.6], [0.3, 1.5, -0.8, -0.4], [-0.5, 1.2, 0.85, 1.1]]) {
          const crack = mesh(new THREE.BoxGeometry(r * 0.5, r * 0.06, r * 0.06), lava, { cast: false });
          crack.position.set(x * r, y * r, z * r);
          crack.rotation.set(rot, rot * 2, rot);
          model.add(crack);
        }
        addEyes(model, r, { color: "#ffab40", pupils: false, y: 1.35 });
        break;
      }
    }

    // Lebensbalken (zeigt immer zur Kamera)
    const hp = new THREE.Group();
    const w = Math.max(0.4, r * 2.4);
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.04, 0.09), new THREE.MeshBasicMaterial({ color: "#1a1a1a", depthWrite: false }));
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.055), new THREE.MeshBasicMaterial({ color: "#66bb6a", depthWrite: false }));
    bg.userData.ownMaterial = fg.userData.ownMaterial = true;
    fg.position.z = 0.002;
    hp.add(bg, fg);
    hp.position.y = r * 2.6 + (d.shape === "wisp" ? r * 1.2 : 0) + (d.shape === "healer" ? r * 0.6 : 0);
    hp.visible = false;
    root.add(hp);
    ud.hp = { group: hp, fg, w };

    model.traverse((o) => {
      if (o.material && (o.material === bodyMat)) o.userData.ownMaterial = true;
    });
    root.userData = ud;
    return root;
  }

  function updateEnemy(e, root) {
    const ud = root.userData;
    const r = ud.r;
    const t = e.wobble;
    root.position.set(wx(e.x), PATH_TOP, wz(e.y));
    ud.model.rotation.y = -e.dir;

    const p = ud.parts;
    if (p.body && e.def.shape === "slime") {
      const s = Math.sin(t) * 0.1;
      p.body.scale.set(1 + s * 0.5, 0.82 - s, 1 + s * 0.5);
      p.body.position.y = r * (0.82 - s);
    }
    if (p.feet) {
      for (const f of p.feet) f.position.x = Math.sin(t * 2.5 + f.userData.side * 1.5) * r * 0.5;
      ud.model.position.y = Math.abs(Math.sin(t * 2.5)) * r * 0.25;
    }
    if (p.legs) {
      for (const l of p.legs) l.rotation.y = Math.sin(t * 2 + l.userData.i + l.userData.side) * 0.5;
    }
    if (p.float) {
      for (const f of p.float) {
        if (f === ud.model) f.position.y = 0.08 + Math.sin(t * 0.7) * 0.05;
        else f.position.y = r * 2.2 + Math.sin(t * 1.3) * 0.06;
      }
    }
    if (p.aura) {
      const pulse = 1 - e.healTimer / e.def.heal.interval;
      p.aura.scale.setScalar(0.7 + pulse * 0.5);
      p.aura.material.opacity = 0.2 + pulse * 0.6;
      for (const c of p.cross) c.rotation.y = t * 0.5;
    }
    if (p.arms) {
      for (const a of p.arms) a.position.x = Math.sin(t * 0.8 + a.userData.side * 1.6) * r * 0.4;
      ud.model.position.y = Math.abs(Math.sin(t * 0.8)) * r * 0.08;
    }

    // Treffer-Blitz (weiß) und Frost (blau)
    for (const m of ud.tint) {
      if (e.flash > 0) {
        m.emissive.set("#ffffff");
        m.emissiveIntensity = 0.9;
      } else if (e.slowFactor < 1) {
        m.emissive.set("#4fc3f7");
        m.emissiveIntensity = 0.6;
      } else if (e.def.shape === "ghost") {
        m.emissive.set("#90a4ae");
        m.emissiveIntensity = 0.3;
      } else {
        m.emissive.set("#000000");
      }
    }

    const k = Math.max(0, e.hp / e.maxHp);
    const hp = ud.hp;
    hp.group.visible = k < 1;
    if (hp.group.visible) {
      hp.group.quaternion.copy(camera.quaternion);
      hp.fg.scale.x = Math.max(0.001, k);
      hp.fg.position.x = -(hp.w * (1 - k)) / 2;
      hp.fg.material.color.set(k > 0.5 ? "#66bb6a" : k > 0.25 ? "#ffca28" : "#ef5350");
    }
  }

  let glowTex = null;
  function glowTexture() {
    if (glowTex) return glowTex;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
    return glowTex;
  }

  // ---------- Geschosse ----------
  function makeProjectile(p) {
    const g = new THREE.Group();
    if (p.kind === "arrow") {
      const shaft = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 4).rotateZ(Math.PI / 2), mat("#6d4c41"), { cast: false });
      const tip = mesh(new THREE.ConeGeometry(0.03, 0.08, 4).rotateZ(-Math.PI / 2), mat("#cfd8dc"), { cast: false });
      tip.position.x = 0.19;
      const fletch = mesh(new THREE.BoxGeometry(0.07, 0.05, 0.01), mat("#4fc3f7"), { cast: false });
      fletch.position.x = -0.14;
      g.add(shaft, tip, fletch);
    } else if (p.kind === "cannon") {
      g.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), mat("#263238", { metalness: 0.5, roughness: 0.4 })));
    } else {
      const shard = mesh(new THREE.OctahedronGeometry(0.07, 0), mat("#e1f5fe", { emissive: "#4fc3f7", emissiveIntensity: 0.8 }), { cast: false });
      shard.scale.x = 1.8;
      g.add(shard);
    }
    return g;
  }

  function updateProjectile(p, g) {
    const travelled = Math.hypot(p.x - p.sx, p.y - p.sy);
    const remaining = Math.hypot(p.tx - p.x, p.ty - p.y);
    const f = travelled / Math.max(1, travelled + remaining);
    const startH = p.kind === "cannon" ? 0.78 : 0.85;
    const endH = (p.target.def ? p.target.def.radius / TILE : 0.25) + PATH_TOP + 0.1;
    let h = startH + (endH - startH) * f;
    if (p.kind === "cannon") h += Math.sin(f * Math.PI) * 0.7;
    g.position.set(wx(p.x), h, wz(p.y));
    g.rotation.y = -p.angle;
    if (p.kind === "frost") g.rotation.x = state.time * 10;
  }

  // ---------- Ringe und Texte ----------
  function makeRing(ring) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: ring.color, transparent: true, depthWrite: false })
    );
    m.userData.ownMaterial = true;
    return m;
  }

  function updateRing(ring, m) {
    const k = ring.life / ring.max;
    const rad = (ring.r / TILE) * (1.1 - k * 0.5);
    m.position.set(wx(ring.x), PATH_TOP + 0.05, wz(ring.y));
    m.scale.setScalar(rad);
    m.material.opacity = k * 0.8;
  }

  function textTexture(text) {
    if (textTextures.has(text)) return textTextures.get(text);
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 64;
    const g = c.getContext("2d");
    g.font = "bold 40px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 8;
    g.strokeStyle = "#3e2a00";
    g.strokeText(text, 64, 32);
    g.fillStyle = "#ffd54a";
    g.fillText(text, 64, 32);
    const tex = new THREE.CanvasTexture(c);
    textTextures.set(text, tex);
    return tex;
  }

  function makeText(t) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(t.text), transparent: true, depthTest: false }));
    s.userData.ownMaterial = true;
    s.scale.set(0.6, 0.3, 1);
    s.renderOrder = 10;
    return s;
  }

  function updateText(t, s) {
    const k = t.life / t.max;
    s.position.set(wx(t.x), 0.8 + (1 - k) * 0.6, wz(t.y));
    s.material.opacity = Math.min(1, k * 2);
  }

  // Objekte zu einer Liste aus dem Spielzustand erzeugen, aktualisieren und entfernen
  function sync(list, objs, create, updateFn) {
    const alive = new Set(list);
    for (const item of list) {
      let obj = objs.get(item);
      if (!obj) {
        obj = create(item);
        objs.set(item, obj);
        scene.add(obj);
      }
      updateFn(item, obj);
    }
    for (const [item, obj] of objs) {
      if (!alive.has(item)) {
        scene.remove(obj);
        if (obj.material && obj.userData.ownMaterial) obj.material.dispose();
        obj.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material && o.userData.ownMaterial) o.material.dispose();
        });
        objs.delete(item);
      }
    }
  }

  // ---------- Pro Bild ----------
  function render(dt) {
    controls.update();
    // Kamera-Ziel auf der Karte halten
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -COLS / 2, COLS / 2);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -ROWS / 2, ROWS / 2);
    controls.target.y = 0;

    const time = state.time;
    for (const pad of lilyPads) pad.position.y = WATER_LEVEL + 0.01 + Math.sin(time * 1.5 + pad.userData.phase) * 0.01;
    mapGroup.traverse((o) => {
      if (o.userData.flag) o.rotation.y = Math.sin(time * 3 + o.position.z) * 0.3;
    });

    sync(state.towers, towerObjs, makeTower, updateTower);
    sync(state.enemies, enemyObjs, makeEnemy, updateEnemy);
    sync(state.projectiles, projectileObjs, makeProjectile, updateProjectile);
    sync(state.rings, ringObjs, makeRing, updateRing);
    sync(state.texts, textObjs, makeText, updateText);

    // Partikel
    const n = Math.min(state.particles.length, MAX_PARTICLES);
    for (let i = 0; i < n; i++) {
      const pa = state.particles[i];
      const s = 0.07 * Math.max(0.05, pa.life / pa.max);
      tmpMatrix.compose(
        tmpPos.set(wx(pa.x), PATH_TOP + pa.z / TILE, wz(pa.y)),
        tmpQuat.setFromAxisAngle(tmpScale.set(1, 1, 0).normalize(), pa.life * 6),
        tmpScale.setScalar(s)
      );
      particleMesh.setMatrixAt(i, tmpMatrix);
      particleMesh.setColorAt(i, tmpColor.set(pa.color));
    }
    particleMesh.count = n;
    particleMesh.instanceMatrix.needsUpdate = true;
    if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;

    updateHelpers();
    renderer.render(scene, camera);
  }

  function updateHelpers() {
    hoverMesh.visible = false;
    rangeGroup.visible = false;
    selectMesh.visible = false;

    const showRange = (x, z, px) => {
      rangeGroup.visible = true;
      rangeGroup.position.set(x, PATH_TOP + 0.03, z);
      rangeGroup.scale.setScalar(px / TILE);
    };

    const hov = state.hoverTile;
    if (hov && !state.gameOver && !towerAt(hov.col, hov.row)) {
      const cell = grid[hov.row][hov.col];
      if (cell !== "path") {
        const ok = canBuild(hov.col, hov.row);
        hoverMesh.visible = true;
        hoverMesh.material.color.set(ok ? "#ffffff" : OBSTACLES[cell] ? "#ffd54a" : "#ff4040");
        const top = cell === "water" ? WATER_LEVEL : GRASS_TOP;
        hoverMesh.position.set(tileX(hov.col), top + 0.02, tileZ(hov.row));
        if (ok) showRange(tileX(hov.col), tileZ(hov.row), TOWER_TYPES[state.selectedType].range);
      }
    }

    const sel = state.selected;
    if (sel && sel.kind === "tower") {
      showRange(tileX(sel.tower.col), tileZ(sel.tower.row), towerStats(sel.tower).range);
      selectMesh.visible = true;
      selectMesh.position.set(tileX(sel.tower.col), GRASS_TOP + 0.02, tileZ(sel.tower.row));
    } else if (sel && sel.kind === "obstacle") {
      selectMesh.visible = true;
      selectMesh.position.set(tileX(sel.col), GRASS_TOP + 0.02, tileZ(sel.row));
    }
  }

  return { init, buildMap, removeObstacle, render, resetCamera };
})();
