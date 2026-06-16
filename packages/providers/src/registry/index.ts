
import { IProvider, ProviderType } from '../interfaces';

export class ProviderRegistry {
  private providers: Map<string, IProvider> = new Map();
  private defaultProviders: Map<ProviderType, string> = new Map();

  async register(provider: IProvider) {
    const { id } = provider.info;
    if (this.providers.has(id)) {
      throw new Error(`Provider with id ${id} already registered`);
    }
    await provider.initialize();
    this.providers.set(id, provider);
  }

  async unregister(id: string) {
    const provider = this.providers.get(id);
    if (provider) {
      await provider.shutdown();
      this.providers.delete(id);
      
      // Clear default if it was the one being unregistered
      for (const [type, defaultId] of this.defaultProviders.entries()) {
        if (defaultId === id) {
          this.defaultProviders.delete(type);
        }
      }
    }
  }

  getProvider<T extends IProvider>(id: string): T {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Provider with id ${id} not found`);
    }
    return provider as T;
  }

  setDefaultProvider(type: ProviderType, id: string) {
    if (!this.providers.has(id)) {
      throw new Error(`Provider with id ${id} not found`);
    }
    const provider = this.providers.get(id)!;
    if (provider.info.type !== type) {
      throw new Error(`Provider ${id} is not of type ${type}`);
    }
    this.defaultProviders.set(type, id);
  }

  getDefaultProvider<T extends IProvider>(type: ProviderType): T {
    const id = this.defaultProviders.get(type);
    if (!id) {
      throw new Error(`No default provider set for type ${type}`);
    }
    return this.getProvider<T>(id);
  }

  listProviders(type?: ProviderType): IProvider[] {
    const list = Array.from(this.providers.values());
    if (type) {
      return list.filter(p => p.info.type === type);
    }
    return list;
  }
}

export const registry = new ProviderRegistry();
