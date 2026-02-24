// Array3Di Unit Test
// Tests various configurations of Array3Di with diverse data sets

import { Array3D, Array3Di, Vector3D } from '../src/math/index.js';

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
  packedSize: number;
  compressionRatio: number;
  passed: boolean;
  error?: string;
}

// Generate 10 diverse Array3D test data sets
function generateTestDataSets(): Array<{ name: string; data: Array3D<number> }> {
  const dataSets: Array<{ name: string; data: Array3D<number> }> = [];

  // 1. Small uniform data (all zeros)
  const uniformData = new Array3D<number>(new Vector3D(4, 4, 4), 0);
  dataSets.push({ name: 'Uniform Zeros (4x4x4)', data: uniformData });

  // 2. Sequential integers
  const sequentialData = new Array3D<number>(new Vector3D(10, 10, 5), 0);
  for (let i = 0; i < sequentialData.value.length; i++) {
    sequentialData.value[i] = i % 256;
  }
  dataSets.push({ name: 'Sequential Integers (10x10x5)', data: sequentialData });

  // 3. Random 8-bit values
  const random8bit = new Array3D<number>(new Vector3D(8, 8, 8), 0);
  for (let i = 0; i < random8bit.value.length; i++) {
    random8bit.value[i] = Math.floor(Math.random() * 256);
  }
  dataSets.push({ name: 'Random 8-bit (8x8x8)', data: random8bit });

  // 4. RGBA color data (must be multiple of 4)
  const rgbaData = new Array3D<number>(new Vector3D(16, 4, 1), 0);
  for (let i = 0; i < rgbaData.value.length; i += 4) {
    rgbaData.value[i] = Math.floor(Math.random() * 256); // R
    rgbaData.value[i + 1] = Math.floor(Math.random() * 256); // G
    rgbaData.value[i + 2] = Math.floor(Math.random() * 256); // B
    rgbaData.value[i + 3] = Math.floor(Math.random() * 256); // A
  }
  dataSets.push({ name: 'RGBA Colors (16x4x1 = 64 values)', data: rgbaData });

  // 5. Small bit values (0-15, 4-bit range)
  const small4bit = new Array3D<number>(new Vector3D(12, 8, 2), 0);
  for (let i = 0; i < small4bit.value.length; i++) {
    small4bit.value[i] = Math.floor(Math.random() * 16);
  }
  dataSets.push({ name: 'Small 4-bit values (12x8x2)', data: small4bit });

  // 6. Entity data pattern (health, stamina, level, flags, type, state)
  // Must be multiple of 6 for [8,8,8,4,2,2] packing
  const entityData = new Array3D<number>(new Vector3D(6, 10, 1), 0);
  for (let entity = 0; entity < 10; entity++) {
    const offset = entity * 6;
    entityData.value[offset] = Math.floor(Math.random() * 256); // health (0-255)
    entityData.value[offset + 1] = Math.floor(Math.random() * 256); // stamina (0-255)
    entityData.value[offset + 2] = Math.floor(Math.random() * 100); // level (0-99)
    entityData.value[offset + 3] = Math.floor(Math.random() * 16); // flags (0-15, 4-bit)
    entityData.value[offset + 4] = Math.floor(Math.random() * 4); // type (0-3, 2-bit)
    entityData.value[offset + 5] = Math.floor(Math.random() * 4); // state (0-3, 2-bit)
  }
  dataSets.push({ name: 'Entity Data (6x10x1 = 60 values)', data: entityData });

  // 7. Binary flags (0 or 1)
  const binaryFlags = new Array3D<number>(new Vector3D(32, 32, 1), 0);
  for (let i = 0; i < binaryFlags.value.length; i++) {
    binaryFlags.value[i] = Math.random() > 0.5 ? 1 : 0;
  }
  dataSets.push({ name: 'Binary Flags (32x32x1)', data: binaryFlags });

  // 8. 16-bit range values
  const data16bit = new Array3D<number>(new Vector3D(8, 8, 4), 0);
  for (let i = 0; i < data16bit.value.length; i++) {
    data16bit.value[i] = Math.floor(Math.random() * 65536);
  }
  dataSets.push({ name: '16-bit Range (8x8x4)', data: data16bit });

  // 9. Sparse data (mostly zeros with some values)
  const sparseData = new Array3D<number>(new Vector3D(20, 20, 2), 0);
  for (let i = 0; i < sparseData.value.length; i++) {
    if (Math.random() < 0.1) {
      // 10% non-zero
      sparseData.value[i] = Math.floor(Math.random() * 256);
    }
  }
  dataSets.push({ name: 'Sparse Data 10% (20x20x2)', data: sparseData });

  // 10. Pattern data (repeating pattern)
  const patternData = new Array3D<number>(new Vector3D(16, 16, 2), 0);
  const pattern = [255, 128, 64, 32, 16, 8, 4, 2, 1, 0];
  for (let i = 0; i < patternData.value.length; i++) {
    patternData.value[i] = pattern[i % pattern.length];
  }
  dataSets.push({ name: 'Repeating Pattern (16x16x2)', data: patternData });

  return dataSets;
}

