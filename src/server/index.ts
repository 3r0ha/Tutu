/**
 * HTTP-слой: тонкая обёртка над движком плюс раздача статики.
 *
 * Зависимостей нет намеренно. Движок делает десятки сетевых вызовов на запрос,
 * и единственный источник нестабильности, который мы можем устранить полностью, —
 * это наш собственный стек.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { McpClient } from '../mcp/client.ts';
import { planRoute } from '../engine/planner.ts';
import { planEvent, type EventWhen, type Guest } from '../engine/event.ts';
import { suggestVenues } from '../engine/venues.ts';
import { listRates, suggestStays } from '../engine/stays.ts';
import { addDays } from '../engine/planner.ts';
import { defaultBlocks, normalizeBlocks } from '../domain/blocks.ts';
import { saveUpload, readUpload } from '../store/uploads.ts';
import {
  createInvite,
  getInvite,
  listInvitesByKeys,
  listRsvp,
  saveRsvp,
  updateInvite,
  type InviteTheme,
  type SeatableLeg,
  type StoredRoute,
} from '../store/invites.ts';
import { planSeating } from '../engine/seating.ts';
import { parseEventIntent } from '../ai/intent.ts';
import { aiEnabled, getProvider } from '../ai/provider.ts';
import { checkLimit, clientKey, HEAVY, LIGHT, MEDIUM, UPLOAD, type Limit } from './limits.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB_DIR = join(ROOT, 'app', 'dist');
const PORT = Number(process.env.PORT ?? 5174);

// Один клиент на процесс: кэш общий, поэтому гости события переиспользуют
// уже загруженные плечи вместо повторного обхода тех же городов.
/**
 * Предел одновременных запросов к Туту.
 *
 * Расчёт события — это сотни вызовов, и время упирается именно в него.
 * Замеры показали, что сервер Туту держит два десятка параллельных запросов
 * без отказов, поэтому предел поднят и вынесен в окружение: на слабой машине
 * или плохом канале его можно вернуть вниз, не трогая код.
 */
const MCP_CONCURRENCY = Number(process.env.SKLEJKA_MCP_CONCURRENCY ?? 16);

const mcp = new McpClient({ maxConcurrent: MCP_CONCURRENCY });

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

/**
 * За обратным прокси настоящий адрес клиента приходит в заголовке. Верить ему
 * можно только когда прокси действительно наш — иначе ограничение частоты
 * обходится одной подделанной строкой.
 */
const TRUST_PROXY = process.env.SKLEJKA_TRUST_PROXY === '1';

/**
 * Заголовки безопасности.
 *
 * Страница приглашения публичная и содержит пользовательский текст, поэтому
 * политика содержимого запрещает всё, чего мы сами не отдаём. `unsafe-inline`
 * для стилей оставлен намеренно: цвет страницы организатор выбирает свой, и он
 * приезжает переменными в атрибуте `style`. Скрипты такого исключения не имеют.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': [
    "default-src 'self'",
    "img-src 'self' data:",
    // Шрифты берутся у Google Fonts: без этих двух источников политика
    // молча роняет типографику до системной. У меня это не было заметно —
    // браузер держал шрифты в кэше с прошлых заходов.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "script-src 'self'",
    // Ходим только к себе: Туту опрашивает сервер, а не браузер.
    "connect-src 'self'",
    // Внутрь себя ничего не встраиваем и встраивать себя не даём.
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  // Ни одно из этих устройств продукту не нужно.
  'permissions-policy': 'geolocation=(), camera=(), microphone=(), payment=()',
};

const server = createServer((request, response) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);

  handle(request, response).catch((error: unknown) => {
    // Наружу уходит факт отказа, а не внутренности: текст исключения может
    // содержать пути и параметры запроса к Туту.
    console.error('необработанная ошибка:', error);
    sendJson(response, 500, { error: 'внутренняя ошибка' });
  });
});

/**
 * Проверка частоты перед обработкой.
 *
 * Возвращает `true`, когда запрос отбит и ответ уже отправлен.
 */
