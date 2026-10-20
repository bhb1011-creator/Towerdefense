# Neo-City Defense

Ein 3D-Tower-Defense-Spiel im Retro-Synthwave-Stil: Aliens fallen über eine Stadt im Miami-Look der 80er her. HTML, CSS und JavaScript mit [Three.js](https://threejs.org/) für die 3D-Grafik. Musik, Soundeffekte und Alien-Stimmen werden live im Browser erzeugt.

## Starten

`index.html` im Browser öffnen. Fertig. Three.js liegt im Ordner `lib/`, es wird also kein Internet und keine Installation gebraucht.

Im **Hauptmenü** gibt es:
- **Neues Spiel** mit den Schwierigkeiten **Leicht**, **Normal** und **Schwer**
- **Weiterspielen** (der Spielstand wird nach jeder Welle automatisch gespeichert)
- **Einstellungen:** Musik und Soundeffekte an/aus mit Lautstärke, automatischer Wellenstart, Spielstand speichern/laden/löschen
- **🏆 Erfolge:** 10 Erfolge mit Bronze-, Silber- und Gold-Trophäe (dauerhaft gespeichert)
- **Anleitung**

## Steuerung

| Aktion | Bedienung |
|---|---|
| Turm wählen | Knopf unten oder Tasten `1`–`5` |
| Bauen | Stelle im Hologramm-Raster anklicken – ein Turm belegt 2×2 Felder (Umschalttaste = mehrere Türme) |
| Bauen abbrechen | `Esc` oder Rechtsklick |
| Upgrade | Turm anklicken, Upgrade antippen (zeigt Bild vorher/nachher und Werte-Balken), dann **Kaufen** |
| Spezialfähigkeit | Knopf oben links im Spielfeld (erscheint ab einem Stufe-5-Upgrade) |
| Welle starten | Knopf oder `Leertaste` |
| Pause | Knopf oder `P` – in der Pause kann man weiter bauen und verbessern |
| Kamera | linke Maustaste ziehen = drehen, rechte = verschieben, Mausrad = zoomen (Touch: ein Finger dreht, zwei zoomen) |

## Die Karte

- Hügelige **Serpentinen-Karte**: zwei Startwege vereinen sich und schlängeln sich bergauf und bergab zum Stadttor.
- **Tunnelberg:** Im Tunnel werden die Aliens eingesaugt, schrumpfen und sind unverwundbar.
- Zwei runde **Seen** mit Uferweg, Laternen und Bänken, geschwungene **Gehwege** mit Zebrastreifen.
- **10 Gebäudearten** (Mini-Hochhaus, Diner, Spielhalle, Glaskuppel, Funkmast, Neon-Laden, Parkhaus, Kiosk, Palmengarten, Kühltank) – gegen Gold abreißbar.
- Rundherum eine **Retro-Miami-Stadt** mit Strand, Liegen, Sonnenschirmen, Strandkörben, Rettungsschwimmer-Türmen, Ocean Drive, fahrenden 80er-Autos und Hochhäusern.
- **Tag-Nacht-Wechsel:** goldene Stunde am Anfang, Synthwave-Dämmerung, Nacht und ein roter Himmel beim Endboss.

## Ziel

50 Wellen überstehen:
- **Welle 30:** Boss **Omega-Jäger** (mit Lebensanzeige)
- **Welle 40–49:** Der Omega-Jäger kehrt immer wieder zurück, gegen Ende auch doppelt (ohne Lebensanzeige)
- **Welle 50:** Endboss **Brut-Mutterschiff** (eigene Lebensanzeige). Wenn es aufplatzt, kommen 4 Omega-Jäger heraus, jeder mit eigener Lebensanzeige.

## Gegner

**Stufen-Aliens (Stufe 1–5):** Jeder Schadenspunkt senkt die Stufe um 1, ein Alien der Stufe 1 wird zerstört. Höhere Stufen sind schneller. Alle haben die gleiche Form, aber eine eigene Farbe (Cyan, Grün, Gelb, Orange, Pink); ab Stufe 4 mit Hörnern, Stufe 5 mit Rückenstacheln.

**Spezialeigenschaften** (kommen später und können kombiniert sein):

| Eigenschaft | ab Welle | Aussehen | Wirkung |
|---|---|---|---|
| 👁 Tarnung | 12 | durchsichtiger Krabbler | Nur Türme mit Tarnerkennung können sie anvisieren. Explosionen treffen sie trotzdem. |
| ❄ Frostschild | 15 | Eiskristalle, eisblaue Hülle | Immun gegen Kälte (Kryoturm) |
| 💥 Explosionspanzer | 18 | sechsbeiniger Käfer | Immun gegen Explosionen (Brand wirkt trotzdem) |
| 🪞 Spiegelpanzer | 21 | Chromhaut mit Schutzgitter | Reflektiert normale Laser |
| ✚ Regeneration | 24 | grüne Blasen und Leuchthülle | Gewinnt verlorene Stufen zurück |

**Brocken** (ab Welle 22): läuft auf den Fäusten, hält viel aus und zerfällt in zwei Stufe-5-Aliens.

Normale Aliens haben keine Lebensbalken. Bosse und Brocken zeigen Schaden, indem sie sich verfärben, rot glühen, Funken sprühen, rauchen und Teile verlieren.

## Türme

Jeder Turm hat **3 Ausbauwege mit je 5 Stufen** und verändert sein Aussehen mit jedem Ausbau (z. B. wird der Laser-Fokus zur langen Singularitäts-Lanze). Höchstens **5-2-0** ist erlaubt: ein Weg bis Stufe 5, ein zweiter bis Stufe 2. **Jedes Stufe-5-Upgrade gibt es nur einmal auf der Karte** (pro Turmart und Weg).

| Turm | Kosten | Ausbauwege | Spezialfähigkeit (ab Stufe 5) |
|---|---|---|---|
| Laserturm | 200 | Überladung · Fokus · Sensorik | ⚡ Überladung: alle Laser 6 s dreimal so schnell |
| Plasmawerfer | 350 | Sprengkraft · Schnellfeuer · Schockwelle | ☄ Feuersturm: 8 Einschläge auf die vordersten Aliens |
| Kryoturm | 300 | Tiefkühlung · Kältefeld · Kristalle | ❄ Frost-Nova: friert alle Aliens 3 s ein |
| Mörser | 550 | Präzision · Kadenz · Smart-Munition | 🎯 Sperrfeuer: 12 Granaten auf die stärksten Aliens |
| Raumstation | 800 (ab Welle 8, Upgrades ab Welle 12) | Rumpf · Hangar · Sprengkern | 🚀 Kamikaze-Geschwader: 8 gepanzerte Schiffe |

- **Mörser:** schießt über die ganze Karte auf einen frei wählbaren Zielpunkt („🎯 Zielpunkt setzen“).
- **Raumstation:** schickt Raumschiffe vom Stadttor den Aliens entgegen.
- **Ziel-Priorität** pro Turm: Erster, Letzter, Stärkster oder Nächster.

## Erfolge

Alien-Jäger, Baumeister, Meisterwerk, Wellenbrecher, Jäger-Bezwinger, Retter von Neo-City, Unberührt, Goldgräber, Spezialkräfte und Abrissbirne – jeweils mit 🥉 Bronze, 🥈 Silber und 🥇 Gold.

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
5. Retro-Synthwave
6. Alien-Invasion in Neo-Miami (aktuell)

## Dateien

- `index.html` – Seitenaufbau
- `style.css` – Chrom-Look der Oberfläche, Menü, Lebensanzeigen, Upgrade-Vorschau, Erfolge
- `data.js` – Spieldaten: Karte (Wege, Tunnel, Seen, Gehwege, Gelände-Höhen), Schwierigkeiten, Gegner, Türme mit allen Upgrades, Wellen
- `game.js` – Spielablauf, Schadenssystem, Speichern, Menü und Oberfläche
- `progress.js` – Spezialfähigkeiten und Erfolge
- `scene.js` – 3D-Darstellung: Welt, Spielfeld mit Hügeln, Effekte, Tag-Nacht-Wechsel, Kamera
- `aliens.js` – Alien-Modelle mit Animationen
- `towers.js` – Turm-Modelle je Ausbauweg und Stufe
- `buildings.js` – die 10 Gebäudearten auf dem Spielfeld
- `city.js` – die Retro-Miami-Stadt mit Strand und Autos
- `audio.js` – Synthwave-Soundtrack, Soundeffekte und Alien-Stimmen (Web Audio API)
- `lib/` – Three.js 0.147 mit OrbitControls, RoundedBoxGeometry, BufferGeometryUtils und Bloom-Nachbearbeitung (MIT-Lizenz, siehe `lib/three-LICENSE`)
