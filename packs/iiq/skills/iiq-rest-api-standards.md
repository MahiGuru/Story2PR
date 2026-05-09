---
name: iiq-rest-api-standards
description: REST API coding standards for IIQ resource classes. Loaded by Surgeon when task Layer = Backend/REST. Always loaded alongside iiq-java-standards.md.
---

# IIQ REST API Standards

## Resource Class Structure

```java
package sailpoint.web.rest;

import sailpoint.rest.BaseResource;
import sailpoint.authorization.RightRequired;
import sailpoint.tools.GeneralException;

import javax.ws.rs.*;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;

@Path("ui/metadataValidationDefinitions")
@RightRequired("ViewMetadata")
public class MetadataValidationResource extends BaseResource {

    /**
     * Get all validation definitions with optional filtering.
     */
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response getDefinitions(
            @QueryParam("start") @DefaultValue("0") int start,
            @QueryParam("limit") @DefaultValue("12") int limit,
            @QueryParam("query") String query) throws GeneralException {

        // 1. Authorize
        authorize();

        // 2. Validate input
        if (limit > 100) {
            limit = 100;  // cap to prevent abuse
        }

        // 3. Delegate to service
        MetadataValidationService service = new MetadataValidationService(getContext());
        ListResult result = service.getDefinitions(start, limit, query);

        // 4. Return response
        return Response.ok(result).build();
    }

    /**
     * Get a single definition by ID.
     */
    @GET
    @Path("{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getDefinition(@PathParam("id") String id) throws GeneralException {
        authorize();

        if (Util.isNullOrEmpty(id)) {
            return Response.status(Response.Status.BAD_REQUEST)
                .entity(new ErrorResponse("ID is required"))
                .build();
        }

        MetadataValidationService service = new MetadataValidationService(getContext());
        ValidationDefinition def = service.getDefinition(id);

        if (def == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }

        return Response.ok(def).build();
    }

    /**
     * Create or update a definition.
     */
    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response saveDefinition(ValidationDefinitionDTO dto) throws GeneralException {
        authorize();

        // Validate DTO
        List<String> errors = dto.validate();
        if (!errors.isEmpty()) {
            return Response.status(Response.Status.BAD_REQUEST)
                .entity(new ErrorResponse(errors))
                .build();
        }

        MetadataValidationService service = new MetadataValidationService(getContext());
        ValidationDefinition saved = service.save(dto);

        return Response.ok(saved).build();
    }
}
```

## URL Naming

| Pattern | Example | Notes |
|---------|---------|-------|
| Base path | `/rest/ui/metadataValidationDefinitions` | `ui/` prefix for UI-consumed APIs |
| Get list | `GET /rest/ui/metadataValidationDefinitions` | Plural noun, query params for filtering |
| Get single | `GET /rest/ui/metadataValidationDefinitions/{id}` | Path param for ID |
| Create/update | `POST /rest/ui/metadataValidationDefinitions` | POST for both create and update (IIQ convention) |
| Delete | `DELETE /rest/ui/metadataValidationDefinitions/{id}` | Only if supported by feature |

**Rules:**
- camelCase for multi-word paths (IIQ convention — NOT kebab-case)
- Plural nouns for collection endpoints
- `ui/` prefix for UI-facing APIs, no prefix for system APIs
- No verbs in URLs (`/rest/ui/validate` is wrong — use POST to the resource)

## Authorization

```java
// Class-level — applies to all methods
@RightRequired("ViewMetadata")
public class MetadataValidationResource extends BaseResource {

    // Method-level override for write operations
    @POST
    @RightRequired("ManageMetadata")
    public Response saveDefinition(...) { ... }

    // Always call authorize() as first line in each method
    authorize();
}
```

## Request/Response DTOs

```java
public class ValidationDefinitionDTO {
    private String id;
    private String name;
    private String description;
    private boolean active;

    // Getters/setters (or use Lombok if available)

    /**
     * Validate this DTO. Returns list of error messages (empty = valid).
     */
    public List<String> validate() {
        List<String> errors = new ArrayList<>();
        if (Util.isNullOrEmpty(name)) {
            errors.add("Name is required");
        }
        if (name != null && name.length() > 256) {
            errors.add("Name must be 256 characters or fewer");
        }
        return errors;
    }
}
```

**Rules:**
- DTOs in `sailpoint.web.rest.dto` package
- Validation logic IN the DTO (not in the resource or service)
- Return empty list for valid, non-empty for errors
- Never expose internal SailPoint objects directly — always map to DTOs

## Error Responses

```java
// Consistent error format
public class ErrorResponse {
    private List<String> errors;

    public ErrorResponse(String error) {
        this.errors = Collections.singletonList(error);
    }

    public ErrorResponse(List<String> errors) {
        this.errors = errors;
    }
}

// Usage in resource
return Response.status(Response.Status.BAD_REQUEST)
    .entity(new ErrorResponse("Invalid date format"))
    .build();
```

## Pagination

```java
// ListResult is IIQ's standard paginated response
ListResult result = new ListResult(items, totalCount);
// Returns: { "objects": [...], "count": 42 }

// Query params: start (offset), limit (page size)
@QueryParam("start") @DefaultValue("0") int start,
@QueryParam("limit") @DefaultValue("12") int limit
```

## Resource → Service Separation

- **Resource class:** HTTP concerns only — parse params, authorize, validate input, call service, build response
- **Service class:** Business logic — query, transform, save. No HTTP awareness.
- Resource NEVER accesses `SailPointContext` directly for queries — delegates to service
- One service per resource (usually). Service can be reused by other resources.
