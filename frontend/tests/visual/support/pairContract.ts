import { expect, type APIResponse, type TestInfo } from "@playwright/test";

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  expect(value, `${label} must be an object`).toBeTruthy();
  expect(Array.isArray(value), `${label} must not be an array`).toBe(false);
  expect(typeof value, `${label} must be an object`).toBe("object");
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), `${label} must be an array`).toBe(true);
  return value as unknown[];
}

function finiteNumber(value: unknown, label: string): number {
  expect(typeof value, `${label} must be numeric`).toBe("number");
  expect(Number.isFinite(value), `${label} must be finite`).toBe(true);
  return value as number;
}

function integer(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  expect(Number.isInteger(number), `${label} must be an integer`).toBe(true);
  return number;
}

function string(value: unknown, label: string): string {
  expect(typeof value, `${label} must be a string`).toBe("string");
  expect((value as string).length, `${label} must not be empty`).toBeGreaterThan(0);
  return value as string;
}

function hash(value: unknown, label: string): string {
  const text = string(value, label);
  expect(text, `${label} must be a lowercase SHA-256 checksum`).toMatch(/^[a-f0-9]{64}$/);
  return text;
}

function optionalFinite(value: unknown, label: string): void {
  if (value !== null && value !== undefined) finiteNumber(value, label);
}

function uniqueStrings(values: string[], label: string): void {
  expect(new Set(values).size, `${label} must be unique`).toBe(values.length);
}

/**
 * Runtime validation for the public Pair-v1 evidence boundary.
 *
 * This deliberately checks invariants across sections rather than duplicating
 * the TypeScript response interface. It catches contract drift that would
 * otherwise still satisfy a set of isolated property-existence assertions.
 */
