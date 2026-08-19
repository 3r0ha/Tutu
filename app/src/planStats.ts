import type { EventPlan, Leg, ViewMode } from './types.ts';

/**
 * Производные величины плана.
 *
 * Живут в одном месте намеренно. Раньше нижняя полоса и карточки сценариев
 * считали «доедут» по-разному — полоса по показанному направлению, карточка по
 * полному кругу, — и рядом стояли два одинаково подписанных числа, которые
 * расходились. Одинаковая подпись обязана означать одинаковый смысл.
 */

/** Сколько гостей проходит по показанному сейчас направлению и режиму. */
export function reachedCount(plan: EventPlan, mode: ViewMode, leg: Leg): number {
  return plan.guests.filter((guest) => {
    const direction = leg === 'outbound' ? guest.outbound : guest.inbound;
    if (!direction) return false;
    return mode === 'direct' ? direction.directBest !== null : direction.best !== null;
  }).length;
}

/**
 * Стоимость дороги в показанном режиме.
 *
 * Считается по обоим направлениям сразу, когда запрошен разъезд: организатор
 * платит за круг, а не за половину.
 */
export function travelCost(plan: EventPlan, mode: ViewMode): number {
  const hasReturn = plan.returnDate !== null;

  return plan.guests.reduce((sum, guest) => {
    const pick = (direction: typeof guest.outbound | null): number =>
      (mode === 'direct' ? direction?.directBest : direction?.best)?.totalPrice.amount ?? 0;
    return sum + pick(guest.outbound) + (hasReturn ? pick(guest.inbound) : 0);
  }, 0);
}

/**
 * Скольких гостей открывает склейка на показанном направлении.
 *
 * Считается той же мерой, что и всё остальное на экране. По полному кругу
 * величина врала: на событии, откуда никто не может уехать обратно, склейка
 * «открывала» ноль человек — хотя доехать благодаря ей могли трое.
 */
export function unlockedByComposition(plan: EventPlan, leg: Leg): number {
  return reachedCount(plan, 'composed', leg) - reachedCount(plan, 'direct', leg);
}

/** Есть ли вообще обратные рейсы: без них сумма покрывает только дорогу туда. */
export function hasAnyReturn(plan: EventPlan): boolean {
  return plan.guests.some((guest) => guest.inbound?.best != null);
}

/**
 * Кто стоит за числом в нижней полосе.
 *
 * Раньше показатели были только числами: «4 на грани срыва» сообщало, что
 * что-то не так, но не давало ни имён, ни причины. Здесь каждый показатель
 * превращается в список гостей — по нему можно и подсветить их на карте, и
 * объяснить, откуда взялась цифра.
 */
export type MetricKey = 'reached' | 'unreached' | 'stranded' | 'atRisk';

export function guestsForMetric(
  plan: EventPlan,
  metric: MetricKey,
  mode: ViewMode,
  leg: Leg,
): string[] {
  const journeyOf = (guest: EventPlan['guests'][number]) => {
    const direction = leg === 'outbound' ? guest.outbound : guest.inbound;
    if (!direction) return null;
    return mode === 'direct' ? direction.directBest : direction.best;
  };

  switch (metric) {
    case 'reached':
      return plan.guests.filter((guest) => journeyOf(guest) !== null).map((guest) => guest.name);
    case 'unreached':
      return plan.guests.filter((guest) => journeyOf(guest) === null).map((guest) => guest.name);
    case 'stranded':
      // Доедет, но обратных рейсов ему не нашлось.
      return plan.guests
        .filter((guest) => guest.outbound.best !== null && guest.inbound !== null && guest.inbound.best === null)
        .map((guest) => guest.name);
    case 'atRisk':
      // В прямом маршруте пересадок нет вовсе, значит и срываться нечему.
      if (mode === 'direct') return [];
      return plan.guests
        .filter((guest) =>
          [guest.outbound, guest.inbound].some((direction) =>
            direction?.best?.transfers.some((transfer) => transfer.risk.level === 'critical'),
          ),
        )
        .map((guest) => guest.name);
  }
}

/** Почему показатель означает именно это — словами, а не кодом состояния. */
export function explainMetric(metric: MetricKey, leg: Leg): string {
  switch (metric) {
    case 'reached':
      return leg === 'outbound'
        ? 'Для этих гостей нашёлся маршрут до места события — прямой или со склейкой.'
        : 'Этим гостям есть на чём уехать обратно.';
    case 'unreached':
      return leg === 'outbound'
        ? 'Туту не вернул для них ни одного варианта — ни прямого, ни через пересадку.'
        : 'Обратных рейсов Туту для них не продаёт. Это не значит, что уехать нельзя, — значит, билета через Туту нет.';
    case 'stranded':
      return 'Доедут, но обратно билетов на выбранную дату нет. Стоит сдвинуть разъезд или заложить трансфер.';
    case 'atRisk':
      return 'На пересадке нет ни одного запасного рейса в ближайшие сутки: если первый рейс опоздает, поездка срывается. Билеты куплены отдельными заказами, и перевозчик не пересадит.';
  }
}
