"use strict";

/* ===== UTILITAS ===== */
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.random() * a.length | 0];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const TAU = Math.PI * 2;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};

/* ===== PENGATURAN (ubah angka di sini) ===== */
const CFG = {
  lives: 3, maxLives: 5,       // nyawa awal dan maksimum
  bombs: 2, maxBombs: 3,       // bom awal dan maksimum
  comboTime: 2.5,              // detik tanpa mengenai musuh sebelum combo kembali ke x1
  invuln: 2.2,                 // detik kebal setelah terkena
  shipSpeed: 520,              // kecepatan pesawat dengan keyboard
  dailyReward: 25              // bintang hadiah tantangan harian
};

/* ===== DATA (tambah pesawat, power-up, tantangan di sini) ===== */
const SHIPS = [
  { id: "nova",    name: "Nova",    color: "#22e4ff", cost: 0,   rate: 0.17, shots: 1 },
  { id: "rubi",    name: "Rubi",    color: "#ff3fa4", cost: 60,  rate: 0.12, shots: 1 },
  { id: "solar",   name: "Solar",   color: "#ffe14a", cost: 150, rate: 0.18, shots: 2 },
  { id: "phantom", name: "Phantom", color: "#a78bfa", cost: 300, rate: 0.16, shots: 3 }
];
const PU = {
  multi:  { icon: "⚡",  time: 10, label: "TEMBAKAN GANDA!", w: 3 },
  shield: { icon: "🛡️", time: 0,  label: "PERISAI!",        w: 2 },
  slow:   { icon: "⏳",  time: 5,  label: "WAKTU MELAMBAT!", w: 2 },
  magnet: { icon: "🧲",  time: 8,  label: "MAGNET!",         w: 2 },
  heart:  { icon: "💖",  time: 0,  label: "+1 NYAWA!",       w: 1 }
};
const BOSS_NAMES = ["RATU METEOR", "KAPAL INDUK", "MATA GALAKSI", "RAJA NEBULA"];
const DAILY = [
  { id: "meteor", goal: 30, text: "Hancurkan 30 meteor tanpa terkena" },
  { id: "wave",   goal: 5,  text: "Capai gelombang 5" },
  { id: "coins",  goal: 25, text: "Kumpulkan 25 bintang dalam satu permainan" },
  { id: "combo",  goal: 5,  text: "Capai combo x5" },
  { id: "kills",  goal: 60, text: "Hancurkan 60 musuh dalam satu permainan" }
];

/* ===== STATE ===== */
let state = "title", last = 0, flash = 0, fireT = 0, alarmT = 0, beat = 0, beatT = 0;
let touchMode = false, mouseDown = false;
let hiScore = store.get("nb-hi", 0), totalCoins = store.get("nb-coins", 0);
let unlocked = store.get("nb-ships", ["nova"]), selId = store.get("nb-ship", "nova");
if (!unlocked.includes(selId)) selId = "nova";
let soundOn = store.get("nb-sound", true);
const ship = { x: 0, y: 0, alive: false }, target = { x: 0, y: 0 };
const keys = {};
let bullets = [], ebullets = [], enemies = [], items = [], parts = [], floats = [];
const run = {}, wave = {}, pu = { multi: 0, slow: 0, magnet: 0, shield: false };
const shipDef = () => SHIPS.find(s => s.id === selId);

/* ===== KANVAS ===== */
const cv = $("game"), ctx = cv.getContext("2d");
let W = 0, H = 0, DPR = 1;
const LAYERS = [{ n: 50, v: 20, s: 1, a: 0.35 }, { n: 30, v: 55, s: 1.6, a: 0.6 }, { n: 14, v: 120, s: 2.2, a: 0.9 }];
let stars = [];
function initStars() {
  stars = LAYERS.map(L => Array.from({ length: L.n }, () => ({ x: Math.random() * W, y: Math.random() * H })));
}
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cv.width = W * DPR | 0; cv.height = H * DPR | 0;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  initStars();
  ship.x = clamp(ship.x, 22, W - 22); ship.y = clamp(ship.y, H * 0.3, H - 34);
  target.x = clamp(target.x, 22, W - 22); target.y = clamp(target.y, H * 0.3, H - 34);
}
function updateStars(dt, boost) {
  stars.forEach((arr, i) => arr.forEach(s => {
    s.y += LAYERS[i].v * boost * dt;
    if (s.y > H) { s.y = -2; s.x = Math.random() * W; }
  }));
}

