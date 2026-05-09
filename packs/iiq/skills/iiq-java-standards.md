---
name: iiq-java-standards
description: Java coding standards for IIQ backend code. Loaded by Surgeon when task Layer = Backend/Java, Backend/REST, or Full-stack.
---

# IIQ Java Coding Standards

## Class Structure

Follow this order within every class:

```java
package sailpoint.service;

// 1. Imports (ordered: java → javax → sailpoint.api/object → sailpoint.service/web → static)
import java.util.List;
import java.util.Map;
import java.util.ArrayList;

import sailpoint.api.SailPointContext;
import sailpoint.object.Identity;
import sailpoint.object.QueryOptions;

import sailpoint.tools.GeneralException;
import sailpoint.tools.Util;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;

public class MetadataValidationService {

    // 2. Constants
    private static final Log log = LogFactory.getLog(MetadataValidationService.class);
    private static final int MAX_RESULTS = 100;

    // 3. Instance fields
    private SailPointContext context;
    private String identityName;

    // 4. Constructor
    public MetadataValidationService(SailPointContext context) {
        this.context = context;
    }

    // 5. Public methods
    public List<ValidationResult> validate(String objectId) throws GeneralException {
        if (Util.isNullOrEmpty(objectId)) {
            throw new GeneralException("objectId is required");
        }
        // implementation
    }

    // 6. Private/helper methods
    private boolean isValid(String value) {
        return Util.isNotNullOrEmpty(value);
    }
}
```

## Null Handling — IIQ Patterns

```java
// USE SailPoint's Util class — NOT manual null checks
import sailpoint.tools.Util;

// String null/empty check
if (Util.isNullOrEmpty(value)) { ... }
if (Util.isNotNullOrEmpty(value)) { ... }

// Collection null/empty check
if (Util.isEmpty(list)) { ... }
if (Util.size(list) > 0) { ... }  // null-safe size

// Null-safe string comparison
if (Util.nullSafeEq(str1, str2)) { ... }

// Null-safe CSV parsing
List<String> items = Util.csvToList(csvString);  // returns empty list if null

// AVOID
if (value != null && !value.isEmpty()) { ... }  // use Util instead
if (list != null && list.size() > 0) { ... }    // use Util instead
```

## Exception Handling

```java
// CORRECT — IIQ pattern: catch, log, wrap in GeneralException
public void processIdentity(String identityName) throws GeneralException {
    try {
        Identity identity = context.getObjectByName(Identity.class, identityName);
        if (identity == null) {
            throw new GeneralException("Identity not found: " + identityName);
        }
        // process
    } catch (GeneralException ge) {
        throw ge;  // don't double-wrap GeneralException
    } catch (Exception e) {
        log.error("Error processing identity: " + identityName, e);
        throw new GeneralException("Failed to process identity", e);
    }
}

// NEVER silently swallow exceptions
try { ... }
catch (Exception e) { }  // NEVER — always log or rethrow
```

## Logging

```java
// Use Apache Commons Logging (IIQ standard)
private static final Log log = LogFactory.getLog(ClassName.class);

// Debug — for development tracing (include method context)
log.debug("validateMetadata: Processing object " + objectId);

// Info — for significant business events
log.info("Metadata validation completed for " + identityName + ": " + resultCount + " results");

// Warn — for recoverable issues
log.warn("Metadata definition not found for type: " + type + ", using default");

// Error — for failures (always include exception)
log.error("Failed to validate metadata for " + objectId, exception);

// ALWAYS check debug level before string concatenation in hot paths
if (log.isDebugEnabled()) {
    log.debug("Processing items: " + items.toString());
}
```

## SailPoint API Usage

```java
// Query with QueryOptions
QueryOptions qo = new QueryOptions();
qo.addFilter(Filter.eq("name", objectName));
qo.setResultLimit(MAX_RESULTS);
qo.addOrdering("name", true);  // ascending

List<Identity> results = context.getObjects(Identity.class, qo);

// Get single object
Identity identity = context.getObjectByName(Identity.class, identityName);
Identity identity = context.getObjectById(Identity.class, identityId);

// Search with projection (performance — don't load full objects)
List<String> props = Arrays.asList("id", "name", "displayName");
Iterator<Object[]> it = context.search(Identity.class, qo, props);

// ALWAYS close iterators
try {
    while (it.hasNext()) {
        Object[] row = it.next();
        // process
    }
} finally {
    Util.flushIterator(it);
}
```

## Method Design

```java
// Methods should be small and focused
// Max ~30 lines per method — extract helpers for complex logic

// Return early for guard clauses
public ValidationResult validate(String input) throws GeneralException {
    if (Util.isNullOrEmpty(input)) {
        return ValidationResult.empty();
    }

    if (!isValidFormat(input)) {
        return ValidationResult.error("Invalid format");
    }

    // main logic only reached after guards pass
    return doValidation(input);
}

// Use meaningful parameter names
// GOOD: validateDate(String dateString, String format, boolean allowFuture)
// BAD:  validateDate(String s, String f, boolean b)
```

## Thread Safety

```java
// SailPointContext is NOT thread-safe — never share across threads
// Each thread needs its own context:
SailPointContext threadContext = SailPointFactory.createContext();
try {
    // use threadContext
} finally {
    SailPointFactory.releaseContext(threadContext);
}

// Use synchronized for shared mutable state
private synchronized void updateCache(String key, Object value) {
    cache.put(key, value);
}
```

## Collections

```java
// Use diamond operator
List<String> names = new ArrayList<>();
Map<String, Object> attrs = new HashMap<>();

// Prefer unmodifiable for return values
return Collections.unmodifiableList(results);

// Null-safe iteration
List<String> items = Util.safeIterable(possiblyNullList);
for (String item : items) { ... }
```
