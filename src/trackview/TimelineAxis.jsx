import Box from "@mui/material/Box";
import { pickTickInterval } from "../lib/snap";

// Axe de graduations en fond de la lane d'une piste.
// Les ticks s'étendent sur toute la hauteur de la lane et passent derrière les clips
// (positionnement absolu, z-index 0). Les labels restent en haut.
export default function TimelineAxis({ projectDuration, pxPerSec, isTopAxis = false }) {
    if (projectDuration <= 0 || pxPerSec <= 0) return null;

    const tickEvery = pickTickInterval(projectDuration);
    const labelEvery = tickEvery * 5;

    const ticks = [];
    for (let t = 0; t <= projectDuration + 1e-6; t += tickEvery) {
        ticks.push(t);
    }

    return (
        <Box
            sx={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                zIndex: 0,
                borderLeft: isTopAxis ? "1px solid #777" : "0",
                borderRight: "1px solid #777",
                marginBottom: -0.1,
                marginTop: -0.1,
                marginLeft: !isTopAxis ? 0 : -0.1,
            }}
        >
            {ticks.map((t) => {
                const showLabel =
                    Math.abs(Math.round(t / labelEvery) * labelEvery - t) < 1e-3; 
                // console.log(t == Math.max(...ticks), t, Math.max(...ticks));
                               
                return (
                    <Box
                        key={t.toFixed(3)}
                        sx={{
                            position: "absolute",
                            left: `${Math.round( t * pxPerSec )}px`,
                            top: 0,
                            bottom: 0,
                            borderLeft: showLabel
                                ? (t === 0 ? "1px transparent" : "1px solid #aaa")
                                : "1px solid #ccc",
                            paddingLeft: "2px",
                            fontSize: 9,
                            color: "#888",
                            lineHeight: "12px",
                            userSelect: "none",
                        }}
                    >
                        {showLabel && isTopAxis ? formatTick(t) : ""}
                    </Box>
                );
            })}
        </Box>
    );
}

function formatTick(s) {
    if (s < 1) return `${Math.round(s * 1000)}ms`;
    if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
}
