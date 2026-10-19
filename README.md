# Tower Defense

Ein Tower-Defense-Spiel im Browser – reines HTML, CSS und JavaScript, ohne Abhängigkeiten.

## Starten

`index.html` im Browser öffnen. Fertig.

## Spielen

- **Turm bauen:** Turm unten auswählen (oder Taste `1`–`3`) und auf ein freies Grasfeld klicken.
- **Welle starten:** Button „Welle starten“ oder `Leertaste`.
- **Turm verbessern/verkaufen:** Auf einen gebauten Turm klicken.
- **Tempo:** 1x / 2x / 3x umschalten.

Die Gegner kommen aus zwei Höhlen und laufen auf zwei Wegen, die sich in der Mitte zu einem Weg vereinen und zur Burg führen. Erreicht ein Gegner die Burg, verlierst du Leben (große Gegner kosten mehr). Bei 0 Leben ist das Spiel vorbei.

### Karte

- **Seen:** Hier kann nie gebaut werden.
- **Bäume (15 💰) und Felsen (30 💰):** blockieren das Feld, können aber angeklickt und entfernt werden.

### Türme

| Turm      | Kosten | Besonderheit                               |
|-----------|--------|--------------------------------------------|
| Pfeilturm | 50     | Schnelle Einzelschüsse                     |
| Kanone    | 90     | Langsam, Flächenschaden, gut gegen Panzer  |
| Frostturm | 70     | Verlangsamt Gegner                         |

Jeder Turm hat **zwei Ausbaupfade**, jeweils bis Stufe 3:

- **Reichweite** (blau): +18 % Reichweite pro Stufe (Frost: längere Verlangsamung, Kanone: größere Explosion)
- **Schaden** (rot): +45 % Schaden pro Stufe (Frost: stärkere Verlangsamung)

Die Stufen siehst du als blaue und rote Punkte unten am Turm.

### Gegner

Manche Gegner tragen kleinere Gegner in sich, die beim Tod freigesetzt werden:

| Gegner   | Fähigkeit                       | Enthält               |
|----------|---------------------------------|-----------------------|
| Schleim  | –                               | 2× Winzling           |
| Flitzer  | sehr schnell                    | –                     |
| Käfer    | gepanzert (−3 Schaden/Treffer)  | 3× Flitzer            |
| Geist    | immun gegen Frost               | 3× Irrlicht           |
| Heiler   | heilt Gegner in der Nähe        | 2× Winzling           |
| Golem    | Boss, stark gepanzert (jede 5. Welle) | 2× Käfer, 2× Schleim |
| Winzling | klein und flink                 | –                     |
| Irrlicht | blitzschnell, immun gegen Frost | –                     |

Im Spiel gibt es unter der Karte eine aufklappbare Gegner-Übersicht.

## Dateien

- `index.html` – Seitenaufbau
- `style.css` – Aussehen
- `game.js` – Spiellogik. Oben in der Datei lassen sich Wege (`PATHS`), Seen (`LAKES`), Hindernisse (`OBSTACLES`), Türme (`TOWER_TYPES`), Ausbaupfade (`UPGRADE_PATHS`) und Gegner (`ENEMY_TYPES`) leicht anpassen.
