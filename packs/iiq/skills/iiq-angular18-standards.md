---
name: iiq-angular18-standards
description: Angular 18 coding standards for IIQ modern frontend (web/ui/ts/). Loaded by Surgeon when task Layer = Frontend/Angular18. This is SEPARATE from iiq-angularjs-standards.md which covers the legacy AngularJS 1.8 codebase in web/ui/js/.
---

# IIQ Angular 18 Coding Standards

## Context

This skill covers the **Angular 18** frontend at `web/ui/ts/` — built with **Gulp** and integrated via **Ant**. It coexists with legacy **AngularJS 1.8** (`web/ui/js/`) and uses **JSPM/SystemJS** for module loading.

**This is Angular, NOT React/Next.js.** Use Angular patterns and terminology.

**This is also NOT AngularJS 1.8.** If you find yourself reaching for `$scope`, `angular.module()`, or `.controller()` patterns — you're in the wrong file. Use `iiq-angularjs-standards.md` for legacy code in `web/ui/js/`.

## Tech Stack Reference

| Area | Technology | Version |
|------|------------|---------|
| Framework | Angular | ~18.2 (core, forms, router, animations, upgrade) |
| State Management | NgRx | ~18.1 (selectively used — see NgRx section) |
| Reactive | RxJS | ~7.8 |
| UI Libraries | Angular Material/CDK | ~15.2 (⚠️ behind core Angular) |
|  | ngx-bootstrap | ~8.0 |
|  | @siemens/ngx-datatable | ~21.6 |
|  | ngx-quill | ~26.0 |
|  | ECharts | 5.4.3 |
|  | flatpickr/ng2-flatpickr | ~4.6/~9.0 |
| i18n | @ngx-translate | ~14.0 |
| Styling | LESS | global themes in `tools/less/` |
| Testing | Karma + Jasmine | ⚠️ no `.spec.ts` files exist yet |

## Component Pattern

```typescript
import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, forwardRef } from '@angular/core';
import { NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

// Template imported via SystemJS !text plugin — NOT templateUrl
import template from './template/dropdown.component.html!text';

@Component({
    selector: 'sp-dropdown',           // ALWAYS prefix selectors with 'sp-'
    template,                          // Inline template from !text import
    providers: [                       // Common pattern for form controls
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => DropdownComponent),
            multi: true,
        },
    ],
})
export class DropdownComponent implements ControlValueAccessor, OnInit, OnDestroy {
    // Use sp- prefix on @Input/@Output binding names for consistency
    @Input('spOptions') options!: DropdownOption[];
    @Input('spDisabled') disabled: boolean = false;
    @Output('spOnSelect') onSelect = new EventEmitter<DropdownOption>();

    private destroy$ = new Subject<void>();

    ngOnInit(): void {
        // Subscribe with takeUntil pattern for auto-cleanup
        this.someService.getData()
            .pipe(takeUntil(this.destroy$))
            .subscribe(data => this.handleData(data));
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }
}
```

**Key rules:**
- **NgModule-based** — NOT standalone components. Register everything in module `declarations`.
- **`sp-` prefix** on all component selectors (e.g., `sp-dropdown`, `sp-datatable`)
- **Template imports via `!text` plugin** — never `templateUrl`
- **Use `!` for required inputs**: `@Input() requiredValue!: string`
- **destroy$ Subject pattern** for unsubscribing — use `takeUntil(this.destroy$)` on every long-lived subscription
- **Form controls** implement `ControlValueAccessor` with `NG_VALUE_ACCESSOR` provider

## Service Pattern

```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable()  // Register in module providers — NOT providedIn: 'root'
export class ApplicationDefinitionService {
    constructor(private http: HttpClient) {}

    // Return Observables — let components handle subscription
    getData(): Observable<ApplicationData> {
        return this.http.get<ApplicationData>('/api/data');
    }

    saveData(data: ApplicationData): Observable<ApplicationData> {
        return this.http.post<ApplicationData>('/api/data', data);
    }
}
```

**Key rules:**
- **Register in module `providers`** — NOT `providedIn: 'root'` (codebase convention)
- **Return Observables** from service methods — never subscribe inside services
- **Components subscribe**, services emit
- **HttpClient** for all HTTP — typed responses with generics

## Module Structure

All features use **NgModule** pattern (not standalone):

