/**
 * Склейка двух плеч в одну поездку.
 *
 * Здесь живёт вся логика, которой нет в исходном поиске: допустимость окна
 * пересадки, превращение долгого ожидания в ночёвку и честная оценка того, что
 * будет, если первое плечо опоздает.
 */

import type { Hop, Journey, OvernightStay, RiskLevel, Transfer, TransferRisk } from '../domain/types.ts';
import { minutesBetween } from '../mcp/tutu.ts';

/** Пересадка между аэропортом и вокзалом требует запаса на дорогу через город. */
const MIN_CONNECT_WITH_AVIA_MIN = 120;
const MIN_CONNECT_GROUND_MIN = 60;
/**
 * Надбавка за смену вокзала или аэропорта.
 *
 * До сих пор окно пересадки зависело только от вида транспорта, и переход
 * между соседними платформами Казанского вокзала оценивался так же, как
 * переезд из Шереметьева на Щёлковский автовокзал. В Москве это разные
 * события: одно занимает минуты, другое — полтора часа с пробками.
 *
 * Сколько именно ехать между конкретными точками, Туту не отвечает, поэтому
 * надбавка одна на все случаи и намеренно осторожная: ошибка в большую
 * сторону стоит человеку лишнего часа ожидания, в меньшую — сорванной поездки.
 */
const MIN_CROSS_POINT_MIN = 90;
/** Дольше суток ждать — это уже не пересадка, а другая поездка. */
const MAX_WAIT_MIN = 24 * 60;
/** С этого ожидания начинаем рассматривать ночёвку. */
const LODGING_WAIT_MIN = 6 * 60;

export function minConnectMinutes(inbound: Hop, outbound: Hop): number {
  const involvesAir = inbound.mode === 'avia' || outbound.mode === 'avia';
  const base = involvesAir ? MIN_CONNECT_WITH_AVIA_MIN : MIN_CONNECT_GROUND_MIN;
  return base + (changesPoint(inbound, outbound) ? MIN_CROSS_POINT_MIN : 0);
}

/**
 * Меняется ли вокзал или аэропорт на пересадке.
 *
 * Туту отдаёт точку самоописывающейся строкой вида «Москва — Ленинградский
 * вокзал (2006004)», и сравнение строк здесь надёжнее разбора: код станции
 * внутри уже делает две разные точки разными, а одну и ту же — одинаковой.
 * Когда точка не названа, считаем, что она не меняется: выдумывать переезд,
 * которого может не быть, значит отбрасывать живые маршруты.
 */
export function changesPoint(inbound: Hop, outbound: Hop): boolean {
  const from = inbound.toPoint.trim();
  const to = outbound.fromPoint.trim();
  if (!from || !to) return false;
  return from !== to;
}

export interface Connection {
  inbound: Hop;
  outbound: Hop;
  city: string;
  waitMin: number;
  needsLodging: boolean;
  /** Дата заезда в отель, если ночёвка нужна. */
  lodgingNight: { checkIn: string; checkOut: string } | null;
}

/**
 * Все допустимые пары плеч через один город.
 *
 * Возвращаются именно все, а не лучшая: выбор между «впритык и дешевле» и
 * «с ночёвкой и спокойно» принадлежит пользователю, а не движку.
 */
export function feasibleConnections(city: string, inbound: Hop[], outbound: Hop[]): Connection[] {
  const connections: Connection[] = [];

  for (const first of inbound) {
    // Без времени прибытия окно пересадки не посчитать, поэтому такое плечо
    // может быть только последним в маршруте, но не первым.
    if (!first.arrivalAt) continue;

    for (const second of outbound) {
      const waitMin = minutesBetween(first.arrivalAt, second.departureAt);
      if (waitMin < minConnectMinutes(first, second)) continue;
      if (waitMin > MAX_WAIT_MIN) continue;

      const night = nightBetween(first.arrivalAt!, second.departureAt);
      const needsLodging = waitMin >= LODGING_WAIT_MIN && night !== null;

      connections.push({
        inbound: first,
        outbound: second,
        city,
        waitMin,
        needsLodging,
        lodgingNight: needsLodging ? night : null,
      });
    }
  }

  return connections;
}

/**
 * Ночь внутри окна пересадки.
 *
 * Признаком ночи считается попадание в интервал отметки 03:00 — если пассажир
 * находится в городе в это время, ему нужна кровать, какой бы формально
 * длины ни было ожидание.
 *
 * Три часа ночи — это три часа ночи **в том городе, где человек ждёт**, а не
 * там, где стоит сервер. Раньше считалось через `setHours`, то есть в поясе
 * машины: на моей выходило московское время, на сборочной — UTC, на стенде —
 * центральноевропейское, и один и тот же маршрут получал разный ответ про
 * ночёвку. Теперь время берётся так, как оно написано в строке Туту, вместе
 * с её смещением.
 */
export function nightBetween(
  arrivalIso: string,
  departureIso: string,
): { checkIn: string; checkOut: string } | null {
  const arrival = localClock(arrivalIso);
  const departure = localClock(departureIso);
  if (!arrival || !departure) return null;

  const probe = new Date(arrival);
  probe.setUTCHours(3, 0, 0, 0);
  if (probe < arrival) probe.setUTCDate(probe.getUTCDate() + 1);
  if (probe > departure) return null;

  // Заезд — накануне той ночи, выезд — утром после неё.
  const checkIn = new Date(probe);
  checkIn.setUTCDate(checkIn.getUTCDate() - 1);
  return { checkIn: isoDate(checkIn), checkOut: isoDate(probe) };
}

