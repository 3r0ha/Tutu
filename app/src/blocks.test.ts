/**
 * Тесты правил блоков.
 *
 * Главное здесь — что гостю не покажется блок, из которого организатор вычистил
 * текст: он его не удалял, но и содержимого в нём не осталось.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { isBlockEmpty, normalizeBlocks, defaultBlocks, type Block } from './blocks.ts';

const stay: Block = {
  id: 'b1', kind: 'stay', heading: '', sort: 'rating', hotelName: '',
  address: null, rating: null, reviewCount: null, price: null, nights: null,
  quote: null, quoteDate: null, url: null,
};

describe('пустые блоки', () => {
  it('текст без заголовка и тела считается пустым', () => {
    assert.equal(isBlockEmpty({ id: 'b', kind: 'text', heading: '  ', body: '\n' }), true);
  });

  it('текст с одним заголовком не пустой', () => {
    assert.equal(isBlockEmpty({ id: 'b', kind: 'text', heading: 'О дне', body: '' }), false);
  });

  it('программа из пустых строк считается пустой', () => {
    assert.equal(
      isBlockEmpty({ id: 'b', kind: 'schedule', heading: 'Программа', items: [{ time: '', text: '' }] }),
      true,
    );
  });

  it('программа с одной заполненной строкой не пустая', () => {
    assert.equal(
      isBlockEmpty({ id: 'b', kind: 'schedule', heading: '', items: [{ time: '16:00', text: '' }] }),
      false,
    );
  });

  it('картинка без файла пустая', () => {
    assert.equal(isBlockEmpty({ id: 'b', kind: 'image', src: '', caption: 'Подпись' }), true);
  });

  it('блоки с собственным поведением пустыми не считаются', () => {
    // Их ценность не в тексте: дорога считает маршрут, жильё показывает варианты.
    assert.equal(isBlockEmpty({ id: 'b', kind: 'route', heading: '', lead: '' }), false);
    assert.equal(isBlockEmpty({ id: 'b', kind: 'rsvp', heading: '', lead: '' }), false);
    assert.equal(isBlockEmpty(stay), false);
  });
});

describe('проверка блоков с клиента', () => {
  it('неизвестный тип отбрасывается', () => {
    assert.equal(normalizeBlocks([{ kind: 'script', body: 'alert(1)' }]).length, 0);
  });

  it('чужая ссылка на картинку не принимается', () => {
    const [block] = normalizeBlocks([{ kind: 'image', src: 'https://evil.example/x.png', caption: '' }]);
    assert.equal((block as { src: string }).src, '');
  });

  it('свой адрес картинки проходит', () => {
    const [block] = normalizeBlocks([{ kind: 'image', src: '/uploads/abc123.png', caption: '' }]);
    assert.equal((block as { src: string }).src, '/uploads/abc123.png');
  });

  it('ссылка с javascript: отвергается', () => {
    const [block] = normalizeBlocks([{ ...stay, url: 'javascript:alert(1)' }]);
    assert.equal((block as { url: string | null }).url, null);
  });

  it('длинный текст обрезается', () => {
    const [block] = normalizeBlocks([{ kind: 'text', heading: 'x'.repeat(500), body: '' }]);
    assert.equal((block as { heading: string }).heading.length, 120);
  });

  it('набор по умолчанию содержит обложку и дорогу', () => {
    const kinds = defaultBlocks().map((block) => block.kind);
    assert.ok(kinds.includes('cover'));
    assert.ok(kinds.includes('route'));
  });
});
