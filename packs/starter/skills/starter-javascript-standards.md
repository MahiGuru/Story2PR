---
name: starter-javascript-standards
description: Modern JavaScript (ES2020+) coding standards. Loaded by Surgeon when task Layer = JavaScript or as a baseline alongside framework skills. Covers async/await, modules, equality, error handling, and the universal "if you're writing JS in 2024+" conventions. NOT TypeScript-specific (see starter-typescript-standards.md).
---

# Modern JavaScript Standards

## Context

Baseline conventions for **JavaScript ES2020+** code. This skill is layer-agnostic — load it whenever a task is plain JS (no framework, or alongside one). For TypeScript-specific guidance (types, generics, narrowing) use `starter-typescript-standards.md`.

Assume **Node 18+** or **modern browsers** (top two major versions). If you're targeting IE11, this is the wrong skill.

## Modules — ESM only

```javascript
// ✅ ES modules
import { readFile } from 'node:fs/promises';
import { fetchUser } from './user.js';

export async function loadProfile(id) { /* ... */ }
export default loadProfile;

// ❌ CommonJS in new code
const fs = require('fs');     // legacy — only for compatibility shims
module.exports = { /* ... */ };
```

- Use ESM (`import` / `export`) for all new code.
- Include the `.js` extension in relative imports — Node ESM requires it, and bundlers handle it fine.
- Use the `node:` prefix for built-ins (`node:fs`, `node:path`) — explicit and faster to resolve.

## Variables

```javascript
const user = await fetchUser(id);   // default — never reassigned
let attempts = 0;                    // only when reassignment is needed
attempts++;

// var is dead — never use it in new code
```

- `const` by default. `let` only when the reference will be reassigned.
- Never `var` — its function-scope and hoisting behavior cause bugs that block-scope avoids.

## Equality

```javascript
if (user === null)          // ✅ strict
if (user == null)            // 🟡 acceptable shorthand for "null or undefined"
if (count == 0)              // ❌ use ===
```

- `===` and `!==` everywhere.
- The single exception is `== null` to mean "null or undefined" — concise and well-known.

## Async — promises and async/await

```javascript
// ✅ async/await — straightforward sequential flow
async function loadDashboard(userId) {
  const user = await fetchUser(userId);
  const [orders, prefs] = await Promise.all([
    fetchOrders(user.id),
    fetchPrefs(user.id),
  ]);
  return { user, orders, prefs };
}

// ✅ Promise.all for parallelizable independent work
// ✅ Promise.allSettled when you want all results regardless of failures

// ❌ callback-style or .then chains for new code (only when interfacing with legacy APIs)
```

**Rules:**
- `async/await` for control flow. `.then()` only when you specifically want a non-blocking chain.
- `Promise.all` for parallel independent work. Don't sequentially `await` calls that could run together.
- Always handle errors — top-level `await` without `try/catch` will crash the process.

## Error handling

```javascript
try {
  const data = await fetchData();
  return process(data);
} catch (err) {
  // Narrow the error — don't swallow blindly
  if (err instanceof FetchError) {
    logger.warn('Fetch failed', { cause: err });
    return fallback;
  }
  throw err;   // re-throw what you don't recognize
}
```

- Don't catch and swallow. Either handle the error meaningfully or let it propagate.
- Throw `Error` subclasses, never strings or plain objects (`throw new ValidationError(...)`, not `throw 'bad'`).
- Use `Error.cause` to chain errors: `throw new ServiceError('failed', { cause: err })`.

## Iteration

```javascript
// ✅ for...of for arrays / iterables
for (const item of items) { /* ... */ }

// ✅ Object.entries / .keys / .values for objects
for (const [key, value] of Object.entries(obj)) { /* ... */ }

// ✅ map / filter / reduce when functional reads cleaner
const totals = orders.map(o => o.amount).reduce((a, b) => a + b, 0);

// ❌ for...in on arrays — iterates inherited keys + string indices
for (const i in items) { /* don't */ }
```

- `for...of` for arrays. `for...in` is for object keys (rare — usually `Object.keys/entries` is clearer).
- `forEach` is fine but doesn't `await` the callback — use `for...of` if the body is async.

## Optional chaining and nullish coalescing

```javascript
const city = user?.address?.city;             // safe traversal
const limit = options.limit ?? 100;            // default only when null/undefined (NOT 0 or '')
const name = user?.name ?? 'Anonymous';
```

`??` is for nullish defaults. `||` short-circuits on falsy (`0`, `''`, `false`) — that's a different operator and a frequent source of bugs.

## Naming

| Kind | Convention | Example |
|------|------------|---------|
| Variables, functions | `camelCase` | `userId`, `fetchUser` |
| Classes, constructors | `PascalCase` | `UserService`, `ValidationError` |
| Module-level constants | `UPPER_SNAKE_CASE` | `MAX_RETRIES`, `API_BASE_URL` |
| Private (informal) | `_leadingUnderscore` | `_cache` (or use `#` private fields in classes) |
| File names | `kebab-case.js` | `user-service.js`, `validation-error.js` |

## Do / Don't

✅ `const`/`let`, ESM, `===`, `async/await`, `Promise.all` for parallel work, `?.`/`??`, typed `Error` subclasses with `cause`, `node:` prefix for built-ins.

❌ `var`, CommonJS in new code, `==` (except `== null`), `.then()` chains where `await` would read clearly, swallowed catches, `for...in` on arrays, `||` for defaults when `0`/`''` are valid values.
