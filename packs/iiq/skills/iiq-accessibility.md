---
name: iiq-accessibility
description: ARIA and accessibility standards for IIQ UI components. Loaded by Surgeon when task touches interactive UI elements or has ARIA/a11y in scope.
---

# IIQ Accessibility Standards

## Interactive Elements

Every interactive element MUST have an accessible name. Test with: "Can a screen reader tell the user what this element is and what it does?"

```html
<!-- Buttons — text content is the accessible name -->
<button ng-click="save()">#{msgs.ui_feature_save}</button>

<!-- Icon-only buttons — need aria-label -->
<button ng-click="delete(item)" aria-label="{{spTranslate('ui_feature_delete_item', item.name)}}">
    <i class="fa fa-trash"></i>
</button>

<!-- Links — text content is the accessible name -->
<a href="#" ng-click="viewDetails(item)">{{item.name}}</a>

<!-- NEVER empty links/buttons -->
<!-- BAD --><a href="#" ng-click="action()"></a>
<!-- GOOD --><a href="#" ng-click="action()" aria-label="View details">...</a>
```

## Form Inputs

```html
<!-- Every input needs a label -->
<label for="certName">#{msgs.ui_cert_name_label}</label>
<input type="text" id="certName" name="certName" ng-model="cert.name"
       aria-required="true"
       aria-describedby="certNameHelp certNameError" />

<!-- Help text linked via aria-describedby -->
<span id="certNameHelp" class="help-text">
    #{msgs.ui_cert_name_help}
</span>

<!-- Error message linked and announced -->
<span id="certNameError" role="alert"
      ng-show="form.certName.$invalid && form.certName.$touched">
    {{spTranslate('ui_cert_name_required')}}
</span>
```

**Rules:**
- `id` + `for` pairing on every label/input
- `aria-required="true"` on required fields
- `aria-describedby` linking to help text AND error messages (space-separated IDs)
- `role="alert"` on error messages — screen readers announce them automatically

## Dynamic Content

```html
<!-- Live region for async updates (search results, notifications) -->
<div aria-live="polite" aria-atomic="true">
    <span ng-if="searchResults">
        {{searchResults.length}} {{spTranslate('ui_results_found')}}
    </span>
</div>

<!-- Loading states -->
<div ng-if="isLoading" role="status" aria-live="polite">
    #{msgs.ui_loading}
</div>

<!-- Use aria-live="polite" for non-urgent updates -->
<!-- Use aria-live="assertive" ONLY for critical errors -->
```

## Keyboard Navigation

```javascript
// All custom interactive components must be keyboard-operable

// Directive link function — add keyboard support
link: function(scope, element, attrs) {
    // Make non-native elements focusable
    element.attr('tabindex', '0');
    element.attr('role', 'button');

    // Handle Enter and Space (button convention)
    element.on('keydown', function(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            scope.$apply(function() {
                scope.activate();
            });
        }
    });

    // Handle Escape for dismissable elements (modals, dropdowns)
    element.on('keydown', function(event) {
        if (event.key === 'Escape') {
            scope.$apply(function() {
                scope.close();
            });
        }
    });
}
```

## Focus Management

```javascript
// After opening a modal — move focus to first interactive element
spModal.open({...}).then(function() {
    $timeout(function() {
        angular.element('#modalFirstInput').focus();
    });
});

// After closing a modal — return focus to trigger element
var triggerElement = document.activeElement;
spModal.open({...}).finally(function() {
    $timeout(function() {
        triggerElement.focus();
    });
});

// After dynamic content load — announce to screen readers, don't steal focus
```

## ARIA Roles for IIQ Components

| Component | Role | Notes |
|-----------|------|-------|
| Tab panel | `role="tablist"`, `role="tab"`, `role="tabpanel"` | `aria-selected` on active tab |
| Grid/table | `role="grid"` or native `<table>` | `aria-sort` on sortable columns |
| Dialog/modal | `role="dialog"`, `aria-modal="true"` | `aria-labelledby` pointing to title |
| Alert/notification | `role="alert"` | Auto-announced by screen readers |
| Search results | `role="status"` + `aria-live="polite"` | Announce count changes |
| Menu/dropdown | `role="menu"`, `role="menuitem"` | Arrow key navigation |
| Progress | `role="progressbar"`, `aria-valuenow` | Update dynamically |

## Checklist (Surgeon Post-Verification Step 5)

Before marking a UI task DONE, verify:
- [ ] All interactive elements have accessible names (text content, aria-label, or aria-labelledby)
- [ ] All form inputs have labels (for/id pairing)
- [ ] Error messages use `role="alert"`
- [ ] Dynamic content has `aria-live` regions
- [ ] Custom interactive elements are keyboard-operable (Enter, Space, Escape)
- [ ] Focus is managed after modal open/close and dynamic content load
- [ ] No keyboard traps (user can Tab/Shift+Tab through all elements)
