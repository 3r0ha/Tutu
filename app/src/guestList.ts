/**
 * Разбор списка гостей, вставленного текстом.
 *
 * Гостей у события десятки, а добавлялись они по одному — организатор с
 * сорока приглашёнными на такое просто не пойдёт. Списки при этом уже
 * существуют: в заметках, в таблице, в переписке. Здесь они принимаются
 * как есть, в тех форматах, в которых люди их и пишут.
 *
 * Разбор нарочно детерминированный, без языковой модели: список — это не
 * свободное описание события, а таблица, и угадывать в ней нечего.
 */

export interface ParsedGuestLine {
  name: string;
  city: string;
}

/** Запятая, точка с запятой, табуляция, тире любого начертания. */
const SEPARATORS = /\s*[,;\t]\s*|\s+[—–-]\s+/;

export function parseGuestList(text: string): ParsedGuestLine[] {
  const guests: ParsedGuestLine[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    // Маркеры списка: дефис, длинное и среднее тире, точка, кружок, нумерация.
    const line = rawLine.trim().replace(/^[-—–•*\d.)\s]+/, '');
    if (!line) continue;

    const parsed = parseLine(line);
    if (!parsed) continue;

    // Один и тот же человек из одного города дважды в списке — опечатка,
    // а не два пассажира: имена в списках повторяются при копировании.
    const key = `${parsed.name.toLowerCase()}|${parsed.city.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    guests.push(parsed);
  }

  return guests;
}

function parseLine(line: string): ParsedGuestLine | null {
  // «Аня (Киров)» — распространённая форма записи в заметках.
  const bracketed = line.match(/^(.+?)\s*[([]\s*(.+?)\s*[)\]]$/);
  if (bracketed) return build(bracketed[1], bracketed[2]);

  const parts = line.split(SEPARATORS).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return build(parts[0], parts[1]);
  if (parts.length === 1) {
    // Одинокое слово — это город: имя гостя без города бесполезно,
    // а город без имени вполне работает.
    return build(parts[0], parts[0]);
  }

  return null;
}

function build(name: string, city: string): ParsedGuestLine | null {
  const cleanName = name.trim().slice(0, 60);
  const cleanCity = city.trim().slice(0, 60);
  if (!cleanName || !cleanCity) return null;
  return { name: cleanName, city: cleanCity };
}
