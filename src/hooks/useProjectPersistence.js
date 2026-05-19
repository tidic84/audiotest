import { useEffect, useState } from "react";
import { makeTrack } from "../lib/edl";
import {
    loadProject,
    saveProject,
    loadAudioBuffer,
    saveAudioBlob,
} from "../lib/storageUtil";

// Synchronise `tracks` avec le backend pithekos :
//   - au mount : charge `_project.json`, re-décode chaque .webm en AudioBuffer.
//   - si aucun projet sauvegardé et `audioUrl` fourni : l'importe comme première piste.
//   - à chaque modif de tracks : sauve le JSON (debounced 500 ms, sans les buffers).

export function useProjectPersistence({
    paths,
    audioCtxRef,
    audioUrl,
    tracks,
    setTracks,
}) {
    const [projectLoaded, setProjectLoaded] = useState(false);

    useEffect(() => {
        if (!paths) return;
        let cancelled = false;
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
                if (!cancelled) {
                    setTracks(loaded);
                    setProjectLoaded(true);
                }
                return;
            }

            if (!audioUrl) {
                setProjectLoaded(true);
                return;
            }
            const blob = await (await fetch(audioUrl)).blob();
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
        })();
        return () => {
            cancelled = true;
        };
    }, [paths, audioUrl]);

    useEffect(() => {
        if (!paths || !projectLoaded || tracks.length === 0) return;
        const handle = setTimeout(() => {
            saveProject(paths, {
                tracks: tracks.map(({ buffer, ...rest }) => rest),
            });
        }, 500);
        return () => clearTimeout(handle);
    }, [tracks, paths, projectLoaded]);

    return { projectLoaded };
}
