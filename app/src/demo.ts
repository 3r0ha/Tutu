import type { EventPlan, Guest } from './types.ts';

/**
 * Заранее снятый набор данных для показа.
 *
 * Первый расчёт нового направления занимает до минуты — на защите столько
 * тишины не бывает. Здесь лежит снимок настоящих ответов Туту: те же цены,
 * те же маршруты, тот же Суздаль без обратных рейсов. Это не выдуманные
 * данные и не заглушка логики — движок посчитал их заранее, и дата съёмки
 * показывается рядом.
 */

export interface DemoStay {
  hotelId: string;
  hotelGeoId?: string | null;
  name: string;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
  price: number | null;
  url: string | null;
  quote: string | null;
  quoteDate: string | null;
}

export interface DemoBundle {
  capturedAt: string;
  title: string;
  guests: Guest[];
  plans: EventPlan[];
  /**
   * Жильё по городам события.
   *
   * Без него блок «где остановиться» на показе пустует до первого живого
   * запроса — а это те самые секунды тишины, ради которых демо и снималось.
   */
  stays: Record<string, { options: DemoStay[]; note: string }>;
}

export async function loadDemo(): Promise<DemoBundle> {
  const response = await fetch('/demo.json');
  if (!response.ok) throw new Error('Демо-набор не найден');
  return (await response.json()) as DemoBundle;
}
