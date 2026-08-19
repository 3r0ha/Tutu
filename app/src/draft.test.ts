/**
 * Тесты черновика события.
 *
 * Восстановление идёт из хранилища браузера, куда мог попасть мусор от старой
 * версии или чужой записи, поэтому проверяется устойчивость к битым данным:
 * лучше пустой черновик, чем сломанный экран.
 */

import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import { loadDraft, saveDraft } from './draft.ts';

/** Минимальная замена localStorage: браузерного окружения в тестах нет. */
function stubStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
}

const sample = {
  destination: 'Суздаль',
  endCity: '',
  date: '2026-09-11',
  returnDate: '2026-09-13',
  guests: [{ id: 'g1', name: 'Аня', city: 'Киров' }],
};

describe('черновик события', () => {
  beforeEach(stubStorage);

  it('пустое хранилище даёт пустой результат', () => {
    assert.equal(loadDraft(), null);
  });

  it('сохранённое возвращается целиком', () => {
    saveDraft(sample);
    assert.deepEqual(loadDraft(), sample);
  });

  it('битый JSON не роняет восстановление', () => {
    (globalThis as { window: { localStorage: Storage } }).window.localStorage.setItem(
      'sklejka.draft',
      '{не json',
    );
    assert.equal(loadDraft(), null);
  });

  it('черновик чужой версии игнорируется', () => {
    (globalThis as { window: { localStorage: Storage } }).window.localStorage.setItem(
      'sklejka.draft',
      JSON.stringify({ ...sample, version: 999 }),
    );
    assert.equal(loadDraft(), null);
  });

  it('гости без города отбрасываются', () => {
    saveDraft({
      ...sample,
      guests: [
        { id: 'g1', name: 'Аня', city: 'Киров' },
        { id: 'g2', name: 'Пустой', city: '  ' },
      ],
    });
    assert.equal(loadDraft()?.guests?.length, 1);
  });

  it('дата в неверном формате не восстанавливается', () => {
    saveDraft({ ...sample, date: '11.09.2026' });
    assert.equal(loadDraft()?.date, '');
  });

  it('чрезмерно длинный список обрезается', () => {
    const many = Array.from({ length: 200 }, (_, index) => ({
      id: `g${index}`,
      name: `Гость ${index}`,
      city: 'Москва',
    }));
    saveDraft({ ...sample, guests: many });
    assert.equal(loadDraft()?.guests?.length, 60);
  });
});
