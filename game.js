"use strict";

// Spiellogik. Positionen werden in "Pixeln" auf einem 800×480-Raster gerechnet
// (40 px pro Feld); scene.js übersetzt sie in 3D-Koordinaten.

// ---------- Grundeinstellungen ----------
const TILE = 40;
const COLS = 20;
const ROWS = 12;
const MAX_PATH_LEVEL = 3;
const MAP_SEED = 1337;
const FINAL_WAVE = 30;

const ui = {
  lives: document.getElementById("lives"),
  gold: document.getElementById("gold"),
  wave: document.getElementById("wave"),
  startWave: document.getElementById("startWave"),
  speed: document.getElementById("speed"),
  resetCamera: document.getElementById("resetCamera"),
  shop: document.getElementById("shop"),
  info: document.getElementById("info"),
  legend: document.getElementById("legend"),
  overlay: document.getElementById("overlay"),
  banner: document.getElementById("banner"),
};

// Zwei Startwege, die sich bei (6,6) zu einem gemeinsamen Weg vereinen.
// Wegpunkte in Feld-Koordinaten (Spalte, Zeile).
const SHARED_PATH = [[6, 6], [11, 6], [11, 3], [16, 3], [16, 9], [20, 9]];
const PATHS = [
  [[-1, 2], [6, 2], ...SHARED_PATH],
  [[-1, 10], [6, 10], ...SHARED_PATH],
];

// Energiebecken: hier kann niemals gebaut werden
const POOLS = [
  [[8, 8], [9, 8], [10, 8], [8, 9], [9, 9], [10, 9], [9, 10]],
  [[1, 5], [2, 5], [1, 6], [2, 6], [3, 6], [2, 7]],
  [[17, 0], [18, 0], [18, 1]],
];

// Stadttor am Ende des Weges (hier starten auch die Raumschiffe)
const GATE_TILES = [[19, 8], [19, 10]];

// Hindernisse, die man gegen Gold entfernen kann
const OBSTACLES = {
  kiosk: { name: "Holo-Kiosk", clearCost: 15, count: 22 },
  crate: { name: "Frachtcontainer", clearCost: 30, count: 14 },
};

const TOWER_TYPES = {
  laser: {
    name: "Laserturm", cost: 50, range: 110, damage: 10, fireRate: 0.55,
    color: "#29e6ff", projectileSpeed: 520, upgrades: ["range", "damage"],
    desc: "Schnelle Laserschüsse auf einzelne Ziele.",
  },
  plasma: {
    name: "Plasmawerfer", cost: 90, range: 95, damage: 26, fireRate: 1.5,
    color: "#ff8a3d", projectileSpeed: 280, splash: 50, upgrades: ["range", "damage"],
    desc: "Langsam, aber Flächenschaden – stark gegen Panzerung.",
  },
  cryo: {
    name: "Kryoturm", cost: 70, range: 85, damage: 4, fireRate: 0.9,
    color: "#b388ff", projectileSpeed: 360, slow: 0.5, slowTime: 1.6, upgrades: ["range", "damage"],
    desc: "Verlangsamt Gegner.",
  },
  station: {
    name: "Raumstation", cost: 220, range: 0, damage: 0, fireRate: 0,
    color: "#ff4fd8", upgrades: ["shipHp", "frequency", "explosion"],
    unlockWave: 8, upgradeUnlockWave: 12,
    desc: "Schickt Raumschiffe vom Stadttor den Weg entlang. Sie halten Gegner auf und explodieren, wenn sie zerstört werden.",
  },
};

// Ausbaupfade (jeweils bis Stufe 3)
const UPGRADE_PATHS = {
  range: { name: "Reichweite", color: "#4fc3f7", costFactor: 0.5 },
  damage: { name: "Schaden", color: "#ff5252", costFactor: 0.7 },
  shipHp: { name: "Schiffsleben", color: "#69f0ae", costFactor: 0.45 },
  frequency: { name: "Häufigkeit", color: "#ffd740", costFactor: 0.55 },
  explosion: { name: "Explosionskraft", color: "#ff9100", costFactor: 0.5 },
};

