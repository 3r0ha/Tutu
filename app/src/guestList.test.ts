/**
 * Тесты разбора вставленного списка гостей.
 *
 * Проверяются те формы записи, в которых люди действительно ведут списки:
 * таблица из буфера, заметка с тире, нумерованный перечень.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { parseGuestList } from './guestList.ts';

describe('разбор списка гостей', () => {
  it('запятая как разделитель', () => {
    assert.deepEqual(parseGuestList('Аня, Киров\nБорис, Казань'), [
      { name: 'Аня', city: 'Киров' },
      { name: 'Борис', city: 'Казань' },
    ]);
  });

  it('табуляция — так вставляется из таблицы', () => {
    assert.deepEqual(parseGuestList('Аня\tКиров'), [{ name: 'Аня', city: 'Киров' }]);
  });

  it('тире любого начертания', () => {
    assert.deepEqual(parseGuestList('Аня — Киров\nБорис – Казань\nВера - Москва'), [
      { name: 'Аня', city: 'Киров' },
      { name: 'Борис', city: 'Казань' },
      { name: 'Вера', city: 'Москва' },
    ]);
  });

  it('город в скобках', () => {
    assert.deepEqual(parseGuestList('Аня (Киров)'), [{ name: 'Аня', city: 'Киров' }]);
  });

  it('маркеры и нумерация списка отбрасываются', () => {
    assert.deepEqual(parseGuestList('1. Аня, Киров\n— Борис, Казань\n• Вера, Москва'), [
      { name: 'Аня', city: 'Киров' },
      { name: 'Борис', city: 'Казань' },
      { name: 'Вера', city: 'Москва' },
    ]);
  });

  it('одинокое слово считается городом', () => {
    // Имя без города бесполезно, город без имени вполне работает.
    assert.deepEqual(parseGuestList('Казань'), [{ name: 'Казань', city: 'Казань' }]);
  });

  it('пустые строки и пробелы не мешают', () => {
    assert.deepEqual(parseGuestList('\n\n  Аня, Киров  \n\n'), [{ name: 'Аня', city: 'Киров' }]);
  });

  it('повтор той же строки отбрасывается', () => {
    assert.deepEqual(parseGuestList('Аня, Киров\nаня, киров'), [{ name: 'Аня', city: 'Киров' }]);
  });

  it('однофамильцы из разных городов остаются оба', () => {
    assert.deepEqual(parseGuestList('Аня, Киров\nАня, Казань'), [
      { name: 'Аня', city: 'Киров' },
      { name: 'Аня', city: 'Казань' },
    ]);
  });

  it('составные названия не рвутся по внутреннему дефису', () => {
    assert.deepEqual(parseGuestList('Глеб, Санкт-Петербург\nДина, Ростов-на-Дону'), [
      { name: 'Глеб', city: 'Санкт-Петербург' },
      { name: 'Дина', city: 'Ростов-на-Дону' },
    ]);
  });

  it('лишние столбцы игнорируются', () => {
    assert.deepEqual(parseGuestList('Аня, Киров, +7 900 000-00-00'), [
      { name: 'Аня', city: 'Киров' },
    ]);
  });

  it('пустой текст даёт пустой список', () => {
    assert.deepEqual(parseGuestList('   \n  '), []);
  });
});
