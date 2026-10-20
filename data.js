"use strict";

// Spieldaten: Karte, Schwierigkeitsgrade, Gegner, Türme mit Ausbauwegen und Wellen.
// Positionen werden in "Pixeln" auf einem 960×560-Raster gerechnet (40 px pro Feld).
// Türme belegen 2×2 Felder.

const TILE = 40;
const COLS = 24;
const ROWS = 14;
const MAP_SEED = 1337;
const FINAL_WAVE = 50;
const MAX_TIER = 5;
const TOWER_SIZE = 2;

// ---------- Karte ----------
// Serpentine: zwei Startwege vereinen sich bei (4,7), danach schlängelt sich der Weg zum Stadttor.
const SHARED_PATH = [[4, 7], [8, 7], [8, 11], [12, 11], [12, 3], [16, 3], [16, 11], [20, 11], [20, 5], [24, 5]];
const PATHS = [
  [[-1, 1], [4, 1], ...SHARED_PATH],
  [[-1, 12], [4, 12], ...SHARED_PATH],
];

// Röhren-Tunnel: Aliens werden eingesaugt, schrumpfen und sind darin unverwundbar
const TUNNEL = { col: 12, rowFrom: 5, rowTo: 9 };

// Seen mit Uferpromenade: hier kann niemals gebaut werden
const POOLS = [
  [[7, 2], [8, 2], [9, 2], [7, 3], [8, 3], [9, 3], [8, 4]],
  [[22, 9], [23, 9], [22, 10], [23, 10], [22, 11]],
];

// Stadttor am Ende des Weges (hier starten auch die Raumschiffe)
const GATE_TILES = [[23, 4], [23, 6]];

// Gebäude auf dem Spielfeld, die man gegen Gold abreißen kann
const OBSTACLES = {
  tower: { name: "Mini-Hochhaus", clearCost: 140, count: 7 },
  diner: { name: "Retro-Diner", clearCost: 90, count: 3 },
  arcade: { name: "Spielhalle", clearCost: 110, count: 3 },
  dome: { name: "Glaskuppel", clearCost: 100, count: 3 },
  antenna: { name: "Funkmast", clearCost: 70, count: 3 },
  shop: { name: "Neon-Laden", clearCost: 80, count: 4 },
  garage: { name: "Parkhaus", clearCost: 120, count: 2 },
  kiosk: { name: "Holo-Kiosk", clearCost: 50, count: 3 },
  palms: { name: "Palmengarten", clearCost: 40, count: 4 },
  tank: { name: "Kühltank", clearCost: 90, count: 3 },
};

// ---------- Schwierigkeitsgrade ----------
const DIFFICULTIES = {
  easy: { name: "Leicht", lives: 200, gold: 850, speed: 0.9, hp: 0.75, count: 0.85, price: 0.85, desc: "Mehr Leben und Gold, langsamere Gegner." },
  normal: { name: "Normal", lives: 150, gold: 650, speed: 1, hp: 1, count: 1, price: 1, desc: "Die ausgewogene Herausforderung." },
  hard: { name: "Schwer", lives: 100, gold: 600, speed: 1.1, hp: 1.3, count: 1.15, price: 1.08, desc: "Schnellere, zähere Gegner. Nur für Profis." },
};

// ---------- Gegner ----------
// Stufen-Aliens: jeder Schadenspunkt senkt die Stufe um 1, Stufe 1 wird zerstört.
const DRONE_LEVELS = [
  null,
  { speed: 46, color: "#29e6ff", radius: 8 },
  { speed: 54, color: "#69f0ae", radius: 9 },
  { speed: 62, color: "#ffd740", radius: 10 },
  { speed: 71, color: "#ff8a3d", radius: 11 },
  { speed: 81, color: "#ff3cac", radius: 12 },
];

