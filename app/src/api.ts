import type {
  Coordinates,
  CreatedInvite,
  EventPlan,
  GuestPlan,
  Guest,
  Invite,
  ParsedEvent,
  SeatableLeg,
  Rsvp,
  RsvpBoard,
  SeatingBoardData,
} from './types.ts';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Ошибка ${response.status}`);
  }
  return (await response.json()) as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface EventProgress {
  onGeo: (geo: { coordinates: Record<string, Coordinates>; destination: Coordinates | null }) => void;
  onGuest: (guest: GuestPlan) => void;
  /** Сколько запросов к Туту уже сделано — единственный показатель, который движется всё время. */
  onTick?: (calls: number) => void;
}

/**
 * Расчёт события с показом промежуточных результатов.
 *
 * Сервер отдаёт NDJSON: сначала координаты известных точек, затем гостей по
 * мере готовности, в конце — итоговый план. Ждать десятки секунд перед пустым
 * экраном незачем, когда часть ответа готова почти сразу.
 */
export interface EventWhen {
  startCity: string;
  endCity: string;
  startDate: string;
  endDate: string | null;
}

export async function planEvent(
  when: EventWhen,
  guests: Guest[],
  progress?: EventProgress,
): Promise<EventPlan> {
  const response = await fetch('/api/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify({
      ...when,
      guests: guests.map((guest) => ({ name: guest.name, city: guest.city })),
    }),
  });

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Ошибка ${response.status}`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let plan: EventPlan | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    // Последний кусок может оборваться посреди строки — он ждёт следующего чтения.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as
        | { type: 'geo'; coordinates: Record<string, Coordinates>; destination: Coordinates | null }
        | { type: 'guest'; guest: GuestPlan }
        | { type: 'done'; plan: EventPlan }
        | { type: 'tick'; calls: number }
        | { type: 'error'; message: string };

      if (event.type === 'geo') progress?.onGeo(event);
      else if (event.type === 'guest') progress?.onGuest(event.guest);
      else if (event.type === 'tick') progress?.onTick?.(event.calls);
      else if (event.type === 'done') plan = event.plan;
      else throw new Error(event.message);
    }
  }

  if (!plan) throw new Error('Расчёт оборвался: сервер не прислал итог');
  return plan;
}

export function parseIntent(text: string): Promise<ParsedEvent> {
  return post<ParsedEvent>('/api/intent', { text });
}

export interface InviteDraft {
  title: string;
  greeting: string;
  destination: string;
  endCity: string;
  venue: string | null;
  date: string;
  returnDate: string | null;
  guests: Guest[];
  theme: { palette: string; ink: string | null; cover: string };
  blocks: import('./blocks.ts').Block[];
  /** Уже посчитанные маршруты: гость не должен ждать пересчёта. */
  routes: Array<{ city: string; plan: GuestPlan }>;
}

export function createInvite(draft: InviteDraft): Promise<CreatedInvite> {
  return post<CreatedInvite>('/api/invite', {
    ...draft,
    guests: draft.guests.map((guest) => ({ name: guest.name, city: guest.city })),
  });
}

export function fetchInvite(id: string): Promise<Invite> {
  return request<Invite>(`/api/invite/${id}`);
}

export interface RouteRequest {
  city: string;
  adults?: number;
  /** На сколько дней приехать раньше начала события. */
  arriveEarlier?: number;
  /** На сколько дней уехать позже окончания. */
  departLater?: number;
}

/** Личный маршрут гостя: город и, если он хочет, собственные даты. */
export function fetchInviteRoute(
  id: string,
  request: RouteRequest,
): Promise<{ invite: Invite; plan: EventPlan }> {
  return post(`/api/invite/${id}/route`, request);
}


export interface RsvpInput {
  name: string;
  city: string;
  attending: boolean;
  travellers: number;
  routeSummary: string | null;
  price: number | null;
  comment: string | null;
  seatableLegs: SeatableLeg[];
}

export function submitRsvp(inviteId: string, input: RsvpInput): Promise<Rsvp> {
  return post<Rsvp>(`/api/invite/${inviteId}/rsvp`, input);
}

export function fetchRsvpBoard(inviteId: string): Promise<RsvpBoard> {
  return request<RsvpBoard>(`/api/invite/${inviteId}/rsvp`);
}


export function fetchSeating(inviteId: string): Promise<SeatingBoardData> {
  return request<SeatingBoardData>(`/api/invite/${inviteId}/seating`);
}

export interface ManageView {
  invite: CreatedInvite;
  answers: Rsvp[];
}

/** Событие глазами организатора — доступно только по ключу управления. */
export function fetchManaged(id: string, key: string): Promise<ManageView> {
  return request<ManageView>(`/api/invite/${id}/manage/${key}`);
}

export function updateInvite(
  id: string,
  key: string,
  patch: Record<string, unknown>,
): Promise<Invite> {
  return request<Invite>(`/api/invite/${id}/manage/${key}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export interface EventSummaryRow {
  id: string;
  manageKey: string;
  title: string;
  destination: string;
  date: string;
  returnDate: string | null;
  theme: { palette: string; ink: string | null; cover: string };
  guests: number;
  answered: number;
  attending: number;
  declined: number;
  travellers: number;
  confirmedCost: number;
  computedAt: string | null;
  createdAt: string;
}

/** Рабочий стол: события, к которым у этого браузера есть ключи. */
export function fetchEvents(keys: string[]): Promise<{ events: EventSummaryRow[] }> {
  return post('/api/events', { keys });
}

/**
 * Что доступно на этом стенде.
 *
 * На демо-развёртывании ключа к модели нет, и разбор события словами там
 * работать не может. Интерфейс спрашивает об этом один раз при запуске,
 * чтобы не предлагать то, чего нет.
 */
export async function fetchConfig(): Promise<{ ai: boolean }> {
  try {
    return await request<{ ai: boolean }>('/api/config');
  } catch {
    // Стенд без этой ручки — старый сервер; считаем, что модели нет.
    return { ai: false };
  }
}
