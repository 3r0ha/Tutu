import { useRef, useState } from 'react';
import type { Block, BlockKind, ScheduleItem, StayBlock } from '../blocks.ts';
import { Editable } from './Editable.tsx';
import { isCustomPalette, readableInk, themeProps } from '../theme.ts';

const ADDABLE: Array<{ kind: BlockKind; label: string }> = [
  { kind: 'text', label: 'Текст' },
  { kind: 'image', label: 'Картинка' },
  { kind: 'schedule', label: 'Программа' },
  { kind: 'stay', label: 'Где остановиться' },
  { kind: 'contacts', label: 'Контакты' },
];

/**
 * Эмодзи обложки.
 *
 * Десяти штук не хватало: приглашают не только на свадьбу и в горы. Набор
 * разбит по поводам, чтобы длинный список не превращался в поиск глазами.
 */
const COVERS = [
  '💍', '💐', '🥂', '🎂', '🎉', '🎊', '🕯', '💌', '👰', '🤵',
  '🏔', '🏕', '⛰', '🌲', '🏖', '🏝', '⛵️', '🚤', '🎿', '🏂',
  '⚽️', '🏀', '🏐', '🏉', '🎾', '🏊', '🚴', '🏃', '🥋', '🏆',
  '🎸', '🎹', '🎤', '🎧', '🎬', '🎭', '🎨', '📸', '🎲', '♟',
  '🎓', '📚', '💼', '🏢', '🧑‍💻', '📊', '🤝', '🗓', '✈️', '🚂',
  '🎄', '🎃', '🥳', '🌸', '🌞', '🔥', '⭐️', '❤️', '🐾', '🍽',
];

/** Обложку и «как добраться» убрать нельзя: без них приглашение не приглашение. */
const REQUIRED: BlockKind[] = ['cover', 'route'];

/**
 * Живой холст приглашения.
 *
 * Страница показана ровно так, как её увидит гость, и правится прямо здесь:
 * заголовок меняется в заголовке, программа — в программе. Панели сбоку нет
 * намеренно — она заставляет держать в голове соответствие между полем формы
 * и куском страницы, а это и есть та работа, которую конструктор должен снять.
 *
 * Управление блоком всплывает при наведении, чтобы в спокойном состоянии
 * страница выглядела страницей, а не редактором.
 */
export interface CanvasCity {
  city: string;
  price: number | null;
}

