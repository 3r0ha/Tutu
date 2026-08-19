import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Coordinates, Direction, GuestPlan, Leg, MapPlan, ViewMode } from '../types.ts';
import { placeLabels, TARGET_SLOTS, type LabelPlacement, type Placed } from './mapLabels.ts';
import { LAKES, OUTLINES } from '../mapOutlines.ts';

const PADDING = 64;
/** Во сколько раз охват карты шире охвата городов. */
const CONTEXT_ZOOM_OUT = 1.5;

/**
 * Пределы приближения.
 *
 * Отдалять сильнее, чем вдвое от исходного, незачем: города превращаются в
 * пятно. Приближать больше двенадцати крат — тоже: подложка нарисована по
 * упрощённым контурам, и дальше она начинает врать деталями, которых в ней нет.
 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 12;

/** Сдвиг и масштаб, заданные пользователем поверх подогнанной проекции. */
interface View {
  k: number;
  tx: number;
  ty: number;
}

const HOME: View = { k: 1, tx: 0, ty: 0 };

interface Props {
  plan: MapPlan;
  mode: ViewMode;
  leg: Leg;
  /** Цвет закреплён за гостем: иначе на карте не понять, чья это линия. */
  colors: Map<string, string>;
  selectedCity: string | null;
  /**
   * Города гостей, о которых сейчас идёт речь в раскрытом показателе.
   * `null` — показатель закрыт, подсвечивать некого.
   */
  highlighted?: Set<string> | null;
  onSelect: (city: string | null) => void;
}

/**
 * Карта достижимости.
 *
 * Размер берётся замером контейнера, а не фиксированным viewBox: при жёстком
 * соотношении сторон вертикальный экран телефона превращался в две полосы
 * пустоты с крошечной картой посередине. Здесь проекция каждый раз
 * подгоняется под фактическую форму области.
 */