/* ===== SUARA (Web Audio) ===== */
let actx, master, noiseBuf;
function audio() {
  if (actx) return actx;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 0.5; master.connect(actx.destination);
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { actx = null; }
  return actx;
}
function unlock() { const a = audio(); if (a && a.state === "suspended") a.resume(); }
function tone(f, d, type = "square", v = 0.08, to = 0, delay = 0) {
  if (!soundOn || !audio()) return;
  const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + d + 0.02);
}
function noise(d, v = 0.15, freq = 1200) {
  if (!soundOn || !audio()) return;
  const t = actx.currentTime, s = actx.createBufferSource(), g = actx.createGain(), f = actx.createBiquadFilter();
  s.buffer = noiseBuf; f.type = "lowpass";
  f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(100, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + d);
}
const sfx = {
  shoot:   () => tone(900, 0.07, "square", 0.03, 300),
  boom:    () => { noise(0.25, 0.18, 1800); tone(120, 0.2, "sawtooth", 0.08, 40); },
  bigBoom: () => { noise(0.9, 0.4, 2600); tone(70, 0.7, "sawtooth", 0.15, 25); },
  coin:    () => tone(1320, 0.06, "triangle", 0.07),
  pickup:  () => { tone(660, 0.08, "triangle", 0.1); tone(990, 0.1, "triangle", 0.1, 0, 0.07); },
  hit:     () => { noise(0.4, 0.3, 1500); tone(160, 0.3, "sawtooth", 0.12, 50); },
  bomb:    () => { noise(0.9, 0.4, 3000); tone(200, 0.6, "sawtooth", 0.15, 30); },
  alarm:   () => tone(880, 0.12, "square", 0.05),
  combo:   () => tone(780, 0.1, "triangle", 0.08, 1170),
  wave:    () => { tone(392, 0.1, "triangle", 0.08); tone(523, 0.1, "triangle", 0.08, 0, 0.1); tone(659, 0.14, "triangle", 0.08, 0, 0.2); },
  bossIn:  () => { [0, 0.3, 0.6].forEach(d => tone(110, 0.28, "sawtooth", 0.14, 70, d)); },
  win:     () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, "triangle", 0.09, 0, i * 0.1)); },
  over:    () => { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.25, "sawtooth", 0.08, 0, i * 0.22)); }
};
const BASS = [55, 55, 82.4, 55, 65.4, 55, 82.4, 98];
function music(dt) {
  beatT -= dt; if (beatT > 0) return;
  const danger = run.lives === 1;
  beatT = danger ? 0.2 : Math.max(0.17, 0.32 - run.wave * 0.008);
  tone(BASS[beat++ % 8] * (danger ? 1.5 : 1), 0.16, "triangle", 0.06);
}

/* ===== UI ===== */
const cache = {};
function setText(id, v) { v = String(v); if (cache[id] !== v) { cache[id] = v; $(id).textContent = v; } }
function showScreen(id) { document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === id)); }
function setPlayUI(on) {
  ["hud", "powerups", "controls", "btn-bomb"].forEach(i => $(i).classList.toggle("hidden", !on));
  if (!on) { $("boss-bar").classList.add("hidden"); $("danger").classList.remove("on"); }
}
function banner(text, boss) {
  const b = $("banner"); b.textContent = text;
  b.classList.remove("show", "boss"); void b.offsetWidth;
  if (boss) b.classList.add("boss");
  b.classList.add("show");
}
function shake() { const w = $("game-wrap"); w.classList.remove("shake"); void w.offsetWidth; w.classList.add("shake"); }
function updateHud() {
  setText("score", run.score); setText("hi-score", Math.max(hiScore, run.score)); setText("coins", run.coins);
  setText("wave", "Gelombang " + run.wave + (run.wave % 5 === 0 ? " (BOS)" : ""));
  setText("combo", "x" + run.mult);
  const lk = run.lives + "|" + run.bombs;
  if (cache.lk !== lk) {
    cache.lk = lk;
    $("lives").innerHTML = '<span class="heart">❤️</span>'.repeat(run.lives) + '<span class="heart">🖤</span>'.repeat(Math.max(0, 3 - run.lives));
    let b = ""; for (let i = 0; i < CFG.maxBombs; i++) b += '<i class="bomb-dot' + (i < run.bombs ? "" : " empty") + '"></i>';
    $("bombs").innerHTML = b;
    $("btn-bomb").classList.toggle("empty", run.bombs <= 0);
  }
  $("danger").classList.toggle("on", state === "playing" && run.lives === 1);
}
let chipKey = "", chipEls = {};
function syncChips() {
  const act = [];
  if (pu.multi > 0) act.push("multi"); if (pu.slow > 0) act.push("slow");
  if (pu.magnet > 0) act.push("magnet"); if (pu.shield) act.push("shield");
  const key = act.join(), box = $("powerups");
  if (key !== chipKey) {
    chipKey = key; box.innerHTML = ""; chipEls = {};
    act.forEach(k => {
      const d = document.createElement("div"); d.className = "pu-chip";
      d.innerHTML = PU[k].icon + "<i></i>"; box.appendChild(d); chipEls[k] = d.querySelector("i");
    });
  }
  act.forEach(k => { chipEls[k].style.width = (k === "shield" ? 100 : pu[k] / PU[k].time * 100) + "%"; });
}

/* ===== TANTANGAN HARIAN ===== */
const todayKey = () => { const d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); };
const D = (() => { const d = new Date(); return DAILY[Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 864e5) % DAILY.length]; })();
let dailyDone = store.get("nb-daily", "") === todayKey();
function renderDaily() {
  const el = $("daily");
  el.textContent = dailyDone ? "✅ Tantangan harian selesai!" : "🎯 Tantangan harian: " + D.text + " (+" + CFG.dailyReward + " ⭐)";
  el.classList.toggle("done", dailyDone);
}
function dailyProgress() {
  return D.id === "meteor" ? run.meteors : D.id === "wave" ? run.wave : D.id === "coins" ? run.coins : D.id === "combo" ? run.maxMult : run.kills;
}
function checkDaily() {
  if (dailyDone || state !== "playing" || dailyProgress() < D.goal) return;
  dailyDone = true; store.set("nb-daily", todayKey());
  totalCoins += CFG.dailyReward; store.set("nb-coins", totalCoins);
  banner("TANTANGAN SELESAI!"); sfx.win(); renderDaily();
}

