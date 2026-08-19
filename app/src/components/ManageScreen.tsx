import { useCallback, useEffect, useState } from 'react';
import { fetchManaged, updateInvite, type ManageView } from '../api.ts';
import { manageUrl, rememberManageLink } from '../manageLinks.ts';
import { AnswersBoard } from './AnswersBoard.tsx';
import { SeatingBoard } from './SeatingBoard.tsx';
import { InviteCanvas } from './InviteCanvas.tsx';
import { defaultBlocks, type Block } from '../blocks.ts';

/**
 * Рабочий стол события по персональной ссылке.
 *
 * Раньше организатор публиковал приглашение и терял к нему доступ, стоило
 * закрыть вкладку: ответы гостей, посадка и правка оформления жили только
 * в памяти страницы. Теперь у события есть собственный адрес с ключом —
 * его можно сохранить в закладки, переслать себе или передать коллеге.
 */
export function ManageScreen({ id, manageKey }: { id: string; manageKey: string }) {
  const [view, setView] = useState<ManageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<'guest' | 'manage' | null>(null);

  const [title, setTitle] = useState('');
  const [venue, setVenue] = useState('');
  const [palette, setPalette] = useState('lime');
  const [ink, setInk] = useState<string | null>(null);
  // Страница правится тем же конструктором, что и при создании: после
  // публикации она не должна становиться неприкосновенной.
  const [blocks, setBlocks] = useState<Block[]>([]);

  const load = useCallback(async () => {
    try {
      const result = await fetchManaged(id, manageKey);
      setView(result);
      setTitle(result.invite.title);
      setVenue(result.invite.venue ?? '');
      setPalette(result.invite.theme?.palette ?? 'lime');
      setInk(result.invite.theme?.ink ?? null);
      setBlocks(result.invite.blocks?.length ? result.invite.blocks : defaultBlocks());
      rememberManageLink({ id, manageKey, title: result.invite.title });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть событие');
    }
  }, [id, manageKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setSavedNote(null);
    try {
      const cover = blocks.find((block) => block.kind === 'cover');
      await updateInvite(id, manageKey, {
        title,
        venue,
        blocks,
        theme: { palette, ink, cover: cover?.kind === 'cover' ? cover.cover : '✨' },
      });
      setSavedNote('Изменения сохранены — гости увидят их сразу.');
      await load();
    } catch (cause) {
      setSavedNote(cause instanceof Error ? cause.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const copy = async (kind: 'guest' | 'manage', text: string) => {
    await navigator.clipboard?.writeText(text).then(() => setCopied(kind)).catch(() => undefined);
  };

  if (error) {
    return (
      <div className="setup">
        <div className="setup-inner">
          <h1 className="setup-title">Событие недоступно</h1>
          <p className="hint">{error}</p>
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="setup">
        <div className="setup-inner">
          <div className="pulse" />
        </div>
      </div>
    );
  }

  const guestLink = `${window.location.origin}/i/${id}`;
  const adminLink = manageUrl(id, manageKey);

  return (
    <div className="setup">
      <div className="setup-inner">
        <header className="setup-head">
          <div>
            <p className="kicker">Событие</p>
            <h1 className="setup-title">{view.invite.title}</h1>
          </div>
          <a className="ghost" href="/events">
            Все события →
          </a>
        </header>

        <section className="card">
          <h2 className="card-title">Ссылки</h2>

          <div className="link-row">
            <div className="link-box">
              <span className="label">Гостям</span>
              <a href={guestLink} target="_blank" rel="noreferrer">
                {guestLink.replace(/^https?:\/\//, '')}
              </a>
            </div>
            <button type="button" className="ghost" onClick={() => copy('guest', guestLink)}>
              {copied === 'guest' ? 'Скопировано' : 'Копировать'}
            </button>
          </div>

          <div className="link-row">
            <div className="link-box admin">
              <span className="label">Ваша ссылка управления — сохраните её</span>
              <a href={adminLink}>{adminLink.replace(/^https?:\/\//, '')}</a>
            </div>
            <button type="button" className="ghost" onClick={() => copy('manage', adminLink)}>
              {copied === 'manage' ? 'Скопировано' : 'Копировать'}
            </button>
          </div>

          <p className="hint">
            По ссылке управления вы вернётесь к ответам и посадке с любого устройства. Кто ею
            владеет, тот и управляет событием — не публикуйте её вместе с приглашением.
          </p>

          {view.invite.guests.length > 0 && (
            <details className="personal-links">
              <summary className="label">
                Персональные ссылки — {view.invite.guests.length}
              </summary>
              <p className="hint">
                Общую ссылку удобно кинуть в общий чат: гость выберет свой город сам. Персональная
                открывает сразу его маршрут и подставляет имя в ответ — пригодится тем, кому нужно
                написать лично.
              </p>
              <ul className="personal-list">
                {view.invite.guests.map((guest) => {
                  const link = `${window.location.origin}/i/${id}/${guest.slug}`;
                  return (
                    <li key={guest.slug}>
                      <span className="personal-who">
                        {guest.name}
                        <span className="personal-city">{guest.city}</span>
                      </span>
                      <a href={link} target="_blank" rel="noreferrer">
                        {link.replace(/^https?:\/\//, '')}
                      </a>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => void navigator.clipboard?.writeText(link)}
                      >
                        Копировать
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </section>

        <p className="canvas-hint">
          Правьте страницу прямо здесь — гости увидят изменения сразу после сохранения.
        </p>

        <InviteCanvas
          blocks={blocks}
          palette={palette}
          ink={ink}
          cities={view.invite.routes.map((route) => ({
            city: route.city,
            price: route.plan.totalPrice?.amount ?? null,
          }))}
          destination={view.invite.destination}
          venue={venue}
          date={view.invite.date}
          returnDate={view.invite.returnDate}
          onChange={setBlocks}
          onVenue={setVenue}
          onPalette={setPalette}
          onInk={setInk}
          onTitle={setTitle}
        />

        <div className="setup-actions">
          <button type="button" className="primary" onClick={save} disabled={saving}>
            {saving ? 'Сохраняем…' : 'Сохранить страницу'}
          </button>
          {savedNote && <p className="hint">{savedNote}</p>}
        </div>

        <section className="card">
          <h2 className="card-title">Ответы гостей</h2>
          <AnswersBoard inviteId={id} />

          <h2 className="card-title spaced">Посадка попутчиков</h2>
          <SeatingBoard inviteId={id} />
        </section>
      </div>
    </div>
  );
}
