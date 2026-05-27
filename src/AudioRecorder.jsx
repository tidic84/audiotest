import { useState, useRef, useMemo, useEffect } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import MicIcon from "@mui/icons-material/MicNoneOutlined";
import StopIcon from "@mui/icons-material/StopOutlined";
import PlayArrowIcon from "@mui/icons-material/PlayArrowOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";
import ContentPasteIcon from "@mui/icons-material/ContentPasteOutlined";
import ContentCutIcon from "@mui/icons-material/ContentCutOutlined";
import UndoIcon from "@mui/icons-material/UndoOutlined";
import RedoIcon from "@mui/icons-material/RedoOutlined";
import Divider from "@mui/material/Divider";

import TrackView from "./TrackView";
import { scheduleTrackFrom, stopSources } from "./lib/playback";
import TimelineAxis from "./trackview/TimelineAxis";
import LiveRecordingLane from "./trackview/LiveRecordingLane";
import {
    projectPaths,
    deleteAudioFile,
} from "./lib/storageUtil";
import { useProjectPersistence } from "./hooks/useProjectPersistence";
import { useRecorder } from "./hooks/useRecorder";
import { formatTime } from "./Timeline";
import { cutRange, extractRange, insertAt, splitAt, trimSegment, removeSegment, insertSegmentAt, virtualDuration } from "./lib/edl";
import { pickTickInterval } from "./lib/snap";
import SplitIcon from "./SplitIcon";
// import GestureIcon from "./GestureIcon";

