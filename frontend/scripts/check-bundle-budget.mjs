import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(SCRIPT_DIR, "../dist");

/**
 * Release budgets are intentionally based on compressed and uncompressed bytes.
 * Raw size limits JavaScript parse/compile work; gzip size limits transfer cost.
 */
const BUDGETS = Object.freeze({
  initialJavaScript: { raw: 500 * 1024, gzip: 160 * 1024 },
  deferredJavaScriptChunk: { raw: 350 * 1024, gzip: 110 * 1024 },
  initialCss: { raw: 200 * 1024, gzip: 40 * 1024 },
});

const REQUIRED_ROUTE_CHUNKS = Object.freeze([
  "Dashboard",
  "Vision",
  "SystemBreakdown",
  "Indicators",
  "IndicatorDetail",
  "MarketNews",
  "MarketMap",
  "SectorProjections",
  "StockAnalysis",
  "InstitutionalFlow",
  "MarketWeatherRadar",
  "SecretOptions",
  "RecapIndex",
  "RecapPost",
  "VolumeBreadthTools",
  "PreciousMetalsDiagnostic",
  "CryptoDiagnostic",
  "AgricultureIndex",
  "EnergyIndex",
  "RealEstateDiagnostic",
]);

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

function getAttribute(tag, attribute) {
  const match = tag.match(new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1];
}

function assetPathFromUrl(url) {
  const cleanUrl = url.split(/[?#]/, 1)[0].replace(/^\/+/, "");
  const assetPath = resolve(DIST_DIR, cleanUrl);
  const pathWithinDist = relative(DIST_DIR, assetPath);

  if (pathWithinDist.startsWith("..") || resolve(DIST_DIR, pathWithinDist) !== assetPath) {
    throw new Error(`Built asset resolves outside dist: ${url}`);
  }

  return assetPath;
}

function collectFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? collectFiles(path) : [path];
  });
}

function measure(path) {
  const contents = readFileSync(path);
  return {
    path,
    raw: contents.byteLength,
    gzip: gzipSync(contents, { level: 9 }).byteLength,
  };
}

function sumMeasurements(measurements) {
  return measurements.reduce(
    (total, item) => ({ raw: total.raw + item.raw, gzip: total.gzip + item.gzip }),
    { raw: 0, gzip: 0 },
  );
}

function checkLimit(label, measurement, budget, failures, report = true) {
  const rawPass = measurement.raw <= budget.raw;
  const gzipPass = measurement.gzip <= budget.gzip;
  const status = rawPass && gzipPass ? "PASS" : "FAIL";

  if (report) {
    console.log(
      `${status.padEnd(4)} ${label.padEnd(30)} ${formatKiB(measurement.raw).padStart(11)} raw / ${formatKiB(measurement.gzip).padStart(11)} gzip ` +
        `(limits ${formatKiB(budget.raw)} / ${formatKiB(budget.gzip)})`,
    );
  }

  if (!rawPass || !gzipPass) {
    failures.push(
      `${label} is ${formatKiB(measurement.raw)} raw / ${formatKiB(measurement.gzip)} gzip`,
    );
  }
}

function main() {
  const indexPath = join(DIST_DIR, "index.html");
  const indexHtml = readFileSync(indexPath, "utf8");
  const tags = indexHtml.match(/<(?:script|link)\b[^>]*>/gi) ?? [];

  const initialJavaScriptPaths = new Set();
  const initialCssPaths = new Set();

  for (const tag of tags) {
    const source = getAttribute(tag, "src");
    const href = getAttribute(tag, "href");
    const type = getAttribute(tag, "type");
    const rel = getAttribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];

    if (source && type?.toLowerCase() === "module") {
      initialJavaScriptPaths.add(assetPathFromUrl(source));
    }
    if (href && rel.includes("modulepreload")) {
      initialJavaScriptPaths.add(assetPathFromUrl(href));
    }
    if (href && rel.includes("stylesheet")) {
      initialCssPaths.add(assetPathFromUrl(href));
    }
  }

  if (initialJavaScriptPaths.size === 0) {
    throw new Error("No initial JavaScript entry was found in dist/index.html.");
  }

  const allJavaScriptPaths = collectFiles(DIST_DIR).filter((path) => path.endsWith(".js"));
  const deferredJavaScriptPaths = allJavaScriptPaths.filter(
    (path) => !initialJavaScriptPaths.has(path),
  );
  const missingRouteChunks = REQUIRED_ROUTE_CHUNKS.filter(
    (name) =>
      !deferredJavaScriptPaths.some((path) => {
        const filename = relative(DIST_DIR, path).replaceAll("\\", "/").split("/").at(-1);
        return filename?.startsWith(`${name}-`);
      }),
  );

  const initialJavaScript = sumMeasurements([...initialJavaScriptPaths].map(measure));
  const initialCss = sumMeasurements([...initialCssPaths].map(measure));
  const deferredChunks = deferredJavaScriptPaths
    .map(measure)
    .sort((left, right) => right.raw - left.raw);
  const failures = [];

  console.log("\nBundle budget");
  checkLimit(
    "Initial JavaScript",
    initialJavaScript,
    BUDGETS.initialJavaScript,
    failures,
  );
  checkLimit("Initial CSS", initialCss, BUDGETS.initialCss, failures);

  for (const chunk of deferredChunks) {
    checkLimit(
      `Deferred ${relative(DIST_DIR, chunk.path).replaceAll("\\", "/")}`,
      chunk,
      BUDGETS.deferredJavaScriptChunk,
      failures,
      false,
    );
  }
  if (deferredChunks[0]) {
    checkLimit(
      `Largest deferred chunk`,
      deferredChunks[0],
      BUDGETS.deferredJavaScriptChunk,
      [],
    );
    console.log(`     ${relative(DIST_DIR, deferredChunks[0].path).replaceAll("\\", "/")}`);
  }

  if (missingRouteChunks.length > 0) {
    failures.push(`missing route chunks: ${missingRouteChunks.join(", ")}`);
  } else {
    console.log(`PASS ${REQUIRED_ROUTE_CHUNKS.length} route modules emitted as deferred chunks`);
  }

  if (failures.length > 0) {
    console.error("\nBundle budget failed:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nBundle budget passed: ${formatKiB(initialJavaScript.raw)} initial JavaScript raw, ` +
      `${formatKiB(initialJavaScript.gzip)} gzip; ${deferredChunks.length} deferred chunks.`,
  );
}

try {
  main();
} catch (error) {
  console.error(`Bundle budget could not be evaluated: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
