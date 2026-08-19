import type { GuestPlan, Journey, Mode } from '../types.ts';
import { formatMoney, hopKey, usePurchaseLinks } from './JourneyCard.tsx';

const MODE_LABEL: Record<Mode, string> = {
  avia: 'самолёт',
  railway: 'поезд',
  bus: 'автобус',
  etrain: 'электричка',
};

/**
 * Что осталось купить.
 *
 * До ответа гость выбирает: города, даты, варианты, отели. После «еду» выбор
 * сделан, и всё, что помогало выбирать, превращается в помеху — человеку
 * нужен короткий список того, что предстоит оплатить, и ссылки на это.
 *
 * Порядок здесь хронологический, а не по цене: список читают как план поездки,
 * а не как счёт.
 */
export function TicketList({
  guest,
  hasReturn,
  onBack,
}: {
  guest: GuestPlan;
  hasReturn: boolean;
  onBack: () => void;
}) {
  return (
    <section className="invite-card tickets">
      <h2 className="invite-section">Что купить</h2>
      <p className="invite-lead">
        Каждый билет покупается отдельным заказом на Туту: мы ничего не бронируем и не берём оплату.
        {guest.totalPrice && ` Всего по маршруту — ${formatMoney(guest.totalPrice.amount)}.`}
      </p>

      <Leg title="Туда" journey={guest.outbound.best} />
      {hasReturn && <Leg title="Обратно" journey={guest.inbound?.best ?? null} />}

      <button type="button" className="chip" onClick={onBack}>
        Показать приглашение целиком
      </button>
    </section>
  );
}

function Leg({ title, journey }: { title: string; journey: Journey | null }) {
  const purchase = usePurchaseLinks(journey ?? emptyJourney, journey !== null);

  if (!journey) {
    return (
      <div className="ticket-leg">
        <h3 className="ticket-leg-title">{title}</h3>
        {/* Пустоту называем пустотой: билета нет не потому, что мы его не
            нашли, а потому что Туту его не продаёт. */}
        <p className="hint">Билетов на это направление Туту сейчас не продаёт.</p>
      </div>
    );
  }

  return (
    <div className="ticket-leg">
      <h3 className="ticket-leg-title">{title}</h3>

      <ol className="ticket-rows">
        {journey.hops.map((hop, index) => {
          const url = hop.checkoutUrl ?? purchase.get(hopKey(hop)) ?? hop.searchResultsUrl;
          const transfer = journey.transfers[index - 1];

          return (
            <li key={hopKey(hop)}>
              {transfer?.move && (
                // Переезд между вокзалами — не билет, но именно из-за него
                // люди опаздывают. В списке покупок он на своём месте.
                <p className="ticket-move">
                  Между ними: переезд {stationName(transfer.move.from)} →{' '}
                  {stationName(transfer.move.to)}
                </p>
              )}

              <div className="ticket-row">
                <span className="ticket-when">{formatTime(hop.departureAt)}</span>
                <span className="ticket-what">
                  <b>
                    {MODE_LABEL[hop.mode]} {stationName(hop.fromPoint)} → {stationName(hop.toPoint)}
                  </b>
                  <span className="ticket-sub">
                    {hop.carriers.join(', ') || 'перевозчик не указан'} · {formatMoney(hop.price.amount)}
                  </span>
                </span>
                {url ? (
                  <a className="primary ticket-buy" href={url} target="_blank" rel="noreferrer">
                    Купить
                  </a>
                ) : (
                  <span className="hint">ссылки нет</span>
                )}
              </div>
            </li>
          );
        })}

        {journey.transfers.map((transfer) =>
          transfer.overnight?.checkoutUrl ? (
            <li key={`stay-${transfer.departAt}`}>
              <div className="ticket-row">
                <span className="ticket-when">ночь</span>
                <span className="ticket-what">
                  <b>
                    Ночлег в городе {transfer.city}: {transfer.overnight.hotelName}
                  </b>
                  <span className="ticket-sub">{formatMoney(transfer.overnight.price.amount)}</span>
                </span>
                <a
                  className="primary ticket-buy"
                  href={transfer.overnight.checkoutUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Забронировать
                </a>
              </div>
            </li>
          ) : null,
        )}
      </ol>

      {journey.transfers.some((transfer) => transfer.risk.level === 'critical') && (
        <p className="ticket-warn">
          На пересадке нет запасных рейсов в ближайшие сутки: если первый рейс опоздает, поездка
          срывается. Билеты куплены отдельными заказами, и перевозчик не пересадит.
        </p>
      )}
    </div>
  );
}

/** Хук нельзя вызывать условно, а маршрута может не быть. */
const emptyJourney = {
  id: '',
  kind: 'direct',
  hops: [],
  transfers: [],
  via: [],
  departureAt: '',
  arrivalAt: null,
  totalDurationMin: null,
  ticketsPrice: { amount: 0, currency: 'RUB' },
  lodgingPrice: null,
  totalPrice: { amount: 0, currency: 'RUB' },
  risk: 'safe',
} as unknown as Journey;

/**
 * Название станции без служебного кода.
 *
 * Туту отдаёт точку самоописывающейся строкой — «Москва — Ярославский вокзал
 * (2000002)». Вокзал назвать обязательно: в Москве их девять, и перепутать их
 * стоит поездки. А код в скобках человеку не говорит ничего и только мешает
 * прочитать строку целиком.
 */
export function stationName(point: string): string {
  return point
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/,\s*\d+\s*$/, '')
    .trim();
}

function formatTime(iso: string): string {
  const [date, time] = iso.split('T');
  const [, month, day] = date.split('-');
  return `${day}.${month} ${time.slice(0, 5)}`;
}