function throttled(request: IncomingMessage, response: ServerResponse, limit: Limit): boolean {
  const key = clientKey(request.socket.remoteAddress, request.headers['x-forwarded-for'], TRUST_PROXY);
  const verdict = checkLimit(key, limit);
  if (verdict.allowed) return false;

  response.setHeader('retry-after', String(verdict.retryAfterSec));
  sendJson(response, 429, {
    error: `слишком часто, попробуйте через ${verdict.retryAfterSec} с`,
  });
  return true;
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname === '/api/health') {
    return sendJson(response, 200, { ok: true, ai: getProvider().name, mcp: mcp.stats });
  }
  if (url.pathname === '/api/config') {
    // Интерфейс должен знать о выключенной модели заранее, а не по отказу.
    return sendJson(response, 200, { ai: aiEnabled() });
  }
  // Расчёт маршрутов стоит сотен обращений к Туту — он считается штучно.
  if (url.pathname === '/api/plan') {
    if (throttled(request, response, HEAVY)) return;
    return handlePlan(url, response);
  }
  if (url.pathname === '/api/event' && request.method === 'POST') {
    if (throttled(request, response, HEAVY)) return;
    return handleEvent(request, response);
  }
  if (url.pathname === '/api/intent' && request.method === 'POST') {
    if (throttled(request, response, MEDIUM)) return;
    return handleIntent(request, response);
  }
  if (url.pathname === '/api/invite' && request.method === 'POST') {
    if (throttled(request, response, MEDIUM)) return;
    return handleCreateInvite(request, response);
  }
  if (url.pathname === '/api/events' && request.method === 'POST') {
    return handleListEvents(request, response);
  }
  if (url.pathname === '/api/venues' && request.method === 'POST') {
    if (throttled(request, response, HEAVY)) return;
    return handleVenues(request, response);
  }
  if (url.pathname === '/api/stays' && request.method === 'POST') {
    if (throttled(request, response, MEDIUM)) return;
    return handleStays(request, response);
  }
  if (url.pathname === '/api/rooms' && request.method === 'POST') {
    if (throttled(request, response, MEDIUM)) return;
    return handleRooms(request, response);
  }
  if (url.pathname === '/api/purchase' && request.method === 'POST') {
    if (throttled(request, response, MEDIUM)) return;
    return handlePurchase(request, response);
  }
  if (url.pathname === '/api/upload' && request.method === 'POST') {
    if (throttled(request, response, UPLOAD)) return;
    return handleUpload(request, response);
  }
  if (url.pathname.startsWith('/uploads/')) {
    return handleUploadedFile(url.pathname, response);
  }

  // Рабочий стол организатора: доступ только по ключу управления.
  if (throttled(request, response, LIGHT)) return;

  const manageRoute = url.pathname.match(/^\/api\/invite\/([a-z0-9]{4,32})\/manage\/([a-z0-9]{16,64})$/);
  if (manageRoute) {
    const [, id, key] = manageRoute;
    if (request.method === 'GET') return handleManageGet(id, key, response);
    if (request.method === 'PATCH') return handleManagePatch(id, key, request, response);
  }

  const inviteRoute = url.pathname.match(/^\/api\/invite\/([a-z0-9]{4,32})(?:\/(route|rsvp|seating))?$/);
  if (inviteRoute) {
    const [, id, action] = inviteRoute;
    if (action === 'route' && request.method === 'POST') return handleInviteRoute(id, request, response);
    if (action === 'rsvp' && request.method === 'POST') return handleRsvp(id, request, response);
    if (action === 'rsvp' && request.method === 'GET') return handleListRsvp(id, response);
    if (action === 'seating' && request.method === 'GET') return handleSeating(id, response);
    if (!action && request.method === 'GET') return handleGetInvite(id, response);
  }

  return serveStatic(url.pathname, response);
}

