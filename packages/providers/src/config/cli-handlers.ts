
import { ProviderConfigManager, ProviderConfig } from './manager';

const manager = new ProviderConfigManager();

export async function handleProviderSet(id: string, type: string, options: string) {
  let parsedOptions = {};
  try {
    parsedOptions = JSON.parse(options);
  } catch (e) {
    // If not JSON, maybe it's key=value pairs
    options.split(',').forEach(pair => {
      const [key, value] = pair.split('=');
      if (key && value) (parsedOptions as any)[key] = value;
    });
  }

  const config: ProviderConfig = { id, type, options: parsedOptions };
  await manager.setProvider(config);
  console.log(`Provider ${id} configured successfully.`);
}

export async function handleProviderUnset(id: string) {
  await manager.unsetProvider(id);
  console.log(`Provider ${id} removed.`);
}

export async function handleProviderList() {
  const configs = await manager.loadConfigs();
  if (configs.length === 0) {
    console.log('No providers configured.');
    return;
  }

  console.log('Configured Providers:');
  configs.forEach(c => {
    console.log(`- ${c.id} (${c.type})`);
    Object.entries(c.options).forEach(([k, v]) => {
      console.log(`  ${k}: ${v}`);
    });
  });
}
