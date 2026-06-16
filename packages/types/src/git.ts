
import { IProvider } from './provider';

export interface GitRepoInfo {
  url: string;
  branch?: string;
  auth?: {
    token?: string;
    username?: string;
    password?: string;
  };
}

export interface IGitProvider extends IProvider {
  clone(repo: GitRepoInfo, path: string): Promise<void>;
  pull(path: string): Promise<void>;
  push(path: string): Promise<void>;
  commit(path: string, message: string): Promise<void>;
  createPR(path: string, title: string, body: string, head: string, base: string): Promise<string>;
}
