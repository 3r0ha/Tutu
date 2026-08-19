/**
 * Групповая посадка в поезде.
 *
 * Когда несколько подтвердивших гостей едут одним поездом, организатор сейчас
 * сажает их вместе вручную — открывает схему каждого вагона и ищет свободный
 * отсек. Туту умеет отвечать на этот вопрос сам (`get_rail_seatmap` с
 * `task='together'`), но примитивом никто не пользуется.
 *
 * Здесь поверх него решается то, чего он не делает: компания больше шести
 * человек или отсек, куда вся компания не помещается. Тогда группа разбивается
 * на блоки, и блоки не пересекаются по местам.
 */

import type { McpClient } from '../mcp/client.ts';
import type { Money } from '../domain/types.ts';

/** Ограничение инструмента Туту: за один запрос ищется группа от 2 до 6 мест. */
const MAX_TOGETHER = 6;
const MIN_TOGETHER = 2;
/** Страховка от зацикливания при неожиданных ответах. */
const MAX_ROUNDS = 8;

export interface Seat {
  number: string;
  /** LOWER, UPPER, SIDE_LOWER, LOWER_NEAR_WC и прочие типы полок из Туту. */
  type: string | null;
}

export interface SeatBlock {
  /** У автобуса вагонов нет — поле пустует. */
  carNumber: string | null;
  carType: string | null;
  serviceClass: string | null;
  compartment: number | null;
  seats: Seat[];
  price: Money | null;
  fareType: string | null;
  /** Гендерная политика купе, если она есть. */
  gender: string | null;
  /**
   * Корзина Туту с уже выбранными местами этого блока.
   *
   * Без неё подбор оставался советом: мы называли вагон и номера, а человек шёл
   * выбирать их заново руками — и к моменту его клика они могли быть заняты.
   * Ссылка открывается в холодном браузере и не требует нашей сессии.
   */
  cartUrl: string | null;
}

export type SeatingStatus = 'together' | 'split' | 'partial' | 'impossible' | 'unavailable';

export interface SeatingPlan {
  party: number;
  status: SeatingStatus;
  blocks: SeatBlock[];
  seated: number;
  /** Самая большая компания, которая ещё помещается в один отсек. */
  largestTogether: number | null;
  totalPrice: Money | null;
  note: string;
}

interface RawSeat {
  number?: string;
  type?: string;
}

interface RawGroup {
  car_number?: string;
  car_type?: string;
  service_class?: string;
  compartment_number?: number;
  seat_numbers?: string[];
  seats?: RawSeat[];
  total_price?: { amount?: number; currency?: string };
  total_fare_type?: string;
  gender?: string;
}

interface RawSeatmap {
  seatmap_status?: string;
  largest_group_available?: number;
  groups_by_car_type?: Record<string, RawGroup[]>;
  best_available_groups_by_car_type?: Record<string, RawGroup[]>;
}

interface RawCarSeat {
  number?: string;
  type?: string;
  compartment_number?: number;
  distance_to_nearest_wc_px?: number;
}

interface RawCarMap {
  cars?: Array<{ car_number?: string; car_type?: string; service_class?: string; seats?: RawCarSeat[] }>;
}

/**
 * Подбирает места для компании на одном плече.
 *
 * `detailsRef` передаётся в Туту дословно: это непрозрачная ссылка на плечо,
 * и разбирать её на части мы не вправе — кроме вида транспорта, от которого
 * зависит сам способ подбора.
 */
export async function planSeating(
  mcp: McpClient,
  detailsRef: Record<string, unknown>,
  party: number,
  checkoutRef: Record<string, unknown> | null = null,
): Promise<SeatingPlan> {
  const plan = await choose(mcp, detailsRef, party);
  if (checkoutRef) await attachCarts(mcp, checkoutRef, plan.blocks);
  return plan;
}

/**
 * Корзина на каждый блок.
 *
 * Блок и есть заказ: у поезда это вагон с набором мест, у автобуса — порция,
 * которая помещается в одну покупку. Поэтому ссылок ровно столько же, сколько
 * блоков, и общей одной не бывает.
 *
 * Ошибку минта глушим: подбор мест сам по себе полезен, и терять его из-за
 * недоступной корзины неправильно — гость дойдёт до тех же мест обычной ссылкой.
 */
