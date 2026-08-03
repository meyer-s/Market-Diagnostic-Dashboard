export type ProxyEventSide = "buy" | "sell" | "neutral";

export interface ProxyEventInput {
  date: string;
  price: number;
  volume: number;
  notional: number;
  volume_z: number;
  side: ProxyEventSide;
  strength: number;
}

export interface ProxyEventPosition {
  x: number;
  y: number;
  sequence: number;
}

export interface PositionedProxyEvent extends ProxyEventInput, ProxyEventPosition {
  weight: number;
}

export type ProxyClusterTone = ProxyEventSide | "mixed";

export interface ProxyEventCluster {
  id: string;
  events: PositionedProxyEvent[];
  startDate: string;
  endDate: string;
  totalNotional: number;
  buyNotional: number;
  sellNotional: number;
  neutralNotional: number;
  weightedPrice: number;
  weightedStrength: number;
  centerX: number;
  centerY: number;
  tone: ProxyClusterTone;
}

export interface ProxyClusterThresholds {
  maxSequenceGap: number;
  maxSequenceSpan: number;
  maxCentroidYDistance: number;
  maxVerticalSpan: number;
}

export const DEFAULT_PROXY_CLUSTER_THRESHOLDS: ProxyClusterThresholds = {
  maxSequenceGap: 5,
  maxSequenceSpan: 12,
  maxCentroidYDistance: 18,
  maxVerticalSpan: 36,
};

const finitePositive = (value: number): number | null =>
  Number.isFinite(value) && value > 0 ? value : null;

const isProxyEventSide = (side: string): side is ProxyEventSide =>
  side === "buy" || side === "sell" || side === "neutral";

const eventWeight = (event: ProxyEventInput): number | null =>
  finitePositive(event.notional) ?? finitePositive(event.price * event.volume);

const summarizeCluster = (
  events: PositionedProxyEvent[],
  clusterIndex: number,
): ProxyEventCluster => {
  const totalNotional = events.reduce((sum, event) => sum + event.weight, 0);
  const buyNotional = events.reduce(
    (sum, event) => sum + (event.side === "buy" ? event.weight : 0),
    0,
  );
  const sellNotional = events.reduce(
    (sum, event) => sum + (event.side === "sell" ? event.weight : 0),
    0,
  );
  const neutralNotional = Math.max(0, totalNotional - buyNotional - sellNotional);
  const weighted = (select: (event: PositionedProxyEvent) => number) =>
    events.reduce((sum, event) => sum + select(event) * event.weight, 0) /
    totalNotional;
  const directionalNotional = buyNotional + sellNotional;
  const neutralShare = totalNotional > 0 ? neutralNotional / totalNotional : 1;
  const buyShare = directionalNotional > 0 ? buyNotional / directionalNotional : 0;
  const sellShare = directionalNotional > 0 ? sellNotional / directionalNotional : 0;
  const tone: ProxyClusterTone =
    neutralShare >= 0.6 || directionalNotional === 0
      ? "neutral"
      : buyShare >= 0.8
        ? "buy"
        : sellShare >= 0.8
          ? "sell"
          : "mixed";
  const startDate = events[0].date;
  const endDate = events[events.length - 1].date;

  return {
    id: `${startDate}-${endDate}-${clusterIndex}`,
    events,
    startDate,
    endDate,
    totalNotional,
    buyNotional,
    sellNotional,
    neutralNotional,
    weightedPrice: weighted((event) => event.price),
    weightedStrength: weighted((event) =>
      Number.isFinite(event.strength) ? event.strength : 0,
    ),
    centerX: weighted((event) => event.x),
    centerY: weighted((event) => event.y),
    tone,
  };
};