```typescript
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { StoreModule } from '@ngrx/store';
import { EffectsModule } from '@ngrx/effects';

import { ApplicationDefinitionComponent } from './components/application-definition.component';
import { ReconfigureModalComponent } from './components/reconfigure-modal.component';
import { ApplicationDefinitionService } from './services/application-definition.service';
import { applicationDefinitionReducer } from './store/application-definition.reducer';
import { ApplicationDefinitionEffects } from './store/application-definition.effects';

@NgModule({
    declarations: [
        ApplicationDefinitionComponent,
        ReconfigureModalComponent,
        // ... ALL components, pipes, directives must be declared here
    ],
    imports: [
        CommonModule,
        FormsModule,
        ReactiveFormsModule,
        StoreModule.forFeature('applicationDefinition', applicationDefinitionReducer),
        EffectsModule.forFeature([ApplicationDefinitionEffects]),
        // ... other Angular and feature modules
    ],
    providers: [
        ApplicationDefinitionService,
        // ... feature services
    ],
})
export class ApplicationDefinitionModule {}
```

**Key rules:**
- Every component, pipe, directive MUST be in `declarations`
- Every feature service MUST be in `providers`
- NgRx feature modules use `StoreModule.forFeature()` and `EffectsModule.forFeature()`
- Import order: Angular core → Angular common → third-party → feature

## TypeScript Guidelines

```typescript
// Strict mode is enabled in tsconfig.json — respect it

// USE explicit types — avoid `any`
interface UserProfile {
    id: string;
    name: string;
    email: string;
}

const profile: UserProfile = await this.userService.getProfile();

// Required inputs use `!`
@Input() requiredValue!: string;

// Optional inputs have defaults
@Input() pageSize: number = 12;

// Import types from interfaces folder
import { ApplicationData } from './interfaces/application-data.interface';

// AVOID
const data: any = response;  // ❌ no `any`
for (const key in obj) { }   // ❌ ESLint forbids for...in
if (cond) doSomething();      // ❌ always use curly braces
```

## RxJS Patterns

```typescript
import { Observable, Subject, BehaviorSubject, combineLatest } from 'rxjs';
import { takeUntil, map, filter, switchMap, catchError } from 'rxjs/operators';

export class FeatureComponent implements OnInit, OnDestroy {
    private destroy$ = new Subject<void>();

    // BehaviorSubject for stateful streams (has current value)
    private filterSubject$ = new BehaviorSubject<string>('');

    ngOnInit(): void {
        // Combine multiple streams
        combineLatest([
            this.dataService.getData(),
            this.filterSubject$
        ]).pipe(
            map(([data, filter]) => this.applyFilter(data, filter)),
            takeUntil(this.destroy$)  // ALWAYS use takeUntil for component subscriptions
        ).subscribe(filtered => {
            this.items = filtered;
        });

        // Switch to new request when input changes (cancel previous)
        this.searchInput$.pipe(
            switchMap(query => this.searchService.search(query)),
            catchError(err => {
                console.error('Search failed', err);
                return of([]);
            }),
            takeUntil(this.destroy$)
        ).subscribe(results => this.results = results);
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }
}
```

**Key rules:**
- **Always use `takeUntil(this.destroy$)`** on component subscriptions
- **Use `switchMap`** for "cancel previous, use latest" (search, autocomplete)
- **Use `mergeMap`** when all results matter (parallel requests)
- **Always handle errors** with `catchError`
- **BehaviorSubject** for stateful streams, **Subject** for event streams

## NgRx (Selectively Used)

NgRx is used in some features (e.g., `applicationDefinition/`) but not all. Only add NgRx if the feature module already uses it OR if state complexity genuinely requires it.

### When to use NgRx

| Use NgRx when | Skip NgRx when |
|---------------|---------------|
| State shared across many components | Local component state |
| Complex async flows with side effects | Simple HTTP request → display |
| Need time-travel debugging | Small feature with 1-2 components |
| Existing feature already uses it | Can use service + Subject |

### Action Pattern

```typescript
import { createAction, props } from '@ngrx/store';
import { ApplicationData } from '../interfaces/application-data.interface';

export const loadApplications = createAction(
    '[Application Definition] Load Applications'
);

export const loadApplicationsSuccess = createAction(
    '[Application Definition] Load Applications Success',
    props<{ applications: ApplicationData[] }>()
);

export const loadApplicationsFailure = createAction(
    '[Application Definition] Load Applications Failure',
    props<{ error: string }>()
);
```

### Reducer Pattern

```typescript
import { createReducer, on } from '@ngrx/store';
import * as AppActions from './application-definition.actions';

export interface ApplicationDefinitionState {
    applications: ApplicationData[];
    loading: boolean;
    error: string | null;
}

export const initialState: ApplicationDefinitionState = {
    applications: [],
    loading: false,
    error: null,
};

export const applicationDefinitionReducer = createReducer(
    initialState,
    on(AppActions.loadApplications, (state) => ({
        ...state,
        loading: true,
        error: null,
    })),
    on(AppActions.loadApplicationsSuccess, (state, { applications }) => ({
        ...state,
        applications,
        loading: false,
    })),
    on(AppActions.loadApplicationsFailure, (state, { error }) => ({
        ...state,
        loading: false,
        error,
    })),
);
```

