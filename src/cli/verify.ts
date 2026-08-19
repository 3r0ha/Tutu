/**
 * Проверка ядра на живых данных.
 *
 * Сценарий выбран так, чтобы разница была видна без интерпретации: Киров→Суздаль
 * прямым поиском Туту не находится вовсе, а склейкой через шлюз — находится.
 */

import { McpClient } from '../mcp/client.ts';
import { planRoute } from '../engine/planner.ts';
import type { Journey, PlanResult } from '../domain/types.ts';

const CASES = [
  { origin: 'Киров', destination: 'Суздаль', date: '2026-09-11' },
  { origin: 'Казань', destination: 'Суздаль', date: '2026-09-11' },
  { origin: 'Москва', destination: 'Казань', date: '2026-09-11' },
];

async function main(): Promise<void> {
  const mcp = new McpClient();

  for (const testCase of CASES) {
    const label = `${testCase.origin} → ${testCase.destination}, ${testCase.date}`;
    console.log(`\n${'='.repeat(78)}\n${label}\n${'='.repeat(78)}`);

    const asTutuSearches = await planRoute(mcp, testCase.origin, testCase.destination, testCase.date, {
      directOnly: true,
    });
    console.log(`\n[как ищет сам Туту]  вариантов: ${asTutuSearches.journeys.length}`);
    if (asTutuSearches.unreachable) console.log(`  ${asTutuSearches.unreachable.note}`);
    for (const journey of asTutuSearches.journeys.slice(0, 3)) console.log(`  ${describe(journey)}`);

    const withComposition = await planRoute(mcp, testCase.origin, testCase.destination, testCase.date);
    console.log(`\n[со склейкой]        вариантов: ${withComposition.journeys.length}`);
    if (withComposition.unreachable) console.log(`  ${withComposition.unreachable.note}`);
    for (const journey of withComposition.journeys.slice(0, 6)) console.log(`  ${describe(journey)}`);

    printDiagnostics(withComposition);
  }

  console.log(`\nИтого вызовов к MCP: ${mcp.stats.calls}, из кэша: ${mcp.stats.cacheHits}, повторов: ${mcp.stats.retries}, отказов: ${mcp.stats.failures}`);
}

function describe(journey: Journey): string {
  const route = journey.via.length ? `через ${journey.via.join(', ')}` : 'прямой';
  const modes = journey.hops.map((hop) => hop.mode).join('+');
  const price = `${Math.round(journey.totalPrice.amount)} ₽`;
  const lodging = journey.lodgingPrice ? ` (в т.ч. ночь ${Math.round(journey.lodgingPrice.amount)} ₽)` : '';
  const window = journey.transfers[0] ? ` окно ${formatDuration(journey.transfers[0].waitMin)}` : '';
  const risk = journey.transfers[0] ? ` [${journey.risk}] ${journey.transfers[0].risk.note}` : '';
  return `${price.padStart(8)}${lodging}  ${formatDuration(journey.totalDurationMin).padStart(9)}  ${route} (${modes})${window}${risk}`;
}

function printDiagnostics(plan: PlanResult): void {
  const { diagnostics, gateways } = plan;
  const catalogOnly = new Set(gateways.fromCatalog);
  const aiExclusive = gateways.proposedByAi.filter((city) => !catalogOnly.has(city));
  const confirmedFromAi = gateways.confirmed.filter((city) => aiExclusive.includes(city));

  console.log(`\n  шлюзы AI (${gateways.aiProvider}): ${gateways.proposedByAi.join(', ') || '—'}`);
  console.log(`  подтверждено данными: ${gateways.confirmed.join(', ') || '—'}`);
  if (confirmedFromAi.length) {
    console.log(`  найдено только благодаря AI: ${confirmedFromAi.join(', ')}`);
  }
  console.log(
    `  вызовов: ${diagnostics.mcpCalls} · из кэша: ${diagnostics.cacheHits} · повторов: ${diagnostics.retries} · отказов: ${diagnostics.failures} · ${(diagnostics.elapsedMs / 1000).toFixed(1)} с`,
  );
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} мин`;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} м`;
}

await main();
