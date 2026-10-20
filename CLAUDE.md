# Neo-City Defense – Projektnotizen für Claude

3D-Tower-Defense im Browser (Retro-Synthwave, Aliens greifen eine Retro-Miami-Stadt an). Reines HTML/CSS/JS mit Three.js 0.147, ohne Build-Schritt.

## Zusammenarbeit mit dem Nutzer

- Immer **auf Deutsch** antworten, einfach und ohne Fachjargon erklären (der Nutzer ist kein Programmierer und spielt oft am Handy).
- **Fertige, getestete Änderungen direkt in `main` pushen** (dauerhafte Erlaubnis), Entwicklungs-Branch: `claude/tower-defence-game-4wgbci`. Vorher prüfen, dass `main` per Fast-Forward erreichbar ist; bei Konflikten erst fragen.
- Sagt der Nutzer „warte“ / „erst starten, wenn ich es sage“: nur Wünsche sammeln und zusammenfassen, bis er „Start“ schreibt.
- Bei größeren Optik-Änderungen zuerst ein **Testbild** schicken und abwarten.
- Am Ende kurz zusammenfassen: was neu ist, was getestet wurde, was nicht prüfbar war (Musik anhören, echte FPS), welche Entscheidungen selbst getroffen wurden.
- Das Spiel ist über GitHub Pages erreichbar (Branch `main`, Root): https://bhb1011-creator.github.io/Towerdefense/ (sofern der Nut## Dateien

