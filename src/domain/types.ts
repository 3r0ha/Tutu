/**
 * Доменная модель маршрута.
 *
 * Ключевое отличие от модели Туту: там единица — предложение на паре городов,
 * здесь — поездка целиком, склеенная из нескольких купленных отдельно билетов.
 * Всё, что делает такую склейку рискованной (окно пересадки, ночёвка, запасные
 * рейсы), выражено явными полями, а не спрятано в примечании.
 */

export type Mode = 'avia' | 'railway' | 'bus' | 'etrain';

export interface Money {
  amount: number;
  currency: string;
}

/** Одно плечо — ровно один билет, купленный отдельным заказом. */
export interface Hop {
  mode: Mode;
  fromCity: string;
  toCity: string;
  fromPoint: string;
  toPoint: string;
  departureAt: string;
  /**
   * Время прибытия Туту возвращает не всегда — у части автобусных рейсов в
   * малые населённые пункты его просто нет. Такое плечо годится последним
   * в маршруте (стыковка считается по отправлению) и не годится промежуточным.
   */
  arrivalAt: string | null;
  durationMin: number | null;
  /**
   * Цена плеча за всю компанию.
   *
   * Туту отдаёт разное по видам транспорта: у самолёта и автобуса `price` уже
   * покрывает всех запрошенных пассажиров, у поезда и электрички это цена
   * одного самого дешёвого места (`fares.price_from`). Складывать их напрямую
   * нельзя — при поездке вдвоём получалось число, которое не означает ни
   * «за одного», ни «за всех». Здесь всё приведено к сумме за компанию.
   */
  price: Money;
  /** Из чего получена цена: ответ Туту как есть или умножение на число мест. */
  priceBasis: 'party' | 'per_seat';
  /** Цена одного места, когда Туту вернул именно её. */
  pricePerSeat: number | null;
  carriers: string[];
  segmentsCount: number;
  searchResultsUrl: string | null;
  checkoutUrl: string | null;
  /**
   * Непрозрачная ссылка на плечо для уточняющих запросов (карта мест).
   * Передаётся в Туту дословно и нами не разбирается.
   */
  detailsRef: Record<string, unknown> | null;
  /**
   * Ссылка на оформление этого же плеча. Отличается от `detailsRef` тем, что
   * нужна не для уточнений, а для сборки корзины с выбранными местами.
   * Тоже непрозрачная: раскладывается в аргументы `create_checkout_link` как есть.
   */
  checkoutRef: Record<string, unknown> | null;
  /**
   * Оценка самого рейса пассажирами — Туту отдаёт её прямо в выдаче.
   *
   * Два поезда на одну дату часто стоят одинаково, и тогда цена ничего не
   * решает, а 7.2 против 7.8 при сотне отзывов — решает.
   */
  review: { rating: number; count: number; subject: string | null; scale: number } | null;
  /** Марка состава: «Ласточка», «Сапсан», двухэтажный. У обычного поезда её нет. */
  vehicle: { name: string | null; premium: boolean; doubleDecker: boolean } | null;
  /**
   * Классы мест с ценой «от».
   *
   * Цена рейса — это цена самого дешёвого места в нём. Человек, которому нужно
   * купе, по ней ничего не решит, а расклад по классам приходит в той же
   * выдаче и не стоит ни одного дополнительного запроса.
   */
  classes: Array<{ code: string; count: number; priceFrom: number }> | null;
}

export interface OvernightStay {
  city: string;
  checkIn: string;
  checkOut: string;
  hotelName: string;
  price: Money;
  checkoutUrl: string | null;
}

export type RiskLevel = 'safe' | 'tight' | 'critical';

/**
 * Риск пересадки. Считается не по длине окна, а по числу запасных рейсов:
 * сорокаминутная стыковка в Москве безопаснее двухчасовой в городе, куда
 * автобус ходит дважды в сутки.
 */
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
  /**
   * Переезд между вокзалами или аэропортами внутри города, если он есть.
   *
   * «Пересадка в Москве» ничего не говорит о том, что между рейсами надо
   * пересечь город: это видно, только если назвать обе точки.
   */
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
  /** От первого отправления до последнего прибытия, включая ожидание на пересадках. */
  totalDurationMin: number | null;
  ticketsPrice: Money;
  lodgingPrice: Money | null;
  totalPrice: Money;
  risk: RiskLevel;
}

export interface CityRef {
  name: string;
  geoId: string | null;
  region: string | null;
}

/** Почему из этого города доехать не удалось — показывается пользователю дословно. */
export interface Unreachable {
  reason: 'no_direct' | 'no_exit' | 'no_gateway' | 'no_connection' | 'upstream_failed';
  note: string;
}

/**
 * Отчёт о подборе шлюзов.
 *
 * Держим гипотезы и подтверждения раздельно намеренно: это делает видимой
 * границу между тем, что предположила модель, и тем, что подтвердили данные.
 */
export interface GatewayReport {
  proposedByAi: string[];
  fromCatalog: string[];
  /** Шлюзы, откуда въезд в пункт назначения реально нашёлся. */
  confirmed: string[];
  /** Шлюзы, до которых удалось доехать из города отправления. */
  reachableFromOrigin: string[];
  aiProvider: string;
}

export interface PlanResult {
  origin: CityRef;
  destination: CityRef;
  date: string;
  journeys: Journey[];
  directCount: number;
  composedCount: number;
  gateways: GatewayReport;
  unreachable: Unreachable | null;
  diagnostics: PlanDiagnostics;
}

export interface PlanDiagnostics {
  mcpCalls: number;
  cacheHits: number;
  retries: number;
  failures: number;
  elapsedMs: number;
}
