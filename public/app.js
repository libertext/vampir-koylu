'use strict';

// ------------------------------------------------------------------ oturum
const LS = 'vampir_session_v1';
let session = null;        // { roomCode, playerId, token }
let view = null;           // sunucudan gelen son görünüm
let pollTimer = null;
let lastRole = null;       // rol açıklaması gösterildi mi

function loadSession() {
  try { session = JSON.parse(localStorage.getItem(LS) || 'null'); } catch { session = null; }
}
function saveSession(s) { session = s; localStorage.setItem(LS, JSON.stringify(s)); }
function clearSession() { session = null; view = null; localStorage.removeItem(LS); stopPolling(); }

// ------------------------------------------------------------------ API
async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Bir hata oluştu');
  return data;
}
function createRoom(name) { return api('/api/create', { method: 'POST', body: JSON.stringify({ name }) }); }
function joinRoom(roomCode, name) { return api('/api/join', { method: 'POST', body: JSON.stringify({ roomCode, name }) }); }
async function fetchState() {
  const q = new URLSearchParams(session).toString();
  return api('/api/state?' + q, { method: 'GET' });
}
function sendAction(type, payload) {
  return api('/api/action', { method: 'POST', body: JSON.stringify(Object.assign({}, session, { type, payload })) });
}

// ------------------------------------------------------------------ polling
function startPolling() {
  stopPolling();
  tick();
  pollTimer = setInterval(tick, 1600);
}
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
async function tick() {
  if (!session) return;
  try {
    const prevPhase = view && view.phase;
    view = await fetchState();
    if (view.phase !== prevPhase) window.scrollTo(0, 0);
    render();
  } catch (e) {
    if (String(e.message).includes('Yetkisiz') || String(e.message).includes('bulunamadı')) {
      clearSession(); render();
    }
  }
}

// ------------------------------------------------------------------ yardımcılar
const $ = (sel) => document.querySelector(sel);
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function initials(name) { return (name || '?').trim().slice(0, 2).toUpperCase(); }

let toastTimer = null;
function toast(msg) {
  const old = $('.error-toast'); if (old) old.remove();
  const t = el(`<div class="error-toast">${esc(msg)}</div>`);
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2800);
}

async function act(type, payload) {
  try { view = await sendAction(type, payload); render(); }
  catch (e) { toast(e.message); }
}

// ------------------------------------------------------------------ ana render
function render() {
  const app = $('#app');
  if (!session) { app.innerHTML = ''; app.appendChild(HomeScreen()); return; }
  if (!view) { app.innerHTML = '<div class="brand"><div class="logo">🧛</div><p class="muted">Bağlanıyor…</p></div>'; return; }

  app.innerHTML = '';
  switch (view.phase) {
    case 'lobby': app.appendChild(LobbyScreen()); break;
    case 'night': app.appendChild(NightScreen()); break;
    case 'day': app.appendChild(DayScreen()); break;
    case 'vote': app.appendChild(VoteScreen()); break;
    case 'ended': app.appendChild(EndedScreen()); break;
    default: app.appendChild(el('<div class="card">Bilinmeyen durum.</div>'));
  }
}

