# LILA BLACK — Player Journey Visualizer

A browser-based telemetry visualization tool built for the LILA Games APM assessment. Turns raw extraction-shooter gameplay data into an interactive map tool that Level Designers can use to understand player behavior across matches.

**[→ Open the live tool](#)** ← replace with your GitHub Pages URL



## What It Does

Load any of 796 matches from 5 days of LILA BLACK production data and explore:

- **Scatter view** — every event plotted on the minimap: kills (×), loot (◇), positions (●), bots vs humans color-coded
- **Heatmap** — density overlay for traffic, kills, or loot pickups
- **Paths** — per-player movement trails with directional arrows
- **Replay** — step through a match event-by-event with live player heads and speed controls
- **Analytics panel** — per-match stats: K/D ratio, duration, kill leaders, 3×3 zone kill heatmap

Filter by map, date, or player type at any time. Hover any event for a tooltip with coordinates, elevation, player ID, and timestamp.



## Dataset

| Stat | Value |
|------|-------|
| Matches | 796 |
| Events | 19,793 |
| Maps | Ambrose Valley (566), Lockdown (171), Grand Rift (59) |
| Period | February 10–14 |
| Players | 248 unique humans, 96 bots |



## Running Locally

No build step, no dependencies.

```bash
# Just open the file
open index.html
```

Or drag `index.html` into any browser. Everything is self-contained — game data, minimap images, and application logic are all embedded in the single HTML file.



## Repo Structure

```
index.html       Full deployed tool (data + logic, self-contained)
visualizer.js    Application logic only — readable version for code review
README.md        This file
architecture.docx  Technical design doc (stack choices, data pipeline, trade-offs)
```

> **Note for reviewers:** `index.html` is ~3MB because the pre-processed match data and base64 minimap images are embedded inline for zero-dependency deployment. The actual application logic is 27KB — see `visualizer.js` for a clean read.

---

## Tech Stack

- **Vanilla HTML/CSS/JS** — no framework, no build toolchain
- **HTML5 Canvas (2 layers)** — background minimap + foreground events, redrawn independently
- **Pre-processed JSON** — parquet files converted offline, embedded at build time

Full decisions and trade-offs in `architecture.docx`.

---

## Data Nuances Handled

- Coordinate mapping: game `X` → East-West, game `Z` → North-South, game `Y` → elevation; Y-axis inverted for canvas
- Sentinel filtering: `x ≈ 8.82` is the Nakama default spawn (null position indicator), filtered out
- Outlier filtering: `|x|` or `|y|` > 500 are corrupt values, filtered out
- 21 events with `x = null` — explicit null guard added
- 396 whitespace corruptions in source JSON numbers and UUIDs — cleaned in preprocessing
- Bot detection via `is_bot` field; bot IDs are short integers vs human UUIDs
- Unix epoch timestamps decoded to `HH:MM:SS` for display
