# Roadmap : timeline type logiciel d'édition

## Vision

Une timeline multi-pistes où **chaque clip est un bloc visuel distinct** — bordure, coins arrondis, header coloré, sa propre waveform à l'intérieur — positionné en absolu sur sa piste. Comme dans Reaper, Premiere, Audacity 3+. Les clips doivent se **saisir et glisser facilement** : grab du corps pour déplacer, drag des bords pour trimmer, bouton pour couper.

Le "trou" entre deux clips n'a aucune représentation dans la donnée — c'est simplement l'absence de clip.

L'outillage cible : **`interact.js`** pour la mécanique de drag/resize uniquement. La logique métier (modification de l'EDL) reste 100 % chez nous.

---

## ✅ Étape 0 — Modèle EDL en positions absolues *(faite)*

Segment = `{ id, vStart, srcStart, srcEnd, buffer, bufferTrackId }`.
Fonctions migrées dans `src/lib/edl.js` : `makeSegment`, `makeTrack`, `virtualDuration`, `computeVirtualPeaks`, `computeSegmentPeaks` (ajout), `cutRange`, `extractRange`, `insertAt` (mode push-if-needed via `makeSpace`), `virtualToSource`, `ensureAbsolutePositions` (migration des anciens projets).
`src/lib/playback.js` migré aussi (`scheduleTracks`, `scheduleTrackFrom`).

---

## ✅ Étape 1 — Rendu custom : clips visuellement séparés *(faite)*

Wavesurfer retiré. Hiérarchie actuelle :

```
TrackView
└── Lane (position: relative, mesurée via ResizeObserver → pxPerSec)
    ├── TimelineAxis (per-track, va disparaître à l'étape 2)
    ├── Clip × N (position: absolute via vStart×pxPerSec)
    │   ├── Header (bandeau cyan foncé)
    │   └── ClipWaveform (canvas peaks)
    ├── SelectionOverlay
    └── Playhead
```

Composants dans `src/trackview/`. Inset 1px horizontal + 2px vertical entre clips, drop shadow, header de 12px → séparation visuelle nette.

---

## ⏳ Étape 2 — Graduation globale + Bouton split

Deux changements UI qui doivent venir avant le drag, parce que le drag aura besoin d'un repère temporel partagé entre toutes les pistes.

### 2.1 Graduation globale (une seule, en haut)

**Problème actuel** : chaque `TrackView` rend sa propre `TimelineAxis`. En multi-pistes, on voit N graduations empilées — bruit visuel.

**Cible** : une seule graduation tout en haut, alignée avec les lanes des pistes en-dessous.

#### Fichiers à toucher

- **`src/AudioRecorder.jsx`** : ajouter un row en haut de la liste de pistes, avec la même structure de colonnes (flex:1 pour la lane, divider, placeholder pour la zone nom/boutons). Ce row contient `<TimelineAxis />` dans sa partie flex:1.
- **`src/TrackView.jsx`** : retirer le `<TimelineAxis />` interne.

#### Le défi : `pxPerSec` partagé

Aujourd'hui chaque `TrackView` mesure sa propre lane via `ResizeObserver` et calcule son `pxPerSec`. Avec une graduation au niveau `AudioRecorder`, deux options :

**Option A — Centraliser (recommandé)** : `AudioRecorder` mesure une seule fois (sur un ref placé dans la colonne flex:1 du row de graduation), calcule `pxPerSec`, le passe en prop à `TimelineAxis` ET à chaque `TrackView`. Les `TrackView` n'ont plus de `ResizeObserver` à eux.

