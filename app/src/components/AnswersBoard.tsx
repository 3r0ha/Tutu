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
      {/* Сбор ответов — единственное в продукте, что тянется днями, и
          единственное, ради чего организатор возвращается на страницу.
          Кольцо отвечает на его вопрос «сколько ещё ждать» одним взглядом,
          а на полном круге честно поздравляет: все ответили. */}
      <RsvpProgress
        answered={summary.answered}
        total={summary.answered + summary.silent}
        travellers={summary.travellers}
      />

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

/**
 * Кольцо собранных ответов.
 *
 * Доля рисуется обводкой круга: длина штриха — это и есть процент, без единого
 * вычисления в разметке. Когда гостей нет вовсе, кольцо не показывается —
 * прогресс от нуля до нуля не значит ничего.
 */
function RsvpProgress({
  answered,
  total,
  travellers,
}: {
  answered: number;
  total: number;
  travellers: number;
}) {
  if (total === 0) return null;

  const share = Math.min(1, answered / total);
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const done = answered >= total;

  return (
    <div className={`rsvp-progress${done ? ' done' : ''}`}>
      <svg viewBox="0 0 64 64" className="rsvp-ring" aria-hidden="true">
        <circle className="ring-track" cx="32" cy="32" r={radius} />
        <circle
          className="ring-fill"
          cx="32"
          cy="32"
          r={radius}
          strokeDasharray={`${circumference * share} ${circumference}`}
        />
      </svg>
      <div className="rsvp-progress-text">
        <b>
          {answered}/{total}
        </b>
        <span>
          {done
            ? travellers > 0
              ? `все ответили · едут ${travellers} чел.`
              : 'все ответили'
            : `ответили · ждём ещё ${total - answered}`}
        </span>
      </div>
    </div>
  );
}
