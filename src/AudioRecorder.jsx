import { useState, useRef, useMemo } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import MicIcon from "@mui/icons-material/Mic";
import StopIcon from "@mui/icons-material/Stop";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";

import TrackView from "./TrackView";
import { makeTrack, makeSegment, virtualDuration } from "./lib/edl";
import { scheduleTracks, stopSources } from "./lib/playback";
import {
    projectPaths,
    saveAudioBlob,
    deleteAudioFile,
} from "./lib/pithekosStorage";
import { useProjectPersistence } from "./hooks/useProjectPersistence";
import { useRecorder } from "./hooks/useRecorder";

export default function AudioRecorder({ audioUrl, obs, metadata }) {
    const audioCtxRef = useRef(null);
    const [tracks, setTracks] = useState([]);
    const [isPlaying, setIsPlaying] = useState(false);

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

    useProjectPersistence({ paths, audioCtxRef, audioUrl, tracks, setTracks });
    const { isRecording, startRecording, stopRecording } = useRecorder({
        paths,
        audioCtxRef,
        setTracks,
    });

    const play = () => {
        if (isPlaying || tracks.length === 0) return;
        sourcesRef.current = scheduleTracks(audioCtxRef.current, tracks);
        setIsPlaying(true);
        const maxDur = Math.max(...tracks.map(virtualDuration));
        setTimeout(() => setIsPlaying(false), maxDur * 1000 + 100);
    };

    const stop = () => {
        stopSources(sourcesRef.current);
        sourcesRef.current = [];
        setIsPlaying(false);
    };

    const deleteTrack = async (id) => {
        setTracks((ts) => ts.filter((t) => t.id !== id));
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
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
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

            {tracks.map((t) => (
                <TrackView
                    key={t.id}
                    track={t}
                    onDelete={() => deleteTrack(t.id)}
                    onDemoCut={() => demoCut(t.id)}
                />
            ))}
        </Box>
    );
}
