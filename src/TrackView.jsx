import { useMemo, useState, useEffect, useRef } from "react";
import { useWavesurfer } from "@wavesurfer/react";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import TimelinePlugin from "wavesurfer.js/dist/plugins/timeline.esm.js";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Divider from '@mui/material/Divider';
import IconButton from "@mui/material/IconButton";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import TextField from "@mui/material/TextField";

import { virtualDuration, computeVirtualPeaks } from "./lib/edl";

export default function TrackView({
    track,
    projectDuration,
    isSelected,
    onSeek,
    onDelete,
    playheadTime, // temps virtuel actuel sur cette piste (null si pas en lecture)
    regionSelection,
    onRegionChange,
    onRename,
}) {
    const dur = useMemo(() => virtualDuration(track), [track]);
    const widthPct = projectDuration > 0 ? (dur / projectDuration) * 100 : 100;
    const peaks = useMemo(
        () => computeVirtualPeaks(track.buffer, track.edl, 4000),
        [track],
    );
    // Stabilise la référence du tableau pour ne pas re-déclencher son setOptions interne à chaque render.
    const peaksProp = useMemo(() => [peaks], [peaks]);

    const containerRef = useRef(null);
    const [selection, setSelection] = useState(null);

    // Pour rename
    const [isRenaming, setIsRenaming] = useState(false);
    const [draftName, setDraftName] = useState(track.name);

    const regionsPlugin = useMemo(() => RegionsPlugin.create(), []);
    const timelinePlugin = useMemo(
        () =>
            TimelinePlugin.create({
                height: 100,
                insertPosition: "beforebegin",
                timeInterval: 0.2,
                primaryLabelInterval: 5,
                secondaryLabelInterval: 1,
                style: {
                    fontSize: "0px",
                    color: "#2D5B88",
                },
            }),
        [],
    );

    useEffect(() => {
        const unsubCreated = regionsPlugin.on("region-created", (region) => {
            regionsPlugin.getRegions().forEach((r) => {
                if (r.id !== region.id) r.remove();
            });
            setSelection({ start: region.start, end: region.end });
            onRegionChange?.({ trackId: track.id, start: region.start, end: region.end });
        });
        const unsubUpdated = regionsPlugin.on("region-updated", (region) => {
            setSelection({ start: region.start, end: region.end });
            onRegionChange?.({ trackId: track.id, start: region.start, end: region.end });
        });
        return () => { unsubCreated(); unsubUpdated(); };
    }, [regionsPlugin, onRegionChange, track.id]);

    // Vide les régions de cette piste quand la sélection courante n'est pas la sienne
    // (autre piste active OU sélection effacée par un click).
    useEffect(() => {
        if (regionSelection?.trackId !== track.id) {
            regionsPlugin.getRegions().forEach((r) => r.remove());
            setSelection(null);
        }
    }, [regionSelection, track.id, regionsPlugin]);

    const plugins = useMemo(() => [regionsPlugin, timelinePlugin], [regionsPlugin, timelinePlugin]);

    const { wavesurfer } = useWavesurfer({
        container: containerRef,
        height: 80,
        waveColor: "rgb(34, 173, 197)",
        progressColor: "rgb(64, 107, 114)",
        peaks: peaksProp,
        duration: dur,
        plugins,
    });

    useEffect(() => {
        if (!wavesurfer) return;
        const unsub = regionsPlugin.enableDragSelection({
            color: "rgba(0, 0, 0, 0.2)",
            drag: true,
            resize: true,
        });
        return () => { unsub?.(); };
    }, [wavesurfer, regionsPlugin]);

    // Escape : efface la sélection (utile quand la région couvre toute la zone et qu'on ne peut plus draguer une zone vide pour la recréer).
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === "Escape") {
                regionsPlugin.getRegions().forEach((r) => r.remove());
                setSelection(null);
                onRegionChange?.(null);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [regionsPlugin, onRegionChange]);

    // Seek manuel : enableDragSelection appelle preventDefault sur pointerdown,
    // ce qui supprime l'event click. On reconstruit la logique click-to-seek via pointerdown/up.
    useEffect(() => {
        if (!wavesurfer) return;
        const wrapper = wavesurfer.getWrapper();
        if (!wrapper) return;

        let downX = null;
        let dragged = false;
        const THRESHOLD = 3;

        const onDown = (e) => {
            downX = e.clientX;
            dragged = false;
        };
        const onMove = (e) => {
            if (downX === null) return;
            if (Math.abs(e.clientX - downX) > THRESHOLD) dragged = true;
        };
        const onUp = (e) => {
            if (downX !== null && !dragged) {
                const rect = wrapper.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                wavesurfer.seekTo(ratio);
                onSeek?.(track.id, ratio * dur);
                // Click simple = on efface la région.
                regionsPlugin.getRegions().forEach((r) => r.remove());
                setSelection(null);
                onRegionChange?.(null);
            }
            downX = null;
            dragged = false;
        };

        wrapper.addEventListener("pointerdown", onDown);
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        return () => {
            wrapper.removeEventListener("pointerdown", onDown);
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
        };
    }, [wavesurfer, onSeek, track.id, dur, regionsPlugin, onRegionChange]);

    return (
        <Box sx={{ border: isSelected ? "1px solid #1565c0" : "1px solid #777", borderTop: isSelected ? "0.1px solid #1565c0" : "0px solid #fff" }}>
            <Stack direction="row" alignItems="center" spacing={5}>
                {/* Conteneur "rail temporel" : prend toute la place restante, identique sur chaque piste.
                    widthPct% est ensuite appliqué sur cette largeur stable -> px/sec aligné inter-pistes. */}
                <Box sx={{ flex: 1, minWidth: 0, position: "relative" }}>
                    <Box sx={{ width: `${widthPct}%`, position: "relative", overflow: "hidden", borderRadius: 1 }}>
                        <Box ref={containerRef} />
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
                </Box>
                <Divider orientation="vertical" flexItem sx={{ alignSelf: "stretch" }} />
                <Stack direction="row" overflow="hidden" flexShrink={0}>
                    <Stack
                        spacing={0}
                        paddingRight={7}
                        paddingLeft={1}
                        justifyContent="center"
                        overflow="hidden"
                    >
                        <Box
                            marginLeft={0.7}
                            minWidth={60}
                            maxWidth={60}
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                            sx={{ position: "relative", overflow: "visible" }}
                        >
                            {isRenaming ? (
                                <TextField
                                    size="small"
                                    value={draftName}
                                    autoFocus
                                    onChange={(e) => setDraftName(e.target.value)}
                                    onBlur={() => {
                                        onRename?.(track.id, draftName.trim() || track.name);
                                        setIsRenaming(false);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            onRename?.(track.id, draftName.trim() || track.name);
                                            setIsRenaming(false);
                                        } else if (e.key === "Escape") {
                                            setDraftName(track.name);
                                            setIsRenaming(false);
                                        }
                                    }}
                                    sx={{
                                        position: "absolute",
                                        top: "50%",
                                        left: "50%",
                                        transform: "translate(-50%, -50%)",
                                        width: 200,
                                        zIndex: 3,
                                        backgroundColor: "background.paper",
                                    }}
                                />
                            ) : (
                                track.name
                            )}
                        </Box>
                        <Stack direction="row" margin={0}>
                            <IconButton
                                size="small"
                                onClick={() => {
                                    setDraftName(track.name);
                                    setIsRenaming(true);
                                }} title="Rename track"
                            >
                                <EditIcon fontSize="small" />
                            </IconButton>
                            <IconButton
                                size="small"
                                onClick={onDelete}
                                title="Delete track"
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