### Effects Pattern

```typescript
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';

import * as AppActions from './application-definition.actions';
import { ApplicationDefinitionService } from '../services/application-definition.service';

@Injectable()
export class ApplicationDefinitionEffects {
    loadApplications$ = createEffect(() =>
        this.actions$.pipe(
            ofType(AppActions.loadApplications),
            switchMap(() =>
                this.service.getData().pipe(
                    map(applications => AppActions.loadApplicationsSuccess({ applications })),
                    catchError(error => of(AppActions.loadApplicationsFailure({ error: error.message })))
                )
            )
        )
    );

    constructor(
        private actions$: Actions,
        private service: ApplicationDefinitionService
    ) {}
}
```

### Selector Pattern

```typescript
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { ApplicationDefinitionState } from './application-definition.reducer';

export const selectApplicationDefinitionState =
    createFeatureSelector<ApplicationDefinitionState>('applicationDefinition');

export const selectAllApplications = createSelector(
    selectApplicationDefinitionState,
    (state) => state.applications
);

export const selectIsLoading = createSelector(
    selectApplicationDefinitionState,
    (state) => state.loading
);
```

**NgRx rules:**
- **Action naming:** `[Feature] Verb Description` — e.g., `[Application Definition] Load Applications`
- **Three actions per async op:** `loadX`, `loadXSuccess`, `loadXFailure`
- **Selectors are pure** — no side effects, just transformations
- **Effects handle async** — components dispatch actions, effects do the work
- **Always handle failure** — every effect needs `catchError`

## Internationalization

```typescript
import { TranslateService } from '@ngx-translate/core';

@Component({...})
export class FeatureComponent {
    constructor(private translate: TranslateService) {}

    showMessage(): void {
        const message = this.translate.instant('ui_feature_save_success');
        // ...
    }
}
```

```html
<!-- In templates use the translate pipe -->
<h2>{{ 'ui_feature_title' | translate }}</h2>
<button>{{ 'ui_feature_save' | translate }}</button>

<!-- With parameters -->
<p>{{ 'ui_feature_welcome' | translate: {name: userName} }}</p>
```

**Never hardcode user-facing text.** Always use translation keys.

## Common Pitfalls

1. **Path confusion** — modern Angular is in `web/ui/ts/`, legacy AngularJS is in `web/ui/js/`. Don't mix them.
2. **Template loading** — use `!text` plugin imports, NOT `templateUrl`. Example: `import template from './template/comp.html!text'`
3. **Module registration** — every component, pipe, directive must be declared in a module. Forgetting this causes runtime "is not a known element" errors.
4. **Build modes** — use `ant ui-build -Dui.development=true` for faster development builds. Production builds are slower.
5. **Legacy confusion** — don't apply AngularJS 1.8 patterns (`$scope`, `angular.module`) to Angular 18 code. They're completely different frameworks.
6. **`templateUrl`** — IIQ uses `template` with `!text` imports because of SystemJS. `templateUrl` doesn't work the same way here.
7. **`providedIn: 'root'`** — codebase convention is to register in module `providers`, not at the service level.

## Do / Don't

### ✅ Do
- Follow Angular patterns — use NgModule, NOT standalone components
- Use `sp-` prefix for all component selectors
- Import templates via `!text` plugin
- Keep kebab-case filenames (ESLint enforced)
- Use TypeScript strict mode — explicit types
- Follow NgRx patterns where the feature already uses it
- Register everything in module `declarations`/`providers`/`imports`
- Use `takeUntil(this.destroy$)` for subscription cleanup
- Return Observables from services
- Study `applicationDefinition/` as a reference for complete feature modules

### ❌ Don't
- Don't use React/Next.js patterns — this is Angular
- Don't use standalone components — use NgModules for consistency
- Don't use `templateUrl` — use template imports via `!text` plugin
- Don't use `for...in` loops — ESLint forbids them
- Don't skip `curly` braces — always use them for control flow
- Don't subscribe in services — return Observables, let components subscribe
- Don't use `any` types without good reason
- Don't apply AngularJS 1.8 patterns — wrong framework
- Don't create `.spec.ts` files yet — testing infrastructure needs setup first (see iiq-test-standards.md)

## Reference Module

When in doubt about how to structure something, study the **`applicationDefinition/`** feature module — it's a complete example with:
- Components (including modals)
- Services with HttpClient
- NgRx store, actions, reducers, effects, selectors
- Interfaces in dedicated `interfaces/` folder
- Template files in `template/` subfolders
