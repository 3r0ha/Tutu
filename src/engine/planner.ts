/**
 * Планировщик маршрутов.
 *
 * Порядок работы важен для стоимости: сначала выясняем, из каких городов
 * вообще существует въезд в пункт назначения (шлюзы), и только потом ищем, как
 * добраться до этих шлюзов. Обратный порядок означал бы веер запросов к городам,
 * из которых въезда всё равно нет.
 */

import type { McpClient } from '../mcp/client.ts';
import { searchLeg, searchOvernight, type LegSearch } from '../mcp/tutu.ts';
import type {
  CityRef,
  GatewayReport,
  Hop,
  Journey,
  OvernightStay,
  PlanResult,
  Unreachable,
} from '../domain/types.ts';
import { gatewayCandidates, HUBS } from './hubs.ts';
import { assessRisk, buildJourney, directJourney, feasibleConnections, type Connection } from './compose.ts';
import { proposeExits, proposeGateways } from '../ai/gateways.ts';
import { getProvider } from '../ai/provider.ts';
import { distanceBetween, resolveCoordinates } from './geo.ts';
import { settleSoft } from './settle.ts';

/** Сколько прямых вариантов показывать на каждый вид транспорта. */
const DIRECT_PER_MODE = 3;

/**
 * Во сколько раз дорога через шлюз может быть длиннее прямой.
 *
 * Порог проверен на реальных маршрутах: при 2.0 из двенадцати кандидатов на
 * Москва→Казань отсеиваются пять заведомо абсурдных (Новосибирск — крюк в семь
 * раз), а все города, через которые маршруты действительно находятся, остаются,
 * включая Ульяновск с крюком 1.22 — через него склейка выходит дешевле прямого
 * поезда.
 */
const MAX_DETOUR_RATIO = 2.0;
/** Ниже этого числа кандидатов отсев не применяется — лучше лишние запросы, чем пустая выдача. */
const MIN_CANDIDATES = 4;
/** Сколько подтверждённых шлюзов уходит в фазу подъезда. */
const MAX_APPROACHES = 6;
/** Мягкий срок фазы: после него отстающие запросы бросаются недождавшись. */
const PHASE_DEADLINE_MS = 7000;
/**
 * Сколько кандидатов дожидаться обязательно, даже если приоритетных меньше.
 *
 * Обязательная часть решает, есть ли маршрут вообще. Бросать её по сроку
 * нельзя: далёкие города отвечают пустотой быстро, набирают минимум — и
 * единственный настоящий шлюз отбрасывается как отстающий. Так Териберка
 * получала «въезда нет» при живом рейсе из Мурманска.
 */
const MIN_CORE_GATEWAYS = 4;
/**
 * Верхняя граница обязательной части.
 *
 * Она не имеет мягкого срока, поэтому каждый лишний кандидат в ней — это
 * прямая надбавка ко времени ответа: при шести медиана вырастала с десяти
 * секунд до двадцати пяти.
 */
const MAX_CORE_GATEWAYS = 4;

export interface PlanOptions {
  adults?: number;
  /** Сколько городов проверять на роль шлюза. */
  maxGateways?: number;
  /** Верхняя граница числа маршрутов в ответе. */
  limit?: number;
  /** Отключает склейку — режим «как ищет сам Туту», нужен для сравнения в интерфейсе. */
  directOnly?: boolean;
}

