"use strict";
/* Gimnàs: plantilles, sessions amb registre de pesos, historial, exercicis, progrés i calculadora RM/RIR.
   Es carrega abans d'app.js i fa servir les seves utilitats ($, esc, S, save, toast…) en temps d'execució. */

// ——————————————————— base d'exercicis ———————————————————
const MUSCLE_LABEL = Object.fromEntries(GYM_MUSCLES);
const EQUIP_LABEL = Object.fromEntries(GYM_EQUIP);
const GYM_DB = GYM_DB_RAW.map(r => ({
  id: r[0], en: r[1], ca: r[2], alias: r[3],
  pm: r[4].map(i => GYM_MUSCLES[i][0]), sm: r[5].map(i => GYM_MUSCLES[i][0]),
  eq: GYM_EQUIP[r[6]][0], cat: r[7], imgs: r[8], kind: r[7] === "cardio" ? "t" : "wr",
}));
for (const x of GYM_EXTRA) GYM_DB.unshift({ ...x, imgs: 0, kind: x.cat === "cardio" ? "t" : "wr" });
const GYM_DB_MAP = new Map(GYM_DB.map(e => [e.id, e]));

const G = () => S.gym;
function exById(id) {
  return G().custom.find(c => c.id === id) || GYM_DB_MAP.get(id) || { id, en: id, ca: "Exercici desconegut", alias: "", pm: [], sm: [], eq: "other", cat: "strength", imgs: 0, kind: "wr" };
}
const exName = id => { const e = exById(id); return G().alias[id] || (LANG() === "es" && ES_EX[id]) || e.name || e.ca || e.en; };
const exImgId = e => e.imgOf || (e.imgs ? e.id : null);
const exImg = (e, n = 0) => { const i = exImgId(e); return i ? `${GYM_IMG_BASE}${i}/${n}.jpg` : null; };
const exSearchText = e => norm([G().alias[e.id], e.name, e.ca, ES_EX[e.id], e.en, e.alias, ...e.pm.map(m => MUSCLE_LABEL[m]), ...e.pm.map(m => tr(MUSCLE_LABEL[m]))].filter(Boolean).join(" "));
function searchExercises(q, muscle) {
  const list = [...G().custom.map(c => ({ ...c, custom: true })), ...GYM_DB];
  const nq = norm(q).trim(), toks = nq.split(" ").filter(Boolean);
  let res = muscle ? list.filter(e => e.pm.includes(muscle)) : list;
  if (toks.length) {
    res = res.map(e => {
      const h = exSearchText(e), nm = norm(exName(e.id));
      if (!toks.every(t => h.includes(t))) return null;
      let sc = 0;
      if (nm.startsWith(nq)) sc += 10; else if (nm.includes(nq)) sc += 5;
      if (e.custom || G().alias[e.id]) sc += 4;
      if (e.ca) sc += 3;
      return { e, sc };
    }).filter(Boolean).sort((a, b) => b.sc - a.sc || exName(a.e.id).localeCompare(exName(b.e.id), "ca")).map(x => x.e);
  } else {
    // Sense cerca: primer els que ja has fet, després els comuns (amb nom en català)
    const used = usedExerciseIds();
    res.sort((a, b) => (used.has(b.id) - used.has(a.id)) || (!!(b.custom) - !!(a.custom)) || (!!b.ca - !!a.ca) || exName(a.id).localeCompare(exName(b.id), "ca"));
  }
  return res;
}
function usedExerciseIds() {
  const s = new Set();
  for (const ss of G().sessions) for (const it of ss.items) s.add(it.ex);
  for (const t of G().templates) for (const it of t.items) s.add(it.ex);
  return s;
}

// ——————————————————— càlculs RM / RIR ———————————————————
// % de l'1RM per a N repeticions fins al fallo: Brzycki fins a 10, Epley a partir de 10 (continu a 10 rep = 75%)
const pctRM = r => r <= 1 ? 1 : r <= 10 ? (37 - r) / 36 : 1 / (1 + r / 30);
const e1RM = (w, reps, rir = 0) => (w > 0 && reps > 0) ? w / pctRM(reps + (rir || 0)) : 0;
function repsToFailure(rm, x) {           // repeticions (contínues) fins al fallo amb x kg
  if (!(rm > 0 && x > 0)) return 0;
  const q = x / rm;
  if (q >= 1) return q === 1 ? 1 : 0;
  return q >= 0.75 ? 37 - 36 * q : 30 * (1 / q - 1);
}
const weightFor = (rm, reps, rir = 0) => rm * pctRM(reps + rir);
const roundW = (w, step = 0.5) => Math.round(w / step) * step;

