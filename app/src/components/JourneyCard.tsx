import { useEffect, useState } from 'react';
import type { Hop, Journey, Mode, RiskLevel } from '../types.ts';
import { stationName } from './TicketList.tsx';

const MODE_LABEL: Record<Mode, string> = {
  avia: 'самолёт',
  railway: 'поезд',
  bus: 'автобус',
  etrain: 'электричка',
};

const RISK_LABEL: Record<RiskLevel, string> = {
  safe: 'Пересадка с запасом',
  tight: 'Пересадка впритык',
  critical: 'Опоздание срывает поездку',
};

/**
 * Маршрут как вертикальная лента времени.
 *
 * Список билетов показывает, что человек купил. Лента показывает, что с ним
 * произойдёт: где он едет, где ждёт и где ночует. Разрывы между переездами
 * такой же полноправный элемент, как сами переезды, — именно в них поездка
 * и ломается.
 */
export function JourneyCard({ journey, chosen }: { journey: Journey; chosen?: boolean }) {
  const purchase = usePurchaseLinks(journey, chosen === true);

  return (
    <article className={`option${chosen ? ' chosen' : ''}`}>
      <header className="option-head">
        <span className="option-price">{formatMoney(journey.totalPrice.amount)}</span>
        <span className="option-meta">
          {journey.totalDurationMin === null ? 'время в пути неизвестно' : formatDuration(journey.totalDurationMin)}
          {journey.via.length > 0 ? ` · через ${journey.via.join(', ')}` : ' · без пересадок'}
        </span>
      </header>

      {journey.lodgingPrice && (
        <p className="option-note">
          В сумму входит ночь в пути — {formatMoney(journey.lodgingPrice.amount)}
        </p>
      )}

      <div className="ribbon">
        {journey.hops.map((hop, index) => {
          const transfer = journey.transfers[index - 1];
          return (
            <div key={`${hop.departureAt}-${hop.mode}`}>
              {transfer && (
                <div className={`gap${transfer.overnight ? ' night' : ''}`}>
                  {transfer.overnight ? (
                    <>
                      Ночь в городе {transfer.city}: {transfer.overnight.hotelName} —{' '}
                      {formatMoney(transfer.overnight.price.amount)}
                      <div className="gap-sub">Ожидание {formatDuration(transfer.waitMin)}</div>
                    </>
                  ) : (
                    <>Пересадка в городе {transfer.city} — {formatDuration(transfer.waitMin)}</>
                  )}
                  {/* Пересадка внутри одного вокзала и переезд через весь город
                      выглядят в выдаче одинаково — пока не назвать обе точки. */}
                  {transfer.move && (
                    <div className="gap-sub move">
                      Смена вокзала: {stationName(transfer.move.from)} →{' '}
                      {stationName(transfer.move.to)}
                    </div>
                  )}
                </div>
              )}

              <div className="seg">
                <div className="seg-time">
                  {formatTime(hop.departureAt)}
                  {hop.arrivalAt ? ` → ${formatTime(hop.arrivalAt)}` : ''}
                </div>
                <div className="seg-body">
                  <span className="seg-mode">{MODE_LABEL[hop.mode]}</span>
                  {/* «Ласточка» или двухэтажный — это про то, как поедешь,
                      а не про то, кто везёт: перевозчик у них один и тот же. */}
                  {hop.vehicle && <span className="seg-brand">{vehicleLabel(hop.vehicle)}</span>}
                  {stationName(hop.fromPoint)} → {stationName(hop.toPoint)}
                  <div className="seg-sub">
                    {hop.carriers.join(', ') || 'перевозчик не указан'} ·{' '}
                    {formatMoney(hop.price.amount)}
                    {/* У поезда Туту отдаёт цену одного места, а не всей
                        компании. Показать только произведение — значит выдать
                        оценку за счёт; показываем, из чего оно получилось. */}
                    {/* Снимки, снятые до появления поля, его не содержат —
                        и `undefined !== null` тихо ломало бы деление. */}
                    {typeof hop.pricePerSeat === 'number' &&
                      hop.pricePerSeat > 0 &&
                      hop.price.amount !== hop.pricePerSeat && (
                        <span className="seg-permile">
                          {' '}
                          (от {formatMoney(hop.pricePerSeat)} ×{' '}
                          {Math.round(hop.price.amount / hop.pricePerSeat)})
                        </span>
                      )}
                    {/* Пустое поле называем пустым: у части рейсов в малые
                        города Туту времени прибытия не возвращает. */}
                    {!hop.arrivalAt && ' · время прибытия Туту не вернул'}
                    {/* Два поезда на дату часто стоят одинаково — тогда
                        выбирают по тому, как о них отзываются. */}
                    {hop.review && (
                      <span className={`seg-rating ${ratingTone(hop.review)}`}>
                        {hop.review.rating.toFixed(1)}/{hop.review.scale} ·{' '}
                        {hop.review.count.toLocaleString('ru-RU')}{' '}
                        {pluralReviews(hop.review.count)}
                      </span>
                    )}
                  </div>
                  {/* Цена рейса — это цена самого дешёвого места. Человеку,
                      которому нужно купе, она не отвечает ни на что. */}
                  {hop.classes && hop.classes.length > 1 && (
                    <div className="seg-classes">
                      {hop.classes.map((entry) => (
                        <span key={entry.code}>
                          {CLASS_LABEL[entry.code] ?? entry.code.toLowerCase()} от{' '}
                          {formatMoney(entry.priceFrom)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {journey.transfers.map((transfer) => (
        <div key={`risk-${transfer.departAt}`} className={`risk ${transfer.risk.level}`}>
          <strong>{RISK_LABEL[transfer.risk.level]}.</strong> {transfer.risk.note}
          <div className="risk-sub">
            Билеты куплены отдельными заказами: при опоздании перевозчик не пересадит.
          </div>
        </div>
      ))}

      <div className="buy-row">
        {journey.hops.map((hop, index) => {
          // Собранная ссылка ведёт на сам билет; адрес выдачи — на список,
          // где его ещё надо найти. Поэтому порядок именно такой.
          const url = hop.checkoutUrl ?? purchase.get(hopKey(hop)) ?? hop.searchResultsUrl;
          if (!url) return null;
          return (
            <a key={url} className="buy" href={url} target="_blank" rel="noreferrer">
              {/* «Плечо» — наше внутреннее слово; человеку нужен билет. */}
              Билет {index + 1}: {MODE_LABEL[hop.mode]} {hop.fromCity} → {hop.toCity}
            </a>
          );
        })}
        {journey.transfers.map((transfer) =>
          transfer.overnight?.checkoutUrl ? (
            <a
              key={transfer.overnight.checkoutUrl}
              className="buy"
              href={transfer.overnight.checkoutUrl}
              target="_blank"
              rel="noreferrer"
            >
              Отель на ночь в городе {transfer.city}
            </a>
          ) : null,
        )}
      </div>
    </article>
  );
}

export function hopKey(hop: Hop): string {
  return `${hop.mode}|${hop.departureAt}|${hop.fromPoint}`;
}

/**
 * Ссылки на покупку для плеч, у которых их нет в выдаче.
 *
 * Туту не отдаёт `checkout_url` у авиаварианта — его собирает отдельный вызов,
 * и делать его для каждого кандидата во время расчёта было бы расточительно.
 * Здесь он делается только для показанного маршрута и только один раз.
 */
export function usePurchaseLinks(journey: Journey, active: boolean): Map<string, string> {
  const [links, setLinks] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!active) return;

    const pending = journey.hops.filter((hop) => !hop.checkoutUrl && hop.checkoutRef);
    if (pending.length === 0) return;

    let cancelled = false;

    void Promise.all(
      pending.map(async (hop) => {
        try {
          const response = await fetch('/api/purchase', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ checkoutRef: hop.checkoutRef }),
          });
          if (!response.ok) return null;
          const data = (await response.json()) as { url: string | null };
          return data.url ? ([hopKey(hop), data.url] as const) : null;
        } catch {
          // Не собралась — остаётся адрес выдачи. Это хуже, но не пусто.
          return null;
        }
      }),
    ).then((resolved) => {
      if (cancelled) return;
      const found = resolved.filter((entry): entry is readonly [string, string] => entry !== null);
      if (found.length > 0) setLinks(new Map(found));
    });

    return () => {
      cancelled = true;
    };
  }, [journey, active]);

  return links;
}

/**
 * Цвет оценки.
 *
 * Пороги заданы долей от шкалы, а не абсолютным числом: Туту возвращает
 * рейтинг и по десятибалльной, и по другим шкалам, и «7.5» в них значит разное.
 * Десяток отзывов мало для вывода, поэтому такая оценка остаётся нейтральной.
 */
function ratingTone(review: { rating: number; count: number; scale: number }): string {
  if (review.count < 20) return 'thin';
  const share = review.rating / review.scale;
  if (share >= 0.78) return 'good';
  return share < 0.6 ? 'poor' : 'fair';
}

function pluralReviews(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return 'отзывов';
  switch (count % 10) {
    case 1: return 'отзыв';
    case 2:
    case 3:
    case 4: return 'отзыва';
    default: return 'отзывов';
  }
}

/** Коды классов Туту — это верхний регистр латиницей, в выдаче он нечитаем. */
const CLASS_LABEL: Record<string, string> = {
  SEDENTARY: 'сидячий',
  RESERVED_SEAT: 'плацкарт',
  COMPARTMENT: 'купе',
  LUX: 'СВ',
  SOFT: 'мягкий',
  SHARED: 'общий',
};

function vehicleLabel(vehicle: { name: string | null; premium: boolean; doubleDecker: boolean }): string {
  // У безымянного двухэтажного признак есть, а названия нет — и промолчать
  // о нём значило бы скрыть ровно то, что отличает его от соседнего поезда.
  const parts = [vehicle.name, vehicle.doubleDecker && !vehicle.name?.includes('двухэтаж') ? 'двухэтажный' : null];
  return parts.filter(Boolean).join(' · ') || 'фирменный';
}

export function formatMoney(amount: number): string {
  return `${Math.round(amount).toLocaleString('ru-RU')} ₽`;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} мин`;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

/**
 * Показываем местное время точки, а не время зрителя.
 *
 * Туту отдаёт время отправления со смещением этого места. Пересчёт в часовой
 * пояс браузера означал бы, что гость из Владивостока увидит московский поезд
 * уходящим в другой час, чем написано на билете.
 */
function formatTime(iso: string): string {
  const [date, time] = iso.split('T');
  const [, month, day] = date.split('-');
  return `${day}.${month} ${time.slice(0, 5)}`;
}
