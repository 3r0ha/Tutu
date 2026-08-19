import type { EventPlan, Leg, ViewMode } from '../types.ts';
import { formatMoney } from './JourneyCard.tsx';
import { reachedCount, travelCost } from '../planStats.ts';

export interface Scenario {
  id: string;
  destination: string;
  date: string;
  returnDate: string | null;
  plan: EventPlan;
}

/**
 * Опробованные сценарии события.
 *
 * Место и дата — не поля формы, а ручки: организатор их крутит и смотрит,
 * кого выбранная точка отсекает. Без памяти о предыдущих расчётах крутить
 * бессмысленно — каждый следующий стирал предыдущий, и сравнивать было не с чем.
 *
 * Сохранённые расчёты переключаются мгновенно: план лежит целиком, повторного
 * обхода сети не требуется.
 */
export function ScenarioBar({
  scenarios,
  activeId,
  mode,
  leg,
  onPick,
  onDrop,
}: {
  scenarios: Scenario[];
  activeId: string | null;
  mode: ViewMode;
  leg: Leg;
  onPick: (scenario: Scenario) => void;
  onDrop: (id: string) => void;
}) {
  if (scenarios.length < 2) return null;

  const active = scenarios.find((scenario) => scenario.id === activeId) ?? null;

  return (
    <div className="scenarios" role="group" aria-label="Где проводить событие">
      {/* Два города внизу без подписи читались как загадка: непонятно, это
          два этапа поездки или два разных события. Это ни то ни другое —
          организатор выбирает, где провести, и сравнивает цену выбора. */}
      <span className="scenarios-lead">
        Где проводить
        <i>сравните, кого какое место отсекает</i>
      </span>
      {scenarios.map((scenario) => {
        const isActive = scenario.id === activeId;
        const reached = reachedCount(scenario.plan, mode, leg);
        const cost = travelCost(scenario.plan, mode);
        const delta = active && !isActive ? reached - reachedCount(active.plan, mode, leg) : 0;

        // Суммы сравнимы, только когда едет одинаковое число людей. Иначе
        // вариант, куда никто не доезжает, выглядел бы самым выгодным:
        // Суздаль с нулём доехавших показывал «−18 760 ₽» зелёным.
        const comparableCost = active && !isActive && delta === 0;
        const costDelta = comparableCost ? cost - travelCost(active.plan, mode) : 0;

        return (
          <button
            key={scenario.id}
            type="button"
            className={`scenario${isActive ? ' active' : ''}${reached < scenario.plan.summary.guests ? ' lossy' : ''}`}
            aria-pressed={isActive}
            onClick={() => onPick(scenario)}
          >
            <span className="scenario-where">
              {scenario.destination}
              <span className="scenario-when">{formatRange(scenario.date, scenario.returnDate)}</span>
            </span>

            <span className="scenario-stat">
              <b>
                {reached}
                <span className="of">/{scenario.plan.summary.guests}</span>
              </b>
              {delta !== 0 && (
                <i className={delta > 0 ? 'up' : 'down'}>
                  {delta > 0 ? `+${delta}` : delta}
                </i>
              )}
            </span>

            <span className="scenario-cost">
              {reached === 0 ? '—' : formatMoney(cost)}
              {costDelta !== 0 && (
                // Дешевле — хорошо, поэтому знак и цвет здесь противоположны
                // числу доехавших: минус в рублях красится в зелёный.
                <i className={costDelta < 0 ? 'up' : 'down'}>
                  {costDelta > 0 ? '+' : '−'}
                  {formatMoney(Math.abs(costDelta))}
                </i>
              )}
            </span>

            <span
              className="scenario-drop"
              role="button"
              tabIndex={-1}
              aria-label={`Убрать вариант ${scenario.destination}`}
              onClick={(event) => {
                event.stopPropagation();
                onDrop(scenario.id);
              }}
            >
              ×
            </span>
          </button>
        );
      })}
    </div>
  );
}

function formatRange(date: string, returnDate: string | null): string {
  const short = (iso: string): string => {
    const [, month, day] = iso.split('-');
    return `${Number(day)}.${month}`;
  };
  return returnDate ? `${short(date)}–${short(returnDate)}` : short(date);
}
