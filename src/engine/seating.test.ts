/**
 * Тесты подбора мест.
 *
 * Ответы Туту подменяются заглушкой: проверяется наша логика поверх них —
 * непересекающиеся блоки, добор одиночного места и разбивка автобусной
 * компании по пределу одного заказа.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { consecutiveRuns, planSeating } from './seating.ts';
import type { McpClient } from '../mcp/client.ts';

/** Заглушка клиента: отдаёт заранее заданный ответ на каждый инструмент. */
function stubClient(handlers: Record<string, (args: Record<string, unknown>) => unknown>): McpClient {
  return {
    async callToolSafe(tool: string, args: Record<string, unknown>) {
      return (handlers[tool]?.(args) ?? null) as never;
    },
  } as unknown as McpClient;
}

const RAIL_REF = { transport: 'railway', train_number: '146У' };
const BUS_REF = { transport: 'bus' };

function railGroup(car: string, seats: string[], compartment: number, price: number) {
  return {
    car_number: car,
    car_type: 'COMPARTMENT',
    service_class: '2К',
    compartment_number: compartment,
    seat_numbers: seats,
    seats: seats.map((number) => ({ number, type: 'LOWER' })),
    total_price: { amount: price, currency: 'RUB' },
    total_fare_type: 'REFUNDABLE',
    gender: 'NO_GENDER',
  };
}

describe('подбор мест в поезде', () => {
  it('компания влезает в один отсек', async () => {
    const mcp = stubClient({
      get_rail_seatmap: () => ({
        groups_by_car_type: { COMPARTMENT: [railGroup('5', ['1', '2', '3'], 1, 9000)] },
      }),
    });

    const plan = await planSeating(mcp, RAIL_REF, 3);
    assert.equal(plan.status, 'together');
    assert.equal(plan.seated, 3);
    assert.equal(plan.blocks.length, 1);
    assert.equal(plan.totalPrice?.amount, 9000);
  });

  it('выбирается самый дешёвый из доступных блоков', async () => {
    const mcp = stubClient({
      get_rail_seatmap: () => ({
        groups_by_car_type: {
          COMPARTMENT: [railGroup('7', ['1', '2'], 1, 12000), railGroup('5', ['3', '4'], 2, 8000)],
        },
      }),
    });

    const plan = await planSeating(mcp, RAIL_REF, 2);
    assert.equal(plan.blocks[0].carNumber, '5');
    assert.equal(plan.totalPrice?.amount, 8000);
  });

  it('одному пассажиру подбор не нужен', async () => {
    const plan = await planSeating(stubClient({}), RAIL_REF, 1);
    assert.equal(plan.status, 'unavailable');
    assert.equal(plan.blocks.length, 0);
  });

  it('молчание Туту не выдаётся за отсутствие мест', async () => {
    const plan = await planSeating(stubClient({}), RAIL_REF, 2);
    assert.equal(plan.status, 'unavailable');
    assert.match(plan.note, /не ответил/);
  });

  it('одна и та же группа не выдаётся дважды', async () => {
    // Туту отвечает на каждый запрос независимо и о нашем предыдущем выборе не
    // знает: на повторный вопрос он предложит ту же четвёрку. Компания из
    // восьми требует двух заходов — на втором брать её уже нельзя.
    const mcp = stubClient({
      get_rail_seatmap: (args) => {
        if (args.task === 'together') {
          return {
            largest_group_available: 4,
            groups_by_car_type: {},
            best_available_groups_by_car_type: {
              COMPARTMENT: [railGroup('11', ['33', '34', '35', '36'], 9, 29202)],
            },
          };
        }
        return { cars: [{ car_number: '11', seats: [] }] };
      },
    });

    const plan = await planSeating(mcp, RAIL_REF, 8);
    const numbers = plan.blocks.flatMap((block) => block.seats.map((seat) => seat.number));
    assert.equal(new Set(numbers).size, numbers.length, 'место выдано дважды');
    assert.equal(plan.seated, 4, 'посажено больше людей, чем есть непересекающихся мест');
    assert.equal(plan.status, 'partial');
  });

  it('одиночный остаток добирается по схеме вагона', async () => {
    const mcp = stubClient({
      get_rail_seatmap: (args) => {
        if (args.task === 'together') {
          return {
            largest_group_available: 4,
            groups_by_car_type: {},
            best_available_groups_by_car_type: {
              COMPARTMENT: [railGroup('11', ['33', '34', '35', '36'], 9, 29202)],
            },
          };
        }
        return { cars: [{ car_number: '11', car_type: 'COMPARTMENT', seats: [
          { number: '22', type: 'UPPER', compartment_number: 6, distance_to_nearest_wc_px: 344 },
          { number: '40', type: 'LOWER', compartment_number: 10, distance_to_nearest_wc_px: 95 },
        ] }] };
      },
    });

    const plan = await planSeating(mcp, RAIL_REF, 5);
    assert.equal(plan.seated, 5);
    assert.equal(plan.status, 'split');
    // Ближе к отсеку компании (9) стоит десятый, а не шестой.
    assert.equal(plan.blocks[1].seats[0].number, '40');
  });

  it('одиночному остатку место ищется в том же вагоне', async () => {
    const mcp = stubClient({
      get_rail_seatmap: (args) => {
        if (args.task === 'together') {
          return {
            largest_group_available: 2,
            groups_by_car_type: {},
            best_available_groups_by_car_type: { COMPARTMENT: [railGroup('4', ['1', '2'], 1, 5000)] },
          };
        }
        return { cars: [{ car_number: '4', seats: [{ number: '9', type: 'UPPER', compartment_number: 3 }] }] };
      },
    });

    const plan = await planSeating(mcp, RAIL_REF, 3);
    assert.equal(plan.seated, 3);
    assert.equal(plan.blocks[1].carNumber, '4');
    assert.equal(plan.blocks[1].seats[0].number, '9');
    // Цену одиночного места схема вагона не отдаёт — не выдумываем.
    assert.equal(plan.blocks[1].price, null);
  });
});

