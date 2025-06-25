#!/usr/bin/env node

/**
 * Test Coverage Validation Script
 * 
 * Validates the complete testing infrastructure:
 * - Runs all integration tests
 * - Validates coverage thresholds
 * - Verifies test utilities work correctly
 * - Generates comprehensive test reports
 * - Proves Layer 1, 2, and 3 work together
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Logging utilities
const log = {
  info: (msg, data = {}) => {
    console.log(`ℹ️  ${msg}`, Object.keys(data).length ? JSON.stringify(data, null, 2) : '');
  },
  success: (msg, data = {}) => {
    console.log(`✅ ${msg}`, Object.keys(data).length ? JSON.stringify(data, null, 2) : '');
  },
  warning: (msg, data = {}) => {
    console.log(`⚠️  ${msg}`, Object.keys(data).length ? JSON.stringify(data, null, 2) : '');
  },
  error: (msg, data = {}) => {
    console.error(`❌ ${msg}`, Object.keys(data).length ? JSON.stringify(data, null, 2) : '');
  },
  header: (msg) => {
    console.log('');
    console.log(`🧪 ${msg}`);
    console.log('─'.repeat(60));
  }
};

/**
 * Test configuration
 */
const TEST_CONFIG = {
  coverageDir: path.join(rootDir, 'coverage'),
  testResultsDir: path.join(rootDir, 'test-results'),
  integrationTestsDir: path.join(rootDir, 'src', 'shared', 'tests', 'integration'),
  
  // Coverage thresholds (matching vitest.config.ts)
  coverageThresholds: {
    branches: 80,
    functions: 80,
    lines: 80,
    statements: 80
  },
  
  // Expected test files
  expectedTests: [
    'database.test.ts',
    'auth-middleware.test.ts', 
    'migrations.test.ts',
    'audit-logging.test.ts'
  ]
};

/**
 * Validate test environment
 */
