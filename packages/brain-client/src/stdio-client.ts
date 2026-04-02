import { spawn, ChildProcess } from 'child_process';
import { Scope, Memory } from './http-client';

interface McpRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class BrainStdioClient {
  private process: ChildProcess | null = null;
  private mcpServerPath: string;
  private dbPath?: string;
  private requestId = 0;
  private buffer = '';
  private pendingResolves = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(config: { mcpServerPath: string; dbPath?: string }) {
    this.mcpServerPath = config.mcpServerPath;
    this.dbPath = config.dbPath;
  }

  async connect(): Promise<void> {
    const env = { ...process.env };
    if (this.dbPath) {
      env.DOOCORE_BRAIN_DB = this.dbPath;
    }

    this.process = spawn('node', [this.mcpServerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      console.error('[Brain MCP stderr]:', chunk.toString());
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Connection timeout')), 5000);
      this.sendRequest('initialize', { protocolVersion: '2024-11-05', capabilities: {} })
        .then(() => {
          clearTimeout(timer);
          resolve();
        })
        .catch(reject);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response: McpResponse = JSON.parse(line);
        const pending = this.pendingResolves.get(response.id);
        if (pending) {
          this.pendingResolves.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Not connected'));
        return;
      }

      const id = ++this.requestId;
      const request: McpRequest = { jsonrpc: '2.0', id, method, params };
      this.pendingResolves.set(id, { resolve, reject });
      this.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  async listScopes(): Promise<Scope[]> {
    const result = await this.sendRequest('tools/call', {
      name: 'list_scopes',
      arguments: {},
    }) as { content: Array<{ type: string; text: string }> };

    const text = result.content?.[0]?.text ?? '[]';
    return JSON.parse(text);
  }

  async queryMemories(scopeId: string, query: string, limit = 10): Promise<Memory[]> {
    const result = await this.sendRequest('tools/call', {
      name: 'query_memories',
      arguments: { scope_id: scopeId, query, limit },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (result.isError) {
      throw new Error(result.content?.[0]?.text ?? 'Query failed');
    }

    const text = result.content?.[0]?.text ?? '{"results":[]}';
    const parsed = JSON.parse(text);
    return parsed.results ?? [];
  }

  async getMemory(scopeId: string, memoryId: string): Promise<Memory | null> {
    const result = await this.sendRequest('tools/call', {
      name: 'get_memory',
      arguments: { scope_id: scopeId, memory_id: memoryId },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    if (result.isError) {
      return null;
    }

    const text = result.content?.[0]?.text ?? 'null';
    return text === 'null' ? null : JSON.parse(text);
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill();
      this.process = null;
    }
    this.pendingResolves.clear();
    this.buffer = '';
  }
}
