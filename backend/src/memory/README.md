# Enhanced Memory System

OpenClaw-style persistent memory with hybrid search for the Work Assistant.

## Features

| Feature | Description |
|---------|-------------|
| **Two-layer memory** | `MEMORY.md` (durable facts) + daily logs (conversation context) |
| **Hybrid search** | BM25 (keyword) + Vector (semantic) combined with weighted fusion |
| **Pre-compaction flush** | Auto-saves important facts before context window fills |
| **Local embeddings** | Uses `@xenova/transformers` - no API costs, runs entirely locally |
| **File-based canonical storage** | Markdown files are source of truth, SQLite index is derived |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Enhanced Memory Manager                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────┐         ┌─────────────┐                  │
│   │  MEMORY.md  │         │ daily-*.jsonl│                  │
│   │  (Durable)  │         │ (Session)   │                  │
│   └──────┬──────┘         └──────┬──────┘                  │
│          │                       │                          │
│          ▼                       ▼                          │
│   ┌─────────────────────────────────────┐                  │
│   │           Memory Chunker            │                  │
│   │   (Parses files into searchable     │                  │
│   │    chunks by category)              │                  │
│   └──────────────┬──────────────────────┘                  │
│                  │                                          │
│                  ▼                                          │
│   ┌─────────────────────────────────────┐                  │
│   │          Hybrid Search              │                  │
│   │   ┌───────────┐  ┌───────────┐     │                  │
│   │   │ BM25 Index│  │Vector Store│     │                  │
│   │   │ (Keyword) │  │ (Semantic) │     │                  │
│   │   └───────────┘  └───────────┘     │                  │
│   │         ↓              ↓            │                  │
│   │      Weighted Score Fusion          │                  │
│   └─────────────────────────────────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `enhanced-memory-manager.ts` | Main interface - use this |
| `embeddings.ts` | Local embedding generation using Xenova/transformers |
| `vector-store.ts` | SQLite-based vector storage |
| `bm25.ts` | BM25 keyword search algorithm |
| `hybrid-search.ts` | Combines BM25 + vector search |
| `chunker.ts` | Parses MEMORY.md into searchable chunks |
| `compaction-guard.ts` | Pre-compaction memory flush |

## Data Storage

```
work-assistant/backend/data/
├── MEMORY.md              # Canonical memory (markdown)
├── memory.sqlite          # Vector embeddings index
├── daily-2026-02-05.jsonl # Today's conversation log
└── daily-*.jsonl          # Historical logs
```

## Usage

### Basic Memory Operations

```typescript
import { enhancedMemoryManager } from './memory/index.js';

// Initialize (downloads embedding model on first run)
await enhancedMemoryManager.initialize();

// Remember a fact
enhancedMemoryManager.remember("User prefers dark mode", "Preferences");

// Forget a fact
enhancedMemoryManager.forget("dark mode");

// Search memory (hybrid search)
const results = await enhancedMemoryManager.recall("user preferences", 10);

// Simple keyword search (fallback)
const keywordResults = enhancedMemoryManager.recallKeyword("dark mode");
```

### Search Results

```typescript
interface RecallResult {
  content: string;    // The memory content
  category: string;   // Category from MEMORY.md
  score: number;      // Combined relevance score (0-1)
  source: 'memory' | 'conversation';
}
```

### Compaction Guard

```typescript
// Check if pre-compaction flush is needed
if (enhancedMemoryManager.shouldFlush()) {
  const savedFacts = await enhancedMemoryManager.triggerPreCompactionFlush();
  console.log(`Saved ${savedFacts.length} facts before compaction`);
}

// Get compaction status
const status = enhancedMemoryManager.getCompactionStatus();
// { tokens: 50000, maxTokens: 200000, usagePercent: 25, shouldFlush: false }
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/memory` | GET | Get raw MEMORY.md content |
| `/api/memory` | PUT | Update MEMORY.md directly |
| `/api/memory/search` | POST | Hybrid search `{ query, limit }` |
| `/api/memory/stats` | GET | Index and compaction stats |
| `/api/memory/rebuild` | POST | Rebuild search index |
| `/api/memory/flush` | POST | Trigger pre-compaction flush |

## First-Time Setup

```bash
cd work-assistant/backend

# Install dependencies
npm install

# Initialize memory system (downloads embedding model ~23MB)
npm run init-memory

# Start the server
npm run dev
```

## How Hybrid Search Works

1. **Query comes in**: "What did we decide about the architecture?"

2. **BM25 Search**: Finds exact keyword matches
   - Good for: "commit ab3f2c1", exact names, specific terms
   - Returns documents containing query words

3. **Vector Search**: Finds semantic matches
   - Good for: "architecture decisions" matching "we chose microservices"
   - Returns documents with similar meaning

4. **Score Fusion**: Combines both with weighted average
   - Default: 60% vector, 40% BM25
   - Configurable via `HybridSearchConfig`

5. **Results**: Ranked by combined score with category context

## Why This Approach (from OpenClaw)

> "Pure vector search fails on exact matches—ask for 'commit ab3f2c1' and you get commits with similar descriptions, not the exact hash. Pure keyword search fails on semantic queries. Ask 'what did we decide about the architecture?' and BM25 won't understand that 'we chose microservices' is a match."

The hybrid approach gives you the best of both worlds.

## Cost

**$0** - Everything runs locally:
- Embedding model: `Xenova/all-MiniLM-L6-v2` (23MB, cached)
- Database: SQLite (file-based)
- No external API calls for search
- Only cost is Copilot SDK calls for the AI chat itself
