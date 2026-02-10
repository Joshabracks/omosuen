// Array3D Compression Comparison Test
// Compares Array3Dc, Array3Di, and Array3Dic on a large RGBA color pattern dataset

import { Array3D, Array3Dc, Array3Di, Array3Dic, Vector3D } from '../src/math/index.js';

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

interface CompressionResult {
  name: string;
  sizeBytes: number;
  compressionRatio: number;
  buildTimeMs: number;
  verificationPassed: boolean;
}

/**
 * Generate a 100x100x20 array where values are arranged into 10x10x10 cube groupings
 * Each cube grouping is filled with a single 8-bit value (0-255)
 * The pattern creates 200 different cubes (10x10x2), each with a solid block of one value
 */
function generateColorPatternData(): Array3D<number> {
  const size = new Vector3D(100, 100, 20);
  const data = new Array3D<number>(size, 0);

  // Calculate cube grouping dimensions: 10x10x10 cubes
  const cubeSize = 10;
  const cubesX = Math.floor(size.x / cubeSize); // 10 cubes in X
  const cubesY = Math.floor(size.y / cubeSize); // 10 cubes in Y
  const cubesZ = Math.floor(size.z / cubeSize); // 2 cubes in Z

  // Total cubes = 10 * 10 * 2 = 200 cubes
  let valueIndex = 0;

  // Fill each cube grouping with a single uniform value (0-255)
  for (let cz = 0; cz < cubesZ; cz++) {
    for (let cy = 0; cy < cubesY; cy++) {
      for (let cx = 0; cx < cubesX; cx++) {
        // Use a single 8-bit value (0-255) for this entire cube
        // Cycle through values to create variety
        const blockValue = valueIndex % 256;
        valueIndex++;

        // Fill the entire cube with this single value
        for (let z = cz * cubeSize; z < (cz + 1) * cubeSize && z < size.z; z++) {
          for (let y = cy * cubeSize; y < (cy + 1) * cubeSize && y < size.y; y++) {
            for (let x = cx * cubeSize; x < (cx + 1) * cubeSize && x < size.x; x++) {
              const index = z * size.x * size.y + y * size.x + x;
              data.value[index] = blockValue;
            }
          }
        }
      }
    }
  }

  return data;
}

/**
 * Calculate memory size of Array3D
 */
function getArray3DSize(array: Array3D<number>): number {
  // JavaScript numbers are 8 bytes each (64-bit floats)
  return array.value.length * 8;
}

/**
 * Calculate memory size of Array3Dc (RLE compressed)
 */
function getArray3DcSize(array: Array3Dc): number {
  // Size object (3 numbers * 8 bytes) + values array + counts Uint32Array
  const sizeObjectBytes = 3 * 8;
  const valuesBytes = array.values.length * 8; // numbers are 8 bytes each
  const countsBytes = array.counts.byteLength;
  return sizeObjectBytes + valuesBytes + countsBytes;
}

/**
 * Calculate memory size of Array3Di (bit-packed)
 */
function getArray3DiSize(array: Array3Di): number {
  // Size object (3 numbers * 8 bytes) + typed array
  const sizeObjectBytes = 3 * 8;
  const valuesBytes = array.data.byteLength;
  return sizeObjectBytes + valuesBytes;
}

/**
 * Calculate memory size of Array3Dic (bit-packed + RLE)
 */
function getArray3DicSize(array: Array3Dic): number {
  // Size object (3 numbers * 8 bytes) + values array + counts Uint32Array
  const sizeObjectBytes = 3 * 8;
  const valuesBytes = array.values.length * 8; // numbers are 8 bytes each
  const countsBytes = array.counts.byteLength;
  return sizeObjectBytes + valuesBytes + countsBytes;
}

/**
 * Verify that the expanded array matches the original
 */
function verifyData(original: Array3D<number>, expanded: Array3D<number>): boolean {
  if (original.value.length !== expanded.value.length) {
    return false;
  }

  for (let i = 0; i < original.value.length; i++) {
    if (original.value[i] !== expanded.value[i]) {
      console.log(
        `${colors.red}Mismatch at index ${i}: original=${original.value[i]}, expanded=${expanded.value[i]}${colors.reset}`,
      );
      return false;
    }
  }

  return true;
}

/**
 * Run the compression comparison test
 */
