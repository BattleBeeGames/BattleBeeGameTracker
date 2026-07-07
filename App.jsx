import { useState, useEffect, useCallback, useRef, useMemo } from "react";
const nukeGif = "/nuke.gif"; // served from public/ — bundlers copy it to dist, no import needed

// ── Persistence ──────────────────────────────────────────────────────────────
const STORAGE_KEYS = { games: "cmdr_games", players: "cmdr_players", decks: "cmdr_decks", session: "cmdr_session" };
const load = (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (d) => {
  // Parse YYYY-MM-DD as local time (not UTC) to avoid the previous-day shift in western timezones
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const fmtDur = (s) => { const m = Math.floor(s / 60); const sec = s % 60; return `${m}m ${sec}s`; };
const shareText = async (text, title = "Battle Bee") => {
  try { if (navigator.share) { await navigator.share({ title, text }); return; } } catch(e) {}
  try { await navigator.clipboard?.writeText(text); } catch(e) {}
};
const STAT_ICONS = {
  "Biggest Single HP Gain": "💚", "Biggest Single HP Loss": "💔",
  "Most Total HP Gained": "🌿", "Most Total HP Lost": "🩸",
  "Most Life Changes": "🔁", "Most Commander Damage Dealt": "⚔️",
  "Most Poison Counters": "☠️", "Longest Avg Turn": "⏱️", "Turns Played": "🔄",
};
const HR = "──────────────────────";
const gameShareText = (g, pName, opts = {}) => {
  const { pEmoji, pod } = opts;
  const winner = pName(g.winner);
  const winCmd = g.seats?.find(s => s.playerId === g.winner)?.commander;
  const lines = [
    `⚔️  BATTLE BEE  ·  ${fmt(g.date)}`,
    ...(g.duration ? [`⏱️  ${g.duration}`] : []),
    ...(pod ? [`⬡  ${pod.name}`] : []),
    "",
    g.result === "draw" ? `🤝 Draw!${g.drawPlayerIds?.length ? `  (${g.drawPlayerIds.map(pName).join(", ")})` : ""}` : g.result === "nongame" ? "🤷 Non Game" : `👑 ${winner} wins!${winCmd ? `  (${winCmd})` : ""}`,
    "",
    HR,
  ];
  (g.seats || []).forEach((s, i) => {
    const isWinner = s.playerId === g.winner;
    const life = g.finalLifes?.[i] != null ? `  ♥${g.finalLifes[i]}` : "";
    const cmd  = s.commander ? `  ·  ${s.commander}` : "";
    const em   = pEmoji ? `${pEmoji(s.playerId)} ` : "";
    lines.push(`${isWinner ? "👑" : " ·"} ${em}${pName(s.playerId)}${cmd}${life}`);
  });

  // Commander damage section (reconstructed from events)
  const cmdAcc = {};
  (g.events || []).filter(e => e.type === 'cmd').forEach(e => {
    const k = `${e.from}-${e.to}`;
    cmdAcc[k] = (cmdAcc[k] || 0) + e.delta;
  });
  const cmdPairs = Object.entries(cmdAcc)
    .map(([k, total]) => { const [f,t] = k.split('-').map(Number); return { from:f, to:t, total }; })
    .filter(p => p.total > 0)
    .sort((a,b) => b.total - a.total);
  if (cmdPairs.length > 0) {
    lines.push("", HR, "⚔️  COMMANDER DAMAGE");
    cmdPairs.forEach(({ from, to, total }) => {
      const fs = g.seats?.[from]; const ts = g.seats?.[to];
      const fe = pEmoji ? `${pEmoji(fs?.playerId)} ` : "";
      const te = pEmoji ? `${pEmoji(ts?.playerId)} ` : "";
      lines.push(`${fe}${pName(fs?.playerId)} → ${te}${pName(ts?.playerId)}: ${total}${total >= 21 ? " ☠" : ""}`);
    });
  }

  if (g.notes) lines.push("", `"${g.notes}"`);
  if (g.stats?.length) {
    lines.push("", HR, "📊  GAME HIGHLIGHTS");
    g.stats.forEach(s => {
      const icon = STAT_ICONS[s.label] || "·";
      lines.push(`${icon}  ${s.label}: ${s.value}${s.player ? `  ·  ${s.player}` : ""}`);
    });
  }
  lines.push("", HR);
  return lines.join("\n");
};

// ── Constants ────────────────────────────────────────────────────────────────
const COLORS = ["#c084fc", "#f472b6", "#60a5fa", "#34d399", "#fb923c", "#f87171"];
const DARK_BG = ["rgba(139,92,246,0.18)", "rgba(236,72,153,0.18)", "rgba(59,130,246,0.18)", "rgba(16,185,129,0.18)", "rgba(251,146,60,0.18)", "rgba(248,113,113,0.18)"];
const DEFAULT_EMOJI = ["🐉", "💀", "⚡", "🌿", "🔥", "🌊"];

const LAYOUT_CONFIG = {
  2: { cols: 1, rows: 2, rotations: [180, 0],           leftDeltas: [1, -1],       turnOrder: [0, 1] },
  4: { cols: 2, rows: 2, rotations: [90, -90, 90, -90], leftDeltas: [-1, -1, 1, 1], turnOrder: [0, 1, 3, 2] },
  6: { cols: 2, rows: 3, rotations: [180, 180, 90, -90, 0, 0], leftDeltas: [1, 1, -1, 1, -1, -1], turnOrder: [0, 1, 3, 5, 4, 2] },
};

const THEMES = [
  { id: "default",  label: "✦ Prismatic",
    solid: "rgba(2,0,8,0.99)",
    gradient: "radial-gradient(ellipse at 0% 50%, rgba(239,68,68,0.28) 0%, transparent 42%), radial-gradient(ellipse at 25% 0%, rgba(251,146,60,0.22) 0%, transparent 36%), radial-gradient(ellipse at 75% 0%, rgba(234,179,8,0.22) 0%, transparent 36%), radial-gradient(ellipse at 100% 50%, rgba(34,197,94,0.26) 0%, transparent 42%), radial-gradient(ellipse at 75% 100%, rgba(59,130,246,0.28) 0%, transparent 42%), radial-gradient(ellipse at 25% 100%, rgba(168,85,247,0.28) 0%, transparent 42%), radial-gradient(ellipse at 50% 50%, rgba(2,0,8,0.55) 0%, rgba(2,0,8,0.99) 68%)",
    particles: { count:18, type:"sparkle", colors:["#ef4444","#f97316","#eab308","#22c55e","#06b6d4","#3b82f6","#8b5cf6","#ec4899"], sizes:[2,5], speed:[4,9] }},
  { id: "forest",   label: "🌲 Verdant",      solid: "rgba(3,12,6,0.99)",   gradient: "radial-gradient(ellipse at 40% 70%, rgba(21,128,61,0.55) 0%, rgba(3,12,6,0.99) 60%), radial-gradient(ellipse at 85% 10%, rgba(74,222,128,0.18) 0%, transparent 50%)",
    particles: { count:12, type:"leaf",    colors:["#4ade80","#22c55e","#86efac","#dcfce7"], sizes:[4,8],   speed:[7,13]  }},
  { id: "swamp",    label: "💀 Dead Fen",     solid: "rgba(6,3,14,0.99)",   gradient: "radial-gradient(ellipse at 50% 85%, rgba(88,28,135,0.6) 0%, rgba(6,2,14,0.99) 55%), radial-gradient(ellipse at 20% 10%, rgba(34,197,94,0.14) 0%, transparent 40%)",
    particles: { count:9,  type:"bubble",  colors:["#a78bfa","#c4b5fd","#4ade80","#7c3aed"], sizes:[4,9],   speed:[5,10]  }},
  { id: "mountain", label: "🌋 Ember Peak",
    solid: "rgba(8,5,3,0.99)",
    gradient: "radial-gradient(ellipse at 50% 100%, rgba(220,60,10,0.5) 0%, rgba(100,30,5,0.28) 30%, rgba(8,5,3,0.99) 60%), radial-gradient(ellipse at 50% 10%, rgba(80,70,60,0.18) 0%, transparent 48%)",
    particles: { count:16, type:"snow",  colors:["#9ca3af","#d1d5db","#e5e7eb","#6b7280","#c8b8a0"], sizes:[3,7], speed:[5,10] }},
  { id: "island",   label: "🌊 Storm Coast",  solid: "rgba(2,8,20,0.99)",   gradient: "radial-gradient(ellipse at 50% 20%, rgba(14,116,144,0.5) 0%, rgba(2,6,18,0.99) 58%), radial-gradient(ellipse at 12% 80%, rgba(96,165,250,0.22) 0%, transparent 42%)",
    particles: { count:22, type:"rain",    colors:["#7dd3fc","#38bdf8","#bae6fd","#93c5fd"], sizes:[14,22],  speed:[0.7,1.4]}},
  { id: "plains",   label: "☀️ Sacred Plains", solid:"rgba(14,10,1,0.99)",   gradient: "radial-gradient(ellipse at 50% 0%, rgba(251,191,36,0.45) 0%, rgba(12,8,0,0.99) 58%), radial-gradient(ellipse at 88% 90%, rgba(234,179,8,0.14) 0%, transparent 40%)",
    particles: { count:10, type:"mote",    colors:["#fbbf24","#fde68a","#fff7ed","#fffbeb"], sizes:[2,4],   speed:[6,10]  }},
  { id: "void",     label: "🌑 Deep Void",    solid: "rgba(0,0,0,1)",        gradient: "radial-gradient(ellipse at 50% 50%, rgba(148,163,184,0.07) 0%, rgba(0,0,0,1) 65%)",
    particles: { count:8,  type:"star",    colors:["#e2e8f0","#94a3b8","#cbd5e1","#fff"],    sizes:[1,3],   speed:[3,7]   }},
  { id: "lava",     label: "🔥 Hellmouth",
    solid: "rgba(18,0,0,0.99)",
    gradient: "radial-gradient(ellipse at 50% 100%, rgba(255,120,0,0.9) 0%, rgba(220,20,0,0.65) 22%, rgba(100,0,0,0.35) 48%, rgba(18,0,0,0.99) 65%)",
    particles: { count:28, type:"ember",  colors:["#ff4500","#ff6a00","#ffd700","#ff8c00","#fff4e0","#ef4444"], sizes:[2,6], speed:[1.5,3.5] }},
  { id: "arcane",   label: "✨ Spellweave",   solid: "rgba(6,2,16,0.99)",   gradient: "radial-gradient(ellipse at 18% 50%, rgba(192,132,252,0.45) 0%, transparent 48%), radial-gradient(ellipse at 82% 50%, rgba(244,114,182,0.38) 0%, transparent 48%), radial-gradient(ellipse at 50% 100%, rgba(99,102,241,0.28) 0%, rgba(6,2,16,0.99) 58%)",
    particles: { count:12, type:"sparkle", colors:["#c084fc","#f472b6","#818cf8","#60a5fa","#4ade80"], sizes:[3,6], speed:[4,9]}},
  { id: "ice",      label: "❄️ Frost Realm",  solid: "rgba(2,6,18,0.99)",   gradient: "radial-gradient(ellipse at 50% 0%, rgba(186,230,253,0.38) 0%, rgba(2,6,18,0.99) 58%), radial-gradient(ellipse at 80% 75%, rgba(56,189,248,0.2) 0%, transparent 42%)",
    particles: { count:14, type:"snow",    colors:["#bae6fd","#e0f2fe","#fff","#7dd3fc"],    sizes:[3,7],   speed:[5,10]  }},
];

const getThemeBg = (themeId) => {
  const t = THEMES.find(t => t.id === themeId) || THEMES[0];
  return t.gradient || t.solid || null;
};

// ── Sound engine ─────────────────────────────────────────────────────────────
const AudioCtx = typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null;
let _ctx = null;
const getCtx = () => { if (!_ctx && AudioCtx) { try { _ctx = new AudioCtx(); } catch(e){} } return _ctx; };

let _mcDeathBuf = null;
const MC_SOUND_URLS = [
  "https://www.myinstants.com/media/sounds/minecraft-oof.mp3",
  "https://freesound.org/data/previews/331/331912_3248244-lq.mp3",
];
(async () => {
  for (const url of MC_SOUND_URLS) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const arr = await res.arrayBuffer();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      _mcDeathBuf = await ctx.decodeAudioData(arr);
      _ctx = ctx;
      break;
    } catch(e) {}
  }
})();

function playTone(freq, type, duration, gainVal, fadeOut = true) {
  const ctx = getCtx(); if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(gainVal, ctx.currentTime);
    if (fadeOut) gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + duration);
  } catch(e) {}
}

const Sounds = {
  lifeUp: () => { playTone(520, "sine", 0.08, 0.15); },
  lifeDown: () => { playTone(280, "sawtooth", 0.12, 0.12); },
  bigLoss: () => {
    playTone(180, "sawtooth", 0.2, 0.2);
    setTimeout(() => playTone(140, "sawtooth", 0.25, 0.18), 80);
  },
  death: () => {
    try {
      if (_mcDeathBuf && _ctx) {
        const src = _ctx.createBufferSource();
        src.buffer = _mcDeathBuf;
        src.connect(_ctx.destination);
        src.start();
      } else {
        const ctx = getCtx(); if (!ctx) return;
        const sr = ctx.sampleRate;
        const dur = 0.18;
        const buf = ctx.createBuffer(1, sr * dur, sr);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          const env = Math.exp(-t * 18);
          d[i] = env * (0.5 * Math.sin(2 * Math.PI * (320 - 180 * t / dur) * t) + 0.3 * Math.sin(2 * Math.PI * (200 - 100 * t / dur) * t) + 0.2 * (Math.random() * 2 - 1));
        }
        const src = ctx.createBufferSource();
        src.buffer = buf; src.connect(ctx.destination); src.start();
      }
    } catch(e) {}
  },
  quickAdj: (delta) => {
    if (delta > 0) playTone(440 + delta * 20, "sine", 0.06, 0.1);
    else playTone(300 + delta * 10, "triangle", 0.1, 0.12);
  },
};

// ── Haptic feedback (Phase 1) ─────────────────────────────────────────────────
const haptic = (style = 'light') => {
  try {
    if (window.Capacitor?.Plugins?.Haptics) {
      const s = style === 'heavy' ? 'HEAVY' : style === 'medium' ? 'MEDIUM' : 'LIGHT';
      window.Capacitor.Plugins.Haptics.impact({ style: s });
    } else if (navigator.vibrate) {
      navigator.vibrate(style === 'heavy' ? 60 : style === 'medium' ? 25 : 10);
    }
  } catch(e) {}
};

// ── App-level color themes ────────────────────────────────────────────────────
const APP_THEMES = [
  { name: "🔮 Dusk Arcana",  bg: "#070810", modalBg: "#0d0d1f", accent: "#c084fc", accentDim: "rgba(192,132,252,0.5)", accentBg: "rgba(192,132,252,0.15)", gradStart: "#6d28d9", gradEnd: "#db2777", glow: "rgba(139,92,246,0.5)" },
  { name: "🌊 Abyssal Tide", bg: "#020d12", modalBg: "#050f18", accent: "#22d3ee", accentDim: "rgba(34,211,238,0.5)",  accentBg: "rgba(34,211,238,0.12)",  gradStart: "#0e7490", gradEnd: "#1e40af", glow: "rgba(6,182,212,0.5)" },
  { name: "🐉 Dragon's Maw", bg: "#100200", modalBg: "#1f0500", accent: "#f97316", accentDim: "rgba(249,115,22,0.5)",  accentBg: "rgba(249,115,22,0.15)",  gradStart: "#dc2626", gradEnd: "#9a3412", glow: "rgba(249,115,22,0.5)" },
  { name: "🌿 Ancient Grove",bg: "#020903", modalBg: "#040f07", accent: "#4ade80", accentDim: "rgba(74,222,128,0.5)",  accentBg: "rgba(74,222,128,0.15)",  gradStart: "#15803d", gradEnd: "#0f766e", glow: "rgba(34,197,94,0.5)" },
  { name: "👑 Gilded Throne",bg: "#0a0800", modalBg: "#150f00", accent: "#fbbf24", accentDim: "rgba(251,191,36,0.5)",  accentBg: "rgba(251,191,36,0.15)",  gradStart: "#d97706", gradEnd: "#92400e", glow: "rgba(245,158,11,0.5)" },
  { name: "☠️ Void Eternal",  bg: "#000000", modalBg: "#080808", accent: "#e2e8f0", accentDim: "rgba(226,232,240,0.4)", accentBg: "rgba(226,232,240,0.08)", gradStart: "#334155", gradEnd: "#1e293b", glow: "rgba(148,163,184,0.3)" },
];

// ── Shared styles ────────────────────────────────────────────────────────────
const INPUT = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "9px 13px", color: "#e2e8f0", fontFamily: "'Crimson Text', serif", fontSize: 15, outline: "none", boxSizing: "border-box", width: "100%" };
const LABEL = { fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "#94a3b8", marginBottom: 5, display: "block", fontFamily: "'Cinzel', serif" };
const CARD = { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: 20, marginBottom: 14 };
const btn = (v = "primary") => ({
  padding: "9px 18px", borderRadius: 6, cursor: "pointer", fontFamily: "'Cinzel', serif",
  fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase",
  background: v === "primary" ? "linear-gradient(135deg,var(--grad-start),var(--grad-end))" : v === "danger" ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.07)",
  color: v === "danger" ? "#f87171" : "#e2e8f0",
  border: v === "danger" ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(255,255,255,0.1)",
  transition: "all 0.15s",
});
const navBtn = (active) => ({
  padding: "8px 18px", borderRadius: 6,
  border: `1px solid ${active ? "var(--accent-dim)" : "rgba(255,255,255,0.08)"}`,
  background: active ? "var(--accent-bg)" : "transparent",
  color: active ? "var(--accent)" : "#94a3b8",
  cursor: "pointer", fontFamily: "'Cinzel', serif", fontSize: 12,
  letterSpacing: "0.1em", textTransform: "uppercase",
});

// ── Explosion overlay ────────────────────────────────────────────────────────
function ExplosionOverlay({ onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3800); return () => clearTimeout(t); }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, pointerEvents: "none", animation: "screenShake 0.5s ease-out" }}>
      <div style={{ position: "absolute", inset: 0, background: "#000", animation: "blackFlash 0.12s ease-out forwards" }} />
      {/* Nuke GIF, full screen */}
      <img src={nukeGif} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", animation: "nukeInOut 3.8s ease-out forwards" }} />
      <div style={{ position: "absolute", inset: 0, background: "#fff", animation: "whiteFlash 0.3s 0.06s ease-out forwards" }} />
      <style>{`
        @keyframes screenShake{0%{transform:translate(0,0)}8%{transform:translate(-8px,5px) rotate(-0.4deg)}16%{transform:translate(7px,-6px) rotate(0.3deg)}24%{transform:translate(-5px,4px) rotate(-0.2deg)}32%{transform:translate(4px,-3px) rotate(0.2deg)}40%{transform:translate(-3px,2px)}50%{transform:translate(2px,-1px)}65%,100%{transform:translate(0,0)}}
        @keyframes blackFlash{0%{opacity:0.7}100%{opacity:0}}
        @keyframes whiteFlash{0%{opacity:0.95}100%{opacity:0}}
        @keyframes nukeInOut{0%{opacity:0}5%{opacity:1}75%{opacity:1}100%{opacity:0}}
      `}</style>
    </div>
  );
}

// ── Quick adjust popup ────────────────────────────────────────────────────────
function QuickAdjPopup({ idx, rot, onAdj, onClose, onSwap }) {
  const color = COLORS[idx % COLORS.length];
  const options = [-10, -5, -1, 1, 5, 10];
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ transform: `rotate(${rot}deg)`, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", maxWidth: 220 }} onClick={e => e.stopPropagation()}>
        {options.map(d => (
          <button key={d} onClick={() => { onAdj(idx, d); onClose(); }}
            style={{ width: 52, height: 52, borderRadius: 10, fontSize: 15, fontWeight: 700, fontFamily: "'Cinzel',serif", cursor: "pointer", border: `1px solid ${color}55`, background: d < 0 ? "rgba(239,68,68,0.2)" : "rgba(52,211,153,0.2)", color: d < 0 ? "#f87171" : "#34d399", boxShadow: `0 0 12px ${color}33` }}>
            {d > 0 ? `+${d}` : d}
          </button>
        ))}
        <button onClick={() => { onSwap(); onClose(); }} style={{ width: "100%", padding: "8px", borderRadius: 8, background: `${color}15`, border: `1px solid ${color}44`, color, fontFamily: "'Cinzel',serif", fontSize: 11, cursor: "pointer", letterSpacing: "0.1em" }}>🔄 SWAP SEAT</button>
        <button onClick={onClose} style={{ width: "100%", padding: "8px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8", fontFamily: "'Cinzel',serif", fontSize: 11, cursor: "pointer", letterSpacing: "0.1em" }}>CANCEL</button>
      </div>
    </div>
  );
}

// ── Particle CSS (shared between GameScreen and pickers) ─────────────────────
const PARTICLE_CSS = `
  @keyframes ptRise{0%{transform:translateY(0) translateX(0);opacity:0}8%{opacity:1}90%{opacity:0.75}100%{transform:translateY(var(--dy,-400px)) translateX(var(--sx,0px));opacity:0}}
  @keyframes ptLeaf{0%{transform:translateY(0) translateX(0) rotate(0deg);opacity:0}10%{opacity:0.9}50%{transform:translateY(calc(var(--dy,-380px)*0.45)) translateX(var(--sx,14px)) rotate(210deg);opacity:0.7}90%{opacity:0.3}100%{transform:translateY(var(--dy,-380px)) translateX(calc(var(--sx,14px)*0.4)) rotate(420deg);opacity:0}}
  @keyframes ptBubble{0%{transform:translateY(0) translateX(0) scale(0.65);opacity:0}6%{opacity:0.65}25%{transform:translateY(calc(var(--dy,-390px)*0.22)) translateX(9px) scale(1);opacity:0.6}50%{transform:translateY(calc(var(--dy,-390px)*0.49)) translateX(-7px) scale(0.9);opacity:0.45}75%{transform:translateY(calc(var(--dy,-390px)*0.73)) translateX(8px) scale(0.8);opacity:0.3}100%{transform:translateY(var(--dy,-390px)) translateX(-4px) scale(0.6);opacity:0}}
  @keyframes ptRain{0%{transform:translateY(0) translateX(0) rotate(-16deg);opacity:0}6%{opacity:0.75}94%{opacity:0.35}100%{transform:translateY(var(--dy,400px)) translateX(var(--sx,-25px)) rotate(-16deg);opacity:0}}
  @keyframes ptFall{0%{transform:translateY(0) translateX(0);opacity:0}8%{opacity:0.85}85%{opacity:0.6}100%{transform:translateY(var(--dy,400px)) translateX(var(--sx,0px));opacity:0}}
  @keyframes ptTwinkle{0%,100%{opacity:0;transform:scale(0.25) rotate(0deg)}25%,75%{opacity:1;transform:scale(1.15) rotate(72deg)}50%{opacity:0.65;transform:scale(0.85) rotate(144deg)}}
  @keyframes ptRiseH{0%{transform:translateX(0) translateY(0);opacity:0}8%{opacity:1}90%{opacity:0.75}100%{transform:translateX(var(--dx,400px)) translateY(var(--sy,0px));opacity:0}}
  @keyframes ptLeafH{0%{transform:translateX(0) translateY(0) rotate(0deg);opacity:0}10%{opacity:0.9}50%{transform:translateX(calc(var(--dx,400px)*0.45)) translateY(var(--sy,14px)) rotate(210deg);opacity:0.7}90%{opacity:0.3}100%{transform:translateX(var(--dx,400px)) translateY(calc(var(--sy,14px)*0.4)) rotate(420deg);opacity:0}}
  @keyframes ptRainH{0%{transform:translateX(0) translateY(0) rotate(-16deg);opacity:0}6%{opacity:0.75}94%{opacity:0.35}100%{transform:translateX(var(--dx,-400px)) translateY(var(--sy,-25px)) rotate(-16deg);opacity:0}}
`;
function ParticleStyles() { return <style>{PARTICLE_CSS}</style>; }