export function InviteCanvas({
  blocks,
  palette,
  ink,
  cities,
  presetStays,
  destination,
  venue,
  date,
  returnDate,
  onChange,
  onVenue,
  onPalette,
  onInk,
  onTitle,
}: {
  blocks: Block[];
  palette: string;
  ink: string | null;
  cities: CanvasCity[];
  /** Заранее снятое жильё: на показе список должен быть готов сразу. */
  presetStays?: { options: StayOption[]; note: string } | null;
  destination: string;
  venue: string;
  date: string;
  returnDate: string | null;
  onChange: (blocks: Block[]) => void;
  onVenue: (venue: string) => void;
  onPalette: (palette: string) => void;
  onInk: (ink: string | null) => void;
  onTitle: (title: string) => void;
}) {
  const theme = themeProps(palette, ink);

  const patch = (id: string, update: Partial<Block>) =>
    onChange(blocks.map((block) => (block.id === id ? ({ ...block, ...update } as Block) : block)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const insertAt = (index: number, kind: BlockKind) => {
    const id = `b-${kind}-${Math.random().toString(36).slice(2, 7)}`;
    const created: Block =
      kind === 'schedule'
        ? { id, kind, heading: 'Программа', items: [{ time: '16:00', text: 'Сбор гостей' }] }
        : kind === 'image'
          ? { id, kind, src: '', caption: '' }
        : kind === 'stay'
          ? {
              id, kind, heading: 'Где остановиться', sort: 'rating', hotelName: '',
              address: null, rating: null, reviewCount: null, price: null, nights: null,
              quote: null, quoteDate: null, url: null,
            }
          : kind === 'contacts'
            ? { id, kind, heading: 'Вопросы', body: '' }
            : { id, kind: 'text', heading: '', body: '' };

    onChange([...blocks.slice(0, index), created, ...blocks.slice(index)]);
  };

  return (
    <div className={`canvas invite ${theme.className}`} style={theme.style}>
      <PaletteBar palette={palette} ink={ink} onPalette={onPalette} onInk={onInk} />

      {blocks.map((block, index) => (
        <div key={block.id} className="canvas-slot">
          <Inserter onAdd={(kind) => insertAt(index, kind)} />

          <div className="canvas-block">
            <BlockTools
              canRemove={!REQUIRED.includes(block.kind)}
              first={index === 0}
              last={index === blocks.length - 1}
              onUp={() => move(index, -1)}
              onDown={() => move(index, 1)}
              onRemove={() => onChange(blocks.filter((entry) => entry.id !== block.id))}
            />

            <BlockBody
              block={block}
              cities={cities}
              presetStays={presetStays}
              destination={destination}
              venue={venue}
              date={date}
              returnDate={returnDate}
              onPatch={(update) => patch(block.id, update)}
              onVenue={onVenue}
              onTitle={onTitle}
            />
          </div>
        </div>
      ))}

      <Inserter onAdd={(kind) => insertAt(blocks.length, kind)} always />
    </div>
  );
}

const NAMED_PALETTES = ['lime', 'purple', 'orange', 'ink'];

/**
 * Цвет страницы.
 *
 * Четыре фирменных цвета остаются готовыми ответами, но приглашение делают под
 * своё событие, и попасть в его цвет четырьмя вариантами невозможно. Поэтому
 * рядом стоит обычный выбор цвета: он даёт любой оттенок и понятен без обучения.
 */
function PaletteBar({
  palette,
  ink,
  onPalette,
  onInk,
}: {
  palette: string;
  ink: string | null;
  onPalette: (value: string) => void;
  onInk: (value: string | null) => void;
}) {
  const custom = isCustomPalette(palette) ? palette : '';

  return (
    <div className="canvas-palette">
      <span className="label">Цвет страницы</span>
      {NAMED_PALETTES.map((entry) => (
        <button
          key={entry}
          type="button"
          className={`swatch ${entry}${palette === entry ? ' active' : ''}`}
          aria-label={entry}
          onClick={() => onPalette(entry)}
        />
      ))}

      <label className={`swatch custom${custom ? ' active' : ''}`} title="Свой цвет фона">
        <span className="swatch-fill" style={{ background: custom || undefined }} />
        <input
          type="color"
          value={custom || '#a181ff'}
          onChange={(event) => onPalette(event.target.value)}
          aria-label="Свой цвет фона"
        />
      </label>

      <span className="palette-divider" />
      <span className="label">Текст</span>

      <label className={`swatch custom letters${ink ? ' active' : ''}`} title="Цвет текста">
        <span className="swatch-fill" style={{ background: ink ?? undefined }}>
          {!ink && 'А'}
        </span>
        <input
          type="color"
          value={ink ?? readableInk(custom || '#a181ff')}
          onChange={(event) => onInk(event.target.value)}
          aria-label="Цвет текста"
        />
      </label>

      {/* Пока цвет не выбран, он считается от фона — и вернуться к этому
          поведению должно быть так же просто, как уйти от него. */}
      {ink && (
        <button type="button" className="chip ghosted" onClick={() => onInk(null)}>
          авто
        </button>
      )}
    </div>
  );
}

/** Вставка блока между соседями — там, где он и появится. */
function Inserter({ onAdd, always }: { onAdd: (kind: BlockKind) => void; always?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`inserter${always ? ' always' : ''}${open ? ' open' : ''}`}>
      {open ? (
        <div className="inserter-menu">
          {ADDABLE.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              className="chip"
              onClick={() => {
                onAdd(entry.kind);
                setOpen(false);
              }}
            >
              {entry.label}
            </button>
          ))}
          <button type="button" className="chip ghosted" onClick={() => setOpen(false)}>
            отмена
          </button>
        </div>
      ) : (
        <button type="button" className="inserter-button" onClick={() => setOpen(true)}>
          + блок
        </button>
      )}
    </div>
  );
}

function BlockTools({
  canRemove,
  first,
  last,
  onUp,
  onDown,
  onRemove,
}: {
  canRemove: boolean;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="block-tools floating">
      <button type="button" className="icon-small" onClick={onUp} disabled={first} aria-label="Выше">
        ↑
      </button>
      <button type="button" className="icon-small" onClick={onDown} disabled={last} aria-label="Ниже">
        ↓
      </button>
      {canRemove && (
        <button type="button" className="icon-small danger" onClick={onRemove} aria-label="Убрать блок">
          ×
        </button>
      )}
    </div>
  );
}

