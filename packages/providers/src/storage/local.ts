
import { IStorageProvider, ProviderInfo } from '../../interfaces';
import { promises as fs } from 'fs';
import * as path from 'path';

export class LocalStorageProvider implements IStorageProvider {
  info: ProviderInfo = {
    id: 'storage-local',
    type: 'storage',
    name: 'Local Filesystem Storage',
    version: '0.1.0'
  };

  constructor(private rootDir: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async shutdown(): Promise<void> {}

  private getFullPath(p: string): string {
    return path.join(this.rootDir, p);
  }

  async read(p: string): Promise<Buffer> {
    return await fs.readFile(this.getFullPath(p));
  }

  async write(p: string, data: Buffer | string): Promise<void> {
    const fullPath = this.getFullPath(p);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);
  }

  async list(p: string): Promise<string[]> {
    return await fs.readdir(this.getFullPath(p));
  }

  async delete(p: string): Promise<void> {
    await fs.rm(this.getFullPath(p), { recursive: true, force: true });
  }

  async exists(p: string): Promise<boolean> {
    try {
      await fs.access(this.getFullPath(p));
      return true;
    } catch {
      return false;
    }
  }
}
