'use strict';

/*
 * Vampir Köylü — sunucu-otoriter, sıfır bağımlılıklı Node.js sunucusu.
 * Oyun motoru + statik PWA dosya sunumu + JSON API (kısa polling).
 *
 * Çalıştır:  node server.js   (varsayılan port 3000, PORT env ile değişir)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ----------------------------------------------------------------------------
// Oda / oyun durumu (bellek içi)
// ----------------------------------------------------------------------------

/** @type {Map<string, Room>} */
const rooms = new Map();

const ROOM_TTL_MS = 3 * 60 * 60 * 1000; // 3 saat hareketsizlik sonrası temizlenir

function now() { return Date.now(); }

function randCode() {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // karışık okunan harfler yok
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += alpha[Math.floor(Math.random() * alpha.length)];
  } while (rooms.has(code));
  return code;
}

function id() { return crypto.randomBytes(9).toString('base64url'); }
function token() { return crypto.randomBytes(18).toString('base64url'); }

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Rol tanımları (istemciye gösterilen etiket/açıklama)
const ROLE_INFO = {
  vampir: { label: 'Vampir', team: 'vampirler', emoji: '🧛',
    desc: 'Geceleri diğer vampirlerle birlikte bir kurban seçersin. Amacın köylüleri ele geçirmek. Gündüz kimliğini gizle!' },
  koylu: { label: 'Köylü', team: 'koyluler', emoji: '🧑‍🌾',
    desc: 'Özel gücün yok ama oyun senin ellerinde. Tartışıp vampirleri bulup oyla; masumları asma!' },
  doktor: { label: 'Doktor', team: 'koyluler', emoji: '💉',
    desc: 'Her gece bir kişiyi (kendin dahil) korursun. Vampirler o kişiyi seçerse ölmez.' },
  gozcu: { label: 'Gözcü', team: 'koyluler', emoji: '🔮',
    desc: 'Her gece bir kişiyi incelersin ve vampir olup olmadığını öğrenirsin. Bilgini akıllıca kullan.' },
};

function roleDistribution(n) {
  // Oyuncu sayısına göre rol dağılımı
  let vamp;
  if (n <= 5) vamp = 1;
  else if (n <= 8) vamp = 2;
  else if (n <= 11) vamp = 3;
  else vamp = Math.floor(n / 4);

  const special = [];
  if (n >= 4) special.push('doktor');
  if (n >= 5) special.push('gozcu');

  const roles = [];
  for (let i = 0; i < vamp; i++) roles.push('vampir');
  for (const s of special) roles.push(s);
  while (roles.length < n) roles.push('koylu');
  return shuffle(roles.slice(0, n));
}

function newRoom(hostName) {
  const code = randCode();
  const room = {
    code,
    hostId: null,
    createdAt: now(),
    lastActivity: now(),
    phase: 'lobby',        // lobby | story | night | day | vote | ended
    round: 0,
    mekan: 'Bekçiler Çalhanlar Dinlenme Tesisleri',   // hikâye mekânı (kurucu seçer)
    players: new Map(),    // id -> player
    order: [],             // katılım sırası (id[])
    night: { vampireVotes: {}, doctorSave: null, seerInspect: null },
    votes: {},             // voterId -> targetId | 'skip'
    log: [],               // {round, text}
    lastNightDeaths: [],   // isim[]
    lastLynched: null,     // isim | null
    winner: null,          // 'vampirler' | 'koyluler' | null
  };
  rooms.set(code, room);
  return room;
}

function addPlayer(room, name) {
  const pid = id();
  const tok = token();
  const isHost = room.players.size === 0;
  const player = {
    id: pid, token: tok, name: name.slice(0, 20),
    role: null, alive: true, isHost,
    private: [],  // gözcü sonuçları vb.
  };
  room.players.set(pid, player);
  room.order.push(pid);
  if (isHost) room.hostId = pid;
  touch(room);
  return player;
}

