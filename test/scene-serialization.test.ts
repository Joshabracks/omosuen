/**
 * Scene Serialization CLI Unit Tests
 *
 * Tests scene creation, serialization, and file saving.
 * Creates a scene with UI Overlay, serializes it, and saves to JSON file.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// Test tracking
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

/**
 * Assert helper with colorized output
 */
function assert(condition: boolean, testName: string, details?: string): void {
  testsRun++;
  if (condition) {
    testsPassed++;
    console.log(`${colors.green}✓${colors.reset} ${testName}`);
  } else {
    testsFailed++;
    console.log(`${colors.red}✗${colors.reset} ${testName}`);
    if (details) {
      console.log(`  ${colors.gray}${details}${colors.reset}`);
    }
  }
}

/**
 * Section header for test organization
 */
function section(title: string): void {
  console.log(`\n${colors.cyan}━━━ ${title} ━━━${colors.reset}`);
}

/**
 * Creates a test scene structure with UI Overlay
 */
function createTestScene(): unknown {
  // Manually construct a scene structure (nexus with UI Overlay)
  const scene = {
    type: 'nexus',
    name: 'TestSceneRoot',
    unique: false,
    parent: null,
    _disposed: false,
    paused: false,
    components: [
      {
        type: 'nexus',
        name: 'GameLayer',
        unique: false,
        parent: null,
        _disposed: false,
        paused: false,
        components: [],
      },
      {
        type: 'nexus',
        name: 'UILayer',
        unique: false,
        parent: null,
        _disposed: false,
        paused: false,
        components: [
          {
            type: 'ui-overlay',
            name: 'WelcomeMessage',
            unique: false,
            html: `
      <div style="
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: #00ff00;
        padding: 40px;
        border: 2px solid #00ff00;
        border-radius: 10px;
        font-family: monospace;
        text-align: center;
        max-width: 500px;
      ">
        <h1 style="margin: 0 0 20px 0; font-size: 32px;">Welcome to Omosuen!</h1>
        <p style="margin: 0 0 20px 0; font-size: 18px;">
          This scene was serialized and loaded from a JSON file.
        </p>
        <p style="margin: 0; font-size: 14px; opacity: 0.7;">
          Scene Management System Test
        </p>
      </div>
    `,
            cssOverrides: {
              display: 'block',
              pointerEvents: 'auto',
            },
            bindingFactoryString: 'function bindingFactory() { return [] }',
          },
        ],
      },
    ],
  };

  return scene;
}

/**
 * Test Suite: Scene Structure Validation
 */
function testSceneStructure(): void {
  section('Scene Structure Tests');

  const scene: any = createTestScene();

  // Test 1: Root is nexus
  assert(
    scene.type === 'nexus',
    'Root component is nexus type',
    `Expected "nexus", got "${scene.type}"`,
  );

  // Test 2: Root has name
  assert(
    scene.name === 'TestSceneRoot',
    'Root has correct name',
    `Expected "TestSceneRoot", got "${scene.name}"`,
  );

  // Test 3: Root has components array
  assert(
    Array.isArray(scene.components),
    'Root has components array',
    `Expected array, got ${typeof scene.components}`,
  );

  // Test 4: Root has 2 children (GameLayer, UILayer)
  assert(
    scene.components.length === 2,
    'Root has 2 child components',
    `Expected 2, got ${scene.components.length}`,
  );

  // Test 5: Find UILayer
  const uiLayer = scene.components.find((c: any) => c.name === 'UILayer');
  assert(uiLayer !== undefined, 'UILayer component exists');

  // Test 6: UILayer has UI Overlay child
  const hasUIOverlay =
    uiLayer && uiLayer.components.some((c: any) => c.type === 'ui-overlay');
  assert(hasUIOverlay, 'UILayer contains UI Overlay component');

  // Test 7: UI Overlay has html content
  const overlay = uiLayer?.components.find((c: any) => c.type === 'ui-overlay');
  assert(
    overlay && overlay.html && overlay.html.length > 0,
    'UI Overlay has HTML content',
    `HTML length: ${overlay?.html?.length || 0} chars`,
  );

  // Test 8: UI Overlay has Welcome message
  const hasWelcomeText =
    overlay && overlay.html.includes('Welcome to Omosuen!');
  assert(hasWelcomeText, 'UI Overlay contains welcome message');
}

/**
 * Test Suite: Serialization
 */
