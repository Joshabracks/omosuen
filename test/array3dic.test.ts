// Array3Dic Unit Test
// Tests bit packing + RLE compression with diverse data sets

import { Array3D, Array3Di, Array3Dic, Vector3D } from '../src/math/index.js';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

interface TestConfig {
  name: string;
  bitWidth: 8 | 16 | 32;
  bitPackingConfig?: Array<1 | 2 | 4 | 8 | 16>;
  overflow: 'mod' | 'clamp' | 'fail';
}

interface TestResult {
  configName: string;
  dataSetName: string;
  originalSize: number;
  array3DiSize: number;
  array3DicSize: number;
  array3DiRatio: number;
  array3DicRatio: number;
  totalRatio: number;
  rleCompressionGain: number;
  passed: boolean;
  error?: string;
}

// Generate diverse Array3D test data sets
function generateTestDataSets(): Array<{ name: string; data: Array3D<number> }> {
  const dataSets: Array<{ name: string; data: Array3D<number> }> = [];

  // 1. Uniform data (perfect for RLE)
  const uniformData = new Array3D<number>(new Vector3D(20, 20, 20), 42);
  dataSets.push({ name: 'Uniform (20x20x20)', data: uniformData });

  // 2. Layered terrain (high RLE potential)
  const layeredData = new Array3D<number>(new Vector3D(16, 16, 16), 0);
  for (let z = 0; z < 16; z++) {
    const material = Math.floor(z / 4); // 4 layers of 4 different materials
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        layeredData.value[z * 256 + y * 16 + x] = material;
      }
    }
  }
  dataSets.push({ name: 'Layered Terrain (16x16x16)', data: layeredData });

  // 3. Sparse data (mostly zeros with scattered values)
  const sparseData = new Array3D<number>(new Vector3D(32, 32, 8), 0);
  for (let i = 0; i < 100; i++) {
    const idx = Math.floor(Math.random() * sparseData.value.length);
    sparseData.value[idx] = Math.floor(Math.random() * 16) + 1;
  }
  dataSets.push({ name: 'Sparse 1% (32x32x8)', data: sparseData });

  // 4. RGBA image with solid regions (perfect for bit-packing + RLE)
  const imageData = new Array3D<number>(new Vector3D(64, 64, 1), 0);
  // Create quadrants of solid colors
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const idx = y * 64 * 4 + x * 4;
      if (x < 32 && y < 32) {
        // Red quadrant
        imageData.value[idx] = 255;
        imageData.value[idx + 3] = 255;
      } else if (x >= 32 && y < 32) {
        // Green quadrant
        imageData.value[idx + 1] = 255;
        imageData.value[idx + 3] = 255;
      } else if (x < 32 && y >= 32) {
        // Blue quadrant
        imageData.value[idx + 2] = 255;
        imageData.value[idx + 3] = 255;
      } else {
        // Yellow quadrant
        imageData.value[idx] = 255;
        imageData.value[idx + 1] = 255;
        imageData.value[idx + 3] = 255;
      }
    }
  }
  dataSets.push({ name: 'RGBA Quadrants (64x64x1)', data: imageData });

  // 5. Entity data (health, stamina, level, flags, type, state)
  const entityData = new Array3D<number>(new Vector3D(6, 100, 1), 0);
  for (let entity = 0; entity < 100; entity++) {
    const offset = entity * 6;
    // Most entities have similar stats (good for RLE after packing)
    const entityType = Math.floor(entity / 25); // 4 entity types
    entityData.value[offset] = 100; // health
    entityData.value[offset + 1] = 100; // stamina
    entityData.value[offset + 2] = entityType + 1; // level
    entityData.value[offset + 3] = 0; // flags
    entityData.value[offset + 4] = entityType; // type
    entityData.value[offset + 5] = 0; // state
  }
  dataSets.push({ name: 'Entity Data (6x100x1)', data: entityData });

  // 6. Repeating pattern (excellent RLE)
  const patternData = new Array3D<number>(new Vector3D(20, 20, 4), 0);
  const pattern = [1, 2, 3, 4];
  for (let z = 0; z < 4; z++) {
    const value = pattern[z];
    for (let i = 0; i < 400; i++) {
      patternData.value[z * 400 + i] = value;
    }
  }
  dataSets.push({ name: 'Repeating Pattern (20x20x4)', data: patternData });

  // 7. Gradient (poor RLE, tests worst case)
  const gradientData = new Array3D<number>(new Vector3D(16, 16, 8), 0);
  for (let i = 0; i < gradientData.value.length; i++) {
    gradientData.value[i] = i % 256;
  }
  dataSets.push({ name: 'Gradient (16x16x8)', data: gradientData });

  // 8. Binary flags (can pack 8 into 1 byte, then RLE)
  const flagData = new Array3D<number>(new Vector3D(64, 64, 1), 0);
  for (let i = 0; i < flagData.value.length; i++) {
    // Clusters of flags
    flagData.value[i] = Math.floor(i / 64) % 2;
  }
  dataSets.push({ name: 'Binary Flags (64x64x1)', data: flagData });

  // 9. Voxel chunk with air pockets
  const voxelData = new Array3D<number>(new Vector3D(16, 16, 16), 1);
  // Carve out some spherical air pockets
  const center = new Vector3D(8, 8, 8);
  for (let z = 0; z < 16; z++) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const dx = x - center.x;
        const dy = y - center.y;
        const dz = z - center.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < 4) {
          voxelData.value[z * 256 + y * 16 + x] = 0; // Air
        }
      }
    }
  }
  dataSets.push({ name: 'Voxel Chunk w/Air (16x16x16)', data: voxelData });

  // 10. Small bit values (2-bit range, good for packing + RLE)
  const smallBitData = new Array3D<number>(new Vector3D(32, 32, 2), 0);
  for (let i = 0; i < smallBitData.value.length; i++) {
    // Create runs of same value
    smallBitData.value[i] = Math.floor(i / 128) % 4;
  }
  dataSets.push({ name: 'Small 2-bit values (32x32x2)', data: smallBitData });

  return dataSets;
}

