/**
 * The slice of CacheService the WebAuthn and step-up stores use, kept in a
 * Map. TTLs are recorded but not enforced; tests expire a key by deleting it.
 */
export function createInMemoryCache() {
  const values = new Map<string, string>();
  const ttls = new Map<string, number>();

  return {
    values,
    ttls,
    async setJson(key: string, value: unknown, ttlSeconds?: number) {
      values.set(key, JSON.stringify(value));
      if (ttlSeconds !== undefined) {
        ttls.set(key, ttlSeconds);
      }
    },
    async getJson<T>(key: string): Promise<T | null> {
      const value = values.get(key);
      return value === undefined ? null : (JSON.parse(value) as T);
    },
    async getDeleteJson<T>(key: string): Promise<T | null> {
      const value = values.get(key);
      values.delete(key);
      return value === undefined ? null : (JSON.parse(value) as T);
    },
    async delete(key: string) {
      return values.delete(key);
    },
  };
}
