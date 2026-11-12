"use strict";
/* Amics i classificació. Cada usuari publica un resum d'estadístiques a pub/{uid}; només el poden llegir
   els usuaris que ell té a la seva llista d'amics (regles de Firestore). Les mesures corporals i el pes
   només es comparteixen com a variació, mai el valor absolut. */

const FR = { view: "feed", friends: [], incoming: [], loaded: false, loading: false, period: "p7", cat: "days", ex: null, measure: "waist", asc: false, err: null,
  feed: [], feedLoaded: false, feedLoading: false, feedLimit: 10, open: {} };
const PERIODS = [["p7", "7 dies"], ["p30", "30 dies"], ["all", "Total"]];
const LB = [
  { k: "days", l: "Dies entrenats", u: "dies" },
  { k: "sessions", l: "Sessions", u: "" },
  { k: "sets", l: "Sèries efectives", u: "" },
  { k: "volume", l: "Volum total", u: "kg" },
  { k: "prs", l: "Rècords", u: "" },
  { k: "e1", l: "1RM estimada", u: "kg", ex: true },
  { k: "w", l: "Pes màxim", u: "kg", ex: true },
  { k: "avgKcal", l: "Mitjana de kcal", u: "kcal", order: true, int: true },
  { k: "avgProt", l: "Mitjana de proteïna", u: "g", order: true, int: true },
  { k: "avgWater", l: "Mitjana d'aigua", u: "L", order: true, dec2: true },
  { k: "logDays", l: "Dies registrant menjars", u: "dies" },
  { k: "wDelta", l: "Variació de pes", u: "kg", delta: true },
  { k: "m", l: "Variació de mesures", u: "cm", delta: true, measure: true },
];

// ——— estadístiques pròpies que es publiquen ———
function computePubStats() {
  const today = todayKey();
  const per = { p7: addDays(today, -6), p30: addDays(today, -29), all: "" };
  const out = { per: {}, ex: {} };
  const firstData = [Object.keys(S.days).sort()[0], ...S.gym.sessions.map(s => s.date)].filter(Boolean).sort()[0] || today;
  for (const [p, from] of Object.entries(per)) {
    const ss = S.gym.sessions.filter(s => s.date >= from && s.date <= today);
    let sets = 0, volume = 0, prs = 0;
    for (const s of ss) { const st = sessionStats(s); sets += st.sets; volume += st.vol; prs += (s.prs || []).length; }
    // Mitjanes només dels dies amb registre (els dies sense dades no compten)
    let logDays = 0, sumK = 0, sumP = 0, waterDays = 0, sumW = 0;
    const start = from || firstData;
    for (let k = start; k <= today; k = addDays(k, 1)) {
      const d = S.days[k]; if (!d) continue;
      if ((d.meals || []).length) { logDays++; const tot = dayTotals(d); sumK += tot.kcal; sumP += tot.p; }
      if ((d.water || 0) > 0) { waterDays++; sumW += d.water; }
    }
    const avgKcal = logDays ? Math.round(sumK / logDays) : null, avgProt = logDays ? Math.round(sumP / logDays) : null;
    const avgWater = waterDays ? Math.round(sumW / waterDays / 10) / 100 : null;
    const days = p === "p7" ? 7 : p === "p30" ? 30 : 0;
    const wser = [...S.weights].sort((a, b) => a.d.localeCompare(b.d));
    let wDelta = null;
    if (wser.length >= 2) {
      const last = wser[wser.length - 1];
      const ref = days ? ([...wser].reverse().find(w => w.d <= from) || wser.find(w => w.d > from)) : wser[0];
      if (ref && ref !== last) wDelta = Math.round((last.kg - ref.kg) * 10) / 10;
    }
    const m = {};
    for (const [k] of MEASURES) { const v = measureDelta(k, days); if (v != null) m[k] = Math.round(v * 10) / 10; }
    out.per[p] = { days: new Set(ss.map(s => s.date)).size, sessions: ss.length, sets, volume: Math.round(volume), prs, avgKcal, avgProt, avgWater, logDays, wDelta, m };
  }
  // Exercicis dels últims 6 mesos: millor 1RM estimada i pes màxim per període
  const since = addDays(today, -183), ex = {};
  for (const s of S.gym.sessions) {
    if (s.date < since) continue;
    for (const it of s.items) {
      const ws = it.sets.filter(x => x.done && isWork(x)); if (!ws.length) continue;
      const e = Math.max(0, ...ws.map(setE1)), w = Math.max(0, ...ws.map(x => numIn(x.w) || 0));
      if (!e && !w) continue;
      const r = ex[it.ex] ||= { n: exName(it.ex), last: "", e1: {}, w: {} };
      r.last = s.date > r.last ? s.date : r.last;
      for (const [p, from] of Object.entries(per)) if (s.date >= from) {
        r.e1[p] = Math.max(r.e1[p] || 0, Math.round(e * 10) / 10);
        r.w[p] = Math.max(r.w[p] || 0, w);
      }
    }
  }
  out.ex = Object.fromEntries(Object.entries(ex).sort((a, b) => b[1].last.localeCompare(a[1].last)).slice(0, 60).map(([k, v]) => { delete v.last; return [k, v]; }));
  return out;
}

