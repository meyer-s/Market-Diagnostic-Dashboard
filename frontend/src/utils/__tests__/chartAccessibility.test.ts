import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = join(process.cwd(), "src");
const EXPECTED_RENDERED_ROOT_COUNT = 83;
const RECHART_ROOT_NAMES = new Set([
  "AreaChart",
  "BarChart",
  "ComposedChart",
  "LineChart",
  "PieChart",
  "RadarChart",
  "RadialBarChart",
  "ScatterChart",
  "Treemap",
]);
const DECORATIVE_CHART = {
  path: "pages/tools/VolumeBreadthTools.tsx",
  kind: "ComposedChart",
};

type ChartRoot = {
  path: string;
  line: number;
  kind: string;
  accessibleName: string | null;
  accessibilityLayer: string | null;
  hiddenFromAssistiveTechnology: boolean;
  flattenedByImageRole: boolean;
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".tsx", ".ts"].includes(extname(entry.name)) ? [path] : [];
  });
}

function jsxAttribute(
  node: ts.JsxOpeningLikeElement,
  name: string,
): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (attribute): attribute is ts.JsxAttribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText() === name,
  );
}

function attributeSource(
  attribute: ts.JsxAttribute | undefined,
  sourceFile: ts.SourceFile,
): string | null {
  if (!attribute) return null;
  return attribute.initializer?.getText(sourceFile) ?? "true";
}

function hasHiddenAncestor(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      const hidden = attributeSource(
        jsxAttribute(current.openingElement, "aria-hidden"),
        sourceFile,
      );
      if (hidden === '"true"' || hidden === "{true}") return true;
    }
    current = current.parent;
  }
  return false;
}

function hasImageRoleAncestor(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      const role = attributeSource(
        jsxAttribute(current.openingElement, "role"),
        sourceFile,
      );
      if (role === '"img"') return true;
    }
    current = current.parent;
  }
  return false;
}

function chartRoots(): ChartRoot[] {
  return sourceFiles(SOURCE_ROOT).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const roots: ChartRoot[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const kind = node.tagName.getText(sourceFile);
        if (RECHART_ROOT_NAMES.has(kind)) {
          roots.push({
            path: relative(SOURCE_ROOT, path).replace(/\\/g, "/"),
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            kind,
            accessibleName:
              attributeSource(jsxAttribute(node, "aria-label"), sourceFile) ??
              attributeSource(jsxAttribute(node, "aria-labelledby"), sourceFile),
            accessibilityLayer: attributeSource(
              jsxAttribute(node, "accessibilityLayer"),
              sourceFile,
            ),
            hiddenFromAssistiveTechnology: hasHiddenAncestor(node, sourceFile),
            flattenedByImageRole: hasImageRoleAncestor(node, sourceFile),
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return roots;
  });
}

describe("chart accessibility contract", () => {
  const roots = chartRoots();

  it("keeps the rendered inventory explicit and preserves one decorative exception", () => {
    expect(roots).toHaveLength(EXPECTED_RENDERED_ROOT_COUNT);

    const decorativeRoots = roots.filter(
      (root) =>
        root.hiddenFromAssistiveTechnology ||
        root.accessibilityLayer === "{false}",
    );

    expect(decorativeRoots).toEqual([
      expect.objectContaining({
        ...DECORATIVE_CHART,
        accessibleName: null,
        accessibilityLayer: "{false}",
        hiddenFromAssistiveTechnology: true,
      }),
    ]);
  });

  it("gives every non-decorative chart a unique accessible name and keyboard value layer", () => {
    const issues: string[] = [];
    const accessibleNames = new Map<string, string>();

    roots.forEach((root) => {
      const location = `${root.path}:${root.line} ${root.kind}`;
      const isDecorative =
        root.path === DECORATIVE_CHART.path &&
        root.kind === DECORATIVE_CHART.kind &&
        root.hiddenFromAssistiveTechnology &&
        root.accessibilityLayer === "{false}";
      if (isDecorative) return;

      if (
        root.accessibilityLayer !== "true" &&
        root.accessibilityLayer !== "{true}"
      ) {
        issues.push(`${location}: accessibilityLayer must be enabled`);
      }
      if (root.flattenedByImageRole) {
        issues.push(`${location}: interactive chart is nested inside role="img"`);
      }

      const name = root.accessibleName?.trim();
      if (!name) {
        issues.push(`${location}: missing aria-label or aria-labelledby`);
        return;
      }
      if (name.length < 12 || /^["'{`]*(chart|graph|visualization)(\s+\d+)?["'}`]*$/i.test(name)) {
        issues.push(`${location}: accessible name is too generic (${name})`);
      }

      const duplicate = accessibleNames.get(name);
      if (duplicate) {
        issues.push(`${location}: accessible name duplicates ${duplicate}`);
      } else {
        accessibleNames.set(name, location);
      }
    });

    expect(issues).toEqual([]);
  });
});
