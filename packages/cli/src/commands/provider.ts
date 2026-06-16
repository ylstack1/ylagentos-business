// ─── YL CLI — Provider Config Commands ──────────────────────────────────────
// yl provider list
// yl provider set <domain> <provider-id> [key=value...]
// yl provider unset <provider-id>

import type { ProviderConfig, ProviderDomain } from "../../../types/src/index.ts";

const providers = new Map<string, ProviderConfig>();

// Seed default providers
function seedDefaults(): void {
  const now = new Date().toISOString();
  const defaults: ProviderConfig[] = [
    { id: "local", domain: "runtime", name: "Local Runtime", type: "local", config: {}, isDefault: true, createdAt: now },
    { id: "local-storage", domain: "storage", name: "Local Storage", type: "local", config: {}, isDefault: true, createdAt: now },
    { id: "openai", domain: "model", name: "OpenAI", type: "openai", config: { apiKey: "" }, isDefault: false, createdAt: now },
    { id: "anthropic", domain: "model", name: "Anthropic Claude", type: "anthropic", config: { apiKey: "" }, isDefault: false, createdAt: now },
    { id: "github", domain: "git", name: "GitHub", type: "github", config: { token: "" }, isDefault: false, createdAt: now },
  ];
  for (const p of defaults) providers.set(p.id, p);
}

seedDefaults();

export async function listProviders(): Promise<void> {
  if (providers.size === 0) {
    console.log("📭 No providers configured.");
    return;
  }

  console.log("🔌 Providers:");
  const byDomain = new Map<string, ProviderConfig[]>();
  for (const p of providers.values()) {
    const arr = byDomain.get(p.domain) ?? [];
    arr.push(p);
    byDomain.set(p.domain, arr);
  }

  for (const [domain, configs] of byDomain) {
    console.log(`  ${domain.toUpperCase()}:`);
    for (const p of configs) {
      const star = p.isDefault ? " ★" : "";
      console.log(`    ${p.id}  ${p.name} (${p.type})${star}`);
    }
  }
}

export async function setProvider(args: string[]): Promise<void> {
  if (args.length < 2) {
    console.error("Usage: yl provider set <domain> <provider-id> [key=value...]");
    process.exit(1);
  }

  const domain = args[0]!;
  const providerId = args[1]!;
  const kvPairs = args.slice(2);

  const validDomains = ["runtime", "storage", "model", "git"];
  if (!validDomains.includes(domain)) {
    console.error(`❌ Invalid domain: ${domain}. Valid: ${validDomains.join(", ")}`);
    process.exit(1);
  }

  const config: Record<string, string> = {};
  for (const pair of kvPairs) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) {
      config[pair] = "";
    } else {
      config[pair.substring(0, eqIdx)] = pair.substring(eqIdx + 1);
    }
  }

  const existing = providers.get(providerId);
  const now = new Date().toISOString();

  const provider: ProviderConfig = {
    id: providerId,
    domain: domain as ProviderDomain,
    name: existing?.name ?? providerId,
    type: existing?.type ?? "custom",
    config: { ...existing?.config, ...config },
    isDefault: existing?.isDefault ?? false,
    createdAt: existing?.createdAt ?? now,
  };

  providers.set(providerId, provider);
  console.log(`✅ Set provider: ${providerId} (${domain})`);

  if (provider.isDefault) {
    for (const [id, p] of providers) {
      if (id !== providerId && p.domain === domain && p.isDefault) {
        p.isDefault = false;
      }
    }
    console.log(`   ★ Set as default ${domain} provider`);
  }
}

export async function unsetProvider(providerId?: string): Promise<void> {
  if (!providerId) {
    console.error("Usage: yl provider unset <provider-id>");
    process.exit(1);
  }
  const removed = providers.delete(providerId);
  if (removed) {
    console.log(`🗑️  Removed provider: ${providerId}`);
  } else {
    console.error(`❌ Provider not found: ${providerId}`);
    process.exit(1);
  }
}