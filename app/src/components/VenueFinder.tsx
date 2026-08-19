import { useState } from 'react';
import type { Guest } from '../types.ts';

export interface VenueOption {
  city: string;
  reachable: number;
  guests: number;
  approxCost: number;
  worstDurationMin: number | null;
  hardFor: string[];
}

interface Suggestion {
  options: VenueOption[];
  probedCities: string[];
  note: string;
}

/**
 * Подбор места встречи.
 *
 * Организатор обычно приходит с готовым ответом и узнаёт его цену задним
 * числом. Здесь вопрос перевёрнут: у нас есть список гостей по городам —
 * значит можно предложить, где собраться, чтобы дорога была удобна всем.
 */
export function VenueFinder({
  guests,
  date,
  onPick,
}: {
  guests: Guest[];
  date: string;
  onPick: (city: string) => void;
}) {
  const [result, setResult] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/venues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date, guests: guests.map((guest) => ({ name: guest.name, city: guest.city })) }),
      });
      if (!response.ok) throw new Error('Не удалось подобрать место');
      setResult((await response.json()) as Suggestion);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось подобрать место');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="venue-finder">
      <summary className="card-title">
        Не решили, где собраться? <span className="tag">подбор</span>
      </summary>

      <p className="hint">
        Посмотрим, куда удобно доехать всем гостям сразу. Оценка быстрая, по прямым рейсам.
      </p>

      <button type="button" className="ghost" onClick={run} disabled={busy || guests.length === 0}>
        {busy ? 'Проверяем города…' : 'Подобрать место'}
      </button>

      {error && <p className="hint error">{error}</p>}

      {result && (
        <>
          <ul className="venue-list">
            {result.options.map((option, index) => (
              <li key={option.city} className={index === 0 ? 'best' : ''}>
                <span className="venue-rank">{index + 1}</span>
                <span className="venue-main">
                  <span className="venue-city">{option.city}</span>
                  {option.hardFor.length > 0 && (
                    <span className="venue-hard">нет прямых из: {option.hardFor.join(', ')}</span>
                  )}
                </span>
                <span className="venue-stat">
                  <b>
                    {option.reachable}
                    <i>/{option.guests}</i>
                  </b>
                  <i>доедут напрямую</i>
                </span>
                <span className="venue-stat">
                  <b>{option.approxCost.toLocaleString('ru-RU')} ₽</b>
                  <i>примерно на всех</i>
                </span>
                <button type="button" className="ghost" onClick={() => onPick(option.city)}>
                  Выбрать
                </button>
              </li>
            ))}
          </ul>
          <p className="hint">{result.note}</p>
        </>
      )}
    </details>
  );
}
