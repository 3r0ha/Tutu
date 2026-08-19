/**
 * Снимок панели организатора с уже существующим приглашением.
 *
 * Обычный `shoot.mjs` открывает чистую сессию, а доска ответов и посадка
 * появляются только у того, кто приглашение создал. Здесь идентификатор
 * кладётся в localStorage до загрузки страницы — ровно так же, как его
 * увидел бы вернувшийся организатор.
 *
 * Использование: node scripts/shoot-organizer.mjs <inviteId> [url] [outDir]
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const INVITE_ID = process.argv[2];
const URL_TARGET = process.argv[3] ?? 'http://localhost:5174/';
const OUT_DIR = process.argv[4] ?? '/tmp';
const PORT = 9223;

if (!INVITE_ID) {
  console.error('Нужен идентификатор приглашения первым аргументом');
  process.exit(1);
}

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--disable-gpu',
    '--no-first-run',
    '--user-data-dir=/tmp/sklejka-chrome-org',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
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
    if (!waiter) return;
    pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = (seq += 1);
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  return { ready, send, close: () => socket.close() };
}

const evaluate = async (send, expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;

try {
  const { ready, send, close } = connect(await findTarget());
  await ready;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 2,
    mobile: false,
  });

  // Сначала выходим на нужный origin, иначе localStorage писать некуда.
  await send('Page.navigate', { url: URL_TARGET });
  await sleep(1200);
  await evaluate(send, `localStorage.setItem('sklejka.invite', ${JSON.stringify(INVITE_ID)}), true`);
  await send('Page.navigate', { url: URL_TARGET });
  await sleep(1500);

  // Блок приглашения свёрнут по умолчанию — раскрываем, чтобы попасть в кадр.
  await evaluate(send, `document.querySelector('.invite-block')?.setAttribute('open', ''), true`);

  for (let attempt = 0; attempt < 90; attempt += 1) {
    await sleep(1000);
    const ready = await evaluate(send, `document.querySelectorAll('.seat-block, .seating').length > 0`);
    if (ready) break;
  }
  await sleep(1200);

  // Левая колонка прокручивается сама, поэтому высота страницы не растёт и
  // `captureBeyondViewport` до нижних блоков не достаёт — доводим её вручную.
  await evaluate(
    send,
    `(() => { const rail = document.querySelector('.rail-inner'); if (rail) rail.scrollTop = rail.scrollHeight; return true; })()`,
  );
  await sleep(600);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT_DIR}/sklejka-organizer.png`;
  await writeFile(file, Buffer.from(shot.data, 'base64'));
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`organizer: ${file}`);

  close();
} finally {
  chrome.kill();
}
