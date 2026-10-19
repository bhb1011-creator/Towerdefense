"use strict";

// ---------- Grundeinstellungen ----------
const TILE = 40;
const COLS = 20;
const ROWS = 12;
const MAX_PATH_LEVEL = 3;
const MAP_SEED = 1337;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  lives: document.getElementById("lives"),
  gold: document.getElementById("gold"),
  wave: document.getElementById("wave"),
  startWave: document.getElementById("startWave"),
  speed: document.getElementById("speed"),
  shop: document.getElementById("shop"),
  info: document.getElementById("info"),
  legend: document.getElementById("legend"),
};

// Zwei Startwege, die sich bei (6,6) zu einem gemeinsamen Weg vereinen.
// Wegpunkte in Feld-Koordinaten (Spalte, Zeile).
const SHARED_PATH = [[6, 6], [11, 6], [11, 3], [16, 3], [16, 9], [20, 9]];
const PATHS = [
  [[-1, 2], [6, 2], ...SHARED_PATH],
  [[-1, 10], [6, 10], ...SHARED_PATH],
];

// Seen: hier kann niemals gebaut werden
const LAKES = [
  [[8, 8], [9, 8], [10, 8], [8, 9], [9, 9], [10, 9], [9, 10]],
  [[1, 5], [2, 5], [1, 6], [2, 6], [3, 6], [2, 7]],
  [[17, 0], [18, 0], [18, 1]],
];

// Burgmauern neben dem Ziel
const CASTLE_TILES = [[19, 8], [19, 10]];

// Hindernisse, die man gegen Gold entfernen kann
const OBSTACLES = {
  tree: { name: "Baum", clearCost: 15, count: 26 },
  rock: { name: "Felsen", clearCost: 30, count: 12 },
};

const TOWER_TYPES = {
  arrow: {
    name: "Pfeilturm", cost: 50, range: 110, damage: 10, fireRate: 0.55,
    color: "#4fc3f7", projectileSpeed: 480,
    desc: "Schnelle Schüsse auf einzelne Ziele.",
  },
  cannon: {
    name: "Kanone", cost: 90, range: 95, damage: 26, fireRate: 1.5,
    color: "#ff8a65", projectileSpeed: 280, splash: 50,
    desc: "Langsam, aber Flächenschaden – stark gegen Panzerung.",
  },
  frost: {
    name: "Frostturm", cost: 70, range: 85, damage: 4, fireRate: 0.9,
    color: "#b39ddb", projectileSpeed: 340, slow: 0.5, slowTime: 1.6,
    desc: "Verlangsamt Gegner.",
  },
};

// Ausbaupfade: jeder Turm kann beide Pfade bis Stufe 3 verbessern
const UPGRADE_PATHS = {
  range: { name: "Reichweite", color: "#4fc3f7", costFactor: 0.5 },
  damage: { name: "Schaden", color: "#ef5350", costFactor: 0.7 },
};

// children: Gegner, die beim Tod freigesetzt werden
const ENEMY_TYPES = {
  mini: {
    name: "Winzling", shape: "slime", hp: 7, speed: 75, reward: 1, radius: 6,
    color: "#a5d6a7", desc: "Klein und flink.",
  },
  runner: {
    name: "Flitzer", shape: "runner", hp: 12, speed: 105, reward: 2, radius: 8,
    color: "#ffee58", desc: "Sehr schnell.",
  },
  wisp: {
    name: "Irrlicht", shape: "wisp", hp: 10, speed: 125, reward: 2, radius: 6,
    color: "#80deea", slowImmune: true, desc: "Blitzschnell, immun gegen Frost.",
  },
  slime: {
    name: "Schleim", shape: "slime", hp: 22, speed: 48, reward: 5, radius: 11,
    color: "#66bb6a", children: [["mini", 2]], desc: "Teilt sich in Winzlinge.",
  },
  beetle: {
    name: "Käfer", shape: "beetle", hp: 55, speed: 40, reward: 6, radius: 13,
    color: "#8d6e63", armor: 3, lifeDamage: 2, children: [["runner", 3]],
    desc: "Gepanzert (−3 Schaden pro Treffer).",
  },
  ghost: {
    name: "Geist", shape: "ghost", hp: 32, speed: 62, reward: 5, radius: 11,
    color: "#eceff1", slowImmune: true, children: [["wisp", 3]],
    desc: "Immun gegen Frost.",
  },
  healer: {
    name: "Heiler", shape: "healer", hp: 45, speed: 44, reward: 8, radius: 12,
    color: "#f48fb1", heal: { radius: 70, percent: 0.1, interval: 1.5 },
    children: [["mini", 2]], desc: "Heilt Gegner in der Nähe.",
  },
  golem: {
    name: "Golem", shape: "golem", hp: 260, speed: 26, reward: 30, radius: 18,
    color: "#78909c", armor: 6, lifeDamage: 5,
    children: [["beetle", 2], ["slime", 2]], desc: "Boss, stark gepanzert.",
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

// ---------- Weg vorberechnen ----------
const pathPoints = PATHS.map((path) =>
  path.map(([c, r]) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 }))
);

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
// grid[row][col]: "grass" | "path" | "water" | "castle" | "tree" | "rock"
let grid;
let variant; // Zufallswert je Feld für unterschiedliches Aussehen

function buildGrid() {
  const rng = mulberry32(MAP_SEED);
  grid = [];
  variant = [];
  for (let r = 0; r < ROWS; r++) {
    grid.push(new Array(COLS).fill("grass"));
    variant.push(Array.from({ length: COLS }, () => rng()));
  }
  for (const key of pathTiles) {
    const [c, r] = key.split(",").map(Number);
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS) grid[r][c] = "path";
  }
  for (const lake of LAKES) for (const [c, r] of lake) grid[r][c] = "water";
  for (const [c, r] of CASTLE_TILES) grid[r][c] = "castle";

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
      if (grid[r][c] !== "grass") continue;
      // Felder direkt am Weg bleiben meistens frei
      if (nearPath(c, r) && rng() < 0.7) continue;
      grid[r][c] = kind;
      placed++;
    }
  }
}

