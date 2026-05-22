# Roadmap : rework de la sélection (clip-selection)

## Vision et règles

Aujourd'hui on a **deux** états de sélection :

- `selection: { trackId, time }` → position du playhead.
- `regionSelection: { trackId, start, end }` → range temporel pour cut/copy/paste.

On en ajoute un **troisième** : `clipSelection`, qui matérialise « un ou plusieurs clips entiers sélectionnés ».

### Règles d'interaction

| Action utilisateur | Comportement |
|---|---|
| **Click corps du clip** (zone waveform) | Inchangé — seek du playhead. |
| **Click header** (bandeau foncé en haut, `HEADER_HEIGHT=12px`) | Sélectionne le clip entier (`clipSelection`). |
| **Shift/Ctrl + click header** | Toggle ce clip dans la sélection courante. |
| **Drag région entièrement hors clip qui enveloppe ≥1 clip** | Tous les clips enveloppés deviennent `clipSelection`. Aucun `regionSelection`. |
| **Drag région avec ≥1 extrémité dans un clip** (chevauchement partiel) | Inchangé — `regionSelection` classique (sous-région). |
| **Drag région entièrement hors clip, n'enveloppant aucun clip** | `regionSelection` classique (lane vide entre clips). |
| **Drag depuis header** | Déplace le clip (comportement interact.js actuel). Si plusieurs clips sélectionnés → tous bougent ensemble *(étape 6, follow-up)*. |
| **Click sur lane vide** | Inchangé — seek + clear de toutes les sélections. |
| **Esc** | Clear `clipSelection` et `regionSelection`. |
| **Delete / Suppr** | Supprime les clips de `clipSelection` si présent, sinon rien. |
| **Cut / Copy / Paste** | Prend en priorité `clipSelection`, sinon `regionSelection`. |

### Relations entre états

`regionSelection` et `clipSelection` sont **mutuellement exclusifs**. Toute interaction qui en pose un clear l'autre. Le playhead (`selection`) est indépendant et reste tel quel.

---

## ⏳ Étape 1 — Marquer le header dans le DOM

Pour que `TrackView` puisse distinguer un click sur header vs corps du clip, le header doit porter un attribut data dédié.

### `src/trackview/Clip.jsx`

Ajouter `data-clip-header="true"` sur la Box du header (ligne ~138) :

```jsx
<Box
    data-clip-header="true"
    sx={{
        height: HEADER_HEIGHT,
        background: isSelected
            ? "linear-gradient(180deg, rgba(21,119,137,0.95), rgba(21,119,137,0.75))"
            : "linear-gradient(180deg, rgba(21,119,137,0.85), rgba(21,119,137,0.55))",
        borderBottom: "1px solid rgba(0, 0, 0, 0.15)",
        flexShrink: 0,
        cursor: "pointer",
    }}
/>
```

Le `cursor: "pointer"` donne un retour visuel : le header se comporte comme un bouton.

---

## ⏳ Étape 2 — Détecter header vs body dans `TrackView`

On enrichit le `dragStateRef` avec `startedOnHeader` et `segId`. Les handlers existants se ramifient sur ce flag.

### `src/TrackView.jsx`

**Nouvelles props** (à ajouter à la signature) :

```jsx
export default function TrackView({
    track,
    projectDuration,
    isSelected,
    onSeek,
    onDelete,
    playheadTime,
    regionSelection,
    onRegionChange,
    onRename,
    onClipMove,
    onClipTrim,
    clipSelection,        // NEW : { trackId, segmentIds: string[] } | null
    onClipSelect,         // NEW : (trackId, segId, { shift, ctrl }) => void  — toggle/replace
    onClipSelectMany,     // NEW : (trackId, segmentIds: string[]) => void   — set explicite
    onClipSelectClear,    // NEW : () => void
}) {
```

**`onLanePointerDown`** : capter `data-clip-header` et `data-clip-id` :

```jsx
const onLanePointerDown = (e) => {
    if (e.button !== 0) return;
    const clipEl = e.target.closest("[data-clip-id]");
    const startedOnClip = !!clipEl;
    const startedOnHeader = !!e.target.closest("[data-clip-header]");
    const segId = clipEl?.dataset.clipId ?? null;
    const t = xToTime(e.clientX);
    dragStateRef.current = {
        startTime: t,
        startX: e.clientX,
        dragged: false,
        startedOnClip,
        startedOnHeader,
        segId,
    };
    if (!startedOnClip) {
        e.currentTarget.setPointerCapture?.(e.pointerId);
    }
};
```

