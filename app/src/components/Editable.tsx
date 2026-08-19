import { useEffect, useRef } from 'react';

/**
 * Текст, который правится там, где он показан.
 *
 * Это не поле ввода рядом со страницей, а сам текст страницы: те же шрифт,
 * размер и цвет, прозрачный фон, никакой рамки. Пока не наведёшь — выглядит
 * как готовая вёрстка; наведёшь — становится понятно, что это можно менять.
 *
 * Под капотом обычный `textarea`, а не `contentEditable`: последний хранит
 * разметку, дерётся с React за положение курсора и приносит в текст чужие стили при
 * вставке. Здесь нужен простой текст, и `textarea` даёт его без сюрпризов.
 */
export function Editable({
  value,
  onChange,
  className = '',
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Высота подгоняется под содержимое: полоса прокрутки внутри заголовка
  // мгновенно выдала бы, что это поле ввода, а не текст.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className={`editable ${className}`}
      value={value}
      rows={1}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
    />
  );
}