async function handlePlan(url: URL, response: ServerResponse): Promise<void> {
  const origin = url.searchParams.get('origin')?.trim();
  const destination = url.searchParams.get('destination')?.trim();
  const date = url.searchParams.get('date')?.trim();

  if (!origin || !destination || !date) {
    return sendJson(response, 400, { error: 'нужны параметры origin, destination, date' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return sendJson(response, 400, { error: 'date должен быть в формате YYYY-MM-DD' });
  }

  const plan = await planRoute(mcp, origin, destination, date, {
    adults: clampInt(url.searchParams.get('adults'), 1, 9, 1),
    directOnly: url.searchParams.get('directOnly') === '1',
  });
  sendJson(response, 200, plan);
}

async function handleEvent(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson<{
    startCity?: string;
    endCity?: string;
    startDate?: string;
    endDate?: string | null;
    guests?: Guest[];
  }>(request);

  const when = readWhen(body);
  if (!when) {
    return sendJson(response, 400, {
      error: 'нужны startCity и startDate в формате YYYY-MM-DD',
    });
  }

  const guests = normalizeGuests(body?.guests);
  if (guests.length === 0) {
    return sendJson(response, 400, { error: 'список гостей пуст' });
  }

  // Расчёт занимает десятки секунд, и ждать его молча незачем: клиент,
  // попросивший поток, получает координаты сразу, а гостей — по мере готовности.
  if (request.headers.accept?.includes('application/x-ndjson')) {
    return streamEvent(response, when, guests);
  }

  const plan = await planEvent(mcp, when, guests);
  sendJson(response, 200, plan);
}

/**
 * Разбор дат события.
 *
 * Это даты проведения, а не поездки гостя, и событие может заканчиваться
 * в другом городе — поэтому мест два, а не одно.
 */
function readWhen(body: {
  startCity?: string;
  endCity?: string;
  startDate?: string;
  endDate?: string | null;
} | null): EventWhen | null {
  const startCity = body?.startCity?.trim();
  const startDate = body?.startDate?.trim();
  if (!startCity || !isIsoDate(startDate)) return null;

  const endDate = body?.endDate?.trim() || null;
  if (endDate && !isIsoDate(endDate)) return null;

  return {
    startCity,
    endCity: body?.endCity?.trim() || startCity,
    startDate,
    endDate,
  };
}

async function streamEvent(
  response: ServerResponse,
  when: EventWhen,
  guests: Guest[],
): Promise<void> {
  response.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache',
    // Прокси любят копить ответ целиком — тогда весь смысл потока теряется.
    'x-accel-buffering': 'no',
  });

  const emit = (event: unknown): void => {
    response.write(`${JSON.stringify(event)}\n`);
  };

  /**
   * Отсчёт живой работы.
   *
   * Гости считаются параллельно и заканчиваются почти одновременно, поэтому
   * счётчик «0 из 4» стоит без движения почти до самого конца — а неподвижный
   * экран через полминуты читается как зависший. Число запросов к Туту растёт
   * непрерывно и честно показывает, что работа идёт.
   */
  const started = mcp.stats.calls;
  const ticker = setInterval(() => {
    emit({ type: 'tick', calls: mcp.stats.calls - started });
  }, 900);

  try {
    const plan = await planEvent(mcp, when, guests, {
      onGeo: (geo) => emit({ type: 'geo', ...geo }),
      onGuest: (guest) => emit({ type: 'guest', guest }),
    });
    emit({ type: 'done', plan });
  } catch (error) {
    emit({ type: 'error', message: error instanceof Error ? error.message : 'расчёт не удался' });
  } finally {
    clearInterval(ticker);
    response.end();
  }
}

