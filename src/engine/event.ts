/**
 * Достижимость события для списка гостей — в обе стороны.
 *
 * Витрина продукта: организатор задаёт место и даты, а мы отвечаем, кто из
 * гостей физически доедет, кто сможет уехать обратно и чего это стоит.
 *
 * Даты здесь — даты **проведения**, а не поездки гостя. Разница
 * принципиальна: приехать можно и накануне, уехать — и на следующий день,
 * лишь бы человек застал само событие. Поэтому точная дата не единственная:
 * если рейсов на неё нет, проверяются соседние в допустимую сторону —
 * раньше для приезда, позже для отъезда.
 *
 * Событие может начаться в одном городе и закончиться в другом: свадьба
 * в Суздале, проводы во Владимире. Поэтому мест два.
 *
 * Обратное направление считается отдельно, а не зеркалится, потому что
 * расписание несимметрично. Замер 2026-09-13: `Москва→Суздаль` — два рейса,
 * `Суздаль→Москва` — ни одного, тогда как Коломна, Выборг, Плёс и Тула ходят
 * в обе стороны поровну. Гость, которого выпустили из виду на обратном пути,
 * узнаёт об этом уже на месте.
 */

import type { McpClient } from '../mcp/client.ts';
import type { Journey, Money } from '../domain/types.ts';
import { addDays, planRoute } from './planner.ts';
import { resolveCoordinates, resolveMany, type Coordinates } from './geo.ts';

export interface Guest {
  name: string;
  city: string;
}

/**
 * `direct` — прямое сообщение есть в обе нужные стороны;
 * `composed` — доедет и уедет, но хотя бы одно направление собрано склейкой;
 * `stranded` — доедет, а обратных рейсов Туту не вернул;
 * `unreachable` — не доедет.
 */
export type GuestStatus = 'direct' | 'composed' | 'stranded' | 'unreachable';

/** Одно направление поездки со всеми найденными вариантами. */
export interface Direction {
  best: Journey | null;
  /** Лучший вариант, доступный обычным поиском Туту, — основа сравнения режимов. */
  directBest: Journey | null;
  alternatives: Journey[];
  /** Дата, на которую маршрут в итоге нашёлся. */
  date: string;
  /** Сдвиг от даты события в днях: 0 — день в день, −1 — накануне. */
  shiftDays: number;
  note: string;
}

export interface GuestPlan {
  name: string;
  city: string;
  status: GuestStatus;
  outbound: Direction;
  /** `null`, если обратная дата не запрашивалась. */
  inbound: Direction | null;
  /** Дорога в оба конца по лучшим вариантам. */
  totalPrice: Money | null;
  note: string;
}

export interface EventSummary {
  guests: number;
  reachableDirect: number;
  reachableComposed: number;
  unreachable: number;
  /** Доедут, но обратных рейсов не нашлось. */
  stranded: number;
  totalCost: number;
  currency: string;
  atRisk: number;
}

export interface EventPlan {
  destination: string;
  /** Город окончания события — совпадает с `destination`, когда он один. */
  endCity: string;
  date: string;
  returnDate: string | null;
  guests: GuestPlan[];
  summary: EventSummary;
  /** Координаты городов гостей и пересадок — только для отрисовки карты. */
  coordinates: Record<string, Coordinates>;
  destinationCoordinates: Coordinates | null;
  elapsedMs: number;
}

/** Где и когда проходит событие. */
export interface EventWhen {
  /** Город, где событие начинается. */
  startCity: string;
  /** Город, где заканчивается. Обычно тот же, но не обязан. */
  endCity: string;
  startDate: string;
  /** Дата окончания. Без неё дорога обратно не считается. */
  endDate: string | null;
}