// ---------- Hintergrund (einmal vorzeichnen, nur bei Änderungen neu) ----------
const bgCanvas = document.createElement("canvas");
bgCanvas.width = canvas.width;
bgCanvas.height = canvas.height;
const bg = bgCanvas.getContext("2d");

function renderBackground() {
  const rng = mulberry32(MAP_SEED + 7);
  const W = bgCanvas.width;
  const H = bgCanvas.height;

  // Gras mit Flecken
  const grad = bg.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#4a7d3f");
  grad.addColorStop(1, "#3f6e38");
  bg.fillStyle = grad;
  bg.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    const x = rng() * W;
    const y = rng() * H;
    bg.fillStyle = rng() < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.05)";
    bg.beginPath();
    bg.ellipse(x, y, 10 + rng() * 26, 6 + rng() * 14, rng() * Math.PI, 0, Math.PI * 2);
    bg.fill();
  }
  // Grashalme
  bg.strokeStyle = "rgba(30,60,25,0.55)";
  bg.lineWidth = 1;
  for (let i = 0; i < 700; i++) {
    const x = rng() * W;
    const y = rng() * H;
    bg.beginPath();
    bg.moveTo(x, y);
    bg.lineTo(x - 2, y - 4 - rng() * 3);
    bg.moveTo(x, y);
    bg.lineTo(x + 2, y - 4 - rng() * 3);
    bg.stroke();
  }
  // Blumen
  const flowerColors = ["#fff59d", "#ffffff", "#f8bbd0", "#ce93d8"];
  for (let i = 0; i < 90; i++) {
    const x = rng() * W;
    const y = rng() * H;
    bg.fillStyle = flowerColors[Math.floor(rng() * flowerColors.length)];
    bg.beginPath();
    bg.arc(x, y, 1.6, 0, Math.PI * 2);
    bg.fill();
  }

  // Weg: dunkler Rand, heller Belag, Kiesel
  for (const [width, color] of [[38, "#7a5a36"], [32, "#c9a46a"], [18, "#d4b27c"]]) {
    bg.strokeStyle = color;
    bg.lineWidth = width;
    bg.lineJoin = "round";
    bg.lineCap = "round";
    for (const pts of pathPoints) {
      bg.beginPath();
      pts.forEach((p, i) => (i === 0 ? bg.moveTo(p.x, p.y) : bg.lineTo(p.x, p.y)));
      bg.stroke();
    }
  }
  for (const key of pathTiles) {
    const [c, r] = key.split(",").map(Number);
    for (let i = 0; i < 4; i++) {
      const x = c * TILE + 6 + rng() * (TILE - 12);
      const y = r * TILE + 6 + rng() * (TILE - 12);
      bg.fillStyle = rng() < 0.5 ? "#a98552" : "#e2c594";
      bg.beginPath();
      bg.ellipse(x, y, 1.5 + rng() * 1.5, 1 + rng(), rng() * Math.PI, 0, Math.PI * 2);
      bg.fill();
    }
  }

  // Seen: Ufer, dann Wasser (Kreise je Feld + Verbindungen zu Nachbarn)
  const isWater = (c, r) => r >= 0 && r < ROWS && c >= 0 && c < COLS && grid[r][c] === "water";
  const fillLake = (lake, radius, style) => {
    bg.fillStyle = style;
    for (const [c, r] of lake) {
      const x = c * TILE + TILE / 2;
      const y = r * TILE + TILE / 2;
      bg.beginPath();
      bg.arc(x, y, radius, 0, Math.PI * 2);
      bg.fill();
      if (isWater(c + 1, r)) bg.fillRect(x, y - radius, TILE, radius * 2);
      if (isWater(c, r + 1)) bg.fillRect(x - radius, y, radius * 2, TILE);
      if (isWater(c + 1, r) && isWater(c, r + 1) && isWater(c + 1, r + 1)) {
        bg.fillRect(x, y, TILE, TILE);
      }
    }
  };
  for (const lake of LAKES) fillLake(lake, 25, "#b9a46c");
  for (const lake of LAKES) fillLake(lake, 21, "#2f6fa8");
  for (const lake of LAKES) {
    fillLake(lake, 14, "#3f8fcb");
    // Seerosen
    for (const [c, r] of lake) {
      if (variant[r][c] < 0.45) {
        const x = c * TILE + 10 + variant[r][c] * 40;
        const y = r * TILE + 26 - variant[r][c] * 20;
        bg.fillStyle = "#3f8f3a";
        bg.beginPath();
        bg.arc(x, y, 5, 0.4, Math.PI * 2 - 0.2);
        bg.lineTo(x, y);
        bg.fill();
        bg.fillStyle = "#f8bbd0";
        bg.beginPath();
        bg.arc(x + 1, y - 1, 1.8, 0, Math.PI * 2);
        bg.fill();
      }
    }
  }

  // Höhlen-Eingänge links
  for (const pts of pathPoints) {
    const y = pts[0].y;
    bg.fillStyle = "#4e4a46";
    bg.beginPath();
    bg.ellipse(0, y, 18, 24, 0, -Math.PI / 2, Math.PI / 2);
    bg.fill();
    bg.fillStyle = "#151210";
    bg.beginPath();
    bg.ellipse(0, y, 11, 17, 0, -Math.PI / 2, Math.PI / 2);
    bg.fill();
  }

  // Hindernisse zeilenweise (damit Baumkronen richtig überlappen)
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * TILE + TILE / 2;
      const y = r * TILE + TILE / 2;
      if (grid[r][c] === "tree") drawTree(bg, x, y, variant[r][c]);
      if (grid[r][c] === "rock") drawRock(bg, x, y, variant[r][c]);
    }
  }

  drawCastle(bg);
}