function touch(room) { room.lastActivity = now(); }
function alivePlayers(room) { return room.order.map(i => room.players.get(i)).filter(p => p && p.alive); }
function vampiresAlive(room) { return alivePlayers(room).filter(p => p.role === 'vampir'); }
function findAliveByRole(room, role) { return alivePlayers(room).find(p => p.role === role) || null; }
function pushLog(room, text) { room.log.push({ round: room.round, text }); if (room.log.length > 60) room.log.shift(); }

// ----------------------------------------------------------------------------
// Oyun akışı
// ----------------------------------------------------------------------------

function startGame(room) {
  const players = room.order.map(i => room.players.get(i));
  if (players.length < 2) return { error: 'En az 2 oyuncu gerekli.' };
  const dist = roleDistribution(players.length);
  players.forEach((p, i) => { p.role = dist[i]; p.alive = true; p.private = []; });
  room.phase = 'story';
  room.round = 1;
  room.winner = null;
  room.night = { vampireVotes: {}, doctorSave: null, seerInspect: null };
  room.votes = {};
  room.lastNightDeaths = [];
  room.lastLynched = null;
  room.log = [];
  const vamps = players.filter(p => p.role === 'vampir').length;
  pushLog(room, `Oyun başladı — ${players.length} oyuncu, ${vamps} vampir. Mekân: ${room.mekan}.`);
  touch(room);
  return { ok: true };
}

// Hikâye fazından ilk geceye geçiş
function beginFirstNight(room) {
  room.phase = 'night';
  pushLog(room, `🌙 ${room.mekan} üzerine ilk gece çöküyor...`);
  touch(room);
}

function storyText(room) {
  const vamps = room.order.map(i => room.players.get(i)).filter(p => p.role === 'vampir').length;
  return `Uzaklarda, ${room.mekan}... Halkın huzurlu göründüğü bu yerde karanlık bir sır fısıldanır: ` +
    `içinizde ${vamps} vampir dolaşıyor. Geceleri avlanıyor, gündüzleri sizden biri gibi aranıza karışıyorlar. ` +
    `Her gece biri kaybolacak, her gün köy bir şüpheliyi kürsüye çıkaracak. Kim insan, kim canavar? ` +
    `Güveni kazanan yaşar, açık veren kaybolur. Şafağa kadar hayatta kalabilecek misiniz?`;
}

function nightReady(room) {
  // Tüm gerekli gece eylemleri girildi mi?
  const vamps = vampiresAlive(room);
  const allVamps = vamps.every(v => room.night.vampireVotes[v.id]);
  const doc = findAliveByRole(room, 'doktor');
  const docReady = !doc || room.night.doctorSave !== null;
  const seer = findAliveByRole(room, 'gozcu');
  const seerReady = !seer || room.night.seerInspect !== null;
  return vamps.length > 0 && allVamps && docReady && seerReady;
}

function resolveNight(room) {
  // Vampir oylarını say
  const tally = {};
  for (const t of Object.values(room.night.vampireVotes)) if (t) tally[t] = (tally[t] || 0) + 1;
  let victim = null, best = 0;
  const top = [];
  for (const [t, c] of Object.entries(tally)) {
    if (c > best) { best = c; top.length = 0; top.push(t); }
    else if (c === best) top.push(t);
  }
  if (top.length) victim = top[Math.floor(Math.random() * top.length)];

  room.lastNightDeaths = [];
  if (victim) {
    if (victim === room.night.doctorSave) {
      pushLog(room, `Gece birine saldırıldı ama Doktor tam zamanında yetişti — kimse ölmedi.`);
    } else {
      const p = room.players.get(victim);
      if (p && p.alive) { p.alive = false; room.lastNightDeaths.push(p.name); }
    }
  }
  if (room.lastNightDeaths.length) {
    pushLog(room, `🌅 Sabah oldu. Gece ${room.lastNightDeaths.join(', ')} öldürülmüş bulundu.`);
  } else if (!victim) {
    pushLog(room, `🌅 Sabah oldu. Sakin bir geceydi, kimse ölmedi.`);
  } else {
    pushLog(room, `🌅 Sabah oldu. Kimse ölmedi!`);
  }

  room.night = { vampireVotes: {}, doctorSave: null, seerInspect: null };
  room.phase = 'day';
  touch(room);
  if (checkWin(room)) return;
}