// ------------------------------------------------------------------ ekranlar
function HomeScreen() {
  const root = el('<div class="grow stack"></div>');
  root.appendChild(el(`
    <div class="brand">
      <div class="logo">🧛</div>
      <h1>Vampir Köylü</h1>
      <p>Arkadaşlarınla, herkes kendi telefonunda. Anlatıcıya gerek yok.</p>
    </div>`));

  let mode = 'menu';

  function draw() {
    // menü / kur / katıl arasında geçiş
    while (root.children.length > 1) root.removeChild(root.lastChild);

    if (mode === 'menu') {
      const c = el('<div class="card stack"></div>');
      const create = el('<button class="btn-primary">🩸 Yeni Oda Kur</button>');
      const join = el('<button class="btn-ghost">🚪 Odaya Katıl</button>');
      create.onclick = () => { mode = 'create'; draw(); };
      join.onclick = () => { mode = 'join'; draw(); };
      c.appendChild(create); c.appendChild(join);
      root.appendChild(c);

      root.appendChild(el(`
        <div class="card">
          <h3 style="font-size:16px">Nasıl oynanır?</h3>
          <p class="muted" style="font-size:14px;line-height:1.6;margin-top:8px">
            Bir kişi <b>oda kurar</b> ve <b>4 haneli kodu</b> arkadaşlarına söyler.
            Herkes bu ekrandan koda katılır. Oyun başlayınca telefonunda <b>rolünü</b> görürsün:
            Vampir 🧛, Köylü 🧑‍🌾, Doktor 💉 veya Gözcü 🔮. Geceleri gizli seçimler yapılır,
            gündüz tartışıp birini asmak için oy verirsiniz. Vampirleri bulmaya çalışın!
          </p>
        </div>`));
      return;
    }

    const c = el('<div class="card stack"></div>');
    const nameInput = el('<input type="text" placeholder="Adın" maxlength="20" autocomplete="off" />');
    if (mode === 'create') {
      c.appendChild(el('<div><label>Adın</label></div>')).appendChild(nameInput);
      const btn = el('<button class="btn-primary">Oda Kur ve Kodu Al</button>');
      btn.onclick = async () => {
        const name = nameInput.value.trim();
        if (!name) return toast('Bir isim gir');
        btn.disabled = true;
        try { const r = await createRoom(name); saveSession(r); startPolling(); }
        catch (e) { toast(e.message); btn.disabled = false; }
      };
      c.appendChild(btn);
    } else {
      const codeInput = el('<input type="text" class="code-input" placeholder="KOD" maxlength="4" autocomplete="off" autocapitalize="characters" />');
      const nameWrap = el('<div></div>');
      nameWrap.appendChild(el('<label>Adın</label>')); nameWrap.appendChild(nameInput);
      const codeWrap = el('<div></div>');
      codeWrap.appendChild(el('<label>Oda Kodu</label>')); codeWrap.appendChild(codeInput);
      c.appendChild(codeWrap); c.appendChild(nameWrap);
      const btn = el('<button class="btn-primary">Katıl</button>');
      btn.onclick = async () => {
        const name = nameInput.value.trim();
        const code = codeInput.value.trim().toUpperCase();
        if (!code || code.length < 4) return toast('4 haneli kodu gir');
        if (!name) return toast('Bir isim gir');
        btn.disabled = true;
        try { const r = await joinRoom(code, name); saveSession(r); startPolling(); }
        catch (e) { toast(e.message); btn.disabled = false; }
      };
      c.appendChild(btn);
    }
    const back = el('<button class="btn-ghost btn-sm" style="width:100%">← Geri</button>');
    back.onclick = () => { mode = 'menu'; draw(); };
    c.appendChild(back);
    root.appendChild(c);
    setTimeout(() => (mode === 'join' ? root.querySelector('.code-input') : nameInput).focus(), 50);
  }

  draw();
  return root;
}