function drawTree(g, x, y, v) {
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.beginPath();
  g.ellipse(x + 3, y + 12, 15, 6, 0, 0, Math.PI * 2);
  g.fill();
  if (v < 0.4) {
    // Tanne
    g.fillStyle = "#5d4037";
    g.fillRect(x - 2.5, y + 4, 5, 10);
    const shades = ["#1b5e20", "#2e7d32", "#388e3c"];
    for (let i = 0; i < 3; i++) {
      g.fillStyle = shades[i];
      const top = y - 18 + i * 7;
      const half = 14 - i * 3;
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x + half, top + 14);
      g.lineTo(x - half, top + 14);
      g.closePath();
      g.fill();
    }
  } else {
    // Laubbaum
    g.fillStyle = "#6d4c41";
    g.fillRect(x - 3, y, 6, 14);
    const blobs = [[-7, -2, 10], [7, -3, 10], [0, -10, 11], [0, 0, 11]];
    for (const [dx, dy, rad] of blobs) {
      const lg = g.createRadialGradient(x + dx - 3, y + dy - 4, 2, x + dx, y + dy, rad);
      lg.addColorStop(0, v > 0.75 ? "#9ccc65" : "#66bb6a");
      lg.addColorStop(1, v > 0.75 ? "#558b2f" : "#2e7d32");
      g.fillStyle = lg;
      g.beginPath();
      g.arc(x + dx, y + dy, rad, 0, Math.PI * 2);
      g.fill();
    }
    if (v > 0.85) {
      g.fillStyle = "#e53935";
      for (const [dx, dy] of [[-6, -4], [5, -8], [3, 2]]) {
        g.beginPath();
        g.arc(x + dx, y + dy, 1.8, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

function drawRock(g, x, y, v) {
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.beginPath();
  g.ellipse(x + 2, y + 10, 16, 6, 0, 0, Math.PI * 2);
  g.fill();
  const pts = [[-15, 8], [-12, -4], [-4, -12], [8, -10], [15, -1], [13, 9]];
  const rg = g.createLinearGradient(x - 15, y - 12, x + 15, y + 10);
  rg.addColorStop(0, "#b0bec5");
  rg.addColorStop(1, "#607d8b");
  g.fillStyle = rg;
  g.beginPath();
  pts.forEach(([dx, dy], i) => {
    const s = 0.85 + v * 0.25;
    i === 0 ? g.moveTo(x + dx * s, y + dy * s) : g.lineTo(x + dx * s, y + dy * s);
  });
  g.closePath();
  g.fill();
  g.strokeStyle = "#455a64";
  g.lineWidth = 1;
  g.stroke();
  // Riss und Moos
  g.beginPath();
  g.moveTo(x - 3, y - 9);
  g.lineTo(x + 1, y - 2);
  g.lineTo(x - 2, y + 5);
  g.stroke();
  g.fillStyle = "rgba(104,159,56,0.8)";
  g.beginPath();
  g.ellipse(x - 8, y + 5, 5, 2.5, 0.3, 0, Math.PI * 2);
  g.fill();
}

function drawCastle(g) {
  const gateX = COLS * TILE - TILE;
  const gateY = 9 * TILE;
  // Mauer
  g.fillStyle = "#8d8d8d";
  g.fillRect(gateX + 4, 8 * TILE + 4, TILE - 4, TILE * 3 - 8);
  // Türme
  for (const ty of [8 * TILE + TILE / 2, 10 * TILE + TILE / 2]) {
    const cx = gateX + TILE / 2 + 2;
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.beginPath();
    g.ellipse(cx + 3, ty + 14, 17, 6, 0, 0, Math.PI * 2);
    g.fill();
    const tg = g.createLinearGradient(cx - 16, 0, cx + 16, 0);
    tg.addColorStop(0, "#bdbdbd");
    tg.addColorStop(1, "#757575");
    g.fillStyle = tg;
    g.fillRect(cx - 15, ty - 14, 30, 28);
    // Zinnen
    g.fillStyle = "#9e9e9e";
    for (let i = 0; i < 4; i++) g.fillRect(cx - 15 + i * 8, ty - 19, 6, 6);
    g.fillStyle = "#3e2723";
    g.fillRect(cx - 3, ty - 6, 6, 9);
    // Fahne
    g.strokeStyle = "#5d4037";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, ty - 19);
    g.lineTo(cx, ty - 32);
    g.stroke();
    g.fillStyle = "#e53935";
    g.beginPath();
    g.moveTo(cx, ty - 32);
    g.lineTo(cx + 11, ty - 28);
    g.lineTo(cx, ty - 24);
    g.fill();
  }
  // Tor
  g.fillStyle = "#4e342e";
  g.beginPath();
  g.moveTo(gateX + 8, gateY + TILE);
  g.lineTo(gateX + 8, gateY + 12);
  g.arc(gateX + TILE / 2 + 2, gateY + 12, TILE / 2 - 6, Math.PI, 0);
  g.lineTo(gateX + TILE - 4, gateY + TILE);
  g.fill();
  g.strokeStyle = "#2b1a14";
  g.lineWidth = 1.5;
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.moveTo(gateX + 8 + i * 7, gateY + 6);
    g.lineTo(gateX + 8 + i * 7, gateY + TILE);
    g.stroke();
  }
}

// ---------- Spielzustand ----------
let state;

function resetGame() {
  buildGrid();
  renderBackground();
  state = {
    lives: 20,
    gold: 180,
    wave: 0,
    towers: [],
    enemies: [],
    projectiles: [],
    particles: [],
    texts: [],
    rings: [],
    spawnQueue: [],
    spawnTimer: 0,
    spawnCount: 0,
    waveActive: false,
    selectedType: "arrow",
    selected: null, // { kind: "tower", tower } | { kind: "obstacle", col, row }
    hoverTile: null,
    speed: 1,
    gameOver: false,
    time: 0,
  };
  ui.speed.textContent = "Tempo: 1x";
  renderShop();
  updateHud();
  setInfo("Wähle einen Turm und klicke auf ein freies Feld. Bäume und Felsen kannst du anklicken und entfernen.");
}

// ---------- Wellen ----------
function buildWave(n) {
  const groups = [
    ["slime", 4 + n],
    ["runner", n >= 2 ? Math.floor(n * 1.2) : 0],
    ["beetle", n >= 3 ? Math.floor((n - 1) / 2) : 0],
    ["ghost", n >= 4 ? Math.floor((n - 2) / 2) : 0],
    ["healer", n >= 5 ? Math.floor((n - 3) / 2) : 0],
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
  for (let i = 0; i < Math.floor(n / 5); i++) queue.push("golem");
  return queue;
}

function startWave() {
  if (state.waveActive || state.gameOver) return;
  state.wave++;
  state.spawnQueue = buildWave(state.wave);
  state.spawnTimer = 0;
  state.waveActive = true;
  updateHud();
}

function hpScale() {
  return Math.pow(1.15, state.wave - 1);
}

function createEnemy(typeKey, pathIndex) {
  const type = ENEMY_TYPES[typeKey];
  const hp = Math.round(type.hp * hpScale());
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
      child.wait = i * 0.18; // nacheinander loslaufen
      state.enemies.push(child);
      i++;
    }
  }
}

// ---------- Türme ----------
function towerStats(tower) {
  const base = TOWER_TYPES[tower.type];
  const r = tower.levels.range;
  const d = tower.levels.damage;
  const s = {
    ...base,
    range: base.range * (1 + 0.18 * r),
    damage: base.damage * (1 + 0.45 * d),
  };
  if (base.slow) {
    s.slow = Math.max(0.25, base.slow - 0.08 * d); // stärkere Verlangsamung
    s.slowTime = base.slowTime + 0.4 * r;
  }
  if (base.splash) s.splash = base.splash * (1 + 0.1 * r);
  return s;
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
    grid[row][col] === "grass" && !towerAt(col, row)
  );
}

