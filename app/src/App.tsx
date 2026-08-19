import { useCallback, useEffect, useMemo, useState } from 'react';
import { planEvent, parseIntent, fetchConfig } from './api.ts';
import type { EventPlan, Guest, GuestPlan, Leg, MapPlan, ViewMode } from './types.ts';
import { ReachMap } from './components/ReachMap.tsx';
import { HealthBar } from './components/HealthBar.tsx';
import { GuestSheet } from './components/GuestSheet.tsx';
import { InvitePage } from './components/InvitePage.tsx';
import { SetupScreen } from './components/SetupScreen.tsx';
import { InviteStudio } from './components/InviteStudio.tsx';
import { ScenarioBar, type Scenario } from './components/ScenarioBar.tsx';
import { ManageScreen } from './components/ManageScreen.tsx';
import { EventsScreen } from './components/EventsScreen.tsx';
import { AboutScreen } from './components/AboutScreen.tsx';
import { loadDraft, saveDraft } from './draft.ts';
import { buildDigest } from './digest.ts';
import { guestsForMetric, type MetricKey } from './planStats.ts';
import { findCompanionships } from './companions.ts';
import { assignColors } from './guestColors.ts';
import { loadDemo, type DemoStay } from './demo.ts';

/** Русское склонение после числа: «1 запрос», «2 запроса», «5 запросов». */
function plural(count: number, one: string, few: string, many: string): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return many;
  switch (count % 10) {
    case 1: return one;
    case 2:
    case 3:
    case 4: return few;
    default: return many;
  }
}

/** Пауза между гостями при проигрывании демо. */
const DEMO_STEP_MS = 420;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let guestSeq = 0;
const nextId = (): string => `g${(guestSeq += 1)}`;

const SEED: Guest[] = [
  { id: nextId(), name: 'Аня', city: 'Киров' },
  { id: nextId(), name: 'Борис', city: 'Казань' },
  { id: nextId(), name: 'Вера', city: 'Москва' },
  { id: nextId(), name: 'Глеб', city: 'Санкт-Петербург' },
];

/**
 * Разбор адреса.
 *
 * Четыре поверхности: приглашение для гостя, событие организатора по ключу
 * управления, рабочий стол со всеми событиями и мастер создания.
 */
function routeFromLocation():
  | { kind: 'invite'; id: string; slug?: string }
  | { kind: 'manage'; id: string; key: string }
  | { kind: 'events' }
  | { kind: 'about' }
  | { kind: 'organizer' } {
  const path = window.location.pathname;

  // Персональная ссылка несёт код гостя, общая — нет.
  const personal = path.match(/^\/i\/([a-z0-9]{4,32})\/(g\d{1,3})\/?$/);
  if (personal) return { kind: 'invite', id: personal[1], slug: personal[2] };

  const invite = path.match(/^\/i\/([a-z0-9]{4,32})\/?$/);
  if (invite) return { kind: 'invite', id: invite[1] };

  const manage = path.match(/^\/e\/([a-z0-9]{4,32})\/([a-z0-9]{16,64})\/?$/);
  if (manage) return { kind: 'manage', id: manage[1], key: manage[2] };

  if (/^\/events\/?$/.test(path)) return { kind: 'events' };
  if (/^\/about\/?$/.test(path)) return { kind: 'about' };
  return { kind: 'organizer' };
}

export function App() {
  const route = useMemo(routeFromLocation, []);

  if (route.kind === 'invite') return <InvitePage id={route.id} slug={route.slug} />;
  if (route.kind === 'manage') return <ManageScreen id={route.id} manageKey={route.key} />;
  if (route.kind === 'events') return <EventsScreen />;
  if (route.kind === 'about') return <AboutScreen />;
  return <Organizer />;
}

/**
 * Три шага вместо одной перегруженной панели.
 *
 * Настройка занимает весь экран: до расчёта карте нечего показывать, и
 * отдавать ей три четверти площади, пока человек возится со списком гостей
 * в узкой колонке, — нечестно. После расчёта экран принадлежит карте.
 */
