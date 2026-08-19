/**
 * Тесты мягкого срока.
 *
 * Здесь важна не столько скорость, сколько её цена: срок, применённый не к той
 * части работы, превращает «мы не дождались» в «доехать нельзя». Тесты
 * фиксируют обе стороны — что отстающих бросаем и что их места остаются
 * пустыми, а не выдуманными.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { settleSoft } from './settle.ts';

const after = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe('ожидание с мягким сроком', () => {
  it('пустой список возвращается сразу', async () => {
    assert.deepEqual(await settleSoft([], { deadlineMs: 10, minResults: 1 }), []);
  });

  it('когда все успевают, срок ни на что не влияет', async () => {
    const results = await settleSoft([after(1, 'a'), after(2, 'b')], {
      deadlineMs: 500,
      minResults: 1,
    });
    assert.deepEqual(results, ['a', 'b']);
  });

  it('порядок ответов сохраняется по позиции задачи, а не по времени', async () => {
    const results = await settleSoft([after(40, 'медленный'), after(1, 'быстрый')], {
      deadlineMs: 500,
      minResults: 2,
    });
    assert.deepEqual(results, ['медленный', 'быстрый']);
  });

  it('отстающий отбрасывается, его место остаётся пустым', async () => {
    const results = await settleSoft([after(1, 'быстрый'), after(5000, 'отставший')], {
      deadlineMs: 30,
      minResults: 1,
    });
    assert.deepEqual(results, ['быстрый', null]);
  });

  it('срок не срабатывает, пока не набран обязательный минимум', async () => {
    const startedAt = Date.now();
    const results = await settleSoft([after(120, 'нужный'), after(5000, 'отставший')], {
      deadlineMs: 10,
      minResults: 1,
    });
    // Минимум равен единице, а к сроку не ответил никто — значит ждём первого.
    assert.deepEqual(results, ['нужный', null]);
    assert.ok(Date.now() - startedAt >= 100, 'вернулись раньше, чем пришёл обязательный ответ');
  });

  it('отказ неотличим от неуспевшего — и то и другое пустое место', async () => {
    const results = await settleSoft([Promise.reject(new Error('сбой')), after(1, 'ок')], {
      deadlineMs: 200,
      minResults: 2,
    });
    assert.deepEqual(results, [null, 'ок']);
  });
});
