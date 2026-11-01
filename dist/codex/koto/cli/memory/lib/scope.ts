export const memoryScopes = ["shared", "dev", "ops"] as const;
export type MemoryScope = typeof memoryScopes[number];

export function parseScope(value: unknown): MemoryScope {
  const scope = memoryScopes.find(scope => scope === value);
  if (scope === undefined) throw new Error("scope: specify shared, dev or ops.");
  return scope;
}