describe('подбор мест в автобусе', () => {
  const busDetails = (ids: string[], maxPerPurchase = 6) => ({
    get_offer_details: () => ({
      must_select_seat: true,
      seat_selection: { has_scheme: false, available_seat_ids: ids, max_per_purchase: maxPerPurchase },
    }),
  });

  it('подряд идущие номера считаются соседством', async () => {
    const plan = await planSeating(stubClient(busDetails(['1', '2', '3', '4'])), BUS_REF, 3);
    assert.equal(plan.status, 'together');
    assert.deepEqual(plan.blocks[0].seats.map((seat) => seat.number), ['1', '2', '3']);
    assert.match(plan.note, /схемы салона/i);
  });

  it('компания режется по пределу одного заказа', async () => {
    const ids = Array.from({ length: 12 }, (_, index) => String(index + 1));
    const plan = await planSeating(stubClient(busDetails(ids)), BUS_REF, 8);
    assert.equal(plan.status, 'split');
    assert.equal(plan.seated, 8);
    assert.deepEqual(plan.blocks.map((block) => block.seats.length), [6, 2]);
  });

  it('мест меньше, чем людей — честный отказ', async () => {
    const plan = await planSeating(stubClient(busDetails(['1', '2'])), BUS_REF, 4);
    assert.equal(plan.status, 'impossible');
    assert.match(plan.note, /меньше/);
  });

  it('у автобусного блока нет вагона', async () => {
    const plan = await planSeating(stubClient(busDetails(['5', '6'])), BUS_REF, 2);
    assert.equal(plan.blocks[0].carNumber, null);
  });
});

