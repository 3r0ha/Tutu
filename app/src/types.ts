/** Зеркало доменных типов бэкенда. Держится вручную — общий пакет ради пяти интерфейсов избыточен. */

export type Mode = 'avia' | 'railway' | 'bus' | 'etrain';
export type RiskLevel = 'safe' | 'tight' | 'critical';
/**
 * `direct` — прямое сообщение есть в обе нужные стороны;
 * `composed` — доедет и уедет, но хотя бы одно направление собрано склейкой;
 * `stranded` — доедет, а обратных рейсов Туту не вернул;
 * `unreachable` — не доедет.
 */
export type GuestStatus = 'direct' | 'composed' | 'stranded' | 'unreachable';

export interface Money {
  amount: number;
  currency: string;
}

export interface Hop {
  mode: Mode;
  /** Непрозрачная ссылка на плечо — нужна для запроса схемы мест. */
  detailsRef: Record<string, unknown> | null;
  /** Непрозрачная ссылка на оформление — из неё собирается корзина с выбранными местами. */
  checkoutRef: Record<string, unknown> | null;
  /** Оценка рейса пассажирами: рейтинг, число отзывов и шкала. */
  review: { rating: number; count: number; subject: string | null; scale: number } | null;
  /** Марка состава: «Ласточка», «Сапсан», двухэтажный. */
  vehicle: { name: string | null; premium: boolean; doubleDecker: boolean } | null;
  /** Классы мест с ценой «от» — приходят вместе с выдачей. */
  classes: Array<{ code: string; count: number; priceFrom: number }> | null;
  fromCity: string;
  toCity: string;
  fromPoint: string;
  toPoint: string;
  departureAt: string;
  /** Туту возвращает прибытие не всегда — у части рейсов в малые города его нет. */
  arrivalAt: string | null;
  durationMin: number | null;
  /** Цена плеча за всю компанию — приведена к общей основе на сервере. */
  price: Money;
  /** `per_seat` — сумма получена умножением цены места на число пассажиров. */
  priceBasis: 'party' | 'per_seat';
  pricePerSeat: number | null;
  carriers: string[];
  segmentsCount: number;
  searchResultsUrl: string | null;
  checkoutUrl: string | null;
}

export interface OvernightStay {
  city: string;
  checkIn: string;
  checkOut: string;
  hotelName: string;
  price: Money;
  checkoutUrl: string | null;
}

export interface TransferRisk {
  level: RiskLevel;
  fallbacksLater: number;
  nextFallbackAt: string | null;
  note: string;
}

export interface Transfer {
  city: string;
  arriveAt: string;
  departAt: string;
  waitMin: number;
  /** Переезд между вокзалами или аэропортами внутри города пересадки. */
  move: { from: string; to: string } | null;
  overnight: OvernightStay | null;
  risk: TransferRisk;
}

export interface Journey {
  id: string;
  kind: 'direct' | 'composed';
  hops: Hop[];
  transfers: Transfer[];
  via: string[];
  departureAt: string;
  arrivalAt: string | null;
  totalDurationMin: number | null;
  ticketsPrice: Money;
  lodgingPrice: Money | null;
  totalPrice: Money;
  risk: RiskLevel;
}

/** Одно направление поездки со всеми найденными вариантами. */
export interface Direction {
  best: Journey | null;
  directBest: Journey | null;
  alternatives: Journey[];
  /** Дата, на которую маршрут в итоге нашёлся. */
  date: string;
  /** Сдвиг от даты события: 0 — день в день, −1 — накануне. */
  shiftDays: number;
  note: string;
}

export interface GuestPlan {
  name: string;
  city: string;
  status: GuestStatus;
  outbound: Direction;
  /** `null`, если обратная дата не запрашивалась. */
  inbound: Direction | null;
  totalPrice: Money | null;
  note: string;
}

export interface EventSummary {
  guests: number;
  reachableDirect: number;
  reachableComposed: number;
  unreachable: number;
  /** Доедут, но обратных рейсов не нашлось. */
  stranded: number;
  totalCost: number;
  currency: string;
  atRisk: number;
}

