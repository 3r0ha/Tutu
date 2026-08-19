/**
 * Замер планировщика.
 *
 * Апстрим Туту отвечает с заметным разбросом, поэтому единичный прогон о
 * производительности не говорит ничего. Здесь каждый маршрут считается
 * несколько раз на чистом клиенте, и в отчёт идёт медиана вместе с разбросом —
 * иначе улучшение движка невозможно отличить от удачного дня сети.
 *
 * Использование: node src/cli/bench.ts [повторов]
 */

import { McpClient } from '../mcp/client.ts';
import { planRoute } from '../engine/planner.ts';

const ROUNDS = Number(process.argv[2] ?? 3);

const CASES = [
  { origin: 'Москва', destination: 'Казань', date: '2026-09-11' },
  { origin: 'Киров', destination: 'Суздаль', date: '2026-09-11' },
];

interface Sample {
  ms: number;
  calls: number;
  journeys: number;
}

async function main(): Promise<void> {
  for (const testCase of CASES) {
    const samples: Sample[] = [];

    for (let round = 0; round < ROUNDS; round += 1) {
      // Клиент создаётся заново: общий кэш превратил бы второй прогон
      // в замер словаря, а не сети.
      const mcp = new McpClient();
      const startedAt = Date.now();
      const plan = await planRoute(mcp, testCase.origin, testCase.destination, testCase.date);
      samples.push({
        ms: Date.now() - startedAt,
        calls: mcp.stats.calls,
        journeys: plan.journeys.length,
      });
    }

    const times = samples.map((sample) => sample.ms).sort((left, right) => left - right);
    const calls = samples.map((sample) => sample.calls);

    console.log(
      `${testCase.origin} → ${testCase.destination}: ` +
        `медиана ${(median(times) / 1000).toFixed(1)} с ` +
        `(от ${(times[0] / 1000).toFixed(1)} до ${(times[times.length - 1] / 1000).toFixed(1)}) · ` +
        `вызовов ${median(calls)} · маршрутов ${samples[0].journeys}`,
    );
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

await main();
