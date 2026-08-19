import { useEffect, useState } from 'react';
import { fetchEvents, type EventSummaryRow } from '../api.ts';
import { loadManageLinks, manageUrl, parseManageUrl, rememberManageLink } from '../manageLinks.ts';
import { themeProps } from '../theme.ts';

/**
 * Рабочий стол организатора.
 *
 * Тот, кто возит людей постоянно — турагент, event-агентство, тренер секции,
 * корпоративный координатор, — ведёт не одно событие, а десяток одновременно.
 * Здесь они лежат в одном списке с цифрами, ради которых их и открывают:
 * сколько ответили, сколько едет, во что обходится дорога.
 */
export function EventsScreen() {
  const [events, setEvents] = useState<EventSummaryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  const reload = () => {
    const keys = loadManageLinks().map((link) => link.manageKey);
    if (keys.length === 0) {
      setEvents([]);
      return;
    }
    fetchEvents(keys)
      .then((result) => setEvents(result.events))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить события'),
      );
  };

  useEffect(reload, []);

  const addByLink = () => {
    const parsed = parseManageUrl(paste);
    if (!parsed) {
      setPasteNote('Это не похоже на ссылку управления — она вида /e/<код>/<ключ>');
      return;
    }
    rememberManageLink({ ...parsed, title: 'Событие' });
    setPaste('');
    setPasteNote('Событие добавлено в список');
    reload();
  };

  const totals = (events ?? []).reduce(
    (sum, event) => ({
      guests: sum.guests + event.guests,
      attending: sum.attending + event.attending,
      cost: sum.cost + event.confirmedCost,
    }),
    { guests: 0, attending: 0, cost: 0 },
  );

  return (
    <div className="setup">
      <div className="setup-inner">
        <header className="setup-head">
          <div>
            <p className="kicker">Рабочий стол</p>
            <h1 className="setup-title">Мои события</h1>
          </div>
          <a className="primary" href="/">
            Новое событие
          </a>
        </header>

        {error && <p className="hint error">{error}</p>}

        <section className="card">
          <h2 className="card-title">Как устроен доступ</h2>
          <p className="hint">
            Список собран из ссылок управления, сохранённых <b>в этом браузере</b>. Общего списка
            событий не существует: сервер отдаёт только то, ключи от чего вы прислали. Кто владеет
            ссылкой — тот и управляет событием, поэтому её не стоит публиковать вместе
            с приглашением.
          </p>
          <div className="invite-form">
            <input
              value={paste}
              placeholder="Вставьте ссылку управления, чтобы вернуть событие на этом устройстве"
              onChange={(event) => setPaste(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && addByLink()}
              aria-label="Ссылка управления"
            />
            <button type="button" className="ghost" onClick={addByLink} disabled={!paste.trim()}>
              Добавить
            </button>
          </div>
          {pasteNote && <p className="hint">{pasteNote}</p>}
        </section>

        {events && events.length > 0 && (
          <section className="card totals">
            <div className="metric">
              <span className="metric-value">{events.length}</span>
              <span className="metric-label">событий</span>
            </div>
            <div className="metric">
              <span className="metric-value">{totals.guests}</span>
              <span className="metric-label">приглашённых</span>
            </div>
            <div className="metric">
              <span className="metric-value">{totals.attending}</span>
              <span className="metric-label">подтвердили</span>
            </div>
            <div className="metric">
              <span className="metric-value">{totals.cost.toLocaleString('ru-RU')} ₽</span>
              <span className="metric-label">подтверждённая дорога</span>
            </div>
          </section>
        )}

        {events === null ? (
          <div className="card">
            <div className="pulse" />
          </div>
        ) : events.length === 0 ? (
          <section className="card">
            <p className="hint">
              Здесь появятся события, которые вы создадите с этого устройства. Если событие
              создавалось на другом — вставьте его ссылку управления выше.
            </p>
          </section>
        ) : (
          <ul className="event-list">
            {events.map((event) => (
              <li key={event.id}>
                <a
                  className={`event-row ${themeProps(event.theme?.palette).className}`}
                  style={themeProps(event.theme?.palette).style}
                  href={manageUrl(event.id, event.manageKey)}
                >
                  <span className="event-cover">{event.theme?.cover ?? '✨'}</span>
                  <span className="event-main">
                    <span className="event-title">{event.title}</span>
                    <span className="event-where">
                      {event.destination} · {formatDate(event.date)}
                      {event.returnDate && ` — ${formatDate(event.returnDate)}`}
                    </span>
                  </span>
                  <span className="event-stat">
                    <b>{event.attending}</b>
                    <i>едут</i>
                  </span>
                  <span className="event-stat">
                    <b>{event.guests - event.answered}</b>
                    <i>молчат</i>
                  </span>
                  <span className="event-stat wide">
                    <b>{event.confirmedCost.toLocaleString('ru-RU')} ₽</b>
                    <i>подтверждено</i>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function formatDate(iso: string): string {
  const [, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}
