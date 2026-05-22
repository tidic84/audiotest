import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
} from "react";
import { segmentBuffer } from "../lib/edl";

// Dessine la waveform du BUFFER ENTIER (pas seulement de la portion [srcStart,
// srcEnd]) en absolu dans le wrapper, positionné par `left = -srcStart*pxPerSec`.
// Combiné à `overflow: hidden` sur le Clip parent, la portion visible
// correspond exactement au segment. Pendant un resize, on n'a qu'à déplacer
// le canvas (translateX) et changer la largeur du Clip : aucun recalcul de
// peaks, aucun re-render React → pas de tremblement.
const MAX_CANVAS_W = 16000; // limite Chrome ~16384

const ClipWaveform = forwardRef(function ClipWaveform(
    { segment, trackBuffer, pxPerSec, color = "rgb(34, 173, 197)" },
    ref,
) {
    const canvasRef = useRef(null);
    const drawRef = useRef(null);

    const segBuf = segmentBuffer(segment, trackBuffer);
    const bufDur = segBuf?.duration ?? 0;
    const canvasWidthPx = Math.min(bufDur * pxPerSec, MAX_CANVAS_W);
    const canvasLeftPx = -segment.srcStart * pxPerSec;

    // Peaks du buffer ENTIER, indépendants du segment. Recalcul uniquement
    // si le buffer change ou si la largeur cible bouge significativement.
    // On vise N_BINS bins, indépendant du zoom : le canvas est ensuite étiré
    // CSS au besoin si pxPerSec change.
    const N_BINS = 4000;
    const peaks = useMemo(() => {
        if (!segBuf) return null;
        const ch = segBuf.getChannelData(0);
        const out = new Float32Array(N_BINS);
        const binSize = ch.length / N_BINS;
        for (let i = 0; i < N_BINS; i++) {
            const a = Math.floor(i * binSize);
            const b = Math.floor((i + 1) * binSize);
            let max = 0;
            for (let j = a; j < b && j < ch.length; j++) {
                const v = Math.abs(ch[j]);
                if (v > max) max = v;
            }
            out[i] = max;
        }
        return out;
    }, [segBuf]);

    const draw = () => {
        const canvas = canvasRef.current;
        if (!canvas || !peaks) return;
        const parent = canvas.parentElement;
        const h = parent?.clientHeight ?? 0;
        const w = canvasWidthPx;
        if (w <= 0 || h <= 0) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        const ctx = canvas.getContext("2d");
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = color;
        const mid = h / 2;
        const barW = w / peaks.length;
        for (let i = 0; i < peaks.length; i++) {
            const barH = peaks[i] * mid;
            ctx.fillRect(i * barW, mid - barH, Math.max(barW - 0.5, 0.5), barH * 2);
        }
    };
    drawRef.current = draw;

    useLayoutEffect(() => {
        draw();
    }, [peaks, color, canvasWidthPx]);

    // Le parent peut changer de hauteur (resize fenêtre, rezoom UI) :
    // ResizeObserver pour re-draw quand ça arrive. Setup une fois.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const parent = canvas.parentElement;
        const ro = new ResizeObserver(() => drawRef.current?.());
        ro.observe(parent);
        return () => ro.disconnect();
    }, []);

    // API impérative pour translater le canvas pendant un resize en cours,
    // sans déclencher de re-render React. Le parent (Clip) appelle ça à
    // chaque mousemove, et au lâcher React commit le nouveau srcStart, ce
    // qui repositionne le canvas via la prop `left`.
    useImperativeHandle(
        ref,
        () => ({
            setSrcStartPx: (px) => {
                const c = canvasRef.current;
                if (c) c.style.left = `${-px}px`;
            },
        }),
        [],
    );

    return (
        <canvas
            ref={canvasRef}
            style={{
                display: "block",
                position: "absolute",
                top: 0,
                left: `${canvasLeftPx}px`,
                height: "100%",
            }}
        />
    );
});

export default ClipWaveform;
