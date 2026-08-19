import type { EventPlan, GuestPlan, Hop, Leg } from './types.ts';

/**
 * Кто с кем едет.
 *
 * Организатор видит список гостей и не видит главного: половина из них сядет
 * в один и тот же поезд. Это меняет решения — можно взять места рядом,
 * договориться о встрече на вокзале, скинуться на такси от станции. Раньше
 * это всплывало только на этапе посадки, то есть после ответов; здесь видно
 * сразу после расчёта.
 */

export interface Companionship {
  /** Ключ рейса: вид транспорта, время и точки. */
  key: string;
  label: string;
  /** Имена гостей, едущих этим рейсом. */
  names: string[];
}

/** Один и тот же рейс: вид транспорта, момент отправления и обе точки. */
function hopKey(hop: Hop): string {
  return [hop.mode, hop.departureAt, hop.fromPoint, hop.toPoint].join('|');
}

const MODE: Record<string, string> = {
  avia: 'самолёт',
  railway: 'поезд',
  bus: 'автобус',
  etrain: 'электричка',
};

function hopLabel(hop: Hop): string {
  const time = hop.departureAt.slice(11, 16);
  const date = hop.departureAt.slice(8, 10) + '.' + hop.departureAt.slice(5, 7);
  return `${MODE[hop.mode] ?? hop.mode} ${hop.fromCity} → ${hop.toCity}, ${date} ${time}`;
}

/** Совместные рейсы: только те, где едет больше одного человека. */
export function findCompanionships(plan: EventPlan, leg: Leg): Companionship[] {
  const byHop = new Map<string, { label: string; names: string[] }>();

  for (const guest of plan.guests) {
    const journey = (leg === 'outbound' ? guest.outbound : guest.inbound)?.best;
    if (!journey) continue;

    for (const hop of journey.hops) {
      const key = hopKey(hop);
      const bucket = byHop.get(key) ?? { label: hopLabel(hop), names: [] };
      if (!bucket.names.includes(guest.name)) bucket.names.push(guest.name);
      byHop.set(key, bucket);
    }
  }

  return [...byHop.entries()]
    .filter(([, bucket]) => bucket.names.length > 1)
    .map(([key, bucket]) => ({ key, label: bucket.label, names: bucket.names }))
    // Крупные компании интереснее пар: с них организатор и начнёт.
    .sort((left, right) => right.names.length - left.names.length);
}

/** Попутчики конкретного гостя — для его карточки. */
export function companionsOf(plan: EventPlan, guest: GuestPlan, leg: Leg): string[] {
  const names = new Set<string>();

  for (const shared of findCompanionships(plan, leg)) {
    if (shared.names.includes(guest.name)) {
      for (const name of shared.names) if (name !== guest.name) names.add(name);
    }
  }

  return [...names];
}
