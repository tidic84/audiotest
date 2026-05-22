import Box from "@mui/material/Box";

// Rectangle semi-transparent matérialisant la sélection [start, end] (en secondes).
// Positionné en absolu dans la lane parente; pleine hauteur.
export default function SelectionOverlay({ start, end, pxPerSec }) {
    if (start == null || end == null || end <= start || pxPerSec <= 0) return null;
    return (
        <Box
            sx={{
                position: "absolute",
                left: `${start * pxPerSec}px`,
                width: `${(end - start) * pxPerSec}px`,
                top: 0,
                bottom: 0,
                background: "rgba(0, 0, 0, 0.2)",
                pointerEvents: "none",
                zIndex: 2,
            }}
        />
    );
}