// Test configurations
function getTestConfigurations(): TestConfig[] {
  return [
    // Basic 8-bit storage
    {
      name: '8-bit direct (mod)',
      bitWidth: 8,
      overflow: 'mod',
    },
    {
      name: '8-bit direct (clamp)',
      bitWidth: 8,
      overflow: 'clamp',
    },
    // 16-bit storage
    {
      name: '16-bit direct (mod)',
      bitWidth: 16,
      overflow: 'mod',
    },
    {
      name: '16-bit packed [8,8] (clamp)',
      bitWidth: 16,
      bitPackingConfig: [8, 8],
      overflow: 'clamp',
    },
    // 32-bit storage
    {
      name: '32-bit direct (mod)',
      bitWidth: 32,
      overflow: 'mod',
    },
    {
      name: '32-bit RGBA [8,8,8,8] (clamp)',
      bitWidth: 32,
      bitPackingConfig: [8, 8, 8, 8],
      overflow: 'clamp',
    },
    {
      name: '32-bit entity [8,8,8,4,2,2] (clamp)',
      bitWidth: 32,
      bitPackingConfig: [8, 8, 8, 4, 2, 2],
      overflow: 'clamp',
    },
    {
      name: '32-bit flags [1,1,1,1,1,1,1,1,8,16] (mod)',
      bitWidth: 32,
      bitPackingConfig: [1, 1, 1, 1, 1, 1, 1, 1, 8, 16],
      overflow: 'mod',
    },
    // 8-bit with bit packing
    {
      name: '8-bit packed [4,4] (clamp)',
      bitWidth: 8,
      bitPackingConfig: [4, 4],
      overflow: 'clamp',
    },
    {
      name: '8-bit packed [2,2,2,2] (mod)',
      bitWidth: 8,
      bitPackingConfig: [2, 2, 2, 2],
      overflow: 'mod',
    },
  ];
}

