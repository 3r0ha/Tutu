/**
 * Координаты населённых пунктов для карты.
 *
 * Ресурс `tutu://geo` содержит два города, а рисовать нужно любые, включая малые
 * — именно они и есть основной сценарий продукта. Поэтому таблица своя, а для
 * промахов подключается модель.
 *
 * Координаты влияют только на положение точки на экране. Ни одно решение о
 * маршруте на них не опирается — там источником истины остаются ответы Туту, —
 * поэтому неточность подсказанной моделью широты стоит смещения кружка,
 * а не неверного совета.
 */

import { HUBS } from './hubs.ts';
import { completeCached, extractJson, getProvider } from '../ai/provider.ts';

export interface Coordinates {
  lat: number;
  lon: number;
  source: 'catalog' | 'ai';
}

/** Малые города — то, ради чего продукт и существует, поэтому они заданы явно. */
const SMALL_TOWNS: ReadonlyArray<{ name: string; lat: number; lon: number }> = [
  { name: 'Суздаль', lat: 56.42, lon: 40.45 },
  { name: 'Плёс', lat: 57.46, lon: 41.51 },
  { name: 'Мышкин', lat: 57.79, lon: 38.45 },
  { name: 'Углич', lat: 57.53, lon: 38.32 },
  { name: 'Ростов', lat: 57.19, lon: 39.42 },
  { name: 'Переславль-Залесский', lat: 56.74, lon: 38.86 },
  { name: 'Гороховец', lat: 56.2, lon: 42.69 },
  { name: 'Муром', lat: 55.57, lon: 42.05 },
  { name: 'Выборг', lat: 60.71, lon: 28.75 },
  { name: 'Териберка', lat: 69.16, lon: 35.14 },
  { name: 'Кириллов', lat: 59.86, lon: 38.38 },
  { name: 'Тобольск', lat: 58.2, lon: 68.25 },
  { name: 'Елабуга', lat: 55.76, lon: 52.06 },
  { name: 'Свияжск', lat: 55.77, lon: 48.66 },
  { name: 'Торжок', lat: 57.04, lon: 34.96 },
  { name: 'Старая Русса', lat: 57.99, lon: 31.36 },
  { name: 'Изборск', lat: 57.71, lon: 27.86 },
  { name: 'Печоры', lat: 57.81, lon: 27.61 },
  { name: 'Сортавала', lat: 61.7, lon: 30.69 },
  { name: 'Кемь', lat: 64.95, lon: 34.59 },
  { name: 'Каргополь', lat: 61.51, lon: 38.95 },
  { name: 'Дербент', lat: 42.06, lon: 48.29 },
  { name: 'Азов', lat: 47.11, lon: 39.42 },
  { name: 'Таганрог', lat: 47.22, lon: 38.9 },
  { name: 'Анапа', lat: 44.89, lon: 37.32 },
  { name: 'Геленджик', lat: 44.56, lon: 38.08 },
  { name: 'Кисловодск', lat: 43.91, lon: 42.72 },
  { name: 'Пятигорск', lat: 44.05, lon: 43.06 },
  { name: 'Домбай', lat: 43.29, lon: 41.62 },
  { name: 'Шерегеш', lat: 52.92, lon: 87.96 },
  { name: 'Листвянка', lat: 51.85, lon: 104.87 },
  { name: 'Валдай', lat: 57.98, lon: 33.25 },
  { name: 'Коломна', lat: 55.09, lon: 38.77 },
  { name: 'Зарайск', lat: 54.76, lon: 38.87 },
  { name: 'Таруса', lat: 54.72, lon: 37.17 },
  { name: 'Боровск', lat: 55.21, lon: 36.49 },
  { name: 'Дмитров', lat: 56.34, lon: 37.52 },
  { name: 'Сергиев Посад', lat: 56.31, lon: 38.13 },
  { name: 'Александров', lat: 56.39, lon: 38.71 },
  { name: 'Юрьев-Польский', lat: 56.5, lon: 39.68 },
];

const TABLE = new Map<string, Coordinates>();
for (const hub of HUBS) {
  TABLE.set(normalize(hub.name), { lat: hub.lat, lon: hub.lon, source: 'catalog' });
}
for (const town of SMALL_TOWNS) {
  TABLE.set(normalize(town.name), { lat: town.lat, lon: town.lon, source: 'catalog' });
}

const resolved = new Map<string, Coordinates | null>();

export async function resolveCoordinates(city: string): Promise<Coordinates | null> {
  const key = normalize(city);

  const known = TABLE.get(key);
  if (known) return known;

  if (resolved.has(key)) return resolved.get(key) ?? null;

  const guessed = await askModel(city);
  resolved.set(key, guessed);
  return guessed;
}

/** Пакетное разрешение: карта строится сразу по всем гостям. */
export async function resolveMany(cities: string[]): Promise<Record<string, Coordinates>> {
  const unique = [...new Set(cities.map((city) => city.trim()).filter(Boolean))];
  const pairs = await Promise.all(
    unique.map(async (city) => [city, await resolveCoordinates(city)] as const),
  );

  const output: Record<string, Coordinates> = {};
  for (const [city, coordinates] of pairs) {
    if (coordinates) output[city] = coordinates;
  }
  return output;
}

async function askModel(city: string): Promise<Coordinates | null> {
  if (getProvider().name === 'none') return null;

  const prompt = [
    `Координаты населённого пункта «${city}» в России.`,
    `Ответь строго JSON без пояснений: {"lat": 55.75, "lon": 37.62}`,
    `Если такого населённого пункта не знаешь — {"lat": null, "lon": null}`,
  ].join('\n');

  const parsed = extractJson<{ lat?: unknown; lon?: unknown }>(
    await completeCached(`geo:v1:${city}`, prompt),
  );

  const lat = Number(parsed?.lat);
  const lon = Number(parsed?.lon);
  // Границы России с запасом — отсекают и выдумки, и промахи в порядке величины.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < 40 || lat > 82 || lon < 19 || lon > 191) return null;

  return { lat, lon, source: 'ai' };
}

/** Расстояние по большому кругу между двумя точками, км. */
export function distanceBetween(from: Coordinates, to: Coordinates): number {
  const R = 6371;
  const dLat = toRad(to.lat - from.lat);
  const dLon = toRad(to.lon - from.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat));
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/ё/g, 'е');
}
