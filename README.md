# LILA BLACK — Player Journey Visualizer

> An interactive browser-based telemetry visualization tool for LILA BLACK, built as part of the LILA Games APM Written Assessment.

**[→ Open the Live Tool](https://shivaa001.github.io/lila-black-visualizer/)**

---

## What It Does

Turns raw gameplay telemetry into an interactive map explorer that a Level Designer can open in a browser with zero setup. Select any match, explore player movement, kill zones, loot hotspots, and bot behavior — all overlaid on the actual in-game minimap.

---

## Dataset

| Stat | Value |
|------|-------|
| Matches | 796 |
| Total Events | 89,104 |
| Unique Players | 339 |
| Maps | Ambrose Valley, Grand Rift, Lockdown |
| Period | Feb 10 – 14, 2025 |

---

## Features

### Visualization Modes
| Mode | Description |
|------|-------------|
| ⬡ Scatter | All events plotted as individual markers on the minimap |
| 🌡 Heatmap | Density overlay — traffic, kill zones, or loot hotspots |
| 〰 Paths | Per-player movement trails with direction arrows |
| ▶ Replay | Frame-by-frame match playback with a timeline slider |

### Filters & Layers
- **Map filter** — Ambrose Valley, Grand Rift, Lockdown
- **Date filter** — Feb 10–14 individually
- **Player type** — All / Human only / Bots only
- **Layer toggles** — Positions, Kills, Loot Pickups, Movement Trails, Heatmap, Show Bots

### Interactions
- Scroll to zoom (up to 12×), drag to pan, double-click to reset
- Hover any event marker for a tooltip: event type, player type, world coordinates, match timestamp
- Live world-coordinate readout at cursor position
- Playback speed controls: 0.5× / 1× / 2× / 5×

### Analytics Panel
- Per-match stats: total players, kills, loot pickups, human/bot split, match duration
- Top kill-streakers (≥3 kills) with kill counts
- 3×3 zone kill density grid overlaid on the minimap

---

## Event Types & Visual Markers

| Event | Marker | Color |
|-------|--------|-------|
| Position (Human) | Filled circle | Blue `#4fc3f7` |
| Position (Bot) | Small circle | Purple `#ba68c8` |
| Kill | × cross | Pink `#f06292` |
| Bot Kill | × cross (faint) | Orange `#ff8a65` |
| Killed (Death) | Circle + cross | Red `#ef5350` |
| Storm Death | Circle + cross | Cyan `#80deea` |
| Loot Pickup | Diamond | Green `#69f0ae` |

---

## Architecture

### Data Flow
```
Raw Parquet files (5 days of telemetry)
        ↓  Python preprocessing (pandas)
JSON payload embedded in index.html
        ↓  Browser parses on load
Canvas 2D rendering engine
        ↓  User interactions
Dynamic re-render on every state change
```

### Key Technical Decisions

**Single HTML file** — The entire app (HTML + CSS + JS + data) is one file. No build step, no server, no CORS issues. Works offline and deploys to GitHub Pages instantly.

**Vanilla JS + Canvas 2D** — React's reconciliation overhead is unnecessary when drawing 50k+ events imperatively to a canvas. Direct Canvas 2D calls are faster and require zero dependencies.

**Dual-canvas architecture** — `bg-cvs` draws the static minimap (only redraws on zoom/pan). `main-cvs` draws all events and clears on every frame. Avoids redrawing the map image 60× per second.

**Single state object** — All UI state lives in one global `S = { match, viz, layers, zoom, pan, play, ... }`. Every interaction mutates `S` and calls `renderAll()`. Debugging is trivial — `console.log(S)` shows the full app state.

**Coordinate projection (`w2c`)** — Converts Unreal Engine world-space (cm, Y-up) to canvas pixels using uniform scaling (aspect-preserving), centered on the viewport, with pan/zoom as linear offsets.

### Data Quality Handling
- **Null coordinates** — 21 events with `x=null` (Nakama engine default spawn) excluded via `isValidCoord()`
- **Corrupt outliers** — Events where `|x|` or `|z|` > 600 (out-of-map values) also excluded
- **Bot detection** — The `is_bot` flag is `false` for all events in this dataset; bot identification is done via event type name (`BotPosition`, `BotKill`, `BotKilled`)

---

## Running Locally

No installation needed. Just open the file:

```bash
git clone https://github.com/SHIVAA001/lila-black-visualizer
cd lila-black-visualizer
open index.html   # or double-click it
```

Or use the live hosted version: **[shivaa001.github.io/lila-black-visualizer](https://shivaa001.github.io/lila-black-visualizer/)**

---

## What I'd Do With More Time

- **WebGL rendering** — Required for datasets > 500k events; Canvas 2D hits limits at scale
- **Arrow IPC streaming** — Load match data on demand instead of embedding everything upfront
- **URL state encoding** — Encode the current view as a URL param so shared links restore exactly what you're looking at
- **Named zone annotations** — POI overlays (drop zones, loot hotspots) from a static GeoJSON layer
- **Multi-match comparison** — Side-by-side diff view between two matches on the same map

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | Vanilla JS | Zero deps, direct Canvas control |
| Rendering | HTML5 Canvas 2D | Sufficient for <50k events/match |
| Data pipeline | Python + pandas | Parquet parsing, bounds computation |
| Hosting | GitHub Pages | Free, instant, no server needed |
| Fonts | Inter + JetBrains Mono | Clean UI + monospace for data values |

---

*Built by Shivansh Dawan · LILA Games APM Assessment*
