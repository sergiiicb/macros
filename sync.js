"use strict";
/* Compte (usuari + contrasenya) i sincronització amb Firebase.
   Les dades continuen guardades al dispositiu; el núvol en té una còpia per trossos (perfil, aliments,
   cada mes de dies, cada mes de sessions…) i només es pugen els trossos que han canviat. */

const SYNC = { state: "off", user: null, uid: null, busy: false, again: false, lastOk: null, err: null, needRender: false };
const SYNC_META_KEY = "macros.sync", SKIP_KEY = "macros.nologin", DEV_KEY = "macros.device";
const USER_DOMAIN = "macros.local";          // l'usuari es converteix en usuari@macros.local (no s'hi envia mai cap correu)
let FB = null, syncMeta = null, pushT = null;
const DEV = (() => { try { let d = localStorage.getItem(DEV_KEY); if (!d) { d = Math.random().toString(36).slice(2, 10); localStorage.setItem(DEV_KEY, d); } return d; } catch (e) { return "dev"; } })();

const syncConfigured = () => !!(window.FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
const userToEmail = u => `${u.trim().toLowerCase()}@${USER_DOMAIN}`;
const emailToUser = e => String(e || "").replace("@" + USER_DOMAIN, "");

function hashOf(v) {
  const s = JSON.stringify(v ?? null);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13); }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
}
function loadMeta(uid) {
  let m = null; try { m = JSON.parse(localStorage.getItem(SYNC_META_KEY)); } catch (e) {}
  if (!m || m.uid !== uid) m = { uid, h: {}, ts: 0, imgUp: {}, imgNo: {} };
  return m;
}
const saveMeta = () => { try { localStorage.setItem(SYNC_META_KEY, JSON.stringify(syncMeta)); } catch (e) {} };

// ——— trossos ———
function toChunks(st) {
  const c = { profile: st.profile, foods: st.foods, weights: st.weights, measures: st.measures || [] };
  for (const [k, v] of Object.entries(st.days || {})) (c["days_" + k.slice(0, 7)] ||= {})[k] = v;
  const g = st.gym || {};
  c.gym = { templates: g.templates || [], custom: g.custom || [], alias: g.alias || {}, rest: g.rest ?? 120 };
  c.gymact = g.active || null;
  for (const s of g.sessions || []) (c["gs_" + s.date.slice(0, 7)] ||= []).push(s);
  const misc = {};
  for (const k of Object.keys(st)) if (!["profile", "foods", "weights", "measures", "days", "gym", "savedAt", "owner"].includes(k)) misc[k] = st[k];
  c.misc = misc;
  return c;
}
const emptyOf = id => id.startsWith("days_") ? {} : id.startsWith("gs_") ? [] : id === "gymact" ? null : id === "foods" || id === "weights" || id === "measures" ? [] : id === "gym" ? { templates: [], custom: [], alias: {} } : {};
function isEmptyChunk(id, v) {
  if (v == null) return true;
  if (id === "profile") return !v.weight && !v.age && !v.height;
  if (id === "gym") return !v.templates.length && !v.custom.length && !Object.keys(v.alias).length;
  if (Array.isArray(v)) return !v.length;
  return typeof v === "object" && !Object.keys(v).length;
}
function applyChunk(st, id, v) {
  if (id === "profile") st.profile = { ...DEFAULT.profile, ...(v || {}) };
  else if (id === "foods") st.foods = v || [];
  else if (id === "weights") st.weights = v || [];
  else if (id === "measures") st.measures = v || [];
  else if (id.startsWith("days_")) { const m = id.slice(5); for (const k of Object.keys(st.days)) if (k.startsWith(m)) delete st.days[k]; Object.assign(st.days, v || {}); }
  else if (id === "gym") Object.assign(st.gym, { templates: v.templates || [], custom: v.custom || [], alias: v.alias || {}, rest: v.rest ?? st.gym.rest });
  else if (id === "gymact") st.gym.active = v || null;
  else if (id.startsWith("gs_")) { const m = id.slice(3); st.gym.sessions = st.gym.sessions.filter(s => !s.date.startsWith(m)).concat(v || []); }
  else if (id === "misc") Object.assign(st, v || {});
}
const unionBy = (a, b, key, pick = (x, y) => y) => {
  const m = new Map((a || []).map(x => [key(x), x]));
  for (const y of b || []) { const k = key(y); m.set(k, m.has(k) ? pick(m.get(k), y) : y); }
  return [...m.values()];
};
// Canvis als dos llocs alhora: s'ajunten (si no es pot, guanya el núvol)
function mergeChunk(id, L, R) {
  if (isEmptyChunk(id, L)) return R;
  if (isEmptyChunk(id, R)) return L;
  if (id.startsWith("days_")) {
    const out = { ...R };
    for (const [k, d] of Object.entries(L)) {
      const r = out[k];
      out[k] = !r ? d : { ...r, meals: unionBy(d.meals, r.meals, m => m.id), water: Math.max(d.water || 0, r.water || 0), type: (d.type && d.type !== "normal") ? d.type : r.type };
    }
    return out;
  }
  if (id.startsWith("gs_") || id === "foods") return unionBy(L, R, x => x.id);
  if (id === "weights" || id === "measures") return unionBy(L, R, x => x.d);
  if (id === "gym") return { templates: unionBy(L.templates, R.templates, x => x.id, (x, y) => (x.updated || 0) > (y.updated || 0) ? x : y),
    custom: unionBy(L.custom, R.custom, x => x.id), alias: { ...L.alias, ...R.alias }, rest: R.rest ?? L.rest };
  if (id === "gymact") return (L.upd || 0) > (R.upd || 0) ? L : R;
  return R;
}