export function ReachMap({ plan, mode, leg, colors, selectedCity, highlighted, onSelect }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = holder.current;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      // Новый объект на каждое срабатывание перерисовывал карту вхолостую,
      // а во время расчёта наблюдатель срабатывает постоянно: соседние блоки
      // растут по мере появления гостей.
      setSize((current) =>
        Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
          ? current
          : { width, height },
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const [view, setView] = useState<View>(HOME);
  const dragging = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [dragged, setDragged] = useState(false);

  // Новый расчёт — новый охват; держать на нём старое приближение бессмысленно.
  useEffect(() => setView(HOME), [plan.destination, leg]);

  const layout = useMemo(
    () => buildLayout(plan, leg, size.width, size.height, view),
    [plan, leg, size, view],
  );

  /**
   * Приближение к точке под курсором.
   *
   * Приближать к центру экрана неудобно: человек ведёт мышь к тому месту,
   * которое хочет рассмотреть, и ждёт, что оно останется под курсором.
   */
  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((current) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * factor));
      if (k === current.k) return current;
      const ratio = k / current.k;
      return { k, tx: cx - (cx - current.tx) * ratio, ty: cy - (cy - current.ty) * ratio };
    });
  }, []);

  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - box.left, event.clientY - box.top);
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = { x: event.clientX, y: event.clientY, tx: view.tx, ty: view.ty };
    setDragged(false);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const start = dragging.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // Мелкое дрожание при клике не должно считаться перетаскиванием, иначе
    // выбор гостя перестал бы срабатывать.
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) setDragged(true);
    setView((current) => ({ ...current, tx: start.tx + dx, ty: start.ty + dy }));
  };

  const endDrag = () => {
    dragging.current = null;
  };

  // Подписи расставляются одним проходом: по отдельности они не знают друг
  // о друге и налезают, как только два города оказываются рядом.
  const labels = useMemo(() => {
    if (!layout) return new Map<string, LabelPlacement>();
    const items: Array<Parameters<typeof placeLabels>[0][number]> = [];

    if (layout.target) {
      items.push({
        key: '@target',
        text: plan.destination,
        at: layout.target,
        scale: 1.2,
        slots: TARGET_SLOTS,
      });
    }
    for (const guest of plan.guests) {
      const at = layout.project(guest.city);
      if (at && !items.some((item) => item.key === guest.city)) {
        items.push({ key: guest.city, text: guest.city, at });
      }
    }
    for (const city of layout.pending) items.push({ key: city.name, text: city.name, at: city.at });
    for (const hub of layout.hubs) items.push({ key: `@hub:${hub.city}`, text: hub.city, at: hub.at });

    return placeLabels(items);
  }, [layout, plan]);

  const atHome = view.k === 1 && view.tx === 0 && view.ty === 0;

  return (
    <div className="map-holder" ref={holder}>
      <div className="map-zoom">
        <button
          type="button"
          aria-label="Приблизить"
          onClick={() => zoomAt(1.4, size.width / 2, size.height / 2)}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Отдалить"
          onClick={() => zoomAt(1 / 1.4, size.width / 2, size.height / 2)}
        >
          −
        </button>
        {/* Заблудиться на карте легко, а вернуться к общему виду нечем —
            поэтому сброс всегда под рукой, но заметен только когда нужен. */}
        <button
          type="button"
          className="reset"
          aria-label="Показать всех"
          disabled={atHome}
          onClick={() => setView(HOME)}
        >
          ⤢
        </button>
      </div>
      {layout && (
        <svg
          className={`map${dragging.current ? ' grabbing' : ''}`}
          viewBox={`0 0 ${size.width} ${size.height}`}
          role="img"
          aria-label={`Карта: кто и как добирается до города ${plan.destination}`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          // Клик после перетаскивания — не клик: иначе любое движение карты
          // сбрасывало бы выбранного гостя.
          onClick={() => !dragged && onSelect(null)}
        >
          <defs>
            <radialGradient id="targetGlow">
              <stop offset="0%" stopColor="#d0ff1a" stopOpacity="0.55" />
              <stop offset="55%" stopColor="#d0ff1a" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#d0ff1a" stopOpacity="0" />
            </radialGradient>
          </defs>

          <Basemap base={layout.base} view={view} />

          <circle cx={layout.target.x} cy={layout.target.y} r={Math.min(90, size.width / 7)} fill="url(#targetGlow)" />

          {plan.guests.map((guest) => {
            const from = layout.project(guest.city);
            if (!from) return null;
            return (
              <Flow
                key={`flow-${guest.city}-${guest.name}`}
                guest={guest}
                mode={mode}
                leg={leg}
                color={colors.get(guest.city) ?? '#6f5df6'}
                from={from}
                target={layout.target}
                project={layout.project}
                dimmed={
                  (selectedCity !== null && selectedCity !== guest.city) ||
                  (highlighted != null && !highlighted.has(guest.city))
                }
                onSelect={onSelect}
              />
            );
          })}

          {layout.hubs.map((hub) => (
            <g key={`hub-${hub.city}`}>
              <circle cx={hub.at.x} cy={hub.at.y} r={5} fill="#6f5df6" opacity={0.9} />
              <Label className="hub-label" at={labels.get(`@hub:${hub.city}`)} text={hub.city} />
            </g>
          ))}

          {/* Города, чей маршрут ещё считается: участники видны с первой секунды,
              а не появляются из пустоты по готовности. */}
          {layout.pending.map((city) => (
            <g key={`pending-${city.name}`}>
              <circle className="city-dot pending" cx={city.at.x} cy={city.at.y} r={5} />
              <Label className="city-label" at={labels.get(city.name)} text={city.name} />
            </g>
          ))}

          {plan.guests.map((guest) => {
            const at = layout.project(guest.city);
            if (!at) return null;
            const status = statusFor(guest, mode, leg);
            return (
              <g
                key={`city-${guest.city}-${guest.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(guest.city);
                }}
              >
                <circle
                  className={`city-dot${status === 'unreachable' ? ' out' : ''}`}
                  cx={at.x}
                  cy={at.y}
                  r={selectedCity === guest.city ? 10 : 7}
                  fill={status === 'unreachable' ? '#ffffff' : (colors.get(guest.city) ?? '#6f5df6')}
                  stroke={colors.get(guest.city) ?? '#6f5df6'}
                />
                <Label className="city-label" at={labels.get(guest.city)} text={guest.city} />
              </g>
            );
          })}

          <g>
            <circle className="target-ring" cx={layout.target.x} cy={layout.target.y} r={19} />
            <circle className="target-ring pulse-ring" cx={layout.target.x} cy={layout.target.y} r={28} />
            <path d={star(layout.target.x, layout.target.y, 11)} fill="#6f5df6" />
            <Label className="target-label" at={labels.get('@target')} text={plan.destination} />
          </g>
        </svg>
      )}
    </div>
  );
}

function Label({
  className,
  at,
  text,
}: {
  className: string;
  at: LabelPlacement | undefined;
  text: string;
}) {
  if (!at) return null;
  return (
    <text className={className} x={at.x} y={at.y} textAnchor={at.anchor}>
      {text}
    </text>
  );
}

function Flow({
  guest,
  mode,
  leg,
  color,
  from,
  target,
  project,
  dimmed,
  onSelect,
}: {
  guest: GuestPlan;
  mode: ViewMode;
  leg: Leg;
  color: string;
  from: Placed;
  target: Placed;
  project: (city: string) => Placed | null;
  dimmed: boolean;
  onSelect: (city: string) => void;
}) {
  const status = statusFor(guest, mode, leg);
  const direction = directionOf(guest, leg);
  const journey = mode === 'direct' ? direction?.directBest : direction?.best;

  // Составной маршрут ломается в городе пересадки — иначе на карте не видно,
  // что человек едет не напрямую, а через кого-то.
  const hub = status === 'composed' && journey?.via[0] ? project(journey.via[0]) : null;
  // Обратное направление рисуется от цели к гостю: стрелка потока должна
  // совпадать с тем, куда человек на самом деле поедет.
  const [head, tail] = leg === 'outbound' ? [from, target] : [target, from];
  const path = hub ? `${bend(head, hub)} ${bendTo(hub, tail)}` : bend(head, tail);

  return (
    <path
      className={`flow ${status}${dimmed ? ' dimmed' : ''}`}
      d={path}
      stroke={color}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(guest.city);
      }}
    >
      <title>{`${guest.name} — ${guest.city}`}</title>
    </path>
  );
}

/**
 * Подложка: суша и границы стран.
 *
 * Раньше здесь была прямоугольная сетка. Она задавала масштаб, но не место:
 * города висели в клетчатой пустоте, и понять, где север и что восточнее,
 * было неоткуда. Контуры отвечают на этот вопрос сразу.
 *
 * Контуры проецируются той же функцией, что и города, поэтому подложка и точки
 * не могут разъехаться: у них общая проекция, а не два похожих расчёта.
 */
function Basemap({ base, view }: { base: BaseProjection; view: View }) {
  // Контуры считаются в базовых координатах и не зависят от приближения:
  // тысяча точек, пересобираемая на каждое движение мыши, вешала вкладку.
  // Приближение накладывается трансформом, а толщина линий от него не зависит.
  const shapes = useMemo(() => {
    const draw = (source: typeof OUTLINES) =>
      source.map((shape) => ({
        name: shape.name,
        d: shape.rings
          .map(
            (ring) =>
              `M${ring
                .map(([lon, lat]) => {
                  const x = base.offsetX + (lon * base.scaleX - base.minX) * base.scale;
                  const y = base.offsetY + (-lat - base.minY) * base.scale;
                  return `${x.toFixed(1)} ${y.toFixed(1)}`;
                })
                .join('L')}Z`,
          )
          .join(' '),
      }));

    return { countries: draw(OUTLINES), lakes: draw(LAKES) };
    // Зависимость по числам, а не по объекту: объект пересоздаётся вместе с
    // раскладкой на каждое движение карты, и мемоизация по нему не работала.
  }, [base.offsetX, base.offsetY, base.minX, base.minY, base.scale, base.scaleX]);

  const { countries, lakes } = shapes;

  return (
    <g
      className="basemap"
      aria-hidden="true"
      transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}
    >
      {/* Фон панели — вода, поэтому суша рисуется поверх, а озёра поверх суши.
          Так берег получается сам собой, без отдельного слоя береговой линии. */}
      {countries.map((country) => (
        <path
          key={country.name}
          className={`land${country.name === 'Russia' ? ' home' : ''}`}
          d={country.d}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {lakes.map((lake) => (
        <path key={lake.name} className="water" d={lake.d} />
      ))}
    </g>
  );
}

function directionOf(guest: GuestPlan, leg: Leg): Direction | null {
  return leg === 'outbound' ? guest.outbound : guest.inbound;
}

/**
 * Статус конкретного направления, а не гостя целиком.
 *
 * На карте одновременно показывается одно направление, и красить точку по
 * худшему из двух значило бы врать про то, которое сейчас на экране.
 */
function statusFor(guest: GuestPlan, mode: ViewMode, leg: Leg): 'direct' | 'composed' | 'unreachable' {
  const direction = directionOf(guest, leg);
  if (!direction) return 'unreachable';
  if (mode === 'direct') return direction.directBest ? 'direct' : 'unreachable';
  if (!direction.best) return 'unreachable';
  return direction.best.kind === 'direct' ? 'direct' : 'composed';
}

/** Дуга вместо прямой: пучок линий к одной точке иначе сливается в кляксу. */
function bend(a: Placed, b: Placed): string {
  const { cx, cy } = control(a, b);
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

function bendTo(a: Placed, b: Placed): string {
  const { cx, cy } = control(a, b);
  return `Q ${cx} ${cy} ${b.x} ${b.y}`;
}

function control(a: Placed, b: Placed): { cx: number; cy: number } {
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const lift = Math.min(70, length * 0.17);
  return { cx: midX - (dy / length) * lift, cy: midY + (dx / length) * lift };
}

function star(cx: number, cy: number, radius: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 === 0 ? radius : radius * 0.44;
    points.push(`${cx + Math.cos(angle) * r} ${cy + Math.sin(angle) * r}`);
  }
  return `M ${points.join(' L ')} Z`;
}

/** Параметры проекции без пользовательского сдвига — по ним рисуется подложка. */
export interface BaseProjection {
  offsetX: number;
  offsetY: number;
  minX: number;
  minY: number;
  scale: number;
  scaleX: number;
}

interface Layout {
  project: (city: string) => Placed | null;
  base: BaseProjection;
  target: Placed;
  hubs: Array<{ city: string; at: Placed }>;
  /** Города с известными координатами, но ещё не посчитанным маршрутом. */
  pending: Array<{ name: string; at: Placed }>;
}

/**
 * Равнопромежуточная проекция, подогнанная под охват точек.
 *
 * Долгота сжимается на косинус средней широты — без поправки Россия
 * растягивается по горизонтали настолько, что северные точки уезжают за край.
 */
function buildLayout(
  plan: MapPlan,
  leg: Leg,
  width: number,
  height: number,
  view: View,
): Layout | null {
  if (width < 40 || height < 40) return null;

  const points = new Map<string, Coordinates>(Object.entries(plan.coordinates));
  if (plan.destinationCoordinates) points.set(plan.destination, plan.destinationCoordinates);
  if (points.size === 0) return null;

  const all = [...points.values()];
  const meanLat = all.reduce((sum, point) => sum + point.lat, 0) / all.length;
  const scaleX = Math.cos((meanLat * Math.PI) / 180);

  const xs = all.map((point) => point.lon * scaleX);
  const ys = all.map((point) => -point.lat);

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  // Единичный охват (все гости из одного города) не должен делить на ноль.
  const spanX = Math.max(Math.max(...xs) - minX, 0.6);
  const spanY = Math.max(Math.max(...ys) - minY, 0.6);

  const padding = Math.min(PADDING, width / 6, height / 6);
  // Вплотную по городам карта переставала быть картой: подложка превращалась
  // в одну сплошную заливку без единого берега, по которому можно понять, где
  // ты находишься. Запас даёт увидеть форму, но не размазывает города в точку.
  const scale =
    Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY) / CONTEXT_ZOOM_OUT;

  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  // Пользовательский сдвиг и масштаб накладываются на подогнанную проекцию,
  // а не на готовую картинку: тогда подписи и точки остаются своего размера,
  // а не растягиваются вместе с ней.
  const place = (point: Coordinates): Placed => ({
    x: view.tx + view.k * (offsetX + (point.lon * scaleX - minX) * scale),
    y: view.ty + view.k * (offsetY + (-point.lat - minY) * scale),
  });

  const project = (city: string): Placed | null => {
    const point = points.get(city);
    return point ? place(point) : null;
  };

  // Город пересадки, который вдобавок является чьим-то домом, уже подписан
  // как город гостя — второй ярлык поверх первого читался бы как грязь.
  const guestCities = new Set(plan.guests.map((guest) => guest.city));
  const hubNames = new Set(
    plan.guests
      .flatMap((guest) => (leg === 'outbound' ? guest.outbound : guest.inbound)?.best?.via ?? [])
      .filter((city) => points.has(city) && !guestCities.has(city)),
  );

  const settled = new Set(plan.guests.map((guest) => guest.city));
  const pending = [...points.entries()]
    .filter(([city]) => !settled.has(city) && city !== plan.destination && !hubNames.has(city))
    .map(([name, at]) => ({ name, at: place(at) }));

  return {
    project,
    base: { offsetX, offsetY, minX, minY, scale, scaleX },
    target: plan.destinationCoordinates
      ? place(plan.destinationCoordinates)
      : { x: view.tx + view.k * (width / 2), y: view.ty + view.k * (height / 2) },
    hubs: [...hubNames].map((city) => ({ city, at: place(points.get(city)!) })),
    pending,
  };
}
