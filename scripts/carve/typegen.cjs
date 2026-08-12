#!/usr/bin/env node
/**
 * Carve-up prop typer: prints the TypeScript-inferred type of App.tsx
 * bindings, straight from the compiler, so panel props interfaces are exact.
 *
 * Usage (from ui/): node ../scripts/carve/typegen.cjs name1 name2 ...
 *   or:             node ../scripts/carve/typegen.cjs --stdin   (names on stdin)
 */
const ts = require(require("path").join(process.cwd(), "node_modules/typescript"));
const path = require("path");

const uiDir = process.cwd();
const configPath = ts.findConfigFile(uiDir, ts.sys.fileExists, "tsconfig.json");
const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n")); },
});
const program = ts.createProgram(config.fileNames, config.options);
const checker = program.getTypeChecker();
const appSource = program.getSourceFile(path.join(uiDir, "src/App.tsx"));
if (!appSource) throw new Error("src/App.tsx not in program");

let names;
if (process.argv[2] === "--stdin") {
  names = require("fs").readFileSync(0, "utf8").split(/\s+/).filter(Boolean);
} else {
  names = process.argv.slice(2);
}
const wanted = new Set(names);
const found = new Map();

function visit(node) {
  if (found.size === wanted.size) return;
  if (
    (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) ||
     ts.isBindingElement(node) || ts.isParameter(node)) &&
    node.name && ts.isIdentifier(node.name) && wanted.has(node.name.text) &&
    !found.has(node.name.text)
  ) {
    const type = checker.getTypeAtLocation(node.name);
    const text = checker.typeToString(
      type, node,
      ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope
    );
    found.set(node.name.text, text);
  }
  ts.forEachChild(node, visit);
}
visit(appSource);

for (const n of names) {
  console.log(`  ${n}: ${found.get(n) ?? "/* NOT FOUND */"};`);
}
