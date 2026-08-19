/**
 * Тесты текстовой сводки.
 *
 * Сводку организатор пересылает гостям и вставляет в таблицу, поэтому в ней
 * важнее всего отсутствие умолчаний: недоехавший должен быть виден строкой,
 * а не пропуском.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { buildDigest } from './digest.ts';
import type { Direction, EventPlan, GuestPlan, Hop, Journey } from './types.ts';

function hop(mode: Hop['mode'], from: string, to: string): Hop {
  return {
    mode,
    fromCity: from,
    toCity: to,
    fromPoint: from,
    toPoint: to,
    departureAt: '2026-09-11T10:00:00+03:00',
    arrivalAt: '2026-09-11T18:00:00+03:00',
    durationMin: 480,
    price: { amount: 500, currency: 'RUB' },
    priceBasis: 'party' as const,
    pricePerSeat: null,
    carriers: [],
    segmentsCount: 1,
    searchResultsUrl: null,
    checkoutUrl: null,
    detailsRef: null,
    checkoutRef: null,
    review: null,
    vehicle: null,
    classes: null,
  };
}

function journey(hops: Hop[], amount: number, risk: Journey['risk'] = 'safe'): Journey {
  return {
    id: `j${amount}`,
    kind: hops.length > 1 ? 'composed' : 'direct',
    hops,
    transfers: [],
    via: hops.length > 1 ? [hops[0].toCity] : [],
    departureAt: hops[0].departureAt,
    arrivalAt: hops[hops.length - 1].arrivalAt,
    totalDurationMin: 480,
    ticketsPrice: { amount, currency: 'RUB' },
    lodgingPrice: null,
    totalPrice: { amount, currency: 'RUB' },
    risk,
  };
}

const direction = (best: Journey | null, note = ''): Direction => ({
  best,
  directBest: null,
  alternatives: [],
  date: '2026-09-11',
  shiftDays: 0,
  note,
});

function guest(name: string, city: string, outbound: Direction, inbound: Direction | null): GuestPlan {
  return {
    name,
    city,
    status: outbound.best ? 'composed' : 'unreachable',
    outbound,
    inbound,
    totalPrice: outbound.best ? outbound.best.totalPrice : null,
    note: '',
  };
}

function plan(guests: GuestPlan[], returnDate: string | null = '2026-09-13'): EventPlan {
  return {
    destination: 'Суздаль',
    endCity: 'Суздаль',
    date: '2026-09-11',
    returnDate,
    guests,
    summary: {
      guests: guests.length,
      reachableDirect: 0,
      reachableComposed: guests.filter((entry) => entry.outbound.best).length,
      unreachable: guests.filter((entry) => !entry.outbound.best).length,
      stranded: guests.filter((entry) => entry.outbound.best && entry.inbound && !entry.inbound.best).length,
      totalCost: 12000,
      currency: 'RUB',
      atRisk: 0,
    },
    coordinates: {},
    destinationCoordinates: null,
    elapsedMs: 0,
  };
}

describe('текстовая сводка', () => {
  it('в заголовке место и диапазон дат одним месяцем', () => {
    const digest = buildDigest(plan([]), 'Свадьба');
    assert.match(digest, /^Свадьба — Суздаль, 11–13 сентября 2026/);
  });

  it('даты из разных месяцев пишутся полностью', () => {
    const sample = { ...plan([]), date: '2026-09-30', returnDate: '2026-10-02' };
    assert.match(buildDigest(sample), /30 сентября – 2 октября 2026/);
  });

  it('без разъезда указывается одна дата', () => {
    assert.match(buildDigest(plan([], null)), /11 сентября 2026/);
  });

  it('маршрут расписан по видам транспорта', () => {
    const sample = plan([
      guest(
        'Аня',
        'Киров',
        direction(journey([hop('railway', 'Киров', 'Москва'), hop('bus', 'Москва', 'Суздаль')], 5748)),
        direction(journey([hop('bus', 'Суздаль', 'Москва')], 1610)),
      ),
    ]);

    const digest = buildDigest(sample);
    assert.match(digest, /Аня \(Киров\) — 5748 ₽/);
    assert.match(digest, /туда: поезд Киров→Москва, автобус Москва→Суздаль/);
    assert.match(digest, /обратно: автобус Суздаль→Москва/);
  });

  it('отсутствие обратных рейсов названо прямо', () => {
    const sample = plan([
      guest('Аня', 'Киров', direction(journey([hop('bus', 'Киров', 'Суздаль')], 900)), direction(null)),
    ]);
    assert.match(buildDigest(sample), /обратно: рейсов Туту не вернул/);
  });

  it('недоехавший остаётся строкой, а не пропуском', () => {
    const sample = plan([
      guest('Вера', 'Териберка', direction(null, 'выехать некуда'), direction(null)),
    ]);
    assert.match(buildDigest(sample), /Вера \(Териберка\) — не доедет: выехать некуда/);
  });

  it('рискованная пересадка помечена', () => {
    const sample = plan([
      guest(
        'Аня',
        'Киров',
        direction(journey([hop('railway', 'Киров', 'Москва'), hop('bus', 'Москва', 'Суздаль')], 5748, 'critical')),
        null,
      ),
    ]);
    assert.match(buildDigest(sample), /\[пересадка без запаса\]/);
  });

  it('город без имени не дублируется в скобках', () => {
    const sample = plan([
      guest('Казань', 'Казань', direction(journey([hop('avia', 'Казань', 'Суздаль')], 4000)), null),
    ]);
    assert.match(buildDigest(sample), /^Казань — 4000 ₽/m);
  });

  it('когда круг не сложился, показывается стоимость дороги туда', () => {
    const sample = plan([
      guest('Аня', 'Киров', direction(journey([hop('bus', 'Киров', 'Суздаль')], 900)), direction(null)),
      guest('Борис', 'Казань', direction(journey([hop('bus', 'Казань', 'Суздаль')], 1100)), direction(null)),
    ]);
    sample.summary.totalCost = 0;
    assert.match(buildDigest(sample), /дорога туда 2000 ₽/);
  });

  it('в итоге сходятся все категории', () => {
    const sample = plan([
      guest('Аня', 'Киров', direction(journey([hop('bus', 'Киров', 'Суздаль')], 900)), direction(null)),
      guest('Вера', 'Териберка', direction(null, 'выехать некуда'), direction(null)),
    ]);
    const digest = buildDigest(sample);
    assert.match(digest, /Итого: гостей 2, доедут 1, застрянут 1, не доедут 1, дорога 12000 ₽/);
  });
});
