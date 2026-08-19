/**
 * Тесты поиска попутчиков.
 *
 * Совпадением считается один и тот же рейс, а не просто общий город: два
 * гостя могут ехать через Москву разными поездами и попутчиками не быть.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { companionsOf, findCompanionships } from './companions.ts';
import type { Direction, EventPlan, GuestPlan, Hop, Journey } from './types.ts';

function hop(mode: Hop['mode'], from: string, to: string, departureAt: string): Hop {
  return {
    mode,
    fromCity: from,
    toCity: to,
    fromPoint: `${from} вокзал`,
    toPoint: `${to} вокзал`,
    departureAt,
    arrivalAt: '2026-09-11T20:00:00+03:00',
    durationMin: 300,
    price: { amount: 1000, currency: 'RUB' },
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

function journey(hops: Hop[]): Journey {
  return {
    id: hops.map((entry) => entry.departureAt).join('-'),
    kind: hops.length > 1 ? 'composed' : 'direct',
    hops,
    transfers: [],
    via: [],
    departureAt: hops[0].departureAt,
    arrivalAt: null,
    totalDurationMin: null,
    ticketsPrice: { amount: 1000, currency: 'RUB' },
    lodgingPrice: null,
    totalPrice: { amount: 1000, currency: 'RUB' },
    risk: 'safe',
  };
}

const direction = (best: Journey | null): Direction => ({
  best,
  directBest: null,
  alternatives: [],
  date: '2026-09-11',
  shiftDays: 0,
  note: '',
});

function guest(name: string, outbound: Journey | null): GuestPlan {
  return {
    name,
    city: name,
    status: 'composed',
    outbound: direction(outbound),
    inbound: null,
    totalPrice: null,
    note: '',
  };
}

function plan(guests: GuestPlan[]): EventPlan {
  return {
    destination: 'Суздаль',
    endCity: 'Суздаль',
    date: '2026-09-11',
    returnDate: null,
    guests,
    summary: {
      guests: guests.length,
      reachableDirect: 0,
      reachableComposed: 0,
      unreachable: 0,
      stranded: 0,
      totalCost: 0,
      currency: 'RUB',
      atRisk: 0,
    },
    coordinates: {},
    destinationCoordinates: null,
    elapsedMs: 0,
  };
}

const morningBus = hop('bus', 'Москва', 'Суздаль', '2026-09-11T08:00:00+03:00');
const noonBus = hop('bus', 'Москва', 'Суздаль', '2026-09-11T12:00:00+03:00');

describe('поиск попутчиков', () => {
  it('один и тот же рейс объединяет гостей', () => {
    const sample = plan([
      guest('Аня', journey([hop('railway', 'Киров', 'Москва', '2026-09-11T07:00:00+03:00'), morningBus])),
      guest('Борис', journey([hop('railway', 'Казань', 'Москва', '2026-09-11T06:00:00+03:00'), morningBus])),
    ]);

    const shared = findCompanionships(sample, 'outbound');
    assert.equal(shared.length, 1);
    assert.deepEqual(shared[0].names, ['Аня', 'Борис']);
    assert.match(shared[0].label, /автобус Москва → Суздаль/);
  });

  it('общий город без общего рейса попутчиками не делает', () => {
    const sample = plan([
      guest('Аня', journey([morningBus])),
      guest('Борис', journey([noonBus])),
    ]);
    assert.equal(findCompanionships(sample, 'outbound').length, 0);
  });

  it('одинокий пассажир не образует компанию', () => {
    const sample = plan([guest('Аня', journey([morningBus]))]);
    assert.equal(findCompanionships(sample, 'outbound').length, 0);
  });

  it('большие компании идут первыми', () => {
    const other = hop('railway', 'Тверь', 'Москва', '2026-09-11T05:00:00+03:00');
    const sample = plan([
      guest('Аня', journey([morningBus])),
      guest('Борис', journey([morningBus])),
      guest('Вера', journey([morningBus])),
      guest('Глеб', journey([other])),
      guest('Дина', journey([other])),
    ]);

    const shared = findCompanionships(sample, 'outbound');
    assert.equal(shared[0].names.length, 3);
    assert.equal(shared[1].names.length, 2);
  });

  it('попутчики конкретного гостя не включают его самого', () => {
    const sample = plan([
      guest('Аня', journey([morningBus])),
      guest('Борис', journey([morningBus])),
      guest('Вера', journey([noonBus])),
    ]);
    assert.deepEqual(companionsOf(sample, sample.guests[0], 'outbound'), ['Борис']);
  });

  it('недостижимый гость ни с кем не едет', () => {
    const sample = plan([guest('Аня', journey([morningBus])), guest('Вера', null)]);
    assert.deepEqual(companionsOf(sample, sample.guests[1], 'outbound'), []);
  });
});
