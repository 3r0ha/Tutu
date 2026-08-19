/**
 * Ключи управления событиями, сохранённые в этом браузере.
 *
 * Ключ выдаётся при публикации и живёт в персональной ссылке. Хранилище
 * браузера — только удобство: оно собирает рабочий стол из событий, которые
 * человек создавал с этой машины. Потерять доступ оно не даёт, потому что
 * настоящий доступ — это ссылка, которую можно переслать себе или коллеге.
 */

const KEY = 'sklejka.manage';

export interface ManageLink {
  id: string;
  manageKey: string;
  title: string;
  savedAt: string;
}

export function loadManageLinks(): ManageLink[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ManageLink[];
    return Array.isArray(parsed)
      ? parsed.filter((link) => typeof link?.id === 'string' && typeof link?.manageKey === 'string')
      : [];
  } catch {
    return [];
  }
}

export function rememberManageLink(link: Omit<ManageLink, 'savedAt'>): void {
  try {
    const existing = loadManageLinks().filter((entry) => entry.id !== link.id);
    const next = [{ ...link, savedAt: new Date().toISOString() }, ...existing].slice(0, 60);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Приватный режим — не повод ронять публикацию.
  }
}

export function manageUrl(id: string, manageKey: string): string {
  return `${window.location.origin}/e/${id}/${manageKey}`;
}

/**
 * Разбор вставленной ссылки управления.
 *
 * Список событий строится из ключей этого браузера, поэтому на новом
 * устройстве он пуст — даже если ссылка у человека сохранена. Возможность
 * вставить её возвращает доступ без всякой регистрации.
 */
export function parseManageUrl(input: string): { id: string; manageKey: string } | null {
  const match = input.trim().match(/\/e\/([a-z0-9]{4,32})\/([a-z0-9]{16,64})/);
  return match ? { id: match[1], manageKey: match[2] } : null;
}