/* ===== GAMBAR ===== */
function glow(c, b) { ctx.shadowColor = c; ctx.shadowBlur = b; }
function poly(pts) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); }
function hex(r) { const p = []; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + Math.PI / 6; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return p; }
function drawShip(c, x, y, col, s, flame) {
  c.save(); c.translate(x, y); c.scale(s, s);
  c.shadowColor = "#ff7a00"; c.shadowBlur = 12; c.fillStyle = "#ffb703";
  c.beginPath(); c.moveTo(-7, 14); c.lineTo(0, 14 + 14 * flame); c.lineTo(7, 14); c.closePath(); c.fill();
  c.shadowColor = col; c.shadowBlur = 14; c.fillStyle = "#0e1b3d"; c.strokeStyle = col; c.lineWidth = 2.5; c.lineJoin = "round";
  c.beginPath(); c.moveTo(0, -24); c.lineTo(8, -4); c.lineTo(26, 14); c.lineTo(26, 20); c.lineTo(10, 14);
  c.lineTo(0, 20); c.lineTo(-10, 14); c.lineTo(-26, 20); c.lineTo(-26, 14); c.lineTo(-8, -4); c.closePath(); c.fill(); c.stroke();
  c.fillStyle = col; c.beginPath(); c.ellipse(0, -2, 3.5, 7, 0, 0, TAU); c.fill();
  c.restore();
}
function drawPlayer() {
  if (run.invuln > 0 && ((run.invuln * 10 | 0) % 2)) return;
  drawShip(ctx, ship.x, ship.y, shipDef().color, 1, 0.6 + Math.random() * 0.6);
  if (pu.shield) {
    ctx.save(); glow("#22e4ff", 16); ctx.strokeStyle = "rgba(34,228,255,.8)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ship.x, ship.y, 36, 0, TAU); ctx.stroke(); ctx.restore();
  }
}
function drawEnemy(e) {
  ctx.save(); ctx.translate(e.x, e.y); ctx.lineWidth = 3; ctx.lineJoin = "round";
  const f = e.flash > 0, fill = f ? "#fff" : "#150d33";
  switch (e.type) {
    case "meteor": {
      ctx.rotate(e.rot); glow("#ff9f1c", 10); ctx.strokeStyle = "#ff9f1c"; ctx.fillStyle = f ? "#fff" : "#2a1b3d";
      const n = e.verts.length; ctx.beginPath();
      e.verts.forEach((v, i) => { const a = i / n * TAU, x = Math.cos(a) * e.r * v, y = Math.sin(a) * e.r * v; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
      if (e.big) { ctx.fillStyle = "rgba(255,159,28,.25)"; ctx.beginPath(); ctx.arc(-e.r * 0.25, -e.r * 0.2, e.r * 0.22, 0, TAU); ctx.fill(); }
      break;
    }
    case "chaser":
      glow("#ff3fa4", 12); ctx.strokeStyle = "#ff3fa4"; ctx.fillStyle = fill;
      poly([[0, 20], [16, -2], [22, -14], [6, -8], [0, -16], [-6, -8], [-22, -14], [-16, -2]]); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill(); break;
    case "shooter":
      glow("#8b5cf6", 12); ctx.strokeStyle = "#8b5cf6"; ctx.fillStyle = fill;
      ctx.beginPath(); ctx.ellipse(0, 4, e.r + 4, 11, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#22e4ff"; ctx.beginPath(); ctx.ellipse(0, -3, 12, 10, 0, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = "#ffe14a"; [-14, 0, 14].forEach(x => { ctx.beginPath(); ctx.arc(x, 5, 2.5, 0, TAU); ctx.fill(); }); break;
    case "shield":
      glow("#58f58a", 12); ctx.strokeStyle = "#58f58a"; ctx.fillStyle = fill;
      poly(hex(e.r)); ctx.fill(); ctx.stroke(); ctx.lineWidth = 2; poly(hex(e.r * 0.55)); ctx.stroke();
      ctx.fillStyle = "#58f58a";
      for (let i = 0; i < e.hp; i++) { ctx.beginPath(); ctx.arc((i - (e.hp - 1) / 2) * 9, 0, 3, 0, TAU); ctx.fill(); } break;
    case "boss": {
      const c = e.phase === 3 ? "#ff2d55" : e.phase === 2 ? "#ff9f1c" : "#ff4d5e";
      glow(c, 20); ctx.strokeStyle = c; ctx.fillStyle = f ? "#fff" : "#1a0b2e"; ctx.lineWidth = 5;
      poly(hex(e.r)); ctx.fill(); ctx.stroke(); ctx.lineWidth = 3; poly(hex(e.r * 0.6)); ctx.stroke();
      ctx.fillStyle = c; [-1, 1].forEach(s => ctx.fillRect(s * e.r * 0.9 - 8, -10, 16, 34));
      glow("#ffe14a", 14); ctx.fillStyle = "#ffe14a";
      [-1, 1].forEach(s => { ctx.beginPath(); ctx.ellipse(s * e.r * 0.25, -4, 9, 13, 0, 0, TAU); ctx.fill(); });
      ctx.shadowBlur = 0; ctx.fillStyle = "#1a0b2e";
      [-1, 1].forEach(s => { ctx.beginPath(); ctx.arc(s * e.r * 0.25, 0, 4, 0, TAU); ctx.fill(); });
      break;
    }
  }
  ctx.restore();
}
function drawItems() {
  items.forEach(it => {
    ctx.save(); ctx.translate(it.x, it.y);
    if (it.kind === "coin") {
      ctx.rotate(it.t * 2); glow("#ffe14a", 10); ctx.fillStyle = "#ffe14a"; ctx.strokeStyle = "#fff6c4"; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 5 : 12, a = i / 10 * TAU - Math.PI / 2; i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else {
      glow("#22e4ff", 14); ctx.strokeStyle = "#22e4ff"; ctx.fillStyle = "rgba(10,8,40,.85)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 17, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0; ctx.font = "18px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(PU[it.type].icon, 0, 1);
    }
    ctx.restore();
  });
}
function drawBullets() {
  const col = shipDef().color;
  ctx.save(); glow(col, 10); ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = "round";
  bullets.forEach(b => { ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.03, b.y - b.vy * 0.03); ctx.stroke(); });
  glow("#ff3fa4", 12); ctx.fillStyle = "#ff3fa4";
  ebullets.forEach(b => { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill(); });
  ctx.shadowBlur = 0; ctx.fillStyle = "#fff";
  ebullets.forEach(b => { ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.45, 0, TAU); ctx.fill(); });
  ctx.restore();
}
function drawFx() {
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  parts.forEach(p => { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.col; ctx.fillRect(p.x, p.y, p.size, p.size); });
  ctx.restore();
  ctx.save(); ctx.font = "bold 16px Orbitron, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#ffe14a";
  floats.forEach(f => { ctx.globalAlpha = clamp(f.life, 0, 1); ctx.fillText(f.text, f.x, f.y); });
  ctx.restore();
}
function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  stars.forEach((arr, i) => { ctx.globalAlpha = LAYERS[i].a; arr.forEach(s => ctx.fillRect(s.x, s.y, LAYERS[i].s, LAYERS[i].s * 2)); });
  ctx.globalAlpha = 1;
  drawItems(); enemies.forEach(drawEnemy); drawBullets();
  if (ship.alive) drawPlayer();
  drawFx();
  if (flash > 0) { ctx.fillStyle = "rgba(255,255,255," + flash * 0.8 + ")"; ctx.fillRect(0, 0, W, H); }
}

/* ===== EFEK ===== */
function burst(x, y, col, n, spd, life, size) {
  for (let i = 0; i < n && parts.length < 600; i++) {
    const a = rand(0, TAU), s = rand(0.2, 1) * spd, l = rand(0.4, 1) * life;
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: l, max: l, col, size: rand(1, size) });
  }
}
function explode(x, y, r, col) { burst(x, y, col, Math.min(40, r | 0), 260, 0.7, 4); burst(x, y, "#fff", 6, 160, 0.35, 3); }
function addFloat(x, y, text) { floats.push({ x, y, text, life: 1.2 }); }
function updateFx(dt) {
  parts.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
  parts = parts.filter(p => p.life > 0);
  floats.forEach(f => { f.y -= 40 * dt; f.life -= dt; });
  floats = floats.filter(f => f.life > 0);
}

