import { useState } from 'react';
import type { StayBlock } from '../blocks.ts';

interface StayRate {
  roomName: string;
  price: number | null;
  breakfast: boolean;
  refundable: boolean;
  freeUntil: string | null;
  cartUrl: string | null;
}

interface StayOption {
  hotelId: string;
  hotelGeoId?: string | null;
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
 * Где остановиться.
 *
 * Организатор **рекомендует**, но не решает: у гостя свой бюджет и свои
 * требования. Поэтому рядом с рекомендацией всегда лежит живой список
 * альтернатив, и порядок в нём гость меняет сам — по отзывам или по цене.
 *
 * Список запрашивается в момент нажатия, а не берётся из сохранённого:
 * номера заканчиваются, цены меняются, а покупают жильё не в день рассылки.
 */
export function StaySection({
  block,
  city,
  checkIn,
  checkOut,
  adults,
}: {
  block: StayBlock;
  city: string;
  checkIn: string;
  checkOut: string | null;
  /** Сколько человек селится — номер на двоих и на одного стоят разного. */
  adults: number;
}) {
  const [options, setOptions] = useState<StayOption[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sort, setSort] = useState<'rating' | 'price'>(block.sort ?? 'rating');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (nextSort: 'rating' | 'price') => {
    setSort(nextSort);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/stays', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ city, checkIn, checkOut: checkOut ?? checkIn, sort: nextSort, adults }),
      });
      if (!response.ok) throw new Error('Не удалось загрузить варианты');
      const data = (await response.json()) as { options: StayOption[]; note: string };
      setOptions(data.options);
      setNote(data.note);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить варианты');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="invite-card">
      <h2 className="invite-section">{block.heading || 'Где остановиться'}</h2>

      {block.hotelName && (
        <div className="stay-pick">
          <span className="stay-badge">Рекомендует организатор</span>
          <StayCard
            city={city}
            checkIn={checkIn}
            checkOut={checkOut ?? checkIn}
            adults={adults}
            option={{
              hotelId: block.hotelId ?? '',
              name: block.hotelName,
              address: block.address,
              rating: block.rating,
              reviewCount: block.reviewCount,
              price: block.price,
              url: block.url,
              quote: block.quote,
              quoteDate: block.quoteDate,
            }}
          />
        </div>
      )}

      <div className="stay-actions">
        <button type="button" className="ghost" onClick={() => load(sort)} disabled={busy}>
          {/* «Другие» — только когда есть с чем сравнивать: без рекомендации
              организатора это первый и единственный список. */}
          {busy
            ? 'Ищем…'
            : options
              ? 'Обновить список'
              : block.hotelName
                ? 'Показать другие варианты'
                : 'Показать варианты жилья'}
        </button>
        {options && (
          <div className="stay-sort">
            <button
              type="button"
              className={`chip${sort === 'rating' ? ' active' : ''}`}
              onClick={() => load('rating')}
              disabled={busy}
            >
              по отзывам
            </button>
            <button
              type="button"
              className={`chip${sort === 'price' ? ' active' : ''}`}
              onClick={() => load('price')}
              disabled={busy}
            >
              подешевле
            </button>
          </div>
        )}
      </div>

      {error && <p className="hint error">{error}</p>}

