import { useEffect, useRef, useState } from 'react';

/**
 * Отсчёт числа до нового значения.
 *
 * Расчёт занимает до минуты, и его итог — несколько чисел внизу экрана.
 * Появившись готовыми, они читаются как всегда там бывшие; отсчёт делает
 * видимым, что это результат работы, и заодно притягивает взгляд туда, где
 * лежит ответ.
 *
 * Длительность фиксирована и коротка: анимация здесь служит вниманию, а не
 * себе. Если человек попросил систему не двигать интерфейс, число ставится
 * сразу — это не украшение, без которого что-то теряется.
 */
const DURATION_MS = 550;

export function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const frame = useRef(0);

  useEffect(() => {
    if (target === from.current) return;

    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (calm) {
      from.current = target;
      setShown(target);
      return;
    }

    const start = performance.now();
    const origin = from.current;
    from.current = target;

    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / DURATION_MS);
      // Замедление к концу: число должно «доезжать», а не обрываться.
      const eased = 1 - (1 - progress) ** 3;
      setShown(Math.round(origin + (target - origin) * eased));
      if (progress < 1) frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target]);

  return shown;
}
