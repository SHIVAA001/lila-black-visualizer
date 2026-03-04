/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║            LILA BLACK — Nakama Telemetry Visualiser                        ║
 * ║            github.com/your-org/lila-black-visualiser                       ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║  A canvas-based match visualiser for Nakama battle-royale telemetry data.  ║
 * ║  Renders player positions, kill events, loot pickups, and movement paths   ║
 * ║  on top of per-map minimaps. Supports scatter, heatmap, path, and replay   ║
 * ║  visualisation modes with full timeline playback.                          ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║  USAGE                                                                     ║
 * ║  ─────                                                                     ║
 * ║  1. Include this file after your data file in index.html:                  ║
 * ║       <script src="data.js"></script>   <!-- defines window.D -->          ║
 * ║       <script src="visualiser.js"></script>                                ║
 * ║                                                                            ║
 * ║  2. Or call LilaVisualiser.init(data) manually:                            ║
 * ║       import { LilaVisualiser } from './visualiser.js';                    ║
 * ║       LilaVisualiser.init(window.D);                                       ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║  DATA FORMAT  (window.D or argument to LilaVisualiser.init)                ║
 * ║  ──────────────────────────────────────────────────────────                ║
 * ║  {                                                                         ║
 * ║    matches: {                                                              ║
 * ║      "<uuid>": {                                                           ║
 * ║        id:     string,          // match UUID                              ║
 * ║        map_id: string,          // "AmbroseValley" | "GrandRift" |         ║
 * ║                                 //   "Lockdown"                            ║
 * ║        date:   string,          // e.g. "February_10"                      ║
 * ║        events: [{               // array of telemetry events               ║
 * ║          user_id: string,       // player UUID (or short bot ID)           ║
 * ║          is_bot:  boolean,                                                 ║
 * ║          x:      number,        // world X (east-west)                     ║
 * ║          y:      number,        // world Y (elevation / height)            ║
 * ║          z:      number,        // world Z (north-south map axis)          ║
 * ║          ts:     number,        // Unix timestamp in seconds               ║
 * ║          event:  string,        // see EVENT TYPES below                   ║
 * ║        }]                                                                  ║
 * ║      }                                                                     ║
 * ║    },                                                                      ║
 * ║    map_bounds: {                                                           ║
 * ║      "<map_id>": { minx, maxx, miny, maxy }                               ║
 * ║      // miny/maxy refer to the Z axis (north-south), not elevation        ║
 * ║    },                                                                      ║
 * ║    minimaps: {                                                             ║
 * ║      "<map_id>": { data: "data:image/jpeg;base64,…", w: 1024, h: 1024 }   ║
 * ║    }                                                                       ║
 * ║  }                                                                         ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║  EVENT TYPES                                                               ║
 * ║  ───────────                                                               ║
 * ║  Position        Human player position update (every ~5 s)                ║
 * ║  BotPosition     Bot position update                                       ║
 * ║  Kill            Human killed another human                               ║
 * ║  Killed          Human was killed by another human                        ║
 * ║  BotKill         Human killed a bot                                       ║
 * ║  BotKilled       Bot was killed (by human or storm)                       ║
 * ║  KilledByStorm   Player eliminated by the storm zone                      ║
 * ║  Loot            Player picked up a loot item                             ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║  COORDINATE SYSTEM                                                         ║
 * ║  ──────────────────                                                        ║
 * ║  The game engine uses a right-hand coordinate system where:                ║
 * ║    X  = east-west  (used as canvas horizontal axis)                       ║
 * ║    Z  = north-south (used as canvas vertical axis — higher Z = north)     ║
 * ║    Y  = elevation / height (NOT used for 2-D map rendering)               ║
 * ║                                                                            ║
 * ║  Map bounds { minx, maxx, miny, maxy } represent the X and Z extents:     ║
 * ║    miny / maxy  ←→  min Z / max Z  (south / north edges of the map)      ║
 * ╠══════════════════════════════════════════════════════════════════════════════╣
 * ║  VERIFIED MAP BOUNDS  (derived from full dataset — 89,104 events)         ║
 * ║  ──────────────────────────────────────────────────────────────            ║
 * ║  AmbroseValley   X: -344 … 321    Z: -400 … 380                           ║
 * ║  GrandRift       X: -245 … 276    Z: -214 … 190                           ║
 * ║  Lockdown        X: -426 … 368    Z: -305 … 349                           ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 * @version  2.0.0
 * @license  MIT
 */