async function attachCarts(
  mcp: McpClient,
  checkoutRef: Record<string, unknown>,
  blocks: SeatBlock[],
): Promise<void> {
  await Promise.all(
    blocks.map(async (block) => {
      const seatNumbers = block.seats.map((seat) => seat.number);
      if (seatNumbers.length === 0) return;

      const link = await mcp.callToolSafe<{ kind?: string; checkout_url?: string }>(
        'create_checkout_link',
        {
          ...checkoutRef,
          seat_numbers: seatNumbers,
          ...(block.carNumber ? { car_number: block.carNumber } : {}),
          ...(block.fareType ? { fare_type: block.fareType } : {}),
          // Гендерную политику купе передаём только когда Туту её назвал:
          // NO_GENDER означает, что политики нет, а не что мы выбрали за человека.
          ...(block.gender === 'MALE' || block.gender === 'FEMALE'
            ? { gender_type: block.gender }
            : {}),
        },
      );

      // Обычный deeplink ведёт на страницу выбора мест — это не корзина
      // с нашими местами, и выдавать одно за другое нельзя.
      if (link?.kind === 'checkout_deeplink' && link.checkout_url) {
        block.cartUrl = link.checkout_url;
      }
    }),
  );
}

async function choose(
  mcp: McpClient,
  detailsRef: Record<string, unknown>,
  party: number,
): Promise<SeatingPlan> {
  if (party < MIN_TOGETHER) {
    return empty(party, 'unavailable', 'Для одного пассажира подбор соседних мест не нужен.');
  }

  if (detailsRef.transport === 'bus') return planBusSeating(mcp, detailsRef, party);

  const taken = new Set<string>();
  const blocks: SeatBlock[] = [];
  let remaining = party;
  let largestTogether: number | null = null;

  for (let round = 0; round < MAX_ROUNDS && remaining >= MIN_TOGETHER; round += 1) {
    const wanted = Math.min(remaining, MAX_TOGETHER);
    const response = await mcp.callToolSafe<RawSeatmap>('get_rail_seatmap', {
      details_ref: detailsRef,
      task: 'together',
      seats_together: wanted,
    });

    if (!response) {
      return finish(party, blocks, remaining, largestTogether, 'Туту не ответил на запрос схемы мест.');
    }

    const exact = collect(response.groups_by_car_type);
    const fallback = collect(response.best_available_groups_by_car_type);

    if (typeof response.largest_group_available === 'number') {
      largestTogether = response.largest_group_available;
    }

    // Точные группы отвечают запрошенному размеру; запасные меньше, но реальны.
    const candidates = exact.length > 0 ? exact : fallback;
    const picked = pickCheapest(candidates, taken);

    if (!picked) break;

    blocks.push(picked.block);
    for (const key of picked.keys) taken.add(key);
    remaining -= picked.block.seats.length;

    // Точная группа нужного размера закрывает всю компанию за один заход.
    if (exact.length > 0 && picked.block.seats.length === wanted && remaining <= 0) break;
  }

  // Подбор соседних мест работает от двух пассажиров, поэтому остаток в одного
  // он закрыть не может. Отправлять человека искать место самому, когда схема
  // вагона у нас уже под рукой, — это отговорка, а не ответ.
  if (remaining === 1 && blocks.length > 0) {
    const single = await findSingleSeat(mcp, detailsRef, blocks[blocks.length - 1], taken);
    if (single) {
      blocks.push(single);
      remaining -= 1;
    }
  }

  return finish(party, blocks, remaining, largestTogether, null);
}

/**
 * Место для последнего пассажира в том же вагоне, что и основная компания.
 *
 * Из свободных выбирается ближайший к группе отсек, а при равенстве — место
 * подальше от туалета: соседство с ним в поезде и есть та мелочь, из-за
 * которой поездка запоминается плохой.
 */
async function findSingleSeat(
  mcp: McpClient,
  detailsRef: Record<string, unknown>,
  anchor: SeatBlock,
  taken: Set<string>,
): Promise<SeatBlock | null> {
  const response = await mcp.callToolSafe<RawCarMap>('get_rail_seatmap', {
    details_ref: detailsRef,
    car_number: anchor.carNumber,
  });

  const car = response?.cars?.find((entry) => entry.car_number === anchor.carNumber) ?? response?.cars?.[0];
  const free = (car?.seats ?? []).filter(
    (seat) => seat.number && !taken.has(`${anchor.carNumber}#${seat.number}`),
  );
  if (free.length === 0) return null;

  const best = free.sort((left, right) => {
    const distance = (seat: RawCarSeat): number =>
      anchor.compartment === null || seat.compartment_number === undefined
        ? Number.POSITIVE_INFINITY
        : Math.abs(seat.compartment_number - anchor.compartment);
    const byCompartment = distance(left) - distance(right);
    if (byCompartment !== 0) return byCompartment;
    return (right.distance_to_nearest_wc_px ?? 0) - (left.distance_to_nearest_wc_px ?? 0);
  })[0];

  taken.add(`${anchor.carNumber}#${best.number}`);

  return {
    carNumber: anchor.carNumber,
    carType: car?.car_type ?? anchor.carType,
    serviceClass: car?.service_class ?? anchor.serviceClass,
    compartment: best.compartment_number ?? null,
    seats: [{ number: best.number!, type: best.type ?? null }],
    // Цену одиночного места схема вагона не возвращает — не выдумываем её.
    price: null,
    fareType: null,
    gender: null,
    cartUrl: null,
  };
}

