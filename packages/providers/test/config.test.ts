
import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { ProviderConfigManager } from "../src/config/manager";
import { promises as fs } from "fs";
import * as path from "path";

describe("ProviderConfigManager", () => {
  const testDir = path.join(process.cwd(), "test-config");
  const manager = new ProviderConfigManager(testDir);

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  test("should save and load provider configs", async () => {
    const config = {
      id: "test-provider",
      type: "runtime",
      options: { foo: "bar" }
    };

    await manager.setProvider(config);
    const configs = await manager.loadConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0]).toEqual(config);

    const retrieved = await manager.getProvider("test-provider");
    expect(retrieved).toEqual(config);
  });

  test("should unset provider config", async () => {
    const config = {
      id: "test-provider",
      type: "runtime",
      options: { foo: "bar" }
    };

    await manager.setProvider(config);
    await manager.unsetProvider("test-provider");
    const configs = await manager.loadConfigs();
    expect(configs).toHaveLength(0);
  });
});