// Spezialeigenschaften (kombinierbar)
const PROPS = {
  camo: { name: "Tarnung", icon: "👁", desc: "Nur Türme mit Tarnerkennung können sie anvisieren. Explosionen treffen sie trotzdem.", from: 12 },
  frost: { name: "Frostschild", icon: "❄", desc: "Immun gegen Kälte: kein Schaden und keine Verlangsamung durch den Kryoturm.", from: 15 },
  blast: { name: "Explosionspanzer", icon: "💥", desc: "Immun gegen Explosionen (Plasma, Mörser, Raumschiffe). Brand wirkt trotzdem.", from: 18 },
  shield: { name: "Spiegelpanzer", icon: "🪞", desc: "Reflektiert normale Laser.", from: 21 },
  regen: { name: "Regeneration", icon: "✚", desc: "Gewinnt verlorene Stufen langsam zurück.", from: 24 },
};

// Schadensarten und welche Eigenschaft dagegen immun macht
const DAMAGE_IMMUNITY = { laser: "shield", blast: "blast", cold: "frost" };
const DAMAGE_NAMES = { laser: "Laser", blast: "Explosion", cold: "Kälte", fire: "Brand", pure: "Rein" };

const HEAVY = {
  tank: { name: "Brocken", speed: 32, radius: 16, hp: 26, hpPerWave: 2.2, reward: 25, lifeDamage: 15, color: "#b0b8d8" },
  bossA: { name: "Omega-Jäger", speed: 11, radius: 34, hp: 1000, reward: 300, lifeDamage: 9999, color: "#e0e6ff" },
  bossB: { name: "Brut-Mutterschiff", speed: 8, radius: 48, hp: 9000, reward: 1000, lifeDamage: 9999, color: "#ffd6f5" },
};

