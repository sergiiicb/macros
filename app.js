"use strict";
/* Macros — app de recompte de kcal, macros i aigua. Tot es guarda al dispositiu. */

// ——————————————————— utilitats ———————————————————
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const r0 = n => Math.round(n || 0);
const r1 = n => Math.round((n || 0) * 10) / 10;
const fmt = n => r0(n).toLocaleString("ca-ES");
const fmt1 = n => r1(n).toLocaleString("ca-ES");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ICON = {
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20 16l-5-5-8 8"/></svg>',
  calc: '<svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
};

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2400);
}

// ——————————————————— dades ———————————————————
const KEY = "macros.v1";
const DRAFT_KEY = "macros.draft";
const DEFAULT = {
  profile: { name: "", sex: "m", age: "", height: "", weight: "", bodyFat: "", neat: "light", sessions: 4, hours: 1.5, intensity: "mod", goal: "maint", manualAdj: 0, theme: "auto", voiceLang: "ca-ES" },
  foods: [], days: {}, weights: [],
};
const clone = o => JSON.parse(JSON.stringify(o));
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d) return { ...clone(DEFAULT), ...d, profile: { ...DEFAULT.profile, ...(d.profile || {}) } };
  } catch (e) {}
  return clone(DEFAULT);
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast("No s'ha pogut desar: memòria del navegador plena"); }
}

// Imatges de les etiquetes (IndexedDB)
const IDB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const rq = indexedDB.open("macros-img", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("img");
      rq.onsuccess = () => res(this._db = rq.result);
      rq.onerror = () => rej(rq.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction("img", mode), st = t.objectStore("img");
      const rq = fn(st);
      t.oncomplete = () => res(rq && rq.result);
      t.onerror = () => rej(t.error);
    });
  },
  put(k, v) { return this.tx("readwrite", s => s.put(v, k)).catch(() => {}); },
  get(k) { return this.tx("readonly", s => s.get(k)).catch(() => null); },
  del(k) { return this.tx("readwrite", s => s.delete(k)).catch(() => {}); },
  keys() { return this.tx("readonly", s => s.getAllKeys()).catch(() => []); },
};

// ——————————————————— dates ———————————————————
const pad = n => String(n).padStart(2, "0");
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => keyOf(new Date());
const parseKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const fmtLong = k => cap(new Intl.DateTimeFormat("ca-ES", { weekday: "long", day: "numeric", month: "long" }).format(parseKey(k)));
const fmtShort = k => new Intl.DateTimeFormat("ca-ES", { day: "numeric", month: "short" }).format(parseKey(k)).replace(".", "");
const fmtDow = k => new Intl.DateTimeFormat("ca-ES", { weekday: "narrow" }).format(parseKey(k));
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// ——————————————————— model ———————————————————
const MEAL_TYPES = ["Esmorzar", "Mig matí", "Dinar", "Berenar", "Sopar", "Snack"];
function defaultMealType() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h < 10.5) return "Esmorzar";
  if (h < 12.5) return "Mig matí";
  if (h < 16.5) return "Dinar";
  if (h < 19.5) return "Berenar";
  if (h < 23.5) return "Sopar";
  return "Snack";
}
const allFoods = () => [...S.foods, ...GENERIC_FOODS];
const foodById = id => allFoods().find(f => f.id === id) || null;
const getDay = k => S.days[k] || { meals: [], water: 0, type: "normal" };
const ensureDay = k => (S.days[k] ||= { meals: [], water: 0, type: "normal" });
function dayTotals(d) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const m of d.meals || []) for (const i of m.items) { t.kcal += i.kcal; t.p += i.p; t.c += i.c; t.f += i.f; }
  return t;
}
const mealTotals = m => dayTotals({ meals: [m] });
const targets = () => computeTargets(S.profile);
function targetFor(k) {
  const t = targets();
  return t ? dayTarget(t, getDay(k).type || "normal", +S.profile.weight) : null;
}
const waterGoal = k => { const t = targetFor(k); return t ? t.water : Math.round((35 * (+S.profile.weight || 70)) / 50) * 50; };

// ——————————————————— estat de la interfície ———————————————————
const UI = {
  tab: "today",
  date: todayKey(),
  foodsSeg: "mine",
  foodsQ: "",
  statsRange: 7,
  draft: loadDraft(),
};
function loadDraft() {
  try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY)); if (d && Array.isArray(d.lines)) return d; } catch (e) {}
  return { type: defaultMealType(), text: "", lines: [], editing: null };
}
const saveDraft = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(UI.draft)); } catch (e) {} };
function resetDraft() { UI.draft = { type: defaultMealType(), text: "", lines: [], editing: null }; saveDraft(); }