function TopBar() {
  const me = view.me;
  return el(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <span class="pill">Oda <span class="n">${esc(view.code)}</span></span>
      <span class="pill">Yaşayan <span class="n">${view.aliveCount}/${view.playerCount}</span></span>
    </div>`);
}

function PlayerList(showRoles) {
  const wrap = el('<div class="players"></div>');
  view.players.forEach(p => {
    const row = el(`<div class="player ${p.alive ? '' : 'dead'}"></div>`);
    row.appendChild(el(`<div class="avatar">${esc(initials(p.name))}</div>`));
    row.appendChild(el(`<div class="pname">${esc(p.name)}</div>`));
    if (p.id === view.me.id) row.appendChild(el('<span class="tag you">SEN</span>'));
    if (p.isHost) row.appendChild(el('<span class="tag host">KURUCU</span>'));
    if (!p.alive) row.appendChild(el('<span class="tag dead">ÖLÜ</span>'));
    if (showRoles && p.role) row.appendChild(el(`<span class="tag role">${p.emoji || ''} ${esc(p.role)}</span>`));
    // Lobide kurucu oyuncu atabilir
    if (view.phase === 'lobby' && view.me.isHost && p.id !== view.me.id) {
      const k = el('<button class="btn-ghost btn-sm" style="margin-left:8px">✕</button>');
      k.onclick = () => act('kick', { targetId: p.id });
      row.appendChild(k);
    }
    wrap.appendChild(row);
  });
  return wrap;
}

function LogBox() {
  if (!view.log || !view.log.length) return el('<div></div>');
  const box = el('<div class="card"><h3 style="font-size:14px;color:var(--muted);margin-bottom:8px">📜 Olaylar</h3></div>');
  const log = el('<div class="log"></div>');
  view.log.forEach(l => log.appendChild(el(`<div class="line">${esc(l)}</div>`)));
  box.appendChild(log);
  setTimeout(() => { log.scrollTop = log.scrollHeight; }, 0);
  return box;
}

function HostAdvance() {
  if (!view.hostControls || !view.hostControls.canAdvance) return null;
  const btn = el(`<button class="btn-gold">${esc(view.hostControls.advanceLabel)}</button>`);
  btn.onclick = () => act('advance', {});
  return btn;
}

function LeaveBtn() {
  const b = el('<button class="btn-ghost btn-sm" style="width:100%;margin-top:auto">Odadan Ayrıl</button>');
  b.onclick = () => { if (confirm('Odadan ayrılmak istediğine emin misin?')) clearSession(), render(); };
  return b;
}

// ---- Lobi
function LobbyScreen() {
  const root = el('<div class="grow stack"></div>');
  root.appendChild(TopBar());
  root.appendChild(el(`
    <div class="brand" style="margin:6px 0">
      <div class="logo" style="font-size:40px">🧛</div>
      <h1 style="font-size:22px">Lobi</h1>
      <p>Arkadaşların bu kodla katılsın</p>
    </div>`));

  const codeCard = el('<div class="card center stack"></div>');
  codeCard.appendChild(el(`<div><div class="roomcode">${esc(view.code)}</div></div>`));
  const share = el('<button class="btn-ghost btn-sm" style="width:auto;margin:0 auto">🔗 Kodu/Linki Paylaş</button>');
  share.onclick = async () => {
    const url = location.origin;
    const text = `Vampir Köylü oynayalım! Şu adresi aç: ${url}  ·  Oda kodu: ${view.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Vampir Köylü', text });
      else { await navigator.clipboard.writeText(text); toast('Kopyalandı!'); }
    } catch {}
  };
  codeCard.appendChild(share);
  root.appendChild(codeCard);

  root.appendChild(el(`<div style="display:flex;align-items:center;justify-content:space-between">
    <h3 style="font-size:16px">Oyuncular (${view.playerCount})</h3>
    <span class="muted" style="font-size:13px">min 4 · maks 20</span></div>`));
  root.appendChild(PlayerList(false));

  if (view.me.isHost) {
    const start = el('<button class="btn-primary">🌙 Oyunu Başlat</button>');
    if (view.playerCount < 4) { start.disabled = true; start.textContent = `En az 4 oyuncu gerekli (${view.playerCount}/4)`; }
    start.onclick = () => act('start', {});
    root.appendChild(start);
    root.appendChild(el('<p class="muted center" style="font-size:13px">Roller otomatik dağıtılır: oyuncu sayısına göre vampir, doktor ve gözcü eklenir.</p>'));
  } else {
    root.appendChild(el('<div class="waiting">Kurucunun başlatması bekleniyor<span class="dots"></span></div>'));
  }
  root.appendChild(LeaveBtn());
  return root;
}

// ---- Rol banner (her fazda üstte kısa)
function RoleBanner() {
  const me = view.me;
  if (!me.role) return el('<div></div>');
  const b = el(`<div class="card" style="display:flex;align-items:center;gap:12px;padding:12px 14px">
    <div style="font-size:32px">${me.roleEmoji}</div>
    <div style="flex:1">
      <div style="font-weight:800;font-size:16px">${esc(me.roleLabel)} ${me.alive ? '' : '· <span style="color:var(--blood2)">öldün</span>'}</div>
      <div class="muted" style="font-size:12.5px">${esc(me.team === 'vampirler' ? 'Takım: Vampirler' : 'Takım: Köylüler')}</div>
    </div>
    <button class="btn-ghost btn-sm" id="roleInfoBtn">?</button>
  </div>`);
  b.querySelector('#roleInfoBtn').onclick = () => toast(me.roleDesc);
  return b;
}

