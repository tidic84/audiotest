import { useMemo } from "react";
import WavesurferPlayer from "@wavesurfer/react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import IconButton from "@mui/material/IconButton";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import DeleteIcon from "@mui/icons-material/Delete";
import Divider from '@mui/material/Divider';
import { virtualDuration, computeVirtualPeaks } from "./lib/edl";

export default function TrackView({ track, projectDuration, onDelete, onDemoCut }) {
    const dur = useMemo(() => virtualDuration(track), [track]);
    const widthPct = projectDuration > 0 ? (dur / projectDuration) * 100 : 100;
    const peaks = useMemo(
        () => computeVirtualPeaks(track.buffer, track.edl, 4000),
        [track],
    );
    return (
        <Box sx={{ border: "1px solid #ddd"}}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={5}>
                <Box sx={{ width: `${widthPct}%`, overflow: "hidden", borderRadius: 1 }}>
                    <WavesurferPlayer
                        height={80}
                        waveColor="#4a9eff"
                        progressColor="#1565c0"
                        peaks={[peaks]}
                        duration={dur}
                    />
                </Box>
                <Stack direction="row">
                    <Divider orientation="vertical" flexItem sx={{ margin: "-20px 0" }} />
                    <Stack
                        spacing={0}
                        paddingRight={7}
                        paddingLeft={1}
                    >
                        <Box  marginLeft={0.7}>
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
