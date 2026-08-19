/**
 * Тесты раскладки подписей.
 *
 * Проверяется главное свойство: подписи не перекрывают друг друга. Города
 * рядом — обычное дело, и Москва с Коломной на одной карте читались как каша.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { placeLabels, TARGET_SLOTS, type LabelPlacement } from './mapLabels.ts';

/** Приблизительная рамка подписи — та же оценка, что и в самой раскладке. */
function box(text: string, at: LabelPlacement, scale = 1) {
  const width = text.length * 6.3 * scale;
  const left = at.anchor === 'middle' ? at.x - width / 2 : at.anchor === 'start' ? at.x : at.x - width;
  return { left, right: left + width, top: at.y - 13 * scale, bottom: at.y };
}

function intersects(a: ReturnType<typeof box>, b: ReturnType<typeof box>): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

describe('раскладка подписей', () => {
  it('одинокая подпись встаёт под точкой', () => {
    const placed = placeLabels([{ key: 'a', text: 'Москва', at: { x: 100, y: 100 } }]);
    const label = placed.get('a')!;
    assert.equal(label.anchor, 'middle');
    assert.ok(label.y > 100, 'подпись должна быть ниже точки');
  });

  it('две точки в одном месте получают разные позиции', () => {
    const placed = placeLabels([
      { key: 'a', text: 'Москва', at: { x: 200, y: 200 } },
      { key: 'b', text: 'Коломна', at: { x: 206, y: 203 } },
    ]);

    const first = placed.get('a')!;
    const second = placed.get('b')!;
    assert.notDeepEqual(first, second);
    assert.ok(
      !intersects(box('Москва', first), box('Коломна', second)),
      'подписи перекрываются',
    );
  });

  it('плотная группа городов разводится без единого пересечения', () => {
    const cities = ['Москва', 'Коломна', 'Тула', 'Рязань', 'Калуга', 'Тверь'];
    const placed = placeLabels(
      cities.map((text, index) => ({
        key: text,
        text,
        at: { x: 300 + (index % 2) * 9, y: 300 + index * 7 },
      })),
    );

    const boxes = cities.map((text) => box(text, placed.get(text)!));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        assert.ok(!intersects(boxes[i], boxes[j]), `${cities[i]} перекрывает ${cities[j]}`);
      }
    }
  });

  it('первый в списке получает приоритетную позицию', () => {
    // Порядок обхода задаёт важность: место события важнее гостей.
    const placed = placeLabels([
      { key: 'важный', text: 'Суздаль', at: { x: 100, y: 100 } },
      { key: 'обычный', text: 'Иваново', at: { x: 100, y: 100 } },
    ]);
    assert.equal(placed.get('важный')!.y, 122);
    assert.notEqual(placed.get('обычный')!.y, 122);
  });

  it('место события подписывается над точкой, не задевая кольца', () => {
    const placed = placeLabels([
      { key: '@target', text: 'Суздаль', at: { x: 100, y: 100 }, scale: 1.2, slots: TARGET_SLOTS },
    ]);
    assert.ok(placed.get('@target')!.y < 100 - 25, 'подпись должна стоять выше колец');
  });

  it('когда свободных позиций нет, подпись всё равно возвращается', () => {
    // Лучше наложение, чем пропавший город: пустое место читается как ошибка.
    const many = Array.from({ length: 12 }, (_, index) => ({
      key: `city${index}`,
      text: 'Город',
      at: { x: 100, y: 100 },
    }));
    const placed = placeLabels(many);
    assert.equal(placed.size, 12);
  });
});
