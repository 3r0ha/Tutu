/**
 * Типизированные обёртки над инструментами Туту и перевод сырых ответов
 * в доменные типы. Формы payload'ов описаны по фактическим ответам сервера.
 */

import type { McpClient } from './client.ts';
import type { CityRef, Hop, Mode, Money } from '../domain/types.ts';

interface RawMoney {
  amount: number;
  currency: string;
}

interface RawSegment {
  from?: string;
  to?: string;
  departure_at?: string;
  arrival_at?: string;
  carrier?: string;
  vehicle_meta?: { name?: string; is_premium?: boolean; is_double_decker?: boolean };
}

interface RawLeg {
  from?: string;
  to?: string;
  departure_at?: string;
  arrival_at?: string;
  duration_min?: number;
  segments?: RawSegment[];
}

interface RawVariant {
  details_ref?: Record<string, unknown>;
  checkout_ref?: Record<string, unknown>;
  offer_id?: string;
  transport?: string;
  price?: RawMoney;
  duration_min?: number;
  carriers?: string[];
  segments_count?: number;
  search_results_url?: string;
  checkout_url?: string;
  departure_at?: string;
  arrival_at?: string;
  legs?: RawLeg[];
  review_summary?: { rating?: number; review_count?: number; subject?: string; scale?: number };
  fares?: { seat_categories?: Record<string, { count?: number; price_from?: number }> };
}

interface RawCity {
  name?: string;
  geo_id?: string;
  region?: string;
}

interface RawMultitransport {
  variants?: RawVariant[];
  meta?: { from?: RawCity; to?: RawCity };
}

interface RawHotel {
  hotel_id?: string;
  name?: string;
  stars?: number;
  rating?: number;
  address?: string;
  best_offer?: {
    price?: RawMoney;
    room_name?: string;
    checkout_url?: string;
    free_cancellation?: boolean;
  };
}

interface RawHotels {
  hotels?: RawHotel[];
}

const MODES: Record<string, Mode> = {
  avia: 'avia',
  railway: 'railway',
  rail: 'railway',
  bus: 'bus',
  etrain: 'etrain',
};

export interface LegSearch {
  hops: Hop[];
  from: CityRef;
  to: CityRef;
}

/**
 * Поиск прямого сообщения между парой городов.
 *
 * Пустой `hops` — законный результат, а не ошибка: у Туту просто нет прямой
 * связи между этими городами. Именно эта пустота и есть повод для склейки.
 */
export async function searchLeg(
  mcp: McpClient,
  fromCity: string,
  toCity: string,
  date: string,
  options: { adults?: number; pageSize?: number } = {},
): Promise<LegSearch | null> {
  const raw = await mcp.callToolSafe<RawMultitransport>('search_multitransport', {
    origin: fromCity,
    destination: toCity,
    departure_date: date,
    adults: options.adults ?? 1,
    page_size: options.pageSize ?? 20,
    optimize_for: 'price',
  });
  if (!raw) return null;

  const from = toCityRef(raw.meta?.from, fromCity);
  const to = toCityRef(raw.meta?.to, toCity);
  const adults = options.adults ?? 1;
  const hops = (raw.variants ?? [])
    .map((variant) => toHop(variant, from.name, to.name, adults))
    .filter((hop): hop is Hop => hop !== null);

  return { hops, from, to };
}

export interface LodgingOption {
  hotelName: string;
  price: Money;
  checkoutUrl: string | null;
}

/** Самое дешёвое размещение на одну ночь — цена ребра «ночёвка» в графе. */
export async function searchOvernight(
  mcp: McpClient,
  city: string,
  checkIn: string,
  checkOut: string,
  adults = 1,
): Promise<LodgingOption | null> {
  const raw = await mcp.callToolSafe<RawHotels>('search_hotels', {
    city_name: city,
    check_in: checkIn,
    check_out: checkOut,
    adults,
    page_size: 20,
  });
  if (!raw?.hotels?.length) return null;

  const priced = raw.hotels
    .filter((hotel) => typeof hotel.best_offer?.price?.amount === 'number')
    .sort((a, b) => a.best_offer!.price!.amount - b.best_offer!.price!.amount);

  const cheapest = priced[0];
  if (!cheapest) return null;

  return {
    hotelName: cheapest.name ?? 'Отель',
    price: {
      amount: cheapest.best_offer!.price!.amount,
      currency: cheapest.best_offer!.price!.currency ?? 'RUB',
    },
    checkoutUrl: cheapest.best_offer?.checkout_url ?? null,
  };
}

