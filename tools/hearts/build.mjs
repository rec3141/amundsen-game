import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
await build({
  entryPoints: [root + 'tools/hearts/service.mjs'], outfile: root + 'hearts-service.cjs',
  bundle: true, platform: 'node', format: 'cjs', target: 'node18',
  alias: { 'pure-rand': root + 'vendor/pure-rand/src/pure-rand-default.ts', ...Object.fromEntries(['engine', 'tricks', 'game-hearts'].map(name =>
    ['@parlour/' + name, root + 'vendor/parlour/' + name + '/src/index.ts'])) },
  nodePaths: [root + 'tools/hearts/node_modules'], legalComments: 'eof',
});
