/**
 * Файловая коллекция записей.
 *
 * Приглашений и ответов на них на порядки меньше, чем запросов маршрутов,
 * и пишутся они только по действию человека. Заводить базу ради двух таких
 * коллекций значило бы усложнить развёртывание без выигрыша, поэтому здесь
 * один общий примитив вместо копии файловой возни в каждом хранилище.
 *
 * Записи держатся в памяти, на диск уходит весь набор целиком. Это осознанно:
 * при десятках записей стоимость перезаписи ничтожна, зато нет ни частичных
 * состояний, ни отдельного формата журнала.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = join(ROOT, '.data');

export interface Entity {
  id: string;
}

export class FileCollection<T extends Entity> {
  private readonly file: string;
  private items: Map<string, T> | null = null;
  /** Записи выстраиваются в очередь: параллельные сохранения затирали бы друг друга. */
  private writing: Promise<void> = Promise.resolve();

  constructor(fileName: string) {
    this.file = join(DATA_DIR, fileName);
  }

  private async load(): Promise<Map<string, T>> {
    if (this.items) return this.items;

    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as T[];
      this.items = new Map(parsed.map((item) => [item.id, item]));
    } catch {
      // Файла ещё нет — это первый запуск, а не сбой.
      this.items = new Map();
    }

    return this.items;
  }

  async get(id: string): Promise<T | null> {
    return (await this.load()).get(id) ?? null;
  }

  async find(predicate: (item: T) => boolean): Promise<T[]> {
    return [...(await this.load()).values()].filter(predicate);
  }

  async put(item: T): Promise<T> {
    const items = await this.load();
    items.set(item.id, item);
    await this.flush(items);
    return item;
  }

  private flush(items: Map<string, T>): Promise<void> {
    this.writing = this.writing.then(async () => {
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(this.file, JSON.stringify([...items.values()], null, 2), 'utf8');
    });
    return this.writing;
  }
}
