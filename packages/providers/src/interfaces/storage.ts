
import { IProvider } from './provider';

export interface IStorageProvider extends IProvider {
  read(path: string): Promise<Buffer>;
  write(path: string, data: Buffer | string): Promise<void>;
  list(path: string): Promise<string[]>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}