/* ===== MUSUH ===== */
const makeVerts = () => Array.from({ length: 10 }, () => rand(0.75, 1.1));
function spawnEnemy(type, x, y, small) {
  if (enemies.length > 40) return null;
  const n = run.wave, sp = 95 + Math.min(n, 25) * 5;
  const e = { type, x: x ?? rand(40, W - 40), y: y ?? -50, vx: 0, vy: sp, r: 20, hp: 1, t: Math.random() * 10,
    flash: 0, rot: 0, spin: rand(-1.5, 1.5), cd: rand(0.6, 1.4), ph: Math.random() * TAU };
  if (type === "meteor") {
    e.big = !small; e.verts = makeVerts();
    if (small) { e.r = rand(15, 19); e.vy = sp * rand(0.9, 1.4); }
    else { e.r = rand(30, 38); e.hp = 2 + (n >= 8 ? 1 : 0) + (n >= 16 ? 1 : 0); e.vy = sp * rand(0.7, 1.1); }
    e.vx = rand(-50, 50);
  } else if (type === "chaser") { e.r = 18; e.vy = sp * 0.85; }
  else if (type === "shooter") { e.r = 24; e.hp = 2 + (n >= 10 ? 1 : 0); e.vy = sp * 1.1; e.stopY = rand(70, 170); }
  else if (type === "shield") { e.r = 28; e.hp = 3 + (n >= 12 ? 1 : 0); e.vy = sp * 0.5; }
  else if (type === "boss") {
    e.r = 72; e.maxHp = e.hp = 70 + n * 5; e.phase = 0; e.cd = 1.5; e.sp = 0; e.ang = 0; e.mt = 3;
  }
  enemies.push(e); return e;
}
function chooseType() {
  const n = run.wave, t = [["meteor", 6]];
  if (n >= 2) t.push(["chaser", 2 + n / 3]);
  if (n >= 3) t.push(["shooter", 1.5 + n / 4]);
  if (n >= 4) t.push(["shield", 1 + n / 5]);
  let r = Math.random() * t.reduce((s, x) => s + x[1], 0);
  for (const [k, w] of t) { if ((r -= w) <= 0) return k; }
  return "meteor";
}
function shootAt(e, speed, spread) {
  if (ebullets.length > 300) return;
  const a = Math.atan2(ship.y - e.y, ship.x - e.x) + (spread || 0);
  ebullets.push({ x: e.x, y: e.y + e.r * 0.5, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 6 });
}
function fan(e, n, total, speed) {
  for (let i = 0; i < n; i++) shootAt(e, speed, (i - (n - 1) / 2) * (total / Math.max(1, n - 1)));
}
function updateBoss(e, dt) {
  const ratio = e.hp / e.maxHp, ph = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
  if (ph !== e.phase) {
    if (e.phase) { banner("FASE " + ph, true); shake(); sfx.bossIn(); }
    e.phase = ph; e.cd = 1;
  }
  e.y += (130 - e.y) * Math.min(1, dt * 1.5);
  e.x = W / 2 + Math.sin(e.t * (0.5 + ph * 0.18)) * (W * 0.32);
  const spd = 210 + ph * 25 + run.wave * 2;
  e.cd -= dt;
  if (e.cd <= 0) {
    if (ph === 1) { e.cd = 1.3; fan(e, 3, 0.28, spd); }
    else if (ph === 2) { e.cd = 1.0; fan(e, 5, 0.9, spd); }
    else { e.cd = 0.75; fan(e, 7, 1.3, spd); }
  }
  if (ph === 3) {
    e.sp -= dt;
    if (e.sp <= 0 && ebullets.length < 300) {
      e.sp = 0.14; e.ang += 0.55;
      const a = Math.PI / 2 + Math.sin(e.ang) * 1.2;
      ebullets.push({ x: e.x, y: e.y + 40, vx: Math.cos(a) * 170, vy: Math.sin(a) * 170, r: 6 });
    }
    e.mt -= dt;
    if (e.mt <= 0) { e.mt = 4; spawnEnemy("meteor", rand(40, W - 40)); }
  }
}
function updateEnemy(e, dt) {
  e.t += dt; e.rot += e.spin * dt; if (e.flash > 0) e.flash -= dt;
  switch (e.type) {
    case "meteor": e.x += e.vx * dt; e.y += e.vy * dt; break;
    case "chaser": e.x += (Math.sin(e.t * 3 + e.ph) * 150 + (ship.x - e.x) * 0.35) * dt; e.y += e.vy * dt; e.x = clamp(e.x, 20, W - 20); break;
    case "shooter":
      if (e.t >= 14) e.y += 170 * dt;
      else if (e.y < e.stopY) e.y += e.vy * dt;
      else {
        e.x = clamp(e.x + Math.sin(e.t * 1.4 + e.ph) * 120 * dt, 30, W - 30);
        e.cd -= dt;
        if (e.cd <= 0) { e.cd = Math.max(0.9, 1.8 - run.wave * 0.04); shootAt(e, 250 + run.wave * 4); }
      }
      break;
    case "shield": e.y += e.vy * dt; e.x = clamp(e.x + Math.sin(e.t * 1.2 + e.ph) * 50 * dt, 30, W - 30); break;
    case "boss": updateBoss(e, dt); break;
  }
}