type Step = 'setup' | 'result' | 'invite';

function Organizer() {
  const [draft] = useState(loadDraft);
  // На демо-стенде ключа к модели нет, и предлагать разбор словами там незачем.
  const [aiEnabled, setAiEnabled] = useState(false);
  // Снятое заранее жильё: на показе блок «где остановиться» должен быть
  // заполнен сразу, без похода в Туту.
  const [demoStays, setDemoStays] = useState<Record<string, { options: DemoStay[]; note: string }>>({});

  const [title, setTitle] = useState('Свадьба Ани и Бориса');
  const [destination, setDestination] = useState(draft?.destination || 'Суздаль');
  // Событие может закончиться в другом городе: свадьба в Суздале, проводы во Владимире.
  const [endCity, setEndCity] = useState(draft?.endCity || '');
  const [date, setDate] = useState(draft?.date || '2026-09-11');
  const [returnDate, setReturnDate] = useState<string>(draft?.returnDate ?? '2026-09-13');
  const [guests, setGuests] = useState<Guest[]>(draft?.guests?.length ? draft.guests : SEED);

  const [step, setStep] = useState<Step>('setup');
  const [plan, setPlan] = useState<EventPlan | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeScenario, setActiveScenario] = useState<string | null>(null);

  const [mode, setMode] = useState<ViewMode>('composed');
  const [leg, setLeg] = useState<Leg>('outbound');
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  /** Раскрытый показатель нижней полосы: кто именно стоит за числом. */
  const [openedMetric, setOpenedMetric] = useState<MetricKey | null>(null);

  const [progress, setProgress] = useState<MapPlan | null>(null);
  /** Сколько запросов к Туту сделано за текущий расчёт. */
  const [calls, setCalls] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoNote, setDemoNote] = useState<string | null>(null);
  const [digestNote, setDigestNote] = useState<string | null>(null);

  /**
   * Выгрузка сводки.
   *
   * Расчёт живёт на экране, а работа организатора — в переписке и таблицах.
   * Кнопка потерялась при переделке экранов; без неё результат приходится
   * переписывать руками.
   */
  const copyDigest = useCallback(async () => {
    if (!plan) return;
    const text = buildDigest(plan, title);
    try {
      await navigator.clipboard.writeText(text);
      setDigestNote('Сводка скопирована');
    } catch {
      // Буфер может быть закрыт политикой страницы — открываем текст в окне,
      // чтобы его можно было выделить руками.
      const view = window.open('', '_blank');
      view?.document.write(`<pre style="font:14px/1.5 monospace;white-space:pre-wrap">${text.replace(/</g, '&lt;')}</pre>`);
      setDigestNote('Сводка открыта в новой вкладке');
    }
    setTimeout(() => setDigestNote(null), 2500);
  }, [plan, title]);

  /**
   * Показ на заранее снятых данных.
   *
   * Первый расчёт нового направления занимает до минуты — на защите столько
   * тишины не бывает. Это настоящие ответы Туту, снятые заранее, а не
   * подменённая логика: те же маршруты проходят через тот же интерфейс.
   */
  const runDemo = useCallback(async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    setStep('result');
    try {
      const bundle = await loadDemo();
      setTitle(bundle.title);
      setGuests(bundle.guests);
      setDemoStays(bundle.stays ?? {});

      const loaded = bundle.plans.map((entry) => ({
        id: `${entry.destination}|${entry.date}|${entry.returnDate ?? ''}`,
        destination: entry.destination,
        date: entry.date,
        returnDate: entry.returnDate,
        plan: entry,
      }));

      const first = loaded[0];

      // Демо проигрывает тот же путь, что и живой расчёт: сначала карта с
      // городами, потом гости по одному. Показывать сразу готовый результат
      // значило бы прятать половину продукта — как раз ту, что объясняет,
      // почему первый расчёт занимает время.
      setProgress({
        destination: first.destination,
        guests: [],
        coordinates: first.plan.coordinates,
        destinationCoordinates: first.plan.destinationCoordinates,
      });

      for (const guest of first.plan.guests) {
        await sleep(DEMO_STEP_MS);
        setProgress((current) => (current ? { ...current, guests: [...current.guests, guest] } : current));
      }
      await sleep(DEMO_STEP_MS);

      setScenarios(loaded);
      setPlan(first.plan);
      setActiveScenario(first.id);
      setDestination(first.destination);
      setEndCity(first.plan.endCity === first.destination ? '' : first.plan.endCity);
      setDate(first.date);
      setReturnDate(first.returnDate ?? '');
      setDemoNote(`Данные сняты ${bundle.capturedAt} — цены на тот момент.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Демо-набор не загрузился');
      setStep('setup');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, []);

  useEffect(() => {
    saveDraft({ destination, endCity, date, returnDate, guests });
  }, [destination, endCity, date, returnDate, guests]);

  useEffect(() => {
    void fetchConfig().then((config) => setAiEnabled(config.ai));
  }, []);

  // Escape закрывает то, что открыто поверх карты: иначе единственный выход —
  // попасть в маленький крестик.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSelectedCity(null);
      setOpenedMetric(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const compute = useCallback(async () => {
    if (!destination.trim() || guests.length === 0) {
      setError('Укажите место и хотя бы одного гостя');
      return;
    }
    setBusy(true);
    setError(null);
    setProgress(null);
    setCalls(0);
    setStep('result');
    try {
      const result = await planEvent(
        {
          startCity: destination.trim(),
          endCity: endCity.trim() || destination.trim(),
          startDate: date,
          endDate: returnDate || null,
        },
        guests,
        {
        onGeo: (geo) =>
          setProgress({
            destination: destination.trim(),
            guests: [],
            coordinates: geo.coordinates,
            destinationCoordinates: geo.destination,
          }),
          onGuest: (guest: GuestPlan) =>
            setProgress((current) => (current ? { ...current, guests: [...current.guests, guest] } : current)),
          onTick: setCalls,
        },
      );

      const id = `${result.destination}|${result.date}|${result.returnDate ?? ''}`;
      setPlan(result);
      setActiveScenario(id);
      setSelectedCity(null);
      // Повторный расчёт того же сочетания обновляет карточку, а не плодит копию.
      setScenarios((previous) => [
        ...previous.filter((scenario) => scenario.id !== id),
        { id, destination: result.destination, date: result.date, returnDate: result.returnDate, plan: result },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось рассчитать');
      setStep('setup');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [destination, endCity, date, returnDate, guests]);

  const applyIntent = useCallback(async (text: string) => {
    const parsed = await parseIntent(text);
    if (parsed.destination) setDestination(parsed.destination);
    if (parsed.date) setDate(parsed.date);
    if (parsed.title) setTitle(parsed.title);
    if (parsed.guests.length > 0) {
      setGuests(parsed.guests.map((guest) => ({ id: nextId(), name: guest.name, city: guest.city })));
    }
    return parsed;
  }, []);

  /**
   * Кого подсветить на карте.
   *
   * Раскрытый показатель называет имена, но пока они не показаны на карте,
   * «Борис, Глеб, Егор, Заур» — это просто четыре слова. Подсветка отвечает
   * на вопрос «а где они» без единого лишнего действия.
   */
  const highlighted = useMemo(() => {
    if (!plan || !openedMetric) return null;
    const names = new Set(guestsForMetric(plan, openedMetric, mode, returnDate ? leg : 'outbound'));
    return new Set(plan.guests.filter((guest) => names.has(guest.name)).map((guest) => guest.city));
  }, [plan, openedMetric, mode, leg, returnDate]);

  const selected = useMemo(
    () => plan?.guests.find((guest) => guest.city === selectedCity) ?? null,
    [plan, selectedCity],
  );

  // Цвет закреплён за городом гостя: карта, список и карточка обязаны совпадать.
  const colors = useMemo(
    () => assignColors(guests.map((guest) => guest.city)),
    [guests],
  );

  const hasReturn = Boolean(returnDate);
  const shown = progress ?? plan;

  // Кто с кем едет одним рейсом — видно сразу после расчёта, а не только
  // на этапе посадки, то есть после ответов гостей.
  const companionships = useMemo(
    () => (plan ? findCompanionships(plan, hasReturn ? leg : 'outbound') : []),
    [plan, leg, hasReturn],
  );

  if (step === 'setup') {
    return (
      <SetupScreen
        title={title}
        destination={destination}
        endCity={endCity}
        date={date}
        returnDate={returnDate}
        guests={guests}
        busy={busy}
        error={error}
        hasResult={plan !== null}
        onTitle={setTitle}
        onDestination={setDestination}
        onEndCity={setEndCity}
        onDate={setDate}
        onReturnDate={setReturnDate}
        onGuests={setGuests}
        onCompute={compute}
        onIntent={applyIntent}
        aiEnabled={aiEnabled}
        onDemo={runDemo}
        onBack={() => setStep('result')}
      />
    );
  }

  if (step === 'invite' && plan) {
    return (
      <InviteStudio
        plan={plan}
        guests={guests}
        title={title}
        presetStays={demoStays[plan.destination] ?? null}
        onTitle={setTitle}
        onBack={() => setStep('result')}
      />
    );
  }

  return (
    <div className="result">
      <header className="result-head">
        {/* На телефоне подпись съедает строку целиком, а смысл несёт стрелка. */}
        <button type="button" className="ghost back" onClick={() => setStep('setup')}>
          <span aria-hidden="true">←</span>
          <span className="wide-only">Изменить событие</span>
        </button>

        <div className="head-controls">
          <div className="modes" role="tablist" aria-label="Режим поиска">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'direct'}
              className={`mode${mode === 'direct' ? ' active' : ''}`}
              onClick={() => setMode('direct')}
            >
              Как ищет Туту
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'composed'}
              className={`mode${mode === 'composed' ? ' active' : ''}`}
              onClick={() => setMode('composed')}
            >
              Со склейкой
            </button>
          </div>

          {hasReturn && (
            <div className="modes" role="tablist" aria-label="Направление">
              <button
                type="button"
                role="tab"
                aria-selected={leg === 'outbound'}
                className={`mode${leg === 'outbound' ? ' active' : ''}`}
                onClick={() => setLeg('outbound')}
              >
                Туда
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={leg === 'inbound'}
                className={`mode${leg === 'inbound' ? ' active' : ''}`}
                onClick={() => setLeg('inbound')}
              >
                Обратно
              </button>
            </div>
          )}
        </div>

        <div className="head-right">
          {demoNote && (
            <span className="demo-badge" title={demoNote}>
              демо<span className="wide-only"> · {demoNote}</span>
            </span>
          )}
          {plan && (
            <button type="button" className="ghost" onClick={copyDigest} disabled={busy}>
              {digestNote ?? (
                <>
                  <span className="wide-only">Скопировать&nbsp;</span>сводку
                </>
              )}
            </button>
          )}
          <a className="ghost wide-only" href="/events">
            Мои события
          </a>
          <button type="button" className="primary" disabled={!plan || busy} onClick={() => setStep('invite')}>
            <span className="wide-only">Создать&nbsp;</span>приглашение →
          </button>
        </div>
      </header>

      <div className="result-body">
        <aside className="roster">
          <p className="label">Гости</p>
          <ul className="roster-list">
            {(plan?.guests ?? []).map((guest) => (
              <li
                key={`${guest.city}-${guest.name}`}
                className={`${guest.status}${selectedCity === guest.city ? ' active' : ''}`}
                style={{ '--who': colors.get(guest.city) } as React.CSSProperties}
                onClick={() => setSelectedCity(guest.city)}
              >
                <span className="guest-chip" />
                <span className="roster-who">
                  {guest.name}
                  <span className="roster-city">{guest.city}</span>
                </span>
                <span className="roster-price">
                  {guest.status === 'stranded' && 'не уедет'}
                  {guest.status === 'unreachable' && 'не доедет'}
                  {guest.totalPrice && guest.status !== 'stranded'
                    ? `${Math.round(guest.totalPrice.amount).toLocaleString('ru-RU')} ₽`
                    : null}
                </span>
              </li>
            ))}
          </ul>

          {companionships.length > 0 && (
            <div className="companions">
              <p className="label">Едут вместе</p>
              {companionships.slice(0, 4).map((shared) => (
                <div key={shared.key} className="companion">
                  <span className="companion-names">{shared.names.join(', ')}</span>
                  <span className="companion-leg">{shared.label}</span>
                </div>
              ))}
            </div>
          )}

          <p className="legend-lines">
            <span><i className="line solid" />прямой</span>
            <span><i className="line dashed" />составной</span>
            <span><i className="line dotted" />не доедет</span>
          </p>
        </aside>

        <div className="map-wrap">
          {shown ? (
            <ReachMap
              plan={shown}
              mode={mode}
              leg={hasReturn ? leg : 'outbound'}
              colors={colors}
              selectedCity={selectedCity}
              highlighted={highlighted}
              onSelect={busy ? () => undefined : setSelectedCity}
            />
          ) : null}

          {busy && (
            <div className="overlay" role="status" aria-live="polite">
              {progress ? (
                <>
                  <p className="overlay-count">
                    {progress.guests.length}
                    <span className="of">/{guests.length}</span>
                  </p>
                  <h2 className="overlay-title">Считаем маршруты</h2>
                  <div className="overlay-bar">
                    <i style={{ width: `${(progress.guests.length / Math.max(1, guests.length)) * 100}%` }} />
                  </div>
                  {/* Гости считаются параллельно и заканчиваются почти
                      одновременно, поэтому счётчик сверху почти всё время стоит
                      на нуле. Число запросов растёт непрерывно — по нему видно,
                      что работа идёт, а не встала. */}
                  <p className="overlay-live">
                    {calls > 0
                      ? `${calls} ${plural(calls, 'запрос', 'запроса', 'запросов')} к Туту`
                      : 'Подключаемся к Туту'}
                  </p>
                  <p className="overlay-note">
                    Обходим города-пересадки и проверяем, стыкуются ли рейсы по времени. Каждый гость
                    считается в обе стороны, поэтому первый расчёт занимает до минуты — повторные идут
                    за секунды.
                  </p>
                  {progress.guests.length > 0 && (
                    <p className="overlay-names">Готово: {progress.guests.map((guest) => guest.name).join(', ')}</p>
                  )}
                </>
              ) : (
                <>
                  <div className="pulse" />
                  <h2 className="overlay-title">Разбираем географию события</h2>
                  <p className="overlay-note">Определяем, откуда вообще можно въехать и выехать.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {!busy && (
        <ScenarioBar
          scenarios={scenarios}
          activeId={activeScenario}
          mode={mode}
          leg={hasReturn ? leg : 'outbound'}
          onPick={(scenario) => {
            setPlan(scenario.plan);
            setActiveScenario(scenario.id);
            setDestination(scenario.destination);
            setEndCity(scenario.plan.endCity === scenario.destination ? '' : scenario.plan.endCity);
            setDate(scenario.date);
            setReturnDate(scenario.returnDate ?? '');
            setSelectedCity(null);
          }}
          onDrop={(id) => setScenarios((previous) => previous.filter((scenario) => scenario.id !== id))}
        />
      )}

      {!busy && (
        <HealthBar
          plan={plan}
          mode={mode}
          leg={hasReturn ? leg : 'outbound'}
          opened={openedMetric}
          onOpen={setOpenedMetric}
        />
      )}

      {selected && <GuestSheet guest={selected} mode={mode} onClose={() => setSelectedCity(null)} />}
    </div>
  );
}