```jsx
// AudioRecorder.jsx
const laneRef = useRef(null);
const [laneWidth, setLaneWidth] = useState(0);
const pxPerSec = projectDuration > 0 ? laneWidth / projectDuration : 0;

useEffect(() => {
  const el = laneRef.current;
  if (!el) return;
  setLaneWidth(el.clientWidth);
  const ro = new ResizeObserver(([e]) => setLaneWidth(e.contentRect.width));
  ro.observe(el);
  return () => ro.disconnect();
}, []);

// Dans le JSX :
<Stack direction="row" spacing={1}>
  <Box ref={laneRef} sx={{ flex: 1, minWidth: 0 }}>
    <TimelineAxis projectDuration={projectDuration} pxPerSec={pxPerSec} />
  </Box>
  <Divider orientation="vertical" flexItem />
  <Box sx={{ paddingRight: 7, minWidth: 60, maxWidth: 60 }} />
</Stack>

{tracks.map((t) => (
  <TrackView ... pxPerSec={pxPerSec} />
))}
```

`TrackView` reçoit `pxPerSec` en prop, retire son state local + son `useEffect` de mesure.

**Option B — Décentraliser** : la graduation et chaque track ont leur propre `ResizeObserver`. Tous arrivent au même `pxPerSec` parce qu'ils partagent la même structure de layout. Plus de duplication mais zéro coordination à gérer.

Recommandation : **option A**, plus propre et évite des `ResizeObserver` redondants.

### 2.2 Bouton "Split"

Remplace le raccourci clavier `S` / `Shift+S` prévu initialement.

#### Fichiers à toucher

- **`src/AudioRecorder.jsx`** : ajouter une icône dans la barre d'outils + un handler `splitAtSelection`.

#### Code

Ajouter l'import :
```jsx
import ContentCutIcon from "@mui/icons-material/ContentCutOutlined"; // déjà importé pour cut
import { splitAt } from "./lib/edl"; // exposer splitAt depuis edl.js
```

(Ajouter `splitAt` aux exports de `edl.js` si pas déjà fait.)

Handler :
```jsx
const splitAtSelection = () => {
  if (!selection) return;
  const { trackId, time } = selection;
  setTracksWithHistory((ts) =>
    ts.map((t) =>
      t.id === trackId ? { ...t, edl: splitAt(t.edl, time) } : t
    )
  );
};
```

Bouton dans la toolbar (à côté de Cut/Copy/Paste) :
```jsx
<IconButton
  size="small"
  onClick={splitAtSelection}
  disabled={!selection}
  title="Split at cursor"
>
  <ContentCutIcon fontSize="small" /> {/* ou une autre icône, voir ci-dessous */}
</IconButton>
```

Icône suggérée : `ContentCutIcon` est déjà prise par "Cut" (qui supprime la sélection). Pour "Split", utiliser plutôt `CallSplitIcon` ou `HorizontalRuleIcon` de `@mui/icons-material`. À toi de voir.

#### Comportement

