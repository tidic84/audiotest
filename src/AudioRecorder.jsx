import { useState, useRef, useEffect, useMemo } from "react";
import WavesurferPlayer from "@wavesurfer/react";
import MicIcon from "@mui/icons-material/Mic";
import StopIcon from "@mui/icons-material/Stop";
import IconButton from "@mui/material/IconButton";


// Un segment EDL pointe dans le buffer original.
// La timeline visible = concaténation des segments dans l'ordre.
// { id, srcStart, srcEnd } en secondes.

export default function AudioRecorder({ audioUrl }) {
    const audioCtxRef = useRef(null);
    const [originalBuffer, setOriginalBuffer] = useState(null); // immutable
    const [edl, setEdl] = useState([]);                          // mutable
    const [isPlaying, setIsPlaying] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const sourcesRef = useRef([]);

    // 1) Décode l'audio UNE SEULE FOIS, puis EDL initial = tout le buffer
    useEffect(() => {
        if (!audioUrl) return;
        audioCtxRef.current ??= new AudioContext();
        let cancelled = false;
        fetch(audioUrl)
            .then(r => r.arrayBuffer())
            .then(b => audioCtxRef.current.decodeAudioData(b))
            .then(decoded => {
                if (cancelled) return;
                setOriginalBuffer(decoded);
                setEdl([{ id: crypto.randomUUID(), srcStart: 0, srcEnd: decoded.duration }]);
            });
        return () => { cancelled = true; };
    }, [audioUrl]);

    // 2) Vues dérivées de l'EDL (jamais on ne re-décode l'audio)
    const virtualDuration = useMemo(
        () => edl.reduce((s, seg) => s + (seg.srcEnd - seg.srcStart), 0),
        [edl]
    );
    const virtualPeaks = useMemo(
        () => originalBuffer ? computeVirtualPeaks(originalBuffer, edl, 4000) : null,
        [originalBuffer, edl]
    );

    // 3) Lecture : on schedule chaque segment dans l'ordre via Web Audio
    const play = () => {
        if (!originalBuffer || isPlaying) return;
        const ctx = audioCtxRef.current;
        let when = ctx.currentTime;
        sourcesRef.current = edl.map(seg => {
            const src = ctx.createBufferSource();
            src.buffer = originalBuffer;
            src.connect(ctx.destination);
            const dur = seg.srcEnd - seg.srcStart;
            src.start(when, seg.srcStart, dur);
            when += dur;
            return src;
        });
        setIsPlaying(true);
        sourcesRef.current[sourcesRef.current.length - 1].onended = () => setIsPlaying(false);
    };

    const stop = () => {
        sourcesRef.current.forEach(s => { try { s.stop(); } catch { } });
        sourcesRef.current = [];
        setIsPlaying(false);
    };

    // Démo : supprimer 1s à 2s pour prouver que tout réagit sans recharger l'audio
    const demoCut = () => {
        if (!originalBuffer) return;
        setEdl([
            { id: crypto.randomUUID(), srcStart: 0, srcEnd: 1 },
            { id: crypto.randomUUID(), srcStart: 2, srcEnd: originalBuffer.duration },
        ]);
    };

    const startRecording = async () => {
    };

    return (
        <div style={{ width: "100%", padding: 16 }}>
            <div style={{ marginBottom: 8 }}>
                <button onClick={isPlaying ? stop : play} disabled={!originalBuffer}>
                    {isPlaying ? "■ Stop" : "▶ Play"}
                </button>
                <button onClick={demoCut} disabled={!originalBuffer} style={{ marginLeft: 8 }}>
                    Couper 1s→2s (démo)
                </button>
                <span style={{ marginLeft: 12 }}>Durée : {virtualDuration.toFixed(2)}s</span>
                <IconButton
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={isRecordingRef.current && !isRecording}
                    sx={{ color: "white" }}
                >
                    {" "}
                    {isRecording ? <StopIcon sx={{ color: "red" }} /> : <MicIcon />}
                    {" "}
                </IconButton>
            </div>
            {virtualPeaks && (
                <WavesurferPlayer
                    height={100}
                    waveColor="#4a9eff"
                    progressColor="#1565c0"
                    peaks={[virtualPeaks]}
                    duration={virtualDuration}
                />
            )}
        </div>
    );
}



// Construit les peaks de la timeline virtuelle à partir du buffer + EDL.
// Une seule passe : pour chaque segment, on remplit sa portion du tableau de sortie.
function computeVirtualPeaks(buffer, edl, targetLen) {
    const ch = buffer.getChannelData(0);
    const sr = buffer.sampleRate;
    const total = edl.reduce((s, seg) => s + (seg.srcEnd - seg.srcStart), 0);
    const peaks = new Float32Array(targetLen);
    if (total === 0) return peaks;

    let virt = 0;
    for (const seg of edl) {
        const segDur = seg.srcEnd - seg.srcStart;
        const b0 = Math.floor((virt / total) * targetLen);
        const b1 = Math.floor(((virt + segDur) / total) * targetLen);
        const s0 = Math.floor(seg.srcStart * sr);
        const s1 = Math.floor(seg.srcEnd * sr);
        const binSize = (s1 - s0) / Math.max(b1 - b0, 1);
        for (let i = b0; i < b1; i++) {
            const a = Math.floor(s0 + (i - b0) * binSize);
            const b = Math.floor(s0 + (i - b0 + 1) * binSize);
            let max = 0;
            for (let j = a; j < b && j < ch.length; j++) {
                const v = Math.abs(ch[j]);
                if (v > max) max = v;
            }
            peaks[i] = max;
        }
        virt += segDur;
    }
    return peaks;
}