function toVote(room) {
  room.votes = {};
  room.phase = 'vote';
  pushLog(room, `☀️ Gündüz oylaması başladı. Kimi asalım?`);
  touch(room);
}

function voteReady(room) {
  const alive = alivePlayers(room);
  return alive.length > 0 && alive.every(p => room.votes[p.id] !== undefined);
}

function resolveVote(room) {
  const tally = {};
  for (const v of Object.values(room.votes)) if (v && v !== 'skip') tally[v] = (tally[v] || 0) + 1;
  let best = 0; const top = [];
  for (const [t, c] of Object.entries(tally)) {
    if (c > best) { best = c; top.length = 0; top.push(t); }
    else if (c === best) top.push(t);
  }
  room.lastLynched = null;
  if (top.length === 1 && best > 0) {
    const p = room.players.get(top[0]);
    if (p && p.alive) {
      p.alive = false;
      room.lastLynched = p.name;
      const info = ROLE_INFO[p.role];
      pushLog(room, `⚖️ Köy oyladı: ${p.name} asıldı. Rolü: ${info.emoji} ${info.label}.`);
    }
  } else {
    pushLog(room, `⚖️ Oylamada uzlaşma olmadı, kimse asılmadı.`);
  }
  room.votes = {};
  touch(room);
  if (checkWin(room)) return;
  // Sonraki geceye geç
  room.round += 1;
  room.phase = 'night';
  room.lastNightDeaths = [];
  pushLog(room, `🌙 ${room.round}. gece çöküyor...`);
}

function checkWin(room) {
  const alive = alivePlayers(room);
  const vamps = alive.filter(p => p.role === 'vampir').length;
  const others = alive.length - vamps;
  if (vamps === 0) {
    room.phase = 'ended'; room.winner = 'koyluler';
    pushLog(room, `🎉 Tüm vampirler yok edildi — KÖYLÜLER kazandı!`);
    return true;
  }
  if (vamps >= others) {
    room.phase = 'ended'; room.winner = 'vampirler';
    pushLog(room, `🧛 Vampirler köyü ele geçirdi — VAMPİRLER kazandı!`);
    return true;
  }
  return false;
}

function restartGame(room) {
  room.phase = 'lobby';
  room.round = 0;
  room.winner = null;
  room.night = { vampireVotes: {}, doctorSave: null, seerInspect: null };
  room.votes = {};
  room.lastNightDeaths = [];
  room.lastLynched = null;
  room.log = [];
  for (const p of room.players.values()) { p.role = null; p.alive = true; p.private = []; }
  touch(room);
}

// ----------------------------------------------------------------------------
// Eylemler
// ----------------------------------------------------------------------------