// children: Gegner, die beim Zerstören freigesetzt werden
const ENEMY_TYPES = {
  nanobot: {
    name: "Nanobot", hp: 7, speed: 75, reward: 1, radius: 6,
    color: "#b2ffd6", desc: "Klein und flink.",
  },
  scout: {
    name: "Späher-Gleiter", hp: 12, speed: 105, reward: 2, radius: 8,
    color: "#ffe14d", desc: "Sehr schnell.",
  },
  spark: {
    name: "Plasmafunke", hp: 10, speed: 125, reward: 2, radius: 6,
    color: "#5ff4ff", slowImmune: true, desc: "Blitzschnell, immun gegen Kälte.",
  },
  liquid: {
    name: "Flüssigmetall", hp: 22, speed: 48, reward: 5, radius: 11,
    color: "#7dffb0", children: [["nanobot", 2]], desc: "Zerfällt in Nanobots.",
  },
  crawler: {
    name: "Panzer-Crawler", hp: 55, speed: 40, reward: 6, radius: 13,
    color: "#c9a27a", armor: 3, lifeDamage: 2, children: [["scout", 3]],
    desc: "Gepanzert (−3 Schaden pro Treffer).",
  },
  cloak: {
    name: "Tarndrohne", hp: 32, speed: 62, reward: 5, radius: 11,
    color: "#a6b8ff", slowImmune: true, children: [["spark", 3]],
    desc: "Hologramm-Tarnung, immun gegen Kälte.",
  },
  repair: {
    name: "Reparaturdrohne", hp: 45, speed: 44, reward: 8, radius: 12,
    color: "#ff8fd0", heal: { radius: 70, percent: 0.1, interval: 1.5 },
    children: [["nanobot", 2]], desc: "Repariert Gegner in der Nähe.",
  },
  titan: {
    name: "Titan-Mech", hp: 260, speed: 26, reward: 30, radius: 18,
    color: "#9aa7c7", armor: 6, lifeDamage: 5,
    children: [["crawler", 2], ["liquid", 2]], desc: "Schwerer Kampfroboter, stark gepanzert.",
  },
  omega: {
    name: "Omega-Koloss", hp: 34000, fixedHp: true, speed: 14, reward: 500, radius: 34,
    color: "#e0e6ff", armor: 8, lifeDamage: 100,
    children: [["titan", 3], ["crawler", 4]],
    desc: "Endboss in Welle 30. Wer ihn besiegt, gewinnt.",
  },
};

// ---------- Zufall mit festem Startwert (gleiche Karte bei jedem Spiel) ----------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Weg vorberechnen (Ecken abgerundet) ----------
function roundedPath(waypoints, radius = TILE * 0.3, steps = 5) {
  const pts = waypoints.map(([c, r]) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 }));
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const p = pts[i];
    const b = pts[i + 1];
    const inLen = Math.hypot(p.x - a.x, p.y - a.y);
    const outLen = Math.hypot(b.x - p.x, b.y - p.y);
    const din = { x: (p.x - a.x) / inLen, y: (p.y - a.y) / inLen };
    const dout = { x: (b.x - p.x) / outLen, y: (b.y - p.y) / outLen };
    if (Math.abs(din.x * dout.y - din.y * dout.x) < 1e-6) {
      out.push(p);
      continue;
    }
    const s = { x: p.x - din.x * radius, y: p.y - din.y * radius };
    const e = { x: p.x + dout.x * radius, y: p.y + dout.y * radius };
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      out.push({
        x: u * u * s.x + 2 * u * t * p.x + t * t * e.x,
        y: u * u * s.y + 2 * u * t * p.y + t * t * e.y,
      });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const pathPoints = PATHS.map((path) => roundedPath(path));
const shipPaths = pathPoints.map((pts) => [...pts].reverse());

const pathTiles = new Set();
for (const path of PATHS) {
  for (let i = 0; i < path.length - 1; i++) {
    let [c, r] = path[i];
    const [c2, r2] = path[i + 1];
    const dc = Math.sign(c2 - c);
    const dr = Math.sign(r2 - r);
    pathTiles.add(`${c},${r}`);
    while (c !== c2 || r !== r2) {
      c += dc;
      r += dr;
      pathTiles.add(`${c},${r}`);
    }
  }
}

// ---------- Karte ----------
// grid[row][col]: "pad" | "path" | "pool" | "gate" | "kiosk" | "crate"
let grid;
let variant; // Zufallswert je Feld für unterschiedliches Aussehen

function buildGrid() {
  const rng = mulberry32(MAP_SEED);
  grid = [];
  variant = [];
  for (let r = 0; r < ROWS; r++) {
    grid.push(new Array(COLS).fill("pad"));
    variant.push(Array.from({ length: COLS }, () => rng()));
  }
  for (const key of pathTiles) {
    const [c, r] = key.split(",").map(Number);
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS) grid[r][c] = "path";
  }
  for (const pool of POOLS) for (const [c, r] of pool) grid[r][c] = "pool";
  for (const [c, r] of GATE_TILES) grid[r][c] = "gate";

  const nearPath = (c, r) => {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (pathTiles.has(`${c + dc},${r + dr}`)) return true;
      }
    }
    return false;
  };

  for (const [kind, def] of Object.entries(OBSTACLES)) {
    let placed = 0;
    let tries = 0;
    while (placed < def.count && tries < 2000) {
      tries++;
      const c = Math.floor(rng() * COLS);
      const r = Math.floor(rng() * ROWS);
      if (grid[r][c] !== "pad") continue;
      // Felder direkt am Weg bleiben meistens frei
      if (nearPath(c, r) && rng() < 0.7) continue;
      grid[r][c] = kind;
      placed++;
    }
  }
}

