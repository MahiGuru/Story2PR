---
name: your-project-vue3-standards
description: Vue 3 coding standards for codebases using the Composition API and `<script setup>`. Loaded by Surgeon when task Layer = Frontend/Vue. Covers ref/reactive/computed/watch, defineProps/defineEmits, Pinia stores, and SFC conventions. NOT for Vue 2 (Options API + this).
---

# Vue 3 Coding Standards

## Context

This skill covers a **Vue 3** codebase using the **Composition API** with `<script setup>` syntax — the modern default since Vue 3.2. Options API (`data()`, `methods`, `computed:`) is legacy; do not write new components in it.

Vue ≠ React. Reactivity is fine-grained and observable, not snapshot-and-rerender. You **do not** call setters; you mutate the reactive value (`count.value++`). Templates are HTML, not JSX.

## Tech stack

| Area | Technology |
|------|------------|
| Framework | Vue 3.4+ |
| Components | Single-File Components (`.vue`) with `<script setup lang="ts">` |
| Reactivity | `ref`, `reactive`, `computed`, `watch`, `watchEffect` |
| State (cross-tree) | Pinia (NOT Vuex — Vuex is legacy) |
| Routing | Vue Router 4+ |
| Forms | VeeValidate or hand-rolled with `ref` |
| Build | Vite |
| Testing | Vitest + Vue Test Utils |

## Component pattern (`<script setup>`)

```vue
<script setup lang="ts">
import { ref, computed, watch } from 'vue';

interface Props {
  user: User;
  editable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  editable: false,
});

const emit = defineEmits<{
  save: [user: User];
  cancel: [];
}>();

const isEditing = ref(false);
const fullName  = computed(() => `${props.user.firstName} ${props.user.lastName}`);

watch(() => props.user.id, () => {
  isEditing.value = false;   // reset edit mode when user changes
});

function startEdit() {
  isEditing.value = true;
}

function handleSave(updated: User) {
  emit('save', updated);
  isEditing.value = false;
}
</script>

<template>
  <article class="user-card">
    <h2>{{ fullName }}</h2>
    <button v-if="editable && !isEditing" @click="startEdit">Edit</button>
    <UserEditForm
      v-if="isEditing"
      :user="user"
      @submit="handleSave"
      @cancel="emit('cancel')"
    />
  </article>
</template>

<style scoped>
.user-card { padding: 1rem; }
</style>
```

**Rules:**
- `<script setup>` is the default — typed props via `defineProps<Props>()`, typed emits via `defineEmits<...>()`.
- `withDefaults` for optional props with defaults.
- `<style scoped>` keeps styles component-local (compiles to attribute selectors).
- `ref()` for primitives, `reactive()` for objects you'll mutate. Pick one and stay there for the lifetime of the variable.

## ref vs reactive

```typescript
const count = ref(0);          // primitive — must be ref
count.value++;

const state = reactive({       // object — reactive() works without .value
  count: 0,
  name: '',
});
state.count++;
```

**When in doubt, prefer `ref`.** It's consistent (always `.value` in script, auto-unwrapped in template) and survives reassignment.

## Computed and watch

```typescript
const total = computed(() => items.value.reduce((sum, i) => sum + i.price, 0));

// Single source — function-style getter
watch(() => props.userId, async (newId, oldId) => {
  user.value = await fetchUser(newId);
});

// Multiple sources
watch([itemA, itemB], ([a, b]) => { /* ... */ });

// Auto-collected dependencies — useful for ad-hoc logging/analytics
watchEffect(() => {
  console.log('Count is', count.value);
});
```

`computed` for derived values. `watch` when you need the previous value or want lazy evaluation. `watchEffect` only when you don't care about the previous value.

## Pinia

```typescript
// stores/user.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useUserStore = defineStore('user', () => {
  const users = ref<User[]>([]);
  const isLoading = ref(false);

  const activeUsers = computed(() => users.value.filter(u => u.active));

  async function load() {
    isLoading.value = true;
    users.value = await fetchUsers();
    isLoading.value = false;
  }

  return { users, isLoading, activeUsers, load };
});
```

Use the **setup-style** Pinia store (above) — same primitives as components, no extra concepts to learn. Avoid the options-style store for new code.

## Composables

Reusable logic goes in a `useFoo()` composable, not a mixin (mixins are gone in Vue 3 — good riddance):

```typescript
// composables/useDebounced.ts
export function useDebounced<T>(source: Ref<T>, ms = 300): Ref<T> {
  const debounced = ref(source.value) as Ref<T>;
  let timer: ReturnType<typeof setTimeout>;
  watch(source, val => {
    clearTimeout(timer);
    timer = setTimeout(() => { debounced.value = val; }, ms);
  });
  return debounced;
}
```

## Do / Don't

✅ `<script setup>`, Composition API, `defineProps<...>()` / `defineEmits<...>()`, Pinia (setup style), composables for shared logic, `<style scoped>`.

❌ Options API (`data() { return {...} }`) for new components, Vuex (use Pinia), mixins, `this.$emit` (you're not in Options API), forgetting `.value` on refs in `<script>`.
