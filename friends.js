"use strict";
/* Amics i classificació. Cada usuari publica un resum d'estadístiques a pub/{uid}; només el poden llegir
   els usuaris que ell té a la seva llista d'amics (regles de Firestore). Les mesures corporals i el pes
   només es comparteixen com a variació, mai el valor absolut. */

const FR = { friends: [], incoming: [], loaded: false, loading: false, period: "p7", cat: "days", ex: null, measure: "waist", asc: false, err: null };
const PERIODS = [["p7", "7 dies"], ["p30", "30 dies"], ["all", "Total"]];
const LB = [
  { k: "days", l: "Dies entrenats", u: "dies" },
  { k: "sessions", l: "Sessions", u: "" },
  { k: "sets", l: "Sèries efectives", u: "" },
  { k: "volume", l: "Volum total", u: "kg" },
  { k: "prs", l: "Rècords", u: "" },
  { k: "e1", l: "1RM estimada", u: "kg", ex: true },
  { k: "w", l: "Pes màxim", u: "kg", ex: true },
  { k: "kcalDays", l: "Dies complint kcal", u: "dies" },
  { k: "protDays", l: "Dies complint proteïna", u: "dies" },
  { k: "waterDays", l: "Dies complint aigua", u: "dies" },
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
    let kcalDays = 0, protDays = 0, waterDays = 0, logDays = 0;
    const start = from || firstData;
    for (let k = start; k <= today; k = addDays(k, 1)) {
      const d = S.days[k]; if (!d) continue;
      const tg = targetFor(k);
      if ((d.meals || []).length) {
        logDays++;
        const tot = dayTotals(d);
        if (tg && Math.abs(tot.kcal / tg.kcal - 1) <= 0.1) kcalDays++;
        if (tg && tot.p >= tg.p * 0.9) protDays++;
      }
      if (tg && (d.water || 0) >= tg.water) waterDays++;
    }
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
    out.per[p] = { days: new Set(ss.map(s => s.date)).size, sessions: ss.length, sets, volume: Math.round(volume), prs, kcalDays, protDays, waterDays, logDays, wDelta, m };
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
  const stats = computePubStats(), name = S.profile.name || "";
  const h = hashOf({ stats, name, d: todayKey() });
  if (h === lastPubHash) return;
  await FB.setDoc(pubRef(SYNC.uid), { user: SYNC.user, name, stats, updated: FB.serverTimestamp() }, { merge: true });
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
function frRender() { if (UI.tab === "stats" && UI.statsView === "friends") { const y = scrollY; render(); scrollTo(0, y); } }
function viewFriends() {
  if (SYNC.state === "off") return `<section class="card"><div class="empty">Per competir amb amics cal tenir activat el compte al núvol (LLEGEIX-ME → Compte i sincronització).</div></section>`;
  if (SYNC.state !== "in") return `<section class="card"><div class="empty">Inicia sessió per afegir amics i comparar-te amb ells.</div><button class="btn primary block" data-sync="login">Inicia sessió</button></section>`;
  if (!FR.loaded && !FR.loading && !FR.err) setTimeout(() => friendsLoad(), 0);
  let html = "";
  if (FR.err) html += `<div class="banner warn"><span>${esc(FR.err)}</span></div>`;
  if (FR.incoming.length) html += `<section class="card"><h2>Sol·licituds d'amistat</h2>${FR.incoming.map(r => `<div class="kv"><span data-nt><b>${esc(r.fromUser)}</b></span><span class="row"><button class="btn sm primary" data-fr="accept" data-id="${esc(r.id)}">Accepta</button><button class="btn sm ghost" data-fr="reject" data-id="${esc(r.id)}">Rebutja</button></span></div>`).join("")}</section>`;
  html += leaderboardHTML();
  html += `<section class="card"><h2>Amics <span class="sub"><button class="btn sm ghost" data-fr="reload">${FR.loading ? "Carregant…" : "Actualitza"}</button></span></h2>
    <div class="row" style="margin-bottom:10px"><input class="input grow" id="fr-user" placeholder="Nom d'usuari del teu amic" autocapitalize="none" spellcheck="false"><button class="btn primary" data-fr="add">Afegeix</button></div>
    ${FR.friends.length ? FR.friends.map(f => `<div class="kv"><span data-nt><b>${esc(f.user)}</b>${f.name ? ` <span class="faint">${esc(f.name)}</span>` : ""}</span><span class="row">${f.status === "pending" ? `<span class="small faint">Pendent d'acceptar</span>` : `<span class="small" style="color:var(--accent)">Connectat</span>`}<button class="link-btn del" data-fr="remove" data-id="${esc(f.uid)}" aria-label="Treu">×</button></span></div>`).join("")
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
  const people = [{ me: true, user: SYNC.user, name: S.profile.name, stats: myStats }, ...FR.friends.filter(f => f.status === "ok")];
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
  html += c.delta ? `<div class="row" style="justify-content:flex-end;margin-bottom:6px"><button class="btn sm ghost" data-fr="order">${FR.asc ? "Ordre: de menys a més ↑" : "Ordre: de més a menys ↓"}</button></div>` : "";
  const fv = v => v == null ? "—" : c.delta ? sgn(v, unit) : `${c.k === "volume" ? fmt(v) : fmt1(v)}${unit ? " " + unit : ""}`;
  let rank = 0, prev = undefined;
  html += `<div class="lb">${rows.map((r, i) => { if (r.v !== prev) rank = i + 1; prev = r.v; return `<div class="lb-row ${r.me ? "me" : ""}">
    <span class="lb-pos ${r.v != null && rank <= 3 ? "p" + rank : ""}">${r.v == null ? "–" : rank}</span>
    <span class="grow" data-nt><b>${esc(r.user)}</b>${r.me ? ` <span class="faint">(tu)</span>` : ""}</span>
    <b class="num">${fv(r.v)}</b></div>`; }).join("")}</div>`;
  if (people.length === 1) html += `<p class="small faint" style="margin:10px 0 0">Afegeix amics a sota per competir amb ells.</p>`;
  return html + `</section>`;
}
document.addEventListener("click", e => {
  const a = e.target.closest("[data-fr]"); if (!a) return;
  const k = a.dataset.fr;
  if (k === "add") friendAdd();
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
