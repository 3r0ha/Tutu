import { useCallback, useEffect, useState } from 'react';
import { fetchRsvpBoard } from '../api.ts';
import type { RsvpBoard } from '../types.ts';
import { formatMoney } from './JourneyCard.tsx';

/**
 * Ответы гостей у организатора.
 *
 * До этого экрана список гостей был набором предположений: организатор сам
 * вписывал, кто откуда поедет. Ответы превращают его в факты — с маршрутом,
 * который гость действительно видел, и суммой, которую он действительно
 * увидел на своей странице.
 *
 * Отдельно считаются молчащие: именно их приходится обзванивать, и без явного
 * счётчика они теряются между согласившимися и отказавшимися.
 */
export function AnswersBoard({ inviteId }: { inviteId: string }) {
  const [board, setBoard] = useState<RsvpBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBoard(await fetchRsvpBoard(inviteId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить ответы');
    }
  }, [inviteId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) return <p className="hint error">{error}</p>;
  if (!board) return <p className="hint">Загружаем ответы…</p>;

  const { summary, items } = board;

  return (
    <div className="answers">
      <div className="answers-summary">
        <span>
          едут <b>{summary.attending}</b>
        </span>
        <span>
          отказались <b>{summary.declined}</b>
        </span>
        <span>
          молчат <b>{summary.silent}</b>
        </span>
        {summary.confirmedCost > 0 && (
          <span>
            подтверждено <b>{formatMoney(summary.confirmedCost)}</b>
          </span>
        )}
      </div>

      {items.map((item) => (
        <div key={item.id} className={`answer ${item.attending ? 'yes' : 'no'}`}>
          <span className="answer-who">
            {item.name} · {item.city}
            {item.travellers > 1 && item.attending && ` · ${item.travellers} чел.`}
            {item.routeSummary && <span className="answer-route">{item.routeSummary}</span>}
            {item.comment && <span className="answer-route">«{item.comment}»</span>}
          </span>
          {item.attending && item.price !== null && (
            <span className="answer-price">{formatMoney(item.price)}</span>
          )}
        </div>
      ))}

      {items.length === 0 && <p className="hint">Ответов пока нет — разошлите ссылку гостям.</p>}

      <button type="button" className="ghost" onClick={() => void refresh()}>
        Обновить
      </button>
    </div>
  );
}