// ── Theme particles ───────────────────────────────────────────────────────────
function ThemeParticles({ themeId, rot = 0 }) {
  const cfg = THEMES.find(t => t.id === themeId)?.particles;
  // Horizontal motion: rot=90/-90 tiles have particles moving left/right instead of up/down.
  // This avoids rotating the container (which only covers ~46% of a portrait tile when rotated 90°).
  const isH = rot === 90 || rot === -90;
  const particles = useMemo(() => {
    if (!cfg) return [];
    const { count, type, colors, sizes, speed } = cfg;
    const isScatter = type === "star" || type === "sparkle";
    return Array.from({ length: count }, (_, i) => ({
      spread:  2 + Math.random() * 93,  // position along the axis perpendicular to motion
      vPos:    isScatter ? 5 + Math.random() * 85 : null,
      size:    sizes[0] + Math.random() * (sizes[1] - sizes[0]),
      dur:     speed[0] + Math.random() * (speed[1] - speed[0]),
      delay:   -(Math.random() * speed[1]),
      color:   colors[i % colors.length],
      sway:    type === "rain" ? -(18 + Math.random() * 18) : (Math.random() - 0.5) * 30,
      opacity: type === "rain" ? 0.35 + Math.random() * 0.35 : type === "bubble" ? 0.4 + Math.random() * 0.3 : 0.55 + Math.random() * 0.4,
    }));
  }, [themeId, isH]); // eslint-disable-line
  if (!cfg) return null;
  const { type } = cfg;
  const isFall    = type === "rain" || type === "snow";
  const isScatter = type === "star" || type === "sparkle";

  // Rising particles emerge from the player's "floor" edge and move toward their "ceiling."
  // Falling particles (rain/snow) come from the opposite edge.
  // For each rot, "floor" maps to a different DOM edge:
  //   rot=0:   floor=DOM-bottom, ceiling=DOM-top  (normal reading, player at bottom)
  //   rot=90:  floor=DOM-left,   ceiling=DOM-right (player reads from left)
  //   rot=-90: floor=DOM-right,  ceiling=DOM-left  (player reads from right)
  //   rot=180: floor=DOM-top,    ceiling=DOM-bottom (player reads upside-down)
  const riseEdge = rot === 0 ? "bottom" : rot === 90 ? "left"  : rot === -90 ? "right"  : "top";
  const fallEdge = rot === 0 ? "top"    : rot === 90 ? "right" : rot === -90 ? "left"   : "bottom";
  const startEdge = isFall ? fallEdge : riseEdge;

  // Animation keyframe and CSS motion variables
  const animMapV = { ember:"ptRise", leaf:"ptLeaf", bubble:"ptBubble", mote:"ptRise", rain:"ptRain", snow:"ptFall", star:"ptTwinkle", sparkle:"ptTwinkle" };
  const animMapH = { ember:"ptRiseH", leaf:"ptLeafH", bubble:"ptRiseH", mote:"ptRiseH", rain:"ptRainH", snow:"ptRiseH", star:"ptTwinkle", sparkle:"ptTwinkle" };
  const anim = isH ? (animMapH[type] || "ptRiseH") : (animMapV[type] || "ptRise");

  const getMotionVars = (p) => {
    if (isH) {
      // Horizontal: rising goes right (rot=90) or left (rot=-90); falling is opposite
      const dx = isFall ? (rot === 90 ? -400 : 400) : (rot === 90 ? 400 : -400);
      return { "--dx": `${dx}px`, "--sy": `${p.sway.toFixed(1)}px` };
    } else {
      // Vertical: rising goes up (rot=0) or down (rot=180); falling is opposite
      const dy = isFall ? (rot === 0 ? 400 : -400) : (rot === 0 ? -400 : 400);
      return { "--dy": `${dy}px`, "--sx": `${p.sway.toFixed(1)}px` };
    }
  };

  return (
    <div style={{ position:"absolute", inset:0, zIndex:0, overflow:"hidden", pointerEvents:"none" }}>
      {particles.map((p, i) => {
        let posStyle;
        if (isScatter) {
          posStyle = { top:`${p.vPos}%`, left:`${p.spread}%`, bottom:"auto", right:"auto" };
        } else if (isH) {
          posStyle = startEdge === "left"
            ? { left:"-2px",  right:"auto", top:`${p.spread}%`, bottom:"auto" }
            : { right:"-2px", left:"auto",  top:`${p.spread}%`, bottom:"auto" };
        } else {
          posStyle = startEdge === "top"
            ? { top:"-4px",    bottom:"auto", left:`${p.spread}%`, right:"auto" }
            : { bottom:"-2px", top:"auto",    left:`${p.spread}%`, right:"auto" };
        }
        return (
          <div key={i} style={{
            position:"absolute", ...posStyle,
            width:  (type === "rain" && !isH) ? "1px" : `${p.size}px`,
            height: (type === "rain" && isH)  ? "1px" : `${p.size}px`,
            borderRadius: type === "leaf" ? "40% 60% 60% 40% / 40% 40% 60% 60%" : "50%",
            background: p.color, opacity: p.opacity,
            boxShadow: (type==="sparkle"||type==="star"||type==="mote") ? `0 0 ${p.size*2}px ${p.color}` : undefined,
            animation:`${anim} ${p.dur.toFixed(2)}s ${p.delay.toFixed(2)}s linear infinite`,
            ...getMotionVars(p),
          }}/>
        );
      })}
    </div>
  );
}

// ── Commander autocomplete (Scryfall) ─────────────────────────────────────────
// Combined WUBRG color identity for one or more commanders ("A / B" for partners)
const fetchColorIdentity = async (commanderStr) => {
  const names = (commanderStr || "").split("/").map(s => s.trim()).filter(Boolean).slice(0, 2);
  const ids = new Set();
  for (const c of names) {
    const r = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(c)}`);
    const d = await r.json();
    (d.color_identity || []).forEach(x => ids.add(x));
  }
  return "WUBRG".split("").filter(c => ids.has(c)).join("");
};

const ColorPips = ({ colors, size = 10 }) => colors ? (
  <div style={{ display: "flex", gap: 3 }}>
    {colors.split("").map((c, ci) => {
      const fg = {W:"#f1f5f9",U:"#93c5fd",B:"#94a3b8",R:"#fca5a5",G:"#86efac"}[c] || "#94a3b8";
      const cbg = {W:"rgba(255,255,255,0.1)",U:"rgba(96,165,250,0.18)",B:"rgba(15,15,15,0.8)",R:"rgba(239,68,68,0.18)",G:"rgba(34,197,94,0.18)"}[c] || "rgba(255,255,255,0.07)";
      return <span key={ci} style={{ fontSize: size, padding: "1px 5px", borderRadius: 4, background: cbg, color: fg, fontFamily: "'Cinzel',serif", fontWeight: 700 }}>{c}</span>;
    })}
  </div>
) : null;

function CommanderInput({ value, onChange, onPick, placeholder, style }) {
  const [sug, setSug] = useState([]);
  const [open, setOpen] = useState(false);
  const tRef = useRef(null);
  const handleChange = (q) => {
    onChange(q);
    clearTimeout(tRef.current);
    if (!q || q.trim().length < 2) { setSug([]); setOpen(false); return; }
    tRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        const names = (data.data || []).slice(0, 8);
        setSug(names); setOpen(names.length > 0);
      } catch { setSug([]); setOpen(false); }
    }, 250);
  };
  useEffect(() => () => clearTimeout(tRef.current), []);
  return (
    <div style={{ position: "relative" }}>
      <input value={value} onChange={e => handleChange(e.target.value)} placeholder={placeholder} style={style}
        onBlur={() => setTimeout(() => setOpen(false), 200)} autoCorrect="off" autoCapitalize="off" spellCheck={false} />
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 60, background: "rgba(8,8,18,0.98)", border: "1px solid rgba(255,255,255,0.16)", borderRadius: 8, marginTop: 4, maxHeight: 210, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.6)" }}>
          {sug.map(name => (
            <div key={name} onPointerDown={e => { e.preventDefault(); onChange(name); if (onPick) onPick(name); setSug([]); setOpen(false); }}
              style={{ padding: "9px 12px", fontSize: 14, color: "#e2e8f0", cursor: "pointer", fontFamily: "'Crimson Text',serif", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              {name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Color bar helpers ─────────────────────────────────────────────────────────
// hsl(h, 75%, 60%) → hex, so picked colors work with the app's `${color}44` alpha-suffix pattern
const hueToHex = (h) => {
  const l = 0.6, a = 0.3; // a = s * min(l, 1-l)
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};
// Project a pointer event onto the (possibly rotated) gradient bar and return the hex at that spot
const colorFromBar = (e, rot) => {
  const rect = e.currentTarget.getBoundingClientRect();
  let ratio;
  if (rot === 90)       ratio = (e.clientY - rect.top) / rect.height;
  else if (rot === -90) ratio = 1 - (e.clientY - rect.top) / rect.height;
  else if (rot === 180) ratio = 1 - (e.clientX - rect.left) / rect.width;
  else                  ratio = (e.clientX - rect.left) / rect.width;
  return hueToHex(Math.max(0, Math.min(1, ratio)) * 360);
};

// ── Player tile ────────────────────────────────────────────────────────────────
function PlayerTile({ player, idx, rot, life, poison, cmdDmg, cmdDmg2, partnerSeats, onTogglePartners, players, onLifeAdj, onAdjPoison, onAdjCmd, isDead, theme, gif, isActiveTurn, turnTimer, turnTimerEnabled, onNextTurn, turnCount, swapSource, onSwapStart, onSwapComplete, isMonarch, onClaimMonarch, hasBlessing, onToggleBlessing, onSurrender, customColor, onSetColor, milestone, overlayOpen }) {
  const color = customColor || COLORS[idx % COLORS.length];
  const defaultBg = DARK_BG[idx % DARK_BG.length];
  const themeBg = getThemeBg(theme);
  const hasPartners = partnerSeats?.has ? partnerSeats.has.bind(partnerSeats) : () => false;
  const receivers = players.map((p, fi) => fi !== idx ? { fi, p, dmg: cmdDmg[fi]?.[idx] ?? 0, dmg2: cmdDmg2?.[fi]?.[idx] ?? 0, partner: hasPartners(fi) } : null).filter(Boolean);

  const [showQuick, setShowQuick] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCmdDmg, setShowCmdDmg] = useState(false);
  const [surrenderArmed, setSurrenderArmed] = useState(false);
  useEffect(() => { if (!showSettings) setSurrenderArmed(false); }, [showSettings]);
  const isH = rot === 90 || rot === -90;
  // Zones split along the PLAYER'S vertical axis: + is always the top half of their view, − the bottom.
  // First zone = screen-top (vertical tiles) or screen-left (side tiles).
  // rot 0: their top = screen top (+ first). rot 180: their top = screen bottom (− first).
  // rot 90: their top = screen right (− first). rot -90: their top = screen left (+ first).
  const firstZoneDelta = (rot === 180 || rot === 90) ? -1 : 1;

  // ── Phase 1: Tap zones — tap = single adj, hold = rapid fire ─────────────────
  const tapHoldTimer = useRef(null);
  const tapRepeatTimer = useRef(null);
  const tapDidRepeat = useRef(false);
  const [pressedZone, setPressedZone] = useState(null); // +1 / -1 while finger is down — drives zone highlight

  const startTap = (delta) => {
    tapDidRepeat.current = false;
    setPressedZone(delta);
    tapHoldTimer.current = setTimeout(() => {
      tapDidRepeat.current = true;
      onLifeAdj(idx, delta);
      tapRepeatTimer.current = setInterval(() => onLifeAdj(idx, delta), 120);
    }, 350);
  };
  const endTap = (delta) => {
    clearTimeout(tapHoldTimer.current);
    clearInterval(tapRepeatTimer.current);
    setPressedZone(null);
    if (!tapDidRepeat.current) onLifeAdj(idx, delta);
  };
  const cancelTap = () => {
    clearTimeout(tapHoldTimer.current);
    clearInterval(tapRepeatTimer.current);
    setPressedZone(null);
  };

  // ── Phase 1: Center — tap = settings, long-press = QuickAdj popup ────────────
  const centerLongTimer = useRef(null);
  const centerDidLong = useRef(false);

  const startCenterPress = () => {
    centerDidLong.current = false;
    centerLongTimer.current = setTimeout(() => {
      centerDidLong.current = true;
      setShowQuick(true);
    }, 500);
  };
  const endCenterPress = (e) => {
    clearTimeout(centerLongTimer.current);
    if (!centerDidLong.current) { e.stopPropagation(); setShowSettings(s => !s); }
  };
  const cancelCenterPress = () => clearTimeout(centerLongTimer.current);

  const isLowLife = !isDead && life > 0 && life <= 10;
  // Stop GIF playback whenever it's covered — death, tile popups, or the center menu (power + it visibly bled through)
  const gifHidden = isDead || showSettings || showCmdDmg || overlayOpen;

  // ── Death animation phases: 0 = full blaze, 1 = fading out, 2 = settled (static, low power) ──
  const [deathPhase, setDeathPhase] = useState(0);
  useEffect(() => {
    if (!isDead) { setDeathPhase(0); return; }
    setDeathPhase(0);
    const t1 = setTimeout(() => setDeathPhase(1), 6000);
    const t2 = setTimeout(() => setDeathPhase(2), 7800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isDead]);

  return (
    <div style={{
      position: "relative",
      containerType: "size",
      background: gif ? "#000" : (themeBg || defaultBg),
      border: (isActiveTurn && turnTimerEnabled) ? `4px solid ${color}` : isLowLife ? `2px solid #ef444488` : `1px solid ${color}44`,
      boxShadow: (isActiveTurn && turnTimerEnabled) ? `inset 0 0 60px ${color}33, 0 0 0 3px ${color}88` : undefined,
      animation: isLowLife ? 'dangerPulse 1.4s ease-in-out infinite' : undefined,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      overflow: "hidden", userSelect: "none", transition: isLowLife ? "border 0.4s ease" : "box-shadow 0.4s ease, border 0.4s ease",
    }}>
      {gif && !gifHidden && <img src={gif} alt="" style={{ position: "absolute", top: "50%", left: "50%", width: isH ? "100cqh" : "100cqw", height: isH ? "100cqw" : "100cqh", objectFit: "cover", transform: `translate(-50%, -50%) rotate(${rot}deg)`, zIndex: 0 }} />}
      {gif && !gifHidden && <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.45)", zIndex:0 }} />}
      {!isDead && <ThemeParticles themeId={theme} rot={rot} />}
      {/* Grain texture for tactile tile depth */}
      <div style={{ position:"absolute", inset:0, zIndex:0, pointerEvents:"none", opacity:0.032,
        backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='256' height='256' filter='url(%23n)'/%3E%3C/svg%3E")`,
        backgroundSize:"256px 256px", backgroundRepeat:"repeat" }} />
      {/* Low-life red vignette */}
      {isLowLife && (
        <div style={{ position:"absolute", inset:0, zIndex:1, pointerEvents:"none",
          background:"radial-gradient(ellipse at 50% 50%, transparent 26%, rgba(239,68,68,0.18) 56%, rgba(239,68,68,0.55) 100%)",
          animation:"vignettePulse 1.4s ease-in-out infinite" }} />
      )}
      {/* Milestone life notification banner */}
      {milestone && !isDead && (
        <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", zIndex:12, pointerEvents:"none" }}>
          <div style={{ transform:`rotate(${rot}deg)` }}>
            <div style={{ animation:"milestonePop 2.2s ease-out forwards", background:"rgba(0,0,0,0.82)", border:"1px solid rgba(255,255,255,0.13)", borderRadius:14, padding:"clamp(8px,2vw,14px) clamp(14px,3vw,22px)", textAlign:"center", backdropFilter:"blur(8px)", boxShadow:"0 4px 24px rgba(0,0,0,0.5)" }}>
              <div style={{ fontSize:"clamp(22px,5vw,34px)", lineHeight:1, marginBottom:4 }}>{milestone.icon}</div>
              <div style={{ fontSize:"clamp(9px,2.2vw,12px)", color:"#e2e8f0", fontFamily:"'Cinzel',serif", letterSpacing:"0.12em", textTransform:"uppercase" }}>{milestone.text}</div>
            </div>
          </div>
        </div>
      )}
      {/* City's Blessing — ghosted skyline along the player's bottom edge */}
      {hasBlessing && !isDead && (
        <div style={{ position: "absolute", top: "50%", left: "50%", width: isH ? "100cqh" : "100cqw", height: isH ? "100cqw" : "100cqh", transform: `translate(-50%,-50%) rotate(${rot}deg)`, pointerEvents: "none", zIndex: 1, overflow: "hidden" }}>
          <svg viewBox="0 0 400 80" preserveAspectRatio="none" style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: "32%", opacity: 0.13 }}>
            <path fill="#60a5fa" d="M0 80 V48 H16 V32 H28 V48 H42 V56 H56 V24 H62 V14 H66 V24 H78 V56 H92 V40 H108 V52 H122 V28 H134 V52 H150 V60 H164 V36 H178 V44 H192 V18 H198 V10 H202 V18 H214 V44 H228 V58 H244 V30 H258 V50 H274 V38 H290 V56 H306 V22 H316 V46 H332 V60 H348 V34 H362 V48 H378 V42 H400 V80 Z" />
            <path fill="#93c5fd" opacity="0.5" d="M60 14 h6 v2 h-6 z M196 10 h6 v2 h-6 z M306 22 h10 v2 h-10 z" />
          </svg>
        </div>
      )}
      {/* Monarch golden shimmer — rotated to match player orientation */}
      {isMonarch && !isDead && (
        <div style={{ position:"absolute", inset:0, zIndex:1, pointerEvents:"none", overflow:"hidden", transform:`rotate(${rot}deg)` }}>
          <div style={{ position:"absolute", top:0, left:"-10%", right:"-10%", height:"50%", background:"radial-gradient(ellipse at 50% 0%, rgba(251,191,36,0.22) 0%, rgba(251,191,36,0.06) 45%, transparent 70%)", animation:"monarchShimmer 3s ease-in-out infinite alternate" }} />
        </div>
      )}

      {/* Tap zones — split along the player's own up/down axis, highlight green/red while pressed */}
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: isH ? "row" : "column", zIndex: 1 }}>
        <div style={{ flex: 1, cursor: "pointer", transition: "background 0.1s",
          background: pressedZone === firstZoneDelta ? (firstZoneDelta > 0 ? "rgba(74,222,128,0.13)" : "rgba(248,113,113,0.13)") : "transparent" }}
          onPointerDown={() => startTap(firstZoneDelta)}
          onPointerUp={() => endTap(firstZoneDelta)}
          onPointerCancel={cancelTap} onPointerLeave={cancelTap}
          onContextMenu={e => e.preventDefault()} />
        <div style={{ flex: 1, cursor: "pointer", transition: "background 0.1s",
          background: pressedZone === -firstZoneDelta ? (-firstZoneDelta > 0 ? "rgba(74,222,128,0.13)" : "rgba(248,113,113,0.13)") : "transparent" }}
          onPointerDown={() => startTap(-firstZoneDelta)}
          onPointerUp={() => endTap(-firstZoneDelta)}
          onPointerCancel={cancelTap} onPointerLeave={cancelTap}
          onContextMenu={e => e.preventDefault()} />
      </div>

      {/* Content — passes touches through to the +/- zones except on interactive elements (HP number, End Turn) */}
      <div style={{ transform: `rotate(${rot}deg)`, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, pointerEvents: "none", zIndex: 2 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div style={{ position:"relative", display:"inline-block" }}>
            <span style={{ fontSize: "clamp(32px,6vw,52px)", lineHeight: 1 }}>{player.emoji || DEFAULT_EMOJI[idx]}</span>
            {isMonarch && (
              <span style={{ position:"absolute", top:"-18px", left:"50%", transform:"translateX(-50%)", fontSize:"clamp(18px,3.5vw,26px)", lineHeight:1, filter:"drop-shadow(0 0 8px #fbbf24) drop-shadow(0 0 16px rgba(251,191,36,0.6))", animation:"crownFloat 2.5s ease-in-out infinite", display:"block" }}>👑</span>
            )}
          </div>
          <span style={{ fontSize: 12, letterSpacing: "0.2em", color: color, textTransform: "uppercase", opacity: 0.85 }}>{player.name}</span>
          {hasBlessing && <span style={{ fontSize: 9, letterSpacing: "0.3em", color: "#60a5fa", fontFamily: "'Cinzel',serif", textShadow: "0 0 8px rgba(96,165,250,0.8)", marginTop: 1 }}>🏛 BLESSED</span>}
        </div>
        {/* HP number — tap opens player settings, long-press opens quick adjust */}
        <div style={{ fontSize: "clamp(52px, 10vw, 96px)", fontWeight: 700, lineHeight: 1, color: life <= 0 ? "#94a3b8" : life <= 10 ? "#f87171" : life <= 20 ? "#fb923c" : "#fff", pointerEvents: "auto", cursor: "pointer", padding: "0 14px" }}
          onPointerDown={e => { e.stopPropagation(); startCenterPress(); }}
          onPointerUp={e => { e.stopPropagation(); endCenterPress(e); }}
          onPointerCancel={e => { e.stopPropagation(); cancelCenterPress(); }}
          onPointerLeave={e => { e.stopPropagation(); cancelCenterPress(); }}
          onContextMenu={e => e.preventDefault()}>{life}</div>
        {isActiveTurn && turnTimerEnabled && (
          <div style={{ fontSize: 11, fontFamily: "'Cinzel',serif", letterSpacing: "0.1em", color: turnTimer >= 120 ? "#f87171" : turnTimer >= 60 ? "#fb923c" : color, opacity: 0.9 }}>⏱ {fmtDur(turnTimer)}</div>
        )}
        {isActiveTurn && turnTimerEnabled && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, marginTop: 4 }}>
            <span style={{ fontSize: 10, color, opacity: 0.6, fontFamily: "'Cinzel',serif", letterSpacing: "0.12em" }}>TURN {turnCount}</span>
            <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onNextTurn(); }}
              style={{ padding: "16px 0", width: isH ? "min(80cqh, 320px)" : "min(80cqw, 320px)", borderRadius: 14, background: `linear-gradient(135deg, ${color}33, ${color}18)`, border: `2px solid ${color}88`, color, fontFamily: "'Cinzel',serif", fontSize: 18, fontWeight: 700, cursor: "pointer", letterSpacing: "0.1em", pointerEvents: "auto", boxShadow: `0 0 14px ${color}33`, animation: "endTurnGlow 2s ease-in-out infinite" }}>
              END TURN ▶
            </button>
            <style>{`@keyframes endTurnGlow{0%,100%{box-shadow:0 0 8px ${color}22}50%{box-shadow:0 0 18px ${color}55}}`}</style>
          </div>
        )}
        {poison > 0 && <div style={{ fontSize: 13, color: "#4ade80", letterSpacing: "0.05em" }}>☠ {poison} poison</div>}
        {/* Commander damage chips — display only; managed via player settings */}
        {receivers.some(r => r.dmg > 0 || r.dmg2 > 0) && (
          <div style={{ minHeight: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
              {receivers.flatMap(r => {
                const chips = [];
                if (r.dmg > 0) chips.push({ key: `${r.fi}a`, dmg: r.dmg, tag: r.partner ? "Ⅰ" : "" });
                if (r.partner && r.dmg2 > 0) chips.push({ key: `${r.fi}b`, dmg: r.dmg2, tag: "Ⅱ" });
                return chips.map(c => {
                  const isLethal = c.dmg >= 21; const isDanger = c.dmg >= 15;
                  return (
                    <div key={c.key} style={{ fontSize: 12, background: isLethal ? "rgba(239,68,68,0.25)" : `${COLORS[r.fi]}22`, border: `1px solid ${isLethal ? "#ef444488" : isDanger ? "#fb923c66" : COLORS[r.fi]+"44"}`, borderRadius: 20, padding: "2px 8px", color: isLethal ? "#f87171" : isDanger ? "#fb923c" : COLORS[r.fi] }}>
                      ⚔ {r.p.emoji || DEFAULT_EMOJI[r.fi]}{c.tag ? ` ${c.tag}` : ""} {c.dmg}{isLethal ? " !" : ""}
                    </div>
                  );
                });
              })}
            </div>
          </div>
        )}
      </div>

      {/* Settings panel — fills the whole tile */}
      {showSettings && (
        <div style={{ position: "absolute", inset: 0, zIndex: 12, background: "rgba(5,5,15,0.97)", pointerEvents: "auto" }}
          onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
          <div style={{ position: "absolute", top: "50%", left: "50%", width: isH ? "100cqh" : "100cqw", height: isH ? "100cqw" : "100cqh", transform: `translate(-50%,-50%) rotate(${rot}deg)`, display: "flex", flexDirection: "column", justifyContent: "space-evenly", padding: "8px 16px", boxSizing: "border-box" }}>
            {/* Header: name · poison · close */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, color: color, letterSpacing: "0.08em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{player.emoji} {player.name}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                <span style={{ color: "#4ade80", fontSize: 13 }}>☠</span>
                <button onPointerDown={e=>e.stopPropagation()} onClick={() => onAdjPoison(idx, -1)} style={{ ...btn(), padding: "4px 12px", fontSize: 15, lineHeight: 1 }}>−</button>
                <span style={{ minWidth: 26, textAlign: "center", fontSize: 17, fontWeight: 700, color: poison >= 10 ? "#f87171" : "#e2e8f0" }}>{poison}</span>
                <button onPointerDown={e=>e.stopPropagation()} onClick={() => onAdjPoison(idx, 1)} style={{ ...btn(), padding: "4px 12px", fontSize: 15, lineHeight: 1, color: "#4ade80" }}>+</button>
              </div>
              <button onPointerDown={e=>e.stopPropagation()} onClick={() => setShowSettings(false)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, color: "#94a3b8", fontSize: 17, cursor: "pointer", padding: "4px 12px", lineHeight: 1, flexShrink: 0 }}>✕</button>
            </div>
            {/* Monarch + City's Blessing */}
            <div style={{ display: "flex", gap: 8 }}>
              <button onPointerDown={e=>e.stopPropagation()} onClick={() => { onClaimMonarch(idx); setShowSettings(false); }}
                style={{ flex: 1, padding: "9px 4px", borderRadius: 10, background: isMonarch ? "rgba(251,191,36,0.25)" : `${color}15`, border: `1px solid ${isMonarch ? "#fbbf2466" : color+"44"}`, color: isMonarch ? "#fbbf24" : color, fontFamily: "'Cinzel',serif", fontSize: 12, cursor: "pointer", letterSpacing: "0.04em" }}>
                {isMonarch ? "👑 Monarch" : "Take 👑"}
              </button>
              <button onPointerDown={e=>e.stopPropagation()} onClick={() => { onToggleBlessing(idx); setShowSettings(false); }}
                style={{ flex: 1, padding: "9px 4px", borderRadius: 10, background: hasBlessing ? "rgba(96,165,250,0.22)" : `${color}15`, border: `1px solid ${hasBlessing ? "#60a5fa66" : color+"44"}`, color: hasBlessing ? "#60a5fa" : color, fontFamily: "'Cinzel',serif", fontSize: 12, cursor: "pointer", letterSpacing: "0.04em" }}>
                {hasBlessing ? "🏛 Blessed" : "Take 🏛"}
              </button>
            </div>
            {/* Color bar — tap or drag to pick, ↺ resets */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); onSetColor(idx, colorFromBar(e, rot)); }}
                onPointerMove={e => { if (e.buttons > 0) onSetColor(idx, colorFromBar(e, rot)); }}
                style={{ flex: 1, height: 26, borderRadius: 13, cursor: "pointer", border: `2px solid ${color}`, boxSizing: "border-box",
                  background: "linear-gradient(to right, hsl(0,75%,60%), hsl(60,75%,60%), hsl(120,75%,60%), hsl(180,75%,60%), hsl(240,75%,60%), hsl(300,75%,60%), hsl(360,75%,60%))" }} />
              <div onPointerDown={e=>e.stopPropagation()} onClick={() => onSetColor(idx, null)}
                style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(255,255,255,0.1)", cursor: "pointer", border: "2px solid rgba(255,255,255,0.2)", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", flexShrink: 0, boxSizing: "border-box" }}>↺</div>
            </div>
            {/* ⚔ Cmd panel + partners toggle */}
            <div style={{ display: "flex", gap: 8 }}>
              <button onPointerDown={e=>e.stopPropagation()} onClick={() => { setShowSettings(false); setShowCmdDmg(true); }}
                style={{ flex: 1.4, padding: "10px 4px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0", fontFamily: "'Cinzel',serif", fontSize: 12, cursor: "pointer", letterSpacing: "0.04em" }}>
                ⚔ Cmd Damage
              </button>
              <button onPointerDown={e=>e.stopPropagation()} onClick={() => onTogglePartners(idx)}
                style={{ flex: 1, padding: "10px 4px", borderRadius: 10, background: hasPartners(idx) ? "rgba(192,132,252,0.22)" : "rgba(255,255,255,0.05)", border: `1px solid ${hasPartners(idx) ? "#c084fc66" : "rgba(255,255,255,0.12)"}`, color: hasPartners(idx) ? "#c084fc" : "#94a3b8", fontFamily: "'Cinzel',serif", fontSize: 12, cursor: "pointer", letterSpacing: "0.04em" }}>
                {hasPartners(idx) ? "⚔⚔ Partners ✓" : "⚔⚔ Partners"}
              </button>
            </div>
            {/* 🏳 Surrender — two-tap confirm */}
            <button onPointerDown={e=>e.stopPropagation()} onClick={() => { if (!surrenderArmed) { setSurrenderArmed(true); return; } setShowSettings(false); onSurrender(idx); }}
              style={{ width: "100%", padding: "10px 8px", borderRadius: 10, background: surrenderArmed ? "rgba(239,68,68,0.3)" : "rgba(239,68,68,0.08)", border: `1px solid ${surrenderArmed ? "#ef4444" : "rgba(239,68,68,0.3)"}`, color: "#f87171", fontFamily: "'Cinzel',serif", fontSize: 13, cursor: "pointer", letterSpacing: "0.06em" }}>
              {surrenderArmed ? "⚠ Tap again to concede" : "🏳 Surrender"}
            </button>
          </div>
        </div>
      )}

      {/* ── Commander Damage Panel ─────────────────────────────────────── */}
      {showCmdDmg && (
        <div style={{ position:"absolute", inset:0, zIndex:15, background:"rgba(0,0,0,0.93)", display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"auto" }}
          onPointerDown={e=>e.stopPropagation()} onClick={()=>setShowCmdDmg(false)}>
          <div style={{ transform:`rotate(${rot}deg)`, width:"92%", maxWidth:260 }}
            onClick={e=>e.stopPropagation()}>
            {/* Header */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <span style={{ fontSize:11, color:color, fontFamily:"'Cinzel',serif", letterSpacing:"0.12em" }}>⚔ CMD DAMAGE RECV'D</span>
              <button onClick={()=>setShowCmdDmg(false)} style={{ background:"none", border:"none", color:"#94a3b8", fontSize:20, cursor:"pointer", lineHeight:1, padding:"0 2px" }}>✕</button>
            </div>
            {/* One row per attacker — two counters when they run partners */}
            {players.map((attacker, ai) => {
              if (ai === idx) return null;
              const ac = COLORS[ai % COLORS.length];
              const isPartner = hasPartners(ai);
              const counters = isPartner
                ? [{ cmdr: 0, dmg: cmdDmg[ai]?.[idx] ?? 0, tag: "Ⅰ" }, { cmdr: 1, dmg: cmdDmg2?.[ai]?.[idx] ?? 0, tag: "Ⅱ" }]
                : [{ cmdr: 0, dmg: cmdDmg[ai]?.[idx] ?? 0, tag: null }];
              const anyLethal = counters.some(c => c.dmg >= 21);
              const anyDanger = counters.some(c => c.dmg >= 15);
              return (
                <div key={ai} style={{ display:"flex", flexDirection:"column", gap:6, padding:"9px 10px", marginBottom:6, borderRadius:10, background: anyLethal ? "rgba(239,68,68,0.18)" : anyDanger ? "rgba(251,146,60,0.12)" : `${ac}0d`, border:`1px solid ${anyLethal?"#ef444466":anyDanger?"#fb923c44":ac+"2a"}`, transition:"background 0.2s" }}>
                  {counters.map((c, ci) => {
                    const isLethal = c.dmg >= 21;
                    const isDanger = c.dmg >= 15;
                    return (
                      <div key={ci} style={{ display:"flex", alignItems:"center", gap:8 }}>
                        {ci === 0
                          ? <span style={{ fontSize:26, lineHeight:1, minWidth:34 }}>{attacker.emoji || DEFAULT_EMOJI[ai % DEFAULT_EMOJI.length]}</span>
                          : <span style={{ minWidth:34 }} />}
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:11, color:ac, fontFamily:"'Cinzel',serif", letterSpacing:"0.04em", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{ci === 0 ? attacker.name : ""}{c.tag ? <span style={{ color:"#94a3b8", marginLeft: ci === 0 ? 6 : 0 }}>cmdr {c.tag}</span> : ""}</div>
                          {isLethal && <div style={{ fontSize:9, color:"#f87171", letterSpacing:"0.1em", marginTop:1 }}>LETHAL ⚔</div>}
                        </div>
                        <button onPointerDown={e=>e.stopPropagation()} onClick={()=>onAdjCmd(ai,idx,-1,c.cmdr)} disabled={c.dmg <= 0}
                          style={{ width:38, height:38, borderRadius:8, background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.14)", color: c.dmg <= 0 ? "#334155" : "#e2e8f0", fontSize:22, cursor: c.dmg <= 0 ? "default" : "pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>−</button>
                        <span style={{ fontSize:24, fontWeight:700, minWidth:36, textAlign:"center", color:isLethal?"#f87171":isDanger?"#fb923c":"#fff", fontVariantNumeric:"tabular-nums" }}>{c.dmg}</span>
                        <button onPointerDown={e=>e.stopPropagation()} onClick={()=>onAdjCmd(ai,idx,1,c.cmdr)}
                          style={{ width:38, height:38, borderRadius:8, background:`${ac}22`, border:`1px solid ${ac}55`, color:ac, fontSize:22, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>+</button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showQuick && <QuickAdjPopup idx={idx} rot={rot} onAdj={onLifeAdj} onClose={() => setShowQuick(false)} onSwap={() => onSwapStart(idx)} />}

      {swapSource !== null && swapSource !== idx && !isDead && (
        <div onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onSwapComplete(idx); }}
          style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", alignItems: "center", justifyContent: "center", background: `${color}18`, cursor: "pointer", animation: "swapPulse 1s ease-in-out infinite" }}>
          <div style={{ transform: `rotate(${rot}deg)`, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, pointerEvents: "none" }}>
            <span style={{ fontSize: "clamp(28px,5vw,44px)" }}>🔄</span>
            <span style={{ fontSize: 11, fontFamily: "'Cinzel',serif", color, letterSpacing: "0.1em" }}>SWAP HERE</span>
          </div>
        </div>
      )}
      {swapSource === idx && (
        <div onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onSwapComplete(idx); }}
          style={{ position: "absolute", inset: 0, zIndex: 30, border: `3px dashed ${color}`, pointerEvents: "auto", cursor: "pointer", animation: "swapPulse 1s ease-in-out infinite" }}>
          <div style={{ position: "absolute", inset: 0, background: `${color}10` }} />
        </div>
      )}
      <style>{`@keyframes swapPulse{0%,100%{opacity:1}50%{opacity:0.55}} @keyframes dangerPulse{0%,100%{box-shadow:inset 0 0 30px rgba(239,68,68,0.15),0 0 0 2px rgba(239,68,68,0.35)}50%{box-shadow:inset 0 0 60px rgba(239,68,68,0.45),0 0 0 2px rgba(239,68,68,0.9)}} @keyframes monarchShimmer{0%{opacity:0.55}100%{opacity:1}} @keyframes crownFloat{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(-3px)}} @keyframes vignettePulse{0%,100%{opacity:0.55}50%{opacity:1}} @keyframes milestonePop{0%{opacity:0;transform:scale(0.7)}10%{opacity:1;transform:scale(1.06)}18%{transform:scale(1)}80%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(0.92)}}`}</style>

      {isDead && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10 }}>
          {/* Dark desaturated overlay */}
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }} />
          {/* Settled scene — fully static, near-zero GPU cost. Always rendered under the blaze so the crossfade lands on it. */}
          <div style={{ position: "absolute", inset: 0, transform: `rotate(${rot}deg)`, transformOrigin: "center center", overflow: "hidden" }}>
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "40%", background: "linear-gradient(to top, rgba(180,30,0,0.55), rgba(255,90,0,0.22), transparent)", filter: "blur(12px)" }} />
            <div style={{ position: "absolute", bottom: "-4%", left: "18%", right: "18%", height: "12%", background: "radial-gradient(ellipse at 50% 100%, rgba(255,140,0,0.5) 0%, rgba(255,60,0,0.28) 45%, transparent 75%)", filter: "blur(9px)" }} />
            {/* Static glowing embers */}
            {Array.from({ length: 6 }, (_, i) => {
              const emberColors = ["#ffd700","#ff8c00","#ff4500","#ffaa00","#ff6600","#ffffa0"];
              const sz = 2 + (i * 3 % 4);
              return <div key={`se${i}`} style={{ position: "absolute", bottom: `${4 + (i * 11) % 18}%`, left: `${8 + (i * 29) % 84}%`, width: sz, height: sz, borderRadius: "50%", background: emberColors[i % 6], boxShadow: `0 0 ${sz * 3}px ${emberColors[i % 6]}`, opacity: 0.8 }} />;
            })}
          </div>
          {/* Blaze phase — nuke GIF, crossfades out then unmounts to save power */}
          {deathPhase < 2 && (
          <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity: deathPhase >= 1 ? 0 : 1, transition: "opacity 1.8s ease" }}>
            <img src={nukeGif} alt="" style={{ position: "absolute", top: "50%", left: "50%", width: isH ? "100cqh" : "100cqw", height: isH ? "100cqw" : "100cqh", objectFit: "cover", transform: `translate(-50%, -50%) rotate(${rot}deg)` }} />
          </div>
          )}
          {/* Skull — pop, pulse a few times, then hold static */}
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: `translate(-50%,-50%) rotate(${rot}deg)`, zIndex: 2 }}>
            <div style={{ fontSize: "clamp(52px,10vw,90px)", lineHeight: 1, animation: "skullpopInner 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards, skullpulseInner 2.5s 0.5s ease-in-out 3", filter: `drop-shadow(0 0 22px ${color}) drop-shadow(0 0 44px rgba(255,60,0,0.75)) drop-shadow(0 0 6px #fff)`, display: "inline-block" }}>💀</div>
          </div>
          <style>{`
            @keyframes skullpopInner{0%{transform:scale(0) rotate(-15deg);opacity:0}50%{transform:scale(1.25) rotate(5deg);opacity:1}100%{transform:scale(1) rotate(0deg);opacity:1}}
            @keyframes skullpulseInner{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
          `}</style>
        </div>
      )}

      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: isH ? "row" : "column", pointerEvents: "none", zIndex: 3 }}>
        <div style={{ flex: 1, display: "flex", alignItems: isH ? "center" : "flex-start", justifyContent: isH ? "flex-start" : "center", padding: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1, color: firstZoneDelta > 0 ? "rgba(74,222,128,0.18)" : "rgba(248,113,113,0.18)", transform: `rotate(${rot}deg)` }}>{firstZoneDelta > 0 ? "+" : "−"}</span>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: isH ? "center" : "flex-end", justifyContent: isH ? "flex-end" : "center", padding: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1, color: firstZoneDelta > 0 ? "rgba(248,113,113,0.18)" : "rgba(74,222,128,0.18)", transform: `rotate(${rot}deg)` }}>{firstZoneDelta > 0 ? "−" : "+"}</span>
        </div>
      </div>
    </div>
  );
}