function applyTheme() {
  const t = S.profile.theme;
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ——————————————————— navegació ———————————————————
function setTab(tab) {
  if (voice && tab !== "meal") { voice.rec.abort(); voice = null; }
  UI.tab = tab;
  $$("#tabbar button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  render();
  window.scrollTo({ top: 0 });
}
function render() {
  renderHeader();
  const v = $("#view");
  if (UI.tab === "today") v.innerHTML = viewToday();
  else if (UI.tab === "meal") { v.innerHTML = viewMeal(); refreshAllLines(); }
  else if (UI.tab === "foods") { v.innerHTML = viewFoods(); loadThumbs(); }
  else if (UI.tab === "stats") v.innerHTML = viewStats();
  else if (UI.tab === "profile") v.innerHTML = viewProfile();
}
function renderHeader() {
  const h = $("#top");
  if (UI.tab === "today" || UI.tab === "meal") {
    const isToday = UI.date === todayKey();
    const sub = UI.tab === "meal" ? (UI.draft.editing ? "Editant menjar" : "Afegir menjar") : (isToday ? "Avui" : "Toca per tornar a avui");
    h.innerHTML = `<div class="top-inner"><div class="datenav">
      <button class="icon-btn" data-action="day-prev" aria-label="Dia anterior">${ICON.left}</button>
      <div class="label" data-action="day-today" role="button">${esc(fmtLong(UI.date))}<small>${sub}</small></div>
      <button class="icon-btn" data-action="day-next" aria-label="Dia següent" ${isToday ? "disabled" : ""}>${ICON.right}</button>
    </div></div>`;
  } else {
    const titles = { foods: "Aliments", stats: "Estadístiques", profile: "Perfil" };
    const extra = UI.tab === "foods" ? `<button class="btn primary sm" data-action="food-new">${ICON.plus}Nou aliment</button>` : "";
    h.innerHTML = `<div class="top-inner"><h1>${titles[UI.tab]}</h1>${extra}</div>`;
  }
}

// ——————————————————— AVUI ———————————————————
function viewToday() {
  const d = getDay(UI.date), tot = dayTotals(d), tg = targetFor(UI.date), t = targets();
  let html = "";
  if (!t) html += `<div class="banner info"><span>Omple el perfil per calcular el teu objectiu diari.</span><button class="btn sm primary" data-action="goto" data-tab="profile">Perfil</button></div>`;

  const goal = tg ? tg.kcal : 0;
  const pct = goal ? tot.kcal / goal : 0;
  const R = 62, C = 2 * Math.PI * R;
  const off = C * (1 - clamp(pct, 0, 1));
  const over = goal && tot.kcal > goal * 1.03;
  const left = goal - tot.kcal;

  const typeSel = t ? `<label class="daytype"><span>Avís del dia</span><select class="input" data-action="day-type">${
    Object.entries(t.dayTypes).map(([k, v]) => `<option value="${k}" ${(d.type || "normal") === k ? "selected" : ""}>${esc(v.label)}${k === "normal" ? "" : ` (${v.pct >= 0 ? "+" : ""}${r0(v.pct * 100)}%)`}</option>`).join("")
  }</select></label>` : "";

  html += `<section class="card">
    <div class="hero">
      <div class="ring ${over ? "over" : ""}">
        <svg viewBox="0 0 148 148"><circle class="track" cx="74" cy="74" r="${R}" fill="none" stroke-width="13"/>
        <circle class="fill" cx="74" cy="74" r="${R}" fill="none" stroke-width="13" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${tot.kcal > 0 ? off : C}"/></svg>
        <div class="ring-center"><div><b class="num">${fmt(tot.kcal)}</b><span>${goal ? "de " + fmt(goal) + " kcal" : "kcal"}</span>${goal ? `<div class="pct num">${r0(pct * 100)}%</div>` : ""}</div></div>
      </div>
      <div class="hero-side">
        <div class="big">${!goal ? "Consumides" : left >= 0 ? "Queden" : "Per sobre"}<b class="num">${goal ? fmt(Math.abs(left)) : fmt(tot.kcal)} kcal</b></div>
      </div>
    </div>
    ${typeSel}
    <div class="macros">
      ${macroRow("Proteïna", "prot", tot.p, tg && tg.p)}
      ${macroRow("Hidrats", "carb", tot.c, tg && tg.c)}
      ${macroRow("Greix", "fat", tot.f, tg && tg.f)}
    </div>
  </section>`;

  // Aigua
  const wg = waterGoal(UI.date), w = d.water || 0;
  const nG = clamp(Math.ceil(wg / 250), 4, 18);
  let glasses = "";
  for (let i = 0; i < nG; i++) {
    const fill = clamp((w - i * 250) / 250, 0, 1);
    glasses += `<div class="glass"><i style="height:${fill * 100}%"></i></div>`;
  }
  html += `<section class="card">
    <h2>Aigua <span class="sub num">${(w / 1000).toLocaleString("ca-ES", { maximumFractionDigits: 2 })} / ${(wg / 1000).toLocaleString("ca-ES", { maximumFractionDigits: 2 })} L</span></h2>
    <div class="water-glasses" aria-hidden="true" style="grid-template-columns:repeat(${nG <= 10 ? nG : Math.ceil(nG / 2)},1fr)">${glasses}</div>
    <div class="bar" style="margin-bottom:14px"><div class="c-water" style="width:${clamp(w / wg, 0, 1) * 100}%"></div></div>
    <div class="water-actions">
      <button class="btn" data-action="water" data-ml="-250" aria-label="Treu 250 ml">−250</button>
      <button class="btn add" data-action="water" data-ml="250">+250 ml</button>
      <button class="btn add" data-action="water" data-ml="500">+500 ml</button>
      <button class="btn" data-action="water-custom">Altre</button>
    </div>
  </section>`;

  // Menjars
  const meals = [...(d.meals || [])].sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  html += `<section class="card"><h2>Menjars <span class="sub" style="display:flex;gap:6px"><button class="btn sm" data-action="voice-quick" aria-label="Dicta un menjar">${ICON.mic}Dicta</button><button class="btn sm primary" data-action="goto" data-tab="meal">${ICON.plus}Afegir</button></span></h2>`;
  if (!meals.length) html += `<div class="empty">Encara no has registrat res aquest dia.</div>`;
  for (const m of meals) {
    const mt = mealTotals(m);
    html += `<div class="meal">
      <div class="meal-head"><b>${esc(m.type)}</b><span class="t">${esc(m.time || "")}</span><span class="k num">${fmt(mt.kcal)} kcal</span></div>
      <ul class="meal-items">${m.items.map(i => `<li><span>${fmt(i.grams)} g · ${esc(i.name)}</span><span class="num">${fmt(i.kcal)}</span></li>`).join("")}</ul>
      <div class="meal-foot">
        <span class="chip"><i class="c-prot"></i>P ${r0(mt.p)}</span><span class="chip"><i class="c-carb"></i>H ${r0(mt.c)}</span><span class="chip"><i class="c-fat"></i>G ${r0(mt.f)}</span>
        <span class="meal-actions">
        <button class="link-btn" data-action="meal-edit" data-id="${m.id}">Edita</button>
        <button class="link-btn" data-action="meal-repeat" data-id="${m.id}">Repeteix</button>
        <button class="link-btn del" data-action="meal-del" data-id="${m.id}">Elimina</button></span>
      </div></div>`;
  }
  html += `</section>`;
  return html;
}
function macroRow(label, cls, val, goal) {
  const p = goal ? clamp(val / goal, 0, 1) : 0;
  return `<div class="macro"><div class="mrow"><b><i class="c-${cls}"></i>${label}</b><span class="num">${r0(val)}${goal ? ` / ${r0(goal)}` : ""} g</span></div>
    <div class="bar"><div class="c-${cls}" style="width:${p * 100}%"></div></div></div>`;
}

// ——————————————————— MENJAR ———————————————————
function resolveLine(line) {
  let food = null, alts = [];
  if (line.foodId) food = foodById(line.foodId);
  const hits = line.name ? searchFoods(line.name, allFoods(), 5) : [];
  if (!food && hits.length) food = hits[0].food;
  alts = hits.map(h => h.food).filter(f => !food || f.id !== food.id).slice(0, 3);
  const grams = +String(line.grams).replace(",", ".") || 0;
  return { food, alts, grams, m: food ? macrosFor(food, grams) : null };
}
function viewMeal() {
  const dr = UI.draft;
  const names = allFoods().map(f => `<option value="${esc(f.name)}">`).join("");
  return `
  <datalist id="foodlist">${names}</datalist>
  <section class="card">
    <label class="field"><span>Àpat</span>
      <select class="input" data-draft="type">${MEAL_TYPES.map(t => `<option ${t === dr.type ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    <label class="field"><span>Què has menjat?</span>
      <div class="voice-wrap">
        <textarea class="input" data-draft="text" id="meal-text" placeholder="Escriu o dicta: 200g de pollastre, 50g de pebrot i 150g d'arròs">${esc(dr.text)}</textarea>
        <button type="button" class="mic-btn" id="mic-btn" data-action="voice" aria-label="Dicta amb la veu">${ICON.mic}</button>
      </div></label>
    <div class="voice-status" id="voice-status" hidden></div>
    <button class="btn primary block" data-action="meal-parse">${ICON.calc}Calcula</button>
    <p class="small faint" style="margin:10px 2px 0">Toca el micròfon i digues, per exemple, <i>"per dinar dos-cents grams de pollastre i cent cinquanta d'arròs"</i>. Accepta grams, kg, ml i unitats ("2 ous", "1 iogurt", "1 cullerada d'oli", "1 scoop whey").</p>
  </section>
  <div id="lines">${dr.lines.map(lineHTML).join("")}</div>
  <button class="btn block" data-action="line-add" style="margin-bottom:4px">${ICON.plus}Afegir aliment a mà</button>
  <div class="totals-bar" id="totals"></div>
  ${recentHTML()}`;
}
function lineHTML(l) {
  return `<div class="line-card" data-line="${l.id}">
    <div class="line-top">
      <input class="input" list="foodlist" data-lf="name" value="${esc(l.name)}" placeholder="Aliment" autocomplete="off">
      <div class="unit-input"><input class="input num" inputmode="decimal" data-lf="grams" value="${esc(l.grams)}" placeholder="0"><em>g</em></div>
      <button class="rm" data-action="line-rm" aria-label="Treu">×</button>
    </div>
    <div class="line-match"></div>
    <div class="alts"></div>
  </div>`;
}
function refreshLine(id) {
  const l = UI.draft.lines.find(x => x.id === id);
  const el = $(`[data-line="${id}"]`);
  if (!l || !el) return;
  const r = resolveLine(l);
  const mEl = $(".line-match", el), aEl = $(".alts", el);
  if (!l.name.trim()) { mEl.innerHTML = `<span class="faint">Escriu un aliment</span>`; aEl.innerHTML = ""; return; }
  if (!r.food) {
    mEl.innerHTML = `<span class="src none">No trobat</span><span class="muted">Tria'n un de la llista o crea'l a Aliments</span>`;
  } else {
    mEl.innerHTML = `<span class="src ${r.food.generic ? "gen" : "mine"}">${r.food.generic ? "Genèric" : "Meu"}</span>
      <span>${esc(r.food.name)}</span>
      <span class="mk num">${fmt(r.m.kcal)} kcal · P ${fmt1(r.m.p)} · H ${fmt1(r.m.c)} · G ${fmt1(r.m.f)}</span>`;
  }
  aEl.innerHTML = r.alts.map(f => `<button data-action="line-pick" data-food="${f.id}">${esc(f.name)}</button>`).join("");
}
function refreshAllLines() { UI.draft.lines.forEach(l => refreshLine(l.id)); refreshTotals(); }
function draftTotals() {
  const t = { kcal: 0, p: 0, c: 0, f: 0, ok: 0, bad: 0 };
  for (const l of UI.draft.lines) {
    if (!l.name.trim()) continue;
    const r = resolveLine(l);
    if (!r.food || !r.grams) { t.bad++; continue; }
    t.ok++; t.kcal += r.m.kcal; t.p += r.m.p; t.c += r.m.c; t.f += r.m.f;
  }
  return t;
}
function refreshTotals() {
  const el = $("#totals");
  if (!el) return;
  const t = draftTotals();
  el.innerHTML = `<div class="grow"><div class="tk num">${fmt(t.kcal)} kcal</div>
    <div class="tm num"><span>P ${r0(t.p)} g</span><span>H ${r0(t.c)} g</span><span>G ${r0(t.f)} g</span></div></div>
    <button class="btn primary" data-action="meal-save" ${t.ok ? "" : "disabled style='opacity:.5'"}>${UI.draft.editing ? "Desa canvis" : "Desa al dia"}</button>`;
}
function recentHTML() {
  const list = [], seen = new Set();
  const keys = Object.keys(S.days).sort().reverse();
  for (const k of keys) {
    for (const m of [...S.days[k].meals].reverse()) {
      const sig = m.items.map(i => i.name + i.grams).join("|");
      if (seen.has(sig)) continue;
      seen.add(sig); list.push({ k, m });
      if (list.length >= 8) break;
    }
    if (list.length >= 8) break;
  }
  if (!list.length) return "";
  return `<h3 class="view-title">Menjars recents</h3><section class="card">${list.map(({ k, m }) => `
    <div class="recent"><div class="grow"><b>${esc(m.type)}</b> <span class="faint small">${esc(fmtShort(k))} · ${fmt(mealTotals(m).kcal)} kcal</span>
      <div class="desc">${esc(m.items.map(i => `${fmt(i.grams)} g ${i.name}`).join(", "))}</div></div>
      <button class="btn sm" data-action="recent-add" data-day="${k}" data-id="${m.id}">Afegeix</button></div>`).join("")}</section>`;
}
function mealToLines(m) {
  return m.items.map(i => ({ id: uid(), name: i.name, grams: i.grams, foodId: i.foodId && foodById(i.foodId) ? i.foodId : null }));
}
function parseDraftText() {
  const text = UI.draft.text.trim();
  if (!text) { toast("Escriu o dicta què has menjat"); return; }
  const parsed = parseMealText(text, allFoods());
  const keep = UI.draft.lines.filter(l => l.name.trim() && l.fromText !== true);
  UI.draft.lines = [...keep, ...parsed.map(r => ({ id: uid(), name: r.name, grams: r.grams, foodId: r.food ? r.food.id : null, fromText: true }))];
  saveDraft();
  $("#lines").innerHTML = UI.draft.lines.map(lineHTML).join("");
  refreshAllLines();
  if (!parsed.length) toast("No he trobat cap aliment al text");
}

// ——— Dictat per veu (reconeixement de veu del navegador, gratuït) ———
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let voice = null;
function setVoiceUI(state, msg) {
  const b = $("#mic-btn"), st = $("#voice-status");
  if (b) { b.classList.toggle("on", state === "listening"); b.innerHTML = state === "listening" ? ICON.stop : ICON.mic; b.setAttribute("aria-label", state === "listening" ? "Atura el dictat" : "Dicta amb la veu"); }
  if (st) { st.hidden = !msg; st.textContent = msg || ""; st.classList.toggle("live", state === "listening"); }
}
function toggleVoice() { if (voice) voice.rec.stop(); else startVoice(); }
function startVoice() {
  if (!SpeechRec) {
    toast("Aquest navegador no permet dictar aquí: fes servir el micròfon del teclat");
    const ta = $("#meal-text"); if (ta) ta.focus();
    return;
  }
  if (voice) return;
  const ta = $("#meal-text");
  const base = (UI.draft.text || "").trim();
  const rec = new SpeechRec();
  rec.lang = S.profile.voiceLang || "ca-ES";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  voice = { rec, finalText: "", error: null };
  rec.onresult = e => {
    let fin = "", interim = "";
    for (let i = 0; i < e.results.length; i++) {
      const tr = e.results[i][0].transcript;
      if (e.results[i].isFinal) fin += tr; else interim += tr;
    }
    voice.finalText = fin.trim();
    const spoken = (fin + " " + interim).trim();
    const t = $("#meal-text");
    if (t) t.value = base ? `${base}, ${spoken}` : spoken;
  };
  rec.onerror = e => { if (voice) voice.error = e.error; };
  rec.onend = () => {
    const v = voice; voice = null;
    if (!v) return;
    if (v.error && v.error !== "no-speech" && v.error !== "aborted") {
      const msgs = { "not-allowed": "Cal donar permís al micròfon (configuració del navegador)", "service-not-allowed": "El dictat no està disponible en aquest mode; fes servir el micròfon del teclat", network: "Cal connexió a internet per dictar", "audio-capture": "No s'ha trobat cap micròfon", "language-not-supported": "Idioma no disponible: prova l'altre a Perfil" };
      setVoiceUI("idle", "");
      toast(msgs[v.error] || "No s'ha pogut dictar");
      const t = $("#meal-text"); if (t) t.value = UI.draft.text || "";
      return;
    }
    if (!v.finalText) { setVoiceUI("idle", ""); toast("No t'he sentit. Torna-ho a provar"); const t = $("#meal-text"); if (t) t.value = UI.draft.text || ""; return; }
    UI.draft.text = base ? `${base}, ${v.finalText}` : v.finalText;
    const mt = detectMealType(v.finalText);
    if (mt) { UI.draft.type = mt; const sel = $('[data-draft="type"]'); if (sel) sel.value = mt; }
    saveDraft();
    const t = $("#meal-text"); if (t) t.value = UI.draft.text;
    setVoiceUI("idle", "");
    parseDraftText();
  };
  try { rec.start(); }
  catch (e) { voice = null; toast("No s'ha pogut iniciar el dictat"); return; }
  if (ta) ta.value = base;
  setVoiceUI("listening", "Escoltant… digues què has menjat");
}

function saveMeal() {
  const items = [];
  for (const l of UI.draft.lines) {
    if (!l.name.trim()) continue;
    const r = resolveLine(l);
    if (!r.food) { toast(`"${l.name}" no s'ha trobat: tria'n un o treu la línia`); return; }
    if (!r.grams) { toast(`Falten els grams de "${l.name}"`); return; }
    items.push({ name: r.food.name, foodId: r.food.id, grams: r1(r.grams), kcal: r1(r.m.kcal), p: r1(r.m.p), c: r1(r.m.c), f: r1(r.m.f) });
  }
  if (!items.length) return;
  const ed = UI.draft.editing;
  const day = ensureDay(UI.date);
  if (ed) {
    const src = S.days[ed.date];
    if (src) src.meals = src.meals.filter(m => m.id !== ed.id);
  }
  const meal = { id: ed ? ed.id : uid(), type: UI.draft.type, time: ed ? ed.time : (UI.date === todayKey() ? nowHM() : "13:00"), items };
  day.meals.push(meal);
  save();
  const k = mealTotals(meal).kcal;
  resetDraft();
  toast(`${ed ? "Desat" : "Afegit"}: ${fmt(k)} kcal`);
  setTab("today");
}

// ——————————————————— ALIMENTS ———————————————————
let thumbURLs = [];
function viewFoods() {
  const q = UI.foodsQ;
  const mine = UI.foodsSeg === "mine";
  let list = mine ? [...S.foods].sort((a, b) => a.name.localeCompare(b.name, "ca")) : GENERIC_FOODS;
  if (q.trim()) {
    const hits = searchFoods(q, list, 200);
    const nq = norm(q);
    const sub = list.filter(f => norm(f.name).includes(nq) && !hits.some(h => h.food.id === f.id));
    list = [...hits.map(h => h.food), ...sub];
  }
  let html = `<div class="seg" style="margin:6px 0 10px">
      <button class="${mine ? "on" : ""}" data-action="foods-seg" data-v="mine">Els meus (${S.foods.length})</button>
      <button class="${!mine ? "on" : ""}" data-action="foods-seg" data-v="gen">Genèrics (${GENERIC_FOODS.length})</button></div>
    <input class="input" type="search" id="foods-q" placeholder="Cerca…" value="${esc(q)}" style="margin-bottom:12px">`;
  if (mine && !S.foods.length) {
    html += `<section class="card"><div class="empty">Encara no has pujat cap aliment.<br>Fes una foto de la taula nutricional i posa-li un nom.<br><br>
      <button class="btn primary" data-action="food-new">${ICON.camera}Pujar aliment</button></div></section>`;
    return html;
  }
  html += `<section class="card">${list.length ? list.map(f => `
    <div class="food" data-action="${mine ? "food-edit" : "food-copy"}" data-id="${f.id}">
      <div class="thumb" ${mine ? `data-img="${f.id}"` : ""}>${esc(f.name.slice(0, 2).toUpperCase())}</div>
      <div class="grow"><div class="fname">${esc(f.name)}</div>
        <div class="fmac num">P ${fmt1(f.p)} · H ${fmt1(f.c)} · G ${fmt1(f.f)}${f.unitG ? ` · 1 u = ${fmt(f.unitG)} g` : ""}</div></div>
      <div class="fk num">${fmt(f.kcal)}<small>kcal/100 g</small></div>
    </div>`).join("") : `<div class="empty">Cap resultat.</div>`}</section>`;
  if (!mine) html += `<p class="small faint" style="margin:0 4px">Valors orientatius per 100 g. Toca'n un per copiar-lo als teus i ajustar-lo.</p>`;
  return html;
}
async function loadThumbs() {
  thumbURLs.forEach(u => URL.revokeObjectURL(u)); thumbURLs = [];
  for (const el of $$("[data-img]")) {
    const b = await IDB.get(el.dataset.img);
    if (b && el.isConnected) { const u = URL.createObjectURL(b); thumbURLs.push(u); el.innerHTML = `<img src="${u}" alt="">`; }
  }
}

// Editor d'aliment (full inferior)
let editor = null;
function openFoodEditor(food, { copy = false } = {}) {
  const isNew = !food || copy;
  editor = { id: isNew ? null : food.id, blob: null, previewURL: null, removeImg: false };
  const f = food || { name: "", kcal: "", p: "", c: "", f: "", unitG: "", aliases: [] };
  const sh = $("#sheet");
  sh.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">
    <div class="grab"></div>
    <div class="sheet-head"><h3>${isNew ? "Nou aliment" : "Edita aliment"}</h3><button class="icon-btn" data-action="sheet-close" aria-label="Tanca">${ICON.close}</button></div>
    <div class="photo-zone" id="photo-zone">
      <img id="ed-img" hidden alt="Etiqueta">
      <div class="small muted" id="ed-photo-hint" style="margin-bottom:10px">Fes una foto de la taula nutricional: els valors s'ompliran sols i podràs corregir-los.</div>
      <div class="row">
        <label class="btn primary">${ICON.camera}Foto<input type="file" accept="image/*" capture="environment" data-action="ed-file" hidden></label>
        <label class="btn">${ICON.image}Galeria<input type="file" accept="image/*" data-action="ed-file" hidden></label>
      </div>
      <div class="ocr-status" id="ocr-status" hidden></div>
      <div class="progress" id="ocr-prog" hidden><div></div></div>
      <details id="ocr-raw" hidden style="text-align:left;margin-top:10px"><summary class="small muted">Text llegit</summary><pre class="small" style="white-space:pre-wrap;margin:6px 0 0"></pre></details>
    </div>
    <label class="field"><span>Nom</span><input class="input" id="ed-name" value="${esc(copy ? f.name.replace(/\s*\(.*?\)\s*/g, " ").trim() : f.name)}" placeholder="Ex: Pit de pollastre Mercadona"></label>
    <div class="small muted" style="margin:-4px 2px 6px;font-weight:550">Valors per 100 g (o 100 ml)</div>
    <div class="grid4">
      <label class="field"><span>Kcal</span><input class="input num" inputmode="decimal" id="ed-kcal" value="${esc(f.kcal)}"></label>
      <label class="field"><span>Proteïna</span><input class="input num" inputmode="decimal" id="ed-p" value="${esc(f.p)}"></label>
      <label class="field"><span>Hidrats</span><input class="input num" inputmode="decimal" id="ed-c" value="${esc(f.c)}"></label>
      <label class="field"><span>Greix</span><input class="input num" inputmode="decimal" id="ed-f" value="${esc(f.f)}"></label>
    </div>
    <div class="banner warn" id="ed-warn" hidden></div>
    <div class="grid2">
      <label class="field"><span>Pes d'1 unitat (opcional)</span><div class="unit-input"><input class="input num" inputmode="decimal" id="ed-unit" value="${esc(f.unitG || "")}" placeholder="—"><em>g</em></div></label>
      <label class="field"><span>Altres noms (opcional)</span><input class="input" id="ed-alias" value="${esc(copy ? "" : (f.aliases || []).join(", "))}" placeholder="pollastre, pit"></label>
    </div>
    <p class="small faint" style="margin:-4px 2px 14px">Amb el pes d'1 unitat pots escriure "2 iogurts" en lloc de grams. Els altres noms ajuden a trobar-lo quan escrius un menjar.</p>
    <button class="btn primary block" data-action="ed-save">Desa l'aliment</button>
    ${!isNew ? `<button class="btn danger block" data-action="ed-del" style="margin-top:8px">Elimina</button>` : ""}
  </div>`;
  sh.hidden = false;
  document.body.style.overflow = "hidden";
  if (!isNew) IDB.get(food.id).then(b => { if (b && editor && editor.id === food.id) showEditorImg(URL.createObjectURL(b)); });
  $$("#ed-kcal,#ed-p,#ed-c,#ed-f").forEach(i => i.addEventListener("input", checkEditorKcal));
}
function closeSheet() {
  const sh = $("#sheet");
  sh.hidden = true; sh.innerHTML = "";
  document.body.style.overflow = "";
  if (editor && editor.previewURL) URL.revokeObjectURL(editor.previewURL);
  editor = null;
  ocrLogger = null;
}
function showEditorImg(url) {
  const img = $("#ed-img");
  if (!img) return;
  img.src = url; img.hidden = false;
  const hint = $("#ed-photo-hint"); if (hint) hint.hidden = true;
}
function numVal(id) { const v = $(id).value.trim().replace(",", "."); return v === "" ? null : +v; }
function checkEditorKcal() {
  const kcal = numVal("#ed-kcal"), p = numVal("#ed-p") || 0, c = numVal("#ed-c") || 0, f = numVal("#ed-f") || 0;
  const w = $("#ed-warn");
  const calc = p * 4 + c * 4 + f * 9;
  if (kcal && calc && Math.abs(calc - kcal) / kcal > 0.2) {
    w.hidden = false;
    w.innerHTML = `<span>Les macros sumen ~${fmt(calc)} kcal i n'has posat ${fmt(kcal)}. Revisa que siguin valors per 100 g.</span>`;
  } else w.hidden = true;
}
async function editorSave() {
  const name = $("#ed-name").value.trim();
  if (!name) { toast("Posa-li un nom"); $("#ed-name").focus(); return; }
  const p = numVal("#ed-p") ?? 0, c = numVal("#ed-c") ?? 0, f = numVal("#ed-f") ?? 0;
  let kcal = numVal("#ed-kcal");
  if (kcal == null) kcal = r0(p * 4 + c * 4 + f * 9);
  if ([kcal, p, c, f].some(v => isNaN(v) || v < 0)) { toast("Revisa els números"); return; }
  const unitG = numVal("#ed-unit");
  const aliases = $("#ed-alias").value.split(",").map(s => s.trim()).filter(Boolean);
  let food;
  if (editor.id) {
    food = S.foods.find(x => x.id === editor.id);
    Object.assign(food, { name, kcal, p, c, f, unitG: unitG || null, aliases });
  } else {
    food = { id: "u" + uid(), name, kcal, p, c, f, unitG: unitG || null, aliases, generic: false, created: todayKey() };
    S.foods.push(food);
  }
  if (editor.blob) await IDB.put(food.id, editor.blob);
  save();
  closeSheet();
  UI.foodsSeg = "mine";
  toast(`Desat: ${name}`);
  if (UI.tab === "foods") render();
  else if (UI.tab === "meal") { const v = $("#view"); v.innerHTML = viewMeal(); refreshAllLines(); }
}
async function editorDelete() {
  if (!editor.id || !confirm("Eliminar aquest aliment? Els menjars ja registrats no canvien.")) return;
  S.foods = S.foods.filter(x => x.id !== editor.id);
  await IDB.del(editor.id);
  save(); closeSheet(); render();
  toast("Aliment eliminat");
}

// ——— OCR (Tesseract.js, gratuït i al dispositiu) ———
let tessWorker = null, ocrLogger = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("No s'ha pogut carregar " + src));
    document.head.appendChild(s);
  });
}
async function getTesseract() {
  if (!window.Tesseract) await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");
  if (!tessWorker) {
    tessWorker = await Tesseract.createWorker(["spa", "eng"], 1, { logger: m => ocrLogger && ocrLogger(m) });
    await tessWorker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
  }
  return tessWorker;
}
async function decodeImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { img, url };
}
function canvasFrom(img, maxSide, allowUp = false) {
  const w = img.naturalWidth, h = img.naturalHeight;
  let s = maxSide / Math.max(w, h);
  if (!allowUp) s = Math.min(1, s); else s = Math.min(2, s);
  const cv = document.createElement("canvas");
  cv.width = Math.round(w * s); cv.height = Math.round(h * s);
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}
function prepForOCR(img) {
  const cv = canvasFrom(img, 2000, true);
  const ctx = cv.getContext("2d");
  const d = ctx.getImageData(0, 0, cv.width, cv.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    let g = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    g = clamp((g - 128) * 1.45 + 140, 0, 255);
    a[i] = a[i + 1] = a[i + 2] = g;
  }
  ctx.putImageData(d, 0, 0);
  return cv;
}
async function handleEditorFile(file) {
  if (!file || !editor) return;
  const status = $("#ocr-status"), prog = $("#ocr-prog"), bar = $("#ocr-prog > div");
  let img, url;
  try { ({ img, url } = await decodeImage(file)); }
  catch (e) { toast("No s'ha pogut obrir la imatge"); return; }
  if (editor.previewURL) URL.revokeObjectURL(editor.previewURL);
  editor.previewURL = url;
  showEditorImg(url);
  // Còpia comprimida per guardar
  const small = canvasFrom(img, 900);
  editor.blob = await new Promise(r => small.toBlob(r, "image/jpeg", 0.72));

  status.hidden = false; prog.hidden = false; bar.style.width = "3%";
  status.textContent = "Preparant el lector… (el primer cop baixa uns 10 MB)";
  ocrLogger = m => {
    if (!editor) return;
    if (m.status === "recognizing text") { status.textContent = "Llegint l'etiqueta…"; bar.style.width = (30 + m.progress * 70) + "%"; }
    else if (/load|init/.test(m.status)) { status.textContent = "Preparant el lector…"; bar.style.width = (3 + (m.progress || 0) * 27) + "%"; }
  };
  try {
    const w = await getTesseract();
    const { data } = await w.recognize(prepForOCR(img));
    if (!editor) return;
    const r = parseLabelText(data.text);
    const set = (id, v) => { if (v != null && !isNaN(v)) $(id).value = r1(v); };
    set("#ed-kcal", r.kcal); set("#ed-p", r.p); set("#ed-c", r.c); set("#ed-f", r.f);
    const got = [r.kcal, r.p, r.c, r.f].filter(v => v != null).length;
    status.textContent = got === 4 ? "Valors llegits. Comprova'ls amb la foto abans de desar." : got ? `He llegit ${got} de 4 valors. Completa la resta a mà.` : "No he pogut llegir els valors. Prova una foto més recta i amb més llum, o omple'ls a mà.";
    bar.style.width = "100%";
    const raw = $("#ocr-raw"); raw.hidden = false; $("pre", raw).textContent = data.text.trim();
    checkEditorKcal();
    setTimeout(() => { if (prog.isConnected) prog.hidden = true; }, 600);
  } catch (e) {
    console.error(e);
    status.textContent = "No s'ha pogut llegir l'etiqueta (cal connexió el primer cop). Omple els valors a mà.";
    prog.hidden = true;
  }
}

