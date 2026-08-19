/**
 * Доступ к языковой модели.
 *
 * Модель в этом проекте занимает ровно одну нишу — она выдвигает гипотезы,
 * которые затем проверяются живыми данными Туту. Ни одно её утверждение не
 * попадает пользователю напрямую, поэтому галлюцинация здесь стоит лишнего
 * запроса, а не вранья в выдаче.
 *
 * Провайдер выбирается по окружению и всегда деградирует до «модели нет»:
 * продукт обязан работать без неё, просто хуже подбирая шлюзы.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE_DIR = join(ROOT, '.cache', 'llm');

export interface LlmProvider {
  readonly name: string;
  complete(prompt: string): Promise<string | null>;
}

/** Модель недоступна — движок молча уходит на статический каталог. */
class NullProvider implements LlmProvider {
  readonly name = 'none';

  async complete(): Promise<string | null> {
    return null;
  }
}

/** Anthropic API — основной путь, когда в окружении есть ключ. */
class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic-api';
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(prompt: string): Promise<string | null> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { content?: Array<{ text?: string }> };
      return payload.content?.[0]?.text ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * Локальный Claude CLI — путь для машины разработчика без выданного ключа.
 *
 * Каждый запрос здесь стоит запуска полноценного процесса, поэтому их число
 * ограничено: дюжина одновременных запусков не ускоряет расчёт, а забивает
 * машину и растягивает его в разы. Для эксплуатации правильный путь — ключ
 * `ANTHROPIC_API_KEY`: там запрос идёт по HTTP и стоит десятки миллисекунд.
 */
class ClaudeCliProvider implements LlmProvider {
  readonly name = 'claude-cli';
  private readonly binary: string;
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(binary: string) {
    this.binary = binary;
  }

  async complete(prompt: string): Promise<string | null> {
    if (this.active >= MAX_CLI_PROCESSES) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await this.spawnOnce(prompt);
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }

  private spawnOnce(prompt: string): Promise<string | null> {
    return new Promise((resolve) => {
      const child = spawn(this.binary, ['-p'], { stdio: ['pipe', 'pipe', 'ignore'] });
      let output = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(null);
      }, 90_000);

      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0 && output.trim() ? output : null);
      });

      child.stdin.end(prompt);
    });
  }
}

/**
 * Сколько процессов CLI разрешено держать одновременно.
 *
 * Замеры на холодном кэше: без ограничения — 70 с, с ограничением в четыре —
 * 99 с. Узкое место не в конкуренции за машину, а в самой стоимости запуска,
 * поэтому предел поставлен высоко и служит только страховкой от лавины.
 */
const MAX_CLI_PROCESSES = 12;

let cached: LlmProvider | null = null;

export function getProvider(): LlmProvider {
  if (cached) return cached;

  if (process.env.SKLEJKA_DISABLE_AI === '1') {
    cached = new NullProvider();
  } else if (process.env.ANTHROPIC_API_KEY) {
    cached = new AnthropicProvider(
      process.env.ANTHROPIC_API_KEY,
      process.env.SKLEJKA_MODEL ?? 'claude-opus-4-7',
    );
  } else if (process.env.SKLEJKA_CLAUDE_CLI) {
    // Локальный CLI подключается только по явному указанию. Раньше он был
    // умолчанием, и на сервере без него каждое предложение шлюзов уходило в
    // запуск несуществующего процесса — расчёт не ломался, но и не ускорялся,
    // зато исправно ждал таймаута.
    cached = new ClaudeCliProvider(process.env.SKLEJKA_CLAUDE_CLI);
  } else {
    cached = new NullProvider();
  }

  return cached;
}

/**
 * Есть ли модель.
 *
 * Интерфейс спрашивает об этом, чтобы не показывать разбор события словами
 * там, где разбирать некому: кнопка, которая всегда отвечает «не удалось», —
 * хуже отсутствующей кнопки.
 */
export function aiEnabled(): boolean {
  return getProvider().name !== 'none';
}

/**
 * Незавершённые запросы к модели.
 *
 * Дисковый кэш спасает только между запусками. Внутри одного расчёта пять
 * гостей спрашивают про один и тот же город одновременно, промахиваются мимо
 * ещё не записанного файла — и запускают пять одинаковых процессов CLI по
 * несколько секунд каждый. Здесь одинаковые запросы схлопываются в один.
 */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Дисковый кэш ответов модели.
 *
 * Подсказки про географию не меняются между запусками, а показывать продукт
 * приходится в реальном времени: без кэша каждая демонстрация оплачивала бы
 * несколько секунд ожидания на ровном месте.
 */
export function completeCached(key: string, prompt: string): Promise<string | null> {
  const provider = getProvider();
  if (provider.name === 'none') return Promise.resolve(null);

  const hash = createHash('sha256').update(`${provider.name}:${key}:${prompt}`).digest('hex').slice(0, 32);

  const running = inFlight.get(hash);
  if (running) return running;

  const pending = resolveAnswer(provider, hash, prompt).finally(() => inFlight.delete(hash));
  inFlight.set(hash, pending);
  return pending;
}

async function resolveAnswer(
  provider: LlmProvider,
  hash: string,
  prompt: string,
): Promise<string | null> {
  const file = join(CACHE_DIR, `${hash}.txt`);

  try {
    return await readFile(file, 'utf8');
  } catch {
    // Промаха кэша достаточно, чтобы пойти в модель.
  }

  const answer = await provider.complete(prompt);
  if (answer === null) return null;

  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, answer, 'utf8');
  } catch {
    // Кэш — оптимизация; невозможность записи не повод терять готовый ответ.
  }

  return answer;
}

/** Модели свойственно оборачивать JSON в пояснения и ограждения из бэктиков. */
export function extractJson<T>(raw: string | null): T | null {
  if (!raw) return null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;

  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  const end = Math.max(candidate.lastIndexOf(']'), candidate.lastIndexOf('}'));
  if (end <= start) return null;

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