// ——————————————————— model: sèries ———————————————————
const REST_OPTS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 210, 240, 300];
const fmtRest = s => !s ? "Sense" : `${Math.floor(s / 60)}:${pad(s % 60)}`;
const fmtDur = ms => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)} min` : `${m} min`; };
const fmtClock = ms => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600); return h ? `${h}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`; };
const numIn = v => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isNaN(n) ? null : n; };
const tagLabel = s => s.t === "W" ? "W" : s.t === "F" ? "F" : s.t === "D" ? "D" : (s.rir != null && s.rir !== "" ? `R${s.rir}` : "N");
const tagTitle = s => s.t === "W" ? "Escalfament" : s.t === "F" ? "Fallo" : s.t === "D" ? "Drop set" : (s.rir != null && s.rir !== "" ? `RIR ${s.rir}` : "Normal");
const isWork = s => s.t !== "W";
// RIR real d'una sèrie feta (si no l'has escrit: objectiu de la sèrie; 0 si és F o D)
const setRIR = s => { const v = numIn(s.rir); if (v != null) return v; if (s.t === "F" || s.t === "D") return 0; const g = numIn(s.grir); return g != null ? g : 0; };
const setE1 = s => isWork(s) ? e1RM(numIn(s.w) || 0, numIn(s.reps) || 0, setRIR(s)) : 0;
const parseTime = v => { const m = String(v || "").trim().match(/^(\d+)(?::(\d{1,2}))?$/); return m ? (+m[1]) * 60 + (+(m[2] || 0)) : null; };

// Etiquetes de superset: 1, 2a, 2b, 3…
function blockLabels(items) {
  const out = []; let n = 0, i = 0;
  while (i < items.length) {
    let j = i + 1; while (j < items.length && items[j].ss) j++;
    n++;
    for (let k = i; k < j; k++) out.push(j - i > 1 ? `${n}${"abcdefgh"[k - i]}` : `${n}`);
    i = j;
  }
  return out;
}
const targetSummary = sets => {
  const work = sets.filter(isWork), reps = [...new Set(work.map(s => s.goal || s.reps).filter(Boolean))];
  return sets.map(tagLabel).join(" · ") + (reps.length ? ` · ${reps.join(" / ")} rep` : "");
};

// Historial d'un exercici: [{s: sessió, it: ítem}] de més recent a més antic
function exHistory(exId, excludeId, beforeTs) {
  const out = [];
  for (const s of G().sessions) {
    if (s.id === excludeId || (beforeTs && s.start >= beforeTs)) continue;
    for (const it of s.items) if (it.ex === exId && it.sets.some(x => x.done)) out.push({ s, it });
  }
  return out.sort((a, b) => (b.s.start || 0) - (a.s.start || 0));
}
// ——— rècords (PR): pes màxim, 1RM estimada i volum de l'exercici en una sessió ———
const itemVolume = it => it.sets.filter(x => x.done && isWork(x)).reduce((t, x) => t + (numIn(x.w) || 0) * (numIn(x.reps) || 0), 0);
function prBaseline(exId, s) {
  const h = exHistory(exId, s.id, s.start);
  if (!h.length) return null;                        // la primera vegada no compta com a rècord
  let e1 = 0, w = 0, vol = 0;
  for (const { it } of h) {
    for (const x of it.sets) if (x.done && isWork(x)) { e1 = Math.max(e1, setE1(x)); w = Math.max(w, numIn(x.w) || 0); }
    vol = Math.max(vol, itemVolume(it));
  }
  return { e1, w, vol };
}
function setPRs(x, base) {
  if (!base || !x.done || !isWork(x)) return [];
  const out = [], w = numIn(x.w) || 0, e = setE1(x);
  if (w > 0 && w > base.w + 1e-9) out.push("w");
  if (e > 0 && e > base.e1 + 0.05) out.push("e1");
  return out;
}
const PR_LABEL = { w: "Pes màxim", e1: "1RM estimada", vol: "Volum" };
function sessionPRs(s) {
  const out = [];
  for (const it of s.items) {
    const base = prBaseline(it.ex, s); if (!base) continue;
    const ws = it.sets.filter(x => x.done && isWork(x));
    const w = Math.max(0, ...ws.map(x => numIn(x.w) || 0)), e = Math.max(0, ...ws.map(setE1)), v = itemVolume(it);
    if (w > 0 && w > base.w + 1e-9) out.push({ ex: it.ex, t: "w", v: w, prev: base.w });
    if (e > 0 && e > base.e1 + 0.05) out.push({ ex: it.ex, t: "e1", v: e, prev: base.e1 });
    if (v > 0 && base.vol > 0 && v > base.vol) out.push({ ex: it.ex, t: "vol", v, prev: base.vol });
  }
  return out;
}
function announcePR(s, i, j) {
  const it = s.items[i], x = it.sets[j], base = prBaseline(it.ex, s);
  if (!base || !x.done || !isWork(x)) return;
  const others = it.sets.filter((y, k) => k !== j && y.done && isWork(y));
  const oW = Math.max(base.w, ...others.map(y => numIn(y.w) || 0)), oE = Math.max(base.e1, ...others.map(setE1));
  const msgs = [];
  const w = numIn(x.w) || 0, e = setE1(x);
  if (w > oW + 1e-9) msgs.push(`${PR_LABEL.w}: ${fmt1(w)} kg (abans ${fmt1(base.w)})`);
  if (e > oE + 0.05) msgs.push(`${PR_LABEL.e1}: ${fmt1(e)} kg (abans ${fmt1(base.e1)})`);
  const vNow = itemVolume(it), vBefore = vNow - w * (numIn(x.reps) || 0);
  if (base.vol > 0 && vNow > base.vol && vBefore <= base.vol) msgs.push(`${PR_LABEL.vol}: ${fmt(vNow)} kg (abans ${fmt(base.vol)})`);
  if (msgs.length) {
    toast("🏆 Rècord! " + msgs.join(" · "));
    try { navigator.vibrate && navigator.vibrate([60, 40, 60, 40, 160]); } catch (e) {}
  }
}

// Valors de la vegada anterior per a cada fila (W amb W, sèries efectives amb efectives)
function prevPlaceholders(item, sessionId) {
  const h = exHistory(item.ex, sessionId)[0];
  if (!h) return { date: null, rows: [] };
  const pw = h.it.sets.filter(x => x.done && x.t === "W"), pk = h.it.sets.filter(x => x.done && x.t !== "W");
  let cw = 0, ck = 0;
  const rows = item.sets.map(s => s.t === "W" ? pw[cw++] || null : pk[ck++] || null);
  return { date: h.s.date, rows, all: h.it.sets.filter(x => x.done) };
}
const setText = (s, kind) => kind === "t" ? (s.time || "—") : `${numIn(s.w) ? fmt1(numIn(s.w)) : "0"}×${s.reps || "—"}`;

// ——————————————————— estat de la interfície ———————————————————
const GU = {
  view: "train",            // train | hist | ex | prog | calc
  tpl: null,                // esborrany de plantilla en edició
  edit: null,               // còpia d'una sessió passada en edició
  exQ: "", exMuscle: "", exLimit: 60,
  pick: null,               // { mode, idx }
  pickQ: "", pickMuscle: "",
  progEx: null, progMetric: "e1rm", progQ: "",
  calc: { w: "", reps: "", rir: "0", x: "", trir: "0" },
};
const curSession = () => GU.edit || G().active;
function touchActive() { const a = G().active; if (a && !GU.edit) a.upd = Date.now(); }
let gymSaveT = null;
function gymSave(now) {
  touchActive();
  clearTimeout(gymSaveT);
  if (GU.edit) return;                       // l'edició d'una sessió passada es desa en prémer «Desa»
  if (now) save(); else gymSaveT = setTimeout(save, 500);
}

// ——————————————————— full inferior genèric ———————————————————
function openSheet(title, body, { wide = false } = {}) {
  const sh = $("#sheet");
  sh.innerHTML = `<div class="sheet${wide ? " wide" : ""}" role="dialog" aria-modal="true"><div class="grab"></div>
    <div class="sheet-head"><h3>${title}</h3><button class="icon-btn" data-action="sheet-close" aria-label="Tanca">${ICON.close}</button></div>${body}</div>`;
  sh.hidden = false;
  document.body.style.overflow = "hidden";
}
const sheetOpen = () => !$("#sheet").hidden;

// ——————————————————— VISTA PRINCIPAL ———————————————————
const GYM_VIEWS = [["train", "Entrenar"], ["hist", "Historial"], ["ex", "Exercicis"], ["prog", "Progrés"], ["calc", "RM·RIR"]];
function gymHeader() {
  const a = G().active;
  const chip = a ? `<button class="chip live" data-g="goto-session"><i></i><span id="gym-elapsed" class="num">${fmtClock(Date.now() - a.start)}</span></button>` : "";
  return `<div class="top-inner"><h1>Gimnàs</h1>${chip}</div>`;
}
function viewGym() {
  let html = `<div class="seg gym-seg" style="margin:6px 0 12px">${GYM_VIEWS.map(([k, l]) => `<button class="${GU.view === k ? "on" : ""}" data-g="view" data-v="${k}">${l}</button>`).join("")}</div>`;
  if (GU.view === "train") html += GU.tpl ? viewTplEdit() : curSession() ? viewSession() : viewTrainHome();
  else if (GU.view === "hist") html += viewHistory();
  else if (GU.view === "ex") html += viewExercises();
  else if (GU.view === "prog") html += GU.progEx ? viewProgEx() : viewProgHome();
  else if (GU.view === "calc") html += viewCalc();
  return html;
}
function afterGymRender() {
  if (GU.view === "calc") calcRefresh();
  updateTimerBar();
}

// ——————————————————— ENTRENAR: plantilles ———————————————————
function viewTrainHome() {
  const T = G().templates;
  let html = `<section class="card"><h2>Comença</h2>
    <button class="btn primary block" data-g="start-empty">${ICON.plus}Sessió buida</button></section>`;
  html += `<section class="card"><h2>Plantilles <span class="sub"><button class="btn sm" data-g="tpl-new">${ICON.plus}Nova</button></span></h2>`;
  if (!T.length) {
    html += `<div class="empty">Encara no tens plantilles. Crea'n una amb els exercicis, sèries, repeticions i RIR, i després només hauràs de prémer «Comença».</div>`;
    if (!G().sessions.length) html += `<button class="btn block" data-g="seed">Carrega la meva rutina (dilluns a dissabte)</button>`;
  }
  for (const t of T) {
    const last = G().sessions.filter(s => s.tpl === t.id).sort((a, b) => b.start - a.start)[0];
    const nSets = t.items.reduce((n, it) => n + it.sets.filter(isWork).length, 0);
    html += `<div class="tpl">
      <div class="grow" data-g="tpl-edit" data-id="${t.id}" role="button">
        <div class="tname" data-nt>${esc(t.name || tr("Sense nom"))}</div>
        <div class="tsub">${t.items.length} exercicis · ${nSets} sèries efectives${last ? ` · últim ${esc(fmtShort(last.date))}` : ""}</div>
        <div class="tex" data-nt>${esc(t.items.map(i => exName(i.ex)).join(" · "))}</div>
      </div>
      <button class="btn primary sm" data-g="start-tpl" data-id="${t.id}">Comença</button>
    </div>`;
  }
  html += `</section>`;
  const recent = [...G().sessions].sort((a, b) => b.start - a.start).slice(0, 3);
  if (recent.length) html += `<h3 class="view-title">Últimes sessions</h3><section class="card">${recent.map(sessionRow).join("")}</section>`;
  return html;
}