function validateTestEnvironment() {
  log.header('Validating Test Environment');
  
  const requiredFiles = [
    'vitest.config.ts',
    'src/shared/tests/setup/global-setup.ts',
    'src/shared/tests/setup/test-setup.ts',
    'src/shared/tests/utils/testing.ts'
  ];

  const missing = [];
  const existing = [];

  for (const file of requiredFiles) {
    const filePath = path.join(rootDir, file);
    if (fs.existsSync(filePath)) {
      existing.push(file);
    } else {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    log.error('Missing required test files', { missing });
    return false;
  }

  log.success('Test environment validation passed', {
    existingFiles: existing.length,
    totalChecked: requiredFiles.length
  });

  return true;
}

/**
 * Validate integration tests exist
 */
function validateIntegrationTests() {
  log.header('Validating Integration Tests');
  
  if (!fs.existsSync(TEST_CONFIG.integrationTestsDir)) {
    log.error('Integration tests directory not found', {
      expected: TEST_CONFIG.integrationTestsDir
    });
    return false;
  }

  const existingTests = [];
  const missingTests = [];

  for (const testFile of TEST_CONFIG.expectedTests) {
    const testPath = path.join(TEST_CONFIG.integrationTestsDir, testFile);
    if (fs.existsSync(testPath)) {
      const content = fs.readFileSync(testPath, 'utf-8');
      existingTests.push({
        file: testFile,
        size: content.length,
        hasDescribe: content.includes('describe('),
        hasIt: content.includes('it('),
        hasExpect: content.includes('expect(')
      });
    } else {
      missingTests.push(testFile);
    }
  }

  if (missingTests.length > 0) {
    log.error('Missing integration test files', { missingTests });
    return false;
  }

  log.success('Integration tests validation passed', {
    existingTests: existingTests.length,
    totalExpected: TEST_CONFIG.expectedTests.length,
    testDetails: existingTests
  });

  return true;
}

/**
 * Run unit tests
 */
function runUnitTests() {
  log.header('Running Unit Tests');
  
  try {
    log.info('Executing unit tests for shared utilities...');
    
    const unitTestCommand = 'npx vitest run --dir src/shared --reporter=verbose';
    const unitTestOutput = execSync(unitTestCommand, {
      cwd: rootDir,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 60000 // 1 minute timeout
    });

    log.success('Unit tests completed successfully');
    
    // Parse basic test results
    const lines = unitTestOutput.split('\n');
    const testLines = lines.filter(line => 
      line.includes('✓') || line.includes('✗') || line.includes('PASS') || line.includes('FAIL')
    );

    if (testLines.length > 0) {
      log.info('Unit test summary', {
        outputLines: testLines.slice(0, 10) // Show first 10 lines
      });
    }

    return true;

  } catch (error) {
    log.error('Unit tests failed', {
      error: error.message,
      stdout: error.stdout?.toString().substring(0, 1000),
      stderr: error.stderr?.toString().substring(0, 1000)
    });
    return false;
  }
}

/**
 * Run integration tests
 */
function runIntegrationTests() {
  log.header('Running Integration Tests');
  
  try {
    log.info('Executing integration tests...');
    
    const integrationTestCommand = `npx vitest run --dir ${TEST_CONFIG.integrationTestsDir} --reporter=verbose`;
    const integrationTestOutput = execSync(integrationTestCommand, {
      cwd: rootDir,
      stdio: 'pipe', 
      encoding: 'utf-8',
      timeout: 120000 // 2 minutes timeout for integration tests
    });

    log.success('Integration tests completed successfully');
    
    // Parse integration test results
    const lines = integrationTestOutput.split('\n');
    const testSummaryLines = lines.filter(line => 
      line.includes('Test Files') || 
      line.includes('Tests') ||
      line.includes('Time')
    );

    if (testSummaryLines.length > 0) {
      log.info('Integration test summary', {
        summary: testSummaryLines
      });
    }

    return true;

  } catch (error) {
    log.error('Integration tests failed', {
      error: error.message,
      stdout: error.stdout?.toString().substring(0, 1500),
      stderr: error.stderr?.toString().substring(0, 1500)
    });
    return false;
  }
}

/**
 * Run tests with coverage
 */
function runTestsWithCoverage() {
  log.header('Running Tests with Coverage Analysis');
  
  try {
    log.info('Executing all tests with coverage...');
    
    // Clean previous coverage
    if (fs.existsSync(TEST_CONFIG.coverageDir)) {
      execSync(`rm -rf ${TEST_CONFIG.coverageDir}`, { cwd: rootDir });
    }

    const coverageCommand = 'npx vitest run --coverage --reporter=verbose';
    const coverageOutput = execSync(coverageCommand, {
      cwd: rootDir,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 180000 // 3 minutes timeout for coverage analysis
    });

    log.success('Coverage analysis completed');
    
    // Parse coverage output
    const lines = coverageOutput.split('\n');
    const coverageLines = lines.filter(line => 
      line.includes('%') && (
        line.includes('Branches') ||
        line.includes('Functions') ||
        line.includes('Lines') ||
        line.includes('Statements')
      )
    );

    if (coverageLines.length > 0) {
      log.info('Coverage summary', {
        coverageMetrics: coverageLines
      });
    }

    return true;

  } catch (error) {
    log.warning('Coverage analysis completed with issues', {
      error: error.message,
      note: 'This might be due to coverage thresholds not being met'
    });
    
    // Don't fail completely on coverage issues, but return false to indicate problems
    return false;
  }
}

/**
 * Validate coverage results
 */
function validateCoverageResults() {
  log.header('Validating Coverage Results');
  
  const coverageSummaryPath = path.join(TEST_CONFIG.coverageDir, 'coverage-summary.json');
  
  if (!fs.existsSync(coverageSummaryPath)) {
    log.warning('Coverage summary file not found', {
      expectedPath: coverageSummaryPath,
      note: 'Coverage may not have been generated properly'
    });
    return false;
  }

  try {
    const coverageData = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf-8'));
    const totalCoverage = coverageData.total;

    if (!totalCoverage) {
      log.error('Invalid coverage data format');
      return false;
    }

    // Check coverage against thresholds
    const coverageResults = {
      branches: totalCoverage.branches?.pct || 0,
      functions: totalCoverage.functions?.pct || 0,
      lines: totalCoverage.lines?.pct || 0,
      statements: totalCoverage.statements?.pct || 0
    };

    const thresholdResults = {};
    let allThresholdsMet = true;

    for (const [metric, value] of Object.entries(coverageResults)) {
      const threshold = TEST_CONFIG.coverageThresholds[metric];
      const met = value >= threshold;
      thresholdResults[metric] = {
        actual: value,
        threshold,
        met
      };
      
      if (!met) {
        allThresholdsMet = false;
      }
    }

    if (allThresholdsMet) {
      log.success('All coverage thresholds met', {
        coverageResults,
        thresholds: TEST_CONFIG.coverageThresholds
      });
    } else {
      log.warning('Some coverage thresholds not met', {
        results: thresholdResults
      });
    }

    return allThresholdsMet;

  } catch (error) {
    log.error('Failed to parse coverage results', {
      error: error.message
    });
    return false;
  }
}

/**
 * Generate test reports
 */
function generateTestReports() {
  log.header('Generating Test Reports');
  
  try {
    // Ensure test results directory exists
    if (!fs.existsSync(TEST_CONFIG.testResultsDir)) {
      fs.mkdirSync(TEST_CONFIG.testResultsDir, { recursive: true });
    }

    // Generate JSON test report
    log.info('Generating JSON test report...');
    
    const jsonReportCommand = 'npx vitest run --reporter=json --outputFile=test-results/results.json';
    execSync(jsonReportCommand, {
      cwd: rootDir,
      stdio: 'pipe',
      timeout: 60000
    });

    // Generate HTML coverage report (should already exist from coverage run)
    const htmlCoveragePath = path.join(TEST_CONFIG.coverageDir, 'index.html');
    
    if (fs.existsSync(htmlCoveragePath)) {
      log.success('HTML coverage report available', {
        path: htmlCoveragePath,
        url: `file://${htmlCoveragePath}`
      });
    }

    // Generate test summary report
    const testSummary = {
      timestamp: new Date().toISOString(),
      environment: 'test',
      nodeVersion: process.version,
      coverage: {
        directory: TEST_CONFIG.coverageDir,
        thresholds: TEST_CONFIG.coverageThresholds
      },
      integrationTests: {
        directory: TEST_CONFIG.integrationTestsDir,
        expectedTests: TEST_CONFIG.expectedTests
      }
    };

    fs.writeFileSync(
      path.join(TEST_CONFIG.testResultsDir, 'test-summary.json'),
      JSON.stringify(testSummary, null, 2)
    );

    log.success('Test reports generated', {
      resultsDirectory: TEST_CONFIG.testResultsDir,
      coverageDirectory: TEST_CONFIG.coverageDir
    });

    return true;

  } catch (error) {
    log.error('Failed to generate test reports', {
      error: error.message
    });
    return false;
  }
}

/**
 * Validate test utilities
 */
function validateTestUtilities() {
  log.header('Validating Test Utilities');
  
  try {
    // Create a simple test to verify test utilities work
    const testUtilityScript = `
      import { describe, it, expect } from 'vitest';
      import { TestDatabaseManager } from '../../src/shared/tests/utils/testing.js';

      describe('Test Utilities Validation', () => {
        it('should create test database manager', async () => {
          const manager = new TestDatabaseManager();
          expect(manager).toBeDefined();
        });

        it('should have global test utilities', () => {
          expect(globalThis.testDb).toBeDefined();
        });

        it('should have custom matchers', () => {
          expect('550e8400-e29b-41d4-a716-446655440000').toBeValidUuid();
          expect('2025-06-24T12:00:00Z').toBeValidTimestamp();
          expect('test@example.com').toBeValidEmail();
        });
      });
    `;

    const tempTestFile = path.join(rootDir, 'temp-utility-test.test.js');
    fs.writeFileSync(tempTestFile, testUtilityScript);

    try {
      execSync(`npx vitest run ${tempTestFile}`, {
        cwd: rootDir,
        stdio: 'pipe',
        timeout: 30000
      });

      log.success('Test utilities validation passed');
      return true;

    } finally {
      // Cleanup temp file
      if (fs.existsSync(tempTestFile)) {
        fs.unlinkSync(tempTestFile);
      }
    }

  } catch (error) {
    log.error('Test utilities validation failed', {
      error: error.message
    });
    return false;
  }
}

/**
 * Main validation function
 */
async function validateTestingInfrastructure() {
  console.log('🧪 Layer 3: Testing Infrastructure Validation');
  console.log('═'.repeat(60));
  console.log('');

  const results = {};

  // Define validation tests
  const validationTests = [
    { name: 'Test Environment', fn: validateTestEnvironment },
    { name: 'Integration Tests', fn: validateIntegrationTests },
    { name: 'Test Utilities', fn: validateTestUtilities },
    { name: 'Unit Tests', fn: runUnitTests },
    { name: 'Integration Tests Execution', fn: runIntegrationTests },
    { name: 'Coverage Analysis', fn: runTestsWithCoverage },
    { name: 'Coverage Validation', fn: validateCoverageResults },
    { name: 'Test Reports', fn: generateTestReports }
  ];

  // Run all validation tests
  for (const test of validationTests) {
    const startTime = Date.now();
    
    try {
      const passed = await test.fn();
      const duration = Date.now() - startTime;
      
      results[test.name] = {
        passed,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      results[test.name] = {
        passed: false,
        duration,
        error: error.message
      };
    }
  }

  // Generate validation report
  const totalTests = Object.keys(results).length;
  const passedTests = Object.values(results).filter(r => r.passed).length;
  const failedTests = totalTests - passedTests;

  console.log('');
  log.header('Testing Infrastructure Validation Report');
  
  console.log(`📊 Validation Summary:`);
  console.log(`   Total Tests: ${totalTests}`);
  console.log(`   Passed: ${passedTests} ✅`);
  console.log(`   Failed: ${failedTests} ${failedTests > 0 ? '❌' : '✅'}`);
  console.log(`   Success Rate: ${Math.round((passedTests / totalTests) * 100)}%`);
  console.log('');

  // Detailed results
  for (const [testName, result] of Object.entries(results)) {
    const status = result.passed ? '✅' : '❌';
    const duration = result.duration ? ` (${result.duration}ms)` : '';
    console.log(`   ${status} ${testName}${duration}`);
    
    if (!result.passed && result.error) {
      console.log(`      Error: ${result.error}`);
    }
  }

  const allPassed = passedTests === totalTests;

  console.log('');
  if (allPassed) {
    log.success('🎉 Layer 3: Testing Infrastructure validation PASSED!');
    console.log('');
    console.log('✅ All testing components are working correctly');
    console.log('✅ Integration tests prove Layer 1 & 2 utilities work together');
    console.log('✅ Coverage analysis và reporting operational');
    console.log('✅ Test utilities và environment properly configured');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Run: pnpm test - to execute all tests');
    console.log('  2. Run: pnpm test:coverage - to generate coverage reports');  
    console.log('  3. View: coverage/index.html - for detailed coverage report');
    console.log('  4. Ready to proceed to Layer 4: Core Module Implementation');
  } else {
    log.error('❌ Layer 3: Testing Infrastructure validation FAILED!');
    console.log('');
    console.log('Please fix the issues above before proceeding.');
    console.log('Common issues:');
    console.log('  - Database connection problems');
    console.log('  - Missing test files or utilities');
    console.log('  - Coverage thresholds not met');
    console.log('  - Environment configuration issues');
    process.exit(1);
  }
}

// Run validation if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  validateTestingInfrastructure().catch(error => {
    log.error('Validation script failed', { error: error.message });
    console.error(error.stack);
    process.exit(1);
  });
}