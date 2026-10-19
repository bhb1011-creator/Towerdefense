"use strict";

// ---------- Grundeinstellungen ----------
const TILE = 40;
const COLS = 20;
const ROWS = 12;
const MAX_LEVEL = 3;

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
};

// Weg der Gegner als Wegpunkte in Feld-Koordinaten (Spalte, Zeile)
const WAYPOINTS = [
  [-1, 2], [4, 2], [4, 8], [10, 8], [10, 3], [15, 3], [15, 9], [20, 9],
];

const TOWER_TYPES = {
  arrow: {
    name: "Pfeilturm", cost: 50, range: 110, damage: 10, fireRate: 0.5,
    color: "#4fc3f7", projectileSpeed: 420,
    desc: "Schnelle Schüsse auf einzelne Ziele.",
  },
  cannon: {
    name: "Kanone", cost: 90, range: 95, damage: 28, fireRate: 1.4,
    color: "#ff8a65", projectileSpeed: 260, splash: 50,
    desc: "Langsam, aber Flächenschaden.",
  },
  frost: {
    name: "Frostturm", cost: 70, range: 85, damage: 4, fireRate: 0.8,
    color: "#b39ddb", projectileSpeed: 320, slow: 0.5, slowTime: 1.6,
    desc: "Verlangsamt Gegner um 50 %.",
  },
};

const ENEMY_TYPES = {
  normal: { hp: 30, speed: 55, reward: 6, radius: 11, color: "#81c784" },
  fast:   { hp: 18, speed: 100, reward: 5, radius: 9,  color: "#fff176" },
  tank:   { hp: 110, speed: 35, reward: 15, radius: 15, color: "#e57373" },
};

// ---------- Weg vorberechnen ----------
const pathPoints = WAYPOINTS.map(([c, r]) => ({
  x: c * TILE + TILE / 2,
  y: r * TILE + TILE / 2,
}));

const pathTiles = new Set();
for (let i = 0; i < WAYPOINTS.length - 1; i++) {
  let [c, r] = WAYPOINTS[i];
  const [c2, r2] = WAYPOINTS[i + 1];
  const dc = Math.sign(c2 - c);
  const dr = Math.sign(r2 - r);
  pathTiles.add(`${c},${r}`);
  while (c !== c2 || r !== r2) {
    c += dc;
    r += dr;
    pathTiles.add(`${c},${r}`);
  }
}

// ---------- Spielzustand ----------
let state;

function resetGame() {
  state = {
    lives: 20,
    gold: 120,
    wave: 0,
    towers: [],
    enemies: [],
    projectiles: [],
    effects: [],
    spawnQueue: [],
    spawnTimer: 0,
    waveActive: false,
    selectedType: "arrow",
    selectedTower: null,
    hoverTile: null,
    speed: 1,
    gameOver: false,
    time: 0,
  };
  ui.speed.textContent = "Tempo: 1x";
  updateHud();
  renderShop();
  setInfo("Wähle einen Turm und klicke auf ein freies Feld.");
}

// ---------- Wellen ----------
function buildWave(n) {
  const queue = [];
  const count = 6 + n * 2;
  for (let i = 0; i < count; i++) {
    let type = "normal";
    if (n >= 2 && i % 3 === 1) type = "fast";
    if (n >= 4 && i % 5 === 4) type = "tank";
    queue.push(type);
  }
  if (n % 5 === 0) queue.push("tank", "tank");
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

function spawnEnemy(typeKey) {
  const type = ENEMY_TYPES[typeKey];
  const hpScale = Math.pow(1.22, state.wave - 1);
  const hp = Math.round(type.hp * hpScale);
  state.enemies.push({
    x: pathPoints[0].x,
    y: pathPoints[0].y,
    target: 1,
    hp,
    maxHp: hp,
    speed: type.speed,
    reward: type.reward + Math.floor(state.wave / 3),
    radius: type.radius,
    color: type.color,
    slowUntil: 0,
    slowFactor: 1,
    dead: false,
  });
}

// ---------- Türme ----------
function towerStats(tower) {
  const base = TOWER_TYPES[tower.type];
  const lvl = tower.level - 1;
  return {
    ...base,
    damage: base.damage * Math.pow(1.5, lvl),
    range: base.range * Math.pow(1.12, lvl),
    fireRate: base.fireRate * Math.pow(0.88, lvl),
  };
}

function upgradeCost(tower) {
  return Math.round(TOWER_TYPES[tower.type].cost * 0.8 * tower.level);
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
    !pathTiles.has(`${col},${row}`) && !towerAt(col, row)
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
    level: 1,
    cooldown: 0,
    invested: type.cost,
    angle: 0,
  });
  updateHud();
}