function testSerialization(): void {
  section('Serialization Tests');

  const scene: any = createTestScene();

  // Test 1: Scene can be stringified to JSON
  let serialized: string = '';
  try {
    serialized = JSON.stringify(scene);
    assert(true, 'Scene serializes to JSON without errors');
  } catch (error) {
    assert(false, 'Scene serializes to JSON without errors', String(error));
  }

  // Test 2: Serialized JSON is not empty
  assert(
    serialized.length > 0,
    'Serialized JSON has content',
    `Length: ${serialized.length} chars`,
  );

  // Test 3: Serialized JSON can be parsed back
  let parsed: any = null;
  try {
    parsed = JSON.parse(serialized);
    assert(true, 'Serialized JSON can be parsed back');
  } catch (error) {
    assert(false, 'Serialized JSON can be parsed back', String(error));
  }

  // Test 4: Parsed structure matches original
  assert(
    parsed && parsed.type === 'nexus' && parsed.name === 'TestSceneRoot',
    'Parsed structure matches original',
  );

  // Test 5: Formatted JSON for readability
  const formatted = JSON.stringify(scene, null, 2);
  assert(
    formatted.length > serialized.length,
    'Formatted JSON is readable',
    `Formatted is ${formatted.length - serialized.length} chars longer`,
  );
}

/**
 * Test Suite: File Operations
 */
function testFileOperations(): void {
  section('File Operations Tests');

  const scene: any = createTestScene();
  const outputDir = path.join(__dirname, 'data');
  const filepath = path.join(outputDir, 'test-scene.json');

  // Test 1: Create output directory
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    assert(true, 'Output directory created/verified');
  } catch (error) {
    assert(false, 'Output directory created/verified', String(error));
  }

  // Test 2: Write file to disk
  try {
    const content = JSON.stringify(scene, null, 2);
    fs.writeFileSync(filepath, content, 'utf8');
    assert(true, 'Scene saved to file', `Path: ${filepath}`);
  } catch (error) {
    assert(false, 'Scene saved to file', String(error));
  }

  // Test 3: File exists on disk
  assert(fs.existsSync(filepath), 'File exists on disk', `Path: ${filepath}`);

  // Test 4: File has content
  try {
    const stats = fs.statSync(filepath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    assert(
      stats.size > 0,
      'File has content',
      `Size: ${stats.size} bytes (${sizeKB} KB)`,
    );
  } catch (error) {
    assert(false, 'File has content', String(error));
  }

  // Test 5: File can be read back
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    assert(
      content.length > 0,
      'File can be read back',
      `Read ${content.length} chars`,
    );
  } catch (error) {
    assert(false, 'File can be read back', String(error));
  }

  // Test 6: Read content matches original
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    const parsed = JSON.parse(content);
    assert(
      parsed.type === 'nexus' && parsed.name === 'TestSceneRoot',
      'Read content matches original structure',
    );
  } catch (error) {
    assert(false, 'Read content matches original structure', String(error));
  }

  console.log(`\n${colors.gray}📁 Output: ${filepath}${colors.reset}`);
}

/**
 * Main test runner
 */
function runTests(): void {
  console.log(
    `${colors.blue}╔══════════════════════════════════════════╗${colors.reset}`,
  );
  console.log(
    `${colors.blue}║  Omosuen Scene Serialization Unit Tests  ║${colors.reset}`,
  );
  console.log(
    `${colors.blue}╚══════════════════════════════════════════╝${colors.reset}\n`,
  );

  try {
    testSceneStructure();
    testSerialization();
    testFileOperations();
  } catch (error) {
    console.error(`${colors.red}✗ Test execution error:${colors.reset}`, error);
    process.exit(1);
  }

  // Summary
  console.log(`\n${colors.cyan}━━━ Test Summary ━━━${colors.reset}`);
  console.log(`Total:  ${testsRun}`);
  console.log(`${colors.green}Passed: ${testsPassed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${testsFailed}${colors.reset}`);

  const passRate = ((testsPassed / testsRun) * 100).toFixed(1);
  console.log(`\n${colors.yellow}Pass Rate: ${passRate}%${colors.reset}`);

  console.log(`\n${colors.gray}Next steps:${colors.reset}`);
  console.log(`${colors.gray}1. Start test server: npm test${colors.reset}`);
  console.log(
    `${colors.gray}2. Open browser: http://localhost:3000/load-serialized-scene.html${colors.reset}`,
  );
  console.log(
    `${colors.gray}3. Scene will load from JSON file${colors.reset}\n`,
  );

  // Exit with appropriate code
  process.exit(testsFailed > 0 ? 1 : 0);
}

// Execute tests
runTests();
