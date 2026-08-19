/**
 * Блоки лендинга-приглашения.
 *
 * Приглашение к свадьбе, к корпоративному выезду и к сборам секции — это три
 * разные страницы. Жёсткий шаблон обслуживает их одинаково плохо, поэтому
 * страница собирается из блоков: организатор добавляет нужные, убирает лишние
 * и меняет порядок.
 *
 * Модель намеренно маленькая и закрытая: набор типов известен заранее, каждый
 * тип рисуется своим компонентом. Свободный HTML дал бы больше воли и сразу же
 * — дыру в безопасности и сломанную вёрстку на телефоне.
 */

export type BlockKind =
  | 'cover' | 'text' | 'image' | 'route' | 'schedule' | 'stay' | 'contacts' | 'rsvp';

export interface BaseBlock {
  id: string;
  kind: BlockKind;
}

/** Обложка: эмодзи, заголовок, место и даты. Всегда первая. */
export interface CoverBlock extends BaseBlock {
  kind: 'cover';
  cover: string;
  title: string;
  subtitle: string;
}

/** Произвольный текст: приветствие, дресс-код, всё остальное. */
export interface TextBlock extends BaseBlock {
  kind: 'text';
  heading: string;
  body: string;
}

/** Ядро продукта: выбор города и готовый маршрут. */
export interface RouteBlock extends BaseBlock {
  kind: 'route';
  heading: string;
  lead: string;
}

export interface ScheduleItem {
  time: string;
  text: string;
}

/** Программа: время и что происходит. */
export interface ScheduleBlock extends BaseBlock {
  kind: 'schedule';
  heading: string;
  items: ScheduleItem[];
}

/**
 * Где остановиться.
 *
 * Отель выбирается организатором из живой выдачи Туту и сохраняется вместе
 * с рейтингом и дословной цитатой из отзыва. Цитата — не украшение: она
 * единственное, что отличает «8.4 из 10» от понимания, чего ждать.
 */
export interface StayBlock extends BaseBlock {
  kind: 'stay';
  heading: string;
  /**
   * Порядок, в котором гостю предлагать другие варианты.
   *
   * Организатор рекомендует, но не решает за гостя: у того может быть свой
   * бюджет и свои требования, поэтому альтернативы всегда под рукой.
   */
  sort?: 'rating' | 'price';
  /** Идентификатор Туту — без него у гостя не запросить номера этого отеля. */
  hotelId?: string;
  hotelName: string;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
  price: number | null;
  nights: number | null;
  /** Дословная цитата из отзыва с датой — так требуют правила заземления MCP. */
  quote: string | null;
  quoteDate: string | null;
  url: string | null;
}

/** Картинка: фотография места, схема проезда, карта зала. */
export interface ImageBlock extends BaseBlock {
  kind: 'image';
  /** Адрес загруженного файла на нашем сервере. */
  src: string;
  caption: string;
}

export interface ContactsBlock extends BaseBlock {
  kind: 'contacts';
  heading: string;
  body: string;
}

/** Ответ гостя: едет или нет. */
export interface RsvpBlock extends BaseBlock {
  kind: 'rsvp';
  heading: string;
  lead: string;
}

export type Block =
  | CoverBlock
  | TextBlock
  | ImageBlock
  | RouteBlock
  | ScheduleBlock
  | StayBlock
  | ContactsBlock
  | RsvpBlock;