function upgradeSelected() {
  const t = state.selectedTower;
  if (!t || t.level >= MAX_LEVEL) return;
  const cost = upgradeCost(t);
  if (state.gold < cost) return;
  state.gold -= cost;
  t.invested += cost;
  t.level++;
  updateHud();
  showTowerInfo(t);
}

function sellSelected() {
  const t = state.selectedTower;
  if (!t) return;
  state.gold += sellValue(t);
  state.towers = state.towers.filter((x) => x !== t);
  state.selectedTower = null;
  updateHud();
  setInfo("Turm verkauft.");
}

// ---------- Update ----------
function update(dt) {
  if (state.gameOver) return;
  state.time += dt;
  const now = state.time;

  // Gegner erzeugen
  if (state.spawnQueue.length > 0) {
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawnEnemy(state.spawnQueue.shift());
      state.spawnTimer = Math.max(0.35, 0.9 - state.wave * 0.03);
    }
  }

  // Gegner bewegen
  for (const e of state.enemies) {
    if (e.slowUntil < now) e.slowFactor = 1;
    let move = e.speed * e.slowFactor * dt;
    while (move > 0 && e.target < pathPoints.length) {
      const p = pathPoints[e.target];
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= move) {
        e.x = p.x;
        e.y = p.y;
        move -= dist;
        e.target++;
      } else {
        e.x += (dx / dist) * move;
        e.y += (dy / dist) * move;
        move = 0;
      }
    }
    if (e.target >= pathPoints.length && !e.dead) {
      e.dead = true;
      state.lives--;
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
    const target = findTarget(t, s.range);
    if (target) t.angle = Math.atan2(target.y - t.y, target.x - t.x);
    if (target && t.cooldown <= 0) {
      t.cooldown = s.fireRate;
      state.projectiles.push({
        x: t.x, y: t.y, target, stats: s, speed: s.projectileSpeed,
      });
    }
  }

  // Projektile
  for (const p of state.projectiles) {
    const dx = p.target.x - p.x;
    const dy = p.target.y - p.y;
    const dist = Math.hypot(dx, dy);
    const step = p.speed * dt;
    if (dist <= step || p.target.dead) {
      p.done = true;
      if (!p.target.dead) hit(p, now);
    } else {
      p.x += (dx / dist) * step;
      p.y += (dy / dist) * step;
    }
  }

  // Effekte
  for (const fx of state.effects) fx.life -= dt;

  state.enemies = state.enemies.filter((e) => !e.dead);
  state.projectiles = state.projectiles.filter((p) => !p.done);
  state.effects = state.effects.filter((fx) => fx.life > 0);

  // Welle beendet?
  if (state.waveActive && state.spawnQueue.length === 0 && state.enemies.length === 0) {
    state.waveActive = false;
    const bonus = 20 + state.wave * 5;
    state.gold += bonus;
    setInfo(`Welle ${state.wave} geschafft! +${bonus} 💰 Bonus.`);
  }

  updateHud();
}

function findTarget(tower, range) {
  // Gegner, der am weitesten auf dem Weg ist
  let best = null;
  let bestProgress = -1;
  for (const e of state.enemies) {
    if (e.dead) continue;
    if (Math.hypot(e.x - tower.x, e.y - tower.y) > range) continue;
    const next = pathPoints[Math.min(e.target, pathPoints.length - 1)];
    const progress = e.target * 10000 - Math.hypot(next.x - e.x, next.y - e.y);
    if (progress > bestProgress) {
      bestProgress = progress;
      best = e;
    }
  }
  return best;
}

function hit(p, now) {
  const s = p.stats;
  if (s.splash) {
    state.effects.push({ x: p.target.x, y: p.target.y, r: s.splash, life: 0.25, max: 0.25 });
    for (const e of state.enemies) {
      if (!e.dead && Math.hypot(e.x - p.target.x, e.y - p.target.y) <= s.splash) {
        damage(e, s.damage);
      }
    }
  } else {
    damage(p.target, s.damage);
  }
  if (s.slow && !p.target.dead) {
    p.target.slowFactor = s.slow;
    p.target.slowUntil = now + s.slowTime;
  }
}

function damage(e, amount) {
  e.hp -= amount;
  if (e.hp <= 0 && !e.dead) {
    e.dead = true;
    state.gold += e.reward;
  }
}

