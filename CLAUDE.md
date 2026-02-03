# Omosuen Engine - AI Development Guidelines

## Core Principles

- Refer to BEST_PRACTICES.md before making any changes or additions to engine code
- Ask clarifying questions for any architectural updates or new additions
- Research complex concepts for existing solutions and popular implementations, algorithms and theories before coming up with plans

---

## Project Context

**Type**: Browser-based game engine (performance-critical, real-time)
**Architecture**: Hierarchical component pattern (NOT ECS - intentionally developer-friendly)
**Philosophy**: Simple external API + hidden internal optimizations (inspired by Godot)
**Target**: 60fps, minimal GC spikes, axonometric rendering with fixed z-axis camera
**Platform**: TypeScript → WebGL/Canvas, browser-only (for now)

---

## Code Style & Standards

**TypeScript**:
- Strict mode required (strictNullChecks, noImplicitAny)
- No `any` types - use `unknown` or specific types
- Explicit return types on functions
- Compile without errors before submitting

**Naming**:
- Component types: `kebab-case` (e.g., `"nexus"`, `"enemy-spawner"`)
- Component instances: Title Case recommended (e.g., `"Player Inventory"`)
- Module constants: `UPPER_SNAKE_CASE`
- Functions/variables: `camelCase`

**Math Operations**:
- ALWAYS return new instances (immutable)
- Never mutate Vector2D/3D/4D in-place
- Document performance characteristics

**Documentation**:
- JSDoc required for ALL public APIs
- Include `@param`, `@returns`, `@example`
- Comment WHY, not WHAT (code explains what)
- Performance notes for critical paths

---

## Component Development

**Required Exports** (all 3):
1. TypeScript interface extending `Component`
2. `builder(options: ComponentOptions)` function
3. `ComponentSerializer` with `serialize()` and `deserialize()`

**Registration** (in `src/component/types.ts`):
1. Add type to `COMPONENT_TYPE` union
2. Import builder function
3. Add to `BUILDERS` record

**File Structure**:
```
src/component/{component-name}/index.ts
```

**Lifecycle Hooks**:
- `init()` - component creation/scene add
- `update()` - called every frame
- `dispose()` - REQUIRED if using module-level data

**Memory Management**:
- Use module-level allocation for hot data (avoid GC spikes)
- MUST implement `dispose()` if using module-level pools/arrays
- Clean up event listeners, WebGL resources, shared references
- Depth-first disposal in Nexus (children before parent)

**Null Checking**:
- ALWAYS check `newComponent()` returns (can be `null`)
- Handle gracefully, log warnings, use fallbacks

---

## Performance Guidelines

**Critical Rules**:
- NO allocations in `update()` loops - use module-level pools
- Use `indexSet()` over `set()` in hot loops (2-3x faster)
- Use `indexForEach()` when coordinates not needed
- Batch process components (avoid recursive searches)
- Prefer linear memory access patterns

**Array Classes**:
- `Array2D`/`Array3D`: Small/medium, frequently updated data
- `Array3Dc`: Large datasets, repeating values, rarely updated (maps, voxels)

**Documentation**:
- Document Big-O complexity for algorithms
- Note performance trade-offs in comments
- Include inline warnings for slow operations

---

## Error Handling

**Philosophy**: Log, don't throw - games degrade gracefully

**Pattern**:
- Use `console.error()` for failures, return `null`
- Use `console.warn()` for deprecations, performance issues
- Use `console.info()` for lifecycle events
- Use `console.log()` for debug output

**Only Throw For**:
- Invalid engine configuration (unrecoverable)
- Corrupted serialization data
- Programmer errors (div by zero, disposed component access)

---

## Build & Test Workflow

**Commands**:
- `npm run build:dev` - development build (test/dev/omosuen.js)
- `npm run build:prod` - production build (test/dev/omosuen.min.js)
- `npm test` - start test server (http://localhost:3000)
- `npm run lint` - ESLint (must pass before commit)

**Output**:
- UMD bundle with auto-exports to `window.Omosuen`
- All named exports automatically available in browser
- Tree-shakeable ES modules for production

**Rebuild Required After**:
- ANY change to src/ files
- Component registration
- Export modifications

---

## File Modification Rules

**NEVER Modify Without Asking**:
- `package.json` scripts
- `webpack.config.js` (architectural change)
- `tsconfig.json` compiler options
- `BEST_PRACTICES.md` (discuss first)

**ALWAYS**:
- Read files before editing (use Read tool)
- Rebuild after source changes
- Run linter before completion
- Test in browser console after builds

**Export Strategy**:
- Keep exports flat (automatic via `export *`)
- NO manual object spreading
- NO default exports in math/component (only in index.ts)

---

## Research Protocol

**Before Implementing**:
1. Research existing game engine patterns (Godot, Unity, Phaser)
2. Check for browser/WebGL constraints
3. Validate algorithm complexity for large datasets (1000+ entities)
4. Consider GC impact and memory allocation patterns

**Prefer**:
- Simplicity over cleverness (Godot philosophy: "simplest code possible")
- Composition over inheritance
- Data locality over flexibility
- Established patterns over novel solutions

**References**:
- Godot: Hierarchical nodes, built-in patterns, ease of use
- Unity: Component lifecycle, serialization
- Phaser: Browser-optimized game loops, pooling
- Three.js: WebGL best practices

---

## Collaboration Guidelines

**Task Management**:
- Use TodoWrite for multi-step tasks (3+ steps)
- Mark tasks in_progress BEFORE starting
- Mark completed IMMEDIATELY after finishing
- One in_progress task at a time

**Communication**:
- Ask clarifying questions for ambiguous requirements
- Present plans for architectural changes (use ExitPlanMode)
- Verify understanding of performance implications
- Propose alternatives with trade-offs when applicable

**Validation**:
- Confirm component type (unique vs non-unique)
- Verify naming conventions before creating files
- Check if similar functionality exists
- Discuss breaking changes to public API

---

## Quick Reference Checklist

**Adding a New Component**:
- [ ] File at `src/component/{name}/index.ts`
- [ ] Type in `COMPONENT_TYPE` union (kebab-case)
- [ ] Builder in `BUILDERS` record
- [ ] Interface extends `Component`
- [ ] Implements `init()`, `update()`, `dispose()`
- [ ] `dispose()` cleans module-level data
- [ ] `unique` flag set correctly (false for most)
- [ ] `ComponentSerializer` implemented
- [ ] Null checks after `newComponent()`
- [ ] Error handling uses `console.error()`
- [ ] JSDoc on public APIs
- [ ] Performance notes on critical code
- [ ] `npm run lint` passes
- [ ] `npm run build:dev` succeeds
- [ ] Tested in browser console

**Performance Checklist**:
- [ ] No allocations in update loops
- [ ] Module-level pools for hot data
- [ ] Use `indexSet()` in forEach
- [ ] Batch process components
- [ ] Document complexity
- [ ] Test with 1000+ entities

---

**Remember**: Prioritize developer experience and code simplicity. The engine hides complexity internally while exposing a clean, intuitive API.