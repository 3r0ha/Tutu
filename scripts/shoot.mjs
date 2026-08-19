/**
 * Снимок интерфейса через Chrome DevTools Protocol.
 *
 * Нужен, чтобы проверять реальную отрисовку с живыми данными, а не верить
 * в неё на слово: запускает расчёт, дожидается карты и снимает экран в двух
 * форматах — десктопном и мобильном.
 *
 * `SHOOT_STOP_AT_GUESTS=N` снимает кадр в середине расчёта, когда посчитаны
 * первые N гостей, — так проверяется прогрессивное заполнение карты.
 *
 * Использование: node scripts/shoot.mjs [url] [outDir]
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL_TARGET = process.argv[2] ?? 'http://localhost:5174/';
const OUT_DIR = process.argv[3] ?? '/tmp';
const PORT = 9222;

const VIEWPORTS = (process.env.SHOOT_VIEWPORTS ?? 'desktop,mobile')
  .split(',')
  .map((name) => name.trim())
  .map((name) =>
    name === 'mobile'
      ? { name, width: 390, height: 844, mobile: true }
      : { name, width: 1440, height: 900, mobile: false },
  );

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--disable-gpu',
    '--no-first-run',
    '--user-data-dir=/tmp/sklejka-chrome',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((entry) => entry.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome ещё поднимается.
    }
    await sleep(250);
  }
  throw new Error('Chrome не поднялся');
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let seq = 0;

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('ошибка сокета CDP')));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = (seq += 1);
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  return { ready, send, close: () => socket.close() };
}

const evaluate = async (send, expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return result.result?.value;
};

try {
  const { ready, send, close } = connect(await findTarget());
  await ready;
  await send('Page.enable');
  await send('Runtime.enable');
  await mkdir(OUT_DIR, { recursive: true });

  for (const viewport of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 2,
      mobile: viewport.mobile,
    });

    await send('Page.navigate', { url: URL_TARGET });
    await sleep(1200);

    // Экран приглашения и панель организатора запускаются разными действиями
    // и завершаются разной разметкой, поэтому ждём каждый по своему признаку.
    const isInvite = URL_TARGET.includes('/i/');
    const trigger = isInvite ? '.chip' : '.primary';
    const doneWhen = isInvite ? '.option' : '.flow';

    await evaluate(send, `document.querySelector('${trigger}')?.click(), true`);

    const stopAt = Number(process.env.SHOOT_STOP_AT_GUESTS ?? 0);
    let drawn = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await sleep(stopAt > 0 ? 250 : 1000);
      if (stopAt > 0) {
        // Ждём момент, когда часть гостей уже на карте, а расчёт ещё идёт.
        const flows = await evaluate(send, `document.querySelectorAll('.flow').length`);
        const running = await evaluate(send, `Boolean(document.querySelector('.overlay'))`);
        if (flows >= stopAt && running) { drawn = true; break; }
        if (!running && flows > 0) { drawn = true; break; }
        continue;
      }
      // Готовность — не первые линии, а завершившийся расчёт: карта
      // заполняется по ходу дела, и линии появляются задолго до конца.
      const running = await evaluate(send, `Boolean(document.querySelector('.overlay'))`);
      drawn = !running && (await evaluate(send, `document.querySelectorAll('${doneWhen}').length > 0`));
      if (drawn && attempt > 1) break;
    }
    if (!drawn) console.error(`[${viewport.name}] результат не отрисовался за отведённое время`);

    // Мобильная шторка закрыта по умолчанию — на снимке нужна карта.
    if (stopAt === 0) await sleep(1500);

    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: isInvite,
    });
    const file = `${OUT_DIR}/sklejka-${process.env.SHOOT_TAG ?? 'plan'}-${viewport.name}.png`;
    await writeFile(file, Buffer.from(shot.data, 'base64'));
    console.log(`${viewport.name}: ${file}`);
  }

  close();
} finally {
  chrome.kill();
}