async function handleCreateInvite(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson<{
    title?: string;
    greeting?: string;
    destination?: string;
    venue?: string;
    date?: string;
    returnDate?: string | null;
    guests?: Guest[];
    endCity?: string;
    theme?: Partial<InviteTheme>;
    blocks?: unknown;
    routes?: StoredRoute[];
  }>(request);

  const destination = body?.destination?.trim();
  const date = body?.date?.trim();

  if (!destination || !isIsoDate(date)) {
    return sendJson(response, 400, { error: 'нужны destination и date в формате YYYY-MM-DD' });
  }

  const returnDate = body?.returnDate?.trim() || null;
  if (returnDate && !isIsoDate(returnDate)) {
    return sendJson(response, 400, { error: 'returnDate должен быть в формате YYYY-MM-DD' });
  }

  const routes = normalizeRoutes(body?.routes);

  const invite = await createInvite({
    title: (body?.title ?? 'Приглашение').slice(0, 120).trim() || 'Приглашение',
    greeting: (body?.greeting ?? '').slice(0, 600).trim(),
    destination,
    endCity: body?.endCity?.trim() || destination,
    venue: body?.venue?.slice(0, 200).trim() || null,
    date,
    returnDate,
    guests: withSlugs(normalizeGuests(body?.guests)),
    theme: {
      palette: normalizePalette(body?.theme?.palette),
      ink: normalizeInk(body?.theme?.ink),
      cover: (body?.theme?.cover ?? '💍').slice(0, 8),
    },
    // Пустой набор блоков — законный случай для старых записей и запасного пути.
    blocks: normalizeBlocks(body?.blocks).length > 0 ? normalizeBlocks(body?.blocks) : defaultBlocks(),
    routes,
    // Момент расчёта важен: цены живые, и через день они уже другие.
    computedAt: routes.length > 0 ? new Date().toISOString() : null,
  });

  sendJson(response, 201, invite);
}

async function handleGetInvite(id: string, response: ServerResponse): Promise<void> {
  const invite = await getInvite(id);
  if (!invite) return sendJson(response, 404, { error: 'приглашение не найдено' });
  // Гостю ключ управления не нужен и знать его он не должен.
  const { manageKey, ...guestView } = invite;
  void manageKey;
  sendJson(response, 200, guestView);
}

async function handleManageGet(id: string, key: string, response: ServerResponse): Promise<void> {
  const invite = await getInvite(id);
  if (!invite || invite.manageKey !== key) {
    return sendJson(response, 404, { error: 'событие не найдено или ссылка недействительна' });
  }
  const answers = await listRsvp(id);
  sendJson(response, 200, { invite, answers });
}

async function handleManagePatch(
  id: string,
  key: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJson<Record<string, unknown>>(request);
  if (!body) return sendJson(response, 400, { error: 'пустое тело запроса' });

  const patch: Record<string, unknown> = {};
  if (typeof body.title === 'string') patch.title = body.title.slice(0, 120).trim();
  if (typeof body.greeting === 'string') patch.greeting = body.greeting.slice(0, 600).trim();
  if (typeof body.venue === 'string') patch.venue = body.venue.slice(0, 200).trim() || null;
  if (body.theme && typeof body.theme === 'object') {
    const theme = body.theme as Partial<InviteTheme>;
    patch.theme = {
      palette: normalizePalette(theme.palette),
      ink: normalizeInk(theme.ink),
      cover: (theme.cover ?? '✨').slice(0, 8),
    };
  }
  if (body.blocks !== undefined) patch.blocks = normalizeBlocks(body.blocks);
  if (Array.isArray(body.routes)) {
    patch.routes = normalizeRoutes(body.routes);
    // Пересобрали маршруты — значит и отметка свежести обновилась.
    patch.computedAt = new Date().toISOString();
  }

  const updated = await updateInvite(id, key, patch);
  if (!updated) return sendJson(response, 404, { error: 'событие не найдено или ссылка недействительна' });
  sendJson(response, 200, updated);
}

/**
 * Подбор места встречи.
 *
 * Переворачивает вопрос организатора: не «доедут ли до Суздаля», а «где
 * собраться». Оценка грубая, по прямому сообщению — и об этом сказано в ответе.
 */
