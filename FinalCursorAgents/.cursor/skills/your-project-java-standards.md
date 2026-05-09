---
name: your-project-java-standards
description: Modern Java (17 LTS+) coding standards. Loaded by Surgeon when task Layer = Backend/Java. Covers records, sealed types, pattern matching, Optional, Streams, exception handling, and the Spring conventions a typical 2024+ backend codebase settles on. Assumes Spring Boot 3.x or comparable framework.
---

# Modern Java Standards

## Context

This skill covers a **Java 17+ LTS** backend (or Java 21 if available). Modern Java has changed a lot since 8 — records, sealed types, pattern matching, switch expressions, and text blocks are all production-ready and should be used in new code.

Assumed framework family: **Spring Boot 3.x** (or comparable — Quarkus, Micronaut). If you're on Spring Boot 2.x, you're on Java 8/11 conventions; this skill will be a stretch.

## Project shape

| Area | Convention |
|------|------------|
| Java version | 17 LTS minimum, 21 LTS preferred |
| Build | Maven or Gradle (Kotlin DSL preferred for Gradle) |
| Framework | Spring Boot 3.x (Jakarta EE namespace, NOT javax) |
| Testing | JUnit 5 + AssertJ + Mockito + Testcontainers |
| Style | Google Java Style or Spring's checkstyle profile |

## Records for data carriers

```java
public record User(String id, String name, String email) {}

public record CreateUserRequest(
    @NotBlank String name,
    @Email String email
) {}

public record PageResult<T>(List<T> items, int totalCount, int page) {}
```

**Use records for:**
- DTOs (request/response bodies)
- Value objects
- Immutable result types
- Anything where you'd previously have written a Lombok `@Value` class

Don't add behavior to records beyond simple computed accessors. If it grows methods, it's a class.

## Sealed types for closed hierarchies

```java
public sealed interface PaymentResult
    permits PaymentResult.Success, PaymentResult.Declined, PaymentResult.Failed {

  record Success(String transactionId, BigDecimal amount) implements PaymentResult {}
  record Declined(String reason)                          implements PaymentResult {}
  record Failed(Throwable cause)                          implements PaymentResult {}
}
```

When you have a fixed set of subtypes, sealing the hierarchy turns runtime "default" cases into compile-time exhaustiveness checks.

## Pattern matching + switch expressions

```java
public String describe(PaymentResult r) {
  return switch (r) {
    case PaymentResult.Success s    -> "OK: " + s.transactionId();
    case PaymentResult.Declined d   -> "Declined: " + d.reason();
    case PaymentResult.Failed f     -> "Error: " + f.cause().getMessage();
  };
}
```

- Switch expressions return values — no fall-through, no missing-case bugs.
- Combined with sealed types, the compiler enforces exhaustiveness.
- `instanceof` pattern matching: `if (obj instanceof User u) { use(u); }` — narrowing built in.

## Optional — for return values, not fields or parameters

```java
public Optional<User> findByEmail(String email) { /* ... */ }

// ✅ chain transforms
return userRepo.findByEmail(email)
    .map(User::name)
    .orElse("Anonymous");

// ❌ Optional<User> as a field — use null + @Nullable annotation instead
class UserHolder { Optional<User> user; }   // don't

// ❌ Optional as a method parameter
void process(Optional<User> user) { }       // don't — overload or Nullable
```

`Optional` is a return type only. Using it for fields or parameters creates noise without safety gains.

## Null handling

- `Optional<T>` for return values where absence is normal.
- `@Nullable` / `@NonNull` annotations on parameters and fields (JSR-305 or Spring's variants).
- `Objects.requireNonNull(x, "x must not be null")` at constructor / setter boundaries to fail fast.
- Don't return `null` from a method whose return type is a collection — return `List.of()` instead.

## Streams

```java
List<String> names = users.stream()
    .filter(User::isActive)
    .map(User::name)
    .sorted()
    .toList();                         // ✅ Java 16+ — immutable list
```

**Rules:**
- Use `.toList()` (Java 16+) over `Collectors.toList()` for the common case.
- Don't write a stream that's longer than ~5 operations — extract to a method or use a regular loop.
- Avoid stateful lambdas (mutating outer variables). Streams parallelize cleanly only when stages are pure.

## Exceptions

```java
public class UserNotFoundException extends RuntimeException {
  private final String userId;

  public UserNotFoundException(String userId) {
    super("User not found: " + userId);
    this.userId = userId;
  }

  public String userId() { return userId; }
}
```

- Custom unchecked exceptions per failure mode — meaningful types, not `RuntimeException` everywhere.
- Don't catch `Exception` or `Throwable` unless you genuinely handle them all (and almost no one does).
- Use `try-with-resources` for anything `AutoCloseable`.
- Re-throw with `Throwable.cause` chained: `throw new ServiceException("failed", e);`.

## Spring patterns (when applicable)

```java
@Service
public class UserService {
  private final UserRepository repo;
  private final EventPublisher events;

  public UserService(UserRepository repo, EventPublisher events) {
    this.repo = repo;
    this.events = events;
  }

  @Transactional
  public User create(CreateUserRequest req) {
    var user = new User(UUID.randomUUID().toString(), req.name(), req.email());
    repo.save(user);
    events.publish(new UserCreated(user.id()));
    return user;
  }
}
```

- **Constructor injection only.** Field injection (`@Autowired` on a field) breaks immutability and testability.
- `final` fields for collaborators.
- `@Transactional` on the service layer, not the controller.
- Return DTOs from controllers, not entities — keep persistence layer types out of the API surface.

## Testing

```java
@Test
void create_persistsUser_andPublishesEvent() {
  var req = new CreateUserRequest("Ada", "ada@example.com");

  var result = userService.create(req);

  assertThat(result.name()).isEqualTo("Ada");
  verify(events).publish(any(UserCreated.class));
}
```

- JUnit 5 + AssertJ — `assertThat(...)` reads better than JUnit's built-in asserts.
- Test names describe the behavior, not the method (`create_persistsUser_andPublishesEvent`, NOT `testCreate`).
- Testcontainers for integration tests against real Postgres / Kafka — mocking those is a known anti-pattern.

## Do / Don't

✅ Records for DTOs, sealed types + pattern matching, `Optional` for returns only, constructor injection, `var` where the type is obvious, `.toList()`, custom unchecked exceptions, Testcontainers for integration tests.

❌ `javax.*` imports (Spring Boot 3 is `jakarta.*`), Lombok where records suffice, field injection (`@Autowired` on fields), checked exceptions in new APIs (no one wants them), returning `null` for collections, `Optional` as a parameter or field, mutable DTOs.
