
import { expect, test, describe } from "bun:test";
import { registry } from "../src/registry/index";
import { LocalStorageProvider } from "../src/storage/local";

describe("ProviderRegistry", () => {
  test("should register and get a provider", async () => {
    const provider = new LocalStorageProvider("/tmp/yl-test");
    await registry.register(provider);
    
    const retrieved = registry.getProvider("storage-local");
    expect(retrieved).toBe(provider);
    expect(retrieved.info.id).toBe("storage-local");
    
    await registry.unregister("storage-local");
  });

  test("should handle default providers", async () => {
    const provider = new LocalStorageProvider("/tmp/yl-test-default");
    await registry.register(provider);
    registry.setDefaultProvider("storage", "storage-local");
    
    const defaultProvider = registry.getDefaultProvider("storage");
    expect(defaultProvider).toBe(provider);
    
    await registry.unregister("storage-local");
  });
});
