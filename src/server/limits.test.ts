/**
 * Тесты ограничителя частоты.
 *
 * Проверяется то, что легко сломать незаметно: окно должно скользить, а не
 * обнуляться целиком, разные адреса не должны мешать друг другу, а заголовку
 * `X-Forwarded-For` нельзя верить, пока перед нами не поставлен свой прокси —
 * иначе ограничение обходится одной строкой в запросе.
 */

import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import { checkLimit, clientKey, resetLimits, type Limit } from './limits.ts';

const LIMIT: Limit = { name: 'test', quota: 3, windowMs: 1000 };
const OTHER: Limit = { name: 'other', quota: 3, windowMs: 1000 };

describe('ограничение частоты', () => {
  beforeEach(resetLimits);

  it('пропускает столько, сколько разрешено, и отказывает дальше', () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) {
      assert.equal(checkLimit('a', LIMIT, now).allowed, true, `запрос ${i + 1} должен пройти`);
    }
    assert.equal(checkLimit('a', LIMIT, now).allowed, false);
  });

  it('говорит, через сколько повторить', () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) checkLimit('a', LIMIT, now);
    const verdict = checkLimit('a', LIMIT, now + 400);
    assert.equal(verdict.allowed, false);
    // Самый старый запрос выпадет из окна через 600 мс — округляем вверх.
    assert.equal(verdict.retryAfterSec, 1);
  });

  it('окно скользит, а не сбрасывается разом', () => {
    const now = 1_000_000;
    checkLimit('a', LIMIT, now);
    checkLimit('a', LIMIT, now + 100);
    checkLimit('a', LIMIT, now + 200);
    assert.equal(checkLimit('a', LIMIT, now + 300).allowed, false);

    // Ушёл первый — освободилось ровно одно место, а не все три.
    assert.equal(checkLimit('a', LIMIT, now + 1050).allowed, true);
    assert.equal(checkLimit('a', LIMIT, now + 1060).allowed, false);
  });

  it('разные пределы не расходуют друг друга', () => {
    // Так и вышло у живого человека: восемь запросов при загрузке страницы
    // заняли квоту тяжёлого расчёта, и первая же попытка посчитать отбилась.
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) checkLimit('a', OTHER, now);
    assert.equal(checkLimit('a', OTHER, now).allowed, false);
    assert.equal(checkLimit('a', LIMIT, now).allowed, true, 'тяжёлый предел не должен зависеть от лёгкого');
  });

  it('адреса считаются раздельно', () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i += 1) checkLimit('a', LIMIT, now);
    assert.equal(checkLimit('a', LIMIT, now).allowed, false);
    assert.equal(checkLimit('b', LIMIT, now).allowed, true);
  });
});

describe('определение клиента', () => {
  it('без доверия к прокси заголовок игнорируется', () => {
    // Иначе ограничение обходится подстановкой случайного адреса в заголовок.
    assert.equal(clientKey('10.0.0.1', '203.0.113.9', false), '10.0.0.1');
  });

  it('с доверием берётся последний адрес цепочки', () => {
    // Первый прислал клиент и мог соврать; последний дописал наш прокси.
    assert.equal(clientKey('127.0.0.1', '203.0.113.9, 198.51.100.7', true), '198.51.100.7');
  });

  it('пустой заголовок не подменяет адрес соединения', () => {
    assert.equal(clientKey('10.0.0.1', '   ', true), '10.0.0.1');
  });

  it('неизвестный адрес не роняет счёт', () => {
    assert.equal(clientKey(undefined, undefined, true), 'unknown');
  });
});
