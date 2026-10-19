"use strict";

// 3D-Darstellung mit Three.js im Chromecore-Sci-Fi-Stil.
// Liest den Spielzustand aus game.js und erzeugt/aktualisiert dafür 3D-Objekte.
// Koordinaten: 1 Einheit = 1 Feld, X = Spalte, Z = Zeile, Y = Höhe.

const View = (() => {
  const PAD_TOP = 0.05;
  const ROAD_Y = -0.03;
  const SLAB_TOP = -0.05;
  const MAX_PARTICLES = 2500;

  let renderer, scene, camera, controls, container, composer, bloomPass;
  let mapGroup = null;
  let obstacleMeshes = new Map();
  let animated = []; // { obj, fn(obj, time) } für Animationen der Karte/Stadt
  let roadDashes = null;
  let hoverMesh, selectMesh, rangeGroup, particleMesh, sparkles;
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PAD_TOP);
  const pointer = new THREE.Vector2();

  const towerObjs = new Map();
  const enemyObjs = new Map();
  const shipObjs = new Map();
  const projectileObjs = new Map();
  const ringObjs = new Map();
  const textObjs = new Map();
  const textTextures = new Map();
  const vparts = []; // reine Effekt-Partikel der Darstellung (Funken, Rauch)
  const stars = []; // Funkel-Sterne ✦

  const tmpMatrix = new THREE.Matrix4();
  const tmpColor = new THREE.Color();
  const tmpColor2 = new THREE.Color();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpAxis = new THREE.Vector3(1, 1, 0).normalize();
  const CHARRED = new THREE.Color("#1a1420");
  const EYE_OK = new THREE.Color("#29e6ff");
  const EYE_HURT = new THREE.Color("#ff2a4a");

  // ---------- Hilfsfunktionen ----------
  const wx = (px) => px / TILE - COLS / 2;
  const wz = (py) => py / TILE - ROWS / 2;
  const tileX = (c) => c + 0.5 - COLS / 2;
  const tileZ = (r) => r + 0.5 - ROWS / 2;

  const geoCache = new Map();
  function G(key, make) {
    if (!geoCache.has(key)) {
      const g = make();
      g.userData.shared = true;
      geoCache.set(key, g);
    }
    return geoCache.get(key);
  }

  const matCache = new Map();
  function cached(key, make) {
    if (!matCache.has(key)) matCache.set(key, make());
    return matCache.get(key);
  }
  // Spiegelndes, schillerndes Chrom
  const chrome = (color = "#e8ecff", rough = 0.14, irid = 1) =>
    cached(`chrome${color}${rough}${irid}`, () => new THREE.MeshPhysicalMaterial({
      color, metalness: 1, roughness: rough, iridescence: irid, iridescenceIOR: 1.6,
      iridescenceThicknessRange: [180, 650], clearcoat: 0.6, clearcoatRoughness: 0.1,
    }));
  const metal = (color, rough = 0.35, metalness = 0.8) =>
    cached(`metal${color}${rough}${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness }));
  // Leuchtende Neonfarbe (Werte > 1 erzeugen das Bloom-Leuchten)
  const neon = (color, intensity = 2.5) =>
    cached(`neon${color}${intensity}`, () => new THREE.MeshStandardMaterial({ color: "#000000", emissive: color, emissiveIntensity: intensity, roughness: 0.4 }));
  const basic = (color, opts = {}) =>
    cached(`basic${color}${JSON.stringify(opts)}`, () => new THREE.MeshBasicMaterial({ color, ...opts }));

  function mesh(geo, material, { cast = false, receive = false } = {}) {
    const m = new THREE.Mesh(geo, material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  }

  function disposeObject(obj) {
    obj.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      if (o.material && o.userData.ownMaterial) o.material.dispose();
    });
  }

  function roundedRectPath(p, x, y, w, h, r) {
    p.moveTo(x + r, y);
    p.lineTo(x + w - r, y);
    p.quadraticCurveTo(x + w, y, x + w, y + r);
    p.lineTo(x + w, y + h - r);
    p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    p.lineTo(x + r, y + h);
    p.quadraticCurveTo(x, y + h, x, y + h - r);
    p.lineTo(x, y + r);
    p.quadraticCurveTo(x, y, x + r, y);
    return p;
  }

  function roundedOutline(size, radius, thickness) {
    const s = roundedRectPath(new THREE.Shape(), -size / 2, -size / 2, size, size, radius);
    const i = size - thickness * 2;
    s.holes.push(roundedRectPath(new THREE.Path(), -i / 2, -i / 2, i, i, Math.max(0.01, radius - thickness)));
    return new THREE.ShapeGeometry(s, 6).rotateX(-Math.PI / 2);
  }

  function canvasTexture(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  let glowTex = null;
  function glowTexture() {
    if (!glowTex) {
      glowTex = canvasTexture(64, 64, (g) => {
        const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, "rgba(255,255,255,1)");
        grad.addColorStop(0.3, "rgba(255,255,255,0.55)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
      });
    }
    return glowTex;
  }

  let starTex = null;
  function starTexture() {
    if (!starTex) {
      starTex = canvasTexture(64, 64, (g) => {
        const grad = g.createRadialGradient(32, 32, 0, 32, 32, 12);
        grad.addColorStop(0, "rgba(255,255,255,1)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = "#ffffff";
        g.beginPath();
        g.moveTo(32, 0);
        g.quadraticCurveTo(35, 29, 64, 32);
        g.quadraticCurveTo(35, 35, 32, 64);
        g.quadraticCurveTo(29, 35, 0, 32);
        g.quadraticCurveTo(29, 29, 32, 0);
        g.fill();
      });
    }
    return starTex;
  }

  function glowSprite(color, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    s.userData.ownMaterial = true;
    s.scale.setScalar(size);
    return s;
  }

  // Himmel-Farbverlauf im Synthwave-Stil (wird auch für die Spiegelungen genutzt)
  function skyMaterial() {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color("#0b0626") },
        mid: { value: new THREE.Color("#3b0f63") },
        low: { value: new THREE.Color("#c2257f") },
        horizon: { value: new THREE.Color("#ff8a5c") },
        bottom: { value: new THREE.Color("#1a0830") },
      },
      vertexShader: "varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 horizon; uniform vec3 bottom;
        varying vec3 vPos;
        void main(){
          float h = normalize(vPos).y;
          vec3 c;
          if (h > 0.0) {
            c = mix(horizon, low, smoothstep(0.0, 0.07, h));
            c = mix(c, mid, smoothstep(0.07, 0.3, h));
            c = mix(c, top, smoothstep(0.3, 0.75, h));
          } else {
            c = mix(horizon, bottom, smoothstep(0.0, 0.08, -h));
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
  }

  // Retro-Sonne mit Streifen im unteren Teil
  function sunMaterial(gain = 1.05) {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: { time: { value: 0 }, gain: { value: gain } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `
        uniform float time;
        uniform float gain;
        varying vec2 vUv;
        void main(){
          vec2 p = vUv * 2.0 - 1.0;
          if (length(p) > 1.0) discard;
          float y = vUv.y;
          vec3 pink = vec3(1.0, 0.18, 0.58);
          vec3 orange = vec3(1.0, 0.48, 0.24);
          vec3 yellow = vec3(1.0, 0.89, 0.43);
          vec3 c = mix(pink, orange, smoothstep(0.05, 0.55, y));
          c = mix(c, yellow, smoothstep(0.55, 0.95, y));
          if (y < 0.56) {
            float band = fract(y * 13.0 - time * 0.04);
            float gap = mix(0.5, 0.06, y / 0.56);
            if (band < gap) discard;
          }
          gl_FragColor = vec4(c * gain, 1.0);
        }`,
    });
  }

  // ---------- Initialisierung ----------
  function init(el) {
    container = el;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.prepend(renderer.domElement);

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2("#4a1660", 0.011);

    camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 800);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 5;
    controls.maxDistance = 40;
    controls.maxPolarAngle = 1.38;
    controls.screenSpacePanning = false;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    // Spiegelungen: Sonnenuntergang und Neonflächen, die alle Chromflächen reflektieren
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial()));
    const envSun = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), sunMaterial(0.55));
    envSun.position.set(0, 6, -45);
    envScene.add(envSun);
    const panels = [["#29e6ff", 30, 6, 10], ["#ff4fd8", -30, 8, 10], ["#ffffff", 0, 40, 0], ["#b388ff", 0, 6, 40]];
    for (const [c, x, y, z] of panels) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
      p.position.set(x, y, z);
      p.lookAt(0, 0, 0);
      envScene.add(p);
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;

    // Himmel und Sterne
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(330, 32, 16), skyMaterial()));
    const starPos = [];
    for (let i = 0; i < 600; i++) {
      const a = Math.random() * Math.PI * 2;
      const h = 0.3 + Math.random() * 0.7;
      const r = Math.sqrt(1 - h * h);
      starPos.push(Math.cos(a) * r * 300, h * 300, Math.sin(a) * r * 300);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: "#ffe6f6", size: 1.5, sizeAttenuation: false, fog: false })));

    // Licht: warme Abendsonne von der Meerseite, kühles Neonlicht von der Stadt
    scene.add(new THREE.HemisphereLight("#9a6bff", "#2a0b30", 0.6));
    const sun = new THREE.DirectionalLight("#ffb08a", 0.85);
    sun.position.set(-15, 11, -3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -15; sc.right = 15; sc.top = 12; sc.bottom = -12; sc.near = 1; sc.far = 60;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    scene.add(sun);
    const rim = new THREE.DirectionalLight("#38e8ff", 0.4);
    rim.position.set(8, 9, 14);
    scene.add(rim);

    buildWorld();

    // Hover-, Auswahl- und Reichweitenanzeige
    hoverMesh = new THREE.Mesh(roundedOutline(0.92, 0.16, 0.06), new THREE.MeshBasicMaterial({
      color: "#ffffff", transparent: true, opacity: 0.9, depthWrite: false,
    }));
    hoverMesh.visible = false;
    scene.add(hoverMesh);

    selectMesh = new THREE.Mesh(roundedOutline(1.0, 0.2, 0.07), new THREE.MeshBasicMaterial({
      color: "#ffd740", transparent: true, depthWrite: false,
    }));
    selectMesh.visible = false;
    scene.add(selectMesh);

    rangeGroup = new THREE.Group();
    rangeGroup.add(
      new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
        color: "#29e6ff", transparent: true, opacity: 0.08, depthWrite: false,
      })),
      new THREE.Mesh(new THREE.RingGeometry(0.975, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
        color: "#9ff6ff", transparent: true, opacity: 0.95, depthWrite: false,
      }))
    );
    rangeGroup.visible = false;
    scene.add(rangeGroup);

    // Partikel als kleine, leuchtende Würfel
    particleMesh = new THREE.InstancedMesh(G("box", () => new THREE.BoxGeometry(1, 1, 1)), new THREE.MeshBasicMaterial(), MAX_PARTICLES);
    particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    particleMesh.setColorAt(0, tmpColor.set("#ffffff"));
    particleMesh.frustumCulled = false;
    particleMesh.count = 0;
    scene.add(particleMesh);

    // Schwebender Glitzerstaub in der Luft
    const sp = [];
    const sc2 = [];
    const palette = ["#ffffff", "#ff8ad8", "#7af3ff", "#d6b8ff"];
    for (let i = 0; i < 260; i++) {
      sp.push((Math.random() - 0.5) * 26, Math.random() * 5, (Math.random() - 0.5) * 18);
      tmpColor.set(palette[i % palette.length]);
      sc2.push(tmpColor.r, tmpColor.g, tmpColor.b);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute("color", new THREE.Float32BufferAttribute(sc2, 3));
    sparkles = new THREE.Points(sg, new THREE.PointsMaterial({
      size: 0.09, map: glowTexture(), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    scene.add(sparkles);

    // Nachbearbeitung: Bloom-Leuchten
    const size = new THREE.Vector2(800, 450);
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    composer = new THREE.EffectComposer(renderer, rt);
    composer.addPass(new THREE.RenderPass(scene, camera));
    bloomPass = new THREE.UnrealBloomPass(size, 0.75, 0.55, 0.82);
    composer.addPass(bloomPass);

    setupInput();
    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h, false);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(container);
    resize();
    resetCamera();
  }

  let menuMode = false;
  function setMenuMode(on) {
    menuMode = on;
    controls.enabled = !on;
    if (!on) resetCamera();
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

  // ---------- Die Stadt rund um das Spielfeld (einmalig) ----------
  function windowTexture(seed) {
    const rng = mulberry32(seed);
    return canvasTexture(64, 128, (g, w, h) => {
      g.fillStyle = "#000000";
      g.fillRect(0, 0, w, h);
      const colors = ["#ffd27a", "#7af3ff", "#ff8ad8", "#ffffff", "#b388ff"];
      const base = colors[seed % colors.length];
      for (let y = 2; y < h; y += 4) {
        for (let x = 2; x < w; x += 8) {
          if (rng() < 0.42) {
            g.fillStyle = rng() < 0.8 ? base : colors[Math.floor(rng() * colors.length)];
            g.globalAlpha = 0.5 + rng() * 0.5;
            g.fillRect(x, y, 5, 2);
          }
        }
      }
      g.globalAlpha = 1;
    });
  }

  function holoTexture(lines, colorA, colorB) {
    return canvasTexture(256, 128, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, colorA);
      grad.addColorStop(1, colorB);
      g.fillStyle = "rgba(10,5,30,0.55)";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = grad;
      g.lineWidth = 6;
      g.strokeRect(4, 4, w - 8, h - 8);
      g.fillStyle = grad;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = "bold 44px system-ui, sans-serif";
      g.fillText(lines[0], w / 2, lines[1] ? h * 0.4 : h / 2);
      if (lines[1]) {
        g.font = "bold 22px system-ui, sans-serif";
        g.fillText(lines[1], w / 2, h * 0.75);
      }
      g.fillStyle = "rgba(255,255,255,0.08)";
      for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    });
  }

  // ---------- Die Welt rund um das Spielfeld (einmalig) ----------
  // Norden (−Z): Strand, Meer, Retro-Sonne und Berge. Westen, Osten, Süden: die Stadt.
  const GROUND_Y = -0.6;
  const SHORE_Z = -10.5;

  function buildWorld() {
    const rng = mulberry32(4242);
    const world = new THREE.Group();
    scene.add(world);

    // Sonne, Glühen und Berge am Horizont
    const sunMat = sunMaterial();
    const sunDisc = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), sunMat);
    sunDisc.position.set(0, 20, -270);
    world.add(sunDisc);
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: "#ff4f8a", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    sunGlow.scale.setScalar(260);
    sunGlow.position.set(0, 18, -275);
    world.add(sunGlow);
    animated.push({ static: true, fn: (t) => { sunMat.uniforms.time.value = t; } });

    const mountainFill = new THREE.MeshBasicMaterial({ color: "#1c0733", fog: false });
    const mountainWire = new THREE.MeshBasicMaterial({ color: "#ff3cac", wireframe: true, transparent: true, opacity: 0.55, fog: false });
    const ranges = [
      [-150, -230, 220, 70, 1.0], [150, -230, 220, 70, 1.0],
      [-75, -255, 120, 50, 0.65], [75, -255, 120, 50, 0.65],
      [-235, -60, 60, 260, 1.1], [235, -60, 60, 260, 1.1],
    ];
    for (const [x, z, w, d, hScale] of ranges) {
      const geo = new THREE.PlaneGeometry(w, d, 26, 10).rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i) / (w / 2);
        const pz = pos.getZ(i) / (d / 2);
        const edge = Math.max(0, 1 - Math.max(Math.abs(px), Math.abs(pz)) ** 2);
        const peaks = Math.abs(Math.sin(px * 7 + x) * Math.cos(pz * 5 + z)) * 0.7 + rng() * 0.3;
        pos.setY(i, GROUND_Y + edge * peaks * 55 * hScale);
      }
      geo.computeVertexNormals();
      const fill = new THREE.Mesh(geo, mountainFill);
      const wire = new THREE.Mesh(geo, mountainWire);
      fill.position.set(x, 0, z);
      wire.position.set(x, 0.05, z);
      world.add(fill, wire);
    }

    // Meer mit Wellen-Spiegelung
    const waveTex = canvasTexture(64, 256, (g, w, h) => {
      g.fillStyle = "rgb(128,128,255)";
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 6 + Math.floor(rng() * 6)) {
        g.fillStyle = "rgb(128,180,230)";
        g.fillRect(0, y, w, 2);
        g.fillStyle = "rgb(128,80,230)";
        g.fillRect(0, y + 2, w, 2);
      }
    });
    waveTex.wrapS = waveTex.wrapT = THREE.RepeatWrapping;
    waveTex.repeat.set(30, 40);
    const seaMat = new THREE.MeshStandardMaterial({
      color: "#2a0f55", metalness: 1, roughness: 0.18, normalMap: waveTex, normalScale: new THREE.Vector2(0.35, 0.35),
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(700, 300).rotateX(-Math.PI / 2), seaMat);
    sea.position.set(0, GROUND_Y - 0.08, SHORE_Z - 150);
    world.add(sea);
    animated.push({ static: true, fn: (t) => { waveTex.offset.y = t * 0.02; } });

    // Sonnen-Glitzerpfad auf dem Wasser
    const streak = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: canvasTexture(64, 256, (g, w, h) => {
          const grad = g.createLinearGradient(0, 0, w, 0);
          grad.addColorStop(0, "rgba(255,90,170,0)");
          grad.addColorStop(0.5, "rgba(255,150,200,0.55)");
          grad.addColorStop(1, "rgba(255,90,170,0)");
          g.fillStyle = grad;
          g.fillRect(0, 0, w, h);
          g.globalCompositeOperation = "destination-out";
          for (let y = 0; y < h; y += 5) {
            g.fillStyle = `rgba(0,0,0,${0.3 + rng() * 0.6})`;
            g.fillRect(0, y, w, 2);
          }
        }),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      })
    );
    streak.scale.set(16, 1, 240);
    streak.position.set(0, GROUND_Y - 0.06, SHORE_Z - 1.5 - 120);
    world.add(streak);
    const glints = [];
    for (let i = 0; i < 140; i++) {
      const d = Math.pow(rng(), 1.6);
      const z = SHORE_Z - 2 - d * 160;
      const spread = 1.5 + (SHORE_Z - z) * 0.035;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: starTexture(), color: rng() < 0.7 ? "#ffd6ee" : "#ffffff", transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }));
      s.position.set((rng() - 0.5) * spread * 2, GROUND_Y - 0.02, z);
      glints.push({ s, base: 0.25 + rng() * 0.6 + (SHORE_Z - z) * 0.006, phase: rng() * 10, speed: 1 + rng() * 3 });
      world.add(s);
    }
    animated.push({
      static: true,
      fn: (t) => {
        for (const gl of glints) {
          const k = Math.max(0, Math.sin(t * gl.speed + gl.phase));
          gl.s.scale.setScalar(gl.base * (0.2 + k * k));
        }
      },
    });

    // Strand, Schaumkante und heranrollende Welle
    const beach = mesh(new THREE.PlaneGeometry(700, 5).rotateX(-Math.PI / 2), metal("#241037", 0.6, 0.3), { receive: true });
    beach.position.set(0, GROUND_Y - 0.01, SHORE_Z + 1.5);
    world.add(beach);
    const shorePts = [];
    for (let x = -120; x <= 120; x += 0.8) shorePts.push({ x, z: SHORE_Z + Math.sin(x * 0.35) * 0.25 + Math.sin(x * 0.11) * 0.4 });
    const foam = new THREE.Mesh(ribbon(shorePts, 0, 0.35, GROUND_Y + 0.005), new THREE.MeshBasicMaterial({
      color: "#bff7ff", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    world.add(foam);
    const crestCurve = new THREE.CatmullRomCurve3(shorePts.filter((_, i) => i % 4 === 0).map((p) => new THREE.Vector3(p.x, 0, Math.sin(p.x * 0.2) * 0.6)));
    const crestMat = new THREE.MeshBasicMaterial({ color: "#8ff0ff", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const crest = new THREE.Mesh(new THREE.TubeGeometry(crestCurve, 300, 0.07, 6), crestMat);
    world.add(crest);
    const foamDots = [];
    for (let i = 0; i < 70; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), color: "#ffffff", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      const x = (rng() - 0.5) * 70;
      s.position.set(x, GROUND_Y + 0.05, SHORE_Z + Math.sin(x * 0.35) * 0.25);
      foamDots.push({ s, phase: rng() * 10 });
      world.add(s);
    }
    animated.push({
      static: true,
      fn: (t) => {
        foam.position.z = Math.sin(t * 0.8) * 0.35;
        foam.material.opacity = 0.55 + Math.sin(t * 0.8) * 0.25;
        const k = (t * 0.12) % 1; // Welle rollt alle ~8 s heran
        crest.position.set(0, GROUND_Y - 0.03 + Math.sin(k * Math.PI) * 0.06, SHORE_Z - 7 + k * 6.6);
        crestMat.opacity = Math.sin(k * Math.PI) * 0.9;
        for (const f of foamDots) f.s.scale.setScalar(0.35 * Math.max(0, Math.sin(t * 2.2 + f.phase)));
      },
    });

    // Felsige Landzunge und Insel mit Palmen
    const rockMat = metal("#14081f", 0.8, 0.2);
    for (const [x, z, sx, sy, sz] of [[-34, -16, 9, 3.2, 7], [-46, -26, 12, 5, 10], [-28, -42, 7, 2.6, 6], [38, -30, 6, 2, 5]]) {
      const rock = mesh(new THREE.DodecahedronGeometry(1, 1), rockMat);
      rock.scale.set(sx, sy, sz);
      rock.position.set(x, GROUND_Y - sy * 0.35, z);
      world.add(rock);
    }
    const palmSpots = [
      [-30, -14, 3.6], [-35, -13, 2.8], [-38, -22, 4.2], [-27, -41, 3.0], [-29.5, -40, 2.4], [37, -29.5, 2.6],
      [-15, -8.6, 2.6], [-12.6, -9.2, 3.2], [-17.5, -9.6, 2.2], [13.2, -8.8, 3.0], [15.8, -9.5, 2.4], [11.6, -9.6, 2.0],
      [-11.8, 7.6, 2.2], [11.8, 7.6, 2.2],
    ];
    for (const [x, z, h] of palmSpots) {
      const palm = makePalm(rng, h);
      palm.position.set(x, x < -25 || x > 30 ? GROUND_Y + 0.6 : GROUND_Y, z);
      world.add(palm);
    }

    // Stadtboden mit Neon-Raster (nur an Land)
    const ground = mesh(new THREE.PlaneGeometry(400, 220).rotateX(-Math.PI / 2), metal("#120a24", 0.5, 0.6), { receive: true });
    ground.position.set(0, GROUND_Y - 0.02, SHORE_Z + 3 + 110);
    world.add(ground);
    const gridPts = [];
    for (let x = -120; x <= 120; x += 2) gridPts.push(x, 0, SHORE_Z + 3, x, 0, 120);
    for (let z = SHORE_Z + 3; z <= 120; z += 2) gridPts.push(-120, 0, z, 120, 0, z);
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridPts, 3));
    const gridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: "#7a2a9a", transparent: true, opacity: 0.6 }));
    gridLines.position.y = GROUND_Y - 0.005;
    world.add(gridLines);

    // Zufahrtsstraßen aus der Stadt zu den Portalen und vom Tor weg
    for (const [x0, x1, z] of [[-70, -COLS / 2 - 0.4, tileZ(2)], [-70, -COLS / 2 - 0.4, tileZ(10)], [COLS / 2 + 2.4, 70, tileZ(9)]]) {
      const pts = [{ x: x0, z }, { x: x1, z }];
      world.add(mesh(ribbon(pts, 0, 1.2, GROUND_Y + 0.01), metal("#191a2c", 0.3, 0.7), { receive: true }));
      for (const side of [-1, 1]) world.add(mesh(ribbon(pts, side * 0.58, 0.05, GROUND_Y + 0.015), neon("#ff3cac", 2)));
    }

    // Hochhäuser im Westen, Osten und (niedrig) im Süden
    const winTex = [0, 1, 2, 3, 4].map((i) => windowTexture(100 + i));
    const ledColors = ["#29e6ff", "#ff3cac", "#b388ff", "#ffd740", "#ff8a5c"];
    const roofLights = [];
    const buildings = [];
    const streetZ = [tileZ(2), tileZ(10)];
    let tries = 0;
    while (buildings.length < 85 && tries < 4000) {
      tries++;
      const x = (rng() - 0.5) * 90;
      const z = SHORE_Z + 2.5 + rng() * 38;
      const w = 1 + rng() * 1.8;
      const d = 1 + rng() * 1.8;
      if (Math.abs(x) < COLS / 2 + 1.2 + w / 2 && z < ROWS / 2 + 1.2 + d / 2) continue;
      if (x < 0 && streetZ.some((sz) => Math.abs(z - sz) < 0.9 + d / 2)) continue;
      if (x > 0 && Math.abs(z - tileZ(9)) < 0.9 + d / 2) continue;
      if (x > 10 && x < 14.5 && Math.abs(z - tileZ(9)) < 3) continue;
      if (Math.abs(x) < 20 && z < -7.5) continue;
      if (buildings.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + 0.3 && Math.abs(b.z - z) < (b.d + d) / 2 + 0.3)) continue;
      let h;
      if (z > ROWS / 2 + 1 && Math.abs(x) < 16) h = 0.6 + rng() * 1.2; // vorne niedrig, damit die Sicht frei bleibt
      else h = 2 + rng() * 8 * Math.min(1, Math.abs(x) / 25 + 0.3);
      buildings.push({ x, z, w, d, h });
    }
    for (const b of buildings) {
      const style = rng();
      const tex = winTex[Math.floor(rng() * winTex.length)].clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(Math.max(1, Math.round(b.w)), Math.max(1, Math.round(b.h / 2)));
      const bm = new THREE.MeshStandardMaterial({
        color: "#1d1433", metalness: 0.85, roughness: 0.28, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 1.1,
      });
      const g = new THREE.Group();
      g.position.set(b.x, GROUND_Y, b.z);
      let topY = b.h;
      if (style < 0.3) {
        const r = Math.min(b.w, b.d) / 2;
        const tower = mesh(new THREE.CylinderGeometry(r * 0.9, r, b.h, 16), bm);
        tower.position.y = b.h / 2;
        g.add(tower);
        for (let y = 0.6; y < b.h; y += 1.2 + rng()) {
          const ring = mesh(new THREE.TorusGeometry(r * 0.97, 0.025, 6, 24).rotateX(Math.PI / 2), neon(ledColors[Math.floor(rng() * 5)], 2.2));
          ring.position.y = y;
          g.add(ring);
        }
      } else if (style < 0.75) {
        // Retro-Block mit LED-Kanten
        const tower = mesh(new THREE.BoxGeometry(b.w, b.h, b.d), bm);
        tower.position.y = b.h / 2;
        g.add(tower);
        const led = ledColors[Math.floor(rng() * 5)];
        for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          if (rng() < 0.4) continue;
          const strip = mesh(G("ledStrip", () => new THREE.BoxGeometry(0.05, 1, 0.05)), neon(led, 2.4));
          strip.scale.y = b.h;
          strip.position.set(sx * b.w / 2, b.h / 2, sz * b.d / 2);
          g.add(strip);
        }
        const roofBand = mesh(new THREE.BoxGeometry(b.w + 0.04, 0.06, b.d + 0.04), neon(led, 2));
        roofBand.position.y = b.h;
        g.add(roofBand);
      } else {
        // Stufenturm
        let y = 0;
        let w = b.w;
        let d = b.d;
        const parts = 2 + Math.floor(rng() * 2);
        for (let i = 0; i < parts; i++) {
          const ph = (b.h / parts) * (1 - i * 0.1);
          const part = mesh(new THREE.BoxGeometry(w, ph, d), bm);
          part.position.y = y + ph / 2;
          g.add(part);
          const band = mesh(new THREE.BoxGeometry(w + 0.04, 0.06, d + 0.04), neon(ledColors[(i + Math.abs(Math.floor(b.x))) % 5], 2));
          band.position.y = y + ph;
          g.add(band);
          y += ph;
          w *= 0.72;
          d *= 0.72;
        }
        topY = y;
      }
      if (rng() < 0.5) {
        const ah = 0.4 + rng() * 1.2;
        const ant = mesh(G("antenna", () => new THREE.CylinderGeometry(0.015, 0.03, 1, 5)), metal("#b0b8d0", 0.3, 1));
        ant.scale.y = ah;
        ant.position.y = topY + ah / 2;
        g.add(ant);
        const light = mesh(G("antLight", () => new THREE.SphereGeometry(0.06, 8, 6)), neon("#ff2a4a", 3));
        light.position.y = topY + ah;
        g.add(light);
        roofLights.push({ light, phase: rng() * 6 });
      }
      world.add(g);
    }
    animated.push({
      static: true,
      fn: (t) => {
        for (const r of roofLights) r.light.visible = Math.sin(t * 2.5 + r.phase) > 0.2;
      },
    });

    // Holo-Werbetafeln über der Stadt
    const ads = [
      [["NEO-CITY", "✦ SUNSET DISTRICT ✦"], "#ff3cac", "#ffd740", -15, 4.5, -3],
      [["SYNTH-NUDELN", "24/7 · GALAXIS-GEWÜRZ"], "#ffd740", "#ff3cac", 15.5, 4, -2],
      [["DEFEND", "DAS STADTTOR"], "#29e6ff", "#b388ff", 16, 5, 7],
      [["HYPERLOOP", "→ ORBIT 3"], "#ff8a5c", "#29e6ff", -16, 5, 7],
    ];
    for (const [lines, a, b, x, y, z] of ads) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), new THREE.MeshBasicMaterial({
        map: holoTexture(lines, a, b), transparent: true, side: THREE.DoubleSide, depthWrite: false,
      }));
      board.position.set(x, y, z);
      board.lookAt(0, y * 0.5, z + 6);
      const pole = mesh(G("adPole", () => new THREE.CylinderGeometry(0.05, 0.05, 1, 6)), metal("#9098b8", 0.3, 1));
      pole.scale.y = y - GROUND_Y - 0.8;
      pole.position.set(x, (y + GROUND_Y - 0.8) / 2, z);
      world.add(board, pole);
      const phase = rng() * 10;
      animated.push({
        static: true,
        fn: (t) => {
          const flicker = Math.sin(t * 13 + phase) > 0.97 ? 0.35 : 1;
          board.material.opacity = (0.82 + Math.sin(t * 2 + phase) * 0.08) * flicker;
          board.position.y = y + Math.sin(t * 0.8 + phase) * 0.06;
        },
      });
    }

    // Fliegende Autos über der Stadt
    const carCount = 34;
    const carBody = new THREE.InstancedMesh(G("car", () => new THREE.CapsuleGeometry(0.09, 0.32, 4, 10).rotateZ(Math.PI / 2)), chrome("#ffffff", 0.15), carCount);
    const carLight = new THREE.InstancedMesh(G("carLight", () => new THREE.SphereGeometry(0.06, 8, 6)), new THREE.MeshBasicMaterial(), carCount * 2);
    const cars = [];
    const carColors = ["#ff3cac", "#29e6ff", "#ffd740", "#b388ff", "#ff8a5c"];
    for (let i = 0; i < carCount; i++) {
      // Bahnen entlang der Stadtstraßen (West/Ost) in verschiedenen Höhen
      const side = i % 2 ? 1 : -1;
      cars.push({
        x: side * (13 + rng() * 25), z0: SHORE_Z + 3, z1: 35, y: 2.5 + rng() * 5,
        speed: (0.03 + rng() * 0.05) * (rng() < 0.5 ? 1 : -1), phase: rng(), color: carColors[i % carColors.length],
      });
      carBody.setColorAt(i, tmpColor.set(i % 3 === 0 ? "#ffd6f5" : i % 3 === 1 ? "#d6f7ff" : "#ffffff"));
      carLight.setColorAt(i * 2, tmpColor.set(cars[i].color).multiplyScalar(2.5));
      carLight.setColorAt(i * 2 + 1, tmpColor.set("#ffffff").multiplyScalar(2));
    }
    carBody.frustumCulled = carLight.frustumCulled = false;
    world.add(carBody, carLight);
    tmpQuat.setFromAxisAngle(tmpPos.set(0, 1, 0), Math.PI / 2);
    const carQuat = tmpQuat.clone();
    animated.push({
      static: true,
      fn: (t) => {
        cars.forEach((c, i) => {
          const k = (((c.phase + t * c.speed) % 1) + 1) % 1;
          const z = c.z0 + (c.z1 - c.z0) * k;
          const dir = Math.sign(c.speed);
          tmpMatrix.compose(tmpPos.set(c.x, c.y, z), carQuat, tmpScale.set(1, 1, 1));
          carBody.setMatrixAt(i, tmpMatrix);
          tmpMatrix.makeTranslation(c.x, c.y, z - dir * 0.25);
          carLight.setMatrixAt(i * 2, tmpMatrix);
          tmpMatrix.makeTranslation(c.x, c.y, z + dir * 0.26);
          carLight.setMatrixAt(i * 2 + 1, tmpMatrix);
        });
        carBody.instanceMatrix.needsUpdate = true;
        carLight.instanceMatrix.needsUpdate = true;
      },
    });
  }

  // Palme als Silhouette mit leicht leuchtenden Blättern
  function makePalm(rng, h) {
    const g = new THREE.Group();
    const lean = (rng() - 0.5) * 1.4;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(lean * 0.25, h * 0.35, 0),
      new THREE.Vector3(lean * 0.65, h * 0.7, 0),
      new THREE.Vector3(lean, h, 0),
    ]);
    const trunk = mesh(new THREE.TubeGeometry(curve, 10, 0.08 * (h / 3), 6), metal("#1a0a26", 0.7, 0.2), { cast: true });
    g.add(trunk);
    const leafGeo = G("palmLeaf", () => {
      const geo = new THREE.PlaneGeometry(1, 1, 10, 2);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) + 0.5;
        const v = p.getY(i);
        p.setXYZ(i, u * 1.6, 0.25 * u - 0.75 * u * u, v * 0.42 * (Math.sin(u * Math.PI) * 0.85 + 0.15));
      }
      geo.computeVertexNormals();
      return geo;
    });
    const leafMat = cached("palmLeafMat", () => new THREE.MeshStandardMaterial({
      color: "#0b2230", emissive: "#19b7c9", emissiveIntensity: 0.35, side: THREE.DoubleSide, roughness: 0.6,
    }));
    const top = new THREE.Group();
    top.position.set(lean, h, 0);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const leaf = mesh(leafGeo, leafMat, { cast: true });
      leaf.rotation.y = (i / n) * Math.PI * 2 + rng() * 0.3;
      leaf.rotation.z = 0.15 + rng() * 0.25;
      leaf.scale.setScalar((h / 3) * (0.85 + rng() * 0.3));
      top.add(leaf);
    }
    g.add(top);
    const sway = rng() * 10;
    animated.push({ static: true, fn: (t) => { top.rotation.z = Math.sin(t * 0.7 + sway) * 0.04; } });
    g.rotation.y = rng() * Math.PI * 2;
    return g;
  }

  // ---------- Spielfeld ----------
  function buildMap() {
    if (mapGroup) {
      scene.remove(mapGroup);
      disposeObject(mapGroup);
    }
    animated = animated.filter((a) => a.static);
    mapGroup = new THREE.Group();
    obstacleMeshes = new Map();
    scene.add(mapGroup);
    const rng = mulberry32(MAP_SEED + 7);

    // Chrom-Plattform mit Neon-Rand, steht auf dem Stadtboden
    const slabW = COLS + 0.8;
    const slabD = ROWS + 0.8;
    const slab = mesh(new THREE.RoundedBoxGeometry(slabW, 0.6, slabD, 2, 0.08), chrome("#4a3f73", 0.45, 0.6), { receive: true });
    slab.position.y = SLAB_TOP - 0.3;
    mapGroup.add(slab);
    for (const [y, c, inset] of [[SLAB_TOP + 0.005, "#ff3cac", 0.03], [GROUND_Y + 0.03, "#29e6ff", -0.02]]) {
      const shape = roundedRectPath(new THREE.Shape(), -slabW / 2 + inset, -slabD / 2 + inset, slabW - inset * 2, slabD - inset * 2, 0.1);
      const pts = shape.getSpacedPoints(240).map((p) => new THREE.Vector3(p.x, y, p.y));
      const tube = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 480, 0.035, 6, true), neon(c, 2.6));
      mapGroup.add(tube);
    }

    // Bauflächen als Retro-Platten mit Neon-Raster in den Fugen
    const padCells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = grid[r][c];
        if (t === "pad" || OBSTACLES[t]) padCells.push([c, r]);
      }
    }
    const padShape = roundedRectPath(new THREE.Shape(), -0.41, -0.41, 0.82, 0.82, 0.06);
    const padGeo = new THREE.ExtrudeGeometry(padShape, {
      depth: 0.065, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 3,
    }).rotateX(-Math.PI / 2);
    const pads = new THREE.InstancedMesh(
      padGeo,
      new THREE.MeshPhysicalMaterial({ color: "#ffffff", metalness: 0.35, roughness: 0.62, iridescence: 0.35, iridescenceIOR: 1.5 }),
      padCells.length
    );
    pads.receiveShadow = true;
    const padA = new THREE.Color("#3a2a5e");
    const padB = new THREE.Color("#4e3878");
    padCells.forEach(([c, r], i) => {
      tmpMatrix.makeTranslation(tileX(c), PAD_TOP - 0.085, tileZ(r));
      pads.setMatrixAt(i, tmpMatrix);
      pads.setColorAt(i, tmpColor.copy(padA).lerp(padB, variant[r][c]));
    });
    mapGroup.add(pads);
    const gridPts = [];
    for (let c = 0; c <= COLS; c++) gridPts.push(c - COLS / 2, 0, -ROWS / 2, c - COLS / 2, 0, ROWS / 2);
    for (let r = 0; r <= ROWS; r++) gridPts.push(-COLS / 2, 0, r - ROWS / 2, COLS / 2, 0, r - ROWS / 2);
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridPts, 3));
    const boardGrid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: tmpColor.set("#ff3cac").multiplyScalar(1.1) }));
    boardGrid.position.y = SLAB_TOP + 0.004;
    mapGroup.add(boardGrid);

    // Straße mit Neon-Kanten und Lichtstreifen, die zum Tor fließen
    pathPoints.forEach((pts, pi) => {
      const p3 = pts.map((p) => ({ x: wx(p.x), z: wz(p.y) }));
      const yOff = pi * 0.002;
      mapGroup.add(mesh(ribbon(p3, 0, 0.94, ROAD_Y + yOff), metal("#191a2c", 0.3, 0.7), { receive: true }));
      for (const side of [-1, 1]) {
        mapGroup.add(mesh(ribbon(p3, side * 0.45, 0.05, ROAD_Y + 0.004 + yOff), neon("#29e6ff", 2.2)));
      }
    });
    const paths3 = pathPoints.map((pts) => polyline(pts.map((p) => ({ x: wx(p.x), z: wz(p.y) }))));
    const spacing = 0.7;
    const dashTotal = paths3.reduce((n, p) => n + Math.floor(p.length / spacing), 0);
    roadDashes = new THREE.InstancedMesh(G("dash", () => new THREE.CapsuleGeometry(0.025, 0.16, 3, 6).rotateZ(Math.PI / 2)), neon("#ffd740", 2.4), dashTotal);
    roadDashes.userData.paths = paths3;
    roadDashes.userData.spacing = spacing;
    roadDashes.frustumCulled = false;
    mapGroup.add(roadDashes);

    // Energiebecken mit leuchtendem Plasma
    for (const pool of POOLS) {
      for (const [c, r] of pool) {
        const rimMesh = mesh(G("poolRim", () => new THREE.CylinderGeometry(0.64, 0.64, 0.1, 32)), chrome("#8a90c0", 0.2));
        rimMesh.position.set(tileX(c), PAD_TOP - 0.07, tileZ(r));
        mapGroup.add(rimMesh);
      }
      const plasmaMat = new THREE.MeshStandardMaterial({
        color: "#04202a", emissive: "#ffffff", emissiveMap: plasmaTexture(), emissiveIntensity: 0.9, roughness: 0.05, metalness: 0.4,
      });
      for (const [c, r] of pool) {
        const disc = new THREE.Mesh(G("poolDisc", () => new THREE.CylinderGeometry(0.56, 0.56, 0.04, 32)), plasmaMat);
        disc.position.set(tileX(c), PAD_TOP - 0.01, tileZ(r));
        mapGroup.add(disc);
        // aufsteigende Energieblasen
        for (let i = 0; i < 2; i++) {
          const bubble = glowSprite("#7affea", 0.18);
          const ox = (rng() - 0.5) * 0.7;
          const oz = (rng() - 0.5) * 0.7;
          const ph = rng();
          mapGroup.add(bubble);
          animated.push({
            fn: (t) => {
              const k = (t * 0.35 + ph) % 1;
              bubble.position.set(tileX(c) + ox, PAD_TOP + k * 0.8, tileZ(r) + oz);
              bubble.material.opacity = 1 - k;
            },
          });
        }
      }
      animated.push({
        fn: (t) => {
          plasmaMat.emissiveIntensity = 0.85 + Math.sin(t * 2.2) * 0.2;
          plasmaMat.emissiveMap.offset.set(t * 0.03, t * 0.05);
          plasmaMat.emissiveMap.rotation = t * 0.05;
        },
      });
    }

    // Holo-Kioske und Frachtcontainer
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = grid[r][c];
        if (!OBSTACLES[t]) continue;
        const obj = t === "kiosk" ? makeKiosk(variant[r][c]) : makeCrates(variant[r][c]);
        obj.position.set(tileX(c), PAD_TOP, tileZ(r));
        obstacleMeshes.set(`${c},${r}`, obj);
        mapGroup.add(obj);
      }
    }

    // Laternen am Plattformrand
    const lampPos = [];
    for (let x = -COLS / 2 + 0.5; x <= COLS / 2 - 0.5; x += 2) lampPos.push([x, -slabD / 2 + 0.2], [x, slabD / 2 - 0.2]);
    for (let z = -ROWS / 2 + 1.5; z <= ROWS / 2 - 1.5; z += 2) lampPos.push([-slabW / 2 + 0.2, z], [slabW / 2 - 0.2, z]);
    const poles = new THREE.InstancedMesh(G("lampPole", () => new THREE.CylinderGeometry(0.02, 0.03, 0.5, 6)), metal("#c0c8e8", 0.25, 1), lampPos.length);
    const heads = new THREE.InstancedMesh(G("lampHead", () => new THREE.SphereGeometry(0.055, 10, 8)), new THREE.MeshBasicMaterial(), lampPos.length);
    lampPos.forEach(([x, z], i) => {
      tmpMatrix.makeTranslation(x, SLAB_TOP + 0.25, z);
      poles.setMatrixAt(i, tmpMatrix);
      tmpMatrix.makeTranslation(x, SLAB_TOP + 0.52, z);
      heads.setMatrixAt(i, tmpMatrix);
      heads.setColorAt(i, tmpColor.set(i % 2 ? "#ffb8f0" : "#b8f8ff").multiplyScalar(1.8));
    });
    mapGroup.add(poles, heads);

    mapGroup.add(makeGate());
    for (const pts of pathPoints) mapGroup.add(makePortal(pts[0]));
  }

  // Band entlang eines Weges (für Straße und Neonkanten)
  function ribbon(pts, offset, width, y) {
    const pos = [];
    const idx = [];
    let lastN = { x: 0, z: 1 };
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const len = Math.hypot(tx, tz);
      let n = lastN;
      if (len > 1e-6) {
        tx /= len;
        tz /= len;
        n = { x: -tz, z: tx };
      }
      lastN = n;
      const p = pts[i];
      const o1 = offset - width / 2;
      const o2 = offset + width / 2;
      pos.push(p.x + n.x * o1, y, p.z + n.z * o1, p.x + n.x * o2, y, p.z + n.z * o2);
      if (i > 0) {
        const k = i * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    return g;
  }

  // Weglänge vorberechnen, um Punkte in beliebiger Entfernung zu finden
  function polyline(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    return { pts, cum, length: cum[cum.length - 1] };
  }

  function pointAt(pl, d) {
    const { pts, cum } = pl;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = (d - cum[i - 1]) / seg;
    const a = pts[i - 1];
    const b = pts[i];
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, angle: Math.atan2(b.z - a.z, b.x - a.x) };
  }

  let plasmaTex = null;
  function plasmaTexture() {
    if (!plasmaTex) {
      const rng = mulberry32(77);
      plasmaTex = canvasTexture(128, 128, (g, w, h) => {
        g.fillStyle = "#00594d";
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 40; i++) {
          const x = rng() * w;
          const y = rng() * h;
          const rad = 8 + rng() * 26;
          const grad = g.createRadialGradient(x, y, 0, x, y, rad);
          grad.addColorStop(0, rng() < 0.5 ? "rgba(0,255,214,0.8)" : "rgba(120,200,255,0.7)");
          grad.addColorStop(1, "rgba(0,255,214,0)");
          g.fillStyle = grad;
          g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        }
        g.strokeStyle = "rgba(220,255,250,0.55)";
        g.lineWidth = 1.5;
        for (let i = 0; i < 14; i++) {
          g.beginPath();
          let x = rng() * w;
          let y = rng() * h;
          g.moveTo(x, y);
          for (let k = 0; k < 6; k++) {
            x += (rng() - 0.5) * 40;
            y += (rng() - 0.5) * 40;
            g.lineTo(x, y);
          }
          g.stroke();
        }
      });
      plasmaTex.wrapS = plasmaTex.wrapT = THREE.RepeatWrapping;
      plasmaTex.center.set(0.5, 0.5);
    }
    return plasmaTex;
  }

  const KIOSK_SIGNS = [["NUDELN", "#ff4fd8", "#ffd740"], ["24/7", "#29e6ff", "#b388ff"], ["BAR", "#b388ff", "#ff4fd8"], ["SHOP", "#69f0ae", "#29e6ff"], ["CHIPS", "#ffd740", "#ff8a3d"]];
  const kioskTextures = new Map();
  function makeKiosk(v) {
    const g = new THREE.Group();
    const colors = ["#ff6ad5", "#4fd8ff", "#c38bff", "#ffd36a"];
    const body = mesh(G("kioskBody", () => new THREE.RoundedBoxGeometry(0.5, 0.42, 0.42, 3, 0.1)), chrome(colors[Math.floor(v * 4)], 0.18), { cast: true });
    body.position.y = 0.21;
    const roof = mesh(G("kioskRoof", () => new THREE.RoundedBoxGeometry(0.66, 0.07, 0.56, 3, 0.03)), chrome("#f0f2ff", 0.1), { cast: true });
    roof.position.y = 0.46;
    const counter = mesh(G("kioskCounter", () => new THREE.RoundedBoxGeometry(0.42, 0.04, 0.12, 2, 0.02)), neon("#ffffff", 1.6));
    counter.position.set(0, 0.24, 0.22);
    g.add(body, roof, counter);
    const sign = KIOSK_SIGNS[Math.floor(v * KIOSK_SIGNS.length)];
    if (!kioskTextures.has(sign[0])) kioskTextures.set(sign[0], holoTexture([sign[0]], sign[1], sign[2]));
    const holo = new THREE.Mesh(G("kioskHolo", () => new THREE.PlaneGeometry(0.6, 0.3)), new THREE.MeshBasicMaterial({
      map: kioskTextures.get(sign[0]), transparent: true, side: THREE.DoubleSide, depthWrite: false,
    }));
    holo.userData.ownMaterial = true;
    holo.position.y = 0.72;
    g.add(holo);
    const ph = v * 20;
    animated.push({ fn: (t) => { holo.position.y = 0.72 + Math.sin(t * 1.6 + ph) * 0.03; holo.rotation.y = Math.sin(t * 0.5 + ph) * 0.4; } });
    g.rotation.y = (Math.floor(v * 4) - 1.5) * 0.2;
    return g;
  }

  function makeCrates(v) {
    const g = new THREE.Group();
    const colors = ["#ff4fd8", "#29e6ff", "#ffb300", "#7c4dff"];
    const count = v > 0.5 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const crate = mesh(G("crate", () => new THREE.RoundedBoxGeometry(0.72, 0.28, 0.4, 3, 0.06)), chrome(colors[(Math.floor(v * 10) + i) % 4], 0.25, 0.4), { cast: true, receive: true });
      crate.position.set(i * 0.05, 0.14 + i * 0.29, (i ? -0.04 : 0));
      crate.rotation.y = i * 0.25;
      const stripe = mesh(G("crateStripe", () => new THREE.BoxGeometry(0.74, 0.03, 0.42)), neon(i ? "#ffffff" : "#ffd740", 1.4));
      stripe.position.copy(crate.position);
      stripe.rotation.y = crate.rotation.y;
      g.add(crate, stripe);
    }
    g.rotation.y = v * 3;
    return g;
  }

  function makeGate() {
    const g = new THREE.Group();
    const x = tileX(19);
    for (const r of [8, 10]) {
      const z = tileZ(r);
      const pylon = mesh(G("pylon", () => new THREE.CapsuleGeometry(0.3, 1.3, 8, 20)), chrome("#e8ecff", 0.08), { cast: true, receive: true });
      pylon.position.set(x, PAD_TOP + 0.95, z);
      g.add(pylon);
      for (let i = 0; i < 3; i++) {
        const ring = mesh(G("pylonRing", () => new THREE.TorusGeometry(0.33, 0.03, 8, 32).rotateX(Math.PI / 2)), neon(i % 2 ? "#29e6ff" : "#ff4fd8", 2.6));
        ring.position.set(x, PAD_TOP + 0.5 + i * 0.45, z);
        g.add(ring);
      }
      const orb = mesh(G("orb", () => new THREE.SphereGeometry(0.14, 16, 10)), neon("#ffffff", 3));
      orb.position.set(x, PAD_TOP + 1.95, z);
      const halo = glowSprite("#ff8ae6", 1.1);
      halo.position.copy(orb.position);
      g.add(orb, halo);
    }
    // Bogen und Energieschild über dem Weg
    const arch = mesh(new THREE.TorusGeometry(1, 0.08, 12, 48, Math.PI).rotateY(Math.PI / 2), chrome("#f4f6ff", 0.08), { cast: true });
    arch.position.set(x, PAD_TOP + 1.5, tileZ(9));
    g.add(arch);
    const archGlow = mesh(new THREE.TorusGeometry(1, 0.025, 8, 48, Math.PI).rotateY(Math.PI / 2), neon("#29e6ff", 3));
    archGlow.position.set(x - 0.09, PAD_TOP + 1.5, tileZ(9));
    g.add(archGlow);
    const shieldMat = new THREE.MeshBasicMaterial({ color: "#ff4fd8", transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const shield = new THREE.Mesh(new THREE.CircleGeometry(1, 40, 0, Math.PI).rotateY(Math.PI / 2), shieldMat);
    shield.userData.ownMaterial = true;
    shield.position.set(x + 0.1, PAD_TOP + 0.5, tileZ(9));
    shield.scale.set(1, 1.4, 0.95);
    g.add(shield);
    animated.push({ fn: (t) => { shieldMat.opacity = 0.14 + Math.sin(t * 3) * 0.06; } });
    // Landedeck für die Raumschiffe hinter dem Tor
    const deck = mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.3, 40), chrome("#5a6090", 0.25, 0.7), { receive: true });
    deck.position.set(COLS / 2 + 1.3, SLAB_TOP - 0.15, tileZ(9));
    const deckRing = mesh(new THREE.TorusGeometry(0.85, 0.035, 8, 48).rotateX(Math.PI / 2), neon("#ffd740", 2.4));
    deckRing.position.set(COLS / 2 + 1.3, SLAB_TOP + 0.01, tileZ(9));
    g.add(deck, deckRing);
    return g;
  }

  let portalTex = null;
  function makePortal(p) {
    if (!portalTex) {
      portalTex = canvasTexture(128, 128, (g) => {
        const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.3, "#ff4fd8");
        grad.addColorStop(0.7, "#5b1dbf");
        grad.addColorStop(1, "rgba(20,0,60,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
        g.strokeStyle = "rgba(255,255,255,0.6)";
        g.lineWidth = 3;
        for (let i = 0; i < 5; i++) {
          g.beginPath();
          for (let a = 0; a < 6; a += 0.1) {
            const r = 6 + a * 9;
            const ang = a + (i * Math.PI * 2) / 5;
            g.lineTo(64 + Math.cos(ang) * r, 64 + Math.sin(ang) * r);
          }
          g.stroke();
        }
      });
    }
    const g = new THREE.Group();
    const x = wx(p.x) + 0.15;
    const z = wz(p.y);
    const ring = mesh(G("portalRing", () => new THREE.TorusGeometry(0.62, 0.1, 14, 40).rotateY(Math.PI / 2)), chrome("#e8ecff", 0.08), { cast: true });
    ring.position.set(x, PAD_TOP + 0.62, z);
    const glow = mesh(G("portalGlow", () => new THREE.TorusGeometry(0.62, 0.03, 8, 40).rotateY(Math.PI / 2)), neon("#ff4fd8", 3));
    glow.position.set(x + 0.08, PAD_TOP + 0.62, z);
    const disc = new THREE.Mesh(G("portalDisc", () => new THREE.CircleGeometry(0.56, 40).rotateY(Math.PI / 2)), new THREE.MeshBasicMaterial({
      map: portalTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    disc.userData.ownMaterial = true;
    disc.position.set(x, PAD_TOP + 0.62, z);
    const base = mesh(G("portalBase", () => new THREE.RoundedBoxGeometry(0.5, 0.12, 1.3, 3, 0.05)), chrome("#7a80b0", 0.2));
    base.position.set(x, PAD_TOP - 0.02, z);
    g.add(ring, glow, disc, base);
    animated.push({ fn: (t) => { disc.rotation.x = -t * 1.5; } });
    return g;
  }

  function removeObstacle(c, r) {
    const key = `${c},${r}`;
    const obj = obstacleMeshes.get(key);
    if (!obj) return;
    mapGroup.remove(obj);
    disposeObject(obj);
    obstacleMeshes.delete(key);
    burstStars(tileX(c), PAD_TOP + 0.4, tileZ(r), 8, "#ffffff");
  }

  // ---------- Raumschiff-Modell (für Station und fliegende Schiffe) ----------
  function makeShipModel(accent = "#ff4fd8") {
    const g = new THREE.Group();
    const hull = mesh(G("shipHull", () => new THREE.CapsuleGeometry(0.075, 0.3, 6, 14).rotateZ(Math.PI / 2)), chrome("#f2f4ff", 0.08), { cast: true });
    const cockpit = mesh(G("shipCockpit", () => new THREE.SphereGeometry(0.06, 12, 8)), neon("#29e6ff", 2.2));
    cockpit.position.set(0.12, 0.05, 0);
    cockpit.scale.set(1.4, 0.7, 0.9);
    const wings = mesh(G("shipWings", () => new THREE.RoundedBoxGeometry(0.18, 0.02, 0.5, 2, 0.01)), chrome("#d8dcff", 0.12));
    wings.position.x = -0.04;
    g.add(hull, cockpit, wings);
    for (const s of [-1, 1]) {
      const tip = mesh(G("shipTip", () => new THREE.SphereGeometry(0.025, 8, 6)), neon(accent, 3));
      tip.position.set(-0.04, 0, s * 0.25);
      g.add(tip);
    }
    const engine = glowSprite("#ff9a3d", 0.3);
    engine.position.x = -0.24;
    g.add(engine);
    g.userData.engine = engine;
    return g;
  }

  // ---------- Türme ----------
  function makeTower(t) {
    const type = TOWER_TYPES[t.type];
    const g = new THREE.Group();
    const head = new THREE.Group();
    const gun = new THREE.Group();
    head.add(gun);
    const ud = { head, gun, pips: new THREE.Group(), pipKey: null, spin: [] };

    if (t.type === "station") {
      const base = mesh(G("stationBase", () => new THREE.CylinderGeometry(0.4, 0.44, 0.22, 36)), chrome("#e8ecff", 0.12), { cast: true, receive: true });
      base.position.y = PAD_TOP + 0.11;
      const dome = mesh(G("stationDome", () => new THREE.SphereGeometry(0.3, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2)), chrome("#ffe6fb", 0.06), { cast: true });
      dome.position.y = PAD_TOP + 0.22;
      const hangar = mesh(G("stationHangar", () => new THREE.RoundedBoxGeometry(0.2, 0.12, 0.04, 2, 0.02)), neon("#ffd740", 2));
      hangar.position.set(0, PAD_TOP + 0.3, 0.29);
      const ring = mesh(G("stationRing", () => new THREE.TorusGeometry(0.46, 0.03, 8, 48).rotateX(Math.PI / 2)), neon("#ff4fd8", 2.6));
      ring.position.y = PAD_TOP + 0.24;
      const ant = mesh(G("stationAnt", () => new THREE.CylinderGeometry(0.012, 0.02, 0.4, 6)), metal("#c0c8e8", 0.2, 1));
      ant.position.set(0.12, PAD_TOP + 0.65, -0.05);
      const beacon = mesh(G("beacon", () => new THREE.SphereGeometry(0.035, 10, 8)), neon("#ff2a4a", 3));
      beacon.position.set(0.12, PAD_TOP + 0.86, -0.05);
      const dish = mesh(G("dish", () => new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6)), chrome("#ffffff", 0.1));
      dish.position.set(-0.15, PAD_TOP + 0.5, -0.05);
      dish.rotation.set(0.6, 0, 0.5);
      g.add(base, dome, hangar, ring, ant, beacon, dish);
      const idle = makeShipModel();
      idle.scale.setScalar(0.8);
      g.add(idle);
      ud.station = { ring, beacon, idle, dish };
    } else {
      const base = mesh(G("towerBase", () => new THREE.CylinderGeometry(0.3, 0.38, 0.36, 32)), chrome("#e8ecff", 0.12), { cast: true, receive: true });
      base.position.y = PAD_TOP + 0.18;
      const ring = mesh(G("towerRing", () => new THREE.TorusGeometry(0.33, 0.025, 8, 40).rotateX(Math.PI / 2)), neon(type.color, 2.6));
      ring.position.y = PAD_TOP + 0.34;
      const foot = mesh(G("towerFoot", () => new THREE.TorusGeometry(0.39, 0.02, 8, 40).rotateX(Math.PI / 2)), neon(type.color, 1.8));
      foot.position.y = PAD_TOP + 0.02;
      g.add(base, ring, foot);
      head.position.y = PAD_TOP + 0.42;

      if (t.type === "laser") {
        const body = mesh(G("laserBody", () => new THREE.SphereGeometry(0.19, 24, 16)), chrome("#d8f7ff", 0.08), { cast: true });
        body.scale.set(1.35, 0.8, 1);
        body.position.y = 0.08;
        gun.add(body);
        for (const s of [-1, 1]) {
          const barrel = mesh(G("laserBarrel", () => new THREE.CapsuleGeometry(0.03, 0.34, 4, 10).rotateZ(Math.PI / 2)), metal("#3a3f5c", 0.25, 1));
          barrel.position.set(0.25, 0.08, s * 0.08);
          const tip = mesh(G("laserTip", () => new THREE.SphereGeometry(0.035, 10, 8)), neon("#29e6ff", 3));
          tip.position.set(0.45, 0.08, s * 0.08);
          gun.add(barrel, tip);
        }
        const core = mesh(G("laserCore", () => new THREE.SphereGeometry(0.06, 12, 8)), neon("#29e6ff", 2.5));
        core.position.y = 0.22;
        gun.add(core);
      } else if (t.type === "plasma") {
        const turret = mesh(G("plasmaTurret", () => new THREE.SphereGeometry(0.24, 24, 16)), chrome("#ffd9c2", 0.1), { cast: true });
        turret.position.y = 0.08;
        head.add(turret);
        gun.position.y = 0.12;
        const barrel = mesh(G("plasmaBarrel", () => new THREE.CapsuleGeometry(0.09, 0.36, 6, 16).rotateZ(Math.PI / 2)), metal("#2a2d44", 0.2, 1), { cast: true });
        barrel.position.x = 0.28;
        gun.add(barrel);
        for (let i = 0; i < 3; i++) {
          const coil = mesh(G("plasmaCoil", () => new THREE.TorusGeometry(0.105, 0.02, 8, 20).rotateY(Math.PI / 2)), neon("#ff8a3d", 2.8));
          coil.position.x = 0.18 + i * 0.1;
          gun.add(coil);
        }
        gun.rotation.z = 0.18;
      } else {
        const crystal = mesh(G("cryoCrystal", () => new THREE.OctahedronGeometry(0.19, 0)), new THREE.MeshPhysicalMaterial({
          color: "#e6dcff", metalness: 0.4, roughness: 0.05, iridescence: 1, iridescenceIOR: 1.8,
          emissive: "#7c4dff", emissiveIntensity: 0.9, clearcoat: 1, flatShading: true,
        }), { cast: true });
        crystal.userData.ownMaterial = true;
        crystal.scale.y = 1.7;
        crystal.position.y = 0.32;
        gun.add(crystal);
        ud.crystal = crystal;
        for (let i = 0; i < 2; i++) {
          const orbit = mesh(G("cryoOrbit", () => new THREE.TorusGeometry(0.28, 0.015, 6, 40)), neon(i ? "#29e6ff" : "#b388ff", 2.6));
          orbit.position.y = 0.32;
          orbit.rotation.x = Math.PI / 2 + (i ? 0.5 : -0.5);
          head.add(orbit);
          ud.spin.push(orbit);
        }
      }
    }
    g.add(head, ud.pips);
    g.position.set(tileX(t.col), 0, tileZ(t.row));
    g.userData = ud;
    burstStars(tileX(t.col), PAD_TOP + 0.5, tileZ(t.row), 10, type.color);
    return g;
  }

  function updateTower(t, g) {
    const ud = g.userData;
    const time = state.time;
    if (t.type === "station") {
      const st = ud.station;
      st.ring.rotation.y = time * 1.2;
      st.ring.scale.setScalar(1 + t.recoil * 0.15);
      st.beacon.visible = Math.sin(time * 4 + t.col) > 0;
      st.dish.rotation.y = time * 0.6;
      st.idle.position.set(0, PAD_TOP + 0.62 + Math.sin(time * 2 + t.row) * 0.05, 0);
      st.idle.rotation.y = time * 0.8;
      st.idle.visible = t.recoil < 0.3;
    } else {
      ud.head.rotation.y = t.type === "cryo" ? 0 : -t.angle;
      ud.gun.position.x = -t.recoil * 0.07;
      if (ud.crystal) {
        ud.crystal.rotation.y = time * 1.5;
        ud.crystal.position.y = 0.34 + Math.sin(time * 2 + t.col) * 0.05;
        ud.crystal.material.emissiveIntensity = 0.7 + t.recoil * 1.6;
      }
      ud.spin.forEach((o, i) => { o.rotation.z = time * (i ? -1.6 : 1.2); });
    }
    // Ausbaustufen als leuchtende Kugeln am Sockel
    const key = JSON.stringify(t.levels);
    if (ud.pipKey !== key) {
      if (ud.pipKey !== null) burstStars(g.position.x, PAD_TOP + 0.6, g.position.z, 12, "#ffffff");
      ud.pipKey = key;
      while (ud.pips.children.length) ud.pips.remove(ud.pips.children[0]);
      const paths = TOWER_TYPES[t.type].upgrades;
      paths.forEach((p, pi) => {
        const center = Math.PI / 2 + (pi - (paths.length - 1) / 2) * 1.2;
        for (let i = 0; i < t.levels[p]; i++) {
          const a = center + (i - 1) * 0.28;
          const pip = mesh(G("pip", () => new THREE.SphereGeometry(0.035, 10, 8)), neon(UPGRADE_PATHS[p].color, 3));
          const rad = t.type === "station" ? 0.45 : 0.4;
          pip.position.set(Math.cos(a) * rad, PAD_TOP + 0.08, Math.sin(a) * rad);
          ud.pips.add(pip);
        }
      });
    }
  }

  // ---------- Gegner ----------
  // Gegner verändern sich mit dem Schaden: Farbe, Funken, Rauch, abfallende Teile
  function makeEnemy(e) {
    const d = e.def;
    const r = (d.radius / TILE) * (e.type === "omega" ? 1.15 : 1.5);
    const root = new THREE.Group();
    const model = new THREE.Group();
    root.add(model);
    const bodyMat = new THREE.MeshStandardMaterial({ color: d.color, metalness: 0.85, roughness: 0.2 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#29e6ff", emissiveIntensity: 2.6 });
    const ud = { model, r, bodyMat, eyeMat, baseColor: new THREE.Color(d.color), breaks: [], parts: {}, phase: Math.random() * 10, lastK: 1 };
    const addBreak = (m, at) => ud.breaks.push({ mesh: m, at, broken: false });
    const visor = (x, y, z, s = 1) => {
      const v = mesh(G("visor", () => new THREE.SphereGeometry(1, 12, 8)), eyeMat);
      v.scale.set(r * 0.16 * s, r * 0.14 * s, r * 0.16 * s);
      v.position.set(x, y, z);
      model.add(v);
      return v;
    };

    switch (e.type) {
      case "nanobot": {
        const body = mesh(G("sph16", () => new THREE.SphereGeometry(1, 16, 12)), bodyMat, { cast: true });
        body.scale.setScalar(r);
        body.position.y = r * 1.1;
        visor(r * 0.85, r * 1.2, 0, 1.5);
        const ant = mesh(G("nanoAnt", () => new THREE.CylinderGeometry(0.008, 0.008, 1, 4)), metal("#c0c8e8", 0.2, 1));
        ant.scale.y = r * 1.2;
        ant.position.set(-r * 0.2, r * 2.4, 0);
        const tip = mesh(G("sph8", () => new THREE.SphereGeometry(1, 8, 6)), neon("#ff4fd8", 3));
        tip.scale.setScalar(r * 0.18);
        tip.position.set(-r * 0.2, r * 3, 0);
        model.add(body, ant, tip);
        addBreak(ant, 0.5);
        addBreak(tip, 0.5);
        ud.parts.hover = r * 0.1;
        break;
      }
      case "scout": {
        const body = mesh(G("scoutBody", () => new THREE.CapsuleGeometry(1, 2.2, 6, 14).rotateZ(Math.PI / 2)), bodyMat, { cast: true });
        body.scale.setScalar(r * 0.55);
        body.position.y = r * 1.3;
        model.add(body);
        for (const s of [-1, 1]) {
          const fin = mesh(G("fin", () => new THREE.RoundedBoxGeometry(1, 0.12, 0.5, 2, 0.05)), chrome("#fff6c0", 0.1));
          fin.scale.setScalar(r);
          fin.position.set(-r * 0.3, r * 1.3, s * r * 0.75);
          fin.rotation.y = s * 0.4;
          model.add(fin);
          addBreak(fin, s > 0 ? 0.6 : 0.35);
        }
        const thruster = glowSprite("#ff9a3d", r * 2.2);
        thruster.position.set(-r * 1.3, r * 1.3, 0);
        model.add(thruster);
        ud.parts.thruster = thruster;
        visor(r * 1.05, r * 1.42, 0, 1.3);
        ud.parts.hover = r * 0.3;
        break;
      }
      case "spark": {
        const core = mesh(G("ico1", () => new THREE.IcosahedronGeometry(1, 1)), neon("#bff9ff", 3));
        core.scale.setScalar(r);
        core.position.y = r * 2.2;
        const glow = glowSprite(d.color, r * 7);
        glow.position.y = r * 2.2;
        model.add(core, glow);
        ud.parts.spark = { core, glow };
        break;
      }
      case "liquid": {
        bodyMat.transparent = true;
        bodyMat.opacity = 0.72;
        bodyMat.roughness = 0.05;
        const body = mesh(G("sph24", () => new THREE.SphereGeometry(1, 24, 16)), bodyMat, { cast: true });
        body.scale.setScalar(r);
        body.position.y = r;
        model.add(body);
        ud.parts.blob = body;
        for (let i = 0; i < 2; i++) {
          const kid = mesh(G("sph12", () => new THREE.SphereGeometry(1, 12, 8)), chrome("#d8ffe8", 0.1));
          kid.scale.setScalar(r * 0.3);
          kid.position.set(0, r * 0.8, (i - 0.5) * r * 0.75);
          model.add(kid);
        }
        visor(r * 0.8, r * 1.35, r * 0.3, 1);
        visor(r * 0.8, r * 1.35, -r * 0.3, 1);
        break;
      }
      case "crawler": {
        const shell = mesh(G("hemi", () => new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)), bodyMat, { cast: true });
        shell.scale.set(r * 1.15, r * 0.8, r * 0.95);
        shell.position.y = r * 0.3;
        model.add(shell);
        for (let i = 0; i < 3; i++) {
          const plate = mesh(G("plate", () => new THREE.RoundedBoxGeometry(1, 0.25, 1, 2, 0.1)), chrome("#d6dcf0", 0.15));
          plate.scale.set(r * 0.55, r * 0.6, r * 1.3);
          plate.position.set((i - 1) * r * 0.55, r * 1.05 - Math.abs(i - 1) * r * 0.12, 0);
          model.add(plate);
          addBreak(plate, [0.75, 0.5, 0.25][i]);
        }
        const head = mesh(G("sph12", () => new THREE.SphereGeometry(1, 12, 8)), metal("#2a2d44", 0.3, 1));
        head.scale.setScalar(r * 0.45);
        head.position.set(r * 1.1, r * 0.5, 0);
        model.add(head);
        visor(r * 1.45, r * 0.6, 0, 1.4);
        ud.parts.legs = [];
        for (const i of [-1, 1]) {
          for (const side of [-1, 1]) {
            const leg = mesh(G("leg", () => new THREE.BoxGeometry(0.08, 0.08, 1)), metal("#c0c8e8", 0.3, 1));
            leg.scale.set(r, r, r * 0.8);
            leg.position.set(i * r * 0.5, r * 0.25, side * r * 0.95);
            leg.userData = { i, side };
            model.add(leg);
            ud.parts.legs.push(leg);
          }
        }
        break;
      }
      case "cloak": {
        const holoMat = new THREE.MeshStandardMaterial({ color: "#1a2a6a", emissive: d.color, emissiveIntensity: 1.3, transparent: true, opacity: 0.55, metalness: 0.5, roughness: 0.2 });
        ud.holoMat = holoMat;
        const body = mesh(G("sph16", () => new THREE.SphereGeometry(1, 16, 12)), bodyMat, { cast: true });
        body.scale.set(r * 0.7, r * 0.55, r * 0.7);
        body.position.y = r * 1.5;
        const ring = mesh(G("cloakRing", () => new THREE.TorusGeometry(1, 0.12, 8, 32).rotateX(Math.PI / 2)), holoMat);
        ring.scale.setScalar(r);
        ring.position.y = r * 1.5;
        const cone = mesh(G("cloakCone", () => new THREE.ConeGeometry(1, 1.6, 20, 1, true)), holoMat);
        cone.scale.setScalar(r * 0.8);
        cone.rotation.x = Math.PI;
        cone.position.y = r * 0.65;
        model.add(body, ring, cone);
        for (const s of [-1, 1]) {
          const fin = mesh(G("fin", () => new THREE.RoundedBoxGeometry(1, 0.12, 0.5, 2, 0.05)), holoMat);
          fin.scale.setScalar(r * 0.8);
          fin.position.set(0, r * 1.5, s * r * 1.15);
          model.add(fin);
          addBreak(fin, s > 0 ? 0.66 : 0.33);
        }
        visor(r * 0.6, r * 1.55, 0, 1.4);
        ud.parts.ring = ring;
        ud.parts.float = true;
        break;
      }
      case "repair": {
        const body = mesh(G("sph16", () => new THREE.SphereGeometry(1, 16, 12)), bodyMat, { cast: true });
        body.scale.setScalar(r);
        body.position.y = r * 1.3;
        const rotor = mesh(G("rotor", () => new THREE.TorusGeometry(1, 0.08, 6, 32).rotateX(Math.PI / 2)), neon("#69f0ae", 2.4));
        rotor.scale.setScalar(r * 1.25);
        rotor.position.y = r * 2.15;
        const crossA = mesh(G("crossA", () => new THREE.BoxGeometry(0.25, 0.8, 0.25)), neon("#e9fff2", 2.2));
        const crossB = mesh(G("crossB", () => new THREE.BoxGeometry(0.25, 0.25, 0.8)), neon("#e9fff2", 2.2));
        for (const c of [crossA, crossB]) {
          c.scale.setScalar(r);
          c.position.y = r * 2.75;
        }
        const aura = mesh(G("aura", () => new THREE.TorusGeometry(1, 0.05, 6, 40).rotateX(Math.PI / 2)), new THREE.MeshBasicMaterial({
          color: "#69f0ae", transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        aura.userData.ownMaterial = true;
        aura.scale.setScalar(r * 1.6);
        aura.position.y = 0.04;
        model.add(body, rotor, crossA, crossB, aura);
        for (const s of [-1, 1]) {
          const arm = mesh(G("arm", () => new THREE.CapsuleGeometry(0.12, 0.6, 4, 8)), chrome("#ffe0f4", 0.1));
          arm.scale.setScalar(r);
          arm.position.set(r * 0.2, r * 0.9, s * r * 1.05);
          arm.rotation.x = s * 0.5;
          model.add(arm);
          addBreak(arm, s > 0 ? 0.6 : 0.3);
        }
        visor(r * 0.85, r * 1.45, 0, 1.4);
        Object.assign(ud.parts, { rotor, aura, cross: [crossA, crossB], hover: r * 0.15 });
        break;
      }
      case "titan": {
        const torso = mesh(G("torso", () => new THREE.RoundedBoxGeometry(1.3, 1.25, 1.1, 3, 0.25)), bodyMat, { cast: true });
        torso.scale.setScalar(r);
        torso.position.y = r * 1.45;
        const head = mesh(G("titanHead", () => new THREE.RoundedBoxGeometry(0.6, 0.45, 0.6, 3, 0.15)), bodyMat, { cast: true });
        head.scale.setScalar(r);
        head.position.set(r * 0.15, r * 2.3, 0);
        const core = mesh(G("sph12", () => new THREE.SphereGeometry(1, 12, 8)), neon("#ff8a3d", 3));
        core.scale.setScalar(r * 0.22);
        core.position.set(r * 0.66, r * 1.5, 0);
        model.add(torso, head, core);
        visor(r * 0.47, r * 2.33, 0, 1.6);
        ud.parts.arms = [];
        ud.parts.legs = [];
        for (const s of [-1, 1]) {
          const arm = mesh(G("arm", () => new THREE.CapsuleGeometry(0.12, 0.6, 4, 8)), chrome("#e8ecff", 0.12), { cast: true });
          arm.scale.setScalar(r * 1.4);
          arm.position.set(0, r * 1.3, s * r * 0.95);
          arm.userData.side = s;
          model.add(arm);
          ud.parts.arms.push(arm);
          const shoulder = mesh(G("plate", () => new THREE.RoundedBoxGeometry(1, 0.25, 1, 2, 0.1)), chrome("#c8d0ff", 0.12));
          shoulder.scale.set(r * 0.55, r * 0.8, r * 0.5);
          shoulder.position.set(0, r * 2.0, s * r * 0.9);
          model.add(shoulder);
          addBreak(shoulder, s > 0 ? 0.66 : 0.33);
          const leg = mesh(G("titanLeg", () => new THREE.RoundedBoxGeometry(0.35, 0.8, 0.35, 2, 0.1)), metal("#3a3f5c", 0.3, 1));
          leg.scale.setScalar(r);
          leg.position.set(0, r * 0.4, s * r * 0.35);
          leg.userData.side = s;
          model.add(leg);
          ud.parts.legs.push(leg);
        }
        ud.parts.mech = true;
        break;
      }
      case "omega": {
        const core = mesh(G("sph24", () => new THREE.SphereGeometry(1, 24, 16)), bodyMat, { cast: true });
        core.scale.setScalar(r);
        core.position.y = r * 1.4;
        model.add(core);
        const eye = mesh(G("sph16", () => new THREE.SphereGeometry(1, 16, 12)), eyeMat);
        eye.scale.set(r * 0.25, r * 0.4, r * 0.4);
        eye.position.set(r * 0.88, r * 1.45, 0);
        model.add(eye);
        ud.parts.rings = [];
        for (let i = 0; i < 2; i++) {
          const ring = mesh(G("omegaRing", () => new THREE.TorusGeometry(1, 0.06, 10, 64)), chrome(i ? "#ffd6f5" : "#d6f7ff", 0.06), { cast: true });
          ring.scale.setScalar(r * (1.45 + i * 0.25));
          ring.position.y = r * 1.4;
          ring.rotation.x = Math.PI / 2 + (i ? 0.45 : -0.3);
          model.add(ring);
          ud.parts.rings.push(ring);
        }
        // Energieknoten, die nach und nach erlöschen und abfallen
        for (let i = 0; i < 8; i++) {
          const node = mesh(G("sph12", () => new THREE.SphereGeometry(1, 12, 8)), neon(i % 2 ? "#ff4fd8" : "#29e6ff", 3));
          // Position und Größe in Ring-Koordinaten (der Ring ist skaliert)
          const a = (i / 8) * Math.PI * 2;
          node.scale.setScalar(0.12 / 1.45);
          node.position.set(Math.cos(a), Math.sin(a), 0);
          ud.parts.rings[0].add(node);
          addBreak(node, 0.95 - i * 0.11);
        }
        for (let i = 0; i < 6; i++) {
          const spike = mesh(G("spike", () => new THREE.ConeGeometry(0.12, 0.6, 10)), chrome("#ffffff", 0.08));
          spike.scale.setScalar(r);
          const a = (i / 6) * Math.PI * 2;
          spike.position.set(Math.cos(a) * r * 0.95, r * 1.4 + Math.sin(a) * r * 0.95, 0);
          spike.rotation.z = a - Math.PI / 2;
          model.add(spike);
          addBreak(spike, 0.8 - i * 0.13);
        }
        const glow = glowSprite("#ff4fd8", r * 5);
        glow.position.y = r * 1.4;
        model.add(glow);
        ud.parts.boss = { glow };
        break;
      }
    }
    root.userData = ud;
    return root;
  }

  function updateEnemy(e, root) {
    const ud = root.userData;
    const r = ud.r;
    const t = e.wobble;
    const time = state.time;
    root.position.set(wx(e.x), ROAD_Y, wz(e.y));
    ud.model.rotation.y = -e.dir;
    const k = Math.max(0, e.hp / e.maxHp);
    const p = ud.parts;

    // Bewegung
    let bob = 0;
    if (p.hover !== undefined) bob = p.hover + Math.sin(t * 1.4) * r * 0.08;
    if (p.blob) {
      const s = Math.sin(t) * 0.1;
      p.blob.scale.set(r * (1 + s * 0.5), r * (0.85 - s), r * (1 + s * 0.5));
      p.blob.position.y = r * (0.85 - s);
    }
    if (p.thruster) p.thruster.scale.setScalar(r * (2 + Math.random() * 0.6));
    if (p.spark) {
      p.spark.core.position.y = p.spark.glow.position.y = r * 2.2 + Math.sin(t * 1.3) * 0.06;
      p.spark.glow.material.opacity = 0.7 + Math.random() * 0.3;
    }
    if (p.legs && !p.mech) for (const l of p.legs) l.rotation.y = Math.sin(t * 2 + l.userData.i + l.userData.side) * 0.5;
    if (p.float) bob = 0.05 + Math.sin(t * 0.7) * 0.06;
    if (p.ring) p.ring.rotation.y = t * 0.8;
    if (p.rotor) {
      p.rotor.rotation.y = time * 8;
      const pulse = 1 - e.healTimer / e.def.heal.interval;
      p.aura.scale.setScalar(r * (1.1 + pulse * 0.9));
      p.aura.material.opacity = 0.15 + pulse * 0.7;
      for (const c of p.cross) c.rotation.y = t * 0.5;
    }
    if (p.mech) {
      for (const a of p.arms) a.rotation.z = Math.sin(t * 0.8 + a.userData.side * 1.6) * 0.5;
      for (const l of p.legs) l.rotation.z = Math.sin(t * 0.8 + l.userData.side * 1.6) * 0.35;
      bob = Math.abs(Math.sin(t * 0.8)) * r * 0.06;
    }
    if (p.rings) {
      p.rings[0].rotation.z = time * 0.6;
      p.rings[1].rotation.z = -time * 0.45;
      bob = Math.sin(time * 0.8) * 0.08 + 0.1;
      p.boss.glow.material.opacity = 0.35 + k * 0.4;
    }
    ud.model.position.set(0, bob, 0);

    // Schaden sichtbar machen
    ud.bodyMat.color.copy(ud.baseColor).lerp(CHARRED, (1 - k) * 0.6);
    ud.eyeMat.emissive.copy(EYE_OK).lerp(EYE_HURT, Math.min(1, (1 - k) * 1.4));
    ud.eyeMat.emissiveIntensity = k < 0.25 ? 1.5 + Math.random() * 2 : 2.6;
    const em = ud.bodyMat.emissive;
    if (e.flash > 0) {
      em.set("#ffffff");
      ud.bodyMat.emissiveIntensity = 1.2;
    } else if (e.slowFactor < 1) {
      em.set("#29e6ff");
      ud.bodyMat.emissiveIntensity = 0.7;
    } else if (k < 0.5) {
      em.set("#ff3d00");
      ud.bodyMat.emissiveIntensity = (0.5 - k) * 2.4 * (0.6 + 0.4 * Math.sin(time * 25 + ud.phase));
    } else {
      em.set("#000000");
    }
    if (ud.holoMat) {
      ud.holoMat.opacity = (0.35 + k * 0.3) * (Math.random() < (1 - k) * 0.25 ? 0.2 : 1);
    }
    for (const b of ud.breaks) {
      if (!b.broken && k < b.at) {
        b.broken = true;
        b.mesh.visible = false;
        b.mesh.getWorldPosition(tmpPos);
        for (let i = 0; i < 10; i++) addSpark(tmpPos.x, tmpPos.y, tmpPos.z, i % 2 ? "#ffd740" : "#ffffff", 2.5);
        addDebris(tmpPos.x, tmpPos.y, tmpPos.z, ud.baseColor);
      }
    }
    if (k < 0.5 && Math.random() < (0.5 - k) * 0.6) {
      root.getWorldPosition(tmpPos);
      addSpark(tmpPos.x, tmpPos.y + r * 1.2, tmpPos.z, Math.random() < 0.5 ? "#ffb300" : "#fff3c4", 1.6);
    }
    if (k < 0.3 && Math.random() < 0.2) {
      root.getWorldPosition(tmpPos);
      addSmoke(tmpPos.x, tmpPos.y + r * 1.8, tmpPos.z);
    }
    if (k < 0.3) ud.model.position.x += (Math.random() - 0.5) * 0.03;
  }

  // ---------- Raumschiffe ----------
  function makeShip(s) {
    const g = new THREE.Group();
    const model = makeShipModel();
    g.add(model);
    g.userData = { model, lastDir: s.dir };
    return g;
  }

  function updateShip(s, g) {
    const ud = g.userData;
    let turn = s.dir - ud.lastDir;
    if (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < -Math.PI) turn += Math.PI * 2;
    ud.lastDir = s.dir;
    g.position.set(wx(s.x), PAD_TOP + 0.42 + Math.sin(state.time * 3 + s.path) * 0.04, wz(s.y));
    g.rotation.y = -s.dir;
    ud.model.rotation.x = THREE.MathUtils.lerp(ud.model.rotation.x, THREE.MathUtils.clamp(-turn * 12, -0.6, 0.6), 0.2);
    ud.model.userData.engine.scale.setScalar(s.contact ? 0.2 : 0.28 + Math.random() * 0.08);
    const k = s.hp / s.maxHp;
    if (k < 0.6 && Math.random() < (0.6 - k)) addSpark(g.position.x, g.position.y, g.position.z, "#ffd740", 1.5);
    if (s.flash > 0 && Math.random() < 0.3) addSpark(g.position.x, g.position.y, g.position.z, "#ffffff", 2);
  }

  // ---------- Geschosse ----------
  function makeProjectile(p) {
    const g = new THREE.Group();
    if (p.kind === "laser") {
      g.add(mesh(G("laserBolt", () => new THREE.CapsuleGeometry(0.022, 0.32, 3, 6).rotateZ(Math.PI / 2)), neon("#7ff8ff", 4)));
    } else if (p.kind === "plasma") {
      g.add(mesh(G("plasmaBall", () => new THREE.SphereGeometry(0.09, 14, 10)), neon("#ff8a3d", 3.5)));
      g.add(glowSprite("#ff8a3d", 0.6));
    } else {
      const shard = mesh(G("cryoShard", () => new THREE.OctahedronGeometry(0.07, 0)), neon("#d6b8ff", 3.2));
      shard.scale.x = 1.8;
      g.add(shard);
    }
    return g;
  }

  function updateProjectile(p, g) {
    const travelled = Math.hypot(p.x - p.sx, p.y - p.sy);
    const remaining = Math.hypot(p.tx - p.x, p.ty - p.y);
    const f = travelled / Math.max(1, travelled + remaining);
    const startH = PAD_TOP + 0.55;
    const endH = ROAD_Y + (p.target.def.radius / TILE) * 1.5 + 0.1;
    let h = startH + (endH - startH) * f;
    if (p.kind === "plasma") h += Math.sin(f * Math.PI) * 0.7;
    g.position.set(wx(p.x), h, wz(p.y));
    g.rotation.y = -p.angle;
    if (p.kind === "cryo") g.rotation.x = state.time * 10;
  }

  // ---------- Ringe, Texte, Funkeln, Effektpartikel ----------
  function makeRing(ring) {
    const m = new THREE.Mesh(G("fxRing", () => new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({
      color: tmpColor.set(ring.color).multiplyScalar(2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    m.userData.ownMaterial = true;
    return m;
  }

  function updateRing(ring, m) {
    const k = ring.life / ring.max;
    m.position.set(wx(ring.x), ROAD_Y + 0.06, wz(ring.y));
    m.scale.setScalar((ring.r / TILE) * (1.1 - k * 0.5));
    m.material.opacity = k;
  }

  function textTexture(text) {
    if (textTextures.has(text)) return textTextures.get(text);
    const tex = canvasTexture(128, 64, (g) => {
      g.font = "bold 40px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 8;
      g.strokeStyle = "#2a0a4a";
      g.strokeText(text, 64, 32);
      const grad = g.createLinearGradient(0, 12, 0, 52);
      grad.addColorStop(0, "#fffbe0");
      grad.addColorStop(0.5, "#ffd740");
      grad.addColorStop(0.55, "#e09a00");
      grad.addColorStop(1, "#ffe9a0");
      g.fillStyle = grad;
      g.fillText(text, 64, 32);
    });
    textTextures.set(text, tex);
    return tex;
  }

  function makeText(t) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(t.text), transparent: true, depthTest: false }));
    s.userData.ownMaterial = true;
    s.scale.set(0.6, 0.3, 1);
    s.renderOrder = 10;
    burstStars(wx(t.x), 0.7, wz(t.y), 3, "#ffd740");
    return s;
  }

  function updateText(t, s) {
    const k = t.life / t.max;
    s.position.set(wx(t.x), 0.8 + (1 - k) * 0.6, wz(t.y));
    s.material.opacity = Math.min(1, k * 2);
  }

  function burstStars(x, y, z, n, color) {
    for (let i = 0; i < n; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: starTexture(), color: tmpColor.set(color).multiplyScalar(1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      const a = Math.random() * Math.PI * 2;
      const rad = 0.1 + Math.random() * 0.35;
      sprite.position.set(x + Math.cos(a) * rad, y + Math.random() * 0.3, z + Math.sin(a) * rad);
      scene.add(sprite);
      stars.push({ sprite, life: 0.5 + Math.random() * 0.5, max: 1, size: 0.12 + Math.random() * 0.18, spin: (Math.random() - 0.5) * 6 });
    }
  }

  function addSpark(x, y, z, color, speed) {
    if (vparts.length > 900) return;
    const a = Math.random() * Math.PI * 2;
    vparts.push({
      x, y, z,
      vx: Math.cos(a) * speed * Math.random(), vy: 1 + Math.random() * speed, vz: Math.sin(a) * speed * Math.random(),
      color, life: 0.25 + Math.random() * 0.3, max: 0.55, size: 0.035, gravity: 9,
    });
  }

  function addSmoke(x, y, z) {
    if (vparts.length > 900) return;
    vparts.push({
      x: x + (Math.random() - 0.5) * 0.1, y, z: z + (Math.random() - 0.5) * 0.1,
      vx: (Math.random() - 0.5) * 0.2, vy: 0.5 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.2,
      color: "#3a3448", life: 0.8, max: 0.8, size: 0.09, gravity: 0, grow: true,
    });
  }

  function addDebris(x, y, z, color) {
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      vparts.push({
        x, y, z,
        vx: Math.cos(a) * 1.2, vy: 1.5 + Math.random(), vz: Math.sin(a) * 1.2,
        color: "#" + color.getHexString(), life: 0.7, max: 0.7, size: 0.06, gravity: 9,
      });
    }
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
        disposeObject(obj);
        objs.delete(item);
      }
    }
  }

  // ---------- Pro Bild ----------
  let realTime = 0;
  function render(dt) {
    realTime += dt;
    if (menuMode) {
      // Postkarten-Ansicht für das Hauptmenü: Blick über das Spielfeld aufs Meer
      camera.position.set(Math.sin(realTime * 0.05) * 3, 2.4, 11.5);
      camera.lookAt(0, 5.5, -60);
    } else {
      controls.update();
    }
    // Kamera-Ziel auf der Karte halten
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -COLS / 2, COLS / 2);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -ROWS / 2, ROWS / 2);
    controls.target.y = 0;

    for (const a of animated) a.fn(realTime);
    updateDashes(realTime);

    // Glitzerstaub langsam aufsteigen lassen
    const sp = sparkles.geometry.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      let y = sp.getY(i) + dt * 0.15;
      if (y > 5) y = 0;
      sp.setY(i, y);
    }
    sp.needsUpdate = true;
    sparkles.material.opacity = 0.6 + Math.sin(realTime * 2) * 0.2;

    sync(state.towers, towerObjs, makeTower, updateTower);
    sync(state.enemies, enemyObjs, makeEnemy, updateEnemy);
    sync(state.ships, shipObjs, makeShip, updateShip);
    sync(state.projectiles, projectileObjs, makeProjectile, updateProjectile);
    sync(state.rings, ringObjs, makeRing, updateRing);
    sync(state.texts, textObjs, makeText, updateText);

    // Funkel-Sterne
    for (let i = stars.length - 1; i >= 0; i--) {
      const s = stars[i];
      s.life -= dt;
      if (s.life <= 0) {
        scene.remove(s.sprite);
        s.sprite.material.dispose();
        stars.splice(i, 1);
        continue;
      }
      const k = s.life / s.max;
      s.sprite.scale.setScalar(s.size * Math.sin(Math.min(1, k * 1.5) * Math.PI));
      s.sprite.material.rotation += s.spin * dt;
      s.sprite.position.y += dt * 0.3;
    }

    // Partikel aus der Spiellogik und Effektpartikel der Darstellung
    let n = 0;
    for (const pa of state.particles) {
      if (n >= MAX_PARTICLES) break;
      const s = 0.07 * Math.max(0.05, pa.life / pa.max);
      tmpMatrix.compose(
        tmpPos.set(wx(pa.x), ROAD_Y + pa.z / TILE, wz(pa.y)),
        tmpQuat.setFromAxisAngle(tmpAxis, pa.life * 6),
        tmpScale.setScalar(s)
      );
      particleMesh.setMatrixAt(n, tmpMatrix);
      particleMesh.setColorAt(n, tmpColor.set(pa.color).multiplyScalar(1.5));
      n++;
    }
    for (let i = vparts.length - 1; i >= 0; i--) {
      const v = vparts[i];
      v.life -= dt;
      if (v.life <= 0) {
        vparts.splice(i, 1);
        continue;
      }
      v.vy -= v.gravity * dt;
      v.x += v.vx * dt;
      v.y = Math.max(ROAD_Y, v.y + v.vy * dt);
      v.z += v.vz * dt;
      if (n >= MAX_PARTICLES) continue;
      const k = v.life / v.max;
      const s = v.grow ? v.size * (2 - k) : v.size * Math.max(0.1, k);
      tmpMatrix.compose(tmpPos.set(v.x, v.y, v.z), tmpQuat.setFromAxisAngle(tmpAxis, v.life * 8), tmpScale.setScalar(s));
      particleMesh.setMatrixAt(n, tmpMatrix);
      tmpColor.set(v.color);
      if (!v.grow) tmpColor.multiplyScalar(2);
      particleMesh.setColorAt(n, tmpColor);
      n++;
    }
    particleMesh.count = n;
    particleMesh.instanceMatrix.needsUpdate = true;
    if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;

    updateHelpers();
    composer.render(dt);
  }

  function updateDashes(t) {
    if (!roadDashes) return;
    const { paths, spacing } = roadDashes.userData;
    let i = 0;
    const offset = (t * 0.9) % spacing;
    for (const pl of paths) {
      const count = Math.floor(pl.length / spacing);
      for (let k = 0; k < count; k++) {
        const d = (k * spacing + offset) % pl.length;
        const p = pointAt(pl, d);
        tmpQuat.setFromAxisAngle(tmpPos.set(0, 1, 0), -p.angle);
        tmpMatrix.compose(tmpPos.set(p.x, ROAD_Y + 0.01, p.z), tmpQuat, tmpScale.set(1, 1, 1));
        roadDashes.setMatrixAt(i++, tmpMatrix);
      }
    }
    roadDashes.instanceMatrix.needsUpdate = true;
  }

  function updateHelpers() {
    hoverMesh.visible = false;
    rangeGroup.visible = false;
    selectMesh.visible = false;

    const showRange = (x, z, px) => {
      if (!px) return;
      rangeGroup.visible = true;
      rangeGroup.position.set(x, ROAD_Y + 0.03, z);
      rangeGroup.scale.setScalar(px / TILE);
    };

    const hov = state.hoverTile;
    if (hov && !state.gameOver && !towerAt(hov.col, hov.row)) {
      const cell = grid[hov.row][hov.col];
      if (cell !== "path") {
        const ok = canBuild(hov.col, hov.row);
        hoverMesh.visible = true;
        hoverMesh.material.color.set(ok ? "#ffffff" : OBSTACLES[cell] ? "#ffd740" : "#ff2a4a").multiplyScalar(1.5);
        hoverMesh.position.set(tileX(hov.col), PAD_TOP + 0.015, tileZ(hov.row));
        if (ok) showRange(tileX(hov.col), tileZ(hov.row), TOWER_TYPES[state.selectedType].range);
      }
    }

    const sel = state.selected;
    const pulse = 1.3 + Math.sin(realTime * 5) * 0.4;
    if (sel && sel.kind === "tower") {
      showRange(tileX(sel.tower.col), tileZ(sel.tower.row), towerStats(sel.tower).range);
      selectMesh.visible = true;
      selectMesh.position.set(tileX(sel.tower.col), PAD_TOP + 0.02, tileZ(sel.tower.row));
    } else if (sel && sel.kind === "obstacle") {
      selectMesh.visible = true;
      selectMesh.position.set(tileX(sel.col), PAD_TOP + 0.02, tileZ(sel.row));
    }
    selectMesh.material.color.set("#ffd740").multiplyScalar(pulse);
  }

  return { init, buildMap, removeObstacle, render, resetCamera, setMenuMode };
})();
