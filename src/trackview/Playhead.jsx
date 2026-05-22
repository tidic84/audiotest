import Box from "@mui/material/Box";

// Barre rouge verticale à la position virtuelle `time` (secondes).
// Positionnée en absolu dans la lane parente; pleine hauteur.
export default function Playhead({ time, pxPerSec }) {
    if (time == null || pxPerSec <= 0) return null;
    return (
        <Box
            sx={{
                position: "absolute",
                left: `${time * pxPerSec}px`,
                top: 0,
                bottom: 0,
                width: "2px",
                bgcolor: "red",
                pointerEvents: "none",
                opacity: 0.7,
                zIndex: 3,
            }}
        />
    );
}