/** Набор по умолчанию — то, без чего приглашение не приглашение. */
export function defaultBlocks(): Block[] {
  return [
    { id: 'b-cover', kind: 'cover', cover: '💍', title: '', subtitle: '' },
    { id: 'b-text', kind: 'text', heading: '', body: '' },
    {
      id: 'b-route',
      kind: 'route',
      heading: 'Откуда вы поедете?',
      lead: 'Выберите город — маршрут уже посчитан и покажется сразу.',
    },
    // Жильё нужно почти всегда, а блок, который надо ещё догадаться добавить,
    // равносилен отсутствующему. Пустым он не считается: даже без выбора
    // организатора гость получает в нём живой список вариантов.
    {
      id: 'b-stay', kind: 'stay', heading: 'Где остановиться', sort: 'rating',
      hotelId: '', hotelName: '', address: null, rating: null, reviewCount: null,
      price: null, nights: null, quote: null, quoteDate: null, url: null,
    },
    { id: 'b-rsvp', kind: 'rsvp', heading: 'Вы едете?', lead: '' },
  ];
}

/**
 * Проверка блоков, пришедших от клиента.
 *
 * Страница публичная, поэтому в неё не должно попасть ничего, кроме известных
 * типов и текста ограниченной длины.
 */
export function normalizeBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];

  const blocks: Block[] = [];
  for (const entry of raw.slice(0, 20)) {
    const block = normalizeBlock(entry);
    if (block) blocks.push(block);
  }

  return blocks;
}

function normalizeBlock(raw: unknown): Block | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;

  const id = text(source.id, 40) || `b-${Math.random().toString(36).slice(2, 9)}`;
  const kind = source.kind;

  switch (kind) {
    case 'cover':
      return {
        id,
        kind,
        cover: text(source.cover, 8) || '✨',
        title: text(source.title, 120),
        subtitle: text(source.subtitle, 200),
      };
    case 'text':
    case 'contacts':
      return { id, kind, heading: text(source.heading, 120), body: text(source.body, 2000) };
    case 'image':
      return { id, kind, src: localUrl(source.src), caption: text(source.caption, 200) };
    case 'route':
    case 'rsvp':
      return { id, kind, heading: text(source.heading, 120), lead: text(source.lead, 400) };
    case 'schedule':
      return {
        id,
        kind,
        heading: text(source.heading, 120),
        items: (Array.isArray(source.items) ? source.items : []).slice(0, 30).map((item) => {
          const row = (item ?? {}) as Record<string, unknown>;
          return { time: text(row.time, 20), text: text(row.text, 200) };
        }),
      };
    case 'stay':
      return {
        id,
        kind,
        heading: text(source.heading, 120),
        sort: source.sort === 'price' ? 'price' : 'rating',
        hotelId: text(source.hotelId, 64),
        hotelName: text(source.hotelName, 160),
        address: text(source.address, 200) || null,
        rating: finite(source.rating),
        reviewCount: finite(source.reviewCount),
        price: finite(source.price),
        nights: finite(source.nights),
        quote: text(source.quote, 500) || null,
        quoteDate: text(source.quoteDate, 40) || null,
        url: url(source.url),
      };
    default:
      return null;
  }
}

function text(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength).trim() : '';
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Пустой ли блок.
 *
 * Организатор может добавить блок и передумать, вычистив текст. В редакторе
 * такой блок остаётся — человек, возможно, ещё вернётся к нему, — а гостю
 * показывать пустую карточку незачем.
 *
 * Блоки с собственным поведением (дорога, ответ, жильё) пустыми не считаются:
 * их ценность не в тексте, а в том, что они делают.
 */
export function isBlockEmpty(block: Block): boolean {
  switch (block.kind) {
    case 'text':
    case 'contacts':
      return !block.heading.trim() && !block.body.trim();
    case 'schedule':
      return block.items.every((item) => !item.time.trim() && !item.text.trim());
    case 'image':
      return !block.src;
    default:
      return false;
  }
}

/** Картинки принимаем только свои: чужой адрес — это чужой трекер на странице гостя. */
function localUrl(value: unknown): string {
  return typeof value === 'string' && /^\/uploads\/[\w.-]+$/.test(value) ? value : '';
}

/** Ссылки принимаем только http(s): `javascript:` на публичной странице недопустим. */
function url(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^https?:\/\//i.test(value) ? value.slice(0, 800) : null;
}
