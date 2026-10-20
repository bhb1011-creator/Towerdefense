"use strict";

// Spezialfähigkeiten der Türme (freigeschaltet ab einem Stufe-5-Upgrade) und dauerhafte Erfolge.
// Wird vor game.js geladen; die Funktionen greifen erst zur Laufzeit auf den Spielzustand zu.

// ---------- Spezialfähigkeiten ----------
const ABILITIES = {
  laser: { name: "Überladung", icon: "⚡", cd: 45, desc: "Alle Lasertürme feuern 6 Sekunden lang dreimal so schnell." },
  plasma: { name: "Feuersturm", icon: "☄", cd: 50, desc: "8 schwere Plasma-Einschläge auf die vordersten Aliens (trifft auch Explosionspanzer)." },
  cryo: { name: "Frost-Nova", icon: "❄", cd: 60, desc: "Friert alle Aliens 3 Sekunden ein. Bosse werden stark verlangsamt." },
  mortar: { name: "Sperrfeuer", icon: "🎯", cd: 50, desc: "12 Granaten regnen 3 Sekunden lang auf die stärksten Aliens." },
  station: { name: "Kamikaze-Geschwader", icon: "🚀", cd: 60, desc: "Startet sofort 8 gepanzerte Schiffe vom Stadttor." },
};

function abilityUnlocked(type) {
  return state.towers.some((t) => t.type === type && Math.max(...t.levels) >= MAX_TIER);
}

function abilityTower(type) {
  return state.towers.find((t) => t.type === type && Math.max(...t.levels) >= MAX_TIER) || null;
}

function useAbility(type) {
  if (!state || state.gameOver || !abilityUnlocked(type)) return false;
  state.abilityCd = state.abilityCd || {};
  if ((state.abilityCd[type] || 0) > 0) return false;
  const tower = abilityTower(type);
  const alive = state.enemies.filter((e) => !e.dead && e.wait <= 0 && !e.inTunnel);
  if (type === "laser") {
    state.overchargeUntil = state.time + 6;
  } else if (type === "plasma") {
    const front = [...alive].sort((a, b) => b.dist - a.dist).slice(0, 8);
    front.forEach((e, i) => state.pendingStrikes.push({ at: state.time + i * 0.12, x: e.x, y: e.y, kind: "fire", tower }));
    if (!front.length) return false;
  } else if (type === "cryo") {
    for (const e of alive) {
      if (isBoss(e)) applySlow(e, 0.35, 4);
      else if (!e.props.frost) e.frozenUntil = Math.max(e.frozenUntil, state.time + 3);
      else applySlow(e, 0.7, 2);
    }
    state.rings.push({ x: (COLS * TILE) / 2, y: (ROWS * TILE) / 2, r: COLS * TILE * 0.7, life: 1.1, max: 1.1, color: "#bff4ff" });
    state.events.push({ type: "globalFreeze" });
  } else if (type === "mortar") {
    const targets = [...alive].sort((a, b) => enemyStrength(b) - enemyStrength(a));
    if (!targets.length) return false;
    for (let i = 0; i < 12; i++) {
      const e = targets[i % targets.length];
      state.pendingStrikes.push({ at: state.time + i * 0.25, target: e, kind: "shell", tower });
    }
  } else if (type === "station") {
    const s = towerStats(tower);
    launchShips(tower, { ...s, ships: 8, shipHp: s.shipHp * 2, blastDmg: s.blastDmg * 1.5 });
  }
  state.abilityCd[type] = ABILITIES[type].cd;
  state.events.push({ type: "ability", ability: type });
  showBanner(`${ABILITIES[type].icon} ${ABILITIES[type].name}`, "");
  Achievements.add("abilities", 1);
  return true;
}