// ---------- Spielzustand ----------
let state;

function resetGame() {
  buildGrid();
  state = {
    lives: 20,
    gold: 180,
    wave: 0,
    towers: [],
    enemies: [],
    ships: [],
    projectiles: [],
    particles: [],
    texts: [],
    rings: [],
    spawnQueue: [],
    spawnTimer: 0,
    spawnCount: 0,
    waveActive: false,
    selectedType: "laser",
    buildMode: false, // Turm aus dem Shop gewählt, Raster wird angezeigt
    selected: null, // { kind: "tower", tower } | { kind: "obstacle", col, row }
    hoverTile: null,
    speed: 1,
    gameOver: false,
    won: false,
    time: 0,
    frame: 0,
  };
  View.buildMap();
  ui.speed.textContent = "Tempo: 1x";
  ui.overlay.hidden = true;
  renderShop();
  updateHud();
  setInfo("Wähle einen Turm und klicke auf ein freies Feld. Kioske und Container kannst du anklicken und entfernen.");
}

// ---------- Wellen ----------
function buildWave(n) {
  if (n === FINAL_WAVE) {
    // Endboss mit Begleitschutz
    const escort = [];
    for (let i = 0; i < 10; i++) escort.push(i % 2 ? "crawler" : "repair");
    return [...escort, "omega", "titan", "titan"];
  }
  const groups = [
    ["liquid", 4 + Math.floor(n * 0.8)],
    ["scout", n >= 2 ? Math.floor(n * 0.9) : 0],
    ["crawler", n >= 3 ? Math.floor((n - 1) / 2.5) : 0],
    ["cloak", n >= 4 ? Math.floor((n - 2) / 3) : 0],
    ["repair", n >= 5 ? Math.floor((n - 3) / 3) : 0],
  ];
  // Gruppen abwechselnd mischen
  const queue = [];
  let added = true;
  while (added) {
    added = false;
    for (const g of groups) {
      if (g[1] > 0) {
        queue.push(g[0]);
        g[1]--;
        added = true;
      }
    }
  }
  if (n % 5 === 0) for (let i = 0; i < n / 5; i++) queue.push("titan");
  return queue;
}

function startWave() {
  if (state.waveActive || state.gameOver) return;
  state.wave++;
  state.spawnQueue = buildWave(state.wave);
  state.spawnTimer = 0;
  state.waveActive = true;
  if (state.wave === FINAL_WAVE) showBanner("⚠ BOSS-WELLE ⚠", "Der Omega-Koloss greift an!");
  else if (state.wave === TOWER_TYPES.station.unlockWave) showBanner(`Welle ${state.wave}`, "Raumstation freigeschaltet!");
  else if (state.wave === TOWER_TYPES.station.upgradeUnlockWave) showBanner(`Welle ${state.wave}`, "Raumstation-Verbesserungen freigeschaltet!");
  else showBanner(`Welle ${state.wave}`, state.wave % 5 === 0 ? "Titan-Mechs im Anmarsch!" : "");
  renderShop();
  updateHud();
}

function hpScale() {
  const w = state.wave - 1;
  return 1 + 0.15 * w + 0.018 * w * w;
}

function createEnemy(typeKey, pathIndex) {
  const type = ENEMY_TYPES[typeKey];
  const hp = Math.round(type.fixedHp ? type.hp : type.hp * hpScale());
  const start = pathPoints[pathIndex][0];
  return {
    type: typeKey,
    def: type,
    path: pathIndex,
    x: start.x,
    y: start.y,
    target: 1,
    dist: 0,
    dir: 0,
    hp,
    maxHp: hp,
    reward: type.reward + Math.floor(state.wave / 4),
    slowUntil: 0,
    slowFactor: 1,
    healTimer: type.heal ? type.heal.interval : 0,
    flash: 0,
    wait: 0,
    blockedFrame: -1,
    wobble: Math.random() * Math.PI * 2,
    dead: false,
  };
}

function spawnChildren(parent) {
  let i = 0;
  for (const [typeKey, count] of parent.def.children || []) {
    for (let k = 0; k < count; k++) {
      const child = createEnemy(typeKey, parent.path);
      child.x = parent.x + (Math.random() - 0.5) * 8;
      child.y = parent.y + (Math.random() - 0.5) * 8;
      child.target = parent.target;
      child.dist = parent.dist;
      child.dir = parent.dir;
      child.wait = i * 0.18; // nacheinander loslaufen
      state.enemies.push(child);
      i++;
    }
  }
}