// ---------- Türme ----------
// Jeder Turm hat 3 Ausbauwege mit je 5 Stufen. Erlaubt ist höchstens 5-2-0:
// ein Weg bis Stufe 5, ein zweiter bis Stufe 2, der dritte bleibt leer.
const TOWER_TYPES = {
  laser: {
    name: "Laserturm", cost: 200, color: "#29e6ff",
    desc: "Schnelle Laserschüsse auf einzelne Ziele.",
    base: { range: 105, rate: 0.95, dmg: 1, pierce: 1, shots: 1, type: "laser", projSpeed: 560 },
    paths: [
      { name: "Überladung", tiers: [
        { name: "Schnellkondensator", cost: 140, desc: "Feuert 25 % schneller.", apply: (s) => { s.rate *= 0.75; } },
        { name: "Doppellauf", cost: 260, desc: "Schießt auf 2 Ziele gleichzeitig.", apply: (s) => { s.shots = 2; } },
        { name: "Gatling-Laser", cost: 750, desc: "Feuert doppelt so schnell.", apply: (s) => { s.rate *= 0.5; } },
        { name: "Strahlenkanone", cost: 2600, desc: "Dauerstrahl: trifft 8-mal pro Sekunde.", apply: (s) => { s.beam = true; s.rate = 0.125; } },
        { name: "Sonnenfeuer", cost: 9800, desc: "Strahl mit +2 Schaden, durchdringt Spiegelpanzer und setzt Gegner in Brand.", apply: (s) => { s.dmg += 2; s.pierceShield = true; s.burnDps = 2; s.burnTime = 1.5; } },
      ] },
      { name: "Fokus", tiers: [
        { name: "Fokuslinse", cost: 180, desc: "+1 Schaden.", apply: (s) => { s.dmg += 1; } },
        { name: "Durchschlag", cost: 320, desc: "Schüsse durchdringen bis zu 3 Gegner.", apply: (s) => { s.pierce = Math.max(s.pierce, 3); } },
        { name: "Plasma-Fokus", cost: 950, desc: "+2 Schaden, durchdringt Spiegelpanzer.", apply: (s) => { s.dmg += 2; s.pierceShield = true; } },
        { name: "Railgun", cost: 3200, desc: "Schaden 8, durchdringt 8 Gegner, +40 % Reichweite, aber langsamer.", apply: (s) => { s.dmg = Math.max(s.dmg, 8); s.pierce = Math.max(s.pierce, 8); s.rate *= 1.6; s.range *= 1.4; s.projSpeed = 1400; s.rail = true; } },
        { name: "Singularitäts-Lanze", cost: 12500, desc: "Schaden 25, durchdringt 20 Gegner, ×4 gegen Brocken und Bosse.", apply: (s) => { s.dmg = Math.max(s.dmg, 25); s.pierce = Math.max(s.pierce, 20); s.heavyMult = 4; } },
      ] },
      { name: "Sensorik", tiers: [
        { name: "Teleskop", cost: 110, desc: "+25 % Reichweite.", apply: (s) => { s.range *= 1.25; } },
        { name: "Radar", cost: 260, desc: "👁 Erkennt Tarn-Gegner.", apply: (s) => { s.camo = true; } },
        { name: "Zielcomputer", cost: 550, desc: "+20 % Reichweite, schnellere Geschosse, +1 Schaden gegen Getarnte.", apply: (s) => { s.range *= 1.2; s.projSpeed *= 1.5; s.camoBonus = 1; } },
        { name: "Markierungslaser", cost: 2000, desc: "Getroffene Gegner nehmen 4 s lang +1 Schaden von allen Türmen.", apply: (s) => { s.mark = 4; } },
        { name: "Orbital-Uplink", cost: 7200, desc: "Alle Türme in Reichweite erkennen Tarnung und feuern 15 % schneller.", apply: (s) => { s.auraCamo = true; s.auraRate = 0.85; } },
      ] },
    ],
  },
  plasma: {
    name: "Plasmawerfer", cost: 350, color: "#ff8a3d",
    desc: "Plasmakugeln mit Flächenschaden.",
    base: { range: 95, rate: 1.5, dmg: 1, splash: 38, pierce: 14, type: "blast", projSpeed: 280 },
    paths: [
      { name: "Sprengkraft", tiers: [
        { name: "Größere Ladung", cost: 220, desc: "+30 % Explosionsradius.", apply: (s) => { s.splash *= 1.3; } },
        { name: "Schwerer Sprengkopf", cost: 380, desc: "+1 Schaden, trifft bis zu 25 Gegner.", apply: (s) => { s.dmg += 1; s.pierce = 25; } },
        { name: "Clusterbomben", cost: 950, desc: "Jede Explosion setzt 6 Mini-Bomben frei.", apply: (s) => { s.cluster = 6; } },
        { name: "Bunkerbrecher", cost: 3400, desc: "+3 Schaden, ×3 gegen Brocken und Bosse.", apply: (s) => { s.dmg += 3; s.heavyMult = 3; } },
        { name: "Supernova", cost: 14500, desc: "Riesige Explosion mit 12 Schaden, die kurz betäubt.", apply: (s) => { s.dmg = Math.max(s.dmg, 12); s.splash *= 2.2; s.stun = Math.max(s.stun || 0, 0.6); s.pierce = 80; } },
      ] },
      { name: "Schnellfeuer", tiers: [
        { name: "Schnelllader", cost: 200, desc: "+25 % Feuerrate.", apply: (s) => { s.rate *= 0.8; } },
        { name: "Doppelrohr", cost: 420, desc: "+40 % Feuerrate.", apply: (s) => { s.rate *= 0.7; } },
        { name: "Plasma-Salve", cost: 1250, desc: "Feuert 3 Kugeln kurz hintereinander.", apply: (s) => { s.burst = 3; } },
        { name: "Feuersturm", cost: 2700, desc: "Setzt Gegner in Brand (2 Schaden/s, trifft auch Explosionspanzer).", apply: (s) => { s.burnDps = 2; s.burnTime = 2; } },
        { name: "Inferno-Batterie", cost: 11500, desc: "Feuert extrem schnell, Brand mit 6 Schaden/s.", apply: (s) => { s.rate *= 0.45; s.burnDps = 6; s.burnTime = 3; } },
      ] },
      { name: "Schockwelle", tiers: [
        { name: "Erschütterung", cost: 250, desc: "Getroffene werden 1 s um 30 % verlangsamt.", apply: (s) => { s.slow = 0.7; s.slowTime = 1; } },
        { name: "Betäubungsladung", cost: 600, desc: "Betäubt Gegner bis Stufe 3 für 0,4 s.", apply: (s) => { s.stun = Math.max(s.stun || 0, 0.4); s.stunMaxLevel = 3; } },
        { name: "EMP-Granate", cost: 1100, desc: "Entfernt Tarnung und Regeneration der Getroffenen.", apply: (s) => { s.emp = true; } },
        { name: "Druckwelle", cost: 2500, desc: "Schleudert Gegner ein Stück zurück.", apply: (s) => { s.knockback = 30; } },
        { name: "Zeitbombe", cost: 8800, desc: "Jeder 4. Schuss betäubt alle im großen Umkreis für 1,5 s.", apply: (s) => { s.bigStunEvery = 4; s.bigStun = 1.5; } },
      ] },
    ],
  },
  cryo: {
    name: "Kryoturm", cost: 300, color: "#b388ff",
    desc: "Kältepuls: verlangsamt alle Gegner im Umkreis.",
    base: { range: 75, rate: 2.2, dmg: 0, pierce: 30, slow: 0.55, slowTime: 1.4, type: "cold" },
    paths: [
      { name: "Tiefkühlung", tiers: [
        { name: "Frostbiss", cost: 200, desc: "Der Kältepuls macht 1 Schaden.", apply: (s) => { s.dmg = Math.max(s.dmg, 1); } },
        { name: "Permafrost", cost: 320, desc: "Stärkere (−55 %) und längere Verlangsamung.", apply: (s) => { s.slow = Math.min(s.slow, 0.45); s.slowTime = Math.max(s.slowTime, 2.5); } },
        { name: "Schockgefrieren", cost: 1000, desc: "Friert Gegner 0,8 s ein. Gefrorene nehmen +1 Schaden.", apply: (s) => { s.freeze = 0.8; s.frozenBonus = 1; } },
        { name: "Eissplitter", cost: 2600, desc: "Gefrorene zersplittern: 3 Schaden an Gegnern in der Nähe.", apply: (s) => { s.shatter = 3; } },
        { name: "Absoluter Nullpunkt", cost: 11000, desc: "Puls macht 4 Schaden, friert 1,5 s ein und bremst sogar Bosse stark.", apply: (s) => { s.dmg = Math.max(s.dmg, 4); s.freeze = 1.5; s.bossFreeze = true; } },
      ] },
      { name: "Kältefeld", tiers: [
        { name: "Weites Feld", cost: 150, desc: "+20 % Reichweite.", apply: (s) => { s.range *= 1.2; } },
        { name: "Schnellpuls", cost: 320, desc: "+35 % Pulsrate.", apply: (s) => { s.rate *= 0.74; } },
        { name: "Arktische Front", cost: 750, desc: "+25 % Reichweite, stärkere Verlangsamung.", apply: (s) => { s.range *= 1.25; s.slow -= 0.1; } },
        { name: "Gletscherwall", cost: 2100, desc: "Gegner bleiben nach dem Puls 4 s lang verlangsamt.", apply: (s) => { s.slowTime = Math.max(s.slowTime, 4); } },
        { name: "Eiszeit", cost: 9200, desc: "Alle 10 s verlangsamt ein globaler Puls alle Gegner für 2 s.", apply: (s) => { s.globalEvery = 10; } },
      ] },
      { name: "Kristalle", tiers: [
        { name: "Kryo-Splitter", cost: 250, desc: "Schießt zusätzlich Eissplitter (1 Schaden).", apply: (s) => { s.shards = 1; s.shardDmg = 1; s.shardRate = 0.8; } },
        { name: "Thermoschock", cost: 520, desc: "👁 Splitter erkennen Tarnung und treffen auch Frostschild-Gegner.", apply: (s) => { s.shardPure = true; s.camo = true; } },
        { name: "Prismenbruch", cost: 950, desc: "Splitter: +2 Schaden, ×3 gegen Spiegelpanzer.", apply: (s) => { s.shardDmg += 2; s.shardMirror = 3; } },
        { name: "Kristallsturm", cost: 2500, desc: "3 Splitter pro Salve.", apply: (s) => { s.shards = 3; } },
        { name: "Diamant-Kern", cost: 9500, desc: "Splitter mit 8 Schaden, durchdringen 5 Gegner.", apply: (s) => { s.shardDmg = Math.max(s.shardDmg, 8); s.shardPierce = 5; } },
      ] },
    ],
  },
  mortar: {
    name: "Mörser", cost: 550, color: "#ffd740",
    desc: "Schießt über die ganze Karte auf einen frei wählbaren Zielpunkt. Explosionen treffen auch Getarnte.",
    base: { range: 0, global: true, rate: 2.2, dmg: 1, splash: 42, pierce: 16, inaccuracy: 30, type: "blast" },
    paths: [
      { name: "Präzision", tiers: [
        { name: "Kalibrierung", cost: 160, desc: "Viel genauere Treffer.", apply: (s) => { s.inaccuracy *= 0.4; } },
        { name: "Großkaliber", cost: 320, desc: "+40 % Explosionsradius.", apply: (s) => { s.splash *= 1.4; } },
        { name: "Schwere Granaten", cost: 950, desc: "+2 Schaden.", apply: (s) => { s.dmg += 2; } },
        { name: "Schockgeschoss", cost: 3100, desc: "+2 Schaden, betäubt 0,5 s.", apply: (s) => { s.dmg += 2; s.stun = 0.5; } },
        { name: "Titanenhammer", cost: 14000, desc: "Schaden 20, riesiger Radius, ×4 gegen Bosse.", apply: (s) => { s.dmg = Math.max(s.dmg, 20); s.splash *= 1.8; s.heavyMult = 4; s.pierce = 60; } },
      ] },
      { name: "Kadenz", tiers: [
        { name: "Schnellladung", cost: 260, desc: "+30 % Feuerrate.", apply: (s) => { s.rate *= 0.75; } },
        { name: "Automatik", cost: 520, desc: "+40 % Feuerrate.", apply: (s) => { s.rate *= 0.7; } },
        { name: "Dreifachsalve", cost: 1350, desc: "3 Granaten pro Schuss.", apply: (s) => { s.burst = 3; } },
        { name: "Brandgranaten", cost: 2500, desc: "Brand 2 Schaden/s (trifft auch Explosionspanzer).", apply: (s) => { s.burnDps = 2; s.burnTime = 2.5; } },
        { name: "Sperrfeuer", cost: 12500, desc: "Extrem schnelles Feuer, Brand 6 Schaden/s.", apply: (s) => { s.rate *= 0.4; s.burnDps = 6; s.burnTime = 3; } },
      ] },
      { name: "Smart-Munition", tiers: [
        { name: "Signalfeuer", cost: 150, desc: "+15 % Explosionsradius.", apply: (s) => { s.splash *= 1.15; } },
        { name: "Splitterladung", cost: 480, desc: "Jede Granate verschießt 6 Splitter (1 Schaden, trifft auch Explosionspanzer).", apply: (s) => { s.shrapnel = 6; } },
        { name: "Zielverfolgung", cost: 1050, desc: "Kann Gegner automatisch verfolgen (nach Ziel-Priorität).", apply: (s) => { s.autoTarget = true; } },
        { name: "Streubomben", cost: 3300, desc: "5 zusätzliche Mini-Explosionen pro Einschlag.", apply: (s) => { s.cluster = 5; } },
        { name: "Orbitalschlag", cost: 10500, desc: "Alle 15 s ein gewaltiger Orbitalschlag (60 Schaden) am Ziel.", apply: (s) => { s.strikeEvery = 15; s.strikeDmg = 60; s.strikeRadius = 110; } },
      ] },
    ],
  },
  station: {
    name: "Raumstation", cost: 800, color: "#ff4fd8", unlockWave: 8, upgradeUnlockWave: 12,
    desc: "Schickt Raumschiffe vom Stadttor den Gegnern entgegen. Sie halten Gegner auf, rammen sie und explodieren am Ende.",
    base: { range: 0, interval: 7, ships: 1, shipHp: 8, ramDmg: 1, ramMult: 1, blastDmg: 3, blastRadius: 55, blastType: "blast", type: "blast" },
    paths: [
      { name: "Rumpf", tiers: [
        { name: "Verstärkte Hülle", cost: 350, desc: "+6 Schiffsleben.", apply: (s) => { s.shipHp += 6; } },
        { name: "Schildgenerator", cost: 550, desc: "+10 Schiffsleben.", apply: (s) => { s.shipHp += 10; } },
        { name: "Titanpanzer", cost: 1300, desc: "Doppelte Schiffsleben.", apply: (s) => { s.shipHp *= 2; } },
        { name: "Reparaturdrohnen", cost: 3200, desc: "Schiffe reparieren sich (3 Leben/s).", apply: (s) => { s.shipRegen = 3; } },
        { name: "Schlachtkreuzer", cost: 13500, desc: "Riesige Schiffe mit 150 Leben und dreifachem Rammschaden.", apply: (s) => { s.shipHp = Math.max(s.shipHp, 150); s.ramMult = 3; s.bigShips = true; } },
      ] },
      { name: "Hangar", tiers: [
        { name: "Schnellstart", cost: 420, desc: "Schiffe starten 25 % öfter.", apply: (s) => { s.interval *= 0.8; } },
        { name: "Zwillingshangar", cost: 850, desc: "Startet 2 Schiffe auf einmal.", apply: (s) => { s.ships = 2; } },
        { name: "Fließband", cost: 1600, desc: "Schiffe starten noch 30 % öfter.", apply: (s) => { s.interval *= 0.7; } },
        { name: "Geschwader", cost: 4300, desc: "Startet 4 Schiffe auf einmal.", apply: (s) => { s.ships = 4; } },
        { name: "Trägerflotte", cost: 15500, desc: "Doppelt so oft. 👁 Schiffe schießen Laser und erkennen Tarnung.", apply: (s) => { s.interval *= 0.5; s.shipLaser = true; } },
      ] },
      { name: "Sprengkern", tiers: [
        { name: "Sprengladung", cost: 280, desc: "+2 Explosionsschaden.", apply: (s) => { s.blastDmg += 2; } },
        { name: "Großer Radius", cost: 450, desc: "+40 % Explosionsradius.", apply: (s) => { s.blastRadius *= 1.4; } },
        { name: "Plasma-Kern", cost: 1250, desc: "Explosion trifft auch Explosionspanzer.", apply: (s) => { s.blastType = "fire"; } },
        { name: "Kettenreaktion", cost: 3100, desc: "Jede Explosion löst 4 Folgeexplosionen aus.", apply: (s) => { s.chain = 4; } },
        { name: "Nova-Ramme", cost: 14000, desc: "Explosion mit 40 Schaden, riesigem Radius und ×3 gegen Bosse.", apply: (s) => { s.blastDmg = Math.max(s.blastDmg, 40); s.blastRadius *= 1.8; s.heavyMult = 3; } },
      ] },
    ],
  },
};