function placeTower(col, row) {
  const type = TOWER_TYPES[state.selectedType];
  if (!canBuild(col, row)) return;
  if (state.gold < type.cost) {
    setInfo(`Nicht genug Gold für ${type.name} (${type.cost} 💰).`);
    return;
  }
  state.gold -= type.cost;
  state.towers.push({
    type: state.selectedType,
    col, row,
    x: col * TILE + TILE / 2,
    y: row * TILE + TILE / 2,
    levels: { range: 0, damage: 0 },
    cooldown: 0,
    invested: type.cost,
    angle: 0,
    recoil: 0,
  });
  puff(col * TILE + TILE / 2, row * TILE + TILE / 2, "#cfc6b0", 10);
  updateHud();
}

function upgradeSelected(path) {
  const t = selectedTower();
  if (!t || t.levels[path] >= MAX_PATH_LEVEL) return;
  const cost = upgradeCost(t, path);
  if (state.gold < cost) return;
  state.gold -= cost;
  t.invested += cost;
  t.levels[path]++;
  puff(t.x, t.y, UPGRADE_PATHS[path].color, 14);
  updateHud();
  showTowerInfo(t);
}

function sellSelected() {
  const t = selectedTower();
  if (!t) return;
  state.gold += sellValue(t);
  state.towers = state.towers.filter((x) => x !== t);
  state.selected = null;
  updateHud();
  setInfo("Turm verkauft.");
}

function selectedTower() {
  return state.selected && state.selected.kind === "tower" ? state.selected.tower : null;
}

function clearObstacle() {
  const s = state.selected;
  if (!s || s.kind !== "obstacle") return;
  const def = OBSTACLES[grid[s.row][s.col]];
  if (!def || state.gold < def.clearCost) return;
  state.gold -= def.clearCost;
  const x = s.col * TILE + TILE / 2;
  const y = s.row * TILE + TILE / 2;
  puff(x, y, grid[s.row][s.col] === "tree" ? "#4caf50" : "#9e9e9e", 18);
  grid[s.row][s.col] = "grass";
  renderBackground();
  state.selected = null;
  updateHud();
  setInfo(`${def.name} entfernt – hier kannst du jetzt bauen.`);
}

