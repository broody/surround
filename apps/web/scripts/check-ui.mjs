import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { relative, resolve } from "node:path";
import ts from "typescript";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const issues = [];
const controlClasses = new Set();
const controls = new Set(["Button", "LinkButton", "IconButton", "Input", "Select", "Tab", "Switch", "Panel", "Dialog"]);
// These files draw scenery/board artwork, rather than interface controls.
const artwork = new Set(["game/BoardCanvas.tsx", "landing/ModeIllustration.tsx"]);
const rawColor = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(\s*[\d.]/i;
const arbitraryPalette = /\b(?:bg|text|border|ring|outline|fill|stroke|shadow)-(?:\[[^\]]*(?:#|rgb|hsl)|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d|black\b|white\b)/;
const controlSelector = /(?:\bbutton|\bselect|\binput|\.ui-(?:button(?:--[\w-]+)?|icon-button|select|input|panel)|\.(?:lesson-action|lesson-target|study-action|study-hint-button|study-next|new-game|setting-row|feature-link))(?:\.[\w-]+|:[\w-]+(?:\([^)]*\))?)*$/;
const appearance = /^(?:background(?:-.+)?|color|border(?:-(?:color|radius|width|style))?|box-shadow|text-shadow|font(?:-.+)?|transition|outline(?:-.+)?|text-decoration)\s*:/;

function report(path, text, position, message) {
  const line = text.slice(0, position).split("\n").length;
  issues.push(`${path}:${line}: ${message}`);
}

async function check(path) {
  const name = relative(root, path).replaceAll("\\", "/");
  const text = await readFile(path, "utf8");
  const shared = name.startsWith("components/ui/");
  const drawing = name.startsWith("scene/") || artwork.has(name);
  if (name.endsWith(".tsx")) {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if (!shared && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
        if (/^(button|select|input|textarea|dialog)$/.test(node.tagName.getText(source))) {
          report(name, text, node.getStart(source), "Use a shared UI primitive for this control.");
        }
        if (controls.has(node.tagName.getText(source))) {
          const attribute = node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(source) === "className");
          if (attribute) {
            function collect(part) {
              if (ts.isStringLiteralLike(part) || [ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail].includes(part.kind)) {
                for (const name of part.text.split(/\s+/)) {
                  if (/^[a-z][\w-]*$/.test(name) && name !== "sr-only") controlClasses.add(name);
                }
              }
              ts.forEachChild(part, collect);
            }
            collect(attribute);
          }
        }
      }
      if (!drawing && ts.isStringLiteralLike(node) && (rawColor.test(node.text) || arbitraryPalette.test(node.text))) {
        report(name, text, node.getStart(source), "Use semantic theme tokens instead of an inline color or Tailwind palette.");
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  } else if (name.endsWith(".css") && name !== "theme.css" && !drawing) {
    // Keep offsets stable for diagnostics while removing comments.
    const css = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
    const colors = new RegExp(rawColor.source, "gi");
    for (const match of css.matchAll(colors)) report(name, text, match.index, "Define UI colors in theme.css and consume them with var().");
    for (const match of css.matchAll(/--(?:color-[\w-]+|font-(?:mono|pixel))\s*:/g)) {
      report(name, text, match.index, "Define the shared palette and fonts only in theme.css.");
    }
    if (!shared) {
      // Feature CSS consists of flat rules inside optional media queries.
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const targetsControl = rule[1].split(",").some((selector) => {
          const target = selector.trim().replace(/:[\w-]+(?:\([^)]*\))?/g, "");
          const classes = target.match(/\.([\w-]+)/g) ?? [];
          const lastPart = target.split(/[\s>+~]+/).at(-1) ?? "";
          return controlSelector.test(selector.trim()) || classes.some((name) => controlClasses.has(name.slice(1)) && lastPart.includes(name));
        });
        if (!targetsControl) continue;
        for (const declaration of rule[2].split(";")) {
          if (appearance.test(declaration.trim())) report(name, text, rule.index + rule[1].indexOf(rule[1].trim()), "Control appearance belongs in components/ui/ui.css; feature CSS may set layout.");
        }
      }
    }
  }
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (/\.(tsx|css)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const files = await walk(root);
// Discover each control's feature classes before checking any feature styles.
for (const file of files.filter((path) => path.endsWith(".tsx"))) await check(file);
for (const file of files.filter((path) => path.endsWith(".css"))) await check(file);
if (issues.length) {
  console.error(`UI consistency check failed:\n${issues.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("UI consistency check passed: shared controls and centralized theme.");
}