/**
 * Настенные часы точки как момент времени.
 *
 * Смещение из строки отбрасывается намеренно: «2026-09-11T20:49:00+03:00»
 * превращается в 20:49 UTC. Сравнивать такие моменты между собой можно —
 * у прибытия и отправления в одном городе смещение одинаковое, — а вот
 * пересчитывать их в чужой пояс нельзя.
 */
function localClock(iso: string): Date | null {
  const at = new Date(`${iso.slice(0, 19)}Z`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Риск пересадки измеряется числом запасных рейсов, а не длиной окна.
 *
 * Сорок минут в Москве, где следующий автобус через час, безопаснее двух часов
 * в городе, куда рейс ходит дважды в сутки: там опоздание стоит суток.
 */
export function assessRisk(connection: Connection, allOutbound: Hop[]): TransferRisk {
  const chosenDeparture = Date.parse(connection.outbound.departureAt);
  const cutoff = chosenDeparture + MAX_WAIT_MIN * 60_000;

  const later = allOutbound
    .filter((hop) => {
      const departure = Date.parse(hop.departureAt);
      return departure > chosenDeparture && departure <= cutoff;
    })
    .sort((a, b) => Date.parse(a.departureAt) - Date.parse(b.departureAt));

  const nextFallbackAt = later[0]?.departureAt ?? null;
  const slack = connection.waitMin - minConnectMinutes(connection.inbound, connection.outbound);

  let level: RiskLevel;
  let note: string;

  if (later.length === 0) {
    level = 'critical';
    note = connection.needsLodging
      ? `Последний рейс в сутках. Опоздание на него — потеря дня.`
      : `Запасных рейсов в ближайшие сутки нет: опоздание срывает поездку.`;
  } else if (later.length <= 2 || slack < 30) {
    level = 'tight';
    note = `Запасных рейсов: ${later.length}. Ближайший — ${timeOf(nextFallbackAt!)}.`;
  } else {
    level = 'safe';
    note = `Запасных рейсов: ${later.length}, ближайший через ${humanGap(connection.outbound.departureAt, nextFallbackAt!)}.`;
  }

  return { level, fallbacksLater: later.length, nextFallbackAt, note };
}

export function buildJourney(
  connection: Connection,
  risk: TransferRisk,
  lodging: OvernightStay | null,
): Journey {
  const hops = [connection.inbound, connection.outbound];
  const ticketsAmount = hops.reduce((sum, hop) => sum + hop.price.amount, 0);
  const currency = hops[0].price.currency;
  const lodgingAmount = lodging?.price.amount ?? 0;

  const transfer: Transfer = {
    city: connection.city,
    arriveAt: connection.inbound.arrivalAt!,
    departAt: connection.outbound.departureAt,
    waitMin: connection.waitMin,
    move: changesPoint(connection.inbound, connection.outbound)
      ? { from: connection.inbound.toPoint, to: connection.outbound.fromPoint }
      : null,
    overnight: lodging,
    risk,
  };

  return {
    id: `composed:${connection.city}:${connection.inbound.departureAt}:${connection.outbound.departureAt}`,
    kind: 'composed',
    hops,
    transfers: [transfer],
    via: [connection.city],
    departureAt: connection.inbound.departureAt,
    arrivalAt: connection.outbound.arrivalAt,
    totalDurationMin: connection.outbound.arrivalAt
      ? minutesBetween(connection.inbound.departureAt, connection.outbound.arrivalAt)
      : null,
    ticketsPrice: { amount: round2(ticketsAmount), currency },
    lodgingPrice: lodging ? lodging.price : null,
    totalPrice: { amount: round2(ticketsAmount + lodgingAmount), currency },
    risk: risk.level,
  };
}

export function directJourney(hop: Hop): Journey {
  return {
    id: `direct:${hop.mode}:${hop.departureAt}`,
    kind: 'direct',
    hops: [hop],
    transfers: [],
    via: [],
    departureAt: hop.departureAt,
    arrivalAt: hop.arrivalAt,
    totalDurationMin: hop.durationMin,
    ticketsPrice: hop.price,
    lodgingPrice: null,
    totalPrice: hop.price,
    risk: 'safe',
  };
}

function isoDate(date: Date): string {
  // Дата берётся в тех же настенных часах, что и всё остальное здесь.
  return date.toISOString().slice(0, 10);
}

/**
 * Время берётся из самой строки, а не через `Date`.
 *
 * Туту возвращает местное время точки отправления вместе со смещением
 * (`2026-09-12T12:00:00+03:00`). Прогон через `toLocaleTimeString` пересчитал бы
 * его в часовой пояс сервера, и подсказка начала бы противоречить данным
 * в том же ответе.
 */
function timeOf(iso: string): string {
  return iso.slice(11, 16);
}

function humanGap(fromIso: string, toIso: string): string {
  const minutes = minutesBetween(fromIso, toIso);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