export function runComparisonTest(): boolean {
  console.log(
    `\n${colors.bright}${colors.cyan}${'='.repeat(100)}${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.cyan}Array3D Compression Comparison Test${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.cyan}Dataset: 100x100x20 with 10x10x10 solid-value cube blocks${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.cyan}${'='.repeat(100)}${colors.reset}\n`,
  );

  // Generate test data
  console.log(`${colors.bright}Generating color pattern data...${colors.reset}`);
  const startGenerate = performance.now();
  const originalData = generateColorPatternData();
  const generateTime = performance.now() - startGenerate;

  const originalSize = getArray3DSize(originalData);
  const totalValues = originalData.size.x * originalData.size.y * originalData.size.z;
  const totalCubes = 10 * 10 * 2; // 200 cubes of 10x10x10

  console.log(`  ${colors.green}✓${colors.reset} Generated ${totalValues.toLocaleString()} values in ${totalCubes} solid blocks`);
  console.log(`  ${colors.green}✓${colors.reset} Dimensions: ${originalData.size.x}x${originalData.size.y}x${originalData.size.z}`);
  console.log(`  ${colors.green}✓${colors.reset} Block size: 10x10x10 (1,000 values each)`);
  console.log(`  ${colors.green}✓${colors.reset} Original size: ${originalSize.toLocaleString()} bytes`);
  console.log(`  ${colors.green}✓${colors.reset} Generation time: ${generateTime.toFixed(2)}ms\n`);

  const results: CompressionResult[] = [];

  // Test Array3Dc (RLE only)
  console.log(`${colors.bright}${colors.blue}Testing Array3Dc (RLE Compression)...${colors.reset}`);
  try {
    const startDc = performance.now();
    const array3Dc = new Array3Dc(originalData);
    const buildTimeDc = performance.now() - startDc;

    const sizeDc = getArray3DcSize(array3Dc);
    const expandedDc = array3Dc.expand();
    const verifiedDc = verifyData(originalData, expandedDc);

    results.push({
      name: 'Array3Dc (RLE)',
      sizeBytes: sizeDc,
      compressionRatio: originalSize / sizeDc,
      buildTimeMs: buildTimeDc,
      verificationPassed: verifiedDc,
    });

    console.log(`  ${colors.green}✓${colors.reset} Compressed size: ${sizeDc.toLocaleString()} bytes`);
    console.log(`  ${colors.green}✓${colors.reset} Compression ratio: ${(originalSize / sizeDc).toFixed(2)}x`);
    console.log(`  ${colors.green}✓${colors.reset} Build time: ${buildTimeDc.toFixed(2)}ms`);
    console.log(`  ${colors.green}✓${colors.reset} Verification: ${verifiedDc ? 'PASSED' : 'FAILED'}\n`);
  } catch (error) {
    console.log(`  ${colors.red}✗ Error: ${error}${colors.reset}\n`);
    results.push({
      name: 'Array3Dc (RLE)',
      sizeBytes: 0,
      compressionRatio: 0,
      buildTimeMs: 0,
      verificationPassed: false,
    });
  }

  // Test Array3Di (Bit-packing only - 32-bit [8,8,8,8] packs 4 values per int)
  console.log(`${colors.bright}${colors.blue}Testing Array3Di (Bit-Packing: 32-bit [8,8,8,8])...${colors.reset}`);
  try {
    const startDi = performance.now();
    const array3Di = new Array3Di(originalData, 32, [8, 8, 8, 8], 'clamp');
    const buildTimeDi = performance.now() - startDi;

    const sizeDi = getArray3DiSize(array3Di);
    const expandedDi = array3Di.expand();
    const verifiedDi = verifyData(originalData, expandedDi);

    results.push({
      name: 'Array3Di (Bit-Pack)',
      sizeBytes: sizeDi,
      compressionRatio: originalSize / sizeDi,
      buildTimeMs: buildTimeDi,
      verificationPassed: verifiedDi,
    });

    console.log(`  ${colors.green}✓${colors.reset} Compressed size: ${sizeDi.toLocaleString()} bytes`);
    console.log(`  ${colors.green}✓${colors.reset} Compression ratio: ${(originalSize / sizeDi).toFixed(2)}x`);
    console.log(`  ${colors.green}✓${colors.reset} Build time: ${buildTimeDi.toFixed(2)}ms`);
    console.log(`  ${colors.green}✓${colors.reset} Verification: ${verifiedDi ? 'PASSED' : 'FAILED'}\n`);
  } catch (error) {
    console.log(`  ${colors.red}✗ Error: ${error}${colors.reset}\n`);
    results.push({
      name: 'Array3Di (Bit-Pack)',
      sizeBytes: 0,
      compressionRatio: 0,
      buildTimeMs: 0,
      verificationPassed: false,
    });
  }

  // Test Array3Dic (Bit-packing + RLE - 32-bit [8,8,8,8] then RLE)
  console.log(
    `${colors.bright}${colors.blue}Testing Array3Dic (Bit-Packing + RLE: 32-bit [8,8,8,8])...${colors.reset}`,
  );
  try {
    const startDic = performance.now();
    const array3Dic = new Array3Dic(originalData, 32, [8, 8, 8, 8], 'clamp');
    const buildTimeDic = performance.now() - startDic;

    const sizeDic = getArray3DicSize(array3Dic);
    const expandedDic = array3Dic.expand();
    const verifiedDic = verifyData(originalData, expandedDic);

    results.push({
      name: 'Array3Dic (Bit-Pack + RLE)',
      sizeBytes: sizeDic,
      compressionRatio: originalSize / sizeDic,
      buildTimeMs: buildTimeDic,
      verificationPassed: verifiedDic,
    });

    console.log(`  ${colors.green}✓${colors.reset} Compressed size: ${sizeDic.toLocaleString()} bytes`);
    console.log(`  ${colors.green}✓${colors.reset} Compression ratio: ${(originalSize / sizeDic).toFixed(2)}x`);
    console.log(`  ${colors.green}✓${colors.reset} Build time: ${buildTimeDic.toFixed(2)}ms`);
    console.log(`  ${colors.green}✓${colors.reset} Verification: ${verifiedDic ? 'PASSED' : 'FAILED'}\n`);
  } catch (error) {
    console.log(`  ${colors.red}✗ Error: ${error}${colors.reset}\n`);
    results.push({
      name: 'Array3Dic (Bit-Pack + RLE)',
      sizeBytes: 0,
      compressionRatio: 0,
      buildTimeMs: 0,
      verificationPassed: false,
    });
  }

  // Print comparison summary
  console.log(
    `${colors.bright}${colors.magenta}${'='.repeat(100)}${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.magenta}Compression Summary${colors.reset}`,
  );
  console.log(
    `${colors.bright}${colors.magenta}${'='.repeat(100)}${colors.reset}\n`,
  );

  console.log(
    `${colors.bright}Original Array3D:${colors.reset} ${originalSize.toLocaleString()} bytes\n`,
  );

  // Sort results by compression ratio (best first)
  results.sort((a, b) => b.compressionRatio - a.compressionRatio);

  for (const result of results) {
    const savingsBytes = originalSize - result.sizeBytes;
    const savingsPercent = ((savingsBytes / originalSize) * 100).toFixed(1);

    console.log(`${colors.bright}${colors.cyan}${result.name}:${colors.reset}`);
    console.log(`  Size: ${result.sizeBytes.toLocaleString()} bytes`);
    console.log(
      `  Compression: ${colors.green}${result.compressionRatio.toFixed(2)}x${colors.reset}`,
    );
    console.log(
      `  Savings: ${colors.green}${savingsBytes.toLocaleString()} bytes (${savingsPercent}%)${colors.reset}`,
    );
    console.log(`  Build Time: ${result.buildTimeMs.toFixed(2)}ms`);
    console.log(
      `  Verification: ${result.verificationPassed ? `${colors.green}PASSED${colors.reset}` : `${colors.red}FAILED${colors.reset}`}`,
    );
    console.log();
  }

  // Print winner
  const winner = results[0];
  if (winner.compressionRatio > 0) {
    console.log(
      `${colors.bright}${colors.green}Best Compression: ${winner.name} at ${winner.compressionRatio.toFixed(2)}x${colors.reset}\n`,
    );
  }

  // Print relative comparison
  console.log(`${colors.bright}${colors.yellow}Relative Comparison:${colors.reset}`);
  if (results.length >= 3) {
    const dicResult = results.find((r) => r.name.includes('Array3Dic'));
    const diResult = results.find((r) => r.name.includes('Array3Di'));
    const dcResult = results.find((r) => r.name.includes('Array3Dc'));

    if (dicResult && diResult) {
      const dicVsDi = (diResult.sizeBytes / dicResult.sizeBytes).toFixed(2);
      console.log(
        `  Array3Dic vs Array3Di: ${colors.cyan}${dicVsDi}x smaller${colors.reset}`,
      );
    }

    if (dicResult && dcResult) {
      const dicVsDc = (dcResult.sizeBytes / dicResult.sizeBytes).toFixed(2);
      console.log(
        `  Array3Dic vs Array3Dc: ${colors.cyan}${dicVsDc}x smaller${colors.reset}`,
      );
    }

    if (diResult && dcResult) {
      const diVsDc = (dcResult.sizeBytes / diResult.sizeBytes).toFixed(2);
      console.log(
        `  Array3Di vs Array3Dc: ${colors.cyan}${diVsDc}x ${diResult.sizeBytes < dcResult.sizeBytes ? 'smaller' : 'larger'}${colors.reset}`,
      );
    }
  }

  console.log(
    `\n${colors.bright}${colors.magenta}${'='.repeat(100)}${colors.reset}\n`,
  );

  // Check if all tests passed
  const allPassed = results.every((r) => r.verificationPassed);
  if (allPassed) {
    console.log(
      `${colors.bright}${colors.green}All compression methods verified successfully! ✓${colors.reset}\n`,
    );
  } else {
    console.log(
      `${colors.bright}${colors.red}Some compression methods failed verification! ✗${colors.reset}\n`,
    );
  }

  return allPassed;
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const success = runComparisonTest();
  process.exit(success ? 0 : 1);
}
