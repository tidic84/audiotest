import { useMemo } from "react";
import WavesurferPlayer from "@wavesurfer/react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import DeleteIcon from "@mui/icons-material/Delete";
import { virtualDuration, computeVirtualPeaks } from "./lib/edl";

export default function TrackView({ track, onDelete, onDemoCut }) {
    const dur = useMemo(() => virtualDuration(track), [track]);
    const peaks = useMemo(
        () => computeVirtualPeaks(track.buffer, track.edl, 4000),
        [track],
    );
    return (
        <Box sx={{ mb: 1.5, border: "1px solid #ddd", borderRadius: 1, p: 1 }}>
            <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: 0.5 }}
            >
                <strong>{track.name}</strong>
                <Stack direction="row" spacing={0.5}>
                    <IconButton
                        size="small"
                        onClick={onDemoCut}
                        title="Démo : couper 1s→2s"
                    >
                        <ContentCutIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                        size="small"
                        onClick={onDelete}
                        title="Supprimer la piste"
                    >
                        <DeleteIcon fontSize="small" />
                    </IconButton>
                </Stack>
            </Stack>
            <WavesurferPlayer
                height={80}
                waveColor="#4a9eff"
                progressColor="#1565c0"
                peaks={[peaks]}
                duration={dur}
            />
        </Box>
    );
}