// Test configurations
function getTestConfigurations(): TestConfig[] {
  return [
    // Direct 8-bit with RLE
    {
      name: '8-bit direct + RLE',
      bitWidth: 8,
      overflow: 'mod',
    },
    // RGBA bit packing + RLE
    {
      name: '32-bit RGBA [8,8,8,8] + RLE',
      bitWidth: 32,
      bitPackingConfig: [8, 8, 8, 8],
      overflow: 'clamp',
    },
    // Entity data packing + RLE
    {
      name: '32-bit entity [8,8,8,4,2,2] + RLE',
      bitWidth: 32,
      bitPackingConfig: [8, 8, 8, 4, 2, 2],
      overflow: 'clamp',
    },
    // Aggressive bit packing + RLE
    {
      name: '8-bit [2,2,2,2] + RLE',
      bitWidth: 8,
      bitPackingConfig: [2, 2, 2, 2],
      overflow: 'mod',
    },
    // Binary packing + RLE
    {
      name: '8-bit [1,1,1,1,1,1,1,1] + RLE',
      bitWidth: 8,
      bitPackingConfig: [1, 1, 1, 1, 1, 1, 1, 1],
      overflow: 'clamp',
    },
  ];
}

// Calculate memory sizes
function calculateOriginalSize(data: Array3D<number>): number {
  return data.value.length * 8; // JavaScript numbers are 8 bytes
}

function calculateArray3DiSize(arr3di: Array3Di): number {
  return arr3di.data.byteLength;
}

function calculateArray3DicSize(arr3dic: Array3Dic): number {
  // values array + counts typed array + cumulative counts typed array
  return (
    arr3dic.values.length * 4 + // Packed integers as 32-bit
    arr3dic.counts.byteLength +
    8 // Rough estimate for cumulative counts overhead
  );
}

// Validate unpacked data matches original
function validateData(
  original: Array3D<number>,
  unpacked: Array3D<number>,
  config: TestConfig,
): boolean {
  if (original.value.length !== unpacked.value.length) {
    console.log(
      `  ${colors.red}Length mismatch: ${original.value.length} vs ${unpacked.value.length}${colors.reset}`,
    );
    return false;
  }

  for (let i = 0; i < original.value.length; i++) {
    let expectedValue = original.value[i];

    // Apply overflow logic to expected value
    if (config.bitPackingConfig) {
      const slotIndex = i % config.bitPackingConfig.length;
      const bits = config.bitPackingConfig[slotIndex];
      const maxValue = (1 << bits) - 1;
      expectedValue = applyOverflow(expectedValue, maxValue, config.overflow);
    } else {
      const maxValue = (1 << config.bitWidth) - 1;
      expectedValue = applyOverflow(expectedValue, maxValue, config.overflow);
    }

    if (unpacked.value[i] !== expectedValue) {
      console.log(
        `  ${colors.red}Mismatch at index ${i}: expected ${expectedValue}, got ${unpacked.value[i]}${colors.reset}`,
      );
      return false;
    }
  }

  return true;
}

