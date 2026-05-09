---
name: starter-typescript-standards
description: TypeScript coding standards. Loaded by Surgeon when task Layer = TypeScript or as a baseline alongside framework skills (React, Angular, Vue). Covers strict-mode flags, `interface` vs `type`, generics, narrowing, and the patterns that catch bugs at compile time. Layer this on top of starter-javascript-standards.md.
---

# TypeScript Standards

## Context

This skill assumes **TypeScript 5.x** with **`strict: true`** (or, equivalently, all the strictness flags individually enabled). If your project has `strict: false`, the first task on this skill is to flip it — most patterns below assume strict narrowing semantics.

This is **layered on top** of `starter-javascript-standards.md`. Everything in the JS skill applies; this one adds the type-system bits.

## tsconfig — non-negotiable flags

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "moduleResolution": "bundler",
    "target": "ES2022",
    "module": "ESNext"
  }
}
```

- `strict: true` enables `noImplicitAny`, `strictNullChecks`, and friends.
- `noUncheckedIndexedAccess: true` — `arr[0]` becomes `T | undefined`. Forces you to handle empty arrays. Catches real bugs.
- `isolatedModules: true` — required for fast bundlers (esbuild, swc, Vite).

## any vs unknown

```typescript
// ❌ any — turns off type checking, infects everything it touches
function parse(input: any) { /* ... */ }

// ✅ unknown — must narrow before use, type-system stays sound
function parse(input: unknown): User {
  if (!isUser(input)) throw new TypeError('not a user');
  return input;   // narrowed by the type guard
}
```

`any` is the escape hatch you reach for when you've given up. `unknown` is the right type for "I don't know yet, narrow it."

## interface vs type

```typescript
interface User {
  id: string;
  name: string;
}

// Extends well, declaration-merges, used for object shapes
interface AdminUser extends User {
  permissions: Permission[];
}

type Status = 'active' | 'inactive' | 'pending';
type ID<T extends string> = `${T}_${string}`;

// type for unions, primitives, mapped types, conditional types
```

**Rule of thumb:** `interface` for object shapes meant to be extended; `type` for unions, intersections, and computed types. Don't litigate it — both compile to the same checks. Be consistent within a file.

## Narrowing

```typescript
// Discriminated unions — the gold standard
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

function handle<T>(r: Result<T>) {
  if (r.ok) return r.value;       // narrowed to { ok: true; value: T }
  console.error(r.error);          // narrowed to { ok: false; error: Error }
}

// User-defined type guards
function isUser(x: unknown): x is User {
  return typeof x === 'object' && x !== null && 'id' in x && 'name' in x;
}

// `satisfies` — type-check without widening
const config = {
  host: 'localhost',
  port: 8080,
} satisfies ServerConfig;     // config keeps its literal types
```

`satisfies` is one of the most useful additions in modern TS — it validates a value against a type without forcing the value to widen to the type.

## Generics

```typescript
// Generic constraints make the API self-documenting
function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const k of keys) result[k] = obj[k];
  return result;
}

// Don't reach for generics when concrete types work
function double(n: number): number { return n * 2; }   // ✅ no generic needed
function double<T extends number>(n: T): T { /* ... */ }   // ❌ over-generic
```

Generics are for relating two types. If your function takes one type and returns the same type, that's a generic. If it takes one type and returns a different type, it's not.

## Utility types — know these cold

| Type | Use |
|------|-----|
| `Pick<T, K>` | subset of properties |
| `Omit<T, K>` | T minus K |
| `Partial<T>` | all props optional |
| `Required<T>` | all props required |
| `Readonly<T>` | all props readonly |
| `Record<K, V>` | dict-like type |
| `ReturnType<F>` | inferred return type |
| `Parameters<F>` | inferred params tuple |
| `Awaited<T>` | unwrap a Promise |
| `NonNullable<T>` | exclude null/undefined |

## Type-only imports

```typescript
import type { User } from './user.js';        // ✅ erased at compile time
import { type User, fetchUser } from './user.js';  // ✅ mixed, also erased

import { User } from './user.js';              // 🟡 works, but `import type` is clearer
```

`import type` makes intent explicit and helps bundlers tree-shake.

## Errors

```typescript
class ValidationError extends Error {
  override readonly name = 'ValidationError';
  constructor(message: string, readonly field: string, options?: ErrorOptions) {
    super(message, options);
  }
}

try {
  validate(input);
} catch (err) {
  if (err instanceof ValidationError) {
    handleField(err.field);
  } else {
    throw err;
  }
}
```

Always type-narrow caught errors. `catch (err)` types `err` as `unknown` under strict mode — narrow before use.

## Do / Don't

✅ `strict: true`, `unknown` over `any`, discriminated unions, `satisfies`, `import type`, narrow caught errors with `instanceof`, `Pick`/`Omit`/`Partial` instead of restating shapes.

❌ `any` (use `unknown`), `as` casts to bypass type errors (fix the type), `// @ts-ignore` (use `// @ts-expect-error` so it fails when no longer needed), `enum` (prefer union of literals or `as const` object), namespaces (use modules).
