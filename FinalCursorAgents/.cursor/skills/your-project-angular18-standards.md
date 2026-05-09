---
name: your-project-angular18-standards
description: Angular 18 coding standards. Loaded by Surgeon when task Layer = Frontend/Angular18. Covers NgModule-based features, RxJS, NgRx, reactive forms, and the conventions an Angular 18 codebase typically settles on. SEPARATE from your-project-angular19-standards.md (standalone components, signals).
---

# Angular 18 Coding Standards

## Context

This skill covers an **Angular 18** frontend that uses **NgModule-based** feature organization. Angular 18 is the last major release before **standalone components became the default** in Angular 19; if your project has migrated to standalone, use `your-project-angular19-standards.md` instead.

Angular ≠ React. Don't reach for hooks, JSX, or Redux Toolkit. Use Angular's own primitives: components, services, modules, RxJS, and (when state warrants it) NgRx.

## Tech stack

| Area | Technology |
|------|------------|
| Framework | Angular 18.x (`@angular/core`, `forms`, `router`, `animations`) |
| Reactive | RxJS 7.x |
| State (optional) | NgRx 18.x |
| Forms | Reactive forms (`ReactiveFormsModule`) preferred over template-driven |
| HTTP | `HttpClient` with typed responses |
| Testing | Karma + Jasmine |
| Build | Angular CLI (`ng build`) |

## Component pattern

```typescript
import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-user-card',
  templateUrl: './user-card.component.html',
  styleUrls: ['./user-card.component.scss'],
})
export class UserCardComponent implements OnInit, OnDestroy {
  @Input() user!: User;          // required input — `!` definite assignment
  @Input() editable = false;
  @Output() save = new EventEmitter<User>();

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.userService.changes$
      .pipe(takeUntil(this.destroy$))
      .subscribe(u => this.user = u);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
```

**Rules:**
- Components are declared inside an NgModule (`declarations`). NOT standalone.
- Selectors use a kebab-case prefix (e.g. `app-`).
- Required inputs use `!` for definite assignment; optional inputs have defaults.
- Long-lived subscriptions use the `takeUntil(destroy$)` pattern.

## Service pattern

```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(private http: HttpClient) {}

  list(): Observable<User[]> {
    return this.http.get<User[]>('/api/users');
  }

  save(user: User): Observable<User> {
    return this.http.post<User>('/api/users', user);
  }
}
```

- Return Observables — never subscribe inside services.
- `providedIn: 'root'` for tree-shakable singletons. Register in module `providers` only when scope must be feature-local.

## Module pattern

```typescript
@NgModule({
  declarations: [UserCardComponent, UserListComponent],
  imports: [CommonModule, ReactiveFormsModule, RouterModule.forChild(routes)],
  providers: [UserService],
  exports: [UserCardComponent],
})
export class UsersModule {}
```

Every component, pipe, and directive MUST be in `declarations`. Forgetting this is the #1 source of "is not a known element" errors.

## Reactive forms

```typescript
this.form = this.fb.group({
  name:  ['', [Validators.required, Validators.minLength(2)]],
  email: ['', [Validators.required, Validators.email]],
});
```

Prefer reactive forms (`FormGroup`, `FormControl`) over `[(ngModel)]` for anything beyond a single input.

## RxJS

- `takeUntil(destroy$)` on every component-level subscription.
- `switchMap` for "cancel previous, take latest" (search, autocomplete).
- `combineLatest` for joining streams.
- Always handle errors with `catchError`.

## NgRx (only when warranted)

Add NgRx only when state is shared across many components or async flows are complex. For a single component fetching a list, a service + Subject is enough.

When you do use it, follow the four-file pattern: `*.actions.ts`, `*.reducer.ts`, `*.effects.ts`, `*.selectors.ts`. Action names: `[Feature] Verb Description`. Three actions per async op (`load`, `loadSuccess`, `loadFailure`). Effects always `catchError`.

## Do / Don't

✅ NgModule, `takeUntil(destroy$)`, typed `HttpClient` responses, kebab-case files, `Reactive` forms.

❌ Standalone components (that's Angular 19+), `templateUrl` if your toolchain doesn't support it, subscribing inside services, `any`, hardcoded user-facing strings.
