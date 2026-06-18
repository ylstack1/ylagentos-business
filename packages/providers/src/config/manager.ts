
import { promises as fs } from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

export interface ProviderConfig {
  id: string;
  type: string;
  options: Record<string, any>;
}

export class ProviderConfigManager {
  private configPath: string;

  constructor(configDir?: string) {
    const home = process.env.HOME || '/home/agent-provider-engineer';
    const dir = configDir || path.join(home, '.yl');
    this.configPath = path.join(dir, 'config.json');
  }

  async ensureConfigDir(): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
  }

  async loadConfigs(): Promise<ProviderConfig[]> {
    try {
      const content = await fs.readFile(this.configPath, 'utf8');
      const data = JSON.parse(content);
      return data.providers || [];
    } catch (e) {
      return [];
    }
  }

  async saveConfigs(providers: ProviderConfig[]): Promise<void> {
    await this.ensureConfigDir();
    let data: any = {};
    try {
      const content = await fs.readFile(this.configPath, 'utf8');
      data = JSON.parse(content);
    } catch (e) {}
    
    data.providers = providers;
    await fs.writeFile(this.configPath, JSON.stringify(data, null, 2), 'utf8');
  }

  async setProvider(config: ProviderConfig): Promise<void> {
    const configs = await this.loadConfigs();
    const index = configs.findIndex(c => c.id === config.id);
    if (index >= 0) {
      configs[index] = config;
    } else {
      configs.push(config);
    }
    await this.saveConfigs(configs);
  }

  async unsetProvider(id: string): Promise<void> {
    const configs = await this.loadConfigs();
    const filtered = configs.filter(c => c.id !== id);
    await this.saveConfigs(filtered);
  }

  async getProvider(id: string): Promise<ProviderConfig | undefined> {
    const configs = await this.loadConfigs();
    return configs.find(c => c.id === id);
  }

  /**
   * Load secrets from .env file in the workspace or standard location
   */
  loadSecrets(envPath?: string): void {
    dotenv.config({ path: envPath });
  }

  getSecret(key: string): string | undefined {
    return process.env[key];
  }
}