async function handleVenues(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson<{ guests?: Guest[]; date?: string }>(request);
  const date = body?.date?.trim();
  if (!isIsoDate(date)) {
    return sendJson(response, 400, { error: 'нужна date в формате YYYY-MM-DD' });
  }

  const guests = normalizeGuests(body?.guests);
  if (guests.length === 0) return sendJson(response, 400, { error: 'список гостей пуст' });

  sendJson(response, 200, await suggestVenues(mcp, guests, date));
}

/**
 * Отели рядом с местом события — для блока «где остановиться».
 *
 * Вместе с ценой и рейтингом возвращается дословная цитата из отзыва: «8.4 из
 * 10» ничего не говорит о том, чего ждать, а живая фраза говорит. Правила
 * заземления MCP требуют именно цитировать, а не пересказывать.
 */
async function handleStays(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson<{
    city?: string;
    checkIn?: string;
    checkOut?: string;
    sort?: string;
    adults?: number;
  }>(request);
  const city = body?.city?.trim();
  const checkIn = body?.checkIn?.trim();
  const checkOut = body?.checkOut?.trim();

  if (!city || !isIsoDate(checkIn) || !isIsoDate(checkOut)) {
    return sendJson(response, 400, { error: 'нужны city, checkIn и checkOut' });
  }

  const sort = body?.sort === 'price' ? 'price' : 'rating';
  const adults = clampNumber(body?.adults, 1, 9, 2);
  sendJson(response, 200, await suggestStays(mcp, city, checkIn, checkOut, sort, adults));
}

/**
 * Ссылка на покупку конкретного рейса.
 *
 * У авиаварианта Туту не отдаёт `checkout_url` вовсе — только адрес списка
 * результатов. Гость, нажавший «Билет», попадал не на свой рейс, а в выдачу,
 * где его надо искать заново, да ещё и с одним пассажиром вместо четырёх.
 * Ссылку на сам билет собирает `create_checkout_link`, и делается это по
 * требованию: во время расчёта таких вызовов были бы сотни.
 */
async function handlePurchase(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson<{ checkoutRef?: Record<string, unknown> }>(request);
  const ref = body?.checkoutRef;
  if (!ref || typeof ref !== 'object') {
    return sendJson(response, 400, { error: 'нужен checkoutRef' });
  }

  const link = await mcp.callToolSafe<{ kind?: string; checkout_url?: string }>(
    'create_checkout_link',
    ref,
  );

  sendJson(response, 200, { url: link?.checkout_url ?? null, kind: link?.kind ?? null });
}

/** Номера выбранного отеля — с корзиной на каждый тариф. */
async function handleRooms(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson<{
    city?: string;
    hotelId?: string;
    checkIn?: string;
    checkOut?: string;
    adults?: number;
  }>(request);

  const city = body?.city?.trim();
  const hotelId = body?.hotelId?.trim();
  const checkIn = body?.checkIn?.trim();
  const checkOut = body?.checkOut?.trim();

  if (!city || !hotelId || !isIsoDate(checkIn) || !isIsoDate(checkOut)) {
    return sendJson(response, 400, { error: 'нужны city, hotelId, checkIn и checkOut' });
  }

  const adults = clampNumber(body?.adults, 1, 9, 2);
  sendJson(response, 200, await listRates(mcp, city, hotelId, checkIn, checkOut, adults));
}

/**
 * Загрузка картинки для блока.
 *
 * Файл приходит строкой base64 внутри JSON — это дороже multipart по объёму,
 * но снимает разбор границ и лишнюю зависимость ради одной формы. Принимаются
 * только картинки и только до предела по размеру: страница публичная.
 */
async function handleUpload(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson<{ data?: string; type?: string }>(request, MAX_UPLOAD_BODY_BYTES);
  if (!body?.data || !body.type) return sendJson(response, 400, { error: 'нужны data и type' });

  const saved = await saveUpload(body.data, body.type);
  if (!saved) {
    return sendJson(response, 400, {
      error: 'принимаются картинки JPEG, PNG, WebP или GIF размером до 4 МБ',
    });
  }

  sendJson(response, 201, { src: saved });
}

