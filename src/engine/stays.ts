/**
 * Подбор жилья с живой цитатой из отзыва.
 *
 * Рейтинг «8.4 из 10» — цифра без содержания: она не говорит, что именно
 * понравилось и чего ждать. Дословная фраза постояльца говорит. Правила
 * заземления MCP требуют цитировать, а не пересказывать, и указывать дату —
 * отзыв двухлетней давности и вчерашний стоят разного.
 *
 * Отели ранжируются не по цене: в блоке «где остановиться» организатор
 * рекомендует место гостям, и репутация тут весомее полусотни рублей.
 */

import type { McpClient } from '../mcp/client.ts';

const MIN_REVIEWS = 20;
const CANDIDATES = 12;

export interface StayOption {
  hotelId: string;
  /** Нужен вместе с `hotelId`, чтобы запросить номера этого отеля. */
  hotelGeoId: string | null;
  name: string;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
  price: number | null;
  url: string | null;
  quote: string | null;
  quoteDate: string | null;
}

/**
 * Тариф на номер.
 *
 * Цена в выдаче — это цена самого дешёвого варианта размещения. За ней прячется
 * то, из-за чего люди и выбирают: завтрак и возможность отменить бронь. Пока
 * гость не увидит их рядом, «на две тысячи дешевле» ничего не значит.
 */
export interface StayRate {
  roomName: string;
  price: number | null;
  breakfast: boolean;
  refundable: boolean;
  /** До какой даты отмена бесплатна. */
  freeUntil: string | null;
  /** Корзина Туту с этим номером. `null` — если Туту её не собрал. */
  cartUrl: string | null;
}

interface RawHotel {
  hotel_id?: string;
  hotel_geo_id?: string;
  name?: string;
  address?: string;
  rating?: number;
  review_count?: number;
  best_offer?: { price?: { amount?: number }; checkout_url?: string };
  checkout_ref?: Record<string, unknown>;
}

interface RawRate {
  offerpack_hash?: string;
  price?: { amount?: number };
  breakfast_included?: boolean;
  refundable?: boolean;
  free_cancellation_until?: string;
}

interface RawRoom {
  name?: string;
  room_name?: string;
  rates?: RawRate[];
}

interface RawReviewText {
  sentiment?: string;
  text?: string;
}

interface RawReview {
  created_at?: string;
  texts?: RawReviewText[];
}

/**
 * По какому признаку рекомендовать жильё.
 *
 * У блока «где остановиться» нет единственно верного порядка: на свадьбу зовут
 * в место получше, на сборы секции — подешевле. Выбор остаётся за организатором.
 */
export type StaySort = 'rating' | 'price';

export async function suggestStays(
  mcp: McpClient,
  city: string,
  checkIn: string,
  checkOut: string,
  sort: StaySort = 'rating',
  adults = 2,
): Promise<{ options: StayOption[]; note: string }> {
  const listing = await mcp.callToolSafe<{ hotels?: RawHotel[] }>('search_hotels', {
    city_name: city,
    check_in: checkIn,
    check_out: checkOut,
    adults,
    page_size: CANDIDATES,
  });

  const hotels = listing?.hotels ?? [];
  if (hotels.length === 0) {
    return { options: [], note: `Туту не вернул отелей в городе ${city} на эти даты.` };
  }

  // Рейтингу можно верить только при достаточном числе отзывов; при сортировке
  // по цене этот порог не нужен — там мнение постояльцев не решает.
  const trusted =
    sort === 'rating' ? hotels.filter((hotel) => (hotel.review_count ?? 0) >= MIN_REVIEWS) : hotels;

  const pool = trusted.length > 0 ? trusted : hotels;
  const shortlist = [...pool]
    .sort((left, right) =>
      sort === 'rating'
        ? (right.rating ?? 0) - (left.rating ?? 0)
        : (left.best_offer?.price?.amount ?? Infinity) - (right.best_offer?.price?.amount ?? Infinity),
    )
    .slice(0, 6);

  const options = await Promise.all(
    shortlist.map(async (hotel) => ({
      hotelId: hotel.hotel_id ?? '',
      hotelGeoId: hotel.hotel_geo_id ?? null,
      name: hotel.name ?? 'Отель',
      address: hotel.address ?? null,
      rating: hotel.rating ?? null,
      reviewCount: hotel.review_count ?? null,
      price: hotel.best_offer?.price?.amount ?? null,
      url: hotel.best_offer?.checkout_url ?? null,
      ...(await pickQuote(mcp, hotel, checkIn, checkOut, adults)),
    })),
  );

  return {
    options,
    note:
      sort === 'price'
        ? 'Сначала самые дешёвые на выбранные даты.'
        : trusted.length > 0
          ? `Сначала с высоким рейтингом и хотя бы ${MIN_REVIEWS} отзывами.`
          : 'Отзывов мало — порядок по выдаче Туту, рейтингу тут верить рано.',
  };
}

