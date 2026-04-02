# @dooz/brain-client

TypeScript client library for querying Dooz Brain's organizational memory via MCP.

## Installation

```bash
bun add @dooz/brain-client
```

## Usage

### HTTP Client (recommended for cloud services)

```typescript
import { BrainHttpClient } from '@dooz/brain-client';

const brain = new BrainHttpClient({
  baseUrl: 'http://localhost:1420', // Brain's Axum server
});

// List all scopes
const scopes = await brain.listScopes();

// Query memories within a scope
const results = await brain.queryMemories({
  scopeId: 'abc-123',
  query: 'deployment process',
  mode: 'strict',  // or 'semantic'
  limit: 10,
});

// Get a single memory by ID
const memory = await brain.getMemory({
  scopeId: 'abc-123',
  memoryId: 'mem-456',
});
```

### stdio Client (for AI agents)

```typescript
import { BrainStdioClient } from '@dooz/brain-client';

const brain = new BrainStdioClient({
  mcpServerPath: '/path/to/dooz-brain/dist-mcp/mcp-server.js',
  dbPath: '/path/to/dooz-brain.db', // optional
});

await brain.connect();

// List scopes
const scopes = await brain.listScopes();

// Query memories
const results = await brain.queryMemories('scope-id', 'deployment process');

// Get memory
const memory = await brain.getMemory('scope-id', 'mem-id');

await brain.disconnect();
```

## Response Types

### Scope
```typescript
interface Scope {
  id: string;
  type: 'ORG' | 'CLIENT' | 'PROJECT' | 'EMPLOYEE' | 'DOMAIN';
  name: string;
  frozen: boolean;
}
```

### Memory Result
```typescript
interface MemoryResult {
  memory: Memory;
  score: number;
  ranking_reason: string;
}

interface Memory {
  id: string;
  scope_id: string;
  title: string;
  content: string;
  confidence: number;
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
  decay_state: 'ACTIVE' | 'WARM' | 'COLD' | 'ARCHIVED';
  review_status: 'APPROVED';
  created_at: string;
  updated_at: string;
}
```

## Integration Examples

### PM Suite Integration
```typescript
// In PM Suite, use Brain to get context for intents
const context = await brain.queryMemories({
  scopeId: projectScopeId,
  query: intent.title,
  limit: 5,
});

// Attach context to AI proposal
const proposal = await aiPropose(intent, {
  context: context.results.map(r => r.memory.content),
});
```

### Perspective Integration
```typescript
// In Perspective, use Brain to get prior verification decisions
const priorDecisions = await brain.queryMemories({
  scopeId: orgScopeId,
  query: `verification ${documentType}`,
  limit: 10,
});
```
