"use strict";

// Spielablauf und Oberfläche. Die Spieldaten stehen in data.js,
// die 3D-Darstellung in scene.js und Musik/Sound in audio.js.

const SAVE_KEY = "neoCityDefense.save.v2";
const SETTINGS_KEY = "neoCityDefense.settings.v1";

const ui = {
  lives: document.getElementById("lives"),
  gold: document.getElementById("gold"),
  wave: document.getElementById("wave"),
  startWave: document.getElementById("startWave"),
  pause: document.getElementById("pause"),
  speed: document.getElementById("speed"),
  auto: document.getElementById("auto"),
  resetCamera: document.getElementById("resetCamera"),
  menuButton: document.getElementById("menuButton"),
  shop: document.getElementById("shop"),
  info: document.getElementById("info"),
  legend: document.getElementById("legend"),
  overlay: document.getElementById("overlay"),
  banner: document.getElementById("banner"),
  bossBars: document.getElementById("bossBars"),
  menu: document.getElementById("menu"),
  pausedBadge: document.getElementById("pausedBadge"),
};

// Wie Türme mit Tarn-Gegnern umgehen (wird im Shop und beim Turm angezeigt)
const CAMO_INFO = {
  laser: "Tarnerkennung über das Upgrade „Radar“ (Sensorik 2).",
  plasma: "Keine Tarnerkennung. Explosionen treffen Getarnte aber mit.",
  cryo: "Der Kältepuls trifft auch Getarnte. Splitter erkennen Tarnung ab „Thermoschock“ (Kristalle 2).",
  mortar: "Trifft Getarnte immer, da er auf einen Punkt schießt.",
  station: "Schiffe rammen auch Getarnte. Die Laser der „Trägerflotte“ erkennen Tarnung.",
};

const PRIORITIES = { first: "Erster", last: "Letzter", strong: "Stärkster", close: "Nächster" };

// ---------- Einstellungen ----------
const settings = Object.assign(
  { music: true, musicVol: 0.5, sfx: true, sfxVol: 0.6, autoStart: false },
  readStorage(SETTINGS_KEY) || {}
);

function readStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function saveSettings() {
  writeStorage(SETTINGS_KEY, settings);
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
      if (nearPath(c, r) && rng() < 0.7) continue; // Felder am Weg bleiben meistens frei
      grid[r][c] = kind;
      placed++;
    }
  }
}

// ---------- Spielzustand ----------
let state;
let nextId = 1;

function newGame(diffKey) {
  const diff = DIFFICULTIES[diffKey];
  buildGrid();
  state = {
    diffKey,
    diff,
    lives: diff.lives,
    gold: diff.gold,
    goldFrac: 0,
    wave: 0,
    towers: [],
    enemies: [],
    ships: [],
    projectiles: [],
    particles: [],
    texts: [],
    rings: [],
    beams: [],
    events: [],
    spawnQueue: [],
    waveTime: 0,
    waveActive: false,
    selectedType: "laser",
    buildMode: false,
    aiming: null, // Mörser, dessen Zielpunkt gerade gesetzt wird
    selected: null, // { kind: "tower", tower } | { kind: "obstacle", col, row }
    hoverTile: null,
    preview: null, // Upgrade-Vorschau { tower, range }
    cleared: [], // entfernte Hindernisse (für den Spielstand)
    speed: 1,
    paused: false,
    autoTimer: 0,
    gameOver: false,
    won: false,
    time: 0,
    frame: 0,
  };
  View.buildMap();
  ui.overlay.hidden = true;
  ui.bossBars.innerHTML = "";
  bossBarEls.clear();
  renderShop();
  updateHud();
  setInfo("Wähle unten einen Turm aus und klicke auf ein freies Feld im Raster.");
}

// ---------- Gegner ----------
function enemyRadius(e) {
  return e.kind === "drone" ? DRONE_LEVELS[e.level].radius : HEAVY[e.kind].radius;
}

function enemyColor(e) {
  return e.kind === "drone" ? DRONE_LEVELS[e.level].color : HEAVY[e.kind].color;
}

function enemySpeed(e) {
  const base = e.kind === "drone" ? DRONE_LEVELS[e.level].speed : HEAVY[e.kind].speed;
  return base * state.diff.speed;
}

// Für die Ziel-Priorität "Stärkster"
function enemyStrength(e) {
  if (e.kind === "bossB") return 100000;
  if (e.kind === "bossA") return 50000;
  if (e.kind === "tank") return 10000 + e.hp;
  return e.level * 100 + Object.keys(e.props).length * 10;
}

function isHeavy(e) {
  return e.kind !== "drone";
}

function isBoss(e) {
  return e.kind === "bossA" || e.kind === "bossB";
}

function createEnemy(spec, pathIndex) {
  const start = pathPoints[pathIndex][0];
  const e = {
    id: nextId++,
    kind: spec.kind,
    level: spec.level || 0,
    origLevel: spec.level || 0,
    props: { ...(spec.props || {}) },
    bar: spec.bar || null,
    path: pathIndex,
    x: start.x,
    y: start.y,
    target: 1,
    dist: 0,
    dir: 0,
    hp: 0,
    maxHp: 0,
    partial: 0,
    slowFactor: 1,
    slowUntil: 0,
    stunUntil: 0,
    frozenUntil: 0,
    frozenBonus: 0,
    burn: null,
    markUntil: 0,
    regenTimer: 3,
    flash: 0,
    wait: 0,
    blockedFrame: -1,
    wobble: Math.random() * Math.PI * 2,
    dead: false,
  };
  if (spec.kind === "tank") {
    const h = HEAVY.tank;
    e.hp = e.maxHp = Math.round((h.hp + state.wave * h.hpPerWave) * state.diff.hp);
  } else if (isBoss(e)) {
    e.hp = e.maxHp = Math.round(HEAVY[spec.kind].hp * state.diff.hp * (spec.hpScale || 1));
  }
  return e;
}

// Setzt einen Gegner auf eine bestimmte Strecke seines Weges (für das Zurückschleudern)
function setEnemyDist(e, d) {
  const pts = pathPoints[e.path];
  const cum = pathCumulative[e.path];
  d = Math.max(0, Math.min(d, cum[cum.length - 1]));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const k = (d - cum[i - 1]) / seg;
  e.x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k;
  e.y = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k;
  e.target = i;
  e.dist = d;
}

function spawnChildren(parent) {
  let list = [];
  if (parent.kind === "tank") list = [{ kind: "drone", level: 5, props: parent.props }, { kind: "drone", level: 5, props: parent.props }];
  else if (parent.kind === "bossA") list = Array.from({ length: 4 }, () => ({ kind: "tank", props: {} }));
  else if (parent.kind === "bossB") list = Array.from({ length: 4 }, () => ({ kind: "bossA", props: {}, bar: "A2", hpScale: 0.5 }));
  list.forEach((spec, i) => {
    const child = createEnemy(spec, parent.path);
    child.target = parent.target;
    child.dir = parent.dir;
    setEnemyDist(child, parent.dist - i * (isBoss(child) ? 30 : 8));
    child.wait = i * (isBoss(child) ? 0.8 : 0.15);
    state.enemies.push(child);
  });
  if (parent.kind === "bossB") showBanner("DAS MUTTERSCHIFF BRICHT AUF!", "4 Omega-Kolosse sind freigekommen!");
}