function handleAction(room, player, type, payload) {
  payload = payload || {};
  const isHost = player.id === room.hostId;

  switch (type) {
    case 'start':
      if (!isHost) return { error: 'Sadece oda kurucusu başlatabilir.' };
      if (room.phase !== 'lobby') return { error: 'Oyun zaten başladı.' };
      return startGame(room);

    case 'nightVote': {
      if (room.phase !== 'night') return { error: 'Şu an gece değil.' };
      if (!player.alive || player.role !== 'vampir') return { error: 'Bu eylemi yapamazsın.' };
      const tgt = payload.targetId;
      if (!isValidTarget(room, tgt) || room.players.get(tgt).role === 'vampir')
        return { error: 'Geçersiz hedef.' };
      room.night.vampireVotes[player.id] = tgt;
      break;
    }
    case 'doctorSave': {
      if (room.phase !== 'night') return { error: 'Şu an gece değil.' };
      if (!player.alive || player.role !== 'doktor') return { error: 'Bu eylemi yapamazsın.' };
      if (!isValidTarget(room, payload.targetId)) return { error: 'Geçersiz hedef.' };
      room.night.doctorSave = payload.targetId;
      break;
    }
    case 'seerInspect': {
      if (room.phase !== 'night') return { error: 'Şu an gece değil.' };
      if (!player.alive || player.role !== 'gozcu') return { error: 'Bu eylemi yapamazsın.' };
      const tgt = payload.targetId;
      if (!isValidTarget(room, tgt) || tgt === player.id) return { error: 'Geçersiz hedef.' };
      room.night.seerInspect = tgt;
      const t = room.players.get(tgt);
      const isVamp = t.role === 'vampir';
      player.private.push(`🔮 ${room.round}. gece — ${t.name}: ${isVamp ? 'VAMPİR 🧛' : 'vampir değil ✅'}`);
      break;
    }
    case 'lynchVote': {
      if (room.phase !== 'vote') return { error: 'Şu an oylama değil.' };
      if (!player.alive) return { error: 'Ölüler oy kullanamaz.' };
      const tgt = payload.targetId;
      if (tgt !== 'skip' && !isValidTarget(room, tgt)) return { error: 'Geçersiz hedef.' };
      room.votes[player.id] = tgt;
      break;
    }
    case 'advance': {
      if (!isHost) return { error: 'Sadece oda kurucusu ilerletebilir.' };
      if (room.phase === 'story') beginFirstNight(room);
      else if (room.phase === 'night') resolveNight(room);
      else if (room.phase === 'day') toVote(room);
      else if (room.phase === 'vote') resolveVote(room);
      else return { error: 'Şu an ilerletilecek bir şey yok.' };
      touch(room);
      return { ok: true };
    }
    case 'setMekan': {
      if (!isHost) return { error: 'Sadece oda kurucusu mekân seçebilir.' };
      if (room.phase !== 'lobby') return { error: 'Mekân sadece lobide seçilir.' };
      const m = String(payload.mekan || '').trim().slice(0, 40);
      if (!m) return { error: 'Geçersiz mekân.' };
      room.mekan = m;
      touch(room);
      return { ok: true };
    }
    case 'restart': {
      if (!isHost) return { error: 'Sadece oda kurucusu yeniden başlatabilir.' };
      restartGame(room);
      return { ok: true };
    }
    case 'kick': {
      if (!isHost) return { error: 'Sadece oda kurucusu oyuncu çıkarabilir.' };
      if (room.phase !== 'lobby') return { error: 'Sadece lobide çıkarılabilir.' };
      const t = room.players.get(payload.targetId);
      if (t && t.id !== room.hostId) {
        room.players.delete(t.id);
        room.order = room.order.filter(x => x !== t.id);
      }
      return { ok: true };
    }
    default:
      return { error: 'Bilinmeyen eylem.' };
  }

  // Otomatik ilerleme (anlatıcıya gerek kalmadan)
  if (room.phase === 'night' && nightReady(room)) resolveNight(room);
  else if (room.phase === 'vote' && voteReady(room)) resolveVote(room);
  touch(room);
  return { ok: true };
}

function isValidTarget(room, tid) {
  const p = room.players.get(tid);
  return !!(p && p.alive);
}

// ----------------------------------------------------------------------------
// İstemciye kişiselleştirilmiş görünüm
// ----------------------------------------------------------------------------