export async function planRoute(
  mcp: McpClient,
  origin: string,
  destination: string,
  date: string,
  options: PlanOptions = {},
): Promise<PlanResult> {
  const startedAt = Date.now();
  const adults = options.adults ?? 1;
  const limit = options.limit ?? 12;
  const before = { ...mcp.stats };

  const direct = await searchLeg(mcp, origin, destination, date, { adults });
  const originRef: CityRef = direct?.from ?? { name: origin, geoId: null, region: null };
  const destinationRef: CityRef = direct?.to ?? { name: destination, geoId: null, region: null };
  const directJourneys = (direct?.hops ?? []).map(directJourney);

  let composed: Journey[] = [];
  let gateways: GatewayReport = {
    proposedByAi: [],
    fromCatalog: [],
    confirmed: [],
    reachableFromOrigin: [],
    aiProvider: getProvider().name,
  };

  if (!options.directOnly) {
    const result = await composeThroughGateways(mcp, origin, destination, date, adults, options);
    composed = result.journeys;
    gateways = result.gateways;
  }

  const journeys = rank([...directJourneys, ...composed], limit);

  return {
    origin: originRef,
    destination: destinationRef,
    date,
    journeys,
    directCount: directJourneys.length,
    composedCount: composed.length,
    gateways,
    unreachable: explainEmptiness(journeys.length, direct, gateways, options),
    diagnostics: {
      mcpCalls: mcp.stats.calls - before.calls,
      cacheHits: mcp.stats.cacheHits - before.cacheHits,
      retries: mcp.stats.retries - before.retries,
      failures: mcp.stats.failures - before.failures,
      elapsedMs: Date.now() - startedAt,
    },
  };
}

async function composeThroughGateways(
  mcp: McpClient,
  origin: string,
  destination: string,
  date: string,
  adults: number,
  options: PlanOptions,
): Promise<{ journeys: Journey[]; gateways: GatewayReport }> {
  // Спрашиваем про оба конца: как въезжают в цель и как выезжают из точки
  // отправления. Для малого города это разные списки, и без второго продукт
  // умел добираться, но не умел уезжать.
  const [entryGateways, exitGateways] = await Promise.all([
    proposeGateways(destination),
    proposeExits(origin),
  ]);
  // Списки чередуются, а не склеиваются встык: при простом объединении въездные
  // кандидаты занимали всю голову очереди и выталкивали выездные за отсечку —
  // Плёс → Казань так терял Иваново, единственный реальный выезд, и выдача
  // схлопывалась с двух маршрутов до нуля.
  const proposedByAi = interleave(entryGateways, exitGateways);
  const fromCatalog = gatewayCandidates(destination, origin);

  // Отсев идёт до единого сетевого вызова: и география, и приоритет источников
  // известны заранее, платить запросами за заведомо абсурдные пересадки незачем.
  const selection = await selectGateways(origin, destination, proposedByAi, fromCatalog, {
    limit: options.maxGateways ?? 10,
  });
  const candidates = selection.cities;

  const report: GatewayReport = {
    proposedByAi,
    fromCatalog,
    confirmed: [],
    reachableFromOrigin: [],
    aiProvider: getProvider().name,
  };
  const nextDay = addDays(date, 1);

  // Фаза 1. Кто вообще является въездом в пункт назначения.
  // Кандидаты отсортированы по величине крюка, поэтому дожидаться обязательно
  // стоит первых — они и дадут лучшие маршруты.
  const probes = candidates.map(async (city) => {
    // Оба дня запрашиваются одновременно: поздний приезд в шлюз стыкуется
    // с утренним рейсом следующего дня, и без него ночёвок бы не нашлось.
    const [sameDay, nextDayLeg] = await Promise.all([
      searchLeg(mcp, city, destination, date, { adults }),
      searchLeg(mcp, city, destination, nextDay, { adults }),
    ]);
    return { city, sameDay, nextDay: nextDayLeg };
  });

  // Приоритетные кандидаты дожидаются полностью, остальные — по мягкому сроку:
  // хвост даёт дополнительное покрытие, но не отвечает за сам факт маршрута.
  const core = probes.slice(0, selection.coreSize);
  const tail = probes.slice(selection.coreSize);

  const [coreEntries, tailEntries] = await Promise.all([
    Promise.all(core),
    settleSoft(tail, { deadlineMs: PHASE_DEADLINE_MS, minResults: 0 }),
  ]);

  const entries = [...coreEntries, ...tailEntries].filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null,
  );

  const confirmed = entries.filter(
    (entry) => (entry.sameDay?.hops.length ?? 0) + (entry.nextDay?.hops.length ?? 0) > 0,
  );
  report.confirmed = confirmed.map((entry) => entry.city);
  if (confirmed.length === 0) return { journeys: [], gateways: report };

  // Фаза 2. Как доехать до подтверждённых шлюзов.
  // Хорошо связанный пункт назначения подтверждает почти каждого кандидата,
  // поэтому берём лучшие по крюку: остальные всё равно проиграют в выдаче.
  const order = new Map(candidates.map((city, index) => [city, index]));
  const nearest = [...confirmed]
    .sort((left, right) => (order.get(left.city) ?? 99) - (order.get(right.city) ?? 99))
    .slice(0, MAX_APPROACHES);

  const approaches = (
    await settleSoft(
      nearest.map(async (gateway) => ({
        gateway,
        inbound: await searchLeg(mcp, origin, gateway.city, date, { adults }),
      })),
      { deadlineMs: PHASE_DEADLINE_MS, minResults: Math.min(nearest.length, 2) },
    )
  ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  // Фаза 3. Склейка по времени.
  const connections: Connection[] = [];
  const outboundByCity = new Map<string, Hop[]>();

  for (const { gateway, inbound } of approaches) {
    const outbound = [...(gateway.sameDay?.hops ?? []), ...(gateway.nextDay?.hops ?? [])];
    if (inbound?.hops.length) report.reachableFromOrigin.push(gateway.city);
    if (!inbound?.hops.length || outbound.length === 0) continue;
    outboundByCity.set(gateway.city, outbound);
    connections.push(...feasibleConnections(gateway.city, inbound.hops, outbound));
  }

  // Фаза 4. Ночёвки только для отобранных вариантов — отель стоит отдельного запроса.
  const selected = selectForPricing(connections);
  const journeys = await Promise.all(
    selected.map(async (connection) => {
      const outbound = outboundByCity.get(connection.city) ?? [];
      const risk = assessRisk(connection, outbound);
      const lodging = connection.lodgingNight
        ? await priceLodging(mcp, connection.city, connection.lodgingNight, adults)
        : null;
      // Ночёвка нужна, но отелей не нашлось — вариант нечестный, убираем.
      if (connection.needsLodging && !lodging) return null;
      return buildJourney(connection, risk, lodging);
    }),
  );

  return {
    journeys: journeys.filter((journey): journey is Journey => journey !== null),
    gateways: report,
  };
}

