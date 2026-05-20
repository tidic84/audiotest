import { useEffect, useRef, useState } from "react";
import { makeTrack } from "../lib/edl";
import {
    loadProject,
    saveProject,
    loadAudioBuffer,
    saveAudioBlob,
} from "../lib/storageUtil";

// Synchronise `tracks` avec le backend :
//   - au mount : charge `_project.json`, re-décode chaque .webm en AudioBuffer.
//   - si aucun projet sauvegardé au tout premier mount et `audioUrl` fourni : l'importe comme première piste.
//   - à chaque modif de tracks : sauve le JSON (debounced 500 ms, sans les buffers).

export function useProjectPersistence({
    paths,
    audioCtxRef,
    audioUrl,
    tracks,
    setTracks,
}) {
    const [projectLoaded, setProjectLoaded] = useState(false);
    // Le fallback audioUrl ne doit s'appliquer qu'au tout premier mount, pas à chaque
    // navigation OBS — sinon naviguer sur un OBS vide ré-importerait la démo.
    const initialLoadRef = useRef(true);

    useEffect(() => {
        if (!paths) return;
        let cancelled = false;
        const isInitial = initialLoadRef.current;
        initialLoadRef.current = false;
        // Reset immédiat : on affiche l'état vide pendant le chargement et si rien n'est trouvé.
        setProjectLoaded(false);
        setTracks([]);
        (async () => {
            audioCtxRef.current ??= new AudioContext();
            const proj = await loadProject(paths);
            if (cancelled) return;

            if (proj?.tracks?.length) {
                const loaded = await Promise.all(
                    proj.tracks.map(async (t) => ({
                        ...t,
                        buffer: await loadAudioBuffer(
                            audioCtxRef.current,
                            paths,
                            t.id,
                        ),
                    })),
                );
                // Drop les pistes dont le buffer n'a pas pu être chargé (fichier manquant/corrompu).
                const valid = loaded.filter((t) => t.buffer);
                const buffersById = new Map(valid.map((t) => [t.id, t.buffer]));
                const resolved = valid.map((t) => ({
                    ...t,
                    edl: t.edl.map((seg) => ({
                        ...seg,
                        buffer: seg.bufferTrackId
                            ? buffersById.get(seg.bufferTrackId) || null
                            : null,
                    })),
                }));
                if (!cancelled) {
                    setTracks(resolved);
                    setProjectLoaded(true);
                }
                return;
            }

            if (!isInitial || !audioUrl) {
                if (!cancelled) setProjectLoaded(true);
                return;
            }
            try {
                const res = await fetch(audioUrl);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();
                const buffer = await audioCtxRef.current.decodeAudioData(
                    await blob.arrayBuffer(),
                );
                if (cancelled) return;
                const track = makeTrack(buffer, "Piste 1");
                await saveAudioBlob(paths, track.id, blob);
                if (!cancelled) {
                    setTracks([track]);
                    setProjectLoaded(true);
                }
            } catch {
                if (!cancelled) setProjectLoaded(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [paths, audioUrl]);

    useEffect(() => {
        if (!paths || !projectLoaded || tracks.length === 0) return;
        const handle = setTimeout(() => {
            saveProject(paths, {
                tracks: tracks.map(({ buffer, edl, ...rest }) => ({
                    ...rest,
                    // On strip seg.buffer (AudioBuffer non sérialisable) ; bufferTrackId suffit
                    // pour ré-attacher la réf au reload.
                    edl: edl.map(({ buffer: _b, ...segRest }) => segRest),
                })),
            });
        }, 500);
        return () => clearTimeout(handle);
    }, [tracks, paths, projectLoaded]);

    return { projectLoaded };
}
