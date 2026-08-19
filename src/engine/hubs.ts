/**
 * Каталог транспортных хабов.
 *
 * Ресурс `tutu://geo` содержит всего два города и как справочник непригоден,
 * поэтому каталог свой. Координаты нужны только для отбора кандидатов в шлюзы —
 * решение о том, существует ли связь, всегда принимается по живому ответу Туту,
 * а не по географии.
 */

export interface Hub {
  name: string;
  lat: number;
  lon: number;
  /** Хабы федерального масштаба проверяются как шлюз всегда, независимо от расстояния. */
  national?: boolean;
}

export const HUBS: readonly Hub[] = [
  { name: 'Москва', lat: 55.75, lon: 37.62, national: true },
  { name: 'Санкт-Петербург', lat: 59.94, lon: 30.31, national: true },
  { name: 'Нижний Новгород', lat: 56.33, lon: 44.0 },
  { name: 'Казань', lat: 55.79, lon: 49.11 },
  { name: 'Екатеринбург', lat: 56.84, lon: 60.61 },
  { name: 'Новосибирск', lat: 55.03, lon: 82.92 },
  { name: 'Самара', lat: 53.2, lon: 50.15 },
  { name: 'Ростов-на-Дону', lat: 47.23, lon: 39.72 },
  { name: 'Краснодар', lat: 45.04, lon: 38.98 },
  { name: 'Воронеж', lat: 51.67, lon: 39.21 },
  { name: 'Уфа', lat: 54.74, lon: 55.97 },
  { name: 'Пермь', lat: 58.01, lon: 56.25 },
  { name: 'Челябинск', lat: 55.16, lon: 61.4 },
  { name: 'Волгоград', lat: 48.71, lon: 44.51 },
  { name: 'Саратов', lat: 51.53, lon: 46.03 },
  { name: 'Ярославль', lat: 57.63, lon: 39.87 },
  { name: 'Владимир', lat: 56.13, lon: 40.41 },
  { name: 'Иваново', lat: 57.0, lon: 40.97 },
  { name: 'Кострома', lat: 57.77, lon: 40.93 },
  { name: 'Тверь', lat: 56.86, lon: 35.9 },
  { name: 'Тула', lat: 54.19, lon: 37.62 },
  { name: 'Рязань', lat: 54.63, lon: 39.74 },
  { name: 'Калуга', lat: 54.51, lon: 36.26 },
  { name: 'Смоленск', lat: 54.78, lon: 32.05 },
  { name: 'Брянск', lat: 53.24, lon: 34.37 },
  { name: 'Курск', lat: 51.73, lon: 36.19 },
  { name: 'Белгород', lat: 50.6, lon: 36.59 },
  { name: 'Липецк', lat: 52.61, lon: 39.6 },
  { name: 'Тамбов', lat: 52.72, lon: 41.45 },
  { name: 'Пенза', lat: 53.2, lon: 45.0 },
  { name: 'Ульяновск', lat: 54.32, lon: 48.4 },
  { name: 'Чебоксары', lat: 56.13, lon: 47.25 },
  { name: 'Киров', lat: 58.6, lon: 49.67 },
  { name: 'Ижевск', lat: 56.85, lon: 53.2 },
  { name: 'Вологда', lat: 59.22, lon: 39.89 },
  { name: 'Великий Новгород', lat: 58.52, lon: 31.27 },
  { name: 'Псков', lat: 57.82, lon: 28.33 },
  { name: 'Петрозаводск', lat: 61.79, lon: 34.35 },
  { name: 'Архангельск', lat: 64.54, lon: 40.54 },
  { name: 'Мурманск', lat: 68.97, lon: 33.08 },
  { name: 'Калининград', lat: 54.71, lon: 20.51 },
  { name: 'Сочи', lat: 43.6, lon: 39.73 },
  { name: 'Минеральные Воды', lat: 44.21, lon: 43.14 },
  { name: 'Ставрополь', lat: 45.04, lon: 41.97 },
  { name: 'Астрахань', lat: 46.35, lon: 48.04 },
  { name: 'Оренбург', lat: 51.77, lon: 55.1 },
  { name: 'Тюмень', lat: 57.15, lon: 65.53 },
  { name: 'Омск', lat: 54.99, lon: 73.37 },
  { name: 'Красноярск', lat: 56.01, lon: 92.87 },
  { name: 'Иркутск', lat: 52.29, lon: 104.3 },
  { name: 'Хабаровск', lat: 48.48, lon: 135.08 },
  { name: 'Владивосток', lat: 43.12, lon: 131.89 },
];

const BY_NAME = new Map(HUBS.map((hub) => [hub.name.toLowerCase(), hub]));

export function findHub(name: string): Hub | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

export function distanceKm(a: Hub, b: Hub): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Кандидаты в шлюзы к пункту назначения.
 *
 * Каталог отвечает только за то, какие города вообще бывают шлюзами. Отбор по
 * географии здесь намеренно не делается: у планировщика есть координаты и малых
 * городов тоже, и он отсеет кандидатов по величине крюка точнее.
 *
 * Раньше этот отбор жил здесь и для незнакомого города вырождался в
 * произвольный срез — до Териберки предлагались Казань с Новосибирском, а
 * Мурманск не предлагался вовсе.
 */
export function gatewayCandidates(destination: string, origin: string): string[] {
  const excluded = new Set([destination.trim().toLowerCase(), origin.trim().toLowerCase()]);
  return HUBS.filter((hub) => !excluded.has(hub.name.toLowerCase())).map((hub) => hub.name);
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