/* ===== GELOMBANG ===== */
function startWave(n) {
  run.wave = n;
  wave.boss = n % 5 === 0; wave.bossOut = false; wave.pause = 0;
  wave.left = wave.boss ? 4 : Math.min(7 + n * 3, 55);
  wave.interval = Math.max(0.32, 1.15 - n * 0.05);
  wave.t = wave.boss ? 2.2 : 1.2;
  banner(wave.boss ? "BOS MUNCUL!" : "GELOMBANG " + n, wave.boss);
  if (wave.boss) sfx.bossIn(); else sfx.wave();
  checkDaily();
}
function updateWave(dt) {
  if (wave.pause > 0) { wave.pause -= dt; if (wave.pause <= 0) startWave(run.wave + 1); return; }
  wave.t -= dt;
  if (wave.boss && !wave.bossOut) {
    if (wave.t <= 0) {
      const b = spawnEnemy("boss", W / 2, -120);
      if (b) $("boss-name").textContent = BOSS_NAMES[(run.wave / 5 - 1) % BOSS_NAMES.length];
      wave.bossOut = true; wave.t = 2;
    }
    return;
  }
  if (wave.left > 0 && wave.t <= 0) {
    spawnEnemy(wave.boss ? "meteor" : chooseType());
    wave.left--; wave.t = wave.interval * rand(0.7, 1.3);
  }
  if (wave.left <= 0 && enemies.length === 0) wave.pause = 1.8;
}

