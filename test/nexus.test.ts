/**
 * Nexus Component CLI Unit Tests
 *
 * Tests the data-oriented Nexus component implementation using the $ Proxy helper.
 * Creates a 5-level branching tree with 5 children per node (3,906 total nodes).
 */

import { newComponent, $, ComponentData } from "../src/component/types.js";
import { nexus } from "../src/component/nexus/data.js";

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
 * Performance timing helper
 */
function timeOperation<T>(name: string, operation: () => T): T {
  const start = performance.now();
  const result = operation();
  const duration = (performance.now() - start).toFixed(2);
  console.log(`${colors.gray}⏱  ${name}: ${duration}ms${colors.reset}`);
  return result;
}

/**
 * Creates a branching tree of nexus components
 *
 * @param depth - Maximum depth of the tree (0 = root only)
 * @param branchFactor - Number of children per node
 * @returns Root nexus component
 */
async function createBranchingTree(depth: number, branchFactor: number): Promise<nexus> {
  let nodeCounter = 0;

  async function createNode(currentDepth: number, path: string): Promise<nexus> {
    const nodeName = path || `Root`;
    const node = await newComponent("nexus", { name: nodeName });

    if (!node) {
      throw new Error(`Failed to create nexus: ${nodeName}`);
    }

    nodeCounter++;

    // Create children if not at max depth
    if (currentDepth < depth) {
      for (let i = 0; i < branchFactor; i++) {
        const childPath = path ? `${path}-${i}` : `${i}`;
        const child = await createNode(currentDepth + 1, childPath);
        $.addComponent(node as nexus, child);
      }
    }

    return node as nexus;
  }

  const root = await createNode(0, "");
  console.log(`${colors.gray}📊 Created tree: ${nodeCounter} nodes (depth=${depth}, branch=${branchFactor})${colors.reset}`);
  return root;
}

/**
 * Test Suite: addComponent
 */
async function testAddComponent(root: nexus): Promise<void> {
  section("addComponent Tests");

  // Test 1: Add component to root
  const testNode = await newComponent("nexus", { name: "TestNode-Add" });
  assert(testNode !== null, "Create test node");

  $.addComponent(root, testNode!);
  const found = $.getComponentByName(root, "TestNode-Add", false);
  assert(found !== null && found.name === "TestNode-Add",
    "Component added to root and retrievable");

  // Test 2: Add component to deep node
  const deepNode = $.getComponentByName(root, "0-1-2", true) as nexus;
  assert(deepNode !== null, "Find deep node (0-1-2)");

  const deepTestNode = await newComponent("nexus", { name: "DeepTest" });
  $.addComponent(deepNode!, deepTestNode!);
  const foundDeep = $.getComponentByName(deepNode!, "DeepTest", false);
  assert(foundDeep !== null, "Component added to deep node");

  // Test 3: Parent reference is set correctly
  assert(testNode!.parent === root, "Parent reference set correctly");
}

/**
 * Test Suite: addComponents (batch)
 */
async function testAddComponents(root: nexus): Promise<void> {
  section("addComponents Tests");

  // Test 1: Add array of components
  const arrayComponents = await Promise.all([
    newComponent("nexus", { name: "Batch-1" }),
    newComponent("nexus", { name: "Batch-2" }),
    newComponent("nexus", { name: "Batch-3" }),
  ]);

  $.addComponents(root, arrayComponents as ComponentData[]);
  const batch1 = $.getComponentByName(root, "Batch-1", false);
  const batch2 = $.getComponentByName(root, "Batch-2", false);
  const batch3 = $.getComponentByName(root, "Batch-3", false);

  assert(batch1 !== null && batch2 !== null && batch3 !== null,
    "Array of components added successfully");

  // Test 2: Add object of components
  const objComponents = {
    first: await newComponent("nexus", { name: "ObjBatch-A" }),
    second: await newComponent("nexus", { name: "ObjBatch-B" }),
  };

  $.addComponents(root, objComponents as { [key: string]: ComponentData });
  const objA = $.getComponentByName(root, "ObjBatch-A", false);
  const objB = $.getComponentByName(root, "ObjBatch-B", false);

  assert(objA !== null && objB !== null,
    "Object of components added successfully");
}

/**
 * Test Suite: getComponentByType
 */
function testGetComponentByType(root: nexus): void {
  section("getComponentByType Tests");

  // Test 1: Non-recursive (immediate children only)
  const immediateChild = $.getComponentByType(root, "nexus", false);
  assert(immediateChild !== null,
    "Non-recursive: Find immediate child");

  // Test 2: Recursive (search entire tree)
  const anyNexus = $.getComponentByType(root, "nexus", true);
  assert(anyNexus !== null,
    "Recursive: Find any nexus in tree");

  // Test 3: Non-existent type returns null
  const nonExistent = $.getComponentByType(root, "sprite", true);
  assert(nonExistent === null,
    "Non-existent type returns null");
}

