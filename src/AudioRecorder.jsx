import { useState, useRef, useMemo } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import MicIcon from "@mui/icons-material/Mic";
import StopIcon from "@mui/icons-material/Stop";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";

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

export default function AudioRecorder({ audioUrl, obs, metadata }) {
    const audioCtxRef = useRef(null);
    const [tracks, setTracks] = useState([]);
    const [isPlaying, setIsPlaying] = useState(false);
    const [selection, setSelection] = useState(null); // { trackId, time }
    const [playerHeadTime, setPlayerHeadTime] = useState(0);
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

    const tick = () => {
        const elapsed = Math.max(
            0,
            audioCtxRef.current.currentTime - playStartedAtRef.current,
        );
        if (elapsed >= playEndsAtRef.current) {
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
        stopSources(sourcesRef.current);
        sourcesRef.current = [];
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        playingFromRef.current = null;
        setPlayerHeadTime(0);
        setIsPlaying(false);
    };

    // Clic sur une waveform → on retient piste + position, et on relance
    // la lecture depuis ce point si on est en train de jouer.
    const handleSeek = (trackId, time) => {
        setSelection({ trackId, time });
        if (isPlaying) startPlayback(trackId, time);
    };

    const deleteTrack = async (id) => {
        setTracks((ts) => ts.filter((t) => t.id !== id));
        if (selection?.trackId === id) setSelection(null);
        if (paths) await deleteAudioFile(paths, id).catch(() => {});
    };

    const demoCut = (id) => {
        setTracks((ts) =>
            ts.map((t) => {
                if (t.id !== id || t.buffer.duration < 2.1) return t;
                return {
                    ...t,
                    edl: [
                        makeSegment(0, 1),
                        makeSegment(2, t.buffer.duration),
                    ],
                };
            }),
        );
    };

    return (
        <Box sx={{ width: "100%", p: 2 }}>
            <Stack
                direction="row"
                spacing={1}
                sx={{ border: "1px solid #777",alignItems: "center" }}
            >
                <Box sx={{ fontSize: 12, color: "#666", paddingLeft: 2}}>
                    {playerHeadTime > 0 ? formatTime(playerHeadTime, true) : "0:00:000"}
                </Box>
                
                <IconButton
                    onClick={isPlaying ? stop : play}
                    disabled={tracks.length === 0}
                    color="primary"
                >
                    {isPlaying ? <StopIcon /> : <PlayArrowIcon />}
                </IconButton>
                <IconButton
                    onClick={isRecording ? stopRecording : startRecording}
                    color={isRecording ? "error" : "default"}
                    disabled={!paths}
                >
                    {isRecording ? <StopIcon /> : <MicIcon />}
                </IconButton>
            </Stack>
            {/* <Timeline projectDuration={projectDuration} /> */}
            {tracks.map((t) => {
                const isSel = selection?.trackId === t.id;
                // Le playhead suit la piste qu'on a *réellement* lancée,
                // pas la sélection en cours (qui peut changer pendant la lecture).
                const isLivePlay =
                    isPlaying && playingFromRef.current?.trackId === t.id;
                const playheadTime = isLivePlay
                    ? (playingFromRef.current?.startTime ?? 0) + playerHeadTime
                    : null;
                return (
                    <TrackView
                        key={t.id}
                        track={t}
                        projectDuration={projectDuration}
                        isSelected={isSel}
                        onSeek={handleSeek}
                        onDelete={() => deleteTrack(t.id)}
                        onDemoCut={() => demoCut(t.id)}
                        playheadTime={playheadTime}
                    />
                );
            })}
        </Box>
    );
}
