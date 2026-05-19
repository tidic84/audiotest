import { useMemo, useCallback } from "react";
import WavesurferPlayer from "@wavesurfer/react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import DeleteIcon from "@mui/icons-material/Delete";
import Divider from '@mui/material/Divider';
import { virtualDuration, computeVirtualPeaks } from "./lib/edl";

export default function TrackView({
    track,
    projectDuration,
    isSelected,
    onSeek,
    onDelete,
    onDemoCut,
    playheadTime, // temps virtuel actuel sur cette piste (null si pas en lecture)
}) {
    const dur = useMemo(() => virtualDuration(track), [track]);
    const widthPct = projectDuration > 0 ? (dur / projectDuration) * 100 : 100;
    const peaks = useMemo(
        () => computeVirtualPeaks(track.buffer, track.edl, 4000),
        [track],
    );
    // Stabilise la référence du tableau passé à WavesurferPlayer pour
    // éviter de re-déclencher son setOptions interne à chaque render.
    const peaksProp = useMemo(() => [peaks], [peaks]);

    // Le clic de wavesurfer donne un x relatif (0..1). On le convertit
    // en temps virtuel et on remonte (trackId, time) au parent.
    const handleClick = useCallback(
        (_ws, relativeX) => onSeek?.(track.id, relativeX * dur),
        [onSeek, track.id, dur],
    );

    return (
        <Box sx={{ border: isSelected ? "1px solid #1565c0" : "1px solid #777", borderTop: isSelected ? "0.1px solid #1565c0" : "0px solid #fff"}}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={5}>
                <Box sx={{ width: `${widthPct}%`, position: "relative", overflow: "hidden", borderRadius: 1 }}>
                    <WavesurferPlayer
                        height={80}
                        waveColor="#4a9eff"
                        progressColor="#1565c0"
                        peaks={peaksProp}
                        duration={dur}
                        onClick={handleClick}
                    />
                    {playheadTime != null && dur > 0 && (
                        <Box
                            sx={{
                                position: "absolute",
                                left: `${(playheadTime / dur) * 100}%`,
                                top: 0,
                                bottom: 0,
                                width: "2px",
                                bgcolor: "red",
                                pointerEvents: "none",
                                zIndex: 2,
                            }}
                        />
                    )}
                </Box>
                <Stack direction="row" overflow="hidde">
                    <Divider orientation="vertical" flexItem sx={{ margin: "-16px 0" }} />
                    <Stack
                        spacing={0}
                        paddingRight={7}
                        paddingLeft={1}
                    >
                        <Box  marginLeft={0.7} overflow="hidden" minWidth={60} maxWidth={60}>
                            {track.name}
                        </Box>
                        <Stack direction="row" margin={0}>
                            <IconButton
                                size="small"
                                onClick={onDemoCut}
                                title="Démo : couper 1s->2s"
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
                </Stack>

            </Stack>


        </Box>
    );
}
