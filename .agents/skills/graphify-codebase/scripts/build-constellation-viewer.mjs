#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DOMAIN_DEFINITIONS = [
  ["backend-api", "Backend API", "#83bfff"],
  ["backend-services", "Backend services", "#63c5d4"],
  ["data-models", "Data & models", "#a7b7cf"],
  ["backend-core", "Backend core", "#7f94b0"],
  ["frontend", "Frontend", "#b9a5ff"],
  ["tests", "Tests", "#e5a3c9"],
  ["tooling", "Tooling", "#73a7ee"],
  ["unresolved", "Unresolved", "#8f9aad"],
];

const KIND_NAMES = ["file", "function", "class", "symbol", "unresolved"];

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function normalizePath(value) {
  return typeof value === "string" ? value.replaceAll("\\", "/") : "";
}

function classifyDomain(sourceFile, isExternal) {
  if (isExternal) return "unresolved";
  const source = normalizePath(sourceFile).toLowerCase();
  if (/(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[^/]+$/.test(source)) return "tests";
  if (source.startsWith("backend/app/api/")) return "backend-api";
  if (/^backend\/app\/(services|scripts|jobs|tasks|diagnostics|scheduler)\//.test(source)) return "backend-services";
  if (/^backend\/(alembic\/|app\/(models|db|schemas|repositories)\/)/.test(source)) return "data-models";
  if (source.startsWith("frontend/")) return "frontend";
  if (source.startsWith("backend/")) return "backend-core";
  return "tooling";
}

function inferKind(label, sourceFile, isExternal) {
  if (isExternal) return "unresolved";
  const value = typeof label === "string" ? label.trim() : "";
  const sourceName = path.posix.basename(normalizePath(sourceFile));
  if (value === sourceName || /\.(py|tsx?|jsx?|css|scss|sql|json|ya?ml|toml|md)$/i.test(value)) return "file";
  if (/\(\)$/.test(value)) return "function";
  if (/^[A-Z][A-Za-z0-9_]*$/.test(value)) return "class";
  return "symbol";
}

function externalLabel(id) {
  return String(id).replaceAll("_", ".");
}

const args = parseArgs(process.argv.slice(2));
if (!args.graph) fail("--graph is required");
if (!args.output) fail("--output is required");

const graphPath = path.resolve(args.graph);
const outputPath = path.resolve(args.output);
const repoRoot = args.repo ? path.resolve(args.repo) : "";
const productLabel = args.label || "Codebase";

if (!fs.existsSync(graphPath)) fail(`Graph file does not exist: ${graphPath}`);

let graph;
try {
  graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
} catch (error) {
  fail(`Unable to read Graphify graph: ${error.message}`);
}

if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
  fail("Graphify graph must contain nodes and edges arrays.");
}

const sourceNodes = graph.nodes.map((node) => ({
  id: String(node.id),
  label: String(node.label || node.id),
  sourceFile: normalizePath(node.source_file),
  sourceLocation: String(node.source_location || ""),
  isExternal: !normalizePath(node.source_file),
}));
const knownIds = new Set(sourceNodes.map((node) => node.id));
const externalIds = new Set();

for (const edge of graph.edges) {
  const source = String(edge.source);
  const target = String(edge.target);
  if (!knownIds.has(source)) externalIds.add(source);
  if (!knownIds.has(target)) externalIds.add(target);
}

for (const id of [...externalIds].sort((left, right) => left.localeCompare(right))) {
  sourceNodes.push({
    id,
    label: externalLabel(id),
    sourceFile: "",
    sourceLocation: "",
    isExternal: true,
  });
  knownIds.add(id);
}

const nodeIndex = new Map(sourceNodes.map((node, index) => [node.id, index]));
const inDegree = new Uint32Array(sourceNodes.length);
const outDegree = new Uint32Array(sourceNodes.length);
const relationNames = [...new Set(graph.edges.map((edge) => String(edge.relation || "related")))].sort();
const relationIndex = new Map(relationNames.map((relation, index) => [relation, index]));
const compactEdges = [];
let suppressedCrossLanguage = 0;

function languageFamily(sourceFile) {
  const extension = path.posix.extname(normalizePath(sourceFile)).toLowerCase();
  if (extension === ".py") return "python";
  if ([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(extension)) return "javascript";
  return "";
}

for (const edge of graph.edges) {
  const source = nodeIndex.get(String(edge.source));
  const target = nodeIndex.get(String(edge.target));
  if (!Number.isInteger(source) || !Number.isInteger(target)) continue;
  const sourceFamily = languageFamily(sourceNodes[source].sourceFile);
  const targetFamily = languageFamily(sourceNodes[target].sourceFile);
  if (sourceFamily && targetFamily && sourceFamily !== targetFamily) {
    suppressedCrossLanguage += 1;
    continue;
  }
  outDegree[source] += 1;
  inDegree[target] += 1;
  compactEdges.push([
    source,
    target,
    relationIndex.get(String(edge.relation || "related")),
    String(edge.confidence || "").toUpperCase() === "INFERRED" ? 1 : 0,
  ]);
}

const domainIndex = new Map(DOMAIN_DEFINITIONS.map(([key], index) => [key, index]));
const kindIndex = new Map(KIND_NAMES.map((kind, index) => [kind, index]));
const compactNodes = sourceNodes.map((node, index) => {
  const domain = classifyDomain(node.sourceFile, node.isExternal);
  const kind = inferKind(node.label, node.sourceFile, node.isExternal);
  return [
    node.id,
    node.label,
    node.sourceFile,
    node.sourceLocation,
    domainIndex.get(domain),
    kindIndex.get(kind),
    inDegree[index] + outDegree[index],
    inDegree[index],
    outDegree[index],
    node.isExternal ? 1 : 0,
  ];
});

const payload = {
  meta: {
    label: productLabel,
    repo: repoRoot,
    indexedNodes: graph.nodes.length,
    unresolvedTargets: externalIds.size,
    relationships: compactEdges.length,
    rawRelationships: graph.edges.length,
    suppressedCrossLanguage,
    generatedAt: new Date().toISOString(),
  },
  domains: DOMAIN_DEFINITIONS,
  kinds: KIND_NAMES,
  relations: relationNames,
  nodes: compactNodes,
  edges: compactEdges,
};

const embeddedPayload = JSON.stringify(payload)
  .replaceAll("<", "\\u003c")
  .replaceAll("\u2028", "\\u2028")
  .replaceAll("\u2029", "\\u2029");

const html = `<!doctype html>
<!--
THESIS: Make a large code graph navigable as an architecture field, refusing both the vertical tree and the all-edge hairball.
OWN-WORLD: Evidence Field dark surfaces, crisp structural borders, layer color, symbol shape, and one restrained selected-node ring.
STORY: Orient across the system, find any symbol, then reduce the graph to a verifiable one-hop neighborhood.
FIRST VIEWPORT: A rotatable constellation owns the canvas; search and mode controls sit above it; a source-and-relationship inspector stays visible at right.
FORM: A focused operational constellation, directly shaped as a local extension of the established product world; no concept seed was needed.
-->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; connect-src 'none'">
  <title>Architecture Constellation · ${escapeHtml(productLabel)}</title>
  <style>
    :root {
      color-scheme: dark;
      --canvas: #0e1520;
      --surface: #182333;
      --surface-raised: #1e2b3d;
      --surface-quiet: #121c2a;
      --border: #3f5068;
      --border-soft: #2b394d;
      --text: #f4f7fb;
      --muted: #b7c3d3;
      --dim: #8998ad;
      --evidence: #83bfff;
      --stable: #69d6a3;
      --caution: #f3cb69;
      --stress: #ff8a93;
      --radius: 12px;
      --shadow: 0 18px 44px rgba(4, 9, 15, 0.28);
      font-family: "Segoe UI Variable", "Aptos", "Segoe UI", system-ui, sans-serif;
      font-size: 16px;
    }

    * { box-sizing: border-box; }

    html, body { margin: 0; min-height: 100%; background: var(--canvas); color: var(--text); }

    body {
      min-height: 100vh;
      min-height: 100dvh;
      overflow: hidden;
    }

    button, input, select { font: inherit; }

    button, select, input {
      color: var(--text);
    }

    button:focus-visible, input:focus-visible, select:focus-visible, canvas:focus-visible {
      outline: 3px solid rgba(131, 191, 255, 0.72);
      outline-offset: 2px;
    }

    .skip-link {
      position: fixed;
      left: 16px;
      top: 12px;
      z-index: 50;
      transform: translateY(-150%);
      padding: 10px 14px;
      border-radius: 8px;
      background: var(--text);
      color: var(--canvas);
    }

    .skip-link:focus { transform: translateY(0); }

    .app-shell {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      height: 100vh;
      height: 100dvh;
      min-height: 640px;
      background:
        radial-gradient(circle at 38% 44%, rgba(56, 86, 125, 0.13), transparent 42%),
        var(--canvas);
    }

    .topbar {
      display: flex;
      align-items: center;
      gap: 24px;
      min-height: 76px;
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
      background: rgba(14, 21, 32, 0.96);
    }

    .identity {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 250px;
    }

    .identity-mark {
      position: relative;
      width: 36px;
      height: 36px;
      flex: 0 0 auto;
      border: 1px solid var(--border);
      border-radius: 50%;
    }

    .identity-mark::before,
    .identity-mark::after {
      content: "";
      position: absolute;
      inset: 8px;
      border: 1px solid var(--evidence);
      border-radius: 50%;
    }

    .identity-mark::after {
      inset: 15px;
      background: var(--evidence);
      border: 0;
    }

    .kicker {
      margin: 0 0 2px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: clamp(18px, 1.7vw, 24px);
      font-weight: 670;
      letter-spacing: -0.02em;
      line-height: 1.15;
    }

    .graph-summary {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-left: auto;
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }

    .summary-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--evidence);
    }

    .workspace {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 370px);
      min-height: 0;
    }

    .graph-region {
      position: relative;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      min-width: 0;
      min-height: 0;
      border-right: 1px solid var(--border);
    }

    .command-deck {
      position: relative;
      z-index: 5;
      display: grid;
      grid-template-columns: minmax(240px, 1fr) auto auto auto auto;
      gap: 10px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-soft);
      background: rgba(18, 28, 42, 0.96);
    }

    .search-wrap { position: relative; min-width: 0; }

    .search-input {
      width: 100%;
      min-height: 44px;
      padding: 10px 14px 10px 42px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface);
      color: var(--text);
    }

    .search-input::placeholder { color: var(--dim); }

    .search-icon {
      position: absolute;
      left: 15px;
      top: 13px;
      width: 17px;
      height: 17px;
      border: 1.5px solid var(--muted);
      border-radius: 50%;
      pointer-events: none;
    }

    .search-icon::after {
      content: "";
      position: absolute;
      width: 7px;
      height: 1.5px;
      right: -5px;
      bottom: -3px;
      transform: rotate(45deg);
      background: var(--muted);
    }

    .search-results {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      right: 0;
      z-index: 20;
      display: none;
      max-height: min(430px, 52vh);
      overflow-y: auto;
      padding: 6px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-raised);
      box-shadow: var(--shadow);
    }

    .search-results.is-open { display: block; }

    .search-result {
      display: grid;
      grid-template-columns: 10px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 52px;
      padding: 8px 10px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      text-align: left;
      cursor: pointer;
    }

    .search-result:hover,
    .search-result.is-active { background: #26354a; }

    .result-swatch { width: 8px; height: 8px; border-radius: 50%; }
    .result-copy { min-width: 0; }
    .result-label { display: block; overflow: hidden; font-size: 14px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .result-path { display: block; overflow: hidden; margin-top: 2px; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .result-degree { color: var(--muted); font-size: 12px; }

    .mode-switch {
      display: grid;
      grid-template-columns: 1fr 1fr;
      min-width: 222px;
      padding: 3px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--canvas);
    }

    .mode-button,
    .tool-button {
      min-height: 38px;
      padding: 8px 13px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      white-space: nowrap;
    }

    .mode-button[aria-pressed="true"] {
      background: var(--surface-raised);
      color: var(--text);
      box-shadow: inset 0 0 0 1px var(--border-soft);
    }

    .tool-button {
      min-height: 44px;
      border: 1px solid var(--border);
      background: var(--surface);
    }

    .tool-button:hover { background: var(--surface-raised); color: var(--text); }
    .tool-button[aria-pressed="true"] { border-color: #5f7899; color: var(--evidence); }
    .tool-button:disabled { cursor: not-allowed; opacity: 0.48; }

    .density-select {
      min-height: 44px;
      padding: 8px 34px 8px 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface);
      cursor: pointer;
    }

    .stage {
      position: relative;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      background:
        radial-gradient(circle at center, rgba(36, 56, 82, 0.22), transparent 48%),
        var(--canvas);
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 360px;
      touch-action: pan-y;
      cursor: grab;
    }

    canvas.is-dragging { cursor: grabbing; }

    .stage-hud {
      position: absolute;
      left: 16px;
      top: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 6px 10px;
      border: 1px solid var(--border-soft);
      border-radius: 8px;
      background: rgba(18, 28, 42, 0.9);
      color: var(--muted);
      font-size: 12px;
      pointer-events: none;
    }

    .hud-signal { width: 7px; height: 7px; border-radius: 50%; background: var(--evidence); }

    .layer-deck {
      position: absolute;
      left: 16px;
      right: 16px;
      bottom: 14px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 10px;
      border: 1px solid var(--border-soft);
      border-radius: 10px;
      background: rgba(18, 28, 42, 0.93);
      box-shadow: 0 10px 24px rgba(4, 9, 15, 0.2);
    }

    .layer-label { flex: 0 0 auto; color: var(--muted); font-size: 12px; font-weight: 650; }

    .domain-filters {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      overflow-x: auto;
      scrollbar-width: thin;
    }

    .domain-chip { position: relative; flex: 0 0 auto; }
    .domain-chip input { position: absolute; opacity: 0; pointer-events: none; }

    .domain-chip span {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 34px;
      padding: 6px 9px;
      border: 1px solid transparent;
      border-radius: 8px;
      color: var(--dim);
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }

    .domain-chip input:checked + span { border-color: var(--border); background: var(--surface); color: var(--text); }
    .domain-chip input:focus-visible + span { outline: 3px solid rgba(131, 191, 255, 0.72); outline-offset: 2px; }
    .chip-swatch { width: 8px; height: 8px; border-radius: 50%; }

    .inspector {
      min-width: 0;
      min-height: 0;
      overflow-y: auto;
      background: var(--surface-quiet);
    }

    .inspector-inner { padding: 22px 20px 30px; }

    .inspector h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 670;
      letter-spacing: -0.015em;
    }

    .inspector-intro { margin: 8px 0 0; color: var(--muted); font-size: 13px; line-height: 1.55; }

    .empty-state { padding-top: 24px; }

    .empty-map {
      position: relative;
      width: 96px;
      height: 96px;
      margin: 4px 0 22px;
      border: 1px solid var(--border);
      border-radius: 50%;
    }

    .empty-map::before,
    .empty-map::after {
      content: "";
      position: absolute;
      border: 1px solid var(--border-soft);
      border-radius: 50%;
    }

    .empty-map::before { inset: 17px -1px; }
    .empty-map::after { inset: -1px 28px; }

    .empty-map i {
      position: absolute;
      left: 43px;
      top: 43px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--evidence);
    }

    .empty-title { margin: 0; font-size: 16px; font-weight: 650; }
    .empty-copy { margin: 8px 0 0; color: var(--muted); font-size: 13px; line-height: 1.55; }

    .hub-list { display: grid; gap: 6px; margin-top: 22px; }

    .hub-button,
    .relationship-button {
      width: 100%;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      text-align: left;
      cursor: pointer;
    }

    .hub-button {
      display: grid;
      grid-template-columns: 9px minmax(0, 1fr) auto;
      align-items: center;
      gap: 9px;
      min-height: 44px;
      padding: 7px 8px;
      color: var(--text);
    }

    .hub-button:hover,
    .relationship-button:hover { border-color: var(--border-soft); background: var(--surface); }
    .hub-name { overflow: hidden; font-size: 13px; font-weight: 630; text-overflow: ellipsis; white-space: nowrap; }
    .hub-degree { color: var(--muted); font-size: 12px; }

    .selection { display: none; }
    .selection.is-visible { display: block; }
    .empty-state.is-hidden { display: none; }

    .selection-head { margin-top: 20px; }
    .node-tags { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; }

    .node-tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 28px;
      padding: 4px 8px;
      border: 1px solid var(--border);
      border-radius: 7px;
      color: var(--muted);
      font-size: 12px;
    }

    .node-title {
      margin: 0;
      overflow-wrap: anywhere;
      font-size: 21px;
      font-weight: 680;
      letter-spacing: -0.025em;
      line-height: 1.2;
    }

    .source-path {
      display: block;
      margin-top: 10px;
      color: var(--muted);
      font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
      font-size: 12px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }

    .metric-strip {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      margin-top: 20px;
      border-block: 1px solid var(--border-soft);
    }

    .metric { padding: 13px 8px 13px 0; }
    .metric + .metric { padding-left: 12px; border-left: 1px solid var(--border-soft); }
    .metric-value { display: block; font-size: 18px; font-weight: 680; }
    .metric-label { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; }

    .relationship-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-top: 24px;
    }

    .relationship-head h3 { margin: 0; font-size: 14px; font-weight: 670; }
    .relationship-count { color: var(--muted); font-size: 12px; }
    .relationship-list { display: grid; gap: 5px; margin-top: 10px; }

    .relationship-button {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr);
      gap: 8px;
      min-height: 48px;
      padding: 7px 8px;
      color: var(--text);
    }

    .relationship-direction { padding-top: 1px; color: var(--evidence); font-size: 15px; }
    .relationship-name { display: block; overflow: hidden; font-size: 13px; font-weight: 630; text-overflow: ellipsis; white-space: nowrap; }
    .relationship-meta { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; }
    .relationship-note { margin: 10px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; }

    .statusbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 36px;
      padding: 7px 16px;
      border-top: 1px solid var(--border);
      background: var(--canvas);
      color: var(--muted);
      font-size: 12px;
    }

    .statusbar strong { color: var(--caution); font-weight: 650; }
    .keyboard-help { white-space: nowrap; }

    .sr-only {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      margin: -1px !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      border: 0 !important;
    }

    @media (max-width: 1040px) {
      .command-deck { grid-template-columns: minmax(220px, 1fr) auto auto auto; }
      .density-select { display: none; }
      .graph-summary { display: none; }
      .workspace { grid-template-columns: minmax(0, 1fr) 320px; }
    }

    @media (max-width: 780px) {
      body { overflow: auto; }
      .app-shell { height: auto; min-height: 100dvh; }
      .topbar { min-height: 68px; padding: 12px 14px; }
      .identity { min-width: 0; }
      .identity-mark { width: 32px; height: 32px; }
      .identity-mark::after { inset: 13px; }
      .workspace { display: block; }
      .graph-region { height: min(68dvh, 640px); min-height: 510px; border-right: 0; border-bottom: 1px solid var(--border); }
      .command-deck { grid-template-columns: 1fr auto; padding: 10px; }
      .search-wrap { grid-column: 1 / -1; }
      .mode-switch { min-width: 0; }
      .tool-button { padding-inline: 12px; }
      .stage-hud { left: 10px; top: 10px; }
      .layer-deck { left: 10px; right: 10px; bottom: 10px; align-items: flex-start; }
      .layer-label { padding-top: 9px; }
      .inspector { overflow: visible; }
      .inspector-inner { padding: 22px 16px 34px; }
      .statusbar { align-items: flex-start; flex-direction: column; }
      .keyboard-help { display: none; }
    }

    @media (max-width: 460px) {
      .kicker { font-size: 12px; }
      h1 { font-size: 18px; }
      .command-deck { grid-template-columns: 1fr 1fr; }
      .search-wrap, .mode-switch { grid-column: 1 / -1; }
      .tool-button { grid-column: auto; }
      .graph-region { height: 72dvh; min-height: 570px; }
      .layer-deck { display: block; padding: 8px; }
      .layer-label { display: block; margin-bottom: 6px; padding: 0; }
      .domain-filters { padding-bottom: 2px; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; }
    }
  </style>
</head>
<body>
  <a class="skip-link" href="#inspectorTitle">Skip to graph details</a>
  <div class="app-shell">
    <header class="topbar">
      <div class="identity">
        <div class="identity-mark" aria-hidden="true"></div>
        <div>
          <p class="kicker">${escapeHtml(productLabel)} · local graph</p>
          <h1>Architecture Constellation</h1>
        </div>
      </div>
      <div class="graph-summary" aria-label="Graph summary">
        <span class="summary-dot" aria-hidden="true"></span>
        <span id="summaryText"></span>
      </div>
    </header>

    <main class="workspace">
      <section class="graph-region" aria-label="Interactive architecture graph">
        <div class="command-deck">
          <div class="search-wrap">
            <label class="sr-only" for="nodeSearch">Find any file, function, class, or unresolved dependency target</label>
            <span class="search-icon" aria-hidden="true"></span>
            <input class="search-input" id="nodeSearch" type="search" role="combobox" autocomplete="off" placeholder="Find any symbol or source file…" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="searchResults" aria-expanded="false">
            <div class="search-results" id="searchResults" role="listbox" aria-label="Matching graph nodes"></div>
          </div>

          <div class="mode-switch" aria-label="Graph view mode">
            <button class="mode-button" id="sphereMode" type="button" aria-pressed="true">Sphere</button>
            <button class="mode-button" id="neighborhoodMode" type="button" aria-pressed="false">Neighborhood</button>
          </div>

          <button class="tool-button" id="rotationToggle" type="button" aria-pressed="false">Rotate</button>

          <button class="tool-button" id="resetButton" type="button">Reset</button>

          <label class="sr-only" for="densitySelect">Sphere node density</label>
          <select class="density-select" id="densitySelect">
            <option value="140">140 hubs</option>
            <option value="240" selected>240 hubs</option>
            <option value="360">360 hubs</option>
            <option value="480">480 hubs</option>
          </select>
        </div>

        <div class="stage" id="stage">
          <canvas id="graphCanvas" tabindex="0" role="img" aria-label="Rotatable sphere showing a balanced sample of high-connectivity code nodes. Use search or select a point to inspect its relationships."></canvas>
          <div class="stage-hud" aria-hidden="true"><span class="hud-signal"></span><span id="stageStatus">Sphere · 240 hubs</span></div>
          <div class="layer-deck">
            <span class="layer-label">Architecture layers</span>
            <div class="domain-filters" id="domainFilters" aria-label="Architecture layer filters"></div>
          </div>
        </div>
      </section>

      <aside class="inspector" aria-labelledby="inspectorTitle">
        <div class="inspector-inner">
          <h2 id="inspectorTitle">Graph details</h2>
          <p class="inspector-intro">The sphere is for orientation. Select a node to reduce the system to a readable, verifiable neighborhood.</p>

          <div class="empty-state" id="emptyState">
            <div class="empty-map" aria-hidden="true"><i></i></div>
            <p class="empty-title">Start with a hub or search</p>
            <p class="empty-copy">Color identifies architecture layer. Shape estimates files, functions, classes, symbols, and unresolved graph targets.</p>
            <div class="hub-list" id="hubList" aria-label="Highest-connectivity nodes"></div>
          </div>

          <div class="selection" id="selectionPanel">
            <div class="selection-head">
              <div class="node-tags">
                <span class="node-tag"><i class="chip-swatch" id="nodeDomainSwatch"></i><span id="nodeDomain"></span></span>
                <span class="node-tag" id="nodeKind"></span>
              </div>
              <h3 class="node-title" id="nodeTitle"></h3>
              <code class="source-path" id="nodeSource"></code>
            </div>

            <div class="metric-strip" aria-label="Node relationship counts">
              <div class="metric"><span class="metric-value" id="degreeValue"></span><span class="metric-label">Total</span></div>
              <div class="metric"><span class="metric-value" id="inboundValue"></span><span class="metric-label">Inbound</span></div>
              <div class="metric"><span class="metric-value" id="outboundValue"></span><span class="metric-label">Outbound</span></div>
            </div>

            <div class="relationship-head">
              <h3>Extracted relationships</h3>
              <span class="relationship-count" id="relationshipCount"></span>
            </div>
            <div class="relationship-list" id="relationshipList"></div>
            <p class="relationship-note" id="relationshipNote"></p>
          </div>
        </div>
      </aside>
    </main>

    <footer class="statusbar">
      <span><strong>Graph connections are leads.</strong> Verify source before treating them as runtime truth. <span id="suppressionSummary"></span></span>
      <span class="keyboard-help">Drag to orbit · Wheel to zoom · Arrow keys rotate · Home resets</span>
    </footer>
  </div>

  <div class="sr-only" id="liveStatus" aria-live="polite"></div>

  <script>
    const DATA = ${embeddedPayload};

    (() => {
      "use strict";

      const rowToNode = (row, index) => ({
        index,
        id: row[0],
        label: row[1],
        source: row[2],
        location: row[3],
        domain: row[4],
        kind: row[5],
        degree: row[6],
        inbound: row[7],
        outbound: row[8],
        external: row[9] === 1,
        search: (row[1] + " " + row[0] + " " + row[2]).toLowerCase(),
        point: null,
      });

      const nodes = DATA.nodes.map(rowToNode);
      const edges = DATA.edges.map((row) => ({ source: row[0], target: row[1], relation: row[2], inferred: row[3] === 1 }));
      const adjacency = Array.from({ length: nodes.length }, () => []);

      edges.forEach((edge, edgeIndex) => {
        adjacency[edge.source].push({ edgeIndex, other: edge.target, direction: "out" });
        adjacency[edge.target].push({ edgeIndex, other: edge.source, direction: "in" });
      });

      const ranked = nodes.map((node) => node.index).sort((left, right) => {
        const degreeDifference = nodes[right].degree - nodes[left].degree;
        return degreeDifference || nodes[left].label.localeCompare(nodes[right].label);
      });
      const rankedByDomain = DATA.domains.map((_, domain) => ranked.filter((index) => nodes[index].domain === domain));
      const state = {
        mode: "sphere",
        selected: null,
        hovered: null,
        yaw: -0.58,
        pitch: -0.12,
        zoom: 1,
        autoRotate: false,
        dragging: false,
        pointerStart: null,
        density: window.matchMedia("(max-width: 600px)").matches ? 140 : 240,
        domains: DATA.domains.map((domain) => domain[0] !== "tests" && domain[0] !== "unresolved"),
        searchResults: [],
        searchActive: -1,
        screenNodes: [],
        visibleSphere: [],
        neighborhood: [],
      };

      const canvas = document.getElementById("graphCanvas");
      const context = canvas.getContext("2d", { alpha: false });
      const stage = document.getElementById("stage");
      const searchInput = document.getElementById("nodeSearch");
      const searchResultsElement = document.getElementById("searchResults");
      const sphereModeButton = document.getElementById("sphereMode");
      const neighborhoodModeButton = document.getElementById("neighborhoodMode");
      const rotationToggle = document.getElementById("rotationToggle");
      const resetButton = document.getElementById("resetButton");
      const densitySelect = document.getElementById("densitySelect");
      const stageStatus = document.getElementById("stageStatus");
      const liveStatus = document.getElementById("liveStatus");
      const emptyState = document.getElementById("emptyState");
      const selectionPanel = document.getElementById("selectionPanel");
      let logicalWidth = 0;
      let logicalHeight = 0;
      let frameRequest = null;
      let lastFrame = performance.now();

      function hashUnit(value) {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index += 1) {
          hash ^= value.charCodeAt(index);
          hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0) / 4294967295;
      }

      function makeSpherePoint(node) {
        const domainCount = DATA.domains.length;
        const sectorWidth = (Math.PI * 2) / domainCount;
        const theta = node.domain * sectorWidth + sectorWidth * 0.5 + (hashUnit(node.id + ":azimuth") - 0.5) * sectorWidth * 0.82;
        const vertical = hashUnit(node.id + ":latitude") * 1.84 - 0.92;
        const phi = Math.asin(Math.max(-0.96, Math.min(0.96, vertical)));
        return {
          x: Math.cos(phi) * Math.cos(theta),
          y: Math.sin(phi),
          z: Math.cos(phi) * Math.sin(theta),
        };
      }

      nodes.forEach((node) => { node.point = makeSpherePoint(node); });

      function rotatePoint(point) {
        const cosYaw = Math.cos(state.yaw);
        const sinYaw = Math.sin(state.yaw);
        const x1 = point.x * cosYaw - point.z * sinYaw;
        const z1 = point.x * sinYaw + point.z * cosYaw;
        const cosPitch = Math.cos(state.pitch);
        const sinPitch = Math.sin(state.pitch);
        return {
          x: x1,
          y: point.y * cosPitch - z1 * sinPitch,
          z: point.y * sinPitch + z1 * cosPitch,
        };
      }

      function projectPoint(point, radius, centerX, centerY) {
        const rotated = rotatePoint(point);
        const perspective = 2.55 / (3.25 - rotated.z);
        return {
          x: centerX + rotated.x * radius * perspective,
          y: centerY + rotated.y * radius * perspective,
          z: rotated.z,
          scale: perspective,
        };
      }

      function colorWithAlpha(hex, alpha) {
        const value = hex.replace("#", "");
        const number = Number.parseInt(value, 16);
        const red = (number >> 16) & 255;
        const green = (number >> 8) & 255;
        const blue = number & 255;
        return "rgba(" + red + ", " + green + ", " + blue + ", " + alpha + ")";
      }

      function relationColor(relation) {
        if (relation === "calls" || relation === "indirect_call") return "#83bfff";
        if (relation.startsWith("import") || relation === "re_exports") return "#63c5d4";
        if (relation === "contains" || relation === "defines" || relation === "method") return "#8998ad";
        if (relation === "references" || relation === "uses") return "#b9a5ff";
        return "#e5a3c9";
      }

      function enabledNode(index) {
        return state.domains[nodes[index].domain];
      }

      function isStructuralEdge(edge) {
        const relation = DATA.relations[edge.relation];
        return relation === "contains" || relation === "rationale_for";
      }

      function balancedSphereNodes() {
        const limit = state.density;
        const enabledDomains = state.domains.map((enabled, index) => enabled ? index : -1).filter((index) => index >= 0);
        const selected = new Set();
        const floor = Math.max(6, Math.floor(limit * 0.055));

        enabledDomains.forEach((domain) => {
          rankedByDomain[domain].slice(0, floor).forEach((index) => selected.add(index));
        });

        for (const index of ranked) {
          if (selected.size >= limit) break;
          if (enabledNode(index)) selected.add(index);
        }

        if (state.selected !== null) {
          selected.add(state.selected);
          adjacency[state.selected]
            .filter((entry) => enabledNode(entry.other) && !isStructuralEdge(edges[entry.edgeIndex]))
            .sort((left, right) => nodes[right.other].degree - nodes[left.other].degree)
            .slice(0, 36)
            .forEach((entry) => selected.add(entry.other));
        }

        return [...selected];
      }

      function neighborhoodNodes() {
        if (state.selected === null) return [];
        const grouped = new Map();
        const directEntries = adjacency[state.selected].filter((entry) => !isStructuralEdge(edges[entry.edgeIndex]));
        const displayEntries = directEntries.length > 0 ? directEntries : adjacency[state.selected];
        displayEntries.forEach((entry) => {
          if (!enabledNode(entry.other)) return;
          const edge = edges[entry.edgeIndex];
          const key = entry.other;
          if (!grouped.has(key)) {
            grouped.set(key, { index: key, inbound: false, outbound: false, relations: [], inferredOnly: true });
          }
          const neighbor = grouped.get(key);
          neighbor[entry.direction === "in" ? "inbound" : "outbound"] = true;
          neighbor.relations.push(edge.relation);
          if (!edge.inferred) neighbor.inferredOnly = false;
        });

        return [...grouped.values()]
          .sort((left, right) => {
            const confidenceDifference = Number(left.inferredOnly) - Number(right.inferredOnly);
            return confidenceDifference || nodes[right.index].degree - nodes[left.index].degree || nodes[left.index].label.localeCompare(nodes[right.index].label);
          })
          .slice(0, 24);
      }

      function resizeCanvas() {
        const bounds = stage.getBoundingClientRect();
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        logicalWidth = Math.max(1, Math.floor(bounds.width));
        logicalHeight = Math.max(1, Math.floor(bounds.height));
        canvas.width = Math.floor(logicalWidth * pixelRatio);
        canvas.height = Math.floor(logicalHeight * pixelRatio);
        canvas.style.width = logicalWidth + "px";
        canvas.style.height = logicalHeight + "px";
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        invalidate();
      }

      function drawGuide(radius, centerX, centerY) {
        context.save();
        context.strokeStyle = "rgba(63, 80, 104, 0.38)";
        context.lineWidth = 1;
        context.beginPath();
        context.arc(centerX, centerY, radius * 0.78, 0, Math.PI * 2);
        context.stroke();

        const drawCurve = (points) => {
          context.beginPath();
          points.forEach((point, index) => {
            const projected = projectPoint(point, radius, centerX, centerY);
            if (index === 0) context.moveTo(projected.x, projected.y);
            else context.lineTo(projected.x, projected.y);
          });
          context.stroke();
        };

        context.strokeStyle = "rgba(63, 80, 104, 0.22)";
        [-0.6, 0, 0.6].forEach((latitude) => {
          const phi = Math.asin(latitude);
          const points = [];
          for (let step = 0; step <= 72; step += 1) {
            const theta = (step / 72) * Math.PI * 2;
            points.push({ x: Math.cos(phi) * Math.cos(theta), y: latitude, z: Math.cos(phi) * Math.sin(theta) });
          }
          drawCurve(points);
        });

        for (let meridian = 0; meridian < 6; meridian += 1) {
          const theta = (meridian / 6) * Math.PI;
          const points = [];
          for (let step = 0; step <= 48; step += 1) {
            const phi = -Math.PI / 2 + (step / 48) * Math.PI;
            points.push({ x: Math.cos(phi) * Math.cos(theta), y: Math.sin(phi), z: Math.cos(phi) * Math.sin(theta) });
          }
          drawCurve(points);
        }
        context.restore();
      }

      function drawNodeShape(node, screen, isSelected, isHovered) {
        const color = DATA.domains[node.domain][2];
        const depthAlpha = 0.34 + ((screen.z + 1) / 2) * 0.64;
        const baseRadius = Math.max(3.3, Math.min(10.5, 3.2 + Math.log2(node.degree + 1) * 0.95));
        const radius = baseRadius * (0.74 + screen.scale * 0.33);
        context.save();
        context.translate(screen.x, screen.y);
        context.beginPath();
        if (node.kind === 0) {
          const side = radius * 1.72;
          context.rect(-side / 2, -side / 2, side, side);
        } else if (node.kind === 2) {
          context.moveTo(0, -radius);
          context.lineTo(radius, 0);
          context.lineTo(0, radius);
          context.lineTo(-radius, 0);
          context.closePath();
        } else if (node.kind === 3) {
          for (let point = 0; point < 6; point += 1) {
            const angle = -Math.PI / 2 + point * Math.PI / 3;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
          }
          context.closePath();
        } else {
          context.arc(0, 0, radius, 0, Math.PI * 2);
        }

        if (node.external) {
          context.strokeStyle = colorWithAlpha(color, Math.max(0.48, depthAlpha));
          context.lineWidth = 1.5;
          context.stroke();
        } else {
          context.fillStyle = colorWithAlpha(color, depthAlpha);
          context.fill();
        }

        if (isHovered) {
          context.strokeStyle = "#f4f7fb";
          context.lineWidth = 1.5;
          context.stroke();
        }

        if (isSelected) {
          context.beginPath();
          context.arc(0, 0, radius + 5, 0, Math.PI * 2);
          context.strokeStyle = "#83bfff";
          context.lineWidth = 2;
          context.stroke();
        }
        context.restore();
        return radius;
      }

      function roundedRect(x, y, width, height, radius) {
        const safeRadius = Math.min(radius, width / 2, height / 2);
        context.beginPath();
        context.moveTo(x + safeRadius, y);
        context.arcTo(x + width, y, x + width, y + height, safeRadius);
        context.arcTo(x + width, y + height, x, y + height, safeRadius);
        context.arcTo(x, y + height, x, y, safeRadius);
        context.arcTo(x, y, x + width, y, safeRadius);
        context.closePath();
      }

      function drawNodeLabel(node, screen, forceRight) {
        const maxLength = 34;
        const label = node.label.length > maxLength ? node.label.slice(0, maxLength - 1) + "…" : node.label;
        context.save();
        context.font = '600 12px "Segoe UI Variable", "Segoe UI", sans-serif';
        const textWidth = Math.ceil(context.measureText(label).width);
        const width = textWidth + 16;
        const height = 26;
        const right = forceRight !== undefined ? forceRight : screen.x < logicalWidth * 0.7;
        const x = right ? screen.x + 12 : screen.x - width - 12;
        const y = screen.y - height / 2;
        roundedRect(x, y, width, height, 5);
        context.fillStyle = "rgba(24, 35, 51, 0.96)";
        context.fill();
        context.strokeStyle = "rgba(63, 80, 104, 0.86)";
        context.lineWidth = 1;
        context.stroke();
        context.fillStyle = "#f4f7fb";
        context.textBaseline = "middle";
        context.fillText(label, x + 8, y + height / 2 + 0.5);
        context.restore();
      }

      function drawSphere() {
        const centerX = logicalWidth * 0.5;
        const usableHeight = Math.max(240, logicalHeight - 84);
        const centerY = usableHeight * 0.48;
        const radius = Math.min(logicalWidth * 0.48, usableHeight * 0.53) * state.zoom;
        state.visibleSphere = balancedSphereNodes();
        const screenMap = new Map();

        drawGuide(radius, centerX, centerY);

        state.visibleSphere.forEach((index) => {
          screenMap.set(index, projectPoint(nodes[index].point, radius, centerX, centerY));
        });

        if (state.selected !== null && screenMap.has(state.selected)) {
          const selectedScreen = screenMap.get(state.selected);
          const seenEdges = new Set();
          adjacency[state.selected].forEach((entry) => {
            if (seenEdges.size >= 48 || !screenMap.has(entry.other)) return;
            const edge = edges[entry.edgeIndex];
            if (isStructuralEdge(edge)) return;
            const key = entry.other + ":" + edge.relation + ":" + entry.direction;
            if (seenEdges.has(key)) return;
            seenEdges.add(key);
            const otherScreen = screenMap.get(entry.other);
            context.save();
            context.strokeStyle = colorWithAlpha(relationColor(DATA.relations[edge.relation]), edge.inferred ? 0.26 : 0.44);
            context.lineWidth = edge.inferred ? 1 : 1.25;
            if (edge.inferred) context.setLineDash([4, 5]);
            context.beginPath();
            context.moveTo(selectedScreen.x, selectedScreen.y);
            context.lineTo(otherScreen.x, otherScreen.y);
            context.stroke();
            context.restore();
          });
        }

        const ordered = state.visibleSphere
          .map((index) => ({ index, screen: screenMap.get(index) }))
          .sort((left, right) => left.screen.z - right.screen.z);
        state.screenNodes = [];

        ordered.forEach(({ index, screen }) => {
          const node = nodes[index];
          const radiusValue = drawNodeShape(node, screen, index === state.selected, index === state.hovered);
          state.screenNodes.push({ index, x: screen.x, y: screen.y, z: screen.z, radius: radiusValue });
        });

        const labelSet = new Set();
        if (state.selected !== null) labelSet.add(state.selected);
        if (state.hovered !== null) labelSet.add(state.hovered);
        ordered
          .filter(({ screen }) => screen.z > 0.15)
          .sort((left, right) => nodes[right.index].degree - nodes[left.index].degree)
          .slice(0, logicalWidth < 600 ? (state.selected === null ? 2 : 1) : (state.selected === null ? 8 : 4))
          .forEach(({ index }) => labelSet.add(index));
        labelSet.forEach((index) => {
          const screen = screenMap.get(index);
          if (screen) drawNodeLabel(nodes[index], screen);
        });

        stageStatus.textContent = "Sphere · " + state.visibleSphere.length.toLocaleString() + " hubs" + (state.selected === null ? "" : " · focused");
      }

      function drawNeighborhood() {
        if (state.selected === null) {
          state.selected = ranked.find((index) => enabledNode(index)) ?? ranked[0];
          renderInspector();
        }

        state.neighborhood = neighborhoodNodes();
        const centerX = logicalWidth * 0.5;
        const usableHeight = Math.max(260, logicalHeight - 92);
        const centerY = usableHeight * 0.49;
        const horizontalRadius = Math.min(logicalWidth * 0.38, 430) * state.zoom;
        const verticalRadius = Math.min(usableHeight * 0.39, 300) * state.zoom;
        const inbound = state.neighborhood.filter((neighbor) => neighbor.inbound && !neighbor.outbound);
        const outbound = state.neighborhood.filter((neighbor) => neighbor.outbound && !neighbor.inbound);
        const both = state.neighborhood.filter((neighbor) => neighbor.inbound && neighbor.outbound);
        const positions = new Map();

        const placeHalf = (items, startAngle, endAngle, radiusMultiplier = 1) => {
          items.forEach((neighbor, index) => {
            const fraction = items.length === 1 ? 0.5 : index / (items.length - 1);
            const ring = items.length > 24 && index % 2 === 1 ? 0.72 : 1;
            const angle = startAngle + fraction * (endAngle - startAngle);
            positions.set(neighbor.index, {
              x: centerX + Math.cos(angle) * horizontalRadius * ring * radiusMultiplier,
              y: centerY + Math.sin(angle) * verticalRadius * ring * radiusMultiplier,
              z: ring,
              scale: 1,
            });
          });
        };

        placeHalf(outbound, -1.32, 1.32);
        placeHalf(inbound, Math.PI - 1.32, Math.PI + 1.32);
        placeHalf(both, Math.PI * 1.16, Math.PI * 1.84, 0.58);

        context.save();
        context.font = '650 12px "Segoe UI Variable", "Segoe UI", sans-serif';
        context.fillStyle = "#8998ad";
        context.textBaseline = "top";
        context.fillText("INBOUND", 20, 54);
        const outboundLabel = "OUTBOUND";
        context.fillText(outboundLabel, logicalWidth - context.measureText(outboundLabel).width - 20, 54);
        context.restore();

        state.neighborhood.forEach((neighbor) => {
          const position = positions.get(neighbor.index);
          if (!position) return;
          const relation = DATA.relations[neighbor.relations[0]] || "related";
          context.save();
          context.strokeStyle = colorWithAlpha(relationColor(relation), neighbor.inferredOnly ? 0.28 : 0.54);
          context.lineWidth = neighbor.inferredOnly ? 1 : 1.35;
          if (neighbor.inferredOnly) context.setLineDash([4, 5]);
          context.beginPath();
          context.moveTo(centerX, centerY);
          context.lineTo(position.x, position.y);
          context.stroke();
          context.restore();
        });

        state.screenNodes = [];
        state.neighborhood.forEach((neighbor) => {
          const screen = positions.get(neighbor.index);
          if (!screen) return;
          const radiusValue = drawNodeShape(nodes[neighbor.index], screen, false, neighbor.index === state.hovered);
          state.screenNodes.push({ index: neighbor.index, x: screen.x, y: screen.y, z: 0, radius: radiusValue });
        });

        const selectedScreen = { x: centerX, y: centerY, z: 1, scale: 1.2 };
        const selectedRadius = drawNodeShape(nodes[state.selected], selectedScreen, true, state.hovered === state.selected);
        state.screenNodes.push({ index: state.selected, x: centerX, y: centerY, z: 2, radius: selectedRadius });
        drawNodeLabel(nodes[state.selected], selectedScreen, true);

        const labeled = state.neighborhood
          .slice()
          .sort((left, right) => nodes[right.index].degree - nodes[left.index].degree)
          .slice(0, 12);
        if (state.hovered !== null && state.hovered !== state.selected && !labeled.some((neighbor) => neighbor.index === state.hovered)) {
          const hoveredNeighbor = state.neighborhood.find((neighbor) => neighbor.index === state.hovered);
          if (hoveredNeighbor) labeled.push(hoveredNeighbor);
        }
        labeled.forEach((neighbor) => {
          const screen = positions.get(neighbor.index);
          if (screen) drawNodeLabel(nodes[neighbor.index], screen, screen.x < centerX);
        });

        const extractedRows = uniqueRelationshipRows(state.selected).length;
        stageStatus.textContent = "Neighborhood · " + state.neighborhood.length.toLocaleString() + " visible · " + extractedRows.toLocaleString() + " extracted rows";
      }

      function draw() {
        context.fillStyle = "#0e1520";
        context.fillRect(0, 0, logicalWidth, logicalHeight);
        if (state.mode === "sphere") drawSphere();
        else drawNeighborhood();
      }

      function frame(now) {
        frameRequest = null;
        const elapsed = Math.min(50, now - lastFrame);
        lastFrame = now;
        if (state.autoRotate && state.mode === "sphere" && !state.dragging && !document.hidden) {
          state.yaw += elapsed * 0.000055;
        }
        draw();
        if (state.autoRotate && state.mode === "sphere" && !document.hidden) invalidate();
      }

      function invalidate() {
        if (frameRequest === null) frameRequest = requestAnimationFrame(frame);
      }

      function hitTest(x, y) {
        let best = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        const ordered = state.screenNodes.slice().sort((left, right) => right.z - left.z);
        for (const screen of ordered) {
          const distance = Math.hypot(screen.x - x, screen.y - y);
          const threshold = Math.max(10, screen.radius + 7);
          if (distance <= threshold && distance < bestDistance) {
            best = screen.index;
            bestDistance = distance;
          }
        }
        return best;
      }

      function canvasPoint(event) {
        const bounds = canvas.getBoundingClientRect();
        return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      }

      function selectNode(index, announce = true, orient = false) {
        if (!Number.isInteger(index) || !nodes[index]) return;
        state.selected = index;
        if (orient && state.mode === "sphere") {
          const point = nodes[index].point;
          state.yaw = Math.atan2(point.x, point.z);
          state.pitch = Math.atan2(point.y, Math.hypot(point.x, point.z));
        }
        state.domains[nodes[index].domain] = true;
        syncDomainFilters();
        renderInspector();
        closeSearch();
        searchInput.value = "";
        if (announce) liveStatus.textContent = nodes[index].label + " selected. " + nodes[index].degree.toLocaleString() + " direct relationships.";
        invalidate();
      }

      function setMode(mode) {
        state.mode = mode;
        sphereModeButton.setAttribute("aria-pressed", String(mode === "sphere"));
        neighborhoodModeButton.setAttribute("aria-pressed", String(mode === "neighborhood"));
        rotationToggle.disabled = mode !== "sphere";
        if (mode === "neighborhood" && state.selected === null) selectNode(ranked.find((index) => enabledNode(index)) ?? ranked[0], false);
        liveStatus.textContent = mode === "sphere" ? "Sphere view active." : "Neighborhood view active.";
        invalidate();
      }

      function resetView() {
        state.yaw = -0.58;
        state.pitch = -0.12;
        state.zoom = 1;
        invalidate();
        liveStatus.textContent = "Graph view reset.";
      }

      function syncRotationButton() {
        rotationToggle.setAttribute("aria-pressed", String(state.autoRotate));
        rotationToggle.textContent = state.autoRotate ? "Pause" : "Rotate";
      }

      function buildDomainFilters() {
        const container = document.getElementById("domainFilters");
        DATA.domains.forEach((domain, index) => {
          const label = document.createElement("label");
          label.className = "domain-chip";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = state.domains[index];
          input.dataset.domain = String(index);
          input.addEventListener("change", () => {
            state.domains[index] = input.checked;
            if (!state.domains.some(Boolean)) {
              state.domains[index] = true;
              input.checked = true;
            }
            renderHubList();
            renderInspector();
            invalidate();
          });
          const chip = document.createElement("span");
          const swatch = document.createElement("i");
          swatch.className = "chip-swatch";
          swatch.style.backgroundColor = domain[2];
          chip.append(swatch, document.createTextNode(domain[1]));
          label.append(input, chip);
          container.append(label);
        });
      }

      function syncDomainFilters() {
        document.querySelectorAll("#domainFilters input").forEach((input) => {
          input.checked = state.domains[Number(input.dataset.domain)];
        });
      }

      function createHubButton(index) {
        const node = nodes[index];
        const button = document.createElement("button");
        button.type = "button";
        button.className = "hub-button";
        const swatch = document.createElement("i");
        swatch.className = "chip-swatch";
        swatch.style.backgroundColor = DATA.domains[node.domain][2];
        const name = document.createElement("span");
        name.className = "hub-name";
        name.textContent = node.label;
        const degree = document.createElement("span");
        degree.className = "hub-degree";
        degree.textContent = node.degree.toLocaleString();
        button.append(swatch, name, degree);
        button.addEventListener("click", () => selectNode(index, true, true));
        return button;
      }

      function renderHubList() {
        const container = document.getElementById("hubList");
        container.replaceChildren();
        ranked.filter((index) => enabledNode(index)).slice(0, 7).forEach((index) => container.append(createHubButton(index)));
      }

      function uniqueRelationshipRows(selectedIndex) {
        const grouped = new Map();
        adjacency[selectedIndex].forEach((entry) => {
          const edge = edges[entry.edgeIndex];
          const key = entry.direction + ":" + entry.other + ":" + edge.relation;
          if (!grouped.has(key)) {
            grouped.set(key, {
              other: entry.other,
              direction: entry.direction,
              relation: edge.relation,
              inferred: edge.inferred,
              count: 1,
            });
          } else {
            const item = grouped.get(key);
            item.count += 1;
            if (!edge.inferred) item.inferred = false;
          }
        });
        return [...grouped.values()].sort((left, right) => {
          if (left.direction !== right.direction) return left.direction === "in" ? -1 : 1;
          const degreeDifference = nodes[right.other].degree - nodes[left.other].degree;
          return degreeDifference || nodes[left.other].label.localeCompare(nodes[right.other].label);
        });
      }

      function renderInspector() {
        if (state.selected === null) {
          emptyState.classList.remove("is-hidden");
          selectionPanel.classList.remove("is-visible");
          return;
        }

        const node = nodes[state.selected];
        emptyState.classList.add("is-hidden");
        selectionPanel.classList.add("is-visible");
        document.getElementById("nodeDomain").textContent = DATA.domains[node.domain][1];
        document.getElementById("nodeDomainSwatch").style.backgroundColor = DATA.domains[node.domain][2];
        document.getElementById("nodeKind").textContent = DATA.kinds[node.kind];
        document.getElementById("nodeTitle").textContent = node.label;
        document.getElementById("nodeSource").textContent = node.source ? node.source + (node.location ? ":" + node.location : "") : "Unresolved graph target";
        document.getElementById("degreeValue").textContent = node.degree.toLocaleString();
        document.getElementById("inboundValue").textContent = node.inbound.toLocaleString();
        document.getElementById("outboundValue").textContent = node.outbound.toLocaleString();

        const rows = uniqueRelationshipRows(state.selected);
        const list = document.getElementById("relationshipList");
        list.replaceChildren();
        rows.slice(0, 80).forEach((row) => {
          const other = nodes[row.other];
          const button = document.createElement("button");
          button.type = "button";
          button.className = "relationship-button";
          const direction = document.createElement("span");
          direction.className = "relationship-direction";
          direction.textContent = row.direction === "in" ? "←" : "→";
          direction.setAttribute("aria-hidden", "true");
          const copy = document.createElement("span");
          const name = document.createElement("span");
          name.className = "relationship-name";
          name.textContent = other.label;
          const meta = document.createElement("span");
          meta.className = "relationship-meta";
          const relation = DATA.relations[row.relation];
          meta.textContent = (row.direction === "in" ? "Inbound" : "Outbound") + " · " + relation + (row.inferred ? " · inferred" : "") + (row.count > 1 ? " · " + row.count + " edges" : "");
          copy.append(name, meta);
          button.append(direction, copy);
          button.addEventListener("click", () => selectNode(row.other, true, true));
          list.append(button);
        });
        document.getElementById("relationshipCount").textContent = rows.length.toLocaleString() + " unique";
        const canvasScopeNote = "The canvas shows up to 24 non-containment nodes in enabled layers; this ledger retains every extracted row.";
        document.getElementById("relationshipNote").textContent = rows.length > 80
          ? "Showing the 80 highest-signal relationship rows of " + rows.length.toLocaleString() + ". Use search for a specific neighbor. " + canvasScopeNote
          : rows.length === 0
            ? "No direct relationships were extracted for this node."
            : "Select a relationship to move the focus without losing graph context. " + canvasScopeNote;
      }

      function searchScore(node, query) {
        const label = node.label.toLowerCase();
        const id = node.id.toLowerCase();
        const source = node.source.toLowerCase();
        if (label === query || id === query) return 1200 + node.degree;
        if (label.startsWith(query)) return 1000 - label.length + Math.log2(node.degree + 1) * 5;
        if (id.startsWith(query)) return 900 - id.length * 0.01;
        const labelIndex = label.indexOf(query);
        if (labelIndex >= 0) return 760 - labelIndex + Math.log2(node.degree + 1) * 4;
        const sourceIndex = source.indexOf(query);
        if (sourceIndex >= 0) return 560 - sourceIndex * 0.2 + Math.log2(node.degree + 1) * 3;
        const tokens = query.split(/\\s+/).filter(Boolean);
        if (tokens.length > 1 && tokens.every((token) => node.search.includes(token))) return 400 + Math.log2(node.degree + 1) * 3;
        return -1;
      }

      function runSearch() {
        const query = searchInput.value.trim().toLowerCase();
        state.searchActive = -1;
        if (!query) {
          closeSearch();
          return;
        }
        state.searchResults = nodes
          .map((node) => ({ index: node.index, score: searchScore(node, query) }))
          .filter((result) => result.score >= 0)
          .sort((left, right) => right.score - left.score)
          .slice(0, 10)
          .map((result) => result.index);
        renderSearchResults();
      }

      function renderSearchResults() {
        searchResultsElement.replaceChildren();
        searchInput.removeAttribute("aria-activedescendant");
        if (state.searchResults.length === 0) {
          const empty = document.createElement("p");
          empty.className = "empty-copy";
          empty.style.margin = "8px 10px";
          empty.textContent = "No matching graph node.";
          searchResultsElement.append(empty);
        } else {
          state.searchResults.forEach((index, resultIndex) => {
            const node = nodes[index];
            const button = document.createElement("button");
            button.type = "button";
            button.id = "node-option-" + index;
            button.className = "search-result" + (resultIndex === state.searchActive ? " is-active" : "");
            button.role = "option";
            button.setAttribute("aria-selected", String(resultIndex === state.searchActive));
            if (resultIndex === state.searchActive) searchInput.setAttribute("aria-activedescendant", button.id);
            const swatch = document.createElement("i");
            swatch.className = "result-swatch";
            swatch.style.backgroundColor = DATA.domains[node.domain][2];
            const copy = document.createElement("span");
            copy.className = "result-copy";
            const label = document.createElement("span");
            label.className = "result-label";
            label.textContent = node.label;
            const source = document.createElement("span");
            source.className = "result-path";
            source.textContent = node.source || "Unresolved graph target";
            copy.append(label, source);
            const degree = document.createElement("span");
            degree.className = "result-degree";
            degree.textContent = node.degree.toLocaleString();
            button.append(swatch, copy, degree);
            button.addEventListener("click", () => selectNode(index, true, true));
            searchResultsElement.append(button);
          });
        }
        searchResultsElement.classList.add("is-open");
        searchInput.setAttribute("aria-expanded", "true");
      }

      function closeSearch() {
        state.searchResults = [];
        state.searchActive = -1;
        searchInput.removeAttribute("aria-activedescendant");
        searchResultsElement.classList.remove("is-open");
        searchInput.setAttribute("aria-expanded", "false");
      }

      function moveSearchSelection(delta) {
        if (state.searchResults.length === 0) return;
        state.searchActive = (state.searchActive + delta + state.searchResults.length) % state.searchResults.length;
        renderSearchResults();
        const active = searchResultsElement.querySelector(".is-active");
        active?.scrollIntoView({ block: "nearest" });
      }

      canvas.addEventListener("pointerdown", (event) => {
        const point = canvasPoint(event);
        state.dragging = true;
        state.pointerStart = { x: point.x, y: point.y, lastX: point.x, lastY: point.y, moved: 0 };
        canvas.classList.add("is-dragging");
        canvas.setPointerCapture(event.pointerId);
      });

      canvas.addEventListener("pointermove", (event) => {
        const point = canvasPoint(event);
        if (state.dragging && state.pointerStart) {
          const deltaX = point.x - state.pointerStart.lastX;
          const deltaY = point.y - state.pointerStart.lastY;
          state.pointerStart.moved += Math.abs(deltaX) + Math.abs(deltaY);
          state.pointerStart.lastX = point.x;
          state.pointerStart.lastY = point.y;
          if (state.mode === "sphere") {
            state.yaw += deltaX * 0.006;
            state.pitch = Math.max(-1.28, Math.min(1.28, state.pitch + deltaY * 0.006));
          }
          invalidate();
          return;
        }
        const nextHovered = hitTest(point.x, point.y);
        if (nextHovered !== state.hovered) {
          state.hovered = nextHovered;
          canvas.style.cursor = nextHovered === null ? "grab" : "pointer";
          invalidate();
        }
      });

      canvas.addEventListener("pointerup", (event) => {
        const point = canvasPoint(event);
        if (state.pointerStart && state.pointerStart.moved < 7) {
          const hit = hitTest(point.x, point.y);
          if (hit !== null) selectNode(hit);
        }
        state.dragging = false;
        state.pointerStart = null;
        canvas.classList.remove("is-dragging");
        canvas.releasePointerCapture(event.pointerId);
        invalidate();
      });

      canvas.addEventListener("pointercancel", () => {
        state.dragging = false;
        state.pointerStart = null;
        canvas.classList.remove("is-dragging");
      });

      canvas.addEventListener("pointerleave", () => {
        if (!state.dragging && state.hovered !== null) {
          state.hovered = null;
          invalidate();
        }
      });

      canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        state.zoom = Math.max(0.62, Math.min(1.58, state.zoom * (event.deltaY > 0 ? 0.93 : 1.07)));
        invalidate();
      }, { passive: false });

      canvas.addEventListener("keydown", (event) => {
        let handled = true;
        if (event.key === "ArrowLeft") state.yaw -= 0.12;
        else if (event.key === "ArrowRight") state.yaw += 0.12;
        else if (event.key === "ArrowUp") state.pitch = Math.max(-1.28, state.pitch - 0.1);
        else if (event.key === "ArrowDown") state.pitch = Math.min(1.28, state.pitch + 0.1);
        else if (event.key === "+" || event.key === "=") state.zoom = Math.min(1.58, state.zoom * 1.08);
        else if (event.key === "-" || event.key === "_") state.zoom = Math.max(0.62, state.zoom * 0.92);
        else if (event.key === "Home") resetView();
        else handled = false;
        if (handled) {
          event.preventDefault();
          invalidate();
        }
      });

      searchInput.addEventListener("input", runSearch);
      searchInput.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveSearchSelection(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          moveSearchSelection(-1);
        } else if (event.key === "Enter" && state.searchResults.length > 0) {
          event.preventDefault();
          selectNode(state.searchResults[state.searchActive >= 0 ? state.searchActive : 0], true, true);
        } else if (event.key === "Escape") {
          closeSearch();
        }
      });

      document.addEventListener("pointerdown", (event) => {
        if (!event.target.closest(".search-wrap")) closeSearch();
      });

      sphereModeButton.addEventListener("click", () => setMode("sphere"));
      neighborhoodModeButton.addEventListener("click", () => setMode("neighborhood"));
      rotationToggle.addEventListener("click", () => {
        state.autoRotate = !state.autoRotate;
        syncRotationButton();
        invalidate();
      });
      resetButton.addEventListener("click", resetView);
      densitySelect.addEventListener("change", () => {
        state.density = Number(densitySelect.value);
        invalidate();
      });

      document.addEventListener("visibilitychange", invalidate);
      document.addEventListener("keydown", (event) => {
        const target = event.target;
        const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
        if (event.key === "/" && !isTyping) {
          event.preventDefault();
          searchInput.focus();
        }
      });
      new ResizeObserver(resizeCanvas).observe(stage);

      document.getElementById("summaryText").textContent = DATA.meta.indexedNodes.toLocaleString() + " indexed nodes · " + DATA.meta.unresolvedTargets.toLocaleString() + " unresolved targets · " + DATA.meta.relationships.toLocaleString() + " mapped relationships";
      document.getElementById("suppressionSummary").textContent = DATA.meta.suppressedCrossLanguage > 0
        ? DATA.meta.suppressedCrossLanguage.toLocaleString() + " suspicious cross-language matches are omitted."
        : "";
      buildDomainFilters();
      renderHubList();
      renderInspector();
      syncRotationButton();
      resizeCanvas();
    })();
  </script>
</body>
</html>`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, html, "utf8");
process.stdout.write(`Architecture constellation written to ${outputPath}\n`);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