// Validate unpacked data matches original
function validateData(
  original: Array3D<number>,
  unpacked: Array3D<number>,
  config: TestConfig,
): boolean {
  if (original.value.length !== unpacked.value.length) {
    return false;
  }

  for (let i = 0; i < original.value.length; i++) {
    let expectedValue = original.value[i];

    // Apply overflow logic to expected value
    if (config.bitPackingConfig) {
      // For packed data, determine which slot this value is in
      const slotIndex = i % config.bitPackingConfig.length;
      const bits = config.bitPackingConfig[slotIndex];
      const maxValue = (1 << bits) - 1;
      expectedValue = applyOverflow(expectedValue, maxValue, config.overflow);
    } else {
      // For direct storage
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

// Calculate memory size in bytes
function calculateMemorySize(arr3di: Array3Di): number {
  return arr3di.data.byteLength;
}

function calculateOriginalSize(data: Array3D<number>): number {
  // Assume original stores as numbers (8 bytes each in JavaScript)
  return data.value.length * 8;
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
          packedSize: 0,
          compressionRatio: 0,
          passed: true, // Skip, not an error
          error: 'SKIPPED (length mismatch)',
        };
      }
    }

    // Create Array3Di
    const packed = new Array3Di(
      dataSet.data,
      config.bitWidth,
      config.bitPackingConfig,
      config.overflow,
    );

    // Calculate sizes
    const originalSize = calculateOriginalSize(dataSet.data);
    const packedSize = calculateMemorySize(packed);
    const compressionRatio = originalSize / packedSize;

    // Expand and validate
    const unpacked = packed.expand();
    const isValid = validateData(dataSet.data, unpacked, config);

    return {
      configName: config.name,
      dataSetName: dataSet.name,
      originalSize,
      packedSize,
      compressionRatio,
      passed: isValid,
    };
  } catch (error) {
    return {
      configName: config.name,
      dataSetName: dataSet.name,
      originalSize: 0,
      packedSize: 0,
      compressionRatio: 0,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Print test results
function printResults(results: TestResult[]): boolean {
  console.log(
    `\n${colors.bright}${colors.cyan}${'='.repeat(80)}${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.cyan}Array3Di Unit Test Results${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.cyan}${'='.repeat(80)}${colors.reset}\n`,
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
    console.log(`${colors.blue}${'-'.repeat(80)}${colors.reset}`);

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
        const compressionStr = `${result.compressionRatio.toFixed(2)}x`;
        const sizeStr = `${result.originalSize}B → ${result.packedSize}B`;
        console.log(
          `  ${colors.green}✓${colors.reset} ${result.configName.padEnd(40)} ${colors.green}PASS${colors.reset} | ${compressionStr.padEnd(8)} | ${sizeStr}`,
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
  console.log(`${colors.bright}${colors.cyan}${'='.repeat(80)}${colors.reset}`);
  console.log(`${colors.bright}Summary:${colors.reset}`);
  console.log(
    `  Total Tests: ${totalTests} | Passed: ${colors.green}${passedTests}${colors.reset} | Failed: ${colors.red}${totalTests - passedTests - skippedTests}${colors.reset} | Skipped: ${colors.yellow}${skippedTests}${colors.reset}`,
  );

  const successRate =
    totalTests > 0
      ? ((passedTests / (totalTests - skippedTests)) * 100).toFixed(1)
      : '0.0';
  console.log(`  Success Rate: ${successRate}%`);
  console.log(`${colors.bright}${colors.cyan}${'='.repeat(80)}${colors.reset}\n`);

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

// Detailed size comparison report
function printSizeComparison(results: TestResult[]): void {
  console.log(
    `\n${colors.bright}${colors.magenta}${'='.repeat(80)}${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.magenta}Memory Size Comparison Report${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.magenta}${'='.repeat(80)}${colors.reset}\n`,
  );

  // Group by configuration
  const configs = [...new Set(results.map((r) => r.configName))];

  for (const configName of configs) {
    const configResults = results.filter(
      (r) => r.configName === configName && !r.error,
    );

    if (configResults.length === 0) continue;

    console.log(
      `${colors.bright}${colors.magenta}Configuration: ${configName}${colors.reset}`,
    );

    const avgCompression =
      configResults.reduce((sum, r) => sum + r.compressionRatio, 0) /
      configResults.length;

    console.log(
      `  Average Compression: ${colors.cyan}${avgCompression.toFixed(2)}x${colors.reset}`,
    );

    const totalOriginal = configResults.reduce(
      (sum, r) => sum + r.originalSize,
      0,
    );
    const totalPacked = configResults.reduce((sum, r) => sum + r.packedSize, 0);
    const totalSavings = totalOriginal - totalPacked;
    const savingsPercent = ((totalSavings / totalOriginal) * 100).toFixed(1);

    console.log(
      `  Total Original: ${totalOriginal.toLocaleString()} bytes`,
    );
    console.log(`  Total Packed:   ${totalPacked.toLocaleString()} bytes`);
    console.log(
      `  Total Savings:  ${colors.green}${totalSavings.toLocaleString()} bytes (${savingsPercent}%)${colors.reset}\n`,
    );
  }

  console.log(
    `${colors.bright}${colors.magenta}${'='.repeat(80)}${colors.reset}\n`,
  );
}

// Main test execution
export function runArray3DiTests(): boolean {
  console.log(
    `\n${colors.bright}${colors.cyan}Starting Array3Di Comprehensive Unit Tests...${colors.reset}\n`,
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

  // Print size comparison first
  printSizeComparison(results);

  // Print test results
  return printResults(results);
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const success = runArray3DiTests();
  process.exit(success ? 0 : 1);
}