**`onLanePointerUp`** : nouvelle ramification pour header + détection enclosure :

```jsx
const onLanePointerUp = (e) => {
    const st = dragStateRef.current;
    dragStateRef.current = null;
    if (!st) return;

    // Cas 1 : Click sur header (sans drag) → sélection de clip
    if (st.startedOnHeader && !st.dragged) {
        const mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
        onClipSelect?.(track.id, st.segId, mods);
        // Pas de seek, pas de region change.
        return;
    }

    // Cas 2 : Drag depuis un clip (header ou body) → interact.js a géré, on ignore
    if (st.startedOnClip) {
        if (!st.dragged) {
            // Click corps du clip → seek + clear sélections
            onSeek?.(track.id, st.startTime);
            onRegionChange?.(null);
            onClipSelectClear?.();
        }
        return;
    }

    // Cas 3 : Click sur lane vide (sans drag) → seek + clear
    if (!st.dragged) {
        onSeek?.(track.id, st.startTime);
        onRegionChange?.(null);
        onClipSelectClear?.();
        return;
    }

    // Cas 4 : Drag-région sur lane → décider region vs clipSelection
    const t = xToTime(e.clientX);
    const regionStart = Math.min(st.startTime, t);
    const regionEnd = Math.max(st.startTime, t);
    setDragSel(null);

    const isInsideAnyClip = (time) =>
        track.edl.some((seg) => {
            const end = seg.vStart + (seg.srcEnd - seg.srcStart);
            return time >= seg.vStart && time < end;
        });

    const partialOverlap =
        isInsideAnyClip(regionStart) || isInsideAnyClip(regionEnd);

    if (partialOverlap) {
        // Chevauchement partiel → sous-région classique
        onRegionChange?.({ trackId: track.id, start: regionStart, end: regionEnd });
        onClipSelectClear?.();
        return;
    }

    // Drag entièrement hors clip : clips enveloppés ?
    const enclosed = track.edl.filter((seg) => {
        const end = seg.vStart + (seg.srcEnd - seg.srcStart);
        return seg.vStart >= regionStart && end <= regionEnd;
    });

    if (enclosed.length > 0) {
        onClipSelectMany?.(track.id, enclosed.map((s) => s.id));
        onRegionChange?.(null);
    } else {
        // Lane vide entre clips → région classique
        onRegionChange?.({ trackId: track.id, start: regionStart, end: regionEnd });
        onClipSelectClear?.();
    }
};
```

**Passer `isSelected` à chaque `<Clip>`** :

```jsx
const clipSelectedIds = useMemo(() => {
    if (!clipSelection || clipSelection.trackId !== track.id) return null;
    return new Set(clipSelection.segmentIds);
}, [clipSelection, track.id]);

// dans le JSX :
{track.edl.map((seg) => (
    <Clip
        key={seg.id}
        segment={seg}
        trackId={track.id}
        trackBuffer={track.buffer}
        pxPerSec={pxPerSec}
        onMove={onClipMove}
        onClipTrim={onClipTrim}
        bounds={clipBounds[seg.id]}
        isSelected={clipSelectedIds?.has(seg.id) ?? false}
    />
))}
```

**`Escape`** : étendre le handler clavier existant :

```jsx
useEffect(() => {
    const onKey = (e) => {
        if (e.key === "Escape") {
            setDragSel(null);
            if (regionSelection?.trackId === track.id) onRegionChange?.(null);
            onClipSelectClear?.();
        }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
}, [regionSelection, track.id, onRegionChange, onClipSelectClear]);
```

---

## ⏳ Étape 3 — État `clipSelection` dans `AudioRecorder`

### `src/AudioRecorder.jsx`

**Nouvel état** (à côté de `selection` et `regionSelection`) :

```jsx
const [clipSelection, setClipSelection] = useState(null);
// { trackId: string, segmentIds: string[] } | null
```

**Handlers** :

```jsx
// Click header : toggle si Shift/Ctrl, sinon replace
const handleClipSelect = (trackId, segId, mods) => {
    setRegionSelection(null); // exclusion mutuelle
    if (!segId) {
        setClipSelection(null);
        return;
    }
    if (mods?.shift || mods?.ctrl) {
        setClipSelection((cur) => {
            // Sélection multi seulement intra-piste pour l'instant
            if (!cur || cur.trackId !== trackId) {
                return { trackId, segmentIds: [segId] };
            }
            const has = cur.segmentIds.includes(segId);
            const next = has
                ? cur.segmentIds.filter((id) => id !== segId)
                : [...cur.segmentIds, segId];
            return next.length === 0 ? null : { trackId, segmentIds: next };
        });
    } else {
        setClipSelection({ trackId, segmentIds: [segId] });
    }
};

// Drag-région promu : remplace complètement
const handleClipSelectMany = (trackId, segmentIds) => {
    setRegionSelection(null);
    setClipSelection({ trackId, segmentIds });
};

const handleClipSelectClear = () => setClipSelection(null);
```