// ——————————————————— ESTADÍSTIQUES ———————————————————
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 6 ? 6 : n <= 8 ? 8 : 10) * p;
}
function roundTop(x, y, w, h, r) {
  r = Math.min(r, h, w / 2);
  if (h <= 0) return "";
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
// Barres (simples o apilades) amb marca d'objectiu i tooltip
function barChart(items, { height = 170, unit = "" } = {}) {
  const W = 340, H = height, L = 34, R = 6, T = 10, B = 22;
  const pw = W - L - R, ph = H - T - B, n = items.length;
  const maxV = niceMax(Math.max(1, ...items.map(it => Math.max(it.segs.reduce((s, x) => s + x.v, 0), it.target || 0))) * 1.05);
  const y = v => T + ph - (v / maxV) * ph;
  const slot = pw / n, bw = Math.min(22, slot * 0.62);
  const every = Math.ceil(n / 8);
  let g = `<g class="grid">`;
  for (const t of [0, maxV / 2, maxV]) g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${t >= 1000 ? (Math.round(t / 100) / 10).toLocaleString("ca-ES") + "k" : r0(t)}</text>`;
  g += `</g>`;
  let bars = "";
  items.forEach((it, i) => {
    const x = L + slot * i + (slot - bw) / 2;
    let acc = 0;
    const segs = it.segs.filter(s => s.v > 0);
    segs.forEach((s, j) => {
      const y0 = y(acc), y1 = y(acc + s.v);
      const top = j === segs.length - 1;
      const h = Math.max(0, y0 - y1 - (top ? 0 : 2));
      bars += top ? `<path class="${s.cls}" style="fill:var(--${s.cls})" d="${roundTop(x, y1, bw, h, 4)}"/>`
                  : `<rect style="fill:var(--${s.cls})" x="${x}" y="${y1 + 2}" width="${bw}" height="${h}"/>`;
      acc += s.v;
    });
    if (it.target) bars += `<line class="tgt" x1="${x - 3}" x2="${x + bw + 3}" y1="${y(it.target)}" y2="${y(it.target)}"/>`;
    if (i % every === 0 || i === n - 1) bars += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(it.label)}</text>`;
    bars += `<rect class="hit" data-tip="${esc(it.tip)}" x="${L + slot * i}" y="${T}" width="${slot}" height="${ph}"/>`;
  });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${g}${bars}</svg><div class="tip" hidden></div></div>`;
}
function lineChart(pts, { height = 150 } = {}) {
  const W = 340, H = height, L = 34, R = 10, T = 12, B = 22;
  const pw = W - L - R, ph = H - T - B;
  const vs = pts.map(p => p.v), lo = Math.floor(Math.min(...vs) - 1), hi = Math.ceil(Math.max(...vs) + 1);
  const t0 = parseKey(pts[0].d).getTime(), t1 = parseKey(pts[pts.length - 1].d).getTime() || t0 + 1;
  const x = d => L + (t1 === t0 ? pw / 2 : ((parseKey(d).getTime() - t0) / (t1 - t0)) * pw);
  const y = v => T + ph - ((v - lo) / (hi - lo)) * ph;
  let g = `<g class="grid">`;
  for (const t of [lo, (lo + hi) / 2, hi]) g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${fmt1(t)}</text>`;
  g += `</g>`;
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.d)},${y(p.v)}`).join("");
  let marks = `<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  pts.forEach((p, i) => {
    marks += `<circle cx="${x(p.d)}" cy="${y(p.v)}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`;
    marks += `<circle class="hit" cx="${x(p.d)}" cy="${y(p.v)}" r="13" data-tip="${esc(fmtShort(p.d))}: ${fmt1(p.v)} kg"/>`;
  });
  const first = pts[0], last = pts[pts.length - 1];
  marks += `<text x="${L}" y="${H - 6}">${esc(fmtShort(first.d))}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${esc(fmtShort(last.d))}</text>`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${g}${marks}</svg><div class="tip" hidden></div></div>`;
}
function viewStats() {
  const n = UI.statsRange, end = todayKey();
  const keys = []; for (let i = n - 1; i >= 0; i--) keys.push(addDays(end, -i));
  const rows = keys.map(k => {
    const d = getDay(k), tot = dayTotals(d), tg = targetFor(k);
    return { k, tot, tg, water: d.water || 0, wgoal: waterGoal(k), logged: (d.meals || []).length > 0 };
  });
  const logged = rows.filter(r => r.logged);
  const avg = f => logged.length ? logged.reduce((s, r) => s + f(r), 0) / logged.length : 0;
  const avgK = avg(r => r.tot.kcal), avgT = avg(r => r.tg ? r.tg.kcal : 0);
  const inRange = logged.filter(r => r.tg && Math.abs(r.tot.kcal / r.tg.kcal - 1) <= 0.1).length;
  const avgP = avg(r => r.tot.p), avgPT = avg(r => r.tg ? r.tg.p : 0);
  const wDays = rows.filter(r => r.water > 0);
  const avgW = wDays.length ? wDays.reduce((s, r) => s + r.water, 0) / wDays.length : 0;

  let html = `<div class="seg" style="margin:6px 0 12px">${[7, 14, 30].map(v => `<button class="${n === v ? "on" : ""}" data-action="stats-range" data-v="${v}">${v} dies</button>`).join("")}</div>`;
  if (!logged.length && !wDays.length) return html + `<section class="card"><div class="empty">Quan registris menjars, aquí veuràs l'evolució dia a dia.</div></section>`;

  html += `<div class="kpis">
    <div class="kpi"><span>Mitjana diària</span><b class="num">${fmt(avgK)}</b><small>kcal${avgT ? ` · objectiu ${fmt(avgT)}` : ""}</small></div>
    <div class="kpi"><span>Dies dins ±10%</span><b class="num">${inRange}/${logged.length}</b><small>dies registrats</small></div>
    <div class="kpi"><span>Proteïna mitjana</span><b class="num">${r0(avgP)} g</b><small>${avgPT ? `${r0(avgP / avgPT * 100)}% de l'objectiu` : "&nbsp;"}</small></div>
    <div class="kpi"><span>Aigua mitjana</span><b class="num">${(avgW / 1000).toLocaleString("ca-ES", { maximumFractionDigits: 1 })} L</b><small>${wDays.length} dies amb registre</small></div>
  </div>`;

  const lbl = k => n <= 7 ? fmtDow(k).toUpperCase() : String(parseKey(k).getDate());
  html += `<section class="card"><h2>Calories</h2>${barChart(rows.map(r => ({
      label: lbl(r.k), target: r.tg && (r.logged || r.k === end) ? r.tg.kcal : 0,
      segs: [{ v: r.tot.kcal, cls: "accent" }],
      tip: `${fmtShort(r.k)}: ${fmt(r.tot.kcal)} kcal${r.tg ? ` / ${fmt(r.tg.kcal)}` : ""}`,
    })))}<div class="legend"><span><i class="c-kcal"></i>Consumides</span><span><i class="line"></i>Objectiu del dia</span></div></section>`;

  html += `<section class="card"><h2>Macros <span class="sub">kcal per macro</span></h2>${barChart(rows.map(r => ({
      label: lbl(r.k),
      segs: [{ v: r.tot.p * 4, cls: "prot" }, { v: r.tot.c * 4, cls: "carb" }, { v: r.tot.f * 9, cls: "fat" }],
      tip: `${fmtShort(r.k)} · P ${r0(r.tot.p)} g · H ${r0(r.tot.c)} g · G ${r0(r.tot.f)} g`,
    })))}<div class="legend"><span><i class="c-prot"></i>Proteïna</span><span><i class="c-carb"></i>Hidrats</span><span><i class="c-fat"></i>Greix</span></div></section>`;

  html += `<section class="card"><h2>Aigua</h2>${barChart(rows.map(r => ({
      label: lbl(r.k), target: r.water || r.logged || r.k === end ? r.wgoal : 0,
      segs: [{ v: r.water, cls: "water" }],
      tip: `${fmtShort(r.k)}: ${(r.water / 1000).toLocaleString("ca-ES")} / ${(r.wgoal / 1000).toLocaleString("ca-ES")} L`,
    })), { height: 140 })}<div class="legend"><span><i class="c-water"></i>Begut</span><span><i class="line"></i>Objectiu</span></div></section>`;

  const wpts = S.weights.filter(w => w.d >= keys[0]).sort((a, b) => a.d.localeCompare(b.d)).map(w => ({ d: w.d, v: +w.kg }));
  if (wpts.length >= 2) html += `<section class="card"><h2>Pes <span class="sub num">${r1(wpts[wpts.length - 1].v - wpts[0].v) > 0 ? "+" : ""}${fmt1(wpts[wpts.length - 1].v - wpts[0].v)} kg</span></h2>${lineChart(wpts)}</section>`;

  html += `<section class="card"><h2>Detall</h2><div class="table-wrap"><table class="data num"><thead><tr><th>Dia</th><th>Kcal</th><th>%</th><th>P</th><th>H</th><th>G</th><th>Aigua</th></tr></thead><tbody>${
    [...rows].reverse().filter(r => r.logged || r.water).map(r => `<tr><td>${esc(fmtShort(r.k))}</td><td>${fmt(r.tot.kcal)}</td><td>${r.tg ? r0(r.tot.kcal / r.tg.kcal * 100) + "%" : "—"}</td><td>${r0(r.tot.p)}</td><td>${r0(r.tot.c)}</td><td>${r0(r.tot.f)}</td><td>${(r.water / 1000).toLocaleString("ca-ES", { maximumFractionDigits: 2 })}</td></tr>`).join("")
  }</tbody></table></div></section>`;
  return html;
}

// ——————————————————— PERFIL ———————————————————
let installPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; if (UI.tab === "profile") render(); });
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function viewProfile() {
  const p = S.profile;
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${esc(v.label)}</option>`).join("");
  const num = (field, label, unit, step = "any", ph = "") => `<label class="field"><span>${label}</span><div class="unit-input"><input class="input num" type="number" inputmode="decimal" step="${step}" min="0" data-p="${field}" value="${esc(p[field])}" placeholder="${ph}"><em>${unit}</em></div></label>`;
  const lastW = [...S.weights].sort((a, b) => b.d.localeCompare(a.d));
  let installBlock = "";
  if (isStandalone()) installBlock = `<p class="small muted" style="margin:0 0 12px">L'app ja està instal·lada.</p>`;
  else if (installPrompt) installBlock = `<button class="btn primary block" data-action="install" style="margin-bottom:12px">Instal·la l'app al dispositiu</button>`;
  else if (isIOS()) installBlock = `<p class="small muted" style="margin:0 0 12px">Per instal·lar-la: obre-la amb Safari, toca <b>Compartir</b> i després <b>Afegir a la pantalla d'inici</b>.</p>`;
  else installBlock = `<p class="small muted" style="margin:0 0 12px">Per instal·lar-la: menú del navegador → <b>Instal·la l'aplicació</b> / <b>Afegeix a la pantalla d'inici</b>.</p>`;

  return `
  <section class="card"><h2>Dades personals</h2>
    <label class="field"><span>Nom</span><input class="input" data-p="name" value="${esc(p.name)}" placeholder="Opcional"></label>
    <label class="field"><span>Sexe</span><div class="seg">
      <button class="${p.sex === "m" ? "on" : ""}" data-action="set-p" data-field="sex" data-v="m">Home</button>
      <button class="${p.sex === "f" ? "on" : ""}" data-action="set-p" data-field="sex" data-v="f">Dona</button></div></label>
    <div class="grid3">${num("age", "Edat", "anys", "1")}${num("height", "Alçada", "cm", "1")}${num("weight", "Pes", "kg", "0.1")}</div>
    ${num("bodyFat", "% de greix corporal (opcional, més precís)", "%", "0.5", "—")}
    <label class="field"><span>Activitat fora dels entrenos</span><select class="input" data-p="neat">${opt(NEAT, p.neat)}</select></label>
  </section>

  <section class="card"><h2>Entrenament</h2>
    <div class="grid2">${num("sessions", "Entrenos per setmana", "/set", "1")}${num("hours", "Hores per entreno", "h", "0.25")}</div>
    <label class="field" style="margin-bottom:0"><span>Intensitat dels entrenos</span><select class="input" data-p="intensity">${opt(INTENSITY, p.intensity)}</select></label>
  </section>

  <section class="card"><h2>Objectiu</h2>
    <div class="seg goal" style="margin-bottom:14px">${Object.entries(GOALS).map(([k, v]) => `<button class="${p.goal === k ? "on" : ""}" data-action="set-p" data-field="goal" data-v="${k}">${v.label}</button>`).join("")}</div>
    ${num("manualAdj", "Ajust manual (opcional, + o −)", "kcal", "10", "0").replace('min="0"', "")}
  </section>

  <section class="card" id="profile-result">${profileResult()}</section>

  <section class="card"><h2>Registre de pes</h2>
    <div class="row" style="margin-bottom:10px"><div class="unit-input grow"><input class="input num" type="number" inputmode="decimal" step="0.1" id="w-new" placeholder="${esc(p.weight || "Pes d'avui")}"><em>kg</em></div>
      <button class="btn primary" data-action="w-add">Registra</button></div>
    ${lastW.length ? lastW.slice(0, 6).map(w => `<div class="kv"><span>${esc(fmtLong(w.d))}</span><b class="num">${fmt1(w.kg)} kg <button class="link-btn del" data-action="w-del" data-d="${w.d}" aria-label="Elimina">×</button></b></div>`).join("") : `<p class="small faint" style="margin:0">Registrar el pes actualitza el càlcul i en veuràs l'evolució a Estadístiques.</p>`}
  </section>

  <section class="card"><h2>App i dades</h2>
    ${installBlock}
    <label class="field"><span>Idioma del dictat per veu</span><div class="seg">
      ${[["ca-ES", "Català"], ["es-ES", "Castellà"]].map(([k, l]) => `<button class="${(p.voiceLang || "ca-ES") === k ? "on" : ""}" data-action="set-p" data-field="voiceLang" data-v="${k}">${l}</button>`).join("")}</div></label>
    <label class="field"><span>Aparença</span><div class="seg">
      ${[["auto", "Automàtic"], ["light", "Clar"], ["dark", "Fosc"]].map(([k, l]) => `<button class="${(p.theme || "auto") === k ? "on" : ""}" data-action="set-p" data-field="theme" data-v="${k}">${l}</button>`).join("")}</div></label>
    <p class="small muted" style="margin:0 0 10px">Les dades es guarden només en aquest dispositiu. Per passar-les a un altre (p. ex. de mòbil a ordinador), exporta una còpia i importa-la a l'altre.</p>
    <div class="grid2">
      <button class="btn" data-action="export">Exporta còpia</button>
      <label class="btn">Importa còpia<input type="file" accept="application/json,.json" data-action="import" hidden></label>
    </div>
    <button class="btn ghost block" data-action="wipe" style="margin-top:8px;color:var(--danger)">Esborra totes les dades</button>
  </section>`;
}
function profileResult() {
  const t = targets();
  if (!t) return `<h2>Ingesta recomanada</h2><div class="empty">Omple edat, alçada i pes per veure el càlcul.</div>`;
  const w = +S.profile.weight;
  const pc = (g, k) => r0((g * k) / t.kcal * 100);
  const water = Math.round((35 * w) / 50) * 50;
  return `<h2>Ingesta recomanada <span class="sub">${esc(t.goal.label)}</span></h2>
    <div class="result-big"><b class="num">${fmt(t.kcal)}</b><span class="muted">kcal / dia de mitjana</span></div>
    ${t.floored ? `<div class="banner warn" style="margin:12px 0 0">El dèficit et deixava per sota del metabolisme basal; s'ha limitat a ${fmt(t.bmr)} kcal.</div>` : ""}
    <div class="macro-tiles">
      <div><span><i class="c-prot"></i>Proteïna</span><b class="num">${r0(t.prot)} g</b><small>${fmt1(t.prot / w)} g/kg · ${pc(t.prot, 4)}%</small></div>
      <div><span><i class="c-carb"></i>Hidrats</span><b class="num">${r0(t.carbs)} g</b><small>${fmt1(t.carbs / w)} g/kg · ${pc(t.carbs, 4)}%</small></div>
      <div><span><i class="c-fat"></i>Greix</span><b class="num">${r0(t.fat)} g</b><small>${fmt1(t.fat / w)} g/kg · ${pc(t.fat, 9)}%</small></div>
    </div>
    <div class="kv"><span>Metabolisme basal (${t.bmrMethod})</span><b class="num">${fmt(t.bmr)} kcal</b></div>
    <div class="kv"><span>Despesa d'un entreno</span><b class="num">≈ ${fmt(t.sessionKcal)} kcal</b></div>
    <div class="kv"><span>Despesa total (manteniment)</span><b class="num">${fmt(t.tdee)} kcal</b></div>
    <div class="kv"><span>Aigua base</span><b class="num">${(water / 1000).toLocaleString("ca-ES")} L + 0,5 L/h d'entreno</b></div>
    <h3 class="view-title" style="margin:16px 0 6px">Segons l'avís del dia</h3>
    <div class="table-wrap"><table class="data num"><thead><tr><th>Avís</th><th>Ajust</th><th>Kcal</th><th>Hidrats</th></tr></thead><tbody>${
      Object.entries(t.dayTypes).map(([k, v]) => { const d = dayTarget(t, k, w); return `<tr><td>${esc(v.label)}</td><td>${v.pct >= 0 ? "+" : ""}${r0(v.pct * 100)}%</td><td>${fmt(d.kcal)}</td><td>${r0(d.c)} g</td></tr>`; }).join("")
    }</tbody></table></div>
    <p class="small faint" style="margin:10px 2px 0">Els ajustos dels dies d'entreno i descans estan equilibrats perquè la mitjana setmanal quedi a l'objectiu. Proteïna i greix es mantenen; el que canvia són els hidrats.</p>`;
}
function exportData() {
  IDB.keys().then(async keys => {
    const images = {};
    for (const k of keys) {
      const b = await IDB.get(k);
      if (b) images[k] = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    }
    const blob = new Blob([JSON.stringify({ app: "macros", v: 1, exported: new Date().toISOString(), data: S, images })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `macros-copia-${todayKey()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("Còpia exportada");
  });
}
async function importData(file) {
  try {
    const j = JSON.parse(await file.text());
    if (j.app !== "macros" || !j.data) throw new Error("format");
    if (!confirm("Importar la còpia? Substituirà totes les dades d'aquest dispositiu.")) return;
    S = { ...clone(DEFAULT), ...j.data, profile: { ...DEFAULT.profile, ...(j.data.profile || {}) } };
    for (const [k, url] of Object.entries(j.images || {})) await IDB.put(k, await (await fetch(url)).blob());
    save(); applyTheme(); render();
    toast("Dades importades");
  } catch (e) { toast("Aquest fitxer no és una còpia vàlida"); }
}

