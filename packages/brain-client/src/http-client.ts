export interface BrainConfig {
  baseUrl: string;
  timeout?: number;
}

export interface Scope {
  id: string;
  type: 'ORG' | 'CLIENT' | 'PROJECT' | 'EMPLOYEE' | 'DOMAIN';
  name: string;
  frozen: boolean;
}

export interface Memory {
  id: string;
  scope_id: string;
  bucket_id: string | null;
  title: string;
  content: string;
  content_hash: string;
  source_id: string | null;
  original_path: string | null;
  imported_at: string;
  raw_hash: string;
  confidence: number;
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
  decay_state: 'ACTIVE' | 'WARM' | 'COLD' | 'ARCHIVED';
  decay_signals: string[] | null;
  last_accessed_at: string | null;
  access_count: number;
  review_status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'QUARANTINED';
  reviewed_by: string | null;
  reviewed_at: string | null;
  version: number;
  is_frozen: boolean;
  created_at: string;
  updated_at: string;
}

export interface MemoryResult {
  memory: Memory;
  score: number;
  ranking_reason: string;
}

export interface QueryParams {
  scopeId: string;
  query: string;
  mode?: 'strict' | 'semantic';
  limit?: number;
}

export interface BrainResponse {
  success: boolean;
  results: MemoryResult[] | null;
  error: string | null;
  refusal_reason: string | null;
}

export interface McpQueryRequest {
  scope_id: string;
  query: string;
  mode?: string;
  limit?: number;
}

export class BrainHttpClient {
  private baseUrl: string;
  private timeout: number;

  constructor(config: BrainConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeout = config.timeout ?? 10000;
  }

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const resp = await fetch(url.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      if (!resp.ok) {
        throw new Error(`Brain HTTP error: ${resp.status} ${resp.statusText}`);
      }

      return resp.json() as Promise<T>;
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request('/health');
      return true;
    } catch {
      return false;
    }
  }

  async listScopes(): Promise<Scope[]> {
    const response = await this.request<{ success: boolean; scopes: Scope[] }>('/mcp/scopes');
    return response.scopes ?? [];
  }

  async queryMemories(params: QueryParams): Promise<MemoryResult[]> {
    const response = await this.request<BrainResponse>('/mcp/query', {
      scope_id: params.scopeId,
      query: params.query,
      mode: params.mode ?? 'strict',
      limit: params.limit?.toString() ?? '10',
    });

    if (!response.success) {
      throw new Error(response.error ?? response.refusal_reason ?? 'Unknown error');
    }

    return response.results ?? [];
  }

  async getMemory(scopeId: string, memoryId: string): Promise<Memory | null> {
    const results = await this.queryMemories({
      scopeId,
      query: memoryId,
      limit: 1,
    });

    const match = results.find(r => r.memory.id === memoryId);
    return match?.memory ?? null;
  }

  async getContextForTopic(scopeId: string, topic: string, limit = 5): Promise<string> {
    const results = await this.queryMemories({ scopeId, query: topic, limit });

    if (results.length === 0) {
      return `No approved memories found in scope for "${topic}".`;
    }

    const blocks = results.map((r, i) => {
      return `## Memory ${i + 1}: ${r.memory.title}\n` +
        `**Confidence:** ${r.memory.confidence_level} (${r.memory.confidence})\n` +
        `**State:** ${r.memory.decay_state}\n` +
        `**Updated:** ${r.memory.updated_at}\n\n` +
        `${r.memory.content}\n`;
    });

    return blocks.join('\n---\n\n');
  }
}
