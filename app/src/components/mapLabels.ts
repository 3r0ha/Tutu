/**
 * Раскладка подписей на карте.
 *
 * Чистая геометрия без единого элемента разметки: города рядом — обычное дело,
 * и Москва с Коломной на одной карте перекрывались так, что читалось только
 * верхнее. Вынесено из компонента, чтобы покрыть тестами.
 */

export interface Placed {
  x: number;
  y: number;
}

/**
 * Куда поставить подпись города.
 *
 * Позиции перебираются по порядку: сначала привычное место под точкой, затем
 * над ней, затем сбоку. Занимает первую свободную.
 */
const LABEL_SLOTS: ReadonlyArray<{ dx: number; dy: number; anchor: 'middle' | 'start' | 'end' }> = [
  { dx: 0, dy: 22, anchor: 'middle' },
  { dx: 0, dy: -13, anchor: 'middle' },
  { dx: 11, dy: 5, anchor: 'start' },
  { dx: -11, dy: 5, anchor: 'end' },
  { dx: 0, dy: 35, anchor: 'middle' },
  { dx: 0, dy: -26, anchor: 'middle' },
];

/**
 * Место события окружено кольцами, поэтому подпись под точку не встаёт —
 * ей нужен собственный набор позиций, начинающийся выше колец.
 */
export const TARGET_SLOTS: typeof LABEL_SLOTS = [
  { dx: 0, dy: -36, anchor: 'middle' },
  { dx: 0, dy: 46, anchor: 'middle' },
  { dx: 34, dy: 5, anchor: 'start' },
  { dx: -34, dy: 5, anchor: 'end' },
];

/**
 * Позиции про запас.
 *
 * Шести стандартных мест хватает не всегда: плотный кластер городов исчерпывал
 * их, и очередная подпись падала обратно на первое, занятое. Здесь они
 * расходятся всё дальше от точки — подпись уезжает, но остаётся читаемой
 * и связанной со своим кружком.
 */
function* extendedSlots(base: typeof LABEL_SLOTS): Generator<(typeof LABEL_SLOTS)[number]> {
  yield* base;

  for (let step = 1; step <= 5; step += 1) {
    yield { dx: 0, dy: 22 + step * 15, anchor: 'middle' };
    yield { dx: 0, dy: -13 - step * 15, anchor: 'middle' };
    yield { dx: 11 + step * 10, dy: 5 + step * 6, anchor: 'start' };
    yield { dx: -11 - step * 10, dy: 5 + step * 6, anchor: 'end' };
  }
}

/** Ширина глифа на глаз: измерять текст в SVG негде, а точность здесь не нужна. */
const GLYPH_WIDTH = 6.3;
const LINE_HEIGHT = 13;

export interface LabelPlacement {
  x: number;
  y: number;
  anchor: 'middle' | 'start' | 'end';
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function boxOf(text: string, at: Placed, slot: (typeof LABEL_SLOTS)[number], scale: number): Box {
  const width = text.length * GLYPH_WIDTH * scale;
  const x = at.x + slot.dx;
  const y = at.y + slot.dy;
  const left = slot.anchor === 'middle' ? x - width / 2 : slot.anchor === 'start' ? x : x - width;
  return { left, right: left + width, top: y - LINE_HEIGHT * scale, bottom: y };
}

function overlaps(left: Box, right: Box): boolean {
  const padding = 2;
  return (
    left.left < right.right + padding &&
    left.right + padding > right.left &&
    left.top < right.bottom + padding &&
    left.bottom + padding > right.top
  );
}

/**
 * Разводит подписи, чтобы они не налезали друг на друга.
 *
 * Города рядом — обычное дело: Москва и Коломна на одной карте перекрывались
 * так, что читалось только верхнее. Порядок обхода задаёт приоритет: место
 * события важнее гостей, гости важнее городов пересадки.
 */
export function placeLabels(
  items: Array<{ key: string; text: string; at: Placed; scale?: number; slots?: typeof LABEL_SLOTS }>,
): Map<string, LabelPlacement> {
  const placed: Box[] = [];
  const result = new Map<string, LabelPlacement>();

  for (const item of items) {
    const scale = item.scale ?? 1;
    const slots = item.slots ?? LABEL_SLOTS;

    let slot = slots[0];
    for (const candidate of extendedSlots(slots)) {
      const box = boxOf(item.text, item.at, candidate, scale);
      if (!placed.some((taken) => overlaps(box, taken))) {
        slot = candidate;
        break;
      }
    }

    placed.push(boxOf(item.text, item.at, slot, scale));
    result.set(item.key, { x: item.at.x + slot.dx, y: item.at.y + slot.dy, anchor: slot.anchor });
  }

  return result;
}