// ---------- Update ----------
function update(dt) {
  if (state.gameOver) return;
  state.time += dt;
  const now = state.time;

  // Gegner erzeugen (abwechselnd auf beiden Wegen)
  if (state.spawnQueue.length > 0) {
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      const path = state.spawnCount % PATHS.length;
      state.enemies.push(createEnemy(state.spawnQueue.shift(), path));
      state.spawnCount++;
      state.spawnTimer = Math.max(0.3, 0.85 - state.wave * 0.03);
    }
  }

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
        state.gameOver = true;
        const survived = state.wave - 1;
        setInfo(`Game Over! Du hast ${survived} ${survived === 1 ? "Welle" : "Wellen"} überlebt. <button id="restart">Neu starten</button>`);
        document.getElementById("restart").onclick = resetGame;
      }
    }
  }

  // Türme schießen
  for (const t of state.towers) {
    const s = towerStats(t);
    t.cooldown -= dt;
    t.recoil = Math.max(0, t.recoil - dt * 4);
    const target = findTarget(t, s.range);
    if (target) t.angle = Math.atan2(target.y - t.y, target.x - t.x);
    if (target && t.cooldown <= 0) {
      t.cooldown = s.fireRate;
      t.recoil = 1;
      state.projectiles.push({
        x: t.x + Math.cos(t.angle) * 16,
        y: t.y + Math.sin(t.angle) * 16,
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
      if (p.kind === "frost" && Math.random() < 0.5) {
        state.particles.push(particle(p.x, p.y, "#e1f5fe", 0.3, 1.5, 10));
      }
    }
  }

  // Effekte
  for (const pa of state.particles) {
    pa.life -= dt;
    pa.x += pa.vx * dt;
    pa.y += pa.vy * dt;
    pa.vx *= 0.92;
    pa.vy *= 0.92;
  }
  for (const tx of state.texts) {
    tx.life -= dt;
    tx.y -= 22 * dt;
  }
  for (const ring of state.rings) ring.life -= dt;

  state.enemies = state.enemies.filter((e) => !e.dead);
  state.projectiles = state.projectiles.filter((p) => !p.done);
  state.particles = state.particles.filter((p) => p.life > 0);
  state.texts = state.texts.filter((t) => t.life > 0);
  state.rings = state.rings.filter((r) => r.life > 0);

  // Welle beendet?
  if (state.waveActive && state.spawnQueue.length === 0 && state.enemies.length === 0) {
    state.waveActive = false;
    const bonus = 20 + state.wave * 5;
    state.gold += bonus;
    setInfo(`Welle ${state.wave} geschafft! +${bonus} 💰 Bonus.`);
  }

  updateHud();
}

function healAround(healer) {
  const h = healer.def.heal;
  state.rings.push({ x: healer.x, y: healer.y, r: h.radius, life: 0.5, max: 0.5, color: "120,255,140" });
  for (const e of state.enemies) {
    if (e.dead || e.hp >= e.maxHp) continue;
    if (Math.hypot(e.x - healer.x, e.y - healer.y) <= h.radius) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * h.percent);
      state.particles.push(particle(e.x, e.y - e.def.radius, "#69f0ae", 0.6, 2, 20));
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
    state.rings.push({ x: p.tx, y: p.ty, r: s.splash, life: 0.3, max: 0.3, color: "255,160,60" });
    puff(p.tx, p.ty, "#ffb74d", 12);
    puff(p.tx, p.ty, "#616161", 6);
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
    puff(p.tx, p.ty, "#fff3e0", 3);
  }
}

function damage(e, amount) {
  const real = Math.max(1, amount - (e.def.armor || 0));
  e.hp -= real;
  e.flash = 0.08;
  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    state.gold += e.reward;
    state.texts.push({ x: e.x, y: e.y - 10, text: `+${e.reward}`, life: 0.9 });
    puff(e.x, e.y, e.def.color, 10 + e.def.radius);
    spawnChildren(e);
  }
}

function particle(x, y, color, life, size, speed) {
  const a = Math.random() * Math.PI * 2;
  const v = Math.random() * speed;
  return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, color, life, max: life, size };
}

function puff(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    state.particles.push(particle(x, y, color, 0.35 + Math.random() * 0.35, 1.5 + Math.random() * 2.5, 90));
  }
}