function applyOverflow(
  value: number,
  maxValue: number,
  mode: 'mod' | 'clamp' | 'fail',
): number {
  switch (mode) {
    case 'mod':
      if (value < 0) {
        return ((value % (maxValue + 1)) + (maxValue + 1)) % (maxValue + 1);
      }
      return value % (maxValue + 1);
    case 'clamp':
      return Math.max(0, Math.min(value, maxValue));
    case 'fail':
      if (value < 0 || value > maxValue) {
        throw new Error(`Value ${value} out of range`);
      }
      return value;
  }
}

// Run test for a specific configuration and data set
function runTest(
  dataSet: { name: string; data: Array3D<number> },
  config: TestConfig,
): TestResult {
  try {
    // Skip incompatible combinations
    if (config.bitPackingConfig) {
      if (dataSet.data.value.length % config.bitPackingConfig.length !== 0) {
        return {
          configName: config.name,
          dataSetName: dataSet.name,
          originalSize: 0,
          array3DiSize: 0,
          array3DicSize: 0,
          array3DiRatio: 0,
          array3DicRatio: 0,
          totalRatio: 0,
          rleCompressionGain: 0,
          passed: true,
          error: 'SKIPPED (length mismatch)',
        };
      }
    }

    // Create Array3Di (bit packing only)
    const array3Di = new Array3Di(
      dataSet.data,
      config.bitWidth,
      config.bitPackingConfig,
      config.overflow,
    );

    // Create Array3Dic (bit packing + RLE)
    const array3Dic = new Array3Dic(
      dataSet.data,
      config.bitWidth,
      config.bitPackingConfig,
      config.overflow,
    );

    // Calculate sizes
    const originalSize = calculateOriginalSize(dataSet.data);
    const array3DiSize = calculateArray3DiSize(array3Di);
    const array3DicSize = calculateArray3DicSize(array3Dic);

    const array3DiRatio = originalSize / array3DiSize;
    const array3DicRatio = originalSize / array3DicSize;
    const rleCompressionGain = array3DiSize / array3DicSize;

    // Expand and validate
    const unpacked = array3Dic.expand();
    const isValid = validateData(dataSet.data, unpacked, config);

    return {
      configName: config.name,
      dataSetName: dataSet.name,
      originalSize,
      array3DiSize,
      array3DicSize,
      array3DiRatio,
      array3DicRatio,
      totalRatio: array3DicRatio,
      rleCompressionGain,
      passed: isValid,
    };
  } catch (error) {
    return {
      configName: config.name,
      dataSetName: dataSet.name,
      originalSize: 0,
      array3DiSize: 0,
      array3DicSize: 0,
      array3DiRatio: 0,
      array3DicRatio: 0,
      totalRatio: 0,
      rleCompressionGain: 0,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Print test results
function printResults(results: TestResult[]): boolean {
  console.log(
    `\n${colors.bright}${colors.cyan}${'='.repeat(100)}${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.cyan}Array3Dic Unit Test Results (Bit Packing + RLE Compression)${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.cyan}${'='.repeat(100)}${colors.reset}\n`,
  );

  let totalTests = 0;
  let passedTests = 0;
  let skippedTests = 0;

  // Group by data set
  const dataSets = [...new Set(results.map((r) => r.dataSetName))];

  for (const dataSetName of dataSets) {
    console.log(
      `${colors.bright}${colors.blue}Dataset: ${dataSetName}${colors.reset}`,
    );
    console.log(`${colors.blue}${'-'.repeat(100)}${colors.reset}`);

    const dataSetResults = results.filter((r) => r.dataSetName === dataSetName);

    for (const result of dataSetResults) {
      totalTests++;

      if (result.error === 'SKIPPED (length mismatch)') {
        skippedTests++;
        console.log(
          `  ${colors.yellow}⊘${colors.reset} ${result.configName.padEnd(40)} ${colors.yellow}SKIPPED${colors.reset}`,
        );
        continue;
      }

      if (result.passed) {
        passedTests++;
        const compression = `Bit:${result.array3DiRatio.toFixed(1)}x RLE:${result.rleCompressionGain.toFixed(1)}x Total:${result.totalRatio.toFixed(1)}x`;
        const sizes = `${result.originalSize}B → ${result.array3DiSize}B → ${result.array3DicSize}B`;
        console.log(
          `  ${colors.green}✓${colors.reset} ${result.configName.padEnd(40)} ${colors.green}PASS${colors.reset} | ${compression.padEnd(35)} | ${sizes}`,
        );
      } else {
        console.log(
          `  ${colors.red}✗${colors.reset} ${result.configName.padEnd(40)} ${colors.red}FAIL${colors.reset}`,
        );
        if (result.error) {
          console.log(`    ${colors.red}Error: ${result.error}${colors.reset}`);
        }
      }
    }

    console.log('');
  }

  // Summary
  console.log(
    `${colors.bright}${colors.cyan}${'='.repeat(100)}${colors.reset}`,
  );
  console.log(`${colors.bright}Summary:${colors.reset}`);
  console.log(
    `  Total Tests: ${totalTests} | Passed: ${colors.green}${passedTests}${colors.reset} | Failed: ${colors.red}${totalTests - passedTests - skippedTests}${colors.reset} | Skipped: ${colors.yellow}${skippedTests}${colors.reset}`,
  );

  const successRate =
    totalTests > 0
      ? ((passedTests / (totalTests - skippedTests)) * 100).toFixed(1)
      : '0.0';
  console.log(`  Success Rate: ${successRate}%`);
  console.log(
    `${colors.bright}${colors.cyan}${'='.repeat(100)}${colors.reset}\n`,
  );

  // Print test summary
  if (passedTests === totalTests - skippedTests && passedTests > 0) {
    console.log(
      `${colors.green}${colors.bright}All tests passed! ✓${colors.reset}\n`,
    );
  } else {
    console.log(
      `${colors.red}${colors.bright}Some tests failed! ✗${colors.reset}\n`,
    );
    // Return false to indicate failure (but don't exit)
    return false;
  }

  return true;
}

// Compression comparison report
function printCompressionReport(results: TestResult[]): void {
  console.log(
    `\n${colors.bright}${colors.magenta}${'='.repeat(100)}${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.magenta}Compression Comparison Report: Array3D → Array3Di → Array3Dic${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.magenta}${'='.repeat(100)}${colors.reset}\n`,
  );

  // Find best compression cases
  const validResults = results.filter((r) => !r.error && r.totalRatio > 0);

  if (validResults.length === 0) {
    console.log('No valid results to display.\n');
    return;
  }

  const best = validResults.reduce((max, r) =>
    r.totalRatio > max.totalRatio ? r : max,
  );

  console.log(
    `${colors.bright}${colors.green}🏆 Best Compression:${colors.reset}`,
  );
  console.log(
    `  Dataset: ${best.dataSetName}, Config: ${best.configName}`,
  );
  console.log(
    `  ${colors.cyan}Total: ${best.totalRatio.toFixed(1)}x${colors.reset} (Bit Packing: ${best.array3DiRatio.toFixed(1)}x × RLE: ${best.rleCompressionGain.toFixed(1)}x)`,
  );
  console.log(
    `  Size: ${best.originalSize.toLocaleString()}B → ${best.array3DicSize.toLocaleString()}B (saved ${((best.originalSize - best.array3DicSize) / best.originalSize * 100).toFixed(1)}%)\n`,
  );

  // Average compression by configuration
  const configs = [...new Set(validResults.map((r) => r.configName))];

  console.log(`${colors.bright}Average Compression by Configuration:${colors.reset}`);
  for (const config of configs) {
    const configResults = validResults.filter((r) => r.configName === config);
    const avgTotal =
      configResults.reduce((sum, r) => sum + r.totalRatio, 0) /
      configResults.length;
    const avgRLE =
      configResults.reduce((sum, r) => sum + r.rleCompressionGain, 0) /
      configResults.length;

    console.log(
      `  ${config.padEnd(40)} Total: ${colors.cyan}${avgTotal.toFixed(1)}x${colors.reset} (Avg RLE gain: ${avgRLE.toFixed(1)}x)`,
    );
  }

  console.log(
    `\n${colors.bright}${colors.magenta}${'='.repeat(100)}${colors.reset}\n`,
  );
}

// Main test execution
export function runArray3DicTests(): boolean {
  console.log(
    `\n${colors.bright}${colors.cyan}Starting Array3Dic Comprehensive Unit Tests...${colors.reset}\n`,
  );

  const dataSets = generateTestDataSets();
  const configurations = getTestConfigurations();

  console.log(
    `${colors.bright}Generated ${dataSets.length} diverse test data sets${colors.reset}`,
  );
  console.log(
    `${colors.bright}Testing ${configurations.length} different configurations${colors.reset}`,
  );
  console.log(
    `${colors.bright}Total test cases: ${dataSets.length * configurations.length}${colors.reset}\n`,
  );

  const results: TestResult[] = [];

  // Run all tests
  for (const dataSet of dataSets) {
    for (const config of configurations) {
      const result = runTest(dataSet, config);
      results.push(result);
    }
  }

  // Print compression report first
  printCompressionReport(results);

  // Print test results
  return printResults(results);
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const success = runArray3DicTests();
  process.exit(success ? 0 : 1);
}
