import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MarketWeatherCell, MarketWeatherMode, MarketWeatherResponse } from "../../types/marketWeather";
import { channelLabel, formatSigned, marketWeatherCellColor } from "../../utils/marketWeather";

interface MarketWeatherCanvasProps {
  data: MarketWeatherResponse;
  mode: MarketWeatherMode;
  inspectorChannel: string;
  compact?: boolean;
}

interface HoverState {
  dateIndex: number;
  horizonIndex: number;
  x: number;
  y: number;
}

const FULL_PADDING = { left: 50, right: 12, top: 14, bottom: 34 };
const CLOUD_PADDING = { left: 2, right: 2, top: 2, bottom: 2 };

function cellAt(data: MarketWeatherResponse, horizonIndex: number, dateIndex: number): MarketWeatherCell {
  return Object.fromEntries(
    Object.entries(data.channels).map(([name, matrix]) => [name, matrix[horizonIndex]?.[dateIndex] ?? 0]),
  ) as MarketWeatherCell;
}

function renderCellAt(
  data: MarketWeatherResponse,
  horizonIndex: number,
  dateIndex: number,
  channelNames: string[],
): MarketWeatherCell {
  const cell: Record<string, number> = {};
  channelNames.forEach((name) => {
    cell[name] = data.channels[name]?.[horizonIndex]?.[dateIndex] ?? 0;
  });
  return cell as MarketWeatherCell;
}

function parseTimestamp(value: string): Date {
  return new Date(value.includes("T") ? value : `${value}T00:00:00`);
}

function formatDate(value: string, intraday: boolean): string {
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  if (intraday) {
    options.hour = "numeric";
    options.minute = "2-digit";
  }
  return parseTimestamp(value).toLocaleString(undefined, options);
}