export interface EventOptions {
  adults?: number;
  /**
   * На сколько дней разрешено отклониться от даты события.
   *
   * Приезд ищется в прошлое, отъезд — в будущее: приехать раньше и уехать
   * позже допустимо, наоборот — нет, иначе человек пропустит событие.
   */
  dateWindow?: number;
  /**
   * Координаты известных заранее точек — гостей и места события.
   *
   * Вызывается до расчёта маршрутов, чтобы интерфейс успел нарисовать карту
   * и заполнял её по мере готовности, а не показывал крутилку полминуты.
   */
  onGeo?: (geo: { coordinates: Record<string, Coordinates>; destination: Coordinates | null }) => void;
  /** Готовый гость. Порядок произвольный: считаются они параллельно. */
  onGuest?: (guest: GuestPlan) => void;
}

export async function planEvent(
  mcp: McpClient,
  when: EventWhen,
  guests: Guest[],
  options: EventOptions = {},
): Promise<EventPlan> {
  const startedAt = Date.now();
  const adults = options.adults ?? 1;
  const window = options.dateWindow ?? 2;

  // Города гостей и места события известны до расчёта — отдаём их сразу,
  // чтобы карта появилась прежде, чем посчитан первый маршрут.
  const [knownCoordinates, startCoordinates] = await Promise.all([
    resolveMany(guests.map((guest) => guest.city)),
    resolveCoordinates(when.startCity),
  ]);
  options.onGeo?.({ coordinates: knownCoordinates, destination: startCoordinates });

  // Гости считаются параллельно, но общий кэш клиента делает работу почти
  // линейной по числу городов, а не по числу людей: соседи делят одни плечи.
  const plans = await Promise.all(
    guests.map(async (guest) => {
      const plan = await planGuest(mcp, when, guest, adults, window);
      options.onGuest?.(plan);
      return plan;
    }),
  );

  // Города пересадок становятся известны только после расчёта, поэтому
  // их координаты доезжают вторым заходом.
  const transferCities = plans.flatMap((plan) => [
    ...(plan.outbound.best?.via ?? []),
    ...(plan.inbound?.best?.via ?? []),
  ]);
  const coordinates = {
    ...knownCoordinates,
    ...(await resolveMany([...transferCities, when.endCity])),
  };

  return {
    destination: when.startCity,
    endCity: when.endCity,
    date: when.startDate,
    returnDate: when.endDate,
    guests: plans,
    summary: summarize(plans, when.endDate !== null),
    coordinates,
    destinationCoordinates: startCoordinates,
    elapsedMs: Date.now() - startedAt,
  };
}

async function planGuest(
  mcp: McpClient,
  when: EventWhen,
  guest: Guest,
  adults: number,
  window: number,
): Promise<GuestPlan> {
  const [outbound, inbound] = await Promise.all([
    // Приехать можно день в день или раньше — но не позже начала.
    planDirection(mcp, guest.city, when.startCity, when.startDate, adults, backwards(window)),
    when.endDate
      ? // Уехать — день в день или позже: раньше окончания человек его пропустит.
        planDirection(mcp, when.endCity, guest.city, when.endDate, adults, forwards(window))
      : null,
  ]);

  const status = classify(outbound, inbound);
  const totalPrice = sumPrice(outbound.best, inbound?.best ?? null);

  return {
    name: guest.name,
    city: guest.city,
    status,
    outbound,
    inbound,
    totalPrice,
    note: describe(status, outbound, inbound),
  };
}

/** Смещения дат для приезда: день в день, затем всё раньше. */
function backwards(window: number): number[] {
  return Array.from({ length: window + 1 }, (_, index) => -index);
}

/** Смещения дат для отъезда: день в день, затем всё позже. */
function forwards(window: number): number[] {
  return Array.from({ length: window + 1 }, (_, index) => index);
}

/**
 * Направление с перебором соседних дат.
 *
 * Точная дата — предпочтительная, но не единственная: отсутствие рейсов
 * именно в этот день не значит, что человек не попадёт на событие. Смещения
 * пробуются по порядку и останавливаются на первом, где маршрут нашёлся.
 */
