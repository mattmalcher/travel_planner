// Generate a standalone skill from the canonical authoring skill and CLI.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/bundle-authoring.mjs <output-directory>');
const out = resolve(output);
mkdirSync(join(out, 'scripts'), { recursive: true });
mkdirSync(join(out, 'schema'), { recursive: true });
let source = readFileSync(join(root, 'scripts/itin.mjs'), 'utf8');
source = source.replace("new URL('../.agents/skills/itinerary-authoring/SKILL.md', import.meta.url)",
  "new URL('../SKILL.md', import.meta.url)");
// Generated bundles are installed copies; doctrine writes belong in the source repo.
source = source.replace('function cmdDoctrine(', 'function sourceCmdDoctrine(');
source += '\nfunction cmdDoctrine(args) { if (args.includes("--write")) throw new Error("Regenerate this bundle from the planner source; do not edit installed doctrine."); return sourceCmdDoctrine(args); }\n';
const result = await build({
  stdin: { contents: source, resolveDir: join(root, 'scripts'), sourcefile: 'itin.mjs', loader: 'js' },
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  outfile: join(out, 'scripts/itin.mjs'), metafile: true,
  banner: { js: 'import { createRequire as bundleCreateRequire } from "node:module"; const require = bundleCreateRequire(import.meta.url);' },
});
copyFileSync(join(root, 'schema/holiday_itinerary_schema.json'), join(out, 'schema/holiday_itinerary_schema.json'));
let skill = readFileSync(join(root, '.agents/skills/itinerary-authoring/SKILL.md'), 'utf8');
skill = skill.replaceAll('npm run itin --', 'node "$ITIN"')
  .replaceAll('npm run validate --', 'node "$ITIN" validate')
  .replaceAll('make validate FILE=<path>', 'node "$ITIN" validate <path>')
  .replaceAll('make validate', 'node "$ITIN" validate');
const marker = '# Authoring HolidayItinerary documents';
skill = skill.replace(marker, marker + '\n\nThis is a generated installed bundle. Set `SKILL_DIR` to the absolute directory\ncontaining this file and `ITIN="$SKILL_DIR/scripts/itin.mjs"`. Node 22+ is the\nonly authoring runtime required; no npm install or planner checkout is needed.\nThe schema is bundled in `schema/`. Edit the canonical planner source to change\nthe skill, then regenerate; do not run doctrine --write in this bundle.\n');
writeFileSync(join(out, 'SKILL.md'), skill);
// Preserve dependency licenses for the code included by esbuild.
const licenses = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (match) licenses.add(match[1]);
}
let notices = '# Bundled dependency notices\n';
for (const name of [...licenses].sort()) {
  const pkg = join(root, 'node_modules', name);
  const metadata = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  notices += `\n## ${name} ${metadata.version}\n\n`;
  let found = false;
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license']) {
    try { notices += readFileSync(join(pkg, filename), 'utf8') + '\n'; found = true; break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!found) throw new Error(`Missing dependency license: ${name}`);
}
writeFileSync(join(out, 'THIRD_PARTY_NOTICES.md'), notices);