// Läuft in jedem Spielschritt: Abklingzeiten und verzögerte Einschläge
function updateAbilities(dt) {
  state.abilityCd = state.abilityCd || {};
  for (const k of Object.keys(state.abilityCd)) state.abilityCd[k] = Math.max(0, state.abilityCd[k] - dt);
  state.pendingStrikes = state.pendingStrikes || [];
  for (let i = state.pendingStrikes.length - 1; i >= 0; i--) {
    const st = state.pendingStrikes[i];
    if (st.at > state.time) continue;
    state.pendingStrikes.splice(i, 1);
    if (st.kind === "fire") {
      explode(st.x, st.y, 70, 8, "fire", st.tower, { pierce: 40 }, { color: "#ff5a1a" });
    } else if (st.kind === "shell" && st.tower) {
      const e = st.target;
      const x = e && !e.dead ? e.x : st.tower.aim ? st.tower.aim.x : st.tower.x;
      const y = e && !e.dead ? e.y : st.tower.aim ? st.tower.aim.y : st.tower.y;
      const s = { splash: 60, dmg: 6, type: "blast", pierce: 30 };
      state.projectiles.push({ kind: "shell", x: st.tower.x, y: st.tower.y, sx: st.tower.x, sy: st.tower.y, tx: x, ty: y, tower: st.tower, s, time: 0, dur: 0.8, angle: Math.atan2(y - st.tower.y, x - st.tower.x) });
    }
  }
}

// Leiste mit den Fähigkeits-Knöpfen über dem Spielfeld
let abilityBar = null;
function updateAbilityBar() {
  if (!abilityBar) {
    abilityBar = document.getElementById("abilities");
    if (!abilityBar) return;
    abilityBar.innerHTML = Object.entries(ABILITIES).map(([k, a]) =>
      `<button class="ability" data-ab="${k}" title="${a.name}: ${a.desc}" hidden><span class="ab-icon">${a.icon}</span><span class="ab-name">${a.name}</span><i class="ab-cd"></i></button>`).join("");
    for (const btn of abilityBar.querySelectorAll("button")) {
      btn.onclick = () => {
        if (useAbility(btn.dataset.ab)) Sound.play("upgrade");
      };
    }
  }
  abilityBar.hidden = !ui.menu.hidden;
  if (!state) return;
  for (const btn of abilityBar.querySelectorAll("button")) {
    const k = btn.dataset.ab;
    const on = abilityUnlocked(k);
    btn.hidden = !on;
    if (!on) continue;
    const cd = (state.abilityCd && state.abilityCd[k]) || 0;
    btn.disabled = cd > 0 || state.gameOver;
    btn.style.setProperty("--p", `${(cd / ABILITIES[k].cd) * 100}%`);
    btn.classList.toggle("ready", cd <= 0);
  }
}

// ---------- Erfolge (dauerhaft gespeichert) ----------
const ACHIEVEMENTS = [
  { id: "kills", name: "Alien-Jäger", icon: "👾", desc: "Zerstöre Aliens", stat: "kills", tiers: [500, 5000, 25000] },
  { id: "built", name: "Baumeister", icon: "🏗", desc: "Baue Türme", stat: "built", tiers: [20, 100, 300] },
  { id: "tier5", name: "Meisterwerk", icon: "⭐", desc: "Kaufe Stufe-5-Upgrades", stat: "tier5", tiers: [1, 5, 15] },
  { id: "wave", name: "Wellenbrecher", icon: "🌊", desc: "Erreiche Welle", stat: "bestWave", tiers: [15, 30, 50] },
  { id: "boss", name: "Jäger-Bezwinger", icon: "🦂", desc: "Besiege den Omega-Jäger", stat: "bossKills", tiers: [1, 5, 15] },
  { id: "win", name: "Retter von Neo-City", icon: "🏆", desc: "Gewinne auf Leicht / Normal / Schwer", stat: "winLevel", tiers: [1, 2, 3], labels: ["Leicht", "Normal", "Schwer"] },
  { id: "flawless", name: "Unberührt", icon: "🛡", desc: "Wellen am Stück ohne Lebensverlust", stat: "bestStreak", tiers: [10, 25, 50] },
  { id: "gold", name: "Goldgräber", icon: "💰", desc: "Verdiene Gold", stat: "goldEarned", tiers: [20000, 200000, 1000000] },
  { id: "ability", name: "Spezialkräfte", icon: "⚡", desc: "Setze Spezialfähigkeiten ein", stat: "abilities", tiers: [5, 25, 100] },
  { id: "demolish", name: "Abrissbirne", icon: "🏚", desc: "Reiße Gebäude ab", stat: "demolished", tiers: [5, 25, 75] },
];
const TROPHIES = [
  { name: "Bronze", color: "#e0904a", icon: "🥉" },
  { name: "Silber", color: "#d8e0f0", icon: "🥈" },
  { name: "Gold", color: "#ffd740", icon: "🥇" },
];