function viewFor(room, player) {
  const viewerIsVamp = player.role === 'vampir';
  const ended = room.phase === 'ended';

  const players = room.order.map(pid => {
    const p = room.players.get(pid);
    const revealRole = ended || !p.alive || pid === player.id ||
      (viewerIsVamp && p.role === 'vampir');
    return {
      id: p.id, name: p.name, alive: p.alive, isHost: p.id === room.hostId,
      role: revealRole && p.role ? ROLE_INFO[p.role].label : null,
      emoji: revealRole && p.role ? ROLE_INFO[p.role].emoji : null,
    };
  });

  const info = player.role ? ROLE_INFO[player.role] : null;
  const me = {
    id: player.id, name: player.name, alive: player.alive,
    isHost: player.id === room.hostId,
    role: player.role, roleLabel: info ? info.label : null,
    roleEmoji: info ? info.emoji : null, roleDesc: info ? info.desc : null,
    team: info ? info.team : null, private: player.private.slice(-8),
  };

  const alive = alivePlayers(room);
  const view = {
    code: room.code, phase: room.phase, round: room.round, winner: room.winner,
    mekan: room.mekan,
    me, players,
    log: room.log.slice(-14).map(l => l.text),
    aliveCount: alive.length,
    playerCount: room.order.length,
    lastNightDeaths: room.lastNightDeaths,
    lastLynched: room.lastLynched,
    prompt: null,
    counts: {
      vampires: ended ? room.order.filter(i => room.players.get(i).role === 'vampir').length : null,
    },
  };

  const targets = (excludeSelf, excludeVamps) => alive
    .filter(p => (!excludeSelf || p.id !== player.id) && (!excludeVamps || p.role !== 'vampir'))
    .map(p => ({ id: p.id, name: p.name }));

  if (room.phase === 'lobby') {
    view.prompt = { type: 'lobby', canStart: me.isHost && room.order.length >= 2, canSetMekan: me.isHost };
  } else if (room.phase === 'story') {
    view.prompt = { type: 'story', text: storyText(room) };
  } else if (room.phase === 'night') {
    const submitted = nightSubmittedCount(room);
    if (!player.alive) view.prompt = { type: 'sleep', dead: true, waiting: submitted };
    else if (player.role === 'vampir') {
      const teammates = vampiresAlive(room).filter(v => v.id !== player.id).map(v => v.name);
      const votes = Object.entries(room.night.vampireVotes).map(([vid, tid]) => ({
        voter: room.players.get(vid)?.name, target: room.players.get(tid)?.name,
      })).filter(v => v.voter && v.target);
      view.prompt = { type: 'vampire', targets: targets(true, true), myTarget: room.night.vampireVotes[player.id] || null, teammates, votes, waiting: submitted };
    } else if (player.role === 'doktor') {
      view.prompt = { type: 'doctor', targets: targets(false, false), myTarget: room.night.doctorSave || null, waiting: submitted };
    } else if (player.role === 'gozcu') {
      view.prompt = { type: 'seer', targets: targets(true, false), myTarget: room.night.seerInspect || null, waiting: submitted };
    } else {
      view.prompt = { type: 'sleep', dead: false, waiting: submitted };
    }
  } else if (room.phase === 'day') {
    view.prompt = { type: 'day' };
  } else if (room.phase === 'vote') {
    const tally = {};
    for (const v of Object.values(room.votes)) { const k = v || '?'; tally[k] = (tally[k] || 0) + 1; }
    const tallyList = alive.map(p => ({ id: p.id, name: p.name, count: tally[p.id] || 0 }));
    tallyList.push({ id: 'skip', name: 'Kimseyi asma', count: tally['skip'] || 0 });
    view.prompt = {
      type: 'vote', canVote: player.alive, myVote: room.votes[player.id] || null,
      targets: targets(false, false), tally: tallyList,
      votesCast: Object.keys(room.votes).length, aliveCount: alive.length,
    };
  } else if (room.phase === 'ended') {
    view.prompt = {
      type: 'ended', winner: room.winner,
      reveal: room.order.map(pid => {
        const p = room.players.get(pid);
        return { name: p.name, role: ROLE_INFO[p.role].label, emoji: ROLE_INFO[p.role].emoji };
      }),
    };
  }

  // Host için ilerletme kontrolü
  view.hostControls = me.isHost ? {
    canAdvance: room.phase === 'story' || room.phase === 'night' || room.phase === 'day' || room.phase === 'vote',
    advanceLabel: room.phase === 'story' ? 'İlk geceyi başlat 🌙'
      : room.phase === 'night' ? 'Geceyi bitir →'
      : room.phase === 'day' ? 'Oylamaya geç →'
      : room.phase === 'vote' ? 'Oylamayı bitir →' : null,
  } : null;

  return view;
}