// ---------- Türme ----------
function towerStats(tower) {
  const base = TOWER_TYPES[tower.type];
  const lv = tower.levels;
  if (tower.type === "station") {
    return {
      ...base,
      shipHp: 120 * (1 + 0.7 * lv.shipHp),
      interval: 8 / (1 + 0.45 * lv.frequency),
      explosion: 90 * (1 + 0.8 * lv.explosion),
      blastRadius: 60 * (1 + 0.15 * lv.explosion),
      ramDps: 25 * (1 + 0.3 * lv.explosion),
    };
  }
  const s = {
    ...base,
    range: base.range * (1 + 0.18 * lv.range),
    damage: base.damage * (1 + 0.45 * lv.damage),
  };
  if (base.slow) {
    s.slow = Math.max(0.25, base.slow - 0.08 * lv.damage); // stärkere Verlangsamung
    s.slowTime = base.slowTime + 0.4 * lv.range;
  }
  if (base.splash) s.splash = base.splash * (1 + 0.1 * lv.range);
  return s;
}

function isUnlocked(typeKey) {
  return state.wave >= (TOWER_TYPES[typeKey].unlockWave || 0);
}

function upgradesUnlocked(tower) {
  return state.wave >= (TOWER_TYPES[tower.type].upgradeUnlockWave || 0);
}

function upgradeCost(tower, path) {
  const factor = UPGRADE_PATHS[path].costFactor;
  return Math.round(TOWER_TYPES[tower.type].cost * factor * (tower.levels[path] + 1));
}

function sellValue(tower) {
  return Math.floor(tower.invested * 0.6);
}

function towerAt(col, row) {
  return state.towers.find((t) => t.col === col && t.row === row) || null;
}

function canBuild(col, row) {
  return (
    col >= 0 && col < COLS && row >= 0 && row < ROWS &&
    grid[row][col] === "pad" && !towerAt(col, row)
  );
}

function cancelBuild() {
  if (!state.buildMode) return;
  state.buildMode = false;
  renderShop();
  setInfo("Bauen abgebrochen.");
}

function placeTower(col, row) {
  const type = TOWER_TYPES[state.selectedType];
  if (!canBuild(col, row)) return;
  if (!isUnlocked(state.selectedType)) {
    setInfo(`${type.name} wird ab Welle ${type.unlockWave} freigeschaltet.`);
    return;
  }
  if (state.gold < type.cost) {
    setInfo(`Nicht genug Gold für ${type.name} (${type.cost} 💰).`);
    return;
  }
  state.gold -= type.cost;
  const levels = {};
  for (const p of type.upgrades) levels[p] = 0;
  state.towers.push({
    type: state.selectedType,
    col, row,
    x: col * TILE + TILE / 2,
    y: row * TILE + TILE / 2,
    levels,
    cooldown: state.selectedType === "station" ? 2 : 0,
    invested: type.cost,
    angle: 0,
    recoil: 0,
    shipCount: 0,
  });
  puff(col * TILE + TILE / 2, row * TILE + TILE / 2, type.color, 12);
  updateHud();
}

function upgradeSelected(path) {
  const t = selectedTower();
  if (!t || t.levels[path] >= MAX_PATH_LEVEL || !upgradesUnlocked(t)) return;
  const cost = upgradeCost(t, path);
  if (state.gold < cost) return;
  state.gold -= cost;
  t.invested += cost;
  t.levels[path]++;
  puff(t.x, t.y, UPGRADE_PATHS[path].color, 16, 30);
  updateHud();
  showTowerInfo(t);
}

function sellSelected() {
  const t = selectedTower();
  if (!t) return;
  state.gold += sellValue(t);
  state.towers = state.towers.filter((x) => x !== t);
  state.selected = null;
  puff(t.x, t.y, "#d0d8ff", 12);
  updateHud();
  setInfo("Turm verkauft.");
}

function selectedTower() {
  return state.selected && state.selected.kind === "tower" ? state.selected.tower : null;
}

function clearObstacle() {
  const s = state.selected;
  if (!s || s.kind !== "obstacle") return;
  const kind = grid[s.row][s.col];
  const def = OBSTACLES[kind];
  if (!def || state.gold < def.clearCost) return;
  state.gold -= def.clearCost;
  puff(s.col * TILE + TILE / 2, s.row * TILE + TILE / 2, kind === "kiosk" ? "#ff4fd8" : "#29e6ff", 18, 20);
  grid[s.row][s.col] = "pad";
  View.removeObstacle(s.col, s.row);
  state.selected = null;
  updateHud();
  setInfo(`${def.name} entfernt – hier kannst du jetzt bauen.`);
}