- `index.html` – Seitenaufbau, Skript-Reihenfolge: lib → `data.js` → `audio.js` → `aliens.js` → `buildings.js` → `towers.js` → `city.js` → `scene.js` → `progress.js` → `game.js`. Neue Dateien auch in `package.json` (`build.files`, Mac-App) eintragen.
- `data.js` – Karte 24×14 Felder (TILE 40 px): Wege `PATHS`, Tunnel `TUNNEL`/`TUNNEL_RECT`, Seen `LAKES` (glatte Form, `POOLS` = gesperrte Felder), Gehwege `WALKWAYS`/`WALK_CURVES`/`walkTiles`, Gelände (`terrainHeight` = sichtbarer Boden mit Tunnelberg, `baseHeight` = Straßenhöhe; Höhenraster werden beim ersten Aufruf berechnet, Straße und Gehwege sind eingeschnitten). Dazu Gebäude `OBSTACLES` (10 Arten), Schwierigkeiten, Gegner (`DRONE_LEVELS`, `PROPS`, `HEAVY`), Türme (`TOWER_TYPES`), Wellen.
- `game.js` – Spielablauf (Update-Schleife, `damageEnemy`, Türme 2×2 mit `col,row` = Feld oben links, `buildAnchor`, Tunnel-Unverwundbarkeit `e.inTunnel`), Speichern (localStorage, `SAVE_KEY` v3), Hauptmenü, HUD, Turm-Panel mit Upgrade-Vorschau (Bild via `View.towerPreview`, Werte-Balken, Kaufen-Knopf).
- `progress.js` – Spezialfähigkeiten (`ABILITIES`, `useAbility`, ab Stufe 5 je Turmart) und Erfolge (`Achievements`, eigener localStorage-Schlüssel).
- `scene.js` – `View`-Modul: Welt, Spielfeld (Boden folgt dem Gelände, Höhenlinien, Seen-Shader mit Maske), Tunnelportale, Gegner-/Turm-Darstellung, Effekte, Tag-Nacht-Stimmungen `MOODS` je Welle, Bloom, Kamera. Liest nur `state`, reagiert auf `state.events`. Test-Helfer: `View.lookAt`, `View.debugStats`, `View.debugMood(true)`.
- `aliens.js` – Alien-Modelle (`Aliens.build(kind, {level, color, props})`) mit `animate(t, moving)`; Blickrichtung +X.
- `towers.js` – Turm-Modelle (`Towers.build(type, levels)`): stärkster Weg formt den Kopf, zweiter Weg Anbauten.
- `buildings.js` – die 10 Gebäudearten auf dem Spielfeld; `city.js` – Retro-Miami-Stadt (Straßen, Autos, Art-déco, Hochhäuser, Strand), Geometrie in wenigen Meshes zusammengefasst.
- `audio.js` – `Sound`-Modul: Synthwave-Soundtrack (88 BPM, A-Moll), Effekte und Alien-Stimmen per Formant-Synthese (`creature`). `Sound.init(offlineCtx)` + `play(name, {delay})` erlaubt Hörproben als WAV.
- `lib/` – Three.js 0.147 + OrbitControls, RoundedBoxGeometry, BufferGeometryUtils, Bloom-Passes (klassische Skripte, damit `index.html` per Doppelklick/file:// läuft – **keine ES-Module verwenden**)
- `versionen/` – spielbare Archiv-Versionen 1–5 + Übersicht `versionen/index.html` (teilen sich `lib/`); Version 6 ist das aktuelle Spiel.

## Spielregeln (Stand jetzt)

- 50 Wellen. Boss „Omega-Jäger“ in Welle 30 (Lebensanzeige), kehrt in 40/43/45 einzeln und 47/49 doppelt zurück (ohne Anzeige). Endboss „Brut-Mutterschiff“ in Welle 50 setzt 4 Omega-Jäger frei (je eigene Anzeige).
- Stufen-Aliens 1–5: jeder Schadenspunkt = −1 Stufe, höhere Stufen schneller. Spezialeigenschaften: Tarnung (ab 12), Frostschild (15), Explosionspanzer (18), Spiegelpanzer (21), Regeneration (24), kombiniert ab 28. Brocken ab 22.
- Normale Gegner haben **keine** Lebensbalken; Schaden wird optisch gezeigt.
- Türme (2×2 Felder): Laser, Plasma, Kryo, Mörser (Zielpunkt frei wählbar), Raumstation (ab Welle 8, Upgrades ab 12). Upgrade-Regel **nur 5-2-0**; jedes Stufe-5-Upgrade nur 1× pro Turmart und Weg auf der Karte. Ab Stufe 5 Spezialfähigkeit der Turmart (Knopf oben links).
- Tunnel: Aliens schrumpfen und sind darin unverwundbar.
- Pause erlaubt Bauen, Auto-Start, Schwierigkeit Leicht/Normal/Schwer, Autosave nach jeder Welle, 10 Erfolge (Bronze/Silber/Gold).
- Wünsche des Nutzers zur Optik: Aliens sollen böse aussehen (Alien-Augen), Seen glatt und rund mit Uferweg, Gehwege geschwungen, Gelände sanft hügelig mit eingeschnittenen Wegen, Sci-Fi nur auf dem Spielfeld (Stadt = Retro-Miami der 80er).

r, Autosave nach jeder Welle.

## Testen

- Logik/Balance ohne Grafik in Node testen: `data.js` + `progress.js` + `game.js` in einem `vm`-Kontext mit Stub-`document`, `View`, `Sound`, `localStorage` laden und Bots spielen lassen (Spam-Bot mit nur 0-0-0-Türmen soll etwa in Welle 25–30 verlieren; Upgrade-Bot soll Boss 30 schaffen; Bauplätze sind 2×2). Stand: Spam verliert Welle 26, Upgrade-Bot schafft 30 und verliert bei 50, gewinnt auf Leicht.
- Browser-Tests mit Playwright und Chromium unter `/opt/pw-browsers/chromium` mit `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` (Software-Rendering, sehr langsam; FPS nicht aussagekräftig). Leistung über `View.debugStats()` (Meshes/Dreiecke) im Blick behalten, Spiel läuft oft am Handy.
- Vor dem Push: `node --check` für alle JS-Dateien, Browser-Test auf Konsolenfehler, Screenshots ansehen.