interface RawBusDetails {
  must_select_seat?: boolean;
  seat_selection?: {
    required?: boolean;
    has_scheme?: boolean;
    available_seat_ids?: string[];
    max_per_purchase?: number;
  };
  seats?: string[];
}

/**
 * Места в автобусе.
 *
 * Схемы салона Туту не отдаёт (`has_scheme: false`) — есть только плоский
 * список свободных номеров. Поэтому «рядом» здесь означает подряд идущие
 * номера: на автобусе нумерация идёт по рядам, и это честный, хотя и не
 * геометрический, признак соседства. Так и написано в примечании к плану,
 * чтобы никто не принял его за схему.
 *
 * Выбор мест у автобуса обязателен (`must_select_seat`), так что подсказка
 * нужна здесь даже больше, чем в поезде.
 */
async function planBusSeating(
  mcp: McpClient,
  detailsRef: Record<string, unknown>,
  party: number,
): Promise<SeatingPlan> {
  const details = await mcp.callToolSafe<RawBusDetails>('get_offer_details', {
    product_type: 'bus',
    details_ref: detailsRef,
    view: 'full',
  });

  if (!details) {
    return empty(party, 'unavailable', 'Туту не ответил на запрос мест в автобусе.');
  }

  const available = details.seat_selection?.available_seat_ids ?? details.seats ?? [];
  if (available.length === 0) {
    return empty(party, 'impossible', 'Свободных мест в этом рейсе Туту не вернул.');
  }
  if (available.length < party) {
    return empty(
      party,
      'impossible',
      `Свободных мест меньше, чем пассажиров: ${available.length} на ${party}.`,
    );
  }

  // Продать за один заказ можно ограниченное число мест, поэтому большая
  // компания в любом случае разбивается на несколько покупок.
  const perPurchase = Math.max(1, details.seat_selection?.max_per_purchase ?? party);
  const runs = consecutiveRuns(available);
  const blocks: SeatBlock[] = [];
  let remaining = party;

  for (const run of runs) {
    if (remaining <= 0) break;
    let offset = 0;
    while (offset < run.length && remaining > 0) {
      const size = Math.min(remaining, perPurchase, run.length - offset);
      blocks.push({
        carNumber: null,
        carType: 'BUS',
        serviceClass: null,
        compartment: null,
        seats: run.slice(offset, offset + size).map((number) => ({ number, type: null })),
        // Цену за конкретное место Туту здесь не возвращает — не выдумываем.
        price: null,
        fareType: null,
        gender: null,
        cartUrl: null,
      });
      offset += size;
      remaining -= size;
    }
  }

  const seated = party - remaining;
  const scheme = ' Схемы салона Туту не отдаёт, поэтому соседство определено по номерам мест.';

  if (remaining > 0) {
    return {
      party, status: 'partial', blocks, seated, largestTogether: null, totalPrice: null,
      note: `Подряд удалось выбрать ${seated} из ${party}.${scheme}`,
    };
  }
  if (blocks.length === 1) {
    return {
      party, status: 'together', blocks, seated, largestTogether: null, totalPrice: null,
      note: `Места ${blocks[0].seats.map((seat) => seat.number).join(', ')} идут подряд.${scheme}`,
    };
  }
  return {
    party, status: 'split', blocks, seated, largestTogether: perPurchase, totalPrice: null,
    note:
      `Подряд одним блоком не выходит: за один заказ продаётся не больше ${perPurchase} мест.` +
      ` Разбито на ${blocks.length}.${scheme}`,
  };
}

/**
 * Группы подряд идущих номеров, длинные первыми.
 *
 * Нечисловые идентификаторы мест встречаются у отдельных перевозчиков — они
 * не отбрасываются, а образуют группы по одному: место есть, соседство просто
 * не доказуемо.
 */
