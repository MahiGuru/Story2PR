---
name: iiq-test-standards
description: Test coding standards for IIQ JS and Java tests. Loaded by Surgeon for all T-TC tasks and when task Layer = Test.
---

# IIQ Test Standards

## ⚠️ Angular 18 Testing Gap

The Angular 18 codebase (`web/ui/ts/`) currently has **NO `.spec.ts` files**. Test infrastructure (Karma + Jasmine) exists but no tests are written yet.

**If a task asks you to create the FIRST test for an Angular 18 module:**
1. Flag in the Change Manifest: `T{N}: First Angular 18 test for this codebase — verify Karma config picks it up`
2. Verify with: `cd tools && npx gulp tests` — should pick up new `.spec.ts` files automatically
3. If Karma doesn't find the test, the test runner config may need updating — flag this as a separate concern, don't fix during the task

**For all other Angular 18 tasks:** do NOT create `.spec.ts` files unless the LLD explicitly asks for them. Testing infrastructure setup is its own concern.

**For AngularJS (`web/ui/js/`) and Java tests:** test infrastructure is mature. Create tests as normal — see patterns below.

## JavaScript Tests (Jasmine)

### Test File Structure

```javascript
describe('DateValidationService', function() {

    var DateValidationService, $httpBackend, $rootScope;

    // Setup
    beforeEach(module('sailpoint.common'));

    beforeEach(inject(function(_DateValidationService_, _$httpBackend_, _$rootScope_) {
        DateValidationService = _DateValidationService_;
        $httpBackend = _$httpBackend_;
        $rootScope = _$rootScope_;
    }));

    afterEach(function() {
        $httpBackend.verifyNoOutstandingExpectation();
        $httpBackend.verifyNoOutstandingRequest();
    });

    // Tests grouped by method
    describe('validateDate()', function() {

        it('should return valid for ISO 8601 date', function() {
            var result = DateValidationService.validateDate('2024-01-15');
            expect(result.isValid).toBe(true);
        });

        it('should return invalid for null input', function() {
            var result = DateValidationService.validateDate(null);
            expect(result.isValid).toBe(false);
            expect(result.error).toBe('Date is required');
        });

        it('should return invalid for malformed date', function() {
            var result = DateValidationService.validateDate('not-a-date');
            expect(result.isValid).toBe(false);
        });
    });

    describe('isDateInRange()', function() {
        // ...
    });
});
```

### Mocking Patterns

```javascript
// Mock HTTP calls
$httpBackend.expectGET(SailPoint.CONTEXT_PATH + '/rest/ui/definitions')
    .respond(200, { objects: mockData, count: 2 });

// Trigger promise resolution
$httpBackend.flush();
$rootScope.$digest();

// Mock a service method
spyOn(FeatureService, 'getData').and.returnValue($q.resolve({ data: mockData }));

// Mock scope method
spyOn($scope, 'onSave');

// Verify call
expect(FeatureService.getData).toHaveBeenCalledWith('test-id');
expect($scope.onSave).toHaveBeenCalledTimes(1);
```

### Directive Tests

```javascript
describe('spDatePicker directive', function() {
    var element, $scope, $compile;

    beforeEach(inject(function(_$compile_, _$rootScope_) {
        $compile = _$compile_;
        $scope = _$rootScope_.$new();
    }));

    function createElement(attrs) {
        var html = '<sp-date-picker ' + (attrs || '') + '></sp-date-picker>';
        element = $compile(html)($scope);
        $scope.$digest();
        return element;
    }

    it('should render the date input', function() {
        createElement('sp-config="dateConfig"');
        expect(element.find('input').length).toBe(1);
    });

    afterEach(function() {
        if (element) {
            element.remove();
        }
    });
});
```

## Java Tests (TestNG + Mockito)

### Test Class Structure

```java
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import static org.testng.Assert.*;
import static org.mockito.Mockito.*;

public class MetadataValidationServiceTest {

    @Mock
    private SailPointContext mockContext;

    @Mock
    private Identity mockIdentity;

    private MetadataValidationService service;

    @BeforeMethod
    public void setUp() {
        MockitoAnnotations.initMocks(this);
        service = new MetadataValidationService(mockContext);
    }

    @Test
    public void testValidate_withValidInput_returnsResults() throws GeneralException {
        // Arrange
        when(mockContext.getObjectByName(Identity.class, "admin"))
            .thenReturn(mockIdentity);

        // Act
        List<ValidationResult> results = service.validate("test-id");

        // Assert
        assertNotNull(results);
        assertFalse(results.isEmpty());
        verify(mockContext).getObjectByName(Identity.class, "admin");
    }

    @Test(expectedExceptions = GeneralException.class)
    public void testValidate_withNullInput_throwsException() throws GeneralException {
        service.validate(null);
    }

    @Test
    public void testValidate_withEmptyInput_throwsException() throws GeneralException {
        try {
            service.validate("");
            fail("Expected GeneralException");
        } catch (GeneralException e) {
            assertEquals(e.getMessage(), "objectId is required");
        }
    }
}
```

### Test Naming Convention

```
test{MethodName}_{scenario}_{expectedResult}

testValidate_withValidInput_returnsResults
testValidate_withNullInput_throwsException
testGetDefinitions_withPagination_returnsPagedResults
testSave_withDuplicateName_returnsError
```

## General Test Rules

- **Arrange → Act → Assert** pattern in every test
- One assertion focus per test (multiple asserts OK if testing same concern)
- Test names describe the scenario, not the implementation
- Mock external dependencies (SailPointContext, HTTP, other services) — never hit real resources
- Clean up after each test (`afterEach` / `@AfterMethod`)
- Test edge cases: null, empty, boundary values, error conditions
- Don't test private methods directly — test through public API
- Test files mirror source structure: `web/ui/js/common/service/X.js` → `test/js/common/service/XTests.js`
