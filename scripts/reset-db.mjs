import { rmSync } from 'node:fs';
import { join } from 'node:path';

const path = process.env.SQLITE_PATH || join(process.cwd(), 'data', 'oldwhale.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${path}${suffix}`, { force: true });
}
console.log(`Removed SQLite files for ${path}`);