// ——————————————————— esdeveniments ———————————————————
document.addEventListener("click", e => {
  const tabBtn = e.target.closest("#tabbar button");
  if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
  if (e.target.id === "sheet") { closeSheet(); return; }
  const a = e.target.closest("[data-action]");
  if (!a) return;
  const act = a.dataset.action;
  if (a.tagName === "INPUT" || a.tagName === "SELECT") return;   // gestionats per 'change'
  const d = getDay(UI.date);
  switch (act) {
    case "goto": setTab(a.dataset.tab); break;
    case "day-prev": UI.date = addDays(UI.date, -1); render(); break;
    case "day-next": if (UI.date < todayKey()) { UI.date = addDays(UI.date, 1); render(); } break;
    case "day-today": UI.date = todayKey(); render(); break;
    case "water": {
      const day = ensureDay(UI.date);
      day.water = Math.max(0, (day.water || 0) + +a.dataset.ml);
      save(); render(); break;
    }
    case "water-custom": {
      const v = prompt("Quants ml? (negatiu per treure)", "330");
      const n = parseFloat(String(v).replace(",", "."));
      if (!isNaN(n)) { const day = ensureDay(UI.date); day.water = Math.max(0, (day.water || 0) + n); save(); render(); }
      break;
    }
    case "meal-del": {
      if (!confirm("Eliminar aquest menjar?")) break;
      const day = ensureDay(UI.date);
      day.meals = day.meals.filter(m => m.id !== a.dataset.id);
      save(); render(); toast("Menjar eliminat"); break;
    }
    case "meal-edit": {
      const m = d.meals.find(x => x.id === a.dataset.id);
      if (!m) break;
      UI.draft = { type: m.type, text: "", lines: mealToLines(m), editing: { date: UI.date, id: m.id, time: m.time } };
      saveDraft(); setTab("meal"); break;
    }
    case "meal-repeat": {
      const m = d.meals.find(x => x.id === a.dataset.id);
      if (!m) break;
      UI.draft = { type: defaultMealType(), text: "", lines: mealToLines(m), editing: null };
      UI.date = todayKey();
      saveDraft(); setTab("meal"); toast("Revisa les quantitats i desa"); break;
    }
    case "meal-parse": parseDraftText(); break;
    case "voice": toggleVoice(); break;
    case "voice-quick": setTab("meal"); startVoice(); break;
    case "line-add": {
      const l = { id: uid(), name: "", grams: "", foodId: null };
      UI.draft.lines.push(l); saveDraft();
      $("#lines").insertAdjacentHTML("beforeend", lineHTML(l));
      refreshLine(l.id); refreshTotals();
      $(`[data-line="${l.id}"] input`).focus();
      break;
    }
    case "line-rm": {
      const id = a.closest("[data-line]").dataset.line;
      UI.draft.lines = UI.draft.lines.filter(l => l.id !== id); saveDraft();
      a.closest("[data-line]").remove(); refreshTotals(); break;
    }
    case "line-pick": {
      const id = a.closest("[data-line]").dataset.line;
      const l = UI.draft.lines.find(x => x.id === id), f = foodById(a.dataset.food);
      if (!l || !f) break;
      l.foodId = f.id; l.name = f.name; saveDraft();
      $(`[data-line="${id}"] [data-lf="name"]`).value = f.name;
      refreshLine(id); refreshTotals(); break;
    }
    case "meal-save": saveMeal(); break;
    case "recent-add": {
      const m = (S.days[a.dataset.day] || { meals: [] }).meals.find(x => x.id === a.dataset.id);
      if (!m) break;
      UI.draft.lines = [...UI.draft.lines.filter(l => l.name.trim()), ...mealToLines(m)];
      if (!UI.draft.editing) UI.draft.type = m.type;
      saveDraft(); render(); toast("Afegit al menjar: revisa i desa"); break;
    }
    case "foods-seg": UI.foodsSeg = a.dataset.v; render(); break;
    case "food-new": openFoodEditor(null); break;
    case "food-edit": openFoodEditor(S.foods.find(f => f.id === a.dataset.id)); break;
    case "food-copy": openFoodEditor(foodById(a.dataset.id), { copy: true }); break;
    case "sheet-close": closeSheet(); break;
    case "ed-save": editorSave(); break;
    case "ed-del": editorDelete(); break;
    case "stats-range": UI.statsRange = +a.dataset.v; render(); break;
    case "set-p": S.profile[a.dataset.field] = a.dataset.v; save(); if (a.dataset.field === "theme") applyTheme(); render(); break;
    case "w-add": {
      const v = parseFloat(String($("#w-new").value).replace(",", "."));
      if (!(v > 20 && v < 400)) { toast("Escriu un pes vàlid"); break; }
      const k = todayKey();
      S.weights = S.weights.filter(w => w.d !== k); S.weights.push({ d: k, kg: v });
      S.profile.weight = v; save(); render(); toast("Pes registrat"); break;
    }
    case "w-del": S.weights = S.weights.filter(w => w.d !== a.dataset.d); save(); render(); break;
    case "install": if (installPrompt) { installPrompt.prompt(); installPrompt.userChoice.finally(() => { installPrompt = null; render(); }); } break;
    case "export": exportData(); break;
    case "wipe":
      if (confirm("Segur que vols esborrar TOTES les dades (perfil, aliments, menjars)? No es pot desfer.")) {
        S = clone(DEFAULT); save(); resetDraft();
        IDB.keys().then(ks => ks.forEach(k => IDB.del(k)));
        applyTheme(); render(); toast("Dades esborrades");
      }
      break;
  }
});