export default function MarketWeatherCanvas({ data, mode, inspectorChannel, compact = false }: MarketWeatherCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: compact ? 184 : 560 });
  const [hover, setHover] = useState<HoverState | null>(null);
  const padding = compact ? CLOUD_PADDING : FULL_PADDING;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const update = () => {
      const width = wrapper.clientWidth;
      setSize({ width, height: compact ? (width < 640 ? 148 : 184) : (width < 640 ? 420 : 560) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [compact]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || !data.dates.length || !data.horizons.length) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = "rgb(11, 18, 29)";
    context.fillRect(0, 0, size.width, size.height);

    const plotWidth = size.width - padding.left - padding.right;
    const plotHeight = size.height - padding.top - padding.bottom;
    const cellWidth = plotWidth / data.dates.length;
    const cellHeight = plotHeight / data.horizons.length;
    const contourBands = data.settings.contour_bands ?? 7;
    const renderChannels = mode === "swami"
      ? ["swami"]
      : mode === "inspector"
        ? [inspectorChannel]
        : mode === "regime"
          ? ["pressure", "coherence", "entropy", "confidence"]
          : mode === "topographic"
            ? ["pressure", "reflectivity", "boundary_energy", "convection"]
            : ["pressure", "reflectivity", "convection", "expansion"];

    data.horizons.forEach((_horizon, horizonIndex) => {
      const visualRow = data.horizons.length - 1 - horizonIndex;
      data.dates.forEach((_date, dateIndex) => {
        context.fillStyle = marketWeatherCellColor(
          renderCellAt(data, horizonIndex, dateIndex, renderChannels),
          mode,
          inspectorChannel,
          contourBands,
        );
        context.fillRect(
          padding.left + dateIndex * cellWidth,
          padding.top + visualRow * cellHeight,
          Math.max(1.1, Math.ceil(cellWidth + 0.35)),
          Math.ceil(cellHeight + 0.35),
        );
      });
    });

    if (!compact) {
      context.strokeStyle = "rgba(148, 163, 184, 0.18)";
      context.lineWidth = 1;
      context.fillStyle = "rgba(203, 213, 225, 0.78)";
      context.font = "11px IBM Plex Sans, Segoe UI, sans-serif";
      context.textAlign = "right";
      const horizonTicks = [0, Math.floor((data.horizons.length - 1) / 2), data.horizons.length - 1];
      horizonTicks.forEach((horizonIndex) => {
        const visualRow = data.horizons.length - 1 - horizonIndex;
        const y = padding.top + (visualRow + 0.5) * cellHeight;
        context.beginPath();
        context.moveTo(padding.left - 4, y);
        context.lineTo(size.width - padding.right, y);
        context.stroke();
        context.fillText(String(data.horizons[horizonIndex]), padding.left - 8, y + 4);
      });

      context.textAlign = "center";
      const dateTickCount = size.width < 640 ? 3 : 5;
      const intraday = !["1D", "1W"].includes(data.timeframe);
      const coverageMs = parseTimestamp(data.dates[data.dates.length - 1]).getTime() - parseTimestamp(data.dates[0]).getTime();
      for (let index = 0; index < dateTickCount; index += 1) {
        const dateIndex = Math.round((index / (dateTickCount - 1)) * (data.dates.length - 1));
        const x = padding.left + (dateIndex + 0.5) * cellWidth;
        const label = parseTimestamp(data.dates[dateIndex]).toLocaleString(undefined, intraday && coverageMs <= 2 * 86_400_000
          ? { hour: "numeric", minute: "2-digit" }
          : intraday
            ? { month: "short", day: "numeric" }
            : { month: "short", year: "2-digit" });
        context.fillText(label, x, size.height - 11);
      }

      context.save();
      context.translate(13, padding.top + plotHeight / 2);
      context.rotate(-Math.PI / 2);
      context.textAlign = "center";
      context.fillStyle = "rgba(148, 163, 184, 0.78)";
      context.fillText("Horizon (bars)", 0, 0);
      context.restore();
    }

  }, [compact, data, inspectorChannel, mode, padding, size]);

  useEffect(() => draw(), [draw]);

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const plotWidth = rect.width - padding.left - padding.right;
    const plotHeight = size.height - padding.top - padding.bottom;
    if (x < padding.left || x > padding.left + plotWidth || y < padding.top || y > padding.top + plotHeight) {
      setHover(null);
      return;
    }
    const dateIndex = Math.min(data.dates.length - 1, Math.floor(((x - padding.left) / plotWidth) * data.dates.length));
    const visualRow = Math.min(data.horizons.length - 1, Math.floor(((y - padding.top) / plotHeight) * data.horizons.length));
    setHover({ dateIndex, horizonIndex: data.horizons.length - 1 - visualRow, x, y });
  };

  const inspectCell = (dateIndex: number, horizonIndex: number) => {
    const boundedDate = Math.min(data.dates.length - 1, Math.max(0, dateIndex));
    const boundedHorizon = Math.min(data.horizons.length - 1, Math.max(0, horizonIndex));
    const plotWidth = size.width - padding.left - padding.right;
    const plotHeight = size.height - padding.top - padding.bottom;
    const visualRow = data.horizons.length - 1 - boundedHorizon;
    setHover({
      dateIndex: boundedDate,
      horizonIndex: boundedHorizon,
      x: padding.left + ((boundedDate + 0.5) / data.dates.length) * plotWidth,
      y: padding.top + ((visualRow + 0.5) / data.horizons.length) * plotHeight,
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const current = hover ?? { dateIndex: data.dates.length - 1, horizonIndex: Math.floor(data.horizons.length / 2) };
    const next = event.key === "ArrowLeft"
      ? [current.dateIndex - 1, current.horizonIndex]
      : event.key === "ArrowRight"
        ? [current.dateIndex + 1, current.horizonIndex]
        : event.key === "ArrowUp"
          ? [current.dateIndex, current.horizonIndex + 1]
          : event.key === "ArrowDown"
            ? [current.dateIndex, current.horizonIndex - 1]
            : event.key === "Home"
              ? [0, current.horizonIndex]
              : event.key === "End"
                ? [data.dates.length - 1, current.horizonIndex]
                : null;
    if (event.key === "Escape") {
      setHover(null);
      return;
    }
    if (!next) return;
    event.preventDefault();
    inspectCell(next[0], next[1]);
  };

  const hoveredCell = useMemo(
    () => (hover ? cellAt(data, hover.horizonIndex, hover.dateIndex) : null),
    [data, hover],
  );

  const hoverRect = useMemo(() => {
    if (!hover || size.width <= 0) return null;
    const plotWidth = size.width - padding.left - padding.right;
    const plotHeight = size.height - padding.top - padding.bottom;
    const cellWidth = plotWidth / data.dates.length;
    const cellHeight = plotHeight / data.horizons.length;
    const visualRow = data.horizons.length - 1 - hover.horizonIndex;
    return {
      left: padding.left + hover.dateIndex * cellWidth,
      top: padding.top + visualRow * cellHeight,
      width: Math.max(1, cellWidth),
      height: cellHeight,
    };
  }, [data.dates.length, data.horizons.length, hover, padding, size]);

  return (
    <div ref={wrapperRef} className={`relative min-w-0 overflow-hidden border border-stealth-700 bg-slate-950/70 ${compact ? "rounded-xl shadow-[inset_0_0_28px_rgba(15,23,42,.72)]" : "rounded-2xl"}`}>
      <canvas
        ref={canvasRef}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setHover(null);
        }}
        onFocus={() => {
          if (!hover) inspectCell(data.dates.length - 1, Math.floor(data.horizons.length / 2));
        }}
        onKeyDown={onKeyDown}
        tabIndex={0}
        aria-label={`${data.symbol} market-weather ${compact ? "horizon cloud" : "heatmap"}. Time runs left to right and analysis horizon runs bottom to top. Use arrow keys to inspect cells, Home or End to move through time, and Escape to clear.`}
        className="block w-full touch-pan-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300"
      />
      {hoverRect ? (
        <div
          className="pointer-events-none absolute border border-white/80 shadow-[0_0_0_1px_rgba(15,23,42,0.45)]"
          style={hoverRect}
        />
      ) : null}
      {hover && hoveredCell ? (
        <div
          className={`pointer-events-none absolute z-10 rounded-xl border border-slate-500/70 bg-slate-950/95 text-xs shadow-2xl ${compact ? "w-[210px] p-2" : "w-[230px] p-3"}`}
          style={{
            left: Math.min(Math.max(8, hover.x + 12), Math.max(8, size.width - (compact ? 218 : 238))),
            top: Math.min(Math.max(8, hover.y + 12), Math.max(8, size.height - (compact ? 132 : 230))),
          }}
        >
          <div className="font-semibold text-white">{formatDate(data.dates[hover.dateIndex], !["1D", "1W"].includes(data.timeframe))}</div>
          <div className="mt-0.5 text-slate-400">{data.horizons[hover.horizonIndex]}-bar horizon</div>
          <div className={`${compact ? "mt-1.5" : "mt-2"} grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-slate-300`}>
            <span>Pressure</span><span className="text-right font-mono text-white">{formatSigned(hoveredCell.pressure)}</span>
            <span>Change</span><span className="text-right font-mono text-white">{formatSigned(hoveredCell.velocity)}</span>
            <span>Display organization</span><span className="text-right font-mono text-white">{hoveredCell.confidence.toFixed(2)}</span>
            <span>Legacy disorder</span><span className="text-right font-mono text-white">{hoveredCell.entropy.toFixed(2)}</span>
            {!compact ? <><span>Coherence</span><span className="text-right font-mono text-white">{hoveredCell.coherence.toFixed(2)}</span></> : null}
            {!compact ? <><span>Permutation entropy</span><span className="text-right font-mono text-violet-200">{hoveredCell.permutation_entropy?.toFixed(2) ?? "-"}</span></> : null}
            {!compact ? <><span>Reflectivity</span><span className="text-right font-mono text-white">{hoveredCell.reflectivity.toFixed(2)}</span></> : null}
            {!compact ? <><span>Convection</span><span className="text-right font-mono text-sky-300">{hoveredCell.convection.toFixed(2)}</span></> : null}
            {!compact ? <><span>{channelLabel(inspectorChannel)}</span><span className="text-right font-mono text-white">{hoveredCell[inspectorChannel]?.toFixed(2) ?? "-"}</span></> : null}
          </div>
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {hover && hoveredCell ? `${formatDate(data.dates[hover.dateIndex], !["1D", "1W"].includes(data.timeframe))}; ${data.horizons[hover.horizonIndex]}-bar horizon; pressure ${formatSigned(hoveredCell.pressure)}; pressure change ${formatSigned(hoveredCell.velocity)}; display organization ${hoveredCell.confidence.toFixed(2)}; legacy disorder ${hoveredCell.entropy.toFixed(2)}.` : ""}
      </span>
    </div>
  );
}