// ——— Firestore ———
const pubRef = uid => FB.doc(FB.db, "pub", uid);
async function ensurePublicProfile() {
  if (SYNC.state !== "in") return;
  const u = SYNC.user, uid = SYNC.uid;
  const un = await FB.getDoc(FB.doc(FB.db, "usernames", u));
  if (!un.exists()) await FB.setDoc(FB.doc(FB.db, "usernames", u), { uid });
  const me = await FB.getDoc(pubRef(uid));
  if (!me.exists()) await FB.setDoc(pubRef(uid), { user: u, name: S.profile.name || "", friends: [], friendNames: {} });
}
let lastPubHash = null;
async function pushPublicStats() {
  if (SYNC.state !== "in") return;
  const stats = computePubStats(), name = S.profile.name || "", avatar = S.profile.avatar || "", bio = S.profile.bio || "";
  const h = hashOf({ stats, name, avatar, bio, d: todayKey() });
  if (h === lastPubHash) return;
  await FB.setDoc(pubRef(SYNC.uid), { user: SYNC.user, name, avatar, bio, stats, updated: FB.serverTimestamp() }, { merge: true });
  lastPubHash = h;
}
async function friendsLoad(force) {
  if (SYNC.state !== "in" || FR.loading || (FR.loaded && !force)) return;
  FR.loading = true; FR.err = null; frRender();
  try {
    const me = await FB.getDoc(pubRef(SYNC.uid));
    const md = me.exists() ? me.data() : {};
    const names = md.friendNames || {};
    FR.friends = await Promise.all((md.friends || []).map(async uid => {
      try { const d = await FB.getDoc(pubRef(uid)); if (d.exists()) return { uid, ...d.data(), status: "ok" }; } catch (e) {}
      return { uid, user: names[uid] || "?", status: "pending" };
    }));
    const q = await FB.getDocs(FB.query(FB.collection(FB.db, "requests"), FB.where("to", "==", SYNC.uid)));
    FR.incoming = []; q.forEach(d => FR.incoming.push({ id: d.id, ...d.data() }));
    FR.incoming = FR.incoming.filter(r => !(md.friends || []).includes(r.from));
    FR.loaded = true;
    if (!FR.feedLoaded) feedLoad();
  } catch (e) { console.error(e); FR.err = e && e.code === "permission-denied" ? "Permís denegat: actualitza les regles de Firestore (LLEGEIX-ME)" : "No s'han pogut carregar els amics"; }
  FR.loading = false; frRender();
}
async function friendAdd() {
  const inp = $("#fr-user"), u = inp.value.trim().toLowerCase();
  if (!u) return;
  if (u === SYNC.user) return toast("Aquest ets tu");
  try {
    const d = await FB.getDoc(FB.doc(FB.db, "usernames", u));
    if (!d.exists()) return toast("No hi ha cap usuari amb aquest nom");
    const uid = d.data().uid;
    if (FR.friends.some(f => f.uid === uid)) return toast("Ja el tens a la llista");
    await FB.updateDoc(pubRef(SYNC.uid), { friends: FB.arrayUnion(uid), [`friendNames.${uid}`]: u });
    const inc = FR.incoming.find(r => r.from === uid);
    if (inc) await FB.deleteDoc(FB.doc(FB.db, "requests", inc.id));
    else await FB.setDoc(FB.doc(FB.db, "requests", `${uid}_${SYNC.uid}`), { from: SYNC.uid, fromUser: SYNC.user, to: uid, ts: FB.serverTimestamp() });
    toast(inc ? `Ara ets amic de ${u}` : `Sol·licitud enviada a ${u}`);
    inp.value = "";
    await friendsLoad(true);
  } catch (e) { console.error(e); toast("No s'ha pogut enviar"); }
}
async function friendAccept(id, accept) {
  const r = FR.incoming.find(x => x.id === id); if (!r) return;
  try {
    if (accept) await FB.updateDoc(pubRef(SYNC.uid), { friends: FB.arrayUnion(r.from), [`friendNames.${r.from}`]: r.fromUser });
    await FB.deleteDoc(FB.doc(FB.db, "requests", id));
    toast(accept ? `Ara ets amic de ${r.fromUser}` : "Sol·licitud rebutjada");
    await friendsLoad(true);
  } catch (e) { console.error(e); toast("No s'ha pogut fer"); }
}
async function friendRemove(uid) {
  const f = FR.friends.find(x => x.uid === uid);
  if (!confirm(`Treure ${f ? f.user : "aquest usuari"} dels amics? Deixarà de veure les teves estadístiques.`)) return;
  try {
    await FB.updateDoc(pubRef(SYNC.uid), { friends: FB.arrayRemove(uid) });
    try { await FB.deleteDoc(FB.doc(FB.db, "requests", `${uid}_${SYNC.uid}`)); } catch (e) {}
    await friendsLoad(true);
  } catch (e) { console.error(e); toast("No s'ha pogut treure"); }
}

