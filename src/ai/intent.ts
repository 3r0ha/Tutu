/**
 * Разбор свободного описания события в структуру.
 *
 * Это второе и последнее место, где работает модель. Организатор описывает
 * событие так, как рассказал бы коллеге — «свадьба в Суздале 12 сентября, гости
 * из Кирова, Казани и Питера», — вместо заполнения формы на десять полей.
 *
 * Продукт от этого не превращается в переписку: разобранная структура сразу
 * ложится в визуальный инструмент, где её правят мышью. Модель экономит первый
 * ввод, а не заменяет интерфейс.
 */

import { completeCached, extractJson, getProvider } from './provider.ts';

export interface ParsedGuest {
  name: string;
  city: string;
}

export interface ParsedEvent {
  destination: string | null;
  date: string | null;
  guests: ParsedGuest[];
  title: string | null;
}

interface RawParsedEvent {
  destination?: unknown;
  date?: unknown;
  title?: unknown;
  guests?: unknown;
}

function buildPrompt(text: string, today: string): string {
  return [
    `Разбери описание поездки или события в структуру.`,
    ``,
    `Сегодня ${today}. Относительные даты («в следующую субботу») переводи в абсолютные.`,
    ``,
    `Описание:`,
    `"""`,
    text.slice(0, 2000),
    `"""`,
    ``,
    `Верни строго JSON без пояснений:`,
    `{"title": "краткое название или null",`,
    ` "destination": "город проведения или null",`,
    ` "date": "YYYY-MM-DD или null",`,
    ` "guests": [{"name": "имя или город, если имени нет", "city": "город выезда"}]}`,
    ``,
    `Правила:`,
    `- Города — реальные российские названия в именительном падеже.`,
    `- «Питер» → «Санкт-Петербург», «Мск» → «Москва», «Нижний» → «Нижний Новгород».`,
    `- Если про гостя сказано «трое из Казани» — создай трёх гостей с city «Казань».`,
    `- Ничего не выдумывай: чего в тексте нет, то null или пустой список.`,
  ].join('\n');
}

export async function parseEventIntent(text: string, today: string): Promise<ParsedEvent | null> {
  if (getProvider().name === 'none') return null;

  const raw = await completeCached(`intent:v1:${today}:${text}`, buildPrompt(text, today));
  const parsed = extractJson<RawParsedEvent>(raw);
  if (!parsed) return null;

  return {
    title: asCleanString(parsed.title, 80),
    destination: asCleanString(parsed.destination, 60),
    date: asIsoDate(parsed.date),
    guests: asGuests(parsed.guests),
  };
}

function asCleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || trimmed.toLowerCase() === 'null') return null;
  return trimmed;
}

/** Модель охотно возвращает дату в вольном формате — принимаем только строгий ISO. */
function asIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const parsed = new Date(`${value.trim()}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : value.trim();
}

function asGuests(value: unknown): ParsedGuest[] {
  if (!Array.isArray(value)) return [];

  const guests: ParsedGuest[] = [];
  for (const entry of value.slice(0, 60)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const city = asCleanString(record.city, 60);
    if (!city) continue;
    guests.push({ name: asCleanString(record.name, 60) ?? city, city });
  }

  return guests;
}