/* ===== PEMAIN ===== */
function fire() {
  const count = clamp(shipDef().shots + (pu.multi > 0 ? 2 : 0), 1, 5), sp = 760;
  const mk = (x, a) => bullets.push({ x, y: ship.y - 20, vx: Math.sin(a) * sp, vy: -Math.cos(a) * sp, dmg: 1, r: 5 });
  if (count === 2) { mk(ship.x - 9, 0); mk(ship.x + 9, 0); }
  else for (let i = 0; i < count; i++) mk(ship.x, (i - (count - 1) / 2) * 0.15);
  sfx.shoot();
}
function addStreak() {
  run.streak++; run.comboT = CFG.comboTime;
  const m = Math.min(8, 1 + Math.floor(run.streak / 5));
  if (m !== run.mult) {
    run.mult = m; if (m > run.maxMult) run.maxMult = m;
    const c = $("combo"); c.classList.remove("pop"); void c.offsetWidth; c.classList.add("pop");
    if (m > 1) sfx.combo();
    checkDaily();
  }
}
function resetCombo() { run.streak = 0; run.mult = 1; run.comboT = 0; }
function hitPlayer() {
  if (run.invuln > 0 || !ship.alive) return;
  if (pu.shield) {
    pu.shield = false; run.invuln = 1;
    burst(ship.x, ship.y, "#22e4ff", 24, 260, 0.5, 3); sfx.hit(); shake(); return;
  }
  run.lives--; resetCombo();
  if (D.id === "meteor") run.meteors = 0;
  run.invuln = CFG.invuln; sfx.hit(); shake();
  burst(ship.x, ship.y, "#ff4d5e", 30, 280, 0.7, 4);
  if (run.lives <= 0) gameOver();
}
function pickPU() {
  const ks = Object.keys(PU); let r = Math.random() * ks.reduce((s, k) => s + PU[k].w, 0);
  for (const k of ks) { if ((r -= PU[k].w) <= 0) return k; }
  return "multi";
}
function pickup(type) {
  const d = PU[type]; sfx.pickup();
  if (type === "shield") pu.shield = true;
  else if (type === "heart") { if (run.lives < CFG.maxLives) run.lives++; else run.score += 200; }
  else pu[type] = d.time;
  addFloat(ship.x, ship.y - 34, d.label);
}
function useBomb() {
  if (state !== "playing" || run.bombs <= 0) return;
  run.bombs--; flash = 1; shake(); sfx.bomb();
  enemies.forEach(e => {
    if (e.type === "boss") { e.hp -= Math.max(25, e.maxHp * 0.2); e.flash = 0.2; if (e.hp <= 0) killEnemy(e, true); }
    else killEnemy(e, true);
  });
  ebullets.length = 0;
  burst(ship.x, ship.y, "#ffe14a", 60, 600, 0.9, 4);
}

/* ===== HANCUR & HADIAH ===== */
function killEnemy(e, bomb) {
  if (e.dead) return;
  e.dead = true; run.kills++;
  const t = e.type;
  const pts = t === "meteor" ? (e.big ? 10 : 5) : t === "chaser" ? 25 : t === "shooter" ? 40 : t === "shield" ? 60 : 500 + run.wave * 50;
  run.score += pts * run.mult;
  explode(e.x, e.y, e.r, t === "meteor" ? "#ff9f1c" : t === "chaser" ? "#ff3fa4" : t === "shield" ? "#58f58a" : t === "boss" ? "#ff4d5e" : "#8b5cf6");
  if (t === "boss") {
    banner("BOS KALAH!"); shake(); flash = 0.8; sfx.bigBoom(); ebullets.length = 0;
    run.bombs = Math.min(CFG.maxBombs, run.bombs + 1);
    burst(e.x, e.y, "#ffe14a", 80, 500, 1.1, 5);
    items.push({ kind: "pu", type: "heart", x: e.x, y: e.y, vy: 90, t: 0 });
    for (let i = 0; i < 8; i++) items.push({ kind: "coin", x: e.x + rand(-50, 50), y: e.y + rand(-30, 30), vy: 110, t: 0 });
  } else {
    sfx.boom();
    if (t === "meteor") {
      run.meteors++;
      if (e.big && !bomb) {
        const a = spawnEnemy("meteor", e.x - 14, e.y, true), b = spawnEnemy("meteor", e.x + 14, e.y, true);
        if (a) a.vx = -70; if (b) b.vx = 70;
      }
    }
    if (Math.random() < (t === "meteor" ? 0.18 : 0.35)) items.push({ kind: "coin", x: e.x, y: e.y, vy: 110, t: 0 });
    const pc = { meteor: 0.04, chaser: 0.08, shooter: 0.2, shield: 0.3 }[t] || 0;
    if (Math.random() < pc) items.push({ kind: "pu", type: pickPU(), x: e.x, y: e.y, vy: 95, t: 0 });
  }
  checkDaily();
}

/* ===== TABRAKAN & BENDA ===== */
function collide() {
  for (const b of bullets) {
    for (const e of enemies) {
      if (e.dead || b.dead) continue;
      const dx = b.x - e.x, dy = b.y - e.y, rr = e.r + b.r;
      if (dx * dx + dy * dy < rr * rr) {
        b.dead = true; e.hp -= b.dmg; e.flash = 0.08;
        burst(b.x, b.y, "#fff", 3, 120, 0.2, 2); addStreak();
        if (e.hp <= 0) killEnemy(e);
      }
    }
  }
  if (!ship.alive) return;
  for (const e of enemies) {
    if (e.dead) continue;
    const dx = ship.x - e.x, dy = ship.y - e.y, rr = e.r * 0.8 + 12;
    if (dx * dx + dy * dy < rr * rr) {
      if (e.type !== "boss") { e.dead = true; explode(e.x, e.y, e.r, "#ff9f1c"); sfx.boom(); }
      hitPlayer();
    }
  }
  for (const b of ebullets) {
    const dx = ship.x - b.x, dy = ship.y - b.y, rr = b.r + 10;
    if (dx * dx + dy * dy < rr * rr) { b.dead = true; hitPlayer(); }
  }
}
function updateItems(dt) {
  for (const it of items) {
    it.t += dt;
    const dx = ship.x - it.x, dy = ship.y - it.y, d = Math.hypot(dx, dy);
    if (it.kind === "coin" && d > 1 && ((pu.magnet > 0 && d < 460) || d < 90)) { it.x += dx / d * 520 * dt; it.y += dy / d * 520 * dt; }
    else it.y += it.vy * dt;
    if (d < 26) {
      it.dead = true;
      if (it.kind === "coin") { run.coins++; sfx.coin(); checkDaily(); } else pickup(it.type);
    }
  }
}

