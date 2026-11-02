import { spawnSync } from 'node:child_process';

const phase = process.argv[2];
if (!['phase2', 'phase3', 'phase4', 'all'].includes(phase)) {
  process.stderr.write(
    'Usage: node --env-file=.env scripts/test-gates.mjs phase2|phase3|phase4|all\n',
  );
  process.exit(2);
}
const env = {
  ...process.env,
  TEST_PHASE2: phase === 'phase2' || phase === 'all' ? '1' : '0',
  TEST_PHASE3: phase === 'phase3' || phase === 'all' ? '1' : '0',
  TEST_PHASE4: phase === 'phase4' || phase === 'all' ? '1' : '0',
};
for (const args of [
  ['pnpm', '--filter', '@webops/contracts', 'build'],
  ['pnpm', '--filter', '@webops/api', 'test'],
]) {
  const result = spawnSync('corepack', args, {
    env,
    stdio: 'inherit',
    timeout: 180_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