// ——— vista ———
function frRender() { if (UI.tab === "friends") { const y = scrollY; render(); scrollTo(0, y); } }
const avatarHTML = (p, size = 40) => p && p.avatar
  ? `<img class="av" src="${esc(p.avatar)}" alt="" style="width:${size}px;height:${size}px">`
  : `<span class="av ph" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${esc(((p && (p.name || p.user)) || "?").slice(0, 1).toUpperCase())}</span>`;
function viewFriendsTab() {
  let html = `<div class="seg" style="margin:6px 0 12px">${[["feed", "Feed"], ["rank", "Classificació"], ["list", "Amics"]].map(([k, l]) => `<button class="${FR.view === k ? "on" : ""}" data-fr="view" data-v="${k}">${l}${k === "list" && FR.incoming.length ? ` <span class="dot-n">${FR.incoming.length}</span>` : ""}</button>`).join("")}</div>`;
  if (SYNC.state !== "in") return html + viewFriends();
  if (FR.view === "feed") return html + viewFeed();
  if (FR.view === "rank") return html + leaderboardHTML();
  return html + viewFriends();
}
function viewFriends() {
  if (SYNC.state === "off") return `<section class="card"><div class="empty">Per competir amb amics cal tenir activat el compte al núvol (LLEGEIX-ME → Compte i sincronització).</div></section>`;
  if (SYNC.state !== "in") return `<section class="card"><div class="empty">Inicia sessió per afegir amics i comparar-te amb ells.</div><button class="btn primary block" data-sync="login">Inicia sessió</button></section>`;
  if (!FR.loaded && !FR.loading && !FR.err) setTimeout(() => friendsLoad(), 0);
  let html = "";
  if (FR.err) html += `<div class="banner warn"><span>${esc(FR.err)}</span></div>`;
  if (FR.incoming.length) html += `<section class="card"><h2>Sol·licituds d'amistat</h2>${FR.incoming.map(r => `<div class="kv"><span data-nt><b>${esc(r.fromUser)}</b></span><span class="row"><button class="btn sm primary" data-fr="accept" data-id="${esc(r.id)}">Accepta</button><button class="btn sm ghost" data-fr="reject" data-id="${esc(r.id)}">Rebutja</button></span></div>`).join("")}</section>`;
  html += `<section class="card"><h2>Amics <span class="sub"><button class="btn sm ghost" data-fr="reload">${FR.loading ? "Carregant…" : "Actualitza"}</button></span></h2>
    <div class="row" style="margin-bottom:10px"><input class="input grow" id="fr-user" placeholder="Nom d'usuari del teu amic" autocapitalize="none" spellcheck="false"><button class="btn primary" data-fr="add">Afegeix</button></div>
    ${FR.friends.length ? FR.friends.map(f => `<div class="kv fr-row"><span class="row" data-nt>${avatarHTML(f, 36)}<span><b>${esc(f.user)}</b>${f.name ? ` <span class="faint">${esc(f.name)}</span>` : ""}${f.bio ? `<br><span class="small muted">${esc(f.bio)}</span>` : ""}</span></span><span class="row">${f.status === "pending" ? `<span class="small faint">Pendent d'acceptar</span>` : `<span class="small" style="color:var(--accent)">Connectat</span>`}<button class="link-btn del" data-fr="remove" data-id="${esc(f.uid)}" aria-label="Treu">×</button></span></div>`).join("")
      : `<p class="small faint" style="margin:0">Encara no tens amics. Demana'ls el seu nom d'usuari de l'app i afegeix-los: quan acceptin, sortiran a la classificació.</p>`}
    <p class="small faint" style="margin:10px 0 0">El teu usuari és <b data-nt>${esc(SYNC.user)}</b>. Els amics veuen els teus totals d'entrenament, rècords, dies complint objectius i la <b>variació</b> del pes i de les mesures (no els valors).</p>
  </section>`;
  return html;
}
function lbValue(st, c) {
  if (!st || !st.per) return null;
  const p = st.per[FR.period] || {};
  if (c.ex) { const r = st.ex && st.ex[FR.ex]; return r && r[c.k] && r[c.k][FR.period] ? r[c.k][FR.period] : null; }
  if (c.measure) return p.m && p.m[FR.measure] != null ? p.m[FR.measure] : null;
  return p[c.k] ?? null;
}
function leaderboardHTML() {
  const myStats = computePubStats();
  const people = [{ me: true, user: SYNC.user, name: S.profile.name, avatar: S.profile.avatar, stats: myStats }, ...FR.friends.filter(f => f.status === "ok")];
  const c = LB.find(x => x.k === FR.cat) || LB[0];
  let html = `<section class="card"><h2>Classificació</h2>
    <div class="seg" style="margin-bottom:10px">${PERIODS.map(([k, l]) => `<button class="${FR.period === k ? "on" : ""}" data-fr="period" data-v="${k}">${l}</button>`).join("")}</div>
    <div class="seg chips-seg" style="margin-bottom:10px">${LB.map(x => `<button class="${x.k === c.k ? "on" : ""}" data-fr="cat" data-v="${x.k}">${x.l}</button>`).join("")}</div>`;
  if (c.ex) {
    const exs = new Map();
    for (const pp of people) for (const [id, r] of Object.entries((pp.stats && pp.stats.ex) || {})) if (!exs.has(id)) exs.set(id, GYM_DB_MAP.has(id) || G().custom.some(x => x.id === id) ? exName(id) : r.n);
    const list = [...exs.entries()].sort((a, b) => a[1].localeCompare(b[1], "ca"));
    if (!FR.ex || !exs.has(FR.ex)) FR.ex = list.length ? (list.find(([id]) => people.filter(pp => pp.stats && pp.stats.ex && pp.stats.ex[id]).length > 1) || list[0])[0] : null;
    html += `<label class="field"><span>Exercici</span><select class="input" data-fr-sel="ex" data-nt>${list.map(([id, n]) => `<option value="${esc(id)}" ${id === FR.ex ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>`;
  }
  if (c.measure) html += `<div class="seg chips-seg" style="margin-bottom:10px">${MEASURES.map(([k, l]) => `<button class="${FR.measure === k ? "on" : ""}" data-fr="measure" data-v="${k}">${l}</button>`).join("")}</div>`;
  const unit = c.measure && FR.measure === "bf" ? "%" : c.u;
  const rows = people.map(pp => ({ ...pp, v: lbValue(pp.stats, c) }));
  rows.sort((a, b) => (a.v == null) - (b.v == null) || (FR.asc ? a.v - b.v : b.v - a.v));
  html += c.delta || c.order ? `<div class="row" style="justify-content:flex-end;margin-bottom:6px"><button class="btn sm ghost" data-fr="order">${FR.asc ? "Ordre: de menys a més ↑" : "Ordre: de més a menys ↓"}</button></div>` : "";
  const fv = v => v == null ? "—" : c.delta ? sgn(v, unit) : `${c.k === "volume" || c.int ? fmt(v) : c.dec2 ? (Math.round(v * 100) / 100).toLocaleString("ca-ES", { minimumFractionDigits: 2 }) : fmt1(v)}${unit ? " " + unit : ""}`;
  let rank = 0, prev = undefined;
  html += `<div class="lb">${rows.map((r, i) => { if (r.v !== prev) rank = i + 1; prev = r.v; return `<div class="lb-row ${r.me ? "me" : ""}">
    <span class="lb-pos ${r.v != null && rank <= 3 ? "p" + rank : ""}">${r.v == null ? "–" : rank}</span>
    ${avatarHTML(r, 32)}<span class="grow" data-nt><b>${esc(r.user)}</b>${r.me ? ` <span class="faint">(tu)</span>` : ""}</span>
    <b class="num">${fv(r.v)}</b></div>`; }).join("")}</div>`;
  if (c.order) html += `<p class="small faint" style="margin:10px 0 0">Mitjana dels dies amb registre del període: els dies sense dades no compten.</p>`;
  if (people.length === 1) html += `<p class="small faint" style="margin:10px 0 0">Afegeix amics a la pestanya «Amics» per competir amb ells.</p>`;
  return html + `</section>`;
}
document.addEventListener("click", e => {
  const a = e.target.closest("[data-fr]"); if (!a) return;
  const k = a.dataset.fr;
  if (k === "view") { FR.view = a.dataset.v; render(); window.scrollTo({ top: 0 }); if (FR.view === "feed") feedLoad(); else friendsLoad(); }
  else if (k === "kudos") feedKudos(a.dataset.uid, a.dataset.id);
  else if (k === "more") { FR.feedLimit += 10; feedLoad(true); }
  else if (k === "open") { FR.open[a.dataset.id] = !FR.open[a.dataset.id]; frRender(); }
  else if (k === "feed-reload") feedLoad(true);
  else if (k === "add") friendAdd();
  else if (k === "accept" || k === "reject") friendAccept(a.dataset.id, k === "accept");
  else if (k === "remove") friendRemove(a.dataset.id);
  else if (k === "reload") friendsLoad(true);
  else if (k === "period") { FR.period = a.dataset.v; frRender(); }
  else if (k === "cat") { FR.cat = a.dataset.v; FR.asc = false; frRender(); }
  else if (k === "measure") { FR.measure = a.dataset.v; frRender(); }
  else if (k === "order") { FR.asc = !FR.asc; frRender(); }
});
document.addEventListener("change", e => { if (e.target.dataset.frSel === "ex") { FR.ex = e.target.value; frRender(); } });
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.id === "fr-user") friendAdd(); });

