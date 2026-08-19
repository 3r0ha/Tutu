/**
 * Цвет страницы приглашения.
 *
 * Фирменные четыре цвета остались именованными — под них написаны правила в
 * стилях. Свой цвет приходит шестнадцатеричной строкой, и правил под него
 * заранее нет, поэтому он въезжает переменными: сам цвет и цвет текста поверх.
 */

import type { CSSProperties } from 'react';

const NAMED = new Set(['lime', 'purple', 'orange', 'ink']);

export function isCustomPalette(palette: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(palette);
}

/**
 * Цвет текста задаётся отдельно и необязателен.
 *
 * Сам по себе он выводится из фона: на светлом — тёмный, на тёмном — светлый.
 * Но выведенный цвет — это разумное умолчание, а не решение за человека: если
 * он выбрал свой, берётся его, даже когда контраст спорный.
 */
export function themeProps(
  palette: string | undefined,
  ink?: string | null,
): { className: string; style?: CSSProperties } {
  const value = palette ?? 'lime';
  const named = NAMED.has(value);
  if (!named && !isCustomPalette(value)) return { className: 'theme-lime' };

  const chosenInk = ink && isCustomPalette(ink) ? ink : null;

  if (named) {
    // У фирменных цветов текст уже прописан в стилях — переопределяем только
    // если человек выбрал свой.
    return {
      className: `theme-${value}`,
      style: chosenInk ? ({ '--theme-ink': chosenInk } as CSSProperties) : undefined,
    };
  }

  return {
    className: 'theme-custom',
    style: {
      '--theme': value,
      '--theme-ink': chosenInk ?? readableInk(value),
    } as CSSProperties,
  };
}

/**
 * Чёрный или белый поверх выбранного цвета.
 *
 * Человек выбирает фон, а не текст, и на светло-жёлтом белые буквы читаться не
 * будут. Порог взят по относительной яркости — той же, по которой считают
 * контраст в вебе, а не по «на глаз тёмный».
 */
export function readableInk(hex: string): string {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.45 ? '#262122' : '#ffffff';
}