/* ===== LOOP UTAMA ===== */
function update(dt) {
  const sdt = pu.slow > 0 ? dt * 0.5 : dt;
  updateStars(dt, 1 + run.wave * 0.04);
  ["multi", "slow", "magnet"].forEach(k => { if (pu[k] > 0) pu[k] = Math.max(0, pu[k] - dt); });
  if (run.invuln > 0) run.invuln -= dt;
  if (flash > 0) flash = Math.max(0, flash - dt * 1.6);
  if (run.comboT > 0) { run.comboT -= dt; if (run.comboT <= 0) resetCombo(); }

  const dx = (keys.r ? 1 : 0) - (keys.l ? 1 : 0), dy = (keys.d ? 1 : 0) - (keys.u ? 1 : 0);
  if (dx || dy) {
    target.x = clamp(target.x + dx * CFG.shipSpeed * dt, 22, W - 22);
    target.y = clamp(target.y + dy * CFG.shipSpeed * dt, H * 0.3, H - 34);
  }
  const k = Math.min(1, dt * 16);
  ship.x += (target.x - ship.x) * k; ship.y += (target.y - ship.y) * k;

  fireT -= dt;
  if ((keys.fire || mouseDown || touchMode) && fireT <= 0) { fire(); fireT = shipDef().rate; }

  updateWave(dt);
  enemies.forEach(e => updateEnemy(e, sdt));
  bullets.forEach(b => { b.x += b.vx * dt; b.y += b.vy * dt; });
  ebullets.forEach(b => { b.x += b.vx * sdt; b.y += b.vy * sdt; });
  collide();
  updateItems(dt);

  enemies = enemies.filter(e => !e.dead && e.y < H + 90 && e.x > -130 && e.x < W + 130);
  bullets = bullets.filter(b => !b.dead && b.y > -30 && b.x > -30 && b.x < W + 30);
  ebullets = ebullets.filter(b => !b.dead && b.y < H + 30 && b.y > -40 && b.x > -30 && b.x < W + 30);
  items = items.filter(i => !i.dead && i.y < H + 30);

  const boss = enemies.find(e => e.type === "boss");
  $("boss-bar").classList.toggle("hidden", !boss);
  if (boss) $("boss-fill").style.width = Math.max(0, boss.hp / boss.maxHp * 100) + "%";

  if (run.lives === 1) { alarmT -= dt; if (alarmT <= 0) { alarmT = 1; sfx.alarm(); } }
  music(dt);
  updateFx(dt); syncChips(); updateHud();
}
function frame(ts) {
  const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
  if (state === "playing") update(dt);
  else if (state !== "paused") { updateStars(dt, state === "title" ? 1.6 : 0.5); updateFx(dt); }
  draw(); requestAnimationFrame(frame);
}

/* ===== ALUR PERMAINAN ===== */
function newRun() {
  Object.assign(run, { score: 0, lives: CFG.lives, bombs: CFG.bombs, wave: 0, streak: 0, mult: 1, maxMult: 1,
    coins: 0, kills: 0, meteors: 0, comboT: 0, invuln: 0, banked: false });
  Object.assign(pu, { multi: 0, slow: 0, magnet: 0, shield: false });
  Object.keys(cache).forEach(k => delete cache[k]);
  chipKey = "x"; alarmT = 0; beatT = 0;
}
function bank() {
  if (run.banked) return;
  run.banked = true; totalCoins += run.coins; store.set("nb-coins", totalCoins);
}
function startGame() {
  unlock(); newRun();
  bullets = []; ebullets = []; enemies = []; items = []; parts = []; floats = [];
  ship.x = W / 2; ship.y = H * 0.8; target.x = ship.x; target.y = ship.y; ship.alive = true;
  fireT = 0; flash = 0;
  setPlayUI(true); showScreen(null); state = "playing";
  startWave(1); updateHud();
}
function gameOver() {
  ship.alive = false; state = "over";
  explode(ship.x, ship.y, 40, "#22e4ff"); sfx.bigBoom(); sfx.over(); shake();
  $("danger").classList.remove("on");
  const rec = run.score > hiScore;
  if (rec) { hiScore = run.score; store.set("nb-hi", hiScore); }
  $("final-score").textContent = run.score; $("final-wave").textContent = run.wave;
  $("final-combo").textContent = "x" + run.maxMult; $("final-coins").textContent = run.coins;
  $("new-record").classList.toggle("hidden", !rec);
  bank();
  setTimeout(() => { if (state === "over") { setPlayUI(false); showScreen("screen-over"); } }, 900);
}
function pause() { if (state !== "playing") return; state = "paused"; mouseDown = false; showScreen("screen-pause"); }
function resume() { if (state !== "paused") return; state = "playing"; showScreen(null); }
function toMenu() {
  bank(); state = "title"; ship.alive = false;
  bullets = []; ebullets = []; enemies = []; items = [];
  setPlayUI(false); updateTitle(); showScreen("screen-title");
}