**Wire-up dans le `<TrackView>`** :

```jsx
<TrackView
    /* ... */
    clipSelection={clipSelection}
    onClipSelect={handleClipSelect}
    onClipSelectMany={handleClipSelectMany}
    onClipSelectClear={handleClipSelectClear}
/>
```

**Toute action qui pose une régionSelection doit clear clipSelection**, et inversement. Centraliser via les handlers ci-dessus suffit.

---

## ⏳ Étape 4 — Affichage visuel

Le rendu est déjà branché : `Clip.jsx` accepte `isSelected` et applique un bord et fond plus marqués (lignes 113-122). Rien à changer dans `Clip.jsx` au-delà de l'étape 1.

Vérifier au passage que le `linear-gradient` du header en mode `isSelected` ressort bien (étape 1 ci-dessus).

Idée d'amélioration optionnelle : passer le header sélectionné dans une teinte plus saturée (`#1565c0` du brand au lieu de `rgba(21,119,137,...)`) pour rendre plus évident qu'on a cliqué dessus. Au choix.

---

## ⏳ Étape 5 — Opérations sur `clipSelection`

### Delete

Nouveau handler dans `AudioRecorder.jsx` :

```jsx
const deleteSelectedClips = () => {
    if (!clipSelection) return;
    const { trackId, segmentIds } = clipSelection;
    setTracksWithHistory((ts) =>
        ts.map((t) =>
            t.id === trackId
                ? { ...t, edl: t.edl.filter((s) => !segmentIds.includes(s.id)) }
                : t,
        ),
    );
    setClipSelection(null);
};
```

Raccourci clavier (à ajouter dans le `useEffect` `onKey`) :

```jsx
else if ((e.key === "Delete" || e.key === "Backspace") && clipSelection) {
    e.preventDefault();
    deleteSelectedClips();
}
```

Attention au tableau de dépendances de cet effet : ajouter `clipSelection`.

### Copy

Étendre `copySelection` pour gérer `clipSelection` en priorité :

```jsx
const copySelection = () => {
    if (clipSelection) {
        const { trackId, segmentIds } = clipSelection;
        const track = tracks.find((t) => t.id === trackId);
        if (!track) return;
        const sorted = track.edl
            .filter((s) => segmentIds.includes(s.id))
            .sort((a, b) => a.vStart - b.vStart);
        if (!sorted.length) return;
        const firstStart = sorted[0].vStart;
        // Normalise : premier segment à vStart=0 dans le clipboard.
        // Tag buffer + bufferTrackId pour le paste inter-pistes / post-reload.
        const segs = sorted.map((s) => ({
            ...s,
            id: crypto.randomUUID(),
            vStart: s.vStart - firstStart,
            buffer: track.buffer,
            bufferTrackId: track.id,
        }));
        setClipboard({ segments: segs });
        return;
    }
    // --- comportement région existant inchangé ci-dessous ---
    if (!regionSelection) return;
    const { trackId, start, end } = regionSelection;
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;
    const segs = extractRange(track.edl, start, end, track.buffer, track.id);
    if (!segs.length) return;
    setClipboard({ segments: segs });
};
```

### Cut

```jsx
const cutSelection = () => {
    if (clipSelection) {
        copySelection();
        deleteSelectedClips();
        return;
    }
    if (!regionSelection) return;
    const { trackId, start, end } = regionSelection;
    copySelection();
    setTracksWithHistory((ts) =>
        ts.map((t) =>
            t.id === trackId ? { ...t, edl: cutRange(t.edl, start, end) } : t,
        ),
    );
    setRegionSelection(null);
};
```

### Paste

Inchangé. `pasteAtCursor` utilise déjà `selection` (playhead) + `clipboard.segments`. Compatible avec les segments copiés depuis un `clipSelection`.

### Disabled state des boutons toolbar

Mettre à jour les `disabled` :

```jsx
<IconButton onClick={copySelection} disabled={!regionSelection && !clipSelection} title="Copy">...
<IconButton onClick={cutSelection} disabled={!regionSelection && !clipSelection} title="Cut">...
```

