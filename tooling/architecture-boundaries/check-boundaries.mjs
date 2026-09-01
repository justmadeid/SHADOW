#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  "out",
]);

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full, files);
      continue;
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }

  return files;
}

function tryResolveFile(candidate) {
  const checks = [
    candidate,
    ...[...SOURCE_EXTENSIONS].map((ext) => `${candidate}${ext}`),
    ...[...SOURCE_EXTENSIONS].map((ext) => path.join(candidate, `index${ext}`)),
  ];

  for (const check of checks) {
    try {
      if (fs.statSync(check).isFile()) return path.resolve(check);
    } catch {
      // Continue.
    }
  }

  return null;
}

function resolveImport(repoRoot, sourceFile, specifier) {
  if (specifier.startsWith(".")) {
    return tryResolveFile(path.resolve(path.dirname(sourceFile), specifier));
  }

  // Stable repo aliases supported by the architecture.
  const aliases = [
    ["@platform-web/", "apps/platform-web/src/"],
    ["@platform-api/", "apps/platform-api/src/"],
    ["@repo/", ""],
  ];

  for (const [prefix, target] of aliases) {
    if (specifier.startsWith(prefix)) {
      return tryResolveFile(
        path.resolve(repoRoot, target, specifier.slice(prefix.length)),
      );
    }
  }

  // Workspace package alias e.g. @intelligence/contracts is deliberately not
  // resolved into apps. Shared package imports are allowed by this checker and
  // dependency-cruiser handles package/app layering.
  return null;
}

function extractImportSpecifiers(file) {
  const sourceText = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") || file.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const specifiers = [];

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier)) {
        specifiers.push(moduleSpecifier.text);
      }
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function productOf(relativePath) {
  const match = relativePath.match(
    /^apps\/platform-web\/src\/products\/(shadow|echo|spectra)(?:\/|$)/,
  );
  return match?.[1] ?? null;
}

function backendModuleOf(relativePath) {
  const match = relativePath.match(/^apps\/platform-api\/src\/modules\/([^/]+)(?:\/|$)/);
  return match?.[1] ?? null;
}

function isTargetModulePublicBoundary(relativePath, targetModule) {
  const prefix = `apps/platform-api/src/modules/${targetModule}`;
  return (
    relativePath === `${prefix}/index.ts` ||
    relativePath === `${prefix}/index.tsx` ||
    relativePath === `${prefix}/index.mts` ||
    relativePath === `${prefix}/index.cts` ||
    relativePath === prefix
  );
}

function checkRepo(repoRoot) {
  const absoluteRoot = path.resolve(repoRoot);
  const scanRoots = [
    path.join(absoluteRoot, "apps", "platform-web", "src"),
    path.join(absoluteRoot, "apps", "platform-api", "src"),
  ];

  const files = scanRoots.flatMap((root) => walk(root));
  const violations = [];

  for (const sourceFile of files) {
    const sourceRel = toPosix(path.relative(absoluteRoot, sourceFile));
    const sourceProduct = productOf(sourceRel);
    const sourceModule = backendModuleOf(sourceRel);

    for (const specifier of extractImportSpecifiers(sourceFile)) {
      const targetFile = resolveImport(absoluteRoot, sourceFile, specifier);
      if (!targetFile) continue;

      const targetRel = toPosix(path.relative(absoluteRoot, targetFile));

      // P0-002: products are isolated from each other's internals.
      if (sourceProduct) {
        const targetProduct = productOf(targetRel);
        if (targetProduct && targetProduct !== sourceProduct) {
          violations.push({
            rule: "frontend-product-isolation",
            source: sourceRel,
            target: targetRel,
            detail: `${sourceProduct} must not import ${targetProduct} internals`,
          });
        }
      }

      // P0-003: modules may use another module only via its root index.
      if (sourceModule) {
        const targetModule = backendModuleOf(targetRel);

        if (
          targetModule &&
          targetModule !== sourceModule &&
          !isTargetModulePublicBoundary(targetRel, targetModule)
        ) {
          violations.push({
            rule: "backend-module-public-boundary",
            source: sourceRel,
            target: targetRel,
            detail: `${sourceModule} must import ${targetModule} only through modules/${targetModule}/index.ts`,
          });
        }
      }
    }
  }

  return { filesScanned: files.length, violations };
}

function parseArgs(argv) {
  const args = { root: process.cwd(), json: false, quiet: false };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--root") {
      args.root = argv[index + 1];
      index += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--quiet") {
      args.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage:
  node tooling/architecture-boundaries/check-boundaries.mjs [options]

Options:
  --root <path>  Repository root (default: cwd)
  --json         Emit JSON result
  --quiet        Do not print success message
`);
      process.exit(0);
    }
  }

  return args;
}

const args = parseArgs(process.argv);
const result = checkRepo(args.root);

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.violations.length > 0) {
  console.error(`Architecture boundary violations: ${result.violations.length}\n`);

  for (const violation of result.violations) {
    console.error(`[${violation.rule}]`);
    console.error(`  from: ${violation.source}`);
    console.error(`  to:   ${violation.target}`);
    console.error(`  ${violation.detail}\n`);
  }
} else if (!args.quiet) {
  console.log(
    `Architecture boundaries OK (${result.filesScanned} source files scanned).`,
  );
}

process.exitCode = result.violations.length > 0 ? 1 : 0;
