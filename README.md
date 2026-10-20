# Neo-City Defense

Ein 3D-Tower-Defense-Spiel im Retro-Synthwave- und Chromecore-Stil – HTML, CSS und JavaScript mit [Three.js](https://threejs.org/) für die 3D-Grafik. Musik und Soundeffekte werden live im Browser erzeugt.

## Starten

`index.html` im Browser öffnen. Fertig. Three.js liegt im Ordner `lib/`, es wird also kein Internet und keine Installation gebraucht.

Im **Hauptmenü** gibt es:
- **Neues Spiel** mit den Schwierigkeiten **Leicht**, **Normal** und **Schwer**
- **Weiterspielen** (der Spielstand wird nach jeder Welle automatisch gespeichert)
- **Einstellungen:** Musik und Soundeffekte an/aus mit Lautstärke, automatischer Wellenstart, Spielstand speichern/laden/löschen
- **Anleitung**

## Steuerung

| Aktion | Bedienung |
|---|---|
| Turm wählen | Knopf unten oder Tasten `1`–`5` |
| Bauen | Feld im Hologramm-Raster anklicken (Umschalttaste = mehrere Türme) |
| Bauen abbrechen | `Esc` oder Rechtsklick |
| Welle starten | Knopf oder `Leertaste` |
| Pause | Knopf oder `P` – in der Pause kann man weiter bauen und verbessern |
| Kamera | linke Maustaste ziehen = drehen, rechte = verschieben, Mausrad = zoomen |

## Ziel

50 Wellen überstehen:
- **Welle 30:** Boss **Omega-Koloss** (mit Lebensanzeige)
- **Welle 40–49:** Der Omega-Koloss kehrt immer wieder zurück, gegen Ende auch doppelt (ohne Lebensanzeige)
- **Welle 50:** Endboss **Hyperion-Mutterschiff** (eigene Lebensanzeige). Wenn es aufbricht, kommen 4 Omega-Kolosse heraus, jeder mit eigener Lebensanzeige.

## Gegner

**Stufen-Drohnen (Stufe 1–5):** Jeder Schadenspunkt senkt die Stufe um 1, eine Drohne der Stufe 1 wird zerstört. Höhere Stufen sind schneller. Die Stufe erkennt man an der Farbe (Cyan, Grün, Gelb, Orange, Pink) und an der Zahl der kreisenden Satelliten. In jeder Welle kommen verschiedene Stufen gemischt.

**Spezialeigenschaften** (kommen später und können kombiniert sein):

| Eigenschaft | ab Welle | Wirkung |
|---|---|---|
| 👁 Tarnung | 12 | Nur Türme mit Tarnerkennung können sie anvisieren. Explosionen treffen sie trotzdem. |
| ❄ Frostschild | 15 | Immun gegen Kälte (Kryoturm) |
| 💥 Explosionspanzer | 18 | Immun gegen Explosionen (Brand wirkt trotzdem) |
| 🪞 Spiegelpanzer | 21 | Reflektiert normale Laser |
| ✚ Regeneration | 24 | Gewinnt verlorene Stufen zurück |

**Panzerkern** (ab Welle 22): hält viel aus und zerfällt in zwei Stufe-5-Drohnen.

Bosse und Panzerkerne zeigen Schaden, indem sie sich verfärben, rot glühen, Funken sprühen, rauchen und Teile verlieren.

## Türme

Jeder Turm hat **3 Ausbauwege mit je 5 Stufen**. Höchstens **5-2-0** ist erlaubt: ein Weg bis Stufe 5, ein zweiter bis Stufe 2, der dritte bleibt leer. Beim Überfahren eines Upgrades mit der Maus zeigt eine Vorschau die Wirkung und die neue Reichweite (pinker Ring).

| Turm | Kosten | Ausbauwege | Tarnung |
|---|---|---|---|
| Laserturm | 200 | Überladung · Fokus · Sensorik | über „Radar“ (Sensorik 2) |
| Plasmawerfer | 350 | Sprengkraft · Schnellfeuer · Schockwelle | nein (Explosionen treffen Getarnte mit) |
| Kryoturm | 300 | Tiefkühlung · Kältefeld · Kristalle | Puls trifft Getarnte, Splitter ab „Thermoschock“ |
| Mörser | 550 | Präzision · Kadenz · Smart-Munition | trifft Getarnte immer |
| Raumstation | 800 (ab Welle 8, Upgrades ab Welle 12) | Rumpf · Hangar · Sprengkern | Schiffe rammen Getarnte |

- **Mörser:** schießt über die ganze Karte auf einen frei wählbaren Zielpunkt („🎯 Zielpunkt setzen“). Mit „Zielverfolgung“ kann er Gegner auch automatisch verfolgen.
- **Raumstation:** schickt Raumschiffe vom Stadttor den Gegnern entgegen. Sie halten Gegner auf, rammen sie und explodieren, wenn sie zerstört werden.
- **Ziel-Priorität** pro Turm: Erster, Letzter, Stärkster oder Nächster.
- **Statistik:** Beim Anklicken eines Turms sieht man Gesamt-Schaden und zerstörte Gegner.

Unverbesserte Türme reichen ab den mittleren Wellen nicht mehr aus. Upgrades lohnen sich.

## Mac-App

Die Mac-App wird bei jedem Update automatisch von GitHub gebaut und unter **Releases** bereitgestellt:
https://github.com/bhb1011-creator/Towerdefense/releases/latest

1. Die Datei `Neo-City Defense-….dmg` herunterladen und öffnen.
2. **Neo-City Defense** in den Ordner **Programme** ziehen.
3. Beim ersten Start fragt macOS nach, weil die App nicht bei Apple registriert ist:
   **Systemeinstellungen → Datenschutz & Sicherheit → „Trotzdem öffnen“**.
   Meldet macOS „beschädigt“, hilft im Terminal einmal: `xattr -cr "/Applications/Neo-City Defense.app"`

Selbst bauen (auf einem Mac mit Node.js): `npm install` und dann `npm run dist:mac` – die App liegt danach im Ordner `dist/`.

## Alle Versionen

Im Ordner `versionen/` liegen alle bisherigen Entwicklungsstufen als eigene, spielbare Spiele. `versionen/index.html` öffnen (oder im Hauptmenü auf „📜 Alle Versionen“ klicken) – dort gibt es eine Übersicht mit Vorschaubildern:

1. Einfaches 2D-Spiel
2. 2D mit Detailkarte
3. 3D-Landschaft
4. Chromecore-Sci-Fi-Stadt
5. Retro-Synthwave (aktuell)

## Dateien

- `index.html` – Seitenaufbau
- `style.css` – Chrom-Look der Oberfläche, Menü und Lebensanzeigen
- `data.js` – Spieldaten: Karte, Schwierigkeiten, Gegner, Türme mit allen Upgrades, Wellen
- `game.js` – Spielablauf, Schadenssystem, Speichern, Menü und Oberfläche
- `scene.js` – 3D-Darstellung: Retro-Welt mit Sonnenuntergang, Meer und Stadt, Spielfeld, alle Modelle und Effekte
- `audio.js` – Synthwave-Soundtrack und Soundeffekte (Web Audio API)
- `lib/` – Three.js 0.147 mit OrbitControls, RoundedBoxGeometry und Bloom-Nachbearbeitung (MIT-Lizenz, siehe `lib/three-LICENSE`)
