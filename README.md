# Omosuen Engine

An axonometric game engine with a static z-axis camera, designed for tile-based games with fixed perspective rendering.

## Features

- 🎮 Axonometric/isometric rendering with locked camera rotation
- 📦 Zero runtime dependencies
- 🔧 TypeScript-first development
- 📚 Importable as ES module or standalone bundle
- 🌐 Browser-ready UMD builds

## Installation

### As a Node Module

```bash
npm install omosuen
```

```typescript
import { Omosuen } from 'omosuen';

Omosuen.init();
```

### As a Standalone Script

Include the bundled JavaScript file in your HTML:

```html
<script src="omosuen.min.js"></script>
<script>
  Omosuen.init();
</script>
```

## Development

### Setup

```bash
npm install
```

### Build

```bash
# Build both development and production bundles
npm run build

# Build development version (with source maps)
npm run build:dev

# Build production version (minified)
npm run build:prod
```

Build outputs:
- `dev/omosuen.js` - Development bundle with source maps
- `dev/omosuen.min.js` - Production minified bundle
- `dist/` - TypeScript declaration files for module imports

### Testing

Run the test HTML page:

```bash
npm test
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

### Linting

```bash
npm run lint
```

## Project Structure

```
omosuen/
├── src/
│   └── index.ts          # Main entry point
├── test/
│   └── index.html        # Test page
├── dev/                  # Webpack build outputs (gitignored)
├── dist/                 # TypeScript compilation outputs (gitignored)
├── package.json
├── tsconfig.json
├── webpack.config.js
└── README.md
```

## Technical Specifications

- **Target**: ES2020
- **Module System**: ES Modules
- **Build Tool**: Webpack 5
- **Compiler**: TypeScript 5
- **Bundle Format**: UMD (works in browsers and Node.js)

## License

ISC

---

## The Story Behind the Name

### Etymology

The name **Omosuen** is a portmanteau derived from ancient linguistic roots that perfectly capture the essence of axonometric projection:

**Omos** (ὦμος) - Greek for "shoulder"
- The ancient Greeks used "omos" (shoulder) as a metaphor for load-bearing rotation points
- This metaphor evolved into words for "axis" and "axle" across Indo-European languages
- Proto-Indo-European root: *aks- (axis/axle) originally meant "shoulder"
- The connection: a shoulder bears weight while enabling rotation, just like an axle
- This is the "axon" part of "axonometric" - measurement along axes

**Suen** (𒂗𒍪𒂗) - Mesopotamian moon deity (also known as Sin or Nanna)
- One of the oldest recorded gods in human civilization
- Represented the moon as a celestial timekeeper
- The moon's phases were humanity's earliest universal measurement system
- Ancient peoples used lunar cycles to track seasons, predict tides, and measure time
- This connects to "metric" in "axonometric" - the measurement aspect
- Proto-Indo-European root: *me(n)ses- (moon/month) derives from *meh₁- (to measure)

### The Concept

**Axonometric** projection literally means "measuring along axes" - a perfect description of how this engine works:

1. **Load-bearing axes** (omos/shoulder) - Fixed rotation points that define the view
2. **Cyclical measurement** (Suen/moon) - Regular, predictable patterns for positioning

The engine forces an axonometric viewpoint with a static z-axis, meaning the camera cannot rotate - it maintains a fixed "shoulder" position from which all measurements are taken.

### The Accidental Wordplay

Entirely by coincidence, when transliterated into Japanese, "Omosu" (置場所) can be written in Kanji meaning "**layer place**" or "**placement location**" - a serendipitous connection to the engine's tile-based, layered rendering system.

So you could call it the "**Omosu Engine**" - the "**Layer Place Engine**" - which perfectly describes its technical implementation, while "**Omosuen**" honors the deep etymological roots of axonometric projection itself.

### Historical Context

The components of this name span over 4,000 years of human civilization:
- **2130 BC**: Ancient Mesopotamian worship of Suen/Sin begins
- **~1500 BC**: Proto-Indo-European *aks- (shoulder/axis) in use
- **~800 BC**: Greek omos (shoulder) recorded in Homer
- **~150 BC**: Hipparchus uses orthographic projection (precursor to axonometric)
- **1613 AD**: François d'Aguilon formalizes "orthographic" terminology
- **1822 AD**: William Farish publishes first treatise on isometric/axonometric drawing
- **2026 AD**: Omosuen Engine created

The name connects ancient human understanding of measurement, rotation, and time into a modern game engine framework.
