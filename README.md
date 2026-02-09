# Omosuen Engine

**An axonometric game engine with a fixed z-axis camera**

---

## Overview

**Omosuen** is a browser-based, TypeScript-powered game engine specifically designed for axonometric (isometric-style) games. Built with performance and developer experience in mind, it combines a clean, intuitive API inspired by Godot with internal optimizations for 60fps gameplay.

**Etymology:** Omos (Greek: shoulder/axis) + Suen (Mesopotamian moon deity/measurement)

### Key Features

- **Hierarchical Component System** - Nexus-based scene graph with familiar parent-child relationships
- **Data-Oriented Design** - Optimized internal architecture hidden behind developer-friendly APIs
- **Performance-Critical** - Module-level memory pools, minimal GC pressure, 60fps target
- **Full Scene Management** - Load from memory, JavaScript modules, or serialized JSON
- **Progressive Initialization** - Time-budgeted component initialization across frames
- **Immutable Math Library** - Vector2D/3D/4D, Array2D/3D with RLE compression (Array3Dc)
- **Built-in Messaging System** - Global message queue for inter-component communication
- **TypeScript-First** - Strict typing with full IDE autocomplete support

---

## Quick Start

```typescript
import * as Omosuen from 'omosuen';

// Create a scene
const scene = await Omosuen.newComponent('nexus', { name: 'Main Scene' });

// Add components to the scene
const player = await Omosuen.newComponent('nexus', { name: 'Player' });
scene.addComponent(player);

// Register and load the scene
Omosuen.registerScene('main', scene);
await Omosuen.switchScene('main');

// Start the game loop
Omosuen.start(60);
```

---

## Documentation

### Core Documentation
- [Getting Started](docs/getting-started.md) - Installation, first project, and basic workflow
- [Architecture](docs/architecture.md) - Core concepts: Nexus, Components, DOD, and Proxy pattern
- [Component System](docs/component-system.md) - Component lifecycle, creating custom components
- [Scenes](docs/scenes.md) - Scene management, loading strategies, and serialization
- [Game Loop](docs/game-loop.md) - Loop phases, timing, initialization, and disposal
- [API Reference](docs/api-reference.md) - Quick reference of main exports and functions
- [Contributing](docs/contributing.md) - Development guidelines (see also: [CLAUDE.md](CLAUDE.md))

### Built-in Components
- [Nexus](docs/components/nexus.md) - Container component for building hierarchies
- [UI Overlay](docs/components/ui-overlay.md) - UI binding system for HTML elements
- [Data Layer](docs/components/data-layer.md) - Generic data storage component
- [Flag Manager](docs/components/flag-manager.md) - Global flag/state management
- [Messenger](docs/components/messenger.md) - Message queue and event system

### Math Library
- [Vector2D](docs/math/vector2d.md) - 2D vector operations
- [Vector3D](docs/math/vector3d.md) - 3D vector operations with color getters (RGB)
- [Vector4D](docs/math/vector4d.md) - 4D vector operations with color getters (RGBA)
- [Array2D](docs/math/array2d.md) - 2D grid/array structure with optimized iteration
- [Array3D](docs/math/array3d.md) - 3D voxel/array structure with optimized iteration
- [Array3Dc](docs/math/array3dc.md) - RLE-compressed 3D arrays for large static datasets
- [Utilities](docs/math/utilities.md) - Helper functions (lerp, etc.)

---

## Installation

```bash
npm install omosuen
```

Or clone and build from source:

```bash
git clone https://github.com/yourusername/omosuen.git
cd omosuen
npm install
npm run build
```

---

## Development

```bash
# Build development version
npm run build:dev

# Build production version
npm run build:prod

# Run test server (http://localhost:3000)
npm test

# Lint code
npm run lint

# Format code
npm run format
```

---

## License

ISC

---

## Philosophy

Omosuen follows a **"simple API, optimized internals"** philosophy inspired by Godot. The engine prioritizes:

1. **Developer Experience** - Clean, intuitive APIs over maximum theoretical performance
2. **Composition Over Inheritance** - Flexible component hierarchies
3. **Graceful Degradation** - Log errors, don't crash; games should keep running
4. **Performance Where It Matters** - Zero allocations in update loops, data locality
5. **Predictable Behavior** - Explicit is better than implicit

If you're building axonometric games and value a clean TypeScript workflow with solid performance, Omosuen might be for you.
