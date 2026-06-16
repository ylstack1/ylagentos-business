
export type ProviderType = 'runtime' | 'storage' | 'git' | 'model';

export interface ProviderInfo {
  id: string;
  type: ProviderType;
  name: string;
  description?: string;
  version: string;
}

export interface IProvider {
  info: ProviderInfo;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}
