import { useState } from 'react';
import { parseGuestList } from '../guestList.ts';
import type { Guest, ParsedEvent } from '../types.ts';
import { assignColors } from '../guestColors.ts';
import { VenueFinder } from './VenueFinder.tsx';

/**
 * Настройка события — отдельный экран во всю ширину.
 *
 * Раньше всё это ютилось в боковой панели, пока остальной экран пустовал:
 * до расчёта карте нечего показывать, и отдавать ей три четверти площади было
 * нечестно по отношению к тому, чем человек реально занят — списком гостей.
 */
export function SetupScreen({
  title,
  destination,
  endCity,
  date,
  returnDate,
  guests,
  busy,
  error,
  onTitle,
  onDestination,
  onEndCity,
  onDate,
  onReturnDate,
  onGuests,
  onCompute,
  onIntent,
  onDemo,
  aiEnabled,
  hasResult,
  onBack,
}: {
  title: string;
  destination: string;
  endCity: string;
  date: string;
  returnDate: string;
  guests: Guest[];
  busy: boolean;
  error: string | null;
  onTitle: (value: string) => void;
  onDestination: (value: string) => void;
  onEndCity: (value: string) => void;
  onDate: (value: string) => void;
  onReturnDate: (value: string) => void;
  onGuests: (guests: Guest[]) => void;
  onCompute: () => void;
  onIntent: (text: string) => Promise<ParsedEvent>;
  onDemo: () => void;
  /** На демо-стенде модели нет — разбор словами тогда не показывается вовсе. */
  aiEnabled: boolean;
  hasResult: boolean;
  onBack: () => void;
}) {
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [bulk, setBulk] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [intent, setIntent] = useState('');
  const [intentBusy, setIntentBusy] = useState(false);
  const [intentNote, setIntentNote] = useState<string | null>(null);

  // Ключ тот же, что на карте, — иначе кружок в списке и линия не совпадут.
  const colors = assignColors(guests.map((guest) => guest.city));

  const addGuest = () => {
    const trimmed = city.trim();
    if (!trimmed) return;
    onGuests([...guests, { id: nextId(), name: name.trim() || trimmed, city: trimmed }]);
    setName('');
    setCity('');
  };

  const known = new Set(guests.map((guest) => `${guest.name.toLowerCase()}|${guest.city.toLowerCase()}`));
  const freshFromBulk = parseGuestList(bulk).filter(
    (guest) => !known.has(`${guest.name.toLowerCase()}|${guest.city.toLowerCase()}`),
  );

  const addBulk = () => {
    if (freshFromBulk.length === 0) return;
    onGuests([...guests, ...freshFromBulk.map((guest) => ({ id: nextId(), ...guest }))]);
    setBulk('');
    setBulkOpen(false);
  };

  const runIntent = async () => {
    if (!intent.trim()) return;
    setIntentBusy(true);
    setIntentNote(null);
    try {
      const parsed = await onIntent(intent);
      const parts = [
        parsed.destination ? `место: ${parsed.destination}` : null,
        parsed.date ? `дата: ${parsed.date}` : null,
        parsed.guests.length ? `гостей: ${parsed.guests.length}` : null,
      ].filter(Boolean);
      setIntentNote(parts.length ? `Разобрано — ${parts.join(', ')}` : 'Не удалось ничего извлечь');
    } catch (cause) {
      setIntentNote(cause instanceof Error ? cause.message : 'Разбор не удался');
    } finally {
      setIntentBusy(false);
    }
  };

  return (
    <div className="setup">
      <div className="setup-inner">
        <header className="setup-head">
          <div>
            <p className="kicker">Шаг 1 — событие</p>
            <h1 className="setup-title">Кого и куда зовём</h1>
          </div>
          <div className="head-right">
            <a className="ghost" href="/about">
              Как это работает
            </a>
            <a className="ghost" href="/events">
              Мои события
            </a>
            {hasResult && (
              <button type="button" className="ghost" onClick={onBack}>
                ← К результату
              </button>
            )}
          </div>
        </header>

        <section className="card">
          <div className="setup-grid">
            <label className="field wide">
              <span className="label">Название события</span>
              <input value={title} onChange={(event) => onTitle(event.target.value)} placeholder="Свадьба Ани и Бориса" />
            </label>
            <label className="field">
              <span className="label">Где</span>
              <input id="destination" value={destination} onChange={(event) => onDestination(event.target.value)} />
            </label>
            <label className="field">
              <span className="label">Начало</span>
              <input type="date" value={date} onChange={(event) => onDate(event.target.value)} />
            </label>
            <label className="field">
              <span className="label">Окончание</span>
              <input type="date" value={returnDate} onChange={(event) => onReturnDate(event.target.value)} />
            </label>
          </div>

          <details className="intent-block">
            <summary className="label">Событие заканчивается в другом городе</summary>
            <input
              value={endCity}
              placeholder={`По умолчанию там же — ${destination || 'место начала'}`}
              onChange={(event) => onEndCity(event.target.value)}
              aria-label="Город окончания"
            />
            <p className="hint">
              Свадьба в Суздале, проводы во Владимире — обратную дорогу посчитаем оттуда.
            </p>
          </details>

          {aiEnabled && (
          <details className="intent-block">
            <summary className="label">
              Или опишите событие словами <span className="tag">AI</span>
            </summary>
            <textarea
              rows={3}
              value={intent}
              placeholder="Свадьба в Суздале 11 сентября 2026, гости из Кирова, Казани и Москвы"
              onChange={(event) => setIntent(event.target.value)}
            />
            <button type="button" className="ghost" onClick={runIntent} disabled={intentBusy || !intent.trim()}>
              {intentBusy ? 'Разбираем…' : 'Разобрать'}
            </button>
            {intentNote && <p className="hint">{intentNote}</p>}
          </details>
          )}
        </section>

        {guests.length > 1 && (
          <section className="card">
            <VenueFinder guests={guests} date={date} onPick={onDestination} />
          </section>
        )}

        <section className="card">
          <div className="card-head">
            <h2 className="card-title">
              Гости <span className="counter">{guests.length}</span>
            </h2>
            <button type="button" className="link" onClick={() => setBulkOpen((open) => !open)}>
              {bulkOpen ? 'Добавлять по одному' : 'Вставить списком'}
            </button>
          </div>

          {bulkOpen ? (
            <div className="bulk">
              <textarea
                rows={5}
                value={bulk}
                autoFocus
                placeholder={'Аня, Киров\nБорис — Казань\nВера (Москва)'}
                onChange={(event) => setBulk(event.target.value)}
              />
              <button type="button" className="ghost" onClick={addBulk} disabled={freshFromBulk.length === 0}>
                {freshFromBulk.length === 0 ? 'Новых гостей нет' : `Добавить ${freshFromBulk.length}`}
              </button>
            </div>
          ) : (
            <div className="add-guest">
              <input
                value={name}
                placeholder="Имя"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && addGuest()}
              />
              <input
                value={city}
                placeholder="Город, откуда поедет"
                onChange={(event) => setCity(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && addGuest()}
              />
              <button type="button" className="icon" onClick={addGuest} aria-label="Добавить гостя">
                +
              </button>
            </div>
          )}

          {guests.length === 0 ? (
            <p className="hint">Пока никого. Добавьте хотя бы одного гостя — с городом, откуда он поедет.</p>
          ) : (
            <ul className="guest-grid">
              {guests.map((guest) => (
                <li key={guest.id} style={{ '--who': colors.get(guest.city) } as React.CSSProperties}>
                  <span className="guest-chip" />
                  <span className="guest-name">{guest.name}</span>
                  <span className="guest-city">{guest.city}</span>
                  <button
                    type="button"
                    className="remove"
                    aria-label={`Убрать ${guest.name}`}
                    onClick={() => onGuests(guests.filter((entry) => entry.id !== guest.id))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="setup-actions">
          <div className="actions-row">
            <button type="button" className="primary big" onClick={onCompute} disabled={busy || guests.length === 0}>
              {busy ? 'Считаем…' : 'Посчитать, кто доедет'}
            </button>
            <button type="button" className="ghost" onClick={onDemo} disabled={busy}>
              Открыть демо
            </button>
          </div>
          <p className="hint">
            Это даты <b>проведения</b>, а не поездки: гость может приехать накануне и уехать на
            следующий день, а если рейсов ровно на эту дату нет — проверим соседние.
          </p>
          <p className="hint">
            Первый расчёт занимает до минуты: мы обходим города-пересадки и проверяем, стыкуются
            ли рейсы по времени. Демо открывает снятые заранее данные мгновенно.
          </p>
          {error && <p className="hint error">{error}</p>}
        </div>
      </div>
    </div>
  );
}

let seq = 5000;
const nextId = (): string => `g${(seq += 1)}`;