// ——— Firebase ———
async function loadFB() {
  if (FB) return FB;
  const [app, auth, fs] = await Promise.all([import("./lib/firebase-app.js"), import("./lib/firebase-auth.js"), import("./lib/firebase-firestore-lite.js")]);
  const a = app.initializeApp(FIREBASE_CONFIG);
  // La sessió queda guardada al dispositiu: la contrasenya només es demana el primer cop
  let au;
  try { au = auth.initializeAuth(a, { persistence: [auth.indexedDBLocalPersistence, auth.browserLocalPersistence] }); }
  catch (e) { au = auth.getAuth(a); }
  FB = { ...auth, ...fs, auth: au, db: fs.getFirestore(a) };
  return FB;
}
async function syncInit() {
  if (!syncConfigured()) { SYNC.state = "off"; return; }
  SYNC.state = "loading";
  try { await loadFB(); }
  catch (e) { SYNC.state = "error"; SYNC.err = "No s'ha pogut carregar el mòdul de sincronització"; return; }
  FB.onAuthStateChanged(FB.auth, user => {
    if (user) {
      SYNC.user = emailToUser(user.email); SYNC.uid = user.uid; SYNC.state = "in";
      // Dades locals d'un altre compte: no es barregen, es buiden (estan guardades al núvol d'aquell compte)
      if (S.owner && S.owner !== user.uid) { clearLocalData(); toast(`Benvingut/da, ${SYNC.user}`); }
      if (S.owner !== user.uid) { S.owner = user.uid; saveLocalOnly(); }
      syncMeta = loadMeta(user.uid);
      ensurePublicProfile().catch(e => console.warn(e));
      hideLogin();
      try { localStorage.removeItem(SKIP_KEY); } catch (e) {}
      syncNow();
    } else {
      SYNC.user = SYNC.uid = null; SYNC.state = "out"; syncMeta = null;
      let skipped = false; try { skipped = !!localStorage.getItem(SKIP_KEY); } catch (e) {}
      if (!skipped) showLogin();
    }
    if (UI.tab === "profile") render();
  });
}
// Cridat des de save(): puja els canvis al cap d'un moment
function syncSchedule() {
  if (SYNC.state !== "in") return;
  clearTimeout(pushT);
  pushT = setTimeout(syncNow, 2000);
}
async function syncNow() {
  if (SYNC.state !== "in") return;
  if (SYNC.busy) { SYNC.again = true; return; }
  if (!navigator.onLine) { SYNC.err = "Sense connexió: es sincronitzarà quan en tinguis"; refreshSyncUI(); return; }
  SYNC.busy = true; refreshSyncUI();
  try {
    await syncPull();
    await syncPush();
    await syncImages();
    await pushPublicStats();
    SYNC.lastOk = Date.now(); SYNC.err = null;
  } catch (e) {
    console.error(e);
    SYNC.err = e && e.code === "permission-denied" ? "Permís denegat: revisa les regles de Firestore" : "No s'ha pogut sincronitzar (" + ((e && (e.code || e.message)) || "error") + ")";
  }
  SYNC.busy = false; refreshSyncUI();
  if (SYNC.again) { SYNC.again = false; syncSchedule(); }
}
async function syncPull() {
  const { collection, query, where, getDocs, Timestamp, db } = FB;
  const col = collection(db, "users", SYNC.uid, "chunks");
  const snap = await getDocs(syncMeta.ts ? query(col, where("ts", ">", Timestamp.fromMillis(syncMeta.ts))) : col);
  let changed = false, maxTs = syncMeta.ts || 0;
  const local = toChunks(S);
  snap.forEach(d => {
    const r = d.data(), id = d.id;
    const ts = r.ts && r.ts.toMillis ? r.ts.toMillis() : 0;
    maxTs = Math.max(maxTs, ts);
    if (r.h === syncMeta.h[id]) return;
    const lv = id in local ? local[id] : emptyOf(id), lh = hashOf(lv);
    if (lh === r.h) { syncMeta.h[id] = r.h; return; }
    let rv; try { rv = JSON.parse(r.d); } catch (e) { return; }
    const dirty = syncMeta.h[id] !== undefined ? lh !== syncMeta.h[id] : !isEmptyChunk(id, lv);
    applyChunk(S, id, dirty ? mergeChunk(id, lv, rv) : rv);
    syncMeta.h[id] = r.h; changed = true;
    if (id === "foods") syncMeta.imgNo = {};
  });
  syncMeta.ts = maxTs; saveMeta();
  if (changed) { saveLocalOnly(); syncRender(); }
}
async function syncPush() {
  const { writeBatch, doc, serverTimestamp, db } = FB;
  const local = toChunks(S), ids = new Set([...Object.keys(local), ...Object.keys(syncMeta.h)]);
  const pend = {};
  let batch = writeBatch(db), n = 0;
  for (const id of ids) {
    const v = id in local ? local[id] : emptyOf(id), h = hashOf(v);
    if (h === syncMeta.h[id]) continue;
    batch.set(doc(db, "users", SYNC.uid, "chunks", id), { d: JSON.stringify(v ?? null), h, ts: serverTimestamp(), dev: DEV });
    pend[id] = h;
    if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  if (n % 400) await batch.commit();
  Object.assign(syncMeta.h, pend); saveMeta();
}
const blobToDataURL = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
async function syncImages() {
  const { doc, setDoc, getDoc, deleteDoc, serverTimestamp, db } = FB;
  const ref = id => doc(db, "users", SYNC.uid, "img", id);
  const keys = await IDB.keys(), foods = new Set(S.foods.map(f => f.id)), have = new Set(keys);
  for (const k of keys) {
    if (!foods.has(k)) continue;
    const b = await IDB.get(k);
    if (b && syncMeta.imgUp[k] !== b.size) { await setDoc(ref(k), { d: await blobToDataURL(b), size: b.size, ts: serverTimestamp() }); syncMeta.imgUp[k] = b.size; saveMeta(); }
  }
  for (const k of Object.keys(syncMeta.imgUp)) if (!foods.has(k)) { await deleteDoc(ref(k)); delete syncMeta.imgUp[k]; saveMeta(); }
  let got = false;
  for (const f of S.foods) {
    if (have.has(f.id) || syncMeta.imgUp[f.id] || syncMeta.imgNo[f.id]) continue;
    const d = await getDoc(ref(f.id));
    if (d.exists()) { const b = await (await fetch(d.data().d)).blob(); await IDB.put(f.id, b); syncMeta.imgUp[f.id] = b.size; got = true; }
    else syncMeta.imgNo[f.id] = 1;
    saveMeta();
  }
  if (got && UI.tab === "foods") syncRender();
}
// Si estàs escrivint, espera a que acabis per redibuixar
function syncRender() {
  const ae = document.activeElement;
  if (ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && (ae.closest("#view") || ae.closest("#sheet"))) { SYNC.needRender = true; return; }
  applyTheme(); render();
}
document.addEventListener("focusout", () => setTimeout(() => {
  const ae = document.activeElement;
  if (SYNC.needRender && !(ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName))) { SYNC.needRender = false; applyTheme(); render(); }
}, 50));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
window.addEventListener("online", () => syncNow());
setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 60000);