// ---------- Zeichnen ----------
function draw() {
  // Gras
  ctx.fillStyle = "#3e6b3a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath(); ctx.moveTo(c * TILE, 0); ctx.lineTo(c * TILE, canvas.height); ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath(); ctx.moveTo(0, r * TILE); ctx.lineTo(canvas.width, r * TILE); ctx.stroke();
  }

  // Weg
  ctx.strokeStyle = "#c9a96e";
  ctx.lineWidth = TILE - 4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  pathPoints.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.lineWidth = 1;

  // Bau-Vorschau
  if (state.hoverTile && !state.gameOver) {
    const { col, row } = state.hoverTile;
    const ok = canBuild(col, row);
    const existing = towerAt(col, row);
    if (!existing) {
      ctx.fillStyle = ok ? "rgba(255,255,255,0.25)" : "rgba(255,0,0,0.25)";
      ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
      if (ok) {
        drawRange(col * TILE + TILE / 2, row * TILE + TILE / 2, TOWER_TYPES[state.selectedType].range);
      }
    }
  }

  // Türme
  for (const t of state.towers) {
    const base = TOWER_TYPES[t.type];
    if (t === state.selectedTower) drawRange(t.x, t.y, towerStats(t).range);
    ctx.fillStyle = "#555";
    ctx.fillRect(t.x - 16, t.y - 16, 32, 32);
    ctx.fillStyle = base.color;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 11, 0, Math.PI * 2);
    ctx.fill();
    // Kanonenrohr
    ctx.strokeStyle = "#222";
    ctx.lineWidth = t.type === "cannon" ? 7 : 4;
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(t.x + Math.cos(t.angle) * 17, t.y + Math.sin(t.angle) * 17);
    ctx.stroke();
    ctx.lineWidth = 1;
    // Level-Punkte
    ctx.fillStyle = "#ffd54a";
    for (let i = 0; i < t.level; i++) {
      ctx.fillRect(t.x - 12 + i * 9, t.y + 12, 6, 3);
    }
  }

  // Gegner
  for (const e of state.enemies) {
    ctx.fillStyle = e.slowFactor < 1 ? "#90caf9" : e.color;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#222";
    ctx.stroke();
    // Lebensbalken
    const w = 26;
    ctx.fillStyle = "#300";
    ctx.fillRect(e.x - w / 2, e.y - e.radius - 8, w, 4);
    ctx.fillStyle = "#4caf50";
    ctx.fillRect(e.x - w / 2, e.y - e.radius - 8, w * Math.max(0, e.hp / e.maxHp), 4);
  }

  // Projektile
  for (const p of state.projectiles) {
    ctx.fillStyle = p.stats.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.stats.splash ? 5 : 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Explosionen
  for (const fx of state.effects) {
    ctx.fillStyle = `rgba(255,150,50,${(fx.life / fx.max) * 0.5})`;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, fx.r * (1 - fx.life / fx.max * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }

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

function drawRange(x, y, r) {
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
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
  const up = document.getElementById("upgrade");
  if (up && state.selectedTower) {
    up.disabled = state.gold < upgradeCost(state.selectedTower);
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
    btn.onclick = () => {
      state.selectedType = key;
      state.selectedTower = null;
      renderShop();
      updateHud();
      setInfo(`${t.name}: ${t.desc}`);
    };
    ui.shop.appendChild(btn);
  }
}

function setInfo(html) {
  ui.info.innerHTML = html;
}

function showTowerInfo(t) {
  const s = towerStats(t);
  let html = `<b>${s.name}</b> – Stufe ${t.level}/${MAX_LEVEL} · Schaden ${Math.round(s.damage)} · Reichweite ${Math.round(s.range)}<br>`;
  if (t.level < MAX_LEVEL) {
    html += `<button id="upgrade">Verbessern (${upgradeCost(t)} 💰)</button> `;
  }
  html += `<button id="sell">Verkaufen (+${sellValue(t)} 💰)</button>`;
  setInfo(html);
  const up = document.getElementById("upgrade");
  if (up) {
    up.onclick = upgradeSelected;
    up.disabled = state.gold < upgradeCost(t);
  }
  document.getElementById("sell").onclick = sellSelected;
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
  const tower = towerAt(col, row);
  if (tower) {
    state.selectedTower = tower;
    showTowerInfo(tower);
    return;
  }
  state.selectedTower = null;
  if (canBuild(col, row)) placeTower(col, row);
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
  if (idx >= 0 && idx < keys.length) {
    state.selectedType = keys[idx];
    state.selectedTower = null;
    renderShop();
    updateHud();
  }
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

resetGame();
requestAnimationFrame(loop);