/**
 * Test Suite: getComponentsByType
 */
function testGetComponentsByType(root: nexus): void {
  section("getComponentsByType Tests");

  // Test 1: Non-recursive (immediate children only)
  const immediateChildren = $.getComponentsByType(root, "nexus", false);
  assert(Array.isArray(immediateChildren) && immediateChildren.length >= 5,
    `Non-recursive: Found immediate children (got ${immediateChildren.length}, expected >= 5)`);

  // Test 2: Recursive (all nodes in tree)
  const allNexuses = $.getComponentsByType(root, "nexus", true);
  assert(Array.isArray(allNexuses) && allNexuses.length > 100,
    `Recursive: Found many nodes (got ${allNexuses.length})`);

  // Test 3: Non-existent type returns empty array
  const noSprites = $.getComponentsByType(root, "sprite", true);
  assert(Array.isArray(noSprites) && noSprites.length === 0,
    "Non-existent type returns empty array");
}

/**
 * Test Suite: getComponentByName
 */
function testGetComponentByName(root: nexus): void {
  section("getComponentByName Tests");

  // Test 1: Find immediate child by name
  const immediateChild = $.getComponentByName(root, "0", false);
  assert(immediateChild !== null && immediateChild.name === "0",
    "Find immediate child by name");

  // Test 2: Find deep node recursively
  const deepNode = $.getComponentByName(root, "0-1-2-3", true);
  assert(deepNode !== null && deepNode.name === "0-1-2-3",
    "Find deep node recursively (0-1-2-3)");

  // Test 3: Non-recursive doesn't find deep nodes
  const notFound = $.getComponentByName(root, "0-1-2-3", false);
  assert(notFound === null,
    "Non-recursive doesn't find deep nodes");

  // Test 4: Non-existent name returns null
  const noMatch = $.getComponentByName(root, "NonExistentName", true);
  assert(noMatch === null,
    "Non-existent name returns null");
}

/**
 * Test Suite: getComponentsByName
 */
async function testGetComponentsByName(root: nexus): Promise<void> {
  section("getComponentsByName Tests");

  // Test 1: Multiple components with same name
  const dupe1 = await newComponent("nexus", { name: "Duplicate" });
  const dupe2 = await newComponent("nexus", { name: "Duplicate" });
  const dupe3 = await newComponent("nexus", { name: "Duplicate" });

  $.addComponent(root, dupe1!);
  $.addComponent(root, dupe2!);
  $.addComponent(root, dupe3!);

  const duplicates = $.getComponentsByName(root, "Duplicate", false);
  assert(duplicates.length === 3,
    `Find multiple components with same name (got ${duplicates.length})`);

  // Test 2: Unique name returns single-element array
  const unique = $.getComponentsByName(root, "0-2", true);
  assert(unique.length === 1 && unique[0].name === "0-2",
    "Unique name returns single-element array");

  // Test 3: Non-existent returns empty array
  const none = $.getComponentsByName(root, "NoSuchName", true);
  assert(none.length === 0,
    "Non-existent name returns empty array");
}

/**
 * Test Suite: getComponentById
 */
function testGetComponentById(root: nexus): void {
  section("getComponentById Tests");

  // Test 1: Find immediate child by ID
  const immediateChild = $.getComponentByType(root, "nexus", false);
  assert(immediateChild !== null, "Get immediate child");

  const childId = immediateChild!.id!;
  const foundChild = $.getComponentById(root, childId, false);
  assert(foundChild !== null && foundChild.id === childId,
    "Find immediate child by ID (non-recursive)");

  // Test 2: Find child by ID recursively
  const deepChild = $.getComponentByType(root, "nexus", true);
  assert(deepChild !== null, "Get a child component");

  const deepChildId = deepChild!.id!;
  const foundDeepChild = $.getComponentById(root, deepChildId, true);
  assert(foundDeepChild !== null && foundDeepChild.id === deepChildId,
    "Find child by ID recursively");

  // Test 3: Invalid ID returns null
  const notFound = $.getComponentById(root, 999999, true);
  assert(notFound === null,
    "Invalid ID returns null");
}

/**
 * Test Suite: getComponentsById
 */
function testGetComponentsById(root: nexus): void {
  section("getComponentsById Tests");

  // Test 1: Find by existing ID
  const child = $.getComponentByType(root, "nexus", true);
  const childId = child!.id!;
  const matches = $.getComponentsById(root, childId, true);

  assert(matches.length >= 1,
    `Find component(s) by ID (got ${matches.length})`);

  // Test 2: Non-existent ID returns empty array
  const noMatches = $.getComponentsById(root, 999999, true);
  assert(noMatches.length === 0,
    "Non-existent ID returns empty array");

  // Test 3: Non-recursive vs recursive behavior
  const testChild = $.getComponentByType(root, "nexus", false);
  const testChildId = testChild!.id!;

  const nonRecursive = $.getComponentsById(root, testChildId, false);
  const recursive = $.getComponentsById(root, testChildId, true);

  assert(nonRecursive.length > 0 || recursive.length > 0,
    "Query returns results in at least one mode");
}

