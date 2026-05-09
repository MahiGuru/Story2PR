---
name: your-project-react-standards
description: React coding standards for modern function-component codebases. Loaded by Surgeon when task Layer = Frontend/React. Covers hooks, function components, controlled forms, data-fetching patterns, and the JSX/TSX conventions a typical React 18/19 codebase settles on. NOT for Angular or Vue.
---

# React Coding Standards

## Context

This skill covers a **modern React 18/19** codebase using **function components and hooks exclusively**. Class components are legacy — do not write new ones. State management is React's own (`useState`, `useReducer`, Context) for most UIs; reach for an external store (Zustand, Redux Toolkit, Jotai) only when the state genuinely escapes a component subtree.

React ≠ Angular. Don't reach for `@Component`, services, or two-way binding. Use composition and hooks.

## Tech stack

| Area | Technology |
|------|------------|
| Framework | React 18+ (Concurrent rendering, automatic batching) |
| Language | TypeScript with strict mode |
| Components | Function components only |
| State | `useState` / `useReducer` / Context for cross-tree state |
| Data fetching | TanStack Query (React Query), SWR, or framework-native (Next.js, Remix) |
| Routing | React Router v6+ or framework-native |
| Styling | CSS Modules, Tailwind, or styled-components — pick one and stay there |
| Testing | Vitest or Jest + React Testing Library |

## Component pattern

```tsx
import { useState, useCallback } from 'react';

interface UserCardProps {
  user: User;
  editable?: boolean;
  onSave?: (user: User) => void;
}

export function UserCard({ user, editable = false, onSave }: UserCardProps) {
  const [isEditing, setIsEditing] = useState(false);

  const handleSave = useCallback((updated: User) => {
    onSave?.(updated);
    setIsEditing(false);
  }, [onSave]);

  return (
    <article className="user-card">
      <h2>{user.name}</h2>
      {editable && (
        <button onClick={() => setIsEditing(true)}>Edit</button>
      )}
      {isEditing && <UserEditForm user={user} onSubmit={handleSave} />}
    </article>
  );
}
```

**Rules:**
- Function components only. Named function (`function Foo()`) or `const Foo = () => {}` — pick one and be consistent.
- Props go in a typed `interface` or `type`. Default values via destructuring (`editable = false`).
- Use `useCallback` only when the function is passed to a memoized child or as a hook dependency. Don't wrap every handler.

## State

```tsx
// Local UI state — useState
const [count, setCount] = useState(0);

// State with multiple related transitions — useReducer
type Action = { type: 'add' } | { type: 'remove'; id: string } | { type: 'reset' };
const [items, dispatch] = useReducer(itemsReducer, []);

// Cross-tree shared state — Context (or external store for high churn)
const ThemeContext = createContext<Theme>('light');
```

**Decision rule:** if two siblings both need state, lift to the nearest common parent. If state crosses a major tree boundary OR ten components need it, reach for Context (low churn) or an external store (high churn).

## Effects

```tsx
useEffect(() => {
  const controller = new AbortController();

  fetch(`/api/users/${userId}`, { signal: controller.signal })
    .then(r => r.json())
    .then(setUser)
    .catch(err => {
      if (err.name !== 'AbortError') console.error(err);
    });

  return () => controller.abort();   // cleanup — runs on unmount or dep change
}, [userId]);
```

**Rules:**
- Always include cleanup for subscriptions, timers, and in-flight requests.
- Dependency array is exhaustive — let ESLint's `react-hooks/exhaustive-deps` enforce it.
- Don't use `useEffect` for data derived from props/state — compute it directly in render or with `useMemo`.

## Data fetching

Prefer a library (TanStack Query, SWR) over hand-rolled `useEffect + fetch` for anything beyond a one-shot load:

```tsx
const { data, error, isLoading } = useQuery({
  queryKey: ['user', userId],
  queryFn: () => fetchUser(userId),
});
```

You get caching, deduplication, retries, and stale-while-revalidate for free.

## Forms

For simple forms, controlled inputs are fine:

```tsx
<input
  value={name}
  onChange={e => setName(e.target.value)}
/>
```

For anything with validation, multiple fields, or async submission, use **react-hook-form** + **zod** (or yup):

```tsx
const { register, handleSubmit, formState: { errors } } = useForm<UserForm>({
  resolver: zodResolver(userSchema),
});
```

## Performance

- Don't preemptively wrap everything in `memo` / `useMemo` / `useCallback`. Profile first; the cost of comparison can outweigh re-render cost.
- Use `key` correctly in lists — stable IDs, NOT array index, unless the list is truly static.
- For large lists, virtualize with `react-virtual` or `react-window`.

## Do / Don't

✅ Function components, hooks, typed props, cleanup in `useEffect`, library for data fetching, react-hook-form for non-trivial forms.

❌ Class components, untyped props (`any`), missing effect cleanup, mutating state directly, `useMemo` everywhere, `useEffect` for derived data, index as `key` in mutable lists.
