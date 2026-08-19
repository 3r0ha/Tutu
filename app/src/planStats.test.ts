/**
 * Тесты производных величин плана.
 *
 * Эти числа стоят рядом на экране в двух местах — в нижней полосе и в
 * карточках сценариев. Раньше они считались по-разному и расходились при
 * одинаковой подписи; тесты закрепляют единый смысл.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { hasAnyReturn, reachedCount, travelCost, unlockedByComposition } from './planStats.ts';
import type { Direction, EventPlan, GuestPlan, Journey } from './types.ts';

function journey(amount: number, kind: 'direct' | 'composed' = 'composed'): Journey {
  return {
    id: `${kind}-${amount}`,
    kind,
    hops: [],
    transfers: [],
    via: kind === 'composed' ? ['Москва'] : [],
    departureAt: '2026-09-11T10:00:00+03:00',
    arrivalAt: '2026-09-11T18:00:00+03:00',
    totalDurationMin: 480,
    ticketsPrice: { amount, currency: 'RUB' },
    lodgingPrice: null,
    totalPrice: { amount, currency: 'RUB' },
    risk: 'safe',
  };
}

function direction(best: Journey | null, directBest: Journey | null = null): Direction {
  return { best, directBest, alternatives: [], date: '2026-09-11', shiftDays: 0, note: '' };
}

function guest(name: string, outbound: Direction, inbound: Direction | null = null): GuestPlan {
  return {
    name,
    city: name,
    status: outbound.best ? 'composed' : 'unreachable',
    outbound,
    inbound,
    totalPrice: outbound.best ? outbound.best.totalPrice : null,
    note: '',
  };
}

function plan(guests: GuestPlan[], returnDate: string | null = null): EventPlan {
  return {
    destination: 'Суздаль',
    endCity: 'Суздаль',
    date: '2026-09-11',
    returnDate,
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

describe('сколько гостей проходит', () => {
  const sample = plan(
    [
      guest('Аня', direction(journey(1000))),
      guest('Борис', direction(journey(2000, 'direct'), journey(2000, 'direct'))),
      guest('Вера', direction(null)),
    ],
    '2026-09-13',
  );

  it('со склейкой считаются все, у кого есть маршрут', () => {
    assert.equal(reachedCount(sample, 'composed', 'outbound'), 2);
  });

  it('в режиме Туту — только прямые', () => {
    assert.equal(reachedCount(sample, 'direct', 'outbound'), 1);
  });

  it('без обратного направления никто не проходит по нему', () => {
    assert.equal(reachedCount(sample, 'composed', 'inbound'), 0);
  });
});

describe('стоимость дороги', () => {
  it('без разъезда считается только дорога туда', () => {
    const sample = plan([guest('Аня', direction(journey(1000)), direction(journey(900)))]);
    assert.equal(travelCost(sample, 'composed'), 1000);
  });

  it('с разъездом складываются оба направления', () => {
    const sample = plan(
      [guest('Аня', direction(journey(1000)), direction(journey(900)))],
      '2026-09-13',
    );
    assert.equal(travelCost(sample, 'composed'), 1900);
  });

  it('в режиме Туту берутся только прямые варианты', () => {
    const sample = plan(
      [guest('Аня', direction(journey(1000), journey(1500, 'direct')), direction(journey(900)))],
      '2026-09-13',
    );
    // Обратного прямого нет — в сумму попадает только прямой «туда».
    assert.equal(travelCost(sample, 'direct'), 1500);
  });

  it('недостижимый гость ничего не добавляет', () => {
    const sample = plan([guest('Аня', direction(null)), guest('Борис', direction(journey(500)))]);
    assert.equal(travelCost(sample, 'composed'), 500);
  });
});

describe('скольких открывает склейка', () => {
  it('считается по показанному направлению, а не по полному кругу', () => {
    // Событие, откуда никто не уедет обратно: по кругу проходит ноль человек,
    // но доехать благодаря склейке могут двое — и это надо показать.
    const sample = plan(
      [
        guest('Аня', direction(journey(1000)), direction(null)),
        guest('Борис', direction(journey(2000)), direction(null)),
        guest('Вера', direction(journey(300, 'direct'), journey(300, 'direct')), direction(null)),
      ],
      '2026-09-13',
    );
    assert.equal(unlockedByComposition(sample, 'outbound'), 2);
  });

  it('когда все едут напрямую, склейка не добавляет никого', () => {
    const sample = plan([guest('Вера', direction(journey(300, 'direct'), journey(300, 'direct')))]);
    assert.equal(unlockedByComposition(sample, 'outbound'), 0);
  });
});

describe('нашлись ли обратные рейсы', () => {
  it('ни одного обратного маршрута — значит нет', () => {
    const sample = plan([guest('Аня', direction(journey(1000)), direction(null))], '2026-09-13');
    assert.equal(hasAnyReturn(sample), false);
  });

  it('хотя бы один обратный маршрут — значит есть', () => {
    const sample = plan(
      [guest('Аня', direction(journey(1000)), direction(null)), guest('Борис', direction(journey(1)), direction(journey(2)))],
      '2026-09-13',
    );
    assert.equal(hasAnyReturn(sample), true);
  });
});
