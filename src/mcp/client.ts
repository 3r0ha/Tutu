/**
 * Транспорт до Tutu MCP.
 *
 * Слой отвечает ровно за три вещи: доставить вызов, не уронить сервер параллелизмом
 * и не платить дважды за один и тот же запрос. Никакой доменной логики здесь нет —
 * движок маршрутизации работает с типами из `domain/`, а не с сырым JSON-RPC.
 */

const ENDPOINT = process.env.TUTU_MCP_URL ?? 'https://mcp.tutu.ru/mcp';

export interface McpClientOptions {
  endpoint?: string;
  /**
   * Одновременных запросов к MCP.
   *
   * Замеры: двадцать параллельных поисков проходят штатно, но на восьми
   * однажды случился таймаут TLS-рукопожатия. Предел держим выше прежней
   * шестёрки — при ней веер из трёх десятков вызовов выстраивался в пять
   * волн, и именно это, а не число запросов, определяло время ответа.
   * Единичные срывы закрывает механизм повторов, а отстающих не ждёт мягкий
   * срок фазы (см. `engine/settle.ts`) — задирать предел выше бессмысленно:
   * при двенадцати медиана улучшалась на пару секунд, а худший прогон
   * растягивался с двадцати четырёх секунд до пятидесяти пяти.
   */
  maxConcurrent?: number;
  maxRetries?: number;
  timeoutMs?: number;
  cacheTtlMs?: number;
}

/** Ошибка самого инструмента (`isError: true`) — повторять её бессмысленно. */
export class McpToolError extends Error {
  readonly tool: string;

  constructor(tool: string, message: string) {
    super(`${tool}: ${message}`);
    this.name = 'McpToolError';
    this.tool = tool;
  }
}

/** Транспортный сбой: сеть, таймаут, 5xx. Повторяем с отступом. */
export class McpTransportError extends Error {
  readonly tool: string;

  constructor(tool: string, message: string) {
    super(`${tool}: ${message}`);
    this.name = 'McpTransportError';
    this.tool = tool;
  }
}

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

interface CacheEntry {
  expiresAt: number;
  value: Promise<unknown>;
}

/**
 * Кэш держит именно Promise, а не результат: два одинаковых запроса, ушедших
 * одновременно, схлопываются в один сетевой вызов. Для веерного обхода хабов это
 * снимает основную долю трафика — соседние гости делят одни и те же плечи.
 */
class PromiseCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  get(key: string): Promise<unknown> | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: Promise<unknown>): void {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    // Неудачный запрос не должен залипать в кэше на весь TTL.
    void value.catch(() => this.entries.delete(key));
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface McpStats {
  calls: number;
  cacheHits: number;
  retries: number;
  failures: number;
}

export class McpClient {
  private readonly endpoint: string;
  private readonly semaphore: Semaphore;
  private readonly cache: PromiseCache;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  readonly stats: McpStats = { calls: 0, cacheHits: 0, retries: 0, failures: 0 };

  constructor(options: McpClientOptions = {}) {
    this.endpoint = options.endpoint ?? ENDPOINT;
    this.semaphore = new Semaphore(options.maxConcurrent ?? 8);
    this.cache = new PromiseCache(options.cacheTtlMs ?? 5 * 60_000);
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  async callTool<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    const key = `${tool}:${stableStringify(args)}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.stats.cacheHits += 1;
      return cached as Promise<T>;
    }
    const pending = this.semaphore.run(() => this.callWithRetries<T>(tool, args));
    this.cache.set(key, pending);
    return pending;
  }

  /**
   * Возвращает `null` вместо исключения. Движок обходит десятки плеч, и отказ
   * одного из них обязан деградировать до «этого варианта нет», а не ронять
   * весь маршрут.
   */
  async callToolSafe<T>(tool: string, args: Record<string, unknown>): Promise<T | null> {
    try {
      return await this.callTool<T>(tool, args);
    } catch {
      return null;
    }
  }

  private async callWithRetries<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        this.stats.calls += 1;
        return await this.callOnce<T>(tool, args);
      } catch (error) {
        lastError = error;
        // Ошибку валидации аргументов повтор не исправит.
        if (error instanceof McpToolError) break;
        if (attempt === this.maxRetries) break;
        this.stats.retries += 1;
        await delay(600 * 2 ** attempt + Math.random() * 300);
      }
    }
    this.stats.failures += 1;
    throw lastError;
  }

  private async callOnce<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    });

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Сервер работает в stateless-режиме, но требует объявить оба формата.
        accept: 'application/json, text/event-stream',
      },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error: unknown) => {
      throw new McpTransportError(tool, describe(error));
    });

    if (!response.ok) {
      throw new McpTransportError(tool, `HTTP ${response.status}`);
    }

    const envelope = (await response.json()) as {
      result?: { content?: Array<{ text?: string }>; isError?: boolean };
      error?: { message?: string };
    };

    if (envelope.error) {
      throw new McpTransportError(tool, envelope.error.message ?? 'JSON-RPC error');
    }

    const text = envelope.result?.content?.[0]?.text;
    if (text === undefined) {
      throw new McpTransportError(tool, 'пустой ответ');
    }
    if (envelope.result?.isError) {
      throw new McpToolError(tool, text.slice(0, 300));
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      // Часть инструментов отдаёт текстовый плейбук, а не JSON.
      return text as unknown as T;
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'TimeoutError' ? 'таймаут' : error.message;
  }
  return String(error);
}

/** Ключ кэша не должен зависеть от порядка полей в объекте аргументов. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