// Schaden zufügen. Gibt den tatsächlich verursachten Schaden zurück.
// opts: { pierceShield, heavyMult, camoBonus, mirrorMult }
function damageEnemy(e, amount, type, tower, opts = {}) {
  if (e.dead || amount <= 0) return 0;
  const immuneProp = DAMAGE_IMMUNITY[type];
  if (immuneProp && e.props[immuneProp] && !(type === "laser" && opts.pierceShield)) {
    if (Math.random() < 0.3) state.events.push({ type: "deflect", x: e.x, y: e.y });
    return 0;
  }
  let amt = amount;
  if (e.markUntil > state.time) amt += amount >= 1 ? 1 : amount;
  if (e.frozenUntil > state.time && e.frozenBonus) amt += amount >= 1 ? e.frozenBonus : 0;
  if (e.props.camo && opts.camoBonus) amt += opts.camoBonus;
  if (e.props.shield && opts.mirrorMult) amt *= opts.mirrorMult;
  if (isHeavy(e) && opts.heavyMult) amt *= opts.heavyMult;
  e.flash = 0.08;

  let dealt = 0;
  if (e.kind === "drone") {
    e.partial += amt;
    const whole = Math.floor(e.partial + 1e-9);
    if (whole <= 0) return 0;
    e.partial -= whole;
    dealt = Math.min(whole, e.level);
    const color = enemyColor(e);
    e.level -= dealt;
    addGold(dealt * (1 + state.wave * 0.1)); // spätere Wellen bringen mehr Gold pro Stufe
    e.regenTimer = 3;
    if (e.level <= 0) {
      e.dead = true;
      if (tower) tower.stats.kills++;
    }
    state.events.push({ type: "pop", x: e.x, y: e.y, color, level: e.level + dealt, dead: e.dead });
  } else {
    dealt = Math.min(amt, e.hp);
    e.hp -= amt;
    if (e.hp <= 0) {
      e.dead = true;
      const h = HEAVY[e.kind];
      state.gold += h.reward;
      state.texts.push({ x: e.x, y: e.y, text: `+${h.reward}`, life: 1.2, max: 1.2 });
      if (tower) tower.stats.kills++;
      state.events.push({ type: "heavyDeath", x: e.x, y: e.y, kind: e.kind, color: h.color });
      puff(e.x, e.y, h.color, isBoss(e) ? 60 : 24, 60);
      spawnChildren(e);
    }
  }
  if (tower) tower.stats.damage += dealt;
  return dealt;
}

function addGold(amount) {
  state.goldFrac += amount;
  const whole = Math.floor(state.goldFrac);
  state.gold += whole;
  state.goldFrac -= whole;
}

function applySlow(e, factor, time) {
  if (e.props.frost) return;
  if (isBoss(e)) factor = 1 - (1 - factor) * 0.4;
  if (factor < e.slowFactor || e.slowUntil < state.time) e.slowFactor = factor;
  e.slowUntil = Math.max(e.slowUntil, state.time + time);
}

function applyStun(e, time, maxLevel) {
  if (isBoss(e)) return;
  if (maxLevel && e.kind === "drone" && e.level > maxLevel) return;
  if (e.kind === "tank") time *= 0.5;
  e.stunUntil = Math.max(e.stunUntil, state.time + time);
}

function applyBurn(e, dps, time, tower) {
  if (!e.burn || e.burn.dps <= dps) e.burn = { dps, until: state.time + time, tower };
  else e.burn.until = Math.max(e.burn.until, state.time + time);
}

// ---------- Türme ----------
function towerStats(t) {
  const key = t.levels.join("");
  if (t._statsKey === key) return t._stats;
  const type = TOWER_TYPES[t.type];
  const s = { ...type.base, camo: false, heavyMult: 1 };
  type.paths.forEach((path, p) => {
    for (let i = 0; i < t.levels[p]; i++) path.tiers[i].apply(s);
  });
  t._statsKey = key;
  t._stats = s;
  return s;
}

// Werte, die der Turm nach einem bestimmten Upgrade hätte (für die Vorschau)
function previewStats(t, p) {
  const copy = { ...t, levels: [...t.levels], _statsKey: null };
  copy.levels[p]++;
  return towerStats(copy);
}

function priceOf(base) {
  return Math.round((base * state.diff.price) / 5) * 5;
}

function towerCost(type) {
  return priceOf(TOWER_TYPES[type].cost);
}

function upgradeCost(t, p) {
  return priceOf(TOWER_TYPES[t.type].paths[p].tiers[t.levels[p]].cost);
}

// Warum ein Upgrade gerade nicht geht (null = möglich). Regel: höchstens 5-2-0.
function upgradeBlock(t, p) {
  const lv = t.levels;
  const type = TOWER_TYPES[t.type];
  if (lv[p] >= MAX_TIER) return "max";
  if (type.upgradeUnlockWave && state.wave < type.upgradeUnlockWave) return `🔒 ab Welle ${type.upgradeUnlockWave}`;
  const others = [0, 1, 2].filter((q) => q !== p);
  if (lv[p] === 0 && others.every((q) => lv[q] > 0)) return "🔒 nur 2 Wege kombinierbar";
  if (lv[p] + 1 > 2 && others.some((q) => lv[q] > 2)) return "🔒 max. Stufe 2 (anderer Weg ist höher)";
  return null;
}

function sellValue(t) {
  return Math.floor(t.invested * 0.7);
}

function isUnlocked(typeKey) {
  return state.wave >= (TOWER_TYPES[typeKey].unlockWave || 0);
}

function towerAt(col, row) {
  return state.towers.find((t) => t.col === col && t.row === row) || null;
}

function canBuild(col, row) {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS && grid[row][col] === "pad" && !towerAt(col, row);
}

function defaultMortarAim() {
  return { x: 11 * TILE + TILE / 2, y: 5 * TILE };
}

function createTower(typeKey, col, row) {
  return {
    id: nextId++,
    type: typeKey,
    col, row,
    x: col * TILE + TILE / 2,
    y: row * TILE + TILE / 2,
    levels: [0, 0, 0],
    cooldown: typeKey === "station" ? 2 : 0,
    invested: towerCost(typeKey),
    angle: 0,
    recoil: 0,
    priority: typeKey === "mortar" ? "point" : "first",
    aim: typeKey === "mortar" ? defaultMortarAim() : null,
    stats: { damage: 0, kills: 0 },
    shipCount: 0,
    shotCount: 0,
    burstLeft: 0,
    burstTimer: 0,
    shardCd: 0,
    globalCd: 10,
    strikeCd: 15,
    auraCamo: false,
    auraRate: 1,
  };
}

function placeTower(col, row) {
  const typeKey = state.selectedType;
  const type = TOWER_TYPES[typeKey];
  if (!canBuild(col, row)) return false;
  if (!isUnlocked(typeKey)) {
    setInfo(`${type.name} wird ab Welle ${type.unlockWave} freigeschaltet.`);
    return false;
  }
  const cost = towerCost(typeKey);
  if (state.gold < cost) {
    setInfo(`Nicht genug Gold für ${type.name} (${cost} 💰).`);
    return false;
  }
  state.gold -= cost;
  const t = createTower(typeKey, col, row);
  state.towers.push(t);
  puff(t.x, t.y, type.color, 12);
  state.events.push({ type: "build" });
  if (typeKey === "mortar") {
    state.selected = { kind: "tower", tower: t };
    startAiming(t);
  }
  updateHud();
  return true;
}

function upgradeTower(t, p) {
  if (upgradeBlock(t, p)) return;
  const cost = upgradeCost(t, p);
  if (state.gold < cost) return;
  state.gold -= cost;
  t.invested += cost;
  t.levels[p]++;
  puff(t.x, t.y, PATH_COLORS[p], 16, 30);
  state.events.push({ type: "upgrade", tier: t.levels[p] });
  state.preview = null;
  updateHud();
  showTowerInfo(t);
}

function sellTower(t) {
  state.gold += sellValue(t);
  state.towers = state.towers.filter((x) => x !== t);
  state.selected = null;
  state.aiming = null;
  state.preview = null;
  puff(t.x, t.y, "#d0d8ff", 12);
  state.events.push({ type: "sell" });
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
  if (!def) return;
  const cost = priceOf(def.clearCost);
  if (state.gold < cost) return;
  state.gold -= cost;
  puff(s.col * TILE + TILE / 2, s.row * TILE + TILE / 2, kind === "kiosk" ? "#ff4fd8" : "#29e6ff", 18, 20);
  grid[s.row][s.col] = "pad";
  state.cleared.push(`${s.col},${s.row}`);
  View.removeObstacle(s.col, s.row);
  state.selected = null;
  state.events.push({ type: "sell" });
  updateHud();
  setInfo(`${def.name} entfernt – hier kannst du jetzt bauen.`);
}

// ---------- Zielauswahl ----------
function canSee(t, s, e) {
  return !e.props.camo || s.camo || t.auraCamo;
}

