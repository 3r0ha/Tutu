import { useState } from 'react';
import { submitRsvp } from '../api.ts';
import type { GuestPlan, Hop, Journey, SeatableLeg } from '../types.ts';
import { formatMoney } from './JourneyCard.tsx';

/**
 * Ответ гостя.
 *
 * Появляется после того, как маршрут посчитан, и уносит с собой то, что гость
 * при этом видел — выбранный путь и его цену. Организатору нужен не сам факт
 * «еду», а «еду вот так и вот за столько»: только на этом можно планировать
 * встречу, трансфер и общую посадку.
 */
export function RsvpForm({
  inviteId,
  guest,
  travellers,
  presetName,
  heading,
  lead,
  onAnswered,
}: {
  inviteId: string;
  guest: GuestPlan;
  travellers: number;
  /** Ответ меняет всю страницу, поэтому о нём должен знать не только этот блок. */
  onAnswered?: (attending: boolean | null) => void;
  /** Имя из персональной ссылки: гость не должен представляться дважды. */
  presetName?: string;
  heading?: string;
  lead?: string;
}) {
  const [name, setName] = useState(presetName ?? '');
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState<'yes' | 'no' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (attending: boolean) => {
    if (!name.trim()) {
      setError('Представьтесь, чтобы организатор понял, кто ответил');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitRsvp(inviteId, {
        name: name.trim(),
        city: guest.city,
        attending,
        travellers,
        // Ответ несёт маршрут, который гость реально видел на экране.
        routeSummary: attending ? summarize(guest) : null,
        price: attending ? (guest.totalPrice?.amount ?? null) : null,
        comment: comment.trim() || null,
        // Плечи уходят вместе с ответом: по ним организатор потом соберёт
        // попутчиков и посадит их рядом.
        seatableLegs: attending ? seatableLegsOf(guest) : [],
      });
      setSent(attending ? 'yes' : 'no');
      onAnswered?.(attending);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось отправить ответ');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <section className="invite-card rsvp-done">
        <p className="rsvp-done-title">
          {sent === 'yes' ? 'Спасибо, ждём вас!' : 'Спасибо, что предупредили.'}
        </p>
        <p className="invite-lead">
          {sent === 'yes'
            ? 'Организатор увидит ваш маршрут и цену. Билеты покупаются по ссылкам выше — мы их не бронируем.'
            : 'Организатор увидит, что вас не будет.'}
        </p>
        <button
          type="button"
          className="chip"
          onClick={() => {
            setSent(null);
            onAnswered?.(null);
          }}
        >
          Изменить ответ
        </button>
      </section>
    );
  }

  return (
    <section className="invite-card">
      <h2 className="invite-section">{heading || 'Вы едете?'}</h2>
      <p className="invite-lead">
        {lead || 'Ответ уйдёт организатору вместе с маршрутом'}
        {guest.totalPrice ? ` и суммой ${formatMoney(guest.totalPrice.amount)}` : ''}.
      </p>

      <div className="rsvp-fields">
        <input
          value={name}
          placeholder="Как вас записать"
          onChange={(event) => setName(event.target.value)}
          aria-label="Имя"
        />
        <textarea
          rows={2}
          value={comment}
          placeholder="Комментарий организатору — необязательно"
          onChange={(event) => setComment(event.target.value)}
          aria-label="Комментарий"
        />
      </div>

      <div className="rsvp-actions">
        <button type="button" className="primary" onClick={() => send(true)} disabled={busy}>
          Еду
        </button>
        <button type="button" className="ghost" onClick={() => send(false)} disabled={busy}>
          Не смогу
        </button>
      </div>

      {error && <p className="hint error">{error}</p>}
    </section>
  );
}

function summarize(guest: GuestPlan): string {
  const leg = (label: string, journey: GuestPlan['outbound']['best']): string | null => {
    if (!journey) return null;
    const via = journey.via.length ? ` через ${journey.via.join(', ')}` : ' без пересадок';
    return `${label}: ${journey.hops.map((hop) => MODE[hop.mode]).join(' + ')}${via}`;
  };

  return [leg('туда', guest.outbound.best), leg('обратно', guest.inbound?.best ?? null)]
    .filter(Boolean)
    .join('; ');
}

/** Плечи, где места вообще выбираются: поезд и автобус. */
function seatableLegsOf(guest: GuestPlan): SeatableLeg[] {
  const journeys = [guest.outbound.best, guest.inbound?.best ?? null].filter(
    (journey): journey is Journey => journey !== null,
  );

  const legs = new Map<string, SeatableLeg>();
  for (const journey of journeys) {
    for (const hop of journey.hops) {
      if (!hop.detailsRef) continue;
      if (hop.mode !== 'railway' && hop.mode !== 'bus') continue;
      const key = legKey(hop);
      if (legs.has(key)) continue;
      legs.set(key, {
        key,
        transport: hop.mode,
        label: labelOf(hop),
        detailsRef: hop.detailsRef,
        checkoutRef: hop.checkoutRef ?? null,
      });
    }
  }

  return [...legs.values()];
}

function labelOf(hop: Hop): string {
  const ref = hop.detailsRef ?? {};
  const prefix = hop.mode === 'railway' ? `Поезд ${String(ref.train_number ?? '')}` : 'Автобус';
  return `${prefix}: ${hop.fromPoint} → ${hop.toPoint}`.replace(/\s+/g, ' ').trim();
}

function legKey(hop: Hop): string {
  const ref = hop.detailsRef ?? {};
  return [hop.mode, ref.train_number ?? ref.offer_hash ?? '', hop.departureAt, hop.fromPoint, hop.toPoint].join('|');
}

const MODE: Record<string, string> = {
  avia: 'самолёт',
  railway: 'поезд',
  bus: 'автобус',
  etrain: 'электричка',
};
