# Plan — Snap, raccourcis clavier, clipboard par paragraphe

Décisions validées :
- Snap : grille temporelle fixe + bords des autres clips même piste + playhead.
- Sticky (colle quand on s'approche). Threshold en pixels (≈ 8 px) converti en secondes via `pxPerSec`.
- Toggle UI (bouton aimant dans toolbar) + bypass `Alt` pendant drag/resize.
- Clipboard par couple `(chapter, paragraph)` (clé `obs[0]:obs[1]`).
- `snapStep` initial : `0.5s`.
- `Ctrl+A` : toutes pistes.

---

## 1. Snap

### 1.1 Helper centralisé `src/lib/snap.js`

```js
// Renvoie la valeur snappée la plus proche dans le rayon thresholdSec,
// ou `t` si rien n'est assez proche.
export function snapTime(t, { snapStep, candidates, thresholdSec }) { … }
```

- `candidates` : tableau de secondes (bords clips, playhead).
- Évalue aussi les multiples de `snapStep` autour de `t`.
- Retourne la cible la plus proche si distance ≤ `thresholdSec`, sinon `t`.

### 1.2 State + toolbar

Dans `AudioRecorder.jsx` :
- `const [snapEnabled, setSnapEnabled] = useState(() => localStorage.getItem("snapEnabled") !== "false")`.
- `const [snapStep, setSnapStep] = useState(0.5)` (configurable plus tard).
- Persiste `snapEnabled` en `localStorage` à chaque toggle.
- Bouton icône aimant (`@mui/icons-material/Magnet` ou équivalent) dans la toolbar, à côté de undo/redo. Variant `outlined` quand off, `contained` quand on.

### 1.3 Candidates de snap

`AudioRecorder` expose un callback :

```js
const getSnapCandidates = (trackId, excludeSegId) => {
    const t = tracks.find(x => x.id === trackId);
    if (!t) return [];
    const out = [];
    for (const s of t.edl) {
        if (s.id === excludeSegId) continue;
        out.push(s.vStart);
        out.push(s.vStart + (s.srcEnd - s.srcStart));
    }
    if (selection?.trackId === trackId && selection.time != null) {
        out.push(selection.time);
    }
    return out;
};
```

Passé via prop `getSnapCandidates` à `TrackView` → `Clip`.

### 1.4 Drag clip (`Clip.jsx`, listener `move`)

```js
move(e) {
    dragDxRef.current += e.dx;
    dragDyRef.current += e.dy;
    // … hit test inchangé …

    if (snapEnabled && !e.altKey && pxPerSec > 0) {
        const thresholdSec = 8 / pxPerSec;
        const candidates = getSnapCandidates(trackId, segment.id);
        const dur = segment.srcEnd - segment.srcStart;
        const rawV = segment.vStart + dragDxRef.current / pxPerSec;
        // Snap du bord gauche
        const snappedLeft = snapTime(rawV, { snapStep, candidates, thresholdSec });
        // Snap du bord droit (sur les mêmes candidates)
        const snappedRight = snapTime(rawV + dur, { snapStep, candidates, thresholdSec }) - dur;
        // On garde celui qui s'est le plus rapproché
        const finalV = Math.abs(snappedLeft - rawV) <= Math.abs(snappedRight - rawV) ? snappedLeft : snappedRight;
        dragDxRef.current = (finalV - segment.vStart) * pxPerSec;
    }

    el.style.transform = `translate(${dragDxRef.current}px, ${dragDyRef.current}px)`;
}
```

Notes :
- `e.altKey` provient d'interact.js : exposé via `e.modifiers?.alt` ou `e.originalEvent?.altKey` (à confirmer à l'impl).
- Snap toujours sur **same-track**. Cross-track : snap désactivé (premier jet).

### 1.5 Resize clip (`Clip.jsx`, listener `move` resizable)

Même logique sur les bords gauche/droit indépendamment :

```js
// pour le bord gauche
const rawLeftV = (e.rect.left - laneRect.left) / pxPerSec;
const snappedLeftV = snap(rawLeftV);
// applique width / transform en fonction
```

### 1.6 Risques