// ---------- Raumschiffe der Raumstation ----------
function launchShip(station) {
  const s = towerStats(station);
  const path = station.shipCount % shipPaths.length;
  station.shipCount++;
  const start = shipPaths[path][0];
  state.ships.push({
    station,
    path,
    x: start.x,
    y: start.y,
    target: 1,
    dir: Math.PI,
    hp: s.shipHp,
    maxHp: s.shipHp,
    explosion: s.explosion,
    blastRadius: s.blastRadius,
    ramDps: s.ramDps,
    speed: 60,
    radius: 12,
    flash: 0,
    contact: false,
    dead: false,
  });
}

function explodeShip(ship) {
  ship.dead = true;
  state.rings.push({ x: ship.x, y: ship.y, r: ship.blastRadius, life: 0.45, max: 0.45, color: "#ff9100" });
  puff(ship.x, ship.y, "#ffd740", 20, 50);
  puff(ship.x, ship.y, "#ff4fd8", 12, 40);
  for (const e of state.enemies) {
    if (!e.dead && Math.hypot(e.x - ship.x, e.y - ship.y) <= ship.blastRadius) {
      damage(e, ship.explosion);
    }
  }
}

function updateShips(dt) {
  for (const ship of state.ships) {
    if (ship.dead) continue;
    ship.flash = Math.max(0, ship.flash - dt);
    // Kontakt mit Gegnern: Schiff stoppt, rammt und hält die Gegner auf
    ship.contact = false;
    for (const e of state.enemies) {
      if (e.dead || e.wait > 0) continue;
      if (Math.hypot(e.x - ship.x, e.y - ship.y) > ship.radius + e.def.radius) continue;
      ship.contact = true;
      e.blockedFrame = state.frame;
      damage(e, ship.ramDps * dt, true);
      ship.hp -= (10 + e.maxHp * 0.25) * dt;
      ship.flash = 0.05;
    }
    if (ship.hp <= 0) {
      explodeShip(ship);
      continue;
    }
    if (ship.contact) continue;
    const pts = shipPaths[ship.path];
    let move = ship.speed * dt;
    while (move > 0 && ship.target < pts.length) {
      const p = pts[ship.target];
      const dx = p.x - ship.x;
      const dy = p.y - ship.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.01) ship.dir = Math.atan2(dy, dx);
      if (dist <= move) {
        ship.x = p.x;
        ship.y = p.y;
        move -= dist;
        ship.target++;
      } else {
        ship.x += (dx / dist) * move;
        ship.y += (dy / dist) * move;
        move = 0;
      }
    }
    // Am Ende des Weges angekommen: Selbstzerstörung
    if (ship.target >= pts.length) explodeShip(ship);
  }
}