export interface Coordinates {
  lat: number;
  lon: number;
  source: 'catalog' | 'ai';
}

/** То, что нужно карте. Полный план ему соответствует, частичный — тоже. */
export interface MapPlan {
  destination: string;
  guests: GuestPlan[];
  coordinates: Record<string, Coordinates>;
  destinationCoordinates: Coordinates | null;
}

export interface EventPlan {
  destination: string;
  /** Город окончания события. */
  endCity: string;
  date: string;
  returnDate: string | null;
  guests: GuestPlan[];
  summary: EventSummary;
  coordinates: Record<string, Coordinates>;
  destinationCoordinates: Coordinates | null;
  elapsedMs: number;
}

export interface ParsedEvent {
  destination: string | null;
  date: string | null;
  title: string | null;
  guests: Array<{ name: string; city: string }>;
}

export interface Guest {
  id: string;
  name: string;
  city: string;
}

/** Режим показа: как ищет сам Туту против того, что даёт склейка. */
export type ViewMode = 'direct' | 'composed';

/** Направление, показываемое на карте. */
export type Leg = 'outbound' | 'inbound';

export interface InviteTheme {
  /** Фирменный ключ либо свой цвет вида `#a181ff`. */
  palette: string;
  /** Цвет текста; `null` — считать от фона. */
  ink: string | null;
  cover: string;
}

/**
 * Приглашение глазами гостя — без ключа управления.
 *
 * Ключ сервер вырезает из гостевого ответа намеренно: кто им владеет, тот
 * управляет событием.
 */
export interface Invite {
  id: string;
  title: string;
  greeting: string;
  destination: string;
  venue: string | null;
  date: string;
  returnDate: string | null;
  guests: Array<{ name: string; city: string; slug: string }>;
  theme: InviteTheme;
  /** Страница, собранная организатором из блоков. */
  blocks: import('./blocks.ts').Block[];
  /** Маршруты, посчитанные при публикации. */
  routes: Array<{ city: string; plan: GuestPlan }>;
  computedAt: string | null;
  createdAt: string;
}

/** Ответ на публикацию: здесь ключ управления есть — он нужен создателю. */
export interface CreatedInvite extends Invite {
  manageKey: string;
}


/** Ответ гостя на приглашение. */
export interface Rsvp {
  id: string;
  inviteId: string;
  name: string;
  city: string;
  attending: boolean;
  travellers: number;
  routeSummary: string | null;
  price: number | null;
  comment: string | null;
  createdAt: string;
}

export interface RsvpSummary {
  answered: number;
  attending: number;
  declined: number;
  /** Перечислены организатором, но ещё не ответили. */
  silent: number;
  travellers: number;
  confirmedCost: number;
}

export interface RsvpBoard {
  items: Rsvp[];
  summary: RsvpSummary;
}


export interface SeatableLeg {
  key: string;
  label: string;
  transport: 'railway' | 'bus';
  detailsRef: Record<string, unknown>;
  checkoutRef: Record<string, unknown> | null;
}

export interface SeatBlock {
  carNumber: string | null;
  carType: string | null;
  serviceClass: string | null;
  compartment: number | null;
  seats: Array<{ number: string; type: string | null }>;
  price: Money | null;
  fareType: string | null;
  gender: string | null;
  /** Корзина Туту с уже выбранными местами этого блока. */
  cartUrl: string | null;
}

export type SeatingStatus = 'together' | 'split' | 'partial' | 'impossible' | 'unavailable';

export interface SeatingPlan {
  party: number;
  status: SeatingStatus;
  blocks: SeatBlock[];
  seated: number;
  largestTogether: number | null;
  totalPrice: Money | null;
  note: string;
}

export interface SeatingGroup {
  key: string;
  label: string;
  names: string[];
  seating: SeatingPlan;
}

export interface SeatingBoardData {
  groups: SeatingGroup[];
  skipped: number;
}
