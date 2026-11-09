import type { ReactNode } from "react";
import { RULES, perWeekOf } from "../../../shared/rules";

/**
 * Статья «Правила публикации» (решение владельца 09.11.2026): выжимка исследований, по которой работает «В очередь».
 * Числа берутся из shared/rules.ts — те же, что использует расписание.
 */
const hh = (h: number) => `${h}:00`;

function Rule({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="rounded-m3l bg-surface-container p-4">
      <h3 className="type-title-m flex gap-2">
        <span className="text-primary">{n}.</span>
        {title}
      </h3>
      <div className="type-body-m mt-2 space-y-2 text-on-surface-variant [&_b]:text-on-surface [&_li]:ml-4 [&_li]:list-disc">{children}</div>
    </section>
  );
}

export function RulesArticle() {
  const [wdFrom, wdTo] = RULES.hours.weekday;
  const [weFrom, weTo] = RULES.hours.weekend;
  return (
    <article className="space-y-3">
      <p className="type-body-m text-on-surface-variant">
        Выжимка исследований Buffer (2 млн постов Instagram, 11 млн TikTok), Metricool (6 млн роликов) и правил Instagram и YouTube. По этим правилам
        работает кнопка «В очередь», им же следует Claude.
      </p>

      <Rule n={1} title="Регулярность важнее точного часа">
        <ul>
          <li>
            План — <b>{RULES.videosPerWeek} новых ролика в неделю</b>.
          </li>
          <li>
            В каждую соцсеть — до <b>{perWeekOf("instagram")} постов в неделю</b>, в Google Бизнес — <b>{perWeekOf("googlebusiness")}</b>. При 3–5 постах в неделю охват поста в
            Instagram выше на ~12%, подписчиков прибавляется вдвое быстрее, чем при 1–2.
          </li>
          <li>
            Неделя без постов снижает охват. Если в соцсети <b>{RULES.idleDays} дней пусто</b> и ничего не запланировано — придёт напоминание в Telegram.
          </li>
        </ul>
      </Rule>

      <Rule n={2} title="Один ролик — не везде сразу">
        <ul>
          <li>
            Следующая соцсеть — не раньше чем через <b>{RULES.spreadDays} дня</b>: 7 соцсетей — около 3 недель. Подписчик нескольких соцсетей не видит одно и то же
            подряд, мы не назойливы.
          </li>
          <li>Первой идёт соцсеть, где больше всего просмотров (сейчас YouTube, Instagram airfixertbls, TikTok).</li>
          <li>Нужно выложить куда-то прямо сейчас — у поста в календаре «Опубликовать сейчас».</li>
        </ul>
      </Rule>

      <Rule n={3} title="Время — когда вы можете ответить">
        <ul>
          <li>
            Посты выходят <b>
              в будни {hh(wdFrom)}–{hh(wdTo)}, в выходные {hh(weFrom)}–{hh(weTo)}
            </b>{" "}
            по Тбилиси. Первые 1–2 часа решают: ответы на комментарии поднимают пост.
          </li>
          <li>Внутри этих часов — лучший час канала по его цифрам («Статистика» → «Лучшее время»).</li>
          <li>Посты одной соцсети — не ближе {RULES.sameChannelGapHours} часов друг к другу.</li>
        </ul>
      </Rule>

      <Rule n={4} title="Свежие ролики">
        <ul>
          <li>
            По наблюдениям авторов (YouTube не подтверждал), Shorts старше ~30 дней почти не попадают в рекомендации. Охват держится на постоянном потоке новых
            роликов, а не на старых.
          </li>
        </ul>
      </Rule>

      <Rule n={5} title="Только своё и без чужих значков">
        <ul>
          <li>Instagram не рекомендует аккаунты, где в основном чужие ролики, и ролики со значком TikTok. Мы загружаем чистый файл из «Готового» — так и надо.</li>
          <li>
            Повтор ролика в ту же соцсеть — не раньше чем через <b>{RULES.repostGapDays} дней</b>, только у роликов с галочкой «Можно повторять», и{" "}
            <b>с новой подписью и другим началом</b> (первые секунды) — иначе Instagram сочтёт его копией.
          </li>
        </ul>
      </Rule>

      <Rule n={6} title="Подпись под каждую соцсеть">
        <ul>
          <li>
            <b>TikTok</b> — просто, что на видео, с ключевыми словами: там ищут через поиск.
          </li>
          <li>
            <b>Instagram</b> — в конце вопрос или повод переслать: там важны комментарии и пересылки.
          </li>
          <li>
            <b>YouTube</b> — ключевые слова в названии, подробности в описании.
          </li>
          <li>
            <b>Telegram</b> — как Instagram, но короче (до 1024 знаков).
          </li>
          <li>
            <b>Google Бизнес</b> — предложение или акция с кнопкой; обычный пост там быстро устаревает, поэтому раз в неделю.
          </li>
        </ul>
      </Rule>

      <section className="type-body-s space-y-1 px-1 text-on-surface-variant">
        <p>Источники:</p>
        {[
          ["Buffer — как часто постить в Instagram", "https://buffer.com/resources/how-often-to-post-on-instagram/"],
          ["Buffer — как часто постить в TikTok", "https://buffer.com/resources/how-often-should-you-post-on-tiktok/"],
          ["Metricool — один ролик в трёх соцсетях", "https://metricool.com/how-to-repurpose-video-content/"],
          ["Tubefilter — Instagram и неоригинальный контент", "https://tubefilter.com/2026/04/30/instagram-removes-algorithm-recommendations-repost-content-aggregator"],
          ["Search Engine Journal — YouTube Shorts и свежесть", "https://www.searchenginejournal.com/youtube-shorts-algorithm-may-now-favor-fresh-over-evergreen/562661/"],
        ].map(([t, u]) => (
          <a key={u} href={u} target="_blank" rel="noreferrer" className="block text-primary underline">
            {t}
          </a>
        ))}
      </section>
    </article>
  );
}

/** Экран «Правила публикации» (Настройки → Правила публикации). */
export function RulesPage() {
  return (
    <div className="pt-2">
      <a href="#/settings" className="type-label-l mb-3 inline-block text-primary">
        ← Настройки
      </a>
      <RulesArticle />
    </div>
  );
}