function pickTargets(t, s, count, range = s.range, needSight = true) {
  const list = [];
  for (const e of state.enemies) {
    if (e.dead || e.wait > 0) continue;
    if (needSight && !canSee(t, s, e)) continue;
    if (!s.global && Math.hypot(e.x - t.x, e.y - t.y) > range + enemyRadius(e) * 0.5) continue;
    list.push(e);
  }
  const prio = t.priority === "point" ? "first" : t.priority;
  if (prio === "first") list.sort((a, b) => b.dist - a.dist);
  else if (prio === "last") list.sort((a, b) => a.dist - b.dist);
  else if (prio === "strong") list.sort((a, b) => enemyStrength(b) - enemyStrength(a) || b.dist - a.dist);
  else list.sort((a, b) => Math.hypot(a.x - t.x, a.y - t.y) - Math.hypot(b.x - t.x, b.y - t.y));
  return list.slice(0, count);
}

function enemiesNear(x, y, radius, exclude) {
  const list = [];
  for (const e of state.enemies) {
    if (e.dead || e === exclude) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d <= radius + enemyRadius(e) * 0.6) list.push([d, e]);
  }
  list.sort((a, b) => a[0] - b[0]);
  return list.map((x) => x[1]);
}

// ---------- Angriffe ----------
// Explosion mit Flächenschaden; trifft auch Getarnte
function explode(x, y, radius, dmg, type, tower, s = {}, opts = {}) {
  const maxHits = opts.maxHits || s.pierce || 30;
  const hits = enemiesNear(x, y, radius).slice(0, maxHits);
  for (const e of hits) {
    const immune = DAMAGE_IMMUNITY[type] && e.props[DAMAGE_IMMUNITY[type]];
    if (s.burnDps) applyBurn(e, s.burnDps, s.burnTime, tower);
    if (immune) {
      damageEnemy(e, dmg, type, tower, s);
      continue;
    }
    damageEnemy(e, dmg, type, tower, s);
    if (e.dead) continue;
    if (s.slow) applySlow(e, s.slow, s.slowTime || 1);
    if (s.stun) applyStun(e, s.stun, s.stunMaxLevel);
    if (opts.bigStun) applyStun(e, opts.bigStun);
    if (s.emp) {
      e.props.camo = false;
      e.props.regen = false;
    }
    if (s.knockback && !isBoss(e)) setEnemyDist(e, e.dist - s.knockback * (e.kind === "tank" ? 0.4 : 1));
  }
  state.rings.push({ x, y, r: radius, life: 0.4, max: 0.4, color: opts.color || (type === "fire" ? "#ff5a2a" : "#ff9a3d") });
  puff(x, y, opts.color || "#ffb74d", Math.min(18, 6 + radius / 6), 40);
  state.events.push({ type: "boom", x, y, size: radius });
  if (s.cluster && !opts.isCluster) {
    for (let i = 0; i < s.cluster; i++) {
      const a = (i / s.cluster) * Math.PI * 2 + Math.random();
      const d = radius * (0.6 + Math.random() * 0.5);
      explode(x + Math.cos(a) * d, y + Math.sin(a) * d, 22, 1, type, tower, { pierce: 6 }, { isCluster: true, color: "#ffd740" });
    }
  }
}

function laserHit(t, s, target, x, y) {
  const opts = { pierceShield: s.pierceShield, heavyMult: s.heavyMult, camoBonus: s.camoBonus };
  damageEnemy(target, s.dmg, "laser", t, opts);
  if (s.mark) target.markUntil = state.time + s.mark;
  if (s.burnDps) applyBurn(target, s.burnDps, s.burnTime, t);
  // Durchschlag: weitere Gegner direkt dahinter
  if (s.pierce > 1) {
    for (const e of enemiesNear(x, y, 30, target).slice(0, s.pierce - 1)) {
      damageEnemy(e, s.dmg, "laser", t, opts);
      if (s.mark) e.markUntil = state.time + s.mark;
    }
  }
}

function fireLaser(t, s) {
  const targets = pickTargets(t, s, s.shots);
  if (!targets.length) return false;
  t.angle = Math.atan2(targets[0].y - t.y, targets[0].x - t.x);
  for (const target of targets) {
    if (s.beam) {
      laserHit(t, s, target, target.x, target.y);
      state.beams.push({ x1: t.x, y1: t.y, x2: target.x, y2: target.y, color: s.burnDps ? "#ffd740" : "#7ff8ff", life: 0.12, max: 0.12, width: s.burnDps ? 0.07 : 0.045, from: "tower" });
    } else {
      state.projectiles.push({ kind: "bolt", x: t.x, y: t.y, sx: t.x, sy: t.y, tx: target.x, ty: target.y, target, tower: t, s, speed: s.projSpeed, angle: t.angle, rail: s.rail });
    }
  }
  state.events.push({ type: "shoot", tower: "laser", beam: !!s.beam });
  return true;
}

function firePlasma(t, s) {
  const [target] = pickTargets(t, s, 1);
  if (!target) return false;
  t.angle = Math.atan2(target.y - t.y, target.x - t.x);
  t.shotCount++;
  const bigStun = s.bigStunEvery && t.shotCount % s.bigStunEvery === 0;
  state.projectiles.push({ kind: "plasma", x: t.x, y: t.y, sx: t.x, sy: t.y, tx: target.x, ty: target.y, target, tower: t, s, speed: s.projSpeed, angle: t.angle, bigStun });
  state.events.push({ type: "shoot", tower: "plasma" });
  return true;
}

function cryoPulse(t, s) {
  const hits = enemiesNear(t.x, t.y, s.range).filter((e) => e.wait <= 0);
  if (!hits.length) return false;
  for (const e of hits.slice(0, s.pierce)) {
    if (e.props.frost) continue;
    const wasFrozen = e.frozenUntil > state.time;
    if (s.dmg) damageEnemy(e, s.dmg, "cold", t);
    if (e.dead) continue;
    applySlow(e, Math.max(0.1, s.slow), s.slowTime);
    if (s.freeze) {
      if (isBoss(e)) {
        if (s.bossFreeze) applySlow(e, 0.25, s.freeze);
      } else {
        e.frozenUntil = state.time + s.freeze * (e.kind === "tank" ? 0.5 : 1);
        e.frozenBonus = s.frozenBonus || 0;
      }
    }
    if (s.shatter && wasFrozen) {
      for (const n of enemiesNear(e.x, e.y, 35, e).slice(0, 6)) damageEnemy(n, s.shatter, "pure", t);
      state.events.push({ type: "shatter", x: e.x, y: e.y });
    }
  }
  state.rings.push({ x: t.x, y: t.y, r: s.range, life: 0.5, max: 0.5, color: "#b9a8ff" });
  state.events.push({ type: "shoot", tower: "cryo" });
  return true;
}

function fireShards(t, s) {
  const shardSight = { ...s, camo: s.camo };
  const targets = pickTargets(t, shardSight, s.shards, s.range * 1.15);
  if (!targets.length) return false;
  for (const target of targets) {
    state.projectiles.push({ kind: "shard", x: t.x, y: t.y, sx: t.x, sy: t.y, tx: target.x, ty: target.y, target, tower: t, s, speed: 420, angle: 0 });
  }
  return true;
}

function fireMortar(t, s) {
  if (!state.enemies.some((e) => !e.dead && e.wait <= 0)) return false;
  let aim = t.aim;
  if (s.autoTarget && t.priority !== "point") {
    const [target] = pickTargets(t, { ...s, camo: true }, 1);
    if (target) aim = { x: target.x, y: target.y };
  }
  const a = Math.random() * Math.PI * 2;
  const d = Math.random() * s.inaccuracy;
  const tx = aim.x + Math.cos(a) * d;
  const ty = aim.y + Math.sin(a) * d;
  t.angle = Math.atan2(ty - t.y, tx - t.x);
  state.projectiles.push({ kind: "shell", x: t.x, y: t.y, sx: t.x, sy: t.y, tx, ty, tower: t, s, time: 0, dur: 1.0, angle: t.angle });
  state.events.push({ type: "shoot", tower: "mortar" });
  return true;
}

function shellImpact(p) {
  const s = p.s;
  explode(p.tx, p.ty, s.splash, s.dmg, s.type, p.tower, s);
  if (s.shrapnel) {
    for (const e of enemiesNear(p.tx, p.ty, 70).slice(0, s.shrapnel)) {
      damageEnemy(e, 1, "pure", p.tower);
      state.beams.push({ x1: p.tx, y1: p.ty, x2: e.x, y2: e.y, color: "#ffd740", life: 0.1, max: 0.1, width: 0.02, from: "ground" });
    }
  }
}

