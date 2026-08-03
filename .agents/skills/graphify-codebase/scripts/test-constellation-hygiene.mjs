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

function runBuilderFailure(argumentsList) {
  const result = spawnSync(process.execPath, [builder, ...argumentsList], { encoding: "utf8" });
  assert.notEqual(result.status, 0, "builder unexpectedly succeeded");
  return result.stderr || result.stdout;
}

function embeddedPayload(snapshot) {
  const marker = "const DATA = ";
  const start = snapshot.indexOf(marker);
  assert.notEqual(start, -1, "embedded payload marker must exist");
  const payloadStart = start + marker.length;
  const payloadEnd = snapshot.indexOf(";\n", payloadStart);
  assert.notEqual(payloadEnd, -1, "embedded payload terminator must exist");
  return JSON.parse(snapshot.slice(payloadStart, payloadEnd));
}

try {
  const currentGraph = {
    nodes: [
      { id: "a_func", label: "a_func()", file_type: "code", source_file: "backend/app/services/a.py", source_location: "L1" },
      { id: "b_func", label: "b_func()", file_type: "code", source_file: "backend/app/services/b.py", source_location: "L1" },
      { id: "c_func", label: "c_func()", file_type: "code", source_file: "backend/app/services/c.py", source_location: "L1" },
      { id: "rationale_private", label: "DO_NOT_PUBLISH_DOCSTRING", file_type: "rationale", source_file: "backend/app/services/a.py", source_location: "L2" },
    ],
    edges: [{ source: "a_func", target: "external_package", relation: "imports", confidence: "DIRECT" }],
  };
  const previousGraph = {
    nodes: currentGraph.nodes,
    edges: [
      { source: "b_func", target: "a_func", relation: "calls", confidence: "DIRECT" },
      { source: "a_func", target: "external_package", relation: "imports", confidence: "DIRECT" },
    ],
  };
  const currentPath = writeJson("current.json", currentGraph);
  const previousPath = writeJson("previous.json", previousGraph);
  const currentReceipt = writeJson("current-receipt.json", { git_head: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
  const previousReceipt = writeJson("previous-receipt.json", { git_head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  const currentManifest = writeJson("manifest.json", {
    "backend/app/services/c.py": { mtime: 999, ast_hash: "AST_C", semantic_hash: "SEMANTIC_C_NEW" },
    "backend/app/services/b.py": { mtime: 998, ast_hash: "AST_B", semantic_hash: "SEMANTIC_B" },
    "backend/app/services/a.py": { mtime: 997, ast_hash: "AST_A_NEW", semantic_hash: "SEMANTIC_A_NEW" },
  });
  const previousManifest = writeJson("manifest.previous.json", {
    "backend/app/services/removed.py": { mtime: 1, ast_hash: "AST_REMOVED", semantic_hash: "SEMANTIC_REMOVED_PRIVATE" },
    "backend/app/services/a.py": { mtime: 2, ast_hash: "AST_A_OLD", semantic_hash: "SEMANTIC_A_OLD" },
    "backend/app/services/b.py": { mtime: 3, ast_hash: "AST_B_OLD", semantic_hash: "SEMANTIC_B" },
  });

  const report = runBuilder([
    "--graph", currentPath,
    "--previous-graph", previousPath,
    "--receipt", currentReceipt,
    "--previous-receipt", previousReceipt,
    "--manifest", currentManifest,
    "--previous-manifest", previousManifest,
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

  const recentReport = runBuilder([
    "--graph", currentPath,
    "--manifest", currentManifest,
    "--previous-manifest", previousManifest,
    "--recent-report",
    "--recent-top", "10",
  ]);
  assert.match(recentReport, /Added 1 \| Modified 1 \| Removed 1/);
  assert.match(recentReport, /Added\s+backend\/app\/services\/c\.py/);
  assert.match(recentReport, /Modified\s+backend\/app\/services\/a\.py/);
  assert.match(recentReport, /Removed\s+backend\/app\/services\/removed\.py/);
  assert.doesNotMatch(recentReport, /SEMANTIC_|AST_/);

  const publicOutput = path.join(testRoot, "architecture-constellation.html");
  const publicArguments = [
    "--graph", currentPath,
    "--output", publicOutput,
    "--receipt", currentReceipt,
    "--previous-receipt", previousReceipt,
    "--manifest", currentManifest,
    "--previous-manifest", previousManifest,
    "--repo", testRoot,
    "--label", "Test Dashboard",
    "--public",
  ];
  runBuilder(publicArguments);
  const firstPublicSnapshot = fs.readFileSync(publicOutput, "utf8");
  runBuilder(publicArguments);
  const secondPublicSnapshot = fs.readFileSync(publicOutput, "utf8");

  assert.equal(secondPublicSnapshot, firstPublicSnapshot, "public snapshots must be byte-for-byte deterministic");
  assert.match(firstPublicSnapshot, /"publicMode":true/);
  assert.match(firstPublicSnapshot, /<body class="public-constellation">/);
  assert.match(firstPublicSnapshot, /html\.embed-preview/);
  assert.match(firstPublicSnapshot, /"indexedNodes":3/);
  assert.doesNotMatch(firstPublicSnapshot, new RegExp(testRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.doesNotMatch(firstPublicSnapshot, /bbbbbbbbbbbb|aaaaaaaaaaaa/);
  assert.doesNotMatch(firstPublicSnapshot, /DO_NOT_PUBLISH_DOCSTRING|rationale_private/);
  assert.doesNotMatch(firstPublicSnapshot, /THESIS:|OWN-WORLD:|FIRST VIEWPORT:/);
  assert.doesNotMatch(firstPublicSnapshot, /SEMANTIC_|AST_|removed\.py/);

  const firstPayload = embeddedPayload(firstPublicSnapshot);
  assert.deepEqual(firstPayload.meta.recent, {
    model: "semantic-source-delta-v1",
    hasBaseline: true,
    fileCounts: [1, 1, 1],
    nodeCounts: [1, 1],
  });
  assert.equal(firstPayload.nodes.find((node) => node[0] === "a_func")[16], 2, "modified source nodes must be marked");
  assert.equal(firstPayload.nodes.find((node) => node[0] === "b_func")[16], 0, "unchanged source nodes must remain unmarked");
  assert.equal(firstPayload.nodes.find((node) => node[0] === "c_func")[16], 1, "added source nodes must be marked");
  assert.equal(firstPayload.nodes.find((node) => node[0] === "external_package")[16], 0, "synthesized external nodes must never be marked recent");

  const noBaselineOutput = path.join(testRoot, "architecture-constellation-no-baseline.html");
  runBuilder([
    "--graph", currentPath,
    "--output", noBaselineOutput,
    "--manifest", currentManifest,
    "--repo", testRoot,
    "--label", "Test Dashboard",
    "--public",
  ]);
  const noBaselinePayload = embeddedPayload(fs.readFileSync(noBaselineOutput, "utf8"));
  assert.equal(noBaselinePayload.meta.recent.hasBaseline, false);
  assert.deepEqual(noBaselinePayload.meta.recent.fileCounts, [0, 0, 0]);
  assert.ok(noBaselinePayload.nodes.every((node) => node[16] === 0));

  const emptyManifest = writeJson("manifest-empty.json", {});
  const allAddedOutput = path.join(testRoot, "architecture-constellation-all-added.html");
  runBuilder([
    "--graph", currentPath,
    "--output", allAddedOutput,
    "--manifest", currentManifest,
    "--previous-manifest", emptyManifest,
    "--repo", testRoot,
    "--label", "Test Dashboard",
    "--public",
  ]);
  const allAddedPayload = embeddedPayload(fs.readFileSync(allAddedOutput, "utf8"));
  assert.equal(allAddedPayload.meta.recent.hasBaseline, true, "an empty prior manifest is still a valid baseline");
  assert.deepEqual(allAddedPayload.meta.recent.fileCounts, [3, 0, 0]);
  assert.deepEqual(allAddedPayload.meta.recent.nodeCounts, [3, 0]);

  const allRemovedOutput = path.join(testRoot, "architecture-constellation-all-removed.html");
  runBuilder([
    "--graph", currentPath,
    "--output", allRemovedOutput,
    "--manifest", emptyManifest,
    "--previous-manifest", previousManifest,
    "--repo", testRoot,
    "--label", "Test Dashboard",
    "--public",
  ]);
  const allRemovedPayload = embeddedPayload(fs.readFileSync(allRemovedOutput, "utf8"));
  assert.equal(allRemovedPayload.meta.recent.hasBaseline, true, "an empty current manifest is still a valid baseline");
  assert.deepEqual(allRemovedPayload.meta.recent.fileCounts, [0, 0, 3]);
  assert.deepEqual(allRemovedPayload.meta.recent.nodeCounts, [0, 0]);
  assert.ok(allRemovedPayload.nodes.every((node) => node[16] === 0));

  const alternateRepoRoot = path.join(testRoot, "alternate-root");
  fs.mkdirSync(alternateRepoRoot);
  const alternatePublicOutput = path.join(testRoot, "architecture-constellation-alternate.html");
  runBuilder([
    "--graph", currentPath,
    "--output", alternatePublicOutput,
    "--manifest", currentManifest,
    "--previous-manifest", previousManifest,
    "--repo", alternateRepoRoot,
    "--label", "Test Dashboard",
    "--public",
  ]);
  assert.equal(
    fs.readFileSync(alternatePublicOutput, "utf8"),
    firstPublicSnapshot,
    "public snapshots must not depend on the local repository root",
  );

  const reorderedManifest = writeJson("manifest-reordered.json", {
    "backend/app/services/a.py": { mtime: -10, ast_hash: "IGNORED_A", semantic_hash: "SEMANTIC_A_NEW" },
    "backend/app/services/b.py": { mtime: -20, ast_hash: "IGNORED_B", semantic_hash: "SEMANTIC_B" },
    "backend/app/services/c.py": { mtime: -30, ast_hash: "IGNORED_C", semantic_hash: "SEMANTIC_C_NEW" },
  });
  const reorderedPreviousManifest = writeJson("manifest-previous-reordered.json", {
    "backend/app/services/b.py": { mtime: -40, ast_hash: "IGNORED_B_OLD", semantic_hash: "SEMANTIC_B" },
    "backend/app/services/a.py": { mtime: -50, ast_hash: "IGNORED_A_OLD", semantic_hash: "SEMANTIC_A_OLD" },
    "backend/app/services/removed.py": { mtime: -60, ast_hash: "IGNORED_REMOVED", semantic_hash: "SEMANTIC_REMOVED_PRIVATE" },
  });
  const reorderedOutput = path.join(testRoot, "architecture-constellation-reordered.html");
  runBuilder([
    "--graph", currentPath,
    "--output", reorderedOutput,
    "--manifest", reorderedManifest,
    "--previous-manifest", reorderedPreviousManifest,
    "--repo", testRoot,
    "--label", "Test Dashboard",
    "--public",
  ]);
  assert.equal(
    fs.readFileSync(reorderedOutput, "utf8"),
    firstPublicSnapshot,
    "manifest order, mtimes, and AST hashes must not affect the public snapshot",
  );

  const unsafeGraphPath = writeJson("unsafe.json", {
    nodes: [{ id: "unsafe", label: "unsafe.py", file_type: "code", source_file: "C:\\Users\\example\\unsafe.py", source_location: "L1" }],
    edges: [],
  });
  const unsafeError = runBuilderFailure([
    "--graph", unsafeGraphPath,
    "--output", path.join(testRoot, "unsafe-output.html"),
    "--repo", testRoot,
    "--public",
  ]);
  assert.match(unsafeError, /unsafe source path/i);

  const unsafeManifest = writeJson("unsafe-manifest.json", {
    "../private.py": { semantic_hash: "DO_NOT_READ" },
  });
  const unsafeManifestError = runBuilderFailure([
    "--graph", currentPath,
    "--output", path.join(testRoot, "unsafe-manifest-output.html"),
    "--manifest", currentManifest,
    "--previous-manifest", unsafeManifest,
    "--repo", testRoot,
    "--public",
  ]);
  assert.match(unsafeManifestError, /unsafe source path/i);

  const emptyKeyManifest = writeJson("empty-key-manifest.json", {
    "": { semantic_hash: "EMPTY_PATH" },
  });
  const emptyKeyManifestError = runBuilderFailure([
    "--graph", currentPath,
    "--output", path.join(testRoot, "empty-key-manifest-output.html"),
    "--manifest", emptyKeyManifest,
    "--previous-manifest", previousManifest,
    "--repo", testRoot,
    "--public",
  ]);
  assert.match(emptyKeyManifestError, /empty source path/i);

  const duplicateNormalizedManifest = writeJson("duplicate-normalized-manifest.json", {
    "backend\\app\\services\\a.py": { semantic_hash: "FIRST" },
    "backend/app/services/a.py": { semantic_hash: "SECOND" },
  });
  const duplicateNormalizedManifestError = runBuilderFailure([
    "--graph", currentPath,
    "--output", path.join(testRoot, "duplicate-normalized-manifest-output.html"),
    "--manifest", duplicateNormalizedManifest,
    "--previous-manifest", previousManifest,
    "--repo", testRoot,
    "--public",
  ]);
  assert.match(duplicateNormalizedManifestError, /duplicate normalized source path/i);

  const rawRepositoryOutputError = runBuilderFailure([
    "--graph", currentPath,
    "--output", path.join(testRoot, "raw-local-viewer.html"),
    "--repo", testRoot,
  ]);
  assert.match(rawRepositoryOutputError, /Refusing to write a raw local constellation inside the repository/i);

  process.stdout.write("Constellation hygiene history and public snapshot checks passed.\n");
} finally {
  const resolvedTestRoot = path.resolve(testRoot);
  const resolvedTempRoot = path.resolve(os.tmpdir());
  if (!resolvedTestRoot.startsWith(resolvedTempRoot + path.sep) || !path.basename(resolvedTestRoot).startsWith("graphify-hygiene-test-")) {
    throw new Error(`Refusing to remove unexpected test directory: ${resolvedTestRoot}`);
  }
  fs.rmSync(resolvedTestRoot, { recursive: true, force: true });
}