- Disabled si pas de `selection` (curseur posé).
- Au clic : `splitAt(track.edl, selection.time)` → le clip qui contenait `selection.time` est remplacé par deux clips collés. Visuellement on voit immédiatement les deux blocs séparés (l'inset de 1px crée le gap natif).
- Passe par l'historique undo/redo (`setTracksWithHistory`).

### Critère de sortie de l'étape 2

- Une seule graduation en haut de toutes les pistes, ticks parfaitement alignés avec les clips en-dessous.
- Bouton split dans la toolbar, désactivé sans curseur, qui coupe le clip sous le curseur en deux blocs visuellement séparés.

---

## ✅ Étape 3 — Drag horizontal d'un clip *(faite)*

`interactjs` est branché sur chaque `Clip` en mode `.draggable()`. Pendant le drag,
on bouge via `transform: translateX(...)` (zéro re-render) ; à `end`, on commit
via `moveSegment` (ajouté dans `edl.js`) → `moveClip` dans `AudioRecorder` →
`setTracksWithHistory`. Le `trackId` parent est passé par prop depuis `TrackView`
(pas `segment.bufferTrackId`, qui n'existe que pour les clips collés).

Anti-overlap : `TrackView` calcule un map `clipBounds` (memoizé sur `track.edl`)
qui donne `{minVStart, maxVStart}` par segment à partir de ses voisins. `Clip` lit
ces bornes via une `ref` (pour ne pas réattacher interact.js si l'edl change) et
clampe `dragDxRef.current` en live dans le listener `move`.

Conflit avec la sélection-région de la lane résolu : `onLanePointerDown` détecte
`closest('[data-clip-id]')` et marque `startedOnClip` — dans ce cas la lane ne
capture pas le pointeur et `onLanePointerMove`/`Up` bypassent leur logique.

### Premier comportement vraiment interactif

Saisir un clip, le déplacer dans sa piste, ça crée ou comble un trou.

### Installation

```bash
npm install interactjs
```

### Fichiers à toucher

- **`src/trackview/Clip.jsx`** : attacher `interact()` au ref du clip pour `draggable`.
- **`src/AudioRecorder.jsx`** : exposer un callback `onClipMove(trackId, segId, deltaSec)` qui met à jour l'EDL.
- **`src/lib/edl.js`** : ajouter `moveSegment(edl, segId, deltaSec)` (simple : `seg.vStart += deltaSec`, clampé à `≥ 0`).

### Snippet `Clip.jsx`

```jsx
import interact from "interactjs";

const ref = useRef(null);
const dragDxRef = useRef(0);

useEffect(() => {
  const el = ref.current;
  interact(el).draggable({
    modifiers: [
      interact.modifiers.restrictRect({ restriction: "parent" }),
    ],
    listeners: {
      start() { el.classList.add("dragging"); },
      move(e) {
        dragDxRef.current += e.dx;
        el.style.transform = `translateX(${dragDxRef.current}px)`;
      },
      end() {
        const deltaSec = dragDxRef.current / pxPerSec;
        el.style.transform = "";
        el.classList.remove("dragging");
        dragDxRef.current = 0;
        onMove?.(segment.id, deltaSec);
      },
    },
  });
  return () => interact(el).unset();
}, [pxPerSec, onMove, segment.id]);
```

Pendant le drag : `transform` uniquement (60 fps, pas de re-render React). À `end` : on commit dans l'état, le re-render repositionne le clip à sa place "officielle" et on remet `transform = ""`.

### Gestion des overlaps (v1)

Calculer dynamiquement les bornes `restrictRect` depuis les voisins du clip dans son EDL : le clip ne peut pas chevaucher le voisin gauche ni le voisin droit. Empêche les overlaps à la souris.

### Critère de sortie

- Splitter un clip avec le bouton, puis drag le morceau de droite → un trou propre apparaît, la lecture y est silencieuse.
- Drag fluide (transform CSS), pas saccadé.
- Impossible de chevaucher un voisin.

---

## ⏳ Étape 4 — Trim des bords (resize)

Même mécanique qu'étape 3 mais avec `interact.js .resizable()` au lieu de `.draggable()`.

### Snippet `Clip.jsx`

```js
interact(el).resizable({
  edges: { left: true, right: true, top: false, bottom: false },
  listeners: {
    move(e) {
      el.style.transform = `translateX(${e.deltaRect.left}px)`;
      el.style.width = `${e.rect.width}px`;
    },
    end(e) {
      const deltaLeft = e.deltaRect.left / pxPerSec;
      const deltaRightTotal = (e.rect.width - originalWidthPx) / pxPerSec;
      const deltaRight = deltaRightTotal - deltaLeft;
      el.style.transform = "";
      el.style.width = "";
      onTrim?.(segment.id, deltaLeft, deltaRight);
    },
  },
});
```

### Logique métier (`edl.js`)

```js
export function trimSegment(edl, segId, deltaLeft, deltaRight) {
  return edl.map((s) => {
    if (s.id !== segId) return s;
    const newSrcStart = Math.max(0, s.srcStart + deltaLeft);
    const newVStart = Math.max(0, s.vStart + deltaLeft);
    const newSrcEnd = Math.min(/* buffer.duration */ Infinity, s.srcEnd + deltaRight);
    if (newSrcEnd <= newSrcStart) return s;
    return { ...s, vStart: newVStart, srcStart: newSrcStart, srcEnd: newSrcEnd };
  });
}
```

Note : trim gauche déplace **à la fois** `vStart` et `srcStart` du même Δ → le bord droit reste fixe visuellement, le clip "démarre plus tard" dans la source ET dans la timeline. Trim droit ne touche que `srcEnd`.

### Critère de sortie

- Cursor `ew-resize` sur les 6-8 px des bords gauche/droit.
- Trim au-delà du buffer source → bloqué.
- Combinaison trim + drag fonctionne sans conflit.

---

## ⏳ Étape 5 — Drag inter-pistes

Saisir un clip dans la piste A, le déposer dans la piste B. Aujourd'hui le drag est verrouillé en X dans `Clip.jsx` (`transform: translateX(...)`), et les bornes anti-overlap (`clipBounds` dans `TrackView.jsx`) ne connaissent que la piste courante. Cette étape débloque l'axe Y, détecte la lane survolée par hit-test DOM, et étend `moveClip` pour bouger un segment d'une piste à une autre.

### Vue d'ensemble

Pendant le drag :
1. `Clip.jsx` applique `translate(X, Y)` au lieu de seulement `translateX(X)`.
2. À chaque `move`, hit-test via `document.elementFromPoint` pour trouver la lane survolée (taguée `data-lane-id`).
3. Si la lane survolée n'est pas la piste source, on relâche le clamp X et on affiche un highlight.

À `end` :
4. Si même piste → on garde le chemin actuel (`onMove(trackId, segId, deltaSec)` → `moveSegment` dans `edl.js`).
5. Si piste différente → nouvel appel `onMoveAcrossTracks(srcTrackId, dstTrackId, segId, newVStart)`. L'EDL source perd le segment, l'EDL cible le reçoit, `buffer` et `bufferTrackId` sont préservés (voir le commentaire en `src/lib/edl.js:9` sur pourquoi ces deux champs sont liés).

### Fichiers à toucher

- **`src/TrackView.jsx`** : ajouter `data-lane-id={track.id}` sur le `Box` `laneRef` (ligne 162). Permet le hit-test depuis `Clip.jsx` sans contexte React.
- **`src/trackview/Clip.jsx`** : modifier le `draggable` pour autoriser Y, faire le hit-test, et router vers le bon callback à `end`. Ajouter une prop `onMoveAcrossTracks`.
- **`src/lib/edl.js`** : ajouter `removeSegment(edl, segId)` et `insertSegmentAt(edl, seg, vStart)`. (On ne réutilise pas `insertAt`, qui shifte les segments à droite via `makeSpace` ; ici on veut juste placer le segment et **bloquer** si overlap dans la cible — comportement v1.)
- **`src/AudioRecorder.jsx`** : ajouter le handler `moveClipAcrossTracks` (parallèle à `moveClip`, ligne 315), le passer en prop à `TrackView`, qui le re-passe à chaque `Clip`.

### 5.1 — Tag des lanes

Dans `src/TrackView.jsx`, sur le `Box` `ref={laneRef}` (lignes 161-176), ajouter :

```jsx
<Box
    ref={laneRef}
    data-lane-id={track.id}
    onPointerDown={onLanePointerDown}
    ...
>
```

C'est tout pour ce fichier (à part le pass-through de `onClipMoveAcrossTracks` aux `<Clip />` plus bas).

### 5.2 — Drag libre + hit-test dans `Clip.jsx`

Aujourd'hui le `move` listener (lignes 43-52) clampe `dragDxRef.current` contre `boundsRef.current` et applique `translateX`. On bascule sur `translate(X, Y)` et on déduit la lane survolée à chaque frame via `document.elementFromPoint`.

Ajouter des refs en haut du composant :

```jsx
const dragDyRef = useRef(0);
const hoveredTrackIdRef = useRef(trackId); // commence sur la piste source
```

Modifier le `draggable` :

```jsx
interact(el).draggable({
    listeners: {
        start() {
            el.classList.add("dragging");
            // Élève le clip au-dessus des autres pendant le drag pour qu'il
            // passe visuellement par-dessus les autres lanes.
            el.style.zIndex = "10";
            el.style.pointerEvents = "none"; // pour que elementFromPoint voie la lane sous le clip
        },
        move(e) {
            dragDxRef.current += e.dx;
            dragDyRef.current += e.dy;

            // Hit-test : trouve la lane sous le pointeur.
            const under = document.elementFromPoint(e.client.x, e.client.y);
            const laneEl = under?.closest("[data-lane-id]");
            const overTrackId = laneEl?.dataset.laneId ?? hoveredTrackIdRef.current;
            const sameTrack = overTrackId === trackId;
            hoveredTrackIdRef.current = overTrackId;

            // Clamp X seulement quand on est encore sur la piste source.
            // Sur une autre piste, on autorise tout (la validation se fait à end).
            if (sameTrack) {
                const b = boundsRef.current;
                if (b && pxPerSec > 0) {
                    const newVStart = vStartRef.current + dragDxRef.current / pxPerSec;
                    const clamped = Math.max(b.minVStart, Math.min(b.maxVStart, newVStart));
                    dragDxRef.current = (clamped - vStartRef.current) * pxPerSec;
                }
            }

            el.style.transform = `translate(${dragDxRef.current}px, ${dragDyRef.current}px)`;

            // Highlight de la lane cible (sauf si c'est la source).
            document.querySelectorAll("[data-lane-id].drop-target")
                .forEach((n) => n.classList.remove("drop-target"));
            if (!sameTrack && laneEl) {
                laneEl.classList.add("drop-target");
            }
        },
        end(e) {
            const dstTrackId = hoveredTrackIdRef.current;
            const deltaSec = pxPerSec > 0 ? dragDxRef.current / pxPerSec : 0;

            // Reset visuel.
            el.style.transform = "";
            el.style.zIndex = "";
            el.style.pointerEvents = "";
            el.classList.remove("dragging");
            document.querySelectorAll("[data-lane-id].drop-target")
                .forEach((n) => n.classList.remove("drop-target"));
            dragDxRef.current = 0;
            dragDyRef.current = 0;
            hoveredTrackIdRef.current = trackId;

            if (dstTrackId === trackId) {
                // Drag intra-piste : chemin actuel.
                if (Math.abs(deltaSec) > 0.001) {
                    onMove?.(trackId, segment.id, deltaSec);
                }
            } else {
                // Drag inter-piste : nouveau vStart = position absolue dans la cible.
                // Le X-pixel courant du clip à end() = segment.vStart * pxPerSec + dragDx
                // (interact.js a remis le rect d'origine à end, donc on recalcule depuis vStart).
                const newVStart = Math.max(0, segment.vStart + deltaSec);
                onMoveAcrossTracks?.(trackId, dstTrackId, segment.id, newVStart);
            }
        },
    },
});
```

Et déstructurer la nouvelle prop dans la signature du composant :

```jsx
export default function Clip({ segment, trackId, trackBuffer, pxPerSec, isSelected, onMove, onMoveAcrossTracks, onClipTrim, bounds }) {
```

Penser à ajouter `onMoveAcrossTracks` aux dépendances du `useEffect` (ligne 101).

#### CSS pour le highlight

Le plus simple : injecter une règle globale dans `src/index.css` (ou ajouter inline via `sx` impossible ici puisqu'on cible une classe). Exemple :

```css
[data-lane-id].drop-target {
    background: rgba(34, 173, 197, 0.12) !important;
    box-shadow: inset 0 0 0 2px rgba(34, 173, 197, 0.6);
}
```

### 5.3 — Helpers EDL

Dans `src/lib/edl.js`, ajouter au bas du fichier :

```js
// Retire un segment d'une EDL. Pas de "ripple" : les voisins ne bougent pas,
// le trou laissé est intentionnel (sémantique du modèle absolu).
export function removeSegment(edl, segId) {
    return edl.filter((s) => s.id !== segId);
}

// Insère un segment existant dans une EDL à la position vStart absolue.
// V1 : si le placement chevauche un voisin, on retourne l'edl inchangée
// (le caller doit avoir clampé ou bloqué l'opération). On ne push pas les
// voisins automatiquement, contrairement à insertAt() qui sert pour le paste.
export function insertSegmentAt(edl, seg, vStart) {
    const dur = seg.srcEnd - seg.srcStart;
    const vEnd = vStart + dur;
    const overlaps = edl.some((s) => {
        const sEnd = s.vStart + (s.srcEnd - s.srcStart);
        return !(sEnd <= vStart || s.vStart >= vEnd);
    });
    if (overlaps) return edl;
    const placed = { ...seg, vStart };
    return [...edl, placed].sort((a, b) => a.vStart - b.vStart);
}
```

Pourquoi pas `insertAt` ? `insertAt` pousse les segments à droite via `makeSpace` (cf. `src/lib/edl.js:181`), ce qui a du sens pour un paste mais pas pour un déplacement libre — l'utilisateur attend que son clip "atterrisse" où il l'a lâché, pas que la cible se réorganise.

### 5.4 — Handler `moveClipAcrossTracks` dans `AudioRecorder.jsx`

À côté de `moveClip` (ligne 315), ajouter :

```jsx
const moveClipAcrossTracks = (srcTrackId, dstTrackId, segId, newVStart) => {
    if (srcTrackId === dstTrackId) return;
    const srcTrack = tracks.find((t) => t.id === srcTrackId);
    if (!srcTrack) return;
    const seg = srcTrack.edl.find((s) => s.id === segId);
    if (!seg) return;

    // Préserve buffer + bufferTrackId. Si le segment n'en avait pas (= clip
    // "natif" de la piste source), on les remplit maintenant : sinon le segment
    // basculerait sur le buffer de la piste cible et lirait le mauvais son.
    const portableSeg = {
        ...seg,
        buffer: seg.buffer ?? srcTrack.buffer,
        bufferTrackId: seg.bufferTrackId ?? srcTrack.id,
    };

    setTracksWithHistory((ts) =>
        ts.map((t) => {
            if (t.id === srcTrackId) {
                return { ...t, edl: removeSegment(t.edl, segId) };
            }
            if (t.id === dstTrackId) {
                const next = insertSegmentAt(t.edl, portableSeg, newVStart);
                // Si l'insertion a échoué (overlap), on bail : on ne veut pas
                // perdre le segment côté source. La double-map ci-dessus serait
                // alors retournée incohérente — on détecte ce cas en amont.
                return { ...t, edl: next };
            }
            return t;
        })
    );
};
```

Et importer les helpers en haut du fichier (ligne 29) :

```jsx
import { cutRange, extractRange, insertAt, splitAt, moveSegment, trimSegment, removeSegment, insertSegmentAt } from "./lib/edl";
```

#### Le cas "overlap dans la cible"

`insertSegmentAt` retourne l'edl inchangée en cas de chevauchement. Mais la branche source supprime tout de même le segment → on perdrait le clip. Deux options :

**Option A (recommandée, simple)** : pré-vérifier l'overlap avant la mutation. Si conflit, on ne fait rien (le clip retombe à sa place de départ, le drag est "annulé").

```jsx
const dstTrack = tracks.find((t) => t.id === dstTrackId);
if (!dstTrack) return;
const dur = portableSeg.srcEnd - portableSeg.srcStart;
const conflict = dstTrack.edl.some((s) => {
    const sEnd = s.vStart + (s.srcEnd - s.srcStart);
    return !(sEnd <= newVStart || s.vStart >= newVStart + dur);
});
if (conflict) return; // optionnel : feedback visuel rouge bref sur la cible
```

**Option B (plus tard)** : clamp `newVStart` au plus proche trou libre dans la cible avant l'insert. Plus de friction pour l'utilisateur, plus de code. À garder pour l'étape 6 (snapping).

### 5.5 — Câblage prop `onMoveAcrossTracks`

Dans `AudioRecorder.jsx`, passer le handler au `<TrackView>` (ligne 435-449) :

```jsx
<TrackView
    ...
    onClipMove={moveClip}
    onClipMoveAcrossTracks={moveClipAcrossTracks}
    onClipTrim={trimClip}
/>
```

Dans `TrackView.jsx`, accepter la prop et la transmettre au `<Clip>` (lignes 18-30 pour la signature, 184-194 pour le rendu) :

```jsx
// signature
onClipMove,
onClipMoveAcrossTracks,
onClipTrim,

// rendu
<Clip
    ...
    onMove={onClipMove}
    onMoveAcrossTracks={onClipMoveAcrossTracks}
    onClipTrim={onClipTrim}
    bounds={clipBounds[seg.id]}
/>
```

### Critère de sortie

- Drag d'un clip de la piste 1 vers la piste 2 → il disparaît de 1 et apparaît dans 2 à la position de drop, avec le **bon son** (le buffer de la piste 1 voyage avec lui).
- Drag intra-piste continue de fonctionner exactement comme avant (pas de régression sur l'étape 3).
- Highlight visible sur la lane cible pendant le survol, disparaît à `end`.
- Drop sur une zone qui overlappe un clip cible → le clip revient à sa position de départ, rien ne bouge (v1).
- Save/reload du projet (cf. `useProjectPersistence`) → le clip déplacé continue de lire le bon son grâce à `bufferTrackId` (qui pointe vers la piste source dans le fichier projet).
- Undo/Redo couvre l'opération (déjà acquis via `setTracksWithHistory`).

---

## ⏳ Étape 6 — Polish : snapping, ripple, raccourcis

### Snapping

Modifier dynamique sur `interact.js` qui retourne :
- `vStart` et `vStart + dur` des autres clips (toutes pistes confondues)
- playhead courant
- 0 (début timeline)
- bord opposé du clip en cours de drag

```js
modifiers: [
  interact.modifiers.snap({
    targets: [() => collectSnapPoints(allTracks, playheadTime).map((t) => ({
      x: t * pxPerSec,
      range: 8,
    }))],
  }),
]
```

UX : un guide vertical fin qui apparaît au moment du snap.

### Mode ripple

Variante de drag/delete qui pousse les voisins. À activer via modifier (par exemple `Shift+drag = ripple`).

### Raccourcis

- `Suppr` : supprime le clip sélectionné.
- `Ctrl+Z` / `Ctrl+Y` : déjà en place, vérifier qu'ils couvrent split/move/trim.
- Flèches : nudge ±10 ms du clip sélectionné.

---

## Récapitulatif

| # | Étape | État | Effort |
|---|-------|------|--------|
| 0 | EDL absolu + helpers | ✅ Fait | — |
| 1 | Rendu custom + clips visuels | ✅ Fait | — |
| 2 | Graduation globale + bouton Split | ⏳ À faire | Faible |
| 3 | Drag horizontal des clips | ✅ Fait | — |
| 4 | Trim des bords | ⏳ À faire | Faible |
| 5 | Drag inter-pistes | ⏳ À faire | Moyen-élevé |
| 6 | Snapping & polish | ⏳ À faire | Faible |

Ordre recommandé : strictement séquentiel. Chaque étape construit sur la précédente. L'étape 2 (graduation + bouton split) est la prochaine à faire — petite mais débloque le sentiment "vraie timeline pro" avant d'attaquer le drag de l'étape 3.
