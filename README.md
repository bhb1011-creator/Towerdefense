# Neo-City Defense

Ein 3D-Tower-Defense-Spiel im Chromecore-Sci-Fi-Stil – HTML, CSS und JavaScript mit [Three.js](https://threejs.org/) für die 3D-Grafik.

## Starten

`index.html` im Browser öffnen. Fertig. Three.js liegt im Ordner `lib/`, es wird also kein Internet und keine Installation gebraucht.

## Kamera

- **Linke Maustaste ziehen:** Kamera drehen
- **Rechte Maustaste ziehen:** Kamera verschieben
- **Mausrad:** zoomen
- **Touch:** ein Finger dreht, zwei Finger zoomen und verschieben
- **🎥 Kamera:** zurück zur Übersicht

## Spielen

- **Turm bauen:** Turm unten auswählen (oder Taste `1`–`4`) und auf eine freie Bauplatte klicken (kurz klicken, nicht ziehen).
- **Welle starten:** Button „Welle starten“ oder `Leertaste`.
- **Turm verbessern/verkaufen:** Auf einen gebauten Turm klicken.
- **Tempo:** 1x / 2x / 3x umschalten.

Die Gegner kommen aus zwei Portalen, laufen auf zwei Straßen, die sich in der Mitte vereinen, und wollen durch das Stadttor. Erreicht ein Gegner das Tor, verlierst du Leben (große Gegner kosten mehr). Bei 0 Leben ist das Spiel vorbei.

**Ziel:** 30 Wellen überstehen. In Welle 30 kommt der Endboss, der **Omega-Koloss**. Wer ihn besiegt, hat gewonnen.

### Karte

Eine schwebende Plattform mitten in einer Sci-Fi-Stadt mit Hochhäusern, LED-Leisten, Holo-Werbetafeln und fliegenden Autos.

- **Energiebecken:** Hier kann nie gebaut werden.
- **Holo-Kioske (15 💰) und Frachtcontainer (30 💰):** blockieren das Feld, können aber angeklickt und entfernt werden.

### Türme

| Turm         | Kosten | Besonderheit                                         | Ausbaupfade |
|--------------|--------|------------------------------------------------------|-------------|
| Laserturm    | 50     | Schnelle Einzelschüsse                               | Reichweite, Schaden |
| Plasmawerfer | 90     | Langsam, Flächenschaden, gut gegen Panzerung         | Reichweite, Schaden |
| Kryoturm     | 70     | Verlangsamt Gegner                                   | Reichweite, Schaden |
| Raumstation  | 220    | Schickt Raumschiffe vom Stadttor die Straße entlang | Schiffsleben, Häufigkeit, Explosionskraft |

Jeder Ausbaupfad geht bis Stufe 3. Die Stufen siehst du als leuchtende Kugeln am Turmsockel.

**Raumstation:** wird ab **Welle 8** freigeschaltet, ihre Verbesserungen ab **Welle 12**. Die Raumschiffe starten am Stadttor und fliegen den Gegnern entgegen. Treffen sie auf Gegner, halten sie diese auf und rammen sie. Wird ein Schiff zerstört (oder erreicht es das Ende der Straße), explodiert es und beschädigt alle Gegner in der Nähe.

### Gegner

Gegner haben **keine Lebensanzeige**. Stattdessen sieht man den Schaden: Sie verfärben sich, glühen rot, sprühen Funken, rauchen und verlieren Panzerteile. Ihre Augen wechseln von Cyan zu Rot.

Manche Gegner tragen kleinere Gegner in sich, die beim Zerstören freigesetzt werden:

| Gegner          | Fähigkeit                                  | Enthält                    |
|-----------------|--------------------------------------------|----------------------------|
| Flüssigmetall   | –                                          | 2× Nanobot                 |
| Späher-Gleiter  | sehr schnell                               | –                          |
| Panzer-Crawler  | gepanzert (−3 Schaden pro Treffer)         | 3× Späher-Gleiter          |
| Tarndrohne      | immun gegen Kälte                          | 3× Plasmafunke             |
| Reparaturdrohne | repariert Gegner in der Nähe               | 2× Nanobot                 |
| Titan-Mech      | schwer gepanzert (jede 5. Welle)           | 2× Panzer-Crawler, 2× Flüssigmetall |
| Omega-Koloss    | Endboss in Welle 30                        | 3× Titan-Mech, 4× Panzer-Crawler |
| Nanobot         | klein und flink                            | –                          |
| Plasmafunke     | blitzschnell, immun gegen Kälte            | –                          |

## Dateien

- `index.html` – Seitenaufbau
- `style.css` – Chrom-Look der Oberfläche
- `game.js` – Spiellogik. Oben in der Datei lassen sich Wege (`PATHS`), Energiebecken (`POOLS`), Hindernisse (`OBSTACLES`), Türme (`TOWER_TYPES`), Ausbaupfade (`UPGRADE_PATHS`) und Gegner (`ENEMY_TYPES`) leicht anpassen.
- `scene.js` – 3D-Darstellung: Stadt, Spielfeld, Modelle für Türme, Gegner, Raumschiffe und Geschosse, Effekte, Leuchten (Bloom) und Kamera
- `lib/` – Three.js 0.147 mit OrbitControls, RoundedBoxGeometry und den Bloom-Nachbearbeitungsdateien (MIT-Lizenz, siehe `lib/three-LICENSE`)
