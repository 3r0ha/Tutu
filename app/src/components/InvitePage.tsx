import { useEffect, useMemo, useState } from 'react';
import { fetchInvite, fetchInviteRoute } from '../api.ts';
import type { GuestPlan, Invite } from '../types.ts';
import { isBlockEmpty, type Block } from '../blocks.ts';
import { JourneyCard, formatMoney } from './JourneyCard.tsx';
import { RsvpForm } from './RsvpForm.tsx';
import { StaySection } from './StaySection.tsx';
import { TicketList } from './TicketList.tsx';
import { themeProps } from '../theme.ts';

/**
 * Приглашение глазами гостя.
 *
 * Страница собрана из блоков, которые расставил организатор, — поэтому здесь
 * нет жёсткого порядка секций, только их отрисовка.
 *
 * Маршруты приезжают вместе с приглашением уже посчитанными, но остаются
 * обновляемыми: билеты покупают не в день рассылки, места заканчиваются, цены
 * меняются. Отметка свежести стоит рядом с кнопкой обновления, чтобы человек
 * понимал, насколько данным можно верить прямо сейчас.
 */
export function InvitePage({ id, slug }: { id: string; slug?: string }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [chosen, setChosen] = useState<GuestPlan | null>(null);
  const [chosenName, setChosenName] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [earlier, setEarlier] = useState(0);
  const [later, setLater] = useState(0);
  /** Сколько человек едет по этому приглашению — билеты часто берут на пару или семью. */
  const [party, setParty] = useState(1);
  /**
   * На сколько человек посчитана та цена, что сейчас на экране.
   *
   * Отличается от `party`, пока идёт пересчёт. Подписывать старую цену новым
   * числом людей нельзя: это ровно то враньё, от которого продукт отказывается
   * везде остальном.
   */
  const [pricedFor, setPricedFor] = useState(1);
  /** Когда маршрут получен: из приглашения или обновлён вживую. */
  const [freshAt, setFreshAt] = useState<string | null>(null);
  /**
   * Ответ гостя.
   *
   * До ответа страница помогает выбирать, после — мешает: выбор сделан, и
   * города, даты и альтернативы превращаются в шум поверх того единственного,
   * что человеку ещё нужно, — списка билетов.
   */
  const [going, setGoing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchInvite(id)
      .then((loaded) => {
        setInvite(loaded);
        setFreshAt(loaded.computedAt);
        if (!slug) return;

        // Персональная ссылка открывает сразу свой маршрут.
        const guest = loaded.guests.find((entry) => entry.slug === slug);
        if (!guest) return;
        const route = loaded.routes.find(
          (entry) => entry.city.toLowerCase() === guest.city.toLowerCase(),
        );
        if (route) {
          setChosen(route.plan);
          setChosenName(guest.name);
        }
      })
      .catch((cause: unknown) =>
        setLoadError(cause instanceof Error ? cause.message : 'Приглашение не найдено'),
      );
  }, [id, slug]);

  const cities = useMemo(() => {
    const seen = new Set<string>();
    return (invite?.routes ?? []).filter((route) => {
      const key = route.city.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [invite]);

  const computeRoute = async (
    city: string,
    arriveEarlier = earlier,
    departLater = later,
    adults = party,
  ) => {
    if (!city.trim()) return;
    setBusy(true);
    setRouteError(null);
    try {
      const result = await fetchInviteRoute(id, {
        city: city.trim(),
        adults,
        arriveEarlier,
        departLater,
      });
      setChosen(result.plan.guests[0] ?? null);
      setPricedFor(adults);
      setFreshAt(new Date().toISOString());
    } catch (cause) {
      setRouteError(cause instanceof Error ? cause.message : 'Не удалось построить маршрут');
    } finally {
      setBusy(false);
    }
  };

  const applyShift = (nextEarlier: number, nextLater: number) => {
    setEarlier(nextEarlier);
    setLater(nextLater);
    const city = chosen?.city ?? other;
    if (city) void computeRoute(city, nextEarlier, nextLater);
  };

  /**
   * Сколько человек едет по этому приглашению.
   *
   * Билеты часто покупает один за всех — пару, семью, компанию друзей.
   * Число здесь не косметическое: Туту ищет места на всех сразу, цена
   * возвращается за всю компанию, а ссылка на покупку открывает корзину
   * на то же число пассажиров. Поэтому маршрут пересчитывается.
   */
  const applyParty = (next: number) => {
    setParty(next);
    const city = chosen?.city ?? other;
    if (city) void computeRoute(city, earlier, later, next);
  };

  if (loadError) {
    return (
      <div className="invite">
        <div className="invite-card">
          <h1 className="invite-title">Приглашение не найдено</h1>
          <p className="invite-lead">Возможно, ссылка устарела или в ней опечатка.</p>
        </div>
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="invite">
        <div className="invite-card">
          <div className="pulse" />
        </div>
      </div>
    );
  }

  const blocks: Block[] = invite.blocks?.length ? invite.blocks : [];
  const hasReturn = invite.returnDate !== null;
  const theme = themeProps(invite.theme?.palette, invite.theme?.ink);

  // Обложка остаётся всегда: без неё непонятно, к чему относится список.
  const cover = blocks.find((block) => block.kind === 'cover');

  if (going && !expanded && chosen) {
    return (
      <div className={`invite ${theme.className}`} style={theme.style}>
        {cover?.kind === 'cover' && (
          <article className="invite-card invite-hero compact">
            <div className="invite-cover">{cover.cover || invite.theme?.cover || '✨'}</div>
            <p className="invite-kicker">Вы едете</p>
            <h1 className="invite-title">{cover.title || invite.title}</h1>
            <p className="invite-greeting">
              {invite.destination}, {formatDate(invite.date)}
              {invite.returnDate && ` — ${formatDate(invite.returnDate)}`}
            </p>
          </article>
        )}

        <TicketList guest={chosen} hasReturn={hasReturn} onBack={() => setExpanded(true)} />

        {/* Жильё — тоже покупка, и после ответа она остаётся единственной
            нерешённой. Блок берётся тот же, что настроил организатор. */}
        {blocks.map((block) =>
          block.kind === 'stay' ? (
            <StaySection
              key={block.id}
              adults={party}
              block={block}
              city={invite.destination}
              checkIn={invite.date}
              checkOut={invite.returnDate}
            />
          ) : null,
        )}

        <p className="invite-foot">
          Ответ ушёл организатору вместе с маршрутом и суммой.{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              setGoing(false);
              setExpanded(true);
            }}
          >
            Изменить ответ
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className={`invite ${theme.className}`} style={theme.style}>
      {blocks.filter((block) => !isBlockEmpty(block)).map((block) => {
        switch (block.kind) {
          case 'cover':
            return (
              <article key={block.id} className="invite-card invite-hero">
                <div className="invite-cover">{block.cover || invite.theme?.cover || '✨'}</div>
                <p className="invite-kicker">Приглашение</p>
                <h1 className="invite-title">{block.title || invite.title}</h1>
                <dl className="invite-facts">
                  <div>
                    <dt>Где</dt>
                    <dd>
                      {invite.destination}
                      {invite.venue && <span className="invite-venue">{invite.venue}</span>}
                    </dd>
                  </div>
                  <div>
                    <dt>Когда</dt>
                    <dd>
                      {formatDate(invite.date)}
                      {invite.returnDate && (
                        <span className="invite-venue">по {formatDate(invite.returnDate)}</span>
                      )}
                    </dd>
                  </div>
                </dl>
                {block.subtitle && <p className="invite-greeting">{block.subtitle}</p>}
              </article>
            );

          case 'image':
            return (
              <figure key={block.id} className="invite-card image-block">
                <img className="invite-image" src={block.src} alt={block.caption || 'Иллюстрация'} />
                {block.caption && <figcaption className="image-caption">{block.caption}</figcaption>}
              </figure>
            );

          case 'text':
          case 'contacts':
            return (
              <section key={block.id} className="invite-card">
                {block.heading && <h2 className="invite-section">{block.heading}</h2>}
                {block.body && <p className="invite-body">{block.body}</p>}
              </section>
            );

          case 'schedule':
            return (
              <section key={block.id} className="invite-card">
                <h2 className="invite-section">{block.heading || 'Программа'}</h2>
                <ul className="schedule">
                  {/* Недописанные строки в программе гостю не нужны. */}
                  {block.items.filter((item) => item.time.trim() || item.text.trim()).map((item, index) => (
                    <li key={`${item.time}-${index}`}>
                      <span className="schedule-time">{item.time}</span>
                      <span className="schedule-text">{item.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );

          case 'stay':
            return (
              <StaySection
                key={block.id}
                adults={party}
                block={block}
                city={invite.destination}
                checkIn={invite.date}
                checkOut={invite.returnDate}
              />
            );

          case 'route':
            return (
              <section key={block.id} className="invite-card">
                <h2 className="invite-section">{block.heading || 'Откуда вы поедете?'}</h2>
                {block.lead && <p className="invite-lead">{block.lead}</p>}

                <div className="city-picker">
                  {cities.map((route) => {
                    const guest = route.plan;
                    const active = chosen?.city === route.city;
                    return (
                      <button
                        key={route.city}
                        type="button"
                        className={`city-option${active ? ' active' : ''}`}
                        aria-pressed={active}
                        onClick={() => {
                          setChosen(guest);
                          setPricedFor(1);
                          setParty(1);
                          setChosenName('');
                          setEarlier(0);
                          setLater(0);
                          setFreshAt(invite.computedAt);
                          setRouteError(null);
                        }}
                      >
                        <span className="city-name">{route.city}</span>
                        <span className="city-price">
                          {guest.totalPrice ? formatMoney(guest.totalPrice.amount) : 'нет маршрута'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <details className="other-city">
                  <summary className="link">Моего города нет в списке</summary>
                  <div className="invite-form">
                    <input
                      value={other}
                      placeholder="Например, Тула"
                      onChange={(event) => setOther(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && computeRoute(other)}
                      aria-label="Город выезда"
                    />
                    <button
                      type="button"
                      className="primary"
                      onClick={() => computeRoute(other)}
                      disabled={busy || !other.trim()}
                    >
                      {busy ? 'Считаем…' : 'Построить'}
                    </button>
                  </div>
                </details>

                {routeError && <p className="hint error">{routeError}</p>}

                {chosen && (
                  <>
                    <div className="shift-controls">
                      <PartyPicker value={party} disabled={busy} onChange={applyParty} />
                      <ShiftPicker
                        label="Приехать раньше"
                        value={earlier}
                        disabled={busy}
                        onChange={(value) => applyShift(value, later)}
                      />
                      {hasReturn && (
                        <ShiftPicker
                          label="Уехать позже"
                          value={later}
                          disabled={busy}
                          onChange={(value) => applyShift(earlier, value)}
                        />
                      )}
                    </div>

                    <FreshnessBar
                      at={freshAt}
                      busy={busy}
                      onRefresh={() => computeRoute(chosen.city, earlier, later)}
                    />

                    <GuestRoute
                      guest={chosen}
                      hasReturn={hasReturn}
                      party={pricedFor}
                      stale={busy || pricedFor !== party}
                    />
                  </>
                )}
              </section>
            );

          case 'rsvp':
            if (!chosen) return null;
            return (
              <section key={block.id} className="invite-card">
                <RsvpForm
                  inviteId={id}
                  guest={chosen}
                  travellers={party}
                  presetName={chosenName}
                  heading={block.heading}
                  lead={block.lead}
                  onAnswered={(attending) => {
                    setGoing(attending === true);
                    if (attending === true) setExpanded(false);
                  }}
                />
              </section>
            );

          default:
            return null;
        }
      })}

      <p className="invite-foot">
        Цены и расписания приходят от Туту и живут своей жизнью: билеты
        заканчиваются, появляются новые. Кнопка «обновить» перепроверяет всё заново. Плечи маршрута
        с пересадкой покупаются отдельными заказами — это самостоятельная пересадка без гарантий
        перевозчика.
      </p>
    </div>
  );
}

/**
 * Свежесть данных.
 *
 * Покупают не в день рассылки: между приглашением и покупкой проходят дни,
 * за которые места заканчиваются, а цены меняются. Отметка стоит рядом
 * с кнопкой, чтобы человек видел, насколько цифрам можно верить.
 */
function FreshnessBar({
  at,
  busy,
  onRefresh,
}: {
  at: string | null;
  busy: boolean;
  onRefresh: () => void;
}) {
  const age = at ? Date.now() - Date.parse(at) : null;
  const stale = age !== null && age > 12 * 3_600_000;

  return (
    <div className={`freshness${stale ? ' stale' : ''}`}>
      <span>
        {at ? `Данные получены ${formatWhen(at)}` : 'Свежесть данных неизвестна'}
        {stale && ' — стоит перепроверить'}
      </span>
      <button type="button" className="ghost" onClick={onRefresh} disabled={busy}>
        {busy ? 'Проверяем…' : 'Обновить'}
      </button>
    </div>
  );
}

/**
 * Сколько человек едет.
 *
 * Ограничение в девять — не наше: столько пассажиров Туту продаёт одним
 * заказом. Больше — это уже несколько покупок, и обещать их одной кнопкой
 * нельзя.
 */
function PartyPicker({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="shift-picker">
      <span className="label">Сколько вас едет</span>
      <div className="shift-options">
        {[1, 2, 3, 4, 5].map((people) => (
          <button
            key={people}
            type="button"
            className={`chip${value === people ? ' active' : ''}`}
            disabled={disabled}
            aria-pressed={value === people}
            onClick={() => onChange(people)}
          >
            {people === 1 ? 'один' : people}
          </button>
        ))}
        <label className={`chip more${value > 5 ? ' active' : ''}`}>
          ещё
          <input
            type="number"
            min={6}
            max={9}
            value={value > 5 ? value : ''}
            disabled={disabled}
            aria-label="Сколько человек едет"
            onChange={(event) => {
              const parsed = Number(event.target.value);
              if (Number.isFinite(parsed) && parsed >= 6 && parsed <= 9) onChange(parsed);
            }}
          />
        </label>
      </div>
    </div>
  );
}

function ShiftPicker({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="shift-picker">
      <span className="label">{label}</span>
      <div className="shift-options">
        {[0, 1, 2, 3].map((days) => (
          <button
            key={days}
            type="button"
            className={`chip${value === days ? ' active' : ''}`}
            disabled={disabled}
            aria-pressed={value === days}
            onClick={() => onChange(days)}
          >
            {days === 0 ? 'день в день' : `на ${days} дн.`}
          </button>
        ))}
      </div>
    </div>
  );
}

function GuestRoute({
  guest,
  hasReturn,
  party,
  stale,
}: {
  guest: GuestPlan;
  hasReturn: boolean;
  party: number;
  /** Идёт пересчёт: то, что на экране, относится к прошлому запросу. */
  stale?: boolean;
}) {
  // Обратная дата запрошена, но рейсов не нашлось: сумма покрывает только
  // дорогу туда, и подписать её «в оба конца» значило бы соврать.
  const roundTrip = hasReturn && guest.inbound?.best != null;

  return (
    <>
      {guest.totalPrice && (
        <p className={`route-total${stale ? ' stale' : ''}`}>
          <span className="route-total-value">{formatMoney(guest.totalPrice.amount)}</span>
          <span className="route-total-label">
            {roundTrip
              ? `дорога туда и обратно из города ${guest.city}`
              : `только дорога туда из города ${guest.city}${hasReturn ? ' — обратных рейсов не нашлось' : ''}`}
            {/* Туту ищет места сразу на всех, и цена приходит за компанию.
                Без этой подписи её прочитают как цену за одного. */}
            {/* На поезде это цена самого дешёвого места, помноженная на
                людей: точная сумма зависит от выбранных мест и видна в
                корзине. Обещать её как окончательную нельзя. */}
            {party > 1 && <b> · от, за {party} чел. — точная сумма в корзине</b>}
            {stale && <i className="recalc">пересчитываем…</i>}
          </span>
        </p>
      )}

      <h3 className="alt-title">
        Туда
        {guest.outbound.shiftDays !== 0 && (
          <span className="shift-badge">{formatShift(guest.outbound.shiftDays)}</span>
        )}
      </h3>
      {guest.outbound.best ? (
        <JourneyCard journey={guest.outbound.best} chosen />
      ) : (
        <p className="invite-blank">{guest.outbound.note}</p>
      )}

      {hasReturn && (
        <>
          <h3 className="alt-title">
            Обратно
            {guest.inbound && guest.inbound.shiftDays !== 0 && (
              <span className="shift-badge">{formatShift(guest.inbound.shiftDays)}</span>
            )}
          </h3>
          {guest.inbound?.best ? (
            <JourneyCard journey={guest.inbound.best} chosen />
          ) : (
            <p className="invite-blank">{guest.inbound?.note ?? 'Обратных рейсов Туту не вернул.'}</p>
          )}
        </>
      )}
    </>
  );
}

/** «На день раньше» понятнее, чем «−1». */
function formatShift(shift: number): string {
  const days = Math.abs(shift);
  const word = days === 1 ? 'день' : 'дня';
  return shift < 0 ? `на ${days} ${word} раньше` : `на ${days} ${word} позже`;
}

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** «Час назад» честнее точной отметки: важна свежесть, а не момент. */
function formatWhen(iso: string): string {
  const hours = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  if (hours < 1) return 'только что';
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'вчера' : `${days} дн. назад`;
}