const Achievements = (() => {
  const KEY = "neoCityDefense.achievements.v1";
  let data = null;
  let dirty = false;
  let lastSave = 0;

  function load() {
    if (data) return data;
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(KEY) || "null");
    } catch (err) {
      raw = null;
    }
    data = { stats: {}, earned: {}, ...(raw || {}) };
    return data;
  }

  function save(force) {
    if (!dirty) return;
    const now = Date.now();
    if (!force && now - lastSave < 2000) return;
    lastSave = now;
    dirty = false;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (err) {
      // Speicher voll oder gesperrt: Erfolge gelten nur für diese Sitzung
    }
  }

  function check() {
    for (const a of ACHIEVEMENTS) {
      const v = data.stats[a.stat] || 0;
      let tier = 0;
      a.tiers.forEach((need, i) => {
        if (v >= need) tier = i + 1;
      });
      const had = data.earned[a.id] || 0;
      if (tier > had) {
        data.earned[a.id] = tier;
        dirty = true;
        toast(a, tier);
      }
    }
  }

  function add(stat, n) {
    load();
    data.stats[stat] = (data.stats[stat] || 0) + n;
    dirty = true;
    check();
    save(false);
  }

  function setMax(stat, v) {
    load();
    if ((data.stats[stat] || 0) >= v) return;
    data.stats[stat] = v;
    dirty = true;
    check();
    save(false);
  }

  function toast(a, tier) {
    if (typeof document === "undefined" || !document.getElementById) return;
    const view = document.getElementById("view");
    if (!view) return;
    const tr = TROPHIES[tier - 1];
    const el = document.createElement("div");
    el.className = "ach-toast";
    el.style.setProperty("--t", tr.color);
    el.innerHTML = `<span class="ach-cup">${tr.icon}</span><span><b>${tr.name}: ${a.name}</b><small>${a.desc}${a.labels ? "" : ` – ${formatNumber(a.tiers[tier - 1])}`}</small></span>`;
    view.appendChild(el);
    if (typeof Sound !== "undefined") Sound.play("waveEnd");
    setTimeout(() => el.classList.add("show"), 30);
    setTimeout(() => el.classList.remove("show"), 4200);
    setTimeout(() => el.remove(), 4800);
  }

  // HTML-Liste für das Menü
  function listHtml() {
    load();
    let html = '<div class="ach-list">';
    for (const a of ACHIEVEMENTS) {
      const v = data.stats[a.stat] || 0;
      const tier = data.earned[a.id] || 0;
      const next = a.tiers[tier];
      const cups = TROPHIES.map((t, i) => `<span class="cup ${i < tier ? "on" : ""}" style="--t:${t.color}" title="${t.name}: ${a.labels ? a.labels[i] : formatNumber(a.tiers[i])}">${t.icon}</span>`).join("");
      const prog = next === undefined ? "Alles geschafft!" : a.labels ? `Nächstes Ziel: ${a.labels[tier]}` : `${formatNumber(Math.floor(v))} / ${formatNumber(next)}`;
      const pct = next === undefined ? 100 : Math.min(100, (v / next) * 100);
      html += `<div class="ach"><span class="ach-icon">${a.icon}</span><span class="ach-text"><b>${a.name}</b><small>${a.desc}</small>` +
        `<span class="ach-bar"><i style="width:${pct}%"></i></span><small>${prog}</small></span><span class="cups">${cups}</span></div>`;
    }
    return html + "</div>";
  }

  function count() {
    load();
    return Object.values(data.earned).reduce((n, t) => n + t, 0);
  }

  return { add, setMax, save: () => save(true), listHtml, count };
})();
