/**
 * Снимок полосы сценариев.
 *
 * Полоса появляется только со второго расчёта, поэтому скрипт прогоняет два:
 * сначала исходное место, затем другое. Так проверяется именно то, ради чего
 * полоса и сделана, — что разницу между вариантами видно на экране.
 *
 * Использование: node scripts/shoot-scenarios.mjs [место2] [url] [outDir]
 */

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SECOND_PLACE = process.argv[2] ?? 'Коломна';
const URL_TARGET = process.argv[3] ?? 'http://localhost:5174/';
const OUT_DIR = process.argv[4] ?? '/tmp';
const PORT = 9224;

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--disable-gpu',
    '--no-first-run',
    '--user-data-dir=/tmp/sklejka-chrome-sc',
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

/**
 * Ждём завершения расчёта.
 *
 * Считать признаком готовности первые линии на карте нельзя: она заполняется
 * по ходу дела, и такой признак срабатывает в середине — второй клик тогда
 * приходится на заблокированную кнопку.
 */
async function waitForIdle(send) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await sleep(1000);
    const running = await evaluate(send, `Boolean(document.querySelector('.overlay'))`);
    const drawn = await evaluate(send, `document.querySelectorAll('.flow').length`);
    if (!running && drawn > 0 && attempt > 1) return true;
  }
  return false;
}

/** React слушает нативное событие input, поэтому значение ставим через сеттер прототипа. */
const setInput = (selector, value) => `
  (() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()
`;

try {
  const { ready, send, close } = connect(await findTarget());
  await ready;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });

  await send('Page.navigate', { url: URL_TARGET });
  await sleep(1500);

  console.log('первый расчёт…');
  await evaluate(send, `document.querySelector('.primary')?.click(), true`);
  if (!(await waitForIdle(send))) console.error('первый расчёт не завершился');

  console.log(`второй расчёт: ${SECOND_PLACE}…`);
  await evaluate(send, setInput('#destination', SECOND_PLACE));
  await sleep(400);
  await evaluate(send, `document.querySelector('.primary')?.click(), true`);
  if (!(await waitForIdle(send))) console.error('второй расчёт не завершился');

  const shown = await evaluate(send, `document.querySelectorAll('.scenario').length`);
  console.log(`сценариев на экране: ${shown}`);
  await sleep(1200);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${OUT_DIR}/sklejka-scenarios.png`;
  await writeFile(file, Buffer.from(shot.data, 'base64'));
  console.log(`снимок: ${file}`);

  close();
} finally {
  chrome.kill();
}
