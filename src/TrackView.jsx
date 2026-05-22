import { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import TextField from "@mui/material/TextField";

import Clip from "./trackview/Clip";
import TimelineAxis from "./trackview/TimelineAxis";
import Playhead from "./trackview/Playhead";
import SelectionOverlay from "./trackview/SelectionOverlay";

const DRAG_THRESHOLD = 3;
const LANE_HEIGHT = 80;

export default function TrackView({
    track,
    projectDuration,
    isSelected,
    onSeek,
    onDelete,
    playheadTime,
    regionSelection,
    onRegionChange,
    onRename,
    onClipMove,
    onClipMoveAcrossTracks,
    onClipTrim,
}) {
    const laneRef = useRef(null);
    const [laneWidth, setLaneWidth] = useState(0);
    const pxPerSec = projectDuration > 0 ? laneWidth / projectDuration : 0;

    useEffect(() => {
        const el = laneRef.current;
        if (!el) return;
        setLaneWidth(el.clientWidth);
        const ro = new ResizeObserver(([entry]) => {
            setLaneWidth(entry.contentRect.width);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Sélection en cours de construction (drag souris sur la lane).
    // Quand le drag se termine, on commit via onRegionChange et on remet à null.
    const [dragSel, setDragSel] = useState(null);
    const dragStateRef = useRef(null);

    // Bornes [minVStart, maxVStart] par segment, basées sur les voisins.
    // Sert à clamper le drag de chaque clip pour empêcher tout chevauchement.
    const clipBounds = useMemo(() => {
        const sorted = [...track.edl].sort((a, b) => a.vStart - b.vStart);
        const map = {};
        for (let i = 0; i < sorted.length; i++) {
            const seg = sorted[i];
            const prev = sorted[i - 1];
            const next = sorted[i + 1];
            const segDur = seg.srcEnd - seg.srcStart;
            const minVStart = prev ? prev.vStart + (prev.srcEnd - prev.srcStart) : 0;
            const maxVStart = next ? next.vStart - segDur : Infinity;
            map[seg.id] = { minVStart, maxVStart };
        }
        return map;
    }, [track.edl]);

    const xToTime = (clientX) => {
        if (pxPerSec <= 0) return 0;
        const rect = laneRef.current.getBoundingClientRect();
        const x = clientX - rect.left;
        return Math.max(0, Math.min(projectDuration, x / pxPerSec));
    };

    const onLanePointerDown = (e) => {
        if (e.button !== 0) return;
        // Drag qui commence sur un clip = interact.js le pilote. La lane
        // n'arme pas de drag-de-sélection et ne capture pas le pointeur.
        const startedOnClip = !!e.target.closest("[data-clip-id]");
        const t = xToTime(e.clientX);
        dragStateRef.current = { startTime: t, startX: e.clientX, dragged: false, startedOnClip };
        if (!startedOnClip) {
            e.currentTarget.setPointerCapture?.(e.pointerId);
        }
    };

    const onLanePointerMove = (e) => {
        const st = dragStateRef.current;
        if (!st) return;
        if (!st.dragged && Math.abs(e.clientX - st.startX) <= DRAG_THRESHOLD) return;
        st.dragged = true;
        if (st.startedOnClip) return;
        const t = xToTime(e.clientX);
        setDragSel({
            start: Math.min(st.startTime, t),
            end: Math.max(st.startTime, t),
        });
    };

    const onLanePointerUp = (e) => {
        const st = dragStateRef.current;
        dragStateRef.current = null;
        if (!st) return;
        if (st.startedOnClip) {
            // Simple clic sur un clip (pas de drag interact.js) → on positionne
            // quand même le playhead. Si l'utilisateur a draggé, interact.js
            // a déjà géré le move et on ne touche pas au playhead.
            if (!st.dragged) {
                onSeek?.(track.id, st.startTime);
                onRegionChange?.(null);
            }
            return;
        }
        if (!st.dragged) {
            onSeek?.(track.id, st.startTime);
            onRegionChange?.(null);
            return;
        }
        const t = xToTime(e.clientX);
        setDragSel(null);
        onRegionChange?.({
            trackId: track.id,
            start: Math.min(st.startTime, t),
            end: Math.max(st.startTime, t),
        });
    };

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === "Escape") {
                setDragSel(null);
                if (regionSelection?.trackId === track.id) {
                    onRegionChange?.(null);
                }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [regionSelection, track.id, onRegionChange]);

    // Visible = drag local OU sélection committée pour cette piste
    const visibleSelection =
        dragSel ??
        (regionSelection?.trackId === track.id
            ? { start: regionSelection.start, end: regionSelection.end }
            : null);

    // Rename
    const [isRenaming, setIsRenaming] = useState(false);
    const [draftName, setDraftName] = useState(track.name);

    return (
        <Box
            sx={{
                border: "1px solid #777",
                borderTop: "0px solid #fff",
            }}
        >
            <Stack direction="row" alignItems="stretch" spacing={1}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box
                        ref={laneRef}
                        data-lane-id={track.id}
                        onPointerDown={onLanePointerDown}
                        onPointerMove={onLanePointerMove}
                        onPointerUp={onLanePointerUp}
                        sx={{
                            position: "relative",
                            width: "100%",
                            height: LANE_HEIGHT,
                            background: isSelected ? "#e9e9e9" : "#fafafa",
                            overflow: "visible",
                            touchAction: "none",
                            userSelect: "none",
                            cursor: "crosshair",
                        }}
                    >
                        {pxPerSec > 0 && (
                            <TimelineAxis
                                projectDuration={projectDuration}
                                pxPerSec={pxPerSec}
                            />
                        )}
                        {pxPerSec > 0 &&
                            track.edl.map((seg) => (
                                <Clip
                                    key={seg.id}
                                    segment={seg}
                                    trackId={track.id}
                                    trackBuffer={track.buffer}
                                    pxPerSec={pxPerSec}
                                    onMove={onClipMove}
                                    onMoveAcrossTracks={onClipMoveAcrossTracks}
                                    onClipTrim={onClipTrim}
                                    bounds={clipBounds[seg.id]}
                                />
                            ))}
                        {visibleSelection && (
                            <SelectionOverlay
                                start={visibleSelection.start}
                                end={visibleSelection.end}
                                pxPerSec={pxPerSec}
                            />
                        )}
                        {playheadTime != null && (
                            <Playhead time={playheadTime} pxPerSec={pxPerSec} />
                        )}
                    </Box>
                </Box>

                <Divider
                    orientation="vertical"
                    flexItem
                    sx={{ alignSelf: "stretch" }}
                />

                <Stack
                    spacing={0}
                    paddingRight={7}
                    paddingLeft={0}
                    alignItems="left"
                    margin={0}
                    top={0}
                >
                    <Box
                        minWidth={60}
                        maxWidth={60}
                        display="flex"
                        justifyContent="left"
                        alignItems="center"
                        sx={{ position: "relative", overflow: "visible", marginTop:1 }}
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
                    <Stack direction="row" margin={-0.7}>
                        <IconButton
                            size="small"
                            onClick={() => {
                                setDraftName(track.name);
                                setIsRenaming(true);
                            }}
                            title="Rename track"
                        >
                            <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" onClick={onDelete} title="Delete track">
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Stack>
                </Stack>
            </Stack>
        </Box>
    );
}
