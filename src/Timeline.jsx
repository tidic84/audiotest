import Box from "@mui/material/Box";

export default function Timeline({ projectDuration, height = 24 }) {
    if (projectDuration === 0) return null;
    const tickEvery = pickTickInterval(projectDuration);
    const ticks = [];
    for (let t = 0; t < projectDuration; t += tickEvery) {
        const xPct = (t / projectDuration) * 100;
        ticks.push({ time: t, xPct });
    }
    return (
        <Box sx={{ position: "relative", width: "100%", height, background: "1px solid #eee" }}
        >
            {ticks.map((tick) => (
                <Box key={tick.time} sx={{
                    position: "absolute",
                    left: `${tick.xPct}%`,
                    top: 0,
                    width: 1,
                    height: "100%",
                    borderLeft: "1px solid #ccc",
                    fontSize: 10,
                    p1: "2px",
                }}
                >
                    {formatTime(tick.time)}
                </Box>
            ))
            }
        </Box >
    );

}

function pickTickInterval(duration) {
    if(duration < 10) return 1;
    if(duration < 60) return 5;
    if(duration < 300) return 30;
    return 60
}

 export function formatTime(s, miliSeconds = false) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 1000);
    if (miliSeconds) {
        return `${m}:${String(sec).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
    }
    return `${m}:${String(sec).padStart(2, "0")}`;
}