async function handleUploadedFile(pathname: string, response: ServerResponse): Promise<void> {
  const file = await readUpload(pathname);
  if (!file) return sendJson(response, 404, { error: 'not found' });

  response.writeHead(200, {
    'content-type': file.type,
    // Имя файла содержит хеш содержимого, поэтому кэшировать можно надолго.
    'cache-control': 'public, max-age=31536000, immutable',
  });
  response.end(file.bytes);
}

/** Список событий по ключам управления — витрина для тех, кто возит группы постоянно. */
async function handleListEvents(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson<{ keys?: string[] }>(request);
  const keys = (Array.isArray(body?.keys) ? body.keys : [])
    .filter((key): key is string => typeof key === 'string')
    .slice(0, 200);

  if (keys.length === 0) return sendJson(response, 200, { events: [] });

  const invites = await listInvitesByKeys(keys);
  const events = await Promise.all(
    invites.map(async (invite) => {
      const answers = await listRsvp(invite.id);
      const attending = answers.filter((answer) => answer.attending);
      return {
        id: invite.id,
        manageKey: invite.manageKey,
        title: invite.title,
        destination: invite.destination,
        date: invite.date,
        returnDate: invite.returnDate,
        theme: invite.theme,
        guests: invite.guests.length,
        answered: answers.length,
        attending: attending.length,
        declined: answers.length - attending.length,
        travellers: attending.reduce((sum, answer) => sum + answer.travellers, 0),
        confirmedCost: attending.reduce((sum, answer) => sum + (answer.price ?? 0), 0),
        computedAt: invite.computedAt,
        createdAt: invite.createdAt,
      };
    }),
  );

  sendJson(response, 200, { events });
}

/**
 * Личный маршрут гостя по приглашению.
 *
 * Гость называет только свой город — место, даты и всё остальное берётся из
 * приглашения. Ни регистрации, ни ввода параметров поиска.
 */
async function handleInviteRoute(
  id: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const invite = await getInvite(id);
  if (!invite) return sendJson(response, 404, { error: 'приглашение не найдено' });

  const body = await readJson<{
    city?: string;
    name?: string;
    adults?: number;
    arriveEarlier?: number;
    departLater?: number;
  }>(request);

  const city = body?.city?.trim();
  if (!city) return sendJson(response, 400, { error: 'укажите город выезда' });

  // Гость вправе приехать раньше и уехать позже: даты события — рамка,
  // а не расписание его личной поездки.
  const earlier = clampNumber(body?.arriveEarlier, 0, 14, 0);
  const later = clampNumber(body?.departLater, 0, 14, 0);

  const plan = await planEvent(
    mcp,
    {
      startCity: invite.destination,
      endCity: invite.endCity ?? invite.destination,
      startDate: addDays(invite.date, -earlier),
      endDate: invite.returnDate ? addDays(invite.returnDate, later) : null,
    },
    [{ name: body?.name?.slice(0, 60) || city, city }],
    { adults: clampNumber(body?.adults, 1, 9, 1) },
  );

  sendJson(response, 200, { invite, plan });
}

async function handleRsvp(
  id: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const invite = await getInvite(id);
  if (!invite) return sendJson(response, 404, { error: 'приглашение не найдено' });

  const body = await readJson<{
    name?: string;
    city?: string;
    attending?: boolean;
    travellers?: number;
    routeSummary?: string;
    price?: number;
    comment?: string;
    seatableLegs?: SeatableLeg[];
  }>(request);

  const name = body?.name?.trim();
  const city = body?.city?.trim();
  if (!name || !city) return sendJson(response, 400, { error: 'нужны имя и город' });

  const saved = await saveRsvp({
    inviteId: id,
    name: name.slice(0, 60),
    city: city.slice(0, 60),
    attending: body?.attending !== false,
    travellers: clampNumber(body?.travellers, 1, 9, 1),
    routeSummary: body?.routeSummary?.slice(0, 300).trim() || null,
    price: Number.isFinite(Number(body?.price)) ? Math.round(Number(body?.price)) : null,
    comment: body?.comment?.slice(0, 400).trim() || null,
    seatableLegs: normalizeLegs(body?.seatableLegs),
  });

  sendJson(response, 200, saved);
}

