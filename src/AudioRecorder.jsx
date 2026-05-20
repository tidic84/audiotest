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

import TrackView from "./TrackView";
import { makeTrack, makeSegment, virtualDuration } from "./lib/edl";
import { scheduleTrackFrom, stopSources } from "./lib/playback";
import {
    projectPaths,
    saveAudioBlob,
    deleteAudioFile,
} from "./lib/storageUtil";
import { useProjectPersistence } from "./hooks/useProjectPersistence";
import { useRecorder } from "./hooks/useRecorder";
import Timeline from "./Timeline";
import { formatTime } from "./Timeline";
import { cutRange, extractRange, insertAt } from "./lib/edl";


export default function AudioRecorder({ audioUrl, obs, metadata }) {
    const audioCtxRef = useRef(null);
    const [tracks, setTracks] = useState([]);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playerHeadTime, setPlayerHeadTime] = useState(0);
    // Region/selection
    const [selection, setSelection] = useState(null); // { trackId, time }
    const [regionSelection, setRegionSelection] = useState(null); // { trackId, start, end }
    const [clipboard, setClipboard] = useState(null); // { buffer, segments }
    // undo/redo
    const [future, setFuture] = useState([]); // historique des actions apres le undo
    const [past, setPast] = useState([]); // historique des actions

    const playStartedAtRef = useRef(0);
    const playEndsAtRef = useRef(0);
    const playingFromRef = useRef(null); // { trackId, startTime } figé au play()
    const rafRef = useRef(null);
    const sourcesRef = useRef([]);

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

    const projectDuration = useMemo(
        () => tracks.reduce((max, t) => Math.max(max, virtualDuration(t)), 0),
        [tracks],
    );

    useProjectPersistence({ paths, audioCtxRef, audioUrl, tracks, setTracks });
    const { isRecording, startRecording, stopRecording } = useRecorder({
        paths,
        audioCtxRef,
        setTracks,
    });

    // Pour afficher le temps meme quand on ne joue pas de track
    const displayTime = isPlaying
        ? (playingFromRef.current?.startTime ?? 0) + playerHeadTime
        : (selection?.time ?? 0);

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

    // Démarre/redémarre la lecture sur (trackId, time).
    // Suppose que l'AudioContext est déjà actif.
    const startPlayback = (trackId, time) => {
        const track = tracks.find((t) => t.id === trackId);
        if (!track) return;
        stopSources(sourcesRef.current);
        sourcesRef.current = scheduleTrackFrom(
            audioCtxRef.current,
            track,
            time,
        );
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
        if (isPlaying) startPlayback(trackId, time);
    };

    const setTracksWithHistory = (updater) => {
        setPast(p => [...p, tracks]);
        setFuture([]);
        setTracks(updater);
    };

    const deleteTrack = async (id) => {
        setTracksWithHistory(ts => ts.filter(t => t.id !== id));
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
        setTracksWithHistory(ts => ts.map(t =>
            t.id === trackId ? { ...t, edl: cutRange(t.edl, start, end) } : t
        ));

        setRegionSelection(null);
    };

    const copySelection = () => {
        if (!regionSelection) return;
        const { trackId, start, end } = regionSelection;
        const track = tracks.find(t => t.id === trackId);
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
        setTracksWithHistory(ts => ts.map(t =>
            t.id === trackId ? { ...t, edl: insertAt(t.edl, time, clipboard.segments) } : t
        ));
    };

    const renameTrack = (trackId, newName) => {
        setTracks(ts => ts.map(t => t.id === trackId ? { ...t, name: newName } : t));
    };

    // Raccourci clavier
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

    return (
        <Box sx={{ width: "100%", p: 2 }}>
            <Stack
                direction="row"
                spacing={1}
                sx={{ border: "1px solid #777", alignItems: "center" }}
            >
                <Box sx={{ fontSize: 12, color: "#666", paddingLeft: 2 }}>
                    {formatTime(displayTime, true)}
                </Box>

                <IconButton
                    size="small"
                    onClick={isPlaying ? stop : play}
                    disabled={tracks.length === 0}
                >
                    {isPlaying ? <StopIcon /> : <PlayArrowIcon />}
                </IconButton>
                <IconButton
                    size="small"
                    onClick={isRecording ? stopRecording : startRecording}
                    color={isRecording ? "error" : "default"}
                    disabled={!paths}
                >
                    {isRecording ? <StopIcon /> : <MicIcon />}
                </IconButton>
                <IconButton
                    size="small"
                    onClick={copySelection}
                    disabled={!regionSelection}
                    title="Copy"
                >
                    <ContentCopyIcon fontSize="small" />
                </IconButton>
                <IconButton
                    size="small"
                    onClick={pasteAtCursor}
                    disabled={!clipboard || !selection}
                    title="Paste"
                >
                    <ContentPasteIcon fontSize="small" />
                </IconButton>
                <IconButton
                    size="small"
                    onClick={cutSelection}
                    disabled={!regionSelection}
                    title="Cut"
                >
                    <ContentCutIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" onClick={undo} disabled={past.length === 0} title="Undo">
                    <UndoIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" onClick={redo} disabled={future.length === 0} title="Redo">
                    <RedoIcon fontSize="small" />
                </IconButton>
            </Stack>
            {/* <Timeline projectDuration={projectDuration} /> */}
            {tracks.map((t) => {
                const isSel = selection?.trackId === t.id;
                // Le playhead suit la piste qu'on a *réellement* lancée,
                // pas la sélection en cours (qui peut changer pendant la lecture).
                const isLivePlay = isPlaying && playingFromRef.current?.trackId === t.id;
                const playheadTime = isLivePlay
                    ? (playingFromRef.current?.startTime ?? 0) + playerHeadTime
                    : (selection?.trackId === t.id ? selection.time : null);
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

                    />
                );
            })}
        </Box>
    );
}
