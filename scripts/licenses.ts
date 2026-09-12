#!/usr/bin/env bun
/**
 * Generate THIRD-PARTY-LICENSES.txt for everything that ships in the browser
 * bundle, so the notice requirements of MIT / ISC / Apache-2.0 / OFL-1.1 are
 * satisfied by a file we actually distribute.
 *
 *   bun scripts/licenses.ts
 *
 * Only runtime dependencies are walked. Build-time tooling (vite, tailwind,
 * sharp, playwright, typescript...) is deliberately excluded: none of it
 * reaches the user, and including it would misrepresent what we ship.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** In dependencies only because `shadcn init` put it there; the app never imports it. */
const NOT_SHIPPED = new Set(['shadcn']);

// Matched case-insensitively: clsx ships a lowercase `license`, and a
// case-sensitive list silently drops the notice such a package requires.
const LICENSE_FILES = ['license', 'license.md', 'license.txt', 'licence', 'licence.md', 'copying'];

type Pkg = { name: string; version: string; license: string; text: string | null };

function manifest(name: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join('node_modules', name, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function licenseText(name: string): string | null {
  const dir = join('node_modules', name);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const file = entries.find((e) => LICENSE_FILES.includes(e.toLowerCase()));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

const root = JSON.parse(readFileSync('package.json', 'utf8'));
const seen = new Map<string, Pkg>();
const stack = Object.keys(root.dependencies ?? {}).filter((n) => !NOT_SHIPPED.has(n));

while (stack.length) {
  const name = stack.pop()!;
  if (seen.has(name)) continue;
  const pkg = manifest(name);
  if (!pkg) continue;

  seen.set(name, {
    name,
    version: String(pkg.version ?? '?'),
    license: typeof pkg.license === 'string' ? pkg.license : 'UNKNOWN',
    text: licenseText(name),
  });
  for (const dep of Object.keys((pkg.dependencies as Record<string, string>) ?? {})) {
    if (!seen.has(dep)) stack.push(dep);
  }
}

const packages = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
const byLicense = new Map<string, string[]>();
for (const p of packages) {
  byLicense.set(p.license, [...(byLicense.get(p.license) ?? []), p.name]);
}

const rule = '='.repeat(78);
const out: string[] = [
  'THIRD-PARTY LICENSES',
  '',
  `${root.name} bundles the open source packages listed below. Each package`,
  'remains under its own licence and the copyright of its own authors.',
  '',
  'This file covers what is served to the browser. Build-time only tooling',
  '(Vite, Tailwind, sharp, Playwright, TypeScript, Vitest, oxlint) is not',
  'included, because none of it forms part of the distributed application.',
  '',
  'Regenerate with: bun scripts/licenses.ts',
  '',
  rule,
  'SUMMARY',
  rule,
  '',
  `${packages.length} packages:`,
  '',
];

for (const license of [...byLicense.keys()].sort()) {
  const names = byLicense.get(license)!.sort();
  out.push(`  ${license} — ${names.length}`);
  for (const n of names) out.push(`      ${n}`);
  out.push('');
}

out.push(
  'Note on @fontsource-variable/geist: the font files are embedded in the',
  'build output. The SIL Open Font License permits this, including in a',
  'commercial product, but the font itself must not be sold on its own and',
  'this licence must travel with it.',
  '',
);

for (const p of packages) {
  out.push(rule, `${p.name}@${p.version}`, `SPDX: ${p.license}`, rule, '');
  out.push(p.text ?? `(No licence file shipped in the package; declared as ${p.license}.)`);
  out.push('');
}

await Bun.write('THIRD-PARTY-LICENSES.txt', out.join('\n'));
console.log(`THIRD-PARTY-LICENSES.txt — ${packages.length} packages`);
for (const license of [...byLicense.keys()].sort()) {
  console.log(`  ${license.padEnd(14)} ${byLicense.get(license)!.length}`);
}
const missing = packages.filter((p) => !p.text);
if (missing.length) console.log(`\nno licence file shipped: ${missing.map((p) => p.name).join(', ')}`);
