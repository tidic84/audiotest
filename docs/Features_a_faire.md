# Features à implémenter

Guide d'implémentation pour 4 features. Chaque section précise les fichiers à toucher et donne les snippets de code.

---

## 1. Bouton renommer

Le bouton existe déjà (`EditIcon` dans `TrackView.jsx` ligne ~192) mais sans `onClick`. Il faut le câbler à un mode édition avec un `TextField`.

### `src/TrackView.jsx`

Ajouter en haut du composant (à côté des autres `useState`) :

```jsx
const [isRenaming, setIsRenaming] = useState(false);
const [draftName, setDraftName] = useState(track.name);
```

Et ajouter une prop `onRename` à la signature :

```jsx
export default function TrackView({
    track,
    ...,
    onRename,    // <- nouveau
    ...
}) {
```

Dans le JSX, remplacer la Box qui affiche `{track.name}` par :

```jsx
<Box marginLeft={0.7} overflow="hidden" minWidth={60} maxWidth={60}>
    {isRenaming ? (
        <TextField
            size="small"
            value={draftName}
            autoFocus
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => {
                onRename?.(track.id, draftName.trim() || track.name);
                setIsRenaming(false);
            }}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    onRename?.(track.id, draftName.trim() || track.name);
                    setIsRenaming(false);
                } else if (e.key === "Escape") {
                    setDraftName(track.name);
                    setIsRenaming(false);
                }
            }}
            sx={{ width: "100%" }}
        />
    ) : (
        track.name
    )}
</Box>
```

Et câbler le `EditIcon` :

```jsx
<IconButton
    size="small"
    onClick={() => {
        setDraftName(track.name);
        setIsRenaming(true);
    }}
    title="Rename track"
>
    <EditIcon fontSize="small" />
</IconButton>
```

N'oublie pas d'importer `TextField` en haut du fichier :

```jsx
import TextField from "@mui/material/TextField";
```

### `src/AudioRecorder.jsx`

Ajouter le handler :

```jsx
const renameTrack = (trackId, newName) => {
    setTracks(ts => ts.map(t => t.id === trackId ? { ...t, name: newName } : t));
};
```

Et le passer à `TrackView` dans le `map` :

```jsx
<TrackView
    ...
    onRename={renameTrack}
/>
```

Le rename sera persisté automatiquement grâce à `useProjectPersistence` qui sauve `tracks` à chaque modif.

---

## 2. Undo / Redo

Maintenir deux piles d'historique pour `tracks`. Tout `setTracks` qui modifie l'EDL doit push l'état précédent dans `past`. `undo` pop `past` et push `tracks` dans `future`. `redo` fait l'inverse.

### `src/AudioRecorder.jsx`

Ajouter les states :

```jsx
const [past, setPast] = useState([]);    // états précédents
const [future, setFuture] = useState([]); // états annulés (pour redo)
```

Wrapper de `setTracks` qui historise :

```jsx
const setTracksWithHistory = (updater) => {
    setPast(p => [...p, tracks]);
    setFuture([]);  // toute nouvelle action invalide le redo
    setTracks(updater);
};
```

Remplacer **tous les `setTracks` qui modifient l'EDL** (cut, paste, delete, rename si tu veux qu'il soit undo-able) par `setTracksWithHistory`. Exemples concrets :

```jsx
// cutSelection
setTracksWithHistory(ts => ts.map(t =>
    t.id === trackId ? { ...t, edl: cutRange(t.edl, start, end) } : t
));

// pasteAtCursor
setTracksWithHistory(ts => ts.map(t =>
    t.id === trackId ? { ...t, edl: insertAt(t.edl, time, clipboard.segments) } : t
));

// deleteTrack
setTracksWithHistory(ts => ts.filter(t => t.id !== id));
```

**Attention** : les `setTracks` qui chargent l'état initial (dans `useProjectPersistence`) ou qui ajoutent une piste fraîchement enregistrée (dans `useRecorder`) ne doivent **pas** être historisés, sinon undo annulerait le chargement du projet. Garde-les en `setTracks` direct.

Les handlers undo/redo :

```jsx
const undo = () => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast(p => p.slice(0, -1));
    setFuture(f => [tracks, ...f]);
    setTracks(prev);
};

const redo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(f => f.slice(1));
    setPast(p => [...p, tracks]);
    setTracks(next);
};
```

Raccourcis clavier :

```jsx
useEffect(() => {
    const onKey = (e) => {
        const isCmd = e.ctrlKey || e.metaKey;
        if (isCmd && e.key.toLowerCase() === "z" && !e.shiftKey) {
            e.preventDefault();
            undo();
        } else if ((isCmd && e.key.toLowerCase() === "y") ||
                   (isCmd && e.shiftKey && e.key.toLowerCase() === "z")) {
            e.preventDefault();
            redo();
        }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
}, [past, future, tracks]);
```

(Optionnel) Boutons Undo/Redo dans la toolbar :

