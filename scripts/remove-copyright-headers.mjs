#!/usr/bin/env node
/**
 * Removes Microsoft copyright headers from source files.
 * Keeps LICENSE.txt in repo root for MIT attribution.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// Block comment: /*---...---*/ with Copyright + MIT License lines
const BLOCK_HEADER = /^\/\*[-]+\s*\n\s*\*\s+Copyright \(c\) Microsoft Corporation\. All rights reserved\.\s*\n\s*\*\s+Licensed under the MIT License\. See License\.txt in the project root for license information\.\s*\n\s*\*[-]+\*\/\s*\n?/;

// VB-style: ' Copyright ...
const VB_HEADER = /^' Copyright \(c\) Microsoft Corporation\. All rights reserved\.\s*\n?/;

// Shell script: # Copyright ... (single line, maybe with # before/after)
const SH_HEADER = /^(#\s*\n)?# Copyright \(c\) Microsoft Corporation\. All rights reserved\.\s*\n?(#\s*\n)?/;

// Shell/zsh: multi-line # block (Copyright + Licensed)
const SH_BLOCK = /^# [-]+[\s\n\r]*#\s+Copyright \(c\) Microsoft[\s\S]*?^# [-]+\s*\n?/m;

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cjs', '.cts', '.css', '.rs', '.wgsl', '.vb', '.sh', '.bash', '.zsh', '.tst', '.template']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'out-vscode', 'dist', 'build-out', '.build']);

let total = 0;
let modified = 0;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) {
        walk(full);
      }
    } else if (e.isFile()) {
      const ext = path.extname(e.name);
      if (EXTENSIONS.has(ext)) {
        total++;
        processFile(full);
      }
    }
  }
}

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  const orig = content;

  // Try block header first
  content = content.replace(BLOCK_HEADER, '');

  // VB
  if (content !== orig || path.extname(filePath) === '.vb') {
    content = content.replace(VB_HEADER, '');
  }

  // Shell single line (at start)
  content = content.replace(SH_HEADER, '');

  // Shell: block after shebang (#\n# Copyright...\n#)
  content = content.replace(/\n#\s*\n# Copyright \(c\) Microsoft Corporation\. All rights reserved\.\s*\n#\s*\n/, '\n');
  // Shell: 4-line block (#\n# Copyright\n# Licensed...)
  content = content.replace(/\n#\s*\n# Copyright \(c\) Microsoft Corporation\. All rights reserved\.\s*\n# Licensed under the MIT License\.[^\n]*\n/, '\n');

  // Shell multi-line block (must match Copyright in first 500 chars to avoid over-matching)
  const head = content.slice(0, 500);
  if (head.includes('Copyright (c) Microsoft') && head.includes('# ---')) {
    content = content.replace(SH_BLOCK, '');
  }

  if (content !== orig) {
    fs.writeFileSync(filePath, content, 'utf-8');
    modified++;
    console.log(filePath.replace(root + path.sep, ''));
  }
}

walk(root);
console.error(`\nProcessed ${total} files, modified ${modified}`);
