# Roadmap : timeline type logiciel d'édition

## Vision

Une timeline multi-pistes où **chaque clip est un bloc visuel distinct** — bordure, coins arrondis, sa propre waveform à l'intérieur, son label — positionné en absolu sur sa piste. Comme dans Reaper, Premiere, Audacity 3+. Les clips doivent se **saisir et glisser facilement** à la souris : grab du corps pour déplacer, drag des bords pour trimmer, "S" pour couper en deux.

Différence-clé avec l'état actuel : aujourd'hui une piste = **une** waveform continue rendue par wavesurfer à partir d'une EDL chaînée. Demain une piste = **N blocs-clip indépendants positionnés en absolu**, chacun avec sa propre mini-waveform. Le "trou" entre deux clips n'a pas de représentation dans la donnée — c'est simplement l'absence de clip.

L'outillage : on sort de wavesurfer pour reprendre le contrôle du rendu, et on s'appuie sur **`interact.js`** uniquement pour la mécanique de drag/resize. La logique métier (modification de l'EDL) reste 100 % chez nous.

---

## Étape 0 — Refonte du modèle EDL en positions absolues

Pré-requis structurel. Aucun changement UI visible mais c'est la fondation de tout le reste. C'est l'étape la plus risquée parce qu'elle touche `edl.js`, `playback.js`, et la persistance.

### Nouveau modèle de segment

```js
// avant : segments chaînés, position implicite par concaténation
{ id, srcStart, srcEnd, buffer, bufferTrackId }

// après : position virtuelle explicite, indépendante de l'ordre du tableau
{ id, vStart, srcStart, srcEnd, buffer, bufferTrackId }
```

- `vStart` = position du début du clip sur la timeline virtuelle (en secondes).
- `srcEnd - srcStart` = durée du clip (pas de time-stretch).
- L'absence de clip à un instant = silence naturel.
- Les overlaps sont possibles par construction et doivent être gérés explicitement (interdits en v1, voir étape 3).

### `src/lib/edl.js` — fonctions à réécrire

1. **`makeSegment(vStart, srcStart, srcEnd, buffer, bufferTrackId)`** — signature mise à jour.

2. **`virtualDuration(track)`** → `max(seg.vStart + (seg.srcEnd - seg.srcStart))` sur tous les segments. Si vide → 0.

3. **`computeVirtualPeaks(buffer, edl, targetLen, totalDur)`** — au lieu de remplir les bins en concaténant dans l'ordre du tableau, on remplit la portion `[seg.vStart, seg.vStart + dur]` pour chaque segment. Le reste reste à 0 (= silence naturel).

4. **`cutRange(edl, vStart, vEnd)`** — pour chaque segment chevauchant `[vStart, vEnd]`, retire la portion couverte et garde 0, 1 ou 2 sous-segments selon le cas. Les autres segments ne bougent pas (pas de ripple par défaut).

5. **`extractRange(edl, vStart, vEnd)`** — version "copy" : retourne les bouts couverts, ramenés en `vStart` relatif à `vStart` du paramètre (pratique pour coller ailleurs).

6. **`insertAt(edl, vTime, newSegments)`** — ajoute les segments en décalant leur `vStart` de `vTime`. **Ne décale pas** les segments existants (mode "overwrite-friendly"). Si on veut décaler pour faire de la place, c'est une opération séparée (`makeSpace`).

7. **`splitAt(edl, vTime)`** — nouveau. Trouve le segment qui contient `vTime`, le remplace par deux segments collés :
   ```js
   const offset = vTime - seg.vStart;
   [
     { ...seg, srcEnd: seg.srcStart + offset },
     { ...seg, id: newId, vStart: vTime, srcStart: seg.srcStart + offset },
   ]
   ```

8. **`virtualToSource(edl, vTime)`** — trouve le segment qui contient `vTime` (sur `vStart`, pas par cumul). Retourne `{ seg, srcTime }` ou `null` si on est dans un trou.

### `src/lib/playback.js`

**`scheduleTrackFrom(ctx, track, vStart)`** — au lieu de parcourir l'EDL en accumulant `when`, on planifie chaque segment à `ctx.currentTime + (seg.vStart - vStart) + leadSeconds`. Les segments dont la fin est avant `vStart` sont sautés ; ceux qui chevauchent `vStart` sont joués partiellement (offset dans la source).

### `src/hooks/useProjectPersistence.js`

Vérifier que `vStart` est bien sérialisé/désérialisé. La migration des anciens projets (EDL chaînée → positions absolues) : à la charge, si un segment n'a pas de `vStart`, le calculer depuis le cumul des durées des précédents.

### Critère de sortie

- L'app fonctionne strictement comme avant (visuellement, comportement, persistance).
- Le modèle interne est en positions absolues — on peut le vérifier avec un `console.log(track.edl)`.
- Un projet sauvegardé avant la migration se recharge correctement.

---

## Étape 1 — Nouveau rendu : la piste comme conteneur de blocs-clip

C'est l'étape qui transforme visuellement l'app. Chaque clip devient un bloc DOM indépendant positionné en absolu sur sa piste.

### Hiérarchie DOM cible

```
TrackView
├── TimelineAxis              (axe avec graduations)
└── TrackLane                  (position: relative, full width, hauteur fixe)
    ├── Clip                   (position: absolute, left/width en px depuis vStart)
    │   ├── ClipHeader         (nom, durée — petit, en haut)
    │   └── ClipWaveform       (canvas qui dessine ce segment uniquement)
    ├── Clip
    ├── ... (le vide = pas de DOM, c'est juste le fond de la lane)
    ├── SelectionOverlay       (si sélection active)
    └── Playhead               (barre rouge, full height)
```

Avec le modèle en positions absolues, le positionnement d'un clip devient trivial :
```js
const leftPx = seg.vStart * pxPerSec;
const widthPx = (seg.srcEnd - seg.srcStart) * pxPerSec;
```

### Design visuel d'un clip

- **Bordure** : 1-2 px d'une teinte plus sombre que le fond du clip.
- **Coins arrondis** : 4-6 px. Différencie clairement les blocs.
- **Fond** : teinte claire de la couleur de waveform (`rgba(34,173,197,0.15)`).
- **Waveform à l'intérieur** : peaks du segment en `rgb(34,173,197)`.
- **Label en haut** : nom + durée, opaque seulement au hover ou sur clip sélectionné.
- **Cursor** : `grab` sur le corps, `ew-resize` sur les 6-8 px des bords.
- **Hover** : élévation (box-shadow) ou highlight de bordure.
- **Sélectionné** : bordure colorée (primaire MUI), background un peu plus opaque.

### Nouveaux fichiers

- `src/components/Clip.jsx` — bloc visuel + son mini-canvas waveform.
- `src/components/ClipWaveform.jsx` — `<canvas>` qui dessine les peaks d'un segment (≈40 lignes).
- `src/components/TimelineAxis.jsx` — axe gradué (remplace `TimelinePlugin`).
- `src/components/Playhead.jsx` — la barre rouge.
- `src/components/SelectionOverlay.jsx` — div semi-transparente pour la sélection.

### `src/TrackView.jsx`

- Retirer `useWavesurfer`, `RegionsPlugin`, `TimelinePlugin`.
- `ResizeObserver` sur la lane → `pxPerSec = laneWidth / projectDuration`.
- Mapper `track.edl` directement en `<Clip seg={...} pxPerSec={...} />`.
- Le hack `pointerdown/up` (lignes 142-186) disparaît : un `onClick` propre sur la `TrackLane` pour le seek, un `onPointerDown` (avec drag-threshold) pour démarrer une sélection.

### Critère de sortie

- Toutes les features actuelles fonctionnent (clic = seek, drag dans le vide = sélection, Escape = clear, playhead anime).
- **Visuellement on voit déjà N blocs-clip alignés** (N=1 sur la plupart des pistes au début).
- `@wavesurfer/react` peut être retiré du `package.json`.

---

## Étape 2 — Couper un clip en deux

Avec le modèle en place, splitter est juste une mutation d'EDL. Le clip d'origine est remplacé par deux clips à `vStart` consécutifs, immédiatement visibles comme deux blocs séparés (bordure entre eux).

### `src/TrackView.jsx`

1. Position virtuelle de la souris sur la lane :
   ```jsx
   const hoverTimeRef = useRef(null);
   const onLaneMove = (e) => {
     const rect = laneRef.current.getBoundingClientRect();
     hoverTimeRef.current = ((e.clientX - rect.left) / rect.width) * dur;
   };
   ```

2. Raccourci "S" (lane avec `tabIndex={0}` pour le focus) :
   ```jsx
   const onKey = (e) => {
     if (e.key === 's' && hoverTimeRef.current != null) {
       onSplit?.(track.id, hoverTimeRef.current);
     }
   };
   ```

3. Dans `App.jsx`, `onSplit` appelle `splitAt(track.edl, vTime)` et met à jour l'état.

### Bonus

- **Shift+S** : split au playhead plutôt qu'à la souris.
- **Indicateur visuel** : pendant le hover sur un clip, une fine ligne verticale (1 px) à la position de la souris.

### Critère de sortie

- Survoler un clip, presser "S" → le bloc se sépare visiblement en deux clips bord-à-bord.
- L'audio reste identique (pas de gap, juste une frontière).

---

## Étape 3 — Drag horizontal d'un clip

Avec le modèle en positions absolues, drag = mutation directe de `seg.vStart`. Simple et propre.

### Installation

```bash
npm install interactjs
```

### `src/components/Clip.jsx`

```jsx
useEffect(() => {
  const el = ref.current;
  let dragDx = 0;

  interact(el).draggable({
    modifiers: [
      // bornes calculées : pas en dessous de 0, pas dans le voisin
      interact.modifiers.restrictRect({ restriction: getDragBounds(seg, allSegments) }),
    ],
    listeners: {
      start() { el.classList.add('dragging'); },
      move(e) {
        dragDx += e.dx;
        el.style.transform = `translateX(${dragDx}px)`;
      },
      end() {
        const deltaSec = dragDx / pxPerSec;
        el.style.transform = '';
        el.classList.remove('dragging');
        dragDx = 0;
        onDragEnd(seg.id, deltaSec);
      },
    },
  });
  return () => interact(el).unset();
}, [pxPerSec, allSegments]);
```

Points importants :
- Pendant le drag, on bouge **uniquement** via `style.transform` → 60 fps, pas de re-render React.
- À `end`, on commit (`seg.vStart += deltaSec`) et on remet `transform = ''` ; le re-render React repositionne le clip à sa nouvelle place "officielle" sans saut visuel.

### Logique métier

```js
function moveClip(edl, segId, deltaSec) {
  return edl.map((s) =>
    s.id === segId ? { ...s, vStart: Math.max(0, s.vStart + deltaSec) } : s
  );
}
```

**Gestion des overlaps** (v1 simple) : pendant le drag, `restrictRect` empêche le clip de chevaucher ses voisins. Bornes calculées depuis les segments adjacents :
```js
function getDragBounds(seg, all) {
  const left = max(0, voisinGauche.vStart + voisinGauche.dur);
  const right = voisinDroite ? voisinDroite.vStart - seg.dur : Infinity;
  return { left, right };
}
```

V2 possible : autoriser l'overlap et le résoudre (ripple ou overwrite). Pas pour maintenant.

### Critère de sortie

- Splitter un clip avec "S", puis drag le morceau de droite → un trou propre apparaît, la lecture y est silencieuse.
- Drag retour → le trou se referme, les deux clips se collent.
- Drag fluide pendant le mouvement (transform CSS), pas saccadé.
- Impossible de passer à travers un voisin (clamp par `restrictRect`).

---

## Étape 4 — Trim des bords (resize)

Drag des bords gauche/droit pour rogner/étendre un clip, comme le trim dans un DAW.

### `src/components/Clip.jsx`

```js
interact(el).resizable({
  edges: { left: true, right: true },
  listeners: {
    move(e) {
      el.style.transform = `translateX(${e.deltaRect.left}px)`;
      el.style.width = `${e.rect.width}px`;
    },
    end(e) {
      const deltaLeft = e.deltaRect.left / pxPerSec;
      const deltaRight = (e.rect.width - originalWidthPx) / pxPerSec - deltaLeft;
      onTrim(seg.id, deltaLeft, deltaRight);
      el.style.transform = '';
      el.style.width = '';
    },
  },
});
```

### Logique métier

- **Trim gauche** d'un Δ : `vStart += Δ` ET `srcStart += Δ`. Le bord droit ne bouge pas visuellement, le clip "démarre plus tard" à la fois dans la timeline et dans la source.
- **Trim droit** d'un Δ : `srcEnd += Δ`. Le clip joue plus ou moins longtemps.
- Bornes : `srcStart ∈ [0, srcEnd)`, `srcEnd ∈ (srcStart, buffer.duration]`. Pas d'extension au-delà du buffer source.

### Critère de sortie

- Saisir le bord gauche, tirer vers la droite → le clip raccourcit visuellement, un gap apparaît à gauche.
- Tirer le bord droit au-delà de la durée du buffer → bloqué.
- Curseur `ew-resize` sur les 6-8 px des bords.

---

## Étape 5 — Drag inter-pistes

On saisit un clip dans la piste A, on le drop dans la piste B. Naturel avec le modèle en positions absolues.

### Approche

- Le `Clip` est `position: absolute` dans `TrackLane`, mais pendant le drag on peut le sortir visuellement (autoriser `transform: translate(X, Y)`).
- Pendant `move`, détecter sur quelle piste on est en regardant la position Y vs les `getBoundingClientRect()` de chaque `TrackLane` (passées via contexte React).
- Highlight la lane survolée (bordure ou background).

### À `end` : deux mutations

1. **Retirer** le segment de l'EDL de la piste source.
2. **Insérer** le segment dans l'EDL de la piste cible avec un nouveau `vStart` calculé depuis la position X de drop. Garder `buffer` et `bufferTrackId` intacts pour que la lecture trouve le bon buffer.

### Le piège du buffer

Quand un segment change de piste, il doit garder une référence à **son** buffer (celui de la piste d'origine), pas à celui de sa nouvelle piste. C'est précisément pour ça que `Segment` a déjà les champs `buffer` (runtime) et `bufferTrackId` (sérialisable) — voir `edl.js:10`. Au drop, ne pas les écraser.

### Critère de sortie

- Drag un clip de la piste 1 vers la piste 2 → il disparaît de la 1, apparaît dans la 2 à la position de drop, lit le bon son.
- Save/reload → le clip déplacé continue de lire le bon son (`bufferTrackId` persiste).

---

## Étape 6 — Polish : snapping, ripple, raccourcis

Ce qui sépare "ça marche" de "c'est agréable".

### Snapping

Modifier dynamique sur `interact.js` qui retourne les positions cibles vivantes :
- `vStart` et `vStart + dur` des autres clips (toutes pistes confondues)
- playhead courant
- 0 (début de timeline)
- bord opposé du clip en cours de drag (pour aligner par la fin)

```js
modifiers: [
  interact.modifiers.snap({
    targets: [() => collectSnapPoints(allTracks, playheadTime).map((t) => ({ x: t * pxPerSec, range: 8 }))],
  }),
]
```

UX : un guide vertical (fine ligne) qui apparaît au moment du snap pour confirmer visuellement.

### Mode ripple (optionnel)

Variante de drag/delete qui pousse les voisins au lieu de laisser le trou :
- **Ripple delete** : tout ce qui est à droite du clip supprimé recule de sa durée.
- **Ripple drag** : déplacer un clip pousse les voisins.

Ajouté en option (raccourci modifier, par exemple "Shift+drag = ripple"), pas activé par défaut.

### Raccourcis utiles

- `Suppr` : supprime le clip sélectionné.
- `S` / `Shift+S` : split à la souris / au playhead (déjà en place).
- `Ctrl+Z` / `Ctrl+Y` : undo/redo (vérifier que ça couvre les nouvelles opérations).
- `Shift+drag` : drag sans snap (ou avec ripple, à choisir).
- `Alt+drag` : duplique au lieu de déplacer.
- Flèches : nudge ±10 ms du clip sélectionné.

---

## Récapitulatif de l'ordre

| # | Étape | Visible utilisateur | Risque |
|---|-------|---------------------|--------|
| 0 | Refonte EDL en positions absolues + `splitAt` | Non | **Élevé** (touche tout) |
| 1 | Rendu custom + clips visuels | **Oui** (gros changement visuel) | Moyen |
| 2 | "S" pour couper | Oui | Faible |
| 3 | Drag horizontal | Oui (gros effet) | Moyen |
| 4 | Trim des bords | Oui | Faible |
| 5 | Drag inter-pistes | Oui (gros) | Moyen-élevé |
| 6 | Snapping & polish | Oui (qualité perçue) | Faible |

Chaque étape est shippable indépendamment et laisse l'app dans un état fonctionnel. L'étape 0 est la plus risquée (elle touche `edl.js`, `playback.js`, persistance), mais une fois passée elle débloque toutes les suivantes qui deviennent des mutations triviales (drag = `vStart += Δ`, trim = `srcStart/srcEnd += Δ`, drop inter-pistes = changer de tableau + nouveau `vStart`). À ce stade, chaque étape suivante est essentiellement de l'UI au-dessus d'opérations EDL déjà solides.