(Paste et Split restent inchangés.)

---

## ⏳ Étape 6 — Drag multi-clip (follow-up, optionnel)

*Non bloquant pour le rework de la sélection. Peut être traité après.*

Aujourd'hui, drag depuis le header d'un clip déplace **ce clip seul** via `interact.js` dans `Clip.jsx`. Quand plusieurs clips sont sélectionnés (`clipSelection.segmentIds.length > 1`), on veut qu'ils bougent **ensemble**, en gardant leurs positions relatives.

### Points à traiter

1. **Propagation du `clipSelection` à `Clip.jsx`** : actuellement `Clip` ne connaît pas la sélection globale. Lui passer la liste des co-sélectionnés (ou un callback `onMove(deltaSec)` qui sait gérer le groupe au niveau `AudioRecorder`).

2. **Anti-overlap pour le groupe** : le calcul `clipBounds` actuel dans `TrackView.jsx` ne considère que les voisins immédiats. Pour un groupe, il faut le `minVStart` du clip le plus à gauche du groupe (limité par le voisin externe gauche) et le `maxVStart` du clip le plus à droite (limité par le voisin externe droit). Les clips **intra-groupe** ne se contraignent pas mutuellement.

3. **Nouvel API** : remplacer `moveClip(trackId, segId, deltaSec)` par `moveClips(trackId, segIds[], deltaSec)`. Le single-clip devient un cas particulier (segIds = [segId]).

4. **Rendu pendant le drag** : aujourd'hui un seul `transform: translateX()` sur le clip qu'on saisit. Pour le groupe, soit on translate chaque clip via un ref central, soit on enveloppe le groupe dans un Box transient pendant le drag. La 1re option garde l'architecture actuelle.

### Snippet d'idée (à valider)

```jsx
// AudioRecorder
const moveClips = (trackId, segIds, deltaSec) => {
    setTracksWithHistory((ts) =>
        ts.map((t) => {
            if (t.id !== trackId) return t;
            let edl = t.edl;
            for (const id of segIds) edl = moveSegment(edl, id, deltaSec);
            return { ...t, edl };
        }),
    );
};
```

`moveSegment` (déjà dans `edl.js`) applique le shift à un segment unique ; appelé pour chaque seg du groupe ça décale tout uniformément. **Attention** : l'ordre des moves peut faire échouer le check anti-overlap interne si `moveSegment` valide (à vérifier dans `edl.js`). Sinon, calculer un `safeDelta` clampé en amont.

À traiter en détail quand on attaquera cette étape.

---

## Critère de sortie

- Clic sur le **corps** d'un clip : seek du playhead, aucune sélection de clip.
- Clic sur le **header** : le clip s'éclaire (bord + fond), aucun playhead bougé.
- Shift/Ctrl + clic sur un autre header : 2 clips éclairés.
- Drag-région d'une zone vide → drag-région d'une zone vide qui passe par-dessus un clip et finit dans le vide : le clip est entièrement sélectionné, pas de rectangle gris semi-transparent.
- Drag-région qui commence dans un clip et finit dans le vide (ou inversement) : rectangle gris classique, le clip n'est PAS marqué comme sélectionné.
- Drag-région qui commence dans le vide entre deux clips, sans en couvrir aucun : rectangle gris classique.
- `Suppr` avec `clipSelection` : les clips sélectionnés disparaissent. Undo les ramène.
- Cut / Copy / Paste avec `clipSelection` : copie les clips entiers ; paste au playhead les recolle (positions relatives conservées).
- Drag depuis un header : déplace le clip (single — multi reporté à l'étape 6).
- Esc : clear `clipSelection` et `regionSelection`.

---

## Récapitulatif

| # | Étape | État | Effort |
|---|-------|------|--------|
| 1 | `data-clip-header` sur la Box du header | ⏳ | Trivial |
| 2 | Branches `TrackView` : header vs body, partial vs enclosed | ⏳ | Moyen |
| 3 | État `clipSelection` + handlers dans `AudioRecorder` | ⏳ | Faible |
| 4 | Wire `isSelected` sur `Clip` (déjà supporté) | ⏳ | Trivial |
| 5 | Delete + Cut/Copy étendus à `clipSelection` | ⏳ | Faible |
| 6 | Drag multi-clip (follow-up) | ⏳ | Moyen-élevé |

Ordre recommandé : 1 → 2 → 3 → 4 en une passe (ils sont couplés), puis 5 standalone, puis 6 plus tard.
