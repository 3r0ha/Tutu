/**
 * Тесты склейки.
 *
 * Проверяется то, что за время разработки ломалось на живых данных: окно
 * пересадки, признак ночи, счёт запасных рейсов и плечо без времени прибытия.
 * Сеть не нужна — вся логика здесь чистая.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  assessRisk,
  buildJourney,
  feasibleConnections,
  minConnectMinutes,
  nightBetween,
} from './compose.ts';
import type { Hop } from '../domain/types.ts';

/**
 * Точка стыковки по умолчанию.
 *
 * Плечи в фикстурах сходятся в одном вокзале, чтобы тесты про время проверяли
 * именно время: смена вокзала добавляет к окну пересадки надбавку на переезд
 * по городу, и без этого умолчания она подмешивалась бы в каждую проверку.
 */
const HUB = 'Москва — Казанский вокзал';

function hop(overrides: Partial<Hop> = {}): Hop {
  return {
    mode: 'railway',
    fromCity: 'Москва',
    toCity: 'Казань',
    fromPoint: HUB,
    toPoint: HUB,
    departureAt: '2026-09-11T10:00:00+03:00',
    arrivalAt: '2026-09-11T18:00:00+03:00',
    durationMin: 480,
    price: { amount: 1000, currency: 'RUB' },
    priceBasis: 'party' as const,
    pricePerSeat: null,
    carriers: ['ФПК'],
    segmentsCount: 1,
    searchResultsUrl: null,
    checkoutUrl: null,
    detailsRef: null,
    checkoutRef: null,
    review: null,
    vehicle: null,
    classes: null,
    ...overrides,
  };
}

describe('минимальное окно пересадки', () => {
  it('наземной пересадке хватает часа', () => {
    assert.equal(minConnectMinutes(hop(), hop({ mode: 'bus' })), 60);
  });

  it('самолёт требует запаса на дорогу через город', () => {
    assert.equal(minConnectMinutes(hop({ mode: 'avia' }), hop({ mode: 'bus' })), 120);
    assert.equal(minConnectMinutes(hop(), hop({ mode: 'avia' })), 120);
  });

  it('смена вокзала добавляет запас на переезд', () => {
    const arrive = hop({ toPoint: 'Москва — Ленинградский вокзал (2006004)' });
    const depart = hop({ mode: 'bus', fromPoint: 'Автовокзал Центральный (Щёлковский)' });
    assert.equal(minConnectMinutes(arrive, depart), 60 + 90);
  });

  it('надбавка складывается с самолётной', () => {
    const arrive = hop({ mode: 'avia', toPoint: 'Москва — Шереметьево (SVO)' });
    const depart = hop({ mode: 'avia', fromPoint: 'Москва — Внуково (VKO)' });
    assert.equal(minConnectMinutes(arrive, depart), 120 + 90);
  });

  it('неназванная точка переездом не считается', () => {
    // Пустое поле не доказывает переезда, а надбавка за него отбросила бы
    // живые маршруты — молча и без возможности это заметить.
    assert.equal(minConnectMinutes(hop({ toPoint: '' }), hop({ mode: 'bus' })), 60);
  });
});

describe('переезд между вокзалами', () => {
  it('пересадка со сменой вокзала называет обе точки', () => {
    const arrive = hop({
      arrivalAt: '2026-09-11T12:00:00+03:00',
      toPoint: 'Москва — Ленинградский вокзал (2006004)',
    });
    const depart = hop({
      mode: 'bus',
      departureAt: '2026-09-11T15:00:00+03:00',
      fromPoint: 'Автовокзал Центральный (Щёлковский)',
    });

    const journey = buildJourney(
      feasibleConnections('Москва', [arrive], [depart])[0],
      { level: 'safe', fallbacksLater: 3, nextFallbackAt: null, note: '' },
      null,
    );

    assert.deepEqual(journey.transfers[0].move, {
      from: 'Москва — Ленинградский вокзал (2006004)',
      to: 'Автовокзал Центральный (Щёлковский)',
    });
  });

  it('пересадка внутри вокзала переездом не помечается', () => {
    const arrive = hop({ arrivalAt: '2026-09-11T12:00:00+03:00' });
    const depart = hop({ mode: 'bus', departureAt: '2026-09-11T15:00:00+03:00' });

    const journey = buildJourney(
      feasibleConnections('Москва', [arrive], [depart])[0],
      { level: 'safe', fallbacksLater: 3, nextFallbackAt: null, note: '' },
      null,
    );

    assert.equal(journey.transfers[0].move, null);
  });
});

