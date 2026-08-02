#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-hygiene-test-"));
const builder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "build-constellation-viewer.mjs");

function writeJson(name, value) {
  const target = path.join(testRoot, name);
  fs.writeFileSync(target, JSON.stringify(value), "utf8");
  return target;
}

function runBuilder(argumentsList) {
  const result = spawnSync(process.execPath, [builder, ...argumentsList], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

try {
  const currentGraph = {
    nodes: [
      { id: "a_func", label: "a_func()", file_type: "code", source_file: "backend/app/services/a.py", source_location: "L1" },
      { id: "b_func", label: "b_func()", file_type: "code", source_file: "backend/app/services/b.py", source_location: "L1" },
    ],
    edges: [],
  };
  const previousGraph = {
    nodes: currentGraph.nodes,
    edges: [{ source: "b_func", target: "a_func", relation: "calls", confidence: "DIRECT" }],
  };
  const currentPath = writeJson("current.json", currentGraph);
  const previousPath = writeJson("previous.json", previousGraph);
  const currentReceipt = writeJson("current-receipt.json", { git_head: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
  const previousReceipt = writeJson("previous-receipt.json", { git_head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });

  const report = runBuilder([
    "--graph", currentPath,
    "--previous-graph", previousPath,
    "--receipt", currentReceipt,
    "--previous-receipt", previousReceipt,
    "--repo", testRoot,
    "--hygiene-report",
    "--hygiene-category", "widow",
  ]);
  assert.match(report, /Recently stranded 1/);
  assert.match(report, /a_func\(\)/);
  assert.match(report, /Lost 1 extracted production relationship/);
  assert.match(report, /aaaaaaaaaaaa/);

  const unchangedReport = runBuilder([
    "--graph", currentPath,
    "--previous-graph", currentPath,
    "--repo", testRoot,
    "--hygiene-report",
    "--hygiene-category", "widow",
  ]);
  assert.match(unchangedReport, /Widow baseline: current snapshot only/);
  assert.match(unchangedReport, /Recently stranded 0/);

  process.stdout.write("Constellation hygiene history checks passed.\n");
} finally {
  const resolvedTestRoot = path.resolve(testRoot);
  const resolvedTempRoot = path.resolve(os.tmpdir());
  if (!resolvedTestRoot.startsWith(resolvedTempRoot + path.sep) || !path.basename(resolvedTestRoot).startsWith("graphify-hygiene-test-")) {
    throw new Error(`Refusing to remove unexpected test directory: ${resolvedTestRoot}`);
  }
  fs.rmSync(resolvedTestRoot, { recursive: true, force: true });
}