export function assertPairV1Contract(payload: unknown, receiptHeader?: string | null): JsonRecord {
  const root = record(payload, "response");
  expect(root.schema_version).toBe("market_field_pair_v1");
  string(root.semantic_revision, "semantic_revision");
  string(root.generated_at, "generated_at");

  const target = record(root.target, "target");
  const benchmark = record(root.benchmark, "benchmark");
  const targetSymbol = string(target.symbol, "target.symbol");
  const benchmarkSymbol = string(benchmark.symbol, "benchmark.symbol");
  hash(target.analysis_hash, "target.analysis_hash");
  hash(benchmark.analysis_hash, "benchmark.analysis_hash");
  hash(root.comparison_hash, "comparison_hash");
  expect(targetSymbol).not.toBe(benchmarkSymbol);

  const window = record(root.window, "window");
  const returned = integer(
    window.returned_exact_shared_observations,
    "window.returned_exact_shared_observations",
  );
  expect(returned).toBeGreaterThan(0);
  expect(integer(window.available_exact_shared_observations, "window.available_exact_shared_observations"))
    .toBeGreaterThanOrEqual(returned);
  const windowStart = string(window.start, "window.start");
  const windowEnd = string(window.end, "window.end");

  const overlap = record(root.overlap, "overlap");
  expect(integer(overlap.common_observations, "overlap.common_observations")).toBe(returned);
  expect(integer(overlap.returned_common_observations, "overlap.returned_common_observations")).toBe(returned);
  expect(overlap.start).toBe(windowStart);
  expect(overlap.end).toBe(windowEnd);
  expect(overlap.latest_aligned_at).toBe(windowEnd);
  expect(overlap.alignment_supported).toBe(true);
  expect(overlap.alignment_status).toBe("aligned");
  string(overlap.alignment_rule, "overlap.alignment_rule");

  const priceSeries = array(root.price_series, "price_series").map((value, index) => {
    const row = record(value, `price_series[${index}]`);
    string(row.date, `price_series[${index}].date`);
    finiteNumber(row.target_close, `price_series[${index}].target_close`);
    finiteNumber(row.benchmark_close, `price_series[${index}].benchmark_close`);
    finiteNumber(row.relative_index, `price_series[${index}].relative_index`);
    finiteNumber(row.active_return, `price_series[${index}].active_return`);
    optionalFinite(row.prior_return_beta, `price_series[${index}].prior_return_beta`);
    optionalFinite(
      row.beta_adjusted_cumulative_return,
      `price_series[${index}].beta_adjusted_cumulative_return`,
    );
    return row;
  });
  expect(priceSeries).toHaveLength(returned);
  const alignedDates = priceSeries.map((row) => row.date as string);
  uniqueStrings(alignedDates, "price_series dates");
  expect([...alignedDates].sort()).toEqual(alignedDates);
  expect(alignedDates[0]).toBe(windowStart);
  expect(alignedDates.at(-1)).toBe(windowEnd);

  const coordinates = array(root.coordinates, "coordinates").map((value, coordinateIndex) => {
    const coordinate = record(value, `coordinates[${coordinateIndex}]`);
    string(coordinate.id, `coordinates[${coordinateIndex}].id`);
    string(coordinate.label, `coordinates[${coordinateIndex}].label`);
    string(coordinate.family, `coordinates[${coordinateIndex}].family`);
    const series = array(coordinate.series, `coordinates[${coordinateIndex}].series`);
    expect(series).toHaveLength(returned);
    const seriesRows = series.map((seriesValue, rowIndex) => {
      const row = record(seriesValue, `coordinates[${coordinateIndex}].series[${rowIndex}]`);
      string(row.date, `coordinates[${coordinateIndex}].series[${rowIndex}].date`);
      expect(typeof row.target_supported).toBe("boolean");
      expect(typeof row.benchmark_supported).toBe("boolean");
      expect(typeof row.pair_supported).toBe("boolean");
      optionalFinite(row.target, `coordinates[${coordinateIndex}].series[${rowIndex}].target`);
      optionalFinite(row.benchmark, `coordinates[${coordinateIndex}].series[${rowIndex}].benchmark`);
      optionalFinite(
        row.native_difference,
        `coordinates[${coordinateIndex}].series[${rowIndex}].native_difference`,
      );
      optionalFinite(
        row.context_difference,
        `coordinates[${coordinateIndex}].series[${rowIndex}].context_difference`,
      );
      return row;
    });
    const coordinateDates = seriesRows.map((row) => row.date as string);
    expect(coordinateDates).toEqual(alignedDates);
    const latest = record(coordinate.latest, `coordinates[${coordinateIndex}].latest`);
    const lastSeriesRow = seriesRows.at(-1) as JsonRecord;
    for (const key of [
      "target",
      "benchmark",
      "target_context",
      "benchmark_context",
      "native_difference",
      "context_difference",
      "target_supported",
      "benchmark_supported",
      "pair_supported",
    ]) {
      expect(latest[key], `coordinates[${coordinateIndex}].latest.${key} must match the final series row`)
        .toEqual(lastSeriesRow[key]);
    }
    return coordinate;
  });
  expect(coordinates).toHaveLength(15);
  uniqueStrings(coordinates.map((coordinate) => coordinate.id as string), "coordinate ids");

  const support = record(root.support, "support");
  const supportedCells = integer(support.supported_coordinate_cells, "support.supported_coordinate_cells");
  const totalCells = integer(support.total_coordinate_cells, "support.total_coordinate_cells");
  const supportFraction = finiteNumber(support.support_fraction, "support.support_fraction");
  expect(totalCells).toBe(15 * returned);
  expect(supportedCells).toBeGreaterThanOrEqual(0);
  expect(supportedCells).toBeLessThanOrEqual(totalCells);
  expect(supportFraction).toBeCloseTo(supportedCells / totalCells, 12);
  expect(support.missing_values_carried).toBe(false);
  expect(overlap.supported_coordinate_cells).toBe(supportedCells);
  expect(overlap.total_coordinate_cells).toBe(totalCells);

  const compatibility = record(root.compatibility, "compatibility");
  const session = record(compatibility.session, "compatibility.session");
  string(session.status, "compatibility.session.status");
  expect(typeof session.independently_certified).toBe("boolean");
  const timestampAlignment = record(
    compatibility.timestamp_alignment,
    "compatibility.timestamp_alignment",
  );
  expect(timestampAlignment.status).toBe("supported");
  string(timestampAlignment.rule, "compatibility.timestamp_alignment.rule");

  const summary = record(root.summary, "summary");
  expect(summary.schema_version).toBe("pair_summary_v1");
  expect(summary.title).toBe(`${targetSymbol} compared with ${benchmarkSymbol}`);
  expect(summary.observed_through).toBe(windowEnd);
  string(summary.text, "summary.text");
  expect(array(summary.sentences, "summary.sentences").length).toBeGreaterThanOrEqual(3);
  expect(summary.authority).toBe("deterministic_descriptive_only");

  const relativeProgress = record(root.relative_progress, "relative_progress");
  finiteNumber(relativeProgress.relative_index, "relative_progress.relative_index");
  finiteNumber(relativeProgress.active_return_pct, "relative_progress.active_return_pct");
  optionalFinite(relativeProgress.beta, "relative_progress.beta");
  optionalFinite(
    relativeProgress.beta_adjusted_return_pct,
    "relative_progress.beta_adjusted_return_pct",
  );
  const fieldSeparation = record(relativeProgress.field_separation, "relative_progress.field_separation");
  finiteNumber(fieldSeparation.latest_stretch, "relative_progress.field_separation.latest_stretch");
  finiteNumber(fieldSeparation.prior_stretch, "relative_progress.field_separation.prior_stretch");
  finiteNumber(fieldSeparation.change, "relative_progress.field_separation.change");
  finiteNumber(fieldSeparation.tolerance, "relative_progress.field_separation.tolerance");

  const provenance = record(root.provenance, "provenance");
  hash(provenance.target_analysis_hash, "provenance.target_analysis_hash");
  hash(provenance.benchmark_analysis_hash, "provenance.benchmark_analysis_hash");
  hash(provenance.comparison_hash, "provenance.comparison_hash");
  expect(provenance.comparison_hash).toBe(root.comparison_hash);
  expect(provenance.ordered_pair).toBe(true);

  const authority = record(root.authority, "authority");
  expect(authority.mode).toBe("research_display_only");
  expect(authority.scanner_weight).toBe(0);
  expect(authority.option_learning_weight).toBe(0);
  expect(authority.veto).toBe(false);
  expect(authority.sizing).toBe(false);
  expect(authority.execution).toBe(false);

  const receipt = record(root.frozen_receipt, "frozen_receipt");
  expect(receipt.schema_version).toBe("market_field_pair_receipt_v1");
  if (receipt.pair_schema_version !== undefined) {
    expect(receipt.pair_schema_version).toBe("market_field_pair_v1");
  }
  const receiptHash = hash(receipt.receipt_hash, "frozen_receipt.receipt_hash");
  if (receiptHeader !== null && receiptHeader !== undefined) {
    expect(receiptHeader, "receipt response header must match the body").toBe(receiptHash);
  }

  return root;
}

export async function attachProbeEvidence(
  response: APIResponse,
  payload: JsonRecord,
  durationMs: number,
  testInfo: TestInfo,
): Promise<void> {
  const evidence = {
    probed_at: new Date().toISOString(),
    route: response.url(),
    status: response.status(),
    duration_ms: durationMs,
    schema_version: payload.schema_version,
    semantic_revision: payload.semantic_revision,
    target: record(payload.target, "target").symbol,
    benchmark: record(payload.benchmark, "benchmark").symbol,
    returned_exact_shared_observations: record(payload.window, "window")
      .returned_exact_shared_observations,
    comparison_hash: payload.comparison_hash,
    receipt_hash: record(payload.frozen_receipt, "frozen_receipt").receipt_hash,
    receipt_header: response.headers()["x-market-weather-receipt-hash"] ?? null,
  };
  await testInfo.attach("pair-production-probe.json", {
    body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8"),
    contentType: "application/json",
  });
}
