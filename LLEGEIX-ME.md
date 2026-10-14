# Macros — app de kcal, macros i aigua

App web instal·lable (PWA). Gratuïta, sense comptes: totes les dades es guarden al dispositiu.

## Publicar-la gratis (GitHub Pages, un sol cop)

1. Crea un compte gratuït a https://github.com (només serveix per allotjar els fitxers; l'app no s'hi vincula).
2. **New repository** → nom `macros` → **Public** → **Create repository**.
3. Clica **uploading an existing file** i arrossega-hi **tot el contingut** d'aquesta carpeta (inclosa la carpeta `icons`). **Commit changes**.
4. **Settings → Pages** → *Source*: **Deploy from a branch** → branca `main`, carpeta `/ (root)` → **Save**.
5. En 1–2 minuts l'app és a `https://EL-TEU-USUARI.github.io/macros/`.

## Instal·lar-la al mòbil

- **Android (Chrome):** obre l'enllaç → menú ⋮ → **Instal·la l'aplicació**.
- **iPhone (Safari):** obre l'enllaç → **Compartir** → **Afegir a la pantalla d'inici**.

Un cop oberta la primera vegada funciona sense connexió. La lectura d'etiquetes baixa uns 10 MB el primer cop que s'utilitza i després també funciona sense connexió.

## Dictat per veu

A **Menjar** (o amb el botó **Dicta** d'Avui) toca el micròfon i digues el que has menjat: *"per dinar dos-cents grams de pollastre, cinquanta de pebrot i cent cinquanta d'arròs"*. Detecta l'àpat, entén números dits amb paraules i ho calcula sol. L'idioma (català o castellà) es tria a Perfil. Fa servir el reconeixement de veu del navegador (gratuït; cal connexió). Si el navegador no el permet, el micròfon del teclat del mòbil fa el mateix.

## Passar les dades a l'ordinador

Perfil → **Exporta còpia** (fitxer .json) → a l'altre dispositiu, Perfil → **Importa còpia**.

## Actualitzar l'app

Puja els fitxers nous al mateix repositori (substitueixen els antics). Les dades no es perden.

## Fitxers

| Fitxer | Contingut |
|---|---|
| `index.html`, `styles.css` | Estructura i disseny |
| `app.js` | Pantalles: Avui, Menjar, Aliments, Estadístiques, Perfil |
| `core.js` | Càlculs: cerca d'aliments, lectura del text dels menjars, objectius, lectura d'etiquetes |
| `foods.js` | ~140 aliments genèrics (valors per 100 g) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instal·lació i funcionament sense connexió |

## Com calcula l'objectiu

- **Metabolisme basal:** Mifflin-St Jeor, o Katch-McArdle si poses el % de greix.
- **Despesa:** basal × activitat fora del gimnàs + (MET de la intensitat − 1) × pes × hores × entrenos/setmana ÷ 7.
- **Objectiu:** volum +15 %, volum lleuger +8 %, manteniment 0, dèficit lleuger −12 %, dèficit −20 %. Mai per sota del basal.
- **Macros:** proteïna 1,8–2,2 g/kg segons objectiu, greix 0,8–0,9 g/kg (mínim 20 % de les kcal), la resta hidrats.
- **Avís del dia:** no entreno −10 %; entreno i entreno doble s'ajusten perquè la mitjana setmanal quedi a l'objectiu. Només canvien els hidrats.
- **Aigua:** 35 ml/kg + 0,5 L per hora d'entreno del dia.