function orbitalStrike(t, s) {
  let aim = t.aim;
  if (s.autoTarget && t.priority !== "point") {
    const [target] = pickTargets(t, { ...s, camo: true }, 1);
    if (target) aim = { x: target.x, y: target.y };
  }
  explode(aim.x, aim.y, s.strikeRadius, s.strikeDmg, "pure", t, { ...s, pierce: 200, cluster: 0 }, { color: "#ff3cac" });
  state.beams.push({ x1: aim.x, y1: aim.y, x2: aim.x, y2: aim.y, color: "#ff8ae6", life: 0.6, max: 0.6, width: 0.6, from: "sky" });
  state.events.push({ type: "strike", x: aim.x, y: aim.y });
}

// ---------- Raumschiffe ----------
function launchShips(t, s) {
  for (let i = 0; i < s.ships; i++) {
    const path = t.shipCount % shipPaths.length;
    t.shipCount++;
    const start = shipPaths[path][0];
    state.ships.push({
      tower: t,
      path,
      x: start.x,
      y: start.y,
      target: 1,
      dir: Math.PI,
      hp: s.shipHp,
      maxHp: s.shipHp,
      s,
      wait: i * 0.35,
      tick: 0,
      laserCd: 0,
      speed: 60,
      radius: s.bigShips ? 18 : 12,
      flash: 0,
      contact: false,
      dead: false,
    });
  }
  state.events.push({ type: "ship" });
}

function explodeShip(ship) {
  ship.dead = true;
  const s = ship.s;
  explode(ship.x, ship.y, s.blastRadius, s.blastDmg, s.blastType, ship.tower, { ...s, pierce: 40, cluster: 0 }, { color: s.blastType === "fire" ? "#ff5a2a" : "#ff9100" });
  if (s.chain) {
    for (let i = 0; i < s.chain; i++) {
      const a = (i / s.chain) * Math.PI * 2;
      explode(ship.x + Math.cos(a) * s.blastRadius * 0.7, ship.y + Math.sin(a) * s.blastRadius * 0.7, s.blastRadius * 0.55,
        Math.ceil(s.blastDmg / 2), s.blastType, ship.tower, { ...s, pierce: 20, cluster: 0 }, { color: "#ffd740" });
    }
  }
}

