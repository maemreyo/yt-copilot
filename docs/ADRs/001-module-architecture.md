# ADR-001: Module-First Architecture

## Status

Accepted

## Context

When building a SaaS application, we need to decide how to organize our codebase to ensure it remains maintainable and scalable as the application grows. Traditional approaches often organize code by technical concerns (controllers, models, services), which can lead to tight coupling and difficulty in understanding the boundaries between different features.

## Decision

We have decided to adopt a module-first architecture for our backend code. In this approach:

1. Code is organized into independent feature modules (e.g., billing, auth)
2. Each module contains its own migrations, functions, and tests
3. Modules have high cohesion (related code is grouped together) and low coupling (minimal dependencies between modules)
4. Modules expose their functionality through well-defined API endpoints

The structure of each module follows this pattern:

```
src/modules/{module_name}/
├── migrations/       # SQL migrations for the module
├── functions/        # Edge Functions (API endpoints)
└── tests/            # Integration tests
```

Shared code that is used across multiple modules is placed in a `shared` directory:

```
src/shared/
├── types/            # Shared TypeScript types
├── utils/            # Utility functions
├── constants/        # Constants and configuration
└── config/           # Environment configuration
```

## Consequences

### Positive

- **Improved maintainability**: Related code is grouped together, making it easier to understand and modify
- **Better separation of concerns**: Each module has a clear responsibility and boundary
- **Easier onboarding**: New developers can focus on understanding one module at a time
- **Scalable development**: Multiple teams can work on different modules with minimal conflicts
- **Testability**: Modules can be tested in isolation
- **Clear API boundaries**: Each module exposes its functionality through well-defined API endpoints

### Negative

- **Potential for duplication**: Some code might be duplicated across modules if not properly abstracted
- **Learning curve**: Developers used to traditional architectures might need time to adapt
- **Overhead for small projects**: For very small projects, this architecture might introduce unnecessary complexity

## Mitigation Strategies

- Use the `shared` directory for code that is used across multiple modules
- Establish clear guidelines for when to create a new module vs. extending an existing one
- Regularly review modules to identify opportunities for refactoring and reducing duplication