import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import ts from 'typescript';

/**
 * The Scan screen is composed from an ordered chain of hooks
 * (features/form-tracking/hooks/scan) and render components
 * (features/form-tracking/components/scan). Source-slice tests select
 * statements from `ScanARKitScreen`'s body, so this helper presents the real
 * production code as one module: merged imports, module-level declarations,
 * and a `ScanARKitScreen` whose body is every hook body in chain order without
 * the generated ctx destructuring and return.
 */
const ROOT = path.resolve(__dirname, '..', '..');
export const SCAN_SCREEN_FILE = path.join(ROOT, 'app/(tabs)/scan-arkit.tsx');
const HOOKS_DIR = path.join(ROOT, 'features/form-tracking/hooks/scan');
const COMPONENTS_DIR = path.join(ROOT, 'features/form-tracking/components/scan');

const parse = (file: string) =>
  ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const listDir = (dir: string) => readdirSync(dir).filter(f => /\.tsx?$/.test(f)).sort().map(f => path.join(dir, f));

function hookChainOrder(screen: ts.SourceFile): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^useScan/.test(node.expression.text)) names.push(node.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(screen);
  return names;
}

let cached: string | null = null;

export function readScanScreenSource(): string {
  if (cached) return cached;
  const screen = parse(SCAN_SCREEN_FILE);
  const files = [...listDir(HOOKS_DIR), ...listDir(COMPONENTS_DIR)].map(parse);
  const hookBodies = new Map<string, ts.Statement[]>();
  type ImportEntry = { def?: string; ns?: string; named: Map<string, string> };
  const imports = new Map<string, ImportEntry>();
  const topLevel: string[] = [];

  for (const sf of [screen, ...files]) {
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st)) {
        const spec = (st.moduleSpecifier as ts.StringLiteral).text;
        if (spec.startsWith('@/features/form-tracking/hooks/scan/') || spec.startsWith('@/features/form-tracking/components/scan/')) continue;
        const entry: ImportEntry = imports.get(spec) ?? { named: new Map() };
        const clause = st.importClause;
        if (clause?.name) entry.def = clause.name.text;
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) entry.ns = clause.namedBindings.name.text;
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            const typeOnly = clause.isTypeOnly || el.isTypeOnly;
            const text = (el.propertyName ? `${el.propertyName.text} as ` : '') + el.name.text;
            if (!entry.named.has(el.name.text) || !typeOnly) entry.named.set(el.name.text, (typeOnly ? 'type ' : '') + text);
          }
        }
        imports.set(spec, entry);
        continue;
      }
      if (sf === screen) continue;
      if (ts.isFunctionDeclaration(st) && st.name && /^useScan/.test(st.name.text) && st.body) {
        const body = [...st.body.statements];
        if (st.parameters.length && body[0] && ts.isVariableStatement(body[0]) &&
          body[0].declarationList.declarations[0]?.initializer?.getText(sf) === 'ctx') body.shift();
        if (body.length && ts.isReturnStatement(body[body.length - 1])) body.pop();
        hookBodies.set(st.name.text, body);
        continue;
      }
      topLevel.push(st.getText(sf));
    }
  }

  const importText = [...imports].map(([spec, e]) => {
    const parts = [e.def, e.ns ? `* as ${e.ns}` : null, e.named.size ? `{ ${[...e.named.values()].join(', ')} }` : null].filter(Boolean);
    return parts.length ? `import ${parts.join(', ')} from '${spec}';` : `import '${spec}';`;
  }).join('\n');
  const body = hookChainOrder(screen).map(name => {
    const stmts = hookBodies.get(name);
    if (!stmts) throw new Error(`Scan hook ${name} not found`);
    return stmts.map(s => s.getSourceFile().text.slice(s.getFullStart(), s.getEnd())).join('');
  }).join('\n');

  cached = `${importText}\n\n${topLevel.join('\n\n')}\n\nexport default function ScanARKitScreen() {${body}\n}\n`;
  return cached;
}

export function scanScreenSourceFile(): ts.SourceFile {
  return ts.createSourceFile('scan-arkit.tsx', readScanScreenSource(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
