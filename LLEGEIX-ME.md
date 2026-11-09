# Rècord — dieta i gimnàs (kcal, macros, aigua i entrenaments)

App web instal·lable (PWA) i gratuïta. Les dades es guarden al dispositiu i, si inicies sessió, també al núvol (Firebase): així tens el mateix historial al mòbil nou o a l'ordinador.

## Publicar-la gratis (GitHub Pages, un sol cop)

1. Crea un compte gratuït a https://github.com (només serveix per allotjar els fitxers; l'app no s'hi vincula).
2. **New repository** → nom `macros` → **Public** → **Create repository**.
3. Clica **uploading an existing file** i arrossega-hi **tot el contingut** d'aquesta carpeta (inclosa la carpeta `icons`). **Commit changes**.
4. **Settings → Pages** → *Source*: **Deploy from a branch** → branca `main`, carpeta `/ (root)` → **Save**.
5. En 1–2 minuts l'app és a `https://EL-TEU-USUARI.github.io/macros/`.

## Compte i sincronització (Firebase, gratuït, un sol cop)

Sense aquest pas l'app funciona igual, però sense inici de sessió (dades només al dispositiu).

1. Entra a https://console.firebase.google.com amb el teu compte de Google → **Crea un projecte** → nom `macros` → Google Analytics: **no** → crea'l. Pla **Spark** (gratuït, no demana targeta).
2. Menú **Compila / Build → Authentication** → **Comença** → pestanya **Mètode d'inici de sessió** → **Correu electrònic/contrasenya** → activa el primer interruptor → **Desa**.
3. A **Authentication → Configuració → Dominis autoritzats** → **Afegeix un domini** → `EL-TEU-USUARI.github.io`.
4. Menú **Compila / Build → Firestore Database** → **Crea una base de dades** → ubicació a Europa (p. ex. `europe-southwest1`, Madrid) → **mode de producció** → crea-la.
5. A Firestore, pestanya **Regles**, substitueix-ho tot per això i prem **Publica**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

6. Engranatge ⚙ → **Configuració del projecte** → a baix, **Les teves apps** → icona web `</>` → nom `macros` → **Registra l'app**. Et mostra un bloc `firebaseConfig`. Copia'n `apiKey`, `authDomain`, `projectId` i `appId`.
7. A GitHub, obre `firebase-config.js` al teu repositori → icona del llapis → enganxa els 4 valors entre les cometes → **Commit changes**.

El primer cop que entres en un dispositiu poses usuari i contrasenya; després la sessió queda guardada i l'app entra sola (també sense connexió). Només la tornaràs a posar si tanques la sessió, si esborres les dades del navegador o en un dispositiu nou.

Primer cop:
- **Al mòbil que ja fas servir:** obre l'app → **Crea un compte nou** (usuari i contrasenya). Les dades que ja tens es pugen al núvol.
- **A l'ordinador o al mòbil nou:** **Inicia sessió** amb el mateix usuari.

Apunta't la contrasenya: no hi ha correu associat i no es pot recuperar (sí que la pots canviar des de Perfil si recordes l'actual). Opcional: un cop creat el teu compte, a **Authentication → Configuració → Accions dels usuaris** pots desactivar **Permet crear comptes** perquè ningú més en pugui crear al teu projecte.

La clau `apiKey` no és secreta (totes les apps web de Firebase la porten): el que protegeix les dades són les regles del pas 5, que només deixen llegir i escriure a cada usuari les seves.

Les dades se sincronitzen soles: en desar, en obrir l'app i cada minut mentre la tens oberta. Sense connexió segueix funcionant i ho puja quan en tornes a tenir. Si edites el mateix dia des de dos dispositius alhora, els menjars de tots dos s'ajunten.

## Instal·lar-la al mòbil

- **Android (Chrome):** obre l'enllaç → menú ⋮ → **Instal·la l'aplicació**.
- **iPhone (Safari):** obre l'enllaç → **Compartir** → **Afegir a la pantalla d'inici**.

Un cop oberta la primera vegada funciona sense connexió. La lectura d'etiquetes baixa uns 10 MB el primer cop que s'utilitza i després també funciona sense connexió.

## Dictat per veu

A **Menjar** (o amb el botó **Dicta** d'Avui) toca el micròfon i digues el que has menjat: *"per dinar dos-cents grams de pollastre, cinquanta de pebrot i cent cinquanta d'arròs"*. Detecta l'àpat, entén números dits amb paraules i ho calcula sol. L'idioma (català o castellà) es tria a Perfil. Fa servir el reconeixement de veu del navegador (gratuït; cal connexió). Si el navegador no el permet, el micròfon del teclat del mòbil fa el mateix.

## Gimnàs

- **Entrenar:** plantilles amb exercicis, sèries (escalfament W, RIR n, fallo F, drop set D), repeticions objectiu i descans. **Comença** obre la sessió: cada sèrie té kg, repes i RIR, i en gris surt el que vas fer l'últim cop. Si marques ✓ sense escriure res, copia els valors de l'últim cop. En marcar una sèrie comença el descans (sona i vibra en acabar). La sessió en curs es guarda contínuament: si tanques l'app, en tornar-la a obrir hi segueixes.
- En **finalitzar**, si l'avís del dia era «Sense avís» o «No entreno», passa a «Entreno» (o «Entreno doble» si és la segona sessió) perquè les macros ho tinguin en compte.
- **Supersets:** marca «Superset amb l'anterior» a la plantilla. El descans és el de cada exercici (posa 0 al primer per encadenar-los).
- **Exercicis:** ~750 exercicis amb foto del moviment i músculs principals i secundaris. Toca el nom de qualsevol exercici (també durant la sessió) per veure'n la fitxa. Pots posar-li el teu propi nom i crear exercicis propis.
- **Progrés:** sèries per múscul dels últims 7 dies, i per a cada exercici la RM estimada, el pes màxim, el volum, els rècords per repeticions i l'historial.
- **RM·RIR:** posa pes, repes i RIR d'una sèrie: et dona la RM estimada, quantes repes faries amb un altre pes a cada RIR i quin pes usar per a cada nombre de repes.
- Fotos dels exercicis: free-exercise-db (domini públic). Es baixen el primer cop que les veus i després funcionen sense connexió.

## Si les dades desapareixen

- Obre sempre l'app des de la **icona instal·lada**, no des de l'enllaç de WhatsApp ni d'una pestanya: els navegadors integrats d'altres apps esborren les dades.
- A **Perfil → App i dades** hi ha l'estat: com està oberta, si les dades estan protegides i quan s'han desat per últim cop.
- Exporta una còpia de tant en tant.

## Còpia manual

Perfil → **Exporta còpia** (fitxer .json, inclou els entrenaments) → **Importa còpia** per recuperar-la.

## Actualitzar l'app

Puja els fitxers nous al mateix repositori (substitueixen els antics). Les dades no es perden.

## Fitxers

| Fitxer | Contingut |
|---|---|
| `index.html`, `styles.css` | Estructura i disseny |
| `app.js` | Pantalles: Avui, Menjar, Aliments, Gràfics, Perfil |
| `gym.js`, `gym-db.js` | Gimnàs: plantilles, sessions, historial, exercicis, progrés, calculadora RM/RIR |
| `sync.js`, `firebase-config.js`, `lib/` | Inici de sessió i sincronització (Firebase) |
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