async function handleListRsvp(id: string, response: ServerResponse): Promise<void> {
  const invite = await getInvite(id);
  if (!invite) return sendJson(response, 404, { error: 'приглашение не найдено' });

  const items = await listRsvp(id);
  const attending = items.filter((item) => item.attending);

  sendJson(response, 200, {
    items,
    summary: {
      answered: items.length,
      attending: attending.length,
      declined: items.length - attending.length,
      // Ждём ответа только от тех, кого организатор перечислил заранее.
      silent: Math.max(0, invite.guests.length - items.length),
      travellers: attending.reduce((sum, item) => sum + item.travellers, 0),
      confirmedCost: attending.reduce((sum, item) => sum + (item.price ?? 0), 0),
    },
  });
}

/**
 * Групповая посадка по подтвердившим гостям.
 *
 * Попутчики определяются по совпадению плеча: одинаковый поезд, дата и станции.
 * Одиночки пропускаются — соседние места им подбирать не от чего.
 */
async function handleSeating(id: string, response: ServerResponse): Promise<void> {
  const invite = await getInvite(id);
  if (!invite) return sendJson(response, 404, { error: 'приглашение не найдено' });

  const attending = (await listRsvp(id)).filter((item) => item.attending);

  const byLeg = new Map<
    string,
    {
      label: string;
      detailsRef: Record<string, unknown>;
      checkoutRef: Record<string, unknown> | null;
      names: string[];
      party: number;
    }
  >();
  for (const guest of attending) {
    for (const leg of guest.seatableLegs ?? []) {
      const bucket = byLeg.get(leg.key) ?? {
        label: leg.label,
        detailsRef: leg.detailsRef,
        checkoutRef: leg.checkoutRef ?? null,
        names: [],
        party: 0,
      };
      bucket.names.push(guest.name);
      bucket.party += guest.travellers;
      byLeg.set(leg.key, bucket);
    }
  }

  const groups = [...byLeg.entries()].filter(([, bucket]) => bucket.party >= 2);

  const plans = await Promise.all(
    groups.map(async ([key, bucket]) => ({
      key,
      label: bucket.label,
      names: bucket.names,
      seating: await planSeating(mcp, bucket.detailsRef, bucket.party, bucket.checkoutRef),
    })),
  );

  sendJson(response, 200, {
    groups: plans,
    skipped: byLeg.size - groups.length,
  });
}

const PALETTES = ['lime', 'purple', 'orange', 'ink'];

/**
 * Цвет попадает в атрибут `style` публичной страницы, поэтому принимается
 * только в двух видах: имя из нашего списка или ровно шесть шестнадцатеричных
 * цифр. Всё остальное — способ дописать в стиль что-то своё.
 */
function normalizePalette(raw: unknown): string {
  if (typeof raw !== 'string') return 'lime';
  if (PALETTES.includes(raw)) return raw;
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : 'lime';
}

function normalizeInk(raw: unknown): string | null {
  return typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : null;
}

/** Готовые маршруты приходят от клиента как есть — проверяем только форму. */
function normalizeRoutes(raw: unknown): StoredRoute[] {
  return (Array.isArray(raw) ? raw : [])
    .filter(
      (route): route is StoredRoute =>
        typeof route?.city === 'string' && route.city.trim() !== '' && route.plan !== undefined,
    )
    .slice(0, 60)
    .map((route) => ({ city: route.city.trim().slice(0, 60), plan: route.plan }));
}