/** Короткая цитата из свежего отзыва — только то, что человек написал сам. */
async function pickQuote(
  mcp: McpClient,
  hotel: RawHotel,
  checkIn: string,
  checkOut: string,
  adults: number,
): Promise<{ quote: string | null; quoteDate: string | null }> {
  if (!hotel.hotel_id || (hotel.review_count ?? 0) === 0) return { quote: null, quoteDate: null };

  const details = await mcp.callToolSafe<{ hotel?: { reviews?: { reviews?: RawReview[] } } }>(
    'get_offer_details',
    {
      product_type: 'hotels',
      offer_id: hotel.hotel_id,
      check_in: checkIn,
      check_out: checkOut,
      adults,
      view: 'reviews',
      review_limit: 5,
      // Значения жёстко заданы протоколом: 'postedAt' или 'rating'.
      review_sort: 'postedAt',
      review_order: 'desc',
    },
  );

  for (const review of details?.hotel?.reviews?.reviews ?? []) {
    const pros = review.texts?.find((entry) => entry.sentiment === 'pros' && entry.text?.trim());
    if (!pros?.text) continue;

    // Длинные отзывы обрезаем по границе предложения, чтобы цитата осталась
    // цитатой, а не обрубком на середине слова.
    const trimmed = pros.text.trim().replace(/\s+/g, ' ');
    const cut = trimmed.length > 180 ? `${trimmed.slice(0, 177).replace(/[\s,;:—-]+\S*$/, '')}…` : trimmed;

    return { quote: cut, quoteDate: review.created_at?.slice(0, 10) ?? null };
  }

  return { quote: null, quoteDate: null };
}

/**
 * Номера конкретного отеля с готовыми корзинами.
 *
 * Ссылка из выдачи ведёт на страницу отеля, где гость выбирает номер заново.
 * Здесь выбор уже сделан: `offerpack_hash` конкретного тарифа собирает корзину
 * именно с ним. Хеш из выдачи для этого не годится — он возвращает на ту же
 * страницу, поэтому номера запрашиваются отдельно.
 */
export async function listRates(
  mcp: McpClient,
  city: string,
  hotelId: string,
  checkIn: string,
  checkOut: string,
  adults = 2,
): Promise<{ rates: StayRate[]; note: string }> {
  // Ссылка на оформление живёт в выдаче поиска, а не в карточке отеля,
  // поэтому поиск повторяется — зато корзина собирается тем же search_id.
  const listing = await mcp.callToolSafe<{ hotels?: RawHotel[] }>('search_hotels', {
    city_name: city,
    check_in: checkIn,
    check_out: checkOut,
    adults,
    page_size: CANDIDATES,
  });

  const hotel = listing?.hotels?.find((entry) => entry.hotel_id === hotelId);
  if (!hotel) return { rates: [], note: 'Этого отеля сейчас нет в выдаче Туту на выбранные даты.' };

  const details = await mcp.callToolSafe<{ rooms?: RawRoom[] }>('get_offer_details', {
    product_type: 'hotels',
    hotel_id: hotelId,
    hotel_geo_id: hotel.hotel_geo_id,
    check_in: checkIn,
    check_out: checkOut,
    adults,
    view: 'full',
  });

  const rooms = details?.rooms ?? [];
  if (rooms.length === 0) return { rates: [], note: 'Свободных номеров Туту не вернул.' };

  // Один и тот же номер приходит несколькими тарифами, и часть из них
  // отличается только ценой. Более дорогой вариант с теми же условиями —
  // не выбор, а шум, поэтому от каждой комбинации остаётся самый дешёвый.
  const cheapest = new Map<string, { roomName: string; rate: RawRate }>();
  for (const room of rooms) {
    const roomName = room.name ?? room.room_name ?? 'Номер';
    for (const rate of room.rates ?? []) {
      const key = `${roomName}|${rate.breakfast_included === true}|${rate.refundable === true}`;
      const seen = cheapest.get(key);
      if (!seen || (rate.price?.amount ?? Infinity) < (seen.rate.price?.amount ?? Infinity)) {
        cheapest.set(key, { roomName, rate });
      }
    }
  }

  const flat = [...cheapest.values()];

  const rates = await Promise.all(
    flat.slice(0, 12).map(async ({ roomName, rate }) => ({
      roomName,
      price: rate.price?.amount ?? null,
      breakfast: rate.breakfast_included === true,
      refundable: rate.refundable === true,
      freeUntil: rate.free_cancellation_until?.slice(0, 10) ?? null,
      cartUrl: await mintCart(mcp, hotel.checkout_ref, rate.offerpack_hash),
    })),
  );

  rates.sort((left, right) => (left.price ?? Infinity) - (right.price ?? Infinity));

  return { rates, note: `Цена указана за всё проживание, ${checkIn} — ${checkOut}.` };
}

async function mintCart(
  mcp: McpClient,
  checkoutRef: Record<string, unknown> | undefined,
  hash: string | undefined,
): Promise<string | null> {
  if (!checkoutRef || !hash) return null;

  const link = await mcp.callToolSafe<{ kind?: string; checkout_url?: string }>(
    'create_checkout_link',
    { ...checkoutRef, offer_pack_hash: hash },
  );

  // Обычный deeplink — это страница отеля, а не корзина с выбранным номером.
  return link?.kind === 'checkout_deeplink' ? (link.checkout_url ?? null) : null;
}
