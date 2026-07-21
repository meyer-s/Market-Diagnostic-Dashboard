import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MarketWeatherCell, MarketWeatherMode, MarketWeatherResponse } from "../../types/marketWeather";
import { channelLabel, formatSigned, marketWeatherCellColor } from "../../utils/marketWeather";

interface MarketWeatherCanvasProps {
  data: MarketWeatherResponse;
  mode: MarketWeatherMode;
  inspectorChannel: string;
}

interface HoverState {
  dateIndex: number;
  horizonIndex: number;
  x: number;
  y: number;
}

const PADDING = { left: 50, right: 12, top: 14, bottom: 34 };

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

export default function MarketWeatherCanvas({ data, mode, inspectorChannel }: MarketWeatherCanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 560 });
  const [hover, setHover] = useState<HoverState | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const update = () => {
      const width = wrapper.clientWidth;
      setSize({ width, height: width < 640 ? 420 : 560 });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

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

    const plotWidth = size.width - PADDING.left - PADDING.right;
    const plotHeight = size.height - PADDING.top - PADDING.bottom;
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
          PADDING.left + dateIndex * cellWidth,
          PADDING.top + visualRow * cellHeight,
          Math.max(1.1, Math.ceil(cellWidth + 0.35)),
          Math.ceil(cellHeight + 0.35),
        );
      });
    });

    context.strokeStyle = "rgba(148, 163, 184, 0.18)";
    context.lineWidth = 1;
    context.fillStyle = "rgba(203, 213, 225, 0.78)";
    context.font = "11px IBM Plex Sans, Segoe UI, sans-serif";
    context.textAlign = "right";
    const horizonTicks = [0, Math.floor((data.horizons.length - 1) / 2), data.horizons.length - 1];
    horizonTicks.forEach((horizonIndex) => {
      const visualRow = data.horizons.length - 1 - horizonIndex;
      const y = PADDING.top + (visualRow + 0.5) * cellHeight;
      context.beginPath();
      context.moveTo(PADDING.left - 4, y);
      context.lineTo(size.width - PADDING.right, y);
      context.stroke();
      context.fillText(String(data.horizons[horizonIndex]), PADDING.left - 8, y + 4);
    });

    context.textAlign = "center";
    const dateTickCount = size.width < 640 ? 3 : 5;
    const intraday = !["1D", "1W"].includes(data.timeframe);
    const coverageMs = parseTimestamp(data.dates[data.dates.length - 1]).getTime() - parseTimestamp(data.dates[0]).getTime();
    for (let index = 0; index < dateTickCount; index += 1) {
      const dateIndex = Math.round((index / (dateTickCount - 1)) * (data.dates.length - 1));
      const x = PADDING.left + (dateIndex + 0.5) * cellWidth;
      const label = parseTimestamp(data.dates[dateIndex]).toLocaleString(undefined, intraday && coverageMs <= 2 * 86_400_000
        ? { hour: "numeric", minute: "2-digit" }
        : intraday
          ? { month: "short", day: "numeric" }
          : { month: "short", year: "2-digit" });
      context.fillText(label, x, size.height - 11);
    }

    context.save();
    context.translate(13, PADDING.top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.textAlign = "center";
    context.fillStyle = "rgba(148, 163, 184, 0.78)";
    context.fillText("Horizon (bars)", 0, 0);
    context.restore();

  }, [data, inspectorChannel, mode, size]);

  useEffect(() => draw(), [draw]);

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const plotWidth = rect.width - PADDING.left - PADDING.right;
    const plotHeight = size.height - PADDING.top - PADDING.bottom;
    if (x < PADDING.left || x > PADDING.left + plotWidth || y < PADDING.top || y > PADDING.top + plotHeight) {
      setHover(null);
      return;
    }
    const dateIndex = Math.min(data.dates.length - 1, Math.floor(((x - PADDING.left) / plotWidth) * data.dates.length));
    const visualRow = Math.min(data.horizons.length - 1, Math.floor(((y - PADDING.top) / plotHeight) * data.horizons.length));
    setHover({ dateIndex, horizonIndex: data.horizons.length - 1 - visualRow, x, y });
  };

  const hoveredCell = useMemo(
    () => (hover ? cellAt(data, hover.horizonIndex, hover.dateIndex) : null),
    [data, hover],
  );

  const hoverRect = useMemo(() => {
    if (!hover || size.width <= 0) return null;
    const plotWidth = size.width - PADDING.left - PADDING.right;
    const plotHeight = size.height - PADDING.top - PADDING.bottom;
    const cellWidth = plotWidth / data.dates.length;
    const cellHeight = plotHeight / data.horizons.length;
    const visualRow = data.horizons.length - 1 - hover.horizonIndex;
    return {
      left: PADDING.left + hover.dateIndex * cellWidth,
      top: PADDING.top + visualRow * cellHeight,
      width: Math.max(1, cellWidth),
      height: cellHeight,
    };
  }, [data.dates.length, data.horizons.length, hover, size]);

  return (
    <div ref={wrapperRef} className="relative min-w-0 overflow-hidden rounded-2xl border border-stealth-700 bg-slate-950/70">
      <canvas
        ref={canvasRef}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        aria-label={`${data.symbol} market-weather heatmap. Time runs left to right and analysis horizon runs bottom to top.`}
        className="block w-full touch-none"
      />
      {hoverRect ? (
        <div
          className="pointer-events-none absolute border border-white/80 shadow-[0_0_0_1px_rgba(15,23,42,0.45)]"
          style={hoverRect}
        />
      ) : null}
      {hover && hoveredCell ? (
        <div
          className="pointer-events-none absolute z-10 w-[230px] rounded-xl border border-slate-500/70 bg-slate-950/95 p-3 text-xs shadow-2xl"
          style={{
            left: Math.min(Math.max(8, hover.x + 12), Math.max(8, size.width - 238)),
            top: Math.min(Math.max(8, hover.y + 12), size.height - 230),
          }}
        >
          <div className="font-semibold text-white">{formatDate(data.dates[hover.dateIndex], !["1D", "1W"].includes(data.timeframe))}</div>
          <div className="mt-0.5 text-slate-400">{data.horizons[hover.horizonIndex]}-bar horizon</div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-300">
            <span>Pressure</span><span className="text-right font-mono text-white">{formatSigned(hoveredCell.pressure)}</span>
            <span>Velocity</span><span className="text-right font-mono text-white">{formatSigned(hoveredCell.velocity)}</span>
            <span>Organization</span><span className="text-right font-mono text-white">{hoveredCell.confidence.toFixed(2)}</span>
            <span>Coherence</span><span className="text-right font-mono text-white">{hoveredCell.coherence.toFixed(2)}</span>
            <span>Disorder proxy</span><span className="text-right font-mono text-white">{hoveredCell.entropy.toFixed(2)}</span>
            <span>Permutation entropy</span><span className="text-right font-mono text-violet-200">{hoveredCell.permutation_entropy?.toFixed(2) ?? "-"}</span>
            <span>Reflectivity</span><span className="text-right font-mono text-white">{hoveredCell.reflectivity.toFixed(2)}</span>
            <span>Convection</span><span className="text-right font-mono text-sky-300">{hoveredCell.convection.toFixed(2)}</span>
            <span>{channelLabel(inspectorChannel)}</span><span className="text-right font-mono text-white">{hoveredCell[inspectorChannel]?.toFixed(2) ?? "-"}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
