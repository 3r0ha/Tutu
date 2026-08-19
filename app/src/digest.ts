import type { EventPlan, GuestPlan, Journey } from './types.ts';

/**
 * Текстовая сводка события.
 *
 * Расчёт живёт на экране, а работа организатора — в переписке и таблицах.
 * Без выгрузки результат некуда деть: его переписывают руками, теряя половину.
 * Формат намеренно простой — годится и для сообщения в мессенджере, и для
 * вставки в таблицу.
 *
 * Пустые поля называются пустыми: «обратных рейсов не нашлось» вместо
 * молчаливого пропуска строки.
 */

const MODE_LABEL: Record<string, string> = {
  avia: 'самолёт',
  railway: 'поезд',
  bus: 'автобус',
  etrain: 'электричка',
};

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

export function buildDigest(plan: EventPlan, title?: string): string {
  const lines: string[] = [];

  lines.push(`${title?.trim() || 'Событие'} — ${plan.destination}, ${formatDates(plan)}`);
  lines.push('');

  for (const guest of plan.guests) {
    lines.push(describeGuest(guest));
  }

  lines.push('');
  lines.push(summarize(plan));

  return lines.join('\n');
}

function describeGuest(guest: GuestPlan): string {
  const head = guest.name === guest.city ? guest.city : `${guest.name} (${guest.city})`;

  if (!guest.outbound.best) return `${head} — не доедет: ${guest.outbound.note}`;

  const parts = [describeLeg('туда', guest.outbound.best)];
  if (guest.inbound) {
    parts.push(
      guest.inbound.best
        ? describeLeg('обратно', guest.inbound.best)
        : 'обратно: рейсов Туту не вернул',
    );
  }

  const price = guest.totalPrice ? `${Math.round(guest.totalPrice.amount)} ₽ — ` : '';
  return `${head} — ${price}${parts.join('; ')}`;
}

function describeLeg(label: string, journey: Journey): string {
  const chain = journey.hops
    .map((hop) => `${MODE_LABEL[hop.mode] ?? hop.mode} ${hop.fromCity}→${hop.toCity}`)
    .join(', ');

  const risk = journey.risk === 'critical' ? ' [пересадка без запаса]' : '';
  return `${label}: ${chain}${risk}`;
}

function summarize(plan: EventPlan): string {
  const { summary } = plan;
  const parts = [
    `гостей ${summary.guests}`,
    `доедут ${summary.reachableComposed}`,
  ];

  if (summary.stranded > 0) parts.push(`застрянут ${summary.stranded}`);
  if (summary.unreachable > 0) parts.push(`не доедут ${summary.unreachable}`);

  if (summary.totalCost > 0) {
    parts.push(`дорога ${summary.totalCost} ₽`);
  } else {
    // Полный круг не сложился ни у кого, но деньги на дорогу туда всё равно
    // нужны — молчать о них значит терять половину сводки.
    const oneWay = plan.guests.reduce(
      (sum, guest) => sum + (guest.outbound.best?.totalPrice.amount ?? 0),
      0,
    );
    if (oneWay > 0) parts.push(`дорога туда ${Math.round(oneWay)} ₽`);
  }

  return `Итого: ${parts.join(', ')}`;
}

function formatDates(plan: EventPlan): string {
  const start = parse(plan.date);
  if (!plan.returnDate) return `${start.day} ${MONTHS[start.month - 1]} ${start.year}`;

  const end = parse(plan.returnDate);
  // Один месяц — не повторяем его дважды: «11–13 сентября», а не «11 сентября – 13 сентября».
  if (start.month === end.month && start.year === end.year) {
    return `${start.day}–${end.day} ${MONTHS[start.month - 1]} ${start.year}`;
  }
  return `${start.day} ${MONTHS[start.month - 1]} – ${end.day} ${MONTHS[end.month - 1]} ${end.year}`;
}

function parse(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}