- Snap qui bloque sur soi-même → exclure `segment.id` (déjà géré dans `getSnapCandidates`).
- Threshold > snapStep à zoom faible → on snap toujours. Mitigation : threshold en pixels constants (≈ 8 px).
- Pendant un drag inter-pistes, snap reste sur la piste source : acceptable pour un premier jet.

---

## 2. Raccourcis clavier

Ajoutés dans le `useEffect` keydown existant de `AudioRecorder.jsx`. Tous gardés derrière le check `tag !== INPUT/TEXTAREA`.

| Touche | Action |
|---|---|
| `Espace` | `isPlaying ? stop() : play()` + `preventDefault` |
| `S` | `splitAtPlayhead()` |
| `Ctrl/Cmd+A` | `selectAllClips()` — toutes pistes |
| `←` / `→` | Nudge clip(s) sélectionné(s) de `±snapStep` (ou `0.1` si snap off) |
| `Shift+←/→` | Nudge × 10 (gros pas) |

### 2.1 `selectAllClips`

```js
const selectAllClips = () => {
    const all = [];
    for (const t of tracks) for (const s of t.edl) all.push({ trackId: t.id, segId: s.id });
    setClipSelection(all);
    clipSelectionAnchorRef.current = all[0] ?? null;
    setRegionSelection(null);
};
```

### 2.2 `nudgeSelectedClips(deltaSec)`

```js
const nudgeSelectedClips = (deltaSec) => {
    if (clipSelection.length === 0) return;
    const byTrack = new Map();
    for (const { trackId, segId } of clipSelection) {
        if (!byTrack.has(trackId)) byTrack.set(trackId, new Set());
        byTrack.get(trackId).add(segId);
    }
    setTracksWithHistory(ts => ts.map(t => {
        const ids = byTrack.get(t.id);
        if (!ids) return t;
        return {
            ...t,
            edl: t.edl.map(s => ids.has(s.id) ? { ...s, vStart: Math.max(0, s.vStart + deltaSec) } : s)
        };
    }));
};
```

- Pas de punch-in : sinon des données disparaissent à coups de flèches.
- Overlap après nudge toléré (cohérent avec le drag).

### 2.3 Garde-fou historique

Une flèche maintenue ne doit pas créer N entries d'undo :
- Au `keydown` non-repeat (`!e.repeat`) → `setTracksWithHistory` (push past).
- Au `keydown` `e.repeat === true` → `setTracks` direct (sans push past).

---

## 3. Clipboard par paragraphe

### 3.1 Refactor de l'état

`AudioRecorder.jsx` :

```js
// Avant
const [clipboard, setClipboard] = useState(null);

// Après
const [clipboards, setClipboards] = useState({}); // { "1:0": {segments}, "1:1": {segments}, ... }
const obsKey = `${obs[0]}:${obs[1]}`;
const clipboard = clipboards[obsKey] ?? null;
const setClipboardForCurrentObs = (val) => {
    setClipboards(prev => ({ ...prev, [obsKey]: val }));
};
```

### 3.2 Adaptations

- `copySelection` / `cutSelection` → utilisent `setClipboardForCurrentObs({ segments })`.
- `pasteAtCursor` lit `clipboard` (dérivé pour la clé courante).
- Bouton Paste : `disabled={!clipboard || !selection}` — fonctionne sans changement.

### 3.3 Reset au switch obs

Pas nécessaire : la clé change automatiquement, donc la lecture pointe vers une autre case. Le clipboard d'un autre paragraphe reste en mémoire mais inaccessible depuis l'UI courante.

### 3.4 Stockage

`useState` en mémoire seulement (perdu au refresh). Si besoin de persistance plus tard : sérialiser dans `localStorage` (attention : les segments contiennent des refs `buffer` non-sérialisables — il faudra dropper `buffer` et ne garder que `bufferTrackId`).

---

## Ordre d'implémentation

1. **Clipboard par obs** — ~20 lignes, débloque le bug le plus tangible.
2. **Raccourcis clavier** sauf flèches — Espace, S, Ctrl+A. Indépendant du snap.
3. **Helper `snap.js`** + toggle UI (bouton aimant, état local).
4. **Snap drag clip** (cas le plus visible).
5. **Snap resize clip**.
6. **Raccourcis flèches** — utilisent `snapStep`.

Chaque étape est commitable séparément.