function updateShips(dt) {
  for (const ship of state.ships) {
    if (ship.dead) continue;
    if (ship.wait > 0) {
      ship.wait -= dt;
      continue;
    }
    const s = ship.s;
    ship.flash = Math.max(0, ship.flash - dt);
    if (s.shipRegen) ship.hp = Math.min(ship.maxHp, ship.hp + s.shipRegen * dt);
    if (s.shipLaser) {
      ship.laserCd -= dt;
      if (ship.laserCd <= 0) {
        const [e] = enemiesNear(ship.x, ship.y, 90);
        if (e) {
          ship.laserCd = 0.5;
          damageEnemy(e, 1, "laser", ship.tower);
          state.beams.push({ x1: ship.x, y1: ship.y, x2: e.x, y2: e.y, color: "#ff8ae6", life: 0.1, max: 0.1, width: 0.03, from: "ship" });
        }
      }
    }
    // Kontakt mit Gegnern: Schiff stoppt, rammt und hält Gegner auf
    ship.contact = false;
    ship.tick += dt;
    const doTick = ship.tick >= 0.12;
    if (doTick) ship.tick = 0;
    for (const e of state.enemies) {
      if (e.dead || e.wait > 0) continue;
      if (Math.hypot(e.x - ship.x, e.y - ship.y) > ship.radius + enemyRadius(e)) continue;
      ship.contact = true;
      if (!isBoss(e)) e.blockedFrame = state.frame;
      if (doTick) {
        const dealt = damageEnemy(e, s.ramDmg * s.ramMult, "pure", ship.tower, { heavyMult: s.heavyMult });
        ship.hp -= isBoss(e) ? 25 : e.kind === "tank" ? Math.max(2, dealt * 2) : Math.max(1, dealt / s.ramMult);
        ship.flash = 0.06;
      }
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
    if (ship.target >= pts.length) explodeShip(ship); // am Ende des Weges: Selbstzerstörung
  }
}

// ---------- Wellen ----------
function startWave() {
  if (state.waveActive || state.gameOver || state.wave >= FINAL_WAVE) return;
  state.wave++;
  state.spawnQueue = buildWave(state.wave, state.diff);
  state.waveTime = 0;
  state.waveActive = true;
  state.autoTimer = 0;
  const note = waveAnnouncement(state.wave);
  const isBossWave = state.wave === 30 || state.wave === FINAL_WAVE || BOSS_RETURNS[state.wave];
  showBanner(isBossWave ? `⚠ Welle ${state.wave} ⚠` : `Welle ${state.wave}`, note);
  if (state.wave === TOWER_TYPES.station.unlockWave) setTimeout(() => showBanner(`Welle ${state.wave}`, "Raumstation freigeschaltet!"), 2800);
  if (state.wave === TOWER_TYPES.station.upgradeUnlockWave) setTimeout(() => showBanner(`Welle ${state.wave}`, "Raumstation-Verbesserungen freigeschaltet!"), 2800);
  state.events.push({ type: isBossWave ? "bossWave" : "waveStart" });
  renderShop();
  const t = selectedTower();
  if (t) showTowerInfo(t);
  updateHud();
}

function finishWave() {
  state.waveActive = false;
  if (state.wave >= FINAL_WAVE) {
    endGame(true);
    return;
  }
  const bonus = 100 + state.wave * 25;
  state.gold += bonus;
  setInfo(`Welle ${state.wave} geschafft! +${bonus} 💰 Bonus. Spielstand gespeichert.`);
  state.events.push({ type: "waveEnd" });
  saveGame();
  renderShop();
  if (settings.autoStart) state.autoTimer = 1.5;
}

function endGame(won) {
  state.gameOver = true;
  state.won = won;
  state.ships = [];
  state.buildMode = false;
  writeStorage(SAVE_KEY, null);
  if (won) {
    setInfo(`🏆 Gewonnen auf „${state.diff.name}“! Du hast alle ${FINAL_WAVE} Wellen und das Hyperion-Mutterschiff besiegt. <button id="restart">Zum Hauptmenü</button>`);
    ui.overlay.innerHTML = "<span>GEWONNEN!</span>";
    ui.overlay.className = "won";
    state.events.push({ type: "win" });
  } else {
    const survived = state.wave - 1;
    setInfo(`Game Over! Du hast ${survived} ${survived === 1 ? "Welle" : "Wellen"} überlebt. <button id="restart">Zum Hauptmenü</button>`);
    ui.overlay.innerHTML = "<span>GAME OVER</span>";
    ui.overlay.className = "";
    state.events.push({ type: "lose" });
  }
  document.getElementById("restart").onclick = () => openMenu("main");
  ui.overlay.hidden = false;
}

// ---------- Update ----------
function update(dt) {
  if (state.gameOver || state.paused) return;
  state.time += dt;
  state.frame++;
  const now = state.time;

  if (state.autoTimer > 0) {
    state.autoTimer -= dt;
    if (state.autoTimer <= 0 && !state.waveActive) startWave();
  }

  // Gegner erzeugen
  if (state.waveActive) {
    state.waveTime += dt;
    while (state.spawnQueue.length && state.spawnQueue[0].t <= state.waveTime) {
      const spec = state.spawnQueue.shift();
      const e = createEnemy(spec, spec.path);
      state.enemies.push(e);
      if (isBoss(e)) state.events.push({ type: "bossSpawn" });
    }
  }

  updateShips(dt);

  // Gegner bewegen, Zustände
  for (const e of state.enemies) {
    if (e.dead) continue;
    e.flash = Math.max(0, e.flash - dt);
    e.wobble += dt * 6;
    if (e.slowUntil < now) e.slowFactor = 1;
    if (e.burn) {
      if (e.burn.until < now) e.burn = null;
      else damageEnemy(e, e.burn.dps * dt, "fire", e.burn.tower);
      if (e.dead) continue;
    }
    if (e.props.regen && e.kind === "drone" && e.level < e.origLevel) {
      e.regenTimer -= dt;
      if (e.regenTimer <= 0) {
        e.level++;
        e.regenTimer = 3;
        state.events.push({ type: "regen", x: e.x, y: e.y });
      }
    }
    if (e.wait > 0) {
      e.wait -= dt;
      continue;
    }
    if (e.blockedFrame === state.frame || e.stunUntil > now || e.frozenUntil > now) continue;

    const pts = pathPoints[e.path];
    let move = enemySpeed(e) * e.slowFactor * dt;
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
      const loss = e.kind === "drone" ? e.level : HEAVY[e.kind].lifeDamage;
      state.lives -= loss;
      state.events.push({ type: "leak" });
      if (state.lives <= 0) {
        state.lives = 0;
        endGame(false);
        return;
      }
    }
  }

  // Aura des Orbital-Uplinks
  for (const t of state.towers) {
    t.auraCamo = false;
    t.auraRate = 1;
  }
  for (const u of state.towers) {
    const us = towerStats(u);
    if (!us.auraCamo) continue;
    for (const t of state.towers) {
      if (Math.hypot(t.x - u.x, t.y - u.y) <= us.range) {
        t.auraCamo = true;
        t.auraRate = Math.min(t.auraRate, us.auraRate);
      }
    }
  }

  // Türme
  const fighting = state.enemies.some((e) => !e.dead);
  for (const t of state.towers) {
    const s = towerStats(t);
    t.cooldown -= dt;
    t.recoil = Math.max(0, t.recoil - dt * 4);
    const rate = (s.rate || 1) * t.auraRate;
    if (t.type === "laser") {
      if (t.cooldown <= 0 && fireLaser(t, s)) {
        t.cooldown = rate;
        t.recoil = 1;
      }
    } else if (t.type === "plasma") {
      if (t.burstLeft > 0) {
        t.burstTimer -= dt;
        if (t.burstTimer <= 0 && firePlasma(t, s)) {
          t.burstLeft--;
          t.burstTimer = 0.15;
          t.recoil = 1;
        }
      }
      if (t.cooldown <= 0 && firePlasma(t, s)) {
        t.cooldown = rate;
        t.recoil = 1;
        t.burstLeft = (s.burst || 1) - 1;
        t.burstTimer = 0.15;
      }
    } else if (t.type === "cryo") {
      if (t.cooldown <= 0 && cryoPulse(t, s)) {
        t.cooldown = rate;
        t.recoil = 1;
      }
      if (s.shards) {
        t.shardCd -= dt;
        if (t.shardCd <= 0 && fireShards(t, s)) t.shardCd = s.shardRate * t.auraRate;
      }
      if (s.globalEvery && fighting) {
        t.globalCd -= dt;
        if (t.globalCd <= 0) {
          t.globalCd = s.globalEvery;
          for (const e of state.enemies) applySlow(e, 0.5, 2);
          state.rings.push({ x: (COLS * TILE) / 2, y: (ROWS * TILE) / 2, r: COLS * TILE * 0.6, life: 0.9, max: 0.9, color: "#9fe8ff" });
          state.events.push({ type: "globalFreeze" });
        }
      }
    } else if (t.type === "mortar") {
      if (t.burstLeft > 0) {
        t.burstTimer -= dt;
        if (t.burstTimer <= 0 && fireMortar(t, s)) {
          t.burstLeft--;
          t.burstTimer = 0.18;
        }
      }
      if (t.cooldown <= 0 && fireMortar(t, s)) {
        t.cooldown = rate;
        t.recoil = 1;
        t.burstLeft = (s.burst || 1) - 1;
        t.burstTimer = 0.18;
      }
      if (s.strikeEvery && fighting) {
        t.strikeCd -= dt;
        if (t.strikeCd <= 0) {
          t.strikeCd = s.strikeEvery;
          orbitalStrike(t, s);
        }
      }
    } else if (t.type === "station") {
      if (fighting && t.cooldown <= 0) {
        t.cooldown = s.interval;
        t.recoil = 1;
        launchShips(t, s);
      }
    }
  }

  // Geschosse
  for (const p of state.projectiles) {
    if (p.kind === "shell") {
      p.time += dt;
      const k = Math.min(1, p.time / p.dur);
      p.x = p.sx + (p.tx - p.sx) * k;
      p.y = p.sy + (p.ty - p.sy) * k;
      if (k >= 1) {
        p.done = true;
        shellImpact(p);
      }
      continue;
    }
    if (p.target && !p.target.dead) {
      p.tx = p.target.x;
      p.ty = p.target.y;
    }
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const dist = Math.hypot(dx, dy);
    const step = p.speed * dt;
    p.angle = Math.atan2(dy, dx);
    if (dist > step) {
      p.x += (dx / dist) * step;
      p.y += (dy / dist) * step;
      if (p.kind === "shard" && Math.random() < 0.4) state.particles.push(particle(p.x, p.y, 22, "#e1f5fe", 0.3, 10, 0));
      continue;
    }
    p.done = true;
    const s = p.s;
    if (p.kind === "bolt") {
      if (!p.target.dead) laserHit(p.tower, s, p.target, p.tx, p.ty);
      else if (s.pierce > 1) {
        const [e] = enemiesNear(p.tx, p.ty, 25);
        if (e) laserHit(p.tower, s, e, p.tx, p.ty);
      }
      puff(p.tx, p.ty, "#9ff6ff", 3);
    } else if (p.kind === "plasma") {
      explode(p.tx, p.ty, s.splash, s.dmg, "blast", p.tower, s, { bigStun: p.bigStun ? s.bigStun : 0 });
      if (p.bigStun) {
        for (const e of enemiesNear(p.tx, p.ty, s.splash * 2.5)) applyStun(e, s.bigStun);
        state.rings.push({ x: p.tx, y: p.ty, r: s.splash * 2.5, life: 0.6, max: 0.6, color: "#b388ff" });
      }
    } else if (p.kind === "shard") {
      const type = s.shardPure ? "pure" : "cold";
      const opts = { mirrorMult: s.shardMirror };
      const targets = p.target.dead ? enemiesNear(p.tx, p.ty, 25).slice(0, 1) : [p.target];
      for (const e of targets) damageEnemy(e, s.shardDmg, type, p.tower, opts);
      if (s.shardPierce) for (const e of enemiesNear(p.tx, p.ty, 30, p.target).slice(0, s.shardPierce - 1)) damageEnemy(e, s.shardDmg, type, p.tower, opts);
      puff(p.tx, p.ty, "#d6b8ff", 4);
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
  for (const b of state.beams) b.life -= dt;

  state.enemies = state.enemies.filter((e) => !e.dead);
  state.ships = state.ships.filter((s) => !s.dead);
  state.projectiles = state.projectiles.filter((p) => !p.done);
  if (state.particles.length > 1800) state.particles.splice(0, state.particles.length - 1800);
  state.particles = state.particles.filter((p) => p.life > 0);
  state.texts = state.texts.filter((t) => t.life > 0);
  state.rings = state.rings.filter((r) => r.life > 0);
  state.beams = state.beams.filter((b) => b.life > 0);

  if (!state.gameOver && state.waveActive && state.spawnQueue.length === 0 && state.enemies.length === 0) finishWave();
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
  for (let i = 0; i < n; i++) state.particles.push(particle(x, y, up * 0.5, color, 0.4 + Math.random() * 0.4, 80, 1));
}

// ---------- Spielstand ----------
function saveGame() {
  if (state.gameOver || state.waveActive) return false;
  return writeStorage(SAVE_KEY, {
    v: 2,
    diffKey: state.diffKey,
    wave: state.wave,
    gold: state.gold,
    lives: state.lives,
    cleared: state.cleared,
    towers: state.towers.map((t) => ({
      type: t.type, col: t.col, row: t.row, levels: t.levels, invested: t.invested,
      priority: t.priority, aim: t.aim, stats: t.stats,
    })),
    savedAt: Date.now(),
  });
}

function hasSave() {
  const s = readStorage(SAVE_KEY);
  return s && s.v === 2 ? s : null;
}

function loadGame() {
  const data = hasSave();
  if (!data) return false;
  newGame(data.diffKey);
  for (const key of data.cleared || []) {
    const [c, r] = key.split(",").map(Number);
    if (OBSTACLES[grid[r][c]]) grid[r][c] = "pad";
  }
  state.cleared = [...(data.cleared || [])];
  View.buildMap();
  state.wave = data.wave;
  state.gold = data.gold;
  state.lives = data.lives;
  for (const d of data.towers) {
    const t = createTower(d.type, d.col, d.row);
    Object.assign(t, { levels: d.levels, invested: d.invested, priority: d.priority, aim: d.aim, stats: d.stats || { damage: 0, kills: 0 } });
    state.towers.push(t);
  }
  renderShop();
  updateHud();
  setInfo(`Spielstand geladen: Welle ${state.wave} auf „${state.diff.name}“.`);
  return true;
}

// ---------- Oberfläche ----------
let bannerTimer = null;
function showBanner(title, subtitle) {
  ui.banner.innerHTML = `<div class="title">${title}</div>${subtitle ? `<div class="sub">${subtitle}</div>` : ""}`;
  ui.banner.classList.remove("show");
  void ui.banner.offsetWidth; // Animation neu starten
  ui.banner.classList.add("show");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => ui.banner.classList.remove("show"), 3200);
}

function setInfo(html) {
  ui.info.innerHTML = html;
}

function formatNumber(n) {
  return Math.round(n).toLocaleString("de-DE");
}

function updateHud() {
  ui.lives.textContent = state.lives;
  ui.gold.textContent = formatNumber(state.gold);
  ui.wave.textContent = `${state.wave} / ${FINAL_WAVE}`;
  ui.startWave.disabled = state.waveActive || state.gameOver;
  ui.pause.textContent = state.paused ? "▶ Weiter" : "⏸ Pause";
  ui.pause.classList.toggle("selected", state.paused);
  ui.pausedBadge.hidden = !state.paused;
  ui.auto.classList.toggle("selected", settings.autoStart);
  for (const btn of ui.shop.querySelectorAll("button")) {
    const key = btn.dataset.type;
    btn.disabled = !isUnlocked(key) || state.gold < towerCost(key);
  }
  const t = selectedTower();
  if (t) {
    for (const btn of ui.info.querySelectorAll("button.up")) {
      const p = Number(btn.dataset.p);
      btn.disabled = !!upgradeBlock(t, p) || state.gold < upgradeCost(t, p);
    }
  }
  const clearBtn = document.getElementById("clear");
  if (clearBtn && state.selected && state.selected.kind === "obstacle") {
    const def = OBSTACLES[grid[state.selected.row][state.selected.col]];
    clearBtn.disabled = !def || state.gold < priceOf(def.clearCost);
  }
}

function renderShop() {
  ui.shop.innerHTML = "";
  Object.entries(TOWER_TYPES).forEach(([key, t], i) => {
    const btn = document.createElement("button");
    btn.dataset.type = key;
    btn.title = `${t.desc}\n${CAMO_INFO[key]}`;
    const lock = isUnlocked(key) ? "" : ` 🔒 ab Welle ${t.unlockWave}`;
    btn.innerHTML = `<span class="key">${i + 1}</span><span class="swatch" style="background:${t.color};box-shadow:0 0 8px ${t.color}"></span>${t.name} (${formatNumber(towerCost(key))} 💰)${lock}`;
    if (state.buildMode && key === state.selectedType) btn.classList.add("selected");
    btn.onclick = () => selectTowerType(key);
    ui.shop.appendChild(btn);
  });
}

function selectTowerType(key) {
  state.selectedType = key;
  state.buildMode = true;
  state.aiming = null;
  state.selected = null;
  state.preview = null;
  renderShop();
  updateHud();
  const t = TOWER_TYPES[key];
  const lock = isUnlocked(key) ? "" : ` <b>Wird ab Welle ${t.unlockWave} freigeschaltet.</b>`;
  setInfo(`<b>${t.name}</b>: ${t.desc}${lock}<br><span class="camo-note">👁 ${CAMO_INFO[key]}</span><br><small>Klicke auf ein freies Feld im Raster. Umschalttaste gedrückt halten für mehrere Türme, Esc oder Rechtsklick bricht ab.</small>`);
}

function cancelBuild() {
  if (state.aiming) {
    state.aiming = null;
    const t = selectedTower();
    if (t) showTowerInfo(t);
    return;
  }
  if (!state.buildMode) return;
  state.buildMode = false;
  renderShop();
  setInfo("Bauen abgebrochen.");
}

function startAiming(t) {
  state.aiming = t;
  state.buildMode = false;
  renderShop();
  showTowerInfo(t);
}

function towerStatLines(t, s) {
  const lines = [];
  if (t.type === "station") {
    lines.push(`Schiffe: ${s.ships} alle ${s.interval.toFixed(1)} s`, `Schiffsleben ${Math.round(s.shipHp)}`, `Explosion ${Math.round(s.blastDmg)} (${DAMAGE_NAMES[s.blastType]})`);
  } else if (t.type === "cryo") {
    lines.push(`Puls alle ${s.rate.toFixed(1)} s`, `Verlangsamung ${Math.round((1 - s.slow) * 100)} % / ${s.slowTime.toFixed(1)} s`, `Reichweite ${Math.round(s.range)}`);
    if (s.dmg) lines.push(`Schaden ${s.dmg}`);
    if (s.shards) lines.push(`Splitter ${s.shards}× ${s.shardDmg} Schaden`);
  } else {
    lines.push(`Schaden ${s.dmg}`, `${(1 / s.rate).toFixed(1)} Schuss/s`, s.global ? "Reichweite: ganze Karte" : `Reichweite ${Math.round(s.range)}`, `Typ: ${DAMAGE_NAMES[s.type]}`);
    if (s.pierce > 1 && t.type === "laser") lines.push(`Durchschlag ${s.pierce}`);
  }
  return lines;
}

function camoText(t, s) {
  if (t.type === "mortar") return '<span class="tag on">👁 trifft Getarnte (Flächenschaden)</span>';
  if (t.type === "station") return s.shipLaser ? '<span class="tag on">👁 Schiffslaser erkennen Tarnung</span>' : '<span class="tag">Schiffe rammen auch Getarnte</span>';
  if (s.camo || t.auraCamo) return '<span class="tag on">👁 Erkennt Tarnung</span>';
  return '<span class="tag off">Keine Tarnerkennung</span>';
}

function showTowerInfo(t) {
  const s = towerStats(t);
  const type = TOWER_TYPES[t.type];
  let html = `<div class="tower-head"><b style="color:${type.color}">${type.name}</b> ${camoText(t, s)}</div>`;
  html += `<div class="tower-stats">${towerStatLines(t, s).join(" · ")}</div>`;
  html += `<div class="tower-stats dim">Gesamt-Schaden ${formatNumber(t.stats.damage)} · Zerstört ${formatNumber(t.stats.kills)} · Ausbau ${t.levels.join("-")}</div>`;

  if (t.type !== "station" && t.type !== "cryo") {
    const prios = { ...PRIORITIES };
    if (t.type === "mortar") {
      html += `<div class="prio"><button id="aimBtn" class="${state.aiming === t ? "selected" : ""}">🎯 Zielpunkt setzen</button>`;
      if (s.autoTarget) {
        html += ` Ziel: <button data-prio="point" class="${t.priority === "point" ? "selected" : ""}">Zielpunkt</button>`;
        for (const [k, v] of Object.entries(prios)) html += `<button data-prio="${k}" class="${t.priority === k ? "selected" : ""}">${v}</button>`;
      }
      html += "</div>";
    } else {
      html += '<div class="prio">Ziel:';
      for (const [k, v] of Object.entries(prios)) html += ` <button data-prio="${k}" class="${t.priority === k ? "selected" : ""}">${v}</button>`;
      html += "</div>";
    }
  }
  if (state.aiming === t) html += '<div class="aim-hint">Klicke auf die Karte, um den Zielpunkt festzulegen (Esc bricht ab).</div>';

  html += '<div class="paths">';
  type.paths.forEach((path, p) => {
    const lvl = t.levels[p];
    const pips = Array.from({ length: MAX_TIER }, (_, i) => `<i class="${i < lvl ? "on" : ""}" style="--c:${PATH_COLORS[p]}"></i>`).join("");
    const owned = lvl > 0 ? path.tiers[lvl - 1].name : "–";
    const block = upgradeBlock(t, p);
    let button;
    if (block === "max") button = '<button class="up" disabled>Maximal ausgebaut</button>';
    else if (block) button = `<button class="up locked" disabled data-p="${p}">${path.tiers[lvl].name}<br><small>${block}</small></button>`;
    else button = `<button class="up" data-p="${p}" style="--accent:${PATH_COLORS[p]}">${path.tiers[lvl].name}<br><small>${formatNumber(upgradeCost(t, p))} 💰</small></button>`;
    html += `<div class="path"><div class="path-name" style="color:${PATH_COLORS[p]}">${path.name}</div><div class="pips">${pips}</div><div class="owned">${owned}</div>${button}</div>`;
  });
  html += "</div>";
  html += '<div id="upPreview" class="preview">Fahre mit der Maus über ein Upgrade, um eine Vorschau zu sehen. Erlaubt ist höchstens 5-2-0: ein Weg bis 5, ein zweiter bis 2.</div>';
  html += `<button id="sell">Verkaufen (+${formatNumber(sellValue(t))} 💰)</button>`;
  setInfo(html);

  for (const btn of ui.info.querySelectorAll("button.up[data-p]")) {
    const p = Number(btn.dataset.p);
    btn.onclick = () => upgradeTower(t, p);
    btn.onmouseenter = () => showUpgradePreview(t, p);
    btn.onfocus = () => showUpgradePreview(t, p);
    btn.onmouseleave = () => {
      state.preview = null;
    };
  }
  for (const btn of ui.info.querySelectorAll("button[data-prio]")) {
    btn.onclick = () => {
      t.priority = btn.dataset.prio;
      showTowerInfo(t);
    };
  }
  const aimBtn = document.getElementById("aimBtn");
  if (aimBtn) aimBtn.onclick = () => startAiming(t);
  document.getElementById("sell").onclick = () => sellTower(t);
  updateHud();
}

function showUpgradePreview(t, p) {
  if (t.levels[p] >= MAX_TIER) return;
  const tier = TOWER_TYPES[t.type].paths[p].tiers[t.levels[p]];
  const now = towerStats(t);
  const next = previewStats(t, p);
  const changes = [];
  if (!now.global && next.range !== now.range) changes.push(`Reichweite ${Math.round(now.range)} → ${Math.round(next.range)}`);
  if (next.dmg !== now.dmg && t.type !== "station") changes.push(`Schaden ${now.dmg} → ${next.dmg}`);
  if (next.rate !== now.rate && now.rate) changes.push(`Feuerrate ${(1 / now.rate).toFixed(1)} → ${(1 / next.rate).toFixed(1)}/s`);
  if (next.camo && !now.camo) changes.push("👁 erkennt danach Tarnung");
  const block = upgradeBlock(t, p);
  document.getElementById("upPreview").innerHTML =
    `<b>${tier.name}</b> (Stufe ${t.levels[p] + 1}): ${tier.desc}${changes.length ? `<br><small>${changes.join(" · ")}</small>` : ""}${block && block !== "max" ? `<br><small class="warn">${block}</small>` : ""}`;
  state.preview = { tower: t, range: next.range };
}

function showObstacleInfo(col, row) {
  const def = OBSTACLES[grid[row][col]];
  setInfo(`<b>${def.name}</b> – blockiert dieses Feld. <button id="clear">Entfernen (${formatNumber(priceOf(def.clearCost))} 💰)</button>`);
  document.getElementById("clear").onclick = clearObstacle;
  updateHud();
}

function renderLegend() {
  const levels = DRONE_LEVELS.slice(1).map((d, i) =>
    `<span class="lvl"><span class="swatch" style="background:${d.color};box-shadow:0 0 8px ${d.color}"></span>Stufe ${i + 1}</span>`).join(" ");
  const props = Object.values(PROPS).map((p) => `<div class="enemy"><b>${p.icon} ${p.name}</b> (ab Welle ${p.from}) – ${p.desc}</div>`).join("");
  ui.legend.innerHTML =
    `<div class="enemy"><b>Stufen-Drohnen</b> – Jeder Schadenspunkt senkt die Stufe um 1. Stufe 1 wird zerstört. Höhere Stufen sind schneller. Ein Gegner, der durchkommt, kostet so viele Leben, wie er Stufen hat.<br>${levels}</div>` +
    `<div class="enemy"><b>Spezialeigenschaften</b> (auch kombiniert):</div>${props}` +
    `<div class="enemy"><b>Panzerkern</b> (ab Welle 22) – hält viel aus und zerfällt in zwei Stufe-5-Drohnen.</div>` +
    `<div class="enemy"><b>Omega-Koloss</b> – Boss in Welle 30, kehrt ab Welle 40 immer wieder zurück. Zerfällt in 4 Panzerkerne.</div>` +
    `<div class="enemy"><b>Hyperion-Mutterschiff</b> – Endboss in Welle 50. In ihm stecken 4 Omega-Kolosse.</div>`;
}

// Lebensanzeigen der Bosse
const bossBarEls = new Map();
function updateBossBars() {
  const alive = new Set();
  for (const e of state.enemies) {
    if (!e.bar || e.dead) continue;
    alive.add(e.id);
    let el = bossBarEls.get(e.id);
    if (!el) {
      el = document.createElement("div");
      el.className = `bossbar bar-${e.bar}`;
      el.innerHTML = `<div class="name">${HEAVY[e.kind].name}</div><div class="track"><div class="fill"></div><div class="segments"></div></div>`;
      ui.bossBars.appendChild(el);
      bossBarEls.set(e.id, el);
    }
    const k = Math.max(0, e.hp / e.maxHp);
    el.querySelector(".fill").style.width = `${k * 100}%`;
    el.classList.toggle("low", k < 0.25);
  }
  for (const [id, el] of bossBarEls) {
    if (!alive.has(id)) {
      el.remove();
      bossBarEls.delete(id);
    }
  }
}

// ---------- Hauptmenü ----------
let menuScreen = null;
function openMenu(screen) {
  menuScreen = screen;
  if (state && !state.gameOver) state.paused = true;
  ui.menu.hidden = false;
  document.body.classList.add("in-menu");
  View.setMenuMode(true);
  renderMenu();
}

function closeMenu() {
  menuScreen = null;
  ui.menu.hidden = true;
  document.body.classList.remove("in-menu");
  View.setMenuMode(false);
  if (state) state.paused = false;
  updateHud();
}

function renderMenu() {
  const save = hasSave();
  const inGame = state && state.wave > 0 && !state.gameOver;
  let html = '<div class="menu-title">NEO-CITY<span>DEFENSE</span></div>';
  if (menuScreen === "main") {
    html += '<div class="menu-buttons">';
    if (inGame) html += '<button data-act="resume">▶ Zurück zum Spiel</button>';
    if (save) html += `<button data-act="continue">⟲ Weiterspielen <small>Welle ${save.wave} · ${DIFFICULTIES[save.diffKey].name}</small></button>`;
    html += '<button data-act="new">✦ Neues Spiel</button>';
    html += '<button data-act="settings">⚙ Einstellungen</button>';
    html += '<button data-act="help">? Anleitung</button>';
    html += "</div>";
  } else if (menuScreen === "new") {
    html += '<div class="menu-sub">Schwierigkeit wählen</div><div class="menu-buttons">';
    for (const [k, d] of Object.entries(DIFFICULTIES)) {
      html += `<button data-diff="${k}">${d.name}<small>${d.desc} ${d.lives} Leben · ${d.gold} 💰</small></button>`;
    }
    html += '<button data-act="main" class="back">← Zurück</button></div>';
  } else if (menuScreen === "settings") {
    html += '<div class="menu-sub">Einstellungen</div><div class="menu-settings">';
    html += `<label><input type="checkbox" id="setMusic" ${settings.music ? "checked" : ""}> Musik</label><input type="range" id="setMusicVol" min="0" max="1" step="0.05" value="${settings.musicVol}">`;
    html += `<label><input type="checkbox" id="setSfx" ${settings.sfx ? "checked" : ""}> Soundeffekte</label><input type="range" id="setSfxVol" min="0" max="1" step="0.05" value="${settings.sfxVol}">`;
    html += `<label class="wide"><input type="checkbox" id="setAuto" ${settings.autoStart ? "checked" : ""}> Wellen automatisch starten</label>`;
    html += "</div><div class=\"menu-buttons\">";
    const canSave = state && state.wave > 0 && !state.waveActive && !state.gameOver;
    html += `<button data-act="save" ${canSave ? "" : "disabled"}>💾 Spielstand speichern<small>${canSave ? "Speichert den aktuellen Stand" : "Nur zwischen den Wellen möglich"}</small></button>`;
    html += `<button data-act="load" ${save ? "" : "disabled"}>📂 Spielstand laden${save ? `<small>Welle ${save.wave} · ${DIFFICULTIES[save.diffKey].name}</small>` : "<small>Kein Spielstand vorhanden</small>"}</button>`;
    html += `<button data-act="delete" ${save ? "" : "disabled"}>🗑 Spielstand löschen</button>`;
    html += '<button data-act="main" class="back">← Zurück</button></div>';
    html += '<div class="menu-note" id="menuNote"></div>';
  } else if (menuScreen === "help") {
    html += `<div class="menu-help">
      <p><b>Ziel:</b> Überstehe ${FINAL_WAVE} Wellen. In Welle 30 kommt der Omega-Koloss, in Welle 50 das Hyperion-Mutterschiff.</p>
      <p><b>Bauen:</b> Turm unten wählen (Tasten 1–5), dann ein Feld im Hologramm-Raster anklicken. Umschalttaste für mehrere Türme, Esc bricht ab.</p>
      <p><b>Upgrades:</b> Jeder Turm hat 3 Ausbauwege mit je 5 Stufen. Maximal 5-2-0: ein Weg bis 5, ein zweiter bis 2.</p>
      <p><b>Gegner:</b> Jeder Schadenspunkt senkt die Stufe einer Drohne. Achte auf Spezialgegner (Tarnung, Frostschild, Explosionspanzer, Spiegelpanzer, Regeneration).</p>
      <p><b>Steuerung:</b> Leertaste = Welle starten, P = Pause (Bauen geht weiter), Maus ziehen = Kamera drehen, Rechte Maustaste = verschieben, Mausrad = zoomen.</p>
    </div><div class="menu-buttons"><button data-act="main" class="back">← Zurück</button></div>`;
  }
  ui.menu.innerHTML = `<div class="menu-panel">${html}</div>`;

  for (const btn of ui.menu.querySelectorAll("button[data-act]")) {
    btn.onclick = () => {
      Sound.init();
      Sound.play("click");
      const act = btn.dataset.act;
      if (act === "resume") closeMenu();
      else if (act === "continue") {
        if (loadGame()) closeMenu();
      } else if (act === "save") {
        const ok = saveGame();
        document.getElementById("menuNote").textContent = ok ? "Spielstand gespeichert." : "Speichern nicht möglich.";
        renderMenuSoon();
      } else if (act === "load") {
        if (loadGame()) closeMenu();
      } else if (act === "delete") {
        writeStorage(SAVE_KEY, null);
        renderMenu();
      } else {
        openMenu(act);
      }
    };
  }
  for (const btn of ui.menu.querySelectorAll("button[data-diff]")) {
    btn.onclick = () => {
      Sound.init();
      Sound.play("click");
      newGame(btn.dataset.diff);
      closeMenu();
      showBanner("Neo-City Defense", `Schwierigkeit: ${DIFFICULTIES[btn.dataset.diff].name} – Viel Erfolg!`);
    };
  }
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.oninput = el.onchange = () => {
      Sound.init();
      fn(el);
      saveSettings();
      Sound.applySettings(settings);
      updateHud();
    };
  };
  bind("setMusic", (el) => { settings.music = el.checked; });
  bind("setMusicVol", (el) => { settings.musicVol = Number(el.value); });
  bind("setSfx", (el) => { settings.sfx = el.checked; });
  bind("setSfxVol", (el) => { settings.sfxVol = Number(el.value); });
  bind("setAuto", (el) => { settings.autoStart = el.checked; });
}

