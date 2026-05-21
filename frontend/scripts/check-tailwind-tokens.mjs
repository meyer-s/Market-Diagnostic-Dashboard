import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindConfig from "../tailwind.config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_ROOT = path.resolve(__dirname, "..");
const SOURCE_ROOT = path.join(FRONTEND_ROOT, "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

export function getDefinedStealthTokens() {
  return new Set(Object.keys(tailwindConfig.theme.extend.colors.stealth));
}

function walkFiles(dirPath, collector = []) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, collector);
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      collector.push(fullPath);
    }
  }
  return collector;
}

export function collectStealthTokensUsed() {
  const tokens = new Set();
  const pattern = /\bstealth-(\d{2,3})\b/g;
  for (const filePath of walkFiles(SOURCE_ROOT)) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const match of content.matchAll(pattern)) {
      tokens.add(match[1]);
    }
  }
  return tokens;
}

export function findMissingStealthTokens() {
  const defined = getDefinedStealthTokens();
  const used = collectStealthTokensUsed();
  return [...used].filter((token) => !defined.has(token)).sort();
}

if (process.argv[1] === __filename) {
  const missing = findMissingStealthTokens();
  if (missing.length > 0) {
    console.error(`Missing Tailwind stealth tokens: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("Tailwind stealth tokens are complete.");
}
