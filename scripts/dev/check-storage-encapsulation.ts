#!/usr/bin/env tsx
/**
 * Check Storage Encapsulation
 * 
 * This script detects violations of the database access architecture rule:
 * All database access must go through the storage layer.
 * 
 * Allowed patterns:
 * - server/storage/*.ts can import from './db' (relative within storage)
 * - server/db.ts can re-export from './storage/db'
 * 
 * Forbidden patterns:
 * - Any file outside server/storage/ importing from '../db', '../../db', etc.
 * - Direct imports from 'server/db' in route handlers or modules
 * 
 * Usage: npx tsx scripts/dev/check-storage-encapsulation.ts
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';

interface Violation {
  file: string;
  line: number;
  importPath: string;
  suggestion: string;
}

const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+['"]\.\.\/db['"]/,
  /from\s+['"]\.\.\/\.\.\/db['"]/,
  /from\s+['"]\.\.\/\.\.\/\.\.\/db['"]/,
  /from\s+['"]server\/db['"]/,
];

const ALLOWED_DIRECTORIES = [
  'server/storage',
];

const ALLOWED_FILES = [
  'server/db.ts',
  // Admin-only database snapshot utility that needs bulk operations across all tables
  // This is intentionally excluded as it operates at the infrastructure level
  'server/services/quickstart.ts',
];

function isInAllowedDirectory(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return ALLOWED_DIRECTORIES.some(dir => normalized.startsWith(dir + '/'));
}

function isAllowedFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return ALLOWED_FILES.includes(normalized);
}

function findTsFiles(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir);
  
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      if (entry !== 'node_modules' && entry !== '.git' && entry !== 'dist') {
        findTsFiles(fullPath, files);
      }
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

function checkFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const relativePath = relative(process.cwd(), filePath).replace(/\\/g, '/');
  
  if (isInAllowedDirectory(relativePath) || isAllowedFile(relativePath)) {
    return violations;
  }
  
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  lines.forEach((line, index) => {
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      if (pattern.test(line)) {
        const match = line.match(/from\s+['"]([^'"]+)['"]/);
        const importPath = match ? match[1] : 'unknown';
        
        violations.push({
          file: relativePath,
          line: index + 1,
          importPath,
          suggestion: 'Use storage methods from "server/storage" instead of direct db access.',
        });
      }
    }
  });
  
  return violations;
}

function main() {
  console.log('Checking storage encapsulation...\n');
  
  const serverDir = join(process.cwd(), 'server');
  const files = findTsFiles(serverDir);
  
  const allViolations: Violation[] = [];
  
  for (const file of files) {
    const violations = checkFile(file);
    allViolations.push(...violations);
  }
  
  if (allViolations.length === 0) {
    console.log('✓ No storage encapsulation violations found.\n');
    console.log('All database access properly goes through the storage layer.');
    process.exit(0);
  }
  
  console.log(`✗ Found ${allViolations.length} storage encapsulation violation(s):\n`);
  
  for (const violation of allViolations) {
    console.log(`  ${violation.file}:${violation.line}`);
    console.log(`    Import: ${violation.importPath}`);
    console.log(`    Fix: ${violation.suggestion}`);
    console.log('');
  }
  
  console.log('ARCHITECTURE RULE: All database access must go through the storage layer.');
  console.log('');
  console.log('To fix these violations:');
  console.log('1. Create storage methods for the database operations you need');
  console.log('2. Import and use storage from "server/storage" in your code');
  console.log('3. See replit.md "Database Access Architecture" for details');
  console.log('');
  
  process.exit(1);
}

main();
