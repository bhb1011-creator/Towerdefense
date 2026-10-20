"use strict";

// 3D-Darstellung mit Three.js im Chromecore-Sci-Fi-Stil.
// Liest den Spielzustand aus game.js und erzeugt/aktualisiert dafür 3D-Objekte.
// Koordinaten: 1 Einheit = 1 Feld, X = Spalte, Z = Zeile, Y = Höhe.

const View = (() => {
  const SLAB_TOP = -0.05;
  const FLOOR_Y = SLAB_TOP + 0.002;
  const FLOOR_MARGIN = 0.3;
  const PAD_TOP = FLOOR_Y + 0.003;
  const ROAD_Y = FLOOR_Y + 0.016;
  const MAX_PARTICLES = 2500;

  let renderer, scene, camera, controls, container, composer, bloomPass;
  let mapGroup = null;
  let obstacleMeshes = new Map();
  let animated = []; // { obj, fn(obj, time) } für Animationen der Karte/Stadt
  let roadDashes = null;
  let hoverMesh, selectMesh, rangeGroup, previewRing, particleMesh, sparkles, holoFill, holoEdge;
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PAD_TOP);
  const pointer = new THREE.Vector2();

  const towerObjs = new Map();
  const enemyObjs = new Map();
  const shipObjs = new Map();
  const projectileObjs = new Map();
  const beamObjs = new Map();
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
  // Geländehöhe (sanfte Hügel): gw für Weltkoordinaten, gp für Spiel-Pixel
  const gw = (x, z) => terrainHeight(x + COLS / 2, z + ROWS / 2);
  const gp = (px, py) => terrainHeight(px / TILE, py / TILE);
  // Höhe der Alien-Straße (unter dem Tunnelberg eben): bw für Welt, bp für Spiel-Pixel
  const bw = (x, z) => baseHeight(x + COLS / 2, z + ROWS / 2);
  const bp = (px, py) => baseHeight(px / TILE, py / TILE);
  // Türme stehen auf dem höchsten Punkt ihres 2×2-Platzes (Fundament reicht nach unten)
  const towerGround = (px, py) => Math.max(...[[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8], [0, 0]].map(([ox, oz]) => gw(wx(px) + ox, wz(py) + oz)));

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

  // ---------- Tag-Nacht-Wechsel über die Wellen ----------
  // Stützpunkte (Welle → Stimmung); dazwischen wird weich überblendet
  const sky = {};
  const MOODS = [
    { wave: 0, top: "#1a2366", mid: "#6a3a9a", low: "#ff6a8a", horizon: "#ffb36a", fog: "#6a2a6a", fogD: 0.009, hemi: "#c0a0ff", hemiI: 0.8, sun: "#ffb08a", sunI: 0.85, sunY: 32, gain: 1.15, stars: 0.15, bloom: 0.65, city: 0.7 },
    { wave: 15, top: "#0b0626", mid: "#3b0f63", low: "#c2257f", horizon: "#ff8a5c", fog: "#4a1660", fogD: 0.011, hemi: "#9a6bff", hemiI: 0.6, sun: "#ff8a6a", sunI: 0.75, sunY: 20, gain: 1.05, stars: 0.6, bloom: 0.75, city: 1.0 },
    { wave: 30, top: "#03020f", mid: "#140b40", low: "#3c1a70", horizon: "#a02a7a", fog: "#1c0a3a", fogD: 0.012, hemi: "#6a5ac0", hemiI: 0.45, sun: "#8aa0ff", sunI: 0.5, sunY: -50, gain: 0.6, stars: 1.0, bloom: 0.95, city: 1.35 },
    { wave: 45, top: "#000006", mid: "#0a0628", low: "#2a0a4a", horizon: "#5a1a5a", fog: "#0e0626", fogD: 0.013, hemi: "#5a4ab0", hemiI: 0.4, sun: "#7a8aff", sunI: 0.42, sunY: -90, gain: 0.5, stars: 1.0, bloom: 1.05, city: 1.5 },
    { wave: 50, top: "#1a0010", mid: "#4a0020", low: "#b0103a", horizon: "#ff3a2a", fog: "#3a0818", fogD: 0.012, hemi: "#c05a7a", hemiI: 0.55, sun: "#ff4a3a", sunI: 0.75, sunY: 6, gain: 0.95, stars: 0.5, bloom: 1.0, city: 1.3 },
  ];
  let moodT = -1; // aktuell angezeigte Wellen-Stimmung (weich nachgeführt)
  const moodA = new THREE.Color();
  const moodB = new THREE.Color();

  function applyMood(w) {
    let i = 0;
    while (i < MOODS.length - 2 && w > MOODS[i + 1].wave) i++;
    const a = MOODS[i];
    const b = MOODS[i + 1];
    const k = THREE.MathUtils.clamp((w - a.wave) / (b.wave - a.wave), 0, 1);
    const col = (key, target) => target.copy(moodA.set(a[key])).lerp(moodB.set(b[key]), k);
    const num = (key) => a[key] + (b[key] - a[key]) * k;
    for (const key of ["top", "mid", "low", "horizon"]) col(key, sky.mat.uniforms[key].value);
    col("fog", scene.fog.color);
    scene.fog.density = num("fogD");
    col("hemi", sky.hemi.color);
    sky.hemi.intensity = num("hemiI");
    col("sun", sky.sun.color);
    sky.sun.intensity = num("sunI");
    sky.sunDisc.position.y = num("sunY");
    sky.sunGlow.position.y = num("sunY") - 2;
    sky.sunMat.uniforms.gain.value = num("gain");
    sky.stars.opacity = num("stars");
    if (bloomPass) bloomPass.strength = num("bloom");
    City.setLight(num("city"));
  }

  function updateMood(dt) {
    const target = state ? Math.min(FINAL_WAVE, state.wave) : 0;
    if (moodT < 0) moodT = target;
    // langsam zur neuen Stimmung gleiten (etwa 1 Welle pro 4 Sekunden)
    const step = dt * 0.25 * Math.max(1, Math.abs(target - moodT));
    if (Math.abs(target - moodT) <= step) moodT = target;
    else moodT += Math.sign(target - moodT) * step;
    applyMood(moodT);
  }

  // ---------- Initialisierung ----------
  function init(el) {
    container = el;
    Towers.init({
      G, mesh, chrome, metal, neon, glowSprite, makeShipModel, cachedMat: cached,
      glass: () => cached("glass", () => new THREE.MeshPhysicalMaterial({
        color: "#bfefff", transparent: true, opacity: 0.22, roughness: 0.02, metalness: 0, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide,
      })),
    });
    Buildings.init({
      G, mesh, chrome, metal, neon, holoTexture, windowTexture, makePalm,
      animate: (fn) => animated.push({ fn }),
      basicLine: (color) => cached(`line${color}`, () => new THREE.LineBasicMaterial({ color: tmpColor.set(color).clone().multiplyScalar(2.2) })),
      glass: () => cached("glass", () => new THREE.MeshPhysicalMaterial({
        color: "#bfefff", transparent: true, opacity: 0.22, roughness: 0.02, metalness: 0, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide,
      })),
      stripes: (color) => cached(`stripes${color}`, () => new THREE.MeshStandardMaterial({
        map: canvasTexture(64, 16, (g, w, h) => {
          for (let i = 0; i < 8; i++) {
            g.fillStyle = i % 2 ? "#ffffff" : color;
            g.fillRect((i * w) / 8, 0, w / 8, h);
          }
        }),
        roughness: 0.6, side: THREE.DoubleSide, emissive: color, emissiveIntensity: 0.25,
      })),
    });
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
    sky.mat = skyMaterial();
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(330, 32, 16), sky.mat));
    const starPos = [];
    for (let i = 0; i < 600; i++) {
      const a = Math.random() * Math.PI * 2;
      const h = 0.3 + Math.random() * 0.7;
      const r = Math.sqrt(1 - h * h);
      starPos.push(Math.cos(a) * r * 300, h * 300, Math.sin(a) * r * 300);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
    sky.stars = new THREE.PointsMaterial({ color: "#ffe6f6", size: 1.5, sizeAttenuation: false, fog: false, transparent: true });
    scene.add(new THREE.Points(starGeo, sky.stars));

    // Licht: warme Abendsonne von der Meerseite, kühles Neonlicht von der Stadt
    sky.hemi = new THREE.HemisphereLight("#9a6bff", "#2a0b30", 0.6);
    scene.add(sky.hemi);
    const sun = new THREE.DirectionalLight("#ff8a6a", 0.75);
    sky.sun = sun;
    sun.position.set(-5, 10, -16);
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

    previewRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      color: tmpColor.set("#ff8ae6").multiplyScalar(1.6), transparent: true, opacity: 0.9, depthWrite: false,
    }));
    previewRing.visible = false;
    scene.add(previewRing);

    // Partikel als kleine, runde Leuchtkugeln
    particleMesh = new THREE.InstancedMesh(G("particle", () => new THREE.SphereGeometry(1, 6, 4)), new THREE.MeshBasicMaterial(), MAX_PARTICLES);
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
    camera.position.set(0, 17 * k, 14.5 * k);
    controls.target.set(0, 0, 0.5);
    controls.update();
  }

  // ---------- Eingabe: Klick (ohne Ziehen) = Feld auswählen ----------
  function setupInput() {
    const el = renderer.domElement;
    let down = null;
    let rightDown = null;
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      // Rechtsklick ohne Ziehen bricht das Bauen ab (Ziehen verschiebt die Kamera)
      if (rightDown && Math.hypot(ev.clientX - rightDown.x, ev.clientY - rightDown.y) < 6) cancelBuild();
      rightDown = null;
    });
    el.addEventListener("pointerdown", (ev) => {
      down = { x: ev.clientX, y: ev.clientY, button: ev.button };
      if (ev.button === 2) rightDown = { x: ev.clientX, y: ev.clientY };
    });
    el.addEventListener("pointerup", (ev) => {
      if (!down) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      if (down.button === 0 && moved < 6) {
        const tile = pickTile(ev);
        if (tile) handleTileClick(tile.col, tile.row, ev.shiftKey, tile.px, tile.py);
      }
      down = null;
    });
    el.addEventListener("pointermove", (ev) => {
      if (ev.pointerType === "mouse") {
        state.hoverTile = pickTile(ev);
        state.hoverPoint = state.hoverTile ? { x: state.hoverTile.px, y: state.hoverTile.py } : null;
      }
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
    let hit = raycaster.ray.intersectPlane(groundPlane, tmpPos);
    if (!hit) return null;
    // auf Hügeln nachkorrigieren: Ebene auf die Geländehöhe am Treffpunkt anheben
    for (let i = 0; i < 2; i++) {
      const h = gw(hit.x, hit.z);
      if (h <= 0) break;
      groundPlane.constant = -(PAD_TOP + h);
      hit = raycaster.ray.intersectPlane(groundPlane, tmpPos) || hit;
      groundPlane.constant = -PAD_TOP;
    }
    const col = Math.floor(hit.x + COLS / 2);
    const row = Math.floor(hit.z + ROWS / 2);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
    return { col, row, px: (hit.x + COLS / 2) * TILE, py: (hit.z + ROWS / 2) * TILE };
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
  const SHORE_Z = -18;

  function buildWorld() {
    const rng = mulberry32(4242);
    const world = new THREE.Group();
    scene.add(world);

    // Sonne, Glühen und Berge am Horizont
    const sunMat = sunMaterial();
    sky.sunMat = sunMat;
    const sunDisc = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), sunMat);
    sky.sunDisc = sunDisc;
    sunDisc.position.set(0, 20, -270);
    world.add(sunDisc);
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: "#ff4f8a", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    sunGlow.scale.setScalar(260);
    sky.sunGlow = sunGlow;
    sunGlow.position.set(0, 18, -275);
    world.add(sunGlow);
    animated.push({ static: true, fn: (t) => { sunMat.uniforms.time.value = t; } });

    const mountainFill = new THREE.MeshBasicMaterial({ color: "#1c0733", fog: false });
    const mountainWire = new THREE.MeshBasicMaterial({ color: "#ff3cac", wireframe: true, transparent: true, opacity: 0.55, fog: false });
    const ranges = [
      [-150, -230, 220, 70, 1.0], [150, -230, 220, 70, 1.0],
      [-75, -255, 120, 50, 0.65], [75, -255, 120, 50, 0.65],
      [-235, -60, 60, 260, 1.1], [235, -60, 60, 260, 1.1],
      // auch im Süden hinter der Stadt (rundherum Berge)
      [-150, 215, 220, 60, 0.9], [150, 215, 220, 60, 0.9], [0, 240, 160, 50, 0.75], [-235, 120, 60, 160, 1.0], [235, 120, 60, 160, 1.0],
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
      color: "#3a1048", metalness: 0.9, roughness: 0.42, normalMap: waveTex, normalScale: new THREE.Vector2(0.35, 0.35),
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
          grad.addColorStop(0.5, "rgba(255,110,120,0.22)");
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
    for (const [x, z, sx, sy, sz] of [[-74, -24, 9, 3.2, 7], [-86, -32, 12, 5, 10], [-40, -50, 7, 2.6, 6], [48, -40, 6, 2, 5]]) {
      const rock = mesh(new THREE.DodecahedronGeometry(1, 1), rockMat);
      rock.scale.set(sx, sy, sz);
      rock.position.set(x, GROUND_Y - sy * 0.35, z);
      world.add(rock);
    }
    for (const [x, z, h] of [[-72, -22, 3.6], [-77, -21, 2.8], [-80, -30, 4.2], [-39, -49, 3.0], [-41.5, -48, 2.4], [47, -39.5, 2.6]]) {
      const palm = makePalm(rng, h);
      palm.position.set(x, GROUND_Y + 0.6, z);
      world.add(palm);
    }

    // Die Stadt im Retro-Miami-Stil (Straßen, Autos, Art-déco, Hochhäuser, Strand)
    world.add(City.build({
      G, mesh, chrome, metal, neon, windowTexture, canvasTexture, makePalm, GROUND_Y, SHORE_Z,
      animate: (fn) => animated.push({ static: true, fn }),
      signTexture: (text, color) => canvasTexture(256, 128, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.font = "bold 64px 'Brush Script MT', cursive, system-ui";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.shadowColor = color;
        g.shadowBlur = 18;
        g.fillStyle = color;
        g.fillText(text, w / 2, h / 2);
        g.shadowBlur = 0;
        g.fillStyle = "#ffffff";
        g.globalAlpha = 0.85;
        g.fillText(text, w / 2, h / 2);
      }),
      stripeMat: (color) => cached(`umbStripe${color}`, () => new THREE.MeshStandardMaterial({
        map: canvasTexture(64, 8, (g, w, h) => {
          for (let i = 0; i < 8; i++) {
            g.fillStyle = i % 2 ? "#ffffff" : color;
            g.fillRect((i * w) / 8, 0, w / 8, h);
          }
        }),
        roughness: 0.7, side: THREE.DoubleSide,
      })),
    }));
  }

  // Palme als Silhouette mit leicht leuchtenden Blättern
  function makePalm(rng, h, isStatic = true) {
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
    // alle Blätter einer Palme zu einem Mesh zusammenfassen (weniger Zeichenaufrufe)
    const n = 8;
    const leaves = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (i / n) * Math.PI * 2 + rng() * 0.3, 0.15 + rng() * 0.25, "YZX")),
        new THREE.Vector3().setScalar((h / 3) * (0.85 + rng() * 0.3))
      );
      leaves.push(leafGeo.clone().applyMatrix4(m));
    }
    top.add(mesh(THREE.BufferGeometryUtils.mergeBufferGeometries(leaves), leafMat, { cast: true }));
    g.add(top);
    const sway = rng() * 10;
    animated.push({ static: isStatic, fn: (t) => { top.rotation.z = Math.sin(t * 0.7 + sway) * 0.04; } });
    g.rotation.y = rng() * Math.PI * 2;
    return g;
  }

  // Fein unterteilte Bodenfläche, die den Hügeln folgt (für Boden und Seen-Maske)
  function terrainPlane() {
    return G("terrainPlane", () => {
      const w = COLS + FLOOR_MARGIN * 2;
      const d = ROWS + FLOOR_MARGIN * 2;
      const g = new THREE.PlaneGeometry(w, d, Math.round(w * 8), Math.round(d * 8)).rotateX(-Math.PI / 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, gw(p.getX(i), p.getZ(i)));
      g.computeVertexNormals();
      return g;
    });
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

    // Glatter Metallboden mit Details (eine Fläche statt einzelner Platten)
    const floorTex = floorTextures(rng);
    const floor = mesh(terrainPlane(), new THREE.MeshStandardMaterial({
      map: floorTex.map, roughnessMap: floorTex.rough, roughness: 1, metalness: 0.55, color: "#ffd9ee",
      emissive: "#ffffff", emissiveMap: floorTex.glow, emissiveIntensity: 1,
    }), { receive: true });
    floor.position.y = FLOOR_Y;
    // leuchtende Höhenlinien, damit man die Hügel auch von oben erkennt
    floor.material.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vH;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvH = position.y;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vH;").replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float hv = vH * 6.0;
        float line = 1.0 - min(abs(fract(hv - 0.5) - 0.5) / max(fwidth(hv) * 1.2, 1e-4), 1.0);
        float shade = smoothstep(0.02, 0.15, vH);
        totalEmissiveRadiance += mix(vec3(1.0, 0.25, 0.75), vec3(0.3, 0.9, 1.0), clamp(vH / 1.6, 0.0, 1.0)) * line * 0.55 * shade;`
      );
    };
    mapGroup.add(floor);

    // Hologramm-Raster: nur im Baumodus sichtbar
    holoFill = new THREE.InstancedMesh(G("holoFill", () => new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({
      color: "#29e6ff", transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending,
    }), COLS * ROWS);
    holoEdge = new THREE.InstancedMesh(G("holoEdge", () => roundedOutline(0.9, 0.08, 0.025)), new THREE.MeshBasicMaterial({
      color: tmpColor.set("#7ff8ff").multiplyScalar(1.3), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
    }), COLS * ROWS);
    holoFill.frustumCulled = holoEdge.frustumCulled = false;
    holoFill.count = holoEdge.count = 0;
    mapGroup.add(holoFill, holoEdge);

    // Straße mit Neon-Kanten und Lichtstreifen, die zum Tor fließen
    pathPoints.forEach((pts, pi) => {
      const pl = polyline(pts.map((p) => ({ x: wx(p.x), z: wz(p.y) })));
      const p3 = [];
      for (let d = 0; d < pl.length; d += 0.12) p3.push(pointAt(pl, d));
      p3.push(pl.pts[pl.pts.length - 1]);
      const yOff = pi * 0.002;
      mapGroup.add(mesh(ribbon(p3, 0, 0.94, (x, z) => ROAD_Y + yOff + bw(x, z)), metal("#191a2c", 0.3, 0.7), { receive: true }));
      for (const side of [-1, 1]) {
        mapGroup.add(mesh(ribbon(p3, side * 0.45, 0.05, (x, z) => ROAD_Y + 0.004 + yOff + bw(x, z)), neon("#29e6ff", 2.2)));
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

    // Seen mit glatter Uferlinie: Maske mit Rot = Wasser, Grün = Rasen (halb) / Uferweg (voll), Blau = Kanten
    const poolMask = canvasTexture(2048, Math.round(2048 * (ROWS + FLOOR_MARGIN * 2) / (COLS + FLOOR_MARGIN * 2)), (g, w) => {
      g.fillStyle = "#000000";
      g.fillRect(0, 0, w, w);
      g.globalCompositeOperation = "lighter";
      const ppt = w / (COLS + FLOOR_MARGIN * 2);
      const shape = (lake, extra) => {
        g.beginPath();
        for (let i = 0; i <= 160; i++) {
          const p = lakePoint(lake, (i / 160) * Math.PI * 2, extra);
          g[i ? "lineTo" : "moveTo"]((p.x + FLOOR_MARGIN) * ppt, (p.y + FLOOR_MARGIN) * ppt);
        }
        g.closePath();
      };
      // Gehwege: erst die leuchtende Kante (blau, etwas breiter), dann das Pflaster (grün) darüber
      const curvePath = (curve) => {
        g.beginPath();
        curve.forEach((p, i) => g[i ? "lineTo" : "moveTo"]((p.x + FLOOR_MARGIN) * ppt, (p.y + FLOOR_MARGIN) * ppt));
      };
      g.lineCap = "round";
      g.lineJoin = "round";
      for (const curve of WALK_CURVES) {
        curvePath(curve);
        g.strokeStyle = "rgb(0,0,255)";
        g.lineWidth = (WALK_WIDTH + 0.07) * ppt;
        g.stroke();
      }
      g.globalCompositeOperation = "source-over";
      for (const curve of WALK_CURVES) {
        curvePath(curve);
        g.strokeStyle = "rgb(0,255,0)";
        g.lineWidth = WALK_WIDTH * ppt;
        g.stroke();
      }
      g.globalCompositeOperation = "lighter";
      const mid = (LAKE_PATH.inner + LAKE_PATH.outer) / 2;
      for (const lake of LAKES) {
        shape(lake, LAKE_PATH.inner);
        g.fillStyle = "rgb(0,120,0)";
        g.fill();
        shape(lake, 0);
        g.fillStyle = "rgb(255,0,0)";
        g.fill();
        shape(lake, mid);
        g.strokeStyle = "rgb(0,255,0)";
        g.lineWidth = (LAKE_PATH.outer - LAKE_PATH.inner) * ppt;
        g.stroke();
        g.strokeStyle = "rgb(0,0,255)";
        g.lineWidth = 0.035 * ppt;
        for (const ex of [0, LAKE_PATH.inner, LAKE_PATH.outer]) {
          shape(lake, ex);
          g.stroke();
        }
      }
    });
    poolMask.anisotropy = 8;
    const poolMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { mask: { value: poolMask }, time: { value: 0 }, tiles: { value: new THREE.Vector2(COLS + FLOOR_MARGIN * 2, ROWS + FLOOR_MARGIN * 2) } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `
        uniform sampler2D mask; uniform float time;
        varying vec2 vUv;
        uniform vec2 tiles;
        void main(){
          vec4 mk = texture2D(mask, vUv);
          float m = mk.r;
          float edge = mk.b;
          if (m < 0.5) {
            float pr = mk.g;
            if (pr < 0.25 && edge < 0.35) discard;
            vec3 col;
            if (edge > 0.35) {
              // leuchtende Kante des Uferwegs
              col = vec3(1.0, 0.4, 0.85) * 1.5;
            } else if (pr > 0.75) {
              // schmaler Weg aus kleinen hellen Pflastersteinen
              vec2 q = vUv * tiles * 9.0;
              q.x += floor(q.y) * 0.5;
              vec2 f = abs(fract(q) - 0.5);
              float joint = smoothstep(0.42, 0.5, max(f.x, f.y));
              float n = fract(sin(dot(floor(q), vec2(12.9898, 78.233))) * 43758.5453);
              col = mix(vec3(0.5, 0.4, 0.55), vec3(0.62, 0.5, 0.62), n);
              col = mix(col, vec3(0.16, 0.1, 0.2), joint * 0.8);
            } else {
              // Rasenstreifen zwischen Wasser und Weg
              vec2 q = vUv * tiles * 14.0;
              float n = fract(sin(dot(floor(q), vec2(41.3, 17.9))) * 9134.21);
              col = mix(vec3(0.03, 0.18, 0.16), vec3(0.06, 0.3, 0.24), n);
            }
            gl_FragColor = vec4(col, 1.0);
            return;
          }
          if (edge > 0.35) {
            gl_FragColor = vec4(vec3(0.85, 1.0, 1.0) * 1.7, 1.0);
            return;
          }
          vec2 p = vUv * vec2(26.0, 16.0);
          float w = sin(p.x * 1.3 + time) + sin(p.y * 1.7 - time * 1.2) + sin((p.x + p.y) * 0.9 + time * 0.7);
          vec3 deep = vec3(0.0, 0.22, 0.32);
          vec3 bright = vec3(0.25, 1.0, 0.9);
          vec3 c = mix(deep, bright, 0.5 + 0.5 * sin(w * 1.6));
          float caustic = pow(max(0.0, sin(w * 3.0 + time)), 8.0);
          c += vec3(0.8, 1.0, 1.0) * caustic * 0.6;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const pools = new THREE.Mesh(terrainPlane(), poolMat);
    pools.userData.ownMaterial = true;
    pools.position.y = FLOOR_Y + 0.006;
    mapGroup.add(pools);
    animated.push({ fn: (t) => { poolMat.uniforms.time.value = t; } });
    // aufsteigende Energieblasen über dem Wasser
    for (const lake of LAKES) {
      for (let i = 0; i < Math.round(lake.rx * lake.ry * 4); i++) {
        let x;
        let y;
        do {
          x = lake.x + (rng() - 0.5) * lake.rx * 2;
          y = lake.y + (rng() - 0.5) * lake.ry * 2;
        } while (!insideLake(lake, x, y, -0.2));
        const bubble = glowSprite("#7affea", 0.18);
        const ph = rng();
        mapGroup.add(bubble);
        animated.push({
          fn: (t) => {
            const k = (t * 0.35 + ph) % 1;
            bubble.position.set(x - COLS / 2, FLOOR_Y + k * 0.8, y - ROWS / 2);
            bubble.material.opacity = 1 - k;
          },
        });
      }
      mapGroup.add(makeLakeDecor(lake, rng));
    }

    // Gebäude (Hindernisse)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = grid[r][c];
        if (OBSTACLES[t]) {
          const obj = Buildings.make(t, variant[r][c]);
          const hs = [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]].map(([ox, oz]) => gw(tileX(c) + ox, tileZ(r) + oz));
          obj.position.set(tileX(c), PAD_TOP + Math.max(...hs), tileZ(r));
          // Fundament für Gebäude am Hang
          if (Math.max(...hs) - Math.min(...hs) > 0.02) {
            const base = mesh(G("bldFoundation", () => new THREE.BoxGeometry(0.92, 1.4, 0.92).translate(0, -0.7, 0)), metal("#3a2d5c", 0.6, 0.4), { receive: true });
            obj.add(base);
          }
          // Vorderseite (+Z) zum nächsten Gehweg drehen, wenn einer in der Nähe ist
          let best = null;
          let bestD = 1.6;
          for (const curve of WALK_CURVES) {
            for (const p of curve) {
              const dd = Math.hypot(p.x - (c + 0.5), p.y - (r + 0.5));
              if (dd < bestD) {
                bestD = dd;
                best = p;
              }
            }
          }
          if (best) obj.rotation.y = Math.atan2(best.x - (c + 0.5), best.y - (r + 0.5));
          obstacleMeshes.set(`${c},${r}`, obj);
          mapGroup.add(obj);
        }
      }
    }
    mapGroup.add(makeTunnel());
    mapGroup.add(makeCrosswalks());

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
      const ax = p.x + n.x * o1;
      const az = p.z + n.z * o1;
      const bx = p.x + n.x * o2;
      const bz = p.z + n.z * o2;
      pos.push(ax, typeof y === "function" ? y(ax, az) : y, az, bx, typeof y === "function" ? y(bx, bz) : y, bz);
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

  // Texturen für den Boden: Farbe, Rauheit (für Spiegelungen) und leuchtende Details
  function floorTextures(rng) {
    const tilesW = COLS + FLOOR_MARGIN * 2;
    const tilesH = ROWS + FLOOR_MARGIN * 2;
    const W = 2048;
    const H = Math.round((W * tilesH) / tilesW);
    const ppt = W / tilesW;
    const px = (c) => (c + FLOOR_MARGIN) * ppt;
    const py = (r) => (r + FLOOR_MARGIN) * ppt;

    // Plattenfugen in unregelmäßigen Abständen (nicht im Feldraster)
    const seamsX = [];
    for (let x = -FLOOR_MARGIN; x < COLS + FLOOR_MARGIN; x += 2.3 + rng() * 2.4) seamsX.push(x);
    const rowsY = [];
    for (let y = -FLOOR_MARGIN; y < ROWS + FLOOR_MARGIN; y += 2 + rng() * 2) rowsY.push(y);
    const panels = [];
    rowsY.forEach((y0, i) => {
      const y1 = rowsY[i + 1] ?? ROWS + FLOOR_MARGIN;
      const shift = rng() * 2;
      let x0 = -FLOOR_MARGIN;
      for (const sx of seamsX) {
        const x1 = sx + shift;
        if (x1 > x0 + 0.8 && x1 < COLS + FLOOR_MARGIN) {
          panels.push([x0, y0, x1, y1]);
          x0 = x1;
        }
      }
      panels.push([x0, y0, COLS + FLOOR_MARGIN, y1]);
    });

    const map = canvasTexture(W, H, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#2c1f52");
      grad.addColorStop(1, "#211843");
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      // leicht unterschiedlich getönte Platten
      for (const [x0, y0, x1, y1] of panels) {
        g.fillStyle = `rgba(${rng() < 0.5 ? "255,255,255" : "0,0,0"},${0.02 + rng() * 0.04})`;
        g.fillRect(px(x0), py(y0), px(x1) - px(x0), py(y1) - py(y0));
      }
      // gebürstetes Metall und Kratzer
      for (let i = 0; i < 2500; i++) {
        g.fillStyle = `rgba(255,255,255,${rng() * 0.035})`;
        g.fillRect(rng() * W, rng() * H, 20 + rng() * 120, 1);
      }
      for (let i = 0; i < 6000; i++) {
        g.fillStyle = `rgba(0,0,0,${rng() * 0.12})`;
        g.fillRect(rng() * W, rng() * H, 2, 2);
      }
      // Fugen mit Lichtkante
      for (const [x0, y0, x1, y1] of panels) {
        g.strokeStyle = "rgba(8,4,20,0.85)";
        g.lineWidth = 4;
        g.strokeRect(px(x0), py(y0), px(x1) - px(x0), py(y1) - py(y0));
        g.strokeStyle = "rgba(190,160,255,0.18)";
        g.lineWidth = 1;
        g.strokeRect(px(x0) + 3, py(y0) + 3, px(x1) - px(x0) - 6, py(y1) - py(y0) - 6);
        // Schrauben an den Ecken
        g.fillStyle = "rgba(200,190,255,0.35)";
        for (const [bx, by] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
          for (const [ox, oy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            g.beginPath();
            g.arc(px(bx) + ox * 12, py(by) + oy * 12, 3, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
      // Lüftungsgitter
      for (let i = 0; i < 22; i++) {
        const x = px(rng() * COLS);
        const y = py(rng() * ROWS);
        g.fillStyle = "rgba(10,6,24,0.8)";
        g.fillRect(x, y, ppt * 0.6, ppt * 0.28);
        g.fillStyle = "rgba(150,130,220,0.25)";
        for (let k = 4; k < ppt * 0.6; k += 7) g.fillRect(x + k, y + 4, 3, ppt * 0.28 - 8);
      }
      // Wartungsdeckel
      for (let i = 0; i < 8; i++) {
        const x = px(rng() * COLS);
        const y = py(rng() * ROWS);
        g.strokeStyle = "rgba(170,150,255,0.3)";
        g.lineWidth = 3;
        g.beginPath();
        g.arc(x, y, ppt * 0.22, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.moveTo(x - ppt * 0.12, y);
        g.lineTo(x + ppt * 0.12, y);
        g.stroke();
      }
      // Warnstreifen an Portalen und Tor
      const hazard = (x0, y0, w, h) => {
        g.save();
        g.beginPath();
        g.rect(px(x0), py(y0), w * ppt, h * ppt);
        g.clip();
        g.fillStyle = "rgba(20,10,10,0.7)";
        g.fillRect(px(x0), py(y0), w * ppt, h * ppt);
        g.fillStyle = "rgba(255,200,40,0.75)";
        for (let k = -h * ppt; k < w * ppt; k += 28) {
          g.beginPath();
          g.moveTo(px(x0) + k, py(y0) + h * ppt);
          g.lineTo(px(x0) + k + 14, py(y0) + h * ppt);
          g.lineTo(px(x0) + k + 14 + h * ppt, py(y0));
          g.lineTo(px(x0) + k + h * ppt, py(y0));
          g.fill();
        }
        g.restore();
      };
      for (const path of PATHS) {
        const r = path[0][1];
        hazard(-0.3, r - 0.95, 0.25, 0.9);
        hazard(-0.3, r + 1.05, 0.25, 0.9);
      }
      for (const [c, r] of GATE_TILES) hazard(c + 0.05, r + (r < PATHS[0][PATHS[0].length - 1][1] ? 0.85 : -0.03), 0.9, 0.18);
      // Beschriftungen
      g.fillStyle = "rgba(220,200,255,0.12)";
      g.font = `bold ${Math.round(ppt * 0.7)}px system-ui, sans-serif`;
      g.textAlign = "center";
      g.fillText("NEO-CITY · SUNSET DISTRICT", px(COLS / 2), py(ROWS - 0.25));
      g.font = `bold ${Math.round(ppt * 0.22)}px monospace`;
      g.fillStyle = "rgba(220,200,255,0.25)";
      for (const [x0, y0] of panels) {
        if (rng() < 0.35) g.fillText(`${String.fromCharCode(65 + Math.floor(rng() * 8))}-${Math.floor(rng() * 90 + 10)}`, px(x0) + ppt * 0.35, py(y0) + ppt * 0.3);
      }
    });

    const rough = canvasTexture(W / 2, H / 2, (g) => {
      g.fillStyle = "rgb(120,120,120)";
      g.fillRect(0, 0, W / 2, H / 2);
      for (const [x0, y0, x1, y1] of panels) {
        const v = 80 + Math.floor(rng() * 90);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(px(x0) / 2, py(y0) / 2, (px(x1) - px(x0)) / 2, (py(y1) - py(y0)) / 2);
      }
      // glänzende Kratzer und Schlieren
      for (let i = 0; i < 900; i++) {
        const v = 40 + Math.floor(rng() * 60);
        g.fillStyle = `rgba(${v},${v},${v},0.5)`;
        g.fillRect((rng() * W) / 2, (rng() * H) / 2, 10 + rng() * 80, 1);
      }
    });

    const glow = canvasTexture(W, H, (g) => {
      g.fillStyle = "#000000";
      g.fillRect(0, 0, W, H);
      // Leiterbahnen
      const colors = ["rgba(41,230,255,", "rgba(255,60,172,", "rgba(179,136,255,"];
      for (let i = 0; i < 46; i++) {
        let x = px(rng() * COLS);
        let y = py(rng() * ROWS);
        const col = colors[i % colors.length];
        g.strokeStyle = col + "0.38)";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, y);
        let dir = Math.floor(rng() * 4);
        const steps = 2 + Math.floor(rng() * 4);
        for (let k = 0; k < steps; k++) {
          const len = ppt * (0.4 + rng() * 1.6);
          const diag = rng() < 0.35;
          const dx = [1, 0, -1, 0][dir];
          const dy = [0, 1, 0, -1][dir];
          if (diag) {
            x += (dx + dy) * len * 0.5;
            y += (dy - dx) * len * 0.5;
          } else {
            x += dx * len;
            y += dy * len;
          }
          g.lineTo(x, y);
          dir = (dir + (rng() < 0.5 ? 1 : 3)) % 4;
        }
        g.stroke();
        g.fillStyle = col + "0.8)";
        g.beginPath();
        g.arc(x, y, 4, 0, Math.PI * 2);
        g.fill();
      }
      // kleine LED-Punkte in den Fugen
      for (const [x0, y0, x1] of panels) {
        if (rng() < 0.5) continue;
        g.fillStyle = rng() < 0.5 ? "rgba(41,230,255,0.9)" : "rgba(255,60,172,0.9)";
        for (let x = px(x0) + 30; x < px(x1) - 20; x += 46) g.fillRect(x, py(y0) - 1, 10, 3);
      }
    });
    for (const t of [map, glow]) t.anisotropy = 8;
    return { map, rough, glow };
  }

  // Uferweg-Deko: Laternen in gleichen Abständen, dazwischen Bänke mit Blick aufs Wasser
  function makeLakeDecor(lake, rng) {
    const g = new THREE.Group();
    const edge = LAKE_PATH.outer + 0.07;
    // Punkte entlang des Weges nach Weglänge verteilen
    const pts = [];
    const cum = [0];
    for (let i = 0; i <= 400; i++) {
      const p = lakePoint(lake, (i / 400) * Math.PI * 2, edge);
      if (i) cum.push(cum[i - 1] + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y));
      pts.push(p);
    }
    const total = cum[400];
    const at = (d) => {
      d = ((d % total) + total) % total;
      let i = 1;
      while (i < 400 && cum[i] < d) i++;
      const a = pts[i - 1];
      const b = pts[i];
      const k = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      // Normale nach außen (weg vom See)
      const tx = b.x - a.x;
      const ty = b.y - a.y;
      const len = Math.hypot(tx, ty) || 1;
      let nx = ty / len;
      let ny = -tx / len;
      const px = a.x + tx * k;
      const py = a.y + ty * k;
      if ((px - lake.x) * nx + (py - lake.y) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      return { x: px, y: py, nx, ny };
    };
    const lampCount = Math.max(6, Math.round(total / 1.15));
    const step = total / lampCount;
    const lampColors = ["#ff8ad8", "#7af3ff"];
    for (let i = 0; i < lampCount; i++) {
      const p = at(i * step);
      const lamp = new THREE.Group();
      lamp.position.set(p.x - COLS / 2, PAD_TOP, p.y - ROWS / 2);
      const pole = mesh(G("lakePole", () => new THREE.CylinderGeometry(0.014, 0.022, 0.62, 8)), metal("#e8ecff", 0.25, 1), { cast: true });
      pole.position.y = 0.31;
      const cap = mesh(G("lakeLampCap", () => new THREE.ConeGeometry(0.06, 0.05, 12)), chrome("#f4f6ff", 0.1));
      cap.position.y = 0.7;
      const globe = mesh(G("lakeLamp", () => new THREE.SphereGeometry(0.05, 12, 8)), neon(lampColors[i % 2], 2.6));
      globe.position.y = 0.64;
      const halo = glowSprite(lampColors[i % 2], 0.45);
      halo.position.y = 0.64;
      lamp.add(pole, cap, globe, halo);
      g.add(lamp);
      // Bank genau zwischen zwei Laternen, an jeder zweiten Lücke, Blick zum Wasser
      if (i % 2 === 0) {
        const q = at(i * step + step / 2);
        const bench = new THREE.Group();
        bench.position.set(q.x - COLS / 2, PAD_TOP, q.y - ROWS / 2);
        bench.rotation.y = Math.atan2(-q.nx, -q.ny);
        const seat = mesh(G("bench", () => new THREE.RoundedBoxGeometry(0.34, 0.04, 0.12, 2, 0.015)), chrome("#ffd0f0", 0.2, 0.5), { cast: true });
        seat.position.y = 0.11;
        const back = mesh(G("benchBack", () => new THREE.RoundedBoxGeometry(0.34, 0.1, 0.025, 2, 0.01)), chrome("#ffd0f0", 0.2, 0.5), { cast: true });
        back.position.set(0, 0.18, -0.055);
        back.rotation.x = -0.15;
        bench.add(seat, back);
        for (const sx of [-1, 1]) {
          const leg = mesh(G("benchLeg", () => new THREE.BoxGeometry(0.025, 0.11, 0.1)), metal("#d8dcff", 0.3, 1));
          leg.position.set(sx * 0.14, 0.055, 0);
          bench.add(leg);
        }
        g.add(bench);
      }
    }
    // Palmen in den gesperrten Ecken außerhalb des Weges
    for (let i = 1; i < lampCount; i += 2) {
      const p = at(i * step + step / 2);
      const x = p.x + p.nx * 0.32;
      const y = p.y + p.ny * 0.32;
      const c = Math.floor(x);
      const r = Math.floor(y);
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS || grid[r][c] !== "pool") continue;
      const palm = makePalm(rng, 0.8 + rng() * 0.3, false);
      palm.position.set(x - COLS / 2, PAD_TOP, y - ROWS / 2);
      g.add(palm);
    }
    return g;
  }

  // Zebrastreifen, wo ein Gehweg die Alien-Straße quert, mit kleinen Fußgängerampeln
  function makeCrosswalks() {
    const g = new THREE.Group();
    const stripeMat = cached("zebra", () => new THREE.MeshStandardMaterial({ color: "#f4eeff", emissive: "#ffffff", emissiveIntensity: 0.35, roughness: 0.5 }));
    for (const curve of WALK_CURVES) {
      // zusammenhängende Abschnitte auf der Straße finden
      let run = [];
      const flush = () => {
        if (run.length > 2) {
          const a = run[0];
          const b = run[run.length - 1];
          const m = run[Math.floor(run.length / 2)];
          const ang = Math.atan2(b.y - a.y, b.x - a.x); // Laufrichtung der Fußgänger
          const dx = Math.cos(ang);
          const dz = Math.sin(ang);
          for (let i = -2; i <= 2; i++) {
            const st = mesh(G("zebraStripe", () => new THREE.PlaneGeometry(0.09, 0.4).rotateX(-Math.PI / 2)), stripeMat);
            st.position.set(m.x - COLS / 2 + dx * i * 0.17, 0, m.y - ROWS / 2 + dz * i * 0.17);
            st.position.y = ROAD_Y + 0.008 + bw(st.position.x, st.position.z);
            st.rotation.y = -ang;
            g.add(st);
          }
          for (const s of [-1, 1]) {
            const post = new THREE.Group();
            post.position.set(m.x - COLS / 2 + dx * s * 0.62 - dz * 0.24, 0, m.y - ROWS / 2 + dz * s * 0.62 + dx * 0.24);
            post.position.y = PAD_TOP + gw(post.position.x, post.position.z);
            const pole = mesh(G("crossPole", () => new THREE.CylinderGeometry(0.012, 0.016, 0.42, 6)), metal("#e8ecff", 0.25, 1));
            pole.position.y = 0.21;
            const light = mesh(G("crossLight", () => new THREE.RoundedBoxGeometry(0.06, 0.09, 0.06, 2, 0.015)), neon(s < 0 ? "#69f0ae" : "#ff2a4a", 2.6));
            light.position.y = 0.44;
            post.add(pole, light);
            g.add(post);
          }
        }
        run = [];
      };
      for (const p of curve) {
        if (pathTiles.has(`${Math.floor(p.x)},${Math.floor(p.y)}`)) run.push(p);
        else flush();
      }
      flush();
    }
    return g;
  }

  // Tunnel durch den Berg: an beiden Enden ein Portal mit leuchtendem Saug-Wirbel
  let vortexTex = null;
  function makeTunnel() {
    const g = new THREE.Group();
    const x = tileX(TUNNEL.col);
    const zTop = tileZ(TUNNEL.rowFrom) - 0.5;
    const zBottom = tileZ(TUNNEL.rowTo) + 0.5;
    if (!vortexTex) {
      vortexTex = canvasTexture(128, 128, (c) => {
        const grad = c.createRadialGradient(64, 64, 2, 64, 64, 64);
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.25, "#29e6ff");
        grad.addColorStop(0.7, "#3a1dbf");
        grad.addColorStop(1, "rgba(20,0,60,0)");
        c.fillStyle = grad;
        c.fillRect(0, 0, 128, 128);
        c.strokeStyle = "rgba(255,255,255,0.7)";
        c.lineWidth = 3;
        for (let i = 0; i < 6; i++) {
          c.beginPath();
          for (let a = 0; a < 5.5; a += 0.1) {
            const r = 4 + a * 10;
            const ang = a + (i * Math.PI * 2) / 6;
            c.lineTo(64 + Math.cos(ang) * r, 64 + Math.sin(ang) * r);
          }
          c.stroke();
        }
      });
      vortexTex.center.set(0.5, 0.5);
    }
    // Portalwand mit Bogenöffnung (wird in den Hang gesetzt)
    // breite Portalwand mit abgeschrägten Schultern, verdeckt den Übergang vom Einschnitt zum Berg
    const wallGeo = G("portalWall", () => {
      const sh = new THREE.Shape();
      sh.moveTo(-1.55, 0);
      sh.lineTo(1.55, 0);
      sh.lineTo(1.55, 0.42);
      sh.quadraticCurveTo(1.2, 0.52, 0.88, 0.8);
      sh.quadraticCurveTo(0.6, 1.0, 0, 1.0);
      sh.quadraticCurveTo(-0.6, 1.0, -0.88, 0.8);
      sh.quadraticCurveTo(-1.2, 0.52, -1.55, 0.42);
      sh.lineTo(-1.55, 0);
      const hole = new THREE.Path();
      hole.moveTo(-0.5, 0);
      hole.lineTo(-0.5, 0.3);
      hole.absarc(0, 0.3, 0.5, Math.PI, 0, true);
      hole.lineTo(0.5, 0);
      hole.lineTo(-0.5, 0);
      sh.holes.push(hole);
      return new THREE.ExtrudeGeometry(sh, { depth: 0.22, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2, curveSegments: 24 });
    });
    for (const [z, dir] of [[zBottom, 1], [zTop, -1]]) {
      const portal = new THREE.Group();
      portal.position.set(x, PAD_TOP, z);
      // Wand steht im Hang, Öffnung zeigt nach außen
      portal.rotation.y = dir > 0 ? 0 : Math.PI;
      portal.scale.setScalar(0.8);
      const wall = mesh(wallGeo, chrome("#6a5c9a", 0.25, 0.6), { cast: true, receive: true });
      wall.position.z = -0.2;
      const arch = mesh(G("portalArch", () => new THREE.TorusGeometry(0.53, 0.05, 10, 40, Math.PI)), chrome("#f4f6ff", 0.08), { cast: true });
      arch.position.set(0, 0.3, 0.02);
      const archGlow = mesh(G("portalArchGlow", () => new THREE.TorusGeometry(0.6, 0.02, 8, 40, Math.PI)), neon("#29e6ff", 3));
      archGlow.position.set(0, 0.3, 0.03);
      for (const sx of [-1, 1]) {
        const post = mesh(G("portalPost", () => new THREE.BoxGeometry(0.1, 0.3, 0.1)), chrome("#f4f6ff", 0.08), { cast: true });
        post.position.set(sx * 0.53, 0.15, 0.02);
        portal.add(post);
      }
      const dark = mesh(G("portalDark", () => {
        const sh = new THREE.Shape();
        sh.moveTo(-0.5, 0);
        sh.lineTo(-0.5, 0.3);
        sh.absarc(0, 0.3, 0.5, Math.PI, 0, true);
        sh.lineTo(0.5, 0);
        return new THREE.ShapeGeometry(sh, 24);
      }), basic("#05010c"));
      dark.position.z = -0.3;
      const disc = new THREE.Mesh(G("portalVortex", () => new THREE.CircleGeometry(0.5, 40, 0, Math.PI).translate(0, 0.3, 0)), new THREE.MeshBasicMaterial({
        map: vortexTex, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      disc.userData.ownMaterial = true;
      disc.position.z = -0.1;
      const sign = glowSprite("#29e6ff", 1.2);
      sign.position.set(0, 0.4, 0.1);
      portal.add(wall, arch, archGlow, dark, disc, sign);
      g.add(portal);
      animated.push({ fn: (t) => { disc.material.opacity = 0.45 + Math.sin(t * 5) * 0.15; sign.material.opacity = 0.35 + Math.sin(t * 5) * 0.15; } });
    }
    animated.push({ fn: (t) => { vortexTex.rotation = t * 4; } });
    return g;
  }

  function makeGate() {
    const g = new THREE.Group();
    const x = tileX(GATE_TILES[0][0]);
    const midRow = (GATE_TILES[0][1] + GATE_TILES[1][1]) / 2;
    for (const [, r] of GATE_TILES) {
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
    arch.position.set(x, PAD_TOP + 1.5, tileZ(midRow));
    g.add(arch);
    const archGlow = mesh(new THREE.TorusGeometry(1, 0.025, 8, 48, Math.PI).rotateY(Math.PI / 2), neon("#29e6ff", 3));
    archGlow.position.set(x - 0.09, PAD_TOP + 1.5, tileZ(midRow));
    g.add(archGlow);
    const shieldMat = new THREE.MeshBasicMaterial({ color: "#ff4fd8", transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const shield = new THREE.Mesh(new THREE.CircleGeometry(1, 40, 0, Math.PI).rotateY(Math.PI / 2), shieldMat);
    shield.userData.ownMaterial = true;
    shield.position.set(x + 0.1, PAD_TOP + 0.5, tileZ(midRow));
    shield.scale.set(1, 1.4, 0.95);
    g.add(shield);
    animated.push({ fn: (t) => { shieldMat.opacity = 0.14 + Math.sin(t * 3) * 0.06; } });
    // Landedeck für die Raumschiffe hinter dem Tor
    const deck = mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.3, 40), chrome("#5a6090", 0.25, 0.7), { receive: true });
    deck.position.set(COLS / 2 + 1.3, SLAB_TOP - 0.15, tileZ(midRow));
    const deckRing = mesh(new THREE.TorusGeometry(0.85, 0.035, 8, 48).rotateX(Math.PI / 2), neon("#ffd740", 2.4));
    deckRing.position.set(COLS / 2 + 1.3, SLAB_TOP + 0.01, tileZ(midRow));
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
    burstStars(tileX(c), PAD_TOP + 0.4 + gw(tileX(c), tileZ(r)), tileZ(r), 8, "#ffffff");
  }

  // ---------- Türme ----------
  function makeTower(t) {
    const g = new THREE.Group();
    const ud = { model: null, key: null, marker: null, markMat: null, idle: null };
    if (t.type === "mortar") {
      // Fadenkreuz am Zielpunkt
      const marker = new THREE.Group();
      const markMat = new THREE.MeshBasicMaterial({ color: tmpColor.set("#ffd740").multiplyScalar(1.6), transparent: true, opacity: 0.35, depthWrite: false });
      marker.add(new THREE.Mesh(G("crossRing", () => new THREE.RingGeometry(0.42, 0.48, 40).rotateX(-Math.PI / 2)), markMat));
      for (let i = 0; i < 4; i++) {
        const tick = new THREE.Mesh(G("crossTick", () => new THREE.PlaneGeometry(0.06, 0.3).rotateX(-Math.PI / 2)), markMat);
        const a = (i / 4) * Math.PI * 2;
        tick.position.set(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
        tick.rotation.y = -a + Math.PI / 2;
        marker.add(tick);
      }
      marker.children[0].userData.ownMaterial = true;
      ud.marker = marker;
      ud.markMat = markMat;
      g.add(marker);
    }
    if (t.type === "station") {
      ud.idle = makeShipModel();
      ud.idle.scale.setScalar(0.9);
      g.add(ud.idle);
    }
    g.position.set(wx(t.x), towerGround(t.x, t.y), wz(t.y));
    g.userData = ud;
    burstStars(wx(t.x), g.position.y + PAD_TOP + 0.5, wz(t.y), 10, TOWER_TYPES[t.type].color);
    return g;
  }

  function updateTower(t, g) {
    const ud = g.userData;
    const time = state.time;
    // Modell neu bauen, wenn sich die Ausbaustufen geändert haben
    const key = t.levels.join("");
    if (ud.key !== key) {
      if (ud.model) {
        g.remove(ud.model.root);
        disposeObject(ud.model.root);
        burstStars(g.position.x, g.position.y + PAD_TOP + 0.8, g.position.z, 18, "#ffffff");
      }
      ud.model = Towers.build(t.type, t.levels);
      ud.model.root.position.y = PAD_TOP;
      g.add(ud.model.root);
      ud.key = key;
    }
    const m = ud.model;
    if (m.aims) m.head.rotation.y = -t.angle;
    m.gun.position.x = -t.recoil * (t.type === "mortar" ? 0.05 : 0.08);
    Towers.animate(m, time + t.id, t.recoil);
    if (m.stationRing) m.stationRing.scale.setScalar(1 + t.recoil * 0.15);
    if (ud.idle) {
      ud.idle.position.set(0, PAD_TOP + 1.05 + Math.sin(time * 2 + t.id) * 0.05, 0);
      ud.idle.rotation.y = time * 0.8;
      ud.idle.visible = t.recoil < 0.3 && Math.max(...t.levels) < 5;
    }
    if (ud.marker) {
      const aim = state.aiming === t && state.hoverPoint ? state.hoverPoint : t.aim;
      ud.marker.position.set(wx(aim.x) - g.position.x, ROAD_Y + 0.03 + bp(aim.x, aim.y) - g.position.y, wz(aim.y) - g.position.z);
      ud.marker.rotation.y = time * 0.8;
      const active = state.aiming === t || (state.selected && state.selected.tower === t);
      ud.markMat.opacity = active ? 0.95 : 0.3;
      ud.marker.scale.setScalar((active ? 1 : 0.8) * (1 + Math.sin(time * 4) * 0.05));
      if (t.priority !== "point" && towerStats(t).autoTarget && !active) ud.markMat.opacity = 0.12;
    }
  }

  // ---------- Gegner ----------
  // Alien-Modell bauen. Wird neu gebaut, wenn sich Stufe oder Eigenschaften ändern.
  // Größe in Feldern: Stufe 1 klein, Bosse groß
  const ALIEN_SCALE = { tank: 0.85, bossA: 1.15, bossB: 0.95 };
  function buildAlienModel(e, ud) {
    const color = e.kind === "drone" ? DRONE_LEVELS[e.level].color : HEAVY[e.kind].color;
    const a = Aliens.build(e.kind, { level: e.level, color, props: e.props });
    const scale = e.kind === "drone" ? (0.42 + e.level * 0.05) / 1.3 * (e.props.camo || e.props.blast ? 1.35 : 1) : ALIEN_SCALE[e.kind];
    const model = new THREE.Group();
    a.root.scale.setScalar(scale);
    model.add(a.root);
    const big = e.kind !== "drone";
    a.root.traverse((o) => {
      if (!o.isMesh) return;
      if (!big) o.castShadow = false;
      if (o.material === a.skin || o.material === a.eyeMat) o.userData.ownMaterial = true;
    });
    ud.alien = a;
    ud.scale = scale;
    ud.r = (a.height * scale) / 2.6;
    ud.bodyMat = a.skin;
    ud.baseColor = a.skin.color.clone();
    ud.baseEmissive = (a.skin.userData.baseEmissive || new THREE.Color("#000000")).clone();
    ud.baseEmissiveIntensity = a.skin.emissiveIntensity;
    ud.eyeMat = a.eyeMat;
    ud.eyeBase = a.eyeMat.emissive.clone();
    ud.breaks = a.breaks.map((br) => ({ mesh: br.mesh, at: br.at, broken: false }));
    if (e.kind === "bossA" || e.kind === "bossB") {
      const glow = glowSprite(e.kind === "bossB" ? "#ff3cac" : "#b14dff", ud.r * 5);
      glow.position.y = ud.r * 1.4;
      model.add(glow);
      ud.glow = glow;
    }
    return model;
  }

  // Schrumpfen am Tunnel: 1 = normal, im Tunnel sehr klein
  function tunnelScale(e) {
    const R = TUNNEL_RECT;
    const dx = Math.max(R.x0 - e.x, 0, e.x - R.x1);
    const dy = Math.max(R.y0 - e.y, 0, e.y - R.y1);
    const d = Math.hypot(dx, dy) / TILE;
    const inside = isBoss(e) ? 0.18 : 0.35;
    const k = Math.min(1, d / 1.2);
    return inside + (1 - inside) * k * k * (3 - 2 * k);
  }

  function makeEnemy(e) {
    const root = new THREE.Group();
    const ud = {
      breaks: [], phase: Math.random() * 10, key: null, model: null, animT: Math.random() * 10, lastT: null,
      ice: mesh(G("iceBlock", () => new THREE.RoundedBoxGeometry(1, 1, 1, 2, 0.15)), cached("iceMat", () => new THREE.MeshPhysicalMaterial({
        color: "#c8f2ff", transparent: true, opacity: 0.55, roughness: 0.05, clearcoat: 1, emissive: "#5fd0ff", emissiveIntensity: 0.3,
      }))),
      stunStar: glowSprite("#ffd740", 0.25),
    };
    root.add(ud.ice, ud.stunStar);
    root.userData = ud;
    return root;
  }

  function updateEnemy(e, root) {
    const ud = root.userData;
    const time = state.time;
    // Modell (neu) aufbauen, wenn sich Stufe oder Eigenschaften geändert haben
    const key = `${e.kind}|${e.level}|${Object.keys(e.props).filter((k) => e.props[k]).sort().join(",")}`;
    if (ud.key !== key) {
      if (ud.model) {
        root.remove(ud.model);
        disposeObject(ud.model);
      }
      ud.model = buildAlienModel(e, ud);
      root.add(ud.model);
      ud.key = key;
    }
    const r = ud.r;
    root.position.set(wx(e.x), ROAD_Y + bp(e.x, e.y), wz(e.y));
    // sanft in Laufrichtung drehen
    let turn = -e.dir - ud.model.rotation.y;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    ud.model.rotation.y += turn * Math.min(1, (ud.lastT === null ? 1 : 0.25));

    // Laufen, Krabbeln, Schweben: Tempo der Animation folgt der echten Geschwindigkeit
    const dt = ud.lastT === null ? 0 : Math.max(0, Math.min(0.1, time - ud.lastT));
    ud.lastT = time;
    const moving = e.wait <= 0 && e.stunUntil <= time && e.frozenUntil <= time;
    const pace = e.kind === "drone" ? enemySpeed(e) / 60 : e.kind === "tank" ? 0.9 : 1;
    if (moving) ud.animT += dt * e.slowFactor * pace;
    ud.alien.animate(ud.animT, moving);
    if (e.props.camo) ud.bodyMat.opacity = 0.35 + Math.sin(time * 6 + ud.phase) * 0.12;

    // Am Tunnel eingesaugt: schrumpfen und leicht drehen
    const ts = tunnelScale(e);
    ud.model.scale.setScalar(ts);
    ud.model.position.set(0, 0, 0);
    if (ts < 0.98) ud.model.rotation.y += (1 - ts) * Math.sin(time * 9 + ud.phase) * 0.3;

    // Zustände: Treffer, Frost, Betäubung, Brand
    const now = time;
    const frozen = e.frozenUntil > now;
    ud.ice.visible = frozen;
    if (frozen) {
      ud.ice.scale.set(r * 2.4, r * 2.6, r * 2.4);
      ud.ice.position.y = r * 1.4;
    }
    ud.stunStar.visible = e.stunUntil > now;
    if (ud.stunStar.visible) ud.stunStar.position.set(Math.cos(time * 8) * r, r * 3, Math.sin(time * 8) * r);
    const heavy = e.kind !== "drone";
    const k = heavy ? Math.max(0, e.hp / e.maxHp) : 1;
    if (heavy) ud.bodyMat.color.copy(ud.baseColor).lerp(CHARRED, (1 - k) * 0.6);
    ud.eyeMat.emissive.copy(ud.eyeBase).lerp(EYE_HURT, heavy ? Math.min(1, (1 - k) * 1.4) : 0);
    const em = ud.bodyMat.emissive;
    if (e.flash > 0) {
      em.set("#ffffff");
      ud.bodyMat.emissiveIntensity = 0.6;
    } else if (e.burn) {
      em.set("#ff5a1a");
      ud.bodyMat.emissiveIntensity = 0.5 + Math.random() * 0.4;
      if (Math.random() < 0.3) addSpark(root.position.x, root.position.y + r * 2, root.position.z, Math.random() < 0.5 ? "#ff8a3d" : "#ffd740", 1);
    } else if (e.slowFactor < 1 || frozen) {
      em.set("#29e6ff");
      ud.bodyMat.emissiveIntensity = 0.45;
    } else if (heavy && k < 0.5) {
      em.set("#ff3d00");
      ud.bodyMat.emissiveIntensity = (0.5 - k) * 2.4 * (0.6 + 0.4 * Math.sin(time * 25 + ud.phase));
    } else {
      em.copy(ud.baseEmissive);
      ud.bodyMat.emissiveIntensity = ud.baseEmissiveIntensity;
    }
    if (ud.glow) ud.glow.material.opacity = 0.3 + k * 0.4;
    if (heavy) {
      for (const b of ud.breaks) {
        if (!b.broken && k < b.at) {
          b.broken = true;
          b.mesh.visible = false;
          b.mesh.getWorldPosition(tmpPos);
          for (let i = 0; i < 10; i++) addSpark(tmpPos.x, tmpPos.y, tmpPos.z, i % 2 ? "#ffd740" : "#ffffff", 2.5);
          addDebris(tmpPos.x, tmpPos.y, tmpPos.z, ud.baseColor);
        }
      }
      if (k < 0.5 && Math.random() < (0.5 - k) * 0.6) addSpark(root.position.x, root.position.y + r * 1.4, root.position.z, Math.random() < 0.5 ? "#ffb300" : "#fff3c4", 1.6);
      if (k < 0.3 && Math.random() < 0.2) addSmoke(root.position.x, root.position.y + r * 2, root.position.z);
      if (k < 0.3) ud.model.position.x += (Math.random() - 0.5) * 0.03;
    }
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

  function makeShip(s) {
    const g = new THREE.Group();
    const model = makeShipModel();
    if (s.s.bigShips) model.scale.setScalar(1.7);
    g.add(model);
    g.userData = { model, lastDir: s.dir };
    return g;
  }

  function updateShip(s, g) {
    const ud = g.userData;
    g.visible = s.wait <= 0;
    let turn = s.dir - ud.lastDir;
    if (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < -Math.PI) turn += Math.PI * 2;
    ud.lastDir = s.dir;
    g.position.set(wx(s.x), PAD_TOP + 0.42 + bp(s.x, s.y) + Math.sin(state.time * 3 + s.path) * 0.04, wz(s.y));
    g.rotation.y = -s.dir;
    ud.model.rotation.x = THREE.MathUtils.lerp(ud.model.rotation.x, THREE.MathUtils.clamp(-turn * 12, -0.6, 0.6), 0.2);
    ud.model.userData.engine.scale.setScalar(s.contact ? 0.2 : 0.28 + Math.random() * 0.08);
    const k = s.hp / s.maxHp;
    if (k < 0.6 && Math.random() < (0.6 - k)) addSpark(g.position.x, g.position.y, g.position.z, "#ffd740", 1.5);
    if (s.flash > 0 && Math.random() < 0.3) addSpark(g.position.x, g.position.y, g.position.z, "#ffffff", 2);
  }

  // ---------- Geschosse und Strahlen ----------
  function makeProjectile(p) {
    const g = new THREE.Group();
    if (p.kind === "bolt") {
      const bolt = mesh(G("laserBolt", () => new THREE.CapsuleGeometry(0.022, 0.32, 3, 6).rotateZ(Math.PI / 2)), neon(p.rail ? "#ffffff" : "#7ff8ff", p.rail ? 5 : 4));
      if (p.rail) bolt.scale.set(2.2, 1.4, 1.4);
      g.add(bolt);
    } else if (p.kind === "plasma") {
      g.add(mesh(G("plasmaBall", () => new THREE.SphereGeometry(0.09, 14, 10)), neon("#ff8a3d", 3.5)));
      g.add(glowSprite("#ff8a3d", 0.6));
    } else if (p.kind === "shell") {
      g.add(mesh(G("shell", () => new THREE.CapsuleGeometry(0.07, 0.12, 4, 10).rotateZ(Math.PI / 2)), metal("#2a2d44", 0.3, 1)));
      const band = mesh(G("shellBand", () => new THREE.TorusGeometry(0.075, 0.015, 6, 16).rotateY(Math.PI / 2)), neon("#ffd740", 3));
      g.add(band, glowSprite("#ffd740", 0.4));
    } else {
      const shard = mesh(G("cryoShard", () => new THREE.OctahedronGeometry(0.07, 0)), neon("#d6b8ff", 3.2));
      shard.scale.x = 1.8;
      g.add(shard);
    }
    return g;
  }

  function updateProjectile(p, g) {
    if (p.kind === "shell") {
      const k = Math.min(1, p.time / p.dur);
      const h = PAD_TOP + 0.6 + (ROAD_Y + 0.1 - PAD_TOP - 0.6) * k + Math.sin(k * Math.PI) * 3.2;
      g.position.set(wx(p.x), h + bp(p.x, p.y) + (1 - k) * (p.sx !== undefined ? towerGround(p.sx, p.sy) - bp(p.sx, p.sy) : 0), wz(p.y));
      g.rotation.y = -p.angle;
      g.rotation.z = (0.5 - k) * 2.4;
      if (Math.random() < 0.5) addSpark(g.position.x, g.position.y, g.position.z, "#ffd740", 0.3);
      return;
    }
    const travelled = Math.hypot(p.x - p.sx, p.y - p.sy);
    const remaining = Math.hypot(p.tx - p.x, p.ty - p.y);
    const f = travelled / Math.max(1, travelled + remaining);
    const startH = PAD_TOP + 0.55;
    const endH = ROAD_Y + 0.3;
    let h = startH + (endH - startH) * f;
    if (p.kind === "plasma") h += Math.sin(f * Math.PI) * 0.7;
    g.position.set(wx(p.x), h + bp(p.x, p.y) + (1 - f) * (towerGround(p.sx, p.sy) - bp(p.sx, p.sy)), wz(p.y));
    g.rotation.y = -p.angle;
    if (p.kind === "shard") g.rotation.x = state.time * 10;
  }

  // Strahlen (Dauerlaser, Schiffslaser, Splitter, Orbitalschlag)
  function makeBeam(b) {
    const m = new THREE.Mesh(G("beamCyl", () => new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0)), new THREE.MeshBasicMaterial({
      color: tmpColor.set(b.color).multiplyScalar(2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    m.userData.ownMaterial = true;
    return m;
  }

  const beamFrom = new THREE.Vector3();
  const beamTo = new THREE.Vector3();
  const beamDir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  function updateBeam(b, m) {
    const k = b.life / b.max;
    if (b.from === "sky") {
      beamFrom.set(wx(b.x1), 14, wz(b.y1));
      beamTo.set(wx(b.x2), ROAD_Y + bp(b.x2, b.y2), wz(b.y2));
    } else {
      beamFrom.set(wx(b.x1), (b.from === "tower" || !b.from ? towerGround(b.x1, b.y1) : bp(b.x1, b.y1)) + (b.from === "ground" ? ROAD_Y + 0.15 : PAD_TOP + (b.from === "ship" ? 0.42 : 0.55)), wz(b.y1));
      beamTo.set(wx(b.x2), ROAD_Y + 0.3 + bp(b.x2, b.y2), wz(b.y2));
    }
    beamDir.subVectors(beamTo, beamFrom);
    const len = beamDir.length();
    m.position.copy(beamFrom);
    m.quaternion.setFromUnitVectors(UP, beamDir.normalize());
    const w = b.width * (b.from === "sky" ? k : 0.7 + Math.random() * 0.3);
    m.scale.set(w, len, w);
    m.material.opacity = Math.min(1, k * 2);
  }

  // Ereignisse aus der Spiellogik als Effekte anzeigen
  function handleEvents(events) {
    for (const ev of events) {
      const base = ROAD_Y + (ev.x !== undefined ? bp(ev.x, ev.y) : 0);
      if (ev.type === "pop") {
        const x = wx(ev.x);
        const z = wz(ev.y);
        const n = ev.dead ? 7 : 4;
        for (let i = 0; i < n; i++) addSpark(x, base + 0.35, z, ev.color, ev.dead ? 2.2 : 1.4);
        if (ev.dead && Math.random() < 0.5) burstStars(x, base + 0.4, z, 1, ev.color);
      } else if (ev.type === "heavyDeath") {
        const x = wx(ev.x);
        const z = wz(ev.y);
        const big = ev.kind !== "tank";
        for (let i = 0; i < (big ? 60 : 24); i++) addSpark(x, base + 0.6, z, i % 3 ? ev.color : "#ffd740", big ? 4 : 2.6);
        burstStars(x, base + 0.8, z, big ? 20 : 8, "#ffffff");
      } else if (ev.type === "deflect") {
        for (let i = 0; i < 3; i++) addSpark(wx(ev.x), base + 0.4, wz(ev.y), "#ffffff", 1.6);
      } else if (ev.type === "regen") {
        burstStars(wx(ev.x), base + 0.5, wz(ev.y), 2, "#69f0ae");
      } else if (ev.type === "shatter") {
        for (let i = 0; i < 8; i++) addSpark(wx(ev.x), base + 0.4, wz(ev.y), "#c8f2ff", 2.4);
      }
    }
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
    m.position.set(wx(ring.x), ROAD_Y + 0.06 + bp(ring.x, ring.y), wz(ring.y));
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
    s.position.set(wx(t.x), 0.8 + (1 - k) * 0.6 + bp(t.x, t.y), wz(t.y));
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
    updateMood(dt);
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

    handleEvents(state.events);
    sync(state.towers, towerObjs, makeTower, updateTower);
    sync(state.enemies, enemyObjs, makeEnemy, updateEnemy);
    sync(state.ships, shipObjs, makeShip, updateShip);
    sync(state.projectiles, projectileObjs, makeProjectile, updateProjectile);
    sync(state.beams, beamObjs, makeBeam, updateBeam);
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
        tmpPos.set(wx(pa.x), ROAD_Y + pa.z / TILE + bp(pa.x, pa.y), wz(pa.y)),
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
      v.y = Math.max(ROAD_Y + gw(v.x, v.z), v.y + v.vy * dt);
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
        tmpMatrix.compose(tmpPos.set(p.x, ROAD_Y + 0.01 + bw(p.x, p.z), p.z), tmpQuat, tmpScale.set(1, 1, 1));
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
      rangeGroup.position.set(x, ROAD_Y + 0.03 + gw(x, z), z);
      rangeGroup.scale.setScalar(px / TILE);
    };

    // Hologramm-Raster der freien Bauplätze im Baumodus
    let n = 0;
    if (state.buildMode && !state.gameOver) {
      const flicker = 0.75 + Math.sin(realTime * 6) * 0.1 + (Math.random() < 0.03 ? -0.3 : 0);
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (grid[r][c] !== "pad" || towerAt(c, r)) continue;
          tmpMatrix.makeTranslation(tileX(c), PAD_TOP + 0.02 + gw(tileX(c), tileZ(r)), tileZ(r));
          holoFill.setMatrixAt(n, tmpMatrix);
          holoEdge.setMatrixAt(n, tmpMatrix);
          n++;
        }
      }
      holoEdge.material.opacity = flicker;
      holoFill.instanceMatrix.needsUpdate = holoEdge.instanceMatrix.needsUpdate = true;
    }
    holoFill.count = holoEdge.count = n;

    // Vorschau des 2×2-Bauplatzes unter dem Mauszeiger
    const hov = state.hoverTile;
    hoverMesh.scale.setScalar(1);
    if (hov && state.buildMode && !state.gameOver) {
      const spot = buildAnchor(hov.px, hov.py);
      const ok = canBuild(spot.col, spot.row);
      const cx = spot.col + 1 - COLS / 2;
      const cz = spot.row + 1 - ROWS / 2;
      hoverMesh.visible = true;
      hoverMesh.scale.setScalar(2.1);
      hoverMesh.material.color.set(ok ? "#ffffff" : "#ff2a4a").multiplyScalar(1.5);
      hoverMesh.position.set(cx, PAD_TOP + 0.03 + gw(cx, cz), cz);
      if (ok) showRange(cx, cz, TOWER_TYPES[state.selectedType].base.range);
    }

    const sel = state.selected;
    const pulse = 1.3 + Math.sin(realTime * 5) * 0.4;
    selectMesh.scale.setScalar(1);
    if (sel && sel.kind === "tower") {
      showRange(wx(sel.tower.x), wz(sel.tower.y), towerStats(sel.tower).range);
      selectMesh.visible = true;
      selectMesh.scale.setScalar(2.1);
      selectMesh.position.set(wx(sel.tower.x), PAD_TOP + 0.03 + towerGround(sel.tower.x, sel.tower.y), wz(sel.tower.y));
    } else if (sel && sel.kind === "obstacle") {
      selectMesh.visible = true;
      selectMesh.position.set(tileX(sel.col), PAD_TOP + 0.03 + gw(tileX(sel.col), tileZ(sel.row)), tileZ(sel.row));
    }
    selectMesh.material.color.set("#ffd740").multiplyScalar(pulse);

    // Upgrade-Vorschau: neue Reichweite in Pink
    const pv = state.preview;
    previewRing.visible = !!(pv && pv.range && state.towers.includes(pv.tower));
    if (previewRing.visible) {
      previewRing.position.set(wx(pv.tower.x), ROAD_Y + 0.035 + towerGround(pv.tower.x, pv.tower.y), wz(pv.tower.y));
      previewRing.scale.setScalar(pv.range / TILE);
    }
  }

  // Vorschaubild eines Turms mit bestimmten Ausbaustufen (für das Upgrade-Fenster), als Bild-URL
  const previewCache = new Map();
  let previewKit = null;
  function towerPreview(type, levels, size = 220) {
    const key = `${type}|${levels.join("")}|${size}`;
    if (previewCache.has(key)) return previewCache.get(key);
    const S = size * 2;
    if (!previewKit || previewKit.S !== S) {
      const sc = new THREE.Scene();
      sc.environment = scene.environment;
      sc.add(new THREE.HemisphereLight("#b89bff", "#2a0b30", 0.9));
      const sun = new THREE.DirectionalLight("#ffb09a", 1.1);
      sun.position.set(3, 5, 4);
      const rim = new THREE.DirectionalLight("#38e8ff", 1.0);
      rim.position.set(-4, 3, -3);
      sc.add(sun, rim);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      previewKit = {
        S, sc, canvas,
        cam: new THREE.PerspectiveCamera(30, 1, 0.1, 50),
        rt: new THREE.WebGLRenderTarget(S, S),
        buf: new Uint8Array(S * S * 4),
        big: Object.assign(document.createElement("canvas"), { width: S, height: S }),
      };
    }
    const k = previewKit;
    const m = Towers.build(type, levels, { preview: true });
    Towers.animate(m, 1.2, 0);
    if (m.aims) m.head.rotation.y = 0.5;
    k.sc.add(m.root);
    const box = new THREE.Box3().setFromObject(m.root);
    const c = box.getCenter(new THREE.Vector3());
    const d = box.getSize(new THREE.Vector3()).length();
    k.cam.position.set(c.x + d * 0.9, c.y + d * 0.55, c.z + d * 1.35);
    k.cam.lookAt(c);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearAlpha();
    renderer.setRenderTarget(k.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(k.sc, k.cam);
    renderer.readRenderTargetPixels(k.rt, 0, 0, S, S, k.buf);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevClear);
    k.sc.remove(m.root);
    disposeObject(m.root);
    // Bild umdrehen (WebGL liest von unten nach oben) und verkleinern (glatte Kanten)
    const bg = k.big.getContext("2d");
    const img = bg.createImageData(S, S);
    for (let y = 0; y < S; y++) img.data.set(k.buf.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
    bg.putImageData(img, 0, 0);
    const g2 = k.canvas.getContext("2d");
    g2.clearRect(0, 0, size, size);
    g2.drawImage(k.big, 0, 0, size, size);
    const url = k.canvas.toDataURL("image/png");
    previewCache.set(key, url);
    return url;
  }

  // Für Tests und Vorschaubilder: Kamera auf einen Punkt richten
  function lookAt(pos, target) {
    camera.position.set(...pos);
    controls.target.set(...target);
    controls.update();
  }

  return { init, buildMap, removeObstacle, render, resetCamera, setMenuMode, lookAt, towerPreview, debugTop: () => { const list = []; scene.traverse((o) => { if (o.isMesh && o.visible) { const g = o.geometry; list.push([Math.round(((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.count || 1)), g.type, o.parent && o.parent.type]); } }); return list.sort((a, b) => b[0] - a[0]).slice(0, 15); }, debugStats: () => { let meshes = 0; let tris = 0; scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.visible) { meshes++; const g = o.geometry; if (g) tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.count || 1); } }); return { meshes, tris: Math.round(tris) }; }, debugMood: (force) => { if (force) moodT = state.wave; return { moodT, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; } };
})();