// ——— pantalla d'inici de sessió ———
const AUTH_ERR = {
  "auth/invalid-credential": "Usuari o contrasenya incorrectes", "auth/wrong-password": "Usuari o contrasenya incorrectes",
  "auth/user-not-found": "Aquest usuari no existeix", "auth/invalid-login-credentials": "Usuari o contrasenya incorrectes",
  "auth/email-already-in-use": "Aquest nom d'usuari ja existeix", "auth/weak-password": "La contrasenya ha de tenir almenys 6 caràcters",
  "auth/network-request-failed": "Sense connexió a internet", "auth/too-many-requests": "Massa intents. Espera uns minuts",
  "auth/operation-not-allowed": "Cal activar «Correu electrònic/contrasenya» a Firebase (Authentication)", "auth/invalid-email": "Nom d'usuari no vàlid",
  "auth/requires-recent-login": "Torna a iniciar sessió i prova-ho de nou", "auth/configuration-not-found": "Cal activar Authentication a Firebase",
};
const authMsg = e => AUTH_ERR[e && e.code] || ("Error: " + ((e && (e.code || e.message)) || "desconegut"));
function showLogin() {
  let el = $("#login");
  if (!el) { el = document.createElement("div"); el.id = "login"; el.className = "login"; document.body.appendChild(el); }
  el.innerHTML = `<div class="login-box">
    <img src="icons/icon-192.png" alt="" class="login-logo">
    <h1>Rècord</h1>
    <p class="muted small" style="margin:0 0 18px">Inicia sessió per tenir les dades i l'historial a qualsevol mòbil o ordinador. Només cal fer-ho un cop a cada dispositiu: després entra sol.</p>
    <form id="login-form" autocomplete="on">
      <label class="field"><span>Usuari</span><input class="input" id="lg-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
      <label class="field"><span>Contrasenya</span><input class="input" id="lg-pass" name="password" type="password" autocomplete="current-password" required minlength="6"></label>
      <div class="banner warn" id="lg-err" hidden></div>
      <button class="btn primary block" type="submit" data-mode="in">Inicia sessió</button>
      <button class="btn block" type="button" id="lg-new" style="margin-top:8px">Crea un compte nou</button>
    </form>
    <button class="btn ghost block" id="lg-skip" style="margin-top:14px">Continua sense compte</button>
    <p class="small faint" style="margin:6px 0 0">Sense compte, les dades només es guarden en aquest dispositiu.</p>
  </div>`;
  el.hidden = false;
  document.body.style.overflow = "hidden";
  $("#login-form").onsubmit = ev => { ev.preventDefault(); doAuth(false); };
  $("#lg-new").onclick = () => doAuth(true);
  $("#lg-skip").onclick = () => { try { localStorage.setItem(SKIP_KEY, "1"); } catch (e) {} hideLogin(); };
}
function hideLogin() { const el = $("#login"); if (el) { el.hidden = true; el.innerHTML = ""; } if ($("#sheet").hidden) document.body.style.overflow = ""; }
async function doAuth(create) {
  const u = $("#lg-user").value.trim(), p = $("#lg-pass").value, err = $("#lg-err");
  const show = m => { err.hidden = false; err.innerHTML = `<span>${esc(m)}</span>`; };
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(u)) return show("L'usuari ha de tenir 3-30 caràcters: lletres, números, punt, guió o guió baix (sense espais ni accents)");
  if (p.length < 6) return show("La contrasenya ha de tenir almenys 6 caràcters");
  if (create && !confirm(`Crear el compte «${u}»?\n\nApunta't la contrasenya: no hi ha correu associat i no es pot recuperar.`)) return;
  $$("#login button").forEach(b => b.disabled = true);
  try {
    await loadFB();
    if (create) await FB.createUserWithEmailAndPassword(FB.auth, userToEmail(u), p);
    else await FB.signInWithEmailAndPassword(FB.auth, userToEmail(u), p);
    toast(create ? "Compte creat. Les dades d'aquest dispositiu es pugen al núvol" : `Hola, ${u}`);
  } catch (e) { show(authMsg(e)); }
  $$("#login button").forEach(b => b.disabled = false);
}
function hasUnsynced() {
  if (!syncMeta) return false;
  const local = toChunks(S), ids = new Set([...Object.keys(local), ...Object.keys(syncMeta.h)]);
  for (const id of ids) if (hashOf(id in local ? local[id] : emptyOf(id)) !== syncMeta.h[id]) return true;
  return false;
}
function clearLocalData() {
  S = normalize(null);
  saveLocalOnly();
  IDB.keys().then(ks => ks.forEach(k => IDB.del(k))).catch(() => {});
  try { localStorage.removeItem(SYNC_META_KEY); } catch (e) {}
  GU.tpl = GU.edit = null; GU.progEx = null;
  if (typeof FR !== "undefined") Object.assign(FR, { friends: [], incoming: [], loaded: false });
  updateTimerBar(); applyTheme(); render();
}
async function syncLogout() {
  if (!confirm("Tancar la sessió? Les dades d'aquest compte s'esborraran d'aquest dispositiu (queden guardades al núvol i les recuperaràs en tornar a entrar).")) return;
  clearTimeout(pushT);
  await syncNow();
  if (hasUnsynced() && !confirm("Hi ha canvis que encara no s'han pogut pujar (potser no tens connexió). Si tanques la sessió ara, es perdran. Vols continuar igualment?")) return;
  await FB.signOut(FB.auth);
  clearLocalData();
  try { localStorage.removeItem(SKIP_KEY); } catch (e) {}
  showLogin();
  toast("Sessió tancada");
}
function openPasswordChange() {
  openSheet("Canvia la contrasenya", `
    <label class="field"><span>Contrasenya actual</span><input class="input" type="password" id="pw-old" autocomplete="current-password"></label>
    <label class="field"><span>Contrasenya nova</span><input class="input" type="password" id="pw-new" autocomplete="new-password" minlength="6"></label>
    <div class="banner warn" id="pw-err" hidden></div>
    <button class="btn primary block" data-sync="pw-save">Desa</button>`);
}
async function savePasswordChange() {
  const o = $("#pw-old").value, n = $("#pw-new").value, err = $("#pw-err");
  const show = m => { err.hidden = false; err.innerHTML = `<span>${esc(m)}</span>`; };
  if (n.length < 6) return show("La contrasenya nova ha de tenir almenys 6 caràcters");
  try {
    const u = FB.auth.currentUser;
    await FB.reauthenticateWithCredential(u, FB.EmailAuthProvider.credential(u.email, o));
    await FB.updatePassword(u, n);
    closeSheet(); toast("Contrasenya canviada");
  } catch (e) { show(authMsg(e)); }
}

