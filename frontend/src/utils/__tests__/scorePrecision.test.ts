import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = join(process.cwd(), "src");
const DIRECT_TEXT_EXPRESSION = />\s*\{([^{}\n]+)\}\s*</g;
const SCORE_FIELD = /(?:\.\w*score\b|_\w*score\b|\bscore\b)/i;
const FORMATTED_OR_CATEGORICAL =
  /(?:toFixed|format(?:Number|Value)|Math\.round|scoreBar|breadthLabel|biasLabel|compactOpportunityGrade|properCase|\.label\b|score unavailable)/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return extname(entry.name) === ".tsx" ? [path] : [];
  });
}

describe("visible score precision contract", () => {
  it("does not render numeric score fields directly into text", () => {
    const rawExpressions: string[] = [];

    sourceFiles(SOURCE_ROOT).forEach((path) => {
      const source = readFileSync(path, "utf8").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      for (const match of source.matchAll(DIRECT_TEXT_EXPRESSION)) {
        const expression = match[1].trim();
        if (SCORE_FIELD.test(expression) && !FORMATTED_OR_CATEGORICAL.test(expression)) {
          const line = source.slice(0, match.index).split("\n").length;
          rawExpressions.push(`${relative(SOURCE_ROOT, path)}:${line}: ${expression}`);
        }
      }
    });

    expect(rawExpressions).toEqual([]);
  });
});
