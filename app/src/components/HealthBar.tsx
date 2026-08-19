import type { EventPlan, Leg, ViewMode } from '../types.ts';
import { formatMoney } from './JourneyCard.tsx';
import {
  explainMetric,
  guestsForMetric,
  hasAnyReturn,
  reachedCount,
  travelCost,
  unlockedByComposition,
  type MetricKey,
} from '../planStats.ts';

/**
 * Здоровье события.
 *
 * Главная величина здесь не цена, а число людей, которых выбранные место и даты
 * отсекают. Показатели пересчитываются под режим просмотра: разница между двумя
 * числами и есть то, что добавляет склейка.
 *
 * Каждое число нажимается. «4 на грани срыва» само по себе только тревожит:
 * оно не говорит ни кто эти четверо, ни что с ними не так. По нажатию
 * показатель называет имена и объясняет причину словами.
 */
export function HealthBar({
  plan,
  mode,
  leg,
  opened,
  onOpen,
}: {
  plan: EventPlan | null;
  mode: ViewMode;
  leg: Leg;
  opened: MetricKey | null;
  onOpen: (metric: MetricKey | null) => void;
}) {
  if (!plan) {
    return (
      <footer className="health empty-health">
        <span>Расчёт покажет, сколько гостей доедет, сколько сможет уехать и во что обойдётся дорога.</span>
      </footer>
    );
  }

  const { summary } = plan;
  const hasReturn = plan.returnDate !== null;

  // Показатель считается по тому направлению, которое сейчас на карте, —
  // иначе цифры внизу противоречили бы цветам наверху.
  const reachable = reachedCount(plan, mode, leg);
  const unreachable = summary.guests - reachable;
  const cost = travelCost(plan, mode);
  const unlocked = unlockedByComposition(plan, leg);
  const atRisk = mode === 'direct' ? 0 : summary.atRisk;

  // Обратная дата запрошена, но ни одного обратного рейса не нашлось: сумма
  // покрывает только дорогу туда, и подписывать её «в оба конца» нельзя.
  const anyReturnFound = hasAnyReturn(plan);

  const names = opened ? guestsForMetric(plan, opened, mode, leg) : [];

  return (
    <footer className="health">
      <div className="health-metrics">
        <Metric
          metric="reached"
          value={
            <>
              {reachable}
              <span className="of">/{summary.guests}</span>
            </>
          }
          label={leg === 'outbound' ? 'доедут' : 'уедут обратно'}
          opened={opened}
          onOpen={onOpen}
        />

        <Metric
          metric="unreached"
          value={unreachable}
          warn={unreachable > 0}
          label={leg === 'outbound' ? 'не доедут' : 'не уедут'}
          opened={opened}
          onOpen={onOpen}
        />

        {hasReturn && (
          <Metric
            metric="stranded"
            value={summary.stranded}
            warn={summary.stranded > 0}
            label="застрянут"
            opened={opened}
            onOpen={onOpen}
          />
        )}

        {/* Сумма — не про людей, разбирать её на имена нечем. */}
        <div className="metric plain">
          <span className="metric-value">{formatMoney(cost)}</span>
          <span className="metric-label">
            {hasReturn && anyReturnFound ? 'дорога в оба конца' : 'только дорога туда'}
          </span>
        </div>

        <Metric
          metric="atRisk"
          value={atRisk}
          warn={atRisk > 0}
          label="на грани срыва"
          opened={opened}
          onOpen={onOpen}
        />
      </div>

      {opened && (
        <div className="metric-detail">
          <button
            type="button"
            className="close small"
            aria-label="Закрыть пояснение"
            onClick={() => onOpen(null)}
          >
            ×
          </button>
          <p className="metric-why">{explainMetric(opened, leg)}</p>
          {names.length > 0 ? (
            <p className="metric-who">{names.join(', ')}</p>
          ) : (
            <p className="metric-who empty">Таких гостей нет.</p>
          )}
        </div>
      )}

      {unlocked > 0 && !opened && (
        <div className="unlock">
          <strong>+{unlocked}</strong>
          <span>
            {unlocked === 1 ? 'гостя открывает склейка' : 'гостей открывает склейка'} — прямого
            сообщения у них нет
          </span>
        </div>
      )}
    </footer>
  );
}

function Metric({
  metric,
  value,
  label,
  warn,
  opened,
  onOpen,
}: {
  metric: MetricKey;
  value: React.ReactNode;
  label: string;
  warn?: boolean;
  opened: MetricKey | null;
  onOpen: (metric: MetricKey | null) => void;
}) {
  const active = opened === metric;

  return (
    <button
      type="button"
      className={`metric${active ? ' active' : ''}`}
      aria-expanded={active}
      onClick={() => onOpen(active ? null : metric)}
    >
      <span className={`metric-value${warn ? ' warn' : ''}`}>{value}</span>
      <span className="metric-label">{label}</span>
    </button>
  );
}