export default function AudioRecorder({ audioUrl, obs, metadata }) {
    const audioCtxRef = useRef(null);
    const [tracks, setTracks] = useState([]);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playerHeadTime, setPlayerHeadTime] = useState(0);
    // Region/selection
    const [selection, setSelection] = useState(null); // { trackId, time }
    const [regionSelection, setRegionSelection] = useState(null); // { trackId, start, end }
    // Sélection de clip(s) : tableau d'entrées {trackId, segId}. Permet multi-sélection
    // cross-tracks via Ctrl/Cmd. Le ref `clipSelectionAnchor` retient le pivot pour
    // l'extension Shift-clic (range sur la même piste).
    const [clipSelection, setClipSelection] = useState([]);
    const clipSelectionAnchorRef = useRef(null);
    const [clipboard, setClipboard] = useState(null); // { buffer, segments }
    // undo/redo
    const [future, setFuture] = useState([]); // historique des actions apres le undo
    const [past, setPast] = useState([]); // historique des actions

    const playStartedAtRef = useRef(0);
    const playEndsAtRef = useRef(0);
    const playingFromRef = useRef(null); // { trackId, startTime } figé au play()
    const rafRef = useRef(null);
    const sourcesRef = useRef([]);

    // Snap
    const [snapEnabled, setSnapEnabled] = useState(() => localStorage.getItem("snapEnabled") !== "false")

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

    const paths = useMemo(
        () =>
            metadata?.local_path && obs
                ? projectPaths({
                    localPath: metadata.local_path,
                    chapter: obs[0],
                    paragraph: obs[1],
                })
                : null,
        [metadata?.local_path, obs],
    );

    useProjectPersistence({ paths, audioCtxRef, audioUrl, tracks, setTracks });
    const {
        isRecording,
        startRecording,
        stopRecording,
        recordingDuration,
        peaksRef,
        sampleHz,
    } = useRecorder({
        paths,
        audioCtxRef,
        setTracks,
    });

    const projectDuration = useMemo(
        () => {
            const trackMax = tracks.reduce((max, t) => Math.max(max, virtualDuration(t)), 0);
            if (recordingDuration <= 0) return trackMax;
            // Pendant l'enregistrement, élargit la timeline par paliers de 5s
            // avec ~5s de marge à droite. Donne de la place au clip live pour
            // grandir visuellement, et évite que pxPerSec change à chaque tick
            // d'update de recordingDuration (saut tous les 5s seulement).
            const liveWindow = Math.max(10, Math.ceil(recordingDuration / 5) * 5 + 5);
            return Math.max(trackMax, liveWindow);
        },
        [tracks, recordingDuration],
    );

    // snapStep = même intervalle que les ticks affichés par TimelineAxis.
    // Quand on zoome/dézoome (projectDuration change), le snap suit la grille.
    const snapStep = pickTickInterval(projectDuration);

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

    // Pour afficher le temps meme quand on ne joue pas de track
    const displayTime = isPlaying
        ? (playingFromRef.current?.startTime ?? 0) + playerHeadTime
        : (selection?.time ?? 0);

    const tick = () => {
        const elapsed = Math.max(
            0,
            audioCtxRef.current.currentTime - playStartedAtRef.current,
        );
        if (elapsed >= playEndsAtRef.current) {
            // Met le curseur à la fin de la piste
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

    // Démarre/redémarre la lecture sur (trackId, time).
    // Suppose que l'AudioContext est déjà actif.
    const startPlayback = (trackId, time) => {
        const track = tracks.find((t) => t.id === trackId);
        if (!track) return;
        stopSources(sourcesRef.current);
        sourcesRef.current = scheduleTrackFrom(audioCtxRef.current, track, time);
        playStartedAtRef.current = audioCtxRef.current.currentTime + 0.05;
        playEndsAtRef.current = virtualDuration(track) - time;
        playingFromRef.current = { trackId, startTime: time };
        setPlayerHeadTime(0);
        setIsPlaying(true);
        if (rafRef.current == null) {
            rafRef.current = requestAnimationFrame(tick);
        }
    };

    const play = async () => {
        if (isPlaying || tracks.length === 0) return;
        if (audioCtxRef.current.state === "suspended") {
            await audioCtxRef.current.resume();
        }
        const trackId = selection?.trackId ?? tracks[0].id;
        const time = selection?.time ?? 0;
        startPlayback(trackId, time);
    };

    const stop = () => {
        // capture la pos du cursuer avant de reset
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

        // remet la pos du curseur
        if (trackId != null) {
            setSelection({ trackId, time: currentPos });
        }
    };

    // Clic sur une waveform ->> on retient piste + position, et on relance la lecture depuis ce point si on est en train de jouer.
    const handleSeek = (trackId, time) => {
        setSelection({ trackId, time });
        // Un seek (clic playhead) efface la sélection de clip : seul un clic
        // sur le header d'un clip doit la maintenir/étendre.
        setClipSelection([]);
        clipSelectionAnchorRef.current = null;
        if (isPlaying) startPlayback(trackId, time);
    };

    // Sélection clip(s) — appelée depuis le header d'un clip.
    // mods : { ctrlKey, shiftKey } pour multi/range.
    const handleClipSelect = (trackId, segId, mods = {}) => {
        const { ctrlKey, shiftKey } = mods;
        // Shift-clic : étend depuis l'anchor sur la même piste (range par vStart).
        if (shiftKey && clipSelectionAnchorRef.current) {
            const anchor = clipSelectionAnchorRef.current;
            if (anchor.trackId === trackId) {
                const track = tracks.find((t) => t.id === trackId);
                if (track) {
                    const a = track.edl.find((s) => s.id === anchor.segId);
                    const b = track.edl.find((s) => s.id === segId);
                    if (a && b) {
                        const lo = Math.min(a.vStart, b.vStart);
                        const hi = Math.max(a.vStart, b.vStart);
                        const next = track.edl
                            .filter((s) => s.vStart >= lo && s.vStart <= hi)
                            .map((s) => ({ trackId, segId: s.id }));
                        setClipSelection(next);
                        // anchor inchangé
                        setRegionSelection(null);
                        return;
                    }
                }
            }
            // anchor sur une autre piste -> fallback : sélection simple
        }
        // Ctrl/Cmd : toggle ce clip dans la sélection.
        if (ctrlKey) {
            setClipSelection((prev) => {
                const idx = prev.findIndex(
                    (c) => c.trackId === trackId && c.segId === segId,
                );
                if (idx >= 0) {
                    const next = prev.slice();
                    next.splice(idx, 1);
                    return next;
                }
                return [...prev, { trackId, segId }];
            });
            clipSelectionAnchorRef.current = { trackId, segId };
            setRegionSelection(null);
            return;
        }
        // Clic simple : remplace la sélection par ce seul clip.
        setClipSelection([{ trackId, segId }]);
        clipSelectionAnchorRef.current = { trackId, segId };
        setRegionSelection(null);
    };

    const clearClipSelection = () => {
        setClipSelection([]);
        clipSelectionAnchorRef.current = null;
    };

    const deleteSelectedClips = () => {
        if (clipSelection.length === 0) return;
        // Groupe les segIds par trackId pour faire un seul update par piste.
        const byTrack = new Map();
        for (const { trackId, segId } of clipSelection) {
            if (!byTrack.has(trackId)) byTrack.set(trackId, new Set());
            byTrack.get(trackId).add(segId);
        }
        setTracksWithHistory((ts) =>
            ts.map((t) => {
                const ids = byTrack.get(t.id);
                if (!ids) return t;
                return { ...t, edl: t.edl.filter((s) => !ids.has(s.id)) };
            }),
        );
        clearClipSelection();
    };

    const deleteRegionWithoutCopy = () => {
        if (!regionSelection) return;
        const { trackId, start, end } = regionSelection;
        setTracksWithHistory((ts) =>
            ts.map((t) =>
                t.id === trackId ? { ...t, edl: cutRange(t.edl, start, end) } : t,
            ),
        );
        setRegionSelection(null);
    };

    const setTracksWithHistory = (updater) => {
        setPast((p) => [...p, tracks]);
        setFuture([]);
        setTracks(updater);
    };

    const deleteTrack = async (id) => {
        setTracksWithHistory((ts) => ts.filter((t) => t.id !== id));
        if (selection?.trackId === id) setSelection(null);
        if (paths) await deleteAudioFile(paths, id).catch(() => { });
    };

    const cutSelection = () => {
        if (!regionSelection) return;
        const { trackId, start, end } = regionSelection;
        // setTracks(ts => ts.map(t =>
        //     t.id === trackId ? { ...t, edl: cutRange(t.edl, start, end) } : t
        // ));
        copySelection();
        setTracksWithHistory((ts) =>
            ts.map((t) =>
                t.id === trackId ? { ...t, edl: cutRange(t.edl, start, end) } : t,
            ),
        );

        setRegionSelection(null);
    };

    const copySelection = () => {
        if (!regionSelection) return;
        const { trackId, start, end } = regionSelection;
        const track = tracks.find((t) => t.id === trackId);
        if (!track) return;
        // Tag chaque segment extrait avec le buffer source + l'id de la piste source.
        // - le buffer permet le paste runtime (réf directe)
        // - l'id permet de ré-attacher le buffer après un reload de projet
        const segs = extractRange(track.edl, start, end, track.buffer, track.id);
        if (!segs.length) return;
        setClipboard({ segments: segs });
    };

    const pasteAtCursor = () => {
        if (!clipboard || !selection) return;
        const { trackId, time } = selection;
        setTracksWithHistory((ts) =>
            ts.map((t) =>
                t.id === trackId
                    ? { ...t, edl: insertAt(t.edl, time, clipboard.segments) }
                    : t,
            ),
        );
    };

    const renameTrack = (trackId, newName) => {
        setTracks((ts) =>
            ts.map((t) => (t.id === trackId ? { ...t, name: newName } : t)),
        );
    };

    // Raccourci clavier
    useEffect(() => {
        const onKey = (e) => {
            const isCmd = e.ctrlKey || e.metaKey;

            // Undo shortcut
            if (isCmd && e.key.toLowerCase() === "z" && !e.shiftKey) {
                e.preventDefault();
                undo();
            }
            // Redo shortcut
            else if (
                (isCmd && e.key.toLowerCase() === "y") ||
                (isCmd && e.shiftKey && e.key.toLowerCase() === "z")
            ) {
                e.preventDefault();
                redo();
            }
            // Copy shortcut
            else if (isCmd && e.key.toLowerCase() === "c") {
                e.preventDefault();
                copySelection();
            }
            // Paste shortcut
            else if (isCmd && e.key.toLowerCase() === "v") {
                e.preventDefault();
                pasteAtCursor();
            }
            // Cut shortcut
            else if (isCmd && e.key.toLowerCase() === "x") {
                e.preventDefault();
                cutSelection();
            }
            // Suppr/Backspace : selon le contexte
            else if (e.key === "Delete" || e.key === "Backspace") {
                // Ignore quand on tape dans un input (rename, etc.)
                const tag = e.target?.tagName;
                if (tag === "INPUT" || tag === "TEXTAREA") return;
                if (clipSelection.length > 0) {
                    e.preventDefault();
                    deleteSelectedClips();
                } else if (regionSelection) {
                    e.preventDefault();
                    deleteRegionWithoutCopy();
                }
            }
            // Echap : efface la sélection de clips
            else if (e.key === "Escape") {
                if (clipSelection.length > 0) clearClipSelection();
            }
            // Espace : Play / Pause
            else if (e.key === " ") {
                console.log("isPlaying", isPlaying);
                e.preventDefault();
                if (isPlaying) stop();
                else play();
            }
            // S : Split sur le Playherd
            else if (e.key === "s") {
                e.preventDefault();
                splitAtPlayhead();
            }
            else if (isCmd &&e.key === "a") {
                e.preventDefault();
                selectAllClips();
            }
            else if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                e.preventDefault();
                nudgeSelectedClips(
                    e.key === "ArrowLeft" ? -snapStep / 10 : snapStep / 10,
                    !e.repeat,
                );
            }
            else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                nudgeSelectedClips(
                    e.key === "ArrowLeft" ? -snapStep : snapStep,
                    !e.repeat,
                );
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [past, future, tracks, selection, regionSelection, clipboard, clipSelection, isPlaying, playerHeadTime]);

    // Affiche le GestureIcon à côté du curseur tant que Ctrl/Cmd est maintenu.
    const [ctrlHeld, setCtrlHeld] = useState(false);
    const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });

    useEffect(() => {
        const onDown = (e) => {
            if (e.key === "Control" || e.key === "Meta") setCtrlHeld(true);
        };
        const onUp = (e) => {
            if (e.key === "Control" || e.key === "Meta") setCtrlHeld(false);
        };
        // Au cas où la fenêtre perd le focus pendant qu'on maintient la touche.
        const onBlur = () => setCtrlHeld(false);
        window.addEventListener("keydown", onDown);
        window.addEventListener("keyup", onUp);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("keydown", onDown);
            window.removeEventListener("keyup", onUp);
            window.removeEventListener("blur", onBlur);
        };
    }, []);

    useEffect(() => {
        if (!ctrlHeld) return;
        const onMove = (e) => setCursorPos({ x: e.clientX, y: e.clientY });
        window.addEventListener("mousemove", onMove);
        return () => window.removeEventListener("mousemove", onMove);
    }, [ctrlHeld]);

    const undo = () => {
        if (past.length === 0) return;
        const prev = past[past.length - 1];
        setPast((p) => p.slice(0, -1));
        setFuture((f) => [tracks, ...f]);
        setTracks(prev);
    };

    const redo = () => {
        if (future.length === 0) return;
        const next = future[0];
        setFuture((f) => f.slice(1));
        setPast((p) => [...p, tracks]);
        setTracks(next);
    };

    // Split à la position du playhead (suit le curseur en lecture).
    const splitAtPlayhead = () => {
        const trackId = isPlaying
            ? playingFromRef.current?.trackId
            : selection?.trackId;
        if (trackId == null) return;
        const time = isPlaying
            ? (playingFromRef.current?.startTime ?? 0) + playerHeadTime
            : (selection?.time ?? 0);
        setTracksWithHistory((ts) =>
            ts.map((t) =>
                t.id === trackId ? { ...t, edl: splitAt(t.edl, time) } : t
            )
        );
    };

    const selectAllClips = () => {
        const all = [];
        for (const t of tracks) for (const s of t.edl) all.push({ trackId: t.id, segId: s.id });
        setClipSelection(all);
        clipSelectionAnchorRef.current = all[0] ?? null;
        setRegionSelection(null);
    };

    // Nudge des clips sélectionnés.
    // `pushHistory = true` au premier keydown → on push l'état dans `past`
    // (= une entrée d'undo pour toute la session de touche maintenue).
    // `pushHistory = false` sur les repeats → on met juste à jour `tracks`
    // sans empiler de nouvelle entrée. L'undo ramène à l'état pré-session.
    const nudgeSelectedClips = (deltaSec, pushHistory = true) => {
        if (clipSelection.length === 0) return;
        const byTrack = new Map();
        for (const { trackId, segId } of clipSelection) {
            if (!byTrack.has(trackId)) byTrack.set(trackId, new Set());
            byTrack.get(trackId).add(segId);
        }
        const updater = (ts) => ts.map((t) => {
            const ids = byTrack.get(t.id);
            if (!ids) return t;
            return {
                ...t,
                edl: t.edl.map((s) =>
                    ids.has(s.id) ? { ...s, vStart: Math.max(0, s.vStart + deltaSec) } : s,
                ),
            };
        });
        if (pushHistory) {
            setTracksWithHistory(updater);
        } else {
            setTracks(updater);
        }
    };

    // Drag intra-piste : punch-in à la nouvelle position absolue.
    // On retire d'abord le segment source (pour qu'insertSegmentAt ne le
    // coupe pas avec lui-même), puis on l'insère : cutRange efface ce qui
    // chevauche [newVStart, newVStart + dur].
    const moveClip = (trackId, segId, newVStart) => {
        setTracksWithHistory((ts) =>
            ts.map((t) => {
                if (t.id !== trackId) return t;
                const seg = t.edl.find((s) => s.id === segId);
                if (!seg) return t;
                const withoutSrc = removeSegment(t.edl, segId);
                return { ...t, edl: insertSegmentAt(withoutSrc, seg, newVStart) };
            }),
        );
    };

    const moveClipAcrossTracks = (srcTrackId, dstTrackId, segId, newVStart) => {
        if (srcTrackId === dstTrackId) return;
        const srcTrack = tracks.find((t) => t.id === srcTrackId);
        if (!srcTrack) return;
        const seg = srcTrack.edl.find((s) => s.id === segId);
        if (!seg) return;

        // Préserve buffer + bufferTrackId. Si le segment n'en avait pas (= clip "natif" de la piste source), on les remplit maintenant : sinon le segment basculerait sur le buffer de la piste cible et lirait le mauvais son.
        const portableSeg = {
            ...seg,
            buffer: seg.buffer ?? srcTrack.buffer,
            bufferTrackId: seg.bufferTrackId ?? srcTrack.id,
        };

        setTracksWithHistory((ts) =>
            ts.map((t) => {
                if (t.id === srcTrackId) {
                    return { ...t, edl: removeSegment(t.edl, segId) }
                }
                if (t.id === dstTrackId) {
                    const next = insertSegmentAt(t.edl, portableSeg, newVStart);
                    return { ...t, edl: next }
                }
                return t;
            })
        );
    }

    const trimClip = (trackId, segId, deltaLeft, deltaRight) => {
        setTracksWithHistory((ts) =>
            ts.map((t) =>
                t.id === trackId ? { ...t, edl: trimSegment(t.edl, segId, deltaLeft, deltaRight) } : t
            )
        );
    };
    
    const platform = navigator.userAgentData?.platform;
    const ctrlKeyTitle = platform.includes("Mac") ? "Cmd" : "Ctrl";

    return (
        <Box sx={{ width: "100%", p: 2 }}>
            <Stack
                direction="row"
                spacing={1}
                sx={{ border: "2px solid #777", alignItems: "center" }}
            >
                <Box sx={{ color: "#666", paddingLeft: 2, fontWeight: "bold", fontSize: 14 }}>
                    {formatTime(displayTime, true)}
                </Box>

                <IconButton
                    size="small"
                    onClick={isPlaying ? stop : play}
                    disabled={tracks.length === 0}
                    title={isPlaying ? "Stop (space)" : "Play (space)"}
                >
                    {isPlaying ? <StopIcon /> : <PlayArrowIcon />}
                </IconButton>
                <IconButton
                    size="small"
                    onClick={isRecording ? stopRecording : startRecording}
                    color={isRecording ? "error" : "default"}
                    disabled={!paths}
                    title={isRecording ? "Stop recording (R)" : "Record (R)"}
                >
                    {isRecording ? <StopIcon /> : <MicIcon />}
                </IconButton>
                <IconButton
                    size="small"
                    onClick={copySelection}
                    disabled={!regionSelection}
                    title={`Copy ( ${ctrlKeyTitle} + C)`}
                >
                    <ContentCopyIcon fontSize="small" />
                </IconButton>
                <IconButton
                    size="small"
                    onClick={pasteAtCursor}
                    disabled={!clipboard || !selection}
                    title="Paste ( Ctrl + V)"
                >
                    <ContentPasteIcon fontSize="small" />
                </IconButton>
                <IconButton
                    size="small"
                    onClick={cutSelection}
                    disabled={!regionSelection}
                    title="Cut ( Ctrl + X)"
                >
                    <ContentCutIcon fontSize="small" />
                </IconButton>
                <IconButton
                    size="small"
                    onClick={splitAtPlayhead}
                    disabled={!selection && !isPlaying}
                    title="Split at cursor (S)"
                >
                    <SplitIcon fontSize="small" />
                </IconButton>
                <IconButton
                    size="small"
                    onClick={undo}
                    disabled={past.length === 0}
                    title="Undo ( Ctrl + Z)"
                >
                    <UndoIcon fontSize="small" />
                </IconButton>
                <IconButton
                    size="small"
                    onClick={redo}
                    disabled={future.length === 0}
                    title="Redo ( Ctrl + Y)"
                >
                    <RedoIcon fontSize="small" />
                </IconButton>
            </Stack>

            <Box sx={{ border: "2px solid #777", borderTop: "0px solid #777" }}>
                <Stack direction="row" alignItems="stretch" spacing={1}>
                    <Box
                        ref={laneRef}
                        sx={{ flex: 1, minWidth: 0, position: "relative", height: 16, paddingBottom: 0}}
                    >
                        <TimelineAxis projectDuration={projectDuration} pxPerSec={pxPerSec} isTopAxis={true}/>
                    </Box>
                    <Divider orientation="vertical" flexItem sx={{ alignSelf: "stretch", borderColor: "transparent" }} />
                    <Stack spacing={0} paddingRight={4} paddingLeft={0} margin={0}>
                        <Box minWidth={110} maxWidth={110} />
                    </Stack>
                </Stack>

                {tracks.length > 0 ? (
                    tracks.map((t) => {
                        const isSel = selection?.trackId === t.id;
                        // Le playhead suit la piste qu'on a *réellement* lancée,
                        // pas la sélection en cours (qui peut changer pendant la lecture).
                        const isLivePlay =
                            isPlaying && playingFromRef.current?.trackId === t.id;
                        const playheadTime = isLivePlay
                            ? (playingFromRef.current?.startTime ?? 0) + playerHeadTime
                            : selection?.trackId === t.id
                                ? selection.time
                                : null;
                        return (
                            <TrackView
                                key={t.id}
                                track={t}
                                projectDuration={projectDuration}
                                isSelected={isSel}
                                onSeek={handleSeek}
                                onDelete={() => deleteTrack(t.id)}
                                playheadTime={playheadTime}
                                regionSelection={regionSelection}
                                onRegionChange={setRegionSelection}
                                onRename={renameTrack}
                                pxPerSec={pxPerSec}
                                onClipMove={moveClip}
                                onClipMoveAcrossTracks={moveClipAcrossTracks}
                                onClipTrim={trimClip}
                                clipSelection={clipSelection}
                                onClipSelect={handleClipSelect}
                                onClearClipSelection={clearClipSelection}
                                getSnapCandidates={getSnapCandidates}
                                snapEnabled={snapEnabled}
                                snapStep={snapStep}
                            />
                        );
                    })
                ) : !isRecording ? (
                    <Box sx={{ color: "#666", p: 4, borderBottom: "1px solid #777", borderLeft: "1px solid #777", borderRight: "1px solid #777" }}>
                        No tracks to display
                    </Box>
                ) : null}
            </Box>

            {isRecording && (
                <LiveRecordingLane
                    peaksRef={peaksRef}
                    pxPerSec={pxPerSec}
                    sampleHz={sampleHz}
                    trackNumber={tracks.length + 1}
                />
            )}

            {/* {ctrlHeld && (
                <Box
                    sx={{
                        position: "fixed",
                        top: cursorPos.y + 12,
                        left: cursorPos.x + 12,
                        pointerEvents: "none",
                        zIndex: 9999,
                        color: "#555",
                    }}
                >
                    <GestureIcon />
                </Box>
            )} */}
        </Box>
    );
}
