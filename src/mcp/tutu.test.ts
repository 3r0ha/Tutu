/**
 * Тесты перевода ответов Туту в доменные плечи.
 *
 * Главное здесь — цена. Туту отдаёт её по-разному: у самолёта и автобуса она
 * покрывает всю запрошенную компанию, у поезда и электрички это стоимость
 * одного самого дешёвого места. Пока гость ездил один, разница не проявлялась,
 * а на двоих сумма переставала означать что-либо: часть слагаемых была за
 * компанию, часть — за человека.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { searchLeg } from './tutu.ts';
import type { McpClient } from './client.ts';

function stub(variants: unknown[]): McpClient {
  return {
    async callToolSafe() {
      return { variants, meta: { from: { name: 'Москва' }, to: { name: 'Казань' } } } as never;
    },
  } as unknown as McpClient;
}

function variant(transport: string, amount: number) {
  return {
    transport,
    price: { amount, currency: 'RUB' },
    departure_at: '2026-09-11T10:00:00+03:00',
    arrival_at: '2026-09-11T18:00:00+03:00',
    legs: [{ from: 'Москва — Казанский вокзал', to: 'Казань Пасс' }],
  };
}

describe('цена плеча приводится к сумме за компанию', () => {
  it('цена поезда умножается на число пассажиров', async () => {
    const leg = await searchLeg(stub([variant('railway', 2090.93)]), 'Москва', 'Казань', '2026-09-11', {
      adults: 3,
    });

    const hop = leg!.hops[0];
    assert.equal(hop.price.amount, 6272.79);
    assert.equal(hop.pricePerSeat, 2090.93);
    assert.equal(hop.priceBasis, 'per_seat');
  });

  it('электричка считается так же', async () => {
    const leg = await searchLeg(stub([variant('etrain', 490)]), 'Москва', 'Казань', '2026-09-11', {
      adults: 2,
    });

    assert.equal(leg!.hops[0].price.amount, 980);
  });

  it('цена самолёта остаётся как есть — она уже за всех', async () => {
    const leg = await searchLeg(stub([variant('avia', 12188)]), 'Москва', 'Казань', '2026-09-11', {
      adults: 4,
    });

    const hop = leg!.hops[0];
    assert.equal(hop.price.amount, 12188);
    assert.equal(hop.pricePerSeat, null);
    assert.equal(hop.priceBasis, 'party');
  });

  it('автобус тоже приходит за всю компанию', async () => {
    const leg = await searchLeg(stub([variant('bus', 4400)]), 'Москва', 'Казань', '2026-09-11', {
      adults: 2,
    });

    assert.equal(leg!.hops[0].price.amount, 4400);
  });

  it('для одного пассажира ничего не меняется', async () => {
    const leg = await searchLeg(
      stub([variant('railway', 2090.93), variant('avia', 3047)]),
      'Москва',
      'Казань',
      '2026-09-11',
    );

    assert.deepEqual(
      leg!.hops.map((hop) => hop.price.amount),
      [2090.93, 3047],
    );
  });
});
