---
name: ponytail-review
description: >
  Reviews code, diffs, branches, or PRs for bloat, over-engineering, unnecessary abstractions,
  and dead flexibility. Evaluates whether code can be deleted, simplified, or replaced with
  standard libraries and built-in features.
argument-hint: "[diff|branch|file]"
license: MIT
---

# Ponytail Review

Conducts a pragmatic, minimalist code review focused on eliminating over-engineering and code bloat.

## Review Protocol

1. **Understand Context First**:
   - Inspect the diff alongside callers, callees, and actual data flows.
   - Do not critique code in isolation.

2. **Core Review Questions**:
   - **Can this code be deleted?** Is this solving a real problem or an imaginary one?
   - **Is there an existing helper?** Does the repository already have a way to do this?
   - **Can standard libraries do this?** Did the author invent logic that built-in APIs already provide?
   - **Is there an unnecessary dependency?** Was a package added for something trivial?
   - **Is it over-abstracted?** Are there unnecessary factories, interfaces, singletons, or wrappers?

3. **Non-Negotiables Check**:
   - Verify that safety, input validation, error handling, security, and accessibility were NOT compromised in the name of brevity.

4. **Output Format**:
   - **Summary**: Concise verdict on complexity and leanness.
   - **Suggested Deletions**: Code or dependencies that can be removed.
   - **Simplifications**: Concrete diffs or one-liners replacing verbose abstractions.
   - **Risks**: Any potential boundary conditions to watch out for.
