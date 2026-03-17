import type { SecretStore, StoredSecrets } from "./types";

const KEYCHAIN_SERVICE = "openhue-client";

async function loadKeytar() {
  try {
    const sea = await import("node:sea");
    if (sea.isSea()) {
      return undefined;
    }
  } catch {
    // Ignore runtimes without the SEA helper module.
  }

  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<typeof import("keytar")>;
    return await dynamicImport("keytar");
  } catch {
    return undefined;
  }
}

function accountName(profile: string): string {
  return `profile:${profile}`;
}

export function createKeychainStore(): SecretStore {
  return {
    async delete(profile) {
      const keytar = await loadKeytar();
      if (!keytar) {
        return;
      }
      await keytar.deletePassword(KEYCHAIN_SERVICE, accountName(profile));
    },
    async get(profile) {
      const keytar = await loadKeytar();
      if (!keytar) {
        return undefined;
      }

      const raw = await keytar.getPassword(KEYCHAIN_SERVICE, accountName(profile));
      if (!raw) {
        return undefined;
      }

      try {
        return JSON.parse(raw) as StoredSecrets;
      } catch {
        return undefined;
      }
    },
    async has(profile) {
      const secrets = await this.get(profile);
      return Boolean(secrets?.applicationKey || secrets?.clientKey);
    },
    async isAvailable() {
      return (await loadKeytar()) !== undefined;
    },
    async set(profile, secrets) {
      const keytar = await loadKeytar();
      if (!keytar) {
        throw new Error(
          "OS keychain support is unavailable in this runtime. Install optional dependency `keytar` in the Node-based CLI to persist secrets.",
        );
      }

      await keytar.setPassword(KEYCHAIN_SERVICE, accountName(profile), JSON.stringify(secrets));
    },
  };
}
