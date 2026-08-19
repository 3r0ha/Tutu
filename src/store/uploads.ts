/**
 * Хранилище картинок для блоков лендинга.
 *
 * Файлы лежат рядом с остальными данными события. Имя складывается из хеша
 * содержимого: одна и та же картинка не займёт места дважды, а адрес можно
 * кэшировать навсегда — по этому адресу лежит ровно этот файл и никакой другой.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UPLOAD_DIR = join(ROOT, '.data', 'uploads');

/** Страница публичная: принимаем только картинки и только разумного размера. */
const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Первые байты файла для каждого разрешённого формата.
 *
 * У WebP и GIF сигнатура составная: `RIFF....WEBP` и `GIF8?a`, поэтому
 * проверяются обе части, а не только начало.
 */
function looksLike(type: string, bytes: Buffer): boolean {
  switch (type) {
    case 'image/jpeg':
      return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/png':
      return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return (
        bytes.length > 12 &&
        bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
        bytes.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    case 'image/gif':
      return bytes.length > 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('latin1'));
    default:
      return false;
  }
}

/** Возвращает публичный адрес файла или `null`, если он не прошёл проверку. */
export async function saveUpload(base64: string, type: string): Promise<string | null> {
  const extension = ALLOWED[type];
  if (!extension) return null;

  // В data-URL перед содержимым идёт заголовок — отрезаем его, если он есть.
  const payload = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, 'base64');
  } catch {
    return null;
  }

  if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
  // Заявленному типу верить нельзя: он приходит от клиента и подставляется
  // свободно. Расширение файла на диске определяет, с каким `content-type`
  // мы его потом отдадим, поэтому тип подтверждается сигнатурой содержимого.
  if (!looksLike(type, bytes)) return null;

  const name = createHash('sha256').update(bytes).digest('hex').slice(0, 24) + extension;

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, name), bytes);

  return `/uploads/${name}`;
}

export async function readUpload(
  pathname: string,
): Promise<{ bytes: Buffer; type: string } | null> {
  const name = pathname.replace('/uploads/', '');
  // Имя приходит из адреса, поэтому всё, кроме простого имени файла, отвергаем.
  if (!/^[a-f0-9]{24}\.(jpg|png|webp|gif)$/.test(name)) return null;

  const type = Object.entries(ALLOWED).find(([, ext]) => ext === extname(name))?.[0];
  if (!type) return null;

  try {
    return { bytes: await readFile(join(UPLOAD_DIR, name)), type };
  } catch {
    return null;
  }
}
