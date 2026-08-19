/**
 * Цвет гостя на карте.
 *
 * Раньше все составные маршруты рисовались одним фиолетовым, и на карте с
 * четырьмя гостями невозможно было понять, чья это линия. Теперь цвет
 * закреплён за человеком, а вид сообщения передаётся начертанием линии:
 * сплошная — прямое, пунктир — составное, точки — не доедет.
 *
 * Палитра подобрана так, чтобы соседние оттенки различались и на светлом фоне,
 * и рядом друг с другом.
 */

const PALETTE = [
  '#6f5df6',
  '#ff6e1a',
  '#00a3a3',
  '#d81b8c',
  '#2d7a2d',
  '#b45309',
  '#0369a1',
  '#7c3aed',
  '#be123c',
  '#4d7c0f',
] as const;

/** Цвет по устойчивому ключу: один и тот же гость не меняет цвет между расчётами. */
export function guestColor(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

/**
 * Цвета для списка гостей: соседи по списку не должны совпадать.
 *
 * Хеш сам по себе изредка даёт двум подряд идущим гостям один цвет, и на карте
 * они сливаются. Здесь совпадения разводятся сдвигом по палитре.
 */
export function assignColors(keys: string[]): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();

  for (const key of keys) {
    let color = guestColor(key);
    let shift = 0;
    while (used.has(color) && shift < PALETTE.length) {
      shift += 1;
      color = PALETTE[(PALETTE.indexOf(color as (typeof PALETTE)[number]) + shift) % PALETTE.length];
    }
    used.add(color);
    result.set(key, color);
  }

  return result;
}
