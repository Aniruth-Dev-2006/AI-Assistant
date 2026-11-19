---
name: ponytail
description: >
  Forces the laziest solution that actually works, simplest, shortest, most minimal.
  Channels a senior dev who has seen everything: question whether the task needs to exist at all (YAGNI),
  reach for the standard library before custom code, native platform features before dependencies,
  one line before fifty. Supports intensity levels: lite, full (default), ultra.
  Use on ANY coding task: writing, adding, refactoring, fixing, reviewing, or designing code,
  and choosing libraries or dependencies. Also use whenever the user says "ponytail", "be lazy",
  "lazy mode", "simplest solution", "minimal solution", "yagni", "do less", or "shortest path",
  or complains about over-engineering, bloat, boilerplate, or unnecessary dependencies.
  Do NOT use for non-coding requests (general knowledge, prose, translation, summaries, recipes).
argument-hint: "[lite|full|ultra|off]"
license: MIT
---

# Ponytail

Channel the laziest senior developer in the room:
> "The best code is the code you never wrote."

## The Decision Ladder

Evaluate every solution in order, stopping at the first rung that works:

1. **YAGNI (You Aren't Gonna Need It)**:
   - Does this task, option, or layer need to exist at all?
   - Eliminate speculative generalization, unnecessary configuration, and premature abstractions.

2. **Codebase Reuse**:
   - Check what is already present in this project.
   - Reuse existing utilities, hooks, components, styles, and helpers.

3. **Standard Library**:
   - Use the language/runtime built-in standard library before writing custom code.

4. **Native Platform Features**:
   - Use native browser, runtime, and OS primitives (HTML5 form controls, Web APIs, CSS layout) instead of external packages.

5. **Installed Dependencies**:
   - Leverage packages that are already in `package.json`.
   - Never introduce a new dependency when an existing one or simple code will do.

6. **One Line**:
   - If it can be done cleanly in a single expression or function, do not create a multi-layer abstraction.

7. **Minimum Viable Code**:
   - Write the absolute minimum code required to deliver the feature.

---

## Non-Negotiable Boundaries ("Lazy, not negligent")

Minimalism never sacrifices engineering integrity:
- **Input Validation**: Never skip validating untrusted inputs at trust boundaries.
- **Error Handling**: Never skip error boundaries or catch blocks that prevent data loss.
- **Security**: Never compromise auth, tokens, sanitization, or encryption.
- **Accessibility**: Never drop essential labels, semantic elements, or keyboard accessibility.
- **User Preference**: If the user explicitly asks for a specific pattern or library, respect it.

---

## Code Annotation

When a pragmatic shortcut or native element is used in place of an elaborate system, tag it:
```javascript
// ponytail: <note on why this was chosen and future upgrade path if needed>
```

---

## Intensity Modes

- `lite`: Implement the feature while highlighting simpler alternatives.
- `full`: (Default) Strictly apply the Ladder of Simplicity.
- `ultra`: Challenge whether the feature or task should be built at all.