// ---------- Update ----------
function update(dt) {
  if (state.gameOver) return;
  state.time += dt;
  state.frame++;
  const now = state.time;

  // Gegner erzeugen (abwechselnd auf beiden Wegen)
  if (state.spawnQueue.length > 0) {
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      const path = state.spawnCount % PATHS.length;
      state.enemies.push(createEnemy(state.spawnQueue.shift(), path));
      state.spawnCount++;
      state.spawnTimer = Math.max(0.3, 0.85 - state.wave * 0.02);
    }
  }

  updateShips(dt);

  // Gegner bewegen und Fähigkeiten
  for (const e of state.enemies) {
    if (e.dead) continue;
    e.flash = Math.max(0, e.flash - dt);
    e.wobble += dt * 6;
    if (e.slowUntil < now) e.slowFactor = 1;

    if (e.def.heal) {
      e.healTimer -= dt;
      if (e.healTimer <= 0) {
        e.healTimer = e.def.heal.interval;
        healAround(e);
      }
    }

    if (e.wait > 0) {
      e.wait -= dt;
      continue;
    }
    if (e.blockedFrame === state.frame) continue; // von einem Raumschiff aufgehalten

    const pts = pathPoints[e.path];
    let move = e.def.speed * e.slowFactor * dt;
    while (move > 0 && e.target < pts.length) {
      const p = pts[e.target];
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.01) e.dir = Math.atan2(dy, dx);
      if (dist <= move) {
        e.x = p.x;
        e.y = p.y;
        move -= dist;
        e.dist += dist;
        e.target++;
      } else {
        e.x += (dx / dist) * move;
        e.y += (dy / dist) * move;
        e.dist += move;
        move = 0;
      }
    }
    if (e.target >= pts.length) {
      e.dead = true;
      state.lives -= e.def.lifeDamage || 1;
      if (state.lives <= 0) {
        state.lives = 0;
        endGame(false);
      }
    }
  }

  // Türme schießen bzw. Raumstationen starten Schiffe
  const fighting = state.enemies.length > 0;
  for (const t of state.towers) {
    const s = towerStats(t);
    t.cooldown -= dt;
    t.recoil = Math.max(0, t.recoil - dt * 4);
    if (t.type === "station") {
      if (fighting && t.cooldown <= 0) {
        t.cooldown = s.interval;
        t.recoil = 1;
        launchShip(t);
      }
      continue;
    }
    const target = findTarget(t, s.range);
    if (target) t.angle = Math.atan2(target.y - t.y, target.x - t.x);
    if (target && t.cooldown <= 0) {
      t.cooldown = s.fireRate;
      t.recoil = 1;
      const sx = t.x + Math.cos(t.angle) * 16;
      const sy = t.y + Math.sin(t.angle) * 16;
      state.projectiles.push({
        x: sx, y: sy, sx, sy,
        tx: target.x, ty: target.y,
        target, stats: s, kind: t.type,
        angle: t.angle,
      });
    }
  }

  // Projektile
  for (const p of state.projectiles) {
    if (!p.target.dead) {
      p.tx = p.target.x;
      p.ty = p.target.y;
    }
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const dist = Math.hypot(dx, dy);
    const step = p.stats.projectileSpeed * dt;
    p.angle = Math.atan2(dy, dx);
    if (dist <= step) {
      p.done = true;
      hit(p, now);
    } else {
      p.x += (dx / dist) * step;
      p.y += (dy / dist) * step;
      if (p.kind === "cryo" && Math.random() < 0.5) {
        state.particles.push(particle(p.x, p.y, 22, "#e1f5fe", 0.3, 10, 0));
      }
    }
  }

  // Effekte (z = Höhe über dem Boden in Pixeln)
  for (const pa of state.particles) {
    pa.life -= dt;
    pa.x += pa.vx * dt;
    pa.y += pa.vy * dt;
    pa.z = Math.max(0, pa.z + pa.vz * dt);
    pa.vz -= 160 * dt * pa.gravity;
    pa.vx *= 0.94;
    pa.vy *= 0.94;
  }
  for (const tx of state.texts) tx.life -= dt;
  for (const ring of state.rings) ring.life -= dt;

  state.enemies = state.enemies.filter((e) => !e.dead);
  state.ships = state.ships.filter((s) => !s.dead);
  state.projectiles = state.projectiles.filter((p) => !p.done);
  state.particles = state.particles.filter((p) => p.life > 0);
  state.texts = state.texts.filter((t) => t.life > 0);
  state.rings = state.rings.filter((r) => r.life > 0);

  // Welle beendet?
  if (!state.gameOver && state.waveActive && state.spawnQueue.length === 0 && state.enemies.length === 0) {
    state.waveActive = false;
    if (state.wave >= FINAL_WAVE) {
      endGame(true);
    } else {
      const bonus = 15 + state.wave * 3;
      state.gold += bonus;
      setInfo(`Welle ${state.wave} geschafft! +${bonus} 💰 Bonus.`);
      renderShop();
    }
  }

  updateHud();
}

function endGame(won) {
  state.gameOver = true;
  state.won = won;
  state.ships = [];
  if (won) {
    setInfo(`🏆 Gewonnen! Du hast alle ${FINAL_WAVE} Wellen und den Omega-Koloss besiegt. <button id="restart">Neu starten</button>`);
    ui.overlay.innerHTML = "<span>GEWONNEN!</span>";
    ui.overlay.className = "won";
  } else {
    const survived = state.wave - 1;
    setInfo(`Game Over! Du hast ${survived} ${survived === 1 ? "Welle" : "Wellen"} überlebt. <button id="restart">Neu starten</button>`);
    ui.overlay.innerHTML = "<span>GAME OVER</span>";
    ui.overlay.className = "";
  }
  document.getElementById("restart").onclick = resetGame;
  ui.overlay.hidden = false;
}

function healAround(healer) {
  const h = healer.def.heal;
  state.rings.push({ x: healer.x, y: healer.y, r: h.radius, life: 0.5, max: 0.5, color: "#69f0ae" });
  for (const e of state.enemies) {
    if (e.dead || e.hp >= e.maxHp) continue;
    if (Math.hypot(e.x - healer.x, e.y - healer.y) <= h.radius) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * h.percent);
      state.particles.push(particle(e.x, e.y, e.def.radius * 2, "#69f0ae", 0.6, 10, -0.3));
    }
  }
}

function findTarget(tower, range) {
  // Gegner, der am weitesten gelaufen ist
  let best = null;
  for (const e of state.enemies) {
    if (e.dead || e.wait > 0) continue;
    if (Math.hypot(e.x - tower.x, e.y - tower.y) > range) continue;
    if (!best || e.dist > best.dist) best = e;
  }
  return best;
}

