/**
 * Приглашения и ответы на них.
 *
 * Организатор собирает событие и получает ссылку, которую рассылает гостям.
 * Гость открывает её без регистрации, видит свой личный маршрут и отвечает,
 * едет ли он. Это замыкает круг: до ответов у организатора был список
 * предположений, после — список фактов, на которые можно опираться.
 */

import { randomUUID } from 'node:crypto';
import { FileCollection } from './collection.ts';
import type { Block } from '../domain/blocks.ts';

export interface InviteGuest {
  name: string;
  city: string;
  /**
   * Короткий код гостя для персональной ссылки.
   *
   * Не секрет: он только говорит, чью карточку открыть. Общая ссылка при этом
   * остаётся — рассылать сорок персональных поштучно никто не станет,
   * персональные нужны для тех, кому важно открыть и сразу увидеть своё.
   */
  slug: string;
}

/**
 * Готовый маршрут гостя, посчитанный при публикации приглашения.
 *
 * Гость не должен ждать пересчёта: к моменту публикации организатор уже всё
 * посчитал, и заставлять человека снова обходить города-пересадки — значит
 * тратить его минуту на работу, которая давно сделана. Здесь лежит результат,
 * а `computedAt` честно говорит, когда он получен: цены живые и меняются.
 */
export interface StoredRoute {
  city: string;
  /** Снимок расчёта в форме доменного `GuestPlan`. */
  plan: unknown;
}

/** Оформление приглашения, выбранное организатором. */
export interface InviteTheme {
  /** Фирменный ключ (`lime` | `purple` | `orange` | `ink`) либо свой цвет вида `#a181ff`. */
  palette: string;
  /**
   * Цвет текста поверх фона.
   *
   * `null` означает «посчитать от фона»: это разумное умолчание, но не решение
   * за организатора — выбранный им цвет сохраняется как есть.
   */
  ink: string | null;
  /** Эмодзи-обложка — самый дешёвый способ задать настроение без загрузки картинок. */
  cover: string;
}

export interface Invite {
  id: string;
  /**
   * Ключ управления.
   *
   * Организатор публикует приглашение и закрывает вкладку — без ключа он
   * теряет доступ к собственному событию: к ответам гостей, к посадке, к
   * возможности что-то поправить. Ключ живёт в персональной ссылке, которую
   * он получает при публикации; хранилище браузера тут лишь подстраховка.
   */
  manageKey: string;
  title: string;
  /** Произвольный текст от организатора — приветствие для гостей. */
  greeting: string;
  destination: string;
  /** Город окончания события: свадьба в Суздале, проводы во Владимире. */
  endCity: string;
  /** Адрес места проведения, если организатор его указал. */
  venue: string | null;
  date: string;
  returnDate: string | null;
  guests: InviteGuest[];
  theme: InviteTheme;
  /** Страница, собранная организатором из блоков. */
  blocks: Block[];
  routes: StoredRoute[];
  computedAt: string | null;
  createdAt: string;
}

export type InviteDraft = Omit<Invite, 'id' | 'manageKey' | 'createdAt'>;
/** Что организатор вправе поменять после публикации. */
export type InvitePatch = Partial<
  Pick<
    Invite,
    | 'title' | 'greeting' | 'venue' | 'theme' | 'blocks' | 'routes'
    | 'computedAt' | 'guests' | 'date' | 'returnDate' | 'destination'
  >
>;

/**
 * Плечо маршрута, где места выбираются, — поезд или автобус.
 *
 * Хранится вместе с ответом, чтобы потом собрать попутчиков: без сохранённой
 * ссылки на плечо пришлось бы пересчитывать маршрут каждого гостя заново,
 * а цены и расписания к тому времени уже разъедутся.
 */
export interface SeatableLeg {
  key: string;
  label: string;
  transport: 'railway' | 'bus';
  detailsRef: Record<string, unknown>;
  /** Нужен, чтобы собрать корзину с подобранными местами. У старых ответов его нет. */
  checkoutRef: Record<string, unknown> | null;
}

/** Ответ гостя. Хранит и решение, и маршрут, который он при этом видел. */
export interface Rsvp {
  id: string;
  inviteId: string;
  name: string;
  city: string;
  attending: boolean;
  travellers: number;
  /** Короткое описание выбранного маршрута — организатору нужен именно смысл, а не сырой объект. */
  routeSummary: string | null;
  price: number | null;
  comment: string | null;
  seatableLegs: SeatableLeg[];
  createdAt: string;
}

export type RsvpDraft = Omit<Rsvp, 'id' | 'createdAt'>;

const invites = new FileCollection<Invite>('invites.json');
const responses = new FileCollection<Rsvp>('rsvp.json');

/** Короткий идентификатор: ссылку диктуют голосом и шлют в мессенджере. */
function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}

export function createInvite(draft: InviteDraft): Promise<Invite> {
  return invites.put({
    ...draft,
    id: shortId(),
    manageKey: randomUUID().replace(/-/g, ''),
    createdAt: new Date().toISOString(),
  });
}

/** Обновление опубликованного приглашения — только по ключу управления. */
export async function updateInvite(
  id: string,
  manageKey: string,
  patch: InvitePatch,
): Promise<Invite | null> {
  const invite = await invites.get(id);
  if (!invite || invite.manageKey !== manageKey) return null;
  return invites.put({ ...invite, ...patch });
}

/** Все события, к которым есть ключ управления, — рабочий стол организатора. */
export async function listInvitesByKeys(keys: string[]): Promise<Invite[]> {
  const allowed = new Set(keys);
  const found = await invites.find((invite) => allowed.has(invite.manageKey));
  return found.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getInvite(id: string): Promise<Invite | null> {
  return invites.get(id);
}

/**
 * Ответ гостя.
 *
 * Повторный ответ из того же города заменяет прежний, а не добавляет строку:
 * человек, передумавший ехать, иначе остался бы в списке дважды с
 * противоположными решениями.
 */
export async function saveRsvp(draft: RsvpDraft): Promise<Rsvp> {
  const existing = await responses.find(
    (item) => item.inviteId === draft.inviteId && sameGuest(item, draft),
  );

  const id = existing[0]?.id ?? shortId();
  return responses.put({ ...draft, id, createdAt: new Date().toISOString() });
}

export function listRsvp(inviteId: string): Promise<Rsvp[]> {
  return responses.find((item) => item.inviteId === inviteId);
}

function sameGuest(left: { name: string; city: string }, right: { name: string; city: string }): boolean {
  const normalize = (value: string): string => value.trim().toLowerCase();
  return normalize(left.name) === normalize(right.name) && normalize(left.city) === normalize(right.city);
}