      {options && (
        <>
          {options.map((option) => (
            <StayCard
              key={option.hotelId || option.name}
              option={option}
              city={city}
              checkIn={checkIn}
              checkOut={checkOut ?? checkIn}
              adults={adults}
            />
          ))}
          <p className="invite-foot">
            {note} Цены на {formatRange(checkIn, checkOut)} и меняются — список загружен только что.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Карточка отеля.
 *
 * Номера раскрываются по требованию, а не грузятся заранее: каждый отель — это
 * отдельный запрос к Туту, и делать шесть таких ради списка, в который гость,
 * возможно, и не заглянет, незачем.
 */
function StayCard({
  option,
  city,
  checkIn,
  checkOut,
  adults,
}: {
  option: StayOption;
  city: string;
  checkIn: string;
  checkOut: string;
  adults: number;
}) {
  const [rates, setRates] = useState<StayRate[] | null>(null);
  const [ratesNote, setRatesNote] = useState<string | null>(null);
  const [ratesBusy, setRatesBusy] = useState(false);
  const [ratesError, setRatesError] = useState<string | null>(null);

  const loadRates = async () => {
    setRatesBusy(true);
    setRatesError(null);
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ city, hotelId: option.hotelId, checkIn, checkOut, adults }),
      });
      if (!response.ok) throw new Error('Не удалось загрузить номера');
      const data = (await response.json()) as { rates: StayRate[]; note: string };
      setRates(data.rates);
      setRatesNote(data.note);
    } catch (cause) {
      setRatesError(cause instanceof Error ? cause.message : 'Не удалось загрузить номера');
    } finally {
      setRatesBusy(false);
    }
  };

  return (
    <article className="stay-card">
      <header className="stay-head">
        <span className="stay-name">{option.name}</span>
        {option.price !== null && (
          <span className="stay-price">{Math.round(option.price).toLocaleString('ru-RU')} ₽</span>
        )}
      </header>

      <p className="stay-meta">
        {option.rating !== null
          ? `⭐ ${option.rating} · ${option.reviewCount ?? 0} отзывов`
          : 'Туту не вернул рейтинг'}
        {option.address && ` · ${option.address}`}
      </p>

      {/* Цитата дословная и с датой: пересказ отзыва запрещён правилами MCP,
          да и доверия к нему меньше. */}
      {option.quote && (
        <blockquote className="stay-quote">
          «{option.quote}»<cite>{option.quoteDate}</cite>
        </blockquote>
      )}

      <div className="stay-actions">
        {option.hotelId && (
          <button type="button" className="chip" onClick={() => void loadRates()} disabled={ratesBusy}>
            {ratesBusy ? 'Смотрим номера…' : rates ? 'Обновить номера' : 'Выбрать номер'}
          </button>
        )}
        {option.url && (
          <a className="buy" href={option.url} target="_blank" rel="noreferrer">
            Страница отеля
          </a>
        )}
      </div>

      {ratesError && <p className="hint error">{ratesError}</p>}

      {rates && (
        <div className="rates">
          {rates.length === 0 ? (
            <p className="hint">{ratesNote}</p>
          ) : (
            <>
              {rates.map((rate, index) => (
                <div key={`${rate.roomName}-${index}`} className="rate">
                  <span className="rate-name">{rate.roomName}</span>
                  <span className="rate-tags">
                    {/* Завтрак и отмена — то, из-за чего выбирают между
                        соседними ценами; без них разница в тысячу непонятна. */}
                    {rate.breakfast && <i className="yes">завтрак</i>}
                    {rate.refundable ? (
                      <i className="yes">
                        отмена{rate.freeUntil ? ` до ${formatRange(rate.freeUntil, null)}` : ''}
                      </i>
                    ) : (
                      <i className="no">без отмены</i>
                    )}
                  </span>
                  <span className="rate-price">
                    {rate.price === null ? '—' : `${Math.round(rate.price).toLocaleString('ru-RU')} ₽`}
                  </span>
                  {rate.cartUrl ? (
                    <a className="rate-cart" href={rate.cartUrl} target="_blank" rel="noreferrer">
                      В корзину →
                    </a>
                  ) : (
                    <span className="rate-cart empty">корзину Туту не собрал</span>
                  )}
                </div>
              ))}
              <p className="invite-foot">{ratesNote}</p>
            </>
          )}
        </div>
      )}
    </article>
  );
}

function formatRange(checkIn: string, checkOut: string | null): string {
  const short = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  return checkOut ? `${short(checkIn)} — ${short(checkOut)}` : short(checkIn);
}