function hit(p, now) {
  const s = p.stats;
  if (s.splash) {
    state.rings.push({ x: p.tx, y: p.ty, r: s.splash, life: 0.35, max: 0.35, color: "#ff8a3d" });
    puff(p.tx, p.ty, "#ffb74d", 14, 40);
    puff(p.tx, p.ty, "#ff4fd8", 6, 30);
    for (const e of state.enemies) {
      if (!e.dead && Math.hypot(e.x - p.tx, e.y - p.ty) <= s.splash) {
        damage(e, s.damage);
      }
    }
    return;
  }
  if (p.target.dead) return;
  damage(p.target, s.damage);
  if (s.slow && !p.target.dead && !p.target.def.slowImmune) {
    p.target.slowFactor = s.slow;
    p.target.slowUntil = now + s.slowTime;
    puff(p.tx, p.ty, "#b3e5fc", 5);
  } else {
    puff(p.tx, p.ty, p.stats.color, 3);
  }
}

// continuous = Dauerschaden (z. B. Rammen); dabei keine Rüstung pro Treffer
function damage(e, amount, continuous = false) {
  const real = continuous ? amount : Math.max(1, amount - (e.def.armor || 0));
  e.hp -= real;
  if (!continuous) e.flash = 0.08;
  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    state.gold += e.reward;
    state.texts.push({ x: e.x, y: e.y, text: `+${e.reward}`, life: 0.9, max: 0.9 });
    puff(e.x, e.y, e.def.color, 10 + e.def.radius, 40);
    spawnChildren(e);
  }
}

function particle(x, y, z, color, life, speed, gravity) {
  const a = Math.random() * Math.PI * 2;
  const v = Math.random() * speed;
  return {
    x, y, z,
    vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 20 + Math.random() * speed,
    color, life, max: life, gravity,
  };
}

function puff(x, y, color, n, up = 15) {
  for (let i = 0; i < n; i++) {
    state.particles.push(particle(x, y, up * 0.5, color, 0.4 + Math.random() * 0.4, 90, 1));
  }
}

// ---------- UI ----------
let bannerTimer = null;
function showBanner(title, subtitle) {
  ui.banner.innerHTML = `<div class="title">${title}</div>${subtitle ? `<div class="sub">${subtitle}</div>` : ""}`;
  ui.banner.classList.remove("show");
  void ui.banner.offsetWidth; // Animation neu starten
  ui.banner.classList.add("show");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => ui.banner.classList.remove("show"), 2600);
}

function updateHud() {
  ui.lives.textContent = state.lives;
  ui.gold.textContent = state.gold;
  ui.wave.textContent = `${state.wave} / ${FINAL_WAVE}`;
  ui.startWave.disabled = state.waveActive || state.gameOver;
  for (const btn of ui.shop.querySelectorAll("button")) {
    const key = btn.dataset.type;
    btn.disabled = !isUnlocked(key) || state.gold < TOWER_TYPES[key].cost;
  }
  const t = selectedTower();
  if (t) {
    for (const path of TOWER_TYPES[t.type].upgrades) {
      const btn = document.getElementById(`up-${path}`);
      if (btn) btn.disabled = !upgradesUnlocked(t) || state.gold < upgradeCost(t, path);
    }
  }
  const clearBtn = document.getElementById("clear");
  if (clearBtn && state.selected && state.selected.kind === "obstacle") {
    const def = OBSTACLES[grid[state.selected.row][state.selected.col]];
    clearBtn.disabled = !def || state.gold < def.clearCost;
  }
}

function renderShop() {
  ui.shop.innerHTML = "";
  for (const [key, t] of Object.entries(TOWER_TYPES)) {
    const btn = document.createElement("button");
    btn.dataset.type = key;
    btn.title = t.desc;
    const lock = isUnlocked(key) ? "" : ` 🔒 ab Welle ${t.unlockWave}`;
    btn.innerHTML = `<span class="swatch" style="background:${t.color};box-shadow:0 0 8px ${t.color}"></span>${t.name} (${t.cost} 💰)${lock}`;
    if (state.buildMode && key === state.selectedType) btn.classList.add("selected");
    btn.onclick = () => selectTowerType(key);
    ui.shop.appendChild(btn);
  }
}

function selectTowerType(key) {
  state.selectedType = key;
  state.buildMode = true;
  state.selected = null;
  renderShop();
  updateHud();
  const t = TOWER_TYPES[key];
  const lock = isUnlocked(key) ? "" : ` <b>Wird ab Welle ${t.unlockWave} freigeschaltet.</b>`;
  setInfo(`${t.name}: ${t.desc}${lock}<br><small>Klicke auf ein freies Feld im Raster. Umschalttaste gedrückt halten für mehrere Türme, Esc oder Rechtsklick bricht ab.</small>`);
}

