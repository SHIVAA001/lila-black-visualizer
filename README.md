# 🎮 LILA BLACK — Player Journey Visualizer

A browser-based telemetry visualization tool built for LILA Games' Level Design team. It turns raw gameplay data from *LILA BLACK* (an extraction shooter) into an interactive, explorable map experience — no data science background required.

---

## 🔗 Live Demo

> **[→ Open the Tool](https://shivaa001.github.io/lila-black-visualizer/)**

---

## 📸 Features

| Feature | Description |
|---|---|
| **Multi-map support** | Visualize player events across all 3 maps: Ambrose Valley, Grand Rift, and Lockdown |
| **Human vs. Bot distinction** | Players and bots are visually differentiated by color on the minimap |
| **Event markers** | Kills, deaths, loot pickups, and storm deaths rendered as distinct icons |
| **Timeline playback** | Replay any match event-by-event with 0.5×, 1×, 2×, 5× speed controls |
| **Heatmap overlays** | Kill zones, death zones, and high-traffic areas as density overlays |
| **Filtering** | Filter by map, date, and individual match ID |
| **Match list** | Sorted by event richness; shows player count and kill count per match |
| **Tooltips** | Click any event marker to inspect player ID, event type, coordinates, and timestamp |
| **Analytics panel** | Match-level stats: total kills, events, top players by kills |
| **Pan & zoom** | Drag to pan, scroll to zoom, double-click to reset view |
| **Live coordinate display** | World-space coordinates shown as you hover over the minimap |

---

## 🗂️ Project Structure

```
├── index.html          # Single-file application (HTML + CSS + JS)
├── README.md
└── data/               # (not committed) raw parquet files from player_data.zip
```

> The tool is intentionally shipped as a **single HTML file** — no build step, no dependencies, no server required. Open it in any browser.

---

## 🚀 Running Locally

```bash
# Clone the repo
git clone https://github.com/SHIVAA001/lila-black-visualizer.git
cd lila-visualizer

# Open directly in browser (no server needed)
open index.html
```

If you want to serve it (e.g. to avoid CORS issues when loading local assets):

```bash
python3 -m http.server 8080
# then visit http://localhost:8080
```

---

## 🏗️ Architecture

### Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS + Canvas API | Zero dependencies, instant load, maximum control over rendering |
| Data pipeline | Python (pandas + pyarrow) → JSON | Parquet → filtered JSON embedded in the HTML at build time |
| Hosting | Static file host (Netlify / GitHub Pages) | Single HTML file = trivially deployable anywhere |

### Data Flow

```
Raw .parquet files
       ↓
Python script (parse_data.py)
  - Reads parquet with pyarrow/pandas
  - Decodes bytes-encoded fields (user_id, map_id, etc.)
  - Maps world coordinates → minimap pixel space
  - Detects bots via naming convention / flag in schema
  - Groups events by match_id
       ↓
Serialized as JSON (embedded in index.html as a JS constant)
       ↓
Browser renders events on <canvas> using the minimap image as background
  - Timeline scrubber filters events by timestamp
  - Heatmap layer uses kernel density estimation on event positions
  - Filters (map / date / match) applied in-memory
```

### Coordinate Mapping

World coordinates from the telemetry data are mapped to minimap pixel space using the bounds defined in the README provided with the dataset. Each map has its own `(world_min, world_max) → (px_min, px_max)` linear transform applied at parse time.

---

## ⚙️ Data Processing

The raw data is pre-processed with a Python script before being embedded into the tool:

```bash
pip install pandas pyarrow

python parse_data.py \
  --input ./data/ \
  --output ./src/data.js
```

Key processing steps:
- **Bytes decoding**: Several fields (`user_id`, `match_id`, `map_id`) are stored as raw bytes in the parquet files and decoded to UTF-8 strings.
- **Bot detection**: Players are flagged as bots using the `is_bot` field in the schema (falling back to naming pattern matching where the field is absent).
- **Coordinate normalization**: World-space `(x, y)` values are linearly normalized per-map to the minimap image dimensions.
- **Timestamp parsing**: Unix millisecond timestamps are converted to relative match time (seconds from match start) to power the timeline playback.

---

## 🔑 Assumptions Made

- **Bot detection**: Used the `is_bot` boolean from the schema as the primary signal. Where missing, applied a regex heuristic on `user_id` naming patterns.
- **Storm death categorization**: Events with `cause_of_death == "storm"` (or equivalent field) were separated from player kills and rendered as a distinct event type.
- **Coordinate system**: Assumed `(0,0)` is bottom-left, Y increases upward — consistent with Unreal Engine conventions documented in the README.
- **Missing minimap regions**: For events that fall outside the known minimap bounds (edge cases from teleports or out-of-bounds positions), the marker is clamped to the nearest valid edge pixel rather than dropped.

---

## 🔮 What I'd Do Differently With More Time

1. **Server-side filtering**: Move data to a lightweight backend (FastAPI or Cloudflare Workers) to support filtering millions of events without embedding everything in a JS bundle.
2. **WebGL rendering**: Replace Canvas 2D with WebGL (via deck.gl or raw shaders) for smooth rendering at 100k+ events.
3. **Persistent URL state**: Encode active filters + selected match in the URL hash so designers can share a specific view.
4. **Zone annotation layer**: Let designers draw polygons on the map and auto-compute "% of kills inside zone" — closes the loop from insight to design change.
5. **Player trail rendering**: Smooth interpolated paths between position events, not just scatter markers.
6. **Real parquet streaming**: Load parquet files directly in the browser via Apache Arrow JS + WASM, eliminating the preprocessing step.

---

## 📋 Deliverables Checklist

- [x] Hosted tool accessible via URL
- [x] Git repository (this repo)
- [x] Architecture doc (see above + `ARCHITECTURE.md` in repo root)
- [x] Demo walkthrough (15-min call)

---

## 👤 Author

**Shivansh Dawan**
Built as part of the LILA Games APM Written Test.