// ── Finger Chooser ────────────────────────────────────────────────────────────
function FingerChooser({ players, onClose, onChoose, excludeId }) {
  // Last game's winner sits out — they don't get to go first again
  const excludedIdx = excludeId ? players.findIndex(p => p.id === excludeId) : -1;
  const allSeats = players.map((p, i) => ({ p, i }));
  const roster = (excludedIdx >= 0 && players.length > 2) ? allSeats.filter(({ i }) => i !== excludedIdx) : allSeats;
  const excludedPlayer = roster.length < players.length ? players[excludedIdx] : null;
  const n = roster.length;
  const [positions, setPositions] = useState({});
  const [order, setOrder] = useState([]);
  const [phase, setPhase] = useState("waiting");
  const [countdown, setCountdown] = useState(3);
  const [winner, setWinner] = useState(null);
  const cdInterval = useRef(null);
  const trackedIds = useRef(new Set());

  const startCountdown = () => {
    setPhase("countdown"); setCountdown(3);
    let c = 3;
    cdInterval.current = setInterval(() => {
      c--; setCountdown(c);
      if (c <= 0) { clearInterval(cdInterval.current); setPhase("reveal"); }
    }, 1000);
  };

  const handleTouchStart = (e) => {
    e.preventDefault();
    if (phase !== "waiting") return;
    setOrder(prev => {
      if (prev.length >= n) return prev;
      let next = [...prev]; const newPos = {};
      for (const t of e.changedTouches) {
        if (!trackedIds.current.has(t.identifier) && next.length < n) {
          trackedIds.current.add(t.identifier);
          next.push(t.identifier);
          newPos[t.identifier] = { x: t.clientX, y: t.clientY };
        }
      }
      setPositions(p => ({ ...p, ...newPos }));
      if (next.length === n) setTimeout(startCountdown, 500);
      return next;
    });
  };

  const handleTouchEnd = (e) => {
    e.preventDefault();
    if (phase === "reveal") { onClose(); }
  };

  useEffect(() => {
    if (phase === "reveal") {
      const picked = order[Math.floor(Math.random() * order.length)];
      setWinner(picked);
      const seatIdx = roster[order.indexOf(picked)].i;
      if (onChoose) setTimeout(() => { onChoose(seatIdx); onClose(); }, 2200);
      playTone(660, "sine", 0.4, 0.3);
    }
  }, [phase]);

  useEffect(() => () => clearInterval(cdInterval.current), []);

  const FINGER_COLORS = ["#c084fc","#f472b6","#60a5fa","#34d399","#fb923c","#f87171"];
  const nextPlayer = phase === "waiting" && order.length < n ? roster[order.length].p : null;
  const winnerSeatIdx = winner ? order.indexOf(winner) : -1;
  const winnerPlayer = winnerSeatIdx >= 0 ? roster[winnerSeatIdx].p : null;

  return (
    <div style={{ position:"fixed", inset:0, zIndex:400, background:"rgba(5,5,15,0.97)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", touchAction:"none" }}
      onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchEnd}>
      <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", textAlign:"center", pointerEvents:"none", zIndex:1, width:"80%" }}>
        {phase === "waiting" && nextPlayer && (
          <>
            <div style={{ fontSize:"clamp(40px,8vw,64px)", lineHeight:1, marginBottom:10 }}>{nextPlayer.emoji || DEFAULT_EMOJI[order.length]}</div>
            <div style={{ fontSize:"clamp(20px,4vw,32px)", fontFamily:"'Cinzel',serif", color:FINGER_COLORS[order.length % FINGER_COLORS.length], marginBottom:8, letterSpacing:"0.08em" }}>{nextPlayer.name}</div>
            <div style={{ fontSize:"clamp(14px,3vw,20px)", fontFamily:"'Crimson Text',serif", color:"#94a3b8", letterSpacing:"0.05em" }}>place your finger on the screen</div>
            <div style={{ marginTop:16, fontSize:12, color:"#94a3b8", fontFamily:"'Cinzel',serif", letterSpacing:"0.12em" }}>{order.length} / {n} placed</div>
            {excludedPlayer && <div style={{ marginTop:10, fontSize:12, color:"#fbbf24", fontFamily:"'Crimson Text',serif", letterSpacing:"0.05em" }}>👑 {excludedPlayer.name} won last game — sits this one out</div>}
          </>
        )}
        {phase === "countdown" && (
          <div style={{ fontSize:"clamp(80px,20vw,160px)", fontFamily:"'Cinzel',serif", fontWeight:700, color:"#fbbf24", lineHeight:1 }}>{countdown}</div>
        )}
        {phase === "reveal" && winnerPlayer && (
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:"clamp(40px,8vw,64px)", lineHeight:1, marginBottom:8 }}>{winnerPlayer.emoji || DEFAULT_EMOJI[winnerSeatIdx]}</div>
            <div style={{ fontSize:"clamp(18px,4vw,28px)", fontFamily:"'Cinzel',serif", color:"#fbbf24", marginBottom:4, letterSpacing:"0.1em" }}>{winnerPlayer.name}</div>
            <div style={{ fontSize:"clamp(14px,3vw,20px)", fontFamily:"'Cinzel',serif", color:"#fbbf24", letterSpacing:"0.15em" }}>👑 GOES FIRST!</div>
          </div>
        )}
      </div>
      {order.map((id, i) => {
        const pos = positions[id] || { x: 0, y: 0 };
        const isWinner = phase === "reveal" && id === winner;
        const isLoser  = phase === "reveal" && id !== winner;
        const color = FINGER_COLORS[i % FINGER_COLORS.length];
        const p = roster[i]?.p;
        return (
          <div key={id} style={{ position:"absolute", left:pos.x, top:pos.y, transform:"translate(-50%,-50%)", width: isWinner ? 110 : 80, height: isWinner ? 110 : 80, borderRadius:"50%", background: isWinner ? `radial-gradient(circle, #fff 0%, ${color} 50%, transparent 80%)` : isLoser ? "rgba(100,116,139,0.2)" : `radial-gradient(circle, ${color} 0%, ${color}88 60%, transparent 80%)`, border: `3px solid ${isWinner ? "#fbbf24" : isLoser ? "rgba(100,116,139,0.25)" : color}`, boxShadow: isWinner ? `0 0 40px #fbbf24, 0 0 80px ${color}88` : isLoser ? "none" : `0 0 20px ${color}66`, display:"flex", alignItems:"center", justifyContent:"center", fontSize: isWinner ? 28 : 20, transition:"all 0.4s cubic-bezier(0.34,1.56,0.64,1)", zIndex: isWinner ? 5 : 2 }}>
            {isWinner ? "👑" : (p?.emoji || DEFAULT_EMOJI[i])}
          </div>
        );
      })}
      {phase === "reveal" && <div style={{ position:"absolute", inset:0, zIndex:10 }} onClick={onClose} />}
      {phase !== "reveal" && <button onClick={onClose} style={{ position:"absolute", top:20, right:20, ...btn("danger"), padding:"6px 14px", zIndex:20 }}>✕</button>}
    </div>
  );
}

