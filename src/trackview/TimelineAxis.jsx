import Box from "@mui/material/Box";

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
                borderLeft: "1px solid #777",
                borderRight: "1px solid #777",
                marginBottom: -0.1,
                marginTop: -0.1,
            }}
        >
            {ticks.map((t) => {
                const showLabel =
                    Math.abs(Math.round(t / labelEvery) * labelEvery - t) < 1e-3;
                return (
                    <Box
                        key={t.toFixed(3)}
                        sx={{
                            position: "absolute",
                            left: `${t * pxPerSec}px`,
                            top: 0,
                            bottom: 0,
                            borderLeft: showLabel
                                ? "1px solid #bbb"
                                : "1px solid #e0e0e0",
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

function pickTickInterval(duration) {
    if (duration < 5) return 0.2;
    if (duration < 20) return 0.5;
    if (duration < 60) return 1;
    if (duration < 300) return 5;
    return 30;
}

function formatTick(s) {
    if (s < 1) return `${Math.round(s * 1000)}ms`;
    if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
}