export function buildProxyEventClusters(
  events: ProxyEventInput[],
  resolvePosition: (event: ProxyEventInput) => ProxyEventPosition | null,
  thresholds: ProxyClusterThresholds = DEFAULT_PROXY_CLUSTER_THRESHOLDS,
): ProxyEventCluster[] {
  const positioned = events
    .map((event) => {
      if (!/^\d{4}-\d{2}-\d{2}/.test(event.date)) return null;
      if (!finitePositive(event.price)) return null;
      if (!isProxyEventSide(event.side)) return null;
      const weight = eventWeight(event);
      const position = resolvePosition(event);
      if (
        weight === null ||
        position === null ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        !Number.isFinite(position.sequence)
      ) {
        return null;
      }
      return { ...event, ...position, weight } satisfies PositionedProxyEvent;
    })
    .filter((event): event is PositionedProxyEvent => event !== null)
    .sort(
      (left, right) =>
        left.sequence - right.sequence ||
        left.date.localeCompare(right.date) ||
        left.side.localeCompare(right.side) ||
        left.price - right.price ||
        left.weight - right.weight,
    );

  if (!positioned.length) return [];

  const groups: PositionedProxyEvent[][] = [];
  positioned.forEach((event) => {
    const current = groups[groups.length - 1];
    if (!current) {
      groups.push([event]);
      return;
    }

    const first = current[0];
    const previous = current[current.length - 1];
    const currentWeight = current.reduce((sum, item) => sum + item.weight, 0);
    const centroidY =
      current.reduce((sum, item) => sum + item.y * item.weight, 0) /
      currentWeight;
    const currentYValues = current.map((item) => item.y);
    const nextMinY = Math.min(...currentYValues, event.y);
    const nextMaxY = Math.max(...currentYValues, event.y);
    const joinsCurrent =
      event.sequence - previous.sequence <= thresholds.maxSequenceGap &&
      event.sequence - first.sequence <= thresholds.maxSequenceSpan &&
      Math.abs(event.y - centroidY) <= thresholds.maxCentroidYDistance &&
      nextMaxY - nextMinY <= thresholds.maxVerticalSpan;

    if (joinsCurrent) {
      current.push(event);
    } else {
      groups.push([event]);
    }
  });

  return groups.map((group, index) => summarizeCluster(group, index));
}

export function percentile(values: number[], quantile: number): number {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const bounded = Math.max(0, Math.min(1, quantile));
  const position = (sorted.length - 1) * bounded;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sorted[lowerIndex];
  const fraction = position - lowerIndex;
  return sorted[lowerIndex] * (1 - fraction) + sorted[upperIndex] * fraction;
}

export function proxyEventRadius(notional: number, visibleReference: number): number {
  if (!Number.isFinite(notional) || notional <= 0) return 0;
  const reference =
    Number.isFinite(visibleReference) && visibleReference > 0
      ? visibleReference
      : notional;
  return Math.max(3.5, Math.min(8.5, 5 * Math.sqrt(notional / reference)));
}

export interface ProxyClusterHalo {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export function proxyClusterHalo(
  cluster: ProxyEventCluster,
  visibleReference: number,
): ProxyClusterHalo | null {
  if (cluster.events.length < 2) return null;
  const bounds = cluster.events.map((event) => {
    const radius = proxyEventRadius(event.weight, visibleReference);
    return {
      left: event.x - radius,
      right: event.x + radius,
      top: event.y - radius,
      bottom: event.y + radius,
    };
  });
  const left = Math.min(...bounds.map((bound) => bound.left));
  const right = Math.max(...bounds.map((bound) => bound.right));
  const top = Math.min(...bounds.map((bound) => bound.top));
  const bottom = Math.max(...bounds.map((bound) => bound.bottom));
  const padding = 3.5;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  let rx = Math.max(9, (right - left) / 2 + padding);
  let ry = Math.max(9, (bottom - top) / 2 + padding);
  const requiredScale = Math.max(
    1,
    ...bounds.flatMap((bound) =>
      [
        [bound.left, bound.top],
        [bound.left, bound.bottom],
        [bound.right, bound.top],
        [bound.right, bound.bottom],
      ].map(([x, y]) =>
        Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2),
      ),
    ),
  );
  rx *= requiredScale;
  ry *= requiredScale;

  return {
    cx,
    cy,
    rx,
    ry,
  };
}
