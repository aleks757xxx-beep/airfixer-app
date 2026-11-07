import { z } from "zod";

const BUFFER_API = "https://api.buffer.com";

export class BufferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BufferError";
  }
}

const GraphQLResponse = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

/** Запрос к Buffer GraphQL API; ответ проверяется Zod-схемой. */
export async function bufferQuery<S extends z.ZodType>(
  apiKey: string,
  query: string,
  schema: S,
  variables?: Record<string, unknown>,
): Promise<z.infer<S>> {
  const res = await fetch(BUFFER_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(variables ? { query, variables } : { query }),
  });
  const raw: unknown = await res.json().catch(() => null);
  const parsed = GraphQLResponse.safeParse(raw);
  if (!res.ok || !parsed.success || parsed.data.errors?.length) {
    const msg = parsed.success ? parsed.data.errors?.map((e) => e.message).join("; ") : undefined;
    throw new BufferError(msg || `Buffer ответил ${res.status}`);
  }
  return schema.parse(parsed.data.data);
}

const CapabilitiesSchema = z.object({
  account: z.object({ organizations: z.array(z.object({ id: z.string() })) }),
  __schema: z.object({ mutationType: z.object({ fields: z.array(z.object({ name: z.string() })) }).nullable() }),
});

export interface BufferCapabilities {
  ok: boolean;
  organizations: number;
  mutations: string[];
  error?: string;
}

let cached: { at: number; value: BufferCapabilities } | null = null;

/** Проверить ключ и узнать, какие действия доступны (кэш 10 минут). */
export async function bufferCapabilities(apiKey: string | undefined): Promise<BufferCapabilities> {
  if (!apiKey) return { ok: false, organizations: 0, mutations: [], error: "нет ключа" };
  if (cached && Date.now() - cached.at < 600_000) return cached.value;
  let value: BufferCapabilities;
  try {
    const d = await bufferQuery(
      apiKey,
      "query { account { organizations { id } } __schema { mutationType { fields { name } } } }",
      CapabilitiesSchema,
    );
    value = {
      ok: true,
      organizations: d.account.organizations.length,
      mutations: (d.__schema.mutationType?.fields ?? []).map((f) => f.name).sort(),
    };
  } catch (e: unknown) {
    value = { ok: false, organizations: 0, mutations: [], error: e instanceof Error ? e.message.slice(0, 200) : "ошибка" };
  }
  cached = { at: Date.now(), value };
  return value;
}

/** Описание типа из схемы Buffer (только чтение) — для разработки и для Claude. */
export async function bufferIntrospectType(apiKey: string, name: string): Promise<unknown> {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,80}$/.test(name)) throw new BufferError("Неверное имя типа");
  const ref = "kind name ofType { kind name ofType { kind name ofType { kind name } } }";
  const q = `query { __type(name: "${name}") { kind name description
    fields { name description args { name type { ${ref} } } type { ${ref} } }
    inputFields { name description type { ${ref} } }
    enumValues { name description }
    possibleTypes { name } } }`;
  return bufferQuery(apiKey, q, z.unknown());
}