describe('признак ночи в окне пересадки', () => {
  it('ночь засчитывается, когда пассажир в городе в три часа', () => {
    const night = nightBetween('2026-09-11T20:49:00+03:00', '2026-09-12T08:00:00+03:00');
    assert.deepEqual(night, { checkIn: '2026-09-11', checkOut: '2026-09-12' });
  });

  it('дневное ожидание ночью не считается, какой бы длины ни было', () => {
    assert.equal(nightBetween('2026-09-11T06:00:00+03:00', '2026-09-11T20:00:00+03:00'), null);
  });

  it('короткая пересадка через полночь всё равно ночь', () => {
    assert.notEqual(nightBetween('2026-09-11T23:30:00+03:00', '2026-09-12T05:00:00+03:00'), null);
  });

  it('ответ не зависит от часового пояса машины', () => {
    // Считалось через `setHours`, то есть в поясе сервера: у меня выходило
    // московское время, на сборочной — UTC, на стенде — центральноевропейское,
    // и один маршрут получал разный ответ про ночёвку. Три часа ночи — это
    // три часа ночи там, где человек ждёт.
    const owl = () => nightBetween('2026-09-11T23:30:00+03:00', '2026-09-12T05:00:00+03:00');
    const day = () => nightBetween('2026-09-11T06:00:00+03:00', '2026-09-11T20:00:00+03:00');

    const saved = process.env.TZ;
    try {
      const answers = ['UTC', 'Europe/Moscow', 'Asia/Vladivostok', 'America/New_York'].map((zone) => {
        process.env.TZ = zone;
        return JSON.stringify([owl(), day()]);
      });
      assert.equal(new Set(answers).size, 1, `в разных поясах разные ответы: ${answers.join(' | ')}`);
    } finally {
      process.env.TZ = saved;
    }
  });

  it('время дальневосточного рейса читается как местное', () => {
    // Владивосток +10: прибытие в 22:00 и отправление в 08:00 — это ночь,
    // хотя в UTC те же моменты приходятся на день.
    const night = nightBetween('2026-09-11T22:00:00+10:00', '2026-09-12T08:00:00+10:00');
    assert.deepEqual(night, { checkIn: '2026-09-11', checkOut: '2026-09-12' });
  });
});

describe('допустимые пары плеч', () => {
  const inbound = hop({ arrivalAt: '2026-09-11T12:00:00+03:00' });

  it('слишком тесная стыковка отбрасывается', () => {
    const outbound = hop({ mode: 'bus', departureAt: '2026-09-11T12:30:00+03:00' });
    assert.equal(feasibleConnections('Москва', [inbound], [outbound]).length, 0);
  });

  it('часовое окно для наземной пересадки годится', () => {
    const outbound = hop({ mode: 'bus', departureAt: '2026-09-11T13:05:00+03:00' });
    const found = feasibleConnections('Москва', [inbound], [outbound]);
    assert.equal(found.length, 1);
    assert.equal(found[0].waitMin, 65);
    assert.equal(found[0].needsLodging, false);
  });

  it('ожидание дольше суток пересадкой не считается', () => {
    const outbound = hop({ mode: 'bus', departureAt: '2026-09-12T18:00:00+03:00' });
    assert.equal(feasibleConnections('Москва', [inbound], [outbound]).length, 0);
  });

  it('долгое ожидание через ночь требует ночёвки', () => {
    const late = hop({ arrivalAt: '2026-09-11T20:49:00+03:00' });
    const morning = hop({ mode: 'bus', departureAt: '2026-09-12T08:00:00+03:00' });
    const found = feasibleConnections('Москва', [late], [morning]);
    assert.equal(found.length, 1);
    assert.equal(found[0].needsLodging, true);
    assert.deepEqual(found[0].lodgingNight, { checkIn: '2026-09-11', checkOut: '2026-09-12' });
  });

  it('плечо без времени прибытия не может быть промежуточным', () => {
    // Рейс Мурманск→Териберка продаётся, но прибытия у него нет: последним
    // плечом он годится, первым — нет, окно пересадки считать не из чего.
    const noArrival = hop({ arrivalAt: null, durationMin: null });
    const outbound = hop({ mode: 'bus', departureAt: '2026-09-11T23:00:00+03:00' });
    assert.equal(feasibleConnections('Мурманск', [noArrival], [outbound]).length, 0);
  });

  it('плечо без времени прибытия годится последним', () => {
    const outbound = hop({ mode: 'bus', departureAt: '2026-09-11T18:00:00+03:00', arrivalAt: null });
    assert.equal(feasibleConnections('Мурманск', [inbound], [outbound]).length, 1);
  });
});

describe('оценка риска пересадки', () => {
  const connection = feasibleConnections(
    'Москва',
    [hop({ arrivalAt: '2026-09-11T12:00:00+03:00' })],
    [hop({ mode: 'bus', departureAt: '2026-09-11T14:00:00+03:00' })],
  )[0];

  it('без запасных рейсов пересадка критическая', () => {
    const risk = assessRisk(connection, [connection.outbound]);
    assert.equal(risk.level, 'critical');
    assert.equal(risk.fallbacksLater, 0);
    assert.equal(risk.nextFallbackAt, null);
  });

  it('единственный запасной рейс — это ещё впритык', () => {
    const later = hop({ mode: 'bus', departureAt: '2026-09-11T18:00:00+03:00' });
    const risk = assessRisk(connection, [connection.outbound, later]);
    assert.equal(risk.level, 'tight');
    assert.equal(risk.fallbacksLater, 1);
  });

  it('несколько запасных рейсов делают пересадку спокойной', () => {
    const later = [15, 16, 17, 18].map((hour) =>
      hop({ mode: 'bus', departureAt: `2026-09-11T${hour}:00:00+03:00` }),
    );
    const risk = assessRisk(connection, [connection.outbound, ...later]);
    assert.equal(risk.level, 'safe');
    assert.equal(risk.fallbacksLater, 4);
  });

  it('время в подсказке берётся в зоне отправления, а не сервера', () => {
    // Подсказка «ближайший — 14:00» обязана совпадать с данными в том же
    // ответе; прогон через Date пересчитывал её в часовой пояс машины.
    const later = hop({ mode: 'bus', departureAt: '2026-09-11T18:00:00+03:00' });
    const risk = assessRisk(connection, [connection.outbound, later]);
    assert.match(risk.note, /18:00/);
  });
});
