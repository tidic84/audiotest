import { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";

// Lane affichée pendant l'enregistrement. Mime visuellement une vraie
// piste (mêmes bords, mêmes couleurs que les clips), avec un indicateur
// REC qui pulse à la place des boutons rename/delete.
//
// Le clip est animé via rAF (DOM direct, sans re-render) : sa largeur =
// peaks.length / sampleHz * pxPerSec — donc il grandit à 60fps, et
// pxPerSec change seulement quand la timeline change de palier (par
// paliers de 5s côté AudioRecorder).
const LANE_HEIGHT = 80;
const HEADER_HEIGHT = 12;
const INSET_X = 1;
const INSET_Y = 2;
const COLOR = "rgb(34, 173, 197)";

export default function LiveRecordingLane({ peaksRef, pxPerSec, sampleHz, trackNumber }) {
    const clipRef = useRef(null);
    const canvasRef = useRef(null);
    const rafRef = useRef(null);
    // pxPerSec change par paliers ; on lit la valeur courante via une ref
    // pour ne pas relancer le rAF à chaque update.
    const pxPerSecRef = useRef(pxPerSec);
    pxPerSecRef.current = pxPerSec;

    useEffect(() => {
        const canvas = canvasRef.current;
        const clip = clipRef.current;
        if (!canvas || !clip) return;

        const draw = () => {
            const peaks = peaksRef.current;
            const pps = pxPerSecRef.current;
            const elapsedSec = peaks.length / sampleHz;
            // Largeur du clip en pixels — grandit à chaque peak poussé.
            // Minimum 4px pour qu'on voie le clip dès t=0.
            const clipW = Math.max(4, elapsedSec * pps);
            clip.style.width = `${clipW}px`;

            // Le canvas couvre la zone waveform du clip (parent direct).
            const parent = canvas.parentElement;
            if (parent) {
                const w = parent.clientWidth;
                const h = parent.clientHeight;
                const dpr = window.devicePixelRatio || 1;
                if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
                    canvas.width = Math.floor(w * dpr);
                    canvas.height = Math.floor(h * dpr);
                    canvas.style.width = `${w}px`;
                    canvas.style.height = `${h}px`;
                }
                const ctx = canvas.getContext("2d");
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.clearRect(0, 0, w, h);

                if (peaks.length && pps > 0) {
                    ctx.fillStyle = COLOR;
                    const secondsPerPeak = 1 / sampleHz;
                    const barW = secondsPerPeak * pps;
                    const mid = h / 2;
                    for (let i = 0; i < peaks.length; i++) {
                        const barH = peaks[i] * mid;
                        ctx.fillRect(i * barW, mid - barH, Math.max(barW - 0.5, 0.5), barH * 2);
                    }
                }
            }

            rafRef.current = requestAnimationFrame(draw);
        };
        rafRef.current = requestAnimationFrame(draw);
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [peaksRef, sampleHz]);

    return (
        <Box sx={{ border: "1px solid #777" }}>
            <Stack direction="row" alignItems="stretch" spacing={1}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box
                        sx={{
                            position: "relative",
                            width: "100%",
                            height: LANE_HEIGHT,
                            background: "#fafafa",
                            overflow: "hidden",
                        }}
                    >
                        {/* Clip live — largeur ajustée dynamiquement via rAF (style.width) */}
                        <Box
                            ref={clipRef}
                            sx={{
                                position: "absolute",
                                left: INSET_X,
                                top: INSET_Y,
                                bottom: INSET_Y,
                                width: "4px",
                                border: "1px solid rgb(21, 119, 137)",
                                borderRadius: "5px",
                                background: "rgba(34, 173, 197, 0.22)",
                                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.18)",
                                overflow: "hidden",
                                display: "flex",
                                flexDirection: "column",
                            }}
                        >
                            <Box
                                sx={{
                                    height: HEADER_HEIGHT,
                                    background:
                                        "linear-gradient(180deg, rgba(21,119,137,0.85), rgba(21,119,137,0.55))",
                                    borderBottom: "1px solid rgba(0, 0, 0, 0.15)",
                                    flexShrink: 0,
                                }}
                            />
                            <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
                                <canvas
                                    ref={canvasRef}
                                    style={{
                                        display: "block",
                                        position: "absolute",
                                        top: 0,
                                        left: 0,
                                    }}
                                />
                            </Box>
                        </Box>
                    </Box>
                </Box>

                <Divider orientation="vertical" flexItem sx={{ alignSelf: "stretch" }} />

                <Stack spacing={0} paddingRight={7} paddingLeft={0} margin={0} top={0}>
                    <Box
                        minWidth={60}
                        maxWidth={60}
                        display="flex"
                        justifyContent="left"
                        alignItems="center"
                        sx={{ position: "relative", overflow: "visible", marginTop: 1 }}
                    >
                        {`Track - ${trackNumber}`}
                    </Box>
                    <Box
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                            color: "#c62828",
                            fontSize: 11,
                            fontWeight: 600,
                            marginTop: 0.5,
                            "@keyframes recblink": {
                                "0%, 100%": { opacity: 1 },
                                "50%": { opacity: 0.3 },
                            },
                            animation: "recblink 1s ease-in-out infinite",
                        }}
                    >
                        <FiberManualRecordIcon sx={{ fontSize: 12 }} />
                        REC
                    </Box>
                </Stack>
            </Stack>
        </Box>
    );
}
