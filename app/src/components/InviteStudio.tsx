import { useState } from 'react';
import { createInvite } from '../api.ts';
import type { EventPlan, Guest } from '../types.ts';
import { defaultBlocks, TEMPLATES, type Block } from '../blocks.ts';
import { manageUrl, rememberManageLink } from '../manageLinks.ts';
import { InviteCanvas, type StayOption } from './InviteCanvas.tsx';

/**
 * Конструктор приглашения.
 *
 * Свадьба, корпоративный выезд и сборы секции — три разные страницы, и жёсткий
 * шаблон обслуживает их одинаково плохо. Организатор собирает свою: добавляет
 * блоки, убирает лишние, меняет порядок и сразу видит результат.
 */
export function InviteStudio({
  plan,
  guests,
  title,
  presetStays,
  onTitle,
  onBack,
}: {
  plan: EventPlan;
  guests: Guest[];
  title: string;
  /** Жильё из демо-набора, если организатор пришёл через показ. */
  presetStays?: { options: StayOption[]; note: string } | null;
  onTitle: (value: string) => void;
  onBack: () => void;
}) {
  const [blocks, setBlocks] = useState<Block[]>(() =>
    defaultBlocks().map((block) =>
      block.kind === 'cover' ? { ...block, title } : block,
    ),
  );
  const [venue, setVenue] = useState('');
  const [palette, setPalette] = useState<string>('lime');
  const [ink, setInk] = useState<string | null>(null);

  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [adminUrl, setAdminUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cover = blocks.find((block) => block.kind === 'cover');

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const invite = await createInvite({
        title: cover?.kind === 'cover' && cover.title ? cover.title : title,
        greeting: '',
        venue: venue.trim() || null,
        destination: plan.destination,
        endCity: plan.endCity,
        date: plan.date,
        returnDate: plan.returnDate,
        guests,
        theme: { palette, ink, cover: cover?.kind === 'cover' ? cover.cover : '✨' },
        blocks,
        routes: plan.guests.map((guest) => ({ city: guest.city, plan: guest })),
      });

      const url = `${window.location.origin}/i/${invite.id}`;
      const admin = manageUrl(invite.id, invite.manageKey);
      setInviteUrl(url);
      setAdminUrl(admin);
      rememberManageLink({ id: invite.id, manageKey: invite.manageKey, title });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось опубликовать');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup">
      <div className="setup-inner">
        <header className="setup-head">
          <div>
            <p className="kicker">Шаг 3 — приглашение</p>
            <h1 className="setup-title">Соберите страницу</h1>
          </div>
          <button type="button" className="ghost" onClick={onBack}>
            ← К результату
          </button>
        </header>

        <section className="card templates">
          <span className="label">Начать с шаблона</span>
          <div className="block-add">
            {TEMPLATES.map((template) => (
              <button
                key={template.key}
                type="button"
                className="chip"
                onClick={() => {
                  const next = template.build();
                  const first = next.find((block) => block.kind === 'cover');
                  if (first?.kind === 'cover') first.title = title;
                  setBlocks(next);
                }}
              >
                {template.cover} {template.label}
              </button>
            ))}
          </div>
        </section>

        <p className="canvas-hint">
          Это и есть страница гостя — правьте прямо здесь. Наведите на блок, чтобы поменять
          порядок или убрать его; кнопка «+ блок» появляется между блоками.
        </p>

        <InviteCanvas
          blocks={blocks}
          palette={palette}
          ink={ink}
          presetStays={presetStays}
          // Города нужны здесь, чтобы блок «дорога» в редакторе выглядел так же,
          // как у гостя, — с настоящими городами и ценами, а не серой заглушкой.
          cities={plan.guests.map((guest) => ({
            city: guest.city,
            price: guest.totalPrice?.amount ?? null,
          }))}
          destination={plan.destination}
          venue={venue}
          date={plan.date}
          returnDate={plan.returnDate}
          onChange={setBlocks}
          onVenue={setVenue}
          onPalette={setPalette}
          onInk={setInk}
          onTitle={onTitle}
        />

        {!inviteUrl ? (
          <div className="setup-actions">
            <button type="button" className="primary big" onClick={publish} disabled={busy}>
              {busy ? 'Публикуем…' : 'Опубликовать приглашение'}
            </button>
            {error && <p className="hint error">{error}</p>}
          </div>
        ) : (
          <section className="card">
            <h2 className="card-title">Приглашение опубликовано</h2>

            <div className="link-row">
              <div className="link-box">
                <span className="label">Ссылка гостям — рассылайте её</span>
                <a href={inviteUrl} target="_blank" rel="noreferrer">
                  {inviteUrl.replace(/^https?:\/\//, '')}
                </a>
              </div>
            </div>

            {adminUrl && (
              <div className="link-row">
                <div className="link-box admin">
                  <span className="label">Ваша ссылка управления — сохраните её</span>
                  <a href={adminUrl}>{adminUrl.replace(/^https?:\/\//, '')}</a>
                </div>
                <a className="primary" href={adminUrl}>
                  Открыть событие →
                </a>
              </div>
            )}

            <p className="hint">
              По ссылке управления вы вернётесь к ответам, посадке и правке страницы с любого
              устройства. Гостям её отправлять не нужно.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