async function planDirection(
  mcp: McpClient,
  from: string,
  to: string,
  eventDate: string,
  adults: number,
  shifts: number[],
): Promise<Direction> {
  let fallbackNote = 'Туту не вернул вариантов на эти даты.';

  for (const shift of shifts) {
    const date = addDays(eventDate, shift);
    // Один вызов покрывает оба режима: прямые варианты приходят внутри общего
    // результата, поэтому сравнение «до/после» не стоит второго обхода сети.
    const plan = await planRoute(mcp, from, to, date, { adults, limit: 10 });

    const best = cheapest(plan.journeys);
    if (!best) {
      if (shift === shifts[0]) fallbackNote = plan.unreachable?.note ?? fallbackNote;
      continue;
    }

    const directBest = cheapest(plan.journeys.filter((journey) => journey.kind === 'direct'));
    const base = directBest
      ? 'Прямое сообщение есть.'
      : `Прямого сообщения нет — маршрут собран через ${best.via.join(', ')}.`;

    return {
      best,
      directBest,
      alternatives: plan.journeys.filter((journey) => journey.id !== best.id).slice(0, 5),
      date,
      shiftDays: shift,
      note: shift === 0 ? base : `${describeShift(shift)} ${base}`,
    };
  }

  return {
    best: null,
    directBest: null,
    alternatives: [],
    date: eventDate,
    shiftDays: 0,
    note: fallbackNote,
  };
}

function describeShift(shift: number): string {
  const days = Math.abs(shift);
  const word = days === 1 ? 'день' : 'дня';
  return shift < 0
    ? `Выезд за ${days} ${word} до начала — на саму дату рейсов нет.`
    : `Отъезд через ${days} ${word} после окончания — на саму дату рейсов нет.`;
}

function classify(outbound: Direction, inbound: Direction | null): GuestStatus {
  if (!outbound.best) return 'unreachable';
  if (inbound && !inbound.best) return 'stranded';

  const bothDirect = outbound.directBest !== null && (!inbound || inbound.directBest !== null);
  return bothDirect ? 'direct' : 'composed';
}

function describe(status: GuestStatus, outbound: Direction, inbound: Direction | null): string {
  if (status === 'unreachable') return outbound.note;
  if (status === 'stranded') {
    // Формулировка намеренно про отсутствие данных, а не про отсутствие рейсов:
    // утверждать второе по пустому ответу мы не вправе.
    return `Доедет, но обратных рейсов Туту не вернул. ${inbound?.note ?? ''}`.trim();
  }
  if (!inbound) return outbound.note;
  return `Туда: ${lower(outbound.note)} Обратно: ${lower(inbound.note)}`;
}

function lower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function cheapest(journeys: Journey[]): Journey | null {
  return journeys.reduce<Journey | null>(
    (best, journey) =>
      best === null || journey.totalPrice.amount < best.totalPrice.amount ? journey : best,
    null,
  );
}

function sumPrice(outbound: Journey | null, inbound: Journey | null): Money | null {
  if (!outbound) return null;
  const amount = outbound.totalPrice.amount + (inbound?.totalPrice.amount ?? 0);
  return { amount: Math.round(amount * 100) / 100, currency: outbound.totalPrice.currency };
}

function summarize(plans: GuestPlan[], hasReturn: boolean): EventSummary {
  // «Доедут» считается по полному кругу: гость, которого некому увезти обратно,
  // в число благополучных не попадает.
  const complete = plans.filter((plan) => plan.status === 'direct' || plan.status === 'composed');

  const reachableDirect = plans.filter(
    (plan) => plan.outbound.directBest !== null && (!hasReturn || plan.inbound?.directBest != null),
  ).length;

  const totalCost = complete.reduce((sum, plan) => sum + (plan.totalPrice?.amount ?? 0), 0);

  const atRisk = complete.filter(
    (plan) => plan.outbound.best?.risk === 'critical' || plan.inbound?.best?.risk === 'critical',
  ).length;

  return {
    guests: plans.length,
    reachableDirect,
    reachableComposed: complete.length,
    unreachable: plans.filter((plan) => plan.status === 'unreachable').length,
    stranded: plans.filter((plan) => plan.status === 'stranded').length,
    totalCost: Math.round(totalCost),
    currency: complete[0]?.totalPrice?.currency ?? 'RUB',
    atRisk,
  };
}