async function priceLodging(
  mcp: McpClient,
  city: string,
  night: { checkIn: string; checkOut: string },
  adults: number,
): Promise<OvernightStay | null> {
  const option = await searchOvernight(mcp, city, night.checkIn, night.checkOut, adults);
  if (!option) return null;
  return {
    city,
    checkIn: night.checkIn,
    checkOut: night.checkOut,
    hotelName: option.hotelName,
    price: option.price,
    checkoutUrl: option.checkoutUrl,
  };
}

/**
 * Отбор пар, достойных запроса цены отеля.
 *
 * Полный перебор даёт тысячи пар при десятке шлюзов, а каждая ночёвка — это
 * отдельный запрос. Берём по нескольку лучших в каждой корзине «город × нужна ли
 * ночь», сохраняя и самый дешёвый, и самый спокойный вариант.
 */
function selectForPricing(connections: Connection[], perBucket = 3): Connection[] {
  const buckets = new Map<string, Connection[]>();

  for (const connection of connections) {
    const key = `${connection.city}|${connection.needsLodging}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(connection);
    buckets.set(key, bucket);
  }

  const selected: Connection[] = [];
  for (const bucket of buckets.values()) {
    const byPrice = [...bucket].sort(
      (a, b) => a.inbound.price.amount + a.outbound.price.amount - (b.inbound.price.amount + b.outbound.price.amount),
    );
    const byComfort = [...bucket].sort((a, b) => b.waitMin - a.waitMin);

    const picked = new Set<Connection>();
    for (const connection of byPrice.slice(0, perBucket)) picked.add(connection);
    // Самое просторное окно почти всегда самое надёжное — держим его в выдаче.
    if (byComfort[0]) picked.add(byComfort[0]);
    selected.push(...picked);
  }

  return selected;
}

/**
 * Ранжирование с сохранением разнообразия.
 *
 * Сортировка по одной цене схлопывает выдачу в пять почти одинаковых вариантов
 * через один и тот же город, поэтому в ответе держим по одному лучшему
 * представителю каждой комбинации «через что × с ночёвкой ли × насколько рискованно».
 */
function rank(journeys: Journey[], limit: number): Journey[] {
  const sorted = [...journeys].sort((a, b) => {
    if (a.totalPrice.amount !== b.totalPrice.amount) return a.totalPrice.amount - b.totalPrice.amount;
    return (a.totalDurationMin ?? Infinity) - (b.totalDurationMin ?? Infinity);
  });

  const seenComposed = new Set<string>();
  const directPerMode = new Map<string, number>();
  const diverse: Journey[] = [];

  for (const journey of sorted) {
    const modes = journey.hops.map((hop) => hop.mode).join('+');

    if (journey.kind === 'direct') {
      // Прямые режем по видам транспорта: иначе десяток поездов вытеснит
      // из выдачи единственный самолёт и сравнивать будет нечего.
      const shown = directPerMode.get(modes) ?? 0;
      if (shown >= DIRECT_PER_MODE) continue;
      directPerMode.set(modes, shown + 1);
    } else {
      const key = `${modes}|${journey.via.join('>')}|${journey.lodgingPrice ? 'night' : 'same'}|${journey.risk}`;
      if (seenComposed.has(key)) continue;
      seenComposed.add(key);
    }

    diverse.push(journey);
    if (diverse.length >= limit) break;
  }

  return diverse;
}

function explainEmptiness(
  found: number,
  direct: LegSearch | null,
  gateways: GatewayReport,
  options: PlanOptions,
): Unreachable | null {
  if (found > 0) return null;
  if (!direct) {
    return { reason: 'upstream_failed', note: 'Туту не ответил по этому направлению — попробуйте повторить.' };
  }
  if (options.directOnly) {
    return { reason: 'no_direct', note: 'Прямого сообщения нет. Составные маршруты отключены.' };
  }
  const tried = new Set([...gateways.proposedByAi, ...gateways.fromCatalog]).size;
  if (gateways.confirmed.length === 0) {
    return {
      reason: 'no_gateway',
      note: `Ни из одного из ${tried} проверенных городов въезда в пункт назначения не нашлось.`,
    };
  }
  // Въезд в цель есть, но выехать неоткуда — это совсем другая беда, и путать
  // её с неудачной стыковкой значит показывать пользователю ложную причину.
  if (gateways.reachableFromOrigin.length === 0) {
    return {
      reason: 'no_exit',
      note: `Из города отправления Туту не вернул рейсов ни в один из ${tried} проверенных городов.`,
    };
  }
  return {
    reason: 'no_connection',
    note: `Доехать можно до ${gateways.reachableFromOrigin.join(', ')}, но состыковаться по времени с рейсом до цели не удалось.`,
  };
}

/** Поочерёдно берёт по элементу из каждого списка, отбрасывая повторы. */
export function interleave(left: string[], right: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    for (const city of [left[index], right[index]]) {
      if (!city || seen.has(city)) continue;
      seen.add(city);
      merged.push(city);
    }
  }

  return merged;
}

interface GatewaySelection {
  cities: string[];
  /** Сколько первых кандидатов дожидаться обязательно. */
  coreSize: number;
}

/**
 * Отбор и порядок кандидатов в шлюзы.
 *
 * Одной географии мало. На оси Москва—Мурманск крюк у дюжины городов лежит
 * в пределах 1.01–1.07, ранжирование по нему ничего не различает, и Мурманск —
 * единственный реальный въезд в Териберку — оказывался одиннадцатым и срезался.
 * В обратную сторону та же беда: до Суздаля из Екатеринбурга Москва стоит
 * восемнадцатой за кластером мелких соседей, хотя трафик идёт именно через неё.
 *
 * Поэтому вперёд идут два высокосигнальных источника: города, названные
 * моделью (она знает местный въезд), и федеральные хабы. Они же составляют
 * обязательную часть, которую нельзя бросить по сроку. Остальное добирается
 * по величине крюка.
 */
async function selectGateways(
  origin: string,
  destination: string,
  proposedByAi: string[],
  fromCatalog: string[],
  options: { limit: number },
): Promise<GatewaySelection> {
  const normalizedOrigin = origin.trim().toLowerCase();
  const all = [...new Set([...proposedByAi, ...fromCatalog])].filter(
    (city) => city.trim().toLowerCase() !== normalizedOrigin,
  );

  const ratios = await detourRatios(origin, destination, all);
  const withinReach = (city: string): boolean => (ratios.get(city) ?? 0) <= MAX_DETOUR_RATIO;
  const byRatio = (left: string, right: string): number =>
    (ratios.get(left) ?? Infinity) - (ratios.get(right) ?? Infinity);

  const fromAi = new Set(proposedByAi);
  const national = new Set(HUBS.filter((hub) => hub.national).map((hub) => hub.name));

  const priority = all.filter((city) => (fromAi.has(city) || national.has(city)) && withinReach(city));
  const rest = all.filter((city) => !priority.includes(city) && withinReach(city));

  // Внутри приоритета порядок модели важнее географии: она перечисляет
  // вероятнейший въезд первым, а по крюку у соседних городов разницы почти нет —
  // Мурманск, единственный въезд в Териберку, там лишь пятый.
  const aiOrder = new Map(proposedByAi.map((city, index) => [city, index]));
  priority.sort((left, right) => {
    const rank = (city: string): number => aiOrder.get(city) ?? 100;
    const byModel = rank(left) - rank(right);
    return byModel !== 0 ? byModel : byRatio(left, right);
  });
  rest.sort(byRatio);

  let cities = [...priority, ...rest].slice(0, options.limit);

  // Ничего не прошло порог — берём лучших по крюку, каким бы он ни был:
  // лишние запросы дешевле пустой выдачи.
  if (cities.length < MIN_CANDIDATES) {
    cities = [...all].sort(byRatio).slice(0, MIN_CANDIDATES);
  }

  return {
    cities,
    coreSize: Math.min(cities.length, MIN_CORE_GATEWAYS, MAX_CORE_GATEWAYS),
  };
}

/**
 * Во сколько раз дорога через каждый город длиннее прямой.
 *
 * Город с неизвестными координатами получает бесконечность и уходит в конец,
 * но не отбрасывается: отсутствие данных в нашей таблице не довод против
 * маршрута. Если неизвестен сам маршрут, отсев отключается целиком.
 */
async function detourRatios(
  origin: string,
  destination: string,
  cities: string[],
): Promise<Map<string, number>> {
  const [from, to] = await Promise.all([
    resolveCoordinates(origin),
    resolveCoordinates(destination),
  ]);

  const ratios = new Map<string, number>();
  const direct = from && to ? distanceBetween(from, to) : 0;

  if (!from || !to || direct < 1) {
    for (const city of cities) ratios.set(city, 1);
    return ratios;
  }

  await Promise.all(
    cities.map(async (city) => {
      const at = await resolveCoordinates(city);
      ratios.set(
        city,
        at ? (distanceBetween(from, at) + distanceBetween(at, to)) / direct : Number.POSITIVE_INFINITY,
      );
    }),
  );

  return ratios;
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() + days);
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
