# Neo-City Defense – Projektnotizen für Claude

3D-Tower-Defense im Browser (Retro-Synthwave/Chromecore). Reines HTML/CSS/JS mit Three.js 0.147, ohne Build-Schritt.

## Zusammenarbeit mit dem Nutzer

- Immer **auf Deutsch** antworten, einfach und ohne Fachjargon erklären (der Nutzer ist kein Programmierer und spielt oft am Handy).
- **Fertige, getestete Änderungen direkt in `main` pushen** (dauerhafte Erlaubnis), Entwicklungs-Branch: `claude/tower-defence-game-4wgbci`. Vorher prüfen, dass `main` per Fast-Forward erreichbar ist; bei Konflikten erst fragen.
- Sagt der Nutzer „warte“ / „erst starten, wenn ich es sage“: nur Wünsche sammeln und zusammenfassen, bis er „Start“ schreibt.
- Bei größeren Optik-Änderungen zuerst ein **Testbild** schicken und abwarten.
- Am Ende kurz zusammenfassen: was neu ist, was getestet wurde, was nicht prüfbar war (Musik anhören, echte FPS), welche Entscheidungen selbst getroffen wurden.
- Das Spiel ist über GitHub Pages erreichbar (Branch `main`, Root): https://bhb1011-creator.github.io/Towerdefense/ (sofern der Nutzer Pages eingeschaltet hat).

## Dateien

- `index.html` – Seitenaufbau, Skript-Reihenfolge: lib → `data.js` → `audio.js` → `scene.js` → `game.js`
- `data.js` – Karte, Schwierigkeiten, Gegner (`DRONE_LEVELS`, `PROPS`, `HEAVY`), Türme mit je 3 Ausbauwegen × 5 Stufen (`TOWER_TYPES`), Wellen (`buildWave`, `BOSS_RETURNS`)
- `game.js` – Spielablauf (Update-Schleife, Schadenssystem `damageEnemy`, Türme, Raumschiffe), Speichern (localStorage), Hauptmenü, HUD, Turm-Panel
- `scene.js` – `View`-Modul: Welt (Sonne, Meer, Berge, Stadt), Boden, Modelle, Effekte, Bloom, Kamera. Liest nur `state`, reagiert auf `state.events`
- `audio.js` – `Sound`-Modul: prozeduraler Synthwave-Soundtrack (88 BPM, A-Moll) und Effekte über Web Audio
- `lib/` – Three.js 0.147 + OrbitControls, RoundedBoxGeometry, Bloom-Passes (klassische Skripte, damit `index.html` per Doppelklick/file:// läuft – **keine ES-Module verwenden**)
- `versionen/` – spielbare Archiv-Versionen 1–4 + Übersicht `versionen/index.html` (teilen sich `lib/`)

## Spielregeln (Stand jetzt)

- 50 Wellen. Boss „Omega-Koloss“ in Welle 30 (Lebensanzeige), kehrt in 40/43/45 einzeln und 47/49 doppelt zurück (ohne Anzeige). Endboss „Hyperion-Mutterschiff“ in Welle 50 setzt 4 Kolosse frei (je eigene Anzeige).
- Stufen-Drohnen 1–5: jeder Schadenspunkt = −1 Stufe, höhere Stufen schneller. Spezialeigenschaften: Tarnung (ab 12), Frostschild (15), Explosionspanzer (18), Spiegelpanzer (21), Regeneration (24), kombiniert ab 28. Panzerkerne ab 22.
- Normale Gegner haben **keine** Lebensbalken; Schaden wird optisch gezeigt.
- Türme: Laser, Plasma, Kryo, Mörser (Zielpunkt frei wählbar), Raumstation (ab Welle 8, Upgrades ab 12). Upgrade-Regel **nur 5-2-0** (ein Weg bis 5, ein zweiter bis 2).
- Pause erlaubt Bauen, Auto-Start, Schwierigkeit Leicht/Normal/Schwer, Autosave nach jeder Welle.

## Testen

- Logik/Balance ohne Grafik in Node testen: `data.js` + `game.js` in einem `vm`-Kontext mit Stub-`document`, `View`, `Sound`, `localStorage` laden und Bots spielen lassen (Spam-Bot mit nur 0-0-0-Türmen soll etwa in Welle 25–30 verlieren; Upgrade-Bot soll Boss 30 schaffen).
- Browser-Tests mit Playwright und Chromium unter `/opt/pw-browsers/chromium` mit `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` (Software-Rendering, daher langsam; FPS nicht aussagekräftig).
- Vor dem Push: `node --check` für alle JS-Dateien, Browser-Test auf Konsolenfehler, Screenshots ansehen.