// ── Center Menu ───────────────────────────────────────────────────────────────
function CenterMenu({ onClose, onNav, onNewGame, onNewGameNoSave, timer, timerRunning, onTimerToggle, onTimerReset, players, decks, onSaveGame, appThemeIdx, setAppThemeIdx, startInSaveMode, computeStats, onFlushEvents, onSetFirstPlayer, monarchIdx, onClaimMonarch, lifeHistorySnap, eventsSnap, finalLifesSnap, playerOrderSnap, gameMode, podName, lastWinnerId }) {
  const [saveMode, setSaveMode] = useState(!!startInSaveMode);
  const [gameStats] = useState(() => computeStats ? computeStats() : []);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [newGamePrompt, setNewGamePrompt] = useState(false);
  const [saveThenNew, setSaveThenNew] = useState(false);
  const [seats, setSeats] = useState(players.map(p => ({ playerId: p.id, deckId: "", commander: "" })));
  const [winner, setWinner] = useState("");
  const [drawIds, setDrawIds] = useState([]);
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const updateSeat = (i, f, v) => setSeats(prev => { const s = [...prev]; s[i] = { ...s[i], [f]: v }; return s; });
  const playerDecks = (pid) => decks.filter(d => d.playerId === pid);
  const doSave = () => { const result = winner === "__draw" ? "draw" : winner === "__nongame" ? "nongame" : "win"; onSaveGame({ id: uid(), date, seats, winner: winner.startsWith("__") ? "" : winner, result, ...(result === "draw" ? { drawPlayerIds: drawIds } : {}), duration: fmtDur(timer), notes, stats: gameStats, lifeHistory: lifeHistorySnap, events: eventsSnap, finalLifes: finalLifesSnap, playerOrder: playerOrderSnap, createdAt: Date.now() }); setSaveMode(false); onClose(); if (saveThenNew) onNewGameNoSave(); };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 150, display: "flex", alignItems: "center", justifyContent: "center", padding: "max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))" }}>
      <div style={{ background: "var(--modal-bg)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 24, width: "100%", maxWidth: 440, maxHeight: "92vh", overflowY: "auto" }}>
        {!saveMode ? (
          <>
            {/* Header: pod name + game mode badge */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:18 }}>
              {podName
                ? <span style={{ fontSize:11, color:"var(--accent)", letterSpacing:"0.12em", fontFamily:"'Cinzel',serif" }}>⬡ {podName}</span>
                : <span/>}
              <span style={{ fontSize:10, padding:"3px 10px", borderRadius:20, letterSpacing:"0.08em", fontFamily:"'Cinzel',serif",
                background: gameMode === "sweaty" ? "rgba(250,204,21,0.12)" : "rgba(148,163,184,0.10)",
                border: gameMode === "sweaty" ? "1px solid rgba(250,204,21,0.3)" : "1px solid rgba(148,163,184,0.25)",
                color: gameMode === "sweaty" ? "#facc15" : "#94a3b8" }}>
                {gameMode === "sweaty" ? "🏆 SWEATY" : "⚡ CASUAL"}
              </span>
            </div>

            {/* TIMER */}
            <div style={{ fontSize:10, letterSpacing:"0.15em", color:"#94a3b8", fontFamily:"'Cinzel',serif", marginBottom:8 }}>TIMER</div>
            <div style={{ textAlign:"center", marginBottom:14 }}>
              <div style={{ fontFamily:"'Cinzel',serif", fontSize:28, color:"var(--accent)", marginBottom:10 }}>{fmtDur(timer)}</div>
              <div style={{ display:"flex", gap:8, justifyContent:"center", marginBottom: timer > 0 && gameMode === "sweaty" ? 10 : 0 }}>
                <button onClick={onTimerToggle} style={btn(timerRunning ? "danger" : "primary")}>{timerRunning ? "Pause" : "Start"}</button>
                <button onClick={onTimerReset} style={btn()}>Reset</button>
              </div>
              {timer > 0 && gameMode === "sweaty" && (
                <button onClick={() => { onFlushEvents(); setSaveMode(true); }} style={{ ...btn("primary"), width:"100%", padding:"8px 0", fontSize:12 }}>✍ Log Game</button>
              )}
            </div>

            <hr style={{ border:"none", borderTop:"1px solid rgba(255,255,255,0.07)", margin:"16px 0" }} />

            {/* IN GAME */}
            <div style={{ fontSize:10, letterSpacing:"0.15em", color:"#94a3b8", fontFamily:"'Cinzel',serif", marginBottom:10 }}>IN GAME</div>
            {onClaimMonarch && (
              <div style={{ marginBottom:10 }}>
                <div style={{ fontSize:10, color:"#94a3b8", marginBottom:6, fontFamily:"'Cinzel',serif" }}>👑 Monarch</div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {players.map((p, i) => (
                    <button key={i} onClick={() => onClaimMonarch(i)}
                      style={{ padding:"5px 10px", borderRadius:20, cursor:"pointer", fontFamily:"'Cinzel',serif", fontSize:11,
                        background: monarchIdx === i ? "rgba(251,191,36,0.2)" : "rgba(255,255,255,0.05)",
                        border: monarchIdx === i ? "1px solid #fbbf2466" : "1px solid rgba(255,255,255,0.1)",
                        color: monarchIdx === i ? "#fbbf24" : "#94a3b8" }}>
                      {monarchIdx === i ? "👑 " : ""}{p.emoji || "⚔"} {p.name}
                    </button>
                  ))}
                  {monarchIdx !== null && <button onClick={() => onClaimMonarch(null)} style={{ padding:"5px 10px", borderRadius:20, cursor:"pointer", fontFamily:"'Cinzel',serif", fontSize:11, background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.3)", color:"#f87171" }}>Clear</button>}
                </div>
              </div>
            )}
            <button onClick={() => setChooserOpen(true)} style={{ ...btn(), width:"100%", padding:12, fontSize:13, marginBottom:4 }}>👆 Who Goes First?</button>

            <hr style={{ border:"none", borderTop:"1px solid rgba(255,255,255,0.07)", margin:"16px 0" }} />

            {/* APPEARANCE */}
            <div style={{ fontSize:10, letterSpacing:"0.15em", color:"#94a3b8", fontFamily:"'Cinzel',serif", marginBottom:10 }}>APPEARANCE</div>
            <div style={{ display:"flex", gap:6, justifyContent:"center", flexWrap:"wrap", marginBottom:4 }}>
              {APP_THEMES.map((t, i) => (
                <button key={t.name} onClick={() => setAppThemeIdx(i)}
                  style={{ padding:"6px 12px", borderRadius:6, cursor:"pointer", fontFamily:"'Cinzel',serif", fontSize:11, letterSpacing:"0.08em", border:`2px solid ${i === appThemeIdx ? t.accent : "rgba(255,255,255,0.1)"}`, background: i === appThemeIdx ? `${t.accentBg}` : "rgba(255,255,255,0.04)", color:t.accent, transition:"all 0.15s" }}>
                  {t.name}
                </button>
              ))}
            </div>

            <hr style={{ border:"none", borderTop:"1px solid rgba(255,255,255,0.07)", margin:"16px 0" }} />

            {/* NAVIGATE */}
            <div style={{ fontSize:10, letterSpacing:"0.15em", color:"#94a3b8", fontFamily:"'Cinzel',serif", marginBottom:10 }}>NAVIGATE</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:4 }}>
              {gameMode === "sweaty" && <button onClick={() => { onNav("history"); onClose(); }} style={{ ...btn(), width:"100%", padding:12, fontSize:13 }}>📜 History</button>}
              {gameMode === "sweaty" && <button onClick={() => { onNav("stats"); onClose(); }} style={{ ...btn(), width:"100%", padding:12, fontSize:13 }}>📊 Stats</button>}
              <button onClick={() => { onNav("roster"); onClose(); }} style={{ ...btn(), width:"100%", padding:12, fontSize:13 }}>👥 Roster & Decks</button>
            </div>

            <hr style={{ border:"none", borderTop:"1px solid rgba(255,255,255,0.07)", margin:"16px 0" }} />

            {!newGamePrompt ? (
              <button onClick={() => setNewGamePrompt(true)} style={{ ...btn("danger"), width:"100%", padding:13, fontSize:13, marginBottom:8 }}>↺ New Game</button>
            ) : (
              <div style={{ border:"1px solid rgba(239,68,68,0.4)", borderRadius:10, padding:12, marginBottom:8 }}>
                <div style={{ fontSize:12, color:"#e2e8f0", fontFamily:"'Cinzel',serif", letterSpacing:"0.06em", marginBottom:10, textAlign:"center" }}>Log this game before starting a new one?</div>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  <button onClick={() => { onFlushEvents(); setSaveThenNew(true); setNewGamePrompt(false); setSaveMode(true); }} style={{ ...btn("primary"), width:"100%", padding:11, fontSize:12 }}>✍ Log Game, then New Game</button>
                  <button onClick={() => { onNewGameNoSave(); onClose(); }} style={{ ...btn("danger"), width:"100%", padding:11, fontSize:12 }}>↺ New Game without logging</button>
                  <button onClick={() => setNewGamePrompt(false)} style={{ ...btn(), width:"100%", padding:10, fontSize:12, color:"#94a3b8" }}>Cancel</button>
                </div>
              </div>
            )}
            <button onClick={onClose} style={{ ...btn(), width:"100%", padding:11, fontSize:12, color:"#94a3b8" }}>Close</button>
            {chooserOpen && <FingerChooser players={players} excludeId={lastWinnerId} onClose={() => setChooserOpen(false)} onChoose={(seatIdx) => { onSetFirstPlayer(seatIdx); setChooserOpen(false); onClose(); }} />}
          </>
        ) : (
          <>
            <div style={{ fontFamily: "'Cinzel',serif", fontSize: 16, color: "var(--accent)", marginBottom: 16 }}>✍ Log Game</div>
            <label style={LABEL}>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...INPUT, marginBottom: 12 }} />
            {seats.map((seat, i) => (
              <div key={i} style={{ ...CARD, borderColor: `${COLORS[i]}33`, padding: 12 }}>
                <div style={{ color: COLORS[i], fontSize: 12, marginBottom: 8, fontFamily:"'Cinzel',serif" }}>{players[i].emoji||"⚔"} {players[i].name}</div>
                <label style={LABEL}>Deck</label>
                <select value={seat.deckId} onChange={e => { const d = decks.find(dk => dk.id === e.target.value); updateSeat(i, "deckId", e.target.value); updateSeat(i, "commander", d ? d.commander : ""); updateSeat(i, "colors", d?.colors || ""); }} style={{ ...INPUT, marginBottom: 6 }}>
                  <option value="">— pick deck —</option>
                  {playerDecks(seat.playerId).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                {seat.deckId && seat.commander
                  ? <div style={{ fontSize:12, color:"#94a3b8", fontFamily:"'Crimson Text',serif", padding:"4px 2px" }}>⚔ {seat.commander}</div>
                  : <><label style={LABEL}>Commander</label><CommanderInput value={seat.commander} onChange={v => { updateSeat(i, "commander", v); updateSeat(i, "colors", ""); }} onPick={name => fetchColorIdentity(name).then(cols => updateSeat(i, "colors", cols)).catch(()=>{})} placeholder="e.g. Atraxa" style={INPUT} /></>
                }
              </div>
            ))}
            <label style={LABEL}>Result</label>
            <select value={winner} onChange={e => { const v = e.target.value; setWinner(v); if (v === "__draw") setDrawIds(seats.map(s => s.playerId)); }} style={{ ...INPUT, marginBottom: 12 }}>
              <option value="">— select result —</option>
              {seats.map((s, i) => <option key={i} value={s.playerId}>👑 {players[i].name}{s.commander ? ` (${s.commander})` : ""}</option>)}
              <option value="__draw">🤝 Draw</option>
              <option value="__nongame">🤷 Non Game</option>
            </select>
            {winner === "__draw" && (
              <div style={{ marginBottom: 12 }}>
                <label style={LABEL}>Who drew?</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {seats.map((s, i) => {
                    const on = drawIds.includes(s.playerId);
                    return (
                      <button key={i} onClick={() => setDrawIds(prev => on ? prev.filter(id => id !== s.playerId) : [...prev, s.playerId])}
                        style={{ padding: "7px 13px", borderRadius: 20, cursor: "pointer", fontFamily: "'Cinzel',serif", fontSize: 12,
                          background: on ? "rgba(148,163,184,0.25)" : "rgba(255,255,255,0.04)",
                          border: on ? "1px solid #94a3b8" : "1px solid rgba(255,255,255,0.1)",
                          color: on ? "#e2e8f0" : "#64748b" }}>
                        {on ? "🤝 " : ""}{players[i].emoji || "⚔"} {players[i].name}
                      </button>
                    );
                  })}
                </div>
                {drawIds.length < 2 && <div style={{ fontSize: 11, color: "#f87171", marginTop: 6, fontFamily: "'Crimson Text',serif" }}>Select at least 2 players who drew.</div>}
              </div>
            )}
            <label style={LABEL}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...INPUT, resize: "vertical", marginBottom: 14 }} />
            {gameStats.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <label style={LABEL}>Game Stats</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {gameStats.map((s, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "7px 12px" }}>
                      <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "'Cinzel',serif", letterSpacing: "0.06em" }}>{s.label}</span>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>{s.value}</span>
                        {s.player && <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 6, fontFamily: "'Crimson Text',serif" }}>{s.player}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={doSave} style={{ ...btn("primary"), flex: 1 }} disabled={!winner || (winner === "__draw" && drawIds.length < 2)}>Save</button>
              <button onClick={() => { setSaveMode(false); setSaveThenNew(false); }} style={{ ...btn(), flex: 1 }}>Back</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Victory Overlay ───────────────────────────────────────────────────────────
