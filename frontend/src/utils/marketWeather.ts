import type { MarketWeatherCell, MarketWeatherMode } from "../types/marketWeather";

type Rgb = [number, number, number];

const NEGATIVE: Rgb = [248, 100, 126];
const POSITIVE: Rgb = [72, 211, 147];
const NEUTRAL: Rgb = [234, 179, 73];
const BLUE: Rgb = [70, 162, 255];
const DARK: Rgb = [18, 28, 42];
const PURPLE: Rgb = [160, 125, 245];

export const INSPECTOR_CHANNELS = [
  "pressure",
  "velocity",
  "acceleration",
  "structural_strength",
  "boundary_energy",
  "coherence",
  "entropy",
  "persistence",
  "confidence",
  "expansion",
  "contraction",
  "reflectivity",
  "convection",
] as const;

export function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
}

function mix(first: Rgb, second: Rgb, amount: number): Rgb {
  const weight = clamp(amount);
  return first.map((value, index) => Math.round(value + (second[index] - value) * weight)) as Rgb;
}

function scale(color: Rgb, amount: number): Rgb {
  const factor = clamp(amount, 0, 1.35);
  return color.map((value) => Math.round(clamp(value * factor, 0, 255))) as Rgb;
}

function rgb(color: Rgb): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function pressureColor(pressure: number): Rgb {
  const strength = clamp(Math.abs(pressure) * 2.1);
  return mix(NEUTRAL, pressure >= 0 ? POSITIVE : NEGATIVE, strength);
}

export function marketWeatherCellColor(
  cell: MarketWeatherCell,
  mode: MarketWeatherMode,
  inspectorChannel = "pressure",
  contourBands = 7,
): string {
  if (mode === "swami") {
    const value = cell.swami;
    if (value >= 1) return "rgb(50, 205, 112)";
    if (value >= 0.25) return "rgb(162, 207, 83)";
    if (value > -0.25) return "rgb(235, 194, 69)";
    if (value > -1) return "rgb(238, 137, 63)";
    return "rgb(239, 80, 94)";
  }

  if (mode === "inspector") {
    const value = cell[inspectorChannel] ?? 0;
    if (["pressure", "direction", "velocity", "acceleration"].includes(inspectorChannel)) {
      return rgb(scale(mix(DARK, value >= 0 ? POSITIVE : NEGATIVE, clamp(Math.abs(value) * 1.35)), 0.72 + 0.35 * clamp(Math.abs(value))));
    }
    const target = inspectorChannel === "entropy" ? PURPLE : inspectorChannel === "convection" || inspectorChannel === "boundary_energy" ? BLUE : POSITIVE;
    return rgb(mix(DARK, target, clamp(value)));
  }

  const base = pressureColor(cell.pressure);
  if (mode === "regime") {
    const organization = 0.42 + 0.58 * clamp(cell.coherence * (1 - 0.55 * cell.entropy));
    const brightness = 0.42 + 0.58 * clamp(cell.confidence);
    return rgb(scale(mix([128, 132, 139], base, organization), brightness));
  }

  if (mode === "topographic") {
    const bands = Math.max(3, contourBands);
    const band = Math.floor(clamp(cell.reflectivity, 0, 0.9999) * bands) / Math.max(1, bands - 1);
    const contoured = scale(base, 0.43 + 0.72 * band);
    return rgb(mix(contoured, BLUE, clamp(cell.boundary_energy * 0.38 + cell.convection * 0.22)));
  }

  const energized = scale(base, 0.45 + 0.72 * clamp(cell.reflectivity));
  return rgb(mix(energized, BLUE, clamp(cell.convection * 0.72 + cell.expansion * 0.12)));
}

export function channelLabel(channel: string): string {
  return channel
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatSigned(value: number, digits = 2): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}
