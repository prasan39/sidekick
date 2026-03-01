/**
 * Initialize Memory System
 *
 * Run this script to:
 * 1. Download the embedding model (~23MB, cached for future use)
 * 2. Build the initial search index from MEMORY.md
 *
 * Usage: npm run init-memory
 */

import { enhancedMemoryManager, initEmbedder } from '../memory/index.js';

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║         Work Assistant - Memory Initialization           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    // Step 1: Initialize embedding model
    console.log('[1/3] Downloading embedding model (first run only)...');
    console.log('      Model: Xenova/all-MiniLM-L6-v2 (~23MB)');
    console.log('      This model runs locally - no API costs!');
    console.log('');

    await initEmbedder();
    console.log('      ✓ Embedding model ready');
    console.log('');

    // Step 2: Initialize memory manager
    console.log('[2/3] Initializing memory system...');
    await enhancedMemoryManager.initialize();
    console.log('      ✓ Memory system initialized');
    console.log('');

    // Step 3: Show stats
    console.log('[3/3] Memory Statistics:');
    const stats = enhancedMemoryManager.getIndexStats();
    console.log(`      - Vector store: ${stats.vectorCount} chunks indexed`);
    console.log(`      - BM25 index: ${stats.bm25Count} documents`);
    console.log(`      - Initialized: ${stats.initialized}`);
    console.log('');

    // Test search
    console.log('[Test] Running test search...');
    const results = await enhancedMemoryManager.recall('test query', 3);
    console.log(`      - Found ${results.length} results`);
    console.log('');

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║                 Initialization Complete!                  ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║  You can now run: npm run dev                            ║');
    console.log('║                                                          ║');
    console.log('║  The embedding model is cached locally - subsequent      ║');
    console.log('║  runs will start much faster.                            ║');
    console.log('╚══════════════════════════════════════════════════════════╝');

  } catch (error) {
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════╗');
    console.error('║                   Initialization Failed                   ║');
    console.error('╚══════════════════════════════════════════════════════════╝');
    console.error('');
    console.error('Error:', error);
    console.error('');
    console.error('Troubleshooting:');
    console.error('1. Make sure you have run: npm install');
    console.error('2. Check network connection (model download needs internet)');
    console.error('3. Ensure sufficient disk space (~100MB for model cache)');
    process.exit(1);
  }

  // Clean exit
  enhancedMemoryManager.close();
  process.exit(0);
}

main();