// ---- Gece
function NightScreen() {
  const root = el('<div class="grow stack"></div>');
  root.appendChild(TopBar());
  root.appendChild(el(`
    <div class="phase-hdr">
      <div class="icon">🌙</div>
      <h2>${view.round}. Gece</h2>
      <div class="sub">Köy uyuyor... gizli görevini yap</div>
    </div>`));
  root.appendChild(RoleBanner());

  const p = view.prompt;
  if (view.me.private && view.me.private.length) {
    view.me.private.slice(-3).forEach(n => root.appendChild(el(`<div class="private-note">${esc(n)}</div>`)));
  }

  if (p.type === 'vampire') {
    root.appendChild(el('<div class="notice death">🩸 Bu gece kimi öldüreceksiniz? Diğer vampirlerle birlikte seçin.</div>'));
    if (p.teammates.length) root.appendChild(el(`<p class="muted center" style="font-size:13px">Vampir yoldaşların: <b style="color:var(--blood2)">${p.teammates.map(esc).join(', ')}</b></p>`));
    else root.appendChild(el('<p class="muted center" style="font-size:13px">Tek vampir sensin.</p>'));
    root.appendChild(TargetList(p.targets, p.myTarget, 'nightVote', p.votes));
  } else if (p.type === 'doctor') {
    root.appendChild(el('<div class="notice ok">💉 Bu gece kimi koruyacaksın? (Kendini de seçebilirsin)</div>'));
    root.appendChild(TargetList(p.targets, p.myTarget, 'doctorSave'));
  } else if (p.type === 'seer') {
    root.appendChild(el('<div class="notice info">🔮 Kimin kimliğini incelemek istersin?</div>'));
    root.appendChild(TargetList(p.targets, p.myTarget, 'seerInspect'));
  } else if (p.type === 'sleep') {
    root.appendChild(el(`<div class="card center"><div style="font-size:48px">${p.dead ? '💀' : '😴'}</div>
      <p class="muted" style="margin-top:8px">${p.dead ? 'Sen öldün, olan biteni izliyorsun.' : 'Bir köylüsün. Rahat uyu — gece bitince görüşürüz.'}</p></div>`));
  }

  if (p.waiting) root.appendChild(el(`<div class="waiting">Gece eylemleri: ${p.waiting.done}/${p.waiting.needed} tamam<span class="dots"></span></div>`));

  const adv = HostAdvance();
  if (adv) { root.appendChild(el('<p class="muted center" style="font-size:12px">Herkes seçtiğinde otomatik geçer. Beklemek istemezsen:</p>')); root.appendChild(adv); }
  root.appendChild(LogBox());
  return root;
}

function TargetList(targets, mySel, actionType, votes) {
  const wrap = el('<div class="stack"></div>');
  const voteCount = {};
  if (votes) votes.forEach(v => { /* isim eşle */ });
  targets.forEach(t => {
    const btn = el(`<button class="target ${mySel === t.id ? 'selected' : ''}">
      <div class="avatar" style="width:32px;height:32px;font-size:14px">${esc(initials(t.name))}</div>
      <span>${esc(t.name)}</span></button>`);
    // vampir oy göstergesi
    if (votes) {
      const c = votes.filter(v => v.target === t.name).length;
      if (c) btn.appendChild(el(`<span class="votes">${'🩸'.repeat(c)}</span>`));
      else if (mySel === t.id) btn.appendChild(el('<span class="badge">✔️</span>'));
    } else if (mySel === t.id) btn.appendChild(el('<span class="badge">✔️</span>'));
    btn.onclick = () => act(actionType, { targetId: t.id });
    wrap.appendChild(btn);
  });
  return wrap;
}

// ---- Gündüz (tartışma)
function DayScreen() {
  const root = el('<div class="grow stack"></div>');
  root.appendChild(TopBar());
  root.appendChild(el(`
    <div class="phase-hdr">
      <div class="icon">☀️</div>
      <h2>${view.round}. Gün</h2>
      <div class="sub">Tartışma zamanı</div>
    </div>`));

  if (view.lastNightDeaths && view.lastNightDeaths.length)
    root.appendChild(el(`<div class="notice death">🩸 Gece <b>${view.lastNightDeaths.map(esc).join(', ')}</b> öldürüldü.</div>`));
  else
    root.appendChild(el('<div class="notice ok">🕊️ Bu gece kimse ölmedi!</div>'));

  root.appendChild(RoleBanner());
  root.appendChild(el(`<div class="card">
    <p style="line-height:1.6;margin:0">Yüksek sesle tartışın: <b>kim şüpheli?</b> Vampir olduğunu düşündüğünüz kişileri konuşun.
    Hazır olduğunuzda oylamaya geçin.</p></div>`));
  root.appendChild(PlayerList(false));

  const adv = HostAdvance();
  if (adv) root.appendChild(adv);
  else root.appendChild(el('<div class="waiting">Kurucunun oylamayı başlatması bekleniyor<span class="dots"></span></div>'));
  root.appendChild(LogBox());
  return root;
}