function renderMenuSoon() {
  setTimeout(() => {
    if (menuScreen === "settings") {
      const note = document.getElementById("menuNote")?.textContent;
      renderMenu();
      const el = document.getElementById("menuNote");
      if (el && note) el.textContent = note;
    }
  }, 50);
}

// ---------- Eingabe ----------
// Wird von scene.js aufgerufen, wenn auf das Spielfeld geklickt wurde (px/py = genaue Position)
function handleTileClick(col, row, keepBuilding = false, px, py) {
  if (!state || state.gameOver) return;
  if (state.aiming) {
    state.aiming.aim = { x: px, y: py };
    const t = state.aiming;
    state.aiming = null;
    state.events.push({ type: "click" });
    showTowerInfo(t);
    return;
  }
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
  const tower = towerAt(col, row);
  if (tower) {
    state.buildMode = false;
    renderShop();
    state.selected = { kind: "tower", tower };
    state.events.push({ type: "click" });
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
  state.preview = null;
  if (cell === "pool") setInfo("Auf einem Energiesee kann nicht gebaut werden.");
  else if (cell === "gate") setInfo("Das ist dein Stadttor – verteidige es!");
  else if (state.buildMode && canBuild(col, row)) {
    if (placeTower(col, row) && !keepBuilding && !state.aiming) {
      state.buildMode = false;
      renderShop();
      setInfo(`${TOWER_TYPES[state.selectedType].name} gebaut. Klicke auf den Turm, um ihn zu verbessern.`);
    }
  } else if (!state.buildMode) setInfo("Wähle unten einen Turm aus, um zu bauen.");
}

function togglePause() {
  if (!state || state.gameOver) return;
  state.paused = !state.paused;
  state.events.push({ type: "click" });
  updateHud();
}

ui.startWave.addEventListener("click", () => {
  Sound.init();
  startWave();
});
ui.pause.addEventListener("click", togglePause);
ui.speed.addEventListener("click", () => {
  state.speed = state.speed === 1 ? 2 : state.speed === 2 ? 3 : 1;
  ui.speed.textContent = `Tempo: ${state.speed}x`;
});
ui.auto.addEventListener("click", () => {
  settings.autoStart = !settings.autoStart;
  saveSettings();
  if (settings.autoStart && state && !state.waveActive && state.wave > 0 && !state.gameOver) state.autoTimer = 1.5;
  updateHud();
});
ui.resetCamera.addEventListener("click", () => View.resetCamera());
ui.menuButton.addEventListener("click", () => openMenu("main"));

document.addEventListener("keydown", (ev) => {
  if (!ui.menu.hidden) {
    if (ev.key === "Escape" && state && state.wave > 0 && !state.gameOver) closeMenu();
    return;
  }
  if (ev.target && ev.target.tagName === "INPUT") return;
  if (ev.key === "Escape") cancelBuild();
  if (ev.key === " ") {
    ev.preventDefault();
    Sound.init();
    startWave();
  }
  if (ev.key === "p" || ev.key === "P") togglePause();
  const keys = Object.keys(TOWER_TYPES);
  const idx = Number(ev.key) - 1;
  if (idx >= 0 && idx < keys.length) selectTowerType(keys[idx]);
});
document.addEventListener("pointerdown", () => Sound.init(), { once: true });

// ---------- Spielschleife ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (ui.menu.hidden) {
    for (let i = 0; i < state.speed; i++) update(dt);
    updateBossBars();
    const t = selectedTower();
    if (t && state.frame % 30 === 0 && !ui.info.matches(":hover")) {
      const dmgEl = ui.info.querySelector(".tower-stats.dim");
      if (dmgEl) dmgEl.textContent = `Gesamt-Schaden ${formatNumber(t.stats.damage)} · Zerstört ${formatNumber(t.stats.kills)} · Ausbau ${t.levels.join("-")}`;
    }
    updateHud();
  }
  View.render(dt);
  Sound.handleEvents(state.events, state);
  state.events.length = 0;
  requestAnimationFrame(loop);
}

View.init(document.getElementById("view"));
Sound.applySettings(settings);
renderLegend();
newGame("normal");
openMenu("main");
requestAnimationFrame(loop);