document.addEventListener("input", e => {
  const el = e.target;
  if (el.dataset.p) {
    S.profile[el.dataset.p] = el.value; save();
    const box = $("#profile-result"); if (box) box.innerHTML = profileResult();
    return;
  }
  if (el.dataset.draft) { UI.draft[el.dataset.draft] = el.value; saveDraft(); return; }
  if (el.dataset.lf) {
    const id = el.closest("[data-line]").dataset.line;
    const l = UI.draft.lines.find(x => x.id === id);
    if (!l) return;
    if (el.dataset.lf === "name") {
      l.name = el.value;
      const exact = allFoods().find(f => f.name.toLowerCase() === el.value.trim().toLowerCase());
      l.foodId = exact ? exact.id : null;
    } else l.grams = el.value;
    saveDraft(); refreshLine(id); refreshTotals();
    return;
  }
  if (el.id === "foods-q") {
    UI.foodsQ = el.value;
    const pos = el.selectionStart;
    render();
    const q = $("#foods-q"); q.focus(); try { q.setSelectionRange(pos, pos); } catch (_) {}
  }
});

document.addEventListener("change", e => {
  const el = e.target;
  const act = el.dataset.action;
  if (act === "day-type") { ensureDay(UI.date).type = el.value; save(); render(); }
  else if (act === "ed-file") { handleEditorFile(el.files[0]); el.value = ""; }
  else if (act === "import") { if (el.files[0]) importData(el.files[0]); el.value = ""; }
});

