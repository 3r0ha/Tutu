/**
 * Ограничение частоты запросов.
 *
 * Здесь это не формальность. Один вызов `/api/event` разворачивается в две-три
 * сотни запросов к Туту и занимает до минуты процессорного и сетевого времени.
 * Без ограничения десяток одновременных запросов с одного адреса кладёт стенд
 * и выжигает квоту у Туту — причём не злым умыслом, а вкладкой, которую
 * кто-то обновил пять раз подряд.
 *
 * Поэтому пределы разные по цене операции: тяжёлый расчёт считается штучно,
 * чтение — щедро. Счёт ведётся скользящим окном, а не корзиной токенов:
 * окно проще объяснить в ответе («попробуйте через 40 секунд») и оно не
 * позволяет накопить залп на потом.
 *
 * Память ограничена сверху: адресов больше `MAX_TRACKED` не хранится, самые
 * старые вытесняются. Иначе сам ограничитель стал бы способом съесть память.
 */

export interface Limit {
  /** Сколько запросов разрешено в окне. */
  quota: number;
  /** Длина окна, мс. */
  windowMs: number;
}

/** Расчёт маршрутов: сотни обращений к Туту на каждый вызов. */
export const HEAVY: Limit = { quota: 6, windowMs: 60_000 };
/** Запросы, которые ходят в Туту, но одним-двумя вызовами. */
export const MEDIUM: Limit = { quota: 30, windowMs: 60_000 };
/** Чтение своего же события и статики. */
export const LIGHT: Limit = { quota: 240, windowMs: 60_000 };
/** Загрузка картинок: мегабайты на диск. */
export const UPLOAD: Limit = { quota: 20, windowMs: 60_000 };

const MAX_TRACKED = 5_000;

interface Window {
  hits: number[];
  touchedAt: number;
}

const windows = new Map<string, Window>();

export interface Verdict {
  allowed: boolean;
  /** Через сколько секунд имеет смысл повторить. */
  retryAfterSec: number;
}

export function checkLimit(key: string, limit: Limit, now = Date.now()): Verdict {
  const since = now - limit.windowMs;

  let window = windows.get(key);
  if (!window) {
    if (windows.size >= MAX_TRACKED) evictOldest();
    window = { hits: [], touchedAt: now };
    windows.set(key, window);
  }

  window.touchedAt = now;
  window.hits = window.hits.filter((at) => at > since);

  if (window.hits.length >= limit.quota) {
    const oldest = window.hits[0];
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((oldest + limit.windowMs - now) / 1000)) };
  }

  window.hits.push(now);
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * Освобождение места под новые адреса.
 *
 * Вытесняется десятая часть самых давно не заходивших — по одной записи за раз
 * означало бы линейный поиск на каждом запросе при полной таблице.
 */
function evictOldest(): void {
  const sorted = [...windows.entries()].sort((left, right) => left[1].touchedAt - right[1].touchedAt);
  for (const [key] of sorted.slice(0, Math.ceil(MAX_TRACKED / 10))) windows.delete(key);
}

/**
 * Кто именно стучится.
 *
 * За nginx настоящий адрес приходит в `X-Forwarded-For`, но верить заголовку
 * от клиента нельзя: подделав его, любой обошёл бы ограничение. Доверяем
 * только когда сами поставили прокси перед собой — об этом говорит
 * `SKLEJKA_TRUST_PROXY`, и берём при этом ПОСЛЕДНИЙ адрес в цепочке, который
 * дописал наш же прокси, а не первый, который прислал клиент.
 */
export function clientKey(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy && typeof forwardedFor === 'string') {
    const chain = forwardedFor.split(',').map((part) => part.trim()).filter(Boolean);
    const last = chain[chain.length - 1];
    if (last) return last;
  }
  return remoteAddress ?? 'unknown';
}

/** Только для тестов: ограничитель хранит состояние между вызовами. */
export function resetLimits(): void {
  windows.clear();
}