describe('группы подряд идущих мест', () => {
  it('длинные группы идут первыми', () => {
    assert.deepEqual(consecutiveRuns(['1', '2', '5', '7', '8', '9']), [
      ['7', '8', '9'],
      ['1', '2'],
      ['5'],
    ]);
  });

  it('порядок во входных данных не важен', () => {
    assert.deepEqual(consecutiveRuns(['9', '7', '8'])[0], ['7', '8', '9']);
  });

  it('нечисловые номера не теряются, но соседями не считаются', () => {
    const runs = consecutiveRuns(['1', '2', 'A1']);
    assert.deepEqual(runs[0], ['1', '2']);
    assert.ok(runs.some((run) => run.length === 1 && run[0] === 'A1'));
  });
});

const CHECKOUT_REF = { transport: 'railway', offer_hash: 'abc', segment_hash: 'def' };

describe('корзина с выбранными местами', () => {
  it('на каждый блок собирается своя корзина', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const mcp = stubClient({
      // Шестером в один отсек не влезть — компания разъезжается на два блока.
      get_rail_seatmap: (args) =>
        args.seats_together === 6
          ? {
              best_available_groups_by_car_type: {
                COMPARTMENT: [railGroup('5', ['1', '2', '3', '4'], 1, 8000)],
              },
              largest_group_available: 4,
            }
          : { groups_by_car_type: { COMPARTMENT: [railGroup('6', ['7', '8'], 3, 4000)] } },
      create_checkout_link: (args) => {
        calls.push(args);
        return { kind: 'checkout_deeplink', checkout_url: `https://tutu.ru/cart/${args.car_number}` };
      },
    });

    const plan = await planSeating(mcp, RAIL_REF, 6, CHECKOUT_REF);

    assert.equal(plan.blocks.length, 2);
    assert.deepEqual(
      plan.blocks.map((block) => block.cartUrl),
      ['https://tutu.ru/cart/5', 'https://tutu.ru/cart/6'],
    );
    // Места и тариф уходят в Туту вместе со ссылкой на оформление — иначе
    // корзина откроется по возвратному тарифу по умолчанию и на другие места.
    assert.deepEqual(calls[0].seat_numbers, ['1', '2', '3', '4']);
    assert.equal(calls[0].fare_type, 'REFUNDABLE');
    assert.equal(calls[0].offer_hash, 'abc');
  });

  it('обычный deeplink за корзину не выдаётся', async () => {
    const mcp = stubClient({
      get_rail_seatmap: () => ({
        groups_by_car_type: { COMPARTMENT: [railGroup('5', ['1', '2'], 1, 4000)] },
      }),
      // Такой ответ означает страницу выбора мест, а не корзину с нашими.
      create_checkout_link: () => ({ kind: 'deeplink', checkout_url: 'https://tutu.ru/order' }),
    });

    const plan = await planSeating(mcp, RAIL_REF, 2, CHECKOUT_REF);
    assert.equal(plan.blocks[0].cartUrl, null);
  });

  it('без ссылки на оформление подбор всё равно работает', async () => {
    const mcp = stubClient({
      get_rail_seatmap: () => ({
        groups_by_car_type: { COMPARTMENT: [railGroup('5', ['1', '2'], 1, 4000)] },
      }),
      create_checkout_link: () => assert.fail('корзину собирать не из чего'),
    });

    const plan = await planSeating(mcp, RAIL_REF, 2);
    assert.equal(plan.status, 'together');
    assert.equal(plan.blocks[0].cartUrl, null);
  });

  it('гендер купе передаётся только когда Туту его назвал', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const group = { ...railGroup('5', ['1', '2'], 1, 4000), gender: 'FEMALE' };
    const mcp = stubClient({
      get_rail_seatmap: () => ({ groups_by_car_type: { COMPARTMENT: [group] } }),
      create_checkout_link: (args) => {
        calls.push(args);
        return { kind: 'checkout_deeplink', checkout_url: 'https://tutu.ru/cart' };
      },
    });

    await planSeating(mcp, RAIL_REF, 2, CHECKOUT_REF);
    assert.equal(calls[0].gender_type, 'FEMALE');
  });
});
