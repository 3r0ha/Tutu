import type { Direction, GuestPlan, ViewMode } from '../types.ts';
import { JourneyCard, formatMoney } from './JourneyCard.tsx';

/**
 * Карточка одного гостя — оба направления сразу.
 *
 * Дорога «туда» и «обратно» показываются вместе, потому что решение принимается
 * по кругу целиком: маршрут, который дёшев в одну сторону и невозможен в
 * другую, — это не дешёвый маршрут, а ловушка.
 */
export function GuestSheet({
  guest,
  mode,
  onClose,
}: {
  guest: GuestPlan;
  mode: ViewMode;
  onClose: () => void;
}) {
  return (
    <section className="sheet" role="dialog" aria-label={`Маршрут: ${guest.name}`}>
      <button type="button" className="close" onClick={onClose} aria-label="Закрыть">
        ×
      </button>

      <h2>{guest.name}</h2>
      <p className="sub">{guest.city} · {guest.note}</p>

      {guest.totalPrice && (
        <p className="sheet-total">
          {formatMoney(guest.totalPrice.amount)}
          <span> — дорога {guest.inbound ? 'в оба конца' : 'в одну сторону'}</span>
        </p>
      )}

      <Leg title="Туда" direction={guest.outbound} mode={mode} />
      {guest.inbound && <Leg title="Обратно" direction={guest.inbound} mode={mode} stranded />}

      <p className="provenance">
        Цены, расписания и ссылки на покупку получены от Туту в момент расчёта. Того, чего Туту не
        вернул, мы не додумываем. Билеты на составной маршрут покупаются отдельными заказами:
        пересадка самостоятельная, и перевозчик за неё не отвечает.
      </p>
    </section>
  );
}

/** «На день раньше» понятнее, чем «−1». */
function formatShift(shift: number): string {
  const days = Math.abs(shift);
  const word = days === 1 ? 'день' : 'дня';
  return shift < 0 ? `на ${days} ${word} раньше` : `на ${days} ${word} позже`;
}

function Leg({
  title,
  direction,
  mode,
  stranded,
}: {
  title: string;
  direction: Direction;
  mode: ViewMode;
  stranded?: boolean;
}) {
  const journey = mode === 'direct' ? direction.directBest : direction.best;

  return (
    <>
      <h3 className="alt-title">
        {title}
        {/* Сдвиг даты — не мелочь: человек должен понимать, что едет не в тот
            день, который назвал организатор, и почему. */}
        {direction.shiftDays !== 0 && (
          <span className="shift-badge">{formatShift(direction.shiftDays)}</span>
        )}
      </h3>

      {journey ? (
        <>
          {direction.shiftDays !== 0 && <p className="shift-note">{direction.note}</p>}
          <JourneyCard journey={journey} chosen />
          {mode === 'composed' && direction.alternatives.length > 0 && (
            <details className="alts">
              <summary>Ещё {direction.alternatives.length}</summary>
              {direction.alternatives.map((alternative) => (
                <JourneyCard key={alternative.id} journey={alternative} />
              ))}
            </details>
          )}
        </>
      ) : (
        <div className="blank">
          <p className="blank-title">
            {mode === 'direct' ? 'Прямого сообщения нет' : 'Вариантов не нашлось'}
          </p>
          <p>
            {mode === 'direct'
              ? 'Обычный поиск на этом заканчивается: такой пары городов в выдаче нет. Переключите режим на «Со склейкой».'
              : direction.note}
          </p>
          {stranded && mode === 'composed' && (
            // Пустой ответ Туту не доказывает, что рейсов не существует, —
            // и выдавать одно за другое значило бы дезинформировать организатора.
            <p className="blank-hint">
              Это не значит, что уехать нельзя: значит, что билет обратно сейчас не продаётся через
              Туту. Стоит заложить трансфер или сдвинуть дату разъезда.
            </p>
          )}
        </div>
      )}
    </>
  );
}