// ——————————————————— ENTRENAR: editor de plantilla ———————————————————
function newTplSet(prev) { return prev ? { ...prev } : { t: "N", rir: "1", reps: "8-12" }; }
function viewTplEdit() {
  const t = GU.tpl, labels = blockLabels(t.items);
  let html = `<section class="card">
    <label class="field"><span>Nom de la plantilla</span><input class="input" data-gt="name" value="${esc(t.name)}" placeholder="Ex: Cames pesat (dijous)"></label>
    <label class="field" style="margin:0"><span>Nota (opcional)</span><input class="input" data-gt="note" value="${esc(t.note || "")}" placeholder="Escalfament, observacions…"></label>
  </section>`;
  t.items.forEach((it, i) => {
    html += `<section class="card ex-card" data-ti="${i}">
      <div class="ex-head">
        <span class="blk">${labels[i]}</span>
        <button class="ex-name" data-nt data-g="ex-info" data-id="${esc(it.ex)}">${esc(exName(it.ex))}</button>
        <button class="icon-btn sm" data-g="ti-menu" data-i="${i}" aria-label="Opcions">${ICON.dots}</button>
      </div>
      <div class="tset-head"><span>Tipus</span><span>RIR</span><span>Repes</span><span></span></div>
      ${it.sets.map((s, j) => `<div class="tset" data-tj="${j}">
        <select class="input" data-gts="t">${[["W", "Escalf."], ["N", "RIR"], ["F", "Fallo"], ["D", "Drop"]].map(([k, l]) => `<option value="${k}" ${s.t === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <input class="input num" inputmode="numeric" data-gts="rir" value="${esc(s.t === "N" ? s.rir ?? "" : "")}" ${s.t === "N" ? "" : "disabled"} placeholder="${s.t === "N" ? "–" : ""}">
        <input class="input num" data-gts="reps" value="${esc(s.reps || "")}" placeholder="${exById(it.ex).kind === "t" ? "mm:ss" : "8-12"}">
        <button class="rm" data-g="ts-rm" aria-label="Treu la sèrie">×</button>
      </div>`).join("")}
      <div class="row" style="margin-top:8px;flex-wrap:wrap">
        <button class="btn sm" data-g="ts-add">${ICON.plus}Sèrie</button>
        <label class="rest-sel"><span>Descans</span><select class="input" data-gti="rest">${REST_OPTS.map(r => `<option value="${r}" ${+it.rest === r ? "selected" : ""}>${fmtRest(r)}</option>`).join("")}</select></label>
        ${i > 0 ? `<label class="ss-tog"><input type="checkbox" data-gti="ss" ${it.ss ? "checked" : ""}> Superset amb l'anterior</label>` : ""}
      </div>
      <input class="input" style="margin-top:8px" data-gti="note" value="${esc(it.note || "")}" placeholder="Nota (opcional)">
    </section>`;
  });
  html += `<button class="btn block" data-g="pick" data-mode="tpl" style="margin-bottom:12px">${ICON.plus}Afegeix exercici</button>
    <div class="grid2"><button class="btn" data-g="tpl-cancel">Cancel·la</button><button class="btn primary" data-g="tpl-save">Desa la plantilla</button></div>
    ${G().templates.some(x => x.id === t.id) ? `<div class="grid2" style="margin-top:8px"><button class="btn" data-g="tpl-dup">Duplica</button><button class="btn danger" data-g="tpl-del">Elimina</button></div>` : ""}`;
  return html;
}
function itemFromEx(exId, kindSets) {
  const e = exById(exId);
  return { id: uid(), ex: exId, ss: false, rest: e.kind === "t" ? 0 : (G().rest || 120), note: "",
    sets: kindSets || (e.kind === "t" ? [{ t: "N", rir: "", reps: "" }] : [newTplSet(), newTplSet(), newTplSet()]) };
}

// ——————————————————— ENTRENAR: sessió en curs ———————————————————
function sessionFromTemplate(t) {
  return {
    id: uid(), tpl: t ? t.id : null, name: t ? t.name : "Sessió lliure", date: todayKey(), start: Date.now(), end: null, note: t ? t.note || "" : "",
    items: t ? t.items.map(it => ({ id: uid(), ex: it.ex, ss: !!it.ss, rest: +it.rest || 0, note: it.note || "",
      sets: it.sets.map(s => ({ t: s.t, grir: s.t === "N" ? s.rir : "", goal: s.reps || "", w: "", reps: "", rir: "", time: "", done: false })) })) : [],
  };
}
function viewSession() {
  const s = curSession(), editing = !!GU.edit, labels = blockLabels(s.items);
  let html = `<section class="card sess-head">
    <input class="input title-in" data-gs-top="name" value="${esc(s.name)}">
    <div class="small muted" style="margin-top:6px">${esc(fmtLong(s.date))}${editing ? ` · ${fmtDur((s.end || s.start) - s.start)}` : ` · inici ${new Date(s.start).toLocaleTimeString(LOC(), { hour: "2-digit", minute: "2-digit" })}`}</div>
  </section>`;
  s.items.forEach((it, i) => {
    const e = exById(it.ex), kind = e.kind, prev = prevPlaceholders(it, s.id), base = prBaseline(it.ex, s);
    const volPR = base && base.vol > 0 && itemVolume(it) > base.vol;
    const best = prev.all ? prev.all.filter(isWork).reduce((m, x) => Math.max(m, setE1(x)), 0) : 0;
    html += `<section class="card ex-card${it.ss ? " ss" : ""}" data-si="${i}">
      <div class="ex-head">
        <span class="blk">${labels[i]}</span>
        <button class="ex-name" data-nt data-g="ex-info" data-id="${esc(it.ex)}">${esc(exName(it.ex))}</button>
        <button class="icon-btn sm" data-g="si-menu" data-i="${i}" aria-label="Opcions">${ICON.dots}</button>
      </div>
      <div class="ex-meta">${it.sets.some(x => x.goal || x.grir) ? `<span>Objectiu: ${esc(targetSummary(it.sets.map(x => ({ t: x.t, rir: x.grir, reps: x.goal }))))}</span>` : ""}${it.rest ? `<span>Descans ${fmtRest(it.rest)}</span>` : ""}</div>
      ${prev.date ? `<div class="ex-prev">Anterior (${esc(fmtShort(prev.date))}): ${esc(prev.all.map(x => setText(x, kind)).join(" · "))}${best ? ` · RM ≈ ${fmt1(best)} kg` : ""}</div>` : ""}
      ${it.note ? `<div class="ex-note" data-nt>${esc(it.note)}</div>` : ""}
      <div class="sset-head ${kind === "t" ? "time" : ""}"><span>Sèrie</span>${kind === "t" ? "<span>Temps</span>" : "<span>kg</span><span>Repes</span><span>RIR</span>"}<span></span></div>
      ${it.sets.map((x, j) => setRowHTML(x, j, kind, prev.rows[j], base)).join("")}
      <div class="vol-pr" ${volPR ? "" : "hidden"}>🏆 Rècord de volum en aquest exercici</div>
      <div class="row" style="margin-top:8px"><button class="btn sm" data-g="ss-add">${ICON.plus}Sèrie</button>
        ${it.sets.length > 1 ? `<button class="btn sm ghost" data-g="ss-rm-last">Treu l'última</button>` : ""}</div>
    </section>`;
  });
  html += `<button class="btn block" data-g="pick" data-mode="session" style="margin-bottom:12px">${ICON.plus}Afegeix exercici</button>
    <label class="field"><span>Notes de la sessió</span><textarea class="input" data-gs-top="note" placeholder="Com t'has trobat, molèsties…">${esc(s.note || "")}</textarea></label>`;
  html += editing
    ? `<div class="grid2"><button class="btn" data-g="edit-cancel">Cancel·la</button><button class="btn primary" data-g="edit-save">Desa els canvis</button></div>`
    : `<div class="grid2"><button class="btn danger" data-g="sess-discard">Descarta</button><button class="btn primary" data-g="sess-finish">Finalitza</button></div>`;
  return html;
}
function setRowHTML(x, j, kind, pv, base) {
  const prs = setPRs(x, base);
  const ph = (f, d = "") => pv && pv[f] !== "" && pv[f] != null ? esc(pv[f]) : d;
  const rirPh = x.t === "N" ? (x.grir !== "" && x.grir != null ? esc(x.grir) : "") : x.t === "W" ? "" : "0";
  return `<div class="sset ${x.done ? "done" : ""} ${kind === "t" ? "time" : ""} ${prs.length ? "pr" : ""}" data-sj="${j}" ${prs.length ? `title="Rècord: ${prs.map(p => PR_LABEL[p]).join(", ")}"` : ""}>
    <button class="tag t-${x.t}" data-g="tag-cycle" title="${esc(tagTitle(x))}">${j + 1}<small>${esc(tagLabel({ t: x.t, rir: x.grir }))}</small></button>
    ${kind === "t" ? `<input class="input num" inputmode="text" data-gs="time" value="${esc(x.time)}" placeholder="${ph("time", esc(x.goal || "mm:ss"))}">`
      : `<input class="input num" inputmode="decimal" data-gs="w" value="${esc(x.w)}" placeholder="${ph("w", "kg")}">
    <input class="input num" inputmode="numeric" data-gs="reps" value="${esc(x.reps)}" placeholder="${ph("reps", esc(x.goal || "—"))}">
    <input class="input num" inputmode="numeric" data-gs="rir" value="${esc(x.rir)}" placeholder="${rirPh}" ${x.t === "W" ? "disabled" : ""}>`}
    <button class="chk" data-g="set-done" aria-label="Sèrie feta">${ICON.calc}${prs.length ? `<i class="prb">PR</i>` : ""}</button>
  </div>`;
}
function refreshSetRow(i, j) {
  const s = curSession(), it = s.items[i], row = $(`[data-si="${i}"] [data-sj="${j}"]`);
  if (!row) return;
  const prev = prevPlaceholders(it, s.id);
  row.outerHTML = setRowHTML(it.sets[j], j, exById(it.ex).kind, prev.rows[j], prBaseline(it.ex, s));
  const vb = $(`[data-si="${i}"] .vol-pr`), base = prBaseline(it.ex, s);
  const volPR = base && base.vol > 0 && itemVolume(it) > base.vol;
  if (vb) vb.hidden = !volPR;
}

// ——————————————————— temporitzador de descans ———————————————————
let audioCtx = null;
function beep() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    [0, 0.25, 0.5].forEach(d => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = d === 0.5 ? 1175 : 880; o.connect(g); g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.18);
      o.start(t0 + d); o.stop(t0 + d + 0.2);
    });
  } catch (e) {}
}
function startRest(sec, label) {
  const a = G().active;
  if (!a || !sec) return;
  try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (e) {}
  a.timer = { end: Date.now() + sec * 1000, total: sec, label };
  gymSave();
  updateTimerBar();
}
function timerBarEl() {
  let el = $("#gym-timer");
  if (!el) { el = document.createElement("div"); el.id = "gym-timer"; el.className = "rest-bar"; el.hidden = true; document.body.appendChild(el); }
  return el;
}
function updateTimerBar() {
  const a = G().active, el = timerBarEl();
  const t = a && a.timer;
  if (!t) { el.hidden = true; return; }
  const left = t.end - Date.now();
  if (left <= -4000) { a.timer = null; el.hidden = true; gymSave(); return; }
  el.hidden = false;
  const done = left <= 0;
  el.classList.toggle("over", done);
  el.innerHTML = `<div class="rb-fill" style="width:${clamp(1 - left / (t.total * 1000), 0, 1) * 100}%"></div>
    <div class="rb-in"><div class="grow"><small>${done ? "Descans acabat" : "Descans"}${t.label ? ` · ${esc(t.label)}` : ""}</small><b class="num">${done ? "0:00" : fmtClock(left)}</b></div>
    <button class="btn sm" data-g="rest-add" data-v="-15">−15</button><button class="btn sm" data-g="rest-add" data-v="15">+15</button>
    <button class="btn sm primary" data-g="rest-skip">${done ? "D'acord" : "Salta"}</button></div>`;
  if (done && !t.fired) {
    t.fired = true; gymSave();
    beep();
    try { navigator.vibrate && navigator.vibrate([250, 120, 250, 120, 400]); } catch (e) {}
  }
}
function gymReady() { try { return !!(S && S.gym); } catch (e) { return false; } }
setInterval(() => {
  if (!gymReady()) return;
  if (G().active && G().active.timer) updateTimerBar();
  const el = $("#gym-elapsed"); if (el && G().active) el.textContent = fmtClock(Date.now() - G().active.start);
}, 250);

// Pantalla sempre encesa durant la sessió
let wakeLock = null;
async function syncWakeLock() {
  const want = !!(G().active && document.visibilityState === "visible");
  try {
    if (want && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); }
    else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}
document.addEventListener("visibilitychange", () => { if (gymReady()) { syncWakeLock(); updateTimerBar(); } });

// ——————————————————— fi de sessió ———————————————————
function cleanSession(s) {
  for (const it of s.items) {
    it.sets = it.sets.filter(x => x.done || x.w !== "" || x.reps !== "" || x.time !== "");
    for (const x of it.sets) x.done = true;
  }
  s.items = s.items.filter(it => it.sets.length);
  return s;
}
function finishSession() {
  const a = G().active;
  const pending = a.items.reduce((n, it) => n + it.sets.filter(x => !x.done && x.w === "" && x.reps === "" && x.time === "").length, 0);
  if (!confirm(pending ? `Finalitzar la sessió? Hi ha ${pending} sèries buides que no es desaran.` : "Finalitzar la sessió?")) return;
  const s = cleanSession(a);
  const prs = s.prs = sessionPRs(s);
  s.end = Date.now(); delete s.timer; delete s.upd;
  if (!s.items.length) { G().active = null; save(); syncWakeLock(); render(); toast("Sessió buida: no s'ha desat"); return; }
  const sameDay = G().sessions.filter(x => x.date === s.date).length;
  G().sessions.push(s);
  G().active = null;
  // Avís del dia per a les macros
  const day = ensureDay(s.date), before = day.type || "normal";
  if (sameDay && before === "train") day.type = "double";
  else if (["normal", "rest", "easy", "active"].includes(before)) day.type = "train";
  save(); syncWakeLock(); updateTimerBar();
  render();
  showSessionSummary(s, prs, day.type !== before ? day.type : null);
}
function sessionStats(s) {
  let sets = 0, vol = 0;
  for (const it of s.items) for (const x of it.sets) if (x.done && isWork(x)) { sets++; vol += (numIn(x.w) || 0) * (numIn(x.reps) || 0); }
  return { sets, vol, dur: (s.end || Date.now()) - s.start };
}
function prList(prs) {
  return prs.map(p => `<div class="kv"><span><span data-nt>${esc(exName(p.ex))}</span> · ${PR_LABEL[p.t]}</span><b class="num">${p.t === "vol" ? fmt(p.v) : fmt1(p.v)} kg <small class="faint">(abans ${p.t === "vol" ? fmt(p.prev) : fmt1(p.prev)})</small></b></div>`).join("");
}
function showSessionSummary(s, prs, newType) {
  const st = sessionStats(s);
  openSheet("Sessió desada", `
    <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><span>Durada</span><b class="num">${fmtDur(st.dur)}</b></div>
      <div class="kpi"><span>Sèries</span><b class="num">${st.sets}</b></div>
      <div class="kpi"><span>Volum</span><b class="num">${fmt(st.vol)}</b><small>kg</small></div>
    </div>
    ${prs.length ? `<section class="card"><h2>🏆 Rècords nous <span class="sub">${prs.length}</span></h2>${prList(prs)}</section>` : ""}
    ${newType ? `<p class="small muted">He posat l'avís del dia a <b>${newType === "double" ? "Entreno doble" : "Entreno"}</b> perquè l'objectiu de macros d'avui ho tingui en compte.</p>` : ""}
    <button class="btn primary block" data-action="sheet-close">D'acord</button>`);
}

// ——————————————————— HISTORIAL ———————————————————
function sessionRow(s) {
  const st = sessionStats(s);
  return `<div class="hrow" data-g="sess-open" data-id="${s.id}" role="button">
    <div class="hdate"><b class="num">${parseKey(s.date).getDate()}</b><small>${esc(new Intl.DateTimeFormat(LOC(), { month: "short" }).format(parseKey(s.date)).replace(".", ""))}</small></div>
    <div class="grow"><div class="tname" data-nt>${esc(s.name)}</div><div class="tsub">${fmtDur(st.dur)} · ${st.sets} sèries · ${fmt(st.vol)} kg</div>
    <div class="tex" data-nt>${esc(s.items.map(i => exName(i.ex)).join(" · "))}</div></div></div>`;
}
function viewHistory() {
  const L = [...G().sessions].sort((a, b) => b.start - a.start);
  if (!L.length) return `<section class="card"><div class="empty">Quan finalitzis una sessió, apareixerà aquí.</div></section>`;
  let html = "", month = "";
  for (const s of L) {
    const m = s.date.slice(0, 7);
    if (m !== month) {
      if (month) html += `</section>`;
      month = m;
      const n = L.filter(x => x.date.startsWith(m)).length;
      html += `<h3 class="view-title">${esc(cap(new Intl.DateTimeFormat(LOC(), { month: "long", year: "numeric" }).format(parseKey(m + "-01"))))} <span class="faint">· ${n} sessions</span></h3><section class="card">`;
    }
    html += sessionRow(s);
  }
  return html + `</section>`;
}
function openSessionDetail(id) {
  const s = G().sessions.find(x => x.id === id);
  if (!s) return;
  const st = sessionStats(s), labels = blockLabels(s.items);
  openSheet(`<span data-nt>${esc(s.name)}</span>`, `
    <p class="small muted" style="margin:-6px 0 12px">${esc(fmtLong(s.date))} · ${fmtDur(st.dur)} · ${st.sets} sèries · ${fmt(st.vol)} kg</p>
    ${s.items.map((it, i) => { const k = exById(it.ex).kind; const b = Math.max(0, ...it.sets.map(setE1)); return `<div class="hex">
      <div class="row"><span class="blk">${labels[i]}</span><button class="ex-name" data-nt data-g="ex-info" data-id="${esc(it.ex)}">${esc(exName(it.ex))}</button>${b ? `<span class="faint small num" style="margin-left:auto">RM ≈ ${fmt1(b)}</span>` : ""}</div>
      <div class="hsets">${it.sets.map(x => `<span class="t-${x.t}"><i>${esc(x.t === "N" ? (numIn(x.rir) != null ? "R" + x.rir : "") : x.t)}</i>${esc(setText(x, k))}</span>`).join("")}</div></div>`; }).join("")}
    ${(s.prs || []).length ? `<section class="card" style="margin-top:12px"><h2>🏆 Rècords</h2>${prList(s.prs)}</section>` : ""}
    ${s.note ? `<p class="small" style="white-space:pre-wrap">${esc(s.note)}</p>` : ""}
    <div class="grid2" style="margin-top:12px"><button class="btn" data-g="sess-edit" data-id="${s.id}">Edita</button><button class="btn" data-g="sess-to-tpl" data-id="${s.id}">Desa com a plantilla</button></div>
    <button class="btn danger block" style="margin-top:8px" data-g="sess-del" data-id="${s.id}">Elimina la sessió</button>`);
}

// ——————————————————— EXERCICIS ———————————————————
function muscleChips(cur, attr) {
  return `<div class="seg chips-seg">${[["", "Tots"], ...GYM_MUSCLES].map(([k, l]) => `<button class="${cur === k ? "on" : ""}" data-g="${attr}" data-v="${k}">${l}</button>`).join("")}</div>`;
}
function exRowHTML(e, act) {
  const img = exImg(e);
  return `<div class="exrow" data-g="${act}" data-id="${esc(e.id)}" role="button">
    <div class="thumb">${img ? `<img src="${img}" loading="lazy" alt="" onerror="this.remove()">` : esc(exName(e.id).slice(0, 2).toUpperCase())}</div>
    <div class="grow"><div class="fname"><span data-nt>${esc(exName(e.id))}</span>${e.custom ? ` <span class="src mine">propi</span>` : ""}</div>
      <div class="fmac">${esc(e.pm.map(m => MUSCLE_LABEL[m]).join(", "))}${e.sm.length ? ` <span class="faint">+ ${esc(e.sm.map(m => MUSCLE_LABEL[m]).join(", "))}</span>` : ""}</div></div>
    ${act === "pick-ex" ? `<button class="icon-btn sm" data-g="ex-info" data-id="${esc(e.id)}" aria-label="Informació">${ICON.info}</button>` : ""}
  </div>`;
}
function viewExercises() {
  const res = searchExercises(GU.exQ, GU.exMuscle);
  return `<input class="input" type="search" id="gym-ex-q" placeholder="Cerca (català, castellà o anglès)…" value="${esc(GU.exQ)}" style="margin-bottom:10px">
    ${muscleChips(GU.exMuscle, "ex-muscle")}
    <div class="row" style="margin:10px 0"><span class="small muted grow">${res.length} exercicis</span><button class="btn sm" data-g="custom-new">${ICON.plus}Exercici propi</button></div>
    <section class="card">${res.slice(0, GU.exLimit).map(e => exRowHTML(e, "ex-info")).join("") || `<div class="empty">Cap resultat. Pots crear-lo com a exercici propi.</div>`}
    ${res.length > GU.exLimit ? `<button class="btn block" data-g="ex-more" style="margin-top:8px">Mostra'n més</button>` : ""}</section>`;
}
function openExInfo(id) {
  const e = exById(id), custom = G().custom.some(c => c.id === id);
  const h = exHistory(id), best = Math.max(0, ...h.flatMap(x => x.it.sets.map(setE1)));
  const i0 = exImg(e, 0), i1 = exImg(e, 1);
  openSheet(`<span data-nt>${esc(exName(id))}</span>`, `
    ${i0 ? `<div class="ex-anim"><img src="${i0}" alt="Posició inicial" onerror="this.parentNode.remove()">${i1 ? `<img class="b" src="${i1}" alt="Posició final" onerror="this.remove()">` : ""}</div>` : `<div class="ex-anim none">Sense imatge</div>`}
    ${e.en && !custom ? `<p class="small faint" style="margin:-4px 0 10px">${esc(e.en)}</p>` : ""}
    <div class="mus"><span>Principals</span><div>${e.pm.map(m => `<i class="mchip p">${MUSCLE_LABEL[m]}</i>`).join("") || "—"}</div></div>
    ${e.sm.length ? `<div class="mus"><span>Secundaris</span><div>${e.sm.map(m => `<i class="mchip">${MUSCLE_LABEL[m]}</i>`).join("")}</div></div>` : ""}
    <div class="kv"><span>Material</span><b>${esc(EQUIP_LABEL[e.eq] || "—")}</b></div>
    <div class="kv"><span>Tipus</span><b>${esc(GYM_CAT[e.cat] || "—")}</b></div>
    ${h.length ? `<div class="kv"><span>Últim cop</span><b class="num">${esc(fmtShort(h[0].s.date))} · ${esc(h[0].it.sets.filter(isWork).map(x => setText(x, e.kind)).join(" · "))}</b></div>
      ${best ? `<div class="kv"><span>Millor RM estimada</span><b class="num">${fmt1(best)} kg</b></div>` : ""}
      <button class="btn block" style="margin-top:10px" data-g="prog-open" data-id="${esc(id)}">Veure el progrés</button>` : ""}
    <label class="field" style="margin-top:14px"><span>El teu nom per a aquest exercici (opcional)</span>
      <div class="row"><input class="input grow" id="ex-alias" value="${esc(G().alias[id] || "")}" placeholder="${esc((LANG() === "es" && ES_EX[id]) || e.name || e.ca || e.en)}"><button class="btn" data-g="alias-save" data-id="${esc(id)}">Desa</button></div></label>
    ${custom ? `<div class="grid2"><button class="btn" data-g="custom-edit" data-id="${esc(id)}">Edita</button><button class="btn danger" data-g="custom-del" data-id="${esc(id)}">Elimina</button></div>` : ""}
    ${i0 ? `<p class="small faint" style="margin:10px 0 0">Imatges: free-exercise-db (domini públic).</p>` : ""}`);
}
function openCustomEditor(c) {
  const isNew = !c;
  c = c || { name: "", pm: [], sm: [], eq: "other", kind: "wr" };
  GU.customDraft = { id: c.id || null, pm: [...c.pm], sm: [...c.sm] };
  const chips = (arr, w) => GYM_MUSCLES.map(([k, l]) => `<button type="button" class="mchip tog ${arr.includes(k) ? "on" : ""}" data-g="cm-tog" data-w="${w}" data-v="${k}">${l}</button>`).join("");
  openSheet(isNew ? "Exercici propi" : "Edita l'exercici", `
    <label class="field"><span>Nom</span><input class="input" id="cx-name" value="${esc(c.name)}" placeholder="Ex: Quart d'esquat explosiu"></label>
    <div class="field"><span class="flabel">Músculs principals</span><div class="mchips" id="cx-pm">${chips(c.pm, "pm")}</div></div>
    <div class="field"><span class="flabel">Músculs secundaris</span><div class="mchips" id="cx-sm">${chips(c.sm, "sm")}</div></div>
    <div class="grid2">
      <label class="field"><span>Material</span><select class="input" id="cx-eq">${GYM_EQUIP.map(([k, l]) => `<option value="${k}" ${c.eq === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="field"><span>Es registra amb</span><select class="input" id="cx-kind"><option value="wr" ${c.kind !== "t" ? "selected" : ""}>Pes i repeticions</option><option value="t" ${c.kind === "t" ? "selected" : ""}>Temps</option></select></label>
    </div>
    <button class="btn primary block" data-g="custom-save">Desa</button>`);
}

// Selector d'exercicis (per a plantilles i sessions)
function openPicker(mode, idx) {
  GU.pick = { mode, idx };
  renderPicker();
}
function renderPicker(keepFocus) {
  const res = searchExercises(GU.pickQ, GU.pickMuscle).slice(0, 80);
  const body = `<input class="input" type="search" id="gym-pick-q" placeholder="Cerca exercici…" value="${esc(GU.pickQ)}" style="margin-bottom:10px">
    ${muscleChips(GU.pickMuscle, "pick-muscle")}
    <div id="pick-list" style="margin-top:10px">${res.map(e => exRowHTML(e, "pick-ex")).join("") || `<div class="empty">Cap resultat.</div>`}</div>
    <button class="btn block" data-g="custom-new" style="margin-top:10px">${ICON.plus}Crea un exercici propi</button>`;
  const replace = GU.pick && GU.pick.mode.startsWith("replace");
  if (keepFocus && $("#pick-list")) { $("#pick-list").innerHTML = res.map(e => exRowHTML(e, "pick-ex")).join("") || `<div class="empty">Cap resultat.</div>`; return; }
  openSheet(replace ? "Canvia l'exercici" : "Afegeix exercici", body);
}
function pickExercise(exId) {
  const p = GU.pick; if (!p) return;
  if (p.mode === "tpl") { GU.tpl.items.push(itemFromEx(exId)); }
  else if (p.mode === "replace-tpl") { GU.tpl.items[p.idx].ex = exId; }
  else if (p.mode === "session" || p.mode === "replace-session") {
    const s = curSession(), e = exById(exId);
    if (p.mode === "session") {
      const it = itemFromEx(exId);
      s.items.push({ id: it.id, ex: exId, ss: false, rest: it.rest, note: "", sets: it.sets.map(x => ({ t: x.t, grir: x.t === "N" ? x.rir : "", goal: "", w: "", reps: "", rir: "", time: "", done: false })) });
    } else s.items[p.idx].ex = exId;
    gymSave(true);
  }
  GU.pick = null; GU.pickQ = "";
  closeSheet(); render();
  if (p.mode === "tpl" || p.mode === "session") setTimeout(() => { const c = $$(".ex-card"); if (c.length) c[c.length - 1].scrollIntoView({ block: "center" }); }, 30);
}
function openItemMenu(kind, i) {
  const list = kind === "tpl" ? GU.tpl.items : curSession().items, it = list[i];
  openSheet(`<span data-nt>${esc(exName(it.ex))}</span>`, `
    <div class="menu">
      <button class="btn block" data-g="im" data-op="replace" data-k="${kind}" data-i="${i}">Canvia l'exercici</button>
      ${i > 0 ? `<button class="btn block" data-g="im" data-op="up" data-k="${kind}" data-i="${i}">Mou amunt</button>` : ""}
      ${i < list.length - 1 ? `<button class="btn block" data-g="im" data-op="down" data-k="${kind}" data-i="${i}">Mou avall</button>` : ""}
      ${kind === "session" ? `<label class="field"><span>Descans</span><select class="input" data-g-rest="${i}">${REST_OPTS.map(r => `<option value="${r}" ${+it.rest === r ? "selected" : ""}>${fmtRest(r)}</option>`).join("")}</select></label>
        <label class="field"><span>Nota</span><input class="input" data-g-note="${i}" value="${esc(it.note || "")}"></label>
        ${i > 0 ? `<label class="ss-tog" style="margin-bottom:12px"><input type="checkbox" data-g-ss="${i}" ${it.ss ? "checked" : ""}> Superset amb l'anterior</label>` : ""}` : ""}
      <button class="btn danger block" data-g="im" data-op="del" data-k="${kind}" data-i="${i}">Treu l'exercici</button>
    </div>`);
}

// ——————————————————— PROGRÉS ———————————————————
function weekMuscleSets() {
  const from = addDays(todayKey(), -6), acc = {};
  for (const s of G().sessions) {
    if (s.date < from) continue;
    for (const it of s.items) {
      const n = it.sets.filter(x => x.done && isWork(x)).length;
      if (!n) continue;
      const e = exById(it.ex);
      e.pm.forEach(m => acc[m] = (acc[m] || 0) + n);
      e.sm.forEach(m => acc[m] = (acc[m] || 0) + n / 2);
    }
  }
  return Object.entries(acc).sort((a, b) => b[1] - a[1]);
}
function viewProgHome() {
  const ws = weekMuscleSets(), max = Math.max(1, ...ws.map(x => x[1]));
  let html = `<section class="card"><h2>Sèries per múscul <span class="sub">últims 7 dies</span></h2>`;
  html += ws.length ? ws.map(([m, n]) => `<div class="mbar"><span>${MUSCLE_LABEL[m]}</span><div class="bar"><div class="c-kcal" style="width:${n / max * 100}%"></div></div><b class="num">${fmt1(n)}</b></div>`).join("")
    + `<p class="small faint" style="margin:10px 0 0">Sèries efectives (sense escalfament). Els músculs secundaris compten mitja sèrie.</p>`
    : `<div class="empty">Encara no hi ha sessions aquesta setmana.</div>`;
  html += `</section>`;
  const map = new Map();
  for (const s of G().sessions) for (const it of s.items) if (it.sets.some(x => x.done)) {
    const m = map.get(it.ex) || { n: 0, last: 0 }; m.n++; m.last = Math.max(m.last, s.start); map.set(it.ex, m);
  }
  let list = [...map.entries()].sort((a, b) => b[1].last - a[1].last);
  if (GU.progQ.trim()) { const q = norm(GU.progQ); list = list.filter(([id]) => exSearchText(exById(id)).includes(q)); }
  html += `<h3 class="view-title">Progrés per exercici</h3><input class="input" type="search" id="gym-prog-q" placeholder="Cerca…" value="${esc(GU.progQ)}" style="margin-bottom:10px"><section class="card">`;
  html += list.length ? list.map(([id, m]) => {
    const h = exHistory(id), b = Math.max(0, ...h.flatMap(x => x.it.sets.map(setE1)));
    return `<div class="exrow" data-g="prog-open" data-id="${esc(id)}" role="button"><div class="grow"><div class="fname" data-nt>${esc(exName(id))}</div>
      <div class="fmac">${m.n} sessions · últim ${esc(fmtShort(keyOf(new Date(m.last))))}</div></div>${b ? `<div class="fk num">${fmt1(b)}<small>RM kg</small></div>` : ""}</div>`;
  }).join("") : `<div class="empty">Quan registris sessions, aquí veuràs l'evolució dels pesos de cada exercici.</div>`;
  return html + `</section>`;
}
function exSeries(id) {
  return exHistory(id).reverse().map(({ s, it }) => {
    const w = it.sets.filter(x => x.done && isWork(x));
    const top = w.reduce((b, x) => setE1(x) > setE1(b || {}) ? x : b, null);
    return { d: s.date, sid: s.id, e1: Math.max(0, ...w.map(setE1)), wmax: Math.max(0, ...w.map(x => numIn(x.w) || 0)),
      vol: w.reduce((t, x) => t + (numIn(x.w) || 0) * (numIn(x.reps) || 0), 0), reps: Math.max(0, ...w.map(x => numIn(x.reps) || 0)),
      time: Math.max(0, ...w.map(x => parseTime(x.time) || 0)), top, sets: w };
  });
}
function gymLineChart(pts, unit, dec = 1, markBest = true) {
  if (pts.length < 2) return `<div class="empty small">Calen almenys 2 sessions per dibuixar la gràfica.</div>`;
  const W = 340, H = 170, L = 38, R = 10, T = 12, B = 22, pw = W - L - R, ph = H - T - B;
  const vs = pts.map(p => p.v), span = Math.max(...vs) - Math.min(...vs) || Math.max(...vs) * 0.1 || 1;
  const lo = Math.max(0, Math.min(...vs) - span * 0.15), hi = Math.max(...vs) + span * 0.15;
  const t0 = parseKey(pts[0].d).getTime(), t1 = parseKey(pts[pts.length - 1].d).getTime();
  const x = (p, i) => L + (t1 === t0 ? (i / (pts.length - 1)) * pw : ((parseKey(p.d).getTime() - t0) / (t1 - t0)) * pw);
  const y = v => T + ph - ((v - lo) / (hi - lo)) * ph;
  const f = v => dec ? fmt1(v) : fmt(v);
  let g = `<g class="grid">`;
  for (const t of [lo, (lo + hi) / 2, hi]) g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${hi >= 1000 ? (Math.round(t / 100) / 10).toLocaleString("ca-ES") + "k" : f(t)}</text>`;
  g += `</g>`;
  const best = markBest ? Math.max(...vs) : NaN;
  let m = `<path d="${pts.map((p, i) => `${i ? "L" : "M"}${x(p, i)},${y(p.v)}`).join("")}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  pts.forEach((p, i) => {
    m += `<circle cx="${x(p, i)}" cy="${y(p.v)}" r="${p.v === best ? 5 : 3.5}" fill="${p.v === best ? "var(--warn)" : "var(--accent)"}" stroke="var(--surface)" stroke-width="2"/>`;
    m += `<circle class="hit" cx="${x(p, i)}" cy="${y(p.v)}" r="13" data-tip="${esc(fmtShort(p.d))}: ${f(p.v)} ${unit}${p.tip ? " · " + esc(p.tip) : ""}"/>`;
  });
  m += `<text x="${L}" y="${H - 6}">${esc(fmtShort(pts[0].d))}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${esc(fmtShort(pts[pts.length - 1].d))}</text>`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${g}${m}</svg><div class="tip" hidden></div></div>`;
}
function viewProgEx() {
  const id = GU.progEx, e = exById(id), ser = exSeries(id), kind = e.kind;
  let html = `<div class="row" style="margin-bottom:10px"><button class="icon-btn" data-g="prog-back" aria-label="Enrere">${ICON.left}</button>
    <button class="ex-name big grow" data-nt data-g="ex-info" data-id="${esc(id)}">${esc(exName(id))}</button></div>`;
  if (!ser.length) return html + `<section class="card"><div class="empty">Encara no has registrat aquest exercici.</div></section>`;
  const hasW = ser.some(p => p.wmax > 0);
  const metrics = kind === "t" ? [["time", "Temps"]] : hasW ? [["e1rm", "RM est."], ["wmax", "Pes màx."], ["vol", "Volum"], ["reps", "Repes"]] : [["reps", "Repes màx."], ["vol", "Volum"]];
  if (!metrics.some(m => m[0] === GU.progMetric)) GU.progMetric = metrics[0][0];
  const met = GU.progMetric;
  const last = ser[ser.length - 1], bestE1 = Math.max(...ser.map(p => p.e1)), bestW = Math.max(...ser.map(p => p.wmax));
  if (kind !== "t") html += `<div class="kpis">
    ${hasW ? `<div class="kpi"><span>RM estimada (última)</span><b class="num">${fmt1(last.e1)} kg</b><small>millor: ${fmt1(bestE1)} kg</small></div>
    <div class="kpi"><span>Pes màxim</span><b class="num">${fmt1(bestW)} kg</b><small>últim: ${fmt1(last.wmax)} kg</small></div>` :
    `<div class="kpi"><span>Repes màximes</span><b class="num">${Math.max(...ser.map(p => p.reps))}</b><small>últim: ${last.reps}</small></div>`}
  </div>`;
  const unit = { e1rm: "kg", wmax: "kg", vol: "kg", reps: "rep", time: "s" }[met];
  const key = { e1rm: "e1", wmax: "wmax", vol: "vol", reps: "reps", time: "time" }[met];
  const pts = ser.filter(p => p[key] > 0).map(p => ({ d: p.d, v: p[key], tip: p.top ? setText(p.top, kind) : "" }));
  html += `<section class="card"><div class="seg" style="margin-bottom:12px">${metrics.map(([k, l]) => `<button class="${met === k ? "on" : ""}" data-g="prog-metric" data-v="${k}">${l}</button>`).join("")}</div>
    ${gymLineChart(pts, unit, met === "vol" || met === "reps" || met === "time" ? 0 : 1)}
    ${met === "e1rm" ? `<p class="small faint" style="margin:8px 0 0">RM estimada amb la millor sèrie de cada dia (pes, repes i RIR). El punt taronja és el millor registre.</p>` : ""}</section>`;
  if (kind !== "t" && hasW) {
    const rec = {};
    for (const p of ser) for (const x of p.sets) { const r = numIn(x.reps), w = numIn(x.w); if (r > 0 && w > 0 && r <= 20 && (!rec[r] || w > rec[r].w)) rec[r] = { w, d: p.d }; }
    const keys = Object.keys(rec).map(Number).sort((a, b) => a - b);
    if (keys.length) html += `<section class="card"><h2>Rècords per repeticions</h2><div class="table-wrap"><table class="data num"><thead><tr><th>Repes</th><th>Pes</th><th>Data</th></tr></thead><tbody>${keys.map(r => `<tr><td>${r}</td><td>${fmt1(rec[r].w)} kg</td><td>${esc(fmtShort(rec[r].d))}</td></tr>`).join("")}</tbody></table></div></section>`;
  }
  html += `<section class="card"><h2>Sessions</h2>${[...ser].reverse().slice(0, 30).map(p => `<div class="kv" data-g="sess-open" data-id="${p.sid}" role="button"><span>${esc(fmtShort(p.d))}</span><b class="num">${esc(p.sets.map(x => setText(x, kind)).join(" · "))}</b></div>`).join("")}</section>`;
  return html;
}

// ——————————————————— CALCULADORA RM / RIR ———————————————————
function viewCalc() {
  const c = GU.calc;
  return `<section class="card"><h2>La teva sèrie</h2>
    <div class="grid3">
      <label class="field"><span>Pes</span><div class="unit-input"><input class="input num" inputmode="decimal" data-gc="w" value="${esc(c.w)}" placeholder="100"><em>kg</em></div></label>
      <label class="field"><span>Repes</span><input class="input num" inputmode="numeric" data-gc="reps" value="${esc(c.reps)}" placeholder="8"></label>
      <label class="field"><span>RIR</span><input class="input num" inputmode="numeric" data-gc="rir" value="${esc(c.rir)}" placeholder="0"></label>
    </div>
    <div class="result-big"><b class="num" id="calc-rm">—</b><span class="muted">kg de RM estimada</span></div>
  </section>
  <section class="card"><h2>Repeticions amb un altre pes</h2>
    <label class="field"><span>Pes x</span><div class="unit-input"><input class="input num" inputmode="decimal" data-gc="x" value="${esc(c.x)}" placeholder="mateix pes"><em>kg</em></div></label>
    <div id="calc-rir"></div>
  </section>
  <section class="card"><h2>Pes per a cada nombre de repeticions</h2>
    <label class="field"><span>Deixant a la recambra</span><div class="seg">${[0, 1, 2, 3].map(r => `<button class="${+c.trir === r ? "on" : ""}" data-g="calc-trir" data-v="${r}">RIR ${r}</button>`).join("")}</div></label>
    <div id="calc-table"></div>
    <p class="small faint" style="margin:10px 2px 0">Estimació amb Brzycki (fins a 10 repes) i Epley (a partir de 10). És més fiable amb sèries de 3 a 10 repeticions i a prop del fallo.</p>
  </section>`;
}
function calcRefresh() {
  const c = GU.calc, w = numIn(c.w), reps = numIn(c.reps), rir = numIn(c.rir) || 0;
  const rm = w > 0 && reps > 0 ? e1RM(w, reps, rir) : 0;
  const elRM = $("#calc-rm"); if (!elRM) return;
  elRM.textContent = rm ? fmt1(rm) : "—";
  const x = numIn(c.x) || w;
  const box = $("#calc-rir"), tb = $("#calc-table");
  if (!rm) { box.innerHTML = `<div class="empty small">Escriu el pes i les repes que has fet.</div>`; tb.innerHTML = ""; return; }
  const rf = repsToFailure(rm, x);
  const pctX = x / rm * 100;
  box.innerHTML = rf < 1 ? `<div class="banner warn">Amb ${fmt1(x)} kg estàs per sobre de la teva RM estimada.</div>`
    : `<p class="small muted" style="margin:0 0 8px">${fmt1(x)} kg és el ${r0(pctX)}% de la RM</p><div class="rir-grid">${[0, 1, 2, 3, 4, 5].map(n => {
        const r = Math.floor(rf + 1e-6) - n;
        return `<div class="${n === 0 ? "f" : ""}"><span>${n === 0 ? "Fallo" : "RIR " + n}</span><b class="num">${r > 0 ? r : "—"}</b><small>${r > 0 ? (r === 1 ? "repe" : "repes") : ""}</small></div>`;
      }).join("")}</div>`;
  const tr = +c.trir || 0;
  tb.innerHTML = `<div class="table-wrap"><table class="data num"><thead><tr><th>Repes</th><th>Pes</th><th>% RM</th></tr></thead><tbody>${
    [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map(r => { const kg = weightFor(rm, r, tr); return `<tr><td>${r}${tr ? ` <span class="faint">@RIR ${tr}</span>` : ""}</td><td>${fmt1(roundW(kg))} kg</td><td>${r0(kg / rm * 100)}%</td></tr>`; }).join("")
  }</tbody></table></div>`;
}

// ——————————————————— rutina inicial (opcional) ———————————————————
function seedRoutine() {
  const W = (reps) => ({ t: "W", rir: "", reps: String(reps) }), R = (rir, reps) => ({ t: "N", rir: String(rir), reps }), F = reps => ({ t: "F", rir: "", reps }), D = reps => ({ t: "D", rir: "", reps });
  const rep = (n, f) => Array.from({ length: n }, f);
  const C = G().custom;
  const mk = (id, name, pm, sm, kind = "wr", imgOf = null) => { if (!C.some(c => c.id === id)) C.push({ id, name, pm, sm, eq: "other", kind, cat: kind === "t" ? "cardio" : "strength", imgOf, imgs: 0 }); return id; };
  const sh = mk("c_espatlla3d", "Espatlla 3 direccions (laterals, frontals, manguito)", ["shoulders"], [], "wr", "Side_Lateral_Raise");
  const qs = "x_quart_esquat_explosiu";
  const cr = mk("c_canvisritme", "Canvis de ritme", ["quadriceps"], ["hamstrings", "calves"], "t", "Wind_Sprints");
  const coreJ = mk("c_coreJ", "Circuit de core J (isomètric)", ["abdominals"], ["lower back"], "t", "Plank");
  const coreE = mk("c_coreE", "Circuit de core E (plegades)", ["abdominals"], [], "t", "Crunches");
  const av3 = mk("c_avantbrac3d", "Avantbraç 3 direccions", ["forearms"], [], "wr", "Palms-Up_Barbell_Wrist_Curl_Over_A_Bench");
  const A = G().alias;
  A["Standing_One-Arm_Cable_Curl"] ||= "Curl bayesià amb politja";
  A["Reverse_Barbell_Preacher_Curls"] ||= "Avantbraç invers al banc predicador";
  const I = (ex, sets, rest, o = {}) => ({ id: uid(), ex, sets, rest, ss: !!o.ss, note: o.note || "" });
  const N = reps => ({ t: "N", rir: "", reps });
  const T = [
    ["Cames explosiu (dilluns)", [
      I(sh, [W(8)], 0),
      I("Hang_Snatch", [W(10), ...rep(4, () => R(3, "2-4"))], 180, { note: "Escalfament ~40%" }),
      I("Split_Jerk", rep(3, () => R(3, "7")), 120, { note: "3 per cama + 1 push jerk" }),
      I("Split_Jump", rep(3, () => N("6-8/cama")), 120, { ss: true }),
      I(qs, rep(3, () => R(3, "5-6")), 120),
      I("Stiff-Legged_Dumbbell_Deadlift", rep(3, () => R(1, "8-12")), 120, { ss: true }),
      I("Seated_Leg_Curl", [R(1, "10-12"), R(1, "10-12"), F("10-12")], 120, { ss: true }),
      I(cr, [N("19:30")], 0),
    ]],
    ["Esquena + tríceps (dimarts)", [
      I(sh, [W(10)], 0),
      I("Bent_Over_Barbell_Row", [W(10), R(2, "8-12"), R(1, "8-12"), R(1, "8-12")], 120, { note: "Escalfament ~50%" }),
      I("One_Arm_Lat_Pulldown", [R(2, "10-12"), R(1, "10-12"), F("10-12")], 120),
      I("Seated_Cable_Rows", [R(1, "8-12"), F("8-12"), D("8-12")], 120),
      I("Wide-Grip_Lat_Pulldown", [R(2, "8-12"), R(1, "8-12"), R(1, "8-12"), F("8-12")], 120, { note: "O pull ups" }),
      I("Triceps_Pushdown", [R(1, "8-12"), F("8-12"), D("8-12")], 90),
      I("Standing_Low-Pulley_One-Arm_Triceps_Extension", [R(1, "10-12"), F("10-12"), D("10-12")], 90),
      I("Reverse_Grip_Triceps_Pushdown", [R(1, "12-15"), R(1, "12-15"), F("12-15")], 90),
    ]],
    ["Pectoral + bíceps (dimecres)", [
      I(sh, [W(10)], 0),
      I("Incline_Dumbbell_Press", [W(12), R(2, "6-10"), R(1, "6-10"), F("6-10"), D("6-10")], 180, { note: "Escalfament ~60%" }),
      I("Decline_Dumbbell_Bench_Press", [R(2, "8-12"), R(1, "8-12"), F("8-12")], 150),
      I("Cable_Crossover", [R(1, "10-15"), R(1, "10-15"), F("10-15")], 90),
      I("Side_Lateral_Raise", [R(1, "12-20"), R(1, "12-20"), F("12-20")], 60),
      I("Incline_Dumbbell_Curl", [W(8), R(1, "8-12"), R(1, "8-12"), F("8-12")], 90, { note: "Escalfament ~50%" }),
      I("Dumbbell_Bicep_Curl", [R(1, "8-10"), F("8-10")], 90),
      I("Hammer_Curls", [R(1, "8-10"), F("8-10")], 90, { ss: true }),
      I(coreJ, [N("circuit")], 0),
    ]],
    ["Cames pesat (dijous)", [
      I("x_salt_horitzontal_pausa", rep(3, () => N("3-5")), 90),
      I("Barbell_Full_Squat", [W(5), W(3), R(2, "6-8"), F("6-8"), F("6-8")], 180, { note: "Escalfament 55-65% · 75-85%" }),
      I("Hack_Squat", [R(2, "8-12"), R(1, "8-12"), F("8-12"), F("8-12")], 180, { note: "Peus amunt a la plataforma" }),
      I("Ball_Leg_Curl", rep(3, () => R(1, "12-15")), 60, { note: "A 3×15 amb RIR 1 → passa a unilateral" }),
      I("Standing_Calf_Raises", [R(1, "10-15"), R(1, "10-15"), F("10-15")], 90, { ss: true }),
      I("Leg_Extensions", [R(1, "10-12"), F("10-12"), D("10-12")], 0),
      I("Dumbbell_Lunges", rep(3, () => R(2, "7-8/cama")), 150, { ss: true, note: "Pes per costat" }),
      I("Seated_Calf_Raise", [R(1, "12-20"), R(1, "12-20"), F("12-20")], 90),
    ]],
    ["Espatlla + torso (divendres)", [
      I(sh, [W(10)], 0),
      I("Standing_Military_Press", [W(10), R(2, "6-10"), R(1, "6-10"), R(1, "6-10")], 150, { note: "Escalfament ~50%" }),
      I("Barbell_Bench_Press_-_Medium_Grip", [W(10), R(2, "6-10"), R(1, "6-10"), R(1, "6-10")], 90, { note: "Escalfament ~50%" }),
      I("Lying_T-Bar_Row", [R(1, "8-12"), R(1, "8-12"), F("8-12")], 90, { ss: true }),
      I("Side_Lateral_Raise", [R(1, "12-20"), R(1, "12-20"), R(1, "12-20"), F("12-20")], 60),
      I("Reverse_Machine_Flyes", [R(1, "12-20"), R(1, "12-20"), F("12-20")], 60, { ss: true }),
      I("Face_Pull", rep(3, () => R(1, "12-15")), 90),
      I(coreE, [N("circuit")], 0),
    ]],
    ["Braços + avantbraç (dissabte)", [
      I(sh, [W(10)], 0),
      I("EZ-Bar_Curl", [R(1, "8-12"), R(1, "8-12"), F("8-12")], 90),
      I("EZ-Bar_Skullcrusher", [R(1, "8-12"), R(1, "8-12"), F("8-12")], 90, { ss: true }),
      I("Standing_One-Arm_Cable_Curl", [R(1, "10-15/braç"), R(1, "10-15/braç"), F("10-15/braç")], 60),
      I("Standing_Low-Pulley_Deltoid_Raise", [R(1, "12-20/braç"), R(1, "12-20/braç"), F("12-20/braç")], 60, { ss: true }),
      I(av3, [N("16"), N("13"), N("10")], 60, { note: "+1 repe per pausa" }),
      I("Reverse_Barbell_Preacher_Curls", [R(1, "15-20"), R(1, "15-20"), F("15-20")], 60, { ss: true }),
    ]],
  ];
  for (const [name, items] of T) { items.forEach(it => it.note = tr(it.note)); G().templates.push({ id: uid(), name: tr(name), note: "", items, updated: Date.now() }); }
  save(); render();
  toast("Rutina carregada: revisa-la i edita el que calgui");
}

// ——————————————————— esdeveniments ———————————————————
function gymClick(e) {
  const a = e.target.closest("[data-g]");
  if (!a) return false;
  const g = a.dataset.g, s = curSession();
  const si = a.closest("[data-si]"), sj = a.closest("[data-sj]"), ti = a.closest("[data-ti]"), tj = a.closest("[data-tj]");
  switch (g) {
    case "view": GU.view = a.dataset.v; if (GU.view !== "prog") GU.progEx = null; render(); window.scrollTo({ top: 0 }); break;
    case "goto-session": GU.view = "train"; if (UI.tab !== "gym") setTab("gym"); else render(); break;
    // plantilles
    case "tpl-new": GU.tpl = { id: uid(), name: "", note: "", items: [] }; render(); break;
    case "tpl-edit": GU.tpl = clone(G().templates.find(t => t.id === a.dataset.id)); render(); window.scrollTo({ top: 0 }); break;
    case "tpl-cancel": GU.tpl = null; render(); break;
    case "tpl-save": {
      const t = GU.tpl;
      if (!t.name.trim()) { toast("Posa-li un nom"); $("[data-gt=name]").focus(); break; }
      if (!t.items.length) { toast("Afegeix almenys un exercici"); break; }
      t.updated = Date.now();
      const L = G().templates, k = L.findIndex(x => x.id === t.id);
      if (k >= 0) L[k] = t; else L.push(t);
      GU.tpl = null; save(); render(); toast("Plantilla desada"); break;
    }
    case "tpl-dup": { const t = clone(GU.tpl); t.id = uid(); t.name += " (còpia)"; t.updated = Date.now(); G().templates.push(t); GU.tpl = null; save(); render(); toast("Plantilla duplicada"); break; }
    case "tpl-del": if (confirm("Eliminar la plantilla? L'historial no canvia.")) { G().templates = G().templates.filter(t => t.id !== GU.tpl.id); GU.tpl = null; save(); render(); } break;
    case "ts-add": { const it = GU.tpl.items[+ti.dataset.ti]; it.sets.push(newTplSet(it.sets[it.sets.length - 1])); render(); break; }
    case "ts-rm": { const it = GU.tpl.items[+ti.dataset.ti]; it.sets.splice(+tj.dataset.tj, 1); render(); break; }
    case "ti-menu": openItemMenu("tpl", +a.dataset.i); break;
    case "seed": seedRoutine(); break;
    // sessió
    case "start-empty": case "start-tpl": {
      if (G().active) { toast("Ja tens una sessió en curs"); break; }
      const t = g === "start-tpl" ? G().templates.find(x => x.id === a.dataset.id) : null;
      G().active = sessionFromTemplate(t); GU.view = "train";
      save(); syncWakeLock(); render(); window.scrollTo({ top: 0 });
      if (!t) openPicker("session");
      break;
    }
    case "si-menu": openItemMenu("session", +a.dataset.i); break;
    case "tag-cycle": {
      const it = s.items[+si.dataset.si], x = it.sets[+sj.dataset.sj];
      const order = ["W", "N", "F", "D"]; x.t = order[(order.indexOf(x.t) + 1) % 4];
      gymSave(); refreshSetRow(+si.dataset.si, +sj.dataset.sj); break;
    }
    case "set-done": {
      const i = +si.dataset.si, j = +sj.dataset.sj, it = s.items[i], x = it.sets[j];
      x.done = !x.done;
      if (x.done) {
        const pv = prevPlaceholders(it, s.id).rows[j];
        if (pv) { if (x.w === "") x.w = pv.w ?? ""; if (x.reps === "") x.reps = pv.reps ?? ""; if (x.time === "") x.time = pv.time ?? ""; }
        // Descans de l'exercici (en un superset, posa 0 al primer per encadenar-lo amb el següent)
        if (!GU.edit) startRest(+it.rest || 0, exName(it.ex));
        announcePR(s, i, j);
      }
      gymSave(true); refreshSetRow(i, j); break;
    }
    case "ss-add": {
      const it = s.items[+si.dataset.si], last = it.sets[it.sets.length - 1] || { t: "N", grir: "", goal: "" };
      it.sets.push({ t: last.t === "W" ? "N" : last.t, grir: last.grir, goal: last.goal, w: last.w, reps: "", rir: "", time: "", done: false });
      gymSave(true); render(); break;
    }
    case "ss-rm-last": { const it = s.items[+si.dataset.si]; it.sets.pop(); gymSave(true); render(); break; }
    case "rest-add": { const t = G().active && G().active.timer; if (t) { t.end += +a.dataset.v * 1000; t.total = Math.max(1, t.total + +a.dataset.v); t.fired = false; gymSave(); updateTimerBar(); } break; }
    case "rest-skip": if (G().active) { G().active.timer = null; gymSave(); updateTimerBar(); } break;
    case "sess-finish": finishSession(); break;
    case "sess-discard": if (confirm("Descartar la sessió? No es desarà res.")) { G().active = null; save(); syncWakeLock(); updateTimerBar(); render(); } break;
    // menú d'exercici
    case "im": {
      const k = a.dataset.k, i = +a.dataset.i, list = k === "tpl" ? GU.tpl.items : s.items;
      const op = a.dataset.op;
      if (op === "replace") { openPicker(k === "tpl" ? "replace-tpl" : "replace-session", i); break; }
      if (op === "up" && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
      if (op === "down" && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
      if (op === "del") { if (k === "session" && list[i].sets.some(x => x.done) && !confirm("Aquest exercici té sèries fetes. Treure'l?")) break; list.splice(i, 1); }
      if (list[0]) list[0].ss = false;
      if (k === "session") gymSave(true);
      closeSheet(); render(); break;
    }
    // historial
    case "sess-open": openSessionDetail(a.dataset.id); break;
    case "sess-del": if (confirm("Eliminar aquesta sessió de l'historial?")) { G().sessions = G().sessions.filter(x => x.id !== a.dataset.id); save(); closeSheet(); render(); toast("Sessió eliminada"); } break;
    case "sess-edit": {
      if (G().active) { toast("Acaba primer la sessió en curs"); break; }
      GU.edit = clone(G().sessions.find(x => x.id === a.dataset.id)); GU.view = "train"; GU.tpl = null;
      closeSheet(); if (UI.tab !== "gym") setTab("gym"); else render(); window.scrollTo({ top: 0 }); break;
    }
    case "edit-cancel": GU.edit = null; render(); break;
    case "edit-save": {
      const ed = cleanSession(GU.edit), L = G().sessions, k = L.findIndex(x => x.id === ed.id);
      ed.prs = sessionPRs(ed);
      if (k >= 0) { if (ed.items.length) L[k] = ed; else L.splice(k, 1); }
      GU.edit = null; GU.view = "hist"; save(); render(); toast("Sessió actualitzada"); break;
    }
    case "sess-to-tpl": {
      const src = G().sessions.find(x => x.id === a.dataset.id);
      GU.tpl = { id: uid(), name: src.name, note: "", items: src.items.map(it => ({ id: uid(), ex: it.ex, ss: !!it.ss, rest: it.rest || 0, note: it.note || "",
        sets: it.sets.map(x => ({ t: x.t, rir: x.t === "N" ? (x.grir || x.rir || "") : "", reps: x.goal || x.reps || x.time || "" })) })) };
      GU.view = "train"; closeSheet(); if (UI.tab !== "gym") setTab("gym"); else render(); window.scrollTo({ top: 0 }); break;
    }
    // exercicis
    case "ex-muscle": GU.exMuscle = a.dataset.v; GU.exLimit = 60; render(); break;
    case "ex-more": GU.exLimit += 100; render(); break;
    case "ex-info": e.stopPropagation(); openExInfo(a.dataset.id); break;
    case "alias-save": {
      const v = $("#ex-alias").value.trim();
      if (v) G().alias[a.dataset.id] = v; else delete G().alias[a.dataset.id];
      save(); closeSheet(); render(); toast("Nom desat"); break;
    }
    case "custom-new": openCustomEditor(null); break;
    case "custom-edit": openCustomEditor(G().custom.find(c => c.id === a.dataset.id)); break;
    case "custom-del": {
      const id = a.dataset.id;
      if (usedExerciseIds().has(id) && !confirm("Aquest exercici surt a plantilles o a l'historial. Eliminar-lo igualment? Allà sortirà com a «desconegut».")) break;
      G().custom = G().custom.filter(c => c.id !== id); save(); closeSheet(); render(); break;
    }
    case "cm-tog": {
      const arr = GU.customDraft[a.dataset.w], v = a.dataset.v, k = arr.indexOf(v);
      if (k >= 0) arr.splice(k, 1); else arr.push(v);
      a.classList.toggle("on", k < 0); break;
    }
    case "custom-save": {
      const name = $("#cx-name").value.trim();
      if (!name) { toast("Posa-li un nom"); break; }
      const d = GU.customDraft;
      if (!d.pm.length) { toast("Marca almenys un múscul principal"); break; }
      const kind = $("#cx-kind").value;
      const obj = { name, pm: d.pm, sm: d.sm.filter(m => !d.pm.includes(m)), eq: $("#cx-eq").value, kind, cat: kind === "t" ? "cardio" : "strength", imgs: 0 };
      let id = d.id;
      if (id) Object.assign(G().custom.find(c => c.id === id), obj);
      else { id = "c_" + uid(); G().custom.push({ id, ...obj }); }
      save();
      if (GU.pick) pickExercise(id); else { closeSheet(); render(); toast("Exercici desat"); }
      break;
    }
    case "pick": openPicker(a.dataset.mode); break;
    case "pick-muscle": GU.pickMuscle = a.dataset.v; renderPicker(); break;
    case "pick-ex": pickExercise(a.dataset.id); break;
    // progrés
    case "prog-open": GU.progEx = a.dataset.id; GU.view = "prog"; closeSheet(); if (UI.tab !== "gym") setTab("gym"); else { render(); window.scrollTo({ top: 0 }); } break;
    case "prog-back": GU.progEx = null; render(); break;
    case "prog-metric": GU.progMetric = a.dataset.v; render(); break;
    case "calc-trir": GU.calc.trir = a.dataset.v; $$("[data-g=calc-trir]").forEach(b => b.classList.toggle("on", b === a)); calcRefresh(); break;
    default: return false;
  }
  return true;
}
function gymInput(e) {
  const el = e.target;
  if (el.dataset.gs) {
    const s = curSession(), i = +el.closest("[data-si]").dataset.si, j = +el.closest("[data-sj]").dataset.sj;
    s.items[i].sets[j][el.dataset.gs] = el.value.trim();
    gymSave(); return true;
  }
  if (el.dataset.gsTop) { curSession()[el.dataset.gsTop] = el.value; gymSave(); return true; }
  if (el.dataset.gt) { GU.tpl[el.dataset.gt] = el.value; return true; }
  if (el.dataset.gts && el.tagName === "INPUT") { GU.tpl.items[+el.closest("[data-ti]").dataset.ti].sets[+el.closest("[data-tj]").dataset.tj][el.dataset.gts] = el.value.trim(); return true; }
  if (el.dataset.gti === "note") { GU.tpl.items[+el.closest("[data-ti]").dataset.ti].note = el.value; return true; }
  if (el.dataset.gNote != null) { curSession().items[+el.dataset.gNote].note = el.value; gymSave(); return true; }
  if (el.dataset.gc) { GU.calc[el.dataset.gc] = el.value; calcRefresh(); return true; }
  if (el.id === "gym-ex-q" || el.id === "gym-prog-q") {
    if (el.id === "gym-ex-q") { GU.exQ = el.value; GU.exLimit = 60; } else GU.progQ = el.value;
    const pos = el.selectionStart, id = el.id;
    render();
    const q = $("#" + id); q.focus(); try { q.setSelectionRange(pos, pos); } catch (_) {}
    return true;
  }
  if (el.id === "gym-pick-q") { GU.pickQ = el.value; renderPicker(true); return true; }
  return false;
}
function gymChange(e) {
  const el = e.target;
  if (el.dataset.gts === "t") {
    const it = GU.tpl.items[+el.closest("[data-ti]").dataset.ti], st = it.sets[+el.closest("[data-tj]").dataset.tj];
    st.t = el.value; if (st.t === "N" && !st.rir) st.rir = "1"; if (st.t !== "N") st.rir = "";
    render(); return true;
  }
  if (el.dataset.gti === "rest") { GU.tpl.items[+el.closest("[data-ti]").dataset.ti].rest = +el.value; return true; }
  if (el.dataset.gti === "ss") { GU.tpl.items[+el.closest("[data-ti]").dataset.ti].ss = el.checked; render(); return true; }
  if (el.dataset.gRest != null) { curSession().items[+el.dataset.gRest].rest = +el.value; gymSave(); return true; }
  if (el.dataset.gSs != null) { curSession().items[+el.dataset.gSs].ss = el.checked; gymSave(); render(); return true; }
  return false;
}
// En tancar el full del menú de sessió, refresca (descans/nota canviats)
function gymSheetClosed() { if (UI.tab === "gym" && curSession() && !GU.tpl) render(); }