function toCityRef(raw: RawCity | undefined, fallbackName: string): CityRef {
  return {
    name: raw?.name ?? fallbackName,
    geoId: raw?.geo_id ?? null,
    region: raw?.region ?? null,
  };
}

/**
 * Виды транспорта, у которых `price` — это стоимость одного места.
 *
 * Проверено запросами с разным числом пассажиров: цена поезда и электрички
 * не меняется (это `fares.price_from`), цена самолёта и автобуса растёт
 * пропорционально. Плейбук автобуса подтверждает: «Offer prices cover the
 * WHOLE searched party».
 */
const PER_SEAT_MODES = new Set<Mode>(['railway', 'etrain']);

function toHop(variant: RawVariant, fromCity: string, toCity: string, adults: number): Hop | null {
  const mode = MODES[variant.transport ?? ''];
  const departureAt = variant.departure_at;
  const arrivalAt = variant.arrival_at ?? null;
  const amount = variant.price?.amount;

  // Отправление и цена обязательны — без них плечо не встроить и не продать.
  // Прибытие необязательно: рейс Мурманск→Териберка продаётся за 900 ₽ со
  // ссылкой на покупку, но времени прибытия у него нет, и раньше он молча
  // выпадал, превращая живой въезд в «доехать нельзя».
  if (!mode || !departureAt || typeof amount !== 'number') return null;

  const perSeat = PER_SEAT_MODES.has(mode);
  const legs = variant.legs ?? [];
  const firstLeg = legs[0];
  const lastLeg = legs[legs.length - 1];

  return {
    mode,
    fromCity,
    toCity,
    fromPoint: firstLeg?.from ?? fromCity,
    toPoint: lastLeg?.to ?? toCity,
    departureAt,
    arrivalAt,
    durationMin: variant.duration_min || (arrivalAt ? minutesBetween(departureAt, arrivalAt) : null),
    price: {
      amount: perSeat ? round2(amount * adults) : amount,
      currency: variant.price?.currency ?? 'RUB',
    },
    priceBasis: perSeat ? 'per_seat' : 'party',
    pricePerSeat: perSeat ? amount : null,
    carriers: variant.carriers ?? [],
    segmentsCount: variant.segments_count ?? legs.length,
    searchResultsUrl: variant.search_results_url ?? null,
    checkoutUrl: variant.checkout_url ?? null,
    detailsRef: variant.details_ref ?? null,
    checkoutRef: variant.checkout_ref ?? null,
    review: toReview(variant.review_summary),
    vehicle: toVehicle(firstLeg?.segments?.[0]?.vehicle_meta),
    classes: toClasses(variant.fares?.seat_categories),
  };
}

/**
 * Марка состава.
 *
 * Поле приходит не всегда: у обычного поезда его нет вовсе, а у безымянного
 * двухэтажного есть признак без названия. Поэтому пустым считается только то,
 * в чём нет ни того ни другого.
 */
function toVehicle(raw: RawSegment['vehicle_meta']): Hop['vehicle'] {
  if (!raw) return null;
  const name = raw.name?.trim() || null;
  if (!name && !raw.is_double_decker && !raw.is_premium) return null;
  return { name, premium: raw.is_premium === true, doubleDecker: raw.is_double_decker === true };
}

/** Категории мест с ценой «от» — Туту отдаёт их прямо в выдаче, без доп. запроса. */
function toClasses(raw: RawVariant['fares'] extends infer T ? T extends { seat_categories?: infer C } ? C : never : never): Hop['classes'] {
  const entries = Object.entries(raw ?? {})
    .filter(([, value]) => typeof value?.price_from === 'number')
    .map(([code, value]) => ({ code, count: value.count ?? 0, priceFrom: value.price_from! }))
    .sort((left, right) => left.priceFrom - right.priceFrom);
  return entries.length > 0 ? entries : null;
}

/** Рейтинг без числа отзывов ни о чём не говорит, поэтому нужны оба поля. */
function toReview(raw: RawVariant['review_summary']): Hop['review'] {
  if (typeof raw?.rating !== 'number' || typeof raw.review_count !== 'number') return null;
  return {
    rating: raw.rating,
    count: raw.review_count,
    subject: raw.subject ?? null,
    // Шкала бывает разной, и «7.8» без неё читается как 7.8 из 5.
    scale: raw.scale ?? 10,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);
}
