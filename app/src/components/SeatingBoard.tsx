import { useCallback, useEffect, useState } from 'react';
import { fetchSeating } from '../api.ts';
import type { SeatBlock, SeatingBoardData, SeatingStatus } from '../types.ts';
import { formatMoney } from './JourneyCard.tsx';

const STATUS_LABEL: Record<SeatingStatus, string> = {
  together: 'все рядом',
  split: 'по блокам',
  partial: 'частично',
  impossible: 'мест рядом нет',
  unavailable: 'недоступно',
};

/** Расшифровка типов полок: коды Туту без перевода читаются как шум. */
const SEAT_TYPE: Record<string, string> = {
  LOWER: 'нижняя',
  UPPER: 'верхняя',
  SIDE_LOWER: 'боковая нижняя',
  SIDE_UPPER: 'боковая верхняя',
  LOWER_NEAR_WC: 'нижняя у туалета',
  UPPER_NEAR_WC: 'верхняя у туалета',
  SIDE_LOWER_NEAR_WC: 'боковая нижняя у туалета',
  SIDE_UPPER_NEAR_WC: 'боковая верхняя у туалета',
};

/**
 * Посадка попутчиков.
 *
 * Гости, подтвердившие приезд одним рейсом, — единственные, для кого этот
 * вопрос вообще стоит. Одиночки сюда не попадают: соседние места им подбирать
 * не от чего.
 */
export function SeatingBoard({ inviteId }: { inviteId: string }) {
  const [data, setData] = useState<SeatingBoardData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setData(await fetchSeating(inviteId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось подобрать места');
    } finally {
      setBusy(false);
    }
  }, [inviteId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) return <p className="hint error">{error}</p>;
  if (!data) return <p className="hint">Подбираем места…</p>;

  if (data.groups.length === 0) {
    return (
      <p className="hint">
        Попутчиков пока нет: подбор включается, когда одним рейсом едут хотя бы двое.
      </p>
    );
  }

  return (
    <div className="answers">
      {data.groups.map((group) => (
        <div key={group.key} className={`seating ${group.seating.status}`}>
          <div className="seating-head">
            <span className="seating-leg">{group.label}</span>
            <span className="seating-status">{STATUS_LABEL[group.seating.status]}</span>
          </div>

          <p className="seating-who">
            {group.names.join(', ')} · {group.seating.party} чел.
          </p>

          {group.seating.blocks.map((block) => (
            <Block key={`${block.carNumber ?? 'bus'}-${block.seats[0]?.number}`} block={block} />
          ))}

          <p className="seating-note">{group.seating.note}</p>

          {group.seating.blocks.some((block) => block.cartUrl) && (
            <p className="seating-note">
              Корзина открывается в любом браузере — места в ней уже выбраны, данные пассажиров
              вводятся при оформлении. Каждый блок покупается отдельным заказом.
            </p>
          )}

          {group.seating.totalPrice && (
            <p className="seating-price">{formatMoney(group.seating.totalPrice.amount)}</p>
          )}
        </div>
      ))}

      <button type="button" className="ghost" onClick={() => void refresh()} disabled={busy}>
        {busy ? 'Подбираем…' : 'Пересчитать'}
      </button>
    </div>
  );
}

function Block({ block }: { block: SeatBlock }) {
  return (
    <div className="seat-block">
      <span className="seat-car">
        {block.carNumber ? `вагон ${block.carNumber}` : 'салон'}
        {block.serviceClass && ` · ${block.serviceClass}`}
        {block.compartment !== null && ` · отсек ${block.compartment}`}
      </span>
      <span className="seat-list">
        {block.seats.map((seat) => (
          <span key={seat.number} className="seat">
            {seat.number}
            {seat.type && <i>{SEAT_TYPE[seat.type] ?? seat.type.toLowerCase()}</i>}
          </span>
        ))}
      </span>
      {block.price && <span className="seat-price">{formatMoney(block.price.amount)}</span>}

      {/* Ссылка ведёт в корзину именно с этими местами, а не на страницу выбора:
          пока человек искал бы их руками, их могли занять. */}
      {block.cartUrl && (
        <a className="seat-cart" href={block.cartUrl} target="_blank" rel="noreferrer">
          В корзину с этими местами →
        </a>
      )}
    </div>
  );
}