function renderLegend() {
  ui.legend.innerHTML = Object.values(ENEMY_TYPES)
    .map((e) => {
      const inner = e.children
        ? ` Enthält: ${e.children.map(([k, n]) => `${n}× ${ENEMY_TYPES[k].name}`).join(", ")}.`
        : "";
      return `<div class="enemy"><span class="swatch" style="background:${e.color};box-shadow:0 0 8px ${e.color}"></span><b>${e.name}</b> – ${e.desc}${inner}</div>`;
    })
    .join("") +
    `<div class="enemy hint">Gegner haben keine Lebensanzeige: Je mehr Schaden sie nehmen, desto stärker verfärben sie sich, sprühen Funken, rauchen und verlieren Panzerteile.</div>`;
}

function setInfo(html) {
  ui.info.innerHTML = html;
}

function showTowerInfo(t) {
  const s = towerStats(t);
  const type = TOWER_TYPES[t.type];
  let html = `<b>${s.name}</b>`;
  if (t.type === "station") {
    html += ` · Schiffsleben ${Math.round(s.shipHp)} · alle ${s.interval.toFixed(1)} s ein Schiff · Explosion ${Math.round(s.explosion)} Schaden`;
  } else {
    html += ` · Schaden ${Math.round(s.damage)} · Reichweite ${Math.round(s.range)}`;
    if (s.slow) html += ` · Verlangsamung ${Math.round((1 - s.slow) * 100)} % für ${s.slowTime.toFixed(1)} s`;
  }
  html += "<br>";
  const unlocked = upgradesUnlocked(t);
  for (const path of type.upgrades) {
    const def = UPGRADE_PATHS[path];
    const lvl = t.levels[path];
    const pips = "●".repeat(lvl) + "○".repeat(MAX_PATH_LEVEL - lvl);
    if (lvl >= MAX_PATH_LEVEL) {
      html += `<button disabled style="--accent:${def.color}">${def.name} ${pips} max.</button> `;
    } else if (!unlocked) {
      html += `<button disabled style="--accent:${def.color}">${def.name} 🔒 ab Welle ${type.upgradeUnlockWave}</button> `;
    } else {
      html += `<button id="up-${path}" style="--accent:${def.color}">${def.name} ${pips} (${upgradeCost(t, path)} 💰)</button> `;
    }
  }
  html += `<button id="sell">Verkaufen (+${sellValue(t)} 💰)</button>`;
  setInfo(html);
  for (const path of type.upgrades) {
    const btn = document.getElementById(`up-${path}`);
    if (btn) btn.onclick = () => upgradeSelected(path);
  }
  document.getElementById("sell").onclick = sellSelected;
  updateHud();
}

function showObstacleInfo(col, row) {
  const def = OBSTACLES[grid[row][col]];
  setInfo(`<b>${def.name}</b> – blockiert dieses Feld. <button id="clear">Entfernen (${def.clearCost} 💰)</button>`);
  document.getElementById("clear").onclick = clearObstacle;
  updateHud();
}

// Wird von scene.js aufgerufen, wenn ein Feld angeklickt wurde
function handleTileClick(col, row, keepBuilding = false) {
  if (state.gameOver) return;
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
  const tower = towerAt(col, row);
  if (tower) {
    state.buildMode = false;
    renderShop();
    state.selected = { kind: "tower", tower };
    showTowerInfo(tower);
    return;
  }
  const cell = grid[row][col];
  if (OBSTACLES[cell]) {
    state.buildMode = false;
    renderShop();
    state.selected = { kind: "obstacle", col, row };
    showObstacleInfo(col, row);
    return;
  }
  state.selected = null;
  if (cell === "pool") setInfo("Auf einem Energiesee kann nicht gebaut werden.");
  else if (cell === "gate") setInfo("Das ist dein Stadttor – verteidige es!");
  else if (state.buildMode && canBuild(col, row)) {
    const before = state.towers.length;
    placeTower(col, row);
    if (state.towers.length > before && !keepBuilding) {
      state.buildMode = false;
      renderShop();
    }
  } else if (!state.buildMode) setInfo("Wähle unten einen Turm aus, um zu bauen.");
}

ui.startWave.addEventListener("click", startWave);

ui.speed.addEventListener("click", () => {
  state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 3 : 1;
  ui.speed.textContent = `Tempo: ${state.speed}x`;
});

ui.resetCamera.addEventListener("click", () => View.resetCamera());

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") cancelBuild();
  if (ev.key === " ") {
    ev.preventDefault();
    startWave();
  }
  const keys = Object.keys(TOWER_TYPES);
  const idx = Number(ev.key) - 1;
  if (idx >= 0 && idx < keys.length) selectTowerType(keys[idx]);
});

// ---------- Spielschleife ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  for (let i = 0; i < state.speed; i++) update(dt);
  View.render(dt);
  requestAnimationFrame(loop);
}

View.init(document.getElementById("view"));
renderLegend();
resetGame();
requestAnimationFrame(loop);
