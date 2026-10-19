# Tower Defense

Ein simples Tower-Defense-Spiel im Browser – reines HTML, CSS und JavaScript, ohne Abhängigkeiten.

## Starten

`index.html` im Browser öffnen. Fertig.

## Spielen

- **Turm bauen:** Turm unten auswählen (oder Taste `1`–`3`) und auf ein freies Grasfeld klicken.
- **Welle starten:** Button „Welle starten“ oder `Leertaste`.
- **Turm verbessern/verkaufen:** Auf einen gebauten Turm klicken.
- **Tempo:** 1x / 2x / 3x umschalten.

Lässt ein Gegner das Ende des Weges erreichen, verlierst du ein Leben. Bei 0 Leben ist das Spiel vorbei.

### Türme

| Turm      | Kosten | Besonderheit                     |
|-----------|--------|----------------------------------|
| Pfeilturm | 50     | Schnelle Einzelschüsse           |
| Kanone    | 90     | Langsam, Flächenschaden          |
| Frostturm | 70     | Verlangsamt Gegner um 50 %       |

Jeder Turm kann zweimal verbessert werden (max. Stufe 3).

### Gegner

- **Grün** – normal
- **Gelb** – schnell, wenig Leben (ab Welle 2)
- **Rot** – Panzer, langsam und zäh (ab Welle 4, extra in jeder 5. Welle)

## Dateien

- `index.html` – Seitenaufbau
- `style.css` – Aussehen
- `game.js` – Spiellogik (Wegpunkte, Türme und Gegner sind oben in `WAYPOINTS`, `TOWER_TYPES` und `ENEMY_TYPES` leicht anpassbar)
