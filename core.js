// Lògica pura: cerca d'aliments, lectura de text de menjars, càlcul d'objectius, lectura d'etiquetes.

const STOP = new Set(["de", "d", "del", "dels", "la", "el", "els", "les", "los", "las", "lo", "l", "e", "un", "una", "uns", "unes", "amb", "con", "al", "a", "en"]);

function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/l·l/g, "ll").replace(/l\.l/g, "ll")
    .replace(/[’'`´]/g, " ")
    .replace(/[^a-z0-9%\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function stem(t) {
  if (t.length > 4 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s")) return t.slice(0, -1);
  return t;
}
function tokens(s) {
  return norm(s).split(" ").filter(t => t && !STOP.has(t)).map(stem);
}

// Puntua un text de cerca contra una frase (nom o àlies)
function phraseScore(qt, phrase) {
  const pt = tokens(phrase);
  if (!pt.length || !qt.length) return 0;
  const qs = qt.join(" "), ps = pt.join(" ");
  if (qs === ps) return 100;
  let hit = 0;
  for (const q of qt) {
    if (pt.some(p => p === q)) hit += 1;
    else if (pt.some(p => (p.startsWith(q) || q.startsWith(p)) && Math.min(p.length, q.length) >= 3)) hit += 0.75;
  }
  const covQ = hit / qt.length;           // quanta part de la cerca s'explica
  const covP = hit / pt.length;           // quanta part de la frase s'utilitza
  if (covQ === 0) return 0;
  return Math.round(45 * covQ + 35 * covP + (ps.startsWith(qs) ? 10 : 0));
}

function foodScore(qt, food) {
  let best = phraseScore(qt, food.name);
  for (const a of food.aliases || []) best = Math.max(best, phraseScore(qt, a) - 2);
  if (!food.generic && best > 0) best += 12;   // prioritat als aliments propis
  return best;
}

function searchFoods(query, foods, limit = 8) {
  const qt = tokens(query);
  if (!qt.length) return [];
  return foods
    .map(f => ({ food: f, score: foodScore(qt, f) }))
    .filter(x => x.score >= 35)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ——— Lectura del text lliure d'un menjar ———
const UNIT_RE = "(kg|kgs|g|gr|grs|gram|grams|gramo|gramos|ml|cl|l|u|ud|uds|unitat|unitats|unidad|unidades|x|cullerada|cullerades|cucharada|cucharadas|scoop|scoops|llesca|llesques|rebanada|rebanadas)";
const QTY_FIRST = new RegExp("^\\s*(\\d+(?:[.,]\\d+)?)\\s*" + UNIT_RE + "?\\.?\\s+(.+)$", "i");
const QTY_FIRST_TIGHT = new RegExp("^\\s*(\\d+(?:[.,]\\d+)?)\\s*" + UNIT_RE + "\\.?(.+)$", "i");
const QTY_LAST = new RegExp("^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s*" + UNIT_RE + "?\\.?\\s*$", "i");

function splitMealText(text) {
  return (text || "")
    .split(/[,;\n+]+/)
    .flatMap(ch => ch.split(/\s+(?:i|y|and|amb|con)\s+(?=\d)/i))
    .map(s => s.trim())
    .filter(Boolean);
}

function parseChunk(chunk) {
  let m = chunk.match(QTY_FIRST) || chunk.match(QTY_FIRST_TIGHT), qty, unit, name;
  if (m) { qty = m[1]; unit = m[2]; name = m[3]; }
  else if ((m = chunk.match(QTY_LAST))) { name = m[1]; qty = m[2]; unit = m[3]; }
  else { name = chunk; qty = null; unit = null; }
  name = name.replace(/^\s*(de|del|d['’`´]?)\s*/i, "").replace(/^e\s+/i, "").trim();
  return { name, qty: qty == null ? null : parseFloat(String(qty).replace(",", ".")), unit: unit ? unit.toLowerCase() : null };
}

// Converteix quantitat + unitat a grams, segons l'aliment
function toGrams(qty, unit, food) {
  if (qty == null) return food && food.unitG ? food.unitG : 100;
  const u = unit || "";
  if (/^(kg|kgs)$/.test(u)) return qty * 1000;
  if (/^l$/.test(u)) return qty * 1000;
  if (/^cl$/.test(u)) return qty * 10;
  if (/^(g|gr|grs|gram|grams|gramo|gramos|ml)$/.test(u)) return qty;
  if (/^(cullerad|cucharad)/.test(u)) return qty * 10;
  if (/^scoop/.test(u)) return qty * 30;
  if (/^(llesc|rebanad)/.test(u)) return qty * (food && food.unitG ? food.unitG : 30);
  if (/^(u|ud|uds|unitat|unitats|unidad|unidades|x)$/.test(u)) return qty * (food && food.unitG ? food.unitG : 100);
  // sense unitat: si l'aliment es compta per unitats i el número és petit → unitats
  if (food && food.unitG && qty <= 12) return qty * food.unitG;
  return qty;
}

function macrosFor(food, grams) {
  const k = grams / 100;
  return {
    kcal: (food ? food.kcal : 0) * k,
    p: (food ? food.p : 0) * k,
    c: (food ? food.c : 0) * k,
    f: (food ? food.f : 0) * k,
  };
}

function parseMealText(text, foods) {
  return splitMealText(text).map(chunk => {
    const { name, qty, unit } = parseChunk(chunk);
    const hits = searchFoods(name, foods);
    const food = hits.length ? hits[0].food : null;
    const grams = Math.round(toGrams(qty, unit, food) * 10) / 10;
    return { raw: chunk, name, qty, unit, grams, food, alternatives: hits.map(h => h.food) };
  });
}

// ——— Càlcul d'objectius ———
const GOALS = {
  bulk:     { label: "Volum",           adj: 0.15,  prot: 1.8, fat: 0.9 },
  leanbulk: { label: "Volum lleuger",   adj: 0.08,  prot: 1.9, fat: 0.9 },
  maint:    { label: "Manteniment",     adj: 0,     prot: 1.8, fat: 0.9 },
  mildcut:  { label: "Dèficit lleuger", adj: -0.12, prot: 2.0, fat: 0.8 },
  cut:      { label: "Dèficit",         adj: -0.20, prot: 2.2, fat: 0.8 },
};
const INTENSITY = {
  vhigh:  { label: "Molt intens",  met: 8 },
  high:   { label: "Intens",       met: 6.5 },
  mod:    { label: "Moderat",      met: 5 },
  low:    { label: "Lleuger",      met: 3.5 },
  vlow:   { label: "Molt lleuger", met: 2.5 },
};
const NEAT = {
  sed:    { label: "Sedentari (estudi/oficina, < 5.000 passos)", f: 1.2 },
  light:  { label: "Poc actiu (5.000–8.000 passos)",            f: 1.3 },
  active: { label: "Actiu (8.000–12.000 passos)",                f: 1.4 },
  vactive:{ label: "Molt actiu (feina física, > 12.000 passos)", f: 1.55 },
};

function computeTargets(pr) {
  const w = +pr.weight || 0, h = +pr.height || 0, a = +pr.age || 0;
  if (!w || !h || !a) return null;
  const bf = +pr.bodyFat || 0;
  let bmr, bmrMethod;
  if (bf > 3 && bf < 60) { bmr = 370 + 21.6 * w * (1 - bf / 100); bmrMethod = "Katch-McArdle"; }
  else { bmr = 10 * w + 6.25 * h - 5 * a + (pr.sex === "f" ? -161 : 5); bmrMethod = "Mifflin-St Jeor"; }
  const neat = (NEAT[pr.neat] || NEAT.light).f;
  const met = (INTENSITY[pr.intensity] || INTENSITY.mod).met;
  const n = Math.max(0, +pr.sessions || 0), hrs = Math.max(0, +pr.hours || 0);
  const sessionKcal = Math.max(0, (met - 1) * w * hrs);        // despesa extra d'una sessió
  const exDaily = sessionKcal * n / 7;
  const tdee = bmr * neat + exDaily;
  const goal = GOALS[pr.goal] || GOALS.maint;
  let kcal = tdee * (1 + goal.adj) + (+pr.manualAdj || 0);
  let floored = false;
  if (kcal < bmr) { kcal = bmr; floored = true; }
  const prot = goal.prot * w;
  const fat = Math.max(goal.fat * w, (kcal * 0.2) / 9);
  const carbs = Math.max(0, (kcal - prot * 4 - fat * 9) / 4);

  // Ajustos per tipus de dia (equilibrats per mantenir la mitjana setmanal)
  const rest = -0.10;
  const train = n > 0 ? Math.min(0.15, (-rest) * Math.max(0, 7 - n) / n) : 0.08;
  const extra = Math.min(0.20, sessionKcal * (1 + goal.adj) / kcal);
  const dayTypes = {
    normal: { label: "Sense avís (mitjana)", pct: 0, hours: n * hrs / 7 },
    rest:   { label: "No entreno",           pct: rest, hours: 0 },
    easy:   { label: "Entreno suau",         pct: (train + rest) / 2, hours: hrs * 0.7 },
    train:  { label: "Entreno",              pct: train, hours: hrs },
    double: { label: "Entreno doble",        pct: Math.min(0.20, train + extra), hours: hrs * 2 },
    active: { label: "Dia molt actiu (sense gimnàs)", pct: 0, hours: 0.75 },
    refeed: { label: "Refeed / dia alt",     pct: 0.15, hours: hrs },
  };
  return { bmr, bmrMethod, neat, tdee, sessionKcal, kcal, prot, fat, carbs, floored, goal, dayTypes };
}

// Objectiu concret d'un dia: el delta de kcal va als hidrats
function dayTarget(t, typeKey, weight) {
  const dt = t.dayTypes[typeKey] || t.dayTypes.normal;
  const kcal = t.kcal * (1 + dt.pct);
  const carbs = Math.max(0, t.carbs + (kcal - t.kcal) / 4);
  const water = Math.round((35 * (weight || 70) + 500 * dt.hours) / 50) * 50;
  return { kcal, p: t.prot, c: carbs, f: t.fat, water, pct: dt.pct, label: dt.label };
}

// ——— Lectura de text OCR d'una etiqueta nutricional ———
// L'OCR sovint confon "g" amb "9" i perd la coma decimal ("7,1 g" → "719").
// Per cada valor es generen candidats i es tria la combinació que quadra amb les kcal.
function labelCands(tok) {
  const s = tok.replace(",", ".");
  const out = [];
  const add = (v, t) => {
    if (isNaN(v) || v < 0 || v > 100 || out.some(o => Math.abs(o.v - v) < 1e-9)) return;
    const dec = (String(v).split(".")[1] || "").length;
    out.push({ v, pen: t * 15 + (dec >= 2 ? 20 : 0) });
  };
  add(parseFloat(s), 0);
  if (/9$/.test(s) && s.length >= 2) {
    const s2 = s.slice(0, -1).replace(/\.$/, "");
    add(parseFloat(s2), 1);
    if (/^\d{2,}$/.test(s2)) add(parseFloat(s2.slice(0, -1) + "." + s2.slice(-1)), 2);
  }
  if (/^\d{2,}$/.test(s)) add(parseFloat(s.slice(0, -1) + "." + s.slice(-1)), 2);
  return out.sort((a, b) => a.pen - b.pen);
}
function parseLabelText(text) {
  const raw = (text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const lines = raw.map(l => l.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/(\d)\s*[,']\s*(\d)/g, "$1,$2").replace(/(\d)\s+\.\s*(\d)/g, "$1.$2")
    .replace(/[^a-z0-9.,<%/\s]/g, " ").replace(/\s+/g, " ").trim());
  const joined = lines.join(" \n ");
  const out = { kcal: null, p: null, c: null, f: null, sugar: null, fiber: null };

  let m = joined.match(/(\d{1,4}(?:[.,]\d+)?)\s*k\s?ca[l1i]/);
  if (m) out.kcal = parseFloat(m[1].replace(",", "."));
  else if ((m = joined.match(/(\d{2,4}(?:[.,]\d+)?)\s*k\s?j/))) out.kcal = Math.round(parseFloat(m[1].replace(",", ".")) / 4.184);
  if (out.kcal != null && out.kcal > 950) out.kcal = null;

  const tokAfter = (s) => { const mm = s.match(/<?\s*(\d+(?:[.,]\d+)?)/); return mm ? mm[1] : null; };
  const find = (inc, exc) => {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const at = l.search(inc);
      if (at >= 0 && !(exc && exc.test(l))) {
        const t = tokAfter(l.slice(at)) || (lines[i + 1] ? tokAfter(lines[i + 1]) : null);
        if (t) return labelCands(t);
      }
    }
    return null;
  };
  const F = find(/(grasa|grasas|greix|greixos|lipid|matieres grasses|fat)/, /(satur|mono|poli|poly|trans)/);
  const Cc = find(/(hidrat|carbohidrat|carbohydrate|glucid)/, /(azucar|sucre|sugar)/);
  const P = find(/(protein|prote)/);
  const Su = find(/(azucar|sucre|sugar)/);
  const Fi = find(/(fibra|fiber|fibre)/);
  if (Fi && Fi.length) out.fiber = Fi[0].v;

  const opts = x => (x && x.length ? x : [{ v: null, pen: 0 }]);
  let best = null;
  for (const p of opts(P)) for (const c of opts(Cc)) for (const f of opts(F)) {
    if ((p.v || 0) + (c.v || 0) + (f.v || 0) > 100.5) continue;
    let cost = p.pen + c.pen + f.pen;
    if (out.kcal != null && (p.v != null || c.v != null || f.v != null)) {
      const calc = 4 * (p.v || 0) + 4 * (c.v || 0) + 9 * (f.v || 0) + 2 * (out.fiber || 0);
      cost += Math.abs(calc - out.kcal) * (p.v != null && c.v != null && f.v != null ? 1 : 0.2);
    }
    if (!best || cost < best.cost) best = { cost, p: p.v, c: c.v, f: f.v };
  }
  if (best) { out.p = best.p; out.c = best.c; out.f = best.f; }
  if (Su && Su.length) { const ok = Su.find(x => out.c == null || x.v <= out.c + 0.05); out.sugar = (ok || Su[0]).v; }

  const computed = (out.p || 0) * 4 + (out.c || 0) * 4 + (out.f || 0) * 9;
  if (out.kcal == null && computed > 0) out.kcal = Math.round(computed + 2 * (out.fiber || 0));
  out.suspicious = out.kcal && computed > 0 ? Math.abs(computed + 2 * (out.fiber || 0) - out.kcal) / out.kcal > 0.2 : false;
  return out;
}

if (typeof module !== "undefined") {
  module.exports = { norm, tokens, searchFoods, parseMealText, parseChunk, splitMealText, toGrams, macrosFor, computeTargets, dayTarget, parseLabelText, GOALS, INTENSITY, NEAT };
}
