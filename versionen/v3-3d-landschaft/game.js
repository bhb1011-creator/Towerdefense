"use strict";

// Spiellogik. Positionen werden in "Pixeln" auf einem 800×480-Raster gerechnet
// (40 px pro Feld); scene.js übersetzt sie in 3D-Koordinaten.

// ---------- Grundeinstellungen ----------
const TILE = 40;
const COLS = 20;
const ROWS = 12;
const MAX_PATH_LEVEL = 3;
const MAP_SEED = 1337;

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
  View.buildMap();
  ui.speed.textContent = "Tempo: 1x";
  ui.overlay.hidden = true;
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
  puff(t.x, t.y, UPGRADE_PATHS[path].color, 14, 30);
  updateHud();
  showTowerInfo(t);
}

function sellSelected() {
  const t = selectedTower();
  if (!t) return;
  state.gold += sellValue(t);
  state.towers = state.towers.filter((x) => x !== t);
  state.selected = null;
  puff(t.x, t.y, "#cfc6b0", 12);
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
  puff(s.col * TILE + TILE / 2, s.row * TILE + TILE / 2, kind === "tree" ? "#4caf50" : "#9e9e9e", 18, 20);
  grid[s.row][s.col] = "grass";
  View.removeObstacle(s.col, s.row);
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
        ui.overlay.hidden = false;
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
      if (p.kind === "frost" && Math.random() < 0.5) {
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
    state.rings.push({ x: p.tx, y: p.ty, r: s.splash, life: 0.35, max: 0.35, color: "#ffa040" });
    puff(p.tx, p.ty, "#ffb74d", 14, 40);
    puff(p.tx, p.ty, "#616161", 8, 30);
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

// Wird von scene.js aufgerufen, wenn ein Feld angeklickt wurde
function handleTileClick(col, row) {
  if (state.gameOver) return;
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
}

ui.startWave.addEventListener("click", startWave);

ui.speed.addEventListener("click", () => {
  state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 3 : 1;
  ui.speed.textContent = `Tempo: ${state.speed}x`;
});

ui.resetCamera.addEventListener("click", () => View.resetCamera());

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
  View.render(dt);
  requestAnimationFrame(loop);
}

View.init(document.getElementById("view"));
renderLegend();
resetGame();
requestAnimationFrame(loop);