// ——— bloc del perfil ———
function syncStatusText() {
  if (SYNC.busy) return "Sincronitzant…";
  if (SYNC.err) return SYNC.err;
  if (SYNC.lastOk) return "Sincronitzat " + new Intl.DateTimeFormat(LOC(), { hour: "2-digit", minute: "2-digit" }).format(new Date(SYNC.lastOk));
  return "Pendent";
}
function syncProfileHTML() {
  if (SYNC.state === "off") return `<p class="small muted" style="margin:0 0 10px">La sincronització amb el núvol no està configurada: les dades es guarden només en aquest dispositiu. Per activar-la, segueix els passos de <b>LLEGEIX-ME</b> (fitxer <code>firebase-config.js</code>).</p>`;
  if (SYNC.state === "loading") return `<p class="small muted" style="margin:0 0 10px">Connectant…</p>`;
  if (SYNC.state === "error") return `<div class="banner warn"><span>${esc(SYNC.err || "Error")}</span></div>`;
  if (SYNC.state === "out") return `<p class="small muted" style="margin:0 0 10px">No has iniciat sessió: les dades només es guarden en aquest dispositiu.</p>
    <button class="btn primary block" data-sync="login" style="margin-bottom:12px">Inicia sessió o crea un compte</button>`;
  return `<div style="margin-bottom:10px">
      <div class="kv"><span>Usuari</span><b>${esc(SYNC.user)}</b></div>
      <div class="kv"><span>Núvol</span><b id="sync-status" class="${SYNC.err ? "warn-t" : ""}">${esc(syncStatusText())}</b></div>
    </div>
    <div class="grid2" style="margin-bottom:8px"><button class="btn" data-sync="now">Sincronitza ara</button><button class="btn" data-sync="pw">Canvia contrasenya</button></div>
    <button class="btn ghost block" data-sync="logout">Tanca la sessió</button>`;
}
function refreshSyncUI() {
  const el = $("#sync-status");
  if (el) { el.textContent = syncStatusText(); el.classList.toggle("warn-t", !!SYNC.err && !SYNC.busy); }
}
document.addEventListener("click", e => {
  const a = e.target.closest("[data-sync]");
  if (!a) return;
  const k = a.dataset.sync;
  if (k === "login") showLogin();
  else if (k === "now") syncNow();
  else if (k === "logout") syncLogout();
  else if (k === "pw") openPasswordChange();
  else if (k === "pw-save") savePasswordChange();
});