/* ===== JUDUL, PESAWAT & SUARA ===== */
function renderShips() {
  const box = $("ships"); box.innerHTML = "";
  SHIPS.forEach(s => {
    const own = unlocked.includes(s.id), b = document.createElement("button");
    b.type = "button"; b.className = "ship" + (s.id === selId ? " selected" : "") + (own ? "" : " locked");
    b.setAttribute("aria-label", "Pesawat " + s.name + (own ? "" : ", terkunci, " + s.cost + " bintang"));
    const c = document.createElement("canvas"); c.width = c.height = 112;
    drawShip(c.getContext("2d"), 56, 58, s.color, 1.5, 0.6);
    const name = document.createElement("span"); name.textContent = s.name;
    b.appendChild(c); b.appendChild(name);
    let cost = null;
    if (!own) { cost = document.createElement("span"); cost.className = "cost"; cost.textContent = "⭐ " + s.cost; b.appendChild(cost); }
    b.onclick = () => {
      unlock();
      if (own) { selId = s.id; store.set("nb-ship", selId); sfx.coin(); renderShips(); }
      else if (totalCoins >= s.cost) {
        totalCoins -= s.cost; unlocked.push(s.id); selId = s.id;
        store.set("nb-coins", totalCoins); store.set("nb-ships", unlocked); store.set("nb-ship", selId);
        sfx.pickup(); updateTitle();
      } else {
        cost.textContent = "Butuh " + (s.cost - totalCoins) + " ⭐ lagi"; sfx.alarm();
        setTimeout(renderShips, 1500);
      }
    };
    box.appendChild(b);
  });
}
function updateTitle() {
  $("title-hi").textContent = hiScore; $("title-coins").textContent = totalCoins;
  renderShips(); renderDaily();
}
function syncSound() { $("btn-sound").textContent = soundOn ? "🔊" : "🔇"; }

/* ===== KONTROL ===== */
function setTarget(e) {
  target.x = clamp(e.clientX, 22, W - 22);
  target.y = clamp(e.clientY - (e.pointerType === "touch" ? 80 : 0), H * 0.3, H - 34);
}
cv.addEventListener("pointerdown", e => {
  unlock(); if (state !== "playing") return;
  if (e.pointerType !== "touch") mouseDown = true;
  setTarget(e);
});
cv.addEventListener("pointermove", e => { if (state === "playing") setTarget(e); });
cv.addEventListener("contextmenu", e => e.preventDefault());
addEventListener("pointerdown", e => { touchMode = e.pointerType === "touch"; }, { passive: true });
addEventListener("pointerup", () => { mouseDown = false; });
addEventListener("blur", () => { keys.l = keys.r = keys.u = keys.d = keys.fire = false; mouseDown = false; });
document.addEventListener("visibilitychange", () => { if (document.hidden && state === "playing") pause(); });

addEventListener("keydown", e => {
  if (state === "playing" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code)) e.preventDefault();
  switch (e.code) {
    case "ArrowLeft": case "KeyA": keys.l = true; break;
    case "ArrowRight": case "KeyD": keys.r = true; break;
    case "ArrowUp": case "KeyW": keys.u = true; break;
    case "ArrowDown": case "KeyS": keys.d = true; break;
    case "Space": keys.fire = true; break;
    case "KeyB": if (!e.repeat) useBomb(); break;
    case "KeyP": case "Escape":
      if (!e.repeat) { if (state === "playing") pause(); else if (state === "paused") resume(); }
      break;
  }
});
addEventListener("keyup", e => {
  switch (e.code) {
    case "ArrowLeft": case "KeyA": keys.l = false; break;
    case "ArrowRight": case "KeyD": keys.r = false; break;
    case "ArrowUp": case "KeyW": keys.u = false; break;
    case "ArrowDown": case "KeyS": keys.d = false; break;
    case "Space": keys.fire = false; break;
  }
});

/* ===== TOMBOL ===== */
$("btn-start").onclick = startGame;
$("btn-help").onclick = () => { unlock(); showScreen("screen-help"); };
$("btn-help-back").onclick = () => showScreen("screen-title");
$("btn-pause").onclick = e => { e.currentTarget.blur(); pause(); };
$("btn-resume").onclick = resume;
$("btn-restart").onclick = () => { bank(); startGame(); };
$("btn-quit").onclick = toMenu;
$("btn-retry").onclick = startGame;
$("btn-menu").onclick = toMenu;
$("btn-bomb").addEventListener("pointerdown", e => { e.preventDefault(); e.currentTarget.blur(); useBomb(); });
$("btn-sound").onclick = e => {
  e.currentTarget.blur(); soundOn = !soundOn; store.set("nb-sound", soundOn);
  syncSound(); unlock(); sfx.coin();
};

/* ===== MULAI ===== */
resize(); addEventListener("resize", resize);
syncSound(); updateTitle();
requestAnimationFrame(frame);