function VictoryOverlay({ player, life, color, losers = [], onNewGame, onDismiss }) {
  const confetti = useMemo(() => Array.from({length:55}, (_, i) => ({
    x: 4 + Math.random() * 92,
    w: 5 + Math.random() * 9, h: 3 + Math.random() * 5,
    dur: 2 + Math.random() * 2.5, delay: Math.random() * 2.2,
    col: i % 4 === 0 ? "#fbbf24" : i % 4 === 1 ? (color || "#a78bfa") : i % 4 === 2 ? "#fff" : "#c084fc",
    rot: Math.random() * 360, drift: (Math.random() - 0.5) * 150,
  })), [color]);

  return (
    <div style={{ position:"fixed", inset:0, zIndex:600, display:"flex", alignItems:"center",
      justifyContent:"center", background:"rgba(0,0,0,0.88)", animation:"victoryBgIn 0.4s ease-out" }}
      onClick={onDismiss}>
      {confetti.map((c, i) => (
        <div key={i} style={{ position:"absolute", left:`${c.x}%`, top:"-12px", width:c.w, height:c.h,
          background:c.col, borderRadius:2, opacity:0.88, pointerEvents:"none",
          animation:`confettiFall ${c.dur}s ${c.delay}s ease-in forwards`,
          "--drift":`${c.drift}px`, transform:`rotate(${c.rot}deg)` }} />
      ))}
      <div style={{ position:"absolute", inset:0, pointerEvents:"none",
        background:`radial-gradient(ellipse at center, ${color || "#a78bfa"}1a 0%, transparent 65%)` }} />
      <div style={{ textAlign:"center", zIndex:1, width:"min(420px, 88vw)", padding:"0 clamp(16px,5vw,36px)",
        animation:"victoryCardIn 0.55s 0.15s cubic-bezier(0.34,1.56,0.64,1) both" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:"clamp(22px,5vw,38px)", lineHeight:1, marginBottom:"clamp(4px,1.2vw,8px)",
          filter:"drop-shadow(0 0 10px #fbbf24) drop-shadow(0 0 22px rgba(251,191,36,0.5))",
          animation:"victorycrownBob 2.5s ease-in-out infinite" }}>👑</div>
        <div style={{ fontSize:"clamp(58px,14vw,100px)", lineHeight:1, marginBottom:"clamp(12px,3vw,20px)",
          filter:`drop-shadow(0 0 28px ${color || "#a78bfa"}) drop-shadow(0 0 56px ${color || "#a78bfa"}66)`,
          animation:"victoryEmojiBob 3s ease-in-out infinite" }}>
          {player.emoji || "🐉"}
        </div>
        <div style={{ fontSize:"clamp(9px,2.5vw,13px)", letterSpacing:"0.3em", color:"#fbbf24",
          fontFamily:"'Cinzel',serif", marginBottom:"clamp(4px,1vw,8px)", textTransform:"uppercase" }}>Winner!</div>
        <div style={{ fontSize:"clamp(20px,4.5vw,34px)", fontWeight:700, color:"#fff",
          fontFamily:"'Cinzel',serif", letterSpacing:"0.06em", marginBottom:"clamp(4px,1vw,8px)",
          textShadow:`0 0 30px ${color || "#a78bfa"}88` }}>
          {player.name || "Winner"}
        </div>
        {life != null && (
          <div style={{ fontSize:"clamp(12px,3.2vw,16px)", color:"#4ade80", fontFamily:"'Crimson Text',serif",
            letterSpacing:"0.05em", marginBottom:"clamp(18px,4vw,28px)" }}>♥ {life} remaining</div>
        )}
        {losers.length > 0 && (
          <div style={{ marginBottom:"clamp(18px,4vw,28px)", paddingTop:"clamp(12px,3vw,18px)", borderTop:"1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ fontSize:"clamp(9px,2.5vw,13px)", color:"#475569", fontFamily:"'Crimson Text',serif",
              fontStyle:"italic", marginBottom:"clamp(8px,2vw,12px)", textAlign:"center" }}>
              Nice try, it was close
            </div>
            <div style={{ display:"flex", gap:"clamp(8px,2.5vw,16px)", justifyContent:"center" }}>
              {losers.map((l, i) => (
                <div key={i} style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                  <div style={{ fontSize:"clamp(24px,5.5vw,38px)", lineHeight:1,
                    animation:`loserDizzy ${1.7 + i*0.25}s ${i*0.18}s ease-in-out infinite`,
                    filter:"grayscale(0.4) brightness(0.65)" }}>
                    {l.emoji || "💀"}
                  </div>
                  <span style={{ fontSize:"clamp(8px,2vw,11px)", color:"#64748b", fontFamily:"'Cinzel',serif",
                    letterSpacing:"0.07em", maxWidth:"clamp(44px,12vw,64px)", textAlign:"center",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {l.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ display:"flex", gap:"clamp(6px,2vw,12px)", justifyContent:"center" }}>
          <button onClick={onDismiss}
            style={{ padding:"clamp(8px,2vw,11px) clamp(14px,4vw,22px)", borderRadius:20,
              background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.15)",
              color:"#94a3b8", fontFamily:"'Cinzel',serif",
              fontSize:"clamp(9px,2.5vw,12px)", cursor:"pointer", letterSpacing:"0.08em" }}>View Board</button>
          <button onClick={onNewGame}
            style={{ padding:"clamp(8px,2vw,11px) clamp(18px,5vw,28px)", borderRadius:20,
              background:`linear-gradient(135deg,${color || "#7c3aed"},${color || "#a78bfa"}99)`,
              border:`1px solid ${color || "#a78bfa"}88`, color:"#fff", fontFamily:"'Cinzel',serif",
              fontSize:"clamp(9px,2.5vw,12px)", cursor:"pointer", letterSpacing:"0.08em",
              boxShadow:`0 0 20px ${color || "#a78bfa"}44` }}>↺ New Game</button>
        </div>
      </div>
      <style>{`
        @keyframes victoryBgIn{from{opacity:0}to{opacity:1}}
        @keyframes victoryCardIn{from{opacity:0;transform:scale(0.72) translateY(28px)}to{opacity:1;transform:scale(1) translateY(0)}}
        @keyframes confettiFall{0%{transform:rotate(0deg) translateX(0) translateY(-20px);opacity:1}100%{transform:rotate(540deg) translateX(var(--drift)) translateY(115vh);opacity:0}}
        @keyframes victoryEmojiBob{0%,100%{transform:scale(1) translateY(0)}50%{transform:scale(1.05) translateY(-7px)}}
        @keyframes victorycrownBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
        @keyframes loserDizzy{0%{transform:rotate(-14deg) scale(0.88) translateY(0)}25%{transform:rotate(10deg) scale(0.86) translateY(2px)}50%{transform:rotate(-8deg) scale(0.89) translateY(0)}75%{transform:rotate(12deg) scale(0.86) translateY(2px)}100%{transform:rotate(-14deg) scale(0.88) translateY(0)}}
      `}</style>
    </div>
  );
}

// ── Game Screen ───────────────────────────────────────────────────────────────
function CmdKOOverlay({ attacker, defender, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3200); return () => clearTimeout(t); }, [onDone]);
  return (
    <div onClick={onDone} style={{ position:"fixed", inset:0, zIndex:56, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.72)", animation:"cmdKOBg 0.35s ease-out", cursor:"pointer" }}>
      <div style={{ textAlign:"center", animation:"cmdKOCard 0.45s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <div style={{ fontSize:"clamp(52px,12vw,80px)", lineHeight:1, marginBottom:10, filter:"drop-shadow(0 0 18px rgba(239,68,68,0.9))", animation:"cmdKOSword 0.9s ease-in-out infinite alternate" }}>⚔️</div>
        <div style={{ fontSize:"clamp(13px,3.5vw,18px)", letterSpacing:"0.25em", color:"#f87171", fontFamily:"'Cinzel',serif", marginBottom:8 }}>COMMANDER KO</div>
        <div style={{ fontSize:"clamp(11px,3vw,15px)", color:"#e2e8f0", fontFamily:"'Crimson Text',serif", fontStyle:"italic" }}>
          {attacker?.emoji || "⚔️"} {attacker?.name} slew {defender?.name}
        </div>
        <div style={{ fontSize:10, color:"#475569", fontFamily:"'Cinzel',serif", marginTop:12, letterSpacing:"0.1em" }}>TAP TO DISMISS</div>
      </div>
      <style>{`
        @keyframes cmdKOBg{from{opacity:0}to{opacity:1}}
        @keyframes cmdKOCard{from{opacity:0;transform:scale(0.6) translateY(20px)}to{opacity:1;transform:scale(1) translateY(0)}}
        @keyframes cmdKOSword{from{transform:rotate(-12deg) scale(1)}to{transform:rotate(12deg) scale(1.1)}}
      `}</style>
    </div>
  );
}

function GameScreen({ players, decks, games, onSaveGame, onNav, themes, gifs, playerCount, startingLife, appThemeIdx, setAppThemeIdx, playerColors, setPlayerColors, newGameVersion, onNewGame, gameConfig, pods }) {
  const layout = LAYOUT_CONFIG[playerCount];
  const n = playerCount;
  const emptyCmdGrid = () => Array(n).fill(null).map(()=>Array(n).fill(0));
  const makeSession = () => ({ lifes: Array(n).fill(startingLife), poison: Array(n).fill(0), cmdDmg: emptyCmdGrid(), cmdDmg2: emptyCmdGrid() });
  const initSession = () => { const s = load(STORAGE_KEYS.session); return (s && s.lifes.length === n) ? { ...s, cmdDmg2: s.cmdDmg2?.length === n ? s.cmdDmg2 : emptyCmdGrid() } : makeSession(); };

  const [session, setSessionRaw] = useState(initSession);
  const { lifes, poison, cmdDmg, cmdDmg2 } = session;
  const setSession = (fn) => setSessionRaw(prev => { const next = fn(prev); save(STORAGE_KEYS.session, next); return next; });

  const gameEvents = useRef([]);
  const turnLifeAcc = useRef(Array(6).fill(0));

  const flushTurnLife = () => {
    turnLifeAcc.current.forEach((delta, i) => { if (delta !== 0) gameEvents.current.push({ type: 'life', playerIdx: i, delta, turn: turnCountRef.current }); });
    turnLifeAcc.current = Array(6).fill(0);
  };

  const adjLife = (i, delta) => {
    setSession(s => { const l = [...s.lifes]; l[i] = l[i] + delta; return { ...s, lifes: l }; });
    turnLifeAcc.current[i] += delta;
    if (Math.abs(delta) >= 5) { Sounds.bigLoss(); haptic('heavy'); }
    else if (delta > 0) { Sounds.lifeUp(); haptic('light'); }
    else { Sounds.lifeDown(); haptic('light'); }
  };
  const adjPoison = (i, delta) => setSession(s => { const p = [...s.poison]; p[i] = Math.max(0, p[i] + delta); return { ...s, poison: p }; });
  const adjCmd = (from, to, delta, cmdr = 0) => {
    const key = cmdr === 1 ? "cmdDmg2" : "cmdDmg";
    setSession(s => {
      const c = s[key].map(r=>[...r]);
      const prev = c[from][to];
      c[from][to] = Math.max(0, prev + delta);
      const actual = c[from][to] - prev;
      if (actual !== 0) gameEvents.current.push({ type: 'cmd', from, to, delta: actual, cmdr, turn: turnCountRef.current });
      return { ...s, [key]: c };
    });
  };
  const resetSession = useCallback(() => { setSession(() => makeSession()); gameEvents.current = []; turnLifeAcc.current = Array(6).fill(0); }, [n]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [monarchIdx, setMonarchIdx] = useState(null);
  const [cityBlessing, setCityBlessing] = useState(() => new Set()); // seat indices with City's Blessing (permanent once gained)
  const [partners, setPartners] = useState(() => new Set()); // seat indices running partner commanders (two cmd dmg counters)
  const lifeHistory = useRef([]);
  const [timer, setTimer] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [exploding, setExploding] = useState(false);
  const [deadPlayers, setDeadPlayers] = useState(() => new Set());
  const prevElim = useRef(Array(n).fill(false));
  const [playerOrder, setPlayerOrder] = useState(() => Array.from({length:6},(_,i)=>i));
  const [swapSource, setSwapSource] = useState(null);
  const [showVictory, setShowVictory] = useState(false);
  const [victoryIdx, setVictoryIdx] = useState(null);
  const victoryFiredRef = useRef(false);
  const [milestones, setMilestones] = useState([]);
  const prevLifesRef = useRef(null);
  const [cmdKO, setCmdKO] = useState(null);
  const prevCmdDmgRef = useRef(null);

  const completeSwap = (j) => {
    const i = swapSource; setSwapSource(null);
    if (i === j) return;
    setPlayerOrder(prev => { const next=[...prev]; [next[i],next[j]]=[next[j],next[i]]; return next; });
    setSession(s => {
      const lifes=[...s.lifes], poison=[...s.poison], cmdDmg=s.cmdDmg.map(r=>[...r]), cmdDmg2=(s.cmdDmg2||emptyCmdGrid()).map(r=>[...r]);
      [lifes[i],lifes[j]]=[lifes[j],lifes[i]]; [poison[i],poison[j]]=[poison[j],poison[i]];
      [cmdDmg[i],cmdDmg[j]]=[cmdDmg[j],cmdDmg[i]];
      [cmdDmg2[i],cmdDmg2[j]]=[cmdDmg2[j],cmdDmg2[i]];
      for(let k=0;k<n;k++) { [cmdDmg[k][i],cmdDmg[k][j]]=[cmdDmg[k][j],cmdDmg[k][i]]; [cmdDmg2[k][i],cmdDmg2[k][j]]=[cmdDmg2[k][j],cmdDmg2[k][i]]; }
      return {lifes,poison,cmdDmg,cmdDmg2};
    });
    setDeadPlayers(prev => { const next=new Set(prev), iD=prev.has(i), jD=prev.has(j); iD?next.add(j):next.delete(j); jD?next.add(i):next.delete(i); return next; });
    setCityBlessing(prev => { const next=new Set(prev), iB=prev.has(i), jB=prev.has(j); iB?next.add(j):next.delete(j); jB?next.add(i):next.delete(i); return next; });
    setPartners(prev => { const next=new Set(prev), iP=prev.has(i), jP=prev.has(j); iP?next.add(j):next.delete(j); jP?next.add(i):next.delete(i); return next; });
    setMonarchIdx(prev => prev === i ? j : prev === j ? i : prev);
  };

  const [turnIdx, setTurnIdx] = useState(0);
  const [turnTimer, setTurnTimer] = useState(0);
  const [turnCount, setTurnCount] = useState(1);
  const [turnStarted, setTurnStarted] = useState(false);
  const turnCountRef = useRef(1);
  useEffect(() => { turnCountRef.current = turnCount; }, [turnCount]);
  const turnIdxRef = useRef(0);
  useEffect(() => { turnIdxRef.current = turnIdx; }, [turnIdx]);
  const turnTimerRef = useRef(0);
  useEffect(() => { turnTimerRef.current = turnTimer; }, [turnTimer]);
  const turnStartedRef = useRef(false);
  useEffect(() => { turnStartedRef.current = turnStarted; }, [turnStarted]);
  const lifesRef = useRef(Array(6).fill(startingLife));
  useEffect(() => { lifesRef.current = lifes; }, [lifes]);
  const turnOrder = LAYOUT_CONFIG[n].turnOrder;

  const nextTurn = useCallback((currentDead = deadPlayers) => {
    flushTurnLife();
    if (turnStartedRef.current) {
      gameEvents.current.push({ type: 'turn', playerIdx: turnIdxRef.current, duration: turnTimerRef.current });
      lifeHistory.current.push({ turn: turnCountRef.current, lifes: [...lifesRef.current] });
    }
    setTurnStarted(true);
    setTurnIdx(prev => {
      const pos = turnOrder.indexOf(prev);
      let nextPos = (pos + 1) % turnOrder.length, tries = 0;
      while (currentDead.has(turnOrder[nextPos]) && tries < turnOrder.length) { nextPos = (nextPos + 1) % turnOrder.length; tries++; }
      return turnOrder[nextPos];
    });
    setTurnTimer(0); setTurnCount(c => c + 1);
  }, [n, deadPlayers, turnOrder]);

  useEffect(() => { setTurnTimer(0); if (!turnStarted) return; const t = setInterval(() => setTurnTimer(s => s + 1), 1000); return () => clearInterval(t); }, [turnIdx, turnStarted]);
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    setSession(() => makeSession());
    setDeadPlayers(new Set()); setExploding(false);
    setTurnIdx(gameConfig?.firstSeat ?? 0);
    setTurnTimer(0); setTurnCount(1); setTurnStarted(false);
    setPlayerOrder(gameConfig?.playerOrder ?? Array.from({length:6},(_,i)=>i));
    setSwapSource(null); prevElim.current = Array(n).fill(false);
    setMonarchIdx(null); setCityBlessing(new Set()); setPartners(new Set()); lifeHistory.current = [];
    gameEvents.current = []; turnLifeAcc.current = Array(6).fill(0);
    setShowVictory(false); setVictoryIdx(null); victoryFiredRef.current = false;
    setTimer(0); setTimerRunning(gameConfig?.timerEnabled ?? false);
    turnIdxRef.current = gameConfig?.firstSeat ?? 0;
    turnTimerRef.current = 0; turnStartedRef.current = false;
    turnCountRef.current = 1; lifesRef.current = Array(n).fill(startingLife);
    setMilestones([]); prevLifesRef.current = null; setCmdKO(null); prevCmdDmgRef.current = null;
  }, [n, newGameVersion]);
  useEffect(() => { let t; if (timerRunning) t = setInterval(()=>setTimer(s=>s+1),1000); return ()=>clearInterval(t); }, [timerRunning]);

  const isElim = (i) => (lifes[i] ?? 40) <= 0 || (poison[i] ?? 0) >= 10 || cmdDmg.some((row,fi) => fi!==i && row && row[i]>=21) || (cmdDmg2||[]).some((row,fi) => fi!==i && partners.has(fi) && row && row[i]>=21);

  useEffect(() => {
    const nowElim = Array.from({length: n}, (_,i) => isElim(i));
    const newlyDead = nowElim.map((e,i) => e && !prevElim.current[i]);
    if (newlyDead.some(Boolean)) {
      setExploding(true); Sounds.death(); haptic('heavy');
      setDeadPlayers(prev => {
        const next = new Set(prev);
        newlyDead.forEach((d, i) => { if (d) next.add(i); });
        setTurnIdx(t => {
          if (!newlyDead[t]) return t;
          const pos = turnOrder.indexOf(t);
          let nextPos = (pos + 1) % turnOrder.length, tries = 0;
          while (next.has(turnOrder[nextPos]) && tries < turnOrder.length) { nextPos = (nextPos + 1) % turnOrder.length; tries++; }
          setTurnTimer(0); return turnOrder[nextPos];
        });
        return next;
      });
    }
    prevElim.current = nowElim;
  }, [lifes, poison, cmdDmg, cmdDmg2, partners]);

  // Milestone life notifications
  useEffect(() => {
    const MILESTONES = [
      { at: 20, icon: "⚡", text: "Half life" },
      { at: 10, icon: "💀", text: "Danger zone" },
      { at:  5, icon: "🔥", text: "Final stand" },
    ];
    if (!prevLifesRef.current) { prevLifesRef.current = [...lifes]; return; }
    const newMs = [];
    lifes.slice(0, n).forEach((life, i) => {
      if (deadPlayers.has(i)) { prevLifesRef.current[i] = life; return; }
      const prev = prevLifesRef.current[i] ?? startingLife;
      MILESTONES.forEach(({ at, icon, text }) => {
        if (prev > at && life <= at) newMs.push({ id: uid(), playerIdx: i, icon, text });
      });
      prevLifesRef.current[i] = life;
    });
    if (newMs.length > 0) {
      setMilestones(prev => [...prev, ...newMs]);
      newMs.forEach(m => { setTimeout(() => setMilestones(prev => prev.filter(x => x.id !== m.id)), 2200); });
    }
  }, [lifes]);

  // Commander KO detection — checks both commanders (partners)
  useEffect(() => {
    if (!prevCmdDmgRef.current) { prevCmdDmgRef.current = { a: cmdDmg, b: cmdDmg2 }; return; }
    outer: for (let from = 0; from < n; from++) {
      for (let to = 0; to < n; to++) {
        if (from === to || deadPlayers.has(to)) continue;
        const prevA = prevCmdDmgRef.current.a?.[from]?.[to] ?? 0;
        const currA = cmdDmg[from]?.[to] ?? 0;
        const prevB = prevCmdDmgRef.current.b?.[from]?.[to] ?? 0;
        const currB = partners.has(from) ? (cmdDmg2?.[from]?.[to] ?? 0) : 0;
        if ((currA >= 21 && prevA < 21) || (currB >= 21 && prevB < 21)) {
          const attacker = players[playerOrder[from]] || { name: `P${from+1}` };
          const defender = players[playerOrder[to]]  || { name: `P${to+1}` };
          setCmdKO({ attacker, defender });
          break outer;
        }
      }
    }
    prevCmdDmgRef.current = { a: cmdDmg, b: cmdDmg2 };
  }, [cmdDmg, cmdDmg2]);

  useEffect(() => {
    if (victoryFiredRef.current || n < 2) return;
    const alive = Array.from({length: n}, (_, i) => i).filter(i => !deadPlayers.has(i));
    if (alive.length === 1 && deadPlayers.size >= 1) {
      const t = setTimeout(() => {
        victoryFiredRef.current = true;
        setVictoryIdx(alive[0]); setShowVictory(true);
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [deadPlayers, n]);

  const handleReset = () => { resetSession(); setDeadPlayers(new Set()); setExploding(false); setTurnIdx(0); setTurnTimer(0); setTurnCount(1); setTurnStarted(false); setPlayerOrder(Array.from({length:6},(_,i)=>i)); setSwapSource(null); prevElim.current=Array(n).fill(false); setMonarchIdx(null); setCityBlessing(new Set()); setPartners(new Set()); lifeHistory.current = []; setShowVictory(false); setVictoryIdx(null); victoryFiredRef.current = false; setMenuOpen(false); setMilestones([]); prevLifesRef.current = null; setCmdKO(null); prevCmdDmgRef.current = null; };

  // Surrender — player concedes: same treatment as a KO (explosion, dead tile, turn skips them)
  const surrenderPlayer = (i) => {
    if (deadPlayers.has(i)) return;
    gameEvents.current.push({ type: 'surrender', playerIdx: i, turn: turnCountRef.current });
    prevElim.current[i] = true; // don't double-fire the death effect
    setExploding(true); Sounds.death(); haptic('heavy');
    setDeadPlayers(prev => {
      const next = new Set(prev); next.add(i);
      setTurnIdx(t => {
        if (t !== i) return t;
        const pos = turnOrder.indexOf(t);
        let nextPos = (pos + 1) % turnOrder.length, tries = 0;
        while (next.has(turnOrder[nextPos]) && tries < turnOrder.length) { nextPos = (nextPos + 1) % turnOrder.length; tries++; }
        setTurnTimer(0); return turnOrder[nextPos];
      });
      return next;
    });
  };
  const activePlayers = players.slice(0, n);

  const autoSaveAndNewGame = () => {
    setMenuOpen(false);
    if (gameConfig?.gameMode === "sweaty") {
      flushTurnLife();
      lifeHistory.current.push({ turn: turnCountRef.current, lifes: [...lifes] });
      const aliveSeat = Array.from({length: n}, (_, i) => i).filter(i => !deadPlayers.has(i));
      const winnerSeat = aliveSeat.length === 1 ? aliveSeat[0] : null;
      const _now = new Date();
      const _localDate = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,"0")}-${String(_now.getDate()).padStart(2,"0")}`;
      onSaveGame({
        id: uid(),
        date: _localDate,
        seats: Array.from({length: n}, (_, i) => ({ playerId: (players[playerOrder[i]] || {id:''}).id, deckId: "", commander: "" })),
        winner: winnerSeat !== null ? (players[playerOrder[winnerSeat]] || {id:''}).id : "",
        result: winnerSeat !== null ? "win" : "nongame",
        duration: fmtDur(timer),
        notes: "",
        stats: computeStats(),
        lifeHistory: lifeHistory.current,
        events: [...gameEvents.current],
        finalLifes: lifes.slice(0, n),
        playerOrder: [...playerOrder].slice(0, n),
        createdAt: Date.now(),
        autoSaved: true,
      });
    }
    onNewGame();
  };

  const computeStats = () => {
    const ev = gameEvents.current;
    const pName = (seatIdx) => (players[playerOrder[seatIdx]] || {name:`P${seatIdx+1}`}).name;
    const lifeEv = ev.filter(e => e.type === 'life');
    const stats = [];
    const gains = lifeEv.filter(e => e.delta > 0).sort((a,b) => b.delta - a.delta);
    if (gains.length) stats.push({ label: "Biggest Single HP Gain", value: `+${gains[0].delta}`, player: pName(gains[0].playerIdx) });
    const losses = lifeEv.filter(e => e.delta < 0).sort((a,b) => a.delta - b.delta);
    if (losses.length) stats.push({ label: "Biggest Single HP Loss", value: `${losses[0].delta}`, player: pName(losses[0].playerIdx) });
    const totalGain = {}; lifeEv.filter(e => e.delta > 0).forEach(e => { totalGain[e.playerIdx] = (totalGain[e.playerIdx]||0) + e.delta; });
    const topGainer = Object.entries(totalGain).sort((a,b)=>b[1]-a[1])[0];
    if (topGainer) stats.push({ label: "Most Total HP Gained", value: `+${topGainer[1]}`, player: pName(+topGainer[0]) });
    const totalLoss = {}; lifeEv.filter(e => e.delta < 0).forEach(e => { totalLoss[e.playerIdx] = (totalLoss[e.playerIdx]||0) + Math.abs(e.delta); });
    const topLoser = Object.entries(totalLoss).sort((a,b)=>b[1]-a[1])[0];
    if (topLoser) stats.push({ label: "Most Total HP Lost", value: `-${topLoser[1]}`, player: pName(+topLoser[0]) });
    const adjCount = {}; lifeEv.forEach(e => { adjCount[e.playerIdx] = (adjCount[e.playerIdx]||0) + 1; });
    const mostActive = Object.entries(adjCount).sort((a,b)=>b[1]-a[1])[0];
    if (mostActive) stats.push({ label: "Most Life Changes", value: `${mostActive[1]} times`, player: pName(+mostActive[0]) });
    const cmdDealt = {}; ev.filter(e => e.type === 'cmd').forEach(e => { cmdDealt[e.from] = (cmdDealt[e.from]||0) + e.delta; });
    const topDealer = Object.entries(cmdDealt).sort((a,b)=>b[1]-a[1])[0];
    if (topDealer && topDealer[1] > 0) stats.push({ label: "Most Commander Damage Dealt", value: `${topDealer[1]} dmg`, player: pName(+topDealer[0]) });
    const maxPoison = Math.max(...poison); if (maxPoison > 0) stats.push({ label: "Most Poison Counters", value: `${maxPoison} ☠`, player: pName(poison.indexOf(maxPoison)) });
    const turnEvs = ev.filter(e => e.type === 'turn');
    if (turnEvs.length > 0) {
      const totals = {}, counts = {};
      turnEvs.forEach(e => { totals[e.playerIdx] = (totals[e.playerIdx]||0) + e.duration; counts[e.playerIdx] = (counts[e.playerIdx]||0) + 1; });
      const slowest = Object.entries(totals).map(([idx, total]) => ({ idx: +idx, avg: Math.round(total / counts[idx]) })).sort((a,b) => b.avg - a.avg)[0];
      if (slowest) stats.push({ label: "Longest Avg Turn", value: fmtDur(slowest.avg), player: pName(slowest.idx) });
    }
    if (turnCount > 1) stats.push({ label: "Turns Played", value: `${turnCount - 1}`, player: "" });
    return stats;
  };

  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, gridTemplateRows: `repeat(${layout.rows}, 1fr)`, background: "var(--bg)", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
      <style>{PARTICLE_CSS}</style>
      {Array.from({length: n}, (_,i) => (
        <PlayerTile key={i} idx={i} rot={layout.rotations[i]}
          player={players[playerOrder[i]]||{name:`P${i+1}`}} life={lifes[i]} poison={poison[i]}
          cmdDmg={cmdDmg} players={activePlayers.map((_,si)=>players[playerOrder[si]]||{name:`P${si+1}`})} onLifeAdj={adjLife}
          onAdjPoison={adjPoison} onAdjCmd={adjCmd}
          isDead={deadPlayers.has(i)} theme={themes[playerOrder[i]]} gif={gifs[playerOrder[i]]}
          isMonarch={monarchIdx === i} onClaimMonarch={(si) => setMonarchIdx(prev => prev === si ? null : si)}
          hasBlessing={cityBlessing.has(i)} onToggleBlessing={(si) => setCityBlessing(prev => { const next = new Set(prev); next.has(si) ? next.delete(si) : next.add(si); return next; })}
          onSurrender={surrenderPlayer}
          cmdDmg2={cmdDmg2} partnerSeats={partners} onTogglePartners={(si) => setPartners(prev => { const next = new Set(prev); next.has(si) ? next.delete(si) : next.add(si); return next; })}
          customColor={playerColors?.[playerOrder[i]] || null}
          onSetColor={(seatIdx, c) => { setPlayerColors(prev => { const next=[...prev]; next[playerOrder[seatIdx]]=c; return next; }); }}
          isActiveTurn={turnIdx === i && !deadPlayers.has(i)}
          turnTimer={turnTimer} turnTimerEnabled={timerRunning}
          onNextTurn={nextTurn} turnCount={turnCount}
          swapSource={swapSource} onSwapStart={setSwapSource} onSwapComplete={completeSwap}
          milestone={milestones.find(m => m.playerIdx === i) || null}
          overlayOpen={menuOpen || showVictory} />
      ))}
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 20 }}>
        <button onClick={() => setMenuOpen(true)} style={{ width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg,var(--grad-start),var(--grad-end))", border: "2px solid var(--accent-dim)", color: "#e2e8f0", fontSize: 18, cursor: "pointer", boxShadow: "0 0 16px var(--glow)", display: "flex", alignItems: "center", justifyContent: "center" }}>☰</button>
      </div>
      {exploding && <ExplosionOverlay onDone={() => setExploding(false)} />}
      {cmdKO && <CmdKOOverlay attacker={cmdKO.attacker} defender={cmdKO.defender} onDone={() => setCmdKO(null)} />}
      {showVictory && victoryIdx !== null && (
        <VictoryOverlay
          player={players[playerOrder[victoryIdx]] || {name:`P${victoryIdx+1}`, emoji: DEFAULT_EMOJI[victoryIdx % DEFAULT_EMOJI.length]}}
          life={lifes[victoryIdx]}
          color={playerColors?.[playerOrder[victoryIdx]] || COLORS[victoryIdx % COLORS.length]}
          losers={Array.from({length: n}, (_, i) => i).filter(i => i !== victoryIdx).map(i => ({
            emoji: (players[playerOrder[i]] || {}).emoji || DEFAULT_EMOJI[i % DEFAULT_EMOJI.length],
            name: (players[playerOrder[i]] || {}).name || `P${i+1}`,
          }))}
          onNewGame={() => { setShowVictory(false); autoSaveAndNewGame(); }}
          onDismiss={() => setShowVictory(false)} />
      )}
      {menuOpen && <CenterMenu onClose={() => setMenuOpen(false)} onNav={onNav} onNewGame={autoSaveAndNewGame} onNewGameNoSave={onNewGame} timer={timer} timerRunning={timerRunning} onTimerToggle={() => setTimerRunning(r=>!r)} onTimerReset={() => { setTimer(0); setTimerRunning(false); }} players={activePlayers} decks={decks} onSaveGame={onSaveGame} appThemeIdx={appThemeIdx} setAppThemeIdx={setAppThemeIdx} computeStats={computeStats} onFlushEvents={flushTurnLife} onSetFirstPlayer={(seatIdx) => { setTurnIdx(seatIdx); setTurnTimer(0); setTurnStarted(false); }} monarchIdx={monarchIdx} onClaimMonarch={(i) => setMonarchIdx(prev => prev === i ? null : i)} lifeHistorySnap={lifeHistory.current} eventsSnap={gameEvents.current} finalLifesSnap={lifes.slice(0, n)} playerOrderSnap={playerOrder.slice(0, n)} gameMode={gameConfig?.gameMode ?? "casual"} podName={(pods||[]).find(p=>p.id===gameConfig?.podId)?.name || null} lastWinnerId={[...(games||[])].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0]?.winner || null} />}
    </div>
  );
}

// ── Life Graph ────────────────────────────────────────────────────────────────
function LifeGraph({ lifeHistory, playerCount, playerNames }) {
  if (!lifeHistory || lifeHistory.length < 2) return null;
  const W = 320, H = 120, PAD = 16;
  const turns = lifeHistory.length;
  const allVals = lifeHistory.flatMap(s => s.lifes.slice(0, playerCount));
  const maxLife = Math.max(40, ...allVals);
  const minLife = Math.min(0, ...allVals);
  const range = maxLife - minLife || 1;
  const toX = (i) => PAD + (i / (turns - 1)) * (W - PAD * 2);
  const toY = (v) => H - PAD - ((v - minLife) / range) * (H - PAD * 2);
  return (
    <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 10 }}>
      <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "'Cinzel',serif", letterSpacing: "0.1em", marginBottom: 6 }}>LIFE GRAPH</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
        {[maxLife, Math.round(maxLife / 2), 0].map(v => (
          <g key={v}>
            <line x1={PAD} y1={toY(v)} x2={W - PAD} y2={toY(v)} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
            <text x={PAD - 2} y={toY(v) + 3} fontSize="7" fill="#94a3b8" textAnchor="end">{v}</text>
          </g>
        ))}
        {Array.from({ length: playerCount }, (_, pi) => {
          const points = lifeHistory.map((snap, i) => `${toX(i)},${toY(snap.lifes[pi] ?? 0)}`).join(" ");
          return (
            <g key={pi}>
              <polyline points={points} fill="none" stroke={COLORS[pi]} strokeWidth="2" strokeLinejoin="round" opacity="0.85" />
              {lifeHistory.map((snap, i) => (
                <circle key={i} cx={toX(i)} cy={toY(snap.lifes[pi] ?? 0)} r="2.5" fill={COLORS[pi]} opacity="0.9" />
              ))}
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
        {Array.from({ length: playerCount }, (_, pi) => (
          <div key={pi} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: COLORS[pi] }} />
            <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "'Crimson Text',serif" }}>{playerNames?.[pi] || `P${pi+1}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── History ───────────────────────────────────────────────────────────────────
function History({ games, players, decks, pods, onDelete, onBack, onImport }) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const importRef = useRef(null);
  const pName  = (id) => players.find(p => p.id === id)?.name  || "?";
  const pEmoji = (id) => players.find(p => p.id === id)?.emoji || "🐉";

  const filtered = games.filter(g => {
    const q = search.toLowerCase();
    return !q || g.seats?.some(s => pName(s.playerId).toLowerCase().includes(q) || s.commander?.toLowerCase().includes(q)) || pName(g.winner).toLowerCase().includes(q);
  }).sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));

  const handleExport = () => {
    const payload = JSON.stringify({ battleBeeExport: true, exportedAt: new Date().toISOString(), games }, null, 2);
    shareText(payload, "Battle Bee Export");
  };

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const incoming = data.battleBeeExport ? data.games : (Array.isArray(data) ? data : []);
        if (incoming.length) onImport(incoming);
      } catch(err) { alert("Could not read file."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Find pod whose member set exactly matches the game's seats
  const podForGame = (g) => {
    if (!pods?.length || !g.seats?.length) return null;
    const ids = new Set(g.seats.map(s => s.playerId));
    return pods.find(pod => pod.memberIds?.length === g.seats.length && pod.memberIds.every(id => ids.has(id))) || null;
  };

  // Reconstruct total commander damage per attacker→defender pair from events
  const cmdPairsForGame = (g) => {
    if (!g.events?.length) return [];
    const acc = {};
    g.events.filter(e => e.type === 'cmd').forEach(e => {
      const k = `${e.from}-${e.to}`;
      acc[k] = (acc[k] || 0) + e.delta;
    });
    return Object.entries(acc)
      .map(([k, total]) => { const [from, to] = k.split('-').map(Number); return { from, to, total }; })
      .filter(p => p.total > 0)
      .sort((a, b) => b.total - a.total);
  };

  return (
    <div style={{ height:"100vh", overflowY:"auto", WebkitOverflowScrolling:"touch", background:"var(--bg)", color:"#e2e8f0", fontFamily:"'Cinzel',serif" }}>
      <div style={{ maxWidth:700, margin:"0 auto", padding:"calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 64px)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:20, flexWrap:"wrap" }}>
          <button onClick={onBack} style={{ ...btn(), padding:"8px 14px" }}>← Back</button>
          <h2 style={{ margin:0, fontSize:20, flex:1, background:"linear-gradient(135deg,var(--accent),var(--grad-end))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>History</h2>
          <button onClick={() => importRef.current?.click()} style={{ ...btn(), padding:"6px 12px", fontSize:11 }}>⬇ Import</button>
          {games.length > 0 && <button onClick={handleExport} style={{ ...btn("primary"), padding:"6px 12px", fontSize:11 }}>⬆ Export</button>}
          <input ref={importRef} type="file" accept=".json" onChange={handleImportFile} style={{ display:"none" }} />
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search player, commander…" style={{ ...INPUT, marginBottom:20 }} />
        {filtered.length === 0 && <div style={{ textAlign:"center", color:"#94a3b8", padding:60, fontFamily:"'Crimson Text',serif" }}>No games yet.</div>}
        {filtered.map(g => {
          const winner = players.find(p => p.id === g.winner);
          const winnerSeat    = g.seats?.find(s => s.playerId === g.winner);
          const winnerSeatIdx = g.seats?.findIndex(s => s.playerId === g.winner);
          const winnerLife    = winnerSeatIdx >= 0 ? g.finalLifes?.[winnerSeatIdx] : undefined;
          const pod      = podForGame(g);
          const cmdPairs = cmdPairsForGame(g);
          const isExpanded = expandedId === g.id;

          return (
            <div key={g.id} style={{ ...CARD, padding:0, overflow:"hidden", marginBottom:12, cursor:"pointer" }}
              onClick={() => setExpandedId(isExpanded ? null : g.id)}>

              {/* ── Always-visible header ── */}
              <div style={{ padding:"14px 16px 10px" }}>
                {/* Meta row: date · duration · badges */}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                    <span style={{ fontSize:11, color:"#94a3b8", fontFamily:"'Crimson Text',serif" }}>{g.date ? fmt(g.date) : "—"}</span>
                    {g.duration && <span style={{ fontSize:11, color:"#64748b", fontFamily:"'Crimson Text',serif" }}>· {g.duration}</span>}
                    {g.autoSaved && <span style={{ fontSize:9, color:"#64748b", letterSpacing:"0.06em", padding:"2px 6px", borderRadius:10, background:"rgba(100,116,139,0.15)", border:"1px solid rgba(100,116,139,0.2)" }}>AUTO</span>}
                    {pod && <span style={{ fontSize:9, color:"var(--accent)", letterSpacing:"0.06em", padding:"2px 6px", borderRadius:10, background:"rgba(192,132,252,0.12)", border:"1px solid rgba(192,132,252,0.3)" }}>⬡ {pod.name}</span>}
                  </div>
                  <div style={{ display:"flex", gap:6 }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => shareText(gameShareText(g, pName, { pEmoji, pod }), "Battle Bee Result")} style={{ ...btn(), padding:"4px 10px", fontSize:11 }}>⬆</button>
                    <button onClick={() => onDelete(g.id)} style={{ ...btn("danger"), padding:"4px 10px", fontSize:11 }}>✕</button>
                  </div>
                </div>

                {/* Winner / result hero row */}
                {g.result === "draw" || g.result === "nongame" ? (
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                    <span style={{ fontSize:26, lineHeight:1 }}>{g.result === "draw" ? "🤝" : "🤷"}</span>
                    <div>
                      <span style={{ fontSize:16, fontWeight:700, color: g.result === "draw" ? "#94a3b8" : "#64748b", letterSpacing:"0.06em" }}>{g.result === "draw" ? "DRAW" : "NON GAME"}</span>
                      {g.result === "draw" && g.drawPlayerIds?.length > 0 && (
                        <div style={{ fontSize:12, color:"#94a3b8", fontFamily:"'Crimson Text',serif", marginTop:1 }}>{g.drawPlayerIds.map(id => pName(id)).join(", ")}</div>
                      )}
                    </div>
                  </div>
                ) : (
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                  <span style={{ fontSize:26, lineHeight:1 }}>{winner?.emoji || "🐉"}</span>
                  <div>
                    <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                      <span style={{ fontSize:16, fontWeight:700, color:"#fbbf24", letterSpacing:"0.04em" }}>👑 {winner?.name || "?"}</span>
                      {winnerLife != null && <span style={{ fontSize:13, color:"#4ade80", fontFamily:"'Crimson Text',serif" }}>♥{winnerLife}</span>}
                    </div>
                    {winnerSeat?.commander && <div style={{ fontSize:12, color:"#94a3b8", fontFamily:"'Crimson Text',serif", marginTop:1 }}>{winnerSeat.commander}</div>}
                  </div>
                </div>
                )}

                {/* Player pills */}
                <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                  {g.seats?.map((s, i) => {
                    const isW  = s.playerId === g.winner;
                    const life = g.finalLifes?.[i];
                    return (
                      <div key={i} style={{ display:"flex", alignItems:"center", gap:4, padding:"3px 8px", borderRadius:20,
                        background: isW ? "rgba(251,191,36,0.08)" : "rgba(255,255,255,0.04)",
                        border:`1px solid ${isW ? "rgba(251,191,36,0.28)" : "rgba(255,255,255,0.07)"}` }}>
                        <span style={{ fontSize:12, color:COLORS[i % COLORS.length] }}>{pEmoji(s.playerId)} {pName(s.playerId)}</span>
                        {life != null && <span style={{ fontSize:11, color:"#64748b", fontFamily:"'Crimson Text',serif" }}>·{life}</span>}
                        {s.commander && <span style={{ fontSize:10, color:"#4a5568", fontFamily:"'Crimson Text',serif" }}>· {s.commander}</span>}
                      </div>
                    );
                  })}
                </div>

                {/* Expand chevron */}
                <div style={{ textAlign:"center", marginTop:8, color:"#334155", fontSize:10, letterSpacing:"0.1em" }}>
                  {isExpanded ? "▲" : "▼"}
                </div>
              </div>

              {/* ── Expanded detail ── */}
              {isExpanded && (
                <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)", padding:"14px 16px" }}
                  onClick={e => e.stopPropagation()}>

                  {/* Commander damage */}
                  {cmdPairs.length > 0 && (
                    <div style={{ marginBottom:14 }}>
                      <div style={{ fontSize:10, color:"#64748b", letterSpacing:"0.12em", marginBottom:8, fontFamily:"'Cinzel',serif" }}>⚔ COMMANDER DAMAGE</div>
                      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        {cmdPairs.map(({ from, to, total }, i) => {
                          const fromSeat = g.seats?.[from];
                          const toSeat   = g.seats?.[to];
                          const isLethal = total >= 21;
                          return (
                            <div key={i} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 10px", borderRadius:8,
                              background: isLethal ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.03)",
                              border:`1px solid ${isLethal ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.06)"}` }}>
                              <span style={{ fontSize:12, color:COLORS[from % COLORS.length] }}>
                                {pEmoji(fromSeat?.playerId)} {pName(fromSeat?.playerId)}
                              </span>
                              <span style={{ fontSize:10, color:"#334155" }}>→</span>
                              <span style={{ fontSize:12, color:COLORS[to % COLORS.length] }}>
                                {pEmoji(toSeat?.playerId)} {pName(toSeat?.playerId)}
                              </span>
                              <span style={{ marginLeft:"auto", fontSize:14, fontWeight:700, fontFamily:"'Crimson Text',serif",
                                color: isLethal ? "#f87171" : "#94a3b8" }}>
                                {total}{isLethal ? " ☠" : ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Stats highlights */}
                  {g.stats?.length > 0 && (
                    <div style={{ marginBottom:14 }}>
                      <div style={{ fontSize:10, color:"#64748b", letterSpacing:"0.12em", marginBottom:8, fontFamily:"'Cinzel',serif" }}>📊 HIGHLIGHTS</div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px 16px" }}>
                        {g.stats.map((s, i) => (
                          <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                            <span style={{ fontSize:9.5, color:"#64748b", fontFamily:"'Cinzel',serif", letterSpacing:"0.04em" }}>{s.label}</span>
                            <span style={{ fontSize:11, color:"#94a3b8", fontFamily:"'Crimson Text',serif" }}>{s.value}{s.player ? ` · ${s.player}` : ""}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  {g.notes && (
                    <div style={{ marginBottom:14, padding:"10px 12px", borderRadius:8,
                      background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)",
                      fontSize:13, color:"#94a3b8", fontStyle:"italic", fontFamily:"'Crimson Text',serif" }}>
                      "{g.notes}"
                    </div>
                  )}

                  {/* Life graph */}
                  {g.lifeHistory?.length >= 2 && (
                    <LifeGraph lifeHistory={g.lifeHistory} playerCount={g.seats?.length || 4} playerNames={g.seats?.map(s => pName(s.playerId))} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function Stats({ games, players, decks, pods, onBack }) {
  const [filter, setFilter] = useState("all");
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const pName = (id) => players.find(p => p.id === id)?.name || "?";

  // Non-games are excluded from all stats; draws count as games played with no winner
  const statGames = games.filter(g => g.result !== "nongame");
  const filtered = filter === "recent"
    ? [...statGames].sort((a,b) => b.createdAt - a.createdAt).slice(0, 10)
    : statGames;

  // Parse "Xm Ys" duration string back to seconds
  const parseDur = (s) => {
    if (!s) return 0;
    const m = s.match(/(\d+)m\s*(\d+)s/);
    return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0;
  };

  // Summary
  const durations = filtered.map(g => parseDur(g.duration)).filter(Boolean);
  const avgDurSec = durations.length ? Math.round(durations.reduce((a,b)=>a+b,0)/durations.length) : 0;

  // Player leaderboard with streak + avg win life
  const playerStats = players.map(p => {
    const played = filtered.filter(g => g.seats?.some(s => s.playerId === p.id));
    const wins = filtered.filter(g => g.winner === p.id);
    const rate = played.length ? Math.round((wins.length / played.length) * 100) : 0;
    const cmds = {};
    played.forEach(g => { const s = g.seats?.find(s => s.playerId === p.id); if (s?.commander) cmds[s.commander] = (cmds[s.commander] || 0) + 1; });
    const fav = Object.entries(cmds).sort((a,b) => b[1]-a[1])[0]?.[0] || "—";
    // Current win streak (across ALL games, not just filtered)
    const chrono = [...games].filter(g => g.seats?.some(s => s.playerId === p.id)).sort((a,b) => a.createdAt - b.createdAt);
    let streak = 0;
    for (let i = chrono.length - 1; i >= 0; i--) { if (chrono[i].winner === p.id) streak++; else break; }
    // Avg final life when winning
    const winLifes = wins.map(g => { const si = g.seats?.findIndex(s => s.playerId === p.id); return (si >= 0 && g.finalLifes?.[si] != null) ? g.finalLifes[si] : null; }).filter(v => v != null);
    const avgWinLife = winLifes.length ? Math.round(winLifes.reduce((a,b)=>a+b,0)/winLifes.length) : null;
    let turnTotal = 0, turnEvCount = 0;
    played.forEach(g => {
      (g.events || []).filter(e => e.type === 'turn').forEach(e => {
        const pid = players[g.playerOrder?.[e.playerIdx]]?.id;
        if (pid === p.id && e.duration > 0) { turnTotal += e.duration; turnEvCount++; }
      });
    });
    const avgTurnSec = turnEvCount > 0 ? Math.round(turnTotal / turnEvCount) : null;
    return { ...p, played: played.length, wins: wins.length, rate, fav, streak, avgWinLife, avgTurnSec };
  }).filter(p => p.played > 0).sort((a,b) => b.wins - a.wins || b.rate - a.rate);

  const turnRanking = playerStats.filter(p => p.avgTurnSec != null).sort((a, b) => b.avgTurnSec - a.avgTurnSec);

  // Commander performance
  const cmdMap = {};
  filtered.forEach(g => {
    g.seats?.forEach(s => {
      if (!s.commander) return;
      if (!cmdMap[s.commander]) cmdMap[s.commander] = { name: s.commander, played: 0, wins: 0, pilotIds: new Set() };
      cmdMap[s.commander].played++;
      cmdMap[s.commander].pilotIds.add(s.playerId);
      if (g.winner === s.playerId) cmdMap[s.commander].wins++;
    });
  });
  const commanders = Object.values(cmdMap)
    .map(c => ({ ...c, rate: Math.round((c.wins / c.played) * 100), pilots: [...c.pilotIds].map(pName).join(", ") }))
    .sort((a,b) => b.wins - a.wins || b.rate - a.rate);

  // Deck performance
  const topDecks = decks.map(d => {
    const played = filtered.filter(g => g.seats?.some(s => s.deckId === d.id));
    const wins = filtered.filter(g => { const s = g.seats?.find(s => s.deckId === d.id); return s && g.winner === s.playerId; });
    return { ...d, played: played.length, wins: wins.length, rate: played.length ? Math.round((wins.length/played.length)*100) : 0 };
  }).filter(d => d.played > 0).sort((a,b) => b.wins - a.wins);

  // Pod performance
  const podStats = (pods || []).map(pod => {
    const podGames = filtered.filter(g => {
      const ids = new Set(g.seats?.map(s => s.playerId) || []);
      return pod.memberIds.length === ids.size && pod.memberIds.every(id => ids.has(id));
    });
    const winCounts = {};
    podGames.forEach(g => { if (g.winner) winCounts[g.winner] = (winCounts[g.winner] || 0) + 1; });
    const top = Object.entries(winCounts).sort((a,b) => b[1]-a[1])[0];
    const memberTurnTimes = {};
    pod.memberIds.forEach(memberId => {
      let total = 0, count = 0;
      podGames.forEach(g => {
        (g.events || []).filter(e => e.type === 'turn').forEach(e => {
          const pid = players[g.playerOrder?.[e.playerIdx]]?.id;
          if (pid === memberId && e.duration > 0) { total += e.duration; count++; }
        });
      });
      if (count > 0) memberTurnTimes[memberId] = Math.round(total / count);
    });
    return { ...pod, games: podGames.length, topWinner: top ? pName(top[0]) : null, topWins: top?.[1], memberTurnTimes };
  }).filter(p => p.games > 0);

  // All-time records from saved per-game stat arrays — keep best value per label
  const statSortKey = (label, value) => {
    if (label === "Longest Avg Turn") return parseDur(value);
    return parseFloat(String(value).replace(/[^0-9.]/g, "")) || 0;
  };
  const recordMap = {};
  filtered.forEach(g => {
    (g.stats || []).forEach(s => {
      const incoming = statSortKey(s.label, s.value);
      const existing = recordMap[s.label] ? statSortKey(s.label, recordMap[s.label].value) : -1;
      if (incoming > existing) recordMap[s.label] = { ...s, date: fmt(g.date) };
    });
  });
  const records = Object.values(recordMap);

  // Longest game ever
  const longestGame = filtered.reduce((best, g) => {
    return parseDur(g.duration) > parseDur(best?.duration) ? g : best;
  }, null);

  // Biggest life swing: lowest dip followed by highest recovery in the same game
  let biggestSwing = null;
  filtered.forEach(g => {
    if (!g.lifeHistory?.length || g.lifeHistory.length < 2) return;
    (g.seats || []).forEach((s, si) => {
      const lifes = g.lifeHistory.map(snap => snap.lifes?.[si]).filter(v => v != null);
      if (lifes.length < 2) return;
      let minSoFar = lifes[0], maxAfterMin = lifes[0], maxSwing = 0;
      for (let j = 1; j < lifes.length; j++) {
        if (lifes[j] < minSoFar) { minSoFar = lifes[j]; maxAfterMin = lifes[j]; }
        else { maxAfterMin = Math.max(maxAfterMin, lifes[j]); maxSwing = Math.max(maxSwing, maxAfterMin - minSoFar); }
      }
      if (maxSwing > 0 && (!biggestSwing || maxSwing > biggestSwing.swing)) {
        biggestSwing = { player: pName(s.playerId), swing: maxSwing, date: fmt(g.date) };
      }
    });
  });

  // Most comebacks: went ≤10 life but won
  const comebackCounts = {};
  filtered.forEach(g => {
    if (!g.lifeHistory?.length) return;
    (g.seats || []).forEach((s, si) => {
      const lifes = g.lifeHistory.map(snap => snap.lifes?.[si]).filter(v => v != null);
      if (lifes.some(l => l <= 10) && g.winner === s.playerId) {
        comebackCounts[s.playerId] = (comebackCounts[s.playerId] || 0) + 1;
      }
    });
  });
  const topComebackEntry = Object.entries(comebackCounts).sort((a,b) => b[1]-a[1])[0];
  const mostComebacks = topComebackEntry ? { player: pName(topComebackEntry[0]), count: topComebackEntry[1] } : null;

  const buildStatsShareText = () => {
    const lines = [`⚔️  BATTLE BEE  ·  STANDINGS`, ""];
    lines.push(HR);
    playerStats.forEach((p, i) => {
      const rank = i === 0 ? "👑" : `#${i + 1}`;
      const streak = p.streak >= 2 ? `  🔥${p.streak}` : "";
      const avgLife = p.avgWinLife != null ? `  ♥${p.avgWinLife} avg` : "";
      lines.push(`${rank}  ${p.name}  ·  ${p.wins}W / ${p.played}G  ${p.rate}%${streak}${avgLife}`);
      if (p.fav !== "—") lines.push(`    └  ${p.fav}`);
    });
    lines.push(HR);
    if (commanders.length > 0) {
      lines.push("", "🏆  TOP COMMANDERS");
      commanders.slice(0, 5).forEach(c => {
        lines.push(`  ·  ${c.name}  ·  ${c.wins}W / ${c.played}G  ${c.rate}%  (${c.pilots})`);
      });
    }
    if (podStats.length > 0) {
      lines.push("", "⬡  PODS");
      podStats.forEach(pod => {
        const lead = pod.topWinner ? `  ·  ${pod.topWinner} leads (${pod.topWins}W)` : "";
        lines.push(`  ·  ${pod.name}  ·  ${pod.games} game${pod.games !== 1 ? "s" : ""}${lead}`);
        const turnEntries = Object.entries(pod.memberTurnTimes).sort((a, b) => b[1] - a[1]);
        turnEntries.forEach(([id, sec], i) => {
          const tag = i === 0 ? " 🐢" : i === turnEntries.length - 1 ? " ⚡" : "";
          lines.push(`       ${pName(id)}: avg ${fmtDur(sec)}/turn${tag}`);
        });
      });
    }
    if (records.length > 0) {
      lines.push("", "📊  ALL-TIME RECORDS");
      records.forEach(r => {
        const icon = STAT_ICONS[r.label] || "·";
        lines.push(`${icon}  ${r.label}: ${r.value}${r.player ? `  ·  ${r.player}` : ""}  (${r.date})`);
      });
    }
    if (turnRanking.length > 0) {
      lines.push("", "⏱️  TURN TIMES");
      turnRanking.forEach((p, i) => {
        const tag = i === 0 ? "  🐢" : i === turnRanking.length - 1 ? "  ⚡" : "";
        lines.push(`  ·  ${p.name}  ·  avg ${fmtDur(p.avgTurnSec)}/turn${tag}`);
      });
    }
    const footer = `${filtered.length} game${filtered.length !== 1 ? "s" : ""}${avgDurSec > 0 ? `  ·  avg ${fmtDur(avgDurSec)}` : ""}`;
    lines.push("", HR, footer, HR);
    return lines.join("\n");
  };

  const SectionLabel = ({ children, mt }) => (
    <div style={{ fontSize:11, letterSpacing:"0.15em", color:"#94a3b8", marginBottom:10, marginTop: mt || 0, fontFamily:"'Cinzel',serif" }}>{children}</div>
  );
  const StatPill = ({ label, value, color }) => (
    <div style={{ textAlign:"center" }}>
      <div style={{ fontSize:22, fontWeight:700, color: color || "#c084fc" }}>{value}</div>
      <div style={{ fontSize:9, color:"#94a3b8", letterSpacing:"0.1em" }}>{label}</div>
    </div>
  );

  // ── Player Profile view ────────────────────────────────────────────────────
  if (selectedPlayerId) {
    const pData = playerStats.find(p => p.id === selectedPlayerId);
    if (!pData) return null;

    const pGames = [...statGames]
      .filter(g => g.seats?.some(s => s.playerId === selectedPlayerId))
      .sort((a,b) => (b.createdAt||0) - (a.createdAt||0));

    const pCmds = {};
    pGames.forEach(g => {
      const s = g.seats?.find(s => s.playerId === selectedPlayerId);
      if (!s?.commander) return;
      if (!pCmds[s.commander]) pCmds[s.commander] = { played:0, wins:0 };
      pCmds[s.commander].played++;
      if (g.winner === selectedPlayerId) pCmds[s.commander].wins++;
    });
    const pCmdList = Object.entries(pCmds)
      .map(([name,d]) => ({ name, ...d, rate: Math.round((d.wins/d.played)*100) }))
      .sort((a,b) => b.wins - a.wins || b.rate - a.rate);

    let pBigGain = null, pBigLoss = null, pPersonalSwing = null;
    const pComebackCount = comebackCounts[selectedPlayerId] || 0;
    pGames.forEach(g => {
      const si = g.seats?.findIndex(s => s.playerId === selectedPlayerId);
      if (si < 0) return;
      (g.events||[]).filter(e => e.type==='life' && e.playerIdx===si).forEach(e => {
        if (e.delta > 0 && (!pBigGain || e.delta > pBigGain.delta)) pBigGain = { delta:e.delta, date:fmt(g.date) };
        if (e.delta < 0 && (!pBigLoss || e.delta < pBigLoss.delta)) pBigLoss = { delta:e.delta, date:fmt(g.date) };
      });
      if (g.lifeHistory?.length >= 2) {
        const lifes = g.lifeHistory.map(snap => snap.lifes?.[si]).filter(v => v != null);
        let minSoFar = lifes[0], maxAfterMin = lifes[0], maxSwing = 0;
        for (let j=1; j<lifes.length; j++) {
          if (lifes[j] < minSoFar) { minSoFar=lifes[j]; maxAfterMin=lifes[j]; }
          else { maxAfterMin=Math.max(maxAfterMin,lifes[j]); maxSwing=Math.max(maxSwing,maxAfterMin-minSoFar); }
        }
        if (!pPersonalSwing || maxSwing > pPersonalSwing.swing) pPersonalSwing = { swing:maxSwing, date:fmt(g.date) };
      }
    });

    const playerObj = players.find(p => p.id === selectedPlayerId);
    const pEmoji = playerObj?.emoji || DEFAULT_EMOJI[0];
    const pColorIdx = players.findIndex(p => p.id === selectedPlayerId);
    const pColor = COLORS[pColorIdx % COLORS.length] || COLORS[0];

    const hasPersonalRecords = pBigGain || pBigLoss || (pPersonalSwing?.swing > 0) || pComebackCount > 0;

    return (
      <div style={{ height:"100vh", overflowY:"auto", WebkitOverflowScrolling:"touch", background:"var(--bg)", color:"#e2e8f0", fontFamily:"'Cinzel',serif", animation:"screenFadeIn 220ms ease-out" }}>
        <div style={{ maxWidth:500, margin:"0 auto", padding:"calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 64px)" }}>

          {/* Header */}
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:24 }}>
            <button onClick={() => setSelectedPlayerId(null)} style={{ ...btn(), padding:"8px 14px" }}>← Back</button>
            <span style={{ fontSize:26, lineHeight:1 }}>{pEmoji}</span>
            <h2 style={{ margin:0, fontSize:20, flex:1, color: pColor }}>{pData.name}</h2>
            {pData.streak >= 2 && <span style={{ fontSize:13, color:"#f59e0b" }}>🔥{pData.streak}</span>}
          </div>

          {/* Stats overview */}
          <div style={{ ...CARD, display:"flex", gap:20, flexWrap:"wrap", marginBottom:8 }}>
            <StatPill label="WINS" value={pData.wins} color="#34d399" />
            <StatPill label="GAMES" value={pData.played} color="#94a3b8" />
            <StatPill label="WIN %" value={`${pData.rate}%`} color="#c084fc" />
            {pData.avgWinLife != null && <StatPill label="AVG WIN LIFE" value={`♥${pData.avgWinLife}`} color="#f87171" />}
            {pData.avgTurnSec && <StatPill label="AVG TURN" value={fmtDur(pData.avgTurnSec)} color="#60a5fa" />}
          </div>
          <div style={{ height:3, background:"rgba(255,255,255,0.06)", borderRadius:3, marginBottom:20 }}>
            <div style={{ width:`${pData.rate}%`, height:"100%", background:`linear-gradient(90deg,${pColor},#be185d)`, borderRadius:3, transition:"width 0.5s" }} />
          </div>

          {/* Personal records */}
          {hasPersonalRecords && <>
            <SectionLabel mt={0}>PERSONAL RECORDS</SectionLabel>
            <div style={{ ...CARD, marginBottom:20 }}>
              {[
                pBigGain && { icon:"💚", label:"Biggest Heal", value:`+${pBigGain.delta}`, sub:pBigGain.date },
                pBigLoss && { icon:"💔", label:"Biggest Loss", value:`${pBigLoss.delta}`, sub:pBigLoss.date },
                pPersonalSwing?.swing > 0 && { icon:"⚡", label:"Biggest Swing", value:`+${pPersonalSwing.swing}`, sub:pPersonalSwing.date },
                pComebackCount > 0 && { icon:"🔄", label:"Comebacks", value:`${pComebackCount}`, sub:"won from ≤10 life" },
              ].filter(Boolean).map((r, i, arr) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", padding:"7px 0", borderBottom: i < arr.length-1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                  <span style={{ fontSize:11, color:"#94a3b8", fontFamily:"'Cinzel',serif", letterSpacing:"0.04em" }}>{r.icon} {r.label}</span>
                  <div style={{ textAlign:"right" }}>
                    <span style={{ fontSize:13, color:"#e2e8f0", fontFamily:"'Crimson Text',serif", fontWeight:700 }}>{r.value}</span>
                    <div style={{ fontSize:9, color:"#94a3b8" }}>{r.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </>}

          {/* Commander breakdown */}
          {pCmdList.length > 0 && <>
            <SectionLabel mt={0}>COMMANDERS</SectionLabel>
            {pCmdList.map(c => (
              <div key={c.name} style={{ ...CARD, marginBottom:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontWeight:600, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.name}</div>
                  </div>
                  <div style={{ display:"flex", gap:14, textAlign:"center", flexShrink:0 }}>
                    {[["W",c.wins,"#34d399"],["G",c.played,"#94a3b8"],["%",`${c.rate}%`,"#c084fc"]].map(([l,v,col])=>(
                      <div key={l}><div style={{ fontSize:16, fontWeight:700, color:col }}>{v}</div><div style={{ fontSize:9, color:"#94a3b8" }}>{l}</div></div>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop:6, height:2, background:"rgba(255,255,255,0.05)", borderRadius:2 }}>
                  <div style={{ width:`${c.rate}%`, height:"100%", background:"linear-gradient(90deg,#7c3aed,#be185d)", borderRadius:2 }} />
                </div>
              </div>
            ))}
          </>}

          {/* Game history */}
          {pGames.length > 0 && <>
            <SectionLabel mt={20}>GAME HISTORY</SectionLabel>
            {pGames.map(g => {
              const won = g.winner === selectedPlayerId;
              const si = g.seats?.findIndex(s => s.playerId === selectedPlayerId);
              const finalLife = si >= 0 ? g.finalLifes?.[si] : null;
              const commander = g.seats?.find(s => s.playerId === selectedPlayerId)?.commander;
              const opponents = (g.seats||[]).filter(s => s.playerId !== selectedPlayerId).map(s => pName(s.playerId));
              return (
                <div key={g.id} style={{ ...CARD, marginBottom:8, borderLeft:`3px solid ${won?"#34d399":"rgba(255,255,255,0.07)"}`, padding:"12px 16px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                    <div style={{ minWidth:0, flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:600, color: won?"#34d399":"#94a3b8", marginBottom:2 }}>{won?"👑 Won":"Played"}</div>
                      {commander && <div style={{ fontSize:11, color:"#e2e8f0", fontFamily:"'Crimson Text',serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{commander}</div>}
                      <div style={{ fontSize:10, color:"#64748b", fontFamily:"'Crimson Text',serif", marginTop:2 }}>vs {opponents.join(", ")}</div>
                    </div>
                    <div style={{ textAlign:"right", flexShrink:0, marginLeft:12 }}>
                      <div style={{ fontSize:10, color:"#94a3b8" }}>{fmt(g.date)}</div>
                      {finalLife != null && <div style={{ fontSize:13, fontWeight:700, color: won?"#34d399":"#64748b" }}>♥{finalLife}</div>}
                      {g.duration && <div style={{ fontSize:9, color:"#64748b", fontFamily:"'Crimson Text',serif" }}>{g.duration}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </>}

        </div>
      </div>
    );
  }
  // ── End Player Profile ──────────────────────────────────────────────────────

  return (
    <div style={{ height:"100vh", overflowY:"auto", WebkitOverflowScrolling:"touch", background:"var(--bg)", color:"#e2e8f0", fontFamily:"'Cinzel',serif" }}>
      <div style={{ maxWidth:500, margin:"0 auto", padding:"calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 64px)" }}>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:20, flexWrap:"wrap" }}>
          <button onClick={onBack} style={{ ...btn(), padding:"8px 14px" }}>← Back</button>
          <h2 style={{ margin:0, fontSize:20, flex:1, background:"linear-gradient(135deg,var(--accent),var(--grad-end))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Stats</h2>
          {playerStats.length > 0 && <button onClick={() => shareText(buildStatsShareText(), "Battle Bee Standings")} style={{ ...btn("primary"), padding:"6px 12px", fontSize:11 }}>⬆ Share</button>}
          <div style={{ display:"flex", gap:6 }}>
            {[["all","All"],["recent","Last 10"]].map(([v,l]) => (
              <button key={v} onClick={() => setFilter(v)} style={{ ...btn(filter===v?"primary":undefined), padding:"6px 12px", fontSize:11 }}>{l}</button>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div style={{ ...CARD, display:"flex", gap:20, flexWrap:"wrap", marginBottom:20 }}>
          <StatPill label="GAMES" value={filtered.length} />
          <StatPill label="PLAYERS" value={players.length} color="#94a3b8" />
          {avgDurSec > 0 && <StatPill label="AVG TIME" value={fmtDur(avgDurSec)} color="#34d399" />}
          <StatPill label="COMMANDERS" value={commanders.length} color="#f59e0b" />
        </div>

        {filtered.length === 0 && (
          <div style={{ textAlign:"center", color:"#94a3b8", padding:60, fontFamily:"'Crimson Text',serif" }}>No games logged yet.</div>
        )}

        {/* Leaderboard */}
        {playerStats.length > 0 && <>
          <SectionLabel mt={4}>LEADERBOARD</SectionLabel>
          {playerStats.map((p, i) => (
            <div key={p.id} onClick={() => setSelectedPlayerId(p.id)} style={{ ...CARD, borderColor: i===0 ? "rgba(192,132,252,0.3)" : undefined, marginBottom:8, cursor:"pointer" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ display:"flex", gap:10, alignItems:"center", minWidth:0 }}>
                  <span style={{ fontSize:16 }}>{i===0?"👑":`#${i+1}`}</span>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontWeight:600, fontSize:14 }}>
                      {p.name}
                      {p.streak >= 2 && <span style={{ fontSize:11, color:"#f59e0b", marginLeft:6 }}>🔥{p.streak}</span>}
                    </div>
                    <div style={{ fontSize:11, color:"#94a3b8", fontFamily:"'Crimson Text',serif", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {p.fav !== "—" ? p.fav : "No commander logged"}
                      {p.avgWinLife != null ? ` · ♥${p.avgWinLife} avg` : ""}
                    </div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:14, textAlign:"center", flexShrink:0 }}>
                  {[["W",p.wins,"#34d399"],["G",p.played,"#94a3b8"],["%",`${p.rate}%`,"#c084fc"]].map(([l,v,c])=>(
                    <div key={l}><div style={{ fontSize:18, fontWeight:700, color:c }}>{v}</div><div style={{ fontSize:9, color:"#94a3b8" }}>{l}</div></div>
                  ))}
                </div>
              </div>
              <div style={{ marginTop:8, height:2, background:"rgba(255,255,255,0.05)", borderRadius:2 }}>
                <div style={{ width:`${p.rate}%`, height:"100%", background:"linear-gradient(90deg,#7c3aed,#be185d)", borderRadius:2, transition:"width 0.4s" }} />
              </div>
            </div>
          ))}
        </>}

        {/* Commanders */}
        {commanders.length > 0 && <>
          <SectionLabel mt={20}>COMMANDERS</SectionLabel>
          {commanders.map((c, i) => (
            <div key={c.name} style={{ ...CARD, marginBottom:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontWeight:600, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.name}</div>
                  <div style={{ fontSize:11, color:"#94a3b8", fontFamily:"'Crimson Text',serif" }}>{c.pilots}</div>
                </div>
                <div style={{ display:"flex", gap:14, textAlign:"center", flexShrink:0 }}>
                  {[["W",c.wins,"#34d399"],["G",c.played,"#94a3b8"],["%",`${c.rate}%`,"#c084fc"]].map(([l,v,col])=>(
                    <div key={l}><div style={{ fontSize:16, fontWeight:700, color:col }}>{v}</div><div style={{ fontSize:9, color:"#94a3b8" }}>{l}</div></div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </>}

        {/* Decks */}
        {topDecks.length > 0 && <>
          <SectionLabel mt={20}>DECKS</SectionLabel>
          {topDecks.map(d => (
            <div key={d.id} style={{ ...CARD, marginBottom:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontWeight:600, fontSize:13 }}>{d.name}</div>
                  <div style={{ fontSize:11, color:"#94a3b8", fontFamily:"'Crimson Text',serif" }}>{pName(d.playerId)}{d.commander ? ` · ${d.commander}` : ""}</div>
                </div>
                <div style={{ display:"flex", gap:14, textAlign:"center", flexShrink:0 }}>
                  {[["W",d.wins,"#34d399"],["G",d.played,"#94a3b8"],["%",`${d.rate}%`,"#c084fc"]].map(([l,v,c])=>(
                    <div key={l}><div style={{ fontSize:16, fontWeight:700, color:c }}>{v}</div><div style={{ fontSize:9, color:"#94a3b8" }}>{l}</div></div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </>}

        {/* Pods */}
        {podStats.length > 0 && <>
          <SectionLabel mt={20}>PODS</SectionLabel>
          {podStats.map(pod => {
            const turnEntries = Object.entries(pod.memberTurnTimes).sort((a, b) => b[1] - a[1]);
            return (
              <div key={pod.id} style={{ ...CARD, marginBottom:8 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: turnEntries.length > 0 ? 10 : 0 }}>
                  <div>
                    <div style={{ fontWeight:600, fontSize:13 }}>{pod.name}</div>
                    <div style={{ fontSize:11, color:"#94a3b8", fontFamily:"'Crimson Text',serif" }}>
                      {pod.memberIds.map(id => pName(id)).join(", ")}
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:14, textAlign:"center" }}>
                    <div><div style={{ fontSize:18, fontWeight:700, color:"#94a3b8" }}>{pod.games}</div><div style={{ fontSize:9, color:"#94a3b8" }}>GAMES</div></div>
                    {pod.topWinner && <div><div style={{ fontSize:13, fontWeight:700, color:"#34d399" }}>{pod.topWinner}</div><div style={{ fontSize:9, color:"#94a3b8" }}>{pod.topWins}W</div></div>}
                  </div>
                </div>
                {turnEntries.length > 0 && (
                  <div style={{ borderTop:"1px solid rgba(255,255,255,0.06)", paddingTop:8 }}>
                    <div style={{ fontSize:9, color:"#94a3b8", letterSpacing:"0.1em", fontFamily:"'Cinzel',serif", marginBottom:6 }}>⏱ AVG TURN</div>
                    {turnEntries.map(([id, sec], i) => (
                      <div key={id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
                        <span style={{ fontSize:12, color:"#94a3b8", fontFamily:"'Crimson Text',serif" }}>
                          {i === 0 ? "🐢 " : i === turnEntries.length - 1 ? "⚡ " : " · "}{pName(id)}
                        </span>
                        <span style={{ fontSize:12, fontWeight:700, fontFamily:"'Cinzel',serif", color: i === 0 ? "#f87171" : i === turnEntries.length - 1 ? "#34d399" : "#94a3b8" }}>{fmtDur(sec)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>}

        {/* Records */}
        {records.length > 0 && <>
          <SectionLabel mt={20}>ALL-TIME RECORDS</SectionLabel>
          <div style={{ ...CARD }}>
            {records.map((r, i) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", padding:"6px 0", borderBottom: i < records.length-1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                <span style={{ fontSize:11, color:"#94a3b8", fontFamily:"'Cinzel',serif", letterSpacing:"0.04em" }}>{r.label}</span>
                <div style={{ textAlign:"right" }}>
                  <span style={{ fontSize:12, color:"#e2e8f0", fontFamily:"'Crimson Text',serif" }}>{r.value}{r.player ? ` · ${r.player}` : ""}</span>
                  <div style={{ fontSize:9, color:"#94a3b8" }}>{r.date}</div>
                </div>
              </div>
            ))}
          </div>
        </>}

        {/* Legends */}
        {(longestGame?.duration || biggestSwing || mostComebacks) && <>
          <SectionLabel mt={20}>LEGENDS</SectionLabel>
          <div style={{ ...CARD }}>
            {[
              longestGame?.duration && { icon:"⏳", label:"Longest Game", value: longestGame.duration, sub: fmt(longestGame.date) },
              biggestSwing && { icon:"⚡", label:"Biggest Life Swing", value:`+${biggestSwing.swing}`, sub:`${biggestSwing.player} · ${biggestSwing.date}` },
              mostComebacks && { icon:"🔄", label:"Most Comebacks", value:`${mostComebacks.count}`, sub: mostComebacks.player },
            ].filter(Boolean).map((r, i, arr) => (
              <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", padding:"6px 0", borderBottom: i < arr.length-1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                <span style={{ fontSize:11, color:"#94a3b8", fontFamily:"'Cinzel',serif", letterSpacing:"0.04em" }}>{r.icon} {r.label}</span>
                <div style={{ textAlign:"right" }}>
                  <span style={{ fontSize:13, color:"#e2e8f0", fontFamily:"'Crimson Text',serif", fontWeight:700 }}>{r.value}</span>
                  <div style={{ fontSize:9, color:"#94a3b8" }}>{r.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </>}

        {turnRanking.length > 0 && <>
          <SectionLabel mt={20}>⏱ TURN TIMES</SectionLabel>
          {turnRanking.map((p, i) => {
            const isSlowest = i === 0;
            const isFastest = i === turnRanking.length - 1;
            return (
              <div key={p.id} style={{ ...CARD, marginBottom:8, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                  <span style={{ fontSize:16 }}>{isSlowest ? "🐢" : isFastest ? "⚡" : `#${i+1}`}</span>
                  <div>
                    <div style={{ fontWeight:600, fontSize:14 }}>{p.name}</div>
                    <div style={{ fontSize:11, color:"#94a3b8", fontFamily:"'Crimson Text',serif" }}>avg per turn</div>
                  </div>
                </div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontSize:18, fontWeight:700, color: isSlowest ? "#f87171" : isFastest ? "#34d399" : "#94a3b8" }}>{fmtDur(p.avgTurnSec)}</div>
                </div>
              </div>
            );
          })}
        </>}

      </div>
    </div>
  );
}

// ── Emoji options ─────────────────────────────────────────────────────────────
const EMOJI_OPTIONS = [
  // ── Fantasy / MTG (special section) ──
  "🐉","🐲","🦄","🧜","🧚","🧝","🧞","🧟","🧛","🧙","🪄",
  // ── Animals & Nature (Apple keyboard order) ──
  // Pets & small mammals
  "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐻‍❄️","🐯","🦁",
  // Farm & hoofed
  "🐮","🐷","🐖","🐗","🐏","🐑","🐐","🦌","🦬","🐄","🐂","🐃","🐴","🐎","🦙","🦘",
  // Primates
  "🐵","🐒","🦍","🦧",
  // Wild mammals
  "🐺","🦝","🐆","🐅","🐘","🦏","🦛","🦒","🦓","🦔","🦦","🦫","🦥","🐿️","🦡","🦇",
  // Dogs & cats (breeds/variants)
  "🐩","🐕‍🦺","🐈","🐈‍⬛","🐇",
  // Birds
  "🐓","🐔","🐣","🐤","🐥","🐧","🐦","🐦‍⬛","🦆","🦅","🦉","🕊️","🦤","🪿","🦩","🦚","🦜","🪶",
  // Reptiles & amphibians
  "🐸","🐊","🐢","🦎","🐍","🦕","🦖",
  // Sea creatures
  "🐳","🐋","🐬","🦭","🐟","🐠","🐡","🦈","🐙","🦑","🦐","🦞","🦀","🦪","🐚","🪸",
  // Bugs & insects
  "🐝","🦋","🐛","🐌","🐞","🐜","🪲","🦟","🪰","🦗","🪳","🕷️","🦂","🪱","🦠",
  // Flowers
  "💐","🌸","🪷","🏵️","🌹","🥀","🌺","🌻","🌼","🌷","🪻",
  // Plants & trees
  "🌱","🪴","🌲","🌳","🌴","🌵","🌾","🌿","🍀","🍂","🍃","🍁","🍄","🪨","🌰","🪺",
  // Sky & weather
  "🌙","🌚","🌕","🌑","🌟","💫","✨","☄️","☀️","🌈","🌩️","⚡","❄️","💧","🔥","🌪️","🌊","🌋","🏔️","🌍",
  // ── Objects & symbols (Apple keyboard order) ──
  // Combat & weapons
  "⚔️","🗡️","🛡️","🏹","🪃","🔱","⛏️","🪓","💣","🧨","🪖","🏴‍☠️",
  // Arcane & mystical
  "🔮","🪬","🧿","💎","👁️","🕯️","📿","🔯","♾️","⚗️","🧲",
  // Dark / spooky
  "💀","☠️","🩸","👻","👾","😈","👿","🕸️","🦴",
  // Food & drink
  "🍷","🧪","🍵","🌶️",
  // Objects
  "🏺","🗿","🗝️","📜","📯","🥁","🎺","🪘",
  // Symbols & misc
  "👑","🧬","🪐","💥","🎲","♟️","🃏","🧠","💪","🖖","🤘","✊","🐾",
];

const EMOJI_CATEGORIES = [
  { label:"Fantasy", icon:"🐉", emojis:["🐉","🐲","🦄","🧜","🧚","🧝","🧞","🧟","🧛","🧙","🪄"] },
  { label:"Pets",    icon:"🐶", emojis:["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐻‍❄️","🐯","🦁","🐩","🐕‍🦺","🐈","🐈‍⬛","🐇"] },
  { label:"Farm",    icon:"🐷", emojis:["🐮","🐷","🐖","🐗","🐏","🐑","🐐","🦌","🦬","🐄","🐂","🐃","🐴","🐎","🦙","🦘"] },
  { label:"Wild",    icon:"🦁", emojis:["🐵","🐒","🦍","🦧","🐺","🦝","🐆","🐅","🐘","🦏","🦛","🦒","🦓","🦔","🦦","🦫","🦥","🐿️","🦡","🦇"] },
  { label:"Birds",   icon:"🦅", emojis:["🐓","🐔","🐣","🐤","🐥","🐧","🐦","🐦‍⬛","🦆","🦅","🦉","🕊️","🦤","🪿","🦩","🦚","🦜","🪶"] },
  { label:"Reptiles",icon:"🐍", emojis:["🐸","🐊","🐢","🦎","🐍","🦕","🦖"] },
  { label:"Sea",     icon:"🦈", emojis:["🐳","🐋","🐬","🦭","🐟","🐠","🐡","🦈","🐙","🦑","🦐","🦞","🦀","🦪","🐚","🪸"] },
  { label:"Bugs",    icon:"🦋", emojis:["🐝","🦋","🐛","🐌","🐞","🐜","🪲","🦟","🪰","🦗","🪳","🕷️","🦂","🪱","🦠"] },
  { label:"Flowers", icon:"🌸", emojis:["💐","🌸","🪷","🏵️","🌹","🥀","🌺","🌻","🌼","🌷","🪻"] },
  { label:"Plants",  icon:"🌿", emojis:["🌱","🪴","🌲","🌳","🌴","🌵","🌾","🌿","🍀","🍂","🍃","🍁","🍄","🪨","🌰","🪺"] },
  { label:"Sky",     icon:"🌙", emojis:["🌙","🌚","🌕","🌑","🌟","💫","✨","☄️","☀️","🌈","🌩️","⚡","❄️","💧","🔥","🌪️","🌊","🌋","🏔️","🌍"] },
  { label:"Combat",  icon:"⚔️", emojis:["⚔️","🗡️","🛡️","🏹","🪃","🔱","⛏️","🪓","💣","🧨","🪖","🏴‍☠️"] },
  { label:"Arcane",  icon:"🔮", emojis:["🔮","🪬","🧿","💎","👁️","🕯️","📿","🔯","♾️","⚗️","🧲"] },
  { label:"Dark",    icon:"💀", emojis:["💀","☠️","🩸","👻","👾","😈","👿","🕸️","🦴"] },
  { label:"Misc",    icon:"👑", emojis:["🍷","🧪","🍵","🌶️","🏺","🗿","🗝️","📜","📯","🥁","🎺","🪘","👑","🧬","🪐","💥","🎲","♟️","🃏","🧠","💪","🖖","🤘","✊","🐾"] },
];

// ── Emoji Picker ──────────────────────────────────────────────────────────────
function EmojiPicker({ current, onSelect, onClose }) {
  const [activeCat, setActiveCat] = useState(0);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:300, display:"flex", flexDirection:"column", justifyContent:"flex-end" }} onClick={onClose}>
      <div style={{ background:"var(--modal-bg,#0f172a)", borderRadius:"16px 16px 0 0", maxHeight:"62vh", display:"flex", flexDirection:"column", border:"1px solid rgba(255,255,255,0.1)", borderBottom:"none" }} onClick={e=>e.stopPropagation()}>
        {/* Handle */}
        <div style={{ display:"flex", justifyContent:"center", padding:"10px 0 4px", flexShrink:0 }}>
          <div style={{ width:36, height:4, borderRadius:2, background:"rgba(255,255,255,0.2)" }} />
        </div>
        {/* Category tabs */}
        <div style={{ display:"flex", overflowX:"auto", padding:"4px 12px 8px", gap:6, scrollbarWidth:"none", flexShrink:0 }}>
          {EMOJI_CATEGORIES.map((cat,i) => (
            <button key={i} onClick={()=>setActiveCat(i)} style={{ padding:"5px 12px", borderRadius:20, whiteSpace:"nowrap", flexShrink:0, fontFamily:"'Cinzel',serif", fontSize:11, cursor:"pointer", transition:"all 0.12s",
              background: i===activeCat ? "var(--accent-bg,rgba(139,92,246,0.2))" : "rgba(255,255,255,0.06)",
              border: i===activeCat ? "1px solid var(--accent,#8b5cf6)" : "1px solid rgba(255,255,255,0.1)",
              color: i===activeCat ? "var(--accent,#8b5cf6)" : "#94a3b8" }}>
              {cat.icon} {cat.label}
            </button>
          ))}
        </div>
        {/* Emoji grid */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2, padding:"0 8px 16px", overflowY:"auto", flex:1 }}>
          {EMOJI_CATEGORIES[activeCat].emojis.map(e => (
            <button key={e} onClick={()=>{ onSelect(e); onClose(); }}
              style={{ fontSize:28, lineHeight:1, padding:"8px 4px", borderRadius:8, cursor:"pointer", textAlign:"center", border:"none",
                background: e===current ? "rgba(255,255,255,0.15)" : "transparent" }}>
              {e}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Player Giphy Search (inline, stateful) ────────────────────────────────────
const GIPHY_KEY = "GlVGYHkr3WSBnllca54iNt0yFbjz7L65";

function PlayerGiphySearch({ accentColor, onPick }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);
  const search = async (loadMore = false) => {
    if (!query.trim()) return; setLoading(true);
    const off = loadMore ? offsetRef.current : 0;
    try {
      const res = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(query)}&limit=24&offset=${off}&rating=g`);
      const data = await res.json();
      const batch = data.data || [];
      setResults(prev => loadMore ? [...prev, ...batch] : batch);
      offsetRef.current = off + batch.length;
      const total = data.pagination?.total_count ?? 0;
      setHasMore(off + batch.length < total && batch.length > 0);
    } catch(e) { if (!loadMore) setResults([]); setHasMore(false); }
    setLoading(false);
  };
  return (
    <div>
      <button onClick={()=>setOpen(s=>!s)} style={{ ...btn(), fontSize:11, padding:"5px 12px", marginBottom: open ? 10 : 0 }}>🎞 {open ? "Close Giphy" : "Search Giphy"}</button>
      {open && (
        <div>
          <div style={{ display:"flex", gap:8, marginBottom:8 }}>
            <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search()} placeholder="Search Giphy…" style={{ ...INPUT, flex:1, fontSize:13 }} />
            <button onClick={()=>search()} style={btn("primary")} disabled={loading}>{loading?"…":"Go"}</button>
          </div>
          {results.length > 0 && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6 }}>
              {results.map(gif => (
                <div key={gif.id} onClick={()=>{ onPick(gif.images.downsized_medium?.url || gif.images.fixed_width?.url || gif.images.original.url); setOpen(false); setResults([]); setQuery(""); }}
                  style={{ borderRadius:6, overflow:"hidden", cursor:"pointer", border:"2px solid transparent", transition:"border 0.15s", aspectRatio:"1" }}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=accentColor} onMouseLeave={e=>e.currentTarget.style.borderColor="transparent"}>
                  <img src={gif.images.fixed_width_small.url} alt={gif.title} style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} loading="lazy" />
                </div>
              ))}
            </div>
          )}
          {results.length > 0 && hasMore && (
            <button onClick={()=>search(true)} disabled={loading} style={{ ...btn(), width:"100%", marginTop:8, fontSize:11, padding:"7px 0" }}>{loading ? "…" : "↓ Load more"}</button>
          )}
          {results.length === 0 && !loading && query && <div style={{ fontSize:12, color:"#94a3b8", fontFamily:"'Crimson Text',serif", textAlign:"center", padding:12 }}>No results.</div>}
          <div style={{ fontSize:10, color:"#94a3b8", textAlign:"right", marginTop:6, fontFamily:"'Crimson Text',serif" }}>Powered by GIPHY</div>
        </div>
      )}
    </div>
  );
}

// ── Roster ────────────────────────────────────────────────────────────────────
function Roster({ players, setPlayers, decks, setDecks, themes, setThemes, gifs, setGifs, pods, setPods, onBack }) {
  const [tab, setTab] = useState("players");
  const [pName, setPName] = useState(""); const [pEmoji, setPEmoji] = useState("🐉");
  const [expandedPlayer, setExpandedPlayer] = useState(null);
  const [editingName, setEditingName] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(null);
  const [dName, setDName] = useState(""); const [dCmd, setDCmd] = useState(""); const [dOwner, setDOwner] = useState(""); const [dColors, setDColors] = useState("");
  const [mbOpen, setMbOpen] = useState(false); const [mbText, setMbText] = useState(""); const [mbName, setMbName] = useState(""); const [mbOwner, setMbOwner] = useState("");

  // Parse a ManaBox text export: section headers ("Commander", "Mainboard", …) followed by "1 Card Name (SET) 123 *F*" lines
  const parseManaBox = (text) => {
    const lines = (text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const cardRe = /^(\d+)x?\s+(.+?)(?:\s+\([A-Za-z0-9]{2,6}\)\s*\S*)?(?:\s+\*F\*)?$/;
    let section = "mainboard";
    const commanders = []; let count = 0;
    for (const line of lines) {
      if (!/^\d/.test(line)) { section = line.toLowerCase(); continue; }
      const m = line.match(cardRe);
      if (!m) continue;
      count += parseInt(m[1]) || 1;
      if (section.startsWith("commander")) commanders.push(m[2].trim());
    }
    return { commanders, count };
  };

  const importManaBox = async () => {
    const { commanders } = parseManaBox(mbText);
    if (!mbOwner) return;
    const commander = commanders.join(" / ");
    const name = mbName.trim() || (commanders[0] ? `${commanders[0]}` : "Imported deck");
    // Best-effort color identity from Scryfall (combined across partners)
    let colors = "";
    try { colors = await fetchColorIdentity(commanders.slice(0, 2).join(" / ")); } catch {}
    setDecks(ds => [...ds, { id: uid(), name, commander, colors, playerId: mbOwner }]);
    setMbText(""); setMbName(""); setMbOpen(false);
  };
  const [podName, setPodName] = useState(""); const [podSelected, setPodSelected] = useState([]);
  const pName2 = (id) => players.find(p => p.id === id)?.name || "?";

  const addPlayer = () => { if (!pName.trim()) return; setPlayers(ps => [...ps, { id: uid(), name: pName.trim(), emoji: pEmoji }]); setPName(""); };
  const delPlayer = (id) => { setPlayers(ps => ps.filter(p => p.id !== id)); setDecks(ds => ds.filter(d => d.playerId !== id)); };
  const addDeck = async () => {
    if (!dName.trim() || !dOwner) return;
    let colors = dColors;
    if (!colors && dCmd.trim()) { try { colors = await fetchColorIdentity(dCmd); } catch {} }
    setDecks(ds => [...ds, { id: uid(), name: dName.trim(), commander: dCmd.trim(), colors, playerId: dOwner }]);
    setDName(""); setDCmd(""); setDColors("");
  };
  const delDeck = (id) => setDecks(ds => ds.filter(d => d.id !== id));

  useEffect(() => { if (players.length && !dOwner) setDOwner(players[0].id); if (players.length && !mbOwner) setMbOwner(players[0].id); }, [players]);

  return (
    <div style={{ height:"100vh", overflowY:"auto", WebkitOverflowScrolling:"touch", background:"var(--bg)", color:"#e2e8f0", fontFamily:"'Cinzel',serif" }}>
      <div style={{ maxWidth:700, margin:"0 auto", padding:"calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 64px)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:24 }}>
          <button onClick={onBack} style={{ ...btn(), padding:"8px 14px" }}>← Back</button>
          <h2 style={{ margin:0, fontSize:20, background:"linear-gradient(135deg,var(--accent),var(--grad-end))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>Roster & Decks</h2>
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:20, flexWrap:"wrap" }}>
          {[["players","PLAYERS"],["decks","DECKS"],["pods","PODS"]].map(([t,label]) => <button key={t} onClick={()=>setTab(t)} style={navBtn(tab===t)}>{label}</button>)}
        </div>

        {tab === "players" && <>
          <div style={CARD}>
            <label style={LABEL}>Add Player</label>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <button onClick={()=>setPickerOpen("new")} style={{ fontSize:26, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"5px 10px", cursor:"pointer", lineHeight:1, flexShrink:0 }}>{pEmoji}</button>
              <input value={pName} onChange={e=>setPName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPlayer()} placeholder="Player name" style={{ ...INPUT, flex:1 }} />
              <button onClick={addPlayer} style={btn("primary")}>Add</button>
            </div>
            {pickerOpen==="new" && <EmojiPicker current={pEmoji} onSelect={e=>setPEmoji(e)} onClose={()=>setPickerOpen(null)} />}
          </div>
          {players.map((p,i) => {
            const isExpanded = expandedPlayer === p.id;
            const isEditing = editingName?.id === p.id;
            return (
              <div key={p.id} style={CARD}>
                {/* Top row */}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div style={{ display:"flex", gap:10, alignItems:"center", flex:1, minWidth:0 }}>
                    {/* Emoji picker */}
                    <button onClick={()=>setPickerOpen(p.id)} style={{ fontSize:26, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"5px 10px", cursor:"pointer", lineHeight:1, flexShrink:0 }}>
                      {p.emoji||DEFAULT_EMOJI[i%DEFAULT_EMOJI.length]}
                    </button>
                    {pickerOpen===p.id && <EmojiPicker current={p.emoji} onSelect={e=>setPlayers(ps=>ps.map(pl=>pl.id===p.id?{...pl,emoji:e}:pl))} onClose={()=>setPickerOpen(null)} />}
                    {/* Name / inline edit */}
                    <div style={{ flex:1, minWidth:0 }}>
                      {isEditing ? (
                        <input autoFocus value={editingName.value}
                          onChange={e=>setEditingName(prev=>({...prev, value:e.target.value}))}
                          onBlur={() => { if (editingName.value.trim()) setPlayers(ps=>ps.map(pl=>pl.id===p.id?{...pl,name:editingName.value.trim()}:pl)); setEditingName(null); }}
                          onKeyDown={e=>{ if(e.key==="Enter") e.target.blur(); if(e.key==="Escape") setEditingName(null); }}
                          style={{ ...INPUT, fontSize:14, padding:"4px 8px", color:COLORS[i%COLORS.length], width:"100%" }} />
                      ) : (
                        <div onClick={()=>setEditingName({id:p.id,value:p.name})} style={{ color:COLORS[i%COLORS.length], cursor:"text", display:"flex", alignItems:"center", gap:5 }}>
                          {p.name}<span style={{ fontSize:10, color:"#94a3b8" }}>✎</span>
                        </div>
                      )}
                      <div style={{ fontSize:11, color:"#94a3b8", fontFamily:"'Crimson Text',serif" }}>{decks.filter(d=>d.playerId===p.id).length} decks</div>
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
                    <button onClick={()=>setExpandedPlayer(isExpanded?null:p.id)}
                      style={{ padding:"5px 10px", borderRadius:6, fontSize:14, cursor:"pointer", background: isExpanded?"rgba(255,255,255,0.08)":"rgba(255,255,255,0.04)", border: isExpanded?`1px solid ${COLORS[i%COLORS.length]}66`:"1px solid rgba(255,255,255,0.1)", color: isExpanded?COLORS[i%COLORS.length]:"#94a3b8", transition:"all 0.15s" }}>🎨</button>
                    <button onClick={()=>delPlayer(p.id)} style={{ ...btn("danger"), padding:"4px 10px", fontSize:11 }}>✕</button>
                  </div>
                </div>
                {/* Expanded: theme + GIF picker */}
                {isExpanded && (
                  <div style={{ marginTop:12, borderTop:"0.5px solid rgba(255,255,255,0.07)", paddingTop:12 }}>
                    {themes[i]==="gif" && gifs[i] ? (
                      <div style={{ marginBottom:10 }}>
                        <div style={{ position:"relative", borderRadius:8, overflow:"hidden", height:72, marginBottom:8 }}>
                          <img src={gifs[i]} alt="bg" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
                          <div style={{ position:"absolute", inset:0, background:"rgba(0,0,0,0.3)", display:"flex", alignItems:"center", justifyContent:"center" }}>
                            <span style={{ fontSize:11, color:"#fff", fontFamily:"'Cinzel',serif", letterSpacing:"0.1em" }}>ACTIVE GIF</span>
                          </div>
                        </div>
                        <button onClick={()=>{ setGifs(prev=>{ const n=[...prev]; n[i]=null; return n; }); setThemes(prev=>{ const n=[...prev]; n[i]="default"; return n; }); }} style={{ ...btn("danger"), fontSize:11, padding:"5px 12px", marginBottom:10 }}>✕ Remove GIF</button>
                      </div>
                    ) : (
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
                        <ParticleStyles />
                        {THEMES.map(t => {
                          const active = (themes[i]||"default") === t.id;
                          const previewBg = t.gradient || t.solid || DARK_BG[i % DARK_BG.length];
                          return (
                            <button key={t.id} onClick={()=>setThemes(prev=>{ const n=[...prev]; n[i]=t.id; return n; })}
                              style={{ position:"relative", overflow:"hidden", padding:0, width:72, height:52, borderRadius:6, cursor:"pointer", border:`2px solid ${active?COLORS[i%COLORS.length]:"rgba(255,255,255,0.15)"}`, background:previewBg, transition:"all 0.15s", boxShadow:active?`0 0 10px ${COLORS[i%COLORS.length]}88`:"none", flexShrink:0 }}>
                              <ThemeParticles themeId={t.id} rot={0} />
                              <div style={{ position:"absolute", bottom:0, left:0, right:0, zIndex:1, padding:"4px 4px 5px", background:"linear-gradient(to top,rgba(0,0,0,0.8) 0%,rgba(0,0,0,0.3) 70%,transparent 100%)", display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
                                <span style={{ fontFamily:"'Cinzel',serif", fontSize:8.5, color:"#fff", textShadow:"0 1px 3px rgba(0,0,0,1)", lineHeight:1, letterSpacing:"0.03em" }}>{t.label}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <PlayerGiphySearch accentColor={COLORS[i%COLORS.length]} onPick={url=>{ setGifs(prev=>{ const n=[...prev]; n[i]=url; return n; }); setThemes(prev=>{ const n=[...prev]; n[i]="gif"; return n; }); }} />
                  </div>
                )}
              </div>
            );
          })}
        </>}

        {tab === "decks" && <>
          <div style={CARD}>
            <label style={LABEL}>Add Deck</label>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <select value={dOwner} onChange={e=>setDOwner(e.target.value)} style={INPUT}>
                <option value="">— owner —</option>
                {players.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
              </select>
              <input value={dName} onChange={e=>setDName(e.target.value)} placeholder="Deck name" style={INPUT} />
              <CommanderInput value={dCmd} onChange={v => { setDCmd(v); setDColors(""); }} onPick={name => fetchColorIdentity(name).then(setDColors).catch(()=>{})} placeholder="Commander" style={INPUT} />
              {dColors && <div style={{ display:"flex", alignItems:"center", gap:8 }}><span style={{ fontSize:10, letterSpacing:"0.12em", color:"#94a3b8", fontFamily:"'Cinzel',serif" }}>IDENTITY</span><ColorPips colors={dColors} /></div>}
              <button onClick={addDeck} style={btn("primary")}>Add Deck</button>
            </div>
          </div>
          {/* ManaBox import */}
          <div style={CARD}>
            <button onClick={() => setMbOpen(o => !o)} style={{ ...btn(), fontSize: 12, padding: "7px 14px" }}>📥 {mbOpen ? "Close ManaBox Import" : "Import from ManaBox"}</button>
            {mbOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: "'Crimson Text',serif" }}>In ManaBox: deck → Export → Text → Copy, then paste below.</div>
                <textarea value={mbText} onChange={e => setMbText(e.target.value)} rows={6} placeholder={"Commander\n1 Atraxa, Praetors' Voice (2XM) 190\n\nMainboard\n1 Sol Ring (C21) 125\n…"} style={{ ...INPUT, resize: "vertical", fontSize: 13 }} />
                <select value={mbOwner} onChange={e => setMbOwner(e.target.value)} style={INPUT}>
                  <option value="">— owner —</option>
                  {players.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
                </select>
                <input value={mbName} onChange={e => setMbName(e.target.value)} placeholder="Deck name (optional — defaults to commander)" style={INPUT} />
                {(() => {
                  const parsed = parseManaBox(mbText);
                  return mbText.trim() ? (
                    <div style={{ fontSize: 13, fontFamily: "'Crimson Text',serif", color: parsed.commanders.length ? "#4ade80" : "#fb923c" }}>
                      {parsed.commanders.length
                        ? <>⚔ {parsed.commanders.join(" / ")} · {parsed.count} cards</>
                        : <>No "Commander" section found — {parsed.count} cards. Commander will be left blank.</>}
                    </div>
                  ) : null;
                })()}
                <button onClick={importManaBox} disabled={!mbText.trim() || !mbOwner} style={{ ...btn("primary"), opacity: (!mbText.trim() || !mbOwner) ? 0.5 : 1 }}>Import Deck</button>
              </div>
            )}
          </div>
          {players.length === 0 && <div style={{ textAlign:"center", color:"#94a3b8", fontSize:13, fontFamily:"'Crimson Text',serif", padding:"20px 0" }}>Add players first.</div>}
          {players.map((p, pi) => {
            const pDecks = decks.filter(d => d.playerId === p.id);
            if (pDecks.length === 0) return null;
            return (
              <div key={p.id} style={{ marginBottom:12 }}>
                <div style={{ fontSize:10, letterSpacing:"0.12em", color:COLORS[pi%COLORS.length], fontFamily:"'Cinzel',serif", padding:"6px 2px", borderBottom:"0.5px solid rgba(255,255,255,0.07)", marginBottom:6 }}>
                  {p.emoji} {p.name.toUpperCase()} · {pDecks.length} {pDecks.length === 1 ? "DECK" : "DECKS"}
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6, paddingLeft:8 }}>
                  {pDecks.map(d => (
                    <div key={d.id} style={{ ...CARD, padding:"10px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div>
                        <div style={{ fontWeight:600, fontSize:13 }}>{d.name}</div>
                        {d.commander && <div style={{ fontSize:11, color:"#94a3b8", fontFamily:"'Crimson Text',serif" }}>{d.commander}</div>}
                        {d.colors && (
                          <div style={{ display:"flex", gap:3, marginTop:4 }}>
                            {d.colors.split("").map((c,ci) => {
                              const fg = {W:"#f1f5f9",U:"#93c5fd",B:"#94a3b8",R:"#fca5a5",G:"#86efac"}[c]||"#94a3b8";
                              const cbg = {W:"rgba(255,255,255,0.1)",U:"rgba(96,165,250,0.18)",B:"rgba(15,15,15,0.8)",R:"rgba(239,68,68,0.18)",G:"rgba(34,197,94,0.18)"}[c]||"rgba(255,255,255,0.07)";
                              return <span key={ci} style={{ fontSize:10, padding:"1px 5px", borderRadius:4, background:cbg, color:fg, fontFamily:"'Cinzel',serif", fontWeight:700 }}>{c}</span>;
                            })}
                          </div>
                        )}
                      </div>
                      <button onClick={()=>delDeck(d.id)} style={{ ...btn("danger"), padding:"4px 10px", fontSize:11 }}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>}


        {tab === "pods" && <>
          <div style={CARD}>
            <label style={LABEL}>New Pod / Playgroup</label>
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <input value={podName} onChange={e=>setPodName(e.target.value)} placeholder="Pod name (e.g. Friday Night Crew)" style={INPUT} />
              <div style={{ fontSize:11, color:"#94a3b8", fontFamily:"'Cinzel',serif", letterSpacing:"0.08em" }}>SELECT MEMBERS</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {players.map(p => {
                  const sel = podSelected.includes(p.id);
                  return (
                    <button key={p.id} onClick={()=>setPodSelected(prev=>sel?prev.filter(x=>x!==p.id):[...prev,p.id])}
                      style={{ padding:"4px 10px", borderRadius:16, cursor:"pointer", fontFamily:"'Cinzel',serif", fontSize:11,
                        background: sel ? "rgba(96,165,250,0.2)" : "rgba(255,255,255,0.05)",
                        border: sel ? "1px solid #60a5fa88" : "1px solid rgba(255,255,255,0.1)",
                        color: sel ? "#60a5fa" : "#94a3b8" }}>
                      {p.emoji} {p.name}
                    </button>
                  );
                })}
              </div>
              <button onClick={() => {
                if (!podName.trim() || podSelected.length < 2) return;
                setPods(prev => [...prev, { id: uid(), name: podName.trim(), memberIds: podSelected }]);
                setPodName(""); setPodSelected([]);
              }} style={btn("primary")}>Create Pod</button>
            </div>
          </div>
          {(!pods || pods.length === 0) && <div style={{ textAlign:"center", color:"#94a3b8", fontSize:13, fontFamily:"'Crimson Text',serif", padding:"20px 0" }}>No pods yet. Create one above.</div>}
          {(pods||[]).map(pod => (
            <div key={pod.id} style={{ ...CARD, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontFamily:"'Cinzel',serif", fontWeight:600 }}>{pod.name}</div>
                <div style={{ fontSize:12, color:"#94a3b8", fontFamily:"'Crimson Text',serif", marginTop:2 }}>
                  {pod.memberIds.map(id => players.find(p=>p.id===id)?.name).filter(Boolean).join(", ")}
                </div>
              </div>
              <button onClick={()=>setPods(prev=>prev.filter(x=>x.id!==pod.id))} style={{ ...btn("danger"), padding:"4px 10px", fontSize:11 }}>✕</button>
            </div>
          ))}
        </>}
      </div>
    </div>
  );
}

// ── Setup Screen ─────────────────────────────────────────────────────────────
function SetupScreen({ defaultCount, defaultLife, onStart, pods, players }) {
  const VARIANTS = [
    { name: "Commander",   emoji: "⚔",  life: 40,   counts: [2,4,6], desc: "40 life · Cmd damage" },
    { name: "Brawl",       emoji: "🛡",  life: 25,   counts: [2,4],   desc: "25 life · Historic" },
    { name: "Oathbreaker", emoji: "🔮", life: 20,   counts: [2,4],   desc: "20 life · Planeswalker" },
    { name: "Custom",      emoji: "⚙",  life: null, counts: [2,4,6], desc: "Choose your own" },
  ];

  const [step, setStep] = useState(1);
  const [variant, setVariant] = useState(null);
  const [count, setCount] = useState(defaultCount || 4);
  const [life, setLife] = useState(defaultLife || 40);
  const [customLife, setCustomLife] = useState("");
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [gameMode, setGameMode] = useState("casual");
  const [selectedPodId, setSelectedPodId] = useState(null);

  const selectVariant = (v) => {
    setVariant(v);
    if (v.life !== null) { setLife(v.life); setCustomLife(""); }
    if (!v.counts.includes(count)) setCount(v.counts.length > 1 ? v.counts[1] : v.counts[0]);
    setSelectedPodId(null);
    setStep(2);
  };

  const validPods = (pods || []).filter(p => (variant?.counts || [2,4,6]).includes(p.memberIds.length));

  const pName = (id) => (players || []).find(p => p.id === id)?.name || "?";

  const computePlayerOrder = () => {
    if (selectedPodId) {
      const pod = (pods || []).find(p => p.id === selectedPodId);
      if (pod && players) {
        const podIdxs = pod.memberIds.map(id => players.findIndex(p => p.id === id)).filter(i => i >= 0);
        const rest = Array.from({length: players.length}, (_, i) => i).filter(i => !podIdxs.includes(i));
        const order = [...podIdxs, ...rest];
        while (order.length < 6) order.push(order.length);
        return order;
      }
    }
    return Array.from({length: 6}, (_, i) => i);
  };

  const stepLabels = ["", "Game Format", "Players & Life"];

  const variantCard = (active) => ({
    padding: "16px 10px", borderRadius: 14, cursor: "pointer", fontFamily: "'Cinzel',serif",
    background: active ? "var(--accent-bg)" : "rgba(255,255,255,0.04)",
    border: `2px solid ${active ? "var(--accent)" : "rgba(255,255,255,0.12)"}`,
    display: "flex", flexDirection: "column", alignItems: "center", gap: 5, transition: "all 0.15s",
  });

  return (
    <div style={{ position:"fixed", inset:0, background:"var(--bg)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"calc(env(safe-area-inset-top) + 16px) 20px calc(env(safe-area-inset-bottom) + 16px)", fontFamily:"'Cinzel',serif", overflowY:"auto" }}>
      <div style={{ width:"100%", maxWidth:400 }}>

        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontSize:28, marginBottom:6 }}>⚔</div>
          <div style={{ fontSize:17, fontWeight:700, background:"linear-gradient(135deg,var(--accent),var(--grad-end))", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
            {stepLabels[step]}
          </div>
          <div style={{ display:"flex", justifyContent:"center", gap:6, marginTop:10 }}>
            {[1,2].map(s => (
              <div key={s} style={{ width:28, height:3, borderRadius:2, background: s <= step ? "var(--accent)" : "rgba(255,255,255,0.1)", transition:"background 0.3s" }} />
            ))}
          </div>
        </div>

        {/* Step 1: Format */}
        {step === 1 && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            {VARIANTS.map(v => (
              <button key={v.name} onClick={() => selectVariant(v)} style={variantCard(variant?.name === v.name)}>
                <span style={{ fontSize:26 }}>{v.emoji}</span>
                <span style={{ fontSize:12, fontWeight:700, color:"#e2e8f0" }}>{v.name}</span>
                <span style={{ fontSize:10, color:"#94a3b8", letterSpacing:"0.04em" }}>{v.desc}</span>
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Player count + life */}
        {step === 2 && (
          <>
            {/* Pod selector */}
            {validPods.length > 0 && (
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:10, color:"#94a3b8", letterSpacing:"0.15em", marginBottom:8, textAlign:"center" }}>POD</div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {validPods.map(pod => {
                    const active = selectedPodId === pod.id;
                    return (
                      <button key={pod.id} onClick={() => { setSelectedPodId(pod.id); setCount(pod.memberIds.length); }}
                        style={{ padding:"10px 14px", borderRadius:10, cursor:"pointer", textAlign:"left", fontFamily:"'Cinzel',serif",
                          background: active ? "var(--accent-bg)" : "rgba(255,255,255,0.04)",
                          border:`2px solid ${active ? "var(--accent)" : "rgba(255,255,255,0.1)"}`,
                          transition:"all 0.15s" }}>
                        <div style={{ fontSize:13, fontWeight:700, color: active ? "var(--accent)" : "#e2e8f0", marginBottom:2 }}>{pod.name}</div>
                        <div style={{ fontSize:11, color:"#94a3b8", fontFamily:"'Crimson Text',serif" }}>
                          {pod.memberIds.map(id => pName(id)).join(" · ")} · {pod.memberIds.length} players
                        </div>
                      </button>
                    );
                  })}
                  <button onClick={() => setSelectedPodId(null)}
                    style={{ padding:"8px 14px", borderRadius:10, cursor:"pointer", textAlign:"left", fontFamily:"'Cinzel',serif",
                      background: !selectedPodId ? "var(--accent-bg)" : "rgba(255,255,255,0.04)",
                      border:`2px solid ${!selectedPodId ? "var(--accent)" : "rgba(255,255,255,0.1)"}`,
                      transition:"all 0.15s" }}>
                    <div style={{ fontSize:12, color: !selectedPodId ? "var(--accent)" : "#94a3b8" }}>⚙ Custom — pick count manually</div>
                  </button>
                </div>
              </div>
            )}

            {/* Count selector — only when no pod selected */}
            {!selectedPodId && (
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:10, color:"#94a3b8", letterSpacing:"0.15em", marginBottom:8, textAlign:"center" }}>PLAYERS</div>
                <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
                  {(variant?.counts || [2,4,6]).map(n => (
                    <button key={n} onClick={() => setCount(n)} style={{ ...navBtn(count===n), padding:"12px 24px", fontSize:20, fontWeight:700 }}>{n}</button>
                  ))}
                </div>
              </div>
            )}

            {variant?.life === null ? (
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:10, color:"#94a3b8", letterSpacing:"0.15em", marginBottom:8, textAlign:"center" }}>STARTING LIFE</div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:8 }}>
                  {[20,30,40,60].map(hp => (
                    <button key={hp} onClick={() => { setLife(hp); setCustomLife(""); }} style={{ ...navBtn(life===hp && !customLife), padding:"10px 0", fontSize:16, fontWeight:700 }}>{hp}</button>
                  ))}
                </div>
                <input type="number" placeholder="Custom" value={customLife}
                  onChange={e => { setCustomLife(e.target.value); if (e.target.value) setLife(parseInt(e.target.value)||40); }}
                  style={{ ...INPUT, textAlign:"center", fontSize:15 }} />
              </div>
            ) : (
              <div style={{ textAlign:"center", marginBottom:20, padding:"14px", borderRadius:10, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontSize:10, color:"#94a3b8", letterSpacing:"0.15em", marginBottom:4 }}>STARTING LIFE</div>
                <div style={{ fontSize:32, fontWeight:700, color:"var(--accent)" }}>{life}</div>
              </div>
            )}

            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:10, color:"#94a3b8", letterSpacing:"0.15em", marginBottom:8, textAlign:"center" }}>TURN TIMER</div>
              <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
                {[{v:false,l:"OFF"},{v:true,l:"ON"}].map(({v,l}) => (
                  <button key={l} onClick={() => setTimerEnabled(v)}
                    style={{ ...navBtn(timerEnabled===v), padding:"10px 32px", fontSize:13, fontWeight:700 }}>{l}</button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom:24 }}>
              <div style={{ fontSize:10, color:"#94a3b8", letterSpacing:"0.15em", marginBottom:8, textAlign:"center" }}>GAME MODE</div>
              <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
                {[{v:"casual",l:"😌 Casual"},{v:"sweaty",l:"🏆 Sweaty"}].map(({v,l}) => (
                  <button key={v} onClick={() => setGameMode(v)}
                    style={{ ...navBtn(gameMode===v), padding:"10px 24px", fontSize:13, fontWeight:700 }}>{l}</button>
                ))}
              </div>
              <div style={{ textAlign:"center", fontSize:10, color:"#94a3b8", marginTop:7, fontFamily:"'Crimson Text',serif", fontStyle:"italic" }}>
                {gameMode === "casual" ? "Just play — no tracking" : "Auto-saves & tracks stats"}
              </div>
            </div>

            <style>{`@keyframes pulse-green { 0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,0.6),0 0 8px rgba(74,222,128,0.3);border-color:#4ade80} 50%{box-shadow:0 0 0 7px rgba(74,222,128,0),0 0 18px rgba(74,222,128,0.5);border-color:#86efac} }`}</style>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setStep(1)} style={{ ...btn(), flex:1, padding:13 }}>← Back</button>
              <button onClick={() => onStart({ count, life, playerOrder: computePlayerOrder(), firstSeat: 0, timerEnabled, gameMode, podId: selectedPodId || null })}
                style={{ ...btn("primary"), flex:1, padding:13, border:"2px solid #4ade80", animation:"pulse-green 1.8s ease-in-out infinite" }}>⚔ Start</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("setup");
  const [playerCount, setPlayerCount] = useState(() => load("cmdr_playerCount") || 4);
  const [startingLife, setStartingLife] = useState(() => load("cmdr_startingLife") || 40);
  const [newGameVersion, setNewGameVersion] = useState(0);
  const [gameConfig, setGameConfig] = useState({ playerOrder: [0,1,2,3,4,5], firstSeat: 0, timerEnabled: false });
  const [appThemeIdx, setAppThemeIdx] = useState(() => load("cmdr_appTheme") || 0);
  const appTheme = APP_THEMES[appThemeIdx] || APP_THEMES[0];
  const [players, setPlayers] = useState(() => load(STORAGE_KEYS.players) || [
    { id: uid(), name: "Player 1", emoji: "🐉" },
    { id: uid(), name: "Player 2", emoji: "💀" },
    { id: uid(), name: "Player 3", emoji: "⚡" },
    { id: uid(), name: "Player 4", emoji: "🌿" },
    { id: uid(), name: "Player 5", emoji: "🔥" },
    { id: uid(), name: "Player 6", emoji: "🌊" },
  ]);
  const [decks, setDecks] = useState(() => load(STORAGE_KEYS.decks) || []);
  const [games, setGames] = useState(() => load(STORAGE_KEYS.games) || []);
  const [themes, setThemes] = useState(() => { const t = load("cmdr_themes") || []; while(t.length < 6) t.push("default"); return t; });
  const [gifs, setGifs] = useState(() => { const g = load("cmdr_gifs") || []; while(g.length < 6) g.push(null); return g; });
  const [playerColors, setPlayerColors] = useState(() => { const c = load("cmdr_playerColors") || []; while(c.length < 6) c.push(null); return c; });
  const [pods, setPods] = useState(() => load("cmdr_pods") || []);

  useEffect(() => { save(STORAGE_KEYS.players, players); }, [players]);
  useEffect(() => { save(STORAGE_KEYS.decks, decks); }, [decks]);
  useEffect(() => { save(STORAGE_KEYS.games, games); }, [games]);
  useEffect(() => { save("cmdr_themes", themes); }, [themes]);
  useEffect(() => { save("cmdr_gifs", gifs); }, [gifs]);
  useEffect(() => { save("cmdr_playerCount", playerCount); }, [playerCount]);
  useEffect(() => { save("cmdr_startingLife", startingLife); }, [startingLife]);
  useEffect(() => { save("cmdr_appTheme", appThemeIdx); }, [appThemeIdx]);
  useEffect(() => { save("cmdr_playerColors", playerColors); }, [playerColors]);
  useEffect(() => { save("cmdr_pods", pods); }, [pods]);

  const saveGame = useCallback((g) => setGames(gs => [g, ...gs]), []);
  const deleteGame = useCallback((id) => setGames(gs => gs.filter(g => g.id !== id)), []);
  const importGames = useCallback((incoming) => {
    setGames(gs => {
      const existingIds = new Set(gs.map(g => g.id));
      const newOnes = incoming.filter(g => g.id && !existingIds.has(g.id));
      return [...gs, ...newOnes].sort((a,b) => b.createdAt - a.createdAt);
    });
  }, []);

  const handleSetupStart = ({ count, life, playerOrder, firstSeat, timerEnabled, gameMode, podId }) => {
    setPlayerCount(count);
    setStartingLife(life);
    setGameConfig({ playerOrder, firstSeat, timerEnabled, gameMode: gameMode ?? "casual", podId: podId || null });
    setNewGameVersion(v => v + 1);
    setScreen("game");
  };

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Crimson+Text:ital@0;1&display=swap" rel="stylesheet" />
      <style>{`:root { --bg:${appTheme.bg}; --modal-bg:${appTheme.modalBg}; --accent:${appTheme.accent}; --accent-dim:${appTheme.accentDim}; --accent-bg:${appTheme.accentBg}; --grad-start:${appTheme.gradStart}; --grad-end:${appTheme.gradEnd}; --glow:${appTheme.glow}; } @keyframes screenFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div style={{ fontFamily:"'Cinzel',serif" }}>
        {/* GameScreen always mounted — CSS hide keeps state alive during Roster/History nav */}
        <div style={{ display: screen === "game" ? "block" : "none", position: "fixed", inset: 0 }}>
          <GameScreen players={players} decks={decks} games={games} onSaveGame={saveGame} onNav={setScreen} themes={themes} gifs={gifs} playerCount={playerCount} startingLife={startingLife} appThemeIdx={appThemeIdx} setAppThemeIdx={setAppThemeIdx} playerColors={playerColors} setPlayerColors={setPlayerColors} newGameVersion={newGameVersion} onNewGame={() => setScreen("setup")} gameConfig={gameConfig} pods={pods} />
        </div>
        {screen === "setup"   && <div style={{ animation:"screenFadeIn 220ms ease-out" }}><SetupScreen defaultCount={playerCount} defaultLife={startingLife} onStart={handleSetupStart} pods={pods} players={players} /></div>}
        {screen === "history" && <div style={{ animation:"screenFadeIn 220ms ease-out" }}><History games={games} players={players} decks={decks} pods={pods} onDelete={deleteGame} onBack={()=>setScreen("game")} onImport={importGames} /></div>}
        {screen === "stats"   && <div style={{ animation:"screenFadeIn 220ms ease-out" }}><Stats games={games} players={players} decks={decks} pods={pods} onBack={()=>setScreen("game")} /></div>}
        {screen === "roster"  && <div style={{ animation:"screenFadeIn 220ms ease-out" }}><Roster players={players} setPlayers={setPlayers} decks={decks} setDecks={setDecks} themes={themes} setThemes={setThemes} gifs={gifs} setGifs={setGifs} pods={pods} setPods={setPods} onBack={()=>setScreen("game")} /></div>}
      </div>
    </>
  );
}