/* ─────────────────────────────────────────────────────────────────────────────
   IIFE wrapper — exposes LilaVisualiser on window for plain-script usage,
   and as a named export for ES-module usage.
───────────────────────────────────────────────────────────────────────────── */
const LilaVisualiser = (() => {

  // ── DATA ──────────────────────────────────────────────────────────────────
  /** @type {Record<string,{id,map_id,date,events:Array}>} */
  let MATCHES = {};
  /** @type {Record<string,{minx,maxx,miny,maxy}>} */
  let BOUNDS  = {};
  /** @type {Record<string,{data:string,w:number,h:number}>} */
  let MAPS    = {};
  /** Preloaded HTMLImageElement per map */
  const IMG   = {};

  // ── EVENT COLOURS ─────────────────────────────────────────────────────────
  /**
   * Returns the canonical display colour for a given event type.
   * @param {string} eventType
   * @returns {string} CSS colour string
   */
  function eColor(eventType) {
    const palette = {
      Position:      '#4fc3f7',   // sky blue
      BotPosition:   '#ba68c8',   // violet
      Kill:          '#f06292',   // hot pink   — human kills human
      Killed:        '#ef5350',   // red        — human was killed
      BotKill:       '#ff8a65',   // orange     — human kills bot
      BotKilled:     '#ce93d8',   // lavender   — bot was killed
      KilledByStorm: '#80deea',   // cyan       — storm elimination
      Loot:          '#69f0ae',   // mint green
    };
    return palette[eventType] ?? '#b0bec5';
  }

  // ── COORDINATE FILTER ─────────────────────────────────────────────────────
  /**
   * Rejects events with null or implausibly large coordinates.
   * Uses X and Z (the map plane), NOT Y (elevation).
   * Threshold 600 safely exceeds the largest real coordinate (~407 / ~380).
   *
   * @param {{ x:number|null, z:number|null }} e
   * @returns {boolean}
   */
  function isValidCoord(e) {
    if (e.x == null || e.z == null) return false;
    if (Math.abs(e.x) > 600 || Math.abs(e.z) > 600) return false;
    return true;
  }

  // ── APPLICATION STATE ─────────────────────────────────────────────────────
  /**
   * Single mutable state object — avoids scattered globals.
   * @type {{
   *   match:       string|null,
   *   mapFilter:   string,
   *   dateFilter:  string,
   *   playerFilter: string,
   *   viz:         'scatter'|'heatmap'|'paths'|'replay',
   *   heatType:    'traffic'|'kills'|'loot',
   *   layers:      Record<string,boolean>,
   *   zoom:        number,
   *   pan:         {x:number, y:number},
   *   drag:        {sx:number, sy:number}|null,
   *   play:        {on:boolean, speed:number, timer:ReturnType<typeof setTimeout>|null},
   *   showStats:   boolean,
   * }}
   */
  const S = {
    match:        null,
    mapFilter:    'all',
    dateFilter:   'all',
    playerFilter: 'all',
    viz:          'scatter',
    heatType:     'traffic',
    layers: {
      position: true,
      kills:    true,
      loot:     true,
      paths:    false,
      heatmap:  false,
      bots:     true,
    },
    zoom: 1,
    pan:  { x: 0, y: 0 },
    drag: null,
    play: { on: false, speed: 1, timer: null },
    showStats: false,
  };

  // ── PLAYER COLOURS ────────────────────────────────────────────────────────
  const PLAYER_COLORS = [
    '#4fc3f7', '#f06292', '#69f0ae', '#ffd54f',
    '#ce93d8', '#ff8a65', '#80cbc4', '#ef9a9a',
  ];
  /** @type {Record<string,string>} */
  const playerColorMap = {};
  let colorIdx = 0;

  /**
   * Returns a stable colour for a player UID, assigned on first encounter.
   * @param {string} uid
   * @returns {string}
   */
  function playerColor(uid) {
    if (!playerColorMap[uid]) {
      playerColorMap[uid] = PLAYER_COLORS[colorIdx++ % PLAYER_COLORS.length];
    }
    return playerColorMap[uid];
  }

  // ── ANALYTICS ─────────────────────────────────────────────────────────────
  /**
   * Computes summary statistics for a single match.
   * All 89k events are counted; only spatially valid events are used for zone
   * heatmap cells (to avoid NaN zone indices from null/corrupt coordinates).
   *
   * @param {string} matchId
   * @returns {{
   *   humans:      number,
   *   bots:        number,
   *   players:     number,
   *   kills:       number,
   *   botKills:    number,
   *   totalKills:  number,
   *   loots:       number,
   *   totalEvents: number,
   *   killsByPlayer: Record<string,number>,
   *   streakers:   [string, number][],
   *   zoneKills:   number[],
   *   zoneLoot:    number[],
   *   duration:    number,
   *   map:         string,
   *   date:        string,
   * }}
   */
  function computeMatchStats(matchId) {
    const m    = MATCHES[matchId];
    const evts = m.events;

    const humans = new Set(evts.filter(e => !e.is_bot).map(e => e.user_id));
    const bots   = new Set(evts.filter(e =>  e.is_bot).map(e => e.user_id));

    const kills    = evts.filter(e => e.event === 'Kill').length;
    const botKills = evts.filter(e => e.event === 'BotKill').length;
    const loots    = evts.filter(e => e.event === 'Loot').length;

    // Kill leaderboard
    /** @type {Record<string,number>} */
    const killsByPlayer = {};
    evts
      .filter(e => e.event === 'Kill' || e.event === 'BotKill')
      .forEach(e => { killsByPlayer[e.user_id] = (killsByPlayer[e.user_id] || 0) + 1; });
    const streakers = Object.entries(killsByPlayer)
      .filter(([, c]) => c >= 3)
      .sort((a, b) => b[1] - a[1]);

    // 3×3 zone heatmap (kill + loot density per grid cell)
    const b         = BOUNDS[m.map_id];
    const zoneKills = Array(9).fill(0);
    const zoneLoot  = Array(9).fill(0);
    if (b) {
      const zw = (b.maxx - b.minx) / 3;
      const zh = (b.maxy - b.miny) / 3;
      evts.filter(isValidCoord).forEach(e => {
        const col = Math.min(2, Math.max(0, Math.floor((e.x - b.minx) / zw)));
        const row = Math.min(2, Math.max(0, Math.floor((e.z - b.miny) / zh)));
        const zi  = row * 3 + col;
        if (['Kill', 'BotKill', 'Killed', 'KilledByStorm'].includes(e.event)) zoneKills[zi]++;
        if (e.event === 'Loot') zoneLoot[zi]++;
      });
    }

    // Match duration (seconds → minutes, rounded)
    const ts  = evts.map(e => e.ts).filter(Boolean);
    const tsMin = ts.reduce((a, b) => a < b ? a : b, Infinity);
    const tsMax = ts.reduce((a, b) => a > b ? a : b, -Infinity);
    const dur = ts.length > 1 ? Math.round((tsMax - tsMin) / 60) : 0;

    return {
      humans:       humans.size,
      bots:         bots.size,
      players:      humans.size + bots.size,
      kills,
      botKills,
      totalKills:   kills + botKills,
      loots,
      totalEvents:  evts.length,
      killsByPlayer,
      streakers,
      zoneKills,
      zoneLoot,
      duration:     dur,
      map:          m.map_id,
      date:         m.date,
    };
  }

  // ── COORDINATE TRANSFORMS ─────────────────────────────────────────────────
  /**
   * World space (X, Z) → canvas pixel (cx, cy).
   *
   * Coordinate notes:
   *   - `x`  maps to the horizontal canvas axis  (left = min X, right = max X)
   *   - `z`  maps to the vertical canvas axis     (top = max Z / north, bottom = min Z / south)
   *     The Y inversion (negation) keeps north at the top of the viewport.
   *   - `y` (elevation) is intentionally ignored here — pass e.z as the second argument.
   *
   * @param {number} x    World X coordinate
   * @param {number} z    World Z coordinate (NOT elevation Y)
   * @param {string} mapId
   * @param {number} W    Canvas width  in pixels
   * @param {number} H    Canvas height in pixels
   * @returns {{ cx: number, cy: number, sc: number }}
   */
  function w2c(x, z, mapId, W, H) {
    const b = BOUNDS[mapId];
    if (!b) return { cx: W / 2, cy: H / 2, sc: 1 };
    const pad = 48;
    const ww  = b.maxx - b.minx || 1;
    const wh  = b.maxy - b.miny || 1;
    const sc  = Math.min((W - pad * 2) / ww, (H - pad * 2) / wh) * S.zoom;
    const cx  = W / 2 + S.pan.x + (x - (b.minx + ww / 2)) * sc;
    const cy  = H / 2 + S.pan.y - (z - (b.miny + wh / 2)) * sc;  // Z-axis is inverted for canvas
    return { cx, cy, sc };
  }

  /**
   * Canvas pixel (cx, cy) → world space (x, z). Inverse of w2c.
   * Used for the live coordinate readout while hovering.
   *
   * @param {number} cx   Canvas X pixel
   * @param {number} cy   Canvas Y pixel
   * @param {string} mapId
   * @param {number} W    Canvas width
   * @param {number} H    Canvas height
   * @returns {{ x: number, y: number }}  NOTE: .y here means world Z, not elevation
   */
  function c2w(cx, cy, mapId, W, H) {
    const b = BOUNDS[mapId];
    if (!b) return { x: 0, y: 0 };
    const pad = 48;
    const ww  = b.maxx - b.minx || 1;
    const wh  = b.maxy - b.miny || 1;
    const sc  = Math.min((W - pad * 2) / ww, (H - pad * 2) / wh) * S.zoom;
    const x   =  (cx - W / 2 - S.pan.x) / sc + (b.minx + ww / 2);
    const y   = -(cy - H / 2 - S.pan.y) / sc + (b.miny + wh / 2);
    return { x, y };
  }

  // ── CANVAS HELPERS ────────────────────────────────────────────────────────
  /** Resize both canvas layers to fill the map wrapper div. */
  function resize() {
    const wrap = document.getElementById('map-wrap');
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    ['bg-cvs', 'main-cvs'].forEach(id => {
      const cv = document.getElementById(id);
      cv.width  = w;
      cv.height = h;
    });
  }

  /** Returns { w, h } of the background canvas (proxy for viewport size). */
  function sz() {
    const c = document.getElementById('bg-cvs');
    return { w: c.width, h: c.height };
  }

  // ── RENDERING — BACKGROUND (minimap + grid) ───────────────────────────────
  function drawBg() {
    const cv  = document.getElementById('bg-cvs');
    const ctx = cv.getContext('2d');
    const { w, h } = sz();
    ctx.fillStyle = '#07090e';
    ctx.fillRect(0, 0, w, h);
    if (!S.match) return;

    const m  = MATCHES[S.match];
    const mi = IMG[m.map_id];
    const b  = BOUNDS[m.map_id];

    if (mi && mi.complete && b) {
      // Map corners in canvas space
      const { cx: x1, cy: y2 } = w2c(b.minx, b.miny, m.map_id, w, h);
      const { cx: x2, cy: y1 } = w2c(b.maxx, b.maxy, m.map_id, w, h);
      const mx = Math.min(x1, x2), my = Math.min(y1, y2);
      const mw = Math.abs(x2 - x1), mh = Math.abs(y2 - y1);

      // Glow shadow behind map image
      ctx.save();
      ctx.shadowColor = 'rgba(79,195,247,.2)';
      ctx.shadowBlur  = 20;
      ctx.fillStyle   = '#000';
      ctx.fillRect(mx, my, mw, mh);
      ctx.restore();

      // Map image at reduced opacity so event markers stand out
      ctx.save();
      ctx.globalAlpha = 0.65;
      ctx.drawImage(mi, mx, my, mw, mh);
      ctx.restore();

      // Subtle border
      ctx.strokeStyle = 'rgba(79,195,247,.25)';
      ctx.lineWidth   = 1;
      ctx.strokeRect(mx, my, mw, mh);

      // Optional 3×3 zone grid (shown when Analytics panel is open)
      if (S.showStats) {
        ctx.strokeStyle = 'rgba(255,255,255,.06)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 5]);
        for (let i = 1; i < 3; i++) {
          ctx.beginPath(); ctx.moveTo(mx + mw * i / 3, my); ctx.lineTo(mx + mw * i / 3, my + mh); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(mx, my + mh * i / 3); ctx.lineTo(mx + mw, my + mh * i / 3); ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    } else {
      // Fallback: dark dot-grid when minimap hasn't loaded yet
      ctx.strokeStyle = 'rgba(30,42,58,.8)';
      ctx.lineWidth   = 1;
      const gs = 50 * S.zoom;
      const ox = (S.pan.x % gs + gs) % gs;
      const oy = (S.pan.y % gs + gs) % gs;
      for (let x = ox - gs; x < w + gs; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = oy - gs; y < h + gs; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    }
  }

  // ── RENDERING — MAIN (events, paths, heatmap, replay heads) ──────────────
  function drawMain() {
    const cv  = document.getElementById('main-cvs');
    const ctx = cv.getContext('2d');
    const { w, h } = sz();
    ctx.clearRect(0, 0, w, h);
    if (!S.match) return;

    const m        = MATCHES[S.match];
    const isReplay = S.viz === 'replay';
    const allEvts  = m.events;
    const frame    = isReplay
      ? parseInt(document.getElementById('tl-slider').value, 10)
      : allEvts.length - 1;
    const evts = getEvents(frame);

    if (S.layers.heatmap || S.viz === 'heatmap') drawHeat(ctx, evts, m.map_id, w, h);
    if (S.layers.paths   || S.viz === 'paths')   drawPaths(ctx, evts, m.map_id, w, h, isReplay);
    if (S.viz !== 'heatmap')                      drawEvents(ctx, evts, m.map_id, w, h);
    if (isReplay)                                 drawReplayHeads(ctx, evts, m.map_id, w, h, frame);
    if (S.showStats)                              drawZoneOverlay(ctx, m.map_id, w, h);

    // Timeline info bar
    const e = evts[Math.min(frame, evts.length - 1)];
    if (e && isReplay) {
      const evtArr    = MATCHES[S.match].events;
      const matchStart = evtArr.reduce((a, ev) => ev.ts < a ? ev.ts : a, evtArr[0].ts);
      const elapsed   = e.ts ? e.ts - matchStart : 0;
      const mm        = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const ss        = String(elapsed % 60).padStart(2, '0');
      const ts        = e.ts ? `T+${mm}:${ss}` : '--:--';
      const label     = {
        Position:      'Move',
        BotPosition:   'Bot Move',
        Kill:          '⚔ Kill',
        Killed:        '💀 Killed',
        BotKill:       '⚔ Bot Kill',
        BotKilled:     '💀 Bot Killed',
        KilledByStorm: '🌪 Storm',
        Loot:          '💎 Loot',
      }[e.event] ?? e.event;
      document.getElementById('tl-info').textContent =
        `${label}  |  ${e.is_bot ? '🤖 Bot' : '👤 Human'}  |  X: ${e.x.toFixed(1)}  Z: ${e.z.toFixed(1)}  Elev: ${e.y.toFixed(1)}  |  ${ts}  |  Event ${frame + 1}/${allEvts.length}`;
    } else if (!isReplay) {
      document.getElementById('tl-info').textContent =
        `Showing all ${evts.length} events  —  scroll to zoom, drag to pan, double-click to reset`;
    }
  }

  // ── RENDERING — INDIVIDUAL EVENT MARKERS ─────────────────────────────────
  /**
   * Draws all visible events onto the main canvas.
   * Symbol vocabulary:
   *   ● dot          Position / BotPosition  (human = larger, more opaque)
   *   ✕ cross        Kill / BotKill          (human kill = larger, full glow)
   *   ⊙ circle+cross Killed / BotKilled / KilledByStorm
   *   ◆ diamond      Loot pickup
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object[]} evts
   * @param {string}   mapId
   * @param {number}   w   Canvas width
   * @param {number}   h   Canvas height
   */
  function drawEvents(ctx, evts, mapId, w, h) {
    evts.forEach(e => {
      const isKill  = e.event === 'Kill'    || e.event === 'BotKill';
      const isDeath = e.event === 'Killed'  || e.event === 'BotKilled' || e.event === 'KilledByStorm';
      const isLoot  = e.event === 'Loot';
      const isPos   = e.event === 'Position' || e.event === 'BotPosition';

      if ((isKill || isDeath) && !S.layers.kills)    return;
      if (isLoot              && !S.layers.loot)     return;
      if (isPos               && !S.layers.position) return;

      const { cx, cy } = w2c(e.x, e.z, mapId, w, h);
      const col = eColor(e.event);

      ctx.save();
      ctx.shadowColor = col;

      if (isKill) {
        // ✕  cross — kill event
        const isBotKill = e.event === 'BotKill';
        const s = isBotKill ? 4 : 6;
        ctx.strokeStyle  = col;
        ctx.lineWidth    = isBotKill ? 1.5 : 2;
        ctx.globalAlpha  = isBotKill ? 0.6 : 0.9;
        ctx.shadowBlur   = isBotKill ? 4 : 10;
        ctx.beginPath();
        ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
        ctx.moveTo(cx + s, cy - s); ctx.lineTo(cx - s, cy + s);
        ctx.stroke();

      } else if (isDeath) {
        // ⊙  circled cross — death event
        const s = 4;
        ctx.strokeStyle = col;
        ctx.lineWidth   = 1.5;
        ctx.globalAlpha = 0.75;
        ctx.shadowBlur  = 8;
        ctx.beginPath(); ctx.arc(cx, cy, s + 2, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.7, cy - s * 0.7); ctx.lineTo(cx + s * 0.7, cy + s * 0.7);
        ctx.moveTo(cx + s * 0.7, cy - s * 0.7); ctx.lineTo(cx - s * 0.7, cy + s * 0.7);
        ctx.stroke();

      } else if (isLoot) {
        // ◆  diamond — loot pickup
        const s = 5;
        ctx.fillStyle   = col;
        ctx.globalAlpha = 0.85;
        ctx.shadowBlur  = 6;
        ctx.beginPath();
        ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy);
        ctx.lineTo(cx, cy + s); ctx.lineTo(cx - s, cy);
        ctx.closePath(); ctx.fill();

      } else {
        // ●  dot — position update
        const isBot = e.event === 'BotPosition';
        ctx.fillStyle   = col;
        ctx.globalAlpha = isBot ? 0.3 : 0.65;
        ctx.shadowBlur  = isBot ? 1 : 4;
        ctx.beginPath(); ctx.arc(cx, cy, isBot ? 2 : 3.5, 0, Math.PI * 2); ctx.fill();
      }

      ctx.restore();
    });
  }

  // ── RENDERING — MOVEMENT PATHS ────────────────────────────────────────────
  /**
   * Draws per-player polylines connecting sequential Position events.
   * Human paths: solid with directional arrows every 6 segments.
   * Bot paths:   dashed, lower opacity.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object[]} evts
   * @param {string}   mapId
   * @param {number}   w
   * @param {number}   h
   * @param {boolean}  isReplay  When true, alpha fades in over time (older = more transparent)
   */
  function drawPaths(ctx, evts, mapId, w, h, isReplay) {
    const posEvts = evts.filter(e => e.event === 'Position' || e.event === 'BotPosition');

    /** @type {Record<string, object[]>} */
    const byUser = {};
    posEvts.forEach(e => {
      if (!byUser[e.user_id]) byUser[e.user_id] = [];
      byUser[e.user_id].push(e);
    });

    Object.entries(byUser).forEach(([, es]) => {
      if (es.length < 2) return;
      const isBot  = es[0]?.is_bot;
      const baseR  = isBot ? '186,104,200' : '79,195,247';

      ctx.lineWidth   = isBot ? 1 : 1.5;
      ctx.setLineDash(isBot ? [3, 5] : []);
      ctx.shadowColor = isBot ? '#ba68c8' : '#4fc3f7';
      ctx.shadowBlur  = isBot ? 1 : 3;

      for (let i = 1; i < es.length; i++) {
        const alpha = isReplay
          ? 0.1 + (i / es.length) * 0.6
          : isBot ? 0.25 : 0.45;

        ctx.strokeStyle = `rgba(${baseR},${alpha})`;
        const { cx: ax, cy: ay } = w2c(es[i - 1].x, es[i - 1].z, mapId, w, h);
        const { cx: bx, cy: by } = w2c(es[i].x,     es[i].z,     mapId, w, h);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

        // Direction arrow every 6 segments (human paths only)
        if (!isBot && i % 6 === 0) {
          const dx = bx - ax, dy = by - ay;
          const len = Math.hypot(dx, dy);
          if (len > 12) {
            const nx = dx / len, ny = dy / len;
            const mx = (ax + bx) / 2, my = (ay + by) / 2;
            const as = 5;
            ctx.fillStyle = `rgba(${baseR},${Math.min(1, alpha + 0.15)})`;
            ctx.beginPath();
            ctx.moveTo(mx + nx * as, my + ny * as);
            ctx.lineTo(mx - ny * as * 0.5 - nx * as * 0.6, my + nx * as * 0.5 - ny * as * 0.6);
            ctx.lineTo(mx + ny * as * 0.5 - nx * as * 0.6, my - nx * as * 0.5 - ny * as * 0.6);
            ctx.closePath(); ctx.fill();
          }
        }
      }
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
    });
  }

  // ── RENDERING — HEATMAP ───────────────────────────────────────────────────
  /**
   * Radial-gradient heatmap overlay.
   * Radius and intensity are controlled by the heat-int slider.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object[]} evts
   * @param {string}   mapId
   * @param {number}   w
   * @param {number}   h
   */
  function drawHeat(ctx, evts, mapId, w, h) {
    const intensity = parseInt(document.getElementById('heat-int').value, 10) / 5;
    const type      = S.heatType;
    const hevts     = evts.filter(e => {
      if (type === 'kills') return e.event === 'Kill' || e.event === 'BotKill';
      if (type === 'loot')  return e.event === 'Loot';
      return true; // traffic = all events
    });
    const palettes = { kills: '240,98,146', loot: '105,240,174', traffic: '79,195,247' };
    const col = palettes[type] ?? palettes.traffic;

    hevts.forEach(e => {
      const { cx, cy } = w2c(e.x, e.z, mapId, w, h);
      const r = Math.max(18, 28 * S.zoom) * intensity;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${col},${0.1 * intensity})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    });
  }

  // ── RENDERING — REPLAY PLAYER HEADS ──────────────────────────────────────
  /**
   * Draws the "current position" circle for each player visible at the
   * given replay frame. Kill-streak leaders get a gold outer ring.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {object[]} evts
   * @param {string}   mapId
   * @param {number}   w
   * @param {number}   h
   * @param {number}   frame  Current replay frame index
   */
  function drawReplayHeads(ctx, evts, mapId, w, h, frame) {
    if (!evts.length) return;

    // Build last-known position per player up to this frame
    /** @type {Record<string, {x,y,z,isBot,uid}>} */
    const lastPos = {};
    evts.forEach(e => {
      if (e.event === 'Position' || e.event === 'BotPosition') {
        lastPos[e.user_id] = { x: e.x, y: e.y, z: e.z, isBot: e.is_bot, uid: e.user_id };
      }
    });

    const stats      = computeMatchStats(S.match);
    const streakSet  = new Set(stats.streakers.map(([uid]) => uid));

    Object.values(lastPos).forEach(p => {
      const { cx, cy } = w2c(p.x, p.z, mapId, w, h);
      const col = p.isBot ? '#ba68c8' : playerColor(p.uid);

      ctx.save();

      // Gold ring for kill-streak leaders
      if (!p.isBot && streakSet.has(p.uid)) {
        ctx.strokeStyle = '#ffd54f';
        ctx.lineWidth   = 1.5;
        ctx.globalAlpha = 0.6;
        ctx.shadowColor = '#ffd54f';
        ctx.shadowBlur  = 14;
        ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2); ctx.stroke();
      }

      // Player head circle
      ctx.shadowColor  = col;
      ctx.shadowBlur   = 10;
      ctx.strokeStyle  = col;
      ctx.fillStyle    = col + '33';
      ctx.lineWidth    = 2;
      ctx.globalAlpha  = 0.95;
      ctx.beginPath(); ctx.arc(cx, cy, p.isBot ? 5 : 8, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();

      ctx.restore();
    });

    // Pulse ring on the current event
    const cur = evts[Math.min(frame, evts.length - 1)];
    if (cur) {
      const { cx, cy } = w2c(cur.x, cur.z, mapId, w, h);
      const col = eColor(cur.event);
      ctx.save();
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.shadowColor = col; ctx.shadowBlur = 16;
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  // ── RENDERING — ZONE KILL OVERLAY ─────────────────────────────────────────
  /**
   * Draws the 3×3 kill-density grid overlay on top of the map.
   * Only visible when the Analytics panel is open (S.showStats === true).
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} mapId
   * @param {number} w
   * @param {number} h
   */
  function drawZoneOverlay(ctx, mapId, w, h) {
    if (!S.match) return;
    const stats = computeMatchStats(S.match);
    const b     = BOUNDS[mapId];
    if (!b) return;

    const maxK = stats.zoneKills.reduce((a, b) => a > b ? a : b, 1);

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const zi = row * 3 + col;
        const wx = b.minx + (b.maxx - b.minx) * (col + 0.5) / 3;
        const wy = b.miny + (b.maxy - b.miny) * (row + 0.5) / 3;
        const { cx, cy } = w2c(wx, wy, mapId, w, h);
        const k = stats.zoneKills[zi];
        if (k > 0) {
          ctx.fillStyle = `rgba(240,98,146,${0.1 + (k / maxK) * 0.3})`;
          ctx.fillRect(cx - 26, cy - 16, 52, 32);
          ctx.fillStyle    = 'rgba(240,98,146,.85)';
          ctx.font         = 'bold 11px JetBrains Mono, monospace';
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`⚔ ${k}`, cx, cy);
        }
      }
    }
  }

  // ── UI — MATCH LIST ───────────────────────────────────────────────────────
  function buildMatchList() {
    const el = document.getElementById('match-list');
    el.innerHTML = '';
    let n = 0;

    // Richest matches first
    const sorted = Object.entries(MATCHES).sort((a, b) => b[1].events.length - a[1].events.length);

    sorted.forEach(([id, m]) => {
      if (S.mapFilter  !== 'all' && m.map_id !== S.mapFilter)  return;
      if (S.dateFilter !== 'all' && m.date   !== S.dateFilter) return;

      const evts   = m.events;
      const humans = new Set(evts.filter(e => !e.is_bot).map(e => e.user_id)).size;
      const kills  = evts.filter(e => e.event === 'Kill' || e.event === 'BotKill').length;

      const mapColor = { AmbroseValley: '#ffd54f', GrandRift: '#69f0ae', Lockdown: '#ce93d8' }[m.map_id] ?? '#4fc3f7';
      const mapShort = { AmbroseValley: 'Ambrose', GrandRift: 'Grand Rift', Lockdown: 'Lockdown' }[m.map_id] ?? m.map_id;

      const div = document.createElement('div');
      div.className = 'mi' + (S.match === id ? ' sel' : '');
      div.onclick   = () => selectMatch(id);
      div.innerHTML = `
        <div class="mi-id">${id.slice(0, 8)}…  <span style="color:var(--dim)">${evts.length} events</span></div>
        <div class="mi-info">
          <span style="color:${mapColor};font-weight:600;font-size:11px">${mapShort}</span>
          <span class="mi-date">${m.date.replace('February_', 'Feb ')}</span>
          <span class="mi-stats">👤${humans} ${kills ? `<span class="mi-badge">⚔${kills}</span>` : ''}</span>
        </div>`;
      el.appendChild(div);
      n++;
    });

    if (n === 0) {
      el.innerHTML = '<div class="match-placeholder">No matches match<br>the current filters</div>';
    }
    document.getElementById('match-cnt').textContent = `${n}`;
  }

  // ── UI — MATCH SELECTION ──────────────────────────────────────────────────
  /** @param {string} id  Match UUID */
  function selectMatch(id) {
    S.match = id;
    stop();
    S.zoom = 1;
    S.pan  = { x: 0, y: 0 };

    // Reset player colour assignments for the new match
    Object.keys(playerColorMap).forEach(k => delete playerColorMap[k]);
    colorIdx = 0;

    buildMatchList();

    const m       = MATCHES[id];
    const mapName = { AmbroseValley: 'Ambrose Valley', GrandRift: 'Grand Rift', Lockdown: 'Lockdown' }[m.map_id] ?? m.map_id;
    document.getElementById('map-title').textContent = mapName;
    document.getElementById('map-meta').textContent  = `— ${m.date.replace('February_', 'Feb ')}`;
    document.getElementById('empty-msg').style.display = 'none';
    document.getElementById('legend').style.display    = 'block';

    const sl  = document.getElementById('tl-slider');
    sl.max    = m.events.length - 1;
    sl.value  = 0;
    updateTime(0, m.events.length);
    updateCounts();
    updateStatsPanel(id);
    renderAll();
  }

  // ── UI — COUNTS / LAYER STATUS ────────────────────────────────────────────
  function updateCounts() {
    if (!S.match) return;
    const evts = getEvents();
    document.getElementById('cnt-pos').textContent  = evts.filter(e => e.event === 'Position'  || e.event === 'BotPosition').length;
    document.getElementById('cnt-kill').textContent = evts.filter(e => ['Kill','BotKill','Killed','BotKilled','KilledByStorm'].includes(e.event)).length;
    document.getElementById('cnt-loot').textContent = evts.filter(e => e.event === 'Loot').length;

    ['position', 'kills', 'loot', 'paths', 'heatmap', 'bots'].forEach(l => {
      const lt = document.getElementById('lt-' + l);
      if (lt) lt.classList.toggle('active', S.layers[l]);
    });
  }

  // ── UI — ANALYTICS STATS PANEL ───────────────────────────────────────────
  /** @param {string|null} matchId */
  function updateStatsPanel(matchId) {
    const panel = document.getElementById('stats-panel');
    if (!matchId) { panel.style.display = 'none'; return; }

    const st = computeMatchStats(matchId);
    panel.innerHTML = `
      <div class="sp-title">Match Analytics</div>
      <div class="sp-grid">
        <div class="sp-stat"><span class="sp-v">${st.players}</span><span class="sp-l">Players</span></div>
        <div class="sp-stat"><span class="sp-v">${st.totalKills}</span><span class="sp-l">Kills</span></div>
        <div class="sp-stat"><span class="sp-v">${st.loots}</span><span class="sp-l">Loot</span></div>
        <div class="sp-stat"><span class="sp-v">${st.humans}</span><span class="sp-l">Human</span></div>
        <div class="sp-stat"><span class="sp-v">${st.bots}</span><span class="sp-l">Bots</span></div>
        <div class="sp-stat"><span class="sp-v">${st.duration}m</span><span class="sp-l">Duration</span></div>
      </div>
      ${st.streakers.length ? `
        <div class="sp-sub">Kill Leaders</div>
        ${st.streakers.slice(0, 3).map(([uid, k]) => `
          <div class="sp-row">
            <span class="sp-uid">${uid.length > 10 ? uid.slice(0, 12) + '…' : uid}</span>
            <span class="sp-kills">${k}⚔</span>
          </div>`).join('')}` : ''}
      <div class="sp-sub">Kill Zones (3×3 Grid)</div>
      <div>${renderZoneGrid(st)}</div>
      <button class="sp-close" onclick="LilaVisualiser.toggleStats()">✕ Close Panel</button>`;

    if (S.showStats) panel.style.display = 'block';
  }

  /** @param {{ zoneKills: number[] }} st */
  function renderZoneGrid(st) {
    const maxK = st.zoneKills.reduce((a, b) => a > b ? a : b, 1);
    let html = '<table class="zt">';
    for (let r = 2; r >= 0; r--) {     // top row = high Z = north
      html += '<tr>';
      for (let c = 0; c < 3; c++) {
        const zi = r * 3 + c;
        const k  = st.zoneKills[zi];
        const a  = k > 0 ? Math.round(20 + (k / maxK) * 60) : 0;
        html += `<td style="background:rgba(240,98,146,${a / 100})">${k > 0 ? `<b>${k}</b>` : ''}</td>`;
      }
      html += '</tr>';
    }
    return html + '</table>';
  }

  // ── UI — FILTERS / LAYERS / VIZ MODE ─────────────────────────────────────
  function applyFilters() {
    S.mapFilter  = document.getElementById('f-map').value;
    S.dateFilter = document.getElementById('f-date').value;

    if (S.match) {
      const m = MATCHES[S.match];
      const mapOk  = S.mapFilter  === 'all' || m.map_id === S.mapFilter;
      const dateOk = S.dateFilter === 'all' || m.date   === S.dateFilter;
      if (!mapOk || !dateOk) {
        S.match = null; stop(); renderAll();
        document.getElementById('map-title').textContent = 'Select a Match';
        document.getElementById('map-meta').textContent  = '';
        document.getElementById('empty-msg').style.display = '';
        document.getElementById('legend').style.display    = 'none';
        document.getElementById('stats-panel').style.display = 'none';
        document.getElementById('tl-info').textContent = 'Select a match and press ▶ to replay events';
      }
    }
    buildMatchList();
  }

  /** @param {'all'|'human'|'bot'} f */
  function setPlayerFilter(f) {
    S.playerFilter = f;
    ['all', 'human', 'bot'].forEach(t => document.getElementById('fp-' + t).classList.toggle('on', t === f));
    updateCounts();
    renderAll();
  }

  /** @param {string} l  Layer key */
  function toggleLayer(l) {
    S.layers[l] = !S.layers[l];
    document.getElementById('sw-' + l).classList.toggle('on', S.layers[l]);
    const lt = document.getElementById('lt-' + l);
    if (lt) lt.classList.toggle('active', S.layers[l]);
    document.getElementById('heat-ctrl').style.display = S.layers.heatmap ? 'flex' : 'none';
    renderAll();
  }

  /** @param {'scatter'|'heatmap'|'paths'|'replay'} v */
  function setViz(v) {
    S.viz = v;
    ['scatter', 'heatmap', 'paths', 'replay'].forEach(x =>
      document.getElementById('vb-' + x).classList.toggle('on', x === v));

    if (v === 'paths') {
      S.layers.paths = true;
      document.getElementById('sw-paths').classList.add('on');
      document.getElementById('lt-paths').classList.add('active');
    }
    if (v === 'heatmap') {
      S.layers.heatmap = true;
      document.getElementById('sw-heatmap').classList.add('on');
      document.getElementById('lt-heatmap').classList.add('active');
      document.getElementById('heat-ctrl').style.display = 'flex';
    }
    if (v === 'replay' && S.match) {
      document.getElementById('tl-slider').value = 0;
      updateTime(0, MATCHES[S.match].events.length);
    }
    renderAll();
  }

  /** @param {'traffic'|'kills'|'loot'} t */
  function setHeatType(t) {
    S.heatType = t;
    ['traffic', 'kills', 'loot'].forEach(x =>
      document.getElementById('ht-' + x).classList.toggle('on', x === t));
    renderAll();
  }

  /** @param {HTMLElement} btn  The clicked speed button */
  /** @param {number}      s   Speed multiplier */
  function setSpd(btn, s) {
    S.play.speed = s;
    document.querySelectorAll('.spd-btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
  }

  function adjustZoom(factor) {
    S.zoom = Math.max(0.25, Math.min(12, S.zoom * factor));
    renderAll();
  }

  function resetView() { S.zoom = 1; S.pan = { x: 0, y: 0 }; renderAll(); }

  function toggleStats() {
    S.showStats = !S.showStats;
    document.getElementById('btn-stats').classList.toggle('active', S.showStats);
    document.getElementById('stats-panel').style.display = (S.showStats && S.match) ? 'block' : 'none';
    renderAll();
  }

  // ── PLAYBACK ──────────────────────────────────────────────────────────────
  /**
   * Returns the currently visible events, filtered by player type, bot toggle,
   * and optionally sliced to a replay frame.
   *
   * @param {number} [frame]  If provided, slice events up to this index.
   * @returns {object[]}
   */
  function getEvents(frame) {
    if (!S.match) return [];
    let e = MATCHES[S.match].events.filter(isValidCoord);
    if (S.playerFilter === 'human') e = e.filter(x => !x.is_bot);
    if (S.playerFilter === 'bot')   e = e.filter(x =>  x.is_bot);
    if (!S.layers.bots)             e = e.filter(x => !x.is_bot);
    if (frame !== undefined)        e = e.slice(0, frame + 1);
    return e;
  }

  function togglePlay() { S.play.on ? stop() : startPlay(); }

  function stop() {
    S.play.on = false;
    document.getElementById('play-btn').innerHTML = '▶';
    clearTimeout(S.play.timer);
  }

  function startPlay() {
    if (!S.match) return;
    if (S.viz !== 'replay') setViz('replay');
    S.play.on = true;
    document.getElementById('play-btn').innerHTML = '⏸';
    const total = MATCHES[S.match].events.length;

    function tick() {
      if (!S.play.on) return;
      const sl = document.getElementById('tl-slider');
      let f = parseInt(sl.value, 10) + Math.max(1, Math.round(S.play.speed));
      if (f >= total) { f = total - 1; stop(); }
      sl.value = f;
      updateTime(f, total);
      renderAll();
      if (S.play.on) S.play.timer = setTimeout(tick, Math.round(180 / S.play.speed));
    }
    tick();
  }

  function onSlide() {
    stop();
    if (S.match) {
      if (S.viz !== 'replay') setViz('replay');
      updateTime(parseInt(document.getElementById('tl-slider').value, 10), MATCHES[S.match].events.length);
    }
    renderAll();
  }

  /** @param {number} f      Current frame (0-based) */
  /** @param {number} total  Total frames */
  function updateTime(f, total) {
    document.getElementById('tl-time').textContent = `${f + 1} / ${total}`;
  }

  // ── INPUT — MOUSE / WHEEL ─────────────────────────────────────────────────
  function onMouseMove(evt) {
    const tt = document.getElementById('tooltip');
    const cb = document.getElementById('coords-bar');
    if (S.drag || !S.match) { tt.style.display = 'none'; return; }

    const rect = evt.currentTarget.getBoundingClientRect();
    const mx   = evt.clientX - rect.left;
    const my   = evt.clientY - rect.top;
    const m    = MATCHES[S.match];
    const { w, h } = sz();

    // Live coordinate readout
    const wc = c2w(mx, my, m.map_id, w, h);
    cb.style.display = 'block';
    cb.textContent   = `X: ${wc.x.toFixed(1)}  Z: ${wc.y.toFixed(1)}`;

    // Hit-test: find nearest event within 22 px
    const isReplay = S.viz === 'replay';
    const frame    = isReplay ? parseInt(document.getElementById('tl-slider').value, 10) : undefined;
    const evts     = getEvents(frame);
    let closest = null, minD = 22;
    evts.forEach(e => {
      const { cx, cy } = w2c(e.x, e.z, m.map_id, w, h);
      const d = Math.hypot(cx - mx, cy - my);
      if (d < minD) { minD = d; closest = e; }
    });

    if (closest) {
      const evtArr     = MATCHES[S.match].events;
      const matchStart = evtArr.reduce((a, ev) => ev.ts < a ? ev.ts : a, evtArr[0].ts);
      const elapsed    = closest.ts ? closest.ts - matchStart : 0;
      const mm         = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const ss         = String(elapsed % 60).padStart(2, '0');
      const ts         = closest.ts ? `T+${mm}:${ss}` : '–';

      const stats     = computeMatchStats(S.match);
      const killCount = stats.killsByPlayer[closest.user_id] ?? 0;
      const evtLabel  = {
        Position:      'Movement',
        BotPosition:   'Bot Movement',
        Kill:          '⚔ Human Kill',
        Killed:        '💀 Killed',
        BotKill:       '⚔ Bot Kill',
        BotKilled:     '💀 Bot Killed',
        KilledByStorm: '🌪 Storm Death',
        Loot:          '💎 Loot Pickup',
      }[closest.event] ?? closest.event;
      const streakBadge = killCount >= 3 ? ` 🔥 ${killCount} kills` : '';

      document.getElementById('tt-t').innerHTML =
        `<span style="color:${eColor(closest.event)}">${evtLabel}</span>${streakBadge}`;
      document.getElementById('tt-b').innerHTML = `
        <div class="tip-r"><span class="tip-k">Player</span><span class="tip-v">${closest.is_bot ? '🤖 Bot' : '👤 Human'}</span></div>
        <div class="tip-r"><span class="tip-k">ID</span><span class="tip-v">${String(closest.user_id).slice(0, 14)}…</span></div>
        <div class="tip-r"><span class="tip-k">X / Z</span><span class="tip-v">${closest.x.toFixed(1)}, ${closest.z.toFixed(1)}</span></div>
        <div class="tip-r"><span class="tip-k">Elevation (Y)</span><span class="tip-v">${closest.y.toFixed(1)}</span></div>
        <div class="tip-r"><span class="tip-k">Time</span><span class="tip-v">${ts}</span></div>`;

      tt.style.display = 'block';
      // Keep tooltip fully within viewport
      const tx = evt.clientX + 16;
      const ty = evt.clientY - 10;
      tt.style.left = (tx + 200 > window.innerWidth  ? evt.clientX - 210 : tx) + 'px';
      tt.style.top  = (ty + 150 > window.innerHeight ? evt.clientY - 150 : ty) + 'px';
    } else {
      tt.style.display = 'none';
    }
  }

  function onWheel(e) {
    e.preventDefault();
    S.zoom = Math.max(0.25, Math.min(12, S.zoom * (e.deltaY > 0 ? 0.87 : 1.15)));
    renderAll();
  }

  // ── RENDER LOOP ───────────────────────────────────────────────────────────
  function renderAll() { drawBg(); drawMain(); }

  // ── INITIALISATION ────────────────────────────────────────────────────────
  /**
   * Boot the visualiser.
   * Called automatically on window load if window.D is defined,
   * or manually: LilaVisualiser.init(myData)
   *
   * @param {{ matches, map_bounds, minimaps }} data  The D data object
   */
  function init(data) {
    if (!data || !data.matches) {
      console.error('[LilaVisualiser] init() called without valid data. Expected { matches, map_bounds, minimaps }.');
      return;
    }

    MATCHES = data.matches;
    BOUNDS  = data.map_bounds;
    MAPS    = data.minimaps;

    // Preload minimap images
    Object.entries(MAPS).forEach(([k, v]) => {
      const img = new Image();
      img.src   = v.data;
      // Trigger a redraw when each minimap finishes loading
      img.onload = () => { if (S.match && MATCHES[S.match]?.map_id === k) renderAll(); };
      IMG[k] = img;
    });

    buildMatchList();

    // Canvas interactions
    const wrap = document.getElementById('map-wrap');
    wrap.addEventListener('mousemove',  onMouseMove);
    wrap.addEventListener('wheel',      onWheel, { passive: false });
    wrap.addEventListener('mousedown',  e => { S.drag = { sx: e.clientX - S.pan.x, sy: e.clientY - S.pan.y }; });
    wrap.addEventListener('mousemove',  e => {
      if (S.drag) { S.pan.x = e.clientX - S.drag.sx; S.pan.y = e.clientY - S.drag.sy; renderAll(); }
    });
    wrap.addEventListener('dblclick',   resetView);
    window.addEventListener('mouseup',  () => S.drag = null);
    window.addEventListener('resize',   () => { resize(); renderAll(); });

    resize();
    renderAll();
  }

  // Auto-init if the legacy window.D global is present
  window.addEventListener('load', () => {
    if (typeof window.D !== 'undefined') init(window.D);
  });

  // ── PUBLIC API ────────────────────────────────────────────────────────────
  /**
   * Public surface — attach to window.LilaVisualiser so inline HTML
   * onclick handlers (e.g. onclick="LilaVisualiser.setViz('replay')")
   * can reach these functions.
   */
  return {
    init,
    // Filters & UI
    applyFilters,
    setPlayerFilter,
    toggleLayer,
    setViz,
    setHeatType,
    setSpd,
    adjustZoom,
    resetView,
    toggleStats,
    selectMatch,
    // Playback
    togglePlay,
    stop,
    onSlide,
    // Internals exposed for advanced usage / testing
    computeMatchStats,
    eColor,
    isValidCoord,
    getState: () => S,
  };

})();

// Make accessible globally for inline onclick= handlers
window.LilaVisualiser = LilaVisualiser;

// Also export for ES-module consumers
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LilaVisualiser };
}

// ── GLOBAL SHIMS ──────────────────────────────────────────────────────────
// These aliases let the existing inline onclick="fnName()" HTML handlers
// work without modification. They proxy to LilaVisualiser's public API.
(function installShims(api) {
  const shim = [
    'applyFilters', 'setPlayerFilter', 'toggleLayer', 'setViz',
    'setHeatType', 'setSpd', 'adjustZoom', 'resetView', 'toggleStats',
    'selectMatch', 'togglePlay', 'stop', 'onSlide',
  ];
  shim.forEach(fn => { if (typeof window[fn] === 'undefined') window[fn] = api[fn]; });
}(LilaVisualiser));