function nightSubmittedCount(room) {
  let needed = 0, done = 0;
  const vamps = vampiresAlive(room);
  needed += vamps.length; done += vamps.filter(v => room.night.vampireVotes[v.id]).length;
  if (findAliveByRole(room, 'doktor')) { needed++; if (room.night.doctorSave !== null) done++; }
  if (findAliveByRole(room, 'gozcu')) { needed++; if (room.night.seerInspect !== null) done++; }
  return { done, needed };
}

// ----------------------------------------------------------------------------
// HTTP / API
// ----------------------------------------------------------------------------

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function auth(room, body) {
  if (!room) return { error: 'Oda bulunamadı.' };
  const p = room.players.get(body.playerId);
  if (!p || p.token !== body.token) return { error: 'Yetkisiz.' };
  return { player: p };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = rel.split('?')[0];
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;

  if (!p.startsWith('/api/')) return serveStatic(req, res, p);

  try {
    if (p === '/api/create' && req.method === 'POST') {
      const body = await readBody(req);
      const name = (body.name || '').trim();
      if (!name) return send(res, 400, { error: 'İsim gerekli.' });
      const room = newRoom(name);
      const player = addPlayer(room, name);
      return send(res, 200, { roomCode: room.code, playerId: player.id, token: player.token });
    }

    if (p === '/api/join' && req.method === 'POST') {
      const body = await readBody(req);
      const code = (body.roomCode || '').trim().toUpperCase();
      const name = (body.name || '').trim();
      if (!name) return send(res, 400, { error: 'İsim gerekli.' });
      const room = rooms.get(code);
      if (!room) return send(res, 404, { error: 'Oda bulunamadı.' });
      if (room.phase !== 'lobby') return send(res, 409, { error: 'Oyun başladı, katılamazsın.' });
      if (room.order.length >= 30) return send(res, 409, { error: 'Oda çok kalabalık (maks 30).' });
      const dupe = room.order.map(i => room.players.get(i)).some(pl => pl.name.toLowerCase() === name.toLowerCase());
      if (dupe) return send(res, 409, { error: 'Bu isim zaten alınmış.' });
      const player = addPlayer(room, name);
      return send(res, 200, { roomCode: room.code, playerId: player.id, token: player.token });
    }

    if (p === '/api/state' && req.method === 'GET') {
      const code = (u.searchParams.get('roomCode') || '').toUpperCase();
      const room = rooms.get(code);
      const r = auth(room, { playerId: u.searchParams.get('playerId'), token: u.searchParams.get('token') });
      if (r.error) return send(res, 401, r);
      touch(room);
      return send(res, 200, viewFor(room, r.player));
    }

    if (p === '/api/action' && req.method === 'POST') {
      const body = await readBody(req);
      const room = rooms.get((body.roomCode || '').toUpperCase());
      const r = auth(room, body);
      if (r.error) return send(res, 401, r);
      const result = handleAction(room, r.player, body.type, body.payload);
      if (result.error) return send(res, 400, result);
      return send(res, 200, viewFor(room, r.player));
    }

    return send(res, 404, { error: 'Bilinmeyen uç nokta.' });
  } catch (e) {
    return send(res, 500, { error: 'Sunucu hatası.' });
  }
});

// Oda çöp toplama
setInterval(() => {
  const t = now();
  for (const [code, room] of rooms) if (t - room.lastActivity > ROOM_TTL_MS) rooms.delete(code);
}, 10 * 60 * 1000).unref();

server.listen(PORT, () => {
  const nets = require('os').networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets))
    for (const net of nets[name] || [])
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
  console.log(`\n🧛 Vampir Köylü sunucusu çalışıyor:`);
  console.log(`   • Bu cihaz:      http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`   • Aynı Wi-Fi:    http://${ip}:${PORT}   (telefonlar bunu kullansın)`));
  console.log(`\n   Herkes aynı ağdayken yukarıdaki adresi telefon tarayıcısında açsın.\n`);
});