// Tooltips dels gràfics (ratolí i tacte)
function showTip(target) {
  const chart = target.closest(".chart"), tip = $(".tip", chart);
  const cr = chart.getBoundingClientRect(), r = target.getBoundingClientRect();
  tip.textContent = target.dataset.tip;
  tip.hidden = false;
  const x = clamp(r.left + r.width / 2 - cr.left, 60, cr.width - 60);
  tip.style.left = x + "px";
  tip.style.top = Math.max(16, r.top - cr.top + (target.tagName === "circle" ? 6 : 24)) + "px";
}
document.addEventListener("pointerover", e => { const t = e.target.closest(".chart [data-tip]"); if (t) showTip(t); });
document.addEventListener("pointerdown", e => {
  const t = e.target.closest(".chart [data-tip]");
  $$(".chart .tip").forEach(x => { if (!t || !x.parentNode.contains(t)) x.hidden = true; });
  if (t) showTip(t);
});
document.addEventListener("pointerout", e => { const c = e.target.closest(".chart"); if (c && e.pointerType === "mouse" && !c.contains(e.relatedTarget)) $(".tip", c).hidden = true; });

document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });

// Si l'app queda oberta i canvia el dia, torna a avui
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && UI.tab === "today" && UI._lastToday && UI._lastToday !== todayKey() && UI.date === UI._lastToday) { UI.date = todayKey(); render(); }
  UI._lastToday = todayKey();
});
UI._lastToday = todayKey();

applyTheme();
render();
