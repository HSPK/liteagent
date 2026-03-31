import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RuntimeSnapshot } from '../../runtime/types.js';

export class JsonFileStateBackend {
  filePath: string;

  constructor(filePath: string) {
    if (!filePath) {
      throw new Error('JsonFileStateBackend requires a file path.');
    }

    this.filePath = filePath;
  }

  async save(snapshot: RuntimeSnapshot): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
  }

  async load(): Promise<RuntimeSnapshot> {
    const content = await readFile(this.filePath, 'utf8');
    return JSON.parse(content) as RuntimeSnapshot;
  }
}
