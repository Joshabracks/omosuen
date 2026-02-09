# Contributing to Omosuen

Thank you for your interest in contributing to Omosuen!

---

## Development Guidelines

For detailed development guidelines, best practices, and architecture decisions, please refer to:

**[CLAUDE.md](../CLAUDE.md)**

This document contains:
- Code style and conventions
- Architecture patterns
- Performance guidelines
- Testing practices
- Contribution workflow

---

## Quick Start for Contributors

### 1. Fork and Clone

```bash
git clone https://github.com/yourusername/omosuen.git
cd omosuen
npm install
```

### 2. Build

```bash
# Development build
npm run build:dev

# Production build
npm run build:prod

# Watch mode (if available)
npm run build -- --watch
```

### 3. Run Tests

```bash
# Start test server
npm test

# Run CLI tests
npm run test:cli
```

### 4. Lint and Format

```bash
# Lint code
npm run lint

# Format code
npm run format

# Check formatting
npm run format:check
```

---

## Project Structure

```
omosuen/
├── src/                    # Source code
│   ├── component/          # Component system
│   │   ├── nexus/          # Nexus component
│   │   ├── ui-overlay/     # UI Overlay component
│   │   ├── data-layer/     # Data Layer component
│   │   ├── flag-manager/   # Flag Manager component
│   │   ├── messenger/      # Messenger component
│   │   ├── types.ts        # Core types
│   │   ├── registry.ts     # Component registry
│   │   └── index.ts        # Exports
│   ├── scene/              # Scene management
│   │   ├── registry.ts     # Scene registry
│   │   └── loader.ts       # Scene loading/serialization
│   ├── loop/               # Game loop
│   │   ├── manager.ts      # Loop control
│   │   ├── init.ts         # Initialization system
│   │   ├── update.ts       # Update system
│   │   ├── dispose.ts      # Disposal system
│   │   ├── render.ts       # Render stub
│   │   ├── messaging.ts    # Messaging stub
│   │   └── flags.ts        # Flags stub
│   ├── math/               # Math library
│   │   └── index.ts        # Vectors and arrays
│   └── index.ts            # Main entry point
├── docs/                   # Documentation
│   ├── components/         # Component docs
│   └── math/               # Math docs
├── test/                   # Tests
├── dist/                   # Build output
├── package.json            # Project config
├── webpack.config.js       # Build config
├── tsconfig.json           # TypeScript config
├── .eslintrc.js            # Lint config
├── .prettierrc             # Format config
├── README.md               # Main readme
└── CLAUDE.md               # Development guidelines
```

---

## Contribution Workflow

### 1. Create a Branch

```bash
git checkout -b feature/my-feature
# or
git checkout -b fix/my-bugfix
```

### 2. Make Changes

- Follow code style in [CLAUDE.md](../CLAUDE.md)
- Add tests if applicable
- Update documentation if needed

### 3. Test Your Changes

```bash
npm run lint
npm run format:check
npm test
npm run build
```

### 4. Commit

```bash
git add .
git commit -m "feat: add new feature"
# or
git commit -m "fix: resolve bug in component system"
```

**Commit message format:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `perf:` - Performance improvements
- `test:` - Adding or updating tests
- `chore:` - Build/tooling changes

### 5. Push and Create PR

```bash
git push origin feature/my-feature
```

Then create a Pull Request on GitHub.

---

## Areas for Contribution

### High Priority

- **Rendering System** - Implement `renderScene()` stub
- **Testing** - Add unit/integration tests
- **Documentation** - Expand examples and tutorials
- **Performance** - Profile and optimize hot paths

### Component Development

- Create new built-in components
- Improve existing component APIs
- Add component serialization support

### Math Library

- Add more vector operations
- Optimize array iteration
- Add spatial data structures (quadtree, octree)

### Tooling

- Scene editor
- Debug visualizer
- Performance profiler
- Asset pipeline

---

## Code Style

### TypeScript

```typescript
// Use explicit types
function add(a: number, b: number): number {
    return a + b;
}

// Use interfaces for complex types
interface MyComponent extends ComponentData {
    type: 'my-component';
    health: number;
}

// Prefer const over let
const value = 42;
```

### Error Handling

```typescript
// Log errors, don't throw (graceful degradation)
if (!component) {
    console.error('[MY SYSTEM] Component not found');
    return null;
}
```

### Comments

```typescript
// Document public APIs with JSDoc
/**
 * Creates a new component.
 *
 * @param type - Component type
 * @param options - Component options
 * @returns Created component or null on failure
 */
export async function newComponent(
    type: COMPONENT_TYPE,
    options: ComponentOptions
): Promise<ComponentData | null> {
    // ...
}

// Use inline comments for complex logic
// Binary search through cumulative counts
let left = 0;
let right = this.values.length - 1;
```

---

## Testing Guidelines

### Manual Testing

```bash
# Start test server
npm test

# Open browser to http://localhost:3000
# Test functionality manually
```

### Automated Testing

```typescript
// Example test structure
import { newComponent } from '../src/component/types';

async function testComponentCreation() {
    const component = await newComponent('nexus', { name: 'Test' });
    console.assert(component !== null, 'Component created');
    console.assert(component.type === 'nexus', 'Correct type');
    console.log('✓ Component creation test passed');
}

testComponentCreation();
```

---

## Documentation Guidelines

### Code Documentation

- Document all public APIs with JSDoc
- Include `@param`, `@returns`, `@example` tags
- Explain performance characteristics
- Note any allocations or side effects

### User Documentation

- Add examples to docs/
- Keep examples concise and practical
- Link related documentation
- Update README.md table of contents

### Component Documentation Template

```markdown
# Component Name

Brief description of what this component does.

## Usage

\`\`\`typescript
// Basic example
\`\`\`

## Interface

\`\`\`typescript
// Type definition
\`\`\`

## Methods

### methodName()

Description and usage.

## Best Practices

- Tip 1
- Tip 2

## Examples

### Example 1

\`\`\`typescript
// Code example
\`\`\`
```

---

## Performance Considerations

When contributing, keep these in mind:

### 1. Zero Allocations in Hot Paths

```typescript
// Use module-level pools for update() methods
const TEMP_ARRAY: ComponentData[] = [];
```

### 2. Immutable Math Operations

```typescript
// Always return new instances
add(other: Vector3D): Vector3D {
    return new Vector3D(this.x + other.x, this.y + other.y, this.z + other.z);
}
```

### 3. Batch Operations

```typescript
// Query once, iterate many
const enemies = scene.getComponentsByType('enemy', true);
```

### 4. Document Performance

```typescript
/**
 * Finds components by name.
 *
 * Performance: O(n) where n is number of components.
 * Use getComponentByName() if you only need one result.
 */
```

---

## Getting Help

- **Issues**: Check [GitHub Issues](https://github.com/yourusername/omosuen/issues)
- **Discussions**: Start a discussion on GitHub
- **Documentation**: Review [docs/](.) for detailed guides
- **Code**: Read [CLAUDE.md](../CLAUDE.md) for development guidelines

---

## License

By contributing to Omosuen, you agree that your contributions will be licensed under the ISC License.

---

## Code of Conduct

- Be respectful and constructive
- Focus on technical merit
- Help others learn and grow
- Follow project conventions

---

## Thank You!

Your contributions help make Omosuen better for everyone. We appreciate your time and effort!
