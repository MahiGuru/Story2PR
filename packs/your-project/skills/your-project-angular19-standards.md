---
name: your-project-angular19-standards
description: Angular 19 coding standards. Loaded by Surgeon when task Layer = Frontend/Angular19. Covers standalone components, signals, the new control-flow syntax (@if/@for/@switch), inject() function, and zoneless change detection. SEPARATE from your-project-angular18-standards.md (NgModule + RxJS-only).
---

# Angular 19 Coding Standards

## Context

This skill covers a **modern Angular 19** frontend that uses the patterns Angular has settled on as defaults: **standalone components** (no NgModule), **signals** for fine-grained reactivity, the **new control-flow syntax** (`@if`, `@for`, `@switch`), the `inject()` function instead of constructor DI, and optional **zoneless change detection**.

If your project still uses NgModule + RxJS-only state, use `your-project-angular18-standards.md` instead — they are not interchangeable.

## Tech stack

| Area | Technology |
|------|------------|
| Framework | Angular 19.x |
| Components | Standalone (default since Angular 19) |
| Reactivity | Signals (`signal`, `computed`, `effect`) + RxJS where streams are needed |
| Forms | Typed reactive forms |
| Control flow | `@if`, `@for`, `@switch` (NOT `*ngIf` / `*ngFor`) |
| DI | `inject()` function, `providedIn: 'root'` |
| Change detection | Zoneless optional (`provideExperimentalZonelessChangeDetection()`) |
| Testing | Karma + Jasmine, or Vitest + Testing Library |

## Component pattern

```typescript
import { Component, signal, computed, input, output, inject } from '@angular/core';
import { UserService } from './user.service';

@Component({
  selector: 'app-user-card',
  standalone: true,
  imports: [CommonModule, RouterLink],   // declare what the template uses
  templateUrl: './user-card.component.html',
})
export class UserCardComponent {
  private userService = inject(UserService);   // inject() over constructor

  // Signal-based inputs and outputs (Angular 17.1+)
  user     = input.required<User>();
  editable = input(false);
  save     = output<User>();

  // Local state as a signal
  private isDirty = signal(false);

  // Derived state — recomputes only when its inputs change
  displayName = computed(() => `${this.user().firstName} ${this.user().lastName}`);

  onEdit(updated: User): void {
    this.isDirty.set(true);
    this.save.emit(updated);
  }
}
```

**Rules:**
- `standalone: true` is the default — do NOT register the component in a module.
- Use `input()` / `output()` signal APIs over `@Input()` / `@Output()` decorators in new code.
- Use `inject()` over constructor parameter injection — it composes better with class fields and avoids `super()` boilerplate.
- Use `signal()` for local state, `computed()` for derived state, `effect()` for side effects.

## Template — new control flow

```html
@if (user(); as u) {
  <h2>{{ u.name }}</h2>

  @for (role of u.roles; track role.id) {
    <span class="role">{{ role.label }}</span>
  } @empty {
    <span class="muted">No roles assigned</span>
  }
} @else {
  <p>Loading...</p>
}

@switch (status()) {
  @case ('active')   { <span class="green">Active</span> }
  @case ('inactive') { <span class="grey">Inactive</span> }
  @default           { <span>Unknown</span> }
}
```

`*ngIf`, `*ngFor`, `*ngSwitch` still work but are deprecated patterns for new code. The new control flow is part of the template compiler — no module imports needed.

## Service pattern

```typescript
import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);

  // Service-level signal state is fine for shared client-side cache
  private _users = signal<User[]>([]);
  readonly users = this._users.asReadonly();

  async load(): Promise<void> {
    const list = await firstValueFrom(this.http.get<User[]>('/api/users'));
    this._users.set(list);
  }
}
```

- Expose signals as readonly via `.asReadonly()` so consumers can read but not mutate.
- `firstValueFrom` is the modern bridge from Observable to Promise (preferred over `.toPromise()`, which is deprecated).

## Routing

```typescript
export const routes: Routes = [
  {
    path: 'users',
    loadComponent: () => import('./users/user-list.component').then(m => m.UserListComponent),
  },
  {
    path: 'users/:id',
    loadComponent: () => import('./users/user-detail.component').then(m => m.UserDetailComponent),
  },
];
```

`loadComponent` for standalone routes — no `loadChildren` + module needed.

## Forms

```typescript
this.form = this.fb.group({
  name:  this.fb.nonNullable.control('', [Validators.required]),
  email: this.fb.nonNullable.control('', [Validators.required, Validators.email]),
});
```

Use `nonNullable` form controls for cleaner type narrowing in templates.

## Signals vs RxJS

| Use signals when | Use RxJS when |
|------------------|---------------|
| Synchronous derived state | Streams over time (HTTP, websockets) |
| Component-local UI state | Cancellation, retry, complex composition |
| Service-level cache | Backpressure, debouncing |

Bridge with `toSignal()` and `toObservable()` from `@angular/core/rxjs-interop`.

## Do / Don't

✅ Standalone components, `input()`/`output()`/`signal()`, `inject()`, `@if`/`@for`/`@switch`, `loadComponent` for routes, signals for local state.

❌ NgModule for new features, `*ngIf`/`*ngFor` in new templates, constructor DI in new code, `.toPromise()`, `Subject` where a `signal()` would do.