```jsx
<IconButton size="small" onClick={undo} disabled={past.length === 0} title="Undo">
    <UndoIcon fontSize="small" />
</IconButton>
<IconButton size="small" onClick={redo} disabled={future.length === 0} title="Redo">
    <RedoIcon fontSize="small" />
</IconButton>
```

Imports : `import UndoIcon from "@mui/icons-material/UndoOutlined"; import RedoIcon from "@mui/icons-material/RedoOutlined";`

### Limite à connaître

Cet undo/redo ne couvre que `tracks` (l'EDL). Si tu veux aussi historiser `selection`, `regionSelection`, `clipboard`, il faut élargir la pile (stocker un snapshot complet `{tracks, selection, regionSelection}`).

---

## 3. Quand on appuie sur stop, le curseur reste à la position

Aujourd'hui, dans `src/AudioRecorder.jsx`, `stop()` fait `setPlayerHeadTime(0)` et `playingFromRef.current = null`. Du coup le curseur disparaît (le `playheadTime` calculé dans le `map` retombe à `null`).

L'idée : avant de stopper, capturer la position courante du curseur, et l'écrire dans `selection`. Le visuel du curseur est ensuite dérivé de `selection` quand on n'est pas en lecture.

### `src/AudioRecorder.jsx` — modifier `stop()`

```jsx
const stop = () => {
    // Capture la position du curseur AVANT de tout reset
    const trackId = playingFromRef.current?.trackId;
    const startTime = playingFromRef.current?.startTime ?? 0;
    const currentPos = startTime + playerHeadTime;

    stopSources(sourcesRef.current);
    sourcesRef.current = [];
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    playingFromRef.current = null;
    setPlayerHeadTime(0);
    setIsPlaying(false);

    // Persiste la position pour que le curseur reste visible
    if (trackId != null) {
        setSelection({ trackId, time: currentPos });
    }
};
```

Faire pareil dans `tick()` quand la lecture termine naturellement (sinon le curseur saute à 0 en fin de piste) :

```jsx
const tick = () => {
    const elapsed = Math.max(0, audioCtxRef.current.currentTime - playStartedAtRef.current);
    if (elapsed >= playEndsAtRef.current) {
        // Fixe le curseur à la fin de la piste
        const trackId = playingFromRef.current?.trackId;
        const startTime = playingFromRef.current?.startTime ?? 0;
        if (trackId != null) {
            setSelection({ trackId, time: startTime + playEndsAtRef.current });
        }
        playingFromRef.current = null;
        setPlayerHeadTime(0);
        setIsPlaying(false);
        rafRef.current = null;
        return;
    }
    setPlayerHeadTime(elapsed);
    rafRef.current = requestAnimationFrame(tick);
};
```

### `src/AudioRecorder.jsx` — dériver `playheadTime` à partir de `selection` quand pas en lecture

Dans le `tracks.map(...)`, remplacer le calcul de `playheadTime` :

```jsx
const isLivePlay = isPlaying && playingFromRef.current?.trackId === t.id;
const playheadTime = isLivePlay
    ? (playingFromRef.current?.startTime ?? 0) + playerHeadTime
    : (selection?.trackId === t.id ? selection.time : null);
```

Maintenant le curseur reste visible à la dernière position après stop, et apparaît dès qu'on clique sur la waveform.

---

## 4. Temps affiché = position du curseur

Le compteur en haut affiche aujourd'hui :

```jsx
{playerHeadTime > 0 ? formatTime(playerHeadTime, true) : "0:00:000"}
```

Il ne reflète que `playerHeadTime` (qui est l'offset relatif depuis le début de lecture, et qui retombe à 0 dès qu'on stoppe).

### `src/AudioRecorder.jsx` — affichage unifié du temps

Calcule un `displayTime` qui marche dans les trois cas (lecture en cours, arrêté, après click) :

```jsx
const displayTime = isPlaying
    ? (playingFromRef.current?.startTime ?? 0) + playerHeadTime
    : (selection?.time ?? 0);
```

Et le rendu :

```jsx
<Box sx={{ fontSize: 12, color: "#666", paddingLeft: 2 }}>
    {formatTime(displayTime, true)}
</Box>
```

Comme `handleSeek(trackId, time)` met déjà à jour `selection` quand on clique sur une waveform (via le pointerup synthétique de `TrackView`), le temps affiché va se mettre à jour automatiquement à chaque click.

### Note

`formatTime` (importé depuis `Timeline.jsx`) accepte déjà `miliSeconds = true` pour afficher `m:ss.mmm`. Tu n'as rien à modifier de ce côté.

---

## Ordre d'attaque conseillé

1. **Bouton renommer** (le plus simple, isolé).
2. **Curseur stop** + **temps affiché** (les deux touchent à `selection` / `playheadTime`, autant les faire ensemble).
3. **Undo/redo** en dernier (plus invasif : tous les `setTracks` qui modifient l'EDL doivent passer par le wrapper historisé).

Si tu attaques undo/redo, fais-le **après** que renommage et stop-curseur soient stables, sinon tu vas devoir wrapper de nouveaux call-sites au fur et à mesure.
