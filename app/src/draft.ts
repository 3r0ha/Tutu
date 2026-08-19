import type { Guest } from './types.ts';

/**
 * Черновик события в памяти браузера.
 *
 * Организатор набирает список гостей задолго до того, как всё решено:
 * уточняет даты, спорит о месте, возвращается через день. Потерять сорок
 * вставленных строк на перезагрузке — значит потерять пользователя, и вставка
 * списком эту цену только подняла.
 *
 * Хранится ровно то, что человек ввёл руками. Результаты расчётов сюда не
 * попадают: они живут минуты, зависят от живых цен и восстановлению не
 * подлежат — показывать их из вчерашнего кэша было бы враньём.
 */

const KEY = 'sklejka.draft';
const VERSION = 1;

export interface Draft {
  destination: string;
  endCity: string;
  date: string;
  returnDate: string;
  guests: Guest[];
}

interface StoredDraft extends Draft {
  version: number;
}

export function loadDraft(): Partial<Draft> | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredDraft;
    // Формат мог измениться между версиями — молча начинаем с чистого листа.
    if (parsed.version !== VERSION) return null;

    return {
      destination: asText(parsed.destination, 60),
      endCity: asText(parsed.endCity, 60),
      date: asDate(parsed.date),
      returnDate: asDate(parsed.returnDate),
      guests: asGuests(parsed.guests),
    };
  } catch {
    return null;
  }
}

export function saveDraft(draft: Draft): void {
  try {
    const payload: StoredDraft = { ...draft, version: VERSION };
    window.localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Приватный режим и переполненное хранилище — не повод ронять интерфейс.
  }
}

function asText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function asDate(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function asGuests(value: unknown): Guest[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (guest): guest is Guest =>
        typeof guest?.id === 'string' &&
        typeof guest?.name === 'string' &&
        typeof guest?.city === 'string' &&
        guest.city.trim() !== '',
    )
    .slice(0, 60)
    .map((guest) => ({
      id: guest.id.slice(0, 40),
      name: guest.name.slice(0, 60),
      city: guest.city.slice(0, 60),
    }));
}