function normalizeLegs(raw: unknown): SeatableLeg[] {
  return (Array.isArray(raw) ? raw : [])
    .filter(
      (leg): leg is SeatableLeg =>
        typeof leg?.key === 'string' &&
        typeof leg?.label === 'string' &&
        (leg?.transport === 'railway' || leg?.transport === 'bus') &&
        typeof leg?.detailsRef === 'object' &&
        leg.detailsRef !== null,
    )
    .slice(0, 4)
    .map((leg) => ({
      key: leg.key.slice(0, 200),
      label: leg.label.slice(0, 200),
      transport: leg.transport,
      detailsRef: leg.detailsRef,
      checkoutRef:
        typeof leg.checkoutRef === 'object' && leg.checkoutRef !== null ? leg.checkoutRef : null,
    }));
}

function normalizeGuests(raw: unknown): Guest[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((guest): guest is Guest => typeof guest?.city === 'string' && guest.city.trim() !== '')
    .slice(0, 40)
    .map((guest) => ({
      name: String(guest.name ?? guest.city).slice(0, 60),
      city: guest.city.trim(),
    }));
}

/** Коды для персональных ссылок — по порядку, чтобы их можно было диктовать. */
function withSlugs(guests: Guest[]): Array<Guest & { slug: string }> {
  return guests.map((guest, index) => ({ ...guest, slug: `g${index + 1}` }));
}

function isIsoDate(value: string | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function handleIntent(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson<{ text?: string }>(request);
  const text = body?.text?.trim();
  if (!text) return sendJson(response, 400, { error: 'пустой текст' });

  const today = new Date().toISOString().slice(0, 10);
  const parsed = await parseEventIntent(text, today);
  if (!parsed) {
    return sendJson(response, 503, { error: 'разбор недоступен: языковая модель не подключена' });
  }
  sendJson(response, 200, parsed);
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  // normalize + префиксная проверка не дают выйти за пределы каталога web/.
  const target = normalize(join(WEB_DIR, relative));
  if (!target.startsWith(WEB_DIR)) {
    return sendJson(response, 403, { error: 'forbidden' });
  }

  try {
    const file = await readFile(target);
    response.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    response.end(file);
    return;
  } catch {
    // Ниже — попытка отдать оболочку приложения.
  }

  // Одностраничное приложение: неизвестный путь без расширения — это его маршрут,
  // а не отсутствующий файл.
  if (!extname(relative)) {
    try {
      const shell = await readFile(join(WEB_DIR, 'index.html'));
      response.writeHead(200, { 'content-type': MIME['.html'] });
      response.end(shell);
      return;
    } catch {
      return sendJson(response, 503, {
        error: 'интерфейс не собран — выполните npm run build в каталоге app',
      });
    }
  }

  sendJson(response, 404, { error: 'not found' });
}

/**
 * Обычное тело запроса приходит от нашего же интерфейса, и всё крупное в нём —
 * ошибка или атака. Картинка — исключение: она и должна быть большой, а
 * base64 прибавляет к ней ещё треть.
 *
 * Раньше предел был один на всё, и любая настоящая фотография рвала соединение
 * молча: браузер показывал «не удалось загрузить», не объясняя почему.
 */
const MAX_BODY_BYTES = 256_000;
const MAX_UPLOAD_BODY_BYTES = 8 * 1024 * 1024;

function readJson<T>(request: IncomingMessage, limit = MAX_BODY_BYTES): Promise<T | null> {
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
      if (raw.length > limit) request.destroy();
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(raw) as T);
      } catch {
        resolve(null);
      }
    });
    request.on('error', () => resolve(null));
  });
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  return clampNumber(Number.parseInt(raw ?? '', 10), min, max, fallback);
}

function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

server.listen(PORT, () => {
  console.log(`Склейка — http://localhost:${PORT}`);
  console.log(`MCP: ${process.env.TUTU_MCP_URL ?? 'https://mcp.tutu.ru/mcp'} · модель: ${getProvider().name}`);
});