function BlockBody({
  block,
  cities,
  presetStays,
  destination,
  venue,
  date,
  returnDate,
  onPatch,
  onVenue,
  onTitle,
}: {
  block: Block;
  cities: CanvasCity[];
  presetStays?: { options: StayOption[]; note: string } | null;
  destination: string;
  venue: string;
  date: string;
  returnDate: string | null;
  onPatch: (update: Partial<Block>) => void;
  onVenue: (venue: string) => void;
  onTitle: (title: string) => void;
}) {
  switch (block.kind) {
    case 'cover':
      return (
        <article className="invite-card invite-hero">
          <CoverPicker value={block.cover} onChange={(cover) => onPatch({ cover } as Partial<Block>)} />
          <p className="invite-kicker">Приглашение</p>
          <Editable
            className="invite-title"
            ariaLabel="Заголовок приглашения"
            placeholder="Название события"
            value={block.title}
            onChange={(title) => {
              onPatch({ title } as Partial<Block>);
              onTitle(title);
            }}
          />
          <dl className="invite-facts">
            <div>
              <dt>Где</dt>
              <dd>
                {destination}
                <Editable
                  className="invite-venue"
                  ariaLabel="Адрес места"
                  placeholder="Адрес — необязательно"
                  value={venue}
                  onChange={onVenue}
                />
              </dd>
            </div>
            <div>
              <dt>Когда</dt>
              <dd>
                {formatDate(date)}
                {returnDate && <span className="invite-venue">по {formatDate(returnDate)}</span>}
              </dd>
            </div>
          </dl>
          <Editable
            className="invite-greeting"
            ariaLabel="Подпись под заголовком"
            placeholder="Пара слов гостям"
            value={block.subtitle}
            onChange={(subtitle) => onPatch({ subtitle } as Partial<Block>)}
          />
        </article>
      );

    case 'text':
    case 'contacts':
      return (
        <section className="invite-card">
          <Editable
            className="invite-section"
            ariaLabel="Заголовок блока"
            placeholder={block.kind === 'contacts' ? 'Вопросы' : 'Заголовок'}
            value={block.heading}
            onChange={(heading) => onPatch({ heading } as Partial<Block>)}
          />
          <Editable
            className="invite-body"
            ariaLabel="Текст блока"
            placeholder={block.kind === 'contacts' ? 'Кому писать и звонить' : 'Текст'}
            value={block.body}
            onChange={(body) => onPatch({ body } as Partial<Block>)}
          />
        </section>
      );

    case 'image':
      return <ImageEditor block={block} onPatch={onPatch as (update: Partial<Block>) => void} />;

    case 'schedule':
      return (
        <section className="invite-card">
          <Editable
            className="invite-section"
            ariaLabel="Заголовок программы"
            placeholder="Программа"
            value={block.heading}
            onChange={(heading) => onPatch({ heading } as Partial<Block>)}
          />
          <ul className="schedule">
            {block.items.map((item, index) => (
              <li key={index}>
                <Editable
                  className="schedule-time"
                  ariaLabel="Время"
                  placeholder="00:00"
                  value={item.time}
                  onChange={(time) => onPatch({ items: replace(block.items, index, { time }) } as Partial<Block>)}
                />
                <Editable
                  className="schedule-text"
                  ariaLabel="Что происходит"
                  placeholder="Что происходит"
                  value={item.text}
                  onChange={(text) => onPatch({ items: replace(block.items, index, { text }) } as Partial<Block>)}
                />
                <button
                  type="button"
                  className="icon-small danger row-remove"
                  aria-label="Убрать строку"
                  onClick={() =>
                    onPatch({ items: block.items.filter((_, position) => position !== index) } as Partial<Block>)
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="chip"
            onClick={() => onPatch({ items: [...block.items, { time: '', text: '' }] } as Partial<Block>)}
          >
            + строка
          </button>
        </section>
      );

    case 'stay':
      return (
        <StayEditor
          block={block}
          preset={presetStays}
          city={destination}
          checkIn={date}
          checkOut={returnDate}
          onPatch={onPatch as (update: Partial<StayBlock>) => void}
        />
      );

    case 'route':
      return (
        <section className="invite-card">
          <Editable
            className="invite-section"
            ariaLabel="Заголовок блока дороги"
            placeholder="Откуда вы поедете?"
            value={block.heading}
            onChange={(heading) => onPatch({ heading } as Partial<Block>)}
          />
          <Editable
            className="invite-lead"
            ariaLabel="Пояснение"
            placeholder="Выберите город — маршрут уже посчитан"
            value={block.lead}
            onChange={(lead) => onPatch({ lead } as Partial<Block>)}
          />
          {/* Настоящий выбор города, а не описание того, что здесь будет:
              организатор должен видеть страницу, а не рассказ о ней. */}
          <div className="city-picker inert" aria-hidden="true">
            {cities.slice(0, 8).map((entry, index) => (
              <span key={entry.city} className={`city-option${index === 0 ? ' active' : ''}`}>
                <span className="city-name">{entry.city}</span>
                <span className="city-price">
                  {entry.price === null ? 'нет маршрута' : `${Math.round(entry.price).toLocaleString('ru-RU')} ₽`}
                </span>
              </span>
            ))}
          </div>
        </section>
      );

    case 'rsvp':
      return (
        <section className="invite-card">
          <Editable
            className="invite-section"
            ariaLabel="Заголовок блока ответа"
            placeholder="Вы едете?"
            value={block.heading}
            onChange={(heading) => onPatch({ heading } as Partial<Block>)}
          />
          <Editable
            className="invite-lead"
            ariaLabel="Пояснение к ответу"
            placeholder="Ответ уйдёт организатору вместе с маршрутом"
            value={block.lead}
            onChange={(lead) => onPatch({ lead } as Partial<Block>)}
          />
          <div className="rsvp-preview inert" aria-hidden="true">
            <span className="fake-field">Как вас зовут</span>
            <span className="fake-field">Комментарий — необязательно</span>
            <div className="rsvp-actions">
              <span className="primary">Еду</span>
              <span className="ghost">Не смогу</span>
            </div>
          </div>
        </section>
      );

    default:
      return null;
  }
}

/**
 * Картинка в блоке.
 *
 * Файл уходит на наш сервер и возвращается локальным адресом: чужие ссылки
 * на странице гостя означали бы чужой трекер и битую картинку, когда исходный
 * сайт исчезнет.
 */
/**
 * Ширина, до которой ужимается картинка перед отправкой.
 *
 * Снимок с телефона весит несколько мегабайт, и отправлять его целиком незачем:
 * на странице приглашения он всё равно рисуется в колонку меньше тысячи точек.
 * Пережатие в браузере заодно снимает вопрос формата — что бы человек ни выбрал,
 * на сервер уходит webp.
 */
const MAX_IMAGE_EDGE = 1600;

async function shrink(file: File): Promise<{ data: string; type: string }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Сюда попадают форматы, которые браузер не умеет разбирать, — например
    // HEIC с айфона. Молчать нельзя: человек выбрал файл и ждёт картинку.
    throw new Error('Браузер не смог открыть этот файл. Подойдут JPEG, PNG, WebP или GIF.');
  }

  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Не удалось подготовить картинку');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return { data: canvas.toDataURL('image/webp', 0.85), type: 'image/webp' };
}

function ImageEditor({
  block,
  onPatch,
}: {
  block: Extract<Block, { kind: 'image' }>;
  onPatch: (update: Partial<Block>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { data, type } = await shrink(file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data, type }),
      });

      const payload = (await response.json()) as { src?: string; error?: string };
      if (!response.ok || !payload.src) throw new Error(payload.error ?? 'Не удалось загрузить');
      onPatch({ src: payload.src } as Partial<Block>);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="invite-card image-block">
      {block.src && (
        <img className="invite-image" src={block.src} alt={block.caption || 'Картинка приглашения'} />
      )}

      <div className="image-actions">
        {/* Раньше это была подпись к полю с `hidden`. Браузеры открывают по
            ней диалог не всегда: скрытый через `display:none` элемент часть
            из них не активирует. Обычная кнопка, дёргающая поле по ссылке,
            работает везде. */}
        <button type="button" className="ghost" onClick={() => picker.current?.click()}>
          {busy ? 'Загружаем…' : block.src ? 'Заменить' : 'Выбрать картинку'}
        </button>
        <input
          ref={picker}
          className="file-input"
          type="file"
          accept="image/*"
          aria-label="Файл картинки"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            // Один и тот же файл должен выбираться повторно — без сброса
            // значения второе `change` не наступает.
            event.target.value = '';
          }}
        />
        {block.src && (
          <button type="button" className="chip" onClick={() => onPatch({ src: '' } as Partial<Block>)}>
            Убрать
          </button>
        )}
      </div>

      <Editable
        className="image-caption"
        ariaLabel="Подпись к картинке"
        placeholder="Подпись — необязательно"
        value={block.caption}
        onChange={(caption) => onPatch({ caption } as Partial<Block>)}
      />

      {error && <p className="hint error">{error}</p>}
    </section>
  );
}

function CoverPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="cover-picker">
      <button type="button" className="invite-cover as-button" onClick={() => setOpen((state) => !state)}>
        {value || '✨'}
      </button>
      {open && (
        <div className="cover-menu">
          {COVERS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={`cover${value === emoji ? ' active' : ''}`}
              onClick={() => {
                onChange(emoji);
                setOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface StayOption {
  hotelId: string;
  name: string;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
  price: number | null;
  url: string | null;
  quote: string | null;
  quoteDate: string | null;
}

/** Выбор рекомендуемого жилья — прямо в том блоке, где он потом и покажется. */
function StayEditor({
  block,
  preset,
  city,
  checkIn,
  checkOut,
  onPatch,
}: {
  block: StayBlock;
  preset?: { options: StayOption[]; note: string } | null;
  city: string;
  checkIn: string;
  checkOut: string | null;
  onPatch: (update: Partial<StayBlock>) => void;
}) {
  // На показе список уже снят: ждать поход в Туту ради того, что известно
  // заранее, — ровно та тишина, от которой демо и избавляет.
  const [options, setOptions] = useState<StayOption[] | null>(preset?.options ?? null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(preset?.note ?? null);

  const load = async (sort: 'rating' | 'price') => {
    onPatch({ sort });
    setBusy(true);
    try {
      const response = await fetch('/api/stays', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ city, checkIn, checkOut: checkOut ?? checkIn, sort }),
      });
      const data = (await response.json()) as { options: StayOption[]; note: string };
      setOptions(data.options);
      setNote(data.note);
    } catch {
      setNote('Не удалось загрузить варианты');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="invite-card">
      <Editable
        className="invite-section"
        ariaLabel="Заголовок блока жилья"
        placeholder="Где остановиться"
        value={block.heading}
        onChange={(heading) => onPatch({ heading })}
      />

      {block.hotelName ? (
        <div className="stay-card">
          <div className="stay-head">
            <span className="stay-name">{block.hotelName}</span>
            {block.price !== null && (
              <span className="stay-price">{Math.round(block.price).toLocaleString('ru-RU')} ₽</span>
            )}
          </div>
          <p className="stay-meta">
            {block.rating !== null ? `⭐ ${block.rating} · ${block.reviewCount ?? 0} отзывов` : 'без рейтинга'}
          </p>
          {block.quote && (
            <blockquote className="stay-quote">
              «{block.quote}»<cite>{block.quoteDate}</cite>
            </blockquote>
          )}
        </div>
      ) : (
        <p className="invite-lead muted">
          Гость увидит здесь живой список жилья. Можно ничего не выбирать — или
          порекомендовать один вариант, он встанет первым.
        </p>
      )}

      <div className="stay-actions">
        <button type="button" className="ghost" onClick={() => load(block.sort ?? 'rating')} disabled={busy}>
          {busy ? 'Ищем…' : options ? 'Обновить список' : 'Подобрать отель'}
        </button>
        <div className="stay-sort">
          <button
            type="button"
            className={`chip${(block.sort ?? 'rating') === 'rating' ? ' active' : ''}`}
            onClick={() => load('rating')}
            disabled={busy}
          >
            по отзывам
          </button>
          <button
            type="button"
            className={`chip${block.sort === 'price' ? ' active' : ''}`}
            onClick={() => load('price')}
            disabled={busy}
          >
            подешевле
          </button>
        </div>
      </div>

      {options && (
        <ul className="stay-options">
          {options.map((option) => (
            <li key={option.hotelId || option.name}>
              <span className="stay-option-main">
                <b>{option.name}</b>
                <span className="hint">
                  {option.rating !== null ? `⭐ ${option.rating} · ${option.reviewCount ?? 0} отз.` : 'без рейтинга'}
                  {option.price !== null && ` · ${Math.round(option.price).toLocaleString('ru-RU')} ₽`}
                </span>
                {option.quote && <span className="stay-option-quote">«{option.quote}»</span>}
              </span>
              <button
                type="button"
                className="chip"
                onClick={() =>
                  onPatch({
                    hotelId: option.hotelId,
                    hotelName: option.name,
                    address: option.address,
                    rating: option.rating,
                    reviewCount: option.reviewCount,
                    price: option.price,
                    quote: option.quote,
                    quoteDate: option.quoteDate,
                    url: option.url,
                  })
                }
              >
                Выбрать
              </button>
            </li>
          ))}
        </ul>
      )}

      {note && <p className="hint">{note}</p>}
    </section>
  );
}

function replace(items: ScheduleItem[], index: number, update: Partial<ScheduleItem>): ScheduleItem[] {
  return items.map((item, position) => (position === index ? { ...item, ...update } : item));
}

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}