// ---- Oylama
function VoteScreen() {
  const root = el('<div class="grow stack"></div>');
  root.appendChild(TopBar());
  root.appendChild(el(`
    <div class="phase-hdr">
      <div class="icon">⚖️</div>
      <h2>Oylama</h2>
      <div class="sub">Kimi asalım?</div>
    </div>`));
  root.appendChild(RoleBanner());
  const p = view.prompt;

  if (p.canVote) {
    const wrap = el('<div class="stack"></div>');
    p.tally.forEach(t => {
      const btn = el(`<button class="target ${p.myVote === t.id ? 'selected' : ''}">
        <div class="avatar" style="width:32px;height:32px;font-size:14px">${t.id === 'skip' ? '➖' : esc(initials(t.name))}</div>
        <span>${esc(t.name)}</span></button>`);
      if (t.count) btn.appendChild(el(`<span class="votes">${t.count} oy</span>`));
      btn.onclick = () => act('lynchVote', { targetId: t.id });
      wrap.appendChild(btn);
    });
    root.appendChild(wrap);
  } else {
    root.appendChild(el('<div class="card center"><div style="font-size:48px">💀</div><p class="muted">Öldüğün için oy kullanamazsın.</p></div>'));
    const wrap = el('<div class="stack"></div>');
    p.tally.forEach(t => { if (t.count) wrap.appendChild(el(`<div class="target"><span>${esc(t.name)}</span><span class="votes">${t.count} oy</span></div>`)); });
    root.appendChild(wrap);
  }

  root.appendChild(el(`<div class="waiting">Oylar: ${p.votesCast}/${p.aliveCount}<span class="dots"></span></div>`));
  const adv = HostAdvance();
  if (adv) root.appendChild(adv);
  root.appendChild(LogBox());
  return root;
}

// ---- Bitiş
function EndedScreen() {
  const root = el('<div class="grow stack"></div>');
  const p = view.prompt;
  const won = (p.winner === 'vampirler' && view.me.team === 'vampirler') ||
              (p.winner === 'koyluler' && view.me.team === 'koyluler');
  root.appendChild(el(`
    <div class="brand" style="margin-top:20px">
      <div class="logo">${p.winner === 'vampirler' ? '🧛' : '🎉'}</div>
      <h1 style="font-size:26px">${p.winner === 'vampirler' ? 'Vampirler Kazandı' : 'Köylüler Kazandı'}</h1>
      <p>${won ? 'Tebrikler, senin takımın kazandı! 🏆' : 'Bu sefer olmadı. Yeniden dene!'}</p>
    </div>`));

  const reveal = el('<div class="card stack"><h3 style="font-size:16px">Roller</h3></div>');
  const list = el('<div class="players"></div>');
  p.reveal.forEach(r => {
    list.appendChild(el(`<div class="player">
      <div class="avatar">${esc(initials(r.name))}</div>
      <div class="pname">${esc(r.name)}</div>
      <span class="tag role">${r.emoji} ${esc(r.role)}</span></div>`));
  });
  reveal.appendChild(list);
  root.appendChild(reveal);

  if (view.me.isHost) {
    const again = el('<button class="btn-primary">🔄 Aynı Oyuncularla Tekrar</button>');
    again.onclick = () => act('restart', {});
    root.appendChild(again);
  } else {
    root.appendChild(el('<div class="waiting">Kurucu yeni oyun başlatabilir<span class="dots"></span></div>'));
  }
  root.appendChild(LogBox());
  root.appendChild(LeaveBtn());
  return root;
}

// ------------------------------------------------------------------ başlat
loadSession();
render();
if (session) startPolling();

// Servis çalışanı (PWA / çevrimdışı kabuk)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
