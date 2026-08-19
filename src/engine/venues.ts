/**
 * Подбор места встречи.
 *
 * Организатор обычно приходит с готовым ответом «едем в Суздаль» и узнаёт цену
 * этого решения задним числом. Но у него есть список гостей по городам, а у нас
 * — движок достижимости: значит можно перевернуть вопрос и спросить не «доедут
 * ли до Суздаля», а «где собраться, чтобы всем было удобно».
 *
 * Оценка намеренно грубая — по прямому сообщению, одним запросом на пару
 * «гость — город». Полный расчёт со склейкой стоил бы сотен вызовов на каждого
 * кандидата и превратил бы подсказку в получасовое ожидание. Здесь задача
 * другая: отсеять заведомо неудобные точки и предложить несколько разумных,
 * а точную картину даёт обычный расчёт по кнопке.
 */

import type { McpClient } from '../mcp/client.ts';
import { searchLeg } from '../mcp/tutu.ts';
import { HUBS, type Hub } from './hubs.ts';
import { distanceBetween, resolveCoordinates, type Coordinates } from './geo.ts';
import { settleSoft } from './settle.ts';

/** Сколько городов проверять. Каждый стоит одного запроса на гостя. */
const MAX_CANDIDATES = 8;
/**
 * Мягкий срок на всю проверку.
 *
 * Подсказка не должна превращаться в ожидание, но и три города из восьми —
 * слишком тонкая выдача, чтобы на ней выбирать. Компромисс: ждём дольше,
 * зато обязательный минимум выше.
 */
const PROBE_DEADLINE_MS = 18_000;
const MIN_SCORED = 5;

export interface VenueGuest {
  name: string;
  city: string;
}

export interface VenueOption {
  city: string;
  /** Скольким гостям есть прямое сообщение до этого города. */
  reachable: number;
  guests: number;
  /** Сумма минимальных цен по прямым рейсам, ₽. Не итог поездки, а признак. */
  approxCost: number;
  /** Самая долгая дорога среди гостей, минуты. */
  worstDurationMin: number | null;
  /** Города, откуда прямого сообщения не нашлось. */
  hardFor: string[];
}

export interface VenueSuggestion {
  options: VenueOption[];
  probedCities: string[];
  note: string;
}

export async function suggestVenues(
  mcp: McpClient,
  guests: VenueGuest[],
  date: string,
): Promise<VenueSuggestion> {
  const origins = [...new Set(guests.map((guest) => guest.city.trim()).filter(Boolean))];
  if (origins.length === 0) {
    return { options: [], probedCities: [], note: 'Нужен хотя бы один гость с городом.' };
  }

  const candidates = await pickCandidates(mcp, origins);
  if (candidates.length === 0) {
    return { options: [], probedCities: [], note: 'Не удалось подобрать города-кандидаты.' };
  }

  const probes = candidates.map(async (city) => scoreCity(mcp, city, origins, date));
  const scored = (
    await settleSoft(probes, {
      deadlineMs: PROBE_DEADLINE_MS,
      minResults: Math.min(MIN_SCORED, probes.length),
    })
  ).filter((option): option is VenueOption => option !== null);

  // Сначала те, до кого доезжает больше народу; при равенстве — где дешевле.
  scored.sort((left, right) => {
    if (left.reachable !== right.reachable) return right.reachable - left.reachable;
    return left.approxCost - right.approxCost;
  });

  const dropped = candidates.length - scored.length;

  return {
    options: scored,
    probedCities: candidates,
    note:
      'Оценка по прямому сообщению — она только отсеивает неудобные точки. ' +
      'Точную картину со склейкой даст полный расчёт.' +
      // Молчаливое усечение выдачи читалось бы как «других вариантов нет».
      (dropped > 0 ? ` Ещё ${dropped} города не ответили за отведённое время.` : ''),
  };
}

/**
 * Кандидаты — города каталога, ближайшие к «центру тяжести» гостей.
 *
 * Геометрия здесь только отбирает, кого проверять: доказывает удобство
 * исключительно живой ответ Туту.
 */
async function pickCandidates(mcp: McpClient, origins: string[]): Promise<string[]> {
  const points = await Promise.all(origins.map((city) => resolveCoordinates(city, mcp)));
  const known = points.filter((point): point is Coordinates => point !== null);
  if (known.length === 0) return HUBS.filter((hub) => hub.national).map((hub) => hub.name);

  const centre: Coordinates = {
    lat: known.reduce((sum, point) => sum + point.lat, 0) / known.length,
    lon: known.reduce((sum, point) => sum + point.lon, 0) / known.length,
    source: 'catalog',
  };

  const excluded = new Set(origins.map((city) => city.toLowerCase()));

  return HUBS.filter((hub: Hub) => !excluded.has(hub.name.toLowerCase()))
    .map((hub) => ({
      name: hub.name,
      // Сумма расстояний до всех гостей честнее расстояния до центра:
      // она не даёт городу выиграть за счёт одного близкого гостя.
      spread: known.reduce((sum, point) => sum + distanceBetween(point, { ...hub, source: 'catalog' }), 0),
      toCentre: distanceBetween(centre, { ...hub, source: 'catalog' }),
    }))
    .sort((left, right) => left.spread - right.spread || left.toCentre - right.toCentre)
    .slice(0, MAX_CANDIDATES)
    .map((entry) => entry.name);
}

async function scoreCity(
  mcp: McpClient,
  city: string,
  origins: string[],
  date: string,
): Promise<VenueOption> {
  const legs = await Promise.all(
    origins.map(async (origin) => ({
      origin,
      leg: await searchLeg(mcp, origin, city, date, { pageSize: 10 }),
    })),
  );

  let approxCost = 0;
  let worstDurationMin: number | null = null;
  const hardFor: string[] = [];

  for (const { origin, leg } of legs) {
    const hops = leg?.hops ?? [];
    if (hops.length === 0) {
      hardFor.push(origin);
      continue;
    }

    const cheapest = hops.reduce((best, hop) => (hop.price.amount < best.price.amount ? hop : best));
    approxCost += cheapest.price.amount;

    const fastest = hops.reduce(
      (best, hop) => ((hop.durationMin ?? Infinity) < (best ?? Infinity) ? (hop.durationMin ?? best) : best),
      null as number | null,
    );
    if (fastest !== null) worstDurationMin = Math.max(worstDurationMin ?? 0, fastest);
  }

  return {
    city,
    reachable: origins.length - hardFor.length,
    guests: origins.length,
    approxCost: Math.round(approxCost),
    worstDurationMin,
    hardFor,
  };
}