// ——————————————————— FEED ———————————————————
// Cada sessió publicada és pub/{uid}/posts/{idSessió}. La poden llegir l'autor i els seus amics.
const postsCol = uid => FB.collection(FB.db, "pub", uid, "posts");
const postRef = (uid, id) => FB.doc(FB.db, "pub", uid, "posts", id);
function postFromSession(s, photo, caption) {
  const st = sessionStats(s);
  return {
    uid: SYNC.uid, user: SYNC.user, date: s.date, start: s.start, title: s.name, dur: st.dur, sets: st.sets, vol: Math.round(st.vol),
    prs: (s.prs || []).map(p => ({ n: exName(p.ex), t: p.t, v: Math.round(p.v * 10) / 10 })),
    items: s.items.map(it => { const k = exById(it.ex).kind; const ws = it.sets.filter(x => x.done && isWork(x)); return { n: exName(it.ex), s: (ws.length ? ws : it.sets.filter(x => x.done)).map(x => setText(x, k)).join(" · ") }; }),
    caption: caption || "", photo: photo || null,
  };
}
async function publishSession(s, photo, caption) {
  if (SYNC.state !== "in") return false;
  const data = postFromSession(s, photo, caption);
  await FB.setDoc(postRef(SYNC.uid, s.id), { ...data, ts: FB.serverTimestamp(), kudos: [] });
  s.posted = true; save();
  FR.feedLoaded = false;
  return true;
}
async function republishSession(s) {           // després d'editar una sessió ja publicada (conserva foto, text i aplaudiments)
  if (SYNC.state !== "in" || !s.posted) return;
  const { photo, caption, ...data } = postFromSession(s);
  try { await FB.updateDoc(postRef(SYNC.uid, s.id), data); } catch (e) { console.warn(e); }
}
async function unpublishSession(s) {
  if (SYNC.state !== "in") return;
  try { await FB.deleteDoc(postRef(SYNC.uid, s.id)); } catch (e) { console.warn(e); }
  s.posted = false; save(); FR.feedLoaded = false;
}
async function feedLoad(force) {
  if (SYNC.state !== "in" || FR.feedLoading || (FR.feedLoaded && !force)) return;
  FR.feedLoading = true; frRender();
  try {
    if (!FR.loaded) await friendsLoad();
    const people = [{ uid: SYNC.uid, user: SYNC.user, name: S.profile.name, avatar: S.profile.avatar }, ...FR.friends.filter(f => f.status === "ok")];
    const lists = await Promise.all(people.map(async p => {
      try {
        const q = await FB.getDocs(FB.query(postsCol(p.uid), FB.orderBy("ts", "desc"), FB.limit(FR.feedLimit)));
        const out = []; q.forEach(d => out.push({ id: d.id, ...d.data(), who: p }));
        return out;
      } catch (e) { console.warn(e); return []; }
    }));
    FR.feed = lists.flat().sort((a, b) => (b.start || 0) - (a.start || 0)).slice(0, FR.feedLimit * 2);
    FR.feedLoaded = true;
  } catch (e) { console.error(e); }
  FR.feedLoading = false; frRender();
}
async function feedKudos(uid, id) {
  const p = FR.feed.find(x => x.id === id && x.uid === uid); if (!p) return;
  const has = (p.kudos || []).includes(SYNC.uid);
  p.kudos = has ? p.kudos.filter(x => x !== SYNC.uid) : [...(p.kudos || []), SYNC.uid];
  frRender();
  try { await FB.updateDoc(postRef(uid, id), { kudos: has ? FB.arrayRemove(SYNC.uid) : FB.arrayUnion(SYNC.uid) }); }
  catch (e) { console.warn(e); toast("No s'ha pogut fer"); }
}
function timeAgo(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 60) return m <= 1 ? "ara mateix" : `fa ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `fa ${h} h`;
  const d = Math.round(h / 24); if (d < 7) return d === 1 ? "ahir" : `fa ${d} dies`;
  return fmtShort(keyOf(new Date(ms)));
}
function viewFeed() {
  if (!FR.feedLoaded && !FR.feedLoading) setTimeout(() => feedLoad(), 0);
  if (!FR.feed.length) return `<section class="card"><div class="empty">${FR.feedLoading ? "Carregant…" : "Aquí sortiran els entrenaments que publiquin els teus amics i els teus. En acabar una sessió pots publicar-la, amb foto si vols."}</div>
    ${FR.friends.length ? "" : `<button class="btn block" data-fr="view" data-v="list">Afegeix amics</button>`}</section>`;
  let html = FR.feed.map(p => {
    const key = p.uid + "_" + p.id, open = !!FR.open[key], items = open ? p.items : p.items.slice(0, 4);
    const k = p.kudos || [], mine = k.includes(SYNC.uid);
    return `<article class="card post">
      <div class="post-head" data-nt>${avatarHTML(p.who, 42)}<div class="grow"><b>${esc(p.who.user)}</b>${p.who.name ? ` <span class="faint">${esc(p.who.name)}</span>` : ""}<div class="small muted">${esc(timeAgo(p.start || Date.now()))}</div></div></div>
      <h3 class="post-title" data-nt>${esc(p.title)}</h3>
      ${p.caption ? `<p class="post-cap" data-nt>${esc(p.caption)}</p>` : ""}
      <div class="post-stats"><div><span>Durada</span><b class="num">${fmtDur(p.dur)}</b></div><div><span>Sèries</span><b class="num">${p.sets}</b></div><div><span>Volum</span><b class="num">${fmt(p.vol)} kg</b></div>${(p.prs || []).length ? `<div><span>Rècords</span><b class="num">🏆 ${p.prs.length}</b></div>` : ""}</div>
      ${p.photo ? `<img class="post-photo" src="${esc(p.photo)}" alt="" loading="lazy">` : ""}
      <div class="post-ex">${items.map(it => `<div><span data-nt>${esc(it.n)}</span><b class="num">${esc(it.s)}</b></div>`).join("")}
        ${p.items.length > 4 ? `<button class="link-btn" data-fr="open" data-id="${esc(key)}">${open ? "Mostra'n menys" : `Mostra'ls tots (${p.items.length})`}</button>` : ""}</div>
      ${(p.prs || []).length ? `<div class="post-prs">${p.prs.map(r => `<span>🏆 <span data-nt>${esc(r.n)}</span> · ${PR_LABEL[r.t]} ${r.t === "vol" ? fmt(r.v) : fmt1(r.v)} kg</span>`).join("")}</div>` : ""}
      <div class="post-foot"><button class="kudos ${mine ? "on" : ""}" data-fr="kudos" data-uid="${esc(p.uid)}" data-id="${esc(p.id)}">👏 <span class="num">${k.length || ""}</span></button></div>
    </article>`;
  }).join("");
  html += `<div class="grid2"><button class="btn" data-fr="feed-reload">${FR.feedLoading ? "Carregant…" : "Actualitza"}</button><button class="btn" data-fr="more">Carrega'n més</button></div>`;
  return html;
}
// Imatges: redueix i comprimeix al navegador abans de pujar-les
function compressImage(file, maxSide, quality, maxBytes) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const sc = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas"); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let q = quality, d = c.toDataURL("image/jpeg", q);
      while (d.length > maxBytes && q > 0.35) { q -= 0.1; d = c.toDataURL("image/jpeg", q); }
      res(d);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("img")); };
    img.src = url;
  });
}
function cropSquare(dataURL, size) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const s2 = Math.min(img.width, img.height), c = document.createElement("canvas"); c.width = c.height = size;
      c.getContext("2d").drawImage(img, (img.width - s2) / 2, (img.height - s2) / 2, s2, s2, 0, 0, size, size);
      res(c.toDataURL("image/jpeg", 0.8));
    };
    img.src = dataURL;
  });
}
