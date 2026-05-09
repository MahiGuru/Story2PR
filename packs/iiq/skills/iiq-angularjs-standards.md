---
name: iiq-angularjs-standards
description: AngularJS coding standards for IIQ frontend code. Loaded by Surgeon when task Layer = Frontend/AngularJS or Full-stack.
---

# IIQ AngularJS Coding Standards

## Controller Pattern

IIQ uses `$scope` (NOT `controllerAs`). Follow this structure:

```javascript
angular.module('sailpoint.{feature}').controller('FeatureNameCtrl',
    ['$scope', '$q', 'FeatureService', 'spNotificationService',
    function($scope, $q, FeatureService, spNotificationService) {

    ////////////////////////////////////////////////////////////
    // Scope variables
    ////////////////////////////////////////////////////////////
    $scope.isLoading = false;
    $scope.items = [];
    $scope.selectedItem = null;

    ////////////////////////////////////////////////////////////
    // Scope functions
    ////////////////////////////////////////////////////////////
    $scope.loadItems = function() {
        $scope.isLoading = true;
        FeatureService.getItems().then(function(result) {
            $scope.items = result.data;
        }).catch(function(error) {
            spNotificationService.addNotification(
                spTranslate('ui_feature_load_error'), true
            );
        }).finally(function() {
            $scope.isLoading = false;
        });
    };

    ////////////////////////////////////////////////////////////
    // Init
    ////////////////////////////////////////////////////////////
    $scope.loadItems();
}]);
```

**Key rules:**
- Array-style DI annotation (minification-safe) — NEVER bare function params
- `$scope.functionName = function()` — not `this.functionName`
- Group: variables → functions → init. Separate with comment blocks.
- Error handling: always `.catch()` on promises, show user-facing notification via `spNotificationService`

## Directive Pattern

```javascript
function spFeatureWidget() {
    return {
        restrict: 'E',
        scope: {
            config: '=spConfig',
            onSave: '&spOnSave'
        },
        templateUrl: 'ui/js/common/directive/spFeatureWidget.html',
        link: function(scope, element, attrs) {
            // DOM manipulation only — no business logic here
            scope.$on('$destroy', function() {
                // Clean up listeners, timers, DOM refs
            });
        },
        controller: ['$scope', function($scope) {
            // Business logic here, not in link
        }]
    };
}
```

**Key rules:**
- `restrict: 'E'` for component directives, `'A'` for behavioral directives
- Isolate scope (`scope: {}`) for reusable directives, inherited scope for feature-specific
- Prefix shared directives with `sp` — `spDatePicker`, `spColumnData`
- Always clean up in `$destroy` — remove event listeners, cancel `$timeout`, unbind DOM events
- Business logic in `controller`, DOM manipulation in `link`

## Service/Factory Pattern

```javascript
angular.module('sailpoint.common').factory('DateValidationService',
    ['$http', '$q',
    function($http, $q) {

    var service = {
        validateDate: validateDate,
        isDateInRange: isDateInRange
    };

    return service;

    ////////////////////////////////////////////////////////////

    function validateDate(dateString) {
        if (!dateString) {
            return $q.reject('Date is required');
        }
        // validation logic
    }

    function isDateInRange(date, min, max) {
        return date >= min && date <= max;
    }
}]);
```

**Key rules:**
- Use `factory` (not `service`) for most cases — IIQ convention
- Reveal module pattern: define public API object at top, implementations below
- Null-check inputs before processing
- Return `$q` promises for async operations, not raw `$http` promises

## Promise Handling

```javascript
// CORRECT — IIQ pattern
FeatureService.getData()
    .then(function(result) {
        $scope.data = result.data;
        return FeatureService.getRelatedData(result.data.id);
    })
    .then(function(related) {
        $scope.relatedData = related.data;
    })
    .catch(function(error) {
        spNotificationService.addNotification(
            spTranslate('ui_feature_error'), true
        );
    })
    .finally(function() {
        $scope.isLoading = false;
    });

// WRONG — nested promises
FeatureService.getData().then(function(result) {
    FeatureService.getRelatedData(result.data.id).then(function(related) {
        // nested hell — don't do this
    });
});
```

## Event Handling

```javascript
// Emit upward (child → parent)
$scope.$emit('feature:itemSelected', { id: item.id });

// Broadcast downward (parent → children)
$scope.$broadcast('feature:refreshList');

// Listen — ALWAYS deregister
var deregister = $scope.$on('feature:itemSelected', function(event, data) {
    $scope.selectedId = data.id;
});
$scope.$on('$destroy', deregister);
```

## Digest Cycle Awareness

```javascript
// Use $timeout for post-digest DOM updates
$timeout(function() {
    element.focus();
});

// Use $apply ONLY when updating scope from outside Angular
// (jQuery events, WebSocket callbacks, etc.)
element.on('click', function() {
    $scope.$apply(function() {
        $scope.clicked = true;
    });
});

// NEVER use $apply inside Angular code — it causes $digest errors
```

## IIQ-Specific Patterns

- `spTranslate('key')` for all user-facing strings — never hardcode text
- `spNotificationService.addNotification(message, isError)` for notifications
- `spModal.open({...})` for modal dialogs
- `spPager` for paginated lists
- `SailPointHelp.getHelpUrl()` for help links

## Null Safety

```javascript
// Always null-check before accessing nested properties
if (item && item.attributes && item.attributes.date) {
    $scope.date = item.attributes.date;
}

// Use angular.isDefined() / angular.isUndefined()
if (angular.isDefined($scope.config)) { ... }

// Default values
$scope.pageSize = $scope.pageSize || 12;
```