// Ausbau-Farben der drei Wege (für die Kugeln am Turmsockel)
const PATH_COLORS = ["#29e6ff", "#ff3cac", "#ffd740"];

// ---------- Zufall mit festem Startwert ----------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Weg vorberechnen (Ecken leicht abgerundet) ----------
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

// Gesamtlänge der Wege (für das Zurückschleudern von Gegnern)
const pathCumulative = pathPoints.map((pts) => {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return cum;
});

const pathTiles = new Set();
const tunnelTiles = new Set();
for (let r = TUNNEL.rowFrom; r <= TUNNEL.rowTo; r++) tunnelTiles.add(`${TUNNEL.col},${r}`);
// Tunnelbereich in Pixeln (für Unverwundbarkeit und Schrumpfen)
const TUNNEL_RECT = { x0: TUNNEL.col * TILE, x1: (TUNNEL.col + 1) * TILE, y0: TUNNEL.rowFrom * TILE, y1: (TUNNEL.rowTo + 1) * TILE };
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

// ---------- Wellen ----------
// Wann kommt der Boss aus Runde 30 zurück (ohne Lebensanzeige) und wie oft.
const BOSS_RETURNS = { 40: 1, 43: 1, 45: 1, 47: 2, 49: 2 };

// Erzeugt die Gegnerliste einer Welle: [{ t, kind, level, props, bar }]
function buildWave(n, diff) {
  const rng = mulberry32(9000 + n * 31);
  const entries = [];
  let t = 0;
  let path = n % 2;
  const add = (e, gap) => {
    entries.push({ ...e, t, path });
    t += gap;
  };

  // verfügbare Spezialeigenschaften und wie häufig sie vorkommen
  const avail = Object.keys(PROPS).filter((k) => n >= PROPS[k].from);
  const propChance = avail.length ? Math.min(0.55, 0.12 + (n - 12) * 0.018) : 0;
  const pickProps = () => {
    const props = {};
    if (avail.length && rng() < propChance) {
      props[avail[Math.floor(rng() * avail.length)]] = true;
      // ab Welle 28 auch kombinierte Eigenschaften
      if (n >= 28 && rng() < 0.3) props[avail[Math.floor(rng() * avail.length)]] = true;
    }
    return props;
  };

  // Stufen-Mischung: Mittelpunkt steigt mit der Welle, aber immer mehrere Stufen gemischt
  const maxLevel = Math.min(5, 1 + Math.floor((n + 1) / 4));
  const center = Math.min(5, 0.6 + n * 0.17);
  const pickLevel = () => {
    const weights = [];
    let sum = 0;
    for (let l = 1; l <= maxLevel; l++) {
      const w = Math.exp(-((l - center) ** 2) / 2.2) + 0.08;
      weights.push(w);
      sum += w;
    }
    let r = rng() * sum;
    for (let l = 1; l <= maxLevel; l++) {
      r -= weights[l - 1];
      if (r <= 0) return l;
    }
    return maxLevel;
  };

  const spacing = Math.max(0.22, 0.6 - n * 0.008);
  let count = Math.round((8 + n * 1.7 + Math.max(0, n - 30) * 1.4) * diff.count);
  if (n === FINAL_WAVE) count = Math.round(count * 0.6);
  const levelsUsed = new Set();
  while (count > 0) {
    const size = Math.min(count, 3 + Math.floor(rng() * 6));
    let level = pickLevel();
    // für Abwechslung sorgen: in frühen Gruppen andere Stufen bevorzugen
    if (levelsUsed.has(level) && levelsUsed.size < maxLevel && rng() < 0.5) level = 1 + Math.floor(rng() * maxLevel);
    levelsUsed.add(level);
    const props = pickProps();
    for (let i = 0; i < size; i++) add({ kind: "drone", level, props }, spacing);
    count -= size;
    t += 0.6 + rng() * 0.6;
    path = 1 - path;
  }

  // Brocken ab Welle 22
  if (n >= 22) {
    const tanks = Math.floor((n - 19) / 3 * diff.count);
    for (let i = 0; i < tanks; i++) {
      t += 0.8;
      add({ kind: "tank", props: pickProps() }, 0.8);
      path = 1 - path;
    }
  }

  // Bosse
  if (n === 30) {
    t += 2;
    add({ kind: "bossA", props: {}, bar: "A" }, 1);
  } else if (BOSS_RETURNS[n]) {
    for (let i = 0; i < BOSS_RETURNS[n]; i++) {
      t += 2;
      add({ kind: "bossA", props: {}, bar: null, hpScale: 1 + (n - 40) * 0.06 }, 3);
      path = 1 - path;
    }
  } else if (n === FINAL_WAVE) {
    t += 3;
    add({ kind: "bossB", props: {}, bar: "B" }, 1);
  }

  entries.sort((a, b) => a.t - b.t);
  return entries;
}

// Neue Gegnerarten, die beim ersten Auftauchen angekündigt werden
function waveAnnouncement(n) {
  for (const [key, p] of Object.entries(PROPS)) {
    if (p.from === n) return `Neu: ${p.icon} ${p.name} – ${p.desc}`;
  }
  if (n === 22) return "Neu: Brocken – sie halten viel aus und zerfallen in zwei Stufe-5-Aliens.";
  if (n === 30) return "⚠ BOSS: Der Omega-Jäger greift an!";
  if (BOSS_RETURNS[n]) return BOSS_RETURNS[n] > 1 ? "⚠ Zwei Omega-Jäger kehren zurück!" : "⚠ Der Omega-Jäger kehrt zurück!";
  if (n === FINAL_WAVE) return "⚠ ENDBOSS: Das Brut-Mutterschiff – in ihm stecken 4 Omega-Jäger!";
  return "";
}