export function consecutiveRuns(seatIds: string[]): string[][] {
  const numeric = seatIds
    .map((id) => ({ id, value: Number.parseInt(id, 10) }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((left, right) => left.value - right.value);

  const runs: string[][] = [];
  let current: Array<{ id: string; value: number }> = [];

  for (const entry of numeric) {
    const previous = current[current.length - 1];
    if (previous && entry.value === previous.value + 1) current.push(entry);
    else {
      if (current.length) runs.push(current.map((item) => item.id));
      current = [entry];
    }
  }
  if (current.length) runs.push(current.map((item) => item.id));

  for (const id of seatIds) {
    if (!Number.isFinite(Number.parseInt(id, 10))) runs.push([id]);
  }

  return runs.sort((left, right) => right.length - left.length);
}

function collect(byCarType: Record<string, RawGroup[]> | undefined): RawGroup[] {
  return Object.values(byCarType ?? {}).flat();
}

/**
 * Самая дешёвая группа, не пересекающаяся с уже занятыми местами.
 *
 * Пересечения возможны, потому что Туту отвечает на каждый запрос независимо
 * и ничего не знает о том, что мы уже отложили для этой же компании.
 */
function pickCheapest(
  groups: RawGroup[],
  taken: Set<string>,
): { block: SeatBlock; keys: string[] } | null {
  let best: { block: SeatBlock; keys: string[]; price: number } | null = null;

  for (const group of groups) {
    const carNumber = group.car_number;
    const numbers = group.seat_numbers ?? [];
    if (!carNumber || numbers.length === 0) continue;

    const keys = numbers.map((seat) => `${carNumber}#${seat}`);
    if (keys.some((key) => taken.has(key))) continue;

    const price = group.total_price?.amount ?? Number.POSITIVE_INFINITY;
    if (best && price >= best.price) continue;

    const byNumber = new Map((group.seats ?? []).map((seat) => [seat.number, seat.type ?? null]));

    best = {
      price,
      keys,
      block: {
        carNumber,
        carType: group.car_type ?? null,
        serviceClass: group.service_class ?? null,
        compartment: group.compartment_number ?? null,
        seats: numbers.map((number) => ({ number, type: byNumber.get(number) ?? null })),
        price: group.total_price?.amount
          ? { amount: group.total_price.amount, currency: group.total_price.currency ?? 'RUB' }
          : null,
        fareType: group.total_fare_type ?? null,
        gender: group.gender ?? null,
        cartUrl: null,
      },
    };
  }

  return best ? { block: best.block, keys: best.keys } : null;
}

function finish(
  party: number,
  blocks: SeatBlock[],
  remaining: number,
  largestTogether: number | null,
  failure: string | null,
): SeatingPlan {
  const seated = party - Math.max(0, remaining);
  const currency = blocks.find((block) => block.price)?.price?.currency ?? 'RUB';
  const amount = blocks.reduce((sum, block) => sum + (block.price?.amount ?? 0), 0);
  const totalPrice = blocks.some((block) => block.price) ? { amount: round2(amount), currency } : null;

  if (failure) {
    return { party, status: 'unavailable', blocks, seated, largestTogether, totalPrice, note: failure };
  }
  if (blocks.length === 0) {
    return {
      party,
      status: 'impossible',
      blocks,
      seated: 0,
      largestTogether,
      totalPrice: null,
      note: 'Туту не вернул ни одной группы свободных мест рядом на этот поезд.',
    };
  }
  const singles = blocks.filter((block) => block.seats.length === 1).length;
  const pricedAll = blocks.every((block) => block.price);

  if (blocks.length === 1 && remaining <= 0) {
    return {
      party,
      status: 'together',
      blocks,
      seated,
      largestTogether,
      totalPrice,
      note: `Вся компания помещается в один отсек: вагон ${blocks[0].carNumber}.`,
    };
  }
  if (remaining <= 0) {
    return {
      party,
      status: 'split',
      blocks,
      seated,
      largestTogether,
      totalPrice,
      note:
        `Целиком рядом не сажается${largestTogether ? ` — в один отсек влезает максимум ${largestTogether}` : ''}. ` +
        `Разбито на ${blocks.length} ${blocks.length < 5 ? 'блока' : 'блоков'}` +
        (singles > 0 ? `, одиночных мест: ${singles}` : '') +
        `.${pricedAll ? '' : ' Цену одиночных мест Туту в схеме вагона не возвращает.'}`,
    };
  }

  // Остаток в одного закрыть нечем: инструмент Туту ищет группы от двух мест.
  return {
    party,
    status: 'partial',
    blocks,
    seated,
    largestTogether,
    totalPrice,
    note: `Рядом удалось посадить ${seated} из ${party}. Оставшимся (${remaining}) место придётся выбрать отдельно: подбор соседних мест работает от двух пассажиров.`,
  };
}

function empty(party: number, status: SeatingStatus, note: string): SeatingPlan {
  return { party, status, blocks: [], seated: 0, largestTogether: null, totalPrice: null, note };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