// ---------- Zeichnen ----------
function draw() {
  ctx.drawImage(bgCanvas, 0, 0);
  drawWaterSparkles();

  // Auswahl / Bau-Vorschau
  if (state.selected && state.selected.kind === "obstacle") {
    const { col, row } = state.selected;
    ctx.strokeStyle = "#ffd54a";
    ctx.lineWidth = 2;
    ctx.strokeRect(col * TILE + 2, row * TILE + 2, TILE - 4, TILE - 4);
  }
  if (state.hoverTile && !state.gameOver) {
    const { col, row } = state.hoverTile;
    if (col >= 0 && col < COLS && row >= 0 && row < ROWS && !towerAt(col, row)) {
      const ok = canBuild(col, row);
      const cell = grid[row][col];
      if (cell !== "path") {
        ctx.fillStyle = ok ? "rgba(255,255,255,0.22)" :
          OBSTACLES[cell] ? "rgba(255,213,74,0.22)" : "rgba(255,0,0,0.22)";
        ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
      }
      if (ok) {
        drawRange(col * TILE + TILE / 2, row * TILE + TILE / 2, TOWER_TYPES[state.selectedType].range);
      }
    }
  }

  const sel = selectedTower();
  if (sel) drawRange(sel.x, sel.y, towerStats(sel).range);

  for (const t of state.towers) drawTower(t);

  // Heil-/Explosionsringe
  for (const ring of state.rings) {
    const k = ring.life / ring.max;
    ctx.strokeStyle = `rgba(${ring.color},${k})`;
    ctx.fillStyle = `rgba(${ring.color},${k * 0.2})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.r * (1.1 - k * 0.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // kleine Gegner zuletzt, damit sie über großen sichtbar sind
  const sorted = [...state.enemies].sort((a, b) => b.def.radius - a.def.radius);
  for (const e of sorted) drawEnemy(e);

  for (const p of state.projectiles) drawProjectile(p);

  for (const pa of state.particles) {
    ctx.globalAlpha = Math.max(0, pa.life / pa.max);
    ctx.fillStyle = pa.color;
    ctx.beginPath();
    ctx.arc(pa.x, pa.y, pa.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (const tx of state.texts) {
    ctx.globalAlpha = Math.min(1, tx.life * 2);
    ctx.fillStyle = "#3e2a00";
    ctx.fillText(tx.text, tx.x + 1, tx.y + 1);
    ctx.fillStyle = "#ffd54a";
    ctx.fillText(tx.text, tx.x, tx.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "start";

  if (state.gameOver) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 48px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("GAME OVER", canvas.width / 2, canvas.height / 2);
    ctx.textAlign = "start";
  }
}

function drawWaterSparkles() {
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1.5;
  for (const lake of LAKES) {
    for (const [c, r] of lake) {
      const v = variant[r][c];
      const phase = state.time * 1.5 + v * 10;
      const a = (Math.sin(phase) + 1) / 2;
      ctx.globalAlpha = a * 0.8;
      const x = c * TILE + 12 + v * 16;
      const y = r * TILE + 14 + ((v * 7) % 1) * 12;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 4, y - 2, x + 8, y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function drawRange(x, y, r) {
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawTower(t) {
  const { x, y } = t;
  // Schatten
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(x + 3, y + 13, 17, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Steinsockel
  const sg = ctx.createLinearGradient(x - 16, y - 16, x + 16, y + 16);
  sg.addColorStop(0, "#9e9e9e");
  sg.addColorStop(1, "#5f5f5f");
  ctx.fillStyle = sg;
  roundRect(x - 16, y - 15, 32, 30, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 16, y - 5); ctx.lineTo(x + 16, y - 5);
  ctx.moveTo(x - 16, y + 5); ctx.lineTo(x + 16, y + 5);
  ctx.moveTo(x - 4, y - 15); ctx.lineTo(x - 4, y - 5);
  ctx.moveTo(x + 6, y - 5); ctx.lineTo(x + 6, y + 5);
  ctx.moveTo(x - 6, y + 5); ctx.lineTo(x - 6, y + 15);
  ctx.stroke();

  const kick = t.recoil * 3;
  const ca = Math.cos(t.angle);
  const sa = Math.sin(t.angle);

  if (t.type === "arrow") {
    ctx.fillStyle = "#8d6e63";
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#5d4037";
    ctx.lineWidth = 2;
    ctx.stroke();
    // Armbrust
    ctx.save();
    ctx.translate(x - ca * kick, y - sa * kick);
    ctx.rotate(t.angle);
    ctx.strokeStyle = "#3e2723";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-6, 0); ctx.lineTo(15, 0);
    ctx.stroke();
    ctx.strokeStyle = "#4fc3f7";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(4, 0, 10, -1.2, 1.2);
    ctx.stroke();
    ctx.strokeStyle = "#eeeeee";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(4 + Math.cos(-1.2) * 10, Math.sin(-1.2) * 10);
    ctx.lineTo(-2 + kick, 0);
    ctx.lineTo(4 + Math.cos(1.2) * 10, Math.sin(1.2) * 10);
    ctx.stroke();
    ctx.restore();
  } else if (t.type === "cannon") {
    const cg = ctx.createRadialGradient(x - 4, y - 4, 2, x, y, 13);
    cg.addColorStop(0, "#8a8a8a");
    cg.addColorStop(1, "#303030");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(x - ca * kick, y - sa * kick);
    ctx.rotate(t.angle);
    ctx.fillStyle = "#212121";
    ctx.fillRect(0, -5, 19, 10);
    ctx.fillStyle = "#ff8a65";
    ctx.fillRect(15, -6, 5, 12);
    ctx.restore();
    ctx.fillStyle = "#ff8a65";
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (t.type === "frost") {
    const pulse = (Math.sin(state.time * 3 + t.col) + 1) / 2;
    ctx.fillStyle = `rgba(179,157,219,${0.25 + pulse * 0.25})`;
    ctx.beginPath();
    ctx.arc(x, y - 2, 15, 0, Math.PI * 2);
    ctx.fill();
    const fg = ctx.createLinearGradient(x, y - 18, x, y + 10);
    fg.addColorStop(0, "#e1f5fe");
    fg.addColorStop(1, "#7e57c2");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(x, y - 18);
    ctx.lineTo(x + 8, y - 3);
    ctx.lineTo(x, y + 9);
    ctx.lineTo(x - 8, y - 3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 18); ctx.lineTo(x, y + 9);
    ctx.stroke();
    // kreisende Splitter
    for (let i = 0; i < 3; i++) {
      const a = state.time * 2 + (i * Math.PI * 2) / 3;
      ctx.fillStyle = "#b3e5fc";
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 13, y - 3 + Math.sin(a) * 6, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Ausbaustufen: links blau (Reichweite), rechts rot (Schaden)
  for (let i = 0; i < t.levels.range; i++) {
    ctx.fillStyle = UPGRADE_PATHS.range.color;
    ctx.fillRect(x - 15 + i * 5, y + 11, 4, 4);
  }
  for (let i = 0; i < t.levels.damage; i++) {
    ctx.fillStyle = UPGRADE_PATHS.damage.color;
    ctx.fillRect(x + 11 - i * 5, y + 11, 4, 4);
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawEnemy(e) {
  const d = e.def;
  const r = d.radius;
  const bob = Math.sin(e.wobble) * 1.2;
  const x = e.x;
  const y = e.y + bob;

  // Schatten
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(e.x, e.y + r * 0.8, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  if (d.shape === "ghost" || d.shape === "wisp") ctx.globalAlpha = 0.8;

  const body = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, 1, x, y, r * 1.2);
  body.addColorStop(0, lighten(d.color));
  body.addColorStop(1, d.color);

  switch (d.shape) {
    case "slime": {
      // durchscheinender Körper, Kinder schimmern durch
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(x, y, r * (1 + Math.sin(e.wobble) * 0.06), r * (1 - Math.sin(e.wobble) * 0.06), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,60,0,0.6)";
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    case "runner": {
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1.5;
      for (let i = -1; i <= 1; i++) {
        const bx = x - Math.cos(e.dir) * (r + 3);
        const by = y - Math.sin(e.dir) * (r + 3) + i * 4;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - Math.cos(e.dir) * 7, by - Math.sin(e.dir) * 7);
        ctx.stroke();
      }
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.25, r * 0.85, e.dir, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#9e8a00";
      ctx.stroke();
      break;
    }
    case "wisp": {
      const glow = ctx.createRadialGradient(x, y, 1, x, y, r * 2.4);
      glow.addColorStop(0, "rgba(224,247,250,1)");
      glow.addColorStop(0.4, "rgba(128,222,234,0.7)");
      glow.addColorStop(1, "rgba(128,222,234,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "beetle": {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(e.dir);
      // Beine
      ctx.strokeStyle = "#3e2723";
      ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        const leg = Math.sin(e.wobble * 2 + i) * 2;
        ctx.beginPath();
        ctx.moveTo(i * 5, -r * 0.6); ctx.lineTo(i * 5 + leg, -r - 3);
        ctx.moveTo(i * 5, r * 0.6); ctx.lineTo(i * 5 - leg, r + 3);
        ctx.stroke();
      }
      ctx.fillStyle = "#3e2723";
      ctx.beginPath();
      ctx.arc(r * 0.85, 0, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      // Panzerplatten
      ctx.strokeStyle = "#4e342e";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-r, 0); ctx.lineTo(r * 0.7, 0);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,238,88,0.85)"; // Flitzer darin
      for (const [dx, dy] of [[-4, -5], [3, -5], [-1, 5]]) {
        ctx.beginPath();
        ctx.arc(dx, dy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    case "ghost": {
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(x, y - 2, r, Math.PI, 0);
      const waves = 4;
      for (let i = 0; i <= waves; i++) {
        const wx = x + r - (i * 2 * r) / waves;
        const wy = y + r * 0.7 + (i % 2 === 0 ? 0 : -4) + Math.sin(e.wobble + i) * 1.5;
        ctx.lineTo(wx, wy);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "healer": {
      const pulse = 1 - e.healTimer / d.heal.interval;
      ctx.strokeStyle = `rgba(105,240,174,${0.15 + pulse * 0.4})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 4 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ad1457";
      ctx.lineWidth = 1;
      ctx.stroke();
      // Heilkreuz über dem Kopf
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#c2185b";
      ctx.beginPath();
      ctx.rect(x - 2, y - r - 7, 4, 10);
      ctx.rect(x - 5, y - r - 4, 10, 4);
      ctx.fill();
      ctx.fillStyle = "#e91e63";
      ctx.fillRect(x - 1, y - r - 6, 2, 8);
      ctx.fillRect(x - 4, y - r - 3, 8, 2);
      break;
    }
    case "golem": {
      ctx.fillStyle = body;
      ctx.beginPath();
      const sides = 7;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 + 0.3;
        const rr = r * (0.9 + ((i * 37) % 10) / 50);
        i === 0 ? ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
                : ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#37474f";
      ctx.lineWidth = 2;
      ctx.stroke();
      // Glühende Risse
      ctx.strokeStyle = "#ff7043";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 8, y + 4); ctx.lineTo(x - 2, y + 9); ctx.lineTo(x + 4, y + 5);
      ctx.moveTo(x + 6, y - 10); ctx.lineTo(x + 10, y - 4);
      ctx.stroke();
      break;
    }
  }

  // Kinder im Inneren durchscheinen lassen (Schleim, Heiler)
  if (d.shape === "slime" && d.children) {
    const child = ENEMY_TYPES[d.children[0][0]];
    ctx.fillStyle = darken(child.color);
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < d.children[0][1]; i++) {
      const a = e.wobble * 0.5 + i * Math.PI;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.45, y + 2 + Math.sin(a) * r * 0.25, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Augen
  if (d.shape !== "wisp" && d.shape !== "beetle") {
    const ex = Math.cos(e.dir) * r * 0.25;
    const ey = Math.sin(e.dir) * r * 0.25;
    const eyeR = Math.max(1.6, r * 0.22);
    const eyeColor = d.shape === "golem" ? "#ffab40" : "#ffffff";
    for (const side of [-1, 1]) {
      const px = x + ex + side * r * 0.32;
      const py = y - r * 0.2 + ey;
      ctx.fillStyle = eyeColor;
      ctx.beginPath();
      ctx.arc(px, py, eyeR, 0, Math.PI * 2);
      ctx.fill();
      if (d.shape !== "golem") {
        ctx.fillStyle = "#1a1a1a";
        ctx.beginPath();
        ctx.arc(px + Math.cos(e.dir) * eyeR * 0.4, py + Math.sin(e.dir) * eyeR * 0.4, eyeR * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Treffer-Blitz und Frost
  if (e.flash > 0) {
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (e.slowFactor < 1) {
    ctx.fillStyle = "rgba(129,212,250,0.4)";
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#e1f5fe";
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.4;
      const cx = x + Math.cos(a) * r * 0.8;
      const cy = y + Math.sin(a) * r * 0.8;
      ctx.beginPath();
      ctx.moveTo(cx - 2, cy); ctx.lineTo(cx + 2, cy);
      ctx.moveTo(cx, cy - 2); ctx.lineTo(cx, cy + 2);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Lebensbalken
  if (e.hp < e.maxHp) {
    const w = Math.max(16, r * 2.2);
    const by = e.y - r - 9;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(e.x - w / 2 - 1, by - 1, w + 2, 5);
    const k = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = k > 0.5 ? "#66bb6a" : k > 0.25 ? "#ffca28" : "#ef5350";
    ctx.fillRect(e.x - w / 2, by, w * k, 3);
  }
  if (d.armor) {
    ctx.fillStyle = "#b0bec5";
    ctx.beginPath();
    const sx = e.x + r * 0.9;
    const sy = e.y - r - 6;
    ctx.moveTo(sx - 4, sy - 3);
    ctx.lineTo(sx + 4, sy - 3);
    ctx.lineTo(sx + 4, sy + 1);
    ctx.lineTo(sx, sy + 5);
    ctx.lineTo(sx - 4, sy + 1);
    ctx.closePath();
    ctx.fill();
  }
}

function drawProjectile(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  if (p.kind === "arrow") {
    ctx.strokeStyle = "#5d4037";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-9, 0); ctx.lineTo(5, 0);
    ctx.stroke();
    ctx.fillStyle = "#cfd8dc";
    ctx.beginPath();
    ctx.moveTo(8, 0); ctx.lineTo(3, -3); ctx.lineTo(3, 3);
    ctx.fill();
    ctx.fillStyle = "#4fc3f7";
    ctx.fillRect(-10, -2.5, 4, 5);
  } else if (p.kind === "cannon") {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(2, 7, 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    const g = ctx.createRadialGradient(-2, -2, 1, 0, 0, 6);
    g.addColorStop(0, "#9e9e9e");
    g.addColorStop(1, "#212121");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = "#e1f5fe";
    ctx.beginPath();
    ctx.moveTo(7, 0); ctx.lineTo(0, -3.5); ctx.lineTo(-6, 0); ctx.lineTo(0, 3.5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#7e57c2";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function lighten(hex) {
  return mix(hex, 255, 0.45);
}

function darken(hex) {
  return mix(hex, 0, 0.45);
}

function mix(hex, target, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (target - v) * k));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

// ---------- UI ----------
function updateHud() {
  ui.lives.textContent = state.lives;
  ui.gold.textContent = state.gold;
  ui.wave.textContent = state.wave;
  ui.startWave.disabled = state.waveActive || state.gameOver;
  for (const btn of ui.shop.querySelectorAll("button")) {
    btn.disabled = state.gold < TOWER_TYPES[btn.dataset.type].cost;
  }
  const t = selectedTower();
  for (const path of Object.keys(UPGRADE_PATHS)) {
    const btn = document.getElementById(`up-${path}`);
    if (btn && t) btn.disabled = state.gold < upgradeCost(t, path);
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
    btn.innerHTML = `<span class="swatch" style="background:${t.color}"></span>${t.name} (${t.cost} 💰)`;
    if (key === state.selectedType) btn.classList.add("selected");
    btn.onclick = () => selectTowerType(key);
    ui.shop.appendChild(btn);
  }
}

function selectTowerType(key) {
  state.selectedType = key;
  state.selected = null;
  renderShop();
  updateHud();
  setInfo(`${TOWER_TYPES[key].name}: ${TOWER_TYPES[key].desc}`);
}

function renderLegend() {
  ui.legend.innerHTML = Object.values(ENEMY_TYPES)
    .map((e) => {
      const inner = e.children
        ? ` Enthält: ${e.children.map(([k, n]) => `${n}× ${ENEMY_TYPES[k].name}`).join(", ")}.`
        : "";
      return `<div class="enemy"><span class="swatch" style="background:${e.color}"></span><b>${e.name}</b> – ${e.desc}${inner}</div>`;
    })
    .join("");
}

function setInfo(html) {
  ui.info.innerHTML = html;
}

function showTowerInfo(t) {
  const s = towerStats(t);
  let html = `<b>${s.name}</b> · Schaden ${Math.round(s.damage)} · Reichweite ${Math.round(s.range)}`;
  if (s.slow) html += ` · Verlangsamung ${Math.round((1 - s.slow) * 100)} % für ${s.slowTime.toFixed(1)} s`;
  html += "<br>";
  for (const [path, def] of Object.entries(UPGRADE_PATHS)) {
    const lvl = t.levels[path];
    const pips = "●".repeat(lvl) + "○".repeat(MAX_PATH_LEVEL - lvl);
    if (lvl < MAX_PATH_LEVEL) {
      html += `<button id="up-${path}" style="border-color:${def.color}">${def.name} ${pips} (${upgradeCost(t, path)} 💰)</button> `;
    } else {
      html += `<button disabled style="border-color:${def.color}">${def.name} ${pips} max.</button> `;
    }
  }
  html += `<button id="sell">Verkaufen (+${sellValue(t)} 💰)</button>`;
  setInfo(html);
  for (const path of Object.keys(UPGRADE_PATHS)) {
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

function tileFromEvent(ev) {
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((ev.clientY - rect.top) / rect.height) * canvas.height;
  return { col: Math.floor(x / TILE), row: Math.floor(y / TILE) };
}

canvas.addEventListener("mousemove", (ev) => {
  state.hoverTile = tileFromEvent(ev);
});

canvas.addEventListener("mouseleave", () => {
  state.hoverTile = null;
});

canvas.addEventListener("click", (ev) => {
  if (state.gameOver) return;
  const { col, row } = tileFromEvent(ev);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
  const tower = towerAt(col, row);
  if (tower) {
    state.selected = { kind: "tower", tower };
    showTowerInfo(tower);
    return;
  }
  const cell = grid[row][col];
  if (OBSTACLES[cell]) {
    state.selected = { kind: "obstacle", col, row };
    showObstacleInfo(col, row);
    return;
  }
  state.selected = null;
  if (cell === "water") setInfo("Auf einem See kann nicht gebaut werden.");
  else if (cell === "castle") setInfo("Das ist deine Burg – verteidige sie!");
  else if (canBuild(col, row)) placeTower(col, row);
});

ui.startWave.addEventListener("click", startWave);

ui.speed.addEventListener("click", () => {
  state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 3 : 1;
  ui.speed.textContent = `Tempo: ${state.speed}x`;
});

document.addEventListener("keydown", (ev) => {
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
  draw();
  requestAnimationFrame(loop);
}

renderLegend();
resetGame();
requestAnimationFrame(loop);