/**
 * Test Suite: getComponentByTypeAndName
 */
async function testGetComponentByTypeAndName(root: nexus): Promise<void> {
  section("getComponentByTypeAndName Tests");

  // Test 1: Find by exact type and name
  const found = $.getComponentByTypeAndName(root, "nexus", "0-1", true);
  assert(found !== null && found.name === "0-1" && found.type === "nexus",
    "Find component by type and name");

  // Test 2: Wrong type returns null
  const wrongType = $.getComponentByTypeAndName(root, "sprite", "0-1", true);
  assert(wrongType === null,
    "Wrong type returns null");

  // Test 3: Wrong name returns null
  const wrongName = $.getComponentByTypeAndName(root, "nexus", "NoSuchName", true);
  assert(wrongName === null,
    "Wrong name returns null");

  // Test 4: Non-recursive limitation
  const deep = $.getComponentByTypeAndName(root, "nexus", "0-1-2-3", false);
  assert(deep === null,
    "Non-recursive doesn't find deep nodes");
}

/**
 * Test Suite: getComponentsByTypeAndName
 */
async function testGetComponentsByTypeAndName(root: nexus): Promise<void> {
  section("getComponentsByTypeAndName Tests");

  // Test 1: Find all matching type and name
  const matches = $.getComponentsByTypeAndName(root, "nexus", "0", false);
  assert(matches.length > 0,
    "Find components by type and name (immediate child)");

  // Test 2: Add duplicates and find all
  const dupe1 = await newComponent("nexus", { name: "TypeAndName" });
  const dupe2 = await newComponent("nexus", { name: "TypeAndName" });
  $.addComponent(root, dupe1!);
  $.addComponent(root, dupe2!);

  const dupes = $.getComponentsByTypeAndName(root, "nexus", "TypeAndName", false);
  assert(dupes.length === 2,
    `Find multiple matches (got ${dupes.length})`);

  // Test 3: Wrong type returns empty array
  const wrongType = $.getComponentsByTypeAndName(root, "sprite", "Root", true);
  assert(wrongType.length === 0,
    "Wrong type returns empty array");
}

/**
 * Test Suite: dispose
 */
function testDispose(root: nexus): void {
  section("dispose Tests");

  // Test 1: Create a small sub-tree for disposal
  const subRoot = $.getComponentByName(root, "4", false) as nexus;
  assert(subRoot !== null, "Find sub-tree root (node '4')");

  const childrenBefore = $.getComponentsByType(subRoot!, "nexus", true);
  const childCountBefore = childrenBefore.length;
  assert(childCountBefore > 0,
    `Sub-tree has children before disposal (${childCountBefore})`);

  // Test 2: Dispose the sub-tree
  $.dispose(subRoot!);
  assert(subRoot!._disposed === true, "Sub-tree root marked as disposed");
  assert(subRoot!.components.length === 0, "Sub-tree children array cleared");

  // Test 3: Children are also disposed (depth-first)
  const childDisposed = childrenBefore.every((c: ComponentData) => c._disposed === true);
  assert(childDisposed, "All children marked as disposed (depth-first)");
}

/**
 * Main test runner
 */
async function runTests(): Promise<void> {
  console.log(`${colors.blue}╔════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.blue}║   Omosuen Nexus Component Unit Tests   ║${colors.reset}`);
  console.log(`${colors.blue}╚════════════════════════════════════════╝${colors.reset}\n`);

  // Build test tree
  let root: nexus;
  try {
    root = await timeOperation("Tree creation", () =>
      createBranchingTree(5, 5)
    );
  } catch (error) {
    console.error(`${colors.red}✗ Failed to create test tree:${colors.reset}`, error);
    process.exit(1);
  }

  // Run all test suites
  try {
    await testAddComponent(root);
    await testAddComponents(root);
    testGetComponentByType(root);
    testGetComponentsByType(root);
    testGetComponentByName(root);
    await testGetComponentsByName(root);
    testGetComponentById(root);
    testGetComponentsById(root);
    await testGetComponentByTypeAndName(root);
    await testGetComponentsByTypeAndName(root);
    testDispose(root);
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
  console.log(`\n${colors.yellow}Pass Rate: ${passRate}%${colors.reset}\n`);

  // Exit with appropriate code
  process.exit(testsFailed > 0 ? 1 : 0);
}

// Execute tests
runTests().catch((error) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
