import { writeFile } from 'node:fs/promises';
import type { ProjectRepository } from './repository.js';
import { buildApp } from './app.js';

const app = await buildApp({
  repository: {} as ProjectRepository,
  verifyToken: async () => {
    throw new Error('Generator does not authenticate requests');
  },
  webOrigin: 'http://localhost:3000',
  logger: false,
});
try {
  await app.ready();
  await writeFile(
    new URL('../../../packages/contracts/openapi.json', import.meta.url),
    JSON.stringify(app.swagger(), null, 2) + '\n',
  );
} finally {
  await app.close();
}
